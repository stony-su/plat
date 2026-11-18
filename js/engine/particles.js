/* js/engine/particles.js — owner: CORE */
(function (AP) {
  'use strict';

  var TAU = Math.PI * 2;
  var MAX = AP.C.PARTICLES_MAX;

  // structure-of-arrays pool; slots are recycled in spawn order (oldest first) when full
  var X = new Float32Array(MAX), Y = new Float32Array(MAX);
  var VX = new Float32Array(MAX), VY = new Float32Array(MAX);
  var LIFE = new Float32Array(MAX), MAXL = new Float32Array(MAX);
  var S0 = new Float32Array(MAX), S1 = new Float32Array(MAX);
  var ROT = new Float32Array(MAX), SPIN = new Float32Array(MAX);
  var GRAV = new Float32Array(MAX), DRAG = new Float32Array(MAX), WID = new Float32Array(MAX);
  var SHAPE = new Uint8Array(MAX), FLAGS = new Uint8Array(MAX), RAMP = new Uint16Array(MAX);
  var head = 0;
  var alive = 0;

  var F_ALIVE = 1, F_ADD = 2, F_BACK = 4, F_ALIGN = 8;
  var SHAPES = { dot: 0, tri: 1, sq: 2, pent: 3, hex: 4, star: 5, line: 6, ring: 7 };
  var SIDES = [0, 3, 4, 5, 6, 0, 0, 0];

  // colour ramps: (color -> color2) in 8 steps
  var RAMP_N = 8;
  var ramps = [];
  var rampIds = {};
  function rampId(c1, c2) {
    var key = c1 + '>' + c2;
    var id = rampIds[key];
    if (id !== undefined) return id;
    if (ramps.length >= 4000) return 0;
    var arr = [];
    for (var i = 0; i < RAMP_N; i++) arr.push(c1 === c2 ? c1 : AP.Color.mix(c1, c2, i / (RAMP_N - 1)));
    id = ramps.length;
    ramps.push(arr);
    rampIds[key] = id;
    return id;
  }

  // fast local PRNG for cosmetic randomness (not used by gameplay or lint)
  var seed = 0x2545F491;
  function rnd() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1000003) / 1000003;
  }
  function rv(v, d) {
    if (v === undefined || v === null) v = d;
    if (typeof v === 'number') return v;
    return v[0] + (v[1] - v[0]) * rnd();
  }

  function pal() {
    if (AP.level && AP.level.pal) return AP.level.pal;
    return AP.R ? AP.R.pal('title') : { bg: '#000', primary: '#fff', accent: '#ff0', hazard: '#f00', ink: '#fff' };
  }

  function spawnOne(x, y, vx, vy, life, s0, s1, shape, rid, rot, spin, grav, drag, wid, flags) {
    var k = head;
    head = head + 1 === MAX ? 0 : head + 1;
    if (!(FLAGS[k] & F_ALIVE)) alive++;
    X[k] = x; Y[k] = y; VX[k] = vx; VY[k] = vy;
    LIFE[k] = 0; MAXL[k] = life > 0.01 ? life : 0.01;
    S0[k] = s0; S1[k] = s1; SHAPE[k] = shape; RAMP[k] = rid;
    ROT[k] = rot; SPIN[k] = spin; GRAV[k] = grav; DRAG[k] = drag; WID[k] = wid;
    FLAGS[k] = flags | F_ALIVE;
    return k;
  }

  function qualityCount(n) {
    var q = (AP.R && AP.R.quality) ? AP.R.quality.particles : 1;
    var nf = n * q;
    var c = Math.floor(nf);
    if (rnd() < nf - c) c++;
    return c;
  }

  var DEF_SPEED = [60, 180], DEF_ANGLE = [0, TAU], DEF_LIFE = [0.3, 0.6], DEF_SIZE = [2, 4], DEF_SPIN = [-4, 4];
  var EMPTY = {};

  // emit(x, y, o) -> count. o = {n=8, color, color2, speed:[60,180], angle:[0,TAU], life:[0.3,0.6], size:[2,4], sizeEnd=0,
  //   gravity=0, drag=0, shape, spin:[-4,4], additive=true, back=false, spread=0 (position jitter radius), rot (initial,
  //   default random), width=2 (line/ring stroke), align=false (lines/shapes face their velocity)}
  function emit(x, y, o) {
    o = o || EMPTY;
    var count = qualityCount(o.n === undefined ? 8 : o.n);
    if (count <= 0) return 0;
    var p = null;
    var c1 = o.color || (p = pal()).accent;
    var c2 = o.color2 || c1;
    var rid = rampId(c1, c2);
    var shape = SHAPES[o.shape] !== undefined ? SHAPES[o.shape] : 0;
    var flags = (o.additive === false ? 0 : F_ADD) | (o.back ? F_BACK : 0) | (o.align ? F_ALIGN : 0);
    var grav = o.gravity || 0, drag = o.drag || 0, wid = o.width || 2;
    var spread = o.spread || 0;
    var sizeEnd = o.sizeEnd;
    for (var i = 0; i < count; i++) {
      var a = rv(o.angle, DEF_ANGLE);
      var s = rv(o.speed, DEF_SPEED);
      var px = x, py = y;
      if (spread) {
        var sa = rnd() * TAU, sr = Math.sqrt(rnd()) * spread;
        px += Math.cos(sa) * sr;
        py += Math.sin(sa) * sr;
      }
      var s0 = rv(o.size, DEF_SIZE);
      var s1 = sizeEnd === undefined ? 0 : (sizeEnd < 0 ? s0 : rv(sizeEnd, 0));
      var rot = o.rot === undefined ? rnd() * TAU : rv(o.rot, 0);
      spawnOne(px, py, Math.cos(a) * s, Math.sin(a) * s, rv(o.life, DEF_LIFE), s0, s1, shape, rid,
        rot, rv(o.spin, DEF_SPIN), grav, drag, wid, flags);
    }
    return count;
  }

  // expanding ring (not scaled by quality: rings are cheap and carry information)
  function ring(x, y, r0, r1, life, color, width) {
    var c = color || pal().accent;
    spawnOne(x, y, 0, 0, life || 0.35, r0 || 0, r1 === undefined ? 40 : r1, SHAPES.ring, rampId(c, c), 0, 0, 0, 0,
      width === undefined ? 2 : width, F_ADD);
    return 1;
  }

  function update(dt) {
    if (alive === 0) return;
    var n = 0;
    for (var k = 0; k < MAX; k++) {
      var f = FLAGS[k];
      if (!(f & F_ALIVE)) continue;
      var l = LIFE[k] + dt;
      if (l >= MAXL[k]) { FLAGS[k] = 0; continue; }
      LIFE[k] = l;
      var g = GRAV[k];
      if (g !== 0) VY[k] += g * dt;
      var d = DRAG[k];
      if (d !== 0) {
        var m = 1 - d * dt;
        if (m < 0) m = 0;
        VX[k] *= m;
        VY[k] *= m;
      }
      X[k] += VX[k] * dt;
      Y[k] += VY[k] * dt;
      ROT[k] += SPIN[k] * dt;
      n++;
    }
    alive = n;
  }

  function drawShape(ctx, k, s, rot) {
    var sh = SHAPE[k];
    var x = X[k], y = Y[k];
    if (sh === 0) {
      if (s < 1.25) { ctx.fillRect(x - s, y - s, s * 2, s * 2); return; }
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
      return;
    }
    if (sh === 6) {
      var c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
      ctx.lineWidth = WID[k];
      ctx.beginPath();
      ctx.moveTo(x - c, y - sn);
      ctx.lineTo(x + c, y + sn);
      ctx.stroke();
      return;
    }
    if (sh === 7) {
      if (s <= 0.2) return;
      ctx.lineWidth = WID[k];
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.stroke();
      return;
    }
    if (sh === 5) {
      AP.R.star(ctx, x, y, s, s * 0.45, 5, rot);
      ctx.fill();
      return;
    }
    AP.R.poly(ctx, x, y, s, SIDES[sh], rot);
    ctx.fill();
  }

  function renderPass(ctx, back, additive) {
    var drew = 0;
    for (var k = 0; k < MAX; k++) {
      var f = FLAGS[k];
      if (!(f & F_ALIVE)) continue;
      if (((f & F_BACK) !== 0) !== back) continue;
      if (((f & F_ADD) !== 0) !== additive) continue;
      var t = LIFE[k] / MAXL[k];
      var s = S0[k] + (S1[k] - S0[k]) * t;
      if (s <= 0.05 && SHAPE[k] !== 7) continue;
      var a = SHAPE[k] === 7 ? (1 - t) : (1 - t * t);
      if (a <= 0.01) continue;
      var col = ramps[RAMP[k]][(t * RAMP_N) | 0] || ramps[RAMP[k]][RAMP_N - 1];
      ctx.globalAlpha = a;
      if (SHAPE[k] === 6 || SHAPE[k] === 7) ctx.strokeStyle = col; else ctx.fillStyle = col;
      var rot = (f & F_ALIGN) ? Math.atan2(VY[k], VX[k]) : ROT[k];
      drawShape(ctx, k, s, rot);
      drew++;
    }
    return drew;
  }

  // render(ctx, back): back=true draws particles emitted with {back:true} (behind entities), false the rest
  function render(ctx, back) {
    if (alive === 0) return;
    back = !!back;
    var pa = ctx.globalAlpha, pc = ctx.globalCompositeOperation;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'source-over';
    renderPass(ctx, back, false);
    ctx.globalCompositeOperation = 'lighter';
    renderPass(ctx, back, true);
    ctx.globalCompositeOperation = pc;
    ctx.globalAlpha = pa;
    ctx.lineCap = 'butt';
  }

  function clear() {
    FLAGS.fill(0);
    alive = 0;
  }

  function count() { return alive; }

  // ---- presets ----
  var presets = {};
  function preset(name, fnOrOpts) {
    if (!name) return;
    if (presets[name] && AP.DEV) AP.warnOnce('fxdup:' + name, 'FX preset redefined:', name);
    presets[name] = fnOrOpts;
  }

  var MERGE_KEYS = ['n', 'color', 'color2', 'speed', 'angle', 'life', 'size', 'sizeEnd', 'gravity', 'drag', 'shape', 'spin',
    'additive', 'back', 'spread', 'rot', 'width', 'align'];
  var scratch = {};
  var scratchAngle = [0, 0];

  // burst(name, x, y, o?) — o.color, o.n, o.dir (radians), o.form, o.power... -> particle count
  function burst(name, x, y, o) {
    var p = presets[name];
    if (!p) {
      AP.warnOnce('fx:' + name, 'Unknown FX preset:', name);
      return 0;
    }
    o = o || EMPTY;
    if (typeof p === 'function') {
      try { return p(x, y, o) || 0; } catch (e) { AP.reportError('FX.burst:' + name, e); return 0; }
    }
    for (var i = 0; i < MERGE_KEYS.length; i++) {
      var k = MERGE_KEYS[i];
      scratch[k] = o[k] !== undefined ? o[k] : p[k];
    }
    if (typeof o.dir === 'number') {
      var cone = p.cone !== undefined ? p.cone : 0.6;
      scratchAngle[0] = o.dir - cone;
      scratchAngle[1] = o.dir + cone;
      scratch.angle = scratchAngle;
    }
    return emit(x, y, scratch);
  }

  // ---- CORE preset implementations ----
  var E = {};   // reusable option object for preset functions
  function reset() {
    for (var i = 0; i < MERGE_KEYS.length; i++) E[MERGE_KEYS[i]] = undefined;
    return E;
  }
  function A(a, b) { return [a, b]; }

  var UP = -Math.PI / 2;

  preset('dust', function (x, y, o) {
    var P = pal(), e = reset();
    e.n = o.n || 6; e.color = o.color || AP.Color.mix(P.primary, P.ink, 0.35); e.color2 = P.bg;
    e.speed = A(20, 70); e.angle = typeof o.dir === 'number' ? A(o.dir - 0.7, o.dir + 0.7) : A(-Math.PI, 0);
    e.life = A(0.25, 0.5); e.size = A(1.5, 3); e.drag = 3; e.gravity = -30; e.additive = false; e.spread = 4;
    return emit(x, y, e);
  });

  preset('land', function (x, y, o) {
    var P = pal(), e = reset();
    var pw = o.power === undefined ? 1 : AP.M.clamp(o.power, 0.2, 1.5);
    e.n = Math.round((o.n || 7) * pw); e.color = o.color || AP.Color.mix(P.primary, P.ink, 0.4); e.color2 = P.bg;
    e.speed = A(50 * pw, 170 * pw); e.life = A(0.22, 0.45); e.size = A(1.8, 3.5); e.drag = 5; e.gravity = -40;
    e.additive = false; e.spread = 3;
    e.angle = A(Math.PI + 0.05, Math.PI + 0.45);
    var c = emit(x - 6, y, e);
    e.angle = A(-0.45, -0.05);
    c += emit(x + 6, y, e);
    if (pw > 0.6) ring(x, y, 4, 22 * pw, 0.22, P.ink, 1.5);
    return c;
  });

  preset('jump', function (x, y, o) {
    var P = pal(), e = reset();
    e.n = o.n || 6; e.color = o.color || AP.Color.mix(P.primary, P.ink, 0.4); e.color2 = P.bg;
    e.speed = A(40, 130); e.angle = A(0.15 * Math.PI, 0.85 * Math.PI); e.life = A(0.2, 0.36); e.size = A(1.5, 3);
    e.drag = 4; e.additive = false; e.spread = 4;
    var c = emit(x, y, e);
    ring(x, y, 3, 16, 0.2, o.color || P.ink, 1.5);
    return c + 1;
  });

  preset('walljump', function (x, y, o) {
    var P = pal(), e = reset();
    var side = o.dir || 1;   // side of the wall (+1 = wall on the right)
    var base = side > 0 ? Math.PI : 0;
    e.n = o.n || 8; e.color = o.color || P.accent; e.color2 = P.ink;
    e.speed = A(110, 260); e.angle = A(base - 0.9, base + 0.9); e.life = A(0.14, 0.3); e.size = A(3, 6);
    e.drag = 6; e.shape = 'line'; e.align = true; e.width = 1.6;
    var c = emit(x, y, e);
    ring(x, y, 2, 14, 0.18, P.accent, 1.5);
    return c + 1;
  });

  preset('dash', function (x, y, o) {
    var P = pal(), e = reset();
    var dir = typeof o.dir === 'number' ? o.dir : 0;
    ring(x, y, 6, 34, 0.24, o.color || P.accent, 2.5);
    e.n = o.n || 10; e.color = o.color || P.accent; e.color2 = P.ink;
    e.speed = A(200, 420); e.angle = A(dir + Math.PI - 0.35, dir + Math.PI + 0.35); e.life = A(0.12, 0.26);
    e.size = A(4, 9); e.drag = 4; e.shape = 'line'; e.align = true; e.width = 2;
    var c = emit(x, y, e);
    reset();
    e.n = 4; e.color = o.color || P.accent; e.speed = A(30, 90); e.life = A(0.2, 0.35); e.size = A(3, 5);
    e.shape = 'hex'; e.spin = A(-6, 6); e.drag = 3;
    return c + emit(x, y, e) + 1;
  });

  var DT_SPEED = [0, 30], DT_LIFE = [0.16, 0.3], DT_SIZE = [2, 3.5], DT_SPIN = [-5, 5];
  preset('dashTrail', function (x, y, o) {
    var P = pal(), e = reset();
    e.n = o.n || 2; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = DT_SPEED; e.life = DT_LIFE;
    e.size = DT_SIZE; e.shape = 'hex'; e.spin = DT_SPIN; e.spread = 5;
    return emit(x, y, e);
  });

  preset('burst', function (x, y, o) {
    var P = pal(), e = reset();
    var col = o.color || P.accent;
    var r = o.radius || AP.C.BURST_RADIUS;
    ring(x, y, 8, r, 0.34, col, 2.5);
    ring(x, y, 4, r * 0.72, 0.26, P.ink, 1.5);
    var rot0 = UP;
    var c = 2;
    for (var i = 0; i < 5; i++) {
      var a = rot0 + i * TAU / 5;
      spawnOne(x + Math.cos(a) * 10, y + Math.sin(a) * 10, Math.cos(a) * 240, Math.sin(a) * 240, 0.28, 9, 0,
        SHAPES.line, rampId(col, P.ink), a, 0, 0, 3, 2.5, F_ADD);
      c++;
    }
    e.n = o.n || 10; e.color = col; e.color2 = P.ink; e.speed = A(80, 220); e.life = A(0.25, 0.45); e.size = A(2, 3.5);
    e.shape = 'pent'; e.spin = A(-6, 6); e.drag = 3;
    return c + emit(x, y, e);
  });

  // death: every polygon edge becomes a line particle flying outward (o.form sides, o.rot rotation, o.r radius)
  preset('death', function (x, y, o) {
    var P = pal(), e = reset();
    var form = o.form || 3;
    var sides = form >= 32 ? 12 : form;
    var r = o.r || 13;
    var rot = o.rot === undefined ? AP.R.flatRot(sides) : o.rot;
    var col = o.color || P.ink;
    var rid = rampId(col, P.hazard);
    var c = 0;
    for (var i = 0; i < sides; i++) {
      var a0 = rot + i * TAU / sides, a1 = rot + (i + 1) * TAU / sides;
      var x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
      var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      var ml = Math.sqrt(mx * mx + my * my) || 1;
      var sp = 160 + rnd() * 160;
      var half = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) / 2;
      spawnOne(x + mx, y + my, mx / ml * sp, my / ml * sp - 90, 0.6 + rnd() * 0.3, half, half * 0.4, SHAPES.line, rid,
        Math.atan2(y1 - y0, x1 - x0), (rnd() - 0.5) * 18, 700, 0.8, 2.5, F_ADD);
      c++;
    }
    ring(x, y, 6, 70, 0.4, P.hazard, 2.5);
    ring(x, y, 2, 34, 0.25, col, 1.5);
    e.n = o.n || 14; e.color = P.hazard; e.color2 = col; e.speed = A(100, 320); e.life = A(0.35, 0.7); e.size = A(2, 4);
    e.shape = 'tri'; e.gravity = 300; e.drag = 1.5; e.spin = A(-8, 8);
    return c + 2 + emit(x, y, e);
  });

  preset('respawn', function (x, y, o) {
    var P = pal(), e = reset();
    ring(x, y, 8, 46, 0.36, o.color || P.ink, 2);
    ring(x, y, 2, 26, 0.26, P.accent, 1.5);
    e.n = o.n || 8; e.color = P.accent; e.color2 = P.ink; e.speed = A(40, 120); e.life = A(0.3, 0.5); e.size = A(1.5, 2.5);
    e.drag = 3;
    return 2 + emit(x, y, e);
  });

  preset('shard', function (x, y, o) {
    var P = pal(), e = reset();
    e.n = o.n || 6; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = A(40, 150); e.life = A(0.25, 0.45);
    e.size = A(1.5, 3); e.shape = 'tri'; e.spin = A(-10, 10); e.drag = 3;
    var c = emit(x, y, e);
    ring(x, y, 3, 16, 0.2, o.color || P.accent, 1.5);
    return c + 1;
  });

  preset('gem', function (x, y, o) {
    var P = pal(), e = reset();
    ring(x, y, 6, 44, 0.42, o.color || P.accent, 2.5);
    ring(x, y, 2, 26, 0.3, P.ink, 1.5);
    e.n = o.n || 12; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = A(60, 230); e.life = A(0.4, 0.75);
    e.size = A(2, 4); e.shape = 'star'; e.spin = A(-6, 6); e.drag = 2;
    var c = emit(x, y, e);
    reset();
    e.n = 6; e.color = P.ink; e.speed = A(30, 120); e.life = A(0.3, 0.6); e.size = A(1.2, 2.2); e.drag = 2;
    return 2 + c + emit(x, y, e);
  });

  preset('checkpoint', function (x, y, o) {
    var P = pal(), e = reset();
    ring(x, y, 10, 84, 0.6, o.color || P.accent, 2.5);
    e.n = o.n || 14; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = A(80, 240); e.angle = A(UP - 0.5, UP + 0.5);
    e.gravity = -60; e.life = A(0.5, 0.9); e.size = A(1.5, 3); e.drag = 1.5;
    var c = emit(x, y, e);
    reset();
    e.n = 6; e.color = P.ink; e.speed = A(150, 300); e.angle = A(UP - 0.25, UP + 0.25); e.life = A(0.2, 0.4);
    e.size = A(4, 8); e.shape = 'line'; e.align = true; e.drag = 3;
    return 1 + c + emit(x, y, e);
  });

  preset('break', function (x, y, o) {
    var P = pal(), e = reset();
    e.n = o.n || 10; e.color = o.color || P.primary; e.color2 = P.bg; e.speed = A(80, 260); e.life = A(0.5, 0.9);
    e.size = A(3, 6); e.sizeEnd = A(1, 2); e.shape = 'sq'; e.gravity = 900; e.spin = A(-8, 8); e.additive = false; e.spread = 10;
    var c = emit(x, y, e);
    reset();
    e.n = 6; e.color = P.accent; e.speed = A(60, 200); e.life = A(0.25, 0.5); e.size = A(2, 3.5); e.shape = 'tri';
    e.spin = A(-8, 8); e.drag = 2; e.spread = 8;
    return c + emit(x, y, e);
  });

  preset('crumble', function (x, y, o) {
    var P = pal(), e = reset();
    e.n = o.n || 9; e.color = o.color || P.primary; e.color2 = P.bg; e.speed = A(20, 100);
    e.angle = A(Math.PI * 0.25, Math.PI * 0.75); e.life = A(0.4, 0.75); e.size = A(2, 4); e.shape = 'sq';
    e.gravity = 800; e.spin = A(-6, 6); e.additive = false; e.spread = 12;
    return emit(x, y, e);
  });

  preset('bounce', function (x, y, o) {
    var P = pal(), e = reset();
    var dir = typeof o.dir === 'number' ? o.dir : UP;
    ring(x, y, 6, 32, 0.26, o.color || P.accent, 2);
    e.n = o.n || 8; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = A(200, 380); e.angle = A(dir - 0.3, dir + 0.3);
    e.life = A(0.14, 0.28); e.size = A(4, 8); e.shape = 'line'; e.align = true; e.drag = 4;
    return 1 + emit(x, y, e);
  });

  preset('spark', function (x, y, o) {
    var P = pal(), e = reset();
    var dir = typeof o.dir === 'number' ? o.dir : UP;
    e.n = o.n || 2; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = A(60, 170); e.angle = A(dir - 0.6, dir + 0.6);
    e.life = A(0.1, 0.22); e.size = A(2, 4); e.shape = 'line'; e.align = true; e.width = 1.5; e.gravity = 200;
    return emit(x, y, e);
  });

  preset('explode', function (x, y, o) {
    var P = pal(), e = reset();
    ring(x, y, 8, 90, 0.45, o.color || P.hazard, 3);
    ring(x, y, 4, 50, 0.3, P.ink, 1.5);
    e.n = o.n || 24; e.color = o.color || P.hazard; e.color2 = P.accent; e.speed = A(120, 420); e.gravity = 300; e.drag = 1.5;
    e.life = A(0.4, 0.8); e.size = A(2, 5); e.shape = 'tri'; e.spin = A(-10, 10);
    var c = emit(x, y, e);
    reset();
    e.n = 10; e.color = P.ink; e.speed = A(60, 200); e.life = A(0.3, 0.6); e.size = A(1.5, 3); e.drag = 2;
    return 2 + c + emit(x, y, e);
  });

  // inward spiral of points (exit portal)
  preset('portal', function (x, y, o) {
    var P = pal();
    var col = o.color || P.accent;
    var rid = rampId(col, P.ink);
    var n = qualityCount(o.n || 14);
    var R0 = o.radius || 46;
    for (var i = 0; i < n; i++) {
      var a = rnd() * TAU;
      var r = R0 * (0.75 + rnd() * 0.5);
      var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      var inV = 70 + rnd() * 60, tan = 70 + rnd() * 40;
      spawnOne(px, py, -Math.cos(a) * inV - Math.sin(a) * tan, -Math.sin(a) * inV + Math.cos(a) * tan, 0.45 + rnd() * 0.3,
        1.5 + rnd() * 1.5, 0, SHAPES.dot, rid, 0, 0, 0, 0.5, 2, F_ADD);
    }
    return n;
  });

  preset('orbit', function (x, y, o) {
    var P = pal(), e = reset();
    ring(x, y, 6, 30, 0.26, o.color || P.accent, 2);
    e.n = o.n || 6; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = A(40, 110); e.life = A(0.2, 0.4);
    e.size = A(1.5, 2.5); e.drag = 3;
    return 1 + emit(x, y, e);
  });

  preset('fling', function (x, y, o) {
    var P = pal(), e = reset();
    var dir = typeof o.dir === 'number' ? o.dir : 0;
    ring(x, y, 4, 40, 0.3, o.color || P.accent, 2);
    e.n = o.n || 12; e.color = P.ink; e.color2 = o.color || P.accent; e.speed = A(150, 350);
    e.angle = A(dir + Math.PI - 0.4, dir + Math.PI + 0.4); e.life = A(0.15, 0.32); e.size = A(4, 9);
    e.shape = 'line'; e.align = true; e.drag = 3;
    return 1 + emit(x, y, e);
  });

  preset('secret', function (x, y, o) {
    var P = pal(), e = reset();
    ring(x, y, 10, 96, 0.65, o.color || P.accent, 2);
    ring(x, y, 4, 52, 0.45, P.ink, 1.5);
    e.n = o.n || 18; e.color = o.color || P.accent; e.color2 = P.ink; e.speed = A(40, 180); e.drag = 1.5;
    e.life = A(0.6, 1.0); e.size = A(2, 4); e.shape = 'star'; e.spin = A(-4, 4); e.spread = 16;
    var c = emit(x, y, e);
    reset();
    e.n = 10; e.color = P.ink; e.speed = A(20, 90); e.life = A(0.5, 0.9); e.size = A(1, 2); e.spread = 24; e.gravity = -40;
    return 2 + c + emit(x, y, e);
  });

  preset('hit', function (x, y, o) {
    var P = pal(), e = reset();
    var col = o.color || P.ink;
    ring(x, y, 4, 24, 0.16, col, 2);
    spawnOne(x, y, 0, 0, 0.14, 9, 0, SHAPES.star, rampId(col, col), rnd() * TAU, 6, 0, 0, 2, F_ADD);
    e.n = o.n || 8; e.color = col; e.color2 = P.accent; e.speed = A(120, 300); e.life = A(0.12, 0.25); e.size = A(3, 6);
    e.shape = 'line'; e.align = true; e.drag = 4;
    return 2 + emit(x, y, e);
  });

  preset('bossHit', function (x, y, o) {
    var P = pal(), e = reset();
    var col = o.color || P.accent;
    ring(x, y, 10, 74, 0.36, col, 3);
    ring(x, y, 4, 40, 0.24, P.ink, 2);
    e.n = o.n || 16; e.color = col; e.color2 = P.ink; e.speed = A(200, 480); e.life = A(0.18, 0.36); e.size = A(5, 11);
    e.shape = 'line'; e.align = true; e.drag = 3; e.width = 2.5;
    var c = emit(x, y, e);
    reset();
    e.n = 10; e.color = P.ink; e.color2 = col; e.speed = A(60, 220); e.life = A(0.3, 0.6); e.size = A(2, 4.5);
    e.shape = 'star'; e.spin = A(-6, 6); e.drag = 2;
    return 2 + c + emit(x, y, e);
  });

  preset('bossDeath', function (x, y, o) {
    var P = pal(), e = reset();
    var col = o.color || P.accent;
    ring(x, y, 10, 170, 0.9, col, 3);
    ring(x, y, 6, 280, 1.4, P.ink, 1.5);
    ring(x, y, 2, 110, 0.6, P.hazard, 2);
    var shapes = ['tri', 'pent', 'hex'];
    var c = 3;
    for (var i = 0; i < 3; i++) {
      reset();
      e.n = (o.n || 60) / 3; e.color = i === 0 ? col : (i === 1 ? P.hazard : P.ink); e.color2 = P.ink;
      e.speed = A(80, 520); e.drag = 1; e.life = A(0.8, 1.6); e.size = A(2.5, 6); e.shape = shapes[i]; e.spin = A(-6, 6);
      e.spread = 20;
      c += emit(x, y, e);
    }
    reset();
    e.n = 30; e.color = P.ink; e.color2 = col; e.speed = A(250, 600); e.life = A(0.3, 0.7); e.size = A(6, 14);
    e.shape = 'line'; e.align = true; e.drag = 2; e.width = 2;
    return c + emit(x, y, e);
  });

  preset('vertex', function (x, y, o) {
    var P = pal(), e = reset();
    var col = o.color || P.accent;
    ring(x, y, 8, 130, 0.8, col, 2.5);
    ring(x, y, 4, 70, 0.5, P.ink, 2);
    e.n = o.n || 12; e.color = P.ink; e.color2 = col; e.speed = A(120, 320); e.life = A(0.3, 0.6); e.size = A(6, 12);
    e.shape = 'line'; e.align = true; e.drag = 2;
    var c = emit(x, y, e);
    reset();
    e.n = 20; e.color = col; e.color2 = P.ink; e.speed = A(40, 200); e.life = A(0.5, 1.0); e.size = A(2, 4);
    e.shape = 'star'; e.spin = A(-5, 5); e.drag = 1.5;
    return 2 + c + emit(x, y, e);
  });

  AP.FX = {
    emit: emit,
    burst: burst,
    ring: ring,
    preset: preset,
    has: function (name) { return !!presets[name]; },
    list: function () { return Object.keys(presets).sort(); },
    update: update,
    render: render,
    clear: clear,
    count: count,
    spawnRaw: spawnOne,
    rampId: rampId,
    SHAPES: SHAPES
  };
})(window.AP = window.AP || {});
