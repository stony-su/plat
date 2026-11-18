/* js/levels/w5.js — owner: W5 */
(function (AP) {
  'use strict';

  // W5 — Harmonic Spire (Circle, form 99: every ability, including orbit). Maps are drawn at load time by
  // the small deterministic Grid helper below, so every feature reads as one commented line.

  // ------------------------------------------------------------------ grid helper
  function Grid(w, h) {
    this.w = w;
    this.h = h;
    this.c = [];
    for (var y = 0; y < h; y++) {
      var r = [];
      for (var x = 0; x < w; x++) r.push('.');
      this.c.push(r);
    }
    this.ents = [];
  }
  // inclusive rectangle
  Grid.prototype.fill = function (x0, y0, x1, y1, ch) {
    for (var y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) {
      for (var x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) this.c[y][x] = ch;
    }
    return this;
  };
  Grid.prototype.put = function (x, y, ch) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y][x] = ch;
    return this;
  };
  // borders: solid left/right columns and top row (the bottom row stays open for pits)
  Grid.prototype.frame = function () {
    for (var y = 0; y < this.h; y++) { this.c[y][0] = '#'; this.c[y][this.w - 1] = '#'; }
    for (var x = 0; x < this.w; x++) this.c[0][x] = '#';
    return this;
  };
  Grid.prototype.rows = function () {
    var out = [];
    for (var y = 0; y < this.h; y++) out.push(this.c[y].join(''));
    return out;
  };
  // entities-array helpers (tile coordinates, fractions allowed)
  Grid.prototype.ent = function (o) { this.ents.push(o); return this; };
  Grid.prototype.shard = function (x, y) { this.ents.push({ type: 'shard', x: x, y: y }); return this; };
  // shards on a circle around (cx, cy) (tile coords of the centre tile): n of them from a0 to a1 (degrees)
  Grid.prototype.ring = function (cx, cy, r, a0, a1, n) {
    for (var i = 0; i < n; i++) {
      var a = (a0 + (a1 - a0) * (n === 1 ? 0.5 : i / (n - 1))) * Math.PI / 180;
      this.shard(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return this;
  };
  // shards on a straight line, both ends included
  Grid.prototype.line = function (x0, y0, x1, y1, n) {
    for (var i = 0; i < n; i++) {
      var k = n === 1 ? 0.5 : i / (n - 1);
      this.shard(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
    }
    return this;
  };
  // map shards along [dx, dy] offsets from (x, y)
  Grid.prototype.trail = function (x, y, offs) {
    for (var i = 0; i < offs.length; i++) this.put(x + offs[i][0], y + offs[i][1], '*');
    return this;
  };
  // the canonical running-jump arc (CONTRACT §4.5 rule 6), mirrored with dir = -1
  var ARC = [[1, -2], [2, -3], [3, -3], [4, -3], [5, -2]];
  Grid.prototype.arc = function (x, y, dir) {
    for (var i = 0; i < ARC.length; i++) this.put(x + ARC[i][0] * (dir || 1), y + ARC[i][1], '*');
    return this;
  };

  // a w5.wave row whose segments rest with their tops on row y, starting at column x
  // o: {n, w, gap, amp, wavelength, period, dir, phase, harmonic, tphase, taper}
  Grid.prototype.wave = function (x, y, o) {
    var e = { type: 'w5.wave', x: x, y: y };
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) e[k] = o[k];
    this.ents.push(e);
    return this;
  };

  function level(def, g) {
    def.world = 5;
    def.form = 99;
    def.map = g.rows();
    def.entities = (def.entities || []).concat(g.ents);
    if (!def.legend) def.legend = {};
    if (!def.lint) def.lint = { stand: [], open: [], edges: [], openTop: false, skip: false, note: '' };
    AP.Levels.register(def);
  }

  // ==================================================================== w5-1 Fundamental
  // The fundamental: one string, one node. A hazard-free basin teaches the orbit (fall in and climb the
  // stairs back up), then single static nodes over gentle pits: a fling across, a fling up a sheer cliff,
  // a two-node swing, a roofed hall that keeps the fling flat, and a long three-node arc to the exit.
  // Gem 1 floats straight above the cliff node; gem 2 sits in a cave under two fake floor tiles (shards
  // glint inside them); gem 3 is a perch in the top-left corner: a maximum fling from the very first node.
  (function () {
    var g = new Grid(196, 33);
    // ---- A. the tutorial basin (no hazards): a 16-wide gap over a 12-deep floor, one node in the air
    g.fill(1, 17, 12, 32, '#');           // start floor (stand row 16)
    g.put(3, 16, 'P');
    g.put(6, 16, 'S');                    // sign 0: orbit
    g.fill(13, 29, 28, 32, '#');          // the basin floor (stand row 28): falling in is safe
    g.fill(13, 26, 15, 26, '=');          // stairs back up to the start
    g.fill(13, 23, 15, 23, '=');
    g.fill(13, 20, 15, 20, '=');
    g.put(18, 13, 'O');                   // the first node
    g.ring(18, 13, 2.6, -150, 150, 8);    // its orbit, drawn in shards
    g.fill(29, 17, 38, 32, '#');          // far floor (stand row 16): a sheer 12-row wall from the basin
    g.put(33, 16, 'C');
    // gem 3: the corner perch, 15 tiles left of the first node and 9 rows above it (GEM tier)
    g.fill(1, 5, 3, 5, '#');
    g.put(2, 4, '3');
    // ---- B. the first real pit: one node, a sign about aiming
    g.put(36, 16, 'S');                   // sign 1: aim
    g.put(46, 12, 'O');
    g.ring(46, 12, 2.6, -170, -10, 5);
    g.fill(55, 18, 64, 32, '#');          // landing (stand row 17)
    g.line(50, 12, 54, 15, 3);
    // ---- C. the cliff: a node at its foot flings you up a sheer 11-row face
    g.fill(65, 7, 74, 32, '#');           // the cliff (stand row 6): unclimbable without the node
    g.put(62, 17, 'C');
    g.put(58, 12, 'O');                   // a node off the ledge, under the cliff's shoulder
    g.line(58, 9, 63, 5, 4);
    g.put(58, 4, '1');                    // gem 1: a visible detour straight above the cliff node
    // ---- D. the two-node swing over a long pit
    g.fill(75, 7, 80, 7, '#');            // cliff-top runway (stand row 6)
    g.put(70, 6, 'C');
    g.put(87, 10, 'O');
    g.put(97, 13, 'O');
    g.ring(87, 10, 2.6, -160, -20, 4);
    g.ring(97, 13, 2.6, -160, -20, 4);
    g.fill(106, 16, 118, 32, '#');        // landing (stand row 15)
    g.put(110, 15, 'C');
    // ---- E. the secret: two floor tiles of the landing are fake; shards glint inside them
    g.fill(113, 16, 114, 16, '%');        // fake floor
    g.fill(110, 17, 117, 19, '.');        // the cave below it
    g.put(116, 19, '2');
    g.shard(113.5, 15); g.shard(113.5, 16); g.shard(113.5, 17.2);
    // ---- F. the hall: a roof over the pit keeps the fling flat (room to orbit, not to soar)
    g.fill(119, 16, 126, 32, '#');        // hall entrance floor (stand row 15)
    g.fill(119, 1, 150, 7, '#');          // the roof (open rows 8..15)
    g.put(135, 12, 'O');
    g.line(129, 12, 132, 10, 3);
    g.line(139, 9, 144, 13, 4);
    g.fill(146, 16, 156, 32, '#');        // hall exit floor (stand row 15)
    g.put(151, 15, 'C');
    // ---- G. the long arc: three nodes like a slack string, the exit beyond
    g.put(162, 12, 'O');
    g.put(171, 15, 'O');
    g.put(180, 12, 'O');
    g.ring(171, 15, 2.6, 20, 160, 4);
    g.fill(186, 16, 194, 32, '#');        // exit ground (stand row 15)
    g.put(191, 15, 'E');
    g.frame();

    level({
      id: 'w5-1', index: 1, boss: false,
      name: 'Fundamental',
      style: 'w5', music: 'w5',
      par: 90,
      signs: [
        'Hold {orbit} near a node to orbit it. Let go to fly.',
        'Hold a direction as you let go to aim your flight.'
      ],
      meta: { brief: 'Teach the orbit in a hazard-free basin, then static nodes over gentle pits.' }
    }, g);
  })();

  // ==================================================================== w5-2 Overtones
  // A string's overtones. A gentle travelling wave over a safe trench teaches the rows (and the trench
  // hides gem 2 behind a fake wall), a steep wave of separate frets has to be hopped over a pit, then
  // the harmonic series: three strings pinned between posts, ringing in their 1st, 2nd and 3rd
  // harmonics, whose still points glow gold. A five-node melody spans a chasm, and a ladder of short
  // waves climbs to the exit. Gem 1 floats above the second string's swing; gem 3 is a far perch
  // west of the melody, reachable only by an expert fling from its first node.
  (function () {
    var g = new Grid(206, 30);
    // ---- A. start, the teaching wave over a safe trench
    g.fill(1, 21, 12, 29, '#');           // start floor (stand row 20)
    g.put(3, 20, 'P');
    g.put(8, 20, 'S');                    // sign 0: waves
    g.wave(13, 21, { n: 20, w: 1, amp: 1, wavelength: 14, period: 2.6, dir: 'right', taper: 3 });
    g.fill(13, 26, 32, 29, '#');          // the trench floor (stand row 25): falling in is safe
    g.fill(29, 23, 32, 23, '=');          // a step back up to the far floor
    g.fill(33, 21, 42, 29, '#');          // far floor (stand row 20)
    g.put(37, 20, 'C');
    g.trail(0, 0, [[15, 19], [18, 18], [21, 18], [24, 19], [27, 19]]);
    // gem 2: a cave inside the start floor, behind the trench's west wall
    g.fill(12, 23, 12, 25, '%');
    g.fill(8, 23, 11, 25, '.');
    g.put(9, 25, '2');
    g.trail(0, 0, [[15, 25], [17, 25], [19, 25]]);
    // ---- B. a steep wave of separate frets over a pit: hop from crest to crest
    g.wave(43, 21, { n: 10, w: 1.5, gap: 0.5, amp: 1.25, wavelength: 8, period: 2.2, dir: 'left', taper: 2 });
    g.fill(63, 21, 72, 29, '#');          // landing (stand row 20)
    g.put(67, 20, 'C');
    g.trail(0, 0, [[44, 18], [48, 17], [52, 18], [56, 17], [60, 18]]);
    // ---- C. the harmonic series: three strings between posts over a pit
    g.fill(73, 21, 74, 29, '#');          // post
    g.wave(75, 21, { n: 14, w: 1, amp: 1.5, period: 2.4, harmonic: 1 });
    g.fill(89, 21, 90, 29, '#');          // post
    g.put(90, 20, 'S');                   // sign 1: still points
    g.wave(91, 21, { n: 14, w: 1, amp: 1.5, period: 2.0, harmonic: 2, tphase: 90 });
    g.fill(105, 21, 107, 29, '#');        // post (stand row 20)
    g.put(106, 20, 'C');
    g.wave(108, 21, { n: 14, w: 1, amp: 1.5, period: 1.7, harmonic: 3 });
    g.fill(122, 21, 127, 29, '#');        // the last post, wide (stand row 20)
    g.trail(0, 0, [[79, 18], [82, 17], [85, 18]]);
    g.trail(0, 0, [[98, 20], [94, 17], [101, 17]]);
    g.trail(0, 0, [[112, 18], [115, 20], [118, 18]]);
    g.put(101, 12, '1');                  // gem 1: ride the second string's swing up and jump
    g.ent({ type: 'text', x: 81.5, y: 15, text: 'f', size: 18, role: 'accent' });
    g.ent({ type: 'text', x: 97.5, y: 15, text: '2f', size: 18, role: 'accent' });
    g.ent({ type: 'text', x: 114.5, y: 15, text: '3f', size: 18, role: 'accent' });
    // ---- D. a melody of five nodes across a chasm, an island in the middle
    g.put(133, 15, 'O');
    g.put(142, 11, 'O');
    g.ring(133, 15, 2.6, -160, -20, 3);
    g.ring(142, 11, 2.6, -160, -20, 3);
    g.fill(148, 18, 153, 19, '#');        // the island (stand row 17)
    g.put(150, 17, 'C');
    g.put(159, 13, 'O');
    g.put(167, 9, 'O');
    g.put(175, 14, 'O');
    g.ring(159, 13, 2.6, -160, -20, 3);
    g.ring(167, 9, 2.6, -160, -20, 3);
    g.ring(175, 14, 2.6, -160, -20, 3);
    g.fill(181, 19, 186, 29, '#');        // landing (stand row 18)
    g.put(184, 18, 'C');
    // gem 3: the far perch 17 tiles west of the first node and 6 rows above it
    g.fill(114, 10, 116, 10, '#');
    g.put(115, 9, '3');
    // ---- E. the ladder: three short waves stacked up the last wall, the exit on top
    g.fill(187, 6, 204, 29, '#');         // the last wall (stand row 5 at its top)
    g.fill(187, 6, 196, 18, '.');         // the climbing well beside it
    g.wave(188, 15, { n: 4, w: 1.5, gap: 0.5, amp: 0.75, wavelength: 6, period: 2.0, dir: 'right' });
    g.wave(191, 11, { n: 3, w: 1.5, gap: 0.5, amp: 0.75, wavelength: 6, period: 2.0, dir: 'left', phase: 120 });
    g.wave(188, 7, { n: 4, w: 1.5, gap: 0.5, amp: 0.75, wavelength: 6, period: 2.0, dir: 'right', phase: 240 });
    g.put(201, 5, 'E');
    g.trail(0, 0, [[190, 13], [193, 9], [190, 5], [195, 4], [198, 4]]);
    g.frame();

    level({
      id: 'w5-2', index: 2, boss: false,
      name: 'Overtones',
      style: 'w5', music: 'w5',
      par: 110,
      signs: [
        'Waves carry you up and down in time. Walk with them, and jump from a crest to go higher.',
        'A ringing string has still points. Rest on the gold nodes; cross when the string lies flat.'
      ],
      meta: { brief: 'Node chains and wave rows: a travelling wave, frets to hop, the harmonic series.' }
    }, g);
  })();

  // ==================================================================== w5-3 Interference
  // Waves meeting waves. A hall of beams that fire on Euclidean rhythms (each warned by a gold line a
  // step ahead), a chasm crossed only by chaining refresh rings, a floor where two resonators ring on
  // alternate beats (jump through their gold gaps), and a shaft climbed between staggered crossbeams.
  // Gem 1 hides in an alcove of the hall's roof, between two beams; gem 2 behind a fake wall halfway up
  // the shaft; gem 3 is an expert leap from the summit to a lone perch.
  (function () {
    var g = new Grid(200, 30);
    // ---- A. the beam hall (its roof runs up to the sky: no way over)
    g.fill(1, 21, 56, 29, '#');           // floor (stand row 20)
    g.put(3, 20, 'P');
    g.put(6, 20, 'S');                    // sign 0: beams
    g.fill(10, 1, 42, 14, '#');           // the hall's roof (open rows 15..20)
    g.ent({ type: 'w5.laser', x: 15, y: 15, dir: 'down', pattern: [2, 8], rot: 0 });
    g.ent({ type: 'w5.laser', x: 21, y: 15, dir: 'down', pattern: [2, 8], rot: 2 });
    g.ent({ type: 'w5.laser', x: 27, y: 15, dir: 'down', pattern: [3, 8], rot: 0 });
    g.ent({ type: 'w5.laser', x: 33, y: 15, dir: 'down', pattern: [3, 8], rot: 2 });
    g.ent({ type: 'w5.laser', x: 39, y: 15, dir: 'down', pattern: [4, 8], rot: 1 });
    g.trail(0, 0, [[12, 20], [18, 20], [24, 20], [30, 20], [36, 20], [42, 20]]);
    g.fill(29, 11, 31, 14, '.');          // gem 1: an alcove in the roof between two beams
    g.put(30, 12, '1');
    g.trail(0, 0, [[30, 17], [30, 15]]);
    g.put(46, 20, 'C');
    // ---- B. the ring chasm: four refresh rings carry you across (DJ, dash, ring, DJ, dash, ...)
    g.put(53, 20, 'S');                   // sign 1: rings
    g.ent({ type: 'w5.ring', x: 63, y: 16, r: 1.75 });
    g.ent({ type: 'w5.ring', x: 69.5, y: 15, r: 1.75 });
    g.ent({ type: 'w5.ring', x: 76, y: 15, r: 1.75 });
    g.ent({ type: 'w5.ring', x: 82.5, y: 16, r: 1.75 });
    g.line(58, 17, 60, 16, 2);
    g.line(65.5, 13.5, 67, 13, 2);
    g.line(72, 12.5, 73.5, 12.5, 2);
    g.line(78.5, 13, 80, 13.5, 2);
    g.line(85.5, 16, 87, 18, 2);
    g.fill(89, 21, 150, 29, '#');         // landing and the resonator floor (stand row 20)
    g.put(90, 20, 'C');
    // ---- C. two resonators in floor notches, ringing on alternate beats
    g.put(98, 20, 'S');                   // sign 2: resonators
    g.put(110, 21, '.');
    g.ent({ type: 'w5.resonator', x: 110, y: 21, r: 4, every: 2, offset: 0, speed: 4, gap: 100, dir: 'up' });
    g.put(130, 21, '.');
    g.ent({ type: 'w5.resonator', x: 130, y: 21, r: 4, every: 2, offset: 1, speed: 4, gap: 100, dir: 'up' });
    g.arc(105, 20, 1);
    g.put(120, 20, 'C');                  // between the two zones
    g.arc(125, 20, 1);
    g.put(142, 20, 'C');
    // ---- D. the interference shaft: crossbeams on staggered onsets, a rest ledge, a secret alcove
    g.fill(146, 7, 151, 17, '#');         // the shaft's west wall (entered underneath, rows 18..20)
    g.fill(156, 9, 172, 29, '#');         // the east mass; its top (stand row 8) holds the exit
    g.fill(151, 21, 155, 29, '#');        // shaft floor
    g.ent({ type: 'w5.laser', x: 152, y: 17, dir: 'right', pattern: [3, 8], rot: 0 });
    g.ent({ type: 'w5.laser', x: 152, y: 14, dir: 'right', pattern: [3, 8], rot: 3 });
    g.ent({ type: 'w5.laser', x: 152, y: 11, dir: 'right', pattern: [3, 8], rot: 6 });
    g.fill(154, 15, 155, 15, '=');        // rest ledge between the lower beams
    g.trail(0, 0, [[153, 19], [154, 16], [153, 13], [154, 10], [153, 7]]);
    g.fill(156, 12, 156, 13, '%');        // gem 2: a fake wall in the shaft's east side
    g.fill(157, 12, 159, 13, '.');
    g.put(158, 13, '2');
    g.shard(155.2, 12.5);
    g.put(166, 8, 'E');
    g.trail(0, 0, [[158, 8], [160, 8], [162, 8]]);
    // gem 3: a lone perch 14 columns past the summit (beyond the safe double-jump-and-dash reach)
    g.fill(187, 9, 189, 29, '#');
    g.put(188, 8, '3');
    g.arc(172, 8, 1);
    g.frame();

    level({
      id: 'w5-3', index: 3, boss: false,
      name: 'Interference',
      style: 'w5', music: 'w5',
      par: 125,
      signs: [
        'Beams fire on the beat. A gold line warns you one step ahead: cross between the pulses.',
        'Rings restore your double jump and dash in mid-air. Chain them to cross.',
        'Resonators ring on the beat. Wait for a ring to pass, then leap through the gold gap.'
      ],
      lint: {
        stand: [], open: [], openTop: false, skip: false,
        edges: [{ from: [56, 20], to: [89, 20], oneWay: true }],
        note: 'The ring chasm (x 57-88) is crossed by chaining the four refresh rings (jump, double jump, dash, ' +
          'ring, ...); the bots do not model refresh rings (w5.ring lint ignore). A branching search over double-jump ' +
          'delays, dash directions and steering with the SAFE model (velocities x0.97, run x0.95) lands 42% of all branches.'
      },
      meta: { brief: 'Lasers on Euclidean onsets, refresh rings, resonators with gaps, a crossbeam shaft.' }
    }, g);
  })();

  // ==================================================================== w5-4 Lissajous
  // Nodes that move on Lissajous curves (their dotted traces show the whole path). A slider over the
  // first pit, a bobber that lifts you up a sheer wall, a figure-eight over a deep pit, a spirograph of
  // three circling nodes turning like gears, a walkway of beat-locked pendulums, and a 3:2 Lissajous
  // ferry to the exit cliff. Gem 1 floats above the bobber's crest; gem 2 is in a cave under the wall
  // (shards lead into it); gem 3 is an expert fling from the ferry's far loop to a lone perch.
  (function () {
    var g = new Grid(224, 30);
    function liss(x, y, ax, ay, fx, fy, phase, period) {
      g.ent({ type: 'node', x: x, y: y, liss: { ax: ax, ay: ay, fx: fx, fy: fy, phase: phase, period: period } });
    }
    // ---- A. the slider
    g.fill(1, 21, 14, 29, '#');           // start floor (stand row 20)
    g.put(3, 20, 'P');
    g.put(7, 20, 'S');                    // sign 0: moving nodes
    liss(25, 17, 7, 0, 1, 1, 0, 4);       // slides x 18..32 on row 17
    g.line(19, 15, 31, 15, 5);
    g.fill(35, 21, 54, 29, '#');          // far floor (stand row 20), safe ground under the bobber
    g.put(39, 20, 'C');
    // ---- B. the bobber lifts you up a sheer wall
    liss(49, 12, 0, 5, 1, 1, 0, 3.2);     // rides rows 7..17
    g.fill(55, 6, 66, 29, '#');           // the wall (stand row 5): 15 rows, no second wall to climb
    g.line(49, 9, 49, 15, 4);
    g.put(49, 2, '1');                    // gem 1: fling straight up from the crest
    g.fill(55, 18, 55, 20, '%');          // gem 2: a fake wall at the foot of the climb
    g.fill(56, 18, 59, 20, '.');
    g.put(58, 20, '2');
    g.trail(0, 0, [[51, 20], [52, 20], [53, 20]]);
    g.put(60, 5, 'C');
    // ---- C. the figure-eight over a deep pit, an island after it
    liss(75, 14, 4, 3, 1, 2, 0, 4);
    g.ent({ type: 'text', x: 75, y: 8, text: '1 : 2', size: 16, role: 'accent' });
    g.ring(75, 14, 2.4, -150, -30, 4);
    g.fill(83, 17, 87, 18, '#');          // island (stand row 16)
    g.put(85, 16, 'C');
    // ---- D. the spirograph: three nodes on circles, a third of a turn apart
    liss(93, 12, 2.5, 2.5, 1, 1, 90, 3.6);
    g.ent({ type: 'text', x: 102, y: 6, text: '1 : 1', size: 16, role: 'accent' });
    liss(102, 12, 2.5, 2.5, 1, 1, 210, 3.6);
    liss(111, 12, 2.5, 2.5, 1, 1, 330, 3.6);
    g.ring(93, 12, 2.5, 0, 315, 6);
    g.ring(111, 12, 2.5, 0, 315, 6);
    g.fill(117, 19, 129, 29, '#');        // landing (stand row 18)
    g.put(121, 18, 'C');
    g.put(126, 18, 'S');                  // sign 1: pendulums
    // ---- E. the metronome walk: pendulums keep the bar (wait in the gaps, follow a bob, jump its return)
    g.fill(130, 19, 166, 29, '#');        // walkway (stand row 18)
    g.fill(130, 1, 166, 12, '#');         // the ceiling they hang from (the bobs sweep head height)
    g.ent({ type: 'w5.pendulum', x: 135, y: 13, len: 5.5, amp: 50, beats: 4, phase: 0 });
    g.ent({ type: 'w5.pendulum', x: 145, y: 13, len: 5.5, amp: 50, beats: 4, phase: 120 });
    g.ent({ type: 'w5.pendulum', x: 155, y: 13, len: 5.5, amp: 50, beats: 4, phase: 240 });
    g.trail(0, 0, [[131, 18], [140, 18], [150, 18], [160, 18]]);
    g.put(164, 18, 'C');
    // ---- F. the 3:2 ferry to the exit cliff
    liss(183, 12, 6, 4, 3, 2, 0, 7);
    g.ent({ type: 'text', x: 183, y: 5, text: '3 : 2', size: 16, role: 'accent' });
    g.ring(183, 12, 4.2, 200, 340, 6);
    g.fill(196, 14, 205, 29, '#');        // the exit cliff (stand row 13)
    g.put(201, 13, 'E');
    // gem 3: a lone perch far beyond the ferry's east loop
    g.fill(218, 9, 220, 9, '#');
    g.put(219, 8, '3');
    g.frame();

    level({
      id: 'w5-4', index: 4, boss: false,
      name: 'Lissajous',
      style: 'w5', music: 'w5',
      par: 135,
      signs: [
        'These nodes trace Lissajous curves. Follow the dotted path, and catch one as it swings close.',
        'Pendulums keep the bar. Run in behind a bob, then jump it as it swings back.'
      ],
      meta: { brief: 'Nodes on Lissajous curves: a slider, a bobber, a figure-eight, a spirograph, a 3:2 ferry.' }
    }, g);
  })();

  // ==================================================================== w5-5 Golden Angle
  // A vertical spiral climb up a stem. First the seed: a germination run whose three nodes sit where
  // Vogel's model puts the first seeds (r = c·√i, θ = i·137.5°). Then the stem: leaves grow up it, each
  // turned 137.5° (the golden angle) from the one below, so seen from the side leaf i sits at
  // x = cx + R·sin(i·137.5° + φ); leaves on the near side of the stem are one-way platforms, leaves on the
  // far side are orbit nodes. Every 20 rows the stem has a node of its own, a solid floor whose opening is
  // turned by the golden angle again, so the climb zig-zags; each floor holds a checkpoint. Crossbeams cut
  // the internodes on Euclidean onsets, and the summit is a seed head of eight nodes around the exit.
  // Gem 1 sits on an outlying leaf; gem 2 in a fake-walled alcove of the tower's west wall (shards point
  // at it); gem 3 is a seed thrown high above the germination run, at the very top of a vertical fling.
  (function () {
    var W = 80, H = 120, TX = 36, CX = TX + 22, R = 11.5;
    var g = new Grid(W, H);
    var GA = 137.50776405003785 * Math.PI / 180;
    var i, k;
    // ---- the germination run (bottom left): three seeds over a pit
    g.fill(1, 114, 9, 119, '#');          // start floor (stand row 113)
    g.put(3, 113, 'P');
    g.put(7, 113, 'S');                   // sign 0: the golden angle
    var seeds = [];
    for (i = 1; i <= 3; i++) {
      var sa = i * GA + 2.3, sr = 4.2 * Math.sqrt(i);
      var sx = Math.round(21 + sr * Math.cos(sa) * 1.5), sy = Math.round(106 + sr * Math.sin(sa) * 0.55);
      g.put(sx, sy, 'O');
      g.ring(sx, sy, 2.5, -160, -20, 3);
      seeds.push([sx, sy]);
    }
    // the westmost seed is the first one met on the run (seed 3 of the spiral)
    var firstSeed = seeds[0];
    for (i = 1; i < seeds.length; i++) if (seeds[i][0] < firstSeed[0]) firstSeed = seeds[i];
    g.fill(32, 114, TX + 2, 119, '#');    // the tower's doorstep (stand row 113)
    g.put(34, 113, 'C');
    // ---- the tower
    g.fill(TX, 1, TX + 1, 109, '#');      // west wall (the doorway is rows 110..113)
    g.fill(W - 3, 1, W - 2, H - 1, '#');  // east wall
    g.fill(TX, 114, W - 2, H - 1, '#');   // the root floor (stand row 113)
    var FLOORS = [94, 74, 54, 34];        // the stem's nodes: slab tops, two rows thick
    var holes = [];
    for (k = 0; k < FLOORS.length; k++) {
      var hx = Math.round(CX + 12.5 * Math.sin((k + 1) * GA + 2.2));
      hx = Math.max(TX + 5, Math.min(W - 8, hx));
      holes.push(hx);
      g.fill(TX + 2, FLOORS[k], W - 4, FLOORS[k] + 1, '#');
      g.fill(hx - 2, FLOORS[k], hx + 2, FLOORS[k] + 1, '.');
    }
    function nearFloor(y, d) {
      for (var q = 0; q < FLOORS.length; q++) if (y >= FLOORS[q] - d && y <= FLOORS[q] + 1 + d) return true;
      return false;
    }
    // ---- the spiral of leaves from row 110 up to row 37
    var leaves = [];
    for (i = 0; i < 34; i++) {
      var th = i * GA + 0.6;
      var x = Math.round(CX + R * Math.sin(th));
      var y = Math.round(110 - i * 2.5);
      if (y < 37) break;
      if (nearFloor(y, 2)) continue;
      var near = Math.cos(th) > -0.25 || nearFloor(y, 4);
      leaves.push({ x: x, y: y, near: near });
      if (near) g.fill(x - 1, y, x + 1, y, '=');
      else g.put(x, y - 1, 'O');
    }
    // shards: above every other leaf, tracing the spiral (arcs over the far-side nodes)
    for (k = 0; k < leaves.length; k += 2) {
      var lf = leaves[k];
      if (lf.near) g.shard(lf.x, lf.y - 2); else g.ring(lf.x, lf.y - 1, 2.5, -150, -30, 3);
    }
    // a checkpoint on every stem floor, clear of its opening, and shards rising through each opening
    for (k = 0; k < FLOORS.length; k++) {
      var cxp = holes[k] < CX ? holes[k] + 6 : holes[k] - 6;
      g.put(cxp, FLOORS[k] - 1, 'C');
      g.line(holes[k], FLOORS[k] + 0.5, holes[k], FLOORS[k] - 2, 2);
    }
    // crossbeams across three internodes, on staggered onsets, each on the row of its internode that is
    // clearest of leaves (no leaf to stand on within a row of it, no node orbit within two)
    function beamRow(lo, hi) {
      var best = lo, bestD = -1;
      for (var yy = lo; yy <= hi; yy++) {
        var d = 99;
        for (var q = 0; q < leaves.length; q++) {
          var lq = leaves[q];
          var dd = lq.near ? Math.abs((lq.y - 1) - yy) : Math.abs((lq.y - 1) - yy) - 1;
          if (dd < d) d = dd;
        }
        if (d > bestD) { bestD = d; best = yy; }
      }
      return best;
    }
    g.ent({ type: 'w5.laser', x: TX + 2, y: beamRow(80, 88), dir: 'right', pattern: [3, 8], rot: 0 });
    g.ent({ type: 'w5.laser', x: W - 4, y: beamRow(60, 68), dir: 'left', pattern: [3, 8], rot: 4 });
    g.ent({ type: 'w5.laser', x: TX + 2, y: beamRow(40, 48), dir: 'right', pattern: [2, 8], rot: 2 });
    // gem 1: an outlying leaf off the spiral, low in the second internode
    g.fill(TX + 3, 88, TX + 5, 88, '=');
    g.put(TX + 4, 87, '1');
    // gem 2: an alcove in the west wall behind a fake tile, shards pointing at it
    g.fill(TX, 69, TX + 1, 70, '%');
    g.fill(TX - 3, 69, TX - 1, 70, '.');
    g.fill(TX - 3, 71, TX + 1, 71, '#');
    g.fill(TX - 4, 68, TX - 1, 68, '#');
    g.fill(TX - 4, 69, TX - 4, 71, '#');
    g.put(TX - 2, 70, '2');
    g.trail(0, 0, [[TX + 3, 70], [TX + 5, 70]]);
    // ---- the seed head: eight nodes in Vogel's model around the exit
    var HX = CX, HY = 17, C = 3.6;
    for (var s2 = 1; s2 <= 8; s2++) {
      var a = s2 * GA + 1.1, r = C * Math.sqrt(s2);
      var nx = Math.round(HX + r * Math.cos(a)), ny = Math.round(HY + r * Math.sin(a));
      g.put(nx, ny, 'O');
      if (s2 % 2 === 0) g.ring(nx, ny, 2.4, 0, 300, 4);
    }
    g.fill(HX - 1, HY + 1, HX + 1, HY + 1, '#');
    g.put(HX, HY, 'E');
    // gem 3: a seed thrown as high as a seed can go, 13 rows straight above the first germination node.
    // Orbit it, let go at the top with {up} held, then double jump and dash up at the apex (GEM tier: one
    // row past the safe reach). A rising shard line marks the way; a miss falls back onto the nodes.
    g.put(firstSeed[0], firstSeed[1] - 13, '3');
    g.line(firstSeed[0], firstSeed[1] - 5, firstSeed[0], firstSeed[1] - 10, 3);
    g.frame();

    level({
      id: 'w5-5', index: 5, boss: false,
      name: 'Golden Angle',
      style: 'w5', music: 'w5',
      par: 150,
      signs: [
        'Each leaf turns 137.5° from the last: the golden angle. Climb the spiral to the seed head.'
      ],
      meta: { brief: 'A vertical spiral climb: leaves and nodes placed by phyllotaxis, a seed head at the top.' }
    }, g);
  })();

  // ==================================================================== w5-6 Resonance
  // Everything at once, all in time. A wave of frets under a firing beam, a cannon of side-boost rings
  // over a chasm, a resonator floor crossed on a figure-eight node, a ringing string under pendulums,
  // and the last climb: up-boost rings, a wave ladder and a Lissajous node to the gate of the Spire.
  // Gem 1 rides the cannon's arc; gem 2 hides under the string's east post behind a fake floor; gem 3 is
  // an expert fling from the final node to a lone perch.
  (function () {
    var g = new Grid(242, 34);
    function liss(x, y, ax, ay, fx, fy, phase, period) {
      g.ent({ type: 'node', x: x, y: y, liss: { ax: ax, ay: ay, fx: fx, fy: fy, phase: phase, period: period } });
    }
    // ---- A. frets under a beam
    g.fill(1, 25, 10, 33, '#');           // start floor (stand row 24)
    g.put(3, 24, 'P');
    g.put(7, 24, 'S');                    // sign 0
    g.wave(11, 25, { n: 10, w: 1.5, gap: 0.5, amp: 1.25, wavelength: 8, period: 2.0, dir: 'right', taper: 2 });
    g.fill(14, 1, 26, 15, '#');           // the beam's mount above the frets
    g.ent({ type: 'w5.laser', x: 20, y: 16, dir: 'down', pattern: [3, 8], rot: 0 });
    g.trail(0, 0, [[13, 22], [17, 21], [23, 21], [27, 22]]);
    g.fill(31, 25, 42, 33, '#');          // landing (stand row 24)
    g.put(37, 24, 'C');
    // ---- B. the ring cannon: side-boost rings fire you across the chasm
    g.put(40, 24, 'S');                   // sign 1: boost rings
    g.ent({ type: 'w5.ring', x: 46, y: 21, r: 1.5, dir: 'right', boost: 22 });
    g.ent({ type: 'w5.ring', x: 53.5, y: 22, r: 1.5, dir: 'right', boost: 22 });
    g.ent({ type: 'w5.ring', x: 61, y: 23, r: 1.5, dir: 'right', boost: 22 });
    g.line(48.5, 20.5, 51, 21.5, 2);
    g.line(56, 21.5, 58.5, 22.5, 2);
    g.line(63.5, 22.5, 66, 23.5, 2);
    g.put(50, 17, '1');                   // gem 1: double jump off the first ring's arc, fall into the second
    g.fill(69, 25, 95, 33, '#');          // landing (stand row 24)
    g.arc(70, 24, 1);
    g.put(82, 24, 'C');
    // ---- C. the resonator floor, crossed on a figure-eight node
    g.fill(96, 25, 120, 33, '#');
    g.put(108, 25, '.');
    g.ent({ type: 'w5.resonator', x: 108, y: 25, r: 5, every: 2, offset: 0, speed: 4, gap: 110, dir: 'up', spin: 0 });
    liss(108, 16, 5, 2, 1, 2, 0, 4.4);
    g.ring(108, 16, 2.6, 200, 340, 5);
    g.put(117, 24, 'C');
    // ---- D. the ringing string under pendulums (rest on the still points while the bobs pass)
    g.fill(121, 25, 122, 33, '#');        // post
    g.wave(123, 25, { n: 16, w: 1, amp: 1.25, period: 2.2, harmonic: 2 });
    g.fill(139, 25, 146, 33, '#');        // east post (stand row 24)
    g.fill(121, 1, 146, 17, '#');         // the ceiling they hang from (the bobs sweep a rider's head)
    g.ent({ type: 'w5.pendulum', x: 125, y: 18, len: 6.5, amp: 40, beats: 6, phase: 0 });
    g.ent({ type: 'w5.pendulum', x: 137, y: 18, len: 6.5, amp: 40, beats: 6, phase: 180 });
    g.trail(0, 0, [[124, 23], [131, 24], [138, 23]]);
    g.fill(143, 25, 144, 25, '%');        // gem 2: a fake floor in the east post, a cave below it
    g.fill(141, 26, 145, 27, '.');
    g.put(142, 27, '2');
    g.shard(143.5, 24); g.shard(143.5, 25);
    g.put(141, 24, 'C');
    // ---- E. the last climb: up-boost rings, a wave ladder, a Lissajous node, the gate
    g.fill(147, 25, 160, 33, '#');
    g.ent({ type: 'w5.ring', x: 152, y: 22, r: 1.5, dir: 'up', boost: 34 });
    g.fill(155, 18, 160, 24, '#');
    g.fill(161, 15, 172, 33, '#');        // first terrace (stand row 14)
    g.ent({ type: 'w5.ring', x: 167, y: 11, r: 1.5, dir: 'up', boost: 34 });
    g.line(152, 19, 152, 15, 3);
    g.fill(173, 9, 186, 33, '#');         // second terrace (stand row 8)
    g.put(178, 8, 'C');
    g.wave(187, 9, { n: 6, w: 1.5, gap: 0.5, amp: 1, wavelength: 6, period: 2.0, dir: 'right' });
    liss(204, 6, 3, 2, 1, 1, 90, 3.2);
    g.ring(204, 6, 2.6, 180, 360, 5);
    g.fill(210, 9, 222, 33, '#');         // the gate terrace (stand row 8)
    g.put(217, 8, 'E');
    g.trail(0, 0, [[189, 7], [193, 6], [197, 7], [212, 8], [214, 8]]);
    // gem 3: a lone perch 14 columns past the gate terrace (beyond the safe double-jump-and-dash reach)
    g.fill(237, 9, 239, 33, '#');
    g.put(238, 8, '3');
    g.frame();

    level({
      id: 'w5-6', index: 6, boss: false,
      name: 'Resonance',
      style: 'w5', music: 'w5',
      par: 170,
      signs: [
        'Everything here moves in time. Listen, count, and go on the beat.',
        'Boost rings throw you the way their arrows point. Fly through each one.'
      ],
      meta: { brief: 'The gauntlet: waves, beams, boost rings, resonators, Lissajous nodes and pendulums.' }
    }, g);
  })();

  // ==================================================================== w5-boss The Null
  // One screen of void: side walls, a flat floor two rows thick, nothing else. The Null (js/worlds/w5/
  // boss.js) reshapes it itself: sweeping arms (I), a gravity well with ring waves and two nodes (II),
  // the floor eaten into three floating islands under beat lasers (III), and the collapse, where three
  // nodes orbit the point and only a fling into the core will do (IV). The Vertex waits above the middle.
  (function () {
    var g = new Grid(30, 17);
    g.fill(1, 15, 28, 16, '#');           // the floor (stand row 14)
    g.put(3, 14, 'P');
    g.put(15, 5, 'n');                    // the Null
    g.put(15, 9, 'V');                    // the Vertex (dormant until the Null falls)
    g.frame();
    level({
      id: 'w5-boss', index: 7, boss: true,
      name: 'The Null',
      style: 'void', music: 'boss5',
      par: 150,
      legend: { n: 'w5.null' },
      signs: [],
      meta: { brief: 'The final boss: 12 hits over 4 phases, ending with orbit-and-fling into the core.' }
    }, g);
  })();
})(window.AP = window.AP || {});
