/* tools/fixtures/tiles.js — owner: TOOLS */
(function (AP) {
  'use strict';
  // Lint fixtures (not loaded by the game): one small level per tile type of the CONTRACT §3
  // global legend, plus the common map entities (C S B O ~). meta.expect lists the E-codes
  // `node tools/lint-levels.js --fixtures` must report (empty = must pass every check).

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
  function shardRow(y, x0, x1) { var out = []; for (var x = x0; x <= x1; x++) out.push([x, y]); return out; }
  function level(id, form, c, extra) {
    var def = { id: id, world: 0, form: form, name: id, map: c.map(), legend: {}, entities: [], signs: [], meta: { fixture: true, expect: [] } };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) def[k] = extra[k];
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  }

  // '#' solid: steps up two and three tiles, then down
  (function () {
    var c = room(40, 18, 15);
    c.fill(12, 13, 15, 14, '#').fill(22, 12, 26, 14, '#');
    c.many(shardRow(14, 3, 5).concat(shardRow(12, 12, 15), shardRow(11, 22, 25), shardRow(14, 29, 32)), '*');
    c.put(2, 14, 'P').put(36, 14, 'E').put(7, 14, '1').put(19, 14, '2').put(26, 11, '3');
    level('fx-tile-solid', 3, c);
  })();

  // '=' one-way: a climb of one-way platforms, a drop-through sign
  (function () {
    var c = room(40, 18, 15);
    c.fill(8, 12, 12, 12, '=').fill(14, 9, 18, 9, '=').fill(20, 6, 26, 6, '=');
    c.many(shardRow(11, 8, 12).concat(shardRow(8, 14, 18), shardRow(14, 30, 33)), '*');
    c.put(2, 14, 'P').put(4, 14, 'S').put(22, 5, 'E').put(10, 11, '1').put(16, 8, '2').put(25, 5, '3');
    level('fx-tile-oneway', 3, c, { signs: ['Hold {down} and press {jump} to drop through.'] });
  })();

  // '^ v < >' spikes: a spike pit, ceiling spikes, wall spikes on both border walls
  (function () {
    var c = room(40, 18, 15);
    c.fill(14, 15, 17, 16, '.').fill(14, 16, 17, 16, '^');
    c.fill(13, 1, 18, 1, 'v');
    c.fill(1, 3, 1, 5, '>').fill(38, 3, 38, 5, '<');
    c.many(shardRow(14, 4, 9).concat(shardRow(14, 20, 25)), '*');
    c.put(2, 14, 'P').put(35, 14, 'E').put(10, 14, '1').put(27, 14, '2').put(16, 11, '3');
    level('fx-tile-spikes', 3, c);
  })();

  // '+' breakable: a full-height wall of '+' is empty for the bot at form 6 ...
  (function () {
    function build() {
      var c = room(40, 18, 15);
      c.fill(20, 1, 20, 14, '+');
      c.many(shardRow(14, 4, 9).concat(shardRow(14, 24, 29)), '*');
      c.put(2, 14, 'P').put(35, 14, 'E').put(12, 14, '1').put(16, 14, '2').put(31, 14, '3');
      return c;
    }
    level('fx-tile-break', 6, build());
    // ... and solid below form 6 (exit and gem 3 behind it: unreachable)
    level('fx-tile-break-f3', 3, build(), { meta: { fixture: true, expect: ['E11', 'E12'] } });
  })();

  // '+' as terrain below form 6: a staircase of breakable blocks is standable
  (function () {
    var c = room(40, 18, 15);
    c.fill(10, 12, 13, 14, '+').fill(16, 9, 19, 14, '+').fill(22, 6, 38, 14, '+');
    c.many(shardRow(11, 10, 13).concat(shardRow(8, 16, 19), shardRow(5, 24, 27)), '*');
    c.put(2, 14, 'P').put(34, 5, 'E').put(6, 14, '1').put(18, 8, '2').put(29, 5, '3');
    level('fx-tile-break-stand', 3, c);
  })();

  // '%' fake wall: gem 2 in a secret room
  (function () {
    var c = room(40, 18, 15);
    c.fill(24, 12, 31, 14, '#').fill(25, 13, 29, 14, '.').fill(24, 13, 24, 14, '%');
    c.many(shardRow(14, 4, 9).concat(shardRow(11, 24, 31)), '*');
    c.put(2, 14, 'P').put(36, 14, 'E').put(12, 14, '1').put(28, 14, '2').put(20, 14, '3');
    level('fx-tile-fake', 3, c);
  })();

  // '~' crumble: a bridge over a pit too wide to jump
  (function () {
    var c = room(40, 18, 15);
    c.fill(12, 15, 21, 16, '.').fill(13, 15, 20, 15, '~');
    c.many(shardRow(13, 13, 20).concat(shardRow(14, 4, 6)), '*');
    c.put(2, 14, 'P').put(35, 14, 'E').put(8, 14, '1').put(17, 14, '2').put(28, 14, '3');
    level('fx-tile-crumble', 3, c);
  })();

  // 'B' bounce pad: a six-tile ledge only the pad reaches (form 3), checkpoint on top
  (function () {
    var c = room(40, 18, 15);
    c.fill(14, 9, 38, 14, '#');
    c.many(shardRow(14, 3, 8).concat(shardRow(8, 16, 21)), '*');
    c.put(2, 14, 'P').put(10, 14, 'B').put(18, 8, 'C').put(35, 8, 'E').put(6, 14, '1').put(12, 14, '2').put(26, 8, '3');
    level('fx-tile-bounce', 3, c);
  })();

  // 'O' orbit nodes: a twenty-wide pit only orbiting crosses (form 99)
  (function () {
    var c = room(44, 18, 15);
    c.fill(10, 15, 29, 16, '.').fill(10, 16, 29, 16, '^');
    c.many(shardRow(14, 3, 7).concat(shardRow(9, 13, 17), shardRow(14, 32, 36)), '*');
    c.put(2, 14, 'P').put(15, 10, 'O').put(22, 10, 'O').put(39, 14, 'E').put(5, 13, '1').put(31, 14, '2').put(19, 8, '3');
    level('fx-tile-node', 99, c);
  })();
})(window.AP = window.AP || {});
