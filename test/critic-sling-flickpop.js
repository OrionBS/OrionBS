// critic-sling-flickpop.js — release DURING a fast flick: how far does the bird
// visually jump when launch snaps it to the clamped pointer target?
const { launch } = require('./helpers');

(async () => {
  const { browser, page } = await launch();

  const start = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });

  // Slow initial pull to mid, then a violent flick and IMMEDIATE release.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 30, start.y + 20);
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y };
  });
  // flick far in one event then release with no settle time
  await page.mouse.move(start.x - 140, start.y + 90);
  const atFlick = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y };
  });
  await page.mouse.up();
  const after = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return b ? { x: b.position.x, y: b.position.y, v: { x: b.velocity.x, y: b.velocity.y } } : null;
  });
  const jump = Math.hypot(after.x - atFlick.x, after.y - atFlick.y);
  console.log('pos before flick:', JSON.stringify(before));
  console.log('pos at flick (pre-release):', JSON.stringify(atFlick));
  console.log('pos right after release:', JSON.stringify(after));
  console.log(`VISUAL JUMP AT RELEASE: ${jump.toFixed(1)}px (bird snaps from lagging visual pos to clamped pointer)`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
