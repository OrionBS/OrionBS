// Verifies all five levels: geometry sanity, at-rest stability, and that each
// one can actually be cleared within its bird budget by some shot sequence.
const { launch, dragShot, waitShotResolved, worldSnapshot } = require('./helpers');

// Candidate pulls, ordered from flat to lofted. Negative dx pulls left (shoots right).
const SHOTS = [
  [-105, 12], [-105, 22], [-105, 30], [-105, 40], [-105, 52],
  [-105, 66], [-105, 80], [-105, 95], [-100, 108], [-90, 108],
  [-70, 108], [-60, 100],
];

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
};

(async () => {
  const { browser, page, errors } = await launch();
  const count = await page.evaluate(() => Structure.levelCount());
  ok(count === 5, 'five levels defined', `count=${count}`);

  for (let lv = 0; lv < count; lv++) {
    const meta = await page.evaluate((i) => {
      Structure.loadLevel(i);
      const l = Structure.level();
      return { name: l.name, difficulty: l.difficulty, birds: l.birds,
               blocks: l.blocks.length, enemies: l.enemies.length };
    }, lv);
    console.log(`\n=== Fase ${lv + 1}: ${meta.name} (${meta.difficulty}) — ` +
                `${meta.blocks} blocos, ${meta.enemies} inimigos, ${meta.birds} pássaros`);

    // --- stability: nothing may drift while untouched
    const t0 = await page.evaluate(() => Structure._debug().blocks.map(b => ({ x: b.x, y: b.y })));
    await page.waitForTimeout(3000);
    const t1 = await page.evaluate(() => Structure._debug().blocks.map(b => ({ x: b.x, y: b.y })));
    let drift = 0;
    for (let i = 0; i < t0.length; i++) {
      drift = Math.max(drift, Math.hypot(t1[i].x - t0[i].x, t1[i].y - t0[i].y));
    }
    ok(drift < 2, `fase ${lv + 1} estável em repouso`, `maxDrift=${drift.toFixed(3)}px`);

    // --- winnable: search shot sequences within the bird budget
    let won = false, usedPlan = null;
    for (let s = 0; s < SHOTS.length && !won; s++) {
      await page.evaluate((i) => { GameLoop.goToLevel(i); }, lv);
      await page.waitForTimeout(500);
      const plan = [];
      for (let attempt = 0; attempt < meta.birds; attempt++) {
        const st = await page.evaluate(() => GameLoop.getState());
        if (st !== 'playing') break;
        // vary the shot slightly per attempt so a plan isn't three identical shots
        const [dx, dy] = SHOTS[(s + attempt) % SHOTS.length];
        plan.push([dx, dy]);
        const hasBird = await page.evaluate(() => !!Slingshot.getBird());
        if (!hasBird) { await page.waitForTimeout(1100); }
        await dragShot(page, dx, dy);
        await waitShotResolved(page);
        await page.waitForTimeout(400);
        if (await page.evaluate(() => !Structure.enemyAlive())) { won = true; break; }
        await page.waitForTimeout(1000);
      }
      if (won) usedPlan = plan;
    }
    ok(won, `fase ${lv + 1} vencível com ${meta.birds} pássaros`,
       won ? `plano=${JSON.stringify(usedPlan)}` : 'nenhum plano funcionou');
    if (won) {
      await page.waitForTimeout(1200);
      const st = await page.evaluate(() => GameLoop.getState());
      ok(st === 'win', `fase ${lv + 1} entra em estado de vitória`, `state=${st}`);
      await page.screenshot({ path: `test/screens/level-${lv + 1}-win.png` });
    }

    // --- reset hygiene for this level
    const before = await page.evaluate((i) => { GameLoop.goToLevel(i); return null; }, lv);
    await page.waitForTimeout(600);
    const snap = await worldSnapshot(page);
    ok(snap.enemyAlive, `fase ${lv + 1} restaurada após reset`, `bodies=${snap.bodies}`);
  }

  // level select keys
  await page.keyboard.press('3');
  await page.waitForTimeout(400);
  const li = await page.evaluate(() => Structure.levelIndex());
  ok(li === 2, 'tecla 3 seleciona a fase 3', `index=${li}`);

  const real = errors.filter(e => !/favicon/.test(e));
  ok(real.length === 0, 'sem erros de console', real.join(' | '));

  console.log(failures ? `\nFALHAS: ${failures}` : '\nTODAS AS FASES OK');
  process.exitCode = failures ? 1 : 0;
  await browser.close();
})();
