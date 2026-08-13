// critic-loop-hudpace.js — HUD readability screenshots at key states, true dead
// time between "world is quiet" and "next bird ready", and 8s-timeout hunting.
const { launch, dragShot, waitShotResolved } = require('./helpers');

const quietProbe = page => page.evaluate(() => {
  window.__q = [];
  window.__ev = [];
  ['bird:launched', 'bird:dead', 'bird:loaded'].forEach(n =>
    Game.events.on(n, () => window.__ev.push({ n, t: performance.now() })));
  Game.updaters.push(() => {
    const bodies = Matter.Composite.allBodies(Game.world).filter(b => !b.isStatic);
    let birdSp = 0, worldSp = 0;
    for (const b of bodies) {
      if (b.label === 'bird') birdSp = Math.max(birdSp, b.speed);
      else worldSp = Math.max(worldSp, b.speed);
    }
    window.__q.push({ t: performance.now(), b: +birdSp.toFixed(2), w: +worldSp.toFixed(2) });
    if (window.__q.length > 9000) window.__q.shift();
  });
});

(async () => {
  const { browser, page, errors } = await launch();

  // ---------------------------------------------------------------- HUD states
  console.log('=== HUD screenshots ===');
  await page.screenshot({ path: 'test/screens/critic-loop-hud-fresh.png' });

  // mid-flight
  await dragShot(page, -105, 30);
  await page.waitForTimeout(260);
  await page.screenshot({ path: 'test/screens/critic-loop-hud-inflight.png' });
  console.log('  inflight HUD:', JSON.stringify(await page.evaluate(() => ({ rem: GameLoop.getRemaining(), state: GameLoop.getState() }))));

  // during the reload gap (right after bird:dead, before the next nock)
  await waitShotResolved(page, 14000);
  await page.waitForTimeout(300);            // inside the 700ms beat
  const gap = await page.evaluate(() => ({ rem: GameLoop.getRemaining(), bird: !!Slingshot.getBird() }));
  await page.screenshot({ path: 'test/screens/critic-loop-hud-reloadgap.png' });
  console.log('  during reload beat: remaining=' + gap.rem + ' birdNocked=' + gap.bird);

  // 4-bird level HUD
  await page.keyboard.press('4');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test/screens/critic-loop-hud-4birds.png' });
  console.log('  level 4 HUD:', JSON.stringify(await page.evaluate(() => ({ rem: GameLoop.getRemaining(), birds: Structure.level().birds, name: Structure.level().name }))));

  // one bird left (ghosted icons legibility)
  await page.evaluate(() => { for (let i = 0; i < 3; i++) { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test/screens/critic-loop-hud-1left.png', clip: { x: 0, y: 0, width: 420, height: 130 } });
  console.log('  1 bird left HUD clip saved');

  // ---------------------------------------------------------------- dead time
  console.log('\n=== true dead time: last world motion -> next bird ready ===');
  await page.keyboard.press('1');
  await page.waitForTimeout(700);
  await quietProbe(page);

  const shots = [[-105, 30], [-105, 60], [-105, 95], [-70, 100], [-105, 5], [-95, 45]];
  for (const s of shots) {
    await page.evaluate(() => { window.__q.length = 0; window.__ev.length = 0; });
    const stt = await page.evaluate(() => ({ st: GameLoop.getState(), bird: !!Slingshot.getBird() }));
    if (stt.st !== 'playing' || !stt.bird) { await page.keyboard.press('r'); await page.waitForTimeout(800); }
    await dragShot(page, s[0], s[1]);
    await waitShotResolved(page, 14000);
    await page.waitForTimeout(1500);
    const d = await page.evaluate(() => ({ q: window.__q, ev: window.__ev }));
    const L = d.ev.find(e => e.n === 'bird:launched');
    const D = d.ev.find(e => e.n === 'bird:dead');
    const N = D ? d.ev.find(e => e.n === 'bird:loaded' && e.t > D.t) : null;
    if (!L || !D) { console.log(`  pull(${s}): no launch/dead pair`); continue; }
    const seg = d.q.filter(x => x.t >= L.t);
    // "visually over" = last frame where the bird moved >1 px/step or the world moved >0.8
    const lastVisible = seg.filter(x => x.b > 1 || x.w > 0.8).pop();
    const flight = (D.t - L.t) | 0;
    const idleBeforeDead = lastVisible ? (D.t - lastVisible.t) | 0 : null;
    const idleBeforeReady = lastVisible && N ? (N.t - lastVisible.t) | 0 : null;
    console.log(`  pull(${String(s).padEnd(9)}): flight=${String(flight).padStart(4)}ms  timeout=${flight >= 7900}  ` +
      `visuallyOver->dead=${idleBeforeDead}ms  visuallyOver->nextBirdReady=${idleBeforeReady}ms  dead->ready=${N ? (N.t - D.t) | 0 : 'NONE'}ms`);
    const now = await page.evaluate(() => GameLoop.getState());
    if (now !== 'playing') { await page.keyboard.press('r'); await page.waitForTimeout(800); }
  }

  // ---------------------------------------------------------------- timeout hunt: bird resting on a live stack
  console.log('\n=== 8s-timeout hunt (bird parked on a still-settling stack) ===');
  for (const s of [[-105, 100], [-108, 85], [-60, 105]]) {
    await page.keyboard.press('1'); await page.waitForTimeout(800);
    await page.evaluate(() => { window.__q.length = 0; window.__ev.length = 0; });
    await dragShot(page, s[0], s[1]);
    const resolved = await waitShotResolved(page, 13000);
    const d = await page.evaluate(() => ({ q: window.__q, ev: window.__ev }));
    const L = d.ev.find(e => e.n === 'bird:launched');
    const D = d.ev.find(e => e.n === 'bird:dead');
    console.log(`  pull(${s}): resolved=${resolved} flight=${L && D ? (D.t - L.t) | 0 : 'n/a'}ms timeout=${L && D ? (D.t - L.t) >= 7900 : '?'}`);
  }

  console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
  await browser.close();
})();
