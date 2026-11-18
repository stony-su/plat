/* js/worlds/w1/boss.js — owner: W1 */
(function (AP) {
  'use strict';

  // The Tessellator (CONTRACT section 2.17, DESIGN section 3 W1): a 3x3-tile golem of glowing Truchet tiles.
  //   Phase 1  Slam: it leaps above the player (shadow telegraph), slams, and sends a shockwave of popping tiles
  //            along the floor both ways. Then it kneels, stunned for 1.8 s with its top core glowing accent: stomp it.
  //   Phase 2  + Tile Rain: Truchet tiles fall in a "drop two, skip two" sweep, each with a shadow telegraph. Tiles
  //            that land settle into the floor as temporary blocks (L.setTile, only where L.tileFree); the next
  //            shockwave pops them.
  //   Phase 3  + Floor Flip: alternate 4-tile floor sections telegraph for 0.8 s, then flip into spikes for 2 s
  //            (L.setTile). Its slams become double slams.
  // 3 phases x 2 hits = 6. Each phase starts from a clean arena snapshot; onRespawn restores it (restoreTiles) and
  // restarts the current phase with full phase HP. Minions (shockwaves, falling tiles) are flagged and cleared on
  // player death. A damage window (the 1.8 s stun) opens at the end of every attack cycle, well inside 10 s.
  var C = AP.C;
  var M = AP.M;
  var T = AP.TILE;
  var TAU = Math.PI * 2;

  var HP = [2, 2, 2];
  var TOTAL = 6;
  var BW = 96, BH = 96, KH = 64;     // body box, kneeling height (the stunned top is a 2-tile hop)
  var G_HOP = 3000;                  // the golem's own gravity for hops and leaps (u/s^2)
  var STUN = 1.8;
  var BLOCK_LIFE = 7;                // seconds a settled rain tile stays before it pops by itself
  var TILE_TELE = 0.78;              // falling tile telegraph (shadow + ceiling outline), >= 0.6 s
  var FLIP_TELE = 0.8, FLIP_ON = 2.0, FLIP_OFF = 0.3;

  // per-phase tuning (stalk seconds, hop or walk, hover = slam telegraph, lock = last part of it without tracking,
  // shockwave speed tiles/s, falling tiles per rain, double slam)
  var PHASE = [
    { stalk: 1.6, hop: false, walk: 2.4, hover: 1.05, lock: 0.38, shock: 7, rain: 0, double: false, tint: 0 },
    { stalk: 1.2, hop: true, walk: 0, hover: 0.92, lock: 0.34, shock: 8, rain: 8, double: false, tint: 0.28 },
    { stalk: 1.0, hop: true, walk: 0, hover: 0.82, lock: 0.3, shock: 9, rain: 10, double: true, tint: 0.55 }
  ];

  function pal(L) { return (L && L.pal) || AP.Worlds.pal('w1'); }
  function lp() { return (AP.level && AP.level.pal) || AP.Worlds.pal('w1'); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function alive(P) { return !!P && P.state !== 'dead' && P.state !== 'respawn'; }
  function solid(code) { return code === T.SOLID || code === T.BREAK; }
  function beatPulse() { var ph = AP.Beat ? AP.Beat.phase : 0; var q = 1 - ph; return q * q * q; }
  function spb() { return (AP.Beat && AP.Beat.secondsPerBeat) ? AP.Beat.secondsPerBeat() : 60 / 132; }
  // scratch option objects for FX bursts and positional sounds (no allocation per call)
  var FXO = { n: 0, color: undefined, color2: undefined };
  function fx(name, x, y, n, color, color2) { FXO.n = n; FXO.color = color; FXO.color2 = color2; return AP.FX.burst(name, x, y, FXO); }
  var SFXO = { vol: 1, pitch: 1 };
  function snd(name, x, y, vol, pitch) { SFXO.vol = vol; SFXO.pitch = pitch; return AP.sfxAt(name, x, y, SFXO); }

  function truchetOri(x, y, seed) {
    if (AP.Algo && typeof AP.Algo.truchet === 'function') return AP.Algo.truchet(x, y, seed) & 3;
    return (AP.hash2(x, y, seed) >>> 3) & 3;
  }

  // ------------------------------------------------------------------ FX presets (w1.*)
  var FX_SLAM = { n: 14, shape: 'sq', speed: [140, 420], angle: [Math.PI * 1.08, Math.PI * 1.92], life: [0.45, 0.9], size: [3, 7],
    sizeEnd: 0, gravity: 1100, drag: 0.6, spin: [-10, 10], color: '#fff', color2: '#fff', spread: 30 };
  var FX_CHIP = { n: 6, shape: 'tri', speed: [80, 260], life: [0.35, 0.7], size: [2.5, 5], sizeEnd: 0, gravity: 900, drag: 0.8,
    spin: [-12, 12], color: '#fff', color2: '#fff', spread: 8 };
  var FX_CEIL = { n: 3, shape: 'dot', speed: [10, 40], angle: [Math.PI * 0.35, Math.PI * 0.65], life: [0.3, 0.6], size: [1.2, 2.4],
    sizeEnd: 0, gravity: 260, drag: 1, color: '#fff', color2: '#fff', spread: 10 };
  var FX_SPIKE = { n: 4, shape: 'line', speed: [120, 260], angle: [Math.PI * 1.3, Math.PI * 1.7], life: [0.18, 0.35], size: [4, 7],
    sizeEnd: 0, drag: 2, align: true, width: 1.5, color: '#fff', color2: '#fff' };

  AP.FX.preset('w1.slam', function (x, y, o) {
    var p = lp();
    FX_SLAM.color = (o && o.color) || p.primary; FX_SLAM.color2 = p.hazard; FX_SLAM.n = (o && o.n) || 14;
    var n = AP.FX.emit(x, y, FX_SLAM);
    AP.FX.ring(x, y, 10, 150, 0.5, p.hazard, 3);
    AP.FX.ring(x, y, 4, 80, 0.35, p.primary, 2);
    return n + 2;
  });
  AP.FX.preset('w1.chip', function (x, y, o) {
    var p = lp();
    FX_CHIP.color = (o && o.color) || p.primary; FX_CHIP.color2 = (o && o.color2) || p.accent; FX_CHIP.n = (o && o.n) || 6;
    return AP.FX.emit(x, y, FX_CHIP);
  });
  AP.FX.preset('w1.ceiling', function (x, y, o) {
    var p = lp();
    FX_CEIL.color = (o && o.color) || p.primary; FX_CEIL.color2 = p.bg; FX_CEIL.n = (o && o.n) || 3;
    return AP.FX.emit(x, y, FX_CEIL);
  });
  AP.FX.preset('w1.spikes', function (x, y, o) {
    var p = lp();
    FX_SPIKE.color = (o && o.color) || p.hazard; FX_SPIKE.color2 = p.ink; FX_SPIKE.n = (o && o.n) || 4;
    return AP.FX.emit(x, y, FX_SPIKE);
  });

  // ------------------------------------------------------------------ arena helpers
  function scanArena(e, L) {
    var s = e.s;
    var FY = Math.round(e.y + e.h);
    var fr = Math.round(FY / 32) - 1;
    var c = Math.floor((e.x + e.w / 2) / 32);
    var l = c, r = c;
    while (l > 0 && !solid(L.tileAt(l - 1, fr))) l--;
    while (r < L.w - 1 && !solid(L.tileAt(r + 1, fr))) r++;
    var top = fr;
    while (top > 0 && !solid(L.tileAt(c, top - 1))) top--;
    s.FY = FY; s.fr = fr; s.c0 = l; s.c1 = r;
    s.AX0 = l * 32; s.AX1 = (r + 1) * 32;
    s.CY = top * 32;
    s.hoverBy = s.CY + 10 + BH;                 // body bottom while hovering
  }

  function clampX(s, x) { return M.clamp(x, s.AX0 + BW / 2, s.AX1 - BW / 2); }
  function playerCX(L) { var P = L.player; return P ? P.x + P.w / 2 : 0; }

  // is cell (tx, fr) a settled rain tile (solid now, empty in the clean arena)?
  function isBlock(B, L, tx) {
    var s = B.s;
    if (tx < s.c0 || tx > s.c1 || !s.snap0) return false;
    return solid(L.tileAt(tx, s.fr)) && s.snap0[s.fr * L.w + tx] === T.EMPTY;
  }

  function popBlock(B, L, tx, quiet) {
    if (!isBlock(B, L, tx)) return false;
    L.setTile(tx, B.s.fr, T.EMPTY);
    var x = tx * 32 + 16, y = B.s.fr * 32 + 16;
    fx('w1.tiles', x, y, 7);
    fx('w1.chip', x, y - 8, 4);
    if (!quiet) snd('break', x, y, 0.55, 1.2);
    return true;
  }

  function settleBlock(B, L, tx) {
    var s = B.s;
    if (s.st === 'dying' || s.st === 'dead' || L.bossDone) return false;
    if (tx < s.c0 || tx > s.c1) return false;
    if (L.tileAt(tx, s.fr) !== T.EMPTY || !solid(L.tileAt(tx, s.fr + 1))) return false;
    if (!L.tileFree(tx, s.fr)) return false;                       // never place a solid on the player
    if (Math.abs(tx * 32 + 16 - s.bx) < BW / 2 + 4 && s.by > s.FY - 40) return false;   // not inside the golem's feet
    L.setTile(tx, s.fr, T.SOLID);
    if (s.blkN < s.blk.length) { s.blk[s.blkN] = tx; s.blkT[s.blkN] = L.time; s.blkN++; }
    return true;
  }

  function tickBlocks(B, L) {
    var s = B.s;
    var w = 0;
    for (var i = 0; i < s.blkN; i++) {
      var tx = s.blk[i];
      if (!isBlock(B, L, tx)) continue;                            // popped by a shockwave already
      if (L.time - s.blkT[i] > BLOCK_LIFE) { popBlock(B, L, tx, false); continue; }
      s.blk[w] = tx; s.blkT[w] = s.blkT[i]; w++;
    }
    s.blkN = w;
  }

  // the arena as this phase starts: transients cleared, then snapshotted
  function cleanArena(e, L) {
    var s = e.s;
    if (s.snap0) L.restoreTiles(s.snap0);
    s.blkN = 0;
    s.flipSt = '';
    s.flipN = 0;
  }

  // ------------------------------------------------------------------ body placement
  function place(e) {
    var s = e.s;
    var h = s.kneel ? KH : BH;
    var oldY = e.y;
    e.w = BW;
    e.h = h;
    e.x = s.bx - BW / 2;
    e.y = s.by - h;
    if (s.hChanged) { e.py += e.y - oldY; s.hChanged = false; }   // keep the interpolation continuous
  }
  function setKneel(e, on) {
    if (e.s.kneel === on) return;
    e.s.kneel = on;
    e.s.hChanged = true;
  }

  function hpLeft(s) {
    var n = Math.max(0, s.hp);
    for (var i = s.phase + 1; i < HP.length; i++) n += HP[i];
    return n;
  }

  function setState(e, st) {
    e.s.st = st;
    e.s.t = 0;
  }

  // ------------------------------------------------------------------ cycle script
  function special(s) {
    if (s.phase === 1) return (s.cycle % 2 === 0) ? 'rain' : '';
    if (s.phase === 2) return (s.cycle % 2 === 0) ? 'flip' : 'rain';
    return '';
  }

  function beginCycle(e, L) {
    var s = e.s;
    s.slams = 0;
    setState(e, 'stalk');
    e.hazard = true;
  }

  function afterStalk(e, L) {
    var sp = special(e.s);
    e.s.lastSpecial = sp;
    if (sp === 'rain') startRain(e, L);
    else if (sp === 'flip') startFlip(e, L);
    else startCrouch(e, L);
  }

  function startCrouch(e, L) {
    setState(e, 'crouch');
    e.s.sqT = -0.22;
    snd('charge', e.s.bx, e.s.by - 48, 0.5, 0.7 + 0.12 * e.s.phase);
  }

  function startLeap(e, L) {
    var s = e.s;
    setState(e, 'leap');
    s.lx0 = s.bx; s.ly0 = s.by;
    s.ltx = clampX(s, playerCX(L));
    s.air = true;
    s.sqT = 0.2;
    fx('w1.slam', s.bx, s.FY, 8);
    snd('whoosh', s.bx, s.by - 48, 0.8, 0.7);
    L.shake(3, 0.15);
  }

  function impact(e, L) {
    var s = e.s, cfg = PHASE[s.phase];
    s.by = s.FY; s.vy = 0; s.vx = 0; s.air = false;
    s.slams++;
    s.sqT = -0.35;
    // pop any settled tile under the feet, then send the shockwave both ways
    var t0 = Math.floor((s.bx - BW / 2) / 32), t1 = Math.floor((s.bx + BW / 2 - 1) / 32);
    for (var tx = t0; tx <= t1; tx++) popBlock(e, L, tx, true);
    for (var d = -1; d <= 1; d += 2) {
      var x = s.bx + d * (BW / 2 + 14);
      if (x < s.AX0 + 10 || x > s.AX1 - 10) continue;
      var m = L.spawn('w1.shock', x, s.FY - 11, { dir: d > 0 ? 'right' : 'left', speed: cfg.shock, fr: s.fr });
      if (m) { m.minion = true; m.parent = e; }
    }
    AP.FX.burst('w1.slam', s.bx, s.FY);
    snd('explode', s.bx, s.FY, 0.9, 0.75);
    snd('rumble', s.bx, s.FY, 0.8, 1);
    L.shake(11, 0.4);
    L.kick(0, 7);
    if (cfg.double && s.slams < 2 && s.lastSpecial !== 'rain') {
      // phase 3: rebound into a second slam, aimed at the player again (after a rain the floor is busy enough)
      setState(e, 'rebound');
      s.air = true;
      s.vy = -980;
      var air = 980 / G_HOP;
      s.vx = (clampX(s, playerCX(L)) - s.bx) / Math.max(0.2, air);
      s.vx = M.clamp(s.vx, -520, 520);
      return;
    }
    // kneel: stunned, weak point open (accent telegraph), harmless to touch
    setState(e, 'stun');
    setKneel(e, true);
    e.hazard = false;
    s.stunFx = 0;
    snd('chime', s.bx, s.FY - KH, 0.75, 0.9);
    AP.FX.ring(s.bx, s.FY - KH + 6, 6, 70, 0.5, pal(L).accent, 2.5);
  }

  // ------------------------------------------------------------------ tile rain
  function startRain(e, L) {
    var s = e.s, cfg = PHASE[s.phase];
    setState(e, 'rain');
    var pc = Math.floor(playerCX(L) / 32);
    var k = (s.cycle * 3 + s.phase + s.rainN) & 3;
    s.rainN++;
    var n = 0;
    for (var d = 0; d <= s.c1 - s.c0 && n < cfg.rain; d++) {
      for (var sg = -1; sg <= 1 && n < cfg.rain; sg += 2) {
        if (d === 0 && sg > 0) continue;
        var c = pc + sg * d;
        if (c < s.c0 || c > s.c1) continue;
        if ((((c - s.c0 + k) >> 1) & 1) !== 0) continue;                      // drop two, skip two
        if (L.tileAt(c, s.fr) !== T.EMPTY) continue;
        if (Math.abs(c * 32 + 16 - s.bx) < BW / 2 + 8) continue;               // not onto the golem itself
        s.rq[n++] = c;
      }
    }
    // sweep across the chosen columns (direction alternates)
    for (var i = 1; i < n; i++) {
      var v = s.rq[i], j = i - 1;
      while (j >= 0 && s.rq[j] > v) { s.rq[j + 1] = s.rq[j]; j--; }
      s.rq[j + 1] = v;
    }
    if (s.rainN & 1) for (var a = 0, b = n - 1; a < b; a++, b--) { var tmp = s.rq[a]; s.rq[a] = s.rq[b]; s.rq[b] = tmp; }
    s.rqN = n;
    s.rqI = 0;
    s.rqGap = Math.max(0.14, spb() * (s.phase >= 2 ? 0.34 : 0.5));
    snd('charge', s.bx, s.by - 80, 0.6, 1.1);
  }

  function rainUpdate(e, dt, L) {
    var s = e.s;
    var t0 = 0.5;
    while (s.rqI < s.rqN && s.t >= t0 + s.rqI * s.rqGap) {
      var c = s.rq[s.rqI];
      var m = L.spawn('w1.tile', c * 32 + 16, s.CY + 50, { delay: TILE_TELE, or: truchetOri(c, s.rainN, L.seed), fr: s.fr });
      if (m) { m.minion = true; m.parent = e; }
      s.rqI++;
    }
    if (s.rqI >= s.rqN && s.t >= t0 + Math.max(0, s.rqN - 1) * s.rqGap + TILE_TELE + 0.5) startCrouch(e, L);
  }

  // ------------------------------------------------------------------ floor flip
  function startFlip(e, L) {
    var s = e.s;
    setState(e, 'flip');
    s.flipPar ^= 1;
    var n = 0;
    for (var c = s.c0; c <= s.c1 && n < s.flip.length; c++) {
      var sec = Math.floor((c - s.c0) / 4);
      if ((sec & 1) !== s.flipPar) continue;
      if (L.tileAt(c, s.fr) !== T.EMPTY || !solid(L.tileAt(c, s.fr + 1))) continue;
      s.flip[n++] = c;
    }
    s.flipN = n;
    s.flipSt = 'tele';
    s.flipT = 0;
    snd('charge', s.bx, s.FY, 0.7, 0.55);
  }

  // retract a floor flip at once (forced damage windows)
  function cancelFlip(e, L) {
    var s = e.s;
    for (var i = 0; i < s.flipN; i++) if (L.tileAt(s.flip[i], s.fr) === T.SPIKE_U) L.setTile(s.flip[i], s.fr, T.EMPTY);
    s.flipSt = '';
    s.flipN = 0;
  }

  function flipUpdate(e, dt, L) {
    var s = e.s;
    if (!s.flipSt) return;
    s.flipT += dt;
    var i;
    if (s.flipSt === 'tele' && s.flipT >= FLIP_TELE) {
      s.flipSt = 'on';
      s.flipT = 0;
      for (i = 0; i < s.flipN; i++) {
        var c = s.flip[i];
        if (L.tileAt(c, s.fr) !== T.EMPTY) continue;
        L.setTile(c, s.fr, T.SPIKE_U);
        if (i % 2 === 0) fx('w1.spikes', c * 32 + 16, s.FY - 4, 3);
      }
      snd('split', s.bx, s.FY, 0.8, 0.8);
      L.shake(4, 0.18);
    } else if (s.flipSt === 'on' && s.flipT >= FLIP_ON) {
      s.flipSt = 'off';
      s.flipT = 0;
      for (i = 0; i < s.flipN; i++) {
        if (L.tileAt(s.flip[i], s.fr) === T.SPIKE_U) L.setTile(s.flip[i], s.fr, T.EMPTY);
      }
      snd('whoosh', s.bx, s.FY, 0.45, 1.4);
    } else if (s.flipSt === 'off' && s.flipT >= FLIP_OFF) {
      s.flipSt = '';
      s.flipN = 0;
    }
  }

  // ------------------------------------------------------------------ damage
  function hit(e, L) {
    var s = e.s;
    if (L.bossDone || s.st === 'dying' || s.st === 'dead') return;
    s.hp--;
    s.cracks = Math.min(9, s.cracks + 1);
    s.flash = 1;
    setKneel(e, false);
    var cx = s.bx, cy = s.by - 70;
    fx('w1.chip', cx, cy, 10, undefined, pal(L).accent);
    snd('crumble', cx, cy, 0.6, 0.8);
    if (s.hp > 0) {
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
      startRecoil(e, L);
    } else if (s.phase < HP.length - 1) {
      s.phase++;
      s.hp = HP[s.phase];
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
      startShift(e, L);
    } else {
      s.hp = 0;
      L.bossBar(0, s.phase);
      startDying(e, L);
      L.bossDefeated(e);
    }
  }

  function startRecoil(e, L) {
    var s = e.s;
    setState(e, 'recoil');
    e.hazard = false;
    s.air = true;
    var away = s.bx >= playerCX(L) ? 1 : -1;
    if (s.bx + away * 90 > s.AX1 - BW / 2 || s.bx + away * 90 < s.AX0 + BW / 2) away = -away;
    s.vx = away * 3.4 * 32;
    s.vy = -560;
    s.sqT = 0.3;
  }

  function startShift(e, L) {
    var s = e.s;
    setState(e, 'shift');
    e.hazard = false;
    s.air = true;
    s.cycle = 0;
    s.slams = 0;
    // a new phase starts from a clean arena: spikes retract, settled tiles pop, and that state is the phase snapshot
    cleanArena(e, L);
    s.snaps[s.phase] = L.snapshotTiles();
    var cx = clampX(s, (s.AX0 + s.AX1) / 2);
    s.vy = -1150;
    var air = 2 * 1150 / G_HOP;
    s.vx = M.clamp((cx - s.bx) / air, -700, 700);
    s.sqT = 0.35;
    L.intensity = Math.max(L.intensity, 0.6 + 0.15 * s.phase);
    snd('rumble', s.bx, s.by, 0.9, 0.8);
    fx('w1.assemble', s.bx, s.by - 48, 16);
  }

  function finishShift(e, L) {
    var s = e.s;
    s.by = s.FY; s.vy = 0; s.vx = 0; s.air = false;
    beginCycle(e, L);
  }

  // the golem shatters into its tiles, which rain gently and fade
  function startDying(e, L) {
    var s = e.s;
    setState(e, 'dying');
    e.hazard = false;
    e.stompable = false;
    setKneel(e, false);
    s.air = false;
    cleanArena(e, L);
    var top = s.by - BH;
    for (var i = 0; i < 9; i++) {
      var ci = i % 3, ri = (i / 3) | 0;
      var x = s.bx + (ci - 1) * 32, y = top + ri * 32 + 16;
      s.partX[i] = x; s.partY[i] = y;
      var a = Math.atan2(y - (top + 48), x - s.bx + 0.01);
      var sp = 140 + ((AP.hash2(i, 3, L.seed) & 255) / 255) * 180;
      s.partVX[i] = Math.cos(a) * sp * 0.9;
      s.partVY[i] = -260 - ((AP.hash2(i, 9, L.seed) & 255) / 255) * 300;
      s.partA[i] = 0;
      s.partW[i] = (((AP.hash2(i, 17, L.seed) & 255) / 255) - 0.5) * 9;
      s.partB[i] = 0;
    }
    fx('w1.tiles', s.bx, top + 48, 18);
    fx('w1.assemble', s.bx, top + 48, 20);
  }

  // ------------------------------------------------------------------ lifecycle
  function forceStart(e, L) {
    var s = e.s;
    if (s.started) return;
    s.started = true;
    s.asm = 1;
    e.hazard = true;
    L.bossStart(e);
    L.intensity = Math.max(L.intensity, 0.6);
    s.snaps[0] = L.snapshotTiles();
    beginCycle(e, L);
  }

  function update(e, dt, L) {
    var s = e.s;
    var P = L.player;
    s.t += dt;
    // beat edges (robust to steps skipped in hitstop)
    var bi = AP.Beat ? Math.floor(AP.Beat.beat) : 0;
    var tick = bi !== s.lastBeat;
    s.lastBeat = bi;
    if (tick && s.st !== 'sleep' && s.st !== 'dying' && s.st !== 'dead') {
      var ti = (bi * 5 + 2) % 9;
      s.ori[ti] = (s.ori[ti] + 1) & 3;
      s.trot[ti] = 1;
    }
    for (var r = 0; r < 9; r++) if (s.trot[r] > 0) s.trot[r] = Math.max(0, s.trot[r] - dt * 7);
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 4);
    s.sqT = M.approach(s.sqT, 0, dt * 2.2);
    if (s.face === 0) s.face = 1;
    if (P) {
      var dxp = playerCX(L) - s.bx;
      if (Math.abs(dxp) > 6) s.face = M.approach(s.face, dxp > 0 ? 1 : -1, dt * 6);
    }
    if (s.st !== 'sleep' && s.st !== 'dead') tickBlocks(e, L);
    if (s.st !== 'wait') flipUpdate(e, dt, L);

    switch (s.st) {
      case 'sleep':
        if (L.playerMoved) {
          setState(e, 'wake');
          snd('charge', s.bx, s.by - 48, 0.8, 0.5);
        }
        break;
      case 'wake':
        s.asm = M.clamp(s.t / 1.1, 0, 1);
        if (tick) fx('w1.assemble', s.bx, s.by - 48, 6);
        if (s.t >= 1.1) {
          s.asm = 1;
          s.started = true;
          e.hazard = true;
          L.bossStart(e);
          L.intensity = Math.max(L.intensity, 0.6);
          s.snaps[0] = L.snapshotTiles();
          setState(e, 'roar');
          s.sqT = 0.3;
        }
        break;
      case 'roar':
        if (s.t >= 0.9) beginCycle(e, L);
        break;
      case 'stalk':
        stalk(e, dt, L, tick);
        break;
      case 'rain':
        groundIdle(e, dt);
        rainUpdate(e, dt, L);
        break;
      case 'flip':
        // it crouches for the slam as the spikes are about to sink; it lands well after they are gone
        groundIdle(e, dt);
        if ((!s.flipSt && s.t > FLIP_TELE) || (s.flipSt === 'on' && s.flipT >= FLIP_ON - 0.35)) startCrouch(e, L);
        break;
      case 'crouch':
        if (s.t >= 0.32) startLeap(e, L);
        break;
      case 'leap': {
        var k = M.clamp(s.t / 0.45, 0, 1);
        s.bx = M.lerp(s.lx0, s.ltx, M.ease.inOutSine(k));
        s.by = M.lerp(s.ly0, s.hoverBy, M.ease.outCubic(k));
        if (k >= 1) setState(e, 'hover');
        break;
      }
      case 'hover': {
        var cfg = PHASE[s.phase];
        if (s.t < cfg.hover - cfg.lock) s.bx = M.damp(s.bx, clampX(s, playerCX(L)), 5.5, dt);
        else if (!s.locked) { s.locked = true; snd('pulse', s.bx, s.FY, 0.7, 0.7); }
        s.by = s.hoverBy + Math.sin(s.t * 9) * 2;
        if (s.t >= cfg.hover) { setState(e, 'drop'); s.vy = 0; s.locked = false; }
        break;
      }
      case 'rebound':
        s.vy += G_HOP * dt;
        s.bx = clampX(s, s.bx + s.vx * dt);
        s.by += s.vy * dt;
        if (s.vy >= 0) { setState(e, 'hover2'); s.vx = 0; s.hy = s.by; }
        break;
      case 'hover2':
        if (s.t < 0.26) s.bx = M.damp(s.bx, clampX(s, playerCX(L)), 6, dt);
        else if (!s.locked) { s.locked = true; snd('pulse', s.bx, s.FY, 0.7, 0.85); }
        s.by = s.hy + Math.sin(s.t * 10) * 1.5;
        if (s.t >= 0.5) { setState(e, 'drop'); s.vy = 0; s.locked = false; }
        break;
      case 'drop':
        s.vy = Math.min(s.vy + 6200 * dt, 1750);
        s.by += s.vy * dt;
        if (s.by >= s.FY) impact(e, L);
        break;
      case 'stun':
        s.stunFx -= dt;
        if (s.stunFx <= 0) { s.stunFx = 0.16; fx('w1.sparks', s.bx + (Math.sin(s.t * 13) * 30), s.FY - KH - 4, 1); }
        if (s.t >= STUN) {
          setState(e, 'rise');
          setKneel(e, false);
          snd('grow', s.bx, s.FY - 48, 0.45, 0.6);
        }
        break;
      case 'rise':
        if (s.t >= 0.42 && clearPlayer(e, L, dt, s.t - 0.42)) { s.cycle++; beginCycle(e, L); }
        break;
      case 'recoil':
        airborne(e, dt);
        if (!s.air && s.t >= 0.75 && clearPlayer(e, L, dt, s.t - 0.75)) { s.cycle++; beginCycle(e, L); }
        break;
      case 'shift':
        airborne(e, dt);
        if (!s.air && s.t >= 1.5 && clearPlayer(e, L, dt, s.t - 1.5)) finishShift(e, L);
        break;
      case 'dying':
        dyingUpdate(e, dt, L);
        break;
      case 'wait':
        airborne(e, dt);
        break;
      case 'reform':
        s.asm = M.clamp(s.t / 0.9, 0, 1);
        if (s.t >= 1.3 && clearPlayer(e, L, dt, s.t - 1.3)) { s.asm = 1; beginCycle(e, L); }
        break;
      default:
        break;
    }
    place(e);
  }

  function touchingPlayer(e, L) {
    var P = L.player;
    if (!alive(P)) return false;
    var x = e.s.bx - BW / 2, y = e.s.by - BH;
    return P.x < x + BW + 4 && P.x + P.w > x - 4 && P.y < y + BH && P.y + P.h > y - 4;
  }

  // Before it turns dangerous again, the golem shoves an overlapping player out of its body (toward the nearer
  // side; if a wall is in the way it slides itself instead). Returns true once the player is clear, or after
  // 1.2 s so an invulnerable (assist) player can never stall the fight.
  function clearPlayer(e, L, dt, waitT) {
    if (!touchingPlayer(e, L)) return true;
    if (waitT > 1.2) return true;
    var s = e.s, P = L.player;
    var pcx = P.x + P.w / 2;
    var dir = pcx >= s.bx ? 1 : -1;
    var need = dir > 0 ? (s.bx + BW / 2 + 5) - P.x : P.x + P.w - (s.bx - BW / 2 - 5);
    var stp = Math.min(Math.abs(need), 420 * dt);
    if (P.moveX(dir * stp)) s.bx = clampX(s, s.bx - dir * 300 * dt);
    return false;
  }

  function airborne(e, dt) {
    var s = e.s;
    if (!s.air) return;
    s.vy += G_HOP * dt;
    s.bx = clampX(s, s.bx + s.vx * dt);
    s.by += s.vy * dt;
    if (s.by >= s.FY && s.vy > 0) {
      s.by = s.FY; s.vy = 0; s.vx = 0; s.air = false;
      s.sqT = -0.25;
      var L = AP.level;
      if (L) {
        fx('w1.slam', s.bx, s.FY, 6);
        snd('land', s.bx, s.FY, 0.9, 0.5);
        L.shake(4, 0.15);
      }
    }
  }

  function groundIdle(e, dt) {
    var s = e.s;
    if (s.air) airborne(e, dt);
  }

  function stalk(e, dt, L, tick) {
    var s = e.s, cfg = PHASE[s.phase];
    var px = playerCX(L);
    var dx = px - s.bx;
    var gap = Math.abs(dx) - BW / 2 - 11;
    var dir = dx >= 0 ? 1 : -1;
    if (cfg.hop) {
      // beat-synced hops toward the player, stopping three tiles short
      if (s.air) airborne(e, dt);
      else if (tick && gap > 100) {
        s.air = true;
        s.vy = -Math.sqrt(2 * G_HOP * 44);
        var air = 2 * Math.abs(s.vy) / G_HOP;
        s.vx = dir * Math.min(gap - 90, 2.6 * 32) / air;
        s.sqT = 0.2;
        snd('step', s.bx, s.FY, 0.8, 0.45);
      }
    } else if (gap > 100) {
      var lurch = 0.35 + 0.65 * Math.abs(Math.sin((AP.Beat ? AP.Beat.phase : 0) * Math.PI));
      s.bx = clampX(s, s.bx + dir * cfg.walk * 32 * lurch * dt);
      if (tick) {
        fx('w1.hop', s.bx + dir * 30, s.FY, 3);
        snd('step', s.bx, s.FY, 0.9, 0.4);
        L.shake(1.5, 0.08);
      }
    }
    // a short stalk before the special attacks keeps every damage window well inside 10 s
    var dur = special(s) ? Math.min(cfg.stalk, 0.6) : cfg.stalk;
    if (s.t >= dur && !s.air) afterStalk(e, L);
  }

  function dyingUpdate(e, dt, L) {
    var s = e.s;
    for (var i = 0; i < 9; i++) {
      s.partVY[i] = Math.min(s.partVY[i] + 620 * dt, 520);
      s.partVX[i] *= (1 - 0.6 * dt);
      s.partX[i] += s.partVX[i] * dt;
      s.partY[i] += s.partVY[i] * dt;
      s.partA[i] += s.partW[i] * dt;
      if (s.partY[i] > s.FY - 14 && s.partVY[i] > 0) {
        s.partY[i] = s.FY - 14;
        if (s.partB[i] < 1) {
          s.partVY[i] *= -0.35;
          s.partB[i] = 1;
          fx('w1.tiles', s.partX[i], s.FY - 4, 3);
          if (i % 3 === 0) snd('crumble', s.partX[i], s.FY, 0.35, 1.3 + i * 0.05);
        } else { s.partVY[i] = 0; s.partVX[i] *= 0.8; }
      }
    }
    if (s.t >= 2.8) {
      setState(e, 'dead');
      e.visible = false;
    }
  }

  // ------------------------------------------------------------------ the boss def
  AP.Entities.register('w1.tessellator', {
    kind: 'sensor', w: BW, h: BH, anchor: 'floor', layer: 6, lint: 'ignore', renderPad: 600, alwaysRender: true,
    hazard: true, stompable: true, boss: true, bossName: 'The Tessellator', phases: 3,
    init: function (e, spec, L) {
      var s = e.s;
      scanArena(e, L);
      s.bx = e.x + BW / 2; s.by = e.y + BH;
      s.hx = s.bx;
      s.vx = 0; s.vy = 0; s.air = false;
      s.st = 'sleep'; s.t = 0;
      s.phase = 0; s.hp = HP[0]; s.cycle = 0; s.slams = 0; s.rainN = 0;
      s.lastSpecial = '';
      s.started = false; s.asm = 0; s.kneel = false; s.hChanged = false; s.locked = false;
      s.flash = 0; s.sqT = 0; s.face = 1; s.cracks = 0; s.stunFx = 0; s.hy = 0;
      s.lx0 = 0; s.ly0 = 0; s.ltx = 0;
      s.lastBeat = -1;
      s.ori = new Uint8Array(9);
      s.trot = new Float32Array(9);
      for (var i = 0; i < 9; i++) s.ori[i] = truchetOri(i % 3, (i / 3) | 0, L ? L.seed : 7);
      s.rq = new Int16Array(16); s.rqN = 0; s.rqI = 0; s.rqGap = 0.22;
      s.flip = new Int16Array(64); s.flipN = 0; s.flipSt = ''; s.flipT = 0; s.flipPar = 1;
      s.blk = new Int16Array(48); s.blkT = new Float32Array(48); s.blkN = 0;
      s.partX = new Float32Array(9); s.partY = new Float32Array(9); s.partVX = new Float32Array(9); s.partVY = new Float32Array(9);
      s.partA = new Float32Array(9); s.partW = new Float32Array(9); s.partB = new Uint8Array(9);
      s.snap0 = L.snapshotTiles();
      s.snaps = [null, null, null];
      e.hazard = false;                       // asleep: a harmless pile of tiles until the player moves
    },
    update: update,
    render: function (e, ctx, L) { drawBoss(e, ctx, L); },
    onStomp: function (e, P, L) {
      var st = e.s.st;
      if (st === 'stun') { hit(e, L); return true; }
      // while harmless (recoiling, standing up, shifting phase) its top is a springy lattice: bounce, no damage
      if (!e.hazard && (st === 'recoil' || st === 'rise' || st === 'shift' || st === 'reform')) return true;
      return false;
    },
    onPlayerDeath: function (e, L) {
      var s = e.s;
      L.clearMinions();
      if (s.st === 'dying' || s.st === 'dead' || !s.started) return;
      s.rqN = 0; s.rqI = 0;
      setKneel(e, false);
      setState(e, 'wait');
      if (s.by < s.FY) { s.air = true; s.vx = 0; s.vy = Math.max(0, s.vy); }
    },
    onRespawn: function (e, L) {
      var s = e.s;
      if (s.st === 'dying' || s.st === 'dead' || L.bossDone) return;
      if (!s.started) return;                 // still asleep (a retry before the fight began)
      // back to the start of the current phase, with that phase's HP and arena
      s.hp = HP[s.phase];
      s.flipSt = ''; s.flipN = 0; s.blkN = 0;
      s.rqN = 0; s.rqI = 0;
      var snap = s.snaps[s.phase] || s.snap0;
      L.restoreTiles(snap);
      s.bx = s.hx; s.by = s.FY; s.vx = 0; s.vy = 0; s.air = false;
      setKneel(e, false);
      s.cycle = 0; s.slams = 0;
      s.asm = 0;
      e.hazard = false;
      setState(e, 'reform');
      place(e);
      e.setPos(e.x, e.y);
      L.bossBar(hpLeft(s) / TOTAL, s.phase);
      fx('w1.assemble', s.bx, s.by - 48, 14);
    },
    debugDamage: function (e, L) {
      var s = e.s;
      if (L.bossDone || s.st === 'dying' || s.st === 'dead') return;
      if (!s.started) forceStart(e, L);
      if (s.st === 'shift') finishShift(e, L);
      if (s.st !== 'stun') {
        // force the damage window: land and kneel where it is
        s.by = s.FY; s.vy = 0; s.vx = 0; s.air = false;
        if (s.flipSt) cancelFlip(e, L);
        s.rqN = 0; s.rqI = 0;
        setState(e, 'stun');
        setKneel(e, true);
        e.hazard = false;
        place(e);
      }
      hit(e, L);
      place(e);
    }
  });

  // ------------------------------------------------------------------ minion: falling Truchet tile
  AP.Entities.register('w1.tile', {
    kind: 'sensor', w: 28, h: 28, anchor: 'center', layer: 7, lint: 'ignore', renderPad: 600,
    hazard: true,
    init: function (e, spec, L) {
      var s = e.s;
      s.delay = Math.max(0.4, +spec.delay || TILE_TELE);
      s.or = (spec.or | 0) & 3;
      s.fr = spec.fr | 0;
      s.FY = (s.fr + 1) * 32;
      s.st = 'tele';
      s.t = 0;
      s.vy = 0;
      s.spin = 0;
      s.dust = 0;
      e.hazard = false;                         // harmless while it hangs at the ceiling (telegraph)
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.t += dt;
      if (s.st === 'tele') {
        s.dust -= dt;
        if (s.dust <= 0) { s.dust = 0.12; fx('w1.ceiling', e.x + 14, e.y, 1); }
        if (s.t >= s.delay) {
          s.st = 'fall';
          s.t = 0;
          e.hazard = true;
          snd('whoosh', e.x + 14, e.y, 0.35, 1.6);
        }
        return;
      }
      s.vy = Math.min(s.vy + 2600 * dt, 1150);
      e.y += s.vy * dt;
      s.spin += dt * 2;
      var tx = Math.floor((e.x + e.w / 2) / 32);
      var code = L.tileAt(tx, s.fr);
      var landY = solid(code) ? s.fr * 32 : s.FY;
      if (e.y + e.h >= landY) {
        e.y = landY - e.h;
        var B = e.parent;
        var cx = e.x + e.w / 2;
        if (B && !B.dead && !solid(code) && settleBlock(B, L, tx)) {
          fx('w1.slam', cx, s.FY, 5);
          snd('land', cx, s.FY, 0.8, 0.7);
          L.shake(2, 0.1);
        } else {
          fx('w1.tiles', cx, landY - 10, 8);
          fx('w1.chip', cx, landY - 10, 5);
          snd('hit', cx, landY, 0.45, 1.3);
        }
        L.remove(e);
      }
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var cx = e.rx + e.w / 2, cy = e.ry + e.h / 2;
      var floorY = s.FY;
      // floor shadow: widens and darkens as the tile nears
      var near = s.st === 'tele' ? 0.25 + 0.5 * (s.t / s.delay) : 0.75 + 0.25 * M.clamp((e.ry + e.h) / floorY, 0, 1);
      var hw = 6 + 9 * near;
      ctx.fillStyle = rgba(p.hazard, 0.12 + 0.3 * near);
      ctx.fillRect(cx - hw, floorY - 3, hw * 2, 3);
      ctx.strokeStyle = rgba(p.hazard, 0.35 + 0.5 * near);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - hw, floorY - 1); ctx.lineTo(cx + hw, floorY - 1);
      // little spikes on the shadow: reads "danger here" without colour
      for (var k = -1; k <= 1; k++) { ctx.moveTo(cx + k * 6 - 3, floorY - 1); ctx.lineTo(cx + k * 6, floorY - 6 - 3 * near); ctx.lineTo(cx + k * 6 + 3, floorY - 1); }
      ctx.stroke();
      if (s.st === 'tele') {
        // dashed drop line from the ceiling tile to its shadow
        ctx.strokeStyle = rgba(p.hazard, 0.12 + 0.18 * near);
        ctx.lineWidth = 1;
        ctx.setLineDash(DASH);
        ctx.beginPath(); ctx.moveTo(cx, cy + 16); ctx.lineTo(cx, floorY - 8); ctx.stroke();
        ctx.setLineDash(NODASH);
        var a = 0.35 + 0.5 * (s.t / s.delay);
        drawTile(ctx, cx + Math.sin(s.t * 40) * (s.t / s.delay) * 1.5, cy, 13, s.or, 0, p, p.primary, a, false);
        return;
      }
      AP.R.glow(ctx, cx, cy, 24, p.hazard, 0.25);
      drawTile(ctx, cx, cy, 14, s.or, s.spin * 0.15, p, p.primary, 1, true);
    }
  });

  // ------------------------------------------------------------------ minion: floor shockwave of popping tiles
  AP.Entities.register('w1.shock', {
    kind: 'sensor', w: 26, h: 22, anchor: 'center', layer: 7, lint: 'ignore', renderPad: 48,
    hazard: true,
    init: function (e, spec) {
      var s = e.s;
      s.dir = spec.dir === 'left' ? -1 : 1;
      s.v = Math.max(2, +spec.speed || 7) * 32;
      s.fr = spec.fr | 0;
      s.FY = (s.fr + 1) * 32;
      s.life = 0;
      s.emitT = 0;
      s.lastPop = -1;
      s.ph = 0;
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.life += dt;
      s.ph += dt * s.v / 32;
      e.x += s.dir * s.v * dt;
      var front = s.dir > 0 ? e.x + e.w : e.x;
      var tx = Math.floor(front / 32);
      var code = L.tileAt(tx, s.fr);
      if (solid(code) && tx !== s.lastPop) {
        var B = e.parent;
        if (B && !B.dead && isBlock(B, L, tx)) {
          popBlock(B, L, tx, false);                // the wave pops a settled tile and rolls on
          s.lastPop = tx;
        } else {
          fx('w1.tiles', front, s.FY - 10, 6);
          fx('w1.quake', front, s.FY, 4);
          L.remove(e);
          return;
        }
      }
      s.emitT -= dt;
      if (s.emitT <= 0) {
        s.emitT = 0.045;
        if (L.cam && L.cam.visible(e.x, e.y, e.w, e.h, 32)) fx('w1.quake', e.x + e.w / 2 - s.dir * 6, s.FY, 2);
      }
      if (s.life > 5) L.remove(e);
    },
    render: function (e, ctx, L) {
      var s = e.s, p = pal(L);
      var cx = e.rx + e.w / 2, floorY = s.FY;
      AP.R.glow(ctx, cx, floorY - 10, 22, p.hazard, 0.35);
      // three tile fragments popping up in a travelling bump, the front one highest
      for (var i = 0; i < 3; i++) {
        var off = -s.dir * i * 9;
        var hgt = (16 - i * 4) * (0.75 + 0.25 * Math.abs(Math.sin(s.ph * 3 + i)));
        var x = cx + off, y = floorY - hgt;
        var r = 5.5 - i;
        ctx.fillStyle = rgba(p.primary, 0.35 - i * 0.08);
        ctx.strokeStyle = i === 0 ? p.hazard : rgba(p.hazard, 0.7 - i * 0.2);
        ctx.lineWidth = 2;
        AP.R.poly(ctx, x, y, r, 4, Math.PI / 4 + s.ph * 2 * s.dir + i);
        ctx.fill();
        ctx.stroke();
      }
      // spiky crest
      ctx.fillStyle = p.hazard;
      ctx.beginPath();
      for (var k = 0; k < 4; k++) {
        var bx = e.rx + 2 + k * 6;
        var hh = 6 + 5 * Math.abs(Math.sin(s.ph * 4 + k * 1.3));
        ctx.moveTo(bx, floorY); ctx.lineTo(bx + 3, floorY - hh); ctx.lineTo(bx + 6, floorY);
      }
      ctx.fill();
      ctx.strokeStyle = rgba(p.hazard, 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - s.dir * 30, floorY - 1); ctx.lineTo(cx + s.dir * 4, floorY - 1);
      ctx.stroke();
    }
  });

  // ------------------------------------------------------------------ drawing
  var DASH = [4, 5];
  var NODASH = [];
  var TRUCHET_O = { color: '#fff', width: 1.6, alpha: 0.7, mode: 'arc', rings: 2 };

  // a single Truchet tile centred at (cx, cy), half-size hs; spiky = hazard teeth on its lower edge
  function drawTile(ctx, cx, cy, hs, ori, rot, p, edge, alpha, spiky) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    var c = 4;
    ctx.beginPath();
    ctx.moveTo(-hs + c, -hs); ctx.lineTo(hs - c, -hs); ctx.lineTo(hs, -hs + c); ctx.lineTo(hs, hs - c);
    ctx.lineTo(hs - c, hs); ctx.lineTo(-hs + c, hs); ctx.lineTo(-hs, hs - c); ctx.lineTo(-hs, -hs + c);
    ctx.closePath();
    ctx.fillStyle = rgba(p.bg, 0.8);
    ctx.fill();
    ctx.fillStyle = rgba(edge, 0.16);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = edge;
    ctx.stroke();
    if (AP.Art && AP.Art.truchet) {
      TRUCHET_O.color = p.ink;
      AP.Art.truchet(ctx, -hs, -hs, hs * 2, ori, TRUCHET_O);
    } else {
      ctx.strokeStyle = rgba(p.ink, 0.7);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (ori & 1) { ctx.moveTo(hs, 0); ctx.arc(hs, -hs, hs, Math.PI / 2, Math.PI); ctx.moveTo(-hs, 0); ctx.arc(-hs, hs, hs, -Math.PI / 2, 0); }
      else { ctx.moveTo(0, -hs); ctx.arc(-hs, -hs, hs, 0, Math.PI / 2); ctx.moveTo(0, hs); ctx.arc(hs, hs, hs, Math.PI, Math.PI * 1.5); }
      ctx.stroke();
    }
    if (spiky) {
      ctx.fillStyle = p.hazard;
      ctx.beginPath();
      for (var i = 0; i < 3; i++) {
        var x0 = -hs + 2 + i * (2 * hs - 4) / 3, w = (2 * hs - 4) / 3;
        ctx.moveTo(x0, hs); ctx.lineTo(x0 + w / 2, hs + 7); ctx.lineTo(x0 + w, hs);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  function drawShadow(e, ctx, L, p) {
    var s = e.s;
    var st = s.st;
    var k = 0;
    if (st === 'leap') k = M.clamp((s.t - 0.15) / 0.3, 0, 1) * 0.45;
    else if (st === 'hover') { var cfg = PHASE[s.phase]; k = 0.45 + 0.55 * M.clamp(s.t / cfg.hover, 0, 1); }
    else if (st === 'rebound') k = 0.5;
    else if (st === 'hover2') k = 0.5 + 0.5 * M.clamp(s.t / 0.5, 0, 1);
    else if (st === 'drop') k = 1;
    if (k <= 0) return;
    var cx = e.rx + BW / 2, fy = s.FY;
    var lock = s.locked || st === 'drop';
    var blink = lock ? (0.6 + 0.4 * Math.abs(Math.sin(L.time * 26))) : 1;
    var hw = BW / 2;
    // dark lattice footprint
    ctx.fillStyle = rgba('#000000', 0.25 * k);
    ctx.fillRect(cx - hw, fy - 6, BW, 6);
    ctx.fillStyle = rgba(p.hazard, 0.16 * k * blink);
    ctx.fillRect(cx - hw, fy - 5, BW, 5);
    // spiky edge along the footprint (hazard silhouette) and the drop lines
    ctx.strokeStyle = rgba(p.hazard, (0.45 + 0.5 * k) * blink);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - hw, fy - 1);
    var n = 8;
    for (var i = 0; i < n; i++) {
      var x0 = cx - hw + i * BW / n;
      ctx.lineTo(x0 + BW / n / 2, fy - 5 - 6 * k);
      ctx.lineTo(x0 + BW / n, fy - 1);
    }
    ctx.stroke();
    var top = e.ry + e.h;
    ctx.strokeStyle = rgba(p.hazard, 0.2 + 0.35 * k);
    ctx.lineWidth = 1.5;
    ctx.setLineDash(DASH);
    ctx.beginPath();
    ctx.moveTo(cx - hw + 2, top); ctx.lineTo(cx - hw + 2, fy - 8);
    ctx.moveTo(cx + hw - 2, top); ctx.lineTo(cx + hw - 2, fy - 8);
    ctx.stroke();
    ctx.setLineDash(NODASH);
    // falling chevrons
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(p.hazard, 0.5 * k * blink);
    ctx.beginPath();
    for (var c2 = 0; c2 < 2; c2++) {
      var yy = fy - 34 - c2 * 14 + ((L.time * 60) % 14);
      ctx.moveTo(cx - 8, yy - 6); ctx.lineTo(cx, yy); ctx.lineTo(cx + 8, yy - 6);
    }
    ctx.stroke();
    AP.R.glow(ctx, cx, fy - 4, 40, p.hazard, 0.18 * k * blink);
  }

  function drawFlip(e, ctx, L, p) {
    var s = e.s;
    if (!s.flipSt || !s.flipN) return;
    var fy = s.FY, i, x;
    if (s.flipSt === 'tele') {
      var k = M.clamp(s.flipT / FLIP_TELE, 0, 1);
      var blink = 0.55 + 0.45 * Math.abs(Math.sin(s.flipT * (8 + 14 * k)));
      ctx.fillStyle = rgba(p.hazard, (0.06 + 0.14 * k) * blink);
      ctx.strokeStyle = rgba(p.hazard, (0.35 + 0.55 * k) * blink);
      ctx.lineWidth = 1.5;
      for (i = 0; i < s.flipN; i++) {
        x = s.flip[i] * 32;
        ctx.fillRect(x + 1, fy - 32 * k * 0.5, 30, 32 * k * 0.5);
        ctx.beginPath();
        var hgt = 4 + 10 * k;
        ctx.moveTo(x + 3, fy); ctx.lineTo(x + 9.5, fy - hgt); ctx.lineTo(x + 16, fy);
        ctx.lineTo(x + 22.5, fy - hgt); ctx.lineTo(x + 29, fy);
        ctx.stroke();
      }
    } else if (s.flipSt === 'on') {
      var rem = FLIP_ON - s.flipT;
      if (rem < 0.45 && Math.sin(rem * 40) < 0) return;    // flicker: about to retract
      ctx.fillStyle = rgba(p.hazard, 0.08 + 0.06 * beatPulse());
      for (i = 0; i < s.flipN; i++) ctx.fillRect(s.flip[i] * 32, fy - 30, 32, 30);
    }
  }

  var BODY_P = [0, 0];
  // tile layout of the golem in local space (origin at the bottom-centre of the body)
  function tilePos(i, kneel, out) {
    var ci = i % 3, ri = (i / 3) | 0;
    var x = (ci - 1) * 32;
    var y;
    if (!kneel) y = -96 + ri * 32 + 16;
    else y = ri === 0 ? -48 : (ri === 1 ? -16 : -6);
    out[0] = x; out[1] = y;
    return out;
  }

  function drawBoss(e, ctx, L) {
    var s = e.s, p = pal(L);
    var st = s.st;
    if (st === 'dead') return;
    if (st === 'dying') { drawParts(e, ctx, L, p); return; }
    drawFlip(e, ctx, L, p);
    drawShadow(e, ctx, L, p);
    var cfg = PHASE[s.phase];
    var cx = e.rx + BW / 2, by = e.ry + e.h;
    var bp = beatPulse();
    var tint = AP.Color.mix(p.primary, p.hazard, cfg.tint);
    var edge = s.flash > 0 ? AP.Color.mix(tint, p.ink, s.flash) : tint;
    var stunned = st === 'stun';
    var asm = (st === 'sleep') ? 0 : ((st === 'wake' || st === 'reform') ? s.asm : 1);
    // squash and stretch
    var q = s.sqT;
    var sx = 1 + (q < 0 ? -q * 0.35 : -q * 0.18) + 0.02 * bp;
    var sy = 1 + (q < 0 ? q * 0.32 : q * 0.25) - 0.015 * bp;
    if (st === 'crouch') { var ck = M.clamp(s.t / 0.32, 0, 1); sx += 0.12 * ck; sy -= 0.16 * ck; }
    if (asm > 0.2) AP.R.glow(ctx, cx, by - (s.kneel ? 32 : 48), 48, stunned ? p.accent : tint, (0.18 + 0.1 * bp) * asm);
    ctx.save();
    ctx.translate(cx, by);
    ctx.scale(sx, sy);
    var face = s.face;
    // side spikes (hazard silhouette) — retract while harmless
    var spk = e.hazard ? 1 : 0.25;
    if (asm > 0.6) {
      ctx.fillStyle = p.hazard;
      ctx.beginPath();
      var rows = s.kneel ? 2 : 3;
      for (var r = 0; r < rows; r++) {
        var yy = (s.kneel ? -48 : -80) + r * 32;
        var len = (6 + 2 * bp) * spk * asm;
        ctx.moveTo(-48, yy - 7); ctx.lineTo(-48 - len, yy); ctx.lineTo(-48, yy + 7);
        ctx.moveTo(48, yy - 7); ctx.lineTo(48 + len, yy); ctx.lineTo(48, yy + 7);
      }
      // crown spikes flanking the core: gone while the weak point is open
      if (!stunned) {
        var top = s.kneel ? -64 : -96;
        var cl = (7 + 2 * bp) * spk * asm;
        ctx.moveTo(-30, top); ctx.lineTo(-24, top - cl); ctx.lineTo(-18, top);
        ctx.moveTo(18, top); ctx.lineTo(24, top - cl); ctx.lineTo(30, top);
        ctx.moveTo(-6, top); ctx.lineTo(0, top - cl * 0.7); ctx.lineTo(6, top);
      }
      ctx.fill();
    }
    // the nine tiles
    for (var i = 0; i < 9; i++) {
      if (s.kneel && i >= 6) continue;
      tilePos(i, s.kneel, BODY_P);
      var tx = BODY_P[0], ty = BODY_P[1];
      var rot = 0, a = 1;
      if (asm < 1) {
        // scattered pile -> assembled (staggered, overshooting)
        var st0 = (i * 0.07);
        var kk = M.ease.outBack(M.clamp((asm - st0) / (1 - 0.56), 0, 1));
        var pxp = ((i * 37) % 9 - 4) * 14, pyp = -15 - ((i * 13) % 3 === 2 ? 22 : 0);
        tx = M.lerp(pxp, tx, kk); ty = M.lerp(pyp, ty, kk);
        rot = (1 - kk) * (((i * 53) % 7) - 3) * 0.5;
        a = 0.35 + 0.65 * M.clamp(asm * 1.5, 0, 1);
      }
      var tr = s.trot[i];
      if (tr > 0) rot -= (1 - M.ease.outCubic(1 - tr)) * Math.PI / 2;
      drawTile(ctx, tx, ty, 15, s.ori[i], rot, p, edge, a, false);
      if (i < s.cracks && AP.Art && AP.Art.crack && asm >= 1) AP.Art.crack(ctx, tx - 14, ty - 14, 28, 28, i * 7 + 3, p.hazard, 1.2);
    }
    if (s.kneel) {
      // folded legs
      ctx.fillStyle = rgba(edge, 0.25);
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2;
      for (var lg = -1; lg <= 1; lg += 2) {
        ctx.beginPath();
        ctx.moveTo(lg * 30, 0); ctx.lineTo(lg * 58, 0); ctx.lineTo(lg * 50, -10); ctx.lineTo(lg * 30, -10);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    }
    if (asm >= 0.8) {
      var topY = s.kneel ? -64 : -96;
      // the core: dim when guarded, bright accent when open (the damage telegraph)
      var coreY = topY + 14;
      if (stunned) {
        var pulse = 0.6 + 0.4 * Math.abs(Math.sin(s.t * 9));
        ctx.restore();
        AP.R.glow(ctx, cx, by + coreY * sy, 30 + 8 * pulse, p.accent, 0.75 * pulse);
        ctx.save();
        ctx.translate(cx, by);
        ctx.scale(sx, sy);
        ctx.fillStyle = rgba(p.accent, 0.55 + 0.35 * pulse);
        AP.R.poly(ctx, 0, coreY, 9 + 2 * pulse, 6, s.t * 2);
        ctx.fill();
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 2;
        ctx.stroke();
        // stomp-here chevrons
        ctx.strokeStyle = rgba(p.accent, 0.9);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (var ch = 0; ch < 2; ch++) {
          var cyy = topY - 18 - ch * 12 + ((s.t * 30) % 12);
          ctx.moveTo(-9, cyy - 7); ctx.lineTo(0, cyy); ctx.lineTo(9, cyy - 7);
        }
        ctx.stroke();
        // dizzy orbit of accent dots
        ctx.fillStyle = p.accent;
        for (var dz = 0; dz < 3; dz++) {
          var da = s.t * 5 + dz * TAU / 3;
          ctx.beginPath();
          ctx.arc(Math.cos(da) * 26, topY - 6 + Math.sin(da) * 6, 2.4, 0, TAU);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = rgba(p.hazard, 0.3);
        AP.R.poly(ctx, 0, coreY, 8, 6, 0);
        ctx.fill();
        ctx.strokeStyle = rgba(edge, 0.9);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // eyes on the middle tile, looking at the player
      var eyY = s.kneel ? -26 : -50;
      var look = face * 3;
      if (stunned) {
        ctx.strokeStyle = rgba(p.ink, 0.8);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-12, eyY - 3); ctx.lineTo(-6, eyY + 3); ctx.moveTo(-6, eyY - 3); ctx.lineTo(-12, eyY + 3);
        ctx.moveTo(6, eyY - 3); ctx.lineTo(12, eyY + 3); ctx.moveTo(12, eyY - 3); ctx.lineTo(6, eyY + 3);
        ctx.stroke();
      } else {
        var glare = st === 'hover' || st === 'hover2' || st === 'drop' || st === 'crouch';
        ctx.fillStyle = glare ? p.hazard : p.ink;
        ctx.beginPath();
        ctx.moveTo(-14 + look, eyY - 4); ctx.lineTo(-4 + look, eyY - 1); ctx.lineTo(-12 + look, eyY + 4);
        ctx.closePath();
        ctx.moveTo(14 + look, eyY - 4); ctx.lineTo(4 + look, eyY - 1); ctx.lineTo(12 + look, eyY + 4);
        ctx.closePath();
        ctx.fill();
      }
      // raised arms while it calls the rain or holds the floor flip
      if (st === 'rain' || st === 'flip') {
        var up = M.clamp(s.t / 0.4, 0, 1);
        ctx.strokeStyle = edge;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (var am = -1; am <= 1; am += 2) {
          var ax = am * 48, ay = -64;
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax + am * 16, ay - 26 * up);
          ctx.lineTo(ax + am * 10, ay - 46 * up);
        }
        ctx.stroke();
        ctx.fillStyle = rgba(st === 'flip' ? p.hazard : p.primary, 0.6 + 0.4 * bp);
        for (var am2 = -1; am2 <= 1; am2 += 2) {
          AP.R.poly(ctx, am2 * 58, -64 - 46 * up, 5, 4, L.time * 3);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function drawParts(e, ctx, L, p) {
    var s = e.s;
    var a = M.clamp(1 - (s.t - 1.4) / 1.4, 0, 1);
    if (a <= 0) return;
    for (var i = 0; i < 9; i++) {
      drawTile(ctx, s.partX[i], s.partY[i], 14, s.ori[i], s.partA[i], p, AP.Color.mix(p.primary, p.accent, 0.3), a, false);
    }
    if (s.t < 0.6) AP.R.glow(ctx, s.bx, s.by - 48, 48, p.ink, (0.6 - s.t) * 1.2);
  }
})(window.AP = window.AP || {});
