/* js/ui/story.js — owner: UI */
(function (AP) {
  'use strict';

  // Scenes 'intro' (first run, flags.introSeen), 'ending' (after the Null) and 'credits' (a slow scroll over the
  // title shader). DESIGN 5 text; one line per card; every card has its own geometric animation and can be skipped.
  // Flow: ending -> credits -> title, with the "Endless mode unlocked" toast once the credits finish.
  var TAU = Math.PI * 2;
  var GA = 2.399963229728653;
  var M = AP.M;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function now() { return (AP.Time && AP.Time.now) || 0; }
  function UI() { return AP.UI; }
  function ease(t) { return M.ease.inOutSine(clamp01(t)); }
  function data() { return (AP.Save && AP.Save.data) || null; }

  var TX = { size: 22, weight: '300', align: 'center', baseline: 'middle', color: '#FFFFFF', alpha: 1, maxW: 0 };
  function text(ctx, str, x, y, size, color, align, alpha, weight, maxW) {
    TX.size = size; TX.color = color; TX.align = align || 'center'; TX.alpha = alpha === undefined ? 1 : alpha;
    TX.weight = weight || '300'; TX.maxW = maxW || 0;
    return AP.R.text(ctx, str, x, y, TX);
  }
  var SO = { size: 20, color: '#FFFFFF', align: 'center', glow: null, glowAlpha: 0.9, alpha: 1, progress: 1, spacing: 1.4, sparks: true, stagger: 0.28 };
  function stroke(ctx, str, x, y, size, color, align, alpha, glow, progress, spacing) {
    SO.size = size; SO.color = color; SO.align = align || 'center'; SO.alpha = alpha === undefined ? 1 : alpha;
    SO.glow = glow || null; SO.progress = progress === undefined ? 1 : progress; SO.spacing = spacing || 1.4; SO.sparks = SO.progress < 1;
    return UI().strokeText(ctx, str, x, y, SO);
  }

  // a body line that appears word by word (cached word widths per line)
  var lineCache = {};
  function wordsOf(ctx, line, size, weight) {
    var key = size + '|' + weight + '|' + line;
    var c = lineCache[key];
    if (c) return c;
    var words = line.split(' ');
    var widths = [];
    var space = AP.R.measure(ctx, ' ', size, weight);
    var total = 0;
    for (var i = 0; i < words.length; i++) { var w = AP.R.measure(ctx, words[i], size, weight); widths.push(w); total += w + (i ? space : 0); }
    c = lineCache[key] = { words: words, widths: widths, space: space, total: total };
    return c;
  }
  var WT = { size: 22, weight: '300', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  function revealLine(ctx, line, cx, y, size, color, k, alpha, weight) {
    var info = wordsOf(ctx, line, size, weight || '300');
    var n = info.words.length;
    var x = cx - info.total / 2;
    WT.size = size; WT.weight = weight || '300'; WT.color = color;
    for (var i = 0; i < n; i++) {
      var wk = clamp01(k * (n + 2) - i);
      if (wk > 0) {
        WT.alpha = alpha * ease(wk);
        AP.R.text(ctx, info.words[i], x, y + (1 - ease(wk)) * 8, WT);
      }
      x += info.widths[i] + info.space;
    }
  }

  // ================================================================ shared drawing
  function polyOutline(ctx, cx, cy, r, sides, rot, prog) {
    // a polygon drawn on edge by edge (prog 0..1)
    var n = sides >= 32 ? 48 : sides;
    var total = prog * n;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var f = clamp01(total - i);
      if (f <= 0) break;
      var a0 = rot + i * TAU / n, a1 = rot + (i + 1) * TAU / n;
      var x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
      var x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
    }
  }

  function seeds(ctx, cx, cy, n, c, t, color, alpha) {
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 1; i <= n; i++) {
      var r = c * Math.sqrt(i), th = i * GA + t * 0.15;
      var x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
      var s = 0.6 + 1.2 * (0.5 + 0.5 * Math.cos(i * 0.21 - t * 2));
      ctx.moveTo(x + s, y);
      ctx.arc(x, y, s, 0, TAU);
    }
    ctx.fill();
    ctx.globalAlpha = pa;
  }

  // harmonograph arms of the Null (2 damped pendulums per axis)
  function nullArms(ctx, cx, cy, R, t, color, alpha, arms) {
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    for (var a = 0; a < arms; a++) {
      var ph = a * TAU / arms + t * 0.4;
      ctx.beginPath();
      for (var i = 0; i <= 80; i++) {
        var s = i / 80 * 7;
        var d = Math.exp(-s * 0.28);
        var x = cx + R * d * (Math.sin(s * 2.01 + ph) * 0.6 + Math.sin(s * 3.0 + ph * 1.3) * 0.4);
        var y = cy + R * d * (Math.sin(s * 3.02 + ph * 0.7) * 0.6 + Math.sin(s * 2.0 + ph) * 0.4);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = pa;
  }

  function voidPoint(ctx, cx, cy, r, pal, alpha) {
    var pa = ctx.globalAlpha;
    AP.R.glow(ctx, cx, cy, r * 3, pal.hazard, 0.35 * alpha);
    ctx.globalAlpha = pa * alpha;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = pal.hazard;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = pa;
  }

  function lemniscate(ctx, cx, cy, a, prog, rot) {
    var n = 64;
    ctx.beginPath();
    for (var i = 0; i <= n * prog; i++) {
      var t = i / n * TAU + Math.PI / 2;
      var s = Math.sin(t), c = Math.cos(t), d = 1 + s * s;
      var x = a * c / d, y = a * s * c / d;
      var X = cx + x * Math.cos(rot) - y * Math.sin(rot), Y = cy + x * Math.sin(rot) + y * Math.cos(rot);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
  }

  // ================================================================ card player (intro and ending share it)
  function CardScene(cfg) {
    var S = {
      bg: cfg.bg || null,
      t0: 0, idx: 0, cardT0: 0, leaving: false, params: null, skipAll: false, flash: 0
    };
    var CARD = cfg.cardDur;
    var cards = cfg.cards;

    function finish() {
      if (S.leaving) return;
      S.leaving = true;
      cfg.done(S.params || {});
    }

    S.enter = function (params) {
      S.params = params || {};
      S.t0 = now();
      S.idx = 0;
      S.cardT0 = S.t0;
      S.leaving = false;
      if (cfg.music) AP.music(cfg.music);
      if (AP.level) AP.level = null;
      if (cfg.enter) cfg.enter(S);
    };

    S.update = function () {
      var U = UI();
      var n = U.nav();
      var t = now();
      var ct = t - S.cardT0;
      var dur = cards[S.idx] ? cards[S.idx].dur || CARD : CARD;
      if (S.leaving) return;
      if (n.back || n.pause) { U.eat(); AP.sfx('uiBack'); finish(); return; }
      var adv = n.confirm || n.click || (AP.Input && AP.Input.pressed('jump'));
      if (adv) {
        U.eat();
        if (ct < 1.1) { S.cardT0 = t - 1.1; }       // reveal the whole line first
        else next();
        return;
      }
      if (ct >= dur) next();
    };

    function next() {
      AP.sfx('uiMove', { vol: 0.5, pitch: 0.8 + S.idx * 0.08 });
      if (S.idx >= cards.length - 1) { finish(); return; }
      S.idx++;
      S.cardT0 = now();
      if (cards[S.idx].onShow) cards[S.idx].onShow(S);
    }

    S.render = function (ctx) {
      var U = UI();
      var pal = AP.R.pal(cfg.palKey || 'title');
      var t = now();
      var total = t - S.t0;
      if (!cfg.bg) U.deepBg(ctx, cfg.top || '#05060D', cfg.bottom || '#000000');
      else U.dim(ctx, 0.55, '#000000');
      var c = cards[S.idx];
      var ct = t - S.cardT0;
      var dur = c.dur || CARD;
      var inK = clamp01(ct / 0.6), outK = clamp01((dur - ct) / 0.55);
      if (S.idx === cards.length - 1 && cfg.lastHold) outK = 1;
      // visuals (each card draws its own scene; the previous card fades behind)
      if (S.idx > 0 && ct < 0.7) {
        var pc = cards[S.idx - 1];
        pc.draw(ctx, pal, (pc.dur || CARD) + ct, total, 1 - clamp01(ct / 0.7));
      }
      c.draw(ctx, pal, ct, total, inK * (cfg.fadeVisuals === false ? 1 : Math.max(0.35, outK)));
      if (c.text) revealLine(ctx, c.text, 480, cfg.textY || 448, c.size || 22, pal.ink, clamp01(ct / 1.1), inK * outK, c.weight || '300');
      if (cfg.overlay) cfg.overlay(ctx, pal, S, ct);
      // progress pips and hints
      var hk = clamp01((total - 0.8) / 0.6) * 0.7;
      var pa = ctx.globalAlpha;
      for (var i = 0; i < cards.length; i++) {
        ctx.globalAlpha = pa * hk * (i === S.idx ? 1 : (i < S.idx ? 0.55 : 0.2));
        ctx.fillStyle = i === S.idx ? pal.accent : pal.ink;
        AP.R.poly(ctx, 480 + (i - (cards.length - 1) / 2) * 16, 500, i === S.idx ? 3.5 : 2.5, 4, 0);
        ctx.fill();
      }
      ctx.globalAlpha = pa;
      U.hints(ctx, [['confirm', 'Next'], ['back', 'Skip']], 940, 522, { align: 'right', pal: pal, alpha: hk * 0.8, size: 11 });
      U.vignette(ctx, 0.7);
    };

    S.exit = function () { if (cfg.exit) cfg.exit(S); };
    return S;
  }

  // ================================================================ intro
  var INTRO = [
    { text: 'Before the line, there was the Point.', draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 230;
      var b = 0.5 + 0.5 * Math.sin(t * 2.4);
      AP.R.glow(ctx, cx, cy, 40 + 8 * b, pal.accent, (0.35 + 0.25 * b) * a);
      var pa = ctx.globalAlpha;
      ctx.globalAlpha = pa * a;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx, cy, 3 + b, 0, TAU);
      ctx.fill();
      var lk = M.ease.outCubic(clamp01((t - 2.2) / 1.4));
      if (lk > 0) {
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 260 * lk, cy); ctx.lineTo(cx + 260 * lk, cy);
        ctx.stroke();
      }
      ctx.globalAlpha = pa;
    } },
    { text: 'The Point dreamed, and its dream was Geometry.', draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 230;
      seeds(ctx, cx, cy, Math.floor(clamp01(t / 2.5) * 220), 6.5, t, pal.accent, 0.55 * a);
      var pa = ctx.globalAlpha;
      ctx.lineJoin = 'round';
      var forms = [3, 4, 5, 6, 99];
      for (var i = 0; i < forms.length; i++) {
        var k = M.ease.outCubic(clamp01((t - 0.2 - i * 0.35) / 1.0));
        if (k <= 0) continue;
        ctx.globalAlpha = pa * a * (0.85 - i * 0.1);
        ctx.strokeStyle = i % 2 ? pal.primary : pal.ink;
        ctx.lineWidth = 1.6;
        polyOutline(ctx, cx, cy, 34 + i * 30, forms[i], (i % 2 ? -1 : 1) * t * (0.2 + i * 0.04) - Math.PI / 2, k);
        ctx.stroke();
      }
      ctx.globalAlpha = pa;
      ctx.lineJoin = 'miter';
      AP.R.glow(ctx, cx, cy, 30, pal.accent, 0.5 * a);
    } },
    { text: 'At the centre of the dream a hunger grew: the Null, which unmakes every angle.', size: 21, draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 230;
      var eat = clamp01((t - 0.6) / 3.0);
      var pa = ctx.globalAlpha;
      var forms = [3, 4, 5, 6, 99];
      ctx.lineJoin = 'round';
      for (var i = 0; i < forms.length; i++) {
        var gone = clamp01(eat * 1.6 - (forms.length - 1 - i) * 0.12);
        ctx.globalAlpha = pa * a * (0.75 - i * 0.08) * (1 - gone * 0.85);
        ctx.strokeStyle = i % 2 ? pal.primary : pal.ink;
        ctx.lineWidth = 1.4;
        var r = (34 + i * 30) * (1 - 0.5 * gone);
        polyOutline(ctx, cx, cy, r, forms[i], (i % 2 ? -1 : 1) * (t + 4) * (0.2 + i * 0.04) - Math.PI / 2, 1 - gone);
        ctx.stroke();
      }
      ctx.globalAlpha = pa;
      ctx.lineJoin = 'miter';
      var vk = M.ease.outCubic(clamp01(t / 1.2));
      nullArms(ctx, cx, cy, 150 * vk, t, pal.hazard, 0.45 * a * vk, 5);
      voidPoint(ctx, cx, cy, 10 + 18 * vk + 2 * Math.sin(t * 5), pal, a * vk);
    } },
    { text: 'You are three edges and a stubborn spark.', draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 236;
      var k = M.ease.outCubic(clamp01((t - 0.2) / 1.4));
      var pa = ctx.globalAlpha;
      var R = 46;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.strokeStyle = pal.ink;
      var rot = -Math.PI / 2;
      for (var i = 0; i < 3; i++) {
        var a0 = rot + i * TAU / 3, a1 = rot + (i + 1) * TAU / 3;
        var mx = (Math.cos(a0) + Math.cos(a1)) / 2, my = (Math.sin(a0) + Math.sin(a1)) / 2;
        var ml = Math.sqrt(mx * mx + my * my) || 1;
        var far = 420 * (1 - k);
        var spin = (1 - k) * (i % 2 ? 2.6 : -2.6);
        var ox = mx / ml * far, oy = my / ml * far;
        var x0 = Math.cos(a0) * R, y0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, y1 = Math.sin(a1) * R;
        var ex = (x0 + x1) / 2, ey = (y0 + y1) / 2;
        var cs = Math.cos(spin), sn = Math.sin(spin);
        ctx.globalAlpha = pa * a * (0.3 + 0.7 * k);
        ctx.beginPath();
        ctx.moveTo(cx + ox + ex + (x0 - ex) * cs - (y0 - ey) * sn, cy + oy + ey + (x0 - ex) * sn + (y0 - ey) * cs);
        ctx.lineTo(cx + ox + ex + (x1 - ex) * cs - (y1 - ey) * sn, cy + oy + ey + (x1 - ex) * sn + (y1 - ey) * cs);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.globalAlpha = pa;
      var sk = clamp01((t - 1.5) / 0.4);
      if (sk > 0) {
        var flick = 0.8 + 0.2 * Math.sin(t * 13) * Math.sin(t * 7);
        AP.R.glow(ctx, cx + 4, cy + 4, 26 * sk, pal.accent, 0.9 * sk * flick * a);
        ctx.globalAlpha = pa * a * sk;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx + 4, cy + 4, 3.5 * sk, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = pa;
      }
    } },
    { text: 'Gather vertices. Become more. Become boundless.', draw: function (ctx, pal, t, T, a) {
      var U = UI();
      var cx = 480, cy = 232;
      var seq = [3, 4, 5, 6, 99];
      var st = clamp01(t / 2.6) * 4;
      var i0 = Math.min(3, Math.floor(st));
      var k = st - i0;
      var R = 50 + 10 * st;
      var pa = ctx.globalAlpha;
      AP.R.glow(ctx, cx, cy, 30 + 6 * st, pal.accent, 0.4 * a);
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      U.morphPath(ctx, cx, cy, R, seq[i0], seq[i0 + 1], k, t * 0.4);
      ctx.fillStyle = rgba(pal.accent, 0.15);
      ctx.fill();
      ctx.stroke();
      ctx.lineJoin = 'miter';
      var lk = clamp01((t - 2.4) / 1.2);
      if (lk > 0) {
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        lemniscate(ctx, cx, cy, 150, lk, 0);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.globalAlpha = pa;
    } }
  ];

  var intro = CardScene({
    cards: INTRO, cardDur: 4.2, music: 'title', textY: 440,
    done: function (params) {
      var d = data();
      if (d && d.flags) { d.flags.introSeen = true; if (AP.Save.save) AP.Save.save(true); }
      var next = (params && params.next) || 'map';
      UI().go(next, next === 'map' ? { focus: 'w1-1' } : {}, 'fade', 1.1);
    }
  });
  AP.Scenes.register('intro', intro);

  // ================================================================ ending
  var ENDING = [
    { text: 'The Null had no sides to hold.', draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 230;
      var k = clamp01(t / 3.6);
      nullArms(ctx, cx, cy, 170 * (1 - k * 0.85), t, pal.hazard, 0.5 * a * (1 - k), 6);
      voidPoint(ctx, cx, cy, Math.max(0.5, 26 * (1 - k)), pal, a * (1 - k * 0.6));
      // fragments drifting outward
      var pa = ctx.globalAlpha;
      ctx.strokeStyle = pal.hazard;
      ctx.lineWidth = 1.2;
      for (var i = 0; i < 18; i++) {
        var ang = i * GA, r = 30 + t * (30 + (i % 5) * 12);
        ctx.globalAlpha = pa * a * clamp01(1 - r / 300) * 0.8;
        var x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang + t) * 6, y + Math.sin(ang + t) * 6);
        ctx.stroke();
      }
      ctx.globalAlpha = pa;
    } },
    { text: 'You had infinitely many.', draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 230;
      var k = M.ease.outCubic(clamp01(t / 2));
      var pa = ctx.globalAlpha;
      AP.R.glow(ctx, cx, cy, 48, pal.accent, 0.6 * a * k);
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 2.5;
      // polygons with more and more sides converge on the circle
      for (var n = 3; n <= 12; n++) {
        var kk = clamp01(k * 1.4 - (n - 3) * 0.06);
        ctx.globalAlpha = pa * a * kk * (0.12 + 0.05 * (12 - n));
        AP.R.poly(ctx, cx, cy, 40 + (n - 3) * 2.5, n, t * 0.2 * (n % 2 ? 1 : -1));
        ctx.stroke();
      }
      ctx.globalAlpha = pa * a * k;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 64, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = pa;
    } },
    { text: 'Every angle it unmade, you remembered.', draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 230;
      var pa = ctx.globalAlpha;
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 64, 0, TAU);
      ctx.stroke();
      var forms = [3, 4, 5, 6];
      var W = (AP.Worlds && AP.Worlds.list) || [];
      for (var i = 0; i < forms.length; i++) {
        var k = M.ease.outBack(clamp01((t - 0.3 - i * 0.45) / 0.7));
        if (k <= 0) continue;
        var ang = -Math.PI / 2 + i * TAU / 4 + t * 0.15;
        var x = cx + Math.cos(ang) * 150, y = cy + Math.sin(ang) * 150 * 0.62;
        var wp = W[i] ? AP.R.pal(W[i].style) : pal;
        AP.R.glow(ctx, x, y, 26, wp.primary, 0.4 * a * clamp01(k));
        ctx.globalAlpha = pa * a * clamp01(k);
        ctx.strokeStyle = wp.primary;
        ctx.lineWidth = 2;
        UI().formPath(ctx, x, y, 22 * k, forms[i], t * 0.5);
        ctx.stroke();
        ctx.globalAlpha = pa * a * clamp01(k) * 0.3;
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(cx + Math.cos(ang) * 66, cy + Math.sin(ang) * 66);
        ctx.stroke();
      }
      ctx.globalAlpha = pa;
    } },
    { text: 'The Point opened its eye, and saw a circle.', draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 230;
      var open = M.ease.inOutSine(clamp01((t - 0.3) / 2.2));
      var pa = ctx.globalAlpha;
      // the almond of the eye: two arcs that part
      var w = 300, h = 120 * open;
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy);
      ctx.quadraticCurveTo(cx, cy - h, cx + w / 2, cy);
      ctx.quadraticCurveTo(cx, cy + h, cx - w / 2, cy);
      ctx.stroke();
      // lashes of light
      ctx.globalAlpha = pa * a * open * 0.5;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 0; i < 13; i++) {
        var u = (i + 0.5) / 13, x = cx - w / 2 + w * u, yTop = cy - 2 * u * (1 - u) * h;
        ctx.moveTo(x, yTop - 4); ctx.lineTo(x + (u - 0.5) * 20, yTop - 22 * open);
      }
      ctx.stroke();
      // the iris is the circle
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy);
      ctx.quadraticCurveTo(cx, cy - h, cx + w / 2, cy);
      ctx.quadraticCurveTo(cx, cy + h, cx - w / 2, cy);
      ctx.clip();
      AP.R.glow(ctx, cx, cy, 48, pal.accent, 0.8 * a);
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 44, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = pa;
    } },
    { text: 'Boundless.', size: 30, weight: '200', draw: function (ctx, pal, t, T, a) {
      // an infinite zoom through nested golden polygons
      var cx = 480, cy = 230;
      var pa = ctx.globalAlpha;
      var z = t * 0.55;
      ctx.lineJoin = 'round';
      for (var i = 0; i < 12; i++) {
        var lv = i - (z % 1);
        var r = 18 * Math.pow(1.618, lv);
        if (r > 900 || r < 2) continue;
        var form = [3, 4, 5, 6, 99][(i + Math.floor(z)) % 5];
        ctx.globalAlpha = pa * a * clamp01(1 - r / 900) * clamp01(r / 30) * 0.8;
        ctx.strokeStyle = (i + Math.floor(z)) % 2 ? pal.accent : pal.ink;
        ctx.lineWidth = 1.5;
        UI().formPath(ctx, cx, cy, r, form, lv * 0.4);
        ctx.stroke();
      }
      ctx.lineJoin = 'miter';
      ctx.globalAlpha = pa;
      AP.R.glow(ctx, cx, cy, 40, pal.accent, 0.6 * a);
    } },
    { text: '', dur: 6.0, onShow: function () {
      if (AP.R.flash) AP.R.flash('#FFFFFF', 0.9, 0.8);
      AP.sfx('vertex');
    }, draw: function (ctx, pal, t, T, a) {
      var cx = 480, cy = 250;
      var k = clamp01((t - 0.4) / 2.6);
      UI().sparks.tick();
      stroke(ctx, 'APEIRON', cx, cy, 104, pal.ink, 'center', a, pal.accent, k, 2.8);
      var pa = ctx.globalAlpha;
      var lk = M.ease.outCubic(clamp01((t - 2.6) / 1.2));
      ctx.globalAlpha = pa * a * lk * 0.6;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      lemniscate(ctx, cx, cy + 92, 40, lk, 0);
      ctx.stroke();
      ctx.globalAlpha = pa;
      text(ctx, 'B O U N D L E S S', cx, cy + 150, 12, rgba(pal.primary, 0.85), 'center', a * clamp01((t - 3.2) / 0.8), '700');
      UI().sparks.render(ctx);
    } }
  ];

  var ending = CardScene({
    cards: ENDING, cardDur: 4.4, music: 'ending', textY: 440, lastHold: true, palKey: 'title',
    enter: function () {
      var d = data();
      if (d && d.flags) { d.flags.endingSeen = true; if (AP.Save.save) AP.Save.save(true); }
    },
    done: function () { UI().go('credits', { fromEnding: true }, 'fade', 1.6); }
  });
  AP.Scenes.register('ending', ending);

  // ================================================================ credits
  var CREDITS = [
    { kind: 'logo' },
    { kind: 'gap', h: 30 },
    { kind: 'line', text: 'Every shape, colour and sound in this game is generated by code.' },
    { kind: 'line', text: 'Made with Claude Code.' },
    { kind: 'gap', h: 90 },
    { kind: 'head', text: 'STANDING ON THE SHOULDERS OF' },
    { kind: 'gap', h: 24 },
    { kind: 'name', name: 'Sébastien Truchet', what: 'tilings, 1704', glyph: 'truchet' },
    { kind: 'name', name: 'Georgy Voronoy', what: 'diagrams, 1908', glyph: 'voronoi' },
    { kind: 'name', name: 'Boris Delaunay', what: 'triangulation, 1934', glyph: 'delaunay' },
    { kind: 'name', name: 'Ken Perlin', what: 'noise, 1983; simplex, 2001', glyph: 'noise' },
    { kind: 'name', name: 'Aristid Lindenmayer', what: 'L-systems, 1968', glyph: 'lsystem' },
    { kind: 'name', name: 'Wacław Sierpiński', what: '1915', glyph: 'sierpinski' },
    { kind: 'name', name: 'Helge von Koch', what: '1904', glyph: 'koch' },
    { kind: 'name', name: 'Jules Antoine Lissajous', what: '1857', glyph: 'lissajous' },
    { kind: 'name', name: 'Hugh Blackburn', what: 'harmonograph, 1844', glyph: 'harmonograph' },
    { kind: 'name', name: 'Helmut Vogel', what: 'phyllotaxis, 1979', glyph: 'phyllo' },
    { kind: 'name', name: 'Godfried Toussaint', what: 'Euclidean rhythms, 2005', glyph: 'euclid' },
    { kind: 'name', name: 'E. Bjorklund', what: '2003', glyph: 'bjorklund' },
    { kind: 'gap', h: 120 },
    { kind: 'end', text: 'THANK YOU FOR PLAYING' }
  ];
  var ROW_H = { logo: 150, line: 34, head: 40, name: 64, end: 80 };

  var glyphCache = {};
  function creditGlyph(ctx, kind, x, y, t, pal, a) {
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * a;
    ctx.strokeStyle = pal.accent;
    ctx.fillStyle = pal.accent;
    ctx.lineWidth = 1.3;
    ctx.lineJoin = 'round';
    var i, k;
    switch (kind) {
      case 'truchet':
        for (i = 0; i < 4; i++) {
          var tx = x - 16 + (i % 2) * 16, ty = y - 16 + Math.floor(i / 2) * 16;
          var o = (AP.hash2(i, 3, 7) + Math.floor(t * 0.5)) % 2;
          ctx.beginPath();
          if (o) { ctx.arc(tx, ty, 8, 0, Math.PI / 2); ctx.moveTo(tx + 16, ty + 8); ctx.arc(tx + 16, ty + 16, 8, -Math.PI / 2, -Math.PI, true); }
          else { ctx.arc(tx + 16, ty, 8, Math.PI / 2, Math.PI); ctx.moveTo(tx + 8, ty + 16); ctx.arc(tx, ty + 16, 8, 0, -Math.PI / 2, true); }
          ctx.stroke();
        }
        break;
      case 'voronoi':
      case 'delaunay':
        var pts = glyphCache.vor;
        if (!pts) {
          var rng = AP.RNG(1908);
          pts = glyphCache.vor = [];
          for (i = 0; i < 7; i++) pts.push([rng.range(-18, 18), rng.range(-18, 18)]);
        }
        if (kind === 'delaunay') {
          ctx.beginPath();
          for (i = 0; i < pts.length; i++) for (k = i + 1; k < pts.length; k++) {
            var dx = pts[i][0] - pts[k][0], dy = pts[i][1] - pts[k][1];
            if (dx * dx + dy * dy < 22 * 22) { ctx.moveTo(x + pts[i][0], y + pts[i][1]); ctx.lineTo(x + pts[k][0], y + pts[k][1]); }
          }
          ctx.stroke();
        } else {
          var cells = glyphCache.cells;
          if (!cells && AP.Algo && AP.Algo.voronoi) {
            try { cells = glyphCache.cells = AP.Algo.voronoi(pts, [-20, -20, 40, 40]); } catch (e) { cells = glyphCache.cells = []; }
          }
          ctx.beginPath();
          for (i = 0; cells && i < cells.length; i++) {
            var p = cells[i].poly;
            if (!p || p.length < 6) continue;
            ctx.moveTo(x + p[0], y + p[1]);
            for (k = 2; k < p.length; k += 2) ctx.lineTo(x + p[k], y + p[k + 1]);
            ctx.closePath();
          }
          ctx.stroke();
        }
        for (i = 0; i < pts.length; i++) { ctx.beginPath(); ctx.arc(x + pts[i][0], y + pts[i][1], 1.5, 0, TAU); ctx.fill(); }
        break;
      case 'noise':
        ctx.beginPath();
        for (i = 0; i <= 40; i++) {
          var nx = x - 20 + i, ny = y + AP.Noise.fbm2(i * 0.08 + t * 0.4, 3.3, 3) * 14;
          if (i === 0) ctx.moveTo(nx, ny); else ctx.lineTo(nx, ny);
        }
        ctx.stroke();
        break;
      case 'lsystem':
        var segs = glyphCache.tree;
        if (!segs) {
          segs = [];
          if (AP.Algo && AP.Algo.lsystem && AP.Algo.turtle) {
            try {
              var str = AP.Algo.lsystem('X', { X: 'F[+X][-X]FX', F: 'FF' }, 3);
              segs = AP.Algo.turtle(str, { x: 0, y: 20, heading: -Math.PI / 2, step: 2.4, angle: 0.45 }).segs;
            } catch (e2) { segs = []; }
          }
          glyphCache.tree = segs;
        }
        ctx.beginPath();
        for (i = 0; i < segs.length; i++) { ctx.moveTo(x + segs[i][0], y + segs[i][1]); ctx.lineTo(x + segs[i][2], y + segs[i][3]); }
        ctx.stroke();
        break;
      case 'sierpinski':
        if (AP.Art && AP.Art.sierpinski) AP.Art.sierpinski(ctx, x, y + 3, 40, 3, pal.accent, 1);
        break;
      case 'koch':
        var kp = glyphCache.koch;
        if (!kp) {
          kp = glyphCache.koch = [];
          if (AP.Algo && AP.Algo.koch) {
            var tri = [[0, -20], [17.3, 10], [-17.3, 10]];
            for (i = 0; i < 3; i++) {
              try { kp.push(AP.Algo.koch(tri[i][0], tri[i][1], tri[(i + 1) % 3][0], tri[(i + 1) % 3][1], 2, -1)); } catch (e3) { /* none */ }
            }
          }
        }
        ctx.beginPath();
        for (i = 0; i < kp.length; i++) {
          var f = kp[i];
          ctx.moveTo(x + f[0], y + f[1]);
          for (k = 2; k < f.length; k += 2) ctx.lineTo(x + f[k], y + f[k + 1]);
        }
        ctx.stroke();
        break;
      case 'lissajous':
        ctx.beginPath();
        for (i = 0; i <= 80; i++) {
          var s = i / 80 * TAU;
          var lx = x + 20 * Math.sin(3 * s + t * 0.6), ly = y + 18 * Math.sin(2 * s);
          if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
        }
        ctx.stroke();
        break;
      case 'harmonograph':
        ctx.beginPath();
        for (i = 0; i <= 160; i++) {
          var hs = i / 160 * 18;
          var d = Math.exp(-hs * 0.12);
          var hx = x + 20 * d * Math.sin(hs * 2.01 + t * 0.3), hy = y + 19 * d * Math.sin(hs * 3.0 + 1.1);
          if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
        }
        ctx.stroke();
        break;
      case 'phyllo':
        ctx.beginPath();
        for (i = 1; i <= 90; i++) {
          var pr = 2.1 * Math.sqrt(i), pth = i * GA + t * 0.2;
          ctx.moveTo(x + Math.cos(pth) * pr + 1, y + Math.sin(pth) * pr);
          ctx.arc(x + Math.cos(pth) * pr, y + Math.sin(pth) * pr, 1, 0, TAU);
        }
        ctx.fill();
        break;
      case 'euclid':
      case 'bjorklund':
        var nn = kind === 'euclid' ? 8 : 13, kk2 = kind === 'euclid' ? 3 : 5;
        var pat = AP.Beat && AP.Beat.euclidPattern ? AP.Beat.euclidPattern(kk2, nn, 0) : null;
        var step = Math.floor(t * 3) % nn;
        for (i = 0; i < nn; i++) {
          var ea = -Math.PI / 2 + i * TAU / nn;
          var ex = x + Math.cos(ea) * 17, ey = y + Math.sin(ea) * 17;
          var on = pat ? pat[i] === 1 : (i * kk2) % nn < kk2;
          ctx.beginPath();
          ctx.arc(ex, ey, on ? 3 : 1.5, 0, TAU);
          if (on) ctx.fill(); else ctx.stroke();
          if (i === step) { ctx.beginPath(); ctx.arc(ex, ey, 5.5, 0, TAU); ctx.stroke(); }
        }
        break;
      default:
        AP.R.poly(ctx, x, y, 14, 6, t);
        ctx.stroke();
    }
    ctx.globalAlpha = pa;
    ctx.lineJoin = 'miter';
  }

  var C = {
    bg: 'title',
    t0: 0, scroll: 0, speed: 26, total: 0, params: null, leaving: false, endT: -1
  };

  function creditsHeight() {
    var h = 0;
    for (var i = 0; i < CREDITS.length; i++) {
      var it = CREDITS[i];
      h += it.kind === 'gap' ? it.h : (ROW_H[it.kind] || 40);
    }
    return h;
  }

  function leaveCredits() {
    if (C.leaving) return;
    C.leaving = true;
    var fromEnding = !!(C.params && C.params.fromEnding);
    if (fromEnding && AP.Meta) {
      AP.Meta.pushToast({ title: 'Endless mode unlocked: Apeiron.', sub: 'Find it on the title screen.', kind: 'endless' });
    }
    UI().go('title', {}, 'fade', 1.2);
  }

  C.enter = function (params) {
    C.params = params || {};
    C.t0 = now();
    C.scroll = -40;
    C.leaving = false;
    C.endT = -1;
    C.total = creditsHeight();
    AP.music('credits');
    if (AP.level) AP.level = null;
  };

  C.update = function (dt) {
    var U = UI();
    var n = U.nav();
    if (C.leaving) return;
    if (n.back || n.pause) { U.eat(); AP.sfx('uiBack'); leaveCredits(); return; }
    var fast = AP.Input && (AP.Input.held('confirm') || AP.Input.held('jump') || AP.Input.held('down') || (AP.Input.mouse && AP.Input.mouse.down));
    var target = C.total - 250;
    if (C.scroll < target) C.scroll = Math.min(target, C.scroll + dt * C.speed * (fast ? 5 : 1));
    else {
      if (C.endT < 0) C.endT = now();
      if (now() - C.endT > 5 || (now() - C.endT > 0.6 && (n.confirm || n.click))) { U.eat(); leaveCredits(); }
    }
  };

  C.render = function (ctx) {
    var U = UI();
    var pal = AP.R.pal('title');
    var t = now();
    U.dim(ctx, 0.5, '#000000');
    var y = 560 - C.scroll;
    var pa = ctx.globalAlpha;
    for (var i = 0; i < CREDITS.length; i++) {
      var it = CREDITS[i];
      var h = it.kind === 'gap' ? it.h : (ROW_H[it.kind] || 40);
      var cy = y + h / 2;
      y += h;
      if (cy < -80 || cy > 620) continue;
      // fade at the top and bottom edges; things draw themselves on as they rise into view
      var a = clamp01((cy + 40) / 140) * clamp01((560 - cy) / 120);
      var p = clamp01((540 - cy) / 220);
      if (it.kind === 'logo') {
        stroke(ctx, 'APEIRON', 480, cy - 20, 72, pal.ink, 'center', a, pal.accent, p, 2.6);
        text(ctx, 'a game of geometry', 480, cy + 40, 15, rgba(pal.primary, 0.9), 'center', a * p, '400');
      } else if (it.kind === 'line') {
        text(ctx, it.text, 480, cy, 16, pal.ink, 'center', a * p, '400');
      } else if (it.kind === 'head') {
        stroke(ctx, it.text, 480, cy, 18, pal.ink, 'center', a, pal.accent, p, 2.2);
      } else if (it.kind === 'name') {
        creditGlyph(ctx, it.glyph, 352, cy, t, pal, a * p);
        text(ctx, it.name, 400, cy - 8, 17, pal.ink, 'left', a, '500');
        text(ctx, it.what, 400, cy + 13, 12.5, rgba(pal.primary, 0.85), 'left', a, '500');
      } else if (it.kind === 'end') {
        stroke(ctx, it.text, 480, cy, 22, pal.ink, 'center', a, pal.accent, p, 2.4);
        ctx.globalAlpha = pa * a * p * 0.7;
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1.5;
        lemniscate(ctx, 480, cy + 44, 22, p, 0);
        ctx.stroke();
        ctx.globalAlpha = pa;
      }
    }
    U.vignette(ctx, 0.75);
    var hk = clamp01((t - C.t0 - 1) / 0.8) * 0.75;
    U.hints(ctx, [['confirm', 'Hold to speed up'], ['back', 'Leave']], 940, 522, { align: 'right', pal: pal, alpha: hk, size: 11 });
  };

  AP.Scenes.register('credits', C);
})(window.AP = window.AP || {});
