// critic-loop-play.js — play full runs (win + lose), measure loop pacing.
// Measures: shot-over -> bird:dead lag, bird:dead -> bird:loaded beat,
// enemy:killed -> overlay readable, lose -> overlay, restart -> playable.
const { launch, dragShot, waitShotResolved, worldSnapshot } = require('./helpers');
const fs = require('fs');

const SHOT = { dx: -105, dy: 30 };          // known-winning shot
const WEAK = { dx: -40, dy: 8 };            // short dud shot (misses)

async function instrument(page) {
  await page.evaluate(() => {
    window.__log = [];
    window.__t0 = performance.now();
    ['bird:loaded', 'bird:launched', 'bird:dead', 'enemy:killed', 'level:reset', 'attempt:spent', 'impact']
      .forEach(n => Game.events.on(n, (d) => window.__log.push({ n, t: performance.now(), d: (d && d.energy) || (d && d.remaining) })));
    // per-frame sampling: last time the in-flight bird was moving meaningfully
    window.__samples = [];
    Game.updaters.push(() => {
      const b = Slingshot.getBird();
      const rec = { t: performance.now(), speed: b && !b.isStatic ? b.speed : null,
                    state: GameLoop.getState(), rem: GameLoop.getRemaining(),
                    tf: Game.canvas.style.transform || '' };
      window.__samples.push(rec);
      if (window.__samples.length > 6000) window.__samples.shift();
    });
  });
}

const ev = (log, n) => log.filter(e => e.n === n);
const dump = p => p.evaluate(() => ({ log: window.__log, samples: window.__samples }));

// last moment the bird was moving faster than `thr` before it died
function restTime(samples, deadT, thr) {
  let last = null;
  for (const s of samples) {
    if (s.t > deadT) break;
    if (s.speed !== null && s.speed >= thr) last = s.t;
  }
  return last;
}

(async () => {
  const out = [];
  const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

  const { browser, page, errors } = await launch();
  await instrument(page);
  const base = await worldSnapshot(page);
  say('baseline bodies=' + base.bodies + ' enemyAlive=' + base.enemyAlive);

  // ---------------------------------------------------------------- LOSE RUN
  say('\n=== LOSE RUN (3 weak shots) ===');
  for (let i = 0; i < 3; i++) {
    const st = await page.evaluate(() => ({ s: GameLoop.getState(), r: GameLoop.getRemaining() }));
    say(`before shot ${i + 1}: state=${st.s} remaining=${st.r}`);
    await dragShot(page, WEAK.dx, WEAK.dy);
    const ok = await waitShotResolved(page, 14000);
    say(`  shot ${i + 1} resolved=${ok}`);
    await page.waitForTimeout(1400); // allow reload beat
  }
  await page.waitForTimeout(1200);
  let d = await dump(page);
  const loseState = await page.evaluate(() => ({ s: GameLoop.getState(), r: GameLoop.getRemaining() }));
  say('after 3 shots: state=' + loseState.s + ' remaining=' + loseState.r);
  await page.screenshot({ path: 'test/screens/critic-loop-play-lose.png' });

  // pacing numbers for the lose run
  const launches = ev(d.log, 'bird:launched'), deaths = ev(d.log, 'bird:dead'), loads = ev(d.log, 'bird:loaded');
  say('launched=' + launches.length + ' dead=' + deaths.length + ' loaded=' + loads.length);
  deaths.forEach((dd, i) => {
    const l = launches[i];
    const rest02 = restTime(d.samples, dd.t, 0.2);
    const rest10 = restTime(d.samples, dd.t, 1.0);
    const nextLoad = loads.find(x => x.t > dd.t);
    say(`  shot${i + 1}: flight=${(dd.t - l.t) | 0}ms  deadLagFromSpeed<0.2=${rest02 ? (dd.t - rest02) | 0 : 'n/a'}ms  ` +
        `deadLagFromSpeed<1.0=${rest10 ? (dd.t - rest10) | 0 : 'n/a'}ms  dead->load=${nextLoad ? (nextLoad.t - dd.t) | 0 : 'NONE'}ms`);
  });
  // lose overlay timing: last dead -> state lose -> overlay fully opaque
  const lastDead = deaths[deaths.length - 1];
  const firstLose = d.samples.find(s => s.t > lastDead.t && s.state === 'lose');
  say('  lastDead -> state=lose: ' + (firstLose ? ((firstLose.t - lastDead.t) | 0) + 'ms' : 'NEVER'));

  // restart from lose overlay by click
  const tClick = Date.now();
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  const afterClick = await page.evaluate(() => ({ s: GameLoop.getState(), r: GameLoop.getRemaining(), bird: !!Slingshot.getBird() }));
  say('  click-on-overlay restart -> ' + JSON.stringify(afterClick) + ` (${Date.now() - tClick}ms wall)`);
  const snapAfterLose = await worldSnapshot(page);
  say('  bodies after restart=' + snapAfterLose.bodies + ' (baseline ' + base.bodies + ') enemyAlive=' + snapAfterLose.enemyAlive);

  // ---------------------------------------------------------------- WIN RUN
  say('\n=== WIN RUN (kill shot on bird 1 => 3 stars) ===');
  await page.evaluate(() => { window.__log.length = 0; window.__samples.length = 0; });
  await page.waitForTimeout(300);
  await dragShot(page, SHOT.dx, SHOT.dy);
  await waitShotResolved(page, 14000);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/screens/critic-loop-play-win-t200.png' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test/screens/critic-loop-play-win-t700.png' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test/screens/critic-loop-play-win-final.png' });

  d = await dump(page);
  const kill = ev(d.log, 'enemy:killed')[0];
  const deadAfterKill = ev(d.log, 'bird:dead').filter(x => x.t > (kill ? kill.t : 0));
  const winState = await page.evaluate(() => ({ s: GameLoop.getState(), r: GameLoop.getRemaining() }));
  say('enemy:killed at ' + (kill ? 'yes' : 'NO') + ' state=' + winState.s + ' remaining=' + winState.r);
  if (kill) {
    const firstWin = d.samples.find(s => s.t >= kill.t && s.state === 'win');
    say('  kill -> state=win: ' + (firstWin ? ((firstWin.t - kill.t) | 0) + 'ms' : 'NEVER'));
    say('  bird:dead events AFTER kill: ' + deadAfterKill.length +
        (deadAfterKill.length ? ' (+' + ((deadAfterKill[0].t - kill.t) | 0) + 'ms)' : ''));
  }
  // impact energies seen this run
  say('  impacts: ' + ev(d.log, 'impact').map(e => Math.round(e.d)).join(', '));

  // restart with R from win overlay
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  const afterR = await page.evaluate(() => ({ s: GameLoop.getState(), r: GameLoop.getRemaining(), bird: !!Slingshot.getBird() }));
  const snapAfterWin = await worldSnapshot(page);
  say('  R restart -> ' + JSON.stringify(afterR) + ' bodies=' + snapAfterWin.bodies + ' enemyAlive=' + snapAfterWin.enemyAlive);

  say('\npage errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  fs.writeFileSync('test/screens/critic-loop-play.txt', out.join('\n'));
  await browser.close();
})();
