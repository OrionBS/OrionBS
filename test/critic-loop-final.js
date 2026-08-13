// critic-loop-final.js — remaining chaos cases against the committed live build.
const { launch, dragShot } = require('./helpers');

const st = page => page.evaluate(() => ({
  state: GameLoop.getState(), rem: GameLoop.getRemaining(),
  lvl: Structure.levelIndex(), bodies: Matter.Composite.allBodies(Game.world).length,
  birds: Structure.level().birds,
}));
const results = [];
const check = (n, p, d) => { results.push({ n, p }); console.log((p ? 'PASS ' : 'FAIL ') + n + (d ? '  :: ' + d : '')); };

(async () => {
  const { browser, page, errors } = await launch();

  // 1. level:cleared after LOSE
  await page.evaluate(() => { for (let i = 0; i < 3; i++) { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); } });
  await page.waitForTimeout(300);
  await page.evaluate(() => Game.events.emit('level:cleared', {}));
  await page.waitForTimeout(900);
  let s = await st(page);
  check('late level:cleared after LOSE flips to win', s.state === 'win', 'state=' + s.state);
  await page.screenshot({ path: 'test/screens/critic-loop-final-late-clear.png' });

  // 2. fire a bird after the level is won (inside the 600ms win reveal)
  await page.keyboard.press('r'); await page.waitForTimeout(700);
  await page.evaluate(() => Game.events.emit('level:cleared', {}));
  await page.waitForTimeout(180);
  await dragShot(page, -105, 30).catch(e => console.log('   drag threw ' + e.message));
  await page.waitForTimeout(500);
  const flying = await page.evaluate(() => { const b = Slingshot.getBird(); return b ? !b.isStatic : false; });
  s = await st(page);
  check('no bird can be fired after the level is won', flying === false, `flying=${flying} state=${s.state} rem=${s.rem}`);
  await page.screenshot({ path: 'test/screens/critic-loop-final-shot-after-win.png' });

  // 3. overlay click landing on the slingshot (restart + accidental grab)
  await page.keyboard.press('r'); await page.waitForTimeout(700);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) { Game.events.emit('bird:launched', {}); Game.events.emit('bird:dead', {}); } });
  await page.waitForTimeout(900);
  await page.mouse.move(220, 505);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.move(130, 550, { steps: 8 });
  await page.waitForTimeout(90);
  const grabbed = await page.evaluate(() => { const b = Slingshot.getBird(); return b ? { x: b.position.x | 0, y: b.position.y | 0 } : null; });
  await page.mouse.up();
  await page.waitForTimeout(700);
  s = await st(page);
  check('overlay click on the sling does not fire the fresh bird', s.rem === s.birds,
        `rem=${s.rem}/${s.birds} birdWhileDragging=${JSON.stringify(grabbed)} (anchor is 220,505)`);
  await page.screenshot({ path: 'test/screens/critic-loop-final-overlay-click-sling.png' });

  // 4. R during the overlay fade, then immediately N (stale win input)
  await page.keyboard.press('r'); await page.waitForTimeout(700);
  await page.evaluate(() => Game.events.emit('level:cleared', {}));
  await page.waitForTimeout(700);
  await page.keyboard.press('r'); await page.waitForTimeout(120);
  await page.keyboard.press('n'); await page.waitForTimeout(600);
  s = await st(page);
  check('R then N during a fade does not skip a level', s.lvl === 0 && s.state === 'playing' && s.rem === s.birds,
        JSON.stringify(s));

  // 5. spam level keys + R together
  for (const k of ['r', '3', 'r', '5', 'n', 'r', '1', 'r', 'r']) { await page.keyboard.press(k); await page.waitForTimeout(45); }
  await page.waitForTimeout(700);
  s = await st(page);
  const birds = await page.evaluate(() => Matter.Composite.allBodies(Game.world).filter(b => b.label === 'bird').length);
  check('key mashing leaves a single coherent state', s.state === 'playing' && s.rem === s.birds && birds === 1,
        JSON.stringify({ ...s, birdBodies: birds }));

  console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
  console.log('SUMMARY ' + results.filter(r => r.p).length + '/' + results.length);
  await browser.close();
})();
