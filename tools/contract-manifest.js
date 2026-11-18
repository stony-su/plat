/* tools/contract-manifest.js — owner: TOOLS */
(function () {
  'use strict';
  // Machine-readable manifest of every CONTRACT §2 / §5 symbol: path, expected type, minimum
  // arity (Function.length must be ≥ it), owner and when it exists:
  //   load      after the scripts load        boot   after AP.boot({headless:true})
  //   level     on a running level (L = AP.level, P = L.player, cam = L.cam)
  // Paths: 'AP.X.y' (live object), 'Entity#m' (AP.Entities.proto), 'Camera#m'
  // (AP.Camera.prototype), 'RNG#m' (an AP.RNG(1) instance), 'L.m', 'P.m', 'cam.m'.
  // Optional entries (opt: true) only warn. Plus the VERBATIM §2.2 / §5 tables, the §2.16 common
  // types, the §5 required world types, and the §2.9 scenes per owner.
  //   node tools/contract-manifest.js            print the manifest summary
  //   node tools/contract-manifest.js --check [--owner X] [--strict] [--json]

  const F = 'function', O = 'object', N = 'number', S = 'string', B = 'boolean', A = 'array', ANY = 'any';
  const M = [];
  function add(owner, when, list) {
    for (const it of list) {
      const [path, type, arity, extra] = it;
      M.push(Object.assign({ path, type, arity: arity || 0, owner, when }, extra || {}));
    }
  }

  // §2.1
  add('CORE', 'load', [
    ['AP.VERSION', S], ['AP.DEV', B], ['AP.log', F], ['AP.warn', F], ['AP.warnOnce', F, 1], ['AP.errors', A],
    ['AP.reportError', F, 2], ['AP.guard', F, 2], ['AP.has', F, 1], ['AP.call', F, 1], ['AP.sfx', F, 1], ['AP.sfxAt', F, 3],
    ['AP.music', F, 1], ['AP.level', ANY, 0, { nullable: true }], ['AP.boot', F]
  ]);
  // §2.2 (values checked verbatim below)
  add('CORE', 'load', [
    ['AP.C', O], ['AP.TILE', O], ['AP.TILE_CHARS', O], ['AP.ENTITY_CHARS', O], ['AP.FORMS', A], ['AP.FORM_NAMES', O],
    ['AP.abilities', F, 1], ['AP.ACTIONS', A], ['AP.SFX', A], ['AP.LOOPS', A], ['AP.MUSIC', O], ['AP.STYLES', A], ['AP.EVENTS', A],
    ['AP.U', O], ['AP.U.t', F, 1], ['AP.U.deg', F, 1]
  ]);
  // §2.3 pure helpers
  add('CORE', 'load', [
    ['AP.M', O], ['AP.M.TAU', N], ['AP.M.clamp', F, 3], ['AP.M.lerp', F, 3], ['AP.M.invLerp', F, 3], ['AP.M.approach', F, 3],
    ['AP.M.sign', F, 1], ['AP.M.damp', F, 4], ['AP.M.wrapAngle', F, 1], ['AP.M.angleDiff', F, 2], ['AP.M.dist', F, 4], ['AP.M.len', F, 2],
    ['AP.M.norm', F, 2], ['AP.M.rot', F, 3], ['AP.M.aabb', F, 8], ['AP.M.pointInPoly', F, 3], ['AP.M.ease', O],
    ['AP.M.ease.linear', F, 1], ['AP.M.ease.inQuad', F, 1], ['AP.M.ease.outQuad', F, 1], ['AP.M.ease.inCubic', F, 1],
    ['AP.M.ease.outCubic', F, 1], ['AP.M.ease.inOutSine', F, 1], ['AP.M.ease.outBack', F, 1], ['AP.M.ease.outElastic', F, 1],
    ['AP.Color', O], ['AP.Color.rgb', F, 1], ['AP.Color.rgba', F, 2], ['AP.Color.mix', F, 3], ['AP.Color.shade', F, 2],
    ['AP.Color.hsl', F, 3], ['AP.Color.vec3', F, 1],
    ['AP.hash', F, 1], ['AP.hash2', F, 3], ['AP.RNG', F, 1],
    ['RNG#next', F], ['RNG#int', F, 2], ['RNG#range', F, 2], ['RNG#pick', F, 1], ['RNG#chance', F, 1], ['RNG#sign', F],
    ['RNG#shuffle', F, 1], ['RNG#fork', F, 1],
    ['AP.Noise', O], ['AP.Noise.n2', F, 2], ['AP.Noise.n3', F, 3], ['AP.Noise.fbm2', F, 2], ['AP.Noise.fbm3', F, 3], ['AP.Noise.worley2', F, 3],
    ['AP.Flow', O], ['AP.Flow.DEFAULT', O], ['AP.Flow.params', F, 1], ['AP.Flow.fromSpec', F, 1], ['AP.Flow.sample', F, 5],
    ['AP.Flow.force', F, 6], ['AP.Flow.velocity', F, 6], ['AP.Flow.streamline', F, 7],
    ['AP.Path', O], ['AP.Path.poly', F, 5], ['AP.Path.length', F, 1], ['AP.Path.liss', F, 3], ['AP.Path.lissFromSpec', F, 3], ['AP.Path.circle', F, 7]
  ]);
  add('TOOLS', 'load', [
    ['AP.Algo', O], ['AP.Algo.euclid', F, 2], ['AP.Algo.lsystem', F, 3], ['AP.Algo.turtle', F, 1], ['AP.Algo.koch', F, 5],
    ['AP.Algo.sierpinski', F, 4], ['AP.Algo.voronoi', F, 2], ['AP.Algo.truchet', F, 3], ['AP.Algo.lissajous', F, 2],
    ['AP.Algo.harmonograph', F, 2], ['AP.Algo.phyllo', F, 2], ['AP.Algo.poisson', F, 4]
  ]);
  // §2.4 – §2.7
  add('CORE', 'load', [
    ['AP.Events', O], ['AP.Events.on', F, 2], ['AP.Events.once', F, 2], ['AP.Events.off', F, 2], ['AP.Events.emit', F, 1],
    ['AP.Input', O], ['AP.Input.init', F, 1], ['AP.Input.update', F, 1], ['AP.Input.held', F, 1], ['AP.Input.pressed', F, 1],
    ['AP.Input.released', F, 1], ['AP.Input.buffered', F, 2], ['AP.Input.consume', F, 1], ['AP.Input.repeat', F, 1], ['AP.Input.axis', F, 1],
    ['AP.Input.anyPressed', F], ['AP.Input.label', F, 1], ['AP.Input.bindings', F], ['AP.Input.setBinding', F, 4],
    ['AP.Input.resetBindings', F], ['AP.Input.capture', F, 2], ['AP.Input.setVirtual', F, 2], ['AP.Input.clearVirtual', F], ['AP.Input.lock', F, 1],
    ['AP.Loop', O], ['AP.Loop.start', F], ['AP.Loop.stop', F], ['AP.Loop.step', F, 1], ['AP.Loop.renderOnce', F],
    ['AP.Time', O], ['AP.Time.now', N], ['AP.Time.step', N], ['AP.Time.frame', N], ['AP.Time.alpha', N], ['AP.Time.scale', N],
    ['AP.Beat', O], ['AP.Beat.set', F, 1], ['AP.Beat.reset', F], ['AP.Beat.update', F, 1], ['AP.Beat.bpm', N], ['AP.Beat.meter', N],
    ['AP.Beat.time', N], ['AP.Beat.beat', N], ['AP.Beat.bar', N], ['AP.Beat.inBar', N], ['AP.Beat.phase', N], ['AP.Beat.ticked', B],
    ['AP.Beat.barTicked', B], ['AP.Beat.polyIndex', F, 1], ['AP.Beat.polyTicked', F, 1], ['AP.Beat.euclidTicked', F, 2], ['AP.Beat.realBpm', F],
    ['AP.Save', O], ['AP.Save.load', F], ['AP.Save.save', F], ['AP.Save.reset', F], ['AP.Save.resetSettings', F], ['AP.Save.level', F, 1],
    ['AP.Save.setGem', F, 2], ['AP.Save.stat', F, 1], ['AP.Save.setting', F, 1], ['AP.Save.setSetting', F, 2], ['AP.Save.export', F],
    ['AP.Save.import', F, 1], ['AP.Save.available', B],
    ['AP.Progress', O], ['AP.Progress.order', F], ['AP.Progress.next', F, 1], ['AP.Progress.isUnlocked', F, 1], ['AP.Progress.complete', F, 2],
    ['AP.Progress.percent', F], ['AP.Progress.worldState', F, 1]
  ]);
  add('CORE', 'boot', [
    ['AP.Input.device', S], ['AP.Input.mouse', O], ['AP.Loop.fps', N], ['AP.Save.data', O], ['AP.Save.data.settings', O]
  ]);
  // §2.8 – §2.13
  add('CORE', 'load', [
    ['AP.R', O], ['AP.R.init', F, 1], ['AP.R.W', N, 0, { equals: 960 }], ['AP.R.H', N, 0, { equals: 540 }], ['AP.R.FONT_UI', S], ['AP.R.FONT_MONO', S],
    ['AP.R.font', F, 1], ['AP.R.text', F, 4], ['AP.R.poly', F, 5], ['AP.R.star', F, 6], ['AP.R.glow', F, 5], ['AP.R.line', F, 5],
    ['AP.R.additive', F, 2], ['AP.R.pal', F, 1], ['AP.R.drawBackground', F, 2], ['AP.R.bgFallback', F], ['AP.R.drawTilesFallback', F],
    ['AP.R.hudFallback', F], ['AP.R.flash', F, 2], ['AP.R.toggleFullscreen', F],
    ['AP.GL', O], ['AP.GL.init', F, 1], ['AP.GL.compile', F, 2], ['AP.GL.drawFullscreen', F, 1], ['AP.GL.resize', F], ['AP.GL.bgScale', N],
    ['AP.Scenes', O], ['AP.Scenes.register', F, 2], ['AP.Scenes.has', F, 1], ['AP.Scenes.go', F, 1], ['AP.Scenes.push', F, 1],
    ['AP.Scenes.pop', F], ['AP.Scenes.top', F], ['AP.Scenes.stack', A],
    ['AP.Camera', F, 1], ['Camera#follow', F, 1], ['Camera#snap', F], ['Camera#setBounds', F, 4], ['Camera#lock', F, 1],
    ['Camera#shake', F, 2], ['Camera#kick', F, 2], ['Camera#visible', F, 4], ['Camera#toScreen', F, 3], ['Camera#toWorld', F, 3],
    ['Camera#cx', F], ['Camera#cy', F],
    ['AP.FX', O], ['AP.FX.emit', F, 3], ['AP.FX.burst', F, 3], ['AP.FX.ring', F, 6], ['AP.FX.preset', F, 2], ['AP.FX.update', F, 1],
    ['AP.FX.render', F, 2], ['AP.FX.clear', F], ['AP.FX.count', F],
    ['AP.Entities', O], ['AP.Entities.register', F, 2], ['AP.Entities.get', F, 1], ['AP.Entities.has', F, 1], ['AP.Entities.list', F],
    ['AP.Entities.proto', O],
    ['Entity#cx', F], ['Entity#cy', F], ['Entity#right', F], ['Entity#bottom', F], ['Entity#overlaps', F, 1], ['Entity#overlapsRect', F, 4],
    ['Entity#collideAt', F, 2], ['Entity#groundAt', F], ['Entity#moveX', F, 1], ['Entity#moveY', F, 1], ['Entity#isRiding', F, 1],
    ['Entity#squish', F], ['Entity#moveSolid', F, 2], ['Entity#setPos', F, 2],
    ['AP.Phys', O], ['AP.Phys.gravity', F, 2], ['AP.Phys.approach', F, 3], ['AP.Phys.rectSolid', F, 5], ['AP.Phys.raycast', F, 7], ['AP.Phys.walk', F, 3],
    ['AP.Tilemap', O], ['AP.Levels', O], ['AP.Levels.register', F, 1], ['AP.Levels.get', F, 1], ['AP.Levels.has', F, 1], ['AP.Levels.list', F],
    ['AP.Test', O], ['AP.Test.startLevel', F, 1], ['AP.Test.god', F], ['AP.Test.teleport', F, 2], ['AP.Test.defeatBoss', F]
  ]);
  add('CORE', 'boot', [
    ['AP.R.scale', N], ['AP.R.dpr', N], ['AP.R.px', N], ['AP.R.ctx', O], ['AP.R.quality', O], ['AP.R.quality.particles', N],
    ['AP.R.quality.bg', S], ['AP.R.quality.mid', B], ['AP.GL.ok', B], ['AP.GL.gl', ANY, 0, { nullable: true }], ['AP.Scenes.current', ANY, 0, { nullable: true }]
  ]);
  // §2.14 / §2.15 on a running level
  add('CORE', 'level', [
    ['L.id', S], ['L.def', O], ['L.mode', S], ['L.world', N], ['L.index', N], ['L.form', N], ['L.style', S], ['L.pal', O], ['L.seed', N],
    ['L.rng', O], ['L.w', N], ['L.h', N], ['L.pw', N], ['L.ph', N], ['L.tiles', O], ['L.time', N], ['L.player', O], ['L.entities', A],
    ['L.cam', O], ['L.stats', O], ['L.stats.gems', A], ['L.flags', O], ['L.checkpoint', O], ['L.bossInfo', ANY, 0, { nullable: true }],
    ['L.intensity', N], ['L.ended', ANY],
    ['L.spawn', F, 3], ['L.remove', F, 1], ['L.find', F, 1], ['L.first', F, 1], ['L.byTag', F, 1], ['L.query', F, 4], ['L.queryInto', F, 5],
    ['L.orbitNodes', F], ['L.burst', F, 3], ['L.killPlayer', F, 1], ['L.setCheckpoint', F, 3], ['L.retry', F], ['L.restart', F],
    ['L.skipLevel', F], ['L.quit', F], ['L.completeLevel', F], ['L.refreshAir', F], ['L.shake', F, 2], ['L.kick', F, 2], ['L.hitstop', F, 1],
    ['L.flash', F, 1], ['L.bossStart', F, 1], ['L.bossBar', F, 1], ['L.bossDefeated', F, 1], ['L.clearMinions', F], ['L.tileAt', F, 2],
    ['L.setTile', F, 3], ['L.breakTile', F, 2], ['L.tileFree', F, 2], ['L.snapshotTiles', F], ['L.restoreTiles', F, 1], ['L.solidAt', F, 4],
    ['L.raycast', F, 6], ['L.on', F, 2], ['L.emit', F, 1],
    ['cam.x', N], ['cam.y', N], ['cam.w', N, 0, { equals: 960 }], ['cam.h', N, 0, { equals: 540 }], ['cam.renderX', N], ['cam.renderY', N],
    ['P.form', N], ['P.ab', O], ['P.ab.wall', B], ['P.ab.double', B], ['P.ab.dash', B], ['P.ab.orbit', B], ['P.state', S], ['P.grounded', B],
    ['P.wall', N], ['P.facing', N], ['P.vx', N], ['P.vy', N], ['P.prevBottom', N], ['P.hasDouble', B], ['P.hasDash', B], ['P.dashDir', O],
    ['P.orbitNode', ANY, 0, { nullable: true }], ['P.invuln', N], ['P.vis', O], ['P.trail', A],
    ['P.setForm', F, 1], ['P.addForce', F, 2], ['P.launch', F, 2], ['P.refresh', F], ['P.freeze', F, 1], ['P.isDashing', F],
    ['P.isOrbiting', F], ['P.cx', F], ['P.cy', F], ['P.w', N, 0, { equals: 22 }], ['P.h', N, 0, { equals: 22 }]
  ]);
  // §2.8 ART
  add('ART', 'load', [
    ['AP.Backgrounds', O], ['AP.Backgrounds.init', F, 1], ['AP.Backgrounds.has', F, 1], ['AP.Backgrounds.render', F, 3],
    ['AP.Backgrounds.render2D', F, 3, { opt: true }],
    ['AP.Midground', O], ['AP.Midground.render', F, 3],
    ['AP.TileArt', O], ['AP.TileArt.build', F, 1], ['AP.TileArt.draw', F, 3], ['AP.TileArt.invalidate', F, 3], ['AP.TileArt.dispose', F, 1], ['AP.TileArt.resize', F],
    ['AP.Art', O, 0, { opt: true }], ['AP.Art.truchet', F, 5, { opt: true }], ['AP.Art.crystal', F, 3, { opt: true }], ['AP.Art.vine', F, 4, { opt: true }],
    ['AP.Art.koch', F, 4, { opt: true }], ['AP.Art.sierpinski', F, 7, { opt: true }], ['AP.Art.lissajous', F, 11, { opt: true }],
    ['AP.Art.phyllo', F, 8, { opt: true }], ['AP.Art.glowStroke', F, 4, { opt: true }]
  ]);
  // §2.18 AUDIO
  add('AUDIO', 'load', [
    ['AP.Audio', O], ['AP.Audio.init', F], ['AP.Audio.unlock', F], ['AP.Audio.sfx', F, 1], ['AP.Audio.has', F, 1], ['AP.Audio.music', F, 1],
    ['AP.Audio.setIntensity', F, 1], ['AP.Audio.duck', F, 2], ['AP.Audio.setLoop', F, 2], ['AP.Audio.setVolumes', F, 1], ['AP.Audio.tick', F],
    ['AP.Audio.suspend', F], ['AP.Audio.resume', F]
  ]);
  add('AUDIO', 'boot', [['AP.Audio.ready', B]]);
  // §2.19 UI
  add('UI', 'load', [
    ['AP.HUD', O], ['AP.HUD.render', F, 2], ['AP.HUD.onLevelStart', F, 1], ['AP.HUD.onLevelEnd', F, 1],
    ['AP.Meta', O], ['AP.Meta.init', F], ['AP.Meta.toast', F, 1], ['AP.Meta.unlock', F, 1], ['AP.Meta.renderToasts', F, 1],
    ['AP.Cosmetics', O], ['AP.Cosmetics.playerStyle', F, 1], ['AP.Cosmetics.drawTrail', F, 2],
    ['AP.UI', O], ['AP.UI.drawTransition', F, 4], ['AP.Theorems', A, 0, { minLength: 24 }]
  ]);
  // §2.20 W1
  add('W1', 'load', [['AP.Endless', O], ['AP.Endless.generate', F, 2], ['AP.Endless.dailySeed', F]]);
  // §5
  add('CORE', 'load', [
    ['AP.Worlds', O], ['AP.Worlds.list', A], ['AP.Worlds.styles', O], ['AP.Worlds.get', F, 1], ['AP.Worlds.pal', F, 1], ['AP.Worlds.types', O]
  ]);

  // ---------------------------------------------------------------- verbatim tables (§2.2, §5)
  const VERBATIM = {
    'AP.TILE': { EMPTY: 0, SOLID: 1, ONEWAY: 2, SPIKE_U: 3, SPIKE_D: 4, SPIKE_L: 5, SPIKE_R: 6, BREAK: 7, FAKE: 8 },
    'AP.TILE_CHARS': { '.': 0, '#': 1, '=': 2, '^': 3, v: 4, '<': 5, '>': 6, '+': 7, '%': 8 },
    'AP.ENTITY_CHARS': { P: 'player', E: 'exit', V: 'vertex', C: 'checkpoint', '*': 'shard', '1': 'gem', '2': 'gem', '3': 'gem', B: 'bounce', S: 'sign', O: 'node', '~': 'crumble' },
    'AP.FORMS': [3, 4, 5, 6, 99],
    'AP.FORM_NAMES': { 3: 'Triangle', 4: 'Square', 5: 'Pentagon', 6: 'Hexagon', 99: 'Circle' },
    'AP.ACTIONS': ['left', 'right', 'up', 'down', 'jump', 'dash', 'orbit', 'pause', 'confirm', 'back', 'retry'],
    'AP.SFX': ['jump', 'jump2', 'walljump', 'land', 'step', 'dash', 'refill', 'orbit', 'fling', 'burst',
      'death', 'respawn', 'bounce', 'stomp', 'shard', 'gem', 'checkpoint', 'secret', 'vertex', 'portal', 'complete',
      'crumble', 'break', 'shoot', 'laser', 'charge', 'pulse', 'chime', 'grow', 'split', 'hit', 'explode', 'whoosh',
      'rumble', 'gust', 'bossHit', 'bossPhase', 'bossRoar', 'bossDeath',
      'uiMove', 'uiSelect', 'uiBack', 'uiDeny', 'pause', 'unpause', 'toast', 'type'],
    'AP.LOOPS': ['wind', 'hum', 'void'],
    'AP.MUSIC': {
      title: { bpm: 84, meter: 5 }, map: { bpm: 90, meter: 4 },
      w1: { bpm: 112, meter: 3 }, boss1: { bpm: 132, meter: 3 },
      w2: { bpm: 96, meter: 4 }, boss2: { bpm: 116, meter: 4 },
      w3: { bpm: 100, meter: 5 }, boss3: { bpm: 120, meter: 5 },
      w4: { bpm: 168, meter: 6 }, boss4: { bpm: 192, meter: 6 },
      w5: { bpm: 120, meter: 4, poly: [3, 4, 5] }, boss5: { bpm: 128, meter: 4, poly: [3, 4, 5] },
      endless: { bpm: 120, meter: 4 }, ending: { bpm: 72, meter: 4 }, credits: { bpm: 96, meter: 4 }
    },
    'AP.STYLES': ['title', 'map', 'w1', 'w2', 'w3', 'w4', 'w5', 'endless', 'void'],
    'AP.EVENTS': ['level:start', 'level:complete', 'level:quit', 'player:jump', 'player:land',
      'player:dash', 'player:orbit', 'player:fling', 'player:death', 'player:respawn', 'checkpoint',
      'collect:shard', 'collect:gem', 'secret:found', 'tile:changed', 'boss:start', 'boss:phase', 'boss:hit',
      'boss:defeat', 'form:gain', 'beat', 'bar', 'theorem', 'settings:changed', 'scene:change',
      'endless:segment', 'endless:end'],
    'AP.Worlds.styles': {
      title: { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' },
      map: { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' },
      w1: { bg: '#0F1630', primary: '#39D3C3', accent: '#FFC857', hazard: '#FF4F6D', ink: '#EAF2FF' },
      w2: { bg: '#120A24', primary: '#9B7BFF', accent: '#5EF2FF', hazard: '#FF6B3D', ink: '#F4EDFF' },
      w3: { bg: '#061723', primary: '#4EA8FF', accent: '#FFE27A', hazard: '#FF4F8B', ink: '#E8FBFF' },
      w4: { bg: '#0C1A10', primary: '#7EDC6A', accent: '#FF9ED8', hazard: '#FF7A2F', ink: '#F1FFE8' },
      w5: { bg: '#0B0912', primary: '#E9DFC7', accent: '#FFC94A', hazard: '#FF3E9A', ink: '#FFFFFF' },
      endless: { bg: '#050508', primary: '#FFFFFF', accent: '#7CF7D4', hazard: '#FF4D6D', ink: '#FFFFFF' },
      void: { bg: '#000000', primary: '#F5F5F5', accent: '#8A7CFF', hazard: '#FF2E63', ink: '#FFFFFF' }
    },
    'AP.Worlds.list': [
      { n: 1, id: 'w1', name: 'The Lattice', art: 'truchet', form: 3, reward: 4, levels: 3, style: 'w1', music: 'w1', boss: 'w1-boss', bossType: 'w1.tessellator', bossName: 'The Tessellator', bossStyle: 'w1', bossMusic: 'boss1', shared: [] },
      { n: 2, id: 'w2', name: 'Voronoi Caverns', art: 'voronoi', form: 4, reward: 5, levels: 4, style: 'w2', music: 'w2', boss: 'w2-boss', bossType: 'w2.monarch', bossName: 'Crystal Monarch', bossStyle: 'w2', bossMusic: 'boss2', shared: [] },
      { n: 3, id: 'w3', name: 'The Currents', art: 'flow', form: 5, reward: 6, levels: 5, style: 'w3', music: 'w3', boss: 'w3-boss', bossType: 'w3.maelstrom', bossName: 'Maelstrom', bossStyle: 'w3', bossMusic: 'boss3', shared: [] },
      { n: 4, id: 'w4', name: 'Fractal Gardens', art: 'fractal', form: 6, reward: 99, levels: 6, style: 'w4', music: 'w4', boss: 'w4-boss', bossType: 'w4.recursion', bossName: 'The Recursion', bossStyle: 'w4', bossMusic: 'boss4', shared: [] },
      { n: 5, id: 'w5', name: 'Harmonic Spire', art: 'harmonic', form: 99, reward: 0, levels: 6, style: 'w5', music: 'w5', boss: 'w5-boss', bossType: 'w5.null', bossName: 'The Null', bossStyle: 'void', bossMusic: 'boss5', shared: [] }
    ],
    'AP.Worlds.types': {
      common: ['player', 'checkpoint', 'exit', 'shard', 'gem', 'sign', 'bounce', 'crumble', 'node', 'vertex', 'mover',
        'secretwall', 'trigger', 'camzone', 'killzone', 'text', 'missing'],
      w1: ['w1.crawler', 'w1.bouncer', 'w1.saw', 'w1.tessellator'],
      w2: ['w2.mite', 'w2.turret', 'w2.bolt', 'w2.geode', 'w2.monarch'],
      w3: ['w3.wind', 'w3.drift', 'w3.drifter', 'w3.kite', 'w3.maelstrom'],
      w4: ['w4.vine', 'w4.thorn', 'w4.sierp', 'w4.fruit', 'w4.recursion'],
      w5: ['w5.wave', 'w5.laser', 'w5.ring', 'w5.null']
    }
  };

  // §2.16 common types (CORE) and §5 required world types: expected def properties
  const TYPES = [
    ['player', 'CORE', { kind: 'actor', anchor: 'floor' }], ['checkpoint', 'CORE', { kind: 'sensor', anchor: 'floor' }],
    ['exit', 'CORE', { kind: 'sensor', anchor: 'floor' }], ['shard', 'CORE', { kind: 'sensor', anchor: 'center' }],
    ['gem', 'CORE', { kind: 'sensor', anchor: 'center' }], ['sign', 'CORE', { kind: 'sensor', anchor: 'floor' }],
    ['bounce', 'CORE', { kind: 'sensor', anchor: 'floor', lint: 'bounce' }], ['crumble', 'CORE', { kind: 'solid', anchor: 'tile', lint: 'stand' }],
    ['node', 'CORE', { kind: 'sensor', anchor: 'center', lint: 'orbit', orbitNode: true }], ['vertex', 'CORE', { kind: 'sensor', anchor: 'center' }],
    ['mover', 'CORE', { kind: 'solid', anchor: 'tile', lint: 'mover', required: ['path'] }], ['secretwall', 'CORE', { kind: 'sensor' }],
    ['trigger', 'CORE', { kind: 'sensor', anchor: 'tile', required: ['event'] }], ['camzone', 'CORE', { kind: 'sensor', anchor: 'tile' }],
    ['killzone', 'CORE', { kind: 'sensor', anchor: 'tile', lint: 'hazard', hazard: true }], ['text', 'CORE', {}], ['missing', 'CORE', { kind: 'sensor' }],
    ['w1.crawler', 'W1', { kind: 'actor', hazard: true, stompable: true, dashable: true, burstable: true, lint: 'ignore' }],
    ['w1.bouncer', 'W1', { kind: 'actor', hazard: true, stompable: true, dashable: true, burstable: true, lint: 'ignore' }],
    ['w1.saw', 'W1', { kind: 'sensor', hazard: true, stompable: false, lint: 'ignore', required: ['path'] }],
    ['w1.tessellator', 'W1', { boss: true, lint: 'ignore' }],
    ['w2.mite', 'W2', { kind: 'actor', hazard: true, dashable: true, burstable: true, lint: 'ignore' }],
    ['w2.turret', 'W2', { kind: 'solid', lint: 'solid' }], ['w2.bolt', 'W2', { kind: 'sensor', hazard: true, lint: 'ignore' }],
    ['w2.geode', 'W2', { kind: 'solid', lint: 'solid' }], ['w2.monarch', 'W2', { boss: true, lint: 'ignore' }],
    ['w3.wind', 'W3', { kind: 'sensor', lint: 'ignore', required: ['w', 'h'] }], ['w3.drift', 'W3', { kind: 'solid', oneWay: true, lint: 'stand' }],
    ['w3.drifter', 'W3', { kind: 'actor', hazard: true, stompable: true, burstable: true, dashable: true, lint: 'ignore' }],
    ['w3.kite', 'W3', { kind: 'solid', oneWay: true, lint: 'stand' }], ['w3.maelstrom', 'W3', { boss: true, lint: 'ignore' }],
    ['w4.vine', 'W4', { kind: 'sensor', lint: 'ignore' }], ['w4.thorn', 'W4', { kind: 'sensor', hazard: true, lint: 'hazard' }],
    ['w4.sierp', 'W4', { kind: 'actor', hazard: true, stompable: true, dashable: true, burstable: true, lint: 'ignore' }],
    ['w4.fruit', 'W4', { kind: 'sensor', lint: 'ignore' }], ['w4.recursion', 'W4', { boss: true, lint: 'ignore' }],
    ['w5.wave', 'W5', { kind: 'sensor', lint: 'stand' }], ['w5.laser', 'W5', { kind: 'sensor', lint: 'ignore' }],
    ['w5.ring', 'W5', { kind: 'sensor', lint: 'ignore' }], ['w5.null', 'W5', { boss: true, lint: 'ignore' }]
  ];
  const BOSS_HOOKS = ['init', 'update', 'render', 'onRespawn', 'debugDamage'];

  const SCENES = [
    ['devmenu', 'CORE'], ['level', 'CORE'],
    ['title', 'UI'], ['intro', 'UI'], ['map', 'UI'], ['results', 'UI'], ['ending', 'UI'], ['credits', 'UI'],
    ['theorems', 'UI'], ['cosmetics', 'UI'], ['pause', 'UI'], ['settings', 'UI'], ['remap', 'UI'],
    ['endless', 'W1']
  ];

  // ---------------------------------------------------------------- checking
  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v) || (v && typeof v.length === 'number' && typeof v === 'object' && /Array\]$/.test(Object.prototype.toString.call(v)) && !/Uint8Array|Float|Int/.test(Object.prototype.toString.call(v)))) return 'array';
    return typeof v;
  }
  function isArrayLike(v) { return Array.isArray(v) || (v && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Array]'); }
  function same(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a !== 'object') return false;
    const aa = isArrayLike(a), bb = isArrayLike(b);
    if (aa !== bb) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of kb) if (!Object.prototype.hasOwnProperty.call(a, k) || !same(a[k], b[k])) return false;
    return true;
  }
  function diffKeys(actual, expected) {
    const out = [];
    for (const k of Object.keys(expected)) if (!actual || !same(actual[k], expected[k])) out.push(k);
    if (actual && typeof actual === 'object') for (const k of Object.keys(actual)) if (!Object.prototype.hasOwnProperty.call(expected, k)) out.push('+' + k);
    return out;
  }

  // ctx: {AP, L (level or null), owners: Set|null (null = all), booted, strict}
  // → [{level, owner, path, msg}]
  function check(ctx) {
    const out = [];
    const AP = ctx.AP;
    const want = o => !ctx.owners || ctx.owners.has(o);
    const issue = (level, owner, path, msg) => out.push({ level, owner, path, msg });
    let rng = null;
    try { rng = AP && typeof AP.RNG === 'function' ? AP.RNG(1) : null; } catch (e) { rng = null; }
    const L = ctx.L || null;
    const roots = {
      AP: AP,
      Entity: AP && AP.Entities ? AP.Entities.proto : undefined,
      Camera: AP && typeof AP.Camera === 'function' ? AP.Camera.prototype : undefined,
      RNG: rng, L: L, P: L ? L.player : undefined, cam: L ? L.cam : undefined
    };
    for (const e of M) {
      if (!want(e.owner)) continue;
      if (e.when === 'boot' && !ctx.booted) continue;
      if (e.when === 'level' && !L) continue;
      const parts = e.path.split(/[.#]/);
      let v = roots[parts[0]];
      let parent = null;
      let missingAt = null;
      for (let i = 1; i < parts.length; i++) {
        if (v === null || v === undefined) { missingAt = parts.slice(0, i).join('.'); break; }
        parent = v;
        v = v[parts[i]];
      }
      const sev = e.opt ? 'warn' : 'error';
      if (missingAt || v === undefined) {
        issue(sev, e.owner, e.path, (missingAt ? missingAt + ' is missing' : 'missing') + (e.opt ? ' (optional)' : ''));
        continue;
      }
      if (e.type === ANY) continue;
      if (v === null) { if (!e.nullable) issue(sev, e.owner, e.path, 'is null (expected ' + e.type + ')'); continue; }
      const t = e.type === A ? (isArrayLike(v) ? A : typeof v) : typeof v;
      if (t !== e.type) { issue(sev, e.owner, e.path, 'is ' + (isArrayLike(v) ? 'an array' : typeof v) + ', expected ' + e.type); continue; }
      if (e.type === F && v.length < e.arity) issue(ctx.strict ? 'error' : 'warn', e.owner, e.path, 'declares ' + v.length + ' parameter' + (v.length === 1 ? '' : 's') + ', the contract signature needs at least ' + e.arity);
      if (e.equals !== undefined && v !== e.equals) issue('error', e.owner, e.path, 'is ' + v + ', expected ' + e.equals);
      if (e.minLength !== undefined && v.length < e.minLength) issue('error', e.owner, e.path, 'has ' + v.length + ' entries, expected at least ' + e.minLength);
    }
    // verbatim tables
    if (AP && want('CORE')) {
      const C = AP.C;
      if (C) {
        let FALLBACK_C = null;
        try { FALLBACK_C = require('./lib/sim').FALLBACK_C; } catch (e) { FALLBACK_C = null; }
        if (FALLBACK_C) {
          const d = diffKeys(C, FALLBACK_C);
          if (d.length) issue('error', 'CORE', 'AP.C', 'differs from CONTRACT §2.2 at ' + d.join(', '));
          if (!Object.isFrozen(C)) issue('warn', 'CORE', 'AP.C', 'is not frozen (§2.2 uses Object.freeze)');
        }
      }
      for (const k of Object.keys(VERBATIM)) {
        const parts = k.split('.');
        let v = AP;
        for (let i = 1; i < parts.length && v; i++) v = v[parts[i]];
        if (v === undefined) continue;
        if (!same(v, VERBATIM[k])) {
          const d = isArrayLike(VERBATIM[k]) ? (isArrayLike(v) ? arrayDiff(v, VERBATIM[k]) : 'not an array') : diffKeys(v, VERBATIM[k]).join(', ');
          issue('error', 'CORE', k, 'is not VERBATIM (' + d + ')');
        }
      }
      if (AP.U && typeof AP.U.t === 'function' && AP.U.t(2) !== 64) issue('error', 'CORE', 'AP.U.t', 'U.t(2) should be 64');
    }
    // entity types
    const E = AP && AP.Entities;
    if (E && typeof E.get === 'function') {
      for (const [type, owner, exp] of TYPES) {
        if (!want(owner)) continue;
        const def = E.get(type);
        if (!def) { issue(ctx.strict || owner === 'CORE' ? 'error' : 'warn', owner, 'type ' + type, 'is not registered'); continue; }
        for (const k of Object.keys(exp)) {
          const a = def[k];
          const b = exp[k];
          if (k === 'required') { for (const r of b) if (!isArrayLike(a) || Array.prototype.indexOf.call(a, r) < 0) issue('error', owner, 'type ' + type, 'def.required must include "' + r + '"'); continue; }
          if (typeof b === 'boolean' ? !!a !== b : a !== b) issue('error', owner, 'type ' + type, 'def.' + k + ' is ' + JSON.stringify(a) + ', CONTRACT ' + (owner === 'CORE' ? '§2.16' : '§5') + ' says ' + JSON.stringify(b));
        }
        if (exp.boss) {
          if (!def.bossName) issue('error', owner, 'type ' + type, 'boss def needs bossName');
          if (!(def.phases >= 2)) issue('error', owner, 'type ' + type, 'boss def needs phases ≥ 2 (has ' + def.phases + ')');
          for (const hk of BOSS_HOOKS) if (typeof def[hk] !== 'function') issue('error', owner, 'type ' + type, 'boss def needs hook ' + hk);
        }
      }
    }
    // scenes
    const SC = AP && AP.Scenes;
    if (SC && typeof SC.has === 'function') {
      for (const [name, owner] of SCENES) {
        if (!want(owner)) continue;
        if (!SC.has(name)) issue(ctx.strict || owner === 'CORE' ? 'error' : 'warn', owner, 'scene ' + name, 'is not registered');
      }
    }
    return out;
  }
  function arrayDiff(a, b) {
    const sa = new Set(Array.from(a)), sb = new Set(b);
    const miss = b.filter(x => !sa.has(x)), extra = Array.from(a).filter(x => !sb.has(x));
    const parts = [];
    if (miss.length) parts.push('missing ' + miss.join(', '));
    if (extra.length) parts.push('extra ' + extra.join(', '));
    if (!parts.length) parts.push('order differs');
    return parts.join('; ');
  }

  // Loads + boots the game in the harness and starts a level for the 'level' entries.
  function checkLoaded(h, opts) {
    opts = opts || {};
    const harness = require('./lib/harness');
    const boot = harness.ensureBoot(h);
    const AP = h.AP;
    let L = null, levelNote = '';
    const needLevel = !opts.owners || opts.owners.has('CORE');
    if (needLevel && AP && AP.Test && typeof AP.Test.startLevel === 'function') {
      try {
        const mark = h.mark();
        const lvl = { id: 'test-manifest', world: 0, form: 99, map: manifestMap(), legend: {}, entities: [], signs: [] };
        L = AP.Test.startLevel(lvl, { form: 99, mode: 'test' });
        h.step(2);
        const errs = h.errorsSince(mark);
        if (errs.length) levelNote = 'starting a test level reported: ' + errs.map(harness.fmtError).join(' | ');
      } catch (e) { levelNote = 'AP.Test.startLevel threw: ' + e.message; L = null; }
    } else if (needLevel) levelNote = 'AP.Test.startLevel unavailable: level/player/camera entries not checked';
    const issues = check({ AP, L, owners: opts.owners || null, booted: boot.booted, strict: !!opts.strict });
    return { issues, bootNote: boot.note, levelNote };
  }
  function manifestMap() {
    const rows = [];
    for (let y = 0; y < 17; y++) {
      let r = '';
      for (let x = 0; x < 30; x++) r += (x === 0 || x === 29 || y === 0 || y >= 15) ? '#' : '.';
      rows.push(r);
    }
    rows[14] = '#P..........................E#';
    return rows;
  }

  function run(argv) {
    const cli = require('./lib/cli');
    const args = cli.parseArgs(argv, { check: 'bool', owner: 'string', strict: 'bool', json: 'bool' });
    if (!args.check) {
      if (args.json) { console.log(JSON.stringify({ symbols: M, verbatim: Object.keys(VERBATIM), types: TYPES.map(t => ({ type: t[0], owner: t[1], expect: t[2] })), scenes: SCENES }, null, 1)); return 0; }
      const by = {};
      for (const e of M) by[e.owner] = (by[e.owner] || 0) + 1;
      console.log('CONTRACT manifest: ' + M.length + ' symbols (' + Object.keys(by).map(o => o + ' ' + by[o]).join(', ') + '), ' +
        Object.keys(VERBATIM).length + ' verbatim tables, ' + TYPES.length + ' entity types, ' + SCENES.length + ' scenes. Use --check to verify the game, --json to dump.');
      return 0;
    }
    const harness = require('./lib/harness');
    const h = harness.create({ gl: 'stub', boot: false });
    const owners = args.owner ? new Set([args.owner.toUpperCase()]) : null;
    const r = checkLoaded(h, { owners, strict: args.strict });
    const rep = new cli.Report('contract-manifest' + (args.owner ? ' --owner ' + args.owner : ''));
    if (r.bootNote) rep.warn('boot', r.bootNote);
    if (r.levelNote) rep.warn('level', r.levelNote);
    for (const i of r.issues) rep.add(i.level, '[' + i.owner + '] ' + i.path, i.msg);
    if (args.json) console.log(JSON.stringify(r.issues, null, 1));
    else { rep.print(); console.log(rep.summary()); }
    return rep.errors ? 1 : 0;
  }

  module.exports = { MANIFEST: M, VERBATIM, TYPES, SCENES, BOSS_HOOKS, check, checkLoaded, run };
  if (require.main === module) require('./lib/cli').runMain(run);
})();
