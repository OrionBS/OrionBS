// critic-destr-scenarios.js — controlled scenarios:
//  1) enemy damage curve (graze vs solid hit) with synthetic projectiles
//  2) crush test (block dropped on enemy)
//  3) support-knockout collapse: settle time, floating blocks, jitter (+screens)
//  4) strategy variety: 3-bird playthroughs with different plans
const { launch, dragShot, waitShotResolved } = require('./helpers');
const fs = require('fs');
const SCREENS = __dirname + '/screens';
if (!fs.existsSync(SCREENS)) fs.mkdirSync(SCREENS, { recursive: true });

async function reset(page) { await page.keyboard.press('r'); await page.waitForTimeout(700); }

// fire a synthetic bird-like ball at the enemy at a chosen speed
async function probe(page, speed) {
  return page.evaluate(async (sp) => {
    const d0 = Structure._debug();
    if (!d0.enemy) return { err: 'no enemy' };
    const ex = d0.enemy.x, ey = d0.enemy.y;
    const b = Matter.Bodies.circle(ex - 200, ey - 4, 22, {
      density: 0.004, restitution: 0.35, friction: 0.5, frictionAir: 0, label: 'bird',
    });
    Matter.Composite.add(Game.world, b);
    Matter.Body.setVelocity(b, { x: sp, y: 0 });
    const hits = [];
    const h = (ev) => {
      for (const p of ev.pairs) {
        if (p.bodyA !== b && p.bodyB !== b) continue;
        const o = p.bodyA === b ? p.bodyB : p.bodyA;
        const n = p.collision.normal;
        const rvx = p.bodyA.velocity.x - p.bodyB.velocity.x, rvy = p.bodyA.velocity.y - p.bodyB.velocity.y;
        const vn = Math.abs(rvx * n.x + rvy * n.y);
        const red = o.isStatic ? b.mass : b.mass * o.mass / (b.mass + o.mass);
        const dd = Structure._debug();
        hits.push({ other: o.label, e: +(0.5 * red * vn * vn).toFixed(1), ehp: dd.enemy ? +dd.enemy.hp.toFixed(1) : 'DEAD' });
      }
    };
    Matter.Events.on(Game.engine, 'collisionStart', h);
    // keep the projectile flat: cancel gravity on it each tick
    const g = () => { Matter.Body.setVelocity(b, { x: b.velocity.x, y: 0 }); };
    Matter.Events.on(Game.engine, 'beforeUpdate', g);
    await new Promise(r => setTimeout(r, 1200));
    Matter.Events.off(Game.engine, 'collisionStart', h);
    Matter.Events.off(Game.engine, 'beforeUpdate', g);
    Matter.Composite.remove(Game.world, b);
    const d1 = Structure._debug();
    return { hits, enemy: d1.enemy ? +d1.enemy.hp.toFixed(1) : 'DEAD', particles: d1.particles };
  }, speed);
}

