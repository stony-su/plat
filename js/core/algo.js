/* js/core/algo.js — owner: TOOLS */
(function (AP) {
  'use strict';

  // AP.Algo: pure, deterministic algorithmic-art helpers (CONTRACT §2.3).
  // Never uses Math.random, the DOM or any other module at load or call time.
  // Builders (euclid, lsystem, turtle, koch, sierpinski, voronoi, poisson) return fresh
  // arrays and are meant for load/cache time. Per-frame helpers (truchet, lissajous,
  // harmonograph, phyllo) allocate nothing when an `out` object is passed.

  var TAU = Math.PI * 2;
  var GOLDEN_ANGLE = 2.39996323;
  var SQRT3_2 = Math.sqrt(3) / 2;
  var MAX_KOCH_DEPTH = 7;          // 4^7 + 1 = 16385 points
  var MAX_SIERPINSKI_DEPTH = 8;    // 3^8 = 6561 triangles
  var MAX_EUCLID_N = 4096;
  var MAX_LSYSTEM_ITERS = 64;
  var MAX_POISSON_POINTS = 60000;
  var MAX_POISSON_CELLS = 4000000;

  function num(v, d) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d; }
  function toInt(v, d) { v = num(+v, d); return v < 0 ? Math.ceil(v) : Math.floor(v); }

  // ---------------------------------------------------------------- hashing / rng
  function fmix32(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function hash3(x, y, s) {
    var h = Math.imul(x | 0, 0x27d4eb2d);
    h = fmix32(h ^ Math.imul(y | 0, 0x165667b1));
    h = fmix32(h ^ Math.imul((s | 0) ^ 0x9e3779b9, 0x2c1b3c6d));
    return h;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Accepts an AP.RNG instance ({next()}), a () => [0,1) function, or a numeric seed.
  function rngFunction(rng) {
    if (rng && typeof rng.next === 'function') return function () { return rng.next(); };
    if (typeof rng === 'function') return rng;
    if (typeof rng === 'number' && rng === rng) return mulberry32(rng);
    return mulberry32(0x9E3779B9);
  }

  // ---------------------------------------------------------------- euclid (Bjorklund)
  var euclidCache = {};
  var euclidCacheSize = 0;
  function bjorklund(k, n) {
    var key = k + ',' + n;
    var hit = euclidCache[key];
    if (hit) return hit;
    var out = [], i, g;
    if (k <= 0) { for (i = 0; i < n; i++) out.push(0); }
    else if (k >= n) { for (i = 0; i < n; i++) out.push(1); }
    else {
      var a = [], b = [];
      for (i = 0; i < k; i++) a.push([1]);
      for (i = 0; i < n - k; i++) b.push([0]);
      while (b.length > 1) {
        var m = Math.min(a.length, b.length);
        var na = [];
        for (i = 0; i < m; i++) na.push(a[i].concat(b[i]));
        var rest = a.length > m ? a.slice(m) : b.slice(m);
        a = na;
        b = rest;
      }
      var groups = a.concat(b);
      for (g = 0; g < groups.length; g++) for (i = 0; i < groups[g].length; i++) out.push(groups[g][i]);
    }
    if (euclidCacheSize < 1024) { euclidCache[key] = out; euclidCacheSize++; }
    return out;
  }

  // euclid(k, n, rot=0) → fresh array of n entries in {0,1} with k onsets spread as evenly
  // as possible (Bjorklund; the unrotated pattern starts with an onset).
  // rot rotates LEFT: result[i] = base[(i + rot) mod n] (Tidal-style); negative rot rotates right.
  function euclid(k, n, rot) {
    n = toInt(n, 0);
    if (n <= 0) return [];
    if (n > MAX_EUCLID_N) n = MAX_EUCLID_N;
    k = toInt(k, 0);
    if (k < 0) k = 0;
    if (k > n) k = n;
    var r = toInt(rot, 0) % n;
    if (r < 0) r += n;
    var base = bjorklund(k, n);
    var res = new Array(n);
    for (var i = 0; i < n; i++) res[i] = base[(i + r) % n];
    return res;
  }

  // ---------------------------------------------------------------- lsystem
  // lsystem(axiom, rules, iters, maxLen=50000) → string. rules maps single characters to
  // replacement strings; characters without a rule are copied. Growth stops (and the result
  // is truncated) as soon as the string would exceed maxLen.
  function lsystem(axiom, rules, iters, maxLen) {
    var s = axiom == null ? '' : String(axiom);
    var n = toInt(iters, 0);
    if (n < 0) n = 0;
    if (n > MAX_LSYSTEM_ITERS) n = MAX_LSYSTEM_ITERS;
    var cap = toInt(maxLen, 50000);
    if (cap <= 0) cap = 50000;
    if (s.length > cap) return s.slice(0, cap);
    var table = {}, any = false, key;
    if (rules && typeof rules === 'object') {
      for (key in rules) {
        if (Object.prototype.hasOwnProperty.call(rules, key) && key.length === 1 && rules[key] != null) {
          table[key] = String(rules[key]);
          any = true;
        }
      }
    }
    if (!any) return s;
    for (var it = 0; it < n; it++) {
      var parts = [], len = 0, changed = false, full = false;
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        var piece = Object.prototype.hasOwnProperty.call(table, c) ? table[c] : c;
        if (piece !== c) changed = true;
        parts.push(piece);
        len += piece.length;
        if (len >= cap) { full = true; break; }
      }
      s = parts.join('');
      if (full || s.length >= cap) { s = s.slice(0, cap); break; }
      if (!changed) break;
    }
    return s;
  }

  // ---------------------------------------------------------------- turtle
  // turtle(str, {x=0, y=0, heading=-PI/2 (up), step=10, angle=PI/6, shrink=1})
  //   → {segs:[[x1,y1,x2,y2,depth]], leaves:[[x,y,heading]]}
  // F,G draw; f moves without drawing; + turns by +angle (clockwise on screen); - by -angle;
  // | turns around; [ pushes (depth+1, step*=shrink); ] records a leaf (if the branch moved)
  // and pops. The final turtle position is always recorded as a leaf. Other chars are ignored.
  function turtle(str, o) {
    o = o || {};
    var x = num(o.x, 0), y = num(o.y, 0), h = num(o.heading, -Math.PI / 2);
    var len = num(o.step, 10), ang = num(o.angle, Math.PI / 6), shrink = num(o.shrink, 1);
    var segs = [], leaves = [], stack = [], depth = 0, moved = false;
    var s = str == null ? '' : String(str);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 70 || c === 71) {               // F G
        var nx = x + Math.cos(h) * len, ny = y + Math.sin(h) * len;
        segs.push([x, y, nx, ny, depth]);
        x = nx; y = ny; moved = true;
      } else if (c === 102) {                   // f
        x += Math.cos(h) * len; y += Math.sin(h) * len; moved = true;
      } else if (c === 43) {                    // +
        h += ang;
      } else if (c === 45) {                    // -
        h -= ang;
      } else if (c === 124) {                   // |
        h += Math.PI;
      } else if (c === 91) {                    // [
        stack.push(x, y, h, len, depth, moved ? 1 : 0);
        depth++; len *= shrink; moved = false;
      } else if (c === 93) {                    // ]
        if (stack.length) {
          if (moved) leaves.push([x, y, h]);
          moved = stack.pop() === 1;
          depth = stack.pop(); len = stack.pop(); h = stack.pop(); y = stack.pop(); x = stack.pop();
        }
      }
    }
    leaves.push([x, y, h]);
    return { segs: segs, leaves: leaves };
  }

  // ---------------------------------------------------------------- koch
  // koch(x1,y1,x2,y2,depth,outward=1) → flat [x,y,...] with 4^depth+1 points (both endpoints
  // included). outward=1 raises the bumps on the side of the normal (dy,-dx), i.e. UP for a
  // left-to-right segment; outward=-1 flips them. depth is clamped to 0..7.
  function koch(x1, y1, x2, y2, depth, outward) {
    var d = toInt(depth, 0);
    if (d < 0) d = 0;
    if (d > MAX_KOCH_DEPTH) d = MAX_KOCH_DEPTH;
    var sg = (typeof outward === 'number' && outward < 0) ? -1 : 1;
    var pts = [num(x1, 0), num(y1, 0), num(x2, 0), num(y2, 0)];
    for (var lv = 0; lv < d; lv++) {
      var segCount = pts.length / 2 - 1;
      var next = new Array(segCount * 8 + 2);
      var w = 0;
      for (var i = 0; i < pts.length - 2; i += 2) {
        var ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
        var dx = (bx - ax) / 3, dy = (by - ay) / 3;
        var px = ax + dx, py = ay + dy, qx = ax + 2 * dx, qy = ay + 2 * dy;
        next[w++] = ax; next[w++] = ay;
        next[w++] = px; next[w++] = py;
        next[w++] = (px + qx) * 0.5 + sg * dy * SQRT3_2;
        next[w++] = (py + qy) * 0.5 - sg * dx * SQRT3_2;
        next[w++] = qx; next[w++] = qy;
      }
      next[w++] = pts[pts.length - 2];
      next[w++] = pts[pts.length - 1];
      pts = next;
    }
    return pts;
  }

  // ---------------------------------------------------------------- sierpinski
  // sierpinski(cx,cy,size,depth) → 3^depth triangles [x1,y1,x2,y2,x3,y3] (apex, bottom-left,
  // bottom-right) of the gasket whose outer equilateral triangle has side `size`, apex up and
  // centroid at (cx,cy). depth is clamped to 0..8.
  function sierpinski(cx, cy, size, depth) {
    var d = toInt(depth, 0);
    if (d < 0) d = 0;
    if (d > MAX_SIERPINSKI_DEPTH) d = MAX_SIERPINSKI_DEPTH;
    var s = num(size, 0), x = num(cx, 0), y = num(cy, 0);
    var h = s * SQRT3_2;
    var out = [];
    var stack = [x, y - 2 * h / 3, x - s / 2, y + h / 3, x + s / 2, y + h / 3, d];
    while (stack.length) {
      var lv = stack.pop();
      var c3y = stack.pop(), c3x = stack.pop(), c2y = stack.pop(), c2x = stack.pop(), c1y = stack.pop(), c1x = stack.pop();
      if (lv === 0) { out.push([c1x, c1y, c2x, c2y, c3x, c3y]); continue; }
      var m12x = (c1x + c2x) / 2, m12y = (c1y + c2y) / 2;
      var m13x = (c1x + c3x) / 2, m13y = (c1y + c3y) / 2;
      var m23x = (c2x + c3x) / 2, m23y = (c2y + c3y) / 2;
      // pushed in reverse so output order is apex, bottom-left, bottom-right (depth first)
      stack.push(m13x, m13y, m23x, m23y, c3x, c3y, lv - 1);
      stack.push(m12x, m12y, c2x, c2y, m23x, m23y, lv - 1);
      stack.push(c1x, c1y, m12x, m12y, m13x, m13y, lv - 1);
    }
    return out;
  }

  // ---------------------------------------------------------------- voronoi
  // voronoi(sites[[x,y]], bbox[x,y,w,h]) → [{site, poly:flat, neighbors:[i]}] in input order.
  // Each cell is the site's region clipped to bbox, as a convex polygon whose vertices run
  // clockwise on screen. neighbors are indices of cells sharing an edge of non-zero length,
  // sorted ascending and symmetric. Coincident sites: the lowest index owns the cell, later
  // duplicates get an empty poly. Sites with non-finite coordinates get an empty poly.
  // Designed for n ≤ 256 (O(n² ) worst case with nearest-first early outs).
  function clipConvex(px, py, pl, a, b, c, tol, label) {
    var m = px.length, ox = [], oy = [], ol = [];
    for (var k = 0; k < m; k++) {
      var k2 = k + 1 === m ? 0 : k + 1;
      var x1 = px[k], y1 = py[k], x2 = px[k2], y2 = py[k2];
      var d1 = a * x1 + b * y1 - c, d2 = a * x2 + b * y2 - c;
      var in1 = d1 <= tol, in2 = d2 <= tol;
      if (in1) {
        ox.push(x1); oy.push(y1); ol.push(pl[k]);
        if (!in2) {
          var t = d1 / (d1 - d2);
          ox.push(x1 + (x2 - x1) * t); oy.push(y1 + (y2 - y1) * t); ol.push(label);
        }
      } else if (in2) {
        var t2 = d1 / (d1 - d2);
        ox.push(x1 + (x2 - x1) * t2); oy.push(y1 + (y2 - y1) * t2); ol.push(pl[k]);
      }
    }
    return [ox, oy, ol];
  }

  function voronoi(sites, bbox) {
    var n = sites && sites.length ? sites.length : 0;
    var bx = 0, by = 0, bw = 0, bh = 0;
    if (bbox) { bx = num(+bbox[0], 0); by = num(+bbox[1], 0); bw = num(+bbox[2], 0); bh = num(+bbox[3], 0); }
    var cells = new Array(n);
    if (!n) return cells;
    var scale = Math.max(1, Math.abs(bw), Math.abs(bh));
    var tol = 1e-9 * scale, lenEps = 1e-7 * scale, dupEps2 = (1e-9 * scale) * (1e-9 * scale);
    var sx = new Float64Array(n), sy = new Float64Array(n), ok = new Uint8Array(n);
    var i, j, k;
    for (i = 0; i < n; i++) {
      var s = sites[i];
      var x = s ? +s[0] : NaN, y = s ? +s[1] : NaN;
      if (x === x && y === y && x !== Infinity && x !== -Infinity && y !== Infinity && y !== -Infinity) { sx[i] = x; sy[i] = y; ok[i] = 1; }
    }
    var order = [], dist = new Float64Array(n);
    var sorter = function (p, q) { return dist[p] - dist[q] || p - q; };
    var nbSets = new Array(n);
    for (i = 0; i < n; i++) {
      nbSets[i] = [];
      cells[i] = { site: sites[i], poly: [], neighbors: [] };
      if (!ok[i] || !(bw > 0) || !(bh > 0)) continue;
      order.length = 0;
      for (j = 0; j < n; j++) {
        if (j === i || !ok[j]) continue;
        var ddx = sx[j] - sx[i], ddy = sy[j] - sy[i];
        dist[j] = ddx * ddx + ddy * ddy;
        order.push(j);
      }
      order.sort(sorter);
      var px = [bx, bx + bw, bx + bw, bx], py = [by, by, by + bh, by + bh], pl = [-1, -1, -1, -1];
      var maxR2 = 0;
      for (k = 0; k < 4; k++) {
        var vx = px[k] - sx[i], vy = py[k] - sy[i];
        if (vx * vx + vy * vy > maxR2) maxR2 = vx * vx + vy * vy;
      }
      var empty = false;
      for (k = 0; k < order.length; k++) {
        j = order[k];
        var d2 = dist[j];
        if (d2 <= dupEps2) { if (j < i) { empty = true; break; } continue; }
        if (d2 > 4 * maxR2 + tol) break;
        var a = sx[j] - sx[i], b = sy[j] - sy[i];
        var c = a * (sx[i] + sx[j]) * 0.5 + b * (sy[i] + sy[j]) * 0.5;
        var res = clipConvex(px, py, pl, a, b, c, tol * Math.sqrt(d2), j);
        px = res[0]; py = res[1]; pl = res[2];
        if (px.length < 3) { empty = true; break; }
        maxR2 = 0;
        for (var q = 0; q < px.length; q++) {
          var wx = px[q] - sx[i], wy = py[q] - sy[i];
          if (wx * wx + wy * wy > maxR2) maxR2 = wx * wx + wy * wy;
        }
      }
      if (empty) continue;
      // drop near-duplicate consecutive vertices (keeps the later edge's label)
      var fx = [], fy = [], fl = [];
      for (k = 0; k < px.length; k++) {
        var kn = k + 1 === px.length ? 0 : k + 1;
        var ex = px[kn] - px[k], ey = py[kn] - py[k];
        if (ex * ex + ey * ey <= lenEps * lenEps) continue;
        fx.push(px[k]); fy.push(py[k]); fl.push(pl[k]);
      }
      if (fx.length < 3) continue;
      var poly = new Array(fx.length * 2);
      for (k = 0; k < fx.length; k++) {
        poly[k * 2] = fx[k]; poly[k * 2 + 1] = fy[k];
        if (fl[k] >= 0 && nbSets[i].indexOf(fl[k]) < 0) nbSets[i].push(fl[k]);
      }
      cells[i].poly = poly;
    }
    // symmetrize (guards against floating-point disagreement on near-degenerate edges)
    for (i = 0; i < n; i++) {
      for (k = 0; k < nbSets[i].length; k++) {
        j = nbSets[i][k];
        if (cells[j].poly.length && nbSets[j].indexOf(i) < 0) nbSets[j].push(i);
      }
    }
    for (i = 0; i < n; i++) {
      var list = [];
      if (cells[i].poly.length) {
        for (k = 0; k < nbSets[i].length; k++) if (cells[nbSets[i][k]].poly.length) list.push(nbSets[i][k]);
        list.sort(function (p, q) { return p - q; });
      }
      cells[i].neighbors = list;
    }
    return cells;
  }

  // ---------------------------------------------------------------- truchet
  // truchet(tx,ty,seed) → 0..3, a deterministic, well-mixed tile orientation.
  function truchet(tx, ty, seed) {
    return (hash3(tx | 0, ty | 0, seed | 0) >>> 13) & 3;
  }

  // ---------------------------------------------------------------- lissajous (≡ AP.Path.liss)
  // p = {cx, cy, ax, ay, fx, fy, phase (rad), period (s)}
  // x = cx + ax*sin(fx*w*t + phase), y = cy + ay*sin(fy*w*t), w = 2π/period
  function lissajous(t, p, out) {
    if (!out) out = { x: 0, y: 0 };
    if (!p) { out.x = 0; out.y = 0; return out; }
    var period = num(p.period, 1);
    var w = period > 0 ? TAU / period : 0;
    var tt = num(t, 0);
    out.x = num(p.cx, 0) + num(p.ax, 0) * Math.sin(num(p.fx, 1) * w * tt + num(p.phase, 0));
    out.y = num(p.cy, 0) + num(p.ay, 0) * Math.sin(num(p.fy, 1) * w * tt);
    return out;
  }

  // ---------------------------------------------------------------- harmonograph
  // Damped pendulum sum. Either
  //   p = {cx, cy, x:[[amp, freqHz, phaseRad, damp], ...], y:[[...], ...]}
  // or the classic four-pendulum fields
  //   p = {cx, cy, a1,f1,p1,d1, a2,f2,p2,d2 (x),  a3,f3,p3,d3, a4,f4,p4,d4 (y)}
  // term = amp * sin(2π*freq*t + phase) * exp(-damp*t). Missing fields are 0.
  function hterm(a, f, ph, d, t) {
    a = num(a, 0);
    if (a === 0) return 0;
    return a * Math.sin(TAU * num(f, 0) * t + num(ph, 0)) * Math.exp(-num(d, 0) * t);
  }
  function hsum(list, t) {
    var s = 0;
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (q) s += hterm(q[0], q[1], q[2], q[3], t);
    }
    return s;
  }
  function harmonograph(t, p, out) {
    if (!out) out = { x: 0, y: 0 };
    var tt = num(t, 0);
    if (!p) { out.x = 0; out.y = 0; return out; }
    var x = num(p.cx, 0), y = num(p.cy, 0);
    if (p.x && typeof p.x.length === 'number') x += hsum(p.x, tt);
    else x += hterm(p.a1, p.f1, p.p1, p.d1, tt) + hterm(p.a2, p.f2, p.p2, p.d2, tt);
    if (p.y && typeof p.y.length === 'number') y += hsum(p.y, tt);
    else y += hterm(p.a3, p.f3, p.p3, p.d3, tt) + hterm(p.a4, p.f4, p.p4, p.d4, tt);
    out.x = x; out.y = y;
    return out;
  }

  // ---------------------------------------------------------------- phyllo
  // phyllo(i,c,out) → out{x,y,r,a}: Vogel's model, r = c*sqrt(i), a = i*2.39996323 (golden
  // angle in radians), relative to the origin (add your own centre).
  function phyllo(i, c, out) {
    if (!out) out = { x: 0, y: 0, r: 0, a: 0 };
    var ii = num(i, 0);
    var r = num(c, 0) * Math.sqrt(ii > 0 ? ii : 0), a = ii * GOLDEN_ANGLE;
    out.x = r * Math.cos(a);
    out.y = r * Math.sin(a);
    out.r = r;
    out.a = a;
    return out;
  }

  // ---------------------------------------------------------------- poisson
  // poisson(w,h,r,rng,k=30) → [[x,y]] blue-noise points in [0,w)×[0,h) with every pair at
  // least r apart (Bridson). rng: AP.RNG instance, a [0,1) function or a numeric seed;
  // deterministic for a given rng state. Capped at 60000 points.
  function poisson(w, h, r, rng, k) {
    w = num(w, 0); h = num(h, 0); r = num(r, 0);
    if (!(w > 0 && h > 0 && r > 0)) return [];
    var tries = toInt(k, 30);
    if (tries <= 0) tries = 30;
    var next = rngFunction(rng);
    var cell = r / Math.SQRT2;
    var gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    if (gw * gh > MAX_POISSON_CELLS) return [];
    var grid = new Int32Array(gw * gh);
    for (var g = 0; g < grid.length; g++) grid[g] = -1;
    var pts = [], active = [], r2 = r * r;
    function fits(x, y) {
      var gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      var x0 = gx - 2 < 0 ? 0 : gx - 2, x1 = gx + 2 >= gw ? gw - 1 : gx + 2;
      var y0 = gy - 2 < 0 ? 0 : gy - 2, y1 = gy + 2 >= gh ? gh - 1 : gy + 2;
      for (var yy = y0; yy <= y1; yy++) {
        for (var xx = x0; xx <= x1; xx++) {
          var id = grid[yy * gw + xx];
          if (id >= 0) {
            var dx = pts[id][0] - x, dy = pts[id][1] - y;
            if (dx * dx + dy * dy < r2) return false;
          }
        }
      }
      return true;
    }
    function add(x, y) {
      var id = pts.length;
      pts.push([x, y]);
      active.push(id);
      grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = id;
    }
    add(next() * w, next() * h);
    while (active.length && pts.length < MAX_POISSON_POINTS) {
      var ai = Math.floor(next() * active.length);
      if (ai >= active.length) ai = active.length - 1;
      var p = pts[active[ai]];
      var found = false;
      for (var t = 0; t < tries; t++) {
        var ang = next() * TAU, rad = r * (1 + next());
        var x = p[0] + Math.cos(ang) * rad, y = p[1] + Math.sin(ang) * rad;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (fits(x, y)) { add(x, y); found = true; break; }
      }
      if (!found) {
        active[ai] = active[active.length - 1];
        active.pop();
      }
    }
    return pts;
  }

  AP.Algo = {
    euclid: euclid,
    lsystem: lsystem,
    turtle: turtle,
    koch: koch,
    sierpinski: sierpinski,
    voronoi: voronoi,
    truchet: truchet,
    lissajous: lissajous,
    harmonograph: harmonograph,
    phyllo: phyllo,
    poisson: poisson
  };
})(window.AP = window.AP || {});
