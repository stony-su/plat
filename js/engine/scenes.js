/* js/engine/scenes.js — owner: CORE */
(function (AP) {
  'use strict';

  var TAU = Math.PI * 2;
  var reg = {};
  var stack = [];
  var trans = null;       // {name, params, fx, dur, color, t, swapped}
  var queued = null;      // last go() requested during a transition
  var crashed = null;     // {name, phase, msg}
  var FALLBACK_TO_DEVMENU = { title: 1, map: 1, intro: 1, ending: 1, credits: 1, results: 1, theorems: 1, cosmetics: 1, endless: 1 };

  var Scenes = {
    stack: stack,
    current: null
  };

  function safeCall(entry, method, a, b) {
    var sc = entry && entry.scene;
    if (!sc || typeof sc[method] !== 'function') return undefined;
    try {
      return sc[method](a, b);
    } catch (e) {
      onCrash(entry, method, e);
      return undefined;
    }
  }

  function onCrash(entry, phase, e) {
    AP.reportError('scene:' + (entry ? entry.name : '?') + '.' + phase, e);
    crashed = { name: entry ? entry.name : '?', phase: phase, msg: String((e && e.message) || e) };
  }

  function setPlayingClass() {
    var st = AP.R && AP.R.stage;
    if (!st || !st.classList) return;
    if (Scenes.current === 'level') st.classList.add('playing');
    else st.classList.remove('playing');
  }

  Scenes.register = function (name, scene) {
    if (!name || !scene || typeof scene !== 'object') { AP.warn('Scenes.register: bad scene', name); return false; }
    if (reg[name]) AP.warn('Scenes.register: duplicate scene "' + name + '" (last wins)');
    reg[name] = scene;
    return true;
  };

  Scenes.has = function (name) { return !!reg[name]; };
  Scenes.get = function (name) { return reg[name] || null; };
  Scenes.list = function () { return Object.keys(reg).sort(); };

  // resolve a scene name using the CORE fallback table (title/map/... -> devmenu)
  Scenes.resolve = function (name) {
    if (reg[name]) return name;
    if (FALLBACK_TO_DEVMENU[name] && reg.devmenu) return 'devmenu';
    return null;
  };

  function switchTo(name, params) {
    var target = Scenes.resolve(name);
    if (!target) {
      AP.warn('Scenes.go: unknown scene "' + name + '"');
      return false;
    }
    if (target !== name) AP.warnOnce('scene-fallback:' + name, 'Scene "' + name + '" missing; falling back to "' + target + '".');
    var from = Scenes.current;
    while (stack.length) {
      var top = stack.pop();
      Scenes.current = stack.length ? stack[stack.length - 1].name : null;
      safeCall(top, 'exit', target);
    }
    var entry = { name: target, scene: reg[target], params: params || {} };
    stack.push(entry);
    Scenes.current = target;
    crashed = null;
    setPlayingClass();
    safeCall(entry, 'enter', entry.params, from);
    if (AP.Events) AP.Events.emit('scene:change', { from: from, to: target });
    if (AP.Loop && AP.Loop.resync) AP.Loop.resync();
    return true;
  };

  // go(name, params, {fx:'fade'|'iris'|'shatter'|'none', dur:0.5, color}) — replaces the whole stack.
  // During a transition the request is queued (last call wins).
  Scenes.go = function (name, params, opts) {
    opts = opts || {};
    if (trans) {
      queued = { name: name, params: params, opts: opts };
      return true;
    }
    var fx = opts.fx || 'fade';
    var dur = opts.dur !== undefined ? +opts.dur : 0.5;
    if (!stack.length) {
      // nothing to cover: switch now and reveal the new scene (uncover half only)
      var ok = switchTo(name, params);
      if (ok && fx !== 'none' && dur > 0) {
        trans = { name: name, params: params, fx: fx, dur: dur, color: opts.color || '#000000', t: dur / 2, swapped: true };
        if (AP.Input) AP.Input.lock(dur / 2 + 0.02);
      }
      return ok;
    }
    if (fx === 'none' || !(dur > 0)) return switchTo(name, params);
    if (!Scenes.resolve(name)) { AP.warn('Scenes.go: unknown scene "' + name + '"'); return false; }
    trans = { name: name, params: params, fx: fx, dur: dur, color: opts.color || '#000000', t: 0, swapped: false };
    if (AP.Input) AP.Input.lock(dur + 0.02);
    return true;
  };

  // immediate switch: cancels any transition and queue (tests, crash recovery)
  Scenes.goNow = function (name, params) {
    trans = null;
    queued = null;
    if (AP.Input) AP.Input.lock(0);
    return switchTo(name, params);
  };

  Scenes.push = function (name, params) {
    if (!reg[name]) {
      AP.warnOnce('scene-push:' + name, 'Scenes.push: unknown scene "' + name + '"');
      return false;
    }
    var prev = stack[stack.length - 1];
    var from = Scenes.current;
    if (prev) safeCall(prev, 'covered');
    var entry = { name: name, scene: reg[name], params: params || {} };
    stack.push(entry);
    Scenes.current = name;
    setPlayingClass();
    safeCall(entry, 'enter', entry.params, from);
    if (AP.Events) AP.Events.emit('scene:change', { from: from, to: name });
    return true;
  };

  Scenes.pop = function (result) {
    if (stack.length <= 1) return false;
    var top = stack.pop();
    var below = stack[stack.length - 1];
    Scenes.current = below.name;
    setPlayingClass();
    safeCall(top, 'exit', below.name);
    safeCall(below, 'uncovered', result, top.name);
    if (AP.Events) AP.Events.emit('scene:change', { from: top.name, to: below.name });
    return true;
  };

  Scenes.top = function () { var e = stack[stack.length - 1]; return e ? e.scene : null; };
  Scenes.topEntry = function () { return stack[stack.length - 1] || null; };
  Scenes.topName = function () { return Scenes.current; };
  Scenes.params = function () { var e = stack[stack.length - 1]; return e ? e.params : null; };
  Scenes.isTransitioning = function () { return !!trans; };
  Scenes.crashed = function () { return crashed; };

  function coverAmount() {
    if (!trans) return 0;
    var h = trans.dur / 2;
    var c = trans.t < h ? trans.t / h : 1 - (trans.t - h) / h;
    c = c < 0 ? 0 : (c > 1 ? 1 : c);
    return AP.M.ease.inOutSine(c);
  }
  Scenes.cover = coverAmount;

  // return to the map (or the devmenu when the map itself is what broke)
  function recover() {
    var c = crashed;
    crashed = null;
    var target = (reg.map && !(c && (c.name === 'map' || c.name === 'title'))) ? 'map' : 'devmenu';
    Scenes.goNow(target, {});
  }

  Scenes.update = function (dt) {
    // fallback toast timers
    var q = AP.toastQueue;
    if (q && q.length) {
      for (var i = q.length - 1; i >= 0; i--) {
        q[i].t += dt;
        if (q[i].t > 3.4) q.splice(i, 1);
      }
    }
    if (trans) {
      trans.t += dt;
      if (!trans.swapped && trans.t >= trans.dur / 2) {
        trans.swapped = true;
        switchTo(trans.name, trans.params);
      }
      if (trans.t >= trans.dur) {
        trans = null;
        if (AP.Input) AP.Input.lock(0);
        if (queued) {
          var qd = queued;
          queued = null;
          Scenes.go(qd.name, qd.params, qd.opts);
        }
      }
    }
    var top = stack[stack.length - 1];
    if (!top) return;
    if (crashed) {
      if (AP.Input && (AP.Input.pressed('confirm') || AP.Input.pressed('retry'))) recover();
      return;
    }
    if (typeof top.scene.update === 'function') {
      try {
        top.scene.update(dt);
      } catch (e) {
        onCrash(top, 'update', e);
      }
    }
  };

  // ---- rendering ----
  function drawSceneBg(scene) {
    var bg = scene.bg;
    var key = null, p = null;
    if (typeof bg === 'string') {
      key = bg;
      p = AP.R.bgParams(key);
    } else if (typeof bg === 'function') {
      var spec = null;
      try { spec = bg.call(scene); } catch (e) { AP.reportError('scene.bg', e); }
      if (!spec || !spec.key) return;
      key = spec.key;
      p = AP.R.bgParams(key);
      p.camX = spec.camX || 0;
      p.camY = spec.camY || 0;
      if (spec.intensity !== undefined) p.intensity = spec.intensity;
      if (spec.t !== undefined) p.t = spec.t;
    }
    if (key) AP.R.drawBackground(key, p);
  }

  Scenes.render = function () {
    var R = AP.R;
    if (!R || !R.ctx) return;
    var ctx = R.ctx;
    R.beginFrame();
    var start = stack.length - 1;
    while (start > 0 && stack[start].scene.transparent) start--;
    if (start >= 0) {
      var bottom = stack[start];
      if (bottom.scene.bg) { R.begin(ctx); drawSceneBg(bottom.scene); }
      for (var i = start; i < stack.length; i++) {
        var e = stack[i];
        if (typeof e.scene.render !== 'function') continue;
        if (crashed && crashed.name === e.name && crashed.phase === 'render') continue;
        R.begin(ctx);
        try {
          e.scene.render(ctx);
        } catch (err) {
          onCrash(e, 'render', err);
        }
      }
    }
    R.begin(ctx);
    if (AP.Meta && typeof AP.Meta.renderToasts === 'function') AP.call('Meta.renderToasts', ctx);
    else renderFallbackToasts(ctx);
    R.begin(ctx);
    if (trans) drawTransition(ctx, trans.fx, coverAmount(), trans.color);
    if (crashed) drawCrash(ctx);
    R.renderFlash(ctx);
    if (Scenes.overlay) {
      R.begin(ctx);
      try { Scenes.overlay(ctx); } catch (e3) { Scenes.overlay = null; AP.reportError('Scenes.overlay', e3); }
    }
    R.begin(ctx);
    R.endFrame();
  };

  // ---- transitions: AP.UI.drawTransition when present, else CORE fallbacks ----
  var uiTransBroken = false;
  function drawTransition(ctx, kind, cover, color) {
    if (cover <= 0.001) return;
    if (!uiTransBroken && AP.UI && typeof AP.UI.drawTransition === 'function') {
      try {
        AP.UI.drawTransition(ctx, kind, cover, color);
        AP.R.begin(ctx);
        return;
      } catch (e) {
        uiTransBroken = true;
        AP.reportError('UI.drawTransition', e);
      }
    }
    if (kind === 'iris') drawIris(ctx, cover, color);
    else if (kind === 'shatter') drawShatter(ctx, cover, color);
    else {
      ctx.globalAlpha = cover;
      ctx.fillStyle = color || '#000';
      ctx.fillRect(0, 0, 960, 540);
      ctx.globalAlpha = 1;
    }
  }
  Scenes.drawTransitionFallback = drawTransition;

  function currentForm() {
    if (AP.level && AP.level.form) return AP.level.form;
    var d = AP.Save && AP.Save.data;
    return (d && d.form) || 3;
  }

  function drawIris(ctx, cover, color) {
    var sides = AP.R.formSides(currentForm());
    var maxR = 620;
    var r = maxR * (1 - cover);
    var rot = AP.R.flatRot(sides) + cover * 1.2;
    ctx.fillStyle = color || '#000';
    ctx.beginPath();
    ctx.rect(0, 0, 960, 540);
    if (r > 0.5) AP.R.poly(ctx, 480, 270, r, sides, rot, true);
    ctx.fill('evenodd');
    if (r > 0.5) {
      var pal = AP.level ? AP.level.pal : AP.R.pal('title');
      ctx.strokeStyle = AP.Color.rgba(pal.ink, 0.85 * Math.min(1, cover * 3));
      ctx.lineWidth = 2.5;
      AP.R.poly(ctx, 480, 270, r, sides, rot);
      ctx.stroke();
    }
  }

  // deterministic jittered triangle mesh, built once
  var shards = null;
  function buildShards() {
    var rng = AP.RNG(7331);
    var cols = 9, rows = 5;
    var pts = [];
    for (var y = 0; y <= rows; y++) {
      for (var x = 0; x <= cols; x++) {
        var jx = (x > 0 && x < cols) ? rng.range(-30, 30) : 0;
        var jy = (y > 0 && y < rows) ? rng.range(-24, 24) : 0;
        pts.push([x * 960 / cols + jx, y * 540 / rows + jy]);
      }
    }
    shards = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var a = pts[r * (cols + 1) + c], b = pts[r * (cols + 1) + c + 1];
        var d = pts[(r + 1) * (cols + 1) + c], e = pts[(r + 1) * (cols + 1) + c + 1];
        var tris = rng.chance(0.5) ? [[a, b, e], [a, e, d]] : [[a, b, d], [b, e, d]];
        for (var t = 0; t < 2; t++) {
          var tr = tris[t];
          var cx = (tr[0][0] + tr[1][0] + tr[2][0]) / 3, cy = (tr[0][1] + tr[1][1] + tr[2][1]) / 3;
          shards.push({ p: tr, cx: cx, cy: cy, delay: rng.range(0, 0.35) + (cy / 540) * 0.15, spin: rng.range(-3, 3), vx: rng.range(-120, 120) });
        }
      }
    }
  }

  function drawShatter(ctx, cover, color) {
    if (!shards) buildShards();
    var pal = AP.level ? AP.level.pal : AP.R.pal('title');
    var swappedPhase = trans && trans.swapped;
    ctx.fillStyle = color || '#000';
    ctx.strokeStyle = AP.Color.rgba(pal.accent, 0.5);
    ctx.lineWidth = 1.5;
    for (var i = 0; i < shards.length; i++) {
      var s = shards[i];
      // each shard has its own local progress: falls away (uncover) or drops into place (cover)
      var local = AP.M.clamp((1 - cover - s.delay) / 0.5, 0, 1);
      if (local >= 1) continue;
      var k = AP.M.ease.inQuad(local);
      var dy = swappedPhase ? k * 640 : -k * 640;
      var dx = s.vx * k;
      var ang = s.spin * k;
      var c = Math.cos(ang), sn = Math.sin(ang);
      ctx.beginPath();
      for (var j = 0; j < 3; j++) {
        var px = s.p[j][0] - s.cx, py = s.p[j][1] - s.cy;
        var X = s.cx + dx + px * c - py * sn, Y = s.cy + dy + px * sn + py * c;
        if (j === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.closePath();
      ctx.fill();
      if (k > 0) ctx.stroke();
    }
  }

  // ---- fallback toasts (only when AP.Meta is absent) ----
  var TOAST_T = { size: 16, color: '#FFFFFF', align: 'center', baseline: 'middle', weight: '700' };
  var TOAST_S = { size: 13, color: '#C9D1FF', align: 'center', baseline: 'middle', weight: '500' };
  function renderFallbackToasts(ctx) {
    var q = AP.toastQueue;
    if (!q || !q.length) return;
    var y = 20;
    for (var i = 0; i < q.length; i++) {
      var t = q[i];
      var inK = AP.M.clamp(t.t / 0.3, 0, 1), outK = AP.M.clamp((3.4 - t.t) / 0.4, 0, 1);
      var k = Math.min(AP.M.ease.outCubic(inK), outK);
      var h = t.sub ? 50 : 34;
      var yy = y - (1 - k) * 30;
      ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(8,10,20,0.85)';
      ctx.fillRect(330, yy, 300, h);
      ctx.strokeStyle = 'rgba(255,211,110,0.8)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(330, yy, 300, h);
      AP.R.text(ctx, t.title, 480, yy + (t.sub ? 16 : h / 2), TOAST_T);
      if (t.sub) AP.R.text(ctx, t.sub, 480, yy + 35, TOAST_S);
      ctx.globalAlpha = 1;
      y += (h + 8) * k;
    }
  }

  var CRASH_A = { size: 22, color: '#FF5470', align: 'center', baseline: 'middle', weight: '700' };
  var CRASH_B = { size: 15, color: '#FFFFFF', align: 'center', baseline: 'middle', weight: '500', maxW: 760 };
  function drawCrash(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, 960, 540);
    AP.R.text(ctx, 'Something broke in "' + crashed.name + '"', 480, 220, CRASH_A);
    AP.R.text(ctx, crashed.msg, 480, 262, CRASH_B);
    AP.R.text(ctx, 'Press ' + AP.Input.label('confirm') + ' or ' + AP.Input.label('retry') + ' to return to the map', 480, 312, CRASH_B);
  }

  Scenes.overlay = null;   // optional fn(ctx) drawn after everything (DEV overlays)

  AP.Scenes = Scenes;
})(window.AP = window.AP || {});
