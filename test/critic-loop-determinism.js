// critic-loop-determinism.js — does the known-winning shot win on a fresh page,
// and does it still win after 1..N restarts? Also records structure HP fingerprints.
const { launch, dragShot, waitShotResolved, worldSnapshot } = require('./helpers');

const SHOT = { dx: -105, dy: 30 };

async function fingerprint(page) {
  return page.evaluate(() => {
    const dbg = (typeof Structure !== 'undefined' && Structure._debug) ? Structure._debug() : null;
    const bodies = Matter.Composite.allBodies(Game.world).map(b => ({
      l: b.label, x: +b.position.x.toFixed(2), y: +b.position.y.toFixed(2), a: +b.angle.toFixed(4),
    }));
    return { dbg: JSON.stringify(dbg), bodies: JSON.stringify(bodies) };
  });
}

(async () => {
  const { browser, page, errors } = await launch();
  const fps = [];
  fps.push(await fingerprint(page));
  console.log('fresh fingerprint bodies:', fps[0].bodies.slice(0, 260));
  console.log('fresh debug:', fps[0].dbg.slice(0, 400));

  for (let round = 0; round < 4; round++) {
    const before = await fingerprint(page);
    fps.push(before);
    await dragShot(page, SHOT.dx, SHOT.dy);
    await waitShotResolved(page, 14000);
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ s: GameLoop.getState(), r: GameLoop.getRemaining(), alive: Structure.enemyAlive() }));
    console.log(`round ${round}: identicalToFresh=${before.bodies === fps[0].bodies} state=${st.s} remaining=${st.r} enemyAlive=${st.alive}`);
    if (before.bodies !== fps[0].bodies) {
      // show first differing entry
      const a = JSON.parse(fps[0].bodies), b = JSON.parse(before.bodies);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
          console.log('   first diff idx', i, JSON.stringify(a[i]), '->', JSON.stringify(b[i]));
          break;
        }
      }
    }
    await page.keyboard.press('r');
    await page.waitForTimeout(400);
  }

  // Same-shot repeatability on a FRESH page each time (control)
  await browser.close();
  for (let i = 0; i < 2; i++) {
    const s = await launch();
    await dragShot(s.page, SHOT.dx, SHOT.dy);
    await waitShotResolved(s.page, 14000);
    await s.page.waitForTimeout(1500);
    const st = await s.page.evaluate(() => ({ s: GameLoop.getState(), r: GameLoop.getRemaining(), alive: Structure.enemyAlive() }));
    console.log(`fresh-page shot ${i}: state=${st.s} remaining=${st.r} enemyAlive=${st.alive}`);
    await s.browser.close();
  }
  console.log('errors:', errors.length ? errors : 'none');
})();
