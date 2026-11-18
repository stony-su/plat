/* js/core/input.js — owner: CORE */
(function (AP) {
  'use strict';

  var ACTIONS = AP.ACTIONS;
  var NA = ACTIONS.length;
  var IDX = {};
  for (var ai = 0; ai < NA; ai++) IDX[ACTIONS[ai]] = ai;

  var A_LEFT = IDX.left, A_RIGHT = IDX.right, A_UP = IDX.up, A_DOWN = IDX.down;
  var DEADZONE = 0.35;
  var REPEAT_DELAY = 0.35;
  var REPEAT_RATE = 0.08;
  var NEVER = 1e9;

  // per-action state (typed arrays: no allocation per step)
  var held = new Uint8Array(NA);
  var pressed = new Uint8Array(NA);
  var released = new Uint8Array(NA);
  var latch = new Uint8Array(NA);        // a press happened since the last update (tap between steps)
  var rep = new Uint8Array(NA);
  var repT = new Float32Array(NA);
  var age = new Float64Array(NA);        // seconds since the last press (NEVER after consume)
  var virt = new Uint8Array(NA);
  var holdT = new Float32Array(NA);
  for (var ii = 0; ii < NA; ii++) age[ii] = NEVER;

  var keysDown = {};                     // KeyboardEvent.code -> true
  var keyActs = {};                      // code -> [action indices]
  var padActs = [];                      // button -> [action indices]
  var padNow = new Uint8Array(32);
  var padPrev = new Uint8Array(32);
  var stickX = 0, stickY = 0, stickDX = 0, stickDY = 0;
  var lockT = 0;
  var captureReq = null;
  var anyKeyLatch = false;
  var anyPadLatch = false;
  var anyPressedNow = false;
  var rawKeyListeners = [];
  var initialized = false;
  var win = null;

  var mouse = { x: 0, y: 0, down: false, pressed: false, released: false, moved: false };
  var mLatchP = false, mLatchR = false, mDown = false;

  var Input = {
    DEFAULTS: AP.Save ? AP.Save.DEFAULT_BINDINGS : null,
    device: 'kbd',
    mouse: mouse,
    locked: false
  };

  function bindingsSrc() {
    var st = AP.Save && AP.Save.data && AP.Save.data.settings;
    var D = Input.DEFAULTS || { keys: {}, pad: {} };
    return { keys: (st && st.keys) || D.keys, pad: (st && st.pad) || D.pad };
  }

  // rebuild reverse maps from the saved bindings
  function rebuild() {
    var b = bindingsSrc();
    keyActs = {};
    padActs = [];
    for (var i = 0; i < NA; i++) {
      var a = ACTIONS[i];
      var ks = b.keys[a] || [];
      for (var k = 0; k < ks.length; k++) (keyActs[ks[k]] || (keyActs[ks[k]] = [])).push(i);
      var ps = b.pad[a] || [];
      for (var p = 0; p < ps.length; p++) {
        var btn = ps[p] | 0;
        if (btn < 0 || btn > 31) continue;
        (padActs[btn] || (padActs[btn] = [])).push(i);
      }
    }
  }
  Input.rebuild = rebuild;

  function unlockAudio() {
    if (AP.Audio && AP.Audio.ready) return;
    AP.call('Audio.unlock');
  }

  function keyFallbackCode(key) {
    if (!key) return '';
    if (key === ' ') return 'Space';
    if (key.length === 1) {
      var c = key.toUpperCase();
      if (c >= 'A' && c <= 'Z') return 'Key' + c;
      if (c >= '0' && c <= '9') return 'Digit' + c;
    }
    if (key === 'Esc') return 'Escape';
    if (key === 'Left' || key === 'Right' || key === 'Up' || key === 'Down') return 'Arrow' + key;
    return key;
  }

  function onKeyDown(e) {
    var code = e.code || keyFallbackCode(e.key);
    unlockAudio();
    Input.device = 'kbd';
    if (captureReq && captureReq.device !== 'pad') {
      if (e.repeat) { if (e.preventDefault) e.preventDefault(); return; }
      var cb = captureReq.cb;
      captureReq = null;
      if (e.preventDefault) e.preventDefault();
      clearLatches();
      lockT = Math.max(lockT, 0.12);
      AP.guard('Input.capture', cb, code === 'Escape' ? null : code);
      return;
    }
    if (captureReq && captureReq.device === 'pad' && code === 'Escape') {
      var cbp = captureReq.cb;
      captureReq = null;
      if (e.preventDefault) e.preventDefault();
      clearLatches();
      lockT = Math.max(lockT, 0.12);
      AP.guard('Input.capture', cbp, null);
      return;
    }
    for (var r = 0; r < rawKeyListeners.length; r++) {
      if (AP.guard('Input.onKey', rawKeyListeners[r], code, e) === true) { if (e.preventDefault) e.preventDefault(); return; }
    }
    var acts = keyActs[code];
    if (acts && e.preventDefault) e.preventDefault();
    if (e.repeat) return;
    keysDown[code] = true;
    anyKeyLatch = true;
    if (acts) for (var i = 0; i < acts.length; i++) latch[acts[i]] = 1;
  }

  function onKeyUp(e) {
    var code = e.code || keyFallbackCode(e.key);
    if (keyActs[code] && e.preventDefault) e.preventDefault();
    delete keysDown[code];
  }

  function releaseAll() {
    keysDown = {};
    padNow.fill(0);
    padPrev.fill(0);
    stickX = stickY = stickDX = stickDY = 0;
    mDown = false;
    clearLatches();
  }

  function clearLatches() {
    latch.fill(0);
    anyKeyLatch = false;
    anyPadLatch = false;
    mLatchP = false;
  }

  function onPointer(e, type) {
    if (AP.R && AP.R.toLogical) {
      var p = AP.R.toLogical(e.clientX, e.clientY);
      mouse.x = p.x;
      mouse.y = p.y;
      mouse.moved = true;
    }
    if (type === 'down') {
      unlockAudio();
      mDown = true;
      mLatchP = true;
    } else if (type === 'up') {
      if (mDown) mLatchR = true;
      mDown = false;
    }
  }

  Input.init = function (w) {
    if (initialized) return;
    win = w || (typeof window !== 'undefined' ? window : null);
    rebuild();
    if (!win || typeof win.addEventListener !== 'function') return;
    initialized = true;
    win.addEventListener('keydown', onKeyDown, { passive: false });
    win.addEventListener('keyup', onKeyUp, { passive: false });
    win.addEventListener('blur', releaseAll);
    win.addEventListener('pointerdown', function (e) { onPointer(e, 'down'); });
    win.addEventListener('pointermove', function (e) { onPointer(e, 'move'); });
    win.addEventListener('pointerup', function (e) { onPointer(e, 'up'); });
    win.addEventListener('pointercancel', function (e) { onPointer(e, 'up'); });
    win.addEventListener('contextmenu', function (e) { if (e.preventDefault) e.preventDefault(); });
    win.addEventListener('gamepadconnected', function () { Input.padConnected = true; });
    win.addEventListener('gamepaddisconnected', function () { padNow.fill(0); });
  };

  // ---- gamepad polling (standard mapping; all connected pads are merged) ----
  function pollPad() {
    padPrev.set(padNow);
    padNow.fill(0);
    stickX = 0;
    stickY = 0;
    var nav = (typeof navigator !== 'undefined') ? navigator : null;
    if (!nav || typeof nav.getGamepads !== 'function') return;
    var pads;
    try { pads = nav.getGamepads(); } catch (e) { return; }
    if (!pads) return;
    var bestMag = 0;
    for (var p = 0; p < pads.length; p++) {
      var gp = pads[p];
      if (!gp || gp.connected === false || !gp.buttons) continue;
      var nb = Math.min(32, gp.buttons.length);
      for (var b = 0; b < nb; b++) {
        var bt = gp.buttons[b];
        var on = bt && (bt.pressed || (typeof bt.value === 'number' && bt.value > 0.5));
        if (on) padNow[b] = 1;
      }
      if (gp.axes && gp.axes.length >= 2) {
        var ax = +gp.axes[0] || 0, ay = +gp.axes[1] || 0;
        var mag = Math.sqrt(ax * ax + ay * ay);
        if (mag > bestMag) { bestMag = mag; stickX = ax; stickY = ay; }
      }
    }
    // 8-way stick quantisation
    stickDX = 0;
    stickDY = 0;
    if (bestMag > DEADZONE) {
      var oct = Math.round(Math.atan2(stickY, stickX) / (Math.PI / 4));
      stickDX = Math.round(Math.cos(oct * Math.PI / 4));
      stickDY = Math.round(Math.sin(oct * Math.PI / 4));
      Input.device = 'pad';
    }
    for (var c = 0; c < 32; c++) {
      if (padNow[c] && !padPrev[c]) {
        Input.device = 'pad';
        anyPadLatch = true;
        if (captureReq && captureReq.device === 'pad') {
          var cb = captureReq.cb;
          captureReq = null;
          clearLatches();
          lockT = Math.max(lockT, 0.15);
          AP.guard('Input.capture', cb, c);
          return;
        }
      }
    }
  }

  function keyHeld(i) {
    for (var code in keysDown) {
      var acts = keyActs[code];
      if (!acts) continue;
      for (var k = 0; k < acts.length; k++) if (acts[k] === i) return true;
    }
    return false;
  }

  function padHeld(i) {
    for (var b = 0; b < 32; b++) {
      if (!padNow[b]) continue;
      var acts = padActs[b];
      if (!acts) continue;
      for (var k = 0; k < acts.length; k++) if (acts[k] === i) return true;
    }
    return false;
  }

  function stickHeld(i) {
    if (i === A_LEFT) return stickDX < 0;
    if (i === A_RIGHT) return stickDX > 0;
    if (i === A_UP) return stickDY < 0;
    if (i === A_DOWN) return stickDY > 0;
    return false;
  }

  // Called once per fixed step by AP.Loop BEFORE the scene update.
  Input.update = function (dt) {
    if (!(dt > 0)) dt = AP.C ? AP.C.STEP : 1 / 120;
    pollPad();
    if (lockT > 0) lockT = Math.max(0, lockT - dt);
    var locked = lockT > 0 || !!captureReq;
    Input.locked = locked;
    anyPressedNow = false;
    for (var i = 0; i < NA; i++) {
      var down = !locked && (keyHeld(i) || padHeld(i) || virt[i] === 1 || stickHeld(i));
      var tap = !locked && latch[i] === 1;
      latch[i] = 0;
      var was = held[i] === 1;
      var p = tap || (down && !was);
      pressed[i] = p ? 1 : 0;
      released[i] = ((was && !down) || (tap && !down)) ? 1 : 0;
      held[i] = down ? 1 : 0;
      if (p) { age[i] = 0; anyPressedNow = true; } else if (age[i] < NEVER) age[i] += dt;
      if (down) holdT[i] += dt; else holdT[i] = 0;
      // menu repeat: press, then after REPEAT_DELAY every REPEAT_RATE
      rep[i] = 0;
      if (p) { rep[i] = 1; repT[i] = REPEAT_DELAY; }
      else if (down) {
        repT[i] -= dt;
        if (repT[i] <= 0) { rep[i] = 1; repT[i] += REPEAT_RATE; }
      }
    }
    if (locked) { anyKeyLatch = false; anyPadLatch = false; }
    Input.anyKey = anyKeyLatch || anyPadLatch;
    anyKeyLatch = false;
    anyPadLatch = false;
    mouse.pressed = mLatchP && !locked;
    mouse.released = mLatchR;
    mouse.down = mDown;
    mLatchP = false;
    mLatchR = false;
  };

  function idx(a) {
    var i = IDX[a];
    if (i === undefined) {
      if (AP.DEV) AP.warnOnce('input:' + a, 'Unknown input action:', a);
      return -1;
    }
    return i;
  }

  Input.held = function (a) { var i = idx(a); return i >= 0 && held[i] === 1; };
  Input.pressed = function (a) { var i = idx(a); return i >= 0 && pressed[i] === 1; };
  Input.released = function (a) { var i = idx(a); return i >= 0 && released[i] === 1; };
  Input.holdTime = function (a) { var i = idx(a); return i >= 0 ? holdT[i] : 0; };

  // true if `a` was pressed within the last `window` seconds and not consumed since
  Input.buffered = function (a, w) {
    var i = idx(a);
    if (i < 0) return false;
    return age[i] <= (w === undefined ? 0.1 : w) + 1e-9;
  };

  Input.consume = function (a) {
    var i = idx(a);
    if (i < 0) return;
    age[i] = NEVER;
    pressed[i] = 0;
    latch[i] = 0;
  };

  Input.repeat = function (a) { var i = idx(a); return i >= 0 && rep[i] === 1; };

  // 8-way digital axis: out {x, y} each in {-1, 0, 1}
  Input.axis = function (out) {
    out = out || { x: 0, y: 0 };
    out.x = (held[A_RIGHT] ? 1 : 0) - (held[A_LEFT] ? 1 : 0);
    out.y = (held[A_DOWN] ? 1 : 0) - (held[A_UP] ? 1 : 0);
    return out;
  };

  // raw analog stick (for menus / art), out {x, y} in -1..1
  Input.stick = function (out) {
    out = out || { x: 0, y: 0 };
    out.x = stickX;
    out.y = stickY;
    return out;
  };

  Input.anyPressed = function () { return anyPressedNow || !!Input.anyKey || mouse.pressed; };

  // ---- labels ----
  var KEY_NAMES = {
    Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'Meta', MetaRight: 'Meta', CapsLock: 'Caps',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Backquote: '`', Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Delete: 'Del', Insert: 'Ins',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn'
  };
  var PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS',
    'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];

  Input.keyName = function (code) {
    if (code === null || code === undefined) return '?';
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
    return String(code);
  };
  Input.padName = function (btn) {
    if (btn === null || btn === undefined) return '?';
    return PAD_NAMES[btn] || ('B' + btn);
  };

  Input.label = function (a, device) {
    var b = bindingsSrc();
    var dev = device || Input.device;
    if (dev === 'pad') {
      var ps = b.pad[a];
      if (ps && ps.length) return Input.padName(ps[0]);
    }
    var ks = b.keys[a];
    if (ks && ks.length) return Input.keyName(ks[0]);
    return '?';
  };

  // ---- bindings / remap ----
  Input.bindings = function () { return bindingsSrc(); };

  function devKey(device) { return (device === 'pad' || device === 'gamepad') ? 'pad' : 'keys'; }

  Input.setBinding = function (a, device, slot, codeOrButton) {
    if (IDX[a] === undefined) return false;
    var dk = devKey(device);
    var b = bindingsSrc();
    var cur = (b[dk][a] || []).slice();
    slot = Math.max(0, slot | 0);
    if (codeOrButton === null || codeOrButton === undefined) {
      if (slot < cur.length && cur.length > 1) cur.splice(slot, 1);
    } else {
      var v = dk === 'pad' ? (codeOrButton | 0) : String(codeOrButton);
      var existing = cur.indexOf(v);
      if (existing >= 0) cur.splice(existing, 1);
      if (slot >= cur.length) cur.push(v); else cur.splice(slot, 0, v);
      if (cur.length > 4) cur.length = 4;
    }
    if (!cur.length) cur = ((Input.DEFAULTS && Input.DEFAULTS[dk][a]) || []).slice();
    if (AP.Save && AP.Save.setSetting) AP.Save.setSetting(dk + '.' + a, cur);
    rebuild();
    return true;
  };

  Input.resetBindings = function () {
    var D = Input.DEFAULTS;
    if (!D || !AP.Save) return;
    AP.Save.setSetting('keys', JSON.parse(JSON.stringify(D.keys)));
    AP.Save.setSetting('pad', JSON.parse(JSON.stringify(D.pad)));
    rebuild();
  };

  // next key (device 'kbd', default) or pad button (device 'pad') is passed to cb; Esc -> cb(null)
  Input.capture = function (cb, device) {
    if (typeof cb !== 'function') { captureReq = null; return; }
    captureReq = { cb: cb, device: devKey(device) === 'pad' ? 'pad' : 'kbd' };
    clearLatches();
  };
  Input.capturing = function () { return !!captureReq; };

  // ---- virtual input (tests, touch, scripted demos) ----
  Input.setVirtual = function (a, h) {
    var i = IDX[a];
    if (i === undefined) return;
    var on = h ? 1 : 0;
    if (on && !virt[i]) latch[i] = 1;
    virt[i] = on;
  };
  Input.clearVirtual = function () { virt.fill(0); };

  // lock(sec): all actions read as not held / not pressed for sec seconds (lock(0) unlocks)
  Input.lock = function (sec) {
    lockT = sec > 0 ? sec : 0;
    if (lockT > 0) clearLatches();
  };

  // raw key hook (DEV keys); fn(code, event) returning true swallows the key
  Input.onKey = function (fn) {
    rawKeyListeners.push(fn);
    return function () {
      var i = rawKeyListeners.indexOf(fn);
      if (i >= 0) rawKeyListeners.splice(i, 1);
    };
  };

  Input.releaseAll = releaseAll;
  Input.ACTION_INDEX = IDX;

  AP.Input = Input;
})(window.AP = window.AP || {});
