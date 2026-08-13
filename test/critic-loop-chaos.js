// critic-loop-chaos.js — win/lose correctness under chaos + reset hygiene + stars.
const { launch, dragShot, waitShotResolved, worldSnapshot } = require('./helpers');

const WEAK = { dx: -40, dy: 8 };
const SHOT = { dx: -105, dy: 30 };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  :: ' + detail : ''));
}

async function st(page) {
  return page.evaluate(() => ({
    state: GameLoop.getState(),
    rem: GameLoop.getRemaining(),
    bird: (() => { const b = Slingshot.getBird(); return b ? { x: +b.position.x.toFixed(1), y: +b.position.y.toFixed(1), stat: b.isStatic } : null; })(),
    bodies: Matter.Composite.allBodies(Game.world).length,
    dbg: Structure._debug(),
    alive: Structure.enemyAlive(),
    tf: Game.canvas.style.transform || '',
  }));
}

// Count star shapes drawn on the win overlay by scanning the star row for
// runs of the star fill colour (#ffcf3f) — cy-130 = 230.
async function countStars(page) {
  return page.evaluate(() => {
    const d = Game.ctx.getImageData(0, 230, Game.W, 1).data;
    let runs = 0, inRun = false;
    for (let x = 0; x < Game.W; x++) {
      const r = d[x * 4], g = d[x * 4 + 1], b = d[x * 4 + 2];
      const yellow = r > 200 && g > 150 && b < 120;
      if (yellow && !inRun) { runs++; inRun = true; }
      else if (!yellow) inRun = false;
    }
    return runs;
  });
}

async function resetFresh(page) {
  await page.keyboard.press('r');
  await page.waitForTimeout(500);
}

