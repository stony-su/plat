/* js/worlds/w5/entities.js — owner: W5 */
(function (AP) {
  'use strict';

  // World 5 — Harmonic Spire. "Everything that moves, moves in time."
  // Required types (CONTRACT section 5):
  //   w5.wave       composite controller: a row of one-way segments riding a sine wave
  //                 (travelling, or standing with spec.mode 'standing' / spec.harmonic; spec.taper eases a
  //                 travelling row to rest at its ends). Riders step up onto segments up to 16u higher.
  //   w5.laser      a beam that fires on the Euclidean onsets E(k, n) of AP.Beat, with a telegraph
  //   w5.ring       a pass-through ring: refreshes double jump + dash, optional boost
  // W5 extras:
  //   w5.waveseg    one segment of a wave row (spawned by w5.wave, never placed by hand)
  //   w5.resonator  expanding hazard rings on the beat, each with a gap to slip through
  //   w5.orbiter    an orbit node circling a centre (a spirograph node)
  //   w5.pendulum   a spiked bob in simple harmonic motion, locked to the bar
  // The final boss (w5.null) and its minions live in js/worlds/w5/boss.js.

  var C = AP.C;
  var M = AP.M;
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;
  var GA = 2.399963229728653;          // golden angle (rad)
  var Ent = AP.Entities;
  var TILE = AP.TILE;

  // ---------------------------------------------------------------- helpers
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function int(v, d) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function mix(a, b, t) { return AP.Color.mix(a, b, t); }
  function palOf(L) { return (L && L.pal) || AP.R.pal('w5'); }
  function live(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn' && P.state !== 'frozen'; }
  function beatPulse() { var B = AP.Beat; var q = 1 - (B ? B.phase : 0); return q * q * q; }
  function barPhase() {
    var B = AP.Beat;
    if (!B) return 0;
    if (typeof B.barPhase === 'function') return B.barPhase();
    var x = B.beat / (B.meter || 4);
    return x - Math.floor(x);
  }
  // decaying pulse on each of k subdivisions of the bar (the 3:4:5 polyrhythm of the W5 music)
  function polyPulse(k) { var x = barPhase() * k; var q = 1 - (x - Math.floor(x)); return q * q * q; }
  function seconds() { var B = AP.Beat; return 60 / ((B && B.bpm) || 120); }
  function visibleNear(L, x, y, pad) { return !!(L && L.cam && L.cam.visible(x - 1, y - 1, 2, 2, pad || 160)); }

  // unit direction from a spec value: 'up'|'down'|'left'|'right' or degrees (0 = right, clockwise)
  var dirOut = { x: 0, y: 0 };
  function dirOf(d, def) {
    if (d === undefined || d === null) d = def;
    if (d === 'up') { dirOut.x = 0; dirOut.y = -1; }
    else if (d === 'down') { dirOut.x = 0; dirOut.y = 1; }
    else if (d === 'left') { dirOut.x = -1; dirOut.y = 0; }
    else if (d === 'right') { dirOut.x = 1; dirOut.y = 0; }
    else if (typeof d === 'number' && isFinite(d)) { dirOut.x = Math.cos(d * DEG); dirOut.y = Math.sin(d * DEG); }
    else { dirOut.x = 0; dirOut.y = 0; }
    return dirOut;
  }

  // distance from (cx, cy) to the nearest / farthest point of a box
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

  // the Euclidean pattern E(k, n) rotated by rot, exactly as AP.Beat.euclidTicked sees it
  function euclid(k, n, rot) {
    var B = AP.Beat;
    if (B && typeof B.euclidPattern === 'function') return B.euclidPattern(k, n, rot || 0);
    var out = new Uint8Array(n);
    var r = ((rot | 0) % n + n) % n;
    for (var i = 0; i < n; i++) out[i] = (((i + r) * k) % n) < k ? 1 : 0;
    return out;
  }

  // a ring of a hazard with outward spikes: the spiky silhouette reads without colour
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

  // ---------------------------------------------------------------- FX presets (w5.*)
  function fxPal() { return (AP.level && AP.level.pal) || AP.R.pal('w5'); }
  var RANGE = function (a, b) { return [a, b]; };

  // sunflower bloom: 21 motes released at golden-angle increments (Vogel's model, outward)
  var O_BLOOM = { n: 1, color: '#fff', color2: '#fff', speed: 0, angle: 0, life: RANGE(0.35, 0.6), size: RANGE(1.4, 2.6), drag: 2.6, shape: 'dot', additive: true };
  AP.FX.preset('w5.bloom', function (x, y, o) {
    var p = fxPal();
    var col = (o && o.color) || p.accent;
    var n = (o && o.n) || 21;
    var sp = (o && o.speed) || 150;
    var rot = (o && typeof o.dir === 'number') ? o.dir : 0;
    O_BLOOM.color = col; O_BLOOM.color2 = p.ink;
    var c = 0;
    for (var i = 1; i <= n; i++) {
      O_BLOOM.angle = rot + i * GA;
      O_BLOOM.speed = sp * Math.sqrt(i / n);
      c += AP.FX.emit(x, y, O_BLOOM);
    }
    return c;
  });

  // ring refresh: two rings and the bloom
  AP.FX.preset('w5.refill', function (x, y, o) {
    var p = fxPal();
    var col = (o && o.color) || p.accent;
    var r = (o && o.radius) || 44;
    AP.FX.ring(x, y, r * 0.35, r * 1.2, 0.36, col, 2.5);
    AP.FX.ring(x, y, 3, r * 0.7, 0.26, p.ink, 1.5);
    return 2 + AP.FX.burst('w5.bloom', x, y, { color: col, n: 13, speed: 170 });
  });

  // laser impact: hot streaks thrown back from the surface (o.dir = the reflection direction)
  var O_SPARK = { n: 6, color: '#fff', color2: '#fff', speed: RANGE(120, 300), angle: RANGE(0, 1), life: RANGE(0.12, 0.26), size: RANGE(3, 7), drag: 4, shape: 'line', align: true, width: 1.6, gravity: 300 };
  AP.FX.preset('w5.spark', function (x, y, o) {
    var p = fxPal();
    var d = (o && typeof o.dir === 'number') ? o.dir : -Math.PI / 2;
    O_SPARK.color = (o && o.color) || p.hazard; O_SPARK.color2 = p.ink;
    O_SPARK.angle[0] = d - 0.9; O_SPARK.angle[1] = d + 0.9;
    O_SPARK.n = (o && o.n) || 6;
    return AP.FX.emit(x, y, O_SPARK);
  });

  // charge: motes drawn inward to a point
  var O_CHARGE = { n: 1, color: '#fff', color2: '#fff', speed: 0, angle: 0, life: 0.3, size: RANGE(1.2, 2.2), shape: 'dot', drag: 0 };
  AP.FX.preset('w5.charge', function (x, y, o) {
    var p = fxPal();
    var n = (o && o.n) || 6, R0 = (o && o.radius) || 36;
    O_CHARGE.color = (o && o.color) || p.accent; O_CHARGE.color2 = p.ink;
    var c = 0;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + (AP.level ? AP.level.time * 3 : 0);
      O_CHARGE.angle = a + Math.PI;
      O_CHARGE.speed = R0 / 0.3;
      c += AP.FX.emit(x + Math.cos(a) * R0, y + Math.sin(a) * R0, O_CHARGE);
    }
    return c;
  });

  // pulse: a resonator ring leaving its core
  AP.FX.preset('w5.pulse', function (x, y, o) {
    var p = fxPal();
    var col = (o && o.color) || p.hazard;
    AP.FX.ring(x, y, 4, 34, 0.25, col, 2);
    AP.FX.ring(x, y, 2, 20, 0.18, p.ink, 1.2);
    return 2;
  });

  // fret: a wave segment rings like a plucked string when landed on
  var O_FRET = { n: 5, color: '#fff', color2: '#fff', speed: RANGE(30, 90), angle: RANGE(-Math.PI * 0.9, -Math.PI * 0.1), life: RANGE(0.25, 0.45), size: RANGE(1.2, 2.2), drag: 3, shape: 'dot', gravity: -40 };
  AP.FX.preset('w5.fret', function (x, y, o) {
    var p = fxPal();
    O_FRET.color = (o && o.color) || p.accent; O_FRET.color2 = p.primary;
    O_FRET.n = (o && o.n) || 5;
    AP.FX.ring(x, y, 2, 18, 0.2, O_FRET.color, 1.2);
    return 1 + AP.FX.emit(x, y, O_FRET);
  });

  // ================================================================ w5.waveseg (child of w5.wave)
  Ent.register('w5.waveseg', {
    kind: 'solid', oneWay: true, anchor: 'center', layer: 3, lint: 'ignore', renderPad: 40,
    size: function (spec) { return [Math.max(8, num(spec.w, 1) * 32), 12]; },
    init: function (e, spec) {
      e.s.i = int(spec.i, 0);
      e.s.lit = 0;
      e.s.disp = 0;
      e.s.ride = false;
      e.s.pluck = 0;
    },
    render: function (e, ctx, L) {
      var p = palOf(L);
      var s = e.s;
      var x = e.rx, y = e.ry, w = e.w, h = e.h;
      var lit = s.lit;
      var col = lit > 0.02 ? mix(p.primary, p.accent, Math.min(1, lit)) : p.primary;
      // body: a translucent fret block that tapers downward
      ctx.fillStyle = rgba(col, 0.13 + 0.14 * lit);
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 2); ctx.lineTo(x + w - 1, y + 2); ctx.lineTo(x + w - 4, y + h); ctx.lineTo(x + 4, y + h);
      ctx.closePath();
      ctx.fill();
      // the one-way top bar
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 1.5); ctx.lineTo(x + w - 1, y + 1.5);
      ctx.stroke();
      // harmonic tick: the displacement shows as a short vertical stroke, bright at the crest
      var d = s.disp;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(d > 0 ? p.accent : p.primary, 0.25 + 0.45 * Math.abs(d));
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + 4); ctx.lineTo(x + w / 2, y + 4 + 6 * Math.abs(d));
      ctx.stroke();
      if (s.pluck > 0.02) {
        // a plucked segment vibrates for a moment
        var a = s.pluck;
        ctx.strokeStyle = rgba(p.accent, 0.7 * a);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        var amp = 3 * a, ph = L.time * 60;
        ctx.moveTo(x + 1, y - 2);
        for (var k = 1; k <= 6; k++) ctx.lineTo(x + 1 + (w - 2) * k / 6, y - 2 + Math.sin(ph + k * 1.9) * amp * Math.sin(Math.PI * k / 6));
        ctx.stroke();
      }
    }
  });

  // ================================================================ w5.wave
  function waveN(spec) { return clamp(int(spec.n, 6), 1, 64); }
  function waveW(spec) { return clamp(num(spec.w, 1), 0.5, 8); }
  function waveGap(spec) { return clamp(num(spec.gap, 0), 0, 8); }

  function waveF(s, i, t) {
    if (s.standing) return Math.sin(s.k * s.off[i] + s.phase) * Math.cos(s.omega * t + s.tphase);
    return Math.sin(s.k * s.off[i] - s.dir * s.omega * t + s.phase) * s.env[i];
  }
  // travelling rows may ease to rest at both ends (spec.taper tiles), so they meet floors flush
  function waveEnv(off, span, taper) {
    if (!(taper > 0)) return 1;
    var k = clamp(Math.min(off, span - off) / taper, 0, 1);
    return k * k * (3 - 2 * k);
  }

  var STEP_UP = 16;                     // u: the highest one-way top a rider is lifted onto
  function waveStepUp(s, P) {
    var kids = s.kids, pb = P.y + P.h, best = 0;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.dead || !c.collidable) continue;
      var ov = Math.min(P.x + P.w, c.x + c.w) - Math.max(P.x, c.x);
      if (ov < 3) continue;
      var d = pb - c.y;                 // how far this top is above the feet
      if (d > 0.5 && d <= STEP_UP && d > best) best = d;
    }
    if (best <= 0) return;
    var up = Math.ceil(best);
    if (P.collideAt(0, -up)) return;    // a ceiling: stay put
    P.moveY(-up);
    P.yRem = 0;
    if (P.vy > 0) P.vy = 0;
  }

  Ent.register('w5.wave', {
    kind: 'sensor', anchor: 'tile', layer: 1, lint: 'stand', renderPad: 192,
    size: function (spec) {
      var n = waveN(spec), w = waveW(spec), g = waveGap(spec);
      return [Math.max(1, n * w + (n - 1) * g) * 32, 32];
    },
    // the bot sees the segments at rest: one-way stands on the spawn row (tile units)
    lintRects: function (spec, x, y) {
      var n = waveN(spec), w = waveW(spec), g = waveGap(spec), out = [];
      for (var i = 0; i < n; i++) out.push([x + i * (w + g), y, w, 0.375, 'stand']);
      return out;
    },
    init: function (e, spec, L) {
      var s = e.s;
      var n = waveN(spec), w = waveW(spec), g = waveGap(spec);
      s.n = n;
      s.amp = clamp(num(spec.amp, 1.5), 0, 6) * 32;
      s.omega = TAU / Math.max(0.25, num(spec.period, 2));
      s.phase = num(spec.phase, 0) * DEG;
      s.tphase = num(spec.tphase, 0) * DEG;
      s.dir = spec.dir === 'left' ? -1 : 1;
      var span = (n * w + (n - 1) * g) * 32;
      var harmonic = int(spec.harmonic, 0);
      s.standing = spec.mode === 'standing' || harmonic > 0;
      // a standing wave with a harmonic number is pinned at both ends of the row (a plucked string)
      s.k = (s.standing && harmonic > 0) ? harmonic * Math.PI / span : TAU / (Math.max(0.5, num(spec.wavelength, 6)) * 32);
      if (s.standing && harmonic > 0) s.phase = 0;
      s.base = e.y;
      s.span = span;
      s.off = new Float32Array(n);
      s.env = new Float32Array(n);
      s.kids = [];
      var taper = clamp(num(spec.taper, 0), 0, 16) * 32;
      for (var i = 0; i < n; i++) {
        var left = (i * (w + g)) * 32;
        s.off[i] = left + w * 16;
        s.env[i] = waveEnv(s.off[i], span, taper);
        var c = L.spawn('w5.waveseg', e.x + left + w * 16, e.y + 6, { w: w, i: i });
        if (!c) continue;
        c.parent = e;
        var top = s.base - s.amp * waveF(s, i, L.time);
        c.setPos(c.x, Math.round(top));
        c.s.disp = waveF(s, i, L.time);
        s.kids.push(c);
      }
      // the string curve drawn through the segments (allocated once)
      s.curve = new Float32Array((s.kids.length + 2) * 2);
      s.landed = null;
    },
    update: function (e, dt, L) {
      var s = e.s, kids = s.kids, t = L.time;
      var P = L.player;
      var pl = live(P);
      // Far from the player nobody can ride or be pushed by the row: its segments are placed directly
      // (cheap), and full solid physics (carry, catch, push) runs only within about 1.5 screens.
      var far = true;
      if (P) {
        var dx = Math.max(e.x - (P.x + P.w), P.x - (e.x + e.w), 0);
        var dy = Math.max(e.y - s.amp - (P.y + P.h), P.y - (e.y + e.h + s.amp), 0);
        far = dx > 900 || dy > 640;
      }
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c.dead) continue;
        var f = waveF(s, c.s.i, t);
        var top = s.base - s.amp * f;
        if (far) c.setPos(c.x, Math.round(top));
        else c.moveSolid(0, top - (c.y + c.yRem));
        c.s.disp = f;
        var riding = pl && P.isRiding(c);
        if (riding && !c.s.ride) {
          c.s.pluck = 1;
          if (P.landedOn === c) AP.FX.burst('w5.fret', P.x + P.w / 2, c.y, { n: 4 });
        }
        c.s.ride = riding;
        c.s.lit = riding ? 1 : Math.max(0, c.s.lit - dt * 2.5);
        if (c.s.pluck > 0) c.s.pluck = Math.max(0, c.s.pluck - dt * 2.2);
      }
      // Step-up: a rider, a player stepping on from a floor, or one falling onto the row follows the
      // upper envelope of the string like stairs: a segment whose top is at most STEP_UP above the feet
      // is stepped onto. Steeper parts of a fast or tall wave still have to be hopped. Never while
      // jumping or dropping through. (Levels keep a row's lowest point clear of walkways beneath it.)
      if (pl && P.vy >= 0 && P.state === 'normal' && !(P.dropT > 0)) waveStepUp(s, P);
    },
    onRemove: function (e, L) {
      var kids = e.s.kids || [];
      for (var i = 0; i < kids.length; i++) L.remove(kids[i]);
    },
    render: function (e, ctx, L) {
      var s = e.s, kids = s.kids;
      if (!kids.length) return;
      var p = palOf(L);
      var cv = s.curve, m = 0;
      var first = kids[0], last = kids[kids.length - 1];
      // string anchors one half-segment beyond each end
      cv[m++] = first.rx - 6; cv[m++] = s.base + 2;
      for (var i = 0; i < kids.length; i++) { var c = kids[i]; cv[m++] = c.rx + c.w / 2; cv[m++] = c.ry + 2; }
      cv[m++] = last.rx + last.w + 6; cv[m++] = s.base + 2;
      var b = polyPulse(s.standing ? 3 : 4);
      // the vibrating string (a quadratic spline through the segment tops)
      ctx.strokeStyle = rgba(p.primary, 0.35 + 0.2 * b);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cv[0], cv[1]);
      for (var k = 2; k < m - 2; k += 2) {
        var mx = (cv[k] + cv[k + 2]) / 2, my = (cv[k + 1] + cv[k + 3]) / 2;
        ctx.quadraticCurveTo(cv[k], cv[k + 1], mx, my);
      }
      ctx.lineTo(cv[m - 2], cv[m - 1]);
      ctx.stroke();
      // rest line (dotted) shows where the row sits on average
      ctx.strokeStyle = rgba(p.primary, 0.12);
      ctx.lineWidth = 1;
      ctx.setLineDash(DOTS);
      ctx.beginPath();
      ctx.moveTo(cv[0], s.base + 2); ctx.lineTo(cv[m - 2], s.base + 2);
      ctx.stroke();
      ctx.setLineDash(NODASH);
      // end posts
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cv[0], s.base - 8); ctx.lineTo(cv[0], s.base + 10);
      ctx.moveTo(cv[m - 2], s.base - 8); ctx.lineTo(cv[m - 2], s.base + 10);
      ctx.stroke();
      // standing waves: the still nodes of the string glow gold (safe footing)
      if (s.standing) {
        ctx.fillStyle = rgba(p.accent, 0.55 + 0.35 * b);
        for (var j = 0; j < kids.length; j++) {
          if (Math.abs(Math.sin(s.k * s.off[j] + s.phase)) < 0.2) {
            var kc = kids[j];
            AP.R.poly(ctx, kc.rx + kc.w / 2, kc.ry - 6, 3.2, 4, Math.PI / 4);
            ctx.fill();
          }
        }
      }
    }
  });
  var DOTS = [2, 5];
  var NODASH = [];
  var DASH_TELE = [7, 6];

  // ================================================================ w5.laser
  var LASER_W = 12;                      // lethal beam width (u)
  var LASER_DIRS = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

  function laserBeam(e, L) {
    var s = e.s;
    s.dirty = false;
    var tx = Math.floor(s.cx / 32), ty = Math.floor(s.cy / 32);
    var maxSteps = s.len > 0 ? Math.ceil(s.len) + 1 : 80;
    var hitTile = false;
    var steps;
    for (steps = 1; steps <= maxSteps; steps++) {
      var c = L.tileAt(tx + s.dx * steps, ty + s.dy * steps);
      if (c === TILE.SOLID || c === TILE.BREAK) { hitTile = true; break; }
      if (ty + s.dy * steps > L.h + 3) break;
    }
    // distance from the emitter to the face of the blocking tile
    var face;
    if (s.dx > 0) face = (tx + steps) * 32 - s.ex;
    else if (s.dx < 0) face = s.ex - (tx - steps + 1) * 32;
    else if (s.dy > 0) face = (ty + steps) * 32 - s.ey;
    else face = s.ey - (ty - steps + 1) * 32;
    var len = face;
    if (s.len > 0) len = Math.min(face, s.len * 32);
    s.hitWall = hitTile && (s.len <= 0 || s.len * 32 >= face);
    s.blen = Math.max(8, len);
    s.bx = s.ex + s.dx * s.blen;
    s.by = s.ey + s.dy * s.blen;
    // hitbox = the lethal part of the beam (the emitter cap is excluded)
    var x0 = s.ex + s.dx * 7, y0 = s.ey + s.dy * 7;
    var hx = Math.min(x0, s.bx), hy = Math.min(y0, s.by);
    var hw = Math.abs(s.bx - x0), hh = Math.abs(s.by - y0);
    if (s.dx === 0) { hx -= LASER_W / 2; hw = LASER_W; } else { hy -= LASER_W / 2; hh = LASER_W; }
    e.setPos(hx, hy);
    e.w = Math.max(2, hw);
    e.h = Math.max(2, hh);
  }

  function laserFire(e, L) {
    var s = e.s;
    s.fire = s.fireDur;
    s.flash = 1;
    s.shots++;
    if (visibleNear(L, s.ex, s.ey, 220) || visibleNear(L, s.bx, s.by, 220)) {
      AP.sfxAt('laser', (s.ex + s.bx) / 2, (s.ey + s.by) / 2, { vol: 0.5, pitch: 0.92 + 0.04 * (s.shots % 4) });
      if (s.hitWall) AP.FX.burst('w5.spark', s.bx, s.by, { dir: Math.atan2(-s.dy, -s.dx), n: 5 });
      AP.FX.ring(s.ex, s.ey, 3, 16, 0.16, palOf(L).hazard, 1.5);
    }
  }

  Ent.register('w5.laser', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 5, lint: 'ignore', renderPad: 48,
    init: function (e, spec, L) {
      var s = e.s;
      var d = LASER_DIRS[spec.dir] || LASER_DIRS.down;
      s.dx = d[0]; s.dy = d[1];
      var pat = Array.isArray(spec.pattern) ? spec.pattern : null;
      s.n = clamp(int(pat ? pat[1] : 8, 8), 1, 32);
      s.k = clamp(int(pat ? pat[0] : 3, 3), 0, s.n);
      s.rot = int(spec.rot, 0);
      s.len = Math.max(0, num(spec.len, 0));
      s.pat = euclid(s.k, s.n, s.rot);
      s.cx = e.x + e.w / 2;
      s.cy = e.y + e.h / 2;
      // the emitter is mounted on the back face of its tile
      s.ex = s.cx - s.dx * 14;
      s.ey = s.cy - s.dy * 14;
      s.fire = 0;
      s.fireDur = 0.2;
      s.tele = 0;
      s.wasTele = false;
      s.lastStep = -1;
      s.glow = 0;
      s.flash = 0;
      s.shots = 0;
      s.step = 0;
      s.hitWall = false;
      laserBeam(e, L);
      e.hazard = false;
      if (L && typeof L.on === 'function') L.on('tile:changed', function () { s.dirty = true; });
    },
    update: function (e, dt, L) {
      var s = e.s, B = AP.Beat;
      if (s.dirty) laserBeam(e, L);
      if (s.fire > 0) s.fire = Math.max(0, s.fire - dt);
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 5);
      var n = s.n, k = s.k;
      var meter = B.meter || 4;
      var stepDur = 60 / (B.bpm || 120) * meter / n;
      s.fireDur = clamp(stepDur * 0.8, 0.14, 0.32);
      var lead = Math.max(stepDur, 0.42);
      var sp = B.beat / meter * n;
      var cur = Math.floor(sp);
      s.step = ((cur % n) + n) % n;
      // fire on the Euclidean onsets of the bar (AP.Beat.euclidTicked); a step skipped during
      // hitstop still fires late within its own step
      var ticked = k > 0 && B.euclidTicked(k, n, s.rot);
      if (cur !== s.lastStep) {
        var onset = s.pat[s.step] === 1;
        if (onset && (ticked || (sp - cur) * stepDur < s.fireDur * 0.6)) laserFire(e, L);
        s.lastStep = cur;
      }
      // telegraph: at least one step (and at least 0.42 s) before the next onset
      var tn = 1e9;
      if (k > 0) {
        for (var j = 1; j <= n; j++) {
          if (s.pat[((cur + j) % n + n) % n] === 1) { tn = (cur + j - sp) * stepDur; break; }
        }
      }
      var tele = tn <= lead ? 1 - tn / lead : 0;
      if (tele > 0 && !s.wasTele && s.fire <= 0 && visibleNear(L, s.ex, s.ey, 120)) {
        AP.sfxAt('charge', s.ex, s.ey, { vol: 0.16, pitch: 1.3 });
        AP.FX.burst('w5.charge', s.ex + s.dx * 6, s.ey + s.dy * 6, { n: 4, radius: 22 });
      }
      s.wasTele = tele > 0;
      s.tele = tele;
      e.hazard = s.fire > 0;
      s.glow = M.approach(s.glow, s.fire > 0 ? 1 : 0, dt * (s.fire > 0 ? 30 : 7));
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      var ex = s.ex, ey = s.ey, bx = s.bx, by = s.by;
      var px = -s.dy, py = s.dx;              // perpendicular
      // telegraph: a dashed gold line that hardens as the onset approaches
      if (s.tele > 0 && s.fire <= 0) {
        var tk = s.tele;
        ctx.strokeStyle = rgba(p.accent, 0.18 + 0.62 * tk);
        ctx.lineWidth = 1 + 1.6 * tk;
        ctx.setLineDash(DASH_TELE);
        ctx.lineDashOffset = -L.time * 90;
        ctx.beginPath();
        ctx.moveTo(ex, ey); ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.lineDashOffset = 0;
        // converging brackets at the far end
        var br = 10 * (1 - tk) + 4;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx + px * br - s.dx * 6, by + py * br - s.dy * 6); ctx.lineTo(bx + px * br, by + py * br);
        ctx.moveTo(bx - px * br - s.dx * 6, by - py * br - s.dy * 6); ctx.lineTo(bx - px * br, by - py * br);
        ctx.stroke();
      }
      // the beam
      var g = s.glow;
      if (g > 0.02) {
        var hot = s.fire > 0;
        var w0 = (hot ? 16 : 10) * g;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(p.hazard, 0.35 * g);
        ctx.lineWidth = w0 + 6;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = rgba(p.hazard, 0.85 * g);
        ctx.lineWidth = w0 * 0.55;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = rgba(p.ink, 0.9 * g);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(bx, by); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        // jagged hazard edges (spiky silhouette)
        if (hot) {
          var len = s.blen, teeth = Math.max(2, Math.floor(len / 10)), ph = (L.time * 140) % 10;
          ctx.strokeStyle = p.hazard;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (var side = -1; side <= 1; side += 2) {
            for (var i = 0; i <= teeth; i++) {
              var d = Math.min(len, i * 10 + ph);
              var o = (i & 1) ? 9 : 5;
              var qx = ex + s.dx * d + px * o * side, qy = ey + s.dy * d + py * o * side;
              if (i === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
            }
          }
          ctx.stroke();
        }
        AP.R.glow(ctx, bx, by, 22 * g, p.hazard, 0.7 * g);
      }
      // emitter: a prism mount with the Euclidean wheel of its rhythm
      var b = beatPulse();
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(Math.atan2(s.dy, s.dx) - Math.PI / 2);
      ctx.fillStyle = rgba(p.primary, 0.16);
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-13, -2); ctx.lineTo(13, -2); ctx.lineTo(8, 9); ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      var wx = ex + s.dx * 3, wy = ey + s.dy * 3;
      var R = 7.5;
      for (var q = 0; q < s.n; q++) {
        var a = -Math.PI / 2 + q * TAU / s.n;
        var on = s.pat[q] === 1;
        var curq = q === s.step;
        ctx.fillStyle = curq ? p.ink : (on ? p.accent : rgba(p.primary, 0.35));
        ctx.beginPath();
        ctx.arc(wx + Math.cos(a) * R, wy + Math.sin(a) * R, curq ? 1.9 : (on ? 1.6 : 1), 0, TAU);
        ctx.fill();
      }
      var core = Math.max(s.tele, g);
      if (core > 0.02) AP.R.glow(ctx, wx, wy, 16 + 8 * core, s.fire > 0 ? p.hazard : p.accent, 0.35 + 0.5 * core);
      ctx.fillStyle = s.fire > 0 ? p.ink : mix(p.primary, p.accent, s.tele);
      ctx.beginPath();
      ctx.arc(wx, wy, 2.2 + b * 0.8 + 1.5 * s.flash, 0, TAU);
      ctx.fill();
    }
  });

  // ================================================================ w5.ring
  function ringBoostV(spec) { return Math.max(0, num(spec.boost, 0)) * 32; }

  // Boxes of the large W5 sensors stay one tile in the def (so lint's spawn-overlap check sees only
  // the anchor tile) and grow around their centre in init, for culling.
  function growBox(e, half) {
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    e.w = half * 2;
    e.h = half * 2;
    e.setPos(cx - half, cy - half);
  }

  Ent.register('w5.ring', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 4, lint: 'ignore', renderPad: 48,
    // A ring with an upward boost of at least BOUNCE_V, or a sideways boost of at least BOUNCE_SIDE_VX
    // (which lifts like a side pad, BOUNCE_SIDE_VY), is an aerial spring: the bot models it as a bounce
    // pad it can fall into (conservative: the ring also triggers when entered from below or the side).
    // Plain refresh rings are not modelled (lint 'ignore'); levels annotate the routes that need them.
    lintRects: function (spec, x, y) {
      var b = ringBoostV(spec);
      if ((spec.dir === 'up' && b >= C.BOUNCE_V) || ((spec.dir === 'left' || spec.dir === 'right') && b >= C.BOUNCE_SIDE_VX)) {
        return [[x + 0.5 - 0.75, y + 0.5 - 0.75, 1.5, 1.5, 'bounce']];
      }
      return [];
    },
    init: function (e, spec) {
      var s = e.s;
      s.r = clamp(num(spec.r, 1.5), 0.5, 4) * 32;
      growBox(e, s.r);
      s.boost = ringBoostV(spec);
      var d = dirOf(spec.dir, null);
      s.fx = d.x; s.fy = d.y;
      s.fixed = d.x !== 0 || d.y !== 0;
      s.inside = false;
      s.cool = 0;
      s.flash = 0;
      s.spin = (e.homeX * 0.37 + e.homeY * 0.11) % TAU;
      s.spinV = 0.6;
    },
    update: function (e, dt, L) {
      var s = e.s, P = L.player;
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      var inside = false;
      if (live(P)) {
        var d = boxNear(cx, cy, P.x, P.y, P.w, P.h);
        inside = d <= s.r - 6;
      }
      if (inside && !s.inside && s.cool <= 0) {
        var did = P.refresh();
        var boosted = false;
        if (s.boost > 0 && P.state !== 'orbit') {
          var vx, vy;
          if (s.fixed) {
            if (s.fx === 0) { vx = null; vy = s.fy * s.boost; }
            else { vx = s.fx * s.boost; vy = Math.min(P.vy, -C.BOUNCE_SIDE_VY); }
          } else {
            var sp = Math.sqrt(P.vx * P.vx + P.vy * P.vy);
            var ux = sp > 40 ? P.vx / sp : 0, uy = sp > 40 ? P.vy / sp : -1;
            var v = Math.max(sp, s.boost);
            vx = ux * v; vy = uy * v;
          }
          P.launch(vx, vy, { refresh: true, noCut: true, lock: (s.fixed && s.fx !== 0) ? 0.15 : 0 });
          if (s.fixed && s.fx !== 0) P.facing = s.fx > 0 ? 1 : -1;
          boosted = true;
          L.kick(s.fixed ? s.fx * 4 : 0, s.fixed ? s.fy * 4 : -3);
        }
        s.cool = 0.25;
        s.flash = 1;
        s.spinV = 9;
        AP.FX.burst('w5.refill', cx, cy, { radius: s.r });
        if (did || boosted) AP.sfxAt('refill', cx, cy, { vol: 0.8, pitch: boosted ? 1.2 : 1 });
        else AP.sfxAt('chime', cx, cy, { vol: 0.3, pitch: 1.5 });
        if (boosted) AP.sfxAt('whoosh', cx, cy, { vol: 0.5 });
      }
      s.inside = inside;
      if (s.cool > 0) s.cool -= dt;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.4);
      s.spinV += (0.6 - s.spinV) * Math.min(1, dt * 2.5);
      s.spin += s.spinV * dt;
    },
    onRespawn: function (e) { e.s.inside = false; e.s.cool = 0; },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      var r = s.r - 6;
      var f = s.flash;
      AP.R.glow(ctx, cx, cy, Math.min(48, r * 0.9), p.accent, 0.18 + 0.4 * f);
      // the 3:4:5 polyrhythm of the spire beats inside the ring as three nested pulses
      var k3 = polyPulse(3), k4 = polyPulse(4), k5 = polyPulse(5);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(p.primary, 0.12 + 0.3 * k3);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.42, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(p.primary, 0.12 + 0.3 * k4);
      AP.R.poly(ctx, cx, cy, r * 0.6, 4, s.spin * -0.5);
      ctx.stroke();
      ctx.strokeStyle = rgba(p.primary, 0.12 + 0.3 * k5);
      AP.R.poly(ctx, cx, cy, r * 0.76, 5, s.spin * 0.35);
      ctx.stroke();
      // the ring itself (gold), with eight notches
      ctx.strokeStyle = mix(p.accent, p.ink, 0.5 * f);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = s.spin + i * TAU / 8;
        ctx.moveTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5));
        ctx.lineTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
      }
      ctx.stroke();
      // boost rings show their push as chevrons
      if (s.boost > 0) {
        ctx.strokeStyle = rgba(p.ink, 0.75);
        ctx.lineWidth = 2;
        var ux = s.fixed ? s.fx : 0, uy = s.fixed ? s.fy : -1;
        var vx = -uy, vy = ux;
        var sh = (L.time * 2) % 1;
        ctx.beginPath();
        for (var c = 0; c < 2; c++) {
          var o = (c * 0.5 + sh * 0.5 - 0.35) * r * 0.9;
          var tx = cx + ux * o, ty = cy + uy * o;
          ctx.moveTo(tx - ux * 6 + vx * 7, ty - uy * 6 + vy * 7);
          ctx.lineTo(tx, ty);
          ctx.lineTo(tx - ux * 6 - vx * 7, ty - uy * 6 - vy * 7);
        }
        ctx.stroke();
      } else {
        // refresh rings: a small double-jump star and dash hexagon at the centre
        ctx.fillStyle = rgba(p.accent, 0.5 + 0.4 * beatPulse());
        AP.R.star(ctx, cx - 6, cy, 5, 2.2, 5, -Math.PI / 2);
        ctx.fill();
        ctx.strokeStyle = rgba(p.ink, 0.7);
        ctx.lineWidth = 1.5;
        AP.R.poly(ctx, cx + 6, cy, 4.5, 6, 0);
        ctx.stroke();
      }
      if (s.cool > 0) {
        ctx.strokeStyle = rgba(p.ink, s.cool * 2);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, r + 8 * (1 - s.cool * 4), 0, TAU); ctx.stroke();
      }
    }
  });

  // ================================================================ w5.resonator
  var RES_POOL = 8;
  var RES_TH = 5;                       // lethal half-thickness of a ring (u)
  var RES_CORE = 11;                    // lethal core radius (u)

  function resEmit(e, L, beatIdx) {
    var s = e.s;
    var slot = -1;
    for (var i = 0; i < RES_POOL; i++) if (!s.on[i]) { slot = i; break; }
    if (slot < 0) {
      var oldest = 0;
      for (var j = 1; j < RES_POOL; j++) if (s.rr[j] > s.rr[oldest]) oldest = j;
      slot = oldest;
    }
    s.on[slot] = 1;
    s.rr[slot] = RES_CORE;
    s.ga[slot] = s.nextGap;
    s.count++;
    s.nextGap = s.gap0 + s.spin * s.count;
    s.kick = 1;
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    if (visibleNear(L, cx, cy, s.rmax)) {
      AP.FX.burst('w5.pulse', cx, cy);
      AP.sfxAt('pulse', cx, cy, { vol: 0.45, pitch: 0.85 + 0.15 * ((beatIdx % 3) / 2) });
    }
  }

  Ent.register('w5.resonator', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 6, lint: 'ignore', renderPad: 32,
    // the bot can not time the rings; it only avoids the spiked core
    lintRects: function (spec, x, y) { return [[x + 0.5 - 0.4, y + 0.5 - 0.4, 0.8, 0.8, 'hazard']]; },
    init: function (e, spec) {
      var s = e.s;
      s.rmax = clamp(num(spec.r, 5), 1, 14) * 32;
      growBox(e, s.rmax + 16);
      s.every = Math.max(1, int(spec.every, 2));
      s.offset = int(spec.offset, 0);
      s.speed = clamp(num(spec.speed, 4), 1, 16) * 32;
      s.gapHalf = clamp(num(spec.gap, 70), 20, 300) * DEG / 2;
      var dd = spec.dir;
      var g0 = dd === 'up' ? -90 : dd === 'down' ? 90 : dd === 'left' ? 180 : dd === 'right' ? 0 : num(dd, -90);
      s.gap0 = g0 * DEG;
      s.spin = num(spec.spin, 0) * DEG;
      s.on = new Uint8Array(RES_POOL);
      s.rr = new Float32Array(RES_POOL);
      s.ga = new Float32Array(RES_POOL);
      s.count = 0;
      s.nextGap = s.gap0;
      s.lastBeat = -1;
      s.tele = 0;
      s.kick = 0;
      s.spinVis = 0;
    },
    update: function (e, dt, L) {
      var s = e.s, B = AP.Beat;
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      var bi = Math.floor(B.beat);
      if (bi !== s.lastBeat) {
        if (bi >= 0 && ((bi - s.offset) % s.every + s.every) % s.every === 0) resEmit(e, L, bi);
        s.lastBeat = bi;
      }
      // telegraph: the next ring (and where its gap will be) is shown one beat ahead
      var k = ((bi + 1 - s.offset) % s.every + s.every) % s.every === 0;
      var spb = seconds();
      var toNext = (1 - (B.beat - bi)) * spb;
      var lead = Math.max(0.42, spb);
      s.tele = (k && toNext <= lead) ? 1 - toNext / lead : 0;
      if (s.kick > 0) s.kick = Math.max(0, s.kick - dt * 4);
      s.spinVis += dt * (0.8 + 2 * s.kick);
      // rings
      var P = L.player;
      var check = live(P);
      var pcx = check ? P.x + P.w / 2 : 0, pcy = check ? P.y + P.h / 2 : 0;
      var hit = false;
      if (check && boxNear(cx, cy, P.x, P.y, P.w, P.h) <= RES_CORE) hit = true;
      for (var i = 0; i < RES_POOL; i++) {
        if (!s.on[i]) continue;
        s.rr[i] += s.speed * dt;
        if (s.rr[i] > s.rmax + 24) { s.on[i] = 0; continue; }
        if (!check || hit || s.rr[i] > s.rmax) continue;
        var rr = s.rr[i];
        var dn = boxNear(cx, cy, P.x, P.y, P.w, P.h), df = boxFar(cx, cy, P.x, P.y, P.w, P.h);
        if (dn > rr + RES_TH || df < rr - RES_TH) continue;
        // inside the band: safe only within the gap (allowing for the player's size)
        var dist = Math.max(1, Math.sqrt((pcx - cx) * (pcx - cx) + (pcy - cy) * (pcy - cy)));
        var half = Math.asin(Math.min(1, 15.6 / Math.max(15.6, dist)));
        var diff = Math.abs(M.angleDiff(Math.atan2(pcy - cy, pcx - cx), s.ga[i]));
        if (diff + half > s.gapHalf) hit = true;
      }
      if (hit) L.killPlayer('w5.resonator');
    },
    onRespawn: function (e) {
      var s = e.s;
      for (var i = 0; i < RES_POOL; i++) s.on[i] = 0;
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      // faint reach circle
      ctx.strokeStyle = rgba(p.hazard, 0.08);
      ctx.lineWidth = 1;
      ctx.setLineDash(DOTS);
      ctx.beginPath(); ctx.arc(cx, cy, s.rmax, 0, TAU); ctx.stroke();
      ctx.setLineDash(NODASH);
      // telegraph of the next ring: a gold wedge marking its gap
      if (s.tele > 0) {
        var t = s.tele;
        var g = s.nextGap;
        ctx.fillStyle = rgba(p.accent, 0.07 + 0.16 * t);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, s.rmax, g - s.gapHalf, g + s.gapHalf);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(p.accent, 0.35 + 0.5 * t);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(g - s.gapHalf) * 16, cy + Math.sin(g - s.gapHalf) * 16);
        ctx.lineTo(cx + Math.cos(g - s.gapHalf) * s.rmax, cy + Math.sin(g - s.gapHalf) * s.rmax);
        ctx.moveTo(cx + Math.cos(g + s.gapHalf) * 16, cy + Math.sin(g + s.gapHalf) * 16);
        ctx.lineTo(cx + Math.cos(g + s.gapHalf) * s.rmax, cy + Math.sin(g + s.gapHalf) * s.rmax);
        ctx.stroke();
      }
      // live rings: spiked arcs in hazard colour, gold caps at the gap
      for (var i = 0; i < RES_POOL; i++) {
        if (!s.on[i]) continue;
        var rr = s.rr[i];
        var fade = rr > s.rmax ? Math.max(0, 1 - (rr - s.rmax) / 24) : 1;
        var a0 = s.ga[i] + s.gapHalf, a1 = s.ga[i] - s.gapHalf + TAU;
        ctx.globalAlpha = fade;
        ctx.strokeStyle = p.hazard;
        ctx.lineWidth = 2;
        ctx.beginPath();
        spikyArc(ctx, cx, cy, rr - 2, a0, a1, 6, 9);
        ctx.stroke();
        ctx.strokeStyle = rgba(p.hazard, 0.3);
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1); ctx.stroke();
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr, 2.6, 0, TAU);
        ctx.arc(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr, 2.6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // the core: a spiked star (hazard) around a resonating gold heart
      var b = beatPulse();
      AP.R.glow(ctx, cx, cy, 26 + 10 * s.kick, s.tele > 0 ? p.accent : p.hazard, 0.3 + 0.4 * Math.max(s.kick, s.tele));
      ctx.fillStyle = rgba(p.hazard, 0.35);
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2;
      AP.R.star(ctx, cx, cy, 15 + 3 * s.kick, 8, 8, s.spinVis);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = mix(p.accent, p.ink, s.tele);
      ctx.beginPath(); ctx.arc(cx, cy, 3.5 + 1.5 * b, 0, TAU); ctx.fill();
      // its heart: a tiny Vogel sunflower that turns with the beat
      if (AP.Art && AP.Art.phyllo) AP.Art.phyllo(ctx, cx, cy, 13, 1.75, rgba(p.ink, 0.55 + 0.35 * s.kick), 0.75, s.spinVis);
    }
  });

  // ================================================================ w5.orbiter
  // An orbit node travelling a circle of radius r (tiles) around its spawn point. A boss may drive
  // the centre by writing e.s.cx / e.s.cy before the node updates.
  function orbiterPlace(e, t) {
    var s = e.s;
    var a = s.ph + s.sgn * TAU * (t - s.t0) / s.period;
    s.ang = a;
    e.x = s.cx + Math.cos(a) * s.r - e.w / 2;
    e.y = s.cy + Math.sin(a) * s.r - e.h / 2;
  }

  Ent.register('w5.orbiter', {
    kind: 'sensor', w: 24, h: 24, anchor: 'center', layer: 4, orbitNode: true, lint: 'orbit', renderPad: 200,
    // the circle is sampled at 8 points (like the bot's Lissajous samples)
    lintRects: function (spec, x, y) {
      var r = clamp(num(spec.r, 2.5), 0, 12), ph = num(spec.phase, 0) * DEG, out = [];
      if (r < 0.05) return [[x + 0.4, y + 0.4, 0.2, 0.2, 'orbit']];
      for (var j = 0; j < 8; j++) {
        var a = ph + j * TAU / 8;
        out.push([x + 0.5 + Math.cos(a) * r - 0.1, y + 0.5 + Math.sin(a) * r - 0.1, 0.2, 0.2, 'orbit']);
      }
      return out;
    },
    init: function (e, spec, L) {
      var s = e.s;
      s.cx = e.x + e.w / 2;
      s.cy = e.y + e.h / 2;
      s.r = clamp(num(spec.r, 2.5), 0, 12) * 32;
      s.period = Math.max(0.5, num(spec.period, 4));
      s.ph = num(spec.phase, 0) * DEG;
      s.sgn = spec.dir === 'ccw' ? -1 : 1;
      s.t0 = 0;
      s.glow = 0;
      s.ang = s.ph;
      s.fade = 1;
      orbiterPlace(e, L ? L.time : 0);
      e.px = e.x; e.py = e.y; e.rx = e.x; e.ry = e.y;
    },
    update: function (e, dt, L) {
      var s = e.s;
      orbiterPlace(e, L.time);
      var P = L.player, target = 0;
      if (P && P.orbitNode === e) target = 1;
      else if (live(P) && P.ab && P.ab.orbit) {
        var dx = P.x + P.w / 2 - (e.x + e.w / 2), dy = P.y + P.h / 2 - (e.y + e.h / 2);
        if (dx * dx + dy * dy <= C.ORBIT_RANGE * C.ORBIT_RANGE) target = 0.5;
      }
      s.glow = M.approach(s.glow, target, dt * 5);
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      var b = beatPulse();
      // its circle (dashed) and the spoke to the centre
      if (s.r > 4) {
        ctx.strokeStyle = rgba(p.accent, 0.12 * s.fade);
        ctx.lineWidth = 1;
        ctx.setLineDash(DOTS);
        ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, TAU); ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.strokeStyle = rgba(p.primary, 0.1 * s.fade);
        ctx.beginPath(); ctx.moveTo(s.cx, s.cy); ctx.lineTo(cx, cy); ctx.stroke();
      }
      if (s.glow > 0.02) {
        ctx.strokeStyle = rgba(p.accent, 0.1 + 0.12 * s.glow);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, C.ORBIT_RANGE, 0, TAU); ctx.stroke();
      }
      AP.R.glow(ctx, cx, cy, 24 + 10 * s.glow, p.accent, (0.35 + 0.45 * s.glow + 0.15 * b) * s.fade);
      ctx.globalAlpha = s.fade;
      // a spirograph rosette (hypotrochoid, 5 petals) turning with its travel
      ctx.strokeStyle = rgba(p.accent, 0.8);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      var rot = s.ang * 2;
      for (var i = 0; i <= 30; i++) {
        var u = i / 30 * TAU;
        var rx = 7.5 * Math.cos(u) + 3 * Math.cos(5 * u + rot), ry = 7.5 * Math.sin(u) - 3 * Math.sin(5 * u + rot);
        if (i === 0) ctx.moveTo(cx + rx, cy + ry); else ctx.lineTo(cx + rx, cy + ry);
      }
      ctx.stroke();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 11 + 1.5 * b, 0, TAU); ctx.stroke();
      ctx.fillStyle = s.glow > 0.6 ? p.ink : p.accent;
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  });

  // ================================================================ w5.pendulum
  // A spiked bob on a rod: simple harmonic motion with its period locked to the bar. Its swing is
  // always visible, so it needs no activation telegraph.
  var PEND_BOB = 13;                    // lethal bob radius (u)
  function pendAngle(s) {
    var B = AP.Beat;
    return s.amp * Math.sin(TAU * (B.beat / s.beats) + s.ph);
  }

  Ent.register('w5.pendulum', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 6, lint: 'ignore', renderPad: 32,
    init: function (e, spec) {
      var s = e.s;
      s.len = clamp(num(spec.len, 4), 1, 12) * 32;
      var pcx = e.x + e.w / 2, pcy = e.y + e.h / 2;
      growBox(e, s.len + 24);
      s.amp = clamp(num(spec.amp, 50), 5, 85) * DEG;
      s.beats = Math.max(1, num(spec.beats, 4));
      s.ph = num(spec.phase, 0) * DEG;
      s.px = pcx;
      s.py = pcy - 12;                    // pivot near the top of its tile
      s.a = pendAngle(s);
      s.pa = s.a;
      s.bx = s.px; s.by = s.py + s.len;
      s.spin = 0;
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.pa = s.a;
      s.a = pendAngle(s);
      s.bx = s.px + Math.sin(s.a) * s.len;
      s.by = s.py + Math.cos(s.a) * s.len;
      s.spin += (s.a - s.pa) * 6;
      var P = L.player;
      if (live(P) && boxNear(s.bx, s.by, P.x, P.y, P.w, P.h) <= PEND_BOB) L.killPlayer('w5.pendulum');
    },
    render: function (e, ctx, L) {
      var s = e.s, p = palOf(L);
      // swing arc (dotted) shows its full reach
      ctx.strokeStyle = rgba(p.hazard, 0.12);
      ctx.lineWidth = 1;
      ctx.setLineDash(DOTS);
      ctx.beginPath(); ctx.arc(s.px, s.py, s.len, Math.PI / 2 - s.amp, Math.PI / 2 + s.amp); ctx.stroke();
      ctx.setLineDash(NODASH);
      // pivot
      ctx.fillStyle = rgba(p.primary, 0.25);
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      AP.R.poly(ctx, s.px, s.py, 6, 6, 0);
      ctx.fill(); ctx.stroke();
      // rod
      ctx.strokeStyle = rgba(p.primary, 0.8);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(s.bx, s.by); ctx.stroke();
      // ghost of the previous swing positions (motion read)
      var bx = s.bx, by = s.by;
      var gx = s.px + Math.sin(s.pa * 2 - s.a) * s.len, gy = s.py + Math.cos(s.pa * 2 - s.a) * s.len;
      ctx.strokeStyle = rgba(p.hazard, 0.25);
      ctx.lineWidth = 1.5;
      AP.R.star(ctx, gx, gy, 15, 8, 7, s.spin - 0.3);
      ctx.stroke();
      // the bob: a spiked star
      AP.R.glow(ctx, bx, by, 26, p.hazard, 0.35);
      ctx.fillStyle = rgba(p.hazard, 0.45);
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2;
      AP.R.star(ctx, bx, by, 17, 9, 7, s.spin);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.beginPath(); ctx.arc(bx, by, 3 + 1.2 * beatPulse(), 0, TAU); ctx.fill();
    }
  });

})(window.AP = window.AP || {});
