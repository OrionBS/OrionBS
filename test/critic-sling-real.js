// critic-sling-real.js — aim on the REAL level: preview contrast over the structure,
// where the structure actually sits, and whether a full pull can hit its far side.
const { launch } = require('./helpers');
const fs = require('fs');

(async () => {
  const { browser, page, errors } = await launch();
  await page.waitForFunction(() => window.Slingshot && Slingshot.getBird(), null, { timeout: 15000 });

  const extent = await page.evaluate(() => {
    const bs = Matter.Composite.allBodies(Game.world).filter(b => !/ground|wall|bird/.test(b.label));
    let minX = 1e9, maxX = -1e9, minY = 1e9;
    const list = bs.map(b => {
      minX = Math.min(minX, b.bounds.min.x); maxX = Math.max(maxX, b.bounds.max.x);
      minY = Math.min(minY, b.bounds.min.y);
      return { label: b.label, x: Math.round(b.position.x), y: Math.round(b.position.y) };
    });
    return { minX: Math.round(minX), maxX: Math.round(maxX), topY: Math.round(minY), list };
  });
  console.log('STRUCTURE footprint x', extent.minX, '..', extent.maxX, ' top y', extent.topY);
  console.log('  bodies:', JSON.stringify(extent.list));

  // aim a full 45deg pull and screenshot the whole board with the preview on it
  const s = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(s.x - 6.5 * i, s.y + 6.5 * i); await page.waitForTimeout(16); }
  await page.waitForTimeout(300);
  const png = await page.evaluate(() => Game.canvas.toDataURL('image/png'));
  fs.writeFileSync('test/screens/critic-sling-real-aim.png', Buffer.from(png.split(',')[1], 'base64'));

  // contrast of the preview dots that overlap the structure region
  const dots = await page.evaluate((sx) => {
    const AX = 220, AY = 505, K = 0.14, VMAX = 16;
    const b = Slingshot.getBird();
    const pos = { x: b.position.x, y: b.position.y };
    const dx = AX - pos.x, dy = AY - pos.y, d = Math.hypot(dx, dy);
    const sp = Math.min(K * d, VMAX);
    const pts = Slingshot._predict({ x: dx / d * sp, y: dy / d * sp }, pos, 90);
    const ctx = Game.canvas.getContext('2d');
    const out = [];
    let n = 0; const total = Math.floor(pts.length / 3);
    for (let i = 2; i < pts.length; i += 3) {
      const p = pts[i];
      const f = total > 1 ? n / (total - 1) : 0;
      const px = Math.round(p.x), py = Math.round(p.y);
      if (px > 2 && px < 1277 && py > 16 && py < 716) {
        const c = ctx.getImageData(px, py, 1, 1).data;
        const bg = ctx.getImageData(px, py - 14, 1, 1).data;
        out.push({ x: px, y: py, alpha: +(0.85 * (1 - f * 0.85)).toFixed(2),
          delta: Math.max(Math.abs(c[0] - bg[0]), Math.abs(c[1] - bg[1]), Math.abs(c[2] - bg[2])),
          overStructure: px >= sx });
      }
      n++;
    }
    return out;
  }, extent.minX);
  const over = dots.filter(d => d.overStructure);
  console.log(`preview dots over the structure (x>=${extent.minX}): ${over.length}` +
    (over.length ? ` — deltas ${over.map(d => d.delta).join(',')} (alpha ${over.map(d => d.alpha).join(',')})` : ''));
  console.log('  last dot with delta>25:', (dots.filter(d => d.delta > 25).pop() || {}).x);
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const flight = await page.evaluate(() => Game.canvas.toDataURL('image/png'));
  fs.writeFileSync('test/screens/critic-sling-real-hit.png', Buffer.from(flight.split(',')[1], 'base64'));

  console.log('ERRORS:', errors.filter(e => !/favicon|404/.test(e)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
