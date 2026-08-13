// critic-destr-impacts.js — IMPACT TRUTH test: full flat shot, gentle shot, lob.
// Logs impact energies, block HP deltas, debris/particle counts; bursts screenshots.
const { launch, dragShot, waitShotResolved } = require('./helpers');
const fs = require('fs');

const SCREENS = __dirname + '/screens';
if (!fs.existsSync(SCREENS)) fs.mkdirSync(SCREENS, { recursive: true });

async function instrument(page) {
  await page.evaluate(() => {
    window.__ev = [];
    if (!window.__evHooked) {
      window.__evHooked = true;
      Game.events.on('impact', d => __ev.push({ t: performance.now() | 0, type: 'impact', x: Math.round(d.x), y: Math.round(d.y), energy: +d.energy.toFixed(1) }));
      Game.events.on('enemy:killed', () => __ev.push({ t: performance.now() | 0, type: 'enemy:killed' }));
      Game.events.on('bird:launched', d => __ev.push({ t: performance.now() | 0, type: 'launched', vx: +d.velocity.x.toFixed(2), vy: +d.velocity.y.toFixed(2) }));
    }
  });
}

async function dbg(page) { return page.evaluate(() => Structure._debug()); }

async function burst(page, name, n = 12, gapMs = 40) {
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: `${SCREENS}/${name}-${String(i).padStart(2, '0')}.png`, clip: { x: 640, y: 260, width: 640, height: 460 } });
    await page.waitForTimeout(gapMs);
  }
}

async function shot(page, label, dx, dy, burstDelayMs) {
  await instrument(page);
  const before = await dbg(page);
  const t0 = Date.now();
  await dragShot(page, dx, dy);
  if (burstDelayMs > 0) await page.waitForTimeout(burstDelayMs);
  await burst(page, label);
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(800);
  const after = await dbg(page);
  const ev = await page.evaluate(() => window.__ev);
  const maxParticles = await page.evaluate(() => window.__maxP || 0);
  console.log(`\n=== ${label} (drag ${dx},${dy}) — resolved in ${Date.now() - t0}ms ===`);
  console.log('events:', JSON.stringify(ev));
  console.log('blocks before:', JSON.stringify(before.blocks.map(b => ({ m: b.mat, x: Math.round(b.x), y: Math.round(b.y), hp: +b.hp.toFixed(1) }))));
  console.log('blocks after :', JSON.stringify(after.blocks.map(b => ({ m: b.mat, x: Math.round(b.x), y: Math.round(b.y), hp: +b.hp.toFixed(1) }))));
  console.log('debris:', before.debris, '->', after.debris, '| particles now:', after.particles, '| enemy:', JSON.stringify(after.enemy));
}

(async () => {
  const { browser, page, errors } = await launch();

  // Shot 1: full flat shot into the left column
  await shot(page, 'flat-full', -110, -6, 520);

  // reset level for isolation
  await page.keyboard.press('r');
  await page.waitForTimeout(600);

  // Shot 2: gentle lob (small pull) — should bounce off / do nothing
  await shot(page, 'gentle', -34, 14, 900);

  await page.keyboard.press('r');
  await page.waitForTimeout(600);

  // Shot 3: high arc dropping onto the roof
  await shot(page, 'lob-roof', -68, 88, 900);

  if (errors.length) console.log('\nPAGE ERRORS:', errors);
  await browser.close();
})();
