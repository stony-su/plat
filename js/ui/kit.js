/* js/ui/kit.js — owner: UI */
(function (AP) {
  'use strict';

  // AP.UI: the shared UI kit.
  //   - the geometric stroke font (4x6 grid of segments and arcs, draw-on reveal, glow): strokeText, measure
  //   - shapes: panels, chips, focus markers, morphing form outlines, gem and shard icons, theorem emblems
  //   - input: one navigation snapshot per fixed step (keyboard, pad, mouse) with the ui* sounds
  //   - widgets: Menu (vertical list or horizontal row of buttons, sliders, toggles, choices) and Dialog
  //   - transitions: drawTransition(ctx, kind, cover, color) for 'iris', 'shatter' and 'fade'
  var M = AP.M;
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;
  var EMPTY = {};

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function fin(v, d) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d; }
  function now() { return (AP.Time && AP.Time.now) || 0; }
  function sfx(name, o) { if (AP.sfx) AP.sfx(name, o); }

  var UI = {};
  UI.SP = { xs: 4, s: 8, m: 16, l: 24, xl: 40 };
  UI.W = 960;
  UI.H = 540;

  // ================================================================ stroke font
  // Glyphs live on a 4 x 6 grid (x right, y down, cap height 6). Path language, compiled once at load:
  //   M x y            start a stroke          L x y               line to
  //   A cx cy r a0 a1  arc (degrees, +clockwise on screen) continuing the stroke
  //   C cx cy r        full circle             D x y               dot
  var GLYPH_SRC = {
    'A': [4, 'M0 6 L2 0 L4 6 M0.67 4 L3.33 4'],
    'B': [4, 'M0 6 L0 0 L2.3 0 A2.3 1.5 1.5 -90 90 L0 3 M0 3 L2.5 3 A2.5 4.5 1.5 -90 90 L0 6'],
    'C': [4, 'M3.73 1 A2 2 2 -30 -180 L0 4 A2 4 2 180 30'],
    'D': [4, 'M0 0 L0 6 L2 6 A2 4 2 90 0 L4 2 A2 2 2 0 -90 L0 0'],
    'E': [4, 'M4 0 L0 0 L0 6 L4 6 M0 3 L3 3'],
    'F': [4, 'M4 0 L0 0 L0 6 M0 3 L3 3'],
    'G': [4, 'M3.73 1 A2 2 2 -30 -180 L0 4 A2 4 2 180 0 L4 3.2 L2.4 3.2'],
    'H': [4, 'M0 0 L0 6 M4 0 L4 6 M0 3 L4 3'],
    'I': [0, 'M0 0 L0 6'],
    'J': [3.5, 'M3.5 0 L3.5 4.25 A1.75 4.25 1.75 0 180'],
    'K': [4, 'M0 0 L0 6 M4 0 L0 4 M1.5 2.5 L4 6'],
    'L': [3.6, 'M0 0 L0 6 L3.6 6'],
    'M': [5, 'M0 6 L0 0 L2.5 4 L5 0 L5 6'],
    'N': [4, 'M0 6 L0 0 L4 6 L4 0'],
    'O': [4, 'M0 2 A2 2 2 180 360 L4 4 A2 4 2 0 180 L0 2'],
    'P': [4, 'M0 6 L0 0 L2.4 0 A2.4 1.6 1.6 -90 90 L0 3.2'],
    'Q': [4.2, 'M0 2 A2 2 2 180 360 L4 4 A2 4 2 0 180 L0 2 M2.6 4.2 L4.2 6.2'],
    'R': [4, 'M0 6 L0 0 L2.4 0 A2.4 1.6 1.6 -90 90 L0 3.2 M2.2 3.2 L4 6'],
    'S': [3.6, 'M3.1 0.75 A1.8 1.5 1.5 -30 -270 A1.8 4.5 1.5 -90 150'],
    'T': [4, 'M0 0 L4 0 M2 0 L2 6'],
    'U': [4, 'M0 0 L0 4 A2 4 2 180 0 L4 0'],
    'V': [4, 'M0 0 L2 6 L4 0'],
    'W': [5.2, 'M0 0 L1.3 6 L2.6 1.5 L3.9 6 L5.2 0'],
    'X': [4, 'M0 0 L4 6 M4 0 L0 6'],
    'Y': [4, 'M0 0 L2 3 L4 0 M2 3 L2 6'],
    'Z': [4, 'M0 0 L4 0 L0 6 L4 6'],
    '0': [4, 'M0 2 A2 2 2 180 360 L4 4 A2 4 2 0 180 L0 2 M3 1.2 L1 4.8'],
    '1': [1.5, 'M0 1.3 L1.5 0 L1.5 6'],
    '2': [4, 'M0 2 A2 2 2 180 390 L0 6 L4 6'],
    '3': [3.6, 'M0.5 0.75 A1.8 1.5 1.5 -150 90 A1.8 4.5 1.5 -90 150'],
    '4': [4, 'M3 6 L3 0 L0 4.2 L4 4.2'],
    '5': [3.8, 'M3.8 0 L0.84 0 L0.84 2.82 A2 4.2 1.8 -130 155'],
    '6': [4, 'M3.2 0 L0.35 2.9 A2 4 2 -146.3 -506.3'],
    '7': [4, 'M0 0 L4 0 L1.4 6'],
    '8': [3.8, 'C1.9 1.45 1.45 C1.9 4.35 1.65'],
    '9': [4, 'M3.65 3.1 A2 2 2 33.7 -326.3 L0.8 6'],
    '.': [0.6, 'D0.3 5.7'],
    ',': [0.8, 'M0.7 5.2 L0.1 6.8'],
    ':': [0.6, 'D0.3 1.9 D0.3 5.7'],
    ';': [0.8, 'D0.5 1.9 M0.7 5.2 L0.1 6.8'],
    '!': [0.6, 'M0.3 0 L0.3 4.2 D0.3 5.7'],
    '?': [3.6, 'M0 1.8 A1.8 1.8 1.8 180 395 L1.8 4.1 D1.8 5.7'],
    "'": [0.6, 'M0.3 0 L0.3 1.8'],
    '"': [1.6, 'M0.2 0 L0.2 1.8 M1.4 0 L1.4 1.8'],
    '-': [2.8, 'M0 3.3 L2.8 3.3'],
    '+': [3.6, 'M1.8 1.5 L1.8 5.1 M0 3.3 L3.6 3.3'],
    '/': [3, 'M3 0 L0 6'],
    '(': [1.6, 'M1.6 0 A3.6125 3 3.6125 236.1 123.9'],
    ')': [1.6, 'M0 0 A-2.0125 3 3.6125 -56.1 56.1'],
    '·': [0.8, 'D0.4 3.3'],
    '×': [3.2, 'M0.2 1.9 L3 4.7 M3 1.9 L0.2 4.7'],
    '→': [4, 'M0 3.3 L4 3.3 M2.5 1.8 L4 3.3 L2.5 4.8'],
    '←': [4, 'M4 3.3 L0 3.3 M1.5 1.8 L0 3.3 L1.5 4.8'],
    '↑': [3, 'M1.5 6 L1.5 0 M0 1.5 L1.5 0 L3 1.5'],
    '↓': [3, 'M1.5 0 L1.5 6 M0 4.5 L1.5 6 L3 4.5'],
    '%': [4, 'M3.6 0 L0.4 6 C0.9 1 0.9 C3.1 5 0.9'],
    '—': [5, 'M0 3.3 L5 3.3'],
    '–': [3.5, 'M0 3.3 L3.5 3.3'],
    '#': [4, 'M1.5 0.5 L1 5.5 M3 0.5 L2.5 5.5 M0.2 2.2 L4 2.2 M0 3.9 L3.8 3.9'],
    '=': [3.6, 'M0 2.5 L3.6 2.5 M0 4.1 L3.6 4.1'],
    '*': [3.2, 'M1.6 0.8 L1.6 3.6 M0.39 1.5 L2.81 2.9 M2.81 1.5 L0.39 2.9'],
    '_': [4, 'M0 6.4 L4 6.4'],
    '<': [3.2, 'M3.2 1 L0 3.3 L3.2 5.6'],
    '>': [3.2, 'M0 1 L3.2 3.3 L0 5.6'],
    '[': [1.6, 'M1.6 0 L0 0 L0 6 L1.6 6'],
    ']': [1.6, 'M0 0 L1.6 0 L1.6 6 L0 6'],
    '|': [0, 'M0 -0.3 L0 6.3'],
    '✓': [4, 'M0 3.6 L1.4 5.4 L4 0.8'],
    '&': [4.2, 'M4.2 6 L1 2.4 A1.6 1.4 1.4 135 -45 L0.6 4.2 A2 4.6 1.4 220 60 L4 3.2'],
    '\u0000': [3, 'M1.5 1.5 L3 3.3 L1.5 5.1 L0 3.3 L1.5 1.5']
  };
  var SPACE_W = 2.6;
  var ACCENT_MAP = { 'Ł': 'L', 'Ø': 'O', 'Đ': 'D', 'Æ': 'AE', 'Œ': 'OE', 'ß': 'SS', '∞': '∞', '…': '...', '’': "'", '‘': "'", '“': '"', '”': '"' };

  var GLYPHS = {};

  function arcPoints(pts, cx, cy, r, a0, a1, skipFirst) {
    var span = Math.abs(a1 - a0);
    var steps = Math.max(2, Math.ceil(span / 11));
    for (var i = skipFirst ? 1 : 0; i <= steps; i++) {
      var a = (a0 + (a1 - a0) * i / steps) * DEG;
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }

  function finishGlyph(w, strokes) {
    var g = { w: w, strokes: [], lens: [], seg: [], total: 0 };
    for (var s = 0; s < strokes.length; s++) {
      var p = strokes[s];
      if (p.length < 4) continue;
      var arr = new Float32Array(p);
      var seg = new Float32Array(p.length / 2);
      var L = 0;
      for (var i = 2; i < p.length; i += 2) {
        var dx = p[i] - p[i - 2], dy = p[i + 1] - p[i - 1];
        var d = Math.sqrt(dx * dx + dy * dy);
        seg[i / 2] = d;
        L += d;
      }
      if (L <= 0) L = 0.01;
      g.strokes.push(arr);
      g.seg.push(seg);
      g.lens.push(L);
      g.total += L;
    }
    return g;
  }

  function compileGlyph(w, src) {
    var toks = src.split(/\s+/);
    var strokes = [];
    var cur = null;
    var i = 0;
    function num() { return parseFloat(toks[i++]); }
    while (i < toks.length) {
      var t = toks[i];
      if (!t) { i++; continue; }
      var cmd = t.charAt(0);
      toks[i] = t.slice(1);
      var x, y, cx, cy, r, a0, a1;
      if (cmd === 'M') { x = num(); y = num(); cur = [x, y]; strokes.push(cur); }
      else if (cmd === 'L') { x = num(); y = num(); if (!cur) { cur = []; strokes.push(cur); } cur.push(x, y); }
      else if (cmd === 'A') {
        cx = num(); cy = num(); r = num(); a0 = num(); a1 = num();
        var sx = cx + Math.cos(a0 * DEG) * r, sy = cy + Math.sin(a0 * DEG) * r;
        if (!cur) { cur = []; strokes.push(cur); }
        var n = cur.length;
        var joined = n >= 2 && Math.abs(cur[n - 2] - sx) < 0.02 && Math.abs(cur[n - 1] - sy) < 0.02;
        arcPoints(cur, cx, cy, r, a0, a1, joined);
      } else if (cmd === 'C') {
        cx = num(); cy = num(); r = num();
        cur = [];
        strokes.push(cur);
        arcPoints(cur, cx, cy, r, 0, 360, false);
        cur = null;
      } else if (cmd === 'D') {
        x = num(); y = num();
        var d = [];
        arcPoints(d, x, y, 0.3, 0, 360, false);
        strokes.push(d);
        cur = null;
      } else { i++; }
    }
    return finishGlyph(w, strokes);
  }

  (function buildFont() {
    for (var ch in GLYPH_SRC) {
      if (!Object.prototype.hasOwnProperty.call(GLYPH_SRC, ch)) continue;
      GLYPHS[ch] = compileGlyph(GLYPH_SRC[ch][0], GLYPH_SRC[ch][1]);
    }
    // the lemniscate of Bernoulli: the infinity sign, drawn as one closed stroke
    var inf = [];
    for (var k = 0; k <= 64; k++) {
      var t = k / 64 * TAU + Math.PI / 2;
      var s = Math.sin(t), c = Math.cos(t), d = 1 + s * s;
      inf.push(3 + 3 * c / d, 3.3 + 3 * s * c / d * 1.3);
    }
    GLYPHS['∞'] = finishGlyph(6, [inf]);
    GLYPHS.unknown = GLYPHS['\u0000'];
  })();

  // normalisation: upper case, accents stripped, unknown glyphs mapped to a placeholder (cached per string)
  var normCache = {};
  var normCount = 0;
  function normalize(str) {
    var key = String(str);
    var hit = normCache[key];
    if (hit !== undefined) return hit;
    var up = key.toUpperCase();
    var out = '';
    for (var i = 0; i < up.length; i++) {
      var ch = up.charAt(i);
      if (ch === ' ' || GLYPHS[ch]) { out += ch; continue; }
      if (ACCENT_MAP[ch]) { out += ACCENT_MAP[ch]; continue; }
      var base = ch;
      try { if (ch.normalize) base = ch.normalize('NFD').charAt(0); } catch (e) { base = ch; }
      if (base !== ch && GLYPHS[base]) { out += base; continue; }
      if (ch === '\t' || ch === '\n') { out += ' '; continue; }
      out += '\u0000';
    }
    if (++normCount > 600) { normCache = {}; normCount = 0; }
    normCache[key] = out;
    return out;
  }

  function glyphOf(ch) { return GLYPHS[ch] || GLYPHS.unknown; }

  // width in units of a normalised string
  var widthCache = {};
  var widthCount = 0;
  function unitsWidth(s, spacing) {
    var key = spacing + '|' + s;
    var w = widthCache[key];
    if (w !== undefined) return w;
    w = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      w += (ch === ' ' ? SPACE_W : glyphOf(ch).w);
      if (i < s.length - 1) w += spacing;
    }
    if (++widthCount > 800) { widthCache = {}; widthCount = 0; }
    widthCache[key] = w;
    return w;
  }

  var DEF_SPACING = 1.4;
  UI.UNIT = 0.12;           // grid unit per em (cap height = 0.72 em)

  // measure(str, size, spacing) -> width in px
  UI.measure = function (str, size, spacing) {
    if (str === null || str === undefined) return 0;
    var s = normalize(str);
    return unitsWidth(s, spacing === undefined ? DEF_SPACING : spacing) * (size || 32) * UI.UNIT;
  };

  // fit a stroke string into maxW: returns the size to use
  UI.fitSize = function (str, size, maxW, spacing) {
    var w = UI.measure(str, size, spacing);
    return (w > maxW && w > 0) ? size * maxW / w : size;
  };

  var sparkX = new Float32Array(8), sparkY = new Float32Array(8);
  var sparkN = 0;

  // appends the (partially revealed) glyph strokes to the current path
  function pathGlyph(ctx, g, ox, oy, u, lp) {
    if (lp <= 0) return;
    var target = lp >= 1 ? 1e9 : lp * g.total;
    var used = 0;
    for (var s = 0; s < g.strokes.length; s++) {
      var p = g.strokes[s];
      var seg = g.seg[s];
      if (used >= target) break;
      ctx.moveTo(ox + p[0] * u, oy + p[1] * u);
      var n = p.length / 2;
      for (var i = 1; i < n; i++) {
        var d = seg[i];
        if (used + d <= target) {
          ctx.lineTo(ox + p[i * 2] * u, oy + p[i * 2 + 1] * u);
          used += d;
        } else {
          var f = d > 0 ? (target - used) / d : 0;
          var x = p[i * 2 - 2] + (p[i * 2] - p[i * 2 - 2]) * f;
          var y = p[i * 2 - 1] + (p[i * 2 + 1] - p[i * 2 - 1]) * f;
          ctx.lineTo(ox + x * u, oy + y * u);
          used = target;
          if (sparkN < 8) { sparkX[sparkN] = ox + x * u; sparkY[sparkN] = oy + y * u; sparkN++; }
          return;
        }
      }
    }
  }

  // builds the path of a normalised string; returns its width in px
  function pathString(ctx, s, x0, top, u, spacing, prog, stagger) {
    var n = 0, i;
    for (i = 0; i < s.length; i++) if (s.charAt(i) !== ' ') n++;
    var total = 1 + Math.max(0, n - 1) * stagger;
    var pg = prog * total;
    var x = x0, k = 0;
    ctx.beginPath();
    for (i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === ' ') { x += (SPACE_W + spacing) * u; continue; }
      var g = glyphOf(ch);
      var lp = prog >= 1 ? 1 : clamp01(pg - k * stagger);
      pathGlyph(ctx, g, x, top, u, lp);
      x += (g.w + spacing) * u;
      k++;
    }
    return x - x0 - spacing * u;
  }

  // strokeText(ctx, str, x, y, {size, color, align, baseline, glow, glowAlpha, progress, width, alpha, spacing,
  //                             outline, stagger, maxW, sparks}) -> width (px)
  // size is an em size like a font (cap height = 0.72 size). baseline defaults to 'middle'.
  UI.strokeText = function (ctx, str, x, y, o) {
    o = o || EMPTY;
    if (str === null || str === undefined || str === '') return 0;
    var s = normalize(str);
    var size = fin(o.size, 32);
    var spacing = o.spacing === undefined ? DEF_SPACING : o.spacing;
    var unitsW = unitsWidth(s, spacing);
    var u = size * UI.UNIT;
    if (o.maxW > 0 && unitsW * u > o.maxW) { u = o.maxW / unitsW; size = u / UI.UNIT; }
    var width = unitsW * u;
    var x0 = o.align === 'center' ? x - width / 2 : (o.align === 'right' ? x - width : x);
    var bl = o.baseline || 'middle';
    var top = bl === 'top' ? y : (bl === 'bottom' || bl === 'alphabetic' ? y - 6 * u : y - 3 * u);
    var prog = o.progress === undefined ? 1 : clamp01(fin(o.progress, 1));
    if (prog <= 0) return width;
    var alpha = o.alpha === undefined ? 1 : clamp01(fin(o.alpha, 1));
    if (alpha <= 0.002) return width;
    var lw = o.width || Math.max(1.3, size * 0.06);
    var color = o.color || '#FFFFFF';
    var glowC = o.glow === true ? color : (o.glow || null);
    var ga = o.glowAlpha === undefined ? 1 : o.glowAlpha;
    sparkN = 0;
    pathString(ctx, s, x0, top, u, spacing, prog, o.stagger === undefined ? 0.28 : o.stagger);
    var pa = ctx.globalAlpha, pc = ctx.globalCompositeOperation, pcap = ctx.lineCap, pjoin = ctx.lineJoin;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (o.outline) {
      ctx.globalAlpha = pa * alpha * 0.55;
      ctx.strokeStyle = o.outline;
      ctx.lineWidth = lw + Math.max(2.5, lw * 1.6);
      ctx.stroke();
    }
    if (glowC && ga > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = glowC;
      ctx.globalAlpha = pa * alpha * 0.09 * ga;
      ctx.lineWidth = lw * 4.6;
      ctx.stroke();
      ctx.globalAlpha = pa * alpha * 0.2 * ga;
      ctx.lineWidth = lw * 2.3;
      ctx.stroke();
      ctx.globalCompositeOperation = pc;
    }
    ctx.globalAlpha = pa * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
    if (sparkN && o.sparks !== false) {
      var sc = glowC || color;
      for (var i = 0; i < sparkN && i < 6; i++) {
        AP.R.glow(ctx, sparkX[i], sparkY[i], Math.max(6, Math.min(26, size * 0.34)), sc, 0.85 * alpha);
        ctx.fillStyle = rgba('#FFFFFF', 0.9 * alpha);
        ctx.beginPath();
        ctx.arc(sparkX[i], sparkY[i], Math.max(1, lw * 0.75), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = pa;
    ctx.lineCap = pcap;
    ctx.lineJoin = pjoin;
    return width;
  };

  // the CORE-facing alias set (ENGINE_API section 15): strokeText(ctx, str, x, y, {size, color, align, glow, progress})
  UI.text = function (ctx, str, x, y, o) { return AP.R.text(ctx, str, x, y, o); };

  // ================================================================ shape helpers
  UI.formSides = function (form) { return form >= 32 ? 48 : ((form | 0) >= 3 ? form | 0 : 3); };
  UI.flatRot = function (sides) { return -Math.PI / 2 + ((sides % 2 === 0) ? Math.PI / sides : 0); };
  UI.form = function () {
    if (AP.level && AP.level.form) return AP.level.form;
    var d = AP.Save && AP.Save.data;
    return (d && d.form) || 3;
  };
  UI.saveForm = function () { var d = AP.Save && AP.Save.data; return (d && d.form) || 3; };

  // radius tables of the 5 forms sampled at MS angles (flat edge at the bottom): used for smooth morphs
  var MS = 96;
  var formTabs = {};
  function formTable(form) {
    var key = form >= 32 ? 99 : form;
    var t = formTabs[key];
    if (t) return t;
    t = new Float32Array(MS);
    var n = UI.formSides(form);
    if (n >= 32) { for (var j = 0; j < MS; j++) t[j] = 1; }
    else {
      var rot = UI.flatRot(n), step = TAU / n, ap = Math.cos(Math.PI / n);
      for (var i = 0; i < MS; i++) {
        var a = i / MS * TAU;
        var rel = M.mod(a - rot, TAU);
        var k = Math.floor(rel / step);
        var normal = rot + (k + 0.5) * step;
        t[i] = ap / Math.max(0.2, Math.cos(a - normal));
      }
    }
    formTabs[key] = t;
    return t;
  }

  // path of a shape morphing between two forms (k in 0..1), radius r, rotation rot
  UI.morphPath = function (ctx, cx, cy, r, fromForm, toForm, k, rot, noBegin) {
    var A = formTable(fromForm), B = formTable(toForm);
    var e = M.ease.inOutSine(clamp01(k));
    rot = rot || 0;
    if (!noBegin) ctx.beginPath();
    for (var i = 0; i < MS; i++) {
      var a = i / MS * TAU;
      var rr = r * (A[i] + (B[i] - A[i]) * e);
      var x = cx + Math.cos(a + rot) * rr, y = cy + Math.sin(a + rot) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  // regular form polygon path (flat bottom), rotation added
  UI.formPath = function (ctx, cx, cy, r, form, rot) {
    var n = UI.formSides(form);
    AP.R.poly(ctx, cx, cy, Math.max(0, r), n, UI.flatRot(n) + (rot || 0));
  };

  // chamfered rectangle path (corners cut by c)
  UI.chamferPath = function (ctx, x, y, w, h, c) {
    c = Math.max(0, Math.min(c === undefined ? 10 : c, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y);
    ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h);
    ctx.lineTo(x, y + h - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
  };

  // panel(ctx, x, y, w, h, {pal, alpha, fill, fillAlpha, stroke, cut, ticks, glow})
  UI.panel = function (ctx, x, y, w, h, o) {
    o = o || EMPTY;
    var pal = o.pal || AP.R.pal('title');
    var a = o.alpha === undefined ? 1 : o.alpha;
    if (a <= 0.002) return;
    var c = o.cut === undefined ? 12 : o.cut;
    var pa = ctx.globalAlpha;
    UI.chamferPath(ctx, x, y, w, h, c);
    ctx.globalAlpha = pa * a;
    ctx.fillStyle = rgba(o.fill || UI.shade(pal.bg, -0.35), o.fillAlpha === undefined ? 0.84 : o.fillAlpha);
    ctx.fill();
    ctx.strokeStyle = rgba(o.stroke || pal.primary, o.strokeAlpha === undefined ? 0.38 : o.strokeAlpha);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (o.ticks !== false) {
      var ac = o.accent || pal.accent;
      ctx.strokeStyle = rgba(ac, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + c + 8); ctx.lineTo(x, y + c); ctx.lineTo(x + c, y); ctx.lineTo(x + c + 8, y);
      ctx.moveTo(x + w - c - 8, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + c + 8);
      ctx.moveTo(x + w, y + h - c - 8); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + w - c - 8, y + h);
      ctx.moveTo(x + c + 8, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + h - c - 8);
      ctx.stroke();
    }
    ctx.globalAlpha = pa;
  };

  // thin divider line with a diamond in the middle
  UI.divider = function (ctx, x1, x2, y, color, alpha) {
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * (alpha === undefined ? 0.5 : alpha);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    var mx = (x1 + x2) / 2;
    ctx.beginPath();
    ctx.moveTo(x1, y); ctx.lineTo(mx - 6, y);
    ctx.moveTo(mx + 6, y); ctx.lineTo(x2, y);
    ctx.moveTo(mx, y - 3.5); ctx.lineTo(mx + 3.5, y); ctx.lineTo(mx, y + 3.5); ctx.lineTo(mx - 3.5, y); ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = pa;
  };

  // dim the whole screen
  UI.dim = function (ctx, alpha, color) {
    if (!(alpha > 0.002)) return;
    ctx.fillStyle = rgba(color || '#000000', clamp01(alpha));
    ctx.fillRect(0, 0, 960, 540);
  };

  // soft radial vignette (cached low-res canvas, upscaled smoothly)
  var vigCanvas = null, vigBroken = false;
  UI.vignette = function (ctx, alpha, color) {
    if (!(alpha > 0.002)) return;
    if (!vigCanvas && !vigBroken) {
      try {
        var doc = (typeof document !== 'undefined') ? document : null;
        var cv = doc && doc.createElement ? doc.createElement('canvas') : null;
        var g = cv && cv.getContext ? cv.getContext('2d') : null;
        if (!g) vigBroken = true;
        else {
          cv.width = 192; cv.height = 108;
          var grad = g.createRadialGradient(96, 54, 18, 96, 54, 112);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(0.55, 'rgba(0,0,0,0.25)');
          grad.addColorStop(1, 'rgba(0,0,0,0.92)');
          g.fillStyle = grad;
          g.fillRect(0, 0, 192, 108);
          vigCanvas = cv;
        }
      } catch (e) { vigBroken = true; }
    }
    var pa = ctx.globalAlpha;
    if (vigCanvas) {
      ctx.globalAlpha = pa * clamp01(alpha);
      ctx.drawImage(vigCanvas, 0, 0, 960, 540);
    } else {
      UI.dim(ctx, alpha * 0.3, color);
    }
    ctx.globalAlpha = pa;
  };

  // key chip: a small chamfered box with a key label; returns its width
  var CHIP_T = { size: 12, weight: '700', align: 'center', baseline: 'middle', color: '#FFFFFF' };
  UI.chip = function (ctx, label, x, y, o) {
    o = o || EMPTY;
    var pal = o.pal || AP.R.pal('title');
    var size = o.size || 12;
    CHIP_T.size = size;
    var tw = AP.R.measure(ctx, label, size, '700');
    var w = Math.max(size * 1.7, tw + size * 1.1), h = size * 1.75;
    var a = o.alpha === undefined ? 1 : o.alpha;
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * a;
    UI.chamferPath(ctx, x, y - h / 2, w, h, 3);
    ctx.fillStyle = rgba(o.fill || pal.primary, o.on ? 0.3 : 0.12);
    ctx.fill();
    ctx.strokeStyle = rgba(o.stroke || pal.primary, o.on ? 0.95 : 0.55);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    CHIP_T.color = o.color || pal.ink;
    AP.R.text(ctx, label, x + w / 2, y + 0.5, CHIP_T);
    ctx.globalAlpha = pa;
    return w;
  };

  // label for one action, or several joined ('up/down' style arrays)
  UI.keyLabel = function (actions) {
    if (!AP.Input || !AP.Input.label) return '?';
    if (typeof actions === 'string') return AP.Input.label(actions);
    var s = '';
    for (var i = 0; i < actions.length; i++) s += AP.Input.label(actions[i]);
    return s;
  };

  // hints(ctx, [[actions, text], ...], x, y, {align, pal, alpha, size}) — key chips followed by their meaning
  var HINT_T = { size: 13, weight: '500', align: 'left', baseline: 'middle', color: '#FFFFFF' };
  UI.hints = function (ctx, items, x, y, o) {
    o = o || EMPTY;
    var pal = o.pal || AP.R.pal('title');
    var size = o.size || 12;
    var gap = 18;
    var total = 0, i;
    HINT_T.size = size + 1;
    for (i = 0; i < items.length; i++) {
      var lab = UI.keyLabel(items[i][0]);
      var cw = Math.max(size * 1.7, AP.R.measure(ctx, lab, size, '700') + size * 1.1);
      total += cw + 6 + AP.R.measure(ctx, items[i][1], size + 1, '500') + (i < items.length - 1 ? gap : 0);
    }
    var cx = o.align === 'center' ? x - total / 2 : (o.align === 'right' ? x - total : x);
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * (o.alpha === undefined ? 1 : o.alpha);
    for (i = 0; i < items.length; i++) {
      var w = UI.chip(ctx, UI.keyLabel(items[i][0]), cx, y, { pal: pal, size: size });
      cx += w + 6;
      HINT_T.color = rgba(pal.primary, 0.85);
      AP.R.text(ctx, items[i][1], cx, y + 0.5, HINT_T);
      cx += AP.R.measure(ctx, items[i][1], size + 1, '500') + gap;
    }
    ctx.globalAlpha = pa;
    return total;
  };

  // focus marker: rotating form polygon with an inner dot and a soft glow
  UI.marker = function (ctx, x, y, r, t, color, sides, alpha) {
    var a = alpha === undefined ? 1 : alpha;
    if (a <= 0.002) return;
    var n = sides || UI.formSides(UI.saveForm());
    var pa = ctx.globalAlpha;
    AP.R.glow(ctx, x, y, r * 2.4, color, 0.35 * a);
    ctx.globalAlpha = pa * a;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    AP.R.poly(ctx, x, y, r, n, t * 1.6);
    ctx.stroke();
    ctx.globalAlpha = pa * a * 0.5;
    AP.R.poly(ctx, x, y, r * 0.55, n, -t * 2.2);
    ctx.stroke();
    ctx.globalAlpha = pa * a;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = pa;
  };

  // prime gem diamond: state 0 empty, 1 owned (ghost), 2 collected (bright)
  UI.gem = function (ctx, x, y, r, state, pal, alpha, t) {
    var a = alpha === undefined ? 1 : alpha;
    if (a <= 0.002 || r <= 0.1) return;
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * a;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.72, y - r * 0.18); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.72, y - r * 0.18);
    ctx.closePath();
    if (state === 2) {
      ctx.fillStyle = rgba(pal.accent, 0.85);
      ctx.fill();
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.ink, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.72, y - r * 0.18); ctx.lineTo(x + r * 0.72, y - r * 0.18);
      ctx.moveTo(x - r * 0.3, y - r * 0.18); ctx.lineTo(x, y + r); ctx.lineTo(x + r * 0.3, y - r * 0.18);
      ctx.stroke();
      if (t !== undefined) {
        var oa = (t || 0) * 3;
        ctx.fillStyle = pal.ink;
        ctx.beginPath();
        ctx.arc(x + Math.cos(oa) * r * 1.35, y + Math.sin(oa) * r * 0.5, Math.max(0.8, r * 0.12), 0, TAU);
        ctx.fill();
      }
    } else if (state === 1) {
      ctx.fillStyle = rgba(pal.accent, 0.22);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.accent, 0.75);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.strokeStyle = rgba(pal.ink, 0.28);
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
    ctx.globalAlpha = pa;
  };

  // the gold triangle shard
  UI.shard = function (ctx, x, y, r, color, rot, alpha) {
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * (alpha === undefined ? 1 : alpha);
    AP.R.poly(ctx, x, y, r, 3, -Math.PI / 2 + (rot || 0));
    ctx.fillStyle = rgba(color, 0.35);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.globalAlpha = pa;
  };

  // padlock glyph
  UI.lock = function (ctx, x, y, s, color, alpha) {
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * (alpha === undefined ? 1 : alpha);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.15, s * 0.42, Math.PI, TAU);
    ctx.moveTo(x - s * 0.42, y - s * 0.15);
    ctx.lineTo(x - s * 0.42, y + s * 0.05);
    ctx.moveTo(x + s * 0.42, y - s * 0.15);
    ctx.lineTo(x + s * 0.42, y + s * 0.05);
    ctx.stroke();
    UI.chamferPath(ctx, x - s * 0.62, y + s * 0.05, s * 1.24, s * 0.82, 2);
    ctx.fillStyle = rgba(color, 0.25);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = pa;
  };

  // radiating star burst (NEW BEST flares, unlock pops)
  UI.burst = function (ctx, x, y, r0, r1, rays, rot, color, alpha, width) {
    if (!(alpha > 0.002)) return;
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1.5;
    ctx.beginPath();
    for (var i = 0; i < rays; i++) {
      var a = rot + i * TAU / rays;
      var rr = (i % 2) ? r1 * 0.7 : r1;
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.stroke();
    ctx.globalAlpha = pa;
  };

  UI.fmtTime = function (s) { return AP.R.fmtTime ? AP.R.fmtTime(s) : String(Math.round((s || 0) * 100) / 100); };

  UI.pal = function (key) { return AP.R.pal(key || 'title'); };

  // body text helpers (FONT_UI) with reused option objects
  var BODY = { size: 16, weight: '500', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  UI.body = function (ctx, str, x, y, size, color, align, alpha, weight, maxW) {
    BODY.size = size || 16;
    BODY.color = color || '#FFFFFF';
    BODY.align = align || 'left';
    BODY.alpha = alpha === undefined ? 1 : alpha;
    BODY.weight = weight || '500';
    BODY.maxW = maxW || 0;
    BODY.baseline = 'middle';
    BODY.lineH = 0;
    return AP.R.text(ctx, str, x, y, BODY);
  };

  // ================================================================ navigation snapshot (one per fixed step)
  var nav = { step: -1, up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false,
    retry: false, any: false, mx: 0, my: 0, moved: false, click: false, mdown: false, mrel: false };
  UI.nav = function () {
    var st = AP.Time ? AP.Time.step : 0;
    if (nav.step === st) return nav;
    nav.step = st;
    var I = AP.Input;
    if (!I) return nav;
    nav.up = I.repeat('up');
    nav.down = I.repeat('down');
    nav.left = I.repeat('left');
    nav.right = I.repeat('right');
    nav.confirm = I.pressed('confirm');
    nav.back = I.pressed('back');
    nav.pause = I.pressed('pause');
    nav.retry = I.pressed('retry');
    nav.any = !!(I.anyPressed && I.anyPressed());
    var m = I.mouse || EMPTY;
    nav.mx = fin(m.x, 0);
    nav.my = fin(m.y, 0);
    nav.moved = !!m.moved;
    if (I.mouse) I.mouse.moved = false;
    nav.click = !!m.pressed && !I.locked;
    nav.mdown = !!m.down;
    nav.mrel = !!m.released;
    return nav;
  };
  // swallow the rest of this step's input (after a menu acted)
  UI.eat = function () {
    nav.up = nav.down = nav.left = nav.right = nav.confirm = nav.back = nav.pause = nav.retry = nav.click = false;
  };

  // drop every pending press and buffered action (before handing control back to gameplay)
  UI.consumeAll = function () {
    var I = AP.Input, A = AP.ACTIONS || [];
    if (!I || !I.consume) return;
    for (var i = 0; i < A.length; i++) I.consume(A[i]);
    UI.eat();
  };

  // ================================================================ Menu widget
  // items: {type:'button'|'slider'|'toggle'|'choice'|'header'|'gap'|'info', label, value(), hint, disabled, hidden,
  //         action(item, menu), get(), set(v), step, fmt(v), options:[{v,label}], danger, locked, sub}
  // o: {x, y, w, rowH, headerH, viewH, align:'left'|'center', size, stroke (stroke-font labels), horizontal, gap,
  //     onBack(menu), pal, valueFrac, sounds}
  function Menu(o) {
    o = o || EMPTY;
    this.items = o.items || [];
    this.x = o.x || 0;
    this.y = o.y || 0;
    this.w = o.w || 400;
    this.rowH = o.rowH || 36;
    this.headerH = o.headerH || 30;
    this.viewH = o.viewH || 0;
    this.align = o.align || 'left';
    this.size = o.size || 17;
    this.stroke = !!o.stroke;
    this.horizontal = !!o.horizontal;
    this.gap = o.gap === undefined ? 14 : o.gap;
    this.onBack = o.onBack || null;
    this.pal = o.pal || null;
    this.valueFrac = o.valueFrac || 0.5;
    this.active = true;
    this.rows = [];
    this.pool = [];
    this.contentH = 0;
    this.selItem = null;
    this.selY = 0;
    this.selX = 0;
    this.selW = 0;
    this.scroll = 0;
    this.t = 0;
    this.denyT = 0;
    this.flash = 0;
    this.drag = null;
    this.intro = 0;
    this.slot = 0;          // cursor inside a 'keys' row
    this.layout();
    this.selItem = this.firstSelectable(0, 1);
    var r = this.rowOf(this.selItem);
    if (r) { this.selY = r.y; this.selX = r.x; this.selW = r.w; }
  }
  UI.Menu = Menu;
  UI.menu = function (o) { return new Menu(o); };

  function val(v, a, b) { return typeof v === 'function' ? v(a, b) : v; }
  Menu.prototype.isHidden = function (it) { return !!val(it.hidden, it, this); };
  Menu.prototype.isDisabled = function (it) { return !!val(it.disabled, it, this); };
  Menu.prototype.isSelectable = function (it) {
    if (!it || this.isHidden(it)) return false;
    var t = it.type || 'button';
    return t !== 'header' && t !== 'gap' && t !== 'info';
  };
  Menu.prototype.label = function (it) { var l = val(it.label, it, this); return l === undefined || l === null ? '' : String(l); };

  Menu.prototype.layout = function () {
    var rows = this.rows;
    rows.length = 0;
    var y = 0, x = 0, k = 0;
    var ctx = AP.R && AP.R.ctx;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (this.isHidden(it)) continue;
      var row = this.pool[k] || (this.pool[k] = { item: null, i: 0, x: 0, y: 0, w: 0, h: 0 });
      k++;
      row.item = it;
      row.i = i;
      var t = it.type || 'button';
      if (this.horizontal) {
        var lab = this.label(it);
        var lw = this.stroke ? UI.measure(lab, this.size) : (ctx ? AP.R.measure(ctx, lab, this.size, '600') : lab.length * this.size * 0.55);
        row.w = Math.max(it.minW || 90, lw + 44);
        row.h = this.rowH;
        row.x = x;
        row.y = 0;
        x += row.w + this.gap;
      } else {
        row.h = t === 'header' ? this.headerH : (t === 'gap' ? Math.round(this.rowH * 0.45) : (it.h || this.rowH));
        row.x = 0;
        row.w = this.w;
        row.y = y;
        y += row.h;
      }
      rows.push(row);
    }
    if (this.horizontal) {
      this.contentW = Math.max(0, x - this.gap);
      // centre the row on this.x
      var off = -this.contentW / 2;
      for (var j = 0; j < rows.length; j++) rows[j].x += off;
      this.contentH = this.rowH;
    } else this.contentH = y;
  };

  Menu.prototype.rowOf = function (it) {
    if (!it) return null;
    for (var i = 0; i < this.rows.length; i++) if (this.rows[i].item === it) return this.rows[i];
    return null;
  };
  Menu.prototype.indexOf = function (it) {
    for (var i = 0; i < this.rows.length; i++) if (this.rows[i].item === it) return i;
    return -1;
  };
  Menu.prototype.firstSelectable = function (from, dir) {
    var n = this.rows.length;
    for (var k = 0; k < n; k++) {
      var idx = M.mod(from + k * dir, n);
      if (this.isSelectable(this.rows[idx].item)) return this.rows[idx].item;
    }
    return null;
  };
  Menu.prototype.select = function (it, silent) {
    if (!it || it === this.selItem || !this.isSelectable(it)) return;
    this.selItem = it;
    if (!silent) sfx('uiMove');
    if (typeof this.onSelect === 'function') this.onSelect(it, this);
  };
  Menu.prototype.selectIndex = function (i, silent) {
    var r = this.rows[i];
    if (r) this.select(r.item, silent);
  };
  Menu.prototype.move = function (dir) {
    var n = this.rows.length;
    if (!n) return;
    var cur = this.indexOf(this.selItem);
    if (cur < 0) cur = dir > 0 ? -1 : 0;
    for (var k = 1; k <= n; k++) {
      var idx = M.mod(cur + k * dir, n);
      if (this.isSelectable(this.rows[idx].item)) {
        if (this.rows[idx].item !== this.selItem) {
          this.selItem = this.rows[idx].item;
          sfx('uiMove');
          if (typeof this.onSelect === 'function') this.onSelect(this.selItem, this);
        }
        return;
      }
    }
  };

  Menu.prototype.deny = function () { this.denyT = 0.3; sfx('uiDeny'); };

  Menu.prototype.adjust = function (it, dir) {
    var t = it.type || 'button';
    if (this.isDisabled(it)) { this.deny(); return; }
    if (t === 'slider') {
      var st = it.step || 0.05;
      var v = clamp01(Math.round((fin(+it.get(), 0) + dir * st) / st) * st);
      if (Math.abs(v - fin(+it.get(), 0)) < 1e-6) { sfx('uiDeny', { vol: 0.4 }); return; }
      it.set(v);
      sfx(it.sound || 'uiMove', { pitch: 0.75 + v * 0.6 });
    } else if (t === 'toggle') {
      var b = !it.get();
      it.set(b);
      sfx(b ? 'uiSelect' : 'uiBack');
    } else if (t === 'choice') {
      var opts = val(it.options, it, this) || [];
      if (!opts.length) return;
      var cur = it.get(), ci = 0;
      for (var i = 0; i < opts.length; i++) if (opts[i].v === cur) { ci = i; break; }
      var ni = it.wrap === false ? clamp(ci + dir, 0, opts.length - 1) : M.mod(ci + dir, opts.length);
      if (ni === ci) { sfx('uiDeny', { vol: 0.4 }); return; }
      it.set(opts[ni].v);
      sfx('uiMove', { pitch: 1 + ni * 0.06 });
    } else if (t === 'keys') {
      var nk = keySlots(it);
      var ns = clamp(this.slot + dir, 0, nk - 1);
      if (ns === this.slot) { sfx('uiDeny', { vol: 0.35 }); return; }
      this.slot = ns;
      sfx('uiMove', { pitch: 1.1 + ns * 0.05 });
    } else if (typeof it.adjust === 'function') {
      it.adjust(dir, it, this);
    }
  };

  // number of selectable slots of a 'keys' row: its bindings plus one empty "add" slot (max 4 bindings)
  function keyList(it) { var l = typeof it.get === 'function' ? it.get() : null; return l && l.length !== undefined ? l : []; }
  function keySlots(it) { var n = keyList(it).length; return Math.min(4, n + 1); }

  Menu.prototype.activate = function (it) {
    if (!it) return;
    var t = it.type || 'button';
    if (this.isDisabled(it)) { this.deny(); return; }
    if (t === 'keys') {
      this.slot = clamp(this.slot, 0, keySlots(it) - 1);
      this.flash = 1;
      sfx('uiSelect');
      if (typeof it.capture === 'function') it.capture(this.slot, it, this);
      return;
    }
    if (t === 'toggle') { this.adjust(it, 1); return; }
    if (t === 'choice') { this.adjust(it, 1); return; }
    if (t === 'slider') { if (typeof it.action === 'function') it.action(it, this); return; }
    this.flash = 1;
    if (it.silent !== true) sfx(it.sound || 'uiSelect');
    if (typeof it.action === 'function') it.action(it, this);
  };

  // mouse hit test -> row or null (screen coordinates)
  Menu.prototype.hit = function (mx, my) {
    for (var i = 0; i < this.rows.length; i++) {
      var r = this.rows[i];
      if (!this.isSelectable(r.item)) continue;
      var rx, ry;
      if (this.horizontal) { rx = this.x + r.x; ry = this.y - this.rowH / 2; }
      else {
        rx = this.x - 30; ry = this.y + r.y - this.scroll;
        if (this.viewH > 0 && (my < this.y || my > this.y + this.viewH)) return null;
      }
      var rw = this.horizontal ? r.w : this.w + 40;
      if (mx >= rx && mx < rx + rw && my >= ry && my < ry + r.h) return r;
    }
    return null;
  };

  // chip layout of a 'keys' row (reused arrays): chipX/chipW/chipLab, returns the count (bindings + add slot)
  var chipX = [0, 0, 0, 0], chipW = [0, 0, 0, 0], chipLab = ['', '', '', ''];
  function keyLabelOf(it, v) {
    if (typeof it.labelOf === 'function') return String(it.labelOf(v));
    var I = AP.Input;
    var dev = typeof it.device === 'function' ? it.device() : it.device;
    if (!I) return String(v);
    return dev === 'pad' ? I.padName(v) : I.keyName(v);
  }
  Menu.prototype.layoutChips = function (it, x0) {
    var list = keyList(it);
    var ctx = AP.R.ctx;
    var n = keySlots(it), cx = x0;
    for (var i = 0; i < n; i++) {
      var lab = i < list.length ? keyLabelOf(it, list[i]) : '+';
      chipLab[i] = lab;
      var w = lab === '+' ? 34 : Math.max(46, AP.R.measure(ctx, lab, 13, '700') + 22);
      chipX[i] = cx;
      chipW[i] = w;
      cx += w + 8;
    }
    return n;
  };
  Menu.prototype.chipAt = function (row, mx) {
    var n = this.layoutChips(row.item, this.x + this.w * this.valueFrac);
    for (var i = 0; i < n; i++) if (mx >= chipX[i] - 4 && mx < chipX[i] + chipW[i] + 4) return i;
    return -1;
  };

  Menu.prototype.sliderValueAt = function (it, mx) {
    var x0 = this.x + this.w * this.valueFrac, x1 = this.x + this.w - 56;
    return clamp01((mx - x0) / Math.max(1, x1 - x0));
  };

  Menu.prototype.update = function (dt) {
    this.t += dt;
    this.intro = Math.min(1, this.intro + dt * 4);
    if (this.denyT > 0) this.denyT = Math.max(0, this.denyT - dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    this.layout();
    if (this.selItem && !this.isSelectable(this.selItem)) this.selItem = this.firstSelectable(0, 1);
    if (!this.selItem) this.selItem = this.firstSelectable(0, 1);
    if (this.selItem && this.selItem.type === 'keys') this.slot = clamp(this.slot, 0, keySlots(this.selItem) - 1);
    if (this.active) {
      var n = UI.nav();
      if (this.horizontal) {
        if (n.left) this.move(-1);
        if (n.right) this.move(1);
      } else {
        if (n.up) this.move(-1);
        if (n.down) this.move(1);
        var it = this.selItem;
        if (it && (n.left || n.right)) this.adjust(it, n.left ? -1 : 1);
      }
      if (n.retry && this.selItem && (this.selItem.type === 'keys') && typeof this.selItem.remove === 'function') {
        var ki = this.selItem;
        UI.eat();
        if (this.slot < keyList(ki).length && keyList(ki).length > 1) { ki.remove(this.slot, ki, this); sfx('uiBack'); this.flash = 1; }
        else this.deny();
      }
      if (n.confirm && this.selItem) { var a = this.selItem; UI.eat(); this.activate(a); }
      else if ((n.back) && this.onBack) { UI.eat(); sfx('uiBack'); this.onBack(this); }
      // mouse
      if (n.moved || n.click) {
        var r = this.hit(n.mx, n.my);
        if (r && r.item !== this.selItem) { this.select(r.item, !n.moved); if ((r.item.type || '') === 'keys') this.slot = 0; }
        if (r && (r.item.type || '') === 'keys') {
          var cs = this.chipAt(r, n.mx);
          if (cs >= 0 && cs !== this.slot) { this.slot = cs; if (!n.click) sfx('uiMove', { vol: 0.6 }); }
        }
        if (n.click && r) {
          var ti = r.item.type || 'button';
          if (ti === 'slider' && !this.isDisabled(r.item)) {
            this.drag = r.item;
            r.item.set(Math.round(this.sliderValueAt(r.item, n.mx) / (r.item.step || 0.05)) * (r.item.step || 0.05));
            sfx('uiMove');
          } else { UI.eat(); this.activate(r.item); }
        }
      }
      if (this.drag) {
        if (n.mdown) {
          var d = this.drag;
          var st = d.step || 0.05;
          var nv = clamp01(Math.round(this.sliderValueAt(d, n.mx) / st) * st);
          if (Math.abs(nv - fin(+d.get(), 0)) > 1e-6) { d.set(nv); sfx('uiMove', { vol: 0.5, pitch: 0.75 + nv * 0.6 }); }
        } else this.drag = null;
      }
    }
    // eased focus position and scroll
    var row = this.rowOf(this.selItem);
    if (row) {
      var k = 1 - Math.exp(-dt * 20);
      this.selY += (row.y - this.selY) * k;
      this.selX += (row.x - this.selX) * k;
      this.selW += (row.w - this.selW) * k;
      if (this.viewH > 0 && this.contentH > this.viewH) {
        var margin = this.rowH * 1.2;
        var target = this.scrollTarget === undefined ? this.scroll : this.scrollTarget;
        if (row.y - margin < target) target = row.y - margin;
        if (row.y + row.h + margin > target + this.viewH) target = row.y + row.h + margin - this.viewH;
        target = clamp(target, 0, this.contentH - this.viewH);
        this.scrollTarget = target;
        this.scroll += (target - this.scroll) * (1 - Math.exp(-dt * 14));
      } else { this.scroll = 0; this.scrollTarget = 0; }
    }
  };

  // snap the focus animation (after rebuilding)
  Menu.prototype.snap = function () {
    this.layout();
    var row = this.rowOf(this.selItem);
    if (row) { this.selY = row.y; this.selX = row.x; this.selW = row.w; }
  };

  var MT = { size: 17, weight: '600', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  var MV = { size: 15, weight: '600', align: 'right', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  var MH = { size: 11, weight: '800', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  var MS2 = { size: 12, weight: '500', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };

  Menu.prototype.render = function (ctx, o) {
    o = o || EMPTY;
    var pal = o.pal || this.pal || AP.R.pal('title');
    var alpha = (o.alpha === undefined ? 1 : o.alpha) * (0.25 + 0.75 * this.intro);
    if (alpha <= 0.002) return;
    var pa = ctx.globalAlpha;
    if (this.horizontal) { this.renderRow(ctx, pal, alpha); ctx.globalAlpha = pa; return; }
    var clip = this.viewH > 0 && this.contentH > this.viewH;
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.x - 60, this.y - 2, this.w + 120, this.viewH + 4);
      ctx.clip();
    }
    var x = this.x, y0 = this.y - this.scroll;
    var t = this.t;
    var sel = this.selItem;
    var shake = this.denyT > 0 ? Math.sin(this.denyT * 60) * 5 * (this.denyT / 0.3) : 0;
    // focus bar
    var selRow = this.rowOf(sel);
    if (selRow) {
      var fy = y0 + this.selY + selRow.h / 2;
      ctx.globalAlpha = pa * alpha;
      var barX = x - 14, barW = this.w + 28;
      if (this.align === 'center') {
        var lw0 = this.stroke ? UI.measure(this.label(sel), this.size) : AP.R.measure(ctx, this.label(sel), this.size, '600');
        barW = lw0 + 90;
        barX = x + this.w / 2 - barW / 2;
      }
      var grad = 0.1 + 0.08 * this.flash;
      ctx.fillStyle = rgba(sel.danger ? pal.hazard : pal.accent, grad);
      UI.chamferPath(ctx, barX + shake, fy - selRow.h / 2 + 3, barW, selRow.h - 6, 6);
      ctx.fill();
      ctx.strokeStyle = rgba(sel.danger ? pal.hazard : pal.accent, 0.35 + 0.4 * this.flash);
      ctx.lineWidth = 1;
      ctx.stroke();
      var mx = this.align === 'center' ? barX + 18 : x + 6;
      UI.marker(ctx, mx + shake, fy, 7, t, sel.danger ? pal.hazard : pal.accent, undefined, 1);
      if (this.align === 'center') UI.marker(ctx, barX + barW - 18 + shake, fy, 7, -t, sel.danger ? pal.hazard : pal.accent, undefined, 1);
    }
    for (var i = 0; i < this.rows.length; i++) {
      var r = this.rows[i];
      var it = r.item;
      var ry = y0 + r.y + r.h / 2;
      if (clip && (ry < this.y - r.h || ry > this.y + this.viewH + r.h)) continue;
      var type = it.type || 'button';
      var focused = it === sel;
      var dis = this.isDisabled(it);
      var a = alpha * (dis ? 0.38 : 1);
      var sx = focused ? shake : 0;
      if (typeof it.render === 'function') { it.render(ctx, x + sx, y0 + r.y, this.w, r.h, focused, pal, a, this); continue; }
      if (type === 'header') {
        MH.color = pal.accent;
        MH.alpha = alpha;
        AP.R.text(ctx, this.label(it).toUpperCase(), x, ry + 4, MH);
        ctx.globalAlpha = pa * alpha * 0.35;
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1;
        var hw = AP.R.measure(ctx, this.label(it).toUpperCase(), 11, '800');
        ctx.beginPath();
        ctx.moveTo(x + hw + 10, ry + 4);
        ctx.lineTo(x + this.w, ry + 4);
        ctx.stroke();
        ctx.globalAlpha = pa;
        continue;
      }
      if (type === 'gap') continue;
      var lab = this.label(it);
      var col = it.danger ? pal.hazard : (focused ? pal.ink : rgba(pal.ink, 0.78));
      if (type === 'info') col = rgba(pal.primary, 0.75);
      var lx = this.align === 'center' ? x + this.w / 2 : x + 26;
      if (this.stroke) {
        UI.strokeText(ctx, lab, lx + sx, ry, { size: this.size, color: focused ? pal.ink : rgba(pal.ink, 1), alpha: a * (focused ? 1 : 0.72),
          align: this.align === 'center' ? 'center' : 'left', glow: focused ? (it.danger ? pal.hazard : pal.accent) : null, glowAlpha: 0.9 });
      } else {
        MT.size = it.size || this.size;
        MT.color = col;
        MT.alpha = a;
        MT.align = this.align === 'center' ? 'center' : 'left';
        MT.weight = focused ? '700' : '600';
        AP.R.text(ctx, lab, lx + sx, ry + (it.sub ? -7 : 0), MT);
        if (it.sub) {
          MS2.color = rgba(pal.primary, 0.7);
          MS2.alpha = a;
          MS2.align = MT.align;
          AP.R.text(ctx, val(it.sub, it, this), lx + sx, ry + 10, MS2);
        }
      }
      if (val(it.locked, it, this)) {
        var lkx = this.align === 'center' ? lx + (this.stroke ? UI.measure(lab, this.size) : AP.R.measure(ctx, lab, this.size, '600')) / 2 + 18 : x + this.w - 12;
        UI.lock(ctx, lkx, ry - 1, 12, pal.primary, alpha * 0.7);
      }
      this.renderValue(ctx, it, type, x + sx, ry, focused, pal, a);
    }
    if (clip) {
      ctx.restore();
      // scroll hints
      ctx.globalAlpha = pa * alpha * 0.8;
      ctx.fillStyle = pal.accent;
      if (this.scroll > 2) { ctx.beginPath(); ctx.moveTo(x + this.w / 2 - 7, this.y - 6); ctx.lineTo(x + this.w / 2 + 7, this.y - 6); ctx.lineTo(x + this.w / 2, this.y - 13); ctx.closePath(); ctx.fill(); }
      if (this.scroll < this.contentH - this.viewH - 2) { var by = this.y + this.viewH + 6; ctx.beginPath(); ctx.moveTo(x + this.w / 2 - 7, by); ctx.lineTo(x + this.w / 2 + 7, by); ctx.lineTo(x + this.w / 2, by + 7); ctx.closePath(); ctx.fill(); }
    }
    ctx.globalAlpha = pa;
  };

  Menu.prototype.renderValue = function (ctx, it, type, x, ry, focused, pal, a) {
    var pa = ctx.globalAlpha;
    var right = x + this.w;
    if (type === 'slider') {
      var v = clamp01(fin(+it.get(), 0));
      var x0 = x + this.w * this.valueFrac, x1 = right - 56;
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = rgba(pal.primary, 0.3);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, ry); ctx.lineTo(x1, ry); ctx.stroke();
      ctx.strokeStyle = focused ? pal.accent : rgba(pal.accent, 0.75);
      ctx.beginPath(); ctx.moveTo(x0, ry); ctx.lineTo(x0 + (x1 - x0) * v, ry); ctx.stroke();
      ctx.lineCap = 'butt';
      // ticks every 25%
      ctx.strokeStyle = rgba(pal.primary, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var k = 0; k <= 4; k++) { var tx = x0 + (x1 - x0) * k / 4; ctx.moveTo(tx, ry + 5); ctx.lineTo(tx, ry + 8); }
      ctx.stroke();
      var kx = x0 + (x1 - x0) * v;
      ctx.beginPath();
      ctx.moveTo(kx, ry - 7); ctx.lineTo(kx + 6, ry); ctx.lineTo(kx, ry + 7); ctx.lineTo(kx - 6, ry); ctx.closePath();
      ctx.fillStyle = focused ? pal.ink : rgba(pal.ink, 0.8);
      ctx.fill();
      if (focused) AP.R.glow(ctx, kx, ry, 14, pal.accent, 0.5 * a);
      MV.color = focused ? pal.ink : rgba(pal.ink, 0.75);
      MV.alpha = a;
      AP.R.text(ctx, it.fmt ? it.fmt(v) : Math.round(v * 100) + '%', right, ry, MV);
    } else if (type === 'toggle') {
      var on = !!it.get();
      var tw = 40, th = 18, tx0 = right - tw;
      ctx.globalAlpha = pa * a;
      UI.chamferPath(ctx, tx0, ry - th / 2, tw, th, 5);
      ctx.fillStyle = on ? rgba(pal.accent, 0.35) : rgba(pal.primary, 0.08);
      ctx.fill();
      ctx.strokeStyle = on ? pal.accent : rgba(pal.primary, 0.5);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      var knob = on ? tx0 + tw - 10 : tx0 + 10;
      AP.R.poly(ctx, knob, ry, 6, 4, Math.PI / 4);
      ctx.fillStyle = on ? pal.ink : rgba(pal.ink, 0.5);
      ctx.fill();
      MV.color = on ? pal.accent : rgba(pal.ink, 0.5);
      MV.alpha = a;
      AP.R.text(ctx, on ? 'ON' : 'OFF', tx0 - 10, ry, MV);
    } else if (type === 'choice') {
      var opts = val(it.options, it, this) || [];
      var cur = it.get(), lab = '';
      for (var i = 0; i < opts.length; i++) if (opts[i].v === cur) { lab = opts[i].label; break; }
      MV.color = focused ? pal.ink : rgba(pal.ink, 0.8);
      MV.alpha = a;
      var lw = AP.R.measure(ctx, lab, 15, '600');
      AP.R.text(ctx, lab, right - 18, ry, MV);
      ctx.globalAlpha = pa * a * (focused ? 1 : 0.4);
      ctx.fillStyle = pal.accent;
      var ax = right - 18 - lw - 14;
      ctx.beginPath(); ctx.moveTo(ax + 5, ry - 5); ctx.lineTo(ax, ry); ctx.lineTo(ax + 5, ry + 5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(right - 5, ry - 5); ctx.lineTo(right, ry); ctx.lineTo(right - 5, ry + 5); ctx.closePath(); ctx.fill();
      // option pips
      if (opts.length > 1 && opts.length <= 6) {
        for (var p = 0; p < opts.length; p++) {
          ctx.globalAlpha = pa * a * (opts[p].v === cur ? 0.95 : 0.25);
          ctx.fillRect(right - 18 - lw + (lw - (opts.length - 1) * 7) / 2 + p * 7 - 1.5, ry + 10, 3, 3);
        }
      }
    } else if (type === 'keys') {
      var nch = this.layoutChips(it, x + this.w * this.valueFrac);
      var capt = typeof it.capturing === 'function' ? it.capturing(it, this) : -1;
      var nb = keyList(it).length;
      for (var c = 0; c < nch; c++) {
        var on = focused && c === this.slot;
        var isAdd = c >= nb;
        var cw = chipW[c], cx0 = chipX[c];
        var waiting = capt === c;
        ctx.globalAlpha = pa * a * (isAdd && !on ? 0.45 : 1);
        UI.chamferPath(ctx, cx0, ry - 12, cw, 24, 4);
        ctx.fillStyle = waiting ? rgba(pal.accent, 0.25 + 0.2 * Math.sin(this.t * 10)) : (on ? rgba(pal.accent, 0.22) : rgba(pal.primary, 0.08));
        ctx.fill();
        ctx.strokeStyle = on || waiting ? pal.accent : rgba(pal.primary, val(it.conflict, c, it) ? 0.2 : 0.45);
        ctx.lineWidth = on ? 1.6 : 1.1;
        ctx.stroke();
        if (!isAdd && val(it.conflict, c, it)) {
          ctx.strokeStyle = pal.hazard;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        CHIP_T.size = 13;
        CHIP_T.color = waiting ? pal.accent : (on ? pal.ink : rgba(pal.ink, isAdd ? 0.7 : 0.88));
        AP.R.text(ctx, waiting ? '…' : chipLab[c], cx0 + cw / 2, ry + 0.5, CHIP_T);
        if (on && !waiting) UI.marker(ctx, cx0 + cw / 2, ry + 18, 3.2, this.t, pal.accent, undefined, a);
      }
      ctx.globalAlpha = pa;
    } else if (type === 'button' && it.value) {
      MV.color = focused ? pal.accent : rgba(pal.primary, 0.8);
      MV.alpha = a;
      AP.R.text(ctx, val(it.value, it, this), right, ry, MV);
    }
    if (type === 'button' && it.arrow && this.align !== 'center') {
      ctx.globalAlpha = pa * a * (focused ? 1 : 0.5);
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(right - 6, ry - 5); ctx.lineTo(right, ry); ctx.lineTo(right - 6, ry + 5); ctx.stroke();
    }
    ctx.globalAlpha = pa;
  };

  Menu.prototype.renderRow = function (ctx, pal, alpha) {
    var pa = ctx.globalAlpha;
    var sel = this.selItem;
    var shake = this.denyT > 0 ? Math.sin(this.denyT * 60) * 4 * (this.denyT / 0.3) : 0;
    for (var i = 0; i < this.rows.length; i++) {
      var r = this.rows[i];
      var it = r.item;
      var focused = it === sel;
      var dis = this.isDisabled(it);
      var a = alpha * (dis ? 0.38 : 1);
      var bx = this.x + r.x + (focused ? shake : 0), by = this.y - this.rowH / 2;
      ctx.globalAlpha = pa * a;
      UI.chamferPath(ctx, bx, by, r.w, this.rowH, 8);
      ctx.fillStyle = focused ? rgba(it.danger ? pal.hazard : pal.accent, 0.2 + 0.15 * this.flash) : rgba(pal.primary, 0.06);
      ctx.fill();
      ctx.strokeStyle = focused ? (it.danger ? pal.hazard : pal.accent) : rgba(pal.primary, 0.35);
      ctx.lineWidth = focused ? 1.8 : 1.2;
      ctx.stroke();
      ctx.globalAlpha = pa;
      var lab = this.label(it);
      if (this.stroke) {
        UI.strokeText(ctx, lab, bx + r.w / 2, this.y, { size: this.size, color: pal.ink, align: 'center', alpha: a * (focused ? 1 : 0.7),
          glow: focused ? (it.danger ? pal.hazard : pal.accent) : null });
      } else {
        MT.size = this.size;
        MT.color = focused ? pal.ink : rgba(pal.ink, 0.75);
        MT.alpha = a;
        MT.align = 'center';
        MT.weight = '700';
        AP.R.text(ctx, lab, bx + r.w / 2, this.y + 0.5, MT);
      }
    }
    // marker under the focused button
    var row = this.rowOf(sel);
    if (row) {
      var cx = this.x + this.selX + this.selW / 2;
      UI.marker(ctx, cx, this.y + this.rowH / 2 + 12, 5, this.t, pal.accent, undefined, alpha);
    }
    ctx.globalAlpha = pa;
  };

  // ================================================================ Dialog (modal confirm)
  // o: {title, text, options:[{label, action, danger}], onBack, pal, w}
  function Dialog(o) {
    this.o = o || {};
    this.t = 0;
    this.done = false;
    this.closing = 0;
    var self = this;
    var items = [];
    var opts = this.o.options || [{ label: 'OK' }];
    for (var i = 0; i < opts.length; i++) {
      (function (op) {
        items.push({ label: op.label, danger: !!op.danger, minW: 120,
          action: function () { self.close(); if (typeof op.action === 'function') op.action(); } });
      })(opts[i]);
    }
    this.w = this.o.w || 520;
    this.menu = new Menu({ items: items, horizontal: true, x: 480, y: 0, rowH: 38, size: 16, gap: 18,
      onBack: function () { self.close(); if (typeof self.o.onBack === 'function') self.o.onBack(); } });
    if (this.o.focus !== undefined) this.menu.selItem = items[this.o.focus] || this.menu.selItem;
    this.menu.snap();
  }
  UI.Dialog = Dialog;
  UI.dialog = function (o) { return new Dialog(o); };
  Dialog.prototype.close = function () { this.done = true; };
  Dialog.prototype.update = function (dt) {
    this.t += dt;
    if (this.done) return;
    if (this.t < 0.12) { UI.nav(); return; }
    this.menu.update(dt);
  };
  Dialog.prototype.render = function (ctx, pal) {
    pal = pal || this.o.pal || AP.R.pal('title');
    var k = M.ease.outCubic(clamp01(this.t / 0.22));
    UI.dim(ctx, 0.55 * k, '#000000');
    var lines = AP.R.wrap(ctx, this.o.text || '', this.w - 70, 15, '500');
    var h = 120 + lines.length * 21;
    var x = 480 - this.w / 2, y = 270 - h / 2 + (1 - k) * 18;
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * k;
    UI.panel(ctx, x, y, this.w, h, { pal: pal, accent: this.o.danger ? pal.hazard : pal.accent, fillAlpha: 0.94 });
    UI.strokeText(ctx, this.o.title || '', 480, y + 32, { size: 22, color: pal.ink, align: 'center', glow: this.o.danger ? pal.hazard : pal.accent,
      progress: clamp01(this.t / 0.5) });
    for (var i = 0; i < lines.length; i++) UI.body(ctx, lines[i], 480, y + 62 + i * 21, 15, rgba(pal.ink, 0.85), 'center');
    this.menu.y = y + h - 32;
    ctx.globalAlpha = pa;
    this.menu.render(ctx, { pal: pal, alpha: k });
  };

  // ================================================================ transitions
  // drawTransition(ctx, kind, cover0to1, color). The manager eases cover up (covering the old scene) and back
  // down (revealing the new one); the phase is inferred from the direction of change.
  var tr = { last: -1, lastT: -10, uncover: false };
  function phase(cover) {
    var t = now();
    if (t - tr.lastT > 0.3 || tr.last < 0) tr.uncover = cover > 0.6;
    else if (cover < tr.last - 1e-5) tr.uncover = true;
    else if (cover > tr.last + 1e-5) tr.uncover = false;
    tr.last = cover;
    tr.lastT = t;
    return tr.uncover;
  }

  function transPal() { return AP.level ? AP.level.pal : AP.R.pal('title'); }

  function drawIrisT(ctx, cover, color) {
    var sides = UI.formSides(UI.form());
    var cosk = sides >= 32 ? 1 : Math.cos(Math.PI / sides);
    var maxR = 560 / cosk + 30;
    var k = Math.pow(clamp01(cover), 0.9);
    var r = maxR * (1 - k);
    var rot = UI.flatRot(sides) + k * 1.4;
    var pal = transPal();
    ctx.fillStyle = color || '#000000';
    ctx.beginPath();
    ctx.rect(0, 0, 960, 540);
    if (r > 0.6) AP.R.poly(ctx, 480, 270, r, sides, rot, true);
    ctx.fill('evenodd');
    if (r > 0.6) {
      var pa = ctx.globalAlpha;
      var ea = Math.min(1, cover * 4) * Math.min(1, r / 40);
      ctx.lineJoin = 'round';
      ctx.globalAlpha = pa * ea;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 2.5;
      AP.R.poly(ctx, 480, 270, r, sides, rot);
      ctx.stroke();
      for (var e = 1; e <= 3; e++) {
        ctx.globalAlpha = pa * ea * (0.5 / e);
        ctx.strokeStyle = e === 1 ? pal.accent : pal.primary;
        ctx.lineWidth = 1.5;
        AP.R.poly(ctx, 480, 270, r * (1 + e * 0.07) + e * 6, sides, rot - e * 0.06 * (1 - k));
        ctx.stroke();
      }
      ctx.globalAlpha = pa;
      ctx.lineJoin = 'miter';
    }
    if (r < 60 && cover > 0.5) {
      var g = (60 - r) / 60;
      AP.R.glow(ctx, 480, 270, 30, pal.accent, 0.6 * g * (1 - cover * 0.5));
    }
  }

  // Voronoi shatter cells (built lazily, deterministic)
  var cells = null;
  function buildCells() {
    cells = [];
    var rng = AP.RNG(424242);
    var sites = [];
    var cols = 8, rows = 5;
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        sites.push([(x + 0.5) * 960 / cols + rng.range(-38, 38), (y + 0.5) * 540 / rows + rng.range(-30, 30)]);
      }
    }
    var polys = null;
    if (AP.Algo && typeof AP.Algo.voronoi === 'function') {
      try { polys = AP.Algo.voronoi(sites, [-2, -2, 964, 544]); } catch (e) { polys = null; }
    }
    if (!polys || !polys.length) {
      polys = [];
      for (var gy = 0; gy < rows; gy++) {
        for (var gx = 0; gx < cols; gx++) {
          var x0 = gx * 120 - 1, y0 = gy * 108 - 1;
          polys.push({ poly: [x0, y0, x0 + 122, y0, x0 + 122, y0 + 110, x0, y0 + 110] });
        }
      }
    }
    var maxD = Math.sqrt(480 * 480 + 270 * 270);
    for (var i = 0; i < polys.length; i++) {
      var p = polys[i].poly;
      if (!p || p.length < 6) continue;
      var cx = 0, cy = 0, n = p.length / 2;
      for (var j = 0; j < n; j++) { cx += p[j * 2]; cy += p[j * 2 + 1]; }
      cx /= n; cy /= n;
      var d = Math.sqrt((cx - 480) * (cx - 480) + (cy - 270) * (cy - 270)) / maxD;
      var local = new Float32Array(p.length);
      for (var q = 0; q < n; q++) { local[q * 2] = p[q * 2] - cx; local[q * 2 + 1] = p[q * 2 + 1] - cy; }
      cells.push({ pts: local, cx: cx, cy: cy, d: d, rnd: rng.next(), spin: rng.range(-2.6, 2.6), vx: (cx - 480) * rng.range(0.25, 0.6),
        vy: rng.range(-90, -10) });
    }
  }

  function cellPath(ctx, c, ox, oy, rot, sc) {
    var p = c.pts, n = p.length / 2;
    var co = Math.cos(rot) * sc, si = Math.sin(rot) * sc;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var x = p[i * 2], y = p[i * 2 + 1];
      var X = c.cx + ox + x * co - y * si, Y = c.cy + oy + x * si + y * co;
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.closePath();
  }

  function drawShatterT(ctx, cover, color, uncover) {
    if (!cells) buildCells();
    var pal = transPal();
    var fill = color || '#000000';
    var pa = ctx.globalAlpha;
    ctx.lineJoin = 'round';
    var i, c;
    if (!uncover) {
      // cracks race out from the centre, then each cell darkens into place
      for (i = 0; i < cells.length; i++) {
        c = cells[i];
        var st = c.d * 0.55 + c.rnd * 0.12;
        var k = clamp01((cover - st) / 0.33);
        if (k <= 0) continue;
        var e = M.ease.outBack(k);
        cellPath(ctx, c, 0, (1 - k) * -18, (1 - k) * c.spin * 0.25, 0.6 + 0.4 * Math.min(1.08, e));
        ctx.globalAlpha = pa * Math.min(1, k * 1.3);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.globalAlpha = pa * (1 - k * 0.6) * 0.9;
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      var u = 1 - cover;
      for (i = 0; i < cells.length; i++) {
        c = cells[i];
        var st2 = c.d * 0.42 + c.rnd * 0.1;
        var f = clamp01((u - st2) / 0.5);
        if (f >= 1) continue;
        var g = f * f;
        var ox = c.vx * f, oy = c.vy * f + g * 760;
        cellPath(ctx, c, ox, oy, c.spin * g, 1 - 0.25 * g);
        ctx.globalAlpha = pa;
        ctx.fillStyle = fill;
        ctx.fill();
        var ea = f > 0 ? (1 - f) : clamp01(u * 8);
        if (ea > 0.01) {
          ctx.globalAlpha = pa * ea * 0.85;
          ctx.strokeStyle = f > 0 ? pal.accent : pal.primary;
          ctx.lineWidth = f > 0 ? 2 : 1.2;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = pa;
    ctx.lineJoin = 'miter';
  }

  UI.drawTransition = function (ctx, kind, cover, color) {
    cover = clamp01(fin(cover, 0));
    var uncover = phase(cover);
    if (cover <= 0.001) return;
    if (kind === 'iris') drawIrisT(ctx, cover, color);
    else if (kind === 'shatter') drawShatterT(ctx, cover, color, uncover);
    else {
      var pa = ctx.globalAlpha;
      ctx.globalAlpha = pa * cover;
      ctx.fillStyle = color || '#000000';
      ctx.fillRect(0, 0, 960, 540);
      ctx.globalAlpha = pa;
    }
  };

  // ================================================================ theorem emblems
  // emblem(ctx, id, x, y, r, color, alpha, t): a small geometric picture for each theorem
  var embScratch = null;
  function embData() {
    if (embScratch) return embScratch;
    var rng = AP.RNG(31415);
    var mc = [];
    for (var i = 0; i < 26; i++) mc.push(rng.next(), rng.next());
    // Hilbert curve, order 2 (16 points in a unit square)
    var hil = [];
    for (var d = 0; d < 16; d++) {
      var rx, ry, s, t = d, x = 0, y = 0;
      for (s = 1; s < 4; s *= 2) {
        rx = 1 & (t / 2);
        ry = 1 & (t ^ rx);
        if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } var tmp = x; x = y; y = tmp; }
        x += s * rx;
        y += s * ry;
        t = Math.floor(t / 4);
      }
      hil.push(x / 3, y / 3);
    }
    embScratch = { mc: mc, hil: hil };
    return embScratch;
  }

  var DASH_23 = [2, 3], DASH_33 = [3, 3], NO_DASH = [];
  UI.NO_DASH = NO_DASH;

  function lineP(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  }

  var EMB = {
    'axiom': function (c, r, col) {
      AP.R.poly(c, 0, 0, r, 3, -Math.PI / 2); c.stroke();
      c.beginPath(); c.arc(0, 0, r * 0.42, 0, TAU); c.stroke();
      c.beginPath(); c.arc(0, 0, r * 0.12, 0, TAU); c.fillStyle = col; c.fill();
    },
    'pythagoras': function (c, r) {
      var a = [-0.45 * r, 0.35 * r], b = [0.45 * r, 0.35 * r], q = [-0.45 * r, -0.33 * r];
      lineP(c, [a[0], a[1], b[0], b[1], q[0], q[1]]); c.closePath(); c.stroke();
      c.strokeRect(a[0] - 0.36 * r, q[1], 0.36 * r, a[1] - q[1]);
      c.strokeRect(a[0], a[1], b[0] - a[0], 0.36 * r);
      var hx = b[0] - q[0], hy = b[1] - q[1], hl = Math.sqrt(hx * hx + hy * hy), nx = -hy / hl * hl * 0.5, ny = hx / hl * hl * 0.5;
      lineP(c, [q[0], q[1], q[0] - nx * 0.6, q[1] - ny * 0.6, b[0] - nx * 0.6, b[1] - ny * 0.6, b[0], b[1]]); c.stroke();
    },
    'golden-ratio': function (c, r) {
      var w = r * 1.7, h = w / 1.618, x = -w / 2, y = -h / 2;
      c.strokeRect(x, y, w, h);
      c.beginPath(); c.moveTo(x + h, y); c.lineTo(x + h, y + h); c.stroke();
      c.beginPath(); c.arc(x + h, y + h, h, Math.PI, Math.PI * 1.5); c.stroke();
      var s2 = w - h;
      c.beginPath(); c.arc(x + h, y + s2, s2, -Math.PI / 2, 0); c.stroke();
      c.beginPath(); c.moveTo(x + h, y + s2); c.lineTo(x + w, y + s2); c.stroke();
    },
    'honeycomb': function (c, r) {
      var s = r * 0.36;
      AP.R.poly(c, 0, 0, s, 6, 0); c.stroke();
      for (var i = 0; i < 6; i++) { var a = Math.PI / 6 + i * Math.PI / 3; AP.R.poly(c, Math.cos(a) * s * 1.732, Math.sin(a) * s * 1.732, s, 6, 0); c.stroke(); }
    },
    'squaring-circle': function (c, r) {
      var s = r * 0.886 * 1.25;
      c.strokeRect(-s / 2 * 1.13, -s / 2 * 1.13, s * 1.13, s * 1.13);
      c.beginPath(); c.arc(0, 0, r * 0.7, 0, TAU); c.stroke();
    },
    'tiling': function (c, r) {
      var s = r * 0.8;
      c.strokeRect(-s, -s, s * 2, s * 2);
      c.beginPath(); c.moveTo(0, -s); c.lineTo(0, s); c.moveTo(-s, 0); c.lineTo(s, 0); c.stroke();
      var h = s / 2;
      c.beginPath(); c.arc(-s, -s, h, 0, Math.PI / 2); c.stroke();
      c.beginPath(); c.arc(0, 0, h, Math.PI, Math.PI * 1.5); c.stroke();
      c.beginPath(); c.arc(s, -s, h, Math.PI / 2, Math.PI); c.stroke();
      c.beginPath(); c.arc(0, 0, h, -Math.PI / 2, 0); c.stroke();
      c.beginPath(); c.arc(-s, s, h, -Math.PI / 2, 0); c.stroke();
      c.beginPath(); c.arc(0, 0, h, Math.PI / 2, Math.PI); c.stroke();
      c.beginPath(); c.arc(s, s, h, Math.PI, Math.PI * 1.5); c.stroke();
      c.beginPath(); c.arc(0, 0, h, 0, Math.PI / 2); c.stroke();
    },
    'crystallographic': function (c, r) {
      AP.R.poly(c, 0, 0, r, 6, Math.PI / 6); c.stroke();
      c.beginPath();
      for (var i = 0; i < 6; i++) { var a = Math.PI / 6 + i * Math.PI / 3; c.moveTo(0, 0); c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.stroke();
      AP.R.poly(c, 0, 0, r * 0.5, 6, 0); c.stroke();
    },
    'navier-stokes': function (c, r) {
      for (var k = 0; k < 3; k++) {
        c.beginPath();
        for (var i = 0; i <= 24; i++) {
          var tt = i / 24, a = k * TAU / 3 + tt * 3.6, rr = r * (0.15 + 0.85 * tt);
          var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    },
    'banach-tarski': function (c, r) {
      c.beginPath(); c.arc(-r * 0.45, 0, r * 0.45, 0, TAU); c.stroke();
      c.beginPath(); c.arc(r * 0.45, 0, r * 0.45, 0, TAU); c.stroke();
      c.setLineDash(DASH_33);
      c.beginPath(); c.arc(0, 0, r * 0.9, 0, TAU); c.stroke();
      c.setLineDash(NO_DASH);
    },
    'qed': function (c, r, col) {
      c.strokeRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      c.fillStyle = col;
      c.fillRect(-r * 0.42, -r * 0.42, r * 0.84, r * 0.84);
    },
    'euler-path': function (c, r) {
      var s = r * 0.7;
      lineP(c, [-s, s, -s, -0.1 * s, s, -0.1 * s, -s, s, s, s, s, -0.1 * s, 0, -s, -s, -0.1 * s, s, s]);
      c.stroke();
    },
    'zeno': function (c, r) {
      c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.stroke();
      c.beginPath();
      var x = -r, seg = r;
      for (var i = 0; i < 6; i++) { c.moveTo(x, -r * 0.3); c.lineTo(x, r * 0.3); x += seg; seg /= 2; }
      c.moveTo(r, -r * 0.45); c.lineTo(r, r * 0.45);
      c.stroke();
    },
    'brachistochrone': function (c, r, col) {
      c.beginPath();
      for (var i = 0; i <= 24; i++) {
        var th = i / 24 * Math.PI;
        var x = -r + (th - Math.sin(th)) / Math.PI * r * 2 * 0.95, y = -r * 0.7 + (1 - Math.cos(th)) * r * 0.55;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.setLineDash(DASH_23);
      c.beginPath(); c.moveTo(-r, -r * 0.7); c.lineTo(r * 0.9, r * 0.4); c.stroke();
      c.setLineDash(NO_DASH);
      c.beginPath(); c.arc(-r * 0.05, r * 0.32, r * 0.12, 0, TAU); c.fillStyle = col; c.fill();
    },
    'prime-hunter': function (c, r) {
      lineP(c, [0, -r, r * 0.72, -r * 0.18, 0, r, -r * 0.72, -r * 0.18]); c.closePath(); c.stroke();
      lineP(c, [-r * 0.72, -r * 0.18, r * 0.72, -r * 0.18]); c.stroke();
      lineP(c, [-r * 0.3, -r * 0.18, 0, r, r * 0.3, -r * 0.18]); c.stroke();
    },
    'sieve': function (c, r, col) {
      var s = r * 0.44;
      for (var i = 0; i < 16; i++) {
        var n = i + 2, x = -r * 0.66 + (i % 4) * s, y = -r * 0.66 + Math.floor(i / 4) * s;
        var prime = n === 2 || n === 3 || n === 5 || n === 7 || n === 11 || n === 13 || n === 17;
        if (prime) { c.beginPath(); c.arc(x, y, r * 0.11, 0, TAU); c.fillStyle = col; c.fill(); }
        else { c.beginPath(); c.moveTo(x - r * 0.08, y - r * 0.08); c.lineTo(x + r * 0.08, y + r * 0.08); c.stroke(); }
      }
    },
    'infinitude': function (c, r) {
      c.beginPath();
      for (var i = 0; i <= 48; i++) {
        var t = i / 48 * TAU, s = Math.sin(t), co = Math.cos(t), d = 1 + s * s;
        var x = r * co / d, y = r * s * co / d * 1.2;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    },
    'tessellation': function (c, r) {
      var h = r * 0.866;
      lineP(c, [0, -r, r, h * 0.9, -r, h * 0.9]); c.closePath(); c.stroke();
      lineP(c, [-r / 2, -r / 2 + h * 0.45 - 0.05 * r, r / 2, -r / 2 + h * 0.45 - 0.05 * r, 0, h * 0.9]); c.closePath(); c.stroke();
    },
    'fibonacci': function (c, r) {
      var u = r * 0.32;
      c.strokeRect(-2.5 * u, -1.5 * u, 3 * u, 3 * u);
      c.strokeRect(0.5 * u, -1.5 * u, 2 * u, 2 * u);
      c.strokeRect(0.5 * u, 0.5 * u, u, u);
      c.strokeRect(1.5 * u, 0.5 * u, u, u);
      c.beginPath(); c.arc(0.5 * u, 1.5 * u, 3 * u, Math.PI, Math.PI * 1.5); c.stroke();
      c.beginPath(); c.arc(0.5 * u, 0.5 * u, 2 * u, -Math.PI / 2, 0); c.stroke();
    },
    'seven-bridges': function (c, r, col) {
      var A = [0, -r * 0.85], B = [-r * 0.45, 0], C = [r * 0.55, 0], D = [0, r * 0.85];
      c.beginPath();
      c.moveTo(A[0], A[1]); c.quadraticCurveTo(-r * 0.5, -r * 0.6, B[0], B[1]);
      c.moveTo(A[0], A[1]); c.quadraticCurveTo(-r * 0.05, -r * 0.3, B[0], B[1]);
      c.moveTo(D[0], D[1]); c.quadraticCurveTo(-r * 0.5, r * 0.6, B[0], B[1]);
      c.moveTo(D[0], D[1]); c.quadraticCurveTo(-r * 0.05, r * 0.3, B[0], B[1]);
      c.moveTo(A[0], A[1]); c.lineTo(C[0], C[1]);
      c.moveTo(D[0], D[1]); c.lineTo(C[0], C[1]);
      c.moveTo(B[0], B[1]); c.lineTo(C[0], C[1]);
      c.stroke();
      c.fillStyle = col;
      for (var i = 0; i < 4; i++) { var P = [A, B, C, D][i]; c.beginPath(); c.arc(P[0], P[1], r * 0.12, 0, TAU); c.fill(); }
    },
    'large-numbers': function (c, r) {
      for (var i = 0; i < 7; i++) {
        var x = -r + (i + 0.5) * r * 2 / 7, hh = Math.exp(-Math.pow((i - 3) / 1.6, 2)) * r * 1.4;
        c.strokeRect(x - r / 7 + 1, r * 0.7 - hh, r * 2 / 7 - 2, hh);
      }
      c.beginPath();
      for (var k = 0; k <= 30; k++) { var xx = -r + k / 30 * 2 * r, yy = r * 0.7 - Math.exp(-Math.pow(xx / r * 3 / 1.6 * 1.1, 2)) * r * 1.5; if (k === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy); }
      c.stroke();
    },
    'mobius': function (c, r) {
      for (var w = -1; w <= 1; w += 2) {
        c.beginPath();
        for (var i = 0; i <= 48; i++) {
          var t = i / 48 * TAU, s = Math.sin(t), co = Math.cos(t), d = 1 + s * s;
          var x = r * co / d, y = r * s * co / d * 1.2 + w * r * 0.12 * Math.cos(t / 2);
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    },
    'parallel': function (c, r) {
      c.beginPath();
      c.moveTo(-r, -r * 0.4); c.lineTo(r, -r * 0.4);
      c.moveTo(-r, r * 0.4); c.lineTo(r, r * 0.4);
      c.moveTo(-r * 0.6, r * 0.95); c.lineTo(r * 0.6, -r * 0.95);
      c.stroke();
      c.beginPath(); c.arc(-r * 0.25, r * 0.4, r * 0.2, -Math.PI / 3, 0); c.stroke();
      c.beginPath(); c.arc(r * 0.25, -r * 0.4, r * 0.2, Math.PI * 2 / 3, Math.PI); c.stroke();
    },
    'pentagram': function (c, r) {
      AP.R.poly(c, 0, 0, r, 5, -Math.PI / 2); c.stroke();
      c.beginPath();
      for (var i = 0; i <= 5; i++) { var a = -Math.PI / 2 + i * 2 * TAU / 5; if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r); else c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.stroke();
    },
    'vector-space': function (c, r) {
      var v = [[r, 0], [0, -r], [-r * 0.6, r * 0.55]];
      for (var i = 0; i < 3; i++) {
        var x = v[i][0] * 0.9, y = v[i][1] * 0.9, a = Math.atan2(y, x);
        c.beginPath(); c.moveTo(0, 0); c.lineTo(x, y);
        c.moveTo(x, y); c.lineTo(x - Math.cos(a - 0.5) * r * 0.25, y - Math.sin(a - 0.5) * r * 0.25);
        c.moveTo(x, y); c.lineTo(x - Math.cos(a + 0.5) * r * 0.25, y - Math.sin(a + 0.5) * r * 0.25);
        c.stroke();
      }
    },
    'kepler': function (c, r, col, t) {
      c.beginPath(); c.ellipse(0, 0, r, r * 0.6, 0, 0, TAU); c.stroke();
      c.beginPath(); c.arc(-r * 0.8, 0, r * 0.14, 0, TAU); c.fillStyle = col; c.fill();
      var a = (t || 0) * 1.4;
      c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r * 0.6, r * 0.09, 0, TAU); c.fill();
    },
    'hilbert': function (c, r) {
      var h = embData().hil, s = r * 1.6;
      c.beginPath();
      for (var i = 0; i < h.length; i += 2) { var x = -s / 2 + h[i] * s, y = -s / 2 + h[i + 1] * s; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
    },
    'monte-carlo': function (c, r, col) {
      var s = r * 1.6, x0 = -s / 2, y0 = s / 2;
      c.strokeRect(x0, y0 - s, s, s);
      c.beginPath(); c.arc(x0, y0, s, -Math.PI / 2, 0); c.stroke();
      var mc = embData().mc;
      c.fillStyle = col;
      for (var i = 0; i < mc.length; i += 2) { c.beginPath(); c.arc(x0 + mc[i] * s, y0 - mc[i + 1] * s, Math.max(0.8, r * 0.05), 0, TAU); c.fill(); }
    },
    'four-color': function (c, r, col) {
      var alphas = [0.85, 0.5, 0.25, 0.1];
      for (var i = 0; i < 4; i++) {
        c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, i * Math.PI / 2 + 0.3, (i + 1) * Math.PI / 2 + 0.3); c.closePath();
        c.fillStyle = rgba(col, alphas[i]); c.fill(); c.stroke();
      }
      c.beginPath(); c.arc(0, 0, r * 0.35, 0, TAU); c.fillStyle = rgba(col, 0.35); c.fill(); c.stroke();
    },
    'godel': function (c, r) {
      c.beginPath(); c.arc(0, 0, r * 0.75, -Math.PI * 0.35, Math.PI * 1.45); c.stroke();
      var a = Math.PI * 1.45, x = Math.cos(a) * r * 0.75, y = Math.sin(a) * r * 0.75;
      c.beginPath(); c.moveTo(x + r * 0.28, y - r * 0.05); c.lineTo(x, y); c.lineTo(x + r * 0.05, y + r * 0.3); c.stroke();
      c.beginPath(); c.moveTo(-r * 0.2, -r * 0.2); c.lineTo(r * 0.2, r * 0.2); c.moveTo(r * 0.2, -r * 0.2); c.lineTo(-r * 0.2, r * 0.2); c.stroke();
    },
    'galileo': function (c, r, col) {
      c.beginPath(); c.moveTo(-r, -r * 0.8); c.quadraticCurveTo(r * 0.2, -r * 0.8, r * 0.6, r * 0.9); c.stroke();
      c.fillStyle = col;
      for (var i = 0; i < 5; i++) {
        var tt = i / 4, x = -r + tt * 1.6 * r * 0.9, y = -r * 0.8 + tt * tt * 1.7 * r;
        c.beginPath(); c.arc(x, y, r * 0.08, 0, TAU); c.fill();
      }
      c.beginPath(); c.moveTo(-r, r * 0.95); c.lineTo(r, r * 0.95); c.stroke();
    },
    'escape-velocity': function (c, r) {
      c.beginPath(); c.arc(-r * 0.35, r * 0.25, r * 0.45, 0, TAU); c.stroke();
      c.beginPath(); c.arc(-r * 0.35, r * 0.25, r * 0.7, -Math.PI * 0.9, -Math.PI * 0.25); c.stroke();
      c.beginPath(); c.moveTo(r * 0.12, -r * 0.3); c.quadraticCurveTo(r * 0.5, -r * 0.6, r, -r * 0.95); c.stroke();
      c.beginPath(); c.moveTo(r, -r * 0.95); c.lineTo(r * 0.72, -r * 0.88); c.moveTo(r, -r * 0.95); c.lineTo(r * 0.9, -r * 0.68); c.stroke();
    },
    'pigeonhole': function (c, r, col) {
      for (var i = 0; i < 3; i++) c.strokeRect(-r + i * r * 0.7, -r * 0.2, r * 0.6, r * 0.75);
      c.fillStyle = col;
      var pts = [-r + r * 0.18, r * 0.18, -r + r * 0.42, r * 0.18, -r + r * 0.7 + r * 0.3, r * 0.18, -r + r * 1.4 + r * 0.3, r * 0.18];
      for (var k = 0; k < pts.length; k += 2) { c.beginPath(); c.arc(pts[k], pts[k + 1], r * 0.1, 0, TAU); c.fill(); }
      lineP(c, [-r * 0.6, -r * 0.45, -r * 0.6, -r * 0.85]); c.stroke();
    },
    'halting': function (c, r) {
      AP.R.poly(c, 0, 0, r, 8, Math.PI / 8); c.stroke();
      AP.R.poly(c, 0, 0, r * 0.72, 8, Math.PI / 8); c.stroke();
      c.beginPath(); c.moveTo(-r * 0.35, 0); c.lineTo(r * 0.35, 0); c.stroke();
    }
  };

  UI.emblem = function (ctx, id, x, y, r, color, alpha, t) {
    var a = alpha === undefined ? 1 : alpha;
    if (a <= 0.002 || !(r > 0.5)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha *= a;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, r * 0.075);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    var fn = EMB[id];
    try {
      if (fn) fn(ctx, r, color, t || 0);
      else { AP.R.poly(ctx, 0, 0, r, 3 + (AP.hash(String(id)) % 5), 0); ctx.stroke(); }
    } finally {
      ctx.restore();
    }
  };
  UI.hasEmblem = function (id) { return !!EMB[id]; };

  // ================================================================ colour caches (no per-frame string building)
  var shadeCache = {}, shadeN = 0;
  UI.shade = function (hex, k) {
    var key = hex + '|' + k;
    var v = shadeCache[key];
    if (v) return v;
    if (++shadeN > 1500) { shadeCache = {}; shadeN = 0; }
    v = shadeCache[key] = AP.Color.shade(hex, k);
    return v;
  };
  var mixCache = {}, mixN = 0;
  UI.mix = function (a, b, t) {
    var q = Math.round(clamp01(t) * 48);
    var key = a + '|' + b + '|' + q;
    var v = mixCache[key];
    if (v) return v;
    if (++mixN > 3000) { mixCache = {}; mixN = 0; }
    v = mixCache[key] = AP.Color.mix(a, b, q / 48);
    return v;
  };

  // ================================================================ timing helpers
  // UI animation runs on real time (AP.Time.now), so scenes keep breathing while an overlay covers them.
  UI.now = now;
  UI.k = function (t, start, dur) { return clamp01((t - start) / (dur > 0 ? dur : 1)); };
  UI.pulse = function (t, rate) { return 0.5 + 0.5 * Math.sin(t * (rate || 3)); };
  var frameDtState = { frame: -1, last: 0, dt: 0 };
  // real seconds since the previous rendered frame (0..0.1), shared by every render-driven animation
  UI.frameDt = function () {
    var f = AP.Time ? AP.Time.frame : 0;
    if (frameDtState.frame !== f) {
      var t = now();
      frameDtState.dt = Math.min(0.1, Math.max(0, t - frameDtState.last));
      frameDtState.last = t;
      frameDtState.frame = f;
    }
    return frameDtState.dt;
  };

  // ================================================================ levels and worlds (registered data first, DESIGN fallbacks)
  var LEVEL_NAMES = {
    'w1-1': 'First Vertex', 'w1-2': 'Truchet Falls', 'w1-3': 'Gridlock', 'w1-boss': 'The Tessellator',
    'w2-1': 'Cell Division', 'w2-2': 'Fracture Lines', 'w2-3': 'The Geode', 'w2-4': 'Delaunay Deep', 'w2-boss': 'Crystal Monarch',
    'w3-1': 'Streamlines', 'w3-2': 'Updraft', 'w3-3': 'Eddies', 'w3-4': 'Turbulence', 'w3-5': 'The Doldrums', 'w3-boss': 'Maelstrom',
    'w4-1': 'Axiom', 'w4-2': 'Branching Rules', 'w4-3': 'Self-Similar', 'w4-4': 'Koch Coast', 'w4-5': 'Recursion Depth', 'w4-6': 'Overgrowth',
    'w4-boss': 'The Recursion',
    'w5-1': 'Fundamental', 'w5-2': 'Overtones', 'w5-3': 'Interference', 'w5-4': 'Lissajous', 'w5-5': 'Golden Angle', 'w5-6': 'Resonance',
    'w5-boss': 'The Null'
  };
  var WORLD_CARD = ['', 'THE LATTICE', 'VORONOI CAVERNS', 'THE CURRENTS', 'FRACTAL GARDENS', 'HARMONIC SPIRE'];

  function parseId(id) {
    if (AP.Progress && AP.Progress.parseId) return AP.Progress.parseId(id);
    var m = /^w([1-5])-(\d+|boss)$/.exec(String(id || ''));
    return m ? { world: +m[1], boss: m[2] === 'boss', index: m[2] === 'boss' ? 0 : +m[2] } : null;
  }
  UI.parseId = parseId;

  UI.levelLabel = function (id) {
    var p = parseId(id);
    if (!p) return String(id || '').toUpperCase();
    return 'W' + p.world + '-' + (p.boss ? 'BOSS' : p.index);
  };

  // levelInfo(id) -> {id, world, index, boss, name, par, label, registered, form}. Levels register at load time, so the
  // result is cached per id (treat it as read-only).
  var infoCache = {};
  UI.levelInfo = function (id) {
    var key = String(id);
    var hit = infoCache[key];
    if (hit && hit.registered === !!(AP.Levels && AP.Levels.has && AP.Levels.has(id))) return hit;
    hit = infoCache[key] = makeInfo(id);
    return hit;
  };
  function makeInfo(id) {
    var def = AP.Levels && AP.Levels.get ? AP.Levels.get(id) : null;
    var p = parseId(id);
    var W = p && AP.Worlds ? AP.Worlds.get(p.world) : null;
    var par = def && +def.par > 0 ? +def.par : ((AP.Meta && AP.Meta.parOf) ? AP.Meta.parOf(id) : 0);
    return {
      id: id,
      world: p ? p.world : (def ? def.world | 0 : 0),
      index: p ? p.index : (def ? def.index | 0 : 0),
      boss: p ? p.boss : !!(def && def.boss),
      name: (def && def.name) || LEVEL_NAMES[id] || (p && p.boss && W ? W.bossName : String(id || '')),
      par: par,
      label: UI.levelLabel(id),
      registered: !!def,
      form: def ? def.form : (W ? W.form : 3)
    };
  }
  UI.worldCardTitle = function (n) { return WORLD_CARD[n] || ''; };
  UI.worldMotto = function (n) {
    return ['', 'Every path is a choice of corners.', 'Each crystal claims the space nearest to it.', 'Here the wind is drawn before it blows.',
      'The part remembers the whole.', 'Everything that moves, moves in time.'][n] || '';
  };
  UI.formName = function (form) { return (AP.FORM_NAMES && AP.FORM_NAMES[form]) || 'Triangle'; };
  UI.formWord = function (form) {
    return { 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX', 99: '∞' }[form] || '';
  };

  // background helper: dark gradient used by story scenes (cached per colour)
  var gradCache = {};
  UI.deepBg = function (ctx, top, bottom) {
    var key = top + bottom;
    var g = gradCache[key];
    if (!g || gradCache._ctx !== ctx) {
      if (gradCache._ctx !== ctx) gradCache = { _ctx: ctx };
      g = ctx.createLinearGradient(0, 0, 0, 540);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      gradCache[key] = g;
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 960, 540);
  };

  // ================================================================ composite widgets
  // header(ctx, title, x, y, t, pal, {sub, size, align, glow}) — stroke-font title drawn on, with an underline
  var HDR_O = { size: 30, color: '#FFFFFF', align: 'left', glow: null, progress: 1, alpha: 1, spacing: 1.8, sparks: true };
  var HDR_S = { size: 13, weight: '600', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1 };
  UI.header = function (ctx, title, x, y, t, pal, o) {
    o = o || EMPTY;
    var size = o.size || 30;
    var al = o.align || 'left';
    var k = clamp01(t / 0.9);
    HDR_O.size = size; HDR_O.color = pal.ink; HDR_O.align = al; HDR_O.glow = o.glow || pal.accent; HDR_O.progress = k;
    HDR_O.alpha = o.alpha === undefined ? 1 : o.alpha;
    var w = UI.strokeText(ctx, title, x, y, HDR_O);
    var lk = M.ease.outCubic(clamp01((t - 0.25) / 0.8));
    var lx = al === 'center' ? x - w / 2 : (al === 'right' ? x - w : x);
    var ly = y + size * 0.52;
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * HDR_O.alpha * 0.75;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + (w + 30) * lk, ly);
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    AP.R.poly(ctx, lx + (w + 30) * lk + 4, ly, 3, 4, 0);
    ctx.fill();
    ctx.globalAlpha = pa;
    if (o.sub) {
      HDR_S.color = rgba(pal.primary, 0.85);
      HDR_S.alpha = HDR_O.alpha * clamp01((t - 0.35) / 0.5);
      HDR_S.align = al;
      AP.R.text(ctx, o.sub, x, ly + 16, HDR_S);
    }
    return w;
  };

  // bar(ctx, x, y, w, h, frac, pal, {color, back, ticks, ghost, glow, alpha}) — a thin progress bar
  UI.bar = function (ctx, x, y, w, h, frac, pal, o) {
    o = o || EMPTY;
    var f = clamp01(fin(frac, 0));
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * (o.alpha === undefined ? 1 : o.alpha);
    ctx.fillStyle = o.back || rgba(pal.primary, 0.14);
    ctx.fillRect(x, y, w, h);
    if (o.ghost !== undefined && o.ghost > f) {
      ctx.fillStyle = rgba(pal.ink, 0.55);
      ctx.fillRect(x + w * f, y, w * (clamp01(o.ghost) - f), h);
    }
    ctx.fillStyle = o.color || pal.accent;
    ctx.fillRect(x, y, w * f, h);
    if (o.ticks > 1) {
      ctx.fillStyle = rgba(pal.bg, 0.9);
      for (var i = 1; i < o.ticks; i++) ctx.fillRect(x + w * i / o.ticks - 1, y, 2, h);
    }
    if (o.glow && f > 0) AP.R.glow(ctx, x + w * f, y + h / 2, Math.max(8, h * 3), o.color || pal.accent, o.glow);
    ctx.globalAlpha = pa;
  };

  // playerGlyph(ctx, x, y, r, form, rot, sty, alpha, pal, t) — the player's look: outline, translucent fill, core, eye
  UI.playerGlyph = function (ctx, x, y, r, form, rot, sty, alpha, pal, t) {
    var a = alpha === undefined ? 1 : alpha;
    if (a <= 0.002) return;
    var stroke = (sty && sty.stroke) || pal.ink, fill = (sty && sty.fill) || pal.accent;
    var glowC = (sty && sty.glow) || pal.accent, eye = (sty && sty.eye) || pal.ink;
    var pa = ctx.globalAlpha;
    if (glowC !== '#161616') AP.R.glow(ctx, x, y, r * 2.4, glowC, 0.45 * a);
    var n = UI.formSides(form);
    ctx.globalAlpha = pa * a;
    AP.R.poly(ctx, x, y, r, n >= 32 ? 48 : n, rot);
    ctx.fillStyle = fill === '#000000' ? '#000000' : rgba(fill, 0.22);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1.5, r * 0.19);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = rgba(stroke, 0.55);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r * 0.23), 0, TAU);
    ctx.fill();
    var ex = Math.cos((t || 0) * 0.7) * r * 0.25;
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.arc(x + r * 0.2 + ex * 0.4, y - r * 0.05, Math.max(0.8, r * 0.19), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = pa;
    ctx.lineJoin = 'miter';
  };

  // true when the save holds progress worth confirming before it is erased
  UI.hasProgress = function () {
    var d = AP.Save && AP.Save.data;
    if (!d) return false;
    if ((d.form | 0) > 3) return true;
    var k;
    if (d.unlocked) for (k in d.unlocked) if (k !== 'w1-1' && d.unlocked[k] === true) return true;
    if (d.levels) for (k in d.levels) {
      var r = d.levels[k];
      if (r && (r.done || (r.gems && (r.gems[0] || r.gems[1] || r.gems[2])))) return true;
    }
    if (d.theorems) for (k in d.theorems) if (d.theorems[k] === true) return true;
    var s = d.stats || EMPTY;
    return (s.deaths | 0) > 0 || (s.shards | 0) > 0 || (s.levelsDone | 0) > 0;
  };

  // go(name, params, fx, dur, color): a guarded scene change (missing scenes fall back as CORE resolves them)
  UI.go = function (name, params, fx, dur, color) {
    if (!AP.Scenes) return false;
    return AP.Scenes.go(name, params || {}, { fx: fx || 'fade', dur: dur === undefined ? 0.5 : dur, color: color });
  };

  // a pushed overlay closes itself: pop when it is on top, else fall back to a scene
  UI.close = function (fallback) {
    var S = AP.Scenes;
    if (!S) return;
    if (S.stack && S.stack.length > 1) S.pop();
    else UI.go(fallback || 'title', {}, 'fade', 0.4);
  };

  // ================================================================ UI sparks (a small particle pool for menus)
  var SPN = 280;
  var spX = new Float32Array(SPN), spY = new Float32Array(SPN), spVX = new Float32Array(SPN), spVY = new Float32Array(SPN);
  var spL = new Float32Array(SPN), spM = new Float32Array(SPN), spS = new Float32Array(SPN), spR = new Float32Array(SPN);
  var spW = new Float32Array(SPN), spG = new Float32Array(SPN), spD = new Float32Array(SPN);
  var spK = new Uint8Array(SPN), spC = [];
  for (var spi = 0; spi < SPN; spi++) spC.push('#FFFFFF');
  var spHead = 0;
  UI.sparks = {
    // emit(x, y, {n, color, color2, speed:[a,b], angle:[a,b], life:[a,b], size:[a,b], gravity, drag, shape 0 dot|1 tri|2 diamond|3 streak|4 ring})
    emit: function (x, y, o) {
      o = o || EMPTY;
      var n = o.n || 10;
      var q = AP.R && AP.R.quality ? AP.R.quality.particles : 1;
      n = Math.max(1, Math.round(n * (q || 1)));
      var sp = o.speed || [60, 180], an = o.angle || [0, TAU], li = o.life || [0.4, 0.8], sz = o.size || [1.5, 3];
      for (var i = 0; i < n; i++) {
        var j = spHead;
        spHead = (spHead + 1) % SPN;
        var a = an[0] + Math.random() * (an[1] - an[0]);
        var v = sp[0] + Math.random() * (sp[1] - sp[0]);
        spX[j] = x + (o.spread ? (Math.random() - 0.5) * o.spread : 0);
        spY[j] = y + (o.spread ? (Math.random() - 0.5) * o.spread : 0);
        spVX[j] = Math.cos(a) * v; spVY[j] = Math.sin(a) * v;
        spM[j] = li[0] + Math.random() * (li[1] - li[0]);
        spL[j] = spM[j];
        spS[j] = sz[0] + Math.random() * (sz[1] - sz[0]);
        spR[j] = Math.random() * TAU;
        spW[j] = (Math.random() - 0.5) * 8;
        spG[j] = o.gravity || 0;
        spD[j] = o.drag || 0;
        spK[j] = o.shape || 0;
        spC[j] = (o.color2 && Math.random() < 0.5) ? o.color2 : (o.color || '#FFFFFF');
      }
    },
    update: function (dt) {
      for (var i = 0; i < SPN; i++) {
        if (spL[i] <= 0) continue;
        spL[i] -= dt;
        spVY[i] += spG[i] * dt;
        if (spD[i] > 0) { var f = Math.max(0, 1 - spD[i] * dt); spVX[i] *= f; spVY[i] *= f; }
        spX[i] += spVX[i] * dt;
        spY[i] += spVY[i] * dt;
        spR[i] += spW[i] * dt;
      }
    },
    render: function (ctx) {
      var pa = ctx.globalAlpha, pc = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < SPN; i++) {
        if (spL[i] <= 0) continue;
        var k = spL[i] / spM[i];
        var s = spS[i] * (0.4 + 0.6 * k);
        ctx.globalAlpha = pa * Math.min(1, k * 1.6);
        var x = spX[i], y = spY[i], c = spC[i];
        if (spK[i] === 3) {
          ctx.strokeStyle = c;
          ctx.lineWidth = Math.max(0.8, s * 0.6);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - spVX[i] * 0.05, y - spVY[i] * 0.05);
          ctx.stroke();
        } else if (spK[i] === 4) {
          ctx.strokeStyle = c;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, s * (2.5 - 1.5 * k), 0, TAU);
          ctx.stroke();
        } else if (spK[i] === 0) {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(x, y, s, 0, TAU);
          ctx.fill();
        } else {
          ctx.fillStyle = c;
          AP.R.poly(ctx, x, y, s * 1.4, spK[i] === 1 ? 3 : 4, spR[i]);
          ctx.fill();
        }
      }
      ctx.globalAlpha = pa;
      ctx.globalCompositeOperation = pc;
    },
    // advance once per rendered frame, whoever draws first
    tick: function () {
      var f = AP.Time ? AP.Time.frame : 0;
      if (f === spFrame) return;
      spFrame = f;
      this.update(UI.frameDt());
    },
    clear: function () { for (var i = 0; i < SPN; i++) spL[i] = 0; },
    count: function () { var n = 0; for (var i = 0; i < SPN; i++) if (spL[i] > 0) n++; return n; }
  };
  var spFrame = -1;

  AP.UI = UI;
})(window.AP = window.AP || {});
