// critic-loop-live.js — loop critique against the live (multi-level) build.
// Chaos correctness, reset hygiene, body-leak isolation, level progression, stars.
const { launch, dragShot, waitShotResolved } = require('./helpers');

const SHOT = { dx: -105, dy: 30 };
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  :: ' + detail : ''));
}

const st = page => page.evaluate(() => ({
  state: GameLoop.getState(), rem: GameLoop.getRemaining(),
  bodies: Matter.Composite.allBodies(Game.world).length,
  ids: Matter.Composite.allBodies(Game.world).map(b => b.id),
  labels: Matter.Composite.allBodies(Game.world).reduce((m, b) => (m[b.label] = (m[b.label] || 0) + 1, m), {}),
  dbg: Structure._debug(),
  lvl: Structure.levelIndex(), lvlName: Structure.level().name, birds: Structure.level().birds,
  enemiesLeft: Structure.enemiesLeft(), alive: Structure.enemyAlive(),
  tf: Game.canvas.style.transform || '',
}));

const countStars = page => page.evaluate(() => {
  const d = Game.ctx.getImageData(0, 230, Game.W, 1).data;
  let runs = 0, inRun = false;
  for (let x = 0; x < Game.W; x++) {
    const yellow = d[x * 4] > 200 && d[x * 4 + 1] > 150 && d[x * 4 + 2] < 120;
    if (yellow && !inRun) { runs++; inRun = true; } else if (!yellow) inRun = false;
  }
  return runs;
});

const clear = page => page.evaluate(() => Game.events.emit('level:cleared', {}));
const spend = (page, n) => page.evaluate((k) => {
  for (let i = 0; i < k; i++) { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); }
}, n);

async function R(page, ms = 550) { await page.keyboard.press('r'); await page.waitForTimeout(ms); }

