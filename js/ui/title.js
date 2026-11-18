/* js/ui/title.js — owner: UI */
(function (AP) {
  'use strict';

  // Scene 'title' (DESIGN 7): shader style 'title', a big polygon morphing 3 -> 4 -> 5 -> 6 -> circle -> 3 with orbiting
  // vertex dots, APEIRON drawn on in the stroke font, then "press any key" (the first input unlocks audio).
  // Menu: Continue / New Game / Endless / Theorems / Cosmetics / Settings / Credits. Endless opens a sub-menu:
  // Daily or Seeded (type or randomize a seed) -> AP.Scenes.go('endless', {daily:true} | {seed:n}).
  var TAU = Math.PI * 2;
  var M = AP.M;
  var SEQ = [3, 4, 5, 6, 99];
  var MAX_SEED = 99999999;      // Endless reduces seeds modulo 10^8

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function now() { return (AP.Time && AP.Time.now) || 0; }
  function UI() { return AP.UI; }
  function data() { return (AP.Save && AP.Save.data) || null; }

  var TX = { size: 13, weight: '600', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1, maxW: 0 };
  function text(ctx, str, x, y, size, color, align, alpha, weight) {
    TX.size = size; TX.color = color; TX.align = align || 'left'; TX.alpha = alpha === undefined ? 1 : alpha; TX.weight = weight || '600';
    return AP.R.text(ctx, str, x, y, TX);
  }
  var SO = { size: 20, color: '#FFFFFF', align: 'center', glow: null, glowAlpha: 0.9, alpha: 1, progress: 1, spacing: 1.4, sparks: true, stagger: 0.28 };
  function stroke(ctx, str, x, y, size, color, align, alpha, glow, progress, spacing) {
    SO.size = size; SO.color = color; SO.align = align || 'center'; SO.alpha = alpha === undefined ? 1 : alpha;
    SO.glow = glow || null; SO.progress = progress === undefined ? 1 : progress; SO.spacing = spacing || 1.4;
    SO.sparks = SO.progress < 1;
    return UI().strokeText(ctx, str, x, y, SO);
  }

  var S = {
    bg: 'title',
    t0: 0, phase: 'attract', phaseT: 0, logoT0: 0, logoDur: 2.2,
    menu: null, endMenu: null, dialog: null,
    seed: 42, editing: false, cursor: 0, offKey: null, editT: 0,
    seenAttract: false, from: null, lift: 0, liftV: 0,
    foot: { has: false, pct: 0, th: 0, form: 3, cont: false, daily: 0, dailySub: '', line: '' }
  };

  // footer numbers and menu flags, read once per visit (they only change outside this scene)
  function refreshStats() {
    var d = data();
    S.foot.has = UI().hasProgress();
    S.foot.pct = AP.Progress ? AP.Progress.percent() : 0;
    S.foot.th = AP.Meta ? AP.Meta.provedCount() : 0;
    S.foot.form = (d && d.form) || 3;
    S.foot.cont = S.foot.has || !!(d && d.flags && d.flags.introSeen);
    S.foot.daily = dailySeed();
    S.foot.dailySub = 'Seed ' + S.foot.daily + '  ·  the same course for everyone today';
    S.foot.line = (AP.FORM_NAMES[S.foot.form] || 'Triangle').toUpperCase() + '   ·   ' + S.foot.pct + '% COMPLETE   ·   ' + S.foot.th + ' THEOREMS';
  }
  function dailySub() { return S.foot.dailySub || ''; }

  function endlessRegistered() { return !!(AP.Scenes && AP.Scenes.has('endless')); }
  function endlessOpen() {
    var d = data();
    return !!((d && d.flags && d.flags.endlessUnlocked) || (AP.DEV && AP.Progress && AP.Progress.unlockAll));
  }
  function canContinue() { return S.foot.cont; }

  function dailySeed() {
    if (AP.Endless && typeof AP.Endless.dailySeed === 'function') {
      var v = AP.call('Endless.dailySeed');
      if (typeof v === 'number' && isFinite(v)) return (v >>> 0) % (MAX_SEED + 1);
    }
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return (AP.hash('apeiron-' + d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day) >>> 0) % (MAX_SEED + 1);
  }

  // ---------------------------------------------------------------- actions
  function startNewGame() {
    var d = data();
    if (!d || !d.flags.introSeen) UI().go('intro', { next: 'map' }, 'fade', 1.0);
    else UI().go('map', { focus: 'w1-1' }, 'iris', 0.8);
  }

  function newGame() {
    if (UI().hasProgress()) {
      S.dialog = UI().dialog({
        title: 'Begin a new game?', danger: true, focus: 1, pal: AP.R.pal('title'),
        text: 'Every cleared level, gem, theorem and form will be erased. Your settings and bindings are kept.',
        options: [
          { label: 'Erase and begin', danger: true, action: function () {
            if (AP.Save && AP.Save.reset) AP.Save.reset();
            if (AP.Meta && AP.Meta.clearToasts) AP.Meta.clearToasts();
            AP.sfx('break');
            startNewGame();
          } },
          { label: 'Cancel' }
        ]
      });
      return;
    }
    startNewGame();
  }

  function cont() {
    var id = AP.Progress && AP.Progress.current ? AP.Progress.current() : 'w1-1';
    UI().go('map', { focus: id }, 'iris', 0.8);
  }

  function openEndless() {
    if (!endlessOpen()) {
      S.menu.deny();
      if (AP.Meta) AP.Meta.pushToast({ title: 'Endless is sealed', sub: 'Defeat the Null to open Apeiron.', kind: 'endless' });
      return;
    }
    setPhase('endless');
  }

  function startDaily() { UI().go('endless', { daily: true }, 'shatter', 0.9); }
  function startSeeded() { stopEditing(); UI().go('endless', { seed: S.seed >>> 0 }, 'shatter', 0.9); }

  function randomizeSeed() {
    var v = Math.floor(Math.random() * 1e9) ^ (AP.hash(String(now())) & 0xffff);
    S.seed = (v >>> 0) % (MAX_SEED + 1);
    S.editT = now();
    AP.sfx('uiMove', { pitch: 1.4 });
  }

  // ---------------------------------------------------------------- seed editing (8 digits)
  function digits() {
    var s = String(S.seed >>> 0);
    while (s.length < 8) s = '0' + s;
    return s;
  }
  function setDigit(i, dch) {
    var s = digits();
    s = s.slice(0, i) + dch + s.slice(i + 1);
    var v = +s;
    if (!(v >= 0)) v = 0;
    if (v > MAX_SEED) v = MAX_SEED;
    S.seed = v >>> 0;
    S.editT = now();
  }
  function bumpDigit(i, dir) {
    var s = digits();
    var d = (+s.charAt(i) + dir + 10) % 10;
    setDigit(i, String(d));
  }
  function startEditing() {
    if (S.editing) return;
    S.editing = true;
    S.cursor = Math.min(S.cursor, 7);
    S.editT = now();
    if (AP.Input && AP.Input.onKey) {
      S.offKey = AP.Input.onKey(function (code) {
        if (!S.editing) return false;
        var m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
        if (m) { setDigit(S.cursor, m[1]); S.cursor = Math.min(7, S.cursor + 1); AP.sfx('type', { vol: 0.6 }); return true; }
        if (code === 'Backspace' || code === 'Delete') { setDigit(S.cursor, '0'); S.cursor = Math.max(0, S.cursor - 1); AP.sfx('type', { vol: 0.5, pitch: 0.8 }); return true; }
        return false;
      });
    }
  }
  function stopEditing() {
    if (!S.editing) return;
    S.editing = false;
    if (S.offKey) { S.offKey(); S.offKey = null; }
  }

  // ---------------------------------------------------------------- menus
  function buildMenus() {
    var U = UI();
    S.menu = U.menu({
      x: 330, y: 262, w: 300, rowH: 33, size: 18, stroke: true, align: 'center',
      onBack: function () { setPhase('attract'); },
      items: [
        { label: 'Continue', hidden: function () { return !canContinue(); }, action: cont },
        { label: 'New Game', action: newGame },
        { label: function () { return endlessOpen() ? 'Endless' : '∞'; }, hidden: function () { return !endlessRegistered(); },
          locked: function () { return !endlessOpen(); }, disabled: function () { return !endlessOpen(); }, action: openEndless },
        { label: 'Theorems', action: function () { UI().go('theorems', { from: 'title' }, 'fade', 0.5); } },
        { label: 'Cosmetics', action: function () { UI().go('cosmetics', { from: 'title' }, 'fade', 0.5); } },
        { label: 'Settings', action: function () { AP.Scenes.push('settings', { from: 'title' }); } },
        { label: 'Credits', action: function () { UI().go('credits', {}, 'fade', 0.8); } }
      ]
    });
    S.endMenu = U.menu({
      x: 300, y: 196, w: 360, rowH: 42, size: 16, align: 'left', valueFrac: 0.5,
      onBack: function () { if (S.editing) stopEditing(); else setPhase('menu'); },
      items: [
        { label: 'Daily run', sub: function () { return dailySub(); }, action: startDaily },
        { label: 'Seed', render: renderSeedRow, action: function () { if (S.editing) stopEditing(); else startEditing(); },
          adjust: function (dir) { if (S.editing) { S.cursor = Math.max(0, Math.min(7, S.cursor + dir)); AP.sfx('uiMove', { vol: 0.6 }); } } },
        { label: 'Randomize seed', action: randomizeSeed },
        { label: 'Start seeded run', action: startSeeded },
        { type: 'gap' },
        { label: 'Back', action: function () { setPhase('menu'); } }
      ]
    });
  }

  function renderSeedRow(ctx, x, y, w, h, focused, pal, a, menu) {
    var U = UI();
    var cy = y + h / 2;
    text(ctx, 'Seed', x + 26, cy - 7, 17, focused ? pal.ink : rgba(pal.ink, 0.78), 'left', a, focused ? '700' : '600');
    text(ctx, S.editing ? 'type digits · ' + AP.Input.label('up') + AP.Input.label('down') + ' change · ' + AP.Input.label('confirm') + ' done'
      : AP.Input.label('confirm') + ' to edit', x + 26, cy + 10, 11, rgba(pal.primary, 0.7), 'left', a, '500');
    var s = digits();
    var dx = x + w - 8 * 17 - 6;
    var pa = ctx.globalAlpha;
    var pulse = clamp01(1 - (now() - S.editT) / 0.25);
    for (var i = 0; i < 8; i++) {
      var cx = dx + i * 17 + 8;
      var sel = S.editing && i === S.cursor;
      if (sel) {
        ctx.globalAlpha = pa * a;
        ctx.fillStyle = rgba(pal.accent, 0.22 + 0.15 * Math.sin(now() * 8));
        ctx.fillRect(cx - 7, cy - 13, 14, 26);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(cx - 6, cy + 13, 12, 2);
      }
      stroke(ctx, s.charAt(i), cx, cy, 17 * (sel ? 1 + 0.1 * pulse : 1), sel ? pal.accent : (focused ? pal.ink : rgba(pal.ink, 0.75)), 'center', a, sel ? pal.accent : null);
    }
    ctx.globalAlpha = pa;
  }

  function setPhase(p) {
    if (S.phase === p) return;
    if (p !== 'endless') stopEditing();
    S.phase = p;
    S.phaseT = now();
    if (p === 'menu') { S.menu.intro = 0; S.menu.snap(); }
    if (p === 'endless') { S.endMenu.intro = 0; S.endMenu.selItem = S.endMenu.firstSelectable(0, 1); S.endMenu.snap(); }
  }

  // ---------------------------------------------------------------- scene hooks
  S.enter = function (params, from) {
    S.t0 = now();
    S.from = from || null;
    S.dialog = null;
    S.editing = false;
    S.under = false;
    refreshStats();
    buildMenus();
    if (S.seenAttract) {
      S.phase = 'menu';
      S.phaseT = S.t0 - 0.6;
      S.logoDur = 0.9;
      S.lift = 1;
    } else {
      S.phase = 'attract';
      S.phaseT = S.t0;
      S.logoDur = 2.4;
      S.lift = 0;
    }
    S.logoT0 = S.t0 + (S.seenAttract ? 0.05 : 0.35);
    var d = data();
    if (d && d.endless && d.endless.bestSeed > 0) S.seed = (d.endless.bestSeed >>> 0) % (MAX_SEED + 1);
    AP.music('title');
    if (AP.level) AP.level = null;
  };

  S.exit = function () { stopEditing(); S.dialog = null; };
  S.covered = function () { S.under = true; };
  S.uncovered = function () { S.under = false; refreshStats(); if (S.menu) S.menu.snap(); };

  S.update = function (dt) {
    var U = UI();
    var t = now();
    if (S.dialog) {
      S.dialog.update(dt);
      if (S.dialog && S.dialog.done) S.dialog = null;
      return;
    }
    var n = U.nav();
    if (S.phase === 'attract') {
      if (t - S.t0 > 0.35 && (n.any || n.click || (AP.Input && AP.Input.anyPressed()))) {
        AP.call('Audio.unlock');
        AP.sfx('uiSelect');
        S.seenAttract = true;
        U.eat();
        setPhase('menu');
        U.sparks.emit(480, 200, { n: 40, color: AP.R.pal('title').accent, color2: '#FFFFFF', speed: [80, 320], life: [0.5, 1.1], size: [1, 2.5], drag: 2.2, shape: 3 });
      }
      return;
    }
    if (S.phase === 'menu') {
      S.menu.update(dt);
      return;
    }
    if (S.phase === 'endless') {
      if (S.editing) {
        if (n.up) { bumpDigit(S.cursor, 1); AP.sfx('uiMove', { pitch: 1.2 }); }
        if (n.down) { bumpDigit(S.cursor, -1); AP.sfx('uiMove', { pitch: 0.9 }); }
        if (n.left) { S.cursor = Math.max(0, S.cursor - 1); AP.sfx('uiMove', { vol: 0.6 }); }
        if (n.right) { S.cursor = Math.min(7, S.cursor + 1); AP.sfx('uiMove', { vol: 0.6 }); }
        if (n.confirm || n.back) { U.eat(); stopEditing(); AP.sfx('uiSelect'); }
        return;
      }
      S.endMenu.update(dt);
    }
  };

  // ---------------------------------------------------------------- drawing
  var midP = { t: 0, camX: 0, camY: 0, L: null, pal: null, quality: null, intensity: 0, beat: 0, phase: 0, seed: 0 };

  function vertexPos(form, i, rot, r, out) {
    var n = UI().formSides(form);
    if (n >= 32) n = 12;
    var a = UI().flatRot(UI().formSides(form)) + rot + i * TAU / n;
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
    return n;
  }
  var vp = { x: 0, y: 0 };

  // the morphing emblem: outer form, nested echoes, vertex dots and orbiting satellites
  function drawEmblem(ctx, cx, cy, R, t, a, pal) {
    var U = UI();
    var per = 2.8;
    var idx = Math.floor(t / per) % SEQ.length;
    var from = SEQ[idx], to = SEQ[(idx + 1) % SEQ.length];
    var k = clamp01(((t % per) - 1.5) / 1.1);
    var rot = t * 0.06;
    var pa = ctx.globalAlpha;
    AP.R.glow(ctx, cx, cy, 48, pal.accent, 0.22 * a);
    ctx.lineJoin = 'round';
    for (var layer = 3; layer >= 0; layer--) {
      var rr = R * [1, 0.8, 0.62, 0.47][layer];
      var lr = rot * (layer % 2 ? -1.6 : 1) + layer * 0.18;
      ctx.globalAlpha = pa * a * [0.62, 0.22, 0.15, 0.1][layer];
      ctx.strokeStyle = layer === 0 ? pal.ink : (layer === 1 ? pal.accent : pal.primary);
      ctx.lineWidth = layer === 0 ? 2 : 1.2;
      U.morphPath(ctx, cx, cy, rr, from, to, clamp01(k * 1.15 - layer * 0.05), lr);
      ctx.stroke();
    }
    // vertex dots of the outer shape (crossfading between the two forms)
    var n0 = vertexPos(from, 0, rot, R, vp), n1 = vertexPos(to, 0, rot, R, vp);
    var e = M.ease.inOutSine(k);
    ctx.fillStyle = pal.ink;
    for (var pass = 0; pass < 2; pass++) {
      var form = pass === 0 ? from : to;
      var al = pass === 0 ? 1 - e : e;
      if (al <= 0.02) continue;
      var nn = pass === 0 ? n0 : n1;
      ctx.globalAlpha = pa * a * al * 0.95;
      ctx.beginPath();
      for (var i = 0; i < nn; i++) {
        vertexPos(form, i, rot, R, vp);
        var x = cx + vp.x, y = cy + vp.y;
        var s = form >= 32 ? 1.8 : 3;
        ctx.moveTo(x + s, y);
        ctx.arc(x, y, s, 0, TAU);
      }
      ctx.fill();
    }
    // orbiting satellites with short comet arcs
    for (var j = 0; j < 5; j++) {
      var orr = R * (1.22 + 0.06 * j);
      var sp = 0.35 + j * 0.07;
      var ang = t * sp * (j % 2 ? -1 : 1) + j * TAU / 5;
      ctx.globalAlpha = pa * a * 0.35;
      ctx.strokeStyle = j === 0 ? pal.accent : pal.primary;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, orr, ang - (j % 2 ? -0.5 : 0.5), ang, j % 2 === 1);
      ctx.stroke();
      ctx.globalAlpha = pa * a * 0.9;
      ctx.fillStyle = j === 0 ? pal.accent : pal.ink;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * orr, cy + Math.sin(ang) * orr, j === 0 ? 2.6 : 1.7, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = pa;
    ctx.lineJoin = 'miter';
  }

  S.render = function (ctx) {
    var U = UI();
    var pal = AP.R.pal('title');
    var t = now() - S.t0;
    var dt = U.frameDt();
    U.sparks.tick();
    // midground: ART's drifting polygons
    if (AP.Midground && typeof AP.Midground.render === 'function' && AP.R.quality.mid) {
      midP.t = now(); midP.pal = pal; midP.quality = AP.R.quality; midP.beat = AP.Beat ? AP.Beat.beat : 0;
      midP.phase = AP.Beat ? AP.Beat.phase : 0; midP.seed = 77;
      ctx.save();
      try { AP.Midground.render(ctx, 'title', midP); } catch (e) { /* the title still works without it */ }
      ctx.restore();
    }
    U.vignette(ctx, 0.6);
    // the logo lifts when the menu opens
    var target = S.phase === 'attract' ? 0 : (S.phase === 'endless' ? 1.25 : 1);
    S.liftV += ((target - S.lift) * 120 - S.liftV * 20) * dt;
    S.lift += S.liftV * dt;
    var lift = S.lift;
    var ecx = 480, ecy = 236 - 106 * lift;
    var R = 168 - 74 * lift;
    var intro = M.ease.outCubic(clamp01(t / 1.2));
    drawEmblem(ctx, ecx, ecy, R, now(), intro * (1 - 0.35 * lift), pal);
    // APEIRON
    var lp = clamp01((now() - S.logoT0) / S.logoDur);
    var size = 92 - 30 * lift;
    var pa = ctx.globalAlpha;
    var shimmer = 0.75 + 0.25 * Math.sin(now() * 1.3);
    stroke(ctx, 'APEIRON', 480, ecy + 2, size, pal.ink, 'center', 1, pal.accent, lp, 2.6);
    if (lp >= 1) AP.R.glow(ctx, 480, ecy, 48, pal.accent, 0.12 * shimmer);
    // tagline
    var tagA = clamp01((now() - S.logoT0 - S.logoDur + 0.3) / 0.6) * (1 - lift);
    if (tagA > 0.01) text(ctx, 'A   G A M E   O F   G E O M E T R Y', 480, ecy + 62, 11, rgba(pal.primary, 0.85), 'center', tagA, '700');
    // press any key
    if (S.phase === 'attract') {
      var pk = clamp01((now() - S.logoT0 - S.logoDur * 0.8) / 0.6);
      var pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now() * 3.2));
      stroke(ctx, 'PRESS ANY KEY', 480, 432, 15, pal.ink, 'center', pk * pulse, pal.accent, 1, 2.2);
      var ww = U.measure('PRESS ANY KEY', 15, 2.2);
      ctx.globalAlpha = pa * pk * 0.5;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(480 - ww / 2 - 40, 432); ctx.lineTo(480 - ww / 2 - 14, 432);
      ctx.moveTo(480 + ww / 2 + 14, 432); ctx.lineTo(480 + ww / 2 + 40, 432);
      ctx.stroke();
      ctx.globalAlpha = pa;
    }
    // an overlay (settings) covers the menu: keep only the emblem and the logo
    if (S.under) { U.sparks.render(ctx); return; }
    // menu
    var mk = clamp01((now() - S.phaseT - 0.15) / 0.4);
    if (S.phase === 'menu') {
      S.menu.render(ctx, { pal: pal, alpha: mk });
      var sel = S.menu.selItem;
      if (sel && sel.locked && (typeof sel.locked === 'function' ? sel.locked() : sel.locked)) {
        text(ctx, 'Defeat the Null to open Apeiron, the endless mode.', 480, 482, 12, rgba(pal.primary, 0.75), 'center', mk, '500');
      }
    }
    if (S.phase === 'endless') drawEndless(ctx, pal, mk);
    // footer: completion, form, version
    var fa = clamp01((now() - S.logoT0 - 0.6) / 0.8) * (S.phase === 'attract' ? 0.6 : 1);
    var F = S.foot;
    if (F.has) {
      ctx.globalAlpha = pa * fa;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.5;
      U.formPath(ctx, 34, 512, 9, F.form, 0);
      ctx.stroke();
      ctx.globalAlpha = pa;
      text(ctx, F.line, 52, 512, 10.5, rgba(pal.primary, 0.8), 'left', fa, '800');
    }
    text(ctx, 'v' + AP.VERSION, 940, 512, 10.5, rgba(pal.primary, 0.55), 'right', fa, '700');
    if (S.phase !== 'attract') {
      U.hints(ctx, S.phase === 'endless' && S.editing ? [[['left', 'right'], 'Digit'], [['up', 'down'], 'Change'], ['confirm', 'Done']]
        : [[['up', 'down'], 'Select'], ['confirm', 'Choose'], ['back', 'Back']], 480, 512, { align: 'center', pal: pal, alpha: fa * 0.85 });
    }
    U.sparks.render(ctx);
    if (S.dialog) S.dialog.render(ctx, pal);
  };

  function drawEndless(ctx, pal, k) {
    var U = UI();
    var d = data();
    var pa = ctx.globalAlpha;
    U.panel(ctx, 270, 148, 420, 330, { pal: pal, alpha: k, fillAlpha: 0.9 });
    stroke(ctx, 'APEIRON · ENDLESS', 480, 174, 16, pal.ink, 'center', k, pal.accent, clamp01((now() - S.phaseT) / 0.7), 2);
    S.endMenu.render(ctx, { pal: pal, alpha: k });
    var e = d && d.endless;
    if (e) {
      var line = e.best > 0 ? 'Best ' + e.best + (e.bestSeed ? '  ·  seed ' + e.bestSeed : '') + '  ·  ' + (e.runs | 0) + ' runs' : 'No runs yet. Every segment is generated, and every one can be cleared.';
      text(ctx, line, 480, 454, 11, rgba(pal.primary, 0.8), 'center', k, '600');
    }
    ctx.globalAlpha = pa;
  }

  AP.Scenes.register('title', S);
})(window.AP = window.AP || {});
