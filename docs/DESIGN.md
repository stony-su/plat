# APEIRON — Game Design Bible

> Companion to `docs/CONTRACT.md` (the technical contract). When the two disagree, the CONTRACT wins on names, numbers and APIs, and this document wins on look, feel, story and content. Every number here that touches physics must respect CONTRACT §4.

---

## 1. Vision

**Pitch.** You play a polygon that gains vertices. Each new vertex is a new ability, and you grow from a Triangle to a Circle: a polygon with infinitely many sides. *Apeiron* is Greek for *the boundless*.

**Pillars**
1. **Geometry is character.** The player's shape *is* its moveset. The world map, the music's meter, the HUD glyphs and the transitions all reuse the same polygons.
2. **The art is the mechanic.** Each world is one algorithmic-art technique: Truchet tiles, Voronoi diagrams, flow fields, L-systems and fractals, harmonic motion. That same technique produces both the visuals and the gameplay.
   - The wind in W3 is the visible flow field.
   - The vines in W4 are L-system growth.
   - The orbit nodes in W5 move on Lissajous curves.
3. **Precision with kindness.** Controls are tight and responsive, respawn is instant, checkpoints are generous, assist mode is complete, and levels are provably beatable (lint bots).
4. **Everything generated.** There are no bitmaps or samples. Every pixel is drawn by geometry or shaders, and every sound is synthesized.

**Tone.** Luminous, calm and a little mysterious: mathematical poetry. Text is sparse and every line earns its place. Darkness is lit by thin glowing lines. Motion is smooth and eased; nothing pops without a tween.

**Visual grammar (applies everywhere)**
- **Shapes.** Thin glowing outlines over deep backgrounds. Shapes are regular polygons, stars, arcs, lines and Béziers. Fills are translucent; outlines are bright.
- **Colour roles** (CONTRACT §2.8):
  - primary: terrain;
  - accent: collectibles and interactables;
  - hazard: anything that kills, which must also have a spiky silhouette;
  - ink: the player and text.
- **Glow.** Use the cached `AP.R.glow` sprites, sparingly, on the important things.
- **Motion.** Everything breathes: a slow sine pulse on idle objects, and a beat pulse (`AP.Beat.phase`) on world props.

---

## 2. The player

**Hitbox:** 22×22 u in every form. Only the visuals change.

| Form | Sides | New ability | Signature visual |
|---|---|---|---|
| Triangle | 3 | Run, variable-height jump | Sharp, nimble; spins quickly in the air |
| Square | 4 | Wall-slide + wall-jump | Sparks trail along the wall while sliding; the square "grips" with a flat side |
| Pentagon | 5 | Double jump | The second jump bursts a pentagram ring (64u radius) that damages `burstable` enemies |
| Hexagon | 6 | 8-way dash; breaks `+` | Hexagonal afterimages (5) in accent colour; a chromatic edge during the dash |
| Circle | ∞ (99) | Orbit | Dashed tether line to the node; the circle glows brighter as speed rises; a comet tail on fling |

**Rendering**
- **Shape.** A regular N-gon of radius 13u, centred on the hitbox. When the player rests flat, its bottom edge sits on the hitbox bottom.
- **Layers:**
  1. Outline in `ink`, 2.5u.
  2. Inner fill in `pal.accent` at about 22% alpha.
  3. A small bright core (radius 3u).
  4. The **eye**: a 2.5u dot that leads the movement direction (`vis.eyeX/eyeY`).
- **Air rotation.** The polygon rotates at a rate proportional to `vx`, about 0.035 rad per u/s·s, clamped. On landing it springs to the nearest flat orientation (a multiple of 2π/N).
- **Squash and stretch.**
  - Landing: sx 1.28 / sy 0.74 (scaled by landing speed), springing back.
  - Jump: 0.82 / 1.22.
  - Wall-slide: slight horizontal squash toward the wall.
- **Morph between forms** (form gain cutscene; `setForm` at level start):
  - Vertices interpolate along the outline over about 0.6 s.
  - New vertices emerge from edge midpoints.
  - Becoming the Circle uses N = 48 for the morph target.
