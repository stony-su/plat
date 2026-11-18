/* tools/fixtures/lintrects.js — owner: TOOLS */
(function (AP) {
  'use strict';
  // Lint fixtures (not loaded by the game): the lintRects convention for dynamic geometry.
  //   def.lintRects(spec, tx, ty) → [[x, y, w, h, kind]] in TILE units, where (tx, ty) is the
  //   spawn tile; kind ∈ solid | stand | hazard | bounce | orbit. Here a stand-in for a wave
  //   row (like w5.wave) reports its rest positions as one-way stands, the only way over a pit.

  if (AP.Entities && AP.Entities.register) {
    AP.Entities.register('fx.platforms', {
      kind: 'sensor', anchor: 'tile', lint: 'stand',
      lintRects: function (spec, tx, ty) {
        var out = [], n = spec.n || 4, gap = spec.gap || 3;
        for (var i = 0; i < n; i++) out.push([tx + i * gap, ty, 2, 0.375, 'stand']);
        return out;
      },
      render: function (e, ctx, L) {
        ctx.strokeStyle = L.pal.primary;
        ctx.lineWidth = 2;
        ctx.strokeRect(e.rx + 1, e.ry + 1, e.w - 2, e.h - 2);
      }
    });
  }

  function build(withPlatforms) {
    var g = [];
    for (var y = 0; y < 18; y++) {
      var r = [];
      for (var x = 0; x < 50; x++) r.push(x === 0 || x === 49 || y === 0 || (y >= 15 && (x <= 9 || x >= 34)) ? '#' : '.');
      g.push(r);
    }
    for (var s = 3; s <= 8; s++) g[14][s] = '*';
    for (var t = 36; t <= 41; t++) g[14][t] = '*';
    g[14][2] = 'P'; g[14][46] = 'E'; g[13][5] = '1'; g[14][38] = '2'; g[14][43] = '3';
    var def = { id: withPlatforms ? 'fx-lintrects' : 'fx-lintrects-none', world: 0, form: 3, name: 'lint rects', map: g.map(function (r) { return r.join(''); }),
      legend: {}, signs: [], entities: withPlatforms ? [{ type: 'fx.platforms', x: 12, y: 14, n: 7, gap: 3 }] : [],
      meta: { fixture: true, expect: withPlatforms ? [] : ['E11', 'E12'] } };
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  }
  build(true);
  build(false);
})(window.AP = window.AP || {});
