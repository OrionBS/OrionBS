// critic-sling-vis.js — preview readability (measured pixel contrast) + release juice frames.
const { launch } = require('./helpers');
const fs = require('fs');

async function grab(page, name) {
  const data = await page.evaluate(() => Game.canvas.toDataURL('image/png'));
  fs.writeFileSync(`test/screens/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
}

(async () => {
  const { browser, page, errors } = await launch();

  // ---- 1. Full 45deg pull: measure the on-screen contrast of every preview dot.
  await page.waitForFunction(() => window.Slingshot && Slingshot.getBird(), null, { timeout: 10000 });
  const s = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x - 7.8 * i, s.y + 7.8 * i); await page.waitForTimeout(16); }
  await page.waitForTimeout(300);
  await grab(page, 'critic-sling-vis-pull45');

  const dots = await page.evaluate(() => {
    // recompute the dot positions exactly like drawPreview does
    const AX = 220, AY = 505, K = 0.14, VMAX = 16;
    const b = Slingshot.getBird();
    const pos = { x: b.position.x, y: b.position.y };
    const dx = AX - pos.x, dy = AY - pos.y, d = Math.hypot(dx, dy);
    const sp = Math.min(K * d, VMAX);
    const pts = Slingshot._predict({ x: dx / d * sp, y: dy / d * sp }, pos, 90);
    const ctx = Game.canvas.getContext('2d');
    const out = [];
    let n = 0;
    const total = Math.floor(pts.length / 3);
    for (let i = 2; i < pts.length; i += 3) {
      const p = pts[i];
      const f = total > 1 ? n / (total - 1) : 0;
      const alpha = 0.85 * (1 - f * 0.85);
      const r = 4.2 - 2.2 * f;
      // sample the dot centre and background 14px above it
      const px = Math.round(p.x), py = Math.round(p.y);
      if (px < 2 || px > 1277 || py < 16 || py > 717) { n++; continue; }
      const c = ctx.getImageData(px, py, 1, 1).data;
      const bg = ctx.getImageData(px, py - 14, 1, 1).data;
      const delta = Math.max(Math.abs(c[0] - bg[0]), Math.abs(c[1] - bg[1]), Math.abs(c[2] - bg[2]));
      out.push({ i, x: Math.round(p.x), y: Math.round(p.y), alpha: +alpha.toFixed(3), r: +r.toFixed(2), delta,
        dot: [c[0], c[1], c[2]], bgc: [bg[0], bg[1], bg[2]] });
      n++;
    }
    return { out, nPts: pts.length, endX: Math.round(pts[pts.length - 1].x) };
  });
  console.log(`PREVIEW at full 45deg pull: ${dots.out.length} dots, path ends at x=${dots.endX} (${dots.nPts} steps)`);
  console.log('  idx |  x    y   | alpha | radius | pixel delta vs bg (0-255)');
  for (let k = 0; k < dots.out.length; k++) {
    const d = dots.out[k];
    if (k % 2 === 0 || k === dots.out.length - 1)
      console.log(`   ${String(k).padStart(2)} | ${String(d.x).padStart(4)} ${String(d.y).padStart(4)} | ${String(d.alpha).padEnd(5)} | ${String(d.r).padEnd(6)} | ${d.delta}  dot=${d.dot} bg=${d.bgc}`);
  }
  const faint = dots.out.filter(d => d.delta <= 12);
  console.log(`  dots with <=12/255 luminance delta (effectively invisible): ${faint.length}/${dots.out.length}` +
    (faint.length ? ` — first faint dot at x=${faint[0].x}` : ''));
  const lastVisible = dots.out.filter(d => d.delta > 25).pop();
  console.log(`  furthest dot with >25/255 delta: x=${lastVisible ? lastVisible.x : 'none'} (structure starts at x~880)`);

  // ---- 2. Release juice: capture canvas at each frame right after mouseup.
  await page.evaluate(() => {
    window.__shots = [];
    window.__cap = 0;
    const grabF = () => {
      if (window.__cap > 0) { window.__shots.push(Game.canvas.toDataURL('image/png')); window.__cap--; }
      requestAnimationFrame(grabF);
    };
    requestAnimationFrame(grabF);
  });
  await page.evaluate(() => { window.__cap = 7; });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const frames = await page.evaluate(() => window.__shots);
  frames.forEach((f, i) => fs.writeFileSync(`test/screens/critic-sling-rel-f${i}.png`, Buffer.from(f.split(',')[1], 'base64')));
  console.log(`RELEASE BURST: captured ${frames.length} consecutive rAF frames -> test/screens/critic-sling-rel-f*.png`);
  await page.waitForTimeout(900);
  await grab(page, 'critic-sling-vis-inflight');

  // ---- 3. Weak / tiny pull look
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const b = Slingshot.getBird(); if (!b || !b.isStatic) Slingshot.loadBird(); });
  await page.waitForTimeout(200);
  const s2 = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(s2.x, s2.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(s2.x - 5 * i, s2.y + 3 * i); await page.waitForTimeout(16); }
  await page.waitForTimeout(250);
  await grab(page, 'critic-sling-vis-weakpull');
  const weak = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y, pull: Math.hypot(b.position.x - 220, b.position.y - 505) };
  });
  console.log(`WEAK PULL pose: bird (${weak.x.toFixed(1)},${weak.y.toFixed(1)}) pull=${weak.pull.toFixed(1)}px`);
  await page.mouse.up();
  await page.waitForTimeout(200);

  // ---- 4. Nocked idle (no pull) — what the player sees before touching anything
  await page.evaluate(() => { const b = Slingshot.getBird(); if (!b || !b.isStatic) Slingshot.loadBird(); });
  await page.waitForTimeout(200);
  await grab(page, 'critic-sling-vis-idle');

  console.log('PAGE ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
