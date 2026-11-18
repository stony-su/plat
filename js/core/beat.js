/* js/core/beat.js — owner: CORE */
(function (AP) {
  'use strict';

  // AP.Beat is the gameplay clock. It runs on fixed steps (game time), keeps running while paused,
  // in hitstop and after death, and audio follows it (never the other way round).
  var beatPayload = { beat: 0, bar: 0, inBar: 0 };
  var barPayload = { bar: 0 };
  var euclidCache = {};

  function euclidPattern(k, n, rot) {
    n = Math.max(1, n | 0);
    k = Math.max(0, Math.min(n, k | 0));
    rot = ((rot | 0) % n + n) % n;
    var key = k + ':' + n + ':' + rot;
    var pat = euclidCache[key];
    if (pat) return pat;
    var arr = null;
    if (AP.Algo && typeof AP.Algo.euclid === 'function') {
      try { arr = AP.Algo.euclid(k, n, rot); } catch (e) { arr = null; }
    }
    if (!arr || arr.length !== n) {
      // Bresenham-style Euclidean distribution (fallback when AP.Algo is absent)
      arr = [];
      for (var i = 0; i < n; i++) arr.push(((i * k) % n) < k ? 1 : 0);
      if (rot) arr = arr.slice(n - rot).concat(arr.slice(0, n - rot));
    }
    pat = new Uint8Array(n);
    for (var j = 0; j < n; j++) pat[j] = arr[j] ? 1 : 0;
    euclidCache[key] = pat;
    return pat;
  }

  var Beat = {
    bpm: 120,
    meter: 4,
    poly: null,
    time: 0,
    beat: 0,
    bar: 0,
    inBar: 0,
    phase: 0,
    ticked: false,
    barTicked: false,
    prevBeat: -1e-9,

    // set(bpm, meter, poly?) or set({bpm, meter, poly}); resets only if something changed
    set: function (bpm, meter, poly) {
      if (bpm && typeof bpm === 'object') { meter = bpm.meter; poly = bpm.poly; bpm = bpm.bpm; }
      bpm = +bpm > 0 ? +bpm : 120;
      meter = (meter | 0) > 0 ? meter | 0 : 4;
      poly = (poly && poly.length) ? poly : null;
      var samePoly = (!poly && !Beat.poly) || (poly && Beat.poly && poly.length === Beat.poly.length &&
        poly.every(function (v, i) { return v === Beat.poly[i]; }));
      if (bpm === Beat.bpm && meter === Beat.meter && samePoly) return false;
      Beat.bpm = bpm;
      Beat.meter = meter;
      Beat.poly = poly ? poly.slice() : null;
      Beat.reset();
      return true;
    },

    reset: function () {
      Beat.time = 0;
      Beat.beat = 0;
      Beat.bar = 0;
      Beat.inBar = 0;
      Beat.phase = 0;
      Beat.ticked = false;
      Beat.barTicked = false;
      Beat.prevBeat = -1e-9;
      Beat.resetCount = (Beat.resetCount || 0) + 1;
    },

    update: function (dt) {
      Beat.prevBeat = Beat.time === 0 ? -1e-9 : Beat.beat;
      Beat.time += dt;
      var b = Beat.time * Beat.bpm / 60;
      Beat.beat = b;
      var bi = Math.floor(b);
      var prevBi = Math.floor(Beat.prevBeat);
      Beat.phase = b - bi;
      Beat.inBar = bi % Beat.meter;
      var bar = Math.floor(bi / Beat.meter);
      var prevBar = Math.floor(prevBi / Beat.meter);
      Beat.ticked = bi !== prevBi;
      Beat.barTicked = bar !== prevBar;
      Beat.bar = bar;
      if (Beat.ticked && AP.Events) {
        beatPayload.beat = bi;
        beatPayload.bar = bar;
        beatPayload.inBar = Beat.inBar;
        AP.Events.emit('beat', beatPayload);
      }
      if (Beat.barTicked && AP.Events) {
        barPayload.bar = bar;
        AP.Events.emit('bar', barPayload);
      }
    },

    // position within the current bar, 0..1
    barPhase: function () { return (Beat.beat / Beat.meter) - Math.floor(Beat.beat / Beat.meter); },

    // index of the k-subdivision pulse within the bar (0..k-1)
    polyIndex: function (k) {
      k = Math.max(1, k | 0);
      return Math.floor(Beat.barPhase() * k) % k;
    },

    // true on the step a k-per-bar pulse begins
    polyTicked: function (k) {
      k = Math.max(1, k | 0);
      var m = Beat.meter;
      return Math.floor(Beat.prevBeat / m * k) !== Math.floor(Beat.beat / m * k);
    },

    // E(k, n) spread over one bar (n steps per bar): true on the step an onset begins
    euclidTicked: function (k, n, rot) {
      n = Math.max(1, n | 0);
      var m = Beat.meter;
      var cur = Math.floor(Beat.beat / m * n);
      if (Math.floor(Beat.prevBeat / m * n) === cur) return false;
      var pat = euclidPattern(k, n, rot || 0);
      return pat[((cur % n) + n) % n] === 1;
    },

    // the current Euclid step index within the bar, and whether it is an onset (no tick edge required)
    euclidStep: function (n) { n = Math.max(1, n | 0); return Math.floor(Beat.barPhase() * n) % n; },
    euclidOn: function (k, n, rot) { return euclidPattern(k, n, rot || 0)[Beat.euclidStep(n)] === 1; },
    euclidPattern: euclidPattern,

    // seconds until the next beat at the current tempo (game time)
    toNextBeat: function () { return (1 - Beat.phase) * 60 / Beat.bpm; },
    secondsPerBeat: function () { return 60 / Beat.bpm; },

    realBpm: function () { return Beat.bpm * ((AP.Time && AP.Time.scale) || 1); }
  };

  AP.Beat = Beat;
})(window.AP = window.AP || {});
