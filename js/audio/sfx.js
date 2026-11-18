/* js/audio/sfx.js — owner: AUDIO */
(function (AP) {
  'use strict';

  // The 47 AP.SFX voices as compact parametric recipes (oscillators, two-operator FM, filtered
  // noise, envelopes and pitch sweeps). Registered at load time with AP.Audio.defineSfx; no audio
  // is touched until a sound actually plays. Every recipe honours {vol, pitch, pan}: the engine
  // applies vol and pan on the voice, recipes multiply every frequency by p (pitch).
  //   recipe.play(S, v, t, p, o): S = AP.Audio.syn, v = voice (v.out is its input), t = start time.
  // Musical recipes (shard, chime, checkpoint, gem, secret, vertex, complete, respawn) follow the
  // tonic of the music that is playing, so pickups always sit in key.

  var A = AP.Audio;
  if (!A || typeof A.defineSfx !== 'function') return;

  var MAJP = [0, 2, 4, 7, 9];          // major pentatonic
  var MINP = [0, 3, 5, 7, 10];         // minor pentatonic
  var FORM_SEMI = { 3: 0, 4: 2, 5: 4, 6: 7, 99: 12 };
  var FORM_WAVE = { 3: 'triangle', 4: 'square', 5: 'sawtooth', 6: 'sawtooth', 99: 'sine' };
  var DEFAULT_TONIC = { root: 62, minor: false };

  function tonic() {
    var t = (typeof A.tonic === 'function') ? A.tonic() : null;
    return (t && t.root > 0) ? t : DEFAULT_TONIC;
  }
  // frequency of (tonic + semis), with the tonic placed within a fifth of the MIDI note `near`
  function noteHz(S, semis, near) {
    var r = tonic().root;
    if (!(r > 0 && r < 128)) r = DEFAULT_TONIC.root;
    while (r < near - 6) r += 12;
    while (r > near + 5) r -= 12;
    return S.mtof(r + semis);
  }
  function semi(n) { return Math.pow(2, n / 12); }
  function form() {
    var L = AP.level;
    var P = L && L.player;
    return P && P.form ? P.form : 3;
  }
  function formMul() {
    var s = FORM_SEMI[form()];
    return semi(s === undefined ? 0 : s);
  }
  // player.js (CORE) already passes a mild form pitch for jumps: 1 + (min(sides, 8) - 3) * 0.06,
  // +0.1 for the circle. That exact value is recognised and not applied on top of the musical
  // form interval below; any other caller pitch multiplies as usual.
  function corePitch(f) { return f >= 32 ? 1.4 : 1 + (Math.min(f, 8) - 3) * 0.06; }
  function jumpMul(p) {
    var f = form();
    var own = Math.abs(p - corePitch(f)) < 1e-6 ? 1 : p;
    return formMul() * own;
  }
  // surface tint per world style: glassy crystal (w2), soft air (w3), earthy garden (w4) ...
  var SURFACE = { w1: 1, w2: 1.3, w3: 0.8, w4: 0.66, w5: 1.15, void: 1.1, endless: 1, title: 1, map: 1 };
  function surface() {
    var L = AP.level;
    var k = L && L.style ? SURFACE[L.style] : 1;
    return k > 0 ? k : 1;
  }
  function jitter(S, amt) { return 1 + (S.rand() - 0.5) * amt; }

  function def(name, dur, gain, play, extra) {
    var d = { dur: dur, gain: gain, play: play };
    if (extra) {
      if (extra.cool) d.cool = extra.cool;
      if (extra.max) d.max = extra.max;
      if (extra.duck) d.duck = extra.duck;
    }
    A.defineSfx(name, d);
  }

  // ------------------------------------------------------------------ movement
  // Jump: pitch climbs with the form (triangle → circle spans an octave); the waveform is the form.
  def('jump', 0.22, 0.42, function (S, v, t, p) {
    var m = jumpMul(p);
    var wave = FORM_WAVE[form()] || 'triangle';
    S.tone(v, v.out, t, { type: 'triangle', f: 300 * m, f1: 640 * m, ft: 0.07, a: 0.003, d: 0.14, v: 0.42 });
    S.tone(v, v.out, t, { type: wave, f: 600 * m, f1: 1280 * m, ft: 0.05, a: 0.002, d: 0.06, v: wave === 'sine' ? 0.16 : 0.06, lp: 3400 });
    S.nz(v, v.out, t, { ft: 'highpass', f: 2600, a: 0.002, d: 0.05, v: 0.05 });
  });

  // Double jump: the pentagram ring, five star points in a quick pentatonic burst.
  def('jump2', 0.45, 0.4, function (S, v, t, p) {
    var m = jumpMul(p);
    S.tone(v, v.out, t, { type: 'triangle', f: 420 * m, f1: 940 * m, ft: 0.09, a: 0.003, d: 0.16, v: 0.36 });
    for (var i = 0; i < 5; i++) {
      S.fm(v, v.out, t + 0.025 + i * 0.026, { f: 880 * m * semi(MAJP[i]), ratio: 2, idx: 1.2, idx1: 0.1, a: 0.002, d: 0.16, v: 0.1 });
    }
  });

  def('walljump', 0.22, 0.42, function (S, v, t, p) {
    var m = jumpMul(p);
    S.tone(v, v.out, t, { type: 'square', f: 190 * p, f1: 92 * p, ft: 0.04, a: 0.001, d: 0.05, v: 0.24, lp: 1800 });
    S.tone(v, v.out, t + 0.008, { type: 'triangle', f: 380 * m, f1: 780 * m, ft: 0.08, a: 0.003, d: 0.13, v: 0.38 });
    S.nz(v, v.out, t, { ft: 'bandpass', f: 3200, f1: 1100, q: 1.6, a: 0.001, d: 0.08, v: 0.12 });
  });

  def('land', 0.18, 0.5, function (S, v, t, p) {
    var j = jitter(S, 0.08) * p;
    var sf = surface();
    S.tone(v, v.out, t, { type: 'sine', f: 150 * j, f1: 52 * j, ft: 0.07, a: 0.002, d: 0.11, v: 0.6 });
    S.nz(v, v.out, t, { ft: 'lowpass', f: 1000 * j * sf, f1: 260 * sf, q: 0.8, a: 0.002, d: 0.08, v: 0.22, pink: true });
  }, { cool: 0.03, max: 2 });

  def('step', 0.06, 0.18, function (S, v, t, p) {
    var j = jitter(S, 0.16) * p;
    S.nz(v, v.out, t, { ft: 'bandpass', f: 2600 * j * surface(), q: 2, a: 0.001, d: 0.025, v: 0.34 });
    S.tone(v, v.out, t, { type: 'sine', f: 190 * j, f1: 118 * j, ft: 0.02, a: 0.001, d: 0.026, v: 0.24 });
  }, { cool: 0.045, max: 2 });

  // Dash: a bright filtered whoosh with a falling zap and a detuned (chromatic) edge.
  def('dash', 0.32, 0.45, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'bandpass', f: 520 * p, f1: 4400 * p, st: 0.12, q: 1.4, a: 0.004, d: 0.2, v: 0.5 });
    S.tone(v, v.out, t, { type: 'sawtooth', f: 1100 * p, f1: 250 * p, ft: 0.14, a: 0.002, d: 0.16, v: 0.13, lp: 3400, lp1: 600 });
    S.tone(v, v.out, t, { type: 'square', f: 660 * p, uni: 38, a: 0.002, d: 0.08, v: 0.05, lp: 2600 });
  }, { cool: 0.04 });

  def('refill', 0.38, 0.36, function (S, v, t, p) {
    S.fm(v, v.out, t, { f: 988 * p, ratio: 3, idx: 1.5, a: 0.002, d: 0.17, v: 0.3 });
    S.fm(v, v.out, t + 0.06, { f: 1480 * p, ratio: 3, idx: 1.2, a: 0.002, d: 0.25, v: 0.26 });
  }, { cool: 0.05 });

  // Orbit attach: a warbling lock-on that rises an octave.
  def('orbit', 0.42, 0.38, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sine', f: 330 * p, f1: 660 * p, ft: 0.12, a: 0.01, d: 0.26, v: 0.34, vib: 18, vibf: 14, vibd: 0.08 });
    S.tone(v, v.out, t, { type: 'triangle', f: 990 * p, a: 0.002, d: 0.05, v: 0.12 });
  }, { cool: 0.05 });

  // Fling: a long rising airy sweep with a comet-tail sparkle.
  def('fling', 0.58, 0.45, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'bandpass', f: 400 * p, f1: 3800 * p, st: 0.3, q: 1.2, a: 0.02, d: 0.4, v: 0.46, pink: true });
    S.tone(v, v.out, t, { type: 'sine', f: 260 * p, f1: 1320 * p, ft: 0.25, a: 0.01, d: 0.3, v: 0.28 });
    S.fm(v, v.out, t + 0.17, { f: 1760 * p, ratio: 2.5, idx: 1.5, a: 0.002, d: 0.26, v: 0.11 });
  }, { cool: 0.05 });

  // Pentagram burst (damage ring): a shock thump plus a bright 5:1 FM ring.
  def('burst', 0.5, 0.45, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sine', f: 122 * p, f1: 48 * p, ft: 0.15, a: 0.002, d: 0.2, v: 0.5 });
    S.fm(v, v.out, t, { f: 660 * p, ratio: 5, idx: 3, idx1: 0.2, a: 0.002, d: 0.42, v: 0.2 });
    S.nz(v, v.out, t, { ft: 'highpass', f: 1800, a: 0.002, d: 0.12, v: 0.14 });
  }, { cool: 0.04 });

  // Death: a descending glitch (sample-and-hold square steps, gated), a crackle and a sub drop.
  def('death', 0.75, 0.55, function (S, v, t, p) {
    var end = t + 0.46;
    var o = S.osc(v, 'square', 900 * p, t, end + 0.03);
    var f = 900 * p;
    for (var i = 1; i < 13; i++) {
      f *= 0.78 + S.rand() * 0.14;
      o.frequency.setValueAtTime(Math.max(30, f * (i % 3 === 1 ? 1.5 : 1)), t + i * 0.034);
    }
    var lp = S.filter('lowpass', 2800, 2);
    var g = S.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.004);
    for (var k = 1; k < 13; k++) g.gain.setValueAtTime((k % 2 ? 0.06 : 0.2) * (1 - k / 14), t + k * 0.034);
    g.gain.setTargetAtTime(0, end - 0.03, 0.01);
    o.connect(lp);
    lp.connect(g);
    g.connect(v.out);
    S.nz(v, v.out, t, { ft: 'bandpass', f: 1900, f1: 280, q: 0.8, a: 0.001, d: 0.36, v: 0.22 });
    S.tone(v, v.out, t, { type: 'sine', f: 220 * p, f1: 38 * p, ft: 0.42, a: 0.003, d: 0.52, v: 0.4 });
  }, { cool: 0.1, duck: [0.55, 0.8] });

  // Respawn: three tones converge from far apart onto the tonic chord and swell, then a soft ring.
  def('respawn', 0.62, 0.4, function (S, v, t, p) {
    var b = noteHz(S, 0, 72) * p;
    var to = [1, 1.5, 2];
    var from = [0.45, 2.7, 4.2];
    for (var i = 0; i < 3; i++) {
      S.tone(v, v.out, t, { type: 'sine', f: b * from[i], f1: b * to[i], ft: 0.27, a: 0.26, d: 0.2, v: 0.15 });
    }
    S.fm(v, v.out, t + 0.27, { f: b * 2, ratio: 2, idx: 0.8, idx1: 0.05, a: 0.002, d: 0.28, v: 0.12 });
  }, { cool: 0.1 });

  def('bounce', 0.42, 0.45, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sine', f: 180 * p, f1: 720 * p, ft: 0.12, a: 0.002, d: 0.3, v: 0.44, vib: 30, vibf: 18, vibd: 0.2 });
    S.tone(v, v.out, t, { type: 'triangle', f: 360 * p, f1: 1440 * p, ft: 0.1, a: 0.002, d: 0.12, v: 0.1 });
  }, { cool: 0.04 });

  def('stomp', 0.24, 0.5, function (S, v, t, p) {
    var j = jitter(S, 0.06) * p;
    S.tone(v, v.out, t, { type: 'square', f: 640 * j, f1: 140 * j, ft: 0.08, a: 0.001, d: 0.1, v: 0.2, lp: 2400 });
    S.tone(v, v.out, t, { type: 'sine', f: 160 * j, f1: 58 * j, ft: 0.08, a: 0.001, d: 0.15, v: 0.5 });
    S.nz(v, v.out, t, { ft: 'highpass', f: 1500, a: 0.001, d: 0.04, v: 0.24 });
  }, { cool: 0.03 });

  // ------------------------------------------------------------------ collectibles
  // Shard: one pentatonic step per pickup; consecutive pickups within 0.6 s climb the scale.
  // When the caller drives the chain through pitch (common.js passes 2^(major-pentatonic step/12)),
  // the step is recovered from the pitch and re-mapped onto the current key's pentatonic scale
  // (minor pentatonic in minor modes); otherwise the recipe climbs on its own.
  var shardRun = { i: -1, last: -10, driven: false };
  function pentaIndex(p) {
    var semis = 12 * Math.log(p) / Math.LN2;
    var r = Math.round(semis);
    if (Math.abs(semis - r) > 0.05 || r < 0) return -1;
    var idx = MAJP.indexOf(r % 12);
    return idx < 0 ? -1 : 5 * Math.floor(r / 12) + idx;
  }
  def('shard', 0.42, 0.34, function (S, v, t, p) {
    var k, mul = 1;
    if (Math.abs(p - 1) > 1e-6) {
      shardRun.driven = true;
      k = pentaIndex(p);
      if (k < 0) { k = 0; mul = p; }
    } else if (shardRun.driven) {
      k = 0;
    } else {
      k = t - shardRun.last < 0.6 ? shardRun.i + 1 : 0;
    }
    k = Math.min(k, 15);
    shardRun.i = k;
    shardRun.last = t;
    var T = tonic();
    var sc = T.minor ? MINP : MAJP;
    var f = noteHz(S, sc[k % 5] + 12 * Math.floor(k / 5), 69) * mul;
    S.fm(v, v.out, t, { f: f, ratio: 4, idx: 0.9, idx1: 0.05, a: 0.002, d: 0.3, v: 0.3 });
    S.tone(v, v.out, t, { type: 'sine', f: f * 2, a: 0.001, d: 0.06, v: 0.07 });
  }, { cool: 0.02, max: 4 });

  // Prime gem: a bright bell arpeggio (tonic, fifth, ninth) with a high sparkle.
  def('gem', 1.15, 0.45, function (S, v, t, p) {
    var b = noteHz(S, 0, 72) * p;
    S.fm(v, v.out, t, { f: b, ratio: 3.5, idx: 2.2, a: 0.002, d: 0.95, v: 0.25 });
    S.fm(v, v.out, t + 0.07, { f: b * 1.5, ratio: 3.5, idx: 2, a: 0.002, d: 0.85, v: 0.21 });
    S.fm(v, v.out, t + 0.14, { f: b * 2.25, ratio: 3.5, idx: 1.8, a: 0.002, d: 0.95, v: 0.19 });
    S.nz(v, v.out, t, { ft: 'highpass', f: 6500, a: 0.005, d: 0.42, v: 0.05 });
  });

  // Checkpoint: a struck bell (inharmonic FM partials) with a hum tone and a late fifth.
  def('checkpoint', 2.1, 0.42, function (S, v, t, p) {
    var b = noteHz(S, 0, 72) * p;
    S.fm(v, v.out, t, { f: b, ratio: 1.4, idx: 3.2, idx1: 0.3, it: 0.6, a: 0.002, d: 1.8, v: 0.3 });
    S.fm(v, v.out, t, { f: b * 2, ratio: 3.5, idx: 1.5, idx1: 0.1, it: 0.4, a: 0.002, d: 1.0, v: 0.11 });
    S.tone(v, v.out, t, { type: 'sine', f: b * 0.5, a: 0.004, d: 1.6, v: 0.12 });
    S.tone(v, v.out, t + 0.12, { type: 'sine', f: b * 1.5, a: 0.02, d: 1.2, v: 0.06 });
  }, { cool: 0.2 });

  // Secret: a mysterious whole-tone run resolving onto a sustained twelfth.
  def('secret', 1.3, 0.4, function (S, v, t, p) {
    var b = noteHz(S, 0, 67) * p;
    for (var i = 0; i < 6; i++) {
      S.fm(v, v.out, t + i * 0.05, { f: b * semi(i * 2), ratio: 2, idx: 1.1, a: 0.002, d: 0.22, v: 0.13 });
    }
    S.tone(v, v.out, t + 0.3, { type: 'sine', f: b * semi(19), uni: 6, a: 0.05, d: 0.5, s: 0.6, h: 0.5, r: 0.45, v: 0.1, vib: 3, vibf: 5 });
    S.tone(v, v.out, t + 0.3, { type: 'triangle', f: b * 2, a: 0.03, d: 0.8, v: 0.1 });
  }, { cool: 0.3 });

  // Vertex: a shimmering five-tone chord (one tone per vertex of a pentagon) and rising sparkles.
  def('vertex', 2.7, 0.5, function (S, v, t, p) {
    var b = noteHz(S, 0, 60) * p;
    var ch = [0, 7, 14, 16, 23];
    for (var i = 0; i < 5; i++) {
      S.tone(v, v.out, t + i * 0.03, { type: 'sine', f: b * semi(ch[i]), uni: 7, a: 0.12, d: 0.6, s: 0.7, h: 1.25, r: 1.0, v: 0.09, vib: 3, vibf: 6.5 });
    }
    var sp = [0, 4, 7, 11, 14, 19];
    for (var k = 0; k < 6; k++) {
      S.fm(v, v.out, t + 0.1 + k * 0.11, { f: b * 4 * semi(sp[k]), ratio: 2, idx: 1, a: 0.002, d: 0.32, v: 0.045 });
    }
  }, { cool: 0.5, duck: [0.6, 1.8] });

  // Exit portal: a swirling FM rise over a resonant noise vortex.
  def('portal', 1.15, 0.42, function (S, v, t, p) {
    S.fm(v, v.out, t, { f: 220 * p, f1: 880 * p, ft: 0.8, ratio: 1.5, idx: 4, idx1: 0.5, it: 0.9, a: 0.05, d: 0.9, v: 0.2 });
    S.nz(v, v.out, t, { ft: 'bandpass', f: 300, f1: 5200, st: 0.9, q: 6, a: 0.05, d: 0.9, v: 0.3, pink: true });
    S.tone(v, v.out, t, { type: 'sine', f: 110 * p, a: 0.1, d: 0.9, v: 0.2, vib: 6, vibf: 7 });
  }, { cool: 0.3 });

  // Level complete: an arpeggiated fanfare onto a held chord in the music's mode.
  def('complete', 1.9, 0.5, function (S, v, t, p) {
    var b = noteHz(S, 0, 67) * p;
    var minor = tonic().minor;
    var arp = minor ? [0, 3, 7, 12] : [0, 4, 7, 12];
    for (var i = 0; i < 4; i++) {
      S.tone(v, v.out, t + i * 0.085, { type: 'triangle', f: b * semi(arp[i]), a: 0.002, d: 0.36, v: 0.27, lp: 5200 });
    }
    var ch = minor ? [0, 7, 15, 19] : [0, 7, 16, 19];
    for (var k = 0; k < 4; k++) {
      S.fm(v, v.out, t + 0.36, { f: b * semi(ch[k]), ratio: 2, idx: 1, a: 0.01, d: 1.35, v: 0.09 });
    }
  }, { cool: 0.5, duck: [0.5, 1.4] });

  // ------------------------------------------------------------------ world props and hazards
  // Crumble: granular cracks over a low grinding rumble.
  def('crumble', 0.62, 0.4, function (S, v, t, p) {
    for (var i = 0; i < 6; i++) {
      var tt = t + i * 0.06 + S.rand() * 0.03;
      S.nz(v, v.out, tt, { ft: 'bandpass', f: (900 + S.rand() * 1400) * p, q: 3, a: 0.001, d: 0.04 + S.rand() * 0.04, v: 0.26 });
    }
    S.nz(v, v.out, t, { ft: 'lowpass', f: 320 * p, a: 0.02, d: 0.46, v: 0.26, pink: true });
  }, { cool: 0.05, max: 3 });

  // Break: a sharp crack, a dull thud and glassy inharmonic shards.
  def('break', 0.62, 0.48, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'highpass', f: 1200, a: 0.001, d: 0.09, v: 0.44 });
    S.tone(v, v.out, t, { type: 'sine', f: 130 * p, f1: 48 * p, ft: 0.1, a: 0.001, d: 0.16, v: 0.44 });
    for (var i = 0; i < 3; i++) {
      S.fm(v, v.out, t + 0.01 + i * 0.03, { f: (2200 + S.rand() * 1800) * p, ratio: 2.76, idx: 2, a: 0.001, d: 0.3, v: 0.08 });
    }
  }, { cool: 0.03, max: 3 });

  def('shoot', 0.2, 0.36, function (S, v, t, p) {
    var j = jitter(S, 0.05) * p;
    S.tone(v, v.out, t, { type: 'square', f: 1300 * j, f1: 260 * j, ft: 0.1, a: 0.001, d: 0.12, v: 0.2, lp: 4000 });
    S.nz(v, v.out, t, { ft: 'bandpass', f: 2000, f1: 600, q: 1, a: 0.001, d: 0.06, v: 0.2 });
  }, { cool: 0.03, max: 3 });

  // Laser: a buzzing resonant saw beam with an FM sub-octave growl and sizzle.
  def('laser', 0.58, 0.36, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sawtooth', f: 880 * p, uni: 12, a: 0.005, d: 0.2, s: 0.6, h: 0.3, r: 0.12, v: 0.15, lp: 3600, q: 6, vib: 40, vibf: 30, vibd: 0.02 });
    S.fm(v, v.out, t, { f: 1760 * p, ratio: 0.5, idx: 3, a: 0.003, d: 0.4, v: 0.07 });
    S.nz(v, v.out, t, { ft: 'highpass', f: 5000, a: 0.003, d: 0.3, v: 0.07 });
  }, { cool: 0.03, max: 3 });

  // Charge (telegraph): a swelling, quickening rise that cuts off when it is ready.
  def('charge', 0.52, 0.34, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sine', f: 180 * p, f1: 900 * p, ft: 0.42, a: 0.35, d: 0.12, v: 0.3, vib: 25, vibf: 16, vibd: 0.4 });
    S.tone(v, v.out, t, { type: 'triangle', f: 360 * p, f1: 1800 * p, ft: 0.42, a: 0.35, d: 0.1, v: 0.07 });
  }, { cool: 0.05, max: 3 });

  // Pulse: a soft resonant "bwoom" ring (resonators, beat pulses).
  def('pulse', 0.52, 0.36, function (S, v, t, p) {
    S.fm(v, v.out, t, { f: 220 * p, ratio: 1, idx: 1.5, idx1: 0.1, a: 0.02, d: 0.42, v: 0.28 });
    S.tone(v, v.out, t, { type: 'sine', f: 110 * p, f1: 88 * p, ft: 0.3, a: 0.02, d: 0.42, v: 0.3 });
  }, { cool: 0.04, max: 3 });

  // Chime: a bell on a random pentatonic degree of the current key.
  def('chime', 0.95, 0.34, function (S, v, t, p) {
    var T = tonic();
    var sc = T.minor ? MINP : MAJP;
    var f = noteHz(S, sc[Math.floor(S.rand() * 5)] + 12, 72) * p;
    S.fm(v, v.out, t, { f: f, ratio: 3.5, idx: 1.8, a: 0.002, d: 0.82, v: 0.25 });
    S.tone(v, v.out, t, { type: 'sine', f: f * 2, a: 0.002, d: 0.3, v: 0.05 });
  }, { cool: 0.03, max: 4 });

  // Grow: an organic rising tone with tiny cracking twigs.
  def('grow', 0.62, 0.34, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'triangle', f: 160 * p, f1: 640 * p, ft: 0.45, a: 0.05, d: 0.46, v: 0.22, lp: 1800, lp1: 4200 });
    for (var i = 0; i < 5; i++) {
      S.nz(v, v.out, t + 0.05 + i * 0.08, { ft: 'bandpass', f: (3000 + i * 500) * p, q: 4, a: 0.001, d: 0.02, v: 0.11 });
    }
  }, { cool: 0.05, max: 3 });

  // Split: three falling blips, one per self-similar copy.
  def('split', 0.36, 0.4, function (S, v, t, p) {
    for (var i = 0; i < 3; i++) {
      var k = Math.pow(0.8, i);
      S.tone(v, v.out, t + i * 0.055, { type: 'square', f: 900 * p * k, f1: 600 * p * k, ft: 0.04, a: 0.001, d: 0.06, v: 0.14, lp: 3000 });
    }
    S.nz(v, v.out, t, { ft: 'highpass', f: 2500, a: 0.001, d: 0.05, v: 0.15 });
  }, { cool: 0.03, max: 3 });

  def('hit', 0.16, 0.45, function (S, v, t, p) {
    var j = jitter(S, 0.08) * p;
    S.nz(v, v.out, t, { ft: 'bandpass', f: 1500 * j, q: 0.8, a: 0.001, d: 0.06, v: 0.4 });
    S.tone(v, v.out, t, { type: 'square', f: 300 * j, f1: 120 * j, ft: 0.05, a: 0.001, d: 0.07, v: 0.18, lp: 2000 });
  }, { cool: 0.025, max: 3 });

  // Explode: a darkening noise blast, a sub drop and scattered crackles.
  def('explode', 1.05, 0.55, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'lowpass', f: 5000 * p, f1: 160, st: 0.6, q: 0.7, a: 0.002, d: 0.8, v: 0.55, pink: true });
    S.tone(v, v.out, t, { type: 'sine', f: 110 * p, f1: 32 * p, ft: 0.4, a: 0.002, d: 0.6, v: 0.6 });
    for (var i = 0; i < 4; i++) {
      S.nz(v, v.out, t + 0.05 + S.rand() * 0.3, { ft: 'highpass', f: 2500, a: 0.001, d: 0.03, v: 0.14 });
    }
  }, { cool: 0.05, max: 3, duck: [0.3, 0.4] });

  def('whoosh', 0.5, 0.36, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'bandpass', f: 300 * p, f1: 2400 * p, st: 0.18, q: 1.6, a: 0.06, d: 0.34, v: 0.44, pink: true });
    S.nz(v, v.out, t + 0.12, { ft: 'bandpass', f: 2000 * p, f1: 600 * p, st: 0.25, q: 2.5, a: 0.04, d: 0.24, v: 0.14 });
  }, { cool: 0.04, max: 3 });

  // Rumble: a held low quake with a wavering sub.
  def('rumble', 1.45, 0.5, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'lowpass', f: 140 * p, q: 1.2, a: 0.15, d: 0.6, s: 0.8, h: 0.6, r: 0.6, v: 0.85, rate: 0.6 });
    S.tone(v, v.out, t, { type: 'sine', f: 42 * p, a: 0.1, d: 0.5, s: 0.7, h: 0.7, r: 0.5, v: 0.4, vib: 3, vibf: 5 });
  }, { cool: 0.2, max: 2 });

  // Gust: a swelling airy band with a whistle on top.
  def('gust', 1.25, 0.4, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'bandpass', f: 350 * p, f1: 1400 * p, st: 0.5, q: 1.1, a: 0.3, d: 0.5, s: 0.5, h: 0.5, r: 0.5, v: 0.5, pink: true });
    S.nz(v, v.out, t + 0.1, { ft: 'bandpass', f: 1600 * p, f1: 2400 * p, st: 0.6, q: 8, a: 0.3, d: 0.4, v: 0.12, pink: true });
  }, { cool: 0.15, max: 2 });

  // ------------------------------------------------------------------ bosses
  // Boss hit: weighty sub punch, a metallic clang and a crack.
  def('bossHit', 0.72, 0.6, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sine', f: 95 * p, f1: 38 * p, ft: 0.18, a: 0.001, d: 0.36, v: 0.7 });
    S.fm(v, v.out, t, { f: 320 * p, ratio: 1.41, idx: 5, idx1: 0.3, it: 0.25, a: 0.001, d: 0.5, v: 0.22 });
    S.nz(v, v.out, t, { ft: 'bandpass', f: 2200, f1: 700, q: 0.9, a: 0.001, d: 0.12, v: 0.4 });
  }, { cool: 0.05, duck: [0.25, 0.3] });

  // Boss phase: a reverse swell that lands on a dark stab chord and a sub drop.
  def('bossPhase', 1.65, 0.55, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'bandpass', f: 200, f1: 3000, st: 0.6, q: 2, a: 0.6, d: 0.15, v: 0.34, pink: true });
    S.tone(v, v.out, t, { type: 'sawtooth', f: 55 * p, f1: 110 * p, ft: 0.6, a: 0.55, d: 0.2, v: 0.2, lp: 400, lp1: 3000, lpt: 0.6 });
    var b = noteHz(S, 0, 57) * p;
    var ch = [0, 7, 12, 15];
    for (var i = 0; i < 4; i++) {
      S.tone(v, v.out, t + 0.62, { type: 'sawtooth', f: b * semi(ch[i]), uni: 10, a: 0.003, d: 0.7, v: 0.08, lp: 4000, lp1: 500, lpt: 0.6 });
    }
    S.tone(v, v.out, t + 0.62, { type: 'sine', f: 60 * p, f1: 35 * p, ft: 0.3, a: 0.002, d: 0.62, v: 0.5 });
  }, { cool: 0.3, duck: [0.45, 1.0] });

  // Boss roar: detuned saws and a sub square, growl-modulated, saturated and swept by a formant band.
  def('bossRoar', 1.85, 0.6, function (S, v, t, p) {
    var g = S.gain(0);
    var end = S.env(g.gain, t, 0.5, 0.12, 0.6, 0.7, 1.1, 0.5);
    var stop = end + 0.02;
    var o1 = S.osc(v, 'sawtooth', 62 * p, t, stop);
    var o2 = S.osc(v, 'sawtooth', 65.5 * p, t, stop);
    var o3 = S.osc(v, 'square', 31 * p, t, stop);
    S.sweep(o1.frequency, 62 * p, 47 * p, t, t + 1.4, false);
    S.sweep(o2.frequency, 65.5 * p, 49 * p, t, t + 1.4, false);
    var lfo = S.osc(v, 'square', 23, t, stop);
    var lg = S.gain(9 * p);
    lfo.connect(lg);
    lg.connect(o1.frequency);
    lg.connect(o2.frequency);
    var ws = S.shaper(6);
    var bp = S.filter('bandpass', 300, 3);
    S.sweep(bp.frequency, 300, 900, t, t + 0.5, false);
    bp.frequency.exponentialRampToValueAtTime(250, t + 1.6);
    var pre = S.gain(0.5);
    o1.connect(pre);
    o2.connect(pre);
    o3.connect(pre);
    pre.connect(ws);
    ws.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    S.nz(v, v.out, t, { ft: 'bandpass', f: 700, f1: 300, st: 1.2, q: 1.5, a: 0.1, d: 0.6, s: 0.5, h: 1.0, r: 0.5, v: 0.24, pink: true });
  }, { cool: 0.5, duck: [0.5, 1.4] });

  // Boss death: a long blast, a falling glitch line, then a resolving bell chord.
  def('bossDeath', 3.1, 0.65, function (S, v, t, p) {
    S.nz(v, v.out, t, { ft: 'lowpass', f: 6000, f1: 120, st: 1.5, a: 0.002, d: 1.8, v: 0.6, pink: true });
    S.tone(v, v.out, t, { type: 'sine', f: 90 * p, f1: 25 * p, ft: 1.2, a: 0.002, d: 1.4, v: 0.7 });
    S.tone(v, v.out, t, { type: 'square', f: 1200 * p, f1: 60 * p, ft: 1.0, a: 0.002, d: 1.0, v: 0.08, lp: 2500 });
    var b = noteHz(S, 0, 60) * p;
    var ch = [0, 7, 12, 16, 19];
    for (var i = 0; i < 5; i++) {
      S.fm(v, v.out, t + 1.0 + i * 0.04, { f: b * semi(ch[i]), ratio: 3.5, idx: 1.6, a: 0.003, d: 1.8, v: 0.08 });
    }
  }, { cool: 1, duck: [0.7, 2.4] });

  // ------------------------------------------------------------------ interface (crisp, short)
  def('uiMove', 0.06, 0.26, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sine', f: 1500 * p, a: 0.001, d: 0.03, v: 0.35 });
    S.tone(v, v.out, t, { type: 'square', f: 3000 * p, a: 0.001, d: 0.008, v: 0.05, lp: 6000 });
  }, { cool: 0.025, max: 2 });

  def('uiSelect', 0.22, 0.3, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'triangle', f: 880 * p, a: 0.002, d: 0.07, v: 0.34 });
    S.tone(v, v.out, t + 0.055, { type: 'triangle', f: 1318.5 * p, a: 0.002, d: 0.13, v: 0.34 });
  }, { cool: 0.04 });

  def('uiBack', 0.22, 0.3, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'triangle', f: 1046.5 * p, a: 0.002, d: 0.07, v: 0.3 });
    S.tone(v, v.out, t + 0.055, { type: 'triangle', f: 698.5 * p, a: 0.002, d: 0.13, v: 0.3 });
  }, { cool: 0.04 });

  def('uiDeny', 0.24, 0.3, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'square', f: 140 * p, a: 0.002, d: 0.07, v: 0.22, lp: 1200 });
    S.tone(v, v.out, t + 0.09, { type: 'square', f: 132 * p, a: 0.002, d: 0.09, v: 0.22, lp: 1200 });
  }, { cool: 0.06 });

  def('pause', 0.36, 0.3, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sine', f: 660 * p, f1: 330 * p, ft: 0.18, a: 0.004, d: 0.26, v: 0.3 });
    S.nz(v, v.out, t, { ft: 'lowpass', f: 3000, f1: 300, st: 0.2, a: 0.004, d: 0.2, v: 0.12, pink: true });
  }, { cool: 0.08 });

  def('unpause', 0.36, 0.3, function (S, v, t, p) {
    S.tone(v, v.out, t, { type: 'sine', f: 330 * p, f1: 660 * p, ft: 0.18, a: 0.004, d: 0.26, v: 0.3 });
    S.nz(v, v.out, t, { ft: 'lowpass', f: 300, f1: 3000, st: 0.2, a: 0.004, d: 0.2, v: 0.12, pink: true });
  }, { cool: 0.08 });

  def('toast', 0.62, 0.28, function (S, v, t, p) {
    S.fm(v, v.out, t, { f: 1046.5 * p, ratio: 2, idx: 1, a: 0.002, d: 0.36, v: 0.22 });
    S.fm(v, v.out, t + 0.09, { f: 1568 * p, ratio: 2, idx: 1, a: 0.002, d: 0.46, v: 0.2 });
  }, { cool: 0.1 });

  // Type: one typewriter tick per revealed character.
  def('type', 0.04, 0.16, function (S, v, t, p) {
    var r = (0.85 + S.rand() * 0.3) * p;
    S.nz(v, v.out, t, { ft: 'bandpass', f: 4200 * r, q: 3, a: 0.0005, d: 0.012, v: 0.4 });
    S.tone(v, v.out, t, { type: 'square', f: 1900 * r, a: 0.0005, d: 0.01, v: 0.04, lp: 5000 });
  }, { cool: 0.028, max: 2 });
})(window.AP = window.AP || {});
