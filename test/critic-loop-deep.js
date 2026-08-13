// critic-loop-deep.js — isolate the reset body leak, the last-bird win path,
// overlay-click-grabs-bird, late topple after a real 3rd shot, and shot pacing.
const { launch, dragShot, waitShotResolved } = require('./helpers');

const SHOT = { dx: -105, dy: 30 };
const WEAK = { dx: -40, dy: 8 };

const labels = page => page.evaluate(() => {
  const m = {};
  Matter.Composite.allBodies(Game.world).forEach(b => { m[b.label] = (m[b.label] || 0) + 1; });
  return m;
});
const snap = page => page.evaluate(() => ({
  state: GameLoop.getState(), rem: GameLoop.getRemaining(),
  bodies: Matter.Composite.allBodies(Game.world).length,
  dbg: Structure._debug(),
}));

(async () => {
  const { browser, page, errors } = await launch();

  // ------------------------------------------------ A. body leak after fragmentation
  console.log('=== A. body leak isolation ===');
  const base = await labels(page);
  console.log('baseline labels', JSON.stringify(base));
  for (let i = 0; i < 3; i++) {
    await dragShot(page, SHOT.dx, SHOT.dy);
    await waitShotResolved(page, 14000);
    await page.waitForTimeout(6500);          // let debris despawn (4s life)
    const preReset = await labels(page);
    const preDbg = await snap(page);
    await page.keyboard.press('r');
    await page.waitForTimeout(800);
    const post = await labels(page);
    const postDbg = await snap(page);
    console.log(`shot ${i + 1}: preReset=${JSON.stringify(preReset)} (debrisList=${preDbg.dbg.debris}) ` +
                `-> postReset=${JSON.stringify(post)} blocksFullHp=${postDbg.dbg.blocks.every(b => b.hp === b.maxHp)} ` +
                `blockHp=${JSON.stringify(postDbg.dbg.blocks.map(b => b.hp))}`);
  }
  // what are the orphans? bodies in the world that no module tracks
  const orphans = await page.evaluate(() => {
    const tracked = new Set();
    const dbg = Structure._debug();
    // rebuild by matching positions is fragile; instead report every non-static body
    return Matter.Composite.allBodies(Game.world)
      .filter(b => !b.isStatic)
      .map(b => ({ id: b.id, label: b.label, x: +b.position.x.toFixed(0), y: +b.position.y.toFixed(0), sleeping: b.isSleeping }));
  });
  console.log('non-static bodies after 3 shots+resets:', JSON.stringify(orphans));
  console.log('structure blocks tracked:', (await snap(page)).dbg.blocks.length, 'debrisList:', (await snap(page)).dbg.debris);

  // ------------------------------------------------ B. legit last-bird win (1 star)
  console.log('\n=== B. last-bird win (kill while bird 3 is still flying) ===');
  await page.keyboard.press('r');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {});
    Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {});
    Game.events.emit('bird:launched', {});                 // third in flight, rem=0
    Game.events.emit('enemy:killed', {});
  });
  await page.waitForTimeout(1500);
  const stars = await page.evaluate(() => {
    const d = Game.ctx.getImageData(0, 230, Game.W, 1).data;
    let runs = 0, inRun = false;
    for (let x = 0; x < Game.W; x++) {
      const yellow = d[x * 4] > 200 && d[x * 4 + 1] > 150 && d[x * 4 + 2] < 120;
      if (yellow && !inRun) { runs++; inRun = true; } else if (!yellow) inRun = false;
    }
    return runs;
  });
  const bs = await snap(page);
  console.log(`last-bird win: state=${bs.state} rem=${bs.rem} starsDrawn=${stars} (expect win/0/1)`);
  await page.screenshot({ path: 'test/screens/critic-loop-deep-1star.png' });

  // ------------------------------------------------ C. click on overlay near the sling
  console.log('\n=== C. click-to-restart landing on the sling ===');
  await page.mouse.move(220, 505);
  await page.mouse.down();
  await page.waitForTimeout(60);
  const duringClick = await page.evaluate(() => ({ state: GameLoop.getState(), bird: !!Slingshot.getBird() }));
  await page.mouse.move(150, 540, { steps: 6 });
  await page.waitForTimeout(60);
  const dragged = await page.evaluate(() => { const b = Slingshot.getBird(); return b ? { x: +b.position.x.toFixed(0), y: +b.position.y.toFixed(0) } : null; });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterClick = await snap(page);
  console.log(`click restart at the sling: duringClick=${JSON.stringify(duringClick)} birdPosAfterDrag=${JSON.stringify(dragged)} ` +
              `-> state=${afterClick.state} rem=${afterClick.rem} (a bird grabbed/launched by the restart click would show rem<3)`);
  await page.screenshot({ path: 'test/screens/critic-loop-deep-overlay-click-sling.png' });

  // ------------------------------------------------ D. real 3rd-shot late topple window
  console.log('\n=== D. is the structure still moving when LOSE is declared? ===');
  await page.keyboard.press('r');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__marks = [];
    window.__motion = [];
    ['bird:launched', 'bird:dead', 'enemy:killed'].forEach(n => Game.events.on(n, () => window.__marks.push({ n, t: performance.now() })));
    Game.updaters.push(() => {
      const bodies = Matter.Composite.allBodies(Game.world).filter(b => !b.isStatic && b.label !== 'bird');
      const mx = bodies.reduce((m, b) => Math.max(m, b.speed), 0);
      window.__motion.push({ t: performance.now(), mx: +mx.toFixed(3), st: GameLoop.getState() });
      if (window.__motion.length > 8000) window.__motion.shift();
    });
  });
  // burn 2 birds cheaply, then take a real structure-hitting 3rd shot
  await page.evaluate(() => { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); });
  await page.waitForTimeout(900);
  await dragShot(page, SHOT.dx, SHOT.dy);
  await waitShotResolved(page, 14000);
  await page.waitForTimeout(4000);
  const d = await page.evaluate(() => ({ marks: window.__marks, motion: window.__motion }));
  const dead = d.marks.filter(m => m.n === 'bird:dead').pop();
  const launched = d.marks.filter(m => m.n === 'bird:launched').pop();
  const after = d.motion.filter(m => m.t >= dead.t);
  const stillMoving = after.filter(m => m.mx > 0.5);
  const lastMove = after.filter(m => m.mx > 0.5).pop();
  console.log(`3rd shot: flight=${(dead.t - launched.t) | 0}ms`);
  console.log(`at bird:dead, max structure speed=${after.length ? after[0].mx : 'n/a'}; ` +
              `frames with structure speed>0.5 AFTER lose declared=${stillMoving.length}` +
              (lastMove ? `; last structure motion ${((lastMove.t - dead.t) | 0)}ms after LOSE` : ''));
  const finalState = await snap(page);
  console.log('final state:', finalState.state, 'rem', finalState.rem);

  // ------------------------------------------------ E. shot resolution pacing, real shots
  console.log('\n=== E. shot resolution pacing (real shots into the structure) ===');
  await page.keyboard.press('r');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__pace = [];
    window.__ev = [];
    ['bird:launched', 'bird:dead', 'bird:loaded', 'enemy:killed'].forEach(n => Game.events.on(n, () => window.__ev.push({ n, t: performance.now() })));
    Game.updaters.push(() => {
      const b = Slingshot.getBird();
      window.__pace.push({ t: performance.now(), sp: b && !b.isStatic ? +b.speed.toFixed(3) : null });
      if (window.__pace.length > 8000) window.__pace.shift();
    });
  });
  for (const shot of [SHOT, { dx: -105, dy: 70 }, WEAK]) {
    const t0 = await page.evaluate(() => performance.now());
    await dragShot(page, shot.dx, shot.dy);
    await waitShotResolved(page, 14000);
    await page.waitForTimeout(1300);
    const p = await page.evaluate(() => ({ pace: window.__pace, ev: window.__ev }));
    const launchE = p.ev.filter(e => e.n === 'bird:launched').pop();
    const deadE = p.ev.filter(e => e.n === 'bird:dead').pop();
    if (!deadE || !launchE) { console.log(`  shot ${JSON.stringify(shot)}: no dead event (state=${(await snap(page)).state})`); continue; }
    const seg = p.pace.filter(s => s.t >= launchE.t && s.t <= deadE.t && s.sp !== null);
    const lastFast = seg.filter(s => s.sp >= 2).pop();
    const lastSlow = seg.filter(s => s.sp >= 0.2).pop();
    const load = p.ev.filter(e => e.n === 'bird:loaded' && e.t > deadE.t)[0];
    console.log(`  shot ${JSON.stringify(shot)}: flight=${(deadE.t - launchE.t) | 0}ms  ` +
                `deadAfterLastRealMotion(sp>=2)=${lastFast ? (deadE.t - lastFast.t) | 0 : 'n/a'}ms  ` +
                `deadAfterCrawl(sp>=0.2)=${lastSlow ? (deadE.t - lastSlow.t) | 0 : 'n/a'}ms  ` +
                `dead->loaded=${load ? (load.t - deadE.t) | 0 : 'NONE'}ms  hitTimeout=${(deadE.t - launchE.t) >= 7900}`);
    if ((await snap(page)).state !== 'playing') { await page.keyboard.press('r'); await page.waitForTimeout(700); }
  }

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})();
