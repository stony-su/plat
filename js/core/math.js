/* js/core/math.js — owner: CORE */
(function (AP) {
  'use strict';

  var TAU = Math.PI * 2;
  var PI = Math.PI;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapAngle(a) {
    a = (a + PI) % TAU;
    if (a < 0) a += TAU;
    return a - PI;
  }

  var M = {
    TAU: TAU,
    PI: PI,
    DEG: PI / 180,
    clamp: clamp,
    lerp: lerp,
    invLerp: function (a, b, v) { return a === b ? 0 : (v - a) / (b - a); },
    approach: function (v, target, delta) {
      return v < target ? (v + delta > target ? target : v + delta) : (v - delta < target ? target : v - delta);
    },
    sign: function (v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); },
    damp: function (a, b, lambda, dt) { return a + (b - a) * (1 - Math.exp(-lambda * dt)); },
    wrapAngle: wrapAngle,
    // shortest signed rotation from a to b, in [-PI, PI)
    angleDiff: function (a, b) { return wrapAngle(b - a); },
    dist: function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); },
    dist2: function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; },
    len: function (x, y) { return Math.sqrt(x * x + y * y); },
    norm: function (x, y, out) {
      out = out || { x: 0, y: 0 };
      var l = Math.sqrt(x * x + y * y);
      if (l > 1e-12) { out.x = x / l; out.y = y / l; } else { out.x = 0; out.y = 0; }
      return out;
    },
    rot: function (x, y, a, out) {
      out = out || { x: 0, y: 0 };
      var c = Math.cos(a), s = Math.sin(a);
      var nx = x * c - y * s;
      out.y = x * s + y * c;
      out.x = nx;
      return out;
    },
    // strict overlap of two AABBs (touching edges do not overlap)
    aabb: function (ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    },
    // flat = [x0,y0,x1,y1,...]; even-odd rule
    pointInPoly: function (x, y, flat) {
      var inside = false;
      var n = flat.length >> 1;
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var xi = flat[i * 2], yi = flat[i * 2 + 1];
        var xj = flat[j * 2], yj = flat[j * 2 + 1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    },
    // extras (CORE additions)
    fract: function (v) { return v - Math.floor(v); },
    mod: function (a, n) { var r = a % n; return r < 0 ? r + n : r; },
    smoothstep: function (a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); },
    lerpAngle: function (a, b, t) { return a + wrapAngle(b - a) * t; },
    // critically-damped-ish spring step: returns new velocity, caller integrates. k stiffness, c damping
    spring: function (x, v, target, k, c, dt) { return v + ((target - x) * k - v * c) * dt; },
    ease: {
      linear: function (t) { return t; },
      inQuad: function (t) { return t * t; },
      outQuad: function (t) { return t * (2 - t); },
      inCubic: function (t) { return t * t * t; },
      outCubic: function (t) { var u = 1 - t; return 1 - u * u * u; },
      inOutSine: function (t) { return -(Math.cos(PI * t) - 1) / 2; },
      outBack: function (t) {
        var c1 = 1.70158, c3 = c1 + 1, u = t - 1;
        return 1 + c3 * u * u * u + c1 * u * u;
      },
      outElastic: function (t) {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
      }
    }
  };
  AP.M = M;

  // ---------------------------------------------------------------- Color
  var rgbCache = {};
  var rgbaCache = {};
  var vecCache = {};
  var HEX = '0123456789abcdef';

  function parseHex(hex) {
    var c = rgbCache[hex];
    if (c) return c;
    var s = String(hex || '').trim();
    var r = 255, g = 0, b = 255;
    if (s.charAt(0) === '#') s = s.slice(1);
    if (/^[0-9a-fA-F]{3,4}$/.test(s)) {
      r = parseInt(s.charAt(0) + s.charAt(0), 16);
      g = parseInt(s.charAt(1) + s.charAt(1), 16);
      b = parseInt(s.charAt(2) + s.charAt(2), 16);
    } else if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) {
      r = parseInt(s.slice(0, 2), 16);
      g = parseInt(s.slice(2, 4), 16);
      b = parseInt(s.slice(4, 6), 16);
    } else {
      var m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(String(hex || ''));
      if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    }
    c = Object.freeze({ r: r, g: g, b: b });
    rgbCache[hex] = c;
    return c;
  }

  function byteHex(v) {
    v = v < 0 ? 0 : (v > 255 ? 255 : Math.round(v));
    return HEX.charAt(v >> 4) + HEX.charAt(v & 15);
  }

  function toHex(r, g, b) { return '#' + byteHex(r) + byteHex(g) + byteHex(b); }

  var Color = {
    // {r,g,b} 0..255 (cached, frozen: do not mutate)
    rgb: parseHex,
    // 'rgba(r,g,b,a)' cached by colour and alpha (alpha quantised to 1/1000)
    rgba: function (hex, a) {
      if (a === undefined) a = 1;
      a = a < 0 ? 0 : (a > 1 ? 1 : a);
      var q = Math.round(a * 1000);
      var tab = rgbaCache[hex];
      if (!tab) tab = rgbaCache[hex] = {};
      var s = tab[q];
      if (s) return s;
      var c = parseHex(hex);
      s = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (q / 1000) + ')';
      tab[q] = s;
      return s;
    },
    mix: function (h1, h2, t) {
      var a = parseHex(h1), b = parseHex(h2);
      return toHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
    },
    // k in -1..1: negative darkens toward black, positive lightens toward white
    shade: function (hex, k) {
      var c = parseHex(hex);
      if (k >= 0) return toHex(c.r + (255 - c.r) * k, c.g + (255 - c.g) * k, c.b + (255 - c.b) * k);
      var m = 1 + k;
      return toHex(c.r * m, c.g * m, c.b * m);
    },
    // h in degrees, s and l in 0..1, a in 0..1
    hsl: function (h, s, l, a) {
      h = ((h % 360) + 360) % 360;
      return 'hsla(' + Math.round(h) + ',' + Math.round(clamp(s, 0, 1) * 100) + '%,' +
        Math.round(clamp(l, 0, 1) * 100) + '%,' + (a === undefined ? 1 : clamp(a, 0, 1)) + ')';
    },
    // [r,g,b] in 0..1 (cached, do not mutate)
    vec3: function (hex) {
      var v = vecCache[hex];
      if (v) return v;
      var c = parseHex(hex);
      v = vecCache[hex] = [c.r / 255, c.g / 255, c.b / 255];
      return v;
    },
    toHex: toHex,
    // perceived luminance 0..1
    luma: function (hex) { var c = parseHex(hex); return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }
  };
  AP.Color = Color;
})(window.AP = window.AP || {});
