/* tools/build-dist.js — owner: TOOLS */
(function () {
  'use strict';
  // Single-file build: inlines css/style.css and every <script src> of index.html (in index.html
  // order) into dist/apeiron.html, so the whole game is one double-clickable file.
  //   - each script becomes <script data-src="js/…">…</script> (boot-test --dist reads data-src)
  //   - "</script" inside code is escaped as "<\/script" and "<!--" as "<\!--" (both are the same
  //     string inside JS literals, and keep the HTML parser in the script data state)
  //   - missing files are skipped with a warning (the browser would 404 and continue)
  //   - the result is checked: no external src/href, every inlined script still compiles
  //   node tools/build-dist.js [--out dist/apeiron.html] [--strict]

  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const cli = require('./lib/cli');
  const files = require('./lib/files');

  function escapeScript(code) {
    return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  }
  function escapeStyle(css) { return css.replace(/<\/(style)/gi, '<\\/$1'); }

  function build(opts) {
    opts = opts || {};
    const rep = opts.rep || new cli.Report('build-dist');
    const index = files.readIndex('index.html');
    if (!index.exists) { rep.error('index.html', 'index.html is missing (CORE)'); return { rep }; }
    let html = index.html;
    const included = [], skipped = [];
    // stylesheets
    html = html.replace(/<link\b[^>]*>/gi, tag => {
      if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
      const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      const href = m ? (m[2] || m[3] || m[4] || '').replace(/^\.\//, '') : '';
      if (/^(https?:)?\/\//i.test(href)) { rep.error('index.html', 'external stylesheet ' + href + ' cannot be inlined (no network)'); return tag; }
      if (!cli.exists(href)) { rep.warn(href, 'stylesheet missing; dropped'); skipped.push(href); return ''; }
      included.push(href);
      return '<style data-src="' + href + '">\n' + escapeStyle(cli.read(href)) + '\n</style>';
    });
    // scripts
    let bytes = 0;
    html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs, body) => {
      const m = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      if (!m) return whole;
      const src = (m[2] || m[3] || m[4] || '').replace(/^\.\//, '');
      if (/^(https?:)?\/\//i.test(src)) { rep.error('index.html', 'external script ' + src + ' cannot be inlined (no network)'); return whole; }
      if (!cli.exists(src)) { rep.warn(src, 'missing; skipped (owner ' + files.ownerOf(src) + ')'); skipped.push(src); return '<!-- ' + src + ' missing at build time -->'; }
      let code = cli.read(src);
      if (code.charCodeAt(0) === 0xFEFF) code = code.slice(1);
      try { new vm.Script(code, { filename: src }); }
      catch (e) { rep.error(src, 'does not compile, inlined anyway: ' + e.message); }
      included.push(src);
      bytes += code.length;
      const rest = attrs.replace(/\s*\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '').replace(/\s*\b(async|defer)\b/gi, '');
      return '<script data-src="' + src + '"' + rest + '>\n' + escapeScript(code) + '\n</script>';
    });
    const banner = '<!-- APEIRON single-file build: ' + included.length + ' files inlined from index.html by tools/build-dist.js' +
      (skipped.length ? '; missing at build time: ' + skipped.join(', ') : '') + ' -->\n';
    html = html.replace(/<html\b[^>]*>/i, t => t + '\n' + banner);
    // verification
    const tagRe = /<script\b([^>]*)>/gi;
    let tm;
    while ((tm = tagRe.exec(html))) {
      const attrs = tm[1].replace(/\bdata-src\s*=\s*("[^"]*"|'[^']*')/gi, '');
      if (/(^|\s)src\s*=/i.test(attrs)) { rep.error('dist', 'an external <script src> remains in the build: ' + tm[0].slice(0, 80)); break; }
    }
    if (/<link\b[^>]*rel\s*=\s*["']?stylesheet/i.test(html)) rep.error('dist', 'an external stylesheet remains in the build');
    if (/<(img|audio|video|source|iframe)\b[^>]*\bsrc\s*=/i.test(html)) rep.warn('dist', 'the build references an external media file');
    const harness = require('./lib/harness');
    const parsed = harness.parseDistHtml(html);
    for (const s of parsed.scripts) {
      if (s.code === null) continue;
      try { new vm.Script(s.code, { filename: 'dist#' + s.path }); }
      catch (e) { rep.error('dist#' + s.path, 'the inlined script no longer compiles (escaping broke it?): ' + e.message); }
    }
    const out = opts.out || 'dist/apeiron.html';
    fs.mkdirSync(path.dirname(cli.abs(out)), { recursive: true });
    fs.writeFileSync(cli.abs(out), html, 'utf8');
    return { rep, out, included, skipped, size: Buffer.byteLength(html, 'utf8'), bytes };
  }

  function run(argv) {
    const args = cli.parseArgs(argv, { out: 'string', strict: 'bool' });
    const rep = new cli.Report('build-dist');
    for (const e of args._errors) rep.error('args', e);
    if (rep.errors) { rep.print(); console.log(rep.summary()); return 2; }
    const r = build({ out: args.out || 'dist/apeiron.html', rep });
    if (args.strict) for (const it of rep.items) if (it.level === 'warn') it.level = 'error';
    rep.print();
    if (r.out) console.log(cli.C.dim('wrote ' + r.out + ' (' + (r.size / 1024).toFixed(0) + ' KiB, ' + r.included.length + ' files inlined' + (r.skipped.length ? ', ' + r.skipped.length + ' missing' : '') + ')'));
    console.log(rep.summary());
    return rep.errors ? 1 : 0;
  }

  module.exports = { run, build, escapeScript };
  if (require.main === module) cli.runMain(run);
})();
