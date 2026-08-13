// critic-loop-winnable.js — can the live build be won at all?
// Fires real shots and watches enemy:killed / level:cleared + enemiesLeft bookkeeping.
const { launch, dragShot, waitShotResolved } = require('./helpers');

(async () => {
  const { browser, page, errors } = await launch();
  await page.evaluate(() => {
    window.__ev = [];
    ['enemy:killed', 'level:cleared', 'bird:dead', 'bird:launched'].forEach(n =>
      Game.events.on(n, () => window.__ev.push(n)));
  });

  for (let shot = 1; shot <= 3; shot++) {
    await dragShot(page, -105, 30);
    await waitShotResolved(page, 14000);
    await page.waitForTimeout(2500);
    const s = await page.evaluate(() => {
      const bodies = Matter.Composite.allBodies(Game.world);
      const enemyBodies = bodies.filter(b => b.label === 'enemy');
      return {
        state: GameLoop.getState(), rem: GameLoop.getRemaining(),
        enemiesLeft: Structure.enemiesLeft(), enemyAlive: Structure.enemyAlive(),
        enemyBodiesInWorld: enemyBodies.length,
        enemyPos: enemyBodies.map(b => ({ x: b.position.x | 0, y: b.position.y | 0 })),
        events: window.__ev.slice(),
      };
    });
    console.log(`after shot ${shot}: state=${s.state} rem=${s.rem} enemiesLeft=${s.enemiesLeft} ` +
                `enemyAlive=${s.enemyAlive} enemyBodiesStillInWorld=${s.enemyBodiesInWorld} ${JSON.stringify(s.enemyPos)}`);
    console.log('   events so far: ' + s.events.join(', '));
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: 'test/screens/critic-loop-winnable-after3.png' });

  // Is the enemy record marked dead while the body lives on?
  const forensic = await page.evaluate(() => {
    let dbg = null, err = null;
    try { dbg = Structure._debug(); } catch (e) { err = String(e); }
    return { dbg, err, state: GameLoop.getState(), rem: GameLoop.getRemaining() };
  });
  console.log('_debug():', forensic.err ? 'THREW ' + forensic.err : JSON.stringify(forensic.dbg && { enemies: forensic.dbg.enemies, level: forensic.dbg.level }));
  console.log('final state:', forensic.state, 'remaining:', forensic.rem);
  console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
  await browser.close();
})();
