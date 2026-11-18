/* js/worlds/w2/entities.js — owner: W2 */
(function (AP) {
  'use strict';

  // World 2, Voronoi Caverns (the Square). Required types (CONTRACT §5): w2.mite, w2.turret, w2.bolt, w2.geode.
  // Extra types: w2.stalactite (a hanging crystal spike that drops when the player passes beneath; the Crystal
  // Monarch's shard fall reuses it) and w2.cluster (crystal-prism decoration, no gameplay). The Square cannot dash,
  // so '+' crystal breaks only through turret bolts and geodes (L.breakTile). Everything draws from L.pal (the w2
  // palette in W2 levels, any style in Endless).
  var C = AP.C;
  var M = AP.M;
  var T = AP.TILE;
  var TAU = Math.PI * 2;
  var HALF_PI = Math.PI / 2;
  var E = AP.Entities;

  var DIRV = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  var DASH = [5, 6];
  var DOTS = [2, 5];
  var NODASH = [];
  var rayOut = { hit: false, x: 0, y: 0, dist: 0, tx: -1, ty: -1, other: null };

  function pal(L) { return (L && L.pal) || AP.Worlds.pal('w2'); }
  function fxPal() { return (AP.level && AP.level.pal) || AP.Worlds.pal('w2'); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; var q = 1 - ph; return q * q * q; }
  // interpolation factor used by LevelScene for e.rx (forced to 1 during hitstop / pause / covered)
  function alphaOf(L) { return (L.hitstopT > 0 || L.covered || L.paused) ? 1 : AP.Time.alpha; }
  function hash01(a, b, c) { return AP.hash2(a | 0, b | 0, c | 0) / 4294967296; }
  function mod32(v) { var r = v % 32; return r < 0 ? r + 32 : r; }
  function onScreen(L, x, y, pad) { return !L.cam || L.cam.visible(x - 1, y - 1, 2, 2, pad === undefined ? 64 : pad); }

  // ================================================================== FX presets (w2.*)
  var FO = { n: 8, color: null, color2: null, speed: null, angle: null, life: null, size: null, sizeEnd: undefined,
    gravity: 0, drag: 0, shape: 'dot', spin: null, additive: true, back: false, spread: 0, rot: undefined, width: 2, align: false };
  function fo() {
    FO.n = 8; FO.color = null; FO.color2 = null; FO.speed = null; FO.angle = null; FO.life = null; FO.size = null;
    FO.sizeEnd = undefined; FO.gravity = 0; FO.drag = 0; FO.shape = 'dot'; FO.spin = null; FO.additive = true;
    FO.back = false; FO.spread = 0; FO.rot = undefined; FO.width = 2; FO.align = false;
    return FO;
  }
  var R_SH1 = [80, 260], R_SH2 = [0.45, 0.85], R_SH3 = [2.5, 6], R_SPIN = [-9, 9], R_SH4 = [40, 160], R_SH5 = [0.3, 0.6];
  var R_SP1 = [90, 240], R_SP2 = [0.12, 0.28], R_SP3 = [3, 7];
  var R_GE1 = [120, 380], R_GE2 = [0.5, 1.0], R_GE3 = [3, 7], R_GE4 = [60, 200], R_GE5 = [0.4, 0.8], R_GE6 = [2, 4];
  var R_GL1 = [30, 110], R_GL2 = [0.25, 0.5], R_GL3 = [1.5, 3];
  var R_MU1 = [160, 320], R_MU2 = [0.08, 0.18], R_MU3 = [4, 9];
  var R_DU1 = [15, 60], R_DU2 = [0.3, 0.6], R_DU3 = [1.5, 3.2];
  var R_MI1 = [70, 230], R_MI2 = [0.35, 0.7], R_MI3 = [2, 4.5];
  var angBuf = [0, 0];

  // crystal fragments (geode, Voronoi walls, Monarch plates): o.color, o.n, o.dir
  AP.FX.preset('w2.shatter', function (x, y, o) {
    var P = fxPal(), e = fo();
    e.n = o.n || 12; e.color = o.color || P.primary; e.color2 = P.accent; e.speed = R_SH1; e.life = R_SH2; e.size = R_SH3;
    e.sizeEnd = 0.5; e.shape = 'tri'; e.gravity = 700; e.spin = R_SPIN; e.drag = 0.8; e.spread = o.spread || 10;
    if (typeof o.dir === 'number') { angBuf[0] = o.dir - 0.8; angBuf[1] = o.dir + 0.8; e.angle = angBuf; }
    var c = AP.FX.emit(x, y, e);
    e = fo();
    e.n = Math.max(2, Math.round((o.n || 12) / 3)); e.color = P.accent; e.color2 = P.ink; e.speed = R_SH4; e.life = R_SH5;
    e.size = R_GL3; e.shape = 'star'; e.spin = R_SPIN; e.drag = 2; e.spread = 6;
    return c + AP.FX.emit(x, y, e);
  });

  // bolt impact sparks: o.dir = travel direction (sparks fly back out of the surface)
  AP.FX.preset('w2.spark', function (x, y, o) {
    var P = fxPal(), e = fo();
    e.n = o.n || 7; e.color = o.color || P.hazard; e.color2 = P.ink; e.speed = R_SP1; e.life = R_SP2; e.size = R_SP3;
    e.shape = 'line'; e.align = true; e.drag = 5; e.width = 1.6;
    if (typeof o.dir === 'number') { angBuf[0] = o.dir + Math.PI - 1.1; angBuf[1] = o.dir + Math.PI + 1.1; e.angle = angBuf; }
    var c = AP.FX.emit(x, y, e);
    AP.FX.ring(x, y, 2, 16, 0.16, o.color || P.hazard, 1.5);
    return c + 1;
  });

  // charge motes converging on (x, y): o.radius, o.color, o.n
  AP.FX.preset('w2.charge', function (x, y, o) {
    var P = fxPal();
    var col = o.color || P.accent;
    var r = o.radius || 26;
    var q = (AP.R && AP.R.quality) ? AP.R.quality.particles : 1;
    var n = Math.max(1, Math.round((o.n || 6) * q));
    var F = AP.FX;
    if (typeof F.spawnRaw !== 'function' || typeof F.rampId !== 'function') {
      var e = fo();
      e.n = n; e.color = col; e.color2 = P.ink; e.speed = R_GL1; e.life = R_GL2; e.size = R_GL3; e.drag = 3; e.spread = r * 0.5;
      return F.emit(x, y, e);
    }
    var rid = F.rampId(col, P.ink);
    var a0 = (o.phase || 0);
    for (var i = 0; i < n; i++) {
      var a = a0 + i * TAU / n;
      var life = 0.22 + 0.06 * (i % 3);
      var sp = r / life;
      F.spawnRaw(x + Math.cos(a) * r, y + Math.sin(a) * r, -Math.cos(a) * sp, -Math.sin(a) * sp, life,
        1.6 + (i % 2), 0.6, 0, rid, 0, 0, 0, 0, 2, 2);
    }
    return n;
  });

  // muzzle flash along o.dir
  AP.FX.preset('w2.muzzle', function (x, y, o) {
    var P = fxPal(), e = fo();
    var d = typeof o.dir === 'number' ? o.dir : 0;
    e.n = o.n || 6; e.color = P.ink; e.color2 = o.color || P.hazard; e.speed = R_MU1; e.life = R_MU2; e.size = R_MU3;
    angBuf[0] = d - 0.35; angBuf[1] = d + 0.35; e.angle = angBuf; e.shape = 'line'; e.align = true; e.drag = 6; e.width = 1.8;
    var c = AP.FX.emit(x, y, e);
    AP.FX.ring(x, y, 3, 18, 0.14, o.color || P.hazard, 2);
    return c + 1;
  });

  // a geode bursting open: rings, crystal shards, sparkles
  AP.FX.preset('w2.geode', function (x, y, o) {
    var P = fxPal(), e = fo();
    AP.FX.ring(x, y, 8, 30 + 40 * (o.radius || 2), 0.5, P.accent, 3);
    AP.FX.ring(x, y, 4, 48, 0.32, P.ink, 1.5);
    e.n = o.n || 22; e.color = P.accent; e.color2 = P.primary; e.speed = R_GE1; e.life = R_GE2; e.size = R_GE3;
    e.sizeEnd = 1; e.shape = 'tri'; e.gravity = 650; e.spin = R_SPIN; e.drag = 0.6; e.spread = 8;
    var c = AP.FX.emit(x, y, e);
    e = fo();
    e.n = 12; e.color = P.ink; e.color2 = P.accent; e.speed = R_GE4; e.life = R_GE5; e.size = R_GE6; e.shape = 'star';
    e.spin = R_SPIN; e.drag = 2;
    return 2 + c + AP.FX.emit(x, y, e);
  });

  // small sparkle (soft geode taps, crystal glints)
  AP.FX.preset('w2.glint', function (x, y, o) {
    var P = fxPal(), e = fo();
    e.n = o.n || 5; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = R_GL1; e.life = R_GL2; e.size = R_GL3;
    e.shape = 'star'; e.spin = R_SPIN; e.drag = 3; e.spread = 6;
    return AP.FX.emit(x, y, e);
  });

  // soft crystal dust (not additive)
  AP.FX.preset('w2.dust', function (x, y, o) {
    var P = fxPal(), e = fo();
    e.n = o.n || 5; e.color = o.color || AP.Color.mix(P.primary, P.ink, 0.3); e.color2 = P.bg; e.speed = R_DU1; e.life = R_DU2;
    e.size = R_DU3; e.drag = 3; e.gravity = typeof o.gravity === 'number' ? o.gravity : 60; e.additive = false; e.spread = o.spread || 6;
    if (typeof o.dir === 'number') { angBuf[0] = o.dir - 0.6; angBuf[1] = o.dir + 0.6; e.angle = angBuf; }
    return AP.FX.emit(x, y, e);
  });

  // a mite crushed or popped: hexagon bits and leg splinters
  AP.FX.preset('w2.mite', function (x, y, o) {
    var P = fxPal(), e = fo();
    e.n = o.n || 8; e.color = P.hazard; e.color2 = P.ink; e.speed = R_MI1; e.life = R_MI2; e.size = R_MI3; e.shape = 'hex';
    e.spin = R_SPIN; e.gravity = 500; e.drag = 1;
    var c = AP.FX.emit(x, y, e);
    e = fo();
    e.n = 6; e.color = P.hazard; e.color2 = P.bg; e.speed = R_SP1; e.life = R_SP2; e.size = R_SP3; e.shape = 'line'; e.align = true;
    e.drag = 4; e.width = 1.4;
    AP.FX.ring(x, y, 3, 22, 0.2, P.hazard, 1.5);
    return 1 + c + AP.FX.emit(x, y, e);
  });

  // ================================================================== shared tile helpers
  // crystal-mite ground: SOLID and BREAK, and FAKE (mites never betray a secret wall)
  function cellSolid(L, tx, ty) {
    var c = L.tileAt(tx, ty);
    return c === T.SOLID || c === T.BREAK || c === T.FAKE;
  }
  function solidAtPoint(L, x, y) { return cellSolid(L, Math.floor(x / 32), Math.floor(y / 32)); }

  // ================================================================== w2.mite
  // Crawls around the boundary of the solid tiles keeping the surface on one side: 'cw' keeps it on the right
  // (moves right along a floor), 'ccw' on the left. State: the contact point B on a tile edge, heading h,
  // surface normal n; the body centre sits R above B along n. Concave corners turn R early (the body never
  // clips), convex corners pivot around the corner on a quarter circle. A mite whose ground breaks falls.
  var MITE_R = 10;
  var MITE_ARC = MITE_R * HALF_PI;

  function miteFrame(s, nx, ny) {
    s.nx = nx; s.ny = ny;
    if (s.spin > 0) { s.hx = -ny; s.hy = nx; } else { s.hx = ny; s.hy = -nx; }
  }
  function miteDistToVertex(bx, by, hx, hy) {
    var d;
    if (hx > 0) d = 32 - mod32(bx);
    else if (hx < 0) d = mod32(bx);
    else if (hy > 0) d = 32 - mod32(by);
    else d = mod32(by);
    return d <= 1e-6 ? 32 : d;
  }
  // 0 straight, 1 convex (surface ends), 2 concave (wall ahead)
  function miteVertexType(L, vx, vy, s) {
    if (solidAtPoint(L, vx + s.hx * 16 + s.nx * 16, vy + s.hy * 16 + s.ny * 16)) return 2;
    if (solidAtPoint(L, vx + s.hx * 16 - s.nx * 16, vy + s.hy * 16 - s.ny * 16)) return 0;
    return 1;
  }
  function miteOrient(nx, ny) { return Math.atan2(nx, -ny); }
  function mitePlace(e) {
    var s = e.s;
    if (s.arc >= 0) {
      var a = s.a0 + s.da * s.arc;
      s.cx = s.pvx + Math.cos(a) * MITE_R;
      s.cy = s.pvy + Math.sin(a) * MITE_R;
      s.ang = Math.atan2(Math.cos(a), -Math.sin(a));
    } else if (!s.fall) {
      s.cx = s.bx + s.nx * MITE_R;
      s.cy = s.by + s.ny * MITE_R;
      s.ang = miteOrient(s.nx, s.ny);
    }
    e.x = s.cx - MITE_R;
    e.y = s.cy - MITE_R;
  }
  function miteAttach(e, L, cx, cy) {
    var s = e.s;
    var tx = Math.floor(cx / 32), ty = Math.floor(cy / 32);
    var bx = cx, by = cy, nx, ny;
    if (cellSolid(L, tx, ty + 1)) { nx = 0; ny = -1; by = (ty + 1) * 32; }
    else if (cellSolid(L, tx, ty - 1)) { nx = 0; ny = 1; by = ty * 32; }
    else if (cellSolid(L, tx + 1, ty)) { nx = -1; ny = 0; bx = (tx + 1) * 32; }
    else if (cellSolid(L, tx - 1, ty)) { nx = 1; ny = 0; bx = tx * 32; }
    else return false;
    miteFrame(s, nx, ny);
    s.bx = bx; s.by = by;
    s.dn = miteDistToVertex(bx, by, s.hx, s.hy);
    s.arc = -1; s.fall = false; s.fvy = 0;
    mitePlace(e);
    return true;
  }
  function miteReset(e, L) {
    var s = e.s;
    s.cx = s.hcx; s.cy = s.hcy;
    if (!miteAttach(e, L, s.hcx, s.hcy)) { s.fall = true; s.fvy = 0; s.arc = -1; mitePlace(e); }
    s.pcx = s.cx; s.pcy = s.cy; s.pang = s.ang;
  }
  function miteSupport(L, s) {
    if (s.arc >= 0) {
      // the corner block being pivoted around
      return solidAtPoint(L, s.pvx - s.ohx * 16 - s.onx * 16, s.pvy - s.ohy * 16 - s.ony * 16);
    }
    // the edge segment ends at V = B + h·dn and spans one tile edge [V - 32h, V]: probe the centre of the
    // supporting tile (V - 16h - 16n), which is robust to B sitting exactly on a vertex
    var k = s.dn - 16;
    return solidAtPoint(L, s.bx + s.hx * k - s.nx * 16, s.by + s.hy * k - s.ny * 16);
  }
  function miteStep(e, L, dist) {
    var s = e.s, rem = dist, guard = 0;
    while (rem > 1e-6 && guard++ < 10) {
      if (s.arc >= 0) {
        var da = rem / MITE_ARC;
        if (s.arc + da >= 1) {
          rem -= (1 - s.arc) * MITE_ARC;
          // finish the convex pivot: h = -n_old, n = h_old
          var hx = s.hx, hy = s.hy;
          s.hx = -s.nx; s.hy = -s.ny; s.nx = hx; s.ny = hy;
          s.bx = s.pvx; s.by = s.pvy; s.dn = 32; s.arc = -1;
        } else { s.arc += da; rem = 0; }
        continue;
      }
      var vx = s.bx + s.hx * s.dn, vy = s.by + s.hy * s.dn;
      var vt = miteVertexType(L, vx, vy, s);
      if (vt === 2) {
        var tp = s.dn - MITE_R;
        if (tp <= rem + 1e-7) {
          if (tp > 0) rem -= tp;
          // concave turn: B' = V + R·n_old, h = n_old, n = -h_old
          var ohx = s.hx, ohy = s.hy;
          s.bx = vx + s.nx * MITE_R; s.by = vy + s.ny * MITE_R;
          s.hx = s.nx; s.hy = s.ny; s.nx = -ohx; s.ny = -ohy;
          s.dn = 32 - MITE_R;
        } else { s.bx += s.hx * rem; s.by += s.hy * rem; s.dn -= rem; rem = 0; }
      } else if (vt === 1) {
        if (s.dn <= rem + 1e-7) {
          rem = Math.max(0, rem - s.dn);
          s.bx = vx; s.by = vy;
          s.pvx = vx; s.pvy = vy;
          s.ohx = s.hx; s.ohy = s.hy; s.onx = s.nx; s.ony = s.ny;
          s.a0 = Math.atan2(s.ny, s.nx);
          // pivot from n_old toward h_old (a quarter turn)
          s.da = M.angleDiff(s.a0, Math.atan2(s.hy, s.hx));
          s.arc = 0;
        } else { s.bx += s.hx * rem; s.by += s.hy * rem; s.dn -= rem; rem = 0; }
      } else {
        if (s.dn <= rem + 1e-7) { rem = Math.max(0, rem - s.dn); s.bx = vx; s.by = vy; s.dn = 32; }
        else { s.bx += s.hx * rem; s.by += s.hy * rem; s.dn -= rem; rem = 0; }
      }
    }
  }

  E.register('w2.mite', {
    kind: 'actor', w: 20, h: 20, anchor: 'center', layer: 5, lint: 'ignore', renderPad: 48,
    hazard: true, dashable: true, burstable: true,
    init: function (e, spec, L) {
      var s = e.s;
      s.spin = spec.dir === 'ccw' || spec.dir === 'left' ? -1 : 1;
      s.speed = Math.max(0.2, num(spec.speed, 2)) * 32;
      s.hcx = e.x + e.w / 2;
      s.hcy = e.y + e.h / 2;
      s.gait = hash01(s.hcx, s.hcy, 7) * 4;
      s.pvx = 0; s.pvy = 0; s.fvy = 0; s.a0 = 0; s.da = 0; s.ohx = 0; s.ohy = 0; s.onx = 0; s.ony = 0;
      s.hx = 1; s.hy = 0; s.nx = 0; s.ny = -1; s.bx = s.hcx; s.by = s.hcy; s.dn = 32; s.arc = -1; s.fall = false;
      s.cx = s.hcx; s.cy = s.hcy; s.ang = 0;
      s.blink = 0;
      miteReset(e, L);
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.pcx = s.cx; s.pcy = s.cy; s.pang = s.ang;
      s.gait += dt * s.speed / 7;
      if (s.blink > 0) s.blink -= dt;
      // a tile closed over the body (boss geometry): crushed
      if (solidAtPoint(L, s.cx, s.cy)) {
        AP.FX.burst('w2.mite', s.cx, s.cy);
        AP.sfxAt('hit', s.cx, s.cy, { vol: 0.5, pitch: 1.4 });
        L.remove(e);
        return;
      }
      if (s.fall) {
        s.fvy = Math.min(s.fvy + C.GRAVITY * dt, C.MAX_FALL);
        var ny = s.cy + s.fvy * dt;
        var fty = Math.floor((ny + MITE_R) / 32), ftx = Math.floor(s.cx / 32);
        if (s.fvy > 0 && cellSolid(L, ftx, fty) && !cellSolid(L, ftx, Math.floor(s.cy / 32))) {
          s.cy = fty * 32 - MITE_R;
          miteFrame(s, 0, -1);
          s.bx = s.cx; s.by = fty * 32;
          s.dn = miteDistToVertex(s.bx, s.by, s.hx, s.hy);
          s.fall = false; s.fvy = 0; s.arc = -1;
          AP.FX.burst('w2.dust', s.cx, s.by, { n: 4 });
          mitePlace(e);
          return;
        }
        s.cy = ny;
        s.ang = M.lerpAngle ? M.lerpAngle(s.ang, 0, Math.min(1, dt * 6)) : s.ang * (1 - Math.min(1, dt * 6));
        e.x = s.cx - MITE_R; e.y = s.cy - MITE_R;
        if (s.cy > L.ph + 96) L.remove(e);
        return;
      }
      if (!miteSupport(L, s)) {
        // its crystal broke: drop
        s.fall = true; s.fvy = 0; s.arc = -1;
        s.blink = 0.3;
        return;
      }
      miteStep(e, L, s.speed * dt);
      mitePlace(e);
    },
    onRespawn: function (e, L) { miteReset(e, L); },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var a = alphaOf(L);
      var cx = s.pcx + (s.cx - s.pcx) * a, cy = s.pcy + (s.cy - s.pcy) * a;
      var rot = s.pang + M.angleDiff(s.pang, s.ang) * a;
      var b = beatPulse();
      AP.R.glow(ctx, cx, cy, 20, p.hazard, 0.22 + 0.12 * b);
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      var fwd = s.spin;
      // legs: three pairs, alternating gait, feet planted on the surface (local +y = toward the ground)
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (var i = 0; i < 3; i++) {
        var ph = s.gait * TAU + i * 2.1;
        var lift = s.fall ? 2 : Math.max(0, Math.sin(ph)) * 2.5;
        var sw = s.fall ? 0 : Math.cos(ph) * 2.2;
        var hx = -4 + i * 4;
        var fx = -9 + i * 9 + sw;
        ctx.moveTo(hx, 2);
        ctx.lineTo((hx + fx) * 0.5 + (fx >= hx ? 2 : -2), 3 - lift - 3);
        ctx.lineTo(fx, 10 - lift);
      }
      ctx.stroke();
      // hexagonal body with a crystal back of three spines (spiky silhouette)
      ctx.beginPath();
      ctx.moveTo(-7, -3); ctx.lineTo(-5, -10); ctx.lineTo(-3, -4);
      ctx.lineTo(0, -12 - 1.5 * b); ctx.lineTo(3, -4);
      ctx.lineTo(5, -10); ctx.lineTo(7, -3);
      ctx.closePath();
      ctx.fillStyle = rgba(p.hazard, 0.55);
      ctx.fill();
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      AP.R.poly(ctx, 0, 1, 7.5, 6, 0);
      ctx.fillStyle = rgba(p.bg, 0.85);
      ctx.fill();
      ctx.fillStyle = rgba(p.hazard, 0.35 + 0.25 * b);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.hazard;
      ctx.stroke();
      // inner facet and the eye leading the crawl
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(p.ink, 0.45);
      ctx.beginPath();
      ctx.moveTo(-3.5, 1); ctx.lineTo(0, -2.5); ctx.lineTo(3.5, 1); ctx.lineTo(0, 4.5); ctx.closePath();
      ctx.stroke();
      if (s.blink <= 0) {
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(fwd * 4.2, 0, 1.6, 0, TAU);
        ctx.fill();
      }
    }
  });

  // ================================================================== w2.bolt
  // Flies straight; breaks the first '+' it meets (L.breakTile), strikes geodes, dies on any other solid.
  // Spawned by turrets and by the Crystal Monarch (which flags its own as minions).
  var BOLT_HALF = 5;
  function boltDie(e, L, x, y, broke) {
    var s = e.s;
    AP.FX.burst('w2.spark', x, y, { dir: Math.atan2(s.dy, s.dx), n: broke ? 4 : 7 });
    if (!broke && onScreen(L, x, y, 32)) AP.sfxAt('hit', x, y, { vol: 0.22, pitch: 1.7 });
    L.remove(e);
  }

  E.register('w2.bolt', {
    kind: 'sensor', w: 10, h: 10, anchor: 'center', layer: 7, lint: 'ignore', renderPad: 64,
    hazard: true,
    init: function (e, spec, L) {
      var s = e.s;
      var dx = num(spec.dx, NaN), dy = num(spec.dy, NaN);
      if (!(isFinite(dx) && isFinite(dy)) || (dx === 0 && dy === 0)) {
        var d = DIRV[spec.dir] || DIRV.right;
        dx = d[0]; dy = d[1];
      }
      var l = Math.sqrt(dx * dx + dy * dy);
      s.dx = dx / l; s.dy = dy / l;
      s.v = Math.max(1, num(spec.speed, 8)) * 32;
      s.cx = e.x + e.w / 2; s.cy = e.y + e.h / 2;
      s.travel = 0; s.life = 0; s.owner = null;
      s.seed = hash01(e.id, 3, 11);
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.life += dt;
      var step = s.v * dt;
      s.cx += s.dx * step; s.cy += s.dy * step; s.travel += step;
      e.x = s.cx - BOLT_HALF; e.y = s.cy - BOLT_HALF;
      var hx = s.cx + s.dx * BOLT_HALF, hy = s.cy + s.dy * BOLT_HALF;
      var tx = Math.floor(hx / 32), ty = Math.floor(hy / 32);
      var code = L.tileAt(tx, ty);
      if (code === T.BREAK) { L.breakTile(tx, ty, 'bolt'); boltDie(e, L, hx, hy, true); return; }
      if (code === T.SOLID || code === T.FAKE) { boltDie(e, L, hx, hy, false); return; }
      var sol = L.solids;
      for (var i = 0; i < sol.length; i++) {
        var o = sol[i];
        if (o === s.owner || o.dead || !o.collidable || o.oneWay) continue;
        if (hx >= o.x && hx < o.x + o.w && hy >= o.y && hy < o.y + o.h) {
          if (o.type === 'w2.geode') strikeGeode(o, L, 'bolt');
          boltDie(e, L, hx, hy, false);
          return;
        }
      }
      if (s.life > 9 || s.cy > L.ph + 64 || s.cy < -64 || s.cx < -64 || s.cx > L.pw + 64) L.remove(e);
    },
    onPlayerDeath: function (e, L) {
      AP.FX.burst('w2.spark', e.s.cx, e.s.cy, { n: 3 });
      L.remove(e);
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var cx = e.rx + BOLT_HALF, cy = e.ry + BOLT_HALF;
      var dx = s.dx, dy = s.dy, nx = -dy, ny = dx;
      var tail = Math.min(s.travel, 44);
      // tapered trail
      ctx.lineCap = 'round';
      for (var k = 0; k < 3; k++) {
        var t0 = tail * k / 3, t1 = tail * (k + 1) / 3;
        ctx.globalAlpha = 0.55 * (1 - k / 3);
        ctx.strokeStyle = p.hazard;
        ctx.lineWidth = 4 - k * 1.1;
        ctx.beginPath();
        ctx.moveTo(cx - dx * t0, cy - dy * t0);
        ctx.lineTo(cx - dx * t1, cy - dy * t1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      AP.R.glow(ctx, cx, cy, 14, p.hazard, 0.6);
      // elongated diamond, pointed both ways
      var L1 = 11, L2 = 6, W = 3.6 + 0.6 * Math.sin(L.time * 30 + s.seed * 9);
      ctx.beginPath();
      ctx.moveTo(cx + dx * L1, cy + dy * L1);
      ctx.lineTo(cx + nx * W, cy + ny * W);
      ctx.lineTo(cx - dx * L2, cy - dy * L2);
      ctx.lineTo(cx - nx * W, cy - ny * W);
      ctx.closePath();
      ctx.fillStyle = rgba(p.hazard, 0.75);
      ctx.fill();
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + dx * (L1 - 3), cy + dy * (L1 - 3));
      ctx.lineTo(cx - dx * (L2 - 2), cy - dy * (L2 - 2));
      ctx.stroke();
    }
  });

  // ================================================================== w2.turret
  // A pentagon set into the wall with a barrel. On the beat grid it charges for 0.42–0.6 s (accent glow, converging
  // motes and a dashed sight line of the locked direction), then fires a w2.bolt. aim:'player' tracks the player
  // inside a ±77° cone around its facing and locks the aim when the charge starts. rate = shots per second.
  var TUR_CONE = 1.35;
  var CHG = { n: 4, radius: 24, phase: 0 };       // reused charge-mote options (emitted every 0.12 s while charging)
  function turretArmed(e, L, P) {
    var s = e.s;
    if (!alive(P)) return false;
    var dx = P.x + P.w / 2 - (e.x + 16), dy = P.y + P.h / 2 - (e.y + 16);
    if (Math.abs(dx) > s.range * 32 || Math.abs(dy) > s.range * 32 * 0.62) return false;
    if (s.aim && Math.abs(M.angleDiff(s.base, Math.atan2(dy, dx))) > s.cone) return false;
    return true;
  }
  function turretFire(e, L) {
    var s = e.s, p = pal(L);
    var cx = e.x + 16, cy = e.y + 16;
    var dx = Math.cos(s.lock), dy = Math.sin(s.lock);
    var mx = cx + dx * 21, my = cy + dy * 21;
    var b = L.spawn('w2.bolt', mx, my, { dx: dx, dy: dy, speed: s.speed });
    if (b) b.s.owner = e;
    s.recoil = 1;
    s.flash = 1;
    AP.FX.burst('w2.muzzle', mx, my, { dir: s.lock, color: p.hazard });
    if (onScreen(L, cx, cy, 160)) AP.sfxAt('shoot', cx, cy, { vol: 0.55, pitch: 0.95 + 0.1 * hash01(e.id, s.shots, 5) });
    s.shots++;
  }
  function turretReset(e) {
    var s = e.s;
    s.ang = s.base; s.lock = s.base; s.charging = false; s.charge = 0; s.lastCyc = null; s.recoil = 0; s.flash = 0;
  }

  E.register('w2.turret', {
    kind: 'solid', w: 32, h: 32, anchor: 'tile', layer: 4, lint: 'solid', renderPad: 700,
    init: function (e, spec, L) {
      var s = e.s;
      s.aim = spec.aim === 'player';
      s.rate = Math.max(0.05, num(spec.rate, 0.8));
      s.delay = Math.max(0, num(spec.delay, 0));
      s.speed = Math.max(1, num(spec.speed, 8));
      s.range = Math.max(2, num(spec.range, 18));
      // aimed turrets track the player within ±cone degrees of their facing (default about 77)
      s.cone = M.clamp(num(spec.cone, TUR_CONE * 180 / Math.PI), 5, 90) * Math.PI / 180;
      var tx = Math.floor((e.x + 16) / 32), ty = Math.floor((e.y + 16) / 32);
      var d = DIRV[spec.dir];
      if (!d) {
        if (cellSolid(L, tx + 1, ty)) d = DIRV.left;
        else if (cellSolid(L, tx - 1, ty)) d = DIRV.right;
        else if (cellSolid(L, tx, ty - 1)) d = DIRV.down;
        else if (cellSolid(L, tx, ty + 1)) d = DIRV.up;
        else d = DIRV.left;
      }
      s.dx = d[0]; s.dy = d[1];
      s.base = Math.atan2(d[1], d[0]);
      s.shots = 0;
      s.chargeSec = 0.5;
      s.lineLen = 0;
      s.moteT = 0;
      turretReset(e);
    },
    update: function (e, dt, L) {
      var s = e.s;
      if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 5);
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 4);
      var B = AP.Beat;
      var bps = Math.max(0.5, (B && B.bpm ? B.bpm : 96) / 60);
      var period = Math.max(1, Math.round(bps / s.rate));
      var periodSec = period / bps;
      s.chargeSec = M.clamp(periodSec * 0.5, 0.42, 0.6);
      var chargeB = s.chargeSec * bps;
      var u = (B ? B.beat : L.time * bps) - s.delay * bps;
      var cyc = Math.floor(u / period);
      var ph = u - cyc * period;
      var P = L.player;
      var armed = turretArmed(e, L, P);
      // track the player (unlocked only between charges)
      if (s.aim && !s.charging && alive(P)) {
        var tgt = Math.atan2(P.y + P.h / 2 - (e.y + 16), P.x + P.w / 2 - (e.x + 16));
        var off = M.clamp(M.angleDiff(s.base, tgt), -s.cone, s.cone);
        var want = s.base + off;
        var dd = M.angleDiff(s.ang, want);
        var mx = 3.2 * dt;
        s.ang += dd > mx ? mx : (dd < -mx ? -mx : dd);
      }
      if (s.lastCyc === null) s.lastCyc = cyc;
      if (cyc !== s.lastCyc) {
        // fire only after a full telegraph (never less than 0.4 s, CONTRACT §2.8)
        if (s.charging && s.charge >= Math.max(0.4, s.chargeSec * 0.9) && alive(P)) turretFire(e, L);
        s.charging = false;
        s.charge = 0;
        s.lastCyc = cyc;
      }
      if (s.charging && !alive(P)) { s.charging = false; s.charge = 0; }
      if (!s.charging && armed && ph >= period - chargeB) {
        s.charging = true;
        s.charge = 0;
        s.lock = s.ang;
        s.moteT = 0;
        var mx0 = e.x + 16 + Math.cos(s.lock) * 21, my0 = e.y + 16 + Math.sin(s.lock) * 21;
        L.raycast(mx0, my0, Math.cos(s.lock), Math.sin(s.lock), 1100, rayOut);
        s.lineLen = rayOut.dist;
        if (onScreen(L, e.x + 16, e.y + 16, 0)) AP.sfxAt('charge', e.x + 16, e.y + 16, { vol: 0.32, pitch: 1.25 });
      }
      if (s.charging) {
        s.charge += dt;
        s.moteT -= dt;
        if (s.moteT <= 0) {
          s.moteT = 0.12;
          CHG.phase = s.charge * 7;
          if (onScreen(L, e.x + 16, e.y + 16, 32)) AP.FX.burst('w2.charge', e.x + 16, e.y + 16, CHG);
        }
      }
    },
    onRespawn: function (e) { turretReset(e); },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var x = e.rx, y = e.ry, cx = x + 16, cy = y + 16;
      var k = s.charging ? M.clamp(s.charge / s.chargeSec, 0, 1) : 0;
      var ang = s.charging ? s.lock : s.ang;
      var b = beatPulse();
      // sight line of the locked shot (telegraph)
      if (k > 0 && s.lineLen > 0) {
        var ca = Math.cos(ang), sa = Math.sin(ang);
        ctx.strokeStyle = rgba(p.accent, 0.18 + 0.5 * k);
        ctx.lineWidth = 1 + k;
        ctx.setLineDash(DASH);
        ctx.lineDashOffset = -L.time * 60;
        ctx.beginPath();
        ctx.moveTo(cx + ca * 22, cy + sa * 22);
        ctx.lineTo(cx + ca * (21 + s.lineLen), cy + sa * (21 + s.lineLen));
        ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.lineDashOffset = 0;
      }
      // mount plate on the wall side
      var bx = -s.dx, by = -s.dy;
      ctx.fillStyle = rgba(p.primary, 0.22);
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (bx !== 0) {
        var px0 = bx > 0 ? x + 22 : x + 1;
        ctx.rect(px0, y + 3, 9, 26);
      } else {
        var py0 = by > 0 ? y + 22 : y + 1;
        ctx.rect(x + 3, py0, 26, 9);
      }
      ctx.fill();
      ctx.stroke();
      // barrel (recoils after a shot)
      var ca2 = Math.cos(ang), sa2 = Math.sin(ang);
      var L0 = 4, L1 = 19 - s.recoil * 5, wdt = 4;
      ctx.beginPath();
      ctx.moveTo(cx + ca2 * L0 - sa2 * wdt, cy + sa2 * L0 + ca2 * wdt);
      ctx.lineTo(cx + ca2 * L1 - sa2 * (wdt - 1), cy + sa2 * L1 + ca2 * (wdt - 1));
      ctx.lineTo(cx + ca2 * L1 + sa2 * (wdt - 1), cy + sa2 * L1 - ca2 * (wdt - 1));
      ctx.lineTo(cx + ca2 * L0 + sa2 * wdt, cy + sa2 * L0 - ca2 * wdt);
      ctx.closePath();
      ctx.fillStyle = rgba(p.ink, 0.25 + 0.5 * s.flash);
      ctx.fill();
      ctx.strokeStyle = AP.Color.mix(p.primary, p.ink, 0.4);
      ctx.lineWidth = 2;
      ctx.stroke();
      // pentagon body, a vertex pointing down the barrel
      AP.R.poly(ctx, cx, cy, 12.5, 5, ang);
      ctx.fillStyle = rgba(p.bg, 0.9);
      ctx.fill();
      ctx.fillStyle = rgba(p.primary, 0.25);
      ctx.fill();
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      // facets
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(p.primary, 0.55);
      ctx.beginPath();
      for (var i = 0; i < 5; i++) {
        var aa = ang + i * TAU / 5;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(aa) * 12.5, cy + Math.sin(aa) * 12.5);
      }
      ctx.stroke();
      // charging core (accent), with the aim tracker ring for aimed turrets
      var core = 3 + 2.5 * k + s.flash * 2;
      if (k > 0 || s.flash > 0) AP.R.glow(ctx, cx, cy, 16 + 20 * k, p.accent, 0.35 + 0.55 * Math.max(k, s.flash));
      ctx.fillStyle = k > 0 ? AP.Color.mix(p.accent, p.ink, k * 0.6) : rgba(p.accent, 0.55 + 0.25 * b);
      ctx.beginPath();
      ctx.arc(cx, cy, core, 0, TAU);
      ctx.fill();
      if (s.aim) {
        ctx.strokeStyle = rgba(p.accent, 0.5 + 0.4 * k);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 7 + 2 * b, ang - 0.6, ang + 0.6);
        ctx.stroke();
      }
    }
  });

  // ================================================================== w2.geode
  // A rough crystal-lined stone. Struck by a hard landing (a fall of about two tiles), a bolt or a dash, it cracks
  // and bursts, breaking every '+' within `radius` tiles in an outward ripple. Geodes inside the ripple chain-react.
  var GEODE_LAND_V = Math.sqrt(2 * C.GRAVITY * 58);
  var GEODE_CRACK = 0.2;

  function strikeGeode(e, L, cause) {
    var s = e.s;
    if (!s || s.state !== 0 || e.dead) return false;
    s.state = 1;
    s.t = 0;
    s.cause = cause;
    var cx = e.x + 16, cy = e.y + 16, p = pal(L);
    AP.FX.burst('w2.glint', cx, cy, { n: 9 });
    AP.FX.ring(cx, cy, 6, 34, 0.22, p.accent, 2);
    AP.sfxAt('hit', cx, cy, { vol: 0.75, pitch: 1.45 });
    L.shake(3, 0.14);
    if (cause === 'dash') shatterGeode(e, L);
    return true;
  }

  function shatterGeode(e, L) {
    var s = e.s;
    if (s.state === 2) return;
    s.state = 2;
    s.t = 0;
    e.collidable = false;
    var cx = e.x + 16, cy = e.y + 16, p = pal(L);
    var R = s.radius, q = [];
    var tx0 = Math.floor(cx / 32 - R - 1), tx1 = Math.floor(cx / 32 + R + 1);
    var ty0 = Math.floor(cy / 32 - R - 1), ty1 = Math.floor(cy / 32 + R + 1);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var d = Math.sqrt((tx * 32 + 16 - cx) * (tx * 32 + 16 - cx) + (ty * 32 + 16 - cy) * (ty * 32 + 16 - cy)) / 32;
        if (d <= R + 0.5 && L.tileAt(tx, ty) === T.BREAK) q.push([d * 0.055, tx, ty, null]);
      }
    }
    var sol = L.solids;
    for (var i = 0; i < sol.length; i++) {
      var g = sol[i];
      if (g === e || g.dead || g.type !== 'w2.geode' || !g.s || g.s.state !== 0) continue;
      var dg = Math.sqrt((g.x + 16 - cx) * (g.x + 16 - cx) + (g.y + 16 - cy) * (g.y + 16 - cy)) / 32;
      if (dg <= R + 0.5) q.push([0.08 + dg * 0.055, -1, -1, g]);
    }
    q.sort(function (a, b) { return a[0] - b[0]; });
    s.queue = q;
    s.qi = 0;
    AP.FX.burst('w2.geode', cx, cy, { radius: R });
    AP.FX.burst('w2.shatter', cx, cy, { n: 10, color: p.primary });
    AP.sfxAt('break', cx, cy, { pitch: 0.8, vol: 0.9 });
    AP.sfxAt('chime', cx, cy, { vol: 0.55, pitch: 1.2 });
    L.shake(6, 0.3);
    L.hitstop(0.05);
    L.flash(p.accent, 0.1, 0.14);
  }

  function buildGeodeShape(e) {
    var s = e.s;
    var x = e.x, y = e.y, seed = (e.x * 7 + e.y * 13) | 0;
    var cx = x + 16, cy = y + 17;
    var i, a, r;
    // rough stone shell (9 jittered vertices)
    var shell = [];
    for (i = 0; i < 9; i++) {
      a = -Math.PI / 2 + i * TAU / 9 + (hash01(seed, i, 1) - 0.5) * 0.35;
      r = 13.5 + hash01(seed, i, 2) * 3;
      shell.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.94);
    }
    // the cavity where the shell has split open (7 jittered vertices, a little above centre)
    var hx = cx + (hash01(seed, 9, 3) - 0.5) * 2, hy = cy - 1.5;
    var cav = [];
    for (i = 0; i < 7; i++) {
      a = i * TAU / 7 + hash01(seed, 7, 4) * 0.9;
      r = 8.2 + hash01(seed, i, 5) * 1.6;
      cav.push(hx + Math.cos(a) * r, hy + Math.sin(a) * r * 0.9);
    }
    // druse: one short prism per cavity wall segment, rooted on the wall and pointing in at the heart
    var cr = [];
    for (i = 0; i < 7; i++) {
      var j = (i + 1) % 7;
      var mx = (cav[i * 2] + cav[j * 2]) / 2, my = (cav[i * 2 + 1] + cav[j * 2 + 1]) / 2;
      var dx = hx - mx, dy = hy - my, dl = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= dl; dy /= dl;
      var len = dl * (0.48 + hash01(seed, i, 6) * 0.3), half = 1.8 + hash01(seed, i, 7) * 1.2;
      var nx = -dy, ny = dx;
      cr.push([mx + nx * half, my + ny * half,
        mx + dx * len * 0.72 + nx * half * 0.8, my + dy * len * 0.72 + ny * half * 0.8,
        mx + dx * len, my + dy * len,
        mx + dx * len * 0.72 - nx * half * 0.8, my + dy * len * 0.72 - ny * half * 0.8,
        mx - nx * half, my - ny * half]);
    }
    s.shell = shell;
    s.cavity = cav;
    s.crystals = cr;
    s.hx = hx; s.hy = hy;
    s.seed = seed;
  }

  E.register('w2.geode', {
    kind: 'solid', w: 32, h: 32, anchor: 'tile', layer: 3, lint: 'solid', renderPad: 120,
    init: function (e, spec, L) {
      var s = e.s;
      s.radius = Math.max(0, num(spec.radius, 2));
      s.state = 0;
      s.t = 0;
      s.cause = '';
      s.queue = null;
      s.qi = 0;
      s.tink = 0;
      s.glint = 0;
      s.onTop = false;
      s.pvy = 0;
      buildGeodeShape(e);
    },
    update: function (e, dt, L) {
      var s = e.s;
      if (s.tink > 0) s.tink -= dt;
      if (s.glint > 0) s.glint = Math.max(0, s.glint - dt * 3);
      if (s.state === 0) {
        // Landings are detected here rather than from 'player:land': when a fall ends flush with a surface the
        // engine reports that event with vy 0 and no landedOn. The impact speed is the fall speed the player had
        // in the previous step (a blocked landing zeroes P.vy, a flush one leaves it).
        var P = L.player;
        var on = alive(P) && P.vy >= 0 && P.y + P.h === e.y && P.x < e.x + e.w && P.x + P.w > e.x;
        if (on && !s.onTop) {
          var v = Math.max(s.pvy, P.vy);
          if (v >= GEODE_LAND_V) strikeGeode(e, L, 'land');
          else if (v > 60 && s.tink <= 0) {
            s.tink = 0.35;
            s.glint = 1;
            AP.FX.burst('w2.glint', e.x + 16, e.y + 4, { n: 3 });
            AP.sfxAt('chime', e.x + 16, e.y, { vol: 0.25, pitch: 1.9 });
          }
        }
        s.onTop = on;
        s.pvy = alive(P) ? P.vy : 0;
      } else if (s.state === 1) {
        s.t += dt;
        if (s.t >= GEODE_CRACK) shatterGeode(e, L);
      } else if (s.state === 2) {
        s.t += dt;
        var q = s.queue;
        while (q && s.qi < q.length && q[s.qi][0] <= s.t) {
          var it = q[s.qi++];
          if (it[3]) strikeGeode(it[3], L, 'chain');
          else L.breakTile(it[1], it[2], 'geode');
        }
        if ((!q || s.qi >= q.length) && s.t > 0.7) L.remove(e);
      }
    },
    onTouch: function (e, P, L) {
      if (e.s.state === 0 && P.state === 'dash') strikeGeode(e, L, 'dash');
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var b = beatPulse();
      if (s.state === 2) {
        // the shell flies apart
        var k = M.clamp(s.t / 0.35, 0, 1);
        if (k >= 1) return;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 2;
        var sh = s.shell, cx0 = e.x + 16, cy0 = e.y + 17;
        ctx.beginPath();
        for (var i = 0; i < sh.length; i += 2) {
          var j = (i + 2) % sh.length;
          var mx = (sh[i] + sh[j]) / 2 - cx0, my = (sh[i + 1] + sh[j + 1]) / 2 - cy0;
          var push = 1 + k * 1.6;
          ctx.moveTo(cx0 + (sh[i] - cx0) * push + mx * k, cy0 + (sh[i + 1] - cy0) * push + my * k);
          ctx.lineTo(cx0 + (sh[j] - cx0) * push + mx * k, cy0 + (sh[j + 1] - cy0) * push + my * k);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        return;
      }
      var jx = 0, jy = 0;
      if (s.state === 1) { var q2 = s.t / GEODE_CRACK; jx = Math.sin(s.t * 90) * 1.5 * q2; jy = Math.cos(s.t * 70) * q2; }
      ctx.translate(jx, jy);
      var cxg = e.x + 16, cyg = e.y + 16;
      AP.R.glow(ctx, s.hx, s.hy, 22, p.accent, 0.2 + 0.14 * b + 0.4 * s.glint + (s.state === 1 ? 0.5 : 0));
      // rough stone shell
      var shp = s.shell, m;
      ctx.beginPath();
      ctx.moveTo(shp[0], shp[1]);
      for (m = 2; m < shp.length; m += 2) ctx.lineTo(shp[m], shp[m + 1]);
      ctx.closePath();
      ctx.fillStyle = rgba(p.bg, 0.92);
      ctx.fill();
      ctx.fillStyle = rgba(p.primary, 0.22);
      ctx.fill();
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      // strata lines across the stone
      ctx.strokeStyle = rgba(p.primary, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(shp[2], shp[3]); ctx.lineTo(s.cavity[2], s.cavity[3]);
      ctx.moveTo(shp[10], shp[11]); ctx.lineTo(s.cavity[8], s.cavity[9]);
      ctx.moveTo(shp[14], shp[15]); ctx.lineTo(s.cavity[12], s.cavity[13]);
      ctx.stroke();
      // the split-open cavity, lit from inside
      var cav = s.cavity;
      ctx.beginPath();
      ctx.moveTo(cav[0], cav[1]);
      for (m = 2; m < cav.length; m += 2) ctx.lineTo(cav[m], cav[m + 1]);
      ctx.closePath();
      ctx.fillStyle = rgba(p.bg, 0.95);
      ctx.fill();
      ctx.fillStyle = rgba(p.accent, 0.16 + 0.12 * b + 0.3 * s.glint);
      ctx.fill();
      ctx.strokeStyle = AP.Color.mix(p.primary, p.accent, 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // the druse: crystals pointing in at the heart (accent: an interactable, never a spike strip)
      var cr = s.crystals;
      ctx.lineWidth = 1.1;
      for (var c = 0; c < cr.length; c++) {
        var f = cr[c];
        ctx.beginPath();
        ctx.moveTo(f[0], f[1]);
        for (m = 2; m < f.length; m += 2) ctx.lineTo(f[m], f[m + 1]);
        ctx.closePath();
        ctx.fillStyle = rgba(p.accent, 0.35 + 0.25 * ((c + Math.floor(L.time * 2)) % 3 === 0 ? b : 0));
        ctx.fill();
        ctx.strokeStyle = p.accent;
        ctx.stroke();
      }
      // the heart: a small bright facet that pulses on the beat
      ctx.fillStyle = AP.Color.mix(p.accent, p.ink, 0.35 + 0.4 * b);
      AP.R.poly(ctx, s.hx, s.hy, 1.6 + 0.8 * b + (s.state === 1 ? 1.2 : 0), 4, L.time * 0.8);
      ctx.fill();
      if (s.state === 1) {
        var cq = M.clamp(s.t / GEODE_CRACK, 0, 1);
        if (AP.Art && AP.Art.crack) {
          AP.Art.crack(ctx, e.x + 3, e.y + 3, 26, 26, s.seed, p.ink, 1 + cq);
          AP.Art.crack(ctx, e.x + 5, e.y + 5, 22, 22, s.seed + 17, p.accent, 1.2);
        }
      }
    }
  });

  // ================================================================== w2.stalactite (extra)
  // A crystal spike hanging under a ceiling (anchor 'ceiling'). When the player passes beneath it shakes for
  // `tele` seconds (default 0.55), drops and shatters on the ground, then regrows after `respawn` seconds.
  // spec.drop = true (used by the Crystal Monarch's shard fall): it telegraphs at once with a column line,
  // falls, and is removed when it shatters.
  var ST_W = 16, ST_H = 30;
  var ST_SENSE = 11 * 32;

  function stalReset(e) {
    var s = e.s;
    e.setPos(e.homeX, e.homeY);
    s.state = s.drop ? 'shake' : 'hang';
    s.t = 0; s.vy = 0; s.grow = 1;
    e.hazard = true;
    e.collidable = true;
    e.visible = true;
  }
  function stalClearBelow(L, x, y0, y1) {
    for (var y = y0; y < y1; y += 32) if (solidAtPoint(L, x, y)) return false;
    return true;
  }

  E.register('w2.stalactite', {
    kind: 'sensor', w: ST_W, h: ST_H, anchor: 'ceiling', layer: 5, lint: 'ignore', renderPad: 420,
    hazard: true,
    lintRects: function (spec, tx, ty) {
      if (spec && spec.drop) return [];
      return [[tx + 0.25, ty, 0.5, ST_H / 32, 'hazard']];
    },
    init: function (e, spec, L) {
      var s = e.s;
      s.drop = !!spec.drop;
      s.tele = Math.max(0.4, num(spec.tele, s.drop ? 0.75 : 0.55));
      s.respawn = Math.max(0.5, num(spec.respawn, 3));
      s.seed = hash01(e.homeX, e.homeY, 23);
      s.lineLen = 0;
      stalReset(e);
      if (s.drop) {
        L.raycast(e.x + ST_W / 2, e.y + ST_H + 2, 0, 1, 1400, rayOut);
        s.lineLen = rayOut.dist;
      }
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.t += dt;
      var cx = e.x + ST_W / 2;
      if (s.state === 'hang') {
        var P = L.player;
        if (alive(P)) {
          var pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
          if (Math.abs(pcx - cx) < 34 && pcy > e.y + ST_H && pcy - e.y < ST_SENSE && stalClearBelow(L, cx, e.y + ST_H + 4, pcy)) {
            s.state = 'shake';
            s.t = 0;
            L.raycast(cx, e.y + ST_H + 2, 0, 1, 1400, rayOut);
            s.lineLen = rayOut.dist;
            AP.FX.burst('w2.dust', cx, e.y + 2, { n: 4, gravity: 120 });
            AP.sfxAt('crumble', cx, e.y, { vol: 0.4, pitch: 1.6 });
          }
        }
      } else if (s.state === 'shake') {
        if (s.t >= s.tele) {
          s.state = 'fall';
          s.t = 0;
          s.vy = 120;
          AP.sfxAt('whoosh', cx, e.y, { vol: 0.35, pitch: 1.5 });
        }
      } else if (s.state === 'fall') {
        s.vy = Math.min(s.vy + C.GRAVITY * 1.4 * dt, 1150);
        e.y += s.vy * dt;
        var tipY = e.y + ST_H;
        var hitGround = solidAtPoint(L, cx, tipY);
        if (!hitGround) {
          var sol = L.solids;
          for (var i = 0; i < sol.length; i++) {
            var o = sol[i];
            if (o.dead || !o.collidable || o.oneWay) continue;
            if (cx >= o.x && cx < o.x + o.w && tipY >= o.y && tipY < o.y + o.h) { hitGround = true; if (o.type === 'w2.geode') strikeGeode(o, L, 'shard'); break; }
          }
        }
        if (hitGround || e.y > L.ph + 64) {
          var gy = Math.min(tipY, L.ph);
          AP.FX.burst('w2.shatter', cx, gy - 4, { n: 9, color: pal(L).hazard, dir: -HALF_PI });
          AP.FX.burst('w2.dust', cx, gy - 2, { n: 4 });
          if (onScreen(L, cx, gy, 64)) AP.sfxAt('break', cx, gy, { vol: 0.5, pitch: 1.35 });
          if (s.drop) { L.remove(e); return; }
          s.state = 'gone';
          s.t = 0;
          e.hazard = false;
          e.collidable = false;
          e.visible = false;
        }
      } else if (s.state === 'gone') {
        if (s.t >= s.respawn) {
          e.setPos(e.homeX, e.homeY);
          s.state = 'grow';
          s.t = 0;
          s.grow = 0;
          e.visible = true;
        }
      } else if (s.state === 'grow') {
        s.grow = Math.min(1, s.t / 0.6);
        if (s.grow >= 1) { s.state = 'hang'; s.t = 0; e.hazard = true; e.collidable = true; }
      }
    },
    onPlayerDeath: function (e, L) {
      if (e.s.drop) L.remove(e);
    },
    onRespawn: function (e) {
      if (!e.s.drop) stalReset(e);
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var cx = e.rx + ST_W / 2, top = e.ry;
      var jx = 0;
      if (s.state === 'shake') {
        var q = M.clamp(s.t / s.tele, 0, 1);
        jx = Math.sin(s.t * 62) * (0.8 + 2.2 * q);
        // drop column telegraph
        if (s.lineLen > 0) {
          ctx.strokeStyle = rgba(p.hazard, 0.15 + 0.45 * q);
          ctx.lineWidth = 1.5;
          ctx.setLineDash(DOTS);
          ctx.beginPath();
          ctx.moveTo(cx, top + ST_H + 4);
          ctx.lineTo(cx, top + ST_H + 2 + s.lineLen);
          ctx.stroke();
          ctx.setLineDash(NODASH);
          var gy = top + ST_H + 2 + s.lineLen;
          ctx.strokeStyle = rgba(p.hazard, 0.3 + 0.6 * q);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx - 10 + 4 * q, gy - 2); ctx.lineTo(cx, gy - 9 + 3 * q); ctx.lineTo(cx + 10 - 4 * q, gy - 2);
          ctx.stroke();
        }
      }
      var g = s.state === 'grow' ? M.ease.outBack(s.grow) : 1;
      if (g <= 0.01) return;
      var hgt = ST_H * g, wid = ST_W * 0.5 * Math.min(1, g * 1.2);
      ctx.translate(jx, 0);
      if (s.state === 'fall') AP.R.glow(ctx, cx, top + hgt * 0.6, 18, p.hazard, 0.5);
      // root cluster
      ctx.beginPath();
      ctx.moveTo(cx - wid - 3, top); ctx.lineTo(cx - wid * 0.4, top + 7 * g); ctx.lineTo(cx + wid * 0.4, top + 7 * g); ctx.lineTo(cx + wid + 3, top);
      ctx.closePath();
      ctx.fillStyle = rgba(p.primary, 0.35);
      ctx.fill();
      // the spike itself: two facets meeting at the tip (hazard)
      ctx.beginPath();
      ctx.moveTo(cx - wid, top + 1);
      ctx.lineTo(cx, top + hgt);
      ctx.lineTo(cx + wid, top + 1);
      ctx.closePath();
      ctx.fillStyle = rgba(p.hazard, 0.55);
      ctx.fill();
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      ctx.strokeStyle = rgba(p.ink, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - wid * 0.3, top + 3); ctx.lineTo(cx + 1, top + hgt - 5);
      ctx.stroke();
      // side barbs (spiky silhouette)
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - wid * 0.62, top + hgt * 0.38); ctx.lineTo(cx - wid - 2.5, top + hgt * 0.5);
      ctx.moveTo(cx + wid * 0.55, top + hgt * 0.5); ctx.lineTo(cx + wid + 2, top + hgt * 0.62);
      ctx.stroke();
    }
  });

  // ================================================================== w2.cluster (extra: decoration)
  // A cluster of crystal prisms growing out of the rock: from a floor (dir 'up', the default), a ceiling ('down')
  // or a wall ('left' / 'right' = the way the crystals grow). Terrain decoration in pal.primary with ink glints and
  // a soft beat pulse; it never collides or touches anything (lint 'ignore'). spec: dir, size (tiles, 1), n (5).
  var CL_DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  E.register('w2.cluster', {
    kind: 'sensor', w: 32, h: 32, anchor: 'tile', layer: 0, behindTiles: true, lint: 'ignore', renderPad: 96,
    init: function (e, spec, L) {
      var s = e.s;
      e.collidable = false;
      var d = CL_DIR[spec.dir] || CL_DIR.up;
      var size = M.clamp(num(spec.size, 1), 0.4, 3) * 32;
      var n = M.clamp(Math.round(num(spec.n, 5)), 2, 9);
      var seed = AP.hash2(e.x | 0, e.y | 0, 41);
      // root line: along the surface the cluster grows from (the edge of its tile on the rock side)
      var bx = e.x + 16 - d[0] * 16, by = e.y + 16 - d[1] * 16;
      var tx = -d[1], ty = d[0];
      var base = Math.atan2(d[1], d[0]);
      var prisms = [];
      for (var i = 0; i < n; i++) {
        var u = n > 1 ? i / (n - 1) - 0.5 : 0;
        var r1 = hash01(seed, i, 1), r2 = hash01(seed, i, 2), r3 = hash01(seed, i, 3);
        var a = base + u * 1.1 + (r1 - 0.5) * 0.35;
        var len = size * (0.45 + 0.6 * r2) * (1 - Math.abs(u) * 0.55);
        var half = 2.6 + 2.2 * r3;
        var ox = bx + tx * u * 22, oy = by + ty * u * 22;
        var ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
        // a hexagonal prism seen side-on: root, two shoulders, the tip, and back
        prisms.push([
          ox + nx * half, oy + ny * half,
          ox + ca * len * 0.78 + nx * half, oy + sa * len * 0.78 + ny * half,
          ox + ca * len, oy + sa * len,
          ox + ca * len * 0.78 - nx * half, oy + sa * len * 0.78 - ny * half,
          ox - nx * half, oy - ny * half,
          ox + ca * len * 0.08, oy + sa * len * 0.08
        ]);
      }
      s.prisms = prisms;
      s.seed = seed;
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L), pr = s.prisms;
      var b = beatPulse();
      var hi = Math.floor(L.time * 0.7 + hash01(s.seed, 0, 9) * 7) % pr.length;
      ctx.lineJoin = 'round';
      for (var i = 0; i < pr.length; i++) {
        var f = pr[i];
        // shaded half and lit half of the prism, then its outline and ridge
        ctx.beginPath();
        ctx.moveTo(f[0], f[1]); ctx.lineTo(f[2], f[3]); ctx.lineTo(f[4], f[5]); ctx.lineTo(f[10], f[11]);
        ctx.closePath();
        ctx.fillStyle = rgba(p.primary, 0.1);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(f[10], f[11]); ctx.lineTo(f[4], f[5]); ctx.lineTo(f[6], f[7]); ctx.lineTo(f[8], f[9]);
        ctx.closePath();
        ctx.fillStyle = rgba(p.primary, 0.2 + 0.08 * b);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(f[0], f[1]);
        for (var k = 2; k < 10; k += 2) ctx.lineTo(f[k], f[k + 1]);
        ctx.strokeStyle = rgba(p.primary, 0.75);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(f[10], f[11]); ctx.lineTo(f[4], f[5]);
        ctx.strokeStyle = i === hi ? rgba(p.ink, 0.5 + 0.3 * b) : rgba(p.primary, 0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  });

})(window.AP = window.AP || {});
