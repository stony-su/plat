/* js/worlds/w3/entities.js — owner: W3 */
(function (AP) {
  'use strict';

  // W3 — The Currents. The art is the mechanic: every force in this world is read from AP.Flow, and
  // every streamline, particle, streamer and tail drawn here samples the SAME params at the SAME L.time.
  //
  //   w3.wind     wind zone. P.addForce(AP.Flow.force(...)); its streamlines, chevrons and particles are
  //               traced with AP.Flow.streamline / AP.Flow.sample from the same params and L.time.
  //               mode 'steady' | 'gust' (pulses; the streamlines brighten before each gust) | 'reverse'.
  //   w3.drift    one-way raft advected by the flow on a spring leash: it settles downstream in a steady current,
  //               circles the eye of an eddy, and ferries across when a current reverses.
  //   w3.kite     one-way kite that sways on its tether; land on it holding {down} to stomp it: it flings
  //               you high (a kite bounce).
  //   w3.drifter  spiky seed that rides the streamlines (hazard), gusting and reversing with its current; stomp it,
  //               pop it with the pentagram burst of the double jump, or dash through it. Level drifters re-form
  //               at home after a pop.
  //
  // Spec units (CONTRACT §0): tiles, tiles/s, tiles/s², seconds, degrees. `flow` is an AP.Flow.fromSpec
  // object merged over the level-wide `flow`. Boss hook: a wind's e.s.ext (default 1) scales its force and
  // its art together (w3.maelstrom flips its lifts with it).

  var C = AP.C;
  var M = AP.M;
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;
  var STEP = C.STEP;

  // module scratch (no allocation in hot paths)
  var S = { x: 1, y: 0, m: 0 };
  var S2 = { x: 1, y: 0, m: 0 };
  var F = { x: 0, y: 0 };
  var V = { x: 0, y: 0 };

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function pal(L) { return (L && L.pal) || AP.Worlds.pal('w3'); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  // colour mix quantised to 1/32 and cached (no string churn in render loops)
  var MIXC = {};
  function mix(a, b, t) {
    var q = Math.round(M.clamp(t, 0, 1) * 32);
    var ta = MIXC[a] || (MIXC[a] = {});
    var tab = ta[b] || (ta[b] = []);
    return tab[q] || (tab[q] = AP.Color.mix(a, b, q / 32));
  }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }
  function sm(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; return Math.pow(1 - ph, 3); }
  function seedOf(e, salt) { return (AP.hash2((e.homeX | 0) + 7919, (e.homeY | 0) + 104729, salt | 0) >>> 0); }

  // ------------------------------------------------------------------ flow params
  // spec.flow (spec units) merged over the level-wide def.flow, then AP.Flow.fromSpec. Every W3 entity calls
  // this ONCE in init and keeps the params: physics and art then read the very same object.
  var FLOW_KEYS = ['seed', 'scale', 'tscale', 'angle', 'spread', 'mmin', 'swirl'];
  function flowParams(spec, L) {
    var base = L && L.def && L.def.flow;
    var own = spec && spec.flow;
    var out = {};
    var i, k;
    if (base && typeof base === 'object') for (i = 0; i < FLOW_KEYS.length; i++) { k = FLOW_KEYS[i]; if (base[k] !== undefined) out[k] = base[k]; }
    if (own && typeof own === 'object') for (i = 0; i < FLOW_KEYS.length; i++) { k = FLOW_KEYS[i]; if (own[k] !== undefined) out[k] = own[k]; }
    return AP.Flow.fromSpec(out);
  }

  // ------------------------------------------------------------------ cycles (gust / reverse)
  // s.env: signed strength multiplier; s.glow: streamline intensity 0..1 (the telegraph); s.warn: 0..1 warning
  // ramp before a gust / a reversal (always >= 0.5 s, CONTRACT §2.8 asks >= 0.4 s).
  function cycleInit(s, spec) {
    var md = spec && spec.mode;
    s.mode = md === 'gust' ? 1 : (md === 'reverse' ? 2 : 0);
    s.period = Math.max(1.2, num(spec && spec.period, s.mode === 2 ? 6 : 4));
    s.duty = M.clamp(num(spec && spec.duty, 0.4), 0.1, 0.85);
    s.cph = num(spec && spec.phase, 0) / 360;
    s.calm = M.clamp(num(spec && spec.calm, 0.1), 0, 1);
    s.tel = M.clamp(num(spec && spec.tel, 0.75), 0.5, s.period * 0.45);
    s.env = 1; s.glow = 0; s.warn = 0; s.gusting = false; s.sign = 1;
  }
  function cycle(s, t) {
    if (s.mode === 0) { s.env = 1; s.glow = 0.25; s.warn = 0; s.gusting = true; s.sign = 1; return 1; }
    var P = s.period;
    var u = t / P + s.cph;
    u -= Math.floor(u);
    var tc = u * P;
    if (s.mode === 1) {
      var on = s.duty * P;
      if (tc < on) {
        var a = sm(tc / 0.14) * sm((on - tc) / 0.28);
        s.env = s.calm + (1 - s.calm) * a;
        s.glow = 0.55 + 0.45 * a;
        s.warn = 0;
        s.gusting = true;
      } else {
        var lead = tc - (P - s.tel);
        var w = lead > 0 ? sm(lead / s.tel) : 0;
        s.env = s.calm;
        s.warn = w;
        s.glow = 0.12 + 0.7 * w;
        s.gusting = false;
      }
      s.sign = 1;
      return s.env;
    }
    // reverse: a flattened cosine; it crosses zero at u = 0.25 and 0.75
    var c = Math.cos(TAU * u);
    var env = c * 2.4;
    env = env > 1 ? 1 : (env < -1 ? -1 : env);
    var toCross = (0.25 - u) % 0.5;
    if (toCross < 0) toCross += 0.5;
    var secs = toCross * P;
    var wr = secs < s.tel ? 1 - secs / s.tel : 0;
    s.env = env;
    s.warn = wr;
    s.glow = 0.3 + 0.5 * wr * (0.5 + 0.5 * Math.sin(t * 26)) + 0.2 * Math.abs(env);
    s.gusting = Math.abs(env) > 0.5;
    s.sign = env >= 0 ? 1 : -1;
    return env;
  }

  // ------------------------------------------------------------------ FX presets ('w3.*')
  var FXO = {};
  function fxReset() {
    FXO.n = 8; FXO.color = undefined; FXO.color2 = undefined; FXO.speed = undefined; FXO.angle = undefined; FXO.life = undefined;
    FXO.size = undefined; FXO.sizeEnd = undefined; FXO.gravity = 0; FXO.drag = 0; FXO.shape = 'dot'; FXO.spin = undefined;
    FXO.additive = true; FXO.back = false; FXO.spread = 0; FXO.rot = undefined; FXO.width = 2; FXO.align = false;
    return FXO;
  }
  function fxPal() { return (AP.level && AP.level.pal) || AP.Worlds.pal('w3'); }
  var R2 = [0, 0], R3 = [0, 0], R4 = [0, 0], R5 = [0, 0], R6 = [0, 0];
  function rng2(arr, a, b) { arr[0] = a; arr[1] = b; return arr; }

  // a drifter popping: hazard star shards, a puff of ink motes and a ring
  AP.FX.preset('w3.pop', function (x, y, o) {
    var p = fxPal();
    var n = 0;
    var c = (o && o.color) || p.hazard;
    var e = fxReset();
    e.n = 9; e.color = c; e.color2 = p.ink; e.shape = 'tri'; e.speed = rng2(R2, 90, 260); e.life = rng2(R3, 0.25, 0.5);
    e.size = rng2(R4, 2.5, 4.5); e.sizeEnd = 0; e.drag = 3; e.spin = rng2(R5, -9, 9);
    n += AP.FX.emit(x, y, e);
    e = fxReset();
    e.n = 10; e.color = p.ink; e.color2 = p.primary; e.speed = rng2(R2, 30, 120); e.life = rng2(R3, 0.3, 0.7); e.size = rng2(R4, 1.5, 3);
    e.drag = 2.5; e.spread = 6;
    n += AP.FX.emit(x, y, e);
    AP.FX.ring(x, y, 4, 34, 0.32, c, 2);
    return n;
  });

  // a drifter re-forming: motes converging from a ring onto its centre
  AP.FX.preset('w3.form', function (x, y, o) {
    var p = fxPal();
    var r = (o && o.radius) || 28;
    var n = (o && o.n) || 7;
    var c = 0;
    var e = fxReset();
    e.n = 1; e.color = p.hazard; e.color2 = p.ink; e.life = 0.36; e.size = rng2(R4, 1.4, 2.4); e.sizeEnd = 0.4; e.shape = 'dot';
    var a0 = AP.Beat ? AP.Beat.beat * 1.7 : 0;
    for (var i = 0; i < n; i++) {
      var a = a0 + i * TAU / n;
      e.angle = a + Math.PI + 0.35;
      e.speed = r / 0.36;
      c += AP.FX.emit(x + Math.cos(a) * r, y + Math.sin(a) * r, e);
    }
    return c;
  });

  // gust streaks along a direction (o.dir radians)
  AP.FX.preset('w3.gust', function (x, y, o) {
    var p = fxPal();
    var d = (o && typeof o.dir === 'number') ? o.dir : 0;
    var e = fxReset();
    e.n = (o && o.n) || 6; e.color = p.ink; e.color2 = p.primary; e.shape = 'line'; e.align = true; e.width = 1.5;
    e.angle = rng2(R2, d - 0.12, d + 0.12); e.speed = rng2(R3, 220, 420); e.life = rng2(R4, 0.25, 0.45);
    e.size = rng2(R5, 6, 12); e.sizeEnd = -1; e.drag = 1.2; e.spread = (o && o.spread) || 18;
    return AP.FX.emit(x, y, e);
  });

  // kite bounce: accent streaks flying up, ribbon triangles fluttering down
  AP.FX.preset('w3.kite', function (x, y, o) {
    var p = fxPal();
    var n = 0;
    var e = fxReset();
    e.n = 10; e.color = p.accent; e.color2 = p.ink; e.shape = 'line'; e.align = true; e.width = 2;
    e.angle = rng2(R2, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); e.speed = rng2(R3, 260, 520); e.life = rng2(R4, 0.22, 0.4);
    e.size = rng2(R5, 6, 11); e.sizeEnd = 1; e.drag = 2;
    n += AP.FX.emit(x, y, e);
    e = fxReset();
    e.n = 7; e.color = p.accent; e.color2 = p.primary; e.shape = 'tri'; e.angle = rng2(R2, 0, TAU); e.speed = rng2(R3, 40, 140);
    e.life = rng2(R4, 0.5, 0.9); e.size = rng2(R5, 2, 3.5); e.sizeEnd = 0.5; e.gravity = 260; e.drag = 1.5; e.spin = rng2(R6, -6, 6);
    n += AP.FX.emit(x, y, e);
    AP.FX.ring(x, y, 6, 46, 0.3, p.accent, 2);
    return n;
  });

  // soft puff of air (raft landing, gust start inside a zone)
  AP.FX.preset('w3.puff', function (x, y, o) {
    var p = fxPal();
    var e = fxReset();
    var d = (o && typeof o.dir === 'number') ? o.dir : -Math.PI / 2;
    e.n = (o && o.n) || 6; e.color = p.ink; e.color2 = p.primary; e.angle = rng2(R2, d - 1.1, d + 1.1); e.speed = rng2(R3, 30, 110);
    e.life = rng2(R4, 0.3, 0.6); e.size = rng2(R5, 1.5, 3); e.sizeEnd = 0; e.drag = 2.5; e.spread = 8;
    return AP.FX.emit(x, y, e);
  });

  // ------------------------------------------------------------------ wind loop (one per level, loudest zone wins)
  var loopL = null, loopStep = -1, loopAcc = 0, loopSent = -1;
  function windLoop(L, vol) {
    if (loopL !== L) { loopL = L; loopStep = L.stepN; loopAcc = 0; loopSent = -1; }
    if (loopStep !== L.stepN) {
      if (Math.abs(loopAcc - loopSent) > 0.015) { loopSent = loopAcc; AP.call('Audio.setLoop', 'wind', loopAcc); }
      loopStep = L.stepN;
      loopAcc = 0;
    }
    if (vol > loopAcc) loopAcc = vol;
  }

  // ================================================================== w3.wind
  var WIND_STEP = 12;           // streamline integration step (u)
  var WIND_TAIL = 0.055;        // particle streak length (s of travel)

  function windArea(e) { return (e.w / 32) * (e.h / 32); }

  function windSpawnParticle(e, i, fresh) {
    var s = e.s, r = s.rng;
    s.px[i] = e.x + r.next() * e.w;
    s.py[i] = e.y + r.next() * e.h;
    s.pl[i] = 0.8 + r.next() * 1.6;
    s.pa[i] = fresh ? r.next() * s.pl[i] : 0;
    s.pk[i] = 0.65 + r.next() * 0.7;
    s.pvx[i] = 0; s.pvy[i] = 0;
  }
  function windSpawnLine(e, j, fresh) {
    var s = e.s, r = s.rng;
    // stratified seeds: walk the cells of a coarse grid so lines cover the whole zone
    var cols = s.gcols, rows = s.grows;
    var cell = s.gnext % (cols * rows);
    s.gnext = (s.gnext + 7) % 9973;
    var gx = cell % cols, gy = (cell / cols) | 0;
    s.lx[j] = e.x + (gx + 0.15 + 0.7 * r.next()) * e.w / cols;
    s.ly[j] = e.y + (gy + 0.15 + 0.7 * r.next()) * e.h / rows;
    s.ll[j] = 1.4 + r.next() * 1.4;
    s.la[j] = fresh ? r.next() * s.ll[j] : 0;
  }

  AP.Entities.register('w3.wind', {
    kind: 'sensor', anchor: 'tile', layer: 0, behindTiles: true, lint: 'ignore', required: ['w', 'h'], renderPad: 40,
    size: function (spec) { return [Math.max(1, num(spec.w, 4)) * 32, Math.max(1, num(spec.h, 4)) * 32]; },
    init: function (e, spec, L) {
      var s = e.s;
      s.p = flowParams(spec, L);
      s.str = Math.max(0, num(spec.strength, 40)) * 32;          // u/s² at m = 1
      s.cap = Math.max(2, num(spec.speed, 16)) * 32;             // the wind's own speed (drag cap), u/s
      s.ext = 1;                                                 // external multiplier (boss)
      s.vis = 40 + 0.085 * s.str;                                // visual drift speed of particles (u/s at m = 1)
      cycleInit(s, spec);
      cycle(s, L ? L.time : 0);
      s.prevGust = s.gusting;
      s.prevSign = s.sign;
      s.rng = AP.RNG(seedOf(e, 31));
      var area = windArea(e);
      var n = M.clamp(Math.round(area * 1.0), 8, 48);
      s.n = n;
      s.px = new Float32Array(n); s.py = new Float32Array(n); s.pa = new Float32Array(n); s.pl = new Float32Array(n);
      s.pk = new Float32Array(n); s.pvx = new Float32Array(n); s.pvy = new Float32Array(n);
      for (var i = 0; i < n; i++) windSpawnParticle(e, i, true);
      var k = M.clamp(Math.round(area / 14), 2, 8);
      s.k = k;
      s.gcols = Math.max(1, Math.round(e.w / Math.sqrt(e.w * e.h / k)));
      s.grows = Math.max(1, Math.ceil(k / s.gcols));
      s.gnext = (s.rng.next() * 97) | 0;
      s.npt = M.clamp(Math.round(Math.max(e.w, e.h) * 0.45 / WIND_STEP), 8, 26);
      s.lx = new Float32Array(k); s.ly = new Float32Array(k); s.la = new Float32Array(k); s.ll = new Float32Array(k);
      for (var j = 0; j < k; j++) windSpawnLine(e, j, true);
      s.buf = new Float32Array(s.npt * 2);
      s.near = false;
      s.touchT = 0;
      s.flash = 0;
    },
    update: function (e, dt, L) {
      var s = e.s;
      var env = cycle(s, L.time) * s.ext;
      var P = L.player;
      // sound: the loudest zone near the player drives the 'wind' loop; a gust onset / reversal whooshes
      var dist = 9999;
      if (P) {
        var pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
        var qx = M.clamp(pcx, e.x, e.x + e.w), qy = M.clamp(pcy, e.y, e.y + e.h);
        dist = Math.sqrt((pcx - qx) * (pcx - qx) + (pcy - qy) * (pcy - qy));
        var prox = dist <= 0 ? 1 : M.clamp(1 - dist / 420, 0, 1);
        var loud = Math.min(1, s.str / 2600) * 0.45 + 0.2;
        windLoop(L, prox * prox * loud * (0.35 + 0.65 * Math.abs(env)));
      }
      if (s.mode === 1 && s.gusting && !s.prevGust) {
        s.flash = 1;
        if (dist < 520) {
          AP.sfxAt('gust', e.x + e.w / 2, e.y + e.h / 2, { vol: 0.5 + 0.4 * Math.min(1, s.str / 2600), pitch: 0.9 + 0.2 * s.rng.next() });
          AP.FX.burst('w3.puff', M.clamp(P ? P.x + P.w / 2 : e.x, e.x, e.x + e.w), M.clamp(P ? P.y + P.h / 2 : e.y, e.y, e.y + e.h), { n: 5 });
        }
      } else if (s.mode === 2 && s.sign !== s.prevSign) {
        s.flash = 1;
        if (dist < 520) AP.sfxAt('whoosh', e.x + e.w / 2, e.y + e.h / 2, { vol: 0.55, pitch: s.sign > 0 ? 0.8 : 0.65 });
      }
      s.prevGust = s.gusting;
      s.prevSign = s.sign;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.2);
      if (s.touchT > 0) s.touchT -= dt;
      // art state advances only while the zone is near the view (updates are never culled; this one is cheap),
      // at 60 Hz (every other fixed step, with twice the step): the particles are art, the force is exact every step
      s.near = !!(L.cam && L.cam.visible(e.x, e.y, e.w, e.h, 96));
      if (!s.near || ((L.stepN + e.id) & 1)) return;
      dt *= 2;
      var t = L.time, p = s.p, vis = s.vis * env;
      var x0 = e.x - 10, y0 = e.y - 10, x1 = e.x + e.w + 10, y1 = e.y + e.h + 10;
      for (var i = 0; i < s.n; i++) {
        AP.Flow.sample(s.px[i], s.py[i], t, p, S);
        var sp = vis * S.m * s.pk[i];
        var vx = S.x * sp, vy = S.y * sp;
        s.px[i] += vx * dt; s.py[i] += vy * dt;
        s.pvx[i] = vx; s.pvy[i] = vy;
        s.pa[i] += dt;
        if (s.pa[i] > s.pl[i] || s.px[i] < x0 || s.px[i] > x1 || s.py[i] < y0 || s.py[i] > y1) windSpawnParticle(e, i, false);
      }
      // streamline seeds drift downstream (slower than the particles) so the lines themselves flow
      for (var j = 0; j < s.k; j++) {
        AP.Flow.sample(s.lx[j], s.ly[j], t, p, S);
        var ls = vis * 0.45 * S.m;
        s.lx[j] += S.x * ls * dt; s.ly[j] += S.y * ls * dt;
        s.la[j] += dt;
        if (s.la[j] > s.ll[j] || s.lx[j] < x0 || s.lx[j] > x1 || s.ly[j] < y0 || s.ly[j] > y1) windSpawnLine(e, j, false);
      }
    },
    // the force: exactly AP.Flow.force at the player's centre with this zone's params and L.time, scaled by the
    // cycle and by air drag (the wind cannot push you faster than it blows; an updraft also catches a falling
    // player: up to 2x when moving against an upward wind). Headwinds never exceed strength·m.
    onTouch: function (e, P, L) {
      if (P.state !== 'normal') return;
      var s = e.s;
      var amp = s.env * s.ext;
      if (amp === 0 || s.str === 0) return;
      AP.Flow.force(P.x + P.w / 2, P.y + P.h / 2, L.time, s.p, s.str * amp, F);
      var fm = Math.sqrt(F.x * F.x + F.y * F.y);
      if (fm < 1e-6) return;
      var ux = F.x / fm, uy = F.y / fm;
      var along = P.vx * ux + P.vy * uy;
      var kmax = 1 + (uy < 0 ? -uy : 0);
      var k = 1 - along / s.cap;
      k = k < 0 ? 0 : (k > kmax ? kmax : k);
      P.addForce(F.x * k, F.y * k);
      s.touchT = 0.25;
    },
    onRespawn: function (e) { e.s.flash = 0; },
    render: function (e, ctx, L) {
      var s = e.s;
      if (!s.near) return;
      var p = pal(L);
      var t = L.time;
      var env = s.env * s.ext;
      var aenv = Math.abs(env);
      var ext = Math.min(1, Math.abs(s.ext));
      if (aenv < 0.01 && s.flash <= 0 && s.warn <= 0) return;      // a silenced zone draws nothing (boss winds)
      var glow = M.clamp(Math.max(s.glow * ext, s.flash) + (s.touchT > 0 ? 0.12 * ext : 0), 0, 1);
      ctx.beginPath();
      ctx.rect(e.x, e.y, e.w, e.h);
      ctx.clip();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // ---- streamlines: traced now (RK2, AP.Flow.streamline) from the drifting seeds along the wind, with the same
      // params and L.time as the force
      var dirSign = env >= 0 ? 1 : -1;
      var lineCol = mix(p.primary, p.ink, 0.2 + 0.65 * glow);
      var lw = 1.1 + 1.4 * glow;
      var buf = s.buf, npt = s.npt;
      var chevA = 0;
      for (var j = 0; j < s.k; j++) {
        var life = s.la[j] / s.ll[j];
        var fade = Math.sin(Math.PI * M.clamp(life, 0, 1));
        var a = fade * (0.07 * ext + 0.2 * aenv + 0.5 * glow) * (s.mode === 2 ? 0.6 + 0.4 * aenv : 1);
        if (a < 0.02) continue;
        AP.Flow.streamline(s.lx[j], s.ly[j], t, s.p, WIND_STEP * dirSign, npt, buf);
        ctx.globalAlpha = a;
        ctx.strokeStyle = lineCol;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(buf[0], buf[1]);
        for (var q = 1; q < npt; q++) ctx.lineTo(buf[q * 2], buf[q * 2 + 1]);
        ctx.stroke();
        // sliding chevrons show the direction and the speed of the air (they reverse with the wind)
        chevA = a * (0.8 + 0.6 * glow);
        var speed = (s.vis * 0.5) * (0.3 + aenv);
        var span = (npt - 1) * WIND_STEP;
        for (var c = 0; c < 2; c++) {
          var d = (t * speed + c * span * 0.5 + j * 37) % span;
          var fi = d / WIND_STEP, i0 = Math.floor(fi);
          if (i0 >= npt - 1) continue;
          var fr = fi - i0;
          var ax = buf[i0 * 2], ay = buf[i0 * 2 + 1], bx2 = buf[i0 * 2 + 2], by2 = buf[i0 * 2 + 3];
          var cxp = ax + (bx2 - ax) * fr, cyp = ay + (by2 - ay) * fr;
          var dx = bx2 - ax, dy = by2 - ay;                 // the trace runs with the wind
          var dl = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= dl; dy /= dl;
          var sz = 4 + 2.5 * glow;
          ctx.globalAlpha = Math.min(1, chevA * (0.8 + 0.5 * Math.sin(Math.PI * (d / span))));
          ctx.strokeStyle = glow > 0.7 ? mix(p.ink, p.accent, (glow - 0.7) * 2) : p.ink;
          ctx.lineWidth = 1.4 + glow;
          ctx.beginPath();
          ctx.moveTo(cxp - dx * sz - dy * sz * 0.8, cyp - dy * sz + dx * sz * 0.8);
          ctx.lineTo(cxp, cyp);
          ctx.lineTo(cxp - dx * sz + dy * sz * 0.8, cyp - dy * sz - dx * sz * 0.8);
          ctx.stroke();
        }
      }
      // ---- particles: streaks along their (flow) velocity; one in seven is a gold mote (still air: no streaks)
      if (aenv < 0.04) { ctx.globalAlpha = 1; return; }
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = p.ink;
      for (var pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = (pass ? 0.55 : 0.24) * (0.45 + 0.55 * Math.max(aenv, glow * 0.6));
        ctx.lineWidth = pass ? 1.6 : 1.1;
        ctx.beginPath();
        for (var i = 0; i < s.n; i++) {
          if ((i % 7) === 3) continue;
          var lf = s.pa[i] / s.pl[i];
          var fd = Math.min(lf * 5, (1 - lf) * 3);
          if ((fd > 0.55) !== (pass === 1)) continue;
          var x = s.px[i], y = s.py[i];
          var tl = WIND_TAIL * (1 + glow);
          ctx.moveTo(x, y);
          ctx.lineTo(x - s.pvx[i] * tl, y - s.pvy[i] * tl);
        }
        ctx.stroke();
      }
      ctx.fillStyle = p.accent;
      ctx.globalAlpha = (0.5 + 0.4 * glow) * Math.min(1, aenv * 2);
      ctx.beginPath();
      for (var g = 3; g < s.n; g += 7) {
        var lg = s.pa[g] / s.pl[g];
        if (lg < 0.08 || lg > 0.92) continue;
        ctx.moveTo(s.px[g] + 1.6, s.py[g]);
        ctx.arc(s.px[g], s.py[g], 1.6, 0, TAU);
      }
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  });

  // ================================================================== w3.drift
  // A one-way raft carried by the flow on a spring leash. The raft is a body advected by the flow velocity at its
  // centre (dir·m·speed, the same AP.Flow params the zones draw) and pulled home by a damped spring: in a steady
  // current it settles `leash` tiles downstream of home (at m = 1); in an eddy it circulates around home; when the
  // current reverses (mode 'reverse') it ferries to the other side. spec: w 3, leash 3, speed 3 (tiles/s, the
  // current's speed at m = 1), springPeriod 3.4 (s), mode/period/duty/phase/tel as w3.wind, flow {}.
  function driftSettle(e, s, L, t) {
    // start on the current's equilibrium so the raft does not lurch when the level starts
    AP.Flow.sample(s.hx + e.w / 2, s.hy + 6, t, s.p, S);
    var env = cycle(s, t);
    s.ox = S.x * S.m * env * s.leash;
    s.oy = S.y * S.m * env * s.leash;
    s.vx = 0; s.vy = 0;
  }
  AP.Entities.register('w3.drift', {
    kind: 'solid', oneWay: true, anchor: 'tile', layer: 2, lint: 'stand', renderPad: 140,
    size: function (spec) { return [Math.max(1, num(spec.w, 3)) * 32, 12]; },
    init: function (e, spec, L) {
      var s = e.s;
      s.p = flowParams(spec, L);
      s.leash = Math.max(0, num(spec.leash, 3)) * 32;
      s.spd = Math.max(0.5, num(spec.speed, 3)) * 32;
      var om = TAU / Math.max(0.8, num(spec.springPeriod, 3.4));
      s.kk = om * om;                                  // spring stiffness (1/s²)
      s.cc = s.leash * s.kk / s.spd;                   // flow coupling: uniform current at m = 1 -> leash offset
      s.gam = 0.45 * om;                               // damping
      cycleInit(s, spec);
      s.ox = 0; s.oy = 0; s.vx = 0; s.vy = 0;
      s.sag = 0; s.sagV = 0; s.riding = false;
      s.bob = (seedOf(e, 5) % 628) / 100;
      s.fx = 1; s.fy = 0; s.fm = 0;
      s.land = 0;
      s.hx = e.homeX; s.hy = e.homeY;
      driftSettle(e, s, L, L ? L.time : 0);
      e.setPos(Math.round(s.hx + s.ox), Math.round(s.hy + s.oy));
    },
    update: function (e, dt, L) {
      var s = e.s;
      AP.Flow.sample(s.hx + s.ox + e.w / 2, s.hy + s.oy + 6, L.time, s.p, S);
      var env = cycle(s, L.time);
      s.fx = S.x; s.fy = S.y; s.fm = S.m * env;
      var ux = S.x * S.m * env * s.spd, uy = S.y * S.m * env * s.spd;
      s.vx += (s.cc * (ux - s.vx) - s.kk * s.ox - s.gam * s.vx) * dt;
      s.vy += (s.cc * (uy - s.vy) - s.kk * s.oy - s.gam * s.vy) * dt;
      s.ox += s.vx * dt;
      s.oy += s.vy * dt;
      var d = Math.sqrt(s.ox * s.ox + s.oy * s.oy), lim = s.leash + 16;
      if (d > lim) {
        s.ox *= lim / d; s.oy *= lim / d;
        var rv = (s.vx * s.ox + s.vy * s.oy) / lim;
        if (rv > 0) { s.vx -= rv * s.ox / lim; s.vy -= rv * s.oy / lim; }
      }
      // rider weight: a landing pushes the raft down, a rider keeps it sagging a little
      var P = L.player;
      var riding = alive(P) && P.isRiding(e);
      if (riding && !s.riding) {
        var imp = (P.landedOn === e && P.landedT <= dt * 1.5) ? (P.lastLandVy || 0) : 60;
        s.sagV += M.clamp(imp * 0.32, 25, 240);
        if (imp > 300) { s.land = 1; AP.FX.burst('w3.puff', P.x + P.w / 2, e.y + 10, { n: 5, dir: Math.PI / 2 }); }
      }
      s.riding = riding;
      s.sagV += (((riding ? 5 : 0) - s.sag) * 150 - s.sagV * 13) * dt;
      s.sag += s.sagV * dt;
      if (s.land > 0) s.land = Math.max(0, s.land - dt * 3);
      var bob = Math.sin(L.time * 1.7 + s.bob) * 2.5;
      var nx = s.hx + s.ox, ny = s.hy + s.oy + s.sag + bob;
      var mx = nx - (e.x + e.xRem), my = ny - (e.y + e.yRem);
      e.moveSolid(mx, my);
      e.vx = mx / dt;
      e.vy = my / dt;
    },
    // the raft's motion is the current's (continuous in L.time); only the rider's weight is reset
    onRespawn: function (e) { var s = e.s; s.riding = false; s.sagV = 0; s.sag = 0; s.land = 0; },
    render: function (e, ctx, L) {
      var s = e.s;
      var p = pal(L);
      var x = e.rx, y = e.ry, w = e.w;
      var cx = x + w / 2;
      var hx = s.hx + w / 2, hy = s.hy + 6;
      var stretch = s.leash > 0 ? M.clamp(Math.sqrt(s.ox * s.ox + s.oy * s.oy) / s.leash, 0, 1) : 0;
      // the spring leash: a dashed line to the home anchor (a small hollow pentagon)
      ctx.strokeStyle = rgba(p.primary, 0.16 + 0.3 * stretch);
      ctx.lineWidth = 1;
      ctx.setLineDash(DASH_LEASH);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(cx, y + 8);
      ctx.stroke();
      ctx.setLineDash(NODASH);
      ctx.strokeStyle = rgba(p.primary, 0.3);
      AP.R.poly(ctx, hx, hy, 3.5, 5, -Math.PI / 2);
      ctx.stroke();
      // streamers trailing downstream (the same flow sample that moves the raft)
      var fx = s.fx * (s.fm >= 0 ? 1 : -1), fy = s.fy * (s.fm >= 0 ? 1 : -1);
      var fl = 10 + 26 * Math.abs(s.fm);
      var tail = fx >= 0 ? x + 3 : x + w - 3;
      var t = L.time;
      ctx.strokeStyle = rgba(p.ink, 0.35);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var k = 0; k < 2; k++) {
        var oy = y + 4 + k * 5;
        var wv = Math.sin(t * 7 + k * 1.7 + s.bob) * 3;
        ctx.moveTo(tail, oy);
        ctx.quadraticCurveTo(tail - fx * fl * 0.5 - fy * wv, oy - fy * fl * 0.5 + fx * wv, tail - fx * fl, oy - fy * fl + wv * 0.4);
      }
      ctx.stroke();
      // hull: deck bar + scalloped underside (three arcs)
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x + w, y + 2);
      var seg = w / 3;
      for (var a = 2; a >= 0; a--) {
        var sx0 = x + seg * (a + 1), sx1 = x + seg * a;
        ctx.quadraticCurveTo((sx0 + sx1) / 2, y + 15 + (a === 1 ? 3 : 0), sx1, y + 2);
      }
      ctx.closePath();
      AP.R.glow(ctx, cx, y + 8, Math.min(40, 14 + w * 0.25), p.primary, 0.22 + 0.25 * s.land);
      ctx.fillStyle = rgba(p.primary, 0.28 + 0.15 * s.land);
      ctx.fill();
      ctx.strokeStyle = rgba(p.primary, 0.8);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = mix(p.primary, p.ink, 0.45 + 0.4 * s.land);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 1.5);
      ctx.lineTo(x + w - 1, y + 1.5);
      ctx.stroke();
      // a little vane on the deck turns with the current
      var va = Math.atan2(s.fy, s.fx) + (s.fm < 0 ? Math.PI : 0);
      ctx.fillStyle = rgba(p.accent, 0.55 + 0.3 * beatPulse());
      AP.R.poly(ctx, cx, y + 7, 3.2, 5, va);
      ctx.fill();
    }
  });
  var DASH_LEASH = [3, 5];
  var NODASH = [];

  // ================================================================== w3.kite
  // A tethered one-way platform. The kite flies above a stake (dir 'down', default) or hangs below a peg
  // (dir 'up'); the horizontal part of the flow swings it on its line. Landing on it while holding {down}
  // (or faster than a normal fall) stomps it: the kite catches the wind and flings you up.
  var KITE_V = 980;
  var AXIS = { x: 0, y: 0 };
  // the player's own fast-fall test (8-way axis: keys, d-pad and stick)
  function downHeld() { return !!(AP.Input && AP.Input.axis && AP.Input.axis(AXIS).y > 0); }

  function kiteStomp(e, P, L) {
    var s = e.s;
    var cx = P.x + P.w / 2, top = e.y;
    P.launch(null, -s.bounce, { refresh: true, noCut: true });
    s.dipV += 420;
    s.w += (P.vx > 0 ? 1 : -1) * 0.6;
    s.pop = 1;
    AP.FX.burst('w3.kite', cx, top);
    AP.sfxAt('bounce', cx, top, { pitch: 1.12 });
    AP.sfxAt('whoosh', cx, top, { vol: 0.5, pitch: 1.3 });
    L.shake(3, 0.16);
    L.kick(0, -4);
  }

  AP.Entities.register('w3.kite', {
    kind: 'solid', oneWay: true, anchor: 'tile', layer: 3, lint: 'stand', renderPad: 200,
    size: function (spec) { return [Math.max(1, num(spec.w, 2)) * 32, 12]; },
    init: function (e, spec, L) {
      var s = e.s;
      s.p = flowParams(spec, L);
      s.len = Math.max(1, num(spec.len, 4)) * 32;
      s.up = spec.dir === 'up';
      s.ax = e.x + e.w / 2;
      s.ay = s.up ? e.y + 6 - s.len : e.y + 6 + s.len;
      s.maxA = M.clamp(num(spec.swing, 28), 4, 60) * DEG;
      s.gain = num(spec.sway, 1);
      s.bounce = Math.max(10, num(spec.bounce, KITE_V / 32)) * 32;
      cycleInit(s, spec);
      s.th = 0; s.w = 0;
      s.dip = 0; s.dipV = 0;
      s.riding = false; s.flare = 0; s.pop = 0;
      s.fx = 1; s.fy = 0; s.fm = 0;
      s.ph = (seedOf(e, 9) % 628) / 100;
      // settle at the wind's current lean
      AP.Flow.sample(s.ax, e.y + 6, L ? L.time : 0, s.p, S);
      var env = cycle(s, L ? L.time : 0);
      s.th = M.clamp(S.x * S.m * env * 3.4 * s.gain / (2.6 * 2.6), -s.maxA, s.maxA);
      var cx = s.ax + Math.sin(s.th) * s.len;
      var cy = s.up ? s.ay + Math.cos(s.th) * s.len : s.ay - Math.cos(s.th) * s.len;
      e.setPos(Math.round(cx - e.w / 2), Math.round(cy - 6));
    },
    update: function (e, dt, L) {
      var s = e.s;
      var P = L.player;
      var riding = alive(P) && P.isRiding(e);
      AP.Flow.sample(e.x + e.w / 2, e.y + 6, L.time, s.p, S);
      var env = cycle(s, L.time);
      s.fx = S.x; s.fy = S.y; s.fm = S.m * env;
      // pendulum on the line: restoring pull, damping, and the horizontal push of the current
      var w0 = 2.6, push = S.x * S.m * env * 3.4 * s.gain;
      if (riding) push *= 0.55;
      s.w += (-w0 * w0 * s.th - 0.9 * w0 * s.w + push + Math.sin(L.time * 1.3 + s.ph) * 0.35) * dt;
      s.th += s.w * dt;
      if (s.th > s.maxA) { s.th = s.maxA; if (s.w > 0) s.w *= -0.25; }
      if (s.th < -s.maxA) { s.th = -s.maxA; if (s.w < 0) s.w *= -0.25; }
      // dip spring (rider weight, stomp recoil)
      s.dipV += (((riding ? 6 : 0) - s.dip) * 120 - s.dipV * 11) * dt;
      s.dip += s.dipV * dt;
      var sn = Math.sin(s.th), cs = Math.cos(s.th);
      var cx = s.ax + sn * s.len;
      var cy = s.up ? s.ay + cs * s.len : s.ay - cs * s.len;
      var nx = cx - e.w / 2, ny = cy - 6 + s.dip;
      var mx = nx - (e.x + e.xRem), my = ny - (e.y + e.yRem);
      e.moveSolid(mx, my);
      e.vx = mx / dt;
      e.vy = my / dt;
      // landing: a stomp (holding down, or a fast fall) flings the player; a soft landing just rides
      if (riding && !s.riding && P.landedOn === e && P.landedT <= dt * 1.5) {
        var imp = P.lastLandVy || 0;
        if (imp >= 280 && (imp >= 950 || downHeld())) { kiteStomp(e, P, L); riding = false; }
        else s.dipV += M.clamp(imp * 0.3, 30, 220);
      }
      s.riding = riding;
      // telegraph: the sail flares when a falling player above is set to stomp it
      var want = 0;
      if (alive(P) && !riding && P.vy > 200 && P.x < e.x + e.w + 24 && P.x + P.w > e.x - 24 && P.y + P.h <= e.y + 2 && e.y - (P.y + P.h) < 200) {
        if (P.vy >= 950 || downHeld()) want = 1;
        else want = 0.25;
      }
      s.flare = M.approach(s.flare, want, dt * 6);
      if (s.pop > 0) s.pop = Math.max(0, s.pop - dt * 2.5);
    },
    onRespawn: function (e) { e.s.riding = false; e.s.flare = 0; },
    render: function (e, ctx, L) {
      var s = e.s;
      var p = pal(L);
      var x = e.rx, y = e.ry, w = e.w;
      var cx = x + w / 2;
      var t = L.time;
      var lean = s.th;
      // sail: an inverted kite (the deck is its top spar) with its bridle point below
      var sh = 18 + w * 0.12;
      var bx = cx - Math.sin(lean) * sh * 0.6, by = y + 4 + sh;
      // the line to the stake / peg, sagging toward the flow
      var ax = s.ax, ay = s.ay;
      var sx = s.up ? cx : bx, sy = s.up ? y + 2 : by;
      var mxp = (sx + ax) / 2 + s.fx * 14 * Math.abs(s.fm), myp = (sy + ay) / 2 + 10 + s.fy * 8 * Math.abs(s.fm);
      ctx.strokeStyle = rgba(p.ink, 0.42);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mxp, myp, ax, ay);
      ctx.stroke();
      // bows along the line flutter downstream
      ctx.fillStyle = rgba(p.accent, 0.55);
      ctx.beginPath();
      for (var b = 1; b <= 3; b++) {
        var u = b / 4, iu = 1 - u;
        var qx = iu * iu * sx + 2 * iu * u * mxp + u * u * ax, qy = iu * iu * sy + 2 * iu * u * myp + u * u * ay;
        var fl = Math.sin(t * 8 + b * 1.9 + s.ph) * 0.5;
        var da = Math.atan2(s.fy, s.fx) + fl;
        var c0 = Math.cos(da), s0 = Math.sin(da);
        ctx.moveTo(qx, qy);
        ctx.lineTo(qx + c0 * 7 - s0 * 3, qy + s0 * 7 + c0 * 3);
        ctx.lineTo(qx + c0 * 7 + s0 * 3, qy + s0 * 7 - c0 * 3);
        ctx.closePath();
      }
      ctx.fill();
      // stake (or peg): a small pentagon
      ctx.fillStyle = rgba(p.primary, 0.35);
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 1.5;
      AP.R.poly(ctx, ax, ay, 4, 5, -Math.PI / 2);
      ctx.fill();
      ctx.stroke();
      // the sail
      var fl2 = s.flare;
      ctx.beginPath();
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x + w, y + 3);
      ctx.lineTo(bx, by);
      ctx.closePath();
      ctx.fillStyle = rgba(p.accent, 0.16 + 0.3 * fl2 + 0.3 * s.pop);
      ctx.fill();
      ctx.strokeStyle = mix(p.accent, p.ink, 0.25 * fl2);
      ctx.lineWidth = 1.6 + fl2;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(p.accent, 0.5);
      ctx.beginPath();
      ctx.moveTo(cx, y + 3);
      ctx.lineTo(bx, by);
      ctx.moveTo(x + w * 0.22, y + 3 + sh * 0.35);
      ctx.lineTo(x + w * 0.78, y + 3 + sh * 0.35);
      ctx.stroke();
      if (fl2 > 0.3 || s.pop > 0) AP.R.glow(ctx, cx, y + 10, 26, p.accent, 0.45 * Math.max(fl2, s.pop));
      // the deck (what you stand on)
      ctx.fillStyle = rgba(p.primary, 0.3);
      ctx.fillRect(x, y, w, 5);
      ctx.strokeStyle = mix(p.primary, p.ink, 0.3);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 1.5);
      ctx.lineTo(x + w, y + 1.5);
      ctx.stroke();
      // stomp hint: chevrons pointing down while the kite is primed
      if (fl2 > 0.5) {
        ctx.strokeStyle = rgba(p.accent, (fl2 - 0.5) * 1.6);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        var hy = y - 10 - (t * 30 % 6);
        ctx.moveTo(cx - 5, hy - 4); ctx.lineTo(cx, hy); ctx.lineTo(cx + 5, hy - 4);
        ctx.stroke();
      }
    }
  });

  // ================================================================== w3.drifter
  // A seed that rides the streamlines. 'leash' mode (default) circulates near home; 'stream' mode drifts
  // downstream for `range` tiles, dissolves, and re-forms at home (a river of seeds). Minions (spawned by the
  // Maelstrom with spec.life) dissolve for good.
  var DR_LIVE = 1, DR_POP = 2, DR_WAIT = 3, DR_FORM = 4;
  var DR_FORM_T = 0.7;
  var DR_INERTIA = 1 - Math.exp(-2.6 * STEP);

  function drBumpX(h, a) { a.s.vx = -a.s.vx * 0.45; }
  function drBumpY(h, a) { a.s.vy = -a.s.vy * 0.45; }

  function drSetLive(e, on) {
    e.collidable = on;
    e.hazard = on;
  }
  function drPop(e, L, quiet) {
    var s = e.s;
    if (s.state !== DR_LIVE) return false;
    s.state = DR_POP;
    s.t = 0;
    drSetLive(e, false);
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    AP.FX.burst('w3.pop', cx, cy);
    if (!quiet) AP.sfxAt('pulse', cx, cy, { vol: 0.65, pitch: 1.7 });
    return true;
  }
  function drReform(e) {
    var s = e.s;
    e.setPos(s.hx, s.hy);
    s.vx = s.vx0; s.vy = s.vy0;
    s.travel = 0;
    s.age = 0;
    s.state = DR_FORM;
    s.t = 0;
  }

  AP.Entities.register('w3.drifter', {
    kind: 'actor', w: 20, h: 20, anchor: 'center', layer: 6, lint: 'ignore', renderPad: 72,
    hazard: true, stompable: true, burstable: true, dashable: true,
    init: function (e, spec, L) {
      var s = e.s;
      s.p = flowParams(spec, L);
      s.speed = Math.max(0, num(spec.speed, 3)) * 32;
      s.leash = Math.max(0, num(spec.leash, 6)) * 32;
      s.stream = spec.mode === 'stream';
      s.range = Math.max(1, num(spec.range, 14)) * 32;
      s.life = Math.max(0, num(spec.life, 0));
      s.reform = Math.max(0.8, num(spec.reform, 3));
      s.vx0 = num(spec.vx, 0) * 32; s.vy0 = num(spec.vy, 0) * 32;
      s.vx = s.vx0; s.vy = s.vy0;
      s.hx = e.homeX; s.hy = e.homeY;
      s.travel = 0; s.age = 0;
      cycleInit(s, spec);                    // gusting / reversing currents carry the seeds too
      var r = AP.RNG(seedOf(e, 77));
      s.rot = r.next() * TAU;
      s.spin = (r.next() < 0.5 ? -1 : 1) * (1.6 + r.next() * 1.4);
      s.wob = r.next() * TAU;
      var delay = Math.max(0, num(spec.delay, 0));
      if (delay > 0) { s.state = DR_WAIT; s.t = s.reform - delay; drSetLive(e, false); }
      else { s.state = DR_LIVE; s.t = 0; }
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.t += dt;
      s.rot += s.spin * dt * (1 + Math.min(2, Math.sqrt(s.vx * s.vx + s.vy * s.vy) / 160));
      if (s.state === DR_POP) {
        if (s.t >= 0.3) {
          if (e.minion || s.life > 0) { L.remove(e); return; }
          s.state = DR_WAIT; s.t = 0;
        }
        return;
      }
      if (s.state === DR_WAIT) {
        if (s.t >= s.reform) {
          drReform(e);
          if (L.cam && L.cam.visible(s.hx, s.hy, e.w, e.h, 64)) AP.FX.burst('w3.form', s.hx + e.w / 2, s.hy + e.h / 2);
        }
        return;
      }
      if (s.state === DR_FORM) {
        if (s.t >= DR_FORM_T) { s.state = DR_LIVE; s.t = 0; drSetLive(e, true); }
        return;
      }
      // live: ride the flow (AP.Flow.velocity at the seed's centre, times the current's cycle), with a little inertia
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      var env = cycle(s, L.time);
      AP.Flow.velocity(cx, cy, L.time, s.p, s.speed * env, V);
      var tx = V.x, ty = V.y;
      if (s.leash > 0 && !s.stream) {
        var dx = s.hx + e.w / 2 - cx, dy = s.hy + e.h / 2 - cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > s.leash) {
          var pull = Math.min(2.5, (d - s.leash) / (s.leash * 0.5) + 0.6) * Math.max(40, s.speed);
          tx += dx / d * pull; ty += dy / d * pull;
        }
      }
      s.vx += (tx - s.vx) * DR_INERTIA;
      s.vy += (ty - s.vy) * DR_INERTIA;
      var ox = e.x, oy = e.y;
      e.moveX(s.vx * dt, drBumpX);
      e.moveY(s.vy * dt, drBumpY);
      e.vx = s.vx; e.vy = s.vy;
      s.travel += Math.abs(e.x - ox) + Math.abs(e.y - oy);
      s.age += dt;
      var gone = (s.stream && s.travel > s.range) || (s.life > 0 && s.age > s.life) ||
        e.y > L.ph + 64 || e.x < -64 || e.x > L.pw + 64;
      if (gone) {
        s.state = DR_POP; s.t = 0;
        drSetLive(e, false);
        if (L.cam && L.cam.visible(e.x, e.y, e.w, e.h, 32)) AP.FX.burst('w3.puff', e.x + e.w / 2, e.y + e.h / 2, { n: 4, dir: Math.atan2(s.vy, s.vx) });
      }
    },
    onStomp: function (e, P, L) { return drPop(e, L, false); },
    onBurst: function (e, P, L) { drPop(e, L, false); },
    onDash: function (e, P, L) { return drPop(e, L, false); },
    onRespawn: function (e, L) {
      var s = e.s;
      if (e.minion || s.life > 0) { L.remove(e); return; }
      e.setPos(s.hx, s.hy);
      s.vx = s.vx0; s.vy = s.vy0; s.travel = 0; s.age = 0;
      var delay = Math.max(0, num(e.spec.delay, 0));
      if (delay > 0) { s.state = DR_WAIT; s.t = s.reform - delay; drSetLive(e, false); }
      else { s.state = DR_LIVE; s.t = 0; drSetLive(e, true); }
    },
    render: function (e, ctx, L) {
      var s = e.s;
      var p = pal(L);
      var st = s.state;
      if (st === DR_WAIT) {
        // the last half second before re-forming: a faint dotted ring gathers at home
        var left = s.reform - s.t;
        if (left > 0.5) return;
        drawFormRing(ctx, p, s.hx + e.w / 2, s.hy + e.h / 2, 1 - left / 0.5, 0.35);
        return;
      }
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      var k = 1, alpha = 1;
      if (st === DR_POP) { k = 1 + s.t * 2.2; alpha = 1 - s.t / 0.3; }
      else if (st === DR_FORM) {
        var f = s.t / DR_FORM_T;
        drawFormRing(ctx, p, cx, cy, f, 1);
        k = 0.25 + 0.75 * AP.M.ease.outBack(M.clamp(f, 0, 1));
        alpha = 0.25 + 0.45 * f;
      }
      if (alpha <= 0.01) return;
      var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      // comet tail along the streamline it rides
      if (st === DR_LIVE && sp > 20) {
        var ux = s.vx / sp, uy = s.vy / sp;
        var tl = Math.min(26, 8 + sp * 0.08);
        ctx.strokeStyle = rgba(p.hazard, 0.3);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        var wob = Math.sin(L.time * 9 + s.wob) * 2;
        ctx.moveTo(cx - ux * 6, cy - uy * 6);
        ctx.quadraticCurveTo(cx - ux * tl * 0.6 - uy * wob, cy - uy * tl * 0.6 + ux * wob, cx - ux * tl, cy - uy * tl);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      var b = beatPulse();
      ctx.globalAlpha = alpha;
      if (st === DR_LIVE) AP.R.glow(ctx, cx, cy, 18, p.hazard, 0.3 + 0.15 * b);
      // spiky five-point seed (reads as deadly without colour)
      AP.R.star(ctx, cx, cy, 11 * k, 4.6 * k, 5, s.rot);
      ctx.fillStyle = rgba(p.hazard, 0.32);
      ctx.fill();
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      // inner counter-rotating pentagon and a bright core
      ctx.strokeStyle = rgba(p.ink, 0.55);
      ctx.lineWidth = 1.2;
      AP.R.poly(ctx, cx, cy, 4 * k, 5, -s.rot * 1.4);
      ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8 * k, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  });
  var DOTS_FORM = [2, 4];
  function drawFormRing(ctx, p, cx, cy, f, a) {
    f = M.clamp(f, 0, 1);
    ctx.strokeStyle = rgba(p.hazard, (0.25 + 0.5 * f) * a);
    ctx.lineWidth = 1.5;
    ctx.setLineDash(DOTS_FORM);
    ctx.beginPath();
    ctx.arc(cx, cy, 30 - 18 * f, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(NODASH);
  }
})(window.AP = window.AP || {});
