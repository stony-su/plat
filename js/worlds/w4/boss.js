/* js/worlds/w4/boss.js — owner: W4 */
(function (AP) {
  'use strict';

  // The Recursion (w4.recursion), the W4 boss (CONTRACT 2.17, DESIGN 3 W4): a giant Sierpinski gasket whose core is
  // the empty central triangle. Every hit is a dash into an OPEN core (accent): 10 hits over 4 phases.
  //   0 AXIOM      the whole (2 hits). Koch thorn waves run along the floor, seed fans, then it kneels (accent
  //                shadow telegraph) and opens its core.
  //   1 THREE      dashed apart, it splits into its three corner copies (1 hit each). They drift on their own
  //                Lissajous orbits, snipe seeds, raise cracked-bark vine walls and kneel one at a time.
  //   2 ITERATION  the parts remember the whole and rebuild it, spinning (3 hits): converging thorn waves, sprouting
  //                seed volleys from all three corners, vine walls and shorter windows.
  //   3 LIMIT      it collapses to its smallest self (2 hits): telegraphed darts that end in seed rings, then it
  //                stalls on the floor with the last core open. The final dash ends it.
  // The controller entity lives for the whole fight (L.bossEnt stays valid) and simulates and draws its copies
  // itself. Minions (w4.seed, thorn strips) are flagged and cleared on death. Vine walls are BREAK tiles placed only
  // where L.tileFree; every phase starts on a clean arena whose snapshot is restored on respawn.
  // Also registers w4.seed: the boss's spiky seed projectile (sensor, hazard; spec vx, vy, gravity in tiles).

  var T = 32;
  var TAU = Math.PI * 2;
  var SQ3 = Math.sqrt(3);
  var H3 = SQ3 / 2;
  var TILE = AP.TILE;

  var HP = [2, 3, 3, 2];
  var TOTAL = 10;
  var SIDE = [240, 120, 240, 64];          // triangle side per phase (u)
  var GD = [3, 2, 3, 1];                   // gasket depth drawn per phase (self-similar: each copy is one level less)
  var CORE = [52, 28, 52, 20];             // reach of the open core from the player's box (u)
  var OPENT = [2.6, 2.3, 2.2, 2.2];        // seconds a core stays open
  var KNEEL_TELE = 0.65;                   // accent floor-shadow telegraph before a kneel drops
  var SPIN1 = [-0.35, 0.35, 0.35];         // spin of the three copies (rad/s)
  var DROP_T = 0.3;
  var CLOSE_T = 0.25;
  var RISE_T = 0.55;
  var NAME = 'The Recursion';

  // ---------------------------------------------------------------- helpers
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeIn(t) { t = clamp01(t); return t * t * t; }
  function easeOut(t) { t = clamp01(t); var u = 1 - t; return 1 - u * u * u; }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }
  function palOf(L) { return (L && L.pal) || AP.R.pal('w4'); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; return (1 - ph) * (1 - ph) * (1 - ph); }
  function hashf(a, b) { return (AP.hash2(a | 0, b | 0, 0x4B55) % 65536) / 65536; }

  var shadeMemo = [];
  function shades(p) {
    for (var i = 0; i < shadeMemo.length; i++) if (shadeMemo[i].pal === p) return shadeMemo[i].tab;
    var mix = AP.Color.mix;
    var tab = {
      bodyH: mix(p.bg, p.hazard, 0.24), deepH: mix(p.bg, p.hazard, 0.5), lightH: mix(p.hazard, p.ink, 0.35),
      dimA: mix(p.accent, p.bg, 0.5), hotA: mix(p.accent, p.ink, 0.45), stem: mix(p.primary, p.bg, 0.35),
      ghost: mix(p.ink, p.bg, 0.55)
    };
    shadeMemo.push({ pal: p, tab: tab });
    if (shadeMemo.length > 8) shadeMemo.shift();
    return tab;
  }

  // unit gaskets (side 1, centroid at the origin, apex up), cached per depth
  var gaskets = [];
  function gasket(d) {
    if (!gaskets[d]) {
      var tris = AP.Algo.sierpinski(0, 0, 1, d), g = new Float32Array(tris.length * 6);
      for (var i = 0; i < tris.length; i++) for (var k = 0; k < 6; k++) g[i * 6 + k] = tris[i][k];
      gaskets[d] = g;
    }
    return gaskets[d];
  }

  // corner sub-triangle centroids of a unit triangle (apex, bottom-right, bottom-left), in the rotation frame
  var CORNER = [0, -H3 / 3, 0.25, H3 / 6, -0.25, H3 / 6];

  // ---------------------------------------------------------------- FX presets
  function fxPal() { return (AP.level && AP.level.pal) || AP.R.pal('w4'); }
  var EO = { n: 8, color: '#fff', color2: '#fff', shape: 'tri', speed: [60, 180], angle: [0, TAU], life: [0.3, 0.6],
    size: [2, 4], sizeEnd: 0, gravity: 0, drag: 0, spin: [-6, 6], additive: true, back: false, spread: 0, width: 2, align: false };
  function eo(n, c1, c2, shape, s0, s1, a0, a1, l0, l1, z0, z1) {
    EO.n = n; EO.color = c1; EO.color2 = c2; EO.shape = shape;
    EO.speed[0] = s0; EO.speed[1] = s1; EO.angle[0] = a0; EO.angle[1] = a1;
    EO.life[0] = l0; EO.life[1] = l1; EO.size[0] = z0; EO.size[1] = z1;
    EO.sizeEnd = 0; EO.gravity = 0; EO.drag = 0; EO.spin[0] = -6; EO.spin[1] = 6;
    EO.additive = true; EO.back = false; EO.spread = 0; EO.width = 2; EO.align = false;
    return EO;
  }
  // the gasket comes apart: hazard triangles fly out of the three corners, with an accent ring
  AP.FX.preset('w4.fracture', function (x, y, o) {
    var p = fxPal(), r = num(o.radius, 60);
    AP.FX.ring(x, y, r * 0.2, r * 1.5, 0.5, p.accent, 3);
    AP.FX.ring(x, y, 4, r * 0.9, 0.3, p.ink, 2);
    var q = eo(o.n || 22, p.hazard, p.bg, 'tri', 120, 380, 0, TAU, 0.45, 0.9, 3, 7);
    q.drag = 2.2; q.gravity = 160; q.spin[0] = -12; q.spin[1] = 12; q.spread = r * 0.3;
    var k = AP.FX.emit(x, y, q);
    q = eo(10, p.accent, p.ink, 'star', 60, 220, 0, TAU, 0.4, 0.8, 2.5, 4.5);
    q.drag = 3;
    return k + AP.FX.emit(x, y, q);
  });
  // the core is struck: accent hexagons and a bright spark line burst
  AP.FX.preset('w4.coreHit', function (x, y, o) {
    var p = fxPal();
    AP.FX.ring(x, y, 6, num(o.radius, 50) * 1.4, 0.35, p.accent, 3);
    var q = eo(o.n || 12, p.accent, p.ink, 'hex', 80, 260, 0, TAU, 0.3, 0.6, 3, 6);
    q.drag = 3;
    var k = AP.FX.emit(x, y, q);
    q = eo(8, p.ink, p.accent, 'line', 220, 420, 0, TAU, 0.15, 0.3, 8, 16);
    q.align = true; q.width = 2;
    return k + AP.FX.emit(x, y, q);
  });
  // the falling copy lands: dust along the floor both ways
  AP.FX.preset('w4.slam', function (x, y, o) {
    var p = fxPal(), wdt = num(o.width, 120);
    var q = eo(o.n || 10, p.primary, p.bg, 'tri', 60, 220, Math.PI - 0.35, Math.PI + 0.1, 0.35, 0.7, 2, 4);
    q.drag = 3; q.gravity = 300; q.additive = false; q.spread = 6;
    var k = AP.FX.emit(x - wdt * 0.5, y - 2, q);
    q = eo(o.n || 10, p.primary, p.bg, 'tri', 60, 220, -0.1, 0.35, 0.35, 0.7, 2, 4);
    q.drag = 3; q.gravity = 300; q.additive = false; q.spread = 6;
    k += AP.FX.emit(x + wdt * 0.5, y - 2, q);
    AP.FX.ring(x, y - 2, 6, wdt * 0.7, 0.3, p.accent, 2);
    return k;
  });

  // ================================================================ w4.seed (projectile)
  function sproutAt(L, tx, ty) {
    if (ty < 1 || tx < 1 || tx >= L.w - 1) return;
    if (L.tileAt(tx, ty) !== TILE.EMPTY) return;
    var c = L.tileAt(tx, ty + 1);
    if (c !== TILE.SOLID && c !== TILE.BREAK) return;
    var th = L.spawn('w4.thorn', tx * T, ty * T, { once: true, w: 1, h: 0.5, dir: 'up', depth: 3, tele: 0.5, life: 1.3, quiet: true });
    if (th) th.minion = true;
  }

  AP.Entities.register('w4.seed', {
    kind: 'sensor', hazard: true, anchor: 'center', w: 12, h: 12, layer: 7, lint: 'ignore', renderPad: 24,
    init: function (e, spec) {
      var s = e.s;
      s.vx = num(spec.vx, 0) * T;
      s.vy = num(spec.vy, 0) * T;
      s.g = num(spec.gravity, 0) * T;
      s.sprout = !!spec.sprout;
      s.life = Math.max(0.5, num(spec.life, 6));
      s.age = 0;
      s.rot = (e.id * 1.37) % TAU;
      s.spin = ((e.id & 1) ? 1 : -1) * (5 + (e.id % 5));
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.age += dt;
      if (s.age >= s.life) { L.remove(e); return; }
      s.vy += s.g * dt;
      e.x += s.vx * dt;
      e.y += s.vy * dt;
      s.rot += s.spin * dt;
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (cx < -48 || cx > L.pw + 48 || cy < -48 || cy > L.ph + 48) { L.remove(e); return; }
      var tx = Math.floor(cx / T), ty = Math.floor(cy / T);
      var c = L.tileAt(tx, ty);
      if (c === TILE.SOLID || c === TILE.BREAK) {
        if (s.sprout && s.vy > 0) sproutAt(L, tx, ty - 1);
        if (!L.cam || L.cam.visible(e.x, e.y, e.w, e.h, 32)) AP.FX.burst('w4.seed', cx, cy, { n: 4 });
        L.remove(e);
      }
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L), sh = shades(p);
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      if (sp > 30) {
        // short motion streak behind the seed
        var ux = s.vx / sp, uy = s.vy / sp;
        ctx.strokeStyle = rgba(p.hazard, 0.35);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - ux * 4, cy - uy * 4);
        ctx.lineTo(cx - ux * 16, cy - uy * 16);
        ctx.stroke();
      }
      AP.R.star(ctx, cx, cy, 8, 3.6, 6, s.rot);
      ctx.fillStyle = rgba(sh.bodyH, 0.95);
      ctx.fill();
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.6, 0, TAU);
      ctx.fill();
    }
  });

  // ================================================================ the boss
  function newPart(i) {
    return {
      i: i, alive: false, ghost: false, side: 240, gd: 3, x: 0, y: 0, rot: 0, spin: 0, scale: 1,
      st: 'hover', t: 0, dur: 1, sx: 0, sy: 0, tx: 0, ty: 0, ax: 0, ay: 0,
      lax: 0, lay: 0, lfx: 1, lfy: 2, lper: 7, lph: 0,
      armed: false, open: 0, hurt: 0, charge: 0, dash: -1, kx: 0, ky: 0, darts: 0, fade: 0, pause: 0,
      gx: 0, gy: 0
    };
  }
  function newFan() { return { on: false, t: 0, tele: 0.7, n: 5, spread: 0.3, speed: 6.5, part: 0, corner: -1, ang: 0, sprout: false, ox: 0, oy: 0 }; }
  function newWave() { return { on: false, col: 0, dir: 1, t: 0, k: 0, max: 0, speed: 10, tele: 0.55, life: 0.55 }; }
  function newWall() { return { on: false, col: 0, st: 0, t: 0, hold: 4, cells: new Int16Array(64), n: 0, top: 0, bottom: 0 }; }

  // ---------------------------------------------------------------- arena
  function arena(e, L) {
    var s = e.s, spec = e.spec || {};
    var col = clamp(Math.floor((e.x + e.w / 2) / T), 1, L.w - 2);
    var fr = L.h - 1;
    for (var r = clamp(Math.floor((e.y + e.h / 2) / T), 0, L.h - 1); r < L.h; r++) {
      if (L.tileAt(col, r) === TILE.SOLID) { fr = r; break; }
    }
    s.floorY = fr * T;
    s.floorRow = fr - 1;
    s.minX = 4 * T;
    s.maxX = L.pw - 4 * T;
    s.cx = L.pw / 2;
    s.hoverY = Math.max(5 * T, Math.min(6 * T, s.floorY - 10 * T));
    var wc = Array.isArray(spec.walls) && spec.walls.length ? spec.walls : [Math.round(L.w * 0.33), Math.round(L.w * 0.67) - 1];
    s.wallCols = [];
    for (var i = 0; i < wc.length && i < 4; i++) s.wallCols.push(clamp(Math.round(+wc[i]) || 2, 2, L.w - 3));
    s.wallH = clamp(Math.round(num(spec.wallH, 10)), 3, 30);
  }

  function kneelY(s, part) { return s.floorY - 2 - part.side * H3 / 3; }

  // ---------------------------------------------------------------- parts
  function setPart(part, side, gd, x, y) {
    part.alive = true; part.ghost = false; part.side = side; part.gd = gd;
    part.x = x; part.y = y; part.rot = 0; part.spin = 0; part.scale = 1;
    part.st = 'hover'; part.t = 0; part.open = 0; part.hurt = 0; part.charge = 0; part.dash = -1;
    part.armed = false; part.darts = 0; part.fade = 0; part.pause = 0.6;
    part.ax = x; part.ay = y; part.lax = 0; part.lay = 0;
  }
  function flyPart(part, x0, y0, x1, y1, dur) {
    part.st = 'fly'; part.t = 0; part.dur = dur;
    part.sx = x0; part.sy = y0; part.tx = x1; part.ty = y1; part.x = x0; part.y = y0;
    part.armed = false;
  }

  // hover target of a part (u)
  var hv = { x: 0, y: 0 };
  function hoverAt(e, part, L, out) {
    var s = e.s, P = L.player;
    if (s.phase === 1) {
      var w = TAU / part.lper, t = s.time;
      out.x = part.ax + part.lax * Math.sin(part.lfx * w * t + part.lph);
      out.y = part.ay + part.lay * Math.sin(part.lfy * w * t);
      return out;
    }
    if (s.phase === 3) {
      out.x = part.ax;
      out.y = part.ay + Math.sin(s.time * 3.1) * 6;
      return out;
    }
    // the whole drifts above the player, slowly
    var px = alive(P) ? P.x + P.w / 2 : s.cx;
    var mx = part.side * 0.5 + T;
    part.ax += (clamp(px, mx + T, L.pw - mx - T) - part.ax) * 0.012;
    out.x = part.ax + Math.sin(s.time * 0.7) * 18;
    out.y = s.hoverY + Math.sin(s.time * 1.3) * 7;
    return out;
  }

  function kneelX(e, L, part) {
    var s = e.s, P = L.player;
    var px = alive(P) ? P.x + P.w / 2 : s.cx;
    var lo = s.minX + part.side * 0.22, hi = s.maxX - part.side * 0.22;
    var keep = part.side * 0.5 + 1.6 * T;
    var x = clamp(part.x, lo, hi);
    if (Math.abs(x - px) < keep) {
      var right = clamp(px + keep, lo, hi), left = clamp(px - keep, lo, hi);
      x = Math.abs(right - px) >= Math.abs(left - px) ? right : left;
      if (Math.abs(x - px) < keep * 0.8) x = (px < s.cx) ? hi : lo;
    }
    return x;
  }

  function kneel(e, L, part) {
    var s = e.s;
    part.st = 'aim';
    part.t = 0;
    part.sx = part.x;
    part.sy = part.y;
    part.kx = kneelX(e, L, part);
    part.ky = kneelY(s, part);
    s.kneelI = part.i;
    AP.sfxAt('charge', part.kx, s.floorY, { vol: 0.5, pitch: 0.75 });
  }

  function partHazState(st) { return st === 'hover' || st === 'aim' || st === 'drop' || st === 'rise' || st === 'dartAim' || st === 'dart'; }

  var TRI = new Float32Array(6);
  function triVerts(part) {
    var R = part.side * part.scale / SQ3;
    for (var k = 0; k < 3; k++) {
      var a = part.rot - Math.PI / 2 + k * TAU / 3;
      TRI[k * 2] = part.x + Math.cos(a) * R;
      TRI[k * 2 + 1] = part.y + Math.sin(a) * R;
    }
  }
  function segDist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    var qx = ax + dx * t - px, qy = ay + dy * t - py;
    return qx * qx + qy * qy;
  }
  // circle (player centre, r) against the part's outer triangle
  function hitsTri(part, px, py, r) {
    triVerts(part);
    var c0 = (TRI[2] - TRI[0]) * (py - TRI[1]) - (TRI[3] - TRI[1]) * (px - TRI[0]);
    var c1 = (TRI[4] - TRI[2]) * (py - TRI[3]) - (TRI[5] - TRI[3]) * (px - TRI[2]);
    var c2 = (TRI[0] - TRI[4]) * (py - TRI[5]) - (TRI[1] - TRI[5]) * (px - TRI[4]);
    if ((c0 >= 0 && c1 >= 0 && c2 >= 0) || (c0 <= 0 && c1 <= 0 && c2 <= 0)) return true;
    var r2 = r * r;
    return segDist2(px, py, TRI[0], TRI[1], TRI[2], TRI[3]) <= r2 ||
      segDist2(px, py, TRI[2], TRI[3], TRI[4], TRI[5]) <= r2 ||
      segDist2(px, py, TRI[4], TRI[5], TRI[0], TRI[1]) <= r2;
  }
  // open core within reach of the player's box
  function coreReach(part, P, phase) {
    var qx = clamp(part.x, P.x, P.x + P.w), qy = clamp(part.y, P.y, P.y + P.h);
    var dx = part.x - qx, dy = part.y - qy, r = CORE[phase] * part.scale;
    return dx * dx + dy * dy <= r * r;
  }

  function stepPart(e, part, dt, L) {
    var s = e.s, P = L.player;
    if (!part.alive && !part.ghost) return;
    part.t += dt;
    if (part.hurt > 0) part.hurt = Math.max(0, part.hurt - dt * 4);
    if (part.ghost) {
      part.fade = Math.min(1, part.fade + dt * 0.8);
      part.x += (part.gx - part.x) * Math.min(1, dt * 2.2);
      part.y += (part.gy - part.y) * Math.min(1, dt * 2.2);
      part.rot += dt * 2.5 * (1 - part.fade);
      part.scale = Math.max(0.35, 1 - part.fade * 0.6);
      return;
    }
    part.rot += part.spin * dt;
    switch (part.st) {
      case 'hover':
        hoverAt(e, part, L, hv);
        part.x += (hv.x - part.x) * Math.min(1, dt * 3);
        part.y += (hv.y - part.y) * Math.min(1, dt * 3);
        part.open = Math.max(0, part.open - dt * 4);
        if (s.phase === 3 && s.state === 'fight' && L.phase === 'play') {
          part.pause -= dt;
          if (part.pause <= 0) {
            if (part.darts >= 3) { part.darts = 0; kneel(e, L, part); }
            else dartAim(e, L, part);
          }
        }
        break;
      case 'fly':
        var kf = smooth(part.t / part.dur);
        part.x = lerp(part.sx, part.tx, kf);
        part.y = lerp(part.sy, part.ty, kf) - Math.sin(kf * Math.PI) * 24;
        if (part.t >= part.dur) { part.st = 'hover'; part.t = 0; part.armed = false; part.ax = part.tx; part.ay = part.ty; }
        break;
      case 'recoil':
        hoverAt(e, part, L, hv);
        var kr = easeOut(part.t / 0.7);
        part.x = lerp(part.sx, hv.x, kr);
        part.y = lerp(part.sy, hv.y, kr);
        part.open = Math.max(0, part.open - dt * 3);
        if (part.t >= 0.7) { part.st = 'hover'; part.t = 0; part.armed = false; part.pause = 0.5; }
        break;
      case 'aim':
        // glide over the kneel spot while the accent shadow telegraphs the drop; spinning stops flat
        var ka = smooth(part.t / KNEEL_TELE);
        part.x = lerp(part.sx, part.kx, ka);
        part.y = lerp(part.sy, Math.min(part.sy, part.ky - 2 * T), ka);
        if (part.spin !== 0 || Math.abs(part.rot) > 1e-3) {
          part.spin = 0;
          var step = TAU / 3, tgt = Math.round(part.rot / step) * step;
          part.rot += (tgt - part.rot) * Math.min(1, dt * 10);
          if (Math.abs(tgt - part.rot) < 0.01) part.rot = 0;
        }
        if (part.t >= KNEEL_TELE) { part.st = 'drop'; part.t = 0; part.sy = part.y; part.rot = 0; }
        break;
      case 'drop':
        part.y = lerp(part.sy, part.ky, easeIn(part.t / DROP_T));
        part.x = part.kx;
        if (part.t >= DROP_T) {
          part.y = part.ky;
          part.st = 'open';
          part.t = 0;
          L.shake(part.side > 100 ? 7 : 4, 0.25);
          AP.sfxAt('rumble', part.x, s.floorY, { vol: part.side > 100 ? 0.9 : 0.6 });
          AP.sfxAt('pulse', part.x, part.y, { vol: 0.7, pitch: 1.1 });
          AP.FX.burst('w4.slam', part.x, s.floorY, { width: part.side, n: part.side > 100 ? 12 : 6 });
        }
        break;
      case 'open':
        part.open = Math.min(1, part.open + dt * 5);
        part.y = part.ky + Math.sin(part.t * 9) * 1.2;
        if (part.t >= OPENT[s.phase]) { part.st = 'close'; part.t = 0; }
        break;
      case 'close':
        part.open = Math.max(0, 1 - part.t / CLOSE_T);
        if (part.t >= CLOSE_T) { part.st = 'rise'; part.t = 0; part.sx = part.x; part.sy = part.y; part.armed = false; }
        break;
      case 'rise':
        hoverAt(e, part, L, hv);
        var ku = smooth(part.t / RISE_T);
        part.x = lerp(part.sx, hv.x, ku);
        part.y = lerp(part.sy, hv.y, ku);
        if (part.t >= RISE_T) {
          part.st = 'hover'; part.t = 0; part.pause = 0.45;
          if (s.phase === 1) part.spin = SPIN1[part.i];
          if (s.kneelI === part.i) { s.kneelI = -1; s.kneelT = 1.4; }
        }
        break;
      case 'dartAim':
        part.x += (part.sx - part.x) * Math.min(1, dt * 8);
        part.y += (part.sy - part.y) * Math.min(1, dt * 8);
        if (part.t >= 0.5) { part.st = 'dart'; part.t = 0; part.sx = part.x; part.sy = part.y; AP.sfxAt('whoosh', part.x, part.y, { vol: 0.8, pitch: 1.3 }); }
        break;
      case 'dart':
        var kd = easeOut(part.t / 0.28);
        part.x = lerp(part.sx, part.tx, kd);
        part.y = lerp(part.sy, part.ty, kd);
        part.rot += dt * 14;
        if (part.t >= 0.28) {
          part.st = 'hover'; part.t = 0; part.ax = part.tx; part.ay = part.ty; part.darts++; part.pause = 0.32;
          seedRing(e, L, part, 6, 5.5);
        }
        break;
      default:
        part.st = 'hover';
    }
    // re-arm the hazard only once the player is clear of the triangle
    if (!part.armed && partHazState(part.st) && part.st !== 'fly') {
      if (!alive(P) || !hitsTri(part, P.x + P.w / 2, P.y + P.h / 2, 16)) part.armed = true;
    }
    if (!partHazState(part.st)) part.armed = false;
  }

  function dartAim(e, L, part) {
    var s = e.s, P = L.player;
    var px = alive(P) ? P.x + P.w / 2 : s.cx, py = alive(P) ? P.y + P.h / 2 : s.floorY - 3 * T;
    var side = (hashf(part.darts + 3, Math.floor(s.time * 7)) < 0.5) ? -1 : 1;
    if (px + side * 5 * T < s.minX || px + side * 5 * T > s.maxX) side = -side;
    part.tx = clamp(px + side * (4 + 2 * hashf(Math.floor(s.time * 13), part.darts)) * T, s.minX, s.maxX);
    part.ty = clamp(py - (2.5 + 2 * hashf(part.darts, Math.floor(s.time * 5))) * T, 2.5 * T, s.floorY - 3 * T);
    part.st = 'dartAim';
    part.t = 0;
    part.sx = part.x;
    part.sy = part.y;
    AP.sfxAt('charge', part.x, part.y, { vol: 0.45, pitch: 1.6 });
  }

  // ---------------------------------------------------------------- attacks
  function fanFrom(e, L, part, corner, n, spread, speed, sprout, tele) {
    var s = e.s;
    for (var i = 0; i < s.fans.length; i++) {
      var f = s.fans[i];
      if (f.on) continue;
      f.on = true; f.t = 0; f.tele = tele || 0.7; f.n = n; f.spread = spread; f.speed = speed;
      f.part = part.i; f.corner = corner; f.sprout = !!sprout; f.ang = Math.PI / 2;
      fanOrigin(e, f);
      AP.sfxAt('charge', f.ox, f.oy, { vol: 0.55, pitch: 1.15 });
      return f;
    }
    return null;
  }
  function fanOrigin(e, f) {
    var part = e.s.parts[f.part];
    if (f.corner < 0) { f.ox = part.x; f.oy = part.y; return; }
    var cr = Math.cos(part.rot), sr = Math.sin(part.rot), sd = part.side * part.scale;
    var ux = CORNER[f.corner * 2] * sd, uy = CORNER[f.corner * 2 + 1] * sd;
    f.ox = part.x + ux * cr - uy * sr;
    f.oy = part.y + ux * sr + uy * cr;
  }
  function stepFans(e, dt, L) {
    var s = e.s, P = L.player;
    for (var i = 0; i < s.fans.length; i++) {
      var f = s.fans[i];
      if (!f.on) continue;
      var part = s.parts[f.part];
      if (!part.alive) { f.on = false; continue; }
      f.t += dt;
      fanOrigin(e, f);
      part.charge = Math.max(part.charge, clamp01(f.t / f.tele));
      // aim follows the player for the first 60% of the telegraph, then locks
      if (f.t < f.tele * 0.6 && alive(P)) f.ang = Math.atan2(P.y + P.h / 2 - f.oy, P.x + P.w / 2 - f.ox);
      if (f.t >= f.tele) {
        f.on = false;
        if (L.phase !== 'play') continue;
        for (var k = 0; k < f.n; k++) {
          var a = f.ang + (k - (f.n - 1) / 2) * f.spread;
          var sd = L.spawn('w4.seed', f.ox + Math.cos(a) * 10, f.oy + Math.sin(a) * 10,
            { vx: Math.cos(a) * f.speed, vy: Math.sin(a) * f.speed, gravity: f.sprout ? 3 : 0, sprout: f.sprout, life: 6 });
          if (sd) sd.minion = true;
        }
        AP.sfxAt('shoot', f.ox, f.oy, { vol: 0.8, pitch: 0.9 + 0.05 * f.n });
        AP.FX.burst('w4.seed', f.ox, f.oy, { n: 6 });
        part.charge = 0;
      }
    }
  }
  function seedRing(e, L, part, n, speed) {
    if (L.phase !== 'play') return;
    var a0 = part.rot;
    for (var k = 0; k < n; k++) {
      var a = a0 + k * TAU / n;
      var sd = L.spawn('w4.seed', part.x + Math.cos(a) * 12, part.y + Math.sin(a) * 12, { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 4 });
      if (sd) sd.minion = true;
    }
    AP.sfxAt('shoot', part.x, part.y, { vol: 0.7, pitch: 1.25 });
    AP.FX.ring(part.x, part.y, 4, 46, 0.3, palOf(L).hazard, 2);
  }

  // Koch thorn waves along the floor: one 1-tile strip per column, spawned outward at `speed` tiles/s; each strip
  // iterates (telegraph) for `tele` s, is lethal for `life` s, then recedes.
  function waveFrom(e, L, col, dir, speed, tele, life) {
    var s = e.s;
    for (var i = 0; i < s.waves.length; i++) {
      var w = s.waves[i];
      if (w.on) continue;
      w.on = true; w.col = col; w.dir = dir; w.t = 0; w.k = 0;
      w.speed = speed || 10; w.tele = tele || 0.55; w.life = life || 0.55;
      w.max = dir > 0 ? (L.w - 2 - col) : (col - 1);
      return w;
    }
    return null;
  }
  function stepWaves(e, dt, L) {
    var s = e.s;
    for (var i = 0; i < s.waves.length; i++) {
      var w = s.waves[i];
      if (!w.on) continue;
      w.t += dt;
      while (w.k <= w.max && w.k / w.speed <= w.t) {
        var col = w.col + w.dir * w.k;
        w.k++;
        var row = s.floorRow;
        if (L.tileAt(col, row) !== TILE.EMPTY) continue;
        var below = L.tileAt(col, row + 1);
        if (below !== TILE.SOLID) continue;
        var th = L.spawn('w4.thorn', col * T, row * T, { once: true, w: 1, h: 0.5, dir: 'up', depth: 3, tele: w.tele, life: w.life, quiet: true });
        if (th) th.minion = true;
      }
      if (w.k > w.max) w.on = false;
    }
  }
  function waveSound(e, L, x) { AP.sfxAt('grow', x, e.s.floorY, { vol: 0.6, pitch: 0.7 }); }

  // vine walls: cracked bark (BREAK) that grows up a column, holds, and recedes; the dash breaks it
  function wallsGrow(e, L, hold) {
    var s = e.s, P = L.player;
    var pcol = alive(P) ? Math.floor((P.x + P.w / 2) / T) : -99;
    var made = 0;
    for (var c = 0; c < s.wallCols.length && made < s.walls.length; c++) {
      var col = s.wallCols[c];
      if (Math.abs(col - pcol) <= 1) continue;
      var wl = null;
      for (var i = 0; i < s.walls.length; i++) if (!s.walls[i].on) { wl = s.walls[i]; break; }
      if (!wl) break;
      wl.on = true; wl.col = col; wl.st = 0; wl.t = 0; wl.n = 0; wl.hold = hold;
      wl.bottom = s.floorRow; wl.top = Math.max(1, s.floorRow - s.wallH + 1);
      made++;
      AP.FX.burst('w4.sprout', col * T + 16, s.floorY, { n: 6 });
    }
    if (made) AP.sfxAt('grow', s.cx, s.floorY, { vol: 0.8, pitch: 0.85 });
  }
  function stepWalls(e, dt, L) {
    var s = e.s;
    for (var i = 0; i < s.walls.length; i++) {
      var wl = s.walls[i];
      if (!wl.on) continue;
      wl.t += dt;
      var rows = wl.bottom - wl.top + 1;
      if (wl.st === 0) {                       // telegraph: a sprouting vine climbs the column
        if (wl.t >= 0.85) { wl.st = 1; wl.t = 0; }
      } else if (wl.st === 1) {                // grow bottom-up over 0.4 s, never onto the player
        var upto = Math.min(rows, Math.floor(wl.t / 0.4 * rows) + 1);
        for (var k = wl.n; k < upto; k++) {
          var row = wl.bottom - k;
          wl.cells[k] = -1;
          if (L.tileAt(wl.col, row) === TILE.EMPTY && L.tileFree(wl.col, row)) {
            L.setTile(wl.col, row, TILE.BREAK);
            wl.cells[k] = row;
          }
        }
        wl.n = upto;
        if (wl.t >= 0.4) { wl.st = 2; wl.t = 0; }
      } else if (wl.st === 2) {
        if (wl.t >= wl.hold) { wl.st = 3; wl.t = 0; AP.sfxAt('crumble', wl.col * T + 16, (wl.top + wl.bottom) * 16, { vol: 0.5, pitch: 1.4 }); }
      } else {                                 // recede top-down over 0.35 s
        var gone = Math.min(wl.n, Math.floor(wl.t / 0.35 * wl.n) + 1);
        for (var j = 0; j < gone; j++) {
          var kk = wl.n - 1 - j;
          var rr = wl.cells[kk];
          if (rr < 0) continue;
          wl.cells[kk] = -1;
          if (L.tileAt(wl.col, rr) === TILE.BREAK) {
            L.setTile(wl.col, rr, TILE.EMPTY);
            if ((rr & 1) === 0) AP.FX.burst('w4.leaves', wl.col * T + 16, rr * T + 16, { n: 2, cone: 2.5 });
          }
        }
        if (wl.t >= 0.35) { clearWall(L, wl); }
      }
    }
  }
  function clearWall(L, wl) {
    for (var k = 0; k < wl.n; k++) {
      var r = wl.cells[k];
      if (r >= 0 && L.tileAt(wl.col, r) === TILE.BREAK) L.setTile(wl.col, r, TILE.EMPTY);
      wl.cells[k] = -1;
    }
    wl.n = 0;
    wl.on = false;
  }
  function clearArena(e, L) {
    var s = e.s, i;
    for (i = 0; i < s.walls.length; i++) if (s.walls[i].on) clearWall(L, s.walls[i]);
    for (i = 0; i < s.waves.length; i++) s.waves[i].on = false;
    for (i = 0; i < s.fans.length; i++) s.fans[i].on = false;
  }

  // ---------------------------------------------------------------- phases
  function left(s) { var n = Math.max(0, s.hp); for (var k = s.phase + 1; k < HP.length; k++) n += HP[k]; return n; }

  // sets up `phase` from its start (fresh: after a respawn, so nothing animates in)
  function beginPhase(e, L, phase, fresh) {
    var s = e.s, i, pt;
    clearArena(e, L);
    s.phase = phase;
    s.hp = HP[phase];
    s.state = 'fight';
    s.t = 0;
    s.ct = 0;
    s.ev = 0;
    s.kneelI = -1;
    for (i = 0; i < 3; i++) { s.parts[i].alive = false; s.parts[i].ghost = false; }
    var cx = s.cx;
    if (phase === 0 || phase === 2) {
      pt = s.parts[0];
      setPart(pt, SIDE[phase], GD[phase], cx, s.hoverY);
      pt.spin = phase === 2 ? 0.55 : 0;
      if (!fresh && phase === 2) { pt.scale = 0.4; }
      pt.pause = 0;
    } else if (phase === 1) {
      // copy 0 leaves from the apex to the centre, copy 1 (bottom-right corner) to the right, copy 2 to the left
      var ax = [L.pw * 0.5, L.pw * 0.76, L.pw * 0.24], ay = [s.hoverY - T, s.hoverY, s.hoverY];
      for (i = 0; i < 3; i++) {
        pt = s.parts[i];
        setPart(pt, SIDE[1], GD[1], ax[i], ay[i]);
        pt.lax = [3.2, 2.4, 2.4][i] * T; pt.lay = [1.2, 1.4, 1.4][i] * T;
        pt.lfx = [1, 2, 2][i]; pt.lfy = [2, 3, 3][i]; pt.lper = [7.5, 9, 8.2][i]; pt.lph = i * 2.1;
        pt.spin = SPIN1[i];
        if (!fresh && s.splitFrom) {
          // the copies leave the big triangle from its three corners (self-similar split)
          var bx = s.splitFrom.x + CORNER[i * 2] * 240, by = s.splitFrom.y + CORNER[i * 2 + 1] * 240;
          flyPart(pt, bx, by, ax[i], ay[i], 0.9);
        }
      }
      s.kneelT = fresh ? 2.6 : 2.2;
      s.shotT = 1.8;
      s.wallT = 4.5;
      s.rr = 0;
    } else {
      pt = s.parts[0];
      setPart(pt, SIDE[3], GD[3], cx, s.hoverY + T);
      pt.ax = cx; pt.ay = s.hoverY + T;
      pt.spin = 0.9;
      pt.pause = fresh ? 1.2 : 0.8;
    }
    s.snap = L.snapshotTiles();
    L.intensity = Math.min(1, 0.62 + 0.12 * phase);
    L.bossBar(left(s) / TOTAL, phase);
  }

  function beginIntro(e, L) {
    var s = e.s;
    s.state = 'intro';
    s.t = 0;
    var pt = s.parts[0];
    setPart(pt, SIDE[0], GD[0], s.cx, s.hoverY - T);
    pt.scale = 0.2;
    AP.FX.burst('w4.bloom', s.cx, s.hoverY, { n: 16, radius: 60 });
  }

  // the fight starts now if it has not yet (debugDamage / a forced L.bossStart)
  function ensureFight(e, L) {
    var s = e.s;
    if (s.state === 'dormant') { if (!L.bossInfo) L.bossStart(e); beginIntro(e, L); }
    if (s.state === 'intro') beginPhase(e, L, 0, true);
    if (s.state === 'split' || s.state === 'assemble' || s.state === 'collapse') beginPhase(e, L, s.next, false);
  }

  function hit(e, L, part, forced) {
    var s = e.s, P = L.player;
    if (s.state !== 'fight' || L.bossDone) return false;
    s.hp--;
    part.hurt = 1;
    part.open = Math.max(part.open, 0.6);
    AP.FX.burst('w4.coreHit', part.x, part.y, { radius: CORE[s.phase] });
    AP.FX.burst('w4.petals', part.x, part.y, { n: 10 });
    if (!forced && alive(P)) {
      var away = (P.x + P.w / 2) < part.x ? -1 : 1;
      P.launch(away * 300, -500, { refresh: true, noCut: true, lock: 0.1 });
    }
    if (s.kneelI === part.i) { s.kneelI = -1; s.kneelT = 1.5; }
    var fanned = false;
    for (var i = 0; i < s.fans.length; i++) if (s.fans[i].on && s.fans[i].part === part.i) { s.fans[i].on = false; fanned = true; }
    if (fanned) part.charge = 0;
    if (s.phase === 1) {
      // a copy is undone; its ghost drifts home to where the whole will be rebuilt
      part.alive = false;
      part.ghost = true;
      part.fade = 0;
      part.gx = s.cx;
      part.gy = s.hoverY;
      AP.FX.burst('w4.fracture', part.x, part.y, { radius: 40, n: 12 });
    } else {
      part.st = 'recoil';
      part.t = 0;
      part.sx = part.x;
      part.sy = part.y;
      part.armed = false;
    }
    if (s.hp > 0) {
      L.bossBar(left(s) / TOTAL, s.phase);
      return true;
    }
    if (s.phase === HP.length - 1) {
      // the limit is reached: the final core is dashed
      L.bossBar(0, s.phase);
      s.state = 'dying';
      s.t = 0;
      part.alive = false;
      part.ghost = false;
      s.deathX = part.x;
      s.deathY = part.y;
      clearArena(e, L);
      L.bossDefeated(e);
      AP.FX.burst('w4.fracture', part.x, part.y, { radius: 90, n: 26 });
      AP.FX.burst('w4.bloom', part.x, part.y, { n: 24, radius: 80 });
      return true;
    }
    // phase change
    var next = s.phase + 1;
    s.next = next;
    s.t = 0;
    clearArena(e, L);
    if (next === 1) {
      s.state = 'split';
      s.tdur = forced ? 0.05 : 0.5;
      s.splitFrom = { x: part.x, y: part.y };
      part.alive = false;
      AP.FX.burst('w4.fracture', part.x, part.y, { radius: 120, n: 28 });
      AP.sfxAt('split', part.x, part.y, { vol: 1, pitch: 0.8 });
    } else if (next === 2) {
      s.state = 'assemble';
      s.tdur = forced ? 0.05 : 1.4;
      AP.sfxAt('grow', s.cx, s.hoverY, { vol: 0.9, pitch: 0.6 });
    } else {
      s.state = 'collapse';
      s.tdur = forced ? 0.05 : 1.1;
      s.collX = part.x;
      s.collY = part.y;
      part.alive = false;
      AP.sfxAt('split', part.x, part.y, { vol: 1, pitch: 1.4 });
    }
    // the bar shows the hit now; the phase number changes when the next phase begins
    L.bossBar(left(s) / TOTAL, s.phase);
    s.phase = next;
    s.hp = HP[next];
    return true;
  }

  // ---------------------------------------------------------------- schedulers
  function alivePart(s, from) {
    for (var k = 0; k < 3; k++) {
      var pt = s.parts[(from + k) % 3];
      if (pt.alive) return pt;
    }
    return null;
  }

  function schedule(e, dt, L) {
    var s = e.s, P = L.player, p0 = s.parts[0];
    s.ct += dt;
    if (s.phase === 0) {
      if (!(s.ev & 1) && s.ct >= 0.9) { s.ev |= 1; var c0 = Math.floor(p0.x / T); waveFrom(e, L, c0, 1, 10); waveFrom(e, L, c0 - 1, -1, 10); waveSound(e, L, p0.x); }
      if (!(s.ev & 2) && s.ct >= 2.5) { s.ev |= 2; fanFrom(e, L, p0, -1, 5, 0.3, 6.5, false, 0.75); }
      if (!(s.ev & 4) && s.ct >= 4.4 && p0.st === 'hover') { s.ev |= 4; kneel(e, L, p0); }
      if ((s.ev & 4) && p0.st === 'hover' && s.ct > 5.2) { s.ct = 0; s.ev = 0; }
    } else if (s.phase === 1) {
      if (s.kneelI < 0) {
        s.kneelT -= dt;
        if (s.kneelT <= 0) {
          // the copy nearest the player (horizontally) comes down first
          var best = null, bd = 1e9, px = alive(P) ? P.x + P.w / 2 : s.cx;
          for (var i = 0; i < 3; i++) {
            var pt = s.parts[i];
            if (!pt.alive || pt.st !== 'hover') continue;
            var d = Math.abs(pt.x - px);
            if (d < bd) { bd = d; best = pt; }
          }
          if (best) kneel(e, L, best);
        }
      }
      s.shotT -= dt;
      if (s.shotT <= 0) {
        s.shotT = 2.3;
        for (var k = 0; k < 3; k++) {
          var q = s.parts[(s.rr + k) % 3];
          if (q.alive && q.st === 'hover' && q.i !== s.kneelI) { fanFrom(e, L, q, -1, 3, 0.24, 6.5, false, 0.65); s.rr = (q.i + 1) % 3; break; }
        }
      }
      s.wallT -= dt;
      if (s.wallT <= 0) { s.wallT = 10; wallsGrow(e, L, 4); }
    } else if (s.phase === 2) {
      if (!(s.ev & 1) && s.ct >= 0.6) {
        s.ev |= 1;
        waveFrom(e, L, 1, 1, 9, 0.6, 0.5);
        waveFrom(e, L, L.w - 2, -1, 9, 0.6, 0.5);
        waveSound(e, L, s.cx);
      }
      if (!(s.ev & 2) && s.ct >= 1.7 && p0.st === 'hover') {
        s.ev |= 2;
        fanFrom(e, L, p0, 0, 3, 0.26, 6, true, 0.75);
        fanFrom(e, L, p0, 1, 3, 0.26, 6, true, 0.75);
        fanFrom(e, L, p0, 2, 3, 0.26, 6, true, 0.75);
      }
      if (!(s.ev & 8) && s.ct >= 3.0) { s.ev |= 8; wallsGrow(e, L, 3.4); }
      if (!(s.ev & 4) && s.ct >= 4.0 && p0.st === 'hover') { s.ev |= 4; kneel(e, L, p0); }
      if ((s.ev & 4) && p0.st === 'hover' && s.ct > 4.8) { s.ct = 0; s.ev = 0; p0.spin = 0.55; }
    }
    // phase 3 is driven by the part itself (darts, then the stall)
  }

  // ---------------------------------------------------------------- contacts (hazard and dash hits)
  function contacts(e, L, P) {
    var s = e.s;
    var pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
    for (var i = 0; i < 3; i++) {
      var part = s.parts[i];
      if (!part.alive) continue;
      if (part.st === 'open' && part.open > 0.35) {
        if (P.state === 'dash' && part.dash !== P.dashId && coreReach(part, P, s.phase)) {
          part.dash = P.dashId;
          hit(e, L, part, false);
          if (s.state !== 'fight') return;
        }
        continue;
      }
      if (part.armed && partHazState(part.st) && hitsTri(part, pcx, pcy, 9)) {
        if (L.killPlayer('w4.recursion')) return;
      }
    }
  }

  // ---------------------------------------------------------------- hooks
  function init(e, spec, L) {
    var s = e.s;
    arena(e, L);
    s.parts = [newPart(0), newPart(1), newPart(2)];
    s.fans = [newFan(), newFan(), newFan()];
    s.waves = [newWave(), newWave(), newWave(), newWave()];
    s.walls = [newWall(), newWall(), newWall(), newWall()];
    s.state = 'dormant';
    s.phase = 0;
    s.hp = HP[0];
    s.next = 0;
    s.t = 0;
    s.ct = 0;
    s.ev = 0;
    s.time = 0;
    s.tdur = 0;
    s.kneelI = -1;
    s.kneelT = 0;
    s.shotT = 0;
    s.wallT = 0;
    s.rr = 0;
    s.splitFrom = null;
    s.collX = 0;
    s.collY = 0;
    s.deathX = 0;
    s.deathY = 0;
    s.snap = L.snapshotTiles();
    e.collidable = false;
    setPart(s.parts[0], SIDE[0], GD[0], s.cx, s.hoverY - T);
    s.parts[0].alive = false;
  }

  function update(e, dt, L) {
    var s = e.s;
    s.time += dt;
    stepWalls(e, dt, L);
    stepWaves(e, dt, L);
    stepFans(e, dt, L);
    switch (s.state) {
      case 'dormant':
        if (L.playerMoved || L.bossInfo) { if (!L.bossInfo) L.bossStart(e); beginIntro(e, L); }
        break;
      case 'intro':
        s.t += dt;
        s.parts[0].scale = Math.min(1, 0.2 + 0.8 * smooth(s.t / 1.3));
        s.parts[0].y = lerp(s.hoverY - T, s.hoverY, smooth(s.t / 1.5));
        if (s.t >= 1.6) beginPhase(e, L, 0, false);
        break;
      case 'fight':
        if (L.phase === 'play') schedule(e, dt, L);
        break;
      case 'split':
      case 'assemble':
      case 'collapse':
        s.t += dt;
        if (s.state === 'assemble') {
          for (var g = 0; g < 3; g++) { var gp = s.parts[g]; if (gp.ghost) { gp.gx = s.cx; gp.gy = s.hoverY; } }
        }
        if (s.t >= s.tdur) beginPhase(e, L, s.next, false);
        break;
      case 'dying':
        s.t += dt;
        if (s.t >= 2.6) { s.state = 'dead'; }
        break;
      default:
        break;
    }
    for (var i = 0; i < 3; i++) stepPart(e, s.parts[i], dt, L);
    // the reborn whole grows back to full size
    if (s.state === 'fight' && s.phase === 2 && s.parts[0].scale < 1) s.parts[0].scale = Math.min(1, s.parts[0].scale + dt * 1.6);
    var P = L.player;
    if (s.state === 'fight' && L.phase === 'play' && alive(P)) contacts(e, L, P);
    // the controller box follows the focus copy (the engine aims boss FX at it)
    var f = s.kneelI >= 0 ? s.parts[s.kneelI] : alivePart(s, 0);
    if (f) { e.x = f.x - e.w / 2; e.y = f.y - e.h / 2; }
  }

  function onPlayerDeath(e, L) {
    var s = e.s;
    L.clearMinions();
    for (var i = 0; i < s.waves.length; i++) s.waves[i].on = false;
    for (var j = 0; j < s.fans.length; j++) s.fans[j].on = false;
    for (var k = 0; k < 3; k++) s.parts[k].charge = 0;
  }

  function onRespawn(e, L) {
    var s = e.s;
    if (s.state === 'dying' || s.state === 'dead' || s.state === 'dormant') return;
    if (s.state === 'intro') { beginPhase(e, L, 0, true); return; }
    var ph = (s.state === 'split' || s.state === 'assemble' || s.state === 'collapse') ? s.next : s.phase;
    clearArena(e, L);
    L.restoreTiles(s.snap);
    beginPhase(e, L, ph, true);
    for (var i = 0; i < 3; i++) s.parts[i].armed = false;
  }

  function debugDamage(e, L) {
    var s = e.s;
    if (s.state === 'dying' || s.state === 'dead' || L.bossDone) return;
    ensureFight(e, L);
    var part = s.kneelI >= 0 && s.parts[s.kneelI].alive ? s.parts[s.kneelI] : alivePart(s, 0);
    if (!part) return;
    // force the window open on this copy, then strike it
    part.st = 'open';
    part.t = 0;
    part.open = 1;
    part.ky = part.y;
    part.kx = part.x;
    hit(e, L, part, true);
  }

  function onRemove(e, L) { if (e.s && e.s.walls) clearArena(e, L); }

  // ---------------------------------------------------------------- rendering
  var SPK = new Float32Array(2);
  function drawPart(ctx, L, s, part, p, sh, alpha) {
    var side = part.side * part.scale;
    if (side < 2) return;
    var cr = Math.cos(part.rot), sr = Math.sin(part.rot);
    var cx = part.x, cy = part.y;
    var open = part.open, armed = part.armed && partHazState(part.st);
    var pb = beatPulse();
    var g = gasket(part.gd);
    ctx.globalAlpha = alpha;
    // solid sub-triangles of the gasket (the holes show the garden behind)
    ctx.beginPath();
    for (var i = 0; i < g.length; i += 6) {
      for (var q = 0; q < 3; q++) {
        var ux = g[i + q * 2] * side, uy = g[i + q * 2 + 1] * side;
        var wx = cx + ux * cr - uy * sr, wy = cy + ux * sr + uy * cr;
        if (q === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.closePath();
    }
    ctx.fillStyle = rgba(open > 0.05 ? sh.deepH : sh.bodyH, 0.9);
    ctx.fill();
    ctx.strokeStyle = rgba(p.hazard, armed ? 0.75 : 0.4);
    ctx.lineWidth = side > 100 ? 1.2 : 1;
    ctx.lineJoin = 'miter';
    ctx.stroke();
    // outer silhouette with Koch-like spikes along each edge (they retract while the core is open)
    triVerts(part);
    var spike = (armed ? 1 : 0.35) * (1 - open) * (side > 100 ? 9 : side > 70 ? 7 : 5) * (1 + 0.15 * pb);
    if (spike > 0.6) {
      var n = Math.max(3, Math.round(side / 26));
      ctx.beginPath();
      for (var k = 0; k < 3; k++) {
        var ax = TRI[k * 2], ay = TRI[k * 2 + 1], bx = TRI[((k + 1) % 3) * 2], by = TRI[((k + 1) % 3) * 2 + 1];
        var ex = bx - ax, ey = by - ay, el = Math.sqrt(ex * ex + ey * ey) || 1;
        var nx = ey / el, ny = -ex / el;
        // outward normal: away from the centroid
        if ((ax + ex * 0.5 - cx) * nx + (ay + ey * 0.5 - cy) * ny < 0) { nx = -nx; ny = -ny; }
        for (var j = 0; j < n; j++) {
          var t0 = (j + 0.18) / n, t1 = (j + 0.5) / n, t2 = (j + 0.82) / n;
          var hgt = spike * ((j & 1) ? 0.65 : 1);
          ctx.moveTo(ax + ex * t0, ay + ey * t0);
          ctx.lineTo(ax + ex * t1 + nx * hgt, ay + ey * t1 + ny * hgt);
          ctx.lineTo(ax + ex * t2, ay + ey * t2);
        }
      }
      ctx.fillStyle = p.hazard;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(TRI[0], TRI[1]); ctx.lineTo(TRI[2], TRI[3]); ctx.lineTo(TRI[4], TRI[5]);
    ctx.closePath();
    ctx.strokeStyle = armed ? p.hazard : rgba(p.hazard, 0.55 + 0.45 * (1 - open));
    ctx.lineWidth = side > 100 ? 3 : 2.5;
    ctx.stroke();
    // the core: the empty central triangle
    var ch = side * 0.5;
    var c0x = -0.25 * ch * 2, c0y = -H3 / 6 * side;
    ctx.beginPath();
    var mx1 = cx + c0x * cr - c0y * sr, my1 = cy + c0x * sr + c0y * cr;
    var mx2 = cx + (-c0x) * cr - c0y * sr, my2 = cy + (-c0x) * sr + c0y * cr;
    var m3y = H3 / 3 * side;
    var mx3 = cx - m3y * sr, my3 = cy + m3y * cr;
    ctx.moveTo(mx1, my1); ctx.lineTo(mx2, my2); ctx.lineTo(mx3, my3);
    ctx.closePath();
    var coreR = CORE[s.phase] * part.scale;
    if (open > 0.02) {
      ctx.fillStyle = rgba(p.accent, (0.25 + 0.25 * pb) * open);
      ctx.fill();
      ctx.strokeStyle = rgba(p.accent, 0.9 * open);
      ctx.lineWidth = 2;
      ctx.stroke();
      AP.R.glow(ctx, cx, cy, Math.min(48, coreR + 10), p.accent, 0.55 * open + 0.25 * pb * open);
      // the reach ring (where a dash connects) pulses on the beat
      ctx.strokeStyle = rgba(p.accent, 0.35 * open);
      ctx.lineWidth = 1.5;
      AP.R.poly(ctx, cx, cy, coreR * (0.92 + 0.08 * pb), 6, part.rot + s.time * 0.8);
      ctx.stroke();
    }
    // the eye
    var er = Math.max(3, side * 0.055) * (1 + 0.5 * open);
    AP.R.poly(ctx, cx, cy, er, 6, part.rot + Math.PI / 6);
    ctx.fillStyle = open > 0.02 ? p.accent : rgba(p.ink, 0.25 + 0.5 * part.charge);
    ctx.fill();
    ctx.strokeStyle = open > 0.02 ? p.ink : rgba(p.ink, 0.6);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (open > 0.02 || part.charge > 0.05) {
      ctx.fillStyle = p.bg;
      ctx.beginPath();
      ctx.arc(cx, cy, er * 0.38, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = rgba(p.ink, 0.7);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - er * 0.7, cy); ctx.lineTo(cx + er * 0.7, cy);
      ctx.stroke();
    }
    // seed charge: an accent ring converging on the eye
    if (part.charge > 0.02) {
      ctx.strokeStyle = rgba(p.hazard, 0.3 + 0.6 * part.charge);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, er + 4 + (1 - part.charge) * 26, 0, TAU);
      ctx.stroke();
      AP.R.glow(ctx, cx, cy, 14 + 12 * part.charge, p.hazard, 0.4 * part.charge);
    }
    if (part.hurt > 0.02) {
      ctx.globalAlpha = alpha * part.hurt * 0.8;
      ctx.beginPath();
      ctx.moveTo(TRI[0], TRI[1]); ctx.lineTo(TRI[2], TRI[3]); ctx.lineTo(TRI[4], TRI[5]);
      ctx.closePath();
      ctx.fillStyle = p.ink;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShadow(ctx, s, part, p, sh) {
    var k = smooth(part.t / KNEEL_TELE);
    var half = part.side * 0.5;
    var x = part.kx, y = s.floorY;
    var a = 0.35 + 0.55 * k;
    ctx.strokeStyle = rgba(p.accent, a);
    ctx.lineWidth = 2;
    ctx.setLineDash(DASHES);
    ctx.lineDashOffset = -s.time * 30;
    ctx.beginPath();
    ctx.moveTo(x - half * (0.6 + 0.4 * k), y - 2);
    ctx.lineTo(x + half * (0.6 + 0.4 * k), y - 2);
    ctx.stroke();
    ctx.setLineDash(NODASH);
    ctx.lineDashOffset = 0;
    // a hollow footprint of the copy (accent) and chevrons pointing down at it
    var R = part.side / SQ3;
    var ky = part.ky;
    ctx.beginPath();
    ctx.moveTo(x, ky - R); ctx.lineTo(x + half, ky + R * 0.5); ctx.lineTo(x - half, ky + R * 0.5);
    ctx.closePath();
    ctx.strokeStyle = rgba(p.accent, 0.12 + 0.3 * k);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = rgba(p.accent, a);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var c = 0; c < 3; c++) {
      var cy = ky - R - 14 - c * 9 + ((s.time * 40) % 9);
      ctx.moveTo(x - 7, cy - 5); ctx.lineTo(x, cy); ctx.lineTo(x + 7, cy - 5);
    }
    ctx.stroke();
    AP.R.glow(ctx, x, y - 4, Math.min(48, 18 + half * 0.2), p.accent, 0.25 + 0.35 * k);
  }

  function render(e, ctx, L) {
    var s = e.s, p = palOf(L), sh = shades(p), i;
    var pb = beatPulse();
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    // the memory of the whole: a faint gasket where it began (phase 1) or a slowly iterating axiom (dormant)
    if (s.state === 'dormant') {
      var lv = Math.floor(s.time * 0.8) % 4;
      if (AP.Art && AP.Art.sierpinski) AP.Art.sierpinski(ctx, s.cx, s.hoverY - T, SIDE[0], lv, sh.lightH, 0.35 + 0.15 * pb);
      ctx.strokeStyle = rgba(p.ink, 0.4);
      ctx.lineWidth = 1.5;
      AP.R.poly(ctx, s.cx, s.hoverY - T, 7, 6, s.time * 0.5);
      ctx.stroke();
      return;
    }
    if (s.phase === 1 && s.state === 'fight' && AP.Art && AP.Art.sierpinski) {
      AP.Art.sierpinski(ctx, s.cx, s.hoverY, SIDE[0], 1, sh.ghost, 0.18);
      // threads from the memory to each living copy
      ctx.strokeStyle = rgba(p.ink, 0.08 + 0.05 * pb);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = 0; i < 3; i++) {
        var tp = s.parts[i];
        if (!tp.alive) continue;
        ctx.moveTo(s.cx + CORNER[i * 2] * SIDE[0], s.hoverY + CORNER[i * 2 + 1] * SIDE[0]);
        ctx.lineTo(tp.x, tp.y);
      }
      ctx.stroke();
    }
    // vine wall telegraphs: a sprouting stem climbs the column before the bark appears
    for (i = 0; i < s.walls.length; i++) {
      var wl = s.walls[i];
      if (!wl.on || wl.st !== 0) continue;
      var k = smooth(wl.t / 0.85);
      var x = wl.col * T + 16, y0 = s.floorY, y1 = lerp(y0, wl.top * T, k);
      ctx.strokeStyle = rgba(p.primary, 0.5 + 0.4 * k);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y0);
      for (var yy = y0; yy >= y1; yy -= 8) ctx.lineTo(x + Math.sin(yy * 0.09 + s.time * 6) * 5, yy);
      ctx.stroke();
      ctx.fillStyle = p.accent;
      AP.R.poly(ctx, x + Math.sin(y1 * 0.09 + s.time * 6) * 5, y1, 4 + 2 * pb, 6, s.time * 3);
      ctx.fill();
      ctx.strokeStyle = rgba(p.primary, 0.2 * k);
      ctx.lineWidth = 1;
      ctx.strokeRect(wl.col * T + 2, wl.top * T + 2, T - 4, (wl.bottom - wl.top + 1) * T - 4);
      ctx.lineCap = 'butt';
    }
    // seed fan telegraphs: dotted aim lines
    for (i = 0; i < s.fans.length; i++) {
      var f = s.fans[i];
      if (!f.on) continue;
      var kf = clamp01(f.t / f.tele);
      ctx.strokeStyle = rgba(p.hazard, 0.18 + 0.5 * kf);
      ctx.lineWidth = 1.5;
      ctx.setLineDash(DOTS);
      ctx.beginPath();
      var len = 90 + 170 * kf;
      for (var n = 0; n < f.n; n++) {
        var a = f.ang + (n - (f.n - 1) / 2) * f.spread;
        ctx.moveTo(f.ox + Math.cos(a) * 14, f.oy + Math.sin(a) * 14);
        ctx.lineTo(f.ox + Math.cos(a) * len, f.oy + Math.sin(a) * len);
      }
      ctx.stroke();
      ctx.setLineDash(NODASH);
    }
    // parts: ghosts, then the living (kneel shadows and dart lines first)
    for (i = 0; i < 3; i++) {
      var g = s.parts[i];
      if (!g.ghost || g.fade >= 1) continue;
      ctx.globalAlpha = 0.5 * (1 - g.fade);
      ctx.strokeStyle = sh.ghost;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(DOTS);
      triVerts(g);
      ctx.beginPath();
      ctx.moveTo(TRI[0], TRI[1]); ctx.lineTo(TRI[2], TRI[3]); ctx.lineTo(TRI[4], TRI[5]);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash(NODASH);
      ctx.globalAlpha = 1;
    }
    for (i = 0; i < 3; i++) {
      var pt = s.parts[i];
      if (!pt.alive) continue;
      if (pt.st === 'aim') drawShadow(ctx, s, pt, p, sh);
      if (pt.st === 'dartAim') {
        var kd = clamp01(pt.t / 0.5);
        ctx.strokeStyle = rgba(p.hazard, 0.25 + 0.6 * kd);
        ctx.lineWidth = 2;
        ctx.setLineDash(DASHES);
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.tx, pt.ty);
        ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.strokeStyle = rgba(p.hazard, 0.4 + 0.5 * kd);
        AP.R.poly(ctx, pt.tx, pt.ty, 10 + 8 * (1 - kd), 3, -Math.PI / 2 + s.time * 4);
        ctx.stroke();
      }
      var al = 1;
      if (!pt.armed && partHazState(pt.st) && s.state === 'fight') al = 0.55 + 0.45 * Math.abs(Math.sin(s.time * 18));
      if (s.state === 'intro') al = 0.4 + 0.6 * smooth(s.t / 1.3);
      drawPart(ctx, L, s, pt, p, sh, al);
    }
    // transitions
    if (s.state === 'split' && s.splitFrom) {
      var ks = clamp01(s.t / Math.max(0.05, s.tdur));
      AP.R.glow(ctx, s.splitFrom.x, s.splitFrom.y, 48, p.ink, 0.8 * (1 - ks));
    } else if (s.state === 'assemble') {
      var kq = clamp01(s.t / Math.max(0.05, s.tdur));
      if (AP.Art && AP.Art.sierpinski) AP.Art.sierpinski(ctx, s.cx, s.hoverY, SIDE[0] * (0.3 + 0.7 * smooth(kq)), Math.min(3, Math.floor(kq * 4)), p.hazard, 0.3 + 0.6 * kq);
      AP.R.glow(ctx, s.cx, s.hoverY, 40, p.accent, 0.5 * kq);
    } else if (s.state === 'collapse') {
      var kc = clamp01(s.t / Math.max(0.05, s.tdur));
      var sz = lerp(SIDE[2], SIDE[3], easeIn(kc));
      if (AP.Art && AP.Art.sierpinski) AP.Art.sierpinski(ctx, lerp(s.collX, s.cx, kc), lerp(s.collY, s.hoverY + T, kc), sz, 3 - Math.floor(kc * 2.99), p.hazard, 0.9);
      AP.R.glow(ctx, lerp(s.collX, s.cx, kc), lerp(s.collY, s.hoverY + T, kc), 30 + 18 * kc, p.hazard, 0.5);
    } else if (s.state === 'dying') {
      var kz = clamp01(s.t / 2.6);
      if (AP.Art && AP.Art.sierpinski) {
        AP.Art.sierpinski(ctx, s.deathX, s.deathY, 60 + 520 * easeOut(kz), Math.min(5, 1 + Math.floor(kz * 5)), p.accent, 0.8 * (1 - kz));
        AP.Art.sierpinski(ctx, s.deathX, s.deathY, 30 + 260 * easeOut(kz), Math.min(4, 1 + Math.floor(kz * 4)), p.ink, 0.6 * (1 - kz));
      }
      AP.R.glow(ctx, s.deathX, s.deathY, 48, p.ink, 0.9 * (1 - kz));
    }
  }
  var DOTS = [3, 6];
  var DASHES = [8, 6];
  var NODASH = [];

  AP.Entities.register('w4.recursion', {
    kind: 'sensor', boss: true, bossName: NAME, phases: HP.length,
    anchor: 'center', w: 64, h: 64, layer: 6, lint: 'ignore', alwaysRender: true, renderPad: 480,
    init: init,
    update: update,
    render: render,
    onPlayerDeath: onPlayerDeath,
    onRespawn: onRespawn,
    debugDamage: debugDamage,
    onRemove: onRemove
  });
})(window.AP = window.AP || {});
