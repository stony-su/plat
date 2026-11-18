/* js/engine/levels.js — owner: CORE */
(function (AP) {
  'use strict';

  var defs = {};
  var compiled = {};

  function worldOf(n) { return (AP.Worlds && AP.Worlds.get) ? AP.Worlds.get(n) : null; }

  // fills documented defaults without mutating the caller's object (returns a new def)
  function withDefaults(src) {
    var d = {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) d[k] = src[k];
    d.id = String(d.id || 'level');
    d.world = (d.world | 0) || 0;
    d.index = (d.index | 0) || 0;
    d.boss = !!d.boss;
    d.name = d.name ? String(d.name) : d.id;
    var W = worldOf(d.world);
    if (!(AP.FORMS || []).some(function (f) { return f === d.form; })) d.form = W ? W.form : 99;
    if (!d.style) d.style = W ? (d.boss ? W.bossStyle : W.style) : 'title';
    if (!d.music) d.music = W ? (d.boss ? W.bossMusic : W.music) : 'map';
    if (!Array.isArray(d.map) || !d.map.length) {
      AP.warn('Level "' + d.id + '" has no map; using an empty room.');
      d.map = fallbackMap();
    }
    if (!d.legend || typeof d.legend !== 'object') d.legend = {};
    if (!Array.isArray(d.entities)) d.entities = [];
    if (!Array.isArray(d.signs)) d.signs = [];
    if (!d.lint || typeof d.lint !== 'object') d.lint = {};
    if (!d.meta || typeof d.meta !== 'object') d.meta = {};
    return d;
  }

  function fallbackMap() {
    var rows = [];
    for (var y = 0; y < 17; y++) {
      var r = '';
      for (var x = 0; x < 30; x++) {
        if (x === 0 || x === 29 || y === 0 || y === 16) r += '#';
        else if (y === 15 && x === 3) r += 'P';
        else if (y === 15 && x === 26) r += 'E';
        else r += '.';
      }
      rows.push(r);
    }
    return rows;
  }

  function register(def) {
    if (!def || typeof def !== 'object' || !def.id) {
      AP.warn('Levels.register: level without id ignored');
      return null;
    }
    var id = String(def.id);
    if (defs[id]) AP.warn('Levels.register: duplicate level id "' + id + '" (last wins)');
    defs[id] = def;
    delete compiled[id];
    return def;
  }

  function get(id) { return defs[id] || null; }
  function has(id) { return !!defs[id]; }

  // registered level defs, optionally for one world, sorted by world, normal before boss, index, id
  function list(world) {
    var out = [];
    for (var id in defs) {
      var d = defs[id];
      if (world !== undefined && world !== null && ((d.world | 0) !== (world | 0))) continue;
      out.push(d);
    }
    out.sort(function (a, b) {
      return ((a.world | 0) - (b.world | 0)) || ((a.boss ? 1 : 0) - (b.boss ? 1 : 0)) ||
        ((a.index | 0) - (b.index | 0)) || (String(a.id) < String(b.id) ? -1 : 1);
    });
    return out;
  }

  // def -> {def, w, h, tiles (master copy; clone before mutating), spawns:[{type, tx, ty, spec, src}], player:{tx,ty}|null,
  //         secrets:[groups], bad:[chars]}. Cached per registered id (object levels are compiled every time).
  function compile(defIn) {
    var registered = defIn && defs[defIn.id] === defIn;
    if (registered && compiled[defIn.id]) return compiled[defIn.id];
    var def = withDefaults(defIn || {});
    var legend = def.legend;
    var parsed = AP.Tilemap.parse(def.map, legend);
    if (parsed.bad.length) AP.warnOnce('lvlchars:' + def.id, 'Level "' + def.id + '": unknown map characters ' + parsed.bad.join(' '));
    var spawns = [];
    var player = null;
    var signK = 0;
    for (var i = 0; i < parsed.chars.length; i++) {
      var c = parsed.chars[i];
      var ch = c.ch;
      var type, spec;
      if (AP.ENTITY_CHARS[ch] !== undefined) {
        type = AP.ENTITY_CHARS[ch];
        spec = {};
        if (ch === '1' || ch === '2' || ch === '3') spec.n = +ch;
        if (ch === 'S') { spec.k = signK; spec.text = def.signs[signK] !== undefined ? String(def.signs[signK]) : ''; signK++; }
      } else {
        var lg = legend[ch];
        if (typeof lg === 'string') { type = lg; spec = {}; }
        else if (lg && typeof lg === 'object') {
          type = lg.type;
          spec = {};
          for (var k in lg) if (k !== 'type' && Object.prototype.hasOwnProperty.call(lg, k)) spec[k] = lg[k];
        } else continue;
      }
      spec.x = c.tx;
      spec.y = c.ty;
      spec.ch = ch;
      if (type === 'player') {
        if (player) { AP.warnOnce('lvlP:' + def.id, 'Level "' + def.id + '": more than one P'); continue; }
        player = { tx: c.tx, ty: c.ty };
      }
      spawns.push({ type: type, tx: c.tx, ty: c.ty, spec: spec, src: 'map' });
    }
    for (var j = 0; j < def.entities.length; j++) {
      var en = def.entities[j];
      if (!en || !en.type) continue;
      var sp = {};
      for (var k2 in en) if (Object.prototype.hasOwnProperty.call(en, k2) && k2 !== 'type') sp[k2] = en[k2];
      var ex = +en.x || 0, ey = +en.y || 0;
      if (en.type === 'player') {
        if (player) continue;
        player = { tx: ex, ty: ey };
      }
      if (en.type === 'sign' && sp.text === undefined && sp.k !== undefined) sp.text = def.signs[sp.k] || '';
      spawns.push({ type: en.type, tx: ex, ty: ey, spec: sp, src: 'entities' });
    }
    var secrets = AP.Tilemap.groups(parsed.tiles, parsed.w, parsed.h, AP.TILE.FAKE);
    for (var g = 0; g < secrets.length; g++) {
      var gr = secrets[g];
      spawns.push({ type: 'secretwall', tx: gr.x0, ty: gr.y0,
        spec: { x: gr.x0, y: gr.y0, w: gr.x1 - gr.x0 + 1, h: gr.y1 - gr.y0 + 1, cells: gr.cells }, src: 'secret' });
    }
    var out = { def: def, w: parsed.w, h: parsed.h, tiles: parsed.tiles, spawns: spawns, player: player, secrets: secrets, bad: parsed.bad };
    if (registered) compiled[defIn.id] = out;
    return out;
  }

  AP.Levels = {
    register: register,
    get: get,
    has: has,
    list: list,
    compile: compile,
    withDefaults: withDefaults,
    ids: function () { return list().map(function (d) { return d.id; }); }
  };
})(window.AP = window.AP || {});
