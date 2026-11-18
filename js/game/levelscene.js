/* js/game/levelscene.js — owner: CORE */
(function (AP) {
  'use strict';

  // Scene 'level' and the level instance L (also AP.level). Step order: CONTRACT section 2.12 (mandatory).
  var C = AP.C;
  var M = AP.M;
  var T = AP.TILE;
  var TAU = Math.PI * 2;
  var pt = { x: 0, y: 0 };
  var box = { x: 0, y: 0 };
  var tileEvt = { tx: 0, ty: 0, old: 0, code: 0 };
  var bgP = { t: 0, camX: 0, camY: 0, w: 960, h: 540, intensity: 0.4, beat: 0, phase: 0, pal: null, seed: 0, quality: null };
  var midP = { t: 0, camX: 0, camY: 0, L: null, pal: null, quality: null, intensity: 0.4, beat: 0 };
  var spikeR = [0, 0, 0, 0];

  var FORM_CARD = {
    4: { title: 'FOUR — SQUARE', hint: 'The square stands firm. Slide down walls; press {jump} against one to leap away.' },
    5: { title: 'FIVE — PENTAGON', hint: 'The pentagon hides a star. Press {jump} in mid-air to jump again.' },
    6: { title: 'SIX — HEXAGON', hint: 'The hexagon tiles the world. Press {dash} to dash in any direction; dashes break cracked blocks.' },
    99: { title: '∞ — CIRCLE', hint: 'Infinitely many sides. Hold {orbit} near a node to orbit it; let go to fly.' }
  };

  function settings() { return (AP.Save && AP.Save.data && AP.Save.data.settings) || {}; }
  function assist() { var a = settings().assist; return (a && a.on) ? a : null; }
  function godMode() { return !!(AP.Test && AP.Test.godMode); }

  // ================================================================ Level
  function Level(params) {
    params = params || {};
    this.params = params;
    var src = params.level || null;
    if (!src && params.id) src = AP.Levels.get(params.id);
    if (!src) {
      AP.warn('LevelScene: level "' + (params.id || '?') + '" is not registered; loading a fallback room.');
      src = AP.Levels.get('test-core') || { id: params.id || 'missing-level', world: 0, map: null };
    }
    var comp = AP.Levels.compile(src);
    var def = comp.def;
    this.def = def;
    this.id = def.id;
    this.mode = params.mode === 'endless' || params.mode === 'test' ? params.mode : 'story';
    this.world = def.world | 0;
    this.index = def.index | 0;
    this.boss = !!def.boss;
    this.name = def.name;
    var form = def.form;
    if (this.mode === 'test' && params.form !== undefined && AP.FORMS.indexOf(+params.form) >= 0) form = +params.form;
    this.form = form;
    this.style = def.style;
    this.music = def.music;
    this.pal = AP.R.pal(def.style);
    this.seed = AP.hash(this.id);
    this.rng = AP.RNG(this.seed);
    this.w = comp.w;
    this.h = comp.h;
    this.pw = comp.w * 32;
    this.ph = comp.h * 32;
    this.master = comp.tiles;
    this.tiles = new Uint8Array(comp.tiles);
    this.flow = def.flow ? AP.Flow.fromSpec(def.flow) : null;
    this.time = 0;
    this.stepN = 0;
    this.player = null;
    this.entities = [];
    this.actors = [];
    this.solids = [];
    this.nodes = [];
    this.pending = [];
    this.renderList = [];
    this.sortDirty = true;
    this.deadCount = 0;
    this.offs = [];
    this.cam = null;
    this.stats = { deaths: 0, shards: 0, shardsTotal: 0, gems: [false, false, false], secrets: 0 };
    this.flags = {};
    this.checkpoint = { x: 0, y: 0, index: -1 };
    this.cpCount = 0;
    this.bossInfo = null;
    this.bossEnt = null;
    this.bossDone = false;
    this.bossDoneT = 0;
    this.vertexT = -1;
    this.vertexOn = false;
    this.bossNoHitT = 0;
    this.watchdogShown = false;
    this.intensity = def.boss ? 0.55 : 0.35;
    this.sentIntensity = -1;
    this.ended = false;
    this.phase = 'play';
    this.deathT = 0;
    this.respawnT = 0;
    this.hitstopT = 0;
    this.covered = false;
    this.paused = null;
    this.exitSeq = null;
    this.inlineResults = null;
    this.assistUsed = false;
    this.playerMoved = false;
    this.firstMoveTime = -1;
    this.clearTime = 0;
    this.lastShardT = -9;
    this.shardChain = 0;
    this.tileArt = false;
    this.hudBroken = false;
    this.midBroken = false;
    this.gemOwned = [false, false, false];
    if (this.mode === 'story' && AP.Levels.has(this.id) && AP.Save && AP.Save.data && AP.Save.data.levels[this.id]) {
      var rec = AP.Save.data.levels[this.id];
      for (var g = 0; g < 3; g++) this.gemOwned[g] = !!(rec.gems && rec.gems[g]);
    }
    AP.level = this;
    this.cam = new AP.Camera(this);
    var cb = def.camera && def.camera.bounds;
    if (Array.isArray(cb) && cb.length >= 4) this.cam.setBounds(cb[0] * 32, cb[1] * 32, cb[2] * 32, cb[3] * 32);
    this.load(comp);
  }

  var L$ = Level.prototype;

  // ---------------------------------------------------------------- loading
  L$.load = function (comp) {
    var sp = comp.spawns;
    for (var i = 0; i < sp.length; i++) {
      var s = sp[i];
      var spec = {};
      for (var k in s.spec) if (Object.prototype.hasOwnProperty.call(s.spec, k)) spec[k] = s.spec[k];
      var e = this.createAt(s.type, s.tx, s.ty, spec);
      if (e && e.type === 'player' && !this.player) this.player = e;
    }
    if (!this.player) {
      AP.warn('Level "' + this.id + '" has no player spawn; placing one near the top-left.');
      var p = this.createAt('player', 2, 2, {});
      this.player = p;
    }
    if (this.pending.length) this.flushSpawns();
    var P = this.player;
    this.checkpoint.x = P.x + P.w / 2;
    this.checkpoint.y = P.y + P.h;
    this.checkpoint.index = -1;
    this.stats.shardsTotal = this.count('shard');
    this.cam.follow(P);
    this.cam.snap();
  };

  L$.createAt = function (type, tx, ty, spec) {
    var e = AP.Entities.create(type, spec || {});
    if (!e) return null;
    var anchor = e.def.anchor;
    AP.Entities.anchorPoint(anchor, tx, ty, pt);
    AP.Entities.fromAnchor(anchor, pt.x, pt.y, e.w, e.h, box);
    var x = box.x, y = box.y;
    if (e.kind !== 'sensor') { x = Math.round(x); y = Math.round(y); }
    e.x = x; e.y = y;
    e.px = x; e.py = y; e.rx = x; e.ry = y;
    e.tx = tx; e.ty = ty;
    e.homeX = x; e.homeY = y;
    if (e.def.init) this.hook(e, 'init', e.spec, this);
    if (e.broken) return null;
    this.addEntity(e);
    return e;
  };

  L$.addEntity = function (e) {
    e._order = this.entities.length ? this.entities[this.entities.length - 1]._order + 1 : 0;
    this.entities.push(e);
    if (e.kind === 'actor') this.actors.push(e);
    else if (e.kind === 'solid') this.solids.push(e);
    if (e.orbitNode) this.nodes.push(e);
    if (e.boss && !this.bossEnt) this.bossEnt = e;
    this.sortDirty = true;
  };

  L$.nextCheckpointIndex = function () { return this.cpCount++; };

  // guarded hook call: fn(e, a, b, c). A throwing hook quarantines the entity (the player is never removed).
  L$.hook = function (e, name, a, b, c) {
    var fn = e.def && e.def[name];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn(e, a, b, c);
    } catch (err) {
      AP.reportError(e.type + '.' + name, err);
      if (e !== this.player) {
        e.broken = true;
        if (!e.dead) this.remove(e);
      }
      return undefined;
    }
  };

  // ---------------------------------------------------------------- entity management
  L$.spawn = function (type, cx, cy, spec) {
    var e = AP.Entities.create(type, spec || {});
    if (!e) return null;
    var x = (+cx || 0) - e.w / 2, y = (+cy || 0) - e.h / 2;
    if (e.kind !== 'sensor') { x = Math.round(x); y = Math.round(y); }
    e.x = x; e.y = y; e.px = x; e.py = y; e.rx = x; e.ry = y;
    e.tx = (+cx || 0) / 32; e.ty = (+cy || 0) / 32;
    e.homeX = x; e.homeY = y;
    if (e.def.init) this.hook(e, 'init', e.spec, this);
    if (e.broken) return null;
    this.pending.push(e);
    return e;
  };

  L$.flushSpawns = function () {
    var p = this.pending;
    for (var i = 0; i < p.length; i++) {
      this.addEntity(p[i]);
      if (p[i].dead) this.deadCount++;
    }
    p.length = 0;
  };

  L$.remove = function (e) {
    if (!e || e.dead || e === this.player) return;
    e.dead = true;
    this.deadCount++;
  };

  L$.removeDead = function () {
    var es = this.entities;
    var passes = 0;
    while (this.deadCount > 0 && passes++ < 4) {
      this.deadCount = 0;
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (e.dead && !e._removed) {
          e._removed = true;
          if (e.def.onRemove) this.hook(e, 'onRemove', this);
        }
      }
    }
    this.deadCount = 0;
    compact(es);
    compact(this.actors);
    compact(this.solids);
    compact(this.nodes);
    if (this.bossEnt && this.bossEnt.dead) this.bossEnt = this.findBoss();
    this.sortDirty = true;
  };

  function compact(arr) {
    var w = 0;
    for (var i = 0; i < arr.length; i++) if (!arr[i].dead) arr[w++] = arr[i];
    arr.length = w;
  }

  L$.findBoss = function () {
    var es = this.entities;
    for (var i = 0; i < es.length; i++) if (es[i].boss && !es[i].dead) return es[i];
    for (var j = 0; j < this.pending.length; j++) if (this.pending[j].boss && !this.pending[j].dead) return this.pending[j];
    return null;
  };

  L$.count = function (type) {
    var n = 0, es = this.entities;
    for (var i = 0; i < es.length; i++) if (!es[i].dead && es[i].type === type) n++;
    return n;
  };

  L$.find = function (type) {
    var out = [], es = this.entities;
    for (var i = 0; i < es.length; i++) if (!es[i].dead && es[i].type === type) out.push(es[i]);
    return out;
  };

  L$.first = function (type) {
    var es = this.entities;
    for (var i = 0; i < es.length; i++) if (!es[i].dead && es[i].type === type) return es[i];
    return null;
  };

  L$.byTag = function (tag) {
    var out = [], es = this.entities;
    for (var i = 0; i < es.length; i++) if (!es[i].dead && es[i].tag === tag) out.push(es[i]);
    return out;
  };

  function matches(e, filter) {
    if (!filter) return true;
    if (typeof filter === 'function') return !!filter(e);
    if (typeof filter === 'string') return e.type === filter;
    return true;
  }

  L$.queryInto = function (out, x, y, w, h, filter) {
    out.length = 0;
    var es = this.entities;
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (e.dead) continue;
      if (e.x < x + w && e.x + e.w > x && e.y < y + h && e.y + e.h > y && matches(e, filter)) out.push(e);
    }
    return out;
  };

  L$.query = function (x, y, w, h, filter) { return this.queryInto([], x, y, w, h, filter); };

  L$.orbitNodes = function () { return this.nodes; };

  // double-jump pentagram: onBurst for burstable entities whose centre is within r of (cx, cy)
  L$.burst = function (cx, cy, r) {
    var P = this.player;
    var es = this.entities;
    var r2 = (r || C.BURST_RADIUS) * (r || C.BURST_RADIUS);
    var n = es.length;
    for (var i = 0; i < n; i++) {
      var e = es[i];
      if (e.dead || !e.burstable || !e.collidable || !e.active || e === P) continue;
      var dx = e.x + e.w / 2 - cx, dy = e.y + e.h / 2 - cy;
      if (dx * dx + dy * dy > r2) continue;
      if (e.def.onBurst) this.hook(e, 'onBurst', P, this);
      else this.defeat(e);
    }
  };

  // default reaction of stompable / dashable / burstable entities without a hook
  L$.defeat = function (e) {
    if (!e || e.dead) return false;
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    AP.FX.burst('hit', cx, cy, { color: this.pal.hazard });
    AP.FX.burst('explode', cx, cy, { n: 10 });
    AP.sfxAt('hit', cx, cy);
    this.remove(e);
    return true;
  };

  // ---------------------------------------------------------------- update (CONTRACT 2.12)
  L$.update = function (dt) {
    // 1. hitstop
    if (this.hitstopT > 0) {
      this.hitstopT -= dt;
      if (this.hitstopT < 1e-9) this.hitstopT = 0;
      return;
    }
    var es = this.entities;
    var P = this.player;
    var i, e;
    // 2. time and interpolation anchors
    this.time += dt;
    this.stepN++;
    for (i = 0; i < es.length; i++) { e = es[i]; e.px = e.x; e.py = e.y; }
    // 3. player
    if (P) { P.t += dt; this.hook(P, 'update', dt, this); }
    // 4. other entities in spawn order
    var n = es.length;
    for (i = 0; i < n; i++) {
      e = es[i];
      if (e === P || e.dead || !e.active) continue;
      e.t += dt;
      if (e.def.update) this.hook(e, 'update', dt, this);
    }
    // 5. contacts
    if (P && this.phase === 'play' && P.state !== 'dead') this.contacts(P);
    // 6. spikes and pits
    if (P && this.phase === 'play' && P.state !== 'dead' && !this.ended) {
      if (AP.Tilemap.rectHitsSpike(this, P.x, P.y, P.w, P.h)) this.killPlayer('spike');
      else if (P.y > this.ph + C.PIT_MARGIN) this.killPlayer('pit');
    }
    // 7. flush spawns
    if (this.pending.length) this.flushSpawns();
    // 8. remove dead
    if (this.deadCount > 0) this.removeDead();
    // 9. camera, FX, timers, death/respawn state machine
    this.cam.update(dt);
    AP.FX.update(dt);
    this.timers(dt);
    this.stateMachine(dt);
  };

  L$.contacts = function (P) {
    var es = this.entities;
    var n = es.length;
    var dashing = P.state === 'dash';
    for (var i = 0; i < n; i++) {
      var e = es[i];
      if (e === P || e.dead || !e.active) continue;
      if (!e.collidable) { e.touching = false; continue; }
      var ov;
      if (e.kind === 'solid') {
        ov = P.x <= e.x + e.w && P.x + P.w >= e.x && P.y <= e.y + e.h && P.y + P.h >= e.y &&
          !((P.x + P.w === e.x || P.x === e.x + e.w) && (P.y + P.h === e.y || P.y === e.y + e.h));
      } else {
        ov = P.x < e.x + e.w && P.x + P.w > e.x && P.y < e.y + e.h && P.y + P.h > e.y;
      }
      if (!ov) { e.touching = false; continue; }
      if (P.state === 'dead' || this.phase !== 'play') break;
      var first = !e.touching;
      e.touching = true;
      // (a) dash
      if (dashing && e.dashable && e._dash !== P.dashId) {
        e._dash = P.dashId;
        var rd = e.def.onDash ? this.hook(e, 'onDash', P, this) : this.defeat(e);
        if (rd === true) { this.hitstop(0.04); this.shake(3, 0.12); continue; }
      }
      // (b) stomp
      if (e.stompable && P.vy > 0 && P.prevBottom <= e.py + C.STOMP_TOL) {
        var rs = e.def.onStomp ? this.hook(e, 'onStomp', P, this) : this.defeat(e);
        if (rs === true) { this.stompBounce(P, e); continue; }
      }
      // (c) hazard
      if (e.hazard) {
        if (this.killPlayer(e.type)) break;
      }
      // (d) touch
      if (e.def.onTouch && P.state !== 'dead' && this.phase === 'play') this.hook(e, 'onTouch', P, this, first);
    }
  };

  L$.stompBounce = function (P, e) {
    var I = AP.Input;
    var held = I.held('jump') || I.buffered('jump', C.JUMP_BUFFER);
    P.launch(null, -(held ? C.STOMP_V_HELD : C.STOMP_V), { refresh: true, noCut: true });
    var cx = P.x + P.w / 2, by = P.y + P.h;
    AP.FX.burst('hit', cx, by, { n: 6 });
    AP.FX.ring(cx, by, 4, 30, 0.22, this.pal.ink, 2);
    AP.sfxAt('stomp', cx, by);
    this.hitstop(0.04);
    this.shake(3, 0.12);
    P.vis.sx = 1.3; P.vis.sy = 0.72;
  };

  L$.timers = function (dt) {
    // assist bookkeeping
    var a = assist();
    if (a && (a.speed < 1 || a.invincible || a.infiniteAir)) this.assistUsed = true;
    // intensity -> audio
    if (Math.abs(this.intensity - this.sentIntensity) > 0.01) {
      this.sentIntensity = this.intensity;
      AP.call('Audio.setIntensity', M.clamp(this.intensity, 0, 1));
    }
    // boss watchdog and vertex activation
    if (this.bossInfo && !this.bossDone) {
      this.bossNoHitT += dt;
      if (this.bossNoHitT > 180 && !this.watchdogShown) {
        this.watchdogShown = true;
        AP.toast('Assist mode can skip this fight', 'Pause → Assist → Skip level');
      }
    }
    if (this.vertexT > 0) {
      this.vertexT -= dt;
      if (this.vertexT <= 0) { this.vertexT = -1; this.activateVertex(); }
    }
    if (this.bossDone && this.bossInfo) {
      this.bossDoneT += dt;
      if (this.bossDoneT > 2.2) this.bossInfo = null;
    }
  };

  L$.stateMachine = function (dt) {
    var P = this.player;
    if (this.phase === 'dead') {
      this.deathT += dt;
      if (this.deathT >= C.DEATH_TIME) this.beginRespawn();
    } else if (this.phase === 'respawn') {
      this.respawnT += dt;
      if (this.respawnT >= C.RESPAWN_TIME) {
        this.phase = 'play';
        if (P) {
          P.respawnDone();
          var cx = P.x + P.w / 2, cy = P.y + P.h / 2;
          AP.FX.burst('respawn', cx, cy);
        }
      }
    }
    if (this.exitSeq) this.exitUpdate(dt);
    if (this.inlineResults) {
      var r = this.inlineResults;
      r.t += dt;
      if (r.t > 2 || (r.t > 0.5 && AP.Input.pressed('confirm'))) this.inlineNext();
    }
  };

  // ---------------------------------------------------------------- death and respawn
  L$.killPlayer = function (cause) {
    var P = this.player;
    if (!P || this.ended || this.phase !== 'play' || P.state === 'dead' || P.state === 'respawn') return false;
    cause = cause || 'hazard';
    var forced = cause === 'pit' || cause === 'crush' || cause === 'retry';
    var a = assist();
    var inv = !!(a && a.invincible);
    var god = godMode();
    if (!forced && (P.invuln > 0 || inv || god)) return false;
    var counts = cause === 'retry' || !(inv || god);
    var x = P.x + P.w / 2, y = P.y + P.h / 2;
    var form = P.form, rot = P.vis ? P.vis.rot : 0;
    this.phase = 'dead';
    this.deathT = 0;
    if (counts) {
      this.stats.deaths++;
      if (AP.Save && AP.Save.stat) AP.Save.stat('deaths');
    }
    P.die(cause);
    AP.FX.burst('death', x, y, { form: form, rot: rot, r: 13, color: this.pal.ink });
    AP.sfxAt('death', x, y);
    AP.call('Audio.duck', 0.55, 0.7);
    this.shake(9, 0.32);
    this.flash(this.pal.hazard, 0.14, 0.22);
    this.hitstop(0.05);
    var es = this.entities;
    var n = es.length;
    for (var i = 0; i < n; i++) {
      var e = es[i];
      if (e !== P && !e.dead && e.def.onPlayerDeath) this.hook(e, 'onPlayerDeath', this);
    }
    this.emit('player:death', { cause: cause, x: x, y: y });
    return true;
  };

  L$.beginRespawn = function () {
    var P = this.player;
    if (!P) return;
    var cp = this.checkpoint;
    var x = Math.round(cp.x - P.w / 2), y = Math.round(cp.y - P.h);
    P.respawnAt(x, y);
    // never respawn inside geometry (e.g. a boss changed the tiles)
    if (P.collideAt(0, 0)) {
      for (var k = 1; k <= 64; k++) { if (!P.collideAt(0, -k)) { P.setPos(x, y - k); break; } }
    }
    this.phase = 'respawn';
    this.respawnT = 0;
    var es = this.entities;
    var n = es.length;
    for (var i = 0; i < n; i++) {
      var e = es[i];
      if (e !== P && !e.dead && e.def.onRespawn) this.hook(e, 'onRespawn', this);
    }
    if (this.pending.length) this.flushSpawns();
    var dx = (P.x + P.w / 2) - this.cam.cx(), dy = (P.y + P.h / 2) - this.cam.cy();
    this.cam.follow(P);
    if (dx * dx + dy * dy > 1100 * 1100) this.cam.snap();
    AP.sfxAt('respawn', P.x + P.w / 2, P.y + P.h / 2);
    this.emit('player:respawn', { x: P.x + P.w / 2, y: P.y + P.h / 2 });
  };

  L$.setCheckpoint = function (cx, by, index) {
    var cp = this.checkpoint;
    var changed = cp.index !== index || cp.x !== cx || cp.y !== by;
    cp.x = cx;
    cp.y = by;
    cp.index = index === undefined ? cp.index : index;
    if (changed) this.emit('checkpoint', { index: cp.index, x: cx, y: by });
    return changed;
  };

  L$.retry = function () {
    if (this.ended || this.phase !== 'play') return false;
    return this.killPlayer('retry');
  };

  L$.restart = function () {
    var params = {};
    for (var k in this.params) if (Object.prototype.hasOwnProperty.call(this.params, k)) params[k] = this.params[k];
    if (!params.level && this.def && !AP.Levels.has(this.id)) params.level = this.def;
    if (AP.Scenes.isTransitioning()) AP.Scenes.goNow('level', params);
    else AP.Scenes.go('level', params, { fx: 'iris', dur: 0.45 });
    return true;
  };

  L$.skipLevel = function () {
    var a = assist();
    if (!a || this.ended) return false;
    this.assistUsed = true;
    var W = this.boss ? AP.Worlds.get(this.world) : null;
    if (W) return this.completeLevel({ grantForm: W.reward, ending: W.n === 5, skipped: true });
    return this.completeLevel({ skipped: true });
  };

  L$.quit = function () {
    this.emit('level:quit', { id: this.id });
    if (typeof this.params.onQuit === 'function') {
      AP.guard('level.onQuit', this.params.onQuit);
      return true;
    }
    AP.Scenes.go('map', { focus: this.id }, { fx: 'fade', dur: 0.5 });
    return true;
  };

  L$.pause = function () {
    if (this.ended || this.paused) return false;
    if (AP.Scenes.has('pause')) {
      AP.Scenes.push('pause', { L: this });
      return true;
    }
    this.paused = { sel: 0, t: 0 };
    AP.sfx('pause');
    AP.call('Audio.duck', 0.4, 0.25);
    return true;
  };

  L$.refreshAir = function () { return this.player ? this.player.refresh() : false; };

  // ---------------------------------------------------------------- feedback helpers
  L$.shake = function (mag, dur) { this.cam.shake(mag, dur); };
  L$.kick = function (dx, dy) { this.cam.kick(dx, dy); };
  L$.hitstop = function (sec) {
    sec = Math.min(+sec || 0, C.HITSTOP_MAX);
    if (sec > this.hitstopT) this.hitstopT = sec;
  };
  L$.flash = function (color, dur, alpha) {
    return AP.R.flash(color || this.pal.ink, dur === undefined ? 0.15 : dur, alpha === undefined ? 0.6 : alpha);
  };

  // ---------------------------------------------------------------- tiles
  L$.tileAt = function (tx, ty) {
    if (tx < 0 || tx >= this.w || ty < 0) return T.SOLID;
    if (ty >= this.h) return T.EMPTY;
    return this.tiles[ty * this.w + tx];
  };

  L$.tileFree = function (tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    var P = this.player;
    if (!P) return true;
    var x = tx * 32, y = ty * 32, pad = 4;
    return !(P.x - pad < x + 32 && P.x + P.w + pad > x && P.y - pad < y + 32 && P.y + P.h + pad > y);
  };

  L$.setTile = function (tx, ty, code) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    code = code | 0;
    var i = ty * this.w + tx;
    var old = this.tiles[i];
    if (old === code) return false;
    this.tiles[i] = code;
    if (this.tileArt) AP.call('TileArt.invalidate', this, tx, ty);
    tileEvt.tx = tx; tileEvt.ty = ty; tileEvt.old = old; tileEvt.code = code;
    this.emit('tile:changed', tileEvt);
    if (code === T.SOLID || code === T.BREAK) this.unstick(tx * 32, ty * 32, 32, 32);
    return true;
  };

  // a solid appeared over the player: push up to 32u, else crush
  L$.unstick = function (x, y, w, h) {
    var P = this.player;
    if (!P || P.state === 'dead') return;
    if (!(P.x < x + w && P.x + P.w > x && P.y < y + h && P.y + P.h > y)) return;
    if (!P.collideAt(0, 0)) return;
    for (var k = 1; k <= 32; k++) {
      if (!P.collideAt(0, -k)) { P.y -= k; P.yRem = 0; return; }
    }
    this.killPlayer('crush');
  };

  L$.breakTile = function (tx, ty, cause) {
    if (this.tileAt(tx, ty) !== T.BREAK) return false;
    this.setTile(tx, ty, T.EMPTY);
    var cx = tx * 32 + 16, cy = ty * 32 + 16;
    AP.FX.burst('break', cx, cy);
    AP.sfxAt('break', cx, cy);
    this.shake(2.5, 0.12);
    return true;
  };

  L$.snapshotTiles = function () { return new Uint8Array(this.tiles); };

  L$.restoreTiles = function (snap) {
    if (!snap || snap.length !== this.tiles.length) return false;
    var t = this.tiles, w = this.w;
    var P = this.player;
    var crush = false;
    for (var i = 0; i < t.length; i++) {
      if (t[i] === snap[i]) continue;
      t[i] = snap[i];
      var tx = i % w, ty = (i - tx) / w;
      if (this.tileArt) AP.call('TileArt.invalidate', this, tx, ty);
      if ((snap[i] === T.SOLID || snap[i] === T.BREAK) && P && P.x < tx * 32 + 32 && P.x + P.w > tx * 32 && P.y < ty * 32 + 32 && P.y + P.h > ty * 32) crush = true;
    }
    tileEvt.tx = -1; tileEvt.ty = -1; tileEvt.old = -1; tileEvt.code = -1;
    this.emit('tile:changed', tileEvt);
    if (crush && P) this.unstick(P.x, P.y, P.w, P.h);
    return true;
  };

  L$.solidAt = function (x, y, w, h, ignore) { return AP.Phys.rectSolid(this, x, y, w, h, ignore); };
  L$.raycast = function (x0, y0, dx, dy, maxDist, out) { return AP.Phys.raycast(this, x0, y0, dx, dy, maxDist, out); };

  // ---------------------------------------------------------------- events (level-scoped)
  L$.on = function (name, fn) {
    var off = AP.Events.on(name, fn);
    this.offs.push(off);
    return off;
  };
  L$.emit = function (name, payload) { return AP.Events.emit(name, payload); };

  // ---------------------------------------------------------------- bosses (CONTRACT 2.17)
  L$.bossStart = function (e) {
    if (this.bossInfo || this.bossDone) return false;
    e = e || this.bossEnt || this.findBoss();
    if (!e) return false;
    this.bossEnt = e;
    var W = AP.Worlds.get(this.world);
    var name = (e.def && e.def.bossName) || (W && W.bossName) || 'Boss';
    this.bossInfo = { name: name, frac: 1, phase: 0, phases: (e.def && e.def.phases) || 1, entity: e };
    this.bossNoHitT = 0;
    var key = (W && W.bossMusic) || this.music;
    if (key) AP.music(key);
    if (this.intensity < 0.6) this.intensity = 0.6;
    AP.sfxAt('bossRoar', e.x + e.w / 2, e.y + e.h / 2);
    this.shake(6, 0.5);
    this.emit('boss:start', { id: this.id, type: e.type, name: name });
    return true;
  };

  L$.bossBar = function (frac, phase) {
    var bi = this.bossInfo;
    if (!bi) return;
    frac = M.clamp(+frac || 0, 0, 1);
    var e = bi.entity;
    var cx = e ? e.x + e.w / 2 : this.cam.cx(), cy = e ? e.y + e.h / 2 : this.cam.cy();
    if (frac < bi.frac - 1e-6) {
      bi.frac = frac;
      this.bossNoHitT = 0;
      AP.FX.burst('bossHit', cx, cy);
      AP.sfxAt('bossHit', cx, cy);
      this.hitstop(0.06);
      this.shake(6, 0.28);
      this.flash(this.pal.accent, 0.08, 0.16);
      this.emit('boss:hit', { id: this.id, frac: frac });
    } else {
      bi.frac = frac;
    }
    if (phase !== undefined && phase !== null && phase !== bi.phase) {
      bi.phase = phase;
      AP.sfxAt('bossPhase', cx, cy);
      this.shake(10, 0.5);
      this.flash(this.pal.ink, 0.2, 0.3);
      this.emit('boss:phase', { id: this.id, phase: phase });
    }
  };

  L$.bossDefeated = function (e) {
    if (this.bossDone) return false;
    this.bossDone = true;
    this.bossDoneT = 0;
    e = e || (this.bossInfo && this.bossInfo.entity) || this.bossEnt;
    if (this.bossInfo) this.bossInfo.frac = 0;
    var cx = e ? e.x + e.w / 2 : this.cam.cx(), cy = e ? e.y + e.h / 2 : this.cam.cy();
    AP.FX.burst('bossDeath', cx, cy);
    AP.sfxAt('bossDeath', cx, cy);
    this.hitstop(C.HITSTOP_MAX);
    this.shake(14, 1.1);
    this.flash(this.pal.ink, 0.35, 0.55);
    this.clearMinions();
    AP.music(null, { fade: 2.5 });
    this.intensity = 0.3;
    this.vertexT = 1.2;
    this.emit('boss:defeat', { id: this.id, time: this.time });
    return true;
  };

  L$.clearMinions = function () {
    var es = this.entities, n = 0;
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (e.dead || !e.minion) continue;
      AP.FX.burst('hit', e.x + e.w / 2, e.y + e.h / 2, { n: 4 });
      this.remove(e);
      n++;
    }
    for (var j = 0; j < this.pending.length; j++) if (this.pending[j].minion) { this.pending[j].dead = true; n++; }
    return n;
  };

  L$.activateVertex = function () {
    var vs = this.find('vertex');
    for (var j = 0; j < this.pending.length; j++) if (this.pending[j].type === 'vertex') vs.push(this.pending[j]);
    if (!vs.length) {
      var spot = this.freeSpot(this.pw / 2, this.ph / 2, 32, 32);
      var v = this.spawn('vertex', spot.x, spot.y, {});
      if (v) vs.push(v);
    }
    for (var i = 0; i < vs.length; i++) AP.Common.activateVertex(vs[i], this);
    this.vertexOn = true;
  };

  // nearest free w x h box centre to (cx, cy), searching outward on a 16u grid
  L$.freeSpot = function (cx, cy, w, h) {
    for (var r = 0; r < 40; r++) {
      for (var k = 0; k < Math.max(1, r * 8); k++) {
        var a = r === 0 ? 0 : k / (r * 8) * TAU;
        var x = cx + Math.cos(a) * r * 16, y = cy + Math.sin(a) * r * 16;
        if (x - w / 2 < 32 || y - h / 2 < 32 || x + w / 2 > this.pw - 32 || y + h / 2 > this.ph - 32) continue;
        if (!AP.Phys.rectSolid(this, x - w / 2, y - h / 2, w, h, null)) { pt.x = x; pt.y = y; return pt; }
      }
    }
    pt.x = cx; pt.y = cy;
    return pt;
  };

  // ---------------------------------------------------------------- completion
  // completeLevel({grantForm?, ending?, x?, y? (focus point of the exit), vertex?, skipped?})
  L$.completeLevel = function (opts) {
    if (this.ended) return false;
    opts = opts || {};
    this.ended = true;
    this.clearTime = this.time;
    var P = this.player;
    if (P && P.state !== 'dead') P.freeze(true);
    if (this.phase !== 'play') {
      // completing while dead/respawning (tests, skip): settle the player first
      if (P && P.state === 'dead') {
        var cp = this.checkpoint;
        P.respawnAt(Math.round(cp.x - P.w / 2), Math.round(cp.y - P.h));
      }
      if (P) { P.respawnDone(); P.freeze(true); }
      this.phase = 'play';
    }
    var save = AP.Save && AP.Save.data;
    var grant = +opts.grantForm || 0;
    var gain = this.mode === 'story' && grant > 0 && save && grant > (save.form | 0) && !!FORM_CARD[grant];
    var fx = opts.x !== undefined ? +opts.x : (P ? P.x + P.w / 2 : this.cam.cx());
    var fy = opts.y !== undefined ? +opts.y : (P ? P.y + P.h / 2 : this.cam.cy());
    this.exitSeq = {
      t: 0, opts: opts, gain: gain ? grant : 0, morphed: false,
      dur: gain ? 4.6 : (opts.vertex ? 1.3 : 0.8),
      fx: fx, fy: fy, sx: P ? P.x + P.w / 2 : fx, sy: P ? P.y + P.h / 2 : fy, done: false
    };
    AP.sfx('complete', { vol: 0.9 });
    if (!opts.vertex && P) AP.FX.burst('portal', fx, fy, { n: 18, radius: 50 });
    AP.call('Audio.duck', 0.35, 0.8);
    AP.call('HUD.onLevelEnd', this);
    return true;
  };

  L$.exitUpdate = function (dt) {
    var s = this.exitSeq;
    var P = this.player;
    s.t += dt;
    var k = M.clamp(s.t / (s.gain ? 0.9 : s.dur), 0, 1);
    if (P && !s.gain && !s.opts.vertex) {
      // sucked into the portal: spin, shrink and pull toward the exit centre
      var e = AP.M.ease.inCubic(k);
      P.exitScale = 1 - e;
      if (!P.exitPull) P.exitPull = { x: 0, y: 0 };
      P.exitPull.x = s.sx + (s.fx - s.sx) * AP.M.ease.outCubic(k);
      P.exitPull.y = s.sy + (s.fy - s.sy) * AP.M.ease.outCubic(k);
      P.vis.rot += dt * (6 + 30 * e);
    }
    if (s.gain) {
      if (!s.morphed && s.t >= 0.9) {
        s.morphed = true;
        if (P) {
          P.setForm(s.gain, { dur: 0.7 });
          var cx = P.x + P.w / 2, cy = P.y + P.h / 2;
          AP.FX.burst('vertex', cx, cy);
          AP.FX.ring(cx, cy, 8, 160, 0.9, this.pal.accent, 3);
          AP.sfx('grow');
          this.flash(this.pal.ink, 0.3, 0.45);
          this.shake(6, 0.4);
        }
      }
      if (s.t > 1.6 && (AP.Input.pressed('confirm') || AP.Input.pressed('jump'))) s.t = Math.max(s.t, s.dur);
    }
    if (s.t >= s.dur && !s.done) {
      s.done = true;
      this.finish();
    }
  };

  L$.finish = function () {
    var s = this.exitSeq || { opts: {} };
    var opts = s.opts || {};
    var P = this.player;
    var res = {
      id: this.id, world: this.world, index: this.index, name: this.name, mode: this.mode,
      time: this.clearTime, deaths: this.stats.deaths, shards: this.stats.shards, shardsTotal: this.stats.shardsTotal,
      gems: this.stats.gems.slice(), newBest: false, firstClear: false, assisted: !!(this.assistUsed || opts.skipped),
      formGained: 0, next: null, ending: !!opts.ending, unlocked: []
    };
    if (this.mode === 'story' && AP.Levels.has(this.id) && AP.Progress) {
      var pr = AP.Progress.complete(this.id, {
        time: res.time, deaths: res.deaths, shards: res.shards, shardsTotal: res.shardsTotal, gems: res.gems,
        assisted: res.assisted, grantForm: opts.grantForm, ending: opts.ending
      });
      if (pr) {
        res.firstClear = !!pr.firstClear;
        res.newBest = !!pr.newBest;
        res.formGained = pr.formGained | 0;
        res.ending = !!(pr.ending || res.ending);
        res.unlocked = pr.unlocked || [];
      }
      res.next = AP.Progress.next(this.id);
    }
    if (P && P.form) AP.Player.lastForm = res.formGained || P.form;
    if (res.formGained) this.emit('form:gain', { form: res.formGained });
    this.emit('level:complete', res);
    this.result = res;
    if (typeof this.params.onComplete === 'function') {
      AP.guard('level.onComplete', this.params.onComplete, res);
      return;
    }
    if (AP.Scenes.has('results')) {
      AP.Scenes.go('results', res, { fx: 'iris', dur: 0.6 });
      return;
    }
    this.inlineResults = { t: 0, res: res };
    AP.sfx('toast');
  };

  // fallback flow when UI is absent: next level, the ending, or the menu
  L$.inlineNext = function () {
    var r = this.inlineResults;
    if (!r || r.leaving) return;
    r.leaving = true;
    var res = r.res;
    if (res.ending) { AP.Scenes.go('ending', {}, { fx: 'fade', dur: 1 }); return; }
    if (this.mode === 'story' && res.next && AP.Levels.has(res.next) && AP.Progress.isUnlocked(res.next)) {
      AP.Scenes.go('level', { id: res.next, mode: 'story' }, { fx: 'iris', dur: 0.6 });
      return;
    }
    AP.Scenes.go('map', { focus: this.id, celebrate: true }, { fx: 'fade', dur: 0.5 });
  };

  // ---------------------------------------------------------------- rendering (CONTRACT 2.8 order)
  L$.sortRender = function () {
    var list = this.renderList;
    var es = this.entities;
    if (this.sortDirty) {
      list.length = 0;
      for (var i = 0; i < es.length; i++) list.push(es[i]);
      this.sortDirty = false;
    }
    // insertion sort by (layer, spawn order): stable and O(n) on nearly-sorted input
    for (var j = 1; j < list.length; j++) {
      var e = list[j];
      var k = j - 1;
      while (k >= 0 && (list[k].layer > e.layer || (list[k].layer === e.layer && list[k]._order > e._order))) { list[k + 1] = list[k]; k--; }
      list[k + 1] = e;
    }
    return list;
  };

  L$.renderEntity = function (ctx, e, cam) {
    if (e.dead || !e.visible || !e.def.render) return;
    if (!e.def.alwaysRender && !cam.visible(e.x, e.y, e.w, e.h, e.def.renderPad)) return;
    ctx.save();
    try {
      e.def.render(e, ctx, this);
    } catch (err) {
      AP.reportError(e.type + '.render', err);
      if (e !== this.player) { e.broken = true; this.remove(e); }
    }
    ctx.restore();
  };

  L$.render = function (ctx) {
    var R = AP.R;
    var cam = this.cam;
    if (this.pending.length) this.flushSpawns();
    var alpha = (this.hitstopT > 0 || this.covered || this.paused) ? 1 : AP.Time.alpha;
    cam.prepareRender(alpha);
    var es = this.entities;
    var i, e;
    for (i = 0; i < es.length; i++) {
      e = es[i];
      e.rx = e.px + (e.x - e.px) * alpha;
      e.ry = e.py + (e.y - e.py) * alpha;
    }
    // 1. background
    bgP.t = this.time;
    bgP.camX = cam.renderX;
    bgP.camY = cam.renderY;
    bgP.intensity = this.intensity;
    bgP.beat = AP.Beat.beat;
    bgP.phase = AP.Beat.phase;
    bgP.pal = this.pal;
    bgP.seed = this.seed;
    bgP.quality = R.quality;
    R.begin(ctx);
    R.drawBackground(this.style, bgP);
    // 2. midground (screen space)
    R.begin(ctx);
    if (R.quality.mid && !this.midBroken && AP.Midground && typeof AP.Midground.render === 'function') {
      midP.t = this.time; midP.camX = cam.renderX; midP.camY = cam.renderY; midP.L = this; midP.pal = this.pal;
      midP.quality = R.quality; midP.intensity = this.intensity; midP.beat = AP.Beat.beat;
      ctx.save();
      try { AP.Midground.render(ctx, this.style, midP); } catch (err) { this.midBroken = true; AP.reportError('Midground.render', err); }
      ctx.restore();
    }
    // 3. world transform
    R.worldTransform(ctx, cam.renderX, cam.renderY);
    var list = this.sortRender();
    // 4. entities behind tiles
    for (i = 0; i < list.length; i++) if (list[i].def.behindTiles) this.renderEntity(ctx, list[i], cam);
    // 5. tiles
    var drewTiles = false;
    if (this.tileArt && AP.TileArt && typeof AP.TileArt.draw === 'function') {
      ctx.save();
      try { AP.TileArt.draw(ctx, this, cam); drewTiles = true; } catch (err2) { this.tileArt = false; AP.reportError('TileArt.draw', err2); }
      ctx.restore();
    }
    if (!drewTiles) R.drawTilesFallback(ctx, this, cam);
    AP.FX.render(ctx, true);
    // 6. entities by layer (player layer 10)
    for (i = 0; i < list.length; i++) if (!list[i].def.behindTiles) this.renderEntity(ctx, list[i], cam);
    // 7. particles
    AP.FX.render(ctx, false);
    // 8. screen space: HUD, overlays, flash, DEV
    R.begin(ctx);
    if (!this.hudBroken && AP.HUD && typeof AP.HUD.render === 'function') {
      ctx.save();
      try { AP.HUD.render(ctx, this); } catch (err3) { this.hudBroken = true; AP.reportError('HUD.render', err3); }
      ctx.restore();
    } else {
      R.hudFallback(ctx, this);
    }
    R.begin(ctx);
    if (this.exitSeq && this.exitSeq.gain) this.drawFormCard(ctx);
    if (this.paused) this.drawPause(ctx);
    if (this.inlineResults) this.drawResults(ctx);
    R.begin(ctx);
    R.renderFlash(ctx);
    if (AP.DEV && LevelScene.hitboxes) this.drawHitboxes(ctx);
  };

  var CARD_T = { size: 40, weight: '300', align: 'center', baseline: 'middle', color: '#fff' };
  var CARD_S = { size: 17, weight: '500', align: 'center', baseline: 'middle', color: '#fff', maxW: 640 };
  L$.drawFormCard = function (ctx) {
    var s = this.exitSeq;
    var card = FORM_CARD[s.gain];
    var p = this.pal;
    var dim = M.clamp(s.t / 0.6, 0, 1) * M.clamp((s.dur - s.t) / 0.5, 0, 1);
    ctx.fillStyle = AP.Color.rgba('#000000', 0.55 * dim);
    ctx.fillRect(0, 0, 960, 540);
    // the vertex flies into the player
    var P = this.player;
    if (P && s.t < 0.9) {
      var k = AP.M.ease.inOutSine(M.clamp(s.t / 0.9, 0, 1));
      var sx = s.fx - this.cam.renderX, sy = s.fy - this.cam.renderY;
      var px = P.x + P.w / 2 - this.cam.renderX, py = P.y + P.h / 2 - this.cam.renderY;
      var x = sx + (px - sx) * k, y = sy + (py - sy) * k - Math.sin(k * Math.PI) * 60;
      AP.R.glow(ctx, x, y, 30, p.accent, 0.9);
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TAU);
      ctx.fill();
    }
    if (!card || s.t < 1.3) return;
    var a = M.clamp((s.t - 1.3) / 0.5, 0, 1) * M.clamp((s.dur - s.t) / 0.4, 0, 1);
    ctx.globalAlpha = a;
    // stroke-font title when the UI kit provides it, else the UI font
    var drawn = false;
    if (AP.UI && typeof AP.UI.strokeText === 'function') {
      try { AP.UI.strokeText(ctx, card.title, 480, 160, { size: 34, color: p.ink, align: 'center', glow: p.accent, progress: M.clamp((s.t - 1.3) / 1.2, 0, 1) }); drawn = true; } catch (e) { drawn = false; }
    }
    if (!drawn) {
      CARD_T.color = p.ink;
      AP.R.glow(ctx, 480, 160, 48, p.accent, 0.35 * a);
      AP.R.text(ctx, card.title, 480, 160, CARD_T);
    }
    CARD_S.color = AP.Color.mix(p.ink, p.accent, 0.25);
    AP.R.text(ctx, AP.Common.labelText(card.hint), 480, 214, CARD_S);
    if (s.t > 1.6) {
      CARD_S.color = AP.Color.rgba(p.ink, 0.5);
      AP.R.text(ctx, AP.Common.labelText('Press {confirm} to continue'), 480, 470, CARD_S);
    }
    ctx.globalAlpha = 1;
  };

  // minimal inline pause (only when the UI 'pause' scene is absent)
  var PAUSE_ITEMS = ['Resume', 'Retry', 'Restart', 'Quit'];
  var PT = { size: 34, weight: '300', align: 'center', baseline: 'middle', color: '#fff' };
  var PI = { size: 20, weight: '600', align: 'center', baseline: 'middle', color: '#fff' };
  L$.drawPause = function (ctx) {
    var p = this.pal;
    var k = M.clamp(this.paused.t / 0.15, 0, 1);
    ctx.fillStyle = AP.Color.rgba(p.bg, 0.72 * k);
    ctx.fillRect(0, 0, 960, 540);
    PT.color = p.ink;
    AP.R.text(ctx, 'PAUSED', 480, 170, PT);
    for (var i = 0; i < PAUSE_ITEMS.length; i++) {
      var sel = i === this.paused.sel;
      PI.color = sel ? p.accent : AP.Color.rgba(p.ink, 0.7);
      var y = 240 + i * 42;
      if (sel) {
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 2;
        AP.R.poly(ctx, 400, y, 7, AP.R.formSides(this.form), this.time * 2);
        ctx.stroke();
      }
      AP.R.text(ctx, PAUSE_ITEMS[i], 480, y, PI);
    }
  };

  L$.pauseUpdate = function (dt) {
    var I = AP.Input;
    var ps = this.paused;
    ps.t += dt;
    if (I.repeat('up')) { ps.sel = (ps.sel + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length; AP.sfx('uiMove'); }
    if (I.repeat('down')) { ps.sel = (ps.sel + 1) % PAUSE_ITEMS.length; AP.sfx('uiMove'); }
    if (I.pressed('pause') || I.pressed('back')) { this.paused = null; AP.sfx('unpause'); return; }
    if (I.pressed('confirm')) {
      var item = PAUSE_ITEMS[ps.sel];
      AP.sfx('uiSelect');
      this.paused = null;
      if (item === 'Retry') this.retry();
      else if (item === 'Restart') this.restart();
      else if (item === 'Quit') this.quit();
      else AP.sfx('unpause');
    }
  };

  var RT = { size: 30, weight: '300', align: 'center', baseline: 'middle', color: '#fff' };
  var RL = { size: 17, weight: '600', align: 'left', baseline: 'middle', color: '#fff' };
  var RR = { size: 17, weight: '700', align: 'right', baseline: 'middle', color: '#fff', mono: true };
  L$.drawResults = function (ctx) {
    var r = this.inlineResults;
    var res = r.res;
    var p = this.pal;
    var k = AP.M.ease.outCubic(M.clamp(r.t / 0.35, 0, 1));
    ctx.fillStyle = AP.Color.rgba(p.bg, 0.6 * k);
    ctx.fillRect(0, 0, 960, 540);
    var y0 = 150 + (1 - k) * 30;
    ctx.globalAlpha = k;
    ctx.fillStyle = AP.Color.rgba(p.bg, 0.92);
    ctx.fillRect(300, y0, 360, 240);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(300, y0, 360, 240);
    RT.color = p.ink;
    AP.R.text(ctx, res.name || res.id, 480, y0 + 38, RT);
    var rows = [
      ['Time', AP.R.fmtTime(res.time)],
      ['Deaths', String(res.deaths)],
      ['Shards', res.shards + ' / ' + res.shardsTotal],
      ['Gems', (res.gems[0] ? '◆' : '◇') + ' ' + (res.gems[1] ? '◆' : '◇') + ' ' + (res.gems[2] ? '◆' : '◇')]
    ];
    for (var i = 0; i < rows.length; i++) {
      RL.color = AP.Color.rgba(p.ink, 0.75);
      RR.color = i === 3 ? p.accent : p.ink;
      AP.R.text(ctx, rows[i][0], 330, y0 + 90 + i * 34, RL);
      AP.R.text(ctx, rows[i][1], 630, y0 + 90 + i * 34, RR);
    }
    if (res.newBest) {
      RL.color = p.accent;
      AP.R.text(ctx, 'NEW BEST', 330, y0 + 222, RL);
    }
    ctx.fillStyle = p.accent;
    ctx.fillRect(300, y0 + 236, 360 * M.clamp(r.t / 2, 0, 1), 4);
    ctx.globalAlpha = 1;
  };

  var HB_T = { size: 11, weight: '600', align: 'left', baseline: 'top', color: '#fff', mono: true };
  L$.drawHitboxes = function (ctx) {
    var cam = this.cam;
    var ox = -cam.renderX, oy = -cam.renderY;
    var es = this.entities;
    ctx.lineWidth = 1;
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (e.dead || !cam.visible(e.x, e.y, e.w, e.h, 8)) continue;
      ctx.strokeStyle = e === this.player ? '#00FF88' : (e.hazard ? '#FF3355' : (e.kind === 'solid' ? '#44AAFF' : (e.kind === 'actor' ? '#FFAA00' : '#BBBBBB')));
      ctx.strokeRect(e.x + ox + 0.5, e.y + oy + 0.5, e.w - 1, e.h - 1);
      if (e.orbitNode) { ctx.beginPath(); ctx.arc(e.x + e.w / 2 + ox, e.y + e.h / 2 + oy, C.ORBIT_RANGE, 0, TAU); ctx.stroke(); }
    }
    // spike hurtboxes on screen
    ctx.strokeStyle = '#FF3355';
    var tx0 = Math.max(0, Math.floor(cam.x / 32)), tx1 = Math.min(this.w - 1, Math.floor((cam.x + 960) / 32));
    var ty0 = Math.max(0, Math.floor(cam.y / 32)), ty1 = Math.min(this.h - 1, Math.floor((cam.y + 540) / 32));
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) {
      var c = this.tiles[ty * this.w + tx];
      if (c < T.SPIKE_U || c > T.SPIKE_R) continue;
      AP.Tilemap.spikeRect(c, tx, ty, spikeR);
      ctx.strokeRect(spikeR[0] + ox + 0.5, spikeR[1] + oy + 0.5, spikeR[2] - 1, spikeR[3] - 1);
    }
    if (cam.lockRect) { ctx.strokeStyle = '#FFFF00'; ctx.strokeRect(cam.lockRect.x + ox, cam.lockRect.y + oy, cam.lockRect.w, cam.lockRect.h); }
    var P = this.player;
    if (P) {
      HB_T.color = '#00FF88';
      AP.R.text(ctx, P.state + (P.grounded ? ' G' : '') + (P.wall ? ' W' + P.wall : '') + ' vx ' + Math.round(P.vx) + ' vy ' + Math.round(P.vy) +
        ' cy ' + P.coyoteT.toFixed(2) + (P.hasDouble ? ' D' : '') + (P.hasDash ? ' X' : '') + (godMode() ? ' GOD' : ''), 8, 520, HB_T);
    }
  };

  L$.dispose = function () {
    for (var i = 0; i < this.offs.length; i++) AP.guard('level.off', this.offs[i]);
    this.offs.length = 0;
    if (this.tileArt) AP.call('TileArt.dispose', this);
    if (!this.ended) AP.call('HUD.onLevelEnd', this);
    if (this.cam) this.cam.lock(null);
    if (AP.level === this) AP.level = null;
    this.disposed = true;
  };

  // ================================================================ scene 'level'
  var LevelScene = {
    L: null,
    hitboxes: false,
    transparent: false,

    enter: function (params, from) {
      if (LevelScene.L) { LevelScene.L.dispose(); LevelScene.L = null; }
      AP.FX.clear();
      var L = new Level(params || {});
      LevelScene.L = L;
      AP.level = L;
      AP.music(L.music);
      AP.Beat.reset();
      L.tileArt = false;
      if (AP.TileArt && typeof AP.TileArt.build === 'function') {
        var ok = true;
        try { AP.TileArt.build(L); } catch (e) { ok = false; AP.reportError('TileArt.build', e); }
        L.tileArt = ok;
      }
      AP.call('HUD.onLevelStart', L);
      L.emit('level:start', { id: L.id, world: L.world, form: L.form, mode: L.mode });
      if (L.player) AP.Player.lastForm = L.form;
    },

    exit: function () {
      var L = LevelScene.L;
      if (L) L.dispose();
      LevelScene.L = null;
      if (AP.level === L) AP.level = null;
    },

    covered: function () { if (LevelScene.L) LevelScene.L.covered = true; },
    uncovered: function () { if (LevelScene.L) LevelScene.L.covered = false; },

    update: function (dt) {
      var L = LevelScene.L;
      if (!L) return;
      if (L.paused) { L.pauseUpdate(dt); return; }
      var I = AP.Input;
      if (!L.ended) {
        if (I.pressed('pause')) { L.pause(); return; }
        if (I.pressed('retry') && L.phase === 'play') L.retry();
      }
      L.update(dt);
    },

    render: function (ctx) {
      if (LevelScene.L) LevelScene.L.render(ctx);
    }
  };

  AP.Scenes.register('level', LevelScene);
  AP.LevelScene = LevelScene;
  AP.Level = Level;

  // ================================================================ test hooks (CONTRACT 2.21)
  var Test = {
    godMode: false,

    // startLevel(idOrObj, {form?, mode:'test'}) -> L (synchronous, no transition)
    startLevel: function (idOrObj, opts) {
      opts = opts || {};
      var params = { mode: opts.mode || 'test' };
      if (opts.form !== undefined) params.form = opts.form;
      if (typeof idOrObj === 'string') params.id = idOrObj; else if (idOrObj && typeof idOrObj === 'object') params.level = idOrObj;
      if (typeof opts.onComplete === 'function') params.onComplete = opts.onComplete;
      if (typeof opts.onQuit === 'function') params.onQuit = opts.onQuit;
      AP.Scenes.goNow('level', params);
      return AP.level;
    },

    god: function (on) {
      Test.godMode = on === undefined ? !Test.godMode : !!on;
      return Test.godMode;
    },

    // teleport the player so its bottom-centre is at (cx, by)
    teleport: function (cx, by) {
      var L = AP.level;
      var P = L && L.player;
      if (!P) return false;
      if (P.state === 'dead' || P.state === 'respawn') { P.state = 'normal'; L.phase = 'play'; }
      if (P.state === 'orbit' || P.state === 'dash') P.state = 'normal';
      P.setPos(Math.round(cx - P.w / 2), Math.round(by - P.h));
      P.vx = 0;
      P.vy = 0;
      P.grounded = P.groundAt(0);
      L.cam.snap();
      return true;
    },

    // drives the fight to defeat with def.debugDamage (god mode on meanwhile) -> true when defeated
    defeatBoss: function () {
      var L = AP.level;
      if (!L) return false;
      var boss = L.bossEnt || L.findBoss();
      if (!boss) return false;
      var I = AP.Input;
      var prevGod = Test.godMode;
      Test.godMode = true;
      var i;
      for (i = 0; i < 720 && !L.bossInfo && !L.bossDone && AP.level === L; i++) {
        I.setVirtual('right', (i % 140) < 40);
        I.setVirtual('jump', (i % 70) < 3);
        AP.Loop.step(1);
      }
      I.clearVirtual();
      if (AP.level !== L) { Test.godMode = prevGod; return false; }
      if (!L.bossInfo && !L.bossDone) L.bossStart(boss);
      for (var k = 0; k < 100 && !L.bossDone && AP.level === L; k++) {
        for (var w = 0; w < 240 && L.phase !== 'play' && AP.level === L; w++) AP.Loop.step(1);
        boss = (L.bossEnt && !L.bossEnt.dead) ? L.bossEnt : L.findBoss();
        if (!boss) break;
        L.hook(boss, 'debugDamage', L);
        AP.Loop.step(8);
      }
      for (i = 0; i < 300 && L.bossDone && !L.vertexOn && AP.level === L; i++) AP.Loop.step(1);
      Test.godMode = prevGod;
      return !!L.bossDone;
    },

    // extras
    kill: function (cause) { var L = AP.level; return L ? L.killPlayer(cause || 'test') : false; },
    complete: function (opts) { var L = AP.level; return L ? L.completeLevel(opts || {}) : false; },
    player: function () { return AP.level ? AP.level.player : null; }
  };
  AP.Test = Test;
})(window.AP = window.AP || {});
