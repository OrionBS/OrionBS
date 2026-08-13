// critic-sling-edge.js — release latency + edge cases.
const { launch } = require('./helpers');

async function nock(page) {
  await page.evaluate(() => { const b = Slingshot.getBird(); if (!b || !b.isStatic) Slingshot.loadBird(); });
  await page.waitForTimeout(150);
}
async function birdState(page) {
  return page.evaluate(() => {
    const b = Slingshot.getBird();
    return b ? { x: +b.position.x.toFixed(1), y: +b.position.y.toFixed(1), st: b.isStatic, sp: +b.speed.toFixed(2) } : null;
  });
}

(async () => {
  const { browser, page, errors } = await launch();
  await page.waitForFunction(() => window.Slingshot && Slingshot.getBird(), null, { timeout: 10000 });

  // ---- release latency: ms between mouseup and the bird's first movement ----
  await page.evaluate(() => {
    window.__mark = null;
    window.__firstMove = null;
    window.addEventListener('mouseup', () => { window.__mark = performance.now(); }, true);
    let last = null;
    const tick = () => {
      const b = Slingshot.getBird();
      if (b && window.__mark && window.__firstMove === null) {
        if (last && Math.hypot(b.position.x - last.x, b.position.y - last.y) > 0.5) {
          window.__firstMove = performance.now() - window.__mark;
        }
        last = { x: b.position.x, y: b.position.y };
      } else if (b) { last = { x: b.position.x, y: b.position.y }; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  for (let r = 0; r < 3; r++) {
    await nock(page);
    await page.evaluate(() => { window.__mark = null; window.__firstMove = null; });
    const s = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(s.x - 10 * i, s.y + 7 * i); await page.waitForTimeout(16); }
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(120);
    const lat = await page.evaluate(() => window.__firstMove);
    console.log(`RELEASE LATENCY run ${r + 1}: bird first moves ${lat === null ? 'NEVER' : lat.toFixed(1) + ' ms'} after mouseup (one frame = 16.7ms)`);
    await page.waitForTimeout(2500);
  }

  // ---- 1. zero-pull release (mousedown on bird, mouseup without moving) ----
  await nock(page);
  const before = await birdState(page);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(200);
  console.log('ZERO-PULL RELEASE:', JSON.stringify(await birdState(page)), '(expect x=220 y=505 st=true)');

  // ---- 2. sub-MIN_PULL release (8px, under MIN_PULL=10) ----
  await page.mouse.move(220, 505);
  await page.mouse.down();
  await page.mouse.move(214, 510);
  await page.waitForTimeout(100);
  const held = await birdState(page);
  await page.mouse.up();
  await page.waitForTimeout(250);
  console.log('TINY 8px PULL: while held', JSON.stringify(held), '-> after release', JSON.stringify(await birdState(page)));

  // ---- 3. drag from empty space ----
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(600, 420);
  await page.waitForTimeout(120);
  console.log('EMPTY-SPACE DRAG:', JSON.stringify(await birdState(page)), '(expect unchanged at anchor)');
  await page.mouse.up();

  // ---- 4. grab radius probe: how far off the bird can you grab? ----
  const radii = [];
  for (const d of [20, 60, 70, 80, 100, 130]) {
    await nock(page);
    await page.mouse.move(220 + d * 0.7, 505 - d * 0.7); // up-right of the anchor
    await page.mouse.down();
    await page.mouse.move(180, 545);
    await page.waitForTimeout(90);
    const st = await birdState(page);
    const grabbed = Math.hypot(st.x - 220, st.y - 505) > 5;
    radii.push(`${d}px:${grabbed ? 'GRAB' : 'miss'}`);
    await page.mouse.move(220, 505);
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  console.log('GRAB RADIUS PROBE (offset from anchor, up-right):', radii.join('  '), ' [GRAB_R=70]');

  // ---- 5. drag during flight / rapid second drag ----
  await nock(page);
  await page.mouse.move(220, 505);
  await page.mouse.down();
  await page.mouse.move(140, 570);
  await page.waitForTimeout(100);
  await page.mouse.up();          // launch
  await page.waitForTimeout(60);
  const flying = await birdState(page);
  await page.mouse.move(flying.x, flying.y);
  await page.mouse.down();        // try to grab the bird in flight
  await page.mouse.move(400, 300);
  await page.waitForTimeout(100);
  const steered = await birdState(page);
  await page.mouse.up();
  console.log('GRAB DURING FLIGHT: at grab', JSON.stringify(flying), '-> after drag attempt', JSON.stringify(steered), '(expect still flying, not at 400,300)');
  await page.waitForTimeout(3000);

  // ---- 6. mouseup outside the canvas / window ----
  await nock(page);
  await page.mouse.move(220, 505);
  await page.mouse.down();
  await page.mouse.move(120, 600);
  await page.waitForTimeout(80);
  await page.mouse.move(-200, 900);   // pointer leaves the canvas entirely
  await page.waitForTimeout(80);
  const outside = await birdState(page);
  await page.mouse.up();              // release outside
  await page.waitForTimeout(150);
  console.log('DRAG + RELEASE OUTSIDE CANVAS: held at', JSON.stringify(outside), '-> after up', JSON.stringify(await birdState(page)));
  await page.waitForTimeout(3000);

  // ---- 7. two launches back to back (no reload beat in the harness) ----
  await nock(page);
  await page.mouse.move(220, 505); await page.mouse.down();
  await page.mouse.move(150, 560); await page.waitForTimeout(60); await page.mouse.up();
  await page.waitForTimeout(50);
  await nock(page);   // force-load while the previous bird is still flying
  const after = await birdState(page);
  console.log('FORCE-RELOAD MID-FLIGHT:', JSON.stringify(after), '(bird replaced at anchor; previous body removed)');

  console.log('ERRORS:', errors.filter(e => !/favicon|404/.test(e)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
