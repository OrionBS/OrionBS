// critic-sling-feel.js — deeper feel probes:
//  A) preview-vs-actual with CORRECT step alignment (+ preview as the player saw it)
//  B) release teleport: bird visual pos at mouseup vs actual launch pos
//  C) sustained-drag lag at several pointer speeds
//  D) dynamic range: pull magnitude / angle sweep -> where the shot lands
//  E) time-of-flight to the structure
const { launch } = require('./helpers');

const AX = 220, AY = 505;

async function instrument(page) {
  await page.evaluate(() => {
    if (window.__fi) return;
    window.__fi = true;
    window.__rec = null;
    // capture the preview the player is *seeing* at the moment of mouseup
    window.__seenPreview = null;
    window.__visualAtUp = null;
    Game.updaters.push(() => {
      if (window.__rec && !window.__rec.done) {
        const b = Slingshot.getBird();
        if (!b || b.isStatic) { window.__rec.done = true; return; }
        window.__rec.actual.push({ x: b.position.x, y: b.position.y, s: b.speed });
      }
    });
    Matter.Events.on(Game.engine, 'collisionStart', (ev) => {
      if (!window.__rec || window.__rec.collStep !== null) return;
      for (const p of ev.pairs) {
        if (p.bodyA.label === 'bird' || p.bodyB.label === 'bird') {
          window.__rec.collStep = window.__rec.actual.length;
          window.__rec.collWith = (p.bodyA.label === 'bird' ? p.bodyB : p.bodyA).label;
          return;
        }
      }
    });
    Game.events.on('bird:launched', (d) => {
      window.__rec = {
        pred: Slingshot._lastLaunchPrediction.map(p => ({ x: p.x, y: p.y })),
        vel: d.velocity,
        launchPos: { x: d.bird.position.x, y: d.bird.position.y },
        actual: [], collStep: null, collWith: null, done: false,
      };
    });
    Game.events.on('bird:dead', () => { if (window.__rec) window.__rec.done = true; });
  });
}

async function nock(page) {
  await page.evaluate(() => {
    const b = Slingshot.getBird();
    if (!b || !b.isStatic) Slingshot.loadBird();
  });
  await page.waitForTimeout(120);
}

// Drag with a settle time, snapshot what the player sees, then release.
async function shoot(page, dx, dy, settleMs, steps = 10) {
  await nock(page);
  const s = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(s.x + dx * i / steps, s.y + dy * i / steps);
    await page.waitForTimeout(16);
  }
  if (settleMs) await page.waitForTimeout(settleMs);
  // what is on screen right now (bird visual position; preview from module state)
  const seen = await page.evaluate(() => {
    const b = Slingshot.getBird();
    return { bird: { x: b.position.x, y: b.position.y } };
  });
  await page.mouse.up();
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    if (await page.evaluate(() => window.__rec && window.__rec.done)) break;
    await page.waitForTimeout(120);
  }
  const rec = await page.evaluate(() => window.__rec);
  return { rec, seen };
}

function analyze(label, rec, seen, pull) {
  if (!rec) { console.log(label, 'NO LAUNCH'); return null; }
  // ALIGNED comparison: actual[0] is the pre-step launch position; pred[i] is the
  // position after i+1 steps => compare pred[i] with actual[i+1].
  const limit = Math.min(rec.collStep === null ? 1e9 : rec.collStep, rec.pred.length, rec.actual.length - 1);
  let maxDev = 0, sum = 0, n = 0;
  for (let i = 0; i < limit; i++) {
    const d = Math.hypot(rec.pred[i].x - rec.actual[i + 1].x, rec.pred[i].y - rec.actual[i + 1].y);
    maxDev = Math.max(maxDev, d); sum += d; n++;
  }
  const sp = Math.hypot(rec.vel.x, rec.vel.y);
  let apexY = 1e9, maxX = 0, peak = 0;
  for (const a of rec.actual) { apexY = Math.min(apexY, a.y); maxX = Math.max(maxX, a.x); peak = Math.max(peak, a.s); }
  let t900 = null;
  for (let i = 0; i < rec.actual.length; i++) if (rec.actual[i].x >= 900) { t900 = i / 60; break; }
  const teleport = Math.hypot(seen.bird.x - rec.launchPos.x, seen.bird.y - rec.launchPos.y);
  console.log(`${label} pull=${pull}`);
  console.log(`  |v|=${sp.toFixed(2)} px/step (${(sp * 60).toFixed(0)} px/s)  peak ${(peak * 60).toFixed(0)} px/s`);
  console.log(`  ALIGNED preview dev over ${n} steps: max ${maxDev.toFixed(2)}px  mean ${(sum / Math.max(1, n)).toFixed(2)}px`);
  console.log(`  release teleport (drawn bird -> launch point): ${teleport.toFixed(2)}px`);
  console.log(`  first contact: '${rec.collWith}' at step ${rec.collStep} (${rec.collStep === null ? 'n/a' : (rec.collStep / 60).toFixed(2)}s)  maxX=${maxX.toFixed(0)}  apexY=${apexY.toFixed(0)}`);
  console.log(`  time to x=900: ${t900 === null ? 'NEVER REACHED' : t900.toFixed(2) + 's'}   preview pts=${rec.pred.length} (cap 90) covering ${(rec.pred.length / 60).toFixed(2)}s`);
  return { maxDev, mean: sum / Math.max(1, n), t900, maxX, teleport };
}

