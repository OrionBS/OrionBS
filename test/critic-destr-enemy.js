// critic-destr-enemy.js — enemy kill feel: direct hit pop, gentle graze, crush,
// and the "punch through the side" strategy viability (rolling hits on column).
const { launch, dragShot, waitShotResolved } = require('./helpers');
const SCREENS = __dirname + '/screens';

async function instrument(page) {
  await page.evaluate(() => {
    window.__ev = [];
    if (!window.__evHooked) {
      window.__evHooked = true;
      Game.events.on('impact', d => __ev.push({ type: 'impact', x: Math.round(d.x), y: Math.round(d.y), energy: +d.energy.toFixed(1) }));
      Game.events.on('enemy:killed', () => { __ev.push({ type: 'enemy:killed', t: performance.now() | 0 }); window.__killT = performance.now(); });
    }
  });
}

(async () => {
  const { browser, page, errors } = await launch();

  // ---------- A: side strategy — repeated flat shots at the left column
  console.log('=== SIDE STRATEGY: 3 flat max shots at the column ===');
  await page.keyboard.press('r');
  await page.waitForTimeout(700);
  await instrument(page);
  for (let i = 0; i < 3; i++) {
    const has = await page.evaluate(() => !!Slingshot.getBird());
    if (!has) { await page.waitForTimeout(1500); }
    await dragShot(page, -108, 20);
    await waitShotResolved(page, 12000);
    await page.waitForTimeout(1400);
    const d = await page.evaluate(() => Structure._debug());
    console.log(`after shot ${i + 1}: blocks=${d.blocks.map(b => b.mat + ':' + b.hp.toFixed(0)).join(',')} debris=${d.debris} enemy=${d.enemy ? 'alive hp=' + d.enemy.hp.toFixed(1) : 'DEAD'}`);
    const st = await page.evaluate(() => (typeof GameLoop.getState === 'function') ? GameLoop.getState() : '?');
    if (st !== 'playing') { console.log('state:', st); break; }
  }
  console.log('side events:', JSON.stringify(await page.evaluate(() => __ev)));
  await page.screenshot({ path: SCREENS + '/side-after3.png', clip: { x: 640, y: 260, width: 640, height: 460 } });

  // ---------- B: open the roof, then direct-hit the enemy; burst the pop
  console.log('\n=== DIRECT KILL after opening roof ===');
  await page.keyboard.press('r');
  await page.waitForTimeout(700);
  await instrument(page);
  await dragShot(page, -88, 70); // opens beam/roof, usually leaves enemy alive
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(1500);
  let d = await page.evaluate(() => Structure._debug());
  console.log('after opener: blocks=', d.blocks.length, 'enemy=', d.enemy ? 'alive' : 'DEAD');
  if (d.enemy) {
    await instrument(page);
    await dragShot(page, -80, 82); // drop into the interior
    await page.waitForTimeout(900);
    for (let i = 0; i < 14; i++) {
      await page.screenshot({ path: `${SCREENS}/kill-${String(i).padStart(2, '0')}.png`, clip: { x: 740, y: 380, width: 460, height: 340 } });
      await page.waitForTimeout(40);
    }
    await waitShotResolved(page, 12000);
    console.log('kill events:', JSON.stringify(await page.evaluate(() => __ev)));
  }

  // ---------- C: gentle graze — tiny lob that taps the enemy after opening
  console.log('\n=== GENTLE GRAZE (should NOT kill) ===');
  await page.keyboard.press('r');
  await page.waitForTimeout(700);
  // cheat the structure open deterministically: remove beam+roof via debug? Not allowed to edit js;
  // instead: place a direct gentle roll along the ground toward enemy — blocked by column, so
  // instead test graze physics on the column-side: measure enemy hp after a slow roller reaches it.
  await instrument(page);
  await dragShot(page, -55, 8); // medium-slow roller, will bump column near enemy
  await waitShotResolved(page, 12000);
  d = await page.evaluate(() => Structure._debug());
  console.log('after roller: enemy=', d.enemy ? 'alive hp=' + d.enemy.hp.toFixed(1) : 'DEAD',
    'events:', JSON.stringify(await page.evaluate(() => __ev.filter(e => e.type !== 'impact' || e.energy > 50))));

  if (errors.length) console.log('PAGE ERRORS:', errors);
  await browser.close();
})();
