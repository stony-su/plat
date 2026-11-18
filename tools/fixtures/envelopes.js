/* tools/fixtures/envelopes.js — owner: TOOLS */
(function (AP) {
  'use strict';
  // Lint fixtures (not loaded by the game) that pin the bots to the CONTRACT §4 envelopes.
  //   Gauntlets: pillars over bottomless pits; every gap sits exactly at the §4.4 SAFE limit for
  //   its height change dy (landing higher +, lower −). They must pass the SAFE bot.
  //   Rises: a floating one-way ledge at the §4.3 SAFE rise passes; one tile higher fails E11.
  // The DJ + dash row omits dy +9 (the table's 7; the SAFE model reaches 6, see knownGaps).

  function grid(w, h) {
    var g = [];
    for (var y = 0; y < h; y++) {
      var r = [];
      for (var x = 0; x < w; x++) r.push(x === 0 || x === w - 1 || y === 0 ? '#' : '.');
      g.push(r);
    }
    return {
      w: w, h: h,
      fill: function (x0, y0, x1, y1, ch) {
        for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) g[yy][xx] = ch;
        return this;
      },
      put: function (x, y, ch) { g[y][x] = ch; return this; },
      map: function () { return g.map(function (r) { return r.join(''); }); }
    };
  }
  function reg(id, form, c, expect, extra) {
    var def = { id: id, world: 0, form: form, name: id, map: c.map(), legend: {}, entities: [], signs: [], meta: { fixture: true, expect: expect } };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) def[k] = extra[k];
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  }

  // cells: [[dy, gap], ...]; top: start pillar top row; h: map height
  function gauntlet(id, form, cells, top, h) {
    var w = 2 + 6 + 6;
    for (var i = 0; i < cells.length; i++) w += cells[i][1] + 3;
    var c = grid(w, h);
    var x = 1, row = top;
    c.fill(x, row, x + 5, h - 1, '#');
    c.put(x + 1, row - 1, 'P');
    x += 6;
    var tops = [];
    for (var k = 0; k < cells.length; k++) {
      var dy = cells[k][0], gap = cells[k][1];
      // a shard over the middle of every gap, one tile above the takeoff row
      c.put(x + Math.floor(gap / 2), row - 2, '*');
      x += gap;
      row -= dy;
      var wPillar = k === cells.length - 1 ? 6 : 3;
      c.fill(x, row, x + wPillar - 1, h - 1, '#');
      tops.push([x, row]);
      x += wPillar;
    }
    // extra shards on pillar tops (≥ 10 in total), gems on three pillars, exit on the last
    for (var s = 0; s < tops.length && s < 6; s++) c.put(tops[s][0] + 2, tops[s][1] - 1, '*');
    var gi = [Math.floor(tops.length / 4), Math.floor(tops.length / 2), Math.floor(3 * tops.length / 4)];
    c.put(tops[gi[0]][0] + 1, tops[gi[0]][1] - 1, '1').put(tops[gi[1]][0] + 1, tops[gi[1]][1] - 1, '2').put(tops[gi[2]][0] + 1, tops[gi[2]][1] - 1, '3');
    var last = tops[tops.length - 1];
    c.put(last[0] + 3, last[1] - 1, 'E');
    reg(id, form, c, []);
  }
  gauntlet('fx-env-jump', 3, [[3, 3], [2, 4], [1, 4], [0, 5], [-1, 5], [-2, 6], [-4, 6], [-6, 7], [-8, 7]], 12, 32);
  gauntlet('fx-env-dj', 5, [[5, 6], [4, 7], [3, 7], [2, 7], [1, 8], [0, 8], [-1, 8], [-2, 9], [-4, 9], [-6, 10], [-8, 11]], 24, 34);
  gauntlet('fx-env-djdash', 6, [[8, 9], [6, 10], [4, 11], [2, 11], [0, 12], [-2, 13], [-4, 13], [-8, 15]], 33, 36);

  // rise: a floating one-way ledge n tiles above the floor. The exit stands on a second
  // platform at the ledge height, three columns past it and 13 from the floor's edge, over a
  // bottomless pit, so it can only
  // be reached by landing on the ledge first (a sensor on the ledge itself could be touched
  // from below through the one-way, which the touch rule counts). The border walls carry spikes:
  // §4.3 assumes no wall to climb (same-wall wall-jumps gain height without limit).
  function rise(id, form, n, expect) {
    var c = grid(44, 28);
    c.fill(1, 22, 16, 27, '#').fill(1, 1, 1, 21, '>').fill(42, 1, 42, 21, '<');
    c.fill(13, 22 - n, 26, 22 - n, '=');
    c.fill(30, 22 - n, 37, 22 - n, '#');
    for (var x = 3; x <= 12; x++) c.put(x, 19, '*');
    c.put(5, 21, 'P').put(34, 21 - n, 'E').put(6, 20, '1').put(9, 20, '2').put(12, 20, '3');
    reg(id, form, c, expect);
  }
  rise('fx-rise-jump-3', 3, 3, []);
  rise('fx-rise-jump-4', 3, 4, ['E11', 'E12']);   // EXPERT (110u apex) cannot land either
  rise('fx-rise-dj-5', 5, 5, []);
  rise('fx-rise-dj-6', 5, 6, ['E11']);             // exact physics: 196u ≥ 192 (frame-tight, §A.2)
  rise('fx-rise-djdash-9', 6, 9, []);
  rise('fx-rise-djdash-10', 6, 10, ['E11']);       // exact physics: 322u ≥ 320 (frame-tight)

  // orbit (§4.4 "Orbit (SAFE)"): node chains at the table limits over a bottomless pit
  //   9 tiles apart at |dy| ≤ 2, 7 apart when the next node is 3–5 higher, 8 in a vertical stack
  (function () {
    var steps = [[9, 0], [9, 2], [7, 4], [7, 3], [9, -2]];
    var w = 13 + 16;
    for (var i = 0; i < steps.length; i++) w += steps[i][0];
    var h = 40, F = 34;
    var c = grid(w, h);
    c.fill(1, F, 8, h - 1, '#');
    var nx = 13, ny = F - 5;
    c.put(nx, ny, 'O');
    for (var k = 0; k < steps.length; k++) {
      c.put(nx + Math.floor(steps[k][0] / 2), ny - 2, '*');
      nx += steps[k][0]; ny -= steps[k][1];
      c.put(nx, ny, 'O');
    }
    var lx = nx + 5, ly = ny + 4;
    c.fill(lx, ly, Math.min(w - 2, lx + 7), h - 1, '#');
    for (var s = 0; s < 5; s++) c.put(2 + s, F - 2, '*');
    c.put(3, F - 1, 'P').put(5, F - 1, '1').put(7, F - 1, '2').put(lx + 1, ly - 1, '3').put(lx + 4, ly - 1, 'E');
    reg('fx-env-orbit', 99, c, []);
  })();
  (function () {
    var h = 48, w = 40;
    var c = grid(w, h);
    c.fill(1, h - 2, w - 2, h - 1, '#').fill(1, 1, 1, h - 3, '>').fill(w - 2, 1, w - 2, h - 3, '<');
    var ny = h - 3 - 4;
    for (var i = 0; i < 4; i++) { c.put(20, ny, 'O'); c.put(18, ny, '*'); c.put(22, ny, '*'); ny -= 8; }
    var top = ny + 8 - 3;
    c.fill(24, top, 32, top, '#');
    c.put(5, h - 3, 'P').put(8, h - 3, '1').put(11, h - 3, '2').put(26, top - 1, '3').put(30, top - 1, 'E');
    for (var x = 6; x <= 7; x++) c.put(x, h - 4, '*');
    reg('fx-env-orbit-stack', 99, c, []);
  })();

  // bounce pad: six tiles is SAFE (fx-tile-bounce); seven never
  (function () {
    var c = grid(40, 18);
    c.fill(1, 15, 38, 17, '#').fill(14, 8, 38, 14, '#');
    for (var x = 3; x <= 9; x++) c.put(x, 13, '*');
    c.put(2, 14, 'P').put(10, 14, 'B').put(35, 7, 'E').put(5, 14, '1').put(7, 14, '2').put(12, 14, '3');
    for (var y = 9; y <= 11; y++) c.put(11, y, '*');
    // SAFE (208u) falls short; the expert's 222u plus ledge correction (≤ 8u) makes it
    reg('fx-rise-bounce-7', 3, c, ['E11']);
  })();
})(window.AP = window.AP || {});
