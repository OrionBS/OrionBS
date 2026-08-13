// destruction.js — module Structure: builds the target structure, applies
// impact damage, fragments dead blocks into debris + dust, and owns the enemy.
//
// Public API: Structure.init(), Structure.reset(), Structure.enemyAlive()
// Emits: 'enemy:killed' {enemy}, 'impact' {x, y, energy}
// Consumes: 'level:reset'
(function () {
  'use strict';

  var Bodies = Matter.Bodies;
  var Body = Matter.Body;
  var Composite = Matter.Composite;
  var Events = Matter.Events;

  // ---------------------------------------------------------------- tuning
  var MATERIALS = {
    wood: {
      density: 0.004, friction: 0.85, frictionStatic: 1.1, restitution: 0.02,
      hp: 50,
      fill: '#c89b5a', edge: '#8a6537', grain: 'rgba(118,79,37,0.55)',
      dust: ['#d9bc8c', '#c3a06a', '#a98552'],
    },
    stone: {
      density: 0.008, friction: 0.9, frictionStatic: 1.2, restitution: 0.01,
      hp: 125, // 2.5x wood
      fill: '#9aa1a8', edge: '#5f666d', grain: null,
      dust: ['#b7bdc3', '#9aa1a8', '#7e858c'],
    },
  };

  // Impact energy = 0.5 * reducedMass * (relative velocity along normal)^2.
  // Resting stacks produce energies well below BLOCK_DMG_MIN, so they never chip.
  var BLOCK_DMG_MIN = 8;        // energy below this never damages a block
  var BLOCK_DMG_SCALE = 0.08;   // hp lost per unit of energy above the floor
  var ENEMY_HP = 30;
  var ENEMY_DMG_MIN = 4;        // gentle touches stay below this
  var ENEMY_DMG_SCALE = 0.25;   // direct bird hit (~300+ energy) is instant death
  var ENEMY_R = 20;
  var IMPACT_EVENT_MIN = 60;    // emit 'impact' (screenshake) above this energy
  var DUST_MIN_ENERGY = 15;     // spawn contact dust above this energy
  var DEBRIS_LIFE_MS = 4000;    // debris despawns after this ...
  var DEBRIS_SLEEP_MS = 2000;   // ... or once asleep this long
  var DEBRIS_FADE_MS = 450;
  var DEBRIS_BREAK_ENERGY = 180; // a big hit shatters debris into dust
  var BLINK_PERIOD_MS = 3000;
  var BLINK_LEN_MS = 140;
  var MAX_PARTICLES = 400;

  // ------------------------------------------------- deterministic layout
  // Ground top is Game.GROUND_Y (640). Every block spawns exactly touching
  // its support (bottom edge == support top edge) so the stack settles by
  // less than a pixel and falls asleep.
  var LAYOUT = [
    // first story: two wood columns + wood beam
    { mat: 'wood',  x: 900,  y: 580, w: 20,  h: 120 }, // left column  (520..640)
    { mat: 'wood',  x: 1060, y: 580, w: 20,  h: 120 }, // right column (520..640)
    { mat: 'wood',  x: 980,  y: 510, w: 200, h: 20  }, // beam         (500..520)
    // second story: two stone cubes above the columns + wood roof plank
    { mat: 'stone', x: 910,  y: 480, w: 40,  h: 40  }, // (460..500)
    { mat: 'stone', x: 1050, y: 480, w: 40,  h: 40  }, // (460..500)
    { mat: 'wood',  x: 980,  y: 452, w: 160, h: 16  }, // roof         (444..460)
  ];
  var ENEMY_SPAWN = { x: 980, y: 620 }; // sheltered inside the first story

  // ------------------------------------------------------------- state
  var blocks = [];       // {body, mat, def, hp, maxHp, cracksA, cracksB, dead}
  var debrisList = [];   // {body, mat, w, h, born, sleepMs, alpha, fading, dead}
  var enemy = null;      // {body, hp, dead}
  var enemyAliveFlag = false;
  var registry = {};     // body.id -> {kind, rec}
  var pendingKills = []; // records queued for removal (processed in updater)
  var particles = [];    // {x,y,vx,vy,g,life,max,size,color}
  var flashes = [];      // {x,y,life,max,rMax}
  var floaters = [];     // {x,y,vy,life,max,text}
  var blinkT = 0;
  var inited = false;

  // ------------------------------------------------------------- helpers
  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeCracks(w, h, count) {
    // cosmetic polylines in block-local coords, from one edge toward the other
    var lines = [];
    for (var i = 0; i < count; i++) {
      var horiz = Math.random() < (w >= h ? 0.3 : 0.7);
      var pts = [];
      var x, y, steps = 3, j;
      if (horiz) {
        x = -w / 2; y = rand(-h / 3, h / 3);
        for (j = 0; j <= steps; j++) {
          pts.push({ x: x + (w / steps) * j * rand(0.7, 1.0), y: y + rand(-h / 5, h / 5) });
        }
      } else {
        x = rand(-w / 3, w / 3); y = -h / 2;
        for (j = 0; j <= steps; j++) {
          pts.push({ x: x + rand(-w / 5, w / 5), y: y + (h / steps) * j * rand(0.7, 1.0) });
        }
      }
      lines.push(pts);
    }
    return lines;
  }

  function spawnDust(x, y, n, colors, speed, gravity) {
    for (var i = 0; i < n; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      var a = rand(0, Math.PI * 2);
      var s = rand(speed * 0.35, speed);
      particles.push({
        x: x + rand(-4, 4), y: y + rand(-4, 4),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3,
        g: gravity, life: rand(420, 640), max: 600,
        size: rand(2, 4.5),
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  function spawnRingBurst(x, y) {
    var n = 15;
    for (var i = 0; i < n; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      var a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
      var s = rand(3.2, 5.6);
      particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        g: 0.03, life: 550, max: 550, size: rand(2.5, 4.5),
        color: i % 2 ? '#ffffff' : '#c5f26b',
      });
    }
  }

  // -------------------------------------------------------- build / reset
  function build() {
    for (var i = 0; i < LAYOUT.length; i++) {
      var d = LAYOUT[i];
      var m = MATERIALS[d.mat];
      var body = Bodies.rectangle(d.x, d.y, d.w, d.h, {
        label: 'block',
        density: m.density,
        friction: m.friction,
        frictionStatic: m.frictionStatic,
        restitution: m.restitution,
      });
      var rec = {
        body: body, mat: d.mat, def: d, hp: m.hp, maxHp: m.hp, dead: false,
        cracksA: makeCracks(d.w, d.h, 2),
        cracksB: makeCracks(d.w, d.h, 3),
      };
      blocks.push(rec);
      registry[body.id] = { kind: 'block', rec: rec };
      Composite.add(Game.world, body);
    }
    var eb = Bodies.circle(ENEMY_SPAWN.x, ENEMY_SPAWN.y, ENEMY_R, {
      label: 'enemy',
      density: 0.0035, friction: 0.8, frictionStatic: 1.0, restitution: 0.1,
    });
    enemy = { body: eb, hp: ENEMY_HP, dead: false };
    registry[eb.id] = { kind: 'enemy', rec: enemy };
    Composite.add(Game.world, eb);
    enemyAliveFlag = true;
    blinkT = 0;
  }

  function teardown() {
    var i;
    for (i = 0; i < blocks.length; i++) {
      if (!blocks[i].dead) Composite.remove(Game.world, blocks[i].body);
    }
    for (i = 0; i < debrisList.length; i++) {
      if (!debrisList[i].dead) Composite.remove(Game.world, debrisList[i].body);
    }
    if (enemy && !enemy.dead) Composite.remove(Game.world, enemy.body);
    blocks.length = 0;
    debrisList.length = 0;
    particles.length = 0;
    flashes.length = 0;
    floaters.length = 0;
    pendingKills.length = 0;
    registry = {};
    enemy = null;
    enemyAliveFlag = false;
  }

  // ------------------------------------------------------------- damage
  function impactEnergy(pair) {
    var a = pair.bodyA, b = pair.bodyB;
    if (a.isSensor || b.isSensor) return 0;
    if (a.isStatic && b.isStatic) return 0;
    var n = pair.collision.normal;
    var rvx = a.velocity.x - b.velocity.x;
    var rvy = a.velocity.y - b.velocity.y;
    var vn = Math.abs(rvx * n.x + rvy * n.y);
    var red;
    if (a.isStatic) red = b.mass;
    else if (b.isStatic) red = a.mass;
    else red = (a.mass * b.mass) / (a.mass + b.mass);
    return 0.5 * red * vn * vn;
  }

  function contactPoint(pair) {
    var s = pair.collision.supports;
    if (s && s.length) return { x: s[0].x, y: s[0].y };
    return {
      x: (pair.bodyA.position.x + pair.bodyB.position.x) / 2,
      y: (pair.bodyA.position.y + pair.bodyB.position.y) / 2,
    };
  }

  function applyDamage(body, energy) {
    var entry = registry[body.id];
    if (!entry || entry.rec.dead) return;
    if (entry.kind === 'block') {
      var dmg = (energy - BLOCK_DMG_MIN) * BLOCK_DMG_SCALE;
      if (dmg <= 0) return;
      entry.rec.hp -= dmg;
      if (entry.rec.hp <= 0) {
        entry.rec.dead = true;
        pendingKills.push(entry);
      }
    } else if (entry.kind === 'enemy') {
      var edmg = (energy - ENEMY_DMG_MIN) * ENEMY_DMG_SCALE;
      if (edmg <= 0) return;
      entry.rec.hp -= edmg;
      if (entry.rec.hp <= 0) {
        entry.rec.dead = true;
        pendingKills.push(entry);
      }
    } else if (entry.kind === 'debris') {
      if (energy >= DEBRIS_BREAK_ENERGY) {
        entry.rec.dead = true;
        pendingKills.push(entry);
      }
    }
  }

  function onCollisionStart(ev) {
    var pairs = ev.pairs;
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      var energy = impactEnergy(pair);
      if (energy <= 0) continue;
      var pt = contactPoint(pair);
      if (energy >= DUST_MIN_ENERGY) {
        var n = Math.min(9, 2 + Math.floor(energy / 80));
        spawnDust(pt.x, pt.y, n, ['#d8d2c0', '#c9c2a6', '#b8b2a0'], 1.6, 0.06);
      }
      if (energy >= IMPACT_EVENT_MIN) {
        Game.events.emit('impact', { x: pt.x, y: pt.y, energy: energy });
      }
      applyDamage(pair.bodyA, energy);
      applyDamage(pair.bodyB, energy);
    }
  }

  // ------------------------------------------------------- fragmentation
  function fragmentBlock(rec) {
    var body = rec.body;
    var d = rec.def;
    var m = MATERIALS[rec.mat];
    var pos = { x: body.position.x, y: body.position.y };
    var vel = { x: body.velocity.x, y: body.velocity.y };
    var angVel = body.angularVelocity;
    var angle = body.angle;
    Composite.remove(Game.world, body);
    delete registry[body.id];

    // local-space piece centers + sizes: 3 slices for planks, 2x2 for cubes
    var pieces = [];
    var long = Math.max(d.w, d.h), short = Math.min(d.w, d.h);
    if (long / short >= 2) {
      var alongX = d.w >= d.h;
      for (var k = -1; k <= 1; k++) {
        pieces.push({
          lx: alongX ? (long / 3) * k : 0,
          ly: alongX ? 0 : (long / 3) * k,
          w: alongX ? long / 3 * 0.82 : short * 0.8,
          h: alongX ? short * 0.8 : long / 3 * 0.82,
        });
      }
    } else {
      for (var qx = -1; qx <= 1; qx += 2) {
        for (var qy = -1; qy <= 1; qy += 2) {
          pieces.push({
            lx: qx * d.w / 4, ly: qy * d.h / 4,
            w: d.w / 2 * 0.8, h: d.h / 2 * 0.8,
          });
        }
      }
    }

    var cosA = Math.cos(angle), sinA = Math.sin(angle);
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var wx = pos.x + p.lx * cosA - p.ly * sinA;
      var wy = pos.y + p.lx * sinA + p.ly * cosA;
      var pb = Bodies.rectangle(wx, wy, p.w, p.h, {
        label: 'debris',
        density: m.density,
        friction: 0.8, frictionStatic: 0.9, restitution: 0.05,
        angle: angle + rand(-0.2, 0.2),
      });
      var len = Math.max(1, Math.hypot(p.lx, p.ly));
      var kick = rand(0.8, 2.2);
      Body.setVelocity(pb, {
        x: vel.x + (p.lx / len) * kick + rand(-0.6, 0.6),
        y: vel.y + (p.ly / len) * kick + rand(-0.8, 0.3),
      });
      Body.setAngularVelocity(pb, angVel + rand(-0.15, 0.15));
      var drec = {
        body: pb, mat: rec.mat, w: p.w, h: p.h,
        born: performance.now(), sleepMs: 0, alpha: 1, fading: false, dead: false,
      };
      debrisList.push(drec);
      registry[pb.id] = { kind: 'debris', rec: drec };
      Composite.add(Game.world, pb);
    }
    spawnDust(pos.x, pos.y, 8 + ((Math.random() * 5) | 0), m.dust, 2.4, 0.08);
  }

  function killEnemy(rec) {
    var pos = { x: rec.body.position.x, y: rec.body.position.y };
    Composite.remove(Game.world, rec.body);
    delete registry[rec.body.id];
    enemyAliveFlag = false;
    spawnRingBurst(pos.x, pos.y);
    spawnDust(pos.x, pos.y, 8, ['#c5f26b', '#a5d92e', '#ffffff'], 2.2, 0.05);
    flashes.push({ x: pos.x, y: pos.y, life: 260, max: 260, rMax: 64 });
    floaters.push({ x: pos.x, y: pos.y - 26, vy: -0.85, life: 800, max: 800, text: '+' });
    Game.events.emit('enemy:killed', { enemy: rec.body });
  }

  function breakDebris(rec) {
    var pos = rec.body.position;
    spawnDust(pos.x, pos.y, 5, MATERIALS[rec.mat].dust, 2.0, 0.08);
    Composite.remove(Game.world, rec.body);
    delete registry[rec.body.id];
  }

  // ------------------------------------------------------------- update
  function update(dtMs) {
    var i, rec;

    // process queued deaths (never mutate the world inside collision events)
    while (pendingKills.length) {
      var entry = pendingKills.shift();
      if (entry.kind === 'block') fragmentBlock(entry.rec);
      else if (entry.kind === 'enemy') killEnemy(entry.rec);
      else if (entry.kind === 'debris') breakDebris(entry.rec);
    }
    for (i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].dead) blocks.splice(i, 1);
    }

    // debris lifecycle: age out or fall asleep, then fade + remove
    var now = performance.now();
    for (i = debrisList.length - 1; i >= 0; i--) {
      rec = debrisList[i];
      if (rec.dead) { debrisList.splice(i, 1); continue; }
      rec.sleepMs = rec.body.isSleeping ? rec.sleepMs + dtMs : 0;
      if (!rec.fading &&
          (now - rec.born > DEBRIS_LIFE_MS || rec.sleepMs > DEBRIS_SLEEP_MS)) {
        rec.fading = true;
      }
      if (rec.fading) {
        rec.alpha -= dtMs / DEBRIS_FADE_MS;
        if (rec.alpha <= 0) {
          Composite.remove(Game.world, rec.body);
          delete registry[rec.body.id];
          debrisList.splice(i, 1);
        }
      }
    }

    // particles / effects
    var k = dtMs / (1000 / 60);
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dtMs;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vy += p.g * k;
      p.vx *= 0.985;
    }
    for (i = flashes.length - 1; i >= 0; i--) {
      flashes[i].life -= dtMs;
      if (flashes[i].life <= 0) flashes.splice(i, 1);
    }
    for (i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i];
      f.life -= dtMs;
      f.y += f.vy * k;
      if (f.life <= 0) floaters.splice(i, 1);
    }

    if (enemyAliveFlag) blinkT = (blinkT + dtMs) % BLINK_PERIOD_MS;
  }

  // ------------------------------------------------------------- render
  function drawBlockShape(ctx, mat, w, h) {
    var m = MATERIALS[mat];
    ctx.fillStyle = m.fill;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (mat === 'wood') {
      // grain lines along the long axis
      ctx.strokeStyle = m.grain;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (w >= h) {
        ctx.moveTo(-w / 2 + 3, -h / 6); ctx.lineTo(w / 2 - 3, -h / 6);
        ctx.moveTo(-w / 2 + 6, h / 5); ctx.lineTo(w / 2 - 8, h / 5);
      } else {
        ctx.moveTo(-w / 6, -h / 2 + 3); ctx.lineTo(-w / 6, h / 2 - 3);
        ctx.moveTo(w / 5, -h / 2 + 6); ctx.lineTo(w / 5, h / 2 - 8);
      }
      ctx.stroke();
    } else {
      // stone bevel: light top/left, dark bottom/right
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 2, h / 2 - 2);
      ctx.lineTo(-w / 2 + 2, -h / 2 + 2);
      ctx.lineTo(w / 2 - 2, -h / 2 + 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(w / 2 - 2, -h / 2 + 2);
      ctx.lineTo(w / 2 - 2, h / 2 - 2);
      ctx.lineTo(-w / 2 + 2, h / 2 - 2);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = m.edge;
    ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
  }

  function drawCracks(ctx, lines, dark) {
    ctx.strokeStyle = dark ? 'rgba(30,22,14,0.8)' : 'rgba(45,34,22,0.6)';
    ctx.lineWidth = 1.4;
    for (var i = 0; i < lines.length; i++) {
      var pts = lines[i];
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
      ctx.stroke();
    }
  }

  function drawEnemy(ctx) {
    var b = enemy.body;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    // body: grumpy lime-green blob
    var g = ctx.createRadialGradient(-6, -8, 4, 0, 0, ENEMY_R + 4);
    g.addColorStop(0, '#c0e85b');
    g.addColorStop(0.7, '#a5d92e');
    g.addColorStop(1, '#84b21e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, ENEMY_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5f8a10';
    ctx.stroke();
    // eyes (blink every ~3s)
    var blinking = blinkT < BLINK_LEN_MS;
    if (blinking) {
      ctx.strokeStyle = '#3b5709';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-11, -5); ctx.lineTo(-3, -5);
      ctx.moveTo(3, -5); ctx.lineTo(11, -5);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(-7, -5, 5, 5.5, 0, 0, Math.PI * 2);
      ctx.ellipse(7, -5, 5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#26310c';
      ctx.beginPath();
      ctx.arc(-5.6, -4, 2.4, 0, Math.PI * 2);
      ctx.arc(5.6, -4, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // grumpy brows, angled in toward the nose
    ctx.strokeStyle = '#3b5709';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-12, -13); ctx.lineTo(-3, -9.5);
    ctx.moveTo(12, -13); ctx.lineTo(3, -9.5);
    ctx.stroke();
    // frown
    ctx.strokeStyle = '#3b5709';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 11, 5.5, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
    ctx.restore();
  }

  function render(ctx) {
    var i, rec, hpFrac;

    // blocks with damage states
    for (i = 0; i < blocks.length; i++) {
      rec = blocks[i];
      var b = rec.body;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      drawBlockShape(ctx, rec.mat, rec.def.w, rec.def.h);
      hpFrac = rec.hp / rec.maxHp;
      if (hpFrac < 0.6) drawCracks(ctx, rec.cracksA, false);
      if (hpFrac < 0.3) {
        drawCracks(ctx, rec.cracksB, true);
        ctx.fillStyle = 'rgba(30,20,10,0.14)';
        ctx.fillRect(-rec.def.w / 2, -rec.def.h / 2, rec.def.w, rec.def.h);
      }
      ctx.restore();
    }

    // debris (same material look, fades out)
    for (i = 0; i < debrisList.length; i++) {
      rec = debrisList[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, rec.alpha);
      ctx.translate(rec.body.position.x, rec.body.position.y);
      ctx.rotate(rec.body.angle);
      drawBlockShape(ctx, rec.mat, rec.w, rec.h);
      ctx.restore();
    }

    if (enemyAliveFlag) drawEnemy(ctx);

    // dust / burst particles
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // white pop flash
    for (i = 0; i < flashes.length; i++) {
      var fl = flashes[i];
      var t = 1 - fl.life / fl.max;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, 10 + (fl.rMax - 10) * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // floating '+' puff
    for (i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(60,80,15,0.9)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = '#eaffb0';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- module
  window.Structure = {
    init: function () {
      if (inited) return;
      inited = true;
      // destruction inits first, so pushing here puts us behind slingshot/HUD
      Game.renderers.push(render);
      Game.updaters.push(update);
      Events.on(Game.engine, 'collisionStart', onCollisionStart);
      Game.events.on('level:reset', function () { window.Structure.reset(); });
      build();
    },
    reset: function () {
      teardown();
      build();
    },
    enemyAlive: function () {
      return enemyAliveFlag;
    },
    // debug/test introspection (not part of the gameplay contract)
    _debug: function () {
      return {
        blocks: blocks.map(function (r) {
          return {
            mat: r.mat,
            x: r.body.position.x, y: r.body.position.y,
            hp: r.hp, maxHp: r.maxHp,
          };
        }),
        debris: debrisList.length,
        particles: particles.length,
        enemy: enemyAliveFlag
          ? { x: enemy.body.position.x, y: enemy.body.position.y, hp: enemy.hp }
          : null,
      };
    },
  };
})();
