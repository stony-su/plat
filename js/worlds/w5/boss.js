/* js/worlds/w5/boss.js — owner: W5 */
(function (AP) {
  'use strict';

  // THE NULL — the final boss of APEIRON (DESIGN section 3, CONTRACT section 2.17).
  // A zero-dimensional black point with a halo of harmonograph arms that unmake geometry.
  // 12 hits over 4 phases (3 each); every damage method is telegraphed in the accent colour (the core
  // cracks open gold for 0.75 s before it can be hit, and a gold arc counts the window down).
  //   I    SWEEP     harmonograph arms rake the floor from alternating walls (each announced by a gold
  //                  floor line for 0.85 s): jump them. Then the core sinks low and cracks open: dash
  //                  or stomp into it.
  //   II   WELL      a pulsing gravity well (addForce), ring waves on the bar whose gap is shown a beat
  //                  ahead by a gold wedge, and two orbit nodes: fling from them into the opened core.
  //   III  UNMAKING  the floor is eaten into three floating islands (doomed cells flicker for 1.3 s; tile
  //                  snapshot restored on respawn) while beams fall on Euclidean onsets; the core sinks
  //                  over the central island.
  //   IV   COLLAPSE  it collapses to a point; three nodes circle it and arms rake the floor; only an
  //                  orbit-and-fling into the core counts (a dash is deflected with a gold ring).
  // An open core bends a fling aimed roughly at it into itself. A damage window opens at most 8.2 s
  // after the last one in every phase. Defeat: a white flash (flash settings apply), the geometry
  // returns, and the common Vertex shows its infinity sign (completeLevel with ending true).
  // Minions (flagged e.minion): w5.arm, w5.ripple, w5.beam and w5.orbiter nodes.

  var C = AP.C;
  var M = AP.M;
  var TAU = Math.PI * 2;
  var Ent = AP.Entities;
  var TILE = AP.TILE;

  var HP = [3, 3, 3, 3];
  var TOTAL = 12;
  var BOX = 56;                         // constant hitbox (open-core contact area)
  var LETHAL_R = [22, 22, 22, 12];      // lethal radius of the closed core per phase (IV: a point)
  // Timings. The worst gap between two damage windows is max(INTRO_T, eating) + OPEN_MAX + DESCEND_T,
  // CLOSE_T + OPEN_MAX + DESCEND_T or RECOIL_T + OPEN_MAX + DESCEND_T: at most 8.2 s (CONTRACT: 10 s).
  var INTRO_T = [1.4, 1.8, 1.4, 2.2];
  var RESPAWN_INTRO = [1.0, 1.2, 1.6, 1.4];
  var OPEN_AT = [4.4, 4.4, 4.8, 2.0];   // seconds of attack before the core opens
  var OPEN_MAX = 6.0;                   // hard cap (phase I waits for its arms up to this)
  var OPEN_DUR = [2.8, 3.3, 3.0, 4.8];
  var DESCEND_T = 0.75;                 // opening telegraph (cracks, descent)
  var CLOSE_T = 0.65;
  var RECOIL_T = 0.9;
  var DEFLECT_CD = 0.45;
  var INTENSITY = [0.64, 0.76, 0.88, 1.0];
  var LOOP_V = [0.22, 0.32, 0.45, 0.6];

  // ---------------------------------------------------------------- helpers
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function mix(a, b, t) { return AP.Color.mix(a, b, t); }
  function palOf(L) { return (L && L.pal) || AP.R.pal('void'); }
  function live(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn' && P.state !== 'frozen'; }
  function beatPulse() { var B = AP.Beat; var q = 1 - (B ? B.phase : 0); return q * q * q; }
  function frac(x) { return x - Math.floor(x); }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function boxNear(cx, cy, x, y, w, h) {
    var dx = cx < x ? x - cx : (cx > x + w ? cx - (x + w) : 0);
    var dy = cy < y ? y - cy : (cy > y + h ? cy - (y + h) : 0);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function boxFar(cx, cy, x, y, w, h) {
    var dx = Math.max(Math.abs(cx - x), Math.abs(cx - (x + w)));
    var dy = Math.max(Math.abs(cy - y), Math.abs(cy - (y + h)));
    return Math.sqrt(dx * dx + dy * dy);
  }
  function euclid(k, n, rot) {
    var B = AP.Beat;
    if (B && typeof B.euclidPattern === 'function') return B.euclidPattern(k, n, rot || 0);
    var out = new Uint8Array(n);
    var r = ((rot | 0) % n + n) % n;
    for (var i = 0; i < n; i++) out[i] = (((i + r) * k) % n) < k ? 1 : 0;
    return out;
  }
  function spikyArc(ctx, cx, cy, r, a0, a1, tooth, step) {
    var span = a1 - a0;
    var n = Math.max(2, Math.ceil(span * r / step));
    for (var i = 0; i <= n; i++) {
      var a = a0 + span * i / n;
      var rr = (i & 1) ? r + tooth : r;
      var x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }
  function solidTile(c) { return c === TILE.SOLID || c === TILE.BREAK; }

  var DASH = [6, 6];
  var NODASH = [];
  // FX option objects reused by effects that fire many times a second
  var O_ARMSPARK = { dir: 0, color: '#fff' };
  var O_PULL = { n: 2, radius: 14, color: '#fff' };
  var O_WELL = { radius: 170, n: 5 };
  var O_DIE = { tx: 0, ty: 0, n: 2, color: '#fff' };

  // ---------------------------------------------------------------- FX presets (w5.*)
  function fxPal() { return (AP.level && AP.level.pal) || AP.R.pal('void'); }
  var O_UNMAKE = { n: 1, color: '#fff', color2: '#000', speed: 0, angle: 0, life: [0.5, 0.8], size: [2.5, 4.5], sizeEnd: 0.5, shape: 'sq', spin: [-6, 6], drag: 0.4, additive: true };
  // a tile dissolving into the Null: squares thrown toward (o.tx, o.ty)
  AP.FX.preset('w5.unmake', function (x, y, o) {
    var p = fxPal();
    var tx = (o && typeof o.tx === 'number') ? o.tx : x, ty = (o && typeof o.ty === 'number') ? o.ty : y - 200;
    var d = Math.sqrt((tx - x) * (tx - x) + (ty - y) * (ty - y)) || 1;
    var a = Math.atan2(ty - y, tx - x);
    O_UNMAKE.color = (o && o.color) || p.primary;
    O_UNMAKE.color2 = p.accent;
    var c = 0, n = (o && o.n) || 4;
    for (var i = 0; i < n; i++) {
      O_UNMAKE.angle = a + (i - n / 2) * 0.12;
      O_UNMAKE.speed = d / 0.7 * (0.75 + 0.1 * i);
      c += AP.FX.emit(x + (i % 2 ? 8 : -8), y + (i > 1 ? 8 : -8), O_UNMAKE);
    }
    return c;
  });

  var O_IMPLODE = { n: 1, color: '#fff', color2: '#fff', speed: 0, angle: 0, life: 0.5, size: [2, 4], shape: 'tri', spin: [-8, 8], drag: 0 };
  // the well: motes falling inward from a ring of radius o.radius
  AP.FX.preset('w5.implode', function (x, y, o) {
    var p = fxPal();
    var R = (o && o.radius) || 160, n = (o && o.n) || 8;
    O_IMPLODE.color = (o && o.color) || p.accent; O_IMPLODE.color2 = p.ink;
    O_IMPLODE.life = 0.55;
    var c = 0, base = (AP.level ? AP.level.time : 0) * 1.7;
    for (var i = 0; i < n; i++) {
      var a = base + i * TAU / n;
      O_IMPLODE.angle = a + Math.PI + 0.5;
      O_IMPLODE.speed = R / 0.55;
      c += AP.FX.emit(x + Math.cos(a) * R, y + Math.sin(a) * R, O_IMPLODE);
    }
    return c;
  });

  // ================================================================ minion: w5.arm
  // A harmonograph arm whose tip rakes the floor: jump or dash over it.
  var ARM_R = [12, 8, 6];               // lethal radii of the tip and its trailing barbs
  var ARM_DX = [0, 20, 35];
  var ARM_DY = [0, 3, 6];

  Ent.register('w5.arm', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 7, lint: 'ignore', renderPad: 64, alwaysRender: true,
    init: function (e, spec) {
      var s = e.s;
      s.dir = num(spec.dir, 1) >= 0 ? 1 : -1;
      s.speed = num(spec.speed, 340);
      s.tele = Math.max(0.6, num(spec.tele, 0.85));
      s.y = num(spec.y, e.y + 16);
      s.x0 = num(spec.x0, e.x + 16);
      s.x1 = num(spec.x1, s.x0 + s.dir * 800);
      s.x = s.x0;
      s.st = 'tele';
      s.t = 0;
      s.spin = 0;
      s.dustT = 0;
      s.ox = s.x0; s.oy = s.y - 260;
      s.alpha = 0;
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.t += dt;
      var par = e.parent;
      if (par && !par.dead) { s.ox = par.x + par.w / 2; s.oy = par.y + par.h / 2; }
      if (s.st === 'tele') {
        s.alpha = Math.min(1, s.t / 0.25);
        if (s.t >= s.tele) {
          s.st = 'sweep'; s.t = 0;
          AP.sfxAt('whoosh', s.x, s.y, { vol: 0.75, pitch: 0.8 });
          L.shake(2, 0.15);
        }
      } else if (s.st === 'sweep') {
        s.x += s.dir * s.speed * dt;
        s.dustT -= dt;
        if (s.dustT <= 0) {
          s.dustT = 0.05;
          O_ARMSPARK.dir = s.dir > 0 ? -Math.PI * 0.8 : -Math.PI * 0.2;
          O_ARMSPARK.color = palOf(L).hazard;
          AP.FX.burst('spark', s.x - s.dir * 10, s.y + 12, O_ARMSPARK);
        }
        if ((s.dir > 0 && s.x >= s.x1) || (s.dir < 0 && s.x <= s.x1)) { s.st = 'fade'; s.t = 0; }
        var P = L.player;
        if (live(P)) {
          for (var i = 0; i < 3; i++) {
            if (boxNear(s.x - s.dir * ARM_DX[i], s.y + ARM_DY[i], P.x, P.y, P.w, P.h) <= ARM_R[i]) { L.killPlayer('w5.null'); break; }
          }
        }
      } else if (s.st === 'fade') {
        s.alpha = Math.max(0, 1 - s.t / 0.35);
        if (s.t >= 0.35) L.remove(e);
      }
      s.spin += dt * 10 * s.dir;
      e.x = s.x - 16;
      e.y = s.y - 16;
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      var a = s.alpha;
      if (a <= 0.01) return;
      var tele = s.st === 'tele';
      var k = tele ? ease(s.t / s.tele) : 1;
      // the tip descends from the Null to its start during the telegraph
      var tx = s.ox + (s.x - s.ox) * k, ty = s.oy + (s.y - s.oy) * k;
      // tether: a harmonograph strand from the Null to the tip
      ctx.globalAlpha = a;
      ctx.strokeStyle = rgba(tele ? p.accent : p.primary, tele ? 0.55 : 0.4);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      var t = L.time;
      for (var i = 0; i <= 28; i++) {
        var u = i / 28;
        var bx = s.ox + (tx - s.ox) * u, by = s.oy + (ty - s.oy) * (u * u * 0.5 + u * 0.5);
        var w = Math.sin(u * Math.PI) * (26 * Math.sin(u * 9 + t * 4.2 * s.dir) + 12 * Math.sin(u * 17 - t * 2.3));
        var nx = -(ty - s.oy), ny = tx - s.ox;
        var nl = Math.sqrt(nx * nx + ny * ny) || 1;
        bx += nx / nl * w; by += ny / nl * w;
        if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
      }
      ctx.stroke();
      if (tele) {
        // the sweep line along the floor (gold): where the arm is about to rake
        ctx.strokeStyle = rgba(p.accent, 0.35 + 0.5 * k);
        ctx.lineWidth = 2;
        ctx.setLineDash(DASH);
        ctx.lineDashOffset = -t * 120 * s.dir;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y + 12); ctx.lineTo(s.x1, s.y + 12);
        ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.lineDashOffset = 0;
        // chevrons pointing along the sweep
        ctx.beginPath();
        for (var c = 0; c < 3; c++) {
          var cxp = s.x0 + s.dir * (40 + c * 22 + (t * 80) % 22);
          ctx.moveTo(cxp - s.dir * 6, s.y + 4); ctx.lineTo(cxp, s.y + 10); ctx.lineTo(cxp - s.dir * 6, s.y + 16);
        }
        ctx.stroke();
        AP.R.glow(ctx, tx, ty, 26, p.accent, 0.5 * k);
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 2;
        AP.R.star(ctx, tx, ty, 10 + 4 * k, 6, 6, s.spin);
        ctx.stroke();
      } else {
        // trailing barbs, then the spiked tip (hazard)
        for (var j = 2; j >= 1; j--) {
          ctx.fillStyle = rgba(p.hazard, 0.4);
          ctx.strokeStyle = p.hazard;
          ctx.lineWidth = 1.5;
          AP.R.star(ctx, s.x - s.dir * ARM_DX[j], s.y + ARM_DY[j], ARM_R[j] + 4, ARM_R[j] - 2, 5, -s.spin * 1.3 + j);
          ctx.fill(); ctx.stroke();
        }
        AP.R.glow(ctx, s.x, s.y, 30, p.hazard, 0.55 * a);
        ctx.fillStyle = rgba(p.hazard, 0.5);
        ctx.strokeStyle = p.hazard;
        ctx.lineWidth = 2;
        AP.R.star(ctx, s.x, s.y, 17, 9, 8, s.spin);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = p.ink;
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  });

  // ================================================================ minion: w5.ripple
  // A ring wave expanding from the Null with one gap (the gap was shown by a gold wedge first).
  var RIP_TH = 5;
  Ent.register('w5.ripple', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 7, lint: 'ignore', renderPad: 64, alwaysRender: true,
    init: function (e, spec) {
      var s = e.s;
      s.cx = e.x + e.w / 2;
      s.cy = e.y + e.h / 2;
      s.rr = num(spec.r0, 30);
      s.speed = num(spec.speed, 210);
      s.ga = num(spec.ga, Math.PI / 2);
      s.half = num(spec.half, 0.7);
      s.maxR = num(spec.maxR, 900);
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.rr += s.speed * dt;
      if (s.rr > s.maxR) { L.remove(e); return; }
      var P = L.player;
      if (!live(P) || s.rr < 40) return;
      var cx = s.cx, cy = s.cy;
      var dn = boxNear(cx, cy, P.x, P.y, P.w, P.h), df = boxFar(cx, cy, P.x, P.y, P.w, P.h);
      if (dn > s.rr + RIP_TH || df < s.rr - RIP_TH) return;
      var pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
      var dist = Math.max(1, Math.sqrt((pcx - cx) * (pcx - cx) + (pcy - cy) * (pcy - cy)));
      var half = Math.asin(Math.min(1, 15.6 / Math.max(15.6, dist)));
      var diff = Math.abs(M.angleDiff(Math.atan2(pcy - cy, pcx - cx), s.ga));
      if (diff + half > s.half) L.killPlayer('w5.null');
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      var a0 = s.ga + s.half, a1 = s.ga - s.half + TAU;
      var fade = Math.min(1, (s.maxR - s.rr) / 80);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = rgba(p.hazard, 0.22);
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(s.cx, s.cy, s.rr, a0, a1); ctx.stroke();
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2;
      ctx.beginPath();
      spikyArc(ctx, s.cx, s.cy, s.rr - 2, a0, a1, 6, 10);
      ctx.stroke();
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(s.cx + Math.cos(a0) * s.rr, s.cy + Math.sin(a0) * s.rr, 3, 0, TAU);
      ctx.arc(s.cx + Math.cos(a1) * s.rr, s.cy + Math.sin(a1) * s.rr, 3, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  });

  // ================================================================ minion: w5.beam
  // A vertical beam from the ceiling: a gold telegraph line, then a lethal pulse on the onset.
  var BEAM_W = 16;
  function beamBottom(L, x, top) {
    var tx = Math.floor(x / 32);
    for (var ty = Math.max(0, Math.floor(top / 32)); ty < L.h; ty++) {
      if (solidTile(L.tileAt(tx, ty))) return ty * 32;
    }
    return L.ph + 64;
  }
  Ent.register('w5.beam', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 7, lint: 'ignore', renderPad: 64, alwaysRender: true,
    init: function (e, spec, L) {
      var s = e.s;
      s.x = e.x + e.w / 2;
      s.top = num(spec.top, 32);
      s.tele = Math.max(0.42, num(spec.tele, 0.47));
      s.fire = num(spec.fire, 0.28);
      s.st = 'tele';
      s.t = 0;
      s.bottom = beamBottom(L, s.x, s.top + 2);
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.t += dt;
      if (s.st === 'tele') {
        if (s.t >= s.tele) {
          s.st = 'fire'; s.t = 0;
          s.bottom = beamBottom(L, s.x, s.top + 2);
          AP.sfxAt('laser', s.x, (s.top + Math.min(s.bottom, L.ph)) / 2, { vol: 0.55, pitch: 0.85 });
          if (s.bottom < L.ph) AP.FX.burst('w5.spark', s.x, s.bottom, { dir: -Math.PI / 2, n: 6 });
        }
      } else if (s.st === 'fire') {
        var P = L.player;
        if (live(P) && P.x < s.x + BEAM_W / 2 && P.x + P.w > s.x - BEAM_W / 2 && P.y < s.bottom && P.y + P.h > s.top) L.killPlayer('w5.null');
        if (s.t >= s.fire) { s.st = 'fade'; s.t = 0; }
      } else if (s.t >= 0.2) {
        L.remove(e);
      }
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      var bot = Math.min(s.bottom, L.ph + 32);
      if (s.st === 'tele') {
        var k = clamp(s.t / s.tele, 0, 1);
        ctx.strokeStyle = rgba(p.accent, 0.2 + 0.65 * k);
        ctx.lineWidth = 1 + 2 * k;
        ctx.setLineDash(DASH);
        ctx.lineDashOffset = -L.time * 100;
        ctx.beginPath(); ctx.moveTo(s.x, s.top); ctx.lineTo(s.x, bot); ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.lineDashOffset = 0;
        // closing brackets show the lethal width
        var br = BEAM_W / 2 + 14 * (1 - k);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x - br, s.top + 4); ctx.lineTo(s.x - br, s.top + 16);
        ctx.moveTo(s.x + br, s.top + 4); ctx.lineTo(s.x + br, s.top + 16);
        if (s.bottom < L.ph) {
          ctx.moveTo(s.x - br, bot - 4); ctx.lineTo(s.x - br, bot - 16);
          ctx.moveTo(s.x + br, bot - 4); ctx.lineTo(s.x + br, bot - 16);
        }
        ctx.stroke();
        AP.R.glow(ctx, s.x, s.top + 6, 18 + 10 * k, p.accent, 0.3 + 0.5 * k);
        return;
      }
      var g = s.st === 'fire' ? 1 : Math.max(0, 1 - s.t / 0.2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(p.hazard, 0.28 * g);
      ctx.fillRect(s.x - BEAM_W, s.top, BEAM_W * 2, bot - s.top);
      ctx.fillStyle = rgba(p.hazard, 0.8 * g);
      ctx.fillRect(s.x - BEAM_W / 2 + 2, s.top, BEAM_W - 4, bot - s.top);
      ctx.fillStyle = rgba(p.ink, 0.9 * g);
      ctx.fillRect(s.x - 1.5, s.top, 3, bot - s.top);
      ctx.globalCompositeOperation = 'source-over';
      if (s.st === 'fire') {
        // jagged edges (spiky silhouette)
        ctx.strokeStyle = p.hazard;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        var ph = (L.time * 160) % 12;
        for (var side = -1; side <= 1; side += 2) {
          var first = true;
          for (var y = s.top + ph; y < bot; y += 12) {
            var o = BEAM_W / 2 + (((y - ph) / 12) & 1 ? 7 : 2);
            if (first) { ctx.moveTo(s.x + side * o, y); first = false; } else ctx.lineTo(s.x + side * o, y);
          }
        }
        ctx.stroke();
      }
      AP.R.glow(ctx, s.x, s.top + 4, 26, p.hazard, 0.7 * g);
      if (s.bottom < L.ph) AP.R.glow(ctx, s.x, bot, 26, p.hazard, 0.6 * g);
    }
  });

  // ================================================================ the Null
  function arena(e, L) {
    var A = { left: 32, right: L.pw - 32, top: 32, floorRow: L.h - 2, floorY: (L.h - 2) * 32, cx: L.pw / 2, w: L.w, h: L.h };
    var col = Math.floor(L.w / 2);
    for (var ty = Math.floor((e.y + e.h) / 32); ty < L.h; ty++) {
      if (solidTile(L.tileAt(col, ty))) { A.floorRow = ty; A.floorY = ty * 32; break; }
    }
    // ceiling: the lowest solid row above the Null
    for (var ty2 = Math.floor(e.y / 32); ty2 >= 0; ty2--) {
      if (solidTile(L.tileAt(col, ty2))) { A.top = (ty2 + 1) * 32; break; }
    }
    // gap columns eaten in phase III: two symmetric 5-wide chasms leave three floating islands
    // (30 wide: islands 1-5, 11-18, 24-28)
    var g0 = Math.max(2, Math.round(L.w * 0.2));
    A.gaps = [];
    for (var k = 0; k < 5; k++) { A.gaps.push(g0 + k); A.gaps.push(L.w - 1 - g0 - k); }
    return A;
  }

  function remaining(s) {
    var n = Math.max(0, s.hp);
    for (var i = s.phase + 1; i < HP.length; i++) n += HP[i];
    return n;
  }

  function setState(s, st) { s.st = st; s.stT = 0; }

  function homeOf(s, L, out) {
    var A = s.A, t = L.time, p = s.phase;
    if (p === 0) { out.x = A.cx + Math.sin(t * 0.33) * 110; out.y = A.top + 148 + Math.sin(t * 0.66) * 22; }
    else if (p === 1) { out.x = A.cx + Math.sin(t * 0.27) * 70; out.y = A.top + 150 + Math.sin(t * 0.54) * 14; }
    else if (p === 2) { out.x = A.cx + Math.sin(t * 0.21) * 170; out.y = A.top + 110 + Math.sin(t * 0.42) * 16; }
    else { out.x = A.cx + Math.sin(t * 0.9) * 4; out.y = A.top + 168 + Math.sin(t * 1.3) * 4; }
    return out;
  }
  var homeOut = { x: 0, y: 0 };

  function spawnMinion(L, type, x, y, spec, parent) {
    var m = L.spawn(type, x, y, spec);
    if (m) { m.minion = true; m.parent = parent || null; }
    return m;
  }

  // ---------------------------------------------------------------- phase setup
  function setupPhase(e, L, respawn) {
    var s = e.s, p = s.phase, A = s.A;
    L.clearMinions();
    s.cycle = 0;
    s.open = false;
    s.openK = 0;
    s.lethal = false;
    s.armed = false;
    s.armIdx = 0;
    s.armNext = 0;
    s.armSide = 1;
    s.wellOn = 0;
    s.wellK = 0;
    s.wedge = false;
    s.wedgeK = 0;
    s.wedgeGa = Math.PI / 2;
    s.ripN = 0;
    s.beamN = 0;
    s.nodes.length = 0;
    s.eatQ.length = 0;
    s.eatClock = 0;
    s.restoreQ.length = 0;
    s.snap = s.base;
    if (p === 1) {
      for (var i = -1; i <= 1; i += 2) {
        var n = spawnMinion(L, 'w5.orbiter', A.cx + i * 248, A.top + 200, { r: 0.55, period: 3.2, phase: i > 0 ? 180 : 0 }, e);
        if (n) s.nodes.push(n);
      }
    } else if (p === 2) {
      planEat(e, L);
    } else if (p === 3) {
      if (!respawn) queueRestore(e, L);
      for (var j = 0; j < 3; j++) {
        var o = spawnMinion(L, 'w5.orbiter', s.cx, s.cy, { r: 4.6, period: 8.5, phase: 90 + j * 120 }, e);
        if (o) { o.s.fade = 0; s.nodes.push(o); }
      }
    }
    setState(s, 'intro');
    s.introT = respawn ? RESPAWN_INTRO[p] : INTRO_T[p];
    L.intensity = INTENSITY[p];
    AP.call('Audio.setLoop', 'void', LOOP_V[p]);
  }

  // phase III: the gap columns (both floor rows and everything below) dissolve after a telegraph
  function planEat(e, L) {
    var s = e.s, A = s.A;
    var spawnCol = Math.floor(L.checkpoint.x / 32);
    for (var g = 0; g < A.gaps.length; g++) {
      var tx = A.gaps[g];
      if (Math.abs(tx - spawnCol) <= 2) continue;
      // the middle of each chasm goes first: dissolution runs outward (gaps hold pairs, k = 0..4)
      var order = Math.abs((g >> 1) - 2);
      for (var ty = A.floorRow; ty < L.h; ty++) {
        if (!solidTile(L.tileAt(tx, ty))) continue;
        s.eatQ.push(tx, ty, 1.3 + order * 0.14 + (ty - A.floorRow) * 0.08);
      }
    }
    s.eatClock = 0;
  }

  function eatUpdate(e, dt, L) {
    var s = e.s, q = s.eatQ;
    if (!q.length) return;
    s.eatClock += dt;
    var any = false;
    for (var i = 0; i < q.length; i += 3) {
      if (q[i + 2] < 0) continue;
      any = true;
      if (s.eatClock >= q[i + 2]) {
        var tx = q[i], ty = q[i + 1];
        if (solidTile(L.tileAt(tx, ty))) {
          L.setTile(tx, ty, TILE.EMPTY);
          AP.FX.burst('w5.unmake', tx * 32 + 16, ty * 32 + 16, { tx: s.cx, ty: s.cy, n: 3 });
        }
        q[i + 2] = -1;
        if (!s.eatSfx) { s.eatSfx = true; AP.sfxAt('rumble', tx * 32, ty * 32, { vol: 0.7 }); L.shake(5, 0.4); }
      }
    }
    if (!any) { q.length = 0; s.eatSfx = false; }
  }

  // geometry returns: every cell that differs from the original arena, placed only where free
  function queueRestore(e, L) {
    var s = e.s, base = s.base, t = L.tiles, w = L.w;
    s.restoreQ.length = 0;
    for (var i = 0; i < t.length; i++) if (t[i] !== base[i]) s.restoreQ.push(i % w, (i - i % w) / w);
    s.restoreT = 0;
  }
  function restoreUpdate(e, dt, L) {
    var s = e.s, q = s.restoreQ;
    if (!q.length) return;
    s.restoreT += dt;
    var w = L.w, left = 0;
    for (var i = 0; i < q.length; i += 2) {
      var tx = q[i], ty = q[i + 1];
      if (tx < 0) continue;
      var want = s.base[ty * w + tx];
      // rebuild in a sweep from the centre outward, one column every 40 ms
      var delay = Math.abs(tx * 32 + 16 - s.A.cx) / 32 * 0.04;
      if (s.restoreT < delay) { left++; continue; }
      if (L.tileAt(tx, ty) === want) { q[i] = -1; continue; }
      if (solidTile(want) && !L.tileFree(tx, ty)) { left++; continue; }
      L.setTile(tx, ty, want);
      AP.FX.ring(tx * 32 + 16, ty * 32 + 16, 2, 18, 0.25, palOf(L).primary, 1.2);
      q[i] = -1;
    }
    if (!left) q.length = 0;
  }

  // ---------------------------------------------------------------- damage
  function hit(e, L, P) {
    var s = e.s;
    if (s.dead || L.bossDone) return false;
    s.hp--;
    s.open = false;
    s.hitCd = 0.5;
    s.hitFlash = 1;
    s.armed = false;
    if (P && live(P) && !s.stomped) {
      // ricochet off the core (stomps are bounced by the engine instead)
      var dx = (P.x + P.w / 2) - s.cx;
      P.launch((dx >= 0 ? 1 : -1) * 320, -560, { refresh: true, noCut: true });
    }
    s.stomped = false;
    if (s.hp <= 0) {
      if (s.phase < HP.length - 1) {
        s.phase++;
        s.hp = HP[s.phase];
        L.bossBar(remaining(s) / TOTAL, s.phase);
        AP.FX.ring(s.cx, s.cy, 20, 420, 0.9, palOf(L).ink, 3);
        AP.FX.burst('w5.bloom', s.cx, s.cy, { n: 34, speed: 320, color: palOf(L).accent });
        setupPhase(e, L, false);
        return true;
      }
      defeat(e, L);
      return true;
    }
    L.bossBar(remaining(s) / TOTAL, s.phase);
    setState(s, 'recoil');
    s.cycle = 0;
    return true;
  }

  function defeat(e, L) {
    var s = e.s;
    s.dead = true;
    s.hp = 0;
    setState(s, 'dying');
    L.bossBar(0, s.phase);
    L.bossDefeated(e);
    L.flash('#FFFFFF', 0.6, 0.9);
    AP.FX.ring(s.cx, s.cy, 10, 700, 1.4, '#FFFFFF', 4);
    AP.FX.burst('w5.bloom', s.cx, s.cy, { n: 55, speed: 420, color: palOf(L).accent });
    AP.call('Audio.setLoop', 'void', 0);
    L.intensity = 0.3;
    s.nodes.length = 0;
    s.eatQ.length = 0;
    queueRestore(e, L);
  }

  // the collapsed core shrugs off anything but a fling: the player is pushed clear (and refreshed, so
  // the next node is in reach) while a gold ring and a low chime say "not like this"
  function deflect(e, L, P) {
    var s = e.s;
    if (s.deflectT > 0 || !live(P)) return;
    s.deflectT = DEFLECT_CD;
    var dx = P.x + P.w / 2 - s.cx, dy = P.y + P.h / 2 - s.cy;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    P.launch(dx / d * 340, Math.min(-240, dy / d * 340), { refresh: true, noCut: true });
    AP.FX.ring(s.cx, s.cy, 12, 74, 0.35, palOf(L).accent, 2.5);
    AP.FX.burst('w5.bloom', s.cx, s.cy, { n: 8, speed: 90 });
    AP.sfxAt('chime', s.cx, s.cy, { vol: 0.5, pitch: 0.55 });
    L.shake(2, 0.12);
  }

  // A fling released roughly toward the open core (within about 50°, from up to 300u) is drawn into it:
  // the velocity turns toward the core by up to 3° a step, and an early, slow release is sped up to
  // 600 u/s. Aiming an orbit release by timing alone is a window of a few frames; this keeps the fight
  // about the orbit, not the frame. The boss remembers a fling until the player lands or grabs a node
  // (s.flungT), so the pull outlasts the player's own 0.55 s fling flag.
  var PULL_COS = 0.64, PULL_TURN = 3 * Math.PI / 180, PULL_R = 300, PULL_MIN_V = 600, PULL_ACC = 1600;
  var FLUNG_T = 1.2;
  function flung(s, P) { return s.flungT > 0 || P.flingT > 0; }
  function pullFling(s, P, L) {
    if (!live(P) || !flung(s, P) || P.state !== 'normal') return;
    var hx = s.cx - (P.x + P.w / 2), hy = s.cy - (P.y + P.h / 2);
    var hd = Math.sqrt(hx * hx + hy * hy);
    var sp = Math.sqrt(P.vx * P.vx + P.vy * P.vy);
    if (hd > PULL_R || hd < 1 || sp < 150) return;
    if ((P.vx * hx + P.vy * hy) / (sp * hd) < PULL_COS) return;
    var va = Math.atan2(P.vy, P.vx);
    var da = M.angleDiff(va, Math.atan2(hy, hx));
    var turn = clamp(da, -PULL_TURN, PULL_TURN);
    if (sp < PULL_MIN_V) sp = Math.min(PULL_MIN_V, sp + PULL_ACC * C.STEP);
    P.vx = Math.cos(va + turn) * sp;
    P.vy = Math.sin(va + turn) * sp;
    if (s.pullFx <= 0) {
      s.pullFx = 0.05;
      O_PULL.color = palOf(L).accent;
      AP.FX.burst('w5.charge', P.x + P.w / 2, P.y + P.h / 2, O_PULL);
    }
  }

  // a contact counts as a strike while the core is open: dash, stomp, or flying in after a fling
  function striking(P, s) {
    if (P.state === 'dash' || P.flingT > 0 || (s && s.flungT > 0)) return true;
    return P.vx * P.vx + P.vy * P.vy > 640 * 640;
  }

  // ---------------------------------------------------------------- phase behaviours
  function phaseArms(e, dt, L, during) {
    var s = e.s, A = s.A, P = L.player;
    var esc = HP[s.phase] - s.hp;
    if (s.phase === 0) {
      // a sweep from the far side toward the player, then one back from the other side; from the
      // second hit on they come sooner and faster, and from the third a last sweep follows. Every
      // sweep is announced by a gold floor line for 0.85 s, and all of them are over before the core
      // opens (OPEN_AT waits for them, up to OPEN_MAX).
      var sp = 400 + 45 * esc;
      if (s.armIdx === 0 && s.cycle >= 0.3) { launchArm(e, L, sideAway(s, P), sp); s.armIdx = 1; }
      else if (s.armIdx === 1 && s.cycle >= (esc >= 1 ? 1.6 : 2.0)) { launchArm(e, L, s.lastArmDir, sp); s.armIdx = 2; }
      else if (s.armIdx === 2 && esc >= 2 && s.cycle >= 2.7) { launchArm(e, L, s.lastArmDir, sp + 30); s.armIdx = 3; }
    } else if (s.phase === 3) {
      // the floor is raked once while closed and again while open: stay in the air
      if (during === 'attack' && s.armIdx === 0 && s.cycle >= 0.35) { launchArm(e, L, sideAway(s, P), 360 + 30 * esc); s.armIdx = 1; }
      if (during === 'open' && s.armIdx === 1 && s.stT >= 1.4) {
        launchArm(e, L, s.lastArmDir, 370 + 30 * esc);
        s.armIdx = 2;
        if (esc >= 2) s.armNext = s.stT + 1.0;
      }
      if (during === 'open' && s.armIdx === 2 && s.armNext > 0 && s.stT >= s.armNext) { launchArm(e, L, s.lastArmDir, 380); s.armNext = 0; s.armIdx = 3; }
    }
  }
  function sideAway(s, P) {
    // the side of the arena away from the player: the arm starts there and sweeps toward them
    if (!P) return 1;
    return (P.x + P.w / 2) < s.A.cx ? 1 : -1;
  }
  function launchArm(e, L, fromSide, speed) {
    var s = e.s, A = s.A;
    var dir = -fromSide;                                  // starts at fromSide, sweeps the other way
    // the tip emerges from inside the side wall, so a sweep can never begin on top of the player
    var x0 = fromSide > 0 ? A.right + 16 : A.left - 16;
    var x1 = fromSide > 0 ? A.left - 30 : A.right + 30;
    spawnMinion(L, 'w5.arm', x0, A.floorY - 13, { dir: dir, speed: speed, tele: 0.85, y: A.floorY - 13, x0: x0, x1: x1 }, e);
    s.lastArmDir = dir;
    AP.sfxAt('charge', x0, A.floorY - 40, { vol: 0.4, pitch: 0.7 });
  }

  function phaseWell(e, dt, L) {
    var s = e.s, P = L.player, B = AP.Beat;
    var esc = HP[s.phase] - s.hp;
    // the well pulses: 2.4 s on, 1.0 s off (0.5 s of gold in-falling rings warn before it turns on)
    var c = s.cycle % 3.4;
    var on = c >= 0.5 && c < 2.9 && s.st === 'attack';
    s.wellTele = (c < 0.5 && s.st === 'attack') ? c / 0.5 : 0;
    s.wellOn = on ? 1 : 0;
    s.wellK = M.approach(s.wellK, on ? 1 : 0, dt * 3);
    if (on && live(P) && P.state !== 'orbit') {
      var dx = s.cx - (P.x + P.w / 2), dy = s.cy - (P.y + P.h / 2);
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var str = (680 + 160 * esc) * clamp(1.15 - d / 760, 0.3, 1);
      P.addForce(dx / d * str, dy / d * str * 0.35);
    }
    if (on) {
      s.wellFx -= dt;
      if (s.wellFx <= 0) { s.wellFx = 0.12; AP.FX.burst('w5.implode', s.cx, s.cy, O_WELL); }
    }
    // ring waves on the bar; their gap is shown by a gold wedge one beat ahead
    var bi = Math.floor(B.beat);
    if (bi !== s.lastBeat) {
      s.lastBeat = bi;
      var inBar = ((bi % B.meter) + B.meter) % B.meter;
      if (s.st === 'attack' && s.cycle > 0.3 && s.cycle < OPEN_AT[1] - 0.9 && inBar === B.meter - 1 && !s.wedge) {
        s.wedge = true;
        s.wedgeK = 0;
        var aim = live(P) ? Math.atan2(P.y + P.h / 2 - s.cy, P.x + P.w / 2 - s.cx) : Math.PI / 2;
        s.ripN++;
        s.wedgeGa = aim + ((s.ripN & 1) ? 1 : -1) * (0.55 + 0.1 * esc);
        s.wedgeHalf = 0.62 - 0.07 * esc;
        AP.sfxAt('charge', s.cx, s.cy, { vol: 0.35, pitch: 1.1 });
      } else if (inBar === 0 && s.wedge) {
        s.wedge = false;
        spawnMinion(L, 'w5.ripple', s.cx, s.cy, { ga: s.wedgeGa, half: s.wedgeHalf, speed: 205 + 20 * esc, r0: 30, maxR: 1100 }, e);
        AP.sfxAt('pulse', s.cx, s.cy, { vol: 0.8, pitch: 0.7 });
        L.shake(3, 0.2);
      }
    }
    if (s.wedge) s.wedgeK = Math.min(1, s.wedgeK + dt / Math.max(0.42, 60 / B.bpm));
  }

  function phaseBeams(e, dt, L) {
    var s = e.s, A = s.A, P = L.player, B = AP.Beat;
    var esc = HP[s.phase] - s.hp;
    var n = 8, k = 3 + esc;                               // E(3,8) → E(4,8) → E(5,8)
    var pat = euclid(k, n, 0);
    var stepDur = 60 / B.bpm * B.meter / n;
    var sp = B.beat / B.meter * n;
    var cur = Math.floor(sp);
    // look two steps ahead (the pattern rotated by 2): a beam spawned now fires on the onset
    var ticked = B.euclidTicked(k, n, 2);
    if (cur !== s.lastStep) {
      s.lastStep = cur;
      var ahead = pat[((cur + 2) % n + n) % n] === 1;
      if (ahead && (ticked || (sp - cur) < 0.5) && s.st === 'attack' && s.cycle > 0.2) {
        var tele = Math.max(0.42, (cur + 2 - sp) * stepDur);
        var cols = esc >= 1 ? 2 : 1;
        for (var b = 0; b < cols; b++) {
          var x;
          if (b === 0 && live(P)) x = clamp(Math.floor((P.x + P.w / 2) / 32) * 32 + 16, A.left + 16, A.right - 16);
          else {
            s.beamN++;
            var u = frac(s.beamN * 0.6180339887 + 0.17);
            x = Math.floor(A.left / 32) * 32 + 16 + Math.floor(u * (A.w - 2)) * 32;
          }
          spawnMinion(L, 'w5.beam', x, A.top + 16, { top: A.top, tele: tele, fire: 0.26 }, e);
        }
      }
    }
  }

  // ---------------------------------------------------------------- def
  Ent.register('w5.null', {
    kind: 'sensor', w: BOX, h: BOX, anchor: 'center', layer: 6, lint: 'ignore', boss: true,
    bossName: 'The Null', phases: 4, renderPad: 640, alwaysRender: true,
    init: function (e, spec, L) {
      var s = e.s;
      s.A = arena(e, L);
      s.base = L.snapshotTiles();
      s.snap = s.base;
      s.started = false;
      s.dead = false;
      s.phase = 0;
      s.hp = HP[0];
      s.st = 'dormant';
      s.stT = 0;
      s.introT = INTRO_T[0];
      s.cx = e.x + e.w / 2;
      s.cy = e.y + e.h / 2;
      s.vx = 0; s.vy = 0;
      s.cycle = 0;
      s.open = false;
      s.openK = 0;
      s.lethal = false;
      s.armed = false;
      s.hitCd = 0;
      s.hitFlash = 0;
      s.deflectT = 0;
      s.pullFx = 0;
      s.flungT = 0;
      L.on('player:fling', function () { s.flungT = FLUNG_T; });
      s.stomped = false;
      s.openSide = 1;
      s.nodes = [];
      s.eatQ = [];
      s.eatClock = 0;
      s.eatSfx = false;
      s.restoreQ = [];
      s.restoreT = 0;
      s.lastBeat = -1;
      s.lastStep = -1;
      s.lastArmDir = 1;
      s.armIdx = 0; s.armNext = 0;
      s.wellOn = 0; s.wellK = 0; s.wellTele = 0; s.wellFx = 0;
      s.wedge = false; s.wedgeK = 0; s.wedgeGa = Math.PI / 2; s.wedgeHalf = 0.6;
      s.ripN = 0; s.beamN = 0;
      s.form = 0;                         // 0 dormant → 1 formed (intro animation)
      s.collapse = 0;                     // phase IV point form
      s.dieT = 0;
      s.spin = 0;
      s.aimK = 0;
      e.hazard = false;
      e.dashable = false;
      e.stompable = false;
    },
    update: function (e, dt, L) {
      var s = e.s, P = L.player, A = s.A;
      s.spin += dt * (0.6 + 0.25 * s.phase + 1.5 * s.openK);
      if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 2.5);
      // ------------------------------------------------ before the fight
      if (!s.started) {
        s.form = Math.min(0.35, s.form + dt * 0.2);
        if (L.playerMoved || L.bossInfo) {
          s.started = true;
          if (!L.bossInfo) L.bossStart(e);
          L.bossBar(1, 0);
          setupPhase(e, L, false);
        } else {
          syncBox(e);
          return;
        }
      }
      // ------------------------------------------------ defeated
      if (s.dead) {
        s.stT += dt;
        s.dieT += dt;
        restoreUpdate(e, dt, L);
        if (s.dieT < 1.6 && ((s.dieT * 10) | 0) !== (((s.dieT - dt) * 10) | 0)) {
          O_DIE.tx = s.cx; O_DIE.ty = s.cy; O_DIE.color = palOf(L).ink;
          AP.FX.burst('w5.unmake', s.cx + Math.sin(s.dieT * 17) * 140, s.cy + Math.cos(s.dieT * 13) * 90, O_DIE);
        }
        e.dashable = false; e.stompable = false; e.hazard = false;
        if (s.dieT > 2.6) e.visible = false;
        syncBox(e);
        return;
      }
      s.stT += dt;
      if (s.hitCd > 0) s.hitCd -= dt;
      if (s.deflectT > 0) s.deflectT -= dt;
      if (s.pullFx > 0) s.pullFx -= dt;
      if (s.flungT > 0) {
        s.flungT -= dt;
        if (!live(P) || P.grounded || P.state === 'orbit') s.flungT = 0;
      }
      s.form = Math.min(1, s.form + dt * 0.8);
      eatUpdate(e, dt, L);
      restoreUpdate(e, dt, L);
      var p = s.phase;
      var home = homeOf(s, L, homeOut);
      var tx = home.x, ty = home.y, follow = 3;
      // ------------------------------------------------ state machine
      if (s.st === 'intro') {
        follow = 2.5;
        if (p === 3) {
          s.collapse = Math.min(1, s.collapse + dt / 1.6);
          for (var ni = 0; ni < s.nodes.length; ni++) s.nodes[ni].s.fade = Math.min(1, s.nodes[ni].s.fade + dt / 1.2);
        }
        if (s.stT >= s.introT && !s.eatQ.length) { setState(s, 'attack'); s.cycle = 0; s.armIdx = 0; s.armNext = 0; s.lastStep = -1; }
      } else if (s.st === 'attack') {
        s.cycle += dt;
        var ready = s.cycle >= OPEN_AT[p];
        if (p === 0 && ready && s.cycle < OPEN_MAX && L.count('w5.arm') > 0) ready = false;
        if (ready || s.cycle >= OPEN_MAX) {
          setState(s, 'opening');
          s.armed = false;                // after it closes again it only arms once the player is clear
          s.openSide = -s.openSide;
          AP.sfxAt('chime', s.cx, s.cy, { vol: 0.6, pitch: 0.75 });
          AP.FX.burst('w5.bloom', s.cx, s.cy, { n: 13, speed: 120 });
        }
      } else if (s.st === 'opening') {
        follow = 6;
        s.openK = ease(s.stT / DESCEND_T);
        if (s.stT >= DESCEND_T) {
          setState(s, 'open');
          s.open = true;
          s.openK = 1;
          AP.sfxAt('secret', s.cx, s.cy, { vol: 0.7, pitch: 0.8 });
          AP.FX.ring(s.cx, s.cy, 20, 90, 0.45, palOf(L).accent, 3);
        }
      } else if (s.st === 'open') {
        follow = 5;
        s.openK = 1;
        if (s.stT >= OPEN_DUR[p]) {
          setState(s, 'closing');
          s.open = false;
          AP.sfxAt('charge', s.cx, s.cy, { vol: 0.45, pitch: 0.6 });
        }
      } else if (s.st === 'closing') {
        follow = 3;
        s.openK = 1 - ease(s.stT / CLOSE_T);
        if (s.stT >= CLOSE_T) { setState(s, 'attack'); s.cycle = 0; s.armIdx = 0; s.armNext = 0; s.openK = 0; }
      } else if (s.st === 'recoil') {
        follow = 3.5;
        s.openK = Math.max(0, s.openK - dt * 2.5);
        if (s.stT >= RECOIL_T) { setState(s, 'attack'); s.cycle = 0; s.armIdx = 0; s.armNext = 0; }
      }
      // where the core goes while it is opening / open
      if (s.st === 'opening' || s.st === 'open') {
        if (p === 0) { tx = A.cx + s.openSide * 150; ty = A.floorY - 42; }
        else if (p === 1) { tx = A.cx; ty = A.top + 200; }
        else if (p === 2) { tx = A.cx; ty = A.floorY - 46; }
        else { tx = home.x; ty = home.y; }
      }
      // ------------------------------------------------ attacks
      if (p === 0 && s.st === 'attack') phaseArms(e, dt, L, 'attack');
      if (p === 1) phaseWell(e, dt, L);
      else { s.wellK = M.approach(s.wellK, 0, dt * 3); s.wellTele = 0; s.wedge = false; }
      if (p === 2 && s.st === 'attack') phaseBeams(e, dt, L);
      if (p === 3 && (s.st === 'attack' || s.st === 'open')) phaseArms(e, dt, L, s.st);
      if (p === 3) {
        for (var nj = 0; nj < s.nodes.length; nj++) { var nd = s.nodes[nj]; if (!nd.dead) { nd.s.cx = s.cx; nd.s.cy = s.cy; } }
      }
      // ------------------------------------------------ motion
      var kf = Math.min(1, dt * follow);
      s.cx += (tx - s.cx) * kf;
      s.cy += (ty - s.cy) * kf;
      syncBox(e);
      // ------------------------------------------------ the open core draws a flung player in
      if (s.open) pullFling(s, P, L);
      // ------------------------------------------------ vulnerability and lethality
      e.dashable = s.open;
      e.stompable = s.open;
      var lethalNow = (s.st === 'attack') || (s.st === 'closing' && s.stT > CLOSE_T * 0.5);
      var R = LETHAL_R[p];
      var near = live(P) ? boxNear(s.cx, s.cy, P.x, P.y, P.w, P.h) : 1e9;
      if (!s.armed && near > R + 10) s.armed = true;     // never arm on top of the player
      s.lethal = lethalNow && s.armed;
      if (s.lethal && near <= R) L.killPlayer('w5.null');
      // phase IV: the aim guide brightens when a fling from the current node would reach the core
      s.aimK = 0;
      if (p === 3 && P && P.state === 'orbit' && P.orbitNode && P.orbitNode.parent === e) {
        var th = P.orbitTheta, dir = P.orbitDir;
        var tgx = -Math.sin(th) * dir, tgy = Math.cos(th) * dir;
        var ux = s.cx - (P.x + P.w / 2), uy = s.cy - (P.y + P.h / 2);
        var ul = Math.sqrt(ux * ux + uy * uy) || 1;
        var dot = (tgx * ux + tgy * uy) / ul;
        s.aimK = dot >= Math.cos(C.ORBIT_AIM_ASSIST_DEG * Math.PI / 180) ? 1 : 0.25;
      }
    },
    // phases I-III: dash, stomp or fly into the open core. The finale (IV) yields only to a fling: a dash
    // or a stomp falls through to onTouch, which deflects the player with a ring of light.
    onDash: function (e, P, L) {
      var s = e.s;
      if (!s.open || s.hitCd > 0) return false;
      if (s.phase === 3 && !flung(s, P)) return false;
      hit(e, L, P);
      return true;
    },
    onStomp: function (e, P, L) {
      var s = e.s;
      if (!s.open || s.hitCd > 0) return false;
      if (s.phase === 3 && !flung(s, P)) return false;
      s.stomped = true;
      hit(e, L, P);
      return true;
    },
    onTouch: function (e, P, L) {
      var s = e.s;
      if (!s.open || s.hitCd > 0) return;
      if (s.phase === 3) {
        if (flung(s, P)) hit(e, L, P);
        else deflect(e, L, P);
        return;
      }
      if (!striking(P, s)) return;
      hit(e, L, P);
    },
    onPlayerDeath: function (e, L) {
      var s = e.s;
      L.clearMinions();
      s.nodes.length = 0;
      s.wedge = false;
      s.wellOn = 0;
    },
    onRespawn: function (e, L) {
      var s = e.s;
      if (s.dead || !s.started) return;
      s.hp = HP[s.phase];
      s.eatQ.length = 0;
      s.restoreQ.length = 0;
      L.restoreTiles(s.snap);
      var h = homeOf(s, L, homeOut);
      s.cx = h.x; s.cy = h.y;
      syncBox(e);
      e.setPos(e.x, e.y);
      setupPhase(e, L, true);
      if (s.phase === 3) { s.collapse = 1; for (var i = 0; i < s.nodes.length; i++) s.nodes[i].s.fade = 1; }
      L.bossBar(remaining(s) / TOTAL, s.phase);
    },
    debugDamage: function (e, L) {
      var s = e.s;
      if (s.dead || L.bossDone) return;
      if (!s.started) {
        s.started = true;
        if (!L.bossInfo) L.bossStart(e);
        setupPhase(e, L, false);
      }
      // force the core open for this one hit
      s.open = true;
      s.hitCd = 0;
      hit(e, L, null);
    },
    render: function (e, ctx, L) { renderNull(e, ctx, L); }
  });

  function syncBox(e) {
    var s = e.s;
    e.x = s.cx - BOX / 2;
    e.y = s.cy - BOX / 2;
  }

  // ---------------------------------------------------------------- rendering
  var HALO_N = 5;
  // harmonograph parameters (AP.Algo.harmonograph a1..d4 form), mutated in place each frame
  var HG = { cx: 0, cy: 0, a1: 0, f1: 0.3, p1: 0, d1: 0.11, a2: 0, f2: 0.451, p2: 0, d2: 0.09,
    a3: 0, f3: 0.2, p3: 0, d3: 0.1, a4: 0, f4: 0.302, p4: 0, d4: 0.12 };
  function renderNull(e, ctx, L) {
    var s = e.s, p = palOf(L), A = s.A;
    var cx = e.rx + BOX / 2, cy = e.ry + BOX / 2;
    var t = L.time;
    var b = beatPulse();
    var form = s.form;
    var dieK = s.dead ? clamp(s.dieT / 2.4, 0, 1) : 0;
    var scale = (1 - 0.45 * s.collapse) * (1 - dieK) * (0.4 + 0.6 * form);
    if (scale <= 0.01 && s.dead) return;
    var openK = s.openK;
    // doomed floor cells (phase III telegraph): cracked gold outlines that flicker toward hazard
    if (s.eatQ.length) {
      var q = s.eatQ;
      for (var i = 0; i < q.length; i += 3) {
        if (q[i + 2] < 0) continue;
        var left = q[i + 2] - s.eatClock;
        var k = clamp(1 - left / 1.3, 0, 1);
        var fl = 0.5 + 0.5 * Math.sin(t * (10 + 20 * k));
        var x = q[i] * 32, y = q[i + 1] * 32;
        ctx.fillStyle = rgba(p.hazard, 0.08 + 0.22 * k * fl);
        ctx.fillRect(x + 1, y + 1, 30, 30);
        ctx.strokeStyle = rgba(k > 0.75 ? p.hazard : p.accent, 0.4 + 0.5 * fl);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 2, y + 2, 28, 28);
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 4); ctx.lineTo(x + 14, y + 15); ctx.lineTo(x + 9, y + 27);
        ctx.moveTo(x + 14, y + 15); ctx.lineTo(x + 26, y + 20);
        ctx.stroke();
      }
    }
    // the well: gold rings falling inward
    var wk = Math.max(s.wellK, s.wellTele || 0);
    if (wk > 0.02) {
      ctx.lineWidth = 1.5;
      for (var r = 0; r < 4; r++) {
        var ph = frac(t * 0.7 + r / 4);
        var rr = 40 + 260 * (1 - ph);
        ctx.strokeStyle = rgba(p.accent, 0.22 * wk * ph);
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      }
    }
    // ripple telegraph: a gold wedge where the next ring's gap will be
    if (s.wedge) {
      var wkk = s.wedgeK;
      ctx.fillStyle = rgba(p.accent, 0.06 + 0.14 * wkk);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 900, s.wedgeGa - s.wedgeHalf, s.wedgeGa + s.wedgeHalf);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(p.accent, 0.4 + 0.5 * wkk);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var sd = -1; sd <= 1; sd += 2) {
        var ea = s.wedgeGa + sd * s.wedgeHalf;
        ctx.moveTo(cx + Math.cos(ea) * 40, cy + Math.sin(ea) * 40);
        ctx.lineTo(cx + Math.cos(ea) * 900, cy + Math.sin(ea) * 900);
      }
      ctx.stroke();
    }
    // behind it, a slowly evolving damped harmonograph: two pendulums per axis near a 2:3 ratio, drifting
    if (AP.Art && AP.Art.harmonograph && form > 0.2) {
      var hs = (1 - 0.4 * s.collapse) * (0.6 + 0.4 * form) * (1 - dieK);
      HG.cx = cx; HG.cy = cy;
      HG.a1 = 150 * hs; HG.a2 = 40 * hs; HG.a3 = 110 * hs; HG.a4 = 36 * hs;
      HG.p1 = t * 0.21; HG.p2 = t * 0.13 + 1.3; HG.p3 = t * 0.17 + 0.7; HG.p4 = -t * 0.11;
      AP.Art.harmonograph(ctx, HG, 0, 9, 150, rgba(p.primary, (0.07 + 0.05 * b) * (0.4 + 0.6 * form)), 1);
    }
    // halo of harmonograph arms (decay outward, turning)
    var R0 = 30 * scale, R1 = (190 - 60 * s.collapse) * (0.5 + 0.5 * form) * (1 - dieK) + 300 * dieK;
    for (var h = 0; h < HALO_N; h++) {
      var a0 = s.spin * (h & 1 ? -1 : 1) * 0.6 + h * TAU / HALO_N;
      ctx.strokeStyle = h === 2 ? rgba(p.accent, 0.35 * (1 - dieK)) : rgba(p.primary, (0.16 + 0.1 * b) * (1 - dieK * 0.6));
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (var j = 0; j <= 40; j++) {
        var u = j / 40;
        var rad = R0 + (R1 - R0) * u + 10 * Math.sin(u * 13 + t * 1.6 + h);
        var ang = a0 + u * (2.6 + 0.8 * Math.sin(t * 0.4 + h)) + 0.25 * Math.sin(u * 7 - t * 2.1);
        var hx = cx + Math.cos(ang) * rad * 1.15, hy = cy + Math.sin(ang) * rad * 0.82;
        if (j === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
      }
      ctx.stroke();
    }
    // geometry being unmade: polygons spiralling in, shedding sides
    for (var g = 0; g < 7; g++) {
      var per = 3.2 + (g % 3) * 0.9;
      var pk = frac(t / per + g * 0.137);
      var pr = (40 + 210 * (1 - pk)) * (0.6 + 0.4 * form);
      var pa = g * 0.9 + pk * 3.4 + t * 0.2;
      var sides = 6 - Math.min(3, Math.floor(pk * 4));
      ctx.strokeStyle = rgba(g % 3 === 0 ? p.accent : p.primary, 0.35 * Math.min(1, pk * 4) * (1 - pk) * (1 - dieK));
      ctx.lineWidth = 1.2;
      AP.R.poly(ctx, cx + Math.cos(pa) * pr * 1.1, cy + Math.sin(pa) * pr * 0.85, 3 + 7 * (1 - pk), sides, pa * 2);
      ctx.stroke();
    }
    // phase IV aim guide: a gold line from the orbiting player to the core
    var P = L.player;
    if (s.phase === 3 && s.aimK > 0 && P && P.state === 'orbit') {
      var pcx = P.rx + P.w / 2, pcy = P.ry + P.h / 2;
      ctx.strokeStyle = rgba(s.open ? p.accent : p.hazard, s.aimK > 0.5 ? 0.85 : 0.2);
      ctx.lineWidth = s.aimK > 0.5 ? 2 : 1;
      ctx.setLineDash(DASH);
      ctx.lineDashOffset = -t * 120;
      ctx.beginPath(); ctx.moveTo(pcx, pcy); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.setLineDash(NODASH);
      ctx.lineDashOffset = 0;
    }
    // the event horizon
    var rc = 22 * scale;
    var lethalVis = !s.open && s.st !== 'opening' && s.st !== 'intro' && s.started && !s.dead;
    var spk = lethalVis ? (1 - openK) : 0;
    AP.R.glow(ctx, cx, cy, 48, openK > 0.1 ? p.accent : p.hazard, (0.25 + 0.3 * b) * (0.5 + 0.5 * form) * (1 - dieK) + 0.6 * s.hitFlash);
    if (spk > 0.02) {
      ctx.fillStyle = rgba(p.hazard, 0.22 * spk);
      ctx.strokeStyle = rgba(p.hazard, 0.9 * spk);
      ctx.lineWidth = 2;
      AP.R.star(ctx, cx, cy, rc + 11 * spk + 2 * b, rc + 1, 14, s.spin * 1.4);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = p.bg;
    ctx.beginPath(); ctx.arc(cx, cy, rc, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(p.ink, 0.85 * (1 - dieK) + 0.15);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, rc, 0, TAU); ctx.stroke();
    if (openK > 0.02) {
      // the cracked core (gold): the way in
      ctx.strokeStyle = rgba(p.accent, 0.95 * openK);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var c = 0; c < 7; c++) {
        var ca = c * TAU / 7 + 0.4;
        var l1 = rc * 0.35, l2 = rc * (0.75 + 0.5 * openK);
        ctx.moveTo(cx + Math.cos(ca) * l1, cy + Math.sin(ca) * l1);
        ctx.lineTo(cx + Math.cos(ca + 0.22) * (l1 + l2) * 0.55, cy + Math.sin(ca + 0.22) * (l1 + l2) * 0.55);
        ctx.lineTo(cx + Math.cos(ca - 0.1) * l2, cy + Math.sin(ca - 0.1) * l2);
      }
      ctx.stroke();
      AP.R.glow(ctx, cx, cy, 34, p.accent, 0.8 * openK * (0.7 + 0.3 * b));
      ctx.fillStyle = mix(p.accent, p.ink, 0.5 + 0.5 * b);
      ctx.beginPath(); ctx.arc(cx, cy, 4 + 4 * openK, 0, TAU); ctx.fill();
      // the opening countdown: a gold arc that shrinks as the window closes
      if (s.st === 'open') {
        var left2 = 1 - s.stT / OPEN_DUR[s.phase];
        ctx.strokeStyle = rgba(p.accent, 0.8);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, rc + 9, -Math.PI / 2, -Math.PI / 2 + TAU * left2); ctx.stroke();
      }
    } else {
      // the empty-set slash: the Null's sigil
      ctx.strokeStyle = rgba(p.ink, 0.5 * (1 - dieK));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - rc * 0.95, cy + rc * 0.95); ctx.lineTo(cx + rc * 0.95, cy - rc * 0.95);
      ctx.stroke();
    }
    if (s.dead) {
      // implosion rings
      for (var di = 0; di < 3; di++) {
        var dk = frac(s.dieT * 0.9 + di / 3);
        ctx.strokeStyle = rgba('#FFFFFF', 0.5 * (1 - dk) * (1 - dieK));
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 10 + 260 * dk, 0, TAU); ctx.stroke();
      }
    }
  }
})(window.AP = window.AP || {});
