// Full-cycle integration smoke test: drag → flight → impact → win/lose → reset.
const { launch, dragShot, waitShotResolved, worldSnapshot } = require('./helpers');

(async () => {
  const { browser, page, errors } = await launch();
  const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };

  // Instrument events
  await page.evaluate(() => {
    window.__log = [];
    ['bird:loaded', 'bird:launched', 'bird:dead', 'enemy:killed', 'impact', 'level:reset', 'attempt:spent']
      .forEach(n => Game.events.on(n, d => window.__log.push([n, Date.now()])));
  });

  const base = await worldSnapshot(page);
  console.log('baseline:', JSON.stringify(base));

  // Shot 1: full pull at ~40° toward structure
  await dragShot(page, -105, 70);
  await waitShotResolved(page);
  let snap = await worldSnapshot(page);
  let state = await page.evaluate(() => GameLoop.getState());
  console.log('after shot 1:', JSON.stringify(snap), 'state:', state);

  // Keep shooting until win/lose (max 2 more)
  for (let i = 2; i <= 3; i++) {
    if (state !== 'playing') break;
    await page.waitForTimeout(1200); // reload beat
    const hasBird = await page.evaluate(() => !!Slingshot.getBird());
    if (!hasBird) { fail(`no bird nocked before shot ${i}`); break; }
    await dragShot(page, -105, 55 + i * 8);
    await waitShotResolved(page);
    state = await page.evaluate(() => GameLoop.getState());
    console.log(`after shot ${i}: state ${state}`);
  }

  await page.waitForTimeout(1500);
  state = await page.evaluate(() => GameLoop.getState());
  console.log('final state:', state);
  if (state === 'playing') fail('game did not resolve to win/lose in 3 shots');
  await page.screenshot({ path: 'test/screens/integration-endstate.png' });

  // Restart with R
  await page.keyboard.press('r');
  await page.waitForTimeout(800);
  const after = await worldSnapshot(page);
  const st2 = await page.evaluate(() => ({ state: GameLoop.getState(), rem: GameLoop.getRemaining(), bird: !!Slingshot.getBird() }));
  console.log('after reset:', JSON.stringify(after), JSON.stringify(st2));
  if (st2.state !== 'playing' || st2.rem !== 3 || !st2.bird) fail('reset did not restore playing state');
  if (Math.abs(after.bodies - base.bodies) > 1) fail(`body leak: ${base.bodies} -> ${after.bodies}`);
  if (!after.enemyAlive) fail('enemy not restored after reset');

  const log = await page.evaluate(() => window.__log.map(e => e[0]));
  console.log('events:', log.join(','));
  const realErrors = errors.filter(e => !/favicon/.test(e));
  if (realErrors.length) fail('console errors: ' + realErrors.join(' | '));

  await page.screenshot({ path: 'test/screens/integration-reset.png' });
  console.log(process.exitCode ? 'SMOKE: FAIL' : 'SMOKE: PASS');
  await browser.close();
})();