(async () => {
  const { browser, page, errors } = await launch();

  // ---------------------------------------------------------------- 1 enemy curve
  console.log('=== ENEMY DAMAGE CURVE (flat projectile, r=22 like the bird) ===');
  for (const sp of [0.5, 1, 2, 3, 5, 8, 14]) {
    await reset(page);
    const r = await probe(page, sp);
    if (!r || !r.hits) { console.log(`  speed ${sp} -> PROBE FAIL ${JSON.stringify(r)}`); continue; }
    console.log(`  speed ${sp} px/step -> allHits=${JSON.stringify(r.hits.slice(0, 4))} enemyHits=${JSON.stringify(r.hits.filter(h => h.other === 'enemy').slice(0, 3))} final enemy=${r.enemy} particles=${r.particles}`);
  }

  // ---------------------------------------------------------------- 2 crush test
  console.log('\n=== CRUSH TEST: stone cube dropped on the enemy from N px ===');
  for (const h of [30, 80, 160]) {
    await reset(page);
    const r = await page.evaluate(async (dropH) => {
      const d0 = Structure._debug();
      const ex = d0.enemy.x, ey = d0.enemy.y;
      const s = Matter.Bodies.rectangle(ex, ey - 20 - dropH, 40, 40, { density: 0.008, friction: 0.9, restitution: 0.01, label: 'block' });
      Matter.Composite.add(Game.world, s);
      await new Promise(r => setTimeout(r, 2000));
      const d1 = Structure._debug();
      Matter.Composite.remove(Game.world, s);
      return { enemy: d1.enemy ? +d1.enemy.hp.toFixed(1) : 'DEAD' };
    }, h);
    console.log(`  drop ${h}px -> enemy ${r.enemy}`);
  }

  // sitting-on-top (no drop): does a resting block slowly grind the enemy to death?
  await reset(page);
  const rest = await page.evaluate(async () => {
    const d0 = Structure._debug();
    const s = Matter.Bodies.rectangle(d0.enemy.x, d0.enemy.y - 21 - 20, 40, 40, { density: 0.008, friction: 0.9, restitution: 0.01, label: 'block' });
    Matter.Composite.add(Game.world, s);
    await new Promise(r => setTimeout(r, 4000));
    const d1 = Structure._debug();
    return { enemy: d1.enemy ? +d1.enemy.hp.toFixed(1) : 'DEAD' };
  });
  console.log(`  resting contact (1px gap, 4s) -> enemy ${rest.enemy}  [must stay alive]`);

  // ---------------------------------------------------------------- 3 collapse
  console.log('\n=== SUPPORT KNOCKOUT COLLAPSE (left column removed instantly) ===');
  await reset(page);
  await page.evaluate(() => {
    window.__cs = [];
    window.__csOn = true;
    const t0 = performance.now();
    const tick = () => {
      const bodies = Matter.Composite.allBodies(Game.world).filter(b => !b.isStatic);
      let maxSpeed = 0, air = 0, asleep = 0;
      const airList = [];
      for (const b of bodies) {
        if (!b.isSleeping) maxSpeed = Math.max(maxSpeed, b.speed); else asleep++;
        if (b.isSleeping) {
          const bot = b.bounds.max.y;
          if (bot < Game.GROUND_Y - 4) {
            let sup = false;
            for (const o of Matter.Composite.allBodies(Game.world)) {
              if (o === b) continue;
              if (o.bounds.max.x < b.bounds.min.x - 1 || o.bounds.min.x > b.bounds.max.x + 1) continue;
              if (o.bounds.min.y >= bot - 6 && o.bounds.min.y <= bot + 8) { sup = true; break; }
            }
            if (!sup) { air++; airList.push({ l: b.label, x: Math.round(b.position.x), y: Math.round(b.position.y), gapToGround: Math.round(Game.GROUND_Y - bot) }); }
          }
        }
      }
      window.__cs.push({ t: Math.round(performance.now() - t0), maxSpeed: +maxSpeed.toFixed(2), air, airList, asleep, n: bodies.length });
      if (window.__csOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // yank the left column out from under the structure
    const bodies = Matter.Composite.allBodies(Game.world);
    for (const b of bodies) if (b.label === 'block' && Math.abs(b.position.x - 900) < 6 && Math.abs(b.position.y - 580) < 6) Matter.Composite.remove(Game.world, b);
  });
  for (let i = 0; i < 8; i++) {
    await page.screenshot({ path: `${SCREENS}/collapse-${String(i).padStart(2, '0')}.png`, clip: { x: 820, y: 400, width: 340, height: 280 } });
    await page.waitForTimeout(110);
  }
  await page.waitForTimeout(5000);
  const cs = await page.evaluate(() => { window.__csOn = false; return window.__cs; });
  let last = null;
  for (let i = cs.length - 1; i >= 0; i--) if (cs[i].maxSpeed > 0.3) { last = cs[i].t; break; }
  console.log(`  motion ends at t=${last}ms after the support vanished (frames=${cs.length})`);
  const airMax = Math.max(...cs.map(s => s.air));
  const airSample = cs.find(s => s.air === airMax && airMax > 0);
  console.log(`  max sleeping-with-no-support=${airMax} ${airSample ? JSON.stringify(airSample.airList) : ''}`);
  const lateFrames = cs.filter(s => s.t > last + 200);
  console.log(`  post-settle maxSpeed=${Math.max(0, ...lateFrames.map(s => s.maxSpeed)).toFixed(3)} (jitter check)`);
  await page.screenshot({ path: SCREENS + '/collapse-rest.png', clip: { x: 820, y: 380, width: 360, height: 300 } });
  const d = await page.evaluate(() => Structure._debug());
  console.log('  after collapse:', JSON.stringify(d.blocks.map(b => ({ m: b.mat, x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp) }))), 'enemy=', d.enemy ? 'alive hp=' + d.enemy.hp.toFixed(1) : 'DEAD');

  // ---------------------------------------------------------------- 4 strategies
  console.log('\n=== STRATEGY VIABILITY: 3 birds, one plan per run ===');
  const plans = {
    'flat skips (-108,10)':  [[-108, 10], [-108, 10], [-108, 10]],
    'high lobs (-72,90)':    [[-72, 90], [-72, 90], [-72, 90]],
    'mid arcs (-95,55)':     [[-95, 55], [-95, 55], [-95, 55]],
    'roof crusher (-88,70)': [[-88, 70], [-88, 70], [-88, 70]],
    'low liners (-110,-4)':  [[-110, -4], [-110, -4], [-110, -4]],
    'known win (-105,30)':   [[-105, 30], [-105, 30], [-105, 30]],
  };
  for (const [name, shots] of Object.entries(plans)) {
    await reset(page);
    let used = 0, won = false;
    for (const [dx, dy] of shots) {
      const ready = await page.evaluate(() => !!Slingshot.getBird());
      if (!ready) await page.waitForTimeout(1600);
      const ok = await page.evaluate(() => !!Slingshot.getBird());
      if (!ok) break;
      used++;
      await dragShot(page, dx, dy);
      await waitShotResolved(page, 12000);
      await page.waitForTimeout(1800);
      const alive = await page.evaluate(() => Structure.enemyAlive());
      if (!alive) { won = true; break; }
    }
    const d = await page.evaluate(() => Structure._debug());
    console.log(`  ${name.padEnd(22)} -> ${won ? 'WIN in ' + used + ' bird(s)' : 'LOSE'} | blocks left=${d.blocks.length} [${d.blocks.map(b => b.mat[0] + Math.round(b.hp)).join(' ')}]`);
  }

  if (errors.length) console.log('\nPAGE ERRORS:', errors);
  await browser.close();
})();
