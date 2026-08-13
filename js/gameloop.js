// gameloop.js — module GameLoop
// Attempts, HUD, win/lose overlays, restart and screenshake.
// Consumes: bird:loaded, bird:launched, bird:dead, enemy:killed, impact
// Emits:    attempt:spent {remaining}, level:reset {}
(function () {
  'use strict';

  const TOTAL_BIRDS = 3;
  const RELOAD_BEAT_MS = 700;   // pause after a dead bird before nocking the next
  const WIN_REVEAL_MS = 600;    // let the pop/physics settle before the veil
  const OVERLAY_FADE_MS = 450;

  // --- state -----------------------------------------------------------------
  let state = 'playing';        // 'playing' | 'win' | 'lose'
  let remaining = TOTAL_BIRDS;  // birds not yet launched
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
    const n = TOTAL_BIRDS - remaining + (inFlight ? 0 : 1);
    return Math.max(1, Math.min(TOTAL_BIRDS, n));
  }

  function restart() {
    state = 'playing';
    remaining = TOTAL_BIRDS;
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

    Game.events.on('enemy:killed', function () {
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
      if (e.key === 'r' || e.key === 'R') restart();
    });
    // Click restarts only while an overlay is showing (drags must keep working).
    Game.canvas.addEventListener('pointerdown', function () {
      if (state !== 'playing' && overlayVisible) restart();
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
    const x = 16, y = 16, w = 200, h = 68, pad = 14;
    ctx.save();
    // panel
    roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(20, 32, 48, 0.55)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
    // bird icons (remaining = still filled, spent = ghosted)
    const iconR = 11;
    for (let i = 0; i < TOTAL_BIRDS; i++) {
      drawBirdIcon(ctx, x + pad + iconR + i * (iconR * 2 + 8), y + pad + iconR - 2, iconR, i < remaining);
    }
    // attempts counter
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Tentativa ' + attemptNumber() + '/' + TOTAL_BIRDS, x + pad, y + h - 12);
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
      ctx.fillText('Nível limpo! 🎉', cx, cy - 10);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 58px system-ui, sans-serif';
      ctx.fillText('Acabaram os pássaros…', cx, cy - 10);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '400 24px system-ui, sans-serif';
    ctx.fillText('Pressione R ou clique para jogar de novo', cx, cy + 48);

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
      Game.updaters.push(update);
      Game.renderers.push(render); // init() runs last in main.js → HUD on top
    },
    getState: function () { return state; },
    getRemaining: function () { return remaining; },
  };
})();
