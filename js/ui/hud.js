/* js/ui/hud.js — owner: UI */
(function (AP) {
  'use strict';

  // AP.HUD (CONTRACT 2.19, DESIGN 7): the in-level overlay, drawn in screen space after the world.
  //   top-left      form glyph, then shards x/y          top-centre   boss bar (stroke-font name, one segment per phase)
  //   top-right     3 gem slots, then deaths             bottom-right timer (settings.showTimer) with par
  //   bottom-left   assist badge                         cards        2 s level name card; the first-entry world card
  // Thin lines only. Every region fades back when the player moves under it, so it never covers the player.
  var TAU = Math.PI * 2;
  var M = AP.M;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function settings() { return (AP.Save && AP.Save.data && AP.Save.data.settings) || {}; }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; return Math.pow(1 - ph, 3); }

  var S = {
    L: null,
    startT: 0, endT: -1,
    gemsInLevel: 0,
    shardT: -9, shardFull: false, shardFullT: -9,
    gemT: [-9, -9, -9],
    deathT: -9, deaths: 0,
    cpT: -9, secretT: -9,
    card: null,                  // {kind:'name'|'world', t0, dur, world, title, sub, label}
    boss: { on: false, t0: 0, ghost: 1, frac: 1, hitT: -9, ghostHoldT: 0, phaseT: -9, shake: 0, doneT: -9 },
    reg: { tl: 1, tr: 1, tc: 1, br: 1, bl: 1, card: 1 },
    listening: false
  };

  // ---------------------------------------------------------------- events (global listeners, one set)
  function live(L) { return L && L === S.L && AP.level === L; }

  function listen() {
    if (S.listening || !AP.Events) return;
    S.listening = true;
    var E = AP.Events;
    E.on('collect:shard', function (p) {
      var L = AP.level;
      if (!live(L)) return;
      S.shardT = L.time;
      if (p && p.total > 0 && p.count >= p.total && !S.shardFull) {
        S.shardFull = true;
        S.shardFullT = L.time;
        sparkAt(92, 34, L.pal.accent, 18);
      }
    });
    E.on('collect:gem', function (p) {
      var L = AP.level;
      if (!live(L) || !p) return;
      var n = (p.n | 0) - 1;
      if (n < 0 || n > 2) return;
      S.gemT[n] = L.time;
      var gx = gemX(n);
      sparkAt(gx, 34, L.pal.accent, 16);
      if (AP.UI) AP.UI.sparks.emit(gx, 34, { n: 1, color: L.pal.ink, shape: 4, speed: [0, 0], life: [0.5, 0.5], size: [7, 7] });
    });
    E.on('player:death', function () {
      var L = AP.level;
      if (!live(L)) return;
      S.deathT = L.time;
    });
    E.on('checkpoint', function (p) {
      var L = AP.level;
      if (!live(L) || !p || p.index < 0) return;
      S.cpT = L.time;
    });
    E.on('secret:found', function () {
      var L = AP.level;
      if (!live(L)) return;
      S.secretT = L.time;
    });
    E.on('boss:start', function () {
      var L = AP.level;
      if (!live(L)) return;
      S.boss.on = true;
      S.boss.t0 = L.time;
      S.boss.ghost = 1;
      S.boss.frac = 1;
      S.boss.doneT = -9;
    });
    E.on('boss:hit', function (p) {
      var L = AP.level;
      if (!live(L)) return;
      S.boss.hitT = L.time;
      S.boss.ghostHoldT = 0.4;
      S.boss.shake = 1;
      if (p && p.frac !== undefined) {
        var x = barX0() + BAR_W * clamp01(p.frac);
        sparkAt(x, BAR_Y + 3, L.pal.hazard, 10);
      }
    });
    E.on('boss:phase', function () {
      var L = AP.level;
      if (!live(L)) return;
      S.boss.phaseT = L.time;
      S.boss.shake = Math.max(S.boss.shake, 0.8);
    });
    E.on('boss:defeat', function () {
      var L = AP.level;
      if (!live(L)) return;
      S.boss.doneT = L.time;
      sparkAt(480, BAR_Y + 3, L.pal.ink, 26);
    });
  }

  function sparkAt(x, y, color, n) {
    if (!AP.UI || !AP.UI.sparks) return;
    AP.UI.sparks.emit(x, y, { n: n, color: color, color2: '#FFFFFF', speed: [40, 170], life: [0.3, 0.7], size: [1, 2.4], drag: 3, shape: 3 });
  }

  // ---------------------------------------------------------------- level lifecycle
  function flagKey(n) { return 'world' + n + 'Seen'; }

  function makeCard(L) {
    var UI = AP.UI;
    var data = AP.Save && AP.Save.data;
    var W = L.world > 0 && AP.Worlds ? AP.Worlds.get(L.world) : null;
    var label, title;
    if (L.mode === 'endless') {
      label = '∞';
      title = String(L.name || 'Endless').toUpperCase();
    } else if (W) {
      label = 'W' + L.world + '-' + (L.boss ? 'BOSS' : (L.index || 1));
      title = String(L.name || '').toUpperCase();
    } else {
      label = 'TEST';
      title = String(L.name || L.id || '').toUpperCase();
    }
    var sub = W ? W.name.toUpperCase() : (L.mode === 'endless' ? 'APEIRON · ENDLESS' : 'SANDBOX');
    var par = L.def && +L.def.par > 0 ? +L.def.par : 0;
    var first = !!(W && L.mode === 'story' && !L.boss && (L.index | 0) === 1 && data && data.flags && !data.flags[flagKey(W.n)]);
    if (first) {
      data.flags[flagKey(W.n)] = true;
      if (AP.Save.save) AP.Save.save(true);
      return { kind: 'world', t0: 0.15, dur: 4.6, world: W.n, title: UI ? UI.worldCardTitle(W.n) : W.name.toUpperCase(),
        motto: UI ? UI.worldMotto(W.n) : '', label: label, name: title, sub: sub, par: par, form: W.form };
    }
    return { kind: 'name', t0: 0.25, dur: 2.2, world: W ? W.n : 0, title: label + ' · ' + title, label: label, name: title, sub: sub, par: par,
      form: L.form };
  }

  var HUD = {};

  HUD.onLevelStart = function (L) {
    if (!L) return;
    listen();
    S.L = L;
    S.startT = L.time || 0;
    S.endT = -1;
    S.shardT = -9;
    S.shardFull = false;
    S.shardFullT = -9;
    S.gemT[0] = S.gemT[1] = S.gemT[2] = -9;
    S.deathT = -9;
    S.cpT = -9;
    S.secretT = -9;
    S.boss.on = false;
    S.boss.ghost = 1;
    S.boss.frac = 1;
    S.boss.hitT = -9;
    S.boss.phaseT = -9;
    S.boss.doneT = -9;
    S.boss.shake = 0;
    S.reg.tl = S.reg.tr = S.reg.tc = S.reg.br = S.reg.bl = S.reg.card = 1;
    S.gemsInLevel = typeof L.count === 'function' ? L.count('gem') : 3;
    S.card = makeCard(L);
  };

  HUD.onLevelEnd = function (L) {
    if (!L || L !== S.L) return;
    if (S.endT < 0) S.endT = L.time || 0;
  };

  // ---------------------------------------------------------------- layout
  var BAR_W = 380, BAR_Y = 36, BAR_H = 7;
  function barX0() { return 480 - BAR_W / 2; }
  function gemX(i) { return 806 + i * 25; }

  // regions (screen rects) the player can hide behind
  var REG = {
    tl: [0, 0, 250, 70], tr: [770, 0, 190, 70], tc: [260, 0, 440, 66], br: [760, 470, 200, 70], bl: [0, 480, 260, 60],
    card: [160, 50, 640, 220]
  };

  function updateRegions(L, dt) {
    var P = L.player;
    var px = -999, py = -999;
    if (P && L.cam && P.state !== 'dead') {
      px = P.rx + P.w / 2 - L.cam.renderX;
      py = P.ry + P.h / 2 - L.cam.renderY;
    }
    var k = 1 - Math.exp(-dt * 10);
    for (var key in REG) {
      var r = REG[key];
      var inside = px > r[0] - 26 && px < r[0] + r[2] + 26 && py > r[1] - 26 && py < r[1] + r[3] + 26;
      var target = inside ? 0.2 : 1;
      S.reg[key] += (target - S.reg[key]) * k;
    }
  }

  // ---------------------------------------------------------------- drawing
  var SO = { size: 17, color: '#FFFFFF', align: 'left', glow: null, glowAlpha: 0.7, alpha: 1, progress: 1, spacing: 1.4, sparks: false, stagger: 0.28 };
  function stroke(ctx, str, x, y, size, color, align, alpha, glow, progress) {
    SO.size = size; SO.color = color; SO.align = align || 'left'; SO.alpha = alpha === undefined ? 1 : alpha;
    SO.glow = glow || null; SO.progress = progress === undefined ? 1 : progress; SO.sparks = progress !== undefined && progress < 1;
    return AP.UI.strokeText(ctx, str, x, y, SO);
  }
  var TX = { size: 12, weight: '600', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  function text(ctx, str, x, y, size, color, align, alpha, weight) {
    TX.size = size; TX.color = color; TX.align = align || 'left'; TX.alpha = alpha === undefined ? 1 : alpha; TX.weight = weight || '600';
    return AP.R.text(ctx, str, x, y, TX);
  }

  // small integer strings, built once
  var NUMS = [], SLASH = [];
  function numStr(n) { n = n | 0; if (n < 0 || n > 4096) return String(n); return NUMS[n] || (NUMS[n] = String(n)); }
  function slashStr(n) { n = n | 0; if (n < 0 || n > 4096) return '/' + n; return SLASH[n] || (SLASH[n] = '/' + n); }

  function pop(t, since, dur) {
    var k = (t - since) / dur;
    if (k < 0 || k >= 1) return 0;
    return Math.sin(k * Math.PI) * (1 - k * 0.4);
  }

  function minimalShow(t, since) {
    // minimal HUD: show for 2.6 s after something changed, then fade away
    var k = t - since;
    if (k < 0) return 0;
    return clamp01((2.6 - k) / 0.6);
  }

  function drawTopLeft(ctx, L, pal, t, a, minimal) {
    var UI = AP.UI;
    var st = L.stats;
    var vis = a * S.reg.tl;
    if (minimal) vis *= Math.max(minimalShow(t, S.startT), minimalShow(t, S.shardT), minimalShow(t, S.cpT));
    if (vis <= 0.01) return;
    var pa = ctx.globalAlpha;
    // form glyph: the level's polygon with a beat breath; a ring flashes when a checkpoint lights
    var gx = 34, gy = 34;
    var bp = beatPulse();
    var sides = UI.formSides(L.form);
    var rot = UI.flatRot(sides);
    var cp = pop(t, S.cpT, 0.7);
    AP.R.glow(ctx, gx, gy, 22 + 10 * cp, pal.accent, (0.22 + 0.5 * cp) * vis);
    ctx.globalAlpha = pa * vis;
    AP.R.poly(ctx, gx, gy, 12 + bp * 0.8, sides >= 32 ? 48 : sides, rot);
    ctx.fillStyle = rgba(pal.accent, 0.18);
    ctx.fill();
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (cp > 0) {
      ctx.globalAlpha = pa * vis * cp;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      AP.R.poly(ctx, gx, gy, 16 + 10 * (1 - cp), sides >= 32 ? 48 : sides, rot);
      ctx.stroke();
    }
    ctx.globalAlpha = pa * vis;
    ctx.fillStyle = pal.ink;
    ctx.beginPath();
    ctx.arc(gx, gy, 2.2, 0, TAU);
    ctx.fill();
    if (!(st.shardsTotal > 0)) { ctx.globalAlpha = pa; ctx.lineJoin = 'miter'; return; }
    // divider tick
    ctx.strokeStyle = rgba(pal.primary, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(56, 22); ctx.lineTo(56, 46);
    ctx.stroke();
    // shard icon + count
    var sp = pop(t, S.shardT, 0.28);
    var full = S.shardFull;
    var sc = full ? pal.accent : pal.ink;
    UI.shard(ctx, 71, 34, 6.5 * (1 + 0.45 * sp), pal.accent, Math.sin(t * 2.2) * 0.3, vis);
    if (sp > 0) AP.R.glow(ctx, 71, 34, 16, pal.accent, sp * 0.6 * vis);
    var count = numStr(st.shards);
    var cw = stroke(ctx, count, 86, 34 - sp * 2, 17 * (1 + 0.18 * sp), sc, 'left', vis, sp > 0 || full ? pal.accent : null);
    stroke(ctx, slashStr(st.shardsTotal), 86 + cw + 3, 36, 12.5, rgba(pal.primary, 0.85), 'left', vis);
    if (full) {
      var fk = pop(t, S.shardFullT, 1.2);
      if (fk > 0) UI.burst(ctx, 71, 34, 9, 18 + 10 * fk, 10, t * 2, pal.accent, fk * vis, 1.2);
    }
    ctx.globalAlpha = pa;
    ctx.lineJoin = 'miter';
  }

  function drawTopRight(ctx, L, pal, t, a, minimal) {
    var UI = AP.UI;
    var vis = a * S.reg.tr;
    if (vis <= 0.01) return;
    var pa = ctx.globalAlpha;
    var gemVis = vis;
    if (minimal) gemVis *= Math.max(minimalShow(t, S.startT), minimalShow(t, Math.max(S.gemT[0], S.gemT[1], S.gemT[2])));
    if (S.gemsInLevel > 0 && gemVis > 0.01) {
      for (var i = 0; i < 3; i++) {
        var got = !!L.stats.gems[i];
        var owned = !!(L.gemOwned && L.gemOwned[i]);
        var state = got ? 2 : (owned ? 1 : 0);
        var pk = pop(t, S.gemT[i], 0.45);
        var r = 8.5 * (1 + 0.6 * pk);
        var gx = gemX(i);
        if (got) AP.R.glow(ctx, gx, 34, 16 + 12 * pk, pal.accent, (0.3 + 0.6 * pk) * gemVis);
        UI.gem(ctx, gx, 34, r, state, pal, gemVis, got ? t + i : undefined);
      }
    }
    if (!minimal) {
      var dk = pop(t, S.deathT, 0.5);
      var dx = 924 + Math.sin(t * 60) * 2.5 * dk;
      // deaths: a broken triangle and the count
      ctx.globalAlpha = pa * vis;
      ctx.strokeStyle = dk > 0 ? pal.hazard : rgba(pal.ink, 0.7);
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(894, 41); ctx.lineTo(899.5, 31); ctx.moveTo(901.5, 28); ctx.lineTo(904, 32.5);
      ctx.moveTo(906, 36); ctx.lineTo(909, 41); ctx.moveTo(906, 43); ctx.lineTo(896, 43);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.globalAlpha = pa;
      stroke(ctx, numStr(L.stats.deaths), dx + 12, 34, 15 * (1 + 0.2 * dk), dk > 0 ? pal.hazard : pal.ink, 'right', vis, dk > 0 ? pal.hazard : null);
    }
    ctx.globalAlpha = pa;
  }

  var NAME_O = { size: 14, color: '#FFFFFF', align: 'center', glow: null, glowAlpha: 0.9, alpha: 1, progress: 1, spacing: 2.4, sparks: true };
  function drawBoss(ctx, L, pal, t, a, dt) {
    var bi = L.bossInfo;
    var B = S.boss;
    if (!bi) { B.on = false; return; }
    if (!B.on) { B.on = true; B.t0 = t; B.ghost = bi.frac; }
    var vis = a * S.reg.tc;
    var age = t - B.t0;
    var grow = M.ease.outCubic(clamp01(age / 0.7));
    if (vis <= 0.01) return;
    var frac = clamp01(bi.frac);
    // damage ghost: holds, then drains toward the real value
    if (B.ghost < frac) B.ghost = frac;
    if (B.ghostHoldT > 0) B.ghostHoldT -= dt;
    else B.ghost = Math.max(frac, B.ghost - dt * 0.9);
    B.shake = Math.max(0, B.shake - dt * 3.5);
    var sx = Math.sin(t * 70) * 4 * B.shake;
    var x0 = barX0() + sx, y = BAR_Y;
    var ph = Math.max(1, bi.phases | 0);
    var gap = ph > 1 ? 6 : 0;
    var segW = (BAR_W - gap * (ph - 1)) / ph;
    var pa = ctx.globalAlpha;
    var defeated = L.bossDone || B.doneT >= 0;
    var cur = Math.min(ph - 1, Math.max(0, Math.ceil(frac * ph - 1e-6) - 1));
    var hitK = pop(t, B.hitT, 0.25);
    var phK = pop(t, B.phaseT, 0.8);
    // name, drawn on in the stroke font
    NAME_O.color = pal.ink;
    NAME_O.glow = defeated ? pal.ink : pal.hazard;
    NAME_O.alpha = vis * (defeated ? 0.6 : 1);
    NAME_O.progress = clamp01(age / 1.1);
    var nw = AP.UI.strokeText(ctx, String(bi.name || 'Boss'), 480 + sx, 19, NAME_O);
    if (defeated) {
      var dk = clamp01((t - B.doneT) / 0.5);
      ctx.globalAlpha = pa * vis * 0.8;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(480 - nw / 2 - 6, 19); ctx.lineTo(480 - nw / 2 - 6 + (nw + 12) * dk, 19);
      ctx.stroke();
    }
    // segments
    var half = BAR_W / 2 * grow;
    ctx.save();
    ctx.beginPath();
    ctx.rect(480 - half + sx - 2, y - 6, half * 2 + 4, BAR_H + 12);
    ctx.clip();
    for (var i = 0; i < ph; i++) {
      var sx0 = x0 + i * (segW + gap);
      var f = clamp01((frac - i / ph) * ph);
      var g = clamp01((B.ghost - i / ph) * ph);
      ctx.globalAlpha = pa * vis;
      ctx.fillStyle = rgba(pal.ink, 0.08);
      ctx.fillRect(sx0, y, segW, BAR_H);
      if (g > f) {
        ctx.fillStyle = rgba(pal.ink, 0.55);
        ctx.fillRect(sx0 + segW * f, y, segW * (g - f), BAR_H);
      }
      if (f > 0) {
        var isCur = i === cur && !defeated;
        ctx.fillStyle = isCur ? pal.hazard : rgba(pal.hazard, 0.72);
        ctx.fillRect(sx0, y, segW * f, BAR_H);
        if (isCur) {
          ctx.globalAlpha = pa * vis * (0.25 + 0.25 * beatPulse() + 0.5 * hitK);
          ctx.fillStyle = pal.ink;
          ctx.fillRect(sx0, y, segW * f, 2);
        }
      }
      ctx.globalAlpha = pa * vis;
      ctx.strokeStyle = i === cur && !defeated ? rgba(pal.ink, 0.85) : rgba(pal.ink, 0.35);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx0 + 0.5, y - 0.5, segW - 1, BAR_H + 1);
    }
    ctx.restore();
    // phase gap diamonds
    ctx.globalAlpha = pa * vis * grow;
    for (var k = 1; k < ph; k++) {
      var gxp = x0 + k * (segW + gap) - gap / 2;
      var lit = k > cur;
      ctx.fillStyle = lit ? rgba(pal.ink, 0.35) : pal.hazard;
      AP.R.poly(ctx, gxp, y + BAR_H / 2, 3.2 + (k === cur + 1 ? 2.5 * phK : 0), 4, 0);
      ctx.fill();
    }
    // end caps
    ctx.strokeStyle = rgba(pal.ink, 0.6);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0 - 8, y - 3); ctx.lineTo(x0 - 4, y + BAR_H / 2); ctx.lineTo(x0 - 8, y + BAR_H + 3);
    ctx.moveTo(x0 + BAR_W + 8, y - 3); ctx.lineTo(x0 + BAR_W + 4, y + BAR_H / 2); ctx.lineTo(x0 + BAR_W + 8, y + BAR_H + 3);
    ctx.stroke();
    if (hitK > 0) AP.R.glow(ctx, x0 + BAR_W * frac, y + BAR_H / 2, 22, pal.hazard, hitK * vis);
    ctx.globalAlpha = pa;
  }

  function drawTimer(ctx, L, pal, t, a) {
    var vis = a * S.reg.br;
    if (vis <= 0.01) return;
    var tm = L.ended ? L.clearTime : L.time;
    var par = S.card ? S.card.par : 0;
    var under = par > 0 && tm <= par;
    stroke(ctx, AP.UI.fmtTime(tm), 936, 514, 17, pal.ink, 'right', vis, null);
    if (par > 0 && L.mode === 'story') {
      text(ctx, 'PAR ' + AP.UI.fmtTime(par).replace(/\.\d+$/, ''), 936, 492, 10.5, under ? pal.accent : rgba(pal.primary, 0.55), 'right', vis, '800');
    }
  }

  function drawAssist(ctx, L, pal, t, a) {
    var as = settings().assist;
    if (!as || !as.on) return;
    var vis = a * S.reg.bl;
    if (vis <= 0.01) return;
    // Endless draws its lives / score / segment panel bottom-left (endless.ctl, y 458-520): sit above it there
    var by = L && L.mode === 'endless' ? 428 : 503;
    var UI = AP.UI;
    var parts = 'ASSIST';
    if (as.speed < 0.999) parts += '  ' + Math.round(as.speed * 100) + '%';
    var w = AP.R.measure(ctx, parts, 11, '800') + 22 + (as.invincible ? 18 : 0) + (as.infiniteAir ? 20 : 0);
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * vis;
    UI.chamferPath(ctx, 18, by, w, 22, 5);
    ctx.fillStyle = rgba(pal.bg, 0.6);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.accent, 0.8);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = pa;
    text(ctx, parts, 29, by + 11.5, 11, pal.accent, 'left', vis, '800');
    var ix = 29 + AP.R.measure(ctx, parts, 11, '800') + 12;
    ctx.globalAlpha = pa * vis;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.3;
    if (as.invincible) {
      // a small shield (a pentagon pointing down)
      AP.R.poly(ctx, ix, by + 11, 5.5, 5, Math.PI / 2);
      ctx.stroke();
      ix += 18;
    }
    if (as.infiniteAir) {
      ctx.beginPath();
      for (var q = 0; q <= 20; q++) {
        var v = q / 20 * TAU, s = Math.sin(v), c = Math.cos(v), d = 1 + s * s;
        var x = ix + c / d * 7, y = by + 11 + s * c / d * 7;
        if (q === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = pa;
  }

  function drawNameCard(ctx, L, pal, t, c) {
    var age = t - S.startT - c.t0;
    if (age < 0 || age > c.dur) return;
    var vis = clamp01(age / 0.25) * clamp01((c.dur - age) / 0.5) * S.reg.card;
    if (vis <= 0.01) return;
    var y = 128 - M.ease.outCubic(clamp01(age / 0.6)) * 8;
    var pa = ctx.globalAlpha;
    var w = stroke(ctx, c.title, 480, y, 24, pal.ink, 'center', vis, pal.accent, clamp01(age / 0.85));
    var lk = M.ease.outCubic(clamp01((age - 0.35) / 0.6));
    var hw = (w / 2 + 40) * lk;
    ctx.globalAlpha = pa * vis * 0.7;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(480 - hw, y + 22); ctx.lineTo(480 + hw, y + 22);
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    AP.R.poly(ctx, 480 - hw, y + 22, 2.5, 4, 0); ctx.fill();
    AP.R.poly(ctx, 480 + hw, y + 22, 2.5, 4, 0); ctx.fill();
    ctx.globalAlpha = pa;
    var subA = vis * clamp01((age - 0.55) / 0.4);
    var sub = c.sub + (c.par > 0 && L.mode === 'story' ? '   ·   PAR ' + AP.UI.fmtTime(c.par).replace(/\.\d+$/, '') : '');
    text(ctx, sub, 480, y + 38, 11, rgba(pal.primary, 0.9), 'center', subA, '800');
  }

  function drawWorldCard(ctx, L, pal, t, c) {
    var UI = AP.UI;
    var age = t - S.startT - c.t0;
    if (age < 0 || age > c.dur) return;
    var vis = clamp01(age / 0.35) * clamp01((c.dur - age) / 0.7) * S.reg.card;
    if (vis <= 0.01) return;
    var pa = ctx.globalAlpha;
    // a soft band behind the card keeps it legible over any background
    ctx.globalAlpha = pa * vis * 0.55;
    var grd = bandGrad(ctx, pal.bg);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 66, 960, 200);
    // the world's polygon, drawn on and slowly turning
    var cx = 480, cy = 158;
    var sides = UI.formSides(c.form);
    var pk = M.ease.outCubic(clamp01(age / 1.4));
    ctx.globalAlpha = pa * vis * 0.5;
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 1.5;
    UI.morphPath(ctx, cx, cy, 96 * (0.9 + 0.1 * pk), PREV_FORM[c.form] || 3, c.form, clamp01((age - 0.3) / 1.8), UI.flatRot(sides) + age * 0.08);
    ctx.stroke();
    ctx.globalAlpha = pa * vis * 0.25;
    UI.formPath(ctx, cx, cy, 72, c.form, -age * 0.12);
    ctx.stroke();
    ctx.globalAlpha = pa;
    AP.R.glow(ctx, cx, cy, 48, pal.accent, 0.25 * vis);
    text(ctx, 'WORLD ' + c.world, cx, 104, 11, pal.accent, 'center', vis * clamp01(age / 0.5), '800');
    stroke(ctx, c.title, cx, 140, 38, pal.ink, 'center', vis, pal.accent, clamp01((age - 0.15) / 1.3));
    var mk = clamp01((age - 1.0) / 0.6);
    text(ctx, '“' + c.motto + '”', cx, 182, 15, UI.mix(pal.ink, pal.accent, 0.2), 'center', vis * mk, '500');
    var lk = clamp01((age - 1.9) / 0.5);
    if (lk > 0) {
      stroke(ctx, c.label + ' · ' + c.name, cx, 216, 15, pal.ink, 'center', vis * lk, null, clamp01((age - 1.9) / 0.9));
      if (c.par > 0) text(ctx, 'PAR ' + UI.fmtTime(c.par).replace(/\.\d+$/, ''), cx, 238, 10.5, rgba(pal.primary, 0.8), 'center', vis * lk, '800');
    }
    ctx.globalAlpha = pa;
  }

  // the world card morphs from the form you arrive with into the world's own form
  var PREV_FORM = { 3: 99, 4: 3, 5: 4, 6: 5, 99: 6 };

  var bandCache = {};
  var bandCtx = null;
  function bandGrad(ctx, bg) {
    if (bandCtx !== ctx) { bandCache = {}; bandCtx = ctx; }
    var g = bandCache[bg];
    if (g) return g;
    g = ctx.createLinearGradient(0, 66, 0, 266);
    g.addColorStop(0, rgba(bg, 0));
    g.addColorStop(0.3, rgba(bg, 0.85));
    g.addColorStop(0.7, rgba(bg, 0.85));
    g.addColorStop(1, rgba(bg, 0));
    bandCache[bg] = g;
    return g;
  }

  function drawSecret(ctx, L, pal, t, a) {
    var age = t - S.secretT;
    if (age < 0 || age > 1.8) return;
    var vis = a * clamp01(age / 0.15) * clamp01((1.8 - age) / 0.4) * S.reg.card;
    var y = L.bossInfo ? 78 : 64;
    stroke(ctx, 'SECRET', 480, y, 16, pal.accent, 'center', vis, pal.accent, clamp01(age / 0.5));
    var w = AP.UI.measure('SECRET', 16);
    AP.UI.burst(ctx, 480 - w / 2 - 16, y, 2, 7, 6, t * 3, pal.accent, vis, 1.2);
    AP.UI.burst(ctx, 480 + w / 2 + 16, y, 2, 7, 6, -t * 3, pal.accent, vis, 1.2);
  }

  HUD.render = function (ctx, L) {
    if (!L || !AP.UI) return;
    if (S.L !== L) HUD.onLevelStart(L);
    var UI = AP.UI;
    var dt = UI.frameDt();
    var pal = L.pal || AP.R.pal(L.style);
    var t = L.time || 0;
    var st = settings();
    var minimal = st.hud === 'minimal';
    var endK = S.endT >= 0 ? clamp01(1 - (t - S.endT) / 0.45) : 1;
    var introK = clamp01((t - S.startT) / 0.35);
    var a = endK * (0.35 + 0.65 * introK);
    updateRegions(L, dt);
    UI.sparks.tick();
    if (a > 0.01) {
      drawTopLeft(ctx, L, pal, t, a, minimal);
      drawTopRight(ctx, L, pal, t, a, minimal);
      drawBoss(ctx, L, pal, t, a, dt);
      if (st.showTimer) drawTimer(ctx, L, pal, t, a);
      drawAssist(ctx, L, pal, t, a);
      drawSecret(ctx, L, pal, t, a);
    }
    var c = S.card;
    if (c && endK > 0.01) {
      if (c.kind === 'world') drawWorldCard(ctx, L, pal, t, c);
      else drawNameCard(ctx, L, pal, t, c);
    }
    UI.sparks.render(ctx);
  };

  HUD.state = S;
  AP.HUD = HUD;
})(window.AP = window.AP || {});
