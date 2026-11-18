/* js/game/progress.js — owner: CORE */
(function (AP) {
  'use strict';

  var orderCache = null;

  function worlds() { return (AP.Worlds && AP.Worlds.list) || []; }

  // [w1-1, w1-2, w1-3, w1-boss, w2-1, ..., w5-boss]
  function order() {
    if (!orderCache) {
      var out = [];
      var W = worlds();
      for (var i = 0; i < W.length; i++) {
        for (var k = 1; k <= W[i].levels; k++) out.push(W[i].id + '-' + k);
        out.push(W[i].boss);
      }
      orderCache = out;
    }
    return orderCache.slice();
  }

  function next(id) {
    var o = order();
    var i = o.indexOf(id);
    return (i >= 0 && i < o.length - 1) ? o[i + 1] : null;
  }

  function data() { return AP.Save.data; }

  function isUnlocked(id) {
    if (Progress.unlockAll && AP.DEV) return true;
    if (!id) return false;
    if (order().indexOf(id) < 0) return true;      // test-*, endless and other non-story levels
    return data().unlocked[id] === true;
  }

  function parseId(id) {
    var m = /^w([1-5])-(\d+|boss)$/.exec(String(id || ''));
    if (!m) return null;
    return { world: +m[1], boss: m[2] === 'boss', index: m[2] === 'boss' ? 0 : +m[2] };
  }

  function unlock(id, list) {
    var d = data();
    if (!id || d.unlocked[id] === true) return;
    d.unlocked[id] = true;
    list.push(id);
  }

  // run: {time, deaths, shards, shardsTotal, gems:[b,b,b], assisted, grantForm, ending}
  // -> {firstClear, newBest, unlocked:[ids], formGained, ending}
  function complete(id, run) {
    run = run || {};
    var S = AP.Save;
    var d = data();
    var res = { firstClear: false, newBest: false, unlocked: [], formGained: 0, ending: false };
    var rec = S.level(id);
    var pid = parseId(id);
    var W = pid ? AP.Worlds.get(pid.world) : null;
    res.firstClear = !rec.done;
    rec.done = true;
    rec.clears = (rec.clears | 0) + 1;
    rec.deaths = (rec.deaths | 0) + Math.max(0, run.deaths | 0);
    if ((run.shards | 0) > rec.shards) rec.shards = run.shards | 0;
    if ((run.shardsTotal | 0) > 0) rec.shardsTotal = run.shardsTotal | 0;
    if (run.gems) for (var g = 0; g < 3; g++) if (run.gems[g]) rec.gems[g] = true;
    var t = +run.time;
    if (!run.assisted && t > 0 && isFinite(t)) {
      var prev = rec.best;
      if (!(prev > 0) || t < prev) {
        rec.best = t;
        res.newBest = prev > 0;
      }
      rec.assisted = false;
    } else if (run.assisted && !(rec.best > 0)) {
      rec.assisted = true;
    }
    if (res.firstClear) S.stat('levelsDone');
    if (pid && pid.boss) S.stat('bossKills');

    // unlocks
    if (pid && W) {
      if (pid.boss) {
        var nextWorld = AP.Worlds.get(pid.world + 1);
        if (nextWorld) unlock(nextWorld.id + '-1', res.unlocked);
        if (W.reward && W.reward > (d.form | 0)) { d.form = W.reward; res.formGained = W.reward; }
        if (W.n === 5) {
          d.flags.endlessUnlocked = true;
          res.ending = true;
        }
      } else {
        if (pid.index < W.levels) unlock(W.id + '-' + (pid.index + 1), res.unlocked);
        var all = true;
        for (var k = 1; k <= W.levels; k++) {
          var r = d.levels[W.id + '-' + k];
          if (!r || !r.done) { all = false; break; }
        }
        if (all) unlock(W.boss, res.unlocked);
      }
    }
    var gf = run.grantForm | 0;
    if (gf && AP.FORMS.indexOf(gf) >= 0 && gf > (d.form | 0)) {
      d.form = gf;
      res.formGained = gf;
    }
    if (run.ending) res.ending = true;
    S.save(true);
    return res;
  }

  // completion %: levels 50, gems 30, best shards 20
  function percent() {
    var d = data();
    var ids = order();
    if (!ids.length) return 0;
    var done = 0, gems = 0, gemsTotal = 0, shardFrac = 0, normal = 0;
    for (var i = 0; i < ids.length; i++) {
      var r = d.levels[ids[i]];
      if (r && r.done) done++;
      if (!/-boss$/.test(ids[i])) {
        normal++;
        gemsTotal += 3;
        if (r) {
          for (var g = 0; g < 3; g++) if (r.gems[g]) gems++;
          if (r.shardsTotal > 0) shardFrac += Math.min(1, r.shards / r.shardsTotal);
        }
      }
    }
    var p = 50 * done / ids.length + (gemsTotal ? 30 * gems / gemsTotal : 0) + (normal ? 20 * shardFrac / normal : 0);
    return Math.max(0, Math.min(100, Math.round(p * 10) / 10));
  }

  function worldState(n) {
    var W = AP.Worlds.get(n);
    var out = { unlocked: false, done: false, levelsDone: 0, gems: 0, gemsTotal: 0 };
    if (!W) return out;
    var d = data();
    out.unlocked = isUnlocked(W.id + '-1');
    out.gemsTotal = W.levels * 3;
    for (var k = 1; k <= W.levels; k++) {
      var r = d.levels[W.id + '-' + k];
      if (r && r.done) out.levelsDone++;
      if (r) for (var g = 0; g < 3; g++) if (r.gems[g]) out.gems++;
    }
    var b = d.levels[W.boss];
    if (b && b.done) out.levelsDone++;
    out.done = !!(b && b.done);
    return out;
  }

  // first unlocked level that is not cleared yet (else the last unlocked) — "Continue"
  function current() {
    var o = order();
    var lastUnlocked = o[0];
    for (var i = 0; i < o.length; i++) {
      if (!isUnlocked(o[i])) continue;
      lastUnlocked = o[i];
      var r = data().levels[o[i]];
      if (!r || !r.done) return o[i];
    }
    return lastUnlocked;
  }

  var Progress = {
    unlockAll: false,
    order: order,
    next: next,
    isUnlocked: isUnlocked,
    complete: complete,
    percent: percent,
    worldState: worldState,
    current: current,
    parseId: parseId
  };
  AP.Progress = Progress;
})(window.AP = window.AP || {});
