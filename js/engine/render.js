/* js/engine/render.js — owner: CORE */
(function (AP) {
  'use strict';

  var TAU = Math.PI * 2;
  var W = 960, H = 540;
  var FALLBACK_PAL = { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' };

  // ---- a no-op 2D context so drawing code never crashes when no canvas exists ----
  function NullGradient() {}
  NullGradient.prototype.addColorStop = function () {};
  function makeNullCtx() {
    var noop = function () {};
    var c = {
      canvas: { width: W, height: H },
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
      font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter',
      measureText: function (s) { return { width: String(s).length * 7 }; },
      createLinearGradient: function () { return new NullGradient(); },
      createRadialGradient: function () { return new NullGradient(); },
      createPattern: function () { return null; },
      getTransform: function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
    };
    ['save', 'restore', 'setTransform', 'resetTransform', 'transform', 'translate', 'rotate', 'scale', 'beginPath',
      'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'quadraticCurveTo', 'bezierCurveTo', 'fill',
      'stroke', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage', 'setLineDash', 'clip',
      'putImageData'].forEach(function (k) { c[k] = noop; });
    return c;
  }

  var R = {
    W: W, H: H, scale: 1, dpr: 1, px: 1,
    ctx: null, canvas: null, bgCanvas: null, stage: null,
    cssLeft: 0, cssTop: 0,
    FONT_UI: '"Segoe UI","Helvetica Neue",Arial,sans-serif',
    FONT_MONO: 'Consolas,"SF Mono",Menlo,monospace',
    quality: { particles: 1, bg: 'high', mid: true },
    downgradeLevel: 0,
    glowCount: 0,
    GLOW_CAP: 120,
    bgDrawn: false,
    glShowing: false,
    bgMode: 'none',
    makeNullCtx: makeNullCtx
  };

  function settings() {
    return (AP.Save && AP.Save.data && AP.Save.data.settings) || {};
  }

  function findCanvas(id, stage) {
    var doc = (typeof document !== 'undefined') ? document : null;
    var c = null;
    try { if (doc && doc.getElementById) c = doc.getElementById(id); } catch (e) { c = null; }
    if (!c && stage && stage.querySelector) { try { c = stage.querySelector('#' + id); } catch (e2) { c = null; } }
    if (!c && doc && doc.createElement) {
      try {
        c = doc.createElement('canvas');
        c.id = id;
        if (stage && stage.appendChild) stage.appendChild(c);
      } catch (e3) { c = null; }
    }
    return c;
  }

  R.init = function (stage, opts) {
    opts = opts || {};
    var doc = (typeof document !== 'undefined') ? document : null;
    if (!stage && doc && doc.getElementById) { try { stage = doc.getElementById('stage'); } catch (e) { stage = null; } }
    R.stage = stage || null;
    R.bgCanvas = findCanvas('bg', stage);
    R.canvas = findCanvas('game', stage);
    var ctx = null;
    try { ctx = (R.canvas && R.canvas.getContext) ? R.canvas.getContext('2d', { alpha: true }) : null; } catch (e4) { ctx = null; }
    R.ctx = ctx || makeNullCtx();
    R.hasCanvas = !!ctx;
    R.fit();
    if (!opts.headless && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', R.fit);
      window.addEventListener('orientationchange', R.fit);
    }
    R.updateQuality();
    return R.hasCanvas;
  };

  // fit + letterbox: integer backing store in device pixels, fractional CSS scale
  R.fit = function () {
    var vw = 960, vh = 540, dpr = 1;
    try {
      if (typeof window !== 'undefined') {
        vw = window.innerWidth | 0 || 960;
        vh = window.innerHeight | 0 || 540;
        dpr = window.devicePixelRatio || 1;
      }
    } catch (e) { /* headless */ }
    if (!(dpr > 0)) dpr = 1;
    dpr = Math.min(3, Math.max(1, dpr));
    var s = Math.min(vw / W, vh / H);
    if (!(s > 0)) s = 1;
    var px = s * dpr;
    if (W * px > 3840) px = 3840 / W;
    var bw = Math.max(1, Math.round(W * px));
    var bh = Math.max(1, Math.round(H * px));
    var cssW = bw / dpr, cssH = bh / dpr;
    var left = Math.floor((vw - cssW) / 2), top = Math.floor((vh - cssH) / 2);
    R.dpr = dpr;
    R.px = bw / W;
    R.scale = cssW / W;
    R.cssLeft = left;
    R.cssTop = top;
    var cvs = [R.canvas, R.bgCanvas];
    for (var i = 0; i < 2; i++) {
      var c = cvs[i];
      if (!c) continue;
      if (c === R.canvas) {
        if (c.width !== bw) c.width = bw;
        if (c.height !== bh) c.height = bh;
      }
      if (c.style) {
        c.style.width = cssW + 'px';
        c.style.height = cssH + 'px';
        c.style.left = left + 'px';
        c.style.top = top + 'px';
      }
    }
    if (R.stage && R.stage.classList) R.stage.classList.add('fitted');
    AP.call('GL.resize');
    AP.call('TileArt.resize');
    return R.px;
  };

  // client (CSS) pixel -> logical 960x540 coordinates
  var logicalOut = { x: 0, y: 0 };
  R.toLogical = function (cx, cy, out) {
    out = out || logicalOut;
    var left = R.cssLeft, top = R.cssTop;
    if (R.canvas && R.canvas.getBoundingClientRect) {
      try { var r = R.canvas.getBoundingClientRect(); left = r.left; top = r.top; } catch (e) { /* keep cached */ }
    }
    out.x = (cx - left) / (R.scale || 1);
    out.y = (cy - top) / (R.scale || 1);
    return out;
  };

  // logical-unit transform (screen space)
  R.begin = function (ctx) {
    ctx = ctx || R.ctx;
    ctx.setTransform(R.px, 0, 0, R.px, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  // world transform; rx/ry are the camera's device-pixel-snapped render position
  R.worldTransform = function (ctx, rx, ry) {
    var p = R.px;
    ctx.setTransform(p, 0, 0, p, -Math.round(rx * p), -Math.round(ry * p));
  };

  R.snap = function (v) { return Math.round(v * R.px) / R.px; };

  R.beginFrame = function () {
    var ctx = R.ctx;
    R.glowCount = 0;
    R.bgDrawn = false;
    R.flashDrawnFrame = -1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    var cw = (R.canvas && R.canvas.width) || W, ch = (R.canvas && R.canvas.height) || H;
    ctx.clearRect(0, 0, cw, ch);
    R.begin(ctx);
  };

  R.endFrame = function () {
    if (!R.bgDrawn && R.glShowing) {
      AP.call('GL.clear');
      R.glShowing = false;
    }
  };

  R.clear = function (ctx, color) {
    ctx = ctx || R.ctx;
    R.begin(ctx);
    ctx.fillStyle = color || '#000';
    ctx.fillRect(0, 0, W, H);
  };

  // ---- fonts and text ----
  var fontCache = {};
  R.font = function (size, weight, family) {
    var f = family || R.FONT_UI;
    var w = weight || '600';
    var tab = fontCache[f] || (fontCache[f] = {});
    var key = w + '|' + size;
    var s = tab[key];
    if (!s) s = tab[key] = w + ' ' + size + 'px ' + f;
    return s;
  };

  var wrapCache = {};
  var wrapCount = 0;
  function wrapLines(ctx, str, maxW, fontStr) {
    var key = fontStr + '|' + maxW + '|' + str;
    var lines = wrapCache[key];
    if (lines) return lines;
    lines = [];
    var paras = String(str).split('\n');
    for (var p = 0; p < paras.length; p++) {
      var words = paras[p].split(' ');
      var cur = '';
      for (var i = 0; i < words.length; i++) {
        var test = cur ? cur + ' ' + words[i] : words[i];
        if (cur && ctx.measureText(test).width > maxW) {
          lines.push(cur);
          cur = words[i];
        } else {
          cur = test;
        }
      }
      lines.push(cur);
    }
    if (++wrapCount > 300) { wrapCache = {}; wrapCount = 0; }
    wrapCache[key] = lines;
    return lines;
  }

  var EMPTY = {};
  // o: {size=16, color='#fff', align='left', baseline='alphabetic', weight='600', alpha=1, mono=false, maxW (wraps),
  //     lineH (1.3*size), outline (colour), outlineW=3, family}. Returns the number of lines drawn.
  R.text = function (ctx, str, x, y, o) {
    o = o || EMPTY;
    if (str === null || str === undefined) return 0;
    str = String(str);
    var size = o.size || 16;
    var fontStr = R.font(size, o.weight || '600', o.mono ? R.FONT_MONO : (o.family || R.FONT_UI));
    ctx.font = fontStr;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    var pa = ctx.globalAlpha;
    if (o.alpha !== undefined) ctx.globalAlpha = pa * o.alpha;
    ctx.fillStyle = o.color || '#FFFFFF';
    var n = 1;
    if (o.maxW > 0) {
      var lines = wrapLines(ctx, str, o.maxW, fontStr);
      n = lines.length;
      var lh = o.lineH || size * 1.3;
      var y0 = y;
      if (o.baseline === 'middle') y0 = y - (n - 1) * lh / 2;
      else if (o.baseline === 'bottom' || o.baseline === 'alphabetic') y0 = y - (n - 1) * lh * (o.growUp ? 1 : 0);
      for (var i = 0; i < n; i++) {
        if (o.outline) { ctx.lineWidth = o.outlineW || 3; ctx.strokeStyle = o.outline; ctx.strokeText(lines[i], x, y0 + i * lh); }
        ctx.fillText(lines[i], x, y0 + i * lh);
      }
    } else {
      if (o.outline) { ctx.lineWidth = o.outlineW || 3; ctx.strokeStyle = o.outline; ctx.strokeText(str, x, y); }
      ctx.fillText(str, x, y);
    }
    ctx.globalAlpha = pa;
    return n;
  };

  R.measure = function (ctx, str, size, weight, mono) {
    ctx = ctx || R.ctx;
    ctx.font = R.font(size || 16, weight || '600', mono ? R.FONT_MONO : R.FONT_UI);
    var m = ctx.measureText(String(str));
    return (m && m.width) || 0;
  };

  // wrapped line list (cached) for layout code
  R.wrap = function (ctx, str, maxW, size, weight, mono) {
    ctx = ctx || R.ctx;
    var fontStr = R.font(size || 16, weight || '600', mono ? R.FONT_MONO : R.FONT_UI);
    ctx.font = fontStr;
    return wrapLines(ctx, String(str), maxW, fontStr);
  };

  // ---- geometry paths ----
  // Regular polygon path, vertices at rot + i*TAU/sides. Starts a new path unless noBegin. sides >= 32 -> circle.
  R.poly = function (ctx, cx, cy, r, sides, rot, noBegin) {
    if (!noBegin) ctx.beginPath();
    sides = sides | 0;
    if (sides >= 32 || sides < 3) {
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, Math.max(0, r), 0, TAU);
      ctx.closePath();
      return;
    }
    rot = rot || 0;
    var step = TAU / sides;
    ctx.moveTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r);
    for (var i = 1; i < sides; i++) {
      var a = rot + i * step;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  };

  // Star path with `points` tips; first tip at angle rot. Starts a new path unless noBegin.
  R.star = function (ctx, cx, cy, rOut, rIn, points, rot, noBegin) {
    if (!noBegin) ctx.beginPath();
    points = Math.max(2, points | 0);
    rot = rot || 0;
    var step = Math.PI / points;
    ctx.moveTo(cx + Math.cos(rot) * rOut, cy + Math.sin(rot) * rOut);
    for (var i = 1; i < points * 2; i++) {
      var r = (i & 1) ? rIn : rOut;
      var a = rot + i * step;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  };

  R.line = function (ctx, x1, y1, x2, y2, color, w, a) {
    var pa = ctx.globalAlpha;
    if (a !== undefined) ctx.globalAlpha = pa * a;
    ctx.strokeStyle = color || '#FFFFFF';
    ctx.lineWidth = w === undefined ? 2 : w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalAlpha = pa;
  };

  R.additive = function (ctx, fn) {
    var prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    try {
      fn(ctx);
    } finally {
      ctx.globalCompositeOperation = prev;
    }
  };

  // ---- glow sprites (cached radial gradients, additive) ----
  var glowCache = {};
  var glowCacheN = 0;
  var glowBroken = false;
  function glowSprite(color, radius) {
    if (glowBroken) return null;
    var bucket = radius <= 12 ? 12 : radius <= 24 ? 24 : radius <= 48 ? 48 : 96;
    var res = Math.max(8, Math.ceil(bucket * 2 * Math.min(2, Math.max(1, R.px))));
    var key = color + '|' + res;
    var spr = glowCache[key];
    if (spr) return spr;
    try {
      var doc = (typeof document !== 'undefined') ? document : null;
      if (!doc || !doc.createElement) { glowBroken = true; return null; }
      var cv = doc.createElement('canvas');
      cv.width = res;
      cv.height = res;
      var g = cv.getContext && cv.getContext('2d');
      if (!g) { glowBroken = true; return null; }
      var c = res / 2;
      var grad = g.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, AP.Color.rgba(color, 1));
      grad.addColorStop(0.18, AP.Color.rgba(color, 0.55));
      grad.addColorStop(0.45, AP.Color.rgba(color, 0.18));
      grad.addColorStop(1, AP.Color.rgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, res, res);
      if (glowCacheN > 256) { glowCache = {}; glowCacheN = 0; }
      glowCache[key] = cv;
      glowCacheN++;
      return cv;
    } catch (e) {
      glowBroken = true;
      return null;
    }
  }

  R.glow = function (ctx, x, y, radius, color, alpha) {
    if (alpha === undefined) alpha = 1;
    if (!(radius > 0) || !(alpha > 0)) return false;
    if (R.glowCount >= R.GLOW_CAP) return false;
    R.glowCount++;
    var pc = ctx.globalCompositeOperation;
    var pa = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pa * Math.min(1, alpha);
    var spr = glowSprite(color || '#FFFFFF', radius);
    if (spr) {
      ctx.drawImage(spr, x - radius, y - radius, radius * 2, radius * 2);
    } else {
      ctx.fillStyle = AP.Color.rgba(color || '#FFFFFF', 0.25);
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = pc;
    ctx.globalAlpha = pa;
    return true;
  };

  // ---- palettes ----
  R.pal = function (key) {
    if (AP.Worlds && AP.Worlds.pal) return AP.Worlds.pal(key);
    return FALLBACK_PAL;
  };

  // ---- quality + auto-downgrade (particles -> bg -> midground) ----
  R.updateQuality = function () {
    var st = settings();
    var p = st.particles === 'low' ? 0.3 : (st.particles === 'med' ? 0.6 : 1);
    var bg = (st.bg === 'low' || st.bg === 'off') ? st.bg : 'high';
    var d = R.downgradeLevel;
    if (d >= 1) p = p >= 1 ? 0.6 : 0.3;
    if (d >= 2) bg = bg === 'high' ? 'low' : 'off';
    R.quality.particles = p;
    R.quality.bg = bg;
    R.quality.mid = bg !== 'off' && d < 3;
    AP.call('GL.resize');
    return R.quality;
  };

  // explicit user choice resets the automatic downgrade
  R.onSettings = function (key) {
    if (key === '*' || key === 'particles' || key === 'bg') {
      if (key !== '*') R.downgradeLevel = 0;
      R.updateQuality();
    }
  };

  var perfAvg = 16.7, slowT = 0;
  R.perfTick = function (dtRaw) {
    if (AP.headless) return;
    if (!AP.Time || AP.Time.now < 3) return;
    var ms = dtRaw * 1000;
    if (ms > 250) { slowT = 0; return; }
    perfAvg += (ms - perfAvg) * 0.08;
    if (perfAvg > 22) slowT += dtRaw; else slowT = Math.max(0, slowT - dtRaw * 2);
    if (slowT > 3 && R.downgradeLevel < 3) {
      R.downgradeLevel++;
      slowT = 0;
      perfAvg = 16.7;
      R.updateQuality();
      AP.warn('Auto quality downgrade to level', R.downgradeLevel);
    }
  };

  // ---- backgrounds ----
  var bgFailed = {};
  var bgParams = { t: 0, camX: 0, camY: 0, w: W, h: H, intensity: 0.5, beat: 0, phase: 0, pal: null, seed: 0, quality: null };
  R.bgParams = function (key) {
    var p = bgParams;
    p.t = AP.Time ? AP.Time.now : 0;
    p.camX = 0;
    p.camY = 0;
    p.intensity = 0.5;
    p.beat = AP.Beat ? AP.Beat.beat : 0;
    p.phase = AP.Beat ? AP.Beat.phase : 0;
    p.pal = R.pal(key);
    p.seed = AP.hash ? AP.hash(String(key)) : 0;
    p.quality = R.quality;
    return p;
  };

  function bgHas(key) {
    var B = AP.Backgrounds;
    if (!B) return false;
    if (typeof B.has === 'function') {
      try { return !!B.has(key); } catch (e) { return false; }
    }
    return true;
  }

  // GL shader (AP.Backgrounds.render) -> AP.Backgrounds.render2D -> AP.R.bgFallback
  R.drawBackground = function (key, p) {
    var ctx = R.ctx;
    R.bgDrawn = true;
    p = p || R.bgParams(key);
    if (!p.pal) p.pal = R.pal(key);
    if (!p.quality) p.quality = R.quality;
    var q = R.quality;
    var GL = AP.GL;
    if (q.bg !== 'off' && GL && GL.ok && GL.bgReady && !bgFailed[key] && AP.Backgrounds &&
        typeof AP.Backgrounds.render === 'function' && bgHas(key)) {
      if (GL.renderBackground(key, p)) {
        R.glShowing = true;
        R.bgMode = 'gl';
        return 'gl';
      }
      bgFailed[key] = true;
    }
    if (R.glShowing) {
      AP.call('GL.clear');
      R.glShowing = false;
    }
    R.begin(ctx);
    if (q.bg !== 'off' && AP.Backgrounds && typeof AP.Backgrounds.render2D === 'function' && !bgFailed['2d:' + key]) {
      var ok = true;
      try {
        AP.Backgrounds.render2D(ctx, key, p);
      } catch (e) {
        ok = false;
        bgFailed['2d:' + key] = true;
        AP.reportError('Backgrounds.render2D:' + key, e);
      }
      R.begin(ctx);
      if (ok) { R.bgMode = '2d'; return '2d'; }
    }
    R.bgFallback(ctx, key, p);
    R.bgMode = 'fallback';
    return 'fallback';
  };

  // vertical gradient on pal.bg plus a faint 64u grid (parallax 0.5)
  var gradCache = {};
  var gradCtx = null;
  R.bgFallback = function (ctx, key, p) {
    ctx = ctx || R.ctx;
    var pal = (p && p.pal) || R.pal(key);
    R.begin(ctx);
    if (gradCtx !== ctx) { gradCache = {}; gradCtx = ctx; }
    var g = gradCache[pal.bg];
    if (!g) {
      g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, AP.Color.shade(pal.bg, 0.10));
      g.addColorStop(0.55, pal.bg);
      g.addColorStop(1, AP.Color.shade(pal.bg, -0.45));
      gradCache[pal.bg] = g;
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    var cx = (p && p.camX) || 0, cy = (p && p.camY) || 0;
    var ox = -AP.M.mod(cx * 0.5, 64);
    var oy = -AP.M.mod(cy * 0.5, 64);
    ctx.strokeStyle = AP.Color.rgba(pal.primary, 0.055);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = ox; x <= W; x += 64) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (var y = oy; y <= H; y += 64) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // grid nodes pulse gently on the beat
    var ph = AP.Beat ? AP.Beat.phase : 0;
    var a = 0.05 + 0.06 * Math.pow(1 - ph, 3);
    ctx.fillStyle = AP.Color.rgba(pal.accent, a);
    for (var gx = ox; gx <= W; gx += 64) {
      for (var gy = oy; gy <= H; gy += 64) ctx.fillRect(gx - 1, gy - 1, 2, 2);
    }
  };

  // ---- tile fallback: flat tiles in pal.primary, triangular spikes in pal.hazard ----
  var T = AP.TILE;
  function solidLook(c) { return c === T.SOLID || c === T.FAKE || c === T.BREAK; }

  function spikePath(ctx, code, x, y) {
    var i, w3;
    if (code === T.SPIKE_U) {
      w3 = 26 / 3;
      for (i = 0; i < 3; i++) { ctx.moveTo(x + 3 + i * w3, y + 32); ctx.lineTo(x + 3 + i * w3 + w3 / 2, y + 18); ctx.lineTo(x + 3 + (i + 1) * w3, y + 32); }
    } else if (code === T.SPIKE_D) {
      w3 = 26 / 3;
      for (i = 0; i < 3; i++) { ctx.moveTo(x + 3 + i * w3, y); ctx.lineTo(x + 3 + i * w3 + w3 / 2, y + 14); ctx.lineTo(x + 3 + (i + 1) * w3, y); }
    } else if (code === T.SPIKE_L) {
      w3 = 26 / 3;
      for (i = 0; i < 3; i++) { ctx.moveTo(x + 32, y + 3 + i * w3); ctx.lineTo(x + 18, y + 3 + i * w3 + w3 / 2); ctx.lineTo(x + 32, y + 3 + (i + 1) * w3); }
    } else if (code === T.SPIKE_R) {
      w3 = 26 / 3;
      for (i = 0; i < 3; i++) { ctx.moveTo(x, y + 3 + i * w3); ctx.lineTo(x + 14, y + 3 + i * w3 + w3 / 2); ctx.lineTo(x, y + 3 + (i + 1) * w3); }
    }
  }

  R.drawTilesFallback = function (ctx, L, cam) {
    if (!L || !L.tiles) return;
    var pal = L.pal || R.pal(L.style);
    var vx = cam ? cam.x : 0, vy = cam ? cam.y : 0;
    var tx0 = Math.max(0, Math.floor(vx / 32) - 1), ty0 = Math.max(0, Math.floor(vy / 32) - 1);
    var tx1 = Math.min(L.w - 1, Math.floor((vx + W) / 32) + 1), ty1 = Math.min(L.h - 1, Math.floor((vy + H) / 32) + 1);
    var tiles = L.tiles, w = L.w;
    var tx, ty, c, x, y;
    // fills
    ctx.fillStyle = AP.Color.rgba(pal.primary, 0.16);
    ctx.beginPath();
    for (ty = ty0; ty <= ty1; ty++) for (tx = tx0; tx <= tx1; tx++) {
      c = tiles[ty * w + tx];
      if (c === T.SOLID || c === T.FAKE) ctx.rect(tx * 32, ty * 32, 32, 32);
    }
    ctx.fill();
    // exposed edges
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (ty = ty0; ty <= ty1; ty++) for (tx = tx0; tx <= tx1; tx++) {
      c = tiles[ty * w + tx];
      if (!(c === T.SOLID || c === T.FAKE)) continue;
      x = tx * 32; y = ty * 32;
      if (ty > 0 && !solidLook(tiles[(ty - 1) * w + tx])) { ctx.moveTo(x, y + 1); ctx.lineTo(x + 32, y + 1); }
      if (ty < L.h - 1 && !solidLook(tiles[(ty + 1) * w + tx])) { ctx.moveTo(x, y + 31); ctx.lineTo(x + 32, y + 31); }
      if (tx > 0 && !solidLook(tiles[ty * w + tx - 1])) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + 32); }
      if (tx < w - 1 && !solidLook(tiles[ty * w + tx + 1])) { ctx.moveTo(x + 31, y); ctx.lineTo(x + 31, y + 32); }
    }
    ctx.stroke();
    // breakable: inset block with an X crack, clearly different from SOLID
    ctx.beginPath();
    for (ty = ty0; ty <= ty1; ty++) for (tx = tx0; tx <= tx1; tx++) {
      if (tiles[ty * w + tx] !== T.BREAK) continue;
      x = tx * 32; y = ty * 32;
      ctx.rect(x + 3, y + 3, 26, 26);
      ctx.moveTo(x + 7, y + 7); ctx.lineTo(x + 16, y + 14); ctx.lineTo(x + 25, y + 7);
      ctx.moveTo(x + 16, y + 14); ctx.lineTo(x + 14, y + 25);
      ctx.moveTo(x + 16, y + 14); ctx.lineTo(x + 26, y + 22);
    }
    ctx.fillStyle = AP.Color.rgba(pal.accent, 0.10);
    ctx.fill();
    ctx.strokeStyle = AP.Color.rgba(pal.accent, 0.85);
    ctx.lineWidth = 2;
    ctx.stroke();
    // one-way: 8u top bar
    ctx.beginPath();
    for (ty = ty0; ty <= ty1; ty++) for (tx = tx0; tx <= tx1; tx++) {
      if (tiles[ty * w + tx] !== T.ONEWAY) continue;
      ctx.rect(tx * 32, ty * 32, 32, 8);
    }
    ctx.fillStyle = AP.Color.rgba(pal.primary, 0.35);
    ctx.fill();
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 2;
    ctx.stroke();
    // spikes
    ctx.beginPath();
    for (ty = ty0; ty <= ty1; ty++) for (tx = tx0; tx <= tx1; tx++) {
      c = tiles[ty * w + tx];
      if (c >= T.SPIKE_U && c <= T.SPIKE_R) spikePath(ctx, c, tx * 32, ty * 32);
    }
    ctx.fillStyle = AP.Color.rgba(pal.hazard, 0.55);
    ctx.fill();
    ctx.strokeStyle = pal.hazard;
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  // ---- HUD fallback: shards / deaths / time and a plain boss bar ----
  function fmtTime(t) {
    t = Math.max(0, t || 0);
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }
  R.fmtTime = fmtTime;

  var HUD_TXT = { size: 18, color: '#fff', weight: '700' };
  R.hudFallback = function (ctx, L) {
    if (!L) return;
    R.begin(ctx);
    var pal = L.pal || R.pal(L.style);
    var st = settings();
    var minimal = st.hud === 'minimal';
    // form glyph + shards
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = pal.ink;
    R.poly(ctx, 30, 30, 12, L.form >= 32 ? 48 : L.form, -Math.PI / 2 + ((L.form % 2 === 0) ? Math.PI / L.form : 0));
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    R.poly(ctx, 58, 30, 6, 3, -Math.PI / 2);
    ctx.fill();
    HUD_TXT.color = pal.ink; HUD_TXT.align = 'left'; HUD_TXT.baseline = 'middle'; HUD_TXT.size = 18;
    R.text(ctx, L.stats.shards + '/' + L.stats.shardsTotal, 70, 31, HUD_TXT);
    // gems + deaths
    for (var i = 0; i < 3; i++) {
      var gx = 840 + i * 26, gy = 30;
      ctx.beginPath();
      ctx.moveTo(gx, gy - 9); ctx.lineTo(gx + 7, gy); ctx.lineTo(gx, gy + 9); ctx.lineTo(gx - 7, gy); ctx.closePath();
      var have = L.stats.gems[i] || (L.gemOwned && L.gemOwned[i]);
      if (have) { ctx.fillStyle = pal.accent; ctx.fill(); }
      ctx.strokeStyle = AP.Color.rgba(pal.accent, have ? 1 : 0.5);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (!minimal) {
      HUD_TXT.align = 'right';
      R.text(ctx, '×' + L.stats.deaths, 944, 31, HUD_TXT);
    }
    // timer
    if (st.showTimer) {
      HUD_TXT.align = 'right'; HUD_TXT.baseline = 'alphabetic'; HUD_TXT.size = 16;
      R.text(ctx, fmtTime(L.time), 944, 524, HUD_TXT);
    }
    // assist badge
    if (st.assist && st.assist.on) {
      HUD_TXT.align = 'left'; HUD_TXT.baseline = 'alphabetic'; HUD_TXT.size = 13;
      HUD_TXT.color = AP.Color.rgba(pal.accent, 0.8);
      R.text(ctx, 'ASSIST', 16, 524, HUD_TXT);
    }
    // boss bar
    var bi = L.bossInfo;
    if (bi) {
      var bw = 360, bx = (W - bw) / 2, by = 40;
      HUD_TXT.align = 'center'; HUD_TXT.baseline = 'alphabetic'; HUD_TXT.size = 15; HUD_TXT.color = pal.ink;
      R.text(ctx, String(bi.name || 'BOSS').toUpperCase(), W / 2, 32, HUD_TXT);
      ctx.fillStyle = AP.Color.rgba(pal.ink, 0.12);
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = pal.hazard;
      ctx.fillRect(bx, by, bw * AP.M.clamp(bi.frac, 0, 1), 8);
      ctx.strokeStyle = AP.Color.rgba(pal.ink, 0.7);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, bw, 8);
      var ph = bi.phases | 0;
      if (ph > 1) {
        ctx.beginPath();
        for (var k = 1; k < ph; k++) { ctx.moveTo(bx + bw * k / ph, by - 2); ctx.lineTo(bx + bw * k / ph, by + 10); }
        ctx.stroke();
      }
    }
  };

  // ---- screen flash (respects settings.flash) ----
  var flashState = { color: '#FFFFFF', dur: 0.15, alpha: 0, start: -1, lastReduced: -10 };
  R.flash = function (color, dur, alpha) {
    var mode = settings().flash || 'full';
    if (mode === 'off') return false;
    if (dur === undefined) dur = 0.15;
    if (alpha === undefined) alpha = 0.6;
    var now = AP.Time ? AP.Time.now : 0;
    if (mode === 'reduced') {
      if (now - flashState.lastReduced < 0.5) return false;
      flashState.lastReduced = now;
      alpha *= 0.35;
    }
    // keep a stronger flash that is still bright
    if (flashState.start >= 0) {
      var t = (now - flashState.start) / flashState.dur;
      var cur = t < 1 ? flashState.alpha * (1 - t) * (1 - t) : 0;
      if (cur > alpha) return false;
    }
    flashState.color = color || '#FFFFFF';
    flashState.dur = Math.max(0.02, dur);
    flashState.alpha = Math.max(0, Math.min(1, alpha));
    flashState.start = now;
    return true;
  };

  R.renderFlash = function (ctx) {
    ctx = ctx || R.ctx;
    if (flashState.start < 0) return;
    var frame = AP.Time ? AP.Time.frame : 0;
    if (R.flashDrawnFrame === frame) return;
    R.flashDrawnFrame = frame;
    var t = ((AP.Time ? AP.Time.now : 0) - flashState.start) / flashState.dur;
    if (t >= 1) { flashState.start = -1; return; }
    var a = flashState.alpha * (1 - t) * (1 - t);
    R.begin(ctx);
    ctx.globalAlpha = a;
    ctx.fillStyle = flashState.color;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  };

  R.toggleFullscreen = function () {
    try {
      var doc = document;
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      } else {
        var el = R.stage || doc.documentElement;
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  // sides for drawing a form glyph (circle form 99 -> 48 segments)
  R.formSides = function (form) { return form >= 32 ? 48 : (form | 0) || 3; };
  // rotation that puts a flat edge at the bottom of an N-gon
  R.flatRot = function (sides) { return -Math.PI / 2 + ((sides % 2 === 0) ? Math.PI / sides : 0); };

  AP.R = R;
})(window.AP = window.AP || {});
