/* js/worlds/w4/entities.js — owner: W4 */
(function (AP) {
  'use strict';

  // W4 · Fractal Gardens (Hexagon). Types:
  //   w4.vine   an L-system plant (AP.Algo.lsystem + turtle). Its leaves are one-way pads (w4.leaf children with
  //             child.parent = vine) that unfurl as the growth front passes them. grow: near | touch | trigger | beat.
  //             preset 'bloom' is a flower lift: its single pad rides the stem tip up and back down.
  //   w4.leaf   the pad child of a vine (one-way solid; the vine drives it).
  //   w4.thorn  a Koch-curve bramble strip (hazard). Static, or cycling on a period / the beat / once, with an
  //             iteration telegraph: the curve grows depth 0 -> n before it can hurt.
  //   w4.sierp  a Sierpinski triangle that splits into its three corners (depth + 1) when hit, down to depth 2.
  //   w4.fruit  a hexagonal pomegranate that refreshes dash and double jump, then regrows.
  //   w4.pod    a seed pod: touching or dashing it sets L.flags[tag] and emits w4:grow {tag} (trigger vines).
  // FX presets: w4.leaves w4.petals w4.bloom w4.split w4.shatter w4.thorn w4.juice w4.wilt w4.sprout w4.seed

  var M = AP.M;
  var TAU = Math.PI * 2;
  var T = 32;
  var DEG = Math.PI / 180;
  var SQ3_2 = Math.sqrt(3) / 2;

  // ---------------------------------------------------------------- helpers
  function palOf(L) { return (L && L.pal) || AP.R.pal('w4'); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; return (1 - ph) * (1 - ph) * (1 - ph); }
  function hashf(a, b, c) { return (AP.hash2(a | 0, b | 0, (c | 0) + 0x4F4) % 65536) / 65536; }
  function frac(v) { return v - Math.floor(v); }
  function outBack(t) { return AP.M.ease.outBack(clamp01(t)); }
  function onScreen(L, x, y, w, h, pad) { return !L.cam || L.cam.visible(x, y, w, h, pad); }

  // AP.Algo with fail-soft fallbacks (a missing helper must never break a level)
  function algo(name) { return (AP.Algo && typeof AP.Algo[name] === 'function') ? AP.Algo[name] : null; }
  function kochPts(x1, y1, x2, y2, depth, out) {
    var f = algo('koch');
    if (f) return f(x1, y1, x2, y2, depth, out);
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
    return [x1, y1, x1 + dx / 3, y1 + dy / 3, mx + dy * 0.29 * out, my - dx * 0.29 * out, x1 + dx * 2 / 3, y1 + dy * 2 / 3, x2, y2];
  }

  // per-palette derived colours (AP.Color.mix allocates, so they are computed once per palette)
  var shadeMemo = [];
  function shades(p) {
    for (var i = 0; i < shadeMemo.length; i++) if (shadeMemo[i].pal === p) return shadeMemo[i].tab;
    var mix = AP.Color.mix;
    var tab = {
      wilt: [], bodyH: mix(p.bg, p.hazard, 0.22), deepH: mix(p.bg, p.hazard, 0.45), dimA: mix(p.accent, p.bg, 0.55),
      stemDark: mix(p.primary, p.bg, 0.5), leafDark: mix(p.primary, p.bg, 0.7), pale: mix(p.primary, p.ink, 0.45),
      blush: mix(p.accent, p.ink, 0.35), dimH: mix(p.hazard, p.bg, 0.55), seedA: mix(p.accent, p.hazard, 0.35)
    };
    for (var k = 0; k <= 8; k++) tab.wilt.push(mix(p.primary, p.bg, 0.62 * k / 8));
    shadeMemo.push({ pal: p, tab: tab });
    if (shadeMemo.length > 12) shadeMemo.shift();
    return tab;
  }

  // ================================================================ FX presets (palette read at burst time)
  var EO = { n: 8, color: '#ffffff', color2: '#ffffff', shape: 'dot', speed: [60, 180], angle: [0, TAU], life: [0.3, 0.6],
    size: [2, 4], sizeEnd: 0, gravity: 0, drag: 0, spin: [-4, 4], additive: true, back: false, spread: 0, width: 2, align: false };
  function eo(n, c1, c2, shape, s0, s1, a0, a1, l0, l1, z0, z1) {
    EO.n = n; EO.color = c1; EO.color2 = c2 || c1; EO.shape = shape;
    EO.speed[0] = s0; EO.speed[1] = s1; EO.angle[0] = a0; EO.angle[1] = a1;
    EO.life[0] = l0; EO.life[1] = l1; EO.size[0] = z0; EO.size[1] = z1;
    EO.sizeEnd = 0; EO.gravity = 0; EO.drag = 0; EO.spin[0] = -4; EO.spin[1] = 4;
    EO.additive = true; EO.back = false; EO.spread = 0; EO.width = 2; EO.align = false;
    return EO;
  }
  function fxPal() { return (AP.level && AP.level.pal) || AP.R.pal('w4'); }
  function dirOf(o, d) { return typeof o.dir === 'number' ? o.dir : d; }

  AP.FX.preset('w4.leaves', function (x, y, o) {
    var p = fxPal(), a = dirOf(o, -Math.PI / 2), c = num(o.cone, 1.3);
    var q = eo(o.n || 6, o.color || p.primary, p.bg, 'tri', 40, 150, a - c, a + c, 0.45, 1.0, 2, 4.5);
    q.gravity = 240; q.drag = 2.4; q.spin[0] = -8; q.spin[1] = 8; q.additive = false; q.sizeEnd = -1; q.spread = o.spread || 4;
    return AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.petals', function (x, y, o) {
    var p = fxPal(), a = dirOf(o, -Math.PI / 2), c = num(o.cone, Math.PI);
    var q = eo(o.n || 8, o.color || p.accent, p.ink, 'tri', 30, 120, a - c, a + c, 0.7, 1.4, 2, 3.5);
    q.gravity = 70; q.drag = 1.6; q.spin[0] = -5; q.spin[1] = 5; q.sizeEnd = 0.5; q.spread = o.spread || 6;
    return AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.bloom', function (x, y, o) {
    var p = fxPal(), r = num(o.radius, 26);
    AP.FX.ring(x, y, r * 0.2, r * 1.6, 0.45, p.accent, 2);
    var q = eo(o.n || 12, p.accent, p.ink, 'star', 60, 200, 0, TAU, 0.4, 0.8, 2.5, 4.5);
    q.drag = 3; q.spin[0] = -6; q.spin[1] = 6;
    var k = AP.FX.emit(x, y, q);
    q = eo(Math.round((o.n || 12) * 0.6), p.primary, p.bg, 'tri', 40, 130, 0, TAU, 0.5, 1.0, 2, 3.5);
    q.gravity = 120; q.drag = 2; q.additive = false;
    return k + AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.split', function (x, y, o) {
    var p = fxPal(), r = num(o.radius, 22);
    AP.FX.ring(x, y, 2, r * 2.2, 0.32, o.color || p.hazard, 2.5);
    var q = eo(o.n || 12, o.color || p.hazard, p.ink, 'tri', 120, 320, 0, TAU, 0.3, 0.65, 2.5, 5.5);
    q.drag = 3.5; q.spin[0] = -14; q.spin[1] = 14;
    var k = AP.FX.emit(x, y, q);
    q = eo(6, p.ink, p.hazard, 'line', 180, 360, 0, TAU, 0.15, 0.3, 6, 12);
    q.align = true; q.width = 1.5;
    return k + AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.shatter', function (x, y, o) {
    var p = fxPal();
    AP.FX.ring(x, y, 2, num(o.radius, 18) * 1.8, 0.25, p.ink, 2);
    var q = eo(o.n || 9, o.color || p.hazard, p.bg, 'tri', 90, 260, 0, TAU, 0.35, 0.7, 2, 4);
    q.gravity = 380; q.drag = 1.2; q.spin[0] = -12; q.spin[1] = 12; q.additive = false;
    return AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.thorn', function (x, y, o) {
    var p = fxPal(), a = dirOf(o, -Math.PI / 2), c = num(o.cone, 0.5);
    var q = eo(o.n || 3, p.hazard, p.ink, 'line', 60, 150, a - c, a + c, 0.15, 0.3, 4, 8);
    q.align = true; q.width = 1.4; q.drag = 4; q.spread = o.spread || 6;
    return AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.juice', function (x, y, o) {
    var p = fxPal();
    AP.FX.ring(x, y, 4, 40, 0.35, p.accent, 2.5);
    AP.FX.ring(x, y, 2, 24, 0.25, p.ink, 1.5);
    var q = eo(o.n || 14, p.accent, p.ink, 'dot', 60, 240, 0, TAU, 0.35, 0.8, 2, 4);
    q.gravity = 260; q.drag = 1.8;
    var k = AP.FX.emit(x, y, q);
    q = eo(6, p.accent, p.primary, 'hex', 40, 110, 0, TAU, 0.4, 0.7, 2.5, 4);
    q.drag = 2.5;
    return k + AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.wilt', function (x, y, o) {
    var p = fxPal(), sh = shades(p);
    var q = eo(o.n || 4, sh.wilt[5], p.bg, 'tri', 10, 50, Math.PI * 0.2, Math.PI * 0.8, 0.8, 1.5, 2, 3.5);
    q.gravity = 90; q.drag = 1.2; q.spin[0] = -3; q.spin[1] = 3; q.additive = false; q.sizeEnd = -1; q.spread = o.spread || 10;
    return AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.sprout', function (x, y, o) {
    var p = fxPal(), a = dirOf(o, -Math.PI / 2), c = num(o.cone, 0.6);
    var q = eo(o.n || 5, p.primary, p.ink, 'line', 60, 170, a - c, a + c, 0.2, 0.45, 4, 9);
    q.align = true; q.width = 1.4; q.drag = 3; q.spread = o.spread || 5;
    return AP.FX.emit(x, y, q);
  });
  AP.FX.preset('w4.seed', function (x, y, o) {
    var p = fxPal();
    var q = eo(o.n || 6, p.hazard, p.bg, 'dot', 40, 140, 0, TAU, 0.25, 0.5, 1.5, 3);
    q.drag = 2.5; q.gravity = 200;
    var k = AP.FX.emit(x, y, q);
    q = eo(3, p.primary, p.bg, 'tri', 30, 80, -Math.PI * 0.85, -Math.PI * 0.15, 0.4, 0.7, 2, 3);
    q.drag = 2; q.gravity = 160; q.additive = false;
    return k + AP.FX.emit(x, y, q);
  });

  // ================================================================ w4.vine geometry (shared by init and lintRects)
  var VDIR = { up: 1, down: 1, left: 1, right: 1 };
  var VPRESET = {
    fern: { axiom: 'X', rules: { X: 'F[+X]F[-X]+X', F: 'FF' }, iters: 2, angle: 25, size: 18, blossom: 0.4, sway: 3 },
    willow: { axiom: 'F', rules: { F: 'F[-F]F[+F]F' }, iters: 2, angle: 17, size: 20, blossom: 0.25, sway: 4 },
    bush: { axiom: 'F', rules: { F: 'FF-[-F+F+F]+[+F-F-F]' }, iters: 2, angle: 22.5, size: 15, blossom: 0.6, sway: 2 },
    bloom: { axiom: 'X', rules: { X: 'F[+X][-X]FX', F: 'FF' }, iters: 2, angle: 27, size: 15, blossom: 0.85, sway: 1.5 }
  };
  function vDir(spec) { var d = spec && spec.dir; return VDIR[d] ? d : 'up'; }
  function vLen(spec) { var n = spec ? +spec.len : NaN; return n >= 1 ? Math.min(40, Math.round(n)) : 6; }
  function vPreset(spec) {
    var p = spec && spec.preset;
    if (p && VPRESET[p]) return p;
    return vDir(spec) === 'down' ? 'willow' : 'fern';
  }
  function vSideMode(spec) {
    var m = spec && spec.side;
    return (m === 'left' || m === 'right' || m === 'both' || m === 'altl') ? m : 'alt';
  }

  // Pads in TILE units: {x, y, w, d, side}: x,y = top-left of the pad's walkable top, w its width,
  // d = distance along the stem (tiles) where it attaches, side +1 right / -1 left / 0.
  //   up    root on the floor under tile (tx,ty); pads every 2 tiles (k = 2,4,..len), 2 wide, alternating sides
  //   down  root on the ceiling above tile (tx,ty); same pads hanging below
  //   right/left  root on the wall beside tile (tx,ty); a bridge of 1-tile pads on row ty, len tiles long
  //   preset 'bloom'  one 3-wide pad that rises len tiles from the floor (the grown position is reported)
  function vinePads(spec, tx, ty) {
    spec = spec || {};
    var dir = vDir(spec), len = vLen(spec), out = [], i, k;
    if (vPreset(spec) === 'bloom') {
      out.push({ x: tx - 1, y: ty + 1 - len, w: 3, d: len, side: 0 });
      return out;
    }
    if (dir === 'up' || dir === 'down') {
      var mode = vSideMode(spec), n = 0;
      for (k = 2; k <= len; k += 2, n++) {
        var y = dir === 'up' ? ty + 1 - k : ty + k;
        if (mode === 'both') {
          out.push({ x: tx + 1, y: y, w: 2, d: k, side: 1 });
          out.push({ x: tx - 2, y: y, w: 2, d: k, side: -1 });
          continue;
        }
        var sd = mode === 'right' ? 1 : mode === 'left' ? -1 : mode === 'altl' ? (n % 2 ? 1 : -1) : (n % 2 ? -1 : 1);
        out.push({ x: sd > 0 ? tx + 1 : tx - 2, y: y, w: 2, d: k, side: sd });
      }
    } else {
      for (i = 0; i < len; i++) out.push({ x: dir === 'right' ? tx + i : tx - i, y: ty, w: 1, d: i + 0.5, side: 0 });
    }
    return out;
  }

  // unit sprig of a preset: base at the origin pointing up, farthest point at distance 1 (built once)
  var sprigUnits = {};
  function sprigUnit(name) {
    var u = sprigUnits[name];
    if (u) return u;
    var P = VPRESET[name] || VPRESET.fern;
    var str = AP.Algo.lsystem(P.axiom, P.rules, P.iters, 6000);
    var tr = AP.Algo.turtle(str, { x: 0, y: 0, heading: -Math.PI / 2, step: 1, angle: P.angle * DEG, shrink: 1 });
    var maxD = 1e-6, i, sg;
    for (i = 0; i < tr.segs.length; i++) {
      sg = tr.segs[i];
      maxD = Math.max(maxD, Math.sqrt(sg[2] * sg[2] + sg[3] * sg[3]), Math.sqrt(sg[0] * sg[0] + sg[1] * sg[1]));
    }
    var segs = new Float32Array(tr.segs.length * 4);
    for (i = 0; i < tr.segs.length; i++) {
      sg = tr.segs[i];
      segs[i * 4] = sg[0] / maxD; segs[i * 4 + 1] = sg[1] / maxD; segs[i * 4 + 2] = sg[2] / maxD; segs[i * 4 + 3] = sg[3] / maxD;
    }
    var tips = [];
    var lv = tr.leaves;
    var stepL = Math.max(1, Math.floor(lv.length / 7));
    for (i = 0; i < lv.length; i += stepL) tips.push(lv[i][0] / maxD, lv[i][1] / maxD);
    u = { segs: segs, n: tr.segs.length, tips: new Float32Array(tips), nt: tips.length / 2 };
    sprigUnits[name] = u;
    return u;
  }

  // ================================================================ w4.leaf (vine pad)
  AP.Entities.register('w4.leaf', {
    kind: 'solid', oneWay: true, anchor: 'tile', layer: 3, lint: 'ignore', renderPad: 40,
    size: function (spec) { return [Math.max(1, Math.round(num(spec.w, 2))) * T, 12]; },
    init: function (e, spec) {
      var s = e.s;
      s.kind = spec.kind || 'frond';
      s.side = spec.side || 1;
      s.u = 0;
      s.wilt = 0;
      s.dip = 0;
      s.dipV = 0;
      s.ride = false;
      s.lift = 0;
      s.seed = (e.id * 7.31) % 10;
      e.collidable = spec.kind === 'bloom';
    },
    render: function (e, ctx, L) {
      var s = e.s;
      if (s.u <= 0.01) return;
      var p = palOf(L), sh = shades(p);
      var wl = s.wilt;
      var col = wl > 0.01 ? sh.wilt[Math.round(wl * 8)] : p.primary;
      var jx = wl > 0.01 ? Math.sin((L.time + s.seed) * 47) * 1.5 * wl : 0;
      var x = e.rx + jx, y = e.ry + s.dip * 3, w = e.w;
      if (s.kind === 'bloom') { drawBloomPad(ctx, p, sh, x, y, w, s, L); return; }
      var u = s.u;
      var a = clamp01(u * 1.6);
      ctx.globalAlpha = a;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (s.kind === 'pad') {
        // bridge tile: a flat round leaf lying on the stem
        var cx = x + 16, k = outBack(u);
        ctx.beginPath();
        ctx.moveTo(cx - 17 * k, y + 1);
        ctx.quadraticCurveTo(cx - 19 * k, y + 9 + wl * 2, cx - 4 * k, y + 10 + wl * 3);
        ctx.lineTo(cx, y + 6);
        ctx.lineTo(cx + 4 * k, y + 10 + wl * 3);
        ctx.quadraticCurveTo(cx + 19 * k, y + 9 + wl * 2, cx + 17 * k, y + 1);
        ctx.closePath();
        ctx.fillStyle = rgba(col, 0.3);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(col, 0.55);
        ctx.beginPath();
        ctx.moveTo(cx, y + 6); ctx.lineTo(cx - 10 * k, y + 3);
        ctx.moveTo(cx, y + 6); ctx.lineTo(cx + 10 * k, y + 3);
        ctx.moveTo(cx, y + 6); ctx.lineTo(cx, y + 2);
        ctx.stroke();
        ctx.strokeStyle = rgba(p.ink, 0.5 * (1 - wl * 0.6));
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(cx - 15 * k, y + 0.8); ctx.lineTo(cx + 15 * k, y + 0.8);
        ctx.stroke();
      } else {
        // frond: an elongated leaf from the stem side to its tip; the flat top is the walkable surface
        var sd = s.side >= 0 ? 1 : -1;
        var x0 = sd > 0 ? x + 2 : x + w - 2, x1 = sd > 0 ? x + w : x;
        var xt = x0 + (x1 - x0) * outBack(u);
        var droop = wl * 4;
        ctx.beginPath();
        ctx.moveTo(x0, y + 1);
        ctx.quadraticCurveTo((x0 + xt) / 2, y - 0.5, xt, y + 1 - 2 * (1 - wl) + droop);
        ctx.quadraticCurveTo(x0 + (xt - x0) * 0.62, y + 13 + droop, x0, y + 7);
        ctx.closePath();
        ctx.fillStyle = rgba(col, 0.3);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
        // midrib and alternate veins
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(col, 0.6);
        ctx.beginPath();
        ctx.moveTo(x0, y + 4); ctx.lineTo(xt, y + 1.5 + droop * 0.6);
        for (var v = 1; v <= 4; v++) {
          var t0 = v / 5.2, mx = x0 + (xt - x0) * t0, my = y + 4 - 2.5 * t0 + droop * 0.6 * t0;
          var ex = x0 + (xt - x0) * (t0 + 0.12);
          ctx.moveTo(mx, my); ctx.lineTo(ex, (v & 1) ? y + 8 + droop * t0 : y + 1.5);
        }
        ctx.stroke();
        ctx.strokeStyle = rgba(p.ink, 0.5 * (1 - wl * 0.6));
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x0 + (xt - x0) * 0.04, y + 0.8); ctx.lineTo(x0 + (xt - x0) * 0.86, y + 0.8);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  });

  // flower lift pad: six petals around an accent core with a flat walkable top
  function drawBloomPad(ctx, p, sh, x, y, w, s, L) {
    var cx = x + w / 2, k = 0.55 + 0.45 * smooth(s.lift * 3), wl = s.wilt;
    var col = wl > 0.01 ? sh.wilt[Math.round(wl * 8)] : p.primary;
    var t = L.time;
    ctx.lineJoin = 'round';
    for (var i = 0; i < 6; i++) {
      var a = Math.PI + (i + 0.5) * Math.PI / 6 + Math.sin(t * 1.3 + i) * 0.04;
      var px = cx + Math.cos(a) * 26 * k, py = y + 6 + Math.sin(a) * 26 * k * 0.45;
      ctx.beginPath();
      ctx.ellipse(px, py + 3, 12 * k, 5.5 * k, a, 0, TAU);
      ctx.fillStyle = rgba(i & 1 ? p.accent : sh.blush, 0.22 + 0.12 * beatPulse());
      ctx.fill();
      ctx.strokeStyle = i & 1 ? p.accent : col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 1);
    ctx.lineTo(x + w - 4, y + 1);
    ctx.lineTo(x + w - 10, y + 9);
    ctx.lineTo(x + 10, y + 9);
    ctx.closePath();
    ctx.fillStyle = rgba(col, 0.34);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = rgba(p.ink, 0.55);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 0.8); ctx.lineTo(x + w - 6, y + 0.8);
    ctx.stroke();
    ctx.fillStyle = p.accent;
    AP.R.poly(ctx, cx, y + 5, 3.2 + beatPulse(), 6, t);
    ctx.fill();
  }

  // ================================================================ w4.vine
  var V_WILT = 0.7, V_SHRINK = 0.45, V_COOL = 0.4, V_FAR = 1.2;
  var vtmp = { x: 0, y: 0 };

  // point at stem distance u (u) and perpendicular offset v (u) in world space
  function vinePt(s, u, v, out) {
    if (s.dir === 'up') { out.x = s.rx0 + v; out.y = s.ry0 - u; }
    else if (s.dir === 'down') { out.x = s.rx0 + v; out.y = s.ry0 + u; }
    else if (s.dir === 'right') { out.x = s.rx0 + u; out.y = s.ry0 + v; }
    else { out.x = s.rx0 - u; out.y = s.ry0 + v; }
    return out;
  }

  function vineBuild(e, spec, L) {
    var s = e.s, i, k;
    var P = VPRESET[s.preset] || VPRESET.fern;
    var unit = sprigUnit(s.preset);
    s.Lu = s.len * T;
    // sprigs: one per tile along the stem (some skipped), alternating sides; bridges hang theirs below
    s.sprigs = [];
    var horiz = s.dir === 'left' || s.dir === 'right';
    var axisA = s.dir === 'up' ? -Math.PI / 2 : s.dir === 'down' ? Math.PI / 2 : s.dir === 'right' ? 0 : Math.PI;
    for (k = 0; k < s.len; k++) {
      var hv = hashf(e.tx * 7 + k, e.ty * 3 + 11, 5);
      if (hv > 0.78) continue;
      var u = (k + 0.35 + 0.3 * hashf(k, e.tx, 9)) * T;
      var side = horiz ? 1 : ((k + (s.firstSide > 0 ? 0 : 1)) % 2 ? -1 : 1);
      var head;
      if (horiz) head = Math.PI / 2 + (s.dir === 'right' ? -0.45 : 0.45) + (hv - 0.4) * 0.5;
      else if (s.dir === 'down') head = Math.PI / 2 + side * (1.15 - 0.25 * hv);
      else head = axisA + side * (0.95 + 0.3 * hv);
      var size = P.size * (0.75 + 0.55 * hashf(k, e.ty, 13)) * (s.bloom ? 0.8 : 1);
      vinePt(s, u, 0, vtmp);
      var rot = head + Math.PI / 2, cr = Math.cos(rot) * size, sr = Math.sin(rot) * size;
      var segs = new Float32Array(unit.n * 4);
      for (i = 0; i < unit.n; i++) {
        var o = i * 4;
        segs[o] = unit.segs[o] * cr - unit.segs[o + 1] * sr;
        segs[o + 1] = unit.segs[o] * sr + unit.segs[o + 1] * cr;
        segs[o + 2] = unit.segs[o + 2] * cr - unit.segs[o + 3] * sr;
        segs[o + 3] = unit.segs[o + 2] * sr + unit.segs[o + 3] * cr;
      }
      var tips = new Float32Array(unit.nt * 3);
      for (i = 0; i < unit.nt; i++) {
        var tx0 = unit.tips[i * 2], ty0 = unit.tips[i * 2 + 1];
        tips[i * 3] = tx0 * cr - ty0 * sr;
        tips[i * 3 + 1] = tx0 * sr + ty0 * cr;
        tips[i * 3 + 2] = hashf(k * 17 + i, e.tx, 21) < P.blossom ? 1 : 0;
      }
      s.sprigs.push({ u: u, bx: vtmp.x, by: vtmp.y, segs: segs, n: unit.n, tips: tips, nt: unit.nt, size: size });
    }
    // bounding box (world) of stem + pads + sprigs, for culling and the 'near' range
    var x0 = Math.min(s.rx0, vinePt(s, s.Lu, 0, vtmp).x), y0 = Math.min(s.ry0, vtmp.y);
    var x1 = Math.max(s.rx0, vtmp.x), y1 = Math.max(s.ry0, vtmp.y);
    for (i = 0; i < s.kids.length; i++) {
      var c = s.kids[i];
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, s.bloom ? s.topY : c.y);
      x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
    }
    s.bb = [x0 - 24, y0 - 24, x1 - x0 + 48, y1 - y0 + 48];
    s.swayA = horiz ? 1.5 : P.sway;
  }

  function vineNear(s, P, r) {
    if (!alive(P)) return false;
    var cx = P.x + P.w / 2, cy = P.y + P.h / 2, b = s.bb;
    var dx = cx < b[0] ? b[0] - cx : (cx > b[0] + b[2] ? cx - b[0] - b[2] : 0);
    var dy = cy < b[1] ? b[1] - cy : (cy > b[1] + b[3] ? cy - b[1] - b[3] : 0);
    return dx * dx + dy * dy <= r * r;
  }

  function vineTouched(s, P) {
    if (!alive(P)) return false;
    var b = s.bud;
    return P.x < b[0] + b[2] && P.x + P.w > b[0] && P.y < b[1] + b[3] && P.y + P.h > b[1];
  }

  function vineStartGrow(e, L) {
    var s = e.s;
    s.st = 'grow';
    s.wilt = 0;
    s.flash = 1;
    if (onScreen(L, s.bb[0], s.bb[1], s.bb[2], s.bb[3], 64)) {
      AP.sfxAt('grow', s.rx0, s.ry0, { vol: 0.42, pitch: 1.25 + 0.04 * (s.len % 5) });
      AP.FX.burst('w4.sprout', s.rx0, s.ry0, { dir: s.dir === 'up' ? -Math.PI / 2 : s.dir === 'down' ? Math.PI / 2 : s.dir === 'right' ? 0 : Math.PI, n: 6 });
    }
  }

  function vineWilt(e, L) {
    var s = e.s;
    s.st = 'wilt';
    if (onScreen(L, s.bb[0], s.bb[1], s.bb[2], s.bb[3], 32)) AP.sfxAt('crumble', s.rx0, s.ry0, { vol: 0.25, pitch: 1.7 });
  }

  // state machine of near / touch / trigger vines
  function vineStep(e, dt, L) {
    var s = e.s, P = L.player;
    switch (s.st) {
      case 'idle':
        if ((s.mode === 'near' && vineNear(s, P, s.range)) ||
            (s.mode === 'touch' && vineTouched(s, P)) ||
            (s.mode === 'trigger' && (s.trig || (s.tag !== null && L.flags[s.tag])))) vineStartGrow(e, L);
        break;
      case 'grow':
        s.g = Math.min(1, s.g + dt / s.tGrow);
        if (s.g >= 1) { s.st = 'hold'; s.holdT = 0; s.farT = 0; }
        break;
      case 'hold':
        if (s.mode === 'near') {
          if (vineNear(s, P, s.range + 48)) s.farT = 0;
          else { s.farT += dt; if (s.farT > V_FAR) vineWilt(e, L); }
        } else if (s.mode === 'touch') {
          s.holdT += dt;
          if (s.holdT >= s.hold) vineWilt(e, L);
        }
        if (s.wilt > 0) s.wilt = Math.max(0, s.wilt - dt * 3);
        break;
      case 'wilt':
        if (s.mode === 'near' && s.wilt < 0.6 && vineNear(s, P, s.range)) { s.st = 'hold'; s.farT = 0; break; }
        s.wilt = Math.min(1, s.wilt + dt / V_WILT);
        if (s.wilt >= 1) {
          s.st = 'shrink';
          if (onScreen(L, s.bb[0], s.bb[1], s.bb[2], s.bb[3], 32)) AP.sfxAt('whoosh', s.rx0, s.ry0, { vol: 0.3, pitch: 1.4 });
        }
        break;
      case 'shrink':
        s.g = Math.max(0, s.g - dt / V_SHRINK);
        if (s.g <= 0) { s.st = s.mode === 'touch' ? 'cool' : 'idle'; s.coolT = 0; s.wilt = 0; }
        break;
      case 'cool':
        s.coolT += dt;
        if (s.coolT >= V_COOL) s.st = 'idle';
        break;
      default:
        s.st = 'idle';
    }
  }

  // beat vines: the whole cycle is a pure function of AP.Beat (grow 14%, hold 50%, wilt 16%, retract 12%, rest 8%)
  function vineBeat(s) {
    var B = AP.Beat;
    var c = frac(B.beat / Math.max(1, B.meter) / s.bars + s.phase0);
    s.cyc = c;
    if (c < 0.14) { s.g = c / 0.14; s.wilt = 0; s.st = 'grow'; }
    else if (c < 0.64) { s.g = 1; s.wilt = 0; s.st = 'hold'; }
    else if (c < 0.8) { s.g = 1; s.wilt = (c - 0.64) / 0.16; s.st = 'wilt'; }
    else if (c < 0.92) { s.g = 1 - (c - 0.8) / 0.12; s.wilt = 1; s.st = 'shrink'; }
    else { s.g = 0; s.wilt = 0; s.st = 'idle'; }
  }

  function vinePads2(e, L) {
    var s = e.s, P = L.player;
    var F = s.g * (s.len + 1);
    var kids = s.kids;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.dead) continue;
      var u = smooth((F - c.s.d) / 0.9);
      if (s.st === 'shrink' || (s.st === 'idle' && s.g <= 0)) u = Math.min(u, smooth((F - c.s.d) / 0.6));
      c.s.u = u;
      c.s.wilt = s.wilt;
      var on = u > 0.55;
      if (on !== c.collidable) {
        c.collidable = on;
        if (on && onScreen(L, c.x, c.y, c.w, c.h, 32)) AP.FX.burst('w4.leaves', c.x + c.w / 2, c.y + 4, { n: 3, cone: 1.6 });
        else if (!on && onScreen(L, c.x, c.y, c.w, c.h, 32)) AP.FX.burst('w4.wilt', c.x + c.w / 2, c.y + 4, { n: 3 });
      }
      // landing dip (visual spring)
      var riding = on && alive(P) && P.isRiding(c);
      if (riding && !c.s.ride) { c.s.dipV += 9; if (P.lastLandVy > 200) AP.FX.burst('w4.leaves', P.x + P.w / 2, c.y + 2, { n: 2, cone: 1.4 }); }
      c.s.ride = riding;
    }
  }

  function vineSpring(e, dt) {
    var kids = e.s.kids;
    for (var i = 0; i < kids.length; i++) {
      var cs = kids[i].s;
      cs.dipV += (-cs.dip * 260 - cs.dipV * 14) * dt;
      cs.dip += cs.dipV * dt;
    }
  }

  // bloom: a flower lift. Ride the pad (touch/near), wait for the beat cycle, or a trigger flag: it rises len tiles,
  // holds, wilts (telegraph) and sinks back to the floor.
  function bloomStep(e, dt, L) {
    var s = e.s, P = L.player, pad = s.kids[0];
    if (!pad || pad.dead) return;
    var riding = alive(P) && P.isRiding(pad);
    if (s.mode === 'beat') {
      vineBeat(s);
    } else {
      switch (s.st) {
        case 'idle':
          if (s.coolT > 0) s.coolT -= dt;
          s.rideT = riding ? s.rideT + dt : 0;
          if (s.mode === 'trigger' ? (s.trig || (s.tag !== null && L.flags[s.tag])) : (s.rideT >= 0.12 && s.coolT <= 0)) {
            vineStartGrow(e, L);
            s.holdT = 0;
          }
          break;
        case 'grow':
          s.g = Math.min(1, s.g + dt / s.tGrow);
          if (s.g >= 1) {
            s.st = 'hold'; s.holdT = 0;
            if (onScreen(L, s.bb[0], s.bb[1], s.bb[2], s.bb[3], 32)) {
              AP.FX.burst('w4.bloom', pad.x + pad.w / 2, pad.y + 4, { n: 10, radius: 30 });
              AP.sfxAt('chime', pad.x + pad.w / 2, pad.y, { vol: 0.35 });
            }
          }
          break;
        case 'hold':
          s.holdT += dt;
          if (s.mode !== 'trigger' && s.holdT >= s.hold) vineWilt(e, L);
          break;
        case 'wilt':
          s.wilt = Math.min(1, s.wilt + dt / V_WILT);
          if (s.wilt >= 1) s.st = 'shrink';
          break;
        case 'shrink':
          s.g = Math.max(0, s.g - dt / s.tSink);
          if (s.g <= 0) { s.st = 'idle'; s.wilt = 0; s.coolT = 0.6; s.rideT = 0; }
          break;
        default:
          s.st = 'idle';
      }
    }
    var gy = AP.M.ease.inOutSine(clamp01(s.g));
    var ty = s.restY - gy * s.len * T;
    pad.moveSolid(0, ty - (pad.y + pad.yRem));
    pad.vy = 0;
    pad.s.u = 1;
    pad.s.wilt = s.wilt;
    pad.s.lift = gy;
    if (riding && !pad.s.ride) pad.s.dipV += 7;
    pad.s.ride = riding;
  }

  AP.Entities.register('w4.vine', {
    kind: 'sensor', anchor: 'tile', layer: 2, lint: 'ignore', alwaysRender: true, renderPad: 64,
    // the pads at their grown position, for the reachability bots (tile units). A bloom lift is reported as a
    // ladder of its cup every 2 tiles up to the top: riding it reaches every one of those heights, and the bots can
    // only climb a ladder by jumping (a conservative model of the lift). Keep other ledges away from its column.
    lintRects: function (spec, tx, ty) {
      var pads = vinePads(spec, tx, ty), out = [];
      if (vPreset(spec) === 'bloom') {
        var len = vLen(spec);
        for (var k = 2; k < len; k += 2) out.push([tx - 1, ty + 1 - k, 3, 0.375, 'stand']);
      }
      for (var i = 0; i < pads.length; i++) out.push([pads[i].x, pads[i].y, pads[i].w, 0.375, 'stand']);
      return out;
    },
    init: function (e, spec, L) {
      var s = e.s;
      s.dir = vDir(spec);
      s.len = vLen(spec);
      s.preset = vPreset(spec);
      s.bloom = s.preset === 'bloom';
      if (s.bloom) s.dir = 'up';
      var gm = String(spec.grow || (s.bloom ? 'touch' : 'near'));
      s.mode = (gm === 'touch' || gm === 'trigger' || gm === 'beat') ? gm : 'near';
      if (s.bloom && s.mode === 'near') s.mode = 'touch';
      s.tag = spec.tag !== undefined ? spec.tag : null;
      s.range = Math.max(1, num(spec.range, 5)) * T;
      s.hold = Math.max(0.6, num(spec.hold, s.bloom ? 2.5 : 4));
      s.bars = Math.max(0.5, num(spec.bars, 2));
      s.phase0 = num(spec.phase, 0) / 360;
      s.tGrow = s.bloom ? 0.4 + 0.11 * s.len : 0.3 + 0.075 * s.len;
      s.tSink = 0.5 + 0.08 * s.len;
      s.firstSide = vSideMode(spec) === 'altl' || vSideMode(spec) === 'left' ? -1 : 1;
      s.st = 'idle';
      s.g = 0; s.wilt = 0; s.holdT = 0; s.farT = 0; s.coolT = 0; s.rideT = 0; s.cyc = 0;
      s.flash = 0; s.trig = false; s.clock = hashf(e.tx, e.ty, 3) * 10;
      var tx = e.tx, ty = e.ty;
      if (s.dir === 'up') { s.rx0 = tx * T + 16; s.ry0 = (ty + 1) * T; }
      else if (s.dir === 'down') { s.rx0 = tx * T + 16; s.ry0 = ty * T; }
      else if (s.dir === 'right') { s.rx0 = tx * T; s.ry0 = ty * T + 7; }
      else { s.rx0 = (tx + 1) * T; s.ry0 = ty * T + 7; }
      // the bud (touch area) around the root
      s.bud = [s.rx0 - 18, s.ry0 - 26, 36, 36];
      if (s.dir === 'down') s.bud[1] = s.ry0 - 10;
      else if (s.dir === 'right') { s.bud[0] = s.rx0 - 4; s.bud[1] = s.ry0 - 28; }
      else if (s.dir === 'left') { s.bud[0] = s.rx0 - 32; s.bud[1] = s.ry0 - 28; }
      // pads (children)
      s.kids = [];
      var pads = vinePads(spec, tx, ty);
      var horiz = s.dir === 'left' || s.dir === 'right';
      for (var i = 0; i < pads.length; i++) {
        var q = pads[i];
        var cy = s.bloom ? (ty + 1) * T + 6 : q.y * T + 6;
        var c = L.spawn('w4.leaf', (q.x + q.w / 2) * T, cy, { w: q.w, kind: s.bloom ? 'bloom' : (horiz ? 'pad' : 'frond'), side: q.side });
        if (!c) continue;
        c.parent = e;
        c.s.d = q.d;
        c.s.side = q.side;
        c.collidable = s.bloom;
        c.s.u = s.bloom ? 1 : 0;
        s.kids.push(c);
      }
      if (s.bloom) { s.restY = (ty + 1) * T; s.topY = s.restY - s.len * T; }
      vineBuild(e, spec, L);
      // trigger vines also listen for w4:grow {tag} (seed pods, scripted events)
      if (s.mode === 'trigger') {
        L.on('w4:grow', function (pl) { if (pl && pl.tag === s.tag) s.trig = true; });
      }
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.clock += dt;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.5);
      if (s.bloom) { bloomStep(e, dt, L); vineSpring(e, dt); return; }
      if (s.mode === 'beat') vineBeat(s); else vineStep(e, dt, L);
      vinePads2(e, L);
      vineSpring(e, dt);
    },
    onRespawn: function (e, L) {
      var s = e.s;
      if (s.mode === 'beat') return;
      s.wilt = 0; s.holdT = 0; s.farT = 0; s.coolT = 0; s.rideT = 0;
      if (s.mode === 'trigger' && (s.trig || (s.tag !== null && L.flags[s.tag]))) { s.g = 1; s.st = 'hold'; }
      else { s.g = 0; s.st = 'idle'; }
      if (s.bloom) {
        var pad = s.kids[0];
        if (pad && !pad.dead) {
          var y = s.restY - s.g * s.len * T;
          pad.setPos(pad.x, Math.round(y));
          pad.s.lift = s.g;
          pad.s.wilt = 0;
        }
      } else {
        vinePads2(e, L);
      }
    },
    onRemove: function (e, L) {
      var kids = e.s.kids;
      if (kids) for (var i = 0; i < kids.length; i++) L.remove(kids[i]);
    },
    render: function (e, ctx, L) {
      var s = e.s, b = s.bb;
      if (L.cam && !L.cam.visible(b[0], b[1], b[2], b[3], 16)) return;
      var p = palOf(L), sh = shades(p);
      var t = L.time + s.clock;
      var wl = s.wilt;
      var col = wl > 0.01 ? sh.wilt[Math.round(wl * 8)] : p.primary;
      var shake = wl > 0.01 ? Math.sin(t * 47) * 1.3 * wl : 0;
      var swA = s.swayA * (1 + 0.6 * wl);
      var sw0 = Math.sin(t * 1.25) + 0.4 * Math.sin(t * 2.7 + 1.3);
      // visible stem length
      var ug = s.bloom ? AP.M.ease.inOutSine(clamp01(s.g)) * s.Lu : clamp01(s.g * (s.len + 1) / s.len) * s.Lu;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // root mound
      vinePt(s, 0, 0, vtmp);
      var rx = vtmp.x, ry = vtmp.y;
      drawRoot(ctx, s, p, sh, rx, ry, t);
      if (ug > 1) {
        // stem in three tapering runs
        var n = Math.max(2, Math.ceil(ug / 8));
        for (var run = 0; run < 3; run++) {
          var a0 = Math.floor(n * run / 3), a1 = Math.ceil(n * (run + 1) / 3);
          if (a1 <= a0) continue;
          ctx.beginPath();
          for (var i = a0; i <= a1; i++) {
            var u = Math.min(ug, i * 8);
            var k = u / Math.max(1, s.Lu);
            var off = swA * sw0 * k * Math.sqrt(k) + shake * k;
            vinePt(s, u, off, vtmp);
            if (i === a0) ctx.moveTo(vtmp.x, vtmp.y); else ctx.lineTo(vtmp.x, vtmp.y);
          }
          ctx.strokeStyle = run === 0 ? sh.stemDark : col;
          ctx.lineWidth = 4 - run * 1.1;
          ctx.stroke();
          if (run === 0) { ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); }
        }
        // petioles to the pads
        if (!s.bloom && (s.dir === 'up' || s.dir === 'down')) {
          ctx.beginPath();
          for (var j = 0; j < s.kids.length; j++) {
            var c = s.kids[j];
            if (c.dead || c.s.u <= 0.02) continue;
            var du = c.s.d * T, kk = du / Math.max(1, s.Lu);
            vinePt(s, du, swA * sw0 * kk * Math.sqrt(kk) + shake * kk, vtmp);
            var bx = c.s.side > 0 ? c.rx + 3 : c.rx + c.w - 3, by = c.ry + 4 + c.s.dip * 3;
            ctx.moveTo(vtmp.x, vtmp.y);
            ctx.quadraticCurveTo(vtmp.x + (bx - vtmp.x) * 0.4, by + (s.dir === 'up' ? 7 : -7), vtmp.x + (bx - vtmp.x) * c.s.u, by);
          }
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // L-system sprigs (one batched path) and their tips
        ctx.beginPath();
        var anyTip = false;
        for (var q = 0; q < s.sprigs.length; q++) {
          var sp = s.sprigs[q];
          var gk = smooth((ug - sp.u) / 26);
          if (gk <= 0) continue;
          var ks = sp.u / Math.max(1, s.Lu);
          var so = swA * sw0 * ks * Math.sqrt(ks) + shake * ks;
          var ox = (s.dir === 'up' || s.dir === 'down') ? so : 0, oy = (s.dir === 'up' || s.dir === 'down') ? 0 : so;
          var bx0 = sp.bx + ox, by0 = sp.by + oy + (wl > 0.01 ? 0 : 0);
          var sg = sp.segs;
          for (var m = 0; m < sp.n; m++) {
            var o = m * 4;
            ctx.moveTo(bx0 + sg[o] * gk, by0 + sg[o + 1] * gk + wl * 3 * gk * (sg[o + 1] < 0 ? 0 : 1));
            ctx.lineTo(bx0 + sg[o + 2] * gk, by0 + sg[o + 3] * gk + wl * 4 * gk);
          }
          if (gk > 0.6) anyTip = true;
        }
        ctx.strokeStyle = rgba(col, 0.85);
        ctx.lineWidth = 1.15;
        ctx.stroke();
        if (anyTip) drawTips(ctx, s, p, sh, ug, swA * sw0, shake, t, wl);
        // growing tip bud
        if (s.g > 0.02 && s.g < 0.999 && !s.bloom) {
          var ut = ug, kt = ut / Math.max(1, s.Lu);
          vinePt(s, ut, swA * sw0 * kt * Math.sqrt(kt), vtmp);
          ctx.fillStyle = p.accent;
          AP.R.poly(ctx, vtmp.x, vtmp.y, 3.2, 6, t * 3);
          ctx.fill();
          AP.R.glow(ctx, vtmp.x, vtmp.y, 14, p.accent, 0.55);
        }
      }
      if (s.flash > 0.02) AP.R.glow(ctx, rx, ry, 26, p.primary, s.flash * 0.6);
    }
  });

  function drawTips(ctx, s, p, sh, ug, swv, shake, t, wl) {
    var pb = beatPulse();
    // blossoms (accent five-point stars) then leaves (primary specks)
    for (var pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (var q = 0; q < s.sprigs.length; q++) {
        var sp = s.sprigs[q];
        var gk = smooth((ug - sp.u - 10) / 22);
        if (gk <= 0.25) continue;
        var ks = sp.u / Math.max(1, s.Lu);
        var so = swv * ks * Math.sqrt(ks) + shake * ks;
        var vert = s.dir === 'up' || s.dir === 'down';
        var bx0 = sp.bx + (vert ? so : 0), by0 = sp.by + (vert ? 0 : so);
        for (var i = 0; i < sp.nt; i++) {
          var isB = sp.tips[i * 3 + 2] > 0.5;
          if ((pass === 0) !== isB) continue;
          var x = bx0 + sp.tips[i * 3] * gk, y = by0 + sp.tips[i * 3 + 1] * gk + wl * 4 * gk;
          if (isB) AP.R.star(ctx, x, y, (2.6 + 0.8 * pb) * gk * (1 - 0.5 * wl), 1.1 * gk, 5, t * 0.6 + q + i, true);
          else AP.R.poly(ctx, x, y, 1.6 * gk, 3, q + i, true);
        }
      }
      ctx.fillStyle = pass === 0 ? (wl > 0.3 ? sh.dimA : p.accent) : rgba(wl > 0.3 ? sh.leafDark : sh.pale, 0.9);
      ctx.fill();
    }
  }

  function drawRoot(ctx, s, p, sh, rx, ry, t) {
    var pb = beatPulse();
    ctx.strokeStyle = sh.stemDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (s.dir === 'up') {
      ctx.moveTo(rx - 11, ry); ctx.quadraticCurveTo(rx - 5, ry - 7, rx, ry - 2);
      ctx.moveTo(rx + 11, ry); ctx.quadraticCurveTo(rx + 5, ry - 7, rx, ry - 2);
    } else if (s.dir === 'down') {
      ctx.moveTo(rx - 11, ry); ctx.quadraticCurveTo(rx - 5, ry + 7, rx, ry + 2);
      ctx.moveTo(rx + 11, ry); ctx.quadraticCurveTo(rx + 5, ry + 7, rx, ry + 2);
    } else {
      var sx = s.dir === 'right' ? 1 : -1;
      ctx.moveTo(rx, ry - 9); ctx.quadraticCurveTo(rx + sx * 7, ry - 4, rx + sx * 2, ry);
      ctx.moveTo(rx, ry + 9); ctx.quadraticCurveTo(rx + sx * 7, ry + 4, rx + sx * 2, ry);
    }
    ctx.stroke();
    // grow-mode marker
    var bx = s.bud[0] + s.bud[2] / 2, by = s.bud[1] + s.bud[3] / 2;
    if (s.dir === 'up') by = ry - 9; else if (s.dir === 'down') by = ry + 9;
    if (s.mode === 'touch' && !s.bloom) {
      var ready = s.st === 'idle';
      var k = ready ? 0.65 + 0.35 * pb : 0.35;
      ctx.beginPath();
      ctx.moveTo(bx, by - 8 * k - 2);
      ctx.quadraticCurveTo(bx + 7, by - 2, bx, by + 5);
      ctx.quadraticCurveTo(bx - 7, by - 2, bx, by - 8 * k - 2);
      ctx.fillStyle = rgba(p.accent, ready ? 0.45 : 0.18);
      ctx.fill();
      ctx.strokeStyle = ready ? p.accent : sh.dimA;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      if (ready) AP.R.glow(ctx, bx, by - 2, 16, p.accent, 0.3 + 0.25 * pb);
    } else if (s.mode === 'beat') {
      // cycle dial: the arc fills toward the next growth; flashes while the vine is about to fold
      ctx.strokeStyle = rgba(p.accent, 0.25);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = s.st === 'wilt' ? p.ink : p.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, 6, -Math.PI / 2, -Math.PI / 2 + TAU * s.cyc);
      ctx.stroke();
    } else if (s.mode === 'trigger' && !s.bloom) {
      var on = s.st !== 'idle';
      ctx.fillStyle = on ? p.accent : sh.dimA;
      AP.R.poly(ctx, bx, by, 3.5, 6, t * (on ? 1.5 : 0.2));
      ctx.fill();
    } else if (s.bloom && s.st === 'idle') {
      // closed bud waiting for a rider
      ctx.strokeStyle = rgba(p.accent, 0.4 + 0.4 * pb);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx - 10, ry - 1); ctx.lineTo(rx, ry - 9 - 2 * pb); ctx.lineTo(rx + 10, ry - 1);
      ctx.stroke();
    }
  }

  // ================================================================ w4.thorn
  var TH_IN = 3 / 32;   // hurtbox inset (tiles) on every side
  var TH_DIRS = { up: 1, down: 1, left: 1, right: 1, all: 1 };
  function thDir(spec) { var d = spec && spec.dir; return TH_DIRS[d] ? d : 'up'; }
  // bramble body in tile units [x, y, w, h] before the inset; 'up' strips sit on the floor of their tile and
  // 'left' strips on the right wall of their tile
  function thornRect(spec, tx, ty) {
    spec = spec || {};
    var w = Math.max(0.25, num(spec.w, 1)), h = Math.max(0.25, num(spec.h, 1)), dir = thDir(spec);
    var x = tx, y = ty;
    if (dir === 'up') y = ty + 1 - h;
    if (dir === 'left') x = tx + 1 - w;
    return [x, y, w, h];
  }

  // silhouette polygon (flat, local to the hurtbox's top-left) of a w x h body whose exposed edges carry a Koch
  // fringe of `depth` (the curve "iterates" depth 0 -> n as the telegraph)
  function thornShape(w, h, dir, depth) {
    var pts = [];
    var K = 0.62;
    function edge(ax, ay, bx, by, exposed) {
      var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      if (!exposed || depth <= 0) { pts.push(ax, ay); return; }
      var n = Math.max(1, Math.round(len / 30));
      for (var i = 0; i < n; i++) {
        var x1 = ax + (bx - ax) * i / n, y1 = ay + (by - ay) * i / n, x2 = ax + (bx - ax) * (i + 1) / n, y2 = ay + (by - ay) * (i + 1) / n;
        var kp = kochPts(x1, y1, x2, y2, depth, 1);
        var hor = Math.abs(by - ay) < 1e-6;
        for (var j = 0; j < kp.length - 2; j += 2) {
          if (hor) pts.push(kp[j], y1 + (kp[j + 1] - y1) * K);
          else pts.push(x1 + (kp[j] - x1) * K, kp[j + 1]);
        }
      }
    }
    var all = dir === 'all';
    // clockwise: top (bumps up), right (bumps right), bottom (bumps down), left (bumps left)
    edge(0, 0, w, 0, all || dir === 'up');
    edge(w, 0, w, h, all || dir === 'right');
    edge(w, h, 0, h, all || dir === 'down');
    edge(0, h, 0, 0, all || dir === 'left');
    return new Float32Array(pts);
  }

  // geometry shared by every strip of the same size, direction, depth and tangle variant (built once)
  var thornCache = {};
  var thornCacheN = 0;
  function thornGeom(w, h, dir, depth, variant) {
    var key = Math.round(w) + 'x' + Math.round(h) + dir + depth + 'v' + variant;
    var g = thornCache[key];
    if (g) return g;
    if (thornCacheN > 160) { thornCache = {}; thornCacheN = 0; }
    g = { shapes: [], needles: null, tangle: null };
    for (var d = 0; d <= depth; d++) g.shapes.push(thornShape(w, h, dir, d));
    // needles at the Koch peaks of the exposed edges
    var nd = [], i, n;
    var dirs = dir === 'all' ? ['up', 'right', 'down', 'left'] : [dir];
    for (var q = 0; q < dirs.length; q++) {
      var dq = dirs[q], hor = dq === 'up' || dq === 'down';
      n = Math.max(1, Math.round((hor ? w : h) / 30));
      for (i = 0; i < n; i++) {
        var f = (i + 0.5) / n;
        if (dq === 'up') nd.push(w * f, 0, 0, -1);
        else if (dq === 'down') nd.push(w * f, h, 0, 1);
        else if (dq === 'left') nd.push(0, h * f, -1, 0);
        else nd.push(w, h * f, 1, 0);
      }
    }
    g.needles = new Float32Array(nd);
    // a tangle of thorny stems inside the body
    var tg = [];
    var cells = Math.max(1, Math.round(w / 26) * Math.max(1, Math.round(h / 26)));
    for (i = 0; i < Math.min(40, cells * 2); i++) {
      var h1 = hashf(variant * 31 + i, 17, 1), h2 = hashf(i, variant + 5, 2), h3 = hashf(variant + i, 9, 3), h4 = hashf(i * 3, variant, 4);
      tg.push(w * h1, h * (0.15 + 0.7 * h2), w * h3, h * (0.1 + 0.8 * h4), w * h2, h * h1, w * h4, h * (0.2 + 0.6 * h3));
    }
    g.tangle = new Float32Array(tg);
    thornCache[key] = g;
    thornCacheN++;
    return g;
  }

  AP.Entities.register('w4.thorn', {
    kind: 'sensor', hazard: true, lint: 'hazard', anchor: 'tile', layer: 4, renderPad: 24,
    size: function (spec) {
      var r = thornRect(spec, 0, 0);
      return [Math.max(4, (r[2] - 2 * TH_IN) * T), Math.max(4, (r[3] - 2 * TH_IN) * T)];
    },
    lintRects: function (spec, tx, ty) {
      var r = thornRect(spec, tx, ty);
      return [[r[0] + TH_IN, r[1] + TH_IN, Math.max(0.125, r[2] - 2 * TH_IN), Math.max(0.125, r[3] - 2 * TH_IN), 'hazard']];
    },
    // spec: w, h (tiles), depth 3, dir 'up'|'down'|'left'|'right'|'all';
    //   cycling: period (s) or beats (music beats) with on (lethal fraction), phase (deg), tele (s, >= 0.4);
    //   once (boss / scripted strips: iterate for tele, lethal for life, then recede and vanish); quiet (no sfx)
    init: function (e, spec, L) {
      var s = e.s;
      var r = thornRect(spec, e.tx, e.ty);
      var x = (r[0] + TH_IN) * T, y = (r[1] + TH_IN) * T;
      e.x = x; e.y = y; e.px = x; e.py = y; e.rx = x; e.ry = y; e.homeX = x; e.homeY = y;
      s.dir = thDir(spec);
      s.depth = Math.max(1, Math.min(4, Math.round(num(spec.depth, 3))));
      s.period = Math.max(0, num(spec.period, 0));
      s.beats = Math.max(0, num(spec.beats, 0));
      s.on = Math.max(0.1, Math.min(0.9, num(spec.on, 0.5)));
      s.ph = num(spec.phase, 0) / 360;
      s.tele = Math.max(0.4, num(spec.tele, 0.6));
      s.life = Math.max(0.2, num(spec.life, 1));
      s.once = !!spec.once;
      s.quiet = !!spec.quiet;
      s.cyc = s.once || s.period > 0 || s.beats > 0;
      s.age = 0;
      s.k = s.cyc ? 0 : 1;
      s.lvl = s.cyc ? 0 : s.depth;
      s.flash = 0;
      e.hazard = !s.cyc;
      s.geo = thornGeom(e.w, e.h, s.dir, s.depth, Math.abs(Math.round(e.tx * 7 + e.ty * 3)) % 4);
    },
    update: function (e, dt, L) {
      var s = e.s;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 4);
      if (!s.cyc) return;
      var t, per, k = 0, haz = false;
      if (s.once) {
        s.age += dt;
        t = s.age;
        if (t < s.tele) k = t / s.tele;
        else if (t < s.tele + s.life) { k = 1; haz = true; }
        else if (t < s.tele + s.life + 0.25) k = 1 - (t - s.tele - s.life) / 0.25;
        else { L.remove(e); return; }
      } else {
        per = s.beats > 0 ? s.beats * 60 / Math.max(1, AP.Beat.bpm) : s.period;
        var clock = s.beats > 0 ? AP.Beat.time : L.time;
        t = frac(clock / per + s.ph) * per;
        var onT = s.on * per;
        if (t < s.tele) k = t / s.tele;
        else if (t < s.tele + onT) { k = 1; haz = true; }
        else if (t < s.tele + onT + 0.25) k = 1 - (t - s.tele - onT) / 0.25;
      }
      // discrete Koch iterations while growing (the telegraph), continuous while receding
      var lvl = k >= 1 ? s.depth : Math.floor(k * (s.depth + 0.999));
      if (lvl > s.lvl && onScreen(L, e.x, e.y, e.w, e.h, 32)) {
        s.flash = 1;
        if (!s.quiet || lvl === s.depth) {
          AP.FX.burst('w4.thorn', e.x + e.w / 2, s.dir === 'down' ? e.y + e.h : e.y,
            { n: s.quiet ? 1 : 2, dir: s.dir === 'down' ? Math.PI / 2 : -Math.PI / 2, spread: Math.min(40, e.w / 2) });
        }
        if (!s.quiet && lvl === 1) AP.sfxAt('charge', e.x + e.w / 2, e.y, { vol: 0.18, pitch: 1.6 });
        if (!s.quiet && lvl === s.depth) AP.sfxAt('hit', e.x + e.w / 2, e.y, { vol: 0.16, pitch: 1.8 });
      }
      s.lvl = lvl;
      s.k = k;
      e.hazard = haz;
    },
    onRespawn: function (e) { if (e.s.once) e.s.age = 1e3; },
    render: function (e, ctx, L) {
      var s = e.s, g = s.geo;
      var p = palOf(L), sh = shades(p);
      var pb = beatPulse();
      var w = e.w, h = e.h;
      var live = !s.cyc || e.hazard;
      var k = s.k;
      ctx.translate(e.rx, e.ry);
      if (s.cyc && k <= 0.001) {
        // dormant: a flat bed of closed buds
        ctx.fillStyle = rgba(sh.bodyH, 0.5);
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = rgba(p.hazard, 0.35);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        var nd0 = g.needles;
        ctx.fillStyle = rgba(p.hazard, 0.45);
        ctx.beginPath();
        for (var b = 0; b < nd0.length; b += 4) {
          var bx0 = nd0[b], by0 = nd0[b + 1];
          ctx.moveTo(bx0 - nd0[b + 3] * 2, by0 + nd0[b + 2] * 2);
          ctx.lineTo(bx0 + nd0[b + 2] * 2.2, by0 + nd0[b + 3] * 2.2);
          ctx.lineTo(bx0 + nd0[b + 3] * 2, by0 - nd0[b + 2] * 2);
          ctx.closePath();
        }
        ctx.fill();
        return;
      }
      var shape = g.shapes[s.cyc ? Math.max(0, Math.min(s.depth, s.lvl)) : s.depth] || g.shapes[s.depth];
      ctx.globalAlpha = s.cyc ? 0.35 + 0.65 * k : 1;
      // silhouette fill
      ctx.beginPath();
      ctx.moveTo(shape[0], shape[1]);
      for (var i = 2; i < shape.length; i += 2) ctx.lineTo(shape[i], shape[i + 1]);
      ctx.closePath();
      ctx.fillStyle = rgba(sh.bodyH, 0.92);
      ctx.fill();
      ctx.strokeStyle = live ? p.hazard : rgba(p.hazard, 0.6);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      // inner tangle
      var tg = g.tangle;
      ctx.beginPath();
      for (var j = 0; j < tg.length; j += 8) {
        ctx.moveTo(tg[j], tg[j + 1]);
        ctx.bezierCurveTo(tg[j + 4], tg[j + 5], tg[j + 6], tg[j + 7], tg[j + 2], tg[j + 3]);
      }
      ctx.strokeStyle = rgba(p.hazard, 0.42);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      // needles
      var nd = g.needles, len = (live ? 3.5 + 1.2 * pb : 2.5 * k) * (s.cyc ? k : 1);
      if (len > 0.5) {
        ctx.beginPath();
        for (var m = 0; m < nd.length; m += 4) {
          var nx = nd[m + 2], ny = nd[m + 3], bx = nd[m], by = nd[m + 1];
          ctx.moveTo(bx - ny * 2.4, by + nx * 2.4);
          ctx.lineTo(bx + nx * (len + 2.5), by + ny * (len + 2.5));
          ctx.lineTo(bx + ny * 2.4, by - nx * 2.4);
          ctx.closePath();
        }
        ctx.fillStyle = p.hazard;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (s.flash > 0.05 && !s.quiet) AP.R.glow(ctx, w / 2, h / 2, Math.min(48, 12 + Math.max(w, h) * 0.3), p.hazard, s.flash * 0.5);
    }
  });

  // ================================================================ w4.sierp
  var SIDE = [38, 24, 15];
  var GRAV = 2000;
  function sDepth(spec) { var d = Math.round(num(spec && spec.depth, 0)); return d < 0 ? 0 : (d > 2 ? 2 : d); }
  function sSize(spec) { return Math.max(0.5, Math.min(2.5, num(spec && spec.size, 1))); }
  function sierpSide(spec) { return SIDE[sDepth(spec)] * sSize(spec); }

  var unitTris = [];
  function unitGasket(lv) {
    if (!unitTris[lv]) {
      var tris = AP.Algo.sierpinski(0, 0, 1, lv), g = new Float32Array(tris.length * 6);
      for (var i = 0; i < tris.length; i++) for (var k = 0; k < 6; k++) g[i * 6 + k] = tris[i][k];
      unitTris[lv] = g;
    }
    return unitTris[lv];
  }

  function sierpLand(h, e) { if (h.sign > 0) e.s.ground = true; e.vy = 0; }

  function sierpRoot(e) { return e.s.root || e; }

  // split into the three corner sub-triangles (depth + 1), or shatter at depth 2
  function sierpHit(e, L, how) {
    var s = e.s;
    if (s.gone || e.dead) return;
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    var root = sierpRoot(e);
    if (s.depth < 2) {
      var side = SIDE[s.depth + 1] * s.size;
      var hgt = SIDE[s.depth] * s.size * SQ3_2;
      var offs = SPLIT_OFFS;
      for (var i = 0; i < 3; i++) {
        var c = L.spawn('w4.sierp', cx + offs[i * 2] * hgt, cy + offs[i * 2 + 1] * hgt, {
          depth: s.depth + 1, size: s.size, dir: i === 1 ? 'left' : 'right', speed: s.speedT
        });
        if (!c) continue;
        c.minion = e.minion;
        c.s.root = root;
        c.s.mode = 'pop';
        c.s.grace = 0.32;
        c.hazard = false;
        c.vx = SPLIT_V[i * 2] * (0.9 + 0.2 * hashf(e.id, i, 7));
        c.vy = SPLIT_V[i * 2 + 1];
        c.s.dir = c.vx < 0 ? -1 : 1;
        c.s.rot = s.rot;
        root.s.family.push(c);
      }
      AP.FX.burst('w4.split', cx, cy, { radius: side });
      AP.sfxAt('split', cx, cy, { pitch: 1 + s.depth * 0.22 });
    } else {
      AP.FX.burst('w4.shatter', cx, cy, { radius: 12 });
      AP.FX.burst('hit', cx, cy, { n: 5, color: palOf(L).hazard });
      AP.sfxAt('hit', cx, cy, { pitch: 1.35 });
    }
    L.shake(how === 'dash' ? 3 : 2, 0.12);
    if (e === root) {
      // the original goes dormant (it comes back on respawn); everything it spawned is family
      s.gone = true;
      e.active = false;
      e.visible = false;
      e.collidable = false;
    } else {
      L.remove(e);
    }
  }
  // child offsets from the parent centre (fractions of the parent height) and pop velocities: top, left, right
  var SPLIT_OFFS = [0, -0.33, -0.29, 0.17, 0.29, 0.17];
  var SPLIT_V = [0, -470, -175, -330, 175, -330];

  AP.Entities.register('w4.sierp', {
    kind: 'actor', hazard: true, stompable: true, dashable: true, burstable: true, lint: 'ignore', anchor: 'floor', layer: 5,
    renderPad: 48,
    size: function (spec) { var sd = sierpSide(spec); return [Math.round(sd * 0.72), Math.round(sd * 0.66)]; },
    init: function (e, spec, L) {
      var s = e.s;
      s.depth = sDepth(spec);
      s.size = sSize(spec);
      s.side = sierpSide(spec);
      s.speedT = num(spec.speed, 0);
      s.speed = (s.speedT > 0 ? s.speedT : [1.8, 2.4, 3.2][s.depth]) * T;
      s.dir = spec.dir === 'left' ? -1 : 1;
      s.mode = 'walk';
      s.ground = false;
      s.grace = 0;
      s.rot = 0;
      s.roll = 0;
      s.hopT = 0;
      s.squash = 0;
      s.gone = false;
      s.root = null;
      s.family = [];
      s.lookX = s.dir;
      s.blink = hashf(e.id, 3, 1) * 3;
    },
    update: function (e, dt, L) {
      var s = e.s, P = L.player;
      if (s.grace > 0) { s.grace -= dt; if (s.grace <= 0) e.hazard = true; }
      if (s.squash > 0) s.squash = Math.max(0, s.squash - dt * 5);
      s.blink -= dt;
      if (s.blink < -0.12) s.blink = 2 + hashf(e.id, (L.time * 3) | 0, 2) * 3;
      var px = alive(P) ? P.x + P.w / 2 : e.x;
      var dxp = px - (e.x + e.w / 2);
      s.lookX += ((dxp > 0 ? 1 : -1) - s.lookX) * Math.min(1, dt * 6);
      var x0 = e.x;
      s.ground = false;
      if (s.mode === 'pop') {
        AP.Phys.gravity(e, dt);
        if (e.moveX(e.vx * dt)) e.vx = -e.vx * 0.5;
        e.moveY(e.vy * dt, sierpLand);
        s.rot += e.vx * dt * 0.05;
        if (s.ground) { s.mode = 'walk'; e.vx = 0; s.squash = 1; s.hopT = 0.3; }
      } else if (s.depth === 0) {
        // tumbling roll: rotation follows the distance travelled (120 degrees per side length)
        AP.Phys.walk(e, dt, s.speed);
      } else if (s.depth === 1) {
        // hops on every second beat, toward the player when close
        AP.Phys.gravity(e, dt);
        var grounded = e.groundAt(0);
        if (grounded) {
          e.vx = 0;
          s.hopT -= dt;
          if (s.hopT <= 0 && AP.Beat.ticked && (Math.floor(AP.Beat.beat) % 2 === 0)) {
            if (alive(P) && Math.abs(dxp) < 7 * T && Math.abs(P.y - e.y) < 4 * T) s.dir = dxp > 0 ? 1 : -1;
            if (!AP.Phys.groundAhead(e, s.dir) || e.collideAt(s.dir * 4, 0)) s.dir = -s.dir;
            e.vy = -430;
            e.vx = s.dir * s.speed * 1.35;
            s.squash = 1;
            s.hopT = 0.2;
          }
        }
        if (e.moveX(e.vx * dt)) { e.vx = 0; s.dir = -s.dir; }
        e.moveY(e.vy * dt, sierpLand);
        if (!grounded) s.rot += e.vx * dt * 0.045;
      } else {
        // depth 2 scurries, chasing the player along the same floor
        if (alive(P) && Math.abs(dxp) < 8 * T && Math.abs(P.y + P.h - (e.y + e.h)) < 2 * T) s.dir = dxp > 0 ? 1 : -1;
        AP.Phys.walk(e, dt, s.speed);
      }
      var moved = e.x - x0;
      if (s.mode !== 'pop') s.roll += moved / Math.max(4, s.side) * (TAU / 3);
      if (e.y > L.ph + 64) {
        var root = sierpRoot(e);
        if (e === root) { s.gone = true; e.active = false; e.visible = false; e.collidable = false; }
        else L.remove(e);
      }
    },
    onStomp: function (e, P, L) { if (e.s.grace > 0) return false; sierpHit(e, L, 'stomp'); return true; },
    onDash: function (e, P, L) { if (e.s.grace > 0) return false; sierpHit(e, L, 'dash'); return true; },
    onBurst: function (e, P, L) { if (e.s.grace <= 0) sierpHit(e, L, 'burst'); },
    onRespawn: function (e, L) {
      var s = e.s;
      if (s.root) return;
      // the original comes back at home and its whole family is pruned
      for (var i = 0; i < s.family.length; i++) L.remove(s.family[i]);
      s.family.length = 0;
      s.gone = false;
      s.mode = 'walk';
      s.grace = 0;
      s.roll = 0;
      s.rot = 0;
      s.dir = e.spec && e.spec.dir === 'left' ? -1 : 1;
      e.active = true;
      e.visible = true;
      e.collidable = true;
      e.hazard = true;
      e.vx = 0;
      e.vy = 0;
      e.setPos(e.homeX, e.homeY);
    },
    render: function (e, ctx, L) {
      var s = e.s;
      var p = palOf(L), sh = shades(p);
      var S = s.side;
      var hgt = S * SQ3_2;
      var bottom = e.ry + e.h;
      var cx = e.rx + e.w / 2;
      // rolling: rotate about the centroid and lift so the lowest vertex stays on the floor
      var rot = s.mode === 'pop' || s.depth === 1 ? s.rot : s.roll;
      var cr = Math.cos(rot), sr = Math.sin(rot);
      var low = -1e9;
      for (var v = 0; v < 3; v++) {
        var ang = -Math.PI / 2 + v * TAU / 3;
        var vx0 = Math.cos(ang) * hgt * 2 / 3, vy0 = Math.sin(ang) * hgt * 2 / 3;
        low = Math.max(low, vx0 * sr + vy0 * cr);
      }
      var sq = s.squash;
      var sx = 1 + 0.18 * sq, sy = 1 - 0.18 * sq;
      var cy = bottom - low * sy;
      var grace = s.grace > 0;
      ctx.globalAlpha = grace ? 0.55 + 0.45 * Math.sin(L.time * 40) * Math.sin(L.time * 40) : 1;
      if (s.depth === 0) AP.R.glow(ctx, cx, cy, 30, p.hazard, 0.28 + 0.15 * beatPulse());
      var lv = 2 - s.depth;
      var g = unitGasket(lv);
      // outer triangle fill + outline
      ctx.beginPath();
      for (var k = 0; k < 3; k++) {
        var a = -Math.PI / 2 + k * TAU / 3;
        var ux = Math.cos(a) * hgt * 2 / 3, uy = Math.sin(a) * hgt * 2 / 3;
        var wx = cx + (ux * cr - uy * sr) * sx, wy = cy + (ux * sr + uy * cr) * sy;
        if (k === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(sh.bodyH, 0.85);
      ctx.fill();
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = s.depth === 2 ? 2 : 2.5;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      // the gasket inside (self-similar: these are exactly the children it splits into)
      if (lv > 0) {
        ctx.beginPath();
        for (var i = 0; i < g.length; i += 6) {
          for (var q = 0; q < 3; q++) {
            var gx = g[i + q * 2] * S, gy = g[i + q * 2 + 1] * S;
            var wx2 = cx + (gx * cr - gy * sr) * sx, wy2 = cy + (gx * sr + gy * cr) * sy;
            if (q === 0) ctx.moveTo(wx2, wy2); else ctx.lineTo(wx2, wy2);
          }
          ctx.closePath();
        }
        ctx.fillStyle = rgba(p.hazard, 0.32);
        ctx.fill();
        ctx.strokeStyle = rgba(p.hazard, 0.75);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // eye (looks toward the player)
      var ex = cx + s.lookX * S * 0.08, ey = cy + S * 0.02;
      if (s.blink > 0) {
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(1.4, S * 0.075), 0, TAU);
        ctx.fill();
        ctx.fillStyle = p.bg;
        ctx.beginPath();
        ctx.arc(ex + s.lookX * S * 0.025, ey, Math.max(0.7, S * 0.035), 0, TAU);
        ctx.fill();
      } else {
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ex - S * 0.07, ey); ctx.lineTo(ex + S * 0.07, ey);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  });

  // ================================================================ w4.fruit
  AP.Entities.register('w4.fruit', {
    kind: 'sensor', anchor: 'center', w: 26, h: 26, layer: 4, lint: 'ignore', renderPad: 48,
    init: function (e, spec) {
      var s = e.s;
      s.respawn = Math.max(0.3, num(spec.respawn, 2.5));
      s.st = 'ripe';
      s.t = 0;
      s.k = 1;
      s.pop = 0;
      s.ph = hashf(e.tx * 13, e.ty * 7, 4) * TAU;
    },
    update: function (e, dt, L) {
      var s = e.s;
      if (s.pop > 0) s.pop = Math.max(0, s.pop - dt * 3);
      if (s.st === 'eaten') {
        s.t += dt;
        if (s.t >= s.respawn) {
          s.st = 'grow';
          s.t = 0;
          if (onScreen(L, e.x, e.y, e.w, e.h, 32)) AP.FX.burst('w4.sprout', e.x + e.w / 2, e.y + e.h, { n: 4 });
        }
      } else if (s.st === 'grow') {
        s.t += dt;
        s.k = smooth(s.t / 0.35);
        if (s.t >= 0.35) { s.st = 'ripe'; s.k = 1; s.pop = 1; }
      }
    },
    onTouch: function (e, P, L) {
      var s = e.s;
      if (s.st !== 'ripe') return;
      if (!P.refresh()) return;
      s.st = 'eaten';
      s.t = 0;
      s.k = 0;
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      AP.FX.burst('w4.juice', cx, cy);
      AP.sfxAt('refill', cx, cy);
      L.hitstop(0.025);
      L.kick(0, -1.5);
      L.emit('w4:fruit', { x: cx, y: cy });
    },
    onRespawn: function (e) { var s = e.s; s.st = 'ripe'; s.t = 0; s.k = 1; },
    render: function (e, ctx, L) {
      var s = e.s;
      var p = palOf(L), sh = shades(p);
      var t = L.time;
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2 + Math.sin(t * 2.2 + s.ph) * 2.2;
      var pb = beatPulse();
      if (s.st === 'eaten') {
        // ghost with a regrowth dial
        ctx.setLineDash(DOTS);
        ctx.strokeStyle = rgba(p.accent, 0.3);
        ctx.lineWidth = 1.2;
        AP.R.poly(ctx, cx, cy, 10, 6, Math.PI / 6);
        ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.strokeStyle = rgba(p.accent, 0.55);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, 13, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(s.t / s.respawn));
        ctx.stroke();
        return;
      }
      var k = s.k * (1 + 0.12 * pb + 0.25 * s.pop);
      AP.R.glow(ctx, cx, cy, 24 * s.k, p.accent, 0.4 + 0.25 * pb);
      // crown: stalk and two leaves
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 9 * k); ctx.lineTo(cx + 1, cy - 14 * k);
      ctx.moveTo(cx + 1, cy - 13 * k); ctx.quadraticCurveTo(cx + 7 * k, cy - 18 * k, cx + 9 * k, cy - 13 * k);
      ctx.moveTo(cx + 1, cy - 13 * k); ctx.quadraticCurveTo(cx - 5 * k, cy - 17 * k, cx - 7 * k, cy - 12 * k);
      ctx.stroke();
      // hexagonal rind
      AP.R.poly(ctx, cx, cy, 10.5 * k, 6, Math.PI / 6 + Math.sin(t * 0.9 + s.ph) * 0.12);
      ctx.fillStyle = rgba(p.accent, 0.3);
      ctx.fill();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      // phyllotaxis seeds (golden angle)
      for (var i = 1; i <= 13; i++) {
        var r = 2.05 * Math.sqrt(i) * k, a = i * 2.39996323 + t * 0.35;
        ctx.fillStyle = i % 3 === 0 ? p.ink : sh.blush;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, (1.05 + 0.25 * (i % 2)) * k, 0, TAU);
        ctx.fill();
      }
    }
  });
  var DOTS = [3, 3];
  var NODASH = [];

  // ================================================================ w4.pod (vine trigger)
  AP.Entities.register('w4.pod', {
    kind: 'sensor', anchor: 'center', w: 26, h: 26, layer: 4, lint: 'ignore', renderPad: 48,
    init: function (e, spec) {
      e.s.tag = spec.tag !== undefined ? spec.tag : null;
      e.s.open = 0;
      e.s.done = false;
      e.s.ph = hashf(e.tx, e.ty, 6) * TAU;
    },
    update: function (e, dt, L) {
      var s = e.s;
      if (!s.done && s.tag !== null && L.flags[s.tag]) { s.done = true; s.open = Math.max(s.open, 0.01); }
      if (s.done && s.open < 1) s.open = Math.min(1, s.open + dt * 2.5);
    },
    onTouch: function (e, P, L) {
      var s = e.s;
      if (s.done) return;
      s.done = true;
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (s.tag !== null) L.flags[s.tag] = true;
      L.emit('w4:grow', { tag: s.tag });
      AP.FX.burst('w4.bloom', cx, cy, { n: 14, radius: 30 });
      AP.FX.burst('w4.petals', cx, cy, { n: 10 });
      AP.sfxAt('chime', cx, cy, { vol: 0.7 });
      L.flash(palOf(L).accent, 0.1, 0.18);
      L.shake(2.5, 0.15);
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      var t = L.time, pb = beatPulse();
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2 + Math.sin(t * 1.8 + s.ph) * 1.5;
      var o = smooth(s.open);
      if (!s.done) AP.R.glow(ctx, cx, cy, 26, p.accent, 0.35 + 0.3 * pb);
      // husk: six lobes that peel open when triggered
      ctx.lineJoin = 'round';
      for (var i = 0; i < 6; i++) {
        var a = i * TAU / 6 + Math.PI / 6 + t * 0.15;
        var r0 = 4 + 8 * o, len = 11 - 3 * o;
        var bx = cx + Math.cos(a) * r0, by = cy + Math.sin(a) * r0;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a - 0.6) * 3, by + Math.sin(a - 0.6) * 3);
        ctx.quadraticCurveTo(bx + Math.cos(a) * len * 1.2, by + Math.sin(a) * len * 1.2, bx + Math.cos(a + 0.6) * 3, by + Math.sin(a + 0.6) * 3);
        ctx.strokeStyle = s.done ? rgba(p.primary, 0.6) : p.accent;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.fillStyle = s.done ? rgba(p.accent, 0.35) : p.accent;
      AP.R.poly(ctx, cx, cy, (s.done ? 3 : 5) + pb, 6, t * 0.8);
      ctx.fill();
      if (s.done) {
        ctx.fillStyle = p.ink;
        AP.R.poly(ctx, cx, cy, 1.6, 6, 0);
        ctx.fill();
      }
    }
  });

  // shared with js/worlds/w4/boss.js and js/levels/w4.js (pure geometry; no state)
  AP.W4 = {
    vinePads: vinePads,
    thornRect: thornRect,
    shades: shades,
    unitGasket: unitGasket
  };
})(window.AP = window.AP || {});
