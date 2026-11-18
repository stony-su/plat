/* tools/lib/levelparse.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // Strict, standalone level parser for lint and the reachability bots (CONTRACT §3). It reads
  // a registered level def plus the live AP tables (TILE_CHARS, ENTITY_CHARS, Entities) from
  // the harness context, and never depends on CORE's loader. When a common type is not
  // registered yet (CORE's js/game/common.js missing) the §2.16 table is used as a fallback so
  // fixtures and early world levels can still be linted.

  const sim = require('./sim');

  const TILE_CHARS = { '.': 0, '#': 1, '=': 2, '^': 3, v: 4, '<': 5, '>': 6, '+': 7, '%': 8 };
  const ENTITY_CHARS = { P: 'player', E: 'exit', V: 'vertex', C: 'checkpoint', '*': 'shard', '1': 'gem', '2': 'gem', '3': 'gem',
    B: 'bounce', S: 'sign', O: 'node', '~': 'crumble' };
  const LEGEND_KEY_RE = /^[a-uw-z4-9]$/;

  // CONTRACT §2.16 (size, anchor, kind, lint, flags) used when a common type is not registered.
  const COMMON_FALLBACK = {
    player: { kind: 'actor', w: 22, h: 22, anchor: 'floor', lint: 'ignore' },
    checkpoint: { kind: 'sensor', w: 24, h: 64, anchor: 'floor', lint: 'ignore' },
    exit: { kind: 'sensor', w: 40, h: 64, anchor: 'floor', lint: 'ignore' },
    shard: { kind: 'sensor', w: 14, h: 14, anchor: 'center', lint: 'ignore' },
    gem: { kind: 'sensor', w: 22, h: 22, anchor: 'center', lint: 'ignore' },
    sign: { kind: 'sensor', w: 32, h: 32, anchor: 'floor', lint: 'ignore' },
    bounce: { kind: 'sensor', w: 32, h: 12, anchor: 'floor', lint: 'bounce' },
    crumble: { kind: 'solid', w: 32, h: 32, anchor: 'tile', lint: 'stand' },
    node: { kind: 'sensor', w: 24, h: 24, anchor: 'center', lint: 'orbit', orbitNode: true },
    vertex: { kind: 'sensor', w: 32, h: 32, anchor: 'center', lint: 'ignore' },
    mover: { kind: 'solid', w: 96, h: 32, anchor: 'tile', lint: 'mover', required: ['path'],
      size: function (s) { const w = s && s.w > 0 ? s.w : 3, h = s && s.h > 0 ? s.h : 1; return [w * 32, s && s.oneWay ? 12 : h * 32]; } },
    secretwall: { kind: 'sensor', w: 32, h: 32, anchor: 'tile', lint: 'ignore' },
    trigger: { kind: 'sensor', w: 32, h: 32, anchor: 'tile', lint: 'ignore', required: ['event'],
      size: function (s) { return [(s && s.w > 0 ? s.w : 1) * 32, (s && s.h > 0 ? s.h : 1) * 32]; } },
    camzone: { kind: 'sensor', w: 32, h: 32, anchor: 'tile', lint: 'ignore',
      size: function (s) { return [(s && s.w > 0 ? s.w : 1) * 32, (s && s.h > 0 ? s.h : 1) * 32]; } },
    killzone: { kind: 'sensor', w: 32, h: 32, anchor: 'tile', lint: 'hazard', hazard: true,
      size: function (s) { return [(s && s.w > 0 ? s.w : 1) * 32, (s && s.h > 0 ? s.h : 1) * 32]; } },
    text: { kind: 'sensor', w: 32, h: 32, anchor: 'center', lint: 'ignore', required: ['text'] },
    missing: { kind: 'sensor', w: 32, h: 32, anchor: 'floor', lint: 'ignore' }
  };
  // Zone-like types whose rect may legitimately cover solid tiles (exempt from E08).
  const ZONE_TYPES = new Set(['camzone', 'trigger', 'killzone', 'text', 'secretwall']);

  function entityDef(AP, type) {
    let def = null;
    try { def = AP && AP.Entities && typeof AP.Entities.get === 'function' ? AP.Entities.get(type) : null; } catch (e) { def = null; }
    if (def) return { def, fallback: false };
    if (COMMON_FALLBACK[type]) return { def: COMMON_FALLBACK[type], fallback: true };
    return { def: null, fallback: false };
  }

  function sizeOf(def, spec, errors) {
    let w = typeof def.w === 'number' && def.w > 0 ? def.w : 24;
    let h = typeof def.h === 'number' && def.h > 0 ? def.h : 24;
    if (typeof def.size === 'function') {
      try {
        const r = def.size(spec || {});
        if (r && r.length >= 2 && +r[0] > 0 && +r[1] > 0) { w = +r[0]; h = +r[1]; }
      } catch (e) { if (errors) errors.push('size(spec) threw: ' + e.message); }
    }
    return [w, h];
  }
  // top-left of the hitbox from the anchor tile coords (fractions allowed)
  function anchorRect(anchor, tx, ty, w, h) {
    if (anchor === 'tile') return [tx * 32, ty * 32, w, h];
    if (anchor === 'center') return [tx * 32 + 16 - w / 2, ty * 32 + 16 - h / 2, w, h];
    if (anchor === 'ceiling') return [tx * 32 + 16 - w / 2, ty * 32, w, h];
    return [tx * 32 + 16 - w / 2, ty * 32 + 32 - h, w, h];
  }
  // world anchor point for path coordinates (the anchor point travels along the path)
  function anchorPoint(anchor, tx, ty) {
    if (anchor === 'tile') return [tx * 32, ty * 32];
    if (anchor === 'center') return [tx * 32 + 16, ty * 32 + 16];
    if (anchor === 'ceiling') return [tx * 32 + 16, ty * 32];
    return [tx * 32 + 16, ty * 32 + 32];
  }
  function rectFromAnchorPoint(anchor, ax, ay, w, h) {
    if (anchor === 'tile') return [ax, ay, w, h];
    if (anchor === 'center') return [ax - w / 2, ay - h / 2, w, h];
    if (anchor === 'ceiling') return [ax - w / 2, ay, w, h];
    return [ax - w / 2, ay - h, w, h];
  }

  // ------------------------------------------------------------------ parse
  // → {
  //   def, id, world, form, boss, rows, w, h, tiles (Uint8Array raw codes), rectangular,
  //   badChars:[{ch, tx, ty}], spawns:[{type, tx, ty, spec, src, ch, index, def, fallback, rect, anchor}],
  //   counts:{...}, problems:[{code, msg}] (structural, for lint)
  // }
  function parse(def, AP) {
    const out = { def, id: def && def.id, world: def ? def.world | 0 : 0, form: def ? def.form : undefined, boss: !!(def && def.boss),
      rows: [], w: 0, h: 0, tiles: null, rectangular: true, badChars: [], spawns: [], problems: [], legendUse: {} };
    const legend = def && def.legend && typeof def.legend === 'object' ? def.legend : {};
    let rows = def && Array.isArray(def.map) ? def.map : null;
    if (!rows) { out.problems.push({ code: 'E03', msg: 'map is missing or not an array of strings' }); rows = []; }
    rows = rows.map(r => (typeof r === 'string' ? r : String(r)));
    out.rows = rows;
    out.h = rows.length;
    out.w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    for (let i = 0; i < rows.length; i++) if (rows[i].length !== out.w) { out.rectangular = false; break; }
    const tiles = new Uint8Array(Math.max(1, out.w * out.h));
    out.tiles = tiles;
    const entChars = (AP && AP.ENTITY_CHARS) || ENTITY_CHARS;
    const tileChars = (AP && AP.TILE_CHARS) || TILE_CHARS;
    let signK = 0;
    const signs = Array.isArray(def && def.signs) ? def.signs : [];
    for (let ty = 0; ty < out.h; ty++) {
      const row = rows[ty];
      for (let tx = 0; tx < out.w; tx++) {
        const ch = tx < row.length ? row.charAt(tx) : '.';
        const code = tileChars[ch];
        if (code !== undefined) { tiles[ty * out.w + tx] = code; continue; }
        let type = null, spec = null;
        if (entChars[ch] !== undefined) {
          type = entChars[ch];
          spec = {};
          if (ch === '1' || ch === '2' || ch === '3') spec.n = +ch;
          if (ch === 'S') { spec.k = signK; spec.text = signs[signK] !== undefined ? String(signs[signK]) : ''; signK++; }
        } else if (Object.prototype.hasOwnProperty.call(legend, ch)) {
          const lg = legend[ch];
          out.legendUse[ch] = (out.legendUse[ch] || 0) + 1;
          if (typeof lg === 'string') { type = lg; spec = {}; }
          else if (lg && typeof lg === 'object' && typeof lg.type === 'string') {
            type = lg.type; spec = {};
            for (const k of Object.keys(lg)) if (k !== 'type') spec[k] = lg[k];
          } else { out.badChars.push({ ch, tx, ty, why: 'legend entry has no type' }); continue; }
        } else { out.badChars.push({ ch, tx, ty }); continue; }
        spec.x = tx; spec.y = ty; spec.ch = ch;
        out.spawns.push({ type, tx, ty, spec, src: 'map', ch, index: out.spawns.length });
      }
    }
    const ents = Array.isArray(def && def.entities) ? def.entities : [];
    ents.forEach((en, i) => {
      if (!en || typeof en !== 'object') { out.problems.push({ code: 'E09', msg: 'entities[' + i + '] is not an object' }); return; }
      const spec = {};
      for (const k of Object.keys(en)) if (k !== 'type') spec[k] = en[k];
      if (en.type === 'sign' && spec.text === undefined && spec.k !== undefined) spec.text = signs[spec.k] !== undefined ? String(signs[spec.k]) : '';
      out.spawns.push({ type: en.type, tx: +en.x, ty: +en.y, spec, src: 'entities', ch: null, index: out.spawns.length, entIndex: i });
    });
    // resolve defs and rects
    for (const s of out.spawns) {
      const r = entityDef(AP, s.type);
      s.def = r.def; s.fallback = r.fallback;
      if (!s.def) continue;
      const errs = [];
      const [w, h] = sizeOf(s.def, s.spec, errs);
      s.anchor = s.def.anchor || 'floor';
      const tx = isFinite(s.tx) ? s.tx : 0, ty = isFinite(s.ty) ? s.ty : 0;
      s.rect = anchorRect(s.anchor, tx, ty, w, h);
      if (errs.length) s.sizeError = errs[0];
    }
    // counts
    const c = { P: 0, E: 0, V: 0, C: 0, S: 0, shards: 0, gems: { 1: 0, 2: 0, 3: 0 }, gemBad: 0, B: 0, O: 0, crumble: 0, bossEntities: [] };
    for (const s of out.spawns) {
      switch (s.type) {
        case 'player': c.P++; break;
        case 'exit': c.E++; break;
        case 'vertex': c.V++; break;
        case 'checkpoint': c.C++; break;
        case 'sign': if (s.src === 'map') c.S++; else if (s.spec.text === undefined || s.spec.k !== undefined) c.S++; break;
        case 'shard': c.shards++; break;
        case 'gem': { const n = +s.spec.n; if (n === 1 || n === 2 || n === 3) c.gems[n]++; else c.gemBad++; break; }
        case 'bounce': c.B++; break;
        case 'node': c.O++; break;
        case 'crumble': c.crumble++; break;
        default: break;
      }
      if (s.def && s.def.boss) c.bossEntities.push(s);
    }
    out.counts = c;
    return out;
  }

  // ------------------------------------------------------------------ geometry for the bots
  function cellList(v) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (const it of v) {
      if (Array.isArray(it) && it.length >= 2 && isFinite(it[0]) && isFinite(it[1])) {
        if (it.length >= 4 && isFinite(it[2]) && isFinite(it[3])) {
          // rectangle form [x, y, w, h]
          for (let y = it[1]; y < it[1] + it[3]; y++) for (let x = it[0]; x < it[0] + it[2]; x++) out.push([x | 0, y | 0]);
        } else out.push([it[0] | 0, it[1] | 0]);
      } else if (it && typeof it === 'object' && isFinite(it.x) && isFinite(it.y)) out.push([it.x | 0, it.y | 0]);
    }
    return out;
  }
  // lint.edges entries: [x1,y1,x2,y2] | [[x1,y1],[x2,y2]] | {from:[x,y], to:[x,y], oneWay?}
  function edgeList(v) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (const it of v) {
      if (Array.isArray(it) && it.length >= 4 && it.slice(0, 4).every(n => isFinite(n))) out.push({ a: [+it[0], +it[1]], b: [+it[2], +it[3]], oneWay: it[4] === true || it[4] === 'oneWay' });
      else if (Array.isArray(it) && it.length >= 2 && Array.isArray(it[0]) && Array.isArray(it[1])) out.push({ a: [+it[0][0], +it[0][1]], b: [+it[1][0], +it[1][1]], oneWay: !!it[2] });
      else if (it && typeof it === 'object' && Array.isArray(it.from) && Array.isArray(it.to)) out.push({ a: [+it.from[0], +it.from[1]], b: [+it.to[0], +it.to[1]], oneWay: !!it.oneWay });
      else out.push({ invalid: true, raw: it });
    }
    return out;
  }

  function lissPoints(liss, ax, ay, n) {
    const pts = [];
    const A = { ax: (+liss.ax || 0) * 32, ay: (+liss.ay || 0) * 32, fx: +liss.fx || 1, fy: +liss.fy || 1,
      phase: (+liss.phase || 0) * Math.PI / 180, period: +liss.period > 0 ? +liss.period : 4 };
    const w = Math.PI * 2 / A.period;
    for (let i = 0; i < n; i++) {
      const t = A.period * i / n;
      pts.push([ax + A.ax * Math.sin(A.fx * w * t + A.phase), ay + A.ay * Math.sin(A.fy * w * t)]);
    }
    return pts;
  }

  // Builds the bot geometry: {grid, goals:[{kind, n?, rect, spawn}], start:{x,y}, checkpoints:[gi],
  //  exitGoals:[gi], gemGoals:{1:gi,...}, orbitGroups, moverGroups, annotations, notes:[...]}
  function geometry(P, AP, opts) {
    opts = opts || {};
    const def = P.def || {};
    const form = (opts.form !== undefined ? opts.form : def.form) | 0;
    const G = new sim.Grid(P.w, P.h);
    const lint = def.lint && typeof def.lint === 'object' ? def.lint : {};
    const notes = [];
    for (let i = 0; i < P.w * P.h; i++) {
      let c = P.tiles[i];
      if (c === sim.TILE.BREAK && form >= 6) c = sim.TILE.EMPTY;
      if (c === sim.TILE.FAKE) c = sim.TILE.EMPTY;
      G.code[i] = c;
    }
    const open = cellList(lint.open), stand = cellList(lint.stand);
    for (const [x, y] of open) if (x >= 0 && y >= 0 && x < P.w && y < P.h) G.code[y * P.w + x] = sim.TILE.EMPTY;
    for (const [x, y] of stand) {
      if (x < 0 || y < 0 || x >= P.w || y >= P.h) continue;
      const i = y * P.w + x;
      if (G.code[i] !== sim.TILE.SOLID && G.code[i] !== sim.TILE.BREAK) G.code[i] = sim.TILE.ONEWAY;
    }
    const goals = [];
    const checkpoints = [], exitGoals = [], gemGoals = {};
    const orbitGroups = [], moverGroups = [];
    let start = null;
    let gi = 0;
    function addGoal(kind, s, rect, extra) {
      if (gi >= 31) { notes.push('more than 31 reachability goals; ' + kind + ' at ' + s.tx + ',' + s.ty + ' is not tracked'); return -1; }
      const g = Object.assign({ kind, rect, spawn: s, gi }, extra || {});
      goals.push(g);
      G.addGoal(rect[0], rect[1], rect[2], rect[3], gi, s);
      return gi++;
    }
    for (const s of P.spawns) {
      if (!s.def || !s.rect) continue;
      const r = s.rect;
      if (s.type === 'player') { if (!start) start = { x: Math.round(r[0] + r[2] / 2 - 11), y: Math.round(r[1] + r[3] - 22), spawn: s }; continue; }
      if (s.type === 'exit') { const g = addGoal('exit', s, r); if (g >= 0) exitGoals.push(g); continue; }
      if (s.type === 'vertex') { const g = addGoal('vertex', s, r); if (g >= 0) exitGoals.push(g); continue; }
      if (s.type === 'checkpoint') { const g = addGoal('checkpoint', s, r); if (g >= 0) checkpoints.push(g); continue; }
      if (s.type === 'gem') { const n = +s.spec.n; const g = addGoal('gem', s, r, { n }); if (g >= 0 && !(n in gemGoals)) gemGoals[n] = g; continue; }
      // lint kinds
      // lintRects(spec, tx, ty) → [[x, y, w, h, kind]] in TILE units (CONTRACT §0 level-spec units):
      // tx, ty = the spawn tile (fractional for entities-array positions); rects are top-left + size.
      let rects = null;
      if (typeof s.def.lintRects === 'function') {
        try {
          const lr = s.def.lintRects(s.spec, s.tx, s.ty);
          if (Array.isArray(lr)) rects = lr;
        } catch (e) { notes.push(s.type + ' lintRects threw: ' + e.message); }
      }
      if (rects) {
        // a return in world units (coordinates far beyond the map in tiles) is accepted with a note
        const world = rects.some(q => q && (Math.abs(+q[0]) > P.w + 4 || Math.abs(+q[1]) > P.h + 4 || +q[2] > P.w + 4 || +q[3] > P.h + 4));
        if (world) notes.push(s.type + ' lintRects returned world units; it should return tile units [x, y, w, h, kind]');
        const k = world ? 1 : 32;
        for (const q of rects) {
          if (!q || q.length < 5) continue;
          addKind(String(q[4]), s, [+q[0] * k, +q[1] * k, +q[2] * k, +q[3] * k]);
        }
        continue;
      }
      const lk = s.def.lint || 'ignore';
      if (lk === 'ignore') continue;
      if (lk === 'orbit') {
        const pts = [[r[0] + r[2] / 2, r[1] + r[3] / 2]];
        if (Array.isArray(s.spec.path)) {
          for (const p of s.spec.path) if (p && p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) {
            const ap = anchorPoint(s.anchor, +p[0], +p[1]);
            const rr = rectFromAnchorPoint(s.anchor, ap[0], ap[1], r[2], r[3]);
            pts.push([rr[0] + rr[2] / 2, rr[1] + rr[3] / 2]);
          }
        }
        if (s.spec.liss && typeof s.spec.liss === 'object') {
          for (const p of lissPoints(s.spec.liss, r[0] + r[2] / 2, r[1] + r[3] / 2, 8)) pts.push(p);
        }
        orbitGroups.push({ spawn: s, points: pts });
        continue;
      }
      if (lk === 'mover') {
        const stands = [];
        const ap0 = [r[0], r[1]];
        const pts = [ap0];
        if (Array.isArray(s.spec.path)) {
          for (const p of s.spec.path) if (p && p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) {
            const ap = anchorPoint(s.anchor, +p[0], +p[1]);
            const rr = rectFromAnchorPoint(s.anchor, ap[0], ap[1], r[2], r[3]);
            pts.push([rr[0], rr[1]]);
          }
        }
        const seen = new Set();
        for (const p of pts) {
          const k = Math.round(p[0]) + ',' + Math.round(p[1]);
          if (seen.has(k)) continue;
          seen.add(k);
          stands.push({ x: p[0], y: p[1], w: r[2], h: Math.min(r[3], 12) });
          G.addStand(p[0], p[1], r[2], Math.min(r[3], 12), s);
        }
        moverGroups.push({ spawn: s, stands });
        continue;
      }
      addKind(lk, s, r);
    }
    function addKind(kind, s, r) {
      if (kind === 'solid') G.addSolid(r[0], r[1], r[2], r[3], s);
      else if (kind === 'stand' || kind === 'mover') G.addStand(r[0], r[1], r[2], r[3], s);
      else if (kind === 'hazard') G.addHazard(r[0], r[1], r[2], r[3], s);
      else if (kind === 'bounce') G.addBounce(r[0], r[1], r[2], r[3], s.spec && s.spec.dir || 'up', s, G.bounceR.length);
      else if (kind === 'orbit') orbitGroups.push({ spawn: s, points: [[r[0] + r[2] / 2, r[1] + r[3] / 2]] });
    }
    orbitGroups.forEach((g, i) => { for (const p of g.points) G.addOrbit(p[0], p[1], i, g.spawn, G.orbitP.length); });
    G.build();
    return {
      grid: G, form, goals, checkpoints, exitGoals, gemGoals, start, orbitGroups, moverGroups,
      annotations: { open, stand, edges: edgeList(lint.edges) }, notes
    };
  }

  exports.TILE_CHARS = TILE_CHARS;
  exports.ENTITY_CHARS = ENTITY_CHARS;
  exports.LEGEND_KEY_RE = LEGEND_KEY_RE;
  exports.COMMON_FALLBACK = COMMON_FALLBACK;
  exports.ZONE_TYPES = ZONE_TYPES;
  exports.entityDef = entityDef;
  exports.sizeOf = sizeOf;
  exports.anchorRect = anchorRect;
  exports.anchorPoint = anchorPoint;
  exports.parse = parse;
  exports.geometry = geometry;
  exports.cellList = cellList;
  exports.edgeList = edgeList;
  exports.lissPoints = lissPoints;
})(module.exports);
