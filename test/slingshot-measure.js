// slingshot-measure.js — power/range instrumentation for js/slingshot.js.
//
// Usage: node test/slingshot-measure.js [label]
//
// Reports:
//   1. range envelope for pulls 40..110 (best angle per pull, first ground contact x)
//   2. min pull that reaches x=1180, max range at full pull, usable-pull-range %
//   3. real-drag validation of the computed envelope (a few live shots)
//   4. full-pull time from sling to x=900
//   5. impact energy of a full-pull direct hit on a wood block (level 1 column)
const { launch, dragShot, waitShotResolved } = require('./helpers');

const LABEL = process.argv[2] || 'run';
const GROUND_CONTACT_Y = 640 - 22; // GROUND_Y - BIRD_R
const FAR_EDGE = 1180;
const NEAR_EDGE = 840;

// Read the live tuning constants (test hook) or fall back to the pre-fix values.
async function tuning(page) {
  return page.evaluate(() => {
    const t = (window.Slingshot && Slingshot._tuning) || null;
    return t || { K: 0.14, V_MAX: 16, MAX_PULL: 110, MIN_PULL: 10, ANCHOR: { x: 220, y: 505 }, BIRD_R: 22 };
  });
}

// Simulate one (pull, angle) launch through the game's own predictPath and
// return {range, timeToX900, apex} — range = x where the arc first reaches
// ground-contact height.
async function simulate(page, pull, angleDeg) {
  return page.evaluate(({ pull, angleDeg, GC }) => {
    const t = (window.Slingshot && Slingshot._tuning) ||
      { K: 0.14, V_MAX: 16, MAX_PULL: 110, ANCHOR: { x: 220, y: 505 } };
    const a = (angleDeg * Math.PI) / 180;
    // drag point sits opposite the launch direction
    const origin = { x: t.ANCHOR.x - Math.cos(a) * pull, y: t.ANCHOR.y + Math.sin(a) * pull };
    const speed = Math.min(t.K * pull, t.V_MAX);
    const vel = { x: Math.cos(a) * speed, y: -Math.sin(a) * speed };
    const pts = Slingshot._predict(vel, origin, 600);
    let range = origin.x, tTo900 = null, apex = origin.y;
    let prev = origin;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.y < apex) apex = p.y;
      if (tTo900 === null && p.x >= 900) tTo900 = ((i + 1) / 60);
      if (p.y >= GC) { // crossed ground-contact height between prev and p
        const f = (GC - prev.y) / (p.y - prev.y);
        range = prev.x + (p.x - prev.x) * f;
        break;
      }
      range = p.x;
      prev = p;
    }
    return { range, tTo900, apex, speed };
  }, { pull, angleDeg, GC: GROUND_CONTACT_Y });
}

async function bestForPull(page, pull) {
  let best = { range: -1 };
  for (let ang = 5; ang <= 85; ang++) {
    const r = await simulate(page, pull, ang);
    if (r.range > best.range) best = { range: r.range, angle: ang, speed: r.speed };
  }
  return best;
}

// Live shot: drag `pull` px at `angleDeg` above horizontal (launch direction),
// record the flight, return max x reached in the air + first-ground-contact x.
async function liveShot(page, pull, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  await page.evaluate(() => {
    window.__rec = [];
    window.__launchV = null;
    if (!window.__hooked) {
      window.__hooked = true;
      Game.events.on('bird:launched', d => {
        window.__launchV = { x: d.velocity.x, y: d.velocity.y };
        const b = d.bird;
        window.__watch = b;
        Game.updaters.push(() => {
          if (window.__watch === b) window.__rec.push({ x: b.position.x, y: b.position.y });
        });
      });
      Game.events.on('bird:dead', () => { window.__watch = null; });
    }
  });
  await dragShot(page, -Math.cos(a) * pull, Math.sin(a) * pull, 10);
  await page.waitForTimeout(1800);
  return page.evaluate(GC => {
    const rec = window.__rec;
    let maxX = 0, firstGround = null, tTo900 = null;
    for (let i = 0; i < rec.length; i++) {
      if (rec[i].x > maxX) maxX = rec[i].x;
      if (firstGround === null && rec[i].y >= GC) firstGround = rec[i].x;
      if (tTo900 === null && rec[i].x >= 900) tTo900 = i / 60;
    }
    return { maxX, firstGround, tTo900, v: window.__launchV, n: rec.length };
  }, GROUND_CONTACT_Y);
}

