/* tools/fixtures/forms.js — owner: TOOLS */
(function (AP) {
  'use strict';
  // Lint fixtures (not loaded by the game): ability gates. Each fx-formN-* level needs form N's
  // new ability and must pass; the same map one form lower must fail E11 (the exit and gems
  // behind the gate are out of reach, so E12 follows). fx-multiform is a full form-99 level
  // that combines every mechanic, three checkpoints, a secret gem and a GEM-tier gem.

  function room(w, h, floor) {
    var g = [];
    for (var y = 0; y < h; y++) {
      var r = [];
      for (var x = 0; x < w; x++) r.push(x === 0 || x === w - 1 || y === 0 || y >= floor ? '#' : '.');
      g.push(r);
    }
    return {
      g: g,
      fill: function (x0, y0, x1, y1, ch) {
        for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) g[yy][xx] = ch;
        return this;
      },
      put: function (x, y, ch) { g[y][x] = ch; return this; },
      many: function (list, ch) { for (var i = 0; i < list.length; i++) g[list[i][1]][list[i][0]] = ch; return this; },
      map: function () { return g.map(function (r) { return r.join(''); }); }
    };
  }
  function line(y, x0, x1) { var out = []; for (var x = x0; x <= x1; x++) out.push([x, y]); return out; }
  function col(x, y0, y1) { var out = []; for (var y = y0; y <= y1; y++) out.push([x, y]); return out; }
  function reg(id, form, c, expect, extra) {
    var def = { id: id, world: 0, form: form, name: id, map: c.map(), legend: {}, entities: [], signs: [], meta: { fixture: true, expect: expect || [] } };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) def[k] = extra[k];
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  }

  // form 3: jump course (gaps 4–5, a three-tile step)
  (function () {
    var c = room(44, 18, 15);
    c.fill(8, 15, 11, 16, '.').fill(17, 15, 21, 16, '.').fill(27, 12, 42, 14, '#');
    c.many(line(14, 3, 6).concat(line(12, 13, 15), line(11, 29, 33)), '*');
    c.put(2, 14, 'P').put(39, 11, 'E').put(14, 14, '1').put(24, 14, '2').put(35, 11, '3');
    reg('fx-form3-jump', 3, c);
  })();

  // form 4: a three-wide shaft, twelve tiles tall
  function shaft() {
    var c = room(40, 24, 21);
    c.fill(1, 1, 8, 20, '#').fill(9, 9, 10, 20, '#').fill(14, 9, 38, 20, '#');
    c.many(col(12, 11, 18).concat(line(8, 28, 31)), '*');
    c.put(12, 20, 'P').put(35, 8, 'E').put(12, 14, '1').put(9, 8, '2').put(24, 8, '3');
    return c;
  }
  reg('fx-form4-shaft', 4, shaft());
  reg('fx-form4-shaft-f3', 3, shaft(), ['E11', 'E12']);

  // form 5: an eight-wide spike pit (double jump; no wall reaches across)
  function djPit() {
    var c = room(40, 18, 15);
    c.fill(11, 15, 18, 16, '.').fill(11, 16, 18, 16, '^');
    c.many(line(14, 3, 8).concat(line(10, 12, 17)), '*');
    c.put(2, 14, 'P').put(35, 14, 'E').put(6, 13, '1').put(24, 14, '2').put(30, 14, '3');
    return c;
  }
  reg('fx-form5-dj', 5, djPit());
  reg('fx-form5-dj-f4', 4, djPit(), ['E11', 'E12']);

  // form 6: a twelve-wide spike pit (double jump + dash)
  function dashPit() {
    var c = room(44, 18, 15);
    c.fill(9, 15, 20, 16, '.').fill(9, 16, 20, 16, '^');
    c.many(line(14, 3, 7).concat(line(9, 11, 18)), '*');
    c.put(2, 14, 'P').put(39, 14, 'E').put(5, 13, '1').put(26, 14, '2').put(33, 14, '3');
    return c;
  }
  reg('fx-form6-dash', 6, dashPit());
  // SAFE cannot cross; the expert falls short, wall-jumps up the far pit wall and gets the gems
  reg('fx-form6-dash-f5', 5, dashPit(), ['E11']);

  // form 99: a twenty-wide spike pit with two orbit nodes
  function orbitPit() {
    var c = room(46, 18, 15);
    c.fill(10, 15, 29, 16, '.').fill(10, 16, 29, 16, '^');
    c.many(line(14, 3, 7).concat(line(8, 14, 23)), '*');
    c.put(2, 14, 'P').put(15, 10, 'O').put(22, 10, 'O').put(41, 14, 'E').put(5, 13, '1').put(33, 14, '2').put(37, 14, '3');
    return c;
  }
  reg('fx-form99-orbit', 99, orbitPit());
  reg('fx-form99-orbit-f6', 6, orbitPit(), ['E11', 'E12']);

  // fx-multiform: every mechanic in one form-99 level
  (function () {
    var c = room(170, 22, 19);
    // A: start, a four-wide spike pit, a one-way detour shelf with gem 1
    c.fill(11, 19, 14, 20, '.').fill(11, 20, 14, 20, '^');
    c.fill(17, 15, 19, 15, '=');
    // B: one-way stack to a ledge (top row 10) with checkpoint 1
    c.fill(27, 16, 30, 16, '=').fill(32, 13, 35, 13, '=').fill(37, 10, 44, 18, '#');
    // C: crumble bridge at the ledge height over a pit, then a platform with a secret room
    c.fill(45, 19, 52, 20, '.').fill(45, 10, 52, 10, '~').fill(53, 10, 58, 18, '#');
    c.fill(54, 17, 57, 18, '.').fill(58, 17, 58, 18, '%');
    // D: a well whose right side is a 13-tall block; a 3-wide shaft beside a pillar
    c.fill(66, 7, 66, 16, '#').fill(70, 6, 80, 18, '#');
    // E: a twelve-wide pit between two high blocks (double jump + dash)
    c.fill(81, 1, 92, 20, '.').fill(81, 18, 92, 18, '^').fill(81, 19, 92, 20, '#').fill(93, 6, 104, 18, '#');
    // F: a twenty-two-wide pit crossed by orbit nodes, landing block, GEM-tier detour
    c.fill(105, 18, 126, 18, '^').fill(127, 6, 140, 18, '#').fill(154, 6, 168, 18, '#');
    c.fill(141, 18, 153, 18, '^');
    c.put(110, 4, 'O').put(117, 4, 'O').put(124, 4, 'O');
    // goals and pickups
    c.put(2, 18, 'P').put(4, 18, 'S').put(40, 9, 'C').put(73, 5, 'C').put(101, 5, 'C').put(134, 5, 'E');
    c.put(18, 14, '1').put(55, 18, '2').put(160, 5, '3');
    c.many(line(18, 5, 9).concat(line(15, 28, 30), line(9, 46, 51), col(68, 8, 15), line(4, 84, 90), line(2, 108, 125)), '*');
    reg('fx-multiform', 99, c, [], { signs: ['Every mechanic in one level: jump, drop, crumble, wall-jump, double jump, dash, orbit.'] });
  })();
})(window.AP = window.AP || {});
