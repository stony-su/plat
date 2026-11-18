# APEIRON — Technical Contract v1

> Single source of truth for every build agent. Read it fully before writing code. Companion: `docs/DESIGN.md` (game design).
> Only the INTEGRATOR may deviate, and only to fix integration bugs. CORE documents its as-built API in `docs/ENGINE_API.md`.

## A. Final decisions (read first)
1. **11 agents in two workflows.**
   - **P0** (workflow A): CORE ‖ TOOLS ‖ ART ‖ AUDIO.
   - **P1** (workflow B, after the P0 gate): UI ‖ W1(+ENDLESS) ‖ W2 ‖ W3 ‖ W4 ‖ W5.
   - **P2:** INTEGRATOR.
   - TOOLS owns `js/core/algo.js` and all of `tools/*`. It needs only this contract, so lint, the reachability bots, the vm harness and the dist builder are off CORE's critical path.
2. **Physics corrections**, simulated at 120 Hz with the §2.15 step order:
   - **Jump:** the apex is 110u (3.44T), so the max rise is 3 tiles.
   - **Double jump:** jump + double jump reaches 196u. A 6-tile rise is frame-tight and therefore **forbidden**; the max rise with a double jump is 5 tiles.
   - **Bounce pad:** 1040 (apex 222u). A 6-tile rise always works; 7 never does.
   - **Orbit:** the 420 u/s minimum alone gives only about a 3-tile fling, so add cruise 800 and acceleration 1200. Release is then about 920 u/s, a fling of about 10 tiles, with a ±45° aim assist on release.
   - **Wall-jump:** the draft values hold. Shafts 2–5 tiles wide climb well, 6 is marginal, 7 is impossible.
3. **Level safety is mechanical.** The §4 envelopes come from the lint bot's conservative model. A level inside the tables passes lint, and a level that passes lint is beatable with margin. If the bot is demonstrably wrong about a move the §4 tables allow, add a `lint.edges` annotation with a `note` instead of reshaping the level, and report it in `knownGaps`.
4. **Two files are copied byte-for-byte:** `js/core/const.js` (§2.2) and `js/data/worlds.js` (§5). No agent invents constants, names, palettes or type ids.
5. **Errors fail soft.** Every hook and cross-module call is guarded. An entity that throws is quarantined. A missing module falls back to CORE, and an unknown entity type becomes an inert placeholder.

## 0. Global rules
- **Delivery.** Classic `<script>` files only, ES2020 syntax, loaded in §1 order. No modules, build step, network, CDN or asset files.
- **File template (mandatory):**
```js
/* <path> — owner: <AGENT> */
(function (AP) {
  'use strict';
  // ...
})(window.AP = window.AP || {});
```
- **Globals.** The only allowed globals are `AP` and the test flag `AP_NO_AUTOBOOT`. Nothing (no `let`, `const`, `class` or `function`) is declared at top level outside the IIFE.
- **Load time.** While loading, a file may only use symbols from files earlier in §1. It may not touch the DOM, canvas, audio or storage. Allowed load-time calls: `AP.Entities.register`, `AP.Levels.register`, `AP.Scenes.register`, `AP.FX.preset`, and pure helpers (`AP.M`, `AP.Color`, `AP.RNG`, `AP.Noise`, `AP.Algo`, constants). Everything else runs after `AP.boot()`.
- **Banned** (grep-enforced):
  - `import`/`export`, `fetch`/`XMLHttpRequest`, `Worker`, `eval`/`new Function`, `document.write`, `alert`/`confirm`/`prompt`, `innerHTML`.
  - `setTimeout`/`setInterval` for game logic.
  - `Date.now`/`performance.now` in gameplay (use `L.time`).
  - `Math.random` in level generation or anything lint depends on (use `AP.RNG`).
  - `shadowBlur` other than 0, `ctx.filter`, `getImageData` outside cache builds, `localStorage` outside `AP.Save`.
- **Units.**
  - *Code:* world units u (1u = 1 logical px at 960×540; T = 32u), seconds, u/s, u/s², radians.
  - *Level specs:* tiles, tiles/s, tiles/s², seconds, degrees. Convert with `AP.U.t(n)` and `AP.U.deg(d)`.
  - Origin is top-left, +y is down, angle 0 = +x, positive angles are clockwise on screen.
- **Entities.** `x,y` is the top-left of the AABB hitbox, `w,h` its size. Tile index = `ty*L.w + tx`.
- **Naming.**
  - Entity types: `name` (common) or `wN.name`.
  - Events: `domain:verb`. Custom events must be prefixed `w1:`…`w5:`, `ui:` or `endless:`.
  - FX presets: common names or `wN.*`.
  - SFX: only names in `AP.SFX`.
- **Hot paths.**
  - Hooks always receive `dt = AP.C.STEP` (1/120); always use `dt`.
  - No allocations inside per-step loops; reuse `out` objects.
- **CORE may add but never rename or alter** a §2 signature. Any forced deviation keeps the contract name as an alias and is documented in `docs/ENGINE_API.md`.

## 1. Agents, phases, files (load order = order of tags in index.html)
Nobody edits another agent's files; INTEGRATOR may edit anything. CORE writes `index.html` with **every** tag below on day one.

| # | path | owner | provides |
|---|---|---|---|
| – | index.html, css/style.css | CORE | `#stage > canvas#bg + canvas#game`; all tags below |
| 1 | js/core/ap.js | CORE | AP root helpers §2.1 |
| 2 | js/core/const.js | CORE | VERBATIM §2.2 |
| 3 | js/core/math.js | CORE | AP.M, AP.Color |
| 4 | js/core/rng.js | CORE | AP.hash, AP.hash2, AP.RNG |
| 5 | js/core/noise.js | CORE | AP.Noise |
| 6 | js/core/algo.js | TOOLS | AP.Algo |
| 7 | js/core/flow.js | CORE | AP.Flow |
| 8 | js/core/path.js | CORE | AP.Path |
| 9 | js/core/events.js | CORE | AP.Events |
| 10 | js/core/storage.js | CORE | AP.Save |
| 11 | js/core/input.js | CORE | AP.Input |
| 12 | js/core/beat.js | CORE | AP.Beat |
| 13 | js/core/loop.js | CORE | AP.Loop, AP.Time |
| 14 | js/engine/render.js | CORE | AP.R |
| 15 | js/engine/gl.js | CORE | AP.GL |
| 16 | js/engine/scenes.js | CORE | AP.Scenes |
| 17 | js/engine/camera.js | CORE | AP.Camera |
| 18 | js/engine/particles.js | CORE | AP.FX |
| 19 | js/engine/physics.js | CORE | AP.Phys, entity prototype |
| 20 | js/engine/entities.js | CORE | AP.Entities |
| 21 | js/engine/tilemap.js | CORE | AP.Tilemap |
| 22 | js/engine/levels.js | CORE | AP.Levels (`register(def)`, `get(id)`, `has(id)`, `list(world?)`) |
| 23 | js/data/worlds.js | CORE | VERBATIM §5 |
| 24 | js/art/kit.js | ART | AP.Art |
| 25 | js/art/backgrounds.js | ART | AP.Backgrounds |
| 26 | js/art/midground.js | ART | AP.Midground |
| 27 | js/art/tileart.js | ART | AP.TileArt |
| 28 | js/audio/engine.js | AUDIO | AP.Audio core |
| 29 | js/audio/sfx.js | AUDIO | all AP.SFX voices |
| 30 | js/audio/music.js | AUDIO | all AP.MUSIC keys |
| 31 | js/game/progress.js | CORE | AP.Progress |
| 32 | js/game/player.js | CORE | type `player` |
| 33 | js/game/common.js | CORE | common types §2.16 |
| 34 | js/game/levelscene.js | CORE | scene `level`, AP.Test |
| 35 | js/game/devmenu.js | CORE | scene `devmenu` |
| 36–45 | js/worlds/w1/entities.js, w1/boss.js, w2/entities.js, w2/boss.js … w5/entities.js, w5/boss.js | W1…W5 | `wN.*` types |
| 46 | js/levels/test.js | CORE | `test-*` levels |
| 47–51 | js/levels/w1.js … w5.js | W1…W5 | world levels |
| 52 | js/endless/chunks.js | W1 | chunk templates |
| 53 | js/endless/generator.js | W1 | AP.Endless |
| 54 | js/endless/endless.js | W1 | scene `endless` |
| 55 | js/data/theorems.js | UI | AP.Theorems |
| 56 | js/ui/kit.js | UI | AP.UI (incl. stroke font) |
| 57 | js/ui/hud.js | UI | AP.HUD |
| 58 | js/ui/meta.js | UI | AP.Meta, AP.Cosmetics |
| 59 | js/ui/title.js | UI | `title` |
| 60 | js/ui/story.js | UI | `intro`, `ending`, `credits` |
| 61 | js/ui/worldmap.js | UI | `map` |
| 62 | js/ui/menus.js | UI | `pause`, `results` |
| 63 | js/ui/settings.js | UI | `settings`, `remap` |
| 64 | js/ui/extras.js | UI | `theorems`, `cosmetics` |
| 65 | js/main.js | CORE | `AP.boot()`; autoboot unless `window.AP_NO_AUTOBOOT`. **Must be last.** |

