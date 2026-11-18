/* tools/harness-test.js — owner: TOOLS */
(function () {
  'use strict';
  // Self-test of the vm harness (tools/lib/harness.js) and its browser stubs: script loading
  // with owner attribution, leaked-global / top-level detection, the DOM, 2D canvas, WebGL1 and
  // null-GL modes, Web Audio, storage modes, virtual time, rAF, hash routes, dist parsing.
  // Finishes with an informational smoke run of the real game (other owners' problems there
  // are reported as warnings, never as TOOLS failures).
  //   node tools/harness-test.js [--verbose] [--no-game]

  const cli = require('./lib/cli');
  const harness = require('./lib/harness');

  function run(argv) {
    const args = cli.parseArgs(argv, { verbose: 'bool', noGame: 'bool' });
    const rep = new cli.Report('harness-test');
    let n = 0, failed = 0;
    function t(name, fn) {
      n++;
      try { fn(); if (args.verbose) rep.info(name, 'ok'); }
      catch (e) { failed++; rep.error(name, e && e.message || String(e)); }
    }
    function ok(c, msg) { if (!c) throw new Error(msg || 'expected true'); }
    function throwsName(fn, name) {
      try { fn(); } catch (e) { if (name && e.name !== name) throw new Error('threw ' + e.name + ' (' + e.message + '), expected ' + name); return; }
      throw new Error('did not throw' + (name ? ' ' + name : ''));
    }
    const head = p => '/* ' + p + ' — owner: TOOLS */\n';
    function synth(sources, opts) {
      return harness.create(Object.assign({ files: [], sources, boot: false }, opts || {}));
    }

    // ------------------------------------------------------------ loading & attribution
    t('loads a well-formed script into the game realm', () => {
      const h = synth([{ path: 'js/core/x.js', code: head('js/core/x.js') + "(function (AP) {\n  'use strict';\n  AP.X = { v: 42 };\n})(window.AP = window.AP || {});\n" }]);
      ok(h.AP && h.AP.X && h.AP.X.v === 42, 'AP.X not defined');
      ok(h.loadReport[0].status === 'ok', 'status ' + h.loadReport[0].status);
      ok(h.loadReport[0].owner === 'CORE', 'owner ' + h.loadReport[0].owner);
    });
    t('a load-time exception is caught and attributed to the file and owner', () => {
      const h = synth([
        { path: 'js/worlds/w3/entities.js', code: "(function (AP) { 'use strict'; null.boom(); })(window.AP = window.AP || {});" },
        { path: 'js/ui/hud.js', code: "(function (AP) { 'use strict'; AP.after = true; })(window.AP = window.AP || {});" }
      ]);
      const r = h.loadReport[0];
      ok(r.status === 'throw' && r.owner === 'W3', JSON.stringify(r));
      ok(h.AP.after === true, 'loading did not continue after the failure');
      ok(h.errors().some(e => e.owner === 'W3' && /boom|null/.test(e.message)), 'error not reported for W3');
    });
    t('a syntax error is reported per file', () => {
      const h = synth([{ path: 'js/art/kit.js', code: '(function (AP) { var = ; })(window.AP = window.AP || {});' }]);
      ok(h.loadReport[0].status === 'syntax' && h.loadReport[0].owner === 'ART', JSON.stringify(h.loadReport[0]));
    });
    t('leaked globals and top-level declarations are detected and attributed', () => {
      const h = synth([
        { path: 'js/audio/sfx.js', code: "(function (AP) { 'use strict'; window.leaky = 1; })(window.AP = window.AP || {});" },
        { path: 'js/ui/kit.js', code: "var topVar = 1;\nfunction topFn() {}\n(function (AP) { 'use strict'; })(window.AP = window.AP || {});" }
      ]);
      const lk = h.leaks();
      ok(lk.globals.some(g => g.name === 'leaky' && g.owner === 'AUDIO'), 'leaky not attributed to AUDIO: ' + JSON.stringify(lk.globals));
      ok(lk.globals.some(g => g.name === 'topVar' && g.owner === 'UI'), 'topVar not detected');
      ok(lk.topLevel.some(d => d.name === 'topFn' && d.kind === 'function'), 'top-level function not detected');
      ok(!lk.globals.some(g => g.name === 'AP'), 'AP must not count as a leak');
    });
    t('registrations are captured with their file (levels, entities, scenes, FX)', () => {
      const core = "(function (AP) { 'use strict';\n" +
        "  var L = {}, E = {}, S = {}, P = {};\n" +
        "  AP.Levels = { register: function (d) { L[d.id] = d; }, get: function (id) { return L[id]; } };\n" +
        "  AP.Entities = { register: function (t, d) { E[t] = d; }, get: function (t) { return E[t]; } };\n" +
        "  AP.Scenes = { register: function (n, s) { S[n] = s; }, has: function (n) { return !!S[n]; } };\n" +
        "  AP.FX = { preset: function (n, o) { P[n] = o; } };\n" +
        "})(window.AP = window.AP || {});";
      const w2 = "(function (AP) { 'use strict';\n  AP.Entities.register('w2.mite', { kind: 'actor', bogus: 1 });\n  AP.Levels.register({ id: 'w2-1', world: 2 });\n  AP.Scenes.register('w2scene', { update: function () {} });\n  AP.FX.preset('w2.sparkle', {});\n})(window.AP = window.AP || {});";
      const h = synth([{ path: 'js/core/ap.js', code: core }, { path: 'js/worlds/w2/entities.js', code: w2 }]);
      const r = h.registry;
      ok(r.entities.length === 1 && r.entities[0].type === 'w2.mite' && r.entities[0].owner === 'W2' && r.entities[0].keys.indexOf('bogus') >= 0, JSON.stringify(r.entities.map(e => [e.type, e.owner])));
      ok(r.levels.length === 1 && r.levels[0].id === 'w2-1' && r.levels[0].file === 'js/worlds/w2/entities.js', 'level not captured');
      ok(r.scenes.length === 1 && r.fx.length === 1 && r.fx[0].name === 'w2.sparkle', 'scene/fx not captured');
    });
    t('Math.random inside the realm is seeded (deterministic)', () => {
      const a = synth([]).run('Math.random()'), b = synth([]).run('Math.random()');
      ok(a === b, a + ' vs ' + b);
    });

    // ------------------------------------------------------------ DOM & time
    const h = synth([], { hash: '#dev&level=w1-2' });
    t('window, document, #stage > canvas#bg + canvas#game', () => {
      ok(h.run('window === globalThis && window.window === window'), 'window identity');
      const d = h.G.document;
      ok(d.getElementById('stage') && d.getElementById('bg') && d.getElementById('game'), 'stage/canvases missing');
      ok(h.run("document.querySelector('#game').tagName") === 'CANVAS', 'querySelector');
      ok(h.run('typeof devicePixelRatio') === 'number' && h.run("matchMedia('(prefers-reduced-motion: reduce)').matches") === false, 'dpr/matchMedia');
      ok(h.run('navigator.getGamepads().length') === 4, 'getGamepads');
    });
    t('location.hash is readable, settable and fires hashchange', () => {
      ok(h.run('location.hash') === '#dev&level=w1-2', h.run('location.hash'));
      h.run("window.__hc = 0; addEventListener('hashchange', function () { window.__hc++; }); location.hash = 'scene=title';");
      ok(h.run('location.hash') === '#scene=title' && h.run('window.__hc') === 1, 'hashchange not fired');
      h.run('delete window.__hc');
    });
    t('virtual clock: performance.now, setTimeout, requestAnimationFrame', () => {
      const t0 = h.run('performance.now()');
      h.run("window.__t = []; setTimeout(function () { __t.push('timer'); }, 50); requestAnimationFrame(function (ts) { __t.push('raf'); });");
      h.advance(40);
      ok(h.run('__t.length') === 0, 'timer fired early');
      h.advance(20);
      ok(h.run('__t.join()') === 'timer', 'timer did not fire');
      ok(h.raf() === 1 && h.run('__t.join()') === 'timer,raf', 'raf did not run');
      ok(h.run('performance.now()') - t0 === 60, 'clock did not advance by 60 ms');
      h.run('delete window.__t');
    });
    t('events dispatch to window listeners (keyboard)', () => {
      h.run("window.__k = ''; addEventListener('keydown', function (e) { __k = e.code; e.preventDefault(); });");
      const prevented = h.S.key('keydown', 'KeyZ');
      ok(h.run('__k') === 'KeyZ' && prevented, 'keydown not delivered');
      h.run('delete window.__k');
    });

    // ------------------------------------------------------------ canvas 2D
    t('2D context implements the drawing API and returns sane objects', () => {
      const r = h.run(`(function () {
        var c = document.createElement('canvas'); c.width = 64; c.height = 32;
        var g = c.getContext('2d');
        g.save(); g.translate(1, 2); g.rotate(0.3); g.scale(2, 2); g.setTransform(1, 0, 0, 1, 0, 0);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(5, 5); g.quadraticCurveTo(1, 2, 3, 4); g.bezierCurveTo(1, 2, 3, 4, 5, 6);
        g.arc(10, 10, 5, 0, Math.PI * 2); g.ellipse(5, 5, 2, 3, 0, 0, 1); g.rect(0, 0, 4, 4); g.closePath();
        g.fillStyle = '#ff0000'; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.globalAlpha = 0.5;
        g.globalCompositeOperation = 'lighter'; g.fill(); g.stroke(); g.clip();
        var lg = g.createLinearGradient(0, 0, 10, 0); lg.addColorStop(0, '#000'); lg.addColorStop(1, '#fff');
        var rg = g.createRadialGradient(0, 0, 1, 0, 0, 10); rg.addColorStop(0.5, 'red');
        g.fillStyle = lg; g.fillRect(0, 0, 10, 10); g.strokeRect(0, 0, 5, 5); g.clearRect(0, 0, 1, 1);
        var p = new Path2D(); p.moveTo(0, 0); p.lineTo(1, 1); g.stroke(p);
        g.font = '16px sans-serif'; g.textAlign = 'center'; g.fillText('hi', 1, 1); var m = g.measureText('hello');
        var off = document.createElement('canvas'); off.width = 8; off.height = 8;
        g.drawImage(off, 0, 0); g.drawImage(off, 0, 0, 4, 4, 0, 0, 8, 8);
        var id = g.getImageData(0, 0, 4, 4); g.putImageData(id, 0, 0);
        var pat = g.createPattern(off, 'repeat');
        g.restore();
        return { comp: g.globalCompositeOperation, mw: m.width, idLen: id.data.length, pat: !!pat, ts: typeof g.getTransform().a, dash: (g.setLineDash([2, 2]), g.getLineDash().length) };
      })()`);
      ok(r.mw > 0 && r.idLen === 64 && r.pat && r.ts === 'number' && r.dash === 2, JSON.stringify(r));
    });
    t('2D context throws where browsers throw (negative radius, bad color stop)', () => {
      throwsName(() => h.run("document.createElement('canvas').getContext('2d').arc(0, 0, -1, 0, 1)"), 'IndexSizeError');
      throwsName(() => h.run("document.createElement('canvas').getContext('2d').createLinearGradient(0,0,1,1).addColorStop(2, '#fff')"), 'IndexSizeError');
    });

    // ------------------------------------------------------------ WebGL
    t('WebGL1 stub: shaders compile, programs link, uniforms resolve, no extensions', () => {
      const r = h.run(`(function () {
        var gl = document.createElement('canvas').getContext('webgl');
        var vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'); gl.compileShader(vs);
        var fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, 'precision mediump float; uniform float uTime; void main(){ gl_FragColor = vec4(uTime); }'); gl.compileShader(fs);
        var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
        gl.useProgram(p);
        var u = gl.getUniformLocation(p, 'uTime'); gl.uniform1f(u, 1.5);
        var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.viewport(0, 0, 4, 4); gl.drawArrays(gl.TRIANGLES, 0, 3);
        return { vs: gl.getShaderParameter(vs, gl.COMPILE_STATUS), link: gl.getProgramParameter(p, gl.LINK_STATUS), u: !!u, ext: gl.getExtension('OES_texture_float'), err: gl.getError() };
      })()`);
      ok(r.vs === true && r.link === true && r.u && r.ext === null && r.err === 0, JSON.stringify(r));
    });
    t("null-GL mode: getContext('webgl') returns null", () => {
      const hn = synth([], { gl: 'null' });
      ok(hn.run("document.createElement('canvas').getContext('webgl')") === null, 'expected null');
      ok(hn.run("!!document.createElement('canvas').getContext('2d')"), '2d must still work');
    });

    // ------------------------------------------------------------ audio
    t('AudioContext stub: graph, AudioParam automation, virtual currentTime', () => {
      const r = h.run(`(function () {
        var ac = new AudioContext();
        var o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter(), comp = ac.createDynamicsCompressor(), pan = ac.createStereoPanner();
        var buf = ac.createBuffer(1, 4800, ac.sampleRate); buf.getChannelData(0)[0] = 1;
        var src = ac.createBufferSource(); src.buffer = buf;
        o.connect(f); f.connect(g); src.connect(g); g.connect(pan); pan.connect(comp); comp.connect(ac.destination);
        var t0 = ac.currentTime;
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
        o.frequency.setTargetAtTime(440, t0, 0.1); o.start(t0); o.stop(t0 + 0.5); src.start(t0);
        var threw = '';
        try { g.gain.exponentialRampToValueAtTime(0, t0 + 1); } catch (e) { threw = e.name; }
        return { t0: t0, threw: threw, state: ac.state };
      })()`);
      ok(r.threw === 'RangeError', 'exponential ramp to 0 must throw RangeError (got ' + r.threw + ')');
      const before = h.run('(function(){ var a = new AudioContext(); window.__ac = a; return a.currentTime; })()');
      h.advance(500);
      const after = h.run('__ac.currentTime');
      ok(after - before > 0.45 && after - before < 0.55, 'currentTime advanced ' + (after - before));
      h.run('delete window.__ac');
    });

    // ------------------------------------------------------------ storage modes
    t('localStorage: in-memory, corrupt and throwing modes', () => {
      h.run("localStorage.setItem('k', 'v')");
      ok(h.run("localStorage.getItem('k')") === 'v', 'ok mode');
      const hc = synth([], { storage: 'corrupt' });
      const raw = hc.run("localStorage.getItem('apeiron.save.v1')");
      ok(typeof raw === 'string' && raw.length > 0, 'corrupt mode should seed apeiron.save.v1');
      let threw = false;
      try { JSON.parse(raw); } catch (e) { threw = true; }
      ok(threw, 'corrupt save should not parse');
      const ht = synth([], { storage: 'throws' });
      throwsName(() => ht.run('localStorage.getItem("x")'), 'SecurityError');
    });

    // ------------------------------------------------------------ dist parsing
    t('dist builds: inline scripts are recognised by data-src', () => {
      const html = '<!DOCTYPE html><html><body><div id="stage"><canvas id="bg"></canvas><canvas id="game"></canvas></div>' +
        '<script data-src="js/core/ap.js">/* js/core/ap.js — owner: CORE */\n(function (AP) { \'use strict\'; AP.d = 1; })(window.AP = window.AP || {});</script>' +
        '<script data-src="js/main.js">(function (AP) { \'use strict\'; AP.e = "<\\/script>"; })(window.AP = window.AP || {});</script></body></html>';
      const d = harness.parseDistHtml(html);
      ok(d.scripts.length === 2 && d.scripts[0].path === 'js/core/ap.js' && d.scripts[1].path === 'js/main.js', JSON.stringify(d.scripts.map(s => s.path)));
    });

    // ------------------------------------------------------------ the real game (informational)
    if (!args.noGame && cli.exists('index.html')) {
      t('game smoke run (index.html order, boot, 60 frames)', () => {
        const hg = harness.create({ gl: 'stub', boot: false });
        const boot = harness.ensureBoot(hg);
        if (boot.note) rep.warn('game', boot.note);
        const missing = hg.loadReport.filter(e => e.status === 'missing').map(e => e.file);
        if (missing.length) rep.info('game', missing.length + ' script(s) not written yet: ' + missing.join(', '));
        hg.frames(60);
        const errs = hg.errors();
        for (const e of errs) rep.warn('game', harness.fmtError(e));
        rep.info('game', hg.loadReport.length + ' scripts, ' + errs.length + ' error(s) from other owners');
      });
    }

    rep.print({ verbose: args.verbose });
    console.log((failed ? cli.C.red(failed + '/' + n + ' tests failed') : cli.C.green(n + '/' + n + ' tests passed')));
    console.log(rep.summary());
    return rep.errors ? 1 : 0;
  }

  module.exports = { run };
  if (require.main === module) cli.runMain(run);
})();
