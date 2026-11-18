/* js/audio/engine.js — owner: AUDIO */
(function (AP) {
  'use strict';

  // AP.Audio: the Web Audio core of APEIRON. Every sound is synthesized; nothing is loaded.
  //  - init() never creates a context. unlock() (called on a user gesture) lazily creates or
  //    resumes the AudioContext and is idempotent.
  //  - Before unlock every call is a silent no-op: SFX are dropped, the latest music request
  //    (and loop volume) is remembered and starts on unlock.
  //  - Graph: sfx bus + music bus (→ pause filter → duck) → master gain → DynamicsCompressor →
  //    destination, plus a synthesized-impulse reverb and a ping-pong delay as shared sends.
  //  - Voice pools: 24 SFX voices and 12 music note voices; when full, the oldest is stolen.
  //  - js/audio/sfx.js registers the AP.SFX recipes (defineSfx); js/audio/music.js registers
  //    the generative composer (setComposer). Both use the synth kit AP.Audio.syn.
  //  - Never throws: every entry point is guarded; real bugs go to AP.reportError once per label.

  var SFX_CAP = 24;
  var MUSIC_CAP = 12;
  var LOOKAHEAD = 0.12;
  var MASTER_TRIM = 1.0;
  var MUSIC_TRIM = 0.5;
  var SFX_TRIM = 1.1;

  var ctx = null;            // AudioContext, created lazily inside a user gesture
  var G = null;              // graph nodes
  var dead = false;          // Web Audio unavailable: silent for the session
  var hidden = false;        // suspend() requested (page hidden)
  var everRan = false;       // the context reached 'running' at least once
  var hooked = false;
  var composer = null;       // music.js
  var sfxDefs = {};
  var sfxCount = 0;

  var vol = { master: 0.8, music: 0.6, sfx: 0.8 };
  var intensity = 0;         // setIntensity()
  var autoIntensity = 0;     // derived from boss events (max() with the explicit value)
  var pending = { has: false, key: null, fade: 1 };
  var currentKey = null;
  var stats = { sfx: 0, steals: 0, musicSteals: 0, earlySteals: 0, notes: 0, errors: 0 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { v = +v; return (v === v && v !== Infinity && v !== -Infinity) ? v : d; }
  function noop() {}

  // xorshift32: deterministic variation and noise without Math.random
  var rs = 0x2545F491 | 0;
  function rand() {
    rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
    return (rs >>> 0) / 4294967296;
  }

  var reported = {};
  function report(label, e) {
    stats.errors++;
    if (reported[label]) return;
    reported[label] = true;
    AP.reportError(label, e);
  }

  function isRunning() { return !!(ctx && G && ctx.state === 'running'); }

  // ------------------------------------------------------------------ graph
  function gainN(v) {
    var g = ctx.createGain();
    g.gain.value = v;
    return g;
  }

  function filt(type, f, q) {
    var b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = clamp(num(f, 1000), 10, 22000);
    b.Q.value = num(q, 0.7);
    return b;
  }

  function makeNoise(seconds, pink) {
    var sr = ctx.sampleRate || 44100;
    var len = Math.max(256, Math.floor(sr * seconds));
    var buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var i;
    if (!pink) {
      for (i = 0; i < len; i++) d[i] = rand() * 2 - 1;
    } else {
      // Paul Kellet's economy pink filter
      var b0 = 0, b1 = 0, b2 = 0;
      for (i = 0; i < len; i++) {
        var w = rand() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }
    return buf;
  }

  // Synthesized stereo room: damped noise tail (darkens over time) plus early reflections.
  function makeIR(seconds) {
    var sr = ctx.sampleRate || 44100;
    var len = Math.max(256, Math.floor(sr * seconds));
    var buf = ctx.createBuffer(2, len, sr);
    var decay = Math.exp(-2.9 / sr);
    var onset = Math.exp(-180 / sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var lp = 0, e1 = 1, e2 = 1;
      for (var i = 0; i < len; i++) {
        var k = 0.9 - 0.72 * (i / len);
        lp += ((rand() * 2 - 1) - lp) * k;
        d[i] = lp * e1 * (1 - e2);
        e1 *= decay;
        e2 *= onset;
      }
      for (var r = 0; r < 10; r++) {
        var at = Math.floor(sr * (0.006 + 0.0105 * r + rand() * 0.006 + ch * 0.0023));
        if (at < len) d[at] += (rand() < 0.5 ? -1 : 1) * 0.5 * Math.pow(0.8, r);
      }
    }
    return buf;
  }

  function build() {
    G = {};
    var c = ctx;
    G.canPan = typeof c.createStereoPanner === 'function';
    G.comp = c.createDynamicsCompressor();
    G.comp.threshold.value = -14;
    G.comp.knee.value = 10;
    G.comp.ratio.value = 4;
    G.comp.attack.value = 0.004;
    G.comp.release.value = 0.22;
    G.master = gainN(0);
    G.master.connect(G.comp);
    G.comp.connect(c.destination);

    G.sfx = gainN(0);
    G.sfx.connect(G.master);
    G.music = gainN(0);
    G.musicLp = filt('lowpass', 20000, 0.5);   // closes while a pause overlay covers a level
    G.duck = gainN(1);
    G.music.connect(G.musicLp);
    G.musicLp.connect(G.duck);
    G.duck.connect(G.master);
    G.loops = gainN(1);                        // ambient loops live under the sfx volume
    G.loops.connect(G.sfx);

    G.white = makeNoise(1.5, false);
    G.pink = makeNoise(2.5, true);

    // reverb send
    G.rvbIn = gainN(1);
    G.rvbHp = filt('highpass', 230, 0.5);
    G.rvb = c.createConvolver();
    G.rvb.buffer = makeIR(2.6);
    G.rvbOut = gainN(0.8);
    G.rvbIn.connect(G.rvbHp);
    G.rvbHp.connect(G.rvb);
    G.rvb.connect(G.rvbOut);
    G.rvbOut.connect(G.master);
    G.rvbMusic = gainN(0.24);
    G.duck.connect(G.rvbMusic);
    G.rvbMusic.connect(G.rvbIn);
    G.rvbSfx = gainN(0.13);
    G.sfx.connect(G.rvbSfx);
    G.rvbSfx.connect(G.rvbIn);

    // ping-pong delay for melodic music parts; the echoes rejoin the music bus
    G.dlyIn = gainN(1);
    G.dL = c.createDelay(2);
    G.dR = c.createDelay(2);
    G.dL.delayTime.value = 0.375;
    G.dR.delayTime.value = 0.375;
    G.dDamp = filt('lowpass', 2600, 0.5);
    G.dFb = gainN(0.55);
    G.dFb2 = gainN(0.62);
    G.dOut = gainN(0.55);
    G.dlyIn.connect(G.dL);
    G.dL.connect(G.dDamp);
    G.dDamp.connect(G.dFb);
    G.dFb.connect(G.dR);
    G.dR.connect(G.dFb2);
    G.dFb2.connect(G.dL);
    if (G.canPan) {
      G.dPL = c.createStereoPanner(); G.dPL.pan.value = -0.7;
      G.dPR = c.createStereoPanner(); G.dPR.pan.value = 0.7;
      G.dL.connect(G.dPL); G.dPL.connect(G.dOut);
      G.dR.connect(G.dPR); G.dPR.connect(G.dOut);
    } else {
      G.dL.connect(G.dOut);
      G.dR.connect(G.dOut);
    }
    G.dOut.connect(G.music);
    S.G = G;
  }

  // ------------------------------------------------------------------ voices
  function Pool(cap) { this.cap = cap; this.live = []; this.dying = []; this.free = []; }
  function Voice() { this.out = null; this.pan = null; this.srcs = []; this.t0 = 0; this.end = 0; this.tag = ''; }
  var sfxPool = new Pool(SFX_CAP);
  var musPool = new Pool(MUSIC_CAP);

  function retire(pool, v) {
    try { if (v.out) v.out.disconnect(); } catch (e) { /* already detached */ }
    try { if (v.pan) v.pan.disconnect(); } catch (e2) { /* already detached */ }
    v.out = null;
    v.pan = null;
    v.srcs.length = 0;
    pool.free.push(v);
  }

  function sweepList(pool, list, now) {
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].end + 0.08 < now) {
        retire(pool, list[i]);
        list[i] = list[list.length - 1];
        list.length--;
      }
    }
  }

  function sweep(pool, now) {
    sweepList(pool, pool.live, now);
    sweepList(pool, pool.dying, now);
  }

  // fast fade + stop: used when stealing a voice or cutting a sound short
  function kill(v, now) {
    var st = now + 0.06;
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setTargetAtTime(0, now, 0.012);
    } catch (e) { /* node gone */ }
    if (st < v.end) {
      for (var i = 0; i < v.srcs.length; i++) {
        try { v.srcs[i].stop(st); } catch (e2) { /* never started or already stopped */ }
      }
      v.end = st;
    }
  }

  // Steals the oldest voice (optionally only voices with the given tag). With preferTail (music pool)
  // the oldest voice already in its decay tail (past 60% of its life) goes first, so a held
  // note is not cut while a nearly finished one is still counted.
  function stealOldest(pool, now, tag, preferTail) {
    var live = pool.live, idx = -1, i;
    if (preferTail) {
      for (i = 0; i < live.length; i++) {
        var lv = live[i];
        if ((tag && lv.tag !== tag) || now < lv.t0 + 0.6 * (lv.end - lv.t0)) continue;
        if (idx < 0 || lv.t0 < live[idx].t0) idx = i;
      }
    }
    if (idx < 0) {
      for (i = 0; i < live.length; i++) {
        if (tag && live[i].tag !== tag) continue;
        if (idx < 0 || live[i].t0 < live[idx].t0) idx = i;
      }
    }
    if (idx < 0) return false;
    var v = live[idx];
    if (now < v.t0 + 0.6 * (v.end - v.t0)) stats.earlySteals++;   // stolen before its quiet tail
    live[idx] = live[live.length - 1];
    live.length--;
    kill(v, now);
    pool.dying.push(v);
    return true;
  }

  function voice(pool, dest, t0, dur, gain, pan, tag) {
    var now = ctx.currentTime;
    sweep(pool, now);
    if (pool.live.length >= pool.cap) {
      stealOldest(pool, now, null, pool === musPool);
      if (pool === musPool) stats.musicSteals++; else stats.steals++;
    }
    var v = pool.free.length ? pool.free.pop() : new Voice();
    var out = ctx.createGain();
    out.gain.value = clamp(num(gain, 0), 0, 4);
    v.out = out;
    v.pan = null;
    pan = num(pan, 0);
    if (pan && G.canPan) {
      var p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      out.connect(p);
      p.connect(dest);
      v.pan = p;
    } else {
      out.connect(dest);
    }
    v.srcs.length = 0;
    v.t0 = t0;
    v.end = t0 + Math.max(0.01, num(dur, 0.2));
    v.tag = tag || '';
    pool.live.push(v);
    return v;
  }

  function countTag(pool, tag) {
    var n = 0;
    for (var i = 0; i < pool.live.length; i++) if (pool.live[i].tag === tag) n++;
    return n;
  }

  // ------------------------------------------------------------------ synth kit (AP.Audio.syn)
  function startSrc(v, node, t, end) {
    node.start(t);
    node.stop(end);
    v.srcs.push(node);
    if (end > v.end) v.end = end;
    return node;
  }

  function osc(v, type, f, t, end) {
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = clamp(num(f, 440), 1, 20000);
    return startSrc(v, o, t, end);
  }

  function noiseSrc(v, t, end, pink, rate) {
    var b = ctx.createBufferSource();
    b.buffer = pink ? G.pink : G.white;
    b.loop = true;
    if (rate) b.playbackRate.value = clamp(num(rate, 1), 0.05, 8);
    b.start(t, rand() * (b.buffer.duration * 0.9));
    b.stop(end);
    v.srcs.push(b);
    if (end > v.end) v.end = end;
    return b;
  }

  // anchored sweep (exponential unless lin): a ramp always starts from an explicit event at t0
  function sweepP(p, v0, v1, t0, t1, lin) {
    v0 = num(v0, 1);
    v1 = num(v1, v0);
    if (!lin) { v0 = Math.max(0.0001, v0); v1 = Math.max(0.0001, v1); }
    p.setValueAtTime(v0, t0);
    if (t1 <= t0) t1 = t0 + 0.001;
    if (lin) p.linearRampToValueAtTime(v1, t1);
    else p.exponentialRampToValueAtTime(v1, t1);
  }

  // Stop point of envelopes, in decay constants: 1.2 (-52 dB) for SFX; music notes use 0.9 (-39 dB)
  // so their voices free up sooner under the 12-voice cap.
  var tailK = 1.2;

  // ADSR on a param. s = 0 → percussive (exponential-like decay over d). Returns the silent time.
  function env(p, t, peak, a, d, s, h, r) {
    peak = Math.max(0, num(peak, 0.3));
    a = Math.max(0, num(a, 0.004));
    d = Math.max(0.005, num(d, 0.2));
    p.setValueAtTime(0, t);
    if (a > 0.0005) p.linearRampToValueAtTime(peak, t + a);
    else p.setValueAtTime(peak, t);
    if (!(s > 0)) {
      p.setTargetAtTime(0, t + a, d / 5);
      return t + a + d * tailK;
    }
    r = Math.max(0.01, num(r, 0.1));
    p.setTargetAtTime(peak * s, t + a, d / 3);
    var rel = t + Math.max(a + 0.001, num(h, 0));
    p.setTargetAtTime(0, rel, r / 5);
    return rel + r * tailK;
  }

  function envOf(o, p, t) {
    return env(p, t, o.v, o.a !== undefined ? o.a : 0.004, o.d !== undefined ? o.d : 0.2, o.s || 0, o.h || 0, o.r !== undefined ? o.r : 0.1);
  }

  // Oscillator note: o = {type, f, f1, ft, lin, det, uni, v, a, d, s, h, r, lp, lp1, lpt, q, hp, vib, vibf, vibd}
  function tone(v, dest, t, o) {
    var f = clamp(num(o.f, 440), 1, 20000);
    var g = gainN(0);
    var end = envOf(o, g.gain, t);
    var stop = end + 0.02;
    var o1 = osc(v, o.type, f, t, stop);
    if (o.det) o1.detune.value = num(o.det, 0);
    var o2 = null;
    if (o.uni) {
      o2 = osc(v, o.type2 || o.type, f, t, stop);
      o2.detune.value = num(o.uni, 8) + num(o.det, 0);
    }
    if (o.f1) {
      var t1 = t + (o.ft !== undefined ? o.ft : Math.max(0.01, (o.a || 0.004) + (o.d || 0.2) * 0.5));
      sweepP(o1.frequency, f, clamp(num(o.f1, f), 1, 20000), t, t1, o.lin);
      if (o2) sweepP(o2.frequency, f, clamp(num(o.f1, f), 1, 20000), t, t1, o.lin);
    }
    if (o.vib) {
      var lfo = osc(v, 'sine', o.vibf || 5.5, t, stop);
      var lg = gainN(0);
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(num(o.vib, 4), t + (o.vibd || 0.15));
      lfo.connect(lg);
      lg.connect(o1.frequency);
      if (o2) lg.connect(o2.frequency);
    }
    var head = g;
    if (o.lp) {
      var fl = filt('lowpass', o.lp, o.q || 0.8);
      if (o.lp1) sweepP(fl.frequency, o.lp, o.lp1, t, t + (o.lpt || Math.max(0.02, (o.a || 0.004) + (o.d || 0.2))), false);
      o1.connect(fl);
      if (o2) o2.connect(fl);
      fl.connect(g);
    } else {
      o1.connect(g);
      if (o2) o2.connect(g);
    }
    if (o.hp) {
      var hp = filt('highpass', o.hp, 0.7);
      g.connect(hp);
      head = hp;
    }
    head.connect(dest);
    return end;
  }

  // Two-operator FM note: o = {f, ratio, idx, idx1, it, type, f1, ft, v, a, d, s, h, r, lp}
  function fm(v, dest, t, o) {
    var f = clamp(num(o.f, 440), 1, 18000);
    var ratio = num(o.ratio, 2);
    var g = gainN(0);
    var end = envOf(o, g.gain, t);
    var stop = end + 0.02;
    var car = osc(v, o.type || 'sine', f, t, stop);
    var mod = osc(v, 'sine', f * ratio, t, stop);
    var mg = gainN(0);
    var dev0 = Math.max(0.01, num(o.idx, 2) * f * ratio);
    var dev1 = Math.max(0.01, num(o.idx1 !== undefined ? o.idx1 : num(o.idx, 2) * 0.12, 0.2) * f * ratio);
    sweepP(mg.gain, dev0, dev1, t, t + (o.it || Math.max(0.02, (o.d || 0.3) * 0.8)), false);
    mod.connect(mg);
    mg.connect(car.frequency);
    if (o.f1) {
      var t1 = t + (o.ft || 0.1);
      sweepP(car.frequency, f, num(o.f1, f), t, t1, o.lin);
      sweepP(mod.frequency, f * ratio, num(o.f1, f) * ratio, t, t1, o.lin);
    }
    if (o.lp) {
      var fl = filt('lowpass', o.lp, o.q || 0.7);
      car.connect(fl);
      fl.connect(g);
    } else {
      car.connect(g);
    }
    g.connect(dest);
    return end;
  }

  // Filtered noise: o = {ft:'bandpass'|'highpass'|'lowpass'|'notch'|'peaking', f, f1, st, lin, q, pink, rate, v, a, d, s, h, r}
  function nz(v, dest, t, o) {
    var g = gainN(0);
    var end = envOf(o, g.gain, t);
    var n = noiseSrc(v, t, end + 0.02, o.pink, o.rate);
    if (o.ft) {
      var fl = filt(o.ft, o.f || 1000, o.q || 1);
      if (o.f1) sweepP(fl.frequency, o.f || 1000, o.f1, t, t + (o.st || Math.max(0.02, (o.a || 0.004) + (o.d || 0.2))), o.lin);
      n.connect(fl);
      fl.connect(g);
    } else {
      n.connect(g);
    }
    g.connect(dest);
    return end;
  }

  var shaperCache = {};
  function shaper(amount) {
    var k = Math.round(clamp(num(amount, 2), 0.5, 50) * 10) / 10;
    var curve = shaperCache[k];
    if (!curve) {
      curve = new Float32Array(1024);
      var norm = Math.tanh(k);
      for (var i = 0; i < 1024; i++) {
        var x = i / 511.5 - 1;
        curve[i] = Math.tanh(k * x) / norm;
      }
      shaperCache[k] = curve;
    }
    var ws = ctx.createWaveShaper();
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  var S = {
    LOOKAHEAD: LOOKAHEAD,
    G: null,
    stats: stats,
    rand: rand,
    clamp: clamp,
    num: num,
    mtof: function (m) { return 440 * Math.pow(2, (num(m, 69) - 69) / 12); },
    now: function () { return ctx ? ctx.currentTime : 0; },
    context: function () { return ctx; },
    gain: gainN,
    filter: filt,
    osc: osc,
    noise: noiseSrc,
    sweep: sweepP,
    env: env,
    tone: tone,
    fm: fm,
    nz: nz,
    shaper: shaper,
    sfxVoice: function (t0, dur, gain, pan, tag) { return voice(sfxPool, G.sfx, t0, dur, gain, pan, tag); },
    musicVoice: function (dest, t0, dur, gain, pan, tag) {
      stats.notes++;
      return voice(musPool, dest || G.music, t0, dur, gain, pan, tag);
    },
    musicVoices: function () { return musPool.live.length; },
    killTag: function (tag) {
      if (!ctx) return;
      var now = ctx.currentTime;
      while (stealOldest(sfxPool, now, tag)) { /* fade every live voice with this tag */ }
    },
    // envelope stop point in decay constants (music notes use 0.9; SFX keep the default 1.2)
    setTail: function (k) { tailK = clamp(num(k, 1.2), 0.6, 2); },
    // per-param automation hygiene for long-lived params: cancel future events, then glide
    glide: function (p, value, t, tau) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(num(value, 0), t, Math.max(0.001, num(tau, 0.05)));
    }
  };

  // ------------------------------------------------------------------ ambient loops
  var LOOP_BASE = { wind: 0.8, hum: 0.3, void: 0.62 };
  var loopWant = { wind: 0, hum: 0, void: 0 };
  var loops = { wind: null, hum: null, void: null };
  var paused = false;
  var overlayPaused = false;   // a pause/settings scene is pushed over the level

  function persist(L, node, t) {
    node.start(t);
    L.srcs.push(node);
    return node;
  }
  function pOsc(L, type, f, t) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return persist(L, o, t);
  }
  function pNoise(L, pink, rate, t) {
    var b = ctx.createBufferSource();
    b.buffer = pink ? G.pink : G.white;
    b.loop = true;
    b.playbackRate.value = rate || 1;
    b.start(t, rand() * b.buffer.duration * 0.9);
    L.srcs.push(b);
    return b;
  }
  function lfoTo(L, rate, depth, param, t) {
    var o = pOsc(L, 'sine', rate, t);
    var g = gainN(depth);
    o.connect(g);
    g.connect(param);
    return o;
  }

  var BUILD = {
    // airy pink-noise wind: a sweeping body band, a whistling resonant band and slow gusts
    wind: function (L, t) {
      var n = pNoise(L, true, 1, t);
      var body = filt('bandpass', 520, 0.6);
      var whistle = filt('bandpass', 1650, 5);
      var wg = gainN(0.2);
      var am = gainN(0.66);
      lfoTo(L, 0.11, 300, body.frequency, t);
      lfoTo(L, 0.23, 420, whistle.frequency, t);
      lfoTo(L, 0.067, 0.32, am.gain, t);
      n.connect(body); body.connect(am);
      n.connect(whistle); whistle.connect(wg); wg.connect(am);
      am.connect(L.out);
    },
    // electrical hum: 55 Hz fundamental, a beating octave and a soft third harmonic
    hum: function (L, t) {
      var lp = filt('lowpass', 640, 0.7);
      var o1 = pOsc(L, 'sine', 55, t);
      var o2 = pOsc(L, 'sine', 110.6, t);
      var o3 = pOsc(L, 'triangle', 165.2, t);
      var g1 = gainN(0.55), g2 = gainN(0.32), g3 = gainN(0.12);
      lfoTo(L, 0.31, 2.5, o2.frequency, t);
      var am = gainN(0.85);
      lfoTo(L, 0.9, 0.12, am.gain, t);
      o1.connect(g1); o2.connect(g2); o3.connect(g3);
      g1.connect(lp); g2.connect(lp); g3.connect(lp);
      lp.connect(am);
      am.connect(L.out);
    },
    // the void: a wavering sub, a slow noise rumble and a faint beating high pair
    void: function (L, t) {
      var sub = pOsc(L, 'sine', 36.71, t);
      lfoTo(L, 0.07, 1.4, sub.frequency, t);
      var sg = gainN(0.7);
      sub.connect(sg); sg.connect(L.out);
      var n = pNoise(L, false, 0.35, t);
      var lp = filt('lowpass', 110, 0.9);
      var ng = gainN(0.9);
      lfoTo(L, 0.045, 0.35, ng.gain, t);
      n.connect(lp); lp.connect(ng); ng.connect(L.out);
      var a1 = pOsc(L, 'sine', 1318.5, t);
      var a2 = pOsc(L, 'sine', 1322.2, t);
      var ag = gainN(0.018);
      lfoTo(L, 0.05, 0.014, ag.gain, t);
      a1.connect(ag); a2.connect(ag); ag.connect(L.out);
    }
  };

  function applyLoop(name, now) {
    var want = loopWant[name];
    var L = loops[name];
    if (!L) {
      if (want <= 0.001) return;
      L = { out: gainN(0), srcs: [], cur: 0, zeroAt: -1 };
      L.out.connect(G.loops);
      BUILD[name](L, now);
      loops[name] = L;
    }
    if (Math.abs(want - L.cur) < 0.004) return;
    var up = want > L.cur;
    L.cur = want;
    S.glide(L.out.gain, want * LOOP_BASE[name], now, up ? 0.3 : 0.45);
    L.zeroAt = want <= 0.001 ? now : -1;
  }

  function teardownLoop(name, now) {
    var L = loops[name];
    if (!L) return;
    loops[name] = null;
    for (var i = 0; i < L.srcs.length; i++) {
      try { L.srcs[i].stop(now + 0.05); } catch (e) { /* already stopped */ }
    }
    try { L.out.disconnect(); } catch (e2) { /* detached */ }
  }

  function tickLoops(now) {
    for (var name in loops) {
      var L = loops[name];
      if (L && L.zeroAt >= 0 && now - L.zeroAt > 3) teardownLoop(name, now);
    }
  }

  function resetLoops() {
    for (var name in loopWant) loopWant[name] = 0;
    if (!isRunning()) return;
    var now = ctx.currentTime;
    for (var n2 in loopWant) applyLoop(n2, now);
  }

  // pause overlay over a level: ambience fades, music is muffled (restored on return)
  function applyPaused(tauScale) {
    if (!ctx || !G) return;
    var now = ctx.currentTime;
    S.glide(G.loops.gain, paused ? 0 : 1, now, (paused ? 0.06 : 0.15) * tauScale);
    S.glide(G.musicLp.frequency, paused ? 900 : 20000, now, (paused ? 0.08 : 0.2) * tauScale);
  }
  // LevelScene's inline pause fallback (no 'pause' scene) is read from AP.level.paused
  function updatePaused() {
    var L = AP.level;
    setPaused(overlayPaused || !!(L && L.paused && !L.ended));
  }
  function setPaused(on) {
    if (on === paused) return;
    paused = on;
    applyPaused(1);
  }

  // ------------------------------------------------------------------ volumes and settings
  function readSettings() {
    var s = AP.Save && AP.Save.data && AP.Save.data.settings;
    if (!s) return false;
    vol.master = clamp(num(s.master, vol.master), 0, 1);
    vol.music = clamp(num(s.music, vol.music), 0, 1);
    vol.sfx = clamp(num(s.sfx, vol.sfx), 0, 1);
    return true;
  }

  function applyVolumes(tau) {
    if (!ctx || !G) return;
    var now = ctx.currentTime;
    S.glide(G.master.gain, vol.master * vol.master * MASTER_TRIM, now, tau);
    S.glide(G.music.gain, vol.music * vol.music * MUSIC_TRIM, now, tau);
    S.glide(G.sfx.gain, vol.sfx * vol.sfx * SFX_TRIM, now, tau);
  }

  // ------------------------------------------------------------------ context lifecycle
  function onState() {
    if (isRunning()) onRunning();
  }

  function onRunning() {
    if (!isRunning()) return;
    try {
      var first = !everRan;
      everRan = true;
      if (first) {
        readSettings();
        applyVolumes(0.08);
        applyPaused(0.2);
      }
      if (pending.has) {
        pending.has = false;
        startMusic(pending.key, pending.fade);
      }
      var now = ctx.currentTime;
      for (var name in loopWant) applyLoop(name, now);
      if (composer && composer.resync) composer.resync();
    } catch (e) {
      report('Audio.onRunning', e);
    }
  }

  function create() {
    var C = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!C) {
      dead = true;
      AP.warnOnce('audio:none', 'Web Audio is not available; APEIRON runs silently.');
      return false;
    }
    try {
      ctx = new C({ latencyHint: 'interactive' });
    } catch (e) {
      try { ctx = new C(); } catch (e2) {
        ctx = null;
        dead = true;
        AP.warn('AudioContext could not be created; APEIRON runs silently.', e2);
        return false;
      }
    }
    try {
      build();
    } catch (e3) {
      report('Audio.build', e3);
      dead = true;
      try { ctx.close(); } catch (e4) { /* ignore */ }
      ctx = null;
      G = null;
      S.G = null;
      return false;
    }
    try {
      if (typeof ctx.addEventListener === 'function') ctx.addEventListener('statechange', onState);
      else ctx.onstatechange = onState;
    } catch (e5) { /* very old engines: polled through tick() */ }
    return true;
  }

  // iOS/WebKit: a silent one-sample buffer played inside the gesture unlocks output
  function blip() {
    try {
      var b = ctx.createBufferSource();
      b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      b.connect(G.master);
      b.start(0);
    } catch (e) { /* not needed everywhere */ }
  }

  function startMusic(key, fade) {
    if (key === currentKey) return;
    currentKey = key;
    if (composer && composer.play) {
      try { composer.play(key, fade); } catch (e) { report('Audio.music:' + key, e); }
    }
  }

  function pushIntensity() {
    if (!composer || !composer.setIntensity) return;
    try { composer.setIntensity(Math.max(intensity, autoIntensity)); } catch (e) { report('Audio.setIntensity', e); }
  }

  // ------------------------------------------------------------------ game events
  var boss = { stage: 0, phases: 3, base: null, last: null };
  function bossInfo() { var L = AP.level; return (L && L.bossInfo) ? L.bossInfo : null; }

  function bossNotify(norm) {
    if (composer && composer.onBoss) {
      try { composer.onBoss(norm, boss.phases); } catch (e) { report('Audio.onBoss', e); }
    }
  }

  var handlers = {
    'settings:changed': function (p) {
      var k = p && p.key ? String(p.key) : '*';
      if (k !== '*' && !/(^|\.)(master|music|sfx)$/.test(k)) return;
      readSettings();
      applyVolumes(0.04);
    },
    'level:start': function () {
      autoIntensity = 0;
      intensity = 0;          // LevelScene re-sends L.intensity whenever it changes
      boss.stage = 0;
      resetLoops();
      overlayPaused = false;
      updatePaused();
      pushIntensity();
    },
    'level:quit': function () {
      autoIntensity = 0;
      resetLoops();
      pushIntensity();
    },
    'boss:start': function () {
      var bi = bossInfo();
      boss.stage = 0;
      boss.phases = (bi && bi.phases > 1) ? bi.phases | 0 : 3;
      boss.base = (bi && typeof bi.phase === 'number') ? bi.phase : null;
      boss.last = boss.base;
      autoIntensity = 0.45;
      pushIntensity();
      bossNotify(0);
    },
    'boss:phase': function (p) {
      var ph = (p && typeof p.phase === 'number') ? p.phase : null;
      if (ph !== null && ph === boss.last) return;
      boss.last = ph;
      boss.stage++;
      var bi = bossInfo();
      if (bi && bi.phases > 1) boss.phases = bi.phases | 0;
      var span = Math.max(1, boss.phases - 1);
      var norm = (ph !== null && boss.base !== null) ? (ph - boss.base) / span : boss.stage / span;
      norm = clamp(norm, 0, 1);
      autoIntensity = 0.45 + 0.55 * norm;
      pushIntensity();
      bossNotify(norm);
    },
    'boss:defeat': function () {
      autoIntensity = 0.2;
      pushIntensity();
      if (composer && composer.onDefeat) {
        try { composer.onDefeat(); } catch (e) { report('Audio.onDefeat', e); }
      }
    },
    'player:death': function () { Audio.duck(0.5, 0.75); },
    'form:gain': function () { Audio.duck(0.7, 2.2); },
    'scene:change': function (p) {
      var to = p && p.to;
      var over = false;
      if (to !== 'level') {
        var st = AP.Scenes && AP.Scenes.stack;
        if (st && st.length > 1) {
          for (var i = 0; i < st.length - 1; i++) if (st[i] && st[i].name === 'level') over = true;
        }
      }
      overlayPaused = over;
      updatePaused();
      if (!over && to !== 'level') {
        // left the level: ambience off, menus and the map get the calm arrangement
        resetLoops();
        autoIntensity = 0;
        intensity = 0;
        pushIntensity();
      }
    },
    'endless:segment': function (p) {
      if (composer && composer.onSegment) composer.onSegment(p && p.style);
    }
  };

  function hook() {
    if (hooked || !AP.Events || typeof AP.Events.on !== 'function') return;
    hooked = true;
    Object.keys(handlers).forEach(function (name) {
      var fn = handlers[name];
      AP.Events.on(name, function (p) {
        try { fn(p); } catch (e) { report('Audio.event:' + name, e); }
      });
    });
  }

  // ------------------------------------------------------------------ public API
  var duckDepth = 0;
  var duckUntil = 0;
  var composerErrors = 0;

  var Audio = {
    LOOKAHEAD: LOOKAHEAD,
    syn: S,

    init: function () {
      try {
        hook();
        readSettings();
        return true;
      } catch (e) {
        report('Audio.init', e);
        return false;
      }
    },

    unlock: function () {
      if (dead) return false;
      try {
        hook();
        var fresh = false;
        if (!ctx) {
          if (!create()) return false;
          fresh = true;
        }
        hidden = false;
        if (ctx.state !== 'running' && ctx.state !== 'closed' && typeof ctx.resume === 'function') {
          var pr = ctx.resume();
          if (pr && typeof pr.then === 'function') pr.then(onRunning, noop);
        }
        if (fresh || ctx.state !== 'running') blip();
        if (ctx.state === 'running') onRunning();
        return true;
      } catch (e) {
        report('Audio.unlock', e);
        return false;
      }
    },

    sfx: function (name, o) {
      if (!isRunning()) return false;
      var def = sfxDefs[name];
      if (!def) {
        if (AP.DEV) AP.warnOnce('audio:sfx:' + name, 'AP.Audio: no SFX recipe named', name);
        return false;
      }
      try {
        var vv = 1, p = 1, pan = 0;
        if (o) {
          if (o.vol !== undefined) vv = num(o.vol, 1);
          if (o.pitch !== undefined) p = num(o.pitch, 1);
          if (o.pan !== undefined) pan = num(o.pan, 0);
        }
        vv = clamp(vv, 0, 2);
        if (vv < 0.003) return false;
        p = clamp(p, 0.25, 4);
        pan = clamp(pan, -1, 1);
        var now = ctx.currentTime;
        if (def.cool && now - def.last < def.cool) return false;
        if (def.max && countTag(sfxPool, name) >= def.max) stealOldest(sfxPool, now, name);
        def.last = now;
        var t = now + 0.004;
        var v = voice(sfxPool, G.sfx, t, def.dur || 0.3, vv * (def.gain || 0.5), pan, name);
        def.play(S, v, t, p, o || null);
        if (def.duck) Audio.duck(def.duck[0] * Math.min(1, vv), def.duck[1]);
        stats.sfx++;
        return true;
      } catch (e) {
        report('Audio.sfx:' + name, e);
        return false;
      }
    },

    has: function (name) { return !!sfxDefs[name]; },
    hasMusic: function (key) { return !!(AP.MUSIC && AP.MUSIC[key] && composer && composer.has && composer.has(key)); },

    music: function (key, o) {
      try {
        if (key === undefined || key === '') key = null;
        if (key !== null && !(AP.MUSIC && AP.MUSIC[key])) {
          AP.warnOnce('audio:music:' + key, 'AP.Audio.music: unknown key', key);
          return false;
        }
        var fade = clamp(num(o && o.fade, 1), 0, 20);
        if (!isRunning()) {
          pending.has = true;
          pending.key = key;
          pending.fade = fade;
          return true;
        }
        if (key === currentKey) return false;
        startMusic(key, fade);
        return true;
      } catch (e) {
        report('Audio.music', e);
        return false;
      }
    },

    setIntensity: function (x) {
      var v = clamp(num(x, 0), 0, 1);
      if (Math.abs(v - intensity) < 0.002) return;
      intensity = v;
      pushIntensity();
    },

    duck: function (amount, dur) {
      if (!isRunning()) return false;
      try {
        amount = clamp(num(amount, 0.5), 0, 1);
        dur = clamp(num(dur, 0.5), 0, 10);
        if (amount <= 0.001) return false;
        var now = ctx.currentTime;
        var until = now + dur;
        var active = duckUntil > now;
        if (active && duckDepth >= amount && duckUntil >= until) return true;
        if (active) {
          amount = Math.max(amount, duckDepth);
          until = Math.max(until, duckUntil);
        }
        duckDepth = amount;
        duckUntil = until;
        var p = G.duck.gain;
        p.cancelScheduledValues(now);
        p.setTargetAtTime(1 - amount, now, 0.025);
        p.setTargetAtTime(1, until, 0.22);
        return true;
      } catch (e) {
        report('Audio.duck', e);
        return false;
      }
    },

    setLoop: function (name, v) {
      if (!Object.prototype.hasOwnProperty.call(loopWant, name)) {
        AP.warnOnce('audio:loop:' + name, 'AP.Audio.setLoop: unknown loop', name);
        return false;
      }
      loopWant[name] = clamp(num(v, 0), 0, 1);
      if (!isRunning()) return true;
      try {
        applyLoop(name, ctx.currentTime);
        return true;
      } catch (e) {
        report('Audio.setLoop', e);
        return false;
      }
    },

    setVolumes: function (o) {
      if (!o) return;
      vol.master = clamp(num(o.master, vol.master), 0, 1);
      vol.music = clamp(num(o.music, vol.music), 0, 1);
      vol.sfx = clamp(num(o.sfx, vol.sfx), 0, 1);
      try { applyVolumes(0.04); } catch (e) { report('Audio.setVolumes', e); }
    },

    tick: function () {
      if (!ctx || !G) return;
      try {
        if (ctx.state !== 'running') {
          if (composer && composer.hold) composer.hold();
          return;
        }
        var now = ctx.currentTime;
        sweep(sfxPool, now);
        sweep(musPool, now);
        tickLoops(now);
        updatePaused();
      } catch (e) {
        report('Audio.tick', e);
        return;
      }
      if (composer && composer.tick) {
        try {
          composer.tick(ctx.currentTime);
        } catch (e2) {
          report('Audio.composer', e2);
          if (++composerErrors > 30) composer = null;
        }
      }
    },

    suspend: function () {
      hidden = true;
      if (!ctx || ctx.state !== 'running' || typeof ctx.suspend !== 'function') return;
      try {
        var pr = ctx.suspend();
        if (pr && typeof pr.then === 'function') pr.then(noop, noop);
      } catch (e) { /* closing or unsupported */ }
    },

    resume: function () {
      hidden = false;
      if (!ctx || !everRan || ctx.state === 'running' || ctx.state === 'closed' || typeof ctx.resume !== 'function') return;
      try {
        var pr = ctx.resume();
        if (pr && typeof pr.then === 'function') pr.then(onRunning, noop);
      } catch (e) { /* needs a gesture: unlock() will retry */ }
    },

    // ---- registration (load time; no audio is touched) ----
    defineSfx: function (name, def) {
      if (!name || !def || typeof def.play !== 'function') return false;
      def.last = -1e9;
      sfxDefs[name] = def;
      return true;
    },
    setComposer: function (c) { composer = c || null; return !!composer; },

    // ---- info ----
    key: function () { return currentKey; },
    getIntensity: function () { return Math.max(intensity, autoIntensity); },
    isPaused: function () { return paused; },
    volumes: function () { return { master: vol.master, music: vol.music, sfx: vol.sfx }; },
    stats: function () {
      return {
        state: ctx ? ctx.state : (dead ? 'unavailable' : 'locked'),
        hidden: hidden,
        sfxVoices: sfxPool.live.length,
        musicVoices: musPool.live.length,
        sfxPlayed: stats.sfx,
        notes: stats.notes,
        steals: stats.steals,
        musicSteals: stats.musicSteals,
        earlySteals: stats.earlySteals,
        errors: stats.errors,
        music: currentKey,
        loops: { wind: loopWant.wind, hum: loopWant.hum, void: loopWant.void },
        composer: composer && composer.info ? composer.info() : null
      };
    }
  };

  Object.defineProperty(Audio, 'ready', { get: isRunning, enumerable: true });
  Object.defineProperty(Audio, 'ctx', { get: function () { return ctx; } });

  AP.Audio = Audio;
})(window.AP = window.AP || {});
