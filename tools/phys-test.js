/* tools/phys-test.js — owner: TOOLS */
(function () {
  'use strict';
  // Physics conformance (CONTRACT §4.2), measured two ways:
  //   (a) the TOOLS standalone model of §2.15 (tools/lib/sim.js, exact constants) — the same
  //       model the lint bots use, so this also proves the bots' physics;
  //   (b) CORE's real player (js/game/player.js) driven through the vm harness with
  //       AP.Input.setVirtual on flat synthetic levels (needs AP.Test from js/game/levelscene.js).
  // Exit code: non-zero when (b) runs and fails, or when (a) fails (a TOOLS model bug).
  //   node tools/phys-test.js [--only a|b] [--verbose]

  const cli = require('./lib/cli');
  const sim = require('./lib/sim');
  const harness = require('./lib/harness');

  // expectation checks: [label, value → {ok, text}]
  function near(v, target, tol, unit) { return { ok: Math.abs(v - target) <= tol, text: fmt(v) + unit, want: target + '±' + tol + unit }; }
  function atMost(v, max, unit) { return { ok: v <= max, text: fmt(v) + unit, want: '≤ ' + max + unit }; }
  function fmt(v) { return typeof v !== 'number' || !isFinite(v) ? String(v) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3); }

  const TESTS = [
    { id: 'jump', name: 'held running jump', checks: [['apex', r => near(r.apex, 110, 3, 'u')], ['travel', r => near(r.travel, 200, 6, 'u')], ['airtime', r => near(r.air, 0.667, 0.017, ' s')]] },
    { id: 'tap', name: 'tap jump', checks: [['apex', r => atMost(r.apex, 25, 'u')]] },
    { id: 'dj', name: 'jump + DJ at apex', checks: [['apex', r => near(r.apex, 196, 4, 'u')]] },
    { id: 'walljump', name: 'wall-jump', checks: [['apex', r => near(r.apex, 94, 3, 'u')]] },
    { id: 'shaft', name: '3-tile shaft, gain per hop', checks: [['gain', r => near(r.gain, 90, 6, 'u')]] },
    { id: 'dash', name: 'ground dash distance', checks: [['distance', r => near(r.dist, 106, 8, 'u')]] },
    { id: 'bounce', name: 'bounce pad', checks: [['apex', r => near(r.apex, 222, 5, 'u')]] },
    { id: 'orbit', name: 'orbit after 1 s attached', checks: [['release', r => near(r.speed, 920, 30, ' u/s')]] },
    { id: 'terminal', name: 'terminal velocity', checks: [['fall', r => near(r.vmax, 900, 1, ' u/s')], ['fast-fall (Down)', r => near(r.vfast, 1100, 1, ' u/s')]] }
  ];

  // ------------------------------------------------------------------ (a) standalone model
  function flatGrid(w, h, floorRow, extra) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) r += (x === 0 || x === w - 1 || y === 0 || y >= floorRow) ? '#' : '.';
      rows.push(r);
    }
    if (extra) extra(rows);
    return sim.gridFromRows(rows).build();
  }
  function setCol(rows, x, y0, y1, ch) { for (let y = y0; y <= y1; y++) rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1); }

  const MODEL = {
    jump() {
      const M = sim.makeModel('EXACT', 3), G = flatGrid(80, 20, 16);
      const b = sim.newBody(); sim.placeOnFloor(b, 4, 16);
      for (let i = 0; i < 60; i++) sim.stepPhysics(b, M, G, 1, false, false, false);
      const y0 = b.y, x0 = b.x;
      sim.tryJump(b, M, G, false);
      let minY = b.y, n = 0;
      for (let i = 0; i < 400; i++) {
        const ev = sim.stepPhysics(b, M, G, 1, true, false, false);
        n++;
        if (b.y < minY) minY = b.y;
        if (ev & sim.EV.LANDED) break;
      }
      return { apex: y0 - minY, travel: b.x - x0, air: n * M.C.STEP };
    },
    tap() {
      const M = sim.makeModel('EXACT', 3), G = flatGrid(40, 20, 16);
      const b = sim.newBody(); sim.placeOnFloor(b, 10, 16);
      const y0 = b.y;
      sim.tryJump(b, M, G, false);
      let minY = b.y;
      // pressed and released between two steps: the cut applies in the jump step
      let first = true;
      for (let i = 0; i < 200; i++) {
        const ev = sim.stepPhysics(b, M, G, 0, false, first, false);
        first = false;
        if (b.y < minY) minY = b.y;
        if (ev & sim.EV.LANDED) break;
      }
      return { apex: y0 - minY };
    },
    dj() {
      const M = sim.makeModel('EXACT', 5), G = flatGrid(40, 30, 26);
      const b = sim.newBody(); sim.placeOnFloor(b, 10, 26);
      const y0 = b.y;
      sim.tryJump(b, M, G, false);
      let minY = b.y, done = false;
      for (let i = 0; i < 300; i++) {
        if (!done && b.vy >= 0) { sim.tryJump(b, M, G, false); done = true; }
        const ev = sim.stepPhysics(b, M, G, 0, true, false, false);
        if (b.y < minY) minY = b.y;
        if (ev & sim.EV.LANDED) break;
      }
      return { apex: y0 - minY };
    },
    walljump() {
      const M = sim.makeModel('EXACT', 4);
      const G = flatGrid(40, 40, 36, rows => { for (let x = 20; x <= 38; x++) setCol(rows, x, 1, 35, '#'); });
      const b = sim.newBody();
      b.x = 20 * 32 - 22; b.y = 10 * 32; b.vy = 100; b.grounded = false;
      // slide down the wall (holding into it) for a moment, then wall-jump with no input
      for (let i = 0; i < 20; i++) sim.stepPhysics(b, M, G, 1, false, false, false);
      const kind = sim.tryJump(b, M, G, false);
      const y0 = b.y;
      let minY = b.y;
      for (let i = 0; i < 200; i++) {
        sim.stepPhysics(b, M, G, 0, true, false, false);
        if (b.y < minY) minY = b.y;
        if (b.vy > 0 && b.y > minY + 4) break;
      }
      return { apex: y0 - minY, kind };
    },
    shaft() {
      const M = sim.makeModel('EXACT', 4);
      const G = flatGrid(40, 60, 56, rows => { for (let x = 1; x <= 15; x++) setCol(rows, x, 1, 55, '#'); for (let x = 19; x <= 38; x++) setCol(rows, x, 1, 55, '#'); });
      const b = sim.newBody(); sim.placeOnFloor(b, 17, 56);
      sim.tryJump(b, M, G, false);
      let dir = 1, prevWall = 0;
      const hops = [];
      for (let i = 0; i < 1200 && hops.length < 6; i++) {
        sim.stepPhysics(b, M, G, dir, true, false, false);
        if (!b.grounded && b.wall !== 0 && b.wall !== prevWall) {
          if (sim.tryJump(b, M, G, false) === 'wall') { hops.push(b.y); dir = -dir; }
        }
        prevWall = b.wall;
      }
      const gains = [];
      for (let k = 2; k < hops.length; k++) gains.push(hops[k - 1] - hops[k]);
      return { gain: gains.length ? gains.reduce((a, c) => a + c, 0) / gains.length : NaN, hops: hops.length };
    },
    dash() {
      const M = sim.makeModel('EXACT', 6), G = flatGrid(60, 20, 16);
      const b = sim.newBody(); sim.placeOnFloor(b, 10, 16);
      const x0 = b.x;
      sim.startDash(b, M, 1, 0);
      while (b.dashT > 0) sim.stepPhysics(b, M, G, 1, false, false, false);
      return { dist: b.x - x0 };
    },
    bounce() {
      const M = sim.makeModel('EXACT', 3), G = flatGrid(40, 30, 26);
      const b = sim.newBody(); sim.placeOnFloor(b, 10, 26);
      const y0 = b.y;
      sim.launch(b, null, -M.bounceV, true);
      let minY = b.y;
      for (let i = 0; i < 300; i++) {
        const ev = sim.stepPhysics(b, M, G, 0, true, false, false);
        if (b.y < minY) minY = b.y;
        if (ev & sim.EV.LANDED) break;
      }
      return { apex: y0 - minY };
    },
    orbit() {
      const M = sim.makeModel('EXACT', 99);
      const b = sim.newBody();
      const nx = 400, ny = 300;
      b.x = nx + 80 - 11; b.y = ny - 11; b.vx = 0; b.vy = 0; b.facing = 1;
      const r = sim.orbitAttach(b, nx, ny, M, 1, null);
      return { speed: r.speed };
    },
    terminal() {
      const M = sim.makeModel('EXACT', 3), G = flatGrid(20, 200, 196);
      const run = down => {
        const b = sim.newBody(); b.x = 300; b.y = 64; b.grounded = false;
        let vmax = 0;
        for (let i = 0; i < 240; i++) { sim.stepPhysics(b, M, G, 0, false, false, down); if (b.vy > vmax) vmax = b.vy; }
        return vmax;
      };
      return { vmax: run(false), vfast: run(true) };
    }
  };

  // ------------------------------------------------------------------ (b) the real player
  function levelFrom(rows, form, id) {
    return { id: 'test-phys-' + id, world: 0, form, name: 'phys ' + id, map: rows, legend: {}, entities: [], signs: [], meta: { phys: true } };
  }
  function rowsFlat(w, h, floor) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) r += (x === 0 || x === w - 1 || y === 0 || y >= floor) ? '#' : '.';
      rows.push(r);
    }
    return rows;
  }
  function put(rows, x, y, ch) { rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1); }

  function engine(rep, verbose) {
    const avail = cli.exists('js/game/player.js') && cli.exists('js/game/levelscene.js');
    if (!avail) return { available: false, why: 'js/game/player.js or js/game/levelscene.js is missing' };
    let h;
    try { h = harness.create({ gl: 'null', boot: false }); }
    catch (e) { return { available: false, why: 'harness failed: ' + e.message }; }
    const boot = harness.ensureBoot(h);
    const AP = h.AP;
    if (!AP || !AP.Test || typeof AP.Test.startLevel !== 'function' || !AP.Input || typeof AP.Input.setVirtual !== 'function' || !AP.Loop || typeof AP.Loop.step !== 'function') {
      return { available: false, why: 'AP.Test.startLevel / AP.Input.setVirtual / AP.Loop.step unavailable' + (boot.note ? ' (' + boot.note + ')' : '') };
    }
    const I = AP.Input;
    const C = AP.C;
    const results = {}, errors = [];
    function start(rows, form, id) {
      I.clearVirtual();
      const L = AP.Test.startLevel(levelFrom(rows, form, id), { form, mode: 'test' });
      if (!L || !L.player) throw new Error('AP.Test.startLevel returned no level/player');
      AP.Test.god(true);
      step(30);
      return L;
    }
    function step(n) { for (let i = 0; i < (n || 1); i++) { h.S.advance(1000 / 120); AP.Loop.step(1); } }
    function P() { return AP.level && AP.level.player; }
    function tap(a) { I.setVirtual(a, true); I.setVirtual(a, false); }
    function repress(a) { I.setVirtual(a, false); I.setVirtual(a, true); }
    const run = (id, fn) => {
      const mark = h.mark();
      try { results[id] = fn(); }
      catch (e) { results[id] = { error: e.message }; errors.push(id + ': ' + (e && e.stack || e)); }
      for (const er of h.errorsSince(mark)) errors.push(id + ': ' + harness.fmtError(er));
      I.clearVirtual();
    };
    run('jump', () => {
      const rows = rowsFlat(80, 20, 16); put(rows, 3, 15, 'P');
      start(rows, 3, 'jump');
      I.setVirtual('right', true); step(60);
      const p = P(); const y0 = p.y, x0 = p.x;
      I.setVirtual('jump', true);
      let minY = y0, n = 0, left = false;
      for (let i = 0; i < 400; i++) {
        step(1); n++;
        if (!p.grounded) left = true;
        if (p.y < minY) minY = p.y;
        if (left && p.grounded) break;
      }
      return { apex: y0 - minY, travel: p.x - x0, air: n * C.STEP };
    });
    run('tap', () => {
      const rows = rowsFlat(40, 20, 16); put(rows, 10, 15, 'P');
      start(rows, 3, 'tap');
      const p = P(); const y0 = p.y;
      tap('jump');
      let minY = y0;
      for (let i = 0; i < 200; i++) { step(1); if (p.y < minY) minY = p.y; if (i > 2 && p.grounded) break; }
      return { apex: y0 - minY };
    });
    run('dj', () => {
      const rows = rowsFlat(40, 30, 26); put(rows, 10, 25, 'P');
      start(rows, 5, 'dj');
      const p = P(); const y0 = p.y;
      I.setVirtual('jump', true);
      let minY = y0, stage = 0;
      for (let i = 0; i < 400; i++) {
        step(1);
        if (p.y < minY) minY = p.y;
        if (stage === 0 && i > 2 && p.vy >= 0) { I.setVirtual('jump', false); stage = 1; }
        else if (stage === 1) { I.setVirtual('jump', true); stage = 2; }
        if (stage === 2 && i > 10 && p.grounded) break;
      }
      return { apex: y0 - minY };
    });
    run('walljump', () => {
      const rows = rowsFlat(40, 40, 36);
      for (let y = 1; y <= 35; y++) for (let x = 20; x <= 38; x++) put(rows, x, y, '#');
      put(rows, 16, 35, 'P');
      start(rows, 4, 'walljump');
      const p = P();
      AP.Test.teleport(20 * 32 - 11, 11 * 32);
      I.setVirtual('right', true);
      let i = 0;
      for (; i < 120; i++) { step(1); if (!p.grounded && p.wall === 1 && p.vy > 0) break; }
      if (i >= 120) throw new Error('never slid on the wall (P.wall stayed ' + p.wall + ')');
      step(24);                       // slide 0.2 s: the coyote time from the teleport has expired
      I.setVirtual('right', false);
      const y0 = p.y;
      tap('jump');
      I.setVirtual('jump', true);
      step(1);
      let minY = p.y;
      for (let k = 0; k < 200; k++) { step(1); if (p.y < minY) minY = p.y; if (p.vy > 0 && p.y > minY + 4) break; }
      return { apex: y0 - minY };
    });
    run('shaft', () => {
      const rows = rowsFlat(40, 60, 56);
      for (let y = 1; y <= 55; y++) { for (let x = 1; x <= 15; x++) put(rows, x, y, '#'); for (let x = 19; x <= 38; x++) put(rows, x, y, '#'); }
      put(rows, 17, 55, 'P');
      start(rows, 4, 'shaft');
      const p = P();
      let dir = 1;
      I.setVirtual('right', true);
      I.setVirtual('jump', true);
      const hops = [];
      let prevWall = 0;
      for (let i = 0; i < 1500 && hops.length < 6; i++) {
        step(1);
        const w = p.wall || 0;
        if (!p.grounded && w !== 0 && w !== prevWall && hops.length < 6) {
          dir = -w;
          I.setVirtual('right', dir > 0); I.setVirtual('left', dir < 0);
          repress('jump');
          step(1);
          hops.push(p.y);
        }
        prevWall = p.wall || 0;
      }
      const gains = [];
      for (let k = 2; k < hops.length; k++) gains.push(hops[k - 1] - hops[k]);
      if (!gains.length) throw new Error('no chained wall-jumps happened (hops ' + hops.length + ')');
      return { gain: gains.reduce((a, c) => a + c, 0) / gains.length };
    });
    run('dash', () => {
      const rows = rowsFlat(60, 20, 16); put(rows, 10, 15, 'P');
      start(rows, 6, 'dash');
      const p = P(); const x0 = p.x;
      I.setVirtual('right', true); tap('dash');
      let lastX = x0, seen = false;
      for (let i = 0; i < 80; i++) {
        step(1);
        if (p.state === 'dash') { seen = true; lastX = p.x; }
        else if (seen) break;
      }
      if (!seen) throw new Error('the dash never started (P.state never "dash")');
      return { dist: lastX - x0 };
    });
    run('bounce', () => {
      const rows = rowsFlat(40, 30, 26); put(rows, 8, 25, 'P'); put(rows, 12, 25, 'B');
      start(rows, 3, 'bounce');
      const p = P();
      I.setVirtual('right', true);
      let y0 = null, minY = Infinity;
      for (let i = 0; i < 400; i++) {
        const before = p.y;
        step(1);
        if (y0 === null && p.vy < -500) { y0 = before; I.setVirtual('right', false); I.setVirtual('jump', true); }
        if (y0 !== null) { if (p.y < minY) minY = p.y; if (p.vy > 0 && p.y > minY + 4) break; }
      }
      if (y0 === null) throw new Error('the bounce pad never launched the player');
      return { apex: y0 - minY };
    });
    run('orbit', () => {
      const rows = rowsFlat(40, 30, 26); put(rows, 5, 25, 'P'); put(rows, 20, 10, 'O');
      start(rows, 99, 'orbit');
      const p = P();
      const ncx = 20 * 32 + 16, ncy = 10 * 32 + 16;
      AP.Test.teleport(ncx + 80, ncy + 11);
      let fling = null;
      const off = AP.Events && AP.Events.on ? AP.Events.on('player:fling', e => { fling = e && typeof e.speed === 'number' ? e.speed : null; }) : null;
      I.setVirtual('orbit', true);
      let k = 0;
      while (k < 20 && p.state !== 'orbit') { step(1); k++; }
      if (p.state !== 'orbit') throw new Error('never attached to the node (P.state never "orbit")');
      step(119);                      // attached for 1 s (the attach step + 119)
      I.setVirtual('orbit', false);
      const vx = p.vx, vy = p.vy;
      step(1);
      if (typeof off === 'function') off();
      // player:fling {speed} is the release speed; else the post-step velocity minus that step's gravity
      return { speed: fling !== null ? fling : Math.hypot(p.vx, p.vy - C.GRAVITY * C.STEP), pre: Math.hypot(vx, vy), event: fling !== null };
    });
    run('terminal', () => {
      const rows = rowsFlat(20, 120, 116); put(rows, 5, 115, 'P');
      start(rows, 3, 'terminal');
      const p = P();
      const fall = down => {
        AP.Test.teleport(10 * 32, 3 * 32);
        I.setVirtual('down', down);
        let v = 0;
        for (let i = 0; i < 150; i++) { step(1); if (p.vy > v) v = p.vy; }
        I.setVirtual('down', false);
        return v;
      };
      return { vmax: fall(false), vfast: fall(true) };
    });
    return { available: true, results, errors, boot: boot.note || '' };
  }

  // ------------------------------------------------------------------ main
  function run(argv) {
    const args = cli.parseArgs(argv, { only: 'string', verbose: 'bool' });
    const rep = new cli.Report('phys-test');
    for (const e of args._errors) rep.error('args', e);
    const cinfo = sim.constants();
    if (cinfo.diffs.length) rep.error('const', 'js/core/const.js differs from CONTRACT §2.2 in: ' + cinfo.diffs.join(', '));
    const doA = args.only !== 'b', doB = args.only !== 'a';
    const A = {};
    if (doA) for (const t of TESTS) { try { A[t.id] = MODEL[t.id](); } catch (e) { A[t.id] = { error: e.message }; } }
    const B = doB ? engine(rep, args.verbose) : { available: false, why: 'skipped (--only a)' };
    const rows = [];
    let failA = 0, failB = 0;
    for (const t of TESTS) {
      for (const [label, fn] of t.checks) {
        const ra = doA ? (A[t.id].error ? { ok: false, text: 'error: ' + A[t.id].error } : fn(A[t.id])) : null;
        const rb = B.available ? (B.results[t.id] && !B.results[t.id].error ? fn(B.results[t.id]) : { ok: false, text: 'error: ' + (B.results[t.id] ? B.results[t.id].error : 'not run') }) : null;
        const want = (fn({ apex: 0, travel: 0, air: 0, gain: 0, dist: 0, speed: 0, vmax: 0, vfast: 0 }).want);
        if (ra && !ra.ok) { failA++; rep.error('model ' + t.id, t.name + ' ' + label + ' = ' + ra.text + ' (expected ' + want + ')'); }
        if (rb && !rb.ok) { failB++; rep.error('engine ' + t.id, t.name + ' ' + label + ' = ' + rb.text + ' (expected ' + want + ')'); }
        rows.push([t.name + (t.checks.length > 1 ? ' · ' + label : ''), want, ra ? (ra.ok ? cli.C.green(ra.text) : cli.C.red(ra.text)) : '-', rb ? (rb.ok ? cli.C.green(rb.text) : cli.C.red(rb.text)) : '-']);
      }
    }
    const strip = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');
    const widths = [0, 1, 2, 3].map(i => Math.max(...rows.map(r => strip(r[i]).length), ['test', 'expected', '(a) model', '(b) engine'][i].length));
    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - strip(s).length));
    console.log(cli.C.bold(pad('test', widths[0]) + '  ' + pad('expected', widths[1]) + '  ' + pad('(a) model', widths[2]) + '  ' + '(b) engine'));
    for (const r of rows) console.log(pad(r[0], widths[0]) + '  ' + pad(r[1], widths[1]) + '  ' + pad(r[2], widths[2]) + '  ' + r[3]);
    console.log(cli.C.dim('constants: ' + cinfo.from));
    if (!B.available) {
      rep.warn('engine', '(b) not run: ' + B.why);
    } else {
      if (B.boot) rep.warn('engine', B.boot);
      for (const e of B.errors) rep.error('engine', e);
    }
    rep.print();
    console.log(rep.summary() + ' — model ' + (doA ? (failA ? cli.C.red(failA + ' failing') : cli.C.green('ok')) : 'skipped') + ', engine ' + (B.available ? (failB || B.errors.length ? cli.C.red((failB + B.errors.length) + ' failing') : cli.C.green('ok')) : 'not available'));
    return rep.errors ? 1 : 0;
  }

  module.exports = { run, MODEL, TESTS };
  if (require.main === module) cli.runMain(run);
})();
