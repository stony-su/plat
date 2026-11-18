/* js/core/storage.js — owner: CORE */
(function (AP) {
  'use strict';

  var KEY = 'apeiron.save.v1';
  var BAK = 'apeiron.save.v1.bak';
  var THROTTLE = 1;

  // Default control bindings (CONTRACT section 2.5). AP.Input.DEFAULTS aliases this object.
  var DEFAULT_BINDINGS = {
    keys: {
      left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
      jump: ['Space', 'KeyZ', 'KeyJ'], dash: ['KeyX', 'KeyK', 'ShiftLeft'], orbit: ['KeyC', 'KeyL', 'ShiftRight'],
      pause: ['Escape', 'KeyP'], confirm: ['Enter', 'Space', 'KeyZ'], back: ['Escape', 'Backspace', 'KeyX'], retry: ['KeyR']
    },
    pad: {
      left: [14], right: [15], up: [12], down: [13],
      jump: [0], dash: [2, 1, 5], orbit: [7, 6, 3, 4],
      pause: [9], confirm: [0], back: [1], retry: [8]
    }
  };

  var ENUMS = {
    flash: ['full', 'reduced', 'off'],
    particles: ['high', 'med', 'low'],
    bg: ['high', 'low', 'off'],
    hud: ['full', 'minimal']
  };

  function clone(v) {
    if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(clone(v[i])); return a; }
    if (v && typeof v === 'object') { var o = {}; for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = clone(v[k]); return o; }
    return v;
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function defaultSettings() {
    return {
      master: 0.8, music: 0.6, sfx: 0.8, shake: 1, flash: 'full', particles: 'high', bg: 'high',
      showTimer: false, hud: 'full', keys: clone(DEFAULT_BINDINGS.keys), pad: clone(DEFAULT_BINDINGS.pad),
      assist: { on: false, speed: 1, invincible: false, infiniteAir: false }
    };
  }

  function levelRecord() {
    return { done: false, best: 0, deaths: 0, shards: 0, shardsTotal: 0, gems: [false, false, false], assisted: false, clears: 0 };
  }

  function defaults() {
    return {
      v: 1, created: 0, playTime: 0, form: 3,
      unlocked: { 'w1-1': true },
      levels: {},
      stats: { deaths: 0, jumps: 0, dashes: 0, orbits: 0, shards: 0, gems: 0, secrets: 0, bossKills: 0, levelsDone: 0 },
      theorems: {},
      cosmetics: { trail: 'none', palette: 'default', unlocked: ['none', 'default'] },
      endless: { best: 0, bestSeed: 0, runs: 0, daily: {} },
      flags: { introSeen: false, endingSeen: false, endlessUnlocked: false },
      settings: defaultSettings()
    };
  }

  // ---- repair: deep-merge loaded data over defaults with type checks ----
  function repairValue(def, val) {
    if (typeof def === 'number') return isNum(val) ? val : def;
    if (typeof def === 'boolean') return typeof val === 'boolean' ? val : def;
    if (typeof def === 'string') return typeof val === 'string' ? val : def;
    if (Array.isArray(def)) return Array.isArray(val) ? val : clone(def);
    if (isObj(def)) {
      var out = {};
      var src = isObj(val) ? val : {};
      for (var k in def) if (Object.prototype.hasOwnProperty.call(def, k)) out[k] = repairValue(def[k], src[k]);
      return out;
    }
    return val === undefined ? def : val;
  }

  function repairRecord(val) {
    var r = repairValue(levelRecord(), val);
    var g = [false, false, false];
    if (Array.isArray(val && val.gems)) for (var i = 0; i < 3; i++) g[i] = val.gems[i] === true;
    r.gems = g;
    r.best = Math.max(0, r.best);
    r.deaths = Math.max(0, Math.floor(r.deaths));
    r.shards = Math.max(0, Math.floor(r.shards));
    r.shardsTotal = Math.max(0, Math.floor(r.shardsTotal));
    r.clears = Math.max(0, Math.floor(r.clears));
    return r;
  }

  function jsonSafe(v, depth) {
    if (depth > 8) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return isFinite(v);
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) if (!jsonSafe(v[i], depth + 1)) return false; return true; }
    if (isObj(v)) { for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && !jsonSafe(v[k], depth + 1)) return false; return true; }
    return false;
  }

  function repairBindings(val, defMap, isPad) {
    var out = {};
    var src = isObj(val) ? val : {};
    var actions = AP.ACTIONS || Object.keys(defMap);
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var list = [];
      var arr = src[a];
      if (Array.isArray(arr)) {
        for (var j = 0; j < arr.length; j++) {
          var c = arr[j];
          var ok = isPad ? (isNum(c) && c >= 0 && c < 32 && Math.floor(c) === c) : (typeof c === 'string' && c.length > 0 && c.length < 40);
          if (ok && list.indexOf(c) < 0) list.push(c);
        }
      }
      if (!list.length) list = clone(defMap[a] || []);
      out[a] = list;
    }
    return out;
  }

  function repair(raw) {
    var d = defaults();
    var src = isObj(raw) ? raw : {};
    var out = repairValue(d, src);
    out.v = 1;
    out.created = Math.max(0, out.created);
    out.playTime = Math.max(0, out.playTime);
    var forms = AP.FORMS || [3, 4, 5, 6, 99];
    if (forms.indexOf(out.form) < 0) out.form = 3;

    // unlocked: id -> true
    out.unlocked = { 'w1-1': true };
    if (isObj(src.unlocked)) for (var u in src.unlocked) if (src.unlocked[u] === true) out.unlocked[u] = true;

    // levels: id -> record
    out.levels = {};
    if (isObj(src.levels)) for (var id in src.levels) if (isObj(src.levels[id])) out.levels[id] = repairRecord(src.levels[id]);

    // stats: known counters plus any extra finite counters other modules add
    if (isObj(src.stats)) for (var sk in src.stats) if (!(sk in out.stats) && isNum(src.stats[sk])) out.stats[sk] = src.stats[sk];
    for (var sk2 in out.stats) out.stats[sk2] = Math.max(0, out.stats[sk2]);

    // theorems: id -> true | finite number
    out.theorems = {};
    if (isObj(src.theorems)) for (var th in src.theorems) {
      var tv = src.theorems[th];
      if (tv === true || isNum(tv)) out.theorems[th] = tv;
    }

    // cosmetics
    var unl = [];
    if (Array.isArray(src.cosmetics && src.cosmetics.unlocked)) {
      for (var ci = 0; ci < src.cosmetics.unlocked.length; ci++) {
        var cv = src.cosmetics.unlocked[ci];
        if (typeof cv === 'string' && unl.indexOf(cv) < 0) unl.push(cv);
      }
    }
    if (unl.indexOf('none') < 0) unl.unshift('none');
    if (unl.indexOf('default') < 0) unl.push('default');
    out.cosmetics.unlocked = unl;

    // endless.daily: free-form JSON owned by W1
    out.endless.daily = (src.endless && isObj(src.endless.daily) && jsonSafe(src.endless.daily, 0)) ? clone(src.endless.daily) : {};

    // flags: known booleans plus extra booleans
    if (isObj(src.flags)) for (var fk in src.flags) if (!(fk in out.flags) && typeof src.flags[fk] === 'boolean') out.flags[fk] = src.flags[fk];

    // settings
    var st = out.settings;
    st.master = clampNum(st.master, 0, 1);
    st.music = clampNum(st.music, 0, 1);
    st.sfx = clampNum(st.sfx, 0, 1);
    st.shake = clampNum(st.shake, 0, 1);
    for (var ek in ENUMS) if (ENUMS[ek].indexOf(st[ek]) < 0) st[ek] = defaultSettings()[ek];
    st.assist.speed = clampNum(st.assist.speed, 0.25, 1);
    var ssrc = isObj(src.settings) ? src.settings : {};
    st.keys = repairBindings(ssrc.keys, DEFAULT_BINDINGS.keys, false);
    st.pad = repairBindings(ssrc.pad, DEFAULT_BINDINGS.pad, true);
    // extra settings keys other modules may add (JSON-safe scalars only)
    for (var xk in ssrc) if (!(xk in st) && (typeof ssrc[xk] === 'boolean' || typeof ssrc[xk] === 'string' || isNum(ssrc[xk]))) st[xk] = ssrc[xk];

    // unknown top-level keys from other modules are preserved when JSON-safe
    for (var tk in src) if (!(tk in out) && Object.prototype.hasOwnProperty.call(src, tk) && jsonSafe(src[tk], 0)) out[tk] = clone(src[tk]);
    return out;
  }

  function clampNum(v, a, b) { return !isNum(v) ? a : (v < a ? a : (v > b ? b : v)); }

  // ---- storage backends ----
  var mem = {};
  var ls = null;

  function probe() {
    ls = null;
    try {
      var s = window.localStorage;
      if (!s) return false;
      var k = '__apeiron_probe__';
      s.setItem(k, '1');
      s.removeItem(k);
      ls = s;
      return true;
    } catch (e) {
      ls = null;
      return false;
    }
  }

  function read(key) {
    if (ls) {
      try { var v = ls.getItem(key); if (v !== null && v !== undefined) return v; } catch (e) { /* fall through */ }
    }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
  }

  var writeFailed = false;
  var toasted = false;
  var toastPending = false;
  function write(key, str) {
    mem[key] = str;
    if (!ls) { onWriteFail(); return false; }
    try {
      ls.setItem(key, str);
      return true;
    } catch (e) {
      onWriteFail();
      return false;
    }
  }

  function onWriteFail() {
    writeFailed = true;
    if (!toasted) {
      toasted = true;
      toastPending = true;   // shown from tick(), once the UI is initialised
      AP.warn('Save storage unavailable; progress is kept in memory for this session.');
    }
  }

  function parse(str) {
    if (!str || typeof str !== 'string') return null;
    try {
      var o = JSON.parse(str);
      return isObj(o) ? o : null;
    } catch (e) {
      return null;
    }
  }

  function getPath(obj, path) {
    var parts = String(path).split('.');
    var o = obj;
    for (var i = 0; i < parts.length; i++) {
      if (o === null || o === undefined) return undefined;
      o = o[parts[i]];
    }
    return o;
  }

  function setPath(obj, path, value) {
    var parts = String(path).split('.');
    var o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!isObj(o[parts[i]])) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
  }

  var clock = 0;
  var lastWrite = -1e9;
  var dirty = false;

  function nowStamp() {
    try { return new Date().getTime(); } catch (e) { return 0; }
  }

  function writeNow() {
    dirty = false;
    lastWrite = clock;
    var str;
    try { str = JSON.stringify(Save.data); } catch (e) { AP.reportError('Save.serialize', e); return false; }
    return write(KEY, str);
  }

  var Save = {
    KEY: KEY,
    BAK: BAK,
    DEFAULT_BINDINGS: DEFAULT_BINDINGS,
    data: defaults(),
    available: false,
    loaded: false,

    defaults: defaults,
    levelRecord: levelRecord,
    repair: repair,

    // never throws: main copy -> .bak copy -> defaults
    load: function () {
      try {
        Save.available = probe();
        var rawMain = read(KEY);
        var data = parse(rawMain);
        var fromMain = !!data;
        if (!data) data = parse(read(BAK));
        var repaired;
        try { repaired = repair(data || {}); } catch (e) { AP.warn('Save repair failed; using defaults.', e); repaired = defaults(); }
        if (!repaired.created) repaired.created = nowStamp();
        Save.data = repaired;
        Save.loaded = true;
        if (fromMain) write(BAK, rawMain);
        if (!data) writeNow();
        return Save.data;
      } catch (e2) {
        AP.warn('Save load failed; using defaults.', e2);
        Save.data = defaults();
        Save.loaded = true;
        return Save.data;
      }
    },

    // throttled to one write per second unless force
    save: function (force) {
      if (force || clock - lastWrite >= THROTTLE) return writeNow();
      dirty = true;
      return false;
    },

    // per-frame pump (called by AP.Loop with real elapsed seconds): flushes throttled writes, counts play time
    tick: function (dt) {
      if (!(dt > 0)) return;
      clock += dt;
      if (toastPending && clock > 0.5) {
        toastPending = false;
        if (AP.toast) AP.toast('Saving unavailable', 'Progress is kept for this session only.');
      }
      if (Save.data) Save.data.playTime = (Save.data.playTime || 0) + dt;
      if (dirty && clock - lastWrite >= THROTTLE) writeNow();
    },

    flush: function () {
      if (dirty) writeNow();
    },

    isDirty: function () { return dirty; },
    failed: function () { return writeFailed; },

    // resets progress but keeps settings (volumes, bindings, assist)
    reset: function () {
      var keep = Save.data && Save.data.settings ? clone(Save.data.settings) : defaultSettings();
      var d = defaults();
      d.settings = repair({ settings: keep }).settings;
      d.created = nowStamp();
      Save.data = d;
      writeNow();
      AP.Events && AP.Events.emit('settings:changed', { key: '*', value: null });
      return d;
    },

    resetSettings: function () {
      Save.data.settings = defaultSettings();
      writeNow();
      AP.Events && AP.Events.emit('settings:changed', { key: '*', value: null });
      return Save.data.settings;
    },

    // record for a level id (created on demand; persisted with the next save)
    level: function (id) {
      var lv = Save.data.levels;
      var r = lv[id];
      if (!isObj(r)) r = lv[id] = levelRecord();
      if (!Array.isArray(r.gems) || r.gems.length !== 3) r.gems = [!!(r.gems && r.gems[0]), !!(r.gems && r.gems[1]), !!(r.gems && r.gems[2])];
      return r;
    },

    // gem n in 1..3; persists immediately; returns true when newly collected
    setGem: function (id, n) {
      n = n | 0;
      if (n < 1 || n > 3) return false;
      var r = Save.level(id);
      if (r.gems[n - 1]) return false;
      r.gems[n - 1] = true;
      Save.data.stats.gems = (Save.data.stats.gems || 0) + 1;
      writeNow();
      return true;
    },

    stat: function (key, inc) {
      if (inc === undefined) inc = 1;
      var s = Save.data.stats;
      var v = isNum(s[key]) ? s[key] : 0;
      v += isNum(inc) ? inc : 0;
      s[key] = v;
      Save.save();
      return v;
    },

    setting: function (path) {
      return getPath(Save.data.settings, path);
    },

    setSetting: function (path, value) {
      setPath(Save.data.settings, path, value);
      Save.save();
      if (AP.Events) AP.Events.emit('settings:changed', { key: String(path), value: value });
      return value;
    },

    export: function () {
      try { return JSON.stringify(Save.data); } catch (e) { return ''; }
    },

    // accepts the JSON string produced by export() (or a base64 of it)
    import: function (str) {
      var o = parse(typeof str === 'string' ? str.trim() : '');
      if (!o && typeof str === 'string') {
        try { if (typeof atob === 'function') o = parse(atob(str.trim())); } catch (e) { o = null; }
      }
      if (!o || (o.v !== undefined && o.v !== 1)) return false;
      try {
        Save.data = repair(o);
      } catch (e2) {
        return false;
      }
      writeNow();
      if (AP.Events) AP.Events.emit('settings:changed', { key: '*', value: null });
      return true;
    }
  };

  AP.Save = Save;
})(window.AP = window.AP || {});
