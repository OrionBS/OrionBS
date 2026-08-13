// gameloop.js — module GameLoop
// Attempts, HUD, win/lose overlays, restart and screenshake.
// Consumes: bird:loaded, bird:launched, bird:dead, enemy:killed, impact
// Emits:    attempt:spent {remaining}, level:reset {}
(function () {
  'use strict';

  const DEFAULT_BIRDS = 3;
  const RELOAD_BEAT_MS = 700;   // pause after a dead bird before nocking the next
  const WIN_REVEAL_MS = 600;    // let the pop/physics settle before the veil
  const OVERLAY_FADE_MS = 450;

  // --- state -----------------------------------------------------------------
  let state = 'playing';        // 'playing' | 'win' | 'lose'
  let totalBirds = DEFAULT_BIRDS; // budget for the current level
  let remaining = DEFAULT_BIRDS;  // birds not yet launched
  let inFlight = false;         // a launched bird is still resolving
  let starsAtWin = 0;

  // updater-driven timers (ms remaining; <0 = inactive)
  let reloadTimerMs = -1;
  let overlayDelayMs = -1;      // countdown before the overlay starts fading in
  let overlayAlpha = 0;         // 0..1 fade progress
  let overlayVisible = false;

  // screenshake
  let trauma = 0;               // 0..1
  const SHAKE_MAX_PX = 8;
  const TRAUMA_PER_ENERGY = 0.012; // energy 50 → +0.6 trauma
  const TRAUMA_DECAY_PER_MS = 0.0016;
  let shakeApplied = false;

  // --- helpers ---------------------------------------------------------------
  function enemyAlive() {
    try {
      if (typeof Structure !== 'undefined' && Structure.enemyAlive) {
        return !!Structure.enemyAlive();
      }
    } catch (e) { /* tolerate stubs */ }
    return true;
  }

  function attemptNumber() {
    const n = totalBirds - remaining + (inFlight ? 0 : 1);
    return Math.max(1, Math.min(totalBirds, n));
  }

  // Bird budget comes from the level definition; fall back for stubbed modules.
  function birdsForLevel() {
    try {
      const lv = Structure.level && Structure.level();
      if (lv && typeof lv.birds === 'number') return lv.birds;
    } catch (e) { /* tolerate stubs */ }
    return DEFAULT_BIRDS;
  }

  function levelInfo() {
    try {
      if (Structure.level) {
        return {
          index: Structure.levelIndex(),
          count: Structure.levelCount(),
          name: Structure.level().name,
          difficulty: Structure.level().difficulty,
          left: Structure.enemiesLeft ? Structure.enemiesLeft() : 0,
        };
      }
    } catch (e) { /* tolerate stubs */ }
    return null;
  }

  function isLastLevel() {
    const info = levelInfo();
    return !!info && info.index >= info.count - 1;
  }

  // Rebuild the current level from scratch.
  function restart() {
    totalBirds = birdsForLevel();
    state = 'playing';
    remaining = totalBirds;
    inFlight = false;
    starsAtWin = 0;
    reloadTimerMs = -1;
    overlayDelayMs = -1;
    overlayAlpha = 0;
    overlayVisible = false;
    trauma = 0;
    clearShake();
    Game.events.emit('level:reset', {});
    // Contract: slingshot nocks a fresh bird on level:reset — nothing else to do.
  }

  // Switch to another level, then start it fresh.
  function goToLevel(i) {
    try {
      if (Structure.loadLevel) Structure.loadLevel(i);
    } catch (e) { /* tolerate stubs */ }
    totalBirds = birdsForLevel();
    restart();
  }

  function nextLevel() {
    const info = levelInfo();
    goToLevel(info ? info.index + 1 : 0);
  }

  function clearShake() {
    if (shakeApplied) {
      Game.canvas.style.transform = '';
      shakeApplied = false;
    }
  }

  function toWin() {
    if (state !== 'playing') return; // guard double transitions
    state = 'win';
    starsAtWin = Math.max(1, Math.min(3, remaining + 1));
    reloadTimerMs = -1;             // cancel any pending reload beat
    overlayDelayMs = WIN_REVEAL_MS; // let the pop read before the veil
  }

  function toLose() {
    if (state !== 'playing') return;
    state = 'lose';
    reloadTimerMs = -1;
    overlayDelayMs = 0;
  }

  // --- event wiring ----------------------------------------------------------
  function wireEvents() {
    Game.events.on('bird:loaded', function () {
      inFlight = false;
    });

    Game.events.on('bird:launched', function () {
      if (state !== 'playing') return;
      if (remaining <= 0) return;
      remaining -= 1;
      inFlight = true;
      Game.events.emit('attempt:spent', { remaining: remaining });
    });

    Game.events.on('bird:dead', function () {
      if (state !== 'playing') return; // e.g. arrives after enemy:killed
      inFlight = false;
      if (!enemyAlive()) return;       // enemy:killed handles the transition
      if (remaining > 0) {
        reloadTimerMs = RELOAD_BEAT_MS; // small beat, then nock the next bird
      } else {
        toLose();
      }
    });

    // A level is only won once every enemy is down.
    Game.events.on('level:cleared', function () {
      toWin();
    });

    Game.events.on('impact', function (d) {
      const energy = (d && typeof d.energy === 'number') ? d.energy : 0;
      if (energy <= 0) return;
      trauma = Math.min(1, trauma + Math.min(0.7, energy * TRAUMA_PER_ENERGY));
    });
  }

  function wireInput() {
    window.addEventListener('keydown', function (e) {
      if (e.key === 'r' || e.key === 'R') { restart(); return; }
      // N advances after a win; on the last level it loops back to level 1.
      if (e.key === 'n' || e.key === 'N') {
        if (state === 'win') { isLastLevel() ? goToLevel(0) : nextLevel(); }
        return;
      }
      // Number keys jump straight to a level, for practice.
      if (e.key >= '1' && e.key <= '9') {
        const i = parseInt(e.key, 10) - 1;
        const info = levelInfo();
        if (info && i < info.count) goToLevel(i);
      }
    });
    // Click advances/restarts only while an overlay is showing (drags keep working).
    Game.canvas.addEventListener('pointerdown', function () {
      if (state === 'playing' || !overlayVisible) return;
      if (state === 'win') { isLastLevel() ? goToLevel(0) : nextLevel(); }
      else restart();
    });
  }

  // --- update ----------------------------------------------------------------
  function update(dt) {
    // reload beat
    if (reloadTimerMs >= 0) {
      reloadTimerMs -= dt;
      if (reloadTimerMs < 0) {
        reloadTimerMs = -1;
        if (state === 'playing' && enemyAlive() && remaining > 0) {
          try { Slingshot.loadBird(); } catch (e) { /* tolerate stubs */ }
        }
      }
    }

    // overlay reveal + fade
    if (state !== 'playing') {
      if (overlayDelayMs > 0) {
        overlayDelayMs -= dt;
      } else {
        overlayVisible = true;
        overlayAlpha = Math.min(1, overlayAlpha + dt / OVERLAY_FADE_MS);
      }
    }

    // screenshake decay
    if (trauma > 0) {
      trauma = Math.max(0, trauma - TRAUMA_DECAY_PER_MS * dt);
      const shake = trauma * trauma * SHAKE_MAX_PX;
      if (shake > 0.15) {
        const a = Math.random() * Math.PI * 2;
        const dx = (Math.cos(a) * shake).toFixed(2);
        const dy = (Math.sin(a) * shake).toFixed(2);
        Game.canvas.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        shakeApplied = true;
      } else {
        trauma = 0;
        clearShake();
      }
    } else {
      clearShake();
    }
  }

  // --- drawing ---------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Tiny version of the bird look: round red body, cream belly, expressive eyes.
  function drawBirdIcon(ctx, x, y, r, alive) {
    ctx.save();
    ctx.globalAlpha = alive ? 1 : 0.28;
    // body
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e04b3a';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(90,20,12,0.7)';
    ctx.stroke();
    // belly
    ctx.beginPath();
    ctx.arc(x, y + r * 0.35, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#f6d7a8';
    ctx.fill();
    // eyes
    const ex = r * 0.34, ey = r * 0.25, er = r * 0.3;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - ex, y - ey, er, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + ex, y - ey, er, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(x - ex + er * 0.3, y - ey, er * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + ex + er * 0.3, y - ey, er * 0.45, 0, Math.PI * 2); ctx.fill();
    // beak
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.moveTo(x + r * 0.15, y + r * 0.05);
    ctx.lineTo(x + r * 0.75, y + r * 0.18);
    ctx.lineTo(x + r * 0.15, y + r * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawStar(ctx, cx, cy, rOuter, rInner) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 === 0) ? rOuter : rInner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawHUD(ctx) {
    const info = levelInfo();
    const x = 16, y = 16, w = 232, h = info ? 94 : 68, pad = 14;
    ctx.save();
    // panel
    roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(20, 32, 48, 0.55)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
    // level name + difficulty
    let rowY = y + pad;
    if (info) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText('Fase ' + (info.index + 1) + '/' + info.count + ' — ' + info.name, x + pad, rowY);
      ctx.fillStyle = info.difficulty === 'Difícil' ? '#ff9b7a'
        : info.difficulty === 'Médio' ? '#ffd479' : '#9ee37d';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(info.difficulty.toUpperCase(), x + pad, rowY + 19);
      // enemies left, right-aligned on the same row
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(info.left + (info.left === 1 ? ' alvo' : ' alvos'), x + w - pad, rowY + 19);
      rowY += 40;
    }
    // bird icons (remaining = still filled, spent = ghosted)
    const iconR = 11;
    for (let i = 0; i < totalBirds; i++) {
      drawBirdIcon(ctx, x + pad + iconR + i * (iconR * 2 + 8), rowY + iconR - 2, iconR, i < remaining);
    }
    // attempts counter
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Tentativa ' + attemptNumber() + '/' + totalBirds, x + pad, y + h - 12);
    ctx.restore();
  }

  function drawOverlay(ctx) {
    if (!overlayVisible || overlayAlpha <= 0) return;
    const a = overlayAlpha;
    const cx = Game.W / 2, cy = Game.H / 2;
    ctx.save();

    // dark translucent veil fading in
    ctx.fillStyle = 'rgba(8, 12, 22, ' + (0.62 * a).toFixed(3) + ')';
    ctx.fillRect(0, 0, Game.W, Game.H);

    ctx.globalAlpha = a;
    ctx.textAlign = 'center';

    if (state === 'win') {
      // stars
      const n = starsAtWin;
      const gap = 96;
      const startX = cx - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        const sx = startX + i * gap;
        const sy = cy - 130;
        drawStar(ctx, sx, sy, 34, 14);
        ctx.fillStyle = '#ffcf3f';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#c98f14';
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 64px system-ui, sans-serif';
      ctx.fillText(isLastLevel() ? 'Você zerou o jogo! 🏆' : 'Fase concluída! 🎉', cx, cy - 10);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 58px system-ui, sans-serif';
      ctx.fillText('Acabaram os pássaros…', cx, cy - 10);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '400 24px system-ui, sans-serif';
    const hint = state === 'win'
      ? (isLastLevel()
          ? 'N ou clique para voltar à fase 1 · R repete esta fase'
          : 'N ou clique para a próxima fase · R repete esta fase')
      : 'Pressione R ou clique para tentar de novo';
    ctx.fillText(hint, cx, cy + 48);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '400 17px system-ui, sans-serif';
    ctx.fillText('Teclas 1–5 escolhem a fase', cx, cy + 84);

    ctx.restore();
  }

  function render(ctx) {
    drawHUD(ctx);
    drawOverlay(ctx);
  }

  // --- public API ------------------------------------------------------------
  window.GameLoop = {
    init: function () {
      wireEvents();
      wireInput();
      totalBirds = birdsForLevel();
      remaining = totalBirds;
      Game.updaters.push(update);
      Game.renderers.push(render); // init() runs last in main.js → HUD on top
    },
    getState: function () { return state; },
    getRemaining: function () { return remaining; },
    getTotalBirds: function () { return totalBirds; },
    goToLevel: goToLevel,
    nextLevel: nextLevel,
  };
})();
