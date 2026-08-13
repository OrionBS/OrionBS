// Verification for js/destruction.js (module Structure).
// Run: node test/destruction-verify.js   (server on :8000 required)
'use strict';
const fs = require('fs');
const path = require('path');
const { launch } = require('./helpers');

const SCREENS = path.join(__dirname, 'screens');
let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

async function snapStructure(page) {
  return page.evaluate(() =>
    Matter.Composite.allBodies(Game.world)
      .filter(b => b.label === 'block' || b.label === 'enemy')
      .map(b => ({ label: b.label, x: b.position.x, y: b.position.y })));
}

function maxDelta(a, b) {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    m = Math.max(m, Math.abs(a[i].x - b[i].x), Math.abs(a[i].y - b[i].y));
  }
  return m;
}

async function bodyCount(page) {
  return page.evaluate(() => Matter.Composite.allBodies(Game.world).length);
}

async function hookEvents(page) {
  await page.evaluate(() => {
    if (!window.__hooked) {
      window.__hooked = true;
      window.__impacts = 0;
      window.__killed = false;
      Game.events.on('impact', () => { window.__impacts++; });
      Game.events.on('enemy:killed', () => { window.__killed = true; });
    }
  });
}

async function fireProjectile(page, x, y, vx, vy) {
  await page.evaluate(([x, y, vx, vy]) => {
    const b = Matter.Bodies.circle(x, y, 22, {
      density: 0.004, friction: 0.6, restitution: 0.2, label: 'testbird',
    });
    Matter.Body.setVelocity(b, { x: vx, y: vy });
    Matter.Composite.add(Game.world, b);
  }, [x, y, vx, vy]);
}

async function removeProjectiles(page) {
  await page.evaluate(() => {
    Matter.Composite.allBodies(Game.world)
      .filter(b => b.label === 'testbird')
      .forEach(b => Matter.Composite.remove(Game.world, b));
  });
}

(async () => {
  fs.mkdirSync(SCREENS, { recursive: true });
  const { browser, page, errors } = await launch(); // waits 500ms after load

  // ---- 1. stability -------------------------------------------------------
  const snap0 = await snapStructure(page);          // t ~= 0.5s
  const count0 = await bodyCount(page);
  await page.waitForTimeout(3000);
  const snap1 = await snapStructure(page);          // t ~= 3.5s
  const drift = maxDelta(snap0, snap1);
  check('stability: 7 structure bodies present', snap0.length === 7, `got ${snap0.length}`);
  check('stability: max drift over 3s < 2px', drift < 2, `drift=${drift.toFixed(3)}px`);
  await page.screenshot({ path: path.join(SCREENS, 'destruction-intact.png') });

  await hookEvents(page);

  // ---- 2. damage shot -----------------------------------------------------
  // Flat fast shot at the second story (stone cube / beam edge).
  await fireProjectile(page, 300, 480, 28, -2);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SCREENS, 'destruction-midcollapse.png') });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(SCREENS, 'destruction-debris.png') });
  const afterHit = await page.evaluate(() => ({
    impacts: window.__impacts,
    dbg: Structure._debug(),
  }));
  const damaged = afterHit.dbg.blocks.some(b => b.hp < b.maxHp) ||
                  afterHit.dbg.blocks.length < 6 || afterHit.dbg.debris > 0;
  check('damage: impact event fired', afterHit.impacts > 0, `impacts=${afterHit.impacts}`);
  check('damage: block damaged or fragmented', damaged,
    `blocks=${afterHit.dbg.blocks.length} debris=${afterHit.dbg.debris} ` +
    `minHp=${Math.min(...afterHit.dbg.blocks.map(b => (b.hp / b.maxHp))).toFixed(2)}`);

  // ---- kill shot ----------------------------------------------------------
  // Clear the spent projectile, then fire point-blank at the enemy's current
  // position so leftover debris can't shield it.
  await removeProjectiles(page);
  const epos = await page.evaluate(() => Structure._debug().enemy);
  if (epos) await fireProjectile(page, epos.x - 46, epos.y - 2, 22, 0);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SCREENS, 'destruction-kill.png') });
  await page.waitForTimeout(800);
  const killState = await page.evaluate(() => ({
    killed: window.__killed, alive: Structure.enemyAlive(),
  }));
  check('kill: enemy:killed emitted', killState.killed === true);
  check('kill: enemyAlive() === false', killState.alive === false);

  // ---- 3. reset + repeat damage/reset twice -------------------------------
  for (let round = 1; round <= 3; round++) {
    await removeProjectiles(page);
    await page.evaluate(() => Game.events.emit('level:reset', {}));
    await page.waitForTimeout(500);
    const countR = await bodyCount(page);
    const snapR = await snapStructure(page);
    const dR = maxDelta(snap0, snapR);
    const aliveR = await page.evaluate(() => Structure.enemyAlive());
    check(`reset ${round}: body count restored`, countR === count0,
      `count=${countR} baseline=${count0}`);
    check(`reset ${round}: positions match baseline < 0.5px`, dR < 0.5,
      `maxDelta=${dR.toFixed(3)}px`);
    check(`reset ${round}: enemyAlive() === true`, aliveR === true);
    if (round < 3) {
      // damage the structure again before the next reset
      await fireProjectile(page, 300, 480, 28, -2);
      await page.waitForTimeout(2000);
    }
  }

  // The bare index.html ships no favicon, so the browser's favicon.ico probe
  // logs a generic resource-404 console error. Filter that environmental noise,
  // but prove no *script* 404'd by asserting every module actually loaded.
  const modulesOk = await page.evaluate(() =>
    !!(window.Matter && window.Game && window.Structure &&
       window.Slingshot && window.GameLoop));
  check('all scripts loaded (no script 404s)', modulesOk);
  const realErrors = errors.filter(e =>
    !/^Failed to load resource: the server responded with a status of 404/.test(e));
  check('zero console/page errors', realErrors.length === 0, realErrors.join(' | '));
  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
