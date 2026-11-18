/* js/core/noise.js — owner: CORE */
(function (AP) {
  'use strict';

  // Simplex noise (Gustavson), fixed permutation from AP.RNG(1337). Outputs in [-1, 1].
  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;
  var F3 = 1 / 3;
  var G3 = 1 / 6;

  var grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ]);

  var perm = new Uint8Array(512);
  var permMod12 = new Uint8Array(512);
  (function buildPerm() {
    var p = [];
    for (var i = 0; i < 256; i++) p.push(i);
    AP.RNG(1337).shuffle(p);
    for (var j = 0; j < 512; j++) {
      perm[j] = p[j & 255];
      permMod12[j] = perm[j] % 12;
    }
  })();

  function n2(xin, yin) {
    var n0 = 0, n1 = 0, n2v = 0;
    var s = (xin + yin) * F2;
    var i = Math.floor(xin + s);
    var j = Math.floor(yin + s);
    var t = (i + j) * G2;
    var x0 = xin - (i - t);
    var y0 = yin - (j - t);
    var i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    var x1 = x0 - i1 + G2;
    var y1 = y0 - j1 + G2;
    var x2 = x0 - 1 + 2 * G2;
    var y2 = y0 - 1 + 2 * G2;
    var ii = i & 255;
    var jj = j & 255;
    var t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      var gi0 = permMod12[ii + perm[jj]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0);
    }
    var t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      var gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1);
    }
    var t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      var gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;
      t2 *= t2;
      n2v = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2);
    }
    var r = 70 * (n0 + n1 + n2v);
    return r < -1 ? -1 : (r > 1 ? 1 : r);
  }

  function n3(xin, yin, zin) {
    var n0 = 0, n1 = 0, n2v = 0, n3v = 0;
    var s = (xin + yin + zin) * F3;
    var i = Math.floor(xin + s);
    var j = Math.floor(yin + s);
    var k = Math.floor(zin + s);
    var t = (i + j + k) * G3;
    var x0 = xin - (i - t);
    var y0 = yin - (j - t);
    var z0 = zin - (k - t);
    var i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    var x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    var x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    var x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    var ii = i & 255, jj = j & 255, kk = k & 255;
    var t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      var gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
    }
    var t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      var gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
    }
    var t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      var gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2v = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
    }
    var t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      var gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3v = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
    }
    var r = 32 * (n0 + n1 + n2v + n3v);
    return r < -1 ? -1 : (r > 1 ? 1 : r);
  }

  function fbm2(x, y, oct, lac, gain) {
    if (oct === undefined) oct = 4;
    if (lac === undefined) lac = 2;
    if (gain === undefined) gain = 0.5;
    var sum = 0, amp = 1, norm = 0, f = 1;
    for (var i = 0; i < oct; i++) {
      sum += amp * n2(x * f, y * f);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return norm > 0 ? sum / norm : 0;
  }

  function fbm3(x, y, z, oct, lac, gain) {
    if (oct === undefined) oct = 3;
    if (lac === undefined) lac = 2;
    if (gain === undefined) gain = 0.5;
    var sum = 0, amp = 1, norm = 0, f = 1;
    for (var i = 0; i < oct; i++) {
      sum += amp * n3(x * f, y * f, z * f);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return norm > 0 ? sum / norm : 0;
  }

  // Worley / cellular noise on unit cells: one jittered feature point per cell.
  // Returns out {f1, f2, id} (id = uint32 hash of the nearest cell). Pass `out` in hot loops.
  function worley2(x, y, seed, out) {
    out = out || { f1: 0, f2: 0, id: 0 };
    seed = seed | 0;
    var ix = Math.floor(x), iy = Math.floor(y);
    var f1 = 1e9, f2 = 1e9, id = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var cx = ix + dx, cy = iy + dy;
        var h = AP.hash2(cx, cy, seed);
        var px = cx + (h & 0xffff) / 65536;
        var py = cy + (h >>> 16) / 65536;
        var ddx = px - x, ddy = py - y;
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < f1) { f2 = f1; f1 = d; id = h; } else if (d < f2) { f2 = d; }
      }
    }
    out.f1 = f1;
    out.f2 = f2;
    out.id = id;
    return out;
  }

  AP.Noise = { n2: n2, n3: n3, fbm2: fbm2, fbm3: fbm3, worley2: worley2 };
})(window.AP = window.AP || {});
