# APEIRON Engine API (as built by CORE)

This is the reference for UI, W1–W5 and the INTEGRATOR. It documents what CORE actually ships, including
everything beyond `docs/CONTRACT.md`. Every CONTRACT §2 name and signature exists exactly as specified; anything
extra is marked **(extra)**. Where this file and the CONTRACT disagree on a §2 name, the CONTRACT wins and the
difference is a CORE bug.

Contents
1. Quick start for world agents
2. Conventions (units, coordinates, anchors, time, naming)
3. Boot, frame loop and the level step order
4. Module reference
5. Entities: def schema, instance fields, hooks, contacts, spawning
6. Physics model (actors, solids, one-way, riding, squish)
7. The player
8. The level instance `L` (scene `level`)
9. Levels: format, compile, anchoring
10. Bosses
11. Events
12. FX presets
13. Sounds CORE plays for you
14. Rendering: order, ctx conventions, palettes, budgets
15. UI integration points
16. Test hooks, DEV keys, hash routes
17. Worked examples: simple enemy, moving solid, composite, boss
18. Gotchas

---

## 1. Quick start for world agents

```js
/* js/worlds/w1/entities.js — owner: W1 */
(function (AP) {
  'use strict';
  AP.Entities.register('w1.crawler', {
    kind: 'actor', w: 24, h: 20, anchor: 'floor', layer: 5, lint: 'ignore',
    hazard: true, stompable: true, dashable: true, burstable: true,
    init: function (e, spec, L) { e.s.dir = spec.dir === 'left' ? -1 : 1; e.s.speed = (spec.speed || 2) * 32; },
    update: function (e, dt, L) { AP.Phys.walk(e, dt, e.s.speed); },
    render: function (e, ctx, L) { /* draw at e.rx, e.ry */ },
    onRespawn: function (e, L) { e.setPos(e.homeX, e.homeY); e.vx = e.vy = 0; e.s.dir = e.spec.dir === 'left' ? -1 : 1; }
  });
})(window.AP = window.AP || {});
```
- Custom state lives in `e.s` (starts `{}`). Never invent new top-level fields on `e` (reserved list in §5).
- Hooks get `dt = AP.C.STEP` (1/120). Use `dt`, `L.time` (never `Date.now`/`performance.now`).
- Subscribe with `L.on(name, fn)` inside entities (auto-removed at level exit), never `AP.Events.on`.
- Draw at `e.rx/e.ry` (interpolated), in **world space** (the transform is already applied).
- A stompable/dashable/burstable entity without the matching hook is **defeated automatically** (§5.6).
- Everything that can throw is guarded: a throwing hook quarantines that entity (removed, error in `AP.errors`).

---

## 2. Conventions

| thing | rule |
|---|---|
| world units | 1u = 1 logical px at 960×540; tile `T = 32u` |
| origin / axes | top-left, +x right, **+y down**; angle 0 = +x, positive angles are **clockwise** on screen |
| entity box | `x, y` = top-left of the AABB hitbox, `w, h` its size (all u) |
| tiles | `L.tiles` is a `Uint8Array`, index `ty * L.w + tx`; codes in `AP.TILE` |
| out-of-bounds tiles | left/right/top = `SOLID`, below the map = `EMPTY` (pits) |
| level spec units | tiles, tiles/s, tiles/s², seconds, degrees — convert with `AP.U.t(n)` (=n·32) and `AP.U.deg(d)` |
| time | fixed step `AP.C.STEP = 1/120 s`; level clock `L.time` (stops in hitstop/pause); music clock `AP.Beat` (never stops) |
| integer positions | actors and solids sit on **integer** coordinates (sub-unit motion is kept in `xRem/yRem`); sensors may be fractional |
| naming | types `name` (common) or `wN.name`; custom events `wN:`, `ui:`, `endless:`; FX presets `wN.*`; SFX only from `AP.SFX` |

**Anchors** (map characters, the `entities` array and paths all use them; tile coords may be fractional in the entities array):

| anchor | the box is placed so that… | world anchor point of tile (tx, ty) |
|---|---|---|
| `floor` (default) | its bottom-centre sits on the tile's bottom-centre | (tx·32+16, ty·32+32) |
| `center` | its centre is the tile centre | (tx·32+16, ty·32+16) |
| `ceiling` | its top-centre is the tile's top-centre | (tx·32+16, ty·32) |
| `tile` | its top-left is the tile's top-left | (tx·32, ty·32) |

For `path` specs the **anchor point travels along the path** (use `AP.Entities.pathWorld(spec.path, def.anchor)`).
`L.spawn(type, cx, cy, spec)` always places by **centre** (world u).

---

## 3. Boot, frame loop and the level step order

`js/main.js` → `AP.boot(opts)` (autoboots unless `window.AP_NO_AUTOBOOT`):
1. `AP.Save.load()` → `AP.Input.init(window)` → `AP.R.init(#stage)` → `AP.GL.init(#bg)` + `AP.Backgrounds.init(gl)` →
   `AP.Audio.init()` → volumes → `AP.Meta.init()` → settings listener → DEV keys (when `#dev`) → window listeners
   (visibility → `Audio.suspend/resume` + save flush + auto-pause, blur → auto-pause outside DEV, `error` → `AP.errors`).
2. First scene from the hash route, else `title` if registered, else `devmenu` (§16).
3. `AP.Loop.start()` (not in headless).

Per animation frame (`AP.Loop`): `elapsed = min(dt, 0.1)·AP.Time.scale` into an accumulator; while `acc ≥ STEP` (≤12 steps):
`AP.Input.update` → `AP.Beat.update` → `AP.Scenes.update` (top scene only). Then `AP.Time.alpha = acc/STEP`,
`AP.Scenes.render()` (all scenes bottom→top, then toasts, transition, flash, overlay), `AP.call('Audio.tick')`,
`AP.Save.tick(elapsed)` (throttled writes, play time). `AP.Time.scale` = assist speed while `level` is the top scene.

**Level step (`L.update(dt)`, CONTRACT §2.12, exactly):**
1. hitstop active → decay it and return (Beat still advances).
2. `L.time += dt`; every entity `px,py = x,y`.
3. player `update` (§7 order).
4. every other **active** entity's `update`, in spawn order (`e.t += dt` first).
5. contacts with the live player (§5.5).
6. spike tiles (`AP.Tilemap.rectHitsSpike`) and pits (player top below `ph + PIT_MARGIN`).
7. flush spawns (entities spawned this step are drawn this frame and update from the next step).
8. remove dead entities (`onRemove` is called).
9. camera, FX, timers (boss watchdog, vertex activation, intensity→audio), death/respawn state machine, exit sequence.

Before rendering: `e.rx = lerp(e.px, e.x, alpha)` (same for y). During hitstop/pause alpha is forced to 1.

---

## 4. Module reference

### 4.1 `AP` root (`js/core/ap.js`)
| member | notes |
|---|---|
| `VERSION` `'1.0.0'`, `DEV` (hash contains `dev`), `headless` (extra), `level` (current L or null) | |
| `log(...)`, `warn(...)`, `warnOnce(key, ...)` → bool | console with `[AP]` prefix |
| `errors` `[{label, message, stack}]`, `reportError(label, err)`, `errorCount` (extra) | capped at 400 entries |
| `guard(label, fn, a, b, c, d)` → result \| undefined | try/catch → `reportError` |
| `has('Audio.sfx')` → bool, `call('Audio.sfx', ...args)` → result \| undefined | dotted lookup on `AP`, `this` = parent object, errors reported |
| `sfx(name, opts?)` | → `AP.Audio.sfx`; unknown names warn once in DEV |
| `sfxAt(name, x, y, opts?)` | pan = clamp((x−camCX)/480,−1,1); vol ×= 1−clamp((dist−480)/640,0,0.8); `opts.pan` adds |
| `music(key \| null, opts?)` | `AP.Beat.set(AP.MUSIC[key])` + `Audio.music(key, opts)`; `AP.currentMusic` (extra) |
| `toast(title, sub?)` **(extra)** | `AP.Meta.toast` when present, else a CORE fallback toast |
| `clock()` **(extra)** | wall-clock ms for profiling only (never gameplay) |
| `boot(opts?)`, `isBooted()` (extra), `readDev()` (extra) | main.js |

### 4.2 Constants (`js/core/const.js`, verbatim CONTRACT §2.2)
`AP.C`, `AP.TILE`, `AP.TILE_CHARS`, `AP.ENTITY_CHARS`, `AP.FORMS`, `AP.FORM_NAMES`, `AP.abilities(f)`, `AP.ACTIONS`,
`AP.SFX`, `AP.LOOPS`, `AP.MUSIC`, `AP.STYLES`, `AP.EVENTS`, `AP.U`. `AP.Worlds` is in `js/data/worlds.js` (verbatim §5).

