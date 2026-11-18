/* tools/fixtures/gems.js — owner: TOOLS */
(function (AP) {
  'use strict';
  // Lint fixtures (not loaded by the game): gem reachability (E12, EXPERT bot).
  //   fx-gem-unreachable  gem 3 floats six tiles above the floor at form 3      → E12
  //   fx-gem-trap         gem 2 lies at the bottom of a well with no way out     → E12
  //   fx-gem-tier         gem 3 across a GEM-tier gap (SAFE limit + 1) and back  → passes

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
  function reg(id, form, c, expect) {
    var def = { id: id, world: 0, form: form, name: id, map: c.map(), legend: {}, entities: [], signs: [], meta: { fixture: true, expect: expect } };
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  }

  (function () {
    var c = room(40, 18, 15);
    c.many(line(14, 4, 8).concat(line(14, 24, 28)), '*');
    c.put(2, 14, 'P').put(35, 14, 'E').put(10, 14, '1').put(16, 14, '2').put(20, 8, '3');
    reg('fx-gem-unreachable', 3, c, ['E12']);
  })();

  (function () {
    var c = room(44, 22, 19);
    c.fill(1, 14, 42, 18, '#').fill(16, 14, 18, 18, '.');
    c.many(line(13, 3, 8).concat(line(13, 24, 28)), '*');
    c.put(2, 13, 'P').put(40, 13, 'E').put(10, 13, '1').put(17, 18, '2').put(32, 13, '3');
    reg('fx-gem-trap', 3, c, ['E12']);
  })();

  // main route to the right; gem 3 on a pillar across a six-wide pit (SAFE flat limit 5)
  (function () {
    var c = room(44, 20, 15);
    c.fill(1, 15, 42, 18, '.').fill(1, 15, 22, 19, '#').fill(29, 15, 42, 19, '#');
    c.fill(23, 19, 28, 19, '^');
    c.fill(1, 15, 1, 19, '#').fill(42, 15, 42, 19, '#');
    c.many(line(14, 4, 9).concat(line(14, 12, 16)), '*');
    c.put(2, 14, 'P').put(18, 14, 'E').put(6, 13, '1').put(14, 14, '2').put(34, 14, '3');
    reg('fx-gem-tier', 3, c, []);
  })();
})(window.AP = window.AP || {});
