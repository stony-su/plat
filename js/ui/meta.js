/* js/ui/meta.js — owner: UI */
(function (AP) {
  'use strict';

  // AP.Meta: toasts, the theorem engine and unlocks. AP.Cosmetics: trails, palettes and their unlock rules.
  //
  // The theorem engine listens only to CONTRACT 2.4 events and reads AP.Save.data. A proof persists as
  // AP.Save.data.theorems[id] = true. Counters that CORE does not keep (wall-jumps, double jumps, pauses,
  // finished Endless runs) live in extra AP.Save.data.stats keys, which AP.Save preserves.
  var TAU = Math.PI * 2;
  var GA = 2.399963229728653;          // golden angle (radians)
  var EMPTY = {};

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function data() { return AP.Save && AP.Save.data; }
  function now() { return (AP.Time && AP.Time.now) || 0; }
  function num(v) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : 0; }
  function stats() { var d = data(); return (d && d.stats) || EMPTY; }

  var Meta = {
    levelTheorems: [],     // ids proved since the last level:start (shown on the results screen)
    lastUnlocked: [],      // result.unlocked of the last completed story level (map celebration)
    lastResult: null,
    ready: false
  };

  // ================================================================ toasts
  // Top-centre, stacking, sliding in and out. Kinds: 'info', 'warn', 'theorem' (id = theorem id),
  // 'cosmetic' (id = cosmetic id), 'endless', 'form' (id = form).
  var TOAST_DUR = 3.9, TOAST_IN = 0.42, TOAST_OUT = 0.45, TOAST_MAX = 3;
  var pending = [];
  var active = [];
  var lastToastFrame = -1;
  var lastToastNow = 0;

  function sameToast(a, title, sub) { return a.title === title && a.sub === sub; }

  function pushToast(o) {
    o = o || EMPTY;
    var title = String(o.title === undefined || o.title === null ? '' : o.title);
    var sub = o.sub === undefined || o.sub === null ? '' : String(o.sub);
    if (!title && !sub) return false;
    var t = now(), i;
    for (i = 0; i < pending.length; i++) if (sameToast(pending[i], title, sub)) return false;
    for (i = 0; i < active.length; i++) if (sameToast(active[i], title, sub) && t - active[i].t0 < TOAST_DUR - 1) return false;
    if (pending.length >= 12) pending.shift();
    pending.push({ title: title, sub: sub, kind: o.kind || 'info', id: o.id === undefined ? null : o.id, t0: 0, y: -90,
      quiet: !!o.quiet, w: 0 });
    return true;
  }
  Meta.pushToast = pushToast;

  Meta.toast = function (title, sub) {
    var warn = /unavailable|failed|error|could not/i.test(String(title || ''));
    return pushToast({ title: title, sub: sub, kind: warn ? 'warn' : 'info' });
  };

  Meta.clearToasts = function () { pending.length = 0; active.length = 0; };
  Meta.toastCount = function () { return pending.length + active.length; };

  var TT = { size: 15, weight: '700', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  var TS = { size: 12, weight: '500', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  var TK = { size: 10, weight: '800', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  var STROKE_O = { size: 17, color: '#FFFFFF', align: 'left', glow: null, glowAlpha: 0.8, alpha: 1, progress: 1, sparks: false };

  function toastPal() { return AP.R.pal('title'); }

  function toastHeight(t) { return (t.kind === 'theorem' || t.sub) ? 54 : 40; }

  function toastWidth(ctx, t) {
    if (t.w) return t.w;
    var UI = AP.UI;
    var w1 = 0, w2 = 0;
    if (t.kind === 'theorem' && UI && UI.measure) w1 = UI.measure(t.title, 17) + 8;
    else w1 = AP.R.measure(ctx, t.title, 15, '700');
    if (t.sub) w2 = AP.R.measure(ctx, t.sub, 12, '500');
    if (t.kind === 'theorem') w2 = Math.max(w2, AP.R.measure(ctx, 'THEOREM PROVED', 10, '800') + 20);
    t.w = Math.max(280, Math.min(560, Math.max(w1, w2) + 96));
    return t.w;
  }

  function drawToastIcon(ctx, t, x, y, pal, a, age) {
    var UI = AP.UI;
    var pa = ctx.globalAlpha;
    var draw = clamp01(age / 0.6);
    if (t.kind === 'theorem' && UI && UI.emblem) {
      AP.R.glow(ctx, x, y, 26, pal.accent, 0.4 * a);
      UI.emblem(ctx, t.id, x, y, 13 * (0.6 + 0.4 * AP.M.ease.outBack(draw)), pal.accent, a, age);
    } else if (t.kind === 'cosmetic') {
      AP.R.glow(ctx, x, y, 22, pal.accent, 0.35 * a);
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var i = 0; i <= 40; i++) {
        var th = i / 40 * 4 * Math.PI * draw, r = 2 + i * 0.27 * draw;
        var px = x + Math.cos(th + age) * r, py = y + Math.sin(th + age) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else if (t.kind === 'endless' && UI && UI.strokeText) {
      AP.R.glow(ctx, x, y, 24, pal.accent, 0.45 * a);
      UI.strokeText(ctx, '∞', x, y, { size: 24, color: pal.ink, align: 'center', glow: pal.accent, alpha: a, progress: draw, sparks: false });
    } else if (t.kind === 'form' && UI && UI.formPath) {
      AP.R.glow(ctx, x, y, 24, pal.accent, 0.4 * a);
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 2;
      UI.formPath(ctx, x, y + 1, 11, t.id || 3, age * 0.8);
      ctx.stroke();
    } else if (t.kind === 'warn') {
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.hazard;
      ctx.lineWidth = 2;
      AP.R.star(ctx, x, y, 12, 6, 6, -Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = pal.hazard;
      ctx.fillRect(x - 1, y - 5, 2, 6);
      ctx.fillRect(x - 1, y + 3, 2, 2);
    } else {
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.8;
      AP.R.poly(ctx, x, y, 9, 4, age * 1.2);
      ctx.stroke();
      ctx.fillStyle = rgba(pal.accent, 0.3);
      ctx.fill();
      ctx.fillStyle = pal.ink;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = pa;
  }

  function drawToast(ctx, t, x, y, w, h, a, age, pal) {
    var UI = AP.UI;
    var pa = ctx.globalAlpha;
    var acc = t.kind === 'warn' ? pal.hazard : pal.accent;
    if (UI && UI.panel) UI.panel(ctx, x, y, w, h, { pal: pal, alpha: a, accent: acc, cut: 10, fillAlpha: 0.9 });
    else {
      ctx.globalAlpha = pa * a;
      ctx.fillStyle = rgba('#05060D', 0.9);
      ctx.fillRect(x, y, w, h);
    }
    // a light sweep across the panel as it lands
    var sweep = clamp01((age - 0.15) / 0.6);
    if (sweep > 0 && sweep < 1) {
      ctx.globalAlpha = pa * a * 0.22 * Math.sin(sweep * Math.PI);
      ctx.fillStyle = pal.ink;
      var sx = x + w * sweep;
      ctx.beginPath();
      ctx.moveTo(sx - 18, y + 1); ctx.lineTo(sx + 6, y + 1); ctx.lineTo(sx - 6, y + h - 1); ctx.lineTo(sx - 30, y + h - 1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = pa;
    drawToastIcon(ctx, t, x + 30, y + h / 2, pal, a, age);
    var tx = x + 58;
    if (t.kind === 'theorem') {
      TK.color = acc; TK.alpha = a;
      AP.R.text(ctx, 'THEOREM PROVED', tx, y + 16, TK);
      if (UI && UI.strokeText) {
        STROKE_O.color = pal.ink; STROKE_O.glow = acc; STROKE_O.alpha = a; STROKE_O.progress = clamp01((age - 0.1) / 0.9);
        STROKE_O.maxW = w - 72;
        UI.strokeText(ctx, t.title, tx, y + 36, STROKE_O);
      } else {
        TT.color = pal.ink; TT.alpha = a;
        AP.R.text(ctx, t.title, tx, y + 36, TT);
      }
    } else {
      TT.color = t.kind === 'warn' ? pal.hazard : pal.ink; TT.alpha = a;
      AP.R.text(ctx, t.title, tx, y + (t.sub ? 19 : h / 2), TT);
      if (t.sub) {
        TS.color = AP.Color.rgba(pal.primary, 0.9); TS.alpha = a;
        AP.R.text(ctx, t.sub, tx, y + 37, TS);
      }
    }
  }

  Meta.renderToasts = function (ctx) {
    var frame = AP.Time ? AP.Time.frame : 0;
    if (frame === lastToastFrame) return;
    lastToastFrame = frame;
    var t = now();
    var dt = Math.min(0.1, Math.max(0, t - lastToastNow));
    lastToastNow = t;
    if (dirty) flushChecks();
    var i;
    for (i = active.length - 1; i >= 0; i--) if (t - active[i].t0 > TOAST_DUR) active.splice(i, 1);
    while (active.length < TOAST_MAX && pending.length) {
      var n = pending.shift();
      n.t0 = t;
      n.y = active.length ? active[active.length - 1].y + 30 : -70;
      active.push(n);
      if (!n.quiet) AP.sfx('toast', { vol: n.kind === 'theorem' ? 0.9 : 0.7 });
    }
    if (!active.length) return;
    var pal = toastPal();
    // during a boss fight the stack starts below the boss bar
    var L = AP.level;
    var y = (L && L.bossInfo && AP.Scenes && AP.Scenes.current === 'level') ? 60 : 14;
    var k = 1 - Math.exp(-dt * 14);
    for (i = 0; i < active.length; i++) {
      var to = active[i];
      var age = t - to.t0;
      var h = toastHeight(to);
      var w = toastWidth(ctx, to);
      var inK = clamp01(age / TOAST_IN), outK = clamp01((TOAST_DUR - age) / TOAST_OUT);
      to.y += (y - to.y) * (age < 0.02 ? 0 : k);
      var dy = -(1 - AP.M.ease.outBack(inK)) * 64 - (1 - AP.M.ease.outCubic(outK)) * 46;
      var a = Math.min(clamp01(inK * 1.7), outK);
      if (a > 0.003) drawToast(ctx, to, 480 - w / 2, to.y + dy, w, h, a, age, pal);
      y += (h + 8) * Math.min(1, outK * 1.4);
    }
  };

  // ================================================================ theorem engine
  var BOSS_THEOREM = { 'w1-boss': 'tiling', 'w2-boss': 'crystallographic', 'w3-boss': 'navier-stokes', 'w4-boss': 'banach-tarski', 'w5-boss': 'qed' };
  var FORM_THEOREM = [[4, 'pythagoras'], [5, 'golden-ratio'], [6, 'honeycomb'], [99, 'squaring-circle']];
  var DESIGN_PAR = {
    'w1-1': 60, 'w1-2': 80, 'w1-3': 95, 'w2-1': 70, 'w2-2': 85, 'w2-3': 95, 'w2-4': 110,
    'w3-1': 80, 'w3-2': 95, 'w3-3': 105, 'w3-4': 115, 'w3-5': 125,
    'w4-1': 85, 'w4-2': 100, 'w4-3': 110, 'w4-4': 120, 'w4-5': 130, 'w4-6': 145,
    'w5-1': 90, 'w5-2': 110, 'w5-3': 125, 'w5-4': 135, 'w5-5': 150, 'w5-6': 170
  };

  var byId = null;
  function theoremIndex() {
    if (byId) return byId;
    byId = {};
    var list = AP.Theorems || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) byId[list[i].id] = list[i];
    return byId;
  }
  Meta.theorem = function (id) { return theoremIndex()[id] || null; };

  function isProved(id) {
    var d = data();
    return !!(d && d.theorems && d.theorems[id] === true);
  }
  Meta.isProved = isProved;

  Meta.provedCount = function () {
    var list = AP.Theorems || [], n = 0;
    for (var i = 0; i < list.length; i++) if (isProved(list[i].id)) n++;
    return n;
  };

  // par of a level: the registered def first, then the DESIGN target
  function parOf(id) {
    var def = AP.Levels && AP.Levels.get ? AP.Levels.get(id) : null;
    var p = def && +def.par;
    if (p > 0) return p;
    return DESIGN_PAR[id] || 0;
  }
  Meta.parOf = parOf;

  function gemCount() {
    var d = data();
    if (!d || !d.levels) return 0;
    var n = 0;
    for (var id in d.levels) {
      if (!Object.prototype.hasOwnProperty.call(d.levels, id) || !/^w[1-5]-\d+$/.test(id)) continue;
      var r = d.levels[id];
      if (r && r.gems) for (var g = 0; g < 3; g++) if (r.gems[g] === true) n++;
    }
    return n;
  }
  Meta.gemCount = gemCount;

  function percent() { return AP.Progress && AP.Progress.percent ? num(AP.Progress.percent()) : 0; }

  function endlessRuns() {
    var d = data();
    var a = d && d.endless ? num(d.endless.runs) : 0;
    return Math.max(a, num(stats().endlessEnds));
  }

  // progress toward a theorem with a numeric goal: {value, goal} or null
  Meta.progress = function (id) {
    var th = theoremIndex()[id];
    if (!th || !(th.goal > 0)) return null;
    var s = stats(), v = 0;
    switch (id) {
      case 'prime-hunter': case 'sieve': case 'infinitude': v = gemCount(); break;
      case 'seven-bridges': v = num(s.secrets); break;
      case 'large-numbers': v = num(s.shards); break;
      case 'mobius': v = num(s.deaths); break;
      case 'parallel': v = num(s.wallJumps); break;
      case 'pentagram': v = num(s.doubleJumps); break;
      case 'vector-space': v = num(s.dashes); break;
      case 'halting': v = num(s.pauses); break;
      case 'monte-carlo': v = endlessRuns(); break;
      case 'four-color': v = AP.Cosmetics ? AP.Cosmetics.unlockedCount() : 0; break;
      case 'godel': v = Math.floor(percent()); break;
      case 'fibonacci': v = run.bestChain; break;
      case 'kepler': v = run.bestFling; break;
      case 'hilbert': v = run.bestSegments; break;
      default: v = 0;
    }
    if (isProved(id)) v = th.goal;
    return { value: Math.max(0, Math.min(th.goal, Math.floor(v))), goal: th.goal };
  };

  // unlock(id[, quiet]) -> true when newly proved
  var unlockDepth = 0;
  Meta.unlock = function (id, quiet) {
    var th = theoremIndex()[id];
    var d = data();
    if (!th || !d) return false;
    if (!d.theorems || typeof d.theorems !== 'object') d.theorems = {};
    if (d.theorems[id] === true) return false;
    d.theorems[id] = true;
    if (AP.Save && AP.Save.save) AP.Save.save(true);
    if (Meta.levelTheorems.indexOf(id) < 0) Meta.levelTheorems.push(id);
    if (!quiet) pushToast({ title: th.name, kind: 'theorem', id: id });
    AP.Events.emit('theorem', { id: id, name: th.name });
    unlockDepth++;
    if (unlockDepth < 4) {
      checkCosmetics(quiet);
      checkState(quiet);
    }
    unlockDepth--;
    return true;
  };

  function tryProve(id, cond, quiet) { if (cond && !isProved(id)) Meta.unlock(id, quiet); }

  function bossCleared(d, id) {
    var r = d.levels && d.levels[id];
    return !!(r && r.done && r.best > 0);
  }

  function parBeaten(d, id) {
    var r = d.levels && d.levels[id];
    var par = parOf(id);
    return !!(r && r.done && r.best > 0 && par > 0 && r.best <= par);
  }

  function brachistochrone(d) {
    var W = (AP.Worlds && AP.Worlds.list) || [];
    for (var i = 0; i < W.length; i++) {
      var all = true;
      for (var k = 1; k <= W[i].levels; k++) if (!parBeaten(d, W[i].id + '-' + k)) { all = false; break; }
      if (all && W[i].levels > 0) return true;
    }
    return false;
  }

  function anyLevel(d, fn) {
    if (!d.levels) return false;
    for (var id in d.levels) if (Object.prototype.hasOwnProperty.call(d.levels, id) && fn(id, d.levels[id])) return true;
    return false;
  }

  // every theorem that follows from AP.Save.data alone
  function checkState(quiet) {
    var d = data();
    if (!d) return;
    var s = d.stats || EMPTY;
    var f = d.form | 0;
    for (var i = 0; i < FORM_THEOREM.length; i++) tryProve(FORM_THEOREM[i][1], f >= FORM_THEOREM[i][0], quiet);
    for (var b in BOSS_THEOREM) if (bossCleared(d, b)) tryProve(BOSS_THEOREM[b], true, quiet);
    var gems = gemCount();
    tryProve('prime-hunter', gems >= 10, quiet);
    tryProve('sieve', gems >= 36, quiet);
    tryProve('infinitude', gems >= 72, quiet);
    tryProve('axiom', num(s.levelsDone) >= 1 || anyLevel(d, function (id, r) { return /^w[1-5]-/.test(id) && r && r.done; }), quiet);
    tryProve('zeno', anyLevel(d, function (id) { return /^w[1-5]-\d+$/.test(id) && parBeaten(d, id); }), quiet);
    tryProve('tessellation', anyLevel(d, function (id, r) { return /^w[1-5]-\d+$/.test(id) && r && r.shardsTotal > 0 && r.shards >= r.shardsTotal; }), quiet);
    tryProve('brachistochrone', brachistochrone(d), quiet);
    tryProve('seven-bridges', num(s.secrets) >= 7, quiet);
    tryProve('large-numbers', num(s.shards) >= 1000, quiet);
    tryProve('mobius', num(s.deaths) >= 100, quiet);
    tryProve('parallel', num(s.wallJumps) >= 100, quiet);
    tryProve('pentagram', num(s.doubleJumps) >= 200, quiet);
    tryProve('vector-space', num(s.dashes) >= 500, quiet);
    tryProve('halting', num(s.pauses) >= 25, quiet);
    tryProve('monte-carlo', endlessRuns() >= 10, quiet);
    tryProve('four-color', AP.Cosmetics && AP.Cosmetics.unlockedCount() >= 4, quiet);
    tryProve('godel', percent() >= 100, quiet);
  }
  Meta.checkAll = function (quiet) { checkCosmetics(quiet); checkState(quiet); };

  // deferred evaluation: event handlers mark the state dirty; the next frame evaluates it
  var dirty = false;
  function markDirty() { dirty = true; }
  function flushChecks() {
    dirty = false;
    checkCosmetics(false);
    checkState(false);
  }

  // per-run trackers (from events only)
  var run = { mode: 'story', id: '', airborne: false, chain: 0, bestChain: 0, flings: 0, bestFling: 0, lastFlingNode: null,
    orbitNode: null, bestSegments: 0 };

  function resetArc() {
    run.airborne = false;
    run.chain = 0;
    run.flings = 0;
    run.lastFlingNode = null;
  }

  function stat(key) { if (AP.Save && AP.Save.stat) AP.Save.stat(key); }

  function onLevelStart(p) {
    p = p || EMPTY;
    run.mode = p.mode || 'story';
    run.id = p.id || '';
    resetArc();
    run.orbitNode = null;
    Meta.levelTheorems.length = 0;
  }

  function onLevelComplete(res) {
    if (!res) return;
    Meta.lastResult = res;
    if (res.mode === 'story') Meta.lastUnlocked = (res.unlocked && res.unlocked.slice) ? res.unlocked.slice() : [];
    if (res.mode !== 'test') {
      tryProve('axiom', true);
      if (!res.assisted && (res.deaths | 0) === 0) tryProve('euler-path', true);
      var par = parOf(res.id);
      if (res.mode === 'story' && !res.assisted && par > 0 && res.time > 0 && res.time <= par) tryProve('zeno', true);
      if ((res.shardsTotal | 0) > 0 && (res.shards | 0) >= (res.shardsTotal | 0)) tryProve('tessellation', true);
      var g = res.gems;
      if (g && g[0] && g[1] && g[2]) tryProve('pigeonhole', true);
    }
    flushChecks();
  }

  function onBossDefeat(p) {
    if (!p || run.mode !== 'story') return;
    var th = BOSS_THEOREM[p.id];
    if (th) tryProve(th, true);
  }

  function onJump(p) {
    run.airborne = true;
    var kind = p && p.kind;
    if (kind === 'wall') { stat('wallJumps'); markDirty(); }
    else if (kind === 'double') { stat('doubleJumps'); markDirty(); }
  }

  function onLand(p) {
    if (p && p.vy >= 1080) tryProve('galileo', true);
    resetArc();
  }

  function onShard() {
    if (run.airborne) {
      run.chain++;
      if (run.chain > run.bestChain) run.bestChain = run.chain;
      if (run.chain >= 13) tryProve('fibonacci', true);
    }
    markDirty();
  }

  function onOrbit(p) { run.orbitNode = (p && p.node) || null; }

  function onFling(p) {
    run.airborne = true;
    if (p && p.speed > 1100) tryProve('escape-velocity', true);
    var node = run.orbitNode;
    if (!node || node !== run.lastFlingNode) {
      run.flings++;
      run.lastFlingNode = node;
      if (run.flings > run.bestFling) run.bestFling = run.flings;
      if (run.flings >= 5) tryProve('kepler', true);
    }
  }

  function onSegment(p) {
    var seg = p ? (p.segment | 0) : 0;
    if (seg > run.bestSegments) run.bestSegments = seg;
    if (seg >= 10) tryProve('hilbert', true);
  }

  function onEndlessEnd(p) {
    stat('endlessEnds');
    var segs = p ? (p.segments | 0) : 0;
    if (segs > run.bestSegments) run.bestSegments = segs;
    if (segs >= 10) tryProve('hilbert', true);
    markDirty();
  }

  function onScene(p) {
    if (p && p.to === 'pause') { stat('pauses'); markDirty(); }
  }

  function onSettings(p) {
    if (p && p.key === '*') {
      // a reset or an import replaced the whole save: re-derive quietly
      checkCosmetics(true);
      checkState(true);
    }
  }

  Meta.init = function () {
    if (Meta.ready) return;
    Meta.ready = true;
    var E = AP.Events;
    E.on('level:start', onLevelStart);
    E.on('level:complete', onLevelComplete);
    E.on('boss:defeat', onBossDefeat);
    E.on('form:gain', markDirty);
    E.on('collect:gem', markDirty);
    E.on('collect:shard', onShard);
    E.on('secret:found', markDirty);
    E.on('player:death', function () { resetArc(); markDirty(); });
    E.on('player:respawn', resetArc);
    E.on('player:jump', onJump);
    E.on('player:land', onLand);
    E.on('player:dash', markDirty);
    E.on('player:orbit', onOrbit);
    E.on('player:fling', onFling);
    E.on('endless:segment', onSegment);
    E.on('endless:end', onEndlessEnd);
    E.on('scene:change', onScene);
    E.on('settings:changed', onSettings);
    // whatever the save already proves (old or imported saves) is granted quietly
    checkCosmetics(true);
    checkState(true);
    Meta.levelTheorems.length = 0;
  };

  // ================================================================ cosmetics
  var TRAILS = [
    { id: 'none', name: 'None', gems: 0, desc: 'The faint afterimage of past outlines.' },
    { id: 'spirograph', name: 'Spirograph', gems: 6, desc: 'Hypotrochoid loops, as if a pen rode a rolling gear.' },
    { id: 'fibonacci', name: 'Fibonacci', gems: 15, desc: 'Seeds scattered at the golden angle, like a sunflower.' },
    { id: 'sierpinski', name: 'Sierpinski Dust', gems: 27, desc: 'Tiny triangles that subdivide as they fade.' },
    { id: 'lissajous', name: 'Lissajous Ribbon', gems: 42, desc: 'Two frequencies braided into one ribbon.' },
    { id: 'prism', name: 'Prism', gems: 60, desc: 'Your past outlines, split into a spectrum.' },
    { id: 'apeiron', name: 'Apeiron', gems: 72, desc: 'A comet that writes the infinity sign.' }
  ];
  var PALETTES = [
    { id: 'default', name: 'Default', theorem: null, desc: 'Ink, lit by the world you stand in.' },
    { id: 'euler', name: 'Euler', theorem: 'euler-path', desc: 'Teal and white.', c: { stroke: '#FFFFFF', fill: '#2EE6C9', glow: '#2EE6C9', eye: '#FFFFFF' } },
    { id: 'pythagorean', name: 'Pythagorean', theorem: 'tiling', desc: 'Struck in gold.', c: { stroke: '#FFF0C2', fill: '#FFC23D', glow: '#FFB21F', eye: '#FFF8E6' } },
    { id: 'platonic', name: 'Platonic', theorem: 'squaring-circle', desc: 'Iridescent: it cycles through every hue.', c: null },
    { id: 'fractal', name: 'Fractal', theorem: 'banach-tarski', desc: 'Lime lines, pink light.', c: { stroke: '#B8FF5A', fill: '#FF6EC7', glow: '#FF6EC7', eye: '#F4FFE6' } },
    { id: 'prime', name: 'Prime', theorem: 'sieve', desc: 'Violet and cyan.', c: { stroke: '#C7B0FF', fill: '#4FF0FF', glow: '#8A6CFF', eye: '#FFFFFF' } },
    { id: 'null', name: 'Null', theorem: 'qed', desc: 'A black body, a white edge, light turned inside out.', c: { stroke: '#FFFFFF', fill: '#000000', glow: '#161616', eye: '#FFFFFF' } }
  ];
  var SPECTRUM = ['#FF3B5C', '#FF8A3D', '#FFE14D', '#5CFF8A', '#3DE8FF', '#4D7CFF', '#B04DFF'];

  function cosmeticsData() {
    var d = data();
    if (!d) return null;
    if (!d.cosmetics || typeof d.cosmetics !== 'object') d.cosmetics = { trail: 'none', palette: 'default', unlocked: ['none', 'default'] };
    if (!Array.isArray(d.cosmetics.unlocked)) d.cosmetics.unlocked = ['none', 'default'];
    return d.cosmetics;
  }

  function findIn(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  function isUnlocked(id) {
    if (id === 'none' || id === 'default') return true;
    var c = cosmeticsData();
    return !!(c && c.unlocked.indexOf(id) >= 0);
  }

  function unlockCosmetic(id, quiet) {
    var c = cosmeticsData();
    if (!c || c.unlocked.indexOf(id) >= 0) return false;
    c.unlocked.push(id);
    if (AP.Save && AP.Save.save) AP.Save.save(true);
    var tr = findIn(TRAILS, id), pl = findIn(PALETTES, id);
    if (!quiet) pushToast({ title: (tr ? 'Trail unlocked: ' : 'Palette unlocked: ') + (tr || pl).name, sub: 'Equip it in Cosmetics', kind: 'cosmetic', id: id });
    return true;
  }

  function checkCosmetics(quiet) {
    if (!cosmeticsData()) return;
    var gems = gemCount(), any = false, i;
    for (i = 0; i < TRAILS.length; i++) if (TRAILS[i].gems > 0 && gems >= TRAILS[i].gems && !isUnlocked(TRAILS[i].id)) any = unlockCosmetic(TRAILS[i].id, quiet) || any;
    for (i = 0; i < PALETTES.length; i++) if (PALETTES[i].theorem && isProved(PALETTES[i].theorem) && !isUnlocked(PALETTES[i].id)) any = unlockCosmetic(PALETTES[i].id, quiet) || any;
    if (any) tryProve('four-color', unlockedCount() >= 4, quiet);
  }

  function unlockedCount() {
    var c = cosmeticsData();
    if (!c) return 0;
    var n = 0;
    for (var i = 0; i < c.unlocked.length; i++) {
      var id = c.unlocked[i];
      if (id !== 'none' && id !== 'default' && (findIn(TRAILS, id) || findIn(PALETTES, id))) n++;
    }
    return n;
  }

  var reqCache = {};
  function requirement(id) {
    var hit = reqCache[id];
    if (hit) return hit;
    hit = reqCache[id] = requirementOf(id);
    return hit;
  }
  function requirementOf(id) {
    var tr = findIn(TRAILS, id);
    if (tr) return tr.gems > 0 ? 'Collect ' + tr.gems + ' prime gems' : 'Always available';
    var pl = findIn(PALETTES, id);
    if (pl && pl.theorem) {
      var th = theoremIndex()[pl.theorem];
      return 'Prove ' + (th ? th.name : pl.theorem);
    }
    return 'Always available';
  }

  // ---------------------------------------------------------------- palette styles (reused objects)
  var style = { fill: null, stroke: null, glow: null, eye: null };
  var HUES = null;
  function hueTable() {
    if (HUES) return HUES;
    HUES = { fill: [], glow: [], stroke: [] };
    for (var i = 0; i < 48; i++) {
      var h = i / 48;
      HUES.fill.push(hslHex(h, 0.95, 0.62));
      HUES.glow.push(hslHex(h + 0.08, 1, 0.6));
      HUES.stroke.push(hslHex(h - 0.06, 0.6, 0.9));
    }
    return HUES;
  }
  function hslHex(h, s, l) {
    h = h - Math.floor(h);
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function ch(t) {
      t = t - Math.floor(t);
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 0.5) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return AP.Color.toHex(ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255);
  }

  function styleOf(paletteId, form, t) {
    var pl = findIn(PALETTES, paletteId);
    if (!pl || pl.id === 'default') return null;
    if (pl.id === 'platonic') {
      var H = hueTable();
      var k = Math.floor((t * 0.11 + (form % 7) * 0.13) * 48);
      k = ((k % 48) + 48) % 48;
      style.fill = H.fill[k];
      style.glow = H.glow[(k + 4) % 48];
      style.stroke = H.stroke[(k + 24) % 48];
      style.eye = '#FFFFFF';
      return style;
    }
    style.fill = pl.c.fill;
    style.stroke = pl.c.stroke;
    style.glow = pl.c.glow;
    style.eye = pl.c.eye;
    return style;
  }

  function levelTime() {
    var L = AP.level;
    return L && typeof L.time === 'number' ? L.time : now();
  }

  function equipped(kind) {
    var c = cosmeticsData();
    if (!c) return kind === 'trail' ? 'none' : 'default';
    var v = kind === 'trail' ? c.trail : c.palette;
    var list = kind === 'trail' ? TRAILS : PALETTES;
    if (!findIn(list, v) || !isUnlocked(v)) return kind === 'trail' ? 'none' : 'default';
    return v;
  }

  // ---------------------------------------------------------------- trail history (distance-sampled ring)
  var HN = 84;
  function TrailState() {
    this.x = new Float32Array(HN);
    this.y = new Float32Array(HN);
    this.t = new Float32Array(HN);
    this.d = new Float32Array(HN);
    this.r = new Float32Array(HN);
    this.s = new Float32Array(HN);
    this.i = new Int32Array(HN);
    this.head = -1;
    this.len = 0;
    this.dist = 0;
    this.count = 0;
    this.lastT = -1;
    this.owner = null;
  }
  TrailState.prototype.reset = function () { this.head = -1; this.len = 0; this.dist = 0; };
  TrailState.prototype.sample = function (x, y, t, rot, speed) {
    if (t < this.lastT - 0.05) this.reset();
    this.lastT = t;
    if (this.len > 0) {
      var h = this.head, dx = x - this.x[h], dy = y - this.y[h];
      var dd = Math.sqrt(dx * dx + dy * dy);
      if (dd > 150) this.reset();
      else if (dd < 4.5) { this.s[h] = Math.max(this.s[h] * 0.9, speed); return; }
      else this.dist += dd;
    }
    var n = (this.head + 1) % HN;
    this.head = n;
    this.x[n] = x; this.y[n] = y; this.t[n] = t; this.d[n] = this.dist; this.r[n] = rot; this.s[n] = speed; this.i[n] = this.count++;
    if (this.len < HN) this.len++;
  };
  // index of the k-th newest sample
  TrailState.prototype.at = function (k) { return (this.head - k + HN * 2) % HN; };

  var liveState = new TrailState();

  // scratch buffers (no per-frame allocation)
  var SB = 4 * (HN + 1);
  var bx = new Float32Array(SB), by = new Float32Array(SB), bd = new Float32Array(SB), ba = new Float32Array(SB);
  var cx2 = new Float32Array(SB), cy2 = new Float32Array(SB), ex2 = new Float32Array(SB), ey2 = new Float32Array(SB);

  // builds a resampled centreline (head first): positions, arc length from the head, age fraction.
  // headArc is the absolute arc length at the head, so patterns stay fixed to the ground they were laid on.
  var headArc = 0;
  function centreline(st, hx, hy, t, life, sub) {
    var n = 0, k, j;
    headArc = st.dist;
    if (st.len > 0) {
      var h0 = st.at(0), gx = hx - st.x[h0], gy = hy - st.y[h0];
      headArc = st.dist + Math.sqrt(gx * gx + gy * gy);
    }
    bx[0] = hx; by[0] = hy; bd[0] = 0; ba[0] = 0; n = 1;
    var px = hx, py = hy, pd = 0, pAge = 0;
    for (k = 0; k < st.len && n < SB - sub; k++) {
      var idx = st.at(k);
      var age = (t - st.t[idx]) / life;
      if (age >= 1) break;
      if (age < pAge) age = pAge;
      var x = st.x[idx], y = st.y[idx];
      var dx = x - px, dy = y - py;
      var seg = Math.sqrt(dx * dx + dy * dy);
      for (j = 1; j <= sub; j++) {
        var f = j / sub;
        bx[n] = px + dx * f;
        by[n] = py + dy * f;
        bd[n] = pd + seg * f;
        ba[n] = pAge + (age - pAge) * f;
        n++;
      }
      px = x; py = y; pd += seg; pAge = age;
    }
    return n;
  }

  // draws the polyline (ox, oy arrays) in alpha bands from the head (alpha a0) to the tail (0)
  function bandStroke(ctx, xs, ys, n, color, width, a0, bands) {
    if (n < 2) return;
    var pa = ctx.globalAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    var per = Math.max(2, Math.ceil(n / bands));
    for (var b = 0; b * per < n - 1; b++) {
      var s = b * per, e = Math.min(n - 1, s + per);
      var a = a0 * (1 - ((s + e) * 0.5) / n);
      if (a <= 0.01) continue;
      ctx.globalAlpha = pa * a;
      ctx.beginPath();
      ctx.moveTo(xs[s], ys[s]);
      for (var i = s + 1; i <= e; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.stroke();
    }
    ctx.globalAlpha = pa;
  }

  // ---- 1. Spirograph: a pen riding a rolling gear lays hypotrochoid loops along the path
  function trailSpirograph(ctx, st, hx, hy, t, col, k) {
    var n = centreline(st, hx, hy, t, 0.7, 7);
    if (n < 3) return;
    var base = headArc;
    // a gear of radius 3.2 rolls along the path; the pen sits on an arm of 8.5 +- 2.5 that breathes at half the gear's
    // rate. The arm is longer than the gear, so the pen lays overlapping loops whose sizes nest: a spirograph band.
    for (var i = 0; i < n; i++) {
      var ph = (base - bd[i]) / 3.2;
      var arm = (8.5 + 2.5 * Math.sin(ph * 0.5)) * (1 - ba[i] * 0.3);
      cx2[i] = bx[i] + Math.cos(ph) * arm;
      cy2[i] = by[i] + Math.sin(ph) * arm;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var pc = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    bandStroke(ctx, cx2, cy2, n, col.c1, 5, 0.16 * k, 5);
    ctx.globalCompositeOperation = pc;
    bandStroke(ctx, bx, by, n, col.c3, 1, 0.22 * k, 4);
    bandStroke(ctx, cx2, cy2, n, col.c1, 2, 0.95 * k, 8);
    AP.R.glow(ctx, cx2[0], cy2[0], 12, col.c1, 0.7 * k);
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * k;
    ctx.fillStyle = col.c2;
    ctx.beginPath();
    ctx.arc(cx2[0], cy2[0], 2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = pa;
  }

  // ---- 2. Fibonacci: Vogel's sunflower model; each seed drifts out at the golden angle as it ages
  // Every sample sows two seeds; seed i sits at the golden angle i * 137.5 deg and drifts out as sqrt(age), so the
  // spray behind the player arranges itself into sunflower spirals. Fibonacci-numbered seeds are drawn larger.
  var FIBS = { 1: 1, 2: 1, 3: 1, 5: 1, 8: 1, 13: 1, 21: 1, 34: 1, 55: 1, 89: 1 };
  function trailFibonacci(ctx, st, hx, hy, t, col, k) {
    var life = 0.95, pa = ctx.globalAlpha;
    for (var band = 0; band < 3; band++) {
      for (var c = 0; c < 2; c++) {
        ctx.fillStyle = c === 0 ? col.c1 : col.c2;
        ctx.globalAlpha = pa * k * (band === 0 ? 1 : (band === 1 ? 0.7 : 0.38));
        ctx.beginPath();
        var any = false;
        for (var j = 0; j < st.len; j++) {
          var idx = st.at(j);
          var age = (t - st.t[idx]) / life;
          if (age >= 1) break;
          if (Math.min(2, Math.floor(age * 3)) !== band) continue;
          for (var q = 0; q < 2; q++) {
            var id = st.i[idx] * 2 + q;
            var big = FIBS[id % 96] === 1;
            if ((big ? 1 : 0) !== c) continue;
            var a = id * GA + age * 1.2, r = 3 + 24 * Math.sqrt(age);
            var x = st.x[idx] + Math.cos(a) * r, y = st.y[idx] + Math.sin(a) * r;
            var s = (0.9 + 2.6 * Math.pow(1 - age, 0.7)) * (big ? 1.5 : 1);
            ctx.moveTo(x + s, y);
            ctx.arc(x, y, s, 0, TAU);
            any = true;
          }
        }
        if (any) ctx.fill();
      }
    }
    ctx.globalAlpha = pa;
    if (st.len) { var h0 = st.at(0); AP.R.glow(ctx, st.x[h0], st.y[h0], 18, col.c1, 0.5 * k); }
  }

  // ---- 3. Sierpinski Dust: a triangle drops every few samples and subdivides (depth 0 -> 3) as it fades
  var GASKET = null;
  function gasket(depth) {
    if (!GASKET) {
      GASKET = [];
      for (var d = 0; d <= 3; d++) {
        var tris = null;
        if (AP.Algo && AP.Algo.sierpinski) { try { tris = AP.Algo.sierpinski(0, 0, 1, d); } catch (e) { tris = null; } }
        if (!tris || !tris.length) tris = [[0, -0.577, 0.5, 0.289, -0.5, 0.289]];
        var g = new Float32Array(tris.length * 6);
        for (var i = 0; i < tris.length; i++) for (var q = 0; q < 6; q++) g[i * 6 + q] = tris[i][q];
        GASKET.push(g);
      }
    }
    return GASKET[depth < 0 ? 0 : (depth > 3 ? 3 : depth)];
  }
  function trailSierpinski(ctx, st, hx, hy, t, col, k) {
    var life = 1.05, pa = ctx.globalAlpha;
    ctx.lineJoin = 'round';
    for (var j = 0; j < st.len; j++) {
      var idx = st.at(j);
      var age = (t - st.t[idx]) / life;
      if (age >= 1) break;
      var id = st.i[idx];
      if (id % 2 !== 0) continue;
      var depth = Math.min(3, Math.floor(age * 4.4));
      var g = gasket(depth);
      var size = 24 * (1 - 0.3 * age);
      var rot = id * 0.9 + age * 2.2;
      var cs = Math.cos(rot) * size, sn = Math.sin(rot) * size;
      var cx = st.x[idx] + Math.sin(id * 1.7) * 10 * age, cy = st.y[idx] + 30 * age * age;
      ctx.globalAlpha = pa * k * Math.pow(1 - age, 0.8);
      ctx.strokeStyle = depth % 2 === 0 ? col.c1 : col.c2;
      ctx.lineWidth = depth >= 3 ? 1 : (depth === 2 ? 1.3 : 1.8);
      ctx.beginPath();
      for (var q = 0; q < g.length; q += 6) {
        ctx.moveTo(cx + g[q] * cs - g[q + 1] * sn, cy + g[q] * sn + g[q + 1] * cs);
        ctx.lineTo(cx + g[q + 2] * cs - g[q + 3] * sn, cy + g[q + 2] * sn + g[q + 3] * cs);
        ctx.lineTo(cx + g[q + 4] * cs - g[q + 5] * sn, cy + g[q + 4] * sn + g[q + 5] * cs);
        ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.globalAlpha = pa;
  }

  // ---- 4. Lissajous Ribbon: two strands at frequencies 3 and 2 braid across the path's normal
  function trailLissajous(ctx, st, hx, hy, t, col, k) {
    var n = centreline(st, hx, hy, t, 0.8, 2);
    if (n < 4) return;
    var base = headArc;
    for (var i = 0; i < n; i++) {
      var i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1;
      var tx = bx[i0] - bx[i1], ty = by[i0] - by[i1];
      var tl = Math.sqrt(tx * tx + ty * ty) || 1;
      var nx = -ty / tl, ny = tx / tl;
      var u = (base - bd[i]) / 17;
      var amp = 12 * Math.sin(Math.min(1, (i + 1) / 6) * Math.PI / 2) * (1 - ba[i] * 0.55);
      var o1 = Math.sin(3 * u + t * 3) * amp, o2 = Math.sin(2 * u + t * 3 + Math.PI / 2) * amp;
      cx2[i] = bx[i] + nx * o1; cy2[i] = by[i] + ny * o1;
      ex2[i] = bx[i] + nx * o2; ey2[i] = by[i] + ny * o2;
    }
    var pa = ctx.globalAlpha;
    // translucent web between the strands
    ctx.globalAlpha = pa * k * 0.16;
    ctx.fillStyle = col.c1;
    ctx.beginPath();
    ctx.moveTo(cx2[0], cy2[0]);
    for (var a = 1; a < n; a++) ctx.lineTo(cx2[a], cy2[a]);
    for (var b = n - 1; b >= 0; b--) ctx.lineTo(ex2[b], ey2[b]);
    ctx.closePath();
    ctx.fill();
    // rungs where the strands are widest apart
    ctx.globalAlpha = pa * k * 0.35;
    ctx.strokeStyle = col.c2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var r = 3; r < n; r += 4) { ctx.moveTo(cx2[r], cy2[r]); ctx.lineTo(ex2[r], ey2[r]); }
    ctx.stroke();
    ctx.globalAlpha = pa;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    bandStroke(ctx, cx2, cy2, n, col.c1, 2.4, 0.95 * k, 6);
    bandStroke(ctx, ex2, ey2, n, col.c2, 1.8, 0.85 * k, 6);
  }

  // ---- 5. Prism: past outlines dispersed into the spectrum, offset across the motion
  function trailPrism(ctx, st, hx, hy, t, col, k, form) {
    var life = 0.6, pa = ctx.globalAlpha;
    var sides = form >= 32 ? 40 : Math.max(3, form | 0);
    var pc = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    var vx = 0, vy = 0;
    if (st.len > 2) { var a0 = st.at(0), a2 = st.at(2); vx = st.x[a0] - st.x[a2]; vy = st.y[a0] - st.y[a2]; }
    var vl = Math.sqrt(vx * vx + vy * vy) || 1;
    var nx = -vy / vl, ny = vx / vl;
    var drawn = 0;
    for (var j = 1; j < st.len && drawn < 22; j++) {
      var idx = st.at(j);
      var age = (t - st.t[idx]) / life;
      if (age >= 1) break;
      if (st.i[idx] % 2 !== 0) continue;
      drawn++;
      var band = st.i[idx] / 2 % 7;
      var off = (band - 3) * (1.6 + 5.5 * age);
      ctx.globalAlpha = pa * k * 0.75 * (1 - age);
      ctx.strokeStyle = SPECTRUM[band];
      AP.R.poly(ctx, st.x[idx] + nx * off, st.y[idx] + ny * off, 13 * (1 + 0.15 * age), sides, st.r[idx]);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = pc;
    ctx.globalAlpha = pa;
  }

  // ---- 6. Apeiron: a comet whose tail keeps writing the lemniscate of Bernoulli
  function trailApeiron(ctx, st, hx, hy, t, col, k) {
    var n = centreline(st, hx, hy, t, 0.85, 3);
    if (n < 3) return;
    var pc = ctx.globalCompositeOperation, pa = ctx.globalAlpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    // tapered comet body
    for (var pass = 0; pass < 3; pass++) {
      var w = [18, 8, 2.6][pass], a = [0.12, 0.26, 0.85][pass];
      bandStroke(ctx, bx, by, n, pass === 2 ? col.c2 : col.c1, w, a * k, 5);
    }
    // the figure-eight strand
    var base = headArc;
    for (var i = 0; i < n; i++) {
      var i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1;
      var tx = bx[i0] - bx[i1], ty = by[i0] - by[i1];
      var tl = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tl; ty /= tl;
      var u = (base - bd[i]) / 7 + t * 2.4;
      var s = Math.sin(u), c = Math.cos(u), dd = 1 + s * s;
      var amp = 16 * (1 - ba[i] * 0.6) * Math.min(1, (i + 2) / 8);
      var along = c / dd * amp * 0.9, across = s * c / dd * amp * 1.8;
      cx2[i] = bx[i] + tx * along - ty * across;
      cy2[i] = by[i] + ty * along + tx * across;
    }
    bandStroke(ctx, cx2, cy2, n, col.c1, 4.5, 0.18 * k, 6);
    bandStroke(ctx, cx2, cy2, n, col.c2, 1.8, 0.95 * k, 6);
    ctx.globalCompositeOperation = pc;
    ctx.globalAlpha = pa;
    AP.R.glow(ctx, hx, hy, 34, col.c1, 0.55 * k);
    // a tiny infinity sign orbiting the head
    var oa = t * 3.1;
    var ox = hx + Math.cos(oa) * 23, oy = hy + Math.sin(oa) * 23;
    ctx.globalAlpha = pa * k * 0.95;
    ctx.strokeStyle = col.c2;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var q = 0; q <= 24; q++) {
      var v = q / 24 * TAU, sv = Math.sin(v), cv = Math.cos(v), dv = 1 + sv * sv;
      var lx = cv / dv * 7, ly = sv * cv / dv * 7;
      var rx = lx * Math.cos(oa) - ly * Math.sin(oa), ry = lx * Math.sin(oa) + ly * Math.cos(oa);
      if (q === 0) ctx.moveTo(ox + rx, oy + ry); else ctx.lineTo(ox + rx, oy + ry);
    }
    ctx.stroke();
    ctx.globalAlpha = pa;
  }

  var TRAIL_FN = { spirograph: trailSpirograph, fibonacci: trailFibonacci, sierpinski: trailSierpinski, lissajous: trailLissajous,
    prism: trailPrism, apeiron: trailApeiron };

  // the dark halo and solid body of the Null palette (drawn under the player's own outline)
  var haloSprite = null, haloBroken = false;
  function nullHalo(ctx, x, y, r, a) {
    if (!haloSprite && !haloBroken) {
      try {
        var cv = document.createElement('canvas');
        cv.width = 96; cv.height = 96;
        var g = cv.getContext('2d');
        var grad = g.createRadialGradient(48, 48, 6, 48, 48, 48);
        grad.addColorStop(0, 'rgba(0,0,0,0.95)');
        grad.addColorStop(0.45, 'rgba(0,0,0,0.6)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 96, 96);
        haloSprite = cv;
      } catch (e) { haloBroken = true; }
    }
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * a;
    if (haloSprite) ctx.drawImage(haloSprite, x - r, y - r, r * 2, r * 2);
    else { ctx.fillStyle = rgba('#000000', 0.4); ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = pa;
  }

  function nullBody(ctx, x, y, form, rot, sx, sy, scale, a) {
    var n = form >= 32 ? 40 : Math.max(3, form | 0);
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * a;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var ang = rot + i * TAU / n;
      var px = Math.cos(ang) * 13, py = Math.sin(ang) * 13;
      var X = x + px * sx * scale, Y = y + py * sy * scale;
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = pa;
  }

  var colScratch = { c1: '#FFFFFF', c2: '#FFFFFF', c3: '#FFFFFF' };
  function trailColors(pal, sty) {
    colScratch.c1 = (sty && sty.fill && sty.fill !== '#000000') ? sty.fill : pal.accent;
    colScratch.c2 = (sty && sty.stroke) ? sty.stroke : pal.ink;
    colScratch.c3 = (sty && sty.glow && sty.glow !== '#161616') ? sty.glow : pal.primary;
    return colScratch;
  }

  // renderTrail(ctx, state, P, trailId, paletteId, time, pal) -> true when a cosmetic trail was drawn.
  // Shared by the live player (drawTrail) and the cosmetics preview. P needs rx, ry, w, h, vx, vy, form, vis.
  function renderTrail(ctx, st, P, trailId, paletteId, t, pal) {
    var vis = P.vis || EMPTY;
    var scale = P.exitScale === undefined ? 1 : num(P.exitScale);
    var hx = num(P.rx) + (P.w || 22) / 2, hy = num(P.ry) + (P.h || 22) / 2 + num(vis.offY);
    if (P.exitScale !== undefined && P.exitPull) { hx = num(P.exitPull.x); hy = num(P.exitPull.y); }
    var speed = Math.sqrt(num(P.vx) * num(P.vx) + num(P.vy) * num(P.vy));
    st.sample(hx, hy, t, num(vis.rot), speed);
    var sty = styleOf(paletteId, P.form || 3, t);
    var drew = false;
    if (paletteId === 'null') {
      var alpha = 1;
      if (P.invuln > 0 && P.state === 'normal') alpha = (Math.floor(P.invuln * 18) % 2 === 0) ? 0.45 : 0.95;
      nullHalo(ctx, hx, hy, 46 * scale, 0.85 * alpha);
      nullBody(ctx, hx, hy, P.form || 3, num(vis.rot), vis.sx || 1, vis.sy || 1, scale, 0.92 * alpha);
    }
    var fn = TRAIL_FN[trailId];
    if (fn) {
      var k = Math.min(1, scale * 1.2);
      ctx.save();
      try { fn(ctx, st, hx, hy, t, trailColors(pal, sty), k, P.form || 3); } finally { ctx.restore(); }
      drew = true;
    }
    return drew;
  }

  var Cosmetics = {
    TRAILS: TRAILS,
    PALETTES: PALETTES,
    SPECTRUM: SPECTRUM,
    TrailState: TrailState,
    isUnlocked: isUnlocked,
    unlockedCount: unlockedCount,
    requirement: requirement,
    trail: function (id) { return findIn(TRAILS, id); },
    palette: function (id) { return findIn(PALETTES, id); },
    equipped: equipped,
    styleOf: styleOf,
    renderTrail: renderTrail,
    check: function (quiet) { checkCosmetics(quiet); },

    // equip('trail'|'palette', id) -> true when equipped
    equip: function (kind, id) {
      var c = cosmeticsData();
      var list = kind === 'trail' ? TRAILS : PALETTES;
      if (!c || !findIn(list, id) || !isUnlocked(id)) return false;
      if (kind === 'trail') c.trail = id; else c.palette = id;
      if (AP.Save && AP.Save.save) AP.Save.save(true);
      return true;
    },

    // CONTRACT 2.19: {fill, stroke, glow, eye} or null (the world's default look)
    playerStyle: function (form) {
      return styleOf(equipped('palette'), form, levelTime());
    },

    // CONTRACT 2.19: world space, called before the player's body is drawn; true replaces the default trail
    drawTrail: function (ctx, P) {
      if (!P) return false;
      var L = AP.level;
      var st = liveState;
      if (st.owner !== P) { st.reset(); st.owner = P; st.lastT = -1; }
      var pal = (L && L.pal) || AP.R.pal('title');
      return renderTrail(ctx, st, P, equipped('trail'), equipped('palette'), levelTime(), pal);
    }
  };

  AP.Meta = Meta;
  AP.Cosmetics = Cosmetics;
})(window.AP = window.AP || {});
