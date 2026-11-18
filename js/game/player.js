/* js/game/player.js — owner: CORE */
(function (AP) {
  'use strict';

  // The player: an actor, 22x22, floor anchor, layer 10. Step order follows CONTRACT section 2.15 exactly
  // (the TOOLS conformance numbers depend on it). Everything visual lives in P.vis / P.morph / P.ghosts.
  var C = AP.C;
  var M = AP.M;
  var T = AP.TILE;
  var TAU = Math.PI * 2;
  var R_POLY = 13;
  var TRAIL_N = 32;
  var GHOST_N = 5;
  var MORPH_MAX = 48;
  var FORM_SPIN = { 3: 1.25, 4: 0.95, 5: 1.0, 6: 0.9, 99: 0.8 };
  var PENTA = [0, 2, 4, 7, 9];

  var axis = { x: 0, y: 0 };
  var flatOut = { x: 0, y: 0 };

  function sidesOf(form) { return form >= 32 ? MORPH_MAX : ((form | 0) >= 3 ? form | 0 : 3); }
  function apothemOf(form) { return form >= 32 ? R_POLY : R_POLY * Math.cos(Math.PI / sidesOf(form)); }
  function flatRot(n) { return AP.R && AP.R.flatRot ? AP.R.flatRot(n) : -Math.PI / 2; }
  function sgn(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
  function input() { return AP.Input; }
  function isLevel(L) { return L && typeof L.hitstop === 'function'; }

  // ---------------------------------------------------------------- state helpers
  function abilitiesFor(f) { return AP.abilities ? AP.abilities(f) : { wall: f >= 4, double: f >= 5, dash: f >= 6, orbit: f >= 99 }; }

  function assistAir() {
    var st = AP.Save && AP.Save.data && AP.Save.data.settings;
    var a = st && st.assist;
    return !!(a && a.on && a.infiniteAir);
  }

  // point on a regular n-gon outline (radius R, rotation rot) in direction a, written into out
  function polyPointAt(n, rot, a, out) {
    if (n >= 32) { out.x = Math.cos(a) * R_POLY; out.y = Math.sin(a) * R_POLY; return out; }
    var step = TAU / n;
    var rel = M.mod(a - rot, TAU);
    var k = Math.floor(rel / step);
    var normal = rot + (k + 0.5) * step;
    var ap = R_POLY * Math.cos(Math.PI / n);
    var d = ap / Math.max(0.2, Math.cos(a - normal));
    out.x = Math.cos(a) * d;
    out.y = Math.sin(a) * d;
    return out;
  }

  // morph between two forms: vertices interpolate along the outline, new vertices emerge from the edges
  function startMorph(P, fromForm, toForm, dur) {
    var m = P.morph;
    var nFrom = sidesOf(fromForm), nTo = sidesOf(toForm);
    if (nFrom === nTo) { m.on = false; return; }
    var rFrom = flatRot(nFrom), rTo = flatRot(nTo);
    var n = Math.max(nFrom, nTo);
    var j, a;
    for (j = 0; j < n; j++) {
      if (nTo >= nFrom) {
        a = rTo + j * TAU / nTo;
        if (nTo >= 32) { m.dst[j * 2] = Math.cos(a) * R_POLY; m.dst[j * 2 + 1] = Math.sin(a) * R_POLY; }
        else { m.dst[j * 2] = Math.cos(a) * R_POLY; m.dst[j * 2 + 1] = Math.sin(a) * R_POLY; }
        polyPointAt(nFrom, rFrom, a, flatOut);
        m.src[j * 2] = flatOut.x; m.src[j * 2 + 1] = flatOut.y;
      } else {
        a = rFrom + j * TAU / nFrom;
        m.src[j * 2] = Math.cos(a) * R_POLY; m.src[j * 2 + 1] = Math.sin(a) * R_POLY;
        polyPointAt(nTo, rTo, a, flatOut);
        m.dst[j * 2] = flatOut.x; m.dst[j * 2 + 1] = flatOut.y;
      }
    }
    m.n = n;
    m.t = 0;
    m.dur = dur || 0.6;
    m.to = toForm;
    m.on = true;
    P.vis.rot = rTo;
    P.vis.rotV = 0;
  }

  // ---------------------------------------------------------------- public methods (attached in init)
  function setForm(f, opts) {
    var P = this;
    f = +f;
    if (!AP.FORMS || AP.FORMS.indexOf(f) < 0) f = 3;
    var prev = P.form;
    P.form = f;
    P.ab = abilitiesFor(f);
    if (!P.ab.double) P.hasDouble = false; else if (P.grounded) P.hasDouble = true;
    if (!P.ab.dash) P.hasDash = false; else if (P.grounded) P.hasDash = true;
    if (P.state === 'orbit' && !P.ab.orbit) detach(P, 0.5, null);
    if (prev && prev !== f && !(opts && opts.instant)) startMorph(P, prev, f, (opts && opts.dur) || 0.6);
    else if (prev !== f) { P.morph.on = false; P.vis.rot = flatRot(sidesOf(f)); }
    PlayerAPI.lastForm = f;
    return f;
  }

  function addForce(fx, fy) {
    this.fx += +fx || 0;
    this.fy += +fy || 0;
  }

  // launch(vx|null, vy|null, {refresh=true, noCut=true, lock=0})
  function launch(vx, vy, opts) {
    var P = this;
    var o = opts || {};
    if (P.state === 'dead' || P.state === 'respawn') return false;
    if (P.state === 'dash') { P.state = 'normal'; P.dashT = 0; }
    if (P.state === 'orbit') { P.state = 'normal'; P.orbitNode = null; P.orbitCdT = C.ORBIT_COOLDOWN; }
    if (vx !== null && vx !== undefined) P.vx = +vx;
    if (vy !== null && vy !== undefined) P.vy = +vy;
    if (o.refresh !== false) P.refresh();
    P.canCut = o.noCut === false ? P.vy < 0 : false;
    if (o.lock > 0) { P.launchLockT = o.lock; P.launchLockDir = sgn(P.vx); }
    P.grounded = false;
    P.coyoteT = 0;
    P.wallCoyoteT = 0;
    P.dashJumpQ = false;
    if (input()) input().consume('jump');
    if (P.vy < -1) { P.vis.sx = 0.76; P.vis.sy = 1.3; P.vis.sxV = 0; P.vis.syV = 0; }
    return true;
  }

  // refresh('double'|'dash'|undefined) -> true if anything was actually refilled
  function refresh(kind) {
    var P = this;
    var did = false;
    if ((kind === undefined || kind === null || kind === 'double') && P.ab.double && !P.hasDouble) { P.hasDouble = true; did = true; }
    if ((kind === undefined || kind === null || kind === 'dash') && P.ab.dash && !P.hasDash) { P.hasDash = true; did = true; }
    if (did) P.refillT = 0.35;
    return did;
  }

  function freeze(on) {
    var P = this;
    if (on) {
      if (P.state === 'dead' || P.state === 'respawn') return;
      if (P.state === 'orbit') { P.orbitNode = null; }
      P.state = 'frozen';
      P.vx = 0;
      P.vy = 0;
    } else if (P.state === 'frozen') {
      P.state = 'normal';
    }
  }

  function isDashing() { return this.state === 'dash'; }
  function isOrbiting() { return this.state === 'orbit'; }

  // ---- death / respawn (driven by LevelScene) ----
  function die() {
    var P = this;
    P.state = 'dead';
    P.vx = 0;
    P.vy = 0;
    P.fx = 0;
    P.fy = 0;
    P.orbitNode = null;
    P.dashT = 0;
    P.morph.on = false;
    P.deadT = 0;
    for (var i = 0; i < GHOST_N; i++) P.ghosts[i].on = false;
  }

  function respawnAt(x, y) {
    var P = this;
    P.setPos(x, y);
    P.state = 'respawn';
    P.respawnT = 0;
    P.vx = 0; P.vy = 0; P.fx = 0; P.fy = 0;
    P.coyoteT = 0; P.wallCoyoteT = 0; P.wallLockT = 0; P.launchLockT = 0; P.dashCdT = 0; P.orbitCdT = 0;
    P.dashT = 0; P.dropT = 0; P.dashJumpQ = false; P.canCut = false; P.flingT = 0;
    P.hasDouble = P.ab.double;
    P.hasDash = P.ab.dash;
    P.orbitNode = null;
    P.wall = 0;
    P.wallRide = 0;
    P.sliding = 0;
    P.grounded = P.groundAt(0);
    P.prevBottom = P.y + P.h;
    var v = P.vis;
    v.rot = flatRot(sidesOf(P.form)); v.rotV = 0; v.sx = 1; v.sy = 1; v.sxV = 0; v.syV = 0;
    v.eyeX = 3 * P.facing; v.eyeY = 0; v.offY = P.grounded ? (11 - apothemOf(P.form)) : 0;
    P.trailLen = 0;
    P.morph.on = false;
    if (input()) { input().consume('jump'); input().consume('dash'); }
  }

  function respawnDone() {
    var P = this;
    if (P.state !== 'respawn') return;
    P.state = 'normal';
    P.invuln = C.RESPAWN_INVULN;
    P.vis.sx = 1.18; P.vis.sy = 0.84;
  }

  // ---------------------------------------------------------------- movement with corrections
  // Player x-move: dash breaks BREAK tiles and continues; airborne/dash ledge correction <= LEDGE_CORRECT.
  function moveXP(P, amt, L) {
    P.xRem += amt;
    var move = Math.round(P.xRem);
    if (move === 0) return false;
    P.xRem -= move;
    var sign = move > 0 ? 1 : -1;
    var guard = 0;
    while (move !== 0 && guard++ < 4096) {
      if (P.collideAt(sign, 0)) {
        var h = AP.Phys.lastHit;
        if (P.state === 'dash' && h.other === null && h.code === T.BREAK && isLevel(L) && L.breakTile(h.tx, h.ty, 'dash')) continue;
        var dashing = P.state === 'dash';
        if (dashing || (!P.grounded && P.vy >= -60)) {
          if (!(dashing && P.dashDir.y > 0.1)) {
            var popped = false;
            for (var k = 1; k <= C.LEDGE_CORRECT; k++) {
              if (!P.collideAt(sign, -k) && !P.collideAt(0, -k)) {
                P.y -= k;
                P.x += sign;
                move -= sign;
                popped = true;
                P.ledgeT = 0.12;
                break;
              }
            }
            if (popped) continue;
          }
        }
        P.xRem = 0;
        onBlockX(P, sign, h);
        return true;
      }
      P.x += sign;
      move -= sign;
    }
    return false;
  }

  function onBlockX(P, sign, h) {
    if (P.state === 'orbit') return;
    if (P.state !== 'dash') P.vx = 0;
  }

  // Player y-move: one-way rules, dash breaks BREAK, ceiling corner correction <= CORNER_CORRECT
  function moveYP(P, amt, L) {
    P.yRem += amt;
    var move = Math.round(P.yRem);
    if (move === 0) return false;
    P.yRem -= move;
    var sign = move > 0 ? 1 : -1;
    var guard = 0;
    while (move !== 0 && guard++ < 4096) {
      var blocked = P.collideAt(0, sign);
      var h = AP.Phys.lastHit;
      if (!blocked && sign > 0 && AP.Phys.oneWayBelow(P, 0)) { blocked = true; h = AP.Phys.lastHit; }
      if (blocked) {
        if (P.state === 'dash' && h.other === null && h.code === T.BREAK && isLevel(L) && L.breakTile(h.tx, h.ty, 'dash')) continue;
        if (sign < 0 && P.state !== 'orbit') {
          // ceiling corner correction toward the direction of travel (both ways when not moving sideways)
          var corrected = false;
          var dirs = P.vx > 0.5 ? 1 : (P.vx < -0.5 ? -1 : 0);
          for (var k = 1; k <= C.CORNER_CORRECT && !corrected; k++) {
            if (dirs >= 0 && !P.collideAt(k, sign) && !P.collideAt(k, 0)) { P.x += k; corrected = true; }
            else if (dirs <= 0 && !P.collideAt(-k, sign) && !P.collideAt(-k, 0)) { P.x -= k; corrected = true; }
          }
          if (corrected) { P.xRem = 0; continue; }
        }
        P.yRem = 0;
        onBlockY(P, sign, h);
        return true;
      }
      P.y += sign;
      move -= sign;
    }
    return false;
  }

  function onBlockY(P, sign, h) {
    if (sign > 0) {
      P.impactVy = P.vy;
      P.landedOn = h.other || null;
      if (P.state !== 'dash' && P.state !== 'orbit') P.vy = 0;
    } else {
      if (P.state !== 'dash' && P.state !== 'orbit') {
        if (P.vy < -200 && P.state === 'normal') { P.vis.sx = 1.16; P.vis.sy = 0.86; }
        P.vy = 0;
      }
      P.canCut = false;
    }
  }

  // ---------------------------------------------------------------- orbit
  function nearestNode(P, L) {
    if (!isLevel(L) || typeof L.orbitNodes !== 'function') return null;
    var nodes = L.orbitNodes();
    var best = null, bd = C.ORBIT_RANGE * C.ORBIT_RANGE;
    var pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || n.dead || !n.active || n.orbitNode === false) continue;
      var dx = (n.x + n.w / 2) - pcx, dy = (n.y + n.h / 2) - pcy;
      var d2 = dx * dx + dy * dy;
      if (d2 <= bd) { bd = d2; best = n; }
    }
    return best;
  }

  function attach(P, node, L) {
    var ncx = node.x + node.w / 2, ncy = node.y + node.h / 2;
    var dx = P.x + P.w / 2 - ncx, dy = P.y + P.h / 2 - ncy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var th = dist > 1e-6 ? Math.atan2(dy, dx) : -Math.PI / 2;
    var st = Math.sin(th), ct = Math.cos(th);
    var vtan = P.vx * (-st) + P.vy * ct;
    // direction: sign of the tangential velocity, or facing (+1 = clockwise on screen) when below 1 u/s
    var dir = Math.abs(vtan) >= 1 ? (vtan > 0 ? 1 : -1) : (P.facing >= 0 ? 1 : -1);
    if (P.state === 'dash') { P.dashT = 0; }
    P.state = 'orbit';
    P.orbitNode = node;
    P.orbitR = M.clamp(dist, C.ORBIT_R_MIN, C.ORBIT_R_MAX);
    P.orbitTheta = th;
    P.orbitDir = dir;
    P.orbitS = Math.max(Math.abs(vtan), C.ORBIT_MIN_SPEED);
    P.orbitT = 0;
    P.canCut = false;
    P.grounded = false;
    P.coyoteT = 0;
    P.dashJumpQ = false;
    if (input()) input().consume('jump');
    AP.Events.emit('player:orbit', { node: node });
    AP.FX.burst('orbit', ncx, ncy);
    AP.sfxAt('orbit', ncx, ncy);
    if (AP.Save && AP.Save.stat) AP.Save.stat('orbits');
    P.vis.sx = 0.86; P.vis.sy = 0.86;
  }

  function detach(P, k, L) {
    var dir = P.orbitDir || 1;
    var th = P.orbitTheta || 0;
    var s = (P.orbitS || 0) * k;
    P.vx = -Math.sin(th) * dir * s;
    P.vy = Math.cos(th) * dir * s;
    P.state = 'normal';
    P.orbitNode = null;
    P.orbitCdT = C.ORBIT_COOLDOWN;
    P.canCut = false;
  }

  function release(P, L) {
    var dir = P.orbitDir;
    var th = P.orbitTheta;
    var tx = -Math.sin(th) * dir, ty = Math.cos(th) * dir;
    var ux = tx, uy = ty;
    if (axis.x !== 0 || axis.y !== 0) {
      var aa = Math.atan2(axis.y, axis.x);
      var ta = Math.atan2(ty, tx);
      if (Math.abs(M.angleDiff(ta, aa)) <= C.ORBIT_AIM_ASSIST_DEG * Math.PI / 180 + 1e-6) { ux = Math.cos(aa); uy = Math.sin(aa); }
    }
    var sp = Math.min(P.orbitS * C.ORBIT_RELEASE_MULT, 1150);
    var node = P.orbitNode;
    P.vx = ux * sp;
    P.vy = uy * sp;
    P.state = 'normal';
    P.orbitNode = null;
    P.orbitCdT = C.ORBIT_COOLDOWN;
    P.canCut = false;
    P.hasDouble = P.ab.double;
    P.hasDash = P.ab.dash;
    P.flingT = 0.55;
    P.coyoteT = 0;
    if (ux !== 0) P.facing = ux > 0 ? 1 : -1;
    var ang = Math.atan2(uy, ux);
    AP.Events.emit('player:fling', { speed: sp, angle: ang });
    AP.FX.burst('fling', P.x + P.w / 2, P.y + P.h / 2, { dir: ang });
    AP.sfxAt('fling', P.x + P.w / 2, P.y + P.h / 2, { pitch: 0.9 + sp / 2300 });
    if (isLevel(L)) { L.kick(ux * 5, uy * 5); L.shake(2.5, 0.12); }
    P.vis.sx = 1.25; P.vis.sy = 0.8;
    return node;
  }

  function orbitStep(P, dt, L) {
    var node = P.orbitNode;
    if (!node || node.dead) { detach(P, 0.5, L); return; }
    var s = P.orbitS;
    if (s < C.ORBIT_CRUISE) s = Math.min(C.ORBIT_CRUISE, s + C.ORBIT_ACCEL * dt);
    else s = Math.max(C.ORBIT_CRUISE, s - 300 * dt);
    var tdown = Math.cos(P.orbitTheta) * P.orbitDir;      // tangent . down
    s += 0.5 * C.GRAVITY * tdown * dt;
    if (s > C.ORBIT_MAX) s = C.ORBIT_MAX;
    if (s < 0) s = 0;
    P.orbitS = s;
    P.orbitT += dt;
    P.orbitTheta += P.orbitDir * s / P.orbitR * dt;
    var th = P.orbitTheta;
    var ncx = node.x + node.w / 2, ncy = node.y + node.h / 2;
    var tx = ncx + Math.cos(th) * P.orbitR, ty = ncy + Math.sin(th) * P.orbitR;
    var bx = moveXP(P, tx - (P.x + P.xRem + P.w / 2), L);
    var by = moveYP(P, ty - (P.y + P.yRem + P.h / 2), L);
    var tanx = -Math.sin(th) * P.orbitDir, tany = Math.cos(th) * P.orbitDir;
    if (bx || by) {
      detach(P, 0.5, L);
      AP.FX.burst('hit', P.x + P.w / 2, P.y + P.h / 2, { n: 4 });
      return;
    }
    P.vx = tanx * s;
    P.vy = tany * s;
    if (tanx !== 0) P.facing = tanx > 0 ? 1 : -1;
  }

  // ---------------------------------------------------------------- jumps
  function jumpFx(P, L, kind) {
    var cx = P.x + P.w / 2, by = P.y + P.h;
    var n = sidesOf(P.form);
    var pitch = 1 + (Math.min(n, 8) - 3) * 0.06 + (P.form >= 32 ? 0.1 : 0);
    if (kind === 'wall') {
      AP.sfxAt('walljump', cx, by, { pitch: pitch });
    } else if (kind === 'double') {
      AP.sfxAt('jump2', cx, by, { pitch: pitch });
      AP.sfxAt('burst', cx, by, { vol: 0.7 });
    } else {
      AP.sfxAt('jump', cx, by, { pitch: pitch });
    }
    if (kind === 'ground' || kind === 'coyote') AP.FX.burst('jump', cx, by);
    P.vis.sx = 0.82; P.vis.sy = 1.22; P.vis.sxV = 0; P.vis.syV = 0;
    AP.Events.emit('player:jump', { kind: kind });
    if (AP.Save && AP.Save.stat) AP.Save.stat('jumps');
  }

  function groundJump(P, L, kind) {
    P.vy = -C.JUMP_V;
    P.grounded = false;
    P.coyoteT = 0;
    P.canCut = true;
    P.dashJumpQ = false;
    input().consume('jump');
    jumpFx(P, L, kind);
  }

  function wallJump(P, L, side) {
    P.vx = -side * C.WALLJUMP_VX;
    P.vy = -C.WALLJUMP_VY;
    P.wallLockT = C.WALLJUMP_LOCK;
    P.wallLockDir = -side;
    P.facing = -side;
    P.canCut = true;
    P.wallCoyoteT = 0;
    P.coyoteT = 0;
    P.dashJumpQ = false;
    P.sliding = 0;
    input().consume('jump');
    var wx = side > 0 ? P.x + P.w : P.x;
    AP.FX.burst('walljump', wx, P.y + P.h / 2, { dir: side });
    jumpFx(P, L, 'wall');
    P.vis.sx = 0.8; P.vis.sy = 1.18;
  }

  function doubleJump(P, L) {
    P.vy = -C.DOUBLE_JUMP_V;
    P.hasDouble = false;
    P.canCut = true;
    P.dashJumpQ = false;
    input().consume('jump');
    var cx = P.x + P.w / 2, cy = P.y + P.h / 2;
    if (isLevel(L)) L.burst(cx, cy, C.BURST_RADIUS);
    AP.FX.burst('burst', cx, cy);
    P.burstT = 0.3;
    jumpFx(P, L, 'double');
  }

  // side of a wall within WALL_JUMP_DIST (+1 right, -1 left), else wall-coyote side, else 0
  function wallJumpSide(P, ax) {
    var d = C.WALL_JUMP_DIST;
    var r = P.collideAt(d, 0), l = P.collideAt(-d, 0);
    if (r && l) return ax !== 0 ? ax : P.facing;
    if (r) return 1;
    if (l) return -1;
    if (P.wallCoyoteT > 0 && P.wallCoyoteSide) return P.wallCoyoteSide;
    return 0;
  }

  function onOneWay(P) {
    return !P.collideAt(0, 1) && AP.Phys.oneWayBelow(P, 0);
  }

  // ---------------------------------------------------------------- dash
  function startDash(P, L) {
    var dx = axis.x, dy = axis.y;
    if (dx === 0 && dy === 0) dx = P.facing || 1;
    var len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
    P.dashDir.x = dx;
    P.dashDir.y = dy;
    P.state = 'dash';
    P.dashT = C.DASH_TIME;
    P.dashId++;
    P.hasDash = false;
    P.dashCdT = C.DASH_COOLDOWN;
    P.vx = dx * C.DASH_SPEED;
    P.vy = dy * C.DASH_SPEED;
    P.canCut = false;
    P.dashJumpQ = false;
    P.ghostT = 0;
    P.dashFxT = 0;
    if (dx !== 0) P.facing = dx > 0 ? 1 : -1;
    input().consume('dash');
    var cx = P.x + P.w / 2, cy = P.y + P.h / 2;
    var ang = Math.atan2(dy, dx);
    if (isLevel(L)) {
      L.hitstop(C.DASH_FREEZE);
      L.shake(3, 0.14);
      L.kick(dx * 6, dy * 6);
    }
    AP.FX.burst('dash', cx, cy, { dir: ang });
    AP.sfxAt('dash', cx, cy);
    AP.Events.emit('player:dash', { dx: dx, dy: dy });
    if (AP.Save && AP.Save.stat) AP.Save.stat('dashes');
    P.vis.sx = 1 + Math.abs(dx) * 0.3 - Math.abs(dy) * 0.18;
    P.vis.sy = 1 + Math.abs(dy) * 0.3 - Math.abs(dx) * 0.18;
    addGhost(P);
  }

  function endDash(P) {
    P.state = 'normal';
    P.dashT = 0;
    P.vx = P.dashDir.x > 0 ? C.DASH_END_SPEED : (P.dashDir.x < 0 ? -C.DASH_END_SPEED : 0);
    P.vy = P.dashDir.y * C.DASH_END_SPEED;
  }

  function addGhost(P) {
    var g = P.ghosts[P.ghostHead];
    P.ghostHead = (P.ghostHead + 1) % GHOST_N;
    g.on = true;
    g.x = P.x + P.w / 2;
    g.y = P.y + P.h / 2;
    g.rot = P.vis.rot;
    g.t = 0;
  }

  // ---------------------------------------------------------------- update (CONTRACT 2.15 order)
  function update(P, dt, L) {
    var I = input();
    // ---- 1. timers and input
    P.prevBottom = P.y + P.h;
    if (P.coyoteT > 0) P.coyoteT -= dt;
    if (P.wallCoyoteT > 0) P.wallCoyoteT -= dt;
    if (P.wallLockT > 0) P.wallLockT -= dt;
    if (P.launchLockT > 0) P.launchLockT -= dt;
    if (P.dashCdT > 0) P.dashCdT -= dt;
    if (P.orbitCdT > 0) P.orbitCdT -= dt;
    if (P.invuln > 0) P.invuln = Math.max(0, P.invuln - dt);
    if (P.dropT > 0) P.dropT -= dt;
    if (P.flingT > 0) P.flingT -= dt;
    if (P.refillT > 0) P.refillT -= dt;
    if (P.burstT > 0) P.burstT -= dt;
    if (P.ledgeT > 0) P.ledgeT -= dt;
    var st = P.state;
    if (st === 'dead') { P.deadT += dt; P.fx = 0; P.fy = 0; return; }
    if (st === 'respawn' || st === 'frozen') {
      if (st === 'respawn') P.respawnT += dt;
      P.fx = 0; P.fy = 0;
      visuals(P, dt, L, 0);
      return;
    }
    I.axis(axis);
    var ax = axis.x, ay = axis.y;
    if (ax !== 0 || ay !== 0 || I.pressed('jump') || I.pressed('dash')) { if (isLevel(L) && !L.playerMoved) { L.playerMoved = true; L.firstMoveTime = L.time; } }
    var jumpHeld = I.held('jump');
    var downHeld = ay > 0;
    var infAir = assistAir();
    if (infAir && !P.grounded) {
      if (P.ab.double) P.hasDouble = true;
      if (P.ab.dash) P.hasDash = true;
    }

    // ---- 2. orbit
    if (P.ab.orbit && P.state !== 'orbit' && I.held('orbit') && P.orbitCdT <= 0) {
      var node = nearestNode(P, L);
      if (node) attach(P, node, L);
    }
    if (P.state === 'orbit') {
      if (!I.held('orbit') || I.pressed('jump') || I.buffered('jump', 0)) {
        I.consume('jump');
        release(P, L);
      } else {
        orbitStep(P, dt, L);
        if (P.state === 'orbit') {
          P.fx = 0; P.fy = 0;
          postMove(P, dt, L, ax, false);
          return;
        }
      }
    }

    // ---- 3. dash
    if (P.state === 'dash') {
      if (P.dashT > 0) {
        if (I.pressed('jump')) P.dashJumpQ = true;
        P.vx = P.dashDir.x * C.DASH_SPEED;
        P.vy = P.dashDir.y * C.DASH_SPEED;
        P.dashT -= dt;
        P.ghostT += dt;
        if (P.ghostT >= 0.028) { P.ghostT = 0; addGhost(P); }
        P.dashFxT += dt;
        if (P.dashFxT >= 1 / 60) { P.dashFxT = 0; AP.FX.burst('dashTrail', P.x + P.w / 2, P.y + P.h / 2); }
        // ---- 8. move (dash)
        moveXP(P, P.vx * dt, L);
        moveYP(P, P.vy * dt, L);
        P.fx = 0; P.fy = 0;
        postMove(P, dt, L, ax, false);
        return;
      }
      endDash(P);
    } else if (P.ab.dash && P.hasDash && P.dashCdT <= 0 && I.buffered('dash', C.DASH_BUFFER)) {
      startDash(P, L);
      P.fx = 0; P.fy = 0;
      visuals(P, dt, L, ax);
      return;
    }

    // ---- 4. jump (first match wins)
    if (I.buffered('jump', C.JUMP_BUFFER) || P.dashJumpQ) {
      var side;
      if (downHeld && P.grounded && onOneWay(P)) {
        P.dropT = C.DROP_THROUGH;
        P.grounded = false;
        P.coyoteT = 0;
        P.dashJumpQ = false;
        I.consume('jump');
        P.vis.sx = 0.9; P.vis.sy = 1.1;
      } else if (P.grounded || P.coyoteT > 0) {
        groundJump(P, L, P.grounded ? 'ground' : 'coyote');
      } else if (P.ab.wall && (side = wallJumpSide(P, ax)) !== 0) {
        wallJump(P, L, side);
      } else if (P.ab.double && P.hasDouble) {
        doubleJump(P, L);
      } else if (P.dashJumpQ) {
        P.dashJumpQ = false;
      }
    }

    // ---- 5. jump cut
    if (P.canCut && P.vy < 0 && !jumpHeld) {
      P.vy *= C.JUMP_CUT;
      P.canCut = false;
    }
    if (P.vy >= 0) P.canCut = false;

    // ---- 6. horizontal speed
    var mx = ax;
    if (P.wallLockT > 0) mx = P.wallLockDir;
    else if (P.launchLockT > 0 && P.launchLockDir !== 0) mx = P.launchLockDir;
    if (mx !== 0) P.facing = mx;
    var vx = P.vx;
    var sv = vx > 0 ? 1 : (vx < 0 ? -1 : 0);
    if (P.grounded) {
      if (mx !== 0 && Math.abs(vx) > C.RUN && sv === mx) vx = M.approach(vx, mx * C.RUN, C.OVERSPEED_DECEL * dt);
      else if (mx !== 0 && (sv === 0 || sv === mx)) vx = M.approach(vx, mx * C.RUN, C.GROUND_ACCEL * dt);
      else vx = M.approach(vx, mx * C.RUN, C.GROUND_DECEL * dt);
    } else {
      if (mx !== 0 && Math.abs(vx) > C.RUN && sv === mx) vx = M.approach(vx, mx * C.RUN, C.OVERSPEED_DECEL * dt);
      else if (mx !== 0) vx = M.approach(vx, mx * C.RUN, C.AIR_ACCEL * dt);
      else vx = M.approach(vx, 0, C.AIR_DECEL * dt);
    }
    if (P.fx !== 0) {
      vx += P.fx * dt;
      if (vx > C.EXT_MAX_VX) vx = C.EXT_MAX_VX; else if (vx < -C.EXT_MAX_VX) vx = -C.EXT_MAX_VX;
    }
    P.vx = vx;

    // ---- 7. vertical speed
    var g = C.GRAVITY * ((Math.abs(P.vy) < C.HANG_V && jumpHeld) ? C.HANG_MULT : 1);
    P.vy = Math.min(P.vy + g * dt + P.fy * dt, downHeld ? C.FAST_FALL : C.MAX_FALL);
    P.sliding = 0;
    if (P.ab.wall && !P.grounded && P.vy > 0 && ax !== 0 && P.collideAt(ax, 0)) {
      if (P.vy > C.WALL_SLIDE_MAX) P.vy = C.WALL_SLIDE_MAX;
      P.sliding = ax;
    }
    P.wallRide = P.sliding;
    P.fx = 0;
    P.fy = 0;

    // ---- 8. move
    moveXP(P, P.vx * dt, L);
    moveYP(P, P.vy * dt, L);

    // ---- 9. post-move
    postMove(P, dt, L, ax, true);
  }

  function postMove(P, dt, L, ax, normal) {
    var wasGrounded = P.grounded;
    P.grounded = P.vy >= 0 && P.state !== 'orbit' && P.groundAt(0);
    if (P.grounded) {
      if (!wasGrounded) onLand(P, L);
      P.coyoteT = C.COYOTE;
      if (P.ab.double) P.hasDouble = true;
      if (P.ab.dash && P.state !== 'dash' && P.dashCdT <= 0) P.hasDash = true;
      P.landedT = (P.landedT || 0) + dt;
    } else {
      P.landedT = 0;
      P.impactVy = 0;   // airborne: no stale standing contact carries into the next landing
      if (wasGrounded) P.landedOn = null;
    }
    // walls (touching, airborne)
    var w = 0;
    if (!P.grounded) {
      if (P.collideAt(1, 0)) w = 1;
      else if (P.collideAt(-1, 0)) w = -1;
    }
    P.wall = w;
    if (w !== 0 && P.ab.wall) { P.wallCoyoteT = C.WALL_COYOTE; P.wallCoyoteSide = w; }
    // footsteps
    if (P.grounded && P.state === 'normal' && Math.abs(P.vx) > 40) {
      P.stepAcc += Math.abs(P.vx) * dt;
      if (P.stepAcc >= 44) {
        P.stepAcc = 0;
        P.stepAlt = !P.stepAlt;
        AP.sfxAt('step', P.x + P.w / 2, P.y + P.h, { vol: 0.28, pitch: P.stepAlt ? 1.06 : 0.96 });
        if (Math.abs(P.vx) > 220) AP.FX.burst('dust', P.x + P.w / 2 - sgn(P.vx) * 6, P.y + P.h, { n: 2, dir: P.vx > 0 ? Math.PI * 1.15 : -Math.PI * 0.15 });
      }
    } else if (!P.grounded) {
      P.stepAcc = 30;
    }
    // wall-slide sparks
    if (P.sliding !== 0) {
      P.sparkT = (P.sparkT || 0) + dt;
      if (P.sparkT > 0.05) {
        P.sparkT = 0;
        var sx = P.sliding > 0 ? P.x + P.w : P.x;
        AP.FX.burst('spark', sx, P.y + P.h - 3, { dir: P.sliding > 0 ? -Math.PI * 0.62 : -Math.PI * 0.38 });
      }
    }
    // dash ghosts age
    visuals(P, dt, L, ax);
  }

  function onLand(P, L) {
    // A fall that ends exactly flush with a surface is never blocked by moveY, so impactVy is 0 and landedOn
    // unset: take the fall speed P.vy still holds and the ground postMove's groundAt just found (AP.Phys.lastHit).
    var flush = !(P.impactVy > 0) && P.vy > 0;
    var v = Math.max(0, P.impactVy || 0, flush ? P.vy : 0);
    if (flush && AP.Phys.lastHit) P.landedOn = AP.Phys.lastHit.other || null;
    var k = M.clamp(v / 900, 0, 1.25);
    var cx = P.x + P.w / 2, by = P.y + P.h;
    if (v > 60) {
      AP.FX.burst('land', cx, by, { power: Math.max(0.25, k) });
      AP.sfxAt('land', cx, by, { vol: 0.3 + 0.7 * Math.min(1, k), pitch: 1.08 - 0.2 * Math.min(1, k) });
      P.vis.sx = 1 + 0.28 * Math.min(1, k + 0.15);
      P.vis.sy = 1 - 0.26 * Math.min(1, k + 0.15);
      P.vis.sxV = 0;
      P.vis.syV = 0;
      if (k > 0.7 && isLevel(L)) { L.kick(0, 3 * k); }
    }
    P.lastLandVy = v;
    AP.Events.emit('player:land', { vy: v });
    P.impactVy = 0;
  }

  // ---------------------------------------------------------------- visuals (springs, rotation, eye, trail)
  function visuals(P, dt, L, ax) {
    var v = P.vis;
    var n = sidesOf(P.form);
    var spin = FORM_SPIN[P.form] || 1;
    var st = P.state;
    if (st === 'orbit') {
      v.rot += (P.orbitDir || 1) * (P.orbitS || 0) / R_POLY * dt * 0.55;
      v.rotV = 0;
    } else if (st === 'dash') {
      v.rot += (P.dashDir.x >= 0 ? 1 : -1) * 22 * dt;
      v.rotV = 0;
    } else if (st === 'respawn' || st === 'frozen') {
      var tgt0 = nearestFlat(v.rot, n);
      v.rotV += ((tgt0 - v.rot) * 300 - v.rotV * 24) * dt;
      v.rot += v.rotV * dt;
    } else if (!P.grounded) {
      var rate = M.clamp(P.vx * 0.035, -12, 12) * spin;
      if (P.sliding !== 0) rate *= 0.15;
      v.rot += rate * dt;
      v.rotV = rate;
    } else {
      // spring to the nearest flat orientation (slightly underdamped: a satisfying settle)
      var tgt = nearestFlat(v.rot, n);
      v.rotV += ((tgt - v.rot) * 420 - v.rotV * 26) * dt;
      v.rot += v.rotV * dt;
      if (Math.abs(tgt - v.rot) < 1e-4 && Math.abs(v.rotV) < 1e-3) { v.rot = tgt; v.rotV = 0; }
    }
    if (v.rot > 1000 || v.rot < -1000) v.rot = M.mod(v.rot, TAU);
    // squash / stretch springs
    var tsx = 1, tsy = 1;
    if (P.sliding !== 0) { tsx = 0.88; tsy = 1.06; }
    if (st === 'dash') {
      tsx = 1 + Math.abs(P.dashDir.x) * 0.22 - Math.abs(P.dashDir.y) * 0.12;
      tsy = 1 + Math.abs(P.dashDir.y) * 0.22 - Math.abs(P.dashDir.x) * 0.12;
    } else if (!P.grounded && st === 'normal' && P.vy < -300) {
      tsx = 0.94; tsy = 1.07;
    }
    v.sxV += ((tsx - v.sx) * 520 - v.sxV * 20) * dt;
    v.syV += ((tsy - v.sy) * 520 - v.syV * 20) * dt;
    v.sx += v.sxV * dt;
    v.sy += v.syV * dt;
    v.sx = M.clamp(v.sx, 0.55, 1.6);
    v.sy = M.clamp(v.sy, 0.55, 1.6);
    // grounded polygons rest on their flat edge (the hitbox bottom); airborne ones are centred
    var offT = (P.grounded && st !== 'dash') ? (11 - apothemOf(P.form) * v.sy) : 0;
    v.offY += (offT - v.offY) * Math.min(1, dt * 22);
    // the eye leads the motion
    var ex = P.facing * 3.2 + M.clamp(P.vx / 300, -1.5, 1.5) * 1.6;
    var ey = M.clamp(P.vy / 500, -1, 1) * 3;
    if (P.sliding !== 0) ex = P.sliding * 4.2;
    v.eyeX += (ex - v.eyeX) * Math.min(1, dt * 16);
    v.eyeY += (ey - v.eyeY) * Math.min(1, dt * 16);
    // blink
    v.blinkT -= dt;
    if (v.blinkT < -0.12) v.blinkT = 2.2 + ((P.id * 7 + Math.floor(P.t * 3)) % 5) * 0.6;
    // morph progress
    if (P.morph.on) {
      P.morph.t += dt;
      if (P.morph.t >= P.morph.dur) P.morph.on = false;
    }
    // ghosts
    for (var i = 0; i < GHOST_N; i++) {
      var g = P.ghosts[i];
      if (!g.on) continue;
      g.t += dt;
      if (g.t > 0.24) g.on = false;
    }
    // trail ring buffer (centres)
    if (st !== 'dead') {
      P.trailHead = (P.trailHead + 1) % TRAIL_N;
      var e = P.trail[P.trailHead];
      e.x = P.x + P.w / 2;
      e.y = P.y + P.h / 2 + v.offY;
      e.rot = v.rot;
      e.form = P.form;
      if (P.trailLen < TRAIL_N) P.trailLen++;
    }
  }

  function nearestFlat(rot, n) {
    if (n >= 32) return rot;
    var base = flatRot(n);
    var step = TAU / n;
    return base + Math.round((rot - base) / step) * step;
  }

  // ---------------------------------------------------------------- rendering
  var pts = new Float32Array(MORPH_MAX * 2);
  var DEFAULT_STYLE = { fill: null, stroke: null, glow: null, eye: null };

  // builds the outline points (local, centred) for the current shape; returns the count
  function buildShape(P, rot, sx, sy, scale) {
    var m = P.morph;
    var n, i, x, y;
    var c = Math.cos(rot), s = Math.sin(rot);
    if (m.on) {
      var t = AP.M.ease.inOutSine(M.clamp(m.t / m.dur, 0, 1));
      n = m.n;
      var base = flatRot(sidesOf(m.to));
      var dr = rot - base;
      var cd = Math.cos(dr), sd = Math.sin(dr);
      for (i = 0; i < n; i++) {
        x = m.src[i * 2] + (m.dst[i * 2] - m.src[i * 2]) * t;
        y = m.src[i * 2 + 1] + (m.dst[i * 2 + 1] - m.src[i * 2 + 1]) * t;
        pts[i * 2] = (x * cd - y * sd) * sx * scale;
        pts[i * 2 + 1] = (x * sd + y * cd) * sy * scale;
      }
      return n;
    }
    n = sidesOf(P.form);
    if (n >= 32) n = 40;
    var step = TAU / n;
    for (i = 0; i < n; i++) {
      var a = i * step;
      x = Math.cos(a) * R_POLY;
      y = Math.sin(a) * R_POLY;
      pts[i * 2] = (x * c - y * s) * sx * scale;
      pts[i * 2 + 1] = (x * s + y * c) * sy * scale;
    }
    return n;
  }

  function pathShape(ctx, cx, cy, n) {
    ctx.beginPath();
    ctx.moveTo(cx + pts[0], cy + pts[1]);
    for (var i = 1; i < n; i++) ctx.lineTo(cx + pts[i * 2], cy + pts[i * 2 + 1]);
    ctx.closePath();
  }

  function styleFor(P) {
    if (AP.Cosmetics && typeof AP.Cosmetics.playerStyle === 'function') {
      var s = null;
      try { s = AP.Cosmetics.playerStyle(P.form); } catch (e) { AP.reportError('Cosmetics.playerStyle', e); s = null; }
      if (s) return s;
    }
    return DEFAULT_STYLE;
  }

  function drawDefaultTrail(ctx, P, pal, stroke) {
    var speed = Math.sqrt(P.vx * P.vx + P.vy * P.vy);
    var k = M.clamp((speed - 360) / 380, 0, 1);
    if (P.flingT > 0) k = Math.max(k, P.flingT / 0.55);
    if (k <= 0.02 || P.trailLen < 4) return;
    var n = sidesOf(P.form);
    if (n >= 32) n = 24;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    for (var i = 4; i < P.trailLen; i += 4) {
      var e = P.trail[(P.trailHead - i + TRAIL_N * 2) % TRAIL_N];
      var a = k * 0.32 * (1 - i / P.trailLen);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      AP.R.poly(ctx, e.x, e.y, R_POLY * (1 - i / (P.trailLen * 2.2)), n, e.rot);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // comet tail after a fling
    if (P.flingT > 0) {
      var fa = P.flingT / 0.55;
      ctx.globalCompositeOperation = 'lighter';
      for (var j = 1; j < P.trailLen; j++) {
        var e0 = P.trail[(P.trailHead - j + 1 + TRAIL_N * 2) % TRAIL_N];
        var e1 = P.trail[(P.trailHead - j + TRAIL_N * 2) % TRAIL_N];
        var f = 1 - j / P.trailLen;
        ctx.globalAlpha = fa * f * 0.85;
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1 + 9 * f;
        ctx.beginPath();
        ctx.moveTo(e0.x, e0.y);
        ctx.lineTo(e1.x, e1.y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  function render(P, ctx, L) {
    var pal = (L && L.pal) || AP.R.pal('title');
    var st = P.state;
    var R = AP.R;
    if (st === 'dead') return;
    var sty = styleFor(P);
    var stroke = sty.stroke || pal.ink;
    var fill = sty.fill || pal.accent;
    var glowC = sty.glow || pal.accent;
    var eyeC = sty.eye || pal.ink;
    var v = P.vis;
    var cx = P.rx + P.w / 2;
    var cy = P.ry + P.h / 2 + v.offY;
    var scale = P.exitScale === undefined ? 1 : P.exitScale;
    if (P.exitScale !== undefined && P.exitPull) { cx = P.exitPull.x; cy = P.exitPull.y; }

    if (st === 'respawn') { drawReassemble(ctx, P, pal, stroke, cx, cy); return; }

    // trail (cosmetic override first)
    var drew = false;
    if (AP.Cosmetics && typeof AP.Cosmetics.drawTrail === 'function') {
      try { drew = !!AP.Cosmetics.drawTrail(ctx, P); } catch (e) { AP.reportError('Cosmetics.drawTrail', e); drew = false; }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!drew) drawDefaultTrail(ctx, P, pal, stroke);

    // dash afterimages (hexagonal echoes in accent)
    var gn = sidesOf(P.form);
    if (gn >= 32) gn = 24;
    for (var gi = 0; gi < GHOST_N; gi++) {
      var g = P.ghosts[gi];
      if (!g.on) continue;
      var ga = 1 - g.t / 0.24;
      ctx.globalAlpha = 0.55 * ga;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2;
      R.poly(ctx, g.x, g.y, R_POLY * (1 + 0.25 * (1 - ga)), gn, g.rot);
      ctx.stroke();
      ctx.globalAlpha = 0.1 * ga;
      ctx.fillStyle = pal.accent;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // orbit tether
    if (st === 'orbit' && P.orbitNode) {
      var nd = P.orbitNode;
      var nx = nd.rx + nd.w / 2, ny = nd.ry + nd.h / 2;
      ctx.strokeStyle = AP.Color.rgba(pal.accent, 0.75);
      ctx.lineWidth = 1.5;
      ctx.setLineDash(DASH);
      ctx.lineDashOffset = -(P.t * 60) % 12;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.lineDashOffset = 0;
    }

    // invulnerability flicker
    var alpha = 1;
    if (P.invuln > 0 && st === 'normal') alpha = (Math.floor(P.invuln * 18) % 2 === 0) ? 0.45 : 0.95;
    if (P.exitScale !== undefined) alpha *= M.clamp(scale * 1.4, 0, 1);

    // glow: brighter with speed (circle) and while dashing / orbiting
    var speed = Math.sqrt(P.vx * P.vx + P.vy * P.vy);
    var gk = 0.32 + (st === 'dash' ? 0.45 : 0) + (st === 'orbit' ? 0.25 + 0.35 * M.clamp((P.orbitS - 420) / 580, 0, 1) : 0);
    if (P.form >= 32) gk += M.clamp(speed / 1000, 0, 1) * 0.4;
    if (P.refillT > 0) gk += P.refillT * 1.2;
    R.glow(ctx, cx, cy, 30 * scale, glowC, Math.min(1, gk) * alpha);

    var n = buildShape(P, v.rot, v.sx, v.sy, scale);
    ctx.globalAlpha = alpha;
    // inner fill
    pathShape(ctx, cx, cy, n);
    ctx.fillStyle = AP.Color.rgba(fill, 0.22);
    ctx.fill();
    // chromatic edge while dashing
    if (st === 'dash') {
      var px = -P.dashDir.y * 1.6, py = P.dashDir.x * 1.6;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 2;
      ctx.strokeStyle = AP.Color.rgba(pal.hazard, 0.7);
      pathShape(ctx, cx + px, cy + py, n);
      ctx.stroke();
      ctx.strokeStyle = AP.Color.rgba(pal.accent, 0.8);
      pathShape(ctx, cx - px, cy - py, n);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      pathShape(ctx, cx, cy, n);
    }
    // outline
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // circle form: a small radial notch shows the rolling rotation
    if (sidesOf(P.form) >= 32 && !P.morph.on) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(v.rot) * 7 * v.sx * scale, cy + Math.sin(v.rot) * 7 * v.sy * scale);
      ctx.lineTo(cx + Math.cos(v.rot) * 11 * v.sx * scale, cy + Math.sin(v.rot) * 11 * v.sy * scale);
      ctx.stroke();
    }
    // bright core
    ctx.fillStyle = AP.Color.rgba(stroke, 0.55);
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * scale, 0, TAU);
    ctx.fill();
    // eye
    if (v.blinkT > 0 || st !== 'normal') {
      ctx.fillStyle = eyeC;
      ctx.beginPath();
      ctx.arc(cx + v.eyeX * scale, cy + v.eyeY * scale, 2.5 * scale, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = eyeC;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + v.eyeX - 2.5, cy + v.eyeY);
      ctx.lineTo(cx + v.eyeX + 2.5, cy + v.eyeY);
      ctx.stroke();
    }
    // refill pip ring
    if (P.refillT > 0) {
      ctx.globalAlpha = alpha * Math.min(1, P.refillT * 3);
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      R.poly(ctx, cx, cy, R_POLY + 6 + (0.35 - P.refillT) * 30, sidesOf(P.form) >= 32 ? 48 : sidesOf(P.form), v.rot);
      ctx.stroke();
    }
    // resource pips (double jump / dash available) as tiny dots above the player when airborne
    if (!P.grounded && st !== 'frozen') {
      var py0 = cy - 21;
      var pipN = (P.ab.double ? 1 : 0) + (P.ab.dash ? 1 : 0);
      if (pipN) {
        var px0 = cx - (pipN - 1) * 4;
        if (P.ab.double) { pip(ctx, px0, py0, P.hasDouble, pal.accent, alpha); px0 += 8; }
        if (P.ab.dash) pip(ctx, px0, py0, P.hasDash, pal.ink, alpha);
      }
    }
    ctx.globalAlpha = 1;
  }

  var DASH = [5, 7];
  var NO_DASH = [];

  function pip(ctx, x, y, on, color, alpha) {
    ctx.globalAlpha = alpha * (on ? 0.9 : 0.25);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, on ? 2 : 1.5, 0, TAU);
    ctx.fill();
  }

  // respawn: edges converge from the screen edges toward the checkpoint and reassemble the polygon
  function drawReassemble(ctx, P, pal, stroke, cx, cy) {
    var k = M.clamp(P.respawnT / C.RESPAWN_TIME, 0, 1);
    var e = AP.M.ease.outCubic(k);
    var n = sidesOf(P.form);
    if (n >= 32) n = 12;
    var rot = P.vis.rot;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var a0 = rot + i * TAU / n, a1 = rot + (i + 1) * TAU / n;
      var mxp = (Math.cos(a0) + Math.cos(a1)) / 2, myp = (Math.sin(a0) + Math.sin(a1)) / 2;
      var ml = Math.sqrt(mxp * mxp + myp * myp) || 1;
      var far = 560 * (1 - e);
      var spin = (1 - e) * (i % 2 === 0 ? 2.4 : -2.4);
      var ox = mxp / ml * far, oy = myp / ml * far;
      var cs = Math.cos(spin), sn = Math.sin(spin);
      var x0 = Math.cos(a0) * R_POLY, y0 = Math.sin(a0) * R_POLY, x1 = Math.cos(a1) * R_POLY, y1 = Math.sin(a1) * R_POLY;
      var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      var hx0 = x0 - mx, hy0 = y0 - my, hx1 = x1 - mx, hy1 = y1 - my;
      ctx.globalAlpha = 0.25 + 0.75 * e;
      ctx.beginPath();
      ctx.moveTo(cx + ox + mx + hx0 * cs - hy0 * sn, cy + oy + my + hx0 * sn + hy0 * cs);
      ctx.lineTo(cx + ox + mx + hx1 * cs - hy1 * sn, cy + oy + my + hx1 * sn + hy1 * cs);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    AP.R.glow(ctx, cx, cy, 34, pal.accent, 0.6 * e);
  }

  // ---------------------------------------------------------------- init
  function init(P, spec, L) {
    var f = (L && L.form) || (spec && spec.form) || 3;
    if (!AP.FORMS || AP.FORMS.indexOf(f) < 0) f = 3;
    P.form = 0;
    P.ab = abilitiesFor(f);
    P.state = 'normal';
    P.grounded = false;
    P.wall = 0;
    P.facing = (spec && (spec.facing === -1 || spec.facing === 'left')) ? -1 : 1;
    P.vx = 0;
    P.vy = 0;
    P.fx = 0;
    P.fy = 0;
    P.prevBottom = P.y + P.h;
    P.hasDouble = P.ab.double;
    P.hasDash = P.ab.dash;
    P.dashDir = { x: P.facing, y: 0 };
    P.orbitNode = null;
    P.invuln = 0;
    P.vis = { rot: flatRot(sidesOf(f)), sx: 1, sy: 1, eyeX: 3 * P.facing, eyeY: 0, rotV: 0, sxV: 0, syV: 0, offY: 0, blinkT: 2.5 };
    P.trail = [];
    for (var i = 0; i < TRAIL_N; i++) P.trail.push({ x: P.x + P.w / 2, y: P.y + P.h / 2, rot: 0, form: f });
    P.trailHead = 0;
    P.trailLen = 0;
    P.ghosts = [];
    for (var g = 0; g < GHOST_N; g++) P.ghosts.push({ on: false, x: 0, y: 0, rot: 0, t: 0 });
    P.ghostHead = 0;
    P.ghostT = 0;
    P.dashFxT = 0;
    P.morph = { on: false, t: 0, dur: 0.6, n: 0, to: f, src: new Float32Array(MORPH_MAX * 2), dst: new Float32Array(MORPH_MAX * 2) };
    // timers
    P.coyoteT = 0; P.wallCoyoteT = 0; P.wallCoyoteSide = 0; P.wallLockT = 0; P.wallLockDir = 0;
    P.launchLockT = 0; P.launchLockDir = 0; P.dashCdT = 0; P.orbitCdT = 0; P.dashT = 0; P.dashId = 0;
    P.dashJumpQ = false; P.canCut = false; P.dropT = 0; P.flingT = 0; P.refillT = 0; P.burstT = 0; P.ledgeT = 0;
    P.orbitR = 0; P.orbitTheta = 0; P.orbitDir = 1; P.orbitS = 0; P.orbitT = 0;
    P.sliding = 0; P.wallRide = 0; P.stepAcc = 30; P.stepAlt = false; P.sparkT = 0;
    P.impactVy = 0; P.lastLandVy = 0; P.landedOn = null; P.landedT = 0;
    P.deadT = 0; P.respawnT = 0;
    // methods (shared functions; no per-instance closures)
    P.setForm = setForm;
    P.addForce = addForce;
    P.launch = launch;
    P.refresh = refresh;
    P.freeze = freeze;
    P.isDashing = isDashing;
    P.isOrbiting = isOrbiting;
    P.die = die;
    P.respawnAt = respawnAt;
    P.respawnDone = respawnDone;
    var last = PlayerAPI.lastForm;
    P.setForm(f, { instant: true });
    if (last && last !== f && AP.FORMS.indexOf(last) >= 0) startMorph(P, last, f, 0.6);
    P.grounded = P.groundAt(0);
    P.vis.offY = P.grounded ? (11 - apothemOf(f)) : 0;
    P.coyoteT = P.grounded ? C.COYOTE : 0;
  }

  AP.Entities.register('player', {
    kind: 'actor', w: C.PLAYER_W, h: C.PLAYER_H, anchor: 'floor', layer: 10, lint: 'ignore',
    renderPad: 180, alwaysRender: true,
    init: init, update: update, render: render
  });

  var PlayerAPI = {
    lastForm: 0,
    sides: sidesOf,
    apothem: apothemOf,
    radius: R_POLY,
    nearestFlat: nearestFlat,
    startMorph: startMorph,
    pentatonic: PENTA
  };
  AP.Player = PlayerAPI;
})(window.AP = window.AP || {});
