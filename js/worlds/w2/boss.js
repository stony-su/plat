/* js/worlds/w2/boss.js — owner: W2 */
(function (AP) {
  'use strict';

  // The Crystal Monarch (w2.monarch, CONTRACT §2.17) and its temporary Voronoi walls (w2.vwall).
  // A crowned crystal that hovers in a tall geode shaft. Each phase it holds one tier of the arena:
  //   charge (accent rays show every bolt path) → fan of w2.bolt → its shell opens and the core glows accent
  //   for about two seconds: stomp it from above (wall-jump to the ledges over it and drop). Phase 2 adds a
  //   second fan and Voronoi walls that reshape the climbing shafts; phase 3 adds a telegraphed shard fall.
  //   Losing a phase's hits it rises to the next tier and shatters the sealed rock gate in the slab between the
  //   tiers into a one-way crystal shelf: the player's way up to the next phase.
  // Hits: 3 + 3 + 2 = 8. Level spec (entities array, tile units):
  //   tiers: [{x, y, sway, gate:[x, y, w, h], top, bottom}]  hover centre and sway per phase; the gate cells it
  //                                             turns into one-way shelves on arrival; the tier's rows (shard fall)
  //   walls: [[], [[slot, slot], ...], ...]     per phase, pairs of [x, y, w, h] Voronoi wall slots (top-left)
  var C = AP.C;
  var M = AP.M;
  var T = AP.TILE;
  var TAU = Math.PI * 2;
  var E = AP.Entities;

  var HP = [3, 3, 2];
  var TOTAL = 8;
  var PHASE = [
    { fan: 5, spread: 56, speed: 6.5, hover: 1.5, charge: 0.8, open: 2.4, walls: false, shards: false, double: false, swayRate: 0.9, intensity: 0.62 },
    { fan: 7, spread: 76, speed: 7.2, hover: 1.3, charge: 0.75, open: 2.15, walls: true, shards: false, double: true, swayRate: 1.15, intensity: 0.78 },
    { fan: 7, spread: 84, speed: 7.8, hover: 1.1, charge: 0.7, open: 1.9, walls: true, shards: true, double: true, swayRate: 1.4, intensity: 0.92 }
  ];
  var BODY_W = 52, BODY_H = 44;
  var CLOSE_T = 0.45, RECOIL_T = 1.0, ASCEND_T = 1.9, INTRO_T = 1.2, AWAKE_T = 1.4, DIE_T = 1.6;
  var WALL_EVERY = 7.0, SHARD_EVERY = 3.1;
  var RAY = [7, 6];
  var NODASH = [];
  var rayOut = { hit: false, x: 0, y: 0, dist: 0, tx: -1, ty: -1, other: null };
  var fanBuf = new Float32Array(16);
  var BODY = new Float64Array(12);

  function pal(L) { return (L && L.pal) || AP.Worlds.pal('w2'); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; var q = 1 - ph; return q * q * q; }
  function hash01(a, b, c) { return AP.hash2(a | 0, b | 0, c | 0) / 4294967296; }
  function hpLeft(s) { var n = Math.max(0, s.hp); for (var i = s.phase + 1; i < HP.length; i++) n += HP[i]; return n; }
  function cellSolid(L, tx, ty) { var c = L.tileAt(tx, ty); return c === T.SOLID || c === T.BREAK; }

  // ================================================================== w2.vwall
  // A temporary crystal wall raised by the Monarch: a ghost outline grows for `tele` seconds (never solid while
  // the player stands in it), then it is solid for `life` seconds (a wall to slide and jump on) and shatters.
  function buildCells(e) {
    var s = e.s;
    var x = e.x, y = e.y, w = e.w, h = e.h;
    var n = Math.max(2, Math.round(w * h / (32 * 32) * 1.3));
    var seed = (x * 31 + y * 17) | 0;
    var sites = [];
    for (var i = 0; i < n; i++) {
      var fx = (i + 0.5) / n;
      var sx = x + 4 + (w - 8) * (w >= h ? fx : 0.2 + 0.6 * hash01(seed, i, 1));
      var sy = y + 4 + (h - 8) * (w >= h ? 0.2 + 0.6 * hash01(seed, i, 2) : fx);
      sites.push([sx, sy]);
    }
    var cells = [];
    var A = AP.Algo;
    if (A && typeof A.voronoi === 'function') {
      var out = null;
      try { out = A.voronoi(sites, [x, y, w, h]); } catch (err) { out = null; }
      if (out && out.length) for (var k = 0; k < out.length; k++) if (out[k].poly && out[k].poly.length >= 6) cells.push(out[k].poly);
    }
    if (!cells.length) {
      // fallback: stacked facets
      for (var j = 0; j < n; j++) {
        if (w >= h) cells.push([x + w * j / n, y, x + w * (j + 1) / n, y, x + w * (j + 1) / n, y + h, x + w * j / n, y + h]);
        else cells.push([x, y + h * j / n, x + w, y + h * j / n, x + w, y + h * (j + 1) / n, x, y + h * (j + 1) / n]);
      }
    }
    s.cells = cells;
    // centroid of every cell (shatter directions)
    var cen = [];
    for (var c = 0; c < cells.length; c++) {
      var pp = cells[c], mx = 0, my = 0, m = pp.length >> 1;
      for (var q = 0; q < pp.length; q += 2) { mx += pp[q]; my += pp[q + 1]; }
      cen.push(mx / m, my / m);
    }
    s.cen = cen;
  }
  function wallBlocked(e, L) {
    var P = L.player;
    if (!P || P.state === 'dead') return false;
    var pad = 4;
    return P.x - pad < e.x + e.w && P.x + P.w + pad > e.x && P.y - pad < e.y + e.h && P.y + P.h + pad > e.y;
  }

  E.register('w2.vwall', {
    kind: 'solid', anchor: 'tile', layer: 2, lint: 'ignore', renderPad: 48,
    size: function (spec) { return [Math.max(1, num(spec.w, 1)) * 32, Math.max(1, num(spec.h, 4)) * 32]; },
    init: function (e, spec, L) {
      var s = e.s;
      s.tele = Math.max(0.4, num(spec.tele, 0.9));
      s.life = Math.max(0.5, num(spec.life, 4.5));
      s.state = 'tele';
      s.t = 0;
      s.wait = 0;
      e.collidable = false;
      buildCells(e);
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.t += dt;
      if (s.state === 'tele') {
        if (s.t >= s.tele) {
          if (wallBlocked(e, L)) {
            s.wait += dt;
            if (s.wait > 1.2) { s.state = 'gone'; s.t = 0; }
          } else {
            s.state = 'solid';
            s.t = 0;
            e.collidable = true;
            var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
            AP.FX.burst('w2.glint', cx, cy, { n: 6 });
            AP.FX.burst('w2.dust', cx, e.y + e.h, { n: 5 });
            AP.sfxAt('chime', cx, cy, { vol: 0.35, pitch: 0.75 });
            L.shake(2, 0.12);
          }
        }
      } else if (s.state === 'solid') {
        if (s.t >= s.life) {
          s.state = 'shatter';
          s.t = 0;
          e.collidable = false;
          var pc = pal(L);
          for (var i = 0; i < s.cen.length; i += 2) AP.FX.burst('w2.shatter', s.cen[i], s.cen[i + 1], { n: 4, color: pc.primary });
          AP.sfxAt('break', e.x + e.w / 2, e.y + e.h / 2, { vol: 0.6, pitch: 1.15 });
        }
      } else if (s.state === 'shatter') {
        if (s.t >= 0.35) L.remove(e);
      } else if (s.state === 'gone') {
        if (s.t >= 0.3) L.remove(e);
      }
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var cells = s.cells, cen = s.cen;
      var i, k;
      if (s.state === 'tele' || s.state === 'gone') {
        var g = s.state === 'gone' ? 1 - s.t / 0.3 : M.clamp(s.t / s.tele, 0, 1);
        var sc = 0.35 + 0.65 * M.ease.outCubic(g);
        ctx.setLineDash(RAY);
        ctx.lineDashOffset = -L.time * 40;
        ctx.lineWidth = 1.5;
        for (i = 0; i < cells.length; i++) {
          var pp = cells[i], ccx = cen[i * 2], ccy = cen[i * 2 + 1];
          ctx.beginPath();
          for (k = 0; k < pp.length; k += 2) {
            var vx = ccx + (pp[k] - ccx) * sc, vy = ccy + (pp[k + 1] - ccy) * sc;
            if (k === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
          }
          ctx.closePath();
          ctx.fillStyle = rgba(p.primary, 0.08 * g);
          ctx.fill();
          ctx.strokeStyle = rgba(p.accent, 0.25 + 0.55 * g);
          ctx.stroke();
        }
        ctx.setLineDash(NODASH);
        ctx.lineDashOffset = 0;
        return;
      }
      var a = 1, push = 0;
      if (s.state === 'shatter') { a = 1 - s.t / 0.35; push = s.t * 120; }
      ctx.globalAlpha = a;
      var cxw = e.x + e.w / 2, cyw = e.y + e.h / 2;
      for (i = 0; i < cells.length; i++) {
        var poly = cells[i];
        if (push > 0) {
          ctx.save();
          var dx = cen[i * 2] - cxw, dy = cen[i * 2 + 1] - cyw, dl = Math.sqrt(dx * dx + dy * dy) || 1;
          ctx.translate(dx / dl * push, dy / dl * push + push * push * 0.004);
        }
        if (AP.Art && AP.Art.crystal) {
          AP.Art.crystal(ctx, poly, p, L.time + i * 0.9, { alpha: 0.95, fill: p.primary, edge: p.primary, glint: p.accent, width: 2, glintSpeed: 55 });
        } else {
          ctx.beginPath();
          ctx.moveTo(poly[0], poly[1]);
          for (k = 2; k < poly.length; k += 2) ctx.lineTo(poly[k], poly[k + 1]);
          ctx.closePath();
          ctx.fillStyle = rgba(p.primary, 0.3);
          ctx.fill();
          ctx.strokeStyle = p.primary;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (push > 0) ctx.restore();
      }
      if (s.state === 'solid') {
        // the last second: cracks warn that it will shatter
        var warn = M.clamp((s.t - (s.life - 1)) / 1, 0, 1);
        ctx.strokeStyle = rgba(p.ink, 0.12 + 0.5 * warn);
        ctx.lineWidth = 1 + warn;
        ctx.strokeRect(e.x + 1, e.y + 1, e.w - 2, e.h - 2);
        if (warn > 0 && AP.Art && AP.Art.crack) AP.Art.crack(ctx, e.x + 2, e.y + 2, e.w - 4, e.h - 4, (e.x * 3 + e.y) | 0, p.ink, 0.8 + warn);
      }
      ctx.globalAlpha = 1;
    }
  });

  // ================================================================== w2.monarch
  function tierOf(e, i) {
    var t = e.s.tiers;
    return t[Math.min(i, t.length - 1)];
  }
  function setState(s, st) { s.state = st; s.t = 0; }

  function phaseSnapshot(e, L) {
    var s = e.s;
    var snap = L.snapshotTiles();
    var tr = tierOf(e, s.phase);
    if (tr.gate && s.phase > 0) {
      var g = tr.gate;
      for (var y = g[1]; y < g[1] + g[3]; y++) for (var x = g[0]; x < g[0] + g[2]; x++) {
        if (x >= 0 && y >= 0 && x < L.w && y < L.h) snap[y * L.w + x] = T.ONEWAY;
      }
    }
    s.snap = snap;
  }

  function openGate(e, L, tr) {
    var g = tr.gate;
    if (!g) return;
    var p = pal(L);
    for (var y = g[1]; y < g[1] + g[3]; y++) for (var x = g[0]; x < g[0] + g[2]; x++) {
      if (L.tileAt(x, y) !== T.SOLID) continue;
      L.setTile(x, y, T.ONEWAY);           // the seal re-forms as a one-way crystal shelf: the way up
      AP.FX.burst('w2.shatter', x * 32 + 16, y * 32 + 16, { n: 6, color: p.primary, dir: -Math.PI / 2 });
    }
    var gx = (g[0] + g[2] / 2) * 32, gy = (g[1] + g[3] / 2) * 32;
    AP.FX.burst('w2.geode', gx, gy, { radius: 3, n: 26 });
    AP.sfxAt('break', gx, gy, { vol: 1, pitch: 0.65 });
    AP.sfxAt('rumble', gx, gy, { vol: 0.8 });
    L.shake(12, 0.6);
    L.flash(p.accent, 0.12, 0.2);
  }

  function fanAim(e, L) {
    var s = e.s, P = L.player;
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    var aim = Math.PI / 2;
    if (P) aim = Math.atan2(P.y + P.h / 2 - cy, P.x + P.w / 2 - cx);
    var ph = PHASE[s.phase];
    var n = ph.fan, spread = ph.spread * Math.PI / 180;
    s.fanN = n;
    for (var i = 0; i < n; i++) fanBuf[i] = aim + spread * (i / (n - 1) - 0.5);
    s.aim = aim;
    s.fanStep = spread / (n - 1);
  }

  function fireFan(e, L, offset) {
    var s = e.s, ph = PHASE[s.phase], p = pal(L);
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    var n = offset ? s.fanN - 1 : s.fanN;
    for (var i = 0; i < n; i++) {
      var a = offset ? fanBuf[i] + s.fanStep * 0.5 : fanBuf[i];
      var dx = Math.cos(a), dy = Math.sin(a);
      var b = L.spawn('w2.bolt', cx + dx * 30, cy + dy * 30, { dx: dx, dy: dy, speed: ph.speed });
      if (b) b.minion = true;
    }
    AP.FX.burst('w2.muzzle', cx, cy, { dir: s.aim, color: p.hazard, n: 10 });
    AP.FX.ring(cx, cy, 12, 70, 0.3, p.hazard, 2.5);
    AP.sfxAt('shoot', cx, cy, { vol: 0.9, pitch: offset ? 1.15 : 0.85 });
    AP.sfxAt('laser', cx, cy, { vol: 0.4, pitch: 1.3 });
    L.shake(4, 0.18);
  }

  function raiseWalls(e, L) {
    var s = e.s;
    var list = s.walls[s.phase];
    if (!list || !list.length) return;
    var pair = list[s.wallIdx % list.length];
    s.wallIdx++;
    for (var i = 0; i < pair.length; i++) {
      var r = pair[i];
      if (!r || r.length < 4) continue;
      var w = L.spawn('w2.vwall', (r[0] + r[2] / 2) * 32, (r[1] + r[3] / 2) * 32, { w: r[2], h: r[3] });
      if (w) w.minion = true;
    }
    AP.sfxAt('rumble', e.x + e.w / 2, e.y + e.h / 2, { vol: 0.45, pitch: 1.3 });
  }

  function shardFall(e, L) {
    var P = L.player;
    if (!alive(P)) return;
    var tr = tierOf(e, e.s.phase);
    var pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
    if (tr.top !== undefined && (pcy < tr.top || pcy > tr.bottom)) return;
    var n = 0;
    for (var k = -1; k <= 1; k++) {
      var x = pcx + k * 3 * 32 + (k === 0 ? 0 : (hash01(e.s.shardN, k + 2, 9) - 0.5) * 24);
      x = M.clamp(x, 48, L.pw - 48);
      var tx = Math.floor(x / 32);
      var ty = Math.floor(pcy / 32);
      if (cellSolid(L, tx, ty)) continue;
      L.raycast(x, pcy, 0, -1, 640, rayOut);
      var top = rayOut.hit ? rayOut.y : pcy - 640;
      var sh = L.spawn('w2.stalactite', x, top + 17, { drop: true, tele: 0.75 });
      if (sh) { sh.minion = true; n++; }
    }
    e.s.shardN++;
    if (n) AP.sfxAt('crumble', pcx, pcy - 200, { vol: 0.5, pitch: 1.4 });
  }

  function hit(e, L) {
    var s = e.s;
    if (s.state === 'dying' || s.state === 'dead') return;
    var p = pal(L);
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    s.hp--;
    s.flash = 1;
    AP.FX.burst('w2.shatter', cx, cy - 10, { n: 14, color: p.accent });
    AP.FX.ring(cx, cy, 10, 90, 0.4, p.accent, 3);
    e.stompable = false;
    e.hazard = false;
    if (s.hp <= 0 && s.phase < HP.length - 1) {
      // phase cleared: rise to the next tier (the arena reconfigures; this snapshot already has the gate open)
      s.phase++;
      s.hp = HP[s.phase];
      L.clearMinions();
      phaseSnapshot(e, L);
      s.fromX = cx; s.fromY = cy;
      s.gateDone = false;
      s.wallT = 2.0; s.shardT = 1.6; s.wallIdx = 0;
      setState(s, 'ascend');
      L.intensity = PHASE[s.phase].intensity;
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
    } else if (s.hp <= 0) {
      setState(s, 'dying');
      L.bossBar(0, s.phase);
      L.bossDefeated(e);
    } else {
      setState(s, 'recoil');
      s.swayT += Math.PI / 1.7;
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
    }
  }

  function anchorPos(e, L, out) {
    var s = e.s, tr = tierOf(e, s.phase);
    out.x = tr.cx + tr.sw * Math.sin(s.swayT * 1.7);
    out.y = tr.cy + 9 * Math.sin(s.swayT * 2.9);
    return out;
  }
  var tgt = { x: 0, y: 0 };

  function awake(e, L) {
    if (!L.bossInfo && !L.bossDone) L.bossStart(e);
    var s = e.s;
    if (s.state === 'dormant') { setState(s, 'awaken'); s.started = true; L.intensity = PHASE[0].intensity; }
  }

  E.register('w2.monarch', {
    kind: 'sensor', w: BODY_W, h: BODY_H, anchor: 'center', layer: 6, lint: 'ignore', renderPad: 260, alwaysRender: true,
    boss: true, bossName: 'Crystal Monarch', phases: 3,
    init: function (e, spec, L) {
      var s = e.s;
      var hx = e.x + e.w / 2, hy = e.y + e.h / 2;
      s.tiers = [];
      var list = Array.isArray(spec.tiers) ? spec.tiers : [];
      for (var i = 0; i < list.length; i++) {
        var t = list[i] || {};
        var tier = {
          cx: num(t.x, hx / 32 - 0.5) * 32 + 16, cy: num(t.y, hy / 32 - 0.5) * 32 + 16,
          sw: num(t.sway, 4) * 32,
          gate: Array.isArray(t.gate) && t.gate.length >= 4 ? t.gate.slice(0, 4) : null,
          top: typeof t.top === 'number' ? t.top * 32 : undefined,
          bottom: typeof t.bottom === 'number' ? t.bottom * 32 : undefined
        };
        s.tiers.push(tier);
      }
      if (!s.tiers.length) s.tiers.push({ cx: hx, cy: hy, sw: 4 * 32, gate: null, top: undefined, bottom: undefined });
      s.walls = Array.isArray(spec.walls) ? spec.walls : [];
      s.phase = 0;
      s.hp = HP[0];
      s.state = 'dormant';
      s.t = 0;
      s.started = false;
      s.swayT = 0;
      s.flash = 0;
      s.open = 0;        // shell opening 0..1 (visual)
      s.spike = 1;       // hazard spikes extension 0..1 (visual)
      s.charge = 0;      // telegraph intensity 0..1
      s.fanN = 0; s.fanStep = 0; s.aim = Math.PI / 2;
      s.fired2 = false;
      s.wallT = 2.0; s.shardT = 1.6; s.wallIdx = 0; s.shardN = 0;
      s.fromX = hx; s.fromY = hy; s.gateDone = true;
      s.cx = hx; s.cy = hy;
      s.spin = 0;
      s.dieT = 0;
      e.hazard = false;
      e.stompable = false;
      s.snap = L.snapshotTiles();
    },
    update: function (e, dt, L) {
      var s = e.s;
      var P = L.player;
      s.t += dt;
      s.spin += dt * (0.4 + 0.25 * s.phase + s.charge * 2);
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.5);
      var ph = PHASE[s.phase];
      var pAlive = alive(P);
      var st = s.state;

      if (st === 'dormant') {
        if (L.playerMoved) awake(e, L);
      } else if (st === 'awaken') {
        if (s.t >= AWAKE_T) setState(s, 'hover');
      } else if (st === 'intro') {
        if (s.t >= INTRO_T) setState(s, 'hover');
      } else if (st === 'hover') {
        if (s.t >= ph.hover && pAlive) {
          setState(s, 'charge');
          fanAim(e, L);
          s.fired2 = false;
          AP.sfxAt('charge', e.x + e.w / 2, e.y + e.h / 2, { vol: 0.7, pitch: 0.8 });
        }
      } else if (st === 'charge') {
        if (s.t >= ph.charge) {
          if (pAlive) fireFan(e, L, false);
          setState(s, 'fire');
        }
      } else if (st === 'fire') {
        if (ph.double && !s.fired2 && s.t >= 0.42) { s.fired2 = true; if (pAlive) fireFan(e, L, true); }
        if (s.t >= (ph.double ? 0.55 : 0.15)) {
          setState(s, 'open');
          var pc = pal(L);
          AP.FX.ring(e.x + e.w / 2, e.y + e.h / 2, 8, 64, 0.35, pc.accent, 2.5);
          AP.FX.burst('w2.glint', e.x + e.w / 2, e.y + e.h / 2, { n: 8 });
          AP.sfxAt('chime', e.x + e.w / 2, e.y + e.h / 2, { vol: 0.7, pitch: 1.1 });
        }
      } else if (st === 'open') {
        if (s.t >= ph.open) setState(s, 'closing');
      } else if (st === 'closing') {
        if (s.t >= CLOSE_T) setState(s, 'hover');
      } else if (st === 'recoil') {
        if (s.t >= RECOIL_T) setState(s, 'hover');
      } else if (st === 'ascend') {
        var tr = tierOf(e, s.phase);
        if (!s.gateDone && s.t >= ASCEND_T * 0.45) {
          s.gateDone = true;
          openGate(e, L, tr);
        }
        if (s.t >= ASCEND_T) { setState(s, 'intro'); s.swayT = 0; }
      } else if (st === 'dying') {
        s.dieT += dt;
        if (s.t >= DIE_T) {
          setState(s, 'dead');
          var pd = pal(L);
          AP.FX.burst('w2.geode', e.x + e.w / 2, e.y + e.h / 2, { radius: 4, n: 34 });
          AP.FX.burst('w2.shatter', e.x + e.w / 2, e.y + e.h / 2, { n: 24, color: pd.primary });
          AP.sfxAt('explode', e.x + e.w / 2, e.y + e.h / 2, { vol: 0.8, pitch: 0.8 });
          e.visible = false;
          e.collidable = false;
        }
      }
      st = s.state;

      // independent pressure timers (phase 2+: walls, phase 3: shard fall)
      var active = st === 'hover' || st === 'charge' || st === 'fire' || st === 'open' || st === 'closing' || st === 'recoil';
      if (active && pAlive) {
        if (ph.walls) { s.wallT -= dt; if (s.wallT <= 0) { s.wallT = WALL_EVERY; raiseWalls(e, L); } }
        if (ph.shards) { s.shardT -= dt; if (s.shardT <= 0) { s.shardT = SHARD_EVERY; shardFall(e, L); } }
      }

      // flags: dangerous while armed, stompable only while the core is open
      e.hazard = st === 'hover' || st === 'charge' || st === 'fire';
      e.stompable = st === 'open';
      // visual state targets
      var openT = st === 'open' ? 1 : (st === 'closing' ? 1 - s.t / CLOSE_T : (st === 'recoil' ? Math.max(0, 0.6 - s.t) : 0));
      s.open = M.approach(s.open, openT, dt * 5);
      s.spike = M.approach(s.spike, e.hazard ? 1 : 0, dt * 6);
      s.charge = M.approach(s.charge, st === 'charge' ? 1 : 0, dt * (st === 'charge' ? 1 / Math.max(0.2, ph.charge) : 4));

      // movement
      var swayK = st === 'charge' || st === 'fire' ? 0 : (st === 'open' ? 0.22 : (st === 'recoil' ? 1.6 : 1));
      if (st !== 'dormant' && st !== 'dying' && st !== 'dead' && st !== 'ascend') s.swayT += dt * ph.swayRate * swayK * 0.5;
      var x, y;
      if (st === 'ascend') {
        var tr2 = tierOf(e, s.phase);
        var k = M.ease.inOutSine(M.clamp(s.t / ASCEND_T, 0, 1));
        x = s.fromX + (tr2.cx - s.fromX) * k;
        y = s.fromY + (tr2.cy - s.fromY) * k - Math.sin(k * Math.PI) * 30;
        s.cx = x; s.cy = y;
      } else if (st === 'dead' || st === 'dying') {
        x = s.cx + (st === 'dying' ? Math.sin(s.t * 60) * 3 * (s.t / DIE_T) : 0);
        y = s.cy;
      } else {
        anchorPos(e, L, tgt);
        if (st === 'dormant') { tgt.x = tierOf(e, 0).cx; tgt.y = tierOf(e, 0).cy + Math.sin(L.time * 1.3) * 5; }
        if (st === 'recoil') tgt.y -= 26 * Math.max(0, 1 - s.t * 2);
        var lam = st === 'recoil' ? 5 : (st === 'intro' ? 3 : 6);
        s.cx = M.damp(s.cx, tgt.x, lam, dt);
        s.cy = M.damp(s.cy, tgt.y, lam, dt);
        x = s.cx; y = s.cy;
      }
      e.x = x - e.w / 2;
      e.y = y - e.h / 2;
    },
    onStomp: function (e, P, L) {
      if (e.s.state !== 'open') return false;
      hit(e, L);
      return true;
    },
    onPlayerDeath: function (e, L) {
      L.clearMinions();
      var s = e.s;
      if (s.state === 'charge' || s.state === 'fire') setState(s, 'hover');
    },
    onRespawn: function (e, L) {
      var s = e.s;
      if (s.state === 'dead' || s.state === 'dying' || s.state === 'dormant') return;
      // back to the start of the current phase, with that phase's hits and arena
      s.hp = HP[s.phase];
      L.clearMinions();
      L.restoreTiles(s.snap);
      s.gateDone = true;
      s.wallT = 2.0; s.shardT = 1.6; s.wallIdx = 0;
      s.swayT = 0;
      s.charge = 0;
      setState(s, 'intro');
      e.hazard = false;
      e.stompable = false;
      L.intensity = PHASE[s.phase].intensity;
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
    },
    debugDamage: function (e, L) {
      var s = e.s;
      if (s.state === 'dying' || s.state === 'dead') return;
      if (s.state === 'dormant') awake(e, L);
      hit(e, L);
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var b = beatPulse();
      var i, a;
      // sealed gates (closed '#' cells the Monarch will smash)
      for (i = 1; i < s.tiers.length; i++) {
        var g = s.tiers[i].gate;
        if (!g || L.tileAt(g[0], g[1]) !== T.SOLID) continue;
        var gx = g[0] * 32, gy = g[1] * 32, gw = g[2] * 32, gh = g[3] * 32;
        if (L.cam && !L.cam.visible(gx, gy, gw, gh, 16)) continue;
        var gcx = gx + gw / 2, gcy = gy + gh / 2;
        AP.R.glow(ctx, gcx, gcy, 40, p.accent, 0.12 + 0.12 * b + (i === s.phase + 1 ? 0.15 : 0));
        ctx.strokeStyle = rgba(p.accent, 0.35 + 0.25 * b);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(gx + 2, gy + 2, gw - 4, gh - 4);
        ctx.beginPath();
        for (var c = 0; c < g[2]; c++) {
          var x0 = gx + c * 32 + 16, y0 = gcy;
          ctx.moveTo(x0 - 10, y0); ctx.lineTo(x0, y0 - 9); ctx.lineTo(x0 + 10, y0); ctx.lineTo(x0, y0 + 9); ctx.closePath();
        }
        ctx.stroke();
      }
      if (!e.visible || s.state === 'dead') return;
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      if (L.cam && !L.cam.visible(cx - 120, cy - 120, 240, 260, 32)) return;
      var flash = s.flash;
      var jx = 0, jy = 0;
      if (s.state === 'recoil') { jx = Math.sin(s.t * 70) * 4 * Math.max(0, 1 - s.t * 2); }
      if (s.state === 'dying') { var dq = s.t / DIE_T; jx = Math.sin(s.t * 80) * 4 * dq; jy = Math.cos(s.t * 63) * 3 * dq; }
      cx += jx; cy += jy;
      var dormant = s.state === 'dormant' ? 0.45 + 0.15 * Math.sin(L.time * 1.4) : 1;
      var openK = M.ease.outCubic(M.clamp(s.open, 0, 1));
      // ---- telegraph rays of the coming fan(s)
      if (s.charge > 0.01 && s.fanN > 1) {
        var ra = s.charge;
        ctx.setLineDash(RAY);
        ctx.lineDashOffset = -L.time * 90;
        ctx.lineWidth = 1.2 + 1.3 * ra;
        ctx.strokeStyle = rgba(p.accent, 0.2 + 0.55 * ra);
        ctx.beginPath();
        for (i = 0; i < s.fanN; i++) {
          var fa = fanBuf[i];
          ctx.moveTo(cx + Math.cos(fa) * 34, cy + Math.sin(fa) * 34);
          ctx.lineTo(cx + Math.cos(fa) * (60 + 300 * ra), cy + Math.sin(fa) * (60 + 300 * ra));
        }
        ctx.stroke();
        if (PHASE[s.phase].double) {
          ctx.strokeStyle = rgba(p.accent, 0.1 + 0.25 * ra);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (i = 0; i < s.fanN - 1; i++) {
            var fb = fanBuf[i] + s.fanStep * 0.5;
            ctx.moveTo(cx + Math.cos(fb) * 34, cy + Math.sin(fb) * 34);
            ctx.lineTo(cx + Math.cos(fb) * (50 + 220 * ra), cy + Math.sin(fb) * (50 + 220 * ra));
          }
          ctx.stroke();
        }
        ctx.setLineDash(NODASH);
        ctx.lineDashOffset = 0;
        AP.R.glow(ctx, cx, cy, 30 + 18 * ra, p.accent, 0.3 + 0.5 * ra);
      }
      // ---- aura
      AP.R.glow(ctx, cx, cy, 48, s.state === 'open' ? p.accent : p.primary, (0.3 + 0.2 * b) * dormant + 0.4 * flash);
      ctx.globalAlpha = dormant;
      // ---- orbiting satellite shards (3 + phase)
      var nsat = 3 + s.phase;
      for (i = 0; i < nsat; i++) {
        a = s.spin * 1.3 + i * TAU / nsat;
        var sr = 58 + 6 * Math.sin(L.time * 2 + i);
        var sx = cx + Math.cos(a) * sr, sy = cy + Math.sin(a) * sr * 0.55 + 4;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 3.5, sy); ctx.lineTo(sx, sy + 7); ctx.lineTo(sx - 3.5, sy);
        ctx.closePath();
        ctx.fillStyle = rgba(p.primary, 0.35);
        ctx.fill();
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // ---- body: an elongated hexagonal crystal, faceted from the core
      var bodyLift = -openK * 4;
      BODY[0] = cx; BODY[1] = cy - 46 + bodyLift;
      BODY[2] = cx + 31; BODY[3] = cy - 14;
      BODY[4] = cx + 25; BODY[5] = cy + 22;
      BODY[6] = cx; BODY[7] = cy + 52;
      BODY[8] = cx - 25; BODY[9] = cy + 22;
      BODY[10] = cx - 31; BODY[11] = cy - 14;
      if (AP.Art && AP.Art.crystal) {
        AP.Art.crystal(ctx, BODY, p, L.time, { alpha: 0.9, fill: p.primary, edge: flash > 0 ? AP.Color.mix(p.primary, p.ink, flash) : p.primary, glint: p.accent, width: 2.5, light: -2.0 });
      } else {
        ctx.beginPath();
        ctx.moveTo(BODY[0], BODY[1]);
        for (i = 2; i < 12; i += 2) ctx.lineTo(BODY[i], BODY[i + 1]);
        ctx.closePath();
        ctx.fillStyle = rgba(p.primary, 0.3);
        ctx.fill();
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      // ---- core (accent when open)
      var coreR = 10 + 3 * openK + 1.5 * b * openK;
      if (openK > 0.05) AP.R.glow(ctx, cx, cy, 26 + 14 * openK, p.accent, 0.5 + 0.4 * openK);
      AP.R.poly(ctx, cx, cy, coreR, 6, s.spin * 0.6);
      ctx.fillStyle = openK > 0.05 ? rgba(p.accent, 0.35 + 0.5 * openK) : rgba(p.bg, 0.9);
      ctx.fill();
      ctx.strokeStyle = openK > 0.05 ? p.accent : rgba(p.accent, 0.4);
      ctx.lineWidth = 2;
      ctx.stroke();
      if (openK > 0.3) {
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(cx, cy, 3 + 1.5 * b, 0, TAU);
        ctx.fill();
      }
      // ---- four shell plates: closed over the core, swung apart when open
      for (i = 0; i < 4; i++) {
        var pa = -Math.PI / 4 + i * Math.PI / 2;
        var swing = openK * 0.95 * (i % 2 ? 1 : -1);
        var off = 8 + 16 * openK;
        var ox = cx + Math.cos(pa) * off, oy = cy + Math.sin(pa) * off;
        var r1 = pa + swing;
        var c1 = Math.cos(r1), s1 = Math.sin(r1);
        ctx.beginPath();
        ctx.moveTo(ox - c1 * 2 - s1 * 11, oy - s1 * 2 + c1 * 11);
        ctx.lineTo(ox + c1 * 14, oy + s1 * 14);
        ctx.lineTo(ox - c1 * 2 + s1 * 11, oy - s1 * 2 - c1 * 11);
        ctx.lineTo(ox - c1 * 8, oy - s1 * 8);
        ctx.closePath();
        ctx.fillStyle = rgba(p.bg, 0.85);
        ctx.fill();
        ctx.fillStyle = rgba(p.primary, 0.4 + 0.3 * flash);
        ctx.fill();
        ctx.strokeStyle = flash > 0.2 ? p.ink : p.primary;
        ctx.lineWidth = 2;
        ctx.stroke();
        // hazard barbs while armed (spiky silhouette)
        if (s.spike > 0.02) {
          var sp = s.spike;
          var tx0 = ox + c1 * 14, ty0 = oy + s1 * 14;
          ctx.beginPath();
          ctx.moveTo(tx0 - s1 * 5, ty0 + c1 * 5);
          ctx.lineTo(tx0 + c1 * 11 * sp, ty0 + s1 * 11 * sp);
          ctx.lineTo(tx0 + s1 * 5, ty0 - c1 * 5);
          ctx.closePath();
          ctx.fillStyle = rgba(p.hazard, 0.6 * sp);
          ctx.fill();
          ctx.strokeStyle = rgba(p.hazard, sp);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
      // ---- side blades (hazard) along the waist while armed
      if (s.spike > 0.02) {
        ctx.fillStyle = rgba(p.hazard, 0.5 * s.spike);
        ctx.strokeStyle = rgba(p.hazard, s.spike);
        ctx.lineWidth = 1.5;
        for (var side = -1; side <= 1; side += 2) {
          ctx.beginPath();
          ctx.moveTo(cx + side * 28, cy - 18);
          ctx.lineTo(cx + side * (28 + 14 * s.spike), cy - 4);
          ctx.lineTo(cx + side * 26, cy + 6);
          ctx.lineTo(cx + side * (26 + 10 * s.spike), cy + 16);
          ctx.lineTo(cx + side * 23, cy + 22);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
      // ---- crown: five spikes over the brow, lifting as the shell opens
      var crY = cy - 50 + bodyLift - openK * 10 + Math.sin(L.time * 2.2) * 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 22, crY + 6);
      for (i = 0; i < 5; i++) {
        var px = cx - 18 + i * 9;
        var hgt = (i === 2 ? 22 : (i === 1 || i === 3 ? 15 : 10)) + 2 * b;
        ctx.lineTo(px - 3, crY);
        ctx.lineTo(px, crY - hgt);
        ctx.lineTo(px + 3, crY);
      }
      ctx.lineTo(cx + 22, crY + 6);
      ctx.closePath();
      ctx.fillStyle = rgba(p.ink, 0.18 + 0.2 * flash);
      ctx.fill();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      ctx.fillStyle = p.accent;
      for (i = 0; i < 5; i += 2) {
        var jx2 = cx - 18 + i * 9, jy2 = crY - (i === 2 ? 22 : 10) - 2 * b;
        ctx.beginPath();
        ctx.arc(jx2, jy2, i === 2 ? 3 : 2, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // ---- open: a landing target above the core (the damage method, telegraphed in accent)
      if (openK > 0.2 && s.state === 'open') {
        var ty1 = cy - 74 - 6 * b;
        ctx.strokeStyle = rgba(p.accent, 0.5 + 0.45 * b);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx - 12, ty1 - 8); ctx.lineTo(cx, ty1); ctx.lineTo(cx + 12, ty1 - 8);
        ctx.moveTo(cx - 9, ty1 - 18); ctx.lineTo(cx, ty1 - 10); ctx.lineTo(cx + 9, ty1 - 18);
        ctx.stroke();
        var rem = M.clamp(1 - s.t / PHASE[s.phase].open, 0, 1);
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(p.accent, 0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + TAU * rem);
        ctx.stroke();
      }
      // ---- dying: fractures spread across the body
      if (s.state === 'dying') {
        var dk = M.clamp(s.t / DIE_T, 0, 1);
        ctx.strokeStyle = rgba(p.ink, 0.5 + 0.5 * dk);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (i = 0; i < 7; i++) {
          a = i * TAU / 7 + 0.4;
          var len = 18 + 40 * dk;
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * len * 0.5 + Math.cos(a + 0.6) * 6, cy + Math.sin(a) * len * 0.5 + Math.sin(a + 0.6) * 6);
          ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        }
        ctx.stroke();
        AP.R.glow(ctx, cx, cy, 48, p.ink, 0.3 + 0.6 * dk);
      }
    }
  });
})(window.AP = window.AP || {});
