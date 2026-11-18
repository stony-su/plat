/* tools/lib/glsl.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // GLSL ES 1.00 (WebGL1) pitfall linter. Heuristic but tuned for a low false-positive rate:
  // every rule fires only on constructs that ANGLE / WebGL1 drivers reject or that break the
  // CONTRACT §2.8 shader rules. lint(src, {stage:'fragment'|'vertex', complete:bool}) →
  // [{level:'error'|'warn', line, rule, msg}]. Chunks (complete:false, no main) skip the
  // whole-shader rules (precision, undeclared uniforms, function order, gl_FragColor).

  const TYPES = new Set(['void', 'bool', 'int', 'float', 'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4',
    'mat2', 'mat3', 'mat4', 'sampler2D', 'samplerCube']);
  const FLOATISH = new Set(['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4']);
  const ES3_TYPES = new Set(['uint', 'uvec2', 'uvec3', 'uvec4', 'sampler3D', 'sampler2DArray', 'sampler2DShadow', 'samplerCubeShadow', 'isampler2D', 'usampler2D',
    'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4']);
  const ES3_FUNCS = new Set(['round', 'roundEven', 'trunc', 'isnan', 'isinf', 'tanh', 'sinh', 'cosh', 'asinh', 'acosh', 'atanh', 'modf',
    'floatBitsToInt', 'floatBitsToUint', 'intBitsToFloat', 'uintBitsToFloat', 'packSnorm2x16', 'unpackSnorm2x16', 'packUnorm2x16',
    'unpackUnorm2x16', 'packHalf2x16', 'unpackHalf2x16', 'transpose', 'inverse', 'determinant', 'outerProduct', 'texture', 'textureLod',
    'textureProj', 'textureOffset', 'texelFetch', 'texelFetchOffset', 'textureSize', 'textureGrad', 'textureProjLod']);
  // float-only builtins in ES 1.00 (no int overloads): an integer literal argument is a compile error
  const FLOAT_FUNCS = new Set(['radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt',
    'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'length',
    'distance', 'dot', 'cross', 'normalize', 'faceforward', 'reflect', 'refract']);
  const BUILTINS = new Set([...FLOAT_FUNCS, 'texture2D', 'texture2DProj', 'texture2DLod', 'textureCube', 'textureCubeLod', 'matrixCompMult',
    'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual', 'any', 'all', 'not', 'dFdx', 'dFdy', 'fwidth',
    'texture2DProjLod', 'texture2DGradEXT', ...TYPES]);
  const KEYWORDS = new Set(['attribute', 'const', 'uniform', 'varying', 'break', 'continue', 'do', 'for', 'while', 'if', 'else', 'in', 'out', 'inout',
    'true', 'false', 'lowp', 'mediump', 'highp', 'precision', 'invariant', 'discard', 'return', 'struct']);

  // ---------------------------------------------------------------- tokenizer
  function tokenize(src) {
    const toks = [];
    let i = 0, line = 1, depth = 0, pdepth = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? n : j + 2; for (let k = i; k < e; k++) if (src[k] === '\n') line++; i = e; continue; }
      if (c === '#') {
        let j = i;
        while (j < n && src[j] !== '\n') { if (src[j] === '\\' && src[j + 1] === '\n') { j += 2; line++; continue; } j++; }
        toks.push({ t: 'pp', v: src.slice(i, j), line, depth, pdepth });
        i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j), line, depth, pdepth });
        i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i;
        const m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)[fFuU]?/.exec(src.slice(i, i + 40));
        j = i + (m ? m[0].length : 1);
        const v = src.slice(i, j);
        const isFloat = /[.eE]/.test(v) && !/^0[xX]/.test(v);
        toks.push({ t: isFloat ? 'float' : 'int', v, line, depth, pdepth });
        i = j; continue;
      }
      const three = src.substr(i, 3), two = src.substr(i, 2);
      let p = null;
      if (['<<=', '>>='].indexOf(three) >= 0) p = three;
      else if (['++', '--', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||', '^^', '<<', '>>', '&=', '|=', '^='].indexOf(two) >= 0) p = two;
      else p = c;
      if (p === '{') depth++;
      if (p === '}') depth--;
      if (p === '(') pdepth++;
      if (p === ')') pdepth--;
      toks.push({ t: 'p', v: p, line, depth: p === '{' ? depth - 1 : depth, pdepth });
      i += p.length;
    }
    return toks;
  }

  // ---------------------------------------------------------------- analysis
  function lint(src, opts) {
    opts = opts || {};
    const stage = opts.stage || (/gl_FragColor|gl_FragData|precision\s+\w+\s+float/.test(src) ? 'fragment' : /gl_Position/.test(src) ? 'vertex' : 'fragment');
    const toks = tokenize(src);
    const complete = opts.complete !== undefined ? opts.complete : toks.some((t, k) => t.v === 'main' && toks[k - 1] && toks[k - 1].v === 'void');
    const out = [];
    const seen = new Set();
    const E = (line, rule, msg, level) => { const key = rule + '|' + line + '|' + msg; if (seen.has(key)) return; seen.add(key); out.push({ level: level || 'error', line, rule, msg }); };
    // macros & declarations
    const macros = new Map();
    const consts = new Set();
    const uniforms = new Set();
    const declType = new Map();   // name → type ('mixed' when declared with conflicting int/float types)
    const arrays = new Set();
    const funcsDefined = new Map(); // name → first definition token index
    const funcsDeclared = new Map(); // prototypes
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'pp') {
        const m = /^#\s*define\s+([A-Za-z_]\w*)(\([^)]*\))?\s*(.*)$/.exec(t.v);
        if (m) macros.set(m[1], (m[3] || '').trim());
        const v = /^#\s*version\s+(\S+)(?:\s+(\S+))?/.exec(t.v);
        if (v && v[1] !== '100') E(t.line, 'version', '#version ' + v[1] + (v[2] ? ' ' + v[2] : '') + ' is not GLSL ES 1.00 (WebGL1 shaders must not declare 300 es)');
        if (/^#\s*extension/.test(t.v)) E(t.line, 'extension', 'extension directive "' + t.v.trim() + '" (getExtension may return null; WebGL1 contexts here request none)', 'warn');
        continue;
      }
      if (t.t !== 'id') continue;
      if (ES3_TYPES.has(t.v)) E(t.line, 'es3-type', 'type ' + t.v + ' does not exist in GLSL ES 1.00');
      if (t.v === 'switch' || t.v === 'case') E(t.line, 'switch', '"' + t.v + '" is not supported in GLSL ES 1.00 (use if/else)');
      if (t.v === 'layout' && toks[k + 1] && toks[k + 1].v === '(') E(t.line, 'layout', 'layout qualifiers are GLSL ES 3.00');
      if ((t.v === 'in' || t.v === 'out') && t.depth === 0 && t.pdepth === 0 && toks[k + 1] && toks[k + 1].t === 'id' && (TYPES.has(toks[k + 1].v) || ['lowp', 'mediump', 'highp', 'flat', 'smooth'].indexOf(toks[k + 1].v) >= 0)) {
        E(t.line, 'in-out', 'global "' + t.v + '" qualifier is GLSL ES 3.00; use ' + (t.v === 'in' ? (stage === 'vertex' ? 'attribute' : 'varying') : 'varying / gl_FragColor'));
      }
      if (/^gl_/.test(t.v) && toks[k - 1] && toks[k - 1].t === 'id' && TYPES.has(toks[k - 1].v)) E(t.line, 'reserved', 'identifier ' + t.v + ' uses the reserved gl_ prefix');
      // declarations: [const|uniform|attribute|varying] [precision] TYPE name [ [N] ] ...
      if (TYPES.has(t.v) && t.v !== 'void') {
        let j = k + 1;
        while (toks[j] && toks[j].t === 'id' && ['lowp', 'mediump', 'highp'].indexOf(toks[j].v) >= 0) j++;
        const nameTok = toks[j];
        if (!nameTok || nameTok.t !== 'id' || TYPES.has(nameTok.v) || KEYWORDS.has(nameTok.v)) continue;
        const nextTok = toks[j + 1];
        if (nextTok && nextTok.v === '(') {
          // function definition or prototype at global scope
          if (t.depth === 0) {
            let d = 0, q = j + 1;
            for (; q < toks.length; q++) { if (toks[q].v === '(') d++; else if (toks[q].v === ')') { d--; if (d === 0) break; } }
            const after = toks[q + 1];
            if (after && after.v === '{') { if (!funcsDefined.has(nameTok.v)) funcsDefined.set(nameTok.v, k); }
            else if (after && after.v === ';') funcsDeclared.set(nameTok.v, k);
            // parameters
            for (let r = j + 2; r < q; r++) {
              const pt = toks[r];
              if (pt.t === 'id' && TYPES.has(pt.v) && toks[r + 1] && toks[r + 1].t === 'id' && !TYPES.has(toks[r + 1].v)) noteDecl(toks[r + 1].v, pt.v);
            }
          }
          continue;
        }
        // variable declaration list: name [= ...] {, name2 ...}
        const quals = [];
        for (let b = k - 1; b >= 0 && toks[b].t === 'id' && ['const', 'uniform', 'attribute', 'varying', 'lowp', 'mediump', 'highp', 'invariant', 'in', 'out', 'inout'].indexOf(toks[b].v) >= 0; b--) quals.push(toks[b].v);
        let q = j;
        while (toks[q] && toks[q].t === 'id') {
          const nm = toks[q].v;
          noteDecl(nm, t.v);
          if (quals.indexOf('const') >= 0) consts.add(nm);
          if (quals.indexOf('uniform') >= 0) uniforms.add(nm);
          let r = q + 1;
          if (toks[r] && toks[r].v === '[') {
            arrays.add(nm);
            if (quals.indexOf('const') >= 0 || (toks[r + 1] && toks[r + 1].v === ']')) E(toks[r].line, 'array-init', (quals.indexOf('const') >= 0 ? 'const arrays' : 'unsized arrays') + ' are not supported in GLSL ES 1.00');
            while (toks[r] && toks[r].v !== ']') r++;
            r++;
          }
          // global initializer must be constant
          if (toks[r] && toks[r].v === '=' && t.depth === 0 && quals.indexOf('const') < 0 && quals.indexOf('uniform') < 0) {
            for (let s = r + 1; toks[s] && toks[s].v !== ';' && toks[s].v !== ','; s++) {
              if (toks[s].t === 'id' && (uniforms.has(toks[s].v) || /^u[A-Z]/.test(toks[s].v) || toks[s].v === 'gl_FragCoord')) {
                E(toks[s].line, 'global-init', 'global "' + nm + '" is initialised from ' + toks[s].v + '; GLSL ES 1.00 global initialisers must be constant expressions');
                break;
              }
            }
          }
          // skip initializer to the next declarator
          let d = 0;
          while (toks[r] && !(d === 0 && (toks[r].v === ',' || toks[r].v === ';'))) { if (toks[r].v === '(' || toks[r].v === '[') d++; else if (toks[r].v === ')' || toks[r].v === ']') d--; r++; }
          if (!toks[r] || toks[r].v === ';') break;
          q = r + 1;
        }
      }
    }
    function noteDecl(nm, type) {
      const prev = declType.get(nm);
      const cls = FLOATISH.has(type) ? 'float' : (type === 'int' || /^ivec/.test(type)) ? 'int' : type;
      if (prev === undefined) declType.set(nm, cls);
      else if (prev !== cls) declType.set(nm, 'mixed');
    }
    const isFloatName = nm => declType.get(nm) === 'float';
    const isIntName = nm => declType.get(nm) === 'int';
    const constLike = tok => tok && (tok.t === 'int' || tok.t === 'float' || (tok.t === 'id' && (consts.has(tok.v) || macros.has(tok.v))));

    // ---------------------------------------------------------------- per-token rules
    const loopVars = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      const prev = toks[k - 1], next = toks[k + 1];
      if (t.t === 'p') {
        if (t.v === '%' || t.v === '%=') E(t.line, 'modulo', 'the % operator is reserved in GLSL ES 1.00; use mod()');
        if (['&', '|', '^', '<<', '>>', '~', '&=', '|=', '^=', '<<=', '>>='].indexOf(t.v) >= 0) E(t.line, 'bitwise', 'bitwise operator ' + t.v + ' is reserved in GLSL ES 1.00');
        continue;
      }
      if (t.t !== 'id') continue;
      // ES3 builtin calls (unless the shader defines a function of that name)
      if (next && next.v === '(' && ES3_FUNCS.has(t.v) && !funcsDefined.has(t.v) && !(prev && prev.t === 'id' && TYPES.has(prev.v))) {
        E(t.line, 'es3-func', t.v + '() is not available in GLSL ES 1.00' + (t.v === 'texture' ? ' (use texture2D)' : t.v === 'round' ? ' (use floor(x + 0.5))' : ''));
      }
      if (t.v === 'while') E(t.line, 'while', 'while loops are not guaranteed in GLSL ES 1.00 (Appendix A); use a for loop with a constant bound', 'warn');
      if (t.v === 'do' && next && next.v === '{') E(t.line, 'while', 'do-while loops are not guaranteed in GLSL ES 1.00 (Appendix A)', 'warn');
      // for loops: for (int i = c0; i < c1; i++)
      if (t.v === 'for' && next && next.v === '(') {
        let d = 0, q = k + 1;
        const parts = [[]];
        for (; q < toks.length; q++) {
          const u = toks[q];
          if (u.v === '(') { d++; if (d === 1) continue; }
          else if (u.v === ')') { d--; if (d === 0) break; }
          if (d === 1 && u.v === ';') { parts.push([]); continue; }
          parts[parts.length - 1].push(u);
        }
        const init = parts[0] || [], cond = parts[1] || [], incr = parts[2] || [];
        let lv = null;
        if (init.length >= 2 && init[0].t === 'id' && TYPES.has(init[0].v)) lv = init[1] && init[1].v;
        else if (init.length >= 1 && init[0].t === 'id') lv = init[0].v;
        if (lv) loopVars.push(lv);
        const condOk = cond.length >= 3 && cond[0].v === lv && ['<', '<=', '>', '>=', '==', '!='].indexOf(cond[1].v) >= 0;
        if (!condOk) E(t.line, 'loop-bound', 'for-loop condition must be "' + (lv || 'i') + ' <relop> constant" in GLSL ES 1.00');
        else {
          const rhs = cond.slice(2);
          const bad = rhs.filter(u => u.t === 'id' && !consts.has(u.v) && !macros.has(u.v) && !TYPES.has(u.v) && !FLOAT_FUNCS.has(u.v));
          if (bad.length) E(t.line, 'loop-bound', 'for-loop bound uses ' + bad.map(u => u.v).join(', ') + ' which is not a constant expression (uniforms and variables are not allowed in GLSL ES 1.00)');
          const lit = rhs.length === 1 && (rhs[0].t === 'int' || rhs[0].t === 'float') ? parseFloat(rhs[0].v) : (rhs.length === 1 && macros.has(rhs[0].v) ? parseFloat(macros.get(rhs[0].v)) : NaN);
          if (isFinite(lit) && lit > 128) E(t.line, 'loop-cost', 'for-loop runs ' + lit + ' iterations per pixel (budget: ≤ 2 ms GPU)', 'warn');
          const fname = enclosingFunction(toks, k);
          if (isFinite(lit) && lit > 4 && (/oct/i.test(lv || '') || /^(fbm|noise|turb)/i.test(fname || ''))) E(t.line, 'octaves', 'noise loop with ' + lit + ' octaves in ' + (fname || 'a function') + ' (CONTRACT §2.8: ≤ 4 noise octaves)', 'warn');
        }
        const incOk = incr.length === 2 && ((incr[0].v === lv && (incr[1].v === '++' || incr[1].v === '--')) || ((incr[0].v === '++' || incr[0].v === '--') && incr[1].v === lv)) ||
          (incr.length >= 3 && incr[0].v === lv && (incr[1].v === '+=' || incr[1].v === '-=') && incr.slice(2).every(constLike));
        if (!incOk && lv) E(t.line, 'loop-step', 'for-loop increment must be ' + lv + '++, ' + lv + '--, or ' + lv + ' += constant in GLSL ES 1.00');
        continue;
      }
      // dynamic indexing of declared arrays (fragment shaders: constant-index-expressions only)
      if (arrays.has(t.v) && next && next.v === '[' && !(prev && prev.t === 'id' && TYPES.has(prev.v))) {
        let d = 0, q = k + 1;
        const idx = [];
        for (; q < toks.length; q++) { const u = toks[q]; if (u.v === '[') { d++; if (d === 1) continue; } else if (u.v === ']') { d--; if (d === 0) break; } idx.push(u); }
        const bad = idx.filter(u => u.t === 'id' && !consts.has(u.v) && !macros.has(u.v) && loopVars.indexOf(u.v) < 0 && !FLOAT_FUNCS.has(u.v) && !TYPES.has(u.v));
        if (bad.length && stage === 'fragment') E(t.line, 'dyn-index', t.v + '[...] is indexed with ' + bad.map(u => u.v).join(', ') + '; fragment shaders may only index with constants and loop indices');
      }
      // float-only builtins with an integer literal argument
      if (FLOAT_FUNCS.has(t.v) && next && next.v === '(' && !funcsDefined.has(t.v) && !(prev && prev.t === 'id' && TYPES.has(prev.v))) {
        let d = 0, q = k + 1, argStart = true, argToks = [];
        const args = [];
        for (; q < toks.length; q++) {
          const u = toks[q];
          if (u.v === '(' || u.v === '[') { d++; if (d === 1 && u.v === '(') continue; }
          else if (u.v === ')' || u.v === ']') { d--; if (d === 0) break; }
          if (d === 1 && u.v === ',') { args.push(argToks); argToks = []; continue; }
          argToks.push(u);
        }
        args.push(argToks);
        for (const a of args) {
          if (a.length === 1 && a[0].t === 'int') E(a[0].line, 'int-float', t.v + '(…, ' + a[0].v + ', …): integer literal where ' + t.v + ' needs a float (write ' + a[0].v + '.0)');
          if (a.length === 2 && a[0].v === '-' && a[1].t === 'int') E(a[1].line, 'int-float', t.v + '(…, -' + a[1].v + ', …): integer literal where ' + t.v + ' needs a float (write -' + a[1].v + '.0)');
        }
      }
      // float variable ⟷ integer literal in arithmetic / comparison / assignment
      if (isFloatName(t.v) && !(prev && prev.v === '.')) {
        // skip a swizzle: p.x
        let q = k + 1;
        if (toks[q] && toks[q].v === '.' && toks[q + 1] && toks[q + 1].t === 'id') q += 2;
        const op = toks[q], lit = toks[q + 1];
        if (op && lit && lit.t === 'int' && ['+', '-', '*', '/', '<', '>', '<=', '>=', '==', '!=', '=', '+=', '-=', '*=', '/='].indexOf(op.v) >= 0) {
          const after = toks[q + 2];
          if (!(after && (after.v === '.' || after.v === '['))) E(lit.line, 'int-float', t.v + ' ' + op.v + ' ' + lit.v + ': ' + t.v + ' is a float type and ' + lit.v + ' an int; GLSL ES 1.00 has no implicit conversion (write ' + lit.v + '.0)');
        }
      }
      if (prev && ['*', '+', '/'].indexOf(prev.v) >= 0 && toks[k - 2] && toks[k - 2].t === 'int' && isFloatName(t.v) && !(toks[k - 3] && toks[k - 3].v === '.')) {
        E(t.line, 'int-float', toks[k - 2].v + ' ' + prev.v + ' ' + t.v + ': int literal with a float operand (write ' + toks[k - 2].v + '.0)');
      }
    }

    // ---------------------------------------------------------------- whole-shader rules
    if (complete) {
      if (stage === 'fragment') {
        const pm = /precision\s+(lowp|mediump|highp)\s+float\s*;/.exec(src);
        if (!pm) E(1, 'precision', 'fragment shader has no "precision mediump float;" (required in GLSL ES 1.00 fragment shaders)');
        else if (pm[1] !== 'mediump') E(lineOf(src, pm.index), 'precision', 'precision ' + pm[1] + ' float (CONTRACT §2.8 asks for mediump)', 'warn');
        if (!/gl_FragColor/.test(src) && !/gl_FragData/.test(src)) E(1, 'output', 'fragment shader never writes gl_FragColor');
      } else {
        if (!/attribute\s+(?:\w+\s+)?vec2\s+aPos\b/.test(src)) E(1, 'apos', 'vertex shader does not declare "attribute vec2 aPos" (AP.GL.drawFullscreen binds aPos to location 0)', 'warn');
      }
      // uniforms used but never declared (uName convention)
      for (const tk of toks) {
        if (tk.t === 'id' && /^u[A-Z]\w*$/.test(tk.v) && !uniforms.has(tk.v) && !declType.has(tk.v) && !macros.has(tk.v)) E(tk.line, 'undeclared', 'uniform-like identifier ' + tk.v + ' is used but never declared');
      }
      // user functions called before their definition (no prototype)
      for (let k = 0; k < toks.length; k++) {
        const tk = toks[k];
        if (tk.t !== 'id' || !toks[k + 1] || toks[k + 1].v !== '(' || BUILTINS.has(tk.v)) continue;
        if (toks[k - 1] && toks[k - 1].t === 'id' && TYPES.has(toks[k - 1].v)) continue;   // the definition itself
        const def = funcsDefined.get(tk.v);
        if (def === undefined) continue;
        if (k < def && !funcsDeclared.has(tk.v)) E(tk.line, 'fn-order', tk.v + '() is called before it is defined (GLSL needs a definition or prototype first)');
      }
    }
    out.sort((a, b) => a.line - b.line);
    return out;
  }
  function lineOf(src, idx) { let l = 1; for (let k = 0; k < idx; k++) if (src.charCodeAt(k) === 10) l++; return l; }
  function enclosingFunction(toks, k) {
    for (let j = k; j >= 0; j--) {
      if (toks[j].v === '{' && toks[j].depth === 0) {
        for (let q = j - 1; q >= 0 && q > j - 40; q--) if (toks[q].v === '(' && toks[q - 1] && toks[q - 1].t === 'id' && toks[q - 2] && toks[q - 2].t === 'id' && TYPES.has(toks[q - 2].v)) return toks[q - 1].v;
        return null;
      }
    }
    return null;
  }
  function uniformsOf(src) {
    const out = new Set();
    const re = /\buniform\s+(?:lowp\s+|mediump\s+|highp\s+)?\w+\s+([A-Za-z_]\w*)/g;
    let m;
    while ((m = re.exec(src))) out.add(m[1]);
    return out;
  }

  exports.lint = lint;
  exports.tokenize = tokenize;
  exports.uniformsOf = uniformsOf;
})(module.exports);
