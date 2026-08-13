// critic-sling-drag.js — measure drag response: latency, clamp, jitter, band attachment.
const { launch } = require('./helpers');
const fs = require('fs');

(async () => {
  const { browser, page, errors } = await launch();

  // Instrument: record bird position + target every physics step while dragging.
  await page.evaluate(() => {
    window.__frames = [];
    Game.updaters.push(() => {
      const b = Slingshot.getBird();
      window.__frames.push({
        t: performance.now(),
        bird: b ? { x: b.position.x, y: b.position.y } : null,
      });
    });
  });

  const start = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y };
  });

  // --- Test 1: fast flick down-left, hold, measure catch-up latency ----------
  await page.evaluate(() => { window.__frames = []; window.__t0 = performance.now(); });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // instant jump (fast flick) to a far point
  const flickTo = { x: start.x - 100, y: start.y + 60 };
  await page.mouse.move(flickTo.x, flickTo.y);
  const tFlick = await page.evaluate(() => performance.now());
  await page.waitForTimeout(400); // let it settle
  const frames1 = await page.evaluate(() => window.__frames);
  // clamped target
  const clamp = (p) => {
    const ax = 220, ay = 505, MAX = 110;
    const dx = p.x - ax, dy = p.y - ay, d = Math.hypot(dx, dy);
    if (d <= MAX) return p;
    return { x: ax + dx * MAX / d, y: ay + dy * MAX / d };
  };
  const target1 = clamp(flickTo);
  let catchupFrames = null;
  let n = 0;
  for (const f of frames1) {
    if (f.t < tFlick || !f.bird) continue;
    n++;
    const d = Math.hypot(f.bird.x - target1.x, f.bird.y - target1.y);
    if (d < 2 && catchupFrames === null) { catchupFrames = n; }
  }
  console.log('FLICK: target', JSON.stringify(target1), 'frames to within 2px:', catchupFrames);
  // print first 10 post-flick distances
  let shown = 0;
  for (const f of frames1) {
    if (f.t < tFlick || !f.bird || shown >= 10) continue;
    shown++;
    console.log(`  frame ${shown}: dist to target = ${Math.hypot(f.bird.x - target1.x, f.bird.y - target1.y).toFixed(1)}px`);
  }

  // --- Test 2: circle drag beyond max radius — check clamp never exceeded ----
  await page.evaluate(() => { window.__frames = []; });
  const ax = 220, ay = 505;
  for (let i = 0; i <= 40; i++) {
    const a = Math.PI * 0.2 + (i / 40) * Math.PI * 1.4;
    // radius 180 > MAX_PULL 110, sweeping circle
    await page.mouse.move(ax + Math.cos(a) * 180, ay + Math.sin(a) * 180);
    await page.waitForTimeout(16);
  }
  const frames2 = await page.evaluate(() => window.__frames);
  let maxR = 0, jitterMax = 0;
  let prev = null, prevD = null;
  for (const f of frames2) {
    if (!f.bird) continue;
    const r = Math.hypot(f.bird.x - ax, f.bird.y - ay);
    maxR = Math.max(maxR, r);
    if (prev) {
      const step = Math.hypot(f.bird.x - prev.x, f.bird.y - prev.y);
      if (prevD !== null) {
        // jitter = reversal magnitude (rough)
      }
      prevD = step;
    }
    prev = f.bird;
  }
  console.log('CIRCLE: max bird radius from anchor =', maxR.toFixed(2), '(clamp is 110)');

  // Screenshot mid-circle drag pose
  await page.mouse.move(ax - 90, ay + 60);
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'test/screens/critic-sling-drag-clamped.png' });

  // --- Test 3: drag past screen edge -----------------------------------------
  await page.mouse.move(-50, 900); // beyond canvas
  await page.waitForTimeout(150);
  const offEdge = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y };
  });
  const rEdge = Math.hypot(offEdge.x - ax, offEdge.y - ay);
  console.log('EDGE DRAG: bird at', JSON.stringify(offEdge), 'radius', rEdge.toFixed(1));
  await page.screenshot({ path: 'test/screens/critic-sling-drag-edge.png' });

  // release with tiny pull: move close to anchor first
  await page.mouse.move(ax - 5, ay + 3);
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterTiny = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y, static: b.isStatic };
  });
  console.log('TINY RELEASE: bird after release:', JSON.stringify(afterTiny), '(expect back at anchor, static)');

  // --- Test 4: grab off the bird (offset 50px) --------------------------------
  const grabbed = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y };
  });
  await page.mouse.move(grabbed.x + 50, grabbed.y - 30); // within GRAB_R=70
  await page.mouse.down();
  await page.mouse.move(grabbed.x - 60, grabbed.y + 40);
  await page.waitForTimeout(150);
  const offGrab = await page.evaluate(() => {
    const s = Slingshot.getBird();
    return { x: s.position.x, y: s.position.y };
  });
  console.log('OFF-BIRD GRAB (offset 50,-30): bird moved to', JSON.stringify(offGrab), '(started', JSON.stringify(grabbed), ')');
  await page.mouse.up();
  await page.waitForTimeout(600);

  // --- Test 5: slow pull with screenshot burst every 50ms ---------------------
  // reload if bird flew
  await page.evaluate(() => { if (!Slingshot.getBird()) Slingshot.loadBird(); });
  await page.waitForTimeout(200);
  const b5 = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(b5.x, b5.y);
  await page.mouse.down();
  // slow pull to 45 deg down-left over 500ms while screenshotting
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(b5.x - i * 8, b5.y + i * 6);
    await page.screenshot({ path: `test/screens/critic-sling-dragburst-${String(i).padStart(2, '0')}.png` });
  }
  const dragState = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y };
  });
  console.log('SLOW PULL: final bird pos', JSON.stringify(dragState));
  await page.mouse.up();

  console.log('PAGE ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
