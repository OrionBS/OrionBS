// critic-loop-hud.js — screenshot the HUD at every loop state and check
// remaining-birds consistency.
const { launch, dragShot, waitShotResolved } = require('./helpers');

const HUD = { x: 0, y: 0, width: 300, height: 130 };

(async () => {
  const { browser, page, errors } = await launch();
  const shot = (name, clip) => page.screenshot({ path: `test/screens/critic-loop-hud-${name}.png`, clip });
  const stateInfo = () => page.evaluate(() => ({
    state: GameLoop.getState(), remaining: GameLoop.getRemaining(),
    nocked: (() => { const b = Slingshot.getBird(); return !!(b && b.isStatic); })(),
  }));

  console.log('fresh:', await stateInfo());
  await shot('1-fresh', HUD);

  // mid-drag
  const start = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(start.x - 9 * i, start.y + 4 * i); await page.waitForTimeout(16); }
  await page.waitForTimeout(120);
  console.log('mid-drag:', await stateInfo());
  await shot('2-middrag', HUD);
  await page.mouse.up(); // launches shot 1 (weak-ish left pull 90,40 -> lands short)

  await page.waitForTimeout(400);
  console.log('in-flight after launch 1:', await stateInfo());
  await shot('3-inflight', HUD);

  await waitShotResolved(page, 12000);
  // during the reload beat (bird dead, next not nocked yet)
  await page.waitForTimeout(250);
  console.log('during reload beat:', await stateInfo());
  await shot('4-reloadbeat', HUD);
  await page.waitForTimeout(700);
  console.log('bird 2 nocked:', await stateInfo());
  await shot('5-bird2', HUD);

  // spend bird 2
  await dragShot(page, -45, 25);
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(900);
  console.log('bird 3 nocked:', await stateInfo());
  await shot('6-bird3', HUD);

  // spend bird 3 -> lose
  await dragShot(page, -45, 25);
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(800);
  console.log('lose:', await stateInfo());
  await shot('7-lose-full', undefined); // full frame

  // restart, then win with bird 1 -> HUD under win overlay
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  await dragShot(page, -105, 60);
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(1800);
  console.log('win:', await stateInfo());
  await shot('8-win-full', undefined);

  console.log('pageerrors:', errors);
  await browser.close();
})();
