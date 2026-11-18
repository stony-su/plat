/* js/worlds/w1/entities.js — owner: W1 */
(function (AP) {
  'use strict';

  // W1 "The Lattice" enemies (CONTRACT section 5, DESIGN section 3):
  //   w1.crawler  a square on two leg-lines that patrols and turns at walls and ledges (stomp it)
  //   w1.bouncer  a circle with an inner triangle that hops on AP.Beat (big hop on beat 1 of the bar);
  //               its top spikes are out while it rises, so stomp it on the way down
  //   w1.saw      a spinning 6-point star that follows an AP.Path track (hazard only)
  // All drawing is regular polygons, stars, arcs and lines in the level palette roles.

  var C = AP.C;
  var M = AP.M;
  var T = AP.TILE;
  var TAU = Math.PI * 2;

  function pal(L) { return (L && L.pal) || AP.Worlds.pal('w1'); }
  function lp() { return (AP.level && AP.level.pal) || AP.Worlds.pal('w1'); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; var q = 1 - ph; return q * q * q; }

  // scratch option objects for FX bursts and positional sounds (no allocation per call)
  var FXO = { n: 0, color: undefined, color2: undefined };
  function fx(name, x, y, n, color, color2) { FXO.n = n; FXO.color = color; FXO.color2 = color2; return AP.FX.burst(name, x, y, FXO); }
  var SFXO = { vol: 1, pitch: 1 };
  function snd(name, x, y, vol, pitch) { SFXO.vol = vol; SFXO.pitch = pitch; return AP.sfxAt(name, x, y, SFXO); }

  // ------------------------------------------------------------------ FX presets (w1.*)
  var FX_SQ = { n: 6, shape: 'sq', speed: [90, 230], life: [0.35, 0.75], size: [2.5, 5], sizeEnd: 0, gravity: 700, drag: 0.8, spin: [-9, 9], color: '#fff', color2: '#fff' };
  var FX_LINE = { n: 2, shape: 'line', speed: [140, 260], life: [0.3, 0.55], size: [4, 6], sizeEnd: 1, gravity: 500, drag: 0.5, spin: [-14, 14], width: 2, color: '#fff' };
  var FX_TRI = { n: 7, shape: 'tri', speed: [110, 260], life: [0.3, 0.6], size: [2.5, 5], sizeEnd: 0, gravity: 300, drag: 1.2, spin: [-10, 10], color: '#fff', color2: '#fff' };
  var FX_DUST = { n: 4, shape: 'sq', speed: [20, 70], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.25, 0.45], size: [1.5, 3], sizeEnd: 0, gravity: -40, drag: 2, color: '#fff', additive: false };
  var FX_SPARK = { n: 3, shape: 'line', speed: [160, 320], life: [0.12, 0.26], size: [3, 6], sizeEnd: 0, drag: 2, align: true, width: 1.5, color: '#fff', color2: '#fff' };
  var FX_TILE = { n: 6, shape: 'sq', speed: [60, 220], life: [0.6, 1.2], size: [4, 8], sizeEnd: 0, gravity: 520, drag: 0.4, spin: [-6, 6], color: '#fff', color2: '#fff', spread: 10 };
  var FX_MOTE = { n: 10, shape: 'dot', speed: [-160, -60], life: [0.4, 0.7], size: [1.5, 3], sizeEnd: 0, spread: 70, color: '#fff', color2: '#fff' };
  var FX_QUAKE = { n: 3, shape: 'sq', speed: [60, 160], angle: [Math.PI * 1.15, Math.PI * 1.85], life: [0.25, 0.5], size: [2, 4], sizeEnd: 0, gravity: 900, drag: 0.5, spin: [-8, 8], color: '#fff', color2: '#fff' };

  AP.FX.preset('w1.crawlerPop', function (x, y, o) {
    var p = lp();
    var c = (o && o.color) || p.hazard;
    FX_SQ.color = c; FX_SQ.color2 = p.ink; FX_SQ.n = 7;
    FX_LINE.color = c;
    var n = AP.FX.emit(x, y, FX_SQ) + AP.FX.emit(x, y + 6, FX_LINE);
    AP.FX.ring(x, y, 4, 36, 0.32, c, 2);
    return n + 1;
  });

  AP.FX.preset('w1.bouncerPop', function (x, y, o) {
    var p = lp();
    var c = (o && o.color) || p.hazard;
    FX_TRI.color = c; FX_TRI.color2 = p.accent; FX_TRI.n = 9;
    var n = AP.FX.emit(x, y, FX_TRI);
    AP.FX.ring(x, y, 6, 40, 0.34, c, 2);
    AP.FX.ring(x, y, 2, 22, 0.22, p.accent, 1.5);
    return n + 2;
  });

  AP.FX.preset('w1.hop', function (x, y, o) {
    var p = lp();
    FX_DUST.color = (o && o.color) || p.primary;
    FX_DUST.n = (o && o.n) || 4;
    return AP.FX.emit(x, y, FX_DUST);
  });

  AP.FX.preset('w1.sparks', function (x, y, o) {
    var p = lp();
    FX_SPARK.color = (o && o.color) || p.accent; FX_SPARK.color2 = p.hazard;
    FX_SPARK.n = (o && o.n) || 3;
    return AP.FX.emit(x, y, FX_SPARK);
  });

  AP.FX.preset('w1.tiles', function (x, y, o) {
    var p = lp();
    FX_TILE.color = (o && o.color) || p.primary; FX_TILE.color2 = (o && o.color2) || p.accent;
    FX_TILE.n = (o && o.n) || 6;
    return AP.FX.emit(x, y, FX_TILE);
  });

  AP.FX.preset('w1.quake', function (x, y, o) {
    var p = lp();
    FX_QUAKE.color = (o && o.color) || p.primary; FX_QUAKE.color2 = p.hazard;
    FX_QUAKE.n = (o && o.n) || 3;
    return AP.FX.emit(x, y, FX_QUAKE);
  });

  AP.FX.preset('w1.assemble', function (x, y, o) {
    var p = lp();
    FX_MOTE.color = (o && o.color) || p.accent; FX_MOTE.color2 = p.primary;
    FX_MOTE.n = (o && o.n) || 10;
    return AP.FX.emit(x, y, FX_MOTE);
  });

  // ------------------------------------------------------------------ shared helpers
  var DASH = [4, 5];
  var NODASH = [];

  // is (x, y) inside something an actor could stand on (solid/break/one-way tile, or a collidable solid)?
  function groundPoint(L, x, y) {
    var c = L.tileAt(Math.floor(x / 32), Math.floor(y / 32));
    if (c === T.SOLID || c === T.BREAK || c === T.ONEWAY) return true;
    return AP.Phys.rectSolid(L, x - 1, y, 2, 2, null);
  }

  function defeatFx(e, preset, sfx) {
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    AP.FX.burst(preset, cx, cy);
    if (sfx) snd('hit', cx, cy, 0.8, 1);
  }

  // ================================================================== w1.crawler
  AP.Entities.register('w1.crawler', {
    kind: 'actor', w: 24, h: 20, anchor: 'floor', layer: 5, lint: 'ignore', renderPad: 48,
    hazard: true, stompable: true, dashable: true, burstable: true,
    init: function (e, spec) {
      var s = e.s;
      s.dir0 = spec.dir === 'left' ? -1 : 1;
      s.dir = s.dir0;
      s.look = s.dir0;
      s.speed = Math.max(0.25, num(spec.speed, 2)) * 32;
      s.pause = 0;
      s.walk = 0;
      s.squash = 0;
      s.blink = 1.5 + ((e.homeX * 0.37 + e.homeY * 0.11) % 2.5);
      s.blinkT = 0;
    },
    update: function (e, dt, L) {
      var s = e.s;
      if (s.pause > 0) {
        // a short beat after turning: the body squashes and the legs plant
        s.pause -= dt;
        AP.Phys.gravity(e, dt);
        e.vx = 0;
        if (e.moveY(e.vy * dt)) e.vy = 0;
      } else {
        var d0 = s.dir;
        AP.Phys.walk(e, dt, s.speed);
        if (s.dir !== d0) {
          s.pause = 0.2;
          s.squash = 1;
          if (L.cam && L.cam.visible(e.x, e.y, e.w, e.h, 0)) fx('w1.hop', e.x + e.w / 2 + d0 * 10, e.y + e.h, 2);
        }
        s.walk += Math.abs(e.vx) * dt;
      }
      s.look = M.approach(s.look, s.dir, dt * 9);
      if (s.squash > 0) s.squash = Math.max(0, s.squash - dt * 5);
      s.blink -= dt;
      if (s.blink <= 0) { s.blinkT = 0.12; s.blink = 2 + (s.walk % 2.3); }
      if (s.blinkT > 0) s.blinkT -= dt;
      if (e.y > L.ph + 96) L.remove(e);
    },
    onStomp: function (e, P, L) {
      defeatFx(e, 'w1.crawlerPop', false);
      L.remove(e);
      return true;
    },
    onDash: function (e, P, L) {
      defeatFx(e, 'w1.crawlerPop', true);
      L.remove(e);
      return true;
    },
    onBurst: function (e, P, L) {
      defeatFx(e, 'w1.crawlerPop', true);
      L.remove(e);
    },
    onSquish: function (e, L) {
      defeatFx(e, 'w1.crawlerPop', true);
      L.remove(e);
    },
    onRespawn: function (e) {
      // survivors return to their post so every retry reads the same
      var s = e.s;
      e.setPos(e.homeX, e.homeY);
      e.vx = 0; e.vy = 0;
      s.dir = s.dir0; s.look = s.dir0; s.pause = 0; s.squash = 0;
    },
    render: function (e, ctx, L) { drawCrawler(e, ctx, L); }
  });

  function drawCrawler(e, ctx, L) {
    var p = pal(L), s = e.s;
    var bx = e.rx + e.w / 2, by = e.ry + e.h;
    var look = s.look, dir = s.dir;
    var bp = beatPulse();
    var sq = s.squash;
    var sx = 1 + 0.18 * sq + 0.04 * bp, sy = 1 - 0.16 * sq - 0.03 * bp;
    var legH = 6;
    var bw = 18 * sx, bh = 14 * sy;
    var bob = Math.abs(Math.sin(s.walk * 0.33)) * 1.3;
    var top = by - legH - bh - bob, left = bx - bw / 2;
    AP.R.glow(ctx, bx, top + bh / 2, 20, p.hazard, 0.16 + 0.12 * bp);
    // legs: two jointed leg-lines walking in counter-phase
    var ph = s.walk * 0.3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = p.hazard;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var k = 0; k < 2; k++) {
      var a = ph + k * Math.PI;
      var hipX = bx + (k ? 5 : -5) * sx, hipY = top + bh;
      var footX = hipX + Math.sin(a) * 3.4;
      var footY = by - Math.max(0, -Math.cos(a)) * 2.4;
      var kneeX = (hipX + footX) / 2 + look * 2.6, kneeY = (hipY + footY) / 2 - 1.2;
      ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY);
    }
    ctx.stroke();
    // teeth: two on the leading face, one on the trailing face (spiky silhouette)
    var fex = dir > 0 ? left + bw : left, bxk = dir > 0 ? left : left + bw;
    ctx.fillStyle = p.hazard;
    ctx.beginPath();
    ctx.moveTo(fex, top + 2); ctx.lineTo(fex + dir * 6, top + 4.5); ctx.lineTo(fex, top + 7);
    ctx.moveTo(fex, top + 7.5); ctx.lineTo(fex + dir * 6, top + 10); ctx.lineTo(fex, top + 12.5);
    ctx.moveTo(bxk, top + 4); ctx.lineTo(bxk - dir * 4, top + 7); ctx.lineTo(bxk, top + 10);
    ctx.fill();
    // body: the square
    ctx.beginPath();
    ctx.rect(left, top, bw, bh);
    ctx.fillStyle = rgba(p.hazard, 0.22);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = p.hazard;
    ctx.stroke();
    // a Truchet quarter-arc pair etched inside (the Lattice motif)
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(p.hazard, 0.55);
    ctx.beginPath();
    var r = Math.min(bw, bh) * 0.45;
    if (dir > 0) {
      ctx.moveTo(left + r, top); ctx.arc(left, top, r, 0, Math.PI / 2);
      ctx.moveTo(left + bw - r, top + bh); ctx.arc(left + bw, top + bh, r, Math.PI, Math.PI * 1.5);
    } else {
      ctx.moveTo(left + bw, top + r); ctx.arc(left + bw, top, r, Math.PI / 2, Math.PI);
      ctx.moveTo(left, top + bh - r); ctx.arc(left, top + bh, r, Math.PI * 1.5, TAU);
    }
    ctx.stroke();
    // the weak point: an accent stripe along the flat top (land here)
    ctx.strokeStyle = rgba(p.accent, 0.75 + 0.25 * bp);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left + 3, top + 2.5); ctx.lineTo(left + bw - 3, top + 2.5);
    ctx.stroke();
    // eye leads the walk
    var ex = bx + look * 4.5 * sx, ey = top + bh * 0.52;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    if (s.blinkT > 0) { ctx.rect(ex - 2.6, ey - 0.6, 5.2, 1.2); }
    else { ctx.arc(ex, ey, 2.6, 0, TAU); }
    ctx.fill();
    if (s.blinkT <= 0) {
      ctx.fillStyle = p.bg;
      ctx.beginPath();
      ctx.arc(ex + look * 1.1, ey + 0.3, 1.1, 0, TAU);
      ctx.fill();
    }
  }

  // ================================================================== w1.bouncer
  // Hops on every beat while grounded: full height on beat 1 of the bar, about half on the others.
  // Its gravity is tuned so each hop lands just before the next beat, so the rhythm is the telegraph.
  var BIG_FIT = 0.86;      // the big hop takes this fraction of a beat
  var SMALL_K = 0.5;       // small hop height relative to the big one
  var RISE_ARMED = -170;   // while rising faster than this the top spikes are out (no stomp)

  function hopGravity(h) {
    var spb = AP.Beat && AP.Beat.secondsPerBeat ? AP.Beat.secondsPerBeat() : 0.5;
    var air = Math.max(0.2, spb * BIG_FIT);
    return Math.max(C.GRAVITY * 0.8, 8 * h / (air * air));
  }

  function bouncerHop(e, L, inBar) {
    var s = e.s;
    var big = inBar === 0;
    var h = big ? s.h : s.h * SMALL_K;
    s.g = hopGravity(s.h);
    e.vy = -Math.sqrt(2 * s.g * h);
    s.grounded = false;
    s.big = big;
    s.stretch = 1;
    s.squash = 0;
    if (s.dir0 !== 0) {
      // look ahead: turn before hopping into a wall or over the edge of the landing surface
      var air = 2 * Math.sqrt(2 * h / s.g);
      var dist = s.speed * air;
      var cx = e.x + e.w / 2, fy = e.y + e.h;
      var ahead = cx + s.dir * (dist + e.w / 2 + 2);
      if (!groundPoint(L, ahead, fy + 2) || AP.Phys.rectSolid(L, ahead - 2, fy - e.h, 4, e.h - 2, e)) s.dir = -s.dir;
    }
    if (L.cam && L.cam.visible(e.x, e.y, e.w, e.h, 32)) {
      fx('w1.hop', e.x + e.w / 2, e.y + e.h, big ? 5 : 3);
      if (big) AP.FX.ring(e.x + e.w / 2, e.y + e.h, 4, 26, 0.25, pal(L).hazard, 1.5);
    }
  }

  AP.Entities.register('w1.bouncer', {
    kind: 'actor', w: 22, h: 22, anchor: 'floor', layer: 5, lint: 'ignore', renderPad: 140,
    hazard: true, stompable: true, dashable: true, burstable: true,
    init: function (e, spec) {
      var s = e.s;
      s.h = Math.max(0.75, num(spec.height, 3)) * 32;
      s.dir0 = spec.dir === 'left' ? -1 : (spec.dir === 'right' ? 1 : 0);
      s.dir = s.dir0;
      s.speed = Math.max(0, num(spec.speed, 1.5)) * 32;
      s.g = C.GRAVITY;
      s.grounded = false;
      s.big = false;
      s.squash = 0;
      s.stretch = 0;
      s.spike = 0;
      s.flip = 0;
      s.floorY = e.y + e.h;
      s.spin = 0;
      s.lastBeat = AP.Beat ? Math.floor(AP.Beat.beat) : 0;
    },
    update: function (e, dt, L) {
      var s = e.s;
      // hop on every beat edge (tracked by index, so an edge that fell inside a hitstop is not lost)
      var bi = AP.Beat ? Math.floor(AP.Beat.beat) : 0;
      if (bi !== s.lastBeat) {
        s.lastBeat = bi;
        if (s.grounded) bouncerHop(e, L, ((bi % AP.Beat.meter) + AP.Beat.meter) % AP.Beat.meter);
      }
      if (!s.grounded) {
        e.vy = Math.min(e.vy + s.g * dt, C.MAX_FALL);
        if (s.dir !== 0 && s.speed > 0) {
          e.vx = s.dir * s.speed;
          if (e.moveX(e.vx * dt)) s.dir = -s.dir;
        }
        var falling = e.vy > 0;
        if (e.moveY(e.vy * dt)) {
          if (falling) {
            s.grounded = true;
            s.squash = s.big ? 1 : 0.6;
            s.floorY = e.y + e.h;
            if (L.cam && L.cam.visible(e.x, e.y, e.w, e.h, 32)) fx('w1.hop', e.x + e.w / 2, e.y + e.h, s.big ? 4 : 2);
          }
          e.vy = 0;
        }
      } else {
        e.vx = 0;
        if (!e.groundAt(0)) { s.grounded = false; s.g = C.GRAVITY; }
      }
      s.spike = M.approach(s.spike, e.vy < RISE_ARMED ? 1 : 0, dt * 14);
      s.flip = M.approach(s.flip, (s.grounded || e.vy < 0) ? 0 : 1, dt * 9);
      if (s.squash > 0) s.squash = Math.max(0, s.squash - dt * 6);
      if (s.stretch > 0) s.stretch = Math.max(0, s.stretch - dt * 4);
      s.spin += dt * (s.grounded ? 0.6 : 2.2);
      if (!s.grounded) {
        // remember the floor below for the landing shadow
        var c = L.tileAt(Math.floor((e.x + e.w / 2) / 32), Math.floor((s.floorY + 1) / 32));
        if (c !== T.SOLID && c !== T.ONEWAY && c !== T.BREAK && e.y + e.h > s.floorY) s.floorY = e.y + e.h;
      }
      if (e.y > L.ph + 96) L.remove(e);
    },
    onStomp: function (e, P, L) {
      // spikes are out while it rises: refuse, and the contact falls through to the hazard rule
      if (e.vy < RISE_ARMED) return false;
      defeatFx(e, 'w1.bouncerPop', false);
      L.remove(e);
      return true;
    },
    onDash: function (e, P, L) {
      defeatFx(e, 'w1.bouncerPop', true);
      L.remove(e);
      return true;
    },
    onBurst: function (e, P, L) {
      defeatFx(e, 'w1.bouncerPop', true);
      L.remove(e);
    },
    onSquish: function (e, L) {
      defeatFx(e, 'w1.bouncerPop', true);
      L.remove(e);
    },
    onRespawn: function (e) {
      var s = e.s;
      e.setPos(e.homeX, e.homeY);
      e.vx = 0; e.vy = 0;
      s.grounded = false; s.g = C.GRAVITY; s.dir = s.dir0; s.squash = 0; s.stretch = 0;
    },
    render: function (e, ctx, L) { drawBouncer(e, ctx, L); }
  });

  function drawBouncer(e, ctx, L) {
    var p = pal(L), s = e.s;
    var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
    var bp = beatPulse();
    // ground shadow while airborne: a hazard dash that widens as it falls back
    if (!s.grounded && s.floorY > e.ry + e.h + 3) {
      var hgt = s.floorY - (e.ry + e.h);
      var k = M.clamp(1 - hgt / Math.max(32, s.h), 0, 1);
      var hw = 5 + 7 * k;
      ctx.strokeStyle = rgba(p.hazard, 0.25 + 0.45 * k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - hw, s.floorY - 1); ctx.lineTo(cx + hw, s.floorY - 1);
      ctx.stroke();
    }
    var sx = 1 + 0.3 * s.squash - 0.14 * s.stretch;
    var sy = 1 - 0.26 * s.squash + 0.2 * s.stretch;
    var R = 10.5 + 0.6 * bp;
    var ccy = cy + (1 - sy) * 11;
    AP.R.glow(ctx, cx, ccy, 22, p.hazard, 0.2 + 0.15 * bp);
    // rim spikes (8); the three on top grow while it rises
    ctx.fillStyle = p.hazard;
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = -Math.PI / 2 + i * TAU / 8 + Math.sin(s.spin) * 0.08;
      var top = (i === 0 || i === 1 || i === 7);
      var len = top ? 2 + 5 * s.spike : 4.2;
      var ca = Math.cos(a), sa = Math.sin(a);
      var bx0 = cx + Math.cos(a - 0.28) * R * sx, by0 = ccy + Math.sin(a - 0.28) * R * sy;
      var bx1 = cx + Math.cos(a + 0.28) * R * sx, by1 = ccy + Math.sin(a + 0.28) * R * sy;
      ctx.moveTo(bx0, by0);
      ctx.lineTo(cx + ca * (R + len) * sx, ccy + sa * (R + len) * sy);
      ctx.lineTo(bx1, by1);
      ctx.closePath();
    }
    ctx.fill();
    // body: a circle (an ellipse while squashed)
    ctx.beginPath();
    ctx.ellipse(cx, ccy, R * sx, R * sy, 0, 0, TAU);
    ctx.fillStyle = rgba(p.hazard, 0.2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = p.hazard;
    ctx.stroke();
    // inner triangle: points up (and stays hazard) while rising, flips down in accent once it is safe to stomp
    var rot = -Math.PI / 2 + s.flip * Math.PI;
    var safe = s.spike < 0.5;
    var tri = 5.6 * (0.9 + 0.1 * bp);
    AP.R.poly(ctx, cx, ccy + (s.flip - 0.5) * 0.8, tri, 3, rot);
    ctx.fillStyle = safe ? rgba(p.accent, 0.55) : rgba(p.hazard, 0.6);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = safe ? p.accent : p.ink;
    ctx.stroke();
    // a beat ring: brightens toward the accent beat (beat 1 of the bar)
    if (AP.Beat && s.grounded) {
      var toAccent = AP.Beat.inBar === AP.Beat.meter - 1 ? AP.Beat.phase : 0;
      if (toAccent > 0.3) {
        ctx.strokeStyle = rgba(p.accent, (toAccent - 0.3) * 0.9);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, ccy, R + 6 - toAccent * 3, 0, TAU);
        ctx.stroke();
      }
    }
  }

  // ================================================================== w1.saw
  // spec: path [[tx,ty],...] (tile centres; required), speed 3 tiles/s, r 0.75 tiles, mode 'loop' (3+ points) or
  // 'pingpong', wait (s at each vertex), delay (s added to the path clock), or circle {r (tiles), period (s), phase (deg)}
  // to swing around the spawn point (path may then be a single point).
  var sawOut = { x: 0, y: 0, i: 0, dir: 1, wait: false };
  var circOut = { x: 0, y: 0 };

  function sawPos(e, t, out) {
    var s = e.s;
    if (s.circ) return AP.Path.circle(s.ccx, s.ccy, s.circ.r, s.circ.period, t, s.circ.phase, out);
    if (s.pts.length > 1) return AP.Path.poly(s.pts, s.speed, s.mode, t, out, s.wait);
    out.x = s.pts[0][0]; out.y = s.pts[0][1];
    return out;
  }

  AP.Entities.register('w1.saw', {
    kind: 'sensor', anchor: 'center', layer: 4, lint: 'ignore', hazard: true, required: ['path'], alwaysRender: true,
    size: function (spec) {
      var r = Math.max(0.3, num(spec && spec.r, 0.75)) * 32;
      var side = Math.round(r * 1.32);
      return [side, side];
    },
    init: function (e, spec) {
      var s = e.s;
      s.r = Math.max(0.3, num(spec.r, 0.75)) * 32;
      s.pts = AP.Entities.pathWorld(spec.path, 'center');
      if (!s.pts.length) s.pts = [[e.x + e.w / 2, e.y + e.h / 2]];
      s.speed = Math.max(0.1, num(spec.speed, 3)) * 32;
      s.mode = (spec.mode === 'loop' || spec.mode === 'pingpong' || spec.mode === 'once') ? spec.mode : (s.pts.length >= 3 ? 'loop' : 'pingpong');
      s.wait = Math.max(0, num(spec.wait, 0));
      s.delay = num(spec.delay, 0);
      s.circ = null;
      if (spec.circle && typeof spec.circle === 'object') {
        s.circ = {
          r: Math.max(0.2, num(spec.circle.r, 2)) * 32,
          period: Math.max(0.3, num(spec.circle.period, 3)),
          phase: num(spec.circle.phase, 0) * Math.PI / 180
        };
        s.ccx = e.x + e.w / 2;
        s.ccy = e.y + e.h / 2;
      }
      // cached track (polyline or circle) and its bounds for culling
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      if (s.circ) {
        x0 = s.ccx - s.circ.r; x1 = s.ccx + s.circ.r; y0 = s.ccy - s.circ.r; y1 = s.ccy + s.circ.r;
        s.track = null;
      } else {
        var tr = [];
        for (var i = 0; i < s.pts.length; i++) {
          tr.push(s.pts[i][0], s.pts[i][1]);
          x0 = Math.min(x0, s.pts[i][0]); x1 = Math.max(x1, s.pts[i][0]);
          y0 = Math.min(y0, s.pts[i][1]); y1 = Math.max(y1, s.pts[i][1]);
        }
        if (s.mode === 'loop' && s.pts.length > 2) tr.push(s.pts[0][0], s.pts[0][1]);
        s.track = tr.length >= 4 ? tr : null;
      }
      s.bx = x0 - s.r - 8; s.by = y0 - s.r - 8; s.bw = x1 - x0 + 2 * s.r + 16; s.bh = y1 - y0 + 2 * s.r + 16;
      s.ang = (e.homeX * 0.07) % TAU;
      s.spinDir = 1;
      s.whoosh = 0;
      s.lastX = 0; s.lastY = 0;
      sawPos(e, s.delay, sawOut);
      e.x = sawOut.x - e.w / 2; e.y = sawOut.y - e.h / 2;
      e.px = e.x; e.py = e.y; e.rx = e.x; e.ry = e.y;
      s.lastX = sawOut.x; s.lastY = sawOut.y;
    },
    update: function (e, dt, L) {
      var s = e.s;
      var o = sawPos(e, L.time + s.delay, sawOut);
      var dx = o.x - s.lastX;
      if (Math.abs(dx) > 0.01) s.spinDir = dx > 0 ? 1 : -1;
      s.lastX = o.x; s.lastY = o.y;
      e.x = o.x - e.w / 2;
      e.y = o.y - e.h / 2;
      s.ang += dt * 13 * s.spinDir;
      if (s.whoosh > 0) s.whoosh -= dt;
      var P = L.player;
      if (alive(P) && s.whoosh <= 0) {
        var ddx = P.x + P.w / 2 - o.x, ddy = P.y + P.h / 2 - o.y;
        if (ddx * ddx + ddy * ddy < 64 * 64) {
          s.whoosh = 0.9;
          snd('whoosh', o.x, o.y, 0.35, 1.5);
          fx('w1.sparks', o.x, o.y, 2);
        }
      }
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L), cam = L.cam;
      if (cam && !cam.visible(s.bx, s.by, s.bw, s.bh, 16)) return;
      // track: a dashed hazard rail with bolts at the turns (where the saw will go)
      ctx.lineCap = 'round';
      if (s.track) {
        ctx.strokeStyle = rgba(p.hazard, 0.22);
        ctx.lineWidth = 2;
        ctx.setLineDash(DASH);
        ctx.beginPath();
        ctx.moveTo(s.track[0], s.track[1]);
        for (var i = 2; i < s.track.length; i += 2) ctx.lineTo(s.track[i], s.track[i + 1]);
        ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.fillStyle = rgba(p.hazard, 0.45);
        for (var j = 0; j < s.pts.length; j++) {
          AP.R.poly(ctx, s.pts[j][0], s.pts[j][1], 3, 6, 0);
          ctx.fill();
        }
      } else if (s.circ) {
        ctx.strokeStyle = rgba(p.hazard, 0.18);
        ctx.lineWidth = 1.5;
        ctx.setLineDash(DASH);
        ctx.beginPath();
        ctx.arc(s.ccx, s.ccy, s.circ.r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash(NODASH);
      }
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      if (s.circ) {
        // the arm from the pivot
        ctx.strokeStyle = rgba(p.hazard, 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.ccx, s.ccy); ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.fillStyle = p.hazard;
        AP.R.poly(ctx, s.ccx, s.ccy, 4.5, 6, s.ang * 0.2);
        ctx.fill();
      }
      var R = s.r, a = s.ang;
      AP.R.glow(ctx, cx, cy, Math.min(48, R * 1.7), p.hazard, 0.3);
      // speed arcs trailing the spin
      ctx.strokeStyle = rgba(p.hazard, 0.35);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var k = 0; k < 3; k++) {
        var a0 = a + k * TAU / 3;
        ctx.moveTo(cx + Math.cos(a0) * (R + 3), cy + Math.sin(a0) * (R + 3));
        ctx.arc(cx, cy, R + 3, a0, a0 - s.spinDir * 0.9, s.spinDir > 0);
      }
      ctx.stroke();
      // the blade: a 6-point star
      AP.R.star(ctx, cx, cy, R, R * 0.56, 6, a);
      ctx.fillStyle = rgba(p.hazard, 0.32);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = p.hazard;
      ctx.stroke();
      // inner star and hub
      AP.R.star(ctx, cx, cy, R * 0.5, R * 0.3, 6, -a * 0.5 + 0.3);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(p.ink, 0.6);
      ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.4, 0, TAU);
      ctx.fill();
    }
  });

  // exported helpers for the W1 boss and endless (read-only)
  AP.W1 = AP.W1 || {};
  AP.W1.groundPoint = groundPoint;
  AP.W1.beatPulse = beatPulse;
})(window.AP = window.AP || {});
