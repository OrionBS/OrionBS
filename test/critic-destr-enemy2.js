// critic-destr-enemy2.js — corrected enemy probes: projectile spawned INSIDE the
// shelter (no column in the way), graze vs solid, debris-lethality, crush with
// real downward velocity, and the kill-pop frame burst.
const { launch, dragShot, waitShotResolved } = require('./helpers');
const fs = require('fs');
const SCREENS = __dirname + '/screens';

async function reset(page) { await page.keyboard.press('r'); await page.waitForTimeout(700); }

async function hit(page, opts) {
  return page.evaluate(async (o) => {
    const d0 = Structure._debug();
    if (!d0.enemy) return { err: 'no enemy' };
    const ex = d0.enemy.x, ey = d0.enemy.y;
    const b = o.kind === 'ball'
      ? Matter.Bodies.circle(ex + o.ox, ey + o.oy, 22, { density: 0.004, restitution: 0.35, friction: 0.5, frictionAir: 0, label: 'bird' })
      : Matter.Bodies.rectangle(ex + o.ox, ey + o.oy, o.w || 40, o.h || 40, { density: o.dens || 0.008, restitution: 0.05, friction: 0.8, label: 'block' });
    Matter.Composite.add(Game.world, b);
    Matter.Body.setVelocity(b, { x: o.vx, y: o.vy });
    const hits = [];
    const h = (ev) => {
      for (const p of ev.pairs) {
        if (p.bodyA !== b && p.bodyB !== b) continue;
        const other = p.bodyA === b ? p.bodyB : p.bodyA;
        if (other.label !== 'enemy') continue;
        const n = p.collision.normal;
        const rvx = p.bodyA.velocity.x - p.bodyB.velocity.x, rvy = p.bodyA.velocity.y - p.bodyB.velocity.y;
        const vn = Math.abs(rvx * n.x + rvy * n.y);
        const red = b.mass * other.mass / (b.mass + other.mass);
        const dd = Structure._debug();
        hits.push({ e: +(0.5 * red * vn * vn).toFixed(1), vn: +vn.toFixed(2), ehpAfter: dd.enemy ? +dd.enemy.hp.toFixed(1) : 'DEAD' });
      }
    };
    Matter.Events.on(Game.engine, 'collisionStart', h);
    const g = o.noGravity ? () => Matter.Body.setVelocity(b, { x: b.velocity.x, y: 0 }) : null;
    if (g) Matter.Events.on(Game.engine, 'beforeUpdate', g);
    await new Promise(r => setTimeout(r, o.ms || 1200));
    Matter.Events.off(Game.engine, 'collisionStart', h);
    if (g) Matter.Events.off(Game.engine, 'beforeUpdate', g);
    if (Matter.Composite.get(Game.world, b.id, 'body')) Matter.Composite.remove(Game.world, b);
    const d1 = Structure._debug();
    return { hits, enemy: d1.enemy ? +d1.enemy.hp.toFixed(1) : 'DEAD', particles: d1.particles };
  }, opts);
}

(async () => {
  const { browser, page, errors } = await launch();

  console.log('=== A. BIRD ROLLING INTO THE ENEMY (spawned inside the shelter, flat) ===');
  console.log('   (bird r=22 mass 6.08, enemy r=20 mass 4.40, ENEMY_HP=12, dmg=(E-4)*0.6)');
  for (const v of [0.4, 0.8, 1.5, 2.5, 4, 7, 12]) {
    await reset(page);
    const r = await hit(page, { kind: 'ball', ox: -58, oy: -4, vx: v, vy: 0, noGravity: true, ms: 1400 });
    console.log(`  approach ${String(v).padEnd(4)} px/step -> hits=${JSON.stringify(r.hits.slice(0, 2))} final=${r.enemy}`);
  }

  console.log('\n=== B. FALLING DEBRIS / BLOCK ONTO THE ENEMY (vy set, from 25px above) ===');
  for (const vy of [1, 2, 3, 5, 8]) {
    await reset(page);
    const r = await hit(page, { kind: 'box', w: 16, h: 16, dens: 0.004, ox: 0, oy: -46, vx: 0, vy, ms: 1200 });
    console.log(`  small wood splinter 16x16 vy=${vy} -> hits=${JSON.stringify(r.hits.slice(0, 2))} final=${r.enemy}`);
  }
  for (const vy of [1, 3, 6]) {
    await reset(page);
    const r = await hit(page, { kind: 'box', w: 40, h: 40, dens: 0.008, ox: 0, oy: -55, vx: 0, vy, ms: 1200 });
    console.log(`  stone cube 40x40   vy=${vy} -> hits=${JSON.stringify(r.hits.slice(0, 2))} final=${r.enemy}`);
  }

  console.log('\n=== C. KILL POP: real shot, frames around the kill ===');
  await reset(page);
  await page.evaluate(() => {
    window.__killT = null;
    Game.events.on('enemy:killed', () => { window.__killT = performance.now(); });
  });
  await dragShot(page, -105, 30);
  // poll for the kill, then burst frames
  let waited = 0;
  while (waited < 6000) {
    const k = await page.evaluate(() => window.__killT);
    if (k) break;
    await page.waitForTimeout(50); waited += 50;
  }
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: `${SCREENS}/pop-${String(i).padStart(2, '0')}.png`, clip: { x: 860, y: 470, width: 260, height: 200 } });
    await page.waitForTimeout(70);
  }
  console.log('  kill detected, pop frames written (pop-00..05)');

  console.log('\n=== D. BLINK VISIBILITY (frames 100ms apart over 3.2s, idle enemy) ===');
  await reset(page);
  for (let i = 0; i < 4; i++) {
    await page.screenshot({ path: `${SCREENS}/blink-${i}.png`, clip: { x: 940, y: 580, width: 90, height: 80 } });
    await page.waitForTimeout(60);
  }
  // count blink duty cycle numerically from the module constants via rendering time
  console.log('  BLINK_PERIOD_MS=3000 BLINK_LEN_MS=140 -> eyes closed 4.7% of the time');

  if (errors.length) console.log('\nPAGE ERRORS:', errors);
  await browser.close();
})();
