/* tools/check-all.js — owner: TOOLS */
(function () {
  'use strict';
  // The mechanical gate (CONTRACT §7). For one owner (or everything) it runs:
  //   1 files      owned files present (missing script = warning, error with --strict)
  //   2 syntax     vm.Script compile of every owned file
  //   3 template   header line, single IIFE with 'use strict', no top-level declarations
  //   4 banned     the §0 grep bans (with the documented allowances)
  //   5 names      literal AP.sfx / AP.music / setLoop / emit / FX names exist in the contract
  //   6 load       harness load in index.html order, failures attributed to owners; boot
  //   7 globals    leaked globals and top-level declarations
  //   8 manifest   §2 symbols of the owner (all with --strict): presence, type, arity, verbatim
  //   9 defs       §2.12 entity def keys / values, boss contract, type and id naming
  //  10 tests      the owner's §7 commands (child processes)
  //   node tools/check-all.js [--owner CORE|TOOLS|ART|AUDIO|UI|W1..W5] [--strict] [--no-tests] [--verbose]

  const fs = require('fs');
  const path = require('path');
  const childProcess = require('child_process');
  const cli = require('./lib/cli');
  const files = require('./lib/files');
  const scan = require('./lib/scan');
  const harness = require('./lib/harness');
  const manifest = require('./contract-manifest');

  const OWNERS = ['CORE', 'TOOLS', 'ART', 'AUDIO', 'UI', 'W1', 'W2', 'W3', 'W4', 'W5'];
  const DEF_KEYS = new Set(['kind', 'w', 'h', 'size', 'anchor', 'layer', 'behindTiles', 'hazard', 'stompable', 'dashable', 'burstable',
    'oneWay', 'orbitNode', 'boss', 'carry', 'required', 'lint', 'lintRects', 'renderPad', 'alwaysRender', 'bossName', 'phases',
    'init', 'update', 'render', 'onTouch', 'onStomp', 'onDash', 'onBurst', 'onPlayerDeath', 'onRespawn', 'onSquish', 'onRemove', 'debugDamage']);
  const HOOKS = ['size', 'lintRects', 'init', 'update', 'render', 'onTouch', 'onStomp', 'onDash', 'onBurst', 'onPlayerDeath', 'onRespawn', 'onSquish', 'onRemove', 'debugDamage'];
  const FLAGS = ['behindTiles', 'hazard', 'stompable', 'dashable', 'burstable', 'oneWay', 'orbitNode', 'boss', 'carry', 'alwaysRender'];
  const KINDS = new Set(['sensor', 'actor', 'solid']);
  const ANCHORS = new Set(['floor', 'center', 'ceiling', 'tile']);
  const LINTS = new Set(['ignore', 'solid', 'stand', 'hazard', 'bounce', 'orbit', 'mover']);
  const SCENE_KEYS = new Set(['enter', 'exit', 'update', 'render', 'bg', 'transparent', 'covered', 'uncovered']);
  const CORE_FX = ['dust', 'land', 'jump', 'walljump', 'dash', 'dashTrail', 'burst', 'death', 'respawn', 'shard', 'gem', 'checkpoint', 'break',
    'crumble', 'bounce', 'spark', 'explode', 'portal', 'orbit', 'fling', 'secret', 'hit', 'bossHit', 'bossDeath', 'vertex'];
  const COMMON_TYPES = new Set(manifest.VERBATIM['AP.Worlds.types'].common);

  // ---------------------------------------------------------------- owner tests (§7 table)
  function ownerTests(owner, strict) {
    const t = [];
    const add = (script, args, label) => t.push({ script, args: args || [], label: label || ('node tools/' + script + (args && args.length ? ' ' + args.join(' ') : '')) });
    const all = !owner;
    if (all || owner === 'CORE') { add('phys-test.js'); add('boot-test.js', ['--levels', 'test-*']); }
    if (all || owner === 'TOOLS') { add('test-algo.js'); add('lint-levels.js', ['--fixtures']); add('harness-test.js'); }
    if (all || owner === 'ART') { add('boot-test.js', ['--art']); add('glsl-lint.js'); }
    if (all || owner === 'AUDIO') add('boot-test.js', ['--audio']);
    if (all || owner === 'UI') add('boot-test.js', ['--scenes']);
    for (let n = 1; n <= 5; n++) {
      if (all || owner === 'W' + n) {
        if (!all) { add('lint-levels.js', ['--world', String(n)]); add('boot-test.js', ['--world', String(n)]); }
        if (n === 1) { add('lint-levels.js', ['--endless', '50']); add('boot-test.js', ['--endless', '10']); }
      }
    }
    if (all) { add('lint-levels.js'); add('boot-test.js'); add('build-dist.js'); add('boot-test.js', ['--dist', 'dist/apeiron.html']); }
    return t;
  }
  function runTool(test) {
    const t0 = cli.hrtimeMs();
    const r = childProcess.spawnSync(process.execPath, [path.join(cli.ROOT, 'tools', test.script)].concat(test.args), {
      cwd: cli.ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { NO_COLOR: '1' }), maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000
    });
    const out = String(r.stdout || '') + String(r.stderr || '');
    const lines = out.split(/\r?\n/).filter(l => l.trim());
    const summary = lines.filter(l => /^(PASS|FAIL)\b/.test(l)).pop() || lines[lines.length - 1] || '';
    return { code: r.status === null ? 2 : r.status, out, lines, summary, ms: cli.hrtimeMs() - t0, error: r.error };
  }

  // ---------------------------------------------------------------- static checks of one file
  function staticChecks(rel, rep, ctx) {
    const src = cli.read(rel);
    const isTool = /^tools\//.test(rel) && !/^tools\/fixtures\//.test(rel);
    const owner = files.ownerOf(rel);
    const syn = scan.syntax(rel, src);
    if (syn) { rep.error(rel + ':' + syn.line, 'syntax: ' + syn.msg); return; }
    for (const i of scan.checkHeader(rel, src, owner)) rep.add(i.level, rel + ':' + i.line, i.msg);
    const iife = scan.checkIIFE(rel, src, isTool ? 'tool' : 'game');
    for (const i of iife.issues) rep.add(i.level, rel + ':' + i.line, i.msg);
    for (const i of scan.bannedScan(rel, src, isTool ? 'tool' : 'game', iife.tokens)) rep.add(i.level, rel + ':' + i.line, '[' + i.rule + '] ' + i.msg);
    if (!isTool) names(rel, src, owner, rep, ctx, iife.tokens);
  }
  function names(rel, src, owner, rep, ctx, tokens) {
    const found = scan.literalCalls(src, tokens);
    const AP = ctx.AP || {};
    const SFX = AP.SFX || manifest.VERBATIM['AP.SFX'];
    const MUSIC = AP.MUSIC || manifest.VERBATIM['AP.MUSIC'];
    const LOOPS = AP.LOOPS || manifest.VERBATIM['AP.LOOPS'];
    const EVENTS = AP.EVENTS || manifest.VERBATIM['AP.EVENTS'];
    for (const it of found.sfx) if (Array.prototype.indexOf.call(SFX, it.name) < 0) rep.error(rel + ':' + it.line, 'sfx "' + it.name + '" is not in AP.SFX');
    for (const it of found.music) if (!Object.prototype.hasOwnProperty.call(MUSIC, it.name)) rep.error(rel + ':' + it.line, 'music "' + it.name + '" is not an AP.MUSIC key');
    for (const it of found.loop) if (Array.prototype.indexOf.call(LOOPS, it.name) < 0) rep.error(rel + ':' + it.line, 'loop "' + it.name + '" is not in AP.LOOPS');
    const wN = /^W[1-5]$/.test(owner) ? owner.toLowerCase() : null;
    for (const it of found.emit) {
      const n = it.name;
      if (Array.prototype.indexOf.call(EVENTS, n) >= 0) continue;
      const m = /^(w[1-5]|ui|endless):/.exec(n);
      if (!m) { rep.error(rel + ':' + it.line, 'event "' + n + '" is neither in AP.EVENTS nor prefixed w1:…w5:, ui: or endless:'); continue; }
      if (wN && m[1] !== wN && !(owner === 'W1' && m[1] === 'endless')) rep.warn(rel + ':' + it.line, 'event "' + n + '" uses another owner\'s prefix (' + owner + ' should use ' + wN + ':)');
    }
    const presets = new Set(CORE_FX.concat(ctx.fxNames || []));
    for (const it of found.burst) if (!presets.has(it.name)) rep.warn(rel + ':' + it.line, 'FX preset "' + it.name + '" is not a CORE preset and was never registered with AP.FX.preset');
    for (const it of found.preset) {
      if (wN && it.name.indexOf(wN + '.') !== 0) rep.error(rel + ':' + it.line, 'FX preset "' + it.name + '" must be named ' + wN + '.* (CONTRACT §0)');
    }
  }

  // ---------------------------------------------------------------- §2.12 def validation
  function defChecks(h, ownerSet, rep) {
    const reg = (h.registry && h.registry.entities) || [];
    const seen = new Map();
    for (const r of reg) {
      const owner = r.owner;
      if (ownerSet && !ownerSet.has(owner)) continue;
      const where = r.file + ' type ' + r.type;
      const def = r.def;
      if (typeof r.type !== 'string' || !r.type) { rep.error(r.file, 'AP.Entities.register with a non-string type'); continue; }
      if (seen.has(r.type)) rep.warn(where, 'registered twice (also in ' + seen.get(r.type) + '); the last registration wins');
      seen.set(r.type, r.file);
      // naming
      const m = /^w([1-5])\.[A-Za-z][\w-]*$/.exec(r.type);
      if (/^W[1-5]$/.test(owner)) {
        const ok = (m && 'W' + m[1] === owner) || (owner === 'W1' && /^endless\.[A-Za-z][\w-]*$/.test(r.type));
        if (!ok) rep.error(where, owner + ' may only register ' + owner.toLowerCase() + '.* types' + (owner === 'W1' ? ' (or endless.*)' : ''));
      } else if (owner === 'CORE') {
        if (!COMMON_TYPES.has(r.type)) rep.warn(where, 'CORE registers a type that is not in the §2.16 common list');
      } else if (owner !== 'TOOLS') rep.warn(where, owner + ' registers an entity type (only CORE and W1–W5 own types)');
      if (!def || typeof def !== 'object') { rep.error(where, 'def must be an object'); continue; }
      for (const k of r.keys) if (!DEF_KEYS.has(k)) rep.error(where, 'unknown def key "' + k + '" (CONTRACT §2.12; custom state belongs in e.s)');
      if (def.kind !== undefined && !KINDS.has(def.kind)) rep.error(where, 'kind "' + def.kind + '" must be sensor | actor | solid');
      if (def.anchor !== undefined && !ANCHORS.has(def.anchor)) rep.error(where, 'anchor "' + def.anchor + '" must be floor | center | ceiling | tile');
      if (def.lint !== undefined && !LINTS.has(def.lint)) rep.error(where, 'lint "' + def.lint + '" must be one of ' + Array.from(LINTS).join(' | '));
      for (const k of ['w', 'h']) if (def[k] !== undefined && !(typeof def[k] === 'number' && def[k] > 0)) rep.error(where, k + ' must be a positive number');
      for (const k of ['layer', 'renderPad']) if (def[k] !== undefined && typeof def[k] !== 'number') rep.error(where, k + ' must be a number');
      for (const k of FLAGS) if (def[k] !== undefined && typeof def[k] !== 'boolean') rep.error(where, k + ' must be a boolean');
      for (const k of HOOKS) if (def[k] !== undefined && typeof def[k] !== 'function') rep.error(where, k + ' must be a function');
      if (def.required !== undefined && !(Array.isArray(def.required) && def.required.every(x => typeof x === 'string'))) rep.error(where, 'required must be an array of spec key strings');
      if (def.boss) {
        if (typeof def.bossName !== 'string' || !def.bossName) rep.error(where, 'boss def needs bossName (CONTRACT §2.17)');
        if (!(typeof def.phases === 'number' && def.phases >= 2)) rep.error(where, 'boss def needs phases ≥ 2');
        for (const hk of manifest.BOSS_HOOKS) if (typeof def[hk] !== 'function') rep.error(where, 'boss def needs the ' + hk + ' hook');
      } else if (def.bossName !== undefined || def.phases !== undefined) rep.warn(where, 'bossName/phases on a non-boss def');
      if (def.kind === 'solid' && def.lint === undefined && !def.oneWay) rep.warn(where, 'solid type without a lint kind: the reachability bot ignores it (use lint: "solid" or "stand")');
    }
    // scenes, FX presets, levels
    for (const s of (h.registry && h.registry.scenes) || []) {
      if (ownerSet && !ownerSet.has(s.owner)) continue;
      const exp = manifest.SCENES.find(x => x[0] === s.name);
      if (exp && exp[1] !== s.owner && s.owner !== 'runtime') rep.warn(s.file, 'registers scene "' + s.name + '" which CONTRACT §2.9 assigns to ' + exp[1]);
      if (!s.scene || typeof s.scene !== 'object') { rep.error(s.file, 'scene "' + s.name + '" is not an object'); continue; }
      for (const k of ['enter', 'exit', 'update', 'render', 'covered', 'uncovered']) if (s.scene[k] !== undefined && typeof s.scene[k] !== 'function') rep.error(s.file, 'scene "' + s.name + '".' + k + ' must be a function');
    }
    for (const f of (h.registry && h.registry.fx) || []) {
      if (ownerSet && !ownerSet.has(f.owner)) continue;
      if (/^W[1-5]$/.test(f.owner) && String(f.name).indexOf(f.owner.toLowerCase() + '.') !== 0) rep.error(f.file, 'FX preset "' + f.name + '" must be named ' + f.owner.toLowerCase() + '.*');
    }
    for (const l of (h.registry && h.registry.levels) || []) {
      if (ownerSet && !ownerSet.has(l.owner)) continue;
      const id = String(l.id || '');
      if (/^W[1-5]$/.test(l.owner)) {
        const n = l.owner.slice(1);
        if (!(new RegExp('^w' + n + '-(\\d+|boss)$').test(id)) && !(l.owner === 'W1' && /^e-/.test(id))) rep.error(l.file, 'registers level "' + id + '" outside world ' + n);
      } else if (l.owner === 'CORE' && !/^test-/.test(id)) rep.warn(l.file, 'CORE registers level "' + id + '" (CORE owns test-* levels)');
    }
  }

  // ---------------------------------------------------------------- main
  function run(argv) {
    const args = cli.parseArgs(argv, { owner: 'string', strict: 'bool', noTests: 'bool', verbose: 'bool' });
    const owner = args.owner ? args.owner.toUpperCase() : null;
    const rep = new cli.Report('check-all' + (owner ? ' --owner ' + owner : '') + (args.strict ? ' --strict' : ''));
    for (const e of args._errors) rep.error('args', e);
    if (owner && OWNERS.indexOf(owner) < 0 && owner !== 'INTEGRATOR') rep.error('args', 'unknown owner ' + owner + ' (one of ' + OWNERS.join(', ') + ')');
    if (rep.errors) { rep.print(); console.log(rep.summary()); return 2; }
    const strict = args.strict || owner === 'INTEGRATOR';
    const ownerSet = owner && owner !== 'INTEGRATOR' ? new Set([owner]) : null;
    const section = (name, fn) => {
      const before = rep.items.length;
      const t0 = cli.hrtimeMs();
      try { fn(); } catch (e) { rep.error(name, 'check crashed: ' + (e && e.stack || e)); }
      const items = rep.items.slice(before);
      const e = items.filter(i => i.level === 'error').length, w = items.filter(i => i.level === 'warn').length;
      console.log((e ? cli.C.red('✗ ') : w ? cli.C.yellow('! ') : cli.C.green('✓ ')) + name.padEnd(10) + cli.C.dim(' ' + (e ? e + ' error' + (e === 1 ? '' : 's') : '') + (e && w ? ', ' : '') + (w ? w + ' warning' + (w === 1 ? '' : 's') : '') + (!e && !w ? 'ok' : '') + ' (' + ((cli.hrtimeMs() - t0) / 1000).toFixed(1) + ' s)'));
      for (const it of items) if (it.level !== 'info' || args.verbose) console.log(cli.Report.fmt(it));
    };
    // 1 files
    let owned = [];
    section('files', () => {
      const canon = owner && owner !== 'INTEGRATOR' ? files.scriptsFor(owner) : files.ORDER.slice();
      for (const p of canon) if (!cli.exists(p)) rep.add(strict ? 'error' : 'warn', p, 'missing (owner ' + files.OWNER_OF[p] + '; CONTRACT §1)');
      owned = canon.filter(p => cli.exists(p));
      if (!owner || owner === 'INTEGRATOR' || owner === 'TOOLS') owned = owned.concat(cli.listDir('tools', p => /\.js$/.test(p)));
      // extra files under an owner's folders that are not in §1 (worlds may add helpers? they may not: index.html loads §1 only)
      const extra = cli.listDir('js', p => /\.js$/.test(p)).filter(p => files.ORDER.indexOf(p) < 0 && (!ownerSet || ownerSet.has(files.ownerOf(p))));
      for (const p of extra) rep.warn(p, 'not in CONTRACT §1, so index.html never loads it');
      if (!owner || owner === 'CORE' || owner === 'INTEGRATOR') {
        for (const p of ['index.html', 'css/style.css']) if (!cli.exists(p)) rep.error(p, 'missing (CORE)');
        if (!cli.exists('docs/ENGINE_API.md')) rep.add(owner === 'CORE' || strict ? 'error' : 'warn', 'docs/ENGINE_API.md', 'missing (CORE must document the as-built API)');
      }
      rep.info('files', owned.length + ' owned JS files');
    });
    // 6 load (first, so names can use the live AP tables)
    let h = null;
    section('load', () => {
      h = harness.create({ gl: 'stub', boot: false, strict });
      for (const i of h.orderIssues) {
        if (/main\.js must be the last/.test(i.msg) || i.level === 'error') rep.error('index.html', i.msg);
        else rep.add(strict ? 'error' : 'warn', 'index.html', i.msg);
      }
      for (const e of h.loadReport) {
        if (ownerSet && !ownerSet.has(e.owner)) continue;
        if (e.status === 'syntax' || e.status === 'throw') rep.error(e.file, 'load failed: ' + e.message);
        else if (e.status === 'reported') rep.error(e.file, 'reported AP.errors while loading: ' + e.message);
      }
      for (const e of h.loadErrors) {
        if (e.source !== 'AP.errors') continue;
        if (ownerSet && !ownerSet.has(e.owner)) continue;
        rep.error(e.file || '?', 'AP.errors at load: ' + (e.label ? e.label + ': ' : '') + e.message);
      }
      for (const m of h.harnessErrors) rep.warn('harness', m);
      const boot = harness.ensureBoot(h);
      if (boot.note) rep.add(boot.booted ? 'warn' : (strict ? 'error' : 'warn'), 'boot', boot.note);
      const mark = { ap: h.apErrorsAtLoad || 0, load: h.loadErrors.length, unc: 0 };
      for (const e of h.errorsSince(mark)) {
        if (ownerSet && !ownerSet.has(e.owner)) continue;
        rep.error(e.file || 'boot', 'error during boot: ' + harness.fmtError(e));
      }
      rep.info('load', h.loadReport.length + ' scripts from ' + h.orderFrom);
    });
    const AP = h ? h.AP : null;
    const fxNames = h && h.registry ? h.registry.fx.map(f => f.name) : [];
    // 2–5 static
    section('static', () => {
      const ctx = { AP, fxNames };
      for (const rel of owned) staticChecks(rel, rep, ctx);
    });
    // 7 globals
    section('globals', () => {
      if (!h) return;
      const lk = h.leaks();
      for (const g of lk.globals) if (!ownerSet || ownerSet.has(g.owner) || g.owner === 'runtime') rep.error(g.file || 'runtime', 'leaked global "' + g.name + '" (only AP and AP_NO_AUTOBOOT may be global)');
      for (const d of lk.topLevel) if (!ownerSet || ownerSet.has(d.owner)) rep.error(d.file + ':' + d.line, 'top-level ' + d.kind + ' ' + d.name);
    });
    // 8 manifest
    section('manifest', () => {
      if (!h) return;
      const r = manifest.checkLoaded(h, { owners: strict && !ownerSet ? null : (ownerSet || null), strict });
      if (r.levelNote) rep.warn('manifest', r.levelNote);
      for (const i of r.issues) rep.add(i.level, '[' + i.owner + '] ' + i.path, i.msg);
    });
    // 9 defs
    section('defs', () => { if (h) defChecks(h, ownerSet, rep); });
    // 10 tests
    if (!args.noTests) {
      const tests = ownerTests(owner === 'INTEGRATOR' ? null : owner, strict);
      for (const t of tests) {
        section('test', () => {
          const r = runTool(t);
          const label = t.label;
          if (r.code === 0) rep.info(label, r.summary);
          else {
            rep.error(label, 'exit ' + r.code + ': ' + r.summary.replace(/\x1b\[[0-9;]*m/g, ''));
            const tail = r.lines.slice(-14).map(l => '      ' + l.replace(/\x1b\[[0-9;]*m/g, ''));
            console.log(cli.C.dim(tail.join('\n')));
          }
          console.log(cli.C.dim('  ' + label + ' → ' + (r.code === 0 ? 'ok' : 'FAILED') + ' (' + (r.ms / 1000).toFixed(1) + ' s)'));
        });
      }
    }
    console.log(rep.summary());
    return rep.errors ? 1 : 0;
  }

  module.exports = { run, ownerTests, defChecks, staticChecks };
  if (require.main === module) cli.runMain(run);
})();
