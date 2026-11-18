/* tools/lib/sim.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // Standalone model of the CONTRACT §2.15 player (steps 3–9; orbit step 2 as a helper) used by
  // tools/phys-test.js (part a) and by the SAFE / EXPERT reachability bots (tools/lib/reach.js).
  //
  //   Celeste model: integer position + sub-unit remainder; moveX then moveY in 1u steps
  //   (with a whole-move fast path when the swept box is free). One-way tops block only a 1u
  //   downward step when the actor's bottom equals the top and dropT ≤ 0.
  //
  // Models (CONTRACT §3 "Reachability bot"):
  //   SAFE    RUN ×0.95, every launch velocity ×0.97, no hang, no coyote, no corner/ledge
  //           correction, takeoff/landing overlap ≥ 8u.
  //   EXPERT  exact constants, hang, coyote, corner (ceiling) + ledge correction, overlap ≥ 2u.
  //   EXACT   EXPERT physics, used by phys-test.

  const fs = require('fs');
  const vm = require('vm');
  const cli = require('./cli');

  // Verbatim CONTRACT §2.2 numbers, used only when js/core/const.js is missing or broken.
  const FALLBACK_C = Object.freeze({
    T: 32, VIEW_W: 960, VIEW_H: 540, STEP: 1 / 120, MAX_FRAME_DT: 0.1, MAX_STEPS: 12,
    PLAYER_W: 22, PLAYER_H: 22,
    GRAVITY: 2400, MAX_FALL: 900, FAST_FALL: 1100,
    JUMP_V: 733, JUMP_CUT: 0.45, HANG_V: 80, HANG_MULT: 0.5,
    RUN: 300, GROUND_ACCEL: 3000, GROUND_DECEL: 3600, AIR_ACCEL: 2200, AIR_DECEL: 1200, OVERSPEED_DECEL: 400,
    COYOTE: 0.10, JUMP_BUFFER: 0.12, CORNER_CORRECT: 8, LEDGE_CORRECT: 8, DROP_THROUGH: 0.15,
    WALL_SLIDE_MAX: 140, WALL_JUMP_DIST: 4, WALL_COYOTE: 0.08,
    WALLJUMP_VX: 340, WALLJUMP_VY: 680, WALLJUMP_LOCK: 0.12,
    DOUBLE_JUMP_V: 650, BURST_RADIUS: 64,
    DASH_SPEED: 760, DASH_TIME: 0.14, DASH_END_SPEED: 300, DASH_COOLDOWN: 0.20, DASH_FREEZE: 0.03, DASH_BUFFER: 0.08,
    ORBIT_RANGE: 110, ORBIT_R_MIN: 40, ORBIT_R_MAX: 110, ORBIT_MIN_SPEED: 420, ORBIT_CRUISE: 800,
    ORBIT_ACCEL: 1200, ORBIT_MAX: 1000, ORBIT_RELEASE_MULT: 1.15, ORBIT_AIM_ASSIST_DEG: 45, ORBIT_COOLDOWN: 0.20,
    BOUNCE_V: 1040, BOUNCE_SIDE_VX: 700, BOUNCE_SIDE_VY: 420,
    STOMP_V: 520, STOMP_V_HELD: 733, STOMP_TOL: 8,
    EXT_MAX_VX: 600,
    DEATH_TIME: 0.5, RESPAWN_TIME: 0.3, RESPAWN_INVULN: 0.6,
    CRUMBLE_DELAY: 0.45, CRUMBLE_RESPAWN: 2.5, HITSTOP_MAX: 0.12, PIT_MARGIN: 64,
    SPIKE_DEPTH: 14, SPIKE_INSET: 3, ONEWAY_THICK: 8,
    CHUNK: 256, CHUNK_CACHE: 48, CHUNK_PX_MAX: 2, PARTICLES_MAX: 1800,
    LINT_RUN_FACTOR: 0.95, LINT_VEL_FACTOR: 0.97, LINT_LEDGE_OVERLAP: 8
  });
  const TILE = Object.freeze({ EMPTY: 0, SOLID: 1, ONEWAY: 2, SPIKE_U: 3, SPIKE_D: 4, SPIKE_L: 5, SPIKE_R: 6, BREAK: 7, FAKE: 8 });

  let constCache = null;
  // Hot-path constants must be a fast-mode object: Object.freeze / Object.assign on an
  // 80-key object can leave V8 in dictionary mode (≈3× slower reads), JSON.parse does not.
  function fastCopy(src) { return JSON.parse(JSON.stringify(src)); }
  // → {C, from, diffs:[keys whose value differs from the contract]}
  function constants() {
    if (constCache) return constCache;
    let C = fastCopy(FALLBACK_C), from = 'built-in copy of CONTRACT §2.2';
    const diffs = [];
    try {
      if (cli.exists('js/core/const.js')) {
        const ctx = vm.createContext({});
        vm.runInContext('var window = this;', ctx);
        new vm.Script(cli.read('js/core/const.js'), { filename: cli.abs('js/core/const.js') }).runInContext(ctx);
        const AP = vm.runInContext('this.AP', ctx);
        if (AP && AP.C && typeof AP.C.GRAVITY === 'number') {
          C = fastCopy(AP.C);
          from = 'js/core/const.js';
          for (const k of Object.keys(FALLBACK_C)) if (C[k] !== FALLBACK_C[k]) diffs.push(k);
        }
      }
    } catch (e) { from = 'built-in copy (js/core/const.js failed: ' + e.message + ')'; }
    constCache = { C, from, diffs };
    return constCache;
  }

  function makeModel(kind, form, C) {
    C = C || constants().C;
    const safe = kind === 'SAFE';
    const vf = safe ? C.LINT_VEL_FACTOR : 1;
    form = form | 0;
    return {
      kind, form, C, safe, vf,
      run: C.RUN * (safe ? C.LINT_RUN_FACTOR : 1),
      jumpV: C.JUMP_V * vf,
      djV: C.DOUBLE_JUMP_V * vf,
      wjVX: C.WALLJUMP_VX * vf,
      wjVY: C.WALLJUMP_VY * vf,
      dashV: C.DASH_SPEED * vf,
      dashEnd: C.DASH_END_SPEED * vf,
      bounceV: C.BOUNCE_V * vf,
      bounceSideVX: C.BOUNCE_SIDE_VX * vf,
      bounceSideVY: C.BOUNCE_SIDE_VY * vf,
      orbitRelease: C.ORBIT_CRUISE * C.ORBIT_RELEASE_MULT * vf,   // ≈ 920 × factor (CONTRACT §3)
      hang: !safe,
      coyote: !safe,
      corner: !safe,
      ledge: !safe,
      overlap: safe ? C.LINT_LEDGE_OVERLAP : 2,
      wall: form >= 4,
      double: form >= 5,
      dash: form >= 6,
      orbit: form >= 99
    };
  }

  // ------------------------------------------------------------------ collision grid
  const F_BLOCK = 1, F_ONEWAY = 2, F_SPIKE = 4, F_SOLIDR = 8, F_STANDR = 16, F_HAZR = 32, F_GOAL = 64, F_BOUNCE = 128;

  function overl(ax, ay, aw, ah, r) { return ax < r.x + r.w && ax + aw > r.x && ay < r.y + r.h && ay + ah > r.y; }

  class Grid {
    // w,h in tiles. code: effective tile codes (only SOLID, ONEWAY, spikes, EMPTY matter).
    constructor(w, h) {
      this.w = w | 0; this.h = h | 0;
      this.pw = this.w * 32; this.ph = this.h * 32;
      const n = Math.max(1, this.w * this.h);
      this.code = new Uint8Array(n);
      this.flags = new Uint8Array(n);
      this.solidR = []; this.standR = []; this.hazardR = []; this.goalR = []; this.bounceR = []; this.orbitP = [];
      this.bSolid = null; this.bStand = null; this.bHaz = null; this.bGoal = null; this.bBounce = null; this.bOrbit = null;
      this.C = constants().C;
      this.sr = [0, 0, 0, 0];
      this.goalCount = 0;
      this.built = false;
    }
    setTile(tx, ty, code) { if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.code[ty * this.w + tx] = code; }
    tile(tx, ty) {
      if (tx < 0 || tx >= this.w || ty < 0) return TILE.SOLID;
      if (ty >= this.h) return TILE.EMPTY;
      return this.code[ty * this.w + tx];
    }
    // rect lists (world units). kind-specific extras: goal {gi}, bounce {dir}, orbit point {x,y,group}
    addSolid(x, y, w, h, src) { this.solidR.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), src: src || null }); }
    addStand(x, y, w, h, src) { this.standR.push({ x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), src: src || null }); }
    addHazard(x, y, w, h, src) { this.hazardR.push({ x, y, w, h, src: src || null }); }
    addGoal(x, y, w, h, gi, src) { this.goalR.push({ x, y, w, h, gi, src: src || null }); this.goalCount = Math.max(this.goalCount, gi + 1); }
    addBounce(x, y, w, h, dir, src, id) { this.bounceR.push({ x, y, w, h, dir: dir || 'up', src: src || null, id }); }
    addOrbit(x, y, group, src, id) { this.orbitP.push({ x, y, group, src: src || null, id }); }

    build() {
      const n = this.w * this.h;
      const W = this.w;
      for (let i = 0; i < n; i++) {
        const c = this.code[i];
        let f = 0;
        if (c === TILE.SOLID || c === TILE.BREAK) f |= F_BLOCK;
        else if (c === TILE.ONEWAY) f |= F_ONEWAY;
        else if (c >= TILE.SPIKE_U && c <= TILE.SPIKE_R) f |= F_SPIKE;
        this.flags[i] = f;
      }
      const bucket = (list, flag) => {
        const b = new Array(n).fill(null);
        for (const r of list) {
          const tx0 = Math.max(0, Math.floor(r.x / 32)), tx1 = Math.min(W - 1, Math.floor((r.x + r.w - 0.0001) / 32));
          const ty0 = Math.max(0, Math.floor(r.y / 32)), ty1 = Math.min(this.h - 1, Math.floor((r.y + r.h - 0.0001) / 32));
          for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
            const i = ty * W + tx;
            (b[i] || (b[i] = [])).push(r);
            this.flags[i] |= flag;
          }
        }
        return b;
      };
      this.bSolid = bucket(this.solidR, F_SOLIDR);
      this.bStand = bucket(this.standR, F_STANDR);
      this.bHaz = bucket(this.hazardR, F_HAZR);
      this.bGoal = bucket(this.goalR, F_GOAL);
      this.bBounce = bucket(this.bounceR, F_BOUNCE);
      // orbit influence: per cell, the points whose ORBIT_RANGE disc can contain a player center in the cell
      const R = this.C.ORBIT_RANGE;
      this.bOrbit = new Array(n).fill(null);
      for (const p of this.orbitP) {
        const tx0 = Math.max(0, Math.floor((p.x - R) / 32)), tx1 = Math.min(W - 1, Math.floor((p.x + R) / 32));
        const ty0 = Math.max(0, Math.floor((p.y - R) / 32)), ty1 = Math.min(this.h - 1, Math.floor((p.y + R) / 32));
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          const i = ty * W + tx;
          (this.bOrbit[i] || (this.bOrbit[i] = [])).push(p);
        }
      }
      this.built = true;
      return this;
    }

    // AABB vs SOLID/BREAK(blocking) tiles and solid rects. Out of bounds: left/right/top solid, bottom open.
    blocked(x, y, w, h) {
      const tx0 = Math.floor(x / 32), tx1 = Math.floor((x + w - 1) / 32);
      const ty0 = Math.floor(y / 32);
      let ty1 = Math.floor((y + h - 1) / 32);
      if (tx0 < 0 || tx1 >= this.w || ty0 < 0) return true;
      if (ty1 >= this.h) ty1 = this.h - 1;
      const W = this.w, flags = this.flags;
      for (let ty = ty0; ty <= ty1; ty++) {
        let i = ty * W + tx0;
        for (let tx = tx0; tx <= tx1; tx++, i++) {
          const f = flags[i];
          if (f & F_BLOCK) return true;
          if (f & F_SOLIDR) {
            const b = this.bSolid[i];
            for (let k = 0; k < b.length; k++) if (overl(x, y, w, h, b[k])) return true;
          }
        }
      }
      return false;
    }
    // A one-way top exactly at y == bottom under the span [x, x+w).
    oneWayAt(x, w, bottom) {
      if (bottom < 0) return false;
      const W = this.w;
      const tx0 = Math.max(0, Math.floor(x / 32)), tx1 = Math.min(W - 1, Math.floor((x + w - 1) / 32));
      if (bottom % 32 === 0) {
        const r = bottom / 32;
        if (r < this.h) for (let tx = tx0; tx <= tx1; tx++) if (this.flags[r * W + tx] & F_ONEWAY) return true;
      }
      const ry = Math.floor(bottom / 32);
      if (ry < this.h) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const i = ry * W + tx;
          if (!(this.flags[i] & F_STANDR)) continue;
          const b = this.bStand[i];
          for (let k = 0; k < b.length; k++) { const r = b[k]; if (r.y === bottom && x < r.x + r.w && x + w > r.x) return true; }
        }
      }
      return false;
    }
    // Any one-way top T with b0 ≤ T ≤ b1 under the span (fast-path guard for downward moves).
    oneWayBetween(x, w, b0, b1) {
      if (b1 < 0) return false;
      const W = this.w;
      const tx0 = Math.max(0, Math.floor(x / 32)), tx1 = Math.min(W - 1, Math.floor((x + w - 1) / 32));
      const r0 = Math.max(0, Math.floor(b0 / 32)), r1 = Math.min(this.h - 1, Math.floor(b1 / 32));
      for (let r = r0; r <= r1; r++) {
        const top = r * 32;
        for (let tx = tx0; tx <= tx1; tx++) {
          const i = r * W + tx;
          const f = this.flags[i];
          if ((f & F_ONEWAY) && top >= b0 && top <= b1) return true;
          if (f & F_STANDR) {
            const b = this.bStand[i];
            for (let k = 0; k < b.length; k++) { const s = b[k]; if (s.y >= b0 && s.y <= b1 && x < s.x + s.w && x + w > s.x) return true; }
          }
        }
      }
      return false;
    }
    spikeRect(c, tx, ty, out) {
      const C = this.C, D = C.SPIKE_DEPTH, IN = C.SPIKE_INSET;
      const x = tx * 32, y = ty * 32;
      if (c === TILE.SPIKE_U) { out[0] = x + IN; out[1] = y + 32 - D; out[2] = 32 - 2 * IN; out[3] = D; }
      else if (c === TILE.SPIKE_D) { out[0] = x + IN; out[1] = y; out[2] = 32 - 2 * IN; out[3] = D; }
      else if (c === TILE.SPIKE_L) { out[0] = x + 32 - D; out[1] = y + IN; out[2] = D; out[3] = 32 - 2 * IN; }
      else { out[0] = x; out[1] = y + IN; out[2] = D; out[3] = 32 - 2 * IN; }
      return out;
    }
    // hazard overlap: spike hurtboxes + hazard rects. Returns 0 or a cause code (1 spike, 2 hazard rect)
    hazardAt(x, y, w, h) {
      const W = this.w;
      const tx0 = Math.max(0, Math.floor(x / 32)), tx1 = Math.min(W - 1, Math.floor((x + w - 1) / 32));
      const ty0 = Math.max(0, Math.floor(y / 32)), ty1 = Math.min(this.h - 1, Math.floor((y + h - 1) / 32));
      const sr = this.sr;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const i = ty * W + tx;
          const f = this.flags[i];
          if (f & F_SPIKE) {
            this.spikeRect(this.code[i], tx, ty, sr);
            if (x < sr[0] + sr[2] && x + w > sr[0] && y < sr[1] + sr[3] && y + h > sr[1]) return 1;
          }
          if (f & F_HAZR) {
            const b = this.bHaz[i];
            for (let k = 0; k < b.length; k++) if (overl(x, y, w, h, b[k])) return 2;
          }
        }
      }
      return 0;
    }
    // OR of the special flags (spike, hazard rect, goal, bounce) of the cells overlapped
    specialFlags(x, y, w, h) {
      const W = this.w;
      const tx0 = Math.max(0, Math.floor(x / 32)), tx1 = Math.min(W - 1, Math.floor((x + w - 1) / 32));
      const ty0 = Math.max(0, Math.floor(y / 32)), ty1 = Math.min(this.h - 1, Math.floor((y + h - 1) / 32));
      let f = 0;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) f |= this.flags[ty * W + tx];
      return f & (F_SPIKE | F_HAZR | F_GOAL | F_BOUNCE);
    }
    goalsAt(x, y, w, h) {
      const W = this.w;
      const tx0 = Math.max(0, Math.floor(x / 32)), tx1 = Math.min(W - 1, Math.floor((x + w - 1) / 32));
      const ty0 = Math.max(0, Math.floor(y / 32)), ty1 = Math.min(this.h - 1, Math.floor((y + h - 1) / 32));
      let m = 0;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * W + tx;
        if (!(this.flags[i] & F_GOAL)) continue;
        const b = this.bGoal[i];
        for (let k = 0; k < b.length; k++) if (overl(x, y, w, h, b[k])) m |= (1 << b[k].gi);
      }
      return m;
    }
    bounceAt(x, y, w, h) {
      const W = this.w;
      const tx0 = Math.max(0, Math.floor(x / 32)), tx1 = Math.min(W - 1, Math.floor((x + w - 1) / 32));
      const ty0 = Math.max(0, Math.floor(y / 32)), ty1 = Math.min(this.h - 1, Math.floor((y + h - 1) / 32));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * W + tx;
        if (!(this.flags[i] & F_BOUNCE)) continue;
        const b = this.bBounce[i];
        for (let k = 0; k < b.length; k++) if (overl(x, y, w, h, b[k])) return b[k];
      }
      return null;
    }
    // orbit points whose center is within range of (cx, cy); calls fn(point) for each
    orbitNear(cx, cy, range, fn) {
      const tx = Math.floor(cx / 32), ty = Math.floor(cy / 32);
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 0;
      const b = this.bOrbit[ty * this.w + tx];
      if (!b) return 0;
      const r2 = range * range;
      let n = 0;
      for (let k = 0; k < b.length; k++) {
        const p = b[k];
        const dx = p.x - cx, dy = p.y - cy;
        if (dx * dx + dy * dy <= r2) { n++; fn(p); }
      }
      return n;
    }
    // is the cell's top a standable surface (tile-wise)?
    standableTile(tx, ty) {
      if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return false;
      const f = this.flags[ty * this.w + tx];
      return !!(f & (F_BLOCK | F_ONEWAY));
    }
  }

  // ------------------------------------------------------------------ body state
  function newBody() {
    return {
      x: 0, y: 0, xr: 0, yr: 0, vx: 0, vy: 0,
      grounded: false, wall: 0, lastWall: 0, facing: 1,
      hasDouble: true, hasDash: true,
      coyote: 0, wallCoyote: 0, dropT: 0, lockT: 0, lockDir: 0,
      canCut: false, dashT: 0, dashX: 0, dashY: 0, dashCD: 0,
      t: 0, airT: 0
    };
  }
  function copyBody(d, s) {
    d.x = s.x; d.y = s.y; d.xr = s.xr; d.yr = s.yr; d.vx = s.vx; d.vy = s.vy;
    d.grounded = s.grounded; d.wall = s.wall; d.lastWall = s.lastWall; d.facing = s.facing;
    d.hasDouble = s.hasDouble; d.hasDash = s.hasDash;
    d.coyote = s.coyote; d.wallCoyote = s.wallCoyote; d.dropT = s.dropT; d.lockT = s.lockT; d.lockDir = s.lockDir;
    d.canCut = s.canCut; d.dashT = s.dashT; d.dashX = s.dashX; d.dashY = s.dashY; d.dashCD = s.dashCD;
    d.t = s.t; d.airT = s.airT;
    return d;
  }
  function cloneBody(s) { return copyBody(newBody(), s); }

  function approach(v, t, d) { return v < t ? Math.min(v + d, t) : Math.max(v - d, t); }

  // event bits returned by stepPhysics
  const EV_LANDED = 1, EV_WALLHIT = 2, EV_BONK = 4, EV_DASHEND = 8, EV_CORRECTED = 16;
  const PW = 22, PH = 22;

  // ------------------------------------------------------------------ actions (CONTRACT §2.15 steps 3–4)
  // Step 4 rules in order. Returns 'drop' | 'ground' | 'coyote' | 'wall' | 'double' | null.
  function tryJump(b, M, G, downHeld) {
    const C = M.C;
    if (downHeld && b.grounded && G.oneWayAt(b.x, PW, b.y + PH) && !G.blocked(b.x, b.y + 1, PW, PH)) {
      b.dropT = C.DROP_THROUGH; b.grounded = false;
      return 'drop';
    }
    if (b.grounded || (M.coyote && b.coyote > 0)) {
      const kind = b.grounded ? 'ground' : 'coyote';
      b.vy = -M.jumpV; b.grounded = false; b.coyote = 0; b.canCut = true;
      return kind;
    }
    if (M.wall) {
      let side = b.wall;
      if (!side && M.coyote && b.wallCoyote > 0) side = b.lastWall;
      if (side) {
        b.vx = -side * M.wjVX; b.vy = -M.wjVY; b.lockT = C.WALLJUMP_LOCK; b.lockDir = -side;
        b.canCut = true; b.wallCoyote = 0; b.facing = -side;
        return 'wall';
      }
    }
    if (M.double && b.hasDouble) {
      b.vy = -M.djV; b.hasDouble = false; b.canCut = true;
      return 'double';
    }
    return null;
  }
  function startDash(b, M, dx, dy) {
    if (!M.dash || !b.hasDash || b.dashCD > 0) return false;
    let len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) { dx = b.facing || 1; dy = 0; len = 1; }
    b.dashX = dx / len; b.dashY = dy / len;
    b.dashT = M.C.DASH_TIME; b.dashCD = M.C.DASH_COOLDOWN;
    b.hasDash = false; b.canCut = false;
    b.vx = b.dashX * M.dashV; b.vy = b.dashY * M.dashV;
    if (b.dashX) b.facing = b.dashX > 0 ? 1 : -1;
    return true;
  }
  // generic launch (bounce pads, flings): launch(vx|null, vy|null), refresh, no cut
  function launch(b, vx, vy, refresh) {
    if (vx !== null && vx !== undefined) b.vx = vx;
    if (vy !== null && vy !== undefined) b.vy = vy;
    b.grounded = false; b.canCut = false; b.dashT = 0; b.lockT = 0;
    if (refresh !== false) { b.hasDouble = true; b.hasDash = true; }
  }

  // ------------------------------------------------------------------ movement (step 8)
  function moveX(b, amt, M, G) {
    b.xr += amt;
    let move = Math.round(b.xr);
    if (move === 0) return 0;
    b.xr -= move;
    const sgn = move > 0 ? 1 : -1;
    if (!(move > 0 ? G.blocked(b.x + PW, b.y, move, PH) : G.blocked(b.x + move, b.y, -move, PH))) { b.x += move; return 0; }
    let ev = 0;
    while (move !== 0) {
      if (!(sgn > 0 ? G.blocked(b.x + PW, b.y, 1, PH) : G.blocked(b.x - 1, b.y, 1, PH))) { b.x += sgn; move -= sgn; continue; }
      // ledge pop (EXPERT): while dashing (not downward) or airborne and not rising faster than 60 u/s
      if (M.ledge && ((b.dashT > 0 && b.dashY <= 0.1) || (!b.grounded && b.vy >= -60))) {
        let done = false;
        const lim = M.C.LEDGE_CORRECT;
        for (let k = 1; k <= lim; k++) {
          if (!G.blocked(b.x, b.y - k, PW, PH) && !G.blocked(b.x + sgn, b.y - k, PW, PH)) {
            b.y -= k; b.x += sgn; move -= sgn; done = true; ev |= EV_CORRECTED; break;
          }
        }
        if (done) continue;
      }
      b.xr = 0; b.vx = 0;
      return ev | EV_WALLHIT;
    }
    return ev;
  }
  function moveY(b, amt, M, G) {
    b.yr += amt;
    let move = Math.round(b.yr);
    if (move === 0) return 0;
    b.yr -= move;
    if (move > 0) {
      const bottom = b.y + PH;
      if (!G.blocked(b.x, bottom, PW, move) && !(b.dropT <= 0 && G.oneWayBetween(b.x, PW, bottom, bottom + move - 1))) {
        b.y += move;
        return 0;
      }
      while (move > 0) {
        if (G.blocked(b.x, b.y + PH, PW, 1) || (b.dropT <= 0 && G.oneWayAt(b.x, PW, b.y + PH))) {
          b.yr = 0; b.vy = 0;
          return EV_LANDED;
        }
        b.y += 1; move -= 1;
      }
      return 0;
    }
    if (!G.blocked(b.x, b.y + move, PW, -move)) { b.y += move; return 0; }
    let ev = 0;
    while (move < 0) {
      if (!G.blocked(b.x, b.y - 1, PW, 1)) { b.y -= 1; move += 1; continue; }
      if (M.corner) {
        let done = false;
        const lim = M.C.CORNER_CORRECT;
        const pref = b.vx < 0 ? -1 : 1;
        for (let k = 1; k <= lim && !done; k++) {
          for (let s = 0; s < 2; s++) {
            const dx = (s === 0 ? pref : -pref) * k;
            if (!G.blocked(b.x + dx, b.y, PW, PH) && !G.blocked(b.x + dx, b.y - 1, PW, PH)) {
              b.x += dx; b.y -= 1; move += 1; done = true; ev |= EV_CORRECTED; break;
            }
          }
        }
        if (done) continue;
      }
      b.yr = 0; b.vy = 0;
      return ev | EV_BONK;
    }
    return ev;
  }

  // ------------------------------------------------------------------ one fixed step (steps 1, 3 (dash), 5–9)
  // ix: horizontal input (-1|0|1). jumpHeld: jump button state this step. jumpReleased: released
  // this step (for the cut). down: Down held. Actions (jump/dash) are applied by the caller
  // BEFORE calling this, as step 4 precedes steps 5–9 within the same fixed step.
  function stepPhysics(b, M, G, ix, jumpHeld, jumpReleased, down) {
    const C = M.C, dt = C.STEP;
    const wasGrounded = b.grounded;
    let ev = 0;
    b.t += dt;
    if (b.coyote > 0) b.coyote -= dt;
    if (b.wallCoyote > 0) b.wallCoyote -= dt;
    if (b.dropT > 0) b.dropT -= dt;
    if (b.dashCD > 0) b.dashCD -= dt;
    if (b.lockT > 0) { ix = b.lockDir; b.lockT -= dt; }
    if (ix) b.facing = ix;

    if (b.dashT > 0) {
      b.vx = b.dashX * M.dashV; b.vy = b.dashY * M.dashV;
      ev |= moveX(b, b.vx * dt, M, G);
      ev |= moveY(b, b.vy * dt, M, G);
      b.dashT -= dt;
      if (b.dashT <= 1e-9) {
        b.dashT = 0;
        b.vx = b.dashX > 1e-9 ? M.dashEnd : b.dashX < -1e-9 ? -M.dashEnd : 0;
        b.vy = b.dashY * M.dashEnd;
        ev |= EV_DASHEND;
      }
      postMove(b, M, G, wasGrounded);
      if (b.grounded && !wasGrounded) ev |= EV_LANDED;
      return ev;
    }

    // 5. jump cut
    if (jumpReleased && b.vy < 0 && b.canCut) { b.vy *= C.JUMP_CUT; b.canCut = false; }

    // 6. horizontal
    const run = M.run;
    const target = ix * run;
    const same = ix !== 0 && b.vx * ix > 0;
    if (same && Math.abs(b.vx) > run) b.vx = approach(b.vx, target, C.OVERSPEED_DECEL * dt);
    else if (b.grounded) {
      const acc = (ix !== 0 && (b.vx === 0 || same)) ? C.GROUND_ACCEL : C.GROUND_DECEL;
      b.vx = approach(b.vx, target, acc * dt);
    } else {
      b.vx = approach(b.vx, target, (ix !== 0 ? C.AIR_ACCEL : C.AIR_DECEL) * dt);
    }

    // 7. vertical
    const hang = M.hang && jumpHeld && Math.abs(b.vy) < C.HANG_V;
    const g = C.GRAVITY * (hang ? C.HANG_MULT : 1);
    b.vy = Math.min(b.vy + g * dt, down ? C.FAST_FALL : C.MAX_FALL);
    if (M.wall && !b.grounded && b.vy > 0 && ix !== 0 && (ix > 0 ? G.blocked(b.x + PW, b.y, 1, PH) : G.blocked(b.x - 1, b.y, 1, PH))) {
      if (b.vy > C.WALL_SLIDE_MAX) b.vy = C.WALL_SLIDE_MAX;
    }

    // 8. move
    ev |= moveX(b, b.vx * dt, M, G);
    ev |= moveY(b, b.vy * dt, M, G);

    // 9. post-move
    postMove(b, M, G, wasGrounded);
    if (b.grounded && !wasGrounded) ev |= EV_LANDED;
    else ev &= ~EV_LANDED;
    return ev;
  }

  function postMove(b, M, G, wasGrounded) {
    const C = M.C;
    b.grounded = b.vy >= 0 && (G.blocked(b.x, b.y + PH, PW, 1) || (b.dropT <= 0 && G.oneWayAt(b.x, PW, b.y + PH)));
    if (b.grounded) {
      if (b.vy > 0) b.vy = 0;
      b.yr = 0;
      b.coyote = M.coyote ? C.COYOTE : 0;
      b.hasDouble = true;
      if (b.dashT <= 0 && b.dashCD <= 0) b.hasDash = true;
      b.airT = 0;
    } else {
      b.airT += C.STEP;
    }
    if (M.wall) {
      const d = C.WALL_JUMP_DIST;
      b.wall = G.blocked(b.x + PW, b.y, d, PH) ? 1 : G.blocked(b.x - d, b.y, d, PH) ? -1 : 0;
      if (b.wall && !b.grounded) { b.lastWall = b.wall; b.wallCoyote = M.coyote ? C.WALL_COYOTE : 0; }
    } else b.wall = 0;
  }

  // ------------------------------------------------------------------ orbit (step 2) helpers
  // Simulates being attached to a static node for `secs` seconds starting from the body's
  // position/velocity; returns {s, r, theta, dir, x, y, vx, vy} at release (velocity per release rule
  // with the given aim (unit vector or null)).
  function orbitAttach(b, nodeX, nodeY, M, secs, aim) {
    const C = M.C, dt = C.STEP;
    const cx = b.x + PW / 2, cy = b.y + PH / 2;
    let dx = cx - nodeX, dy = cy - nodeY;
    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const r = Math.min(C.ORBIT_R_MAX, Math.max(C.ORBIT_R_MIN, dist));
    let theta = Math.atan2(dy, dx);
    // tangent for dir=+1 (clockwise on screen with +y down): (-sin, cos)
    const tx = -Math.sin(theta), ty = Math.cos(theta);
    const vtan = b.vx * tx + b.vy * ty;
    const dir = Math.abs(vtan) < 1 ? (b.facing >= 0 ? 1 : -1) : (vtan > 0 ? 1 : -1);
    let s = Math.max(Math.abs(vtan), C.ORBIT_MIN_SPEED);
    const steps = Math.round(secs / dt);
    for (let i = 0; i < steps; i++) {
      if (s < C.ORBIT_CRUISE) s = Math.min(C.ORBIT_CRUISE, s + C.ORBIT_ACCEL * dt);
      else s = Math.max(C.ORBIT_CRUISE, s - 300 * dt);
      const tgx = -Math.sin(theta) * dir, tgy = Math.cos(theta) * dir;
      s += 0.5 * C.GRAVITY * tgy * dt;
      if (s > C.ORBIT_MAX) s = C.ORBIT_MAX;
      if (s < 0) s = 0;
      theta += dir * s / r * dt;
    }
    const tgx = -Math.sin(theta) * dir, tgy = Math.cos(theta) * dir;
    let ux = tgx, uy = tgy;
    if (aim) {
      const al = Math.sqrt(aim[0] * aim[0] + aim[1] * aim[1]);
      if (al > 0) {
        const ax = aim[0] / al, ay = aim[1] / al;
        if (ax * tgx + ay * tgy >= Math.cos(C.ORBIT_AIM_ASSIST_DEG * Math.PI / 180) - 1e-9) { ux = ax; uy = ay; }
      }
    }
    const speed = Math.min(s * C.ORBIT_RELEASE_MULT, 1150);
    return { s, r, theta, dir, x: nodeX + Math.cos(theta) * r, y: nodeY + Math.sin(theta) * r, vx: ux * speed, vy: uy * speed, speed };
  }

  // ------------------------------------------------------------------ helpers for tests / bots
  // Grid from map rows using AP.TILE_CHARS semantics (entity chars ignored → EMPTY).
  function gridFromRows(rows, opts) {
    opts = opts || {};
    const h = rows.length, w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const G = new Grid(w, h);
    const map = { '.': 0, '#': 1, '=': 2, '^': 3, v: 4, '<': 5, '>': 6, '+': 7, '%': 8 };
    for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
      const ch = rows[ty][tx] || '.';
      let c = map[ch];
      if (c === undefined) c = 0;
      if (c === TILE.BREAK && opts.form >= 6) c = 0;
      if (c === TILE.FAKE) c = 0;
      G.setTile(tx, ty, c);
    }
    return G;
  }
  function placeOnFloor(b, tx, floorRow) {
    b.x = tx * 32 + 16 - PW / 2; b.y = floorRow * 32 - PH; b.xr = 0; b.yr = 0; b.vx = 0; b.vy = 0;
    b.grounded = true;
  }

  exports.FALLBACK_C = FALLBACK_C;
  exports.TILE = TILE;
  exports.constants = constants;
  exports.makeModel = makeModel;
  exports.Grid = Grid;
  exports.newBody = newBody;
  exports.copyBody = copyBody;
  exports.cloneBody = cloneBody;
  exports.tryJump = tryJump;
  exports.startDash = startDash;
  exports.launch = launch;
  exports.stepPhysics = stepPhysics;
  exports.postMove = postMove;
  exports.moveX = moveX;
  exports.moveY = moveY;
  exports.orbitAttach = orbitAttach;
  exports.gridFromRows = gridFromRows;
  exports.placeOnFloor = placeOnFloor;
  exports.approach = approach;
  exports.EV = { LANDED: EV_LANDED, WALLHIT: EV_WALLHIT, BONK: EV_BONK, DASHEND: EV_DASHEND, CORRECTED: EV_CORRECTED };
  exports.PW = PW;
  exports.PH = PH;
  exports.F = { BLOCK: F_BLOCK, ONEWAY: F_ONEWAY, SPIKE: F_SPIKE, SOLIDR: F_SOLIDR, STANDR: F_STANDR, HAZR: F_HAZR, GOAL: F_GOAL, BOUNCE: F_BOUNCE };
})(module.exports);
