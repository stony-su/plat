/* js/core/events.js — owner: CORE */
(function (AP) {
  'use strict';

  // Synchronous event bus. Listener errors are caught (AP.reportError) and never break the emitter.
  var map = {};          // name -> array of listeners (null = removed during an emit)
  var depth = {};        // name -> active emit depth
  var dirty = {};        // name -> needs compaction after the emit finishes
  var PREFIXES = ['w1:', 'w2:', 'w3:', 'w4:', 'w5:', 'ui:', 'endless:'];

  function isKnown(name) {
    var list = AP.EVENTS;
    if (list) for (var i = 0; i < list.length; i++) if (list[i] === name) return true;
    for (var j = 0; j < PREFIXES.length; j++) if (name.indexOf(PREFIXES[j]) === 0) return true;
    return !list;
  }

  function compact(name) {
    var arr = map[name];
    if (!arr) return;
    var w = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i]) arr[w++] = arr[i];
    arr.length = w;
    dirty[name] = false;
  }

  function off(name, fn) {
    var arr = map[name];
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === fn) {
        if (depth[name] > 0) { arr[i] = null; dirty[name] = true; }
        else arr.splice(i, 1);
        return;
      }
    }
  }

  function on(name, fn) {
    if (typeof fn !== 'function') return function () {};
    if (AP.DEV && !isKnown(name)) AP.warnOnce('event:' + name, 'Unknown / unprefixed event name:', name);
    var arr = map[name] || (map[name] = []);
    arr.push(fn);
    var done = false;
    return function () {
      if (done) return;
      done = true;
      off(name, fn);
    };
  }

  function once(name, fn) {
    var offFn = null;
    var wrapper = function (payload) {
      if (offFn) offFn();
      return fn(payload);
    };
    offFn = on(name, wrapper);
    return offFn;
  }

  function emit(name, payload) {
    var arr = map[name];
    if (AP.DEV && !isKnown(name)) AP.warnOnce('event:' + name, 'Unknown / unprefixed event name:', name);
    if (!arr || !arr.length) return 0;
    depth[name] = (depth[name] || 0) + 1;
    var n = arr.length;   // listeners added during this emit do not fire for it
    var called = 0;
    for (var i = 0; i < n; i++) {
      var fn = arr[i];
      if (!fn) continue;
      try {
        fn(payload);
        called++;
      } catch (e) {
        AP.reportError('event:' + name, e);
      }
    }
    depth[name]--;
    if (depth[name] === 0 && dirty[name]) compact(name);
    return called;
  }

  function count(name) {
    var arr = map[name];
    if (!arr) return 0;
    var c = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i]) c++;
    return c;
  }

  AP.Events = { on: on, once: once, off: off, emit: emit, count: count, isKnown: isKnown };
})(window.AP = window.AP || {});
