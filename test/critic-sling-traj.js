// critic-sling-traj.js — preview vs actual flight, speed, crossing time, determinism.
const { launch } = require('./helpers');

async function instrument(page) {
  await page.evaluate(() => {
    window.__rec = null;
    if (!window.__critInit) {
      window.__critInit = true;
      Game.updaters.push(() => {
        if (!window.__rec || window.__rec.done) return;
        const b = Slingshot.getBird();
        if (!b || b.isStatic) { window.__rec.done = true; return; }
        window.__rec.actual.push({ x: b.position.x, y: b.position.y, speed: b.speed });
      });
      Matter.Events.on(Game.engine, 'collisionStart', (ev) => {
        if (!window.__rec || window.__rec.collStep !== null) return;
        for (const pair of ev.pairs) {
          if (pair.bodyA.label === 'bird' || pair.bodyB.label === 'bird') {
            window.__rec.collStep = window.__rec.actual.length;
            const other = pair.bodyA.label === 'bird' ? pair.bodyB : pair.bodyA;
            window.__rec.collWith = other.label;
            return;
          }
        }
      });
      Game.events.on('bird:launched', (d) => {
        window.__rec = {
          pred: Slingshot._lastLaunchPrediction.map(p => ({ x: p.x, y: p.y })),
          vel: d.velocity,
          actual: [],
          collStep: null,
          collWith: null,
          done: false,
        };
      });
      Game.events.on('bird:dead', () => { if (window.__rec) window.__rec.done = true; });
    }
  });
}

async function shoot(page, dx, dy, label) {
  // ensure a nocked bird
  await page.evaluate(() => {
    const b = Slingshot.getBird();
    if (!b || !b.isStatic) Slingshot.loadBird();
  });
  await page.waitForTimeout(100);
  const start = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { x: b.position.x, y: b.position.y };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(start.x + dx * i / 10, start.y + dy * i / 10);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(250); // let elastic settle so visual == target
  await page.mouse.up();
  // wait for shot resolution
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const done = await page.evaluate(() => window.__rec && window.__rec.done);
    if (done) break;
    await page.waitForTimeout(150);
  }
  const rec = await page.evaluate(() => window.__rec);
  if (!rec) { console.log(label, ': NO LAUNCH RECORDED'); return null; }

  // deviation over pre-collision steps
  const nCompare = Math.min(
    rec.collStep === null ? Infinity : rec.collStep,
    rec.pred.length, rec.actual.length);
  let maxDev = 0, sumDev = 0;
  for (let i = 0; i < nCompare; i++) {
    const d = Math.hypot(rec.pred[i].x - rec.actual[i].x, rec.pred[i].y - rec.actual[i].y);
    maxDev = Math.max(maxDev, d);
    sumDev += d;
  }
  const launchSpeed = Math.hypot(rec.vel.x, rec.vel.y);
  let maxSpeed = 0;
  for (const a of rec.actual) maxSpeed = Math.max(maxSpeed, a.speed);
  // time to reach structure zone (x >= 880)
  let crossStep = null;
  for (let i = 0; i < rec.actual.length; i++) {
    if (rec.actual[i].x >= 880) { crossStep = i + 1; break; }
  }
  console.log(`${label}: pull=(${dx},${dy})`);
  console.log(`  launch v=(${rec.vel.x.toFixed(2)},${rec.vel.y.toFixed(2)}) |v|=${launchSpeed.toFixed(2)} px/step = ${(launchSpeed * 60).toFixed(0)} px/s`);
  console.log(`  peak speed ${(maxSpeed * 60).toFixed(0)} px/s; collision after ${rec.collStep} steps with '${rec.collWith}'`);
  console.log(`  preview-vs-actual over ${nCompare} pre-collision steps: max dev ${maxDev.toFixed(2)}px, mean ${(sumDev / Math.max(1, nCompare)).toFixed(2)}px`);
  console.log(`  reached structure x=880 at step ${crossStep} (${crossStep ? (crossStep / 60).toFixed(2) : 'n/a'}s after launch)`);
  return rec;
}

(async () => {
  const { browser, page, errors } = await launch();
  await instrument(page);

  await shoot(page, -110, 0, 'FLAT FULL');
  await page.waitForTimeout(900);
  await shoot(page, -78, 78, '45deg FULL');
  await page.waitForTimeout(900);
  const r1 = await shoot(page, -30, 106, 'STEEP LOB');
  await page.waitForTimeout(900);

  // fresh session for determinism (attempts run out after 3)
  await page.reload(); await page.waitForTimeout(500);
  await instrument(page);
  await shoot(page, -40, 30, 'WEAK PULL');
  await page.waitForTimeout(900);
  const a = await shoot(page, -85, 60, 'STD SHOT #1');
  await page.waitForTimeout(900);
  const b = await shoot(page, -85, 60, 'STD SHOT #2 (repeat)');
  if (a && b) {
    const n = Math.min(a.actual.length, b.actual.length, 40);
    let dmax = 0;
    for (let i = 0; i < n; i++) {
      dmax = Math.max(dmax, Math.hypot(a.actual[i].x - b.actual[i].x, a.actual[i].y - b.actual[i].y));
    }
    console.log(`DETERMINISM: max positional diff over first ${n} steps of repeated pull: ${dmax.toFixed(3)}px`);
    console.log(`  launch v1=(${a.vel.x.toFixed(3)},${a.vel.y.toFixed(3)}) v2=(${b.vel.x.toFixed(3)},${b.vel.y.toFixed(3)})`);
  }

  console.log('PAGE ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
