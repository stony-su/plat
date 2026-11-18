/* js/core/loop.js — owner: CORE */
(function (AP) {
  'use strict';

  var C = AP.C;
  var STEP = C.STEP;

  // now: real seconds since boot (unscaled; UI animation clock) ; game: simulated seconds (sum of steps)
  // step: fixed steps run ; frame: frames rendered ; alpha: interpolation 0..1 ; scale: time scale
  var Time = AP.Time = { now: 0, game: 0, step: 0, frame: 0, alpha: 0, scale: 1, dt: 0 };

  var acc = 0;
  var last = -1;
  var running = false;
  var rafId = 0;
  var raf = null;
  var caf = null;

  // assist speed applies only while the 'level' scene is on top of the stack
  function computeScale() {
    var S = AP.Scenes;
    if (!S || S.current !== 'level') return 1;
    var save = AP.Save && AP.Save.data && AP.Save.data.settings;
    var as = save && save.assist;
    if (!as || !as.on) return 1;
    var sp = +as.speed;
    return (sp > 0.05 && sp <= 1) ? sp : 1;
  }

  function tick() {
    AP.Input.update(STEP);
    AP.Beat.update(STEP);
    if (AP.Scenes) AP.Scenes.update(STEP);
    Time.step++;
    Time.game += STEP;
  }

  var perf = { fps: 60, frameMs: 16.7, updMs: 0, renMs: 0, steps: 0 };

  function render() {
    var t0 = AP.clock();
    if (AP.Scenes) AP.Scenes.render();
    perf.renMs += ((AP.clock() - t0) - perf.renMs) * 0.1;
    Time.frame++;
    AP.call('Audio.tick');
  }

  function frame(ts) {
    if (!running) return;
    rafId = raf(frame);
    var elapsedRaw = last < 0 ? STEP : (ts - last) / 1000;
    last = ts;
    if (!(elapsedRaw >= 0)) elapsedRaw = 0;
    var elapsed = Math.min(elapsedRaw, C.MAX_FRAME_DT);
    Time.dt = elapsed;
    Time.now += elapsed;
    Time.scale = computeScale();
    acc += elapsed * Time.scale;
    var steps = 0;
    var t0 = AP.clock();
    while (acc >= STEP && steps < C.MAX_STEPS) {
      try {
        tick();
      } catch (e) {
        AP.reportError('Loop.tick', e);
      }
      acc -= STEP;
      steps++;
    }
    if (acc >= STEP) acc = acc % STEP;   // drop the backlog instead of spiralling
    if (acc < 0) acc = 0;                // a scene switch may resync mid-frame
    perf.updMs += ((AP.clock() - t0) - perf.updMs) * 0.1;
    perf.steps = steps;
    Time.alpha = acc / STEP;
    try {
      render();
    } catch (e2) {
      AP.reportError('Loop.render', e2);
    }
    if (AP.Save && AP.Save.tick) AP.guard('Save.tick', AP.Save.tick, elapsed);
    if (elapsedRaw > 0) {
      perf.frameMs += (elapsedRaw * 1000 - perf.frameMs) * 0.05;
      perf.fps = 1000 / Math.max(1, perf.frameMs);
      if (AP.R && AP.R.perfTick) AP.guard('R.perfTick', AP.R.perfTick, elapsedRaw);
    }
  }

  var Loop = {
    perf: perf,
    get fps() { return perf.fps; },
    get running() { return running; },

    start: function () {
      if (running) return;
      raf = (typeof window !== 'undefined' && window.requestAnimationFrame) ? window.requestAnimationFrame.bind(window) : null;
      caf = (typeof window !== 'undefined' && window.cancelAnimationFrame) ? window.cancelAnimationFrame.bind(window) : null;
      if (!raf) return;
      running = true;
      last = -1;
      acc = 0;
      rafId = raf(frame);
    },

    stop: function () {
      running = false;
      if (caf && rafId) caf(rafId);
      rafId = 0;
    },

    // headless / tests: run n fixed steps synchronously (no render)
    step: function (n) {
      n = n === undefined ? 1 : Math.max(0, n | 0);
      for (var i = 0; i < n; i++) {
        Time.scale = computeScale();
        Time.now += STEP;
        Time.dt = STEP;
        try {
          tick();
        } catch (e) {
          AP.reportError('Loop.tick', e);
        }
        if (AP.Save && AP.Save.tick) AP.guard('Save.tick', AP.Save.tick, STEP);
      }
      Time.alpha = 0;
      return Time.step;
    },

    // render one frame now (headless / tests / screenshots)
    renderOnce: function () {
      try {
        render();
      } catch (e) {
        AP.reportError('Loop.render', e);
      }
    },

    // reset the accumulator (after long pauses / scene loads) so nothing fast-forwards
    resync: function () {
      acc = 0;
      last = -1;
    }
  };

  AP.Loop = Loop;
})(window.AP = window.AP || {});
