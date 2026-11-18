/* tools/fixtures/errors.js — owner: TOOLS */
(function (AP) {
  'use strict';
  // Lint fixtures (not loaded by the game): one structural defect per level. Each starts from
  // the same valid room and breaks exactly one rule, so meta.expect names the one E-code (and
  // meta.expectWarn any W-code) lint must report.

  function base() {
    var g = [];
    for (var y = 0; y < 18; y++) {
      var r = [];
      for (var x = 0; x < 40; x++) r.push(x === 0 || x === 39 || y === 0 || y >= 15 ? '#' : '.');
      g.push(r);
    }
    var c = {
      g: g,
      put: function (x, y, ch) { g[y][x] = ch; return c; },
      map: function () { return g.map(function (r) { return r.join(''); }); }
    };
    for (var sx = 4; sx <= 8; sx++) c.put(sx, 14, '*');
    for (var tx = 24; tx <= 28; tx++) c.put(tx, 14, '*');
    c.put(2, 14, 'P').put(35, 14, 'E').put(10, 14, '1').put(16, 14, '2').put(21, 14, '3');
    return c;
  }
  function reg(id, c, expect, extra) {
    var def = { id: id, world: 0, form: 3, name: id, map: c.map(), legend: {}, entities: [], signs: [], meta: { fixture: true, expect: expect } };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) def[k] = extra[k];
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  }

  // control: the untouched base passes
  reg('fx-err-none', base(), []);

  // E01: an id outside every id family
  reg('w9-1', base(), ['E01']);

  // E02: form 7, unknown style and music keys
  reg('fx-err-form', base(), ['E02'], { form: 7, style: 'w9', music: 'nope' });

  // E03: ragged rows, a space and an unknown character (the short row also breaks the right border: E06)
  (function () {
    var m = base().map();
    m[5] = m[5].slice(0, 30);
    m[7] = m[7].slice(0, 12) + ' ' + m[7].slice(13);
    m[9] = m[9].slice(0, 20) + '@' + m[9].slice(21);
    var def = { id: 'fx-err-map', world: 0, form: 3, map: m, legend: {}, entities: [], signs: [], meta: { fixture: true, expect: ['E03', 'E06'] } };
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  })();

  // E03: a 24×12 room (minimum 30×17)
  (function () {
    var g = [];
    for (var y = 0; y < 12; y++) { var r = ''; for (var x = 0; x < 24; x++) r += (x === 0 || x === 23 || y === 0 || y >= 10) ? '#' : '.'; g.push(r); }
    g[9] = '#P*1*2*3*****E*****....#';
    var def = { id: 'fx-err-size', world: 0, form: 3, map: g, legend: {}, entities: [], signs: [], meta: { fixture: true, expect: ['E03'] } };
    if (AP.Levels && AP.Levels.register) AP.Levels.register(def);
  })();

  // E04 (+W05): an uppercase legend key, an unregistered type and an unused key
  (function () {
    var c = base().put(20, 6, 'A').put(30, 6, 'q');
    reg('fx-err-legend', c, ['E04'], { legend: { A: 'crumble', q: 'fx.nothing', z: 'shard' }, meta: { fixture: true, expect: ['E04'], expectWarn: ['W05'] } });
  })();

  // E05: no gem 3, six shards, a second exit
  (function () {
    var c = base().put(21, 14, '.').put(30, 14, 'E');
    for (var tx = 25; tx <= 28; tx++) c.put(tx, 14, '.');
    reg('fx-err-counts', c, ['E05']);
  })();

  // E05: boss rules (an exit instead of the vertex, gems, no boss entity)
  reg('fx-err-boss', base(), ['E05'], { boss: true });

  // E06: a hole in the left border, a hole in the top row, a one-way in the bottom row
  (function () {
    var c = base().put(0, 5, '.').put(20, 0, '.').put(12, 17, '=');
    reg('fx-err-borders', c, ['E06']);
  })();

  // E07: a sign floating in mid-air
  (function () {
    var c = base().put(20, 9, 'S');
    reg('fx-err-floor', c, ['E07'], { signs: ['I float.'] });
  })();

  // E08 (+W04): a spike beside P, and a shard buried in the floor
  (function () {
    var c = base().put(3, 14, '^');
    reg('fx-err-overlap', c, ['E08'], { entities: [{ type: 'shard', x: 20, y: 16 }], meta: { fixture: true, expect: ['E08'], expectWarn: ['W04'] } });
  })();

  // E09: an unregistered type, a mover without its required path, an out-of-bounds entity
  reg('fx-err-entities', base(), ['E09'], { entities: [
    { type: 'fx.unknown', x: 5, y: 12 },
    { type: 'mover', x: 12, y: 9, w: 2 },
    { type: 'shard', x: 99, y: 3 }
  ] });

  // E10: three signs in the map, two texts, one over 120 characters
  (function () {
    var c = base().put(12, 14, 'S').put(18, 14, 'S').put(30, 14, 'S');
    reg('fx-err-signs', c, ['E10'], { signs: ['Short.', new Array(131).join('x')] });
  })();

  // E13: annotations without a note, a cell outside the map, skip in a normal level
  reg('fx-err-annotations', base(), ['E13'], { lint: { stand: [[45, 3]], edges: [[2, 13, 30, 13]], skip: true } });
})(window.AP = window.AP || {});
