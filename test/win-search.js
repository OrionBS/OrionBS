// Search for a winning shot sequence — proves the level is beatable.
const { launch, dragShot, waitShotResolved } = require('./helpers');

(async () => {
  const { browser, page } = await launch();

  // Candidate 3-shot plans: [dx, dy] pulls (negative dx = pull left => shoot right)
  const plans = [
    [[-105, 30], [-105, 30], [-105, 30]],   // flat shots at the first story
    [[-105, 75], [-105, 40], [-105, 25]],   // arc onto roof, then flatten
    [[-105, 15], [-105, 15], [-105, 15]],   // very flat, punch through columns
    [[-90, 100], [-105, 20], [-105, 20]],   // steep drop on roof, then flat
  ];

  for (const [pi, plan] of plans.entries()) {
    await page.evaluate(() => { GameLoop.getState() !== 'playing' && 0; });
    // fresh level
    await page.keyboard.press('r');
    await page.waitForTimeout(600);
    let won = false;
    for (const [dx, dy] of plan) {
      const st = await page.evaluate(() => GameLoop.getState());
      if (st !== 'playing') break;
      const hasBird = await page.evaluate(() => !!Slingshot.getBird());
      if (!hasBird) await page.waitForTimeout(1000);
      await dragShot(page, dx, dy);
      await waitShotResolved(page);
      await page.waitForTimeout(300);
      const dead = await page.evaluate(() => !Structure.enemyAlive());
      if (dead) { won = true; break; }
      await page.waitForTimeout(1100);
    }
    console.log(`plan ${pi}: ${won ? 'WIN' : 'no win'}`);
    if (won) {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: 'test/screens/win-overlay.png' });
      console.log('state:', await page.evaluate(() => GameLoop.getState()));
      break;
    }
  }
  await browser.close();
})();
