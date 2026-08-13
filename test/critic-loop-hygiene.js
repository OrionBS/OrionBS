// critic-loop-hygiene.js — reset hygiene / body leaks on the live build.
// Guards against Structure._debug() throwing (it does once an enemy is damaged dead).
const { launch, dragShot, waitShotResolved } = require('./helpers');

const st = page => page.evaluate(() => {
  let dbg = null, dbgErr = null;
  try { dbg = Structure._debug(); } catch (e) { dbgErr = String(e).slice(0, 60); }
  return {
    state: GameLoop.getState(), rem: GameLoop.getRemaining(),
    bodies: Matter.Composite.allBodies(Game.world).length,
    ids: Matter.Composite.allBodies(Game.world).map(b => b.id),
    labels: Matter.Composite.allBodies(Game.world).reduce((m, b) => (m[b.label] = (m[b.label] || 0) + 1, m), {}),
    lvl: Structure.levelIndex(), enemiesLeft: Structure.enemiesLeft(),
    dbg, dbgErr,
  };
});

const results = [];
const check = (n, p, d) => { results.push({ n, p, d }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? '  :: ' + d : '')); };

(async () => {
  const { browser, page, errors } = await launch();
  const fresh = await st(page);
  console.log(`fresh level 1: bodies=${fresh.bodies} labels=${JSON.stringify(fresh.labels)}`);

  console.log('\n--- 6 damage+reset cycles on level 1 ---');
  let ok = true;
  for (let i = 0; i < 6; i++) {
    await dragShot(page, -105, 30 + (i % 3) * 20);
    await waitShotResolved(page, 14000);
    await page.waitForTimeout(i % 2 ? 800 : 6200);   // alternate: reset mid-debris vs after despawn
    const pre = await st(page);
    await page.keyboard.press('r');
    await page.waitForTimeout(900);
    const post = await st(page);
    const extraIds = post.ids.filter(id => !fresh.ids.includes(id) && fresh.ids.length);
    const clean = post.bodies === fresh.bodies && post.rem === 3 && post.state === 'playing' &&
                  post.enemiesLeft === fresh.enemiesLeft &&
                  (!post.dbg || (post.dbg.debris === 0 && post.dbg.particles === 0 &&
                                 post.dbg.blocks.every(b => b.hp === b.maxHp)));
    if (!clean) ok = false;
    console.log(`  cycle ${i}: preReset bodies=${pre.bodies} -> postReset bodies=${post.bodies} (fresh=${fresh.bodies}) ` +
      `labels=${JSON.stringify(post.labels)} rem=${post.rem} enemiesLeft=${post.enemiesLeft} ` +
      `debris=${post.dbg ? post.dbg.debris : '?'} particles=${post.dbg ? post.dbg.particles : '?'} ` +
      `blocksFullHp=${post.dbg ? post.dbg.blocks.every(b => b.hp === b.maxHp) : '?'}` +
      (post.dbgErr ? ` _debugTHREW(${post.dbgErr})` : ''));
    if (post.state !== 'playing') { await page.keyboard.press('r'); await page.waitForTimeout(700); }
  }
  const end = await st(page);
  check('6 damage+reset cycles return to pristine baseline', ok,
        `endBodies=${end.bodies} fresh=${fresh.bodies} labels=${JSON.stringify(end.labels)}`);

  const stray = await page.evaluate(() => Matter.Composite.allBodies(Game.world)
    .filter(b => !b.isStatic).map(b => ({ l: b.label, x: +b.position.x.toFixed(0), y: +b.position.y.toFixed(0), sleep: b.isSleeping })));
  console.log('  non-static bodies at end:', JSON.stringify(stray));
  await page.screenshot({ path: 'test/screens/critic-loop-hygiene-end.png' });

  // level-switch hygiene: cycle through all 5 levels twice, compare to fresh per-level counts
  console.log('\n--- level switching hygiene (2 laps over 5 levels) ---');
  const per = {};
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press(String(i + 1));
      await page.waitForTimeout(550);
      const s = await st(page);
      if (lap === 0) per[i] = s.bodies;
      else if (s.bodies !== per[i]) ok = false;
      if (lap === 1) console.log(`  level ${i}: lap0 bodies=${per[i]} lap1 bodies=${s.bodies} rem=${s.rem} enemiesLeft=${s.enemiesLeft}`);
    }
  }
  const lapEnd = await st(page);
  check('level switching leaks no bodies', Object.keys(per).length === 5 && ok, JSON.stringify(per));

  // does advancing with N (loadLevel + level:reset) double-build?
  console.log('\n--- N-advance build accounting ---');
  await page.keyboard.press('1'); await page.waitForTimeout(550);
  const builds = await page.evaluate(() => {
    let n = 0;
    Game.events.on('level:reset', () => n++);
    Game.events.emit('level:cleared', {});
    return new Promise(res => setTimeout(() => {
      const before = Matter.Composite.allBodies(Game.world).length;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
      setTimeout(() => res({ resets: n, before, after: Matter.Composite.allBodies(Game.world).length, lvl: Structure.levelIndex() }), 400);
    }, 1400));
  });
  console.log('  N advance:', JSON.stringify(builds), '(Structure.loadLevel builds, then level:reset rebuilds again)');

  console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
  console.log('SUMMARY ' + results.filter(r => r.p).length + '/' + results.length);
  await browser.close();
})();
