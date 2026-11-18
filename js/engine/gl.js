/* js/engine/gl.js — owner: CORE */
(function (AP) {
  'use strict';

  // WebGL1 on canvas#bg at reduced resolution, used only for shader backgrounds (AP.Backgrounds).
  var OPTS = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
    preserveDrawingBuffer: false, powerPreference: 'low-power' };

  var GL = {
    gl: null,
    ok: false,
    canvas: null,
    bgReady: false,
    lost: false,
    bgScale: 0.5,
    quad: null,
    programs: [],
    log: []
  };

  function setupQuad() {
    var gl = GL.gl;
    GL.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, GL.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
  }

  function onLost(e) {
    if (e && e.preventDefault) e.preventDefault();
    GL.ok = false;
    GL.lost = true;
    GL.bgReady = false;
    GL.programs = [];
    AP.warn('WebGL context lost; using 2D background fallback.');
  }

  function onRestored() {
    GL.lost = false;
    try {
      setupQuad();
      GL.ok = true;
      GL.resize();
      var r = AP.call('Backgrounds.init', GL.gl);
      GL.bgReady = r !== false && !!AP.Backgrounds;
      AP.log('WebGL context restored.');
    } catch (e) {
      GL.ok = false;
      AP.warn('WebGL restore failed', e);
    }
  }

  // init(canvas) -> bool
  GL.init = function (canvas) {
    GL.canvas = canvas || null;
    GL.ok = false;
    GL.gl = null;
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    var gl = null;
    try {
      gl = canvas.getContext('webgl', OPTS) || canvas.getContext('experimental-webgl', OPTS);
    } catch (e) {
      gl = null;
    }
    if (!gl || typeof gl.createBuffer !== 'function') return false;
    GL.gl = gl;
    try {
      setupQuad();
    } catch (e2) {
      AP.warn('WebGL setup failed', e2);
      GL.gl = null;
      return false;
    }
    if (typeof canvas.addEventListener === 'function' && !GL.listening) {
      GL.listening = true;
      canvas.addEventListener('webglcontextlost', onLost, false);
      canvas.addEventListener('webglcontextrestored', onRestored, false);
    }
    GL.ok = true;
    GL.resize();
    return true;
  };

  function compileShader(gl, type, src, label) {
    var sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var info = gl.getShaderInfoLog(sh);
      GL.log.push(label + ': ' + info);
      AP.warn('Shader compile failed (' + label + '):', info);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  // compile(vs, fs) -> program | null. Attribute aPos is bound to location 0.
  GL.compile = function (vs, fs) {
    var gl = GL.gl;
    if (!GL.ok || !gl) return null;
    try {
      if (gl.isContextLost && gl.isContextLost()) return null;
      var v = compileShader(gl, gl.VERTEX_SHADER, String(vs), 'vertex');
      var f = compileShader(gl, gl.FRAGMENT_SHADER, String(fs), 'fragment');
      if (!v || !f) return null;
      var p = gl.createProgram();
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        var info = gl.getProgramInfoLog(p);
        GL.log.push('link: ' + info);
        AP.warn('Shader link failed:', info);
        gl.deleteProgram(p);
        return null;
      }
      gl.deleteShader(v);
      gl.deleteShader(f);
      GL.programs.push(p);
      return p;
    } catch (e) {
      AP.warn('Shader compile threw', e);
      return null;
    }
  };

  // full-screen quad (TRIANGLE_STRIP of 4 vertices in clip space) with the given program
  GL.drawFullscreen = function (program) {
    var gl = GL.gl;
    if (!GL.ok || !gl || !program) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, GL.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  // backing store = game backing store x bgScale (high 0.5, low 0.25)
  GL.resize = function () {
    var q = AP.R && AP.R.quality;
    GL.bgScale = (q && q.bg === 'low') ? 0.25 : 0.5;
    var c = GL.canvas;
    if (!c) return;
    var px = (AP.R && AP.R.px) || 1;
    var w = Math.max(16, Math.round(960 * px * GL.bgScale));
    var h = Math.max(9, Math.round(540 * px * GL.bgScale));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    if (GL.ok && GL.gl) {
      try { GL.gl.viewport(0, 0, w, h); } catch (e) { /* lost */ }
    }
  };

  GL.clear = function () {
    var gl = GL.gl;
    if (!GL.ok || !gl) return;
    try {
      gl.viewport(0, 0, GL.canvas.width, GL.canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } catch (e) { /* lost */ }
  };

  // CORE helper used by AP.R.drawBackground: viewport + AP.Backgrounds.render (guarded). true on success.
  GL.renderBackground = function (key, p) {
    var gl = GL.gl;
    if (!GL.ok || !gl || !AP.Backgrounds || typeof AP.Backgrounds.render !== 'function') return false;
    try {
      if (gl.isContextLost && gl.isContextLost()) { onLost(null); return false; }
      gl.viewport(0, 0, GL.canvas.width, GL.canvas.height);
      // AP.Backgrounds.render returns false after a runtime GL error: fall back to 2D this same frame.
      return AP.Backgrounds.render(gl, key, p) !== false;
    } catch (e) {
      AP.reportError('Backgrounds.render:' + key, e);
      return false;
    }
  };

  AP.GL = GL;
})(window.AP = window.AP || {});
