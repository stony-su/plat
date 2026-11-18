/* js/worlds/w3/boss.js — owner: W3 */
(function (AP) {
  'use strict';

  // THE MAELSTROM (w3.maelstrom): a vortex eye at the centre of a swirling field. CONTRACT §2.17, 9 hits in 3 phases.
  //
  // The arena (js/levels/w3.js, w3-boss) carries w3.wind zones with tags the boss drives:
  //   'swirl'   the arena-wide vortex. Its AP.Flow params are THE storm: the boss keeps the swirl centre on the eye and
  //             turns its rotation (swirl k) per phase; the drifters it spits and the hazard streamlines it traces
  //             read the very same params object at the same L.time, so the art, the force and the danger agree.
  //   'inhale'  an updraft column under the eye. It only blows while the eye opens: ride the breath up into it.
  //   'lift'    side lifts (steady) up to the high shelves.
  //
  //   closed  the eye is a dense knot of wind: touching it throws you away (never lethal). It spits drifters.
  //   tel     an accent ring closes on the eye for one telegraph (>= 0.9 s, on the downbeat of the 5/4 bar) while the
  //           inhale column brightens and starts to lift.
  //   open    the accent core is exposed: stomp it, or double-jump next to it so the pentagram bursts it.
  //   phase 1 clockwise storm.   phase 2 the swirl reverses and the eye wanders.   phase 3 barbed hazard streamlines
  //   (dashed telegraph, then deadly for 1 s) and the low cloud shelves tear loose into rafts that ride the storm.
  // A damage window opens at most ~9.5 s after the previous one in every phase (see the timing table below).

  var C = AP.C;
  var M = AP.M;
  var TAU = Math.PI * 2;
  var T = AP.TILE;

  var HP = [3, 3, 3];
  var TOTAL = 9;
  // The telegraph starts on beat 2 or 4 of boss3's 5/4 bar (3+2 grouping) and lasts two beats, so the eye opens on an
  // accent (beat 1 or 4). Waiting for that beat takes at most 3 beats (1.5 s at 120 bpm; failsafe BAR_WAIT).
  // Worst gap between two windows: shift 2.6 + closed 3.2 + wait 1.6 + tel 1.0 = 8.4 s;
  // recoil 1.0 + 3.6 + 1.6 + 1.0 = 7.2 s; after a respawn 1.2 + 3.6 + 1.6 + 1.0 = 7.4 s (all < 10 s, CONTRACT §2.17).
  var CFG = [
    { closed: 3.6, tel: 1.0, open: 2.8, spits: [0.22, 0.62], aim: false, leash: 4.5, life: 9, speed: 3.2, k: 1, ext: 1, orbit: 0, ax: 0, ay: 0, lines: 0, inten: 0.62 },
    { closed: 3.2, tel: 1.0, open: 2.6, spits: [0.12, 0.42, 0.72], aim: true, leash: 6, life: 10, speed: 3.6, k: -1, ext: 1.1, orbit: 1, ax: 2.4, ay: 1.1, lines: 0, inten: 0.8 },
    { closed: 2.8, tel: 0.95, open: 2.5, spits: [0.2, 0.6], aim: true, leash: 7, life: 10, speed: 3.8, k: -1, ext: 1.25, orbit: 1.35, ax: 2.8, ay: 1.3, lines: 1, inten: 0.95 }
  ];
  var BAR_WAIT = 1.6;          // longest wait for the accent beat after `closed` (failsafe when a beat edge is missed)
  var SHIFT_T = 2.6;           // phase transition
  var INTRO_T = 1.6;           // first spin-up
  var REFORM_T = 1.2;          // after a respawn
  var RECOIL_T = 1.0;
  var DYING_T = 2.6;
  var TEAR_AT = 1.35;          // phase-3 shift: the clouds tear loose (after >= 1.3 s of shaking)
  var MAX_DRIFTERS = 7;
  var SPIT_V = 6.5;            // tiles/s

  var ST = { DORMANT: 0, INTRO: 1, CLOSED: 2, TEL: 3, OPEN: 4, RECOIL: 5, SHIFT: 6, DYING: 7, DEAD: 8 };

  // hazard streamlines (phase 3)
  var LINE_N = 3;
  var LINE_PTS = 24;
  var LINE_STEP = 14;          // u between traced points
  var LINE_TEL = 1.1, LINE_LIVE = 1.0, LINE_FADE = 0.35;
  var LINE_EVERY = 3.4;
  var LINE_HIT = 12;           // u: player centre to the line (a forgiving 9u body + 3u line)

  var P0 = { x: 0, y: 0 };
  var DASH_TEL = [7, 6];
  var NODASH = [];

  function pal(L) { return (L && L.pal) || AP.Worlds.pal('w3'); }
  function rgba(c, a) { return AP.Color.rgba(c, a < 0 ? 0 : (a > 1 ? 1 : a)); }
  // colour mix quantised to 1/32 and cached (no string churn in render loops)
  var MIXC = {};
  function mix(a, b, t) {
    var q = Math.round(M.clamp(t, 0, 1) * 32);
    var ta = MIXC[a] || (MIXC[a] = {});
    var tab = ta[b] || (ta[b] = []);
    return tab[q] || (tab[q] = AP.Color.mix(a, b, q / 32));
  }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }
  function sm(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; return Math.pow(1 - ph, 3); }
  function hpLeft(s) { var n = Math.max(0, s.hp); for (var i = s.phase + 1; i < HP.length; i++) n += HP[i]; return n; }

  // ------------------------------------------------------------------ FX presets ('w3.*')
  var FXO = {};
  function fx() {
    FXO.n = 8; FXO.color = undefined; FXO.color2 = undefined; FXO.speed = undefined; FXO.angle = undefined; FXO.life = undefined;
    FXO.size = undefined; FXO.sizeEnd = 0; FXO.gravity = 0; FXO.drag = 0; FXO.shape = 'dot'; FXO.spin = undefined;
    FXO.additive = true; FXO.back = false; FXO.spread = 0; FXO.rot = undefined; FXO.width = 2; FXO.align = false;
    return FXO;
  }
  function fxPal() { return (AP.level && AP.level.pal) || AP.Worlds.pal('w3'); }
  var RA = [0, 0], RB = [0, 0], RC = [0, 0], RD = [0, 0];
  function rg(arr, a, b) { arr[0] = a; arr[1] = b; return arr; }

  // the eye inhales: motes spiral in from a ring (o.radius, o.dir = rotation sign)
  AP.FX.preset('w3.inhale', function (x, y, o) {
    var p = fxPal();
    var r = (o && o.radius) || 96, n = (o && o.n) || 3, sg = (o && o.dir) < 0 ? -1 : 1;
    var e = fx(), c = 0;
    e.n = 1; e.color = p.accent; e.color2 = p.ink; e.life = 0.5; e.size = rg(RA, 1.4, 2.6); e.sizeEnd = 0.3;
    var a0 = AP.Beat ? AP.Beat.beat * 2.3 : 0;
    for (var i = 0; i < n; i++) {
      var a = a0 + i * TAU / n;
      e.angle = a + Math.PI - sg * 0.55;
      e.speed = r / 0.5 * 1.05;
      c += AP.FX.emit(x + Math.cos(a) * r, y + Math.sin(a) * r, e);
    }
    return c;
  });

  // the eye opens: an accent flare of pentagons and streaks
  AP.FX.preset('w3.eye', function (x, y) {
    var p = fxPal(), n = 0;
    var e = fx();
    e.n = 10; e.color = p.accent; e.color2 = p.ink; e.shape = 'line'; e.align = true; e.width = 2;
    e.speed = rg(RA, 160, 340); e.life = rg(RB, 0.25, 0.45); e.size = rg(RC, 6, 12); e.sizeEnd = 1; e.drag = 2.5;
    n += AP.FX.emit(x, y, e);
    e = fx();
    e.n = 6; e.color = p.accent; e.color2 = p.primary; e.shape = 'pent'; e.speed = rg(RA, 40, 120); e.life = rg(RB, 0.4, 0.7);
    e.size = rg(RC, 3, 5); e.sizeEnd = 0; e.drag = 2; e.spin = rg(RD, -5, 5);
    n += AP.FX.emit(x, y, e);
    AP.FX.ring(x, y, 10, 70, 0.4, p.accent, 2.5);
    return n;
  });

  // a hazard streamline turns deadly: hazard sparks along its first segment direction (o.dir)
  AP.FX.preset('w3.barb', function (x, y, o) {
    var p = fxPal();
    var d = (o && typeof o.dir === 'number') ? o.dir : 0;
    var e = fx();
    e.n = (o && o.n) || 5; e.color = p.hazard; e.color2 = p.ink; e.shape = 'tri'; e.angle = rg(RA, d - 1.6, d + 1.6);
    e.speed = rg(RB, 40, 150); e.life = rg(RC, 0.2, 0.4); e.size = rg(RD, 2, 3.5); e.drag = 3; e.spread = 4;
    return AP.FX.emit(x, y, e);
  });

  // the storm collapses: streamers fly out along a spiral, rings, ink motes
  AP.FX.preset('w3.collapse', function (x, y, o) {
    var p = fxPal(), n = 0, sg = (o && o.dir) < 0 ? -1 : 1;
    var e = fx();
    e.n = 1; e.color = p.ink; e.color2 = p.primary; e.shape = 'line'; e.align = true; e.width = 2; e.life = rg(RB, 0.6, 1.0);
    e.size = rg(RC, 10, 22); e.sizeEnd = 2; e.drag = 1.2;
    for (var i = 0; i < 20; i++) {
      var a = i * TAU / 20;
      e.angle = a + sg * 0.7;
      e.speed = rg(RA, 220, 420);
      n += AP.FX.emit(x + Math.cos(a) * 20, y + Math.sin(a) * 20, e);
    }
    e = fx();
    e.n = 24; e.color = p.accent; e.color2 = p.ink; e.speed = rg(RA, 40, 200); e.life = rg(RB, 0.8, 1.6); e.size = rg(RC, 1.5, 3);
    e.drag = 1.5; e.spread = 30;
    n += AP.FX.emit(x, y, e);
    AP.FX.ring(x, y, 8, 160, 0.9, p.ink, 3);
    AP.FX.ring(x, y, 20, 240, 1.3, p.accent, 2);
    return n;
  });

  // ------------------------------------------------------------------ winds and the storm's flow params
  // init binds the zones created so far (calm arena on the first frame); the first update binds them all again
  function bindWinds(e, s, L) {
    var ws = L.find('w3.wind');
    s.swirl = null;
    s.inhale.length = 0;
    s.lifts.length = 0;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (w.tag === 'swirl' && !s.swirl) s.swirl = w;
      else if (w.tag === 'inhale') s.inhale.push(w);
      else if (w.tag === 'lift') s.lifts.push(w);
    }
    if (s.swirl && s.swirl.s && s.swirl.s.p) {
      var p = s.swirl.s.p;
      if (!p.swirl || p.swirl.length < 4) p.swirl = [s.hx, s.hy, 12 * 32, 1];
      s.p = p;
    }
    applyWinds(e, s);
  }

  function eyeCX(e) { return e.x + e.w / 2; }
  function eyeCY(e) { return e.y + e.h / 2; }

  // keeps the storm on the eye with the current rotation, and drives the zones' external multipliers
  function applyWinds(e, s) {
    var p = s.p;
    p.swirl[0] = eyeCX(e);
    p.swirl[1] = eyeCY(e);
    p.swirl[3] = s.k;
    if (s.swirl) s.swirl.s.ext = s.swirlExt;
    for (var i = 0; i < s.inhale.length; i++) s.inhale[i].s.ext = s.inhaleExt;
    for (var j = 0; j < s.lifts.length; j++) s.lifts[j].s.ext = s.liftExt;
  }

  // ------------------------------------------------------------------ clouds (one-way shelves below the eye)
  function scanClouds(e, s, L) {
    s.clouds = [];
    var minRow = Math.floor((s.hy + 64) / 32);
    for (var ty = minRow; ty < L.h; ty++) {
      var tx = 0;
      while (tx < L.w) {
        if (L.tiles[ty * L.w + tx] !== T.ONEWAY) { tx++; continue; }
        var x0 = tx;
        while (tx < L.w && L.tiles[ty * L.w + tx] === T.ONEWAY) tx++;
        s.clouds.push({ tx0: x0, tx1: tx - 1, ty: ty });
      }
    }
    // the phase snapshots: phases 1 and 2 keep the map as it is, phase 3 has the low clouds torn away
    var s0 = L.snapshotTiles();
    var s2 = new Uint8Array(s0);
    for (var c = 0; c < s.clouds.length; c++) {
      var cl = s.clouds[c];
      for (var x = cl.tx0; x <= cl.tx1; x++) s2[cl.ty * L.w + x] = T.EMPTY;
    }
    s.snaps = [s0, s0, s2];
  }

  function tearClouds(e, s, L) {
    if (s.torn) return;
    s.torn = true;
    for (var c = 0; c < s.clouds.length; c++) {
      var cl = s.clouds[c];
      for (var x = cl.tx0; x <= cl.tx1; x++) {
        if (L.tileAt(x, cl.ty) === T.ONEWAY) {
          L.setTile(x, cl.ty, T.EMPTY);
          AP.FX.burst('crumble', x * 32 + 16, cl.ty * 32 + 4, { n: 4, color: L.pal.primary });
        }
      }
      AP.sfxAt('crumble', (cl.tx0 + cl.tx1 + 1) * 16, cl.ty * 32, { vol: 0.6, pitch: 0.8 });
    }
    spawnRafts(e, s, L);
  }

  function spawnRafts(e, s, L) {
    clearRafts(s, L);
    for (var c = 0; c < s.clouds.length; c++) {
      var cl = s.clouds[c];
      var n = cl.tx1 - cl.tx0 + 1;
      var r = L.spawn('w3.drift', (cl.tx0 + n / 2) * 32, cl.ty * 32 + 6, { w: n, leash: 2, speed: 4, springPeriod: 2.8 });
      if (!r) continue;
      r.minion = true;
      r.s.p = s.p;                 // the raft rides the storm itself
      s.rafts.push(r);
      AP.FX.ring(r.x + r.w / 2, r.y + 6, 6, 40, 0.4, L.pal.primary, 1.5);
    }
  }

  function clearRafts(s, L) {
    for (var i = 0; i < s.rafts.length; i++) if (!s.rafts[i].dead) L.remove(s.rafts[i]);
    s.rafts.length = 0;
  }

  // ------------------------------------------------------------------ hazard streamlines (phase 3)
  function clearLines(s) { for (var i = 0; i < LINE_N; i++) { s.lines[i].st = 0; s.lines[i].n = 0; } }

  function segDist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var l2 = dx * dx + dy * dy;
    var t = l2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = ax + dx * t - px, qy = ay + dy * t - py;
    return qx * qx + qy * qy;
  }
  function lineDist2(ln, px, py) {
    var best = Infinity, pts = ln.pts;
    for (var i = 0; i + 1 < ln.n; i++) {
      var d = segDist2(px, py, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]);
      if (d < best) best = d;
    }
    return best;
  }

  // traces a line downstream of a seed with the storm params at L.time; the polyline stops at walls and floors
  function traceLine(ln, sx, sy, s, L) {
    AP.Flow.streamline(sx, sy, L.time, s.p, LINE_STEP, LINE_PTS, ln.pts);
    var n = 0;
    for (var i = 0; i < LINE_PTS; i++) {
      var x = ln.pts[i * 2], y = ln.pts[i * 2 + 1];
      var c = L.tileAt(Math.floor(x / 32), Math.floor(y / 32));
      if (c === T.SOLID || c === T.BREAK || x < 40 || y < 40 || x > L.pw - 40 || y > L.ph - 40) break;
      n++;
    }
    ln.n = n;
    return n;
  }

  function spawnLines(e, s, L) {
    var P = L.player;
    var ex = eyeCX(e), ey = eyeCY(e);
    var count = s.hp <= 1 ? 3 : 2;
    var pcx = P ? P.x + P.w / 2 : ex, pcy = P ? P.y + P.h / 2 : ey + 160;
    var pr = Math.sqrt((pcx - ex) * (pcx - ex) + (pcy - ey) * (pcy - ey));
    var made = 0;
    for (var k = 0; k < LINE_N && made < count; k++) {
      var ln = s.lines[k];
      if (ln.st !== 0) continue;
      var ok = false;
      for (var tries = 0; tries < 8 && !ok; tries++) {
        // rings near the player's own distance from the eye, but never drawn through the player
        var r = M.clamp((made === 0 ? pr : 2.4 * 32 + s.rng.next() * 3.6 * 32) + (s.rng.next() - 0.5) * 70, 2.4 * 32, 6.2 * 32);
        var a = s.rng.next() * TAU;
        var sx = ex + Math.cos(a) * r, sy = ey + Math.sin(a) * r;
        if (traceLine(ln, sx, sy, s, L) < 6) continue;
        if (alive(P) && lineDist2(ln, pcx, pcy) < 56 * 56) continue;
        ok = true;
      }
      if (!ok) { ln.n = 0; continue; }
      ln.st = 1;
      ln.t = 0;
      ln.seed = s.rng.next() * 10;
      made++;
    }
    if (made) AP.sfxAt('charge', ex, ey, { vol: 0.4, pitch: 1.5 });
  }

  function updateLines(e, s, L, dt) {
    var P = L.player;
    var live = alive(P) && L.phase === 'play';
    var pcx = P ? P.x + P.w / 2 : 0, pcy = P ? P.y + P.h / 2 : 0;
    for (var k = 0; k < LINE_N; k++) {
      var ln = s.lines[k];
      if (ln.st === 0) continue;
      ln.t += dt;
      if (ln.st === 1 && ln.t >= LINE_TEL) {
        ln.st = 2; ln.t = 0;
        var mx = ln.pts[(ln.n >> 1) * 2], my = ln.pts[(ln.n >> 1) * 2 + 1];
        AP.sfxAt('laser', mx, my, { vol: 0.42, pitch: 1.35 });
        for (var q = 0; q + 1 < ln.n; q += 4) {
          AP.FX.burst('w3.barb', ln.pts[q * 2], ln.pts[q * 2 + 1], { n: 2, dir: Math.atan2(ln.pts[q * 2 + 3] - ln.pts[q * 2 + 1], ln.pts[q * 2 + 2] - ln.pts[q * 2]) });
        }
      } else if (ln.st === 2) {
        if (live && lineDist2(ln, pcx, pcy) < LINE_HIT * LINE_HIT) L.killPlayer('w3.maelstrom');
        if (ln.t >= LINE_LIVE) { ln.st = 3; ln.t = 0; }
      } else if (ln.st === 3 && ln.t >= LINE_FADE) {
        ln.st = 0; ln.n = 0;
      }
    }
  }

  // ------------------------------------------------------------------ drifters
  function spit(e, s, L, aim) {
    var cfg = CFG[s.phase];
    if (L.count('w3.drifter') >= MAX_DRIFTERS) return;
    var ex = eyeCX(e), ey = eyeCY(e);
    var P = L.player;
    var a;
    if (aim && alive(P)) a = Math.atan2(P.y + P.h / 2 - ey, P.x + P.w / 2 - ex) + (s.rng.next() - 0.5) * 0.5;
    else a = s.rng.next() * TAU;
    var d = L.spawn('w3.drifter', ex + Math.cos(a) * 26, ey + Math.sin(a) * 26, {
      speed: cfg.speed, leash: cfg.leash, life: cfg.life, delay: 0.05,
      vx: Math.cos(a) * SPIT_V, vy: Math.sin(a) * SPIT_V
    });
    if (!d) return;
    d.minion = true;
    d.s.p = s.p;                   // drifters ride the storm's own streamlines
    s.spitFlash = 1;
    s.spitA = a;
    AP.sfxAt('pulse', ex, ey, { vol: 0.55, pitch: 0.75 + 0.1 * s.phase });
  }

  // ------------------------------------------------------------------ fight flow
  function beginFight(e, s, L) {
    if (s.state !== ST.DORMANT) return;
    L.bossStart(e);
    s.state = ST.INTRO;
    s.t = 0;
    s.started = true;
    AP.sfxAt('rumble', eyeCX(e), eyeCY(e), { vol: 0.7 });
    AP.sfxAt('gust', eyeCX(e), eyeCY(e), { vol: 0.8, pitch: 0.7 });
    AP.FX.ring(eyeCX(e), eyeCY(e), 120, 10, 0.8, L.pal.ink, 2);
  }

  function toClosed(e, s) { s.state = ST.CLOSED; s.t = 0; s.spitI = 0; }

  function startTel(e, s, L) {
    s.state = ST.TEL;
    s.t = 0;
    AP.sfxAt('charge', eyeCX(e), eyeCY(e), { vol: 0.7 });
  }

  function openNow(e, s, L, quiet) {
    s.state = ST.OPEN;
    s.t = 0;
    if (!quiet) {
      AP.FX.burst('w3.eye', eyeCX(e), eyeCY(e));
      AP.sfxAt('chime', eyeCX(e), eyeCY(e), { vol: 0.75 });
      L.shake(2.5, 0.2);
    }
  }

  function startShift(e, s, L) {
    s.state = ST.SHIFT;
    s.t = 0;
    s.torn = false;
    clearLines(s);
    L.clearMinions();
    s.rafts.length = 0;
    AP.sfxAt('rumble', eyeCX(e), eyeCY(e), { vol: 0.9 });
    AP.sfxAt('whoosh', eyeCX(e), eyeCY(e), { vol: 0.8, pitch: 0.6 });
    AP.FX.burst('w3.collapse', eyeCX(e), eyeCY(e), { dir: s.k });
    L.intensity = CFG[s.phase].inten;
  }

  // completes a phase transition at once (debugDamage, respawn during a shift)
  function finishShift(e, s, L) {
    if (s.state !== ST.SHIFT) return;
    if (s.phase === 2) tearClouds(e, s, L);
    s.k = CFG[s.phase].k;
    s.swirlExt = CFG[s.phase].ext;
    toClosed(e, s);
  }

  function hit(e, s, L) {
    if (s.state === ST.DYING || s.state === ST.DEAD || L.bossDone) return;
    s.hp--;
    s.hurt = 1;
    var ex = eyeCX(e), ey = eyeCY(e);
    AP.FX.ring(ex, ey, 14, 110, 0.5, L.pal.accent, 3);
    if (s.hp <= 0 && s.phase < HP.length - 1) {
      s.phase++;
      s.hp = HP[s.phase];
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
      startShift(e, s, L);
    } else if (s.hp <= 0) {
      L.bossBar(0, s.phase);
      defeat(e, s, L);
    } else {
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
      s.state = ST.RECOIL;
      s.t = 0;
      AP.sfxAt('whoosh', ex, ey, { vol: 0.6, pitch: 1.2 });
    }
  }

  function defeat(e, s, L) {
    s.state = ST.DYING;
    s.t = 0;
    clearLines(s);
    s.rafts.length = 0;
    L.bossDefeated(e);
    AP.FX.burst('w3.collapse', eyeCX(e), eyeCY(e), { dir: s.k });
    AP.sfxAt('whoosh', eyeCX(e), eyeCY(e), { vol: 1, pitch: 0.5 });
    L.intensity = 0.3;
  }

  // the closed eye is a knot of wind: it throws the player away (never lethal)
  function repulse(e, s, P, L) {
    if (s.repT > 0) return;
    s.repT = 0.45;
    var ex = eyeCX(e), ey = eyeCY(e);
    var dx = P.x + P.w / 2 - ex, dy = P.y + P.h / 2 - ey;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-3) { dx = 0; dy = 1; d = 1; }
    dx /= d; dy /= d;
    P.launch(dx * 470, dy * 420 - 140, { refresh: false, noCut: true });
    s.repA = Math.atan2(dy, dx);
    s.repFlash = 1;
    AP.FX.burst('w3.gust', ex + dx * 24, ey + dy * 24, { dir: s.repA, n: 8, spread: 10 });
    AP.sfxAt('gust', ex, ey, { vol: 0.75, pitch: 1.1 });
    L.shake(3, 0.15);
    L.kick(dx * 4, dy * 4);
  }

  // ------------------------------------------------------------------ eye motion
  function moveEye(e, s, L, dt) {
    var cfg = CFG[s.phase];
    var st = s.state;
    var rate = st === ST.OPEN ? 0.3 : (st === ST.CLOSED || st === ST.RECOIL ? 1 : 0);
    s.mt += dt * rate * cfg.orbit;
    var w = TAU / 9;
    var tx = 0, ty = 0;
    if (st !== ST.TEL && st !== ST.SHIFT && st !== ST.INTRO && st !== ST.DORMANT && cfg.orbit > 0) {
      tx = Math.sin(s.mt * w) * cfg.ax * 32;
      ty = Math.sin(s.mt * w * 2 + 0.9) * cfg.ay * 32;
    }
    s.ox = M.damp(s.ox, tx, 2.2, dt);
    s.oy = M.damp(s.oy, ty, 2.2, dt);
    var bob = Math.sin(L.time * 1.35) * 5;
    var recoil = s.state === ST.RECOIL ? Math.sin(Math.min(1, s.t / RECOIL_T) * Math.PI) * -14 : 0;
    e.x = s.hx + s.ox - e.w / 2;
    e.y = s.hy + s.oy + bob + recoil - e.h / 2;
  }

  // ------------------------------------------------------------------ the entity
  AP.Entities.register('w3.maelstrom', {
    kind: 'sensor', w: 44, h: 44, anchor: 'center', layer: 6, lint: 'ignore',
    boss: true, bossName: 'Maelstrom', phases: 3,
    stompable: true, burstable: true,
    renderPad: 400, alwaysRender: true,

    init: function (e, spec, L) {
      var s = e.s;
      s.hx = e.x + e.w / 2;
      s.hy = e.y + e.h / 2;
      s.phase = 0;
      s.hp = HP[0];
      s.state = ST.DORMANT;
      s.t = 0;
      s.started = false;
      s.k = CFG[0].k;
      s.swirlExt = 0.12;
      s.inhaleExt = 0;
      s.liftExt = 1;
      s.mt = 0; s.ox = 0; s.oy = 0;
      s.spin = 0;
      s.open = 0;
      s.form = 0.25;
      s.tel = 0;
      s.hurt = 0;
      s.repT = 0; s.repA = 0; s.repFlash = 0;
      s.spitI = 0; s.spitFlash = 0; s.spitA = 0;
      s.waitBar = false;
      s.lineT = 1.5;
      s.inhaleFx = 0;
      s.rng = AP.RNG(((L && L.seed) || 1) ^ 0x5A17);
      s.lines = [];
      for (var i = 0; i < LINE_N; i++) s.lines.push({ st: 0, t: 0, n: 0, seed: 0, pts: new Float32Array(LINE_PTS * 2) });
      s.rafts = [];
      s.inhale = [];
      s.lifts = [];
      s.swirl = null;
      s.bound = false;
      // a private storm until the arena's 'swirl' zone is bound (drifters and lines always have params to read)
      s.p = AP.Flow.fromSpec({ seed: 3, scale: 8, tscale: 0.1, spread: 180, mmin: 0, swirl: [s.hx / 32, s.hy / 32, 12, CFG[0].k] });
      s.torn = false;
      s.reform = false;
      if (L) {
        scanClouds(e, s, L);
        bindWinds(e, s, L);
      }
    },

    update: function (e, dt, L) {
      var s = e.s;
      var P = L.player;
      if (!s.bound) { s.bound = true; bindWinds(e, s, L); }
      s.t += dt;
      if (s.repT > 0) s.repT -= dt;
      if (s.repFlash > 0) s.repFlash = Math.max(0, s.repFlash - dt * 3);
      if (s.spitFlash > 0) s.spitFlash = Math.max(0, s.spitFlash - dt * 3);
      if (s.hurt > 0) s.hurt = Math.max(0, s.hurt - dt * 2.5);
      var cfg = CFG[s.phase];
      var st = s.state;

      if (st === ST.DORMANT) {
        if (L.bossInfo || (L.playerMoved && L.time - L.firstMoveTime >= 0.35)) beginFight(e, s, L);
      } else if (st === ST.INTRO) {
        var dur = s.started && s.reform ? REFORM_T : INTRO_T;
        if (s.t >= dur) { s.reform = false; toClosed(e, s); }
      } else if (st === ST.CLOSED) {
        // spits at fixed fractions of the closed time
        if (s.spitI < cfg.spits.length && s.t >= cfg.spits[s.spitI] * cfg.closed) {
          spit(e, s, L, cfg.aim && (s.spitI % 2 === 1));
          s.spitI++;
        }
        // two beats of telegraph from beat 2 or 4, so the eye opens on an accent of the 3+2 bar
        if (s.t >= cfg.closed) {
          var B = AP.Beat;
          var onCue = !!(B && B.ticked && (B.inBar === 1 || B.inBar === 3));
          if (onCue || s.t >= cfg.closed + BAR_WAIT) startTel(e, s, L);
        }
      } else if (st === ST.TEL) {
        s.inhaleFx -= dt;
        if (s.inhaleFx <= 0) { s.inhaleFx = 0.08; AP.FX.burst('w3.inhale', eyeCX(e), eyeCY(e), { radius: 100, n: 2, dir: s.k }); }
        if (s.t >= cfg.tel) openNow(e, s, L, false);
      } else if (st === ST.OPEN) {
        if (s.t >= cfg.open) {
          toClosed(e, s);
          AP.sfxAt('whoosh', eyeCX(e), eyeCY(e), { vol: 0.45, pitch: 0.9 });
        }
      } else if (st === ST.RECOIL) {
        if (s.t >= RECOIL_T) toClosed(e, s);
      } else if (st === ST.SHIFT) {
        if (s.phase === 2 && !s.torn && s.t >= TEAR_AT) tearClouds(e, s, L);
        if (s.t >= SHIFT_T) finishShift(e, s, L);
      } else if (st === ST.DYING) {
        if (s.t >= DYING_T) { s.state = ST.DEAD; s.t = 0; }
      }

      // ---- storm parameters (eased), eye shape
      st = s.state;
      var fighting = st !== ST.DORMANT && st !== ST.DYING && st !== ST.DEAD;
      var kT = (st === ST.SHIFT) ? (s.t < SHIFT_T * 0.35 ? s.k : cfg.k) : cfg.k;
      s.k = M.approach(s.k, kT, dt * (st === ST.SHIFT ? 1.6 : 4));
      var extT = st === ST.DORMANT ? 0.12 : (st === ST.DYING || st === ST.DEAD ? 0 : (st === ST.SHIFT && s.t < SHIFT_T * 0.6 ? 0.35 : cfg.ext));
      s.swirlExt = M.approach(s.swirlExt, extT, dt * (st === ST.DYING ? 0.5 : 0.9));
      var inT = (st === ST.TEL) ? sm(s.t / cfg.tel) : (st === ST.OPEN ? 1 : 0);
      s.inhaleExt = M.approach(s.inhaleExt, inT, dt * (inT > s.inhaleExt ? 3 : 2));
      s.liftExt = 1;
      var openT = st === ST.OPEN ? 1 : (st === ST.TEL ? 0.25 * sm(s.t / cfg.tel) : 0);
      s.open = M.approach(s.open, openT, dt * (openT > s.open ? 5 : 3));
      s.tel = st === ST.TEL ? M.clamp(s.t / cfg.tel, 0, 1) : 0;
      var formT = st === ST.DORMANT ? 0.25 : (st === ST.DYING ? Math.max(0, 1 - s.t / (DYING_T * 0.8)) : (st === ST.DEAD ? 0 : 1));
      s.form = M.approach(s.form, formT, dt * (st === ST.INTRO ? 0.8 : 1.6));
      var spinRate = (fighting ? 1.6 + 1.4 * Math.abs(s.k) : 0.5) * (s.k >= 0 ? 1 : -1) * (st === ST.OPEN ? 0.45 : 1);
      s.spin += spinRate * dt;
      if (s.spin > 1000 || s.spin < -1000) s.spin = M.mod(s.spin, TAU);

      moveEye(e, s, L, dt);
      if (s.p && s.p.swirl) applyWinds(e, s);
      if (fighting) L.intensity = Math.max(L.intensity * 0.98, cfg.inten);

      // ---- phase 3: barbed hazard streamlines
      if (cfg.lines && (st === ST.CLOSED || st === ST.TEL || st === ST.OPEN || st === ST.RECOIL)) {
        s.lineT -= dt;
        if (s.lineT <= 0) { s.lineT = LINE_EVERY; spawnLines(e, s, L); }
      }
      updateLines(e, s, L, dt);
      // rafts lost to the storm (squished) are not replaced until the next respawn
      for (var r = s.rafts.length - 1; r >= 0; r--) if (s.rafts[r].dead) s.rafts.splice(r, 1);
      e.vx = 0; e.vy = 0;
      if (P && !alive(P) && s.repT > 0) s.repT = 0;
    },

    onStomp: function (e, P, L) {
      var s = e.s;
      if (s.state !== ST.OPEN) return false;
      hit(e, s, L);
      return true;
    },

    onBurst: function (e, P, L) {
      var s = e.s;
      if (s.state !== ST.OPEN) {
        if (s.state === ST.CLOSED) { s.repFlash = 0.6; AP.FX.ring(eyeCX(e), eyeCY(e), 20, 60, 0.25, L.pal.ink, 1.5); }
        return;
      }
      hit(e, s, L);
    },

    onTouch: function (e, P, L) {
      var s = e.s;
      if (s.state === ST.CLOSED || s.state === ST.RECOIL || s.state === ST.SHIFT || s.state === ST.INTRO) {
        if (s.started) repulse(e, s, P, L);
      }
    },

    onPlayerDeath: function (e, L) {
      var s = e.s;
      L.clearMinions();
      s.rafts.length = 0;
      clearLines(s);
    },

    onRespawn: function (e, L) {
      var s = e.s;
      if (s.state === ST.DYING || s.state === ST.DEAD || L.bossDone) return;
      clearLines(s);
      if (s.state === ST.DORMANT) return;
      // back to the start of the current phase, with that phase's HP and arena
      s.hp = HP[s.phase];
      s.torn = s.phase === 2;
      L.restoreTiles(s.snaps[s.phase]);
      s.k = CFG[s.phase].k;
      s.swirlExt = Math.max(s.swirlExt, 0.5);
      s.inhaleExt = 0;
      s.open = 0;
      s.ox = 0; s.oy = 0; s.mt = 0;
      s.lineT = 2.2;
      s.repT = 0.6;
      if (s.phase === 2) spawnRafts(e, s, L); else s.rafts.length = 0;
      s.state = ST.INTRO;
      s.reform = true;
      s.t = 0;
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
    },

    // exactly one hit in any state after bossStart (vulnerability forced), phases advance as in play
    debugDamage: function (e, L) {
      var s = e.s;
      if (s.state === ST.DYING || s.state === ST.DEAD || L.bossDone) return;
      if (s.state === ST.DORMANT) beginFight(e, s, L);
      if (s.state === ST.SHIFT) finishShift(e, s, L);
      if (s.state !== ST.OPEN) openNow(e, s, L, true);
      hit(e, s, L);
    },

    render: function (e, ctx, L) {
      var s = e.s;
      var p = pal(L);
      drawClouds(e, s, ctx, L, p);
      drawLines(s, ctx, L, p);
      if (s.state === ST.DEAD) return;
      drawEye(e, s, ctx, L, p);
    }
  });

  // ------------------------------------------------------------------ art
  // phase-3 shift: the low clouds shake and fray before they tear loose
  function drawClouds(e, s, ctx, L, p) {
    if (s.state !== ST.SHIFT || s.phase !== 2 || s.torn) return;
    var k = M.clamp(s.t / TEAR_AT, 0, 1);
    var t = L.time;
    ctx.lineWidth = 1.5;
    for (var c = 0; c < s.clouds.length; c++) {
      var cl = s.clouds[c];
      var x0 = cl.tx0 * 32, x1 = (cl.tx1 + 1) * 32, y = cl.ty * 32;
      var jx = Math.sin(t * 61 + c) * 2.5 * k, jy = Math.cos(t * 47 + c) * 1.5 * k;
      ctx.strokeStyle = rgba(p.ink, 0.25 + 0.55 * k * (0.5 + 0.5 * Math.sin(t * 30)));
      ctx.strokeRect(x0 + jx + 1, y + jy - 1, x1 - x0 - 2, 10);
      ctx.strokeStyle = rgba(p.accent, 0.4 * k);
      ctx.beginPath();
      for (var x = x0 + 8; x < x1 - 4; x += 12) {
        ctx.moveTo(x + jx, y + jy - 2);
        ctx.lineTo(x + 4 + jx, y + jy + 4);
        ctx.lineTo(x + 1 + jx, y + jy + 9);
      }
      ctx.stroke();
    }
  }

  function drawLines(s, ctx, L, p) {
    var t = L.time;
    var nGlow = 0;
    for (var k = 0; k < LINE_N; k++) {
      var ln = s.lines[k];
      if (ln.st === 0 || ln.n < 2) continue;
      var pts = ln.pts, n = ln.n;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (ln.st === 1) {
        // telegraph: a flickering dashed hazard trace that grows along the current
        var gk = sm(ln.t / (LINE_TEL * 0.45));
        var m = Math.max(2, Math.round(n * gk));
        var fl = 0.3 + 0.35 * sm(ln.t / LINE_TEL) + 0.2 * Math.sin(t * 24 + ln.seed);
        ctx.strokeStyle = rgba(p.hazard, fl);
        ctx.lineWidth = 1.6;
        ctx.setLineDash(DASH_TEL);
        ctx.lineDashOffset = -t * 60;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (var i = 1; i < m; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
        ctx.stroke();
        ctx.setLineDash(NODASH);
        ctx.lineDashOffset = 0;
        // ticks crawl along it: the barbs about to grow
        ctx.fillStyle = rgba(p.hazard, fl * 0.9);
        ctx.beginPath();
        for (var j = 2; j < m; j += 4) {
          var bx = pts[j * 2], by = pts[j * 2 + 1];
          ctx.moveTo(bx + 2, by);
          ctx.arc(bx, by, 2, 0, TAU);
        }
        ctx.fill();
        continue;
      }
      var a = ln.st === 2 ? 1 : 1 - M.clamp(ln.t / LINE_FADE, 0, 1);
      if (a <= 0.01) continue;
      var pulse = ln.st === 2 ? 0.75 + 0.25 * Math.sin(t * 40 + ln.seed) : 1;
      // barbs: spiky silhouette on both sides, so the line reads as deadly without colour
      ctx.fillStyle = rgba(p.hazard, 0.75 * a);
      ctx.beginPath();
      for (var b = 1; b + 1 < n; b++) {
        var ax = pts[b * 2], ay = pts[b * 2 + 1];
        var dx = pts[b * 2 + 2] - pts[b * 2 - 2], dy = pts[b * 2 + 3] - pts[b * 2 - 1];
        var dl = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dl; dy /= dl;
        var sd = (b & 1) ? 1 : -1;
        var nx = -dy * sd, ny = dx * sd;
        ctx.moveTo(ax - dx * 4, ay - dy * 4);
        ctx.lineTo(ax + nx * 8, ay + ny * 8);
        ctx.lineTo(ax + dx * 4, ay + dy * 4);
        ctx.closePath();
      }
      ctx.fill();
      ctx.strokeStyle = rgba(p.hazard, a * pulse);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (var q = 1; q < n; q++) ctx.lineTo(pts[q * 2], pts[q * 2 + 1]);
      ctx.stroke();
      ctx.strokeStyle = rgba(p.ink, 0.5 * a * pulse);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (ln.st === 2) {
        for (var g = 0; g < n && nGlow < 15; g += 6) { AP.R.glow(ctx, pts[g * 2], pts[g * 2 + 1], 18, p.hazard, 0.35 * a); nGlow++; }
      }
    }
  }

  var ARM_N = 5, ARM_PTS = 9;
  function drawEye(e, s, ctx, L, p) {
    var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
    var f = s.form;
    if (f <= 0.01) return;
    var b = beatPulse();
    var open = s.open;
    var dir = s.k >= 0 ? 1 : -1;
    var t = L.time;
    var dying = s.state === ST.DYING;
    // halo
    AP.R.glow(ctx, cx, cy, 46 * f, open > 0.3 ? p.accent : p.primary, (0.25 + 0.35 * open + 0.15 * b) * f);
    // spiral arms (logarithmic): tight while closed, unwinding as the eye opens; they turn with the storm
    var wind = (2.2 - 1.3 * open) * dir;
    var reach = (82 + 10 * b) * f * (dying ? 1 + 1.2 * (1 - f) : 1);
    ctx.lineCap = 'round';
    for (var a = 0; a < ARM_N; a++) {
      var base = s.spin + a * TAU / ARM_N;
      for (var seg = 0; seg < 3; seg++) {
        ctx.beginPath();
        for (var j = 0; j <= ARM_PTS; j++) {
          var u = (seg + j / ARM_PTS) / 3;
          var r = 12 + u * reach;
          var th = base - wind * Math.log(r / 12);
          var x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = seg === 0 ? mix(p.ink, p.accent, open * 0.7) : (seg === 1 ? p.primary : mix(p.primary, p.bg, 0.4));
        ctx.globalAlpha = (seg === 0 ? 0.9 : (seg === 1 ? 0.55 : 0.25)) * f;
        ctx.lineWidth = seg === 0 ? 2.6 : (seg === 1 ? 2 : 1.4);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // counter-rotating pentagon rings
    ctx.strokeStyle = rgba(p.ink, 0.45 * f);
    ctx.lineWidth = 1.5;
    AP.R.poly(ctx, cx, cy, (30 + 3 * b) * f, 5, -s.spin * 0.6);
    ctx.stroke();
    ctx.strokeStyle = rgba(p.primary, 0.35 * f);
    AP.R.poly(ctx, cx, cy, (40 + 2 * b) * f, 5, s.spin * 0.35 + Math.PI / 5);
    ctx.stroke();
    // core: a dark knot with a closed pentagon lid, or the open accent weak point
    var rr = 17 * f;
    ctx.fillStyle = rgba(p.bg, 0.85);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.fill();
    if (open > 0.05) {
      AP.R.glow(ctx, cx, cy, 30 * f, p.accent, 0.8 * open);
      ctx.fillStyle = rgba(p.accent, 0.35 + 0.4 * open);
      AP.R.star(ctx, cx, cy, rr * (0.55 + 0.4 * open), rr * 0.3, 5, -Math.PI / 2 + s.spin * 0.2);
      ctx.fill();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = rgba(p.accent, 0.6 * open * (0.6 + 0.4 * b));
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, rr + 4 + 3 * b, 0, TAU);
      ctx.stroke();
    }
    // the lid: five petals that part as the eye opens
    var lid = 1 - open;
    if (lid > 0.02) {
      ctx.strokeStyle = mix(p.ink, p.primary, 0.3);
      ctx.fillStyle = rgba(p.primary, 0.22 * lid + 0.1);
      ctx.lineWidth = 2;
      for (var k = 0; k < 5; k++) {
        var pa = s.spin * 0.25 + k * TAU / 5;
        var po = (1 - lid) * rr * 0.9;
        var px = cx + Math.cos(pa) * po, py = cy + Math.sin(pa) * po;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(pa - 0.62) * rr, py + Math.sin(pa - 0.62) * rr);
        ctx.lineTo(px + Math.cos(pa + 0.62) * rr, py + Math.sin(pa + 0.62) * rr);
        ctx.closePath();
        ctx.globalAlpha = lid;
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // telegraph: an accent ring closing on the eye and five ticks that light up one per beat
    if (s.tel > 0) {
      var tk = s.tel;
      var tr = 26 + (1 - AP.M.ease.outCubic(tk)) * 92;
      ctx.strokeStyle = rgba(p.accent, 0.35 + 0.6 * tk);
      ctx.lineWidth = 2 + 2 * tk;
      ctx.beginPath();
      ctx.arc(cx, cy, tr, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = p.accent;
      for (var q = 0; q < 5; q++) {
        if (q / 5 > tk + 0.05) continue;
        var qa = -Math.PI / 2 + q * TAU / 5;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(qa) * (tr + 9), cy + Math.sin(qa) * (tr + 9), 3, 0, TAU);
        ctx.fill();
      }
      AP.R.glow(ctx, cx, cy, 40, p.accent, 0.3 * tk);
    }
    // open: the window closes clockwise around the eye (time left)
    if (s.state === ST.OPEN) {
      var left = 1 - M.clamp(s.t / CFG[s.phase].open, 0, 1);
      ctx.strokeStyle = rgba(p.accent, 0.75);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 34, -Math.PI / 2, -Math.PI / 2 + TAU * left);
      ctx.stroke();
    }
    // spit flash and the repulse gust
    if (s.spitFlash > 0) {
      ctx.strokeStyle = rgba(p.hazard, 0.7 * s.spitFlash);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 22 + (1 - s.spitFlash) * 16, s.spitA - 0.6, s.spitA + 0.6);
      ctx.stroke();
    }
    if (s.repFlash > 0) {
      ctx.strokeStyle = rgba(p.ink, 0.8 * s.repFlash);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 24 + (1 - s.repFlash) * 30, s.repA - 0.9, s.repA + 0.9);
      ctx.stroke();
    }
    if (s.hurt > 0) {
      AP.R.glow(ctx, cx, cy, 44, p.ink, 0.6 * s.hurt);
      ctx.strokeStyle = rgba(p.ink, s.hurt);
      ctx.lineWidth = 2;
      AP.R.poly(ctx, cx, cy, 20 + (1 - s.hurt) * 40, 5, s.spin);
      ctx.stroke();
    }
    // dormant: a faint sleeping spiral point
    if (s.state === ST.DORMANT) {
      ctx.fillStyle = rgba(p.ink, 0.6 + 0.3 * Math.sin(t * 2));
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, TAU);
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  }
})(window.AP = window.AP || {});
