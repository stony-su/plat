/* js/core/rng.js — owner: CORE */
(function (AP) {
  'use strict';

  // FNV-1a 32-bit over UTF-16 code units
  AP.hash = function (str) {
    str = String(str);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };

  // integer lattice hash (well mixed; deterministic across platforms)
  AP.hash2 = function (x, y, seed) {
    var h = ((seed | 0) ^ 0x9E3779B9) | 0;
    h = Math.imul(h ^ (x | 0), 0x85EBCA6B);
    h ^= h >>> 13;
    h = Math.imul(h ^ (y | 0), 0xC2B2AE35);
    h ^= h >>> 16;
    h = Math.imul(h, 0x27D4EB2F);
    h ^= h >>> 15;
    return h >>> 0;
  };

  function Rng(seed) {
    this.seed = seed >>> 0;
    this.s = seed >>> 0;
  }

  Rng.prototype = {
    constructor: Rng,
    // mulberry32
    next: function () {
      var a = (this.s = (this.s + 0x6D2B79F5) | 0);
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    // inclusive integer range
    int: function (lo, hi) {
      if (hi < lo) { var tmp = lo; lo = hi; hi = tmp; }
      return lo + Math.floor(this.next() * (hi - lo + 1));
    },
    range: function (lo, hi) { return lo + this.next() * (hi - lo); },
    pick: function (arr) { return (arr && arr.length) ? arr[Math.floor(this.next() * arr.length)] : undefined; },
    chance: function (p) { return this.next() < p; },
    sign: function () { return this.next() < 0.5 ? -1 : 1; },
    // in-place Fisher-Yates; returns arr
    shuffle: function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(this.next() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    // independent stream derived from the ORIGINAL seed and a salt; does not advance this stream
    fork: function (salt) {
      var s = (typeof salt === 'number') ? (salt | 0) : AP.hash(String(salt));
      return new Rng(AP.hash2(this.seed, s, 0x5EED));
    },
    // current internal state (for save/restore of a stream)
    state: function (v) {
      if (v !== undefined) this.s = v | 0;
      return this.s;
    }
  };

  AP.RNG = function (seed) {
    if (typeof seed === 'string') seed = AP.hash(seed);
    seed = +seed;
    if (!isFinite(seed)) seed = 0;
    return new Rng(Math.floor(seed) >>> 0);
  };
  AP.RNG.Rng = Rng;
})(window.AP = window.AP || {});
