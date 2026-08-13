# Module Contract — Slingshot Physics Prototype

Single-level slingshot physics game (original bird vs. simple structure with one enemy).
Physics: Matter.js 0.20 (vendored at `vendor/matter.min.js`), rendering: raw Canvas 2D.
No audio, no progression, no final art — mechanics quality only.

`js/world.js` is owned by the orchestrator (do not edit). It exposes `window.Game`:

- `Game.engine`, `Game.world` — Matter engine/world, gravity y=1, 60 Hz fixed step
- `Game.canvas`, `Game.ctx`, `Game.W` (1280), `Game.H` (720), `Game.GROUND_Y` (640)
- `Game.updaters` — push `fn(dtMs)` called before each physics step
- `Game.renderers` — push `fn(ctx, dtMs)` called each frame, in push order
  (draw order: destruction pushes first = behind, slingshot second, gameloop HUD last)
- `Game.events.on(name, fn)` / `Game.events.emit(name, data)`

## Events

| event | payload | emitted by | consumed by |
|---|---|---|---|
| `bird:loaded` | `{bird}` | slingshot | gameloop |
| `bird:launched` | `{bird, velocity}` | slingshot | gameloop, destruction |
| `bird:dead` | `{bird}` | slingshot | gameloop |
| `enemy:killed` | `{enemy}` | destruction | gameloop |
| `impact` | `{x, y, energy}` | destruction | gameloop (feedback) |
| `level:reset` | `{}` | gameloop | slingshot, destruction |
| `attempt:spent` | `{remaining}` | gameloop | — |

## js/slingshot.js — module `Slingshot`

- Sling anchor around x=220, fork top at y≈505. Bird is a circle (r≈22), original
  character (NOT a Rovio design): simple round body, expressive eyes, drawn in canvas.
- Mouse + touch drag: grab bird (generous hit radius), drag constrained to max
  pull radius (~110px); band tension maps pull distance → launch speed
  (capped, tuned so a full pull crosses the whole level).
- Launch on release using velocity derived from pull vector (predictable,
  deterministic — same pull always gives same shot).
- While dragging: draw trajectory preview dots (simulate gravity, spaced in time).
- Draw sling: two elastic bands (behind + in front of bird), wooden Y fork.
- After launch: track bird; emit `bird:dead` when it sleeps/stops offscreen or
  after timeout. Auto-load next bird on `level:reset` and after `bird:dead`
  (gameloop decides resets; slingshot just reloads when told via `level:reset`
  or when gameloop calls `Slingshot.loadBird()`).
- Public API: `Slingshot.init()`, `Slingshot.loadBird()`, `Slingshot.getBird()`.

## js/destruction.js — module `Structure`

- Builds a simple structure on the right side (x≈880–1080) on ground: wood/stone
  blocks (rectangles), at least two stories, one enemy (original round creature,
  distinct color from bird) sheltered inside/on it.
- Materials with distinct density/friction/restitution and HP (wood weaker,
  stone stronger). Damage = f(impact energy) via `collisionStart` +
  `Matter.Pair` impulse or relative velocity.
- Blocks show damage states (cracks) and FRAGMENT on death: replace block with
  2–4 smaller physical debris pieces + non-physical dust/spark particles that
  fade. Debris despawns after a few seconds.
- Enemy dies from sufficient impact (direct hit or crushed by blocks/fall);
  emits `enemy:killed`, with a satisfying pop (particles, brief flash).
- Emit `impact` for significant hits so gameloop can do screenshake.
- `level:reset` → tear down and rebuild identical structure.
- Public API: `Structure.init()`, `Structure.reset()`, `Structure.enemyAlive()`.

## js/gameloop.js — module `GameLoop`

- Attempts: 3 birds per run. HUD top-left: remaining birds (icons), attempts
  counter, state messages.
- Flow: `bird:dead` with enemy alive and birds remaining → tell slingshot to
  load next bird. Enemy killed → WIN overlay ("Nível limpo!" + restart button/
  key R). Out of birds with enemy alive → LOSE overlay + restart.
- Restart: emit `level:reset` (also bound to key `R` and click on overlay).
- Screenshake on strong `impact`: apply a decaying random offset to the
  canvas CSS transform (`canvas.style.transform = translate(...)`), magnitude
  proportional to impact energy, capped small (≤8px), decayed each update.
  This shakes the whole canvas without touching world-space rendering.
- Public API: `GameLoop.init()`.

## Quality bar (what critics will test)

- Drag feels natural: bird follows pointer with slight elastic give, clamped
  to pull radius, never jitters or snaps.
- Trajectory preview matches the actual flight closely.
- Same pull → same trajectory (deterministic).
- Structure collapse is physically believable: blocks topple, stack shifts,
  no explosion-on-spawn, no tunneling through ground.
- Fragmentation reads as satisfying: debris inherits momentum, dust puffs,
  screenshake proportional to impact.
- Full loop: 3 attempts, win/lose, R restarts cleanly with no leaked bodies
  (world body count returns to baseline after reset).

## Dev harness

`npm run serve` → http://localhost:8000. Playwright + Chromium at
`/opt/pw-browsers` for scripted play (see `test/` examples).
