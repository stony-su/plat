/* tools/lib/reach.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // SAFE and EXPERT reachability bots (CONTRACT §3, normative).
  //
  // Graph: nodes are standable positions (one per tile column per surface height; entity
  // 'stand'/'solid' tops and mover vertices included), plus one vertex per orbit point
  // ('orbit' lint: node + path points) and per bounce pad. Free edges: walking between adjacent
  // nodes, mover vertices of one mover, orbit points of one node, and lint.edges annotations.
  // Program edges: from every node, the §3 program set is simulated with the §2.15 model
  // (tools/lib/sim.js) in both directions:
  //   starts      standing at the tile center (±8u: home, home+8 toward the move), running
  //               starts with the speed the runway allows, and at a ledge the forward-most
  //               takeoff that keeps the model's overlap (SAFE 8u, EXPERT 2u)
  //   walk off a ledge (input held / released) · drop through a one-way
  //   jump held 0.05 s / 0.2 s / full × input full / none / full→released at apex /
  //     full→reversed at apex
  //   form ≥5  double jump at the apex or 0.15 s later, input full / none / reversed
  //   form ≥6  dash at the apex in 8 directions, with or without the double jump (DJ → dash at
  //            the DJ apex; dash → DJ when it ends)
  //   form ≥4  airborne wall contact forks wall-jumps (≤ 6 chained), holding away / toward
  //   form 99  any step within ORBIT_RANGE of an orbit point reaches its orbit vertex; from it,
  //            releases in 8 aim-assisted directions at 920×factor from radius 80, then the
  //            double-jump/dash programs with both refreshed
  // Touching a goal at any simulated step reaches it. Landings need the model's overlap.
  // Each program runs ≤ 4 s. Trajectories are pre-recorded on an empty floor (relative
  // offsets); a subtree whose recorded envelope covers only empty cells over a continuous floor
  // is skipped, since it can only land back on the takeoff surface (collisions are re-checked
  // by live simulation everywhere else).

  const sim = require('./sim');

  const PW = sim.PW, PH = sim.PH;
  const DIRS8 = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
  const MAX_CHAIN = 6;
  const MAX_STEPS = 480;              // 4 s per program
  const HOLDS = [6, 24, -1];          // jump held 0.05 s, 0.2 s, full (steps; -1 = never released)
  const DJ_DELAYS = [0, 18];          // at the apex, or 0.15 s after it
  const EV = sim.EV;
  const U_NEVER = 0, U_APEX = 1, U_STEPS = 2, U_DASHEND = 3, U_AIRBORNE = 4;
  const F_GOAL = sim.F.GOAL, F_BOUNCE = sim.F.BOUNCE, SPECIAL_HAZ = sim.F.SPIKE | sim.F.HAZR;

  // ------------------------------------------------------------------ graph (model independent)
  class Graph {
    constructor(geo) {
      this.geo = geo;
      this.G = geo.grid;
      this.form = geo.form;
      this.nodes = [];
      this.byKey = new Map();
      this.orbitVertex = new Map();   // orbit point → node id
      this.bounceVertex = new Map();  // bounce rect → node id
      this.C = sim.constants().C;
      this.topsByY = new Map();
      for (const list of [this.G.standR, this.G.solidR]) for (const r of list) {
        if (!this.topsByY.has(r.y)) this.topsByY.set(r.y, []);
        this.topsByY.get(r.y).push(r);
      }
      this.buildStandNodes();
      this.buildWalkLinks();
      this.buildSpecialVertices();
      this.buildFreeLinks();
      this.buildPrefix();
    }
    key(tx, fy) { return tx + ':' + fy; }
    newNode(kind, tx, fy, px) {
      const n = { id: this.nodes.length, kind, tx, fy, px, py: fy - PH, left: -1, right: -1, zone: 0, bounce: null,
        oneway: false, links: [], edges: {}, touch: {}, wallSeen: {}, label: '' };
      this.nodes.push(n);
      return n;
    }
    // total standable surface length at height fy under [px, px+22)
    support(px, fy) {
      const G = this.G;
      let s = 0;
      if (fy % 32 === 0) {
        const r = fy / 32;
        if (r >= 0 && r < G.h) {
          const tx0 = Math.max(0, Math.floor(px / 32)), tx1 = Math.min(G.w - 1, Math.floor((px + PW - 1) / 32));
          for (let tx = tx0; tx <= tx1; tx++) {
            if (!G.standableTile(tx, r)) continue;
            s += Math.min(px + PW, tx * 32 + 32) - Math.max(px, tx * 32);
          }
        }
      }
      const tops = this.topsByY.get(fy);
      if (tops) for (let k = 0; k < tops.length; k++) {
        const r = tops[k];
        const o = Math.min(px + PW, r.x + r.w) - Math.max(px, r.x);
        if (o > 0) s += o;
      }
      return Math.min(s, PW);
    }
    freeAt(px, py) { return !this.G.blocked(px, py, PW, PH) && !this.G.hazardAt(px, py, PW, PH); }
    tryNode(tx, fy, segX0, segX1) {
      const k = this.key(tx, fy);
      if (this.byKey.has(k)) return this.byKey.get(k);
      const home = tx * 32 + 16 - PW / 2;
      const offs = [0, -8, 8, -4, 4, -11, 11];
      for (const o of offs) {
        let px = home + o;
        if (segX0 !== undefined) {
          if (px < segX0 - PW + 8) px = segX0 - PW + 8;
          if (px > segX1 - 8) px = segX1 - 8;
          if (Math.floor((px + PW / 2) / 32) !== tx && o !== 0) continue;
        }
        px = Math.round(px);
        if (this.support(px, fy) < 1) continue;
        if (!this.freeAt(px, fy - PH)) continue;
        const n = this.newNode('stand', tx, fy, px);
        this.byKey.set(k, n);
        n.oneway = this.G.oneWayAt(px, PW, fy) && !this.G.blocked(px, fy - PH + 1, PW, PH);
        return n;
      }
      return null;
    }
    buildStandNodes() {
      const G = this.G;
      for (let r = 1; r < G.h; r++) {
        const fy = r * 32;
        for (let tx = 0; tx < G.w; tx++) if (G.standableTile(tx, r)) this.tryNode(tx, fy);
      }
      const segs = [];
      for (const r of G.standR) segs.push(r);
      for (const r of G.solidR) segs.push(r);
      for (const r of segs) {
        const tx0 = Math.floor(r.x / 32), tx1 = Math.floor((r.x + r.w - 1) / 32);
        for (let tx = tx0; tx <= tx1; tx++) {
          if (tx < 0 || tx >= G.w) continue;
          const cx = tx * 32 + 16;
          const covers = cx >= r.x && cx <= r.x + r.w;
          const mid = Math.floor((r.x + r.w / 2) / 32) === tx;
          if (covers || mid) this.tryNode(tx, r.y, r.x, r.x + r.w);
        }
      }
      for (const n of this.nodes) {
        n.zone = G.goalsAt(n.px - 8, n.fy - PH, PW + 16, PH);
        const br = G.bounceAt(n.px, n.fy - PH, PW, PH);
        if (br) n.bounce = br;
      }
    }
    buildWalkLinks() {
      const G = this.G;
      for (const a of this.nodes) {
        if (a.kind !== 'stand') continue;
        const b = this.byKey.get(this.key(a.tx + 1, a.fy));
        if (!b) continue;
        const x0 = Math.min(a.px, b.px), x1 = Math.max(a.px, b.px) + PW;
        if (G.blocked(x0, a.fy - PH, x1 - x0, PH)) continue;
        if (G.hazardAt(x0, a.fy - PH, x1 - x0, PH)) continue;
        const mid = Math.round((a.px + b.px) / 2);
        if (this.support(mid, a.fy) < 1) continue;
        a.right = b.id; b.left = a.id;
      }
      // surfaces (connected walk chains)
      let sid = 0;
      for (const n of this.nodes) n.surf = -1;
      for (const n of this.nodes) {
        if (n.kind !== 'stand' || n.surf >= 0) continue;
        let m = n;
        while (m.left >= 0) m = this.nodes[m.left];
        while (m) { m.surf = sid; m = m.right >= 0 ? this.nodes[m.right] : null; }
        sid++;
      }
    }
    buildSpecialVertices() {
      const G = this.G;
      for (const p of G.orbitP) {
        const n = this.newNode('orbit', Math.floor(p.x / 32), Math.round(p.y), Math.round(p.x - PW / 2));
        n.point = p;
        n.zone = 0;
        this.orbitVertex.set(p, n.id);
        n.label = 'orbit node @' + (p.x / 32).toFixed(1) + ',' + (p.y / 32).toFixed(1);
      }
      for (const r of G.bounceR) {
        const n = this.newNode('bounce', Math.floor((r.x + r.w / 2) / 32), Math.round(r.y + r.h), Math.round(r.x + r.w / 2 - PW / 2));
        n.rect = r;
        n.zone = G.goalsAt(n.px, n.fy - PH, PW, PH);
        this.bounceVertex.set(r, n.id);
        n.label = 'bounce pad @' + Math.floor(r.x / 32) + ',' + Math.floor(r.y / 32);
      }
      // stand nodes sitting on a pad are launch points too
      for (const n of this.nodes) if (n.kind === 'stand' && n.bounce && this.bounceVertex.has(n.bounce)) this.link(n.id, this.bounceVertex.get(n.bounce), true);
    }
    link(a, b, oneWay, w) {
      if (a === b || a < 0 || b < 0) return;
      const na = this.nodes[a], nb = this.nodes[b];
      const d = w !== undefined ? w : Math.max(1, Math.hypot(na.px - nb.px, na.fy - nb.fy) / 32);
      if (!na.links.some(l => l.to === b)) na.links.push({ to: b, w: d });
      if (!oneWay && !nb.links.some(l => l.to === a)) nb.links.push({ to: a, w: d });
    }
    nearestStand(tx, ty, maxDist) {
      // stand node whose standing cell is nearest to (tx, ty) (tile coords of the player's cell)
      let best = null, bd = Infinity;
      for (const n of this.nodes) {
        if (n.kind !== 'stand') continue;
        const ntx = (n.px + PW / 2) / 32 - 0.5, nty = n.fy / 32 - 1;
        const d = Math.hypot(ntx - tx, nty - ty);
        if (d < bd) { bd = d; best = n; }
      }
      return best && bd <= (maxDist === undefined ? 3 : maxDist) ? best : null;
    }
    buildFreeLinks() {
      const geo = this.geo;
      this.annotationProblems = [];
      // movers: every path vertex is a connected stand
      for (const mg of geo.moverGroups) {
        const ids = [];
        for (const s of mg.stands) {
          const tx0 = Math.floor(s.x / 32), tx1 = Math.floor((s.x + s.w - 1) / 32);
          let best = null;
          for (let tx = tx0; tx <= tx1; tx++) { const n = this.byKey.get(this.key(tx, Math.round(s.y))); if (n) { best = n; if (tx === Math.floor((s.x + s.w / 2) / 32)) break; } }
          if (best) ids.push(best.id);
        }
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) this.link(ids[i], ids[j], false);
      }
      // orbit groups: a moving node carries the player along its path
      const byGroup = new Map();
      for (const [p, id] of this.orbitVertex) { if (!byGroup.has(p.group)) byGroup.set(p.group, []); byGroup.get(p.group).push(id); }
      for (const ids of byGroup.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) this.link(ids[i], ids[j], false);
      // annotations
      for (const e of geo.annotations.edges) {
        if (e.invalid) continue;
        const a = this.nearestStand(e.a[0], e.a[1], 3), b = this.nearestStand(e.b[0], e.b[1], 3);
        if (!a || !b) { this.annotationProblems.push('lint.edges [' + e.a.join(',') + ' → ' + e.b.join(',') + '] has no stand node within 3 tiles of ' + (!a ? 'its start' : 'its end')); continue; }
        this.link(a.id, b.id, e.oneWay);
      }
    }
    buildPrefix() {
      const G = this.G, W = G.w, H = G.h;
      // busy[i] = any feature in the cell (tiles, rects, orbit influence)
      const ps = new Int32Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) {
        let row = 0;
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          row += (G.flags[i] !== 0 || G.bOrbit[i]) ? 1 : 0;
          ps[(y + 1) * (W + 1) + (x + 1)] = ps[y * (W + 1) + (x + 1)] + row;
        }
      }
      this.busyPS = ps;
      const fl = new Int32Array(H * (W + 1));
      for (let y = 0; y < H; y++) {
        let row = 0;
        for (let x = 0; x < W; x++) {
          const f = G.flags[y * W + x];
          row += (f & (sim.F.BLOCK | sim.F.ONEWAY)) ? 1 : 0;
          fl[y * (W + 1) + x + 1] = row;
        }
      }
      this.floorPS = fl;
    }
    // no feature at all in the cells overlapping [x0,x1) × [y0,y1) (and inside the level)
    quiet(x0, y0, x1, y1) {
      const G = this.G, W = G.w;
      if (x0 < 0 || y0 < 0 || x1 > G.pw || y1 > G.ph) return false;
      const tx0 = Math.floor(x0 / 32), tx1 = Math.floor((x1 - 1) / 32), ty0 = Math.floor(y0 / 32), ty1 = Math.floor((y1 - 1) / 32);
      if (ty1 < ty0) return true;
      const ps = this.busyPS, S = W + 1;
      const sum = ps[(ty1 + 1) * S + tx1 + 1] - ps[ty0 * S + tx1 + 1] - ps[(ty1 + 1) * S + tx0] + ps[ty0 * S + tx0];
      return sum === 0;
    }
    floorRun(x0, x1, fy) {
      const G = this.G, W = G.w;
      if (fy % 32 !== 0) return false;
      const r = fy / 32;
      if (r < 0 || r >= G.h || x0 < 0 || x1 > G.pw) return false;
      const tx0 = Math.floor(x0 / 32), tx1 = Math.floor((x1 - 1) / 32);
      const row = this.floorPS, S = W + 1;
      return row[r * S + tx1 + 1] - row[r * S + tx0] === tx1 - tx0 + 1;
    }
    nodeAt(px, fy) {
      const tx = Math.floor((px + PW / 2) / 32);
      let n = this.byKey.get(this.key(tx, fy));
      if (n) return n;
      let best = null, bo = 0;
      for (const dx of [-1, 1]) {
        const m = this.byKey.get(this.key(tx + dx, fy));
        if (!m) continue;
        const o = Math.min(px + PW, m.px + PW + 8) - Math.max(px, m.px - 8);
        if (o > bo) { bo = o; best = m; }
      }
      return best;
    }
    describe(id) {
      const n = this.nodes[id];
      if (!n) return '?';
      if (n.kind === 'stand') return 'tile ' + n.tx + ',' + (n.fy / 32 - 1);
      return n.label;
    }
  }

  // ------------------------------------------------------------------ the bot (one per model)
  // Record layout: per advance() call of the program tree, the body state after every step.
  const NF = 26;
  const RF_X = 0, RF_Y = 1, RF_HELD = 24, RF_PREVWALL = 25;
  const END_COND = 1, END_DONE = 2;

  function saveState(arr, b, s, px0, fy0) {
    arr.push(b.x - px0, b.y - fy0, b.xr, b.yr, b.vx, b.vy, b.grounded ? 1 : 0, b.wall, b.lastWall, b.facing,
      b.hasDouble ? 1 : 0, b.hasDash ? 1 : 0, b.coyote, b.wallCoyote, b.dropT, b.lockT, b.lockDir, b.canCut ? 1 : 0,
      b.dashT, b.dashX, b.dashY, b.dashCD, b.t, b.airT, s.held ? 1 : 0, s.prevWall);
  }
  function loadState(d, i, b, s, px0, fy0) {
    const o = i * NF;
    b.x = d[o] + px0; b.y = d[o + 1] + fy0; b.xr = d[o + 2]; b.yr = d[o + 3]; b.vx = d[o + 4]; b.vy = d[o + 5];
    b.grounded = d[o + 6] === 1; b.wall = d[o + 7]; b.lastWall = d[o + 8]; b.facing = d[o + 9];
    b.hasDouble = d[o + 10] === 1; b.hasDash = d[o + 11] === 1; b.coyote = d[o + 12]; b.wallCoyote = d[o + 13];
    b.dropT = d[o + 14]; b.lockT = d[o + 15]; b.lockDir = d[o + 16]; b.canCut = d[o + 17] === 1;
    b.dashT = d[o + 18]; b.dashX = d[o + 19]; b.dashY = d[o + 20]; b.dashCD = d[o + 21]; b.t = d[o + 22]; b.airT = d[o + 23];
    s.held = d[o + RF_HELD] === 1; s.prevWall = d[o + RF_PREVWALL];
  }

  class Bot {
    constructor(graph, kind, opts) {
      opts = opts || {};
      this.g = graph;
      this.G = graph.G;
      this.kind = kind;
      this.M = sim.makeModel(kind, graph.form);
      this.C = this.M.C;
      // Wall-jump forks (form ≥ 4) are added lazily: every node first gets programs without
      // them; when a search fails, reached nodes whose programs touched a wall are upgraded
      // (nearest the missing target first) and the search is repeated (searchUp).
      this.walls = this.M.wall;
      this.upgraded = new Uint8Array(graph.nodes.length);
      this.nUpgraded = 0;
      this.wallsOn = false;
      this.sawWall = false;
      this.steps = 0;           // live simulated steps
      this.replayed = 0;        // steps replayed from records
      this.wallSteps = 0;       // live steps inside wall-jump chains
      this.records = new Map(); // signature → {boxes, segs}
      this.recBoxes = null;
      this.recSegs = null;
      this.rec = false;
      this.recStack = [];
      this.recBuf = null;
      this.pruned = 0;
      this.programs = 0;
      this.expanded = 0;
      this.deadline = opts.deadline || Infinity;
      this.timedOut = false;
      this.cur = null;          // Map<to, mask> for the node being expanded
      this.curTouch = 0;
      this.px0 = 0; this.fy0 = 0;
      this.recGrid = null;
      this.hasOrbit = this.G.orbitP.length > 0 && this.M.orbit;
    }

    // ---------------------------------------------------------------- branch state
    // rk/ac: record key of the subtree and advance-call counter (identify the recorded segment)
    st(b) { return { b, mask: 0, steps: 0, chain: 0, wmode: 0, held: false, releaseAt: -1, prevWall: 0, pristine: true, rk: '', ac: 0 }; }
    clone(s) {
      return { b: sim.cloneBody(s.b), mask: s.mask, steps: s.steps, chain: s.chain, wmode: s.wmode, held: s.held, releaseAt: s.releaseAt,
        prevWall: s.prevWall, pristine: s.pristine, rk: s.rk, ac: s.ac };
    }

    // Subtree entry: names the subtree (record key) and, in run mode, skips it when its recorded
    // envelope covers only feature-free cells above a continuous floor (it can only land back
    // on the takeoff surface, which walking already connects).
    enter(key, s) {
      s.rk = key; s.ac = 0;
      if (this.rec) {
        let bb = this.recBoxes.get(key);
        if (!bb) { bb = { minX: Infinity, maxX: -Infinity, minRel: 0 }; this.recBoxes.set(key, bb); }
        this.extendBox(bb, s.b);
        this.recStack.push(bb);
        return true;
      }
      if (!s.pristine || !this.recBoxes) return true;
      const bb = this.recBoxes.get(key);
      if (!bb || bb.minX === Infinity) return true;
      const x0 = this.px0 + bb.minX, x1 = this.px0 + bb.maxX + PW;
      const yTop = this.fy0 + bb.minRel - PH;
      if (this.g.quiet(x0, yTop, x1, this.fy0) && this.g.floorRun(x0, x1, this.fy0)) { this.pruned++; return false; }
      return true;
    }
    leave() { if (this.rec) this.recStack.pop(); }
    extendBox(bb, b) {
      const dx = b.x - this.px0, rel = b.y + PH - this.fy0;
      if (dx < bb.minX) bb.minX = dx;
      if (dx > bb.maxX) bb.maxX = dx;
      if (rel < bb.minRel) bb.minRel = rel;
    }

    emit(s, to) {
      if (this.rec || to === undefined || to < 0) return;
      const m = this.cur.get(to);
      this.cur.set(to, m === undefined ? s.mask : (m | s.mask));
    }
    touchOnly(s) { if (!this.rec) this.curTouch |= s.mask; }

    // ---------------------------------------------------------------- simulation loop
    // Runs steps with horizontal input ix until the condition (returns true, branch alive) or
    // the branch ends (returns false: landed / died / bounced / timed out). While the branch is
    // still identical to its empty-floor record and the next step only crosses feature-free
    // cells, the recorded state is used instead of simulating.
    advance(s, ix, until, arg) {
      const M = this.M, G = this.rec ? this.recGrid : this.G;
      const b = s.b;
      const R = this.C.ORBIT_RANGE, pit = G.ph + this.C.PIT_MARGIN;
      let seg = null, data = null, segN = 0, j = 0, synced = true;
      const segKey = s.rk + '#' + s.ac;
      s.ac++;
      let buf = null;
      if (this.rec) buf = [];
      else if (s.pristine && this.recSegs) {
        seg = this.recSegs.get(segKey);
        if (seg) { data = seg.data; segN = seg.n; }
      }
      const px0 = this.px0, fy0 = this.fy0;
      for (;;) {
        // replay from the record while the swept box stays in feature-free cells
        // (a recorded grounded state depends on the record's floor: never replay into it)
        if (data !== null && s.pristine && j < segN && data[j * NF + 6] !== 1) {
          const o = j * NF;
          const nx = data[o] + px0, ny = data[o + 1] + fy0;
          let cx, cy;
          if (synced) { cx = b.x; cy = b.y; } else { cx = data[o - NF] + px0; cy = data[o - NF + 1] + fy0; }
          const x0 = (cx < nx ? cx : nx) - 5, y0 = (cy < ny ? cy : ny) - 5;
          const x1 = (cx > nx ? cx : nx) + PW + 5, y1 = (cy > ny ? cy : ny) + PH + 5;
          if (this.g.quiet(x0, y0, x1, y1)) {
            j++; s.steps++; this.replayed++;
            synced = false;
            if (j === segN) {
              loadState(data, j - 1, b, s, px0, fy0);
              if (seg.end === END_COND) return true;
              this.touchOnly(s);
              return false;
            }
            continue;
          }
          if (!synced) { loadState(data, j - 1, b, s, px0, fy0); synced = true; }
        } else if (!synced) { loadState(data, j - 1, b, s, px0, fy0); synced = true; }

        if (s.steps >= MAX_STEPS) { if (buf) this.storeSeg(segKey, buf, END_DONE); this.touchOnly(s); return false; }
        let met = false;
        if (until === U_APEX) met = b.vy >= 0 && b.dashT <= 0;
        else if (until === U_STEPS) met = s.steps >= arg;
        else if (until === U_DASHEND) met = b.dashT <= 0;
        else if (until === U_AIRBORNE) { met = !b.grounded; if (!met && s.steps >= arg) { this.touchOnly(s); return false; } }
        if (met) { if (buf) this.storeSeg(segKey, buf, END_COND); return true; }

        let rel = false;
        if (s.held && s.releaseAt === s.steps) { s.held = false; rel = true; }
        const ev = sim.stepPhysics(b, M, G, ix, s.held, rel, false);
        s.steps++;
        j++;
        if (buf) {
          for (let k = 0; k < this.recStack.length; k++) this.extendBox(this.recStack[k], b);
          saveState(buf, b, s, px0, fy0);
          if (ev & EV.LANDED) { this.storeSeg(segKey, buf, END_DONE); return false; }
          continue;
        }
        this.steps++;
        if (s.chain > 0) this.wallSteps++;
        if ((this.steps & 4095) === 0 && Date.now() > this.deadline) { this.timedOut = true; return false; }
        if (ev & (EV.WALLHIT | EV.BONK | EV.CORRECTED)) s.pristine = false;
        if (b.wall !== 0 || b.y + PH > fy0) s.pristine = false;
        if (b.y > pit) { this.touchOnly(s); return false; }
        const sf = G.specialFlags(b.x, b.y, PW, PH);
        if (sf !== 0) {
          if ((sf & SPECIAL_HAZ) && G.hazardAt(b.x, b.y, PW, PH)) { if (sf & F_GOAL) s.mask |= G.goalsAt(b.x, b.y, PW, PH); this.touchOnly(s); return false; }
          if (sf & F_GOAL) s.mask |= G.goalsAt(b.x, b.y, PW, PH);
          if ((sf & F_BOUNCE) && b.vy >= 0) {
            const br = G.bounceAt(b.x, b.y, PW, PH);
            if (br) { this.emit(s, this.g.bounceVertex.get(br)); return false; }
          }
        }
        if (this.hasOrbit) this.orbitCheck(s, b, R);
        if (ev & EV.LANDED) { this.land(s); return false; }
        if (M.wall && !b.grounded && b.wall !== 0 && b.wall !== s.prevWall && s.chain < MAX_CHAIN && b.dashT <= 0) {
          if (this.wallsOn) this.wallFork(s); else this.sawWall = true;
        }
        s.prevWall = b.wall;
      }
    }
    storeSeg(key, buf, end) {
      if (!this.recSegs.has(key)) this.recSegs.set(key, { data: Float64Array.from(buf), n: buf.length / NF, end });
    }
    orbitCheck(s, b, R) {
      const G = this.G;
      const cx = b.x + PW / 2, cy = b.y + PH / 2;
      const tx = Math.floor(cx / 32), ty = Math.floor(cy / 32);
      if (tx < 0 || ty < 0 || tx >= G.w || ty >= G.h) return;
      const list = G.bOrbit[ty * G.w + tx];
      if (!list) return;
      const r2 = R * R;
      for (let k = 0; k < list.length; k++) {
        const p = list[k];
        const dx = p.x - cx, dy = p.y - cy;
        if (dx * dx + dy * dy <= r2) this.emit(s, this.g.orbitVertex.get(p));
      }
    }
    land(s) {
      const b = s.b;
      const fy = b.y + PH;
      if (this.g.support(b.x, fy) < this.M.overlap) { this.touchOnly(s); return; }
      const n = this.g.nodeAt(b.x, fy);
      if (n) this.emit(s, n.id); else this.touchOnly(s);
    }
    // Wall-jump branches (CONTRACT §3: ≤ 6 chained, holding toward the other wall or back toward
    // this one). A chain keeps the mode chosen at its first wall-jump: zig-zag between walls, or
    // climbing the same wall; mixed sequences are not explored (a contact costs 13 branches
    // instead of 2^6).
    //   first contact      zig-zag (hold away) and same-wall (hold back toward this wall) chains
    //   zig-zag contact    continue the zig-zag, or one last hop back toward this wall
    //   same-wall contact  continue climbing the same wall
    wallFork(s) {
      const side = s.b.wall;
      for (let opt = 1; opt <= 2; opt++) {
        let mode = opt, terminal = false;
        if (s.wmode === 1 && opt === 2) terminal = true;
        else if (s.wmode !== 0 && s.wmode !== opt) continue;
        const w = this.clone(s);
        const kind = sim.tryJump(w.b, this.M, this.G, false);
        if (!kind) return;
        w.chain = terminal ? MAX_CHAIN : w.chain + 1;
        w.wmode = mode;
        w.held = true; w.releaseAt = -1;
        w.pristine = false;
        w.prevWall = w.b.wall;
        this.advance(w, opt === 1 ? -side : side, U_NEVER, 0);
      }
    }

    // ---------------------------------------------------------------- program trees
    grid() { return this.rec ? this.recGrid : this.G; }
    // Apex forks after a jump-like launch: post-apex inputs, double jump (then dash), dash (then
    // double jump).
    apexForks(s, pre, d, key) {
      const M = this.M;
      const posts = pre !== 0 ? [pre, 0, -pre] : [0];
      for (const post of posts) {
        const c = this.clone(s);
        if (this.enter(key + 'p' + post, c)) { this.advance(c, post, U_NEVER, 0); this.leave(); }
      }
      if (M.double && s.b.hasDouble) {
        const djIns = d !== 0 ? [d, 0, -d] : [0, 1, -1];
        const dashIn = d !== 0 ? d : 0;
        for (const delay of DJ_DELAYS) {
          const k0 = key + 'J' + delay;
          const c0 = this.clone(s);
          if (!this.enter(k0, c0)) continue;
          let alive = true;
          if (delay > 0) alive = this.advance(c0, pre, U_STEPS, c0.steps + delay);
          if (alive && c0.b.hasDouble) {
            for (const djIn of djIns) {
              const k1 = k0 + 'i' + djIn;
              const c1 = this.clone(c0);
              if (!this.enter(k1, c1)) continue;
              if (sim.tryJump(c1.b, M, this.grid(), false) === 'double') {
                c1.held = true; c1.releaseAt = -1;
                if (M.dash && djIn === dashIn) {
                  // ride the double jump to its apex, then: no dash / dash in 8 directions
                  if (this.advance(c1, djIn, U_APEX, 0)) {
                    const cn = this.clone(c1);
                    if (this.enter(k1 + 'n', cn)) { this.advance(cn, djIn, U_NEVER, 0); this.leave(); }
                    for (let di = 0; di < 8; di++) {
                      const cd = this.clone(c1);
                      if (!this.enter(k1 + 'd' + di, cd)) continue;
                      const dir = DIRS8[di];
                      if (sim.startDash(cd.b, M, dir[0], dir[1])) {
                        const postIn = dir[0] > 0 ? 1 : dir[0] < 0 ? -1 : dashIn;
                        this.advance(cd, postIn, U_NEVER, 0);
                      }
                      this.leave();
                    }
                  }
                } else this.advance(c1, djIn, U_NEVER, 0);
              }
              this.leave();
            }
          }
          this.leave();
        }
      }
      if (M.dash && s.b.hasDash) {
        for (let di = 0; di < 8; di++) {
          const kd = key + 'D' + di;
          const cd = this.clone(s);
          if (!this.enter(kd, cd)) continue;
          const dir = DIRS8[di];
          if (sim.startDash(cd.b, M, dir[0], dir[1]) && this.advance(cd, 0, U_DASHEND, 0)) {
            const postIn = dir[0] > 0 ? 1 : dir[0] < 0 ? -1 : (d !== 0 ? d : pre);
            const c2 = this.clone(cd);
            if (this.enter(kd + 'a', c2)) { this.advance(c2, postIn, U_NEVER, 0); this.leave(); }
            if (M.double && cd.b.hasDouble && dir[1] <= 0) {
              const c3 = this.clone(cd);
              if (this.enter(kd + 'b', c3)) {
                if (sim.tryJump(c3.b, M, this.grid(), false) === 'double') {
                  c3.held = true; c3.releaseAt = -1;
                  this.advance(c3, postIn, U_NEVER, 0);
                }
                this.leave();
              }
            }
          }
          this.leave();
        }
      }
    }
    // jump programs from a grounded takeoff body
    jumpTree(b0, pres, d, key) {
      const M = this.M;
      for (const pre of pres) {
        for (const hold of HOLDS) {
          const k = key + 'h' + hold + 'q' + pre;
          const s = this.st(sim.cloneBody(b0));
          if (!this.enter(k, s)) continue;
          this.programs++;
          if (sim.tryJump(s.b, M, this.grid(), false)) {
            s.held = true; s.releaseAt = hold;
            if (this.advance(s, pre, U_APEX, 0)) {
              if (hold !== -1 || (pre === 0 && b0.vx !== 0)) {
                // short hops and the running no-input hop: post-apex inputs only
                const posts = pre !== 0 ? [pre, 0, -pre] : [0];
                for (const post of posts) {
                  const c = this.clone(s);
                  if (this.enter(k + 'p' + post, c)) { this.advance(c, post, U_NEVER, 0); this.leave(); }
                }
              } else this.apexForks(s, pre, d, k);
            }
          }
          this.leave();
        }
      }
    }
    // launch programs (bounce pads, orbit releases): body already airborne with velocity
    launchTree(b0, ins, d, key) {
      for (const ix of ins) {
        const s = this.st(sim.cloneBody(b0));
        s.held = true; s.releaseAt = -1; s.pristine = false;
        this.programs++;
        if (this.advance(s, ix, U_APEX, 0)) this.apexForks(s, ix, ix !== 0 ? ix : d, key + 'L' + ix);
      }
    }

    // ---------------------------------------------------------------- per-node program set
    bodyAt(px, fy, vx) {
      const b = sim.newBody();
      b.x = px; b.y = fy - PH; b.vx = vx; b.grounded = true;
      b.facing = vx > 0 ? 1 : vx < 0 ? -1 : 1;
      b.hasDouble = true; b.hasDash = true;
      return b;
    }
    recordFor(sig, vx, pres, d) {
      let rb = this.records.get(sig);
      if (rb) return rb;
      if (!this.recGrid) {
        const rows = [];
        for (let y = 0; y < 26; y++) rows.push((y >= 22 ? '#' : '.').repeat(240));
        this.recGrid = sim.gridFromRows(rows).build();
      }
      rb = { boxes: new Map(), segs: new Map() };
      const save = { px0: this.px0, fy0: this.fy0 };
      this.rec = true;
      this.recBoxes = rb.boxes; this.recSegs = rb.segs;
      this.px0 = 120 * 32 + 5; this.fy0 = 22 * 32;
      const b = this.bodyAt(this.px0, this.fy0, vx);
      const s = this.st(b);
      this.enter('T', s);
      this.jumpTree(b, pres, d, 'T');
      this.leave();
      this.rec = false;
      this.px0 = save.px0; this.fy0 = save.fy0;
      this.records.set(sig, rb);
      return rb;
    }
    takeoff(px, fy, vx, pres, d) {
      if (this.G.blocked(px, fy - PH, PW, PH) || this.g.support(px, fy) < this.M.overlap) return;
      const vq = Math.round(vx * 1000) / 1000;
      const sig = d + '|' + vq + '|' + pres.join(',');
      const rb = this.recordFor(sig, vq, pres, d);
      this.recBoxes = rb.boxes; this.recSegs = rb.segs;
      this.px0 = px; this.fy0 = fy;
      const b = this.bodyAt(px, fy, vq);
      if (this.enter('T', this.st(b))) this.jumpTree(b, pres, d, 'T');
      this.recBoxes = null; this.recSegs = null;
    }
    // speed reachable at takeoff px moving in direction d (runway behind on the same surface)
    runSpeed(n, px, d) {
      const back = d > 0 ? n.left : n.right;
      if (back >= 0) return this.M.run;
      let q = px;
      for (let k = 0; k < 24; k++) {
        const nx = q - d;
        if (this.G.blocked(nx, n.fy - PH, PW, PH) || this.g.support(nx, n.fy) < 1) break;
        q = nx;
      }
      const runway = Math.abs(px - q);
      return Math.min(this.M.run, Math.sqrt(2 * this.C.GROUND_ACCEL * runway));
    }
    // forward-most takeoff toward d keeping the model's overlap → {px, kind:'edge'|'hazard'},
    // or null when a wall ends the surface first
    edgePx(n, d) {
      if ((d > 0 ? n.right : n.left) >= 0) return null;
      let px = n.px, reason = null;
      for (let k = 0; k < 48; k++) {
        const nx = px + d;
        if (this.G.blocked(nx, n.fy - PH, PW, PH)) { reason = 'wall'; break; }
        if (this.G.hazardAt(nx, n.fy - PH, PW, PH)) { reason = 'hazard'; break; }
        if (this.g.support(nx, n.fy) < this.M.overlap) { reason = 'edge'; break; }
        px = nx;
      }
      return reason === 'edge' || reason === 'hazard' ? { px, kind: reason } : null;
    }
    walkOff(n, d) {
      const b = this.bodyAt(n.px, n.fy, this.runSpeed(n, n.px, d) * d);
      const s = this.st(b);
      s.pristine = false;
      this.programs++;
      this.px0 = n.px; this.fy0 = -1e9;
      if (!this.advance(s, d, U_AIRBORNE, 60)) return;
      for (const ix of [d, 0]) { const c = this.clone(s); this.advance(c, ix, U_NEVER, 0); }
    }
    dropThrough(n) {
      this.px0 = n.px; this.fy0 = -1e9;
      for (const ix of [0, 1, -1]) {
        const b = this.bodyAt(n.px, n.fy, 0);
        if (sim.tryJump(b, this.M, this.G, true) !== 'drop') return;
        const s = this.st(b);
        s.pristine = false;
        this.programs++;
        this.advance(s, ix, U_NEVER, 0);
      }
    }
    orbitPrograms(n) {
      const p = n.point, M = this.M;
      const r = 80;
      for (const u of DIRS8) {
        const len = Math.hypot(u[0], u[1]);
        const ux = u[0] / len, uy = u[1] / len;
        for (const spin of [1, -1]) {
          // tangent(θ) = spin·(−sin θ, cos θ) = u
          const th = Math.atan2(-spin * ux, spin * uy);
          const cx = p.x + Math.cos(th) * r, cy = p.y + Math.sin(th) * r;
          const b = sim.newBody();
          b.x = Math.round(cx - PW / 2); b.y = Math.round(cy - PH / 2);
          if (this.G.blocked(b.x, b.y, PW, PH)) continue;
          b.grounded = false; b.hasDouble = true; b.hasDash = true;
          b.vx = ux * M.orbitRelease; b.vy = uy * M.orbitRelease;
          b.facing = ux >= 0 ? 1 : -1;
          const ins = u[0] !== 0 ? [u[0]] : [0, 1, -1];
          this.px0 = b.x; this.fy0 = -1e9;
          this.launchTree(b, ins, u[0], 'O');
        }
      }
    }
    bouncePrograms(n) {
      const r = n.rect, M = this.M;
      const dir = r.dir === 'left' ? -1 : r.dir === 'right' ? 1 : 0;
      for (const off of [0, -8, 8]) {
        const b = sim.newBody();
        b.x = Math.round(r.x + r.w / 2 - PW / 2 + off);
        b.y = Math.round(r.y + r.h - PH);
        if (this.G.blocked(b.x, b.y, PW, PH)) continue;
        b.grounded = false;
        if (dir === 0) sim.launch(b, null, -M.bounceV, true);
        else sim.launch(b, dir * M.bounceSideVX, -M.bounceSideVY, true);
        const ins = dir === 0 ? [0, 1, -1] : [dir, 0];
        this.px0 = b.x; this.fy0 = -1e9;
        this.launchTree(b, ins, dir, 'B');
        if (dir !== 0) break;
      }
    }
    edgeKey(n) { return this.walls && this.upgraded[n.id] ? this.kind + '+w' : this.kind; }
    computeEdges(n) {
      const key = this.edgeKey(n), k1 = this.kind;
      if (key !== k1 && n.edges[k1] && n.wallSeen[k1] === false) {
        n.edges[key] = n.edges[k1]; n.touch[key] = n.touch[k1]; n.wallSeen[key] = false;
        return n.edges[key];
      }
      this.wallsOn = key !== k1;
      this.cur = new Map();
      this.curTouch = 0;
      this.sawWall = false;
      this.expanded++;
      if (n.kind === 'orbit') this.orbitPrograms(n);
      else if (n.kind === 'bounce') this.bouncePrograms(n);
      else if (n.kind === 'stand' && !n.bounce) {
        const fy = n.fy;
        // standing at home: vertical programs; then running starts both ways (ledge takeoff
        // with the model's overlap when the surface ends that way, else home ±8u)
        this.takeoff(n.px, fy, 0, [0], 0);
        for (const d of [-1, 1]) {
          const ex = this.edgePx(n, d);
          if (ex !== null && Math.abs(ex.px - n.px) > 8) {
            this.takeoff(ex.px, fy, this.runSpeed(n, ex.px, d) * d, [d, 0], d);
          } else {
            let fwd = n.px + 8 * d;
            let k = 0;
            while (k < 8 && (this.G.blocked(fwd, fy - PH, PW, PH) || this.g.support(fwd, fy) < this.M.overlap)) { fwd -= d; k++; }
            this.takeoff(fwd, fy, this.runSpeed(n, fwd, d) * d, [d, 0], d);
          }
          if (ex !== null && ex.kind === 'edge') this.walkOff(n, d);
        }
        if (n.oneway) this.dropThrough(n);
      }
      const to = [], mask = [];
      for (const [k, m] of this.cur) { if (k !== n.id) { to.push(k); mask.push(m); } }
      n.edges[key] = { to, mask };
      n.touch[key] = this.curTouch;
      n.wallSeen[key] = this.sawWall;
      this.cur = null;
      this.wallsOn = false;
      return n.edges[key];
    }
    edgesOf(n) { return n.edges[this.edgeKey(n)] || this.computeEdges(n); }

    // ---------------------------------------------------------------- searches
    // Start node(s) for a spawn body position (top-left x, y). Falls when not standing.
    startFrom(x, y) {
      const fy = y + PH;
      const n = this.g.nodeAt(x, fy);
      if (n && n.kind === 'stand' && Math.abs(n.fy - fy) < 1) return [n.id];
      this.cur = new Map(); this.curTouch = 0;
      const b = sim.newBody();
      b.x = x; b.y = y; b.grounded = false; b.vy = 0;
      if (this.G.blocked(b.x, b.y, PW, PH)) { this.cur = null; return []; }
      const s = this.st(b); s.pristine = false;
      this.px0 = x; this.fy0 = -1e9;
      this.advance(s, 0, U_NEVER, 0);
      const out = Array.from(this.cur.keys());
      this.cur = null;
      return out;
    }
    // Dijkstra (or greedy best-first with opts.toward) from start ids.
    //   opts.all  goal mask that must all be reached (stop early)   opts.any  stop at any of these
    //   opts.anyNode  Uint8Array: stop as soon as such a node becomes reachable
    //   opts.trackGems  gem mask: record the nodes reached right after touching each gem; stop
    //                   once every tracked gem has some (unless opts.all/any say otherwise)
    //   opts.exhaustive  never stop early   opts.toward [x,y]  greedy priority   opts.maxExpand
    search(starts, opts) {
      opts = opts || {};
      const N = this.g.nodes.length;
      const dist = new Float64Array(N).fill(Infinity);
      const done = new Uint8Array(N);
      const goalDist = [];
      const heap = new Heap();
      let reached = 0, hitNode = -1;
      const after = opts.trackGems ? new Map() : null;
      const gemBits = [];
      if (opts.trackGems) { let m = opts.trackGems; while (m) { const bit = m & -m; gemBits.push(31 - Math.clz32(bit)); m &= m - 1; } }
      const mark = (mask, dd, at) => {
        if (!mask) return;
        let m = mask & ~reached;
        reached |= mask;
        while (m) { const bit = m & -m; const gi = 31 - Math.clz32(bit); if (goalDist[gi] === undefined) goalDist[gi] = { d: dd, at }; m &= m - 1; }
      };
      const nodes = this.g.nodes;
      const toward = opts.toward || null;
      const prio = (id, d) => {
        if (!toward) return d;
        const n = nodes[id];
        return Math.hypot((n.px + PW / 2) - toward[0], (n.fy - PH / 2) - toward[1]) / 32 + d * 0.01;
      };
      const stop = () => {
        if (opts.exhaustive) return false;
        if (hitNode >= 0) return true;
        if (opts.any !== undefined && (reached & opts.any) !== 0) return true;
        if (opts.all) return (reached & opts.all) === opts.all;
        if (after && opts.any === undefined) { for (const gi of gemBits) if (!after.has(gi)) return false; return true; }
        return false;
      };
      const anyNode = opts.anyNode || null;
      for (const s of starts) {
        if (s >= 0 && s < N && dist[s] > 0) { dist[s] = 0; heap.push(prio(s, 0), s); if (anyNode && anyNode[s]) hitNode = s; }
      }
      let expanded = 0;
      const maxExpand = opts.maxExpand || Infinity;
      while (heap.size && !stop()) {
        const top = heap.pop();
        const id = top[1];
        if (done[id]) continue;
        done[id] = 1;
        if (++expanded > maxExpand) break;
        const d0 = dist[id];
        const n = nodes[id];
        mark(n.zone, d0, id);
        if (after && n.zone) this.noteAfter(after, n.zone, id, opts.trackGems);
        if (stop()) break;
        if (Date.now() > this.deadline) { this.timedOut = true; break; }
        const relax = (to, w) => {
          const nd = d0 + w;
          if (nd < dist[to]) { dist[to] = nd; heap.push(prio(to, nd), to); if (anyNode && anyNode[to] && hitNode < 0) hitNode = to; }
        };
        if (n.left >= 0) relax(n.left, 1);
        if (n.right >= 0) relax(n.right, 1);
        for (const l of n.links) relax(l.to, l.w);
        const e = this.edgesOf(n);
        mark(n.touch[this.edgeKey(n)], d0, id);
        for (let i = 0; i < e.to.length; i++) {
          const to = e.to[i];
          const m = nodes[to];
          const w = Math.max(1, Math.hypot(m.px - n.px, m.fy - n.fy) / 32);
          mark(e.mask[i], d0 + w, id);
          if (after && e.mask[i]) this.noteAfter(after, e.mask[i], to, opts.trackGems);
          relax(to, w);
        }
        if (this.timedOut) break;
      }
      return { reached, dist, goalDist, expanded, after, hitNode };
    }
    // search() that upgrades nodes to wall-jump programs until done(result) or nothing is left
    // to upgrade. pts: target points (world units) used to upgrade the nearest nodes first.
    searchUp(starts, opts, done, pts) {
      let batch = 6;
      for (;;) {
        const r = this.search(starts, opts);
        if (done(r) || !this.walls || this.timedOut) return r;
        const nodes = this.g.nodes, cands = [];
        for (let i = 0; i < nodes.length; i++) if (isFinite(r.dist[i]) && !this.upgraded[i] && nodes[i].wallSeen[this.kind] === true) cands.push(i);
        if (!cands.length) return r;
        const P = typeof pts === 'function' ? pts(r) : pts;
        if (P && P.length) {
          const dd = new Map();
          for (const i of cands) {
            const n = nodes[i];
            let best = Infinity;
            for (const q of P) best = Math.min(best, Math.hypot(n.px + PW / 2 - q[0], n.fy - PH / 2 - q[1]));
            dd.set(i, best);
          }
          cands.sort((a, b) => dd.get(a) - dd.get(b));
        }
        const k = Math.min(batch, cands.length);
        for (let i = 0; i < k; i++) this.upgraded[cands[i]] = 1;
        this.nUpgraded += k;
        batch *= 2;
      }
    }
    noteAfter(after, mask, id, gemMask) {
      let m = mask & gemMask;
      while (m) {
        const bit = m & -m; const gi = 31 - Math.clz32(bit);
        if (!after.has(gi)) after.set(gi, new Set());
        after.get(gi).add(id);
        m &= m - 1;
      }
    }
    // Nodes known to reach a goal in `mask` under this model, over the edges computed so far
    // (reverse search; walk/free links always count).
    reachersOf(mask) {
      const nodes = this.g.nodes, N = nodes.length;
      const rev = new Array(N);
      for (let i = 0; i < N; i++) rev[i] = [];
      const out = new Uint8Array(N);
      const queue = [];
      const seed = i => { if (!out[i]) { out[i] = 1; queue.push(i); } };
      for (const n of nodes) {
        if (n.left >= 0) rev[n.left].push(n.id);
        if (n.right >= 0) rev[n.right].push(n.id);
        for (const l of n.links) rev[l.to].push(n.id);
        if (n.zone & mask) seed(n.id);
        const ek = this.edgeKey(n);
        const e = n.edges[ek];
        if (!e) continue;
        if (n.touch[ek] & mask) seed(n.id);
        for (let i = 0; i < e.to.length; i++) { rev[e.to[i]].push(n.id); if (e.mask[i] & mask) seed(n.id); }
      }
      while (queue.length) {
        const i = queue.pop();
        for (const j of rev[i]) {
          if (out[j]) continue;
          // j reaches i through an edge only if j's edges are known or it is a free link
          out[j] = 1; queue.push(j);
        }
      }
      return out;
    }
  }

  // binary min-heap of [priority, value]
  class Heap {
    constructor() { this.p = []; this.v = []; }
    get size() { return this.p.length; }
    push(pr, val) {
      const p = this.p, v = this.v;
      let i = p.length; p.push(pr); v.push(val);
      while (i > 0) { const j = (i - 1) >> 1; if (p[j] <= pr) break; p[i] = p[j]; v[i] = v[j]; i = j; }
      p[i] = pr; v[i] = val;
    }
    pop() {
      const p = this.p, v = this.v;
      const top = [p[0], v[0]];
      const lp = p.pop(), lv = v.pop();
      const n = p.length;
      if (n) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && p[c + 1] < p[c]) c++;
          if (p[c] >= lp) break;
          p[i] = p[c]; v[i] = v[c]; i = c;
        }
        p[i] = lp; v[i] = lv;
      }
      return top;
    }
  }

  // ------------------------------------------------------------------ analysis entry point
  // geo: levelparse.geometry(...). Returns {problems:[{code, msg}], info, graph, SAFE, EXPERT}
  //   E11  SAFE: P → exit (E or V), P → every C, every C → exit
  //   E12  EXPERT: P → every gem, and after every gem → exit or a C that SAFE-reaches the exit
  // EXPERT searches start from the SAFE-reached spots nearest each gem (whatever the SAFE
  // player reaches, the expert reaches), then fall back to a full EXPERT search from P.
  // Wall-jump programs (form ≥ 4) are only simulated where a failing search needs them.
  function analyze(geo, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const graph = new Graph(geo);
    const budget = opts.budgetMs || 30000;
    const deadline = t0 + budget;
    const SAFE = new Bot(graph, 'SAFE', { deadline });
    const EXPERT = opts.noExpert ? null : new Bot(graph, 'EXPERT', { deadline });
    const problems = [];
    const info = { nodes: graph.nodes.length, pathLen: null, cpSpacing: [], ms: 0, steps: 0, replayed: 0, wallSteps: 0, pruned: 0, programs: 0, expanded: 0, expandedSafe: 0, expandedExpert: 0 };
    const goals = geo.goals;
    const nameOf = gi => {
      const g = goals[gi];
      if (!g) return '?';
      const s = g.spawn;
      const at = ' at tile ' + (Math.round(s.tx * 10) / 10) + ',' + (Math.round(s.ty * 10) / 10);
      if (g.kind === 'gem') return 'gem ' + g.n + at;
      if (g.kind === 'checkpoint') return 'checkpoint C' + at;
      return (g.kind === 'exit' ? 'exit E' : 'vertex V') + at;
    };
    const maskOf = list => list.reduce((m, gi) => m | (1 << gi), 0);
    const exitMask = maskOf(geo.exitGoals);
    const cpMask = maskOf(geo.checkpoints);
    const gemList = [];
    for (const k of Object.keys(geo.gemGoals)) gemList.push(geo.gemGoals[k]);
    const gemMask = maskOf(gemList);
    const finish = () => {
      info.ms = Date.now() - t0;
      for (const bot of [SAFE, EXPERT]) {
        if (!bot) continue;
        info.steps += bot.steps; info.replayed += bot.replayed; info.pruned += bot.pruned; info.programs += bot.programs; info.expanded += bot.expanded; info.wallSteps += bot.wallSteps;
      }
      info.expandedSafe = SAFE.expanded; info.expandedExpert = EXPERT ? EXPERT.expanded : 0;
      const up = SAFE.nUpgraded + (EXPERT ? EXPERT.nUpgraded : 0);
      info.tier = up ? 'wall-jump programs on ' + up + ' spot' + (up === 1 ? '' : 's') : '';
      info.timedOut = SAFE.timedOut || (EXPERT ? EXPERT.timedOut : false);
      info.notes = geo.notes.slice();
      if (info.timedOut) problems.push({ code: 'BUDGET', msg: 'reachability search stopped at the ' + Math.round(budget / 1000) + ' s safety budget; results are incomplete' });
      return { problems, info, graph, SAFE, EXPERT };
    };
    for (const p of graph.annotationProblems) problems.push({ code: 'E13', msg: p });
    if (!geo.start) { problems.push({ code: 'E11', msg: 'no player spawn P to start the SAFE bot from' }); return finish(); }
    if (!exitMask) problems.push({ code: 'E11', msg: 'no exit E (or vertex V) for the SAFE bot to reach' });
    const startS = SAFE.startFrom(geo.start.x, geo.start.y);
    if (!startS.length) problems.push({ code: 'E11', msg: 'the player spawn P is not on a standable spot and falls nowhere safe' });

    // ---------------- SAFE: P → exit and every C
    const ptOf = gi => { const r = goals[gi].rect; return [r[0] + r[2] / 2, r[1] + r[3] / 2]; };
    const exitPts = geo.exitGoals.map(ptOf);
    const missingPts = mask => r => { const out = []; for (const gi of geo.exitGoals.concat(geo.checkpoints, gemList)) if ((mask & (1 << gi)) && !(r.reached & (1 << gi))) out.push(ptOf(gi)); return out; };
    const r1 = SAFE.searchUp(startS, { all: exitMask | cpMask, trackGems: gemMask || undefined },
      r => (r.reached & (exitMask | cpMask)) === (exitMask | cpMask), missingPts(exitMask | cpMask));
    if (exitMask && !(r1.reached & exitMask)) problems.push({ code: 'E11', msg: 'SAFE bot: P cannot reach the ' + nameOf(geo.exitGoals[0]) + explainFrontier(graph, r1) });
    for (const gi of geo.checkpoints) if (!(r1.reached & (1 << gi))) problems.push({ code: 'E11', msg: 'SAFE bot: P cannot reach ' + nameOf(gi) + explainFrontier(graph, r1) });
    if (exitMask && r1.goalDist[geo.exitGoals[0]]) info.pathLen = Math.round(r1.goalDist[geo.exitGoals[0]].d);

    // ---------------- SAFE: every C → exit
    let toExit = SAFE.reachersOf(exitMask);
    const goodC = [];
    for (const gi of geo.checkpoints) {
      const g = goals[gi];
      const s = g.spawn;
      const x = Math.round(s.tx * 32 + 16 - PW / 2), y = Math.round(s.ty * 32 + 32 - PH);
      const st = SAFE.startFrom(x, y);
      if (!st.length) { problems.push({ code: 'E11', msg: 'SAFE bot: ' + nameOf(gi) + ' is not on a standable spot' }); continue; }
      let ok = st.some(i => toExit[i]);
      if (!ok && exitMask) {
        const r = SAFE.searchUp(st, { any: exitMask, anyNode: toExit }, q => (q.reached & exitMask) !== 0 || q.hitNode >= 0, exitPts);
        ok = (r.reached & exitMask) !== 0 || r.hitNode >= 0;
        if (!ok) problems.push({ code: 'E11', msg: 'SAFE bot: the exit is not reachable from ' + nameOf(gi) + explainFrontier(graph, r) });
        else toExit = SAFE.reachersOf(exitMask);
      }
      if (ok) goodC.push(gi);
    }
    // checkpoint spacing along the P-rooted shortest paths (W02)
    const order = geo.checkpoints.filter(gi => r1.goalDist[gi]).map(gi => ({ gi, d: r1.goalDist[gi].d })).sort((a, b) => a.d - b.d);
    let prev = 0, prevName = 'P';
    for (const o of order) { info.cpSpacing.push({ from: prevName, to: nameOf(o.gi), d: Math.round(o.d - prev) }); prev = o.d; prevName = nameOf(o.gi); }
    if (info.pathLen !== null) info.cpSpacing.push({ from: prevName, to: 'exit', d: Math.round(info.pathLen - prev) });

    // ---------------- EXPERT: gems
    if (EXPERT && gemList.length && !SAFE.timedOut) {
      const okMask = exitMask | maskOf(goodC);
      let safeReached = [], safeAll = false;
      for (let i = 0; i < graph.nodes.length; i++) if (isFinite(r1.dist[i])) safeReached.push(i);
      const nearStarts = (gx, gy) => {
        const d = i => { const n = graph.nodes[i]; return Math.hypot(n.px + PW / 2 - gx, n.fy - PH / 2 - gy); };
        let near = safeReached.filter(i => d(i) < 24 * 32);
        if (!near.length && !safeAll) {
          // the SAFE search stopped at the exit: finish exploring what SAFE reaches (edges are cached)
          const rAll = SAFE.search(startS, { exhaustive: true });
          safeAll = true;
          safeReached = [];
          for (let i = 0; i < graph.nodes.length; i++) if (isFinite(rAll.dist[i])) safeReached.push(i);
          near = safeReached.filter(i => d(i) < 24 * 32);
        }
        if (!near.length) near = safeReached.slice();
        return near.sort((a, b) => d(a) - d(b)).slice(0, 40);
      };
      const afterOk = set => {
        const ids = Array.from(set);
        if (ids.some(i => toExit[i] || (graph.nodes[i].zone & okMask))) return true;
        const r = EXPERT.searchUp(ids, { any: okMask, anyNode: toExit }, q => (q.reached & okMask) !== 0 || q.hitNode >= 0, exitPts);
        return (r.reached & okMask) !== 0 || r.hitNode >= 0;
      };
      let full = null;
      for (const gi of gemList) {
        const bit = 1 << gi;
        const g = goals[gi];
        const gx = g.rect[0] + g.rect[2] / 2, gy = g.rect[1] + g.rect[3] / 2;
        let afterSet = (r1.reached & bit) && r1.after && r1.after.get(gi);
        let reached = !!afterSet;
        if (!afterSet || !afterOk(afterSet)) {
          // EXPERT from the SAFE-reached spots nearest the gem, greedy toward it
          const near = nearStarts(gx, gy);
          let r = near.length ? EXPERT.searchUp(near, { trackGems: bit, toward: [gx, gy], maxExpand: 160 }, q => !!(q.after && q.after.get(gi)), [[gx, gy]]) : null;
          afterSet = r && r.after && r.after.get(gi);
          reached = reached || !!(r && (r.reached & bit));
          if (!afterSet || !afterOk(afterSet)) {
            if (!full) full = EXPERT.searchUp(EXPERT.startFrom(geo.start.x, geo.start.y), { trackGems: gemMask, exhaustive: true },
              q => gemList.every(g2 => q.after && q.after.get(g2)), gemList.map(ptOf));
            afterSet = full.after && full.after.get(gi);
            reached = reached || !!(full.reached & bit);
            if (!reached) { problems.push({ code: 'E12', msg: 'EXPERT bot: P cannot reach ' + nameOf(gi) + explainFrontier(graph, full) }); continue; }
            if (!afterSet || !afterSet.size) { problems.push({ code: 'E12', msg: 'EXPERT bot: ' + nameOf(gi) + ' is only touched on moves that end in death; there is no way back to the route' }); continue; }
            if (!afterOk(afterSet)) problems.push({ code: 'E12', msg: 'EXPERT bot: after ' + nameOf(gi) + ' the player can reach neither the exit nor a checkpoint that SAFE-reaches it' });
          }
        }
      }
    }
    return finish();
  }

  // A short hint naming the right-most reached stand spot, to help fix E11/E12.
  function explainFrontier(graph, r) {
    let best = null, cnt = 0;
    for (let i = 0; i < graph.nodes.length; i++) {
      if (!isFinite(r.dist[i])) continue;
      cnt++;
      const n = graph.nodes[i];
      if (n.kind !== 'stand') continue;
      if (!best || n.tx > best.tx || (n.tx === best.tx && n.fy < best.fy)) best = n;
    }
    return best ? ' (explored ' + cnt + ' spots; right-most reached: tile ' + best.tx + ',' + (best.fy / 32 - 1) + ')' : '';
  }

  exports.Graph = Graph;
  exports.Bot = Bot;
  exports.analyze = analyze;
  exports.DIRS8 = DIRS8;
  exports.MAX_STEPS = MAX_STEPS;
})(module.exports);
