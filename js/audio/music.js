/* js/audio/music.js — owner: AUDIO */
(function (AP) {
  'use strict';

  // Seeded generative composer for every AP.MUSIC key (DESIGN §8).
  //  - Tempo and meter come from AP.MUSIC; scheduling follows AP.Beat (realBpm) with a 0.12 s
  //    lookahead from AP.Audio.tick(). Notes are never scheduled in the past; the beat→audio-time
  //    mapping is smoothed and resyncs when the beat jumps back (Beat.reset), stalls or changes tempo.
  //  - The piece is a pure function of (key seed, song bar): 8-bar sections in A A' B A'' cycles,
  //    modal chord progressions, a motif developed by transposition, inversion, retrograde,
  //    rotation, fragmentation, augmentation and diminution, Euclidean rhythms (AP.Algo.euclid,
  //    with a private Bjorklund fallback) and slow mode/texture changes, so it never loops audibly.
  //  - Parts: persistent pad (voice-led, gliding chords), bass, arpeggio, lead, extra counter-line,
  //    percussion, plus 3:4:5 pulse layers for w5/boss5. setIntensity fades layers in and out
  //    (extra 0.4-0.6, drive 0.62-0.8, peak 0.85-0.97) and opens the tone filter.
  //  - music(key) crossfades: the old song stops composing and fades; the new one fades in.

  var A = AP.Audio;
  if (!A || !A.syn || typeof A.setComposer !== 'function') return;
  var S = A.syn;

  var BARS = 8;               // bars per section
  var MAX_STEPS_PER_TICK = 64;

  var MODES = {
    ionian: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
    phrygdom: [0, 1, 4, 5, 7, 8, 10]
  };
  // chord-degree weights per mode (index = scale degree of the chord root): favour each mode's
  // characteristic harmony (Lydian II, Dorian IV, Mixolydian bVII, Phrygian bII ...)
  var DEG_W = {
    ionian: [5, 2, 1, 3, 3, 2, 0],
    dorian: [5, 2, 1, 3, 1, 0, 2],
    phrygian: [5, 3, 1, 1, 0, 2, 2],
    lydian: [5, 3, 1, 0, 2, 2, 1],
    mixolydian: [5, 1, 0, 3, 1, 1, 3],
    aeolian: [5, 0, 1, 3, 1, 3, 3],
    locrian: [4, 3, 1, 1, 0, 2, 2],
    harmonic: [5, 0, 0, 3, 3, 2, 1],
    phrygdom: [5, 3, 0, 2, 0, 1, 2]
  };
  // degrees that lead home at the end of a section
  var CADENCE = {
    ionian: [4, 3], dorian: [3, 6], phrygian: [1, 6], lydian: [1, 4], mixolydian: [6, 3],
    aeolian: [4, 6, 5], locrian: [1, 6], harmonic: [4], phrygdom: [1, 6]
  };
  // endless: the mode follows the segment style
  var STYLE_KEY = {
    w1: [62, 'lydian'], w2: [61, 'dorian'], w3: [65, 'mixolydian'], w4: [57, 'dorian'],
    w5: [64, 'phrygdom'], void: [64, 'locrian'], endless: [57, 'aeolian'], title: [57, 'lydian'], map: [60, 'ionian']
  };

  // ------------------------------------------------------------------ song specs
  // root: MIDI tonic. sub: grid steps per beat. grp: beat grouping (accents). cb: bars per chord.
  // sev: 7th chords on the pad. bright: tone-filter base (Hz). swing: delay of odd steps (fraction).
  // pad {k kind, lv level, cut cutoff, gl glide tau, c centre}; bass {st style, i inst, lv, c};
  // arp {i, lv, k density, st style, c, oct, snd delay send}; lead {i, lv, d density, c, snd, sch};
  // ext {kind, i, lv} (intensity ≥ 0.4); perc [{i, L layer, v, e:[k, rot] | s:[steps], b0}];
  // poly [{k pulses per bar, i, dg degree, o octave, v}]; swell: bars between noise swells;
  // fx {rv reverb send, dl delay send, db delay beats}; dyn: dynamic mode source.
  var SPECS = {
    title: {
      root: 57, mode: 'lydian', sub: 2, grp: [3, 2], cb: 2, sev: true, bright: 5000,
      pad: { k: 'fm', lv: 0.5, cut: 2400, gl: 0.9, c: 62 },
      bass: { st: 'long', i: 'bsub', lv: 0.36, c: 38 },
      arp: { i: 'bell', lv: 0.2, k: 0.3, st: 'walk', c: 74, oct: 2, snd: 0.5 },
      lead: { i: 'bell', lv: 0.13, d: 0.3, c: 81, snd: 0.6, sch: ['qa', 'seq'] },
      ext: { kind: 'bells', i: 'glass', lv: 0.12 },
      perc: [{ i: 'softkick', L: 'drive', v: 0.45, s: [0] }],
      fx: { rv: 0.46, dl: 0.34, db: 1.5 }
    },
    map: {
      root: 60, mode: 'ionian', sub: 4, grp: [4], cb: 1, sev: false, bright: 6000,
      pad: { k: 'tri', lv: 0.34, cut: 1700, gl: 0.08, c: 60 },
      bass: { st: 'roots', i: 'bsine', lv: 0.42, c: 36 },
      arp: { i: 'pluck', lv: 0.3, k: 0.5, st: 'updown', c: 67, oct: 2, snd: 0.35 },
      lead: { i: 'kalimba', lv: 0.18, d: 0.35, c: 76, snd: 0.4 },
      ext: { kind: 'octArp', i: 'glass', lv: 0.12 },
      perc: [
        { i: 'softkick', L: 'perc', v: 0.5, s: [0, 8] },
        { i: 'shaker', L: 'extra', v: 0.25, e: [4, 2] },
        { i: 'rim', L: 'drive', v: 0.3, e: [3, 4] }
      ],
      fx: { rv: 0.3, dl: 0.26, db: 0.75 }
    },
    w1: {
      root: 62, mode: 'lydian', sub: 4, grp: [3], cb: 1, sev: false, bright: 7000,
      pad: { k: 'tri', lv: 0.2, cut: 1400, gl: 0.06, c: 62 },
      bass: { st: 'walk3', i: 'bsine', lv: 0.5, c: 38 },
      arp: { i: 'pluck', lv: 0.32, k: 0.67, st: 'motif', c: 69, oct: 2, snd: 0.3 },
      lead: { i: 'pluck2', lv: 0.22, d: 0.42, c: 78, snd: 0.35 },
      ext: { kind: 'counter', i: 'kalimba', lv: 0.16 },
      perc: [
        { i: 'softkick', L: 'perc', v: 0.75, s: [0] },
        { i: 'hat', L: 'perc', v: 0.42, e: [5, 0] },
        { i: 'shaker', L: 'extra', v: 0.22, e: [7, 1] },
        { i: 'kick', L: 'drive', v: 0.5, s: [6] },
        { i: 'rim', L: 'drive', v: 0.3, e: [3, 2] },
        { i: 'ohat', L: 'peak', v: 0.3, s: [10] }
      ],
      fx: { rv: 0.26, dl: 0.3, db: 0.75 }
    },
    boss1: {
      root: 62, mode: 'aeolian', sub: 4, grp: [3], cb: 1, bright: 6500,
      pad: { k: 'saw', lv: 0.18, cut: 1100, gl: 0.04, c: 57 },
      bass: { st: 'ostinato', i: 'bdrive', lv: 0.48, c: 38 },
      arp: { i: 'pluck', lv: 0.2, k: 0.5, st: 'pedal', c: 62, oct: 1, snd: 0.2 },
      lead: { i: 'lead', lv: 0.17, d: 0.5, c: 74, snd: 0.25 },
      ext: { kind: 'octArp', i: 'glass', lv: 0.12 },
      perc: [
        { i: 'kick', L: 'perc', v: 0.85, s: [0, 6] },
        { i: 'tom', L: 'perc', v: 0.5, e: [5, 3] },
        { i: 'hat', L: 'perc', v: 0.3, e: [9, 0] },
        { i: 'clap', L: 'extra', v: 0.4, s: [4, 8] },
        { i: 'tom', L: 'drive', v: 0.45, e: [7, 1] },
        { i: 'crash', L: 'peak', v: 0.35, s: [0], b0: 1 }
      ],
      fx: { rv: 0.2, dl: 0.16, db: 0.75 }
    },
    w2: {
      root: 61, mode: 'dorian', sub: 4, grp: [4], cb: 2, sev: true, bright: 8000,
      pad: { k: 'fm', lv: 0.28, cut: 2800, gl: 0.25, c: 61 },
      bass: { st: 'pulse', i: 'bsub', lv: 0.5, c: 37 },
      arp: { i: 'glass', lv: 0.26, k: 0.62, st: 'pedal', c: 73, oct: 2, snd: 0.4 },
      lead: { i: 'bell', lv: 0.2, d: 0.34, c: 80, snd: 0.45 },
      ext: { kind: 'octArp', i: 'bell', lv: 0.12 },
      perc: [
        { i: 'shaker', L: 'perc', v: 0.38, e: [5, 0] },
        { i: 'softkick', L: 'perc', v: 0.55, s: [0] },
        { i: 'rim', L: 'extra', v: 0.28, e: [3, 4] },
        { i: 'kick', L: 'drive', v: 0.55, s: [10] },
        { i: 'hat', L: 'drive', v: 0.26, e: [7, 1] },
        { i: 'crash', L: 'peak', v: 0.25, s: [0], b0: 1 }
      ],
      fx: { rv: 0.56, dl: 0.3, db: 1.5 }
    },
    boss2: {
      root: 61, mode: 'phrygian', sub: 4, grp: [4], cb: 1, bright: 7000,
      pad: { k: 'saw', lv: 0.16, cut: 1500, gl: 0.03, c: 56 },
      bass: { st: 'drive', i: 'bdrive', lv: 0.44, c: 37 },
      arp: { i: 'glass', lv: 0.2, k: 0.75, st: 'up', c: 73, oct: 2, snd: 0.25 },
      lead: { i: 'stab', lv: 0.26, d: 0.32, c: 68, snd: 0.15 },
      ext: { kind: 'counter', i: 'bell', lv: 0.14 },
      perc: [
        { i: 'kick', L: 'perc', v: 0.9, e: [4, 0] },
        { i: 'clap', L: 'perc', v: 0.5, s: [4, 12] },
        { i: 'hat', L: 'perc', v: 0.28, e: [11, 0] },
        { i: 'shaker', L: 'extra', v: 0.22, e: [7, 2] },
        { i: 'tom', L: 'drive', v: 0.45, e: [5, 6] },
        { i: 'crash', L: 'peak', v: 0.3, s: [0], b0: 1 }
      ],
      fx: { rv: 0.32, dl: 0.14, db: 0.75 }
    },
    w3: {
      root: 65, mode: 'mixolydian', sub: 2, grp: [3, 2], cb: 2, sev: false, bright: 6000,
      pad: { k: 'saw', lv: 0.36, cut: 1250, gl: 0.4, c: 60 },
      bass: { st: 'groove53', i: 'bsine', lv: 0.44, c: 41 },
      arp: { i: 'bell', lv: 0.16, k: 0.4, st: 'walk', c: 77, oct: 2, snd: 0.45 },
      lead: { i: 'flute', lv: 0.3, d: 0.5, c: 77, snd: 0.4 },
      ext: { kind: 'counter', i: 'kalimba', lv: 0.14 },
      perc: [
        { i: 'softkick', L: 'perc', v: 0.62, s: [0, 6] },
        { i: 'shaker', L: 'extra', v: 0.22, e: [3, 1] },
        { i: 'rim', L: 'drive', v: 0.26, e: [4, 2] },
        { i: 'hat', L: 'drive', v: 0.22, e: [5, 0] },
        { i: 'crash', L: 'peak', v: 0.22, s: [0], b0: 1 }
      ],
      swell: 4,
      fx: { rv: 0.46, dl: 0.34, db: 1 }
    },
    boss3: {
      root: 65, mode: 'aeolian', sub: 4, grp: [3, 2], cb: 1, bright: 6500,
      pad: { k: 'saw', lv: 0.18, cut: 1200, gl: 0.05, c: 60 },
      bass: { st: 'drive', i: 'bdrive', lv: 0.42, c: 41 },
      arp: { i: 'pluck', lv: 0.26, k: 0.8, st: 'swirl', c: 72, oct: 2, snd: 0.3 },
      lead: { i: 'lead', lv: 0.16, d: 0.4, c: 77, snd: 0.3 },
      ext: { kind: 'octArp', i: 'glass', lv: 0.12 },
      perc: [
        { i: 'kick', L: 'perc', v: 0.85, s: [0, 12] },
        { i: 'hat', L: 'perc', v: 0.28, e: [13, 0] },
        { i: 'clap', L: 'perc', v: 0.42, s: [8, 16] },
        { i: 'tom', L: 'extra', v: 0.4, e: [5, 3] },
        { i: 'shaker', L: 'drive', v: 0.22, e: [9, 1] },
        { i: 'crash', L: 'peak', v: 0.3, s: [0], b0: 1 }
      ],
      swell: 2,
      fx: { rv: 0.32, dl: 0.22, db: 0.75 }
    },
    w4: {
      root: 57, mode: 'dorian', sub: 2, grp: [3, 3], cb: 2, sev: true, bright: 7000, swing: 0.16,
      pad: { k: 'tri', lv: 0.18, cut: 1500, gl: 0.08, c: 57 },
      bass: { st: 'six8', i: 'bmarimba', lv: 0.46, c: 45 },
      arp: { i: 'kalimba', lv: 0.26, k: 0.58, st: 'motif', c: 69, oct: 2, snd: 0.3 },
      lead: { i: 'marimba', lv: 0.32, d: 0.5, c: 76, snd: 0.2, sch: ['aug'] },
      ext: { kind: 'counter', i: 'kalimba', lv: 0.14 },
      perc: [
        { i: 'shaker', L: 'perc', v: 0.32, e: [7, 0] },
        { i: 'softkick', L: 'perc', v: 0.6, s: [0, 6] },
        { i: 'rim', L: 'extra', v: 0.26, e: [3, 2] },
        { i: 'kick', L: 'drive', v: 0.5, e: [4, 1] },
        { i: 'hat', L: 'drive', v: 0.22, e: [5, 3] },
        { i: 'crash', L: 'peak', v: 0.24, s: [0], b0: 1 }
      ],
      fx: { rv: 0.28, dl: 0.25, db: 1.5 }
    },
    boss4: {
      root: 57, mode: 'harmonic', sub: 2, grp: [3, 3], cb: 1, bright: 7000,
      pad: { k: 'saw', lv: 0.15, cut: 1200, gl: 0.04, c: 57 },
      bass: { st: 'motifaug', i: 'bdrive', lv: 0.42, c: 45 },
      arp: { i: 'marimba', lv: 0.26, k: 0.84, st: 'motif', c: 69, oct: 2, snd: 0.15 },
      lead: { i: 'lead', lv: 0.17, d: 0.55, c: 76, snd: 0.2, sch: ['aug'] },
      ext: { kind: 'dim', i: 'kalimba', lv: 0.15 },
      perc: [
        { i: 'kick', L: 'perc', v: 0.9, s: [0, 6] },
        { i: 'hat', L: 'perc', v: 0.3, e: [9, 0] },
        { i: 'clap', L: 'extra', v: 0.42, s: [6] },
        { i: 'tom', L: 'drive', v: 0.42, e: [5, 2] },
        { i: 'crash', L: 'peak', v: 0.3, s: [0], b0: 1 }
      ],
      fx: { rv: 0.2, dl: 0.14, db: 1.5 }
    },
    w5: {
      root: 64, mode: 'phrygdom', sub: 4, grp: [4], cb: 2, sev: false, bright: 8000, dyn: 'w5',
      pad: { k: 'choir', lv: 0.34, cut: 2800, gl: 0.3, c: 62 },
      bass: { st: 'roots', i: 'bsub', lv: 0.4, c: 40 },
      arp: { i: 'bell', lv: 0.16, k: 0.32, st: 'walk', c: 76, oct: 2, snd: 0.45 },
      lead: { i: 'bell', lv: 0.18, d: 0.32, c: 83, snd: 0.45 },
      ext: { kind: 'bells', i: 'glass', lv: 0.12 },
      poly: [
        { k: 3, i: 'polyLow', dg: 0, o: -1, v: 0.55 },
        { k: 4, i: 'polyMid', dg: 4, o: 0, v: 0.4 },
        { k: 5, i: 'polyHigh', dg: 2, o: 1, v: 0.32 }
      ],
      perc: [
        { i: 'softkick', L: 'perc', v: 0.5, s: [0] },
        { i: 'hat', L: 'extra', v: 0.22, e: [5, 2] },
        { i: 'kick', L: 'drive', v: 0.5, s: [8] },
        { i: 'shaker', L: 'drive', v: 0.2, e: [7, 1] },
        { i: 'crash', L: 'peak', v: 0.22, s: [0], b0: 1 }
      ],
      fx: { rv: 0.46, dl: 0.3, db: 0.75 }
    },
    boss5: {
      root: 64, mode: 'locrian', sub: 4, grp: [4], cb: 2, sev: false, bright: 6000, dyn: 'boss5',
      pad: { k: 'drone', lv: 0.42, cut: 750, gl: 0.6, c: 52 },
      bass: { st: 'drive', i: 'b808', lv: 0.5, c: 28 },
      arp: { i: 'glass', lv: 0.14, k: 0.44, st: 'pedal', c: 76, oct: 2, snd: 0.35 },
      lead: { i: 'lead', lv: 0.14, d: 0.32, c: 71, snd: 0.3 },
      ext: { kind: 'bells', i: 'bell', lv: 0.12 },
      poly: [
        { k: 3, i: 'polySub', dg: 0, o: -2, v: 0.6 },
        { k: 4, i: 'polyTick', dg: 4, o: 1, v: 0.35 },
        { k: 5, i: 'polyBell', dg: 1, o: 1, v: 0.28 }
      ],
      perc: [
        { i: 'kick', L: 'perc', v: 0.85, s: [0, 8] },
        { i: 'hat', L: 'extra', v: 0.24, e: [7, 0] },
        { i: 'clap', L: 'drive', v: 0.42, s: [4, 12] },
        { i: 'tom', L: 'drive', v: 0.4, e: [3, 5] },
        { i: 'crash', L: 'peak', v: 0.32, s: [0], b0: 1 }
      ],
      fx: { rv: 0.4, dl: 0.2, db: 0.75 }
    },
    endless: {
      root: 57, mode: 'aeolian', sub: 4, grp: [4], cb: 1, sev: false, bright: 8000, dyn: 'endless',
      pad: { k: 'saw', lv: 0.2, cut: 1600, gl: 0.05, c: 60 },
      bass: { st: 'drive', i: 'bdrive', lv: 0.42, c: 40 },
      arp: { i: 'pluck', lv: 0.26, k: 0.7, st: 'updown', c: 69, oct: 2, snd: 0.3 },
      lead: { i: 'glass', lv: 0.17, d: 0.4, c: 79, snd: 0.35 },
      ext: { kind: 'octArp', i: 'bell', lv: 0.12 },
      perc: [
        { i: 'kick', L: 'perc', v: 0.85, e: [4, 0] },
        { i: 'hat', L: 'perc', v: 0.3, e: [9, 1] },
        { i: 'clap', L: 'perc', v: 0.42, s: [4, 12] },
        { i: 'shaker', L: 'extra', v: 0.22, e: [7, 3] },
        { i: 'tom', L: 'drive', v: 0.4, e: [3, 6] },
        { i: 'ohat', L: 'drive', v: 0.24, s: [2, 6, 10, 14] },
        { i: 'crash', L: 'peak', v: 0.28, s: [0], b0: 1 }
      ],
      fx: { rv: 0.24, dl: 0.22, db: 0.75 }
    },
    ending: {
      root: 62, mode: 'lydian', sub: 2, grp: [4], cb: 2, sev: true, bright: 5000,
      pad: { k: 'saw', lv: 0.46, cut: 1500, gl: 0.5, c: 62 },
      bass: { st: 'long', i: 'bsine', lv: 0.42, c: 38 },
      arp: { i: 'bell', lv: 0.18, k: 0.5, st: 'up', c: 74, oct: 2, snd: 0.5 },
      lead: { i: 'flute', lv: 0.24, d: 0.36, c: 74, snd: 0.5, sch: ['qa', 'seq'] },
      ext: { kind: 'bells', i: 'glass', lv: 0.1 },
      perc: [],
      fx: { rv: 0.52, dl: 0.36, db: 1.5 }
    },
    credits: {
      root: 67, mode: 'ionian', sub: 4, grp: [4], cb: 1, sev: true, bright: 6500,
      pad: { k: 'tri', lv: 0.28, cut: 1500, gl: 0.1, c: 62 },
      bass: { st: 'roots', i: 'bsine', lv: 0.42, c: 43 },
      arp: { i: 'pluck', lv: 0.32, k: 0.5, st: 'updown', c: 72, oct: 2, snd: 0.35 },
      lead: { i: 'kalimba', lv: 0.2, d: 0.38, c: 79, snd: 0.4 },
      ext: { kind: 'counter', i: 'bell', lv: 0.12 },
      perc: [
        { i: 'softkick', L: 'perc', v: 0.45, s: [0, 8] },
        { i: 'shaker', L: 'extra', v: 0.22, e: [4, 2] },
        { i: 'rim', L: 'drive', v: 0.26, e: [3, 4] }
      ],
      fx: { rv: 0.36, dl: 0.3, db: 0.75 }
    }
  };

  // ------------------------------------------------------------------ small helpers
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(lo, hi, x) {
    if (x <= lo) return 0;
    if (x >= hi) return 1;
    var u = (x - lo) / (hi - lo);
    return u * u * (3 - 2 * u);
  }
  function hashStr(s) {
    if (typeof AP.hash === 'function') return AP.hash(s) >>> 0;
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function mix(a, b) {
    var h = (a ^ Math.imul(b | 0, 0x9E3779B1)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  // mulberry32 (same family as AP.RNG; private so the composer never depends on load order)
  function Rng(seed) { this.s = seed >>> 0; }
  Rng.prototype.next = function () {
    var a = (this.s = (this.s + 0x6D2B79F5) | 0);
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.int = function (lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  Rng.prototype.chance = function (p) { return this.next() < p; };
  // weighted pick of an index, never `exclude`
  Rng.prototype.wpick = function (w, exclude) {
    var sum = 0, i;
    for (i = 0; i < w.length; i++) if (i !== exclude) sum += w[i];
    var r = this.next() * sum;
    for (i = 0; i < w.length; i++) {
      if (i === exclude) continue;
      r -= w[i];
      if (r < 0) return i;
    }
    return exclude === 0 ? 1 : 0;
  };

  // ------------------------------------------------------------------ Euclidean rhythms
  // AP.Algo.euclid (TOOLS) when present; otherwise the identical private Bjorklund below.
  // Patterns are cached as Uint8Arrays (rotation is to the left, like AP.Algo).
  var eCache = {};
  function bjorklund(k, n) {
    var out = [], i, j;
    if (k <= 0) { for (i = 0; i < n; i++) out.push(0); return out; }
    if (k >= n) { for (i = 0; i < n; i++) out.push(1); return out; }
    var a = [], b = [];
    for (i = 0; i < k; i++) a.push([1]);
    for (i = 0; i < n - k; i++) b.push([0]);
    while (b.length > 1) {
      var m = Math.min(a.length, b.length);
      var na = [];
      for (i = 0; i < m; i++) na.push(a[i].concat(b[i]));
      var rest = a.length > m ? a.slice(m) : b.slice(m);
      a = na;
      b = rest;
    }
    var g = a.concat(b);
    for (i = 0; i < g.length; i++) for (j = 0; j < g[i].length; j++) out.push(g[i][j]);
    return out;
  }
  function euclid(k, n, rot) {
    n = Math.max(1, n | 0);
    k = clamp(k | 0, 0, n);
    rot = (((rot | 0) % n) + n) % n;
    var key = k + ':' + n + ':' + rot;
    var hit = eCache[key];
    if (hit) return hit;
    var arr = null;
    if (AP.Algo && typeof AP.Algo.euclid === 'function') {
      try { arr = AP.Algo.euclid(k, n, rot); } catch (e) { arr = null; }
    }
    if (!arr || arr.length !== n) {
      var base = bjorklund(k, n);
      arr = [];
      for (var i = 0; i < n; i++) arr.push(base[(i + rot) % n]);
    }
    var pat = new Uint8Array(n);
    for (var j = 0; j < n; j++) pat[j] = arr[j] ? 1 : 0;
    eCache[key] = pat;
    return pat;
  }

  // ------------------------------------------------------------------ theory
  function deg2midi(mode, root, deg) {
    var sc = MODES[mode] || MODES.ionian;
    var o = Math.floor(deg / 7);
    return root + sc[deg - o * 7] + 12 * o;
  }
  // octave folding; non-finite input cannot spin the loops (returns the register centre)
  function near(root, c) {
    if (!(root > -500 && root < 500)) return c;
    var r = root;
    while (r < c - 6) r += 12;
    while (r > c + 5) r -= 12;
    return r;
  }
  function fold(m, lo, hi) {
    if (!(m > -500 && m < 500)) return lo;
    while (m < lo) m += 12;
    while (m > hi) m -= 12;
    return m;
  }
  function isMinor(mode) { return (MODES[mode] || MODES.ionian)[2] === 3; }
  // move a scale degree to the nearest tone of the triad on chord root cr
  function snap(deg, cr) {
    var rel = (((deg - cr) % 7) + 7) % 7;
    if (rel === 0 || rel === 2 || rel === 4) return deg;
    return rel === 6 ? deg + 1 : deg - 1;
  }

  // ------------------------------------------------------------------ instruments
  // fn(v, t, f, d): v = music voice (v.out), t = start, f = Hz, d = musical length (s)
  var INST = {
    pluck: function (v, t, f, d) {
      S.tone(v, v.out, t, { type: 'triangle', f: f, a: 0.002, d: clamp(0.14 + d * 0.6, 0.12, 0.7), v: 0.55, lp: Math.min(9000, f * 7), lp1: Math.max(220, f * 1.5), lpt: 0.16 });
    },
    pluck2: function (v, t, f, d) {
      S.tone(v, v.out, t, { type: 'triangle', f: f, a: 0.002, d: clamp(0.18 + d * 0.7, 0.15, 0.9), v: 0.5, lp: Math.min(10000, f * 8), lp1: Math.max(260, f * 2), lpt: 0.2 });
      S.tone(v, v.out, t, { type: 'sine', f: f * 2, a: 0.002, d: 0.12, v: 0.1 });
    },
    bell: function (v, t, f, d) {
      S.fm(v, v.out, t, { f: f, ratio: 3.5, idx: 1.5, idx1: 0.06, it: 0.6, a: 0.002, d: Math.min(1.25, 0.8 + d * 0.4), v: 0.36 });
    },
    glass: function (v, t, f, d) {
      S.fm(v, v.out, t, { f: f, ratio: 2, idx: 1.3, idx1: 0.05, it: 0.25, a: 0.002, d: Math.min(0.95, 0.6 + d * 0.3), v: 0.32 });
      S.tone(v, v.out, t, { type: 'sine', f: Math.min(16000, f * 4.003), a: 0.001, d: 0.12, v: 0.05 });
    },
    marimba: function (v, t, f) {
      S.fm(v, v.out, t, { f: f, ratio: 4, idx: 2.4, idx1: 0.05, it: 0.035, a: 0.001, d: 0.34, v: 0.5 });
    },
    kalimba: function (v, t, f) {
      S.fm(v, v.out, t, { f: f, ratio: 5.4, idx: 1.1, idx1: 0.02, it: 0.025, a: 0.001, d: 0.5, v: 0.3 });
      S.tone(v, v.out, t, { type: 'sine', f: f, a: 0.001, d: 0.55, v: 0.22 });
    },
    // breathy sine flute: delayed vibrato, a soft overblown octave and a band of breath noise
    flute: function (v, t, f, d) {
      var h = Math.max(0.08, d * 0.92);
      S.tone(v, v.out, t, { type: 'sine', f: f, a: 0.05, d: 0.15, s: 0.8, h: h, r: 0.16, v: 0.42, vib: f * 0.011, vibf: 5.1, vibd: Math.min(0.5, h) });
      S.tone(v, v.out, t, { type: 'triangle', f: f * 2, a: 0.06, d: 0.15, s: 0.5, h: h, r: 0.12, v: 0.035 });
      S.nz(v, v.out, t, { ft: 'bandpass', f: Math.min(9000, f * 2), q: 2, a: 0.03, d: 0.1, s: 0.35, h: h, r: 0.1, v: 0.05 });
    },
    lead: function (v, t, f, d) {
      var h = Math.max(0.06, d * 0.85);
      S.tone(v, v.out, t, { type: 'sawtooth', f: f, uni: 10, a: 0.006, d: 0.2, s: 0.55, h: h, r: 0.1, v: 0.2, lp: Math.min(12000, f * 6), lp1: Math.max(300, f * 2.2), lpt: 0.25, q: 2, vib: f * 0.008, vibf: 5.5, vibd: 0.3 });
    },
    // sharp crystalline stab: root, fifth and octave with a closing filter and an inharmonic glint
    stab: function (v, t, f, d) {
      var h = Math.max(0.04, Math.min(0.25, d * 0.6));
      var fr = [1, 1.5, 2];
      for (var i = 0; i < 3; i++) {
        S.tone(v, v.out, t, { type: i === 1 ? 'square' : 'sawtooth', f: f * fr[i], uni: 9, a: 0.002, d: 0.16, s: 0.25, h: h, r: 0.08, v: 0.12, lp: Math.min(14000, f * 10), lp1: Math.max(400, f * 2.5), lpt: 0.12, q: 3 });
      }
      S.fm(v, v.out, t, { f: Math.min(9000, f * 4), ratio: 2.76, idx: 1.5, a: 0.001, d: 0.15, v: 0.05 });
    },
    bsine: function (v, t, f, d) {
      var h = Math.max(0.05, d * 0.9);
      S.tone(v, v.out, t, { type: 'sine', f: f, a: 0.006, d: 0.2, s: 0.75, h: h, r: 0.1, v: 0.6 });
      S.tone(v, v.out, t, { type: 'triangle', f: f * 2, a: 0.006, d: 0.15, s: 0.25, h: h * 0.7, r: 0.08, v: 0.09 });
    },
    bsub: function (v, t, f, d) {
      S.tone(v, v.out, t, { type: 'sine', f: f * 1.5, f1: f, ft: 0.05, a: 0.004, d: 0.3, s: 0.6, h: Math.max(0.05, d * 0.85), r: 0.14, v: 0.68 });
      S.tone(v, v.out, t, { type: 'triangle', f: f * 2, a: 0.004, d: 0.12, v: 0.06 });
    },
    bdrive: function (v, t, f, d) {
      var h = Math.max(0.04, d * 0.8);
      S.tone(v, v.out, t, { type: 'sawtooth', f: f, a: 0.003, d: 0.12, s: 0.35, h: h, r: 0.05, v: 0.3, lp: Math.min(8000, f * 9), lp1: Math.max(90, f * 2), lpt: 0.1, q: 5 });
      S.tone(v, v.out, t, { type: 'sine', f: f, a: 0.003, d: 0.15, s: 0.65, h: h, r: 0.05, v: 0.42 });
    },
    b808: function (v, t, f, d) {
      S.tone(v, v.out, t, { type: 'sine', f: f * 2.2, f1: f, ft: 0.07, a: 0.002, d: 0.5, s: 0.7, h: Math.max(0.1, d), r: 0.2, v: 0.8 });
      S.tone(v, v.out, t, { type: 'triangle', f: f * 2, a: 0.002, d: 0.3, v: 0.1 });
    },
    bmarimba: function (v, t, f, d) {
      S.fm(v, v.out, t, { f: f, ratio: 4, idx: 1.6, idx1: 0.04, it: 0.05, a: 0.002, d: 0.5 + d * 0.3, v: 0.5 });
      S.tone(v, v.out, t, { type: 'sine', f: f, a: 0.002, d: 0.6 + d * 0.3, v: 0.36 });
    },
    // 3:4:5 pulse voices (w5 bells, boss5 void)
    polyLow: function (v, t, f) { S.fm(v, v.out, t, { f: f, ratio: 3.5, idx: 1.2, idx1: 0.05, it: 0.5, a: 0.002, d: 0.85, v: 0.4 }); },
    polyMid: function (v, t, f) {
      S.fm(v, v.out, t, { f: f, ratio: 2, idx: 0.8, idx1: 0.03, it: 0.2, a: 0.002, d: 0.6, v: 0.3 });
      S.nz(v, v.out, t, { ft: 'highpass', f: 6000, a: 0.001, d: 0.02, v: 0.12 });
    },
    polyHigh: function (v, t, f) { S.fm(v, v.out, t, { f: f, ratio: 3, idx: 1, idx1: 0.04, it: 0.2, a: 0.001, d: 0.5, v: 0.26 }); },
    polySub: function (v, t, f) {
      S.tone(v, v.out, t, { type: 'sine', f: f * 2.5, f1: f, ft: 0.06, a: 0.002, d: 0.6, v: 0.8 });
      S.nz(v, v.out, t, { ft: 'lowpass', f: 400, a: 0.002, d: 0.08, v: 0.25, pink: true });
    },
    polyTick: function (v, t, f) {
      S.fm(v, v.out, t, { f: f, ratio: 1.41, idx: 3, idx1: 0.2, it: 0.05, a: 0.001, d: 0.12, v: 0.22 });
      S.nz(v, v.out, t, { ft: 'highpass', f: 7000, a: 0.001, d: 0.025, v: 0.12 });
    },
    polyBell: function (v, t, f) { S.fm(v, v.out, t, { f: f, ratio: 2.76, idx: 1.6, idx1: 0.08, it: 0.6, a: 0.002, d: 0.9, v: 0.22 }); }
  };

  // fn(v, t, j, stepDur): j = onset index within the bar (toms descend through it)
  var DRUM = {
    kick: function (v, t) {
      S.tone(v, v.out, t, { type: 'sine', f: 160, f1: 45, ft: 0.07, a: 0.001, d: 0.3, v: 0.95 });
      S.nz(v, v.out, t, { ft: 'lowpass', f: 1500, a: 0.001, d: 0.012, v: 0.3 });
    },
    softkick: function (v, t) { S.tone(v, v.out, t, { type: 'sine', f: 110, f1: 48, ft: 0.06, a: 0.003, d: 0.24, v: 0.7 }); },
    hat: function (v, t) { S.nz(v, v.out, t, { ft: 'highpass', f: 7500, a: 0.001, d: 0.035, v: 0.32 }); },
    ohat: function (v, t) { S.nz(v, v.out, t, { ft: 'highpass', f: 6500, a: 0.002, d: 0.22, v: 0.24 }); },
    shaker: function (v, t) { S.nz(v, v.out, t, { ft: 'bandpass', f: 5600, q: 1.1, a: 0.014, d: 0.055, v: 0.32 }); },
    tom: function (v, t, j) {
      var f = 150 * Math.pow(0.88, j % 4);
      S.tone(v, v.out, t, { type: 'sine', f: f * 1.6, f1: f, ft: 0.06, a: 0.001, d: 0.32, v: 0.62 });
      S.nz(v, v.out, t, { ft: 'bandpass', f: f * 6, q: 1, a: 0.001, d: 0.04, v: 0.12 });
    },
    clap: function (v, t) {
      for (var i = 0; i < 3; i++) S.nz(v, v.out, t + i * 0.011, { ft: 'bandpass', f: 1300, q: 1.2, a: 0.001, d: i === 2 ? 0.14 : 0.012, v: 0.42 });
    },
    rim: function (v, t) {
      S.tone(v, v.out, t, { type: 'square', f: 820, a: 0.001, d: 0.025, v: 0.14, hp: 600 });
      S.nz(v, v.out, t, { ft: 'bandpass', f: 2400, q: 4, a: 0.001, d: 0.02, v: 0.2 });
    },
    crash: function (v, t) {
      S.nz(v, v.out, t, { ft: 'highpass', f: 4200, a: 0.002, d: 0.95, v: 0.22 });
      S.nz(v, v.out, t, { ft: 'bandpass', f: 9000, q: 0.8, a: 0.002, d: 0.6, v: 0.1 });
    },
    // wind-noise swell over several bars (len = seconds)
    swell: function (v, t, j, len) {
      S.nz(v, v.out, t, { ft: 'bandpass', f: 300, f1: 1800, st: len * 0.55, q: 1.4, a: len * 0.5, d: len * 0.45, v: 0.5, pink: true });
    }
  };

  // ------------------------------------------------------------------ motifs and their development
  // A motif is one bar of events {s step, d degree relative to the chord root, l length in steps, v velocity}.
  var STEPS = [-1, -1, 1, 1, 2, -2, 0, 1, -1, 3, -3, 2];
  function bys(a, b) { return a.s - b.s; }
  function cloneM(m) {
    var o = [];
    for (var i = 0; i < m.length; i++) o.push({ s: m[i].s, d: m[i].d, l: m[i].l, v: m[i].v });
    return o;
  }
  function fixLens(o, n) {
    for (var i = 0; i < o.length; i++) {
      var nx = i + 1 < o.length ? o[i + 1].s : n;
      o[i].l = Math.max(1, Math.min(o[i].l, nx - o[i].s));
    }
    return o;
  }
  function makeMotif(rng, n, dens, strong) {
    var k = clamp(Math.round(n * dens * 0.55) + rng.int(-1, 1), 2, Math.max(2, n - 2));
    var pat = euclid(k, n, rng.int(0, n - 1));
    var notes = [];
    var d = rng.pick([0, 2, 4, 0]);
    var leap = 0;
    for (var s = 0; s < n; s++) {
      if (!pat[s]) continue;
      notes.push({ s: s, d: d, l: 1, v: strong[s] === 2 ? 1 : (strong[s] === 1 ? 0.86 : 0.72) });
      var st;
      if (leap) { st = leap > 0 ? -rng.int(1, 2) : rng.int(1, 2); leap = 0; }   // gap-fill after a leap
      else { st = rng.pick(STEPS); if (st >= 3 || st <= -3) leap = st; }
      d = clamp(d + st, -3, 8);
    }
    var art = rng.pick([1, 1, 0.75, 0.5]);
    for (var i = 0; i < notes.length; i++) {
      var nx = i + 1 < notes.length ? notes[i + 1].s : n;
      notes[i].l = Math.max(1, Math.round((nx - notes[i].s) * art));
    }
    return notes;
  }
  function transpose(m, k) { var o = cloneM(m); for (var i = 0; i < o.length; i++) o[i].d += k; return o; }
  function invert(m) {
    var o = cloneM(m);
    if (!o.length) return o;
    var p = o[0].d;
    for (var i = 0; i < o.length; i++) o[i].d = clamp(2 * p - o[i].d, -5, 10);
    return o;
  }
  function retro(m) {
    var o = cloneM(m);
    for (var i = 0; i < o.length; i++) o[i].d = m[m.length - 1 - i].d;
    return o;
  }
  function rotate(m, r, n) {
    var o = cloneM(m);
    for (var i = 0; i < o.length; i++) o[i].s = (o[i].s + r) % n;
    o.sort(bys);
    return fixLens(o, n);
  }
  function augment(m) {
    var o = cloneM(m);
    for (var i = 0; i < o.length; i++) { o[i].s *= 2; o[i].l *= 2; }
    return o;
  }
  function diminish(m, n) {
    var half = Math.max(1, Math.floor(n / 2));
    var o = [], last = -1, i;
    for (i = 0; i < m.length; i++) {
      var s = Math.floor(m[i].s / 2);
      if (s === last) continue;
      last = s;
      o.push({ s: s, d: m[i].d, l: Math.max(1, Math.round(m[i].l / 2)), v: m[i].v });
    }
    var len = o.length;
    for (i = 0; i < len; i++) if (o[i].s + half < n) o.push({ s: o[i].s + half, d: o[i].d + 1, l: o[i].l, v: o[i].v * 0.9 });
    o.sort(bys);
    return fixLens(o, n);
  }
  function ornament(m, n) {
    var o = [];
    for (var i = 0; i < m.length; i++) {
      o.push({ s: m[i].s, d: m[i].d, l: m[i].l, v: m[i].v });
      var nx = i + 1 < m.length ? m[i + 1] : null;
      if (nx && nx.s - m[i].s >= 3 && nx.d !== m[i].d) {
        o.push({ s: m[i].s + Math.floor((nx.s - m[i].s) / 2), d: m[i].d + (nx.d > m[i].d ? 1 : -1), l: 1, v: m[i].v * 0.75 });
      }
    }
    o.sort(bys);
    return fixLens(o, n);
  }
  function fragment(m, n) {
    var half = Math.max(1, Math.floor(n / 2));
    var o = [], i;
    for (i = 0; i < m.length; i++) if (m[i].s < half) o.push({ s: m[i].s, d: m[i].d, l: Math.min(m[i].l, half - m[i].s), v: m[i].v });
    var len = o.length;
    for (i = 0; i < len; i++) o.push({ s: o[i].s + half, d: o[i].d + 1, l: o[i].l, v: o[i].v * 0.92 });
    if (!o.length) return cloneM(m);
    o.sort(bys);
    return fixLens(o, n);
  }
  function sliceBar(m, from, n) {
    var o = [];
    for (var i = 0; i < m.length; i++) {
      if (m[i].s >= from && m[i].s < from + n) o.push({ s: m[i].s - from, d: m[i].d, l: m[i].l, v: m[i].v });
    }
    return o;
  }
  function mutate(m, rng, n) {
    switch (rng.int(0, 4)) {
      case 0: return transpose(m, rng.pick([1, -1, 2]));
      case 1: return invert(m);
      case 2: return rotate(m, rng.int(1, n - 1), n);
      case 3: return ornament(m, n);
      default: return retro(m);
    }
  }
  function cadence(rng, n) {
    var d = rng.pick([0, 0, 2, 4]);
    var ev = [{ s: 0, d: d, l: Math.max(1, n - 2), v: 0.92 }];
    if (rng.chance(0.5) && n >= 4) ev.push({ s: n - 2, d: d + rng.pick([1, -1, 2]), l: 2, v: 0.7 });
    return ev;
  }
  // four bars developed from motif M
  function phrase(M, sch, rng, n) {
    var k, r;
    switch (sch) {
      case 'qa': return [M, rng.chance(0.5) ? invert(M) : retro(M), rng.chance(0.5) ? M : ornament(M, n), cadence(rng, n)];
      case 'frag': return [M, fragment(M, n), transpose(M, 2), cadence(rng, n)];
      case 'rot':
        r = Math.max(1, Math.round(n / 4));
        return [M, rotate(M, r, n), transpose(rotate(M, 2 * r, n), 1), cadence(rng, n)];
      case 'aug': {
        // self-similar: the motif, the motif augmented over two bars, the motif diminished
        var A2 = augment(M);
        return [M, sliceBar(A2, 0, n), sliceBar(A2, n, n), diminish(M, n)];
      }
      default:
        k = rng.pick([1, 2, -1]);
        return [M, transpose(M, k), rng.chance(0.5) ? transpose(M, 2 * k) : ornament(transpose(M, k), n), cadence(rng, n)];
    }
  }

  // ------------------------------------------------------------------ sections (8 bars, pure in (seed, n))
  function progression(rng, mode, count, letter) {
    var w = DEG_W[mode] || DEG_W.ionian;
    var out = [];
    var prev = -1;
    for (var i = 0; i < count; i++) {
      var d;
      if (i === 0) d = letter === 'B' ? rng.wpick(w, 0) : 0;
      else if (i === count - 1 && count > 1) d = rng.pick(CADENCE[mode] || [4]);
      else d = rng.wpick(w, prev);
      if (d === prev && i > 0) d = rng.wpick(w, prev);
      out.push(d);
      prev = d;
    }
    return out;
  }

  function motifFor(song, letter, cyc) {
    var spec = song.spec;
    var r0 = new Rng(mix(song.seed, letter === 'B' ? 50021 + cyc * 31 : 10007));
    var M = makeMotif(r0, song.n, spec.lead.d, song.strong);
    if (letter === 'B') return M;
    // the A theme evolves a little every cycle (deterministic chain of mutations)
    var steps = cyc % 6;
    for (var i = 1; i <= steps; i++) M = mutate(M, new Rng(mix(song.seed, 20011 + i * 97)), song.n);
    return M;
  }

  function nullRow(n) { var r = new Array(n); for (var i = 0; i < n; i++) r[i] = null; return r; }

  function bput(row, s, mode, broot, c, deg, l, v) {
    if (s < 0 || s >= row.length) return;
    row[s] = { m: fold(deg2midi(mode, broot, deg), c - 7, c + 9), l: Math.max(1, l), v: v };
  }

  function genSection(song, n) {
    var spec = song.spec, N = song.n, sub = song.sub;
    var rng = new Rng(mix(song.seed, n * 7919 + 17));
    var cyc = Math.floor(n / 4), pos = n % 4;
    var letter = pos === 2 ? 'B' : 'A';
    if (spec.dyn === 'endless') pickStyle(song, false);
    var mode = modeFor(song, n), root = rootFor(song);
    var M = motifFor(song, letter, cyc);
    if (pos === 1) M = mutate(M, rng, N);
    else if (pos === 3) M = transpose(M, rng.pick([0, 1, -1]));
    var count = Math.max(1, Math.floor(BARS / spec.cb));
    var prog = progression(rng, mode, count, letter);
    var chord = new Int8Array(BARS);
    var b, s, i;
    for (b = 0; b < BARS; b++) chord[b] = prog[Math.min(count - 1, Math.floor(b / spec.cb))];
    var schemes = spec.lead.sch || ['seq', 'qa', 'frag', 'rot'];
    var ph = phrase(M, rng.pick(schemes), rng, N).concat(phrase(transpose(M, rng.pick([0, 2, -1])), rng.pick(schemes), rng, N));
    var sec = {
      n: n, epoch: song.epoch, letter: letter, mode: mode, root: root, minor: isMinor(mode), chord: chord,
      lead: [], arp: [], arpV: [], bass: [], ext: [], perc: [], pidx: [],
      breakdown: n > 0 && n % 6 === 5 && !/^boss/.test(song.key) && spec.perc.length > 0
    };

    // lead: the developed phrases, strong steps snapped to chord tones, folded into the register
    var lc = spec.lead.c, leadRoot = near(root, lc);
    for (b = 0; b < BARS; b++) {
      var row = nullRow(N), evs = ph[b];
      for (i = 0; i < evs.length; i++) {
        var e = evs[i];
        if (e.s < 0 || e.s >= N) continue;
        var deg = chord[b] + e.d;
        if (song.strong[e.s] === 2) deg = snap(deg, chord[b]);
        row[e.s] = { m: fold(deg2midi(mode, leadRoot, deg), lc - 8, lc + 9), l: e.l, v: e.v };
      }
      sec.lead.push(row);
    }

    // arpeggio: Euclidean rhythm over the chord tones
    var aK = clamp(Math.round(N * spec.arp.k) + rng.int(-1, 1), 1, N);
    var aPat = euclid(aK, N, rng.int(0, 3));
    var ac = spec.arp.c, arpRoot = near(root, ac - 4), oct = spec.arp.oct || 1;
    var walk = rng.int(0, 2);
    var toneDegs = spec.sev ? [0, 2, 4, 6] : [0, 2, 4];
    for (b = 0; b < BARS; b++) {
      var tones = [];
      for (var o = 0; o < oct; o++) for (i = 0; i < toneDegs.length; i++) tones.push(deg2midi(mode, arpRoot, chord[b] + toneDegs[i] + 7 * o));
      var L = tones.length, arow = new Int16Array(N), vrow = new Float32Array(N), j = 0;
      for (s = 0; s < N; s++) {
        if (!aPat[s]) continue;
        var idx;
        switch (spec.arp.st) {
          case 'up': idx = (j + b) % L; break;
          case 'down': idx = L - 1 - ((j + b) % L); break;
          case 'updown':
          case 'swirl': {
            var per = Math.max(1, 2 * L - 2);
            var q = (j + b * 3) % per;
            idx = q < L ? q : per - q;
            break;
          }
          case 'pedal': idx = (j % 2 === 0) ? L - 1 : (((j >> 1) + b) % Math.max(1, L - 1)); break;
          case 'motif': {
            var mm = M[j % M.length].d + (b % 2) * 2;
            idx = ((mm % L) + L) % L;
            break;
          }
          default:
            walk = clamp(walk + rng.pick([-1, 1, 1, -1, 2, -2]), 0, L - 1);
            idx = walk;
        }
        arow[s] = fold(tones[idx], ac - 10, ac + 14);
        vrow[s] = (song.strong[s] === 2 ? 1 : (song.strong[s] === 1 ? 0.84 : 0.68)) * (0.92 + rng.next() * 0.16);
        j++;
      }
      sec.arp.push(arow);
      sec.arpV.push(vrow);
    }

    // bass
    var bc = spec.bass.c, bassRoot = near(root, bc), st = spec.bass.st;
    var g1 = song.grpSteps.length > 1 ? song.grpSteps[1] : Math.floor(N / 2);
    var ostRot = rng.int(0, 3);
    var dPat = euclid(Math.max(2, Math.round(N * 0.6)), N, rng.int(0, 2));
    var A2 = augment(M);
    var OST = [0, 0, 7, 0, 4, 0, 7, 4];
    for (b = 0; b < BARS; b++) {
      var brow = nullRow(N), cd = chord[b], nd = b + 1 < BARS ? chord[b + 1] : 0;
      var appr = nd + (rng.chance(0.5) ? 1 : -1);
      var walkIn = nd !== cd && rng.chance(0.5);
      switch (st) {
        case 'long':
          if (b % spec.cb === 0) bput(brow, 0, mode, bassRoot, bc, cd, N * spec.cb - 1, 0.9);
          break;
        case 'roots':
          bput(brow, 0, mode, bassRoot, bc, cd, Math.max(1, g1 - 1), 0.95);
          bput(brow, g1, mode, bassRoot, bc, rng.chance(0.6) ? cd + 4 : cd + 7, Math.max(1, (walkIn ? N - sub : N) - g1 - 1), 0.8);
          if (walkIn) bput(brow, N - sub, mode, bassRoot, bc, appr, sub, 0.7);
          break;
        case 'walk3': {
          // walking roots in thirds: root-third-fifth (or a turn), approaching the next root
          var v3 = rng.int(0, 2);
          var seq = v3 === 0 ? [0, 2, 4] : (v3 === 1 ? [0, 4, 2] : [7, 4, 2]);
          for (i = 0; i < song.meter; i++) bput(brow, i * sub, mode, bassRoot, bc, cd + seq[i % 3], sub, i === 0 ? 0.95 : 0.78);
          if (walkIn) bput(brow, (song.meter - 1) * sub, mode, bassRoot, bc, appr, sub, 0.75);
          else if (rng.chance(0.3)) {
            bput(brow, (song.meter - 1) * sub, mode, bassRoot, bc, cd + seq[2], Math.max(1, sub >> 1), 0.74);
            bput(brow, (song.meter - 1) * sub + (sub >> 1), mode, bassRoot, bc, cd + 4, Math.max(1, sub >> 1), 0.6);
          }
          break;
        }
        case 'pulse':
          for (i = 0; i < song.meter; i++) bput(brow, i * sub, mode, bassRoot, bc, cd, Math.max(1, sub - 1), i === 0 ? 0.95 : 0.72);
          break;
        case 'ostinato': {
          var half = Math.max(1, sub >> 1);
          for (s = 0, i = 0; s < N; s += half, i++) bput(brow, s, mode, bassRoot, bc, cd + OST[(i + ostRot) % OST.length], half, song.strong[s] ? 0.95 : 0.74);
          break;
        }
        case 'drive':
          for (s = 0; s < N; s++) {
            if (!dPat[s]) continue;
            bput(brow, s, mode, bassRoot, bc, cd + (song.strong[s] === 2 && s > 0 ? 7 : (rng.chance(0.12) ? 4 : 0)), 1, song.strong[s] ? 0.95 : 0.72);
          }
          break;
        case 'groove53': {
          var pick53 = rng.chance(0.4);
          bput(brow, 0, mode, bassRoot, bc, cd, pick53 ? 3 : Math.max(1, g1 - 1), 0.95);
          if (pick53) bput(brow, Math.max(1, g1 - 2), mode, bassRoot, bc, cd + 2, 1, 0.65);
          bput(brow, g1, mode, bassRoot, bc, rng.chance(0.5) ? cd + 4 : cd, Math.max(1, N - g1 - (walkIn ? 2 : 1)), 0.85);
          if (walkIn) bput(brow, N - 1, mode, bassRoot, bc, appr, 1, 0.7);
          break;
        }
        case 'six8':
          bput(brow, 0, mode, bassRoot, bc, cd, Math.max(1, g1 - 1), 0.95);
          bput(brow, g1, mode, bassRoot, bc, rng.chance(0.55) ? cd + 4 : cd + 7, Math.max(1, (walkIn ? N - 2 : N) - g1 - 1), 0.82);
          if (walkIn) bput(brow, N - 2, mode, bassRoot, bc, appr, 2, 0.68);
          break;
        case 'motifaug': {
          // self-similar bass: the motif augmented across bar pairs; root pulses fill the gaps
          var hb = sliceBar(A2, (b % 2) * N, N);
          for (i = 0; i < hb.length; i++) bput(brow, hb[i].s, mode, bassRoot, bc, cd + hb[i].d, hb[i].l, 0.9);
          if (!brow[0]) bput(brow, 0, mode, bassRoot, bc, cd, 2, 0.9);
          if (!brow[g1]) bput(brow, g1, mode, bassRoot, bc, cd, 2, 0.8);
          break;
        }
        default:
          bput(brow, 0, mode, bassRoot, bc, cd, N - 1, 0.9);
      }
      sec.bass.push(brow);
    }

    // extra melodic layer (fades in from intensity 0.4)
    var ek = spec.ext ? spec.ext.kind : null;
    var ec = ek === 'counter' ? Math.max(55, lc - 12) : (ek === 'bells' ? 84 : (ek === 'dim' ? lc + 5 : ac + 12));
    var extRoot = near(root, ec);
    for (b = 0; b < BARS; b++) {
      var xrow = nullRow(N);
      if (ek === 'octArp') {
        var jj = 0;
        for (s = 0; s < N; s++) {
          if (sec.arp[b][s] && (jj++ & 1) === 0) xrow[s] = { m: fold(sec.arp[b][s] + 12, ec - 10, ec + 12), l: 2, v: 0.6 };
        }
      } else if (ek === 'counter') {
        // inverted counter-line, half as dense and twice as long
        var cm = invert(ph[b]);
        for (i = 0; i < cm.length; i += 2) {
          var ce = cm[i];
          if (ce.s >= 0 && ce.s < N) xrow[ce.s] = { m: fold(deg2midi(mode, extRoot, chord[b] + ce.d), ec - 8, ec + 8), l: Math.max(1, Math.min(N - ce.s, ce.l * 2)), v: 0.7 };
        }
      } else if (ek === 'bells') {
        if (b % 2 === 0) {
          for (i = 0; i < song.grpSteps.length; i++) {
            xrow[song.grpSteps[i]] = { m: fold(deg2midi(mode, extRoot, chord[b] + rng.pick([4, 7, 9, 11])), ec - 7, ec + 8), l: Math.max(2, N >> 1), v: 0.6 };
          }
        }
      } else if (ek === 'dim') {
        var dm = diminish(ph[b], N);
        for (i = 0; i < dm.length; i++) {
          if (dm[i].s >= 0 && dm[i].s < N) xrow[dm[i].s] = { m: fold(deg2midi(mode, extRoot, chord[b] + dm[i].d), ec - 8, ec + 10), l: dm[i].l, v: 0.65 };
        }
      }
      sec.ext.push(xrow);
    }

    // percussion patterns (Euclidean, rotated in B sections and sometimes in A'')
    for (i = 0; i < spec.perc.length; i++) {
      var pe = spec.perc[i], pat = new Uint8Array(N), pidx = new Int8Array(N);
      if (pe.s) {
        for (var qq = 0; qq < pe.s.length; qq++) if (pe.s[qq] < N) pat[pe.s[qq]] = 1;
      } else if (pe.e) {
        var kk = clamp(pe.e[0] + (rng.chance(0.2) ? rng.pick([-1, 1]) : 0), 1, N);
        var rr = pe.e[1] + (letter === 'B' ? 1 : 0) + (pos === 3 && rng.chance(0.4) ? 2 : 0);
        pat.set(euclid(kk, N, rr));
      }
      var cnt = 0;
      for (s = 0; s < N; s++) if (pat[s]) pidx[s] = cnt++;
      sec.perc.push(pat);
      sec.pidx.push(pidx);
    }

    song.tonic.root = root;
    song.tonic.minor = sec.minor;
    song.curMode = mode;
    return sec;
  }

  function modeFor(song, n) {
    var spec = song.spec;
    if (spec.dyn === 'w5') {
      // Phrygian dominant, resolving toward Lydian in later sections and in the last W5 levels
      var L = AP.level;
      var idx = (L && L.world === 5 && L.index) ? L.index : 1;
      var prog = clamp((idx - 3) / 3, 0, 1);
      var p = n === 0 ? 0 : (n % 4 === 3 ? 0.3 : 0.05) + prog * 0.5 + Math.min(0.15, n * 0.015);
      return new Rng(mix(song.seed, n * 131 + 7)).next() < p ? 'lydian' : 'phrygdom';
    }
    if (spec.dyn === 'boss5') {
      // Locrian at first, brightening with each phase; resolves to Lydian on defeat
      if (song.resolved) return 'lydian';
      return ['locrian', 'phrygian', 'aeolian', 'phrygdom'][song.bossCat | 0];
    }
    if (spec.dyn === 'endless' && song.styleMode) return song.styleMode;
    return spec.mode;
  }
  function rootFor(song) { return (song.spec.dyn === 'endless' && song.styleRoot) ? song.styleRoot : song.spec.root; }
  function bossCat(norm) { return norm < 0.34 ? 0 : (norm < 0.67 ? 1 : (norm < 0.99 ? 2 : 3)); }

  function pickStyle(song, bump) {
    var st = segStyle;
    var L = AP.level;
    if (L && L.style && STYLE_KEY[L.style]) st = L.style;
    var sk = st ? STYLE_KEY[st] : null;
    if (!sk || (song.styleRoot === sk[0] && song.styleMode === sk[1])) return;
    song.styleRoot = sk[0];
    song.styleMode = sk[1];
    if (bump) song.epoch++;
  }

  function section(song, n) {
    var sec = song.cache[n];
    if (sec && sec.epoch === song.epoch) return sec;
    sec = genSection(song, n);
    if (!song.cache[n]) {
      song.cacheKeys.push(n);
      if (song.cacheKeys.length > 3) delete song.cache[song.cacheKeys.shift()];
    }
    song.cache[n] = sec;
    return sec;
  }

  // ------------------------------------------------------------------ songs
  var LAYERS = ['pad', 'bass', 'arp', 'lead', 'ext', 'perc', 'extra', 'drive', 'peak'];
  var THRU_TONE = { pad: 1, arp: 1, lead: 1, ext: 1 };
  var PAD_WAVE = { saw: 'sawtooth', tri: 'triangle', fm: 'sine', choir: 'sawtooth', drone: 'sawtooth' };
  var PAD_LV = { saw: 0.085, tri: 0.16, fm: 0.14, choir: 0.11, drone: 0.1 };
  var DRUM_PAN = { hat: 0.22, ohat: 0.26, shaker: -0.24, rim: 0.12, clap: -0.06, crash: 0.18 };
  var PULSE_PAN = [-0.35, 0, 0.35];
  var FIVE = [0, 2, 5, 2, 4];

  var cur = null;
  var old = [];
  var intensityVal = 0;
  var segStyle = null;
  var bossNorm = 0;

  function Song(key, now, fade) {
    var spec = SPECS[key];
    var mus = (AP.MUSIC && AP.MUSIC[key]) || { bpm: 120, meter: 4 };
    this.key = key;
    this.spec = spec;
    this.meter = Math.max(1, mus.meter | 0);
    this.sub = spec.sub;
    this.n = this.meter * this.sub;
    this.seed = mix(hashStr('apeiron:music:' + key), 0x5EED);
    this.strong = new Uint8Array(this.n);
    this.grpSteps = [];
    var acc = 0, gi = 0, grp = spec.grp || [this.meter];
    for (var bt = 0; bt < this.meter; bt++) {
      var isG = bt === acc;
      if (isG) { this.grpSteps.push(bt * this.sub); acc += grp[gi % grp.length]; gi++; }
      this.strong[bt * this.sub] = isG ? 2 : 1;
    }
    this.swing = spec.swing || 0;
    this.epoch = 0;
    this.cache = {};
    this.cacheKeys = [];
    this.tonic = { root: spec.root, minor: isMinor(spec.mode) };
    this.curMode = spec.mode;
    this.bossCat = spec.dyn === 'boss5' ? bossCat(bossNorm) : 0;
    this.resolved = false;
    this.styleRoot = 0;
    this.styleMode = null;
    this.synced = false;
    this.cursor = 0;
    this.origin = 0;
    this.spb = 0;
    this.lastBeat = 0;
    this.barOffset = 0;
    this.offsetSet = false;
    this.lastSongBar = -1;
    this.pq = spec.poly ? new Float64Array(spec.poly.length) : null;
    this.padCur = [0, 0, 0, 0];
    this.tmp = [0, 0, 0, 0];
    this.pcs = [0, 0, 0, 0];
    this.used = new Uint8Array(4);
    this.padSet = false;
    this.padDeg = -99;
    this.padMode = null;
    this.padRoot = 0;
    this.persist = [];
    this.lv = {};
    this.offAt = {};
    this.toneHz = 0;
    this.f0 = 0; this.f1 = 0; this.ft0 = 0; this.ft1 = 0;
    this.freeT0 = -1;
    this.comp = 0;
    if (spec.dyn === 'endless') pickStyle(this, false);
    this.build(now, fade);
  }

  Song.prototype.build = function (now, fade) {
    var G = S.G, spec = this.spec;
    this.xf = S.gain(0);
    this.xf.connect(G.music);
    this.tone = S.filter('lowpass', spec.bright, 0.5);
    this.tone.connect(this.xf);
    this.layer = {};
    for (var i = 0; i < LAYERS.length; i++) {
      var L = LAYERS[i];
      var g = S.gain(0);
      g.connect(THRU_TONE[L] ? this.tone : this.xf);
      this.layer[L] = g;
      this.offAt[L] = -1e9;
    }
    this.xfD = S.gain(0);
    this.xfD.connect(G.dlyIn);
    this.send = {
      arp: S.gain(spec.arp.snd * spec.fx.dl * 1.6),
      lead: S.gain(spec.lead.snd * spec.fx.dl * 1.6),
      ext: S.gain(0.4 * spec.fx.dl * 1.6)
    };
    this.send.arp.connect(this.xfD);
    this.send.lead.connect(this.xfD);
    this.send.ext.connect(this.xfD);
    this.fadeTo(1, now, fade);
    S.glide(G.rvbMusic.gain, spec.fx.rv, now, 0.6);
    this.pad = buildPad(this, now);
    this.applyIntensity(now, true);
  };

  // value of the crossfade gain at time `now` (tracked here: cancelAndHold is not universal)
  Song.prototype.fadeVal = function (now) {
    if (now >= this.ft1) return this.f1;
    if (now <= this.ft0) return this.f0;
    return this.f0 + (this.f1 - this.f0) * (now - this.ft0) / (this.ft1 - this.ft0);
  };
  Song.prototype.fadeTo = function (target, now, dur) {
    dur = Math.max(0.02, dur);
    var v = this.fadeVal(now);
    var ps = [this.xf.gain, this.xfD.gain];
    for (var i = 0; i < 2; i++) {
      ps[i].cancelScheduledValues(now);
      ps[i].setValueAtTime(v, now);
      ps[i].linearRampToValueAtTime(target, now + dur);
    }
    this.f0 = v; this.f1 = target; this.ft0 = now; this.ft1 = now + dur;
  };

  Song.prototype.dispose = function (now) {
    for (var i = 0; i < this.persist.length; i++) {
      try { this.persist[i].stop(now + 0.05); } catch (e) { /* already stopped */ }
    }
    this.persist.length = 0;
    try { this.xf.disconnect(); } catch (e2) { /* detached */ }
    try { this.xfD.disconnect(); } catch (e3) { /* detached */ }
    this.cache = {};
    this.cacheKeys.length = 0;
  };

  function setLayer(song, L, val, now, instant) {
    var prev = song.lv[L];
    if (!instant && prev !== undefined && Math.abs(prev - val) < 0.004) return;
    song.lv[L] = val;
    if (val <= 0.004 && prev > 0.004) song.offAt[L] = now;
    S.glide(song.layer[L].gain, val, now, instant ? 0.01 : 0.7);
  }
  // a layer keeps composing for 2.2 s after it is faded out, so removal is a smooth fade
  function on(song, L, now) { return song.lv[L] > 0.004 || now - song.offAt[L] < 2.2; }

  Song.prototype.applyIntensity = function (now, instant) {
    var spec = this.spec, I = intensityVal;
    var x = smooth(0.4, 0.6, I), dr = smooth(0.62, 0.8, I), pk = smooth(0.85, 0.97, I);
    setLayer(this, 'pad', spec.pad.lv, now, instant);
    setLayer(this, 'bass', spec.bass.lv, now, instant);
    setLayer(this, 'arp', spec.arp.lv, now, instant);
    setLayer(this, 'lead', spec.lead.lv * (0.8 + 0.2 * smooth(0.15, 0.4, I)), now, instant);
    setLayer(this, 'ext', spec.ext ? spec.ext.lv * x : 0, now, instant);
    setLayer(this, 'perc', 1, now, instant);
    setLayer(this, 'extra', x, now, instant);
    setLayer(this, 'drive', dr, now, instant);
    setLayer(this, 'peak', pk, now, instant);
    var hz = Math.min(18000, spec.bright * (1 + 1.5 * I));
    if (instant || Math.abs(hz - this.toneHz) > 40) {
      this.toneHz = hz;
      S.glide(this.tone.frequency, hz, now, instant ? 0.01 : 0.8);
    }
  };

  function pOsc(song, type, f, t) {
    var o = S.context().createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start(t);
    song.persist.push(o);
    return o;
  }

  // persistent pad: 4 voices x 2 detuned oscillators (FM pairs, formant "choir" or dark drone)
  function buildPad(song, t) {
    var spec = song.spec.pad, k = spec.k;
    var P = { v: [], ratio: 2, sub: null };
    var lp = S.filter('lowpass', spec.cut, 0.6);
    lp.connect(song.layer.pad);
    var bus = lp, i;
    if (k === 'choir') {
      bus = S.gain(1);
      var F = [[700, 7, 1], [1150, 8, 0.55], [2700, 9, 0.22]];
      var f1 = null;
      for (i = 0; i < 3; i++) {
        var bp = S.filter('bandpass', F[i][0], F[i][1]);
        var fg = S.gain(F[i][2] * 2.4);
        bus.connect(bp);
        bp.connect(fg);
        fg.connect(lp);
        if (i === 0) f1 = bp;
      }
      var vl = pOsc(song, 'sine', 0.06, t);      // slow vowel morph (ah ↔ oh)
      var vg = S.gain(140);
      vl.connect(vg);
      vg.connect(f1.frequency);
    }
    var shared = null;
    if (k === 'fm') {
      var il = pOsc(song, 'sine', 0.09, t);      // breathing modulation index
      shared = S.gain(90);
      il.connect(shared);
    }
    for (i = 0; i < 4; i++) {
      var g = S.gain(PAD_LV[k] || 0.1);
      var o1 = pOsc(song, PAD_WAVE[k] || 'sawtooth', 220, t);
      var o2 = pOsc(song, PAD_WAVE[k] || 'sawtooth', 220, t);
      o1.detune.value = -5 - i * 1.5;
      o2.detune.value = 6 + i * 2;
      o1.connect(g);
      o2.connect(g);
      var mod = null;
      if (k === 'fm') {
        mod = pOsc(song, 'sine', 440, t);
        var mg = S.gain(120);
        mod.connect(mg);
        mg.connect(o1.frequency);
        mg.connect(o2.frequency);
        shared.connect(mg.gain);
      }
      g.connect(bus);
      P.v.push({ o1: o1, o2: o2, mod: mod });
    }
    if (k === 'drone') {
      P.sub = pOsc(song, 'sine', 41.2, t);
      var sg = S.gain(0.55);
      P.sub.connect(sg);
      sg.connect(song.layer.pad);
    }
    var dl = pOsc(song, 'sine', 0.045 + (song.seed % 7) * 0.006, t);   // slow filter drift
    var dg = S.gain(spec.cut * 0.3);
    dl.connect(dg);
    dg.connect(lp.frequency);
    return P;
  }

  // greedy voice leading: each pad voice moves to the nearest unused chord tone
  function voicePad(song, sec, deg) {
    var c = song.spec.pad.c, out = song.tmp, curv = song.padCur, pcs = song.pcs, used = song.used;
    var pr = near(sec.root, c), i, j;
    pcs[0] = deg2midi(sec.mode, pr, deg);
    pcs[1] = deg2midi(sec.mode, pr, deg + 2);
    pcs[2] = deg2midi(sec.mode, pr, deg + 4);
    pcs[3] = song.spec.sev ? deg2midi(sec.mode, pr, deg + 6) : pcs[0] + 12;
    for (i = 0; i < 4; i++) pcs[i] = fold(pcs[i], c - 7, c + 8);
    if (!song.padSet) {
      for (i = 0; i < 4; i++) out[i] = pcs[i];
      for (i = 1; i < 4; i++) {
        var x = out[i];
        for (j = i - 1; j >= 0 && out[j] > x; j--) out[j + 1] = out[j];
        out[j + 1] = x;
      }
      return;
    }
    for (i = 0; i < 4; i++) used[i] = 0;
    for (i = 0; i < 4; i++) {
      var best = 0, bestM = curv[i], bestD = 1e9;
      for (j = 0; j < 4; j++) {
        if (used[j]) continue;
        var m = pcs[j];
        while (m - curv[i] > 6) m -= 12;
        while (curv[i] - m > 6) m += 12;
        m = fold(m, c - 12, c + 12);
        var dd = Math.abs(m - curv[i]);
        if (dd < bestD) { bestD = dd; best = j; bestM = m; }
      }
      used[best] = 1;
      out[i] = bestM;
    }
  }

  function padChord(song, sec, b, t) {
    var P = song.pad;
    if (!P) return;
    var deg = sec.chord[b];
    if (song.padSet && deg === song.padDeg && sec.mode === song.padMode && sec.root === song.padRoot) return;
    voicePad(song, sec, deg);
    var tau = song.padSet ? song.spec.pad.gl : 0.004;
    for (var i = 0; i < 4; i++) {
      var f = S.mtof(song.tmp[i]);
      var pv = P.v[i];
      S.glide(pv.o1.frequency, f, t, tau);
      S.glide(pv.o2.frequency, f, t, tau);
      if (pv.mod) S.glide(pv.mod.frequency, f * P.ratio, t, tau);
      song.padCur[i] = song.tmp[i];
    }
    if (P.sub) S.glide(P.sub.frequency, S.mtof(fold(sec.root, 26, 37)), t, 0.8);
    song.padSet = true;
    song.padDeg = deg;
    song.padMode = sec.mode;
    song.padRoot = sec.root;
  }

  // ------------------------------------------------------------------ note and drum voices
  function note(song, L, inst, t, midi, d, vel, pan, sendL) {
    var fn = INST[inst];
    if (!fn) return;
    var v = S.musicVoice(song.layer[L], t, 0.01, vel, pan, inst);
    S.setTail(0.9);
    try { fn(v, t, S.mtof(midi), d); } finally { S.setTail(1.2); }
    if (sendL) (v.pan || v.out).connect(song.send[sendL]);
  }

  // All drum hits of one layer on one step share a single music voice (keeps within the cap).
  var PX = { out: null, srcs: null, end: 0 };
  var hitI = [], hitV = [], hitJ = [], hitN = 0;
  function flushDrums(song, L, t, stepDur) {
    if (!hitN) return;
    var single = hitN === 1;
    var v = S.musicVoice(song.layer[L], t, 0.01, 1, single ? (DRUM_PAN[hitI[0]] || 0) : 0, 'drums');
    for (var i = 0; i < hitN; i++) {
      var g = S.gain(hitV[i]);
      if (!single && DRUM_PAN[hitI[i]] && S.G.canPan) {
        var p = S.context().createStereoPanner();
        p.pan.value = DRUM_PAN[hitI[i]];
        g.connect(p);
        p.connect(v.out);
      } else {
        g.connect(v.out);
      }
      PX.out = g;
      PX.srcs = v.srcs;
      PX.end = v.end;
      S.setTail(0.9);
      try { DRUM[hitI[i]](PX, t, hitJ[i], stepDur); } finally { S.setTail(1.2); }
      if (PX.end > v.end) v.end = PX.end;
    }
    PX.out = null;
    PX.srcs = null;
    hitN = 0;
  }
  function addHit(inst, vel, j) {
    hitI[hitN] = inst;
    hitV[hitN] = vel;
    hitJ[hitN] = j;
    hitN++;
  }

  var PERC_LAYERS = ['perc', 'extra', 'drive', 'peak'];
  function accentOf(song, s) { return song.strong[s] === 2 ? 1 : (song.strong[s] === 1 ? 0.86 : 0.74); }

  function playStep(song, c, t, stepDur, now) {
    var spec = song.spec, N = song.n;
    var bb = Math.floor(c / N), s = c - bb * N;
    var bar = bb + song.barOffset;
    if (bar < 0) return;
    song.lastSongBar = bar;
    var secN = Math.floor(bar / BARS), b = bar - secN * BARS;
    var sec = section(song, secN);
    var tt = (song.swing && (s & 1)) ? t + song.swing * stepDur : t;

    if (s === 0 || !song.padSet) padChord(song, sec, b, t);

    if (spec.swell && s === 0 && bar % spec.swell === 0 && on(song, 'perc', now)) {
      var len = spec.swell * N * stepDur * 0.95;
      var sv = S.musicVoice(song.layer.perc, t, 0.01, 0.55, 0, 'swell');
      S.setTail(0.9);
      try { DRUM.swell(sv, t, 0, len); } finally { S.setTail(1.2); }
    }

    // percussion, grouped per layer
    var P = spec.perc;
    for (var li = 0; li < PERC_LAYERS.length; li++) {
      var L = PERC_LAYERS[li];
      if (!on(song, L, now)) continue;
      for (var j = 0; j < P.length; j++) {
        var e = P[j];
        if (e.L !== L || !sec.perc[j][s]) continue;
        if (e.b0 && (b % 4 !== 0 || s !== 0)) continue;
        if (sec.breakdown && L !== 'peak' && e.i !== 'softkick' && e.i !== 'hat' && e.i !== 'shaker') continue;
        addHit(e.i, e.v * accentOf(song, s), sec.pidx[j][s]);
      }
      if (L === 'peak' && b === BARS - 1 && s >= N - song.sub) addHit('tom', 0.55, N - s);
      flushDrums(song, L, tt, stepDur);
    }

    var be = sec.bass[b][s];
    if (be && on(song, 'bass', now)) note(song, 'bass', spec.bass.i, tt, be.m, be.l * stepDur, be.v, 0, null);
    var am = sec.arp[b][s];
    if (am && on(song, 'arp', now)) note(song, 'arp', spec.arp.i, tt, am, stepDur * 2, sec.arpV[b][s], (s & 2) ? 0.22 : -0.22, 'arp');
    var le = sec.lead[b][s];
    if (le && !sec.breakdown && on(song, 'lead', now)) note(song, 'lead', spec.lead.i, tt, le.m, le.l * stepDur, le.v, 0.08, 'lead');
    var xe = sec.ext[b][s];
    if (xe && on(song, 'ext', now)) note(song, 'ext', spec.ext.i, tt, xe.m, xe.l * stepDur, xe.v, -0.3, 'ext');
  }

  // one pulse of a 3:4:5 layer (q = absolute pulse index since beat 0)
  function playPulse(song, i, q, t, now) {
    var e = song.spec.poly[i];
    var beatBar = Math.floor(q / e.k);
    var inBar = q - beatBar * e.k;
    var bar = beatBar + song.barOffset;
    if (bar < 0 || !on(song, 'perc', now)) return;
    var sec = section(song, Math.floor(bar / BARS));
    var b = bar % BARS;
    var deg = sec.chord[b] + e.dg + (e.k === 5 ? FIVE[inBar % 5] : 0);
    var m = deg2midi(sec.mode, near(sec.root, 60 + 12 * e.o), deg);
    note(song, 'perc', e.i, t, m, 0.4, e.v * (inBar === 0 ? 1 : 0.74), PULSE_PAN[i % 3], null);
  }

  // ------------------------------------------------------------------ the scheduler
  // Audio reaches the speakers outputLatency after it is rendered, while the beat is seen about one
  // frame after the game clock crosses it: schedule that much earlier (clamped) so sound meets sight.
  function latencyComp() {
    var ctx = S.context();
    var lat = ctx ? (+ctx.outputLatency || +ctx.baseLatency || 0) : 0;
    return clamp(lat - 0.016, 0, 0.06);
  }

  function resync(song, beat, now, spb, back) {
    var tempoChanged = Math.abs(spb - song.spb) > 1e-6;
    song.spb = spb;
    song.origin = now - beat * spb;
    var lateBeats = (0.03 + song.comp) / spb;
    song.cursor = Math.max(0, Math.ceil((beat - lateBeats) * song.sub));
    var beatBar = Math.floor(song.cursor / song.n);
    if (!song.offsetSet) {
      song.barOffset = -beatBar;
      song.offsetSet = true;
    } else if (back) {
      song.barOffset = (song.lastSongBar + 1) - beatBar;   // continue the composition where it was
    }
    if (song.pq) {
      for (var i = 0; i < song.pq.length; i++) {
        var per = song.meter / song.spec.poly[i].k;
        song.pq[i] = Math.max(0, Math.ceil((beat - lateBeats) / per));
      }
    }
    song.synced = true;
    if (tempoChanged && song === cur) {
      var G = S.G;
      var dt = clamp(song.spec.fx.db * spb, 0.06, 1.9);
      S.glide(G.dL.delayTime, dt, now, 0.05);
      S.glide(G.dR.delayTime, dt, now, 0.05);
    }
  }

  // schedule everything of one song up to the lookahead horizon on its current grid
  function advance(song, now) {
    var spb = song.spb;
    var horizon = now + S.LOOKAHEAD;
    var stepBeats = 1 / song.sub;
    var stepDur = spb * stepBeats;
    for (var g = 0; g < MAX_STEPS_PER_TICK; g++) {
      var tt = song.origin + song.cursor * stepBeats * spb - song.comp;
      if (tt >= horizon) break;
      if (tt >= now - 0.03 - song.comp) playStep(song, song.cursor, Math.max(tt, now + 0.002), stepDur, now);
      song.cursor++;
    }
    if (song.pq) {
      var Pl = song.spec.poly;
      for (var k = 0; k < Pl.length; k++) {
        var per = song.meter / Pl[k].k;
        for (var h = 0; h < 24; h++) {
          var q = song.pq[k];
          var tp = song.origin + q * per * spb - song.comp;
          if (tp >= horizon) break;
          if (tp >= now - 0.03 - song.comp) playPulse(song, k, q, Math.max(tp, now + 0.002), now);
          song.pq[k] = q + 1;
        }
      }
    }
  }

  function tick(now) {
    // fading songs keep playing on their own last grid (the beat may already follow the new key)
    for (var i = old.length - 1; i >= 0; i--) {
      var o = old[i];
      if (now >= o.ft1 + 2.5) {
        o.dispose(now);
        old[i] = old[old.length - 1];
        old.length--;
      } else if (o.synced && o.spb > 0 && now < o.ft1) {
        advance(o, now);
      }
    }
    var song = cur;
    if (!song) return;
    var B = AP.Beat, beat, bpm;
    if (B && typeof B.beat === 'number' && typeof B.realBpm === 'function') {
      beat = B.beat;
      bpm = B.realBpm();
    } else {
      // no gameplay clock: free-run at the key's tempo
      bpm = (AP.MUSIC && AP.MUSIC[song.key] && AP.MUSIC[song.key].bpm) || 120;
      if (song.freeT0 < 0) song.freeT0 = now;
      beat = (now - song.freeT0) * bpm / 60;
    }
    if (!(bpm > 1) || !(beat >= 0)) return;
    var spb = 60 / bpm;
    var est = now - beat * spb;
    var back = song.synced && beat < song.lastBeat - 1e-6;
    if (!song.synced || back || Math.abs(spb - song.spb) > 1e-6 || Math.abs(est - song.origin) > 0.08) {
      song.comp = latencyComp();
      resync(song, beat, now, spb, back);
    } else {
      song.origin += (est - song.origin) * 0.05;   // smooth step/frame jitter out of the mapping
    }
    song.lastBeat = beat;
    advance(song, now);
  }

  function latestFading(dyn) {
    for (var i = old.length - 1; i >= 0; i--) if (!dyn || old[i].spec.dyn === dyn) return old[i];
    return null;
  }

  // ------------------------------------------------------------------ composer (registered with AP.Audio)
  var C = {
    has: function (key) { return !!SPECS[key]; },
    play: function (key, fade) {
      var ctx = S.context();
      if (!ctx || !S.G) return;
      var now = ctx.currentTime;
      fade = clamp(+fade || 0, 0, 20);
      if (cur) {
        cur.fadeTo(0, now, Math.max(0.05, fade));
        old.push(cur);
        cur = null;
      }
      if (key && SPECS[key]) cur = new Song(key, now, Math.max(0.05, fade));
    },
    tick: tick,
    hold: function () { if (cur) cur.synced = false; },
    resync: function () { if (cur) cur.synced = false; },
    setIntensity: function (x) {
      intensityVal = clamp(+x || 0, 0, 1);
      var ctx = S.context();
      if (cur && ctx) cur.applyIntensity(ctx.currentTime, false);
    },
    onBoss: function (norm) {
      bossNorm = clamp(+norm || 0, 0, 1);
      if (cur && cur.spec.dyn === 'boss5' && !cur.resolved) {
        var cat = bossCat(bossNorm);
        if (cat !== cur.bossCat) { cur.bossCat = cat; cur.epoch++; }
      }
    },
    onDefeat: function () {
      // LevelScene fades the boss music before emitting boss:defeat, so the fading song resolves too
      var s5 = (cur && cur.spec.dyn === 'boss5') ? cur : latestFading('boss5');
      if (s5 && !s5.resolved) { s5.resolved = true; s5.epoch++; }
      bossNorm = 0;
    },
    onSegment: function (style) {
      if (typeof style === 'string') segStyle = style;
      if (cur && cur.spec.dyn === 'endless') pickStyle(cur, true);
    },
    info: function () {
      if (!cur) return { key: null, fading: old.length, intensity: intensityVal };
      return {
        key: cur.key, bar: cur.lastSongBar, section: cur.lastSongBar >= 0 ? Math.floor(cur.lastSongBar / BARS) : 0,
        mode: cur.curMode, root: cur.tonic.root, intensity: intensityVal, synced: cur.synced, fading: old.length
      };
    }
  };

  A.setComposer(C);
  // current tonic for key-aware SFX (shards, chimes, bells): {root: MIDI, minor: bool} or null
  A.tonic = function () {
    if (cur) return cur.tonic;
    var f = latestFading(null);
    return f ? f.tonic : null;
  };
})(window.AP = window.AP || {});
