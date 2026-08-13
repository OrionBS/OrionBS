// critic-destr-collapse.js — fragmentation + collapse believability + shake sampling.
// Phase A: sweep arc shots to find one that fragments a block; sample world at 30ms.
// Phase B: watch the collapse settle; report settle time, sleeping-in-air, jitter.
const { launch, dragShot, waitShotResolved } = require('./helpers');
const fs = require('fs');
const SCREENS = __dirname + '/screens';

async function instrument(page) {
  await page.evaluate(() => {
    window.__ev = [];
    if (!window.__evHooked) {
      window.__evHooked = true;
      Game.events.on('impact', d => __ev.push({ type: 'impact', x: Math.round(d.x), y: Math.round(d.y), energy: +d.energy.toFixed(1) }));
      Game.events.on('enemy:killed', () => __ev.push({ type: 'enemy:killed' }));
    }
    // per-frame sampler
    if (!window.__sampHooked) {
      window.__sampHooked = true;
      window.__samples = [];
      window.__sampling = false;
      setInterval(() => {
        if (!window.__sampling) return;
        const d = Structure._debug();
        const bodies = Matter.Composite.allBodies(Game.world);
        let debrisAwake = 0, debrisSleep = 0, maxSpeed = 0;
        for (const b of bodies) {
          if (b.label === 'debris' || b.label === 'block') {
            if (b.isSleeping) debrisSleep++; else { debrisAwake++; maxSpeed = Math.max(maxSpeed, b.speed); }
          }
        }
        window.__samples.push({
          t: performance.now() | 0,
          debris: d.debris, particles: d.particles,
          awake: debrisAwake, asleep: debrisSleep,
          maxSpeed: +maxSpeed.toFixed(2),
          shake: Game.canvas.style.transform || '',
        });
      }, 30);
    }
    window.__samples = [];
    window.__sampling = true;
  });
}

async function stopSampling(page) {
  return page.evaluate(() => { window.__sampling = false; return window.__samples; });
}

(async () => {
  const { browser, page, errors } = await launch();

  // ---------- Phase A: sweep arcs looking for a fragmenting hit on the roof
  const candidates = [[-75, 85], [-82, 78], [-88, 70], [-70, 92], [-95, 62]];
  let fragShot = null;
  for (const [dx, dy] of candidates) {
    await page.keyboard.press('r');
    await page.waitForTimeout(700);
    await instrument(page);
    await dragShot(page, dx, dy);
    await waitShotResolved(page, 10000);
    await page.waitForTimeout(500);
    const samples = await stopSampling(page);
    const ev = await page.evaluate(() => window.__ev);
    const maxDebris = Math.max(...samples.map(s => s.debris), 0);
    const maxParticles = Math.max(...samples.map(s => s.particles), 0);
    const dbg = await page.evaluate(() => Structure._debug());
    console.log(`arc (${dx},${dy}): impacts=${JSON.stringify(ev.filter(e => e.type === 'impact').map(e => e.energy))} maxDebris=${maxDebris} maxParticles=${maxParticles} blocksLeft=${dbg.blocks.length} enemy=${dbg.enemy ? 'alive hp=' + dbg.enemy.hp.toFixed(1) : 'DEAD'}`);
    if (maxDebris > 0 && !fragShot) fragShot = [dx, dy];
  }

  // ---------- Phase B: replay the best fragmenting shot with screenshot burst
  if (fragShot) {
    await page.keyboard.press('r');
    await page.waitForTimeout(700);
    await instrument(page);
    await dragShot(page, fragShot[0], fragShot[1]);
    // burst right away — flight is ~1.2s, then impact
    await page.waitForTimeout(950);
    for (let i = 0; i < 14; i++) {
      await page.screenshot({ path: `${SCREENS}/frag-${String(i).padStart(2, '0')}.png`, clip: { x: 640, y: 260, width: 640, height: 460 } });
      await page.waitForTimeout(40);
    }
    // watch settle: sample until all structure/debris bodies asleep or 10s
    const t0 = Date.now();
    let settleMs = -1;
    while (Date.now() - t0 < 10000) {
      const s = await page.evaluate(() => {
        const bodies = Matter.Composite.allBodies(Game.world).filter(b => b.label === 'block' || b.label === 'debris');
        return { awake: bodies.filter(b => !b.isSleeping && b.speed > 0.08).length, n: bodies.length };
      });
      if (s.awake === 0) { settleMs = Date.now() - t0; break; }
      await page.waitForTimeout(150);
    }
    const samples = await stopSampling(page);
    const ev = await page.evaluate(() => window.__ev);
    console.log('\n=== FRAG REPLAY', fragShot, '===');
    console.log('events:', JSON.stringify(ev));
    console.log('settle after burst-start:', settleMs, 'ms');
    // shake summary
    const shakes = samples.filter(s => s.shake).map(s => s.shake);
    console.log('shake frames:', shakes.length, 'peak sample:', shakes[0] || 'none', shakes.slice(-1)[0] || '');
    // debris + particle envelope
    const env = samples.map(s => `${s.debris}/${s.particles}`);
    console.log('debris/particles timeline (every 30ms):', env.filter((_, i) => i % 4 === 0).join(' '));
    await page.screenshot({ path: `${SCREENS}/frag-settled.png`, clip: { x: 640, y: 260, width: 640, height: 460 } });
    // check for floating blocks: any block/debris asleep with clear air below?
    const floaters = await page.evaluate(() => {
      const bodies = Matter.Composite.allBodies(Game.world).filter(b => (b.label === 'block' || b.label === 'debris') && b.isSleeping);
      return bodies.map(b => ({ label: b.label, x: Math.round(b.position.x), y: Math.round(b.position.y), bottom: Math.round(b.bounds.max.y) }));
    });
    console.log('sleeping bodies (bottom y, ground=640):', JSON.stringify(floaters));
  } else {
    console.log('NO CANDIDATE FRAGMENTED A BLOCK');
  }

  if (errors.length) console.log('PAGE ERRORS:', errors);
  await browser.close();
})();
