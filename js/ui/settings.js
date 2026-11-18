/* js/ui/settings.js — owner: UI */
(function (AP) {
  'use strict';

  // Scenes 'settings' {from?} and 'remap' (both pushed overlays, transparent). Every value goes through
  // AP.Save.setSetting; remapping uses AP.Input.capture. Data: export / import the save, reset progress (double confirm).
  var M = AP.M;
  var TAU = Math.PI * 2;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function now() { return (AP.Time && AP.Time.now) || 0; }
  function UI() { return AP.UI; }
  function st() { return (AP.Save && AP.Save.data && AP.Save.data.settings) || {}; }
  function set(path, v) { if (AP.Save && AP.Save.setSetting) AP.Save.setSetting(path, v); }
  function get(path, d) { var v = AP.Save && AP.Save.setting ? AP.Save.setting(path) : undefined; return v === undefined ? d : v; }
  function toast(title, sub, kind) { if (AP.Meta && AP.Meta.pushToast) AP.Meta.pushToast({ title: title, sub: sub, kind: kind || 'info' }); else if (AP.toast) AP.toast(title, sub); }
  function inLevel() { return !!AP.level; }

  var TX = { size: 13, weight: '600', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1, maxW: 0 };
  function text(ctx, str, x, y, size, color, align, alpha, weight, maxW) {
    TX.size = size; TX.color = color; TX.align = align || 'left'; TX.alpha = alpha === undefined ? 1 : alpha;
    TX.weight = weight || '600'; TX.maxW = maxW || 0;
    return AP.R.text(ctx, str, x, y, TX);
  }

  // ================================================================ save export / import (browser APIs, all guarded)
  var lastUrl = null;
  function exportSave() {
    var str = '';
    try { str = AP.Save.export(); } catch (e) { str = ''; }
    if (!str) { toast('Export failed', 'The save could not be serialised.', 'warn'); return; }
    var copied = false, saved = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str).then(function () { /* copied */ }, function () { /* ignored: the file still downloads */ });
        copied = true;
      }
    } catch (e1) { copied = false; }
    try {
      if (typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL && document.createElement) {
        if (lastUrl && URL.revokeObjectURL) { try { URL.revokeObjectURL(lastUrl); } catch (e2) { /* stale */ } }
        var blob = new Blob([str], { type: 'application/json' });
        lastUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = lastUrl;
        var d = new Date();
        var m = d.getMonth() + 1, day = d.getDate();
        a.download = 'apeiron-save-' + d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + '.json';
        if (document.body && document.body.appendChild) document.body.appendChild(a);
        a.click();
        if (a.remove) a.remove();
        saved = true;
      }
    } catch (e3) { saved = false; }
    if (saved || copied) {
      AP.sfx('chime', { vol: 0.6 });
      toast('Save exported', (saved ? 'File downloaded' : '') + (saved && copied ? ' · ' : '') + (copied ? 'copied to the clipboard' : ''));
    } else toast('Export unavailable', 'This browser blocks downloads and the clipboard.', 'warn');
  }

  function applyImport(str) {
    var ok = false;
    try { ok = !!AP.Save.import(String(str || '')); } catch (e) { ok = false; }
    if (ok) {
      AP.sfx('vertex', { vol: 0.6 });
      toast('Save imported', 'Your progress, gems and theorems are restored.');
      if (AP.Meta && AP.Meta.checkAll) AP.Meta.checkAll(true);
    } else {
      AP.sfx('uiDeny');
      toast('Import failed', 'That is not an APEIRON save.', 'warn');
    }
  }

  function importFile() {
    try {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,.txt,application/json,text/plain';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        try {
          var rd = new FileReader();
          rd.addEventListener('load', function () { applyImport(rd.result); });
          rd.addEventListener('error', function () { toast('Import failed', 'The file could not be read.', 'warn'); });
          rd.readAsText(f);
        } catch (e) { toast('Import failed', 'The file could not be read.', 'warn'); }
      });
      inp.click();
    } catch (e2) { toast('Import unavailable', 'This browser cannot open files here.', 'warn'); }
  }

  function importClipboard() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (txt) {
          if (!txt) { toast('Clipboard is empty', 'Copy an exported save first.', 'warn'); return; }
          applyImport(txt);
        }, function () { toast('Clipboard unavailable', 'Use “Import save from file” instead.', 'warn'); });
        return;
      }
    } catch (e) { /* fall through */ }
    toast('Clipboard unavailable', 'Use “Import save from file” instead.', 'warn');
  }

  function isFullscreen() {
    try { return !!(document.fullscreenElement || document.webkitFullscreenElement); } catch (e) { return false; }
  }

  // ================================================================ settings
  var S = {
    transparent: true,
    t0: 0, menu: null, dialog: null, from: null, coveredT: -1, closing: -1
  };

  function confirmDialog(o) {
    S.dialog = UI().dialog({ title: o.title, text: o.text, danger: !!o.danger, focus: 1, pal: palOf(),
      options: [{ label: o.yes, danger: !!o.danger, action: o.action }, { label: 'Cancel' }] });
  }

  function palOf() { return AP.level ? AP.level.pal : AP.R.pal('title'); }

  function close() {
    if (S.closing >= 0) return;
    S.closing = now();
    UI().close(AP.level ? 'map' : 'title');
  }

  function pct(v) { return Math.round(v * 100) + '%'; }

  function buildSettings() {
    var U = UI();
    var items = [
      { type: 'header', label: 'Audio' },
      { type: 'slider', label: 'Master volume', hint: 'Everything you hear.', get: function () { return get('master', 0.8); }, set: function (v) { set('master', v); }, fmt: pct },
      { type: 'slider', label: 'Music', hint: 'The generated score of each world.', get: function () { return get('music', 0.6); }, set: function (v) { set('music', v); }, fmt: pct },
      { type: 'slider', label: 'Sound effects', hint: 'Jumps, shards, menus.', get: function () { return get('sfx', 0.8); }, set: function (v) { set('sfx', v); }, fmt: pct, sound: 'shard' },
      { type: 'header', label: 'Video' },
      { type: 'slider', label: 'Screen shake', hint: 'Scales every camera shake.', get: function () { return get('shake', 1); }, set: function (v) { set('shake', v); }, fmt: pct, step: 0.1 },
      { type: 'choice', label: 'Flashes', hint: 'Reduced: dimmer and at most two a second. Off: none.', options: [{ v: 'full', label: 'Full' }, { v: 'reduced', label: 'Reduced' }, { v: 'off', label: 'Off' }],
        get: function () { return get('flash', 'full'); }, set: function (v) { set('flash', v); } },
      { type: 'choice', label: 'Particles', hint: 'Lower settings emit fewer particles.', options: [{ v: 'high', label: 'High' }, { v: 'med', label: 'Medium' }, { v: 'low', label: 'Low' }],
        get: function () { return get('particles', 'high'); }, set: function (v) { set('particles', v); } },
      { type: 'choice', label: 'Background', hint: 'The shader backgrounds. Off also hides the midground.', options: [{ v: 'high', label: 'High' }, { v: 'low', label: 'Low' }, { v: 'off', label: 'Off' }],
        get: function () { return get('bg', 'high'); }, set: function (v) { set('bg', v); } },
      { type: 'toggle', label: 'Fullscreen', hint: 'Toggle the browser\'s fullscreen mode.', get: isFullscreen, set: function () { if (AP.R.toggleFullscreen) AP.R.toggleFullscreen(); } },
      { type: 'toggle', label: 'Show timer', hint: 'A level timer in the bottom-right corner, with par.', get: function () { return !!get('showTimer', false); }, set: function (v) { set('showTimer', !!v); } },
      { type: 'choice', label: 'HUD', hint: 'Minimal shows counters only for a moment when they change.', options: [{ v: 'full', label: 'Full' }, { v: 'minimal', label: 'Minimal' }],
        get: function () { return get('hud', 'full'); }, set: function (v) { set('hud', v); } },
      { type: 'header', label: 'Assist' },
      { type: 'toggle', label: 'Assist mode', hint: 'Assisted clears keep no best time.', get: function () { return !!get('assist.on', false); }, set: function (v) { set('assist.on', !!v); } },
      { type: 'choice', label: 'Game speed', wrap: false, hint: 'Slows the whole game while you play a level.',
        options: [{ v: 1, label: '100%' }, { v: 0.85, label: '85%' }, { v: 0.7, label: '70%' }, { v: 0.5, label: '50%' }],
        get: function () { var s = +get('assist.speed', 1); return s >= 0.99 ? 1 : (s >= 0.8 ? 0.85 : (s >= 0.65 ? 0.7 : 0.5)); },
        set: function (v) { set('assist.speed', v); }, disabled: function () { return !get('assist.on', false); } },
      { type: 'toggle', label: 'Invincibility', hint: 'Only pits and crushing still send you back.', get: function () { return !!get('assist.invincible', false); },
        set: function (v) { set('assist.invincible', !!v); }, disabled: function () { return !get('assist.on', false); } },
      { type: 'toggle', label: 'Infinite air', hint: 'Double jump and dash refill in mid-air.', get: function () { return !!get('assist.infiniteAir', false); },
        set: function (v) { set('assist.infiniteAir', !!v); }, disabled: function () { return !get('assist.on', false); } },
      { type: 'header', label: 'Controls' },
      { label: 'Remap controls', arrow: true, hint: 'Keyboard and gamepad, per action.', action: function () { AP.Scenes.push('remap', { from: 'settings' }); } },
      { label: 'Reset bindings', hint: 'Restore every default key and button.', action: function () {
        confirmDialog({ title: 'Reset bindings?', text: 'Every key and button goes back to its default.', yes: 'Reset', action: function () {
          if (AP.Input && AP.Input.resetBindings) AP.Input.resetBindings();
          toast('Bindings reset', 'Keyboard and gamepad are back to the defaults.');
        } });
      } },
      { type: 'header', label: 'Data' },
      { label: 'Export save', hint: 'Downloads your save as a file and copies it to the clipboard.', action: exportSave },
      { label: 'Import save from file', hint: 'Replace this save with an exported one.', disabled: inLevel, action: importFile },
      { label: 'Import save from clipboard', hint: 'Paste an exported save.', disabled: inLevel, action: importClipboard },
      { label: 'Reset settings', hint: 'Volumes, video, assist and bindings back to the defaults.', action: function () {
        confirmDialog({ title: 'Reset settings?', text: 'Volumes, video, assist and bindings return to their defaults. Progress is kept.', yes: 'Reset', action: function () {
          if (AP.Save && AP.Save.resetSettings) AP.Save.resetSettings();
          toast('Settings reset', 'Progress is untouched.');
        } });
      } },
      { label: 'Reset progress', danger: true, hint: 'Erase every level, gem, theorem and form.', disabled: inLevel, action: function () {
        confirmDialog({ title: 'Erase all progress?', danger: true, text: 'Cleared levels, gems, theorems, cosmetics and forms will be erased. Settings are kept.', yes: 'Continue', action: function () {
          // the second confirmation
          S.dialog = UI().dialog({ title: 'Are you certain?', danger: true, focus: 1, pal: palOf(), text: 'This cannot be undone.',
            options: [{ label: 'Erase everything', danger: true, action: function () {
              if (AP.Save && AP.Save.reset) AP.Save.reset();
              if (AP.Meta && AP.Meta.clearToasts) AP.Meta.clearToasts();
              AP.sfx('break');
              toast('Progress erased', 'A new spiral begins.');
            } }, { label: 'Keep my progress' }] });
        } });
      } },
      { type: 'gap' },
      { label: 'Back', action: close }
    ];
    S.menu = U.menu({ x: 250, y: 104, w: 460, rowH: 32, headerH: 30, size: 15, viewH: 352, valueFrac: 0.48, items: items,
      onBack: function () { close(); } });
  }

  S.enter = function (params) {
    S.from = (params && params.from) || null;
    S.t0 = now();
    S.dialog = null;
    S.closing = -1;
    S.coveredT = -1;
    buildSettings();
  };
  S.exit = function () { S.dialog = null; };
  S.covered = function () { S.coveredT = now(); };
  S.uncovered = function () { S.coveredT = -1; if (S.menu) S.menu.snap(); };

  S.update = function (dt) {
    if (S.closing >= 0) return;
    if (S.dialog) {
      S.dialog.update(dt);
      if (S.dialog && S.dialog.done) S.dialog = null;
      return;
    }
    var n = UI().nav();
    if (n.pause && S.from === 'pause') { UI().eat(); close(); return; }
    S.menu.update(dt);
  };

  S.render = function (ctx) {
    var U = UI();
    var pal = palOf();
    var t = now() - S.t0;
    var k = M.ease.outCubic(clamp01(t / 0.25));
    if (S.closing >= 0) k *= clamp01(1 - (now() - S.closing) / 0.15);
    if (S.coveredT >= 0) return;
    U.dim(ctx, 0.5 * k, '#000000');
    var pa = ctx.globalAlpha;
    ctx.save();
    ctx.translate(0, (1 - k) * 18);
    U.panel(ctx, 200, 26, 560, 488, { pal: pal, alpha: k, fillAlpha: 0.93 });
    U.header(ctx, 'SETTINGS', 230, 62, t, pal, { size: 26 });
    S.menu.render(ctx, { pal: pal, alpha: k });
    // help line for the focused item
    var it = S.menu.selItem;
    var hint = it && it.hint ? it.hint : '';
    if (it && it.disabled && (typeof it.disabled === 'function' ? it.disabled() : it.disabled) && inLevel() && /Import|Reset progress/.test(String(it.label))) hint = 'Not available during a level.';
    if (hint) text(ctx, hint, 480, 474, 12, rgba(pal.primary, 0.85), 'center', k, '500', 520);
    ctx.restore();
    U.hints(ctx, [[['up', 'down'], 'Select'], [['left', 'right'], 'Adjust'], ['confirm', 'Choose'], ['back', 'Back']], 480, 528, { align: 'center', pal: pal, alpha: k * 0.85, size: 11 });
    ctx.globalAlpha = pa;
    if (S.dialog) S.dialog.render(ctx, pal);
  };

  AP.Scenes.register('settings', S);

  // ================================================================ remap
  var ACT = [
    ['left', 'Move left', 'game'], ['right', 'Move right', 'game'], ['up', 'Up', 'game'], ['down', 'Down · drop through', 'game'],
    ['jump', 'Jump', 'game'], ['dash', 'Dash', 'game'], ['orbit', 'Orbit (hold)', 'game'], ['pause', 'Pause', 'game'], ['retry', 'Retry', 'game'],
    ['confirm', 'Menu confirm', 'menu'], ['back', 'Menu back', 'menu']
  ];
  var MENU_GROUP = { up: 1, down: 1, left: 1, right: 1, confirm: 1, back: 1 };

  var R = {
    transparent: true,
    t0: 0, device: 'kbd', menu: null, cap: null, closing: -1, dialog: null, flashT: -9, flashMsg: ''
  };

  function devKey() { return R.device === 'pad' ? 'pad' : 'keys'; }
  function list(action) {
    var b = AP.Input && AP.Input.bindings ? AP.Input.bindings() : null;
    var l = b && b[devKey()] ? b[devKey()][action] : null;
    return l || [];
  }

  // a code bound to two actions of the same group (gameplay, or menu) is flagged
  function conflictOf(action, slot) {
    var l = list(action);
    var code = l[slot];
    if (code === undefined) return false;
    var groupMenu = action === 'confirm' || action === 'back';
    for (var i = 0; i < ACT.length; i++) {
      var other = ACT[i][0];
      if (other === action) continue;
      var sameGroup = groupMenu ? !!MENU_GROUP[other] : ACT[i][2] === 'game';
      if (!sameGroup) continue;
      if (list(other).indexOf(code) >= 0) return true;
    }
    return false;
  }

  function stopCapture(silent) {
    if (!R.cap) return;
    R.cap = null;
    if (AP.Input && AP.Input.capture && AP.Input.capturing && AP.Input.capturing()) AP.Input.capture(null);
    if (!silent) AP.sfx('uiBack');
  }

  function replaceBinding(action, dev, slot, code) {
    var I = AP.Input;
    var cur = list(action).slice();
    var old = cur[slot];
    if (old === code) return;
    I.setBinding(action, dev, slot, code);
    if (old !== undefined) {
      var after = list(action);
      var oi = after.indexOf(old);
      if (oi >= 0 && after.length > 1) I.setBinding(action, dev, oi, null);
    }
  }

  function beginCapture(action, slot) {
    var I = AP.Input;
    if (!I || !I.capture) return;
    var dev = R.device;
    R.cap = { action: action, slot: slot, t0: now(), device: dev, mouse: !!(I.mouse && I.mouse.down) };
    if (R.menu) R.menu.snap();
    I.capture(function (code) {
      var c = R.cap;
      R.cap = null;
      if (code === null || code === undefined || !c) { AP.sfx('uiBack'); return; }
      replaceBinding(c.action, c.device, c.slot, code);
      R.flashT = now();
      R.flashMsg = (c.device === 'pad' ? I.padName(code) : I.keyName(code)) + ' → ' + labelOf(c.action);
      AP.sfx('uiSelect', { pitch: 1.2 });
      if (UI() && UI().sparks) UI().sparks.emit(480, 240, { n: 14, color: palOf().accent, speed: [40, 160], life: [0.3, 0.6], size: [1, 2], drag: 3, shape: 2 });
    }, dev);
  }

  function labelOf(action) { for (var i = 0; i < ACT.length; i++) if (ACT[i][0] === action) return ACT[i][1]; return action; }

  function closeRemap() {
    if (R.closing >= 0) return;
    stopCapture(true);
    R.closing = now();
    UI().close('title');
  }

  function buildRemap() {
    var U = UI();
    var items = [
      { type: 'choice', label: 'Device', options: [{ v: 'kbd', label: 'Keyboard' }, { v: 'pad', label: 'Gamepad' }],
        get: function () { return R.device; }, set: function (v) { R.device = v; } }
    ];
    for (var i = 0; i < ACT.length; i++) {
      (function (a) {
        items.push({
          type: 'keys', label: a[1], action: a[0],
          device: function () { return R.device; },
          get: function () { return list(a[0]); },
          capture: function (slot) { beginCapture(a[0], slot); },
          capturing: function () { return R.cap && R.cap.action === a[0] ? R.cap.slot : -1; },
          remove: function (slot) { if (AP.Input) AP.Input.setBinding(a[0], R.device, slot, null); },
          conflict: function (slot) { return conflictOf(a[0], slot); }
        });
      })(ACT[i]);
    }
    items.push({ type: 'gap' });
    items.push({ label: 'Reset to defaults', action: function () {
      R.dialog = U.dialog({ title: 'Reset bindings?', text: 'Keyboard and gamepad bindings return to their defaults.', focus: 1, pal: palOf(),
        options: [{ label: 'Reset', action: function () { if (AP.Input && AP.Input.resetBindings) AP.Input.resetBindings(); R.flashT = now(); R.flashMsg = 'Defaults restored'; } }, { label: 'Cancel' }] });
    } });
    items.push({ label: 'Back', action: closeRemap });
    R.menu = U.menu({ x: 210, y: 92, w: 540, rowH: 31, size: 14.5, viewH: 368, valueFrac: 0.36, items: items, onBack: closeRemap });
  }

  R.enter = function () {
    R.t0 = now();
    R.closing = -1;
    R.cap = null;
    R.dialog = null;
    R.device = AP.Input && AP.Input.device === 'pad' ? 'pad' : 'kbd';
    buildRemap();
  };

  R.exit = function () { stopCapture(true); R.dialog = null; };

  R.update = function (dt) {
    if (R.closing >= 0) return;
    if (R.dialog) {
      R.dialog.update(dt);
      if (R.dialog && R.dialog.done) R.dialog = null;
      return;
    }
    if (R.cap) {
      // capture owns the input; a click or 8 s of silence cancels it
      var I = AP.Input;
      if (!(I && I.capturing && I.capturing())) { R.cap = null; return; }
      var md = !!(I.mouse && I.mouse.down);
      if (now() - R.cap.t0 > 8 || (md && !R.cap.mouse)) { stopCapture(false); return; }
      R.cap.mouse = md;
      return;
    }
    R.menu.update(dt);
  };

  R.render = function (ctx) {
    var U = UI();
    var pal = palOf();
    var t = now() - R.t0;
    var k = M.ease.outCubic(clamp01(t / 0.25));
    if (R.closing >= 0) k *= clamp01(1 - (now() - R.closing) / 0.15);
    U.dim(ctx, 0.55 * k, '#000000');
    var pa = ctx.globalAlpha;
    ctx.save();
    ctx.translate(0, (1 - k) * 18);
    U.panel(ctx, 180, 18, 600, 504, { pal: pal, alpha: k, fillAlpha: 0.95 });
    U.header(ctx, 'CONTROLS', 210, 52, t, pal, { size: 24 });
    text(ctx, R.device === 'pad' ? 'Standard-mapping gamepads. Every connected pad is merged.' : 'Up to four keys per action.', 750, 52, 11, rgba(pal.primary, 0.8), 'right', k, '600');
    R.menu.render(ctx, { pal: pal, alpha: k * (R.cap ? 0.35 : 1) });
    var fk = clamp01(1 - (now() - R.flashT) / 1.6);
    if (fk > 0) text(ctx, R.flashMsg, 480, 478, 13, pal.accent, 'center', k * fk, '700');
    else text(ctx, AP.Input ? (AP.Input.label('confirm') + ' rebind · ' + AP.Input.label('retry') + ' remove · red outline: used twice') : '', 480, 478, 11.5, rgba(pal.primary, 0.75), 'center', k, '500');
    ctx.restore();
    if (R.cap) drawCapture(ctx, pal);
    U.hints(ctx, [[['up', 'down'], 'Action'], [['left', 'right'], 'Slot'], ['confirm', 'Rebind'], ['retry', 'Remove'], ['back', 'Back']], 480, 530, { align: 'center', pal: pal, alpha: k * 0.85, size: 11 });
    ctx.globalAlpha = pa;
    if (R.dialog) R.dialog.render(ctx, pal);
  };

  var CAP_O = { size: 22, color: '#FFFFFF', align: 'center', glow: null, progress: 1, alpha: 1, spacing: 1.6, sparks: true };
  function drawCapture(ctx, pal) {
    var U = UI();
    var age = now() - R.cap.t0;
    var a = clamp01(age / 0.15);
    var pa = ctx.globalAlpha;
    U.dim(ctx, 0.45 * a, '#000000');
    U.panel(ctx, 270, 186, 420, 150, { pal: pal, alpha: a, fillAlpha: 0.96 });
    text(ctx, R.cap.device === 'pad' ? 'PRESS A GAMEPAD BUTTON FOR' : 'PRESS A KEY FOR', 480, 220, 11, pal.accent, 'center', a, '800');
    CAP_O.color = pal.ink; CAP_O.glow = pal.accent; CAP_O.alpha = a; CAP_O.progress = clamp01(age / 0.5);
    U.strokeText(ctx, labelOf(R.cap.action).toUpperCase(), 480, 252, CAP_O);
    // a ring that empties as the 8 s timeout runs out
    var left = clamp01(1 - age / 8);
    ctx.globalAlpha = pa * a;
    ctx.strokeStyle = rgba(pal.primary, 0.3);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(480, 296, 10, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = pal.accent;
    ctx.beginPath();
    ctx.arc(480, 296, 10, -Math.PI / 2, -Math.PI / 2 + TAU * left);
    ctx.stroke();
    ctx.globalAlpha = pa;
    text(ctx, 'Esc cancels', 480, 320, 11, rgba(pal.primary, 0.75), 'center', a, '600');
  }

  AP.Scenes.register('remap', R);
})(window.AP = window.AP || {});
