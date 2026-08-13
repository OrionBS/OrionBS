// critic-loop-shake.js — screenshake proportionality, decay, rest-state cleanliness,
// plus real-shot pacing (flight time, dead lag, reload beat) and HUD screenshots.
const { launch, dragShot, waitShotResolved } = require('./helpers');

async function watchTransform(page) {
  await page.evaluate(() => {
    window.__tf = [];
    const sample = () => {
      const t = Game.canvas.style.transform || '';
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t);
      window.__tf.push({ t: performance.now(), mag: m ? Math.hypot(+m[1], +m[2]) : 0, raw: t });
      if (window.__tf.length > 12000) window.__tf.shift();
      requestAnimationFrame(sample);
    };
    sample();
  });
}
const tfDump = page => page.evaluate(() => window.__tf.slice());
const tfClear = page => page.evaluate(() => { window.__tf.length = 0; });

(async () => {
  const { browser, page, errors } = await launch();
  await watchTransform(page);

  // ------------------------------------------------ 1. rest state must never shake
  console.log('=== 1. idle / settling frames ===');
  await page.waitForTimeout(2500);
  let tf = await tfDump(page);
  let nonZero = tf.filter(s => s.mag > 0);
  console.log(`idle 2.5s after load: frames=${tf.length} shakingFrames=${nonZero.length} maxMag=${Math.max(0, ...tf.map(s => s.mag)).toFixed(2)}px`);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('r'); await page.waitForTimeout(600); }
  tf = await tfDump(page);
  nonZero = tf.filter(s => s.mag > 0);
  console.log(`incl. 4 resets: shakingFrames=${nonZero.length} maxMag=${Math.max(0, ...tf.map(s => s.mag)).toFixed(2)}px  (must be 0)`);

  // ------------------------------------------------ 2. proportionality
  console.log('\n=== 2. shake magnitude vs impact energy (synthetic) ===');
  for (const e of [10, 40, 60, 80, 120, 200, 400, 1200]) {
    await page.waitForTimeout(900);            // let trauma fully decay
    await tfClear(page);
    await page.evaluate((en) => Game.events.emit('impact', { x: 900, y: 500, energy: en }), e);
    await page.waitForTimeout(900);
    const d = await tfDump(page);
    const peak = Math.max(0, ...d.map(s => s.mag));
    const shaking = d.filter(s => s.mag > 0);
    const dur = shaking.length ? (shaking[shaking.length - 1].t - shaking[0].t) : 0;
    const rested = d[d.length - 1].raw === '';
    console.log(`  energy=${String(e).padStart(4)} peak=${peak.toFixed(2)}px  shakeFrames=${shaking.length}  duration=${dur | 0}ms  transformClearedAtEnd=${rested}`);
  }

  // stacked impacts (two in one frame)
  await page.waitForTimeout(900); await tfClear(page);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) Game.events.emit('impact', { x: 900, y: 500, energy: 200 }); });
  await page.waitForTimeout(1200);
  let d = await tfDump(page);
  console.log(`  5 stacked impacts: peak=${Math.max(0, ...d.map(s => s.mag)).toFixed(2)}px (cap should be 8px), cleared=${d[d.length - 1].raw === ''}`);

  // smoothness of decay: is the envelope monotone?
  const env = d.filter(s => s.mag > 0);
  let regressions = 0;
  const win = [];
  for (let i = 1; i < env.length; i++) win.push(env[i].mag);
  console.log(`  decay envelope: ${env.length} frames, first=${env[0] ? env[0].mag.toFixed(2) : 0} last=${env.length ? env[env.length - 1].mag.toFixed(2) : 0}`);

  // ------------------------------------------------ 3. real shot shake + pacing
  console.log('\n=== 3. real shot: shake + pacing ===');
  await page.keyboard.press('r'); await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__ev = [];
    ['bird:launched', 'bird:dead', 'bird:loaded', 'impact', 'level:cleared'].forEach(n =>
      Game.events.on(n, (dd) => window.__ev.push({ n, t: performance.now(), e: dd && dd.energy })));
    window.__pace = [];
    Game.updaters.push(() => {
      const b = Slingshot.getBird();
      window.__pace.push({ t: performance.now(), sp: b && !b.isStatic ? +b.speed.toFixed(3) : null });
      if (window.__pace.length > 9000) window.__pace.shift();
    });
  });

  for (const shot of [[-105, 30], [-105, 70], [-40, 8]]) {
    await tfClear(page);
    await page.evaluate(() => { window.__ev.length = 0; window.__pace.length = 0; });
    await dragShot(page, shot[0], shot[1]);
    await waitShotResolved(page, 14000);
    await page.waitForTimeout(1400);
    const p = await page.evaluate(() => ({ ev: window.__ev, pace: window.__pace }));
    const L = p.ev.find(e => e.n === 'bird:launched');
    const D = p.ev.find(e => e.n === 'bird:dead');
    const LD = p.ev.find(e => e.n === 'bird:loaded' && D && e.t > D.t);
    const imp = p.ev.filter(e => e.n === 'impact');
    const seg = p.pace.filter(s => L && D && s.t >= L.t && s.t <= D.t && s.sp !== null);
    const lastFast = seg.filter(s => s.sp >= 2).pop();
    const lastCrawl = seg.filter(s => s.sp >= 0.2).pop();
    const tfd = await tfDump(page);
    const peak = Math.max(0, ...tfd.map(s => s.mag));
    console.log(`  pull(${shot}): flight=${L && D ? (D.t - L.t) | 0 : 'n/a'}ms  ` +
      `deadAfterLastRealMotion=${lastFast && D ? (D.t - lastFast.t) | 0 : 'n/a'}ms  ` +
      `deadAfterLastCrawl=${lastCrawl && D ? (D.t - lastCrawl.t) | 0 : 'n/a'}ms  ` +
      `dead->reload=${LD && D ? (LD.t - D.t) | 0 : 'NONE'}ms  ` +
      `impacts=[${imp.map(i => Math.round(i.e)).join(',')}]  shakePeak=${peak.toFixed(2)}px  hitTimeout=${L && D ? (D.t - L.t) >= 7900 : '?'}`);
    const stateNow = await page.evaluate(() => GameLoop.getState());
    if (stateNow !== 'playing') { await page.keyboard.press('r'); await page.waitForTimeout(700); }
  }

  // shake during the settle-down after the collapse (should not re-trigger from resting contacts)
  await page.keyboard.press('r'); await page.waitForTimeout(800);
  await dragShot(page, -105, 30);
  await waitShotResolved(page, 14000);
  await page.waitForTimeout(3000);
  await tfClear(page);
  await page.waitForTimeout(2500);
  d = await tfDump(page);
  console.log(`  3s+ after the collapse: shakingFrames=${d.filter(s => s.mag > 0).length} (must be 0), transform="${d[d.length - 1].raw}"`);

  console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
  await browser.close();
})();
