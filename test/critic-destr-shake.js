// critic-destr-shake.js — is the screenshake real? Sample canvas transform at
// rAF resolution after synthetic + real impacts, and after a plain ground landing.
const { launch, dragShot, waitShotResolved } = require('./helpers');

(async () => {
  const { browser, page, errors } = await launch();

  // A) synthetic impact events at several energies, sampled every frame
  for (const e of [60, 100, 200, 400]) {
    const r = await page.evaluate(async (energy) => {
      const samples = [];
      let stop = false;
      const tick = () => {
        const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(Game.canvas.style.transform || '');
        samples.push(m ? +Math.hypot(+m[1], +m[2]).toFixed(2) : 0);
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      Game.events.emit('impact', { x: 900, y: 500, energy: energy });
      await new Promise(r => setTimeout(r, 900));
      stop = true;
      return { max: Math.max(...samples), nonzero: samples.filter(s => s > 0.15).length, frames: samples.length, head: samples.slice(0, 25) };
    }, e);
    console.log(`synthetic impact E=${e}: maxPx=${r.max} shakeFrames=${r.nonzero}/${r.frames} head=${JSON.stringify(r.head)}`);
  }

  // B) real shot, per-frame transform sampling through the whole flight
  await page.evaluate(() => {
    window.__tr = [];
    window.__trOn = true;
    const tick = () => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(Game.canvas.style.transform || '');
      window.__tr.push({ t: performance.now() | 0, s: m ? +Math.hypot(+m[1], +m[2]).toFixed(2) : 0 });
      if (window.__trOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__imp = [];
    Game.events.on('impact', d => window.__imp.push({ t: performance.now() | 0, e: +d.energy.toFixed(1) }));
  });
  await dragShot(page, -105, 30);
  await waitShotResolved(page, 12000);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    window.__trOn = false;
    const tr = window.__tr;
    return { max: Math.max(...tr.map(x => x.s)), nz: tr.filter(x => x.s > 0.15).length, n: tr.length, imp: window.__imp,
             peakWindow: tr.filter(x => x.s > 0.15).slice(0, 30).map(x => x.s) };
  });
  console.log('real shot (-105,30): impacts=' + JSON.stringify(r.imp));
  console.log(`  transform maxPx=${r.max} shakeFrames=${r.nz}/${r.n} peaks=${JSON.stringify(r.peakWindow)}`);

  // C) energy of a bird simply falling to the ground from the sling (no power)
  await page.keyboard.press('r');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__gl = [];
    Matter.Events.on(Game.engine, 'collisionStart', ev => {
      for (const p of ev.pairs) {
        const a = p.bodyA, b = p.bodyB;
        const n = p.collision.normal;
        const rvx = a.velocity.x - b.velocity.x, rvy = a.velocity.y - b.velocity.y;
        const vn = Math.abs(rvx * n.x + rvy * n.y);
        let red; if (a.isStatic) red = b.mass; else if (b.isStatic) red = a.mass; else red = a.mass * b.mass / (a.mass + b.mass);
        window.__gl.push({ a: a.label, b: b.label, e: +(0.5 * red * vn * vn).toFixed(1) });
      }
    });
  });
  await dragShot(page, -12, 0);
  await page.waitForTimeout(3000);
  console.log('near-zero-power shot collisions:', JSON.stringify(await page.evaluate(() => window.__gl)));

  // D) DROP TEST: place a bird directly above a wood block and let it fall (no launch power)
  await page.keyboard.press('r');
  await page.waitForTimeout(700);
  const drop = await page.evaluate(async () => {
    const before = Structure._debug();
    const b = Matter.Bodies.circle(980, 380, 22, { density: 0.004, restitution: 0.35, friction: 0.5, frictionAir: 0, label: 'bird' });
    Matter.Composite.add(Game.world, b);
    const log = [];
    Matter.Events.on(Game.engine, 'collisionStart', ev => {
      for (const p of ev.pairs) {
        if (p.bodyA !== b && p.bodyB !== b) continue;
        const o = p.bodyA === b ? p.bodyB : p.bodyA;
        const n = p.collision.normal;
        const rvx = p.bodyA.velocity.x - p.bodyB.velocity.x, rvy = p.bodyA.velocity.y - p.bodyB.velocity.y;
        const vn = Math.abs(rvx * n.x + rvy * n.y);
        let red; if (o.isStatic) red = b.mass; else red = b.mass * o.mass / (b.mass + o.mass);
        log.push({ other: o.label, e: +(0.5 * red * vn * vn).toFixed(1), speed: +b.speed.toFixed(2) });
      }
    });
    await new Promise(r => setTimeout(r, 2500));
    return { log, before: before.blocks.length, after: Structure._debug() };
  });
  console.log('\nDROP TEST (dead-drop 72px onto the wood roof, zero horizontal speed):');
  console.log('  collisions:', JSON.stringify(drop.log));
  console.log(`  blocks ${drop.before} -> ${drop.after.blocks.length} hp=[${drop.after.blocks.map(x => x.mat[0] + Math.round(x.hp)).join(' ')}] debris=${drop.after.debris}`);

  if (errors.length) console.log('PAGE ERRORS:', errors);
  await browser.close();
})();
