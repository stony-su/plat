/* js/engine/physics.js — owner: CORE */
(function (AP) {
  'use strict';

  // Celeste-model physics. Actors and solids have integer positions plus sub-unit remainders.
  // Actors never collide with each other; solids (kind 'solid') block actors unless oneWay.
  var T = AP.TILE;
  var C = AP.C;

  function tileCode(L, tx, ty) {
    if (tx < 0 || tx >= L.w || ty < 0) return T.SOLID;   // left, right and top out of bounds are solid
    if (ty >= L.h) return T.EMPTY;                       // the bottom is open (pits)
    return L.tiles[ty * L.w + tx];
  }

  function blocks(code) { return code === T.SOLID || code === T.BREAK; }

  // what the last blocking query hit (reused object)
  var lastHit = { other: null, tx: -1, ty: -1, code: 0 };
  // hit passed to move callbacks (reused object: copy fields if you need them after nested moves)
  var hit = { dir: 'x', sign: 0, other: null, tx: -1, ty: -1, code: 0 };

  // AABB vs SOLID/BREAK tiles and collidable non-oneWay solids (except `self`)
  function rectBlocked(L, x, y, w, h, self) {
    var tx0 = Math.floor(x / 32), tx1 = Math.ceil((x + w) / 32) - 1;
    var ty0 = Math.floor(y / 32), ty1 = Math.ceil((y + h) / 32) - 1;
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var c = tileCode(L, tx, ty);
        if (c === T.SOLID || c === T.BREAK) {
          lastHit.other = null; lastHit.tx = tx; lastHit.ty = ty; lastHit.code = c;
          return true;
        }
      }
    }
    var sol = L.solids;
    if (sol) {
      for (var i = 0; i < sol.length; i++) {
        var s = sol[i];
        if (s === self || !s.collidable || s.oneWay || s.dead) continue;
        if (x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y) {
          lastHit.other = s; lastHit.tx = -1; lastHit.ty = -1; lastHit.code = -1;
          return true;
        }
      }
    }
    return false;
  }

  // one-way surface exactly under e's bottom edge (tile '=' tops or collidable oneWay solids), shifted by dx
  function oneWayBelowAt(L, e, dx) {
    if ((e.dropT || 0) > 0) return false;
    var bottom = e.y + e.h;
    var x = e.x + (dx || 0);
    if (bottom % 32 === 0) {
      var ty = bottom / 32;
      if (ty >= 0 && ty < L.h) {
        var tx0 = Math.max(0, Math.floor(x / 32)), tx1 = Math.min(L.w - 1, Math.ceil((x + e.w) / 32) - 1);
        for (var tx = tx0; tx <= tx1; tx++) {
          if (L.tiles[ty * L.w + tx] === T.ONEWAY) {
            lastHit.other = null; lastHit.tx = tx; lastHit.ty = ty; lastHit.code = T.ONEWAY;
            return true;
          }
        }
      }
    }
    var sol = L.solids;
    if (sol) {
      for (var i = 0; i < sol.length; i++) {
        var s = sol[i];
        if (s === e || !s.collidable || !s.oneWay || s.dead) continue;
        if (s.y === bottom && x < s.x + s.w && x + e.w > s.x) {
          lastHit.other = s; lastHit.tx = -1; lastHit.ty = -1; lastHit.code = -1;
          return true;
        }
      }
    }
    return false;
  }

  function fillHit(dir, sign) {
    hit.dir = dir;
    hit.sign = sign;
    hit.other = lastHit.other;
    hit.tx = lastHit.tx;
    hit.ty = lastHit.ty;
    hit.code = lastHit.code;
    return hit;
  }

  function squishCb(h, a) { a.squish(); }

  var riderStacks = [];
  var depth = 0;

  var proto = {
    cx: function () { return this.x + this.w / 2; },
    cy: function () { return this.y + this.h / 2; },
    right: function () { return this.x + this.w; },
    bottom: function () { return this.y + this.h; },

    overlaps: function (o) {
      return !!o && this.x < o.x + o.w && this.x + this.w > o.x && this.y < o.y + o.h && this.y + this.h > o.y;
    },
    overlapsRect: function (x, y, w, h) {
      return this.x < x + w && this.x + this.w > x && this.y < y + h && this.y + this.h > y;
    },

    // SOLID/BREAK tiles + collidable non-oneWay solids except self, with the hitbox offset by (dx, dy)
    collideAt: function (dx, dy) {
      var L = AP.level;
      if (!L) return false;
      return rectBlocked(L, this.x + (dx || 0), this.y + (dy || 0), this.w, this.h, this);
    },

    // solid or one-way top directly under the bottom edge (hitbox offset by dx)
    groundAt: function (dx) {
      var L = AP.level;
      if (!L) return false;
      dx = dx || 0;
      if (rectBlocked(L, this.x + dx, this.y + 1, this.w, this.h, this)) return true;
      return oneWayBelowAt(L, this, dx);
    },

    // exact integer moves (no remainder change). Return true when blocked.
    moveXExact: function (n, cb) {
      var L = AP.level;
      var sign = n > 0 ? 1 : -1;
      while (n !== 0) {
        if (L && rectBlocked(L, this.x + sign, this.y, this.w, this.h, this)) {
          this.xRem = 0;
          if (cb) cb(fillHit('x', sign), this);
          return true;
        }
        this.x += sign;
        n -= sign;
      }
      return false;
    },

    moveYExact: function (n, cb) {
      var L = AP.level;
      var sign = n > 0 ? 1 : -1;
      while (n !== 0) {
        if (L && (rectBlocked(L, this.x, this.y + sign, this.w, this.h, this) || (sign > 0 && oneWayBelowAt(L, this, 0)))) {
          this.yRem = 0;
          if (cb) cb(fillHit('y', sign), this);
          return true;
        }
        this.y += sign;
        n -= sign;
      }
      return false;
    },

    // remainder-accumulating moves: round, 1u steps; on block rem=0 and cb(hit, e). Return true when blocked.
    moveX: function (amt, cb) {
      this.xRem += amt;
      var move = Math.round(this.xRem);
      if (move === 0) return false;
      this.xRem -= move;
      return this.moveXExact(move, cb);
    },

    moveY: function (amt, cb) {
      this.yRem += amt;
      var move = Math.round(this.yRem);
      if (move === 0) return false;
      this.yRem -= move;
      return this.moveYExact(move, cb);
    },

    // bottom == solid.y with horizontal overlap (oneWay also needs vy >= 0); the player also rides a solid
    // it is wall-sliding on (e.wallRide = side of that wall)
    isRiding: function (s) {
      if (!s || s === this || !s.collidable || s.dead) return false;
      if (this.y + this.h === s.y && this.x < s.x + s.w && this.x + this.w > s.x) {
        if (s.oneWay && (this.vy < 0 || (this.dropT || 0) > 0)) return false;
        return true;
      }
      var wr = this.wallRide || 0;
      if (wr !== 0 && !s.oneWay && this.y < s.y + s.h && this.y + this.h > s.y) {
        if (wr > 0 && this.x + this.w === s.x) return true;
        if (wr < 0 && this.x === s.x + s.w) return true;
      }
      return false;
    },

    // crushed by a moving solid: player tries 4u nudges, else dies ('crush'); others call def.onSquish or are removed
    squish: function () {
      var L = AP.level;
      if (this.type === 'player') {
        for (var k = 1; k <= 4; k++) {
          if (!this.collideAt(k, 0)) { this.x += k; return false; }
          if (!this.collideAt(-k, 0)) { this.x -= k; return false; }
          if (!this.collideAt(0, -k)) { this.y -= k; return false; }
          if (!this.collideAt(0, k)) { this.y += k; return false; }
        }
        if (L) L.killPlayer('crush');
        return true;
      }
      if (L) {
        if (this.def && typeof this.def.onSquish === 'function') L.hook(this, 'onSquish', L);
        else L.remove(this);
      }
      return true;
    },

    // moves a solid, carrying riders and pushing overlapped actors (oneWay solids carry but never push)
    moveSolid: function (dx, dy) {
      this.xRem += dx || 0;
      this.yRem += dy || 0;
      var mx = Math.round(this.xRem), my = Math.round(this.yRem);
      if (mx === 0 && my === 0) return;
      this.xRem -= mx;
      this.yRem -= my;
      var L = AP.level;
      if (!L || !L.actors) { this.x += mx; this.y += my; return; }
      var actors = L.actors;
      var riders = riderStacks[depth] || (riderStacks[depth] = []);
      riders.length = 0;
      var i, a;
      var carries = !(this.def && this.def.carry === false);
      if (this.collidable && carries) {
        for (i = 0; i < actors.length; i++) {
          a = actors[i];
          if (!a.dead && a.isRiding(this)) riders.push(a);
        }
      }
      depth++;
      var wasColl = this.collidable;
      if (mx !== 0) {
        this.x += mx;
        if (wasColl) {
          this.collidable = false;
          for (i = 0; i < actors.length; i++) {
            a = actors[i];
            if (a.dead) continue;
            if (!this.oneWay && this.overlaps(a)) {
              a.moveXExact(mx > 0 ? (this.x + this.w) - a.x : this.x - (a.x + a.w), squishCb);
            } else if (riders.indexOf(a) >= 0) {
              a.moveXExact(mx);
            }
          }
          this.collidable = true;
        }
      }
      if (my !== 0) {
        var oldTop = this.y;
        this.y += my;
        if (wasColl) {
          this.collidable = false;
          for (i = 0; i < actors.length; i++) {
            a = actors[i];
            if (a.dead) continue;
            if (!this.oneWay && this.overlaps(a)) {
              a.moveYExact(my > 0 ? (this.y + this.h) - a.y : this.y - (a.y + a.h), squishCb);
            } else if (riders.indexOf(a) >= 0) {
              a.moveYExact(my);
            } else if (this.oneWay && my < 0 && (a.dropT || 0) <= 0 && a.y + a.h <= oldTop && a.y + a.h > this.y &&
                a.x < this.x + this.w && a.x + a.w > this.x) {
              // a rising one-way platform catches actors it overtakes from below their feet (never squishes)
              a.moveYExact(this.y - (a.y + a.h));
            }
          }
          this.collidable = true;
        }
      }
      depth--;
      riders.length = 0;
    },

    // teleport: clears remainders and interpolation
    setPos: function (x, y) {
      this.x = x;
      this.y = y;
      this.xRem = 0;
      this.yRem = 0;
      this.px = x;
      this.py = y;
      this.rx = x;
      this.ry = y;
    }
  };

  function gravity(e, dt, mult, maxFall) {
    if (mult === undefined) mult = 1;
    if (maxFall === undefined) maxFall = C.MAX_FALL;
    e.vy = Math.min(e.vy + C.GRAVITY * mult * dt, maxFall);
    return e.vy;
  }

  function rectSolid(L, x, y, w, h, ignore) {
    L = L || AP.level;
    if (!L) return false;
    return rectBlocked(L, x, y, w, h, ignore || null);
  }

  // DDA over tiles + slab test against collidable non-oneWay solids. out {hit, x, y, dist, tx, ty, other}
  function raycast(L, x0, y0, dx, dy, maxDist, out) {
    out = out || { hit: false, x: 0, y: 0, dist: 0, tx: -1, ty: -1, other: null };
    L = L || AP.level;
    if (maxDist === undefined) maxDist = 2000;
    var len = Math.sqrt(dx * dx + dy * dy);
    out.hit = false; out.other = null; out.tx = -1; out.ty = -1;
    if (!L || len < 1e-9) { out.x = x0; out.y = y0; out.dist = 0; return out; }
    dx /= len;
    dy /= len;
    var best = maxDist;
    var hitTile = false, htx = -1, hty = -1;
    var tx = Math.floor(x0 / 32), ty = Math.floor(y0 / 32);
    if (blocks(tileCode(L, tx, ty))) {
      hitTile = true; best = 0; htx = tx; hty = ty;
    } else {
      var stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
      var tMaxX = dx !== 0 ? ((dx > 0 ? (tx + 1) * 32 - x0 : x0 - tx * 32) / Math.abs(dx)) : Infinity;
      var tMaxY = dy !== 0 ? ((dy > 0 ? (ty + 1) * 32 - y0 : y0 - ty * 32) / Math.abs(dy)) : Infinity;
      var tDX = dx !== 0 ? 32 / Math.abs(dx) : Infinity;
      var tDY = dy !== 0 ? 32 / Math.abs(dy) : Infinity;
      var t = 0;
      for (var guard = 0; guard < 8192; guard++) {
        if (tMaxX < tMaxY) { tx += stepX; t = tMaxX; tMaxX += tDX; } else { ty += stepY; t = tMaxY; tMaxY += tDY; }
        if (t > maxDist) break;
        if (ty > L.h + 1 && dy >= 0) break;
        if (blocks(tileCode(L, tx, ty))) { hitTile = true; best = t; htx = tx; hty = ty; break; }
      }
    }
    var sol = L.solids;
    if (sol) {
      for (var i = 0; i < sol.length; i++) {
        var s = sol[i];
        if (!s.collidable || s.oneWay || s.dead) continue;
        var t0 = 0, t1 = best;
        if (Math.abs(dx) < 1e-12) { if (x0 < s.x || x0 > s.x + s.w) continue; }
        else {
          var ax = (s.x - x0) / dx, bx = (s.x + s.w - x0) / dx;
          if (ax > bx) { var tmp = ax; ax = bx; bx = tmp; }
          t0 = Math.max(t0, ax); t1 = Math.min(t1, bx);
        }
        if (Math.abs(dy) < 1e-12) { if (y0 < s.y || y0 > s.y + s.h) continue; }
        else {
          var ay = (s.y - y0) / dy, by = (s.y + s.h - y0) / dy;
          if (ay > by) { var tmp2 = ay; ay = by; by = tmp2; }
          t0 = Math.max(t0, ay); t1 = Math.min(t1, by);
        }
        if (t0 <= t1 && t0 < best) { best = t0; out.other = s; }
      }
    }
    out.hit = hitTile || out.other !== null;
    out.dist = out.hit ? best : maxDist;
    out.x = x0 + dx * out.dist;
    out.y = y0 + dy * out.dist;
    if (!out.other) { out.tx = htx; out.ty = hty; }
    return out;
  }

  // ground under the leading edge (1u probe) for patrol AI
  function groundAhead(e, dir) {
    var L = AP.level;
    if (!L) return true;
    var px = dir > 0 ? e.x + e.w : e.x - 1;
    var py = e.y + e.h;
    if (rectBlocked(L, px, py, 1, 1, e)) return true;
    if (py % 32 === 0) {
      var tx = Math.floor(px / 32), ty = py / 32;
      if (tileCode(L, tx, ty) === T.ONEWAY) return true;
    }
    var sol = L.solids;
    for (var i = 0; i < sol.length; i++) {
      var s = sol[i];
      if (s === e || !s.collidable || !s.oneWay || s.dead) continue;
      if (s.y === py && px >= s.x && px < s.x + s.w) return true;
    }
    return false;
  }

  // patrol helper with gravity: walks e.s.dir (+1/-1, default from spec.dir), turns at walls (and ledges)
  function walk(e, dt, speed, opts) {
    var turnAtLedge = !opts || opts.turnAtLedge !== false;
    var s = e.s;
    if (s.dir !== 1 && s.dir !== -1) s.dir = (e.spec && e.spec.dir === 'left') ? -1 : 1;
    gravity(e, dt);
    if (turnAtLedge && e.groundAt(0) && !groundAhead(e, s.dir)) s.dir = -s.dir;
    e.vx = s.dir * speed;
    if (e.moveX(e.vx * dt)) s.dir = -s.dir;
    if (e.moveY(e.vy * dt)) e.vy = 0;
    return s.dir;
  }

  AP.Phys = {
    proto: proto,
    gravity: gravity,
    approach: AP.M.approach,
    rectSolid: rectSolid,
    raycast: raycast,
    walk: walk,
    groundAhead: groundAhead,
    tileCode: tileCode,
    blocks: blocks,
    oneWayBelow: function (e, dx) { var L = AP.level; return L ? oneWayBelowAt(L, e, dx || 0) : false; },
    lastHit: lastHit
  };
})(window.AP = window.AP || {});
