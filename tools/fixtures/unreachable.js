/* tools/fixtures/unreachable.js — owner: TOOLS */
(function (AP) {
  'use strict';
  // Lint fixtures (not loaded by the game): levels the reachability bots must reject.
  //   E11  SAFE bot: P → exit, P → every C, every C → exit
  //   E12  EXPERT bot: P → every gem, and back to the exit (or a good C) after each gem

  function room(w, h, floor) {
    var g = [];
    for (var y = 0; y < h; y++) {
      var r = [];
      for (var x = 0; x < w; x++) r.push(x === 0 || x === w - 1 || y === 0 || y >= floor ? '#' : '.');
      g.push(r);
    }
    return {
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
  function reg(id, form, c, expect, note) {
    var def = { id: id, world: 0, form: form, name: id, map: c.map(), legend: {}, entities: [], signs: [],
      meta: { fixture: true, expect: expect, why: note } };
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  }

  // The exit sits on a ledge five tiles up (the triangle's jump rises three). Every gem is on the
  // start floor, so E12 follows: no gem leads back to an exit.
  (function () {
    var c = room(40, 18, 15);
    c.fill(24, 10, 38, 14, '#');
    c.many(line(14, 4, 8).concat(line(14, 12, 16)), '*');
    c.put(2, 14, 'P').put(32, 9, 'E').put(10, 14, '1').put(18, 14, '2').put(21, 14, '3');
    reg('fx-unreachable', 3, c, ['E11', 'E12'], 'exit five tiles up at form 3');
  })();

  // The exit is fine, but a checkpoint sits on a platform six tiles up (P cannot reach C).
  (function () {
    var c = room(40, 18, 15);
    c.fill(18, 9, 20, 9, '#');
    c.many(line(14, 4, 8).concat(line(14, 24, 28)), '*');
    c.put(2, 14, 'P').put(19, 8, 'C').put(35, 14, 'E').put(10, 14, '1').put(22, 14, '2').put(30, 14, '3');
    reg('fx-cp-unreachable', 3, c, ['E11'], 'checkpoint on a six-tile pillar');
  })();

  // A checkpoint at the bottom of a five-deep, three-wide well in the floor: P can drop in (or
  // jump over it), but nothing climbs back out, so the exit is not reachable from the checkpoint.
  (function () {
    var c = room(44, 22, 19);
    c.fill(1, 14, 42, 18, '#').fill(16, 14, 18, 18, '.');
    c.many(line(13, 3, 8).concat(line(13, 24, 28)), '*');
    c.put(2, 13, 'P').put(17, 18, 'C').put(40, 13, 'E').put(10, 13, '1').put(22, 13, '2').put(32, 13, '3');
    reg('fx-cp-trapped', 3, c, ['E11'], 'checkpoint in a well with no way out');
  })();
})(window.AP = window.AP || {});
