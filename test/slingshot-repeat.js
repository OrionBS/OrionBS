// slingshot-repeat.js — repeat the same shot across fresh loads and compare
// full per-step position histories to hunt down any nondeterminism.
const { launch, dragShot, waitShotResolved } = require('./helpers');

async function oneRun() {
  const { browser, page } = await launch();
  await page.evaluate(() => {
    window.__rec = [];
    Game.events.on('bird:launched', d => {
      const b = d.bird;
      window.__watched = b;
      Game.updaters.push(() => {
        if (window.__watched === b && window.__rec.length < 600) {
          window.__rec.push([+b.position.x.toFixed(4), +b.position.y.toFixed(4)]);
        }
      });
    });
    Game.events.on('bird:dead', d => {
      window.__deadPos = { x: d.bird.position.x, y: d.bird.position.y };
      window.__watched = null;
    });
  });
  await dragShot(page, -80, 60);
  await waitShotResolved(page);
  const out = await page.evaluate(() => ({ rec: window.__rec, dead: window.__deadPos }));
  await browser.close();
  return out;
}

(async () => {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await oneRun());
  runs.forEach((r, i) =>
    console.log(`run ${i}: steps=${r.rec.length} dead=(${r.dead.x.toFixed(2)},${r.dead.y.toFixed(2)})`));
  for (let a = 0; a < runs.length - 1; a++) {
    const A = runs[a].rec, B = runs[a + 1].rec;
    let firstDiv = -1;
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      const d = Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1]);
      if (d > 0.01) { firstDiv = i; break; }
    }
    console.log(`run ${a} vs ${a + 1}: first divergence at step ${firstDiv}` +
      (firstDiv >= 0 ? ` A=${JSON.stringify(A[firstDiv])} B=${JSON.stringify(B[firstDiv])}` : ' (identical)'));
  }
})().catch(e => { console.error(e); process.exit(1); });
