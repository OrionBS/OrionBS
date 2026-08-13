// world.js — shared engine/canvas setup and module contract hub.
// Owned by the orchestrator. Builders must not edit this file.
//
// Contract:
//   Game.engine, Game.world      — Matter.js engine/world (gravity y = 1)
//   Game.canvas, Game.ctx        — 1280x720 canvas and 2d context
//   Game.events                  — tiny pub/sub: on(name, fn), emit(name, data)
//   Game.renderers               — array of fn(ctx, dt); modules push draw fns,
//                                  called every frame in push order (world space)
//   Game.updaters                — array of fn(dt); called every frame before render
//   Game.W, Game.H               — logical size (1280x720)
//   Game.GROUND_Y                — top of the ground surface (y = 640)
//
// Events used across modules:
//   'bird:loaded'    {bird}          slingshot has a bird nocked and ready
//   'bird:launched'  {bird, velocity} bird released from the sling
//   'bird:dead'      {bird}          bird stopped/expired; shot is over
//   'enemy:killed'   {enemy}         the level's enemy has been destroyed
//   'level:reset'    {}              gameloop asks all modules to rebuild state
//   'impact'         {x, y, energy}  destruction reports a significant impact
//   'attempt:spent'  {remaining}     gameloop accounting

(function () {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const engine = Matter.Engine.create({
    enableSleeping: true,
    positionIterations: 8,
    velocityIterations: 6,
  });
  engine.gravity.y = 1;

  const Game = {
    engine,
    world: engine.world,
    canvas,
    ctx,
    W: canvas.width,
    H: canvas.height,
    GROUND_Y: 640,
    renderers: [],
    updaters: [],
    events: (function () {
      const map = {};
      return {
        on(name, fn) { (map[name] = map[name] || []).push(fn); },
        emit(name, data) { (map[name] || []).forEach(fn => fn(data)); },
      };
    })(),
  };

  // Static ground + walls
  const ground = Matter.Bodies.rectangle(Game.W / 2, Game.GROUND_Y + 40, Game.W * 2, 80, {
    isStatic: true, label: 'ground', friction: 0.9,
  });
  const wallL = Matter.Bodies.rectangle(-40, Game.H / 2, 80, Game.H * 4, { isStatic: true, label: 'wall' });
  const wallR = Matter.Bodies.rectangle(Game.W + 40, Game.H / 2, 80, Game.H * 4, { isStatic: true, label: 'wall' });
  Matter.Composite.add(Game.world, [ground, wallL, wallR]);

  // Fixed-timestep game loop with interpolation-free render (60 Hz physics)
  const STEP = 1000 / 60;
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    acc += Math.min(now - last, 100);
    last = now;
    while (acc >= STEP) {
      Game.updaters.forEach(fn => fn(STEP));
      Matter.Engine.update(engine, STEP);
      acc -= STEP;
    }
    draw(STEP);
    requestAnimationFrame(frame);
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, Game.H);
    g.addColorStop(0, '#87ceeb');
    g.addColorStop(0.75, '#c9ecf5');
    g.addColorStop(1, '#d9f2d0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Game.W, Game.H);
    // ground
    ctx.fillStyle = '#7ec850';
    ctx.fillRect(0, Game.GROUND_Y, Game.W, Game.H - Game.GROUND_Y);
    ctx.fillStyle = '#5da03c';
    ctx.fillRect(0, Game.GROUND_Y, Game.W, 6);
  }

  function draw(dt) {
    drawBackground();
    Game.renderers.forEach(fn => fn(ctx, dt));
  }

  window.Game = Game;
  requestAnimationFrame(frame);
})();
