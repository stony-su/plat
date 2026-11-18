/* js/ui/worldmap.js — owner: UI */
(function (AP) {
  'use strict';

  // Scene 'map' (DESIGN 7). The five worlds sit in the whirling squares of a golden rectangle; a golden
  // (logarithmic) spiral threads them, touching each world's gate vertex. Levels sit on the polygon's vertices
  // (W5's on the circle), the boss at its centre. The player's form travels along the edges; the camera eases
  // and zooms between worlds, and zooms out to show the whole spiral. params: {focus?: id, celebrate?: bool}.
  var TAU = Math.PI * 2;
  var M = AP.M;
  var PHI = (1 + Math.sqrt(5)) / 2;
  var SB = Math.log(PHI) / (Math.PI / 2);       // golden spiral: x PHI every quarter turn
  var TH0 = Math.atan(0.5) / 2;                  // phase that makes the whirling squares axis-aligned
  var LAYOUT_ROT = Math.PI / 2;                  // landscape: the big square on the left
  var FOCUS_R = 104;                             // a focused world's polygon radius on screen (px)
  var ANCHOR_X = 330, ANCHOR_Y = 290;            // where the focused world sits (the card is on the right)

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function now() { return (AP.Time && AP.Time.now) || 0; }
  function UI() { return AP.UI; }
  function data() { return (AP.Save && AP.Save.data) || null; }

  var TX = { size: 13, weight: '600', align: 'left', baseline: 'middle', color: '#FFFFFF', alpha: 1, maxW: 0 };
  function text(ctx, str, x, y, size, color, align, alpha, weight, maxW) {
    TX.size = size; TX.color = color; TX.align = align || 'left'; TX.alpha = alpha === undefined ? 1 : alpha;
    TX.weight = weight || '600'; TX.maxW = maxW || 0;
    return AP.R.text(ctx, str, x, y, TX);
  }
  var SO = { size: 20, color: '#FFFFFF', align: 'left', glow: null, glowAlpha: 0.85, alpha: 1, progress: 1, spacing: 1.4, sparks: true, maxW: 0 };
  function stroke(ctx, str, x, y, size, color, align, alpha, glow, progress, maxW) {
    SO.size = size; SO.color = color; SO.align = align || 'left'; SO.alpha = alpha === undefined ? 1 : alpha;
    SO.glow = glow || null; SO.progress = progress === undefined ? 1 : progress; SO.maxW = maxW || 0; SO.sparks = SO.progress < 1;
    return UI().strokeText(ctx, str, x, y, SO);
  }

  // ================================================================ geometry (built once)
  var spt = [0, 0];
  function spiralRaw(th, out) {
    var r = Math.exp(SB * th);
    var x = r * Math.cos(th), y = r * Math.sin(th);
    var c = Math.cos(LAYOUT_ROT), s = Math.sin(LAYOUT_ROT);
    out[0] = x * c - y * s;
    out[1] = x * s + y * c;
    return out;
  }
  function rotPt(x, y, out) {
    var c = Math.cos(LAYOUT_ROT), s = Math.sin(LAYOUT_ROT);
    out[0] = x * c - y * s;
    out[1] = x * s + y * c;
    return out;
  }

  function sampleSpiral(th0, th1, step) {
    var n = Math.max(2, Math.ceil(Math.abs(th1 - th0) / step) + 1);
    var a = new Float32Array(n * 2);
    for (var i = 0; i < n; i++) {
      spiralRaw(th0 + (th1 - th0) * i / (n - 1), spt);
      a[i * 2] = spt[0]; a[i * 2 + 1] = spt[1];
    }
    return a;
  }

  function polyLen(a) {
    var L = 0;
    for (var i = 2; i < a.length; i += 2) L += Math.sqrt((a[i] - a[i - 2]) * (a[i] - a[i - 2]) + (a[i + 1] - a[i - 1]) * (a[i + 1] - a[i - 1]));
    return L;
  }

  var G = null;
  function geometry() {
    if (G) return G;
    var W = (AP.Worlds && AP.Worlds.list) || [];
    var order = AP.Progress && AP.Progress.order ? AP.Progress.order() : [];
    var worlds = [], nodes = [], edges = [], squares = [];
    var a = [0, 0], b = [0, 0], p = [0, 0];
    var k, i;
    // whirling squares: the diagonal of square k runs between the spiral points at TH0 + k pi/2 and TH0 + (k+1) pi/2
    for (k = -8; k <= 4; k++) {
      spiralRaw(TH0 + k * Math.PI / 2, a);
      spiralRaw(TH0 + (k + 1) * Math.PI / 2, b);
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, hx = (b[0] - a[0]) / 2, hy = (b[1] - a[1]) / 2;
      squares.push({ k: k, pts: new Float32Array([a[0], a[1], mx - hy, my + hx, b[0], b[1], mx + hy, my - hx]), cx: mx, cy: my,
        side: Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])) / Math.SQRT2 });
    }
    for (var n = 1; n <= W.length && n <= 5; n++) {
      var wd = W[n - 1];
      var sq = null;
      for (k = 0; k < squares.length; k++) if (squares[k].k === n - 1) sq = squares[k];
      // the gate: where the spiral passes closest to the square's centre
      var best = 1e9, bth = 0;
      var t0 = TH0 + (n - 1) * Math.PI / 2, t1 = TH0 + n * Math.PI / 2;
      for (var th = t0; th <= t1; th += 0.002) {
        spiralRaw(th, p);
        var d = Math.sqrt((p[0] - sq.cx) * (p[0] - sq.cx) + (p[1] - sq.cy) * (p[1] - sq.cy));
        if (d < best) { best = d; bth = th; }
      }
      spiralRaw(bth, p);
      var a0 = Math.atan2(p[1] - sq.cy, p[0] - sq.cx);
      var sides = wd.form >= 32 ? 48 : wd.form;
      var w = { n: n, def: wd, cx: sq.cx, cy: sq.cy, R: best, side: sq.side, sides: sides, a0: a0, gateTh: bth,
        pal: AP.R.pal(wd.style), nodes: [], deco: null, sq: sq };
      // level nodes on the vertices (W5: evenly on the circle), in the spiral's sense of rotation
      for (i = 0; i < wd.levels; i++) {
        var ang = a0 + i * TAU / wd.levels;
        var node = { id: wd.id + '-' + (i + 1), world: n, boss: false, x: sq.cx + Math.cos(ang) * best, y: sq.cy + Math.sin(ang) * best,
          ang: ang, sx: 0, sy: 0, idx: -1, w: w, pop: -9 };
        w.nodes.push(node);
      }
      var bossNode = { id: wd.boss, world: n, boss: true, x: sq.cx, y: sq.cy, ang: 0, sx: 0, sy: 0, idx: -1, w: w, pop: -9 };
      w.nodes.push(bossNode);
      w.bossNode = bossNode;
      worlds.push(w);
    }
    // progression order (Progress.order) and its edges
    var byId = {};
    for (i = 0; i < worlds.length; i++) for (k = 0; k < worlds[i].nodes.length; k++) byId[worlds[i].nodes[k].id] = worlds[i].nodes[k];
    for (i = 0; i < order.length; i++) {
      var nd = byId[order[i]];
      if (!nd) continue;
      nd.idx = nodes.length;
      nodes.push(nd);
    }
    for (i = 0; i + 1 < nodes.length; i++) {
      var A = nodes[i], Bn = nodes[i + 1];
      var pts, kind;
      if (A.world === Bn.world && !A.boss && !Bn.boss) {
        if (A.w.sides >= 32) {
          // an arc along the circle
          var aa = A.ang, ab = Bn.ang;
          while (ab < aa) ab += TAU;
          var steps = 16;
          pts = new Float32Array((steps + 1) * 2);
          for (k = 0; k <= steps; k++) {
            var ak = aa + (ab - aa) * k / steps;
            pts[k * 2] = A.w.cx + Math.cos(ak) * A.w.R; pts[k * 2 + 1] = A.w.cy + Math.sin(ak) * A.w.R;
          }
          kind = 'arc';
        } else { pts = new Float32Array([A.x, A.y, Bn.x, Bn.y]); kind = 'side'; }
      } else if (A.world === Bn.world && Bn.boss) {
        pts = new Float32Array([A.x, A.y, Bn.x, Bn.y]);
        kind = 'spoke';
      } else {
        // boss of world n -> the gate (spoke) -> along the spiral to the next world's gate
        var sp = sampleSpiral(A.w.gateTh, Bn.w.gateTh, 0.025);
        pts = new Float32Array(sp.length + 2);
        pts[0] = A.x; pts[1] = A.y;
        pts.set(sp, 2);
        kind = 'spiral';
      }
      edges.push({ i: i, from: A, to: Bn, pts: pts, len: polyLen(pts), kind: kind, draw: -1 });
    }
    // the origin: the spiral winding out of the eye to the first gate; the tail beyond the last world
    var originTh = worlds.length ? worlds[0].gateTh : TH0;
    var lastTh = worlds.length ? worlds[worlds.length - 1].gateTh : TH0;
    // bounds of the five squares (overview)
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (k = 0; k < squares.length; k++) {
      if (squares[k].k < 0 || squares[k].k > 4) continue;
      for (i = 0; i < 8; i += 2) {
        minx = Math.min(minx, squares[k].pts[i]); maxx = Math.max(maxx, squares[k].pts[i]);
        miny = Math.min(miny, squares[k].pts[i + 1]); maxy = Math.max(maxy, squares[k].pts[i + 1]);
      }
    }
    G = {
      worlds: worlds, nodes: nodes, edges: edges, squares: squares, byId: byId,
      origin: sampleSpiral(originTh - 7 * Math.PI, originTh, 0.03),
      tail: sampleSpiral(lastTh, lastTh + 1.15 * Math.PI, 0.025),
      eye: spiralRaw(-60, [0, 0]),
      ovX: (minx + maxx) / 2, ovY: (miny + maxy) / 2, ovZ: Math.min(900 / (maxx - minx), 488 / (maxy - miny))
    };
    for (i = 0; i < worlds.length; i++) worlds[i].deco = buildDeco(worlds[i]);
    return G;
  }

  // ---------------------------------------------------------------- world art (local units: polygon radius 1)
  function buildDeco(w) {
    var segs = [];           // flat [x1,y1,x2,y2,...] segment list, local frame (rotated with a0 at draw)
    var dots = [];
    var rng = AP.RNG(AP.hash('map-' + w.n));
    var i, k;
    if (w.n === 1) {
      // Truchet quarter arcs
      var s = 0.26;
      for (var gy = -4; gy < 4; gy++) for (var gx = -4; gx < 4; gx++) {
        var o = (AP.hash2(gx + 9, gy + 9, 31) & 1);
        var x0 = gx * s, y0 = gy * s;
        for (var c = 0; c < 2; c++) {
          // two quarter arcs per tile, centred on opposite corners (orientation o picks the diagonal)
          var ccx = o ? (c ? x0 : x0 + s) : (c ? x0 + s : x0);
          var ccy = c ? y0 + s : y0;
          var st = o ? (c ? -Math.PI / 2 : Math.PI / 2) : (c ? Math.PI : 0);
          for (k = 0; k < 5; k++) {
            var t0 = st + k * Math.PI / 10, t1 = st + (k + 1) * Math.PI / 10;
            segs.push(ccx + Math.cos(t0) * s / 2, ccy + Math.sin(t0) * s / 2, ccx + Math.cos(t1) * s / 2, ccy + Math.sin(t1) * s / 2);
          }
        }
      }
    } else if (w.n === 2) {
      // Voronoi facets
      var sites = [];
      for (i = 0; i < 14; i++) sites.push([rng.range(-0.95, 0.95), rng.range(-0.95, 0.95)]);
      var cells = null;
      if (AP.Algo && AP.Algo.voronoi) { try { cells = AP.Algo.voronoi(sites, [-1.1, -1.1, 2.2, 2.2]); } catch (e) { cells = null; } }
      if (cells) for (i = 0; i < cells.length; i++) {
        var pl = cells[i].poly;
        if (!pl) continue;
        for (k = 0; k < pl.length; k += 2) {
          var k2 = (k + 2) % pl.length;
          segs.push(pl[k], pl[k + 1], pl[k2], pl[k2 + 1]);
        }
      }
      for (i = 0; i < sites.length; i++) dots.push(sites[i][0], sites[i][1]);
    } else if (w.n === 3) {
      // streamlines of one flow field
      var fp = AP.Flow ? AP.Flow.params({ seed: 5, scale: 0.9, spread: 2.2, mmin: 0.4 }) : null;
      var line = [];
      for (var sy2 = -0.8; sy2 <= 0.81; sy2 += 0.27) {
        for (var sx2 = -0.8; sx2 <= 0.81; sx2 += 0.4) {
          line.length = 0;
          if (fp) { try { AP.Flow.streamline(sx2, sy2, 0, fp, 0.05, 14, line); } catch (e2) { line.length = 0; } }
          for (k = 2; k < line.length; k += 2) segs.push(line[k - 2], line[k - 1], line[k], line[k + 1]);
        }
      }
    } else if (w.n === 4) {
      // a Sierpinski gasket inside the hexagon
      var tris = AP.Algo && AP.Algo.sierpinski ? AP.Algo.sierpinski(0, 0.08, 1.45, 4) : [];
      for (i = 0; i < tris.length; i++) {
        var tr = tris[i];
        segs.push(tr[0], tr[1], tr[2], tr[3], tr[2], tr[3], tr[4], tr[5], tr[4], tr[5], tr[0], tr[1]);
      }
    } else {
      // Lissajous figures and phyllotaxis seeds
      var F = [[3, 2, 0.82], [5, 4, 0.6], [3, 4, 0.4]];
      for (i = 0; i < F.length; i++) {
        var px = 0, py = 0;
        for (k = 0; k <= 160; k++) {
          var tt = k / 160 * TAU;
          var lx = F[i][2] * Math.sin(F[i][0] * tt + i), ly = F[i][2] * Math.sin(F[i][1] * tt);
          if (k) segs.push(px, py, lx, ly);
          px = lx; py = ly;
        }
      }
      for (i = 1; i < 90; i++) { var r = 0.085 * Math.sqrt(i), th = i * 2.39996; dots.push(Math.cos(th) * r, Math.sin(th) * r); }
    }
    return { segs: new Float32Array(segs), dots: new Float32Array(dots) };
  }

  // ================================================================ scene state
  var S = {
    t0: 0, sel: 0, cam: { x: 0, y: 0, z: 1 }, target: { x: 0, y: 0, z: 1 }, anchorX: ANCHOR_X, overview: false,
    travel: null, celebrate: null, card: 0, enterT: -1, leaving: false, worldCard: null, hoverT: 0, lastSel: -1, introT: 0,
    selPop: -9, denyT: -9
  };

  function nodeAt(i) { var g = geometry(); return g.nodes[clamp(i, 0, g.nodes.length - 1)] || null; }
  // per-visit caches: the save cannot change while the map is open (AP.Progress.isUnlocked copies an array per call)
  var OPEN = {};
  var STATS = { pct: 0, gems: 0, ws: [], pctStr: '', gemStr: '' };
  function refresh() {
    var g = geometry();
    OPEN = {};
    for (var i = 0; i < g.nodes.length; i++) OPEN[g.nodes[i].id] = !!(AP.Progress && AP.Progress.isUnlocked(g.nodes[i].id));
    STATS.pct = AP.Progress && AP.Progress.percent ? AP.Progress.percent() : 0;
    STATS.gems = AP.Meta ? AP.Meta.gemCount() : 0;
    STATS.pctStr = STATS.pct + '%';
    STATS.gemStr = STATS.gems + '/72';
    STATS.ws.length = 0;
    for (var k = 0; k < g.worlds.length; k++) {
      var ws = AP.Progress && AP.Progress.worldState ? AP.Progress.worldState(g.worlds[k].n) : null;
      var tot = g.worlds[k].def.levels + 1;
      STATS.ws.push(ws ? { ws: ws, tot: tot, line: ws.levelsDone + '/' + tot + ' cleared  ·  ' + ws.gems + '/' + ws.gemsTotal + ' gems' } : null);
    }
  }
  function unlocked(nd) { return !!(nd && OPEN[nd.id] === true); }
  function record(id) { var d = data(); return d && d.levels ? d.levels[id] : null; }
  function cleared(nd) { var r = record(nd.id); return !!(r && r.done); }
  function worldOpen(w) { return unlocked(w.nodes[0]); }

  // the furthest node the cursor may visit: every unlocked node plus the first locked one after them
  function maxSelectable() {
    var g = geometry();
    var last = 0;
    for (var i = 0; i < g.nodes.length; i++) if (unlocked(g.nodes[i])) last = i;
    return Math.min(g.nodes.length - 1, last + 1);
  }

  function zoomFor(w) {
    var g = geometry();
    return clamp(FOCUS_R / w.R, g.ovZ * 1.02, g.ovZ * 7);
  }

  // ---------------------------------------------------------------- travel along the edges
  // d0: distance already covered along the new path (a travel re-aimed mid-flight keeps the icon where it is)
  function startTravel(from, to, d0) {
    var g = geometry();
    if (from === to) { S.travel = null; return; }
    var list = [];
    var dir = to > from ? 1 : -1;
    var len = 0;
    for (var i = from; i !== to; i += dir) {
      var e = g.edges[dir > 0 ? i : i - 1];
      if (!e) break;
      list.push(e);
      len += e.len;
    }
    // screen-space feel: time grows with the distance on screen at the current zoom, capped
    d0 = clamp(d0 || 0, 0, len);
    var px = (len - d0) * S.cam.z;
    var dur = clamp(0.28 + px / 1100, 0.32, 1.7);
    S.travel = { edges: list, dir: dir, len: len, t0: now(), dur: dur, from: from, to: to, d0: d0 };
  }

  function travelDist(tr) {
    var k = M.ease.inOutSine(clamp01((now() - tr.t0) / tr.dur));
    return tr.d0 + (tr.len - tr.d0) * k;
  }

  // the edge the icon is on right now, and its distance from that edge's lower-index node
  var onEdge = { e: null, low: 0 };
  function iconOnEdge(tr) {
    var d = travelDist(tr), acc = 0;
    for (var k = 0; k < tr.edges.length; k++) {
      var e = tr.edges[k];
      if (d <= acc + e.len || k === tr.edges.length - 1) {
        var along = clamp(d - acc, 0, e.len);
        onEdge.e = e;
        onEdge.low = tr.dir > 0 ? along : e.len - along;
        return onEdge;
      }
      acc += e.len;
    }
    onEdge.e = null;
    return onEdge;
  }

  var tp = { x: 0, y: 0, ex: 0, ey: 0 };
  // position at distance d along the travel path (writes tp)
  function travelPos(tr, d) {
    var acc = 0;
    for (var i = 0; i < tr.edges.length; i++) {
      var e = tr.edges[i];
      if (d <= acc + e.len || i === tr.edges.length - 1) {
        var local = clamp(d - acc, 0, e.len);
        if (tr.dir < 0) local = e.len - local;
        pointOnEdge(e, local, tp);
        return tp;
      }
      acc += e.len;
    }
    tp.x = 0; tp.y = 0;
    return tp;
  }
  function pointOnEdge(e, dist, out) {
    var a = e.pts, acc = 0;
    for (var i = 2; i < a.length; i += 2) {
      var dx = a[i] - a[i - 2], dy = a[i + 1] - a[i - 1];
      var l = Math.sqrt(dx * dx + dy * dy);
      if (acc + l >= dist) {
        var f = l > 0 ? (dist - acc) / l : 0;
        out.x = a[i - 2] + dx * f; out.y = a[i - 1] + dy * f;
        out.ex = dx; out.ey = dy;
        return out;
      }
      acc += l;
    }
    out.x = a[a.length - 2]; out.y = a[a.length - 1];
    return out;
  }

  function iconPos(out) {
    var tr = S.travel;
    if (tr) {
      travelPos(tr, travelDist(tr));
      out.x = tp.x; out.y = tp.y;
      return out;
    }
    var nd = nodeAt(S.sel);
    out.x = nd ? nd.x : 0; out.y = nd ? nd.y : 0;
    return out;
  }

  function select(i, silent) {
    var g = geometry();
    i = clamp(i, 0, g.nodes.length - 1);
    if (i === S.sel) return;
    if (i > maxSelectable()) { deny(); return; }
    var tr = S.travel;
    var on = tr && now() - tr.t0 < tr.dur ? iconOnEdge(tr) : null;
    if (on && on.e) {
      // re-aim from where the icon is: forward from the edge's lower node, or back from its upper node
      var a = on.e.i;
      if (i > a) startTravel(a, i, on.low);
      else startTravel(a + 1, i, on.e.len - on.low);
    } else startTravel(S.sel, i, 0);
    S.sel = i;
    S.selPop = now();
    if (!silent) AP.sfx('uiMove', { pitch: 0.9 + 0.3 * (i / Math.max(1, g.nodes.length)) });
  }

  function deny() { S.denyT = now(); AP.sfx('uiDeny'); }

  function selectWorld(dir) {
    var g = geometry();
    var cur = nodeAt(S.sel);
    var wn = (cur ? cur.world : 1) + dir;
    if (wn < 1 || wn > g.worlds.length) { deny(); return; }
    var w = g.worlds[wn - 1];
    // first uncleared unlocked node of that world, else its gate
    var pick = w.nodes[0].idx;
    for (var i = 0; i < w.nodes.length; i++) {
      var nd = w.nodes[i];
      if (nd.idx < 0) continue;
      if (unlocked(nd) && !cleared(nd)) { pick = nd.idx; break; }
    }
    if (dir < 0) {
      // going back: the boss of that world is the natural landing spot
      pick = unlocked(w.bossNode) ? w.bossNode.idx : pick;
    }
    if (pick > maxSelectable()) { deny(); return; }
    select(pick);
  }

  function enterLevel() {
    var nd = nodeAt(S.sel);
    if (!nd || S.leaving) return;
    if (!unlocked(nd)) {
      deny();
      var prev = nodeAt(nd.idx - 1);
      if (AP.Meta) AP.Meta.pushToast({ title: 'Locked', sub: prev ? 'Clear ' + UI().levelLabel(prev.id) + ' first.' : 'Clear the earlier levels first.', kind: 'info' });
      return;
    }
    if (!AP.Levels || !AP.Levels.has(nd.id)) {
      deny();
      if (AP.Meta) AP.Meta.pushToast({ title: UI().levelLabel(nd.id) + ' is not available', sub: 'This level is missing from this build.', kind: 'warn' });
      return;
    }
    S.leaving = true;
    S.enterT = now();
    AP.sfx('uiSelect');
    var pal = nd.w.pal;
    var p = screenOf(nd.x, nd.y, sp2);
    UI().sparks.emit(p.x, p.y, { n: 30, color: pal.accent, color2: pal.ink, speed: [60, 260], life: [0.4, 0.9], size: [1.2, 2.6], drag: 2.4, shape: 3 });
    UI().go('level', { id: nd.id, mode: 'story' }, 'iris', 0.8);
  }

  // ---------------------------------------------------------------- celebration of new unlocks
  function setupCelebration(ids) {
    var g = geometry();
    var steps = [];
    for (var i = 0; i < ids.length; i++) {
      var nd = g.byId[ids[i]];
      if (!nd || nd.idx <= 0) continue;
      var e = g.edges[nd.idx - 1];
      steps.push({ edge: e, node: nd, newWorld: e && e.kind === 'spiral' ? nd.w : null });
    }
    if (!steps.length) return null;
    steps.sort(function (a, b) { return a.node.idx - b.node.idx; });
    var t = now() + 0.9;
    for (var k = 0; k < steps.length; k++) {
      var st = steps[k];
      st.t0 = t;
      st.dur = st.edge.kind === 'spiral' ? 2.0 : 0.9;
      t += st.dur + (st.newWorld ? 1.6 : 0.35);
      st.edge.draw = 0;
    }
    return { steps: steps, end: t, moved: false };
  }

  function celebrationUpdate() {
    var c = S.celebrate;
    if (!c) return;
    var t = now();
    for (var i = 0; i < c.steps.length; i++) {
      var st = c.steps[i];
      var k = clamp01((t - st.t0) / st.dur);
      if (st.edge.draw >= 0) st.edge.draw = k;
      if (k >= 1 && !st.popped) {
        st.popped = true;
        st.edge.draw = -1;
        st.node.pop = t;
        AP.sfx(st.newWorld ? 'vertex' : 'checkpoint', { vol: 0.7 });
        var p = screenOf(st.node.x, st.node.y, sp2);
        UI().sparks.emit(p.x, p.y, { n: 26, color: st.node.w.pal.accent, color2: '#FFFFFF', speed: [40, 200], life: [0.4, 0.9], size: [1, 2.4], drag: 2.5, shape: 2 });
        if (st.newWorld) S.worldCard = { w: st.newWorld, t0: t };
      }
    }
    if (t >= c.end && !c.moved) {
      c.moved = true;
      var last = c.steps[c.steps.length - 1].node;
      select(last.idx, true);
      S.celebrate = null;
    }
  }

  // ---------------------------------------------------------------- camera
  var sp2 = { x: 0, y: 0 };
  function screenOf(x, y, out) {
    out.x = (x - S.cam.x) * S.cam.z + S.anchorX;
    out.y = (y - S.cam.y) * S.cam.z + ANCHOR_Y;
    return out;
  }

  var icp = { x: 0, y: 0 };
  function cameraTarget() {
    var g = geometry();
    var T = S.target;
    if (S.overview || now() - S.t0 < S.introT) {
      T.x = g.ovX; T.y = g.ovY; T.z = g.ovZ; T.ax = 480;
      return T;
    }
    // follow the celebration's drawing head, else the icon
    var c = S.celebrate;
    var follow = null;
    if (c) for (var i = 0; i < c.steps.length; i++) {
      var st = c.steps[i];
      var tt = now() - st.t0;
      if (tt >= -0.6 && !st.popped) { follow = st; break; }
      if (st.popped && st.newWorld && now() - st.t0 - st.dur < 1.6) { follow = st; break; }
    }
    if (follow) {
      var e = follow.edge;
      var k = clamp01((now() - follow.t0) / follow.dur);
      pointOnEdge(e, e.len * M.ease.inOutSine(k), tp);
      var wz = zoomFor(follow.node.w);
      var fz = e.kind === 'spiral' ? Math.min(wz, zoomFor(e.from.w)) * (1 - 0.35 * Math.sin(Math.PI * k)) : wz;
      if (follow.popped) { T.x = follow.node.w.cx; T.y = follow.node.w.cy; T.z = zoomFor(follow.node.w); }
      else { T.x = tp.x; T.y = tp.y; T.z = fz; }
      T.ax = ANCHOR_X;
      return T;
    }
    iconPos(icp);
    var nd = nodeAt(S.sel);
    var w = nd ? nd.w : g.worlds[0];
    var z = zoomFor(w);
    var tr = S.travel;
    if (tr) {
      // dip the zoom while flying between worlds along the spiral
      var fromW = nodeAt(tr.from).w, toW = nodeAt(tr.to).w;
      var kk = clamp01((now() - tr.t0) / tr.dur);
      if (fromW !== toW) {
        var z0 = zoomFor(fromW), z1 = zoomFor(toW);
        z = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * M.ease.inOutSine(kk)) * (1 - 0.3 * Math.sin(Math.PI * kk));
        T.x = icp.x; T.y = icp.y;
      } else {
        T.x = w.cx + (icp.x - w.cx) * 0.3; T.y = w.cy + (icp.y - w.cy) * 0.3;
      }
    } else {
      T.x = w.cx + (icp.x - w.cx) * 0.3;
      T.y = w.cy + (icp.y - w.cy) * 0.3;
    }
    T.z = z;
    T.ax = ANCHOR_X;
    return T;
  }

  function cameraUpdate(dt) {
    var T = cameraTarget();
    var k = 1 - Math.exp(-dt * 4.2);
    S.cam.x += (T.x - S.cam.x) * k;
    S.cam.y += (T.y - S.cam.y) * k;
    S.cam.z = Math.exp(Math.log(S.cam.z) + (Math.log(T.z) - Math.log(S.cam.z)) * k);
    S.anchorX += (T.ax - S.anchorX) * k;
  }

  // ================================================================ scene hooks
  S.bg = function () {
    return { key: 'map', camX: S.cam.x * 18, camY: S.cam.y * 18, intensity: 0.3 };
  };

  S.enter = function (params) {
    var g = geometry();
    params = params || {};
    S.t0 = now();
    S.leaving = false;
    S.travel = null;
    S.overview = false;
    S.worldCard = null;
    S.celebrate = null;
    var focus = params.focus && g.byId[params.focus] ? g.byId[params.focus] : null;
    if (!focus) {
      var cur = AP.Progress && AP.Progress.current ? AP.Progress.current() : null;
      focus = g.byId[cur] || g.nodes[0];
    }
    refresh();
    S.sel = focus ? focus.idx : 0;
    if (S.sel > maxSelectable()) S.sel = maxSelectable();
    // open on the whole spiral, then ease into the focused world
    S.introT = params.celebrate ? 0.2 : 0.55;
    S.cam.x = g.ovX; S.cam.y = g.ovY; S.cam.z = g.ovZ * 0.92;
    S.anchorX = 480;
    for (var i = 0; i < g.edges.length; i++) g.edges[i].draw = -1;
    for (var j = 0; j < g.nodes.length; j++) g.nodes[j].pop = -9;
    if (params.celebrate && AP.Meta && AP.Meta.lastUnlocked && AP.Meta.lastUnlocked.length) {
      S.celebrate = setupCelebration(AP.Meta.lastUnlocked);
      AP.Meta.lastUnlocked = [];
    }
    AP.music('map');
    if (AP.level) AP.level = null;
    UI().sparks.clear();
  };

  S.exit = function () { S.travel = null; S.celebrate = null; };

  S.update = function (dt) {
    var U = UI();
    var n = U.nav();
    var I = AP.Input;
    if (S.travel && now() - S.travel.t0 >= S.travel.dur) S.travel = null;
    celebrationUpdate();
    if (S.leaving) return;
    S.overview = !!(I && I.held('orbit'));
    if (S.celebrate) {
      // a key press finishes the celebration at once
      if (n.confirm || n.back || n.click) {
        U.eat();
        var c = S.celebrate;
        for (var i = 0; i < c.steps.length; i++) { c.steps[i].t0 = now() - c.steps[i].dur - 0.01; }
        c.end = now();
        celebrationUpdate();
      }
      return;
    }
    if (n.left) select(S.sel - 1);
    if (n.right) select(S.sel + 1);
    if (n.up) selectWorld(1);
    if (n.down) selectWorld(-1);
    if (n.confirm) { U.eat(); enterLevel(); return; }
    if (n.back) { U.eat(); AP.sfx('uiBack'); S.leaving = true; U.go('title', {}, 'fade', 0.6); return; }
    // mouse: hover selects, click on the selected node enters
    if (n.moved || n.click) {
      var g = geometry();
      var best = -1, bd = 18 * 18;
      for (var k = 0; k < g.nodes.length; k++) {
        var nd = g.nodes[k];
        var dx = nd.sx - n.mx, dy = nd.sy - n.my, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) {
        if (n.click && best === S.sel) enterLevel();
        else if (best !== S.sel && best <= maxSelectable()) select(best);
        else if (n.click && best > maxSelectable()) deny();
      }
    }
  };

  // ================================================================ drawing
  var DASH = [4, 6], NO_DASH = [];

  function strokeFlat(ctx, a, upto) {
    // upto: fraction of the polyline to draw (0..1)
    var n = a.length / 2;
    if (n < 2) return;
    var lim = upto === undefined ? n - 1 : (n - 1) * clamp01(upto);
    var whole = Math.floor(lim);
    ctx.beginPath();
    screenOf(a[0], a[1], sp2);
    ctx.moveTo(sp2.x, sp2.y);
    for (var i = 1; i <= whole; i++) { screenOf(a[i * 2], a[i * 2 + 1], sp2); ctx.lineTo(sp2.x, sp2.y); }
    var f = lim - whole;
    if (f > 0 && whole + 1 < n) {
      var x = a[whole * 2] + (a[whole * 2 + 2] - a[whole * 2]) * f, y = a[whole * 2 + 1] + (a[whole * 2 + 3] - a[whole * 2 + 1]) * f;
      screenOf(x, y, sp2);
      ctx.lineTo(sp2.x, sp2.y);
    }
    ctx.stroke();
  }

  function onScreen(x, y, r) {
    screenOf(x, y, sp2);
    return sp2.x > -r && sp2.x < 960 + r && sp2.y > -r && sp2.y < 540 + r;
  }

  function polyPathScreen(ctx, w, scale) {
    screenOf(w.cx, w.cy, sp2);
    var cx = sp2.x, cy = sp2.y, R = w.R * S.cam.z * (scale || 1);
    if (w.sides >= 32) { ctx.beginPath(); ctx.arc(cx, cy, Math.max(0, R), 0, TAU); return; }
    ctx.beginPath();
    for (var i = 0; i < w.sides; i++) {
      var a = w.a0 + i * TAU / w.sides;
      var x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawSquares(ctx, pal, t) {
    var g = geometry();
    var pa = ctx.globalAlpha;
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 1;
    for (var i = 0; i < g.squares.length; i++) {
      var s = g.squares[i];
      var px = s.side * S.cam.z;
      if (px < 4) continue;
      ctx.globalAlpha = pa * (s.k > 4 ? 0 : (s.k < 0 ? 0.05 + 0.05 * clamp01(px / 60) : 0.09));
      if (ctx.globalAlpha <= 0.002) continue;
      ctx.beginPath();
      for (var k = 0; k < 8; k += 2) { screenOf(s.pts[k], s.pts[k + 1], sp2); if (k === 0) ctx.moveTo(sp2.x, sp2.y); else ctx.lineTo(sp2.x, sp2.y); }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = pa;
  }

  function drawSpiral(ctx, pal, t) {
    var g = geometry();
    var pa = ctx.globalAlpha;
    // the infinite inward winding: the Point at the eye
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = pa * 0.38;
    strokeFlat(ctx, g.origin);
    screenOf(g.eye[0], g.eye[1], sp2);
    var b = 0.5 + 0.5 * Math.sin(t * 2);
    AP.R.glow(ctx, sp2.x, sp2.y, 10 + 6 * b, pal.accent, 0.6);
    ctx.globalAlpha = pa;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(sp2.x, sp2.y, 1.6, 0, TAU);
    ctx.fill();
    // the tail after the last world: Apeiron
    var d = data();
    var open = !!(d && d.flags && d.flags.endlessUnlocked);
    ctx.globalAlpha = pa * (open ? 0.5 : 0.16);
    ctx.setLineDash(DASH);
    ctx.lineDashOffset = -t * 12;
    strokeFlat(ctx, g.tail);
    ctx.setLineDash(NO_DASH);
    ctx.lineDashOffset = 0;
    var tl = g.tail;
    screenOf(tl[tl.length - 2], tl[tl.length - 1], sp2);
    ctx.globalAlpha = pa;
    if (sp2.x > -40 && sp2.x < 1000 && sp2.y > -40 && sp2.y < 580) {
      if (open) AP.R.glow(ctx, sp2.x, sp2.y, 26, pal.accent, 0.5);
      stroke(ctx, '∞', sp2.x, sp2.y, 26, open ? pal.ink : rgba(pal.ink, 0.3), 'center', 1, open ? pal.accent : null);
    }
    ctx.globalAlpha = pa;
  }

  function drawWorld(ctx, w, t, focusW) {
    var pal = w.pal;
    var open = worldOpen(w);
    screenOf(w.cx, w.cy, sp2);
    var cx = sp2.x, cy = sp2.y, R = w.R * S.cam.z;
    if (cx + R < -40 || cx - R > 1000 || cy + R < -40 || cy - R > 580) return;
    var focus = w === focusW;
    var pa = ctx.globalAlpha;
    var celebrateDraw = 1;
    // a world revealed by the celebration draws its outline on
    var c = S.celebrate;
    if (c) for (var i = 0; i < c.steps.length; i++) if (c.steps[i].newWorld === w && !c.steps[i].popped) celebrateDraw = 0;
    if (S.worldCard && S.worldCard.w === w) celebrateDraw = clamp01((now() - S.worldCard.t0) / 1.2);
    var vis = open ? (focus ? 1 : 0.72) : 0.3;
    // decoration, clipped to the polygon
    // decoration: always on the focused world, on others only when they are large enough on screen to read
    if (open && R > 14 && celebrateDraw > 0 && (focus || R > 46)) {
      ctx.save();
      polyPathScreen(ctx, w, 0.97);
      ctx.clip();
      var d = w.deco;
      var ca = Math.cos(w.a0), sa = Math.sin(w.a0);
      ctx.globalAlpha = pa * vis * (focus ? 0.3 : 0.18) * celebrateDraw;
      ctx.strokeStyle = w.n === 5 ? pal.accent : pal.primary;
      ctx.lineWidth = 1;
      if (w.n === 3) { ctx.setLineDash(DASH); ctx.lineDashOffset = -t * 10; }
      var spin = w.n === 5 ? t * 0.05 : 0;
      var cs = Math.cos(w.a0 + spin), sn = Math.sin(w.a0 + spin);
      ctx.beginPath();
      var sg = d.segs;
      for (var k = 0; k < sg.length; k += 4) {
        ctx.moveTo(cx + (sg[k] * cs - sg[k + 1] * sn) * R, cy + (sg[k] * sn + sg[k + 1] * cs) * R);
        ctx.lineTo(cx + (sg[k + 2] * cs - sg[k + 3] * sn) * R, cy + (sg[k + 2] * sn + sg[k + 3] * cs) * R);
      }
      ctx.stroke();
      if (w.n === 3) { ctx.setLineDash(NO_DASH); ctx.lineDashOffset = 0; }
      if (d.dots.length) {
        ctx.fillStyle = pal.accent;
        ctx.globalAlpha = pa * vis * 0.35 * celebrateDraw;
        ctx.beginPath();
        var dr = Math.max(0.8, R * 0.012);
        for (var q = 0; q < d.dots.length; q += 2) {
          var x = cx + (d.dots[q] * ca - d.dots[q + 1] * sa) * R, y = cy + (d.dots[q] * sa + d.dots[q + 1] * ca) * R;
          ctx.moveTo(x + dr, y);
          ctx.arc(x, y, dr, 0, TAU);
        }
        ctx.fill();
      }
      ctx.restore();
    }
    // outline
    ctx.globalAlpha = pa * vis;
    ctx.strokeStyle = open ? pal.primary : rgba(pal.primary, 0.6);
    ctx.lineWidth = focus ? 2 : 1.5;
    ctx.lineJoin = 'round';
    if (!open) { ctx.setLineDash(DASH); }
    if (celebrateDraw < 1) {
      // draw-on: the outline traced from the gate
      ctx.beginPath();
      var n = w.sides >= 32 ? 64 : w.sides;
      var total = n * celebrateDraw;
      for (var e = 0; e < n; e++) {
        var f = clamp01(total - e);
        if (f <= 0) break;
        var a0 = w.a0 + e * TAU / n, a1 = w.a0 + (e + 1) * TAU / n;
        var x0 = cx + Math.cos(a0) * R, y0 = cy + Math.sin(a0) * R, x1 = cx + Math.cos(a1) * R, y1 = cy + Math.sin(a1) * R;
        if (e === 0) ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
      }
      ctx.stroke();
    } else {
      polyPathScreen(ctx, w);
      ctx.stroke();
      if (focus && open) {
        ctx.globalAlpha = pa * 0.25;
        polyPathScreen(ctx, w, 1.06 + 0.01 * Math.sin(t * 2));
        ctx.stroke();
      }
    }
    ctx.setLineDash(NO_DASH);
    ctx.lineJoin = 'miter';
    // name under the polygon when zoomed out
    var lab = clamp01((90 - R) / 50) * (S.overview ? 1 : 0.85);
    if (lab > 0.02 && R > 6) {
      text(ctx, 'W' + w.n, cx, cy + R + 14, 10.5, open ? pal.accent : rgba(pal.ink, 0.4), 'center', lab, '800');
    }
    ctx.globalAlpha = pa;
  }

  function drawEdges(ctx, t) {
    var g = geometry();
    var pa = ctx.globalAlpha;
    ctx.lineCap = 'round';
    for (var i = 0; i < g.edges.length; i++) {
      var e = g.edges[i];
      var pal = e.to.w.pal;
      var open = unlocked(e.to);
      var drawK = e.draw >= 0 ? e.draw : -1;
      if (drawK >= 0) open = false;
      var isSpiral = e.kind === 'spiral';
      // base: faint for locked, solid for open
      ctx.strokeStyle = isSpiral ? (open ? pal.accent : rgba(pal.accent, 0.5)) : pal.primary;
      ctx.lineWidth = isSpiral ? (open ? 2 : 1.2) : (open ? 1.8 : 1.2);
      ctx.globalAlpha = pa * (open ? (isSpiral ? 0.75 : 0.85) : 0.22);
      if (!open) ctx.setLineDash(DASH);
      strokeFlat(ctx, e.pts);
      if (!open) ctx.setLineDash(NO_DASH);
      if (drawK > 0) {
        ctx.globalAlpha = pa;
        ctx.strokeStyle = isSpiral ? pal.accent : pal.ink;
        ctx.lineWidth = 2.4;
        strokeFlat(ctx, e.pts, M.ease.inOutSine(drawK));
        pointOnEdge(e, e.len * M.ease.inOutSine(drawK), tp);
        screenOf(tp.x, tp.y, sp2);
        AP.R.glow(ctx, sp2.x, sp2.y, 18, pal.accent, 0.9);
      }
      // a light pulse travelling along open spiral edges
      if (open && isSpiral && e.len > 0) {
        var ph = (t * 0.25 + i * 0.13) % 1;
        pointOnEdge(e, e.len * ph, tp);
        screenOf(tp.x, tp.y, sp2);
        AP.R.glow(ctx, sp2.x, sp2.y, 8, pal.accent, 0.5 * Math.sin(ph * Math.PI));
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = pa;
  }

  function drawNode(ctx, nd, t, selected) {
    var pal = nd.w.pal;
    screenOf(nd.x, nd.y, sp2);
    nd.sx = sp2.x; nd.sy = sp2.y;
    var x = sp2.x, y = sp2.y;
    if (x < -30 || x > 990 || y < -30 || y > 570) return;
    var open = unlocked(nd);
    var celebrating = false;
    var c = S.celebrate;
    if (c) for (var i = 0; i < c.steps.length; i++) if (c.steps[i].node === nd && !c.steps[i].popped) celebrating = true;
    if (celebrating) open = false;
    var rec = record(nd.id);
    var done = !!(rec && rec.done);
    var z = S.cam.z;
    var scale = clamp(z / 70, 0.55, 1.15);
    var pop = clamp01(1 - (now() - nd.pop) / 0.6);
    var r = (nd.boss ? 10 : 7) * scale * (1 + 0.5 * Math.sin(pop * Math.PI));
    var pa = ctx.globalAlpha;
    var frontier = open && !done;
    if (frontier) AP.R.glow(ctx, x, y, r * 3.2, pal.accent, 0.35 + 0.2 * Math.sin(t * 3));
    if (pop > 0) {
      ctx.globalAlpha = pa * pop;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r * (1.5 + 3 * (1 - pop)), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = pa;
    }
    if (nd.boss) {
      var rot = t * (done ? 0.2 : 0.5);
      ctx.globalAlpha = pa * (open ? 1 : 0.35);
      AP.R.star(ctx, x, y, r * 1.25, r * 0.55, nd.w.sides >= 32 ? 8 : Math.max(5, nd.w.sides + 2), rot);
      ctx.fillStyle = done ? rgba(pal.ink, 0.25) : (open ? rgba(pal.hazard, 0.3) : rgba(pal.primary, 0.08));
      ctx.fill();
      ctx.strokeStyle = done ? pal.ink : (open ? pal.hazard : rgba(pal.primary, 0.7));
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.lineJoin = 'miter';
      if (done) {
        // the vertex this boss gave
        AP.R.glow(ctx, x, y, r * 1.6, pal.accent, 0.7);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x, y, 2.2 * scale, 0, TAU);
        ctx.fill();
      }
    } else {
      ctx.globalAlpha = pa * (open ? 1 : 0.35);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = done ? rgba(pal.primary, 0.85) : (open ? rgba(pal.accent, 0.22) : rgba(pal.bg, 0.9));
      ctx.fill();
      ctx.strokeStyle = done ? pal.ink : (open ? pal.accent : rgba(pal.primary, 0.8));
      ctx.lineWidth = 1.6;
      ctx.stroke();
      if (done && rec) {
        // par beaten: a gold ring
        var par = UI().levelInfo(nd.id).par;
        if (rec.best > 0 && par > 0 && rec.best <= par) {
          ctx.strokeStyle = pal.accent;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, r + 3 * scale, 0, TAU);
          ctx.stroke();
        }
        // three gem pips
        for (var g = 0; g < 3; g++) {
          var gx = x + (g - 1) * 6 * scale, gy = y - (r + 6 * scale) + Math.abs(g - 1) * 2.5 * scale;
          ctx.fillStyle = rec.gems[g] ? pal.accent : rgba(pal.ink, 0.25);
          AP.R.poly(ctx, gx, gy - 2 * scale, 2.2 * scale, 4, 0);
          ctx.fill();
        }
        if (rec.assisted && !(rec.best > 0)) {
          ctx.fillStyle = pal.ink;
          text(ctx, 'A', x + r + 5, y + r, 8, rgba(pal.ink, 0.7), 'left', 1, '800');
        }
      } else if (!open) {
        ctx.fillStyle = rgba(pal.primary, 0.8);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    ctx.globalAlpha = pa;
    if (selected) {
      var den = clamp01(1 - (now() - S.denyT) / 0.3);
      var sx = Math.sin(now() * 60) * 4 * den;
      UI().marker(ctx, x + sx, y, r + 8 * scale, t, nd.boss ? pal.hazard : pal.accent, nd.w.sides >= 32 ? 48 : nd.w.sides, 1);
    }
  }

  function drawIcon(ctx, t) {
    var d = data();
    var form = (d && d.form) || 3;
    iconPos(icp);
    screenOf(icp.x, icp.y, sp2);
    var sty = AP.Cosmetics ? AP.Cosmetics.styleOf(AP.Cosmetics.equipped('palette'), form, t) : null;
    var nd = nodeAt(S.sel);
    var pal = nd ? nd.w.pal : AP.R.pal('map');
    var tr = S.travel;
    var bob = tr ? 0 : Math.sin(t * 3) * 1.5;
    var rot = tr ? (now() - tr.t0) * 9 * tr.dir : t * 0.4;
    var scale = clamp(S.cam.z / 70, 0.65, 1.1);
    var ox = 0, oy = -(nd && nd.boss ? 24 : 19) * scale;
    if (tr) { ox = 0; oy = 0; }
    UI().playerGlyph(ctx, sp2.x + ox, sp2.y + oy + bob, 8.5 * scale, form, UI().flatRot(UI().formSides(form)) + rot, sty, 1, pal, t);
  }

  // node card (right column)
  function drawCard(ctx, t, a) {
    var U = UI();
    var nd = nodeAt(S.sel);
    if (!nd || a <= 0.01) return;
    var w = nd.w, pal = w.pal;
    var info = U.levelInfo(nd.id);
    var rec = record(nd.id);
    var open = unlocked(nd);
    var done = !!(rec && rec.done);
    var x = 640, y = 140, wd = 290, h = 300;
    var pa = ctx.globalAlpha;
    U.panel(ctx, x, y, wd, h, { pal: pal, alpha: a, fillAlpha: 0.78 });
    var k = clamp01((now() - S.selPop) / 0.4);
    text(ctx, info.label + (nd.boss ? '   ·   BOSS' : ''), x + 22, y + 26, 11, nd.boss ? pal.hazard : pal.accent, 'left', a, '800');
    stroke(ctx, String(info.name).toUpperCase(), x + 22, y + 54, 19, pal.ink, 'left', a, pal.accent, Math.max(0.25, k), wd - 44);
    var status = !open ? 'LOCKED' : (done ? (rec.best > 0 ? 'CLEARED' : 'CLEARED WITH ASSIST') : (info.registered ? 'NOT YET CLEARED' : 'UNAVAILABLE'));
    text(ctx, status, x + 22, y + 80, 10.5, !open ? rgba(pal.ink, 0.5) : (done ? pal.primary : pal.accent), 'left', a, '800');
    U.divider(ctx, x + 22, x + wd - 22, y + 96, pal.primary, 0.4 * a);
    if (!open) {
      var prev = nodeAt(nd.idx - 1);
      text(ctx, prev ? 'Clear ' + U.levelLabel(prev.id) + ' · ' + U.levelInfo(prev.id).name + ' to open the way.' : 'Not yet reachable.', x + 22, y + 124, 12.5,
        rgba(pal.ink, 0.75), 'left', a, '500', wd - 44);
      if (nd.boss) drawReward(ctx, nd, x + 22, y + 200, pal, a, t);
      ctx.globalAlpha = pa;
      return;
    }
    var rows = [
      ['BEST', rec && rec.best > 0 ? U.fmtTime(rec.best) : '—'],
      ['PAR', info.par > 0 ? U.fmtTime(info.par).replace(/\.\d+$/, '') : '—'],
      ['DEATHS', rec ? String(rec.deaths) : '0']
    ];
    if (!nd.boss) rows.push(['SHARDS', rec && rec.shardsTotal > 0 ? rec.shards + ' / ' + rec.shardsTotal : '—']);
    for (var i = 0; i < rows.length; i++) {
      var ry = y + 120 + i * 28;
      var ka = a * clamp01((now() - S.selPop - i * 0.05) / 0.25 + 0.3);
      text(ctx, rows[i][0], x + 22, ry, 10.5, rgba(pal.primary, 0.85), 'left', ka, '800');
      var under = i === 0 && rec && rec.best > 0 && info.par > 0 && rec.best <= info.par;
      stroke(ctx, rows[i][1], x + wd - 22, ry, 15, under ? pal.accent : pal.ink, 'right', ka, under ? pal.accent : null);
    }
    if (!nd.boss) {
      var gy = y + 120 + rows.length * 28;
      text(ctx, 'GEMS', x + 22, gy, 10.5, rgba(pal.primary, 0.85), 'left', a, '800');
      for (var g = 0; g < 3; g++) U.gem(ctx, x + wd - 82 + g * 26, gy, 8.5, rec && rec.gems[g] ? 2 : 0, pal, a, rec && rec.gems[g] ? t + g : undefined);
    } else {
      drawReward(ctx, nd, x + 22, y + 220, pal, a, t);
    }
    U.hints(ctx, [['confirm', info.registered ? 'Play' : 'Unavailable']], x + wd / 2, y + h - 22, { align: 'center', pal: pal, alpha: a * 0.9 });
    ctx.globalAlpha = pa;
  }

  function drawReward(ctx, nd, x, y, pal, a, t) {
    var U = UI();
    var W = nd.w.def;
    var reward = W.reward;
    text(ctx, 'REWARD', x, y, 10.5, rgba(pal.primary, 0.85), 'left', a, '800');
    var pa = ctx.globalAlpha;
    if (reward) {
      ctx.globalAlpha = pa * a;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 2;
      U.formPath(ctx, x + 18, y + 30, 13, reward, t * 0.4);
      ctx.fillStyle = rgba(pal.accent, 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = pa;
      stroke(ctx, (U.formWord(reward) + ' — ' + AP.FORM_NAMES[reward]).toUpperCase(), x + 44, y + 30, 14, pal.ink, 'left', a, pal.accent);
    } else {
      stroke(ctx, '∞', x + 18, y + 30, 22, pal.ink, 'center', a, pal.accent);
      text(ctx, 'The ending, and Apeiron', x + 44, y + 30, 12.5, rgba(pal.ink, 0.85), 'left', a, '600');
    }
  }

  function drawHeader(ctx, t, a) {
    var U = UI();
    var nd = nodeAt(S.sel);
    if (!nd) return;
    var w = nd.w, pal = w.pal;
    var open = worldOpen(w);
    text(ctx, 'WORLD ' + w.n, 40, 40, 11, pal.accent, 'left', a, '800');
    stroke(ctx, U.worldCardTitle(w.n), 40, 66, 24, pal.ink, 'left', a, pal.accent, 1, 520);
    text(ctx, open ? '“' + U.worldMotto(w.n) + '”' : 'Locked', 40, 94, 12.5, rgba(pal.ink, 0.75), 'left', a, '500');
    var wc = STATS.ws[w.n - 1];
    if (open && wc) {
      U.bar(ctx, 40, 112, 160, 3, wc.ws.levelsDone / wc.tot, pal, { alpha: a });
      text(ctx, wc.line, 210, 113, 10.5, rgba(pal.primary, 0.9), 'left', a, '700');
    }
  }

  function drawTopRight(ctx, a) {
    var pal = AP.R.pal('map');
    text(ctx, STATS.pctStr, 930, 40, 18, pal.ink, 'right', a, '300');
    text(ctx, 'COMPLETE', 930, 58, 9.5, rgba(pal.primary, 0.85), 'right', a, '800');
    UI().gem(ctx, 852, 44, 7, 2, pal, a);
    text(ctx, STATS.gemStr, 838, 44, 12, pal.ink, 'right', a, '700');
  }

  function drawWorldCard(ctx) {
    var c = S.worldCard;
    if (!c) return;
    var age = now() - c.t0;
    if (age > 3.4) { S.worldCard = null; return; }
    var U = UI();
    var pal = c.w.pal;
    var a = clamp01(age / 0.4) * clamp01((3.4 - age) / 0.6);
    U.dim(ctx, 0.35 * a, pal.bg);
    text(ctx, 'WORLD ' + c.w.n + ' OPENS', 480, 200, 12, pal.accent, 'center', a, '800');
    stroke(ctx, U.worldCardTitle(c.w.n), 480, 238, 40, pal.ink, 'center', a, pal.accent, clamp01(age / 1.4));
    text(ctx, '“' + U.worldMotto(c.w.n) + '”', 480, 282, 16, U.mix(pal.ink, pal.accent, 0.2), 'center', a * clamp01((age - 0.8) / 0.5), '500');
  }

  S.render = function (ctx) {
    var U = UI();
    var g = geometry();
    var t = now();
    var dt = U.frameDt();
    U.sparks.tick();
    cameraUpdate(dt);
    var mapPal = AP.R.pal('map');
    // the shader carries the calm constellation; the map draws its own geometry over a light veil
    U.dim(ctx, 0.3, mapPal.bg);
    var intro = M.ease.outCubic(clamp01((t - S.t0) / 0.8));
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * intro;
    drawSquares(ctx, mapPal, t);
    drawSpiral(ctx, mapPal, t);
    var nd = nodeAt(S.sel);
    var focusW = nd ? nd.w : null;
    for (var i = 0; i < g.worlds.length; i++) drawWorld(ctx, g.worlds[i], t, focusW);
    drawEdges(ctx, t);
    for (var j = 0; j < g.nodes.length; j++) drawNode(ctx, g.nodes[j], t, j === S.sel && !S.celebrate);
    drawIcon(ctx, t);
    ctx.globalAlpha = pa;
    U.vignette(ctx, 0.55);
    // UI chrome
    var chrome = clamp01((t - S.t0 - 0.35) / 0.5) * (S.overview ? 0.25 : 1) * (S.celebrate ? 0.4 : 1);
    var cardA = chrome * clamp01(1 - Math.abs(S.anchorX - ANCHOR_X) / 80);
    drawHeader(ctx, t, chrome);
    drawTopRight(ctx, clamp01((t - S.t0 - 0.35) / 0.5));
    drawCard(ctx, t, cardA);
    drawWorldCard(ctx);
    if (S.overview) stroke(ctx, 'THE GOLDEN SPIRAL', 480, 30, 16, mapPal.ink, 'center', 0.9, mapPal.accent, 1, 0);
    U.hints(ctx, S.celebrate ? [['confirm', 'Skip']] : [[['left', 'right'], 'Level'], [['up', 'down'], 'World'], ['orbit', 'Overview'], ['confirm', 'Play'], ['back', 'Title']],
      480, 516, { align: 'center', pal: mapPal, alpha: clamp01((t - S.t0 - 0.5) / 0.5) * 0.85 });
    U.sparks.render(ctx);
  };

  S.geometry = geometry;
  AP.Scenes.register('map', S);
})(window.AP = window.AP || {});
