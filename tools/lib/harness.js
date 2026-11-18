/* tools/lib/harness.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // Headless browser harness: a Node vm context with thorough browser stubs (DOM, 2D canvas,
  // WebGL1 / null GL, Web Audio, localStorage modes, manual rAF, virtual performance.now).
  // Loads the game's classic scripts one by one (index.html order, else CONTRACT §1 order),
  // attributing every failure to the owning agent, captures registrations (levels, entity
  // types, scenes, FX presets) with the file that made them, detects leaked globals and
  // top-level declarations, then calls AP.boot({headless:true}).
  //
  //   const h = harness.create({gl:'stub'|'null', storage:'ok'|'corrupt'|'throws'|'quota', ...});
  //   h.load(); h.boot(); await h.frames(60); h.errors(); h.dispose();

  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const cli = require('./cli');
  const files = require('./files');
  const scan = require('./scan');

  const STUB_FILES = ['stubs-dom.js', 'stubs-canvas.js', 'stubs-gl.js', 'stubs-audio.js'];
  const stubScripts = {};
  function stubScript(name) {
    if (!stubScripts[name]) {
      const p = path.join(__dirname, name);
      stubScripts[name] = new vm.Script(fs.readFileSync(p, 'utf8'), { filename: p });
    }
    return stubScripts[name];
  }

  // Static per-file results are cached by mtime+size across harness instances.
  const staticCache = new Map();
  function staticInfo(rel, src, mtime) {
    const key = rel + '|' + mtime + '|' + src.length;
    let hit = staticCache.get(key);
    if (hit) return hit;
    let topLevel = [];
    try { topLevel = scan.checkIIFE(rel, src, 'game').topLevel; } catch (e) { topLevel = []; }
    hit = { topLevel };
    staticCache.set(key, hit);
    return hit;
  }

  // ------------------------------------------------------------------ index.html → DOM spec
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  function domFromHtml(html) {
    const bodyM = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
    const body = (bodyM ? bodyM[1] : html).replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
    const root = { children: [] };
    const stack = [root];
    const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(body))) {
      if (m[5] !== undefined) {
        const text = m[5].trim();
        if (text && stack.length > 1) stack[stack.length - 1].text = (stack[stack.length - 1].text || '') + text;
        continue;
      }
      const closing = !!m[1], tag = m[2].toLowerCase(), attrStr = m[3] || '', selfClose = !!m[4];
      if (closing) {
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break; }
        continue;
      }
      const attrs = {};
      const ar = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
      let a;
      while ((a = ar.exec(attrStr))) attrs[a[1].toLowerCase()] = a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5] !== undefined ? a[5] : '';
      const node = { tag, id: attrs.id || '', cls: attrs.class || '', attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClose && !VOID.has(tag)) stack.push(node);
    }
    return root.children;
  }
  function hasCanvases(spec) {
    let ids = new Set();
    (function walk(list) { for (const n of list) { if (n.id) ids.add(n.id); walk(n.children || []); } })(spec);
    return ids.has('stage') && ids.has('bg') && ids.has('game');
  }

  // ------------------------------------------------------------------ dist parsing
  function scriptsFromDist(distRel) { return parseDistHtml(cli.read(distRel)); }
  // inline <script data-src="path"> blocks of a single-file build → {scripts:[{path, code}], html}
  function parseDistHtml(html) {
    const out = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let m, i = 0;
    while ((m = re.exec(html))) {
      const attrs = m[1];
      const srcM = /\bdata-src\s*=\s*"([^"]*)"/i.exec(attrs);
      const code = m[2];
      if (/\bsrc\s*=/.test(attrs.replace(/data-src\s*=\s*"[^"]*"/i, ''))) { out.push({ path: 'external#' + (i++), code: null, external: true }); continue; }
      const head = /^\s*\/\* (\S+) — owner: /.exec(code);
      const p = srcM ? srcM[1] : head ? head[1] : 'inline#' + i;
      out.push({ path: p, code, dist: true });
      i++;
    }
    return { scripts: out, html };
  }

  // ------------------------------------------------------------------ helpers
  function deepClone(v, depth, seen) {
    depth = depth || 0;
    if (v === null || typeof v !== 'object') return v;
    if (depth > 24) return v;
    seen = seen || new Map();
    if (seen.has(v)) return seen.get(v);
    if (ArrayBuffer.isView(v)) return v.slice ? v.slice() : v;
    if (Array.isArray(v)) {
      const a = [];
      seen.set(v, a);
      for (let i = 0; i < v.length; i++) a.push(deepClone(v[i], depth + 1, seen));
      return a;
    }
    const o = {};
    seen.set(v, o);
    for (const k of Object.keys(v)) o[k] = deepClone(v[k], depth + 1, seen);
    return o;
  }
  function drain() { return new Promise(r => setImmediate(r)); }

  // Maps an error stack to the first project file in it.
  function fileFromStack(stack) {
    if (!stack) return null;
    const lines = String(stack).split('\n');
    for (const ln of lines) {
      const m = /(?:^|[\s(])((?:[A-Za-z]:)?[^\s()]*?\.(?:js|html)(?:#[^\s():]+)?)(?::(\d+))?/.exec(ln);
      if (!m) continue;
      let p = m[1];
      if (/stubs-[a-z]+\.js|[\\/]lib[\\/]harness\.js/.test(p)) continue;
      const hashIdx = p.indexOf('#');
      if (hashIdx >= 0) p = p.slice(hashIdx + 1);
      else if (/^[A-Za-z]:|^[\\/]/.test(p)) {
        const r = cli.rel(p);
        if (r.slice(0, 3) === '../' || /^[A-Za-z]:/.test(r)) continue;   // outside the project
        p = r;
      }
      if (!/^(js|tools)\//.test(p)) continue;
      return { file: p, line: m[2] ? +m[2] : 0 };
    }
    return null;
  }
  function ownerFromLabel(label) {
    const m = /\b(w[1-5])\.[\w.-]+/.exec(String(label || ''));
    if (m) return m[1].toUpperCase();
    if (/\bendless\b/.test(label || '')) return 'W1';
    return null;
  }

  // ------------------------------------------------------------------ the harness
  function create(opts) {
    opts = Object.assign({ gl: 'stub', storage: 'ok', seed: 0xA9E1, hash: '', dpr: 1, innerWidth: 1280, innerHeight: 720, boot: true }, opts || {});
    const h = {
      opts,
      loadReport: [],
      loadErrors: [],
      registry: { levels: [], entities: [], scenes: [], fx: [] },
      leaked: [],
      topLevel: [],
      order: [],
      orderFrom: '',
      index: null,
      orderIssues: [],
      booted: false,
      bootError: null,
      currentFile: null,
      shimmed: [],
      harnessErrors: []
    };

    // --- DOM from index.html when it has the stage/canvases
    let domSpec = null;
    const index = files.readIndex('index.html');
    h.index = index;
    if (index.exists && !opts.dist) {
      const spec = domFromHtml(index.html);
      if (hasCanvases(spec)) domSpec = spec;
    }

    const sandbox = {};
    const ctx = vm.createContext(sandbox, { name: 'apeiron-harness' });
    const G = vm.runInContext('globalThis', ctx);
    h.ctx = ctx;
    h.G = G;
    for (const f of STUB_FILES) stubScript(f).runInContext(ctx);
    const stubOpts = {
      gl: opts.gl, storage: opts.storage, storageSeed: opts.storageSeed || null, hash: opts.hash || '',
      dpr: opts.dpr, innerWidth: opts.innerWidth, innerHeight: opts.innerHeight, dom: domSpec,
      reducedMotion: !!opts.reducedMotion, audioStartsSuspended: !!opts.audioStartsSuspended, traceTimers: !!opts.traceTimers,
      echo: opts.echo ? (lvl, text) => console.log('  [' + lvl + '] ' + text) : null
    };
    const S = G.__AP_STUBS.dom(stubOpts);
    G.__AP_STUBS.canvas(S);
    G.__AP_STUBS.gl(S);
    G.__AP_STUBS.audio(S);
    delete G.__AP_STUBS;
    delete G.__AP_STUB_STATE;
    h.S = S;
    // deterministic Math.random inside the game realm
    const rand = cli.mulberry32(opts.seed >>> 0);
    vm.runInContext('Math', ctx).random = function () { return rand(); };
    S.rand = rand;
    G.AP_NO_AUTOBOOT = true;
    const baseline = new Set(Object.getOwnPropertyNames(G));
    baseline.add('AP');
    baseline.add('AP_NO_AUTOBOOT');
    h.baseline = baseline;

    Object.defineProperty(h, 'AP', { get: () => G.AP });

    function newGlobals() {
      const out = [];
      for (const k of Object.getOwnPropertyNames(G)) if (!baseline.has(k)) out.push(k);
      return out;
    }
    function noteLeaks(by, owner) {
      for (const k of newGlobals()) {
        if (h.leaked.some(l => l.name === k)) continue;
        h.leaked.push({ name: k, file: by, owner: owner || (by ? files.ownerOf(by) : 'UNKNOWN') });
      }
    }

    // --- registration capture
    function wrap(obj, name, kind, keyFn) {
      if (!obj || typeof obj[name] !== 'function' || obj[name].__apHarness) return false;
      const orig = obj[name];
      const wrapped = function () {
        try {
          const rec = keyFn(arguments);
          if (rec) { rec.file = h.currentFile || 'runtime'; rec.owner = h.currentFile ? files.ownerOf(h.currentFile) : 'runtime'; h.registry[kind].push(rec); }
        } catch (e) { h.harnessErrors.push('capture ' + kind + ': ' + e.message); }
        return orig.apply(this, arguments);
      };
      try {
        Object.defineProperty(wrapped, 'length', { value: orig.length });
        Object.defineProperty(wrapped, 'name', { value: orig.name || name });
        Object.defineProperty(wrapped, '__apHarness', { value: orig });
        obj[name] = wrapped;
        return obj[name] === wrapped;
      } catch (e) { return false; }
    }
    function installCapture() {
      const AP = G.AP;
      if (!AP) return;
      if (AP.Levels) wrap(AP.Levels, 'register', 'levels', a => {
        const def = a[0];
        return { id: def && def.id, def: deepClone(def), raw: def };
      });
      if (AP.Entities) wrap(AP.Entities, 'register', 'entities', a => {
        const def = a[1];
        return { type: a[0], def: def, keys: def && typeof def === 'object' ? Object.keys(def) : [], snapshot: def && typeof def === 'object' ? Object.assign({}, def) : def };
      });
      if (AP.Scenes) wrap(AP.Scenes, 'register', 'scenes', a => ({ name: a[0], scene: a[1], keys: a[1] && typeof a[1] === 'object' ? Object.keys(a[1]) : [] }));
      if (AP.FX) wrap(AP.FX, 'preset', 'fx', a => ({ name: a[0] }));
    }

    // --- lint-mode shims (only when the real module is missing)
    function installShims(rel) {
      if (!opts.lintMode) return;
      const AP = G.AP || (G.AP = vm.runInContext('({})', ctx));
      const owner = files.ownerOf(rel);
      if (!AP.errors) AP.errors = vm.runInContext('[]', ctx);
      if (!AP.Levels) {
        const store = vm.runInContext('(function(){var m={},order=[];return {register:function(d){if(!d||!d.id)return;if(!m[d.id])order.push(d.id);m[d.id]=d;},get:function(id){return m[id]||null;},has:function(id){return !!m[id];},list:function(w){return order.filter(function(id){return w===undefined||m[id].world===w;}).map(function(id){return m[id];});}};})()', ctx);
        AP.Levels = store; h.shimmed.push('AP.Levels');
      }
      if (!AP.Entities) {
        AP.Entities = vm.runInContext('(function(){var m={},order=[];return {register:function(t,d){if(!m[t])order.push(t);m[t]=d||{};},get:function(t){return m[t]||null;},has:function(t){return !!m[t];},list:function(p){return order.filter(function(t){return !p||t.indexOf(p)===0;});},proto:{}};})()', ctx);
        h.shimmed.push('AP.Entities');
      }
      if (!AP.Scenes && owner !== 'CORE') { AP.Scenes = vm.runInContext('({register:function(){},has:function(){return false;}})', ctx); h.shimmed.push('AP.Scenes'); }
      if (!AP.FX && owner !== 'CORE') { AP.FX = vm.runInContext('({preset:function(){},emit:function(){return 0;},burst:function(){},ring:function(){}})', ctx); h.shimmed.push('AP.FX'); }
      installCapture();
    }

    // --- load order
    function resolveOrder() {
      if (opts.dist) {
        const d = scriptsFromDist(opts.dist);
        h.orderFrom = opts.dist;
        return d.scripts;
      }
      let order;
      if (opts.files) { order = opts.files.slice(); h.orderFrom = 'explicit'; }
      else {
        const lo = files.loadOrder({ canonical: !!opts.canonical });
        order = lo.order;
        h.orderFrom = lo.from;
        if (lo.index.exists) {
          h.orderIssues = files.crossCheck(lo.index, !!opts.strict).concat(lo.index.problems);
        }
      }
      if (opts.extraFiles && opts.extraFiles.length) {
        const mainIdx = order.indexOf('js/main.js');
        const extra = opts.extraFiles.filter(f => order.indexOf(f) < 0);
        if (mainIdx >= 0 && !opts.extraAfterMain) order.splice(mainIdx, 0, ...extra);
        else order = order.concat(extra);
      }
      const list = order.map(p => ({ path: p, code: null }));
      if (opts.sources) {
        for (const s of opts.sources) {
          const entry = { path: s.path, code: s.code, owner: s.owner };
          if (s.before) {
            const i = list.findIndex(x => x.path === s.before);
            if (i >= 0) { list.splice(i, 0, entry); continue; }
          }
          list.push(entry);
        }
      }
      return list;
    }

    h.load = function () {
      const list = resolveOrder();
      h.order = list.map(x => x.path);
      for (const item of list) {
        const rel = item.path;
        const owner = item.owner || files.ownerOf(rel);
        const entry = { file: rel, owner, status: 'ok', ms: 0, message: '' };
        h.loadReport.push(entry);
        if (item.external) { entry.status = 'external'; entry.message = 'external <script src> in dist'; continue; }
        let src = item.code;
        let mtime = 0;
        if (src === null || src === undefined) {
          if (!cli.exists(rel)) { entry.status = 'missing'; entry.message = 'file not found'; continue; }
          src = fs.readFileSync(cli.abs(rel), 'utf8');
          try { mtime = fs.statSync(cli.abs(rel)).mtimeMs; } catch (e) { mtime = 0; }
        }
        const filename = item.dist ? opts.dist + '#' + rel : (item.code ? rel : cli.abs(rel));
        let script;
        try {
          script = new vm.Script(src, { filename });
        } catch (e) {
          entry.status = 'syntax';
          const m = /:(\d+)\s*$/.exec(String(e.stack || '').split('\n')[0]);
          entry.message = e.name + ': ' + e.message + (m ? ' (line ' + m[1] + ')' : '');
          h.loadErrors.push({ source: 'load', owner, file: rel, label: 'syntax', message: entry.message, stack: e.stack });
          continue;
        }
        if (!item.dist) {
          const st = staticInfo(rel, src, mtime);
          for (const d of st.topLevel) h.topLevel.push({ file: rel, owner, kind: d.kind, name: d.name, line: d.line });
        }
        installShims(rel);
        const before = G.AP && G.AP.errors ? G.AP.errors.length : 0;
        h.currentFile = rel;
        S.currentScript = rel;
        const t0 = cli.hrtimeMs();
        try {
          script.runInContext(ctx, { displayErrors: false });
        } catch (e) {
          entry.status = 'throw';
          const where = fileFromStack(e && e.stack);
          entry.message = (e && e.name ? e.name + ': ' : '') + (e && e.message || String(e)) + (where ? ' at ' + where.file + ':' + where.line : '');
          h.loadErrors.push({ source: 'load', owner, file: rel, label: 'load-time exception', message: entry.message, stack: e && e.stack });
        }
        entry.ms = cli.hrtimeMs() - t0;
        h.currentFile = null;
        S.currentScript = null;
        installCapture();
        const AP = G.AP;
        if (AP && AP.errors && AP.errors.length > before) {
          for (let k = before; k < AP.errors.length; k++) {
            const er = AP.errors[k];
            h.loadErrors.push({ source: 'AP.errors', owner, file: rel, label: er && er.label, message: er && er.message, stack: er && er.stack, atLoad: true });
          }
          if (entry.status === 'ok') { entry.status = 'reported'; entry.message = (AP.errors.length - before) + ' AP.errors entr' + (AP.errors.length - before === 1 ? 'y' : 'ies'); }
        }
        noteLeaks(rel, owner);
      }
      h.apErrorsAtLoad = G.AP && G.AP.errors ? G.AP.errors.length : 0;
      return h.loadReport;
    };

    h.boot = function () {
      const AP = G.AP;
      if (!AP || typeof AP.boot !== 'function') {
        h.bootError = 'AP.boot is not defined (js/main.js missing or failed)';
        return false;
      }
      h.currentFile = null;
      try {
        const r = AP.boot({ headless: true });
        h.booted = true;
        h.bootResult = r;
      } catch (e) {
        h.bootError = (e && e.name ? e.name + ': ' : '') + (e && e.message || String(e));
        h.bootStack = e && e.stack;
        h.harnessErrors.push('AP.boot threw: ' + h.bootError);
      }
      noteLeaks(null);
      return h.booted;
    };

    // Runs fn in a guarded way, recording exceptions. Returns {ok, value, error}.
    h.guard = function (label, fn) {
      try { return { ok: true, value: fn() }; }
      catch (e) {
        const where = fileFromStack(e && e.stack);
        const rec = { source: 'harness', owner: where ? files.ownerOf(where.file) : 'UNKNOWN', file: where ? where.file : null, label, message: (e && e.name ? e.name + ': ' : '') + (e && e.message || String(e)), stack: e && e.stack };
        h.loadErrors.push(rec);
        return { ok: false, error: rec };
      }
    };

    // Virtual time
    h.advance = function (ms) { S.advance(ms); };
    h.raf = function () { return S.runRaf(); };
    h.step = function (n) {
      const AP = G.AP;
      if (!AP || !AP.Loop || typeof AP.Loop.step !== 'function') return false;
      n = n || 1;
      for (let i = 0; i < n; i++) {
        S.advance(1000 / 120);
        AP.Loop.step(1);
      }
      return true;
    };
    h.render = function () {
      const AP = G.AP;
      if (AP && AP.Loop && typeof AP.Loop.renderOnce === 'function') AP.Loop.renderOnce();
      if (AP && AP.Audio && typeof AP.Audio.tick === 'function') AP.Audio.tick();
    };
    // One 60 Hz frame = 2 fixed steps + optional render + audio tick. Errors propagate.
    h.frame = function (render) {
      h.step(2);
      S.runRaf();
      if (render !== false) h.render();
    };
    h.frames = async function (n, o) {
      o = o || {};
      const every = o.renderEvery || 1;
      for (let i = 0; i < n; i++) {
        h.frame(i % every === 0 && o.render !== false);
        if (o.onFrame) o.onFrame(i);
        if ((i & 7) === 7) await drain();
      }
      await drain();
    };
    h.settle = drain;

    h.apErrors = function () { const AP = G.AP; return AP && AP.errors ? Array.prototype.slice.call(AP.errors) : []; };
    // Combined error list with owner attribution.
    h.errors = function (o) {
      o = o || {};
      const out = [];
      for (const e of h.loadErrors) out.push(e);
      const AP = G.AP;
      if (AP && AP.errors) {
        for (let k = h.apErrorsAtLoad || 0; k < AP.errors.length; k++) {
          const er = AP.errors[k] || {};
          const where = fileFromStack(er.stack);
          out.push({ source: 'AP.errors', owner: ownerFromLabel(er.label) || (where ? files.ownerOf(where.file) : 'CORE'), file: where ? where.file : null, label: er.label, message: er.message, stack: er.stack });
        }
      }
      for (const u of S.uncaught) {
        const where = fileFromStack(u.stack);
        out.push({ source: 'uncaught', owner: where ? files.ownerOf(where.file) : 'UNKNOWN', file: where ? where.file : u.script, label: u.label, message: u.message, stack: u.stack });
      }
      if (h.bootError) out.push({ source: 'boot', owner: 'CORE', file: 'js/main.js', label: 'AP.boot', message: h.bootError, stack: h.bootStack });
      if (o.includeIssues) {
        for (const it of S.issues) if (it.level === 'error') {
          const where = fileFromStack(it.stack);
          out.push({ source: 'stub', owner: where ? files.ownerOf(where.file) : (it.script ? files.ownerOf(it.script) : 'UNKNOWN'), file: where ? where.file : it.script, label: it.kind, message: it.msg + (it.count > 1 ? ' (x' + it.count + ')' : ''), stack: it.stack });
        }
      }
      return out;
    };
    h.issues = function (level) { return S.issues.filter(i => !level || i.level === level); };
    h.leaks = function () { noteLeaks('runtime'); return { globals: h.leaked.slice(), topLevel: h.topLevel.slice() }; };
    h.console = function (level) { return S.console.filter(c => !level || c.level === level); };
    h.clearErrors = function () {
      const AP = G.AP;
      h.loadErrors.length = 0;
      S.uncaught.length = 0;
      if (AP && AP.errors) h.apErrorsAtLoad = AP.errors.length;
    };
    h.mark = function () {
      const AP = G.AP;
      return { ap: AP && AP.errors ? AP.errors.length : 0, load: h.loadErrors.length, unc: S.uncaught.length };
    };
    h.errorsSince = function (mark) {
      const all = [];
      const AP = G.AP;
      for (let k = mark.load; k < h.loadErrors.length; k++) all.push(h.loadErrors[k]);
      if (AP && AP.errors) for (let k = mark.ap; k < AP.errors.length; k++) {
        const er = AP.errors[k] || {};
        const where = fileFromStack(er.stack);
        all.push({ source: 'AP.errors', owner: ownerFromLabel(er.label) || (where ? files.ownerOf(where.file) : 'CORE'), file: where ? where.file : null, label: er.label, message: er.message, stack: er.stack });
      }
      for (let k = mark.unc; k < S.uncaught.length; k++) {
        const u = S.uncaught[k];
        const where = fileFromStack(u.stack);
        all.push({ source: 'uncaught', owner: where ? files.ownerOf(where.file) : 'UNKNOWN', file: where ? where.file : u.script, label: u.label, message: u.message, stack: u.stack });
      }
      return all;
    };
    h.run = function (code) { return vm.runInContext(code, ctx); };
    h.canvas = function (id) { return G.document.getElementById(id); };
    h.gameCtx = function () { const c = h.canvas('game'); return c && c.__ctx ? c.__ctx : null; };
    h.dispose = function () {
      // break references so the context can be collected
      h.registry = null;
      h.G = null;
    };

    if (opts.load !== false) {
      h.load();
      if (opts.boot) h.boot();
    }
    return h;
  }

  // AP.boot({headless:true}) when js/main.js provides it; otherwise the documented boot order
  // (ENGINE_API §3) without the rAF loop, so tools can still drive CORE before main.js exists.
  // → {booted, minimal, note}
  function ensureBoot(h) {
    const AP = h.AP;
    if (h.booted) return { booted: true, minimal: false, note: '' };
    if (AP && typeof AP.boot === 'function') {
      const ok = h.boot();
      return { booted: ok, minimal: false, note: ok ? '' : 'AP.boot({headless:true}) failed: ' + h.bootError };
    }
    if (!AP) return { booted: false, minimal: false, note: 'no AP global after loading' };
    const G = h.G, doc = G.document;
    const steps = [];
    const tryCall = (label, fn) => { try { fn(); steps.push(label); } catch (e) { h.harnessErrors.push('minimal init ' + label + ': ' + e.message); } };
    AP.headless = true;
    if (AP.Save && AP.Save.load) tryCall('Save.load', () => AP.Save.load());
    if (AP.Input && AP.Input.init) tryCall('Input.init', () => AP.Input.init(G));
    if (AP.R && AP.R.init) tryCall('R.init', () => AP.R.init(doc.getElementById('stage')));
    if (AP.GL && AP.GL.init) tryCall('GL.init', () => { const ok = AP.GL.init(doc.getElementById('bg')); if (ok && AP.Backgrounds && AP.Backgrounds.init) AP.Backgrounds.init(AP.GL.gl); });
    if (AP.Audio && AP.Audio.init) tryCall('Audio.init', () => AP.Audio.init());
    if (AP.Meta && AP.Meta.init) tryCall('Meta.init', () => AP.Meta.init());
    h.booted = true;
    h.minimalBoot = true;
    return { booted: true, minimal: true, note: 'js/main.js (AP.boot) is not available; used a minimal init: ' + steps.join(', ') };
  }

  function fmtError(e) {
    const where = e.file ? e.file : '';
    return '[' + (e.owner || '?') + '] ' + (where ? where + ': ' : '') + (e.label ? e.label + ': ' : '') + e.message;
  }

  exports.create = create;
  exports.domFromHtml = domFromHtml;
  exports.scriptsFromDist = scriptsFromDist;
  exports.parseDistHtml = parseDistHtml;
  exports.fileFromStack = fileFromStack;
  exports.deepClone = deepClone;
  exports.drain = drain;
  exports.fmtError = fmtError;
  exports.ensureBoot = ensureBoot;
})(module.exports);
