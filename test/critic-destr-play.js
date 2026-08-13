// critic-destr-play.js — deep play harness for the destruction mechanic.
// Records per-collision energy + HP deltas, samples the world at 30ms for
// collapse/settle/jitter/sleep-in-air/overlap, counts debris & particles,
// and samples the screenshake transform. Numeric-first; few screenshots.
const { launch, dragShot, waitShotResolved } = require('./helpers');
const fs = require('fs');
const SCREENS = __dirname + '/screens';
if (!fs.existsSync(SCREENS)) fs.mkdirSync(SCREENS, { recursive: true });

async function instrument(page) {
  await page.evaluate(() => {
    if (!window.__critHooked) {
      window.__critHooked = true;
      window.__cols = [];
      window.__samples = [];
      window.__ev = [];
      window.__sampling = false;
      window.__t0 = 0;

      const E = (pair) => {
        const a = pair.bodyA, b = pair.bodyB;
        if (a.isSensor || b.isSensor) return 0;
        if (a.isStatic && b.isStatic) return 0;
        const n = pair.collision.normal;
        const rvx = a.velocity.x - b.velocity.x, rvy = a.velocity.y - b.velocity.y;
        const vn = Math.abs(rvx * n.x + rvy * n.y);
        let red;
        if (a.isStatic) red = b.mass; else if (b.isStatic) red = a.mass;
        else red = (a.mass * b.mass) / (a.mass + b.mass);
        return 0.5 * red * vn * vn;
      };

      // registered AFTER Structure's handler => HP already applied when we read it
      Matter.Events.on(Game.engine, 'collisionStart', (ev) => {
        if (!window.__sampling) return;
        for (const pair of ev.pairs) {
          const e = E(pair);
          if (e < 0.5) continue;
          const d = Structure._debug();
          window.__cols.push({
            t: Math.round(performance.now() - window.__t0),
            a: pair.bodyA.label, b: pair.bodyB.label,
            e: +e.toFixed(1),
            sa: +pair.bodyA.speed.toFixed(2), sb: +pair.bodyB.speed.toFixed(2),
            hp: d.blocks.map(x => x.mat[0] + Math.round(x.hp)).join(' '),
            ehp: d.enemy ? +d.enemy.hp.toFixed(1) : null,
          });
        }
      });

      Game.events.on('impact', d => window.__sampling && window.__ev.push(
        { t: Math.round(performance.now() - window.__t0), type: 'impact', e: +d.energy.toFixed(1), x: Math.round(d.x), y: Math.round(d.y) }));
      Game.events.on('enemy:killed', () => window.__sampling && window.__ev.push(
        { t: Math.round(performance.now() - window.__t0), type: 'enemy:killed' }));
      Game.events.on('bird:launched', d => window.__sampling && window.__ev.push(
        { t: Math.round(performance.now() - window.__t0), type: 'launch', vx: +d.velocity.x.toFixed(2), vy: +d.velocity.y.toFixed(2) }));

      setInterval(() => {
        if (!window.__sampling) return;
        const bodies = Matter.Composite.allBodies(Game.world);
        const dyn = bodies.filter(b => !b.isStatic);
        let awake = 0, asleep = 0, maxSpeed = 0, sleepAir = 0, overlaps = 0, belowGround = 0;
        const sleepAirList = [];
        for (const b of dyn) {
          if (b.isSleeping) asleep++; else { awake++; maxSpeed = Math.max(maxSpeed, b.speed); }
          if (b.bounds.min.y > Game.GROUND_Y + 2) belowGround++;
          if (b.isSleeping) {
            // supported? something under the bottom edge within 6px with x overlap
            const bot = b.bounds.max.y;
            if (bot < Game.GROUND_Y - 4) {
              let supported = false;
              for (const o of bodies) {
                if (o === b) continue;
                if (o.bounds.max.x < b.bounds.min.x - 1 || o.bounds.min.x > b.bounds.max.x + 1) continue;
                if (o.bounds.min.y >= bot - 6 && o.bounds.min.y <= bot + 8) { supported = true; break; }
              }
              if (!supported) { sleepAir++; sleepAirList.push({ l: b.label, x: Math.round(b.position.x), y: Math.round(b.position.y) }); }
            }
          }
        }
        // AABB interpenetration between dynamic bodies (both axes > 4px)
        for (let i = 0; i < dyn.length; i++) for (let j = i + 1; j < dyn.length; j++) {
          const A = dyn[i].bounds, B = dyn[j].bounds;
          const ox = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x);
          const oy = Math.min(A.max.y, B.max.y) - Math.max(A.min.y, B.min.y);
          if (ox > 4 && oy > 4) overlaps++;
        }
        const d = Structure._debug();
        window.__samples.push({
          t: Math.round(performance.now() - window.__t0),
          blocks: d.blocks.length, debris: d.debris, particles: d.particles,
          awake, asleep, maxSpeed: +maxSpeed.toFixed(2), sleepAir, sleepAirList, overlaps, belowGround,
          shake: Game.canvas.style.transform || '',
          enemy: d.enemy ? +d.enemy.hp.toFixed(1) : null,
        });
      }, 30);
    }
    window.__cols = []; window.__samples = []; window.__ev = [];
    window.__t0 = performance.now();
    window.__sampling = true;
  });
}

