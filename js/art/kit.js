/* js/art/kit.js — owner: ART */
(function (AP) {
  'use strict';

  // AP.Art: the drawing kit shared by every world agent (CONTRACT 2.8) plus AP.Art.util, the
  // helper layer used by the ART modules (backgrounds, midground, tile art). Pure helpers only at
  // load time; nothing here touches the DOM until a function is called after boot.

  var TAU = Math.PI * 2;
  var GA = 2.399963229728653;            // golden angle (radians)
  var SQ3_2 = 0.8660254037844386;
  var NOOPT = Object.freeze({});
  var DEFAULT_PAL = Object.freeze({ bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' });

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function num(v, d) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d; }

  // ------------------------------------------------------------------ colour (memoised)
  var rgbMemo = Object.create(null);
  var alphaMemo = Object.create(null);
  var mixMemo = Object.create(null);
  var vecMemo = Object.create(null);

  function hex2(n) { var s = (n | 0).toString(16); return s.length < 2 ? '0' + s : s; }

  function parseHex(hex) {
    var c = rgbMemo[hex];
    if (c) return c;
    var s = typeof hex === 'string' ? hex.trim() : '';
    var r = 255, g = 255, b = 255;
    if (s.charAt(0) === '#') s = s.slice(1);
    if (s.length === 3 || s.length === 4) {
      r = parseInt(s.charAt(0) + s.charAt(0), 16);
      g = parseInt(s.charAt(1) + s.charAt(1), 16);
      b = parseInt(s.charAt(2) + s.charAt(2), 16);
    } else if (s.length >= 6) {
      r = parseInt(s.slice(0, 2), 16);
      g = parseInt(s.slice(2, 4), 16);
      b = parseInt(s.slice(4, 6), 16);
    }
    if (!(r >= 0 && r <= 255)) r = 255;
    if (!(g >= 0 && g <= 255)) g = 255;
    if (!(b >= 0 && b <= 255)) b = 255;
    c = { r: r, g: g, b: b };
    rgbMemo[hex] = c;
    return c;
  }

  // css 'rgba(...)' string; alpha quantised to 1/256 so the memo stays bounded (no per-call alloc)
  function rgba(hex, a) {
    var tab = alphaMemo[hex];
    if (!tab) tab = alphaMemo[hex] = new Array(257);
    var i = Math.round(clamp01(num(a, 1)) * 256);
    var s = tab[i];
    if (s === undefined) {
      var c = parseHex(hex);
      s = tab[i] = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (i / 256).toFixed(4) + ')';
    }
    return s;
  }

  function mixHex(h1, h2, t) {
    var q = Math.round(clamp01(num(t, 0)) * 1000);
    var key = h1 + '|' + h2 + '|' + q;
    var s = mixMemo[key];
    if (s) return s;
    var a = parseHex(h1), b = parseHex(h2), k = q / 1000;
    s = '#' + hex2(Math.round(lerp(a.r, b.r, k))) + hex2(Math.round(lerp(a.g, b.g, k))) + hex2(Math.round(lerp(a.b, b.b, k)));
    mixMemo[key] = s;
    return s;
  }

  // amt in -1..1: toward black (negative) or white (positive)
  function shadeHex(hex, amt) {
    amt = clamp(num(amt, 0), -1, 1);
    return amt < 0 ? mixHex(hex, '#000000', -amt) : mixHex(hex, '#ffffff', amt);
  }

  // [r,g,b] in 0..1 (memoised; never mutate the result)
  function vec3(hex) {
    var v = vecMemo[hex];
    if (v) return v;
    var c = parseHex(hex);
    v = vecMemo[hex] = [c.r / 255, c.g / 255, c.b / 255];
    return v;
  }

  function palOf(key, fallback) {
    var W = AP.Worlds;
    if (W && typeof W.pal === 'function') {
      var p = W.pal(key);
      if (p && p.bg) return p;
    }
    var R = AP.R;
    if (R && typeof R.pal === 'function') {
      var q = R.pal(key);
      if (q && q.bg) return q;
    }
    return fallback || DEFAULT_PAL;
  }

  // ------------------------------------------------------------------ hashing / random
  function hash3(x, y, s) {
    var h = Math.imul((s | 0) ^ 0x9E3779B9, 0x85EBCA6B);
    h = Math.imul(h ^ (x | 0), 0xCC9E2D51);
    h = (h << 15) | (h >>> 17);
    h = Math.imul(h ^ (y | 0), 0x1B873593);
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 0xE6546B64;
    h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B);
    h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function hashf(x, y, s) { return hash3(x, y, s) / 4294967296; }

  function mulberry(seed) {
    var a = seed >>> 0;
    var o = {
      next: function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range: function (lo, hi) { return lo + (hi - lo) * o.next(); },
      int: function (lo, hi) { return lo + Math.floor(o.next() * (hi - lo + 1)); },
      pick: function (arr) { return arr && arr.length ? arr[Math.floor(o.next() * arr.length)] : undefined; },
      chance: function (p) { return o.next() < p; },
      sign: function () { return o.next() < 0.5 ? -1 : 1; }
    };
    return o;
  }

  // deterministic RNG: AP.RNG when present (mulberry32 per contract), else the local twin
  function rng(seed) {
    var R = AP.RNG;
    if (typeof R === 'function') {
      try {
        var r = R(seed >>> 0);
        if (r && typeof r.next === 'function' && typeof r.range === 'function' && typeof r.int === 'function' &&
            typeof r.pick === 'function' && typeof r.chance === 'function') return r;
      } catch (e) { /* fall through to the local generator */ }
    }
    return mulberry(seed);
  }

  // ------------------------------------------------------------------ noise (AP.Noise, local fallback)
  var PERM = new Uint8Array(512);
  (function buildPerm() {
    var p = new Uint8Array(256), i, r = mulberry(1337);
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { var j = Math.floor(r.next() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) PERM[i] = p[i & 255];
  })();
  var GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  var F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

  function simplex2(xin, yin) {
    var s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
    var t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
    var i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    var ii = i & 255, jj = j & 255, n = 0, g, tt;
    tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) { g = PERM[ii + PERM[jj]] & 7; tt *= tt; n += tt * tt * (GX[g] * x0 + GY[g] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) { g = PERM[ii + i1 + PERM[jj + j1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x1 + GY[g] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) { g = PERM[ii + 1 + PERM[jj + 1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  }

  function n2(x, y) {
    var N = AP.Noise;
    return (N && typeof N.n2 === 'function') ? N.n2(x, y) : simplex2(x, y);
  }
  function n3(x, y, z) {
    var N = AP.Noise;
    if (N && typeof N.n3 === 'function') return N.n3(x, y, z);
    return simplex2(x + z * 0.73, y - z * 1.31) * 0.7 + simplex2(x * 0.5 - z * 0.41 + 17.3, y * 0.5 + z * 0.29 - 9.1) * 0.3;
  }
  function fbm2(x, y, oct) {
    var N = AP.Noise, o = oct || 4;
    if (N && typeof N.fbm2 === 'function') return N.fbm2(x, y, o, 2, 0.5);
    var s = 0, a = 0.5, f = 1, norm = 0;
    for (var i = 0; i < o; i++) { s += a * simplex2(x * f, y * f); norm += a; a *= 0.5; f *= 2; }
    return s / norm;
  }

  // ------------------------------------------------------------------ algorithms (AP.Algo, local fallback)
  function algo(name) {
    var A = AP.Algo;
    return (A && typeof A[name] === 'function') ? A[name] : null;
  }

  function lsystemLocal(axiom, rules, iters, maxLen) {
    var s = String(axiom || ''), cap = maxLen || 50000;
    for (var it = 0; it < (iters | 0); it++) {
      var parts = [], len = 0;
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i), r = Object.prototype.hasOwnProperty.call(rules, c) ? String(rules[c]) : c;
        parts.push(r); len += r.length;
        if (len >= cap) break;
      }
      s = parts.join('').slice(0, cap);
      if (s.length >= cap) break;
    }
    return s;
  }
  function lsystem(axiom, rules, iters, maxLen) {
    var f = algo('lsystem');
    if (f) { try { var s = f(axiom, rules, iters, maxLen); if (typeof s === 'string') return s; } catch (e) { /* local */ } }
    return lsystemLocal(axiom, rules || {}, iters, maxLen);
  }

  function turtleLocal(str, o) {
    o = o || NOOPT;
    var x = num(o.x, 0), y = num(o.y, 0), h = num(o.heading, -Math.PI / 2);
    var len = num(o.step, 10), ang = num(o.angle, Math.PI / 6), shrink = num(o.shrink, 1);
    var segs = [], leaves = [], stack = [], depth = 0, moved = false, s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 70 || c === 71) {
        var nx = x + Math.cos(h) * len, ny = y + Math.sin(h) * len;
        segs.push([x, y, nx, ny, depth]); x = nx; y = ny; moved = true;
      } else if (c === 102) { x += Math.cos(h) * len; y += Math.sin(h) * len; moved = true; }
      else if (c === 43) h += ang;
      else if (c === 45) h -= ang;
      else if (c === 124) h += Math.PI;
      else if (c === 91) { stack.push(x, y, h, len, depth, moved ? 1 : 0); depth++; len *= shrink; moved = false; }
      else if (c === 93 && stack.length) {
        if (moved) leaves.push([x, y, h]);
        moved = stack.pop() === 1; depth = stack.pop(); len = stack.pop(); h = stack.pop(); y = stack.pop(); x = stack.pop();
      }
    }
    leaves.push([x, y, h]);
    return { segs: segs, leaves: leaves };
  }
  function turtle(str, o) {
    var f = algo('turtle');
    if (f) { try { var r = f(str, o); if (r && r.segs && r.leaves) return r; } catch (e) { /* local */ } }
    return turtleLocal(str, o);
  }

  function kochLocal(x1, y1, x2, y2, depth, outward) {
    var sg = (typeof outward === 'number' && outward < 0) ? -1 : 1;
    var pts = [x1, y1, x2, y2];
    for (var lv = 0; lv < clamp(depth | 0, 0, 7); lv++) {
      var next = [];
      for (var i = 0; i < pts.length - 2; i += 2) {
        var ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
        var dx = (bx - ax) / 3, dy = (by - ay) / 3, px = ax + dx, py = ay + dy, qx = ax + 2 * dx, qy = ay + 2 * dy;
        next.push(ax, ay, px, py, (px + qx) * 0.5 + sg * dy * SQ3_2, (py + qy) * 0.5 - sg * dx * SQ3_2, qx, qy);
      }
      next.push(pts[pts.length - 2], pts[pts.length - 1]);
      pts = next;
    }
    return pts;
  }
  function kochPts(x1, y1, x2, y2, depth, outward) {
    var f = algo('koch');
    if (f) { try { var r = f(x1, y1, x2, y2, depth, outward); if (r && r.length >= 4) return r; } catch (e) { /* local */ } }
    return kochLocal(x1, y1, x2, y2, depth, outward);
  }

  // outer equilateral triangle of side `size`, apex up, centroid at (cx,cy) — same as AP.Algo
  function sierpLocal(cx, cy, size, depth) {
    var h = size * SQ3_2, out = [];
    var rec = function (ax, ay, bx, by, qx, qy, d) {
      if (d <= 0) { out.push([ax, ay, bx, by, qx, qy]); return; }
      var abx = (ax + bx) / 2, aby = (ay + by) / 2, aqx = (ax + qx) / 2, aqy = (ay + qy) / 2, bqx = (bx + qx) / 2, bqy = (by + qy) / 2;
      rec(ax, ay, abx, aby, aqx, aqy, d - 1);
      rec(abx, aby, bx, by, bqx, bqy, d - 1);
      rec(aqx, aqy, bqx, bqy, qx, qy, d - 1);
    };
    rec(cx, cy - 2 * h / 3, cx - size / 2, cy + h / 3, cx + size / 2, cy + h / 3, clamp(depth | 0, 0, 8));
    return out;
  }
  function sierpinski(cx, cy, size, depth) {
    var f = algo('sierpinski');
    if (f) { try { var r = f(cx, cy, size, depth); if (r && r.length) return r; } catch (e) { /* local */ } }
    return sierpLocal(cx, cy, size, depth);
  }

  // Sutherland–Hodgman: keep the part of convex flat polygon `poly` where a*x + b*y <= c
  function clipHalf(poly, a, b, c) {
    var out = [], n = poly.length >> 1;
    for (var i = 0; i < n; i++) {
      var j = i + 1 === n ? 0 : i + 1;
      var x1 = poly[i * 2], y1 = poly[i * 2 + 1], x2 = poly[j * 2], y2 = poly[j * 2 + 1];
      var d1 = a * x1 + b * y1 - c, d2 = a * x2 + b * y2 - c;
      if (d1 <= 0) out.push(x1, y1);
      if ((d1 <= 0) !== (d2 <= 0)) { var t = d1 / (d1 - d2); out.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); }
    }
    return out;
  }
  // clip `poly` (any simple polygon, flat) by convex `clip` (flat, either winding)
  function clipConvex(poly, clip) {
    var n = clip.length >> 1, area = 0, i;
    for (i = 0; i < n; i++) { var j = (i + 1) % n; area += clip[i * 2] * clip[j * 2 + 1] - clip[j * 2] * clip[i * 2 + 1]; }
    var sg = area >= 0 ? 1 : -1, out = poly;
    for (i = 0; i < n && out.length >= 6; i++) {
      var k = (i + 1) % n, ax = clip[i * 2], ay = clip[i * 2 + 1], bx = clip[k * 2], by = clip[k * 2 + 1];
      // inside: sg * cross(b - a, p - a) >= 0  <=>  nx*px + ny*py <= nx*ax + ny*ay
      var nx = (by - ay) * sg, ny = -(bx - ax) * sg;
      out = clipHalf(out, nx, ny, nx * ax + ny * ay);
    }
    return out;
  }
  // exact Voronoi cell of (sx,sy) against the flat neighbour list `others`, inside a box
  function voronoiCell(sx, sy, others, bx, by, bw, bh) {
    var poly = [bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh];
    for (var k = 0; k < others.length && poly.length >= 6; k += 2) {
      var ox = others[k], oy = others[k + 1], a = ox - sx, b = oy - sy;
      if (a === 0 && b === 0) continue;
      poly = clipHalf(poly, a, b, (ox * ox + oy * oy - sx * sx - sy * sy) * 0.5);
    }
    return poly;
  }
  function voronoiLocal(sites, bbox) {
    var n = sites ? sites.length : 0, cells = [];
    var flat = [];
    for (var i = 0; i < n; i++) flat.push(sites[i][0], sites[i][1]);
    for (i = 0; i < n; i++) {
      var others = flat.slice(0, i * 2).concat(flat.slice(i * 2 + 2));
      var poly = voronoiCell(sites[i][0], sites[i][1], others, bbox[0], bbox[1], bbox[2], bbox[3]);
      cells.push({ site: sites[i], poly: poly.length >= 6 ? poly : [], neighbors: [] });
    }
    return cells;
  }
  function voronoi(sites, bbox) {
    var f = algo('voronoi');
    if (f) { try { var r = f(sites, bbox); if (r && r.length === sites.length) return r; } catch (e) { /* local */ } }
    return voronoiLocal(sites, bbox);
  }

  function phylloPt(i, c, out) {
    var r = c * Math.sqrt(i > 0 ? i : 0), a = i * GA;
    out.x = r * Math.cos(a); out.y = r * Math.sin(a);
    return out;
  }

  // classic four-pendulum harmonograph (frequency in Hz, damping per second), as AP.Algo
  function harmPt(t, hp, out) {
    var f = algo('harmonograph');
    if (f) return f(t, hp, out);
    var x = hp.cx || 0, y = hp.cy || 0;
    x += (hp.a1 || 0) * Math.sin(TAU * (hp.f1 || 0) * t + (hp.p1 || 0)) * Math.exp(-(hp.d1 || 0) * t);
    x += (hp.a2 || 0) * Math.sin(TAU * (hp.f2 || 0) * t + (hp.p2 || 0)) * Math.exp(-(hp.d2 || 0) * t);
    y += (hp.a3 || 0) * Math.sin(TAU * (hp.f3 || 0) * t + (hp.p3 || 0)) * Math.exp(-(hp.d3 || 0) * t);
    y += (hp.a4 || 0) * Math.sin(TAU * (hp.f4 || 0) * t + (hp.p4 || 0)) * Math.exp(-(hp.d4 || 0) * t);
    out.x = x; out.y = y;
    return out;
  }

  // ------------------------------------------------------------------ flow (AP.Flow, local fallback)
  var flowOut = { x: 1, y: 0, m: 0.5 };
  function flowSample(x, y, t, fp, out) {
    var F = AP.Flow;
    out = out || flowOut;
    if (F && typeof F.sample === 'function') return F.sample(x, y, t, fp || F.DEFAULT, out);
    var a = (fp && typeof fp.angle === 'number' ? fp.angle : 0) + Math.PI * n3(x / 320, y / 320, t * 0.08);
    out.x = Math.cos(a); out.y = Math.sin(a); out.m = 0.35 + 0.65 * (0.5 + 0.5 * n3(x / 640 + 31.7, y / 640 - 17.3, t * 0.04));
    return out;
  }
  var flowMemoL = null, flowMemoP = null;
  function flowParams(L) {
    var F = AP.Flow;
    if (L && L === flowMemoL && flowMemoP) return flowMemoP;
    var p = null;
    if (F) {
      try {
        if (L && L.def && L.def.flow && typeof F.fromSpec === 'function') p = F.fromSpec(L.def.flow);
        else if (L && L.flow && typeof L.flow.scale === 'number' && L.flow.scale > 100 && typeof F.params === 'function') p = F.params(L.flow);
      } catch (e) { p = null; }
      if (!p) p = F.DEFAULT || null;
    }
    flowMemoL = L || null; flowMemoP = p;
    return p;
  }

  // ------------------------------------------------------------------ runtime context helpers
  function makeCanvas(w, h) {
    var c = null;
    w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
    try {
      if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') c = document.createElement('canvas');
      else if (typeof OffscreenCanvas === 'function') c = new OffscreenCanvas(w, h);
    } catch (e) { c = null; }
    if (!c) return null;
    try { c.width = w; c.height = h; } catch (e2) { return null; }
    return c;
  }
  function ctxOf(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try { return canvas.getContext('2d') || null; } catch (e) { return null; }
  }
  function hasPath2D() { return typeof Path2D === 'function'; }

  function devicePx() {
    var R = AP.R;
    var px = R && typeof R.px === 'number' && R.px > 0 ? R.px : 0;
    if (!px && typeof window !== 'undefined' && window && typeof window.devicePixelRatio === 'number') px = window.devicePixelRatio;
    return px > 0 ? px : 1;
  }

  // beat helpers: p.phase if given, else AP.Beat.phase, else the fraction of p.beat
  function beatPhase(p) {
    if (p && typeof p.phase === 'number' && p.phase === p.phase) return clamp01(p.phase);
    var B = AP.Beat;
    if (B && typeof B.phase === 'number' && B.phase === B.phase) return clamp01(B.phase);
    if (p && typeof p.beat === 'number' && p.beat === p.beat) return p.beat - Math.floor(p.beat);
    return 0.5;
  }
  function beatPulse(p) { var q = 1 - beatPhase(p); return q * q * q * q; }

  // quality: accepts AP.R.quality objects, 'high'|'med'|'low'|'off' strings or numbers
  var Q_OUT = { particles: 1, bg: 'high', mid: true, scale: 1 };
  function quality(q) {
    var o = Q_OUT;
    o.particles = 1; o.bg = 'high'; o.mid = true; o.scale = 1;
    if (q === undefined || q === null) {
      var R = AP.R;
      if (R && R.quality && typeof R.quality === 'object') q = R.quality;
    }
    if (typeof q === 'number') { o.particles = clamp(q, 0.1, 1); o.scale = o.particles; }
    else if (typeof q === 'string') {
      o.bg = q === 'low' ? 'low' : (q === 'off' ? 'off' : 'high');
      o.particles = q === 'low' ? 0.3 : (q === 'med' ? 0.6 : 1);
      o.scale = o.particles;
    } else if (q && typeof q === 'object') {
      o.particles = clamp(num(q.particles, 1), 0.1, 1);
      if (typeof q.bg === 'string') o.bg = q.bg;
      if (q.mid === false) o.mid = false;
      o.scale = o.particles;
    }
    return o;
  }

  // ------------------------------------------------------------------ path primitives
  // regular polygon sub-path (sides >= 32 -> circle), first vertex at angle rot
  function polyPath(ctx, cx, cy, r, sides, rot) {
    if (sides >= 32) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); return; }
    var n = Math.max(3, sides | 0), a0 = rot || 0;
    ctx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    for (var i = 1; i < n; i++) { var a = a0 + i * TAU / n; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.closePath();
  }
  function starPath(ctx, cx, cy, ro, ri, pts, rot) {
    var n = Math.max(2, pts | 0) * 2, a0 = rot || 0;
    for (var i = 0; i < n; i++) {
      var a = a0 + i * Math.PI / (n / 2), r = (i & 1) ? ri : ro;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  function flatPath(ctx, flat, closed) {
    if (!flat || flat.length < 4) return;
    ctx.moveTo(flat[0], flat[1]);
    for (var i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
    if (closed) ctx.closePath();
  }
  function strokeAny(ctx, path) {
    if (!path) return;
    if (typeof path === 'function') { ctx.beginPath(); path(ctx); ctx.stroke(); return; }
    if (typeof path.length === 'number') { ctx.beginPath(); flatPath(ctx, path, false); ctx.stroke(); return; }
    ctx.stroke(path);
  }

  // ------------------------------------------------------------------ public kit (CONTRACT 2.8)

  // One Truchet tile, top-left (x,y), side `size`, orientation 0..3 (AP.Algo.truchet).
  // o: {color, width, alpha, mode:'arc'|'tri'|'line', rings (concentric arcs, arc mode), fill (tri mode)}
  function truchet(ctx, x, y, size, orient, o) {
    if (!ctx || !(size > 0)) return;
    o = o || NOOPT;
    var k = (orient | 0) & 3, mode = o.mode || 'arc';
    ctx.save();
    ctx.globalAlpha *= (o.alpha === undefined ? 1 : o.alpha);
    ctx.strokeStyle = o.color || '#ffffff';
    ctx.lineWidth = o.width || Math.max(1, size * 0.08);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (mode === 'tri') {
      var cxs = [x, x + size, x + size, x], cys = [y, y, y + size, y + size];
      ctx.moveTo(cxs[k], cys[k]); ctx.lineTo(cxs[(k + 1) & 3], cys[(k + 1) & 3]); ctx.lineTo(cxs[(k + 3) & 3], cys[(k + 3) & 3]);
      ctx.closePath();
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      ctx.stroke();
    } else if (mode === 'line') {
      if (k & 1) { ctx.moveTo(x + size, y); ctx.lineTo(x, y + size); } else { ctx.moveTo(x, y); ctx.lineTo(x + size, y + size); }
      ctx.stroke();
    } else {
      var rings = Math.max(1, o.rings | 0);
      for (var i = 0; i < rings; i++) {
        var rr = rings === 1 ? size / 2 : size * (i + 1) / (rings + 1);
        if ((k & 1) === 0) {
          ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, Math.PI / 2);
          ctx.moveTo(x + size - rr, y + size); ctx.arc(x + size, y + size, rr, Math.PI, Math.PI * 1.5);
        } else {
          ctx.moveTo(x + size, y + rr); ctx.arc(x + size, y, rr, Math.PI / 2, Math.PI);
          ctx.moveTo(x, y + size - rr); ctx.arc(x, y + size, rr, Math.PI * 1.5, TAU);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Faceted crystal from a convex flat polygon. Facets fan from an apex (centroid + o.apex
  // offset) and are lit by a light that slowly turns with t. A glint runs along the outline.
  // o: {alpha, fill, edge, glint (colour or false), width, light (rad), apex:[dx,dy], glow (0..1), glintSpeed}
  function crystal(ctx, flatPoly, pal, t, o) {
    if (!ctx || !flatPoly || flatPoly.length < 6) return;
    o = o || NOOPT;
    pal = pal || DEFAULT_PAL;
    var n = flatPoly.length >> 1, i, j, cx = 0, cy = 0;
    for (i = 0; i < n; i++) { cx += flatPoly[i * 2]; cy += flatPoly[i * 2 + 1]; }
    cx /= n; cy /= n;
    var ax = cx + (o.apex ? num(o.apex[0], 0) : 0), ay = cy + (o.apex ? num(o.apex[1], 0) : 0);
    var alpha = o.alpha === undefined ? 1 : o.alpha, tt = num(t, 0);
    var light = num(o.light, -2.3) + tt * 0.35, w = o.width || 2;
    ctx.save();
    var a0 = ctx.globalAlpha;
    ctx.fillStyle = o.fill || pal.primary;
    for (i = 0; i < n; i++) {
      j = i + 1 === n ? 0 : i + 1;
      var x1 = flatPoly[i * 2], y1 = flatPoly[i * 2 + 1], x2 = flatPoly[j * 2], y2 = flatPoly[j * 2 + 1];
      var lit = 0.5 + 0.5 * Math.cos(Math.atan2((y1 + y2) * 0.5 - ay, (x1 + x2) * 0.5 - ax) - light);
      ctx.globalAlpha = a0 * alpha * (0.07 + 0.30 * lit * lit);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = o.edge || pal.primary;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = a0 * alpha * 0.32;
    ctx.lineWidth = w * 0.5;
    ctx.beginPath();
    for (i = 0; i < n; i++) { ctx.moveTo(ax, ay); ctx.lineTo(flatPoly[i * 2], flatPoly[i * 2 + 1]); }
    ctx.stroke();
    ctx.globalAlpha = a0 * alpha;
    ctx.lineWidth = w;
    ctx.beginPath(); flatPath(ctx, flatPoly, true); ctx.stroke();
    if (o.glint !== false) {
      var per = 0;
      for (i = 0; i < n; i++) { j = i + 1 === n ? 0 : i + 1; per += Math.hypot(flatPoly[j * 2] - flatPoly[i * 2], flatPoly[j * 2 + 1] - flatPoly[i * 2 + 1]); }
      var span = Math.min(per * 0.12, 14), pos = (tt * num(o.glintSpeed, 70)) % (per * 2.4);
      if (pos < per && per > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = typeof o.glint === 'string' ? o.glint : pal.accent;
        ctx.lineWidth = w * 1.1;
        ctx.globalAlpha = a0 * alpha * 0.9;
        ctx.beginPath();
        var acc = 0, started = false;
        for (i = 0; i < n && acc < pos + span; i++) {
          j = i + 1 === n ? 0 : i + 1;
          var ex = flatPoly[j * 2] - flatPoly[i * 2], ey = flatPoly[j * 2 + 1] - flatPoly[i * 2 + 1], el = Math.hypot(ex, ey);
          if (el > 0 && acc + el > pos) {
            var s0 = Math.max(0, pos - acc) / el, s1 = Math.min(el, pos + span - acc) / el;
            if (!started) { ctx.moveTo(flatPoly[i * 2] + ex * s0, flatPoly[i * 2 + 1] + ey * s0); started = true; }
            ctx.lineTo(flatPoly[i * 2] + ex * s1, flatPoly[i * 2 + 1] + ey * s1);
          }
          acc += el;
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (o.glow && AP.R && typeof AP.R.glow === 'function') {
      var rad = 0;
      for (i = 0; i < n; i++) rad = Math.max(rad, Math.hypot(flatPoly[i * 2] - cx, flatPoly[i * 2 + 1] - cy));
      AP.R.glow(ctx, cx, cy, Math.min(48, rad * 1.4), o.edge || pal.primary, clamp01(o.glow) * 0.6 * alpha);
    }
    ctx.restore();
  }

  // L-system / turtle segments [[x1,y1,x2,y2,depth]] drawn up to `growth` (0..1, by segment order;
  // the last visible segment grows smoothly). Thickness tapers with depth.
  // o: {color, width, taper, alpha, leaves:[[x,y,heading]], leafColor, leafSize, sway, t, phase, baseY, height}
  function vine(ctx, segs, pal, growth, o) {
    if (!ctx || !segs || !segs.length) return;
    o = o || NOOPT;
    pal = pal || DEFAULT_PAL;
    var g = growth === undefined ? 1 : clamp01(num(growth, 1));
    if (g <= 0) return;
    var n = segs.length, shown = g * n, full = Math.floor(shown), part = shown - full;
    var w0 = o.width || 2.5, taper = o.taper === undefined ? 0.74 : o.taper, maxD = 0, i, d;
    for (i = 0; i < n; i++) if (segs[i][4] > maxD) maxD = segs[i][4];
    if (maxD > 14) maxD = 14;
    var sway = num(o.sway, 0), sw = 0, by = 0, hh = 1;
    if (sway) {
      sw = sway * Math.sin(num(o.t, 0) * 1.3 + num(o.phase, 0)) + sway * 0.35 * Math.sin(num(o.t, 0) * 2.9 + num(o.phase, 0) * 1.7);
      by = num(o.baseY, segs[0][1]);
      hh = Math.max(1, num(o.height, 100));
    }
    ctx.save();
    ctx.globalAlpha *= (o.alpha === undefined ? 1 : o.alpha);
    ctx.strokeStyle = o.color || pal.primary;
    ctx.lineCap = 'round';
    for (d = 0; d <= maxD; d++) {
      ctx.lineWidth = Math.max(0.6, w0 * Math.pow(taper, d));
      ctx.beginPath();
      var any = false;
      for (i = 0; i <= full && i < n; i++) {
        var s = segs[i];
        if ((s[4] | 0) !== d && !(d === maxD && s[4] > maxD)) continue;
        var x1 = s[0], y1 = s[1], x2 = s[2], y2 = s[3];
        if (i === full) { if (part <= 0) continue; x2 = x1 + (x2 - x1) * part; y2 = y1 + (y2 - y1) * part; }
        if (sw) {
          var k1 = (by - y1) / hh, k2 = (by - y2) / hh;
          x1 += sw * (k1 > 0 ? k1 * k1 : 0); x2 += sw * (k2 > 0 ? k2 * k2 : 0);
        }
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); any = true;
      }
      if (any) ctx.stroke();
    }
    var leaves = o.leaves;
    if (leaves && leaves.length && g > 0.55) {
      var la = smooth((g - 0.55) / 0.45), ls = num(o.leafSize, 2.6);
      ctx.fillStyle = o.leafColor || pal.accent;
      ctx.globalAlpha *= la;
      ctx.beginPath();
      for (i = 0; i < leaves.length; i++) {
        var lf = leaves[i], lx = lf[0], ly = lf[1];
        if (sw) { var kk = (by - ly) / hh; lx += sw * (kk > 0 ? kk * kk : 0); }
        starPath(ctx, lx, ly, ls * (0.8 + 0.4 * ((i * 7) % 5) / 4), ls * 0.45, 5, num(lf[2], 0) + num(o.t, 0) * 0.2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  function kochDraw(ctx, flat, color, width) {
    if (!ctx || !flat || flat.length < 4) return;
    ctx.save();
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = width || 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath(); flatPath(ctx, flat, false); ctx.stroke();
    ctx.restore();
  }

  // unit gasket per depth, cached (side 1, centroid at origin) and scaled at draw: no allocation
  var sierpUnit = [];
  function sierpGeom(depth) {
    var d = clamp(depth | 0, 0, 6), g = sierpUnit[d];
    if (!g) {
      var tris = sierpinski(0, 0, 1, d);
      g = new Float32Array(tris.length * 6);
      for (var i = 0; i < tris.length; i++) for (var k = 0; k < 6; k++) g[i * 6 + k] = tris[i][k];
      sierpUnit[d] = g;
    }
    return g;
  }
  function sierpinskiDraw(ctx, cx, cy, size, depth, color, alpha) {
    if (!ctx || !(size > 0)) return;
    var g = sierpGeom(depth);
    ctx.save();
    ctx.globalAlpha *= (alpha === undefined ? 1 : alpha);
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = Math.max(0.75, Math.min(2, size / (8 * Math.pow(2, depth | 0))));
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i < g.length; i += 6) {
      ctx.moveTo(cx + g[i] * size, cy + g[i + 1] * size);
      ctx.lineTo(cx + g[i + 2] * size, cy + g[i + 3] * size);
      ctx.lineTo(cx + g[i + 4] * size, cy + g[i + 5] * size);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  function lissajous(ctx, cx, cy, ax, ay, fx, fy, phase, color, width, steps) {
    if (!ctx) return;
    var n = Math.max(8, (steps | 0) || 128), ph = num(phase, 0), fxx = num(fx, 1), fyy = num(fy, 1);
    ctx.save();
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = width || 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var s = TAU * i / n, x = cx + ax * Math.sin(fxx * s + ph), y = cy + ay * Math.sin(fyy * s);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Vogel sunflower: n dots, spacing c, dot radius `dot`; t turns it slowly and runs a light wave outward
  function phyllo(ctx, cx, cy, n, c, color, dot, t) {
    if (!ctx || !(n > 0)) return;
    var tt = num(t, 0), rot = tt * 0.12, dd = dot || 1.5;
    ctx.save();
    ctx.fillStyle = color || '#ffffff';
    ctx.beginPath();
    for (var i = 1; i <= n; i++) {
      var r = c * Math.sqrt(i), th = i * GA + rot;
      var x = cx + r * Math.cos(th), y = cy + r * Math.sin(th);
      var wv = 0.5 + 0.5 * Math.cos(i * 0.22 - tt * 2.0);
      var rr = dd * (0.5 + 0.7 * wv * wv);
      ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU);
    }
    ctx.fill();
    ctx.restore();
  }

  // path2D: a Path2D, a function(ctx) that traces a path, or a flat [x,y,...] polyline
  function glowStroke(ctx, path2D, color, width, glowAlpha) {
    if (!ctx || !path2D) return;
    var w = width || 2, ga = glowAlpha === undefined ? 0.35 : clamp01(glowAlpha);
    ctx.save();
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ga > 0) {
      var base = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = base * ga * 0.2; ctx.lineWidth = w * 4.6; strokeAny(ctx, path2D);
      ctx.globalAlpha = base * ga * 0.45; ctx.lineWidth = w * 2.3; strokeAny(ctx, path2D);
      ctx.globalAlpha = base;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.lineWidth = w;
    strokeAny(ctx, path2D);
    ctx.restore();
  }

  // ------------------------------------------------------------------ extras (documented in apiNotes)

  // Wireframe cube in a tilted isometric view, turned by `ang` about the vertical axis.
  var CUBE_V = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  var CUBE_E = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  var cubeP = new Float32Array(16);
  function isoCube(ctx, cx, cy, size, ang, color, alpha, o) {
    if (!ctx) return;
    o = o || NOOPT;
    var ca = Math.cos(ang), sa = Math.sin(ang), tilt = num(o.tilt, 0.6), ct = Math.cos(tilt), st = Math.sin(tilt), h = size * 0.5, i;
    for (i = 0; i < 8; i++) {
      var x = CUBE_V[i * 3], y = CUBE_V[i * 3 + 1], z = CUBE_V[i * 3 + 2];
      var xr = x * ca - z * sa, zr = x * sa + z * ca;
      cubeP[i * 2] = cx + xr * h;
      cubeP[i * 2 + 1] = cy + (y * ct + zr * st) * h;
    }
    ctx.save();
    ctx.globalAlpha *= (alpha === undefined ? 1 : alpha);
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = o.width || 1.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (o.fill) {
      // top face (y=-1 corners 0,1,5,4) lightly filled
      ctx.fillStyle = o.fill;
      ctx.beginPath();
      ctx.moveTo(cubeP[0], cubeP[1]); ctx.lineTo(cubeP[2], cubeP[3]); ctx.lineTo(cubeP[10], cubeP[11]); ctx.lineTo(cubeP[8], cubeP[9]);
      ctx.closePath(); ctx.fill();
    }
    ctx.beginPath();
    for (i = 0; i < CUBE_E.length; i += 2) {
      var a = CUBE_E[i], b = CUBE_E[i + 1];
      ctx.moveTo(cubeP[a * 2], cubeP[a * 2 + 1]); ctx.lineTo(cubeP[b * 2], cubeP[b * 2 + 1]);
    }
    ctx.stroke();
    if (o.dots) {
      ctx.fillStyle = o.dots;
      ctx.beginPath();
      for (i = 0; i < 8; i++) { ctx.moveTo(cubeP[i * 2] + 1.6, cubeP[i * 2 + 1]); ctx.arc(cubeP[i * 2], cubeP[i * 2 + 1], 1.6, 0, TAU); }
      ctx.fill();
    }
    ctx.restore();
  }

  // Harmonograph trace for t in [t0,t1] (AP.Algo.harmonograph parameters) as one stroke.
  var hgOut = { x: 0, y: 0 };
  function harmonograph(ctx, hp, t0, t1, steps, color, width) {
    if (!ctx || !hp) return;
    var n = Math.max(4, steps | 0);
    ctx.save();
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = width || 1.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      harmPt(t0 + (t1 - t0) * i / n, hp, hgOut);
      if (i === 0) ctx.moveTo(hgOut.x, hgOut.y); else ctx.lineTo(hgOut.x, hgOut.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Deterministic crack network inside the rect (x,y,w,h): a dark gap with a bright core line.
  function crackPath(ctx, x, y, w, h, seed) {
    var r = hashf(seed, 7, 991), side = hash3(seed, 3, 17) & 1;
    var sx, sy, ex, ey;
    if (side) { sx = x + w * (0.15 + 0.3 * r); sy = y; ex = x + w * (0.55 + 0.3 * hashf(seed, 11, 5)); ey = y + h; }
    else { sx = x; sy = y + h * (0.15 + 0.3 * r); ex = x + w; ey = y + h * (0.55 + 0.3 * hashf(seed, 13, 5)); }
    var segs = 4, px = sx, py = sy, mx = 0, my = 0;
    ctx.moveTo(sx, sy);
    for (var i = 1; i <= segs; i++) {
      var t = i / segs, jx = (hashf(seed, i, 31) - 0.5) * w * 0.34, jy = (hashf(seed, i, 37) - 0.5) * h * 0.34;
      var nx = lerp(sx, ex, t) + (i < segs ? jx : 0), ny = lerp(sy, ey, t) + (i < segs ? jy : 0);
      ctx.lineTo(nx, ny);
      if (i === 2) { mx = nx; my = ny; }
      px = nx; py = ny;
    }
    // one branch from the middle joint
    var bx = mx + (side ? w * 0.28 : -w * 0.05) * (hashf(seed, 41, 3) < 0.5 ? -1 : 1);
    var bY = my + (side ? h * 0.12 : h * 0.3) * (hashf(seed, 43, 3) < 0.5 ? -1 : 1);
    ctx.moveTo(mx, my); ctx.lineTo(lerp(mx, bx, 0.55) + (hashf(seed, 47, 3) - 0.5) * 4, lerp(my, bY, 0.55)); ctx.lineTo(bx, bY);
    return px + py;
  }
  function crack(ctx, x, y, w, h, seed, color, width) {
    if (!ctx) return;
    var lw = width || 1.2;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath(); crackPath(ctx, x, y, w, h, seed | 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = lw * 2.6; ctx.stroke();
    ctx.strokeStyle = color || '#ffffff'; ctx.lineWidth = lw; ctx.stroke();
    ctx.restore();
  }

  // Glyph of a form: 3..6 sides or 99 (circle), outline only
  function formGlyph(ctx, cx, cy, r, form, rot, color, width) {
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = width || 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    polyPath(ctx, cx, cy, r, form >= 32 ? 48 : form, num(rot, -Math.PI / 2));
    ctx.stroke();
    ctx.restore();
  }

  AP.Art = {
    truchet: truchet,
    crystal: crystal,
    vine: vine,
    koch: kochDraw,
    sierpinski: sierpinskiDraw,
    lissajous: lissajous,
    phyllo: phyllo,
    glowStroke: glowStroke,
    isoCube: isoCube,
    harmonograph: harmonograph,
    crack: crack,
    formGlyph: formGlyph,
    util: {
      TAU: TAU, GA: GA, DEFAULT_PAL: DEFAULT_PAL,
      clamp: clamp, clamp01: clamp01, lerp: lerp, smooth: smooth, num: num,
      parseHex: parseHex, rgba: rgba, mixHex: mixHex, shadeHex: shadeHex, vec3: vec3, palOf: palOf,
      hash3: hash3, hashf: hashf, rng: rng, mulberry: mulberry,
      simplex2: simplex2, n2: n2, n3: n3, fbm2: fbm2,
      lsystem: lsystem, turtle: turtle, koch: kochPts, sierpinski: sierpinski, voronoi: voronoi,
      voronoiCell: voronoiCell, clipHalf: clipHalf, clipConvex: clipConvex,
      phylloPt: phylloPt, harmPt: harmPt, flowSample: flowSample, flowParams: flowParams,
      makeCanvas: makeCanvas, ctxOf: ctxOf, hasPath2D: hasPath2D, devicePx: devicePx,
      beatPhase: beatPhase, beatPulse: beatPulse, quality: quality,
      polyPath: polyPath, starPath: starPath, flatPath: flatPath, crackPath: crackPath
    }
  };
})(window.AP = window.AP || {});
