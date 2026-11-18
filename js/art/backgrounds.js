/* js/art/backgrounds.js — owner: ART */
(function (AP) {
  'use strict';

  // AP.Backgrounds: one GLSL ES 1.00 fragment shader per style key (CONTRACT 2.8), compiled lazily
  // and cached per key, plus render2D(): a cheap Canvas2D rendition of every key for GL-off/failed.
  // Shader rules: mediump, uTime wrapped at 3600 s, <= 4 noise octaves, constant loop bounds.

  var KEYS = ['title', 'map', 'w1', 'w2', 'w3', 'w4', 'w5', 'endless', 'void'];
  var WORLD_KEYS = ['w1', 'w2', 'w3', 'w4', 'w5'];
  var TAU = Math.PI * 2;
  var EMPTY = Object.freeze({});
  var ENDLESS_PERIOD = 22;     // seconds per world look in the endless cycle
  var ENDLESS_FADE = 0.22;     // fraction of the period spent crossfading

  function num(v, d) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function frac(v) { return v - Math.floor(v); }
  function util() { return (AP.Art && AP.Art.util) || null; }

  // ------------------------------------------------------------------ colour helpers (kit-independent)
  var vecMemo = Object.create(null);
  function vec3(hex) {
    var v = vecMemo[hex];
    if (v) return v;
    var s = typeof hex === 'string' ? hex.replace('#', '') : '';
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    var r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
    v = vecMemo[hex] = [r === r ? r / 255 : 1, g === g ? g / 255 : 1, b === b ? b / 255 : 1];
    return v;
  }
  function hexOf(v) {
    var o = '#';
    for (var i = 0; i < 3; i++) { var n = Math.round(clamp(v[i], 0, 1) * 255).toString(16); o += n.length < 2 ? '0' + n : n; }
    return o;
  }
  function mixHex(a, b, t) {
    var U = util();
    if (U) return U.mixHex(a, b, t);
    var x = vec3(a), y = vec3(b);
    return hexOf([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  var FALLBACK_PAL = { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' };
  function palFor(key, p) {
    if (p && p.pal && p.pal.bg) return p.pal;
    var W = AP.Worlds;
    if (W && typeof W.pal === 'function') { var q = W.pal(key); if (q && q.bg) return q; }
    var R = AP.R;
    if (R && typeof R.pal === 'function') { var r = R.pal(key); if (r && r.bg) return r; }
    return FALLBACK_PAL;
  }
  function worldPal(key) {
    var W = AP.Worlds;
    if (W && W.styles && W.styles[key]) return W.styles[key];
    if (W && typeof W.pal === 'function') return W.pal(key) || FALLBACK_PAL;
    return FALLBACK_PAL;
  }

  // endless cycle shared with AP.Midground: look a -> b with crossfade m
  function endlessMix(t, out) {
    out = out || { a: 0, b: 1, m: 0 };
    var cyc = num(t, 0) / ENDLESS_PERIOD, k = Math.floor(cyc), f = cyc - k;
    out.a = ((k % 5) + 5) % 5;
    out.b = (out.a + 1) % 5;
    out.m = f < 1 - ENDLESS_FADE ? 0 : smooth((f - (1 - ENDLESS_FADE)) / ENDLESS_FADE);
    return out;
  }

  // ------------------------------------------------------------------ GLSL sources
  var VS = [
    'attribute vec2 aPos;',
    'void main() {',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var HEAD = [
    'precision mediump float;',
    'uniform vec2 uRes;',
    'uniform vec2 uView;',
    'uniform float uTime;',
    'uniform vec2 uCam;',
    'uniform float uInt;',
    'uniform float uBeat;',
    'uniform float uPhase;',
    'uniform float uSeed;',
    'uniform float uQ;',
    'uniform vec3 uBg;',
    'uniform vec3 uPri;',
    'uniform vec3 uAcc;',
    'uniform vec3 uHaz;',
    'uniform vec3 uInk;',
    ''
  ].join('\n');

  var HEAD_ENDLESS = [
    'uniform vec3 uPri2;',
    'uniform vec3 uAcc2;',
    'uniform vec3 uLook;',
    ''
  ].join('\n');

  var COMMON = `
#define TAU 6.283185307
#define PI 3.141592654
vec3 gPri;
vec3 gAcc;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash22(i) * 2.0 - 1.0, f);
  float b = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.5;
}
const mat2 OCT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm4(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * gnoise(p);
    p = OCT * p + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s;
}
float vfbm2(vec2 p) {
  return 0.5 * (vnoise(p) * 2.0 - 1.0) + 0.25 * (vnoise(OCT * p + vec2(3.1, 1.7)) * 2.0 - 1.0);
}
float vfbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * (vnoise(p) * 2.0 - 1.0);
    p = OCT * p + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s;
}
mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}
float lineAA(float d, float w, float aa) {
  return 1.0 - smoothstep(w - aa, w + aa, d);
}
vec2 viewPos() {
  vec2 uv = gl_FragCoord.xy / uRes;
  return vec2(uv.x * uView.x, (1.0 - uv.y) * uView.y);
}
float pxSize() {
  return uView.x / uRes.x;
}
float starField(vec2 p, float cell, float seed, float density) {
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 h = hash22(id + seed);
  float b = hash12(id + seed + 17.31);
  vec2 dv = (f - 0.15 - 0.7 * h) * cell;
  float sz = 0.5 + 1.4 * b * b;
  float tw = 0.55 + 0.45 * sin(uTime * (0.4 + 1.6 * b) + b * 43.0);
  return exp(-dot(dv, dv) / (sz * sz)) * tw * step(1.0 - density, b);
}
vec3 finish(vec3 col, vec2 p) {
  vec2 q = p / uView - 0.5;
  float vig = clamp(1.0 - dot(q, q) * 1.15, 0.0, 1.0);
  col *= mix(0.66, 1.0, vig);
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * (1.5 / 255.0);
  return clamp(col, 0.0, 1.0);
}
`;

  // ---- title: nested polygons morphing 3 -> 4 -> 5 -> 6 -> circle, infinitely zooming, + field of points
  var G_TITLE = `
float polyEdge(vec2 d, float n, float r, float a) {
  float seg = TAU / n;
  float th = atan(d.y, d.x) - a;
  float f = mod(th, seg) - 0.5 * seg;
  return length(d) * cos(f) - r * cos(0.5 * seg);
}
float shapeEdge(vec2 d, float k, float r, float a) {
  if (k > 3.5) {
    return length(d) - r * 0.93;
  }
  return polyEdge(d, k + 3.0, r, a);
}
float vertexGlow(vec2 d, float k, float r, float a) {
  if (k > 3.5) {
    return 0.0;
  }
  float seg = TAU / (k + 3.0);
  float th = atan(d.y, d.x) - a;
  float va = a + floor(th / seg + 0.5) * seg;
  vec2 dv = d - vec2(cos(va), sin(va)) * r;
  float s = 0.9 + r * 0.006;
  return exp(-dot(dv, dv) / (s * s));
}
vec3 lookTitle(vec2 p) {
  float aa = pxSize();
  vec2 c = uView * 0.5 + vec2(sin(uTime * 0.07), cos(uTime * 0.05)) * 6.0;
  vec2 d = p - c;
  float rho = length(d) + 0.001;
  vec3 col = uBg + gPri * 0.05 * exp(-rho / 260.0);
  vec2 sp = rot2(uTime * 0.006) * d;
  float stars = starField(sp, 26.0, 3.7 + uSeed * 31.0, 0.5) + 0.6 * starField(sp + vec2(400.0, 170.0), 14.0, 11.3, 0.3);
  col += mix(uInk, gPri, 0.4) * stars * 0.7;
  float sch = uTime / 9.0;
  float k0 = mod(floor(sch), 5.0);
  float k1 = mod(k0 + 1.0, 5.0);
  float fm = smoothstep(0.55, 1.0, fract(sch));
  float zz = uTime * 0.03;
  float zoom = fract(zz);
  float zi = floor(zz);
  float u = log(rho / 320.0) / log(0.8) + zoom;
  float base = floor(u);
  float ln = 0.0;
  float gold = 0.0;
  float glo = 0.0;
  float vtx = 0.0;
  for (int j = 0; j < 5; j++) {
    float kk = base + 1.0 - float(j);
    float R = 320.0 * pow(0.8, kk - zoom);
    float ang = (kk - zoom) * 0.2 + uTime * 0.02;
    float e = abs(mix(shapeEdge(d, k0, R, ang), shapeEdge(d, k1, R, ang), fm));
    float fade = smoothstep(5.0, 36.0, R) * (1.0 - smoothstep(620.0, 1000.0, R));
    float isGold = step(4.5, mod(kk + zi, 5.0));
    float l = lineAA(e, 0.5 + R * 0.0015, aa) * fade;
    ln += l * (1.0 - isGold);
    gold += l * isGold;
    glo += exp(-e / (2.5 + R * 0.012)) * fade;
    vtx += (vertexGlow(d, k0, R, ang) * (1.0 - fm) + vertexGlow(d, k1, R, ang) * fm) * fade;
  }
  float br = (0.45 + 0.55 * smoothstep(30.0, 200.0, rho)) * (1.0 + 0.3 * uBeat);
  col += gPri * glo * 0.03 * br;
  col += gPri * ln * 0.4 * br;
  col += gAcc * gold * 0.5 * br;
  col += gAcc * vtx * 0.55 * br;
  col += mix(gPri, uInk, 0.6) * exp(-rho / 9.0) * 0.6;
  return col;
}
`;

  // ---- map: calm constellation over a triangular lattice and a faint nebula
  var G_MAP = `
vec2 conPt(vec2 id) {
  return id + 0.18 + 0.64 * hash22(id + 5.1 + uSeed * 19.0);
}
vec3 lookMap(vec2 p) {
  float aa = pxSize();
  vec3 col = uBg;
  vec2 np = (p + uCam * 0.04) / 420.0 + vec2(uSeed * 7.0, 0.0);
  float neb = vfbm3(np + vec2(uTime * 0.006, -uTime * 0.004));
  float neb2 = vnoise(np * 1.9 + vec2(4.2, 1.1) - vec2(0.0, uTime * 0.005));
  col += gPri * 0.05 * smoothstep(-0.15, 0.5, neb);
  col += gAcc * 0.024 * smoothstep(0.4, 0.85, neb2) * smoothstep(-0.3, 0.3, neb);
  vec2 lp = p + uCam * 0.07;
  float tri = 0.0;
  for (int i = 0; i < 3; i++) {
    float a = float(i) * (PI / 3.0) + PI * 0.5;
    float v = dot(lp, vec2(cos(a), sin(a))) / 90.0;
    float dd = (0.5 - abs(fract(v) - 0.5)) * 90.0;
    tri = max(tri, lineAA(dd, 0.45, aa));
  }
  col += gPri * tri * 0.045;
  float cs = 124.0;
  vec2 cp = (p + uCam * 0.16) / cs;
  vec2 id = floor(cp);
  vec2 a = conPt(id);
  vec2 pxp = conPt(id + vec2(1.0, 0.0));
  vec2 pxm = conPt(id - vec2(1.0, 0.0));
  vec2 pyp = conPt(id + vec2(0.0, 1.0));
  vec2 pym = conPt(id - vec2(0.0, 1.0));
  vec2 pdp = conPt(id + vec2(1.0, 1.0));
  vec2 pdm = conPt(id - vec2(1.0, 1.0));
  float hc = hash12(id + 9.7);
  float hl = hash12(id - vec2(1.0, 0.0) + 9.7);
  float hu = hash12(id - vec2(0.0, 1.0) + 9.7);
  float hd = hash12(id - vec2(1.0, 1.0) + 9.7);
  float ld = 100.0;
  if (hc < 0.55) {
    ld = min(ld, sdSeg(cp, a, pxp));
  }
  if (hl < 0.55) {
    ld = min(ld, sdSeg(cp, pxm, a));
  }
  if (fract(hc * 7.31) < 0.42) {
    ld = min(ld, sdSeg(cp, a, pyp));
  }
  if (fract(hu * 7.31) < 0.42) {
    ld = min(ld, sdSeg(cp, pym, a));
  }
  if (fract(hc * 13.7) < 0.16) {
    ld = min(ld, sdSeg(cp, a, pdp));
  }
  if (fract(hd * 13.7) < 0.16) {
    ld = min(ld, sdSeg(cp, pdm, a));
  }
  if (fract(hl * 13.7) < 0.16) {
    ld = min(ld, sdSeg(cp, pxm, pyp));
  }
  if (fract(hu * 13.7) < 0.16) {
    ld = min(ld, sdSeg(cp, pym, pxp));
  }
  vec2 dv = (cp - a) * cs;
  float b = hash12(id + 2.3);
  float tw = 0.6 + 0.4 * sin(uTime * (0.3 + 0.9 * b) + b * 20.0);
  float r2 = dot(dv, dv);
  float sb = (exp(-r2 / (1.2 + 3.5 * b)) + 0.16 * exp(-sqrt(r2) / (2.5 + 4.0 * b))) * tw;
  col += gPri * lineAA(ld * cs, 0.55, aa) * 0.17;
  col += mix(uInk, gAcc, 0.3) * sb * 0.6;
  col += uInk * starField(p + uCam * 0.3, 17.0, 23.0 + uSeed * 5.0, 0.25) * 0.35;
  col *= 1.0 + 0.06 * uBeat;
  return col;
}
`;

  // ---- w1: multi-scale Truchet quarter-arcs on three drifting grids, with gold pulses flowing along curves
  var G_W1 = `
float truchetD(vec2 g, float seed, out float prog) {
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id + seed);
  float par = mod(id.x + id.y, 2.0) < 0.5 ? 1.0 : -1.0;
  if (h > 0.5) {
    f.x = 1.0 - f.x;
  }
  vec2 r0 = f;
  vec2 r1 = f - 1.0;
  float d0 = abs(length(r0) - 0.5);
  float d1 = abs(length(r1) - 0.5);
  float s = 0.0;
  float d = 0.0;
  if (d0 < d1) {
    d = d0;
    s = atan(r0.y, r0.x) / (0.5 * PI);
  } else {
    d = d1;
    s = (atan(r1.y, r1.x) + PI) / (0.5 * PI);
  }
  prog = par > 0.0 ? s : 1.0 - s;
  return d;
}
vec3 truchetLayer(vec2 p, float cell, vec2 drift, float par, float seed, float w, float aa, float speed) {
  vec2 q = (p + uCam * par + uTime * drift) / cell;
  float prog = 0.0;
  float d = truchetD(q, seed, prog) * cell;
  float l = lineAA(d, w, aa);
  float glo = exp(-d * d / (w * w * 18.0));
  float ph = fract(prog - uTime * speed + vnoise(q * 0.23 + seed) * 3.0);
  float head = ph * ph * ph * ph;
  head *= head;
  head *= head;
  return vec3(l, glo, head * (l + glo * 0.6));
}
vec3 lookW1(vec2 p) {
  float aa = pxSize();
  vec3 col = uBg * (1.0 + 0.22 * smoothstep(uView.y, 0.0, p.y));
  vec2 gp = p + uCam * 0.03;
  vec2 gd = (0.5 - abs(fract(gp / 40.0) - 0.5)) * 40.0;
  vec2 gd2 = (0.5 - abs(fract(gp / 200.0) - 0.5)) * 200.0;
  col += gPri * (lineAA(min(gd.x, gd.y), 0.4, aa) * 0.022 + lineAA(min(gd2.x, gd2.y), 0.5, aa) * 0.04);
  float s = uSeed * 57.0;
  float spd = 0.2 + 0.45 * uInt;
  if (uQ > 0.5) {
    vec3 L1 = truchetLayer(p, 172.0, vec2(3.0, 1.2), 0.05, s + 1.0, 0.85, aa, spd * 0.6);
    col += mix(uBg, gPri, 0.5) * (L1.x * 0.16 + L1.y * 0.03);
  }
  vec3 L2 = truchetLayer(p, 106.0, vec2(-4.5, 2.0), 0.11, s + 2.0, 1.05, aa, spd);
  vec3 L3 = truchetLayer(p, 64.0, vec2(6.0, -2.4), 0.2, s + 3.0, 1.25, aa, spd * 1.3);
  float m3 = smoothstep(0.32, 0.72, vnoise(p / 300.0 + uCam * 0.0007 + vec2(uTime * 0.02, 0.0)));
  float mp = smoothstep(0.45, 0.8, vnoise(p / 230.0 + vec2(0.0, uTime * 0.03))) * (0.7 + 0.9 * uInt);
  col += gPri * (L2.x * 0.24 + L2.y * 0.04);
  col += gPri * (L3.x * 0.32 + L3.y * 0.055) * m3;
  col += gAcc * (L2.z * 0.7 + L3.z * m3 * 0.85) * mp;
  col *= 1.0 + 0.12 * uBeat;
  col += uHaz * 0.06 * uInt * smoothstep(0.25, 0.75, length(p / uView - 0.5));
  return col;
}
`;

  // ---- w2: animated Worley crystals: bright facet edges, faceted interiors, cyan junction glints
  var G_W2 = `
vec3 worley(vec2 g, float seed, float t, out vec2 nid, out vec2 nv) {
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec3 F = vec3(9.0);
  nid = id;
  nv = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = hash22(id + o + seed);
      vec2 pt = o + 0.5 + 0.34 * sin(t * (0.3 + 0.4 * h) + TAU * h);
      vec2 r = pt - f;
      float dd = dot(r, r);
      if (dd < F.x) {
        F = vec3(dd, F.x, F.y);
        nid = id + o;
        nv = r;
      } else if (dd < F.y) {
        F = vec3(F.x, dd, F.y);
      } else if (dd < F.z) {
        F.z = dd;
      }
    }
  }
  return sqrt(F);
}
float worleyEdge(vec2 g, float seed, float t) {
  vec2 id = floor(g);
  vec2 f = fract(g);
  float f1 = 9.0;
  float f2 = 9.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = hash22(id + o + seed);
      vec2 r = o + 0.5 + 0.34 * sin(t * (0.3 + 0.4 * h) + TAU * h) - f;
      float dd = dot(r, r);
      f2 = min(f2, max(dd, f1));
      f1 = min(f1, dd);
    }
  }
  return sqrt(f2) - sqrt(f1);
}
vec4 crystal(vec2 p, float cell, float seed, float t, float aa) {
  vec2 nid = vec2(0.0);
  vec2 nv = vec2(0.0);
  vec3 F = worley(p / cell, seed, t, nid, nv);
  float edgeD = (F.y - F.x) * cell;
  float edge = lineAA(edgeD, 0.9, aa) + 0.35 * exp(-edgeD / 5.0);
  vec2 v = -nv;
  float hc = hash12(nid + seed + 3.3);
  float nf = 5.0 + floor(hc * 3.0);
  float rot = hc * TAU;
  float a = atan(v.y, v.x) + rot;
  float seg = TAU / nf;
  float fi = floor(a / seg);
  float fa = (fi + 0.5) * seg - rot;
  float shade = 0.5 + 0.5 * cos(fa - (t * 0.13 + 0.8));
  shade *= 0.55 + 0.45 * hash12(nid + fi * 7.13 + seed);
  float fl = (0.5 - abs(fract(a / seg) - 0.5)) * seg;
  float ridge = lineAA(length(v) * sin(fl) * cell, 0.5, aa) * smoothstep(0.02, 0.2, F.x);
  float junction = exp(-(F.z - F.x) * 14.0);
  return vec4(edge, shade * (0.6 + 0.4 * smoothstep(0.0, 0.6, F.x)), ridge, junction);
}
vec3 lookW2(vec2 p) {
  float aa = pxSize();
  float t = uTime * (1.0 + 0.8 * uInt);
  float s = uSeed * 41.0;
  vec3 col = uBg * (0.85 + 0.3 * smoothstep(uView.y, 0.0, p.y));
  if (uQ > 0.5) {
    float ea = worleyEdge((p + uCam * 0.05) / 190.0, s + 1.0, t * 0.6) * 190.0;
    col += mix(uBg, gPri, 0.5) * ((lineAA(ea, 0.9, aa) + 0.35 * exp(-ea / 5.0)) * 0.10 + 0.02);
  }
  vec4 B = crystal(p + uCam * 0.13 + vec2(37.0, 11.0), 104.0, s + 2.0, t, aa);
  col += gPri * (B.y * 0.075 + B.z * 0.06);
  col += gPri * B.x * 0.30 * (1.0 + 0.25 * uBeat);
  col += gAcc * B.w * (0.35 + 0.25 * sin(uTime * 2.0 + B.y * 9.0)) * 0.6;
  float shaft = smoothstep(0.55, 1.0, vnoise(vec2((p.x + p.y * 0.35 + uCam.x * 0.02) / 140.0, uTime * 0.05)));
  col += gAcc * shaft * 0.025 * smoothstep(uView.y, 0.0, p.y);
  col += uHaz * 0.05 * uInt * B.x;
  return col;
}
`;

  // ---- w3: domain-warped flow noise with long anisotropic streaks
  var G_W3 = `
vec3 lookW3(vec2 p) {
  float t = uTime * (1.0 + 0.6 * uInt);
  vec2 sp = (p + uCam * 0.06) / 340.0 + vec2(uSeed * 13.0, uSeed * 7.0);
  vec2 q = vec2(vnoise(sp * 0.8 + vec2(t * 0.012, 0.0)), vnoise(sp * 0.8 + vec2(5.2, 1.3) - vec2(0.0, t * 0.01))) * 1.6 - 0.8;
  vec2 r = 1.15 * vec2(vfbm2(sp + 2.4 * q + vec2(1.7, 9.2) + vec2(t * 0.018, 0.0)), vfbm2(sp + 2.4 * q + vec2(8.3, 2.8) - vec2(t * 0.012, 0.0)));
  float f = 1.1 * vfbm3(sp + 2.0 * r + vec2(t * 0.01, 0.0));
  float dens = clamp(f * 1.3 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBg, mix(uBg, gPri, 0.34), dens * dens * 0.6);
  col += gPri * 0.04 * clamp(length(r) * 2.0, 0.0, 1.0);
  vec2 w1 = (p + uCam * 0.12) / vec2(560.0, 30.0) + vec2(r.x * 1.3, (r.y + q.y) * 7.0);
  float sk = gnoise(vec2(w1.x - t * 0.32, w1.y));
  float streak = 1.0 - min(abs(sk) * 3.2, 1.0);
  streak = streak * streak * streak;
  streak *= streak;
  float dash = smoothstep(0.32, 0.78, vnoise(vec2(w1.x * 2.2 - t * 0.9, w1.y * 0.6 + 3.1)));
  col += gPri * streak * dash * 0.2;
  col += gAcc * streak * dash * smoothstep(0.45, 0.85, dens) * 0.18;
  if (uQ > 0.5) {
    vec2 w2 = (p + uCam * 0.2) / vec2(300.0, 13.0) + vec2(r.x * 2.0, r.y * 13.0);
    float sk2 = gnoise(vec2(w2.x - t * 0.55, w2.y));
    float st2 = 1.0 - min(abs(sk2) * 4.0, 1.0);
    st2 = st2 * st2 * st2 * st2;
    st2 *= smoothstep(0.3, 0.82, vnoise(vec2(w2.x * 1.7 - t, w2.y * 0.5)));
    col += mix(gPri, uInk, 0.3) * st2 * 0.11;
  }
  col *= 1.0 + 0.1 * uBeat;
  col += uHaz * 0.05 * uInt * dens;
  return col;
}
`;

  // ---- w4: breathing Julia filaments with blossom traps, a kaleidoscopic IFS lattice and leaf veins
  var G_W4 = `
float kifs(vec2 p, float t) {
  float d = 100.0;
  float s = 1.0;
  for (int i = 0; i < 4; i++) {
    p = abs(p) - vec2(0.34, 0.16);
    p = rot2(0.55 + 0.07 * sin(t * 0.06 + float(i) * 1.3)) * p;
    p *= 1.48;
    s *= 1.48;
    d = min(d, abs(p.y) / s);
  }
  return d;
}
float veins(vec2 p, float aa) {
  vec2 g = p / vec2(400.0, 280.0);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash12(id + 7.7 + uSeed * 3.0);
  f = rot2((h - 0.5) * 1.3 + 0.3) * f;
  float x = f.x / 0.86 + 0.5;
  float ax = step(0.0, x) * step(x, 1.0);
  float wdt = 0.24 * sin(PI * clamp(x, 0.0, 1.0));
  float inside = (1.0 - smoothstep(-0.012, 0.012, abs(f.y) - wdt)) * ax;
  float mid = abs(f.y) * 400.0;
  float sv = (0.5 - abs(fract(x * 6.0 - abs(f.y) * 5.0) - 0.5)) / 6.0 * 400.0;
  float outline = abs(abs(f.y) - wdt) * 400.0;
  float l = max(lineAA(mid, 0.8, aa), lineAA(sv, 0.5, aa) * 0.6) * inside;
  l = max(l, lineAA(outline, 0.6, aa) * ax * 0.8);
  return l * step(0.42, h);
}
vec3 lookW4(vec2 p) {
  float aa = pxSize();
  float t = uTime;
  vec3 col = uBg * (1.0 + 0.2 * smoothstep(uView.y, 0.0, p.y));
  vec2 kq = fract((p + uCam * 0.05) / 250.0) - 0.5;
  float kd = kifs(kq, t) * 250.0;
  col += mix(uBg, gPri, 0.45) * (lineAA(kd, 0.55, aa) * 0.10 + exp(-kd / 7.0) * 0.035);
  col += gPri * veins(p + uCam * 0.1, aa) * 0.07;
  float zb = 1.0 + 0.05 * sin(t * 0.23) + 0.025 * uBeat;
  float span = 3.1 / (uView.x * zb);
  float ang = uCam.x * 0.00022 + sin(t * 0.017) * 0.35;
  vec2 z = rot2(ang) * (p - uView * 0.5 + vec2(0.0, uCam.y * 0.015)) * span;
  vec2 c = vec2(-0.7017, -0.3842) + 0.03 * vec2(cos(t * 0.09), sin(t * 0.11)) + uInt * 0.025 * vec2(sin(t * 0.6), cos(t * 0.45));
  vec2 dz = vec2(1.0, 0.0);
  float trap = 10.0;
  float bloom = 10.0;
  float m2 = dot(z, z);
  for (int i = 0; i < 26; i++) {
    dz = 2.0 * vec2(z.x * dz.x - z.y * dz.y, z.x * dz.y + z.y * dz.x);
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    m2 = dot(z, z);
    trap = min(trap, min(abs(z.x + 0.1), abs(z.y)));
    bloom = min(bloom, length(z - vec2(0.24, -0.18)));
    if (m2 > 256.0) {
      break;
    }
  }
  float zl = sqrt(m2);
  float de = 0.5 * zl * log(max(zl, 1.0001)) / max(length(dz), 0.0001);
  float dpx = de / span;
  float esc = step(256.0, m2);
  float edge = exp(-dpx / 1.8) * esc + (1.0 - esc) * 0.35;
  float halo = exp(-dpx / 24.0) * esc + (1.0 - esc) * 0.5;
  col += gPri * (edge * 0.32 + halo * 0.06);
  col += mix(gPri, uInk, 0.35) * exp(-trap * 55.0) * 0.12 * (0.4 + 0.6 * halo);
  col += gAcc * exp(-bloom * 18.0) * 0.32 * (0.3 + 0.7 * halo);
  col *= 1.0 + 0.1 * uBeat;
  col += uHaz * 0.05 * uInt * halo;
  return col;
}
`;

  // ---- w5: interference of moving wave sources (point + plane waves) and a phyllotaxis sunflower
  var G_W5 = `
float phylloField(vec2 p, vec2 c, float sc, float n, float rotA, float t, out float glow) {
  glow = 0.0;
  vec2 d = p - c;
  float r = length(d);
  if (r > sc * sqrt(n) + 16.0) {
    return 0.0;
  }
  float i0 = (r / sc) * (r / sc);
  float b0 = floor(i0) - 15.0;
  float acc = 0.0;
  for (int j = 0; j < 30; j++) {
    float i = b0 + float(j);
    if (i < 1.0 || i > n) {
      continue;
    }
    float th = i * 2.39996323 + rotA;
    vec2 pos = sc * sqrt(i) * vec2(cos(th), sin(th));
    float dd = length(d - pos);
    float wv = 0.5 + 0.5 * cos(i * 0.21 - t * 1.7);
    wv = wv * wv * wv;
    float rad = 1.0 + 1.1 * wv + 0.5 * uBeat;
    acc += lineAA(dd, rad, 0.75) * (0.35 + 0.65 * wv);
    glow += exp(-dd * dd / 28.0) * wv;
  }
  return acc;
}
float waveField(vec2 p, float t) {
  vec2 c0 = uView * 0.5;
  vec2 s1 = c0 + vec2(sin(t * 0.071) * 330.0, sin(t * 0.053 + 1.0) * 170.0);
  vec2 s2 = c0 + vec2(sin(t * 0.047 + 2.1) * 360.0, sin(t * 0.083 + 0.4) * 190.0);
  vec2 s3 = c0 + vec2(sin(t * 0.061 + 4.2) * 300.0, sin(t * 0.039 + 2.6) * 200.0);
  vec2 pp = p + uCam * 0.09;
  float s = cos(length(p - s1) * 0.052 - t * 1.3);
  s += cos(length(p - s2) * 0.047 - t * 1.1 + 1.7);
  s += 0.8 * cos(length(p - s3) * 0.06 - t * 1.6 + 0.6);
  s += 0.7 * cos(dot(pp, vec2(0.031, 0.012)) - t * 0.9);
  s += 0.6 * cos(dot(pp, vec2(-0.017, 0.029)) - t * 0.7 + 2.0);
  return s / 4.1;
}
vec3 lookW5(vec2 p) {
  float t = uTime * (1.0 + 0.5 * uInt);
  vec3 col = uBg;
  float v = waveField(p, t);
  float band = smoothstep(0.2, 1.0, v);
  float iso = 0.5 - abs(fract(v * 3.0 + 0.5) - 0.5);
  float lines = 1.0 - smoothstep(0.025, 0.06, iso);
  col += gPri * band * band * 0.10;
  col += gPri * lines * (0.025 + 0.04 * clamp(v + 0.5, 0.0, 1.0));
  float crest = clamp(v, 0.0, 1.0);
  crest = crest * crest * crest;
  crest *= crest;
  col += gAcc * crest * 0.2;
  vec2 pc = vec2(mod(uView.x * 0.74 - uCam.x * 0.1, uView.x + 640.0) - 320.0, mod(uView.y * 0.4 - uCam.y * 0.1, uView.y + 460.0) - 230.0);
  pc += vec2(sin(t * 0.05), cos(t * 0.04)) * 18.0;
  float glow = 0.0;
  float dots = phylloField(p, pc, 10.0, 250.0, t * 0.035, t, glow);
  col += mix(gAcc, uInk, 0.35) * dots * 0.5 + gAcc * glow * 0.045;
  col += uHaz * 0.07 * uInt * band;
  col *= 1.0 + 0.1 * uBeat;
  return col;
}
`;

  // ---- void: the w5 field lensed around a black singularity with a photon ring
  var G_VOID = `
vec3 lookVoid(vec2 p) {
  vec2 c = uView * 0.5 + vec2(sin(uTime * 0.13) * 14.0, cos(uTime * 0.09) * 9.0);
  vec2 d = p - c;
  float r = length(d) + 0.001;
  float Rh = 44.0 + 26.0 * uInt + 5.0 * uBeat;
  float Re = Rh * 2.1;
  float rs = r - Re * Re / r;
  float sw = (1.6 + 2.4 * uInt) * Rh / r;
  vec2 dir = rot2(sw + uTime * 0.05) * (d / r);
  vec3 col = lookW5(c + dir * rs);
  float hole = smoothstep(Rh * 0.95, Rh * 1.3, r);
  col *= hole;
  float pr = Rh * 1.38;
  float k = (r - pr) / (1.6 + 0.04 * Rh);
  col += mix(gAcc, uInk, 0.35) * exp(-k * k) * (0.75 + 0.35 * uBeat);
  col += gAcc * 0.22 * exp(-(r - pr) * (r - pr) / 3200.0) * hole;
  col += uHaz * 0.06 * uInt * exp(-max(r - pr, 0.0) / 90.0) * hole;
  return col;
}
`;

  var G_ENDLESS_MAIN = `
vec3 lookIdx(float k, vec2 p) {
  if (k < 0.5) {
    return lookW1(p);
  }
  if (k < 1.5) {
    return lookW2(p);
  }
  if (k < 2.5) {
    return lookW3(p);
  }
  if (k < 3.5) {
    return lookW4(p);
  }
  return lookW5(p);
}
void main() {
  vec2 p = viewPos();
  vec2 dq = p / 80.0;
  vec2 cell = floor(dq);
  vec2 fq = fract(dq) - 0.5;
  float th = 0.06 + 0.88 * (0.55 * hash12(cell + 3.7) + 0.45 * clamp(p.x / uView.x, 0.0, 1.0));
  vec3 col = vec3(0.0);
  if (uLook.z > th) {
    gPri = uPri2;
    gAcc = uAcc2;
    col = lookIdx(uLook.y, p);
  } else {
    gPri = uPri;
    gAcc = uAcc;
    col = lookIdx(uLook.x, p);
  }
  float near = 1.0 - smoothstep(0.0, 0.07, abs(uLook.z - th));
  float edge = smoothstep(0.4, 0.5, max(abs(fq.x), abs(fq.y)));
  col += mix(uAcc, uAcc2, uLook.z) * (edge * 0.45 + 0.08) * near;
  gl_FragColor = vec4(finish(col, p), 1.0);
}
`;

  function mainFor(fn) {
    return '\nvoid main() {\n  vec2 p = viewPos();\n  gPri = uPri;\n  gAcc = uAcc;\n  gl_FragColor = vec4(finish(' + fn + '(p), p), 1.0);\n}\n';
  }

  var srcMemo = Object.create(null);
  function fragmentSource(key) {
    switch (key) {
      case 'title': return HEAD + COMMON + G_TITLE + mainFor('lookTitle');
      case 'map': return HEAD + COMMON + G_MAP + mainFor('lookMap');
      case 'w1': return HEAD + COMMON + G_W1 + mainFor('lookW1');
      case 'w2': return HEAD + COMMON + G_W2 + mainFor('lookW2');
      case 'w3': return HEAD + COMMON + G_W3 + mainFor('lookW3');
      case 'w4': return HEAD + COMMON + G_W4 + mainFor('lookW4');
      case 'w5': return HEAD + COMMON + G_W5 + mainFor('lookW5');
      case 'void': return HEAD + COMMON + G_W5 + G_VOID + mainFor('lookVoid');
      case 'endless': return HEAD + HEAD_ENDLESS + COMMON + G_W1 + G_W2 + G_W3 + G_W4 + G_W5 + G_ENDLESS_MAIN;
      default: return null;
    }
  }
  // {vs, fs} for a style key (also used by tooling); null for unknown keys
  function source(key) {
    if (KEYS.indexOf(key) < 0) return null;
    var s = srcMemo[key];
    if (!s) s = srcMemo[key] = { vs: VS, fs: fragmentSource(key) };
    return s;
  }

  // ------------------------------------------------------------------ GL state
  var UNIFORMS = ['uRes', 'uView', 'uTime', 'uCam', 'uInt', 'uBeat', 'uPhase', 'uSeed', 'uQ',
    'uBg', 'uPri', 'uAcc', 'uHaz', 'uInk', 'uPri2', 'uAcc2', 'uLook'];
  var st = { gl: null, progs: Object.create(null), failed: Object.create(null), own: null };
  var mixOut = { a: 0, b: 1, m: 0 };
  var tint = Object.create(null);

  function resolveGL(gl) {
    if (gl && typeof gl.useProgram === 'function') return gl;
    if (gl && gl.gl && typeof gl.gl.useProgram === 'function') return gl.gl;
    var G = AP.GL;
    if (G && G.gl && typeof G.gl.useProgram === 'function') return G.gl;
    return null;
  }

  function dropPrograms() {
    st.progs = Object.create(null);
    st.failed = Object.create(null);
    st.own = null;
  }

  // (re)binds the module to a GL context; called by CORE at boot and after context restore
  function init(gl) {
    var g = resolveGL(gl);
    dropPrograms();
    st.gl = g;
    return !!g;
  }

  function compileOwn(gl, vs, fs) {
    var prog = null;
    try {
      var v = gl.createShader(gl.VERTEX_SHADER), f = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(v, vs); gl.compileShader(v);
      gl.shaderSource(f, fs); gl.compileShader(f);
      if (typeof gl.getShaderParameter === 'function' &&
          (!gl.getShaderParameter(v, gl.COMPILE_STATUS) || !gl.getShaderParameter(f, gl.COMPILE_STATUS))) {
        if (AP.warn) AP.warn('Background shader compile:', gl.getShaderInfoLog ? gl.getShaderInfoLog(f) : '');
        return null;
      }
      prog = gl.createProgram();
      gl.attachShader(prog, v); gl.attachShader(prog, f);
      if (typeof gl.bindAttribLocation === 'function') gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      if (typeof gl.getProgramParameter === 'function' && !gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    } catch (e) {
      return null;
    }
    return prog;
  }

  function drawOwn(gl, prog) {
    if (!st.own) {
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      st.own = buf;
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.own);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function ensure(key) {
    var e = st.progs[key];
    if (e) return e;
    if (st.failed[key] || !st.gl) return null;
    var gl = st.gl, s = source(key);
    if (!s || !s.fs) { st.failed[key] = true; return null; }
    var prog = null;
    try {
      var G = AP.GL;
      prog = (G && typeof G.compile === 'function') ? G.compile(s.vs, s.fs) : compileOwn(gl, s.vs, s.fs);
    } catch (err) {
      prog = null;
    }
    if (!prog) {
      st.failed[key] = true;
      if (AP.warnOnce) AP.warnOnce('bg-compile-' + key, 'Background shader "' + key + '" failed; using the 2D version.');
      return null;
    }
    var loc = Object.create(null);
    for (var i = 0; i < UNIFORMS.length; i++) {
      var l = null;
      try { l = gl.getUniformLocation(prog, UNIFORMS[i]); } catch (e2) { l = null; }
      loc[UNIFORMS[i]] = (l === undefined || l === -1) ? null : l;
    }
    e = st.progs[key] = { prog: prog, loc: loc };
    return e;
  }

  function has(key) {
    if (KEYS.indexOf(key) < 0) return false;
    if (st.failed[key]) return false;
    if (st.gl && !st.progs[key]) return !!ensure(key);
    return true;
  }

  function u1(gl, l, x) { if (l !== null) gl.uniform1f(l, x); }
  function u2(gl, l, x, y) { if (l !== null) gl.uniform2f(l, x, y); }
  function u3v(gl, l, v) { if (l !== null) gl.uniform3f(l, v[0], v[1], v[2]); }

  function qualityBg(q) {
    if (typeof q === 'string') return q;
    if (q && typeof q.bg === 'string') return q.bg;
    var R = AP.R;
    if (R && R.quality && typeof R.quality.bg === 'string') return R.quality.bg;
    return 'high';
  }

  function beatPulse(p) {
    var U = util();
    if (U) return U.beatPulse(p);
    var ph = (p && typeof p.phase === 'number') ? clamp(p.phase, 0, 1) : 0.5, q = 1 - ph;
    return q * q * q * q;
  }

  function tintVec(baseHex, worldHex, k) {
    var key = baseHex + worldHex + k, v = tint[key];
    if (v) return v;
    var a = vec3(baseHex), b = vec3(worldHex);
    v = tint[key] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    return v;
  }

  function render(gl, key, p) {
    var g = resolveGL(gl);
    if (!g) return false;
    if (g !== st.gl) init(g);
    if (KEYS.indexOf(key) < 0) return false;
    var e = ensure(key);
    if (!e) return false;
    p = p || EMPTY;
    try {
      var L = e.loc, pal = palFor(key, p);
      var w = num(g.drawingBufferWidth, 0) || (g.canvas && g.canvas.width) || 480;
      var h = num(g.drawingBufferHeight, 0) || (g.canvas && g.canvas.height) || 270;
      var t = num(p.t, 0) % 3600;
      if (t < 0) t += 3600;
      g.useProgram(e.prog);
      u2(g, L.uRes, w, h);
      u2(g, L.uView, num(p.w, 960) || 960, num(p.h, 540) || 540);
      u1(g, L.uTime, t);
      u2(g, L.uCam, num(p.camX, 0) % 65536, num(p.camY, 0) % 65536);
      u1(g, L.uInt, clamp(num(p.intensity, 0), 0, 1));
      u1(g, L.uBeat, beatPulse(p));
      u1(g, L.uPhase, (AP.Art && AP.Art.util) ? AP.Art.util.beatPhase(p) : 0);
      u1(g, L.uSeed, ((num(p.seed, 0) >>> 0) % 997) / 997);
      u1(g, L.uQ, qualityBg(p.quality) === 'low' ? 0 : 1);
      u3v(g, L.uBg, vec3(pal.bg));
      u3v(g, L.uHaz, vec3(pal.hazard));
      u3v(g, L.uInk, vec3(pal.ink));
      if (key === 'endless') {
        endlessMix(t, mixOut);
        var wa = worldPal(WORLD_KEYS[mixOut.a]), wb = worldPal(WORLD_KEYS[mixOut.b]);
        u3v(g, L.uPri, tintVec(pal.primary, wa.primary, 0.45));
        u3v(g, L.uAcc, tintVec(pal.accent, wa.accent, 0.45));
        u3v(g, L.uPri2, tintVec(pal.primary, wb.primary, 0.45));
        u3v(g, L.uAcc2, tintVec(pal.accent, wb.accent, 0.45));
        if (L.uLook !== null) g.uniform3f(L.uLook, mixOut.a, mixOut.b, mixOut.m);
      } else {
        u3v(g, L.uPri, vec3(pal.primary));
        u3v(g, L.uAcc, vec3(pal.accent));
      }
      if (typeof g.viewport === 'function') g.viewport(0, 0, w, h);
      var G = AP.GL;
      if (G && typeof G.drawFullscreen === 'function') G.drawFullscreen(e.prog);
      else drawOwn(g, e.prog);
      return true;
    } catch (err) {
      st.failed[key] = true;
      delete st.progs[key];
      if (AP.warnOnce) AP.warnOnce('bg-render-' + key, 'Background "' + key + '" disabled after a GL error: ' + (err && err.message));
      return false;
    }
  }

  // ================================================================== Canvas2D renditions
  var R2 = Object.create(null);
  var tiles = Object.create(null);
  var grads = Object.create(null);
  var holeGrad = null;

  function U2() {
    var U = util();
    return U;
  }

  function rgba(hex, a) {
    var U = util();
    if (U) return U.rgba(hex, a);
    var v = vec3(hex);
    return 'rgba(' + Math.round(v[0] * 255) + ',' + Math.round(v[1] * 255) + ',' + Math.round(v[2] * 255) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }

  function gradient(ctx, pal, H) {
    var key = pal.bg + pal.primary + H, g = grads[key];
    if (!g || g.ctx !== ctx) {
      var gr = ctx.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, mixHex(pal.bg, pal.primary, 0.07));
      gr.addColorStop(0.55, pal.bg);
      gr.addColorStop(1, mixHex(pal.bg, '#000000', 0.45));
      g = grads[key] = { ctx: ctx, g: gr };
    }
    return g.g;
  }
  function base(ctx, pal, W, H) {
    ctx.fillStyle = gradient(ctx, pal, H);
    ctx.fillRect(0, 0, W, H);
  }

  // 512u periodic pattern tile, rendered once per (name, palette)
  function tileFor(name, pal, builder) {
    var key = name + '|' + pal.bg + pal.primary + pal.accent;
    var t = tiles[key];
    if (t !== undefined) return t;
    var U = util();
    if (!U) { tiles[key] = null; return null; }
    var res = 1, S = 512;
    var c = U.makeCanvas(S * res, S * res), x = U.ctxOf(c);
    if (!c || !x) { tiles[key] = null; return null; }
    try {
      x.setTransform(res, 0, 0, res, 0, 0);
      builder(x, pal, S, U);
    } catch (e) {
      tiles[key] = null;
      return null;
    }
    t = tiles[key] = { canvas: c, size: S, res: res, pat: null, patCtx: null };
    return t;
  }

  function drawTiled(ctx, t, ox, oy, W, H, alpha) {
    if (!t || alpha <= 0) return;
    var S = t.size, sx = ((ox % S) + S) % S, sy = ((oy % S) + S) % S;
    var a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * alpha;
    if (t.patCtx !== ctx) {
      t.pat = null;
      t.patCtx = ctx;
      if (typeof ctx.createPattern === 'function') {
        try {
          var pat = ctx.createPattern(t.canvas, 'repeat');
          if (pat && t.res !== 1) {
            if (typeof pat.setTransform === 'function' && typeof DOMMatrix === 'function') pat.setTransform(new DOMMatrix([1 / t.res, 0, 0, 1 / t.res, 0, 0]));
            else pat = null;
          }
          t.pat = pat || null;
        } catch (e) { t.pat = null; }
      }
    }
    if (t.pat) {
      ctx.save();
      ctx.translate(-sx, -sy);
      ctx.fillStyle = t.pat;
      ctx.fillRect(sx, sy, W, H);
      ctx.restore();
    } else {
      for (var y = -sy; y < H; y += S) for (var x = -sx; x < W; x += S) ctx.drawImage(t.canvas, x, y, S, S);
    }
    ctx.globalAlpha = a0;
  }

  // draw fn(dx,dy) at every periodic offset that can touch the tile
  function wrap9(fn) {
    for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) fn(i * 512, j * 512);
  }

  // ---- tile builders
  function buildStars(x, pal, S, U) {
    var r = U.mulberry(4242);
    for (var i = 0; i < 190; i++) {
      var px = r.next() * S, py = r.next() * S, b = r.next(), rad = 0.35 + 1.25 * b * b;
      x.fillStyle = b > 0.88 ? pal.accent : pal.ink;
      x.globalAlpha = 0.18 + 0.62 * b;
      for (var j = -1; j <= 1; j++) for (var k = -1; k <= 1; k++) {
        var qx = px + k * S, qy = py + j * S;
        if (qx < -6 || qx > S + 6 || qy < -6 || qy > S + 6) continue;
        x.beginPath(); x.arc(qx, qy, rad, 0, TAU); x.fill();
        if (b > 0.94) {
          x.strokeStyle = pal.ink; x.lineWidth = 0.6; x.globalAlpha = 0.35;
          x.beginPath(); x.moveTo(qx - 5, qy); x.lineTo(qx + 5, qy); x.moveTo(qx, qy - 5); x.lineTo(qx, qy + 5); x.stroke();
          x.globalAlpha = 0.18 + 0.62 * b;
        }
      }
    }
    x.globalAlpha = 1;
  }

  function buildConstellation(x, pal, S, U) {
    var N = 6, cs = S / N, pts = [];
    for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
      pts.push(i * cs + cs * (0.2 + 0.6 * U.hashf(i, j, 77)), j * cs + cs * (0.2 + 0.6 * U.hashf(i, j, 78)));
    }
    function P(i, j) { var ii = ((i % N) + N) % N, jj = ((j % N) + N) % N, k = (jj * N + ii) * 2; return [pts[k] + (i - ii) * cs, pts[k + 1] + (j - jj) * cs]; }
    x.strokeStyle = pal.primary; x.lineWidth = 0.8; x.globalAlpha = 0.28;
    x.beginPath();
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var a = P(i, j), h = U.hashf(i, j, 91);
      var lst = [];
      if (h < 0.55) lst.push(P(i + 1, j));
      if ((h * 7.31) % 1 < 0.42) lst.push(P(i, j + 1));
      if ((h * 13.7) % 1 < 0.16) lst.push(P(i + 1, j + 1));
      for (var q = 0; q < lst.length; q++) {
        var b = lst[q];
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) { x.moveTo(a[0] + ox * S, a[1] + oy * S); x.lineTo(b[0] + ox * S, b[1] + oy * S); }
      }
    }
    x.stroke();
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var c = P(i, j), bb = U.hashf(i, j, 93);
      x.fillStyle = bb > 0.8 ? pal.accent : pal.ink;
      x.globalAlpha = 0.55 + 0.4 * bb;
      x.beginPath(); x.arc(c[0], c[1], 1.2 + 1.3 * bb, 0, TAU); x.fill();
      x.globalAlpha = 0.08;
      x.beginPath(); x.arc(c[0], c[1], 6 + 6 * bb, 0, TAU); x.fill();
    }
    x.globalAlpha = 1;
  }

  function buildTruchet(cell, rings, seed, width, alpha) {
    return function (x, pal, S, U) {
      var n = Math.round(S / cell);
      x.strokeStyle = pal.primary; x.lineWidth = width; x.globalAlpha = alpha; x.lineCap = 'round';
      x.beginPath();
      for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
        var k = U.hash3(i, j, seed) & 1, x0 = i * cell, y0 = j * cell;
        for (var r = 0; r < rings; r++) {
          var rr = rings === 1 ? cell / 2 : cell * (r + 1) / (rings + 1);
          if (k === 0) {
            x.moveTo(x0 + rr, y0); x.arc(x0, y0, rr, 0, Math.PI / 2);
            x.moveTo(x0 + cell - rr, y0 + cell); x.arc(x0 + cell, y0 + cell, rr, Math.PI, Math.PI * 1.5);
          } else {
            x.moveTo(x0 + cell, y0 + rr); x.arc(x0 + cell, y0, rr, Math.PI / 2, Math.PI);
            x.moveTo(x0, y0 + cell - rr); x.arc(x0, y0 + cell, rr, Math.PI * 1.5, TAU);
          }
        }
      }
      x.stroke();
      x.globalAlpha = 1;
    };
  }

  // periodic Voronoi (sites on a torus): cells clipped against all sites and their 8 copies
  function periodicVoronoi(U, count, seed, S) {
    var r = U.mulberry(seed), sites = [], i, k;
    for (i = 0; i < count; i++) sites.push(r.next() * S, r.next() * S);
    var cells = [];
    for (i = 0; i < count; i++) {
      var sx = sites[i * 2], sy = sites[i * 2 + 1], others = [];
      for (k = 0; k < count; k++) {
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
          if (k === i && ox === 0 && oy === 0) continue;
          var qx = sites[k * 2] + ox * S, qy = sites[k * 2 + 1] + oy * S;
          if (Math.abs(qx - sx) < S * 0.6 && Math.abs(qy - sy) < S * 0.6) others.push(qx, qy);
        }
      }
      cells.push({ x: sx, y: sy, poly: U.voronoiCell(sx, sy, others, sx - S * 0.5, sy - S * 0.5, S, S) });
    }
    return cells;
  }

  function buildCrystals(x, pal, S, U) {
    var cells = periodicVoronoi(U, 30, 1907, S);
    var light = -2.2;
    wrap9(function (dx, dy) {
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i], poly = c.poly, n = poly.length >> 1;
        if (n < 3) continue;
        for (var k = 0; k < n; k++) {
          var k2 = (k + 1) % n, mx = (poly[k * 2] + poly[k2 * 2]) * 0.5 - c.x, my = (poly[k * 2 + 1] + poly[k2 * 2 + 1]) * 0.5 - c.y;
          var lit = 0.5 + 0.5 * Math.cos(Math.atan2(my, mx) - light);
          x.globalAlpha = 0.03 + 0.12 * lit * lit;
          x.fillStyle = pal.primary;
          x.beginPath(); x.moveTo(c.x + dx, c.y + dy); x.lineTo(poly[k * 2] + dx, poly[k * 2 + 1] + dy); x.lineTo(poly[k2 * 2] + dx, poly[k2 * 2 + 1] + dy); x.closePath(); x.fill();
        }
        x.globalAlpha = 0.12; x.strokeStyle = pal.primary; x.lineWidth = 0.6;
        x.beginPath();
        for (k = 0; k < n; k++) { x.moveTo(c.x + dx, c.y + dy); x.lineTo(poly[k * 2] + dx, poly[k * 2 + 1] + dy); }
        x.stroke();
        x.globalAlpha = 0.45; x.lineWidth = 1.2;
        x.beginPath(); for (k = 0; k < n; k++) { if (k) x.lineTo(poly[k * 2] + dx, poly[k * 2 + 1] + dy); else x.moveTo(poly[0] + dx, poly[1] + dy); } x.closePath(); x.stroke();
        if (U.hashf(i, 1, 5) > 0.7) {
          x.globalAlpha = 0.6; x.fillStyle = pal.accent;
          x.beginPath(); x.arc(poly[0] + dx, poly[1] + dy, 1.4, 0, TAU); x.fill();
        }
      }
    });
    x.globalAlpha = 1;
  }

  // periodic flow: every term has integer frequencies over the 512 tile
  function periodicAngle(px, py, S) {
    var u = px / S * TAU, v = py / S * TAU;
    return 0.55 * Math.sin(u + 2 * v) + 0.35 * Math.sin(3 * v - u + 1.3) + 0.22 * Math.sin(2 * u + 0.5) + 0.12;
  }
  function buildStreaks(x, pal, S, U) {
    var r = U.mulberry(3131), pts = new Float32Array(120);
    x.lineCap = 'round';
    for (var s = 0; s < 130; s++) {
      var px = r.next() * S, py = r.next() * S, n = 40 + Math.floor(r.next() * 20), step = 5;
      if (n * 2 > pts.length) n = pts.length / 2;
      for (var i = 0; i < n; i++) {
        pts[i * 2] = px; pts[i * 2 + 1] = py;
        var a = periodicAngle(px, py, S);
        px += Math.cos(a) * step; py += Math.sin(a) * step;
      }
      var bright = r.next();
      x.strokeStyle = bright > 0.9 ? pal.accent : pal.primary;
      x.lineWidth = 0.6 + 0.9 * bright;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        // three alpha bands fade the head and the tail
        for (var b = 0; b < 3; b++) {
          var i0 = Math.floor(n * b / 3), i1 = Math.min(n - 1, Math.floor(n * (b + 1) / 3));
          x.globalAlpha = (b === 1 ? 0.34 : 0.14) * (0.5 + bright);
          x.beginPath();
          x.moveTo(pts[i0 * 2] + ox * S, pts[i0 * 2 + 1] + oy * S);
          for (i = i0 + 1; i <= i1; i++) x.lineTo(pts[i * 2] + ox * S, pts[i * 2 + 1] + oy * S);
          x.stroke();
        }
      }
    }
    x.globalAlpha = 1;
  }

  function buildGarden(x, pal, S, U) {
    // plant-cell vein network
    var cells = periodicVoronoi(U, 16, 4040, S);
    x.strokeStyle = pal.primary; x.lineWidth = 0.8; x.globalAlpha = 0.16;
    wrap9(function (dx, dy) {
      x.beginPath();
      for (var i = 0; i < cells.length; i++) U.flatPath(x, offsetFlat(cells[i].poly, dx, dy), true);
      x.stroke();
    });
    // L-system sprigs and gaskets
    var r = U.mulberry(5150);
    for (var k = 0; k < 7; k++) {
      var sx = r.next() * S, sy = r.next() * S, h0 = -Math.PI / 2 + (r.next() - 0.5) * 1.2;
      var str = U.lsystem('X', { X: 'F[+X][-X]FX', F: 'FF' }, 4, 4000);
      var tt = U.turtle(str, { x: sx, y: sy, heading: h0, step: 2.6, angle: 0.42 + r.next() * 0.2, shrink: 1 });
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        x.globalAlpha = 0.3; x.strokeStyle = pal.primary; x.lineWidth = 0.8;
        x.beginPath();
        for (var q = 0; q < tt.segs.length; q++) { var sg = tt.segs[q]; x.moveTo(sg[0] + ox * S, sg[1] + oy * S); x.lineTo(sg[2] + ox * S, sg[3] + oy * S); }
        x.stroke();
        x.globalAlpha = 0.5; x.fillStyle = pal.accent;
        x.beginPath();
        for (q = 0; q < tt.leaves.length; q += 3) { var lf = tt.leaves[q]; x.moveTo(lf[0] + ox * S + 1.3, lf[1] + oy * S); x.arc(lf[0] + ox * S, lf[1] + oy * S, 1.3, 0, TAU); }
        x.fill();
      }
    }
    for (k = 0; k < 5; k++) {
      var gx = r.next() * S, gy = r.next() * S, size = 30 + r.next() * 40, tris = U.sierpinski(gx, gy, size, 3);
      wrap9(function (dx, dy) {
        x.globalAlpha = 0.2; x.strokeStyle = pal.primary; x.lineWidth = 0.7;
        x.beginPath();
        for (var q2 = 0; q2 < tris.length; q2++) { var T = tris[q2]; x.moveTo(T[0] + dx, T[1] + dy); x.lineTo(T[2] + dx, T[3] + dy); x.lineTo(T[4] + dx, T[5] + dy); x.closePath(); }
        x.stroke();
      });
    }
    x.globalAlpha = 1;
  }
  function offsetFlat(flat, dx, dy) {
    var o = new Array(flat.length);
    for (var i = 0; i < flat.length; i += 2) { o[i] = flat[i] + dx; o[i + 1] = flat[i + 1] + dy; }
    return o;
  }

  // ---- per-key 2D renderers
  function nestedPolys(ctx, cx, cy, t, pal, alpha, U) {
    var sch = t / 9, k0 = ((Math.floor(sch) % 5) + 5) % 5, k1 = (k0 + 1) % 5, fm = smooth((frac(sch) - 0.55) / 0.45);
    var zz = t * 0.03, zoom = frac(zz), zi = Math.floor(zz);
    ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      var k = pass ? k1 : k0, a = pass ? fm : 1 - fm;
      if (a < 0.02) continue;
      var sides = k === 4 ? 48 : k + 3;
      for (var gold = 0; gold < 2; gold++) {
        ctx.strokeStyle = gold ? pal.accent : pal.primary;
        ctx.globalAlpha = alpha * a * (gold ? 0.55 : 0.42);
        ctx.lineWidth = gold ? 1.3 : 1;
        ctx.beginPath();
        for (var j = -3; j < 20; j++) {
          var R = 320 * Math.pow(0.8, j - zoom);
          if (R < 6 || R > 1000) continue;
          var isGold = ((((j + zi) % 5) + 5) % 5) === 4;
          if (isGold !== !!gold) continue;
          U.polyPath(ctx, cx, cy, R, sides, (j - zoom) * 0.2 + t * 0.02);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  R2.title = function (ctx, p, pal, W, H) {
    var U = U2(), t = num(p.t, 0);
    base(ctx, pal, W, H);
    if (!U) return;
    drawTiled(ctx, tileFor('stars', pal, buildStars), t * 3, t * 1.2, W, H, 0.8);
    var cx = W / 2 + Math.sin(t * 0.07) * 6, cy = H / 2 + Math.cos(t * 0.05) * 6;
    nestedPolys(ctx, cx, cy, t, pal, 1, U);
  };

  R2.map = function (ctx, p, pal, W, H) {
    var cx = num(p.camX, 0), cy = num(p.camY, 0);
    base(ctx, pal, W, H);
    drawTiled(ctx, tileFor('stars', pal, buildStars), cx * 0.05, cy * 0.05, W, H, 0.7);
    drawTiled(ctx, tileFor('constellation', pal, buildConstellation), cx * 0.16, cy * 0.16, W, H, 0.9);
  };

  R2.w1 = function (ctx, p, pal, W, H) {
    var cx = num(p.camX, 0), cy = num(p.camY, 0), t = num(p.t, 0);
    base(ctx, pal, W, H);
    drawTiled(ctx, tileFor('w1a', pal, buildTruchet(64, 1, 11, 1.1, 0.5)), cx * 0.06 - t * 3, cy * 0.06 - t * 1.2, W, H, 0.45);
    drawTiled(ctx, tileFor('w1b', pal, buildTruchet(32, 2, 12, 0.8, 0.45)), cx * 0.16 + t * 5, cy * 0.16 + t * 2, W, H, 0.4);
  };

  R2.w2 = function (ctx, p, pal, W, H) {
    var cx = num(p.camX, 0), cy = num(p.camY, 0);
    base(ctx, pal, W, H);
    drawTiled(ctx, tileFor('w2', pal, buildCrystals), cx * 0.13, cy * 0.13, W, H, 0.85);
  };

  R2.w3 = function (ctx, p, pal, W, H) {
    var cx = num(p.camX, 0), cy = num(p.camY, 0), t = num(p.t, 0);
    base(ctx, pal, W, H);
    var tl = tileFor('w3', pal, buildStreaks);
    drawTiled(ctx, tl, cx * 0.06 - t * 9, cy * 0.06, W, H, 0.5);
    drawTiled(ctx, tl, cx * 0.14 - t * 22 + 211, cy * 0.14 + 97, W, H, 0.65);
  };

  R2.w4 = function (ctx, p, pal, W, H) {
    var cx = num(p.camX, 0), cy = num(p.camY, 0);
    base(ctx, pal, W, H);
    drawTiled(ctx, tileFor('w4', pal, buildGarden), cx * 0.1, cy * 0.1, W, H, 0.85);
  };

  function ripples(ctx, p, pal, W, H) {
    var t = num(p.t, 0) * (1 + 0.5 * clamp(num(p.intensity, 0), 0, 1));
    var srcs = [
      W / 2 + Math.sin(t * 0.071) * 330, H / 2 + Math.sin(t * 0.053 + 1) * 170, 26, 1.3,
      W / 2 + Math.sin(t * 0.047 + 2.1) * 360, H / 2 + Math.sin(t * 0.083 + 0.4) * 190, 29, 1.1,
      W / 2 + Math.sin(t * 0.061 + 4.2) * 300, H / 2 + Math.sin(t * 0.039 + 2.6) * 200, 23, 1.6
    ];
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 1;
    for (var s = 0; s < 12; s += 4) {
      var sx = srcs[s], sy = srcs[s + 1], wl = srcs[s + 2], off = (t * srcs[s + 3] * wl / TAU) % wl;
      ctx.globalAlpha = 0.075;
      ctx.beginPath();
      for (var r = off + 4; r < 1150; r += wl) { ctx.moveTo(sx + r, sy); ctx.arc(sx, sy, r, 0, TAU); }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  function sunflower(ctx, p, pal, W, H) {
    var t = num(p.t, 0), cx = num(p.camX, 0), cy = num(p.camY, 0);
    var px = ((W * 0.74 - cx * 0.1) % (W + 640) + (W + 640)) % (W + 640) - 320;
    var py = ((H * 0.4 - cy * 0.1) % (H + 460) + (H + 460)) % (H + 460) - 230;
    px += Math.sin(t * 0.05) * 18; py += Math.cos(t * 0.04) * 18;
    if (AP.Art && typeof AP.Art.phyllo === 'function') {
      ctx.globalAlpha = 0.6;
      AP.Art.phyllo(ctx, px, py, 220, 10, mixHex(pal.accent, pal.ink, 0.35), 1.5, t);
      ctx.globalAlpha = 1;
    }
  }
  R2.w5 = function (ctx, p, pal, W, H) {
    base(ctx, pal, W, H);
    ripples(ctx, p, pal, W, H);
    sunflower(ctx, p, pal, W, H);
  };

  R2.void = function (ctx, p, pal, W, H) {
    var t = num(p.t, 0), inten = clamp(num(p.intensity, 0), 0, 1);
    base(ctx, pal, W, H);
    ripples(ctx, p, pal, W, H);
    sunflower(ctx, p, pal, W, H);
    var cx = W / 2 + Math.sin(t * 0.13) * 14, cy = H / 2 + Math.cos(t * 0.09) * 9;
    var Rh = 44 + 26 * inten + 5 * beatPulse(p);
    if (!holeGrad || holeGrad.ctx !== ctx) {
      var g = ctx.createRadialGradient(0, 0, 0.9, 0, 0, 3.4);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.16, 'rgba(0,0,0,0.92)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      holeGrad = { ctx: ctx, g: g };
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Rh, Rh);
    ctx.fillStyle = holeGrad.g;
    ctx.fillRect(-3.5, -3.5, 7, 7);
    ctx.restore();
    ctx.fillStyle = '#000000';
    ctx.beginPath(); ctx.arc(cx, cy, Rh, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = pal.accent;
    ctx.globalAlpha = 0.16; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(cx, cy, Rh * 1.38, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.85; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, Rh * 1.38, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  };

  var endPal = { bg: '', primary: '', accent: '', hazard: '', ink: '' };
  var endPal2 = { bg: '', primary: '', accent: '', hazard: '', ink: '' };
  function tintPal(out, pal, wk) {
    var w = worldPal(wk);
    out.bg = pal.bg; out.hazard = pal.hazard; out.ink = pal.ink;
    out.primary = mixHex(pal.primary, w.primary, 0.45);
    out.accent = mixHex(pal.accent, w.accent, 0.45);
    return out;
  }
  R2.endless = function (ctx, p, pal, W, H) {
    endlessMix(num(p.t, 0), mixOut);
    var a = WORLD_KEYS[mixOut.a], b = WORLD_KEYS[mixOut.b];
    R2[a](ctx, p, tintPal(endPal, pal, a), W, H);
    if (mixOut.m > 0.01) {
      ctx.save();
      ctx.globalAlpha = mixOut.m;
      R2[b](ctx, p, tintPal(endPal2, pal, b), W, H);
      ctx.restore();
    }
  };

  // The 2D rendition is drawn into an offscreen canvas at the GL path's reduced resolution (half the
  // device resolution, a quarter on 'low', clamped) and upscaled with one drawImage: soft like the
  // shader, and 4-16x fewer rasterised pixels when the 2D path runs on a CPU-rasterised canvas.
  var off = { canvas: null, ctx: null, broken: false };
  function offScale(p) {
    var R = AP.R, px = R && typeof R.px === 'number' && R.px > 0 ? R.px : 1;
    var low = qualityBg(p && p.quality) === 'low';
    return clamp(px * (low ? 0.25 : 0.5), low ? 0.4 : 0.6, 1);
  }
  function render2D(ctx, key, p) {
    if (!ctx) return;
    p = p || EMPTY;
    var k = R2[key] ? key : 'title';
    var pal = palFor(k, p);
    var W = num(p.w, 960) || 960, H = num(p.h, 540) || 540;
    var U = util(), x = null;
    if (!off.broken && U) {
      var s = offScale(p), cw = Math.max(16, Math.round(W * s)), ch = Math.max(9, Math.round(H * s));
      if (!off.canvas) { off.canvas = U.makeCanvas(cw, ch); off.ctx = U.ctxOf(off.canvas); if (!off.ctx) off.broken = true; }
      if (off.ctx) {
        if (off.canvas.width !== cw) off.canvas.width = cw;
        if (off.canvas.height !== ch) off.canvas.height = ch;
        x = off.ctx;
        x.setTransform(cw / W, 0, 0, ch / H, 0, 0);
        x.globalAlpha = 1;
        x.globalCompositeOperation = 'source-over';
      }
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    try {
      if (x) {
        x.save();
        try { R2[k](x, p, pal, W, H); } finally { x.restore(); }
        ctx.drawImage(off.canvas, 0, 0, W, H);
      } else {
        R2[k](ctx, p, pal, W, H);
      }
    } finally {
      ctx.restore();
    }
  }

  AP.Backgrounds = {
    init: init,
    has: has,
    render: render,
    render2D: render2D,
    source: source,
    keys: KEYS.slice(),
    endlessMix: endlessMix,
    failed: function (key) { return !!st.failed[key]; }
  };
})(window.AP = window.AP || {});