**Not loaded by the game**
- `tools/*` and `tools/fixtures/*` (TOOLS).
- `docs/ENGINE_API.md` (CORE's as-built notes).
- `dist/apeiron.html` (built by `tools/build-dist.js`, run by INTEGRATOR).

**Optional-module rule**
- Code checks for a module **when it calls it**, via `AP.call('X.fn', …)` or `if (AP.X && AP.X.fn)`. It never caches "absent" at load time.
- A missing script file produces a browser 404 and the game continues. The harness reports it as a warning normally and as an error with `--strict`.

**CORE fallbacks**

| absent | fallback |
|---|---|
| AP.Backgrounds, a missing key, or GL failure | `AP.Backgrounds.render2D` if present, else `AP.R.bgFallback`: vertical gradient on pal.bg plus a faint 64u grid |
| AP.Midground | skipped |
| AP.TileArt | `AP.R.drawTilesFallback`: flat tiles in pal.primary, triangular spikes in pal.hazard |
| AP.Audio | silent (AP.Beat keeps running) |
| AP.HUD | `AP.R.hudFallback`: shard/death/time text and a plain boss bar |
| AP.Cosmetics, AP.Meta, AP.UI.drawTransition | default player style / no toasts / plain fade |
| scene `title` or `map` | `devmenu` |
| scene `pause` | minimal inline pause inside LevelScene |
| scene `results` | 2-second inline summary, then next level or devmenu |
| scene `endless` | menu entry hidden |
| unknown entity type | `missing` placeholder (inert, magenta "?") plus `AP.warnOnce` |
| AP.Art helper | the caller draws with `AP.R.poly`/`star` |

## 2. Core API surface

### 2.1 `ap.js`
```
AP.VERSION='1.0.0'; AP.DEV (location.hash contains 'dev')
AP.log(...)  AP.warn(...)  AP.warnOnce(key, ...)
AP.errors: [{label, message, stack}]           // every caught error; boot-test fails if non-empty
AP.reportError(label, err)
AP.guard(label, fn, a, b, c, d) → result|undefined   // try/catch → reportError
AP.has('Audio.sfx') → bool ; AP.call('Audio.sfx', ...args) → result|undefined (guarded)
AP.sfx(name, opts?)          // AP.call('Audio.sfx'); unknown name → warnOnce (DEV)
AP.sfxAt(name, x, y, opts?)  // pan = clamp((x-camCX)/480,-1,1); vol *= 1-clamp((dist-480)/640,0,0.8)
AP.music(key, opts?)         // AP.Beat.set(AP.MUSIC[key]); AP.call('Audio.music', key, opts)
AP.level                     // current LevelScene or null
AP.boot(opts?)               // defined in main.js; opts.headless → no rAF, no DOM listeners
```

### 2.2 `js/core/const.js` — VERBATIM
```js
/* js/core/const.js — owner: CORE — VERBATIM from CONTRACT §2.2 */
(function (AP) {
  'use strict';
  AP.C = Object.freeze({
    T: 32, VIEW_W: 960, VIEW_H: 540, STEP: 1 / 120, MAX_FRAME_DT: 0.1, MAX_STEPS: 12,
    PLAYER_W: 22, PLAYER_H: 22,
    GRAVITY: 2400, MAX_FALL: 900, FAST_FALL: 1100,
    JUMP_V: 733, JUMP_CUT: 0.45, HANG_V: 80, HANG_MULT: 0.5,
    RUN: 300, GROUND_ACCEL: 3000, GROUND_DECEL: 3600, AIR_ACCEL: 2200, AIR_DECEL: 1200, OVERSPEED_DECEL: 400,
    COYOTE: 0.10, JUMP_BUFFER: 0.12, CORNER_CORRECT: 8, LEDGE_CORRECT: 8, DROP_THROUGH: 0.15,
    WALL_SLIDE_MAX: 140, WALL_JUMP_DIST: 4, WALL_COYOTE: 0.08,
    WALLJUMP_VX: 340, WALLJUMP_VY: 680, WALLJUMP_LOCK: 0.12,
    DOUBLE_JUMP_V: 650, BURST_RADIUS: 64,
    DASH_SPEED: 760, DASH_TIME: 0.14, DASH_END_SPEED: 300, DASH_COOLDOWN: 0.20, DASH_FREEZE: 0.03, DASH_BUFFER: 0.08,
    ORBIT_RANGE: 110, ORBIT_R_MIN: 40, ORBIT_R_MAX: 110, ORBIT_MIN_SPEED: 420, ORBIT_CRUISE: 800,
    ORBIT_ACCEL: 1200, ORBIT_MAX: 1000, ORBIT_RELEASE_MULT: 1.15, ORBIT_AIM_ASSIST_DEG: 45, ORBIT_COOLDOWN: 0.20,
    BOUNCE_V: 1040, BOUNCE_SIDE_VX: 700, BOUNCE_SIDE_VY: 420,
    STOMP_V: 520, STOMP_V_HELD: 733, STOMP_TOL: 8,
    EXT_MAX_VX: 600,
    DEATH_TIME: 0.5, RESPAWN_TIME: 0.3, RESPAWN_INVULN: 0.6,
    CRUMBLE_DELAY: 0.45, CRUMBLE_RESPAWN: 2.5, HITSTOP_MAX: 0.12, PIT_MARGIN: 64,
    SPIKE_DEPTH: 14, SPIKE_INSET: 3, ONEWAY_THICK: 8,
    CHUNK: 256, CHUNK_CACHE: 48, CHUNK_PX_MAX: 2, PARTICLES_MAX: 1800,
    LINT_RUN_FACTOR: 0.95, LINT_VEL_FACTOR: 0.97, LINT_LEDGE_OVERLAP: 8
  });
  AP.TILE = Object.freeze({ EMPTY: 0, SOLID: 1, ONEWAY: 2, SPIKE_U: 3, SPIKE_D: 4, SPIKE_L: 5, SPIKE_R: 6, BREAK: 7, FAKE: 8 });
  AP.TILE_CHARS = Object.freeze({ '.': 0, '#': 1, '=': 2, '^': 3, 'v': 4, '<': 5, '>': 6, '+': 7, '%': 8 });
  AP.ENTITY_CHARS = Object.freeze({ P: 'player', E: 'exit', V: 'vertex', C: 'checkpoint', '*': 'shard',
    '1': 'gem', '2': 'gem', '3': 'gem', B: 'bounce', S: 'sign', O: 'node', '~': 'crumble' });
  AP.FORMS = Object.freeze([3, 4, 5, 6, 99]);
  AP.FORM_NAMES = Object.freeze({ 3: 'Triangle', 4: 'Square', 5: 'Pentagon', 6: 'Hexagon', 99: 'Circle' });
  AP.abilities = function (f) { return { wall: f >= 4, double: f >= 5, dash: f >= 6, orbit: f >= 99 }; };
  AP.ACTIONS = Object.freeze(['left', 'right', 'up', 'down', 'jump', 'dash', 'orbit', 'pause', 'confirm', 'back', 'retry']);
  AP.SFX = Object.freeze(['jump', 'jump2', 'walljump', 'land', 'step', 'dash', 'refill', 'orbit', 'fling', 'burst',
    'death', 'respawn', 'bounce', 'stomp', 'shard', 'gem', 'checkpoint', 'secret', 'vertex', 'portal', 'complete',
    'crumble', 'break', 'shoot', 'laser', 'charge', 'pulse', 'chime', 'grow', 'split', 'hit', 'explode', 'whoosh',
    'rumble', 'gust', 'bossHit', 'bossPhase', 'bossRoar', 'bossDeath',
    'uiMove', 'uiSelect', 'uiBack', 'uiDeny', 'pause', 'unpause', 'toast', 'type']);
  AP.LOOPS = Object.freeze(['wind', 'hum', 'void']);
  AP.MUSIC = Object.freeze({
    title: { bpm: 84, meter: 5 }, map: { bpm: 90, meter: 4 },
    w1: { bpm: 112, meter: 3 }, boss1: { bpm: 132, meter: 3 },
    w2: { bpm: 96, meter: 4 }, boss2: { bpm: 116, meter: 4 },
    w3: { bpm: 100, meter: 5 }, boss3: { bpm: 120, meter: 5 },
    w4: { bpm: 168, meter: 6 }, boss4: { bpm: 192, meter: 6 },
    w5: { bpm: 120, meter: 4, poly: [3, 4, 5] }, boss5: { bpm: 128, meter: 4, poly: [3, 4, 5] },
    endless: { bpm: 120, meter: 4 }, ending: { bpm: 72, meter: 4 }, credits: { bpm: 96, meter: 4 }
  });
  AP.STYLES = Object.freeze(['title', 'map', 'w1', 'w2', 'w3', 'w4', 'w5', 'endless', 'void']);
  AP.EVENTS = Object.freeze(['level:start', 'level:complete', 'level:quit', 'player:jump', 'player:land',
    'player:dash', 'player:orbit', 'player:fling', 'player:death', 'player:respawn', 'checkpoint',
    'collect:shard', 'collect:gem', 'secret:found', 'tile:changed', 'boss:start', 'boss:phase', 'boss:hit',
    'boss:defeat', 'form:gain', 'beat', 'bar', 'theorem', 'settings:changed', 'scene:change',
    'endless:segment', 'endless:end']);
  AP.U = Object.freeze({ t: function (n) { return n * 32; }, deg: function (d) { return d * Math.PI / 180; } });
})(window.AP = window.AP || {});
```

### 2.3 Pure helpers
```
AP.M: TAU, clamp(v,a,b), lerp(a,b,t), invLerp(a,b,v), approach(v,target,delta), sign(v) (0→0),
      damp(a,b,lambda,dt) (=lerp(a,b,1-exp(-lambda*dt))), wrapAngle(a)∈[-π,π], angleDiff(a,b),
      dist(x1,y1,x2,y2), len(x,y), norm(x,y,out), rot(x,y,a,out), aabb(ax,ay,aw,ah,bx,by,bw,bh),
      pointInPoly(x,y,flat), ease.{linear,inQuad,outQuad,inCubic,outCubic,inOutSine,outBack,outElastic}(t)
AP.Color: rgb(hex)→{r,g,b}, rgba(hex,a)→css (cached), mix(h1,h2,t)→hex, shade(hex,-1..1)→hex,
          hsl(h,s,l,a)→css, vec3(hex)→[r,g,b] in 0..1
AP.hash(str)→uint32 (FNV-1a) ; AP.hash2(x,y,seed)→uint32
AP.RNG(seed)→{next()∈[0,1), int(lo,hi) incl., range(lo,hi), pick(arr), chance(p), sign(), shuffle(arr), fork(salt)}  // mulberry32
AP.Noise: n2(x,y), n3(x,y,z) ∈[-1,1] simplex, fixed permutation from AP.RNG(1337);
          fbm2(x,y,oct=4,lac=2,gain=0.5), fbm3(x,y,z,oct=3), worley2(x,y,seed)→{f1,f2,id} (unit cells)
AP.Algo (TOOLS, pure, unit-tested):
  euclid(k,n,rot=0)→[0|1]×n (Bjorklund)        lsystem(axiom,rules,iters,maxLen=50000)→string
  turtle(str,{x,y,heading,step,angle,shrink=1})→{segs:[[x1,y1,x2,y2,depth]],leaves:[[x,y,heading]]}  // F,G draw; f move; + - turn; [ ] push/pop
  koch(x1,y1,x2,y2,depth,outward=1)→flat[x,y,...]   sierpinski(cx,cy,size,depth)→[[x1,y1,x2,y2,x3,y3]]
  voronoi(sites[[x,y]],bbox[x,y,w,h])→[{site,poly:flat,neighbors:[i]}] (n≤256)
  truchet(tx,ty,seed)→0..3   lissajous(t,p,out) (≡AP.Path.liss)   harmonograph(t,p,out)
  phyllo(i,c,out) (r=c√i, θ=i·2.39996323)   poisson(w,h,r,rng,k=30)→[[x,y]]
```
**AP.Flow (CORE).** This is the single function W3 gameplay and all art use to read the flow field.
```
AP.Flow.DEFAULT = {seed:0, scale:320, tscale:0.08, angle:0, spread:Math.PI, mmin:0.35, swirl:null}
AP.Flow.params(partial)→full ; AP.Flow.fromSpec(spec)→full   // spec: scale tiles(def 10), angle/spread deg, swirl [cx,cy,R tiles,k]
AP.Flow.sample(x,y,t,p,out)→out{x,y (unit dir), m∈[0,1]}
AP.Flow.force(x,y,t,p,strength,out)→out{x,y} = dir*m*strength   (u/s²)
AP.Flow.velocity(x,y,t,p,speed,out)                               (u/s)
AP.Flow.streamline(x,y,t,p,stepLen,n,outFlat)→outFlat            (art)
NORMATIVE formula:
  s=p.seed*0.1371; n1=n3(x/p.scale+s, y/p.scale-s, t*p.tscale); n2=n3(x/(2p.scale)+31.7+s, y/(2p.scale)-17.3, t*p.tscale*0.5)
  th=p.angle+p.spread*n1; m=p.mmin+(1-p.mmin)*(0.5+0.5*n2); d=(cos th, sin th)
  swirl [cx,cy,R,k]: r=dist; w=clamp(1-r/R,0,1)^2*|k|; tan=(-(y-cy),(x-cx))/r*sign(k); d=norm(lerp(d,tan,w)); m=max(m,w)
  t MUST be L.time for both physics and art.
```
**AP.Path (CORE).** Stateless, so an entity can compute its position from time.
```
AP.Path.poly(pts,speed,mode,t,out,wait=0)→out{x,y,i,dir}  // pts world [[x,y]]; mode 'loop'|'pingpong'|'once'; wait s at vertices
AP.Path.length(pts)
AP.Path.liss(p,t,out): x=p.cx+p.ax*sin(p.fx*w*t+p.phase), y=p.cy+p.ay*sin(p.fy*w*t), w=2π/p.period
AP.Path.lissFromSpec(liss,anchorX,anchorY)→p   // spec {ax,ay tiles, fx,fy ints, phase deg, period s}
AP.Path.circle(cx,cy,r,period,t,phase,out)
```

### 2.4 Events
```
AP.Events.on(name,fn)→off ; once(name,fn)→off ; off(name,fn) ; emit(name,payload)   // sync; listener errors caught
L.on(name,fn)→off   // level-scoped, auto-removed at level exit. Entities MUST use L.on.
```

| event | payload | emitter |
|---|---|---|
| level:start | {id, world, form, mode} | CORE |
| level:complete | result object (§2.14) | CORE |
| level:quit | {id} | CORE |
| player:jump | {kind:'ground'\|'coyote'\|'wall'\|'double'} | CORE |
| player:land | {vy} | CORE |
| player:dash | {dx, dy} | CORE |
| player:orbit / player:fling | {node} / {speed, angle} | CORE |
| player:death / player:respawn | {cause, x, y} / {x, y} | CORE |
| checkpoint | {index, x, y} | CORE |
| collect:shard / collect:gem | {count, total} / {n, id} | CORE |
| secret:found | {x, y} | CORE |
| tile:changed | {tx, ty, old, code} (tx=ty=-1 means full restore) | CORE |
| boss:start / boss:phase / boss:hit / boss:defeat | {id,type,name} / {id,phase} / {id,frac} / {id,time} | CORE, via `L.boss*` |
| form:gain | {form} | CORE |
| beat / bar | {beat, bar, inBar} / {bar} | CORE (AP.Beat) |
| theorem | {id, name} | UI |
| settings:changed | {key, value} | CORE (AP.Save) |
| scene:change | {from, to} | CORE |
| endless:segment / endless:end | {seed,segment,style} / {seed,segments,time,deaths,score} | W1 |

### 2.5 Input
```
AP.Input.init(win) ; update(dt)  // loop calls once per fixed step BEFORE scene update
held(a) pressed(a) released(a) → bool   // pressed is latched: a tap between steps yields exactly one pressed step
buffered(a, window) → bool ; consume(a) ; repeat(a) → bool (menus: press, then after 0.35 s every 0.08 s)
axis(out) → out{x,y} ∈ {-1,0,1} (digital ∪ stick, deadzone 0.35, 8-way)
anyPressed() ; device 'kbd'|'pad' ; label(a)→'Z'|'Space'|'A'... ; mouse {x,y (logical),down,pressed,released}
bindings() ; setBinding(a, device, slot, codeOrButton) ; resetBindings() ; capture(cb(code|btn|null), device)  // Esc → null
setVirtual(a, held) ; clearVirtual() ; lock(sec)
Behaviour: key repeat ignored; preventDefault on bound keys; window blur releases all;
first keydown/pointerdown → AP.call('Audio.unlock'); gamepad = standard mapping, polled in update().
```

| action | keys (KeyboardEvent.code) | pad buttons |
|---|---|---|
| left / right / up / down | ArrowLeft,KeyA / ArrowRight,KeyD / ArrowUp,KeyW / ArrowDown,KeyS | 14 / 15 / 12 / 13 + left stick |
| jump | Space, KeyZ, KeyJ | 0 |
| dash | KeyX, KeyK, ShiftLeft | 2, 1, 5 |
| orbit (hold) | KeyC, KeyL, ShiftRight | 7, 6, 3, 4 |
| pause | Escape, KeyP | 9 |
| confirm / back | Enter,Space,KeyZ / Escape,Backspace,KeyX | 0 / 1 |
| retry | KeyR | 8 |

### 2.6 Loop, time, beat
**Per animation frame:**
- `elapsed = min(now-last, MAX_FRAME_DT)`, then `acc += elapsed*AP.Time.scale`.
- While `acc ≥ STEP` and `steps < MAX_STEPS`: run `Input.update` → `Beat.update(STEP)` → `Scenes.update(STEP)`.
- Then set `AP.Time.alpha = acc/STEP`, call `Scenes.render()`, then `AP.call('Audio.tick')`.

```
AP.Loop.start() stop() step(n) renderOnce() fps
AP.Time = {now, step, frame, alpha, scale}   // scale = assist speed while 'level' is the top scene, else 1
AP.Beat.set(bpm, meter, poly?) (resets only if changed) ; reset() ; update(dt)
fields: bpm meter poly time beat(float) bar inBar phase(0..1) ticked barTicked
polyIndex(k) polyTicked(k) euclidTicked(k,n,rot=0) realBpm() (= bpm*AP.Time.scale)
```
- AP.Beat is the gameplay clock. It keeps running while paused, in hitstop and after death. LevelScene calls `AP.music(level.music)` and then `AP.Beat.reset()` on enter.
- Audio follows AP.Beat, never the other way round.

### 2.7 Save and progress
Storage keys are `apeiron.save.v1` and `apeiron.save.v1.bak`. The schema below is v1, with defaults.
```
{ v:1, created:0, playTime:0, form:3,
  unlocked:{'w1-1':true},
  levels:{ '<id>':{done:false,best:0,deaths:0,shards:0,shardsTotal:0,gems:[false,false,false],assisted:false,clears:0} },
  stats:{deaths:0,jumps:0,dashes:0,orbits:0,shards:0,gems:0,secrets:0,bossKills:0,levelsDone:0},
  theorems:{}, cosmetics:{trail:'none',palette:'default',unlocked:['none','default']},
  endless:{best:0,bestSeed:0,runs:0,daily:{}}, flags:{introSeen:false,endingSeen:false,endlessUnlocked:false},
  settings:{master:0.8,music:0.6,sfx:0.8,shake:1,flash:'full'|'reduced'|'off',particles:'high'|'med'|'low',
            bg:'high'|'low'|'off',showTimer:false,hud:'full'|'minimal',keys:{...},pad:{...},
            assist:{on:false,speed:1,invincible:false,infiniteAir:false}} }
```
```
AP.Save.data ; load() (never throws) ; save(force=false) (throttle 1 s) ; reset() ; resetSettings()
level(id)→record ; setGem(id,n) (persists immediately) ; stat(key,inc=1)
setting('assist.speed') ; setSetting(path,value) → emits settings:changed ; export()→string ; import(str)→bool ; available
```
- **Load:** try/catch around parse, then the `.bak` copy, then defaults.
- **Repair:** deep-merge the loaded data over defaults, type-check every field, drop non-finite numbers, make sure every action keeps at least one binding.
- **Backup:** after a successful load, the main copy is written to `.bak`.
- **Write failure:** keep running in memory and toast "Saving unavailable".

```
AP.Progress.order()→[w1-1..w1-3,w1-boss,…,w5-boss] ; next(id)→id|null ; isUnlocked(id) (#unlockall in DEV → true)
complete(id, run)→{firstClear,newBest,unlocked:[ids],formGained,ending}   // unlock next; boss → form=max(form,reward); w5-boss → endlessUnlocked
percent()→0..100 (levels 50%, gems 30%, best shards 20%) ; worldState(n)→{unlocked,done,levelsDone,gems,gemsTotal}
```

### 2.8 Rendering and art interfaces
```
AP.R.init(stage) ; W=960 H=540 ; scale (CSS px/unit, fit+letterbox, fractional) ; dpr ; px=scale*dpr ; ctx (#game 2D)
AP.R.quality → {particles:1|0.6|0.3, bg:'high'|'low'|'off', mid:bool}   // settings + auto-downgrade
FONT_UI='"Segoe UI","Helvetica Neue",Arial,sans-serif' ; FONT_MONO='Consolas,"SF Mono",Menlo,monospace'
font(size,weight='600',family) ; text(ctx,str,x,y,{size,color,align,baseline,weight,alpha,mono,maxW})
poly(ctx,cx,cy,r,sides,rot=0) (path only; sides≥32 → circle) ; star(ctx,cx,cy,rOut,rIn,points,rot=0) (path only)
glow(ctx,x,y,radius,color,alpha=1) (cached radial sprite, 'lighter', restores state) ; line(ctx,x1,y1,x2,y2,color,w=2,a=1)
additive(ctx,fn) ; pal(styleKey)→{bg,primary,accent,hazard,ink} ; drawBackground(key,p) ; bgFallback ; drawTilesFallback ; hudFallback
flash(color,dur,alpha) ('reduced': alpha×0.35, ≤1 per 0.5 s; 'off': none) ; toggleFullscreen()
AP.GL.init(canvas)→bool (webgl1 {alpha:false,antialias:false,depth:false,powerPreference:'low-power'}) ; gl ; ok
AP.GL.compile(vs,fs)→program|null ; drawFullscreen(program) (attribute aPos, loc 0) ; resize() ; bgScale (high 0.5, low 0.25)
  On webglcontextlost: preventDefault and use the 2D fallback. On restore: call AP.Backgrounds.init again.
```
**LevelScene render order (mandatory)**
1. Background: `AP.R.drawBackground(L.style, p)`.
2. `AP.Midground.render(ctx, L.style, p)` in screen space.
3. Apply the world transform (`cam.renderX/Y`, snapped to device pixels).
4. Entities with `behindTiles`.
5. `AP.TileArt.draw`, or the CORE fallback.
6. All other entities, sorted by `layer` (player layer is 10).
7. `AP.FX.render(ctx, false)`.
8. Switch to screen space: `AP.HUD.render`, then flash, then DEV overlay.

**ART owns these interfaces:**
```
AP.Backgrounds.init(gl)→bool ; has(key)→bool ; render(gl,key,p) ; render2D(ctx,key,p) (optional)
  p={t,camX,camY,w:960,h:540,intensity:0..1,beat,phase,pal,seed,quality}; keys = AP.STYLES
  GLSL ES 1.00, 'precision mediump float;', uTime wraps at 3600 s, ≤4 noise octaves, loop bounds constant, ≤2 ms GPU.
AP.Midground.render(ctx,key,p)   // screen space; p={t,camX,camY,L|null,pal,quality,intensity,beat}; ≤1.5 ms
AP.TileArt.build(L) ; draw(ctx,L,cam) (world transform set) ; invalidate(L,tx,ty) ; dispose(L) ; resize()
  Reads L.tiles,w,h,style,pal,seed. Chunks are CHUNK=256u squares; cache ≤ CHUNK_CACHE; resolution min(AP.R.px, CHUNK_PX_MAX);
  ≤2 rebuilds per frame. Out of bounds counts as SOLID on the left/right/top edges and EMPTY at the bottom.
  FAKE is drawn IDENTICALLY to SOLID. BREAK must look clearly different from SOLID in every style.
  Spikes use pal.hazard and must visually match their 14u hurtbox. One-way tiles are a top bar 8u thick.
AP.Art (optional kit; callers guard): truchet(ctx,x,y,size,orient,o) crystal(ctx,flatPoly,pal,t,o) vine(ctx,segs,pal,growth,o)
  koch(ctx,flat,color,width) sierpinski(ctx,cx,cy,size,depth,color,alpha) lissajous(ctx,cx,cy,ax,ay,fx,fy,phase,color,width,steps)
  phyllo(ctx,cx,cy,n,c,color,dot,t) glowStroke(ctx,path2D,color,width,glowAlpha)
```
**Style rules (every drawing agent)**
- Draw only regular polygons, stars, arcs, lines and Béziers.
- Outlines are 2u for terrain, 2–3u for entities and 2.5u for the player. Glow comes only from `AP.R.glow`, radius ≤ 48u, at most 60 glows per frame from entities.
- Colour roles:
  - **hazard:** anything that kills. It must also have a spiky silhouette, so it reads without colour.
  - **accent:** collectibles and interactables.
  - **primary:** terrain.
  - **ink:** the player and text.
- Anything that activates (lasers, turrets, crumbles) shows a telegraph of at least 0.4 s or 1 beat.

### 2.9 Scenes
```
AP.Scenes.register(name,scene) ; has(name) ; go(name,params,{fx:'fade'|'iris'|'shatter'|'none',dur:0.5,color})
push(name,params) ; pop(result?) ; top() ; stack ; current
scene = { enter(params,from), exit(to), update(dt) /*top only*/, render(ctx) /*all, bottom→top, screen space*/,
          bg:'title'|function(){return {key,camX,camY,intensity}} /*bottom scene*/, transparent:false, covered(), uncovered() }
```
- Calling `go` during a transition queues it; the last call wins.
- Input is locked during transitions.
- After the top scene renders, the manager calls `AP.call('Meta.renderToasts', ctx)`.

| scene | owner | params |
|---|---|---|
| devmenu | CORE | {} |
| level | CORE | {id?, level?, mode:'story'\|'endless'\|'test', form? (test only), onComplete?(result), onQuit?()} |
| title, intro{next?}, map{focus?,celebrate?}, results(result), ending, credits, theorems, cosmetics | UI | as listed |
| pause{L}, settings{from?}, remap | UI | pushed overlays (`transparent: true`) |
| endless{seed?, daily?} | W1 | – |

### 2.10 Camera (`L.cam = new AP.Camera(L)`)
```
x,y (view top-left) w=960 h=540 ; follow(e) ; snap() ; setBounds(x,y,w,h) (default level; centered if smaller)
lock(rect|null,{snap:false}) ; shake(mag,dur) (×settings.shake) ; kick(dx,dy) ; visible(x,y,w,h,pad=32)
toScreen(wx,wy,out) ; toWorld(sx,sy,out) ; cx() ; cy() ; renderX/renderY (interpolated + shake + device-pixel snapped)
```
- **Lookahead:** `facing*56 + clamp(vx*0.12, ±110)` horizontally; +64 down when `vy > 500`.
- **Smoothing:** damping λx = 7/s, λy = 5/s.

### 2.11 Particles
```
AP.FX.emit(x,y,o)→count  o={n=8,color,color2,speed:[60,180],angle:[0,TAU],life:[0.3,0.6],size:[2,4],sizeEnd=0,
      gravity=0,drag=0,shape:'dot'|'tri'|'sq'|'pent'|'hex'|'star'|'line'|'ring',spin:[-4,4],additive=true,back=false}
AP.FX.burst(name,x,y,o?) (o.color,o.n,o.dir,o.form) ; ring(x,y,r0,r1,life,color,width=2) ; preset(name,fnOrOpts) (worlds: 'wN.*')
update(dt) ; render(ctx,back) ; clear() ; count()   // n is scaled by quality.particles; hard cap PARTICLES_MAX (oldest recycled)
CORE presets: dust land jump walljump dash dashTrail burst death respawn shard gem checkpoint break crumble bounce spark
              explode portal orbit fling secret hit bossHit bossDeath vertex
```

### 2.12 Entities
```
AP.Entities.register(type, def)  // duplicate → warn, last wins; unknown def keys → warnOnce
AP.Entities.get(type) has(type) list(prefix?) proto
```
**Allowed keys on `def`, with defaults:**
- `kind: 'sensor'|'actor'|'solid'` (default `'sensor'`)
- `w: 24`, `h: 24`, `size(spec) → [w, h]`
- `anchor: 'floor'|'center'|'ceiling'|'tile'` (default `'floor'`)
- `layer: 0`, `behindTiles: false`
- Flags, all default `false`: `hazard`, `stompable`, `dashable`, `burstable`, `oneWay`, `orbitNode`, `boss`
- `carry: true`, `required: []` (spec keys that must be present)
- `lint: 'ignore'|'solid'|'stand'|'hazard'|'bounce'|'orbit'|'mover'`, `lintRects(spec, x, y) → [[x, y, w, h, kind]]`
- `renderPad: 64`, `alwaysRender: false`
- Boss only: `bossName`, `phases`
- Hooks: `init`, `update`, `render`, `onTouch`, `onStomp`, `onDash`, `onBurst`, `onPlayerDeath`, `onRespawn`, `onSquish`, `onRemove`, `debugDamage`

**Reserved instance fields** (custom state goes in `e.s`, which starts as `{}`):
`id, type, def, kind, x, y, w, h, vx, vy, px, py, rx, ry, xRem, yRem, t, spec, tx, ty, homeX, homeY, layer, active, visible, dead, collidable, touching, minion, broken, parent, s`.

**Composite entities** (e.g. `w4.vine`, `w5.wave`) use kind `'sensor'`. They are controllers that spawn child entities (usually `oneWay` solids) through `L.spawn`, set `child.parent = e`, and remove their children in `onRemove`.

**Hooks.** Every call is wrapped in `AP.guard`. If a hook throws, the entity gets `broken = true`, is removed, and the error goes to `AP.errors`.
```
init(e,spec,L)           after position is final (anchor computed from size(spec) or w/h)
update(e,dt,L)           every step while e.active (all entities update every step; render is culled)
render(e,ctx,L)          world transform applied; DRAW AT e.rx/e.ry (interpolated)
onTouch(e,P,L,first)     each step the live player overlaps; first=true on the first overlapping step
onStomp(e,P,L)→bool      if stompable && P.vy>0 && P.prevBottom ≤ e.py+STOMP_TOL. true → engine bounces P
                         (vy=-STOMP_V, or -STOMP_V_HELD if jump is held), refreshes air, hitstop 0.04, sfx 'stomp'
onDash(e,P,L)→bool       once per dash per entity while P is dashing and overlapping; true = handled (no kill)
onBurst(e,P,L)           double-jump pentagram, if e's center is within BURST_RADIUS of P's center
onPlayerDeath(e,L) ; onRespawn(e,L) (reset here) ; onSquish(e,L) (default L.remove(e)) ; onRemove(e,L)
```
**Fixed step order (LevelScene.update)**
1. If hitstop is active: decay it and return. (Beat still advances; it runs outside the scene.)
2. Advance time: `L.time += dt`; set `px,py = x,y` for every entity.
3. Run `P.update`.
4. Run every other entity's update, in spawn order.
5. Resolve contacts for each overlapping entity, stopping at the first that applies: (a) `onDash` if dashing and dashable; (b) `onStomp` on a valid stomp; (c) `hazard` → `L.killPlayer(type)` unless invulnerable or in god mode; (d) `onTouch` if the player is still alive.
6. Check spike tiles and pits. The player dies when its top is below `ph + PIT_MARGIN`.
7. Flush spawns. Entities spawned during this step are drawn now and start updating next step.
8. Remove dead entities (calls `onRemove`).
9. Update camera, FX and timers, then advance the death/respawn state machine.

Before rendering: `rx = lerp(px, x, alpha)`, and the same for `ry`. `e.setPos` sets `px = x` so teleports don't smear.

### 2.13 Physics (entity prototype; Celeste model)
```
e.cx() e.cy() e.right() e.bottom() e.overlaps(o) e.overlapsRect(x,y,w,h)
e.collideAt(dx,dy)→bool  // SOLID/BREAK tiles + collidable non-oneWay solids except self
e.groundAt(dx=0)→bool    // solid or one-way top directly under the bottom edge
e.moveX(amt,cb)→blocked ; e.moveY(amt,cb)→blocked   // remainder accumulate; round; 1u steps; block → rem=0, cb(hit)
   hit={dir:'x'|'y',sign,other:entity|null,tx,ty,code}
   One-way (tile '=' top line, or solid with oneWay) blocks only a 1u DOWNWARD step when the actor's bottom equals
   the platform top before the step and e.dropT ≤ 0.
e.isRiding(solid)  // bottom==solid.y && horizontal overlap (oneWay also needs vy≥0); the player also rides while wall-sliding on it
e.squish()         // def.onSquish; the player first tries 4u nudges both ways, else L.killPlayer('crush')
e.moveSolid(dx,dy) // per axis integer m: riders=actors riding (computed before the move); collidable=false; move;
                   // overlapped actor → push with moveX/Y(gap, squish); else rider → move by m; collidable=true.
                   // oneWay solids carry riders and never push.
e.setPos(x,y)      // teleport: clears remainders and sets px/py
AP.Phys.gravity(e,dt,mult=1,maxFall=MAX_FALL) approach(v,t,d) rectSolid(L,x,y,w,h,ignore)
AP.Phys.raycast(L,x0,y0,dx,dy,maxDist,out)→out{hit,x,y,dist,tx,ty,other} (DDA over tiles + solid AABBs)
AP.Phys.walk(e,dt,speed,{turnAtLedge:true})  // patrol helper with gravity
```
Actors never collide with each other. Entity-to-entity interaction goes through `L.query`.

### 2.14 LevelScene `L` (also `AP.level`)
**Fields**
- Identity: `id, def, mode, world, index, form, style, pal`
- Randomness: `seed` = `AP.hash(id)`, `rng`
- Geometry: `w, h` (tiles), `pw, ph` (u), `tiles` (Uint8Array)
- State: `time, player, entities` (read-only), `cam`, `stats{deaths, shards, shardsTotal, gems[3], secrets}`, `flags{}` (cleared on restart), `checkpoint{x, y, index}`, `bossInfo` (`null` or `{name, frac, phase, phases, entity}`), `intensity` (0..1; drives the background and is set by bosses), `ended`

```
spawn(type,cx,cy,spec?)→e (center placement, u) ; remove(e) ; find(type)→[] ; first(type) ; byTag(tag)→[]
query(x,y,w,h,filter?)→[] ; queryInto(out,x,y,w,h,filter?) ; orbitNodes()→[] ; burst(cx,cy,r)
killPlayer(cause)→bool ; setCheckpoint(cx,by,index) (cx = center x, by = bottom y) ; retry() (counts a death, cause 'retry')
restart() ; skipLevel() (assist only; assisted=true) ; quit() (onQuit or go('map',{focus:id}))
completeLevel({grantForm?,ending?})   // 0.8 s exit sequence → AP.Progress.complete → 'level:complete' →
                                      // params.onComplete(result) || go('results',result) || inline fallback
refreshAir() ; shake(mag,dur) ; kick(dx,dy) ; hitstop(sec) (max(current,new), ≤HITSTOP_MAX) ; flash(color,dur=0.15,alpha=0.6)
bossStart(e) ; bossBar(frac,phase?) ; bossDefeated(e) ; clearMinions()
tileAt(tx,ty)→code (left/right/top out of bounds = SOLID, bottom = EMPTY) ; setTile(tx,ty,code) (event + TileArt.invalidate;
   new solid over the player → push up ≤32u, else kill 'crush') ; breakTile(tx,ty,cause)→bool (BREAK only; FX + sfx 'break')
tileFree(tx,ty)→bool ; snapshotTiles()→Uint8Array ; restoreTiles(snap) ; solidAt(x,y,w,h,ignore?) ; raycast(...)
on(name,fn)→off ; emit(name,payload)
```
**Result object:**
```
{ id, world, index, name, mode, time, deaths, shards, shardsTotal, gems:[b,b,b], newBest, firstClear, assisted, formGained (0|form), next (id|null), ending }
```

**Assist mode**
- **speed:** sets `AP.Time.scale`.
- **invincible:** only `pit` and `crush` still respawn the player, and no death is counted.
- **infiniteAir:** the double jump and dash refresh every airborne step; the dash cooldown still applies.

### 2.15 Player (type `player`, an actor, 22×22, floor anchor)
**Fields**
- Form: `form`, `ab{wall, double, dash, orbit}`
- State: `state` ∈ `'normal'|'dash'|'orbit'|'dead'|'respawn'|'frozen'`, `grounded`, `wall` (−1|0|1), `facing`
- Motion: `vx, vy`, `prevBottom`
- Resources: `hasDouble, hasDash, dashDir{x, y}, orbitNode, invuln`
- Visual: `vis{rot, sx, sy, eyeX, eyeY}`, `trail` (ring buffer, up to 32 entries of `{x, y, rot, form}`)

```
setForm(f) ; addForce(fx,fy) (u/s², consumed next step) ; launch(vx|null,vy|null,{refresh=true,noCut=true,lock=0})
refresh(kind?) ('double'|'dash'|both) ; freeze(on) ; isDashing() ; isOrbiting() ; cx() ; cy()
```
**Step order (mandatory; the conformance numbers depend on it)**
1. **Timers and input.** Tick timers, read the axis. Skip control when frozen, dead or respawning.
2. **Orbit** (form 99, orbit held, cooldown ready, a node center within ORBIT_RANGE).
   - *Attach:* `r = clamp(dist, 40, 110)`. Direction is the sign of the tangential velocity, or `facing` if it is below 1 u/s. `s = max(|v_tan|, 420)`.
   - *Each step:*
     - Speed: if `s < 800`, `s += 1200·dt`; otherwise ease down to 800 at 300/s. Add `s += 0.5·G·(tangent·down)·dt`. Cap at 1000.
     - Position: `θ += dir·s/r·dt` and move to the target with moveX/Y. If blocked, detach with v = tangent·s·0.5.
   - *Release* (orbit released or jump pressed):
     - Direction is the tangent, unless the held 8-way axis is within ±45° of it, in which case use the axis direction.
     - `v = dir·min(s·1.15, 1150)`.
     - Refresh the double jump and dash. No jump cut. Emit `player:fling`.
3. **Dash** (form ≥ 6, `buffered('dash', DASH_BUFFER)`, `hasDash`, cooldown ≤ 0).
   - Direction is the 8-way axis (normalised), else `(facing, 0)`. Call `L.hitstop(DASH_FREEZE)`.
   - For DASH_TIME: v = dir·760, no gravity. A jump pressed now is buffered until the dash ends.
   - When the dash ends: `vx = sign(dir.x)·300` (0 if `dir.x = 0`), `vy = dir.y·300`.
   - BREAK tiles hit during the dash go to `L.breakTile`, and the move continues. Ledge correction ≤ 8u.
   - Grounded and not dashing → `hasDash` returns once the cooldown has expired.
4. **Jump** (`buffered('jump', JUMP_BUFFER)`), first match wins:
   - **Drop-through:** Down held while standing on a one-way → `dropT = 0.15` (no jump).
   - **Ground/coyote jump:** grounded or coyote > 0 → `vy = −733`.
   - **Wall jump** (form ≥ 4): wall within 4u, or wall-coyote > 0 → `vx = −side·340`, `vy = −680`, horizontal input forced away from the wall for 0.12 s.
   - **Double jump** (form ≥ 5) with `hasDouble` → `vy = −650`, `L.burst(cx, cy, 64)`, FX `burst`.
5. **Jump cut.** If jump is released while `vy < 0` and the move allows cutting, `vy *= 0.45` (once).
6. **Horizontal speed.**
   - Ground: accelerate at 3000 when input is held in the direction of motion (or from rest), otherwise decelerate at 3600.
   - Air: accelerate at 2200 with input held, decelerate at 1200 without.
   - Overspeed: if |vx| > 300 and input matches the direction of motion, approach 300 at 400.
   - External forces: `vx += fx·dt`, with |vx| ≤ 600 while forces apply.
7. **Vertical speed.** `g = 2400·(|vy| < 80 && jump held ? 0.5 : 1)`. Then `vy = min(vy + g·dt + fy·dt, Down held ? 1100 : 900)`. While wall-sliding (form ≥ 4, airborne, falling, pressing into a touching wall), `vy ≤ 140`.
8. **Move.** `moveX(vx·dt)` with ledge correction, then `moveY(vy·dt)` with ceiling corner correction ≤ 8u. On landing: grounded, refresh double jump and dash, emit `player:land`.
9. **Post-move.** Ground and wall checks, coyote timers (0.10 s and 0.08 s), push to the trail, update visuals: rotate in air, snap to the nearest 2π/N on landing, squash/stretch, eye leads the motion.

**Death:** edge-shatter FX, `DEATH_TIME`, then respawn at the checkpoint with a `RESPAWN_TIME` reassemble during which input is frozen, then `RESPAWN_INVULN`.

### 2.16 Common types (CORE)

| type | char | kind | size u | anchor | spec (defaults) | behavior; lint |
|---|---|---|---|---|---|---|
| player | P | actor | 22×22 | floor | – | §2.15 |
| checkpoint | C | sensor | 24×64 | floor | – | latest touched is active; respawn at its tile's bottom-center |
| exit | E | sensor | 40×64 | floor | – | `L.completeLevel()` |
| shard | * | sensor | 14×14 | center | – | collected, 24u magnet |
| gem | 1 2 3 | sensor | 22×22 | center | n | `AP.Save.setGem`; already owned → hollow ghost |
| sign | S | sensor | 32×32 | floor | text = `signs[k]` | text bubble within 2 tiles; `{jump}` `{dash}` `{orbit}` etc. → `AP.Input.label` |
| bounce | B | sensor | 32×12 | floor | dir 'up'\|'left'\|'right' | landing on it → `launch` (up: vy −1040; sides: ±700, −420); lint `bounce` |
| crumble | ~ | solid | 32×32 | tile | delay 0.45, respawn 2.5 | shakes → vanishes → returns when clear; lint `stand` |
| node | O | sensor | 24×24 | center | liss?, path?, speed?, mode? | `orbitNode`; moves with AP.Path; lint `orbit` |
| vertex | V | sensor | 32×32 | center | – | inactive until `bossDefeated`; touch → `completeLevel({grantForm: world.reward, ending: world.n === 5})` |
| mover | – | solid | w×h tiles | tile | path (required), w 3, h 1, speed 3, mode 'pingpong', wait 0.4, oneWay false, trigger false | carries, pushes, crushes; oneWay → 12u thick; trigger → waits for a rider, runs once, resets on respawn; lint `mover` |
| secretwall | auto, one per 4-connected `%` group | sensor | group bbox | – | – | player overlaps → `setTile EMPTY` for the group, `secret` sfx/FX/event, 0.6 s ghost fade |
| trigger | – | sensor | w×h | tile | event (prefixed, required), tag, once true | sets `L.flags[tag] = true` and emits `event {tag}` |
| camzone | – | sensor | w×h | tile | – | `cam.lock(rect)` while the player is inside |
| killzone | – | sensor | w×h | tile | – | hazard; lint `hazard` |
| text | – | – | – | center | text, size 16, role 'ink' | world-space label |
| missing | – | sensor | 32×32 | floor | – | placeholder |

### 2.17 Boss contract (lint and boot-test enforce it)
**Level and definition**
- A boss level has id `wN-boss` and `boss: true`.
- It contains exactly one entity with `def.boss`. Anything the boss spawns sets `e.minion = true`.
- `def` must have `bossName`, `phases ≥ 2`, and the hooks `init`, `update`, `render`, `onRespawn` and `debugDamage`.

**Lifecycle**
1. Call `L.bossStart(e)` within 4 s of the player's first move. This shows the bar, starts music `bossN` and emits `boss:start`.
2. Call `L.bossBar(frac, phase)` whenever HP or phase changes. The engine emits `boss:hit` / `boss:phase`.
3. Call `L.bossDefeated(e)` exactly once.
   - The engine emits `boss:defeat`, plays `bossDeath` with FX, calls `clearMinions()` and fades the music.
   - After 1.2 s it activates the V entity (or spawns one at the arena center if V is missing).
4. On `onPlayerDeath`, clear projectiles and minions.
5. On `onRespawn`, reset to the start of the **current** phase with that phase's HP. Call `restoreTiles(phaseSnapshot)` if the boss changed tiles.

**Rules**
- A damage window opens at least every 10 s in every phase, whatever the player does.
- Every damage method uses only the level's form, is telegraphed in the accent colour, and is reachable within the SAFE envelope.
- The arena is closed. Pits are allowed only if respawning keeps the player in the arena.
- The boss never places a solid on the player (check `L.tileFree`). While vulnerable, it never leaves the view.
- Suggested sizes: 2–4 phases. Total hits: W1 6, W2 8, W3 9, W4 10, W5 12.
- `debugDamage(e, L)` applies exactly one hit in any state after `bossStart`, forcing vulnerability if needed, and advances phases correctly. Defeat must happen within 100 calls.
- **CORE watchdog:** if there is no `boss:hit` for 180 s, toast "Assist mode can skip this fight".

### 2.18 Audio (AUDIO)
```
AP.Audio.init() (no context yet) ; unlock() (lazily creates/resumes the AudioContext on a gesture; idempotent) ; ready
sfx(name,{vol=1,pitch=1,pan=0}) ; has(name) ; music(key|null,{fade=1}) (same key → no-op; a request before unlock plays after it)
setIntensity(0..1) ; duck(amount,dur) ; setLoop(name ∈ AP.LOOPS, vol) (0 stops) ; setVolumes({master,music,sfx})
tick() (per frame: schedule notes 0.12 s ahead from AP.Beat at realBpm(); never schedule in the past; resync when the beat jumps back)
suspend() ; resume()   // CORE calls these on visibilitychange
```
- Before `unlock`, every call is a silent no-op. SFX are dropped, not queued.
- The audio graph is: buses → master gain → DynamicsCompressor → destination.
- At most 24 SFX voices (the oldest is stolen) and 12 music voices.
- Every AP.SFX name and every AP.MUSIC key must exist.
- Music: Euclidean rhythms in the key's meter; w5/boss5 layer 3:4:5 pulses per bar. Each key is a seeded generator, and `setIntensity` adds layers.

### 2.19 UI hooks (UI)
```
AP.HUD.render(ctx,L) (shards run/total, 3 gem slots, deaths, timer if settings.showTimer, boss bar from L.bossInfo, assist badge, form glyph)
AP.HUD.onLevelStart(L) (2 s name card "W2-3 · <name>") ; onLevelEnd(L)
AP.Meta.init() ; toast(title,sub?) ; unlock(id) ; renderToasts(ctx)
AP.Cosmetics.playerStyle(form)→{fill,stroke,glow,eye}|null ; drawTrail(ctx,P)→bool
AP.UI.drawTransition(ctx,kind,cover0to1,color) ; AP.Theorems=[{id,name,desc,hidden?}] (≥24; driven only by §2.4 events)
```
- **Flow:** title → intro (first run) → map → level → results → … → ending → credits → title.
- **Pause menu:** Resume, Retry, Restart, Settings, Assist (incl. Skip), Quit.
- **Settings:** written with `AP.Save.setSetting`; remapping uses `AP.Input.capture`.

### 2.20 Endless (W1)
```
AP.Endless.generate(seed,segment,{difficulty})→level  // id 'e-<seed>-<segment>', world 0, form 99,
   style=music=['w1','w2','w3','w4','w5'][segment%5]; must pass SAFE lint (fuzzed)
AP.Endless.dailySeed(date?)→AP.hash('apeiron-YYYY-MM-DD')
scene 'endless': runs go('level',{level,mode:'endless',onComplete,onQuit}); writes AP.Save.data.endless; emits endless:*;
   uses only AP.Worlds.types (+ own 'endless.*'); checks AP.Entities.has(type) before using a type.
```

### 2.21 Test hooks (CORE)
```
window.AP_NO_AUTOBOOT=true → harness calls AP.boot({headless:true})
AP.Loop.step(n) ; AP.Loop.renderOnce() ; AP.Input.setVirtual/clearVirtual
AP.Test.startLevel(idOrObj,{form?,mode:'test'})→L (synchronous, no transition) ; god(on) ; teleport(cx,by) ; defeatBoss()→bool
```
- **Hash routes:** `#dev`, `#level=<id>`, `#scene=<name>`, `#form=<n>`, `#seed=<n>`, `#unlockall` (DEV only).
- **DEV keys:**

| key | action |
|---|---|
| F1 | hitboxes |
| F2 | perf overlay |
| F3 | god mode |
| F4 | complete level |
| F6 | boss `debugDamage` |
| F9 | devmenu |

## 3. Level format
```js
AP.Levels.register({
  id: 'w2-3', world: 2, index: 3, boss: false,
  name: 'Facet Garden',           // ≤ 22 chars
  form: 4,                        // must equal AP.Worlds.get(world).form (world 0 is exempt)
  style: 'w2', music: 'w2',       // optional; defaults 'w'+world / boss 'boss'+world (w5-boss style 'void')
  par: 75,                        // seconds, required for world levels
  map: ['#####', '#P..#', ...],   // rows top→bottom, equal length; may be built by pure deterministic code at load
  legend: { m: 'w2.mite', t: { type: 'w2.turret', dir: 'left', rate: 0.8 } },
  entities: [ { type: 'mover', x: 12, y: 9, w: 3, path: [[12, 9], [18, 9]], speed: 3 } ],
  signs: ['Hold {jump} to jump higher.'],
  flow: { seed: 3, scale: 10, angle: 0, spread: 60 },        // optional level-wide AP.Flow.fromSpec defaults
  camera: { bounds: [0, 0, 120, 20] },                       // optional, tiles
  lint: { stand: [], open: [], edges: [], openTop: false, skip: false, note: '' },
  meta: {}
});
```
**Global legend (reserved in every level)**
- `.` empty. Spaces are illegal.
- `#` solid.
- `=` one-way platform (top 8u). Down + Jump drops through it.
- `^ v < >` spikes pointing up / down / left / right. Hurtboxes:
  - `^`: [tx·32+3, ty·32+18, 26, 14]
  - `v`: [tx·32+3, ty·32, 26, 14]
  - `<`: [tx·32+18, ty·32+3, 14, 26]
  - `>`: [tx·32, ty·32+3, 14, 26]
  - The tile on the spike's base side should be solid.
- `+` breakable block: solid; broken by `L.breakTile` or by a dash at form ≥ 6.
- `%` fake wall: non-solid, drawn as solid, revealed on touch.
- `~` crumble.
- `P` spawn, `E` exit, `V` vertex, `C` checkpoint, `*` shard, `1 2 3` gems, `B` bounce pad, `S` sign, `O` orbit node.

**Per-level legend**
- Keys match `/^[a-uw-z4-9]$/`: lowercase letters except `v`, plus digits 4–9. Uppercase is reserved.
- A value is a type string or `{type, …params}`. Every instance of that character shares the params.
- World N levels may use only common types, `wN.*`, and `AP.Worlds.get(N).shared` (empty by default). Test and endless levels may use any type.

**Anchoring.** `x, y` are tile coordinates; fractions are allowed in the entities array.
- floor: `x = tx·32+16−w/2`, `y = ty·32+32−h`
- center: the center sits at the tile center
- ceiling: the top-center sits at the tile's top-center
- tile: the top-left sits at the tile's top-left

The entities array uses the same anchoring as map characters, and so do paths: the anchor point travels along the path.

**Spec vocabulary.** All values are in the §0 spec units.
`speed`, `path [[x, y]]`, `mode`, `wait`, `period`, `delay`, `phase` (deg), `dir` ('left'|'right'|'up'|'down'|'cw'|'ccw'), `w`, `h`, `r`, `liss {ax, ay, fx, fy, phase, period}`, `tag`, `once`, `rate`, `pattern [k, n]`, `strength`, `role` ('primary'|'accent'|'hazard'|'ink').

**Level ids.** `w1-1..3`, `w2-1..4`, `w3-1..5`, `w4-1..6`, `w5-1..6`, plus `wN-boss` for each world; `test-*` (CORE); `e-<seed>-<seg>` (endless). That is 24 normal levels, 5 boss levels and 72 gems.

**Limits.** Width 30–400 and height 17–120 tiles, with `w·h ≤ 24000`. Boss arenas range from 30×17 up to 40×60.

**Lint (`tools/lint-levels.js`).** E-codes fail; W-codes warn.
- E01 id format, uniqueness, and the per-world counts in AP.Worlds.
- E02 form and style/music keys valid.
- E03 map is rectangular and uses only legal characters and sizes.
- E04 legend keys are valid and every type is registered and allowed for the world.
- E05 counts:
  - P = 1 in every level.
  - Normal levels: E = 1, V = 0, gems 1/2/3 once each, shards ≥ 10.
  - Boss levels: V = 1, E = 0, exactly one boss entity, no gems.
- E06 borders: first and last columns all `#`. Top row all `#` unless `openTop`. Bottom row only `# . ^`.
- E07 P, C, E, B, S and floor-anchored entities have a standable tile (`# = + ~`) directly below.
- E08 no hitbox overlaps SOLID/BREAK at spawn, and the 3×2 tiles around P are free of hazards.
- E09 the entities array has registered types, in-bounds coordinates, and every `def.required` key present.
- E10 `signs.length` equals the number of `S`, and each sign is ≤ 120 chars.
- E11 SAFE bot: P reaches the exit (E, or V in a boss level), P reaches every C, and every C reaches the exit.
- E12 EXPERT bot: P reaches every gem, and from every gem the player can reach the exit or a C that SAFE-reaches it.
- E13 annotations are in bounds, and `note` is non-empty when any annotation is used.
- W01 size outside the §4.6 targets. W02 more than 45 tiles of path between checkpoints. W03 more than 12 annotations. W04 a hazard within 6 tiles of P or a C along the direction of travel. W05 unused legend key. W06 `par` missing.

**Reachability bot (TOOLS; normative)**
- **Models.** Both use the §2.15 steps 6–9 with AP.C:
  - **SAFE:** RUN ×0.95; every launch velocity (jump, double jump, wall-jump, dash, bounce, orbit release) ×0.97; no hang, no coyote, no corner/ledge correction; takeoff and landing overlap ≥ 8u.
  - **EXPERT:** exact constants, hang on, overlap ≥ 2u.
- **Starts.** Every standable spot, at tile center ±8u.
- **Programs.** Both directions, at most 4 s each:
  - Walk off a ledge, or drop through a one-way.
  - Jump, holding it for 0.05 s, 0.2 s or the full time, combined with horizontal input that is full, none, full then released at the apex, or full then reversed at the apex.
  - Form ≥ 5: add a double jump at the apex or 0.15 s after it, with horizontal input full, none or reversed.
  - Form ≥ 6: add a dash at the apex in 8 directions, with or without the double jump.
  - Form ≥ 4: when airborne against a wall, branch into wall-jumps (up to 6 chained), holding either toward the other wall or back toward this one.
  - Form 99: any step within ORBIT_RANGE of a node creates an orbit vertex. From an orbit vertex, release in 8 aim-assisted directions at 920×factor from radius 80, then continue with the double-jump/dash programs, both refreshed.
- **Touch rule.** Touching a goal (E, V, C or gem) at any simulated step counts as reaching it.
- **Entities** follow their `def.lint` value: `solid`, `stand` (one-way top), `hazard`, `bounce` (launch), `orbit` (node plus all path points), `mover` (every path vertex is a connected stand). `lintRects` overrides any of these.
- **Tiles.** BREAK is solid below form 6 and empty at form 6+. FAKE is empty. Crumble is standable.
- **Annotations.**
  - `lint.stand`: extra one-way cells.
  - `lint.open`: cells treated as empty.
  - `lint.edges`: free edges between the stand nodes nearest to each end.
  - `skip`: turns reachability errors into warnings. Allowed only in boss levels.
- **Budget.** At most 3 s per level in Node. Trajectories may be cached as relative offsets, provided collisions are re-checked.

## 4. Physics: constants, envelopes, design rules
**4.1 Derived values** (simulated with the exact §2.2 constants)

| quantity | value |
|---|---|
| jump held | apex 110u; 0.34 s to apex; 0.667 s back to takeoff height; 200u flat travel at 300 u/s |
| tap jump | apex 21u |
| double jump | 86u alone; jump + DJ at apex 196u |
| wall-jump | apex 94u |
| dash | ≈106–108u |
| jump + up-dash | 236u |
| jump + DJ + up-dash | 322u |
| bounce pad | 222u |
| stomp bounce | 55u, or 110u with jump held |
| terminal velocity | 900 after 0.375 s / 169u of fall; fast-fall 1100 |
| standing-start jump | travel 181u (one tile less than running) |
| orbit release | ≈920 u/s; 35–45° fling ≈ 314–321u at the same height; straight up 174u |
| wall shaft (inner width → gain per hop) | 1: 21u, 2: 65, 3: 90, 4: 94, 5: 80, 6: 39 (marginal), 7: −31 (impossible); single wall +34u/hop (never required) |

**4.2 Conformance test** (`tools/phys-test.js`; CORE must pass)

| test | expected |
|---|---|
| held running jump | apex 110±3u, travel 200±6u, airtime 0.667±0.017 s |
| tap jump | apex ≤ 25u |
| jump + DJ at apex | 196±4u |
| wall-jump | apex 94±3u |
| 3-tile shaft, gain per hop | 90±6u |
| ground dash distance | 106±8u |
| bounce pad | apex 222±5u |
| orbit after 1 s attached | release 920±30 u/s |
| terminal velocity | 900, or 1100 holding Down |

**4.3 Rise limits** (tiles from the takeoff floor to the ledge top)

| move | SAFE | never |
|---|---|---|
| jump (all forms) | 3 | ≥ 4 |
| jump + DJ (5+) | 5 | ≥ 6 |
| jump + up-dash, no DJ (6+) | 6 | ≥ 7 |
| jump + DJ + up-dash (6+) | 9 | ≥ 10 |
| bounce pad | 6 | ≥ 7 |
| wall shaft 2–5 wide (4+) | unlimited | width ≥ 7 |

**Headroom** (empty rows above the floor) needed for an unobstructed arc: jump 5, jump + DJ 7, DJ + up-dash 11.

**4.4 Gap limits, SAFE bot** (empty columns between ledges; dy = landing tiles higher +/lower −; full speed needs ≥ 2 tiles of run-up, and a standing start loses 1 tile)

| dy | −8 | −6 | −4 | −2 | −1 | 0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| jump (all) | 7 | 7 | 6 | 6 | 5 | 5 | 4 | 4 | 3 | – | – | – | – | – | – |
| jump + DJ (5+) | 11 | 10 | 9 | 9 | 8 | 8 | 8 | 7 | 7 | 7 | 6 | – | – | – | – |
| jump + dash, no DJ (6+) | 11 | 11 | 10 | 9 | 9 | 9 | 9 | 8 | 8 | 7 | 7 | – | – | – | – |
| jump + DJ + dash (6+) | 15 | 14 | 13 | 13 | 12 | 12 | 12 | 11 | 11 | 11 | 10 | 10 | 9 | 9 | 7 |

**Tiers**
- **ROUTINE** (most jumps): SAFE − 1.
- **CHALLENGE** (a few per level, on the main path): SAFE.
- **GEM** (optional routes): SAFE + 1, and must pass the EXPERT bot.
- **Theoretical flat maximum** (never design for it): jump 6, DJ 12, DJ + dash 18.

**Orbit (SAFE).** Node center to node center: ≤ 9 tiles horizontally at |dy| ≤ 2; ≤ 7 horizontally when the next node is 3–5 tiles higher; ≤ 8 for a vertical stack.

**4.5 Level-design rules**
1. **Size.** Path length per §4.6. Bosses fit on one screen (30×17), or a vertical arena up to 60 tall.
2. **Checkpoints.** Place one every 20–40 tiles of path and at the start of every new challenge. Each needs ≥ 3 tiles of flat, hazard-free floor. The first is ≤ 40 tiles from P.
3. **Envelopes.** The main path uses ROUTINE/CHALLENGE only. Nothing exceeds GEM tier. Every level must pass the SAFE and EXPERT bots.
4. **Teach → test → twist.** Level 1 of each world introduces the new ability in a hazard-free room with a sign. Each mechanic appears alone before it is combined with others.
5. **Visibility.** The landing spot of every main-path jump is on screen at takeoff: ≤ 14 tiles ahead and ≤ 7 tiles below. Any blind drop of more than 6 tiles is marked by a shard line.
6. **Shards.** 20–60 per level, in trails of 3–9 that trace a real route arc. For a running jump the canonical tile offsets from the takeoff center are (1,−2), (2,−3), (3,−3.5), (4,−3), (5,−2). Use straight lines for dashes and circles for orbits.
7. **Gems.** Gem 1: a visible detour. Gem 2: behind a `%` secret, hinted by a shard or sign. Gem 3: a mastery route at GEM tier. From every gem the player can get back to the route.
8. **Fairness.** No hazard or enemy within 6 tiles of P or any C in the direction of travel. Enemies sit on runs of at least 4 tiles. Saws never pass within 3 tiles of a checkpoint. Telegraphs follow §2.8.
9. **No softlocks.** Every enterable area can be left, or contains a checkpoint or exit. The `retry` action and crumble respawn are backups, not the design.
10. **Ability gating.** Use only the level's form. W5 and Endless use everything.
11. **Dynamic geometry.** Vines, drift platforms, waves and wind lifts need `lint.stand`/`lint.edges` with a `note`. Headwinds are ≤ 0.5 g and span ≤ 4-tile gaps, because the bot ignores wind.
12. **Endless chunks.** Templates have their entry and exit floor at fixed rows, and each template passes lint on its own.

**4.6 Per-world targets**

| world | path length (tiles) | checkpoints | shards | first-clear time |
|---|---|---|---|---|
| W1 | 90–150 | 2–3 | 20–35 | 45–90 s |
| W2 | 110–180 | 3–4 | 25–45 | 60–110 s |
| W3 | 120–200 | 3–5 | 30–50 | 70–130 s |
| W4 | 130–220 | 3–5 | 30–55 | 80–150 s |
| W5 | 140–240 | 4–6 | 35–60 | 90–180 s |

## 5. World metadata — `js/data/worlds.js` (VERBATIM)
```js
/* js/data/worlds.js — owner: CORE — VERBATIM from CONTRACT §5 */
(function (AP) {
  'use strict';
  var S = {
    title:   { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' },
    map:     { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' },
    w1:      { bg: '#0F1630', primary: '#39D3C3', accent: '#FFC857', hazard: '#FF4F6D', ink: '#EAF2FF' },
    w2:      { bg: '#120A24', primary: '#9B7BFF', accent: '#5EF2FF', hazard: '#FF6B3D', ink: '#F4EDFF' },
    w3:      { bg: '#061723', primary: '#4EA8FF', accent: '#FFE27A', hazard: '#FF4F8B', ink: '#E8FBFF' },
    w4:      { bg: '#0C1A10', primary: '#7EDC6A', accent: '#FF9ED8', hazard: '#FF7A2F', ink: '#F1FFE8' },
    w5:      { bg: '#0B0912', primary: '#E9DFC7', accent: '#FFC94A', hazard: '#FF3E9A', ink: '#FFFFFF' },
    endless: { bg: '#050508', primary: '#FFFFFF', accent: '#7CF7D4', hazard: '#FF4D6D', ink: '#FFFFFF' },
    void:    { bg: '#000000', primary: '#F5F5F5', accent: '#8A7CFF', hazard: '#FF2E63', ink: '#FFFFFF' }
  };
  var W = [
    { n: 1, id: 'w1', name: 'The Lattice', art: 'truchet', form: 3, reward: 4, levels: 3, style: 'w1', music: 'w1',
      boss: 'w1-boss', bossType: 'w1.tessellator', bossName: 'The Tessellator', bossStyle: 'w1', bossMusic: 'boss1', shared: [] },
    { n: 2, id: 'w2', name: 'Voronoi Caverns', art: 'voronoi', form: 4, reward: 5, levels: 4, style: 'w2', music: 'w2',
      boss: 'w2-boss', bossType: 'w2.monarch', bossName: 'Crystal Monarch', bossStyle: 'w2', bossMusic: 'boss2', shared: [] },
    { n: 3, id: 'w3', name: 'The Currents', art: 'flow', form: 5, reward: 6, levels: 5, style: 'w3', music: 'w3',
      boss: 'w3-boss', bossType: 'w3.maelstrom', bossName: 'Maelstrom', bossStyle: 'w3', bossMusic: 'boss3', shared: [] },
    { n: 4, id: 'w4', name: 'Fractal Gardens', art: 'fractal', form: 6, reward: 99, levels: 6, style: 'w4', music: 'w4',
      boss: 'w4-boss', bossType: 'w4.recursion', bossName: 'The Recursion', bossStyle: 'w4', bossMusic: 'boss4', shared: [] },
    { n: 5, id: 'w5', name: 'Harmonic Spire', art: 'harmonic', form: 99, reward: 0, levels: 6, style: 'w5', music: 'w5',
      boss: 'w5-boss', bossType: 'w5.null', bossName: 'The Null', bossStyle: 'void', bossMusic: 'boss5', shared: [] }
  ];
  AP.Worlds = {
    list: W, styles: S,
    get: function (n) { return W[n - 1] || null; },
    pal: function (k) { return S[k] || S.title; },
    types: {
      common: ['player', 'checkpoint', 'exit', 'shard', 'gem', 'sign', 'bounce', 'crumble', 'node', 'vertex', 'mover',
               'secretwall', 'trigger', 'camzone', 'killzone', 'text', 'missing'],
      w1: ['w1.crawler', 'w1.bouncer', 'w1.saw', 'w1.tessellator'],
      w2: ['w2.mite', 'w2.turret', 'w2.bolt', 'w2.geode', 'w2.monarch'],
      w3: ['w3.wind', 'w3.drift', 'w3.drifter', 'w3.kite', 'w3.maelstrom'],
      w4: ['w4.vine', 'w4.thorn', 'w4.sierp', 'w4.fruit', 'w4.recursion'],
      w5: ['w5.wave', 'w5.laser', 'w5.ring', 'w5.null']
    }
  };
})(window.AP = window.AP || {});
```
**Required types.** Names, flags and specs are fixed so Endless can use them. Each world may add more `wN.*` types (for example a W5 resonator hazard).

| type | kind | flags | lint | spec (defaults) | behavior |
|---|---|---|---|---|---|
| w1.crawler | actor | hazard stompable dashable burstable | ignore | dir 'right', speed 2 | walks, turns at walls and ledges |
| w1.bouncer | actor | same as crawler | ignore | height 3, dir null | hops on AP.Beat beats (accent on beat 1 of 3) |
| w1.saw | sensor | hazard (not stompable) | ignore | path (required), speed 3, r 0.75, mode | spinning 6-point star moving along the path |
| w2.mite | actor | hazard dashable burstable | ignore | dir 'cw', speed 2 | crawls over any solid surface |
| w2.turret | solid | – | solid | dir 'left' \| aim 'player', rate 0.8, delay 0, speed 8 | 0.4 s telegraph, then fires a `w2.bolt` |
| w2.bolt | sensor | hazard | ignore | dx, dy, speed | flies straight; `breakTile` on `+`; dies on solids |
| w2.geode | solid | – | solid | radius 2 | when struck (landing from ≥ 2 tiles, a bolt, or a dash) it breaks `+` within radius |
| w3.wind | sensor | – | ignore | w, h (required), strength 40, flow {} | `P.addForce(AP.Flow.force)`; draws streamlines from the same function |
| w3.drift | solid oneWay | – | stand | w 3, leash 3 | carried by the flow, spring-tethered to home |
| w3.drifter | actor | hazard stompable burstable dashable | ignore | speed 3 | rides streamlines |
| w3.kite | solid oneWay | – | stand | w 2, len 4 | tethered platform that sways in the flow |
| w4.vine | composite (sensor controller) | – | ignore (+ `lint.stand`) | grow 'near'\|'touch'\|'trigger'\|'beat', tag, dir 'up', len 6, preset | L-system growth spawns one-way platforms; resets on respawn |
| w4.thorn | sensor | hazard | hazard | w 1, h 1, depth 3 | Koch-curve thorn strip |
| w4.sierp | actor | hazard stompable dashable burstable | ignore | size 1, depth 0 | when hit, splits into 3 (depth + 1) down to depth 2 |
| w4.fruit | sensor | – | ignore | respawn 2.5 | refreshes dash and double jump |
| w5.wave | composite (sensor controller) | – | stand (`lintRects` at rest) | n 6, amp 1.5, wavelength 6, period 2, w 1 | row of one-way platforms in a sine wave |
| w5.laser | sensor | hazard while firing | ignore | dir 'down', len 0 (until solid), pattern [3,8], rot 0 | 1-step telegraph, then fires on Euclid onsets |
| w5.ring | sensor | – | ignore | r 1.5, boost 0 | passing through calls `P.refresh()`, plus optional boost |
| wN boss | per §2.17 | boss | ignore | – | Tessellator, Monarch, Maelstrom, Recursion, Null |

Orbit nodes use the common `node` type (`O`, or the entities array with `liss`/`path`).

## 6. Top 10 risks and their mitigations

| # | risk | mitigation built into the contract |
|---|---|---|
| 1 | Interface drift (names, signatures, units) | Verbatim const.js/worlds.js; signature lists; `tools/contract-manifest.js` checks presence, type and arity of every §2 symbol; def-key validation; warnOnce on unknown sfx/events/types; strict units rule; CORE may add but never rename |
| 2 | Load order, global collisions, load-time cross calls | CORE writes index.html with all tags once; mandatory IIFE template; load-time whitelist; harness checks for leaked globals and top-level declarations; missing files tolerated |
| 3 | One module's bug crashes the game | `AP.guard` on every hook and cross call; broken entities quarantined; scene-level try/catch with a "R: return to map" overlay; any entry in `AP.errors` fails the boot test |
| 4 | Unbeatable or unfair AI-made levels | Envelopes derived from the SAFE bot; SAFE (main path) and EXPERT (gems) bots in lint; annotations for dynamic geometry; 12 design rules; `retry`; assist (infinite air, invincible, skip) |
| 5 | Boss softlocks | §2.17: `debugDamage` defeat run in the boot test, mandatory `onRespawn`, 10 s mercy window, tile snapshot/restore, minion cleanup, `tileFree`, closed arena, V reachable (lint), 180 s watchdog toast |
| 6 | Performance | Budgets: update ≤ 3 ms/frame, 2D render ≤ 6 ms, GL ≤ 2 ms, entities ≤ 600, particles ≤ 1800 (scaled), chunk cache caps, ≤ 2 chunk builds per frame; grep bans on shadowBlur/filter/getImageData; render culling; auto-downgrade (particles → bg → midground) after average frame time > 22 ms for 3 s |
| 7 | WebGL failure or shader errors | Fallback per key; guarded compile; context lost/restored handlers; `bg: 'off'` setting; mediump with time wrap; `glsl-lint` heuristic; the boot test runs with GL null and with a stub GL |
| 8 | Audio unlock and timing | Context created lazily on a gesture; no-ops before unlock; AP.Beat drives gameplay so the game works without audio; 0.12 s lookahead scheduler that never schedules in the past; voice caps plus compressor; suspend when hidden; the title screen asks for a key or click (gamepad presses do not unlock audio in Chrome) |
| 9 | Save corruption, or no storage on file:// | Versioned key plus `.bak`; validate and merge defaults; sanitize numbers; try/catch with in-memory fallback; throttled writes; settings reset; export/import |
| 10 | Headless blind spots (visuals, feel, GL, audio) | Stubs run every render path; the physics conformance test pins feel to the tables; deterministic seeds; monkey input plus forced death/respawn/complete; endless fuzz through lint; DEV overlays and hash routes for the final browser smoke check |

## 7. Self-checks (mechanical; every agent runs these before finishing)
**TOOLS command line**
- `node tools/check-all.js [--owner X] [--strict]` runs:
  - syntax compile of every owned file;
  - header, IIFE and banned-pattern scan;
  - harness load in index.html order;
  - leaked-globals check;
  - manifest check (the owner's symbols, or all of them with `--strict`);
  - def-key validation;
  - the owner-specific tests below.
- `node tools/lint-levels.js [--world N|--id ID|--endless K|--no-reach]`
- `node tools/boot-test.js [--world N|--levels test-*|--scenes|--art|--audio|--endless K|--seconds 20|--dist dist/apeiron.html]`
  - Each level: 20 s of monkey input, 3 forced deaths, then `completeLevel`.
  - Each boss level: `defeatBoss()`, then touch V.
  - Each scene: enter, update for 5 s with random input, render, exit.
  - Both GL modes; save round-trip; loading a corrupted save.
- `node tools/phys-test.js`, `node tools/test-algo.js`, `node tools/glsl-lint.js`, `node tools/build-dist.js`

| agent | must pass |
|---|---|
| CORE | `check-all --owner CORE`; `phys-test`; `boot-test --levels test-*` (`test-core` holds every tile and common type at form 99; `test-forms` holds one room per form); `docs/ENGINE_API.md` written |
| TOOLS | `test-algo`; `lint-levels` on `tools/fixtures/*`, including a known-unreachable fixture lint must reject; harness self-test |
| ART | `check-all --owner ART`; `boot-test --art` (all 9 styles: GL, render2D, midground, tile art on synthetic maps); `glsl-lint` |
| AUDIO | `check-all --owner AUDIO`; `boot-test --audio` (`has()` true for all 47 SFX; every music key and loop runs on the stub AudioContext) |
| UI | `check-all --owner UI`; `boot-test --scenes` |
| W1–W5 | `check-all --owner WN`; `lint-levels --world N` with zero E-codes; `boot-test --world N` |
| W1 / Endless | additionally `lint-levels --endless 50` and `boot-test --endless 10` |
| INTEGRATOR | `check-all --strict`, `lint-levels` (all), `boot-test` (all), `build-dist`, `boot-test --dist dist/apeiron.html` |

**World agent priority order:**
1. Required types with simple art.
2. All levels passing lint.
3. The boss passing the defeat test.
4. Art polish.
5. Extra types.

P0 agents (CORE, ART, AUDIO) rerun `check-all` once TOOLS has delivered, which may be after they finish their own code. Until then `node --check <file>` is the minimum, and the gate after workflow A reruns the full checks.
