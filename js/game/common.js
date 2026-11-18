/* js/game/common.js — owner: CORE */
(function (AP) {
  'use strict';

  // Common entity types (CONTRACT section 2.16). The player lives in js/game/player.js.
  var C = AP.C;
  var M = AP.M;
  var TAU = Math.PI * 2;
  var E = AP.Entities;
  var pathOut = { x: 0, y: 0, i: 0, dir: 1, wait: false };
  var lissOut = { x: 0, y: 0 };

  function pal(L) { return (L && L.pal) || AP.R.pal('title'); }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; return Math.pow(1 - ph, 3); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function tiles(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }

  // replaces {action} tokens with the bound key / button label
  var TOKEN_RE = /\{(\w+)\}/g;
  function labelText(str) {
    if (!str) return '';
    return String(str).replace(TOKEN_RE, function (m, a) {
      if (AP.ACTIONS && AP.ACTIONS.indexOf(a) >= 0 && AP.Input && AP.Input.label) return '[' + AP.Input.label(a) + ']';
      return m;
    });
  }

  // ================================================================ checkpoint
  E.register('checkpoint', {
    kind: 'sensor', w: 24, h: 64, anchor: 'floor', layer: 2, lint: 'ignore', renderPad: 96,
    init: function (e, spec, L) {
      e.s.index = L && typeof L.nextCheckpointIndex === 'function' ? L.nextCheckpointIndex() : 0;
      e.s.lit = 0;
      e.s.flash = 0;
      e.s.ring = 0;
    },
    update: function (e, dt, L) {
      var on = L.checkpoint && L.checkpoint.index === e.s.index;
      e.s.lit = M.approach(e.s.lit, on ? 1 : 0, dt * 3);
      if (e.s.flash > 0) e.s.flash = Math.max(0, e.s.flash - dt * 1.6);
      e.s.ring += dt;
    },
    onTouch: function (e, P, L) {
      if (L.checkpoint && L.checkpoint.index === e.s.index) return;
      var cx = e.x + e.w / 2, by = e.y + e.h;
      L.setCheckpoint(cx, by, e.s.index);
      e.s.flash = 1;
      AP.FX.burst('checkpoint', cx, e.y + 8);
      AP.FX.ring(cx, by - 32, 6, 90, 0.6, pal(L).accent, 2);
      AP.sfxAt('checkpoint', cx, e.y + 8);
      L.shake(2, 0.15);
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      var cx = e.rx + e.w / 2, by = e.ry + e.h, top = e.ry + 4;
      var lit = e.s.lit;
      var col = AP.Color.mix(p.primary, p.accent, lit);
      // plinth
      ctx.beginPath();
      ctx.moveTo(cx - 11, by); ctx.lineTo(cx - 8, by - 7); ctx.lineTo(cx + 8, by - 7); ctx.lineTo(cx + 11, by);
      ctx.closePath();
      ctx.fillStyle = rgba(col, 0.18);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
      // shaft
      ctx.beginPath();
      ctx.moveTo(cx - 6, by - 7); ctx.lineTo(cx - 3.5, top + 14); ctx.lineTo(cx + 3.5, top + 14); ctx.lineTo(cx + 6, by - 7);
      ctx.closePath();
      ctx.fillStyle = rgba(col, 0.1 + 0.12 * lit);
      ctx.fill();
      ctx.stroke();
      // engraved rungs
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(col, 0.45);
      ctx.beginPath();
      for (var k = 0; k < 3; k++) { var yy = by - 16 - k * 11; ctx.moveTo(cx - 3, yy); ctx.lineTo(cx + 3, yy); }
      ctx.stroke();
      // pyramidion tip (ignites when active)
      var pulse = lit * (0.6 + 0.4 * beatPulse());
      ctx.beginPath();
      ctx.moveTo(cx, top); ctx.lineTo(cx + 4.5, top + 14); ctx.lineTo(cx - 4.5, top + 14);
      ctx.closePath();
      ctx.fillStyle = lit > 0.05 ? rgba(p.accent, 0.35 + 0.65 * pulse) : rgba(p.primary, 0.12);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = lit > 0.05 ? p.accent : col;
      ctx.stroke();
      if (lit > 0.02) {
        AP.R.glow(ctx, cx, top + 6, 22 + 10 * e.s.flash, p.accent, 0.35 * lit + 0.6 * e.s.flash);
        // slow halo ring around the tip
        ctx.strokeStyle = rgba(p.accent, 0.4 * lit);
        ctx.lineWidth = 1.2;
        AP.R.poly(ctx, cx, top + 7, 10 + 2 * beatPulse(), 6, e.s.ring * 0.8);
        ctx.stroke();
      }
    }
  });

  // ================================================================ exit
  E.register('exit', {
    kind: 'sensor', w: 40, h: 64, anchor: 'floor', layer: 2, lint: 'ignore', renderPad: 120,
    init: function (e) { e.s.spin = 0; e.s.emitT = 0; e.s.used = false; },
    update: function (e, dt, L) {
      e.s.spin += dt;
      e.s.emitT -= dt;
      if (e.s.emitT <= 0) {
        e.s.emitT = 0.14;
        if (L.cam && L.cam.visible(e.x, e.y, e.w, e.h, 64)) AP.FX.burst('portal', e.x + e.w / 2, e.y + e.h - 30, { n: 3, radius: 40 });
      }
    },
    onTouch: function (e, P, L) {
      if (e.s.used || L.ended || !alive(P)) return;
      e.s.used = true;
      var cx = e.x + e.w / 2, cy = e.y + e.h - 30;
      AP.FX.burst('portal', cx, cy, { n: 24, radius: 60 });
      AP.FX.ring(cx, cy, 8, 80, 0.5, pal(L).accent, 2.5);
      AP.sfxAt('portal', cx, cy);
      L.completeLevel({ x: cx, y: cy });
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      var cx = e.rx + e.w / 2, cy = e.ry + e.h - 30;
      var sides = AP.R.formSides(L.form || 3);
      var t = e.s.spin;
      var b = beatPulse();
      AP.R.glow(ctx, cx, cy, 44, p.accent, 0.45 + 0.25 * b);
      // base ring on the floor
      ctx.strokeStyle = rgba(p.accent, 0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 20, e.ry + e.h - 1); ctx.lineTo(cx + 20, e.ry + e.h - 1);
      ctx.stroke();
      // counter-rotating world polygons
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = p.accent;
      AP.R.poly(ctx, cx, cy, 24 + 2 * b, sides, t * 0.9);
      ctx.fillStyle = rgba(p.accent, 0.08);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(p.ink, 0.8);
      AP.R.poly(ctx, cx, cy, 15, sides, -t * 1.6);
      ctx.stroke();
      // inward spiral of points
      ctx.fillStyle = p.ink;
      for (var i = 0; i < 12; i++) {
        var k = ((t * 0.7 + i / 12) % 1);
        var r = 26 * (1 - k);
        var a = i * 2.39996 + t * 2.2 + k * 3;
        ctx.globalAlpha = 0.2 + 0.8 * k;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.2 + k * 1.2, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 + b, 0, TAU);
      ctx.fill();
    }
  });

  // ================================================================ shard
  var SHARD_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
  function collectShard(e, L) {
    if (e.s.taken) return;
    e.s.taken = true;
    L.stats.shards++;
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    var chain = 0;
    if (L.time - (L.lastShardT === undefined ? -9 : L.lastShardT) < 0.6) chain = Math.min(SHARD_STEPS.length - 1, (L.shardChain || 0) + 1);
    L.shardChain = chain;
    L.lastShardT = L.time;
    AP.sfxAt('shard', cx, cy, { pitch: Math.pow(2, SHARD_STEPS[chain] / 12), vol: 0.8 });
    AP.FX.burst('shard', cx, cy);
    if (AP.Save && AP.Save.stat) AP.Save.stat('shards');
    L.emit('collect:shard', { count: L.stats.shards, total: L.stats.shardsTotal });
    L.remove(e);
  }

  E.register('shard', {
    kind: 'sensor', w: 14, h: 14, anchor: 'center', layer: 3, lint: 'ignore', renderPad: 32,
    init: function (e) {
      e.s.magnet = false;
      e.s.v = 0;
      e.s.taken = false;
      e.s.phase = ((e.homeX * 0.013 + e.homeY * 0.021) % 1) * TAU;
    },
    update: function (e, dt, L) {
      var P = L.player;
      if (!alive(P)) { e.s.magnet = false; e.s.v = 0; return; }
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (!e.s.magnet) {
        var qx = M.clamp(cx, P.x, P.x + P.w), qy = M.clamp(cy, P.y, P.y + P.h);
        var ddx = cx - qx, ddy = cy - qy;
        if (ddx * ddx + ddy * ddy <= 24 * 24) e.s.magnet = true;
      }
      if (e.s.magnet) {
        var tx = P.x + P.w / 2 - cx, ty = P.y + P.h / 2 - cy;
        var d = Math.sqrt(tx * tx + ty * ty);
        e.s.v = Math.min(900, e.s.v + 2600 * dt);
        var stp = Math.min(d, e.s.v * dt);
        if (d > 1e-6) { e.x += tx / d * stp; e.y += ty / d * stp; }
      }
    },
    onTouch: function (e, P, L) { collectShard(e, L); },
    render: function (e, ctx, L) {
      var p = pal(L);
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      var t = L.time + e.s.phase;
      var b = beatPulse();
      var sc = 1 + 0.16 * b;
      var bob = Math.sin(t * 2.6) * 2;
      var spin = Math.cos(t * 3.1);
      AP.R.glow(ctx, cx, cy + bob, 14, p.accent, 0.35 + 0.25 * b);
      ctx.beginPath();
      ctx.moveTo(cx, cy + bob - 7 * sc);
      ctx.lineTo(cx + 6 * sc * spin, cy + bob + 5 * sc);
      ctx.lineTo(cx - 6 * sc * spin, cy + bob + 5 * sc);
      ctx.closePath();
      ctx.fillStyle = rgba(p.accent, 0.45);
      ctx.fill();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  // ================================================================ gem
  E.register('gem', {
    kind: 'sensor', w: 22, h: 22, anchor: 'center', layer: 3, lint: 'ignore', renderPad: 48,
    init: function (e, spec, L) {
      var n = (spec && +spec.n) || 1;
      e.s.n = M.clamp(n | 0, 1, 3);
      e.s.owned = !!(L && L.gemOwned && L.gemOwned[e.s.n - 1]);
      e.s.got = false;
    },
    onTouch: function (e, P, L) {
      if (e.s.got || !alive(P)) return;
      e.s.got = true;
      var n = e.s.n;
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      L.stats.gems[n - 1] = true;
      if (L.mode === 'story' && AP.Levels.has(L.id) && AP.Save && AP.Save.setGem) AP.Save.setGem(L.id, n);
      AP.FX.burst('gem', cx, cy);
      AP.sfxAt('gem', cx, cy);
      L.flash(pal(L).accent, 0.12, 0.25);
      L.hitstop(0.05);
      L.shake(4, 0.2);
      L.emit('collect:gem', { n: n, id: L.id });
      L.remove(e);
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      var t = L.time;
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2 + Math.sin(t * 2 + e.s.n) * 2.5;
      var ghost = e.s.owned;
      var b = beatPulse();
      if (!ghost) AP.R.glow(ctx, cx, cy, 26, p.accent, 0.5 + 0.3 * b);
      var w = 9, h = 12;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h); ctx.lineTo(cx + w, cy - 3); ctx.lineTo(cx, cy + h); ctx.lineTo(cx - w, cy - 3);
      ctx.closePath();
      if (!ghost) { ctx.fillStyle = rgba(p.accent, 0.35); ctx.fill(); }
      ctx.lineWidth = 2;
      ctx.strokeStyle = ghost ? rgba(p.accent, 0.45) : p.accent;
      ctx.stroke();
      // facets
      ctx.lineWidth = 1;
      ctx.strokeStyle = ghost ? rgba(p.accent, 0.3) : rgba(p.ink, 0.7);
      ctx.beginPath();
      ctx.moveTo(cx - w, cy - 3); ctx.lineTo(cx + w, cy - 3);
      ctx.moveTo(cx, cy - h); ctx.lineTo(cx - 3.5, cy - 3); ctx.lineTo(cx, cy + h); ctx.lineTo(cx + 3.5, cy - 3); ctx.closePath();
      ctx.stroke();
      // number pips (1..3) and the orbiting dot
      ctx.fillStyle = ghost ? rgba(p.accent, 0.4) : p.ink;
      for (var i = 0; i < e.s.n; i++) {
        ctx.beginPath();
        ctx.arc(cx - (e.s.n - 1) * 3 + i * 6, cy + h + 6, 1.4, 0, TAU);
        ctx.fill();
      }
      var oa = t * 2.6 + e.s.n * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(oa) * 16, cy + Math.sin(oa) * 7, 2, 0, TAU);
      ctx.fill();
    }
  });

  // ================================================================ sign
  E.register('sign', {
    kind: 'sensor', w: 32, h: 32, anchor: 'floor', layer: 1, lint: 'ignore', renderPad: 420,
    init: function (e, spec) {
      e.s.raw = String((spec && spec.text) || '');
      e.s.text = labelText(e.s.raw);
      e.s.k = 0;
      e.s.refresh = 0;
    },
    update: function (e, dt, L) {
      var P = L.player;
      var near = false;
      if (alive(P)) {
        var dx = (P.x + P.w / 2) - (e.x + e.w / 2), dy = (P.y + P.h / 2) - (e.y + e.h / 2);
        near = Math.abs(dx) <= 64 + 16 && Math.abs(dy) <= 80;
      }
      e.s.k = M.approach(e.s.k, near ? 1 : 0, dt * (near ? 6 : 4));
      if (e.s.k > 0) {
        e.s.refresh -= dt;
        if (e.s.refresh <= 0) { e.s.refresh = 0.5; e.s.text = labelText(e.s.raw); }
      }
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      var cx = e.rx + e.w / 2, by = e.ry + e.h;
      // post
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, by); ctx.lineTo(cx, by - 12);
      ctx.stroke();
      // board: a small hexagon with a glyph
      ctx.fillStyle = rgba(p.accent, 0.14 + 0.2 * e.s.k);
      AP.R.poly(ctx, cx, by - 20, 10, 6, 0);
      ctx.fill();
      ctx.strokeStyle = p.accent;
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 4, by - 22); ctx.lineTo(cx + 4, by - 22);
      ctx.moveTo(cx - 4, by - 18); ctx.lineTo(cx + 2, by - 18);
      ctx.stroke();
      var k = e.s.k;
      if (k <= 0.01 || !e.s.text) return;
      var ek = AP.M.ease.outCubic(k);
      var lines = AP.R.wrap(ctx, e.s.text, 300, 14, '600');
      var wmax = 0;
      for (var i = 0; i < lines.length; i++) wmax = Math.max(wmax, AP.R.measure(ctx, lines[i], 14, '600'));
      var bw = Math.min(330, wmax + 26), bh = lines.length * 19 + 16;
      var bx = cx - bw / 2, byy = by - 40 - bh - (1 - ek) * 10;
      // keep the bubble on screen horizontally
      var cam = L.cam;
      if (cam) {
        var left = cam.renderX + 8, right = cam.renderX + 952;
        if (bx < left) bx = left;
        if (bx + bw > right) bx = right - bw;
      }
      ctx.globalAlpha = ek;
      ctx.fillStyle = rgba(p.bg, 0.86);
      ctx.strokeStyle = rgba(p.accent, 0.85);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx + 6, byy); ctx.lineTo(bx + bw - 6, byy); ctx.lineTo(bx + bw, byy + 6); ctx.lineTo(bx + bw, byy + bh - 6);
      ctx.lineTo(bx + bw - 6, byy + bh); ctx.lineTo(cx + 6, byy + bh); ctx.lineTo(cx, byy + bh + 7); ctx.lineTo(cx - 6, byy + bh);
      ctx.lineTo(bx + 6, byy + bh); ctx.lineTo(bx, byy + bh - 6); ctx.lineTo(bx, byy + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      SIGN_TXT.color = p.ink;
      for (var j = 0; j < lines.length; j++) AP.R.text(ctx, lines[j], bx + bw / 2, byy + 8 + 14 + j * 19, SIGN_TXT);
      ctx.globalAlpha = 1;
    }
  });
  var SIGN_TXT = { size: 14, weight: '600', align: 'center', baseline: 'alphabetic', color: '#fff' };

  // ================================================================ bounce
  E.register('bounce', {
    kind: 'sensor', w: 32, h: 12, anchor: 'floor', layer: 2, lint: 'bounce', renderPad: 48,
    init: function (e, spec) {
      var d = spec && spec.dir;
      e.s.dir = (d === 'left' || d === 'right') ? d : 'up';
      e.s.cd = 0;
      e.s.sp = 0;
      e.s.spV = 0;
    },
    update: function (e, dt) {
      if (e.s.cd > 0) e.s.cd -= dt;
      e.s.spV += (-e.s.sp * 380 - e.s.spV * 11) * dt;
      e.s.sp += e.s.spV * dt;
    },
    onTouch: function (e, P, L) {
      if (e.s.cd > 0 || !alive(P) || P.state === 'frozen') return;
      var cx = e.x + e.w / 2, top = e.y;
      var ang;
      if (e.s.dir === 'up') {
        if (P.vy < 0 && P.state !== 'dash') return;
        P.launch(null, -C.BOUNCE_V, { refresh: true, noCut: true });
        ang = -Math.PI / 2;
      } else {
        var s = e.s.dir === 'left' ? -1 : 1;
        P.launch(s * C.BOUNCE_SIDE_VX, -C.BOUNCE_SIDE_VY, { refresh: true, noCut: true, lock: 0.18 });
        P.facing = s;
        ang = s > 0 ? -Math.PI * 0.2 : -Math.PI * 0.8;
      }
      e.s.cd = 0.15;
      e.s.sp = 1;
      e.s.spV = -6;
      AP.FX.burst('bounce', cx, top, { dir: ang });
      AP.sfxAt('bounce', cx, top);
      L.kick(Math.cos(ang) * 3, Math.sin(ang) * 4);
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      var x = e.rx, y = e.ry, w = e.w, h = e.h;
      var comp = M.clamp(e.s.sp, -0.6, 1);
      var topY = y + 2 - comp * 5;
      // base
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h); ctx.lineTo(x + 6, y + h - 4); ctx.lineTo(x + w - 6, y + h - 4); ctx.lineTo(x + w - 2, y + h);
      ctx.closePath();
      ctx.fillStyle = rgba(p.primary, 0.25);
      ctx.fill();
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      ctx.stroke();
      // spring zigzag
      ctx.strokeStyle = rgba(p.ink, 0.7);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      var segs = 5;
      for (var i = 0; i <= segs; i++) {
        var yy = (y + h - 4) + (topY + 3 - (y + h - 4)) * (i / segs);
        var xx = x + w / 2 + ((i % 2) ? 7 : -7);
        if (i === 0) ctx.moveTo(x + w / 2, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      // pad with chevrons in the launch direction
      ctx.beginPath();
      ctx.moveTo(x + 3, topY + 3); ctx.lineTo(x + 7, topY); ctx.lineTo(x + w - 7, topY); ctx.lineTo(x + w - 3, topY + 3);
      ctx.closePath();
      ctx.fillStyle = rgba(p.accent, 0.5 + 0.3 * beatPulse());
      ctx.fill();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      var cx = x + w / 2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (e.s.dir === 'up') {
        for (var c = 0; c < 2; c++) {
          var cy = topY - 6 - c * 6 - (L.time * 14 % 6);
          ctx.moveTo(cx - 5, cy + 4); ctx.lineTo(cx, cy); ctx.lineTo(cx + 5, cy + 4);
        }
      } else {
        var sd = e.s.dir === 'left' ? -1 : 1;
        for (var c2 = 0; c2 < 2; c2++) {
          var ox = cx + sd * (4 + c2 * 6 + (L.time * 14 % 6));
          ctx.moveTo(ox - sd * 4, topY - 10); ctx.lineTo(ox, topY - 6); ctx.lineTo(ox - sd * 4, topY - 2);
        }
      }
      ctx.stroke();
      if (e.s.cd > 0) AP.R.glow(ctx, cx, topY, 26, p.accent, e.s.cd / 0.15 * 0.7);
    }
  });

  // ================================================================ crumble
  function crumbleClear(e, L) {
    var A = L.actors;
    for (var i = 0; i < A.length; i++) {
      var a = A[i];
      if (a.dead) continue;
      if (a.x < e.x + e.w && a.x + a.w > e.x && a.y < e.y + e.h && a.y + a.h > e.y) return false;
    }
    return true;
  }

  E.register('crumble', {
    kind: 'solid', w: 32, h: 32, anchor: 'tile', layer: 1, lint: 'stand', renderPad: 48,
    init: function (e, spec) {
      e.s.delay = tiles(spec && spec.delay, C.CRUMBLE_DELAY);
      e.s.respawn = tiles(spec && spec.respawn, C.CRUMBLE_RESPAWN);
      e.s.st = 'idle';
      e.s.t = 0;
      e.s.fade = 1;
    },
    update: function (e, dt, L) {
      var s = e.s;
      var P = L.player;
      if (s.st === 'idle') {
        if (alive(P) && P.isRiding(e)) {
          s.st = 'shaking';
          s.t = 0;
          AP.sfxAt('crumble', e.x + 16, e.y, { vol: 0.45, pitch: 1.3 });
          AP.FX.burst('dust', e.x + 16, e.y, { n: 3 });
        }
      } else if (s.st === 'shaking') {
        s.t += dt;
        if (s.t >= s.delay) {
          s.st = 'gone';
          s.t = 0;
          e.collidable = false;
          AP.FX.burst('crumble', e.x + 16, e.y + 16);
          AP.sfxAt('crumble', e.x + 16, e.y + 16);
        }
      } else if (s.st === 'gone') {
        s.t += dt;
        if (s.t >= s.respawn && crumbleClear(e, L)) {
          s.st = 'back';
          s.fade = 0;
          e.collidable = true;
          AP.FX.ring(e.x + 16, e.y + 16, 4, 26, 0.3, pal(L).primary, 1.5);
        }
      } else if (s.st === 'back') {
        s.fade += dt * 4;
        if (s.fade >= 1) { s.fade = 1; s.st = 'idle'; }
      }
    },
    onRespawn: function (e, L) {
      if (crumbleClear(e, L)) {
        e.s.st = 'idle';
        e.s.t = 0;
        e.s.fade = 1;
        e.collidable = true;
      } else {
        e.s.st = 'gone';
        e.s.t = e.s.respawn;
      }
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      var s = e.s;
      var x = e.rx, y = e.ry;
      if (s.st === 'gone') {
        // dotted ghost outline where it will return
        var k = M.clamp(s.t / s.respawn, 0, 1);
        ctx.strokeStyle = rgba(p.primary, 0.12 + 0.25 * k);
        ctx.lineWidth = 1;
        ctx.setLineDash(DOTS);
        ctx.strokeRect(x + 3, y + 3, 26, 26);
        ctx.setLineDash(NODASH);
        return;
      }
      var jx = 0, jy = 0, crack = 0;
      if (s.st === 'shaking') {
        var q = s.t / s.delay;
        jx = Math.sin(s.t * 70) * (1 + 2 * q);
        jy = Math.cos(s.t * 53) * 0.8 * q;
        crack = q;
      }
      var a = s.st === 'back' ? s.fade : 1;
      ctx.globalAlpha = a;
      x += jx; y += jy;
      ctx.fillStyle = rgba(p.primary, 0.14);
      ctx.fillRect(x + 1, y + 1, 30, 30);
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, 30, 30);
      // brick seams + cracks that widen while shaking (crumble reads clearly as fragile)
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(p.primary, 0.6);
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 16); ctx.lineTo(x + 31, y + 16);
      ctx.moveTo(x + 12, y + 1); ctx.lineTo(x + 12, y + 16);
      ctx.moveTo(x + 22, y + 16); ctx.lineTo(x + 22, y + 31);
      ctx.stroke();
      ctx.strokeStyle = rgba(p.accent, 0.35 + 0.6 * crack);
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 4); ctx.lineTo(x + 10 + crack * 3, y + 10); ctx.lineTo(x + 7, y + 15);
      ctx.moveTo(x + 25, y + 19); ctx.lineTo(x + 19 - crack * 3, y + 24); ctx.lineTo(x + 24, y + 29);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });
  var DOTS = [3, 4];
  var NODASH = [];

  // ================================================================ node (orbit)
  function nodePos(e, t, out) {
    var s = e.s;
    if (s.liss) return AP.Path.liss(s.liss, t, out);
    if (s.pts && s.pts.length > 1) return AP.Path.poly(s.pts, s.speed, s.mode, t, out, s.wait);
    out.x = s.hx;
    out.y = s.hy;
    return out;
  }

  E.register('node', {
    kind: 'sensor', w: 24, h: 24, anchor: 'center', layer: 4, orbitNode: true, lint: 'orbit', renderPad: 140,
    init: function (e, spec) {
      var s = e.s;
      s.hx = e.x + e.w / 2;
      s.hy = e.y + e.h / 2;
      s.liss = null;
      s.pts = null;
      if (spec && spec.liss && typeof spec.liss === 'object') {
        s.liss = AP.Path.lissFromSpec(spec.liss, s.hx, s.hy);
      } else if (spec && Array.isArray(spec.path) && spec.path.length > 1) {
        s.pts = AP.Entities.pathWorld(spec.path, 'center');
        s.speed = tiles(spec.speed, 3) * 32;
        s.mode = spec.mode || 'loop';
        s.wait = tiles(spec.wait, 0);
      }
      s.glow = 0;
      // cached preview trace of the motion (one period / the polyline)
      s.trace = null;
      if (s.liss) {
        var per = s.liss.period, tr = [];
        for (var i = 0; i <= 72; i++) { AP.Path.liss(s.liss, per * i / 72, lissOut); tr.push(lissOut.x, lissOut.y); }
        s.trace = tr;
      } else if (s.pts) {
        var tp = [];
        for (var j = 0; j < s.pts.length; j++) tp.push(s.pts[j][0], s.pts[j][1]);
        if (s.mode === 'loop') tp.push(s.pts[0][0], s.pts[0][1]);
        s.trace = tp;
      }
      nodePos(e, 0, pathOut);
      e.x = pathOut.x - e.w / 2;
      e.y = pathOut.y - e.h / 2;
      e.px = e.x; e.py = e.y; e.rx = e.x; e.ry = e.y;
    },
    update: function (e, dt, L) {
      var s = e.s;
      if (s.liss || s.pts) {
        nodePos(e, L.time, pathOut);
        e.x = pathOut.x - e.w / 2;
        e.y = pathOut.y - e.h / 2;
      }
      var P = L.player;
      var target = 0;
      if (P && P.orbitNode === e) target = 1;
      else if (alive(P) && P.ab && P.ab.orbit) {
        var dx = P.x + P.w / 2 - (e.x + e.w / 2), dy = P.y + P.h / 2 - (e.y + e.h / 2);
        if (dx * dx + dy * dy <= C.ORBIT_RANGE * C.ORBIT_RANGE) target = 0.5;
      }
      s.glow = M.approach(s.glow, target, dt * 5);
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      var s = e.s;
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      var b = beatPulse();
      if (s.trace) {
        ctx.strokeStyle = rgba(p.accent, 0.12);
        ctx.lineWidth = 1;
        ctx.setLineDash(DOTS);
        ctx.beginPath();
        ctx.moveTo(s.trace[0], s.trace[1]);
        for (var i = 2; i < s.trace.length; i += 2) ctx.lineTo(s.trace[i], s.trace[i + 1]);
        ctx.stroke();
        ctx.setLineDash(NODASH);
      }
      if (s.glow > 0.02) {
        ctx.strokeStyle = rgba(p.accent, 0.1 + 0.12 * s.glow);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, C.ORBIT_RANGE, 0, TAU);
        ctx.stroke();
      }
      AP.R.glow(ctx, cx, cy, 24 + 10 * s.glow, p.accent, 0.35 + 0.45 * s.glow + 0.15 * b);
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10 + 1.5 * b, 0, TAU);
      ctx.stroke();
      // four rotating ticks
      var t = L.time * (1.2 + s.glow * 2.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var k = 0; k < 4; k++) {
        var a = t + k * Math.PI / 2;
        ctx.moveTo(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13);
        ctx.lineTo(cx + Math.cos(a) * 17, cy + Math.sin(a) * 17);
      }
      ctx.stroke();
      ctx.fillStyle = s.glow > 0.6 ? p.ink : p.accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, TAU);
      ctx.fill();
    }
  });

  // ================================================================ vertex
  function activateVertex(e, L) {
    if (!e || e.s.on) return false;
    e.s.on = true;
    e.s.appear = 0;
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    AP.FX.burst('vertex', cx, cy);
    AP.sfxAt('chime', cx, cy);
    if (L) L.flash(pal(L).ink, 0.18, 0.3);
    return true;
  }

  E.register('vertex', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 6, lint: 'ignore', renderPad: 200,
    init: function (e, spec, L) {
      e.s.on = !(L && L.boss);
      e.s.appear = e.s.on ? 1 : 0;
      e.s.taken = false;
      e.s.inf = !!(L && L.world === 5) || !!(spec && spec.infinity);
    },
    update: function (e, dt) {
      if (e.s.on && e.s.appear < 1) e.s.appear = Math.min(1, e.s.appear + dt / 0.8);
    },
    onTouch: function (e, P, L) {
      if (!e.s.on || e.s.appear < 0.6 || e.s.taken || L.ended || !alive(P)) return;
      e.s.taken = true;
      var W = AP.Worlds && AP.Worlds.get(L.world);
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      AP.FX.burst('vertex', cx, cy);
      AP.sfxAt('vertex', cx, cy);
      L.completeLevel({ grantForm: W ? W.reward : 0, ending: !!(W && W.n === 5), x: cx, y: cy, vertex: true });
    },
    render: function (e, ctx, L) {
      if (!e.s.on || e.s.taken) return;
      var p = pal(L);
      var k = AP.M.ease.outBack(M.clamp(e.s.appear, 0, 1));
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2 + Math.sin(L.time * 1.7) * 3;
      var t = L.time;
      var b = beatPulse();
      AP.R.glow(ctx, cx, cy, 46 * k, p.accent, 0.7);
      AP.R.glow(ctx, cx, cy, 18 * k, p.ink, 0.9);
      // orbiting rays
      ctx.lineCap = 'round';
      for (var i = 0; i < 8; i++) {
        var a = t * 0.8 + i * TAU / 8;
        var r0 = 9 * k, r1 = (20 + 6 * Math.sin(t * 3 + i) + 4 * b) * k;
        ctx.strokeStyle = i % 2 ? rgba(p.ink, 0.8) : p.accent;
        ctx.lineWidth = i % 2 ? 1.5 : 2.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5 * k, 0, TAU);
      ctx.fill();
      if (e.s.inf) {
        // the infinity sign of the final vertex (a lemniscate)
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var j = 0; j <= 48; j++) {
          var u = j / 48 * TAU;
          var d = 1 + Math.sin(u) * Math.sin(u);
          var lx = cx + 16 * k * Math.cos(u) / d, ly = cy - 30 * k + 16 * k * Math.sin(u) * Math.cos(u) / d;
          if (j === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
        }
        ctx.stroke();
      }
    }
  });

  // ================================================================ mover
  E.register('mover', {
    kind: 'solid', anchor: 'tile', layer: 1, lint: 'mover', required: ['path'], renderPad: 64,
    size: function (spec) {
      var w = Math.max(1, tiles(spec.w, 3)) * 32;
      var h = spec.oneWay ? 12 : Math.max(1, tiles(spec.h, 1)) * 32;
      return [w, h];
    },
    init: function (e, spec) {
      var s = e.s;
      e.oneWay = !!spec.oneWay;
      s.pts = AP.Entities.pathWorld(spec.path, 'tile');
      if (!s.pts.length) s.pts = [[e.x, e.y]];
      s.speed = Math.max(0.05, tiles(spec.speed, 3)) * 32;
      s.mode = spec.mode === 'loop' || spec.mode === 'once' ? spec.mode : 'pingpong';
      s.wait = Math.max(0, tiles(spec.wait, 0.4));
      s.trigger = !!spec.trigger;
      s.running = false;
      s.done = false;
      s.runT = 0;
      s.light = 0;
      var x0 = Math.round(s.pts[0][0]), y0 = Math.round(s.pts[0][1]);
      e.setPos(x0, y0);
      e.homeX = x0;
      e.homeY = y0;
    },
    update: function (e, dt, L) {
      var s = e.s;
      if (s.pts.length < 2) return;
      if (s.trigger) {
        if (!s.running && !s.done) {
          var P = L.player;
          if (alive(P) && P.isRiding(e)) {
            s.running = true;
            s.runT = 0;
            AP.sfxAt('whoosh', e.x + e.w / 2, e.y, { vol: 0.6 });
          }
        }
        if (!s.running) { e.vx = 0; e.vy = 0; s.light = M.approach(s.light, s.done ? 0.3 : 0, dt * 3); return; }
        s.runT += dt;
        s.light = M.approach(s.light, 1, dt * 6);
        AP.Path.poly(s.pts, s.speed, 'once', s.runT, pathOut, s.wait);
        if (pathOut.i === s.pts.length - 1 && pathOut.wait) { s.running = false; s.done = true; }
      } else {
        AP.Path.poly(s.pts, s.speed, s.mode, L.time, pathOut, s.wait);
      }
      var dx = pathOut.x - (e.x + e.xRem), dy = pathOut.y - (e.y + e.yRem);
      e.moveSolid(dx, dy);
      e.vx = dx / dt;
      e.vy = dy / dt;
    },
    onRespawn: function (e, L) {
      var s = e.s;
      if (!s.trigger) return;
      s.running = false;
      s.done = false;
      s.runT = 0;
      var P = L.player;
      var x0 = Math.round(s.pts[0][0]), y0 = Math.round(s.pts[0][1]);
      if (P && P.x < x0 + e.w && P.x + P.w > x0 && P.y < y0 + e.h && P.y + P.h > y0) return;
      e.setPos(x0, y0);
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      var x = e.rx, y = e.ry, w = e.w, h = e.h;
      if (e.oneWay) {
        ctx.fillStyle = rgba(p.primary, 0.3);
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + 1); ctx.lineTo(x + w, y + 1);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(p.primary, 0.55);
        ctx.beginPath();
        for (var i = 8; i < w; i += 12) { ctx.moveTo(x + i - 4, y + 4); ctx.lineTo(x + i, y + h - 1); ctx.lineTo(x + i + 4, y + 4); }
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(p.primary, 0.16);
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        // inner rail + bolts
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(p.primary, 0.45);
        ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
        ctx.fillStyle = rgba(p.primary, 0.8);
        for (var b = 0; b < 4; b++) {
          var bx = (b % 2) ? x + w - 8 : x + 8, by = (b < 2) ? y + 8 : y + h - 8;
          AP.R.poly(ctx, bx, by, 2.2, 6, 0);
          ctx.fill();
        }
      }
      // direction chevrons (motion telegraph)
      var sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
      if (sp > 4) {
        var ux = e.vx / sp, uy = e.vy / sp;
        var cx = x + w / 2, cy = y + h / 2;
        ctx.strokeStyle = rgba(p.accent, 0.55);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (var c = -1; c <= 1; c += 2) {
          var ox = cx + ux * c * 7, oy = cy + uy * c * Math.min(7, h / 3);
          ctx.moveTo(ox - ux * 3 - uy * 4, oy - uy * 3 + ux * 4);
          ctx.lineTo(ox + ux * 3, oy + uy * 3);
          ctx.lineTo(ox - ux * 3 + uy * 4, oy - uy * 3 - ux * 4);
        }
        ctx.stroke();
      }
      if (e.s.trigger) {
        var lx = x + w / 2, ly = e.oneWay ? y - 6 : y + h / 2;
        ctx.fillStyle = e.s.light > 0.1 ? p.accent : rgba(p.accent, 0.35);
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, TAU);
        ctx.fill();
        if (e.s.light > 0.05) AP.R.glow(ctx, lx, ly, 14, p.accent, e.s.light * 0.8);
      }
    }
  });

  // ================================================================ secretwall
  E.register('secretwall', {
    kind: 'sensor', anchor: 'tile', layer: 8, lint: 'ignore', renderPad: 32,
    size: function (spec) { return [Math.max(1, tiles(spec.w, 1)) * 32, Math.max(1, tiles(spec.h, 1)) * 32]; },
    init: function (e, spec) {
      e.s.cells = Array.isArray(spec.cells) ? spec.cells : [];
      if (!e.s.cells.length) {
        var tx0 = Math.floor(e.x / 32), ty0 = Math.floor(e.y / 32);
        for (var yy = 0; yy < e.h / 32; yy++) for (var xx = 0; xx < e.w / 32; xx++) e.s.cells.push([tx0 + xx, ty0 + yy]);
      }
      e.s.found = false;
      e.s.fade = 0;
    },
    update: function (e, dt, L) {
      if (!e.s.found) return;
      e.s.fade += dt;
      if (e.s.fade >= 0.6) L.remove(e);
    },
    onTouch: function (e, P, L) {
      if (e.s.found || !alive(P)) return;
      var cells = e.s.cells;
      var hit = false;
      for (var i = 0; i < cells.length && !hit; i++) {
        var cx = cells[i][0] * 32, cy = cells[i][1] * 32;
        if (P.x < cx + 32 && P.x + P.w > cx && P.y < cy + 32 && P.y + P.h > cy) hit = true;
      }
      if (!hit) return;
      e.s.found = true;
      for (var j = 0; j < cells.length; j++) {
        if (L.tileAt(cells[j][0], cells[j][1]) === AP.TILE.FAKE) L.setTile(cells[j][0], cells[j][1], AP.TILE.EMPTY);
      }
      L.stats.secrets++;
      if (AP.Save && AP.Save.stat) AP.Save.stat('secrets');
      var px = P.x + P.w / 2, py = P.y + P.h / 2;
      AP.FX.burst('secret', px, py);
      AP.sfxAt('secret', px, py);
      L.emit('secret:found', { x: px, y: py });
    },
    render: function (e, ctx, L) {
      if (!e.s.found) return;
      var p = pal(L);
      var a = 1 - M.clamp(e.s.fade / 0.6, 0, 1);
      var cells = e.s.cells;
      ctx.globalAlpha = a;
      ctx.fillStyle = rgba(p.primary, 0.16);
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2;
      for (var i = 0; i < cells.length; i++) {
        var x = cells[i][0] * 32, y = cells[i][1] * 32;
        var grow = (1 - a) * 6;
        ctx.fillRect(x - grow / 2, y - grow / 2, 32 + grow, 32 + grow);
        ctx.strokeRect(x + 1 - grow / 2, y + 1 - grow / 2, 30 + grow, 30 + grow);
      }
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1.5;
      for (var j = 0; j < cells.length; j++) ctx.strokeRect(cells[j][0] * 32 + 4, cells[j][1] * 32 + 4, 24, 24);
      ctx.globalAlpha = 1;
    }
  });

  // ================================================================ trigger
  E.register('trigger', {
    kind: 'sensor', anchor: 'tile', layer: 0, lint: 'ignore', required: ['event'], renderPad: 0,
    size: function (spec) { return [Math.max(1, tiles(spec.w, 1)) * 32, Math.max(1, tiles(spec.h, 1)) * 32]; },
    init: function (e, spec) {
      e.s.event = String(spec.event || '');
      e.s.once = spec.once !== false;
      e.s.fired = false;
      if (e.s.event && !/^(w[1-5]|ui|endless):/.test(e.s.event)) {
        AP.warnOnce('trigger-event:' + e.s.event, 'trigger: event "' + e.s.event + '" must be prefixed (w1:..w5:, ui:, endless:)');
      }
    },
    onTouch: function (e, P, L, first) {
      if (!first) return;
      if (e.s.once && e.s.fired) return;
      e.s.fired = true;
      var tag = e.tag !== null && e.tag !== undefined ? e.tag : (e.spec.tag !== undefined ? e.spec.tag : null);
      if (tag !== null) L.flags[tag] = true;
      if (e.s.event) L.emit(e.s.event, { tag: tag });
    }
  });

  // ================================================================ camzone
  E.register('camzone', {
    kind: 'sensor', anchor: 'tile', layer: 0, lint: 'ignore', renderPad: 0,
    size: function (spec) { return [Math.max(1, tiles(spec.w, 30)) * 32, Math.max(1, tiles(spec.h, 17)) * 32]; },
    init: function (e) { e.s.inside = false; e.s.rect = { x: e.x, y: e.y, w: e.w, h: e.h }; },
    update: function (e, dt, L) {
      var P = L.player;
      if (!P || !L.cam) return;
      var cx = P.x + P.w / 2, cy = P.y + P.h / 2;
      var inside = P.state !== 'dead' && cx >= e.x && cx < e.x + e.w && cy >= e.y && cy < e.y + e.h;
      if (inside && !e.s.inside) {
        e.s.rect.x = e.x; e.s.rect.y = e.y; e.s.rect.w = e.w; e.s.rect.h = e.h;
        L.cam.lock(e.s.rect, { owner: e });
      } else if (!inside && e.s.inside && L.cam.lockOwner === e) {
        L.cam.lock(null);
      }
      e.s.inside = inside;
    },
    onRemove: function (e, L) {
      if (L.cam && L.cam.lockOwner === e) L.cam.lock(null);
    }
  });

  // ================================================================ killzone
  E.register('killzone', {
    kind: 'sensor', anchor: 'tile', layer: 1, hazard: true, lint: 'hazard', renderPad: 16,
    size: function (spec) { return [Math.max(1, tiles(spec.w, 1)) * 32, Math.max(1, tiles(spec.h, 1)) * 32]; },
    render: function (e, ctx, L) {
      var p = pal(L);
      var x = e.rx, y = e.ry, w = e.w, h = e.h;
      var b = beatPulse();
      ctx.fillStyle = rgba(p.hazard, 0.1 + 0.06 * b);
      ctx.fillRect(x, y + 6, w, h - 6);
      // spiky top edge: reads as deadly without colour
      ctx.beginPath();
      var n = Math.max(1, Math.round(w / 10));
      var sw = w / n;
      ctx.moveTo(x, y + 8);
      for (var i = 0; i < n; i++) { ctx.lineTo(x + sw * (i + 0.5), y); ctx.lineTo(x + sw * (i + 1), y + 8); }
      ctx.fillStyle = rgba(p.hazard, 0.45);
      ctx.fill();
      ctx.strokeStyle = p.hazard;
      ctx.lineWidth = 2;
      ctx.stroke();
      // faint hatch
      ctx.strokeStyle = rgba(p.hazard, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var k = -h; k < w; k += 14) { ctx.moveTo(x + Math.max(0, k), y + 8 + Math.max(0, -k)); ctx.lineTo(x + Math.min(w, k + h - 8), y + 8 + Math.min(h - 8, w - k)); }
      ctx.stroke();
    }
  });

  // ================================================================ text
  var TEXT_O = { size: 16, color: '#fff', align: 'center', baseline: 'middle', weight: '600', alpha: 0.9 };
  E.register('text', {
    kind: 'sensor', w: 32, h: 32, anchor: 'center', layer: 0, lint: 'ignore', required: ['text'], renderPad: 640,
    init: function (e, spec) {
      e.s.raw = String((spec && spec.text) || '');
      e.s.text = labelText(e.s.raw);
      e.s.size = tiles(spec && spec.size, 16);
      e.s.role = (spec && spec.role) || 'ink';
    },
    render: function (e, ctx, L) {
      var p = pal(L);
      TEXT_O.size = e.s.size;
      TEXT_O.color = p[e.s.role] || p.ink;
      AP.R.text(ctx, e.s.text, e.rx + e.w / 2, e.ry + e.h / 2, TEXT_O);
    }
  });

  // ================================================================ missing (placeholder for unknown types)
  var MISS_O = { size: 18, color: '#FF00FF', align: 'center', baseline: 'middle', weight: '800' };
  E.register('missing', {
    kind: 'sensor', w: 32, h: 32, anchor: 'floor', layer: 0, lint: 'ignore',
    render: function (e, ctx) {
      ctx.strokeStyle = '#FF00FF';
      ctx.lineWidth = 2;
      ctx.setLineDash(DOTS);
      ctx.strokeRect(e.rx + 1, e.ry + 1, e.w - 2, e.h - 2);
      ctx.setLineDash(NODASH);
      AP.R.text(ctx, '?', e.rx + e.w / 2, e.ry + e.h / 2 + 1, MISS_O);
    }
  });

  AP.Common = {
    labelText: labelText,
    collectShard: collectShard,
    activateVertex: activateVertex,
    nodePos: nodePos
  };
})(window.AP = window.AP || {});
