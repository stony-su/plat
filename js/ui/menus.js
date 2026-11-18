/* js/ui/menus.js — owner: UI */
(function (AP) {
  'use strict';

  // Scenes 'pause' (overlay pushed by LevelScene with {L}) and 'results' (params = the CONTRACT 2.14 result).
  // LevelScene already ran AP.Progress.complete and played the form-gain card before 'results' starts.
  var TAU = Math.PI * 2;
  var M = AP.M;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function UI() { return AP.UI; }
  function now() { return (AP.Time && AP.Time.now) || 0; }
  function assist() { var st = AP.Save && AP.Save.data && AP.Save.data.settings; return (st && st.assist) || { on: false, speed: 1, invincible: false, infiniteAir: false }; }
  function setAssist(key, v) { if (AP.Save && AP.Save.setSetting) AP.Save.setSetting('assist.' + key, v); }

  var TX = { size: 13, weight: '600', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1, maxW: 0 };
  function text(ctx, str, x, y, size, color, align, alpha, weight, maxW) {
    TX.size = size; TX.color = color; TX.align = align || 'left'; TX.alpha = alpha === undefined ? 1 : alpha;
    TX.weight = weight || '600'; TX.maxW = maxW || 0;
    return AP.R.text(ctx, str, x, y, TX);
  }
  var SO = { size: 20, color: '#FFFFFF', align: 'left', glow: null, glowAlpha: 0.8, alpha: 1, progress: 1, spacing: 1.4, sparks: true, maxW: 0 };
  function stroke(ctx, str, x, y, size, color, align, alpha, glow, progress, maxW) {
    SO.size = size; SO.color = color; SO.align = align || 'left'; SO.alpha = alpha === undefined ? 1 : alpha;
    SO.glow = glow || null; SO.progress = progress === undefined ? 1 : progress; SO.maxW = maxW || 0;
    SO.sparks = SO.progress < 1;
    return UI().strokeText(ctx, str, x, y, SO);
  }

  // ================================================================ blurred snapshot (two drawImage downsamples)
  var blurA = null, blurB = null, blurOk = false, blurBroken = false;
  function makeCanvas(w, h) {
    try {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c.getContext && c.getContext('2d') ? c : null;
    } catch (e) { return null; }
  }
  function snapshotBlur(bg) {
    blurOk = false;
    if (blurBroken) return false;
    var src = AP.R && AP.R.canvas;
    if (!src || !AP.R.hasCanvas || !(src.width > 0)) return false;
    try {
      if (!blurA) { blurA = makeCanvas(240, 135); blurB = makeCanvas(96, 54); }
      if (!blurA || !blurB) { blurBroken = true; return false; }
      var ga = blurA.getContext('2d'), gb = blurB.getContext('2d');
      ga.globalAlpha = 1;
      ga.globalCompositeOperation = 'source-over';
      ga.fillStyle = bg || '#000000';
      ga.fillRect(0, 0, 240, 135);
      ga.drawImage(src, 0, 0, src.width, src.height, 0, 0, 240, 135);
      gb.fillStyle = bg || '#000000';
      gb.fillRect(0, 0, 96, 54);
      gb.drawImage(blurA, 0, 0, 240, 135, 0, 0, 96, 54);
      blurOk = true;
    } catch (e) { blurBroken = true; blurOk = false; }
    return blurOk;
  }
  function drawBlur(ctx, a) {
    if (!blurOk || a <= 0.002) return false;
    var pa = ctx.globalAlpha;
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = pa * a;
      ctx.drawImage(blurA, 0, 0, 240, 135, 0, 0, 960, 540);
      ctx.globalAlpha = pa * a * 0.75;
      ctx.drawImage(blurB, 0, 0, 96, 54, 0, 0, 960, 540);
    } catch (e) { blurOk = false; }
    ctx.globalAlpha = pa;
    return true;
  }

  // ================================================================ pause
  var P = {
    transparent: true,
    L: null, t0: 0, menu: null, assistMenu: null, view: 'main', viewT: 0, dialog: null, closing: -1, closeAction: null,
    pal: null
  };

  function levelOf() { var L = P.L; return (L && !L.disposed) ? L : null; }

  function resume() {
    if (P.closing >= 0) return;
    P.closing = now();
    P.closeAction = null;
    AP.sfx('unpause');
    UI().close('map');
    if (AP.UI) AP.UI.consumeAll();
  }

  function buildPauseMenus() {
    var U = UI();
    var L = levelOf();
    var endless = L && L.mode === 'endless';
    P.menu = U.menu({
      x: 556, y: 150, w: 300, rowH: 40, size: 19, stroke: true, align: 'left',
      onBack: function () { resume(); },
      items: [
        { label: 'Resume', sub: null, action: function () { resume(); } },
        { label: 'Retry', action: function () {
          var LL = levelOf();
          resume();
          if (LL && LL.retry) LL.retry();
        }, disabled: function () { var LL = levelOf(); return !LL || LL.ended || LL.phase !== 'play'; } },
        { label: 'Restart', action: function () {
          var LL = levelOf();
          if (!LL) return;
          if (LL.checkpoint && LL.checkpoint.index >= 0) {
            P.dialog = U.dialog({ title: 'Restart level?', text: 'You will lose your checkpoint and start again from the beginning.', danger: true,
              pal: P.pal, focus: 1,
              options: [{ label: 'Restart', danger: true, action: function () { doRestart(); } }, { label: 'Cancel' }] });
          } else doRestart();
        }, disabled: function () { var LL = levelOf(); return !LL || LL.ended; } },
        { label: 'Settings', action: function () { AP.Scenes.push('settings', { from: 'pause' }); } },
        { label: 'Assist', arrow: true, action: function () { openView('assist'); } },
        { label: endless ? 'Quit run' : 'Quit to map', action: function () { doQuit(); } }
      ]
    });
    P.assistMenu = U.menu({
      x: 520, y: 132, w: 360, rowH: 38, size: 16, align: 'left', valueFrac: 0.55,
      onBack: function () { openView('main'); },
      items: [
        { type: 'toggle', label: 'Assist mode', get: function () { return !!assist().on; }, set: function (v) { setAssist('on', !!v); } },
        { type: 'choice', label: 'Game speed', wrap: false,
          options: [{ v: 1, label: '100%' }, { v: 0.85, label: '85%' }, { v: 0.7, label: '70%' }, { v: 0.5, label: '50%' }],
          get: function () { var s = +assist().speed; return s >= 0.99 ? 1 : (s >= 0.8 ? 0.85 : (s >= 0.65 ? 0.7 : 0.5)); },
          set: function (v) { setAssist('speed', v); }, disabled: function () { return !assist().on; } },
        { type: 'toggle', label: 'Invincibility', get: function () { return !!assist().invincible; }, set: function (v) { setAssist('invincible', !!v); },
          disabled: function () { return !assist().on; } },
        { type: 'toggle', label: 'Infinite air', get: function () { return !!assist().infiniteAir; }, set: function (v) { setAssist('infiniteAir', !!v); },
          disabled: function () { return !assist().on; } },
        { label: 'Skip level', danger: true, action: function () {
          P.dialog = U.dialog({ title: 'Skip this level?', text: 'It counts as cleared and opens the way on. Skipped clears are marked as assisted.',
            pal: P.pal, focus: 1,
            options: [{ label: 'Skip', danger: true, action: function () { doSkip(); } }, { label: 'Cancel' }] });
        }, disabled: function () { var LL = levelOf(); return !assist().on || !LL || LL.ended; } },
        { type: 'gap' },
        { label: 'Back', action: function () { openView('main'); } }
      ]
    });
  }

  function openView(v) {
    if (P.view === v) return;
    P.view = v;
    P.viewT = now();
    var m = v === 'assist' ? P.assistMenu : P.menu;
    m.intro = 0;
    m.selItem = m.firstSelectable(0, 1);
    m.snap();
  }

  function doRestart() {
    var L = levelOf();
    if (!L) return;
    P.closing = now();
    if (AP.UI) AP.UI.consumeAll();
    L.restart();
  }

  function doQuit() {
    var L = levelOf();
    P.closing = now();
    if (AP.UI) AP.UI.consumeAll();
    if (L) L.quit();
    else AP.Scenes.go('map', {}, { fx: 'fade', dur: 0.5 });
  }

  function doSkip() {
    var L = levelOf();
    if (!L || !assist().on) return;
    P.closing = now();
    UI().close('map');
    if (AP.UI) AP.UI.consumeAll();
    L.skipLevel();
  }

  P.enter = function (params) {
    P.L = (params && params.L) || AP.level || null;
    P.t0 = now();
    P.view = 'main';
    P.viewT = P.t0;
    P.dialog = null;
    P.closing = -1;
    P.under = false;
    var L = levelOf();
    P.pal = L ? L.pal : AP.R.pal('title');
    snapshotBlur(P.pal.bg);
    buildPauseMenus();
    AP.sfx('pause');
  };

  P.exit = function () { P.dialog = null; P.under = false; };
  P.covered = function () { P.under = true; };
  P.uncovered = function () { P.under = false; if (P.menu) P.menu.snap(); if (P.assistMenu) P.assistMenu.snap(); };

  P.update = function (dt) {
    if (P.closing >= 0) return;
    var U = UI();
    if (P.dialog) {
      P.dialog.update(dt);
      if (P.dialog && P.dialog.done) P.dialog = null;
      return;
    }
    var n = U.nav();
    if (n.pause) { U.eat(); resume(); return; }
    var m = P.view === 'assist' ? P.assistMenu : P.menu;
    m.update(dt);
  };

  P.render = function (ctx) {
    var U = UI();
    var L = levelOf();
    var pal = P.pal || AP.R.pal('title');
    var t = now() - P.t0;
    var k = M.ease.outCubic(clamp01(t / 0.28));
    if (P.closing >= 0) k *= clamp01(1 - (now() - P.closing) / 0.2);
    // blurred, dimmed world
    if (!drawBlur(ctx, k)) U.dim(ctx, 0.55 * k, pal.bg);
    U.dim(ctx, 0.42 * k, pal.bg);
    U.vignette(ctx, 0.85 * k);
    if (P.under) return;
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * k;
    // left: title, level and run stats
    var lx = 96;
    U.header(ctx, 'PAUSED', lx, 118, t, pal, { size: 40 });
    if (L) {
      var info = U.levelInfo(L.id);
      var label = L.mode === 'endless' ? '∞ ENDLESS' : (L.world > 0 ? info.label : 'TEST');
      text(ctx, label, lx, 164, 11, pal.accent, 'left', 1, '800');
      stroke(ctx, String(L.name || info.name || L.id).toUpperCase(), lx, 186, 17, pal.ink, 'left', 1, null, clamp01((t - 0.1) / 0.8), 330);
      // stats
      var rows = [['TIME', U.fmtTime(L.time)], ['DEATHS', String(L.stats.deaths)], ['SHARDS', L.stats.shards + ' / ' + L.stats.shardsTotal]];
      for (var i = 0; i < rows.length; i++) {
        var ry = 236 + i * 32;
        var rk = clamp01((t - 0.15 - i * 0.06) / 0.3);
        text(ctx, rows[i][0], lx, ry, 10.5, rgba(pal.primary, 0.8), 'left', rk, '800');
        stroke(ctx, rows[i][1], lx + 300, ry, 16, pal.ink, 'right', rk, null);
        ctx.globalAlpha = pa * k * rk * 0.25;
        ctx.strokeStyle = pal.primary;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx, ry + 14); ctx.lineTo(lx + 300, ry + 14);
        ctx.stroke();
        ctx.globalAlpha = pa * k;
      }
      var gy = 236 + 3 * 32;
      var gk = clamp01((t - 0.35) / 0.3);
      text(ctx, 'GEMS', lx, gy, 10.5, rgba(pal.primary, 0.8), 'left', gk, '800');
      for (var g = 0; g < 3; g++) {
        var st = L.stats.gems[g] ? 2 : (L.gemOwned && L.gemOwned[g] ? 1 : 0);
        U.gem(ctx, lx + 252 + g * 24, gy, 8, st, pal, gk, st === 2 ? t + g : undefined);
      }
      // current form, slowly turning
      var fk = clamp01((t - 0.4) / 0.5);
      var sides = U.formSides(L.form);
      ctx.globalAlpha = pa * k * fk;
      ctx.strokeStyle = rgba(pal.primary, 0.5);
      ctx.lineWidth = 1.2;
      U.formPath(ctx, lx + 34, 440, 26, L.form, t * 0.25);
      ctx.stroke();
      ctx.globalAlpha = pa * k;
      text(ctx, (AP.FORM_NAMES && AP.FORM_NAMES[L.form] ? AP.FORM_NAMES[L.form] : '').toUpperCase(), lx + 76, 434, 11, pal.ink, 'left', fk, '800');
      var hint = L.checkpoint && L.checkpoint.index >= 0 ? 'Checkpoint ' + (L.checkpoint.index + 1) + ' active' : 'No checkpoint yet';
      text(ctx, hint, lx + 76, 452, 11, rgba(pal.primary, 0.75), 'left', fk, '500');
    }
    // right: the menu (main or assist) sliding in
    var vk = M.ease.outCubic(clamp01((now() - P.viewT) / 0.25));
    var m = P.view === 'assist' ? P.assistMenu : P.menu;
    ctx.save();
    ctx.translate((1 - vk) * 30, 0);
    if (P.view === 'assist') {
      U.panel(ctx, 496, 70, 408, 420, { pal: pal, alpha: k * vk, fillAlpha: 0.72 });
      stroke(ctx, 'ASSIST', 520, 100, 20, pal.ink, 'left', k * vk, pal.accent, clamp01((now() - P.viewT) / 0.6));
      var asOn = !!assist().on;
      text(ctx, asOn ? 'Assisted clears keep no best time.' : 'Turn assist mode on to change these.', 520, 400, 11.5, rgba(pal.primary, 0.85), 'left', k * vk, '500', 360);
      text(ctx, 'Speed, invincibility and infinite air apply at once.', 520, 420, 11.5, rgba(pal.primary, 0.6), 'left', k * vk, '500', 360);
    } else {
      ctx.globalAlpha = pa * k * vk * 0.35;
      ctx.strokeStyle = pal.primary;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(512, 140); ctx.lineTo(512, 400);
      ctx.stroke();
      ctx.globalAlpha = pa * k;
    }
    if (m) m.render(ctx, { pal: pal, alpha: k * vk });
    ctx.restore();
    // hints
    U.hints(ctx, [[['up', 'down'], 'Select'], ['confirm', 'Choose'], ['pause', 'Resume']], 480, 512, { align: 'center', pal: pal, alpha: k * 0.85 });
    ctx.globalAlpha = pa;
    if (P.dialog) P.dialog.render(ctx, pal);
  };

  AP.Scenes.register('pause', P);

  // ================================================================ results
  var R = {
    res: null, info: null, t0: 0, t: 0, done: false, skipAt: -1, menu: null, pal: null, style: 'title',
    theorems: [], prevBest: 0, ticks: 0, stamps: null, leaving: false, worldState: null
  };

  // the reveal schedule (seconds since enter)
  var T_TITLE = 0, T_TIME = 0.55, T_TIME_END = 1.35, T_BEST = 1.45, T_DEATH = 1.7, T_SHARD = 2.05, T_SHARD_END = 2.85;
  var T_GEM = 2.95, T_GEM_STEP = 0.24, T_TH = 3.75, T_TH_STEP = 0.3, T_MENU = 3.9;

  function resultsNext() {
    var r = R.res;
    if (!r || R.leaving) return;
    R.leaving = true;
    if (r.ending) { UI().go('ending', {}, 'fade', 1.4, '#FFFFFF'); return; }
    if (r.next && r.mode === 'story' && AP.Levels && AP.Levels.has(r.next) && (!AP.Progress || AP.Progress.isUnlocked(r.next))) {
      UI().go('level', { id: r.next, mode: 'story' }, 'iris', 0.7);
      return;
    }
    toMap();
  }
  function toMap() {
    var r = R.res || {};
    R.leaving = true;
    var celebrate = !!(r.unlocked && r.unlocked.length);
    UI().go('map', { focus: r.id, celebrate: celebrate }, 'fade', 0.6);
  }
  function retry() {
    var r = R.res;
    if (!r || R.leaving) return;
    R.leaving = true;
    UI().go('level', { id: r.id, mode: r.mode === 'test' ? 'test' : 'story' }, 'iris', 0.6);
  }

  function buildResultsMenu() {
    var r = R.res;
    var U = UI();
    var canRetry = !!(r && r.id && AP.Levels && AP.Levels.has(r.id));
    var nextLabel = 'Continue';
    R.menu = U.menu({
      horizontal: true, x: 480, y: 494, rowH: 40, size: 17, stroke: true, gap: 22,
      items: [
        { label: nextLabel, minW: 170, action: function () { resultsNext(); } },
        { label: 'Retry', minW: 130, action: function () { retry(); }, disabled: function () { return !canRetry; } },
        { label: 'Map', minW: 130, action: function () { toMap(); } }
      ]
    });
  }

  R.bg = function () {
    return { key: R.style, camX: R.t * 14, camY: Math.sin(R.t * 0.2) * 30, intensity: 0.25 };
  };

  R.enter = function (params) {
    var r = params && typeof params === 'object' ? params : {};
    R.res = r;
    R.info = UI().levelInfo(r.id || '');
    R.t0 = now();
    R.t = 0;
    R.done = false;
    R.leaving = false;
    R.ticks = 0;
    var W = r.world > 0 && AP.Worlds ? AP.Worlds.get(r.world) : null;
    R.style = W ? (r.id === W.boss ? W.bossStyle : W.style) : 'title';
    if (AP.STYLES && AP.STYLES.indexOf(R.style) < 0) R.style = 'title';
    R.pal = AP.R.pal(R.style === 'void' ? 'w5' : R.style);
    R.theorems = (AP.Meta && AP.Meta.levelTheorems) ? AP.Meta.levelTheorems.slice(0, 5) : [];
    var rec = (AP.Save && AP.Save.data && AP.Save.data.levels) ? AP.Save.data.levels[r.id] : null;
    R.best = rec && rec.best > 0 ? rec.best : 0;
    R.worldState = W && AP.Progress && AP.Progress.worldState ? AP.Progress.worldState(W.n) : null;
    R.stamps = { best: false, flawless: false, allShards: false, gems: [false, false, false], th: 0, form: false };
    R.pctStr = 'COMPLETION ' + (AP.Progress && AP.Progress.percent ? AP.Progress.percent() : 0) + '%';
    buildResultsMenu();
    R.menu.active = false;
    // a boss clear faded the music out: let the spiral's theme (or the ending's) carry the results
    if (r.ending) AP.music('ending', { fade: 2 });
    else if (!AP.currentMusic) AP.music('map', { fade: 2 });
    if (AP.UI) AP.UI.sparks.clear();
  };

  R.exit = function () { R.menu = null; };

  function skipReveal() {
    R.t0 = now() - T_MENU - 0.05;
    R.done = true;
  }

  R.update = function (dt) {
    var U = UI();
    R.t = now() - R.t0;
    var n = U.nav();
    if (!R.done) {
      if (R.t >= T_MENU) { R.done = true; }
      else if (n.confirm || n.click || n.back) { U.eat(); skipReveal(); AP.sfx('uiMove'); return; }
    }
    if (R.done && R.menu) {
      R.menu.active = !R.leaving;
      R.menu.update(dt);
    }
    // sounds and stamps keyed to the schedule
    sounds();
  };

  function sounds() {
    var r = R.res || {};
    var t = R.t;
    var pal = R.pal;
    if (t > T_TIME && t < T_TIME_END) {
      var tick = Math.floor((t - T_TIME) / 0.07);
      if (tick > R.ticks) { R.ticks = tick; AP.sfx('type', { vol: 0.35, pitch: 0.9 + 0.5 * (t - T_TIME) / (T_TIME_END - T_TIME) }); }
    }
    if (t >= T_BEST && !R.stamps.best && r.newBest) {
      R.stamps.best = true;
      AP.sfx('chime');
      UI().sparks.emit(330, 228, { n: 26, color: pal.accent, color2: '#FFFFFF', speed: [60, 260], life: [0.4, 1.0], size: [1.2, 2.6], drag: 2.5, shape: 3 });
    }
    if (t >= T_DEATH + 0.35 && !R.stamps.flawless && (r.deaths | 0) === 0) { R.stamps.flawless = true; AP.sfx('uiSelect', { pitch: 1.4 }); }
    if (t >= T_SHARD_END && !R.stamps.allShards && r.shardsTotal > 0 && r.shards >= r.shardsTotal) {
      R.stamps.allShards = true;
      AP.sfx('chime', { pitch: 1.25 });
      UI().sparks.emit(430, 330, { n: 18, color: pal.accent, speed: [40, 180], life: [0.4, 0.8], size: [1, 2.2], drag: 3, shape: 1 });
    }
    for (var g = 0; g < 3; g++) {
      if (t >= T_GEM + g * T_GEM_STEP && !R.stamps.gems[g]) {
        R.stamps.gems[g] = true;
        if (r.gems && r.gems[g]) {
          AP.sfx('gem', { vol: 0.55, pitch: 1 + g * 0.12 });
          UI().sparks.emit(gemSlotX(g), 382, { n: 16, color: pal.accent, color2: pal.ink, speed: [50, 200], life: [0.35, 0.8], size: [1.2, 2.5], drag: 3, shape: 2 });
        }
      }
    }
    var thN = R.theorems.length;
    while (R.stamps.th < thN && t >= T_TH + R.stamps.th * T_TH_STEP) {
      var i = R.stamps.th++;
      AP.sfx('toast', { vol: 0.5, pitch: 1 + i * 0.08 });
      UI().sparks.emit(700, 230 + i * 40, { n: 10, color: pal.accent, speed: [30, 120], life: [0.3, 0.6], size: [1, 2], drag: 3, shape: 0 });
    }
  }

  function gemSlotX(g) { return 352 + g * 36; }

  function rowLine(ctx, pal, x, y, w, a) {
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * a * 0.22;
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y);
    ctx.stroke();
    ctx.globalAlpha = pa;
  }

  function stamp(ctx, label, x, y, color, k, rot, pal) {
    if (k <= 0) return;
    var e = M.ease.outBack(clamp01(k));
    var pa = ctx.globalAlpha;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot * (1 - clamp01(k)) - 0.06);
    ctx.scale(0.6 + 0.4 * e, 0.6 + 0.4 * e);
    ctx.globalAlpha = pa * clamp01(k * 2);
    var w = AP.R.measure(ctx, label, 11, '800') + 18;
    UI().chamferPath(ctx, -w / 2, -11, w, 22, 5);
    ctx.fillStyle = rgba(color, 0.18);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    TX.size = 11; TX.weight = '800'; TX.align = 'center'; TX.color = color; TX.alpha = 1; TX.maxW = 0;
    AP.R.text(ctx, label, 0, 0.5, TX);
    ctx.restore();
    ctx.globalAlpha = pa;
  }

  R.render = function (ctx) {
    var U = UI();
    var r = R.res || {};
    var info = R.info || {};
    var pal = R.pal || AP.R.pal('title');
    var t = now() - R.t0;
    U.sparks.tick();
    // veil over the world shader
    U.dim(ctx, 0.5, pal.bg);
    U.vignette(ctx, 0.9);
    var pa = ctx.globalAlpha;
    var x0 = 96;
    // header
    var label = r.world > 0 ? info.label : (r.mode === 'endless' ? '∞ ENDLESS' : 'TEST');
    var head = label + (r.firstClear ? '   ·   FIRST CLEAR' : '   ·   CLEARED');
    text(ctx, head, x0, 72, 11, pal.accent, 'left', clamp01(t / 0.4), '800');
    U.header(ctx, String(r.name || info.name || r.id || '').toUpperCase(), x0, 104, t - T_TITLE, pal, { size: 34 });
    if (r.assisted) stamp(ctx, 'ASSISTED', x0 + AP.R.measure(ctx, head, 11, '800') + 52, 72, pal.primary, clamp01((t - 0.6) / 0.3), 0.3, pal);
    var bossRun = !!info.boss && !((r.shardsTotal | 0) > 0);
    // ---- time
    var y = 186;
    var tk = clamp01((t - (T_TIME - 0.2)) / 0.3);
    text(ctx, 'TIME', x0, y, 11, rgba(pal.primary, 0.85), 'left', tk, '800');
    var ck = M.ease.outCubic(clamp01((t - T_TIME) / (T_TIME_END - T_TIME)));
    var shown = (r.time || 0) * ck;
    var par = info.par || 0;
    var under = par > 0 && r.time > 0 && r.time <= par && !r.assisted;
    var timeCol = (ck >= 1 && under) ? pal.accent : pal.ink;
    stroke(ctx, U.fmtTime(shown), x0 + 400, y, 26, timeCol, 'right', tk, ck >= 1 && under ? pal.accent : null);
    if (par > 0) {
      var pk = clamp01((t - T_TIME_END) / 0.3);
      var d = (r.time || 0) - par;
      var sign = d <= 0 ? '−' : '+';
      text(ctx, 'PAR ' + U.fmtTime(par).replace(/\.\d+$/, '') + '   ' + sign + U.fmtTime(Math.abs(d)), x0 + 400, y + 24, 11.5,
        d <= 0 ? pal.accent : rgba(pal.primary, 0.75), 'right', pk, '700');
    }
    if (R.best > 0 && !r.newBest) text(ctx, 'BEST ' + U.fmtTime(R.best), x0, y + 24, 11.5, rgba(pal.primary, 0.75), 'left', clamp01((t - T_TIME_END) / 0.3), '700');
    if (r.newBest) {
      var nb = clamp01((t - T_BEST) / 0.35);
      if (nb > 0) {
        stamp(ctx, 'NEW BEST', x0 + 470, y, pal.accent, nb, -0.6, pal);
        U.burst(ctx, x0 + 470, y, 34, 50 + 14 * Math.sin(t * 3), 12, t * 0.5, pal.accent, 0.45 * clamp01(nb * 2), 1.3);
      }
    } else if (r.firstClear && r.time > 0 && !r.assisted) {
      stamp(ctx, 'FIRST TIME', x0 + 470, y, pal.ink, clamp01((t - T_BEST) / 0.35), -0.4, pal);
    }
    rowLine(ctx, pal, x0, y + 40, 520, tk);
    // ---- deaths
    y = 262;
    var dk = clamp01((t - (T_DEATH - 0.15)) / 0.3);
    text(ctx, 'DEATHS', x0, y, 11, rgba(pal.primary, 0.85), 'left', dk, '800');
    var dc = Math.round((r.deaths | 0) * M.ease.outCubic(clamp01((t - T_DEATH) / 0.35)));
    stroke(ctx, String(dc), x0 + 400, y, 22, pal.ink, 'right', dk, null);
    if ((r.deaths | 0) === 0) stamp(ctx, 'FLAWLESS', x0 + 470, y, pal.accent, clamp01((t - T_DEATH - 0.35) / 0.35), 0.5, pal);
    rowLine(ctx, pal, x0, y + 26, 520, dk);
    if (bossRun) {
      drawVertexRow(ctx, r, info, pal, t, x0);
    } else {
      drawCollectRows(ctx, r, pal, t, x0);
    }
    drawRight(ctx, r, pal, t);
    // menu
    var mk = clamp01((t - (T_MENU - 0.25)) / 0.35);
    if (R.menu) R.menu.render(ctx, { pal: pal, alpha: mk });
    if (!R.done) text(ctx, 'Press ' + AP.Input.label('confirm') + ' to skip', 480, 520, 11, rgba(pal.primary, 0.55), 'center', clamp01((t - 0.8) / 0.4), '600');
    U.sparks.render(ctx);
    ctx.globalAlpha = pa;
  };

  // a boss clear: the defeated name struck through, and the vertex the player claimed
  function drawVertexRow(ctx, r, info, pal, t, x0) {
    var U = UI();
    var y = 318;
    var k = clamp01((t - (T_SHARD - 0.15)) / 0.3);
    text(ctx, 'DEFEATED', x0, y, 11, rgba(pal.primary, 0.85), 'left', k, '800');
    var W = AP.Worlds ? AP.Worlds.get(r.world) : null;
    var bname = String((W && W.bossName) || info.name || '').toUpperCase();
    var w = stroke(ctx, bname, x0 + 400, y, 18, pal.hazard, 'right', k, null, clamp01((t - T_SHARD) / 0.7), 300);
    var sk = M.ease.outCubic(clamp01((t - T_SHARD - 0.6) / 0.4));
    var pa = ctx.globalAlpha;
    if (sk > 0) {
      ctx.globalAlpha = pa * k;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0 + 400 - w - 6, y); ctx.lineTo(x0 + 400 - w - 6 + (w + 12) * sk, y);
      ctx.stroke();
      ctx.globalAlpha = pa;
    }
    rowLine(ctx, pal, x0, y + 34, 520, k);
    y = 382;
    var vk = clamp01((t - (T_GEM - 0.25)) / 0.4);
    text(ctx, 'VERTEX', x0, y, 11, rgba(pal.primary, 0.85), 'left', vk, '800');
    var vx = x0 + 380, vy = y;
    var e = M.ease.outBack(vk);
    AP.R.glow(ctx, vx, vy, 30 * e, pal.accent, 0.7 * vk);
    ctx.globalAlpha = pa * vk;
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = t * 1.2 + i * TAU / 6;
      ctx.moveTo(vx + Math.cos(a) * 7 * e, vy + Math.sin(a) * 7 * e);
      ctx.lineTo(vx + Math.cos(a) * 17 * e, vy + Math.sin(a) * 17 * e);
    }
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(vx, vy, 3.5 * e, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = pa;
    var claim = r.ending ? 'The last vertex: ∞' : (r.formGained ? 'claimed: you are the ' + (AP.FORM_NAMES[r.formGained] || '') : 'claimed');
    text(ctx, claim, x0 + 350, y, 12, rgba(pal.ink, 0.85), 'right', vk, '600');
  }

  function drawCollectRows(ctx, r, pal, t, x0) {
    var U = UI();
    var y;
    // ---- shards
    y = 318;
    var sk = clamp01((t - (T_SHARD - 0.15)) / 0.3);
    var tot = r.shardsTotal | 0, got = r.shards | 0;
    var fk = M.ease.outCubic(clamp01((t - T_SHARD) / (T_SHARD_END - T_SHARD)));
    text(ctx, 'SHARDS', x0, y, 11, rgba(pal.primary, 0.85), 'left', sk, '800');
    stroke(ctx, Math.round(got * fk) + ' / ' + tot, x0 + 400, y, 20, got >= tot && tot > 0 && fk >= 1 ? pal.accent : pal.ink, 'right', sk, null);
    U.bar(ctx, x0, y + 16, 400, 4, tot > 0 ? got / tot * fk : 0, pal, { alpha: sk, glow: fk < 1 && fk > 0 ? 0.8 : 0 });
    if (tot > 0 && got >= tot) stamp(ctx, 'ALL SHARDS', x0 + 470, y, pal.accent, clamp01((t - T_SHARD_END) / 0.35), -0.5, pal);
    rowLine(ctx, pal, x0, y + 34, 520, sk);
    // ---- gems
    y = 382;
    var gk2 = clamp01((t - (T_GEM - 0.25)) / 0.3);
    text(ctx, 'PRIME GEMS', x0, y, 11, rgba(pal.primary, 0.85), 'left', gk2, '800');
    var rec = (AP.Save && AP.Save.data && AP.Save.data.levels) ? AP.Save.data.levels[r.id] : null;
    for (var g = 0; g < 3; g++) {
      var gp = clamp01((t - T_GEM - g * T_GEM_STEP) / 0.3);
      var gotG = !!(r.gems && r.gems[g]);
      var owned = !!(rec && rec.gems && rec.gems[g]);
      var stg = gotG && gp > 0 ? 2 : (owned ? 1 : 0);
      var sc = gotG ? (gp > 0 ? 1 + 0.45 * Math.sin(Math.min(1, gp) * Math.PI) : 0.7) : 1;
      if (gotG && gp > 0) AP.R.glow(ctx, gemSlotX(g), y, 22, pal.accent, 0.5 * gp);
      U.gem(ctx, gemSlotX(g), y, 11 * sc, stg, pal, gk2, stg === 2 ? t + g : undefined);
    }
    var ngot = (r.gems ? (r.gems[0] ? 1 : 0) + (r.gems[1] ? 1 : 0) + (r.gems[2] ? 1 : 0) : 0);
    text(ctx, ngot + ' this run', x0 + 470, y, 11.5, rgba(pal.primary, 0.75), 'left', clamp01((t - T_GEM - 0.6) / 0.3), '600');
  }

  // right column: the new form, the theorems proved in this level, and the world's progress
  function drawRight(ctx, r, pal, t) {
    var U = UI();
    var pa = ctx.globalAlpha;
    var rx = 668;
    var ry = 160;
    if (r.formGained) {
      var fa = clamp01((t - 0.4) / 0.5);
      var fcx = rx + 40, fcy = ry + 26;
      U.burst(ctx, fcx, fcy, 30, 46 + 6 * Math.sin(t * 2.5), 16, t * 0.3, pal.accent, 0.5 * fa, 1.2);
      AP.R.glow(ctx, fcx, fcy, 44, pal.accent, 0.5 * fa);
      ctx.globalAlpha = pa * fa;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      U.morphPath(ctx, fcx, fcy, 24, PREV[r.formGained] || 3, r.formGained, clamp01((t - 0.5) / 0.9), U.flatRot(U.formSides(r.formGained)) + t * 0.3);
      ctx.fillStyle = rgba(pal.accent, 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.lineJoin = 'miter';
      ctx.globalAlpha = pa;
      text(ctx, 'NEW FORM', rx + 86, ry + 12, 11, pal.accent, 'left', fa, '800');
      stroke(ctx, (U.formWord(r.formGained) + ' — ' + (AP.FORM_NAMES[r.formGained] || '')).toUpperCase(), rx + 86, ry + 36, 17, pal.ink, 'left', fa, pal.accent, clamp01((t - 0.6) / 1.0), 200);
      ry += 86;
    }
    var thN = R.theorems.length;
    if (thN) {
      var hk = clamp01((t - (T_TH - 0.3)) / 0.3);
      text(ctx, thN === 1 ? 'THEOREM PROVED' : 'THEOREMS PROVED', rx, ry, 11, pal.accent, 'left', hk, '800');
      for (var i = 0; i < thN; i++) {
        var tk2 = clamp01((t - T_TH - i * T_TH_STEP) / 0.35);
        if (tk2 <= 0) continue;
        var th = AP.Meta ? AP.Meta.theorem(R.theorems[i]) : null;
        var yy = ry + 30 + i * 40;
        var e = M.ease.outBack(tk2);
        U.emblem(ctx, R.theorems[i], rx + 16, yy, 13 * e, pal.accent, tk2, t);
        stroke(ctx, th ? th.name : R.theorems[i], rx + 40, yy - 4, 14, pal.ink, 'left', tk2, null, clamp01(tk2 * 1.3), 220);
        if (th) text(ctx, th.desc, rx + 40, yy + 12, 10.5, rgba(pal.primary, 0.75), 'left', tk2, '500', 0);
      }
      ry += 40 + thN * 40;
    }
    if (R.worldState && ry < 400) {
      var ws = R.worldState;
      var W = AP.Worlds.get(r.world);
      var wk = clamp01((t - 1.0) / 0.4);
      text(ctx, 'WORLD ' + r.world + ' · ' + (W ? W.name.toUpperCase() : ''), rx, ry + 8, 11, rgba(pal.primary, 0.85), 'left', wk, '800');
      var tl = W ? W.levels + 1 : 1;
      U.bar(ctx, rx, ry + 24, 200, 3, ws.levelsDone / tl, pal, { alpha: wk });
      text(ctx, ws.levelsDone + ' / ' + tl + ' cleared   ·   ' + ws.gems + ' / ' + ws.gemsTotal + ' gems', rx, ry + 42, 11, rgba(pal.ink, 0.8), 'left', wk, '600');
    }
    // overall completion
    text(ctx, R.pctStr, 864, 72, 10.5, rgba(pal.primary, 0.7), 'right', clamp01((t - 0.8) / 0.4), '800');
    ctx.globalAlpha = pa;
  }

  var PREV = { 4: 3, 5: 4, 6: 5, 99: 6 };

  AP.Scenes.register('results', R);
})(window.AP = window.AP || {});
