/* js/art/tileart.js — owner: ART */
(function (AP) {
  'use strict';

  // AP.TileArt (CONTRACT 2.8): a chunked offscreen cache of a level's static tiles.
  //  - CHUNK x CHUNK u squares, LRU-capped at CHUNK_CACHE, canvas resolution min(AP.R.px, CHUNK_PX_MAX)
  //    (snapped so a chunk is a whole number of pixels), plus a 2 px apron of real content so that
  //    scaled blits never show seams.
  //  - At most 2 chunk (re)builds per drawn frame, nearest the view centre first, then one ring of
  //    prefetch. A chunk that cannot be rebuilt yet draws its stale canvas; a chunk that has no canvas
  //    yet is drawn live with a lite vector pass (no ornament), so terrain is never missing.
  //  - Every visible chunk re-verifies a checksum of its tile window each frame, so terrain changes
  //    reach the screen even if an invalidate() call was missed (restoreTiles, secrets, bosses).
  //  - Solid mass (SOLID and FAKE, drawn identically): contour-traced marching-squares outline with
  //    chamfered convex corners, an opaque tinted body, a per-style algorithmic fill clipped to the
  //    mass, an inner glow band and a glowing pal.primary edge line.
  //  - BREAK: individual inset, cracked blocks (lattice / crystal / stone / bark / rings per style).
  //  - ONEWAY: 8u top bars with end caps. Spikes: pal.hazard teeth whose silhouette is the hurtbox.
  //  - Out of bounds counts as SOLID left/right/top and EMPTY below (same as L.tileAt).

  var TILE = AP.TILE || { EMPTY: 0, SOLID: 1, ONEWAY: 2, SPIKE_U: 3, SPIKE_D: 4, SPIKE_L: 5, SPIKE_R: 6, BREAK: 7, FAKE: 8 };
  var KC = AP.C || {};
  var TS = KC.T || 32;
  var CHUNK = KC.CHUNK || 256;
  var CACHE_MAX = KC.CHUNK_CACHE || 48;
  var PX_MAX = KC.CHUNK_PX_MAX || 2;
  var SPK_D = KC.SPIKE_DEPTH || 14;
  var SPK_IN = KC.SPIKE_INSET || 3;
  var OW_H = KC.ONEWAY_THICK || 8;
  var TPC = Math.max(1, Math.round(CHUNK / TS));   // tiles per chunk side (8)
  var MG = 2;                                       // window margin (tiles) around a chunk
  var GW = TPC + 2 * MG + 2;                        // window side incl. the EMPTY sentinel frame
  var NC = GW + 1;                                  // lattice corners per window side
  var SUM_M = 1;                                    // tiles beyond the chunk that can change its pixels
  var PADPX = 2;                                    // device-pixel apron around each chunk canvas
  var BUILD_BUDGET = 2;                             // CONTRACT: at most 2 chunk builds per frame
  var PREFETCH_BUDGET = 1;                          // of which at most 1 may be an off-screen prefetch
  var PREBUILD_MAX = 16;
  var CHAMFER = 6;
  var TAU = Math.PI * 2;
  var HALF_PI = Math.PI / 2;
  var EMPTY = TILE.EMPTY, SOLID = TILE.SOLID, ONEWAY = TILE.ONEWAY, BREAK = TILE.BREAK, FAKE = TILE.FAKE;
  var SPK_U = TILE.SPIKE_U, SPK_DN = TILE.SPIKE_D, SPK_L = TILE.SPIKE_L, SPK_R = TILE.SPIKE_R;
  var FALLBACK_PAL = { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' };

  // ------------------------------------------------------------------ small helpers
  function num(v, d) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d; }

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
  function hf(x, y, s) { return hash3(x, y, s) / 4294967296; }

  function mix(a, b, t) {
    var C = AP.Color;
    if (C && typeof C.mix === 'function') return C.mix(a, b, t);
    var U = AP.Art && AP.Art.util;
    if (U && typeof U.mixHex === 'function') return U.mixHex(a, b, t);
    return a;
  }
  function rgba(hex, a) {
    var C = AP.Color;
    if (C && typeof C.rgba === 'function') return C.rgba(hex, a);
    var U = AP.Art && AP.Art.util;
    if (U && typeof U.rgba === 'function') return U.rgba(hex, a);
    return hex;
  }
  function noise2(x, y) {
    var N = AP.Noise;
    if (N && typeof N.n2 === 'function') return N.n2(x, y);
    var U = AP.Art && AP.Art.util;
    if (U && typeof U.simplex2 === 'function') return U.simplex2(x, y);
    return Math.sin(x * 1.7 + Math.sin(y * 1.3)) * Math.cos(y * 1.1 - Math.sin(x * 0.9));
  }
  function truchetK(i, j, seed) {
    var A = AP.Algo;
    if (A && typeof A.truchet === 'function') return A.truchet(i, j, seed) & 1;
    return (hash3(i, j, seed) >>> 13) & 1;
  }

  function palOf(L) {
    if (L && L.pal && L.pal.primary && L.pal.bg) return L.pal;
    var key = L && L.style;
    var W = AP.Worlds;
    if (W && typeof W.pal === 'function') { var p = W.pal(key); if (p && p.primary) return p; }
    var R = AP.R;
    if (R && typeof R.pal === 'function') { var q = R.pal(key); if (q && q.primary) return q; }
    return FALLBACK_PAL;
  }

  // tile code with the CONTRACT out-of-bounds rule
  function tcode(L, tx, ty) {
    if (ty >= L.h) return EMPTY;
    if (tx < 0 || tx >= L.w || ty < 0) return SOLID;
    return L.tiles[ty * L.w + tx] | 0;
  }
  function isMass(c) { return c === SOLID || c === FAKE; }

  // ------------------------------------------------------------------ module state
  var st = {
    L: null, tiles: null, w: 0, h: 0, seed: 0,
    styleKey: '', sty: null, pal: null, palSig: '', cc: null,
    chunks: new Map(), frame: 0, res: 0, side: 0,
    budget: 0, builds: 0, live: 0, totalBuilds: 0,
    noCanvas: false, broken: false, pool: []
  };

  function ckey(cx, cy) { return (cy + 8) * 8192 + (cx + 8); }

  function targetRes() {
    var R = AP.R;
    var px = R && typeof R.px === 'number' && R.px > 0 ? R.px : 1;
    var r = Math.round(CHUNK * Math.min(px, PX_MAX)) / CHUNK;
    return r >= 0.25 ? r : 0.25;
  }

  function makeCanvas(n) {
    var U = AP.Art && AP.Art.util;
    if (U && typeof U.makeCanvas === 'function') return U.makeCanvas(n, n);
    try {
      if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
        var c = document.createElement('canvas');
        c.width = n; c.height = n;
        return c;
      }
    } catch (e) { /* no DOM */ }
    return null;
  }
  function ctx2d(c) {
    if (!c || typeof c.getContext !== 'function') return null;
    try { return c.getContext('2d') || null; } catch (e) { return null; }
  }

  function release(e) {
    if (e.canvas) {
      if (e.side === st.side && st.pool.length < 16) st.pool.push({ canvas: e.canvas, ctx: e.ctx, side: e.side });
      else { try { e.canvas.width = 1; e.canvas.height = 1; } catch (er) { /* ignore */ } }
    }
    e.canvas = null; e.ctx = null; e.ok = false;
  }
  function acquire(e) {
    while (st.pool.length) {
      var p = st.pool.pop();
      if (p.canvas && p.side === st.side) {
        e.canvas = p.canvas; e.ctx = p.ctx; e.side = p.side;
        p.canvas = null; p.ctx = null;
        return true;
      }
    }
    var c = makeCanvas(st.side);
    var x = ctx2d(c);
    if (!c || !x) return false;
    e.canvas = c; e.ctx = x; e.side = st.side;
    return true;
  }

  function dropAll() {
    st.chunks.forEach(release);
    st.chunks.clear();
  }

  function evictOne() {
    var worst = null;
    for (var e of st.chunks.values()) {
      if (e.used < st.frame && (!worst || e.used < worst.used)) worst = e;
    }
    if (!worst) return;
    release(worst);
    st.chunks.delete(worst.key);
  }

  function entry(cx, cy, create) {
    var k = ckey(cx, cy), e = st.chunks.get(k);
    if (e || !create) return e || null;
    if (st.chunks.size >= CACHE_MAX) evictOne();
    e = { cx: cx, cy: cy, key: k, canvas: null, ctx: null, side: 0, res: 0, ok: false, dirty: true, sum: 0, used: st.frame };
    st.chunks.set(k, e);
    return e;
  }

  // checksum of the tiles that can change a chunk's pixels (chunk + 1 tile)
  function windowSum(L, cx, cy) {
    var h = 0x811C9DC5 | 0;
    var tx0 = cx * TPC - SUM_M, ty0 = cy * TPC - SUM_M, n = TPC + 2 * SUM_M;
    for (var j = 0; j < n; j++) {
      var ty = ty0 + j;
      for (var i = 0; i < n; i++) h = Math.imul(h ^ (tcode(L, tx0 + i, ty) + 1), 16777619);
    }
    return h >>> 0;
  }

  // ------------------------------------------------------------------ marching-squares mass outline
  var grid = new Uint8Array(GW * GW);
  var outA = new Int8Array(NC * NC);
  var outB = new Int8Array(NC * NC);
  var usedE = new Uint8Array(NC * NC * 4);
  var DX = [1, 0, -1, 0];   // E S W N
  var DY = [0, 1, 0, -1];
  var LOOP_CAP = 8192;
  var loopXY = new Float32Array(LOOP_CAP);
  var loopEnd = new Int32Array(1024);
  var nLoops = 0;

  function fillWindow(L, gx0, gy0) {
    for (var j = 0; j < GW; j++) {
      for (var i = 0; i < GW; i++) {
        grid[j * GW + i] = (i === 0 || j === 0 || i === GW - 1 || j === GW - 1) ? EMPTY : tcode(L, gx0 + i, gy0 + j);
      }
    }
  }

  function addEdge(c, d) { if (outA[c] < 0) outA[c] = d; else outB[c] = d; }

  // Directed boundary edges keep the mass on their right (clockwise around solids, y down). At a
  // saddle corner the walk always turns right, so diagonal neighbours stay separate shapes. Right
  // turns are convex corners and get chamfered; left turns (concave) stay sharp, so the drawn
  // terrain never covers space the player can occupy.
  function traceMass(ox, oy) {
    var i, j, c, k;
    for (c = 0; c < NC * NC; c++) { outA[c] = -1; outB[c] = -1; }
    usedE.fill(0);
    for (j = 1; j < GW - 1; j++) {
      for (i = 1; i < GW - 1; i++) {
        if (!isMass(grid[j * GW + i])) continue;
        if (!isMass(grid[(j - 1) * GW + i])) addEdge(j * NC + i, 0);
        if (!isMass(grid[j * GW + i + 1])) addEdge(j * NC + i + 1, 1);
        if (!isMass(grid[(j + 1) * GW + i])) addEdge((j + 1) * NC + i + 1, 2);
        if (!isMass(grid[j * GW + i - 1])) addEdge((j + 1) * NC + i, 3);
      }
    }
    var np = 0;
    nLoops = 0;
    for (c = 0; c < NC * NC; c++) {
      for (k = 0; k < 2; k++) {
        var d0 = k ? outB[c] : outA[c];
        if (d0 < 0 || usedE[c * 4 + d0]) continue;
        var cur = c, d = d0, start = np, guard = 0;
        while (guard++ < NC * NC * 4) {
          usedE[cur * 4 + d] = 1;
          var nx = (cur % NC) + DX[d], ny = ((cur / NC) | 0) + DY[d], nxt = ny * NC + nx;
          var a = outA[nxt], b = outB[nxt], nd, rt = (d + 1) & 3;
          if (b < 0) nd = a; else nd = (a === rt || b === rt) ? rt : a;
          if (nd < 0) break;
          if (nd !== d && np + 4 <= LOOP_CAP) {
            var vx = ox + nx * TS, vy = oy + ny * TS;
            if (nd === rt) {
              loopXY[np++] = vx - DX[d] * CHAMFER; loopXY[np++] = vy - DY[d] * CHAMFER;
              loopXY[np++] = vx + DX[nd] * CHAMFER; loopXY[np++] = vy + DY[nd] * CHAMFER;
            } else {
              loopXY[np++] = vx; loopXY[np++] = vy;
            }
          }
          if (usedE[nxt * 4 + nd]) break;
          cur = nxt; d = nd;
        }
        if (np - start >= 6 && nLoops < loopEnd.length) loopEnd[nLoops++] = np;
        else np = start;
      }
    }
  }

  function massPath(c) {
    c.beginPath();
    var s = 0;
    for (var l = 0; l < nLoops; l++) {
      var e = loopEnd[l];
      c.moveTo(loopXY[s], loopXY[s + 1]);
      for (var q = s + 2; q < e; q += 2) c.lineTo(loopXY[q], loopXY[q + 1]);
      c.closePath();
      s = e;
    }
  }

  // ------------------------------------------------------------------ fills (world space, mass-clipped)
  function arcPair(c, x, y, S, k, r) {
    if (k === 0) {
      c.moveTo(x + r, y); c.arc(x, y, r, 0, HALF_PI);
      c.moveTo(x + S - r, y + S); c.arc(x + S, y + S, r, Math.PI, Math.PI * 1.5);
    } else {
      c.moveTo(x + S, y + r); c.arc(x + S, y, r, HALF_PI, Math.PI);
      c.moveTo(x, y + S - r); c.arc(x, y + S, r, Math.PI * 1.5, TAU);
    }
  }

  // w1: woven Truchet ribbons. An under-lattice offset by half a cell, then over-ribbons whose
  // body-coloured gap hides the under-lattice where they cross.
  function fillTruchet(c, X0, Y0, X1, Y1, seed, pal, cc) {
    var S = 20, H = 10, i, j;
    var i0 = Math.floor(X0 / S) - 1, i1 = Math.floor(X1 / S) + 1, j0 = Math.floor(Y0 / S) - 1, j1 = Math.floor(Y1 / S) + 1;
    c.beginPath();
    for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) arcPair(c, i * S + H, j * S + H, S, truchetK(i, j, seed ^ 0x2F1), H);
    c.strokeStyle = cc.patC; c.lineWidth = 1; c.stroke();
    c.beginPath();
    for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) arcPair(c, i * S, j * S, S, truchetK(i, j, seed), H);
    c.strokeStyle = cc.bodySolid; c.lineWidth = 9; c.stroke();
    c.beginPath();
    for (j = j0; j <= j1; j++) {
      for (i = i0; i <= i1; i++) {
        var k = truchetK(i, j, seed);
        arcPair(c, i * S, j * S, S, k, H - 3);
        arcPair(c, i * S, j * S, S, k, H + 3);
      }
    }
    c.strokeStyle = cc.patA; c.lineWidth = 0.9; c.stroke();
    // knots: a faint gold bead where four ribbons meet on the coarse grid
    c.beginPath();
    for (j = j0; j <= j1; j += 2) {
      for (i = i0; i <= i1; i += 2) {
        if ((hash3(i, j, seed ^ 0x77) & 7) !== 0) continue;
        var bx = i * S + H, by = j * S;
        c.moveTo(bx + 1.3, by); c.arc(bx, by, 1.3, 0, TAU);
      }
    }
    c.fillStyle = cc.acc; c.fill();
  }

  // w2: Voronoi facets. Jittered-grid sites, exact cells by half-plane clipping against the 5x5
  // neighbourhood, each facet fan-shaded by a slowly turning key light, glints at a few sites.
  var VCS = 30;
  var polyA = new Float64Array(128), polyB = new Float64Array(128);
  var triBuf = new Float32Array(12000);
  var triLvl = new Uint8Array(2000);
  var cellBuf = new Float32Array(12000);
  var cellEnd = new Int32Array(1000);

  function siteX(i, j, seed) { return (i + 0.12 + 0.76 * hf(i, j, seed)) * VCS; }
  function siteY(i, j, seed) { return (j + 0.12 + 0.76 * hf(i, j, seed ^ 0x51ED)) * VCS; }

  function clipInto(src, n, dst, a, b, cv) {
    var m = 0;
    for (var k = 0; k < n; k++) {
      var k2 = k + 1 === n ? 0 : k + 1;
      var x1 = src[k * 2], y1 = src[k * 2 + 1], x2 = src[k2 * 2], y2 = src[k2 * 2 + 1];
      var d1 = a * x1 + b * y1 - cv, d2 = a * x2 + b * y2 - cv;
      if (d1 <= 0 && m < 62) { dst[m * 2] = x1; dst[m * 2 + 1] = y1; m++; }
      if ((d1 <= 0) !== (d2 <= 0) && m < 62) {
        var t = d1 / (d1 - d2);
        dst[m * 2] = x1 + (x2 - x1) * t; dst[m * 2 + 1] = y1 + (y2 - y1) * t; m++;
      }
    }
    return m;
  }

  function fillVoronoi(c, X0, Y0, X1, Y1, seed, pal, cc) {
    var i0 = Math.floor(X0 / VCS) - 1, i1 = Math.floor(X1 / VCS) + 1, j0 = Math.floor(Y0 / VCS) - 1, j1 = Math.floor(Y1 / VCS) + 1;
    var nt = 0, ncell = 0, cp = 0, i, j, k, q, light = -2.25 + (seed % 7) * 0.13;
    for (j = j0; j <= j1; j++) {
      for (i = i0; i <= i1; i++) {
        var sx = siteX(i, j, seed), sy = siteY(i, j, seed), R2 = VCS * 2.2;
        var src = polyA, dst = polyB, n = 4;
        src[0] = sx - R2; src[1] = sy - R2; src[2] = sx + R2; src[3] = sy - R2;
        src[4] = sx + R2; src[5] = sy + R2; src[6] = sx - R2; src[7] = sy + R2;
        for (var dj = -2; dj <= 2 && n >= 3; dj++) {
          for (var di = -2; di <= 2 && n >= 3; di++) {
            if (!di && !dj) continue;
            var ox = siteX(i + di, j + dj, seed), oy = siteY(i + di, j + dj, seed);
            n = clipInto(src, n, dst, ox - sx, oy - sy, (ox * ox + oy * oy - sx * sx - sy * sy) * 0.5);
            var tmp = src; src = dst; dst = tmp;
          }
        }
        if (n < 3) continue;
        if (ncell >= cellEnd.length || cp + n * 2 + 2 > cellBuf.length) continue;
        cellBuf[cp++] = sx; cellBuf[cp++] = sy;
        for (k = 0; k < n * 2; k++) cellBuf[cp++] = src[k];
        cellEnd[ncell++] = cp;
        for (k = 0; k < n; k++) {
          if (nt >= triLvl.length) break;
          var k2 = k + 1 === n ? 0 : k + 1;
          var ax = src[k * 2], ay = src[k * 2 + 1], bx = src[k2 * 2], by = src[k2 * 2 + 1];
          var lit = 0.5 + 0.5 * Math.cos(Math.atan2((ay + by) * 0.5 - sy, (ax + bx) * 0.5 - sx) - light);
          var lv = Math.min(3, Math.floor(lit * lit * 4 + hf(i * 7 + k, j, seed) * 0.6));
          q = nt * 6;
          triBuf[q] = sx; triBuf[q + 1] = sy; triBuf[q + 2] = ax; triBuf[q + 3] = ay; triBuf[q + 4] = bx; triBuf[q + 5] = by;
          triLvl[nt++] = lv;
        }
      }
    }
    for (var lvl = 0; lvl < 4; lvl++) {
      c.beginPath();
      for (q = 0; q < nt; q++) {
        if (triLvl[q] !== lvl) continue;
        var b6 = q * 6;
        c.moveTo(triBuf[b6], triBuf[b6 + 1]); c.lineTo(triBuf[b6 + 2], triBuf[b6 + 3]); c.lineTo(triBuf[b6 + 4], triBuf[b6 + 5]); c.closePath();
      }
      c.fillStyle = cc.facet[lvl]; c.fill();
    }
    // spokes (site to vertices), then cell outlines
    var s0 = 0;
    c.beginPath();
    for (k = 0; k < ncell; k++) {
      var e = cellEnd[k], cx = cellBuf[s0], cy = cellBuf[s0 + 1];
      for (q = s0 + 2; q < e; q += 2) { c.moveTo(cx, cy); c.lineTo(cellBuf[q], cellBuf[q + 1]); }
      s0 = e;
    }
    c.strokeStyle = cc.patD; c.lineWidth = 0.6; c.stroke();
    s0 = 0;
    c.beginPath();
    for (k = 0; k < ncell; k++) {
      var e2 = cellEnd[k];
      c.moveTo(cellBuf[s0 + 2], cellBuf[s0 + 3]);
      for (q = s0 + 4; q < e2; q += 2) c.lineTo(cellBuf[q], cellBuf[q + 1]);
      c.closePath();
      s0 = e2;
    }
    c.strokeStyle = cc.patB; c.lineWidth = 1; c.stroke();
    // glints on a few facet vertices
    s0 = 0;
    c.beginPath();
    for (k = 0; k < ncell; k++) {
      var e3 = cellEnd[k];
      if ((hash3(k + Math.floor(X0), Math.floor(Y0), seed) & 7) === 0 && e3 - s0 >= 4) {
        var gx = cellBuf[s0 + 2], gy = cellBuf[s0 + 3];
        c.moveTo(gx + 1.2, gy); c.arc(gx, gy, 1.2, 0, TAU);
      }
      s0 = e3;
    }
    c.fillStyle = cc.acc; c.fill();
  }

  // w3: topographic isolines of AP.Noise (marching squares with linear interpolation); every
  // fourth level is a brighter index contour.
  var ISO_G = 8;
  var isoF = new Float32Array(48 * 48);
  var isoX = 0, isoY = 0;

  function isoEdge(e, x0, y0, a, b, cr, d, v) {
    var t;
    if (e === 0) { t = (v - a) / (b - a); isoX = x0 + ISO_G * t; isoY = y0; }
    else if (e === 1) { t = (v - b) / (cr - b); isoX = x0 + ISO_G; isoY = y0 + ISO_G * t; }
    else if (e === 2) { t = (v - d) / (cr - d); isoX = x0 + ISO_G * t; isoY = y0 + ISO_G; }
    else { t = (v - a) / (d - a); isoX = x0; isoY = y0 + ISO_G * t; }
  }
  // segment table: pairs of edges (0 top, 1 right, 2 bottom, 3 left) per case, -1 = none
  var ISO_T = [
    -1, -1, -1, -1, 3, 2, -1, -1, 2, 1, -1, -1, 3, 1, -1, -1,
    0, 1, -1, -1, 0, 1, 3, 2, 0, 2, -1, -1, 0, 3, -1, -1,
    0, 3, -1, -1, 0, 2, -1, -1, 0, 3, 2, 1, 0, 1, -1, -1,
    3, 1, -1, -1, 2, 1, -1, -1, 3, 2, -1, -1, -1, -1, -1, -1
  ];

  function fillIsolines(c, X0, Y0, X1, Y1, seed, pal, cc) {
    var gx0 = Math.floor(X0 / ISO_G), gy0 = Math.floor(Y0 / ISO_G);
    var nx = Math.min(47, Math.ceil(X1 / ISO_G) - gx0 + 1), ny = Math.min(47, Math.ceil(Y1 / ISO_G) - gy0 + 1);
    var so = (seed % 997) * 0.731, i, j;
    for (j = 0; j < ny; j++) {
      for (i = 0; i < nx; i++) {
        var x = (gx0 + i) * ISO_G, y = (gy0 + j) * ISO_G;
        isoF[j * 48 + i] = 0.62 * noise2(x / 190 + so, y / 190 - so) + 0.28 * noise2(x / 83 - so * 0.5, y / 83 + 11.3) +
          0.10 * noise2(x / 31 + 7.1, y / 31 - 3.3 + so);
      }
    }
    var STEP = 0.11;
    for (var pass = 0; pass < 2; pass++) {
      c.beginPath();
      for (j = 0; j < ny - 1; j++) {
        for (i = 0; i < nx - 1; i++) {
          var a = isoF[j * 48 + i], b = isoF[j * 48 + i + 1], cr = isoF[(j + 1) * 48 + i + 1], d = isoF[(j + 1) * 48 + i];
          var lo = Math.min(a, b, cr, d), hi = Math.max(a, b, cr, d);
          var k0 = Math.ceil(lo / STEP), k1 = Math.floor(hi / STEP);
          var x0 = (gx0 + i) * ISO_G, y0 = (gy0 + j) * ISO_G;
          for (var kk = k0; kk <= k1; kk++) {
            var major = (((kk % 4) + 4) % 4) === 0;
            if (major !== (pass === 1)) continue;
            var v = kk * STEP + 1e-5;
            var cs = (a > v ? 8 : 0) | (b > v ? 4 : 0) | (cr > v ? 2 : 0) | (d > v ? 1 : 0);
            var ti = cs * 4;
            for (var sgi = 0; sgi < 4; sgi += 2) {
              var e1 = ISO_T[ti + sgi];
              if (e1 < 0) break;
              isoEdge(e1, x0, y0, a, b, cr, d, v); c.moveTo(isoX, isoY);
              isoEdge(ISO_T[ti + sgi + 1], x0, y0, a, b, cr, d, v); c.lineTo(isoX, isoY);
            }
          }
        }
      }
      if (pass === 0) { c.strokeStyle = cc.patB; c.lineWidth = 0.8; } else { c.strokeStyle = cc.patA; c.lineWidth = 1.3; }
      c.stroke();
    }
  }

  // w4: a Sierpinski triangle lattice (gaskets to depth 0..2) under leaf venation (vesica leaves
  // with a midrib and alternate lateral veins).
  function triPath(c, ax, ay, bx, by, qx, qy) { c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(qx, qy); c.closePath(); }
  function gasket(c, ax, ay, bx, by, qx, qy, depth) {
    if (depth <= 0) return;
    var abx = (ax + bx) / 2, aby = (ay + by) / 2, aqx = (ax + qx) / 2, aqy = (ay + qy) / 2, bqx = (bx + qx) / 2, bqy = (by + qy) / 2;
    triPath(c, abx, aby, bqx, bqy, aqx, aqy);
    gasket(c, ax, ay, abx, aby, aqx, aqy, depth - 1);
    gasket(c, abx, aby, bx, by, bqx, bqy, depth - 1);
    gasket(c, aqx, aqy, bqx, bqy, qx, qy, depth - 1);
  }

  function fillGarden(c, X0, Y0, X1, Y1, seed, pal, cc) {
    var S = 64, H = S * 0.8660254037844386, r, k;
    var r0 = Math.floor(Y0 / H) - 1, r1 = Math.floor(Y1 / H) + 1;
    c.beginPath();
    for (r = r0; r <= r1; r++) {
      var y = r * H, off = (r & 1) ? S / 2 : 0;
      var k0 = Math.floor((X0 - off) / S) - 1, k1 = Math.floor((X1 - off) / S) + 1;
      for (k = k0; k <= k1; k++) {
        var xa = k * S + off;
        triPath(c, xa + S / 2, y, xa, y + H, xa + S, y + H);
        gasket(c, xa + S / 2, y, xa, y + H, xa + S, y + H, hash3(k, r, seed ^ 0x51E7) % 3);
      }
    }
    c.strokeStyle = cc.patC; c.lineWidth = 0.8; c.stroke();
    // leaves on a 120u cell grid
    var LC = 120, i, j;
    var i0 = Math.floor(X0 / LC) - 1, i1 = Math.floor(X1 / LC) + 1, j0 = Math.floor(Y0 / LC) - 1, j1 = Math.floor(Y1 / LC) + 1;
    for (var pass = 0; pass < 2; pass++) {
      c.beginPath();
      for (j = j0; j <= j1; j++) {
        for (i = i0; i <= i1; i++) {
          var h = hash3(i, j, seed ^ 0x1EAF);
          if ((h & 7) >= 5) continue;
          var mx = (i + 0.2 + 0.6 * hf(i, j, seed ^ 3)) * LC, my = (j + 0.2 + 0.6 * hf(i, j, seed ^ 4)) * LC;
          var ang = hf(i, j, seed ^ 5) * TAU, len = 62 + 44 * hf(i, j, seed ^ 6), wid = len * (0.27 + 0.1 * hf(i, j, seed ^ 7));
          var dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
          var bx = mx - dx * len / 2, by = my - dy * len / 2, tx = mx + dx * len / 2, ty = my + dy * len / 2;
          if (pass === 0) {
            c.moveTo(bx, by); c.quadraticCurveTo(mx + nx * wid, my + ny * wid, tx, ty);
            c.quadraticCurveTo(mx - nx * wid, my - ny * wid, bx, by);
            for (var v = 1; v <= 6; v++) {
              var t = v / 7.4, side = (v & 1) ? 1 : -1, t2 = Math.min(0.97, t + 0.15);
              var px = bx + dx * len * t + nx * wid * 0.06, py = by + dy * len * t + ny * wid * 0.06;
              var w2 = wid * 0.82 * Math.sin(Math.PI * t2);
              var ex = bx + dx * len * t2 + nx * side * w2, ey = by + dy * len * t2 + ny * side * w2;
              c.moveTo(px, py);
              c.quadraticCurveTo(px + dx * len * 0.04 + nx * side * w2 * 0.55, py + dy * len * 0.04 + ny * side * w2 * 0.55, ex, ey);
            }
          } else {
            c.moveTo(bx - dx * 6, by - dy * 6);
            c.quadraticCurveTo(mx + nx * wid * 0.12, my + ny * wid * 0.12, tx, ty);
          }
        }
      }
      if (pass === 0) { c.strokeStyle = cc.patB; c.lineWidth = 0.8; } else { c.strokeStyle = cc.patA; c.lineWidth = 1.2; }
      c.stroke();
    }
  }

  // w5: concentric rings from two jittered centre lattices with different spacings: where the
  // families overlap they beat into moire fringes.
  var RING_LAT = 352, RING_MAX = 270;
  var spanOut = { a0: 0, a1: TAU, dmin: 0, dmax: 0 };
  function arcSpan(cx, cy, X0, Y0, X1, Y1) {
    var nxp = cx < X0 ? X0 : (cx > X1 ? X1 : cx), nyp = cy < Y0 ? Y0 : (cy > Y1 ? Y1 : cy);
    spanOut.dmin = Math.sqrt((nxp - cx) * (nxp - cx) + (nyp - cy) * (nyp - cy));
    var fx = Math.max(Math.abs(X0 - cx), Math.abs(X1 - cx)), fy = Math.max(Math.abs(Y0 - cy), Math.abs(Y1 - cy));
    spanOut.dmax = Math.sqrt(fx * fx + fy * fy);
    if (cx >= X0 && cx <= X1 && cy >= Y0 && cy <= Y1) { spanOut.a0 = 0; spanOut.a1 = TAU; return spanOut; }
    var base = Math.atan2((Y0 + Y1) * 0.5 - cy, (X0 + X1) * 0.5 - cx), lo = 0, hi = 0;
    for (var k = 0; k < 4; k++) {
      var px = (k & 1) ? X1 : X0, py = (k & 2) ? Y1 : Y0;
      var d = Math.atan2(py - cy, px - cx) - base;
      d -= TAU * Math.floor((d + Math.PI) / TAU);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    spanOut.a0 = base + lo - 0.02; spanOut.a1 = base + hi + 0.02;
    return spanOut;
  }

  function fillRings(c, X0, Y0, X1, Y1, seed, pal, cc) {
    for (var fam = 0; fam < 2; fam++) {
      var off = fam ? RING_LAT / 2 : 0, sp = fam ? 7.9 : 7, cols = fam ? cc.ringB : cc.ringA;
      var i0 = Math.floor((X0 - RING_MAX - off) / RING_LAT) - 1, i1 = Math.floor((X1 + RING_MAX - off) / RING_LAT) + 1;
      var j0 = Math.floor((Y0 - RING_MAX - off) / RING_LAT) - 1, j1 = Math.floor((Y1 + RING_MAX - off) / RING_LAT) + 1;
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var cx = i * RING_LAT + off + (hf(i, j, seed ^ (fam + 11)) - 0.5) * 120;
          var cy = j * RING_LAT + off + (hf(i, j, seed ^ (fam + 23)) - 0.5) * 120;
          var s = arcSpan(cx, cy, X0, Y0, X1, Y1);
          if (s.dmin >= RING_MAX) continue;
          var re = Math.min(RING_MAX, s.dmax), a0 = s.a0, a1 = s.a1;
          for (var band = 0; band < 3; band++) {
            var ra = Math.max(s.dmin, band * RING_MAX / 3, sp), rb = Math.min(re, (band + 1) * RING_MAX / 3);
            if (rb <= ra) continue;
            c.beginPath();
            for (var r = Math.ceil(ra / sp) * sp; r < rb; r += sp) { c.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0)); c.arc(cx, cy, r, a0, a1); }
            c.strokeStyle = cols[band]; c.lineWidth = 0.9; c.stroke();
          }
          if (s.dmin < 4) {
            c.beginPath(); c.moveTo(cx + 2, cy); c.arc(cx, cy, 2, 0, TAU);
            c.fillStyle = cc.acc; c.fill();
          }
        }
      }
    }
  }

  // endless (and title/map): a mosaic of nested regular polygons, one per 32u cell (3..6 sides or circle)
  function polyPath(c, cx, cy, r, n, rot) {
    if (n >= 32) { c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, TAU); return; }
    c.moveTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r);
    for (var k = 1; k < n; k++) { var a = rot + k * TAU / n; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    c.closePath();
  }
  var MOSAIC_N = [3, 4, 5, 6, 48];
  function fillMosaic(c, X0, Y0, X1, Y1, seed, pal, cc) {
    var S = 32, i, j;
    var i0 = Math.floor(X0 / S), i1 = Math.floor(X1 / S), j0 = Math.floor(Y0 / S), j1 = Math.floor(Y1 / S);
    for (var pass = 0; pass < 2; pass++) {
      c.beginPath();
      for (j = j0; j <= j1; j++) {
        for (i = i0; i <= i1; i++) {
          var h = hash3(i, j, seed ^ 0x3A1), n = MOSAIC_N[h % 5], rot = ((h >>> 5) & 1023) / 1023 * TAU;
          if (pass === 0) polyPath(c, i * S + 16, j * S + 16, 11.5, n, rot);
          else polyPath(c, i * S + 16, j * S + 16, 5.5, n, rot + Math.PI / n);
        }
      }
      c.strokeStyle = pass ? cc.patC : cc.patB; c.lineWidth = pass ? 0.8 : 1; c.stroke();
    }
    c.beginPath();
    for (j = j0; j <= j1 + 1; j++) for (i = i0; i <= i1 + 1; i++) { c.moveTo(i * S + 0.9, j * S); c.arc(i * S, j * S, 0.9, 0, TAU); }
    c.fillStyle = cc.patB; c.fill();
  }

  // void: dashed rings and spokes around the arena centre, as if geometry were being unmade
  function fillVoid(c, X0, Y0, X1, Y1, seed, pal, cc, L) {
    var cx = (L && L.w ? L.w : 30) * TS / 2, cy = (L && L.h ? L.h : 17) * TS / 2;
    var s = arcSpan(cx, cy, X0, Y0, X1, Y1), a0 = s.a0, a1 = s.a1;
    var SP = 11, r0 = Math.max(SP, Math.ceil(s.dmin / SP) * SP), r1 = s.dmax;
    c.beginPath();
    for (var r = r0; r < r1; r += SP) {
      var ri = Math.round(r / SP), seg = 20 / r;
      var k0 = Math.floor(a0 / seg), k1 = Math.ceil(a1 / seg);
      for (var k = k0; k < k1; k++) {
        if (hf(ri, k, seed ^ 0x7011) < 0.38) continue;
        var sa = k * seg, ea = sa + seg * (0.55 + 0.4 * hf(k, ri, seed));
        c.moveTo(cx + r * Math.cos(sa), cy + r * Math.sin(sa)); c.arc(cx, cy, r, sa, ea);
      }
    }
    c.strokeStyle = cc.patB; c.lineWidth = 0.9; c.stroke();
    c.beginPath();
    var STEP = TAU / 72, q0 = Math.floor(a0 / STEP), q1 = Math.ceil(a1 / STEP), rin = Math.max(18, s.dmin);
    for (var q = q0; q <= q1; q++) {
      var a = q * STEP, ca = Math.cos(a), sa2 = Math.sin(a);
      c.moveTo(cx + ca * rin, cy + sa2 * rin); c.lineTo(cx + ca * s.dmax, cy + sa2 * s.dmax);
    }
    c.strokeStyle = cc.patD; c.lineWidth = 0.7; c.stroke();
  }

  // ------------------------------------------------------------------ BREAK blocks (clearly not SOLID)
  function blockPath(c, x, y, s, ch) {
    c.moveTo(x + ch, y); c.lineTo(x + s - ch, y); c.lineTo(x + s, y + ch); c.lineTo(x + s, y + s - ch);
    c.lineTo(x + s - ch, y + s); c.lineTo(x + ch, y + s); c.lineTo(x, y + s - ch); c.lineTo(x, y + ch); c.closePath();
  }
  function crackPath(c, x, y, h) {
    var r1 = (h & 255) / 255, r2 = ((h >>> 8) & 255) / 255, r3 = ((h >>> 16) & 255) / 255, r4 = ((h >>> 24) & 255) / 255;
    var sx = x + 10 + 12 * r1, sy = y + 3;
    var mx = x + 9 + 14 * r2, my = y + 12 + 4 * r3;
    var nx = x + 11 + 10 * r4, ny = y + 19 + 3 * r1;
    var ex = x + 8 + 16 * r3, ey = y + 29;
    c.moveTo(sx, sy); c.lineTo(mx, my); c.lineTo(nx, ny); c.lineTo(ex, ey);
    var bx = r2 > 0.5 ? x + 28 : x + 4, by = my + 4 + 6 * r4;
    c.moveTo(mx, my); c.lineTo((mx + bx) * 0.5, my + 1 + 3 * r1); c.lineTo(bx, by);
    c.moveTo(nx, ny); c.lineTo(nx + (r1 > 0.5 ? 6 : -6), ny + 3 + 2 * r3);
  }
  // per-style motifs, drawn clipped inside the block
  function brkLattice(c, x, y, h, cc) {
    c.beginPath();
    var k = (h >>> 3) & 1;
    arcPair(c, x, y, TS, k, 13); arcPair(c, x, y, TS, k, 19);
    c.strokeStyle = cc.brkLine; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.moveTo(x + 16, y + 8); c.lineTo(x + 24, y + 16); c.lineTo(x + 16, y + 24); c.lineTo(x + 8, y + 16); c.closePath();
    c.fillStyle = cc.brkFacetA; c.fill();
  }
  var OCT_X = [8, 24, 30, 30, 24, 8, 2, 2], OCT_Y = [2, 2, 8, 24, 30, 30, 24, 8];
  function brkCrystal(c, x, y, h, cc) {
    var ax = x + 13 + 6 * ((h & 63) / 63), ay = y + 11 + 6 * (((h >>> 6) & 63) / 63);
    for (var k = 0; k < 8; k++) {
      var k2 = (k + 1) & 7;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(x + OCT_X[k], y + OCT_Y[k]); c.lineTo(x + OCT_X[k2], y + OCT_Y[k2]); c.closePath();
      c.fillStyle = (k + (h >>> 12)) % 3 === 0 ? cc.brkFacetA : cc.brkFacetB; c.fill();
    }
    c.beginPath();
    for (k = 0; k < 8; k++) { c.moveTo(ax, ay); c.lineTo(x + OCT_X[k], y + OCT_Y[k]); }
    c.strokeStyle = cc.brkLine; c.lineWidth = 0.7; c.stroke();
  }
  function brkStone(c, x, y, h, cc) {
    var ox = ((h & 15) - 7.5) * 0.4, oy = (((h >>> 4) & 15) - 7.5) * 0.4;
    c.beginPath();
    for (var k = 1; k <= 3; k++) {
      var r = k * 4.6;
      c.moveTo(x + 16 + ox + r * 1.25, y + 16 + oy);
      c.ellipse(x + 16 + ox, y + 16 + oy, r * 1.25, r, 0.35, 0, TAU);
    }
    c.strokeStyle = cc.brkLine; c.lineWidth = 0.9; c.stroke();
    c.fillStyle = cc.brkFacetB; c.fill();
  }
  function brkBark(c, x, y, h, cc) {
    c.beginPath();
    for (var k = 0; k < 5; k++) {
      var gx = x + 5 + k * 5.5 + ((h >>> (k * 3)) & 3) * 0.6, w = 1.6 + ((h >>> (k + 9)) & 3) * 0.5;
      c.moveTo(gx, y + 2);
      c.bezierCurveTo(gx + w, y + 10, gx - w, y + 20, gx + w * 0.5, y + 30);
    }
    c.strokeStyle = cc.brkLine; c.lineWidth = 1; c.stroke();
    var kx = x + 10 + ((h >>> 20) & 15) * 0.8, ky = y + 9 + ((h >>> 24) & 15) * 0.9;
    c.beginPath(); c.moveTo(kx + 3.2, ky); c.ellipse(kx, ky, 3.2, 2.2, 0, 0, TAU);
    c.fillStyle = cc.brkFacetA; c.fill();
    c.strokeStyle = cc.brkLine; c.lineWidth = 0.8; c.stroke();
  }
  function brkRings(c, x, y, h, cc) {
    c.beginPath();
    for (var r = 3.5; r < 15; r += 3.5) { c.moveTo(x + 16 + r, y + 16); c.arc(x + 16, y + 16, r, 0, TAU); }
    c.strokeStyle = cc.brkLine; c.lineWidth = 0.9; c.stroke();
    c.beginPath(); c.moveTo(x + 17.6, y + 16); c.arc(x + 16, y + 16, 1.6, 0, TAU);
    c.fillStyle = cc.brkFacetA; c.fill();
  }

  function drawBreak(c, tx, ty, lite) {
    var x = tx * TS, y = ty * TS, h = hash3(tx, ty, st.seed ^ 0x6B1D), cc = st.cc;
    c.beginPath(); blockPath(c, x + 2, y + 2, TS - 4, 6);
    c.fillStyle = cc.brkBody; c.fill();
    if (!lite) {
      c.save();
      c.clip();
      st.sty.brk(c, x, y, h, cc);
      c.restore();
      c.beginPath(); blockPath(c, x + 6, y + 6, TS - 12, 4);
      c.strokeStyle = cc.brkBevel; c.lineWidth = 1; c.stroke();
    }
    c.beginPath(); blockPath(c, x + 2, y + 2, TS - 4, 6);
    c.strokeStyle = cc.brkEdge; c.lineWidth = 1.75; c.stroke();
    c.beginPath(); crackPath(c, x, y, h);
    c.strokeStyle = cc.crackDark; c.lineWidth = 3.4; c.stroke();
    c.strokeStyle = cc.crackLit; c.lineWidth = 1.1; c.stroke();
  }

  // ------------------------------------------------------------------ one-way bars (top 8u)
  function barMotif(c, kind, x0, x1, y) {
    for (var x = x0 + 4; x < x1 - 3; x += 8) {
      if (kind === 0) { c.moveTo(x - 2, y + 6.2); c.lineTo(x + 2, y + 1.8); }
      else if (kind === 1) { c.moveTo(x, y + 1.8); c.lineTo(x + 2.2, y + 4); c.lineTo(x, y + 6.2); c.lineTo(x - 2.2, y + 4); c.closePath(); }
      else if (kind === 2) { c.moveTo(x - 2.5, y + 4); c.lineTo(x + 2.5, y + 4); }
      else if (kind === 3) { c.moveTo(x - 2.2, y + 2); c.lineTo(x, y + 5.6); c.lineTo(x + 2.2, y + 2); }
      else if (kind === 4) { c.moveTo(x + 1.1, y + 4); c.arc(x, y + 4, 1.1, 0, TAU); }
      else { c.moveTo(x, y + 1.8); c.lineTo(x + 2.4, y + 6); c.lineTo(x - 2.4, y + 6); c.closePath(); }
    }
  }

  function drawOneways(c, gx0, gy0, ty0, ty1, lite) {
    var cc = st.cc, pal = st.pal, kind = st.sty.bar, pass, j, i;
    for (pass = 0; pass < (lite ? 1 : 2); pass++) {
      c.beginPath();
      var any = false;
      for (var ty = ty0; ty <= ty1; ty++) {
        j = ty - gy0;
        for (i = 1; i <= GW - 2; i++) {
          if (grid[j * GW + i] !== ONEWAY) continue;
          var s = i;
          while (i + 1 <= GW - 2 && grid[j * GW + i + 1] === ONEWAY) i++;
          var capL = grid[j * GW + s - 1] !== ONEWAY, capR = grid[j * GW + i + 1] !== ONEWAY;
          var x0 = (gx0 + s) * TS, x1 = (gx0 + i + 1) * TS, y = ty * TS, ch = 3;
          any = true;
          if (pass === 0) {
            // inset by half the 1.2u outline so the stroked bar never leaves its 8u band
            var ia = capL ? x0 + 0.6 : x0 - 0.6, ib = capR ? x1 - 0.6 : x1 + 0.6, ya = y + 0.6, yb = y + OW_H - 0.6;
            c.moveTo(capL ? ia + ch : ia, ya);
            c.lineTo(capR ? ib - ch : ib, ya);
            if (capR) { c.lineTo(ib, ya + ch); c.lineTo(ib, yb - ch); c.lineTo(ib - ch, yb); } else c.lineTo(ib, yb);
            if (capL) { c.lineTo(ia + ch, yb); c.lineTo(ia, yb - ch); c.lineTo(ia, ya + ch); } else c.lineTo(ia, yb);
            c.closePath();
          } else {
            barMotif(c, kind, x0, x1, y);
          }
        }
      }
      if (!any) return;
      if (pass === 0) {
        c.fillStyle = cc.owFill; c.fill();
        c.strokeStyle = cc.owEdge; c.lineWidth = 1.2; c.stroke();
        // bright top line (inside the 8u bar, so it never claims space above the platform)
        c.beginPath();
        for (ty = ty0; ty <= ty1; ty++) {
          j = ty - gy0;
          for (i = 1; i <= GW - 2; i++) {
            if (grid[j * GW + i] !== ONEWAY) continue;
            var s2 = i;
            while (i + 1 <= GW - 2 && grid[j * GW + i + 1] === ONEWAY) i++;
            var l = grid[j * GW + s2 - 1] !== ONEWAY ? 3 : 0, r = grid[j * GW + i + 1] !== ONEWAY ? 3 : 0;
            c.moveTo((gx0 + s2) * TS + l, ty * TS + 1); c.lineTo((gx0 + i + 1) * TS - r, ty * TS + 1);
          }
        }
        c.strokeStyle = pal.primary; c.lineWidth = 2; c.stroke();
      } else {
        c.strokeStyle = cc.owMotif; c.fillStyle = cc.owMotif; c.lineWidth = 1;
        if (kind === 4) c.fill(); else c.stroke();
      }
    }
  }

  // ------------------------------------------------------------------ spikes (silhouette == hurtbox)
  // Teeth are built in the SPIKE_U frame relative to the tile centre (hurtbox x -13..13, y 2..16),
  // inset by half the 2u stroke so the stroked shape ends exactly on the hurtbox; round joins keep
  // the tips from overshooting. Other directions are exact rotations of the same frame.
  var spkX = 0, spkY = 0;
  function spkMap(code, x, y, ox, oy) {
    if (code === SPK_U) { spkX = ox + x; spkY = oy + y; }
    else if (code === SPK_DN) { spkX = ox - x; spkY = oy - y; }
    else if (code === SPK_L) { spkX = ox + y; spkY = oy - x; }
    else { spkX = ox - y; spkY = oy + x; }
  }
  function spikeTeeth(c, code, tx, ty, spines) {
    var ox = tx * TS + TS / 2, oy = ty * TS + TS / 2, half = TS / 2 - SPK_IN, w3 = 2 * half / 3, e = 1;
    var yb = TS / 2 - e, yt = TS / 2 - SPK_D + e;
    for (var k = 0; k < 3; k++) {
      var xa = -half + k * w3, xb = xa + w3, xm = (xa + xb) * 0.5;
      if (k === 0) xa += e;
      if (k === 2) xb -= e;
      if (spines) {
        spkMap(code, xm, yt + 1.5, ox, oy); c.moveTo(spkX, spkY);
        spkMap(code, xm, yt + 8, ox, oy); c.lineTo(spkX, spkY);
      } else {
        spkMap(code, xa, yb, ox, oy); c.moveTo(spkX, spkY);
        spkMap(code, xm, yt, ox, oy); c.lineTo(spkX, spkY);
        spkMap(code, xb, yb, ox, oy); c.lineTo(spkX, spkY);
        c.closePath();
      }
    }
  }
  function drawSpikes(c, gx0, gy0, tx0, tx1, ty0, ty1, lite) {
    var any = false, tx, ty, code;
    c.beginPath();
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        code = grid[(ty - gy0) * GW + (tx - gx0)];
        if (code >= SPK_U && code <= SPK_R) { spikeTeeth(c, code, tx, ty, false); any = true; }
      }
    }
    if (!any) return;
    c.fillStyle = st.cc.spkFill; c.fill();
    c.lineJoin = 'round';
    c.strokeStyle = st.pal.hazard; c.lineWidth = 2; c.stroke();
    if (lite) return;
    c.beginPath();
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        code = grid[(ty - gy0) * GW + (tx - gx0)];
        if (code >= SPK_U && code <= SPK_R) spikeTeeth(c, code, tx, ty, true);
      }
    }
    c.lineCap = 'round';
    c.strokeStyle = st.cc.spkTip; c.lineWidth = 1; c.stroke();
  }

  // ------------------------------------------------------------------ styles and colours
  var STY = {
    w1: { fill: fillTruchet, brk: brkLattice, bar: 0, k: 1 },
    w2: { fill: fillVoronoi, brk: brkCrystal, bar: 1, k: 1 },
    w3: { fill: fillIsolines, brk: brkStone, bar: 2, k: 1 },
    w4: { fill: fillGarden, brk: brkBark, bar: 3, k: 1 },
    w5: { fill: fillRings, brk: brkRings, bar: 4, k: 0.9 },
    endless: { fill: fillMosaic, brk: brkCrystal, bar: 5, k: 0.75 },
    void: { fill: fillVoid, brk: brkCrystal, bar: 4, k: 0.65 }
  };
  function styleKeyOf(L) {
    var k = L && L.style;
    if (k && STY[k]) return k;
    if (k === 'title' || k === 'map') return 'endless';
    var w = L && L.world;
    if (w >= 1 && w <= 5) return 'w' + w;
    return 'w1';
  }

  function makeColors(pal, k) {
    var deep = mix(pal.bg, '#000000', 0.3);
    var body = mix(deep, pal.primary, 0.075);
    var pa = function (a) { return rgba(pal.primary, a * k); };
    return {
      body: rgba(body, 0.94), bodySolid: rgba(body, 1),
      patA: pa(0.30), patB: pa(0.17), patC: pa(0.10), patD: pa(0.065),
      facet: [pa(0.025), pa(0.06), pa(0.11), pa(0.17)],
      ringA: [pa(0.24), pa(0.15), pa(0.07)], ringB: [pa(0.19), pa(0.12), pa(0.055)],
      acc: rgba(pal.accent, 0.5 * k),
      band1: rgba(pal.primary, 0.055), band2: rgba(pal.primary, 0.10),
      glow1: rgba(pal.primary, 0.05), glow2: rgba(pal.primary, 0.11),
      core: rgba(mix(pal.primary, pal.ink, 0.6), 0.85),
      brkBody: rgba(mix(deep, pal.accent, 0.13), 0.97),
      brkEdge: rgba(mix(pal.primary, pal.accent, 0.65), 0.95),
      brkBevel: rgba(mix(pal.primary, pal.accent, 0.5), 0.3),
      brkLine: rgba(mix(pal.primary, pal.accent, 0.5), 0.5),
      brkFacetA: rgba(pal.accent, 0.17), brkFacetB: rgba(pal.primary, 0.08),
      crackDark: rgba(mix(deep, '#000000', 0.6), 0.85), crackLit: rgba(mix(pal.accent, pal.ink, 0.35), 0.95),
      owFill: rgba(pal.primary, 0.22), owEdge: rgba(pal.primary, 0.55), owMotif: rgba(pal.primary, 0.45),
      spkFill: rgba(pal.hazard, 0.36), spkTip: rgba(mix(pal.hazard, '#FFFFFF', 0.55), 0.9)
    };
  }

  // ------------------------------------------------------------------ chunk painting
  function paint(c, L, cx, cy, lite) {
    var pal = st.pal, cc = st.cc;
    var X0 = cx * CHUNK, Y0 = cy * CHUNK, X1 = X0 + CHUNK, Y1 = Y0 + CHUNK;
    var gx0 = cx * TPC - MG - 1, gy0 = cy * TPC - MG - 1;
    fillWindow(L, gx0, gy0);
    traceMass(gx0 * TS, gy0 * TS);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    if (nLoops > 0) {
      massPath(c);
      c.fillStyle = cc.body; c.fill('evenodd');
      if (!lite) {
        c.save();
        c.clip('evenodd');
        st.sty.fill(c, X0 - 6, Y0 - 6, X1 + 6, Y1 + 6, st.seed, pal, cc, L);
        massPath(c);
        c.strokeStyle = cc.band1; c.lineWidth = 16; c.stroke();
        c.strokeStyle = cc.band2; c.lineWidth = 6; c.stroke();
        c.restore();
        c.lineJoin = 'round';
        c.lineCap = 'round';
        massPath(c);
        c.strokeStyle = cc.glow1; c.lineWidth = 11; c.stroke();
        c.strokeStyle = cc.glow2; c.lineWidth = 5; c.stroke();
      }
      c.strokeStyle = pal.primary; c.lineWidth = 2; c.stroke();
      if (!lite) { c.strokeStyle = cc.core; c.lineWidth = 0.75; c.stroke(); }
    }
    var tx0 = cx * TPC - 1, tx1 = cx * TPC + TPC, ty0 = cy * TPC - 1, ty1 = cy * TPC + TPC;
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        if (grid[(ty - gy0) * GW + (tx - gx0)] === BREAK) drawBreak(c, tx, ty, lite);
      }
    }
    c.lineJoin = 'round';
    c.lineCap = 'round';
    drawOneways(c, gx0, gy0, ty0, ty1, lite);
    drawSpikes(c, gx0, gy0, tx0, tx1, ty0, ty1, lite);
  }

  function buildChunk(e) {
    var L = st.L;
    if (!e.canvas || e.side !== st.side) {
      if (e.canvas) release(e);
      if (!acquire(e)) { st.noCanvas = true; return false; }
    }
    var c = e.ctx, r = st.res, n = e.side;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, n, n);
    c.setTransform(r, 0, 0, r, PADPX - e.cx * CHUNK * r, PADPX - e.cy * CHUNK * r);
    c.save();
    try {
      paint(c, L, e.cx, e.cy, false);
    } finally {
      c.restore();
    }
    e.sum = windowSum(L, e.cx, e.cy);
    e.res = r;
    e.ok = true;
    e.dirty = false;
    st.builds++;
    st.totalBuilds++;
    return true;
  }

  function blit(ctx, e) {
    var s = CHUNK * e.res;
    ctx.drawImage(e.canvas, PADPX, PADPX, s, s, e.cx * CHUNK, e.cy * CHUNK, CHUNK, CHUNK);
  }

  function drawLive(ctx, L, cx, cy) {
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
      ctx.clip();
      paint(ctx, L, cx, cy, true);
    } finally {
      ctx.restore();
    }
    st.live++;
  }

  // ------------------------------------------------------------------ level binding
  function palSig(p) { return p.bg + p.primary + p.accent + p.hazard + p.ink; }

  function reset(L) {
    dropAll();
    st.L = L;
    st.tiles = L.tiles; st.w = L.w | 0; st.h = L.h | 0;
    st.seed = (typeof L.seed === 'number' && L.seed === L.seed) ? (L.seed >>> 0) : (AP.hash ? AP.hash(String(L.id || 'level')) : 1);
    st.styleKey = styleKeyOf(L);
    st.sty = STY[st.styleKey];
    st.pal = palOf(L);
    st.palSig = palSig(st.pal);
    st.cc = makeColors(st.pal, st.sty.k);
    st.broken = false;
    st.noCanvas = false;
    var r = targetRes();
    if (r !== st.res) setRes(r);
  }

  function setRes(r) {
    st.res = r;
    st.side = Math.round(CHUNK * r) + PADPX * 2;
    st.pool.length = 0;
    st.chunks.forEach(function (e) { e.dirty = true; });
  }

  function sync(L) {
    if (st.L !== L) { reset(L); return; }
    if (st.w !== (L.w | 0) || st.h !== (L.h | 0)) { reset(L); return; }
    if (st.tiles !== L.tiles) { st.tiles = L.tiles; verifyAll(); }
    var key = styleKeyOf(L), pal = palOf(L);
    if (key !== st.styleKey || pal !== st.pal) {
      var sig = palSig(pal);
      if (key !== st.styleKey || sig !== st.palSig) {
        st.styleKey = key; st.sty = STY[key]; st.pal = pal; st.palSig = sig;
        st.cc = makeColors(pal, st.sty.k);
        st.chunks.forEach(function (e) { e.dirty = true; });
      } else st.pal = pal;
    }
  }

  function verifyAll() {
    var L = st.L;
    if (!L) return;
    st.chunks.forEach(function (e) { if (e.ok && !e.dirty && windowSum(L, e.cx, e.cy) !== e.sum) e.dirty = true; });
  }

  // chunk range that can ever show terrain: one chunk of out-of-bounds solid left/right/top
  function cxMax() { return Math.ceil(st.w * TS / CHUNK); }
  function cyMax() { return Math.floor((st.h * TS - 1) / CHUNK); }

  function focusOf(L) {
    var P = L.player;
    if (P && typeof P.x === 'number' && typeof P.y === 'number') return [P.x + 11, P.y + 11];
    var cam = L.cam;
    if (cam && typeof cam.x === 'number' && typeof cam.y === 'number') return [cam.x + 480, cam.y + 270];
    var cp = L.checkpoint;
    if (cp && typeof cp.x === 'number' && typeof cp.y === 'number') return [cp.x, cp.y];
    var map = L.def && L.def.map;
    if (map && map.length) {
      for (var j = 0; j < map.length; j++) {
        var i = String(map[j]).indexOf('P');
        if (i >= 0) return [i * TS + 16, j * TS + 16];
      }
    }
    return [480, 270];
  }

  // ------------------------------------------------------------------ public API
  function build(L) {
    if (!L || !L.tiles || !(L.w > 0) || !(L.h > 0)) return false;
    reset(L);
    var f = focusOf(L);
    var cx0 = Math.max(-1, Math.floor((f[0] - 600) / CHUNK)), cx1 = Math.min(cxMax(), Math.floor((f[0] + 600) / CHUNK));
    var cy0 = Math.max(-1, Math.floor((f[1] - 380) / CHUNK)), cy1 = Math.min(cyMax(), Math.floor((f[1] + 380) / CHUNK));
    var list = [];
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var dx = (cx + 0.5) * CHUNK - f[0], dy = (cy + 0.5) * CHUNK - f[1];
        list.push([dx * dx + dy * dy, cx, cy]);
      }
    }
    list.sort(function (a, b) { return a[0] - b[0]; });
    var n = Math.min(PREBUILD_MAX, list.length);
    try {
      for (var k = 0; k < n && !st.noCanvas; k++) {
        var e = entry(list[k][1], list[k][2], true);
        e.used = st.frame;
        buildChunk(e);
      }
    } catch (err) {
      st.broken = true;
      AP.reportError ? AP.reportError('TileArt.build', err) : AP.warn && AP.warn('TileArt.build', err);
      return false;
    }
    return true;
  }

  var vis = new Int32Array(256);
  var visD = new Float64Array(128);

  function draw(ctx, L, cam) {
    if (!ctx || !L || !L.tiles || !(L.w > 0) || !(L.h > 0)) return;
    if (st.broken && st.L === L) { fallback(ctx, L, cam); return; }
    try {
      sync(L);
      st.frame++;
      st.budget = BUILD_BUDGET;
      st.builds = 0;
      st.live = 0;
      var r = targetRes();
      if (r !== st.res) setRes(r);
      cam = cam || L.cam || null;
      var vx = cam ? num(cam.renderX, num(cam.x, 0)) : 0, vy = cam ? num(cam.renderY, num(cam.y, 0)) : 0;
      var vw = cam && cam.w > 0 ? cam.w : 960, vh = cam && cam.h > 0 ? cam.h : 540;
      var cx0 = Math.max(-1, Math.floor((vx - 4) / CHUNK)), cx1 = Math.min(cxMax(), Math.floor((vx + vw + 4) / CHUNK));
      var cy0 = Math.max(-1, Math.floor((vy - 4) / CHUNK)), cy1 = Math.min(cyMax(), Math.floor((vy + vh + 4) / CHUNK));
      var mx = vx + vw / 2, my = vy + vh / 2, nv = 0, cx, cy, k, e;
      for (cy = cy0; cy <= cy1; cy++) {
        for (cx = cx0; cx <= cx1 && nv < 128; cx++) {
          var dx = (cx + 0.5) * CHUNK - mx, dy = (cy + 0.5) * CHUNK - my, d = dx * dx + dy * dy;
          // insertion sort by distance to the view centre: nearest chunks rebuild first
          var p = nv++;
          while (p > 0 && visD[p - 1] > d) { visD[p] = visD[p - 1]; vis[p * 2] = vis[p * 2 - 2]; vis[p * 2 + 1] = vis[p * 2 - 1]; p--; }
          visD[p] = d; vis[p * 2] = cx; vis[p * 2 + 1] = cy;
        }
      }
      for (k = 0; k < nv; k++) {
        cx = vis[k * 2]; cy = vis[k * 2 + 1];
        e = entry(cx, cy, true);
        e.used = st.frame;
        if (e.ok && !e.dirty && windowSum(L, cx, cy) !== e.sum) e.dirty = true;
        if ((!e.ok || e.dirty) && st.budget > 0 && !st.noCanvas) {
          if (buildChunk(e)) st.budget--;
        }
        if (e.ok && e.canvas) blit(ctx, e);
        else drawLive(ctx, L, cx, cy);
      }
      // prefetch one ring around the view with whatever budget is left
      if (st.budget > BUILD_BUDGET - PREFETCH_BUDGET - 1 && st.budget > 0 && !st.noCanvas) {
        st.budget = Math.min(st.budget, PREFETCH_BUDGET);
        for (cy = cy0 - 1; cy <= cy1 + 1 && st.budget > 0; cy++) {
          if (cy < -1 || cy > cyMax()) continue;
          for (cx = cx0 - 1; cx <= cx1 + 1 && st.budget > 0; cx++) {
            if (cx < -1 || cx > cxMax()) continue;
            if (cy >= cy0 && cy <= cy1 && cx >= cx0 && cx <= cx1) continue;
            e = entry(cx, cy, false);
            if (e && e.ok) { e.used = st.frame; continue; }
            if (st.chunks.size >= CACHE_MAX) continue;
            e = entry(cx, cy, true);
            e.used = st.frame;
            if (buildChunk(e)) st.budget--;
          }
        }
      }
    } catch (err) {
      st.broken = true;
      if (AP.reportError) AP.reportError('TileArt.draw', err);
      fallback(ctx, L, cam);
    }
  }

  function fallback(ctx, L, cam) {
    var R = AP.R;
    if (R && typeof R.drawTilesFallback === 'function') {
      try { R.drawTilesFallback(ctx, L, cam || L.cam); } catch (e) { /* nothing left to try */ }
    }
  }

  // tx, ty < 0 (or missing) means "anything may have changed" (restoreTiles)
  function invalidate(L, tx, ty) {
    if (!L || st.L !== L) return;
    if (typeof tx !== 'number' || typeof ty !== 'number' || tx < 0 || ty < 0 || tx !== tx || ty !== ty) { verifyAll(); return; }
    tx = Math.floor(tx); ty = Math.floor(ty);
    var cxa = Math.floor((tx - SUM_M) / TPC), cxb = Math.floor((tx + SUM_M) / TPC);
    var cya = Math.floor((ty - SUM_M) / TPC), cyb = Math.floor((ty + SUM_M) / TPC);
    for (var cy = cya; cy <= cyb; cy++) {
      for (var cx = cxa; cx <= cxb; cx++) {
        var e = entry(cx, cy, false);
        if (e) e.dirty = true;
      }
    }
  }

  function dispose(L) {
    if (L && st.L && st.L !== L) return;
    dropAll();
    st.L = null; st.tiles = null; st.broken = false;
    if (st.pool.length > 16) st.pool.length = 16;
  }

  function resize() {
    var r = targetRes();
    if (r !== st.res) setRes(r);
  }

  function stats() {
    return { chunks: st.chunks.size, builds: st.builds, live: st.live, totalBuilds: st.totalBuilds, res: st.res,
      cap: CACHE_MAX, noCanvas: st.noCanvas, broken: st.broken, style: st.styleKey };
  }

  AP.TileArt = {
    build: build,
    draw: draw,
    invalidate: invalidate,
    dispose: dispose,
    resize: resize,
    stats: stats,
    CHAMFER: CHAMFER
  };
})(window.AP = window.AP || {});
