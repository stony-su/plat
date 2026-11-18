/* js/core/flow.js — owner: CORE */
(function (AP) {
  'use strict';

  // The ONE flow-field function shared by W3 gameplay (wind) and all art (streamlines).
  // Normative formula: docs/CONTRACT.md section 2.3. Time t MUST be L.time for physics and art.
  var DEFAULT = Object.freeze({ seed: 0, scale: 320, tscale: 0.08, angle: 0, spread: Math.PI, mmin: 0.35, swirl: null });

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  // partial params in code units (u, radians) -> full params object
  function params(partial) {
    var p = partial || {};
    var sw = null;
    if (p.swirl && p.swirl.length >= 4) sw = [num(p.swirl[0], 0), num(p.swirl[1], 0), Math.max(1e-6, num(p.swirl[2], 1)), num(p.swirl[3], 0)];
    return {
      seed: num(p.seed, DEFAULT.seed),
      scale: Math.max(1e-6, num(p.scale, DEFAULT.scale)),
      tscale: num(p.tscale, DEFAULT.tscale),
      angle: num(p.angle, DEFAULT.angle),
      spread: num(p.spread, DEFAULT.spread),
      mmin: num(p.mmin, DEFAULT.mmin),
      swirl: sw
    };
  }

  // level-spec units -> full params. spec: {seed, scale (tiles, def 10), tscale, angle (deg), spread (deg, def 180),
  // mmin, swirl:[cx, cy, R, k] with cx, cy, R in tiles (tile coordinates: 12.5 = centre of tile 12)}
  function fromSpec(spec) {
    var s = spec || {};
    var D = Math.PI / 180;
    var sw = null;
    if (s.swirl && s.swirl.length >= 4) sw = [num(s.swirl[0], 0) * 32, num(s.swirl[1], 0) * 32, Math.max(1e-6, num(s.swirl[2], 1) * 32), num(s.swirl[3], 0)];
    return {
      seed: num(s.seed, DEFAULT.seed),
      scale: Math.max(1e-6, num(s.scale, 10) * 32),
      tscale: num(s.tscale, DEFAULT.tscale),
      angle: num(s.angle, 0) * D,
      spread: (s.spread === undefined ? DEFAULT.spread : num(s.spread, 180) * D),
      mmin: num(s.mmin, DEFAULT.mmin),
      swirl: sw
    };
  }

  var n3 = null;
  function noise3(x, y, z) {
    if (!n3) n3 = AP.Noise.n3;
    return n3(x, y, z);
  }

  // out {x, y (unit direction), m in [0,1] (for |k| <= 1)}
  function sample(x, y, t, p, out) {
    p = p || DEFAULT;
    out = out || { x: 1, y: 0, m: 0 };
    var s = p.seed * 0.1371;
    var sc = p.scale;
    var tt = t * p.tscale;
    var nA = noise3(x / sc + s, y / sc - s, tt);
    var nB = noise3(x / (2 * sc) + 31.7 + s, y / (2 * sc) - 17.3, tt * 0.5);
    var th = p.angle + p.spread * nA;
    var m = p.mmin + (1 - p.mmin) * (0.5 + 0.5 * nB);
    var dx = Math.cos(th);
    var dy = Math.sin(th);
    var sw = p.swirl;
    if (sw) {
      var cx = sw[0], cy = sw[1], R = sw[2], k = sw[3];
      var rx = x - cx, ry = y - cy;
      var r = Math.sqrt(rx * rx + ry * ry);
      var w0 = 1 - r / R;
      if (w0 < 0) w0 = 0; else if (w0 > 1) w0 = 1;
      var w = w0 * w0 * Math.abs(k);
      if (w > 0 && r > 1e-9) {
        var sg = k > 0 ? 1 : (k < 0 ? -1 : 0);
        var tx = (-ry / r) * sg;
        var ty = (rx / r) * sg;
        var lx = dx + (tx - dx) * w;
        var ly = dy + (ty - dy) * w;
        var l = Math.sqrt(lx * lx + ly * ly);
        if (l > 1e-12) { dx = lx / l; dy = ly / l; }
      }
      if (w > m) m = w;
    }
    out.x = dx;
    out.y = dy;
    out.m = m;
    return out;
  }

  var tmp = { x: 0, y: 0, m: 0 };

  // u/s^2 force: dir * m * strength
  function force(x, y, t, p, strength, out) {
    out = out || { x: 0, y: 0 };
    sample(x, y, t, p, tmp);
    out.x = tmp.x * tmp.m * strength;
    out.y = tmp.y * tmp.m * strength;
    return out;
  }

  // u/s velocity: dir * m * speed
  function velocity(x, y, t, p, speed, out) {
    out = out || { x: 0, y: 0 };
    sample(x, y, t, p, tmp);
    out.x = tmp.x * tmp.m * speed;
    out.y = tmp.y * tmp.m * speed;
    return out;
  }

  // Integrates a streamline (midpoint / RK2) from (x, y): writes n points as [x0,y0,x1,y1,...] into outFlat.
  // stepLen may be negative to trace upstream. Returns outFlat (a plain Array gets its length set to 2n).
  var sA = { x: 0, y: 0, m: 0 };
  var sB = { x: 0, y: 0, m: 0 };
  function streamline(x, y, t, p, stepLen, n, outFlat) {
    outFlat = outFlat || [];
    n = Math.max(0, n | 0);
    var cx = x, cy = y;
    for (var i = 0; i < n; i++) {
      outFlat[i * 2] = cx;
      outFlat[i * 2 + 1] = cy;
      sample(cx, cy, t, p, sA);
      var mx = cx + sA.x * stepLen * 0.5;
      var my = cy + sA.y * stepLen * 0.5;
      sample(mx, my, t, p, sB);
      cx += sB.x * stepLen;
      cy += sB.y * stepLen;
    }
    if (Array.isArray(outFlat)) outFlat.length = n * 2;
    return outFlat;
  }

  AP.Flow = {
    DEFAULT: DEFAULT,
    params: params,
    fromSpec: fromSpec,
    sample: sample,
    force: force,
    velocity: velocity,
    streamline: streamline
  };
})(window.AP = window.AP || {});
