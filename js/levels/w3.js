/* js/levels/w3.js — owner: W3 */
(function (AP) {
  'use strict';

  // W3 — The Currents (Pentagon, form 5). Maps are drawn at load time by the small deterministic Grid helper
  // below (fill / put / text in tile coordinates), so every feature reads as one commented line.
  // Wind never decides a SAFE route on its own: tailwinds and gentle updrafts only help, headwinds stay
  // under 0.5 g over gaps of at most 4 tiles, and every lift or kite bounce the main path needs is
  // declared in lint.edges with a note (CONTRACT §4.5 rule 11).

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
  // a row of characters starting at (x, y)
  Grid.prototype.text = function (x, y, s) {
    for (var i = 0; i < s.length; i++) this.put(x + i, y, s.charAt(i));
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

  // shards along a list of [dx, dy] offsets from (x, y)
  function trail(g, x, y, offs) {
    for (var i = 0; i < offs.length; i++) g.put(x + offs[i][0], y + offs[i][1], '*');
  }
  // canonical arcs (tile offsets from the takeoff tile, CONTRACT §4.5 rule 6)
  var ARC_JUMP = [[1, -2], [2, -3], [3, -3], [4, -3], [5, -2]];
  var ARC_DJ = [[1, -2], [2, -3], [3, -4], [4, -5], [5, -5], [6, -5], [7, -4]];

  // ==================================================================== w3-1 Streamlines
  (function () {
    var g = new Grid(142, 26);
    // ---- A. tutorial room (hazard-free): a 4-tile wall that needs the double jump, then a wide safe gap
    g.fill(1, 20, 9, 25, '#');            // start floor (stand row 19)
    g.fill(10, 16, 13, 25, '#');          // the wall: rise 4 (double jump)
    g.fill(14, 20, 20, 25, '#');          // safe trench under the 7-wide gap (4 deep: double jump out)
    g.fill(21, 16, 34, 25, '#');          // landing plateau
    g.put(3, 19, 'P');
    g.put(6, 19, 'S');                    // sign 0: the double jump
    trail(g, 7, 19, [[1, -2], [2, -3], [3, -4], [4, -5]]);
    trail(g, 13, 15, [[2, -2], [4, -3], [6, -2]]);
    // ---- B. first wind: a steady tailwind across a bottomless 7-wide gap
    g.put(25, 15, 'C');
    g.put(29, 15, 'S');                   // sign 1: the wind
    g.fill(42, 16, 47, 18, '#');          // floating island
    trail(g, 34, 15, [[1, -2], [3, -3], [5, -3], [7, -2]]);
    g.fill(44, 12, 45, 12, '=');          // detour ledge up to gem 1
    g.put(45, 8, '1');
    g.fill(53, 15, 58, 17, '#');          // island (rise 1)
    trail(g, 47, 15, [[2, -2], [4, -2], [6, -1]]);
    // ---- C. spikes on a long ground, a gentle headwind over a 4-wide gap
    g.fill(63, 17, 82, 25, '#');          // long ground (stand row 16)
    g.put(66, 16, 'C');
    g.fill(73, 16, 75, 16, '^');          // first spikes
    trail(g, 71, 16, [[1, -2], [2, -3], [3, -3], [4, -3], [5, -2]]);
    g.fill(87, 17, 91, 19, '#');          // island after the headwind gap
    trail(g, 82, 16, [[1, -1], [2, -2], [3, -2], [4, -1]]);
    // ---- D. the updraft climb, and a secret pocket under it
    g.fill(92, 13, 94, 25, '#');          // pillar (rise 4)
    g.fill(97, 9, 99, 10, '#');           // floating ledge (rise 4)
    g.fill(95, 17, 101, 25, '#');         // pocket floor below the climb
    g.fill(102, 9, 113, 25, '#');         // summit plateau
    g.fill(102, 14, 102, 16, '%');        // secret wall into the plateau
    g.fill(103, 13, 108, 16, '.');        // the cave behind it
    g.put(106, 16, '2');
    g.put(105, 8, 'C');
    g.put(96, 16, 'S');                   // sign 2: updrafts
    trail(g, 97, 16, [[1, 0], [2, 0], [3, 0], [4, 0]]);
    trail(g, 93, 12, [[1, -2], [2, -3], [3, -4]]);
    // ---- E. crumble bridge, the final double jump with a tailwind, gem 3 above it all
    g.fill(114, 11, 119, 11, '~');        // crumble bridge
    g.fill(120, 12, 124, 25, '#');        // pillar
    g.fill(133, 13, 140, 25, '#');        // exit ground
    g.put(138, 12, 'E');
    trail(g, 114, 10, [[0, 0], [2, 0], [4, 0]]);
    trail(g, 124, 11, [[1, -2], [2, -3], [3, -4], [4, -4], [5, -4], [6, -3], [7, -2]]);
    g.fill(122, 6, 124, 6, '#');          // gem 3 perch (8-wide gap from the summit: GEM tier)
    g.put(123, 5, '3');
    g.frame();

    AP.Levels.register({
      id: 'w3-1', world: 3, index: 1, boss: false,
      name: 'Streamlines',
      form: 5, style: 'w3', music: 'w3',
      par: 80,
      map: g.rows(),
      legend: {},
      flow: { seed: 11, scale: 12, angle: 0, spread: 50, tscale: 0.12, mmin: 0.4 },
      entities: [
        { type: 'w3.wind', x: 31, y: 6, w: 14, h: 11, strength: 32, speed: 15, flow: { angle: 0, spread: 22, mmin: 0.55 } },
        { type: 'w3.wind', x: 80, y: 10, w: 9, h: 7, strength: 26, speed: 12, flow: { angle: 180, spread: 20, mmin: 0.6 } },
        { type: 'w3.wind', x: 92, y: 2, w: 10, h: 15, strength: 52, speed: 14, flow: { angle: -90, spread: 24, mmin: 0.6 } },
        { type: 'w3.wind', x: 121, y: 5, w: 13, h: 8, strength: 30, speed: 15, flow: { angle: 0, spread: 18, mmin: 0.6 } }
      ],
      signs: [
        'Press {jump} in mid-air to jump again.',
        'Streamlines draw the wind. A tailwind carries you; let go of {left} {right} and drift.',
        'Rising lines are updrafts: they lift every jump.'
      ],
      lint: { stand: [], open: [], edges: [], openTop: false, skip: false, note: '' },
      meta: { brief: 'Teach the double jump in a hazard-free room, then gentle steady winds.' }
    });
  })();

  // ==================================================================== w3-2 Updraft
  // A vertical climb: the first lift, a field of kites, a zig-zag chimney lift lined with spikes, and a crown
  // of kites under the final lift.
  (function () {
    var g = new Grid(44, 96);
    // ---- 1. the floor of the world and the first lift
    g.fill(1, 92, 42, 95, '#');           // ground (stand row 91)
    g.put(4, 91, 'P');
    g.put(7, 91, 'S');                    // sign 0: lifts
    trail(g, 13, 0, [[0, 89], [0, 86], [0, 83], [0, 80]]);
    // ---- the basement secret under the kite field
    g.fill(36, 82, 42, 91, '#');
    g.fill(36, 89, 36, 91, '%');          // fake wall
    g.fill(37, 88, 41, 91, '.');          // the cave
    g.put(40, 91, '2');
    trail(g, 0, 91, [[25, 0], [28, 0], [31, 0], [34, 0]]);
    // ---- 2. the kite field (kites fly above stakes on the field)
    g.fill(16, 79, 42, 81, '#');          // the field (stand row 78)
    g.put(18, 78, 'C');
    g.put(21, 78, 'S');                   // sign 1: kite stomp
    trail(g, 0, 0, [[15, 76], [17, 76], [23, 75], [24, 73], [28, 71], [29, 69], [33, 67], [34, 65]]);
    g.put(40, 61, '1');                   // gem 1: a visible detour above the top kite
    g.fill(18, 63, 29, 64, '#');          // ledge under the chimney (stand row 62)
    g.put(27, 62, 'C');
    trail(g, 0, 0, [[33, 63], [31, 61]]);
    // ---- 3. the chimney: a lift through a zig-zag shaft lined with spikes
    g.fill(1, 30, 20, 46, '#');           // upper-left mass (the upper shaft's left wall and the overhang)
    g.fill(1, 47, 17, 62, '#');           // lower-left mass (the lower shaft's left wall)
    g.fill(18, 47, 20, 47, 'v');          // spikes under the overhang: steer right before them
    g.fill(23, 47, 23, 59, '#');          // lower shaft right wall (the entrance is rows 60-62)
    g.fill(24, 47, 42, 55, '#');          // right mass, low
    g.fill(26, 33, 42, 46, '#');          // right mass, high (its top is the crown ledge)
    g.fill(25, 36, 25, 39, '<');          // upper shaft: spikes on the right wall
    g.fill(21, 31, 21, 33, '>');          // then on the left wall near the top
    trail(g, 0, 0, [[20, 58], [20, 54], [21, 50], [22, 46], [22, 42], [23, 38], [23, 34], [25, 31]]);
    // ---- 4. the crown: kites up to a last lift and the exit
    g.put(30, 32, 'C');
    g.fill(29, 21, 33, 22, '#');          // ledge between the kites and the last lift
    g.fill(38, 15, 41, 15, '#');          // gem 3 perch: a 6-tile double-jump rise (GEM tier)
    g.put(40, 14, '3');
    g.fill(1, 10, 16, 29, '#');           // left cliff under the exit
    g.fill(17, 8, 23, 9, '#');            // exit platform
    g.put(19, 7, 'E');
    trail(g, 0, 0, [[35, 30], [37, 27], [39, 24], [37, 21], [35, 20], [26, 17], [26, 13], [26, 9], [24, 6]]);
    g.frame();

    var kiteFlow = { angle: 0, spread: 85, tscale: 0.28, mmin: 0.3 };
    AP.Levels.register({
      id: 'w3-2', world: 3, index: 2, boss: false,
      name: 'Updraft',
      form: 5, style: 'w3', music: 'w3',
      par: 95,
      map: g.rows(),
      legend: {},
      flow: { seed: 23, scale: 9, angle: -90, spread: 70, tscale: 0.14, mmin: 0.35 },
      entities: [
        // lifts (strong updrafts: they carry you)
        { type: 'w3.wind', x: 11, y: 77, w: 5, h: 15, strength: 115, speed: 20, flow: { angle: -90, spread: 10, mmin: 0.9 } },
        { type: 'w3.wind', x: 18, y: 45, w: 5, h: 18, strength: 118, speed: 19, flow: { angle: -90, spread: 8, mmin: 0.9 } },
        { type: 'w3.wind', x: 21, y: 29, w: 5, h: 18, strength: 118, speed: 19, flow: { angle: -90, spread: 8, mmin: 0.9 } },
        { type: 'w3.wind', x: 24, y: 6, w: 5, h: 15, strength: 120, speed: 20, flow: { angle: -90, spread: 10, mmin: 0.9 } },
        // breezes over the kite fields (the kites sway in exactly these currents)
        { type: 'w3.wind', x: 16, y: 56, w: 27, h: 23, strength: 22, speed: 12, flow: kiteFlow },
        { type: 'w3.wind', x: 30, y: 16, w: 13, h: 17, strength: 22, speed: 12, flow: kiteFlow },
        // kites
        { type: 'w3.kite', x: 25, y: 75, w: 2, len: 4, swing: 18, flow: kiteFlow },
        { type: 'w3.kite', x: 31, y: 71, w: 2, len: 8, swing: 10, flow: kiteFlow },
        { type: 'w3.kite', x: 36, y: 67, w: 2, len: 12, swing: 7, flow: kiteFlow },
        { type: 'w3.kite', x: 36, y: 29, w: 2, len: 4, swing: 18, flow: kiteFlow },
        { type: 'w3.kite', x: 40, y: 25, w: 2, len: 8, swing: 10, flow: kiteFlow }
      ],
      signs: [
        'Rising lines are a lift. Walk in, ride it up, and steer out at the top.',
        'Hold {down} as you land on a kite to stomp it: it catches the wind and flings you high.'
      ],
      lint: {
        stand: [],
        open: [],
        edges: [
          { from: [13, 91], to: [18, 78], oneWay: true },
          { from: [20, 62], to: [28, 32], oneWay: true },
          { from: [30, 20], to: [20, 7], oneWay: true }
        ],
        openTop: false, skip: false,
        note: 'The three edges are wind lifts (w3.wind updrafts of about 1.5 g that carry the player up their columns); ' +
          'the bot ignores wind. Kites are modelled at rest (lint stand); they sway at most ~1.3 tiles.'
      },
      meta: { brief: 'Vertical lifts; kites you can stomp for a bounce.' }
    });
  })();

  // ==================================================================== w3-3 Eddies
  // Drift rafts riding the currents. A raft in a steady current sits downstream of its leash; a raft caught in an
  // eddy circles the eddy's eye (it is advected by the very flow the zone draws). Teach a raft over a safe trench,
  // then one eddy carousel up to a ledge, then counter-spinning "gears" over a pit, a chimney of three stacked
  // eddies over spikes, and a last line of carousels to the exit. The bot sees every raft at its home (the centre of
  // its orbit); every hop is ROUTINE from home, so the moving raft is always reachable with timing.
  (function () {
    var g = new Grid(148, 38);
    // ---- A. start and the first raft (a gentle current over a safe trench)
    g.fill(1, 30, 14, 37, '#');           // start floor (stand row 29)
    g.fill(15, 34, 25, 37, '#');          // safe trench floor, 4 deep (double jump out)
    g.fill(26, 30, 33, 37, '#');          // ledge A
    g.put(3, 29, 'P');
    g.put(7, 29, 'S');                    // sign 0: rafts
    trail(g, 14, 29, [[1, -1], [2, -2]]);
    trail(g, 20, 29, [[1, -2], [2, -2.5], [3, -2.5], [4, -2], [5, -1]].map(function (o) { return [o[0], Math.round(o[1])]; }));
    // ---- A2. the first eddy: its carousel lifts you to a ledge 7 tiles up
    g.fill(34, 34, 45, 37, '#');          // safe floor under the eddy
    g.put(29, 29, 'S');                   // sign 1: eddies
    trail(g, 33, 29, [[1, -2], [2, -3], [3, -4]]);
    trail(g, 42, 26, [[1, -2], [2, -3], [3, -4]]);
    // ---- B. checkpoint, then counter-spinning gears over a pit
    g.fill(46, 23, 53, 37, '#');          // high ledge H1 (stand row 22)
    g.put(47, 22, 'C');
    g.put(51, 22, 'S');                   // sign 2: gears
    trail(g, 54, 22, [[0, -1], [1, -2], [2, -2]]);
    trail(g, 60, 22, [[1, -2], [2, -2], [3, -2]]);
    g.fill(68, 18, 69, 18, '#');          // gem 1 perch above the second gear
    g.put(68, 17, '1');
    g.fill(72, 23, 80, 37, '#');          // landing L2 (stand row 22)
    g.put(76, 22, 'C');
    trail(g, 67, 21, [[1, -1], [2, -1], [3, 0]]);
    // ---- C. the chimney: three stacked eddies over spikes; a secret cave in its left wall
    g.fill(76, 6, 79, 16, '#');           // the chimney's left wall
    g.fill(77, 11, 78, 13, '.');          // the cave
    g.fill(79, 11, 79, 13, '%');          // its fake face
    g.put(77, 13, '2');
    g.fill(81, 30, 94, 37, '#');          // spike floor under the chimney
    g.fill(81, 29, 94, 29, '^');
    g.fill(88, 9, 100, 10, '#');          // top ledge T (stand row 8)
    trail(g, 0, 0, [[84, 17], [86, 15], [88, 14]]);
    trail(g, 0, 0, [[88, 12], [86, 11], [85, 10]]);
    trail(g, 0, 0, [[81, 10], [80, 11]]);  // a shard line into the fake wall (gem 2 hint)
    // ---- D. a long line of carousels to the exit; gem 3 is a 9-tile leap from T to a high perch
    g.fill(104, 14, 109, 16, '#');        // ledge D1 (stand row 13)
    g.put(106, 13, 'C');
    g.fill(110, 9, 111, 9, '#');          // gem 3 perch (dy 0, gap 9 from T: GEM tier)
    g.put(110, 8, '3');
    trail(g, 100, 8, [[3, -3], [6, -3]]);
    g.fill(131, 14, 146, 16, '#');        // exit ledge X (stand row 13)
    g.fill(131, 17, 134, 37, '#');
    g.put(142, 13, 'E');
    trail(g, 101, 8, [[1, 1], [2, 2], [3, 3]]);
    trail(g, 109, 13, [[1, -1], [2, -2], [3, -2]]);
    trail(g, 115, 12, [[1, -1], [2, -2], [3, -2]]);
    trail(g, 121, 11, [[1, -1], [2, -1], [3, 0]]);
    trail(g, 127, 12, [[1, -1], [2, -1], [3, 0]]);
    g.frame();

    // eddy flows (spec units). The zone, its raft and its streamlines read the same params.
    function eddy(seed, cx, cy, R, k) { return { seed: seed, angle: 0, spread: 180, mmin: 0, tscale: 0.08, scale: 8, swirl: [cx, cy, R, k] }; }
    var fA = { seed: 11, angle: 0, spread: 25, mmin: 0.7, tscale: 0.2 };
    var fE1 = eddy(31, 40.5, 27.4, 6, 1);
    var fG1 = eddy(41, 58.5, 23.4, 4.5, 1), fG2 = eddy(43, 65.5, 22.4, 4.5, -1);
    var fC1 = eddy(51, 83.5, 20.4, 3.5, 1), fC2 = eddy(53, 90.5, 16.4, 3.5, -1), fC3 = eddy(55, 83.5, 12.4, 3.5, 1);
    var fDa = eddy(61, 114.5, 13.4, 3.5, 1), fDb = eddy(63, 120.5, 11.4, 3, -1), fDc = eddy(65, 126.5, 13.4, 3.5, 1);
    AP.Levels.register({
      id: 'w3-3', world: 3, index: 3, boss: false,
      name: 'Eddies',
      form: 5, style: 'w3', music: 'w3',
      par: 105,
      map: g.rows(),
      legend: {},
      flow: { seed: 37, scale: 10, angle: 0, spread: 120, tscale: 0.1, mmin: 0.3 },
      entities: [
        // A: the first raft, a gentle current
        { type: 'w3.wind', x: 15, y: 22, w: 11, h: 12, strength: 14, speed: 8, flow: fA },
        { type: 'w3.drift', x: 16, y: 30, w: 3, leash: 1.5, speed: 3, flow: fA },
        // A2: the first eddy
        { type: 'w3.wind', x: 34, y: 21, w: 13, h: 13, strength: 20, speed: 10, flow: fE1 },
        { type: 'w3.drift', x: 39, y: 27, w: 3, leash: 2, speed: 6, flow: fE1 },
        // B: gears
        { type: 'w3.wind', x: 54, y: 18, w: 9, h: 11, strength: 20, speed: 10, flow: fG1 },
        { type: 'w3.drift', x: 57, y: 23, w: 3, leash: 1.8, speed: 6, flow: fG1 },
        { type: 'w3.wind', x: 63, y: 17, w: 9, h: 11, strength: 20, speed: 10, flow: fG2 },
        { type: 'w3.drift', x: 64, y: 22, w: 3, leash: 1.8, speed: 6, flow: fG2 },
        // C: the chimney
        { type: 'w3.wind', x: 80, y: 17, w: 7, h: 7, strength: 22, speed: 10, flow: fC1 },
        { type: 'w3.drift', x: 82, y: 20, w: 3, leash: 1.6, speed: 6, flow: fC1 },
        { type: 'w3.wind', x: 87, y: 13, w: 7, h: 7, strength: 22, speed: 10, flow: fC2 },
        { type: 'w3.drift', x: 89, y: 16, w: 3, leash: 1.6, speed: 6, flow: fC2 },
        { type: 'w3.wind', x: 80, y: 9, w: 7, h: 6, strength: 22, speed: 10, flow: fC3 },
        { type: 'w3.drift', x: 82, y: 12, w: 3, leash: 1.6, speed: 6, flow: fC3 },
        // D: the last carousels
        { type: 'w3.wind', x: 111, y: 10, w: 7, h: 8, strength: 22, speed: 10, flow: fDa },
        { type: 'w3.drift', x: 113, y: 13, w: 3, leash: 1.6, speed: 6, flow: fDa },
        { type: 'w3.wind', x: 118, y: 8, w: 6, h: 7, strength: 22, speed: 10, flow: fDb },
        { type: 'w3.drift', x: 119, y: 11, w: 3, leash: 1.4, speed: 6, flow: fDb },
        { type: 'w3.wind', x: 124, y: 10, w: 7, h: 8, strength: 22, speed: 10, flow: fDc },
        { type: 'w3.drift', x: 125, y: 13, w: 3, leash: 1.6, speed: 6, flow: fDc }
      ],
      signs: [
        'Rafts ride the current. Watch the little vane: it points downstream. Hop on and let it carry you.',
        'Eddies spin the air. A raft caught in one circles the eye; ride it around to the top.',
        'Neighbouring eddies turn opposite ways, like gears. Jump when two rafts swing close.'
      ],
      lint: {
        stand: [], open: [], edges: [],
        openTop: false, skip: false,
        note: ''
      },
      meta: { brief: 'Swirl vortices; drift platforms riding the currents.' }
    });
  })();

  // ==================================================================== w3-4 Turbulence
  // Gusts pulse with a period (the streamlines brighten for 0.75 s before each one) and drifters ride the currents.
  // Teach drifters over a flat floor; a gust leap over a safe trench (the trench is the slow way round); a gust shaft
  // whose one-way rest ledges are 7 tiles apart (one gust = one floor); a stair descent through a river of
  // streaming drifters; a gust leap over a pit with a swaying kite as the patient alternative; a turbulent finale.
  (function () {
    var g = new Grid(170, 40);
    // ---- A. start; drifters over a flat floor
    g.fill(1, 32, 40, 39, '#');           // floor (stand row 31)
    g.put(3, 31, 'P');
    g.put(6, 31, 'S');                    // sign 0: drifters
    trail(g, 12, 31, [[1, -2], [2, -3], [3, -4], [4, -3]]);
    trail(g, 25, 31, [[1, -2], [2, -3], [3, -3]]);
    g.put(15, 29, 'd'); g.put(22, 28, 'd'); g.put(29, 29, 'd');   // drifters over the floor
    // ---- B. gusts: a gust leap over a safe trench, then the gust shaft
    g.put(40, 31, 'C');
    g.put(35, 31, 'S');                   // sign 1: gusts
    g.fill(41, 36, 50, 39, '#');          // the trench (stand row 35): the slow way round
    g.fill(51, 32, 63, 39, '#');          // landing B2 and the shaft floor
    trail(g, 40, 31, [[2, -2], [4, -3], [7, -3], [10, -1]]);
    g.fill(58, 3, 58, 28, '#');           // shaft: left wall (entrance rows 29-31)
    g.fill(64, 11, 64, 39, '#');          // shaft: right wall
    g.fill(65, 11, 72, 12, '#');          // top ledge T (stand row 10)
    g.fill(59, 25, 61, 25, '=');          // rest ledges, 7 rows apart (one gust each)
    g.fill(61, 18, 63, 18, '=');
    trail(g, 0, 0, [[61, 29], [62, 22], [62, 20], [60, 13], [61, 9]]);
    g.put(61, 6, '1');                    // gem 1: ride a gust past the top (or jump back from T)
    // ---- C. checkpoint; a stair descent through a river of drifters; a secret cave under the last stair
    g.put(66, 10, 'C');
    g.fill(74, 14, 78, 15, '#');          // stairs
    g.fill(81, 17, 85, 18, '#');
    g.fill(88, 20, 92, 21, '#');
    g.fill(95, 23, 99, 24, '#');
    g.fill(104, 26, 112, 31, '#');        // s5 (stand row 25)
    g.fill(73, 38, 103, 39, '#');         // spike floor below the stairs
    g.fill(73, 37, 103, 37, '^');
    trail(g, 72, 10, [[2, 2], [3, 3]]);
    trail(g, 78, 13, [[1, 0], [2, 2]]);
    trail(g, 85, 16, [[1, 0], [2, 2]]);
    trail(g, 92, 19, [[1, 0], [2, 2]]);
    trail(g, 99, 22, [[1, 0], [3, 2]]);
    g.fill(100, 31, 103, 32, '#');        // the secret ledge under s4
    g.fill(106, 29, 110, 30, '.');        // the cave inside s5
    g.fill(104, 29, 105, 30, '%');
    g.put(109, 30, '2');
    trail(g, 0, 0, [[100, 26], [101, 28], [102, 30]]);   // a shard line down to the hidden ledge
    // ---- D. checkpoint; the gust leap over a pit (a kite sways below); turbulence and drifters; the exit
    g.put(106, 25, 'C');
    g.fill(124, 26, 131, 31, '#');        // D2 (stand row 25)
    g.fill(117, 30, 118, 39, '#');        // the kite's stone stake in the pit
    g.put(128, 25, 'C');
    trail(g, 113, 25, [[1, -2], [3, -3], [5, -3], [7, -3], [9, -2]]);
    g.fill(134, 24, 135, 31, '#');        // turbulent pillars
    g.fill(139, 22, 140, 31, '#');
    g.fill(144, 24, 145, 31, '#');
    g.fill(149, 21, 150, 31, '#');
    g.fill(154, 23, 155, 31, '#');
    g.fill(158, 24, 168, 31, '#');        // exit ledge
    g.put(165, 23, 'E');
    g.fill(163, 18, 164, 18, '#');        // gem 3 perch: rise 5, gap 7 from the last pillar (GEM tier)
    g.put(163, 17, '3');
    trail(g, 131, 25, [[1, -1], [2, -2]]);
    trail(g, 135, 23, [[1, -1], [2, -2]]);
    trail(g, 140, 21, [[1, -1], [3, 0]]);
    trail(g, 145, 23, [[1, -2], [2, -3]]);
    trail(g, 150, 20, [[1, -1], [3, 0]]);
    g.put(137, 20, 't'); g.put(142, 17, 't'); g.put(147, 20, 't'); g.put(152, 17, 't');   // turbulent drifters
    g.frame();

    var fA = { seed: 21, angle: 0, spread: 60, mmin: 0.4, tscale: 0.25 };
    var fG = { seed: 22, angle: 0, spread: 10, mmin: 0.85 };
    var fS = { seed: 23, angle: -90, spread: 8, mmin: 0.9 };
    var fR = { seed: 24, angle: 21, spread: 14, mmin: 0.75, tscale: 0.15 };
    var fG2 = { seed: 25, angle: 0, spread: 12, mmin: 0.85 };
    var fT = { seed: 26, angle: 0, spread: 180, mmin: 0.2, tscale: 0.6, scale: 5 };
    var gust = { mode: 'gust', period: 3.4, duty: 0.55 };
    function river(delay) { return { type: 'w3.drifter', x: 75, y: 11.5, mode: 'stream', range: 36, speed: 4, reform: 2.4, delay: delay, flow: fR }; }
    AP.Levels.register({
      id: 'w3-4', world: 3, index: 4, boss: false,
      name: 'Turbulence',
      form: 5, style: 'w3', music: 'w3',
      par: 115,
      map: g.rows(),
      legend: { d: { type: 'w3.drifter', speed: 2, leash: 1.5, flow: fA }, t: { type: 'w3.drifter', speed: 3, leash: 2.5, flow: fT } },
      flow: { seed: 29, scale: 10, angle: 0, spread: 90, tscale: 0.12, mmin: 0.3 },
      entities: [
        // A: a breeze and three drifters over the floor
        { type: 'w3.wind', x: 12, y: 24, w: 23, h: 8, strength: 10, speed: 8, flow: fA },
        // B: the first gust (its zone starts at the ledge's last tile: wait outside it)
        { type: 'w3.wind', x: 40, y: 22, w: 12, h: 10, strength: 70, speed: 20, mode: 'gust', period: 3.4, duty: 0.55, flow: fG },
        // B: the gust shaft
        { type: 'w3.wind', x: 59, y: 2, w: 5, h: 30, strength: 125, speed: 20, mode: 'gust', period: 3.2, duty: 0.5, flow: fS },
        // C: the river of drifters along the stairs
        { type: 'w3.wind', x: 73, y: 8, w: 31, h: 18, strength: 16, speed: 10, flow: fR },
        river(0.1), river(2.1), river(4.1), river(6.1), river(8.1), river(10.1),
        // D: the second gust over the pit, and a kite swaying in it
        { type: 'w3.wind', x: 112, y: 17, w: 13, h: 9, strength: 70, speed: 20, mode: 'gust', period: 3.4, duty: 0.55, phase: 120, flow: fG2 },
        { type: 'w3.kite', x: 117, y: 26, w: 2, len: 3.8, swing: 16, mode: 'gust', period: 3.4, duty: 0.55, phase: 120, flow: fG2 },
        // D: turbulence
        { type: 'w3.wind', x: 132, y: 12, w: 26, h: 14, strength: 16, speed: 10, flow: fT }
      ],
      signs: [
        'Drifters ride the streamlines. Land on one to pop it, or pop it with the star of a double jump.',
        'Gusts pulse. When the streamlines brighten, a gust is coming: leap with it.'
      ],
      lint: {
        stand: [], open: [],
        edges: [
          { from: [61, 31], to: [60, 24], oneWay: true },
          { from: [60, 24], to: [62, 17], oneWay: true },
          { from: [62, 17], to: [66, 10], oneWay: true }
        ],
        openTop: false, skip: false,
        note: 'The three edges are the gust shaft (a w3.wind updraft of about 1.7 g that pulses every 3.2 s): each gust ' +
          'lifts the player 9-12 tiles from one one-way rest ledge to the next, 7 tiles up; the bot ignores wind.'
      },
      meta: { brief: 'Gusts that pulse with a period; Drifters.' }
    });
  })();

  // ==================================================================== w3-5 The Doldrums
  // Where the wind turns. Reversing currents flicker before they flip, and everything in a scene turns with them:
  // streamlines, rafts and kites read the same params. A two-tier climb: right along the bottom over a ferry raft,
  // up a reversing lift (it rises, stalls, then pushes down: rest on its one-way ledges while it does), left along
  // the upper tier on a second ferry over the abyss, up past a kite and an eddy carousel, and right along a top
  // corridor of reversing wind and drifters to the exit. The bot sees each raft and kite at rest (the ferry's
  // midpoint); every hop is ROUTINE from there.
  (function () {
    var g = new Grid(68, 60);
    // ---- A. bottom tier: start, the first ferry over a safe trench
    g.fill(32, 52, 39, 59, '#');          // A1 (stand row 51)
    g.put(34, 51, 'P');
    g.put(37, 51, 'S');                   // sign 0: reversing wind
    g.fill(40, 56, 51, 59, '#');          // safe trench (stand row 55)
    g.fill(52, 52, 66, 59, '#');          // A3 and the shaft floor (stand row 51)
    g.put(55, 51, 'C');
    g.fill(50, 48, 51, 48, '#');          // gem 1 perch over the ferry's far end
    g.put(50, 47, '1');
    trail(g, 39, 51, [[1, -1], [2, -2], [3, -2]]);
    trail(g, 47, 51, [[1, -2], [2, -3], [3, -3], [4, -2]]);
    // ---- B. the reversing lift; a secret cave in its left wall
    g.fill(59, 30, 62, 48, '#');          // the shaft's left wall (entrance rows 49-51)
    g.fill(59, 40, 61, 41, '.');          // the cave
    g.fill(62, 40, 62, 41, '%');
    g.put(60, 41, '2');
    g.fill(63, 45, 64, 45, '=');          // rest ledges
    g.fill(65, 38, 66, 38, '=');
    trail(g, 0, 0, [[64, 49], [64, 47], [66, 42], [64, 41], [63, 41], [66, 35], [65, 31], [62, 27]]);
    // ---- C. upper tier: checkpoint, the second ferry over the abyss
    g.fill(32, 32, 58, 35, '#');          // U1 (stand row 31)
    g.put(48, 31, 'C');
    g.put(37, 31, 'S');                   // sign 1: the ferry
    g.fill(2, 32, 19, 35, '#');           // U2 (stand row 31)
    g.put(16, 31, 'C');
    trail(g, 31, 31, [[-1, -1], [-2, -2], [-3, -2]]);
    trail(g, 23, 31, [[-1, -1], [-2, -2], [-3, -2]]);
    // ---- D. the climb, four rises of 3-4: a ledge, a kite swaying in a fitful breeze, a ledge, an eddy carousel
    g.fill(13, 28, 17, 29, '#');          // V0 (stand row 27)
    g.fill(1, 21, 3, 22, '#');            // V1 (stand row 20)
    g.fill(11, 13, 22, 14, '#');          // V2 (stand row 12)
    g.put(16, 12, 'C');
    trail(g, 0, 0, [[18, 30], [17, 27], [12, 26], [10, 25]]);
    trail(g, 0, 0, [[5, 22], [4, 20], [5, 18], [8, 15], [10, 13]]);
    // ---- E. the top corridor: reversing wind, drifters, a carousel, a kite; gem 3 off the kite (GEM tier)
    g.fill(26, 13, 28, 13, '=');          // cloud 1
    g.fill(39, 14, 41, 14, '=');          // cloud 2
    g.fill(45, 15, 46, 16, '#');          // the kite's anchor stone
    g.fill(51, 13, 66, 14, '#');          // exit ledge X (stand row 12)
    g.put(57, 12, 'E');
    g.fill(54, 7, 55, 7, '#');            // gem 3 perch: rise 5, gap 7 from the kite
    g.put(54, 6, '3');
    trail(g, 22, 12, [[1, -2], [2, -3], [3, -3]]);
    trail(g, 28, 12, [[1, -2], [2, -2], [3, -2]]);
    trail(g, 34, 11, [[1, -1], [2, -1], [3, 0], [4, 1]]);
    trail(g, 41, 13, [[1, -1], [2, -2], [3, -2]]);
    trail(g, 46, 11, [[1, -1], [2, -1], [3, 0]]);
    g.put(28, 9, 'd'); g.put(43, 9, 'd'); g.put(49, 9, 'd');      // drifters turning with the corridor wind
    g.frame();
    // the abyss: open bottom left of the bottom tier
    for (var x = 1; x < 32; x++) g.put(x, 59, '.');

    var rev = function (o, period, phase) { o.mode = 'reverse'; o.period = period; o.phase = phase || 0; return o; };
    var fF1 = { seed: 51, angle: 0, spread: 10, mmin: 0.9 };
    var fL = { seed: 52, angle: -90, spread: 8, mmin: 0.9 };
    var fF2 = { seed: 53, angle: 0, spread: 12, mmin: 0.9 };
    var fK = { seed: 54, angle: 0, spread: 140, mmin: 0.5, tscale: 0.35 };
    var fT = { seed: 58, angle: 0, spread: 14, mmin: 0.75 };
    function eddy(seed, cx, cy, R, k) { return { seed: seed, angle: 0, spread: 180, mmin: 0, tscale: 0.08, scale: 8, swirl: [cx, cy, R, k] }; }
    var fCE = eddy(55, 7.5, 17.4, 3.5, 1), fTR = eddy(57, 33.5, 12.4, 3.5, -1);
    AP.Levels.register({
      id: 'w3-5', world: 3, index: 5, boss: false,
      name: 'The Doldrums',
      form: 5, style: 'w3', music: 'w3',
      par: 125,
      map: g.rows(),
      legend: { d: rev({ type: 'w3.drifter', speed: 2.5, leash: 2, flow: fT }, 8, 90) },
      flow: { seed: 59, scale: 10, angle: 0, spread: 120, tscale: 0.1, mmin: 0.3 },
      entities: [
        // A: the first ferry, in a reversing current over the trench
        rev({ type: 'w3.wind', x: 40, y: 44, w: 12, h: 12, strength: 12, speed: 8, flow: fF1 }, 7),
        rev({ type: 'w3.drift', x: 44, y: 52, w: 3, leash: 3, speed: 3, flow: fF1 }, 7),
        // B: the reversing lift (up ~2.8 s, stall, down ~2.8 s)
        rev({ type: 'w3.wind', x: 63, y: 22, w: 4, h: 30, strength: 120, speed: 20, tel: 0.8, flow: fL }, 6.4),
        // C: the second ferry over the abyss (the gap's wind is a gentle 0.37 g, either way)
        rev({ type: 'w3.wind', x: 18, y: 24, w: 16, h: 9, strength: 28, speed: 12, flow: fF2 }, 8, 180),
        rev({ type: 'w3.drift', x: 24, y: 32, w: 3, leash: 3.5, speed: 3.5, flow: fF2 }, 8, 180),
        // D: a kite in a fitful breeze, an eddy carousel
        { type: 'w3.wind', x: 4, y: 21, w: 9, h: 11, strength: 14, speed: 8, flow: fK },
        { type: 'w3.kite', x: 6, y: 25, w: 2, len: 6.8, swing: 13, flow: fK },
        { type: 'w3.wind', x: 4, y: 13, w: 7, h: 8, strength: 22, speed: 10, flow: fCE },
        { type: 'w3.drift', x: 6, y: 17, w: 3, leash: 1.6, speed: 6, flow: fCE },
        // E: the top corridor
        rev({ type: 'w3.wind', x: 23, y: 3, w: 7, h: 11, strength: 24, speed: 12, flow: fT }, 8, 90),
        { type: 'w3.wind', x: 30, y: 8, w: 7, h: 9, strength: 22, speed: 10, flow: fTR },
        { type: 'w3.drift', x: 32, y: 12, w: 3, leash: 1.6, speed: 6, flow: fTR },
        rev({ type: 'w3.wind', x: 37, y: 3, w: 14, h: 11, strength: 24, speed: 12, flow: fT }, 8, 90),
        rev({ type: 'w3.kite', x: 45, y: 12, w: 2, len: 3, swing: 20, flow: fT }, 8, 90)
      ],
      signs: [
        'Here the wind turns. Its streamlines flicker before they reverse, and the raft turns with them.',
        'Wait for the current to carry the raft your way, then ride it across the abyss.'
      ],
      lint: {
        stand: [], open: [],
        edges: [
          { from: [64, 51], to: [63, 44], oneWay: true },
          { from: [63, 44], to: [65, 37], oneWay: true },
          { from: [65, 37], to: [56, 31], oneWay: true }
        ],
        openTop: false, skip: false,
        note: 'The three edges are the reversing lift (a w3.wind updraft of about 1.6 g for ~2.8 s of every 6.4 s, then a ' +
          'downdraft while you rest on its one-way ledges); each rising half carries the player 7+ tiles. The bot ignores wind.'
      },
      meta: { brief: 'Sections where the wind reverses; combined gauntlet.' }
    });
  })();

  // ==================================================================== w3-boss Maelstrom
  // One screen, mirror-symmetric. The eye floats over the centre; the inhale column (x 13-16) blows only while it
  // opens. Routes to the eye: floor -> low clouds (rise 3) -> mid ledges (rise 2) -> jump + double jump beside it;
  // or a side lift to a high shelf and a dive onto it. The low clouds tear loose into rafts in phase 3.
  AP.Levels.register({
    id: 'w3-boss', world: 3, boss: true,
    name: 'Maelstrom',
    form: 5, style: 'w3', music: 'boss3',
    par: 100,
    map: [
      '##############################',
      '#............................#',
      '#............................#',
      '#............................#',
      '#...====..............====...#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#....#####..........#####....#',
      '#............................#',
      '#.........===....===.........#',
      '#............................#',
      '#.....P......................#',
      '##############################',
      '##############################'
    ],
    legend: {},
    entities: [
      // the storm itself (the boss keeps its swirl on the eye and turns it per phase)
      { type: 'w3.wind', x: 1, y: 1, w: 28, h: 14, tag: 'swirl', strength: 24, speed: 10,
        flow: { seed: 7, scale: 7, tscale: 0.12, angle: 0, spread: 180, mmin: 0, swirl: [15, 6.5, 12, 1] } },
      // the inhale column under the eye (silent until the eye opens)
      { type: 'w3.wind', x: 13, y: 7, w: 4, h: 8, tag: 'inhale', strength: 130, speed: 18,
        flow: { seed: 2, angle: -90, spread: 10, mmin: 0.9, tscale: 0.3 } },
      // side lifts to the high shelves
      { type: 'w3.wind', x: 1, y: 2, w: 3, h: 13, tag: 'lift', strength: 112, speed: 18, flow: { seed: 4, angle: -90, spread: 8, mmin: 0.9 } },
      { type: 'w3.wind', x: 26, y: 2, w: 3, h: 13, tag: 'lift', strength: 112, speed: 18, flow: { seed: 5, angle: -90, spread: 8, mmin: 0.9 } },
      { type: 'w3.maelstrom', x: 14.5, y: 6 },
      { type: 'vertex', x: 14.5, y: 13 }
    ],
    signs: [],
    lint: {
      stand: [], open: [],
      edges: [
        { from: [2, 14], to: [5, 3], oneWay: true },
        { from: [27, 14], to: [24, 3], oneWay: true }
      ],
      openTop: false, skip: false,
      note: 'The two edges are the side wind lifts (w3.wind updrafts of about 1.5 g) up to the high shelves; the bot ignores wind. ' +
        'The vertex sits on the open floor and needs no annotation.'
    },
    meta: { brief: 'The Maelstrom: a vortex eye; ride the inhale updraft, stomp or burst the open eye. 9 hits, 3 phases.' }
  });
})(window.AP = window.AP || {});
