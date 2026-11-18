/* tools/lib/cli.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // Shared helpers for every TOOLS command: argument parsing, project paths, a report
  // collector with concise colored output, deterministic hashing/RNG and timing.

  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..', '..');

  function rel(p) {
    const r = path.relative(ROOT, path.resolve(ROOT, p));
    return r.split(path.sep).join('/');
  }
  function abs(p) { return path.resolve(ROOT, p); }
  function exists(p) {
    try { return fs.statSync(abs(p)).isFile(); } catch (e) { return false; }
  }
  function read(p) {
    let s = fs.readFileSync(abs(p), 'utf8');
    return s;
  }
  function listDir(dir, filter) {
    let out = [];
    let entries;
    try { entries = fs.readdirSync(abs(dir), { withFileTypes: true }); } catch (e) { return out; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const p = rel(path.join(abs(dir), e.name));
      if (e.isDirectory()) out = out.concat(listDir(p, filter));
      else if (!filter || filter(p)) out.push(p);
    }
    return out;
  }

  // --------------------------------------------------------------- args
  // spec: { name: 'bool' | 'string' | 'int' | 'number' | 'list' }  ('list' collects repeats)
  function parseArgs(argv, spec) {
    const out = { _: [] };
    const errors = [];
    for (const k of Object.keys(spec)) {
      if (spec[k] === 'bool') out[k] = false;
      else if (spec[k] === 'list') out[k] = [];
      else out[k] = null;
    }
    for (let i = 0; i < argv.length; i++) {
      let a = argv[i];
      if (a.slice(0, 2) !== '--') { out._.push(a); continue; }
      let val = null;
      const eq = a.indexOf('=');
      if (eq > 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
      const key = a.slice(2).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      const type = spec[key];
      if (!type) { errors.push('unknown flag ' + a); continue; }
      if (type === 'bool') { out[key] = val === null ? true : !/^(0|false|no|off)$/i.test(val); continue; }
      if (val === null) {
        if (i + 1 < argv.length && (argv[i + 1].slice(0, 2) !== '--' || /^--?\d/.test(argv[i + 1]))) val = argv[++i];
        else { errors.push('flag ' + a + ' needs a value'); continue; }
      }
      if (type === 'int' || type === 'number') {
        const n = type === 'int' ? parseInt(val, 10) : parseFloat(val);
        if (!isFinite(n)) { errors.push('flag ' + a + ' expects a number, got "' + val + '"'); continue; }
        out[key] = n;
      } else if (type === 'list') out[key].push(val);
      else out[key] = val;
    }
    out._errors = errors;
    return out;
  }

  // --------------------------------------------------------------- colors
  const useColor = !!(process.stdout && process.stdout.isTTY) && !process.env.NO_COLOR;
  function paint(code, s) { return useColor ? '\x1b[' + code + 'm' + s + '\x1b[0m' : s; }
  const C = {
    red: s => paint('31', s), green: s => paint('32', s), yellow: s => paint('33', s),
    cyan: s => paint('36', s), dim: s => paint('2', s), bold: s => paint('1', s)
  };

  // --------------------------------------------------------------- report
  // A Report collects findings; each has a level (error | warn | info), a scope (file,
  // level id, test name ...) and a message. Printing groups by section.
  class Report {
    constructor(title) {
      this.title = title;
      this.items = [];
      this.sections = [];
      this.started = Date.now();
    }
    add(level, scope, msg, extra) {
      const it = { level, scope: scope || '', msg: String(msg), extra: extra || null };
      this.items.push(it);
      return it;
    }
    error(scope, msg, extra) { return this.add('error', scope, msg, extra); }
    warn(scope, msg, extra) { return this.add('warn', scope, msg, extra); }
    info(scope, msg, extra) { return this.add('info', scope, msg, extra); }
    count(level) { return this.items.filter(i => i.level === level).length; }
    get errors() { return this.count('error'); }
    get warnings() { return this.count('warn'); }
    merge(other, prefix) {
      for (const it of other.items) this.items.push({ level: it.level, scope: prefix ? prefix + (it.scope ? ' ' + it.scope : '') : it.scope, msg: it.msg, extra: it.extra });
    }
    static fmt(it) {
      const tag = it.level === 'error' ? C.red('ERROR') : it.level === 'warn' ? C.yellow('WARN ') : C.dim('info ');
      return '  ' + tag + ' ' + (it.scope ? C.cyan(it.scope) + ': ' : '') + it.msg;
    }
    print(opts) {
      opts = opts || {};
      const max = opts.max || 400;
      let shown = 0;
      for (const it of this.items) {
        if (it.level === 'info' && !opts.verbose) continue;
        if (shown++ >= max) { console.log(C.dim('  ... ' + (this.items.length - max) + ' more (use --verbose)')); break; }
        console.log(Report.fmt(it));
      }
    }
    summary() {
      const e = this.errors, w = this.warnings;
      const secs = ((Date.now() - this.started) / 1000).toFixed(1);
      const head = e ? C.red(C.bold('FAIL')) : C.green(C.bold('PASS'));
      return head + ' ' + this.title + ': ' + e + ' error' + (e === 1 ? '' : 's') + ', ' + w + ' warning' + (w === 1 ? '' : 's') + ' (' + secs + ' s)';
    }
  }

  // --------------------------------------------------------------- hashing / rng (tools only)
  function fnv1a(str) {
    let h = 0x811c9dc5;
    str = String(str);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    const f = function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
    f.range = (lo, hi) => lo + f() * (hi - lo);
    f.chance = p => f() < p;
    f.pick = arr => arr[Math.floor(f() * arr.length)];
    return f;
  }

  function hrtimeMs() {
    const t = process.hrtime();
    return t[0] * 1000 + t[1] / 1e6;
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // Run a CLI main(argv) → exit code, printing crashes as tool failures (exit 2).
  function runMain(main) {
    let code = 2;
    try {
      code = main(process.argv.slice(2));
    } catch (e) {
      console.error(C.red('TOOL CRASH: ') + (e && e.stack || e));
      code = 2;
    }
    if (code && typeof code.then === 'function') {
      code.then(c => { process.exitCode = c | 0; }, e => { console.error(C.red('TOOL CRASH: ') + (e && e.stack || e)); process.exitCode = 2; });
    } else {
      process.exitCode = code | 0;
    }
  }

  exports.ROOT = ROOT;
  exports.rel = rel;
  exports.abs = abs;
  exports.exists = exists;
  exports.read = read;
  exports.listDir = listDir;
  exports.parseArgs = parseArgs;
  exports.C = C;
  exports.Report = Report;
  exports.fnv1a = fnv1a;
  exports.mulberry32 = mulberry32;
  exports.hrtimeMs = hrtimeMs;
  exports.plural = plural;
  exports.runMain = runMain;
})(module.exports);
