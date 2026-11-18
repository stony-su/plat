/* tools/lib/stubs-canvas.js — owner: TOOLS */
(function (G) {
  'use strict';
  // Runs INSIDE the harness vm context. Canvas element + CanvasRenderingContext2D + Path2D +
  // DOMMatrix + ImageData + gradients/patterns + OffscreenCanvas. Drawing is a no-op, but the
  // stub validates arguments exactly where a browser throws (negative radii, zero-sized
  // drawImage sources, bad color stops, non-finite gradient coordinates ...) and records
  // suspicious-but-silent cases (NaN coordinates, invalid colors, shadowBlur, ctx.filter,
  // unbalanced save/restore) as issues for the reports.
  G.__AP_STUBS = G.__AP_STUBS || {};
  G.__AP_STUBS.canvas = function installCanvas(S) {
    var DOMException = S.DOMException;
    var issue = S.issue;

    function fin(v) { return typeof v === 'number' ? (v === v && v !== Infinity && v !== -Infinity) : (v = +v, v === v && v !== Infinity && v !== -Infinity); }
    function nonFiniteTypeError(iface, method) {
      return new TypeError("Failed to execute '" + method + "' on '" + iface + "': The provided double value is non-finite.");
    }
    var nanSeen = {};
    function nanCheck(method, args, n) {
      for (var i = 0; i < n; i++) {
        var v = args[i];
        if (typeof v !== 'number') v = +v;
        if (!(v === v && v !== Infinity && v !== -Infinity)) {
          var where = S.callerStack();
          var key = method + '@' + where.split(' | ')[0];
          if (!nanSeen[key]) {
            nanSeen[key] = 1;
            issue('canvas-nan', 'ctx.' + method + ' got a non-finite argument #' + (i + 1) + ' (' + String(args[i]) + '); the browser silently skips the call', 'warn', true);
          }
          return false;
        }
      }
      return true;
    }

    // ---------------------------------------------------------------- colors
    var NAMED = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
      'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen ' +
      'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
      'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia ' +
      'gainsboro ghostwhite gold goldenrod gray grey green greenyellow honeydew hotpink indianred indigo ivory khaki lavender ' +
      'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink ' +
      'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta ' +
      'maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise ' +
      'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
      'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red ' +
      'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow ' +
      'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor').split(' ');
    var namedSet = {};
    for (var ni = 0; ni < NAMED.length; ni++) namedSet[NAMED[ni]] = 1;
    var colorCache = {}, colorCacheN = 0;
    var NUM_TOKEN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(%|deg|rad|grad|turn)?$/i;
    function validColor(c) {
      if (typeof c !== 'string') return false;
      var hit = colorCache[c];
      if (hit !== undefined) return hit;
      var s = c.trim().toLowerCase(), ok = false;
      if (s.charAt(0) === '#') ok = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s);
      else if (namedSet[s]) ok = true;
      else {
        var m = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/.exec(s);
        if (m) {
          var body = m[2].replace(/^\s*(srgb|display-p3|srgb-linear|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)\s+/, '');
          var toks = body.split(/[\s,/]+/).filter(Boolean);
          ok = toks.length >= 3 && toks.length <= 4;
          for (var i = 0; i < toks.length && ok; i++) if (toks[i] !== 'none' && !NUM_TOKEN.test(toks[i])) ok = false;
        }
      }
      if (colorCacheN > 20000) { colorCache = {}; colorCacheN = 0; }
      colorCache[c] = ok; colorCacheN++;
      return ok;
    }
    S.validColor = validColor;

    // ---------------------------------------------------------------- DOMMatrix
    function DOMMatrix(init) {
      var a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
      if (init && init.length === 6) { a = +init[0]; b = +init[1]; c = +init[2]; d = +init[3]; e = +init[4]; f = +init[5]; }
      else if (init && typeof init === 'object' && 'a' in init) { a = init.a; b = init.b; c = init.c; d = init.d; e = init.e; f = init.f; }
      this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
      this.is2D = true;
    }
    Object.defineProperty(DOMMatrix.prototype, 'm11', { get: function () { return this.a; } });
    Object.defineProperty(DOMMatrix.prototype, 'm12', { get: function () { return this.b; } });
    Object.defineProperty(DOMMatrix.prototype, 'm21', { get: function () { return this.c; } });
    Object.defineProperty(DOMMatrix.prototype, 'm22', { get: function () { return this.d; } });
    Object.defineProperty(DOMMatrix.prototype, 'm41', { get: function () { return this.e; } });
    Object.defineProperty(DOMMatrix.prototype, 'm42', { get: function () { return this.f; } });
    Object.defineProperty(DOMMatrix.prototype, 'isIdentity', { get: function () { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0; } });
    DOMMatrix.prototype.multiply = function (o) {
      return new DOMMatrix([this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b, this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d,
        this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f]);
    };
    DOMMatrix.prototype.inverse = function () {
      var det = this.a * this.d - this.b * this.c;
      if (!det) return new DOMMatrix([NaN, NaN, NaN, NaN, NaN, NaN]);
      return new DOMMatrix([this.d / det, -this.b / det, -this.c / det, this.a / det, (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det]);
    };
    DOMMatrix.prototype.translate = function (x, y) { return this.multiply(new DOMMatrix([1, 0, 0, 1, x || 0, y || 0])); };
    DOMMatrix.prototype.scale = function (sx, sy) { if (sy === undefined) sy = sx; return this.multiply(new DOMMatrix([sx, 0, 0, sy, 0, 0])); };
    DOMMatrix.prototype.rotate = function (deg) { var r = (deg || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r); return this.multiply(new DOMMatrix([cs, sn, -sn, cs, 0, 0])); };
    DOMMatrix.prototype.transformPoint = function (p) { p = p || {}; var x = p.x || 0, y = p.y || 0; return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 }; };
    DOMMatrix.prototype.toFloat32Array = function () { return new Float32Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]); };
    G.DOMMatrix = DOMMatrix;
    G.DOMMatrixReadOnly = DOMMatrix;
    G.DOMPoint = function (x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = w === undefined ? 1 : w; };
    G.DOMRect = function (x, y, w, h) { this.x = this.left = x || 0; this.y = this.top = y || 0; this.width = w || 0; this.height = h || 0; this.right = this.x + this.width; this.bottom = this.y + this.height; };

    // ---------------------------------------------------------------- ImageData
    function ImageData(a, b, c) {
      var w, h, data;
      if (a && typeof a === 'object' && a.length !== undefined) { data = a; w = b; h = c === undefined ? data.length / 4 / w : c; }
      else { w = a; h = b; }
      w = w | 0; h = h | 0;
      if (w <= 0 || h <= 0) throw DOMException("Failed to construct 'ImageData': The source width/height is zero.", 'IndexSizeError');
      if (w * h > 16777216) throw new RangeError('ImageData too large in harness (' + w + 'x' + h + ')');
      this.width = w; this.height = h; this.colorSpace = 'srgb';
      this.data = data || new Uint8ClampedArray(w * h * 4);
    }
    G.ImageData = ImageData;

    // ---------------------------------------------------------------- gradients / patterns
    function CanvasGradient(kind) { this._kind = kind; this._stops = 0; }
    CanvasGradient.prototype.addColorStop = function (offset, color) {
      if (arguments.length < 2) throw new TypeError("Failed to execute 'addColorStop' on 'CanvasGradient': 2 arguments required.");
      if (!fin(offset)) throw nonFiniteTypeError('CanvasGradient', 'addColorStop');
      offset = +offset;
      if (offset < 0 || offset > 1) throw DOMException("Failed to execute 'addColorStop' on 'CanvasGradient': The provided value (" + offset + ') is outside the range (0.0, 1.0).', 'IndexSizeError');
      if (!validColor(String(color))) throw DOMException("Failed to execute 'addColorStop' on 'CanvasGradient': The value provided ('" + String(color) + "') could not be parsed as a color.", 'SyntaxError');
      this._stops++;
    };
    G.CanvasGradient = CanvasGradient;
    function CanvasPattern() {}
    CanvasPattern.prototype.setTransform = function () {};
    G.CanvasPattern = CanvasPattern;

    // ---------------------------------------------------------------- Path2D
    function pathOps(target, iface) {
      target.moveTo = function (x, y) { nanCheck('moveTo', arguments, 2); this._n++; };
      target.lineTo = function (x, y) { nanCheck('lineTo', arguments, 2); this._n++; };
      target.closePath = function () {};
      target.bezierCurveTo = function (a, b, c, d, e, f) { nanCheck('bezierCurveTo', arguments, 6); this._n++; };
      target.quadraticCurveTo = function (a, b, c, d) { nanCheck('quadraticCurveTo', arguments, 4); this._n++; };
      target.rect = function (x, y, w, h) { nanCheck('rect', arguments, 4); this._n++; };
      target.arc = function (x, y, r, a0, a1, ccw) {
        if (arguments.length < 5) throw new TypeError("Failed to execute 'arc' on '" + iface + "': 5 arguments required, but only " + arguments.length + ' present.');
        if (fin(r) && r < 0) throw DOMException("Failed to execute 'arc' on '" + iface + "': The radius provided (" + r + ') is negative.', 'IndexSizeError');
        nanCheck('arc', arguments, 5); this._n++;
      };
      target.arcTo = function (x1, y1, x2, y2, r) {
        if (fin(r) && r < 0) throw DOMException("Failed to execute 'arcTo' on '" + iface + "': The radius provided (" + r + ') is negative.', 'IndexSizeError');
        nanCheck('arcTo', arguments, 5); this._n++;
      };
      target.ellipse = function (x, y, rx, ry, rot, a0, a1, ccw) {
        if (arguments.length < 7) throw new TypeError("Failed to execute 'ellipse' on '" + iface + "': 7 arguments required, but only " + arguments.length + ' present.');
        if (fin(rx) && rx < 0) throw DOMException("Failed to execute 'ellipse' on '" + iface + "': The major-axis radius provided (" + rx + ') is negative.', 'IndexSizeError');
        if (fin(ry) && ry < 0) throw DOMException("Failed to execute 'ellipse' on '" + iface + "': The minor-axis radius provided (" + ry + ') is negative.', 'IndexSizeError');
        nanCheck('ellipse', arguments, 7); this._n++;
      };
      target.roundRect = function (x, y, w, h, radii) {
        if (radii !== undefined) {
          var list = (typeof radii === 'number' || (radii && typeof radii === 'object' && radii.length === undefined)) ? [radii] : radii;
          if (!list || list.length < 1 || list.length > 4) throw new RangeError("Failed to execute 'roundRect' on '" + iface + "': " + (list ? list.length : 0) + ' radii provided. Between one and four radii are necessary.');
          for (var i = 0; i < list.length; i++) {
            var r = typeof list[i] === 'number' ? list[i] : (list[i] && list[i].x);
            if (fin(r) && r < 0) throw new RangeError("Failed to execute 'roundRect' on '" + iface + "': Radius value " + r + ' is negative.');
          }
        }
        nanCheck('roundRect', arguments, 4); this._n++;
      };
    }
    function Path2D(src) {
      this._n = 0;
      if (src && typeof src === 'object' && src._n !== undefined) this._n = src._n;
    }
    pathOps(Path2D.prototype, 'Path2D');
    Path2D.prototype.addPath = function (p) {
      if (!(p instanceof Path2D)) throw new TypeError("Failed to execute 'addPath' on 'Path2D': parameter 1 is not of type 'Path2D'.");
      this._n += p._n;
    };
    G.Path2D = Path2D;

    // ---------------------------------------------------------------- 2D context
    var COMPOSITE = ['source-over', 'source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in', 'destination-out',
      'destination-atop', 'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
      'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
    var ALIGN = ['start', 'end', 'left', 'right', 'center'];
    var BASELINE = ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'];
    var CAP = ['butt', 'round', 'square'], JOIN = ['round', 'bevel', 'miter'];

    function defaultState() {
      return {
        fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over',
        lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0, dash: [],
        shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0,
        font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr',
        letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto', fontStretch: 'normal', fontVariantCaps: 'normal', textRendering: 'auto',
        imageSmoothingEnabled: true, imageSmoothingQuality: 'low', filter: 'none',
        m: [1, 0, 0, 1, 0, 0]
      };
    }
    function cloneState(s) {
      var o = {};
      for (var k in s) o[k] = s[k];
      o.dash = s.dash.slice(); o.m = s.m.slice();
      return o;
    }
    function isImageSource(img) {
      return img && (img instanceof S.HTMLCanvasElement || img instanceof G.HTMLImageElement || img instanceof OffscreenCanvas ||
        img instanceof ImageBitmap || (img.tagName === 'VIDEO'));
    }
    function sourceSize(img) {
      if (img instanceof S.HTMLCanvasElement || img instanceof OffscreenCanvas) return [img.width, img.height];
      if (img instanceof ImageBitmap) return [img.width, img.height];
      return [img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0];
    }
    function parseFontPx(font) {
      var m = /(\d+(?:\.\d+)?)px/.exec(font);
      if (m) return +m[1];
      var m2 = /(\d+(?:\.\d+)?)pt/.exec(font);
      return m2 ? +m2[1] * 4 / 3 : 10;
    }

    function CanvasRenderingContext2D(canvas, attrs) {
      Object.defineProperty(this, '__s', { value: { st: defaultState(), stack: [], canvas: canvas, attrs: attrs || {}, frameMax: 0 }, enumerable: false });
    }
    var P = CanvasRenderingContext2D.prototype;
    G.CanvasRenderingContext2D = CanvasRenderingContext2D;
    S.CanvasRenderingContext2D = CanvasRenderingContext2D;
    Object.defineProperty(P, 'canvas', { get: function () { return this.__s.canvas; } });

    function prop(name, setter) {
      Object.defineProperty(P, name, {
        get: function () { var v = this.__s.st[name]; return name === 'dash' ? v.slice() : v; },
        set: function (v) { var st = this.__s.st; var r = setter ? setter.call(this, v, st) : v; if (r !== undefined) st[name] = r; },
        enumerable: true
      });
    }
    function styleSetter(which) {
      return function (v) {
        if (typeof v === 'string') {
          if (validColor(v)) return v;
          issue('canvas-color', 'invalid color assigned to ' + which + ': "' + String(v).slice(0, 60) + '" (ignored by the browser)', 'warn', true);
          return undefined;
        }
        if (v instanceof CanvasGradient || v instanceof CanvasPattern) return v;
        issue('canvas-color', which + ' assigned a non-string/non-gradient value (' + (v === null ? 'null' : typeof v) + '); ignored by the browser', 'warn', true);
        return undefined;
      };
    }
    prop('fillStyle', styleSetter('fillStyle'));
    prop('strokeStyle', styleSetter('strokeStyle'));
    prop('globalAlpha', function (v) { v = +v; if (!(v === v && v !== Infinity && v !== -Infinity)) { issue('canvas-nan', 'globalAlpha set to a non-finite value (ignored by the browser)', 'warn', true); return undefined; } return v < 0 || v > 1 ? undefined : v; });
    prop('globalCompositeOperation', function (v) { if (COMPOSITE.indexOf(v) < 0) { issue('canvas-enum', 'invalid globalCompositeOperation "' + v + '" (ignored)', 'warn', true); return undefined; } return v; });
    prop('lineWidth', function (v) { v = +v; return (v > 0 && v !== Infinity) ? v : undefined; });
    prop('lineCap', function (v) { return CAP.indexOf(v) >= 0 ? v : undefined; });
    prop('lineJoin', function (v) { return JOIN.indexOf(v) >= 0 ? v : undefined; });
    prop('miterLimit', function (v) { v = +v; return v > 0 && v !== Infinity ? v : undefined; });
    prop('lineDashOffset', function (v) { v = +v; return fin(v) ? v : undefined; });
    prop('shadowBlur', function (v) { v = +v; if (v !== 0 && fin(v)) issue('shadowBlur', 'ctx.shadowBlur set to ' + v + ' (banned by CONTRACT §0; use AP.R.glow)', 'error', true); return fin(v) && v >= 0 ? v : undefined; });
    prop('shadowColor', function (v) { return validColor(String(v)) ? v : undefined; });
    prop('shadowOffsetX', function (v) { v = +v; return fin(v) ? v : undefined; });
    prop('shadowOffsetY', function (v) { v = +v; return fin(v) ? v : undefined; });
    prop('font', function (v) { if (!/\d/.test(String(v))) { issue('canvas-font', 'ctx.font "' + v + '" has no size (ignored by the browser)', 'warn', true); return undefined; } return String(v); });
    prop('textAlign', function (v) { return ALIGN.indexOf(v) >= 0 ? v : undefined; });
    prop('textBaseline', function (v) { return BASELINE.indexOf(v) >= 0 ? v : undefined; });
    prop('direction', function (v) { return ['ltr', 'rtl', 'inherit'].indexOf(v) >= 0 ? v : undefined; });
    prop('letterSpacing'); prop('wordSpacing'); prop('fontKerning'); prop('fontStretch'); prop('fontVariantCaps'); prop('textRendering');
    prop('imageSmoothingEnabled', function (v) { return !!v; });
    prop('imageSmoothingQuality', function (v) { return ['low', 'medium', 'high'].indexOf(v) >= 0 ? v : undefined; });
    prop('filter', function (v) { if (String(v) !== 'none') issue('ctx-filter', 'ctx.filter set to "' + v + '" (banned by CONTRACT §0)', 'error', true); return String(v); });

    P.save = function () {
      var s = this.__s;
      s.stack.push(cloneState(s.st));
      if (s.stack.length > s.frameMax) s.frameMax = s.stack.length;
      if (s.stack.length > S.counters.maxSaveDepth) S.counters.maxSaveDepth = s.stack.length;
      if (s.stack.length === 512) issue('canvas-save', 'ctx.save() depth reached 512: save/restore is unbalanced (missing restore)', 'error', true);
    };
    P.restore = function () { var s = this.__s; if (s.stack.length) s.st = s.stack.pop(); };
    P.reset = function () { var s = this.__s; s.st = defaultState(); s.stack.length = 0; };
    P.isContextLost = function () { return false; };
    P.getContextAttributes = function () { return { alpha: this.__s.attrs.alpha !== false, desynchronized: false, colorSpace: 'srgb', willReadFrequently: !!this.__s.attrs.willReadFrequently }; };
    function mul(m, a, b, c, d, e, f) {
      var m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5];
      m[0] = m0 * a + m2 * b; m[1] = m1 * a + m3 * b;
      m[2] = m0 * c + m2 * d; m[3] = m1 * c + m3 * d;
      m[4] = m0 * e + m2 * f + m4; m[5] = m1 * e + m3 * f + m5;
    }
    P.translate = function (x, y) { if (!nanCheck('translate', arguments, 2)) return; mul(this.__s.st.m, 1, 0, 0, 1, +x, +y); };
    P.scale = function (x, y) { if (!nanCheck('scale', arguments, 2)) return; mul(this.__s.st.m, +x, 0, 0, +y, 0, 0); };
    P.rotate = function (a) { if (!nanCheck('rotate', arguments, 1)) return; var c = Math.cos(a), s = Math.sin(a); mul(this.__s.st.m, c, s, -s, c, 0, 0); };
    P.transform = function (a, b, c, d, e, f) { if (!nanCheck('transform', arguments, 6)) return; mul(this.__s.st.m, +a, +b, +c, +d, +e, +f); };
    P.setTransform = function (a, b, c, d, e, f) {
      if (arguments.length === 0) { this.__s.st.m = [1, 0, 0, 1, 0, 0]; return; }
      if (arguments.length === 1 && a && typeof a === 'object') { this.__s.st.m = [num(a.a, 1), num(a.b, 0), num(a.c, 0), num(a.d, 1), num(a.e, 0), num(a.f, 0)]; return; }
      if (!nanCheck('setTransform', arguments, 6)) return;
      this.__s.st.m = [+a, +b, +c, +d, +e, +f];
    };
    function num(v, d) { return typeof v === 'number' ? v : d; }
    P.resetTransform = function () { this.__s.st.m = [1, 0, 0, 1, 0, 0]; };
    P.getTransform = function () { return new DOMMatrix(this.__s.st.m); };

    P.createLinearGradient = function (x0, y0, x1, y1) {
      if (arguments.length < 4) throw new TypeError("Failed to execute 'createLinearGradient' on 'CanvasRenderingContext2D': 4 arguments required.");
      for (var i = 0; i < 4; i++) if (!fin(arguments[i])) throw nonFiniteTypeError('CanvasRenderingContext2D', 'createLinearGradient');
      return new CanvasGradient('linear');
    };
    P.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
      if (arguments.length < 6) throw new TypeError("Failed to execute 'createRadialGradient' on 'CanvasRenderingContext2D': 6 arguments required.");
      for (var i = 0; i < 6; i++) if (!fin(arguments[i])) throw nonFiniteTypeError('CanvasRenderingContext2D', 'createRadialGradient');
      if (r0 < 0 || r1 < 0) throw DOMException("Failed to execute 'createRadialGradient' on 'CanvasRenderingContext2D': The " + (r0 < 0 ? 'r0' : 'r1') + ' provided is less than 0.', 'IndexSizeError');
      return new CanvasGradient('radial');
    };
    P.createConicGradient = function (a, x, y) {
      for (var i = 0; i < 3; i++) if (!fin(arguments[i])) throw nonFiniteTypeError('CanvasRenderingContext2D', 'createConicGradient');
      return new CanvasGradient('conic');
    };
    P.createPattern = function (img, rep) {
      if (!isImageSource(img)) throw new TypeError("Failed to execute 'createPattern' on 'CanvasRenderingContext2D': The provided value is not of type '(CSSImageValue or HTMLCanvasElement or HTMLImageElement or ImageBitmap or OffscreenCanvas or VideoFrame)'.");
      var sz = sourceSize(img);
      if (!sz[0] || !sz[1]) {
        if (img instanceof S.HTMLCanvasElement || img instanceof OffscreenCanvas) throw DOMException("Failed to execute 'createPattern' on 'CanvasRenderingContext2D': The image argument is a canvas element with a width or height of 0.", 'InvalidStateError');
        return null;
      }
      if (rep !== null && rep !== undefined && ['repeat', 'repeat-x', 'repeat-y', 'no-repeat', ''].indexOf(rep) < 0) throw DOMException("Failed to execute 'createPattern' on 'CanvasRenderingContext2D': The provided type ('" + rep + "') is not one of 'repeat', 'no-repeat', 'repeat-x', or 'repeat-y'.", 'SyntaxError');
      return new CanvasPattern();
    };

    P.clearRect = function (x, y, w, h) { if (nanCheck('clearRect', arguments, 4)) S.counters.draw++; };
    P.fillRect = function (x, y, w, h) { if (nanCheck('fillRect', arguments, 4)) S.counters.draw++; };
    P.strokeRect = function (x, y, w, h) { if (nanCheck('strokeRect', arguments, 4)) S.counters.draw++; };
    Object.defineProperty(P, '_n', { get: function () { return 0; }, set: function () {} });
    pathOps(P, 'CanvasRenderingContext2D');
    P.beginPath = function () {};
    P.fill = function (a, b) {
      if (a !== undefined && typeof a === 'object' && !(a instanceof Path2D)) throw new TypeError("Failed to execute 'fill' on 'CanvasRenderingContext2D': parameter 1 is not of type 'Path2D'.");
      if (typeof a === 'string' && a !== 'nonzero' && a !== 'evenodd') throw new TypeError("Failed to execute 'fill': The provided value '" + a + "' is not a valid enum value of type CanvasFillRule.");
      S.counters.draw++;
    };
    P.stroke = function (p) {
      if (p !== undefined && !(p instanceof Path2D)) throw new TypeError("Failed to execute 'stroke' on 'CanvasRenderingContext2D': parameter 1 is not of type 'Path2D'.");
      S.counters.draw++;
    };
    P.clip = function (a) {
      if (a !== undefined && typeof a === 'object' && !(a instanceof Path2D)) throw new TypeError("Failed to execute 'clip' on 'CanvasRenderingContext2D': parameter 1 is not of type 'Path2D'.");
    };
    P.isPointInPath = function () { return false; };
    P.isPointInStroke = function () { return false; };
    P.drawFocusIfNeeded = function () {};
    P.scrollPathIntoView = function () {};
    P.fillText = function (t, x, y, maxW) {
      if (arguments.length < 3) throw new TypeError("Failed to execute 'fillText' on 'CanvasRenderingContext2D': 3 arguments required, but only " + arguments.length + ' present.');
      if (nanCheck('fillText', [x, y], 2)) S.counters.draw++;
    };
    P.strokeText = function (t, x, y, maxW) {
      if (arguments.length < 3) throw new TypeError("Failed to execute 'strokeText' on 'CanvasRenderingContext2D': 3 arguments required, but only " + arguments.length + ' present.');
      if (nanCheck('strokeText', [x, y], 2)) S.counters.draw++;
    };
    P.measureText = function (t) {
      var px = parseFontPx(this.__s.st.font);
      var s = String(t);
      var w = 0;
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        w += c === 32 ? 0.28 : (c >= 48 && c <= 57) ? 0.56 : (c >= 65 && c <= 90) ? 0.64 : (c === 105 || c === 108 || c === 46 || c === 44) ? 0.26 : 0.52;
      }
      w *= px;
      return {
        width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: px * 0.72, actualBoundingBoxDescent: px * 0.2,
        fontBoundingBoxAscent: px * 0.9, fontBoundingBoxDescent: px * 0.25, emHeightAscent: px * 0.8, emHeightDescent: px * 0.2,
        hangingBaseline: px * 0.7, alphabeticBaseline: 0, ideographicBaseline: -px * 0.2
      };
    };
    P.drawImage = function (img) {
      var n = arguments.length;
      if (n !== 3 && n !== 5 && n !== 9) throw new TypeError("Failed to execute 'drawImage' on 'CanvasRenderingContext2D': Valid arities are: [3, 5, 9], but " + n + ' arguments provided.');
      if (!isImageSource(img)) throw new TypeError("Failed to execute 'drawImage' on 'CanvasRenderingContext2D': The provided value is not of type '(CSSImageValue or HTMLCanvasElement or HTMLImageElement or HTMLVideoElement or ImageBitmap or OffscreenCanvas or SVGImageElement or VideoFrame)'.");
      var sz = sourceSize(img);
      if ((img instanceof S.HTMLCanvasElement || img instanceof OffscreenCanvas) && (!sz[0] || !sz[1])) {
        throw DOMException("Failed to execute 'drawImage' on 'CanvasRenderingContext2D': The image argument is a canvas element with a width or height of 0.", 'InvalidStateError');
      }
      if (img === this.__s.canvas) issue('canvas-self', 'drawImage of a canvas onto itself', 'warn', true);
      var args = Array.prototype.slice.call(arguments, 1);
      if (nanCheck('drawImage', args, args.length)) S.counters.draw++;
    };
    P.createImageData = function (a, b) {
      if (a && typeof a === 'object') return new ImageData(a.width, a.height);
      if (!fin(a) || !fin(b)) throw nonFiniteTypeError('CanvasRenderingContext2D', 'createImageData');
      if (!(a | 0) || !(b | 0)) throw DOMException("Failed to execute 'createImageData' on 'CanvasRenderingContext2D': The source " + (!(a | 0) ? 'width' : 'height') + ' is 0.', 'IndexSizeError');
      return new ImageData(Math.abs(a | 0), Math.abs(b | 0));
    };
    P.getImageData = function (x, y, w, h) {
      if (arguments.length < 4) throw new TypeError("Failed to execute 'getImageData' on 'CanvasRenderingContext2D': 4 arguments required.");
      for (var i = 0; i < 4; i++) if (!fin(arguments[i])) throw nonFiniteTypeError('CanvasRenderingContext2D', 'getImageData');
      if (!(w | 0) || !(h | 0)) throw DOMException("Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The source " + (!(w | 0) ? 'width' : 'height') + ' is 0.', 'IndexSizeError');
      S.counters.getImageData = (S.counters.getImageData || 0) + 1;
      return new ImageData(Math.abs(w | 0), Math.abs(h | 0));
    };
    P.putImageData = function (d, x, y) {
      if (!(d instanceof ImageData)) throw new TypeError("Failed to execute 'putImageData' on 'CanvasRenderingContext2D': parameter 1 is not of type 'ImageData'.");
      if (arguments.length < 3) throw new TypeError("Failed to execute 'putImageData': 3 arguments required.");
      S.counters.draw++;
    };
    P.setLineDash = function (seg) {
      if (!seg || typeof seg.length !== 'number') throw new TypeError("Failed to execute 'setLineDash' on 'CanvasRenderingContext2D': The provided value cannot be converted to a sequence.");
      for (var i = 0; i < seg.length; i++) { var v = +seg[i]; if (!(v >= 0) || v === Infinity) return; }
      var arr = Array.prototype.slice.call(seg);
      if (arr.length % 2) arr = arr.concat(arr);
      this.__s.st.dash = arr;
    };
    P.getLineDash = function () { return this.__s.st.dash.slice(); };

    // Harness helpers (non-enumerable): state depth and leak inspection
    S.ctxDepth = function (ctx) { return ctx && ctx.__s ? ctx.__s.stack.length : 0; };
    S.ctxState = function (ctx) { return ctx && ctx.__s ? ctx.__s.st : null; };
    S.ctxResetFrame = function (ctx) { if (ctx && ctx.__s) ctx.__s.frameMax = 0; };

    // ---------------------------------------------------------------- canvas element
    var CP = S.HTMLCanvasElement.prototype;
    function dim(name, key) {
      Object.defineProperty(CP, name, {
        get: function () { return this[key]; },
        set: function (v) {
          v = v >>> 0;
          if (v > 32767) issue('canvas-size', 'canvas ' + name + ' set to ' + v + ' (exceeds browser limits)', 'error', true);
          this[key] = v;
          if (this.__ctx && this.__ctxType === '2d') this.__ctx.reset();
          if (this.__ctx && this.__ctxType === 'webgl' && S.glResize) S.glResize(this.__ctx);
        },
        enumerable: true
      });
    }
    dim('width', '_w'); dim('height', '_h');
    CP.getContext = function (type, attrs) {
      type = String(type);
      var want = type === '2d' ? '2d' : (type === 'webgl' || type === 'experimental-webgl') ? 'webgl' : type === 'webgl2' ? 'webgl2' : type === 'bitmaprenderer' ? 'bitmaprenderer' : null;
      if (!want) return null;
      if (this.__ctxType && this.__ctxType !== want) return null;
      if (this.__ctx) return this.__ctx;
      if (want === '2d') { this.__ctx = new CanvasRenderingContext2D(this, attrs); this.__ctxType = '2d'; return this.__ctx; }
      if (want === 'webgl') {
        if (S.opts.gl === 'null' || !S.createGL) return null;
        this.__ctx = S.createGL(this, attrs || {});
        this.__ctxType = 'webgl';
        return this.__ctx;
      }
      if (want === 'webgl2') { issue('webgl2', 'getContext("webgl2") requested; the contract targets WebGL1 (returned null)', 'warn', true); return null; }
      return null;
    };
    CP.toDataURL = function () { return 'data:image/png;base64,iVBORw0KGgo='; };
    CP.toBlob = function (cb) { var self = this; Promise.resolve().then(function () { S.invoke(cb, self, [new G.Blob([''], { type: 'image/png' })], 'toBlob'); }); };
    CP.captureStream = function () { return null; };
    CP.transferControlToOffscreen = function () { return new OffscreenCanvas(this.width, this.height); };

    // ---------------------------------------------------------------- OffscreenCanvas / ImageBitmap
    function OffscreenCanvas(w, h) {
      this._w = w >>> 0; this._h = h >>> 0; this.__ctx = null; this.__ctxType = null;
      mixin(this);
    }
    function mixin(o) { o.addEventListener = S.EventTargetProto.addEventListener; o.removeEventListener = S.EventTargetProto.removeEventListener; o.dispatchEvent = S.EventTargetProto.dispatchEvent; }
    Object.defineProperty(OffscreenCanvas.prototype, 'width', { get: function () { return this._w; }, set: function (v) { this._w = v >>> 0; if (this.__ctx && this.__ctxType === '2d') this.__ctx.reset(); } });
    Object.defineProperty(OffscreenCanvas.prototype, 'height', { get: function () { return this._h; }, set: function (v) { this._h = v >>> 0; if (this.__ctx && this.__ctxType === '2d') this.__ctx.reset(); } });
    OffscreenCanvas.prototype.getContext = CP.getContext;
    OffscreenCanvas.prototype.convertToBlob = function () { return Promise.resolve(new G.Blob([''])); };
    OffscreenCanvas.prototype.transferToImageBitmap = function () { return new ImageBitmap(this._w, this._h); };
    G.OffscreenCanvas = OffscreenCanvas;
    function ImageBitmap(w, h) { this.width = w; this.height = h; }
    ImageBitmap.prototype.close = function () { this.width = 0; this.height = 0; };
    G.ImageBitmap = ImageBitmap;
    G.createImageBitmap = function (src) {
      var sz = src && isImageSource(src) ? sourceSize(src) : [0, 0];
      if (!sz[0] || !sz[1]) return Promise.reject(DOMException('The source image width or height is 0.', 'InvalidStateError'));
      return Promise.resolve(new ImageBitmap(sz[0], sz[1]));
    };
    return true;
  };
})(globalThis);
