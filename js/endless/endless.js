/* js/endless/endless.js — owner: W1 */
(function (AP) {
  'use strict';

  // Scene 'endless' (CONTRACT section 2.20, DESIGN section 9): "Apeiron", an endless run of generated segments.
  //   enter({seed}) or enter({daily: true}) starts a run at once; enter({}) opens the lobby (daily, random seed,
  //   typed seed); enter({results: true}) shows the last run's results.
  //   Each segment runs through go('level', {level, mode: 'endless', onComplete, onQuit}).
  //   Lives: 3; each death costs one (deaths the engine counts, so assist invincibility costs nothing); every 3
  //   cleared segments give one back, up to 5. At 0 lives the run ends.
  //   Score = segments x 1000 + shards x 10 + a time bonus (25 points per second under each segment's par).
  //   Persists AP.Save.data.endless {best, bestSeed, runs, daily{'YYYY-MM-DD': {score, segments, seed}}}.
  //   Emits 'endless:segment' {seed, segment, style} as each segment starts (segment = segments cleared so far) and
  //   'endless:end' {seed, segments, time, deaths, score} when a run ends (game over or quit).
  // Entity 'endless.ctl' (added to every generated segment): watches L.stats.deaths for the run, draws the
  //   segment banner and the lives/score panel (bottom-left, screen space), and ends the run at 0 lives.
  var M = AP.M;
  var TAU = Math.PI * 2;
  var LIVES0 = 3, LIVES_MAX = 5;

  var run = null;          // the active run
  var lastRun = null;      // summary of the last finished run (results screen)
  var rollN = 0;

  function E() { return AP.Endless || null; }
  function pal(key) { return (AP.Worlds && AP.Worlds.pal) ? AP.Worlds.pal(key || 'endless') : AP.R.pal(key || 'endless'); }
  function rgba(c, a) { return AP.Color.rgba(c, a); }
  function save() { return (AP.Save && AP.Save.data) ? AP.Save.data : null; }

  function rollSeed() {
    rollN++;
    var t = AP.Time ? Math.floor((AP.Time.now || 0) * 1000) : 0;
    var f = AP.Time ? (AP.Time.frame | 0) : 0;
    return AP.hash2(t, rollN * 7919 + f, 0xA9E1) % 100000000;
  }

  function diffFor(segment) { return Math.min(1, segment / 10); }

  function stroke(ctx, str, x, y, o) {
    if (AP.UI && typeof AP.UI.strokeText === 'function') {
      try { AP.UI.strokeText(ctx, str, x, y, o); return; } catch (e) { /* fall back to the UI font */ }
    }
    TXT.size = Math.round((o.size || 32) * 0.9);
    TXT.color = o.color || '#FFFFFF';
    TXT.align = o.align || 'left';
    TXT.alpha = o.alpha === undefined ? 1 : o.alpha;
    TXT.weight = '300';
    AP.R.text(ctx, String(str), x, y, TXT);
  }
  var TXT = { size: 16, color: '#fff', align: 'left', baseline: 'middle', weight: '600', alpha: 1 };
  function text(ctx, str, x, y, size, color, align, alpha, weight) {
    TXT.size = size; TXT.color = color; TXT.align = align || 'left'; TXT.alpha = alpha === undefined ? 1 : alpha;
    TXT.weight = weight || '600';
    AP.R.text(ctx, str, x, y, TXT);
  }

  function fmtScore(n) {
    var s = String(Math.max(0, Math.round(n)));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  // ------------------------------------------------------------------ run lifecycle
  function startRun(seed, daily) {
    var Ex = E();
    run = {
      seed: (seed >>> 0) % 100000000, daily: !!daily, dateKey: Ex && Ex.dateKey ? Ex.dateKey() : '',
      segment: 0, segments: 0, lives: LIVES0, score: 0, shards: 0, deaths: 0, time: 0,
      active: true, over: false, overT: -1, assisted: false,
      lastGain: 0, lastBonus: 0, lifeGained: false, levelId: '', style: 'w1', par: 0, level: null
    };
    Scene.st = 'intro';
    Scene.t = 0;
    AP.sfx('uiSelect');
  }

  function launchSegment() {
    var Ex = E();
    if (!run || !Ex || typeof Ex.generate !== 'function') return false;
    var lvl = Ex.generate(run.seed, run.segment, { difficulty: diffFor(run.segment) });
    if (!lvl) return false;
    run.level = lvl;
    run.levelId = lvl.id;
    run.style = lvl.style;
    run.par = lvl.par || 60;
    if (AP.Events) AP.Events.emit('endless:segment', { seed: run.seed, segment: run.segment, style: lvl.style });
    AP.Scenes.go('level', { level: lvl, mode: 'endless', onComplete: onSegmentComplete, onQuit: onQuit }, { fx: 'iris', dur: 0.7 });
    return true;
  }

  function onSegmentComplete(res) {
    if (!run || !run.active) return;
    res = res || {};
    var t = +res.time || 0;
    var bonus = Math.max(0, Math.round((run.par - t) * 25));
    var gain = 1000 + (res.shards | 0) * 10 + bonus;
    run.score += gain;
    run.shards += res.shards | 0;
    run.time += t;
    run.segments++;
    run.segment++;
    run.lastGain = gain;
    run.lastBonus = bonus;
    if (res.assisted) run.assisted = true;
    run.lifeGained = false;
    if (run.segments % 3 === 0 && run.lives < LIVES_MAX) { run.lives++; run.lifeGained = true; }
    launchSegment();
  }

  function onQuit() {
    if (run && run.active) endRun(AP.level, 'quit');
    else AP.Scenes.go('endless', { results: !!lastRun }, { fx: 'fade', dur: 0.6 });
  }

  // a death the engine counted (the controller calls this)
  function loseLife(L, n) {
    if (!run || !run.active) return;
    run.deaths += n;
    run.lives = Math.max(0, run.lives - n);
    if (run.lives <= 0) {
      run.over = true;
      run.overT = 0;
    }
  }

  function endRun(L, why) {
    if (!run) return;
    var r = run;
    r.active = false;
    if (L && L.id === r.levelId) {
      r.time += L.time || 0;
      r.shards += (L.stats && L.stats.shards) | 0;
      r.score += ((L.stats && L.stats.shards) | 0) * 10;
    }
    var d = save();
    var newBest = false;
    if (d && d.endless) {
      d.endless.runs = (d.endless.runs | 0) + 1;
      if (!r.assisted && r.score > (d.endless.best | 0)) { d.endless.best = r.score; d.endless.bestSeed = r.seed; newBest = true; }
      if (r.daily && r.dateKey) {
        var dd = d.endless.daily || (d.endless.daily = {});
        var prev = dd[r.dateKey];
        if (!r.assisted && (!prev || (prev.score | 0) < r.score)) dd[r.dateKey] = { score: r.score, segments: r.segments, seed: r.seed };
        // keep the last 30 days only
        var keys = Object.keys(dd).sort();
        while (keys.length > 30) { delete dd[keys.shift()]; }
      }
      if (AP.Save && AP.Save.save) AP.Save.save(true);
    }
    lastRun = {
      seed: r.seed, daily: r.daily, dateKey: r.dateKey, segments: r.segments, score: r.score, time: r.time,
      deaths: r.deaths, shards: r.shards, why: why, newBest: newBest, assisted: r.assisted,
      best: d && d.endless ? d.endless.best | 0 : r.score, style: r.style
    };
    if (AP.Events) AP.Events.emit('endless:end', { seed: r.seed, segments: r.segments, time: r.time, deaths: r.deaths, score: r.score });
    run = null;
    AP.Scenes.go('endless', { results: true }, { fx: why === 'quit' ? 'fade' : 'shatter', dur: why === 'quit' ? 0.6 : 1.1 });
  }

  // ------------------------------------------------------------------ in-level controller
  AP.Entities.register('endless.ctl', {
    kind: 'sensor', w: 32, h: 32, anchor: 'tile', layer: 100, lint: 'ignore', alwaysRender: true, renderPad: 0,
    init: function (e, spec, L) {
      var s = e.s;
      s.deaths = L && L.stats ? L.stats.deaths : 0;
      s.t = 0;
      s.flash = 0;
      s.lifeFx = 0;
      s.bound = !!(run && run.active && L && run.levelId === L.id);
    },
    update: function (e, dt, L) {
      var s = e.s;
      s.t += dt;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 1.5);
      if (!s.bound || !run) return;
      if (run.active && L.stats.deaths > s.deaths) {
        var n = L.stats.deaths - s.deaths;
        s.deaths = L.stats.deaths;
        loseLife(L, n);
        s.flash = 1;
        if (run.over) AP.sfx('uiDeny', { vol: 0.8, pitch: 0.7 });
      }
      if (run.over && run.overT >= 0) {
        run.overT += dt;
        if (run.overT >= 0.75 && run.active) endRun(L, 'over');
      }
    },
    render: function (e, ctx, L) {
      if (!e.s.bound) return;
      var r = run || null;
      ctx.save();
      AP.R.begin(ctx);
      drawPanel(e, ctx, L, r);
      drawBanner(e, ctx, L, r);
      ctx.restore();
    }
  });

  function drawPanel(e, ctx, L, r) {
    var p = L.pal;
    var s = e.s;
    var lives = r ? r.lives : (lastRun ? 0 : LIVES0);
    var x = 22, y = 512;
    // lives: small Circle glyphs (Endless is the boundless form); lost ones are hollow ghosts
    for (var i = 0; i < LIVES_MAX; i++) {
      var have = i < lives;
      if (!have && i >= LIVES0 && (!r || i >= Math.max(LIVES0, lives))) continue;
      var cx = x + i * 20;
      var pulse = have && s.flash > 0 && i === lives ? s.flash : 0;
      ctx.beginPath();
      ctx.arc(cx, y, 6.5, 0, TAU);
      ctx.fillStyle = have ? rgba(p.accent, 0.45) : rgba(p.ink, 0.06);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = have ? p.ink : rgba(p.ink, 0.3);
      ctx.stroke();
      if (pulse > 0) AP.R.glow(ctx, cx, y, 18, p.hazard, pulse);
    }
    if (s.flash > 0 && r) {
      // the life that was just lost breaks apart
      var lx = x + lives * 20, k = 1 - s.flash;
      ctx.strokeStyle = rgba(p.hazard, s.flash);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var j = 0; j < 4; j++) {
        var a = j * TAU / 4 + 0.4;
        ctx.moveTo(lx + Math.cos(a) * (6 + 10 * k), y + Math.sin(a) * (6 + 10 * k));
        ctx.lineTo(lx + Math.cos(a) * (10 + 14 * k), y + Math.sin(a) * (10 + 14 * k));
      }
      ctx.stroke();
    }
    var score = r ? r.score : 0;
    text(ctx, fmtScore(score), 22, 488, 17, p.ink, 'left', 0.92, '700');
    text(ctx, 'SEGMENT ' + ((r ? r.segment : 0) + 1) + (r && r.daily ? '  ·  DAILY' : ''), 22, 466, 11, rgba(p.ink, 0.6), 'left', 1, '700');
  }

  // the run tally under the level's name card (the HUD already names the segment): the last segment's score,
  // its time bonus, an extra life, or the seed on the first segment
  function drawBanner(e, ctx, L, r) {
    var t = e.s.t;
    if (t > 3.6 || !r) return;
    var p = L.pal;
    var a = M.clamp((t - 0.25) / 0.35, 0, 1) * M.clamp((3.6 - t) / 0.6, 0, 1);
    if (a <= 0) return;
    var cy = 214;
    ctx.globalAlpha = a;
    var wk = M.ease.outCubic(M.clamp((t - 0.25) / 0.7, 0, 1));
    ctx.strokeStyle = rgba(p.accent, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(480 - 120 * wk, cy - 22); ctx.lineTo(480 + 120 * wk, cy - 22);
    ctx.stroke();
    if (r.segments > 0 && r.lastGain > 0) {
      // the gain counts up
      var ck = M.ease.outCubic(M.clamp((t - 0.3) / 0.9, 0, 1));
      text(ctx, '+' + fmtScore(r.lastGain * ck), 480, cy, 22, p.accent, 'center', 1, '800');
      var sub = 'SEGMENT ' + r.segments + ' CLEAR' + (r.lastBonus > 0 ? '   ·   TIME +' + fmtScore(r.lastBonus) : '');
      text(ctx, sub, 480, cy + 24, 11, rgba(p.ink, 0.7), 'center', 1, '700');
    } else {
      text(ctx, (r.daily ? 'DAILY  ' + r.dateKey : 'SEED  ' + r.seed), 480, cy, 15, rgba(p.ink, 0.85), 'center', 1, '700');
      text(ctx, LIVES0 + ' LIVES  ·  ONE MORE EVERY THIRD SEGMENT', 480, cy + 22, 11, rgba(p.ink, 0.6), 'center', 1, '700');
    }
    if (r.lifeGained) {
      var lk = M.clamp((t - 0.8) / 0.4, 0, 1);
      text(ctx, 'LIFE +1', 480, cy + 46, 14, p.ink, 'center', lk * (0.6 + 0.4 * Math.abs(Math.sin(t * 6))), '800');
      if (lk > 0) AP.R.glow(ctx, 480, cy + 46, 30, p.accent, 0.25 * lk);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ the scene
  var LOBBY = ['daily', 'random', 'seed', 'back'];
  var RESULTS = ['retry', 'new', 'quit'];

  var Scene = {
    st: 'lobby',
    t: 0,
    sel: 0,
    seedText: '',
    offKey: null,
    countT: 0,
    bg: function () { return { key: 'endless', camX: Scene.t * 22, camY: Math.sin(Scene.t * 0.2) * 40, intensity: Scene.st === 'results' ? 0.35 : 0.55, t: Scene.t }; },

    enter: function (params) {
      params = params || {};
      Scene.t = 0;
      Scene.sel = 0;
      Scene.countT = 0;
      if (params.results && lastRun) {
        Scene.st = 'results';
        AP.music('map');
      } else if (params.seed !== undefined && params.seed !== null && isFinite(+params.seed)) {
        startRun(+params.seed, false);
      } else if (params.daily) {
        var Ex = E();
        startRun(Ex && Ex.dailySeed ? Ex.dailySeed() : 1, true);
      } else {
        Scene.st = 'lobby';
        Scene.seedText = String(rollSeed());
        AP.music('endless');
      }
      if (AP.Input && AP.Input.onKey && !Scene.offKey) Scene.offKey = AP.Input.onKey(Scene.onKey);
    },

    exit: function () {
      if (Scene.offKey) { AP.guard('endless.offKey', Scene.offKey); Scene.offKey = null; }
    },

    // digits typed while the seed row is selected edit the seed
    onKey: function (code) {
      if (Scene.st !== 'lobby' || LOBBY[Scene.sel] !== 'seed' || AP.Scenes.current !== 'endless') return false;
      var m = /^(Digit|Numpad)(\d)$/.exec(code || '');
      if (m) {
        if (Scene.seedText.length >= 8 || Scene.seedText === '0') Scene.seedText = Scene.seedText === '0' ? '' : Scene.seedText.slice(1);
        Scene.seedText += m[2];
        AP.sfx('type');
        return true;
      }
      if (code === 'Backspace') {
        Scene.seedText = Scene.seedText.slice(0, -1);
        if (!Scene.seedText) Scene.seedText = '0';
        AP.sfx('type', { pitch: 0.8 });
        return true;
      }
      return false;
    },

    update: function (dt) {
      Scene.t += dt;
      var I = AP.Input;
      if (Scene.st === 'intro') {
        Scene.countT += dt;
        if (Scene.countT >= 1.3 || (Scene.countT > 0.3 && (I.pressed('confirm') || I.pressed('jump')))) {
          Scene.st = 'launch';
          if (!launchSegment()) { Scene.st = 'lobby'; AP.sfx('uiDeny'); }
        } else if (I.pressed('back')) {
          run = null;
          Scene.st = 'lobby';
          Scene.seedText = String(rollSeed());
          AP.sfx('uiBack');
        }
        return;
      }
      if (Scene.st === 'launch') return;
      var items = Scene.st === 'results' ? RESULTS : LOBBY;
      if (I.repeat('up')) { Scene.sel = (Scene.sel + items.length - 1) % items.length; AP.sfx('uiMove'); }
      if (I.repeat('down')) { Scene.sel = (Scene.sel + 1) % items.length; AP.sfx('uiMove'); }
      if (Scene.st === 'lobby' && LOBBY[Scene.sel] === 'seed' && (I.repeat('left') || I.repeat('right'))) {
        Scene.seedText = String(rollSeed());
        AP.sfx('uiMove', { pitch: 1.2 });
      }
      if (I.pressed('back')) {
        AP.sfx('uiBack');
        AP.Scenes.go('title', {}, { fx: 'fade', dur: 0.5 });
        return;
      }
      if (I.pressed('confirm')) {
        var it = items[Scene.sel];
        var Ex = E();
        if (it === 'daily') startRun(Ex && Ex.dailySeed ? Ex.dailySeed() : 1, true);
        else if (it === 'random') startRun(rollSeed(), false);
        else if (it === 'seed') startRun(+Scene.seedText || 0, false);
        else if (it === 'retry' && lastRun) startRun(lastRun.seed, lastRun.daily);
        else if (it === 'new') startRun(rollSeed(), false);
        else { AP.sfx('uiBack'); AP.Scenes.go('title', {}, { fx: 'fade', dur: 0.5 }); }
      }
    },

    render: function (ctx) {
      var p = pal('endless');
      AP.R.begin(ctx);
      // vignette so text reads over the shader
      ctx.fillStyle = rgba(p.bg, 0.45);
      ctx.fillRect(0, 0, 960, 540);
      drawEmblem(ctx, p, Scene.t);
      if (Scene.st === 'lobby') drawLobby(ctx, p);
      else if (Scene.st === 'intro' || Scene.st === 'launch') drawIntro(ctx, p);
      else if (Scene.st === 'results') drawResults(ctx, p);
    }
  };

  // the emblem: a circle (infinitely many sides) traced by an orbiting polygon that gains vertices
  function drawEmblem(ctx, p, t) {
    var cx = 480, cy = 150, r = 54;
    var sides = 3 + (Math.floor(t * 0.8) % 6);
    AP.R.glow(ctx, cx, cy, 48, p.accent, 0.35);
    ctx.strokeStyle = rgba(p.ink, 0.85);
    ctx.lineWidth = 2.5;
    AP.R.poly(ctx, cx, cy, r, 48, 0);
    ctx.stroke();
    ctx.strokeStyle = rgba(p.accent, 0.8);
    ctx.lineWidth = 1.5;
    AP.R.poly(ctx, cx, cy, r * 0.72, sides >= 8 ? 48 : sides, t * 0.6);
    ctx.stroke();
    // infinity lemniscate in the middle
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var j = 0; j <= 48; j++) {
      var u = j / 48 * TAU, d = 1 + Math.sin(u) * Math.sin(u);
      var lx = cx + 24 * Math.cos(u) / d, ly = cy + 24 * Math.sin(u) * Math.cos(u) / d;
      if (j === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    for (var k = 0; k < 6; k++) {
      var a = t * 0.9 + k * TAU / 6;
      ctx.fillStyle = k % 2 ? p.accent : p.ink;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * (r + 12), cy + Math.sin(a) * (r + 12), 2.2, 0, TAU);
      ctx.fill();
    }
  }

  function drawMenu(ctx, p, labels, y0, gap) {
    gap = gap || 40;
    for (var i = 0; i < labels.length; i++) {
      var sel = i === Scene.sel;
      var y = y0 + i * gap;
      if (sel) {
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 2;
        AP.R.poly(ctx, 330, y, 7, 3, Scene.t * 2.4);
        ctx.stroke();
        ctx.fillStyle = rgba(p.accent, 0.08);
        ctx.fillRect(300, y - gap * 0.42, 360, gap * 0.84);
      }
      text(ctx, labels[i], 352, y, 19, sel ? p.ink : rgba(p.ink, 0.62), 'left', 1, sel ? '700' : '600');
    }
  }

  function drawLobby(ctx, p) {
    var d = save();
    var Ex = E();
    stroke(ctx, 'ENDLESS', 480, 252, { size: 34, color: p.ink, align: 'center', glow: p.accent, progress: M.clamp(Scene.t / 1.2, 0, 1) });
    text(ctx, 'APEIRON  ·  every segment is drawn from a seed', 480, 284, 13, rgba(p.ink, 0.6), 'center', 1, '600');
    var dk = Ex && Ex.dateKey ? Ex.dateKey() : '';
    var dailyBest = d && d.endless && d.endless.daily && d.endless.daily[dk] ? d.endless.daily[dk].score : 0;
    var labels = [
      'Daily run  ' + dk + (dailyBest ? '   best ' + fmtScore(dailyBest) : ''),
      'Random seed',
      'Seed  ' + Scene.seedText + (LOBBY[Scene.sel] === 'seed' ? (Math.floor(Scene.t * 2) % 2 ? '_' : ' ') + '   ( type digits, ← → roll )' : ''),
      'Back'
    ];
    drawMenu(ctx, p, labels, 330);
    if (d && d.endless) {
      text(ctx, 'Best ' + fmtScore(d.endless.best | 0) + (d.endless.best ? '  (seed ' + d.endless.bestSeed + ')' : '') + '   ·   runs ' + (d.endless.runs | 0),
        480, 508, 13, rgba(p.ink, 0.55), 'center', 1, '600');
    }
  }

  function drawIntro(ctx, p) {
    var r = run;
    var k = M.clamp(Scene.countT / 0.5, 0, 1);
    stroke(ctx, r && r.daily ? 'DAILY RUN' : 'NEW RUN', 480, 262, { size: 30, color: p.ink, align: 'center', glow: p.accent, progress: M.clamp(Scene.countT / 0.8, 0, 1) });
    if (!r) return;
    text(ctx, 'SEED ' + r.seed + (r.daily ? '   ·   ' + r.dateKey : ''), 480, 302, 15, rgba(p.ink, 0.75 * k), 'center', 1, '700');
    // three lives assemble
    for (var i = 0; i < LIVES0; i++) {
      var a = M.clamp((Scene.countT - 0.25 - i * 0.15) / 0.3, 0, 1);
      if (a <= 0) continue;
      var cx = 460 + (i - 1) * 26;
      ctx.beginPath();
      ctx.arc(cx + 20, 344, 8 * M.ease.outBack(a), 0, TAU);
      ctx.fillStyle = rgba(p.accent, 0.4 * a);
      ctx.fill();
      ctx.strokeStyle = rgba(p.ink, a);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    text(ctx, 'Three lives. One more every third segment.', 480, 384, 13, rgba(p.ink, 0.55 * k), 'center', 1, '600');
  }

  function drawResults(ctx, p) {
    var r = lastRun;
    if (!r) return;
    var t = Scene.t;
    stroke(ctx, r.why === 'quit' ? 'RUN ENDED' : 'GAME OVER', 480, 250, { size: 30, color: p.ink, align: 'center', glow: r.why === 'quit' ? p.accent : p.hazard, progress: M.clamp(t / 1, 0, 1) });
    var rows = [
      ['Segments', String(r.segments)],
      ['Score', fmtScore(r.score)],
      ['Time', AP.R.fmtTime ? AP.R.fmtTime(r.time) : (Math.round(r.time) + ' s')],
      ['Deaths', String(r.deaths)],
      ['Best', fmtScore(Math.max(r.best, r.score))]
    ];
    for (var i = 0; i < rows.length; i++) {
      var a = M.clamp((t - 0.35 - i * 0.12) / 0.3, 0, 1);
      var y = 282 + i * 24;
      text(ctx, rows[i][0], 380, y, 15, rgba(p.ink, 0.62), 'left', a, '600');
      text(ctx, rows[i][1], 580, y, 16, i === 1 ? p.accent : p.ink, 'right', a, '700');
    }
    text(ctx, 'SEED ' + r.seed + (r.daily ? '  ·  DAILY ' + r.dateKey : '') + (r.assisted ? '  ·  ASSISTED' : ''), 480, 410, 12, rgba(p.ink, 0.5), 'center', 1, '700');
    if (r.newBest) {
      // the "new best" flourish: a ring of vertices that keeps gaining sides
      var nk = M.clamp((t - 1) / 0.5, 0, 1);
      if (nk > 0) {
        var sides = 3 + Math.floor(t * 2) % 6;
        ctx.strokeStyle = rgba(p.accent, nk);
        ctx.lineWidth = 2;
        AP.R.poly(ctx, 650, 318, 18 + 3 * Math.sin(t * 5), sides, t);
        ctx.stroke();
        AP.R.glow(ctx, 650, 318, 30, p.accent, 0.5 * nk);
        text(ctx, 'NEW BEST', 650, 350, 13, p.accent, 'center', nk, '800');
      }
    }
    drawMenu(ctx, p, ['Retry this seed', 'New seed', 'Quit'], 446, 32);
  }

  AP.Scenes.register('endless', Scene);
})(window.AP = window.AP || {});
