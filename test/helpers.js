// Shared Playwright helpers for playing the prototype headlessly.
// Usage: const { launch, dragShot } = require('./helpers');
const { chromium } = require('playwright-core');

const EXECUTABLE = '/opt/pw-browsers/chromium';
const URL = process.env.GAME_URL || 'http://localhost:8000/index.html';

async function launch() {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(500);
  return { browser, page, errors };
}

// Drag from the bird's current position by (dx, dy) over `steps` moves, then release.
async function dragShot(page, dx, dy, steps = 12) {
  const start = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return b ? { x: b.position.x, y: b.position.y } : null;
  });
  if (!start) throw new Error('no bird loaded');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + (dx * i) / steps, start.y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

// Wait until the current shot resolves (bird:dead / enemy:killed) or timeout.
async function waitShotResolved(page, timeoutMs = 12000) {
  await page.evaluate(() => {
    if (!window.__shotDone) {
      window.__shotDone = false;
      Game.events.on('bird:dead', () => { window.__shotDone = true; });
      Game.events.on('enemy:killed', () => { window.__shotDone = true; });
    }
    window.__shotDone = false;
  });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(() => window.__shotDone)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function worldSnapshot(page) {
  return page.evaluate(() => ({
    bodies: Matter.Composite.allBodies(Game.world).length,
    enemyAlive: typeof Structure !== 'undefined' ? Structure.enemyAlive() : null,
  }));
}

module.exports = { launch, dragShot, waitShotResolved, worldSnapshot, URL };
