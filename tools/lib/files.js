/* tools/lib/files.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // Canonical script load order and file ownership (CONTRACT §1), plus helpers to read
  // index.html's <script> order and cross-check it against the canonical list.

  const cli = require('./cli');

  // [path, owner, provides]
  const SCRIPTS = [
    ['js/core/ap.js', 'CORE', 'AP root helpers §2.1'],
    ['js/core/const.js', 'CORE', 'VERBATIM §2.2'],
    ['js/core/math.js', 'CORE', 'AP.M, AP.Color'],
    ['js/core/rng.js', 'CORE', 'AP.hash, AP.hash2, AP.RNG'],
    ['js/core/noise.js', 'CORE', 'AP.Noise'],
    ['js/core/algo.js', 'TOOLS', 'AP.Algo'],
    ['js/core/flow.js', 'CORE', 'AP.Flow'],
    ['js/core/path.js', 'CORE', 'AP.Path'],
    ['js/core/events.js', 'CORE', 'AP.Events'],
    ['js/core/storage.js', 'CORE', 'AP.Save'],
    ['js/core/input.js', 'CORE', 'AP.Input'],
    ['js/core/beat.js', 'CORE', 'AP.Beat'],
    ['js/core/loop.js', 'CORE', 'AP.Loop, AP.Time'],
    ['js/engine/render.js', 'CORE', 'AP.R'],
    ['js/engine/gl.js', 'CORE', 'AP.GL'],
    ['js/engine/scenes.js', 'CORE', 'AP.Scenes'],
    ['js/engine/camera.js', 'CORE', 'AP.Camera'],
    ['js/engine/particles.js', 'CORE', 'AP.FX'],
    ['js/engine/physics.js', 'CORE', 'AP.Phys, entity prototype'],
    ['js/engine/entities.js', 'CORE', 'AP.Entities'],
    ['js/engine/tilemap.js', 'CORE', 'AP.Tilemap'],
    ['js/engine/levels.js', 'CORE', 'AP.Levels'],
    ['js/data/worlds.js', 'CORE', 'VERBATIM §5'],
    ['js/art/kit.js', 'ART', 'AP.Art'],
    ['js/art/backgrounds.js', 'ART', 'AP.Backgrounds'],
    ['js/art/midground.js', 'ART', 'AP.Midground'],
    ['js/art/tileart.js', 'ART', 'AP.TileArt'],
    ['js/audio/engine.js', 'AUDIO', 'AP.Audio core'],
    ['js/audio/sfx.js', 'AUDIO', 'all AP.SFX voices'],
    ['js/audio/music.js', 'AUDIO', 'all AP.MUSIC keys'],
    ['js/game/progress.js', 'CORE', 'AP.Progress'],
    ['js/game/player.js', 'CORE', "type 'player'"],
    ['js/game/common.js', 'CORE', 'common types §2.16'],
    ['js/game/levelscene.js', 'CORE', "scene 'level', AP.Test"],
    ['js/game/devmenu.js', 'CORE', "scene 'devmenu'"],
    ['js/worlds/w1/entities.js', 'W1', 'w1.* types'],
    ['js/worlds/w1/boss.js', 'W1', 'w1.tessellator'],
    ['js/worlds/w2/entities.js', 'W2', 'w2.* types'],
    ['js/worlds/w2/boss.js', 'W2', 'w2.monarch'],
    ['js/worlds/w3/entities.js', 'W3', 'w3.* types'],
    ['js/worlds/w3/boss.js', 'W3', 'w3.maelstrom'],
    ['js/worlds/w4/entities.js', 'W4', 'w4.* types'],
    ['js/worlds/w4/boss.js', 'W4', 'w4.recursion'],
    ['js/worlds/w5/entities.js', 'W5', 'w5.* types'],
    ['js/worlds/w5/boss.js', 'W5', 'w5.null'],
    ['js/levels/test.js', 'CORE', 'test-* levels'],
    ['js/levels/w1.js', 'W1', 'w1 levels'],
    ['js/levels/w2.js', 'W2', 'w2 levels'],
    ['js/levels/w3.js', 'W3', 'w3 levels'],
    ['js/levels/w4.js', 'W4', 'w4 levels'],
    ['js/levels/w5.js', 'W5', 'w5 levels'],
    ['js/endless/chunks.js', 'W1', 'chunk templates'],
    ['js/endless/generator.js', 'W1', 'AP.Endless'],
    ['js/endless/endless.js', 'W1', "scene 'endless'"],
    ['js/data/theorems.js', 'UI', 'AP.Theorems'],
    ['js/ui/kit.js', 'UI', 'AP.UI'],
    ['js/ui/hud.js', 'UI', 'AP.HUD'],
    ['js/ui/meta.js', 'UI', 'AP.Meta, AP.Cosmetics'],
    ['js/ui/title.js', 'UI', "scene 'title'"],
    ['js/ui/story.js', 'UI', "scenes 'intro', 'ending', 'credits'"],
    ['js/ui/worldmap.js', 'UI', "scene 'map'"],
    ['js/ui/menus.js', 'UI', "scenes 'pause', 'results'"],
    ['js/ui/settings.js', 'UI', "scenes 'settings', 'remap'"],
    ['js/ui/extras.js', 'UI', "scenes 'theorems', 'cosmetics'"],
    ['js/main.js', 'CORE', 'AP.boot(); autoboot; must be last']
  ];

  const OTHER_FILES = [
    ['index.html', 'CORE'],
    ['css/style.css', 'CORE'],
    ['docs/ENGINE_API.md', 'CORE']
  ];

  const OWNERS = ['CORE', 'TOOLS', 'ART', 'AUDIO', 'UI', 'W1', 'W2', 'W3', 'W4', 'W5'];

  const ORDER = SCRIPTS.map(s => s[0]);
  const OWNER_OF = {};
  for (const s of SCRIPTS) OWNER_OF[s[0]] = s[1];
  for (const s of OTHER_FILES) OWNER_OF[s[0]] = s[1];

  function ownerOf(p) {
    p = cli.rel(p);
    if (OWNER_OF[p]) return OWNER_OF[p];
    if (/^tools\//.test(p)) return 'TOOLS';
    if (/^dist\//.test(p)) return 'INTEGRATOR';
    const m = /^js\/worlds\/w([1-5])\//.exec(p) || /^js\/levels\/w([1-5])\.js$/.exec(p);
    if (m) return 'W' + m[1];
    if (/^js\/endless\//.test(p)) return 'W1';
    if (/^js\/art\//.test(p)) return 'ART';
    if (/^js\/audio\//.test(p)) return 'AUDIO';
    if (/^js\/ui\//.test(p)) return 'UI';
    if (/^js\//.test(p)) return 'CORE';
    return 'UNKNOWN';
  }

  // Canonical game scripts owned by `owner` (all when owner is null / 'INTEGRATOR').
  function scriptsFor(owner) {
    if (!owner || owner === 'INTEGRATOR' || owner === 'ALL') return ORDER.slice();
    return SCRIPTS.filter(s => s[1] === owner).map(s => s[0]);
  }

  // Every JS file an owner is responsible for (game scripts, TOOLS' tools, fixtures).
  function ownedJs(owner) {
    let list = scriptsFor(owner);
    if (!owner || owner === 'INTEGRATOR' || owner === 'ALL' || owner === 'TOOLS') {
      const tools = cli.listDir('tools', p => /\.js$/.test(p));
      list = list.concat(tools);
    }
    return list;
  }

  // Classification used for banned-pattern allowances.
  function category(p) {
    p = cli.rel(p);
    if (/^tools\/fixtures\//.test(p)) return 'levels';
    if (/^tools\//.test(p)) return 'tool';
    if (/^js\/levels\//.test(p)) return 'levels';
    if (/^js\/endless\/(chunks|generator)\.js$/.test(p)) return 'levels';
    if (/^js\/endless\//.test(p)) return 'gameplay';
    if (/^js\/worlds\//.test(p)) return 'gameplay';
    if (/^js\/game\/devmenu\.js$/.test(p)) return 'dev';
    if (/^js\/game\//.test(p)) return 'gameplay';
    if (/^js\/engine\/(physics|entities|tilemap|levels)\.js$/.test(p)) return 'gameplay';
    if (/^js\/core\/(algo|rng|noise|flow|path|const|math)\.js$/.test(p)) return 'pure';
    if (/^js\/data\//.test(p)) return 'pure';
    if (/^js\/art\//.test(p)) return 'art';
    if (/^js\/audio\//.test(p)) return 'audio';
    if (/^js\/ui\//.test(p)) return 'ui';
    if (/^js\/engine\//.test(p)) return 'engine';
    if (/^js\/core\//.test(p)) return 'core';
    if (/^js\/main\.js$/.test(p)) return 'core';
    return 'other';
  }

  // ------------------------------------------------------------- index.html
  // Returns {exists, scripts:[{src, attrs, line}], styles:[href], problems:[{level,msg}]}
  function readIndex(htmlPath) {
    htmlPath = htmlPath || 'index.html';
    const out = { exists: false, scripts: [], styles: [], problems: [], html: '' };
    if (!cli.exists(htmlPath)) return out;
    out.exists = true;
    const html = cli.read(htmlPath);
    out.html = html;
    const noComments = html.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let m;
    while ((m = re.exec(noComments))) {
      const attrs = m[1];
      const line = noComments.slice(0, m.index).split('\n').length;
      const srcM = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      if (!srcM) {
        if (m[2].trim()) out.problems.push({ level: 'warn', msg: 'index.html:' + line + ' inline <script> found; all code should live in js/ files' });
        continue;
      }
      const src = (srcM[2] || srcM[3] || srcM[4] || '').replace(/^\.\//, '');
      out.scripts.push({ src, attrs, line });
      if (/\btype\s*=\s*["']?module/i.test(attrs)) out.problems.push({ level: 'error', msg: 'index.html:' + line + ' ' + src + ' uses type="module" (classic scripts only, CONTRACT §0)' });
      if (/\b(async|defer)\b/i.test(attrs)) out.problems.push({ level: 'error', msg: 'index.html:' + line + ' ' + src + ' has async/defer, which breaks the §1 load order' });
      if (/^(https?:)?\/\//i.test(src)) out.problems.push({ level: 'error', msg: 'index.html:' + line + ' external script ' + src + ' (no network/CDN, CONTRACT §0)' });
    }
    const linkRe = /<link\b([^>]*)>/gi;
    while ((m = linkRe.exec(noComments))) {
      const hrefM = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
      const href = hrefM ? (hrefM[2] || hrefM[3] || hrefM[4] || '') : '';
      if (/^(https?:)?\/\//i.test(href)) out.problems.push({ level: 'error', msg: 'index.html external resource ' + href + ' (no network/CDN)' });
      if (/stylesheet/i.test(m[1])) out.styles.push(href.replace(/^\.\//, ''));
    }
    if (!/id\s*=\s*["']?stage/i.test(noComments)) out.problems.push({ level: 'warn', msg: 'index.html has no #stage element (CONTRACT §1: #stage > canvas#bg + canvas#game)' });
    if (!/<canvas\b[^>]*id\s*=\s*["']?bg\b/i.test(noComments)) out.problems.push({ level: 'warn', msg: 'index.html has no canvas#bg' });
    if (!/<canvas\b[^>]*id\s*=\s*["']?game\b/i.test(noComments)) out.problems.push({ level: 'warn', msg: 'index.html has no canvas#game' });
    return out;
  }

  // Cross-check index.html order with the canonical list.
  // → [{level:'warn'|'error', msg}] (level 'warn' becomes 'error' when strict)
  function crossCheck(index, strict) {
    const issues = [];
    const lvl = strict ? 'error' : 'warn';
    const srcs = index.scripts.map(s => s.src);
    const canon = ORDER;
    const inCanon = new Set(canon);
    const inIndex = new Set(srcs);
    for (const p of canon) if (!inIndex.has(p)) issues.push({ level: lvl, msg: 'index.html is missing <script src="' + p + '"> (owner ' + OWNER_OF[p] + ')' });
    for (const s of srcs) if (!inCanon.has(s)) issues.push({ level: lvl, msg: 'index.html has extra script ' + s + ' that is not in CONTRACT §1' });
    const seen = new Set();
    for (const s of srcs) {
      if (seen.has(s)) issues.push({ level: 'error', msg: 'index.html loads ' + s + ' twice' });
      seen.add(s);
    }
    // order: the canonical scripts present in index must appear in canonical relative order
    const filtered = srcs.filter(s => inCanon.has(s));
    let lastIdx = -1, lastName = null;
    for (const s of filtered) {
      const idx = canon.indexOf(s);
      if (idx < lastIdx) issues.push({ level: lvl, msg: 'index.html loads ' + s + ' after ' + lastName + ' (CONTRACT §1 order: ' + s + ' is #' + (idx + 1) + ', ' + lastName + ' is #' + (lastIdx + 1) + ')' });
      else { lastIdx = idx; lastName = s; }
    }
    if (srcs.length && srcs[srcs.length - 1] !== 'js/main.js' && inIndex.has('js/main.js')) issues.push({ level: 'error', msg: 'js/main.js must be the last script in index.html' });
    return issues;
  }

  // Load order used by the harness: index.html order when it exists, else canonical.
  function loadOrder(opts) {
    opts = opts || {};
    const index = readIndex(opts.index || 'index.html');
    if (index.exists && index.scripts.length && !opts.canonical) {
      return { order: index.scripts.map(s => s.src), from: 'index.html', index };
    }
    return { order: ORDER.slice(), from: 'CONTRACT §1', index };
  }

  exports.SCRIPTS = SCRIPTS;
  exports.OTHER_FILES = OTHER_FILES;
  exports.ORDER = ORDER;
  exports.OWNERS = OWNERS;
  exports.OWNER_OF = OWNER_OF;
  exports.ownerOf = ownerOf;
  exports.scriptsFor = scriptsFor;
  exports.ownedJs = ownedJs;
  exports.category = category;
  exports.readIndex = readIndex;
  exports.crossCheck = crossCheck;
  exports.loadOrder = loadOrder;
})(module.exports);