async function main() {
  const { browser, page, errors } = await launch();
  const t = await tuning(page);
  console.log(`\n=== SLINGSHOT MEASUREMENT [${LABEL}] ===`);
  console.log(`tuning: K=${t.K} V_MAX=${t.V_MAX} MAX_PULL=${t.MAX_PULL} MIN_PULL=${t.MIN_PULL}`);

  // ---- 1. range envelope ---------------------------------------------------
  console.log('\n-- range envelope (best angle per pull) --');
  const rows = [];
  for (let pull = 40; pull <= t.MAX_PULL; pull += 10) {
    const b = await bestForPull(page, pull);
    rows.push({ pull, ...b });
    console.log(`  pull ${String(pull).padStart(3)} -> range ${b.range.toFixed(0).padStart(5)}px @${b.angle}deg  (speed ${(b.speed * 60).toFixed(0)} px/s)`);
  }
  if (t.MAX_PULL % 10 !== 0) {
    const b = await bestForPull(page, t.MAX_PULL);
    rows.push({ pull: t.MAX_PULL, ...b });
    console.log(`  pull ${t.MAX_PULL} -> range ${b.range.toFixed(0)}px @${b.angle}deg`);
  }

  // finer sweep for thresholds
  const reach = async (targetX) => {
    for (let pull = t.MIN_PULL; pull <= t.MAX_PULL; pull++) {
      const b = await bestForPull(page, pull);
      if (b.range >= targetX) return { pull, angle: b.angle, range: b.range };
    }
    return null;
  };
  const minFar = await reach(FAR_EDGE);
  const minNear = await reach(NEAR_EDGE);
  const full = await bestForPull(page, t.MAX_PULL);
  const usableLo = minNear ? minNear.pull : t.MAX_PULL;
  const usablePct = ((t.MAX_PULL - usableLo) / (t.MAX_PULL - t.MIN_PULL)) * 100;
  console.log('\n-- thresholds --');
  console.log(`  min pull reaching NEAR edge x=${NEAR_EDGE}: ${minNear ? minNear.pull + ' (@' + minNear.angle + 'deg)' : 'UNREACHABLE'}`);
  console.log(`  min pull reaching FAR  edge x=${FAR_EDGE}: ${minFar ? minFar.pull + ' (@' + minFar.angle + 'deg)' : 'UNREACHABLE'}`);
  console.log(`  max range at full pull: ${full.range.toFixed(0)}px @${full.angle}deg`);
  console.log(`  usable pull range: ${usableLo}..${t.MAX_PULL} of ${t.MIN_PULL}..${t.MAX_PULL} = ${usablePct.toFixed(0)}%`);

  // full-pull 45deg time to x=900
  const flat = await simulate(page, t.MAX_PULL, 45);
  const flat25 = await simulate(page, t.MAX_PULL, 25);
  console.log(`  full pull 45deg: time to x=900 = ${flat.tTo900 ? flat.tTo900.toFixed(2) : 'n/a'}s`);
  console.log(`  full pull 25deg: time to x=900 = ${flat25.tTo900 ? flat25.tTo900.toFixed(2) : 'n/a'}s`);

  // ---- 2. live-shot validation --------------------------------------------
  console.log('\n-- live shots (real drags) --');
  const cases = [
    { pull: 60, angle: 40 },
    { pull: t.MAX_PULL, angle: 43 },
    { pull: t.MAX_PULL, angle: 25 },
  ];
  for (const c of cases) {
    await page.evaluate(() => Game.events.emit('level:reset', {}));
    await page.waitForTimeout(400);
    const sim = await simulate(page, c.pull, c.angle);
    const live = await liveShot(page, c.pull, c.angle);
    console.log(`  pull ${c.pull} @${c.angle}deg: sim range ${sim.range.toFixed(0)} | live maxX ${live.maxX.toFixed(0)}, first-ground x ${live.firstGround === null ? 'n/a (hit structure)' : live.firstGround.toFixed(0)}, t(x=900) ${live.tTo900 === null ? 'n/a' : live.tTo900.toFixed(2) + 's'}, |v| ${live.v ? Math.hypot(live.v.x, live.v.y).toFixed(2) : '?'} px/step`);
    await waitShotResolved(page, 6000);
  }

  // ---- 3. impact energy on wood -------------------------------------------
  console.log('\n-- impact energy, full-pull direct hit on a wood block (level 1) --');
  await page.evaluate(() => { Structure.loadLevel(0); Game.events.emit('level:reset', {}); });
  await page.waitForTimeout(600);
  // instrument: recompute the destruction formula for every bird<->block pair
  await page.evaluate(() => {
    window.__hits = [];
    window.__impacts = [];
    Game.events.on('impact', d => window.__impacts.push(d.energy));
    Matter.Events.on(Game.engine, 'collisionStart', ev => {
      ev.pairs.forEach(pair => {
        const a = pair.bodyA, b = pair.bodyB;
        const isBird = a.label === 'bird' || b.label === 'bird';
        if (!isBird) return;
        const other = a.label === 'bird' ? b : a;
        if (other.label === 'ground' || other.label === 'wall') return;
        const n = pair.collision.normal;
        const rvx = a.velocity.x - b.velocity.x, rvy = a.velocity.y - b.velocity.y;
        const vn = Math.abs(rvx * n.x + rvy * n.y);
        let red;
        if (a.isStatic) red = b.mass; else if (b.isStatic) red = a.mass;
        else red = (a.mass * b.mass) / (a.mass + b.mass);
        window.__hits.push({ label: other.label, x: other.position.x, y: other.position.y, e: 0.5 * red * vn * vn });
      });
    });
  });

  // sweep a few angles, keep the best direct wood hit
  let bestHit = null;
  for (const ang of [10, 14, 18, 22, 26, 30, 34, 38]) {
    await page.evaluate(() => { Game.events.emit('level:reset', {}); window.__hits = []; window.__impacts = []; });
    await page.waitForTimeout(450);
    await liveShot(page, t.MAX_PULL, ang);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ hits: window.__hits, impacts: window.__impacts }));
    const first = r.hits[0];
    const line = `  @${String(ang).padStart(2)}deg: first contact ${first ? first.label + ' at (' + first.x.toFixed(0) + ',' + first.y.toFixed(0) + ') energy ' + first.e.toFixed(1) : 'none'}` +
      `  | max 'impact' event ${r.impacts.length ? Math.max(...r.impacts).toFixed(1) : '-'}`;
    console.log(line);
    if (first && (!bestHit || first.e > bestHit.e)) bestHit = { ...first, angle: ang, maxImpact: r.impacts.length ? Math.max(...r.impacts) : 0 };
    await waitShotResolved(page, 6000);
  }
  if (bestHit) {
    console.log(`\n  >>> [${LABEL}] full-pull direct hit energy on ${bestHit.label}: ${bestHit.e.toFixed(1)} (@${bestHit.angle}deg), max 'impact' event energy ${bestHit.maxImpact.toFixed(1)}`);
  }

  const real = errors.filter(e => !/status of 404/.test(e));
  console.log(`\npage errors: ${real.length ? real.join(' | ') : 'none'}`);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
