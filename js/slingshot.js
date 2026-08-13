// slingshot.js — module Slingshot.
// Original round bird character, pointer drag + deterministic launch,
// trajectory preview matching Matter's integration, sling art + launch polish.
(function () {
  'use strict';

  const Bodies = Matter.Bodies;
  const Body = Matter.Body;
  const Composite = Matter.Composite;
  const Sleeping = Matter.Sleeping;

  // --- Tuning ---------------------------------------------------------------
  const ANCHOR = { x: 220, y: 505 };  // pouch rest point at the fork top
  const BIRD_R = 22;
  const MAX_PULL = 110;               // px, clamp radius around anchor
  const GRAB_R = 70;                  // generous grab radius around the bird
  const MIN_PULL = 10;                // below this a release is a dud (re-nock)
  const K = 0.14;                     // launch speed (px/step) per px of pull
  const V_MAX = 16;                   // speed cap in px/step (~960 px/s)
  const FOLLOW = 0.6;                 // elastic lerp toward pointer, per 60Hz frame
  const STEP_DT = 1000 / 60;          // engine fixed step (ms)
  const FLY_TIMEOUT = 8000;           // ms until forced bird:dead
  const SLOW_SPEED = 0.2;             // px/step considered "stopped"
  const SLOW_TIME = 1500;             // ms below SLOW_SPEED before bird:dead
  const OFF_MARGIN = 80;              // px beyond screen bounds = gone

  // Sling fork geometry
  const FORK = {
    baseY: 648,
    splitY: 566,
    backTip: { x: ANCHOR.x - 16, y: ANCHOR.y - 2 },   // left prong (behind bird)
    frontTip: { x: ANCHOR.x + 16, y: ANCHOR.y + 5 },  // right prong (in front)
  };

  // --- State ----------------------------------------------------------------
  const state = {
    phase: 'empty',        // 'empty' | 'nocked' | 'dragging' | 'flying'
    bird: null,
    dragPos: null,         // smoothed visual/body position while dragging
    target: null,          // clamped pointer position (authoritative for launch)
    previewPts: null,      // per-step predicted points while dragging
    flyMs: 0,
    slowMs: 0,
    stretchFrames: 0,      // in-flight stretch frames remaining
    snap: null,            // band snap anim {t, dur, dx, dy}
    trail: [],             // speed streak particles
    time: 0,               // accumulated updater time (visual timers)
    inited: false,
  };

  // --- Helpers --------------------------------------------------------------
  function toCanvas(clientX, clientY) {
    const r = Game.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (Game.canvas.width / r.width),
      y: (clientY - r.top) * (Game.canvas.height / r.height),
    };
  }

  function clampToPull(p) {
    const dx = p.x - ANCHOR.x, dy = p.y - ANCHOR.y;
    const d = Math.hypot(dx, dy);
    if (d <= MAX_PULL) return { x: p.x, y: p.y };
    const s = MAX_PULL / d;
    return { x: ANCHOR.x + dx * s, y: ANCHOR.y + dy * s };
  }

  function launchVelocity(pos) {
    const dx = ANCHOR.x - pos.x, dy = ANCHOR.y - pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return { x: 0, y: 0 };
    const speed = Math.min(K * d, V_MAX);
    return { x: (dx / d) * speed, y: (dy / d) * speed };
  }

  // Predict the flight path with the same integration Matter 0.20 performs at
  // a fixed 60 Hz step: each step v.y += gravity.y * gravity.scale * dt^2,
  // then p += v (frictionAir is 0 on the bird, so this is exact).
  function predictPath(vel, origin, maxSteps) {
    const grav = Game.engine.gravity;
    const g = grav.y * (grav.scale !== undefined ? grav.scale : 0.001) * STEP_DT * STEP_DT;
    let px = origin.x, py = origin.y, vx = vel.x, vy = vel.y;
    const pts = [];
    for (let i = 0; i < maxSteps; i++) {
      vy += g;
      px += vx;
      py += vy;
      pts.push({ x: px, y: py });
      if (py > Game.GROUND_Y - BIRD_R * 0.5 || px > Game.W + 40 || px < -40) break;
    }
    return pts;
  }

  // --- Bird lifecycle -------------------------------------------------------
  function removeBird() {
    if (state.bird) {
      Composite.remove(Game.world, state.bird);
      state.bird = null;
    }
    state.phase = 'empty';
    state.previewPts = null;
    state.trail.length = 0;
  }

  function loadBird() {
    removeBird();
    const bird = Bodies.circle(ANCHOR.x, ANCHOR.y, BIRD_R, {
      label: 'bird',
      density: 0.004,
      restitution: 0.35,
      friction: 0.5,
      frictionAir: 0,
    });
    Body.setStatic(bird, true); // held by the sling until release
    Composite.add(Game.world, bird);
    state.bird = bird;
    state.phase = 'nocked';
    state.dragPos = { x: ANCHOR.x, y: ANCHOR.y };
    state.target = { x: ANCHOR.x, y: ANCHOR.y };
    Game.events.emit('bird:loaded', { bird: bird });
  }

  function killBird() {
    const bird = state.bird;
    if (!bird) return;
    Game.events.emit('bird:dead', { bird: bird });
    removeBird(); // also clears the trail; GameLoop decides what happens next
  }

  // --- Pointer input --------------------------------------------------------
  function startDrag(p) {
    if (state.phase !== 'nocked') return false;
    const b = state.bird.position;
    if (Math.hypot(p.x - b.x, p.y - b.y) > GRAB_R &&
        Math.hypot(p.x - ANCHOR.x, p.y - ANCHOR.y) > GRAB_R) return false;
    state.phase = 'dragging';
    state.target = clampToPull(p);
    state.dragPos = { x: b.x, y: b.y };
    Game.canvas.style.cursor = 'grabbing';
    return true;
  }

  function moveDrag(p) {
    if (state.phase !== 'dragging') return;
    state.target = clampToPull(p);
  }

  function release() {
    if (state.phase !== 'dragging') return;
    Game.canvas.style.cursor = 'default';
    const target = state.target;
    const pull = Math.hypot(target.x - ANCHOR.x, target.y - ANCHOR.y);
    state.previewPts = null;

    if (pull < MIN_PULL) { // dud: settle back into the pouch
      Body.setPosition(state.bird, { x: ANCHOR.x, y: ANCHOR.y });
      state.dragPos = { x: ANCHOR.x, y: ANCHOR.y };
      state.phase = 'nocked';
      return;
    }

    // Launch is a pure function of the clamped pointer (deterministic):
    // snap the body to the target, then set velocity from the pull vector.
    const bird = state.bird;
    const vel = launchVelocity(target);
    Body.setPosition(bird, { x: target.x, y: target.y });
    Body.setStatic(bird, false);
    Sleeping.set(bird, false);
    Body.setVelocity(bird, vel);

    state.phase = 'flying';
    state.flyMs = 0;
    state.slowMs = 0;
    state.stretchFrames = 12;
    state.snap = { t: 0, dur: 150, dx: target.x - ANCHOR.x, dy: target.y - ANCHOR.y };
    Slingshot._lastLaunchPrediction = predictPath(vel, target, 90); // test hook
    Game.events.emit('bird:launched', { bird: bird, velocity: { x: vel.x, y: vel.y } });
  }

  function bindInput() {
    const canvas = Game.canvas;

    canvas.addEventListener('mousedown', function (e) {
      if (startDrag(toCanvas(e.clientX, e.clientY))) e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      const p = toCanvas(e.clientX, e.clientY);
      if (state.phase === 'dragging') {
        moveDrag(p);
      } else if (state.phase === 'nocked' && state.bird) {
        const b = state.bird.position;
        canvas.style.cursor =
          Math.hypot(p.x - b.x, p.y - b.y) <= GRAB_R ? 'grab' : 'default';
      }
    });
    window.addEventListener('mouseup', release);

    canvas.addEventListener('touchstart', function (e) {
      const t = e.changedTouches[0];
      if (startDrag(toCanvas(t.clientX, t.clientY))) e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      if (state.phase !== 'dragging') return;
      const t = e.changedTouches[0];
      moveDrag(toCanvas(t.clientX, t.clientY));
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', release);
    canvas.addEventListener('touchcancel', release);
  }

  // --- Update ---------------------------------------------------------------
  function update(dtMs) {
    state.time += dtMs;

    // Band snap animation timer
    if (state.snap) {
      state.snap.t += dtMs;
      if (state.snap.t >= state.snap.dur) state.snap = null;
    }

    // Trail particle aging
    for (let i = state.trail.length - 1; i >= 0; i--) {
      const p = state.trail[i];
      p.life -= dtMs;
      if (p.life <= 0) state.trail.splice(i, 1);
    }

    if (state.phase === 'dragging' && state.bird) {
      // Elastic follow: lerp toward the clamped pointer.
      const dp = state.dragPos, t = state.target;
      dp.x += (t.x - dp.x) * FOLLOW;
      dp.y += (t.y - dp.y) * FOLLOW;
      Body.setPosition(state.bird, { x: dp.x, y: dp.y });
      state.previewPts = predictPath(launchVelocity(t), t, 90);
    }

    if (state.phase === 'flying' && state.bird) {
      const bird = state.bird;
      state.flyMs += dtMs;
      if (state.stretchFrames > 0) state.stretchFrames--;

      // Speed streaks while moving fast
      if (bird.speed > 7) {
        const v = bird.velocity;
        state.trail.push({
          x: bird.position.x - v.x * 1.2 + (Math.random() - 0.5) * 8,
          y: bird.position.y - v.y * 1.2 + (Math.random() - 0.5) * 8,
          vx: v.x, vy: v.y,
          life: 260, maxLife: 260,
        });
      }

      // Death monitoring
      if (bird.speed < SLOW_SPEED) state.slowMs += dtMs;
      else state.slowMs = 0;

      const p = bird.position;
      const off = p.x < -OFF_MARGIN || p.x > Game.W + OFF_MARGIN || p.y > Game.H + OFF_MARGIN;
      if (bird.isSleeping || off || state.flyMs >= FLY_TIMEOUT || state.slowMs >= SLOW_TIME) {
        killBird();
      }
    }
  }

  // --- Rendering ------------------------------------------------------------
  function bandAttachPoint() {
    // Where the rubber bands terminate right now.
    if (state.phase === 'nocked' || state.phase === 'dragging') {
      return { x: state.bird.position.x, y: state.bird.position.y, taut: true };
    }
    if (state.snap) {
      // Springy return: decaying oscillation from release point back to rest.
      const t = state.snap.t / state.snap.dur;               // 0..1
      const amp = Math.exp(-4.5 * t) * Math.cos(t * Math.PI * 4);
      return {
        x: ANCHOR.x + state.snap.dx * amp,
        y: ANCHOR.y + state.snap.dy * amp,
        taut: true,
      };
    }
    return { x: ANCHOR.x, y: ANCHOR.y + 14, taut: false }; // slack pouch droop
  }

  function bandThickness() {
    let pull = 0;
    if (state.phase === 'dragging' || state.phase === 'nocked') {
      pull = Math.hypot(state.bird.position.x - ANCHOR.x, state.bird.position.y - ANCHOR.y);
    }
    return Math.max(3, 7 - 4.2 * (pull / MAX_PULL));
  }

  function drawBand(ctx, from, to, width, color, slack) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    if (slack) {
      const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2 + 10;
      ctx.quadraticCurveTo(mx, my, to.x, to.y);
    } else {
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  }

  function drawFork(ctx, front) {
    ctx.lineCap = 'round';
    if (!front) {
      // trunk
      ctx.strokeStyle = '#7a4a21';
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(ANCHOR.x, FORK.baseY);
      ctx.lineTo(ANCHOR.x, FORK.splitY);
      ctx.stroke();
      // back (left) prong
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(ANCHOR.x, FORK.splitY + 4);
      ctx.quadraticCurveTo(FORK.backTip.x - 3, FORK.splitY - 26, FORK.backTip.x, FORK.backTip.y);
      ctx.stroke();
      // wood grain hint
      ctx.strokeStyle = 'rgba(60,34,12,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ANCHOR.x - 3, FORK.baseY - 4);
      ctx.lineTo(ANCHOR.x - 3, FORK.splitY + 10);
      ctx.stroke();
    } else {
      // front (right) prong
      ctx.strokeStyle = '#94622f';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(ANCHOR.x, FORK.splitY + 4);
      ctx.quadraticCurveTo(FORK.frontTip.x + 3, FORK.splitY - 24, FORK.frontTip.x, FORK.frontTip.y);
      ctx.stroke();
      // prong tip caps
      ctx.fillStyle = '#6b3f1c';
      ctx.beginPath();
      ctx.ellipse(FORK.frontTip.x, FORK.frontTip.y, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(FORK.backTip.x, FORK.backTip.y, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPreview(ctx) {
    const pts = state.previewPts;
    if (!pts || pts.length === 0) return;
    const every = 3; // one dot per 3 steps (50 ms), evenly spaced in time
    let n = 0;
    const total = Math.floor(pts.length / every);
    for (let i = every - 1; i < pts.length; i += every) {
      const p = pts[i];
      const f = total > 1 ? n / (total - 1) : 0; // 0..1 along the arc
      const alpha = 0.85 * (1 - f * 0.85);
      const r = 4.2 - 2.2 * f;
      ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,60,70,' + (alpha * 0.5).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
      n++;
    }
  }

  function drawTrail(ctx) {
    for (let i = 0; i < state.trail.length; i++) {
      const p = state.trail[i];
      const f = p.life / p.maxLife;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * f).toFixed(3) + ')';
      ctx.lineWidth = 3 * f + 0.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.9, p.y - p.vy * 0.9);
      ctx.stroke();
    }
  }

  // Original character: round teal bird, big eyes, tiny orange beak, head tuft.
  function drawBird(ctx) {
    const bird = state.bird;
    if (!bird) return;
    const pos = bird.position;

    // Directional squash & stretch
    let axisAngle = 0, sAlong = 1, sPerp = 1, featureAngle = 0;
    if (state.phase === 'dragging' || state.phase === 'nocked') {
      const dx = pos.x - ANCHOR.x, dy = pos.y - ANCHOR.y;
      const pull = Math.hypot(dx, dy);
      if (pull > 2) {
        axisAngle = Math.atan2(dy, dx);
        const t = pull / MAX_PULL;
        sAlong = 1 + 0.16 * t;
        sPerp = 1 - 0.09 * t;
      }
    } else if (state.phase === 'flying') {
      featureAngle = bird.angle;
      if (state.stretchFrames > 0 && bird.speed > 2) {
        axisAngle = Math.atan2(bird.velocity.y, bird.velocity.x);
        const s = (state.stretchFrames / 12) * Math.min(bird.speed / V_MAX, 1);
        sAlong = 1 + 0.22 * s;
        sPerp = 1 - 0.12 * s;
      }
    }

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(axisAngle);
    ctx.scale(sAlong, sPerp);
    ctx.rotate(-axisAngle);
    ctx.rotate(featureAngle);

    const r = BIRD_R;
    // body
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.2, 0, 0, r * 1.15);
    grad.addColorStop(0, '#3ecfc4');
    grad.addColorStop(1, '#178f86');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0d5f59';
    ctx.lineWidth = 2;
    ctx.stroke();

    // belly patch
    ctx.fillStyle = 'rgba(235,250,246,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.45, r * 0.55, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    // head tuft (two little feathers)
    ctx.strokeStyle = '#0d5f59';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.9);
    ctx.quadraticCurveTo(-r * 0.4, -r * 1.45, -r * 0.55, -r * 1.25);
    ctx.moveTo(r * 0.1, -r * 0.95);
    ctx.quadraticCurveTo(r * 0.12, -r * 1.5, r * 0.35, -r * 1.4);
    ctx.stroke();

    // eyes (blink every ~3.4 s, purely visual)
    const blink = (state.time % 3400) < 110 ? 0.15 : 1;
    const eyeR = r * 0.34;
    for (let s = -1; s <= 1; s += 2) {
      const ex = s * r * 0.34, ey = -r * 0.18;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, ey, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d5f59';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (blink === 1) {
        ctx.fillStyle = '#20262b';
        ctx.beginPath();
        ctx.arc(ex + r * 0.09, ey + r * 0.04, eyeR * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ex + r * 0.03, ey - r * 0.03, eyeR * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // determined brows
    ctx.strokeStyle = '#0d5f59';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, -r * 0.52);
    ctx.lineTo(-r * 0.12, -r * 0.42);
    ctx.moveTo(r * 0.62, -r * 0.52);
    ctx.lineTo(r * 0.12, -r * 0.42);
    ctx.stroke();

    // tiny beak
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.moveTo(r * 0.02, r * 0.08);
    ctx.lineTo(r * 0.52, r * 0.22);
    ctx.lineTo(r * 0.04, r * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#c77f12';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  function render(ctx) {
    const attach = bandAttachPoint();
    const width = bandThickness();

    drawFork(ctx, false);                                       // trunk + back prong
    drawBand(ctx, FORK.backTip, attach, width, '#5b3620', !attach.taut); // back band
    drawPreview(ctx);
    drawTrail(ctx);
    drawBird(ctx);

    // pouch strip at the band end (only when something is held / snapping)
    if (attach.taut) {
      const ang = Math.atan2(attach.y - ANCHOR.y, attach.x - ANCHOR.x);
      ctx.save();
      ctx.translate(attach.x, attach.y);
      ctx.rotate(ang);
      ctx.fillStyle = '#4a2b17';
      ctx.beginPath();
      const held = state.phase === 'nocked' || state.phase === 'dragging';
      const pr = held ? BIRD_R * 0.75 : 8;
      ctx.roundRect(held ? 2 : -3, -pr, 7, pr * 2, 3);
      ctx.fill();
      ctx.restore();
    }

    drawBand(ctx, FORK.frontTip, attach, width, '#6f4326', !attach.taut); // front band
    drawFork(ctx, true);                                        // front prong
  }

  // --- Public API -----------------------------------------------------------
  window.Slingshot = {
    init: function () {
      if (state.inited) return;
      state.inited = true;
      bindInput();
      Game.updaters.push(update);
      Game.renderers.push(render);
      Game.events.on('level:reset', function () {
        loadBird(); // removes any flying/nocked bird and nocks a fresh one
      });
      loadBird(); // first bird of the session
    },
    loadBird: loadBird,
    getBird: function () { return state.bird; },
    // test hooks (not part of the gameplay contract)
    _predict: predictPath,
    _lastLaunchPrediction: null,
  };
})();
