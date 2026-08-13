// slingshot-verify.js — builder self-verification for js/slingshot.js
// 1. zero console errors, dragShot(-80,60) flies right+up past x=600, bird:launched fired
// 2. determinism: same drag twice (fresh loads) -> landing x within 5px
// 3. trajectory prediction vs actual flight, first 40 frames, max deviation < 12px
// 4. screenshots mid-drag and mid-flight
const fs = require('fs');
const path = require('path');
const { launch, dragShot, waitShotResolved } = require('./helpers');

const SCREEN_DIR = path.join(__dirname, 'screens');

async function instrument(page) {
  await page.evaluate(() => {
    window.__launched = null;
    window.__deadPos = null;
    window.__rec = [];
    window.__maxX = 0;
    window.__minYAfterLaunch = 1e9;
    Game.events.on('bird:launched', d => {
      window.__launched = { vx: d.velocity.x, vy: d.velocity.y };
      const b = d.bird;
      window.__watched = b;
      Game.updaters.push(() => {
        if (window.__watched === b) {
          window.__rec.push({ x: b.position.x, y: b.position.y });
          if (b.position.x > window.__maxX) window.__maxX = b.position.x;
          if (b.position.y < window.__minYAfterLaunch) window.__minYAfterLaunch = b.position.y;
        }
      });
    });
    Game.events.on('bird:dead', d => {
      window.__deadPos = { x: d.bird.position.x, y: d.bird.position.y };
      window.__watched = null;
    });
  });
}

async function main() {
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
  let failures = 0;
  const check = (name, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!cond) failures++;
  };

  // ---- Test 1: basic flight + events + screenshots -------------------------
  {
    const { browser, page, errors } = await launch();
    await instrument(page);

    // mid-drag screenshot: drag but don't release
    const start = await page.evaluate(() => {
      const b = Slingshot.getBird();
      return { x: b.position.x, y: b.position.y };
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(start.x - (80 * i) / 12, start.y + (60 * i) / 12);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(SCREEN_DIR, 'slingshot-mid-drag.png') });
    await page.mouse.up();

    // mid-flight screenshot
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SCREEN_DIR, 'slingshot-mid-flight.png') });

    const resolved = await waitShotResolved(page);
    const r = await page.evaluate(() => ({
      launched: window.__launched,
      maxX: window.__maxX,
      minY: window.__minYAfterLaunch,
      deadPos: window.__deadPos,
      rec0: window.__rec[0],
    }));
    // index.html ships no favicon link (not editable by this builder); the
    // browser's automatic /favicon.ico probe 404s. helpers.js records only the
    // message text (no URL), so filter the generic resource-404 line; script
    // load success is separately proven by the Slingshot checks below.
    const realErrors = errors.filter(e =>
      !/Failed to load resource: the server responded with a status of 404/.test(e));
    check('zero console/page errors', realErrors.length === 0, realErrors.join(' | '));
    check("'bird:launched' fired", !!r.launched, JSON.stringify(r.launched));
    check('velocity points right+up', r.launched && r.launched.vx > 0 && r.launched.vy < 0,
      r.launched ? `v=(${r.launched.vx.toFixed(2)},${r.launched.vy.toFixed(2)})` : 'no launch');
    check('bird rose above launch point', r.minY < (r.rec0 ? r.rec0.y - 30 : 1e9),
      `minY=${r.minY.toFixed(1)}`);
    check('travelled beyond x=600', r.maxX > 600, `maxX=${r.maxX.toFixed(1)}`);
    check("shot resolved ('bird:dead')", resolved && !!r.deadPos,
      r.deadPos ? `rest=(${r.deadPos.x.toFixed(1)},${r.deadPos.y.toFixed(1)})` : 'timeout');
    await browser.close();
  }

  // ---- Test 2: determinism (two fresh loads, same drag) --------------------
  {
    const landings = [];
    for (let run = 0; run < 2; run++) {
      const { browser, page } = await launch();
      await instrument(page);
      await dragShot(page, -80, 60);
      await waitShotResolved(page);
      const dead = await page.evaluate(() => window.__deadPos);
      landings.push(dead);
      await browser.close();
    }
    const dx = Math.abs(landings[0].x - landings[1].x);
    check('determinism: landing x diff < 5px', dx < 5,
      `x1=${landings[0].x.toFixed(2)} x2=${landings[1].x.toFixed(2)} diff=${dx.toFixed(3)}`);
  }

  // ---- Test 3: trajectory prediction accuracy ------------------------------
  {
    const { browser, page } = await launch();
    await instrument(page);
    await dragShot(page, -80, 60);
    await page.waitForTimeout(1200); // > 40 frames of flight
    const res = await page.evaluate(() => ({
      pred: Slingshot._lastLaunchPrediction,
      rec: window.__rec,
    }));
    // rec[0] is the release position (recorded before the first step),
    // so rec[i+1] should match pred[i].
    let maxDev = 0, n = 0;
    for (let i = 0; i < 40 && i < res.pred.length && i + 1 < res.rec.length; i++) {
      const d = Math.hypot(res.pred[i].x - res.rec[i + 1].x, res.pred[i].y - res.rec[i + 1].y);
      if (d > maxDev) maxDev = d;
      n++;
    }
    check('trajectory: max deviation < 12px over first 40 frames', n >= 39 && maxDev < 12,
      `frames=${n} maxDev=${maxDev.toFixed(3)}px`);
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
