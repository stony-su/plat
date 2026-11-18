/* js/core/path.js — owner: CORE */
(function (AP) {
  'use strict';

  // Stateless path helpers: an entity computes its position from time alone.

  function segLen(pts, i, j) {
    var dx = pts[j][0] - pts[i][0];
    var dy = pts[j][1] - pts[i][1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Open polyline length (pass closed=true to include the closing segment).
  function length(pts, closed) {
    if (!pts || pts.length < 2) return 0;
    var L = 0;
    for (var i = 0; i < pts.length - 1; i++) L += segLen(pts, i, i + 1);
    if (closed) L += segLen(pts, pts.length - 1, 0);
    return L;
  }

  function setOut(out, x, y, i, dir, waiting) {
    out.x = x;
    out.y = y;
    out.i = i;
    out.dir = dir;
    out.wait = waiting;
    return out;
  }

  // pts: world [[x,y],...]; speed u/s; mode 'loop'|'pingpong'|'once'; t seconds; wait seconds at every vertex.
  // out {x, y, i (index of the vertex last left / waited at), dir (+1 forward, -1 backward), wait (bool)}
  function poly(pts, speed, mode, t, out, wait) {
    out = out || { x: 0, y: 0, i: 0, dir: 1, wait: false };
    wait = (wait > 0) ? wait : 0;
    var n = pts ? pts.length : 0;
    if (n === 0) return setOut(out, 0, 0, 0, 1, false);
    if (n === 1 || !(speed > 0)) return setOut(out, pts[0][0], pts[0][1], 0, 1, true);
    if (!(t >= 0)) t = 0;
    var i, d, seg;
    if (mode === 'loop') {
      var per = 0;
      for (i = 0; i < n; i++) per += wait + segLen(pts, i, (i + 1) % n) / speed;
      if (per <= 0) return setOut(out, pts[0][0], pts[0][1], 0, 1, true);
      var tl = t % per;
      for (i = 0; i < n; i++) {
        if (tl < wait) return setOut(out, pts[i][0], pts[i][1], i, 1, true);
        tl -= wait;
        var j = (i + 1) % n;
        seg = segLen(pts, i, j) / speed;
        if (tl < seg || i === n - 1) {
          d = seg > 0 ? Math.min(1, tl / seg) : 1;
          return setOut(out, pts[i][0] + (pts[j][0] - pts[i][0]) * d, pts[i][1] + (pts[j][1] - pts[i][1]) * d, i, 1, false);
        }
        tl -= seg;
      }
      return setOut(out, pts[0][0], pts[0][1], 0, 1, true);
    }
    if (mode === 'once') {
      var tt = t;
      for (i = 0; i < n - 1; i++) {
        if (tt < wait) return setOut(out, pts[i][0], pts[i][1], i, 1, true);
        tt -= wait;
        seg = segLen(pts, i, i + 1) / speed;
        if (tt < seg) {
          d = seg > 0 ? tt / seg : 1;
          return setOut(out, pts[i][0] + (pts[i + 1][0] - pts[i][0]) * d, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * d, i, 1, false);
        }
        tt -= seg;
      }
      return setOut(out, pts[n - 1][0], pts[n - 1][1], n - 1, 1, true);
    }
    // pingpong (default): visits 0,1,...,n-1,n-2,...,1 then repeats; every visit waits `wait`
    var travel = length(pts) / speed;
    var perPP = 2 * travel + 2 * (n - 1) * wait;
    if (perPP <= 0) return setOut(out, pts[0][0], pts[0][1], 0, 1, true);
    var tp = t % perPP;
    var half = travel + (n - 1) * wait;
    var forward = tp < half;
    if (!forward) tp -= half;
    for (var k = 0; k < n - 1; k++) {
      var a = forward ? k : n - 1 - k;
      var b = forward ? a + 1 : a - 1;
      if (tp < wait) return setOut(out, pts[a][0], pts[a][1], a, forward ? 1 : -1, true);
      tp -= wait;
      seg = segLen(pts, a, b) / speed;
      if (tp < seg || k === n - 2) {
        d = seg > 0 ? Math.min(1, tp / seg) : 1;
        return setOut(out, pts[a][0] + (pts[b][0] - pts[a][0]) * d, pts[a][1] + (pts[b][1] - pts[a][1]) * d, a, forward ? 1 : -1, false);
      }
      tp -= seg;
    }
    return setOut(out, pts[0][0], pts[0][1], 0, 1, true);
  }

  // x = cx + ax*sin(fx*w*t + phase), y = cy + ay*sin(fy*w*t), w = 2*PI/period
  function liss(p, t, out) {
    out = out || { x: 0, y: 0 };
    var w = (Math.PI * 2) / (p.period > 0 ? p.period : 1);
    out.x = p.cx + p.ax * Math.sin(p.fx * w * t + (p.phase || 0));
    out.y = p.cy + p.ay * Math.sin(p.fy * w * t);
    return out;
  }

  // spec {ax, ay (tiles), fx, fy (ints), phase (deg), period (s)} anchored at world point (anchorX, anchorY)
  function lissFromSpec(spec, anchorX, anchorY) {
    var s = spec || {};
    return {
      cx: anchorX || 0,
      cy: anchorY || 0,
      ax: (+s.ax || 0) * 32,
      ay: (+s.ay || 0) * 32,
      fx: (s.fx === undefined ? 1 : +s.fx) || 0,
      fy: (s.fy === undefined ? 1 : +s.fy) || 0,
      phase: (+s.phase || 0) * Math.PI / 180,
      period: (+s.period > 0) ? +s.period : 4
    };
  }

  // phase in radians; positive angles are clockwise on screen (+y down)
  function circle(cx, cy, r, period, t, phase, out) {
    out = out || { x: 0, y: 0 };
    var a = (Math.PI * 2) * t / (period > 0 ? period : 1) + (phase || 0);
    out.x = cx + r * Math.cos(a);
    out.y = cy + r * Math.sin(a);
    return out;
  }

  AP.Path = { poly: poly, length: length, liss: liss, lissFromSpec: lissFromSpec, circle: circle };
})(window.AP = window.AP || {});