(async () => {
  const { browser, page, errors } = await launch();
  const base = await st(page);
  console.log('BASELINE bodies=' + base.bodies + ' debris=' + base.dbg.debris + ' particles=' + base.dbg.particles);

  // ---------------------------------------------------------- 1. synthetic guards
  console.log('\n--- 1. synthetic event guards ---');
  await page.evaluate(() => { for (let i = 0; i < 6; i++) Game.events.emit('bird:launched', {}); });
  let s = await st(page);
  check('remaining never goes negative on launch spam', s.rem >= 0, 'remaining=' + s.rem);
  await resetFresh(page);

  // double enemy:killed -> single win, no double overlay
  await page.evaluate(() => { Game.events.emit('enemy:killed', {}); Game.events.emit('enemy:killed', {}); });
  await page.waitForTimeout(1400);
  s = await st(page);
  let stars = await countStars(page);
  check('double enemy:killed -> state win', s.state === 'win', 'state=' + s.state);
  check('3-bird win shows 3 stars', stars === 3, 'stars drawn=' + stars);
  await page.screenshot({ path: 'test/screens/critic-loop-chaos-3star.png' });
  await resetFresh(page);

  // ------------------------------------------- 2. kill AFTER lose (late topple)
  console.log('\n--- 2. enemy killed AFTER the last bird died (late topple) ---');
  await page.evaluate(() => {
    // burn all three attempts
    for (let i = 0; i < 3; i++) { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); }
  });
  await page.waitForTimeout(300);
  s = await st(page);
  check('out of birds -> lose', s.state === 'lose', 'state=' + s.state + ' rem=' + s.rem);
  await page.evaluate(() => Game.events.emit('enemy:killed', {}));
  await page.waitForTimeout(900);
  s = await st(page);
  stars = await countStars(page);
  check('enemy killed 1s after lose -> should become WIN', s.state === 'win',
        'state=' + s.state + ' (stars drawn=' + stars + ')');
  await page.screenshot({ path: 'test/screens/critic-loop-chaos-late-kill-after-lose.png' });
  await resetFresh(page);

  // ------------------------------------------- 3. kill AFTER bird:dead, birds left
  console.log('\n--- 3. enemy killed shortly after bird:dead, birds remaining ---');
  await page.evaluate(() => { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); });
  await page.waitForTimeout(300);            // inside the 700ms reload beat
  await page.evaluate(() => Game.events.emit('enemy:killed', {}));
  await page.waitForTimeout(1500);
  s = await st(page);
  stars = await countStars(page);
  check('kill during reload beat -> win', s.state === 'win', 'state=' + s.state);
  check('2-bird-left win shows 3 stars (rem=2 +1)', stars === 3, 'stars=' + stars + ' rem=' + s.rem);
  await resetFresh(page);

  // ------------------------------------------- 4. stars by remaining
  console.log('\n--- 4. star counts vs birds remaining ---');
  for (const spend of [1, 2, 3]) {
    await resetFresh(page);
    await page.evaluate((n) => {
      for (let i = 0; i < n; i++) { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); }
    }, spend);
    await page.waitForTimeout(120);
    const pre = await st(page);
    await page.evaluate(() => Game.events.emit('enemy:killed', {}));
    await page.waitForTimeout(1400);
    stars = await countStars(page);
    const post = await st(page);
    const expect = Math.max(1, Math.min(3, pre.rem + 1));
    check(`win with ${pre.rem} birds left -> ${expect} stars`, stars === expect,
          `spent=${spend} rem=${pre.rem} starsDrawn=${stars} state=${post.state}`);
    if (spend === 3) await page.screenshot({ path: 'test/screens/critic-loop-chaos-1star.png' });
  }
  await resetFresh(page);

  // ------------------------------------------- 5. restart mid-flight (real shot)
  console.log('\n--- 5. restart during flight ---');
  await dragShot(page, SHOT.dx, SHOT.dy);
  await page.waitForTimeout(320);
  const midFlight = await st(page);
  await page.keyboard.press('r');
  await page.waitForTimeout(450);
  s = await st(page);
  check('restart mid-flight -> playing/3 birds', s.state === 'playing' && s.rem === 3, JSON.stringify({ state: s.state, rem: s.rem }));
  check('restart mid-flight -> body count back to baseline', s.bodies === base.bodies,
        `bodies=${s.bodies} baseline=${base.bodies} (midflight was ${midFlight.bodies})`);
  check('restart mid-flight -> fresh bird nocked at anchor', !!s.bird && s.bird.stat === true && Math.abs(s.bird.x - 220) < 2,
        JSON.stringify(s.bird));
  check('restart mid-flight -> no debris/particles left', s.dbg.debris === 0 && s.dbg.particles === 0,
        `debris=${s.dbg.debris} particles=${s.dbg.particles}`);
  check('restart mid-flight -> enemy restored', s.alive === true, 'alive=' + s.alive);

  // ------------------------------------------- 6. restart during overlay fade-in
  console.log('\n--- 6. restart during overlay fade-in ---');
  await page.evaluate(() => Game.events.emit('enemy:killed', {}));
  await page.waitForTimeout(750);            // 600ms reveal + ~150ms of the 450ms fade
  const fadeShot = await page.evaluate(() => {
    const d = Game.ctx.getImageData(640, 120, 1, 1).data; return (d[0] + d[1] + d[2]) / 3;
  });
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  s = await st(page);
  check('restart mid-fade -> clean playing state', s.state === 'playing' && s.rem === 3 && s.bodies === base.bodies,
        JSON.stringify({ state: s.state, rem: s.rem, bodies: s.bodies, skyLumDuringFade: fadeShot | 0 }));
  const veilGone = await page.evaluate(() => {
    const d = Game.ctx.getImageData(640, 120, 1, 1).data; return (d[0] + d[1] + d[2]) / 3;
  });
  check('overlay veil fully cleared after restart', veilGone > fadeShot, `lum during fade=${fadeShot | 0} after restart=${veilGone | 0}`);

  // ------------------------------------------- 7. hammer R x10
  console.log('\n--- 7. hammer R x10 ---');
  for (let i = 0; i < 10; i++) { await page.keyboard.press('r'); }
  await page.waitForTimeout(600);
  s = await st(page);
  check('R x10 -> playing, 3 birds, baseline bodies', s.state === 'playing' && s.rem === 3 && s.bodies === base.bodies,
        JSON.stringify({ state: s.state, rem: s.rem, bodies: s.bodies, debris: s.dbg.debris, particles: s.dbg.particles }));
  check('R x10 -> exactly one bird nocked', !!s.bird && s.bird.stat === true, JSON.stringify(s.bird));
  const birdCount = await page.evaluate(() => Matter.Composite.allBodies(Game.world).filter(b => b.label === 'bird').length);
  check('R x10 -> exactly one bird body in world', birdCount === 1, 'birdBodies=' + birdCount);

  // R spam mid-flight
  await dragShot(page, SHOT.dx, SHOT.dy);
  await page.waitForTimeout(250);
  for (let i = 0; i < 10; i++) { await page.keyboard.press('r'); await page.waitForTimeout(30); }
  await page.waitForTimeout(500);
  s = await st(page);
  const birdCount2 = await page.evaluate(() => Matter.Composite.allBodies(Game.world).filter(b => b.label === 'bird').length);
  check('R x10 during flight -> single bird, baseline bodies', birdCount2 === 1 && s.bodies === base.bodies,
        JSON.stringify({ birds: birdCount2, bodies: s.bodies, rem: s.rem, state: s.state }));

  // ------------------------------------------- 8. shooting after the win
  console.log('\n--- 8. input after win ---');
  await resetFresh(page);
  await page.evaluate(() => Game.events.emit('enemy:killed', {}));
  await page.waitForTimeout(200);            // still inside the 600ms reveal, overlay not visible yet
  const canDrag = await page.evaluate(() => !!Slingshot.getBird());
  await dragShot(page, SHOT.dx, SHOT.dy).catch(e => console.log('   dragShot threw: ' + e.message));
  await page.waitForTimeout(400);
  s = await st(page);
  check('launching during win reveal does not corrupt counters', s.rem === 3 && s.state === 'win',
        JSON.stringify({ rem: s.rem, state: s.state, birdWasGrabbable: canDrag }));
  const flying = await page.evaluate(() => { const b = Slingshot.getBird(); return b ? !b.isStatic : false; });
  check('no bird can be fired after the level is won', flying === false, 'birdFlyingDuringWinOverlay=' + flying);
  await page.screenshot({ path: 'test/screens/critic-loop-chaos-shot-after-win.png' });

  // ------------------------------------------- 9. reset hygiene x6 from all states
  console.log('\n--- 9. reset hygiene, 6 cycles from mixed states ---');
  let hygieneOk = true, worst = '';
  for (let i = 0; i < 6; i++) {
    await resetFresh(page);
    if (i % 3 === 0) {                       // reset from mid-flight after real damage
      await dragShot(page, SHOT.dx, SHOT.dy);
      await page.waitForTimeout(900);
    } else if (i % 3 === 1) {                // reset from a win overlay
      await page.evaluate(() => Game.events.emit('enemy:killed', {}));
      await page.waitForTimeout(1200);
    } else {                                 // reset from a lose overlay
      await page.evaluate(() => { for (let k = 0; k < 3; k++) { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); } });
      await page.waitForTimeout(700);
    }
    await page.keyboard.press('r');
    await page.waitForTimeout(500);
    const a = await st(page);
    const ok = a.bodies === base.bodies && a.rem === 3 && a.state === 'playing' &&
               a.dbg.debris === 0 && a.dbg.particles === 0 && a.alive === true &&
               a.dbg.blocks.length === base.dbg.blocks.length &&
               a.dbg.blocks.every(b => b.hp === b.maxHp);
    if (!ok) { hygieneOk = false; worst = JSON.stringify({ i, bodies: a.bodies, rem: a.rem, state: a.state, debris: a.dbg.debris, particles: a.dbg.particles, alive: a.alive, blocks: a.dbg.blocks.length, hp: a.dbg.blocks.map(b => b.hp) }); }
    console.log(`   cycle ${i}: bodies=${a.bodies} rem=${a.rem} state=${a.state} debris=${a.dbg.debris} particles=${a.dbg.particles} blocksFullHp=${a.dbg.blocks.every(b => b.hp === b.maxHp)}`);
  }
  check('6 reset cycles all return to pristine baseline', hygieneOk, worst || 'all clean');
  await page.screenshot({ path: 'test/screens/critic-loop-chaos-after-6-resets.png' });

  console.log('\npage errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  console.log('SUMMARY ' + results.filter(r => r.pass).length + '/' + results.length + ' passed');
  results.filter(r => !r.pass).forEach(r => console.log('  FAILED: ' + r.name + ' :: ' + r.detail));
  await browser.close();
})();
