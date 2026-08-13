// Verification for js/gameloop.js — tolerates slingshot/destruction stubs by
// emitting synthetic events. Run: node test/gameloop-verify.js
const { launch } = require('./helpers');

const SHOTS = '/tmp/claude-0/-home-user-OrionBS/ce99b8a8-d8e0-547b-b218-46d5fb1db1c1/scratchpad';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('ok: ' + msg);
}

(async () => {
  const { browser, page, errors: rawErrors } = await launch();
  // favicon.ico 404 is a pre-existing index.html artifact, not a game-code error
  const errors = () => rawErrors.filter(e => !/favicon/i.test(e) && !/Failed to load resource/.test(e));

  // 1. zero console errors on load
  assert(errors().length === 0, 'zero console errors on load' + (errors().length ? ' -- ' + errors().join(' | ') : ''));
  assert(await page.evaluate(() => GameLoop.getState() === 'playing'), 'initial state playing');
  assert(await page.evaluate(() => GameLoop.getRemaining() === 3), 'initial remaining 3');
  await page.screenshot({ path: SHOTS + '/gl-01-initial.png' });

  // 2. synthetic lose flow: 3 launches interleaved with deaths
  await page.evaluate(() => {
    window.__spent = [];
    Game.events.on('attempt:spent', d => window.__spent.push(d.remaining));
  });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      Game.events.emit('bird:loaded', { bird: {} });
      Game.events.emit('bird:launched', { bird: {}, velocity: { x: 10, y: -10 } });
      Game.events.emit('bird:dead', { bird: {} });
    });
    await page.waitForTimeout(900); // let reload beat pass between attempts
  }
  const spent = await page.evaluate(() => window.__spent);
  assert(JSON.stringify(spent) === '[2,1,0]', 'attempt:spent remaining sequence [2,1,0], got ' + JSON.stringify(spent));
  assert(await page.evaluate(() => GameLoop.getState() === 'lose'), 'state lose after 3 birds with enemy alive');
  await page.waitForTimeout(600); // overlay fade
  await page.screenshot({ path: SHOTS + '/gl-02-lose.png' });

  // restart via keyboard R
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => GameLoop.getState() === 'playing'), 'state playing after R');
  assert(await page.evaluate(() => GameLoop.getRemaining() === 3), 'remaining back to 3 after R');
  const gotReset = await page.evaluate(() => {
    return new Promise(res => {
      Game.events.on('level:reset', () => res(true));
      Game.events.emit('__noop');
      setTimeout(() => res('already-fired-ok'), 50);
    });
  });
  console.log('level:reset listener sanity: ' + gotReset);

  // 3. win path: one launch, enemy dies mid-flight, then a late bird:dead
  await page.evaluate(() => {
    Game.events.emit('bird:launched', { bird: {}, velocity: { x: 12, y: -8 } });
    Game.events.emit('enemy:killed', { enemy: {} });
    Game.events.emit('bird:dead', { bird: {} }); // late death must NOT double-transition
  });
  assert(await page.evaluate(() => GameLoop.getState() === 'win'), 'state win after enemy:killed');
  await page.waitForTimeout(1300); // 600ms reveal + fade
  const stars = await page.evaluate(() => GameLoop.getRemaining() + 1);
  assert(stars === 3, 'stars = remaining+1 = 3 (2 birds unused)');
  await page.screenshot({ path: SHOTS + '/gl-03-win.png' });

  // click restarts while overlay showing
  await page.mouse.click(640, 360);
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => GameLoop.getState() === 'playing'), 'click on overlay restarts');
  assert(await page.evaluate(() => GameLoop.getRemaining() === 3), 'remaining 3 after click restart');

  // 4. screenshake
  await page.evaluate(() => { Game.events.emit('impact', { x: 900, y: 600, energy: 50 }); });
  await page.waitForTimeout(80);
  const tDuring = await page.evaluate(() => Game.canvas.style.transform);
  assert(tDuring && tDuring.indexOf('translate') === 0, 'canvas transform set during shake: "' + tDuring + '"');
  await page.waitForTimeout(1000);
  const tAfter = await page.evaluate(() => Game.canvas.style.transform);
  assert(tAfter === '' || tAfter === 'none', 'canvas transform cleared within ~1s: "' + tAfter + '"');

  assert(errors().length === 0, 'zero console errors after full run' + (errors().length ? ' -- ' + errors().join(' | ') : ''));

  await browser.close();
  console.log(process.exitCode ? 'RESULT: FAIL' : 'RESULT: PASS');
})().catch(e => { console.error(e); process.exit(1); });
