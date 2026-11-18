/* js/ui/extras.js — owner: UI */
(function (AP) {
  'use strict';

  // Scenes 'theorems' (the gallery: proved, unproved and hidden theorems with progress) and 'cosmetics' (trails and
  // palettes with a live preview that runs the real trail renderer on a stand-in player).
  var TAU = Math.PI * 2;
  var M = AP.M;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function now() { return (AP.Time && AP.Time.now) || 0; }
  function UI() { return AP.UI; }
  function data() { return (AP.Save && AP.Save.data) || null; }

  var TX = { size: 13, weight: '600', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1, maxW: 0, lineH: 0 };
  function text(ctx, str, x, y, size, color, align, alpha, weight, maxW, lineH) {
    TX.size = size; TX.color = color; TX.align = align || 'left'; TX.alpha = alpha === undefined ? 1 : alpha;
    TX.weight = weight || '600'; TX.maxW = maxW || 0; TX.lineH = lineH || 0;
    return AP.R.text(ctx, str, x, y, TX);
  }
  var SO = { size: 20, color: '#FFFFFF', align: 'left', glow: null, glowAlpha: 0.85, alpha: 1, progress: 1, spacing: 1.4, sparks: true, maxW: 0 };
  function stroke(ctx, str, x, y, size, color, align, alpha, glow, progress, maxW) {
    SO.size = size; SO.color = color; SO.align = align || 'left'; SO.alpha = alpha === undefined ? 1 : alpha;
    SO.glow = glow || null; SO.progress = progress === undefined ? 1 : progress; SO.maxW = maxW || 0; SO.sparks = SO.progress < 1;
    return UI().strokeText(ctx, str, x, y, SO);
  }

  function back(from) {
    AP.sfx('uiBack');
    UI().go(from && from !== 'theorems' && from !== 'cosmetics' && AP.Scenes.has(from) ? from : 'title', {}, 'fade', 0.5);
  }

  // ================================================================ theorems gallery
  var COLS = 7, CELL = 66, GX = 64, GY = 132;
  var T = {
    bg: 'title',
    t0: 0, sel: 0, selT: 0, from: null, scroll: 0, leaving: false, nP: 0, line: ''
  };

  function theorems() { return AP.Theorems || []; }
  function proved(id) { return !!(AP.Meta && AP.Meta.isProved(id)); }

  function moveSel(d) {
    var n = theorems().length;
    if (!n) return;
    var s = clamp(T.sel + d, 0, n - 1);
    if (s === T.sel) { AP.sfx('uiDeny', { vol: 0.35 }); return; }
    T.sel = s;
    T.selT = now();
    AP.sfx('uiMove', { pitch: 0.9 + 0.3 * s / n });
  }

  T.enter = function (params) {
    T.from = (params && params.from) || 'title';
    T.t0 = now();
    T.selT = T.t0;
    T.leaving = false;
    if (T.sel >= theorems().length) T.sel = 0;
    T.nP = AP.Meta ? AP.Meta.provedCount() : 0;
    T.line = T.nP + ' of ' + theorems().length + ' proved';
    if (AP.level) AP.level = null;
  };

  T.update = function () {
    var U = UI();
    var n = U.nav();
    if (T.leaving) return;
    if (n.back) { U.eat(); T.leaving = true; back(T.from); return; }
    if (n.left) moveSel(-1);
    if (n.right) moveSel(1);
    if (n.up) moveSel(-COLS);
    if (n.down) moveSel(COLS);
    if (n.confirm) {
      U.eat();
      var th = theorems()[T.sel];
      if (th && proved(th.id)) {
        AP.sfx('chime', { vol: 0.5, pitch: 1 + (T.sel % 5) * 0.08 });
        T.selT = now() - 0.05;
        var p = cellCenter(T.sel);
        U.sparks.emit(p.x, p.y, { n: 18, color: AP.R.pal('title').accent, color2: '#FFFFFF', speed: [40, 180], life: [0.3, 0.7], size: [1, 2.2], drag: 3, shape: 3 });
      } else AP.sfx('uiDeny', { vol: 0.5 });
    }
    if (n.moved || n.click) {
      var list = theorems();
      for (var i = 0; i < list.length; i++) {
        var c = cellCenter(i);
        if (Math.abs(n.mx - c.x) < CELL / 2 && Math.abs(n.my - c.y) < CELL / 2) {
          if (i !== T.sel) { T.sel = i; T.selT = now(); AP.sfx('uiMove', { vol: 0.6 }); }
          break;
        }
      }
    }
  };

  var cc = { x: 0, y: 0 };
  function cellCenter(i) {
    cc.x = GX + (i % COLS) * CELL + CELL / 2;
    cc.y = GY + Math.floor(i / COLS) * CELL + CELL / 2;
    return cc;
  }

  T.render = function (ctx) {
    var U = UI();
    var pal = AP.R.pal('title');
    var t = now() - T.t0;
    var list = theorems();
    U.sparks.tick();
    U.dim(ctx, 0.45, '#000000');
    U.vignette(ctx, 0.7);
    var nP = T.nP;
    U.header(ctx, 'THEOREMS', GX, 58, t, pal, { size: 30 });
    text(ctx, T.line, GX, 96, 12, rgba(pal.primary, 0.9), 'left', clamp01(t / 0.5), '700');
    U.bar(ctx, GX + 130, 96, 200, 3, list.length ? nP / list.length : 0, pal, { alpha: clamp01(t / 0.5) });
    var pa = ctx.globalAlpha;
    for (var i = 0; i < list.length; i++) {
      var th = list[i];
      var c = cellCenter(i);
      var x = c.x, y = c.y;
      var k = M.ease.outBack(clamp01((t - 0.1 - i * 0.015) / 0.35));
      if (k <= 0) continue;
      var ok = proved(th.id);
      var hidden = th.hidden && !ok;
      var sel = i === T.sel;
      ctx.globalAlpha = pa * clamp01(k);
      UI().chamferPath(ctx, x - 29, y - 29, 58, 58, 8);
      ctx.fillStyle = sel ? rgba(pal.accent, 0.16) : (ok ? rgba(pal.accent, 0.06) : rgba(pal.primary, 0.03));
      ctx.fill();
      ctx.strokeStyle = sel ? pal.accent : (ok ? rgba(pal.accent, 0.45) : rgba(pal.primary, 0.18));
      ctx.lineWidth = sel ? 1.6 : 1;
      ctx.stroke();
      ctx.globalAlpha = pa;
      if (hidden) {
        stroke(ctx, '?', x, y, 22, rgba(pal.ink, 0.45), 'center', clamp01(k), null);
      } else if (ok) {
        AP.R.glow(ctx, x, y, 26, pal.accent, (sel ? 0.45 : 0.22) * clamp01(k));
        U.emblem(ctx, th.id, x, y, 17 * k, pal.accent, clamp01(k), t);
      } else {
        U.emblem(ctx, th.id, x, y, 17 * k, pal.primary, 0.3 * clamp01(k), 0);
      }
      if (sel) U.marker(ctx, x + 22, y - 22, 4, t, pal.accent, undefined, 1);
    }
    drawTheoremDetail(ctx, pal, t);
    U.hints(ctx, [[['left', 'right', 'up', 'down'], 'Browse'], ['back', 'Back']], 480, 518, { align: 'center', pal: pal, alpha: clamp01(t / 0.6) * 0.85 });
    U.sparks.render(ctx);
    ctx.globalAlpha = pa;
  };

  function drawTheoremDetail(ctx, pal, t) {
    var U = UI();
    var th = theorems()[T.sel];
    if (!th) return;
    var ok = proved(th.id);
    var hidden = th.hidden && !ok;
    var st = now() - T.selT;
    var x = 560, y = 112, w = 360, h = 360;
    var a = clamp01(t / 0.4);
    var pa = ctx.globalAlpha;
    U.panel(ctx, x, y, w, h, { pal: pal, alpha: a, fillAlpha: 0.82 });
    var cx = x + w / 2, cy = y + 104;
    // a slow golden spiral behind the emblem
    ctx.globalAlpha = pa * a * 0.18;
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i <= 120; i++) {
      var ang = i * 0.09 + now() * 0.1;
      var r = 3 * Math.exp(0.306 * i * 0.09);
      if (r > 80) break;
      var px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = pa;
    var ek = M.ease.outBack(clamp01(st / 0.45));
    if (hidden) {
      stroke(ctx, '?', cx, cy, 64 * (0.6 + 0.4 * ek), rgba(pal.ink, 0.5), 'center', a, null, clamp01(st / 0.6));
      ctx.globalAlpha = pa * a * 0.4;
      ctx.strokeStyle = pal.primary;
      ctx.setLineDash(DASH6);
      ctx.beginPath();
      ctx.arc(cx, cy, 52, 0, TAU);
      ctx.stroke();
      ctx.setLineDash(NODASH);
      ctx.globalAlpha = pa;
    } else {
      if (ok) AP.R.glow(ctx, cx, cy, 48, pal.accent, 0.5 * a);
      U.emblem(ctx, th.id, cx, cy, 46 * ek, ok ? pal.accent : pal.primary, a * (ok ? 1 : 0.45), now());
    }
    var ty = y + 196;
    stroke(ctx, hidden ? 'HIDDEN THEOREM' : th.name.toUpperCase(), cx, ty, 19, ok ? pal.ink : rgba(pal.ink, 0.8), 'center', a, ok ? pal.accent : null, clamp01(st / 0.7), w - 40);
    text(ctx, hidden ? 'Some truths reveal themselves only once proved.' : th.desc, cx, ty + 30, 13, rgba(pal.ink, 0.85), 'center', a * clamp01(st / 0.4), '500', w - 50);
    if (ok && th.flavor) text(ctx, '“' + th.flavor + '”', cx, ty + 66, 12, rgba(pal.primary, 0.9), 'center', a * clamp01((st - 0.2) / 0.4), '500', w - 56, 16);
    // progress toward a numeric goal
    var pr = AP.Meta && !hidden ? AP.Meta.progress(th.id) : null;
    if (pr && !ok) {
      var by = y + h - 64;
      U.bar(ctx, x + 40, by, w - 80, 4, pr.goal ? pr.value / pr.goal : 0, pal, { alpha: a, glow: 0.5 });
      text(ctx, pr.value + ' / ' + pr.goal, cx, by + 18, 12, pal.ink, 'center', a, '700');
    }
    // status stamp
    var sy = y + h - 26;
    if (ok) {
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 40, sy); ctx.lineTo(cx - 34, sy + 6); ctx.lineTo(cx - 24, sy - 6);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.globalAlpha = pa;
      text(ctx, 'Q.E.D.', cx - 14, sy, 12, pal.accent, 'left', a, '800');
    } else if (!pr) {
      text(ctx, 'UNPROVED', cx, sy, 11, rgba(pal.primary, 0.7), 'center', a, '800');
    }
    ctx.globalAlpha = pa;
  }
  var DASH6 = [4, 6], NODASH = [];

  AP.Scenes.register('theorems', T);

  // ================================================================ cosmetics
  var C = {
    bg: 'title',
    t0: 0, col: 0, sel: [0, 0], selT: 0, from: null, state: null, P: null, leaving: false, denyT: -9, equipT: -9, gemLine: ''
  };

  function entries(col) { var Cs = AP.Cosmetics; return Cs ? (col === 0 ? Cs.TRAILS : Cs.PALETTES) : []; }
  function current() { var e = entries(C.col); return e[clamp(C.sel[C.col], 0, e.length - 1)] || null; }

  function equipSelected() {
    var Cs = AP.Cosmetics;
    var it = current();
    if (!Cs || !it) return;
    if (!Cs.isUnlocked(it.id)) {
      C.denyT = now();
      AP.sfx('uiDeny');
      return;
    }
    if (Cs.equipped(C.col === 0 ? 'trail' : 'palette') === it.id) { AP.sfx('uiMove', { vol: 0.5 }); return; }
    if (Cs.equip(C.col === 0 ? 'trail' : 'palette', it.id)) {
      C.equipT = now();
      AP.sfx('gem', { vol: 0.6 });
      var pal = AP.R.pal('title');
      UI().sparks.emit(710, 290, { n: 30, color: pal.accent, color2: '#FFFFFF', speed: [60, 240], life: [0.4, 0.9], size: [1, 2.4], drag: 2.5, shape: 2 });
    }
  }

  C.enter = function (params) {
    C.from = (params && params.from) || 'title';
    C.t0 = now();
    C.selT = C.t0;
    C.leaving = false;
    C.state = AP.Cosmetics ? new AP.Cosmetics.TrailState() : null;
    C.gemLine = (AP.Meta ? AP.Meta.gemCount() : 0) + ' of 72 prime gems';
    var Cs = AP.Cosmetics;
    // start on whatever is equipped
    if (Cs) {
      var tr = Cs.TRAILS, pl = Cs.PALETTES, i;
      for (i = 0; i < tr.length; i++) if (tr[i].id === Cs.equipped('trail')) C.sel[0] = i;
      for (i = 0; i < pl.length; i++) if (pl[i].id === Cs.equipped('palette')) C.sel[1] = i;
    }
    C.P = { rx: 0, ry: 0, w: 22, h: 22, vx: 0, vy: 0, form: 3, state: 'normal', invuln: 0, vis: { rot: 0, sx: 1, sy: 1, offY: 0 } };
    if (AP.level) AP.level = null;
  };

  C.update = function () {
    var U = UI();
    var n = U.nav();
    if (C.leaving) return;
    if (n.back) { U.eat(); C.leaving = true; back(C.from); return; }
    if (n.left || n.right) {
      var nc = n.left ? 0 : 1;
      if (nc !== C.col) { C.col = nc; C.selT = now(); AP.sfx('uiMove'); if (C.state) C.state.reset(); }
    }
    var e = entries(C.col);
    if (n.up || n.down) {
      var s = clamp(C.sel[C.col] + (n.up ? -1 : 1), 0, e.length - 1);
      if (s !== C.sel[C.col]) { C.sel[C.col] = s; C.selT = now(); AP.sfx('uiMove', { pitch: 0.9 + s * 0.05 }); if (C.state) C.state.reset(); }
      else AP.sfx('uiDeny', { vol: 0.35 });
    }
    if (n.confirm) { U.eat(); equipSelected(); }
    if (n.moved || n.click) {
      for (var col = 0; col < 2; col++) {
        var list = entries(col);
        for (var i = 0; i < list.length; i++) {
          var r = rowRect(col, i);
          if (n.mx >= r.x && n.mx < r.x + r.w && n.my >= r.y && n.my < r.y + r.h) {
            if (col !== C.col || i !== C.sel[col]) { C.col = col; C.sel[col] = i; C.selT = now(); AP.sfx('uiMove', { vol: 0.6 }); if (C.state) C.state.reset(); }
            if (n.click) equipSelected();
          }
        }
      }
    }
  };

  var rr = { x: 0, y: 0, w: 0, h: 0 };
  function rowRect(col, i) {
    rr.x = col === 0 ? 48 : 276;
    rr.y = 150 + i * 46;
    rr.w = 214;
    rr.h = 40;
    return rr;
  }

  // the stand-in player traces a Lissajous figure across the preview stage
  function stepPreview(t) {
    var P = C.P;
    var d = data();
    P.form = (d && d.form) || 3;
    // a figure-eight at running-to-dashing speeds (about 250..520 u/s), so every trail shows its pattern
    var cx = 710, cy = 286;
    var w = 1.75;
    var u = t * w + 0.35 * Math.sin(t * 0.9);
    var du = w + 0.315 * Math.cos(t * 0.9);
    var x = cx + 150 * Math.sin(u + 0.4), y = cy + 70 * Math.sin(u * 2.0);
    P.rx = x - 11; P.ry = y - 11;
    P.vx = 150 * Math.cos(u + 0.4) * du; P.vy = 140 * Math.cos(u * 2.0) * du;
    P.vis.rot += (P.vx * 0.012) * UI().frameDt();
  }

  C.render = function (ctx) {
    var U = UI();
    var Cs = AP.Cosmetics;
    var pal = AP.R.pal('title');
    var t = now() - C.t0;
    U.sparks.tick();
    U.dim(ctx, 0.45, '#000000');
    U.vignette(ctx, 0.7);
    U.header(ctx, 'COSMETICS', 48, 58, t, pal, { size: 30 });
    U.gem(ctx, 56, 98, 7, 2, pal, clamp01(t / 0.5));
    text(ctx, C.gemLine, 70, 98, 12, rgba(pal.primary, 0.9), 'left', clamp01(t / 0.5), '700');
    if (!Cs) return;
    var heads = ['TRAILS', 'PALETTES'];
    var pa = ctx.globalAlpha;
    for (var col = 0; col < 2; col++) {
      var list = entries(col);
      var hx = rowRect(col, 0).x;
      text(ctx, heads[col], hx, 132, 11, col === C.col ? pal.accent : rgba(pal.primary, 0.7), 'left', clamp01(t / 0.4), '800');
      var kind = col === 0 ? 'trail' : 'palette';
      var eq = Cs.equipped(kind);
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var r = rowRect(col, i);
        var k = clamp01((t - 0.1 - i * 0.03 - col * 0.06) / 0.3);
        if (k <= 0) continue;
        var sel = col === C.col && i === C.sel[col];
        var un = Cs.isUnlocked(it.id);
        var isEq = eq === it.id;
        var shake = sel ? Math.sin(now() * 60) * 4 * clamp01(1 - (now() - C.denyT) / 0.3) : 0;
        ctx.globalAlpha = pa * k;
        U.chamferPath(ctx, r.x + shake, r.y, r.w, r.h, 6);
        ctx.fillStyle = sel ? rgba(pal.accent, 0.16) : rgba(pal.primary, 0.04);
        ctx.fill();
        ctx.strokeStyle = sel ? pal.accent : (isEq ? rgba(pal.accent, 0.6) : rgba(pal.primary, 0.2));
        ctx.lineWidth = sel ? 1.6 : 1;
        ctx.stroke();
        ctx.globalAlpha = pa;
        swatch(ctx, col, it, r.x + 22 + shake, r.y + r.h / 2, un, pal, k);
        text(ctx, it.name, r.x + 44 + shake, r.y + 14, 13.5, un ? pal.ink : rgba(pal.ink, 0.45), 'left', k, '700');
        text(ctx, isEq ? 'Equipped' : (un ? 'Unlocked' : Cs.requirement(it.id)), r.x + 44 + shake, r.y + 29, 10.5,
          isEq ? pal.accent : rgba(pal.primary, un ? 0.75 : 0.55), 'left', k, '600', r.w - 50);
        if (!un) U.lock(ctx, r.x + r.w - 16, r.y + r.h / 2, 10, pal.primary, 0.6 * k);
        else if (isEq) UI().marker(ctx, r.x + r.w - 16, r.y + r.h / 2, 4, now(), pal.accent, undefined, k);
      }
    }
    drawPreview(ctx, pal, t);
    U.hints(ctx, [[['up', 'down'], 'Select'], [['left', 'right'], 'Trails / Palettes'], ['confirm', 'Equip'], ['back', 'Back']], 480, 518,
      { align: 'center', pal: pal, alpha: clamp01(t / 0.6) * 0.85 });
    U.sparks.render(ctx);
    ctx.globalAlpha = pa;
  };

  // a small icon per entry: the trail's motif, or the palette's colours
  function swatch(ctx, col, it, x, y, un, pal, a) {
    var Cs = AP.Cosmetics;
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * a * (un ? 1 : 0.4);
    ctx.lineWidth = 1.3;
    if (col === 1) {
      var s = Cs.styleOf(it.id, 3, now()) || { fill: pal.accent, stroke: pal.ink, glow: pal.accent };
      AP.R.poly(ctx, x, y, 10, 6, Math.PI / 6);
      ctx.fillStyle = s.fill === '#000000' ? '#000000' : rgba(s.fill, 0.55);
      ctx.fill();
      ctx.strokeStyle = s.stroke;
      ctx.stroke();
      ctx.globalAlpha = pa;
      return;
    }
    ctx.strokeStyle = pal.accent;
    ctx.fillStyle = pal.accent;
    var i;
    ctx.beginPath();
    switch (it.id) {
      case 'spirograph':
        for (i = 0; i <= 60; i++) {
          var th = i / 60 * TAU * 3;
          var px = x + 3 * Math.cos(th) + 6 * Math.cos(th * 2 / 3), py = y + 3 * Math.sin(th) - 6 * Math.sin(th * 2 / 3);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        break;
      case 'fibonacci':
        for (i = 1; i < 34; i++) {
          var rr2 = 1.7 * Math.sqrt(i), a2 = i * 2.39996;
          ctx.moveTo(x + Math.cos(a2) * rr2 + 0.9, y + Math.sin(a2) * rr2);
          ctx.arc(x + Math.cos(a2) * rr2, y + Math.sin(a2) * rr2, 0.9, 0, TAU);
        }
        ctx.fill();
        break;
      case 'sierpinski':
        if (AP.Art && AP.Art.sierpinski) AP.Art.sierpinski(ctx, x, y + 1, 20, 2, pal.accent, 1);
        break;
      case 'lissajous':
        for (i = 0; i <= 60; i++) {
          var s2 = i / 60 * TAU;
          var lx = x + 9 * Math.sin(3 * s2), ly = y + 8 * Math.sin(2 * s2);
          if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
        }
        ctx.stroke();
        break;
      case 'prism':
        var SP = Cs.SPECTRUM;
        for (i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.strokeStyle = SP[i * 2];
          AP.R.poly(ctx, x + (i - 1.5) * 2, y, 7, 3, -Math.PI / 2);
          ctx.stroke();
        }
        break;
      case 'apeiron':
        for (i = 0; i <= 40; i++) {
          var v = i / 40 * TAU, sv = Math.sin(v), cv = Math.cos(v), dv = 1 + sv * sv;
          var ax = x + 10 * cv / dv, ay = y + 10 * sv * cv / dv;
          if (i === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
        }
        ctx.stroke();
        break;
      default:
        AP.R.poly(ctx, x, y, 8, 3, -Math.PI / 2);
        ctx.strokeStyle = rgba(pal.ink, 0.5);
        ctx.stroke();
    }
    ctx.globalAlpha = pa;
  }

  function drawPreview(ctx, pal, t) {
    var U = UI();
    var Cs = AP.Cosmetics;
    var x = 512, y = 118, w = 400, h = 340;
    var a = clamp01(t / 0.4);
    var d = data();
    var wn = 1;
    if (AP.Progress && AP.Progress.current) { var pid = U.parseId(AP.Progress.current()); if (pid) wn = pid.world; }
    var W = AP.Worlds ? AP.Worlds.get(wn) : null;
    var wpal = AP.R.pal(W ? W.style : 'w1');
    var pa = ctx.globalAlpha;
    U.panel(ctx, x, y, w, h, { pal: pal, alpha: a, fill: wpal.bg, fillAlpha: 0.94 });
    // the preview stage: a few platforms in the current world's colours
    ctx.save();
    U.chamferPath(ctx, x + 2, y + 2, w - 4, h - 4, 10);
    ctx.clip();
    ctx.globalAlpha = pa * a * 0.12;
    ctx.strokeStyle = wpal.primary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = x; gx < x + w; gx += 32) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    for (var gy = y; gy < y + h; gy += 32) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
    ctx.globalAlpha = pa * a;
    ctx.fillStyle = rgba(wpal.primary, 0.16);
    ctx.fillRect(x, y + h - 40, w, 40);
    ctx.strokeStyle = wpal.primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + h - 40); ctx.lineTo(x + w, y + h - 40);
    ctx.stroke();
    var trailId = C.col === 0 ? current().id : Cs.equipped('trail');
    var palId = C.col === 1 ? current().id : Cs.equipped('palette');
    var nowT = now();
    stepPreview(nowT);
    if (C.state) Cs.renderTrail(ctx, C.state, C.P, trailId, palId, nowT, wpal);
    if (trailId === 'none') {
      // the default afterimage, as the game draws it at speed
      ctx.globalAlpha = pa * a * 0.25;
      ctx.strokeStyle = wpal.ink;
      ctx.lineWidth = 1.5;
      var st = C.state;
      for (var j = 3; st && j < Math.min(st.len, 24); j += 3) {
        var idx = st.at(j);
        AP.R.poly(ctx, st.x[idx], st.y[idx], 13 * (1 - j / 40), U.formSides(C.P.form) >= 32 ? 24 : U.formSides(C.P.form), st.r[idx]);
        ctx.stroke();
      }
      ctx.globalAlpha = pa * a;
    }
    var sty = Cs.styleOf(palId, C.P.form, nowT);
    U.playerGlyph(ctx, C.P.rx + 11, C.P.ry + 11, 13, C.P.form, C.P.vis.rot, sty, a, wpal, nowT);
    ctx.restore();
    // labels
    var it = current();
    var un = it && Cs.isUnlocked(it.id);
    var lk = clamp01((now() - C.selT) / 0.5);
    text(ctx, C.col === 0 ? 'TRAIL' : 'PALETTE', x + 20, y + 24, 10.5, pal.accent, 'left', a, '800');
    if (it) {
      stroke(ctx, it.name.toUpperCase(), x + 20, y + 48, 18, pal.ink, 'left', a, pal.accent, Math.max(0.2, lk), w - 40);
      text(ctx, it.desc, x + 20, y + 72, 12, rgba(pal.ink, 0.8), 'left', a * lk, '500', w - 40);
      if (!un) {
        text(ctx, 'PREVIEW · ' + Cs.requirement(it.id).toUpperCase(), x + w / 2, y + h - 20, 10.5, rgba(pal.ink, 0.75), 'center', a, '800');
      } else {
        var ek = clamp01(1 - (now() - C.equipT) / 0.8);
        text(ctx, Cs.equipped(C.col === 0 ? 'trail' : 'palette') === it.id ? 'EQUIPPED' : 'PRESS ' + AP.Input.label('confirm').toUpperCase() + ' TO EQUIP',
          x + w / 2, y + h - 20, 10.5 * (1 + 0.2 * ek), pal.accent, 'center', a, '800');
      }
    }
    ctx.globalAlpha = pa;
  }

  AP.Scenes.register('cosmetics', C);
})(window.AP = window.AP || {});
