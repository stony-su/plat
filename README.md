# APEIRON

*A game of geometry.*

You are a Triangle: three edges and a stubborn spark. Each boss you defeat gives you a vertex, and each vertex is a
new ability. You grow from Triangle to Square, Pentagon, Hexagon and finally the Circle, a polygon with infinitely many
sides. *Apeiron* is Greek for *the boundless*.

Every world is one algorithmic-art technique, and that same technique drives both the visuals and the gameplay:
Truchet tilings, Voronoi diagrams, flow fields, L-systems and fractals, and harmonic motion. Nothing in the game is a
bitmap or a recording. Every shape is drawn by code, the backgrounds are WebGL shaders, and every note and sound effect
is synthesized at runtime.

## Running it

- **Double-click `index.html`.** It runs straight from the file system in any current desktop browser (Chrome, Edge,
  Firefox or Safari). It needs no server, network, install or build step.
- **Or open `dist/apeiron.html`.** It is the whole game in one self-contained file (about 1.7 MB) that you can copy
  anywhere. Rebuild it with `node tools/build-dist.js`.

Press any key or click on the title screen to begin. That first input also starts the audio, because browsers block
sound until you interact with the page. Progress saves automatically to `localStorage`. If the browser blocks storage
for `file://` pages, the game still plays and keeps your progress in memory for that session. Settings → Data can
export your save to a file and import it again.

## Controls

Every action can be remapped in Settings → Controls, separately for keyboard and gamepad.

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Move / aim | Arrow keys or WASD | D-pad or left stick |
| Jump (hold to jump higher) | Space, Z or J | A |
| Dash (Hexagon and Circle) | X, K or Left Shift | X, B or RB |
| Orbit (hold, Circle) | C, L or Right Shift | RT, LT, Y or LB |
| Pause | Esc or P | Start |
| Retry from checkpoint | R | Back / Select |
| Menu confirm / back | Enter, Space or Z / Esc, Backspace or X | A / B |

Other moves:
- Hold Down and press Jump to drop through a one-way platform.
- Land on an enemy to stomp it, and hold Jump as you land to bounce higher.
- Hold Down while falling to fall faster.
- On the world map, Left and Right pick a level, Up and Down change world, and holding Orbit zooms out to show the
  whole spiral.

## Forms and worlds

| World | Style | Your form | Ability | Levels | Boss | Boss reward |
|---|---|---|---|---|---|---|
| W1 The Lattice | Truchet tiles | Triangle | run and variable-height jump | 3 | The Tessellator | Square |
| W2 Voronoi Caverns | Voronoi crystal | Square | + wall-slide and wall-jump | 4 | Crystal Monarch | Pentagon |
| W3 The Currents | flow fields | Pentagon | + double jump; its pentagram burst damages enemies | 5 | Maelstrom | Hexagon |
| W4 Fractal Gardens | L-systems and fractals | Hexagon | + 8-way dash that breaks cracked blocks | 6 | The Recursion | Circle |
| W5 Harmonic Spire | harmonic motion | Circle | + orbit a node and fling yourself off it | 6 | The Null | the ending |

- **Levels.** There are 24 levels and 5 bosses. A level unlocks when you clear the one before it, and a world's boss
  unlocks once every level in that world is cleared.
- **Collectibles.** Each level holds gold shards that trace its route and three prime gems:
  - gem 1 is a visible detour;
  - gem 2 is behind a secret fake wall, hinted by a shard line or sign;
  - gem 3 sits on a mastery route.
- **Theorems.** 33 achievements, a few of them hidden.
- **Cosmetics.**
  - Trails unlock with your total gem count: Spirograph, Fibonacci, Sierpinski Dust, Lissajous Ribbon, Prism and
    Apeiron.
  - Player palettes unlock with theorems: Euler, Pythagorean, Platonic, Fractal, Prime and Null.
- **Assist mode.** Open it from the Pause menu → Assist. It offers game speed (100/85/70/50%), invincibility, infinite
  air and level skip. A skipped boss still grants its form.
- **Endless mode, "Apeiron".** It unlocks after the ending and is reached from the title screen.
  - Each run is an endless chain of generated segments: hand-made chunk templates stitched together by a seeded
    generator.
  - You play every segment as the Circle, and the style and music cycle through all five worlds.
  - You start with 3 lives and earn an extra one every third segment.
  - Choose the Daily run (the same seed for everyone that day) or type in your own 8-digit seed.

## Developer routes and keys

Add these to the URL after `index.html`, for example `index.html#dev&level=w3-2&form=6`. Join several with `&`.

