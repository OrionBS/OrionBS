// critic-sling-juice.js — release burst screenshots, dead-frame check, edge cases.
const { launch } = require('./helpers');

(async () => {
  const { browser, page, errors } = await launch();

  // Record bird position every physics step around release.
  await page.evaluate(() => {
    window.__pos = [];
    Game.updaters.push(() => {
      const b = Slingshot.getBird();
      window.__pos.push(b ? { x: b.position.x, y: b.position.y, st: b.isStatic } : null);
    });
  });

  const start = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(start.x - 85 * i / 10, start.y + 55 * i / 10); await page.waitForTimeout(16); }
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.__pos = []; window.__tUp = performance.now(); });
  await page.mouse.up();
  // burst screenshots as fast as possible
  for (let i = 0; i < 8; i++) {
    await page.screenshot({ path: `test/screens/critic-sling-release-${i}.png` });
  }
  const pos = await page.evaluate(() => window.__pos);
  // dead frames: how many post-up frames before the bird moves?
  let moved = -1, prev = null;
  for (let i = 0; i < Math.min(pos.length, 12); i++) {
    const p = pos[i];
    if (!p) break;
    if (prev) {
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (d > 1 && moved < 0) moved = i;
    }
    console.log(`  step ${i}: (${p.x.toFixed(1)},${p.y.toFixed(1)}) static=${p.st}`);
    prev = p;
  }
  console.log('DEAD FRAMES: first movement at post-release step', moved, '(1 = instant)');
  await page.waitForTimeout(4000);

  // --- Edge cases -------------------------------------------------------------
  // 1. drag started from empty space
  await page.evaluate(() => { const b = Slingshot.getBird(); if (!b || !b.isStatic) Slingshot.loadBird(); });
  await page.waitForTimeout(100);
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(600, 400);
  await page.waitForTimeout(100);
  const emptyDrag = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.up();
  console.log('EMPTY-SPACE DRAG: bird stayed at', JSON.stringify(emptyDrag), '(expect anchor 220,505)');

  // 2. two rapid drags (release then immediately grab again)
  const b2 = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(b2.x, b2.y);
  await page.mouse.down();
  await page.mouse.move(b2.x - 60, b2.y + 40);
  await page.mouse.up(); // launch 1
  await page.mouse.move(220, 505);
  await page.mouse.down(); // immediate re-grab attempt while bird flying
  await page.mouse.move(150, 560);
  await page.waitForTimeout(100);
  const rapid = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y, static: b.isStatic };
  });
  await page.mouse.up();
  console.log('RAPID RE-GRAB DURING FLIGHT: bird is', JSON.stringify(rapid), '(expect flying, not dragged to 150,560)');
  await page.waitForTimeout(4500);

  // 3. mid-flight drag attempt does not steer the bird (already covered) and
  //    win overlay: force win, then attempt a drag
  await page.evaluate(() => { Game.events.emit('enemy:killed', {}); });
  await page.waitForTimeout(1500);
  const stateBefore = await page.evaluate(() => GameLoop.getState());
  await page.mouse.move(220, 505);
  await page.mouse.down();
  await page.mouse.move(150, 560);
  await page.waitForTimeout(100);
  const afterWinDrag = await page.evaluate(() => ({
    state: GameLoop.getState(),
    bird: (() => { const b = Slingshot.getBird(); return b ? { x: b.position.x, y: b.position.y } : null; })(),
  }));
  await page.mouse.up();
  console.log('DRAG AFTER WIN OVERLAY: state was', stateBefore, '→ after pointerdown:', JSON.stringify(afterWinDrag));
  await page.screenshot({ path: 'test/screens/critic-sling-afterwin.png' });

  console.log('PAGE ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
