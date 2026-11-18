/* js/art/midground.js — owner: ART */
(function (AP) {
  'use strict';

  // AP.Midground.render(ctx, key, p) (CONTRACT 2.8): a screen-space parallax layer drawn between the
  // background shader and the world. p = {t, camX, camY, L|null, pal, quality, intensity, beat}.
  // Budget 1.5 ms. Everything is low-alpha line art so gameplay reads first. Layout is deterministic
  // per level seed (hashed cells in a parallax plane); motion depends only on p.t (L.time in levels).
  //   title/map  drifting polygons / a slowly re-wiring constellation
  //   w1         floating isometric wireframe cubes and Truchet glyphs that quarter-turn in time
  //   w2         crystal clusters cut from Voronoi cells (cached sprites) with travelling glints
  //   w3         streamline particles and field lines from AP.Flow (the same field as the wind)
  //   w4         L-system trees (AP.Algo.lsystem/turtle, cached) that grow in, sway and blossom
  //   w5         harmonograph pens, Lissajous figures and phyllotaxis sunflowers
  //   endless    the five world layers crossfading in step with the endless background
  //   void       polygons spiralling into the singularity, shedding sides, and harmonograph arms

  var W = 960, H = 540, TAU = Math.PI * 2;
  var PAR = 0.32;
  var WORLD_KEYS = ['w1', 'w2', 'w3', 'w4', 'w5'];
  var SIDES = [3, 4, 5, 6, 48];
  var EMPTY = Object.freeze({});
  var FALLBACK_PAL = { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' };

  // ------------------------------------------------------------------ helpers
  function num(v, d) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function frac(v) { return v - Math.floor(v); }
  function mod(a, n) { var r = a % n; return r < 0 ? r + n : r; }
  function util() { return (AP.Art && AP.Art.util) || null; }

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
    var U = util();
    return U ? U.mixHex(a, b, t) : a;
  }
  function worldPal(k) {
    var Wd = AP.Worlds;
    if (Wd && Wd.styles && Wd.styles[k]) return Wd.styles[k];
    if (Wd && typeof Wd.pal === 'function') { var p = Wd.pal(k); if (p && p.primary) return p; }
    return FALLBACK_PAL;
  }
  function palFor(key, p) {
    if (p && p.pal && p.pal.primary && p.pal.bg) return p.pal;
    var Wd = AP.Worlds;
    if (Wd && typeof Wd.pal === 'function') { var q = Wd.pal(key); if (q && q.primary) return q; }
    var R = AP.R;
    if (R && typeof R.pal === 'function') { var r = R.pal(key); if (r && r.primary) return r; }
    return FALLBACK_PAL;
  }

  function polyPath(ctx, cx, cy, r, n, rot) {
    if (n >= 32) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); return; }
    ctx.moveTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r);
    for (var k = 1; k < n; k++) { var a = rot + k * TAU / n; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.closePath();
  }
  function starPath(ctx, cx, cy, ro, ri, pts, rot) {
    var n = pts * 2;
    for (var i = 0; i < n; i++) {
      var a = rot + i * Math.PI / pts, r = (i & 1) ? ri : ro;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  function dot(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }

  // per-frame context (reused; never allocated per frame)
  var F = { t: 0, cx: 0, cy: 0, a: 1, seed: 0, pulse: 0, inten: 0, q: 1, L: null, pal: FALLBACK_PAL };

  // ------------------------------------------------------------------ title: drifting polygons
  function mgTitle(ctx, f, pal) {
    var n = Math.round(26 * f.q), t = f.t, s = f.seed, SX = W + 260, SY = H + 260;
    for (var i = 0; i < n; i++) {
      var dep = 0.25 + 0.75 * hf(i, 2, s), size = 6 + 44 * dep * dep;
      var x = mod(hf(i, 3, s) * SX + (hf(i, 4, s) - 0.5) * 14 * dep * t - f.cx * 0.1 * dep, SX) - 130;
      var y = mod(hf(i, 5, s) * SY - (4 + 10 * hf(i, 6, s)) * dep * t - f.cy * 0.1 * dep, SY) - 130;
      var sides = SIDES[hash3(i, 7, s) % 5], rot = hf(i, 8, s) * TAU + t * (hf(i, 9, s) - 0.5) * 0.5;
      var breathe = 0.72 + 0.28 * Math.sin(t * (0.35 + 0.5 * hf(i, 10, s)) + i * 1.7);
      var a = (0.05 + 0.14 * dep) * breathe * (1 + 0.3 * f.pulse), gold = (i % 6) === 0;
      ctx.globalAlpha = f.a * a;
      ctx.strokeStyle = gold ? pal.accent : pal.primary;
      ctx.lineWidth = 0.8 + 0.8 * dep;
      ctx.beginPath();
      polyPath(ctx, x, y, size, sides, rot);
      if (size > 26) polyPath(ctx, x, y, size * 0.5, sides, rot + Math.PI / sides);
      ctx.stroke();
      if (size > 18 && sides < 10) {
        ctx.globalAlpha = f.a * Math.min(1, a * 1.6);
        ctx.fillStyle = gold ? pal.accent : pal.ink;
        ctx.beginPath();
        for (var k = 0; k < sides; k++) { var va = rot + k * TAU / sides; dot(ctx, x + Math.cos(va) * size, y + Math.sin(va) * size, 1.2); }
        ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------------ map: a calm, slowly re-wiring constellation
  var nodeX = new Float32Array(32), nodeY = new Float32Array(32);
  function mgMap(ctx, f, pal) {
    var n = Math.min(32, Math.round(22 * f.q)), t = f.t, s = f.seed, i, j, k;
    for (i = 0; i < n; i++) {
      nodeX[i] = mod(hf(i, 1, s) * (W + 200) + Math.sin(t * 0.05 + i) * 22 + t * (hf(i, 2, s) - 0.5) * 7 - f.cx * 0.12, W + 200) - 100;
      nodeY[i] = mod(hf(i, 3, s) * (H + 200) + Math.cos(t * 0.04 + i * 1.3) * 16 - t * 2.2 * hf(i, 4, s) - f.cy * 0.12, H + 200) - 100;
    }
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 0.8;
    for (var band = 0; band < 3; band++) {
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        for (k = 1; k <= 3; k++) {
          j = (i + k) % n;
          var dx = nodeX[j] - nodeX[i], dy = nodeY[j] - nodeY[i], d = Math.sqrt(dx * dx + dy * dy);
          if (d > 240) continue;
          var b = d < 110 ? 0 : (d < 180 ? 1 : 2);
          if (b !== band) continue;
          ctx.moveTo(nodeX[i], nodeY[i]); ctx.lineTo(nodeX[j], nodeY[j]);
        }
      }
      ctx.globalAlpha = f.a * (band === 0 ? 0.2 : (band === 1 ? 0.12 : 0.05));
      ctx.stroke();
    }
    ctx.globalAlpha = f.a * 0.45;
    ctx.fillStyle = pal.ink;
    ctx.beginPath();
    for (i = 0; i < n; i++) polyPath(ctx, nodeX[i], nodeY[i], 2 + 2.5 * hf(i, 5, s), 3 + (hash3(i, 6, s) % 4), t * 0.1 + i);
    ctx.fill();
    ctx.globalAlpha = f.a * (0.1 + 0.12 * f.pulse);
    ctx.strokeStyle = pal.accent;
    ctx.beginPath();
    for (i = 0; i < n; i += 4) dot(ctx, nodeX[i], nodeY[i], 7 + 2 * Math.sin(t * 0.8 + i));
    ctx.stroke();
  }

  // ------------------------------------------------------------------ w1: isometric cubes and Truchet glyphs
  var CW1 = 420, CH1 = 320;
  var CUBE_OPT = { width: 1.1, tilt: 0.6, dots: null };
  function mgW1(ctx, f, pal) {
    var mx = f.cx * PAR, my = f.cy * PAR, s = f.seed, t = f.t * (1 + 0.5 * f.inten), A = AP.Art;
    var i0 = Math.floor((mx - 90) / CW1), i1 = Math.floor((mx + W + 90) / CW1);
    var j0 = Math.floor((my - 90) / CH1), j1 = Math.floor((my + H + 90) / CH1);
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var h = hash3(i, j, s);
        if ((h & 3) !== 0 && A && typeof A.isoCube === 'function') {
          var x = (i + 0.15 + 0.7 * hf(i, j, s ^ 11)) * CW1 - mx;
          var y = (j + 0.15 + 0.7 * hf(i, j, s ^ 12)) * CH1 - my + Math.sin(t * 0.45 + (h & 255)) * 7;
          var size = 16 + 30 * hf(i, j, s ^ 13), ang = t * (0.12 + 0.22 * hf(i, j, s ^ 14)) + (h & 1023) * 0.01;
          ctx.globalAlpha = f.a;
          CUBE_OPT.tilt = 0.55 + 0.2 * hf(i, j, s ^ 16);
          CUBE_OPT.dots = f.pulse > 0.25 ? pal.accent : null;
          A.isoCube(ctx, x, y, size, ang, pal.primary, 0.16 + 0.1 * hf(i, j, s ^ 15), CUBE_OPT);
        }
        var gx = (i + 0.1 + 0.8 * hf(i, j, s ^ 21)) * CW1 - mx, gy = (j + 0.1 + 0.8 * hf(i, j, s ^ 22)) * CH1 - my;
        var gs = 18 + 18 * hf(i, j, s ^ 23), per = 5 + 6 * hf(i, j, s ^ 24), u = t / per + hf(i, j, s ^ 25);
        var k = Math.floor(u), fr = u - k, turn = fr > 0.84 ? smooth((fr - 0.84) / 0.16) : 0;
        var gold = ((h >>> 9) & 3) === 0, half = gs / 2;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate((k + turn) * Math.PI / 2);
        ctx.lineWidth = 1;
        ctx.globalAlpha = f.a * 0.08;
        ctx.strokeStyle = pal.primary;
        ctx.strokeRect(-half, -half, gs, gs);
        ctx.globalAlpha = f.a * (0.2 + 0.12 * turn);
        ctx.strokeStyle = gold ? pal.accent : pal.primary;
        ctx.beginPath();
        ctx.moveTo(0, -half); ctx.arc(-half, -half, half, 0, Math.PI / 2);
        ctx.moveTo(0, half); ctx.arc(half, half, half, Math.PI, Math.PI * 1.5);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------------ w2: crystal clusters cut from Voronoi cells
  var clusterSets = new Map();
  function columnPoly(bx, by, ang, len, wid) {
    var dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx, tip = wid * 0.85, hw = wid / 2;
    return [
      bx + nx * hw * 0.7, by + ny * hw * 0.7,
      bx + dx * len * 0.14 + nx * hw, by + dy * len * 0.14 + ny * hw,
      bx + dx * (len - tip) + nx * hw, by + dy * (len - tip) + ny * hw,
      bx + dx * len, by + dy * len,
      bx + dx * (len - tip) - nx * hw, by + dy * (len - tip) - ny * hw,
      bx + dx * len * 0.14 - nx * hw, by + dy * len * 0.14 - ny * hw,
      bx - nx * hw * 0.7, by - ny * hw * 0.7
    ];
  }
  function buildClusters(seed, pal) {
    var U = util();
    if (!U) return null;
    var res = clamp(U.devicePx(), 1, 2), protos = [];
    for (var k = 0; k < 5; k++) {
      var r = U.rng(hash3(k, 77, seed)), cols = 3 + r.int(0, 3), polys = [], i, q;
      var minX = 0, maxX = 0, minY = 0, maxY = 0;
      for (i = 0; i < cols; i++) {
        var mid = (cols - 1) / 2, off = i - mid;
        var ang = -Math.PI / 2 + off * (0.34 + r.range(-0.08, 0.08)) + r.range(-0.08, 0.08);
        var len = r.range(80, 175) * (1 - Math.abs(off) * 0.17), wid = r.range(15, 28);
        var poly = columnPoly(r.range(-12, 12), r.range(-4, 4), ang, len, wid);
        for (q = 0; q < poly.length; q += 2) {
          minX = Math.min(minX, poly[q]); maxX = Math.max(maxX, poly[q]);
          minY = Math.min(minY, poly[q + 1]); maxY = Math.max(maxY, poly[q + 1]);
        }
        polys.push(poly);
      }
      var pad = 6, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2, ax = -minX + pad, ay = -minY + pad;
      var cv = U.makeCanvas(w * res, h * res), x = U.ctxOf(cv);
      if (!cv || !x) return null;
      x.setTransform(res, 0, 0, res, ax * res, ay * res);
      x.lineJoin = 'round';
      x.lineCap = 'round';
      var light = -2.3 + r.range(-0.3, 0.3);
      for (i = 0; i < polys.length; i++) {
        var col = polys[i], tipX = col[6], tipY = col[7], baseX = (col[0] + col[12]) / 2, baseY = (col[1] + col[13]) / 2;
        // Voronoi cut: 2..4 sites along the column axis, each cell clipped to the column
        var m = 2 + r.int(0, 2), sites = [];
        for (q = 0; q < m; q++) {
          var tt = (q + 0.5) / m + r.range(-0.12, 0.12);
          sites.push(baseX + (tipX - baseX) * tt + r.range(-6, 6), baseY + (tipY - baseY) * tt + r.range(-6, 6));
        }
        for (q = 0; q < m; q++) {
          var others = sites.slice(0, q * 2).concat(sites.slice(q * 2 + 2));
          var cell = U.voronoiCell(sites[q * 2], sites[q * 2 + 1], others, minX - 20, minY - 20, w + 40, h + 40);
          var shard = U.clipConvex(cell, col);
          var n = shard.length >> 1;
          if (n < 3) continue;
          var scx = 0, scy = 0, e;
          for (e = 0; e < n; e++) { scx += shard[e * 2]; scy += shard[e * 2 + 1]; }
          scx /= n; scy /= n;
          var apx = scx + (tipX - baseX) * 0.08, apy = scy + (tipY - baseY) * 0.08;
          for (e = 0; e < n; e++) {
            var e2 = e + 1 === n ? 0 : e + 1;
            var lit = 0.5 + 0.5 * Math.cos(Math.atan2((shard[e * 2 + 1] + shard[e2 * 2 + 1]) * 0.5 - apy, (shard[e * 2] + shard[e2 * 2]) * 0.5 - apx) - light);
            x.globalAlpha = 0.06 + 0.34 * lit * lit;
            x.fillStyle = pal.primary;
            x.beginPath(); x.moveTo(apx, apy); x.lineTo(shard[e * 2], shard[e * 2 + 1]); x.lineTo(shard[e2 * 2], shard[e2 * 2 + 1]); x.closePath(); x.fill();
          }
          x.globalAlpha = 0.3; x.strokeStyle = pal.primary; x.lineWidth = 0.7;
          x.beginPath();
          for (e = 0; e < n; e++) { x.moveTo(apx, apy); x.lineTo(shard[e * 2], shard[e * 2 + 1]); }
          x.stroke();
          x.globalAlpha = 0.75; x.lineWidth = 1.1;
          x.beginPath(); x.moveTo(shard[0], shard[1]);
          for (e = 1; e < n; e++) x.lineTo(shard[e * 2], shard[e * 2 + 1]);
          x.closePath(); x.stroke();
        }
        x.globalAlpha = 0.95; x.strokeStyle = mix(pal.primary, pal.ink, 0.35); x.lineWidth = 1.5;
        x.beginPath(); x.moveTo(col[0], col[1]);
        for (q = 2; q < col.length; q += 2) x.lineTo(col[q], col[q + 1]);
        x.closePath(); x.stroke();
        x.globalAlpha = 0.9; x.fillStyle = pal.accent;
        x.beginPath(); dot(x, tipX, tipY, 1.6); x.fill();
      }
      var flat = new Float32Array(polys.length * 4);
      for (i = 0; i < polys.length; i++) {
        flat[i * 4] = polys[i][2]; flat[i * 4 + 1] = polys[i][3]; flat[i * 4 + 2] = polys[i][4]; flat[i * 4 + 3] = polys[i][5];
      }
      protos.push({ canvas: cv, w: w, h: h, ax: ax, ay: ay, edges: flat, n: polys.length });
    }
    return protos;
  }
  function clusterProtos(seed, pal) {
    var key = (seed >>> 0) + '|' + pal.primary + pal.accent + pal.ink;
    if (clusterSets.has(key)) return clusterSets.get(key);
    if (clusterSets.size >= 4) clusterSets.clear();
    var set = null;
    try { set = buildClusters(seed, pal); } catch (e) { set = null; }
    clusterSets.set(key, set);
    return set;
  }

  var CW2 = 520, CH2 = 400;
  function mgW2(ctx, f, pal) {
    var protos = clusterProtos(f.seed, pal), mx = f.cx * PAR, my = f.cy * PAR, s = f.seed, t = f.t * (1 + 0.6 * f.inten), i, j;
    if (protos && protos.length) {
      var i0 = Math.floor((mx - 260) / CW2), i1 = Math.floor((mx + W + 260) / CW2);
      var j0 = Math.floor((my - 260) / CH2), j1 = Math.floor((my + H + 260) / CH2);
      for (j = j0; j <= j1; j++) {
        for (i = i0; i <= i1; i++) {
          var h = hash3(i, j, s ^ 0xC2);
          if ((h % 100) >= 68) continue;
          var P = protos[(h >>> 8) % protos.length], hang = ((h >>> 12) & 3) === 0;
          var sc = 0.6 + 0.5 * hf(i, j, s ^ 31), flip = ((h >>> 14) & 1) ? -1 : 1;
          var x = (i + 0.15 + 0.7 * hf(i, j, s ^ 32)) * CW2 - mx, y = (hang ? j + 0.12 : j + 0.92) * CH2 - my;
          if (x + P.w * sc < -10 || x - P.w * sc > W + 10 || y + P.h * sc < -10 || y - P.h * sc > H + 10) continue;
          var breathe = 0.85 + 0.15 * Math.sin(t * 0.6 + (h & 63));
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(sc * flip, hang ? -sc : sc);
          ctx.globalAlpha = f.a * 0.34 * breathe * (1 + 0.35 * f.pulse);
          ctx.drawImage(P.canvas, -P.ax, -P.ay, P.w, P.h);
          // a glint running up one facet edge
          var g = (Math.floor(t / 2.7 + (h & 15)) % P.n), u = frac(t / 2.7 + (h & 15));
          if (u < 0.55) {
            var e = P.edges, k = g * 4, a = u / 0.55, b = Math.min(1, a + 0.18);
            ctx.globalAlpha = f.a * 0.7 * Math.sin(Math.PI * a);
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = pal.accent;
            ctx.lineWidth = 1.6 / sc;
            ctx.beginPath();
            ctx.moveTo(e[k] + (e[k + 2] - e[k]) * a, e[k + 1] + (e[k + 3] - e[k + 1]) * a);
            ctx.lineTo(e[k] + (e[k + 2] - e[k]) * b, e[k + 1] + (e[k + 3] - e[k + 1]) * b);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
    // drifting crystal motes
    var n = Math.round(18 * f.q);
    ctx.fillStyle = pal.accent;
    for (var band = 0; band < 2; band++) {
      ctx.globalAlpha = f.a * (band ? 0.16 : 0.32);
      ctx.beginPath();
      for (i = band; i < n; i += 2) {
        var px = mod(hf(i, 1, s) * (W + 80) + Math.sin(t * 0.3 + i) * 18 - f.cx * 0.45, W + 80) - 40;
        var py = mod(hf(i, 2, s) * (H + 80) - t * (6 + 8 * hf(i, 3, s)) - f.cy * 0.45, H + 80) - 40;
        var r = 1.6 + 1.6 * hf(i, 4, s), tw = 0.6 + 0.4 * Math.sin(t * 2 + i * 2.3);
        ctx.moveTo(px, py - r * 1.8 * tw); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r * 1.8 * tw); ctx.lineTo(px - r, py); ctx.closePath();
      }
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ w3: streamline particles from AP.Flow
  var NP = 60, TL = 16, SLN = 44, NSL = 6;
  var pX = new Float32Array(NP), pY = new Float32Array(NP), pAge = new Float32Array(NP), pMax = new Float32Array(NP);
  var pSpd = new Float32Array(NP), pGold = new Uint8Array(NP);
  var trX = new Float32Array(NP * TL), trY = new Float32Array(NP * TL), trN = new Uint8Array(NP), trH = new Uint8Array(NP);
  var slXY = new Float32Array(NSL * SLN * 2), slTmp = new Float32Array(SLN * 2), slBorn = new Float32Array(NSL), slLife = new Float32Array(NSL);
  var w3s = { on: false, lastT: 0, seed: -1, L: null, rng: null, next: 0 };
  var flowO = { x: 1, y: 0, m: 0.5 };

  // seeded fallback stream (only used if the kit is missing)
  function lcg(seed) {
    var a = seed >>> 0;
    return { next: function () { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; } };
  }
  function w3Spawn(i, f, fresh) {
    var r = w3s.rng;
    var sx = r.next() * W, sy = r.next() * H;
    pX[i] = sx + f.cx * PAR; pY[i] = sy + f.cy * PAR;
    pAge[i] = fresh ? r.next() * 4 : 0;
    pMax[i] = 4 + r.next() * 5;
    pSpd[i] = 55 + r.next() * 85;
    pGold[i] = r.next() < 0.14 ? 1 : 0;
    trN[i] = 1; trH[i] = 0;
    trX[i * TL] = pX[i]; trY[i * TL] = pY[i];
  }
  function w3Reset(f) {
    var U = util();
    w3s.rng = U ? U.rng(hash3(f.seed, 3, 0x3F10)) : lcg(hash3(f.seed, 3, 0x3F10));
    for (var i = 0; i < NP; i++) w3Spawn(i, f, true);
    for (var k = 0; k < NSL; k++) { slBorn[k] = -100; slLife[k] = 0; }
    w3s.on = true; w3s.seed = f.seed; w3s.L = f.L; w3s.lastT = f.t; w3s.next = 0;
  }
  function flowParams(L) {
    var U = util();
    if (U && typeof U.flowParams === 'function') return U.flowParams(L);
    return (AP.Flow && AP.Flow.DEFAULT) || null;
  }
  function sampleFlow(x, y, t, fp) {
    var U = util();
    if (U && typeof U.flowSample === 'function') return U.flowSample(x, y, t, fp, flowO);
    var Fl = AP.Flow;
    if (Fl && typeof Fl.sample === 'function') return Fl.sample(x, y, t, fp || Fl.DEFAULT, flowO);
    flowO.x = 1; flowO.y = 0; flowO.m = 0.5;
    return flowO;
  }
  function w3Update(f) {
    var t = f.t;
    if (!w3s.on || w3s.seed !== f.seed || w3s.L !== f.L || t < w3s.lastT - 0.25 || t - w3s.lastT > 2) w3Reset(f);
    var dt = clamp(t - w3s.lastT, 0, 0.05);
    w3s.lastT = t;
    var fp = flowParams(f.L), n = Math.round(NP * f.q), i;
    for (i = 0; i < n; i++) {
      var sx = pX[i] - f.cx * PAR, sy = pY[i] - f.cy * PAR;
      sampleFlow(sx + f.cx, sy + f.cy, t, fp);
      var v = pSpd[i] * (0.35 + 0.65 * flowO.m) * (1 + 0.5 * f.inten);
      pX[i] += flowO.x * v * dt; pY[i] += flowO.y * v * dt; pAge[i] += dt;
      sx = pX[i] - f.cx * PAR; sy = pY[i] - f.cy * PAR;
      if (pAge[i] > pMax[i] || sx < -70 || sx > W + 70 || sy < -70 || sy > H + 70) { w3Spawn(i, f, false); continue; }
      var hd = i * TL + trH[i], ddx = pX[i] - trX[hd], ddy = pY[i] - trY[hd];
      if (ddx * ddx + ddy * ddy > 25) {
        trH[i] = (trH[i] + 1) % TL;
        trX[i * TL + trH[i]] = pX[i]; trY[i * TL + trH[i]] = pY[i];
        if (trN[i] < TL) trN[i]++;
      }
    }
    // field lines: one expired slot is re-traced per frame
    if (dt > 0) {
      for (var q = 0; q < NSL; q++) {
        var slot = (w3s.next + q) % NSL;
        if (t - slBorn[slot] < slLife[slot]) continue;
        traceLine(slot, f, fp);
        w3s.next = (slot + 1) % NSL;
        break;
      }
    }
  }
  function traceLine(slot, f, fp) {
    var r = w3s.rng, wx = f.cx + r.next() * W, wy = f.cy + r.next() * H, Fl = AP.Flow, i;
    if (Fl && typeof Fl.streamline === 'function' && fp) {
      Fl.streamline(wx, wy, f.t, fp, 14, SLN, slTmp);
    } else {
      var x = wx, y = wy;
      for (i = 0; i < SLN; i++) { slTmp[i * 2] = x; slTmp[i * 2 + 1] = y; sampleFlow(x, y, f.t, fp); x += flowO.x * 14; y += flowO.y * 14; }
    }
    var ox = -f.cx + f.cx * PAR, oy = -f.cy + f.cy * PAR, b = slot * SLN * 2;
    for (i = 0; i < SLN * 2; i += 2) { slXY[b + i] = slTmp[i] + ox; slXY[b + i + 1] = slTmp[i + 1] + oy; }
    slBorn[slot] = f.t;
    slLife[slot] = 5 + r.next() * 3;
  }
  function mgW3(ctx, f, pal) {
    w3Update(f);
    var ox = -f.cx * PAR, oy = -f.cy * PAR, i, k, n = Math.round(NP * f.q);
    ctx.lineWidth = 1;
    ctx.strokeStyle = pal.primary;
    for (var s = 0; s < NSL; s++) {
      var age = f.t - slBorn[s];
      if (age < 0 || age > slLife[s]) continue;
      var b = s * SLN * 2;
      ctx.globalAlpha = f.a * 0.1 * Math.sin(Math.PI * age / slLife[s]);
      ctx.beginPath();
      ctx.moveTo(slXY[b] + ox, slXY[b + 1] + oy);
      for (k = 2; k < SLN * 2; k += 2) ctx.lineTo(slXY[b + k] + ox, slXY[b + k + 1] + oy);
      ctx.stroke();
    }
    // batched: 3 fade buckets x 2 colours x (tail, head) = at most 12 strokes for the whole swarm
    for (var gold = 0; gold < 2; gold++) {
      ctx.strokeStyle = gold ? pal.accent : pal.primary;
      for (var fb = 0; fb < 3; fb++) {
        for (var part = 0; part < 2; part++) {
          ctx.beginPath();
          var any = false;
          for (i = 0; i < n; i++) {
            var cnt = trN[i];
            if (cnt < 2 || pGold[i] !== gold) continue;
            var fade = Math.min(1, pAge[i] / 0.7, (pMax[i] - pAge[i]) / 0.9);
            var bucket = fade > 0.8 ? 2 : (fade > 0.45 ? 1 : (fade > 0.1 ? 0 : -1));
            if (bucket !== fb) continue;
            var head = trH[i], base = i * TL, lim = part ? Math.min(cnt, 4) : cnt;
            ctx.moveTo(pX[i] + ox, pY[i] + oy);
            for (k = 0; k < lim; k++) { var idx = base + ((head - k + TL) % TL); ctx.lineTo(trX[idx] + ox, trY[idx] + oy); }
            any = true;
          }
          if (!any) continue;
          var fa = fb === 2 ? 1 : (fb === 1 ? 0.62 : 0.3);
          ctx.globalAlpha = f.a * (part ? 0.38 : 0.16) * fa;
          ctx.lineWidth = part ? 1.4 : 1;
          ctx.stroke();
        }
      }
    }
  }

  // ------------------------------------------------------------------ w4: L-system trees
  var TREE_DEFS = [
    { axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, iters: 4, angle: 25, w: 2.6 },
    { axiom: 'X', rules: { X: 'F[+X][-X]FX', F: 'FF' }, iters: 5, angle: 25.7, w: 2.4 },
    { axiom: 'F', rules: { F: 'FF-[-F+F+F]+[+F-F-F]' }, iters: 3, angle: 22.5, w: 2.8 },
    { axiom: 'X', rules: { X: 'F[+X]F[-X]+X', F: 'FF' }, iters: 5, angle: 20, w: 2.4 }
  ];
  var treeSets = new Map();

  // turtle segments -> merged collinear runs, normalised (root 0,0; height 1, growing toward -y),
  // bucketed by depth, each bucket sorted by path distance from the root (for uniform growth)
  function buildTree(def, seed, k) {
    var U = util();
    if (!U) return null;
    var r = U.rng(hash3(k, 91, seed));
    var str = U.lsystem(def.axiom, def.rules, def.iters, 20000);
    var ang = (def.angle + r.range(-2.5, 2.5)) * Math.PI / 180;
    var tr = U.turtle(str, { x: 0, y: 0, heading: -Math.PI / 2 + r.range(-0.08, 0.08), step: 1, angle: ang, shrink: 1 });
    var segs = tr.segs, i, m = [];
    for (i = 0; i < segs.length; i++) {
      var sg = segs[i], last = m.length ? m[m.length - 1] : null;
      if (last && last[4] === sg[4] && Math.abs(last[2] - sg[0]) < 1e-6 && Math.abs(last[3] - sg[1]) < 1e-6) {
        var ax = last[2] - last[0], ay = last[3] - last[1], bx = sg[2] - sg[0], by = sg[3] - sg[1];
        if (Math.abs(ax * by - ay * bx) < 1e-6 * Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by)) + 1e-12 && ax * bx + ay * by > 0) {
          last[2] = sg[2]; last[3] = sg[3];
          continue;
        }
      }
      m.push([sg[0], sg[1], sg[2], sg[3], sg[4]]);
    }
    var minY = 0, minX = 0, maxX = 0;
    for (i = 0; i < m.length; i++) {
      minY = Math.min(minY, m[i][1], m[i][3]);
      minX = Math.min(minX, m[i][0], m[i][2]); maxX = Math.max(maxX, m[i][0], m[i][2]);
    }
    var hgt = -minY || 1;
    var dist = new Map(), key = function (x, y) { return Math.round(x * 64) + ',' + Math.round(y * 64); }, maxD = 0;
    dist.set(key(0, 0), 0);
    var recs = [];
    for (i = 0; i < m.length; i++) {
      var s0 = m[i], d0 = dist.get(key(s0[0], s0[1])) || 0, len = Math.hypot(s0[2] - s0[0], s0[3] - s0[1]), d1 = d0 + len;
      dist.set(key(s0[2], s0[3]), d1);
      if (d1 > maxD) maxD = d1;
      recs.push([s0[0] / hgt, s0[1] / hgt, s0[2] / hgt, s0[3] / hgt, Math.min(7, s0[4]), d0, d1]);
    }
    maxD = maxD || 1;
    recs.sort(function (a, b) { return a[4] - b[4] || a[5] - b[5]; });
    var data = new Float32Array(recs.length * 6), dStart = new Int32Array(9), dEnd = new Int32Array(9), topD = 0;
    for (i = 0; i < 9; i++) { dStart[i] = 0; dEnd[i] = 0; }
    for (i = 0; i < recs.length; i++) {
      var R0 = recs[i], dd = R0[4];
      if (i === 0 || recs[i - 1][4] !== dd) dStart[dd] = i;
      dEnd[dd] = i + 1;
      if (dd > topD) topD = dd;
      data[i * 6] = R0[0]; data[i * 6 + 1] = R0[1]; data[i * 6 + 2] = R0[2]; data[i * 6 + 3] = R0[3];
      data[i * 6 + 4] = R0[5] / maxD; data[i * 6 + 5] = R0[6] / maxD;
    }
    var lv = tr.leaves, step = Math.max(1, Math.floor(lv.length / 34)), nl = 0;
    var leaves = new Float32Array(Math.ceil(lv.length / step) * 3);
    for (i = 0; i < lv.length; i += step) {
      var ld = dist.get(key(lv[i][0], lv[i][1]));
      leaves[nl * 3] = lv[i][0] / hgt; leaves[nl * 3 + 1] = lv[i][1] / hgt; leaves[nl * 3 + 2] = (ld === undefined ? maxD : ld) / maxD;
      nl++;
    }
    return { segs: data, dStart: dStart, dEnd: dEnd, maxDepth: topD, leaves: leaves, nLeaves: nl, w: def.w, spread: (maxX - minX) / hgt };
  }
  function treeProtos(seed) {
    var key = seed >>> 0;
    if (treeSets.has(key)) return treeSets.get(key);
    if (treeSets.size >= 4) treeSets.clear();
    var set = [];
    try {
      for (var k = 0; k < TREE_DEFS.length; k++) { var P = buildTree(TREE_DEFS[k], seed, k); if (P) set.push(P); }
    } catch (e) { set = []; }
    treeSets.set(key, set);
    return set;
  }

  var growth = new Map();
  var w4s = { lastT: 0, seed: -1, L: null };
  function drawTree(ctx, P, x, y, hgt, g, sw, pal, a, pulse) {
    var S = P.segs, d, k;
    ctx.strokeStyle = pal.primary;
    for (d = 0; d <= P.maxDepth; d++) {
      var s0 = P.dStart[d], s1 = P.dEnd[d];
      if (s1 <= s0) continue;
      ctx.lineWidth = Math.max(0.55, P.w * Math.pow(0.7, d) * (hgt / 240));
      ctx.globalAlpha = a * (d < 2 ? 1 : 0.85);
      ctx.beginPath();
      var any = false;
      for (k = s0; k < s1; k++) {
        var o = k * 6, d0 = S[o + 4];
        if (d0 >= g) break;
        var x1 = S[o], y1 = S[o + 1], x2 = S[o + 2], y2 = S[o + 3], d1 = S[o + 5];
        if (d1 > g) { var u = (g - d0) / (d1 - d0); x2 = x1 + (x2 - x1) * u; y2 = y1 + (y2 - y1) * u; }
        ctx.moveTo(x + x1 * hgt + sw * y1 * y1, y + y1 * hgt);
        ctx.lineTo(x + x2 * hgt + sw * y2 * y2, y + y2 * hgt);
        any = true;
      }
      if (any) ctx.stroke();
    }
    if (g > 0.5) {
      var L = P.leaves;
      ctx.fillStyle = pal.accent;
      ctx.globalAlpha = a * 1.25;
      ctx.beginPath();
      for (k = 0; k < P.nLeaves; k++) {
        var bloom = clamp((g - L[k * 3 + 2]) / 0.12, 0, 1);
        if (bloom <= 0) continue;
        var lx = x + L[k * 3] * hgt + sw * L[k * 3 + 1] * L[k * 3 + 1], ly = y + L[k * 3 + 1] * hgt;
        var rr = (1.4 + 1.3 * ((k * 7) % 5) / 4) * bloom * (1 + 0.25 * pulse);
        starPath(ctx, lx, ly, rr, rr * 0.45, 5, k);
      }
      ctx.fill();
    }
  }
  var CW4 = 440, CH4 = 380;
  function mgW4(ctx, f, pal) {
    var protos = treeProtos(f.seed), t = f.t, s = f.seed, mx = f.cx * PAR, my = f.cy * PAR, i, j;
    if (w4s.seed !== s || w4s.L !== f.L || t < w4s.lastT - 0.5) { growth.clear(); w4s.seed = s; w4s.L = f.L; }
    w4s.lastT = t;
    if (growth.size > 256) growth.clear();
    if (protos.length) {
      var i0 = Math.floor((mx - 200) / CW4), i1 = Math.floor((mx + W + 200) / CW4);
      var j0 = Math.floor((my - 40) / CH4), j1 = Math.floor((my + H + 420) / CH4);
      for (j = j0; j <= j1; j++) {
        for (i = i0; i <= i1; i++) {
          var h = hash3(i, j, s ^ 0x7EE);
          if ((h % 100) >= 58) continue;
          var P = protos[(h >>> 8) % protos.length];
          var hgt = 150 + 150 * hf(i, j, s ^ 41), x = (i + 0.15 + 0.7 * hf(i, j, s ^ 42)) * CW4 - mx, y = (j + 1) * CH4 - my - 8;
          var half = P.spread * hgt * 0.6 + 20;
          if (x + half < 0 || x - half > W || y - hgt > H || y < -20) continue;
          var ck = (j + 4096) * 65536 + (i + 4096), born = growth.get(ck);
          if (born === undefined || t - born.seen > 8) { born = { at: t, seen: t }; growth.set(ck, born); }
          born.seen = t;
          var g = smooth((t - born.at) / 3.4);
          var sw = (6 + 6 * hf(i, j, s ^ 43)) * (Math.sin(t * 0.85 + (h & 255)) + 0.35 * Math.sin(t * 2.1 + (h & 127) * 1.7)) * (1 + f.inten);
          drawTree(ctx, P, x, y, hgt, g, sw, pal, f.a * (0.2 + 0.08 * hf(i, j, s ^ 44)), f.pulse);
        }
      }
    }
    // drifting petals
    var n = Math.round(14 * f.q);
    ctx.fillStyle = pal.accent;
    ctx.globalAlpha = f.a * 0.24;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var px = mod(hf(i, 1, s) * (W + 60) + Math.sin(t * 0.7 + i) * 26 + t * 9 - f.cx * 0.4, W + 60) - 30;
      var py = mod(hf(i, 2, s) * (H + 60) + t * (12 + 10 * hf(i, 3, s)) - f.cy * 0.4, H + 60) - 30;
      var a = t * (0.8 + hf(i, 4, s)) + i, r = 2 + 1.5 * hf(i, 5, s);
      ctx.moveTo(px + Math.cos(a) * r * 1.6, py + Math.sin(a) * r * 1.6);
      ctx.lineTo(px + Math.cos(a + 2.4) * r, py + Math.sin(a + 2.4) * r);
      ctx.lineTo(px + Math.cos(a - 2.4) * r, py + Math.sin(a - 2.4) * r);
      ctx.closePath();
    }
    ctx.fill();
  }

  // ------------------------------------------------------------------ w5: harmonographs, Lissajous, phyllotaxis
  var HP = { cx: 0, cy: 0, a1: 0, f1: 0, p1: 0, d1: 0, a2: 0, f2: 0, p2: 0, d2: 0, a3: 0, f3: 0, p3: 0, d3: 0, a4: 0, f4: 0, p4: 0, d4: 0 };
  var hpOut = { x: 0, y: 0 };
  var LISS = [1, 2, 2, 3, 3, 4, 3, 5, 4, 5, 5, 6];
  var CW5 = 600, CH5 = 420, HTMAX = 40, HCYC = 30;
  function harmPoint(t) {
    var A = AP.Algo;
    if (A && typeof A.harmonograph === 'function') return A.harmonograph(t, HP, hpOut);
    var U = util();
    if (U) return U.harmPt(t, HP, hpOut);
    hpOut.x = HP.cx; hpOut.y = HP.cy;
    return hpOut;
  }
  function drawHarmonograph(ctx, f, pal, cx, cy, i, j, sc) {
    var s = f.seed, off = hf(i, j, s ^ 51) * HCYC, cyc = Math.floor((f.t + off) / HCYC), u = (f.t + off) - cyc * HCYC;
    var hs = hash3(i * 31 + cyc, j, s ^ 52), base = 0.2 + 0.05 * ((hs & 255) / 255), dt = 0.008;
    HP.cx = cx; HP.cy = cy;
    HP.a1 = 78 * sc; HP.f1 = base * 2 * (1 + dt * (((hs >>> 8) & 15) / 7.5 - 1)); HP.p1 = ((hs >>> 12) & 63) / 10; HP.d1 = 0.016;
    HP.a2 = 34 * sc; HP.f2 = base * 3 * (1 + dt * (((hs >>> 18) & 15) / 7.5 - 1)); HP.p2 = 0.7; HP.d2 = 0.022;
    HP.a3 = 70 * sc; HP.f3 = base * 3 * (1 + dt * (((hs >>> 22) & 15) / 7.5 - 1)); HP.p3 = ((hs >>> 26) & 63) / 10; HP.d3 = 0.018;
    HP.a4 = 30 * sc; HP.f4 = base * 2 * (1 + dt * ((hs & 15) / 7.5 - 1)); HP.p4 = 2.1; HP.d4 = 0.02;
    var head = Math.min(1, u / 22) * HTMAX, fade = u < 26 ? 1 : Math.max(0, 1 - (u - 26) / 4);
    if (head <= 0.2 || fade <= 0) return;
    var n = Math.max(8, Math.ceil(300 * head / HTMAX)), split = Math.max(0, head - 5), k, tt;
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = f.a * 0.11 * fade;
    ctx.beginPath();
    for (k = 0; k <= n; k++) {
      tt = head * k / n;
      if (tt > split && k > 0) break;
      harmPoint(tt);
      if (k === 0) ctx.moveTo(hpOut.x, hpOut.y); else ctx.lineTo(hpOut.x, hpOut.y);
    }
    ctx.stroke();
    ctx.globalAlpha = f.a * 0.3 * fade;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (k = 0; k <= 40; k++) {
      tt = split + (head - split) * k / 40;
      harmPoint(tt);
      if (k === 0) ctx.moveTo(hpOut.x, hpOut.y); else ctx.lineTo(hpOut.x, hpOut.y);
    }
    ctx.stroke();
    ctx.globalAlpha = f.a * 0.8 * fade;
    ctx.fillStyle = pal.accent;
    ctx.beginPath(); dot(ctx, hpOut.x, hpOut.y, 2 + f.pulse); ctx.fill();
  }
  function mgW5(ctx, f, pal) {
    var mx = f.cx * PAR, my = f.cy * PAR, s = f.seed, t = f.t * (1 + 0.5 * f.inten), A = AP.Art, i, j;
    var i0 = Math.floor((mx - 200) / CW5), i1 = Math.floor((mx + W + 200) / CW5);
    var j0 = Math.floor((my - 200) / CH5), j1 = Math.floor((my + H + 200) / CH5);
    for (j = j0; j <= j1; j++) {
      for (i = i0; i <= i1; i++) {
        var h = hash3(i, j, s ^ 0x55), kind = h % 3;
        var cx = (i + 0.25 + 0.5 * hf(i, j, s ^ 61)) * CW5 - mx, cy = (j + 0.25 + 0.5 * hf(i, j, s ^ 62)) * CH5 - my;
        if (cx < -190 || cx > W + 190 || cy < -190 || cy > H + 190) continue;
        var sc = 0.75 + 0.5 * hf(i, j, s ^ 63);
        if (kind === 0) {
          drawHarmonograph(ctx, f, pal, cx, cy, i, j, sc);
        } else if (kind === 1 && A && typeof A.lissajous === 'function') {
          var li = ((h >>> 4) % 6) * 2, fx = LISS[li], fy = LISS[li + 1], ax = (60 + 50 * hf(i, j, s ^ 64)) * sc, ay = (50 + 40 * hf(i, j, s ^ 65)) * sc;
          var ph = t * 0.12 + (h & 255) * 0.03;
          ctx.globalAlpha = f.a * 0.16;
          A.lissajous(ctx, cx, cy, ax, ay, fx, fy, ph, pal.primary, 1, 200);
          var q = t * 0.25 + (h & 63);
          ctx.globalAlpha = f.a * 0.75;
          ctx.fillStyle = pal.accent;
          ctx.beginPath(); dot(ctx, cx + ax * Math.sin(fx * q + ph), cy + ay * Math.sin(fy * q), 1.8 + f.pulse); ctx.fill();
        } else if (A && typeof A.phyllo === 'function') {
          ctx.globalAlpha = f.a * (0.26 + 0.14 * f.pulse);
          A.phyllo(ctx, cx, cy, Math.round(150 * sc), 5.2 * sc, mix(pal.accent, pal.ink, 0.35), 1.25, t);
        }
      }
    }
  }

  // ------------------------------------------------------------------ void: the singularity unmakes geometry
  function mgVoid(ctx, f, pal) {
    var t = f.t, s = f.seed, cx = W / 2 + Math.sin(t * 0.13) * 14, cy = H / 2 + Math.cos(t * 0.09) * 9;
    var Rh = 44 + 26 * f.inten, n = Math.round(22 * f.q), i, k;
    // harmonograph arms spiralling into the horizon
    ctx.lineWidth = 1;
    for (var arm = 0; arm < 3; arm++) {
      ctx.strokeStyle = arm === 1 ? pal.accent : pal.primary;
      ctx.globalAlpha = f.a * (0.09 + 0.05 * f.pulse);
      ctx.beginPath();
      for (k = 0; k <= 90; k++) {
        var u = k / 90, r = Rh * 1.4 + (330 - Rh * 1.4) * (1 - u) + 14 * Math.sin(u * 19 + t * 1.3 + arm * 2);
        var a = arm * TAU / 3 + u * 4.2 + t * (0.16 + 0.06 * f.inten);
        var x = cx + Math.cos(a) * r * 1.25, y = cy + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // polygons falling inward, losing a side at each stage (6 -> 3), then gone
    for (i = 0; i < n; i++) {
      var per = 14 + 8 * hf(i, 1, s), ph = frac(t / per + hf(i, 2, s));
      var r2 = Rh + (470 - Rh) * Math.pow(1 - ph, 1.4), a2 = hf(i, 3, s) * TAU + t * 0.2 + 3.2 * ph * ph;
      var px = cx + Math.cos(a2) * r2 * 1.2, py = cy + Math.sin(a2) * r2 * 0.85;
      var sides = 6 - Math.min(3, Math.floor(ph * 4)), size = 3 + 10 * (1 - ph);
      var al = 0.28 * Math.min(1, ph * 6) * (ph > 0.9 ? (1 - ph) * 10 : 1);
      if (al <= 0.005) continue;
      ctx.globalAlpha = f.a * al;
      ctx.strokeStyle = (i % 5) === 0 ? pal.accent : pal.primary;
      ctx.beginPath(); polyPath(ctx, px, py, size, sides, a2 * 1.7 + t); ctx.stroke();
    }
    // the horizon itself gets a faint dashed ring on the beat
    if (f.pulse > 0.05) {
      ctx.globalAlpha = f.a * 0.3 * f.pulse;
      ctx.strokeStyle = pal.hazard;
      ctx.beginPath();
      for (k = 0; k < 24; k++) {
        var a0 = k * TAU / 24 + t * 0.3;
        ctx.moveTo(cx + Math.cos(a0) * Rh * 1.9, cy + Math.sin(a0) * Rh * 1.9);
        ctx.arc(cx, cy, Rh * 1.9, a0, a0 + TAU / 48);
      }
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ endless: crossfade with the background cycle
  var RENDER = { title: mgTitle, map: mgMap, w1: mgW1, w2: mgW2, w3: mgW3, w4: mgW4, w5: mgW5, 'void': mgVoid };
  var WORLD_FN = [mgW1, mgW2, mgW3, mgW4, mgW5];
  var mixOut = { a: 0, b: 1, m: 0 };
  var tintCache = Object.create(null);
  function tinted(pal, wk) {
    var key = pal.primary + pal.accent + pal.bg + wk, o = tintCache[key];
    if (!o) {
      var w = worldPal(wk);
      o = tintCache[key] = { bg: pal.bg, primary: mix(pal.primary, w.primary, 0.45), accent: mix(pal.accent, w.accent, 0.45), hazard: pal.hazard, ink: pal.ink };
    }
    return o;
  }
  function endlessMix(t) {
    var B = AP.Backgrounds;
    if (B && typeof B.endlessMix === 'function') return B.endlessMix(t, mixOut);
    var cyc = t / 22, k = Math.floor(cyc), fr = cyc - k;
    mixOut.a = ((k % 5) + 5) % 5; mixOut.b = (mixOut.a + 1) % 5;
    mixOut.m = fr < 0.78 ? 0 : smooth((fr - 0.78) / 0.22);
    return mixOut;
  }
  function mgEndless(ctx, f, pal) {
    var m = endlessMix(f.t), base = f.a;
    f.a = base * (1 - m.m);
    if (f.a > 0.01) WORLD_FN[m.a](ctx, f, tinted(pal, WORLD_KEYS[m.a]));
    if (m.m > 0.01) { f.a = base * m.m; WORLD_FN[m.b](ctx, f, tinted(pal, WORLD_KEYS[m.b])); }
    f.a = base;
  }
  RENDER.endless = mgEndless;

  // ------------------------------------------------------------------ entry point
  function beatPulse(p) {
    var U = util();
    if (U && typeof U.beatPulse === 'function') return U.beatPulse(p);
    var ph = (p && typeof p.phase === 'number') ? clamp(p.phase, 0, 1) : 0.5, q = 1 - ph;
    return q * q * q * q;
  }

  function render(ctx, key, p) {
    if (!ctx) return;
    p = p || EMPTY;
    var q = p.quality || (AP.R && AP.R.quality) || null;
    if (q && (q.mid === false || q.bg === 'off')) return;
    var fn = RENDER[key] || mgTitle;
    var L = p.L || null;
    F.t = num(p.t, 0);
    F.cx = num(p.camX, 0);
    F.cy = num(p.camY, 0);
    F.a = 1;
    F.L = L;
    F.pal = palFor(key, p);
    F.seed = (L && typeof L.seed === 'number') ? (L.seed >>> 0) : (typeof p.seed === 'number' ? (p.seed >>> 0) : (AP.hash ? AP.hash(String(key)) : 7));
    F.pulse = beatPulse(p);
    F.inten = (key === 'title' || key === 'map') ? 0 : clamp(num(p.intensity, 0), 0, 1);
    F.q = (q && q.bg === 'low') ? 0.6 : 1;
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'source-over';
      // thin (<= 1.5u) strokes: miter joins and butt caps rasterise far cheaper than round ones and look
      // the same at this width (round joins on hundreds of tiny polyline segments dominate CPU raster cost)
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 4;
      fn(ctx, F, F.pal);
    } finally {
      ctx.restore();
    }
  }

  AP.Midground = {
    render: render,
    keys: ['title', 'map', 'w1', 'w2', 'w3', 'w4', 'w5', 'endless', 'void'],
    PARALLAX: PAR
  };
})(window.AP = window.AP || {});
