// critic-sling-devcheck.js — off-by-one corrected preview deviation.
const { launch } = require('./helpers');

(async () => {
  const { browser, page } = await launch();
  await page.evaluate(() => {
    window.__rec = null;
    Game.updaters.push(() => {
      if (!window.__rec || window.__rec.done) return;
      const b = Slingshot.getBird();
      if (!b || b.isStatic) { window.__rec.done = true; return; }
      window.__rec.actual.push({ x: b.position.x, y: b.position.y });
    });
    Game.events.on('bird:launched', () => {
      window.__rec = { pred: Slingshot._lastLaunchPrediction.map(p => ({ x: p.x, y: p.y })), actual: [], done: false };
    });
    Game.events.on('bird:dead', () => { if (window.__rec) window.__rec.done = true; });
  });

  const start = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(start.x - 78 * i / 10, start.y + 78 * i / 10); await page.waitForTimeout(16); }
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const rec = await page.evaluate(() => window.__rec);
  // actual[i] = position after i steps (recorded pre-step), pred[i] = after i+1 steps
  // → compare pred[i] with actual[i+1]
  let maxDev = 0, sum = 0, n = 0;
  for (let i = 0; i + 1 < rec.actual.length && i < rec.pred.length && i < 55; i++) {
    const d = Math.hypot(rec.pred[i].x - rec.actual[i + 1].x, rec.pred[i].y - rec.actual[i + 1].y);
    maxDev = Math.max(maxDev, d); sum += d; n++;
  }
  console.log(`SHIFT-CORRECTED (45deg full, first ${n} steps pre-collision): max dev ${maxDev.toFixed(3)}px, mean ${(sum / n).toFixed(3)}px`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
