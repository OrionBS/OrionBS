// critic-destr-sleepbug.js — hypothesis: once the stack falls asleep, fragmenting
// a support does NOT wake the load above it (Matter only wakes on collision), so
// beams/stones stay frozen in mid-air. Compare removal BEFORE vs AFTER sleep.
const { launch, dragShot, waitShotResolved } = require('./helpers');
const SCREENS = __dirname + '/screens';

const SNAP = `(() => {
  const bs = Matter.Composite.allBodies(Game.world).filter(b => !b.isStatic);
  return bs.map(b => ({ l: b.label, x: Math.round(b.position.x), y: Math.round(b.position.y), sleep: b.isSleeping }));
})()`;

async function reset(page) { await page.keyboard.press('r'); await page.waitForTimeout(600); }

async function yankColumn(page, waitMs, tag) {
  await reset(page);
  await page.waitForTimeout(waitMs);
  const before = await page.evaluate(SNAP);
  const sleeping = before.filter(b => b.sleep).length;
  await page.evaluate(() => {
    for (const b of Matter.Composite.allBodies(Game.world)) {
      if (b.label === 'block' && Math.abs(b.position.x - 900) < 6 && Math.abs(b.position.y - 580) < 6) {
        Matter.Composite.remove(Game.world, b);
      }
    }
  });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(SNAP);
  await page.screenshot({ path: `${SCREENS}/sleepbug-${tag}.png`, clip: { x: 820, y: 400, width: 340, height: 260 } });
  console.log(`\n[${tag}] support removed ${waitMs}ms after reset — ${sleeping}/${before.length} bodies were asleep`);
  console.log('  before:', JSON.stringify(before));
  console.log('  after :', JSON.stringify(after));
  const moved = after.filter((b, i) => before[i] && (Math.abs(b.y - before[i].y) > 3 || Math.abs(b.x - before[i].x) > 3)).length;
  console.log(`  bodies that moved: ${moved}/${before.length}`);
}

(async () => {
  const { browser, page, errors } = await launch();

  await yankColumn(page, 200, 'awake-200ms');
  await yankColumn(page, 3000, 'asleep-3000ms');

  // Same thing through real gameplay: shoot the left column out of a slept stack,
  // then look at what the load above does.
  await reset(page);
  await page.waitForTimeout(3000);
  const sleepState = await page.evaluate(SNAP);
  console.log('\n[real shot] stack sleep state before the shot:', JSON.stringify(sleepState));
  await page.evaluate(() => {
    window.__log = [];
    Game.events.on('impact', d => window.__log.push({ t: performance.now() | 0, e: +d.energy.toFixed(1) }));
  });
  await dragShot(page, -105, 30);
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(4000);
  console.log('[real shot] rest state:', JSON.stringify(await page.evaluate(SNAP)));
  await page.screenshot({ path: SCREENS + '/sleepbug-realshot.png', clip: { x: 780, y: 380, width: 420, height: 300 } });

  // control: do fragments of a *sleeping* neighbour wake it? count awake bodies
  // right after a fragmentation in the same shot
  if (errors.length) console.log('\nPAGE ERRORS:', errors);
  await browser.close();
})();
