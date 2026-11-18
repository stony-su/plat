/* js/core/ap.js — owner: CORE */
(function (AP) {
  'use strict';

  AP.VERSION = '1.0.0';

  function readDev() {
    try {
      var h = (window.location && window.location.hash) || '';
      return h.indexOf('dev') >= 0;
    } catch (e) {
      return false;
    }
  }
  AP.DEV = readDev();
  AP.readDev = readDev;
  AP.headless = false;
  AP.level = null;
  AP.errors = AP.errors || [];

  var con = (typeof console !== 'undefined') ? console : null;
  var MAX_ERRORS = 400;

  function argsArray(args, from) {
    var out = [];
    for (var i = from || 0; i < args.length; i++) out.push(args[i]);
    return out;
  }

  AP.log = function () {
    if (con && con.log) con.log.apply(con, ['[AP]'].concat(argsArray(arguments)));
  };

  AP.warn = function () {
    if (con && con.warn) con.warn.apply(con, ['[AP]'].concat(argsArray(arguments)));
  };

  var warned = {};
  AP.warnOnce = function (key) {
    if (warned[key]) return false;
    warned[key] = true;
    var rest = argsArray(arguments, 1);
    if (!rest.length) rest.push(key);
    AP.warn.apply(null, rest);
    return true;
  };

  AP.reportError = function (label, err) {
    var message = 'unknown error';
    var stack = '';
    try {
      if (err && typeof err === 'object') {
        message = String(err.message || err);
        stack = String(err.stack || '');
      } else {
        message = String(err);
      }
    } catch (e) { /* unprintable error */ }
    var rec = { label: String(label || '?'), message: message, stack: stack };
    if (AP.errors.length < MAX_ERRORS) AP.errors.push(rec);
    AP.errorCount = (AP.errorCount || 0) + 1;
    if (con && con.error) con.error('[AP] error in ' + rec.label + ': ' + message + (stack ? '\n' + stack : ''));
    return rec;
  };

  AP.guard = function (label, fn, a, b, c, d) {
    if (typeof fn !== 'function') return undefined;
    try {
      return fn(a, b, c, d);
    } catch (e) {
      AP.reportError(label, e);
      return undefined;
    }
  };

  // ---- dotted-path module lookup: AP.has('Audio.sfx'), AP.call('Audio.sfx', ...) ----
  var pathCache = {};
  var resolvedParent = null;
  function resolve(path) {
    var parts = pathCache[path];
    if (!parts) parts = pathCache[path] = String(path).split('.');
    var obj = AP;
    var parent = null;
    for (var i = 0; i < parts.length; i++) {
      if (obj === null || obj === undefined) { resolvedParent = null; return undefined; }
      parent = obj;
      obj = obj[parts[i]];
    }
    resolvedParent = parent;
    return obj;
  }

  AP.has = function (path) {
    var v = resolve(path);
    return v !== undefined && v !== null;
  };

  AP.call = function (path) {
    var fn = resolve(path);
    if (typeof fn !== 'function') return undefined;
    var self = resolvedParent;
    var n = arguments.length;
    try {
      switch (n) {
        case 1: return fn.call(self);
        case 2: return fn.call(self, arguments[1]);
        case 3: return fn.call(self, arguments[1], arguments[2]);
        case 4: return fn.call(self, arguments[1], arguments[2], arguments[3]);
        case 5: return fn.call(self, arguments[1], arguments[2], arguments[3], arguments[4]);
        case 6: return fn.call(self, arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]);
        default: return fn.apply(self, argsArray(arguments, 1));
      }
    } catch (e) {
      AP.reportError(path, e);
      return undefined;
    }
  };

  // ---- audio helpers ----
  function knownSfx(name) {
    var list = AP.SFX;
    if (!list) return true;
    for (var i = 0; i < list.length; i++) if (list[i] === name) return true;
    return false;
  }

  AP.sfx = function (name, opts) {
    if (AP.DEV && !knownSfx(name)) AP.warnOnce('sfx:' + name, 'Unknown SFX name:', name);
    return AP.call('Audio.sfx', name, opts);
  };

  var sfxAtOpts = { vol: 1, pitch: 1, pan: 0 };
  AP.sfxAt = function (name, x, y, opts) {
    var L = AP.level;
    var cam = L && L.cam;
    if (!cam || typeof cam.cx !== 'function') return AP.sfx(name, opts);
    var ccx = cam.cx();
    var ccy = cam.cy();
    var dx = x - ccx;
    var dy = y - ccy;
    var pan = dx / 480;
    if (pan < -1) pan = -1; else if (pan > 1) pan = 1;
    var d = Math.sqrt(dx * dx + dy * dy);
    var k = (d - 480) / 640;
    if (k < 0) k = 0; else if (k > 0.8) k = 0.8;
    sfxAtOpts.vol = ((opts && opts.vol !== undefined) ? opts.vol : 1) * (1 - k);
    sfxAtOpts.pitch = (opts && opts.pitch !== undefined) ? opts.pitch : 1;
    sfxAtOpts.pan = (opts && opts.pan !== undefined) ? Math.max(-1, Math.min(1, opts.pan + pan)) : pan;
    return AP.sfx(name, sfxAtOpts);
  };

  AP.music = function (key, opts) {
    if (key && AP.MUSIC && AP.MUSIC[key] && AP.Beat && AP.Beat.set) {
      AP.guard('Beat.set', AP.Beat.set, AP.MUSIC[key]);
    } else if (key && AP.MUSIC && !AP.MUSIC[key]) {
      AP.warnOnce('music:' + key, 'Unknown music key:', key);
    }
    AP.currentMusic = key || null;
    return AP.call('Audio.music', key === undefined ? null : key, opts);
  };
  AP.currentMusic = null;

  // ---- toasts: AP.Meta.toast when UI is present, else a small CORE fallback queue drawn by AP.Scenes ----
  AP.toastQueue = [];
  AP.toast = function (title, sub) {
    if (AP.Meta && typeof AP.Meta.toast === 'function') return AP.call('Meta.toast', title, sub);
    var q = AP.toastQueue;
    if (q.length >= 4) q.shift();
    q.push({ title: String(title || ''), sub: sub ? String(sub) : '', t: 0 });
    return true;
  };

  // ---- wall clock for profiling / perf overlay ONLY (never gameplay: use L.time / AP.Time) ----
  var perfApi = (typeof performance !== 'undefined') ? performance : null;
  if (perfApi && typeof perfApi.now !== 'function') perfApi = null;
  AP.clock = function () {
    return perfApi ? perfApi.now() : 0;
  };

  // AP.boot(opts) is defined in js/main.js.
})(window.AP = window.AP || {});