| Route | Effect |
|---|---|
| `#dev` | Turns on developer mode: the DEV keys below and DEV-only routes. Any hash that contains `dev` counts. |
| `#level=<id>` | Starts a level directly, e.g. `#level=w2-3`. Ids are `w1-1`…`w1-3`, `w2-1`…`w2-4`, `w3-1`…`w3-5`, `w4-1`…`w4-6`, `w5-1`…`w5-6`, `w1-boss`…`w5-boss`, `test-core` and `test-forms`. It plays in story mode, or in test mode with `#form=` or for `test-*` levels. |
| `#form=<n>` | With `#level=`, overrides the form: 3, 4, 5, 6 or 99 (Circle). It runs in test mode, so no progress is saved. |
| `#unlockall` | Unlocks every level on the map and the Endless entry. DEV only: use it with `#dev`. |
| `#scene=<name>` | Opens a scene directly: `title`, `intro`, `map`, `theorems`, `cosmetics`, `settings`, `credits`, `ending`, `endless` or `devmenu`. `#scene=devmenu` also turns on DEV. |
| `#seed=<n>` | Starts an Endless run with that seed. |

DEV keys, active with `#dev`:

| Key | Action |
|---|---|
| F1 | Toggle hitboxes, plus a player-state readout |
| F2 | Toggle the performance overlay (fps, update and render ms, particles, quality level) |
| F3 | Toggle god mode |
| F4 | Complete the current level |
| F6 | Deal one hit to the boss (starts the fight if needed) |
| F7 | Cycle the player's form |
| F8 | Kill the player |
| F9 | Open the developer menu: every level and scene, with a form override |

## Project layout

```
index.html            entry point; loads every script in the normative order (docs/CONTRACT.md section 1)
css/style.css         the full-window stage and letterboxing
js/core/              AP root, constants, math, RNG, noise, algorithms (Algo), flow field, paths, events,
                      save (AP.Save), input, beat clock, fixed-step loop
js/engine/            Canvas2D renderer, WebGL, scenes and transitions, camera, particles, physics,
                      entities, tilemap, level registry
js/data/              world metadata and palettes (worlds.js), theorem list (theorems.js)
js/art/               drawing kit, WebGL background shaders (with 2D fallbacks), midground layers, tile art
js/audio/             Web Audio engine, 47 synthesized sound effects, generative music for 15 keys
js/game/              progress, the player, common entity types, the level scene (AP.Test), developer menu
js/worlds/wN/         each world's enemies, hazards and boss (entities.js, boss.js)
js/levels/            level definitions: test.js plus w1.js to w5.js
js/endless/           Endless chunk templates, the seeded segment generator and the endless scene
js/ui/                UI kit and stroke font, HUD, theorems and cosmetics (meta), title, story cards,
                      world map, pause and results, settings and remapping, theorem and cosmetic galleries
js/main.js            AP.boot(): starts everything (autoboots unless window.AP_NO_AUTOBOOT is set)
tools/                Node-only checkers: lint and reachability bots, headless boot harness, physics
                      conformance test, GLSL lint, single-file builder
docs/                 CONTRACT.md (technical contract), DESIGN.md (design bible), ENGINE_API.md (engine API
                      reference), FOUNDATION_NOTES.md (build notes)
dist/apeiron.html     the single-file build (generated)
```

Every game script is a classic `<script>` wrapped in one IIFE that adds to the single global `AP`. The game uses no
modules, frameworks, dependencies or asset files.

## Checks

The checks need only Node.js (they were built and run with Node 24) and no packages. Run them from the project root;
each exits 0 when clean.

```
node tools/check-all.js --strict            # everything below plus static, load, globals, manifest and def checks
node tools/check-all.js --owner W3          # one owner's files and tests (CORE, TOOLS, ART, AUDIO, UI, W1..W5)
node tools/lint-levels.js                   # level lint plus the SAFE and EXPERT reachability bots, all levels
node tools/lint-levels.js --world 2         #   one world (or --id w2-3)
node tools/lint-levels.js --endless 50      #   fuzz 50 generated Endless segments
node tools/phys-test.js                     # physics conformance: model and real player vs the CONTRACT tables
node tools/boot-test.js                     # headless boot: every level (monkey input, deaths, completion,
                                            #   boss defeat), every scene, art, audio, endless, save; both GL modes
node tools/boot-test.js --endless 10        #   play 10 Endless segments
node tools/build-dist.js                    # write dist/apeiron.html
node tools/boot-test.js --dist dist/apeiron.html   # the same headless boot against the single-file build
node tools/test-algo.js                     # unit tests for AP.Algo
node tools/glsl-lint.js                     # static and stub-compiled checks of every shader
```

`boot-test` runs the real game in a Node `vm` with stub DOM, Canvas, WebGL and Web Audio implementations. Its timing
figures come from the Node vm, not a browser, so they are informational only.