(async () => {
  const { browser, page, errors } = await launch();
  const base = await st(page);
  console.log(`BASELINE level=${base.lvl} "${base.lvlName}" bodies=${base.bodies} labels=${JSON.stringify(base.labels)} birds=${base.birds} enemies=${base.enemiesLeft}`);

  // per-level fresh baselines (jump with number keys)
  const lvlBase = {};
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(String(i + 1));
    await page.waitForTimeout(500);
    const s = await st(page);
    lvlBase[i] = s;
    console.log(`  level ${i} "${s.lvlName}" bodies=${s.bodies} birds=${s.birds} rem=${s.rem} enemies=${s.enemiesLeft} labels=${JSON.stringify(s.labels)}`);
    check(`level ${i}: remaining matches level bird budget`, s.rem === s.birds, `rem=${s.rem} budget=${s.birds}`);
  }
  await page.keyboard.press('1'); await page.waitForTimeout(500);

  // ----------------------------------------------- 1. late clear after lose
  console.log('\n--- 1. level:cleared arriving AFTER the lose overlay ---');
  await spend(page, 3);
  await page.waitForTimeout(250);
  let s = await st(page);
  check('out of birds -> lose', s.state === 'lose', 'state=' + s.state);
  await clear(page);
  await page.waitForTimeout(900);
  s = await st(page);
  check('late clear after lose -> should flip to WIN', s.state === 'win', 'state=' + s.state);
  await page.screenshot({ path: 'test/screens/critic-loop-live-late-clear-lose.png' });
  await R(page);

  // ----------------------------------------------- 2. last-bird win = 1 star
  console.log('\n--- 2. star counts ---');
  for (const sp of [0, 1, 2]) {
    await R(page);
    await spend(page, sp);
    await page.evaluate(() => Game.events.emit('bird:launched', {})); // last bird in flight
    const pre = await st(page);
    await clear(page);
    await page.waitForTimeout(1400);
    const stars = await countStars(page);
    const expect = Math.max(1, Math.min(3, pre.rem + 1));
    check(`win with ${pre.rem} birds left -> ${expect} stars`, stars === expect, `starsDrawn=${stars}`);
    if (pre.rem === 0) await page.screenshot({ path: 'test/screens/critic-loop-live-1star.png' });
    if (pre.rem === 2) await page.screenshot({ path: 'test/screens/critic-loop-live-3star.png' });
  }
  await R(page);

  // ----------------------------------------------- 3. level progression
  console.log('\n--- 3. level progression via N and via click ---');
  await page.keyboard.press('1'); await page.waitForTimeout(450);
  await clear(page); await page.waitForTimeout(1300);
  await page.keyboard.press('n'); await page.waitForTimeout(700);
  s = await st(page);
  check('N on win advances to level 2 with a clean state',
        s.lvl === 1 && s.state === 'playing' && s.rem === s.birds && s.bodies === lvlBase[1].bodies,
        JSON.stringify({ lvl: s.lvl, state: s.state, rem: s.rem, bodies: s.bodies, expBodies: lvlBase[1].bodies, debris: s.dbg.debris, particles: s.dbg.particles }));
  await page.screenshot({ path: 'test/screens/critic-loop-live-level2-hud.png' });

  await clear(page); await page.waitForTimeout(1300);
  await page.mouse.click(640, 400); await page.waitForTimeout(700);
  s = await st(page);
  check('click on win overlay advances to level 3', s.lvl === 2 && s.state === 'playing' && s.bodies === lvlBase[2].bodies,
        JSON.stringify({ lvl: s.lvl, state: s.state, bodies: s.bodies, expBodies: lvlBase[2].bodies }));

  // N spam on the win overlay (does it skip several levels?)
  await clear(page); await page.waitForTimeout(1300);
  for (let i = 0; i < 6; i++) { await page.keyboard.press('n'); await page.waitForTimeout(25); }
  await page.waitForTimeout(600);
  s = await st(page);
  check('N spam on one win overlay advances exactly one level', s.lvl === 3,
        `landed on level ${s.lvl} (expected 3) state=${s.state} rem=${s.rem} bodies=${s.bodies}/${lvlBase[3].bodies}`);

  // last level -> loops back
  await page.keyboard.press('5'); await page.waitForTimeout(500);
  await clear(page); await page.waitForTimeout(1300);
  await page.screenshot({ path: 'test/screens/critic-loop-live-lastlevel-win.png' });
  await page.keyboard.press('n'); await page.waitForTimeout(700);
  s = await st(page);
  check('N on the last level loops back to level 1 cleanly', s.lvl === 0 && s.state === 'playing' && s.bodies === lvlBase[0].bodies,
        JSON.stringify({ lvl: s.lvl, state: s.state, bodies: s.bodies }));

  // ----------------------------------------------- 4. R during win = replay same level
  console.log('\n--- 4. R on a win overlay replays the same level ---');
  await page.keyboard.press('3'); await page.waitForTimeout(450);
  await clear(page); await page.waitForTimeout(1300);
  await R(page);
  s = await st(page);
  check('R on win replays the same level', s.lvl === 2 && s.state === 'playing' && s.rem === s.birds,
        JSON.stringify({ lvl: s.lvl, state: s.state, rem: s.rem }));

  // ----------------------------------------------- 5. body leak after real damage
  console.log('\n--- 5. body leak across real shots + resets (level 1) ---');
  await page.keyboard.press('1'); await page.waitForTimeout(500);
  const l1 = await st(page);
  let leakDetail = [];
  for (let i = 0; i < 3; i++) {
    await dragShot(page, SHOT.dx, SHOT.dy);
    await waitShotResolved(page, 14000);
    await page.waitForTimeout(6500);           // debris life is 4s
    const pre = await st(page);
    await R(page, 800);
    const post = await st(page);
    const extra = post.ids.filter(id => !l1.ids.includes(id));
    leakDetail.push(`cycle${i}: preReset bodies=${pre.bodies}(debrisList=${pre.dbg.debris}) postReset bodies=${post.bodies} (fresh=${l1.bodies}) ` +
                    `labels=${JSON.stringify(post.labels)} fullHp=${post.dbg.blocks.every(b => b.hp === b.maxHp)}`);
    console.log('   ' + leakDetail[i]);
    if (post.state !== 'playing') await R(page);
  }
  const after3 = await st(page);
  check('no bodies leak across 3 damage+reset cycles', after3.bodies === l1.bodies,
        `bodies=${after3.bodies} fresh=${l1.bodies} labels=${JSON.stringify(after3.labels)} trackedBlocks=${after3.dbg.blocks.length} debrisList=${after3.dbg.debris}`);
  check('fresh level after reset has all blocks at full HP', after3.dbg.blocks.every(b => b.hp === b.maxHp),
        JSON.stringify(after3.dbg.blocks.map(b => b.hp)));
  const stray = await page.evaluate(() => Matter.Composite.allBodies(Game.world)
    .filter(b => !b.isStatic)
    .map(b => ({ id: b.id, l: b.label, x: +b.position.x.toFixed(0), y: +b.position.y.toFixed(0), sleep: b.isSleeping })));
  console.log('   non-static bodies now:', JSON.stringify(stray));
  await page.screenshot({ path: 'test/screens/critic-loop-live-after-3-damage-resets.png' });

  // ----------------------------------------------- 6. chaos restarts
  console.log('\n--- 6. chaos restarts ---');
  await page.keyboard.press('1'); await page.waitForTimeout(500);
  await dragShot(page, SHOT.dx, SHOT.dy);
  await page.waitForTimeout(300);
  await R(page);
  s = await st(page);
  const birds = await page.evaluate(() => Matter.Composite.allBodies(Game.world).filter(b => b.label === 'bird').length);
  check('restart mid-flight clean', s.state === 'playing' && s.rem === s.birds && s.bodies === lvlBase[0].bodies && birds === 1,
        JSON.stringify({ state: s.state, rem: s.rem, bodies: s.bodies, birds }));

  await clear(page); await page.waitForTimeout(720);   // mid fade-in
  await R(page, 450);
  s = await st(page);
  check('restart mid overlay fade clean', s.state === 'playing' && s.rem === s.birds && s.bodies === lvlBase[0].bodies,
        JSON.stringify({ state: s.state, rem: s.rem, bodies: s.bodies }));

  for (let i = 0; i < 10; i++) await page.keyboard.press('r');
  await page.waitForTimeout(600);
  s = await st(page);
  const birds2 = await page.evaluate(() => Matter.Composite.allBodies(Game.world).filter(b => b.label === 'bird').length);
  check('R x10 clean', s.state === 'playing' && s.rem === s.birds && s.bodies === lvlBase[0].bodies && birds2 === 1,
        JSON.stringify({ state: s.state, rem: s.rem, bodies: s.bodies, birds: birds2 }));

  // level-jump spam mid-flight
  await dragShot(page, SHOT.dx, SHOT.dy);
  await page.waitForTimeout(250);
  for (const k of ['2', '5', '3', '1', '4', '1']) { await page.keyboard.press(k); await page.waitForTimeout(40); }
  await page.waitForTimeout(700);
  s = await st(page);
  const birds3 = await page.evaluate(() => Matter.Composite.allBodies(Game.world).filter(b => b.label === 'bird').length);
  check('level-jump spam mid-flight leaves a clean level 1', s.lvl === 0 && s.bodies === lvlBase[0].bodies && birds3 === 1 && s.rem === s.birds,
        JSON.stringify({ lvl: s.lvl, bodies: s.bodies, expected: lvlBase[0].bodies, birds: birds3, rem: s.rem, state: s.state }));

  // ----------------------------------------------- 7. input after win
  console.log('\n--- 7. input during the win reveal ---');
  await R(page);
  await clear(page);
  await page.waitForTimeout(200);              // inside the 600ms reveal: overlay not visible yet
  await dragShot(page, SHOT.dx, SHOT.dy).catch(e => console.log('   drag threw ' + e.message));
  await page.waitForTimeout(500);
  const flying = await page.evaluate(() => { const b = Slingshot.getBird(); return b ? !b.isStatic : false; });
  s = await st(page);
  check('cannot fire a bird after the level is won', flying === false,
        `birdFlying=${flying} state=${s.state} rem=${s.rem}`);
  await page.screenshot({ path: 'test/screens/critic-loop-live-shot-after-win.png' });

  // click-restart landing on the slingshot
  console.log('\n--- 8. overlay click that lands on the slingshot ---');
  await R(page);
  await spend(page, 3);
  await page.waitForTimeout(900);              // lose overlay up
  await page.mouse.move(220, 505);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move(140, 545, { steps: 8 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(600);
  s = await st(page);
  check('clicking the overlay near the sling does not spend a bird', s.rem === s.birds,
        `rem=${s.rem}/${s.birds} state=${s.state}`);
  await page.screenshot({ path: 'test/screens/critic-loop-live-overlay-click-sling.png' });

  console.log('\npage errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  console.log('SUMMARY ' + results.filter(r => r.pass).length + '/' + results.length + ' passed');
  results.filter(r => !r.pass).forEach(r => console.log('  FAILED: ' + r.name + ' :: ' + r.detail));
  await browser.close();
})();
