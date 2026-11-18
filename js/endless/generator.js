/* js/endless/generator.js — owner: W1 */
(function (AP) {
  'use strict';

  // AP.Endless.generate(seed, segment, {difficulty}) -> a complete level object (CONTRACT section 2.20).
  //   id 'e-<seed>-<segment>', world 0, form 99 (every ability), style = music = w1..w5 by segment % 5.
  //   A segment (about 90..150 tiles) is: a safe start pad with P, then 3..6 chunk templates (js/endless/chunks.js)
  //   joined by procedural connectors (run-up flats, one- or two-tile steps, shard arcs, crawler and bouncer pens),
  //   a checkpoint before every template after the first (a short, gentle opener), and an end pad with E. No gems.
  //   Everything is seeded from AP.RNG, so (seed, segment) always yields the same level, and every result passes the
  //   SAFE lint (the fuzz in tools/lint-levels.js --endless checks 50 of them).
  //   difficulty 0..1 (default min(1, segment / 10)) slides the template window toward diff 5 and adds templates
  //   and pens; templates matching the segment's style are preferred.
  // AP.Endless.dailySeed(date?) -> AP.hash('apeiron-YYYY-MM-DD') (today when date is omitted).
  // Extras: dateKey(date?), chunkLevel(idOrIndex) (one template as a standalone level, used by the self-test),
  //   usable(chunk), STYLES, STYLE_NAMES, H.
  var E = AP.Endless = AP.Endless || {};
  var STYLES = ['w1', 'w2', 'w3', 'w4', 'w5'];
  var STYLE_NAMES = { w1: 'Lattice', w2: 'Voronoi', w3: 'Currents', w4: 'Fractal', w5: 'Harmonic' };
  var H = 24;                 // segment height in rows (row 0 is the ceiling)
  var G_STD = 17;             // the standard walking row (templates sit with their row 12 here)
  var G_MIN = 15, G_MAX = 19; // connector steps keep the walking row in this band (16-row templates fit 13..20)
  var ROW = 12;               // walking row inside a template
  var TH = 16;                // template height
  var LEGEND_RE = /^[a-uw-z4-9]$/;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ------------------------------------------------------------------ canvas (columns appended left to right)
  function Canvas() {
    this.rows = [];
    for (var y = 0; y < H; y++) this.rows.push([]);
    this.ents = [];
    this.x = 0;
  }
  Canvas.prototype.col = function (fn) {
    for (var y = 0; y < H; y++) this.rows[y].push(fn(y));
    this.x++;
  };
  // a solid border column
  Canvas.prototype.wall = function () { this.col(function () { return '#'; }); };
  // a flat floor column with its walking row at g
  Canvas.prototype.flat = function (g) { this.col(function (y) { return (y === 0 || y > g) ? '#' : '.'; }); };
  Canvas.prototype.set = function (x, y, ch) { this.rows[y][x] = ch; };
  Canvas.prototype.get = function (x, y) { return this.rows[y][x]; };

  // ------------------------------------------------------------------ templates
  function typesOf(ch) {
    if (ch._types) return ch._types;
    var t = [];
    var lg = ch.legend || {};
    for (var k in lg) {
      if (!Object.prototype.hasOwnProperty.call(lg, k)) continue;
      var v = lg[k];
      var ty = typeof v === 'string' ? v : (v && v.type);
      if (ty && t.indexOf(ty) < 0) t.push(ty);
    }
    var es = ch.entities || [];
    for (var i = 0; i < es.length; i++) if (es[i] && es[i].type && t.indexOf(es[i].type) < 0) t.push(es[i].type);
    var mapChars = { B: 'bounce', O: 'node', '~': 'crumble', C: 'checkpoint', '*': 'shard' };
    for (var r = 0; r < ch.map.length; r++) {
      var row = ch.map[r];
      for (var c = 0; c < row.length; c++) {
        var mt = mapChars[row.charAt(c)];
        if (mt && t.indexOf(mt) < 0) t.push(mt);
      }
    }
    ch._types = t;
    return t;
  }

  // CONTRACT section 2.20: Endless uses only AP.Worlds.types (plus its own endless.*), and only registered ones
  function allowedType(t) {
    if (/^endless\./.test(t)) return true;
    var W = AP.Worlds && AP.Worlds.types;
    if (!W) return true;
    for (var k in W) if (Object.prototype.hasOwnProperty.call(W, k) && Array.isArray(W[k]) && W[k].indexOf(t) >= 0) return true;
    return false;
  }

  function usable(ch) {
    if (!ch || !Array.isArray(ch.map) || ch.map.length !== TH) return false;
    var t = typesOf(ch);
    for (var i = 0; i < t.length; i++) if (!allowedType(t[i]) || !(AP.Entities && AP.Entities.has(t[i]))) return false;
    return true;
  }

  function copySpec(src) {
    var o = {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) o[k] = src[k];
    return o;
  }

  // place a template with its walking row at g, starting at the canvas' current column
  function placeChunk(cv, ch, g) {
    var oy = g - ROW;
    var x0 = cv.x;
    var w = ch.map[0].length;
    var lg = ch.legend || {};
    for (var x = 0; x < w; x++) {
      cv.col(function (y) {
        if (y === 0) return '#';
        var ty = y - oy;
        var c;
        if (ty < 0) { c = ch.map[0].charAt(x); return c === '#' ? '#' : '.'; }
        if (ty >= TH) { c = ch.map[TH - 1].charAt(x); return (c === '#' || c === '^' || c === '+') ? '#' : '.'; }
        c = ch.map[ty].charAt(x);
        if (LEGEND_RE.test(c) && Object.prototype.hasOwnProperty.call(lg, c)) {
          var v = lg[c];
          var spec = typeof v === 'string' ? { type: v } : copySpec(v);
          spec.x = x0 + x;
          spec.y = y;
          cv.ents.push(spec);
          return '.';
        }
        return c;
      });
    }
    var es = ch.entities || [];
    for (var i = 0; i < es.length; i++) {
      var e = copySpec(es[i]);
      e.x = (+e.x || 0) + x0;
      e.y = (+e.y || 0) + oy;
      if (Array.isArray(e.path)) {
        var p = [];
        for (var j = 0; j < e.path.length; j++) p.push([e.path[j][0] + x0, e.path[j][1] + oy]);
        e.path = p;
      }
      cv.ents.push(e);
    }
    return w;
  }

  // ------------------------------------------------------------------ connectors
  // flat run of n columns; optional shard arc over it
  function connector(cv, rng, g, n, opts) {
    var x0 = cv.x;
    for (var i = 0; i < n; i++) cv.flat(g);
    if (opts && opts.shards && n >= 3) {
      var mid = x0 + Math.floor(n / 2);
      cv.set(mid - 1, g - 1, '*'); cv.set(mid, g - 2, '*'); if (mid + 1 < x0 + n) cv.set(mid + 1, g - 1, '*');
    }
    return x0;
  }

  // a one- or two-tile step to the walking row g2 (from g), with a shard over the edge
  function step(cv, rng, g, g2, shards) {
    cv.flat(g);
    cv.flat(g);
    var x = cv.x;
    cv.flat(g2);
    cv.flat(g2);
    cv.flat(g2);
    if (shards) cv.set(x, Math.min(g, g2) - 2, '*');
    return g2;
  }

  // a crawler pen: two one-tile bumps with a crawler patrolling between them
  function pen(cv, rng, g, d) {
    var x0 = cv.x;
    cv.flat(g); cv.flat(g);
    var b0 = cv.x;
    cv.flat(g);
    cv.set(b0, g, '#');
    var n = 6 + rng.int(0, 2);
    for (var i = 0; i < n; i++) cv.flat(g);
    var b1 = cv.x;
    cv.flat(g);
    cv.set(b1, g, '#');
    cv.flat(g); cv.flat(g);
    var useBouncer = d > 0.55 && AP.Entities.has('w1.bouncer') && rng.chance(0.4);
    if (useBouncer) cv.ents.push({ type: 'w1.bouncer', x: b0 + 1 + Math.floor(n / 2), y: g, height: 2 });
    else cv.ents.push({ type: 'w1.crawler', x: b0 + 2, y: g, dir: rng.chance(0.5) ? 'left' : 'right', speed: 1.6 + 0.6 * d });
    cv.set(b0, g - 1, '*'); cv.set(b1, g - 1, '*');
    return cv.x - x0;
  }

  function checkpoint(cv, g) {
    var x0 = cv.x;
    for (var i = 0; i < 6; i++) cv.flat(g);
    cv.set(x0 + 2, g, 'C');
    return 6;
  }

  // ------------------------------------------------------------------ template choice
  function weightOf(ch, style, maxDiff, used, last, maxW) {
    if (ch.id === last) return 0;
    if (maxW && ch.map[0].length > maxW) return 0;
    var st = ch.styles || ['any'];
    var sw = st.indexOf(style) >= 0 ? 3 : (st.indexOf('any') >= 0 ? 1.4 : 0.55);
    var dd = maxDiff - ch.diff;
    var dw = dd === 0 ? 1.7 : (dd === 1 ? 1.25 : 0.8);
    var uw = used[ch.id] ? 0.12 : 1;
    return sw * dw * uw;
  }

  function pick(rng, pool, style, minDiff, maxDiff, used, last, maxW) {
    var total = 0, i, w;
    for (i = 0; i < pool.length; i++) {
      var c = pool[i];
      if (c.diff < minDiff || c.diff > maxDiff) continue;
      total += weightOf(c, style, maxDiff, used, last, maxW);
    }
    if (total <= 0) return null;
    var r = rng.next() * total;
    for (i = 0; i < pool.length; i++) {
      var c2 = pool[i];
      if (c2.diff < minDiff || c2.diff > maxDiff) continue;
      w = weightOf(c2, style, maxDiff, used, last, maxW);
      if (r < w) return c2;
      r -= w;
    }
    return null;
  }

  function usablePool() {
    var out = [];
    var all = E.chunks || [];
    for (var i = 0; i < all.length; i++) if (usable(all[i])) out.push(all[i]);
    return out;
  }

  function finishLevel(cv, meta, style, id, name, index) {
    var map = [];
    for (var y = 0; y < H; y++) map.push(cv.rows[y].join(''));
    var w = map[0].length;
    var ents = cv.ents;
    if (AP.Entities && AP.Entities.has('endless.ctl')) ents.push({ type: 'endless.ctl', x: 1, y: 1 });
    return {
      id: id, world: 0, index: index, boss: false, name: name,
      form: 99, style: style, music: style,
      par: Math.round(w / 4.6 + 5),
      map: map,
      legend: {},
      entities: ents,
      signs: [],
      lint: { stand: [], open: [], edges: [], openTop: false, skip: false, note: '' },
      meta: meta
    };
  }

  // ------------------------------------------------------------------ public
  E.STYLES = STYLES;
  E.STYLE_NAMES = STYLE_NAMES;
  E.H = H;
  E.usable = usable;

  E.generate = function (seed, segment, opts) {
    seed = (+seed >>> 0);
    segment = Math.max(0, segment | 0);
    opts = opts || {};
    var d = (typeof opts.difficulty === 'number' && isFinite(opts.difficulty)) ? clamp(opts.difficulty, 0, 1) : Math.min(1, segment / 10);
    var style = STYLES[segment % 5];
    var rng = AP.RNG(AP.hash2(seed, segment, 0x5E9A));
    var pool = usablePool();
    var cv = new Canvas();
    var g = G_STD;
    var ids = [];
    var used = {};
    var last = '';
    // start pad: P with seven safe tiles ahead, and a first shard arc
    cv.wall();
    for (var i = 0; i < 10; i++) cv.flat(g);
    cv.set(3, g, 'P');
    cv.set(6, g - 1, '*'); cv.set(7, g - 2, '*'); cv.set(8, g - 1, '*');
    // 3..6 templates; a segment stays within about 80..140 tiles (DESIGN section 9)
    var nChunks = clamp(3 + Math.round(d * 2.4) + (rng.chance(0.5) ? 1 : 0), 3, 6);
    var maxW = 118 + Math.round(d * 12);
    var maxDiff = clamp(1 + Math.round(d * 4.2), 1, 5);
    var minDiff = Math.max(1, maxDiff - 2);
    for (var k = 0; k < nChunks; k++) {
      if (k > 0 && cv.x > maxW - 24) break;
      // the first template of a segment is a short, gentle one
      var lo = k === 0 ? 1 : minDiff, hi = k === 0 ? Math.min(2, maxDiff) : maxDiff;
      var ch = pick(rng, pool, style, lo, hi, used, last, k === 0 ? 18 : 0) || pick(rng, pool, style, 1, 5, used, last, k === 0 ? 18 : 0);
      if (!ch) break;
      var cw = ch.map[0].length;
      if (k > 0) {
        // between templates: a checkpoint, then maybe a step and a crawler pen (only before short templates, so
        // the stretch to the next checkpoint stays short)
        checkpoint(cv, g);
        var stepped = false;
        if (rng.chance(0.35)) {
          var g2 = clamp(g + rng.pick([-2, -1, 1, 2]), G_MIN, G_MAX);
          if (g2 !== g) { g = step(cv, rng, g, g2, rng.chance(0.6)); stepped = true; }
        }
        if (!stepped && d > 0.3 && cw <= 18 && AP.Entities.has('w1.crawler') && rng.chance(0.2 + 0.25 * d)) pen(cv, rng, g, d);
      } else {
        connector(cv, rng, g, 2, null);
      }
      // run-up before every template
      cv.flat(g); cv.flat(g);
      placeChunk(cv, ch, g);
      ids.push(ch.id);
      used[ch.id] = true;
      last = ch.id;
    }
    // end pad: a short run to E
    connector(cv, rng, g, 3, { shards: true });
    var ex = cv.x + 2;
    for (var j = 0; j < 6; j++) cv.flat(g);
    cv.set(ex, g, 'E');
    cv.wall();
    var name = 'Segment ' + (segment + 1) + ' · ' + STYLE_NAMES[style];
    if (name.length > 22) name = STYLE_NAMES[style] + ' ' + (segment + 1);
    return finishLevel(cv, { endless: true, seed: seed, segment: segment, difficulty: d, chunks: ids }, style,
      'e-' + seed + '-' + segment, name, segment);
  };

  // one template as a standalone level (self-test: every template passes lint on its own)
  E.chunkLevel = function (idOrIndex) {
    var all = E.chunks || [];
    var ch = null;
    for (var i = 0; i < all.length; i++) if (all[i].id === idOrIndex || i === idOrIndex) { ch = all[i]; break; }
    if (!ch) return null;
    var cv = new Canvas();
    var g = G_STD;
    cv.wall();
    for (var a = 0; a < 8; a++) cv.flat(g);
    cv.set(3, g, 'P');
    placeChunk(cv, ch, g);
    var ex = cv.x + 3;
    for (var b = 0; b < 6; b++) cv.flat(g);
    cv.set(ex, g, 'E');
    cv.wall();
    var idx = all.indexOf(ch);
    return finishLevel(cv, { endless: true, chunk: ch.id }, (ch.styles && STYLES.indexOf(ch.styles[0]) >= 0) ? ch.styles[0] : 'w1',
      'e-777-' + idx, 'Chunk ' + ch.id.slice(0, 16), idx);
  };

  // 'YYYY-MM-DD' for a Date, a date string, or today
  E.dateKey = function (date) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    var dt = (date instanceof Date && isFinite(date.getTime())) ? date : new Date();
    var m = dt.getMonth() + 1, dd = dt.getDate();
    return dt.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  };

  E.dailySeed = function (date) {
    return AP.hash('apeiron-' + E.dateKey(date));
  };
})(window.AP = window.AP || {});
