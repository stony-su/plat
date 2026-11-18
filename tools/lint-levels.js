/* tools/lint-levels.js — owner: TOOLS */
(function () {
  'use strict';
  // Level lint (CONTRACT §3): E01–E13 fail, W01–W06 warn, plus the SAFE / EXPERT reachability
  // bots (tools/lib/reach.js). Levels are loaded through the vm harness so world files register
  // exactly as in the game; the level maps are parsed by tools/lib/levelparse.js (strict, no
  // dependency on CORE's loader; CORE's AP.Levels.compile is cross-checked when present).
  //
  //   node tools/lint-levels.js                 all registered levels (+ per-world counts)
  //   node tools/lint-levels.js --world 2       world 2 (normal + boss)
  //   node tools/lint-levels.js --id w3-4       one level
  //   node tools/lint-levels.js --endless 50    50 AP.Endless segments (SAFE lint, fuzz)
  //   node tools/lint-levels.js --fixtures      tools/fixtures/*.js against their meta.expect
  //   node tools/lint-levels.js path/to/file.js only the levels that file registers
  //   flags: --no-reach  --verbose  --json  --budget <ms>  --quiet
  // Exit code 0 when no E-code is reported (with --fixtures: when every fixture matches).

  const cli = require('./lib/cli');
  const files = require('./lib/files');
  const harness = require('./lib/harness');
  const lp = require('./lib/levelparse');
  const reach = require('./lib/reach');

  const LEVEL_KEYS = new Set(['id', 'world', 'index', 'boss', 'name', 'form', 'style', 'music', 'par', 'map', 'legend', 'entities', 'signs', 'flow', 'camera', 'lint', 'meta']);
  const LINT_KEYS = new Set(['stand', 'open', 'edges', 'openTop', 'skip', 'note']);
  const TARGETS = {   // CONTRACT §4.6
    1: { path: [90, 150], cps: [2, 3], shards: [20, 35], time: [45, 90] },
    2: { path: [110, 180], cps: [3, 4], shards: [25, 45], time: [60, 110] },
    3: { path: [120, 200], cps: [3, 5], shards: [30, 50], time: [70, 130] },
    4: { path: [130, 220], cps: [3, 5], shards: [30, 55], time: [80, 150] },
    5: { path: [140, 240], cps: [4, 6], shards: [35, 60], time: [90, 180] }
  };

  function kindOf(id, file) {
    id = String(id || '');
    let m = /^w([1-5])-(\d+|boss)$/.exec(id);
    if (m) return { kind: 'world', world: +m[1], boss: m[2] === 'boss', index: m[2] === 'boss' ? null : +m[2] };
    if (/^test-[A-Za-z0-9_-]+$/.test(id)) return { kind: 'test' };
    if (/^e-\d+-\d+$/.test(id)) return { kind: 'endless' };
    if (/^fx-[A-Za-z0-9_-]+$/.test(id) && (!file || /^tools\/fixtures\//.test(file))) return { kind: 'fixture' };
    return { kind: 'bad' };
  }

  // ------------------------------------------------------------------ one level
  // entry: {id, raw (def), file, owner}; ctx: {AP, opts, dupIds:Set}
  // → {id, file, owner, problems:[{code, sev:'error'|'warn'|'info', msg}], info}
  function lintLevel(entry, ctx) {
    const AP = ctx.AP;
    const def = entry.raw || entry.def || {};
    const out = { id: def.id, file: entry.file || '', owner: entry.owner || '', problems: [], info: {} };
    const P = (code, msg, sev) => out.problems.push({ code, sev: sev || (code[0] === 'E' ? 'error' : code[0] === 'W' ? 'warn' : 'info'), msg });
    const k = kindOf(def.id, entry.file);
    out.kind = k.kind;
    const W = AP && AP.Worlds && typeof AP.Worlds.get === 'function' ? AP.Worlds : null;
    const world = def.world | 0;
    const boss = !!def.boss;
    // ---- E01
    if (k.kind === 'bad') P('E01', 'id "' + def.id + '" is not a valid level id (wN-k, wN-boss, test-*, e-<seed>-<seg>' + (/^fx-/.test(def.id) ? '; fx-* ids are reserved for tools/fixtures' : '') + ')');
    if (k.kind === 'world') {
      if (world !== k.world) P('E01', 'id ' + def.id + ' belongs to world ' + k.world + ' but world is ' + JSON.stringify(def.world));
      if (k.boss !== boss) P('E01', 'id ' + def.id + (k.boss ? ' must have boss: true' : ' must not have boss: true'));
      const wd = W ? W.get(k.world) : null;
      if (!k.boss && wd && (k.index < 1 || k.index > wd.levels)) P('E01', 'id ' + def.id + ' is outside world ' + k.world + "'s " + wd.levels + ' levels');
      if (!k.boss && def.index !== undefined && def.index !== k.index) P('E01', 'index ' + JSON.stringify(def.index) + ' does not match id ' + def.id);
    }
    if (k.kind === 'endless' && world !== 0) P('E01', 'endless segment ' + def.id + ' must be world 0');
    if (ctx.dupIds && ctx.dupIds.has(def.id)) P('E01', 'id ' + def.id + ' is registered more than once (' + ctx.dupWhere.get(def.id).join(', ') + ')');
    for (const key of Object.keys(def)) if (!LEVEL_KEYS.has(key)) P('W00', 'unknown level key "' + key + '"');
    if (def.name !== undefined && (typeof def.name !== 'string' || def.name.length > 22)) P('W00', 'name should be a string of at most 22 characters (' + JSON.stringify(def.name) + ')');
    // ---- E02
    const forms = (AP && AP.FORMS) || [3, 4, 5, 6, 99];
    if (forms.indexOf(def.form) < 0) P('E02', 'form ' + JSON.stringify(def.form) + ' is not one of ' + forms.join(', '));
    else if (world >= 1 && W && W.get(world) && def.form !== W.get(world).form) P('E02', 'form ' + def.form + ' must equal world ' + world + "'s form " + W.get(world).form);
    const styles = (AP && AP.STYLES) || ['title', 'map', 'w1', 'w2', 'w3', 'w4', 'w5', 'endless', 'void'];
    if (def.style !== undefined && styles.indexOf(def.style) < 0) P('E02', 'style "' + def.style + '" is not in AP.STYLES');
    if (def.music !== undefined && !(AP && AP.MUSIC && Object.prototype.hasOwnProperty.call(AP.MUSIC, def.music))) P('E02', 'music "' + def.music + '" is not an AP.MUSIC key');
    if (world >= 1 && !(W && W.get(world))) P('E02', 'world ' + world + ' does not exist in AP.Worlds');
    // ---- parse
    const parsed = lp.parse(def, AP);
    for (const pr of parsed.problems) P(pr.code, pr.msg);
    out.info.size = parsed.w + '×' + parsed.h;
    // ---- E03
    if (Array.isArray(def.map)) {
      def.map.forEach((r, i) => { if (typeof r !== 'string') P('E03', 'map row ' + i + ' is not a string'); });
      if (!parsed.rectangular) {
        const lens = {};
        parsed.rows.forEach((r, i) => { (lens[r.length] = lens[r.length] || []).push(i); });
        P('E03', 'map is not rectangular: row lengths ' + Object.keys(lens).map(l => l + ' (rows ' + summarizeList(lens[l]) + ')').join(', '));
      }
      const spaces = [];
      const bad = new Map();
      for (const b of parsed.badChars) {
        if (b.ch === ' ') spaces.push(b.tx + ',' + b.ty);
        else { if (!bad.has(b.ch)) bad.set(b.ch, []); bad.get(b.ch).push(b.tx + ',' + b.ty); }
      }
      if (spaces.length) P('E03', 'spaces are illegal in maps (' + spaces.length + ' at ' + summarizeList(spaces) + '); use "."');
      for (const [ch, at] of bad) P('E03', 'illegal map character ' + JSON.stringify(ch) + ' at ' + summarizeList(at) + ' (not a tile, entity or legend key)');
      const w = parsed.w, h = parsed.h;
      if (boss) {
        if (w < 30 || h < 17 || w > 40 || h > 60) P('E03', 'boss arena is ' + w + '×' + h + '; allowed 30×17 up to 40×60');
      } else if (w < 30 || w > 400 || h < 17 || h > 120 || w * h > 24000) {
        P('E03', 'map is ' + w + '×' + h + ' (' + (w * h) + ' tiles); allowed width 30–400, height 17–120, w·h ≤ 24000');
      }
    }
    // ---- E04 legend
    const legend = def.legend && typeof def.legend === 'object' ? def.legend : {};
    const allowed = allowedTypes(AP, world, k.kind);
    for (const key of Object.keys(legend)) {
      if (!lp.LEGEND_KEY_RE.test(key)) P('E04', 'legend key ' + JSON.stringify(key) + ' is invalid (single char a–u, w–z or 4–9; uppercase and "v" are reserved)');
      const v = legend[key];
      const type = typeof v === 'string' ? v : v && typeof v === 'object' ? v.type : undefined;
      if (typeof type !== 'string') { P('E04', 'legend ' + key + ' has no type'); continue; }
      const r = lp.entityDef(AP, type);
      if (!r.def) P('E04', 'legend ' + key + ': type "' + type + '" is not registered');
      else if (allowed && !allowed(type)) P('E04', 'legend ' + key + ': type "' + type + '" is not allowed in world ' + world + ' (common, w' + world + '.* and AP.Worlds.get(' + world + ').shared only)');
      else if (r.fallback) P('I00', 'legend ' + key + ': "' + type + '" is not registered yet; using the CONTRACT §2.16 fallback', 'info');
      if (!parsed.legendUse[key]) P('W05', 'legend key ' + JSON.stringify(key) + ' is never used in the map');
    }
    // ---- spawns: E09 (entities array, required keys), E07, E08
    const cnt = parsed.counts;
    const w = parsed.w, h = parsed.h;
    const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= w || ty >= h) ? -1 : parsed.tiles[ty * w + tx];
    const charAt = (tx, ty) => (ty >= 0 && ty < parsed.rows.length && tx >= 0) ? parsed.rows[ty].charAt(tx) : '';
    const STANDABLE_CH = new Set(['#', '=', '+', '~']);
    const crumbleCells = new Set();
    for (const s of parsed.spawns) if (s.type === 'crumble' && s.src === 'map') crumbleCells.add(s.tx + ',' + s.ty);
    for (const s of parsed.spawns) {
      const where = s.src === 'map' ? JSON.stringify(s.ch) + ' at ' + s.tx + ',' + s.ty : 'entities[' + s.entIndex + '] (' + s.type + ')';
      if (s.src === 'entities') {
        if (typeof s.type !== 'string') { P('E09', where + ' has no type'); continue; }
        if (!s.def) { P('E09', where + ': type "' + s.type + '" is not registered'); continue; }
        if (allowed && !allowed(s.type)) P('E09', where + ': type "' + s.type + '" is not allowed in world ' + world);
        if (!isFinite(s.tx) || !isFinite(s.ty) || s.tx < 0 || s.ty < 0 || s.tx >= w || s.ty >= h) P('E09', where + ': position ' + s.tx + ',' + s.ty + ' is outside the ' + w + '×' + h + ' map');
        if (Array.isArray(s.spec.path)) s.spec.path.forEach((p, i) => {
          if (!Array.isArray(p) || p.length < 2 || !isFinite(p[0]) || !isFinite(p[1]) || p[0] < 0 || p[1] < 0 || p[0] >= w || p[1] >= h) P('E09', where + ': path[' + i + '] ' + JSON.stringify(p) + ' is outside the map');
        });
      }
      if (!s.def) continue;
      const req = Array.isArray(s.def.required) ? s.def.required : [];
      for (const rk of req) if (s.spec[rk] === undefined) P('E09', where + ': required spec key "' + rk + '" is missing for ' + s.type);
      if (s.sizeError) P('E09', where + ': ' + s.type + ' ' + s.sizeError);
      // E07 standable below
      const needFloor = s.src === 'map' ? 'PCEBS'.indexOf(s.ch) >= 0 || (s.def.anchor === 'floor' && !lp.ZONE_TYPES.has(s.type)) : (s.def.anchor || 'floor') === 'floor' && !lp.ZONE_TYPES.has(s.type);
      if (needFloor && s.rect) {
        const bottom = s.rect[1] + s.rect[3];
        const cx = s.rect[0] + s.rect[2] / 2;
        const row = bottom / 32, col = Math.floor(cx / 32);
        let ok = false;
        if (Math.abs(row - Math.round(row)) < 1e-6) {
          const ch = charAt(col, Math.round(row));
          ok = STANDABLE_CH.has(ch) || crumbleCells.has(col + ',' + Math.round(row));
        }
        if (!ok) P('E07', where + ' (' + s.type + ') needs a standable tile (# = + ~) directly below it');
      }
      // E08 overlap with SOLID/BREAK
      // zones (tile-anchored sensors such as camzone or w3.wind) may legitimately cover walls
      if (s.rect && !lp.ZONE_TYPES.has(s.type) && !(s.def.kind === 'sensor' && s.def.anchor === 'tile')) {
        const r = s.rect;
        const tx0 = Math.floor(r[0] / 32), tx1 = Math.floor((r[0] + r[2] - 0.001) / 32);
        const ty0 = Math.floor(r[1] / 32), ty1 = Math.floor((r[1] + r[3] - 0.001) / 32);
        const hit = [];
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          const c = tileAt(tx, ty);
          if (c === 1 || c === 7) hit.push(tx + ',' + ty);
        }
        if (hit.length) P('E08', where + ' (' + s.type + ', ' + Math.round(r[2]) + '×' + Math.round(r[3]) + 'u) overlaps solid tiles at ' + summarizeList(hit));
      }
    }
    // E08: hazards around P
    const pSpawn = parsed.spawns.find(s => s.type === 'player');
    if (pSpawn) {
      const px = Math.round(pSpawn.tx), py = Math.round(pSpawn.ty);
      const hz = [];
      for (let ty = py - 1; ty <= py; ty++) for (let tx = px - 1; tx <= px + 1; tx++) { const c = tileAt(tx, ty); if (c >= 3 && c <= 6) hz.push(tx + ',' + ty); }
      const region = [(px - 1) * 32, (py - 1) * 32, 96, 64];
      for (const s of parsed.spawns) {
        if (!s.def || !s.rect || !(s.def.hazard || s.def.lint === 'hazard')) continue;
        const r = s.rect;
        if (r[0] < region[0] + region[2] && r[0] + r[2] > region[0] && r[1] < region[1] + region[3] && r[1] + r[3] > region[1]) hz.push(s.type);
      }
      if (hz.length) P('E08', 'hazards in the 3×2 tiles around P (' + px + ',' + py + '): ' + summarizeList(hz));
    }
    // ---- E05 counts
    const gemsStr = 'gems 1/2/3 ×' + cnt.gems[1] + '/' + cnt.gems[2] + '/' + cnt.gems[3];
    const sev05 = (k.kind === 'test') ? 'warn' : 'error';
    if (cnt.P !== 1) P('E05', 'P count is ' + cnt.P + ' (exactly 1 required)', k.kind === 'test' && cnt.P > 0 ? 'warn' : 'error');
    if (k.kind === 'endless') {
      if (cnt.E !== 1) P('E05', 'endless segment needs exactly 1 E (found ' + cnt.E + ')');
      if (cnt.V) P('E05', 'endless segment must not contain V');
    } else {
      if (boss) {
        if (cnt.V !== 1) P('E05', 'boss level needs exactly 1 V (found ' + cnt.V + ')', sev05);
        if (cnt.E !== 0) P('E05', 'boss level must not contain E (found ' + cnt.E + ')', sev05);
        if (cnt.bossEntities.length !== 1) P('E05', 'boss level needs exactly one boss entity (def.boss), found ' + cnt.bossEntities.length + (cnt.bossEntities.length ? ' (' + cnt.bossEntities.map(s => s.type).join(', ') + ')' : ''), sev05);
        if (cnt.gems[1] + cnt.gems[2] + cnt.gems[3] + cnt.gemBad) P('E05', 'boss level must not contain gems', sev05);
      } else if (k.kind !== 'test') {
        if (cnt.E !== 1) P('E05', 'needs exactly 1 E (found ' + cnt.E + ')');
        if (cnt.V !== 0) P('E05', 'normal levels must not contain V (found ' + cnt.V + ')');
        if (cnt.gems[1] !== 1 || cnt.gems[2] !== 1 || cnt.gems[3] !== 1 || cnt.gemBad) P('E05', 'needs gems 1, 2 and 3 exactly once (' + gemsStr + (cnt.gemBad ? ', ' + cnt.gemBad + ' gem(s) with a bad n' : '') + ')');
        if (cnt.shards < 10) P('E05', 'needs at least 10 shards (found ' + cnt.shards + ')');
        if (cnt.bossEntities.length) P('E05', 'normal levels must not contain boss entities (' + cnt.bossEntities.map(s => s.type).join(', ') + ')');
      }
    }
    // ---- E06 borders
    if (parsed.rows.length && parsed.w) {
      const rows = parsed.rows;
      const lintCfg = def.lint && typeof def.lint === 'object' ? def.lint : {};
      const badL = [], badR = [];
      rows.forEach((r, i) => { if (r.charAt(0) !== '#') badL.push(i); if (r.charAt(r.length - 1) !== '#') badR.push(i); });
      if (badL.length) P('E06', 'first column must be all "#" (rows ' + summarizeList(badL) + ')');
      if (badR.length) P('E06', 'last column must be all "#" (rows ' + summarizeList(badR) + ')');
      if (!lintCfg.openTop && /[^#]/.test(rows[0])) P('E06', 'top row must be all "#" unless lint.openTop is set');
      const last = rows[rows.length - 1];
      const badB = [];
      for (let i = 0; i < last.length; i++) if ('#.^'.indexOf(last.charAt(i)) < 0) badB.push(i);
      if (badB.length) P('E06', 'bottom row may only contain "#", "." and "^" (columns ' + summarizeList(badB) + ')');
    }
    // ---- E10 signs
    const signs = def.signs;
    if (signs !== undefined && !Array.isArray(signs)) P('E10', 'signs must be an array');
    const sArr = Array.isArray(signs) ? signs : [];
    if (sArr.length !== cnt.S) P('E10', 'signs.length is ' + sArr.length + ' but the map has ' + cnt.S + ' S');
    sArr.forEach((t, i) => {
      if (typeof t !== 'string') P('E10', 'signs[' + i + '] is not a string');
      else if (t.length > 120) P('E10', 'signs[' + i + '] is ' + t.length + ' chars (max 120)');
    });
    // ---- E13 annotations
    const lint = def.lint;
    let annCount = 0;
    if (lint !== undefined && (lint === null || typeof lint !== 'object')) P('E13', 'lint must be an object');
    const lcfg = lint && typeof lint === 'object' ? lint : {};
    for (const key of Object.keys(lcfg)) if (!LINT_KEYS.has(key)) P('W00', 'unknown lint key "' + key + '"');
    const inMap = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    for (const key of ['stand', 'open']) {
      if (lcfg[key] === undefined) continue;
      if (!Array.isArray(lcfg[key])) { P('E13', 'lint.' + key + ' must be an array of [x, y] cells'); continue; }
      const cells = lp.cellList(lcfg[key]);
      annCount += lcfg[key].length;
      const out2 = cells.filter(c => !inMap(c[0], c[1])).map(c => c.join(','));
      if (out2.length) P('E13', 'lint.' + key + ' cells outside the map: ' + summarizeList(out2));
    }
    if (lcfg.edges !== undefined) {
      if (!Array.isArray(lcfg.edges)) P('E13', 'lint.edges must be an array');
      else {
        annCount += lcfg.edges.length;
        lp.edgeList(lcfg.edges).forEach((e, i) => {
          if (e.invalid) P('E13', 'lint.edges[' + i + '] must be [x1, y1, x2, y2], [[x1, y1], [x2, y2]] or {from, to}');
          else if (!inMap(e.a[0], e.a[1]) || !inMap(e.b[0], e.b[1])) P('E13', 'lint.edges[' + i + '] has an end outside the map');
        });
      }
    }
    if (lcfg.skip && !boss) P('E13', 'lint.skip is only allowed in boss levels');
    const usesAnn = annCount > 0 || !!lcfg.skip;
    if (usesAnn && !(typeof lcfg.note === 'string' && lcfg.note.trim())) P('E13', 'lint annotations are used, so lint.note must explain them');
    if (annCount > 12) P('W03', annCount + ' lint annotations (more than 12)');
    // ---- CORE loader cross-check
    if (AP && AP.Levels && typeof AP.Levels.compile === 'function' && !ctx.opts.noCompile) {
      try { AP.Levels.compile(def); } catch (e) { P('E03', "CORE's AP.Levels.compile throws on this level: " + e.message); }
    }
    // ---- W06 par, W01 targets (counts), W04 fairness
    if (k.kind === 'world' && !boss) {
      if (def.par === undefined) P('W06', 'par is missing');
      const T = TARGETS[world];
      if (T) {
        if (cnt.C < T.cps[0] || cnt.C > T.cps[1]) P('W01', cnt.C + ' checkpoints (world ' + world + ' target ' + T.cps.join('–') + ')');
        if (cnt.shards < T.shards[0] || cnt.shards > T.shards[1]) P('W01', cnt.shards + ' shards (world ' + world + ' target ' + T.shards.join('–') + ')');
        if (typeof def.par === 'number' && (def.par < T.time[0] || def.par > T.time[1])) P('W01', 'par ' + def.par + ' s outside the first-clear target ' + T.time.join('–') + ' s');
      }
    } else if (k.kind === 'world' && boss && def.par === undefined) P('W06', 'par is missing');
    fairness(parsed, out, P);
    // ---- reachability
    if (!ctx.opts.noReach && !hasBlocking(out.problems)) {
      const t0 = cli.hrtimeMs();
      let geo = null;
      try { geo = lp.geometry(parsed, AP); } catch (e) { P('E11', 'could not build the bot geometry: ' + e.message); }
      if (geo) {
        let r = null;
        try { r = reach.analyze(geo, { budgetMs: ctx.opts.budget || 30000, noExpert: k.kind === 'endless' }); }
        catch (e) { P('E11', 'reachability bot crashed: ' + (e && e.stack || e)); }
        if (r) {
          const skip = !!lcfg.skip && boss;
          for (const pr of r.problems) {
            if (pr.code === 'BUDGET') { P('E11', pr.msg); continue; }
            if (skip && (pr.code === 'E11' || pr.code === 'E12')) P(pr.code, pr.msg + ' (lint.skip: downgraded)', 'warn');
            else if (k.kind === 'test' && (pr.code === 'E11' || pr.code === 'E12')) P(pr.code, pr.msg + ' (test level: warning only)', 'warn');
            else P(pr.code, pr.msg);
          }
          out.info.reach = r.info;
          const T = TARGETS[world];
          if (k.kind === 'world' && !boss && T && r.info.pathLen !== null && (r.info.pathLen < T.path[0] || r.info.pathLen > T.path[1])) P('W01', 'SAFE path length ' + r.info.pathLen + ' tiles (world ' + world + ' target ' + T.path.join('–') + ')');
          for (const sp of r.info.cpSpacing) if (sp.d > 45) P('W02', sp.d + ' tiles of path from ' + sp.from + ' to ' + sp.to + ' (more than 45 between checkpoints)');
          for (const n of r.info.notes || []) P('W00', n);
          if (r.info.ms > 3000) P('W00', 'reachability took ' + (r.info.ms / 1000).toFixed(1) + ' s (budget 3 s per level)');
        }
      }
      out.info.reachMs = Math.round(cli.hrtimeMs() - t0);
    } else if (!ctx.opts.noReach) {
      P('I00', 'reachability skipped until the structural errors above are fixed', 'info');
    }
    return out;
  }
  function hasBlocking(problems) { return problems.some(p => p.sev === 'error' && (p.code === 'E03' || (p.code === 'E05' && /P count/.test(p.msg)))); }

  function allowedTypes(AP, world, kind) {
    if (kind !== 'world' || !(world >= 1)) return null;
    const W = AP && AP.Worlds;
    const common = W && W.types && Array.isArray(W.types.common) ? W.types.common : Object.keys(lp.COMMON_FALLBACK);
    const wd = W && typeof W.get === 'function' ? W.get(world) : null;
    const shared = wd && Array.isArray(wd.shared) ? wd.shared : [];
    const pre = 'w' + world + '.';
    return t => common.indexOf(t) >= 0 || t.indexOf(pre) === 0 || shared.indexOf(t) >= 0;
  }

  // W04: hazards within 6 tiles of P or a C toward the exit
  function fairness(parsed, out, P) {
    const exit = parsed.spawns.find(s => s.type === 'exit' || s.type === 'vertex');
    const w = parsed.w, h = parsed.h;
    const starts = parsed.spawns.filter(s => s.type === 'player' || s.type === 'checkpoint');
    for (const s of starts) {
      const dir = exit ? (exit.tx >= s.tx ? 1 : -1) : 1;
      const x0 = Math.round(s.tx), y0 = Math.round(s.ty);
      const found = [];
      for (let dx = 1; dx <= 6; dx++) {
        const tx = x0 + dir * dx;
        if (tx < 0 || tx >= w) break;
        for (let ty = y0 - 3; ty <= y0 + 1; ty++) {
          if (ty < 0 || ty >= h) continue;
          const c = parsed.tiles[ty * w + tx];
          if (c >= 3 && c <= 6) found.push('spike ' + tx + ',' + ty);
        }
      }
      const zx0 = dir > 0 ? (x0 + 1) * 32 : (x0 - 6) * 32, zx1 = zx0 + 6 * 32, zy0 = (y0 - 3) * 32, zy1 = (y0 + 2) * 32;
      for (const e of parsed.spawns) {
        if (!e.def || !e.rect || !(e.def.hazard || e.def.lint === 'hazard')) continue;
        const r = e.rect;
        if (r[0] < zx1 && r[0] + r[2] > zx0 && r[1] < zy1 && r[1] + r[3] > zy0) found.push(e.type + ' ' + Math.round(e.tx) + ',' + Math.round(e.ty));
      }
      if (found.length) P('W04', 'hazard within 6 tiles of ' + (s.type === 'player' ? 'P' : 'C') + ' (' + x0 + ',' + y0 + ') toward the exit: ' + summarizeList(found));
    }
  }

  function summarizeList(list, max) {
    max = max || 6;
    if (list.length <= max) return list.join(' ');
    return list.slice(0, max).join(' ') + ' … (+' + (list.length - max) + ')';
  }

  // ------------------------------------------------------------------ loading
  function loadLevels(opts) {
    const extra = (opts.files || []).map(f => cli.rel(f));
    const h = harness.create({ lintMode: true, boot: false, extraFiles: extra, gl: 'null' });
    const AP = h.AP;
    const levels = (h.registry && h.registry.levels) || [];
    const loadProblems = h.errors().map(e => harness.fmtError(e));
    return { h, AP, levels, loadProblems };
  }

  function selectLevels(all, opts) {
    let list = all.filter(e => e && e.raw && e.id);
    if (opts.files && opts.files.length) {
      const fset = new Set(opts.files.map(f => cli.rel(f)));
      list = list.filter(e => fset.has(e.file));
    } else if (opts.fixtures) {
      list = list.filter(e => /^tools\/fixtures\//.test(e.file));
    } else {
      list = list.filter(e => !/^tools\/fixtures\//.test(e.file));
    }
    if (opts.id) list = list.filter(e => e.id === opts.id);
    if (opts.world !== null && opts.world !== undefined) list = list.filter(e => (e.raw.world | 0) === opts.world);
    return list;
  }

  // per-world counts (E01) for the worlds in scope
  function worldCounts(all, AP, worlds) {
    const out = [];
    const W = AP && AP.Worlds;
    if (!W || typeof W.get !== 'function') return out;
    for (const n of worlds) {
      const wd = W.get(n);
      if (!wd) continue;
      const ids = new Set(all.filter(e => e.raw && (e.raw.world | 0) === n).map(e => e.id));
      const missing = [];
      for (let i = 1; i <= wd.levels; i++) if (!ids.has('w' + n + '-' + i)) missing.push('w' + n + '-' + i);
      if (!ids.has(wd.boss || 'w' + n + '-boss')) missing.push(wd.boss || 'w' + n + '-boss');
      const extra = Array.from(ids).filter(id => !/^w[1-5]-(\d+|boss)$/.test(id) || (id !== wd.boss && +id.split('-')[1] > wd.levels));
      if (missing.length) out.push({ code: 'E01', sev: 'error', msg: 'world ' + n + ' is missing ' + missing.join(', ') + ' (needs ' + wd.levels + ' levels + boss)' });
      if (extra.length) out.push({ code: 'E01', sev: 'error', msg: 'world ' + n + ' has unexpected levels ' + extra.join(', ') });
    }
    return out;
  }

  // ------------------------------------------------------------------ endless fuzz
  function endlessLevels(AP, h, K, rep) {
    const out = [];
    if (!(AP && AP.Endless && typeof AP.Endless.generate === 'function')) {
      try { h.boot(); } catch (e) { /* reported below */ }
    }
    if (!(AP && AP.Endless && typeof AP.Endless.generate === 'function')) {
      rep.error('endless', 'AP.Endless.generate is not available (js/endless/generator.js missing or failed to load)');
      return out;
    }
    for (let i = 0; i < K; i++) {
      const seed = 1000 + i * 7919;
      const segment = i % 10;
      const difficulty = Math.min(1, segment / 9);
      let lvl = null;
      try { lvl = AP.Endless.generate(seed, segment, { difficulty }); }
      catch (e) { rep.error('endless', 'AP.Endless.generate(' + seed + ', ' + segment + ') threw: ' + e.message); continue; }
      if (!lvl || typeof lvl !== 'object') { rep.error('endless', 'AP.Endless.generate(' + seed + ', ' + segment + ') returned ' + lvl); continue; }
      out.push({ id: lvl.id, raw: lvl, file: 'js/endless/generator.js', owner: 'W1', seed, segment });
    }
    return out;
  }

  // ------------------------------------------------------------------ main
  function run(argv) {
    const args = cli.parseArgs(argv, { world: 'int', id: 'string', endless: 'int', noReach: 'bool', fixtures: 'bool', verbose: 'bool', json: 'bool', budget: 'int', quiet: 'bool', strict: 'bool' });
    const rep = new cli.Report('lint-levels');
    for (const e of args._errors) rep.error('args', e);
    if (args._errors.length) { rep.print(); console.log(rep.summary()); return 2; }
    const fileArgs = args._.filter(a => /\.js$/.test(a));
    let fixtureFiles = [];
    if (args.fixtures) fixtureFiles = cli.listDir('tools/fixtures', p => /\.js$/.test(p));
    const t0 = cli.hrtimeMs();
    const L = loadLevels({ files: fileArgs.concat(fixtureFiles) });
    for (const m of L.loadProblems) rep.warn('load', m);
    const opts = { noReach: args.noReach, budget: args.budget, world: args.world, id: args.id, files: fileArgs, fixtures: args.fixtures };
    // duplicates over everything registered
    const seen = new Map();
    for (const e of L.levels) { if (!e || !e.id) continue; if (!seen.has(e.id)) seen.set(e.id, []); seen.get(e.id).push(e.file); }
    const dupIds = new Set(), dupWhere = new Map();
    for (const [id, fl] of seen) if (fl.length > 1) { dupIds.add(id); dupWhere.set(id, fl); }
    // the last registration wins in the game; lint each distinct id once (the last)
    const lastById = new Map();
    for (const e of L.levels) if (e && e.id) lastById.set(e.id, e);
    let list = selectLevels(Array.from(lastById.values()), opts);
    if (args.endless) list = endlessLevels(L.AP, L.h, args.endless, rep);
    const ctx = { AP: L.AP, opts, dupIds, dupWhere };
    const results = [];
    for (const entry of list) {
      let r;
      try { r = lintLevel(entry, ctx); }
      catch (e) { r = { id: entry.id, file: entry.file, problems: [{ code: 'E00', sev: 'error', msg: 'lint crashed: ' + (e && e.stack || e) }], info: {} }; }
      results.push({ entry, r });
    }
    // per-world counts
    const worldScope = args.endless || args.id || args.fixtures || fileArgs.length ? [] : (args.world ? [args.world] : [1, 2, 3, 4, 5]);
    const wc = worldCounts(Array.from(lastById.values()).filter(e => !/^tools\/fixtures\//.test(e.file)), L.AP, worldScope);
    // ---- report
    let fixturesOk = true;
    const fixtureLines = [];
    for (const { entry, r } of results) {
      const errs = r.problems.filter(p => p.sev === 'error');
      const warns = r.problems.filter(p => p.sev === 'warn');
      const codes = Array.from(new Set(errs.map(p => p.code))).sort();
      const ri = r.info.reach;
      const reachTxt = ri ? ' · reach ' + (ri.ms / 1000).toFixed(2) + ' s, ' + ri.nodes + ' spots' + (ri.pathLen !== null ? ', path ' + ri.pathLen : '') + (ri.tier ? ', ' + ri.tier : '') : '';
      if (args.fixtures) {
        const meta = entry.raw.meta || {};
        const expect = Array.isArray(meta.expect) ? meta.expect.slice().sort() : [];
        const expectWarn = Array.isArray(meta.expectWarn) ? meta.expectWarn : [];
        const wcodes = new Set(warns.map(p => p.code));
        const match = JSON.stringify(expect) === JSON.stringify(codes) && expectWarn.every(c => wcodes.has(c));
        if (!match) fixturesOk = false;
        fixtureLines.push((match ? cli.C.green('  ok   ') : cli.C.red('  FAIL ')) + r.id.padEnd(28) + ' expected [' + expect.join(',') + (expectWarn.length ? ' warn ' + expectWarn.join(',') : '') + '] got [' + codes.join(',') + ']' + cli.C.dim(reachTxt));
        if (!match || args.verbose) for (const p of r.problems) if (p.sev !== 'info' || args.verbose) fixtureLines.push('         ' + p.code + ' ' + p.msg);
        continue;
      }
      if (!args.quiet || errs.length) {
        const head = (errs.length ? cli.C.red('FAIL ') : cli.C.green('ok   ')) + (r.id || '?').padEnd(16) + cli.C.dim(' ' + (r.file || '') + (r.info.size ? ' ' + r.info.size : '') + reachTxt) + (warns.length ? cli.C.yellow(' ' + warns.length + ' warning' + (warns.length === 1 ? '' : 's')) : '');
        if (!args.json) console.log(head);
      }
      for (const p of r.problems) {
        if (p.sev === 'info' && !args.verbose) continue;
        if (p.sev === 'warn' && args.quiet) continue;
        rep.add(p.sev === 'error' ? 'error' : p.sev === 'warn' ? 'warn' : 'info', r.id + ' ' + p.code, p.msg, { printed: true });
        if (!args.json) console.log('   ' + (p.sev === 'error' ? cli.C.red(p.code) : p.sev === 'warn' ? cli.C.yellow(p.code) : cli.C.dim(p.code)) + ' ' + p.msg);
      }
    }
    for (const p of wc) { rep.add(p.sev, 'E01', p.msg, { printed: true }); if (!args.json) console.log('   ' + cli.C.red('E01') + ' ' + p.msg); }
    if (args.json) {
      console.log(JSON.stringify(results.map(x => ({ id: x.r.id, file: x.r.file, problems: x.r.problems, info: x.r.info })).concat(wc.length ? [{ id: '(worlds)', problems: wc }] : []), null, 1));
    }
    if (args.fixtures) {
      for (const l of fixtureLines) console.log(l);
      const n = results.length;
      if (!n) { console.log(cli.C.red('FAIL') + ' no fixture levels found in tools/fixtures'); return 1; }
      const nBad = fixtureLines.filter(l => /FAIL/.test(l)).length;
      console.log((fixturesOk ? cli.C.green(cli.C.bold('PASS')) : cli.C.red(cli.C.bold('FAIL'))) + ' lint-levels --fixtures: ' + n + ' fixture levels, ' + nBad + ' not matching meta.expect (' + ((cli.hrtimeMs() - t0) / 1000).toFixed(1) + ' s)');
      return fixturesOk ? 0 : 1;
    }
    if (!results.length && !wc.length) {
      const why = args.endless ? 'no endless segments generated' : args.id ? 'level ' + args.id + ' is not registered' : 'no levels registered' + (args.world ? ' for world ' + args.world : '');
      if (args.id || args.endless || args.world) rep.error('select', why); else rep.warn('select', why);
    }
    const nErr = results.filter(x => x.r.problems.some(p => p.sev === 'error')).length;
    if (!args.json) {
      for (const it of rep.items) if (!(it.extra && it.extra.printed) && (it.level !== 'info' || args.verbose)) console.log(cli.Report.fmt(it));
      console.log(rep.summary() + ' — ' + results.length + ' level' + (results.length === 1 ? '' : 's') + ', ' + nErr + ' failing');
    }
    return rep.errors ? 1 : 0;
  }

  module.exports = { run, lintLevel, loadLevels, kindOf, TARGETS };
  if (require.main === module) cli.runMain(run);
})();