(async () => {
  const { browser, page, errors } = await launch();
  await instrument(page);

  console.log('=== A/E: five different pulls, aligned preview check ===');
  const shots = [
    ['FLAT FULL   ', -110, 0],
    ['45deg FULL  ', -78, -78],   // pull down-left? no: dy positive pulls down
  ];
  // pull vectors: negative dx = pull left (shoot right); positive dy = pull down (shoot up)
  const list = [
    ['FLAT FULL  ', -110, 0],
    ['45deg FULL ', -78, 78],
    ['STEEP LOB  ', -35, 104],
    ['WEAK 45    ', -42, 42],
    ['MED 45     ', -60, 60],
    ['SHALLOW 25 ', -100, 46],
  ];
  for (const [label, dx, dy] of list) {
    const { rec, seen } = await shoot(page, dx, dy, 250);
    analyze(label, rec, seen, `(${dx},${dy}) |${Math.hypot(dx, dy).toFixed(0)}|`);
    await page.waitForTimeout(400);
    // reset the level every 3 shots so attempts never run out
    await page.evaluate(() => Game.events.emit('level:reset', {}));
    await page.waitForTimeout(250);
  }

  console.log('\n=== B: release teleport with NO settle (fast pull + instant release) ===');
  for (const settle of [0, 33, 100, 250]) {
    await page.evaluate(() => Game.events.emit('level:reset', {}));
    await page.waitForTimeout(250);
    const { rec, seen } = await shoot(page, -100, 60, settle, 3); // 3 coarse moves = fast drag
    if (rec) {
      console.log(`  settle=${settle}ms: drawn bird at (${seen.bird.x.toFixed(1)},${seen.bird.y.toFixed(1)}) launched from (${rec.launchPos.x.toFixed(1)},${rec.launchPos.y.toFixed(1)}) => TELEPORT ${Math.hypot(seen.bird.x - rec.launchPos.x, seen.bird.y - rec.launchPos.y).toFixed(1)}px`);
    }
    await page.waitForTimeout(300);
  }

  console.log('\n=== C: sustained-drag lag at several pointer speeds ===');
  await page.evaluate(() => Game.events.emit('level:reset', {}));
  await page.waitForTimeout(300);
  for (const pxPerMove of [6, 15, 30]) {
    await nock(page);
    const s = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    // sweep the pointer around the clamp circle at constant angular speed
    const lags = [];
    let ang = 0;
    const R = 105;
    const stepAng = pxPerMove / R;
    for (let i = 0; i < 30; i++) {
      ang += stepAng;
      const px = AX - Math.cos(ang * 0.9) * R, py = AY + Math.sin(ang * 0.9) * R;
      await page.mouse.move(px, py);
      await page.waitForTimeout(16);
      const b = await page.evaluate(() => { const b = Slingshot.getBird(); return { x: b.position.x, y: b.position.y }; });
      // clamp the pointer the same way the module does
      const dx = px - AX, dy = py - AY, d = Math.hypot(dx, dy);
      const t = d <= 110 ? { x: px, y: py } : { x: AX + dx * 110 / d, y: AY + dy * 110 / d };
      if (i > 5) lags.push(Math.hypot(b.x - t.x, b.y - t.y));
    }
    lags.sort((a, b) => a - b);
    const mean = lags.reduce((a, b) => a + b, 0) / lags.length;
    console.log(`  pointer ~${pxPerMove}px/move: bird trails clamped pointer by mean ${mean.toFixed(1)}px, p90 ${lags[Math.floor(lags.length * 0.9)].toFixed(1)}px, max ${lags[lags.length - 1].toFixed(1)}px`);
    await page.mouse.move(AX - 2, AY);
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }

  console.log('\n=== D: dynamic range — pull magnitude x angle -> landing / reach x ===');
  const sweep = await page.evaluate(() => {
    const out = [];
    const K = 0.14, VMAX = 16, AX = 220, AY = 505;
    for (const pull of [20, 40, 60, 80, 95, 110]) {
      for (const deg of [0, 15, 30, 45, 60, 75]) {
        const a = deg * Math.PI / 180;
        // pull vector points down-left; launch dir is up-right
        const pos = { x: AX - Math.cos(a) * pull, y: AY + Math.sin(a) * pull };
        const dx = AX - pos.x, dy = AY - pos.y, d = Math.hypot(dx, dy);
        const sp = Math.min(K * d, VMAX);
        const vel = { x: dx / d * sp, y: dy / d * sp };
        const pts = Slingshot._predict(vel, pos, 400);
        const last = pts[pts.length - 1];
        out.push({ pull, deg, speed: sp, landX: last.x, steps: pts.length });
      }
    }
    return out;
  });
  const byPull = {};
  for (const r of sweep) { (byPull[r.pull] = byPull[r.pull] || []).push(r); }
  console.log('  pull | speed px/s | landing x by launch angle (0/15/30/45/60/75 deg)   [structure = 880..1080]');
  for (const p of Object.keys(byPull)) {
    const rows = byPull[p];
    console.log(`   ${String(p).padStart(3)} | ${String(Math.round(rows[0].speed * 60)).padStart(9)} | ` +
      rows.map(r => Math.round(r.landX).toString().padStart(5)).join(' '));
  }
  const reach = sweep.filter(r => r.landX >= 880);
  console.log(`  pull/angle combos (of ${sweep.length}) whose flight reaches x>=880: ${reach.length} -> ` +
    reach.map(r => `${r.pull}px@${r.deg}deg`).join(', '));
  const minPull = Math.min(...reach.map(r => r.pull));
  console.log(`  MIN pull that can reach the structure at ANY angle: ${minPull}px of ${110} (=${(minPull / 110 * 100).toFixed(0)}% of the range is dead)`);

  console.log('\nPAGE ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
