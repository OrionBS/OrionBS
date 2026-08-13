// critic-sling-zoom.js — 3x zoomed crops of the sling area for close visual inspection.
const { launch } = require('./helpers');
const fs = require('fs');

async function zoom(page, name, x, y, w, h, scale = 3) {
  const data = await page.evaluate(([x, y, w, h, s]) => {
    const c = document.createElement('canvas');
    c.width = w * s; c.height = h * s;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(Game.canvas, x, y, w, h, 0, 0, w * s, h * s);
    return c.toDataURL('image/png');
  }, [x, y, w, h, scale]);
  fs.writeFileSync(`test/screens/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
}

(async () => {
  const { browser, page, errors } = await launch();
  await page.waitForFunction(() => window.Slingshot && Slingshot.getBird(), null, { timeout: 10000 });

  // idle nocked pose
  await zoom(page, 'critic-sling-zoom-idle', 140, 430, 180, 180);

  // mid pull (55px) and full pull (110px)
  const s = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(s.x - 4.9 * i, s.y + 4.9 * i); await page.waitForTimeout(16); }
  await page.waitForTimeout(200);
  await zoom(page, 'critic-sling-zoom-mid', 100, 430, 200, 200);
  for (let i = 9; i <= 16; i++) { await page.mouse.move(s.x - 4.9 * i, s.y + 4.9 * i); await page.waitForTimeout(16); }
  await page.waitForTimeout(250);
  await zoom(page, 'critic-sling-zoom-full', 100, 430, 200, 200);

  // release: zoomed frames on consecutive rAF ticks
  await page.evaluate(() => {
    window.__z = [];
    window.__cap = 0;
    const f = () => {
      if (window.__cap > 0) {
        const c = document.createElement('canvas');
        c.width = 200 * 3; c.height = 200 * 3;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(Game.canvas, 100, 430, 200, 200, 0, 0, 600, 600);
        window.__z.push(c.toDataURL('image/png'));
        window.__cap--;
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.evaluate(() => { window.__cap = 6; });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const z = await page.evaluate(() => window.__z);
  z.forEach((d, i) => fs.writeFileSync(`test/screens/critic-sling-zoom-rel${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
  console.log('zoom release frames:', z.length);

  console.log('ERRORS:', errors.filter(e => !/favicon|404/.test(e)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
