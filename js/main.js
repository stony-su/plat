/* js/main.js — owner: CORE */
(function (AP) {
  'use strict';

  // AP.boot(opts): initialises every module in dependency order and enters the first scene.
  // opts.headless -> no requestAnimationFrame loop and no DOM listeners (the TOOLS harness drives AP.Loop.step).
  var booted = false;

  function parseHash() {
    var out = {};
    var h = '';
    try { h = String((window.location && window.location.hash) || ''); } catch (e) { h = ''; }
    h = h.replace(/^#/, '');
    if (!h) return out;
    var parts = h.split(/[&#,;]/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var eq = p.indexOf('=');
      var k = eq >= 0 ? p.slice(0, eq) : p;
      var v = eq >= 0 ? p.slice(eq + 1) : true;
      if (typeof v === 'string') { try { v = decodeURIComponent(v); } catch (e2) { /* keep raw */ } }
      out[k.toLowerCase()] = v;
    }
    return out;
  }

  function applySettings(key) {
    var st = AP.Save.data.settings;
    if (!key || key === '*' || key === 'master' || key === 'music' || key === 'sfx') {
      AP.call('Audio.setVolumes', { master: st.master, music: st.music, sfx: st.sfx });
    }
    if (!key || key === '*' || /^(keys|pad)(\.|$)/.test(key)) AP.Input.rebuild();
    if (!key || key === '*' || key === 'particles' || key === 'bg') AP.R.onSettings(key || '*');
  }

  // ---- DEV keys (CONTRACT 2.21) ----
  var perfOverlay = false;
  var PERF_T = { size: 12, weight: '600', align: 'left', baseline: 'top', color: '#9CFFB0', mono: true };
  function drawPerf(ctx) {
    if (!perfOverlay) return;
    var p = AP.Loop.perf;
    var L = AP.level;
    var lines = [
      'fps ' + p.fps.toFixed(0) + '   frame ' + p.frameMs.toFixed(1) + 'ms',
      'update ' + p.updMs.toFixed(2) + 'ms   render ' + p.renMs.toFixed(2) + 'ms   steps ' + p.steps,
      'particles ' + AP.FX.count() + '   glows ' + AP.R.glowCount + '   quality ' + AP.R.quality.particles + '/' + AP.R.quality.bg +
        (AP.R.quality.mid ? '/mid' : '') + '   bg ' + AP.R.bgMode + '   dg ' + AP.R.downgradeLevel,
      'scene ' + AP.Scenes.current + (L ? '   level ' + L.id + '   entities ' + L.entities.length + '   t ' + L.time.toFixed(2) : '') +
        '   beat ' + AP.Beat.bar + ':' + AP.Beat.inBar
    ];
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(6, 6, 520, lines.length * 15 + 8);
    for (var i = 0; i < lines.length; i++) AP.R.text(ctx, lines[i], 12, 10 + i * 15, PERF_T);
  }

  function devKey(code) {
    if (!AP.DEV) return false;
    var L = AP.level;
    switch (code) {
      case 'F1':
        if (AP.LevelScene) AP.LevelScene.hitboxes = !AP.LevelScene.hitboxes;
        AP.toast('Hitboxes ' + (AP.LevelScene && AP.LevelScene.hitboxes ? 'on' : 'off'));
        return true;
      case 'F2':
        perfOverlay = !perfOverlay;
        return true;
      case 'F3':
        AP.toast('God mode ' + (AP.Test.god() ? 'on' : 'off'));
        return true;
      case 'F4':
        if (L && !L.ended) L.completeLevel({});
        return true;
      case 'F6':
        if (L) {
          var b = L.bossEnt || L.findBoss();
          if (b) {
            if (!L.bossInfo && !L.bossDone) L.bossStart(b);
            L.hook(b, 'debugDamage', L);
          } else AP.toast('No boss in this level');
        }
        return true;
      case 'F7':
        if (L && L.player) {
          var f = L.player.form;
          var i = AP.FORMS.indexOf(f);
          var nf = AP.FORMS[(i + 1) % AP.FORMS.length];
          L.form = nf;
          L.player.setForm(nf);
          AP.toast('Form: ' + AP.FORM_NAMES[nf]);
        }
        return true;
      case 'F8':
        if (L) L.killPlayer('test');
        return true;
      case 'F9':
        AP.Scenes.go('devmenu', {}, { fx: 'fade', dur: 0.4 });
        return true;
      default:
        return false;
    }
  }

  function firstScene(route) {
    if (route.level) {
      var id = String(route.level);
      if (AP.Levels.has(id)) {
        var f = route.form !== undefined ? +route.form : undefined;
        var params = { id: id, mode: (f && AP.FORMS.indexOf(f) >= 0) || /^test-/.test(id) ? 'test' : 'story' };
        if (f && AP.FORMS.indexOf(f) >= 0) params.form = f;
        return { name: 'level', params: params };
      }
      AP.warn('Hash route: unknown level "' + id + '"');
    }
    if (route.scene && AP.Scenes.resolve(String(route.scene))) return { name: String(route.scene), params: {} };
    if (route.seed !== undefined && AP.Scenes.has('endless')) return { name: 'endless', params: { seed: (+route.seed) >>> 0 } };
    return { name: AP.Scenes.has('title') ? 'title' : 'devmenu', params: {} };
  }

  AP.boot = function (opts) {
    opts = opts || {};
    if (booted) return false;
    booted = true;
    var headless = !!opts.headless;
    AP.headless = headless;
    AP.DEV = AP.readDev ? AP.readDev() : AP.DEV;
    var route = parseHash();
    if (route.dev) AP.DEV = true;
    if (route.unlockall && AP.DEV && AP.Progress) AP.Progress.unlockAll = true;

    // storage first: input bindings and quality depend on the settings
    AP.Save.load();
    AP.Input.init(headless ? {} : window);
    AP.Input.rebuild();

    var stage = null;
    try { stage = document.getElementById('stage'); } catch (e) { stage = null; }
    AP.R.init(stage, { headless: headless });
    if (AP.R.canvas && AP.R.canvas.focus && !headless) { try { AP.R.canvas.focus(); } catch (e2) { /* ignore */ } }

    // shader backgrounds (WebGL1 on canvas#bg)
    if (AP.R.bgCanvas && AP.GL.init(AP.R.bgCanvas)) {
      var r = AP.call('Backgrounds.init', AP.GL.gl);
      AP.GL.bgReady = r !== false && !!AP.Backgrounds;
    }

    AP.call('Audio.init');
    applySettings('*');
    AP.call('Meta.init');
    AP.Events.on('settings:changed', function (p) { applySettings(p && p.key); });

    if (AP.DEV) {
      AP.Input.onKey(function (code) { return devKey(code); });
      AP.Scenes.overlay = drawPerf;
    }

    if (!headless) {
      try {
        document.addEventListener('visibilitychange', function () {
          if (document.hidden) {
            AP.call('Audio.suspend');
            if (AP.Save.flush) AP.Save.flush();
            var L = AP.level;
            if (L && AP.Scenes.current === 'level' && !L.ended && L.phase === 'play') L.pause();
          } else {
            AP.call('Audio.resume');
            AP.Loop.resync();
          }
        });
        window.addEventListener('pagehide', function () { if (AP.Save.flush) AP.Save.flush(); });
        window.addEventListener('beforeunload', function () { if (AP.Save.flush) AP.Save.flush(); });
        window.addEventListener('error', function (ev) {
          if (ev && ev.error) AP.reportError('window', ev.error);
        });
        window.addEventListener('blur', function () {
          var L = AP.level;
          if (L && AP.Scenes.current === 'level' && !L.ended && L.phase === 'play' && !AP.DEV) L.pause();
        });
      } catch (e3) { AP.warn('Could not attach window listeners', e3); }
    }

    var first = firstScene(route);
    AP.Scenes.go(first.name, first.params, { fx: 'fade', dur: 0.8, color: '#000000' });

    if (!headless) AP.Loop.start();
    return true;
  };

  AP.isBooted = function () { return booted; };

  // autoboot unless the test harness set window.AP_NO_AUTOBOOT
  if (!window.AP_NO_AUTOBOOT) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { AP.boot(); });
    else AP.boot();
  }
})(window.AP = window.AP || {});
