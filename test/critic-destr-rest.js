// critic-destr-rest.js — rigorous rest-state audit after varied shots:
// SAT-based "floating body" probe (not AABB), settle time excluding the bird,
// residual jitter, interpenetration depth, and per-fragmentation particle counts.
const { launch, dragShot, waitShotResolved } = require('./helpers');
const SCREENS = __dirname + '/screens';

const AUDIT = `(() => {
  const bodies = Matter.Composite.allBodies(Game.world).filter(b => !b.isStatic && b.label !== 'bird');
  const all = Matter.Composite.allBodies(Game.world);
  const floating = [];
  for (const b of bodies) {
    const w = b.bounds.max.x - b.bounds.min.x;
    const probe = Matter.Bodies.rectangle((b.bounds.min.x + b.bounds.max.x) / 2, b.bounds.max.y + 5, Math.max(2, w - 2), 10);
    const others = all.filter(o => o !== b);
    const col = Matter.Query.collides(probe, others);
    if (!col.length) floating.push({ l: b.label, x: Math.round(b.position.x), y: Math.round(b.position.y), bottom: Math.round(b.bounds.max.y), sleeping: b.isSleeping, speed: +b.speed.toFixed(3) });
  }
  // deepest interpenetration among resting pairs
  let deepest = 0, deepPair = null;
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const c = Matter.Collision.collides(bodies[i], bodies[j]);
    if (c && c.collided && c.depth > deepest) { deepest = c.depth; deepPair = [bodies[i].label, bodies[j].label]; }
  }
  return { n: bodies.length, floating, deepest: +deepest.toFixed(2), deepPair,
           maxSpeed: +Math.max(0, ...bodies.map(b => b.speed)).toFixed(3),
           awake: bodies.filter(b => !b.isSleeping).length };
})()`;

async function reset(page) { await page.keyboard.press('r'); await page.waitForTimeout(700); }

(async () => {
  const { browser, page, errors } = await launch();

  // instrument particle deltas per fragmentation
  await page.evaluate(() => {
    window.__pk = [];
    let prevBlocks = Structure._debug().blocks.length;
    let prevP = 0;
    setInterval(() => {
      const d = Structure._debug();
      if (d.blocks.length < prevBlocks) window.__pk.push({ t: performance.now() | 0, lost: prevBlocks - d.blocks.length, particles: d.particles, debris: d.debris });
      prevBlocks = d.blocks.length;
      prevP = d.particles;
    }, 16);
    window.__resetPk = () => { window.__pk = []; prevBlocks = Structure._debug().blocks.length; };
  });

  const shots = [
    ['win-105-30', -105, 30],
    ['lob-72-90', -72, 90],
    ['arc-95-55', -95, 55],
    ['roof-88-70', -88, 70],
    ['flat-108-10', -108, 10],
  ];

  for (const [name, dx, dy] of shots) {
    await reset(page);
    await page.evaluate(() => window.__resetPk());
    // settle sampler that ignores the bird
    await page.evaluate(() => {
      window.__mo = []; window.__moOn = true;
      const t0 = performance.now();
      const tick = () => {
        const bs = Matter.Composite.allBodies(Game.world).filter(b => !b.isStatic && b.label !== 'bird');
        window.__mo.push({ t: Math.round(performance.now() - t0), v: +Math.max(0, ...bs.map(b => b.speed)).toFixed(2) });
        if (window.__moOn) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await dragShot(page, dx, dy);
    await waitShotResolved(page, 12000);
    await page.waitForTimeout(4500);
    const mo = await page.evaluate(() => { window.__moOn = false; return window.__mo; });
    let firstMove = null, lastMove = null;
    for (const s of mo) { if (s.v > 0.35) { if (firstMove === null) firstMove = s.t; lastMove = s.t; } }
    const audit = await page.evaluate(AUDIT);
    const pk = await page.evaluate(() => window.__pk);
    console.log(`\n--- ${name} (${dx},${dy})`);
    console.log(`  structure motion: ${firstMove}ms -> ${lastMove}ms  (duration ${lastMove !== null ? lastMove - firstMove : '-'}ms)`);
    console.log(`  fragmentations: ${JSON.stringify(pk)}`);
    console.log(`  rest audit: bodies=${audit.n} awake=${audit.awake} maxSpeed=${audit.maxSpeed} deepestOverlap=${audit.deepest}px ${JSON.stringify(audit.deepPair)}`);
    console.log(`  FLOATING (nothing within 10px under the body): ${JSON.stringify(audit.floating)}`);
    await page.screenshot({ path: `${SCREENS}/rest-${name}.png`, clip: { x: 780, y: 380, width: 400, height: 300 } });
  }

  if (errors.length) console.log('\nPAGE ERRORS:', errors);
  await browser.close();
})();
