/* js/levels/w2.js — owner: W2 */
(function (AP) {
  'use strict';

  // W2 — Voronoi Caverns (the Square, form 4): wall-slide and wall-jump. '+' crystal breaks only through turret
  // bolts and geodes, so every crystal door the main path needs is declared in lint.open with a note (the bots
  // treat '+' as solid below form 6). Maps are drawn at load time by the deterministic Grid helper below.

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
  // solid left/right columns and top row (the bottom row stays as drawn)
  Grid.prototype.frame = function () {
    for (var y = 0; y < this.h; y++) { this.c[y][0] = '#'; this.c[y][this.w - 1] = '#'; }
    for (var x = 0; x < this.w; x++) this.c[0][x] = '#';
    return this;
  };
  // shards at [dx, dy] offsets from (x, y)
  Grid.prototype.trail = function (x, y, offs) {
    for (var i = 0; i < offs.length; i++) this.put(x + offs[i][0], y + offs[i][1], '*');
    return this;
  };
  Grid.prototype.rows = function () {
    var out = [];
    for (var y = 0; y < this.h; y++) out.push(this.c[y].join(''));
    return out;
  };

  // Deterministic decoration (AP.RNG, so the map is identical on every load): crystal clusters ('z' hanging under
  // ceilings over open space, 'y' growing in floor corners). A cell is used only when nothing but plain rock and
  // air lies within two tiles of it, so clusters never crowd shards, enemies, one-ways, spikes, crystal or secrets.
  // skip: [x0, y0, x1, y1] rectangles to leave bare (for example around stalactites).
  Grid.prototype.decorate = function (seed, ceil, floor, skip) {
    var rng = AP.RNG(seed);
    var c = this.c, w = this.w, h = this.h;
    function plain(x, y) {
      for (var yy = y - 2; yy <= y + 2; yy++) for (var xx = x - 2; xx <= x + 2; xx++) {
        if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
        var ch = c[yy][xx];
        if (ch !== '.' && ch !== '#') return false;
      }
      return true;
    }
    function skipped(x, y) {
      for (var i = 0; skip && i < skip.length; i++) {
        var r = skip[i];
        if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return true;
      }
      return false;
    }
    var picks = [];
    for (var y = 2; y < h - 2; y++) for (var x = 1; x < w - 1; x++) {
      if (c[y][x] !== '.' || skipped(x, y)) continue;
      var roll = rng.next();
      if (c[y - 1][x] === '#' && c[y + 1][x] === '.' && c[y + 2][x] === '.' && roll < ceil && plain(x, y)) picks.push([x, y, 'z']);
      else if (c[y + 1][x] === '#' && c[y - 1][x] === '.' && (c[y][x - 1] === '#' || c[y][x + 1] === '#') && roll < floor && plain(x, y)) picks.push([x, y, 'y']);
    }
    for (var k = 0; k < picks.length; k++) c[picks[k][1]][picks[k][0]] = picks[k][2];
    return this;
  };
  var DECO = {
    y: { type: 'w2.cluster', dir: 'up', size: 0.9, n: 5 },
    z: { type: 'w2.cluster', dir: 'down', size: 1.1, n: 6 }
  };
  // a level's legend: its own keys plus the decoration keys its map actually uses
  function legend(g, extra) {
    var out = {};
    var used = g.rows().join('');
    if (used.indexOf('y') >= 0) out.y = DECO.y;
    if (used.indexOf('z') >= 0) out.z = DECO.z;
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  // canonical running-jump arc (tile offsets from the takeoff tile, CONTRACT §4.5 rule 6)
  var ARC = [[1, -2], [2, -3], [3, -3], [4, -3], [5, -2]];

  // ==================================================================== w2-1 Cell Division
  // Teach: a hazard-free start cell whose 3-wide chimney is the first wall-jump climb (with the sign).
  // Test: a long slide down a well into the lower cavern (gem 1 up a side notch), then a 2-wide shaft back up.
  // Twist: a 4-wide shaft over spikes (gem 3 waits at its very bottom), a slide down a crevasse to a low room
  // (gem 2 behind its wall), and a 3-wide spiked shaft whose only rests are crumbles, up to the exit.
  (function () {
    var g = new Grid(106, 32);
    g.frame();
    // ---- A. start cell and the first chimney (3 wide, x 10..12)
    g.fill(1, 26, 13, 31, '#');          // cell floor (stand row 25)
    g.fill(1, 1, 9, 18, '#');            // rock over the cell
    g.fill(9, 19, 9, 22, '#');           // the chimney's left wall reaches down to row 22 (doorway rows 23..25)
    g.fill(13, 13, 31, 29, '#');         // chimney right wall and the plateau block (plateau top row 13)
    g.put(3, 25, 'P');
    g.put(6, 25, 'S');
    g.trail(0, 0, [[11, 22], [12, 19], [10, 16], [12, 14]]);
    // ---- B. plateau run and the first checkpoint
    g.fill(22, 11, 31, 12, '#');         // a 2-tile step (stand row 10)
    g.trail(17, 12, ARC);
    g.put(27, 10, 'C');
    // ---- C. the well (3 wide, x 32..34): a long slide down to the cavern, marked by shards
    g.fill(35, 4, 52, 24, '#');          // the well's right wall and the rock over the cavern
    g.trail(0, 0, [[32, 13], [32, 17], [32, 21], [33, 25]]);
    // ---- D. the cavern (rows 25..29) with gem 1 up a 3-wide notch over a step
    g.fill(32, 30, 63, 31, '#');         // cavern floor (stand row 29)
    g.put(37, 29, 'C');
    g.fill(42, 28, 43, 29, '#');         // step under the notch (stand row 27)
    g.fill(44, 19, 46, 24, '.');         // the notch
    g.put(45, 19, '1');
    g.trail(0, 0, [[45, 23], [44, 21]]);
    // ---- E. the 2-wide shaft (x 53..54) with a one-way rest
    g.fill(52, 4, 52, 26, '#');          // left wall down to row 26 (doorway rows 27..29)
    g.fill(55, 12, 63, 29, '#');         // right wall and the ledge (top row 12)
    g.text(53, 20, '==');
    g.trail(0, 0, [[53, 26], [54, 23], [53, 17], [54, 14]]);
    // ---- F/G. ledge, then the 4-wide shaft over spikes (x 64..67), entered through a side doorway
    g.put(58, 11, 'C');
    g.fill(63, 1, 63, 8, '#');           // the shaft's left wall above the doorway (rows 9..11)
    g.fill(68, 6, 75, 31, '#');          // right wall and the top run (top row 6, stand row 5)
    g.fill(64, 30, 67, 30, '^');
    g.fill(64, 31, 67, 31, '#');
    g.trail(0, 0, [[66, 9], [64, 7], [66, 5]]);
    // gem 3: a pocket at the very bottom of the shaft, just above the spikes (a long climb back out)
    g.fill(68, 27, 69, 28, '.');
    g.put(69, 28, '3');
    g.trail(0, 0, [[67, 19], [66, 24]]);
    // ---- H/I. the top run and the crevasse (3 wide, x 76..78): a slide down to the low room
    g.trail(69, 5, [[1, -2], [2, -3], [3, -3], [4, -2]]);
    g.fill(79, 1, 90, 22, '#');          // the crevasse's right wall and the rock over the low room
    g.trail(0, 0, [[76, 9], [76, 13], [76, 17], [77, 21]]);
    // ---- J. the low room (rows 23..26) and the secret: gem 2 behind the crevasse's left wall
    g.fill(76, 27, 90, 31, '#');         // low room floor (stand row 26)
    g.put(82, 26, 'C');
    g.fill(71, 24, 72, 26, '.');         // the secret chamber
    g.fill(73, 24, 75, 26, '%');
    g.put(71, 26, '2');
    g.trail(0, 0, [[78, 25], [77, 25]]);
    // ---- K. the final shaft (3 wide, x 91..93) over spikes; its only rests are crumbles
    g.fill(91, 29, 93, 29, '^');
    g.fill(91, 30, 93, 31, '#');
    g.fill(94, 9, 104, 31, '#');         // right wall and the exit room floor (top row 9)
    g.fill(94, 1, 104, 3, '#');          // exit room ceiling
    g.put(93, 19, '~');
    g.put(91, 13, '~');
    g.trail(0, 0, [[92, 24], [91, 21], [92, 17], [93, 14], [92, 10]]);
    // ---- L. the exit
    g.trail(95, 8, [[1, -1], [2, -1], [3, -1]]);
    g.put(100, 8, 'E');
    g.decorate(AP.hash('w2-1'), 0.16, 0.45, []);
    AP.Levels.register({
      id: 'w2-1', world: 2, index: 1, boss: false, name: 'Cell Division', form: 4,
      style: 'w2', music: 'w2', par: 70,
      map: g.rows(),
      legend: legend(g, {}),
      entities: [],
      signs: ['Slide down walls. Press {jump} against a wall to leap.'],
      lint: {},
      meta: {}
    });
  })();

  // ==================================================================== w2-2 Fracture Lines
  // Teach: a floor-level turret shoots out a crystal door (with the sign); jump its bolts on the way through.
  // Test: a crystal bridge over an aimed turret that shoots the floor out from under you; mites circling pillars.
  // Twist: an aimed turret over a crystal gallery, mites on every surface, and the run to the exit.
  (function () {
    var g = new Grid(130, 34);
    g.frame();
    // ---- A. start corridor (rows 24..29) and the crystal door, opened by the floor-level turret t1
    g.fill(1, 30, 41, 33, '#');          // floor (stand row 29)
    g.fill(1, 1, 21, 23, '#');           // corridor ceiling
    g.put(3, 29, 'P');
    g.put(6, 29, 'S');
    g.fill(16, 24, 16, 29, '+');         // the crystal door
    g.fill(22, 1, 22, 26, '#');          // the shaft's left wall (doorway rows 27..29)
    g.fill(26, 13, 34, 28, '#');         // the shaft's right wall and the ledge above (top row 13)
    g.fill(26, 1, 26, 9, '#');           // the shaft continues above the ledge doorway (rows 10..12)
    g.fill(27, 29, 41, 29, '#');
    g.put(26, 29, 't');                  // t1: fixed, facing left along the floor
    g.trail(0, 0, [[10, 28], [12, 27], [14, 28]]);
    // ---- B. the shaft (3 wide, x 23..25) with a one-way rest
    g.text(23, 21, '===');
    g.trail(0, 0, [[24, 26], [23, 23], [25, 19], [23, 16], [25, 14]]);
    // gem 1: at the top of the shaft, in sight from the ledge doorway (a visible detour)
    g.put(24, 3, '1');
    g.trail(0, 0, [[23, 8], [25, 6]]);
    // ---- C. ledge, then the crystal bridge over the turret chamber
    g.put(29, 12, 'C');
    g.fill(35, 13, 41, 13, '+');         // the crystal bridge
    g.fill(42, 1, 42, 17, '#');          // a wall closes the way over the bridge
    g.fill(35, 21, 41, 29, '#');         // chamber floor (stand row 20)
    g.put(38, 20, 'u');                  // t2: aimed, looking up through the bridge
    g.trail(0, 0, [[31, 11], [33, 11], [36, 11]]);
    // gem 2: a pocket behind the chamber's left wall, hinted by shards on the chamber floor
    g.fill(31, 18, 33, 20, '.');
    g.fill(34, 18, 34, 20, '%');
    g.put(32, 20, '2');
    g.trail(0, 0, [[36, 19], [35, 19]]);
    // ---- D. the pillar hall (x 43..60): climb past a circling mite, then cross the pillar tops over spikes
    g.fill(42, 21, 62, 33, '#');         // hall floor (stand row 20)
    g.fill(50, 20, 60, 20, '^');         // spikes under the pillars
    g.fill(61, 6, 62, 20, '#');          // hall right wall (top row 6)
    g.fill(46, 7, 47, 15, '#');          // pillar 1 (shaft A runs between it and the hall's left wall)
    g.fill(51, 7, 52, 13, '#');          // pillar 2
    g.fill(56, 7, 57, 16, '#');          // pillar 3
    g.put(46, 16, 'm');                  // mite under pillar 1
    g.put(51, 14, 'n');                  // mite under pillar 2
    g.put(56, 17, 'm');                  // mite under pillar 3
    g.put(43, 20, 'C');
    g.trail(0, 0, [[44, 17], [45, 14], [43, 11], [45, 8]]);
    g.trail(47, 6, [[1, -2], [2, -3], [3, -2]]);
    g.trail(52, 6, [[1, -2], [2, -3], [3, -2]]);
    // ---- E. the crystal gallery (rows 1..7): three crystal walls in front of the aimed floor turret t3
    g.fill(63, 8, 128, 33, '#');         // gallery floor (stand row 7)
    g.put(65, 7, 'C');
    g.put(67, 7, '#');                   // a crystal bump: once the walls are open it stops the bolts short of C3
    g.fill(71, 1, 71, 7, '+');
    g.fill(79, 1, 79, 7, '+');
    g.fill(87, 1, 87, 7, '+');
    g.put(97, 7, 'w');                   // t3: aimed, at floor level, facing left
    g.fill(98, 1, 128, 7, '#');
    // a floating crystal in each of the first two segments, circled by a mite: jump the bolts beneath it
    // only when its mite is not passing underneath (every mite circles something it can never leave)
    g.fill(74, 2, 75, 3, '#');
    g.fill(82, 2, 83, 3, '#');
    g.put(74, 4, 'n');
    g.put(83, 1, 'm');
    g.trail(0, 0, [[67, 6], [73, 6], [76, 6], [81, 6], [84, 6], [89, 6]]);
    // ---- F. the drop beside the turret into the exit hall (rows 12..16)
    g.fill(92, 8, 94, 11, '.');          // the drop (3 wide)
    g.fill(88, 12, 118, 16, '.');        // exit hall (floor row 17, stand row 16)
    g.trail(0, 0, [[93, 10], [93, 13], [96, 14], [98, 15]]);
    g.put(104, 16, 'E');
    // gem 3: a 6-wide shaft (marginal wall-jumps) up from the hall's east end to a crystal pocket
    g.fill(112, 3, 117, 11, '.');
    g.text(112, 4, '======');
    g.put(114, 3, '3');
    g.decorate(AP.hash('w2-2'), 0.16, 0.45, []);
    AP.Levels.register({
      id: 'w2-2', world: 2, index: 2, boss: false, name: 'Fracture Lines', form: 4,
      style: 'w2', music: 'w2', par: 85,
      map: g.rows(),
      legend: legend(g, {
        t: { type: 'w2.turret', dir: 'left', rate: 0.8 },
        u: { type: 'w2.turret', dir: 'up', aim: 'player', rate: 0.8 },
        m: { type: 'w2.mite', dir: 'cw', speed: 2 },
        n: { type: 'w2.mite', dir: 'ccw', speed: 2 },
        w: { type: 'w2.turret', dir: 'left', aim: 'player', rate: 0.9, range: 34 }
      }),
      entities: [],
      signs: ['Turret bolts shatter cracked crystal. Let them open the way, then jump the next one.'],
      lint: {
        open: [[16, 29], [38, 13], [39, 13], [87, 7], [79, 7], [71, 7]],
        note: 'Crystal doors the turrets shoot open: t1 fires along the floor row through the door at 16,29; t2 aims at the player standing on the bridge and breaks the cell under them (38..39,13).'
      },
      meta: {}
    });
  })();

  // ==================================================================== w2-3 The Geode
  // Teach: a geode in front of a crystal wall (with the sign): land on it and the wall shatters.
  // Test: a chain of geodes through a thick wall; a shaft past an aimed turret; a crystal plug whose geode the
  // aimed turret above strikes for you when you stand beneath it.
  // Twist: the long climb through the geode's hollow heart under crossfire, up to the crown, where a chain of
  // geodes shatters the crystal throne in front of the exit. The level is solid rock with every space carved.
  (function () {
    var g = new Grid(56, 82);
    g.frame();
    g.fill(1, 1, 54, 81, '#');
    // ---- A. the geode intro along the floor (rows 72..78)
    g.fill(1, 72, 41, 78, '.');
    g.put(3, 78, 'P');
    g.put(6, 78, 'S');
    g.fill(14, 72, 15, 78, '+');         // crystal wall #1
    g.put(13, 78, 'g');                  // geode 1, in front of it
    g.trail(0, 0, [[10, 77], [11, 76], [12, 75]]);
    g.fill(24, 72, 31, 78, '+');         // crystal wall #2, with a chain of geodes along its foot
    g.put(23, 78, 'g');
    g.put(25, 78, 'g'); g.put(27, 78, 'g'); g.put(29, 78, 'g'); g.put(31, 78, 'g');
    g.trail(0, 0, [[20, 77], [21, 76], [22, 75]]);
    g.put(37, 78, 'C');
    // ---- B. the first climb: a 3-wide shaft (x 44..46) past an aimed turret in its right wall
    g.fill(42, 76, 46, 78, '.');         // doorway into the shaft
    g.fill(44, 62, 46, 75, '.');
    g.text(44, 70, '===');               // rest
    g.put(47, 66, 'a');                  // aimed turret facing into the shaft
    g.trail(0, 0, [[45, 75], [44, 72], [46, 66], [44, 63]]);
    // ---- C. the plug: a 5-wide pit-shaft (x 45..49) capped by crystal around a geode
    g.fill(45, 54, 49, 61, '.');
    g.fill(45, 53, 49, 53, '+');
    g.put(47, 53, 'g');
    g.put(49, 58, '#');                  // a knob on the wall: it hides the checkpoint from the turret above
    g.put(49, 61, 'C');
    g.trail(0, 0, [[47, 59], [47, 56]]);
    // ---- D. the turret room over the plug (x 42..50, rows 43..52); its exit shaft climbs at the left
    g.fill(42, 43, 50, 52, '.');
    g.fill(45, 43, 45, 49, '#');         // hanging column: the exit shaft's right wall (x 42..44)
    g.put(47, 43, 'd');                  // aimed turret on the room's ceiling, right above the plug geode
    // gem 2: behind the room's right wall, hinted by a shard
    g.fill(51, 50, 51, 52, '%');
    g.fill(52, 50, 53, 52, '.');
    g.put(53, 52, '2');
    g.put(50, 51, '*');
    // ---- E. the long climb: three offset shaft segments joined by short corridors
    // segment 1 (x 42..44, rows 36..52) with a rest, up to corridor 1 (rows 33..35)
    g.fill(42, 36, 44, 42, '.');
    g.text(42, 44, '===');
    g.trail(0, 0, [[43, 50], [42, 47], [44, 41], [42, 38]]);
    g.fill(33, 33, 44, 35, '.');
    g.put(38, 35, 'C');
    // segment 2 (x 33..35, rows 21..32) past an aimed turret in its left wall, up to corridor 2 (rows 21..23)
    g.fill(33, 21, 35, 32, '.');
    g.put(32, 28, 'b');
    g.trail(0, 0, [[34, 31], [33, 29], [35, 26], [33, 24]]);
    g.fill(36, 21, 48, 23, '.');
    g.put(42, 21, 'k');                  // a stalactite over corridor 2
    // gem 1: up a notch in corridor 2's ceiling (a visible detour)
    g.fill(38, 16, 40, 20, '.');
    g.put(39, 16, '1');
    g.put(39, 19, '*');
    // segment 3 (x 45..48, rows 6..20) past an aimed turret in its right wall, with a rest
    g.fill(45, 6, 48, 20, '.');
    g.put(49, 15, 'f');
    g.text(45, 14, '====');
    g.trail(0, 0, [[46, 19], [48, 16], [45, 11], [48, 8]]);
    // ---- F. the crown (x 20..48, rows 2..9): a shelf to arrive on, gem 3 across a 6-wide gap, and the throne
    g.fill(20, 2, 41, 9, '.');
    g.fill(42, 2, 48, 5, '.');
    g.put(42, 5, 'C');                   // in the shelf corner's cover from segment 3's turret
    g.fill(33, 6, 35, 6, '#');           // gem 3's floating shelf
    g.put(34, 5, '3');
    g.put(32, 2, 'e');                   // aimed turret in the crown's ceiling: a narrow cone over the geodes and gem 3
    g.fill(25, 2, 27, 9, '+');           // the crystal throne wall
    g.put(29, 9, '+');
    g.put(31, 9, 'g');                   // geode on the floor ...
    g.put(29, 8, 'g');                   // ... on a crystal pedestal ...
    g.put(27, 7, 'h');                   // ... and inside the wall (a wide burst)
    g.trail(0, 0, [[40, 7], [38, 8], [36, 8], [33, 8]]);
    g.put(22, 9, 'E');
    g.decorate(AP.hash('w2-3'), 0.16, 0.45, [[37, 18, 47, 26]]);
    AP.Levels.register({
      id: 'w2-3', world: 2, index: 3, boss: false, name: 'The Geode', form: 4,
      style: 'w2', music: 'w2', par: 95,
      map: g.rows(),
      legend: legend(g, {
        g: { type: 'w2.geode', radius: 2 },
        h: { type: 'w2.geode', radius: 3 },
        a: { type: 'w2.turret', dir: 'left', aim: 'player', rate: 0.6 },
        b: { type: 'w2.turret', dir: 'right', aim: 'player', rate: 0.6 },
        f: { type: 'w2.turret', dir: 'left', aim: 'player', rate: 0.6, range: 15 },
        d: { type: 'w2.turret', dir: 'down', aim: 'player', rate: 0.7, range: 32 },
        e: { type: 'w2.turret', dir: 'down', aim: 'player', rate: 0.6, cone: 50 },
        k: 'w2.stalactite'
      }),
      entities: [],
      signs: ['Geodes shatter when you land on them hard, and break the cracked crystal around them.'],
      lint: {
        open: [[14, 76, 1, 3], [15, 77, 1, 2], [24, 76, 8, 3], [45, 53, 5, 1], [25, 5, 3, 5], [29, 9]],
        note: 'Crystal the geodes shatter: geode 1 opens the foot of wall #1, the geode chain opens a tunnel along the foot of wall #2, the plug geode (struck by the turret above) opens the 5-wide cap of the pit-shaft, and the crown chain opens the throne wall.'
      },
      meta: {}
    });
  })();

  // ==================================================================== w2-4 Delaunay Deep
  // Down: a well crossed by bolt lanes onto a geode floor, a cave of falling stalactites, a stair of crumbles
  // over spikes, into the deep. Up: lure the deep's turret through its crystal door, then climb out past
  // mites, crossfire and crumbling rests. Gem 3 waits at the top of a long spike-lined shaft.
  (function () {
    var g = new Grid(110, 62);
    g.frame();
    g.fill(1, 1, 108, 61, '#');
    // ---- A. the start ledge and the bolt well (4 wide, x 11..14): three turrets fire across it
    g.fill(1, 1, 14, 6, '.');
    g.fill(11, 7, 14, 26, '.');
    g.put(3, 6, 'P');
    g.put(6, 6, 'S');
    g.put(10, 12, 't'); g.put(10, 17, 'r'); g.put(10, 22, 't');
    g.trail(0, 0, [[9, 5], [11, 4], [13, 5], [14, 9], [14, 14], [14, 19], [14, 24]]);
    // the geode floor at the well's foot
    g.fill(11, 27, 14, 27, '+');
    g.put(12, 27, 'g');
    // ---- B. the stalactite cave (rows 28..33)
    g.fill(11, 28, 34, 33, '.');
    g.put(18, 33, 'C');
    g.put(25, 28, 'k'); g.put(29, 28, 'k'); g.put(33, 28, 'k');
    g.trail(0, 0, [[22, 32], [24, 31], [26, 32], [28, 31], [30, 32], [32, 31]]);
    // ---- C. the crumble stair over the spike pit (x 35..46)
    g.fill(35, 28, 46, 43, '.');
    g.fill(35, 44, 46, 44, '^');
    g.put(36, 35, '~'); g.put(39, 37, '~'); g.put(42, 39, '~'); g.put(45, 41, '~');
    g.trail(0, 0, [[36, 33], [39, 35], [42, 37], [45, 39]]);
    // ---- D. the deep (x 47..68, rows 40..56)
    g.fill(47, 40, 68, 54, '.');
    g.fill(47, 45, 50, 54, '#');         // the left ledge (stand row 44)
    g.put(53, 54, 'C');
    g.put(55, 54, '#');                  // a bump: the deep turret's floor bolts stop short of C2
    g.fill(58, 48, 62, 50, '#');         // a floating rock (stand row 47) that two mites circle; walk beneath it
    g.put(58, 47, 'm');
    g.put(62, 51, 'n');
    g.trail(0, 0, [[51, 46], [52, 49], [53, 52]]);
    // the crystal door, the corridor behind it and the deep's turret at its end
    g.fill(68, 48, 68, 54, '+');
    g.fill(69, 51, 73, 54, '.');
    g.put(74, 54, 'w');
    // gem 1 above the mound (a visible detour; mind the mite) and gem 2 behind the left ledge's foot
    g.put(60, 45, '1');
    g.fill(48, 52, 49, 54, '.');
    g.fill(50, 52, 50, 54, '%');
    g.put(48, 54, '2');
    g.trail(0, 0, [[52, 53], [51, 54]]);
    // ---- E. the climb out: shaft 1 (x 70..72) past a bolt lane, with a crumbling rest
    g.fill(70, 38, 72, 50, '.');
    g.put(73, 48, 'q');                  // fixed turret firing across the shaft
    g.put(71, 44, '~');
    g.trail(0, 0, [[71, 50], [70, 47], [72, 45], [70, 41], [72, 39]]);
    // corridor 1 (rows 35..37)
    g.fill(70, 35, 80, 37, '.');
    g.put(76, 37, 'C');
    // gem 3: a long spike-lined shaft (x 74..76) above corridor 1
    g.fill(74, 14, 76, 34, '.');
    g.put(75, 14, '3');
    g.text(74, 15, '===');
    g.put(74, 30, '>'); g.put(74, 29, '>');
    g.put(76, 25, '<'); g.put(76, 24, '<');
    g.put(74, 20, '>'); g.put(74, 19, '>');
    g.text(74, 27, '===');
    // ---- F. shaft 2 (x 81..83): rock on the left, a floating pillar with a circling mite on the right, spikes below
    g.fill(81, 14, 83, 39, '.');         // shaft 2
    g.fill(84, 17, 88, 39, '.');         // the void around the pillar
    g.fill(81, 40, 88, 40, '^');
    g.fill(84, 18, 85, 35, '#');         // the pillar
    g.put(84, 36, 'n');
    g.text(81, 27, '===');               // rest (the mite passes its right end)
    g.trail(0, 0, [[81, 36], [83, 33], [81, 30], [83, 27], [81, 24], [83, 21], [81, 18]]);
    // corridor 2 (rows 13..15) over the pillar, then shaft 3 (x 93..96) past an aimed turret
    g.fill(84, 13, 92, 15, '.');
    g.put(86, 15, 'C');                  // out of shaft 3's turret line (the column x 92 covers it)
    g.fill(93, 3, 96, 15, '.');
    g.put(97, 9, 'x');
    g.text(93, 10, '====');
    g.trail(0, 0, [[94, 14], [96, 12], [93, 8], [96, 6], [94, 4]]);
    // ---- G. the exit room
    g.fill(97, 2, 107, 6, '.');
    g.trail(0, 0, [[99, 5], [100, 4], [101, 4]]);
    g.put(104, 6, 'E');
    g.decorate(AP.hash('w2-4'), 0.16, 0.45, [[20, 26, 37, 35]]);
    AP.Levels.register({
      id: 'w2-4', world: 2, index: 4, boss: false, name: 'Delaunay Deep', form: 4,
      style: 'w2', music: 'w2', par: 110,
      map: g.rows(),
      legend: legend(g, {
        t: { type: 'w2.turret', dir: 'right', rate: 0.8 },
        r: { type: 'w2.turret', dir: 'right', rate: 0.8, delay: 0.6 },
        w: { type: 'w2.turret', dir: 'left', aim: 'player', rate: 0.8, range: 24 },
        g: { type: 'w2.geode', radius: 2 },
        k: 'w2.stalactite',
        m: { type: 'w2.mite', dir: 'cw', speed: 2 },
        n: { type: 'w2.mite', dir: 'ccw', speed: 2.4 },
        q: { type: 'w2.turret', dir: 'left', rate: 0.8, delay: 0.3 },
        x: { type: 'w2.turret', dir: 'left', aim: 'player', rate: 0.7 }
      }),
      entities: [],
      signs: ['The deep is down. Fall past the bolt lanes and land hard on the geode at the bottom.'],
      lint: {
        open: [[11, 27], [13, 27], [14, 27], [68, 54]],
        note: 'Crystal the level opens: the geode at the foot of the bolt well shatters the well floor (11..14,27) when the player lands on it, and the deep turret, aimed at the player, shoots out the foot of the crystal door (68,54).'
      },
      meta: {}
    });
  })();

  // ==================================================================== w2-boss Crystal Monarch
  // A vertical geode of three tiers (one screen each), separated by rock slabs. In every tier two 3-wide side
  // shafts climb past pillars to a perch of crystal shelves over the Monarch's hover line: drop through a shelf
  // onto its open core, and the stomp bounces you back up. Clearing a tier's hits sends the Monarch up through the
  // sealed gate in the slab above, which it shatters into a one-way crystal shelf (the next phase's way up).
  (function () {
    var g = new Grid(30, 51);
    g.frame();
    g.fill(1, 50, 28, 50, '#');          // arena floor
    g.fill(1, 33, 28, 33, '#');          // slab between tiers 1 and 2 (gate x 12..17)
    g.fill(1, 16, 28, 16, '#');          // slab between tiers 2 and 3 (gate x 12..17)
    // tier geometry: pillars, perch shelves (stand row r) and the raised step under the gate (stand row r - 1)
    function tier(perch, pillarBottom, step) {
      g.fill(4, perch, 4, pillarBottom, '#');
      g.fill(25, perch, 25, pillarBottom, '#');
      g.text(5, perch, '=======');
      g.text(18, perch, '=======');
      if (step) g.text(12, perch - 1, '======');
      else g.text(12, perch, '======');
    }
    tier(37, 45, true);                  // tier 1 (rows 34..49): perch stand 36, step stand 35
    tier(20, 28, true);                  // tier 2 (rows 17..32): perch stand 19, step stand 18
    tier(4, 12, false);                  // tier 3 (rows 1..15): perch stand 3
    g.put(14, 49, 'P');
    g.put(8, 32, 'C');
    g.put(8, 15, 'C');
    g.put(14, 3, 'V');
    // shards up the first side shaft show the way to the perch
    g.trail(0, 0, [[2, 46], [3, 43], [1, 40], [3, 37]]);
    // no decoration under the gates or along tier 3's ceiling (where the shard fall hangs its stalactites)
    g.decorate(AP.hash('w2-boss'), 0.1, 0.35, [[10, 34, 19, 36], [10, 17, 19, 19], [1, 1, 28, 3]]);
    AP.Levels.register({
      id: 'w2-boss', world: 2, index: 5, boss: true, name: 'Crystal Monarch', form: 4,
      style: 'w2', music: 'boss2', par: 150,
      map: g.rows(),
      legend: legend(g, {}),
      entities: [
        {
          type: 'w2.monarch', x: 14.5, y: 40,
          tiers: [
            { x: 14.5, y: 40, sway: 4.5, top: 34, bottom: 50 },
            { x: 14.5, y: 23, sway: 4, gate: [12, 33, 6, 1], top: 17, bottom: 33 },
            { x: 14.5, y: 7, sway: 4, gate: [12, 16, 6, 1], top: 1, bottom: 16 }
          ],
          walls: [
            [],
            [[[1, 24, 3, 1], [20, 21, 1, 7]], [[26, 24, 3, 1], [9, 21, 1, 7]]],
            [[[1, 8, 3, 1], [20, 5, 1, 7]], [[26, 8, 3, 1], [9, 5, 1, 7]]]
          ]
        }
      ],
      signs: [],
      lint: {
        open: [[12, 33, 6, 1], [12, 16, 6, 1]],
        stand: [[12, 33, 6, 1], [12, 16, 6, 1]],
        note: 'The two gates (12..17 in the slabs at rows 33 and 16) are sealed rock that the Crystal Monarch shatters into one-way crystal shelves when it rises to the next tier at each phase change; the phase snapshot keeps them open on respawn.'
      },
      meta: { arena: 'vertical, three tiers' }
    });
  })();
})(window.AP = window.AP || {});
