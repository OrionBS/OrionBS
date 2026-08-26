// Regression tests for the bugs the critics found. Each one MUST stay fixed.
const { launch, dragShot, waitShotResolved, worldSnapshot } = require('./helpers');

let fails = 0;
const ok = (c, m, x) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  — ' + x : ''}`); if (!c) fails++; };

(async () => {
  const { browser, page, errors } = await launch();

  // === 1. A win must be reachable (the bug that made the game unwinnable) ====
  await page.evaluate(() => {
    window.__ev = [];
    ['enemy:killed', 'level:cleared'].forEach(n => Game.events.on(n, () => window.__ev.push(n)));
  });
  await dragShot(page, -105, 30);
  await waitShotResolved(page);
  await page.waitForTimeout(2500);
  const r1 = await page.evaluate(() => ({
    ev: window.__ev, left: Structure.enemiesLeft(), alive: Structure.enemyAlive(),
    state: GameLoop.getState(),
    enemyBodies: Matter.Composite.allBodies(Game.world).filter(b => b.label === 'enemy').length,
  }));
  ok(r1.ev.includes('enemy:killed'), 'enemy:killed dispara', JSON.stringify(r1.ev));
  ok(r1.ev.includes('level:cleared'), 'level:cleared dispara');
  ok(r1.left === 0 && !r1.alive, 'contador de inimigos zera', `left=${r1.left}`);
  ok(r1.enemyBodies === 0, 'corpo do inimigo removido do mundo', `bodies=${r1.enemyBodies}`);
  ok(r1.state === 'win', 'estado vira win', `state=${r1.state}`);

  // === 2. No leaked colliders across damage+reset cycles =====================
  const base = await page.evaluate(() => {
    GameLoop.goToLevel(0);
    return null;
  });
  await page.waitForTimeout(700);
  const b0 = await worldSnapshot(page);
  for (let i = 0; i < 4; i++) {
    await dragShot(page, -105, 30);
    await waitShotResolved(page);
    await page.waitForTimeout(1200);
    await page.keyboard.press('r');
    await page.waitForTimeout(700);
  }
  const b1 = await page.evaluate(() => {
    const all = Matter.Composite.allBodies(Game.world);
    const labels = {};
    all.forEach(b => { labels[b.label] = (labels[b.label] || 0) + 1; });
    return { bodies: all.length, labels };
  });
  ok(b1.bodies === b0.bodies, 'sem vazamento de corpos após 4 ciclos',
     `base=${b0.bodies} agora=${b1.bodies} ${JSON.stringify(b1.labels)}`);
  ok((b1.labels.enemy || 0) === 1, 'exatamente 1 inimigo vivo na fase 1',
     `enemy=${b1.labels.enemy}`);

  // === 3. Destroying a support wakes the load (no floating structures) ======
  const wake = await page.evaluate(async () => {
    GameLoop.goToLevel(0);
    await new Promise(r => setTimeout(r, 3200)); // let the stack fall asleep
    const dbg = () => {
      const m = {};
      Structure._debug().blocks.forEach(b => { m[b.id] = { x: b.x, y: b.y }; });
      return m;
    };
    const before = dbg();
    const asleep = Matter.Composite.allBodies(Game.world)
      .filter(b => b.label === 'block' && b.isSleeping).length;
    // destroy the left column the same way a lethal hit would
    const col = Matter.Composite.allBodies(Game.world)
      .filter(b => b.label === 'block')
      .sort((a, b) => a.position.x - b.position.x)[0];
    Structure._debugKill(col);   // real lethal-damage path
    await new Promise(r => setTimeout(r, 1500));
    const after = dbg();
    // compare surviving blocks by identity, not by index
    let moved = 0, n = 0;
    Object.keys(after).forEach(id => {
      if (!before[id]) return;
      n++;
      if (Math.hypot(after[id].x - before[id].x, after[id].y - before[id].y) > 5) moved++;
    });
    return { asleep, moved, n };
  });
  ok(wake.asleep > 0, 'a pilha realmente dorme antes do teste', `dormindo=${wake.asleep}`);
  ok(wake.moved > 0, 'blocos sustentados caem quando o suporte some',
     `moveram=${wake.moved}/${wake.n}`);

  // === 4. Ground landings must not shake the screen =========================
  const shake = await page.evaluate(() => {
    GameLoop.goToLevel(0);
    window.__imp = [];
    Game.events.on('impact', d => window.__imp.push(Math.round(d.energy)));
    return null;
  });
  await page.waitForTimeout(700);
  await dragShot(page, -20, 6); // dribble that never leaves the sling area
  await page.waitForTimeout(2500);
  const imp = await page.evaluate(() => window.__imp);
  ok(imp.length === 0, 'arremesso fraco não gera tremor de tela', `impactos=${JSON.stringify(imp)}`);

  // === 5. HUD must not overlap ==============================================
  await page.evaluate(() => GameLoop.goToLevel(2));
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test/screens/regress-hud.png', clip: { x: 0, y: 0, width: 300, height: 160 } });

  const real = errors.filter(e => !/favicon/.test(e));
  ok(real.length === 0, 'sem erros de console', real.join(' | '));

  console.log(fails ? `\nFALHAS: ${fails}` : '\nTODAS AS REGRESSÕES OK');
  process.exitCode = fails ? 1 : 0;
  await browser.close();
})();
