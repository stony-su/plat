/* js/engine/entities.js — owner: CORE */
(function (AP) {
  'use strict';

  var ALLOWED = ['kind', 'w', 'h', 'size', 'anchor', 'layer', 'behindTiles',
    'hazard', 'stompable', 'dashable', 'burstable', 'oneWay', 'orbitNode', 'boss',
    'carry', 'required', 'lint', 'lintRects', 'renderPad', 'alwaysRender', 'bossName', 'phases',
    'init', 'update', 'render', 'onTouch', 'onStomp', 'onDash', 'onBurst', 'onPlayerDeath', 'onRespawn',
    'onSquish', 'onRemove', 'debugDamage'];
  var HOOKS = ['init', 'update', 'render', 'onTouch', 'onStomp', 'onDash', 'onBurst', 'onPlayerDeath', 'onRespawn',
    'onSquish', 'onRemove', 'debugDamage', 'size', 'lintRects'];
  var KINDS = { sensor: 1, actor: 1, solid: 1 };
  var ANCHORS = { floor: 1, center: 1, ceiling: 1, tile: 1 };
  var LINTS = { ignore: 1, solid: 1, stand: 1, hazard: 1, bounce: 1, orbit: 1, mover: 1 };
  var FLAGS = ['hazard', 'stompable', 'dashable', 'burstable', 'oneWay', 'orbitNode', 'boss'];

  var defs = {};
  var order = [];

  function normalize(type, def) {
    var d = {
      kind: KINDS[def.kind] ? def.kind : 'sensor',
      w: (typeof def.w === 'number' && def.w > 0) ? def.w : 24,
      h: (typeof def.h === 'number' && def.h > 0) ? def.h : 24,
      anchor: ANCHORS[def.anchor] ? def.anchor : 'floor',
      layer: typeof def.layer === 'number' ? def.layer : 0,
      behindTiles: !!def.behindTiles,
      carry: def.carry !== false,
      required: Array.isArray(def.required) ? def.required.slice() : [],
      lint: LINTS[def.lint] ? def.lint : 'ignore',
      renderPad: typeof def.renderPad === 'number' ? def.renderPad : 64,
      alwaysRender: !!def.alwaysRender
    };
    for (var f = 0; f < FLAGS.length; f++) d[FLAGS[f]] = !!def[FLAGS[f]];
    if (def.kind && !KINDS[def.kind]) AP.warnOnce('defkind:' + type, 'Entity "' + type + '": unknown kind', def.kind);
    if (def.anchor && !ANCHORS[def.anchor]) AP.warnOnce('defanchor:' + type, 'Entity "' + type + '": unknown anchor', def.anchor);
    if (def.bossName !== undefined) d.bossName = String(def.bossName);
    if (def.phases !== undefined) d.phases = def.phases | 0;
    for (var h = 0; h < HOOKS.length; h++) {
      var k = HOOKS[h];
      if (def[k] !== undefined) {
        if (typeof def[k] === 'function') d[k] = def[k];
        else AP.warnOnce('defhook:' + type + ':' + k, 'Entity "' + type + '": ' + k + ' must be a function');
      }
    }
    return d;
  }

  function register(type, def) {
    if (!type || typeof type !== 'string' || !def || typeof def !== 'object') {
      AP.warn('Entities.register: bad registration', type);
      return null;
    }
    for (var k in def) {
      if (Object.prototype.hasOwnProperty.call(def, k) && ALLOWED.indexOf(k) < 0) {
        AP.warnOnce('defkey:' + type + ':' + k, 'Entity "' + type + '": unknown def key "' + k + '"');
      }
    }
    if (defs[type]) AP.warn('Entities.register: duplicate type "' + type + '" (last wins)');
    else order.push(type);
    var d = normalize(type, def);
    defs[type] = d;
    return d;
  }

  function get(type) { return defs[type] || null; }
  function has(type) { return !!defs[type]; }
  function list(prefix) {
    var out = [];
    for (var i = 0; i < order.length; i++) {
      if (!defs[order[i]]) continue;
      if (!prefix || order[i].indexOf(prefix) === 0) out.push(order[i]);
    }
    return out;
  }

  // ---- instances ----
  var nextId = 1;
  function Entity() {
    this.id = 0;
    this.type = '';
    this.def = null;
    this.kind = 'sensor';
    this.x = 0; this.y = 0; this.w = 24; this.h = 24;
    this.vx = 0; this.vy = 0;
    this.px = 0; this.py = 0; this.rx = 0; this.ry = 0;
    this.xRem = 0; this.yRem = 0;
    this.t = 0;
    this.spec = null;
    this.tx = 0; this.ty = 0;
    this.homeX = 0; this.homeY = 0;
    this.layer = 0;
    this.active = true;
    this.visible = true;
    this.dead = false;
    this.collidable = true;
    this.touching = false;
    this.minion = false;
    this.broken = false;
    this.parent = null;
    this.s = {};
    // instance copies of the def flags (may be toggled per instance at runtime)
    this.hazard = false; this.stompable = false; this.dashable = false; this.burstable = false;
    this.oneWay = false; this.orbitNode = false; this.boss = false;
    this.tag = null;
    this.dropT = 0;
    this.wallRide = 0;
    // engine internals
    this._order = 0;
    this._tp = false;
    this._dash = -1;
    this._sort = 0;
  }
  Entity.prototype = AP.Phys.proto;
  Object.defineProperty(AP.Phys.proto, 'constructor', { value: Entity, enumerable: false, writable: true });

  // size from def.size(spec) or def.w/h
  function sizeOf(def, spec, out) {
    var w = def.w, h = def.h;
    if (typeof def.size === 'function') {
      var r = null;
      try { r = def.size(spec || {}); } catch (e) { AP.reportError('size', e); }
      if (r && r.length >= 2 && r[0] > 0 && r[1] > 0) { w = +r[0]; h = +r[1]; }
    }
    out[0] = w;
    out[1] = h;
    return out;
  }
  var sz = [0, 0];

  // create an un-positioned, un-initialised instance (LevelScene positions it and calls init)
  function create(type, spec) {
    var def = defs[type];
    var realType = type;
    if (!def) {
      AP.warnOnce('etype:' + type, 'Unknown entity type "' + type + '": using the "missing" placeholder.');
      def = defs.missing;
      realType = 'missing';
      spec = spec || {};
      spec.wanted = type;
      if (!def) return null;
    }
    var e = new Entity();
    e.id = nextId++;
    e.type = realType;
    e.def = def;
    e.kind = def.kind;
    e.layer = def.layer;
    e.spec = spec || {};
    e.tag = (spec && spec.tag !== undefined) ? spec.tag : null;
    for (var f = 0; f < FLAGS.length; f++) e[FLAGS[f]] = def[FLAGS[f]];
    sizeOf(def, e.spec, sz);
    e.w = sz[0];
    e.h = sz[1];
    return e;
  }

  // world position of a tile anchor point (tile coords may be fractional)
  function anchorPoint(anchor, tx, ty, out) {
    out = out || { x: 0, y: 0 };
    if (anchor === 'tile') { out.x = tx * 32; out.y = ty * 32; }
    else if (anchor === 'center') { out.x = tx * 32 + 16; out.y = ty * 32 + 16; }
    else if (anchor === 'ceiling') { out.x = tx * 32 + 16; out.y = ty * 32; }
    else { out.x = tx * 32 + 16; out.y = ty * 32 + 32; }
    return out;
  }

  // top-left of a w x h box whose anchor point is (ax, ay)
  function fromAnchor(anchor, ax, ay, w, h, out) {
    out = out || { x: 0, y: 0 };
    if (anchor === 'tile') { out.x = ax; out.y = ay; }
    else if (anchor === 'center') { out.x = ax - w / 2; out.y = ay - h / 2; }
    else if (anchor === 'ceiling') { out.x = ax - w / 2; out.y = ay; }
    else { out.x = ax - w / 2; out.y = ay - h; }
    return out;
  }

  // anchor point of an entity's current box
  function anchorOf(e, out) {
    out = out || { x: 0, y: 0 };
    var a = e.def ? e.def.anchor : 'floor';
    if (a === 'tile') { out.x = e.x; out.y = e.y; }
    else if (a === 'center') { out.x = e.x + e.w / 2; out.y = e.y + e.h / 2; }
    else if (a === 'ceiling') { out.x = e.x + e.w / 2; out.y = e.y; }
    else { out.x = e.x + e.w / 2; out.y = e.y + e.h; }
    return out;
  }

  // spec path [[tx,ty],...] (tile coords) -> world anchor points [[x,y],...] for the given anchor
  function pathWorld(path, anchor) {
    var out = [];
    if (!Array.isArray(path)) return out;
    var p = { x: 0, y: 0 };
    for (var i = 0; i < path.length; i++) {
      var pt = path[i];
      if (!pt || pt.length < 2) continue;
      anchorPoint(anchor || 'floor', +pt[0] || 0, +pt[1] || 0, p);
      out.push([p.x, p.y]);
    }
    return out;
  }

  AP.Entities = {
    register: register,
    get: get,
    has: has,
    list: list,
    proto: AP.Phys.proto,
    Entity: Entity,
    create: create,
    sizeOf: function (type, spec) { var d = defs[type]; return d ? sizeOf(d, spec, [0, 0]) : [24, 24]; },
    anchorPoint: anchorPoint,
    fromAnchor: fromAnchor,
    anchorOf: anchorOf,
    pathWorld: pathWorld,
    ALLOWED_KEYS: ALLOWED,
    FLAGS: FLAGS
  };
})(window.AP = window.AP || {});