async function collect(page) {
  return page.evaluate(() => {
    window.__sampling = false;
    return { cols: window.__cols, samples: window.__samples, ev: window.__ev, dbg: Structure._debug() };
  });
}

function shakeMag(s) {
  const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\)/.exec(s || '');
  return m ? Math.hypot(+m[1], +m[2]) : 0;
}

function summarize(label, r, extra) {
  const S = r.samples;
  const impacts = r.ev.filter(e => e.type === 'impact');
  const firstImpactT = r.cols.length ? r.cols[0].t : null;
  // settle: last sample time where maxSpeed > 0.35
  let settleT = null;
  for (let i = S.length - 1; i >= 0; i--) { if (S[i].maxSpeed > 0.35) { settleT = S[i].t; break; } }
  const maxShake = Math.max(0, ...S.map(s => shakeMag(s.shake)));
  const shakeFrames = S.filter(s => shakeMag(s.shake) > 0.15).length;
  console.log(`\n===== ${label} ${extra || ''} =====`);
  console.log('launch:', JSON.stringify(r.ev.find(e => e.type === 'launch')));
  console.log('collisions (e>=0.5):');
  for (const c of r.cols.slice(0, 22)) {
    console.log(`   t=${c.t} ${c.a}/${c.b} E=${c.e} spd=${Math.max(c.sa, c.sb)} | hp[${c.hp}] enemy=${c.ehp}`);
  }
  if (r.cols.length > 22) console.log(`   ... +${r.cols.length - 22} more`);
  console.log(`impacts(shake) emitted: ${impacts.length} energies=${JSON.stringify(impacts.map(i => i.e))}`);
  console.log(`maxShakePx=${maxShake.toFixed(2)} shakeFrames=${shakeFrames} (~${(shakeFrames * 30)}ms)`);
  console.log(`peak debris=${Math.max(0, ...S.map(s => s.debris))} peak particles=${Math.max(0, ...S.map(s => s.particles))}`);
  console.log(`blocks left=${r.dbg.blocks.length} hp=[${r.dbg.blocks.map(b => b.mat[0] + Math.round(b.hp)).join(' ')}] enemy=${r.dbg.enemy ? 'alive hp=' + r.dbg.enemy.hp.toFixed(1) : 'DEAD'}`);
  console.log(`firstImpact t=${firstImpactT}ms, motion stops t=${settleT}ms => settle after impact = ${(settleT !== null && firstImpactT !== null) ? settleT - firstImpactT : '?'}ms`);
  const maxSleepAir = Math.max(0, ...S.map(s => s.sleepAir));
  const badSample = S.find(s => s.sleepAir === maxSleepAir && maxSleepAir > 0);
  console.log(`max sleeping-in-air=${maxSleepAir}`, badSample ? JSON.stringify(badSample.sleepAirList) : '');
  console.log(`max overlaps(>4px both axes)=${Math.max(0, ...S.map(s => s.overlaps))} belowGround=${Math.max(0, ...S.map(s => s.belowGround))}`);
  // late jitter: speeds in the last 800ms
  const lastT = S.length ? S[S.length - 1].t : 0;
  const late = S.filter(s => s.t > lastT - 800);
  console.log(`late-window maxSpeed=${Math.max(0, ...late.map(s => s.maxSpeed)).toFixed(2)} awake=${late.length ? late[late.length - 1].awake : '?'} asleep=${late.length ? late[late.length - 1].asleep : '?'}`);
  return { maxShake, settle: (settleT !== null && firstImpactT !== null) ? settleT - firstImpactT : null };
}

async function reset(page) {
  await page.keyboard.press('r');
  await page.waitForTimeout(700);
}

async function shot(page, label, dx, dy, opts = {}) {
  await instrument(page);
  await dragShot(page, dx, dy);
  if (opts.shots) {
    await page.waitForTimeout(opts.shots.delay);
    for (let i = 0; i < opts.shots.n; i++) {
      await page.screenshot({ path: `${SCREENS}/${label}-${String(i).padStart(2, '0')}.png`, clip: { x: 700, y: 300, width: 580, height: 420 } });
      await page.waitForTimeout(opts.shots.gap || 60);
    }
  }
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(opts.tail || 2200);
  const r = await collect(page);
  return summarize(label, r, `drag(${dx},${dy})`);
}

(async () => {
  const { browser, page, errors } = await launch();

  await page.screenshot({ path: SCREENS + '/00-initial.png' });

  // 1. FULL flat max-power shot straight into the left wood column
  await shot(page, 'A-flat-max', -110, 0, { shots: { n: 6, delay: 620, gap: 70 } });
  await reset(page);

  // 2. Known-winning shot
  await shot(page, 'B-win-shot', -105, 30);
  await reset(page);

  // 3. Gentle lob — should bounce off, do almost nothing
  await shot(page, 'C-gentle', -30, 8);
  await reset(page);

  // 4. Medium power flat
  await shot(page, 'D-medium', -60, 12);
  await reset(page);

  // 5. High arc dropping onto the roof
  await shot(page, 'E-lob-roof', -70, 92, { shots: { n: 6, delay: 1000, gap: 80 } });
  await reset(page);

  // 6. Full power steep-ish arc at the second story / stone
  await shot(page, 'F-arc-stone', -95, 55);
  await reset(page);

  // 7. Very weak nudge
  await shot(page, 'G-weak', -18, 4);

  if (errors.length) console.log('\nPAGE ERRORS:', errors);
  await browser.close();
})();
