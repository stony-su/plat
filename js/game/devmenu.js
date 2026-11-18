/* js/game/devmenu.js — owner: CORE */
(function (AP) {
  'use strict';

  // Scene 'devmenu': lists every registered level and scene, offers a form override, and is the fallback game
  // flow when the UI scenes (title, map, results...) are absent, so the game is always playable.
  var M = AP.M;
  var TAU = Math.PI * 2;
  var FORM_OPTS = [0, 3, 4, 5, 6, 99];          // 0 = the level's own form (story mode)
  var ROW_H = 22;
  var LIST_X = 48, LIST_Y = 128, LIST_W = 470, LIST_H = 360;
  var SIDE_X = 566, SIDE_W = 346;
  var OVERLAY_SCENES = { pause: 1, results: 1, level: 1, devmenu: 1 };
  var PUSH_SCENES = { settings: 1, remap: 1 };

  var S = {
    bg: 'title',
    panel: 0,
    left: [],
    right: [],
    selL: 0,
    selR: 0,
    scroll: 0,
    formIdx: 0,
    t: 0,
    resetArm: 0,
    msg: '',
    msgT: 0,
    lastClick: -1
  };

  function dev() { return AP.DEV || (AP.Progress && AP.Progress.unlockAll); }

  function playable(id) {
    if (dev()) return true;
    if (!AP.Progress) return true;
    return AP.Progress.isUnlocked(id);
  }

  function build() {
    var left = [];
    var defs = AP.Levels.list();
    var lastWorld = -1;
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var wN = d.world | 0;
      if (wN !== lastWorld) {
        lastWorld = wN;
        var W = AP.Worlds && AP.Worlds.get(wN);
        left.push({ kind: 'header', text: W ? ('WORLD ' + W.n + ' — ' + W.name.toUpperCase()) : (wN === 0 ? 'TEST & EXTRA' : 'WORLD ' + wN) });
      }
      left.push({ kind: 'level', id: String(d.id), def: d });
    }
    if (!defs.length) left.push({ kind: 'header', text: 'NO LEVELS REGISTERED' });
    S.left = left;
    var right = [];
    right.push({ kind: 'continue', text: 'Continue' });
    right.push({ kind: 'form', text: 'Form' });
    right.push({ kind: 'header', text: 'SCENES' });
    var names = AP.Scenes.list();
    for (var j = 0; j < names.length; j++) {
      if (OVERLAY_SCENES[names[j]]) continue;
      right.push({ kind: 'scene', name: names[j], text: names[j] });
    }
    right.push({ kind: 'header', text: 'DATA' });
    if (AP.DEV) right.push({ kind: 'unlock', text: 'Unlock all levels' });
    right.push({ kind: 'reset', text: 'Reset progress' });
    S.right = right;
    S.selL = clampSel(left, S.selL, 1);
    S.selR = clampSel(right, S.selR, 1);
  }

  function selectable(it) { return it && it.kind !== 'header'; }

  function clampSel(list, sel, dir) {
    if (!list.length) return 0;
    sel = M.clamp(sel, 0, list.length - 1);
    var guard = 0;
    while (!selectable(list[sel]) && guard++ < list.length) sel = M.mod(sel + (dir || 1), list.length);
    return sel;
  }

  function moveSel(list, sel, dir) {
    if (!list.length) return 0;
    var s = sel;
    for (var i = 0; i < list.length; i++) {
      s = M.mod(s + dir, list.length);
      if (selectable(list[s])) return s;
    }
    return sel;
  }

  function toast(msg) { S.msg = msg; S.msgT = 2.4; }

  function launch(id) {
    if (!AP.Levels.has(id)) { AP.sfx('uiDeny'); return; }
    if (!playable(id)) { AP.sfx('uiDeny'); toast('Locked — clear the previous level first'); return; }
    var form = FORM_OPTS[S.formIdx];
    var params;
    if (form) params = { id: id, mode: 'test', form: form };
    else params = { id: id, mode: /^test-/.test(id) ? 'test' : 'story' };
    AP.sfx('uiSelect');
    AP.Scenes.go('level', params, { fx: 'iris', dur: 0.6 });
  }

  function activateRight(it) {
    if (!it) return;
    if (it.kind === 'continue') {
      var id = AP.Progress ? AP.Progress.current() : null;
      if (id && AP.Levels.has(id)) { S.formIdx = 0; launch(id); }
      else {
        var first = null;
        for (var i = 0; i < S.left.length; i++) if (S.left[i].kind === 'level') { first = S.left[i].id; break; }
        if (first) launch(first); else AP.sfx('uiDeny');
      }
    } else if (it.kind === 'form') {
      S.formIdx = (S.formIdx + 1) % FORM_OPTS.length;
      AP.sfx('uiMove');
    } else if (it.kind === 'scene') {
      AP.sfx('uiSelect');
      if (PUSH_SCENES[it.name]) AP.Scenes.push(it.name, { from: 'devmenu' });
      else AP.Scenes.go(it.name, {}, { fx: 'fade', dur: 0.5 });
    } else if (it.kind === 'unlock') {
      if (AP.Progress) AP.Progress.unlockAll = !AP.Progress.unlockAll;
      AP.sfx('uiSelect');
      toast(AP.Progress && AP.Progress.unlockAll ? 'All levels unlocked (this session)' : 'Unlock-all off');
    } else if (it.kind === 'reset') {
      if (S.resetArm > 0) {
        S.resetArm = 0;
        if (AP.Save && AP.Save.reset) AP.Save.reset();
        AP.sfx('uiSelect');
        toast('Progress reset');
        build();
      } else {
        S.resetArm = 2;
        AP.sfx('uiDeny');
        toast('Press again to erase all progress');
      }
    }
  }

  function ensureVisible() {
    var idx = S.selL;
    var y = idx * ROW_H;
    if (y < S.scroll) S.scroll = y;
    if (y + ROW_H > S.scroll + LIST_H) S.scroll = y + ROW_H - LIST_H;
    var maxS = Math.max(0, S.left.length * ROW_H - LIST_H);
    S.scroll = M.clamp(S.scroll, 0, maxS);
  }

  // ---------------------------------------------------------------- scene hooks
  S.enter = function () {
    S.t = 0;
    S.resetArm = 0;
    if (AP.level) AP.level = null;
    build();
    ensureVisible();
    if (!AP.currentMusic || /^w|^boss/.test(String(AP.currentMusic))) AP.music('title');
  };

  S.uncovered = function () { build(); };

  S.update = function (dt) {
    var I = AP.Input;
    S.t += dt;
    if (S.resetArm > 0) S.resetArm = Math.max(0, S.resetArm - dt);
    if (S.msgT > 0) S.msgT -= dt;
    // keyboard / pad
    if (I.repeat('up')) {
      if (S.panel === 0) { S.selL = moveSel(S.left, S.selL, -1); ensureVisible(); } else S.selR = moveSel(S.right, S.selR, -1);
      AP.sfx('uiMove');
    }
    if (I.repeat('down')) {
      if (S.panel === 0) { S.selL = moveSel(S.left, S.selL, 1); ensureVisible(); } else S.selR = moveSel(S.right, S.selR, 1);
      AP.sfx('uiMove');
    }
    var sideItem = S.right[S.selR];
    if (I.repeat('left')) {
      if (S.panel === 1 && sideItem && sideItem.kind === 'form') S.formIdx = M.mod(S.formIdx - 1, FORM_OPTS.length);
      else S.panel = 0;
      AP.sfx('uiMove');
    }
    if (I.repeat('right')) {
      if (S.panel === 1 && sideItem && sideItem.kind === 'form') S.formIdx = (S.formIdx + 1) % FORM_OPTS.length;
      else S.panel = 1;
      AP.sfx('uiMove');
    }
    if (I.pressed('confirm')) {
      if (S.panel === 0) { var it = S.left[S.selL]; if (it && it.kind === 'level') launch(it.id); }
      else activateRight(S.right[S.selR]);
    }
    if (I.pressed('back') && AP.Scenes.has('title')) { AP.sfx('uiBack'); AP.Scenes.go('title', {}, { fx: 'fade', dur: 0.5 }); }
    // mouse
    var m = I.mouse;
    if (m && (m.moved || m.pressed)) {
      var hit = hitTest(m.x, m.y);
      if (hit) {
        if (hit.panel === 0 && S.left[hit.i] && selectable(S.left[hit.i])) { S.panel = 0; S.selL = hit.i; }
        if (hit.panel === 1 && S.right[hit.i] && selectable(S.right[hit.i])) { S.panel = 1; S.selR = hit.i; }
        if (m.pressed) {
          if (hit.panel === 0 && S.left[hit.i] && S.left[hit.i].kind === 'level') launch(S.left[hit.i].id);
          else if (hit.panel === 1) activateRight(S.right[hit.i]);
        }
      }
      m.moved = false;
    }
  };

  function hitTest(x, y) {
    if (x >= LIST_X && x < LIST_X + LIST_W && y >= LIST_Y && y < LIST_Y + LIST_H) {
      var i = Math.floor((y - LIST_Y + S.scroll) / ROW_H);
      if (i >= 0 && i < S.left.length) return { panel: 0, i: i };
    }
    if (x >= SIDE_X && x < SIDE_X + SIDE_W && y >= LIST_Y && y < LIST_Y + S.right.length * ROW_H) {
      var j = Math.floor((y - LIST_Y) / ROW_H);
      if (j >= 0 && j < S.right.length) return { panel: 1, i: j };
    }
    return null;
  }

  // ---------------------------------------------------------------- render
  var TITLE = { size: 38, weight: '200', align: 'left', baseline: 'alphabetic', color: '#fff' };
  var SUB = { size: 13, weight: '600', align: 'left', baseline: 'alphabetic', color: '#C9D1FF' };
  var HEAD = { size: 11, weight: '800', align: 'left', baseline: 'middle', color: '#FFD36E' };
  var ROW = { size: 15, weight: '600', align: 'left', baseline: 'middle', color: '#fff' };
  var ROWR = { size: 13, weight: '600', align: 'right', baseline: 'middle', color: '#fff', mono: true };
  var HINT = { size: 12, weight: '500', align: 'center', baseline: 'middle', color: '#C9D1FF' };
  var MSG = { size: 14, weight: '700', align: 'center', baseline: 'middle', color: '#FFD36E' };

  function formLabel(f) {
    if (!f) return 'Level default';
    return (AP.FORM_NAMES && AP.FORM_NAMES[f]) ? AP.FORM_NAMES[f] + ' (' + (f >= 32 ? '∞' : f) + ')' : String(f);
  }

  S.render = function (ctx) {
    var R = AP.R;
    var pal = R.pal('title');
    var t = S.t;
    var intro = AP.M.ease.outCubic(M.clamp(t / 0.5, 0, 1));
    // dim the shader a little for legibility
    ctx.fillStyle = AP.Color.rgba('#05060D', 0.55);
    ctx.fillRect(0, 0, 960, 540);
    ctx.globalAlpha = intro;
    // header: logo polygon morph + title
    var sides = [3, 4, 5, 6, 48][Math.floor(t / 1.6) % 5];
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2;
    R.poly(ctx, 64, 62, 16, sides, t * 0.6);
    ctx.stroke();
    R.glow(ctx, 64, 62, 30, pal.accent, 0.35);
    TITLE.color = pal.ink;
    R.text(ctx, 'A P E I R O N', 96, 76, TITLE);
    SUB.color = pal.primary;
    var pct = AP.Progress ? AP.Progress.percent() : 0;
    var form = (AP.Save && AP.Save.data) ? AP.Save.data.form : 3;
    R.text(ctx, 'DEVELOPER MENU  ·  v' + AP.VERSION + '  ·  ' + pct + '% complete  ·  form ' + (AP.FORM_NAMES[form] || form) +
      (AP.DEV ? '  ·  DEV' : ''), 98, 100, SUB);

    // left: levels
    ctx.save();
    ctx.beginPath();
    ctx.rect(LIST_X - 8, LIST_Y - 2, LIST_W + 16, LIST_H + 4);
    ctx.clip();
    var data = AP.Save && AP.Save.data;
    for (var i = 0; i < S.left.length; i++) {
      var y = LIST_Y + i * ROW_H - S.scroll + ROW_H / 2;
      if (y < LIST_Y - ROW_H || y > LIST_Y + LIST_H + ROW_H) continue;
      var it = S.left[i];
      if (it.kind === 'header') {
        HEAD.color = pal.accent;
        R.text(ctx, it.text, LIST_X, y + 3, HEAD);
        ctx.strokeStyle = AP.Color.rgba(pal.accent, 0.25);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LIST_X, y + 11); ctx.lineTo(LIST_X + LIST_W, y + 11);
        ctx.stroke();
        continue;
      }
      var sel = S.panel === 0 && i === S.selL;
      var ok = playable(it.id);
      var rec = data && data.levels ? data.levels[it.id] : null;
      if (sel) {
        ctx.fillStyle = AP.Color.rgba(pal.accent, 0.12);
        ctx.fillRect(LIST_X - 6, y - ROW_H / 2 + 1, LIST_W + 12, ROW_H - 2);
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1.5;
        R.poly(ctx, LIST_X + 4, y, 5, it.def.form >= 32 ? 48 : (it.def.form || 3), t * 2.5);
        ctx.stroke();
      }
      ROW.color = ok ? (sel ? pal.ink : AP.Color.rgba(pal.ink, 0.85)) : AP.Color.rgba(pal.ink, 0.3);
      R.text(ctx, it.id, LIST_X + 16, y, ROW);
      R.text(ctx, it.def.name || '', LIST_X + 112, y, ROW);
      ROWR.color = AP.Color.rgba(pal.primary, ok ? 0.8 : 0.3);
      var info = '';
      if (rec && rec.done) info += '✓ ' + (rec.best > 0 ? R.fmtTime(rec.best) : '');
      else if (!ok) info += 'locked';
      if (rec && !it.def.boss && /^w\d/.test(it.id)) info += '  ' + (rec.gems[0] ? '◆' : '◇') + (rec.gems[1] ? '◆' : '◇') + (rec.gems[2] ? '◆' : '◇');
      R.text(ctx, info, LIST_X + LIST_W, y, ROWR);
    }
    ctx.restore();
    // scrollbar
    var total = S.left.length * ROW_H;
    if (total > LIST_H) {
      var bh = LIST_H * LIST_H / total;
      var by = LIST_Y + (LIST_H - bh) * (S.scroll / (total - LIST_H));
      ctx.fillStyle = AP.Color.rgba(pal.primary, 0.3);
      ctx.fillRect(LIST_X + LIST_W + 12, by, 3, bh);
    }

    // right: options and scenes
    for (var j = 0; j < S.right.length; j++) {
      var r = S.right[j];
      var yy = LIST_Y + j * ROW_H + ROW_H / 2;
      if (r.kind === 'header') {
        HEAD.color = pal.accent;
        R.text(ctx, r.text, SIDE_X, yy + 3, HEAD);
        continue;
      }
      var sl = S.panel === 1 && j === S.selR;
      if (sl) {
        ctx.fillStyle = AP.Color.rgba(pal.accent, 0.12);
        ctx.fillRect(SIDE_X - 6, yy - ROW_H / 2 + 1, SIDE_W + 12, ROW_H - 2);
      }
      ROW.color = sl ? pal.ink : AP.Color.rgba(pal.ink, 0.8);
      var label = r.text;
      if (r.kind === 'form') label = 'Form:  ‹ ' + formLabel(FORM_OPTS[S.formIdx]) + ' ›';
      if (r.kind === 'reset' && S.resetArm > 0) { ROW.color = pal.hazard; label = 'Reset progress — press again'; }
      if (r.kind === 'unlock' && AP.Progress && AP.Progress.unlockAll) label = 'Unlock all levels  ✓';
      if (r.kind === 'continue') {
        var cur = AP.Progress ? AP.Progress.current() : null;
        if (cur) label = 'Continue  ·  ' + cur;
      }
      R.text(ctx, label, SIDE_X + 10, yy, ROW);
    }

    // footer
    HINT.color = AP.Color.rgba(pal.primary, 0.75);
    R.text(ctx, AP.Common ? AP.Common.labelText('{up}{down} select   {left}{right} panel / form   {confirm} play') +
      (AP.DEV ? '   ·   F1 hitboxes  F2 perf  F3 god  F4 complete  F6 boss hit  F9 menu' : '') : '', 480, 516, HINT);
    if (S.msgT > 0) {
      ctx.globalAlpha = intro * M.clamp(S.msgT / 0.3, 0, 1);
      MSG.color = pal.accent;
      R.text(ctx, S.msg, 480, 494, MSG);
    }
    ctx.globalAlpha = 1;
  };

  AP.Scenes.register('devmenu', S);
  AP.DevMenu = S;
})(window.AP = window.AP || {});
