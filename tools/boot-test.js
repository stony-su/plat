/* tools/boot-test.js — owner: TOOLS */
(function () {
  'use strict';
  // Headless boot test (CONTRACT §7). Boots the game in the vm harness (AP_NO_AUTOBOOT +
  // AP.boot({headless:true})) and drives it with virtual input and a virtual clock.
  //   levels   per level: AP.Test.startLevel, N s of seeded monkey input (AP.Input.setVirtual),
  //            3 forced deaths, then completeLevel (boss levels: AP.Test.defeatBoss(), then the
  //            player touches V); result object, entity / particle caps
  //   scenes   every registered scene: enter, 5 s of random input with rendering, exit
  //   art      all 9 styles: WebGL backgrounds, render2D, midground, tile art on a map with
  //            every tile type, then the same with GL unavailable (null GL → fallbacks)
  //   audio    every AP.SFX voice, every AP.MUSIC key and loop on the stub AudioContext
  //   endless  K segments through scene 'endless' (or AP.Endless.generate directly)
  //   save     round-trip, corrupted saves (5 kinds), storage that throws, quota errors
  //   gl       the level suite again with getContext('webgl') → null (short runs)
  // Any AP.errors entry, uncaught exception or stub-detected misuse is an error, attributed to
  // its owner. Exit code 0 only when there are none.
  //   node tools/boot-test.js [--world N] [--levels GLOB] [--scenes] [--art] [--audio]
  //        [--endless K] [--save] [--seconds 20] [--dist dist/apeiron.html] [--gl stub|null|both]
  //        [--render-every 4] [--seed N] [--verbose]

  const cli = require('./lib/cli');
  const harness = require('./lib/harness');

  const STEP_MS = 1000 / 120;

  // ---------------------------------------------------------------- shared helpers
  function mkHarness(opts) {
    const h = harness.create(Object.assign({ gl: 'stub', boot: false }, opts));
    const boot = harness.ensureBoot(h);
    return { h, boot };
  }
  function globToRe(g) { return new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'); }
  function errLines(h, mark, extraIssues) {
    const out = h.errorsSince(mark).map(e => ({ owner: e.owner, text: harness.fmtError(e) }));
    if (extraIssues) for (const i of extraIssues) out.push(i);
    return out;
  }
  // new error-level stub issues since a count
  function stubIssuesSince(h, n0) {
    const all = h.issues('error');
    return all.slice(n0).map(i => ({ owner: i.script ? require('./lib/files').ownerOf(i.script) : 'UNKNOWN', text: '[stub] ' + i.kind + ': ' + i.msg + (i.stack ? ' @ ' + i.stack.split(' | ')[0] : '') }));
  }

  // Seeded monkey: biased toward running right and jumping, with dashes and orbit holds.
  function Monkey(seed) {
    const r = cli.mulberry32(seed >>> 0);
    const st = { h: 0, hT: 0, jump: false, jT: 0, jCool: 0, dash: false, dT: 0, orbit: false, oT: 0, down: false, downT: 0, up: false };
    return {
      step(I, dt) {
        st.hT -= dt; st.jT -= dt; st.jCool -= dt; st.dT -= dt; st.oT -= dt; st.downT -= dt;
        if (st.hT <= 0) { const x = r(); st.h = x < 0.68 ? 1 : x < 0.88 ? -1 : 0; st.hT = 0.2 + r() * 1.0; st.up = r() < 0.15; }
        if (st.jump && st.jT <= 0) { st.jump = false; st.jCool = 0.05 + r() * 0.3; }
        else if (!st.jump && st.jCool <= 0 && r() < 0.06) { st.jump = true; st.jT = 0.04 + r() * 0.45; }
        if (st.dash && st.dT <= 0) st.dash = false;
        else if (!st.dash && r() < 0.008) { st.dash = true; st.dT = dt * 2; }
        if (st.orbit && st.oT <= 0) st.orbit = false;
        else if (!st.orbit && r() < 0.004) { st.orbit = true; st.oT = 0.3 + r() * 1.5; }
        if (st.down && st.downT <= 0) st.down = false;
        else if (!st.down && r() < 0.004) { st.down = true; st.downT = 0.15 + r() * 0.3; }
        I.setVirtual('right', st.h > 0); I.setVirtual('left', st.h < 0);
        I.setVirtual('up', st.up); I.setVirtual('down', st.down);
        I.setVirtual('jump', st.jump); I.setVirtual('dash', st.dash); I.setVirtual('orbit', st.orbit);
      }
    };
  }

  // ---------------------------------------------------------------- levels
  function levelIds(AP, args) {
    let ids = [];
    if (AP.Levels && typeof AP.Levels.list === 'function') ids = AP.Levels.list().map(d => d.id);
    else if (AP.Levels && typeof AP.Levels.ids === 'function') ids = AP.Levels.ids();
    if (args.world) ids = ids.filter(id => new RegExp('^w' + args.world + '-').test(id));
    if (args.levels) { const re = globToRe(args.levels); ids = ids.filter(id => re.test(id)); }
    return ids;
  }

  function runLevel(ctx, id, opts) {
    const { h, AP, rep } = ctx;
    const I = AP.Input;
    const res = { id, ok: true, notes: [], deaths: 0, forced: 0, completed: false, maxEnt: 0, maxFx: 0, stepMs: 0, renderMs: 0, steps: 0, renders: 0 };
    const mark = h.mark();
    const n0 = h.issues('error').length;
    const def = AP.Levels.get(id);
    const isBoss = !!(def && def.boss);
    let result = null;
    let completeEvents = 0;
    const offs = [];
    const on = (name, fn) => { if (AP.Events && AP.Events.on) { const off = AP.Events.on(name, fn); if (typeof off === 'function') offs.push(off); } };
    on('level:complete', () => { completeEvents++; });
    const events = {};
    for (const ev of ['player:death', 'player:respawn', 'boss:start', 'boss:hit', 'boss:defeat', 'checkpoint', 'collect:shard', 'player:jump']) on(ev, () => { events[ev] = (events[ev] || 0) + 1; });
    let L = null;
    const start = () => {
      I.clearVirtual();
      L = AP.Test.startLevel(id, { mode: 'test', onComplete: r => { result = r; } });
      return L;
    };
    try {
      start();
      if (!L || L !== AP.level || !L.player) throw new Error('AP.Test.startLevel("' + id + '") did not produce a running level with a player');
      const monkey = Monkey((opts.seed + cli.fnv1a(id)) >>> 0);
      const total = Math.round(opts.seconds * 120);
      const killAt = [Math.floor(total * 0.3), Math.floor(total * 0.55), Math.floor(total * 0.8)];
      let k = 0;
      AP.Test.god(false);
      for (let i = 0; i < total; i++) {
        if (AP.level !== L || result) {
          // the monkey finished (or quit) the level: start it again
          res.notes.push('monkey ' + (result ? 'completed' : 'left') + ' the level at ' + (i / 120).toFixed(1) + ' s');
          result = null;
          start();
          if (!L) throw new Error('restart failed');
        }
        monkey.step(I, 1 / 120);
        const t0 = cli.hrtimeMs();
        h.S.advance(STEP_MS); AP.Loop.step(1);
        res.stepMs += cli.hrtimeMs() - t0; res.steps++;
        if (i % opts.renderEvery === 0) { const t1 = cli.hrtimeMs(); h.render(); h.S.runRaf(); res.renderMs += cli.hrtimeMs() - t1; res.renders++; }
        if (k < 3 && i >= killAt[k]) {
          if (AP.Test.kill ? AP.Test.kill('test') : L.killPlayer('test')) { res.forced++; k++; }
          else if (i > killAt[k] + 360) k++;
        }
        const ne = L.entities ? L.entities.length : 0;
        if (ne > res.maxEnt) res.maxEnt = ne;
        if (AP.FX && AP.FX.count) { const c = AP.FX.count(); if (c > res.maxFx) res.maxFx = c; }
      }
      I.clearVirtual();
      // short runs: keep stepping (no input) until three forced deaths were accepted (≤ 8 s)
      for (let i = 0; i < 960 && res.forced < 3 && AP.level === L; i++) {
        h.step(1);
        if (i % 12 === 0 && (AP.Test.kill ? AP.Test.kill('test') : L.killPlayer('test'))) res.forced++;
      }
      // let a death in progress resolve
      for (let i = 0; i < 180 && L.player && (L.player.state === 'dead' || L.player.state === 'respawn'); i++) h.step(1);
      res.deaths = L.stats ? L.stats.deaths : 0;
      if (res.forced < 3) res.notes.push('only ' + res.forced + '/3 forced deaths were accepted');
      // completion
      if (isBoss) {
        AP.Test.god(true);
        const ok = AP.Test.defeatBoss();
        if (!ok) throw new Error('AP.Test.defeatBoss() returned false (boss not defeated within 100 debugDamage calls)');
        if (!events['boss:defeat']) res.notes.push('no boss:defeat event was emitted');
        // wait for the vertex, then touch it
        let v = null;
        for (let i = 0; i < 400 && AP.level === L && !result; i++) {
          h.step(1);
          v = L.first ? L.first('vertex') : null;
          if (v && (L.vertexOn || v.active !== false)) break;
        }
        if (!v) throw new Error('no vertex V to touch after the boss was defeated');
        for (let i = 0; i < 900 && !result && AP.level === L; i++) {
          if (i % 30 === 0 && L.player && L.player.state === 'normal') AP.Test.teleport(v.x + v.w / 2, v.y + v.h);
          h.step(1);
          if (i % 8 === 0) h.render();
        }
        if (!result) throw new Error('touching V did not complete the level within 7.5 s');
        const W = AP.Worlds && AP.Worlds.get(def.world);
        // forms are granted only by story-mode completions (AP.Progress.complete); this run is mode 'test'
        if (W && W.reward && result.mode === 'story' && result.formGained !== W.reward) res.notes.push('result.formGained is ' + result.formGained + ', expected ' + W.reward);
        if (W && W.n === 5 && !result.ending) res.notes.push('w5-boss result.ending should be true');
        AP.Test.god(false);
      } else {
        AP.Test.god(true);
        if (AP.Test.complete) AP.Test.complete(); else L.completeLevel({});
        for (let i = 0; i < 1200 && !result; i++) { h.step(1); if (i % 8 === 0) h.render(); }
        AP.Test.god(false);
        if (!result) throw new Error('completeLevel() did not deliver a result within 10 s');
      }
      res.completed = true;
      const keys = ['id', 'world', 'index', 'name', 'mode', 'time', 'deaths', 'shards', 'shardsTotal', 'gems', 'newBest', 'firstClear', 'assisted', 'formGained', 'next', 'ending'];
      const miss = keys.filter(k2 => !(k2 in result));
      if (miss.length) res.notes.push('result object misses ' + miss.join(', ') + ' (CONTRACT §2.14)');
      if (result && (!Array.isArray(result.gems) && !(result.gems && result.gems.length === 3))) res.notes.push('result.gems should be 3 booleans');
      if (!completeEvents) res.notes.push('no level:complete event was emitted');
    } catch (e) {
      res.ok = false;
      res.fail = e.message;
    }
    for (const off of offs) { try { off(); } catch (e) { /* listener already gone */ } }
    I.clearVirtual();
    res.errors = errLines(h, mark, stubIssuesSince(h, n0));
    if (res.maxEnt > 600) res.notes.push('entity count reached ' + res.maxEnt + ' (budget 600)');
    if (res.maxFx > 1800) res.errors.push({ owner: 'CORE', text: 'particle count reached ' + res.maxFx + ' (hard cap 1800)' });
    if (res.errors.length || !res.ok) res.ok = false;
    return res;
  }

  function levelSuite(ctx, ids, opts, label) {
    const { rep } = ctx;
    for (const id of ids) {
      const t0 = cli.hrtimeMs();
      const r = runLevel(ctx, id, opts);
      const secs = ((cli.hrtimeMs() - t0) / 1000).toFixed(1);
      const perf = r.steps ? (r.stepMs / r.steps).toFixed(2) + ' ms/step, ' + (r.renders ? (r.renderMs / r.renders).toFixed(2) : '-') + ' ms/render' : '';
      const line = (r.ok ? cli.C.green('ok   ') : cli.C.red('FAIL ')) + (label ? label + ' ' : '') + id.padEnd(12) + cli.C.dim(' ' + opts.seconds + ' s monkey · ' + r.forced + ' forced / ' + r.deaths + ' deaths · ' + (r.completed ? 'completed' : 'not completed') + ' · ' + perf + ' · max ' + r.maxEnt + ' entities, ' + r.maxFx + ' particles · ' + secs + ' s');
      console.log(line);
      if (r.fail) rep.error(id, r.fail);
      for (const e of r.errors) rep.error(id, e.text);
      for (const n of r.notes) {
        const isErr = /misses|should be|did not|no level:complete|no boss:defeat/.test(n);
        if (isErr) rep.error(id, n); else rep.info(id, n);
        console.log('     ' + (isErr ? cli.C.red(n) : cli.C.dim(n)));
      }
      for (const e of r.errors) console.log('     ' + cli.C.red(e.text));
      if (r.fail) console.log('     ' + cli.C.red(r.fail));
    }
  }

  // ---------------------------------------------------------------- scenes
  const SCENE_PARAMS = {
    level: AP => ({ id: firstLevel(AP), mode: 'test' }),
    results: AP => ({ id: firstLevel(AP), world: 1, index: 1, name: 'Test', mode: 'story', time: 61.2, deaths: 2, shards: 17, shardsTotal: 24, gems: [true, false, true], newBest: true, firstClear: true, assisted: false, formGained: 0, next: null, ending: false }),
    map: AP => ({ focus: firstLevel(AP) }),
    intro: () => ({ next: 'map' }),
    endless: () => ({ seed: 4242 }),
    pause: AP => ({ L: AP.level }),
    settings: () => ({ from: 'title' })
  };
  const OVERLAYS = new Set(['pause', 'settings', 'remap']);
  function firstLevel(AP) { const l = AP.Levels && AP.Levels.list ? AP.Levels.list() : []; const w = l.find(d => /^w1-1$/.test(d.id)) || l[0]; return w ? w.id : null; }

  function sceneSuite(ctx, opts) {
    const { h, AP, rep } = ctx;
    const I = AP.Input;
    const names = new Set((h.registry.scenes || []).map(s => s.name));
    const r = cli.mulberry32(opts.seed ^ 0x5CE7E5);
    const UI = ['up', 'down', 'left', 'right', 'confirm', 'back', 'jump', 'dash'];
    if (!names.size) { rep.warn('scenes', 'no scenes are registered'); return; }
    for (const name of names) {
      const mark = h.mark();
      const n0 = h.issues('error').length;
      let fail = null;
      try {
        // a level underneath overlays
        if (OVERLAYS.has(name)) { const id = firstLevel(AP); if (id) AP.Test.startLevel(id, { mode: 'test' }); }
        else goScene(AP, 'devmenu');
        const params = SCENE_PARAMS[name] ? SCENE_PARAMS[name](AP) : {};
        if (OVERLAYS.has(name)) AP.Scenes.push(name, params);
        else goScene(AP, name, params);
        h.step(70); h.render();
        for (let i = 0; i < 600; i++) {
          if (i % 18 === 0) { I.clearVirtual(); const a = UI[Math.floor(r() * UI.length)]; if (a !== 'back' || r() < 0.35) { I.setVirtual(a, true); } }
          if (i % 18 === 4) I.clearVirtual();
          h.S.advance(STEP_MS); AP.Loop.step(1);
          if (i % 4 === 0) { h.render(); h.S.runRaf(); }
        }
        I.clearVirtual();
        // exit
        if (OVERLAYS.has(name) && AP.Scenes.top && AP.Scenes.top() && AP.Scenes.stack && AP.Scenes.stack.length > 1) AP.Scenes.pop();
        goScene(AP, 'devmenu');
        h.step(70); h.render();
      } catch (e) { fail = e.message; }
      const errs = errLines(h, mark, stubIssuesSince(h, n0));
      const ok = !fail && !errs.length;
      console.log((ok ? cli.C.green('ok   ') : cli.C.red('FAIL ')) + 'scene ' + name.padEnd(10) + cli.C.dim(' enter · 5 s random input · render · exit'));
      if (fail) { rep.error('scene ' + name, fail); console.log('     ' + cli.C.red(fail)); }
      for (const e of errs) { rep.error('scene ' + name, e.text); console.log('     ' + cli.C.red(e.text)); }
    }
  }
  function goScene(AP, name, params) {
    if (!AP.Scenes) return;
    if (typeof AP.Scenes.goNow === 'function') AP.Scenes.goNow(name, params || {});
    else AP.Scenes.go(name, params || {}, { fx: 'none', dur: 0 });
  }

  // ---------------------------------------------------------------- art
  function artMap(style) {
    const rows = [];
    for (let y = 0; y < 18; y++) {
      let s = '';
      for (let x = 0; x < 48; x++) s += (x === 0 || x === 47 || y === 0 || y >= 15) ? '#' : '.';
      rows.push(s);
    }
    const put = (x, y, ch) => { rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1); };
    for (let x = 6; x <= 10; x++) put(x, 11, '=');
    for (let x = 13; x <= 15; x++) put(x, 14, '^');
    for (let x = 13; x <= 15; x++) put(x, 1, 'v');
    put(1, 6, '>'); put(46, 6, '<');
    for (let y = 9; y <= 14; y++) put(20, y, '+');
    for (let y = 12; y <= 14; y++) { put(25, y, '%'); put(26, y, '%'); }
    for (let x = 30; x <= 34; x++) put(x, 10, '#');
    for (let x = 36; x <= 39; x++) put(x, 12, '~');
    put(2, 14, 'P'); put(44, 14, 'E'); put(4, 14, 'S'); put(8, 14, 'C'); put(12, 13, '*'); put(17, 14, 'B'); put(28, 8, 'O');
    put(22, 14, '1'); put(32, 9, '2'); put(42, 14, '3');
    return { id: 'test-art-' + style, world: 0, form: 99, name: 'art ' + style, style, music: 'map', map: rows, legend: {}, entities: [], signs: ['Art test'], meta: {} };
  }
  function artSuite(ctx, opts) {
    const { h, AP, rep } = ctx;
    const styles = AP.STYLES || ['title', 'map', 'w1', 'w2', 'w3', 'w4', 'w5', 'endless', 'void'];
    const BG = AP.Backgrounds, MG = AP.Midground, TA = AP.TileArt;
    const gl = AP.GL && AP.GL.gl;
    const ctx2d = AP.R && AP.R.ctx;
    if (!BG) rep.error('art', 'AP.Backgrounds is missing (js/art/backgrounds.js)');
    if (!MG) rep.error('art', 'AP.Midground is missing (js/art/midground.js)');
    if (!TA) rep.error('art', 'AP.TileArt is missing (js/art/tileart.js)');
    if (!AP.Art) rep.warn('art', 'AP.Art kit is missing (optional)');
    if (BG && typeof BG.init === 'function' && gl) {
      let ok = null;
      try { ok = BG.init(gl); } catch (e) { rep.error('art', 'AP.Backgrounds.init(gl) threw: ' + e.message); }
      if (ok === false) rep.error('art', 'AP.Backgrounds.init(gl) returned false on a working (stub) WebGL context');
    }
    for (const key of styles) {
      const mark = h.mark();
      const n0 = h.issues('error').length;
      const times = { bg: 0, bg2d: 0, mid: 0, tiles: 0, n: 0 };
      let fail = null;
      try {
        if (BG && typeof BG.has === 'function' && !BG.has(key)) rep.error('art ' + key, 'AP.Backgrounds.has("' + key + '") is false: every AP.STYLES key needs a background');
        const L = AP.Test.startLevel(artMap(key), { form: 99, mode: 'test' });
        if (!L) throw new Error('could not start the art test level');
        const pal = AP.Worlds ? AP.Worlds.pal(key) : {};
        for (let f = 0; f < 40; f++) {
          const p = { t: f * 0.5 + (f > 30 ? 3700 : 0), camX: f * 37, camY: f * 11, w: 960, h: 540, intensity: (f % 10) / 9, beat: f * 0.25, phase: (f * 0.25) % 1, pal, seed: 11, quality: AP.R && AP.R.quality ? AP.R.quality : { particles: 1, bg: 'high', mid: true } };
          if (BG && gl && typeof BG.render === 'function') { const t0 = cli.hrtimeMs(); BG.render(gl, key, p); times.bg += cli.hrtimeMs() - t0; }
          if (BG && typeof BG.render2D === 'function' && ctx2d) { const t0 = cli.hrtimeMs(); BG.render2D(ctx2d, key, p); times.bg2d += cli.hrtimeMs() - t0; }
          if (MG && typeof MG.render === 'function' && ctx2d) {
            const t0 = cli.hrtimeMs();
            MG.render(ctx2d, key, { t: p.t, camX: p.camX, camY: p.camY, L: f % 2 ? L : null, pal, quality: p.quality, intensity: p.intensity, beat: p.beat });
            times.mid += cli.hrtimeMs() - t0;
          }
          // the level itself renders tile art through LevelScene
          const t2 = cli.hrtimeMs();
          h.step(2); h.render();
          times.tiles += cli.hrtimeMs() - t2;
          times.n++;
          if (f === 10 && L.setTile) { L.setTile(30, 10, 0); L.setTile(12, 12, 1); }
          if (f === 20 && L.breakTile) L.breakTile(20, 12, 'test');
        }
        if (TA && typeof TA.resize === 'function') TA.resize();
        if (TA && typeof TA.dispose === 'function') TA.dispose(L);
        if (TA && typeof TA.build === 'function') TA.build(L);
        h.render();
      } catch (e) { fail = e.message; }
      const errs = errLines(h, mark, stubIssuesSince(h, n0));
      const ok = !fail && !errs.length;
      const n = Math.max(1, times.n);
      console.log((ok ? cli.C.green('ok   ') : cli.C.red('FAIL ')) + 'art ' + key.padEnd(8) + cli.C.dim(' GL bg ' + (times.bg / n).toFixed(2) + ' ms · render2D ' + (times.bg2d / n).toFixed(2) + ' ms · midground ' + (times.mid / n).toFixed(2) + ' ms · level frame (tiles) ' + (times.tiles / n).toFixed(2) + ' ms (Node vm times)'));
      if (fail) { rep.error('art ' + key, fail); console.log('     ' + cli.C.red(fail)); }
      for (const e of errs) { rep.error('art ' + key, e.text); console.log('     ' + cli.C.red(e.text)); }
    }
    const ut = h.S.gl && h.S.gl.uniformValues && h.S.gl.uniformValues.uTime;
    if (ut && ut.max > 3600) rep.error('art', 'uTime reached ' + ut.max.toFixed(1) + ' (must wrap at 3600 s)');
    const glErrs = h.issues('error').filter(i => /^gl/.test(i.kind));
    for (const i of glErrs) rep.error('art GL', i.msg);
    // null GL: fallbacks
    const nul = mkHarness({ gl: 'null' });
    const A2 = nul.h.AP;
    const mark2 = nul.h.mark();
    let fail2 = null;
    try {
      if (A2.GL && A2.GL.ok) rep.error('art null-GL', 'AP.GL.ok is true although getContext("webgl") returned null');
      for (const key of styles) {
        const L = A2.Test.startLevel(artMap(key), { form: 99, mode: 'test' });
        if (!L) throw new Error('could not start the art test level with null GL');
        for (let f = 0; f < 6; f++) { nul.h.step(2); nul.h.render(); }
      }
    } catch (e) { fail2 = e.message; }
    const errs2 = errLines(nul.h, mark2);
    console.log(((fail2 || errs2.length) ? cli.C.red('FAIL ') : cli.C.green('ok   ')) + 'art null-GL ' + cli.C.dim('all styles render through the 2D fallback'));
    if (fail2) rep.error('art null-GL', fail2);
    for (const e of errs2) { rep.error('art null-GL', e.text); console.log('     ' + cli.C.red(e.text)); }
  }

  // ---------------------------------------------------------------- audio
  function audioSuite(ctx, opts) {
    const { h, AP, rep } = ctx;
    const A = AP.Audio;
    if (!A) { rep.error('audio', 'AP.Audio is missing (js/audio/engine.js)'); return; }
    const S = h.S;
    // before unlock: silent no-ops, no AudioContext
    const fresh = mkHarness({ gl: 'null' });
    const FA = fresh.h.AP.Audio;
    if (FA) {
      try {
        FA.sfx('jump'); FA.music('w1');
        if (fresh.h.S.audio.contexts.length) rep.error('audio', 'an AudioContext was created before unlock() (must wait for a user gesture)');
      } catch (e) { rep.error('audio', 'calls before unlock() threw: ' + e.message); }
    }
    const mark = h.mark();
    const n0 = h.issues('error').length;
    let fail = null;
    let missingSfx = [], startedMusic = {}, sfxStarted = 0, perVoice = 1;
    try {
      if (typeof A.unlock === 'function') A.unlock();
      h.step(2);
      if (!A.ready) rep.error('audio', 'AP.Audio.ready is false after unlock() with a working AudioContext');
      for (const name of AP.SFX || []) {
        if (typeof A.has === 'function' && !A.has(name)) missingSfx.push(name);
        const before = S.audio.started;
        A.sfx(name, { vol: 0.8, pitch: 1.1, pan: -0.3 });
        const one = S.audio.started - before;
        if (one > perVoice) perVoice = one;
        A.sfx(name);
        if (S.audio.started > before) sfxStarted++;
        h.S.advance(30); A.tick && A.tick();
      }
      if (missingSfx.length) rep.error('audio', 'AP.Audio.has() is false for ' + missingSfx.length + ' AP.SFX name(s): ' + missingSfx.join(', '));
      // voice cap: 120 sfx within 0.12 s; once stolen voices have released (0.15 s later) at
      // most 24 voices may sound (each voice uses ≤ perVoice sources, measured above)
      h.S.advance(3000); A.tick && A.tick();
      for (let i = 0; i < 120; i++) { A.sfx(AP.SFX[i % AP.SFX.length]); h.S.advance(1); }
      h.S.advance(150); A.tick && A.tick();
      const act = S.audio.active.length;
      if (act > 24 * perVoice + 4) rep.error('audio', 'after a burst of 120 sfx, ' + act + ' sources are still playing (> 24 voices × ' + perVoice + ' sources per voice): SFX voices must be capped at 24, stealing the oldest');
      h.S.advance(3000);
      // music
      for (const key of Object.keys(AP.MUSIC || {})) {
        const before = S.audio.started;
        AP.music(key);
        if (AP.Beat && AP.Beat.reset) AP.Beat.reset();
        for (let f = 0; f < 240; f++) {
          if (f === 80 && A.setIntensity) A.setIntensity(1);
          if (f === 160 && A.setIntensity) A.setIntensity(0.3);
          h.S.advance(1000 / 60);
          if (AP.Beat && AP.Beat.update) { AP.Beat.update(1 / 120); AP.Beat.update(1 / 120); }
          A.tick && A.tick();
        }
        startedMusic[key] = S.audio.started - before;
      }
      const silent = Object.keys(startedMusic).filter(k => startedMusic[k] === 0);
      if (silent.length) rep.error('audio', 'no notes were scheduled during 4 s of music for: ' + silent.join(', '));
      A.music(null);
      // loops, volumes, ducking, suspend/resume
      for (const name of AP.LOOPS || []) {
        A.setLoop(name, 0.5);
        for (let f = 0; f < 30; f++) { h.S.advance(1000 / 60); A.tick && A.tick(); }
        A.setLoop(name, 0);
      }
      A.setVolumes && A.setVolumes({ master: 0.5, music: 0.4, sfx: 0.7 });
      A.duck && A.duck(0.6, 0.4);
      A.suspend && A.suspend(); A.resume && A.resume();
      h.S.advance(500); A.tick && A.tick();
      const topo = S.audioTopology ? S.audioTopology() : null;
      if (topo && !topo.compressorToDestination) rep.error('audio', 'no DynamicsCompressor is connected to the destination (CONTRACT §2.18: buses → master → compressor → destination)');
      if (S.audio.pastSchedules > 0) rep.warn('audio', S.audio.pastSchedules + ' event(s) were scheduled in the past (the lookahead must never schedule behind currentTime)');
    } catch (e) { fail = e.message; }
    const errs = errLines(h, mark, stubIssuesSince(h, n0));
    console.log(((fail || errs.length || missingSfx.length) ? cli.C.red('FAIL ') : cli.C.green('ok   ')) + 'audio ' + cli.C.dim((AP.SFX || []).length + ' sfx (' + sfxStarted + ' made sound) · ' + Object.keys(startedMusic).length + ' music keys (' + Object.keys(startedMusic).map(k => k + ' ' + startedMusic[k]).join(', ') + ' notes) · loops ' + (AP.LOOPS || []).join(', ') + ' · max ' + S.audio.maxActive + ' sources'));
    if (fail) rep.error('audio', fail);
    for (const e of errs) { rep.error('audio', e.text); console.log('     ' + cli.C.red(e.text)); }
  }

  // ---------------------------------------------------------------- endless
  function endlessSuite(ctx, K, opts) {
    const { h, AP, rep } = ctx;
    const mark = h.mark();
    let fail = null, segs = 0, seen = new Set();
    try {
      const hasScene = AP.Scenes && AP.Scenes.has && AP.Scenes.has('endless');
      if (!hasScene && !(AP.Endless && AP.Endless.generate)) throw new Error('neither scene "endless" nor AP.Endless.generate is available');
      if (hasScene) {
        let segEvents = 0;
        const off = AP.Events.on('endless:segment', () => { segEvents++; });
        goScene(AP, 'endless', { seed: 4242 });
        h.step(90);
        const monkey = Monkey(opts.seed ^ 0xE11D1E55);
        for (let s = 0; s < K; s++) {
          let L = AP.level;
          for (let i = 0; i < 240 && !(L && AP.level === L && L.player); i++) { h.step(1); L = AP.level; }
          if (!L) throw new Error('segment ' + (s + 1) + ' never started');
          seen.add(L.id);
          for (let i = 0; i < 360; i++) { monkey.step(AP.Input, 1 / 120); h.step(1); if (i % 6 === 0) h.render(); if (AP.level !== L) break; }
          AP.Input.clearVirtual();
          if (AP.level === L) { AP.Test.god(true); AP.Test.complete ? AP.Test.complete() : L.completeLevel({}); }
          for (let i = 0; i < 900 && AP.level === L; i++) { h.step(1); if (i % 10 === 0) h.render(); }
          AP.Test.god(false);
          segs++;
        }
        if (typeof off === 'function') off();
        if (!segEvents) rep.error('endless', 'no endless:segment event was emitted');
      } else {
        for (let s = 0; s < K; s++) {
          const lvl = AP.Endless.generate(4242, s, { difficulty: Math.min(1, s / 9) });
          const L = AP.Test.startLevel(lvl, { mode: 'endless' });
          if (!L) throw new Error('generated segment ' + s + ' did not start');
          seen.add(L.id);
          h.step(240);
          segs++;
        }
      }
    } catch (e) { fail = e.message; }
    const errs = errLines(h, mark);
    console.log(((fail || errs.length) ? cli.C.red('FAIL ') : cli.C.green('ok   ')) + 'endless ' + cli.C.dim(segs + '/' + K + ' segments (' + Array.from(seen).slice(0, 4).join(', ') + (seen.size > 4 ? ' …' : '') + ')'));
    if (fail) rep.error('endless', fail);
    for (const e of errs) { rep.error('endless', e.text); console.log('     ' + cli.C.red(e.text)); }
  }

  // ---------------------------------------------------------------- save
  function saveSuite(rep, opts) {
    const report = (name, fail, errs) => {
      console.log(((fail || errs.length) ? cli.C.red('FAIL ') : cli.C.green('ok   ')) + 'save ' + name);
      if (fail) { rep.error('save ' + name, fail); console.log('     ' + cli.C.red(fail)); }
      for (const e of errs) { rep.error('save ' + name, e.text); console.log('     ' + cli.C.red(e.text)); }
    };
    // round-trip
    {
      let fail = null, errs = [];
      try {
        const A = mkHarness({ gl: 'null' });
        const AP = A.h.AP;
        if (!AP.Save) throw new Error('AP.Save is missing');
        const id = firstLevel(AP) || 'w1-1';
        AP.Save.setGem(id, 1);
        AP.Save.stat('jumps', 7);
        AP.Save.setSetting('music', 0.35);
        AP.Save.data.form = 5;
        AP.Save.save(true);
        A.h.S.advance(2000);
        const stored = Object.assign({}, A.h.S.storageData);
        if (!stored['apeiron.save.v1']) throw new Error('nothing was written to localStorage["apeiron.save.v1"]');
        errs = errLines(A.h, { ap: 0, load: 0, unc: 0 });
        const B = mkHarness({ gl: 'null', storageSeed: stored });
        const d = B.h.AP.Save.data;
        const lv = B.h.AP.Save.level(id);
        const probs = [];
        if (!lv || !lv.gems || lv.gems[0] !== true) probs.push('gem 1 of ' + id);
        if (!d.stats || !(d.stats.jumps >= 7)) probs.push('stats.jumps');
        if (!d.settings || Math.abs(d.settings.music - 0.35) > 1e-9) probs.push('settings.music');
        if (d.form !== 5) probs.push('form');
        if (probs.length) fail = 'after reloading, these did not survive: ' + probs.join(', ');
        errs = errs.concat(errLines(B.h, { ap: 0, load: 0, unc: 0 }));
        // export / import
        const str = B.h.AP.Save.export();
        if (typeof str !== 'string' || !str.length) fail = (fail ? fail + '; ' : '') + 'AP.Save.export() returned no string';
        else if (B.h.AP.Save.import(str) !== true) fail = (fail ? fail + '; ' : '') + 'AP.Save.import(export()) did not return true';
        if (B.h.AP.Save.import('{not json') !== false) fail = (fail ? fail + '; ' : '') + 'AP.Save.import(garbage) should return false';
      } catch (e) { fail = e.message; }
      report('round-trip (gem, stats, settings, form; export/import)', fail, errs);
    }
    // corrupted saves
    for (const kind of ['corrupt', 'corrupt-wrong-types', 'corrupt-null', 'corrupt-array', 'corrupt-future-version', 'corrupt-huge', 'corrupt-empty']) {
      let fail = null, errs = [];
      try {
        const C = mkHarness({ gl: 'null', storage: kind });
        const AP = C.h.AP;
        const d = AP.Save && AP.Save.data;
        if (!d) throw new Error('AP.Save.data is missing after boot');
        const probs = [];
        if (d.v !== 1) probs.push('v=' + JSON.stringify(d.v));
        if ((AP.FORMS || [3, 4, 5, 6, 99]).indexOf(d.form) < 0) probs.push('form=' + JSON.stringify(d.form));
        const s = d.settings || {};
        for (const k of ['master', 'music', 'sfx', 'shake']) if (!(typeof s[k] === 'number' && isFinite(s[k]) && s[k] >= 0 && s[k] <= 1)) probs.push('settings.' + k + '=' + JSON.stringify(s[k]));
        if (['full', 'reduced', 'off'].indexOf(s.flash) < 0) probs.push('settings.flash=' + JSON.stringify(s.flash));
        if (!d.levels || typeof d.levels !== 'object' || Array.isArray(d.levels)) probs.push('levels');
        if (Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted') || ({}).polluted) probs.push('prototype pollution through __proto__');
        if (probs.length) fail = 'repaired data is invalid: ' + probs.join(', ');
        // the game still runs
        const id = firstLevel(AP);
        if (id && AP.Test) { AP.Test.startLevel(id, { mode: 'test' }); C.h.step(60); C.h.render(); }
        errs = errLines(C.h, { ap: 0, load: 0, unc: 0 });
      } catch (e) { fail = e.message; }
      report('corrupted (' + kind.replace('corrupt-', '').replace('corrupt', 'invalid-json') + ')', fail, errs);
    }
    // storage that throws / quota
    for (const mode of ['throws', 'quota']) {
      let fail = null, errs = [];
      try {
        const T = mkHarness({ gl: 'null', storage: mode });
        const AP = T.h.AP;
        if (!AP.Save || !AP.Save.data) throw new Error('AP.Save.data is missing');
        if (mode === 'throws' && AP.Save.available !== false) fail = 'AP.Save.available should be false when localStorage throws';
        AP.Save.stat('jumps', 1);
        AP.Save.save(true);
        T.h.step(30);
        const id = firstLevel(AP);
        if (id && AP.Test) { AP.Test.startLevel(id, { mode: 'test' }); T.h.step(60); T.h.render(); }
        errs = errLines(T.h, { ap: 0, load: 0, unc: 0 });
      } catch (e) { fail = e.message; }
      report('storage ' + (mode === 'throws' ? 'throws (file:// / privacy mode)' : 'quota exceeded'), fail, errs);
    }
  }

  // ---------------------------------------------------------------- main
  function run(argv) {
    const args = cli.parseArgs(argv, { world: 'int', levels: 'string', scenes: 'bool', art: 'bool', audio: 'bool', endless: 'int', save: 'bool',
      seconds: 'number', dist: 'string', gl: 'string', renderEvery: 'int', seed: 'int', verbose: 'bool' });
    const rep = new cli.Report('boot-test');
    for (const e of args._errors) rep.error('args', e);
    if (rep.errors) { rep.print(); console.log(rep.summary()); return 2; }
    const any = args.world || args.levels || args.scenes || args.art || args.audio || args.endless || args.save;
    const all = !any;
    const opts = { seconds: args.seconds || 20, renderEvery: Math.max(1, args.renderEvery || 4), seed: args.seed === null ? 1337 : args.seed };
    const glMode = args.gl || (all ? 'both' : 'stub');
    const base = { gl: glMode === 'null' ? 'null' : 'stub' };
    if (args.dist) {
      if (!cli.exists(args.dist)) { rep.error('dist', args.dist + ' does not exist (run node tools/build-dist.js)'); console.log(rep.summary()); return 1; }
      base.dist = cli.rel(args.dist);
    }
    // boot
    const t0 = cli.hrtimeMs();
    const { h, boot } = mkHarness(base);
    const AP = h.AP;
    console.log(cli.C.bold('boot') + cli.C.dim(' ' + h.loadReport.length + ' scripts from ' + h.orderFrom + (base.dist ? '' : ' (' + h.loadReport.filter(e => e.status === 'missing').length + ' missing)') + ', gl ' + base.gl + ' · ' + ((cli.hrtimeMs() - t0) / 1000).toFixed(1) + ' s'));
    if (boot.note) rep.add(boot.booted ? 'warn' : 'error', 'boot', boot.note);
    for (const e of h.errors()) rep.error('boot', harness.fmtError(e));
    for (const e of h.loadReport) if (e.status === 'missing') rep.info('boot', e.file + ' not written yet (' + e.owner + ')');
    const lk = h.leaks();
    for (const g of lk.globals) rep.error('globals', 'leaked global "' + g.name + '" (' + (g.file || 'runtime') + ', ' + g.owner + ')');
    if (!AP || !AP.Test || !AP.Loop || !AP.Input) {
      rep.error('boot', 'AP.Test / AP.Loop / AP.Input are missing: nothing to drive');
      rep.print(); console.log(rep.summary()); return 1;
    }
    const ctx = { h, AP, rep };
    h.step(30); h.render();
    // levels
    if (all || args.world || args.levels) {
      const ids = levelIds(AP, args);
      if (!ids.length) rep.add(args.world || args.levels ? 'error' : 'warn', 'levels', 'no registered levels match' + (args.world ? ' world ' + args.world : '') + (args.levels ? ' "' + args.levels + '"' : ''));
      else {
        console.log(cli.C.bold('levels') + cli.C.dim(' ' + ids.length + ' × ' + opts.seconds + ' s monkey input, 3 forced deaths, completion'));
        levelSuite(ctx, ids, opts, '');
        if (glMode === 'both') {
          console.log(cli.C.bold('levels, WebGL unavailable') + cli.C.dim(' (getContext("webgl") → null)'));
          const n = mkHarness(Object.assign({}, base, { gl: 'null' }));
          levelSuite({ h: n.h, AP: n.h.AP, rep }, ids, Object.assign({}, opts, { seconds: Math.min(4, opts.seconds) }), 'null-GL');
        }
      }
    }
    if (all || args.scenes) { console.log(cli.C.bold('scenes')); sceneSuite(ctx, opts); }
    if (all || args.art) { console.log(cli.C.bold('art')); artSuite(ctx, opts); }
    if (all || args.audio) { console.log(cli.C.bold('audio')); audioSuite(ctx, opts); }
    if (args.endless || (all && AP.Scenes && AP.Scenes.has && AP.Scenes.has('endless'))) { console.log(cli.C.bold('endless')); endlessSuite(ctx, args.endless || 3, opts); }
    if (all || args.save) { console.log(cli.C.bold('save')); saveSuite(rep, opts); }
    const lk2 = h.leaks();
    for (const g of lk2.globals) if (!lk.globals.some(x => x.name === g.name)) rep.error('globals', 'global "' + g.name + '" leaked while running');
    rep.print({ verbose: args.verbose, max: 60 });
    console.log(rep.summary());
    return rep.errors ? 1 : 0;
  }

  module.exports = { run, runLevel, Monkey };
  if (require.main === module) cli.runMain(run);
})();
