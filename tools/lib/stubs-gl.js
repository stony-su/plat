/* tools/lib/stubs-gl.js — owner: TOOLS */
(function (G) {
  'use strict';
  // Runs INSIDE the harness vm context. A WebGL1 rendering context stub: shaders and programs
  // always compile and link, getUniformLocation returns location objects, getExtension returns
  // null. It records shader sources (for glsl-lint at runtime), uniform values (time wrap
  // check), and GL usage errors that a real driver reports through getError() (uniforms set on
  // a program that is not in use, draws without a program/buffer, ...). Context loss can be
  // simulated with S.loseContext(gl) / S.restoreContext(gl).
  G.__AP_STUBS = G.__AP_STUBS || {};
  G.__AP_STUBS.gl = function installGl(S) {
    var issue = S.issue;
    var K = {
      DEPTH_BUFFER_BIT: 0x100, STENCIL_BUFFER_BIT: 0x400, COLOR_BUFFER_BIT: 0x4000,
      POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6,
      ZERO: 0, ONE: 1, SRC_COLOR: 0x300, ONE_MINUS_SRC_COLOR: 0x301, SRC_ALPHA: 0x302, ONE_MINUS_SRC_ALPHA: 0x303,
      DST_ALPHA: 0x304, ONE_MINUS_DST_ALPHA: 0x305, DST_COLOR: 0x306, ONE_MINUS_DST_COLOR: 0x307, SRC_ALPHA_SATURATE: 0x308,
      FUNC_ADD: 0x8006, BLEND_EQUATION: 0x8009, BLEND_EQUATION_RGB: 0x8009, BLEND_EQUATION_ALPHA: 0x883D,
      FUNC_SUBTRACT: 0x800A, FUNC_REVERSE_SUBTRACT: 0x800B, BLEND_DST_RGB: 0x80C8, BLEND_SRC_RGB: 0x80C9,
      BLEND_DST_ALPHA: 0x80CA, BLEND_SRC_ALPHA: 0x80CB, CONSTANT_COLOR: 0x8001, ONE_MINUS_CONSTANT_COLOR: 0x8002,
      CONSTANT_ALPHA: 0x8003, ONE_MINUS_CONSTANT_ALPHA: 0x8004, BLEND_COLOR: 0x8005,
      ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, ARRAY_BUFFER_BINDING: 0x8894, ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
      STREAM_DRAW: 0x88E0, STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, BUFFER_SIZE: 0x8764, BUFFER_USAGE: 0x8765,
      CURRENT_VERTEX_ATTRIB: 0x8626, FRONT: 0x404, BACK: 0x405, FRONT_AND_BACK: 0x408,
      CULL_FACE: 0xB44, BLEND: 0xBE2, DITHER: 0xBD0, STENCIL_TEST: 0xB90, DEPTH_TEST: 0xB71, SCISSOR_TEST: 0xC11,
      POLYGON_OFFSET_FILL: 0x8037, SAMPLE_ALPHA_TO_COVERAGE: 0x809E, SAMPLE_COVERAGE: 0x80A0,
      NO_ERROR: 0, INVALID_ENUM: 0x500, INVALID_VALUE: 0x501, INVALID_OPERATION: 0x502, OUT_OF_MEMORY: 0x505,
      CW: 0x900, CCW: 0x901, LINE_WIDTH: 0xB21, ALIASED_POINT_SIZE_RANGE: 0x846D, ALIASED_LINE_WIDTH_RANGE: 0x846E,
      CULL_FACE_MODE: 0xB45, FRONT_FACE: 0xB46, DEPTH_RANGE: 0xB70, DEPTH_WRITEMASK: 0xB72, DEPTH_CLEAR_VALUE: 0xB73,
      DEPTH_FUNC: 0xB74, STENCIL_CLEAR_VALUE: 0xB91, STENCIL_FUNC: 0xB92, STENCIL_FAIL: 0xB94, STENCIL_PASS_DEPTH_FAIL: 0xB95,
      STENCIL_PASS_DEPTH_PASS: 0xB96, STENCIL_REF: 0xB97, STENCIL_VALUE_MASK: 0xB93, STENCIL_WRITEMASK: 0xB98,
      STENCIL_BACK_FUNC: 0x8800, STENCIL_BACK_FAIL: 0x8801, STENCIL_BACK_PASS_DEPTH_FAIL: 0x8802, STENCIL_BACK_PASS_DEPTH_PASS: 0x8803,
      STENCIL_BACK_REF: 0x8CA3, STENCIL_BACK_VALUE_MASK: 0x8CA4, STENCIL_BACK_WRITEMASK: 0x8CA5,
      VIEWPORT: 0xBA2, SCISSOR_BOX: 0xC10, COLOR_CLEAR_VALUE: 0xC22, COLOR_WRITEMASK: 0xC23,
      UNPACK_ALIGNMENT: 0xCF5, PACK_ALIGNMENT: 0xD05, MAX_TEXTURE_SIZE: 0xD33, MAX_VIEWPORT_DIMS: 0xD3A,
      SUBPIXEL_BITS: 0xD50, RED_BITS: 0xD52, GREEN_BITS: 0xD53, BLUE_BITS: 0xD54, ALPHA_BITS: 0xD55, DEPTH_BITS: 0xD56, STENCIL_BITS: 0xD57,
      POLYGON_OFFSET_UNITS: 0x2A00, POLYGON_OFFSET_FACTOR: 0x8038, TEXTURE_BINDING_2D: 0x8069,
      SAMPLE_BUFFERS: 0x80A8, SAMPLES: 0x80A9, SAMPLE_COVERAGE_VALUE: 0x80AA, SAMPLE_COVERAGE_INVERT: 0x80AB,
      COMPRESSED_TEXTURE_FORMATS: 0x86A3, DONT_CARE: 0x1100, FASTEST: 0x1101, NICEST: 0x1102, GENERATE_MIPMAP_HINT: 0x8192,
      BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406,
      DEPTH_COMPONENT: 0x1902, ALPHA: 0x1906, RGB: 0x1907, RGBA: 0x1908, LUMINANCE: 0x1909, LUMINANCE_ALPHA: 0x190A,
      UNSIGNED_SHORT_4_4_4_4: 0x8033, UNSIGNED_SHORT_5_5_5_1: 0x8034, UNSIGNED_SHORT_5_6_5: 0x8363,
      FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31, MAX_VERTEX_ATTRIBS: 0x8869, MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB,
      MAX_VARYING_VECTORS: 0x8DFC, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
      MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD, SHADER_TYPE: 0x8B4F, DELETE_STATUS: 0x8B80,
      LINK_STATUS: 0x8B82, VALIDATE_STATUS: 0x8B83, ATTACHED_SHADERS: 0x8B85, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89,
      SHADING_LANGUAGE_VERSION: 0x8B8C, CURRENT_PROGRAM: 0x8B8D, COMPILE_STATUS: 0x8B81,
      NEVER: 0x200, LESS: 0x201, EQUAL: 0x202, LEQUAL: 0x203, GREATER: 0x204, NOTEQUAL: 0x205, GEQUAL: 0x206, ALWAYS: 0x207,
      KEEP: 0x1E00, REPLACE: 0x1E01, INCR: 0x1E02, DECR: 0x1E03, INVERT: 0x150A, INCR_WRAP: 0x8507, DECR_WRAP: 0x8508,
      VENDOR: 0x1F00, RENDERER: 0x1F01, VERSION: 0x1F02,
      NEAREST: 0x2600, LINEAR: 0x2601, NEAREST_MIPMAP_NEAREST: 0x2700, LINEAR_MIPMAP_NEAREST: 0x2701,
      NEAREST_MIPMAP_LINEAR: 0x2702, LINEAR_MIPMAP_LINEAR: 0x2703, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, TEXTURE_2D: 0xDE1, TEXTURE: 0x1702, TEXTURE_CUBE_MAP: 0x8513,
      TEXTURE_BINDING_CUBE_MAP: 0x8514, TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515, TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516,
      TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517, TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518, TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519,
      TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851A, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C, ACTIVE_TEXTURE: 0x84E0,
      REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812F, MIRRORED_REPEAT: 0x8370,
      FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52, INT_VEC2: 0x8B53, INT_VEC3: 0x8B54, INT_VEC4: 0x8B55,
      BOOL: 0x8B56, BOOL_VEC2: 0x8B57, BOOL_VEC3: 0x8B58, BOOL_VEC4: 0x8B59, FLOAT_MAT2: 0x8B5A, FLOAT_MAT3: 0x8B5B,
      FLOAT_MAT4: 0x8B5C, SAMPLER_2D: 0x8B5E, SAMPLER_CUBE: 0x8B60,
      VERTEX_ATTRIB_ARRAY_ENABLED: 0x8622, VERTEX_ATTRIB_ARRAY_SIZE: 0x8623, VERTEX_ATTRIB_ARRAY_STRIDE: 0x8624,
      VERTEX_ATTRIB_ARRAY_TYPE: 0x8625, VERTEX_ATTRIB_ARRAY_NORMALIZED: 0x886A, VERTEX_ATTRIB_ARRAY_POINTER: 0x8645,
      VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: 0x889F, IMPLEMENTATION_COLOR_READ_TYPE: 0x8B9A, IMPLEMENTATION_COLOR_READ_FORMAT: 0x8B9B,
      LOW_FLOAT: 0x8DF0, MEDIUM_FLOAT: 0x8DF1, HIGH_FLOAT: 0x8DF2, LOW_INT: 0x8DF3, MEDIUM_INT: 0x8DF4, HIGH_INT: 0x8DF5,
      FRAMEBUFFER: 0x8D40, RENDERBUFFER: 0x8D41, RGBA4: 0x8056, RGB5_A1: 0x8057, RGB565: 0x8D62, DEPTH_COMPONENT16: 0x81A5,
      STENCIL_INDEX8: 0x8D48, DEPTH_STENCIL: 0x84F9, RENDERBUFFER_WIDTH: 0x8D42, RENDERBUFFER_HEIGHT: 0x8D43,
      RENDERBUFFER_INTERNAL_FORMAT: 0x8D44, RENDERBUFFER_RED_SIZE: 0x8D50, RENDERBUFFER_GREEN_SIZE: 0x8D51,
      RENDERBUFFER_BLUE_SIZE: 0x8D52, RENDERBUFFER_ALPHA_SIZE: 0x8D53, RENDERBUFFER_DEPTH_SIZE: 0x8D54, RENDERBUFFER_STENCIL_SIZE: 0x8D55,
      FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: 0x8CD0, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: 0x8CD1,
      FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL: 0x8CD2, FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: 0x8CD3,
      COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00, STENCIL_ATTACHMENT: 0x8D20, DEPTH_STENCIL_ATTACHMENT: 0x821A, NONE: 0,
      FRAMEBUFFER_COMPLETE: 0x8CD5, FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8CD6, FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 0x8CD7,
      FRAMEBUFFER_INCOMPLETE_DIMENSIONS: 0x8CD9, FRAMEBUFFER_UNSUPPORTED: 0x8CDD, FRAMEBUFFER_BINDING: 0x8CA6,
      RENDERBUFFER_BINDING: 0x8CA7, MAX_RENDERBUFFER_SIZE: 0x84E8, INVALID_FRAMEBUFFER_OPERATION: 0x506,
      UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241, CONTEXT_LOST_WEBGL: 0x9242,
      UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243, BROWSER_DEFAULT_WEBGL: 0x9244
    };
    for (var t = 0; t < 32; t++) K['TEXTURE' + t] = 0x84C0 + t;

    S.gl = { contexts: [], shaders: [], programs: 0, uniformValues: {}, draws: 0, errors: 0, compiles: 0, losses: 0 };

    function WebGLObject(kind, gl) { this._kind = kind; this._gl = gl; this._deleted = false; this._gen = gl && gl.__st ? gl.__st.gen : 0; }
    function WebGLShader(gl, type) { WebGLObject.call(this, 'shader', gl); this.type = type; this.source = ''; this.compiled = false; }
    function WebGLProgram(gl) { WebGLObject.call(this, 'program', gl); this.shaders = []; this.linked = false; this.attribs = {}; this.nextAttrib = 0; this.id = ++S.gl.programs; }
    function WebGLUniformLocation(program, name) { this._program = program; this._name = name; }
    function WebGLBuffer(gl) { WebGLObject.call(this, 'buffer', gl); this.size = 0; }
    function WebGLTexture(gl) { WebGLObject.call(this, 'texture', gl); }
    function WebGLFramebuffer(gl) { WebGLObject.call(this, 'framebuffer', gl); }
    function WebGLRenderbuffer(gl) { WebGLObject.call(this, 'renderbuffer', gl); }
    G.WebGLShader = WebGLShader; G.WebGLProgram = WebGLProgram; G.WebGLUniformLocation = WebGLUniformLocation;
    G.WebGLBuffer = WebGLBuffer; G.WebGLTexture = WebGLTexture; G.WebGLFramebuffer = WebGLFramebuffer; G.WebGLRenderbuffer = WebGLRenderbuffer;

    function WebGLRenderingContext() {}
    var P = WebGLRenderingContext.prototype;
    for (var k in K) { P[k] = K[k]; WebGLRenderingContext[k] = K[k]; }
    G.WebGLRenderingContext = WebGLRenderingContext;

    function err(gl, code, msg) {
      var st = gl.__st;
      if (st.errors.length < 32) st.errors.push(code);
      S.gl.errors++;
      issue('gl-error', 'WebGL ' + (code === K.INVALID_OPERATION ? 'INVALID_OPERATION' : code === K.INVALID_VALUE ? 'INVALID_VALUE' : code === K.INVALID_ENUM ? 'INVALID_ENUM' : '0x' + code.toString(16)) + ': ' + msg, 'warn', true);
    }
    function lost(gl) { return gl.__st.lost; }

    S.createGL = function (canvas, attrs) {
      var gl = new WebGLRenderingContext();
      Object.defineProperty(gl, '__st', {
        value: {
          canvas: canvas, attrs: attrs, lost: false, lostReported: false, errors: [], program: null, gen: 0,
          buffers: {}, enabledAttribs: {}, attribBuffers: {}, viewport: [0, 0, canvas.width, canvas.height],
          clearColor: [0, 0, 0, 0], caps: {}, textures: {}, activeTexture: K.TEXTURE0, fb: null, rb: null, pixelStore: {}
        }, enumerable: false
      });
      S.gl.contexts.push(gl);
      return gl;
    };
    S.glResize = function () {};
    Object.defineProperty(P, 'canvas', { get: function () { return this.__st.canvas; } });
    Object.defineProperty(P, 'drawingBufferWidth', { get: function () { return this.__st.lost ? 0 : this.__st.canvas.width; } });
    Object.defineProperty(P, 'drawingBufferHeight', { get: function () { return this.__st.lost ? 0 : this.__st.canvas.height; } });
    Object.defineProperty(P, 'drawingBufferColorSpace', { get: function () { return 'srgb'; }, set: function () {} });

    P.getContextAttributes = function () {
      if (lost(this)) return null;
      var a = this.__st.attrs;
      return { alpha: a.alpha !== false, antialias: a.antialias !== false, depth: a.depth !== false, stencil: !!a.stencil, premultipliedAlpha: a.premultipliedAlpha !== false, preserveDrawingBuffer: !!a.preserveDrawingBuffer, powerPreference: a.powerPreference || 'default', failIfMajorPerformanceCaveat: !!a.failIfMajorPerformanceCaveat, desynchronized: false };
    };
    P.isContextLost = function () { return this.__st.lost; };
    P.getError = function () {
      var st = this.__st;
      if (st.lost && !st.lostReported) { st.lostReported = true; return K.CONTEXT_LOST_WEBGL; }
      return st.errors.length ? st.errors.shift() : K.NO_ERROR;
    };
    P.getExtension = function () { return null; };
    P.getSupportedExtensions = function () { return lost(this) ? null : []; };

    // shaders / programs
    P.createShader = function (type) {
      if (lost(this)) return null;
      if (type !== K.VERTEX_SHADER && type !== K.FRAGMENT_SHADER) { err(this, K.INVALID_ENUM, 'createShader with an invalid type ' + type); return null; }
      return new WebGLShader(this, type);
    };
    P.shaderSource = function (sh, src) {
      if (lost(this) || !sh) return;
      if (!(sh instanceof WebGLShader)) throw new TypeError("Failed to execute 'shaderSource' on 'WebGLRenderingContext': parameter 1 is not of type 'WebGLShader'.");
      sh.source = String(src);
    };
    P.compileShader = function (sh) {
      if (lost(this) || !sh) return;
      sh.compiled = true;
      S.gl.compiles++;
      S.gl.shaders.push({ type: sh.type === K.VERTEX_SHADER ? 'vertex' : 'fragment', source: sh.source, script: S.currentScript, stack: S.callerStack() });
    };
    P.getShaderParameter = function (sh, p) {
      if (lost(this)) return null;
      if (!sh) { err(this, K.INVALID_VALUE, 'getShaderParameter(null)'); return null; }
      if (p === K.COMPILE_STATUS) return sh.compiled;
      if (p === K.SHADER_TYPE) return sh.type;
      if (p === K.DELETE_STATUS) return sh._deleted;
      err(this, K.INVALID_ENUM, 'getShaderParameter pname 0x' + Number(p).toString(16)); return null;
    };
    P.getShaderInfoLog = function (sh) { return lost(this) ? null : ''; };
    P.getShaderSource = function (sh) { return sh ? sh.source : null; };
    P.getShaderPrecisionFormat = function () { return lost(this) ? null : { rangeMin: 127, rangeMax: 127, precision: 23 }; };
    P.deleteShader = function (sh) { if (sh) sh._deleted = true; };
    P.isShader = function (sh) { return !!sh && sh instanceof WebGLShader && !sh._deleted; };
    P.createProgram = function () { return lost(this) ? null : new WebGLProgram(this); };
    P.attachShader = function (pr, sh) {
      if (lost(this) || !pr || !sh) return;
      if (pr.shaders.indexOf(sh) >= 0) { err(this, K.INVALID_OPERATION, 'attachShader: shader already attached'); return; }
      pr.shaders.push(sh);
    };
    P.detachShader = function (pr, sh) { if (pr) { var i = pr.shaders.indexOf(sh); if (i >= 0) pr.shaders.splice(i, 1); } };
    P.bindAttribLocation = function (pr, idx, name) { if (pr) pr.attribs[name] = idx; };
    P.linkProgram = function (pr) {
      if (lost(this) || !pr) return;
      var v = 0, f = 0;
      for (var i = 0; i < pr.shaders.length; i++) { if (pr.shaders[i].type === K.VERTEX_SHADER) v++; else f++; }
      if (v !== 1 || f !== 1) issue('gl-link', 'linkProgram with ' + v + ' vertex and ' + f + ' fragment shaders attached (a real driver fails the link)', 'warn', true);
      pr.linked = true;
    };
    P.getProgramParameter = function (pr, p) {
      if (lost(this)) return null;
      if (!pr) { err(this, K.INVALID_VALUE, 'getProgramParameter(null)'); return null; }
      if (p === K.LINK_STATUS || p === K.VALIDATE_STATUS) return pr.linked;
      if (p === K.DELETE_STATUS) return pr._deleted;
      if (p === K.ATTACHED_SHADERS) return pr.shaders.length;
      if (p === K.ACTIVE_UNIFORMS || p === K.ACTIVE_ATTRIBUTES) return 0;
      err(this, K.INVALID_ENUM, 'getProgramParameter pname 0x' + Number(p).toString(16)); return null;
    };
    P.getProgramInfoLog = function () { return lost(this) ? null : ''; };
    P.validateProgram = function () {};
    P.useProgram = function (pr) {
      if (lost(this)) return;
      if (pr && !pr.linked) { err(this, K.INVALID_OPERATION, 'useProgram on a program that was never linked'); return; }
      if (pr && pr._deleted) { err(this, K.INVALID_VALUE, 'useProgram on a deleted program'); return; }
      if (pr && pr._gen !== this.__st.gen) { err(this, K.INVALID_OPERATION, 'useProgram with a program created before the context was lost (rebuild GL resources on webglcontextrestored)'); return; }
      this.__st.program = pr || null;
    };
    P.deleteProgram = function (pr) { if (pr) { pr._deleted = true; if (this.__st.program === pr) this.__st.program = null; } };
    P.isProgram = function (pr) { return !!pr && pr instanceof WebGLProgram && !pr._deleted; };
    P.getActiveUniform = function () { return null; };
    P.getActiveAttrib = function () { return null; };
    P.getAttachedShaders = function (pr) { return pr ? pr.shaders.slice() : null; };
    P.getAttribLocation = function (pr, name) {
      if (lost(this)) return -1;
      if (!pr) { err(this, K.INVALID_VALUE, 'getAttribLocation(null)'); return -1; }
      if (!pr.linked) { err(this, K.INVALID_OPERATION, 'getAttribLocation before linkProgram'); return -1; }
      if (!(name in pr.attribs)) pr.attribs[name] = pr.nextAttrib++;
      return pr.attribs[name];
    };
    P.getUniformLocation = function (pr, name) {
      if (lost(this)) return null;
      if (!pr) { err(this, K.INVALID_VALUE, 'getUniformLocation(null)'); return null; }
      if (!pr.linked) { err(this, K.INVALID_OPERATION, 'getUniformLocation before linkProgram'); return null; }
      return new WebGLUniformLocation(pr, String(name));
    };
    P.getUniform = function () { return null; };

    function uniformFn(name, count, isVector, isMatrix) {
      return function (loc) {
        if (lost(this) || loc === null || loc === undefined) return;
        if (!(loc instanceof WebGLUniformLocation)) throw new TypeError("Failed to execute '" + name + "' on 'WebGLRenderingContext': parameter 1 is not of type 'WebGLUniformLocation'.");
        var st = this.__st;
        if (!st.program) { err(this, K.INVALID_OPERATION, name + ' "' + loc._name + '" with no program in use'); return; }
        if (loc._program !== st.program) { err(this, K.INVALID_OPERATION, name + ' "' + loc._name + '": location belongs to another program than the one in use'); return; }
        var val;
        if (isMatrix) {
          var data = arguments[2];
          if (arguments[1]) { err(this, K.INVALID_VALUE, name + ' transpose must be false in WebGL1'); return; }
          if (!data || typeof data.length !== 'number' || data.length % count) { err(this, K.INVALID_VALUE, name + ' "' + loc._name + '" needs a multiple of ' + count + ' values'); return; }
          val = data[0];
        } else if (isVector) {
          var arr = arguments[1];
          if (!arr || typeof arr.length !== 'number') throw new TypeError("Failed to execute '" + name + "': parameter 2 is not a sequence.");
          if (arr.length === 0 || arr.length % count) { err(this, K.INVALID_VALUE, name + ' "' + loc._name + '" needs a multiple of ' + count + ' values, got ' + arr.length); return; }
          val = arr[0];
        } else {
          if (arguments.length - 1 < count) throw new TypeError("Failed to execute '" + name + "' on 'WebGLRenderingContext': " + (count + 1) + ' arguments required, but only ' + arguments.length + ' present.');
          val = arguments[1];
          for (var i = 1; i <= count; i++) {
            var v = arguments[i];
            if (typeof v !== 'number' && typeof v !== 'boolean') { issue('gl-uniform', name + ' "' + loc._name + '" received a non-number (' + typeof v + ')', 'warn', true); break; }
            if (v !== v) { issue('gl-uniform', name + ' "' + loc._name + '" received NaN', 'warn', true); break; }
          }
        }
        var key = loc._name;
        var rec = S.gl.uniformValues[key] || (S.gl.uniformValues[key] = { min: Infinity, max: -Infinity, n: 0, fn: name });
        if (typeof val === 'number') { if (val < rec.min) rec.min = val; if (val > rec.max) rec.max = val; }
        rec.n++;
      };
    }
    ['1f', '1i'].forEach(function (s) { P['uniform' + s] = uniformFn('uniform' + s, 1); });
    ['2f', '2i'].forEach(function (s) { P['uniform' + s] = uniformFn('uniform' + s, 2); });
    ['3f', '3i'].forEach(function (s) { P['uniform' + s] = uniformFn('uniform' + s, 3); });
    ['4f', '4i'].forEach(function (s) { P['uniform' + s] = uniformFn('uniform' + s, 4); });
    ['1fv', '1iv'].forEach(function (s) { P['uniform' + s] = uniformFn('uniform' + s, 1, true); });
    ['2fv', '2iv'].forEach(function (s) { P['uniform' + s] = uniformFn('uniform' + s, 2, true); });
    ['3fv', '3iv'].forEach(function (s) { P['uniform' + s] = uniformFn('uniform' + s, 3, true); });
    ['4fv', '4iv'].forEach(function (s) { P['uniform' + s] = uniformFn('uniform' + s, 4, true); });
    P.uniformMatrix2fv = uniformFn('uniformMatrix2fv', 4, false, true);
    P.uniformMatrix3fv = uniformFn('uniformMatrix3fv', 9, false, true);
    P.uniformMatrix4fv = uniformFn('uniformMatrix4fv', 16, false, true);

    // buffers / attributes
    P.createBuffer = function () { return lost(this) ? null : new WebGLBuffer(this); };
    P.deleteBuffer = function (b) { if (b) b._deleted = true; };
    P.isBuffer = function (b) { return !!b && b instanceof WebGLBuffer && !b._deleted; };
    P.bindBuffer = function (target, b) {
      if (lost(this)) return;
      if (target !== K.ARRAY_BUFFER && target !== K.ELEMENT_ARRAY_BUFFER) { err(this, K.INVALID_ENUM, 'bindBuffer target'); return; }
      if (b && b._gen !== this.__st.gen) { err(this, K.INVALID_OPERATION, 'bindBuffer with a buffer created before the context was lost'); return; }
      this.__st.buffers[target] = b || null;
    };
    P.bufferData = function (target, data, usage) {
      if (lost(this)) return;
      var b = this.__st.buffers[target];
      if (!b) { err(this, K.INVALID_OPERATION, 'bufferData with no buffer bound'); return; }
      if (usage !== K.STATIC_DRAW && usage !== K.DYNAMIC_DRAW && usage !== K.STREAM_DRAW) { err(this, K.INVALID_ENUM, 'bufferData usage'); return; }
      b.size = typeof data === 'number' ? data : (data && data.byteLength) || 0;
    };
    P.bufferSubData = function (target) { if (!lost(this) && !this.__st.buffers[target]) err(this, K.INVALID_OPERATION, 'bufferSubData with no buffer bound'); };
    P.getBufferParameter = function (target, p) { var b = this.__st.buffers[target]; return b ? (p === K.BUFFER_SIZE ? b.size : K.STATIC_DRAW) : null; };
    P.enableVertexAttribArray = function (i) { if (!lost(this)) { if (i < 0 || i >= 16) { err(this, K.INVALID_VALUE, 'enableVertexAttribArray(' + i + ')'); return; } this.__st.enabledAttribs[i] = true; } };
    P.disableVertexAttribArray = function (i) { if (!lost(this)) delete this.__st.enabledAttribs[i]; };
    P.vertexAttribPointer = function (i, size, type, norm, stride, offset) {
      if (lost(this)) return;
      if (!this.__st.buffers[K.ARRAY_BUFFER]) { err(this, K.INVALID_OPERATION, 'vertexAttribPointer with no ARRAY_BUFFER bound'); return; }
      if (i < 0 || i >= 16 || size < 1 || size > 4) { err(this, K.INVALID_VALUE, 'vertexAttribPointer(' + i + ', size ' + size + ')'); return; }
      this.__st.attribBuffers[i] = this.__st.buffers[K.ARRAY_BUFFER];
    };
    P.getVertexAttrib = function () { return null; };
    P.getVertexAttribOffset = function () { return 0; };
    ['vertexAttrib1f', 'vertexAttrib2f', 'vertexAttrib3f', 'vertexAttrib4f', 'vertexAttrib1fv', 'vertexAttrib2fv', 'vertexAttrib3fv', 'vertexAttrib4fv'].forEach(function (n) { P[n] = function () {}; });

    function drawCheck(gl, what) {
      var st = gl.__st;
      if (!st.program) { err(gl, K.INVALID_OPERATION, what + ' with no program in use'); return false; }
      var any = false;
      for (var a in st.enabledAttribs) { if (!st.attribBuffers[a]) { err(gl, K.INVALID_OPERATION, what + ': attribute ' + a + ' enabled without vertexAttribPointer'); return false; } any = true; }
      if (!any) issue('gl-draw', what + ' with no enabled vertex attributes (draws nothing)', 'warn', true);
      return true;
    }
    P.drawArrays = function (mode, first, count) {
      if (lost(this)) return;
      if (count < 0 || first < 0) { err(this, K.INVALID_VALUE, 'drawArrays negative first/count'); return; }
      if (drawCheck(this, 'drawArrays')) S.gl.draws++;
    };
    P.drawElements = function (mode, count, type, offset) {
      if (lost(this)) return;
      if (!this.__st.buffers[K.ELEMENT_ARRAY_BUFFER]) { err(this, K.INVALID_OPERATION, 'drawElements with no ELEMENT_ARRAY_BUFFER bound'); return; }
      if (drawCheck(this, 'drawElements')) S.gl.draws++;
    };

    // state
    P.viewport = function (x, y, w, h) { if (!lost(this)) { if (w < 0 || h < 0) { err(this, K.INVALID_VALUE, 'viewport negative size'); return; } this.__st.viewport = [x, y, w, h]; } };
    P.scissor = function () {};
    P.clear = function (mask) { if (!lost(this) && (mask & ~(K.COLOR_BUFFER_BIT | K.DEPTH_BUFFER_BIT | K.STENCIL_BUFFER_BIT))) err(this, K.INVALID_VALUE, 'clear mask'); };
    P.clearColor = function (r, g, b, a) { if (!lost(this)) this.__st.clearColor = [r, g, b, a]; };
    P.clearDepth = function () {}; P.clearStencil = function () {};
    P.enable = function (c) { if (!lost(this)) this.__st.caps[c] = true; };
    P.disable = function (c) { if (!lost(this)) this.__st.caps[c] = false; };
    P.isEnabled = function (c) { return !!this.__st.caps[c]; };
    ['blendFunc', 'blendFuncSeparate', 'blendEquation', 'blendEquationSeparate', 'blendColor', 'depthFunc', 'depthMask',
      'depthRange', 'colorMask', 'cullFace', 'frontFace', 'lineWidth', 'polygonOffset', 'sampleCoverage', 'stencilFunc',
      'stencilFuncSeparate', 'stencilMask', 'stencilMaskSeparate', 'stencilOp', 'stencilOpSeparate', 'hint', 'flush', 'finish']
      .forEach(function (n) { P[n] = function () {}; });
    P.pixelStorei = function (p, v) { this.__st.pixelStore[p] = v; };
    P.getParameter = function (p) {
      if (lost(this)) return null;
      var st = this.__st;
      switch (p) {
        case K.VERSION: return 'WebGL 1.0 (APEIRON harness stub)';
        case K.SHADING_LANGUAGE_VERSION: return 'WebGL GLSL ES 1.0 (APEIRON harness stub)';
        case K.VENDOR: return 'APEIRON';
        case K.RENDERER: return 'Harness Stub';
        case K.MAX_TEXTURE_SIZE: case K.MAX_RENDERBUFFER_SIZE: case K.MAX_CUBE_MAP_TEXTURE_SIZE: return 4096;
        case K.MAX_VIEWPORT_DIMS: return new Int32Array([4096, 4096]);
        case K.VIEWPORT: return new Int32Array(st.viewport);
        case K.SCISSOR_BOX: return new Int32Array(st.viewport);
        case K.COLOR_CLEAR_VALUE: return new Float32Array(st.clearColor);
        case K.MAX_VERTEX_ATTRIBS: return 16;
        case K.MAX_VARYING_VECTORS: return 8;
        case K.MAX_VERTEX_UNIFORM_VECTORS: return 256;
        case K.MAX_FRAGMENT_UNIFORM_VECTORS: return 221;
        case K.MAX_TEXTURE_IMAGE_UNITS: case K.MAX_VERTEX_TEXTURE_IMAGE_UNITS: return 16;
        case K.MAX_COMBINED_TEXTURE_IMAGE_UNITS: return 32;
        case K.ALIASED_LINE_WIDTH_RANGE: case K.ALIASED_POINT_SIZE_RANGE: return new Float32Array([1, 1]);
        case K.CURRENT_PROGRAM: return st.program;
        case K.ARRAY_BUFFER_BINDING: return st.buffers[K.ARRAY_BUFFER] || null;
        case K.ELEMENT_ARRAY_BUFFER_BINDING: return st.buffers[K.ELEMENT_ARRAY_BUFFER] || null;
        case K.FRAMEBUFFER_BINDING: return st.fb;
        case K.RENDERBUFFER_BINDING: return st.rb;
        case K.ACTIVE_TEXTURE: return st.activeTexture;
        case K.TEXTURE_BINDING_2D: return st.textures[st.activeTexture] || null;
        case K.RED_BITS: case K.GREEN_BITS: case K.BLUE_BITS: case K.ALPHA_BITS: return 8;
        case K.DEPTH_BITS: return 16;
        case K.STENCIL_BITS: return 0;
        case K.SAMPLES: return 0;
        case K.SAMPLE_BUFFERS: return 0;
        case K.COMPRESSED_TEXTURE_FORMATS: return new Uint32Array(0);
        case K.BLEND: case K.DEPTH_TEST: case K.CULL_FACE: case K.SCISSOR_TEST: case K.STENCIL_TEST: return !!st.caps[p];
        case K.UNPACK_ALIGNMENT: case K.PACK_ALIGNMENT: return 4;
        case K.IMPLEMENTATION_COLOR_READ_FORMAT: return K.RGBA;
        case K.IMPLEMENTATION_COLOR_READ_TYPE: return K.UNSIGNED_BYTE;
        default: return null;
      }
    };
    // textures / framebuffers
    P.createTexture = function () { return lost(this) ? null : new WebGLTexture(this); };
    P.deleteTexture = function (t) { if (t) t._deleted = true; };
    P.isTexture = function (t) { return !!t && t instanceof WebGLTexture && !t._deleted; };
    P.bindTexture = function (target, tex) { if (!lost(this)) this.__st.textures[this.__st.activeTexture] = tex || null; };
    P.activeTexture = function (unit) { if (!lost(this)) { if (unit < K.TEXTURE0 || unit > K.TEXTURE0 + 31) { err(this, K.INVALID_ENUM, 'activeTexture'); return; } this.__st.activeTexture = unit; } };
    P.texImage2D = function () {
      if (lost(this)) return;
      if (!this.__st.textures[this.__st.activeTexture]) { err(this, K.INVALID_OPERATION, 'texImage2D with no texture bound'); return; }
      var n = arguments.length;
      if (n !== 6 && n !== 9) throw new TypeError("Failed to execute 'texImage2D' on 'WebGLRenderingContext': Valid arities are: [6, 9], but " + n + ' arguments provided.');
      if (n === 6) {
        var src = arguments[5];
        if (src && (src.width === 0 || src.height === 0)) issue('gl-tex', 'texImage2D from a zero-sized source', 'warn', true);
      }
    };
    P.texSubImage2D = function () {};
    P.texParameteri = function () {}; P.texParameterf = function () {};
    P.getTexParameter = function () { return null; };
    P.generateMipmap = function () {};
    P.copyTexImage2D = function () {}; P.copyTexSubImage2D = function () {};
    P.compressedTexImage2D = function () {}; P.compressedTexSubImage2D = function () {};
    P.createFramebuffer = function () { return lost(this) ? null : new WebGLFramebuffer(this); };
    P.deleteFramebuffer = function (f) { if (f) f._deleted = true; };
    P.isFramebuffer = function (f) { return !!f && !f._deleted; };
    P.bindFramebuffer = function (t, f) { if (!lost(this)) this.__st.fb = f || null; };
    P.framebufferTexture2D = function () {};
    P.framebufferRenderbuffer = function () {};
    P.checkFramebufferStatus = function () { return lost(this) ? 0 : K.FRAMEBUFFER_COMPLETE; };
    P.getFramebufferAttachmentParameter = function () { return null; };
    P.createRenderbuffer = function () { return lost(this) ? null : new WebGLRenderbuffer(this); };
    P.deleteRenderbuffer = function (r) { if (r) r._deleted = true; };
    P.isRenderbuffer = function (r) { return !!r && !r._deleted; };
    P.bindRenderbuffer = function (t, r) { if (!lost(this)) this.__st.rb = r || null; };
    P.renderbufferStorage = function () {};
    P.getRenderbufferParameter = function () { return null; };
    P.readPixels = function (x, y, w, h, f, t, out) {
      if (lost(this)) return;
      if (!out || typeof out.length !== 'number') throw new TypeError("Failed to execute 'readPixels': parameter 7 is not of type 'ArrayBufferView'.");
      S.counters.readPixels = (S.counters.readPixels || 0) + 1;
    };

    // ---------------------------------------------------------------- context loss simulation
    S.loseContext = function (gl) {
      var st = gl.__st;
      st.lost = true; st.lostReported = false;
      S.gl.losses++;
      var ev = new G.Event('webglcontextlost', { cancelable: true });
      ev.statusMessage = 'harness simulated loss';
      st.canvas.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    S.restoreContext = function (gl) {
      var st = gl.__st;
      st.lost = false; st.lostReported = false; st.program = null; st.gen++; st.buffers = {}; st.enabledAttribs = {}; st.attribBuffers = {}; st.textures = {};
      st.canvas.dispatchEvent(new G.Event('webglcontextrestored'));
    };
    return true;
  };
})(globalThis);