### 4.3 `AP.M`, `AP.Color` (`js/core/math.js`)
`AP.M`: `TAU PI DEG clamp lerp invLerp approach sign damp wrapAngle angleDiff dist len norm(x,y,out) rot(x,y,a,out) aabb pointInPoly ease.{linear,inQuad,outQuad,inCubic,outCubic,inOutSine,outBack,outElastic}`
plus **(extra)** `dist2 fract mod(a,n) smoothstep(a,b,v) lerpAngle(a,b,t) spring(x,v,target,k,c,dt)→v`.
`AP.Color`: `rgb(hex)→{r,g,b}` (frozen, cached) · `rgba(hex,a)→css` (cached per 1/1000 alpha) · `mix(h1,h2,t)→hex` ·
`shade(hex,−1..1)→hex` · `hsl(h°,s,l,a)→css` · `vec3(hex)→[r,g,b]` 0..1 · **(extra)** `toHex(r,g,b)`, `luma(hex)`.

### 4.4 `AP.hash`, `AP.hash2`, `AP.RNG` (`js/core/rng.js`)
`AP.hash(str)` FNV-1a uint32 · `AP.hash2(x,y,seed)` uint32 · `AP.RNG(seed|string)` mulberry32 →
`{next() [0,1), int(lo,hi) inclusive, range(lo,hi), pick(arr), chance(p), sign(), shuffle(arr) in place, fork(salt) (independent stream from the original seed), state(v?) (extra), seed}`.

### 4.5 `AP.Noise` (`js/core/noise.js`)
`n2(x,y)`, `n3(x,y,z)` simplex in [−1,1] (fixed permutation from `AP.RNG(1337)`), `fbm2(x,y,oct=4,lac=2,gain=0.5)`,
`fbm3(x,y,z,oct=3,lac=2,gain=0.5)`, `worley2(x,y,seed,out?)→{f1,f2,id}` on unit cells (pass `out` in hot loops).

### 4.6 `AP.Flow` (`js/core/flow.js`) — the ONE flow field (normative formula, CONTRACT §2.3)
`DEFAULT {seed:0, scale:320, tscale:0.08, angle:0, spread:π, mmin:0.35, swirl:null}` ·
`params(partial)` (code units) · `fromSpec(spec)` (tiles/degrees: `scale` tiles default 10, `angle`/`spread` deg, `swirl:[cx,cy,R,k]` with cx,cy,R in **tile coordinates**) ·
`sample(x,y,t,p,out)→{x,y,m}` · `force(x,y,t,p,strength,out)→{x,y}` u/s² · `velocity(x,y,t,p,speed,out)` u/s ·
`streamline(x,y,t,p,stepLen,n,outFlat)→[x0,y0,…]` (RK2; negative `stepLen` traces upstream).
**`t` must be `L.time`** for both physics and art. A level-wide default is `L.flow` (= `fromSpec(def.flow)` or null).

### 4.7 `AP.Path` (`js/core/path.js`) — stateless
`poly(pts, speed, mode, t, out, wait=0)→out{x,y,i,dir,wait}` (`pts` world `[[x,y]]`, `speed` u/s, mode `'loop'|'pingpong'|'once'`,
`wait` seconds at every vertex; `out.wait` (extra) is true while waiting, `out.i` the vertex last left/waited at) ·
`length(pts, closed?)` · `liss(p,t,out)` · `lissFromSpec({ax,ay,fx,fy,phase,period}, anchorX, anchorY)→p` (ax/ay tiles, phase deg; default period 4) ·
`circle(cx,cy,r,period,t,phase,out)`.

### 4.8 `AP.Events` (`js/core/events.js`)
`on(name,fn)→off` · `once(name,fn)→off` · `off(name,fn)` · `emit(name,payload)→listeners called` · **(extra)** `count(name)`, `isKnown(name)`.
Synchronous; listener errors are caught and reported; listeners added during an emit do not fire for it.
Unknown/unprefixed names warn once in DEV. **Entities must use `L.on`.**

### 4.9 `AP.Save` (`js/core/storage.js`)
Keys `apeiron.save.v1` + `.bak`. Schema = CONTRACT §2.7. `data` · `load()` (never throws; main → .bak → defaults; repairs every field; backs up) ·
`save(force=false)` (throttled 1 s; flushed by `tick`) · `reset()` (progress only; keeps settings) · `resetSettings()` · `level(id)→record` (created on demand) ·
`setGem(id,n)` (persists immediately, returns true when new) · `stat(key,inc=1)→value` · `setting('assist.speed')` ·
`setSetting(path,value)` (emits `settings:changed {key,value}`) · `export()→string` · `import(str)→bool` · `available` ·
**(extra)** `flush()`, `tick(dt)`, `failed()`, `isDirty()`, `defaults()`, `repair(raw)`, `DEFAULT_BINDINGS`.
Unknown top-level keys, extra `stats` counters, extra boolean `flags` and extra scalar `settings` that other modules add are preserved.
Write failure → in-memory mode + toast "Saving unavailable".

### 4.10 `AP.Progress` (`js/game/progress.js`)
`order()→['w1-1',…,'w5-boss']` · `next(id)` · `isUnlocked(id)` (true for non-story ids; `unlockAll` in DEV) ·
`complete(id, run)→{firstClear,newBest,unlocked:[ids],formGained,ending}` (run = `{time,deaths,shards,shardsTotal,gems,assisted,grantForm,ending}`;
bosses raise `data.form` to the world reward; w5-boss sets `flags.endlessUnlocked`) · `percent()` · `worldState(n)` ·
**(extra)** `current()` (first unlocked, uncleared level: "Continue"), `parseId(id)`, `unlockAll` flag.
CORE's LevelScene calls `complete` itself (story mode only) — UI must **not** call it again for the same run.

### 4.11 `AP.Input` (`js/core/input.js`)
`init(win)` · `update(dt)` (loop calls it before the scene) · `held(a)` · `pressed(a)` (latched: a tap between steps gives exactly one pressed step) ·
`released(a)` · `buffered(a, window)` · `consume(a)` · `repeat(a)` (menus: press, then after 0.35 s every 0.08 s) · `axis(out)→{x,y}∈{−1,0,1}` (8-way, stick deadzone 0.35) ·
`anyPressed()` · `device` `'kbd'|'pad'` · `label(a, device?)` (`'Z'`, `'Space'`, `'←'`, `'A'`…) · `mouse {x,y (logical),down,pressed,released,moved}` ·
`bindings()` · `setBinding(a, device, slot, codeOrButton)` (null removes the slot) · `resetBindings()` · `capture(cb, device)` (Esc → `cb(null)`) ·
`setVirtual(a, held)` · `clearVirtual()` · `lock(sec)` · **(extra)** `holdTime(a)`, `stick(out)` (raw analog), `keyName(code)`, `padName(btn)`,
`capturing()`, `onKey(fn(code, ev)→true swallows)→off`, `rebuild()`, `releaseAll()`, `locked`, `anyKey`.
Key repeat is ignored, bound keys `preventDefault`, blur releases everything, first keydown/pointerdown calls `Audio.unlock`, pads use the standard mapping (all pads merged).
A tap = press and release between two steps (`setVirtual(a,true)` then `setVirtual(a,false)` before stepping): pressed **and** released in that step.

### 4.12 `AP.Beat` (`js/core/beat.js`) — the gameplay clock
`set(bpm, meter, poly?)` or `set({bpm,meter,poly})` (resets only if changed) · `reset()` · `update(dt)` · fields `bpm meter poly time beat (float) bar inBar phase (0..1) ticked barTicked` ·
`polyIndex(k)` · `polyTicked(k)` · `euclidTicked(k, n, rot=0)` (onset this step, n steps per bar) · `realBpm()` ·
**(extra)** `barPhase()`, `euclidStep(n)`, `euclidOn(k,n,rot)` (level, not edge), `euclidPattern(k,n,rot)→Uint8Array`, `toNextBeat()`, `secondsPerBeat()`.
Emits `beat {beat,bar,inBar}` and `bar {bar}` (payload objects are reused). LevelScene calls `AP.music(level.music)` then `AP.Beat.reset()` on enter.

### 4.13 `AP.Loop`, `AP.Time` (`js/core/loop.js`)
`AP.Time = {now (real s since boot), game (s simulated), step, frame, alpha, scale, dt}` ·
`AP.Loop.start() stop() step(n) renderOnce() fps` · **(extra)** `resync()` (drop accumulated time), `perf {fps, frameMs, updMs, renMs, steps}`, `running`.