- **Trail.** The ring buffer `P.trail` feeds `AP.Cosmetics.drawTrail`. The default trail is a faint polyline of past outlines, shown only at speed.
- **Death.** The polygon's **edges shatter**: each edge becomes a line particle flying outward, with a ring flash and a short low "glitch" sound.
- **Respawn.** Edges converge from the screen edges toward the checkpoint and **reassemble** the polygon (0.3 s), followed by a soft ring pulse.

**Form-gain cutscene** (after touching a boss's Vertex)
- The screen dims and the vertex flies into the player.
- The polygon morphs to the new form, and its name is drawn in the stroke font with a one-line control hint.
- Hint texts (`{action}` is replaced with the bound key):
  - **FOUR — SQUARE.** "The square stands firm. Slide down walls; press {jump} against one to leap away."
  - **FIVE — PENTAGON.** "The pentagon hides a star. Press {jump} in mid-air to jump again."
  - **SIX — HEXAGON.** "The hexagon tiles the world. Press {dash} to dash in any direction; dashes break cracked blocks."
  - **∞ — CIRCLE.** "Infinitely many sides. Hold {orbit} near a node to orbit it; let go to fly."

---

## 3. Worlds

Each world: identity, art, music, mechanics, enemies, level briefs (the beats each level must contain), boss, secrets.

Shared rules for every world:
- **Level ids, form, par, sizes:** CONTRACT §3 and §4.6.
- **Gems:** every normal level has 3:
  - gem 1: a visible detour;
  - gem 2: behind a `%` secret, hinted by a shard line or sign;
  - gem 3: a mastery route at GEM tier.
- **Shards** trace the intended route. Shard arcs follow the canonical jump offsets in CONTRACT §4.5 rule 6.
- **First level of each world:** opens with a hazard-free tutorial room and a sign for the new ability.
- **Level width** must allow `w·h ≤ 24000` (CONTRACT §3 limits).

### W1 — The Lattice (Triangle · style `w1` · music `w1`, 3/4)
- **Identity.** An infinite blueprint: the first place, clean and inviting. Teal lines on deep navy, gold collectibles.
- **Art.**
  - Shader background: multi-scale Truchet quarter-arcs on slowly drifting grids at three parallax depths.
  - Midground: floating isometric wireframe cubes and Truchet glyphs.
  - Tiles: a woven Truchet fill.
- **Music.** D Lydian, curious and bright. Plucky triangle-wave arpeggios, a soft kick on beat 1, Euclidean hats E(5,12), and a warm sine bass walking roots in thirds.
- **Mechanics introduced:** run and variable jump, one-way `=`, spikes, crumble `~`, bounce pads `B`, movers, the first `%` secret.
- **Enemies**
  - `w1.crawler`: a square with two little leg-lines; patrols and turns at walls and ledges; stompable.
  - `w1.bouncer`: a circle with an inner triangle; hops on the beat (accent on beat 1 of 3); stompable on the way down.
  - `w1.saw`: a spinning 6-point star on a path; hazard only.
- **Levels**
  - **w1-1 First Vertex** (par ≈ 60)
    - Tutorial room with signs: "Move with {left} {right}." / "Press {jump} to jump. Hold it to jump higher."
    - Ledges of 1–3 tiles.
    - A one-way stack with the sign "Hold {down} and press {jump} to drop through."
    - A 2-tile spike pit, then a checkpoint.
    - The first crawler on a long flat, with the sign "Land on enemies to defeat them."
    - A short combined section, then the exit.
    - Secret: a shard line leading into a `%` wall (gem 2).
  - **w1-2 Truchet Falls** (par ≈ 80)
    - A drop into a lower cavern, then a climb out.
    - Crumble bridges, with a sign on the first one.
    - Bounce pads up to tall ledges.
    - Bouncers whose hops you must time against the beat.
    - Horizontal, then vertical movers.
    - Gem 3 sits above a bounce chain.
  - **w1-3 Gridlock** (par ≈ 95)
    - Saws on rectangular loop paths around platforms.
    - Movers carrying you over spike pits.
    - A `trigger` mover that waits for you.
    - A final ascent using everything.
- **Boss — The Tessellator** (`w1.tessellator`; arena about 30×17; 3 phases × 2 hits = 6). A 3×3-tile golem built of glowing Truchet tiles.
  - **Slam.** It leaps to above the player (a shadow telegraph of ≥ 0.6 s), slams, and sends a shockwave of popping tiles along the floor that you must jump over. Then it is **stunned 1.8 s with its top core glowing accent**: stomp it.
  - **Tile Rain** (phase 2+). Tiles fall in a Truchet pattern, each with a shadow telegraph.
  - **Floor Flip** (phase 3). Floor sections flip into spikes for 2 s after a 0.8 s telegraph. Use `setTile` with a phase snapshot and restore it on respawn. Never flip the tile under the player without telegraph and escape room.
  - **Defeat.** It shatters into tiles that rain gently and fade, then the Vertex appears.

### W2 — Voronoi Caverns (Square · style `w2` · music `w2`, 4/4)
- **Identity.** A geode cathedral: violet crystal faces, cyan light, deep shadows.
- **Art.**
  - Shader: animated Worley cells with bright facet edges and inner gradients, slowly drifting seeds.
  - Midground: crystal cluster silhouettes cut from Voronoi cells.
  - Tiles: a Voronoi facet fill. `+` crystal shows clear crack lines.
- **Music.** C# Dorian. Glassy FM bells, a low pulsing sub bass, crystalline arpeggios, shakers on E(5,16), and a reverb-like long decay.
- **Mechanics:**
  - wall-slide and wall-jump;
  - `+` crystal, which turret bolts and geodes break, because the player can't dash yet;
  - turrets with a 0.4 s charge telegraph;
  - geodes that shatter nearby `+` when hit hard;
  - mites crawling over every surface.
- **Enemies.**
  - `w2.mite`: a small hexagonal crawler with legs that sticks to surfaces.
  - `w2.turret`: a pentagon set into the wall with a barrel. It glows while charging.
  - `w2.bolt`: an elongated diamond with a trail.
  - `w2.geode`: a rough polygon cluster with inner crystals that cracks when struck.
- **Levels**
  - **w2-1 Cell Division** (par ≈ 70)
    - Sign: "Slide down walls. Press {jump} against a wall to leap."
    - Shafts 3 wide, then 2, then 4.
    - Spikes at the bottom of later shafts, and crumbles inside shafts.
  - **w2-2 Fracture Lines** (par ≈ 85)
    - Lure turret bolts into `+` walls to open paths.
    - Mites circle pillars; time your wall-jumps around them.
  - **w2-3 The Geode** (par ≈ 95)
    - Geodes that you break by landing on them from ≥ 2 tiles.
    - A long vertical climb with aimed turrets.
  - **w2-4 Delaunay Deep** (par ≈ 110)
    - A descent into the deep, then a climb out, combining everything.
    - Gem 3: a long wall-jump shaft lined with spikes.
- **Boss — Crystal Monarch** (`w2.monarch`; vertical arena up to 40×60, or a single tall screen; 8 hits; 3–4 phases). A crowned crystal polygon hovering near the top.
  - **Bolt volleys.** Fans of `w2.bolt`.
  - **Voronoi walls.** Temporary crystal walls spawn (telegraphed) to reshape the climbing shafts.
  - **Shard fall.** Falling shards with telegraphs.
  - **Weak point.** After each volley its core opens for about 2 s, glowing accent. Wall-jump up and stomp the open core, or touch it from above.
  - **Phases.** Each phase reconfigures the arena (tile snapshot per phase) and moves the Monarch higher.

### W3 — The Currents (Pentagon · style `w3` · music `w3`, 5/4)
- **Identity.** An ocean of air: deep blue, gold light, everything flowing.
- **Art.**
  - Shader: domain-warped flow noise with streaks.
  - Midground: decorative streamline particles from `AP.Flow`.
  - Tiles: topographic isolines.
  - **Wind zones** (W3 agent): visible streamline particles and lines drawn with the *exact same* `AP.Flow` call that pushes the player.
- **Music.** F Mixolydian in 5/4 (grouped 3+2). Airy pads, a breathy sine "flute" lead, a gentle kick on 1 and 4, and wind-noise swells.
- **Mechanics:**
  - double jump with the pentagram burst;
  - `w3.wind` zones: steady → lifts → swirl vortices → pulsing gusts telegraphed by streamline intensity → reversing;
  - `w3.drift` platforms carried by the flow;
  - `w3.kite` swaying tethered platforms;
  - `w3.drifter` hazards that ride the streamlines.
- **Levels**
  - **w3-1 Streamlines** (par ≈ 80). Sign: "Press {jump} in mid-air to jump again." Gentle steady wind.
  - **w3-2 Updraft** (par ≈ 95). Vertical lifts; kites you can stomp for a bounce.
  - **w3-3 Eddies** (par ≈ 105). Swirl vortices; drift platforms riding the currents.
  - **w3-4 Turbulence** (par ≈ 115). Gusts that pulse with a period; Drifters.
  - **w3-5 The Doldrums** (par ≈ 125). Sections where the wind reverses; combined gauntlet.
- **Boss — Maelstrom** (`w3.maelstrom`; arena about 30×17 to 36×22; 9 hits; 3 phases). A vortex eye at the centre of a swirling field.
  - It spits Drifters.
  - Its eye opens periodically (accent ring telegraph). Reach it by double-jumping through updrafts, then stomp it or burst it with the pentagram.
  - **Phase 2** reverses the swirl.
  - **Phase 3** adds hazard streamlines (telegraphed lines that become deadly for about 1 s).

### W4 — Fractal Gardens (Hexagon · style `w4` · music `w4`, 6/8)
- **Identity.** An overgrown recursive garden: deep green, lime lines, pink blossoms, orange thorns.
- **Art.**
  - Shader: a slowly breathing Julia set or kaleidoscopic IFS glow.
  - Midground: L-system trees (cached geometry) that grow in and sway.
  - Tiles: leaf veins and a Sierpinski pattern. `+` looks like cracked bark.
- **Music.** A Dorian in fast 6/8. Marimba-like FM, kalimba arpeggios, swung shakers, and self-similar melody: a motif, then the motif augmented, then diminished.
- **Mechanics:**
  - dash (8-way), which breaks `+`;
  - `w4.fruit` dash/double-jump refill;
  - `w4.vine` L-system growth into one-way platforms (grow on near / touch / trigger / beat, and retract or reset);
  - `w4.thorn` Koch-curve thorn strips that "iterate" (grow) as a telegraph;
  - `w4.sierp` Sierpinski enemies that split into 3 smaller ones (depth + 1) down to depth 2.
- **Levels**
  - **w4-1 Axiom** (par ≈ 85). Sign: "Press {dash} to dash in any direction. Dashes break cracked bark." Then fruit.
  - **w4-2 Branching Rules** (par ≈ 100). Vines grow when you approach or touch them, then retract.
  - **w4-3 Self-Similar** (par ≈ 110). Splitting Sierpinskis; thorns.
  - **w4-4 Koch Coast** (par ≈ 120). Long thorn coasts that grow by iteration; dash timing.
  - **w4-5 Recursion Depth** (par ≈ 130). Rooms nested in rooms: a big room's layout repeats at a smaller scale inside it.
  - **w4-6 Overgrowth** (par ≈ 145). The W4 gauntlet.
- **Boss — The Recursion** (`w4.recursion`; arena about 36×20; 10 hits; 3–4 phases). A giant Sierpinski triangle.
  - Dashing its exposed core splits it into 3 self-similar copies, each with a smaller core, that move independently.
  - The final small core must be dashed.
  - **Attacks:** thorn lines growing along the floor (Koch iteration telegraph), seed barrages, and vine walls that grow and recede.

### W5 — Harmonic Spire (Circle · style `w5` · music `w5`, 4/4 with a 3:4:5 polyrhythm)
- **Identity.** A tower of standing waves: cream lines on near-black, gold and magenta accents. Everything moves in time.
- **Art.**
  - Shader: interference of moving wave sources, plus phyllotaxis dots.
  - Midground: slowly tracing harmonograph and Lissajous figures.
  - Tiles: concentric rings and moiré.
- **Music.** E Phrygian dominant, resolving toward E Lydian near the end. Bell harmonics, choir-like pads, and 3:4:5 pulse layers across the bar.
- **Mechanics:**
  - orbit with nodes (static, Lissajous `liss`, `path`);
  - `w5.wave` rows of sine-wave platforms;
  - `w5.laser` beams firing on Euclidean onsets, with a telegraph;
  - `w5.ring` refresh rings;
  - optional extra type `w5.resonator`: expanding hazard rings on beats, with a gap to slip through.
- **Levels**
  - **w5-1 Fundamental** (par ≈ 90). Sign: "Hold {orbit} near a node to orbit it. Let go to fly." Static nodes over gentle pits.
  - **w5-2 Overtones** (par ≈ 110). Node chains; wave rows.
  - **w5-3 Interference** (par ≈ 125). Lasers and rings; resonators.
  - **w5-4 Lissajous** (par ≈ 135). Nodes moving on Lissajous curves.
  - **w5-5 Golden Angle** (par ≈ 150). A vertical spiral climb: nodes and platforms placed by phyllotaxis (golden angle 137.5°).
  - **w5-6 Resonance** (par ≈ 170). Everything combined.
- **Final boss — The Null** (`w5.null`; style `void`, music `boss5`; 12 hits; 4 phases). A zero-dimensional black point with a halo of harmonograph arms that unmake geometry.
  - **Phase 1.** Arms sweep the arena; jump or dash over them. Its core cracks open (accent); dash or stomp in.
  - **Phase 2.** A gravity pull (an addForce well), ring waves, and orbit nodes that let you fling into the opened core.
  - **Phase 3.** It eats the arena into floating islands (tile snapshots) with beat lasers.
  - **Phase 4 (finale).** It collapses to a point. Nodes orbit it; orbit and fling into the core 3 times.
  - **Defeat.** A white flash (respects flash settings), and the Vertex shows "∞". Touching it calls `completeLevel({ending:true})`.

---

## 4. Collectibles and secrets
- **Shard** (`*`). A small gold triangle shard that spins and pulses on the beat. Pickup plays an ascending pentatonic note; consecutive pickups within 0.6 s climb the scale. It has a 24u magnet.
- **Prime gem** (`1` `2` `3`). A faceted diamond in accent colour with an orbiting dot.
  - Each is saved immediately.
  - An already-owned gem appears as a hollow ghost.
  - 72 in total (24 levels × 3).
- **Secret** (`%`). A fake wall drawn identically to solid. Touching it reveals the room with a ghost fade, the `secret` sound and a ring.
- **Checkpoint** (`C`). A tall thin obelisk. When activated, a ring expands, its tip ignites and a bell plays.
- **Exit** (`E`). A rotating polygon portal (the world's polygon) with an inward spiral of points.
- **Vertex** (`V`). Appears after the boss is defeated: a bright point with orbiting rays.

---

## 5. Story and text (stroke font for titles; UI font for body)
**Intro** (first run, one line per card, about 3 s each, skippable):
1. "Before the line, there was the Point."
2. "The Point dreamed, and its dream was Geometry."
3. "At the centre of the dream a hunger grew: the Null, which unmakes every angle."
4. "You are three edges and a stubborn spark."
5. "Gather vertices. Become more. Become boundless."

**World cards** (shown on first entry to a world's first level, and on the map):
- W1 THE LATTICE: "Every path is a choice of corners."
- W2 VORONOI CAVERNS: "Each crystal claims the space nearest to it."
- W3 THE CURRENTS: "Here the wind is drawn before it blows."
- W4 FRACTAL GARDENS: "The part remembers the whole."
- W5 HARMONIC SPIRE: "Everything that moves, moves in time."

**Ending** (after the Null):
1. "The Null had no sides to hold."
2. "You had infinitely many."
3. "Every angle it unmade, you remembered."
4. "The Point opened its eye, and saw a circle."
5. "Boundless."
6. Title card **APEIRON**, then the credits, then a toast: "Endless mode unlocked: Apeiron."

**Credits** (a slow scroll over the title shader):
- "APEIRON — a game of geometry."
- "Every shape, colour and sound in this game is generated by code."
- "Made with Claude Code."
- **"Standing on the shoulders of"**:
  - Sébastien Truchet (tilings, 1704)
  - Georgy Voronoy (diagrams, 1908)
  - Boris Delaunay (triangulation, 1934)
  - Ken Perlin (noise, 1983; simplex, 2001)
  - Aristid Lindenmayer (L-systems, 1968)
  - Wacław Sierpiński (1915)
  - Helge von Koch (1904)
  - Jules Antoine Lissajous (1857)
  - Hugh Blackburn (harmonograph, 1844)
  - Helmut Vogel (phyllotaxis, 1979)
  - Godfried Toussaint (Euclidean rhythms, 2005)
  - E. Bjorklund (2003)
- "Thank you for playing."

---

## 6. Meta
**Progression.**
- Levels open one after another, and the boss opens after every level in its world is cleared.
- The next world opens after the boss, and Endless opens after the ending (CONTRACT §2.7 `AP.Progress`).
- Completion % follows CONTRACT §2.7.

**Results screen** (after each level):
- Time against par (gold when under par, with a "NEW BEST" flare) and deaths.
- Shards x/y with a bar that fills, and 3 gem slots that pop in.
- Theorems unlocked during the level.
- Buttons: Continue (next level, or the map), Retry, Map.

**Theorems** (`js/data/theorems.js`; at least 24; driven only by CONTRACT §2.4 events plus `AP.Save.data`; conditions are guidance and UI may refine them):

| id | name | condition |
|---|---|---|
| axiom | Axiom | Complete any level |
| pythagoras | Pythagoras | Become the Square |
| golden-ratio | Golden Ratio | Become the Pentagon |
| honeycomb | Honeycomb Conjecture | Become the Hexagon |
| squaring-circle | Squaring the Circle | Become the Circle |
| tiling | Tiling Theorem | Defeat The Tessellator |
| crystallographic | Crystallographic Restriction | Defeat the Crystal Monarch |
| navier-stokes | Navier–Stokes | Defeat the Maelstrom |
| banach-tarski | Banach–Tarski | Defeat The Recursion |
| qed | Q.E.D. | Defeat the Null |
| euler-path | Euler's Path | Finish a level without dying |
| zeno | Zeno's Paradox | Beat a level's par time |
| brachistochrone | Brachistochrone | Beat par on every level of one world |
| prime-hunter | Prime Hunter | Collect 10 prime gems |
| sieve | Sieve of Eratosthenes | Collect 36 prime gems |
| infinitude | Infinitude of Primes (hidden) | Collect all 72 prime gems |
| tessellation | Tessellation | Collect every shard in a level |
| fibonacci | Fibonacci | Collect 13 shards in one airborne arc (no landing) |
| seven-bridges | Seven Bridges | Find 7 secrets |
| large-numbers | Law of Large Numbers | Collect 1000 shards in total |
| mobius | Möbius Strip (hidden) | Die 100 times |
| parallel | Parallel Postulate | Wall-jump 100 times |
| pentagram | Pentagram | Double-jump 200 times |
| vector-space | Vector Space | Dash 500 times |
| kepler | Kepler's Laws | Fling from 5 nodes without touching the ground |
| hilbert | Hilbert's Hotel | Clear 10 segments in one Endless run |
| monte-carlo | Monte Carlo | Play 10 Endless runs |
| four-color | Four Colour Theorem | Unlock 4 cosmetics |
| godel | Incompleteness (hidden) | Reach 100% completion |

**Cosmetics** (`AP.Cosmetics`; chosen in the `cosmetics` scene; applied through `playerStyle` and `drawTrail`):
- **Trails**, unlocked by total gems:

  | trail | gems | look |
  |---|---|---|
  | none | 0 | |
  | Spirograph | 6 | hypotrochoid loops |
  | Fibonacci | 15 | golden-spiral dots |
  | Sierpinski Dust | 27 | tiny triangles subdividing as they fade |
  | Lissajous Ribbon | 42 | |
  | Prism | 60 | spectral offset outlines |
  | Apeiron | 72 | ∞ figure-eight comet |
- **Palettes**, unlocked by theorems:

  | palette | unlocked by | look |
  |---|---|---|
  | default | – | ink |
  | Euler | euler-path | teal / white |
  | Pythagorean | tiling | gold |
  | Platonic | squaring-circle | iridescent cycling |
  | Fractal | banach-tarski | lime / pink |
  | Prime | sieve | violet / cyan |
  | Null | qed | black body, white outline, inverted glow |

---

## 7. UI and UX direction
- **Stroke font** (`AP.UI`). A custom geometric vector font of straight segments and arcs on a 4×6 grid: A–Z, 0–9, `. , : ; ! ? ' " - + / ( ) · × ∞ → ← ↑ ↓ %`.
  - Rendered as glowing strokes.
  - Has an animated "draw-on" reveal, with stroke length progressing over time.
  - Used for titles, world names, form names, big numbers and the APEIRON logo.
  - Body text uses `AP.R.text` (FONT_UI).
- **Title screen.**
  - Shader style `title`, with a big central polygon morphing 3→4→5→6→∞→3 slowly and vertex dots orbiting it.
  - "APEIRON" drawn on with the stroke font, then "press any key" pulsing. That first input unlocks audio.
  - Menu: Continue / New Game / Endless (locked until unlocked, shown as a dim ∞) / Theorems / Cosmetics / Settings / Credits.
  - New Game asks for confirmation if a save exists.
- **World map** (`map`).
  - The five world polygons sit along a **golden (logarithmic) spiral**, each larger than the last: a small triangle near the spiral's centre, then square, pentagon, hexagon, and an outer circle.
  - Each world's levels sit on its polygon's vertices (W5's on the circle) with the boss node at its centre. The path between worlds traces the spiral.
  - The player icon (the current form) travels along edges between nodes. The camera eases between worlds; zooming out shows the whole spiral.
  - Locked nodes are dim outlines. Cleared nodes are filled and show 3 tiny gem pips.
  - The selected node shows a card: name, best time, par, deaths, shards, gems.
  - Controls: arrows move between nodes, confirm enters.
  - `celebrate` animates newly unlocked edges drawing on.
- **Pause** (overlay). The screen blurs to dim and the menu appears: Resume / Retry / Restart / Settings / Assist (speed 100/85/70/50%, invincibility, infinite air, skip level) / Quit to map.
- **Settings.**
  - Audio: master, music, sfx.
  - Video: screen shake 0–100%, flash full/reduced/off, particles high/med/low, background high/low/off, fullscreen, show timer, HUD full/minimal.
  - Controls: remap keyboard and gamepad per action (`AP.Input.capture`), reset bindings.
  - Data: export/import save, reset progress (double confirm).
- **HUD.**
  - Top-left: the form glyph, then the shard count `x/y`.
  - Top-centre: the boss bar (name in the stroke font; segmented by phase).
  - Top-right: 3 gem slots, then deaths.
  - Bottom-right: the timer, if enabled.
  - An assist badge appears when assist is on.
  - Minimal thin lines, and it never covers the player.
  - The level name card (2 s) appears on start.
- **Transitions.**
  - `iris`: the current form's polygon closes and opens.
  - `shatter`: the screen breaks into Voronoi cells that fall away.
  - `fade`.
- **Toasts.** Top-centre, stacking, slide in and out: theorem unlocked, saving unavailable, and so on.
- **Accessibility.** Every flash respects the flash setting. Shake is scaled by the shake setting. Hazards have spiky silhouettes, so colour is never the only cue.

---

## 8. Audio direction (AUDIO)

| key | meter / BPM | mode | character |
|---|---|---|---|
| title | 5/4, 84 | Lydian | slow FM pad, sparse bells, morphing chord |
| map | 4/4, 90 | Ionian | gentle arpeggio, soft pulse |
| w1 | 3/4, 112 | D Lydian | triangle plucks, soft kick, E(5,12) hats |
| boss1 | 3/4, 132 | D minor | driving bass ostinato, toms |
| w2 | 4/4, 96 | C# Dorian | glass FM bells, sub pulse, E(5,16) shakers |
| boss2 | 4/4, 116 | C# Phrygian | sharp crystalline stabs |
| w3 | 5/4, 100 | F Mixolydian | airy pads, sine flute, 3+2 grouping |
| boss3 | 5/4, 120 | F minor | swirling arps, noise swells |
| w4 | 6/8, 168 | A Dorian | marimba FM, kalimba, swung shakers |
| boss4 | 6/8, 192 | A harmonic minor | relentless, self-similar motifs |
| w5 | 4/4 + 3:4:5, 120 | E Phrygian dominant → Lydian | bell harmonics, choir pad, layered pulses |
| boss5 | 4/4 + 3:4:5, 128 | E Locrian → resolves | heavy sub, void drones |
| endless | 4/4, 120 | mode follows the segment style | propulsive |
| ending | 4/4, 72 | Lydian | warm, spacious |
| credits | 4/4, 96 | Ionian | gentle, nostalgic arpeggios |

**Sound effects.** Small, punchy and musical. Jump pitch rises with the form's vertex count. Shards climb a pentatonic scale. The checkpoint is a bell; the vertex is a shimmering chord; death is a descending glitch; UI ticks are crisp.

**Mix.** Music sits under the sound effects. Ducking happens on death and on vertex collection.

---

## 9. Endless mode — "Apeiron" (W1 agent)
**Unlocking.** Unlocked after the ending. The title menu offers two entries:
- **Daily** (`AP.Endless.dailySeed()`)
- **Seeded** (enter or randomize a seed)

**A run**
- A run is a sequence of generated **segments**, each about 80–140 tiles. A segment is a full level object passed to `go('level', {level, mode:'endless', ...})`.
- The style and music cycle w1→w5 by segment, and the form is 99, so every ability is available.
- Difficulty ramps by segment:
  - gap sizes go from ROUTINE to CHALLENGE;
  - more enemies;
  - more moving parts.
- Segments are stitched from hand-authored **chunk templates** (`js/endless/chunks.js`). Each chunk is tagged with its required abilities, difficulty and styles, and the chunks are joined with procedural connectors. Everything is seeded by `AP.RNG`.
- Every segment must pass the SAFE lint; the fuzz test checks 50 seeds.

**Lives and scoring**
- 3 lives. Each death costs one, and every 3 segments cleared gives one back, up to a maximum of 5.
- Score = segments × 1000 + shards × 10 + a time bonus.

**Persistence and results.** Best score and seed are saved in `AP.Save.data.endless`. The results screen shows segments, score, time, deaths and a "new best" flourish.

---

## 10. Controls (default; all remappable)

| action | keyboard | gamepad |
|---|---|---|
| move | Arrows / WASD | D-pad / left stick |
| jump | Space / Z / J | A |
| dash | X / K / Left Shift | X / B / RB |
| orbit (hold) | C / L / Right Shift | RT / LT / Y / LB |
| pause | Esc / P | Start |
| retry | R | Back/Select |
| confirm / back | Enter, Space, Z / Esc, Backspace, X | A / B |
