/* tools/lib/scan.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // Static checks of CONTRACT §0: header comment, IIFE template with 'use strict', no
  // top-level declarations, the banned-pattern list (with per-file allowances), and literal
  // names passed to AP.sfx / AP.music / events / FX presets.

  const vm = require('vm');
  const jstok = require('./jstok');
  const files = require('./files');

  // ------------------------------------------------------------------ syntax
  // Compile without running. Game scripts are classic scripts; tools are CommonJS modules.
  function syntax(relPath, src) {
    const isTool = /^tools\//.test(relPath) && !/^tools\/fixtures\//.test(relPath);
    try {
      if (isTool) new vm.Script('(function (exports, require, module, __filename, __dirname) {' + src + '\n})', { filename: relPath });
      else new vm.Script(src, { filename: relPath });
      return null;
    } catch (e) {
      const m = /:(\d+)\s*$/.exec((e.stack || '').split('\n')[0]) || [];
      return { line: m[1] ? +m[1] : 0, msg: e.name + ': ' + e.message, stack: e.stack };
    }
  }

  // ------------------------------------------------------------------ header
  const HEADER_RE = /^\/\* (\S+) — owner: ([A-Z][A-Z0-9]*)( — [^*]*)? \*\/\s*$/;
  function checkHeader(relPath, src, expectedOwner) {
    const out = [];
    if (src.charCodeAt(0) === 0xFEFF) {
      out.push({ level: 'error', line: 1, rule: 'header', msg: 'file starts with a UTF-8 BOM; save as UTF-8 without BOM' });
      src = src.slice(1);
    }
    const first = src.split(/\r?\n/, 1)[0];
    const want = '/* ' + relPath + ' — owner: ' + expectedOwner + ' */';
    const m = HEADER_RE.exec(first);
    if (!m) {
      let hint = '';
      if (/^\/\*/.test(first) && /owner/.test(first) && !/—/.test(first)) hint = ' (use an em dash "—", U+2014)';
      out.push({ level: 'error', line: 1, rule: 'header', msg: 'first line must be exactly "' + want + '"' + hint + '; found "' + first.slice(0, 100) + '"' });
      return out;
    }
    if (m[1] !== relPath) out.push({ level: 'error', line: 1, rule: 'header', msg: 'header path "' + m[1] + '" does not match the file path "' + relPath + '"' });
    if (expectedOwner && m[2] !== expectedOwner) out.push({ level: 'error', line: 1, rule: 'header', msg: 'header owner ' + m[2] + ' but CONTRACT §1 assigns this file to ' + expectedOwner });
    return out;
  }

  // ------------------------------------------------------------------ IIFE template
  // Game template:
  //   (function (AP) { 'use strict'; ... })(window.AP = window.AP || {});
  // Tool template (Node): (function (<params>) { 'use strict'; ... })(<args>);
  function seqAt0(sig) { return sig.filter(t => t.depth === 0); }

  function checkIIFE(relPath, src, kind) {
    const out = [];
    const tk = jstok.tokenize(src);
    for (const e of tk.errors) out.push({ level: 'error', line: e.line, rule: 'tokenize', msg: e.msg });
    const sig = jstok.significant(tk.tokens);
    if (!sig.length) { out.push({ level: 'error', line: 1, rule: 'iife', msg: 'file has no code' }); return { issues: out, topLevel: [] }; }
    const top = seqAt0(sig);
    // Expected depth-0 token texts
    const texts = top.map(t => t.v);
    const topLevel = [];
    // find the IIFE: '(' 'function' ... then at depth 0 the closing ')' '(' args ')' ';'
    let ok = true;
    let msg = '';
    if (texts[0] !== '(') { ok = false; msg = 'code must start with "(function (AP) {" (found "' + texts[0] + '")'; }
    // The second significant token overall should be 'function'
    const fnTok = sig[1];
    if (ok && !(fnTok && fnTok.v === 'function')) { ok = false; msg = 'expected "(function (" at the start of the file'; }
    // depth-0 sequence must be: ( ) ( ) ;   (the function and its call)
    // i.e. texts = ['(', ')', '(', ')', ';'] or without the final ';'
    if (ok) {
      const shape = texts.join(' ');
      if (!(shape === '( ) ( ) ;' || shape === '( ) ( )')) {
        ok = false;
        msg = 'the whole file must be one IIFE; extra top-level code found: ' + describeTopLevel(top);
      }
      if (shape === '( ) ( )') out.push({ level: 'warn', line: top[3].line, rule: 'iife', msg: 'missing ";" after the IIFE call' });
    }
    // Detect top-level declarations (always reported, even if shape is wrong)
    for (let k = 0; k < top.length; k++) {
      const t = top[k];
      if (t.t === 'ident' && /^(var|let|const|function|class)$/.test(t.v)) {
        const nm = top[k + 1] && top[k + 1].t === 'ident' ? top[k + 1].v : '?';
        topLevel.push({ kind: t.v, name: nm, line: t.line });
      }
    }
    if (ok) {
      // inside: params and first statement
      const open = sig.indexOf(top[0]);
      // sig[open+1] = function, sig[open+2] = '(' param list
      let p = open + 2;
      const params = [];
      if (sig[p] && sig[p].v === '(') {
        p++;
        while (sig[p] && sig[p].v !== ')') { if (sig[p].t === 'ident') params.push(sig[p].v); p++; }
        p++;
      }
      if (!(sig[p] && sig[p].v === '{')) { ok = false; msg = 'expected "{" after the IIFE parameter list'; }
      else {
        const first = sig[p + 1];
        if (!(first && first.t === 'str' && first.cooked === 'use strict')) {
          out.push({ level: 'error', line: first ? first.line : 1, rule: 'use-strict', msg: "the first statement inside the IIFE must be 'use strict';" });
        }
      }
      if (kind === 'game') {
        if (params.length !== 1 || params[0] !== 'AP') out.push({ level: 'error', line: sig[open].line, rule: 'iife', msg: 'IIFE must take exactly one parameter named AP: (function (AP) {' });
        // call args: after the depth-0 ')' that closes the function expression
        const closeIdx = sig.indexOf(top[1]);
        const callOpen = sig.indexOf(top[2]);
        const callClose = sig.indexOf(top[3]);
        const argText = sig.slice(callOpen + 1, callClose).map(t => t.v).join('');
        if (argText !== 'window.AP=window.AP||{}') out.push({ level: 'error', line: sig[callOpen].line, rule: 'iife', msg: 'IIFE must be invoked as })(window.AP = window.AP || {}); found (' + argText + ')' });
        if (sig[closeIdx - 1] && sig[closeIdx - 1].v !== '}') out.push({ level: 'error', line: sig[closeIdx].line, rule: 'iife', msg: 'unexpected tokens between the function body and ")"' });
      }
    }
    if (!ok) out.push({ level: 'error', line: top[0] ? top[0].line : 1, rule: 'iife', msg });
    for (const d of topLevel) out.push({ level: 'error', line: d.line, rule: 'top-level', msg: 'top-level ' + d.kind + ' ' + d.name + ' outside the IIFE (only AP and AP_NO_AUTOBOOT may be global)' });
    return { issues: out, topLevel, tokens: tk.tokens };
  }

  function describeTopLevel(top) {
    const bad = [];
    for (let k = 0; k < top.length && bad.length < 6; k++) {
      const t = top[k];
      if (t.v === '(' || t.v === ')' || t.v === ';') continue;
      bad.push('line ' + t.line + ' "' + t.v + '"');
    }
    return bad.join(', ') || 'unbalanced brackets';
  }

  // ------------------------------------------------------------------ banned patterns
  // Each rule: {id, re (on code with comments+strings blanked), msg, level(cat, path) → 'error'|'warn'|null}
  const STR_ONLY = 1;
  function allowIn(paths) { return p => paths.some(x => (x instanceof RegExp ? x.test(p) : x === p)); }

  const DATE_OK = allowIn(['js/core/loop.js', 'js/core/storage.js', 'js/game/progress.js', 'js/engine/render.js', 'js/game/devmenu.js', /^js\/ui\//, /^js\/endless\/endless\.js$/, 'js/main.js', 'js/core/ap.js']);
  const PERF_OK = allowIn(['js/core/loop.js', 'js/engine/render.js', 'js/engine/gl.js', 'js/game/devmenu.js', 'js/main.js', 'js/core/ap.js']);
  const IMAGEDATA_OK = allowIn([/^js\/art\//, 'js/engine/render.js', 'js/engine/tilemap.js', 'js/engine/particles.js', 'js/ui/kit.js']);
  const TIMER_SOFT = allowIn(['js/main.js', 'js/core/ap.js', 'js/core/storage.js', /^js\/audio\//, /^js\/ui\//, 'js/engine/render.js', 'js/engine/gl.js', 'js/core/input.js']);

  // Rules run on code with comments, string contents and regex bodies blanked (quote
  // characters are kept, so `import('  ')` still shows its quotes). `on: STR_ONLY` rules run on
  // code with only comments/regex blanked, to inspect string contents.
  const RULES = [
    { id: 'import-export', re: /(^|[;{}\n]\s*)(import\s+[\w{*$]|import\s*['"`{*]|export\s+(default|const|let|var|function|class|async)\b|export\s*[{*])/, msg: 'ES module syntax (import/export) is banned; use classic scripts', level: () => 'error' },
    { id: 'dynamic-import', re: /(^|[^.\w$])import\s*\(\s*['"`]/, msg: 'dynamic import() is banned (no modules/network)', level: () => 'error' },
    { id: 'fetch', re: /(^|[^.\w$]|\bwindow\s*\.\s*)fetch\s*\(/, msg: 'fetch() is banned (no network)', level: () => 'error' },
    { id: 'xhr', re: /\bXMLHttpRequest\b/, msg: 'XMLHttpRequest is banned (no network)', level: () => 'error' },
    { id: 'websocket', re: /\bnew\s+(WebSocket|EventSource)\b|\bsendBeacon\s*\(/, msg: 'network APIs are banned', level: () => 'error' },
    { id: 'worker', re: /\bnew\s+(Worker|SharedWorker)\s*\(|\bserviceWorker\s*\.\s*register\b/, msg: 'Workers are banned', level: () => 'error' },
    { id: 'eval', re: /(^|[^.\w$])eval\s*\(/, msg: 'eval is banned', level: () => 'error' },
    { id: 'new-function', re: /\bnew\s+Function\s*\(|(^|[^.\w$])Function\s*\(\s*['"`]/, msg: 'new Function is banned', level: () => 'error' },
    { id: 'document-write', re: /\bdocument\s*\.\s*write(ln)?\s*\(/, msg: 'document.write is banned', level: () => 'error' },
    { id: 'dialogs', re: /(^|[^.\w$]|\bwindow\s*\.\s*)(alert|confirm|prompt)\s*\(/, msg: 'alert/confirm/prompt are banned (use in-game UI)', level: () => 'error',
      skip: (m, text) => {
        const before = text.slice(Math.max(0, m.index - 40), m.index + (m[1] ? m[1].length : 0));
        if (/function\s*$/.test(before)) return true;                       // function confirm(...)
        const name = m[2];
        if (new RegExp('\\b(function|var|let|const)\\s+' + name + '\\b').test(text)) return true; // local helper
        if (new RegExp('[,(]\\s*' + name + '\\s*[,)]\\s*(=>|\\{)').test(text)) return true;
        return false;
      } },
    { id: 'innerHTML', re: /\b(innerHTML|outerHTML)\b|\binsertAdjacentHTML\s*\(/, msg: 'innerHTML/outerHTML/insertAdjacentHTML are banned', level: () => 'error' },
    { id: 'timers', re: /(^|[^.\w$]|\bwindow\s*\.\s*)(setTimeout|setInterval)\s*\(/, msg: 'setTimeout/setInterval are banned for game logic (use L.time / AP.Beat / the fixed step)', level: (cat, p) => (TIMER_SOFT(p) ? 'warn' : 'error') },
    { id: 'date-now', re: /\bDate\s*\.\s*now\s*\(/, msg: 'Date.now in gameplay is banned (use L.time)', level: (cat, p) => (DATE_OK(p) ? null : (cat === 'gameplay' || cat === 'levels' || cat === 'pure') ? 'error' : 'warn') },
    { id: 'perf-now', re: /\bperformance\s*\.\s*now\s*\(/, msg: 'performance.now in gameplay is banned (use L.time)', level: (cat, p) => (PERF_OK(p) ? null : (cat === 'gameplay' || cat === 'levels' || cat === 'pure') ? 'error' : 'warn') },
    { id: 'math-random', re: /\bMath\s*\.\s*random\s*\(/, msg: 'Math.random in level generation / lint-relevant code is banned (use AP.RNG)', level: (cat) => (cat === 'levels' || cat === 'pure') ? 'error' : (cat === 'gameplay' ? 'warn' : null) },
    { id: 'shadowBlur', re: /\bshadowBlur\s*=(?!=)(?!\s*0(?:\.0*)?\s*[;,)\n}])/, msg: 'shadowBlur other than 0 is banned (use AP.R.glow)', level: () => 'error' },
    { id: 'ctx-filter', re: /\b([A-Za-z_$][\w$]*)\s*\.\s*filter\s*=(?!=)|\[\s*['"]filter['"]\s*\]\s*=(?!=)/, msg: 'ctx.filter is banned', level: () => 'error',
      allowGroup: m => (m[1] && !/(^|[^a-z])(ctx|context|c2d|g2d|g|c|cx|gc)$|[cC]tx$/.test(m[1]) ? 'warn' : null) },
    { id: 'getImageData', re: /\bgetImageData\s*\(/, msg: 'getImageData outside cache builds is banned', level: (cat, p) => (IMAGEDATA_OK(p) ? 'warn' : 'error'), note: 'allowed only while building caches' },
    { id: 'localStorage', re: /\b(localStorage|sessionStorage|indexedDB)\b/, msg: 'storage access outside AP.Save (js/core/storage.js) is banned', level: (cat, p) => (p === 'js/core/storage.js' ? null : 'error') },
    { id: 'debugger', re: /(^|[;{}\s])debugger\s*(;|$)/m, msg: 'debugger statement left in code', level: () => 'error' },
    { id: 'callee', re: /\barguments\s*\.\s*callee\b/, msg: 'arguments.callee throws in strict mode', level: () => 'error' },
    { id: 'proto-mutation', re: /\b(Object|Array|String|Number|Boolean|Function|CanvasRenderingContext2D|Element|HTMLElement|HTMLCanvasElement|Path2D)\s*\.\s*prototype\s*\.\s*\w+\s*=(?!=)|(^|[^.\w$])Math\s*\.\s*\w+\s*=(?!=)/, msg: 'modifying built-in prototypes/objects leaks global state', level: () => 'error' },
    { id: 'window-global', re: /\b(window|globalThis)\s*\.\s*(?!AP\b|AP_NO_AUTOBOOT\b)([A-Za-z_$][\w$]*)\s*=(?!=)/, msg: 'assignment to a window property creates a global (only AP and AP_NO_AUTOBOOT are allowed)', level: () => 'error', allowGroup: m => /^on[a-z]+$/.test(m[2]) ? 'warn' : null },
    { id: 'url', re: /(['"`])(https?:)?\/\/[A-Za-z0-9.-]+\.[a-z]{2,}/i, msg: 'network URL in a string (no network/CDN/assets)', level: () => 'warn', on: STR_ONLY },
    { id: 'asset', re: /(['"`])[^'"`\n]*\.(png|jpe?g|gif|webp|mp3|ogg|wav|m4a|ttf|woff2?|glsl)(['"`])/i, msg: 'reference to an asset file (everything must be generated)', level: () => 'warn', on: STR_ONLY }
  ];

  function lineOf(text, idx) {
    let l = 1;
    for (let k = 0; k < idx; k++) if (text.charCodeAt(k) === 10) l++;
    return l;
  }

  // kind: 'game' | 'tool'
  function bannedScan(relPath, src, kind, tokens) {
    const out = [];
    tokens = tokens || jstok.tokenize(src).tokens;
    const code = jstok.blank(src, tokens, { strings: true, regex: true });
    const withStrings = jstok.blank(src, tokens, { strings: false, regex: true });
    const cat = files.category(relPath);
    for (const rule of RULES) {
      if (kind === 'tool') {
        // tools are Node scripts: only the hard bans apply
        if (!/^(import-export|dynamic-import|fetch|xhr|websocket|eval|new-function|debugger|callee)$/.test(rule.id)) continue;
      }
      const text = rule.on === STR_ONLY ? withStrings : code;
      const re = new RegExp(rule.re.source, rule.re.flags.indexOf('g') >= 0 ? rule.re.flags : rule.re.flags + 'g');
      let m;
      let hits = 0;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        let level = rule.level(cat, relPath);
        if (rule.allowGroup) { const g = rule.allowGroup(m); if (g) level = g; }
        if (!level) break;
        if (rule.skip && rule.skip(m, text)) continue;
        const line = lineOf(text, m.index + (m[1] && rule.id !== 'url' && rule.id !== 'asset' ? m[1].length : 0));
        const srcLine = src.split(/\r?\n/)[line - 1] || '';
        out.push({ level, line, rule: rule.id, msg: rule.msg + (rule.note ? ' (' + rule.note + ')' : '') + ': ' + srcLine.trim().slice(0, 110) });
        if (++hits >= 20) break;
      }
    }
    // shadowBlur special case: any non-literal-zero assignment is an error (caught above);
    return out;
  }

  // ------------------------------------------------------------------ literal names
  // Finds string-literal first arguments of well-known calls.
  //   sfx: AP.sfx('x'  AP.sfxAt('x'  AP.call('Audio.sfx','x'  Audio.sfx('x'
  //   music: AP.music('k'  Audio.music('k'
  //   events: AP.Events.emit('e'  L.emit('e'  .emit('e'
  //   fx: AP.FX.burst('p'  FX.preset('p'
  function literalCalls(src, tokens) {
    tokens = tokens || jstok.tokenize(src).tokens;
    const sig = jstok.significant(tokens);
    const found = { sfx: [], music: [], emit: [], burst: [], preset: [], loop: [] };
    for (let i = 0; i < sig.length - 2; i++) {
      const t = sig[i];
      if (t.t !== 'ident') continue;
      const open = sig[i + 1], arg = sig[i + 2];
      if (!(open && open.v === '(' && arg && (arg.t === 'str' || (arg.t === 'tpl' && arg.tplPart === 'full')))) continue;
      const prev = sig[i - 1], prev2 = sig[i - 2];
      const owner = prev && prev.v === '.' && prev2 && prev2.t === 'ident' ? prev2.v : null;
      const name = t.v;
      const item = { name: arg.cooked, line: arg.line };
      if ((name === 'sfx' || name === 'sfxAt') && (owner === 'AP' || owner === 'Audio')) found.sfx.push(item);
      else if (name === 'music' && (owner === 'AP' || owner === 'Audio')) found.music.push(item);
      else if (name === 'setLoop' && owner === 'Audio') found.loop.push(item);
      else if (name === 'emit' && owner) found.emit.push(item);
      else if (name === 'burst' && owner === 'FX') found.burst.push(item);
      else if (name === 'preset' && owner === 'FX') found.preset.push(item);
      else if (name === 'call' && owner === 'AP' && arg.cooked === 'Audio.sfx') {
        const a2 = sig[i + 4];
        if (sig[i + 3] && sig[i + 3].v === ',' && a2 && a2.t === 'str') found.sfx.push({ name: a2.cooked, line: a2.line });
      }
    }
    return found;
  }

  exports.syntax = syntax;
  exports.checkHeader = checkHeader;
  exports.checkIIFE = checkIIFE;
  exports.bannedScan = bannedScan;
  exports.literalCalls = literalCalls;
  exports.RULES = RULES;
  exports.HEADER_RE = HEADER_RE;
})(module.exports);
