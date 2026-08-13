// critic-loop-timing.js — measure loop pacing: stop→dead, dead→next-bird-ready,
// kill→overlay reveal, lose→overlay, restart→playable.
const { launch, dragShot, waitShotResolved } = require('./helpers');

async function instrument(page) {
  await page.evaluate(() => {
    window.__log = [];
    ['bird:loaded', 'bird:launched', 'bird:dead', 'enemy:killed', 'level:reset']
      .forEach(n => Game.events.on(n, () => window.__log.push({ n, t: performance.now() })));
    // track last time the flying bird was actually moving (speed >= 0.2)
    window.__lastMoving = 0;
    Game.updaters.push(() => {
      const b = Slingshot.getBird();
      if (b && !b.isStatic && b.speed >= 0.2) window.__lastMoving = performance.now();
    });
    // sample a sky pixel each frame to detect the overlay veil fading in
    window.__veil = [];
    window.__veilOn = false;
    Game.renderers.push((ctx) => {
      if (!window.__veilOn) return;
      const d = ctx.getImageData(640, 120, 1, 1).data;
      window.__veil.push({ t: performance.now(), lum: (d[0] + d[1] + d[2]) / 3 });
    });
  });
}

function evts(log, name) { return log.filter(e => e.n === name); }

(async () => {
  const { browser, page, errors } = await launch();
  await instrument(page);

  // ---------- LOSE RUN: 3 short weak shots ----------
  console.log('=== LOSE RUN (3 weak short shots) ===');
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__log.length = 0; });
  for (let i = 0; i < 3; i++) {
    // wait until a bird is nocked
    for (let w = 0; w < 40; w++) {
      const ready = await page.evaluate(() => { const b = Slingshot.getBird(); return b && b.isStatic; });
      if (ready) break;
      await page.waitForTimeout(100);
    }
    if (i === 2) await page.evaluate(() => { window.__veilOn = true; window.__veil.length = 0; });
    await dragShot(page, -45, 25);
    await waitShotResolved(page, 12000);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1500);
  let log = await page.evaluate(() => window.__log);
  let lastMoving = await page.evaluate(() => window.__lastMoving);
  const deaths = evts(log, 'bird:dead');
  const loads = evts(log, 'bird:loaded');
  const launches = evts(log, 'bird:launched');
  deaths.forEach((d, i) => {
    const nextLoad = loads.find(l => l.t > d.t);
    const launch_ = launches[i];
    console.log(`shot ${i + 1}: flight=${launch_ ? Math.round(d.t - launch_.t) : '?'}ms` +
      (nextLoad ? `  dead->nextBirdReady=${Math.round(nextLoad.t - d.t)}ms` : '  (no reload: run over)'));
  });
  console.log('state:', await page.evaluate(() => GameLoop.getState()),
    'remaining:', await page.evaluate(() => GameLoop.getRemaining()));
  // stop->dead for the last shot
  console.log('last shot: visualStop->bird:dead =',
    Math.round(deaths[2].t - lastMoving), 'ms');
  // lose overlay timing relative to final death
  let veil = await page.evaluate(() => window.__veil);
  const base = veil.length ? veil[0].lum : 0;
  const dStart = veil.find(v => v.lum < base - 4);
  const dFull = veil.find(v => v.lum < base * 0.45);
  console.log(`lose overlay: veilStart=${dStart ? Math.round(dStart.t - deaths[2].t) : '??'}ms after last bird:dead, ` +
    `veilFull=${dFull ? Math.round(dFull.t - deaths[2].t) : '??'}ms`);
  await page.screenshot({ path: 'test/screens/critic-loop-lose-overlay.png' });

  // restart from lose overlay via R: time until bird ready
  await page.evaluate(() => { window.__log.length = 0; });
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  log = await page.evaluate(() => window.__log);
  const rst = evts(log, 'level:reset')[0];
  const ld = evts(log, 'bird:loaded')[0];
  console.log('restart from lose: reset->birdLoaded =', rst && ld ? Math.round(ld.t - rst.t) : '??', 'ms');

  // ---------- WIN RUN: kill with first bird ----------
  console.log('=== WIN RUN (first-bird kill) ===');
  await page.evaluate(() => { window.__log.length = 0; window.__veil.length = 0; window.__veilOn = true; });
  await dragShot(page, -105, 60);
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(2500);
  log = await page.evaluate(() => window.__log);
  veil = await page.evaluate(() => window.__veil);
  const kill = evts(log, 'enemy:killed')[0];
  if (kill) {
    const wBase = veil[0].lum;
    const wStart = veil.find(v => v.t > kill.t && v.lum < wBase - 4);
    const wFull = veil.find(v => v.t > kill.t && v.lum < wBase * 0.45);
    console.log(`win overlay: veilStart=${wStart ? Math.round(wStart.t - kill.t) : '??'}ms after enemy:killed, ` +
      `veilFull=${wFull ? Math.round(wFull.t - kill.t) : '??'}ms`);
    console.log('state:', await page.evaluate(() => GameLoop.getState()),
      'remaining:', await page.evaluate(() => GameLoop.getRemaining()));
    await page.screenshot({ path: 'test/screens/critic-loop-win-overlay-3star.png' });
  } else {
    console.log('KILL SHOT FAILED — no enemy:killed');
  }

  // does a bird:dead arrive after the win, and is it ignored cleanly?
  const lateDead = evts(log, 'bird:dead').filter(e => kill && e.t > kill.t);
  console.log('bird:dead after enemy:killed:', lateDead.length, '(state stayed win:',
    await page.evaluate(() => GameLoop.getState()), ')');

  console.log('pageerrors:', errors);
  await browser.close();
})();
