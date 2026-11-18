/* tools/test-algo.js — owner: TOOLS */
(function () {
  'use strict';
  // Unit tests for AP.Algo (js/core/algo.js, CONTRACT §2.3). Loads algo.js in an isolated vm
  // context (no other game files needed), checks correctness, determinism, purity (no globals,
  // no Math.random) and speed. When js/core/path.js / rng.js exist they are loaded too so
  // lissajous ≡ AP.Path.liss and poisson-with-AP.RNG are cross-checked.
  //   node tools/test-algo.js [--verbose]

  const fs = require('fs');
  const vm = require('vm');
  const cli = require('./lib/cli');

  function loadAlgo(opts) {
    opts = opts || {};
    const sandbox = { console: { log() {}, warn() {}, error() {} } };
    const ctx = vm.createContext(sandbox);
    const G = vm.runInContext('globalThis', ctx);
    G.window = G;
    let randomCalls = 0;
    const MathObj = vm.runInContext('Math', ctx);
    MathObj.random = function () { randomCalls++; return 0.5; };
    const before = new Set(Object.getOwnPropertyNames(G));
    const extra = [];
    for (const f of (opts.with || [])) {
      if (cli.exists(f)) { new vm.Script(cli.read(f), { filename: cli.abs(f) }).runInContext(ctx); extra.push(f); }
    }
    const src = cli.read('js/core/algo.js');
    new vm.Script(src, { filename: cli.abs('js/core/algo.js') }).runInContext(ctx);
    const added = Object.getOwnPropertyNames(G).filter(k => !before.has(k) && k !== 'AP');
    return { AP: G.AP, G, added, randomCalls: () => randomCalls, extra };
  }

  // Timing copy: Node vm contexts route every global lookup (Math, …) through an interceptor,
  // which makes vm-hosted code several times slower than in a browser, so the budgets are
  // measured on a copy compiled in this realm with a private window object.
  function loadAlgoFast() {
    const win = {};
    const fn = vm.runInThisContext('(function (window) {\n' + cli.read('js/core/algo.js') + '\n})', { filename: cli.abs('js/core/algo.js') });
    fn(win);
    return win.AP && win.AP.Algo;
  }
  function bestOf(n, fn) { let best = Infinity; for (let i = 0; i < n; i++) { const t0 = cli.hrtimeMs(); fn(); best = Math.min(best, cli.hrtimeMs() - t0); } return best; }
  // ≥ 1: how much slower this machine runs a fixed float/array workload than the 20 ms reference
  function machineFactor() {
    const ref = () => { const a = new Float64Array(4096); let s = 0; for (let k = 0; k < 400; k++) for (let i = 0; i < 4096; i++) { a[i] = Math.sqrt(a[i] + i * k); s += a[i]; } return s; };
    const dt = bestOf(3, ref);
    return Math.max(1, dt / 20);
  }
  function run(argv) {
    const args = cli.parseArgs(argv || [], { verbose: 'bool' });
    const rep = new cli.Report('test-algo');
    if (!cli.exists('js/core/algo.js')) { rep.error('algo.js', 'js/core/algo.js is missing'); return finish(rep, args); }
    let env;
    try { env = loadAlgo(); } catch (e) { rep.error('load', 'algo.js threw while loading: ' + e.message); return finish(rep, args); }
    const A = env.AP && env.AP.Algo;
    let n = 0, failed = 0;
    function t(name, fn) {
      n++;
      try {
        const r = fn();
        if (r === false) throw new Error('assertion returned false');
        if (args.verbose) rep.info(name, 'ok');
      } catch (e) { failed++; rep.error(name, e.message); }
    }
    function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
    function near(a, b, eps, msg) { if (!(Math.abs(a - b) <= eps)) throw new Error((msg || '') + ' expected ≈' + b + ' ±' + eps + ', got ' + a); }
    function ok(c, msg) { if (!c) throw new Error(msg || 'expected true'); }
    function isRotation(a, b) {
      if (a.length !== b.length) return false;
      const n = a.length;
      for (let r = 0; r < n; r++) { let same = true; for (let i = 0; i < n; i++) if (a[(i + r) % n] !== b[i]) { same = false; break; } if (same) return true; }
      return n === 0;
    }

    t('AP.Algo exists with every §2.3 function', () => {
      ok(A && typeof A === 'object', 'AP.Algo missing');
      for (const f of ['euclid', 'lsystem', 'turtle', 'koch', 'sierpinski', 'voronoi', 'truchet', 'lissajous', 'harmonograph', 'phyllo', 'poisson']) ok(typeof A[f] === 'function', 'AP.Algo.' + f + ' missing');
    });
    if (!A) return finish(rep, args, n, failed);
    t('purity: no globals besides AP', () => ok(env.added.length === 0, 'leaked globals: ' + env.added.join(', ')));

    // ------------------------------------------------------------ euclid
    t('euclid(3,8) is a rotation of [1,0,0,1,0,0,1,0]', () => ok(isRotation(A.euclid(3, 8), [1, 0, 0, 1, 0, 0, 1, 0]), JSON.stringify(A.euclid(3, 8))));
    t('euclid(3,8) unrotated starts with an onset', () => eq(A.euclid(3, 8).join(''), '10010010'));
    t('euclid(5,8) is a rotation of x.xx.xx.', () => ok(isRotation(A.euclid(5, 8), [1, 0, 1, 1, 0, 1, 1, 0])));
    t('euclid(5,12) = x..x.x..x.x. (W1 hats)', () => ok(isRotation(A.euclid(5, 12), [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0])));
    t('euclid(5,16) has 5 onsets, gaps 3..4 (W2 shakers)', () => {
      const p = A.euclid(5, 16);
      eq(p.length, 16); eq(p.reduce((a, b) => a + b, 0), 5);
      const on = []; p.forEach((v, i) => { if (v) on.push(i); });
      for (let i = 0; i < on.length; i++) { const g = ((on[(i + 1) % on.length] - on[i]) + 16) % 16 || 16; ok(g === 3 || g === 4, 'gap ' + g); }
    });
    t('euclid: k onsets, maximal evenness for all k,n ≤ 32', () => {
      for (let nn = 1; nn <= 32; nn++) for (let k = 0; k <= nn; k++) {
        const p = A.euclid(k, nn);
        eq(p.length, nn, 'len(' + k + ',' + nn + ')');
        eq(p.reduce((a, b) => a + b, 0), k, 'sum(' + k + ',' + nn + ')');
        if (k >= 2) {
          const on = []; p.forEach((v, i) => { if (v) on.push(i); });
          let mn = Infinity, mx = -Infinity;
          for (let i = 0; i < on.length; i++) { const g = ((on[(i + 1) % on.length] - on[i]) + nn) % nn || nn; mn = Math.min(mn, g); mx = Math.max(mx, g); }
          ok(mx - mn <= 1, 'uneven gaps for (' + k + ',' + nn + '): ' + p.join(''));
        }
      }
    });
    t('euclid rotation: rot rotates left; negative rotates right', () => {
      const b = A.euclid(3, 8), r1 = A.euclid(3, 8, 1), rm = A.euclid(3, 8, -1);
      for (let i = 0; i < 8; i++) { eq(r1[i], b[(i + 1) % 8]); eq(rm[i], b[(i + 7) % 8]); }
      eq(A.euclid(3, 8, 8).join(''), b.join(''), 'rot n');
    });
    t('euclid edge cases', () => {
      eq(A.euclid(0, 5).join(''), '00000'); eq(A.euclid(5, 5).join(''), '11111'); eq(A.euclid(9, 4).join(''), '1111');
      eq(A.euclid(2, 0).length, 0); eq(A.euclid(-3, 4).join(''), '0000'); eq(A.euclid(3, NaN).length, 0);
    });
    t('euclid returns a fresh array (callers may mutate)', () => { const a = A.euclid(3, 8); a[0] = 7; eq(A.euclid(3, 8)[0], 1); });

    // ------------------------------------------------------------ lsystem
    t('lsystem algae A→AB,B→A grows by Fibonacci', () => {
      const fib = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
      for (let i = 0; i < fib.length; i++) eq(A.lsystem('A', { A: 'AB', B: 'A' }, i).length, fib[i], 'iter ' + i);
      eq(A.lsystem('A', { A: 'AB', B: 'A' }, 4), 'ABAABABA');
    });
    t('lsystem Koch F→F+F-F-F+F grows ×5 in F count', () => {
      for (let i = 0; i < 5; i++) { const s = A.lsystem('F', { F: 'F+F-F-F+F' }, i); eq((s.match(/F/g) || []).length, Math.pow(5, i)); }
    });
    t('lsystem respects maxLen and default cap 50000', () => {
      eq(A.lsystem('A', { A: 'AA' }, 20, 1000).length, 1000);
      ok(A.lsystem('A', { A: 'AA' }, 30).length <= 50000);
      eq(A.lsystem('A', { A: 'AA' }, 30).length, 50000);
    });
    t('lsystem: unknown chars copied, no rules → axiom', () => { eq(A.lsystem('X[+F]', { F: 'FF' }, 2), 'X[+FFFF]'); eq(A.lsystem('ABC', null, 5), 'ABC'); eq(A.lsystem('ABC', {}, 5), 'ABC'); });
    t('lsystem ignores inherited/multi-char keys', () => { const r = Object.create({ A: 'ZZ' }); r.B = 'C'; r.AB = 'Q'; eq(A.lsystem('AB', r, 1), 'AC'); });

    // ------------------------------------------------------------ turtle
    t('turtle segment count = number of F/G', () => {
      const s = A.lsystem('F', { F: 'F[+F]F[-F]F' }, 3);
      const r = A.turtle(s, { x: 0, y: 0, step: 4, angle: Math.PI / 7 });
      eq(r.segs.length, (s.match(/[FG]/g) || []).length);
      eq(A.turtle('FGfFG', {}).segs.length, 4);
    });
    t('turtle: heading default up, step length, f moves without drawing', () => {
      const r = A.turtle('FfF', { x: 10, y: 10, step: 5 });
      eq(r.segs.length, 2);
      near(r.segs[0][0], 10, 1e-9); near(r.segs[0][1], 10, 1e-9); near(r.segs[0][3], 5, 1e-9, 'y2');
      near(r.segs[1][1], 0, 1e-9, 'second seg starts after f');
    });
    t('turtle: + turns clockwise on screen (+angle), brackets restore state, depth recorded', () => {
      const r = A.turtle('[+F]F', { x: 0, y: 0, heading: 0, step: 10, angle: Math.PI / 2 });
      near(r.segs[0][2], 0, 1e-9); near(r.segs[0][3], 10, 1e-9, '+90° from +x points down (+y)');
      eq(r.segs[0][4], 1, 'depth inside bracket');
      near(r.segs[1][0], 0, 1e-9); near(r.segs[1][2], 10, 1e-9); eq(r.segs[1][4], 0);
    });
    t('turtle: shrink scales step per depth; leaves at branch tips and end', () => {
      const r = A.turtle('F[F[F]]', { heading: 0, step: 8, shrink: 0.5 });
      near(r.segs[1][2] - r.segs[1][0], 4, 1e-9); near(r.segs[2][2] - r.segs[2][0], 2, 1e-9);
      eq(r.leaves.length, 3);
      eq(A.turtle('[]', {}).leaves.length, 1, 'empty branch is not a leaf');
      eq(A.turtle('F]]]', {}).segs.length, 1, 'unbalanced ] ignored');
    });

    // ------------------------------------------------------------ koch
    t('koch point count 4^d+1 and exact endpoints', () => {
      for (let d = 0; d <= 5; d++) {
        const p = A.koch(0, 0, 300, 0, d);
        eq(p.length, 2 * (Math.pow(4, d) + 1), 'depth ' + d);
        eq(p[0], 0); eq(p[1], 0); eq(p[p.length - 2], 300); eq(p[p.length - 1], 0);
      }
    });
    t('koch length grows by (4/3)^d', () => {
      const p = A.koch(0, 0, 243, 0, 4);
      let L = 0; for (let i = 0; i < p.length - 2; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      near(L, 243 * Math.pow(4 / 3, 4), 1e-6);
    });
    t('koch outward=1 bumps up (−y) for a left→right segment; −1 flips', () => {
      const up = A.koch(0, 0, 90, 0, 1), dn = A.koch(0, 0, 90, 0, 1, -1);
      near(up[5], -30 * Math.sqrt(3) / 2, 1e-9); near(dn[5], 30 * Math.sqrt(3) / 2, 1e-9);
      near(up[4], 45, 1e-9);
    });
    t('koch depth clamped (no explosion)', () => ok(A.koch(0, 0, 1, 0, 50).length === 2 * (Math.pow(4, 7) + 1)));

    // ------------------------------------------------------------ sierpinski
    t('sierpinski produces 3^d triangles', () => { for (let d = 0; d <= 6; d++) eq(A.sierpinski(0, 0, 100, d).length, Math.pow(3, d), 'depth ' + d); });
    t('sierpinski geometry: equilateral, centroid at (cx,cy), side size/2^d', () => {
      const t0 = A.sierpinski(50, 60, 120, 0)[0];
      near((t0[0] + t0[2] + t0[4]) / 3, 50, 1e-9); near((t0[1] + t0[3] + t0[5]) / 3, 60, 1e-9);
      near(Math.hypot(t0[2] - t0[4], t0[3] - t0[5]), 120, 1e-9);
      ok(t0[1] < t0[3], 'apex up');
      const tr = A.sierpinski(0, 0, 128, 3);
      for (const q of tr) near(Math.hypot(q[0] - q[2], q[1] - q[3]), 16, 1e-9);
      let area = 0; for (const q of tr) area += Math.abs((q[2] - q[0]) * (q[5] - q[1]) - (q[4] - q[0]) * (q[3] - q[1])) / 2;
      near(area, Math.sqrt(3) / 4 * 128 * 128 * Math.pow(0.75, 3), 1e-6);
    });

    // ------------------------------------------------------------ voronoi
    function polyArea(f) { let a = 0; for (let i = 0; i < f.length; i += 2) { const j = (i + 2) % f.length; a += f[i] * f[j + 1] - f[j] * f[i + 1]; } return a / 2; }
    function pointIn(f, x, y) { let inside = false; for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) { const xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
    function shareEdge(a, b) {
      let cnt = 0;
      for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) if (Math.abs(a[i] - b[j]) < 1e-6 && Math.abs(a[i + 1] - b[j + 1]) < 1e-6) cnt++;
      return cnt >= 2;
    }
    const rng0 = cli.mulberry32(7);
    const sites = []; for (let i = 0; i < 64; i++) sites.push([rng0() * 400, rng0() * 300]);
    t('voronoi: one cell per site, convex, contains its site, inside bbox', () => {
      const cells = A.voronoi(sites, [0, 0, 400, 300]);
      eq(cells.length, sites.length);
      cells.forEach((c, i) => {
        ok(c.site === sites[i], 'site reference');
        ok(c.poly.length >= 6, 'cell ' + i + ' empty');
        ok(pointIn(c.poly, sites[i][0], sites[i][1]), 'cell ' + i + ' does not contain its site');
        for (let k = 0; k < c.poly.length; k += 2) ok(c.poly[k] >= -1e-6 && c.poly[k] <= 400 + 1e-6 && c.poly[k + 1] >= -1e-6 && c.poly[k + 1] <= 300 + 1e-6, 'vertex outside bbox');
        ok(polyArea(c.poly) > 0, 'clockwise on screen (positive signed area with y down)');
      });
    });
    t('voronoi: cells tile the bbox (area sum)', () => {
      const cells = A.voronoi(sites, [0, 0, 400, 300]);
      near(cells.reduce((a, c) => a + Math.abs(polyArea(c.poly)), 0), 400 * 300, 1e-3);
    });
    t('voronoi: neighbour relation is symmetric and geometric', () => {
      const cells = A.voronoi(sites, [0, 0, 400, 300]);
      cells.forEach((c, i) => c.neighbors.forEach(j => {
        ok(cells[j].neighbors.indexOf(i) >= 0, 'asymmetric ' + i + '-' + j);
        ok(shareEdge(c.poly, cells[j].poly), 'neighbours ' + i + ',' + j + ' share no edge');
      }));
      // every Voronoi neighbour pair is a Delaunay edge: at least 3 neighbours on average
      const avg = cells.reduce((a, c) => a + c.neighbors.length, 0) / cells.length;
      ok(avg > 3 && avg < 7, 'average degree ' + avg);
    });
    t('voronoi: regular grid (degenerate co-circular vertices)', () => {
      const g = []; for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) g.push([x * 20 + 10, y * 20 + 10]);
      const cells = A.voronoi(g, [0, 0, 100, 100]);
      cells.forEach(c => near(Math.abs(polyArea(c.poly)), 400, 1e-6));
      eq(cells[12].neighbors.join(','), '7,11,13,17', 'centre cell has 4 edge neighbours, not diagonals');
    });
    t('voronoi: duplicates, non-finite sites, single site, empty input', () => {
      const c = A.voronoi([[10, 10], [10, 10], [NaN, 3], [30, 30]], [0, 0, 40, 40]);
      ok(c[0].poly.length > 0 && c[1].poly.length === 0 && c[2].poly.length === 0, 'duplicate/NaN handling');
      ok(c[0].neighbors.join(',') === '3' && c[3].neighbors.join(',') === '0');
      const one = A.voronoi([[5, 5]], [0, 0, 10, 10]);
      near(Math.abs(polyArea(one[0].poly)), 100, 1e-9);
      eq(A.voronoi([], [0, 0, 1, 1]).length, 0);
    });
    // Timing budgets: best of 5 runs, scaled by this machine's speed (a reference loop that takes
    // ≈ 20 ms on a typical desktop core), so a loaded or throttled machine does not fail them.
    const speed = machineFactor();
    const FA = loadAlgoFast() || A;
    t('voronoi: 256 sites under 60 ms (× machine factor ' + speed.toFixed(2) + ')', () => {
      const r = cli.mulberry32(3); const s = []; for (let i = 0; i < 256; i++) s.push([r() * 960, r() * 540]);
      let cells = null;
      const dt = bestOf(5, () => { cells = FA.voronoi(s, [0, 0, 960, 540]); });
      eq(cells.length, 256);
      ok(dt < 60 * speed, 'best of 5 took ' + dt.toFixed(1) + ' ms');
    });

    // ------------------------------------------------------------ truchet
    t('truchet: 0..3, deterministic, seed-dependent, roughly uniform', () => {
      const counts = [0, 0, 0, 0]; let diff = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const v = A.truchet(x, y, 1);
        ok(v >= 0 && v <= 3 && (v | 0) === v, 'range');
        eq(A.truchet(x, y, 1), v, 'determinism');
        counts[v]++;
        if (A.truchet(x, y, 2) !== v) diff++;
      }
      for (const c of counts) ok(c > 900 && c < 1150, 'distribution ' + counts.join('/'));
      ok(diff > 2500, 'seed changes the pattern');
      ok(A.truchet(-5, -9, 0) >= 0, 'negative coords');
    });

    // ------------------------------------------------------------ lissajous / harmonograph / phyllo
    t('lissajous formula and out reuse', () => {
      const p = { cx: 100, cy: 50, ax: 30, ay: 20, fx: 3, fy: 2, phase: 0.4, period: 4 };
      const out = { x: 0, y: 0 };
      for (const tt of [0, 0.3, 1.7, 9.1]) {
        const w = 2 * Math.PI / 4;
        const r = A.lissajous(tt, p, out);
        ok(r === out, 'returns out');
        near(r.x, 100 + 30 * Math.sin(3 * w * tt + 0.4), 1e-12); near(r.y, 50 + 20 * Math.sin(2 * w * tt), 1e-12);
      }
      const fresh = A.lissajous(1, p); ok(typeof fresh.x === 'number');
    });
    t('harmonograph: four-pendulum fields and array form agree; damping decays', () => {
      const p = { cx: 5, cy: -5, a1: 100, f1: 2, p1: 0.1, d1: 0.02, a2: 50, f2: 3.01, p2: 1, d2: 0.01, a3: 80, f3: 2.5, p3: 0, d3: 0.03, a4: 30, f4: 1, p4: 2, d4: 0 };
      const q = { cx: 5, cy: -5, x: [[100, 2, 0.1, 0.02], [50, 3.01, 1, 0.01]], y: [[80, 2.5, 0, 0.03], [30, 1, 2, 0]] };
      const o1 = {}, o2 = {};
      for (const tt of [0, 1.3, 7]) { A.harmonograph(tt, p, o1); A.harmonograph(tt, q, o2); near(o1.x, o2.x, 1e-9); near(o1.y, o2.y, 1e-9); }
      near(A.harmonograph(0, { a1: 10, f1: 1, p1: Math.PI / 2 }).x, 10, 1e-9);
      let mx0 = 0, mx1 = 0; const o = {};
      for (let i = 0; i < 200; i++) { mx0 = Math.max(mx0, Math.abs(A.harmonograph(i / 100, { a1: 10, f1: 1, d1: 1 }, o).x)); mx1 = Math.max(mx1, Math.abs(A.harmonograph(5 + i / 100, { a1: 10, f1: 1, d1: 1 }, o).x)); }
      ok(mx1 < mx0 * 0.05, 'damped');
    });
    t('phyllo: r = c√i, θ = i·2.39996323, consecutive angle = golden angle', () => {
      const o = {};
      for (const i of [0, 1, 2, 10, 137]) {
        const r = A.phyllo(i, 4, o);
        ok(r === o);
        near(r.r, 4 * Math.sqrt(i), 1e-12); near(r.a, i * 2.39996323, 1e-12);
        near(r.x, r.r * Math.cos(r.a), 1e-9); near(r.y, r.r * Math.sin(r.a), 1e-9);
      }
      const a = A.phyllo(5, 1).a, b = A.phyllo(6, 1).a;
      near(b - a, 2.39996323, 1e-12);
      near(2.39996323 * 180 / Math.PI, 137.5077, 1e-3);
    });

    // ------------------------------------------------------------ poisson
    function seededRng(seed) { const f = cli.mulberry32(seed); return { next: f }; }
    t('poisson: min distance ≥ r, all inside, dense enough', () => {
      const pts = A.poisson(400, 300, 20, seededRng(11));
      ok(pts.length > 0.35 * 400 * 300 / (Math.PI * 100), 'too sparse: ' + pts.length);
      for (const p of pts) ok(p[0] >= 0 && p[0] < 400 && p[1] >= 0 && p[1] < 300, 'outside');
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) ok(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) >= 20 - 1e-9, 'too close');
    });
    t('poisson: deterministic per rng seed; accepts function and numeric seeds', () => {
      const a = A.poisson(200, 200, 15, seededRng(5)), b = A.poisson(200, 200, 15, seededRng(5)), c = A.poisson(200, 200, 15, seededRng(6));
      eq(JSON.stringify(a), JSON.stringify(b)); ok(JSON.stringify(a) !== JSON.stringify(c));
      ok(A.poisson(100, 100, 10, cli.mulberry32(1)).length > 10, 'function rng');
      eq(JSON.stringify(A.poisson(100, 100, 10, 42)), JSON.stringify(A.poisson(100, 100, 10, 42)), 'numeric seed');
      ok(A.poisson(100, 100, 10).length > 10, 'no rng → internal default');
    });
    t('poisson: degenerate inputs', () => { eq(A.poisson(0, 10, 1).length, 0); eq(A.poisson(10, 10, 0).length, 0); eq(A.poisson(10, 10, NaN).length, 0); });
    t('poisson 960×540 r=24 under 60 ms (× machine factor)', () => { const dt = bestOf(5, () => FA.poisson(960, 540, 24, seededRng(9))); ok(dt < 60 * speed, 'best of 5 took ' + dt.toFixed(1) + ' ms'); });

    t('determinism: no Math.random used anywhere', () => {
      const before = env.randomCalls();
      A.euclid(5, 13); A.lsystem('F', { F: 'F+F' }, 3); A.turtle('F+F', {}); A.koch(0, 0, 1, 1, 2); A.sierpinski(0, 0, 1, 2);
      A.voronoi(sites, [0, 0, 400, 300]); A.truchet(1, 2, 3); A.lissajous(1, { period: 1 }); A.harmonograph(1, {}); A.phyllo(3, 1); A.poisson(50, 50, 5);
      eq(env.randomCalls() - before, 0, 'Math.random calls');
    });

    // ------------------------------------------------------------ cross-checks with CORE when present
    if (cli.exists('js/core/path.js') && cli.exists('js/core/ap.js')) {
      t('lissajous ≡ AP.Path.liss (CORE)', () => {
        let e2;
        try { e2 = loadAlgo({ with: ['js/core/ap.js', 'js/core/const.js', 'js/core/math.js', 'js/core/rng.js', 'js/core/path.js'] }); }
        catch (e) { throw new Error('could not load CORE helpers: ' + e.message); }
        const P = e2.AP.Path;
        if (!P || typeof P.liss !== 'function') throw new Error('AP.Path.liss missing in js/core/path.js');
        const p = { cx: 10, cy: 20, ax: 64, ay: 32, fx: 3, fy: 2, phase: 0.7, period: 5 };
        for (const tt of [0, 0.4, 2.2, 13]) {
          const a = e2.AP.Algo.lissajous(tt, p, {}), b = P.liss(p, tt, {});
          near(a.x, b.x, 1e-9, 'x@' + tt); near(a.y, b.y, 1e-9, 'y@' + tt);
        }
      });
    }
    if (cli.exists('js/core/rng.js')) {
      t('poisson with CORE AP.RNG instance', () => {
        const e3 = loadAlgo({ with: ['js/core/ap.js', 'js/core/const.js', 'js/core/math.js', 'js/core/rng.js'] });
        if (typeof e3.AP.RNG !== 'function') throw new Error('AP.RNG missing in js/core/rng.js');
        const pts = e3.AP.Algo.poisson(300, 200, 18, e3.AP.RNG(77));
        ok(pts.length > 20, 'count ' + pts.length);
        const again = e3.AP.Algo.poisson(300, 200, 18, e3.AP.RNG(77));
        eq(JSON.stringify(pts), JSON.stringify(again));
      });
    }
    return finish(rep, args, n, failed);
  }

  function finish(rep, args, n, failed) {
    rep.print({ verbose: args && args.verbose });
    if (n !== undefined) console.log('  ' + (n - failed) + '/' + n + ' tests passed');
    console.log(rep.summary());
    return rep.errors ? 1 : 0;
  }

  module.exports = { run };
  if (require.main === module) cli.runMain(run);
})();