### 4.14 `AP.R` (`js/engine/render.js`)
`init(stage)` · `W=960 H=540` · `scale` (CSS px per unit) · `dpr` · `px` (= backing px per unit) · `ctx` (2D of #game; a no-op ctx when no canvas) ·
`quality {particles:1|0.6|0.3, bg:'high'|'low'|'off', mid:bool}` (settings + auto-downgrade: particles → bg → midground after avg frame > 22 ms for 3 s) ·
`FONT_UI`, `FONT_MONO` · `font(size, weight='600', family)` · `text(ctx,str,x,y,{size=16,color,align,baseline,weight,alpha,mono,maxW (wraps),lineH,outline,outlineW,family})→lines` ·
`poly(ctx,cx,cy,r,sides,rot=0)` (path only; sides ≥ 32 → circle; vertex 0 at angle `rot`) · `star(ctx,cx,cy,rOut,rIn,points,rot=0)` (path only) ·
`glow(ctx,x,y,radius,color,alpha=1)→bool` (cached radial sprite, additive, restores state; frame cap `GLOW_CAP`=120, entities should stay ≤ 60) ·
`line(ctx,x1,y1,x2,y2,color,w=2,a=1)` · `additive(ctx, fn)` · `pal(styleKey)→{bg,primary,accent,hazard,ink}` · `drawBackground(key, p)` (GL → render2D → fallback) ·
`bgFallback(ctx,key,p)` · `drawTilesFallback(ctx,L,cam)` · `hudFallback(ctx,L)` · `flash(color,dur,alpha)` (respects settings.flash) · `toggleFullscreen()` ·
**(extra)** `begin(ctx)` (screen-space logical transform), `worldTransform(ctx, rx, ry)`, `snap(v)`, `measure(ctx,str,size,weight,mono)`, `wrap(ctx,str,maxW,size,weight,mono)→lines (cached)`,
`toLogical(clientX, clientY)`, `renderFlash(ctx)`, `fmtTime(s)→'m:ss.cc'`, `formSides(form)` (99→48), `flatRot(sides)` (rotation that puts a flat edge at the bottom), `bgParams(key)`, `bgMode`, `glowCount`, `downgradeLevel`, `updateQuality()`.

### 4.15 `AP.GL` (`js/engine/gl.js`)
`init(canvas)→bool` (webgl1, `{alpha:false, antialias:false, depth:false, powerPreference:'low-power'}`) · `gl` · `ok` · `compile(vs,fs)→program|null` (attribute `aPos` bound to location 0) ·
`drawFullscreen(program)` (clip-space TRIANGLE_STRIP quad) · `resize()` · `bgScale` (high 0.5 / low 0.25 of the game backing store) ·
**(extra)** `bgReady`, `lost`, `clear()`, `renderBackground(key,p)`, `log`. Context lost → 2D fallback; restored → `AP.Backgrounds.init(gl)` again.

### 4.16 `AP.Scenes` (`js/engine/scenes.js`)
`register(name, scene)` · `has(name)` · `go(name, params, {fx:'fade'|'iris'|'shatter'|'none', dur:0.5, color})` (replaces the stack; queued during a transition, last call wins; input locked while transitioning) ·
`push(name, params)` · `pop(result?)` (calls `uncovered(result, fromName)` on the scene below) · `top()` · `stack` · `current` ·
**(extra)** `goNow(name, params)` (no transition), `get(name)`, `list()`, `resolve(name)` (fallback table: `title, map, intro, ending, credits, results, theorems, cosmetics, endless` → `devmenu` when missing),
`isTransitioning()`, `cover()`, `crashed()`, `params()`, `topEntry()`, `overlay` (DEV fn drawn last).
Scene object: `{enter(params, from), exit(to), update(dt) (top only), render(ctx) (all non-hidden, bottom→top, screen space), bg: 'title' | fn()→{key,camX,camY,intensity,t}, transparent, covered(), uncovered(result, from)}`.
A scene that throws gets a crash overlay ("press confirm/retry to return to the map"). After the top scene renders the manager calls `AP.Meta.renderToasts(ctx)`; transitions use `AP.UI.drawTransition(ctx, kind, cover0to1, color)` when present.
The `#stage` element gets class `playing` while `level` is the current scene (hides the cursor).

### 4.17 `AP.Camera` (`js/engine/camera.js`) — `L.cam = new AP.Camera(L)`
`x,y` (view top-left) `w=960 h=540` · `follow(e)` · `snap()` · `setBounds(x,y,w,h)` (default whole level; centred when smaller than the view) ·
`lock(rect|null, {snap:false, owner})` · `shake(mag, dur)` (× settings.shake; the stronger shake wins) · `kick(dx, dy)` (decaying impulse) ·
`visible(x,y,w,h,pad=32)` · `toScreen(wx,wy,out)` · `toWorld(sx,sy,out)` · `cx()` · `cy()` · `renderX/renderY` (interpolated + shake + kick, device-pixel snapped) ·
**(extra)** `focus(x,y)` (look at a point until `follow`), `lockOwner`, `lockRect`, `lambdaX/lambdaY`, `prepareRender(alpha)`.
Look-ahead: `facing·56 + clamp(vx·0.12, ±110)` horizontally, +64 down when `vy > 500`; damping λx 7/s, λy 5/s.

### 4.18 `AP.FX` (`js/engine/particles.js`)
`emit(x,y,o)→count` with `o = {n=8, color, color2, speed:[60,180], angle:[0,TAU], life:[0.3,0.6], size:[2,4], sizeEnd=0, gravity=0, drag=0, shape:'dot'|'tri'|'sq'|'pent'|'hex'|'star'|'line'|'ring', spin:[-4,4], additive=true, back=false}`
plus **(extra)** `spread` (position jitter radius), `rot` (initial rotation, default random), `width` (line/ring stroke, 2), `align` (shape faces its velocity). Numbers or `[min,max]` ranges.
`sizeEnd: -1` keeps the start size. `burst(name,x,y,o?)` (`o.color, o.n, o.dir` radians, `o.form`, preset-specific keys) · `ring(x,y,r0,r1,life,color,width=2)` (not quality-scaled) ·
`preset(name, fnOrOpts)` (function `fn(x,y,o)→count`, or an emit-options object; `o.dir` then spreads ±`cone` (default 0.6 rad)) · `update(dt)` · `render(ctx, back)` · `clear()` · `count()` ·
**(extra)** `has(name)`, `list()`, `rampId`, `spawnRaw`, `SHAPES`. `n` is scaled by `quality.particles`; hard cap `PARTICLES_MAX` (oldest recycled). Colours ramp `color → color2` over life.
LevelScene updates FX in step 9 and renders `back` particles after the tiles and the rest after the entities.

### 4.19 `AP.Phys` (`js/engine/physics.js`) and the entity prototype — see §6
`proto` · `gravity(e, dt, mult=1, maxFall=MAX_FALL)→vy` · `approach(v,t,d)` · `rectSolid(L,x,y,w,h,ignore)` · `raycast(L,x0,y0,dx,dy,maxDist,out)→out{hit,x,y,dist,tx,ty,other}` ·
`walk(e, dt, speed, {turnAtLedge:true})→dir` (uses `e.s.dir` ±1, initialised from `spec.dir`) · **(extra)** `groundAhead(e, dir)`, `tileCode(L,tx,ty)`, `blocks(code)`, `oneWayBelow(e, dx)`, `lastHit` (reused).

### 4.20 `AP.Entities` (`js/engine/entities.js`)
`register(type, def)` (duplicate → warn, last wins; unknown def keys → warnOnce) · `get(type)` (normalised def) · `has(type)` · `list(prefix?)` · `proto` ·
**(extra)** `create(type, spec)` (unpositioned, uninitialised; unknown → `missing`), `sizeOf(type, spec)`, `anchorPoint(anchor,tx,ty,out)`, `fromAnchor(anchor,ax,ay,w,h,out)`, `anchorOf(e,out)`, `pathWorld(path, anchor)`, `ALLOWED_KEYS`, `FLAGS`, `Entity`.

### 4.21 `AP.Tilemap` (`js/engine/tilemap.js`) **(all extra)**
`code(L,tx,ty)` (OOB rules) · `isSolid(code)` (SOLID|BREAK) · `isSpike(code)` · `isStandable(code)` · `spikeRect(code,tx,ty,out)→[x,y,w,h]` (CONTRACT §3 hurtboxes) ·
`rectHitsSpike(L,x,y,w,h)→code|0` (+ `spikeHit {tx,ty,code}`) · `groups(tiles,w,h,code)` (4-connected) · `parse(map, legend)` · `create(w,h)` · `index(L,tx,ty)`.

### 4.22 `AP.Levels` (`js/engine/levels.js`)
`register(def)` · `get(id)` · `has(id)` · `list(world?)` (sorted: world, normal before boss, index, id) · **(extra)** `compile(def)` (§9), `withDefaults(def)`, `ids()`.

### 4.23 `AP.Player` (`js/game/player.js`) **(extra)**
`sides(form)` (99→48) · `apothem(form)` · `radius` (13) · `nearestFlat(rot, n)` · `startMorph(P, fromForm, toForm, dur)` · `lastForm`. The player itself: §7.

### 4.24 `AP.Common` (`js/game/common.js`) **(extra)**
`labelText(str)` (replaces `{jump}`-style tokens with `[key]` labels for the current device) · `collectShard(e, L)` · `activateVertex(e, L)` · `nodePos(e, t, out)`.

### 4.25 `AP.LevelScene`, `AP.Level`, `AP.Test`, `AP.DevMenu`
`AP.LevelScene` is the registered scene object (`.L` = current level, `.hitboxes` DEV flag). `AP.Level` is the level constructor (§8).
`AP.Test` §16. `AP.DevMenu` is the `devmenu` scene object.

---

## 5. Entities

### 5.1 Def schema (`AP.Entities.register(type, def)`)
| key | default | meaning |
|---|---|---|
| `kind` | `'sensor'` | `'sensor'` (no collision), `'actor'` (moves with collision, pushed/carried by solids), `'solid'` (blocks actors; may carry/push/crush) |
| `w`, `h` | 24, 24 | hitbox size in u |
| `size(spec)→[w,h]` | – | overrides w/h per instance (spec in **spec units**: convert tiles yourself) |
| `anchor` | `'floor'` | `'floor'` \| `'center'` \| `'ceiling'` \| `'tile'` (§2) |
| `layer` | 0 | render order (player = 10; higher draws later) |
| `behindTiles` | false | render before the tiles |
| `hazard` | false | contact kills the player (`cause` = the type) |
| `stompable` | false | landing on it from above → `onStomp` (or auto-defeat) and a bounce |
| `dashable` | false | dashing into it → `onDash` (or auto-defeat), once per dash |
| `burstable` | false | the double-jump pentagram (64u) → `onBurst` (or auto-defeat) |
| `oneWay` | false | solids only: one-way top (never pushes, carries riders) |
| `orbitNode` | false | the player can orbit it (`L.orbitNodes()`) |
| `boss` | false | the boss of a boss level (exactly one) |
| `carry` | true | solids only: `false` → `moveSolid` does not carry riders |
| `required` | `[]` | spec keys that must be present (lint E09) |
| `lint` | `'ignore'` | `'ignore'` \| `'solid'` \| `'stand'` \| `'hazard'` \| `'bounce'` \| `'orbit'` \| `'mover'` (reachability bot model) |
| `lintRects(spec, x, y)→[[x,y,w,h,kind]]` | – | overrides `lint`. CORE never calls it; only the TOOLS bot does. The CONTRACT does not fix the units, so follow `tools/lint-levels.js` (the examples here assume tile coordinates, with `x, y` = the spawn tile) |
| `renderPad` | 64 | culling margin (u) |
| `alwaysRender` | false | skip culling |
| `bossName`, `phases` | – | bosses only |
| hooks | – | `init update render onTouch onStomp onDash onBurst onPlayerDeath onRespawn onSquish onRemove debugDamage` |

Any other key warns once ("unknown def key") — keep tuning constants in module-level variables or in `e.s`.

### 5.2 Instance fields (reserved; custom state goes in `e.s`)
`id type def kind x y w h vx vy px py rx ry xRem yRem t spec tx ty homeX homeY layer active visible dead collidable touching minion broken parent s`
plus copies of the def flags you may toggle at runtime: `hazard stompable dashable burstable oneWay orbitNode boss`, and `tag` (= `spec.tag`), `dropT`, `wallRide`, engine-private `_order _dash _removed`.
- `t` seconds since spawn (advanced before each update). `tx, ty` spawn tile coords (fractional for `L.spawn`). `homeX/homeY` initial top-left (set before `init`; you may overwrite them in `init`).
- `active=false`: no update and no contacts (still rendered). `visible=false`: not rendered. `collidable=false`: solids stop blocking, and **no contacts or bursts for any kind**.
- `spec` is a fresh shallow copy per load (arrays inside are shared: do not mutate them).

### 5.3 Hook signatures and timing
| hook | when |
|---|---|
| `init(e, spec, L)` | once, after the position is final (anchor computed from `size(spec)` or w/h). `L.spawn` from `init` is fine. |
| `update(e, dt, L)` | every step while `e.active`, in spawn order, after the player |
| `render(e, ctx, L)` | each frame when visible/in view; world transform set; **draw at `e.rx/e.ry`**; the engine wraps it in `ctx.save()/restore()` |
| `onTouch(e, P, L, first)` | each step the live player overlaps (`first` on the first overlapping step) |
| `onStomp(e, P, L)→bool` | `stompable && P.vy > 0 && P.prevBottom ≤ e.py + STOMP_TOL`; `true` → engine bounce (vy −520, or −733 with jump held/buffered), air refresh, hitstop 0.04, sfx `stomp` |
| `onDash(e, P, L)→bool` | once per dash per entity while dashing and overlapping; `true` = handled (no kill), engine adds hitstop 0.04 + shake |
| `onBurst(e, P, L)` | double jump: burstable entities whose centre is within 64u of the player's centre |
| `onPlayerDeath(e, L)` | right after the player dies (clear projectiles, minions…) |
| `onRespawn(e, L)` | when the player respawns at the checkpoint (reset here). Player already placed. |
| `onSquish(e, L)` | a solid crushed this actor; default `L.remove(e)` |
| `onRemove(e, L)` | once, when the removal is processed (step 8) — remove your children here |
| `debugDamage(e, L)` | bosses: apply exactly one hit (§10) |

Every hook is guarded: an exception reports `"<type>.<hook>"` to `AP.errors`, sets `e.broken = true` and removes the entity (the player is never removed).

### 5.4 Spawning and removal
- From maps/`entities` arrays: anchored by def anchor (§2). Actors/solids get integer positions.
- `L.spawn(type, cx, cy, spec?)→e`: **centre** placement, `init` runs immediately, the entity joins the lists at the step-7 flush (so `L.find`/physics/contacts see it from then on; it renders this frame and updates next step).
- `L.remove(e)`: marks `dead` now (excluded from physics/contacts immediately); `onRemove` runs at step 8. Removing twice is harmless.
- Minions: set `e.minion = true` right after `L.spawn`; `L.clearMinions()` removes them all (with a small FX).
- Unknown types become `missing` (magenta "?") with a warning.

### 5.5 Contacts (step 5)
For each active, collidable entity overlapping the live player — sensors/actors: strict AABB overlap; **solids: touching counts** (edges touching, excluding pure corner contact) — the first rule that applies wins:
(a) `onDash` if dashing & `dashable` (once per dash) → `true` stops; (b) valid stomp → `onStomp` → `true` bounces and stops;
(c) `hazard` → `L.killPlayer(e.type)` (ignored while invulnerable, assist-invincible or god mode); (d) `onTouch(e, P, L, first)` if the player is still alive.

### 5.6 Default reactions (no hook defined)
`stompable` without `onStomp`, `dashable` without `onDash`, `burstable` without `onBurst` → `L.defeat(e)`: FX `hit` + `explode`, sfx `hit`, `L.remove(e)`, and the stomp/dash counts as handled.
Define the hook (return `false` to refuse) when you need lives, splitting (w4.sierp) or immunity windows.

---

## 6. Physics model (Celeste style)

Integer positions + remainders. All moves step 1u at a time against `SOLID`/`BREAK` tiles and **collidable, non-oneWay solids** (except self). Actors never collide with each other.

| method | behaviour |
|---|---|
| `e.cx() cy() right() bottom()` | box helpers |
| `e.overlaps(o)`, `e.overlapsRect(x,y,w,h)` | strict AABB |
| `e.collideAt(dx,dy)→bool` | box offset by (dx,dy) hits a blocking tile/solid; details in `AP.Phys.lastHit {other,tx,ty,code}` |
| `e.groundAt(dx=0)→bool` | solid or one-way top directly under the bottom edge |
| `e.moveX(amt, cb)→blocked`, `e.moveY(amt, cb)→blocked` | remainder accumulate → round → 1u steps; on block `rem=0` and `cb(hit, e)` with `hit={dir,sign,other,tx,ty,code}` (**reused object**) |
| `e.moveXExact(n, cb)`, `e.moveYExact(n, cb)` **(extra)** | integer moves without touching the remainder |
| one-way rule | a one-way (tile `=` top, or a oneWay solid) blocks only a 1u **downward** step when the bottom equals its top before the step and `e.dropT ≤ 0` |
| `e.isRiding(solid)` | bottom == solid.y with horizontal overlap (oneWay also needs `vy ≥ 0` and no drop-through); the player also rides a solid it is wall-sliding on (`wallRide`) |
| `e.squish()` | player: tries 4u nudges in each direction, else `L.killPlayer('crush')`; others: `onSquish` or removal |
| `e.moveSolid(dx, dy)` | solids: per axis, riders are collected first, the solid becomes non-collidable, moves, then overlapped actors are **pushed** (`squish` when blocked) and riders are **carried**; oneWay solids carry but never push. **(extra)** a rising oneWay solid also catches actors it overtakes from below their feet (no clipping through fast platforms) |
| `e.setPos(x,y)` | teleport: clears remainders and sets `px/py/rx/ry` (no interpolation smear) |

Move a solid to an exact target each step: `e.moveSolid(tx - (e.x + e.xRem), ty - (e.y + e.yRem))`.
Gravity for simple actors: `AP.Phys.gravity(e, dt)` then `e.moveY(e.vy*dt, function(h, a){ a.vy = 0; })`.

---

## 7. The player (type `player`, actor 22×22, floor anchor, layer 10)

**Fields:** `form`, `ab{wall,double,dash,orbit}`, `state` ∈ `'normal'|'dash'|'orbit'|'dead'|'respawn'|'frozen'`, `grounded`, `wall` (−1|0|1, touching wall while airborne), `facing`,
`vx, vy`, `prevBottom`, `hasDouble`, `hasDash`, `dashDir{x,y}`, `orbitNode`, `invuln`, `vis{rot,sx,sy,eyeX,eyeY}` (+ internal springs), `trail` (ring of 32 `{x,y,rot,form}` centres).
**(extra, read-only)** `dashId` (increments per dash), `dashT`, `sliding` (±1 while wall-sliding), `coyoteT`, `wallCoyoteT`, `orbitR/orbitTheta/orbitDir/orbitS`, `lastLandVy`, `landedOn` (entity or null), `trailHead`, `trailLen`, `flingT`, `refillT`.
Iterate the trail newest-first: `P.trail[(P.trailHead - i + 32) % 32]` for `i < P.trailLen`.

**Methods:** `setForm(f, {instant?, dur?})` (morphs over ~0.6 s) · `addForce(fx, fy)` (u/s², consumed next step; |vx| ≤ 600 while forces apply) ·
`launch(vx|null, vy|null, {refresh=true, noCut=true, lock=0})` (cancels dash/orbit, consumes a buffered jump; `lock` seconds of forced input in the launch direction) ·
`refresh(kind?)→bool` (`'double'|'dash'|both`; true when something was refilled — play `refill` yourself) · `freeze(on)` · `isDashing()` · `isOrbiting()` · `cx()` · `cy()` ·
**(extra, LevelScene uses them)** `die()`, `respawnAt(x,y)`, `respawnDone()`.

**Step order (CONTRACT §2.15):** timers/input → orbit (attach: r = clamp(dist,40,110), s = max(|v_tan|,420); per step: s→800 (+1200/s below, −300/s above), + 0.5·G·(tangent·down)·dt, cap 1000;
release on orbit up or jump: tangent or the held 8-way axis within ±45°, v = min(s·1.15, 1150), refresh, no cut) → dash (8-way, hitstop 0.03, 760 u/s for 0.14 s, ends at 300·sign) →
jump (drop-through / ground+coyote / wall within 4u or wall-coyote / double) → jump cut (×0.45 once when jump is not held) → horizontal accel → gravity (half when |vy| < 80 with jump held; cap 900, 1100 with Down; wall-slide ≤ 140) → move (ledge pop ≤ 8u when airborne & falling or dashing; ceiling corner correction ≤ 8u; dashes break `+`) → post-move (ground, walls, coyote, trail, visuals).
Measured on this engine: held jump apex 110u / travel 203u / airtime 0.675 s, tap (press+release between steps) 21u (holding jump for exactly one step gives 26u), jump+DJ 196u, wall-jump 95u, 3-wide shaft +91u/hop, dash 110u, bounce 221u, terminal 900/1100.
Orbit attach direction = sign of the tangential velocity, else `facing` (+1 = clockwise on screen). Because of the gravity term the release speed depends on where on the circle you let go:
1 s after attaching at rest 80u from a node it is 943 (left), 910 (right), 910 (below-left) or 1053 u/s (above) — identical to the TOOLS bot model (`tools/lib/sim.js orbitAttach`).

**Death/respawn:** `L.killPlayer(cause)` → edge-shatter FX, `DEATH_TIME` 0.5 s → respawn at the checkpoint (bottom-centre) with a 0.3 s reassemble (input frozen) → `RESPAWN_INVULN` 0.6 s flicker.

---

## 8. The level instance `L` (scene `level`, also `AP.level`)

**Fields (CONTRACT):** `id def mode world index form style pal seed rng w h pw ph tiles time player entities cam stats{deaths,shards,shardsTotal,gems[3],secrets} flags{} checkpoint{x,y,index} bossInfo intensity ended`.
**(extra):** `name`, `boss` (bool), `params` (scene params), `music`, `flow` (level-wide Flow params or null), `actors`, `solids`, `nodes` (read-only lists), `phase` (`'play'|'dead'|'respawn'`),
`playerMoved` + `firstMoveTime` (true after the first movement input — bosses start from this), `bossEnt`, `bossDone`, `vertexOn`, `gemOwned[3]` (owned before this run), `assistUsed`, `clearTime`, `result` (after completion), `hitstopT`, `stepN`, `master` (original tiles).

| method | notes |
|---|---|
| `spawn(type,cx,cy,spec?)→e` | centre placement (§5.4) |
| `remove(e)`, `find(type)→[]`, `first(type)`, `byTag(tag)→[]` | live entities only (pending spawns are not listed until the flush) |
| `query(x,y,w,h,filter?)→[]`, `queryInto(out,…)` | `filter` = function(e) or a type string |
| `orbitNodes()→[]` | live array — do not mutate |
| `burst(cx,cy,r)` | calls `onBurst` / auto-defeat on burstable entities |
| `killPlayer(cause)→bool` | false while invulnerable / assist-invincible / god, during death/respawn or after `ended`. `pit`, `crush`, `retry` always apply (no death counted when invincible) |
| `setCheckpoint(cx, by, index)` | bottom-centre respawn point; emits `checkpoint` when it changes |
| `retry()` (counts a death) · `restart()` (fresh load through an iris) · `skipLevel()` (assist only; bosses also grant their form) · `quit()` (`params.onQuit` or `go('map',{focus:id})`) | |
| `completeLevel({grantForm?, ending?})` | exit sequence (0.8 s; vertex 1.3 s; with a new form a ~4.6 s form-gain card, skippable after 1.6 s) → `AP.Progress.complete` (story) → `form:gain` → `level:complete` → `params.onComplete(result)` or `go('results', result)` or inline 2 s summary → next level / map. **(extra opts)** `x, y` focus point, `vertex`, `skipped` |
| `refreshAir()` · `shake(mag,dur)` · `kick(dx,dy)` · `hitstop(sec)` (max(current,new) ≤ 0.12) · `flash(color, dur=0.15, alpha=0.6)` | |
| `bossStart(e)` · `bossBar(frac, phase?)` · `bossDefeated(e)` · `clearMinions()` | §10 |
| `tileAt(tx,ty)` · `setTile(tx,ty,code)` · `breakTile(tx,ty,cause)→bool` · `tileFree(tx,ty)→bool` · `snapshotTiles()→Uint8Array` · `restoreTiles(snap)` · `solidAt(x,y,w,h,ignore?)` · `raycast(x0,y0,dx,dy,maxDist,out)` | `setTile` emits `tile:changed`, calls `TileArt.invalidate`, pushes the player up ≤ 32u out of a new solid or crushes it; `breakTile` only breaks `+` (FX `break`, sfx, shake); `tileFree` = in bounds and ≥ 4u away from the player box |
| `on(name, fn)→off` · `emit(name, payload)` | level-scoped listeners |
| **(extra)** `pause()`, `defeat(e)`, `activateVertex()`, `freeSpot(cx,cy,w,h)→{x,y}` (reused), `count(type)`, `findBoss()`, `hook(e, name, a, b, c)`, `createAt(type, tx, ty, spec)`, `unstick(x,y,w,h)` | |

**Result object:** `{id, world, index, name, mode, time, deaths, shards, shardsTotal, gems:[b,b,b], newBest, firstClear, assisted, formGained (0|form), next (id|null), ending}` + **(extra)** `unlocked:[ids]`.
Progress is recorded only in `mode:'story'` for registered levels; `test` and `endless` runs never touch `AP.Save.levels` (endless saves its own data). Gems persist immediately in story mode only.

**Assist** (`AP.Save.data.settings.assist`): `speed` → `AP.Time.scale`; `invincible` → only pits/crush respawn, no deaths counted; `infiniteAir` → double jump and dash refill every airborne step (dash cooldown still applies). Any effective option sets `result.assisted`.

**Pause:** pressing `pause` pushes the UI scene `pause` with `{L}` (or shows CORE's minimal inline pause). `retry` (R) retries. On tab hide / window blur (outside DEV) a running level pauses itself.

---

## 9. Levels

```js
AP.Levels.register({
  id: 'w2-3', world: 2, index: 3, boss: false, name: 'Facet Garden', form: 4,
  style: 'w2', music: 'w2', par: 75,
  map: ['#####', '#P..#', /* … */],
  legend: { m: 'w2.mite', t: { type: 'w2.turret', dir: 'left', rate: 0.8 } },
  entities: [ { type: 'mover', x: 12, y: 9, w: 3, path: [[12, 9], [18, 9]], speed: 3 } ],
  signs: ['Hold {jump} to jump higher.'],
  flow: { seed: 3, scale: 10, angle: 0, spread: 60 },
  camera: { bounds: [0, 0, 120, 20] },
  lint: { stand: [], open: [], edges: [], openTop: false, skip: false, note: '' },
  meta: {}
});
```
- Register at load time (top level of your IIFE). Maps may be built by pure deterministic code (use `AP.RNG`, never `Math.random`).
- **Defaults** (`AP.Levels.withDefaults`): `form` = world form (99 for world 0), `style`/`music` = world style/music, bosses `bossStyle`/`bossMusic`; world 0 → `'title'`/`'map'`.
- **Compile** (`AP.Levels.compile(def)`, cached per registered id): map chars → tiles (`AP.TILE_CHARS`); entity chars (`AP.ENTITY_CHARS`) and legend keys → spawns with `spec = {…legend params, x, y, ch}`;
  gems get `spec.n` (1..3); the k-th `S` gets `spec.k` and `spec.text = signs[k]`; `entities` array → spawns with `spec` = every key except `type` (x/y are tile coords, fractional allowed);
  every 4-connected group of `%` → one `secretwall` (spec `{x,y,w,h, cells:[[tx,ty]…]}`).
- **Instance creation order** = map scan order (row by row, left to right), then the `entities` array, then secret walls. That is also the update order.
- Legend values: a type string or `{type, …params}` shared by every instance of the char.
- `camera.bounds` in tiles; default the whole level.
- `L.flow` = `AP.Flow.fromSpec(def.flow)` when `flow` is given (W3 wind should default to it).

---

## 10. Bosses (CONTRACT §2.17)

Your boss def: `boss: true, bossName, phases ≥ 2`, hooks `init update render onRespawn debugDamage` (plus whatever damage hooks you use).

| you call | CORE does |
|---|---|
| `L.bossStart(e)` (within 4 s of `L.playerMoved` becoming true) | shows the bar (`L.bossInfo = {name, frac:1, phase:0, phases, entity}`), music `bossN`, sfx `bossRoar`, shake, emits `boss:start {id,type,name}`, starts the 180 s watchdog. Idempotent. |
| `L.bossBar(frac, phase?)` whenever HP or phase changes | on a frac decrease: emits `boss:hit {id,frac}`, FX `bossHit`, sfx `bossHit`, hitstop 0.06, shake, accent flash, resets the watchdog. On a phase change: emits `boss:phase {id,phase}`, sfx `bossPhase`, shake, flash. Phases are your numbers (0-based recommended). |
| `L.bossDefeated(e)` exactly once | emits `boss:defeat {id,time}`, FX/sfx `bossDeath`, max hitstop, big shake + flash, `clearMinions()`, fades the music, and after 1.2 s activates the level's `V` (or spawns one at a free spot near the level centre). Touching it → `completeLevel({grantForm: world.reward, ending: world.n === 5})`. The bar hides ~2 s later. |
| `L.clearMinions()` | removes every `e.minion` entity |
| `L.snapshotTiles()` / `L.restoreTiles(snap)` | restore diff-invalidates TileArt, emits `tile:changed {tx:-1,ty:-1,old:-1,code:-1}` and un-sticks/crushes the player |

Your responsibilities: damage window at least every 10 s; telegraphs ≥ 0.4 s in accent; only the level's form; never place solids on the player (`L.tileFree`);
`onPlayerDeath` → clear projectiles/minions; `onRespawn` → back to the **start of the current phase** with that phase's HP (+ `restoreTiles(phaseSnapshot)`);
`debugDamage(e, L)` → exactly one hit in any state after `bossStart` (force vulnerability), advancing phases; defeat within 100 calls.
`AP.Test.defeatBoss()` (god mode on) walks the player until `bossStart`, forces it after 6 s, then alternates `debugDamage` with 8 steps until `bossDone`, then waits for the vertex.
Watchdog: 180 s without `boss:hit` → toast "Assist mode can skip this fight". Skipping a boss with assist grants its form.

---

## 11. Events

| event | payload | emitted by |
|---|---|---|
| `level:start` | `{id, world, form, mode}` | LevelScene enter |
| `level:complete` | result object (§8) | after the exit sequence |
| `level:quit` | `{id}` | `L.quit()` |
| `player:jump` | `{kind}`, kind = `'ground'` \| `'coyote'` \| `'wall'` \| `'double'` | player |
| `player:land` | `{vy}` (impact speed ≥ 0) | player |
| `player:dash` | `{dx, dy}` (unit) | player |
| `player:orbit` / `player:fling` | `{node}` / `{speed, angle}` | player |
| `player:death` / `player:respawn` | `{cause, x, y}` / `{x, y}` (centre) | LevelScene |
| `checkpoint` | `{index, x, y}` (index −1 = level start) | `L.setCheckpoint` |
| `collect:shard` / `collect:gem` | `{count, total}` / `{n, id}` | shard / gem |
| `secret:found` | `{x, y}` | secretwall |
| `tile:changed` | `{tx, ty, old, code}` (**reused object**; tx=ty=−1 = full restore) | `L.setTile` / `restoreTiles` |
| `boss:start` / `boss:phase` / `boss:hit` / `boss:defeat` | `{id,type,name}` / `{id,phase}` / `{id,frac}` / `{id,time}` | `L.boss*` |
| `form:gain` | `{form}` | after `Progress.complete` grants a form |
| `beat` / `bar` | `{beat, bar, inBar}` / `{bar}` (**reused objects**) | AP.Beat |
| `settings:changed` | `{key, value}` (`key '*'` after reset/import) | AP.Save |
| `scene:change` | `{from, to}` | AP.Scenes |
| `ui:test-trigger` | `{tag}` | the `trigger` entity in `test-core` |

The `trigger` entity emits its own `spec.event` with `{tag}`.

---

## 12. FX presets (CORE)

All take `(x, y, o)`; `o.color` overrides the main colour, `o.n` the count, `o.dir` (radians) aims directional presets.

| preset | look / extra options |
|---|---|
| `dust` | soft puffs (`dir` cone) |
| `land` | side puffs + ring; `power` 0.2–1.5 |
| `jump` | upward puffs + small ring |
| `walljump` | streaks away from the wall; `dir` = wall side (+1 right) |
| `dash` | ring + backward streaks + hexagons; `dir` = dash angle |
| `dashTrail` | 2 hexagon motes (called every 1/60 s while dashing) |
| `burst` | pentagram: two rings (radius `o.radius`, default 64) + 5 rays + pentagons |
| `death` | edge shatter: each edge of the polygon flies off; `form`, `rot`, `r` |
| `respawn` | rings + motes |
| `shard`, `gem` | pickup sparkle (gem: rings + stars) |
| `checkpoint` | big ring + rising motes + vertical streaks |
| `break`, `crumble` | squares with gravity (+ accent triangles for break) |
| `bounce` | ring + streaks; `dir` |
| `spark` | 2 short streaks (wall-slide sparks); `dir` |
| `explode` | hazard triangles, rings |
| `portal` | inward-spiralling points; `radius` (46) |
| `orbit`, `fling` | attach ring / release streaks (`dir`) |
| `secret` | rings + stars + motes |
| `hit` | small star flash + streaks |
| `bossHit`, `bossDeath`, `vertex` | big multi-layer bursts |

World presets must be named `wN.*` (`AP.FX.preset('w2.shatter', {n: 12, shape: 'tri', …})` or a function).

---

## 13. Sounds CORE plays for you (do not duplicate)

player: `jump` (pitch rises with the form), `jump2` + `burst`, `walljump`, `land` (scaled), `step`, `dash`, `orbit`, `fling`, `death`, `respawn`, `stomp`;
common types: `shard` (pentatonic chain within 0.6 s), `gem`, `checkpoint`, `secret`, `bounce`, `crumble`, `break`, `portal`, `complete`, `vertex`, `chime` (vertex appears), `whoosh` (trigger mover), `grow` (form morph);
LevelScene: `hit` (auto-defeat), `bossRoar` (bossStart), `bossHit`, `bossPhase`, `bossDeath`, `toast` (inline results), menu sounds in the inline pause and devmenu (`uiMove uiSelect uiBack uiDeny pause unpause`).
`refill` is **not** played by `P.refresh()` — play it in the entity that refills (e.g. `w4.fruit`).

---

## 14. Rendering

**LevelScene render order (CONTRACT §2.8):** 1 `AP.R.drawBackground(L.style, p)` (p = `{t:L.time, camX, camY, w, h, intensity, beat, phase, pal, seed, quality}`) →
2 `AP.Midground.render(ctx, L.style, {t, camX, camY, L, pal, quality, intensity, beat})` in screen space (skipped when `quality.mid` is false) →
3 world transform → 4 `behindTiles` entities → 5 `AP.TileArt.draw(ctx, L, cam)` or `AP.R.drawTilesFallback` → back particles → 6 other entities sorted by `layer` (stable) →
7 `AP.FX.render(ctx,false)` → 8 screen space: `AP.HUD.render(ctx, L)` (or `R.hudFallback`), CORE overlays (form card, inline pause/results), flash, DEV hitboxes.
`AP.TileArt.build(L)` runs on level enter, `dispose(L)` on exit, `invalidate(L,tx,ty)` on every tile change. A throwing TileArt/HUD/Midground falls back for the rest of that level.

**ctx conventions:** the world transform maps world u → device pixels (`R.worldTransform`); `R.begin(ctx)` is the screen-space transform (960×540 logical).
Your `render` hook is wrapped in `save()/restore()`; set every style you use. Use `AP.Color.rgba` (cached) instead of building strings per frame.
Glow only via `AP.R.glow` (≤ 48u radius, ≤ 60 per frame from entities). No `shadowBlur`, no `ctx.filter`.

**Palettes:** `L.pal = AP.R.pal(L.style)` → `{bg, primary (terrain), accent (collectibles/interactables), hazard (kills; spiky silhouettes), ink (player/text)}`.

**Budgets:** update ≤ 3 ms/frame, 2D render ≤ 6 ms, ≤ 600 entities, particles ≤ 1800 (scaled). No allocations inside per-step loops (reuse `out` objects; module-level scratch objects).
Culling: entities render only when `cam.visible(x, y, w, h, def.renderPad)` (or `alwaysRender`); updates are never culled.

---

## 15. UI integration points

- **Scenes UI provides:** `title`, `intro{next?}`, `map{focus?, celebrate?}`, `results(result)`, `ending`, `credits`, `theorems`, `cosmetics`, overlays `pause{L}`, `settings{from?}`, `remap` (`transparent: true`).
  Missing ones fall back to `devmenu` (CORE's playable menu). LevelScene calls `go('results', result, {fx:'iris'})`; the results scene decides Continue (`result.next`, `result.ending` → `ending`), Retry (`go('level', {id})`), Map.
- **Pause menu** gets `{L}`: use `L.retry()`, `L.restart()`, `L.skipLevel()`, `L.quit()`, and `AP.Scenes.pop()` to resume.
- **HUD:** `AP.HUD.render(ctx, L)` each frame in screen space; `AP.HUD.onLevelStart(L)` on enter; `AP.HUD.onLevelEnd(L)` when the exit sequence starts (or on exit).
  Useful fields: `L.stats`, `L.gemOwned`, `L.bossInfo`, `L.time`, `L.clearTime`, `L.ended`, `L.phase`, `L.form`, `L.pal`, `L.name`, `L.world`, `L.index`, `L.def.par`.
- **Toasts:** `AP.Meta.toast(title, sub)` (CORE calls it through `AP.toast`) and `AP.Meta.renderToasts(ctx)` (drawn by the scene manager after the top scene).
- **Transitions:** `AP.UI.drawTransition(ctx, kind, cover0to1, color)` (kinds `fade|iris|shatter`; CORE has fallbacks for all three).
- **Optional CORE hook (extra):** if `AP.UI.strokeText(ctx, str, x, y, {size, color, align, glow, progress})` exists, the form-gain card draws its title with it ("FOUR — SQUARE", "∞ — CIRCLE"…).
- **Cosmetics:** `AP.Cosmetics.playerStyle(form)→{fill,stroke,glow,eye}|null` and `AP.Cosmetics.drawTrail(ctx, P)→bool` (world space; return true to replace the default trail).
- **Labels:** `AP.Input.label(action)` / `AP.Common.labelText('Press {jump}')`.

---

## 16. Test hooks, DEV keys, hash routes

`window.AP_NO_AUTOBOOT = true` → the harness calls `AP.boot({headless:true})` (no rAF loop, no DOM listeners).
`AP.Loop.step(n)`, `AP.Loop.renderOnce()`, `AP.Input.setVirtual/clearVirtual`.
`AP.Test.startLevel(idOrObj, {form?, mode:'test', onComplete?, onQuit?})→L` (synchronous `goNow`) · `god(on?)→bool` · `teleport(cx, by)` (bottom-centre; revives a dead player) · `defeatBoss()→bool` ·
**(extra)** `kill(cause)`, `complete(opts)`, `player()`, `godMode`.

**Hash routes:** `#dev`, `#level=<id>` (story mode; test mode with `#form=<n>` or for `test-*`), `#scene=<name>`, `#form=<n>`, `#seed=<n>` (→ `endless{seed}` when registered), `#unlockall` (DEV only). Combine with `&`: `#dev&level=w1-2&form=6`.

**DEV keys (with `#dev`):** F1 hitboxes (+ player state line) · F2 perf overlay · F3 god mode · F4 complete level · F6 boss `debugDamage` (starts the fight if needed) · F9 devmenu ·
**(extra)** F7 cycle the player's form · F8 kill the player.

**CORE test levels:** `test-core` (every tile and common type, form 99, style w1) and `test-forms` (one room per form, form 99, style w2).

---

## 17. Worked examples

### 17.1 Simple enemy (actor, stompable, beat-synced hop)
```js
/* js/worlds/w1/entities.js — owner: W1 */
(function (AP) {
  'use strict';
  var C = AP.C;
  function land(h, e) { if (h.sign > 0) { e.vy = 0; e.s.grounded = true; } else e.vy = 0; }

  AP.Entities.register('w1.bouncer', {
    kind: 'actor', w: 22, h: 22, anchor: 'floor', layer: 5, lint: 'ignore',
    hazard: true, stompable: true, dashable: true, burstable: true,
    init: function (e, spec, L) {
      e.s.height = (spec.height || 3) * 32;
      e.s.grounded = false;
      e.s.squash = 0;
    },
    update: function (e, dt, L) {
      // hop on every beat; the accent beat (beat 1 of 3) hops higher
      if (e.s.grounded && AP.Beat.ticked) {
        var h = AP.Beat.inBar === 0 ? e.s.height : e.s.height * 0.6;
        e.vy = -Math.sqrt(2 * C.GRAVITY * h);
        e.s.grounded = false;
        e.s.squash = 1;
      }
      AP.Phys.gravity(e, dt);
      e.moveY(e.vy * dt, land);
      e.s.squash = Math.max(0, e.s.squash - dt * 4);
    },
    // returning true makes the engine bounce the player; no hook = auto-defeat
    onStomp: function (e, P, L) {
      AP.FX.burst('explode', e.cx(), e.cy(), { n: 12 });
      L.remove(e);
      return true;
    },
    onRespawn: function (e, L) { e.setPos(e.homeX, e.homeY); e.vx = 0; e.vy = 0; e.s.grounded = false; },
    render: function (e, ctx, L) {
      var p = L.pal, cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      var sq = 1 + 0.25 * e.s.squash;
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2.5;
      AP.R.poly(ctx, cx, cy, 11 * sq, 48, 0);             // circle
      ctx.stroke();
      AP.R.poly(ctx, cx, cy + 1, 6, 3, -Math.PI / 2);      // inner triangle
      ctx.fillStyle = AP.Color.rgba(p.hazard, 0.5);
      ctx.fill();
    }
  });
})(window.AP = window.AP || {});
```

### 17.2 Moving solid (one-way platform tethered to home, carried by the flow)
> Illustration only. The shipped `w3.drift` (`js/worlds/w3/entities.js`) is advected by the flow velocity, takes its spring
> period from `springPeriod` (`period` is the gust/reverse cycle there), and keeps the required spec keys `w` and `leash`.
```js
AP.Entities.register('w3.drift', {
  kind: 'solid', oneWay: true, anchor: 'tile', layer: 2, lint: 'stand',
  size: function (spec) { return [(spec.w || 3) * 32, 12]; },
  init: function (e, spec, L) {
    e.s.leash = (spec.leash || 3) * 32;
    e.s.vx = 0; e.s.vy = 0;
    e.s.flow = spec.flow ? AP.Flow.fromSpec(spec.flow) : (L.flow || AP.Flow.DEFAULT);
    e.s.f = { x: 0, y: 0 };
  },
  update: function (e, dt, L) {
    var s = e.s;
    AP.Flow.force(e.x + e.w / 2, e.y, L.time, s.flow, 120, s.f);     // same field the art draws
    s.vx += (s.f.x + (e.homeX - e.x) * 6 - s.vx * 2.5) * dt;          // spring tether + damping
    s.vy += (s.f.y + (e.homeY - e.y) * 6 - s.vy * 2.5) * dt;
    var d = Math.hypot(e.x - e.homeX, e.y - e.homeY);
    if (d > s.leash) { s.vx *= 0.5; s.vy *= 0.5; }
    e.moveSolid(s.vx * dt, s.vy * dt);   // carries riders; one-way solids never push
    e.vx = s.vx; e.vy = s.vy;
  },
  onRespawn: function (e) { e.setPos(e.homeX, e.homeY); e.s.vx = 0; e.s.vy = 0; },
  render: function (e, ctx, L) {
    ctx.fillStyle = AP.Color.rgba(L.pal.primary, 0.3);
    ctx.fillRect(e.rx, e.ry, e.w, e.h);
    ctx.strokeStyle = L.pal.primary;
    ctx.lineWidth = 2;
    ctx.strokeRect(e.rx + 1, e.ry + 1, e.w - 2, e.h - 2);
  }
});
```
Lint note: dynamic platforms need `lint.stand` / `lint.edges` annotations with a `note` in the level (CONTRACT §4.5 rule 11).

### 17.3 Composite entity (controller + one-way children, with lint rects)
```js
AP.Entities.register('w5.wave.seg', {
  kind: 'solid', oneWay: true, anchor: 'center', layer: 2, lint: 'ignore',
  size: function (spec) { return [(spec.w || 1) * 32, 12]; },
  render: function (e, ctx, L) {
    ctx.strokeStyle = L.pal.primary; ctx.lineWidth = 2;
    ctx.strokeRect(e.rx + 1, e.ry + 1, e.w - 2, e.h - 2);
  }
});

AP.Entities.register('w5.wave', {
  kind: 'sensor', anchor: 'tile', layer: 0, lint: 'stand',
  // rest positions for the reachability bot: [x, y, w, h, kind] (tile units assumed; check tools/lint-levels.js)
  lintRects: function (spec, x, y) {
    var out = [], n = spec.n || 6, w = spec.w || 1;
    for (var i = 0; i < n; i++) out.push([x + i * w, y, w, 0.375, 'stand']);
    return out;
  },
  init: function (e, spec, L) {
    var n = spec.n || 6, w = spec.w || 1;
    e.s.kids = [];
    e.s.amp = (spec.amp || 1.5) * 32;
    e.s.k = (Math.PI * 2) / ((spec.wavelength || 6) * 32);
    e.s.omega = (Math.PI * 2) / (spec.period || 2);
    for (var i = 0; i < n; i++) {
      var cx = e.x + (i + 0.5) * w * 32, cy = e.y + 6;
      var c = L.spawn('w5.wave.seg', cx, cy, { w: w });   // joins the level at the next flush
      c.parent = e;
      c.s.bx = c.x; c.s.by = c.y;                          // rest position
      e.s.kids.push(c);
    }
  },
  update: function (e, dt, L) {
    var s = e.s;
    for (var i = 0; i < s.kids.length; i++) {
      var c = s.kids[i];
      if (c.dead) continue;
      var ty = c.s.by + Math.sin(c.s.bx * s.k - L.time * s.omega) * s.amp;
      c.moveSolid(0, ty - (c.y + c.yRem));                 // exact target, riders carried
    }
  },
  onRemove: function (e, L) {
    for (var i = 0; i < e.s.kids.length; i++) L.remove(e.s.kids[i]);
  }
});
```
The controller is spawned before its children, so it updates first each step; the children have no `update` of their own.

### 17.4 Boss (phases, debugDamage, onRespawn, tile snapshot restore)
```js
/* js/worlds/w1/boss.js — owner: W1 */
(function (AP) {
  'use strict';
  var HP = [2, 2, 2];                                   // hits per phase (total 6)

  function vulnerable(e, L, sec) { e.s.vuln = sec; e.s.state = 'stunned'; e.s.t = 0; }
  function hit(e, L) {
    var s = e.s;
    if (L.bossDone) return;
    s.hp--;
    s.vuln = 0;
    if (s.hp <= 0 && s.phase < HP.length - 1) {          // next phase
      s.phase++;
      s.hp = HP[s.phase];
      s.snap = L.snapshotTiles();                         // the arena as this phase starts
      s.state = 'intro'; s.t = 0;
    } else if (s.hp <= 0) {
      s.state = 'dead';
      L.bossDefeated(e);
    } else {
      s.state = 'recover'; s.t = 0;
    }
    L.bossBar(totalLeft(s) / 6, s.phase);
  }
  function totalLeft(s) { var n = s.hp; for (var i = s.phase + 1; i < HP.length; i++) n += HP[i]; return Math.max(0, n); }

  AP.Entities.register('w1.tessellator', {
    kind: 'sensor', w: 96, h: 96, anchor: 'floor', layer: 6, boss: true,
    bossName: 'The Tessellator', phases: 3, lint: 'ignore', renderPad: 200,
    init: function (e, spec, L) {
      e.s.phase = 0; e.s.hp = HP[0]; e.s.state = 'wait'; e.s.t = 0; e.s.vuln = 0;
      e.s.snap = L.snapshotTiles();
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.t += dt;
      if (s.state === 'wait') {
        if (L.playerMoved) { L.bossStart(e); s.state = 'attack'; s.t = 0; }
        return;
      }
      if (s.state === 'attack' && s.t > 2.5) {
        // …telegraph ≥ 0.6 s, slam, spawn minions with m.minion = true…
        vulnerable(e, L, 1.8);                            // a damage window at least every 10 s
      }
      if (s.state === 'stunned') {
        s.vuln -= dt;
        if (s.vuln <= 0) { s.state = 'attack'; s.t = 0; }
      }
      if ((s.state === 'recover' || s.state === 'intro') && s.t > 1.2) { s.state = 'attack'; s.t = 0; }
    },
    onStomp: function (e, P, L) {
      if (e.s.state !== 'stunned') return false;          // refuse: no bounce, contact continues
      hit(e, L);
      return true;                                        // engine bounces the player
    },
    onPlayerDeath: function (e, L) { L.clearMinions(); },
    onRespawn: function (e, L) {
      var s = e.s;
      if (s.state === 'dead') return;
      s.hp = HP[s.phase];                                 // the current phase restarts with full phase HP
      s.state = 'intro'; s.t = 0; s.vuln = 0;
      L.restoreTiles(s.snap);                             // undo floor flips of this phase
      e.setPos(e.homeX, e.homeY);
      L.bossBar(totalLeft(s) / 6, s.phase);
    },
    debugDamage: function (e, L) {                        // exactly one hit, in any state after bossStart
      if (e.s.state === 'dead') return;
      if (e.s.state !== 'stunned') vulnerable(e, L, 1.8);
      hit(e, L);
    },
    render: function (e, ctx, L) { /* Truchet golem at e.rx, e.ry; accent core while stunned */ }
  });
})(window.AP = window.AP || {});
```
Boss level: id `w1-boss`, `boss: true`, one `V` in the map (dormant until 1.2 s after `bossDefeated`), no gems, no `E`.

---

## 18. Gotchas

1. **Reused objects:** `AP.Phys.lastHit`, move-callback `hit`, `tile:changed`, `beat`/`bar` payloads, `L.freeSpot()` result, `AP.Path`/`AP.Flow` `out` objects you pass. Copy fields you keep.
2. **Never cache absence:** call optional modules with `AP.call('HUD.render', …)` or check `if (AP.X && AP.X.fn)` at call time.
3. **Spawned entities are pending until step 7:** `L.find` will not list them yet; keep the reference `L.spawn` returns.
4. **Pass `dt` along**; never read real time. Paths and flows: use `L.time` so they stay deterministic and pause-safe.
5. **Solids move with `moveSolid` only** (never assign `x/y` on a solid that carries the player, except `setPos` when nobody rides it).
6. **Sensors may move freely** (`e.x += …`); actors use `moveX/moveY` (integer positions).
7. **`collidable = false` makes an entity intangible** to contacts and bursts (any kind), not only to physics.
8. `onStomp` returning `false` means "not stomped": the contact continues to the hazard and `onTouch` rules.
9. **Facing/abilities:** the player's abilities come from `L.form` (the level's form), not from the save.
10. **Story vs test:** gems/progress persist only in `mode:'story'`. Devmenu form overrides launch in `test` mode.
11. **Signs:** `{action}` tokens are replaced with `[label]`; keep sign text ≤ 120 chars.
12. **Hitstop** freezes `L.time`, entity updates, FX and the camera, but not `AP.Beat` — beat-synced hazards should read `AP.Beat` edges (`ticked`, `euclidTicked`) only from `update`.
13. **Interpolation:** draw at `rx/ry`; after teleporting use `setPos` so the frame does not smear.
14. **Events:** custom names must be prefixed (`w3:gust`); entities subscribe with `L.on`.
15. **Text in levels:** world-space labels use the `text` type (`{type:'text', x, y, text, size, role}`).
