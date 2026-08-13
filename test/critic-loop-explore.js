// critic-loop-explore.js — find shot recipes + baseline event timing.
const { launch, dragShot, waitShotResolved, worldSnapshot } = require('./helpers');

async function instrument(page) {
  await page.evaluate(() => {
    window.__log = [];
    ['bird:loaded', 'bird:launched', 'bird:dead', 'enemy:killed', 'level:reset', 'attempt:spent', 'impact']
      .forEach(n => Game.events.on(n, d => window.__log.push({
        n, t: performance.now(),
        energy: d && d.energy, remaining: d && d.remaining,
      })));
  });
}

(async () => {
  const { launch: _l } = require('./helpers');
  const { browser, page, errors } = await launch();
  await instrument(page);

  const shots = [
    [-105, 15, 'flat full pull'],
    [-105, 30, 'slightly lofted full'],
    [-105, 60, 'medium arc'],
    [-90, 100, 'steep lob'],
    [-105, 45, 'arc 45'],
  ];

  for (const [dx, dy, name] of shots) {
    await page.keyboard.press('r');
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__log.length = 0; });
    const snap0 = await worldSnapshot(page);
    await dragShot(page, dx, dy);
    await waitShotResolved(page, 12000);
    await page.waitForTimeout(2500);
    const dbg = await page.evaluate(() => Structure._debug());
    const log = await page.evaluate(() => window.__log);
    const launched = log.find(e => e.n === 'bird:launched');
    const dead = log.find(e => e.n === 'bird:dead');
    const killed = log.find(e => e.n === 'enemy:killed');
    const impacts = log.filter(e => e.n === 'impact').map(e => Math.round(e.energy));
    console.log(`--- ${name} (${dx},${dy}) bodies@start=${snap0.bodies}`);
    console.log(`   flightMs=${dead && launched ? Math.round(dead.t - launched.t) : 'n/a'}  enemyKilled=${!!killed}${killed && launched ? ' @' + Math.round(killed.t - launched.t) + 'ms' : ''}`);
    console.log(`   impacts=${JSON.stringify(impacts)}  blocksLeft=${dbg.blocks.length}  enemyHp=${dbg.enemy ? Math.round(dbg.enemy.hp) : 'dead'}`);
  }

  console.log('pageerrors:', errors);
  await browser.close();
})();
