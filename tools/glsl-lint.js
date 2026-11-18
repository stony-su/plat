/* tools/glsl-lint.js — owner: TOOLS */
(function () {
  'use strict';
  // GLSL ES 1.00 lint for ART's shaders (CONTRACT §2.8, risk #7).
  //   static   every GLSL string in js/art/*.js (strings containing 'precision mediump float' or
  //            gl_FragColor, plus GLSL template chunks), same-file string variables resolved;
  //            chunks without main() get the per-chunk rules only
  //   runtime  the complete shaders: AP.Backgrounds.source(key) for every AP.STYLES key and
  //            every shader compiled through the stub WebGL context; uTime must stay ≤ 3600
  //            after rendering at t = 5000 s (wrap); uniform names the JS asks for must exist
  // Rules (tools/lib/glsl.js): #version 300, global in/out, texture()/ES3 builtins and types,
  // non-constant loop bounds/steps, dynamic array indexing, missing/non-mediump precision,
  // int/float mixing, undeclared u* uniforms, functions used before definition, non-constant
  // global initialisers, % and bitwise operators, switch, const arrays, >4 noise octaves.
  //   node tools/glsl-lint.js [--static-only] [--verbose] [files...]

  const cli = require('./lib/cli');
  const jstok = require('./lib/jstok');
  const glsl = require('./lib/glsl');

  const MARK = /precision\s+mediump\s+float|gl_FragColor/;
  const LOOKS_GLSL = /\b(vec[234]|mat[234]|float|uniform|void)\b[\s\S]*[;{]/;

  // ---------------------------------------------------------------- static extraction
  function extract(rel) {
    const src = cli.read(rel);
    const tk = jstok.tokenize(src);
    const sig = jstok.significant(tk.tokens);
    // string variables: var NAME = <run>
    const runs = jstok.stringRuns(tk.tokens).concat(jstok.arrayJoinRuns(tk.tokens));
    const byStart = new Map();
    for (const r of runs) byStart.set(r.startTok, r);
    const vars = new Map();
    for (let i = 0; i + 3 < sig.length; i++) {
      if (!(sig[i].t === 'ident' && /^(var|let|const)$/.test(sig[i].v) && sig[i + 1].t === 'ident' && sig[i + 2].v === '=')) continue;
      const r = byStart.get(sig[i + 3]);
      if (r) vars.set(sig[i + 1].v, r);
    }
    const resolve = (run, depth) => {
      let s = '';
      let unresolved = 0;
      for (const p of run.parts) {
        if (p.lit !== undefined) s += p.lit;
        else if (p.ref && vars.has(p.ref) && depth < 4) { const r = resolve(vars.get(p.ref), depth + 1); s += r.text; unresolved += r.unresolved; }
        else { s += '\n'; unresolved++; }
      }
      return { text: s, unresolved };
    };
    const out = [];
    const seen = new Set();
    for (const r of runs) {
      const res = resolve(r, 0);
      const text = res.text;
      if (!MARK.test(text) && !(LOOKS_GLSL.test(text) && /;\s*$|}\s*$|;\n|\n}/.test(text) && text.length > 80)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ file: rel, line: r.line, text, partial: res.unresolved > 0 });
    }
    // drop runs fully contained in a longer extracted run (a variable referenced by another)
    return out.filter(a => !out.some(b => b !== a && b.text.length > a.text.length && b.text.indexOf(a.text) >= 0 && b.file === a.file));
  }

  // where a GLSL line lives in the art sources (for runtime shaders)
  function locate(lineText, artFiles) {
    const needle = lineText.trim();
    if (needle.length < 8) return null;
    for (const f of artFiles) {
      const lines = cli.read(f).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (l === needle || l.indexOf(needle) >= 0 && needle.length > 16) return f + ':' + (i + 1);
        // string-literal form: '  code',
        const m = /^['"`](.*)['"`],?\s*(\+\s*)?$/.exec(l);
        if (m && m[1].trim() === needle) return f + ':' + (i + 1);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- runtime capture
  function runtime(rep, artFiles) {
    const harness = require('./lib/harness');
    let h;
    try { h = harness.create({ gl: 'stub', boot: false }); }
    catch (e) { rep.warn('runtime', 'harness failed: ' + e.message); return null; }
    harness.ensureBoot(h);
    const AP = h.AP;
    const shaders = [];
    const seen = new Set();
    const addShader = (stage, source, label) => {
      if (typeof source !== 'string' || !source.trim()) return;
      const key = stage + '|' + source;
      if (seen.has(key)) return;
      seen.add(key);
      shaders.push({ stage, source, label });
    };
    const BG = AP && AP.Backgrounds;
    const styles = (AP && AP.STYLES) || ['title', 'map', 'w1', 'w2', 'w3', 'w4', 'w5', 'endless', 'void'];
    if (BG && typeof BG.source === 'function') {
      for (const k of styles) {
        let s = null;
        try { s = BG.source(k); } catch (e) { rep.error('AP.Backgrounds.source(' + k + ')', 'threw: ' + e.message); }
        if (s) { addShader('vertex', s.vs, 'style ' + k + ' vertex'); addShader('fragment', s.fs, 'style ' + k + ' fragment'); }
      }
    }
    // render every style once far past the wrap point, then read what was compiled and set
    const gl = AP && AP.GL && AP.GL.gl;
    if (BG && typeof BG.render === 'function' && gl) {
      for (const k of styles) {
        const p = { t: 5000, camX: 1234, camY: 567, w: 960, h: 540, intensity: 0.7, beat: 3.5, phase: 0.5, pal: AP.Worlds ? AP.Worlds.pal(k) : {}, seed: 7, quality: { particles: 1, bg: 'high', mid: true } };
        try { BG.render(gl, k, p); } catch (e) { rep.error('AP.Backgrounds.render(' + k + ')', 'threw: ' + e.message); }
      }
    }
    for (const s of (h.S.gl && h.S.gl.shaders) || []) addShader(s.type, s.source, 'compiled ' + s.type + ' shader' + (s.script ? ' (' + s.script + ')' : ''));
    const ut = h.S.gl && h.S.gl.uniformValues && h.S.gl.uniformValues.uTime;
    const uniformNames = new Set(Object.keys((h.S.gl && h.S.gl.uniformValues) || {}));
    return { shaders, uTime: ut || null, uniformNames, rendered: !!(BG && gl) };
  }

  // ---------------------------------------------------------------- main
  function run(argv) {
    const args = cli.parseArgs(argv, { staticOnly: 'bool', verbose: 'bool' });
    const rep = new cli.Report('glsl-lint');
    for (const e of args._errors) rep.error('args', e);
    const artFiles = args._.length ? args._.map(f => cli.rel(f)) : cli.listDir('js/art', p => /\.js$/.test(p));
    if (!artFiles.length) { rep.warn('files', 'no js/art/*.js files yet'); console.log(rep.summary()); return 0; }
    let nStatic = 0, nRuntime = 0;
    const declared = new Set();
    // static
    for (const f of artFiles) {
      let chunks = [];
      try { chunks = extract(f); } catch (e) { rep.error(f, 'extraction failed: ' + e.message); continue; }
      for (const c of chunks) {
        nStatic++;
        // a static string is a whole shader only when it is self-contained (main + precision);
        // chunks assembled with a header elsewhere get the per-chunk rules (runtime lints the whole)
        const complete = /\bvoid\s+main\s*\(/.test(c.text) && !c.partial && (/gl_Position/.test(c.text) || /precision\s+\w+\s+float/.test(c.text));
        const stage = /gl_Position/.test(c.text) && !/gl_FragColor/.test(c.text) ? 'vertex' : 'fragment';
        for (const u of glsl.uniformsOf(c.text)) declared.add(u);
        for (const i of glsl.lint(c.text, { stage, complete })) rep.add(i.level, c.file + ':' + (c.line + i.line - 1), '[' + i.rule + '] ' + i.msg);
      }
    }
    // runtime
    let rt = null;
    if (!args.staticOnly) {
      rt = runtime(rep, artFiles);
      if (rt) {
        for (const s of rt.shaders) {
          nRuntime++;
          for (const u of glsl.uniformsOf(s.source)) declared.add(u);
          const lines = s.source.split('\n');
          for (const i of glsl.lint(s.source, { stage: s.stage, complete: true })) {
            const where = locate(lines[i.line - 1] || '', artFiles);
            rep.add(i.level, (where || s.label + ' line ' + i.line), '[' + i.rule + '] ' + i.msg + (where ? cli.C.dim(' (' + s.label + ')') : ''));
          }
        }
        if (rt.uTime) {
          if (rt.uTime.max > 3600) rep.error('uTime', 'uTime reached ' + rt.uTime.max.toFixed(1) + ' after rendering at t = 5000 s; it must wrap at 3600 s (mediump precision)');
          else rep.info('uTime', 'wraps (max ' + rt.uTime.max.toFixed(1) + ' at t = 5000 s)');
        } else if (rt.rendered) rep.warn('uTime', 'no uTime uniform was set while rendering the backgrounds');
        for (const u of rt.uniformNames) if (!declared.has(u)) rep.warn('uniforms', 'the JS sets uniform "' + u + '" which no shader declares (getUniformLocation returns null; the value is dropped)');
      }
    }
    // JS-side uniform names in getUniformLocation(…, 'uX') calls
    for (const f of artFiles) {
      const src = cli.read(f);
      const re = /getUniformLocation\s*\(\s*[^,]+,\s*['"]([A-Za-z_]\w*)['"]/g;
      let m;
      while ((m = re.exec(src))) if (!declared.has(m[1])) rep.warn(f + ':' + src.slice(0, m.index).split('\n').length, 'getUniformLocation("' + m[1] + '") but no shader declares it');
    }
    rep.print({ verbose: args.verbose });
    console.log(rep.summary() + ' — ' + nStatic + ' static GLSL string' + (nStatic === 1 ? '' : 's') + ', ' + nRuntime + ' runtime shader' + (nRuntime === 1 ? '' : 's'));
    return rep.errors ? 1 : 0;
  }

  module.exports = { run, extract };
  if (require.main === module) cli.runMain(run);
})();
