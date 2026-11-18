/* tools/lib/stubs-audio.js — owner: TOOLS */
(function (G) {
  'use strict';
  // Runs INSIDE the harness vm context. Web Audio stub: AudioContext (+ webkitAudioContext,
  // OfflineAudioContext), every common node type, AudioParam automation with the same
  // exceptions browsers throw (non-finite values → TypeError, negative times → RangeError,
  // exponential ramps to 0 → RangeError, double start() → InvalidStateError ...), and a
  // currentTime that follows the harness's virtual clock while the context is running.
  // Source nodes fire 'ended' when the virtual clock passes their stop/natural end time.
  // The graph (connections) and voice counts are recorded for --audio reports.
  G.__AP_STUBS = G.__AP_STUBS || {};
  G.__AP_STUBS.audio = function installAudio(S) {
    var DOMException = S.DOMException;
    var issue = S.issue;
    S.audio = { contexts: [], nodes: 0, active: [], maxActive: 0, started: 0, ended: 0, pastSchedules: 0, automationEvents: 0, connections: 0, errors: 0 };
    var A = S.audio;

    function isFin(v) { return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity; }
    function needFinite(v, iface, method) {
      if (typeof v !== 'number') v = +v;
      if (!(v === v && v !== Infinity && v !== -Infinity)) {
        A.errors++;
        throw new TypeError("Failed to execute '" + method + "' on '" + iface + "': The provided " + (method === 'value' ? 'float' : 'double') + ' value is non-finite.');
      }
      return v;
    }
    function needTime(t, iface, method, argName) {
      t = needFinite(t, iface, method);
      if (t < 0) { A.errors++; throw new RangeError("Failed to execute '" + method + "' on '" + iface + "': The " + (argName || 'time') + ' provided (' + t + ') is less than the minimum bound (0).'); }
      return t;
    }
    function mixEv(o) {
      o.addEventListener = S.EventTargetProto.addEventListener;
      o.removeEventListener = S.EventTargetProto.removeEventListener;
      o.dispatchEvent = S.EventTargetProto.dispatchEvent;
    }

    // ------------------------------------------------------------ AudioParam
    function AudioParam(ctx, name, def, min, max) {
      this._ctx = ctx; this._name = name; this._v = def;
      this.defaultValue = def; this.minValue = min; this.maxValue = max; this.automationRate = 'a-rate';
      this._events = 0;
    }
    Object.defineProperty(AudioParam.prototype, 'value', {
      get: function () { return this._v; },
      set: function (v) {
        if (typeof v !== 'number') v = +v;
        if (!(v === v && v !== Infinity && v !== -Infinity)) { A.errors++; throw new TypeError("Failed to set the 'value' property on 'AudioParam': The provided float value is non-finite."); }
        this._v = v;
      }
    });
    function sched(p, t, method) {
      p._events++;
      A.automationEvents++;
      if (p._events === 20000) issue('audio-automation', 'AudioParam "' + p._name + '" accumulated 20000 automation events (missing cancelScheduledValues?)', 'warn', true);
      var now = p._ctx.currentTime;
      if (t > 0 && t < now - 0.002) { A.pastSchedules++; if (A.pastSchedules <= 3) issue('audio-past', method + ' on "' + p._name + '" scheduled at ' + t.toFixed(3) + ' s, already in the past (currentTime ' + now.toFixed(3) + ')', 'warn', true); }
    }
    AudioParam.prototype.setValueAtTime = function (v, t) {
      v = needFinite(v, 'AudioParam', 'setValueAtTime'); t = needTime(t, 'AudioParam', 'setValueAtTime', 'start time');
      sched(this, t, 'setValueAtTime'); if (t <= this._ctx.currentTime) this._v = v; return this;
    };
    AudioParam.prototype.linearRampToValueAtTime = function (v, t) {
      v = needFinite(v, 'AudioParam', 'linearRampToValueAtTime'); t = needTime(t, 'AudioParam', 'linearRampToValueAtTime', 'end time');
      sched(this, t, 'linearRampToValueAtTime'); this._v = v; return this;
    };
    AudioParam.prototype.exponentialRampToValueAtTime = function (v, t) {
      v = needFinite(v, 'AudioParam', 'exponentialRampToValueAtTime'); t = needTime(t, 'AudioParam', 'exponentialRampToValueAtTime', 'end time');
      if (v === 0) { A.errors++; throw new RangeError("Failed to execute 'exponentialRampToValueAtTime' on 'AudioParam': The float target value provided (0) should not be in the range (-1.40130e-45, 1.40130e-45)."); }
      sched(this, t, 'exponentialRampToValueAtTime'); this._v = v; return this;
    };
    AudioParam.prototype.setTargetAtTime = function (v, t, tc) {
      v = needFinite(v, 'AudioParam', 'setTargetAtTime'); t = needTime(t, 'AudioParam', 'setTargetAtTime', 'start time');
      tc = needFinite(tc, 'AudioParam', 'setTargetAtTime');
      if (tc < 0) { A.errors++; throw new RangeError("Failed to execute 'setTargetAtTime' on 'AudioParam': Time constant (" + tc + ') must be non-negative.'); }
      sched(this, t, 'setTargetAtTime'); return this;
    };
    AudioParam.prototype.setValueCurveAtTime = function (values, t, dur) {
      if (!values || typeof values.length !== 'number') throw new TypeError("Failed to execute 'setValueCurveAtTime' on 'AudioParam': The provided value cannot be converted to a sequence.");
      if (values.length < 2) { A.errors++; throw DOMException("Failed to execute 'setValueCurveAtTime' on 'AudioParam': The curve length provided (" + values.length + ') is less than the minimum bound (2).', 'InvalidStateError'); }
      for (var i = 0; i < values.length; i++) if (!isFin(+values[i])) { A.errors++; throw new TypeError("Failed to execute 'setValueCurveAtTime' on 'AudioParam': The provided float value is non-finite."); }
      t = needTime(t, 'AudioParam', 'setValueCurveAtTime', 'start time');
      dur = needFinite(dur, 'AudioParam', 'setValueCurveAtTime');
      if (dur <= 0) { A.errors++; throw new RangeError("Failed to execute 'setValueCurveAtTime' on 'AudioParam': The duration provided (" + dur + ') is less than or equal to the minimum bound (0).'); }
      sched(this, t, 'setValueCurveAtTime'); this._v = +values[values.length - 1]; return this;
    };
    AudioParam.prototype.cancelScheduledValues = function (t) { needTime(t, 'AudioParam', 'cancelScheduledValues', 'cancel time'); this._events = 0; return this; };
    AudioParam.prototype.cancelAndHoldAtTime = function (t) { needTime(t, 'AudioParam', 'cancelAndHoldAtTime', 'cancel time'); this._events = 0; return this; };
    G.AudioParam = AudioParam;

    // ------------------------------------------------------------ AudioNode
    function AudioNode(ctx, kind, ins, outs) {
      this.context = ctx; this._kind = kind; this.numberOfInputs = ins; this.numberOfOutputs = outs;
      this.channelCount = 2; this.channelCountMode = 'max'; this.channelInterpretation = 'speakers';
      this._out = [];
      A.nodes++;
      mixEv(this);
    }
    AudioNode.prototype.connect = function (dest, output, input) {
      if (!dest || typeof dest !== 'object' || !(dest instanceof AudioNode || dest instanceof AudioParam)) {
        throw new TypeError("Failed to execute 'connect' on 'AudioNode': Overload resolution failed.");
      }
      var dctx = dest instanceof AudioParam ? dest._ctx : dest.context;
      if (dctx !== this.context) { A.errors++; throw DOMException("Failed to execute 'connect' on 'AudioNode': cannot connect to an AudioNode belonging to a different audio context.", 'InvalidAccessError'); }
      if (this.numberOfOutputs === 0) { A.errors++; throw DOMException("Failed to execute 'connect' on 'AudioNode': output index (0) exceeds number of outputs (0).", 'IndexSizeError'); }
      if (this._out.indexOf(dest) < 0) this._out.push(dest);
      A.connections++;
      return dest instanceof AudioNode ? dest : undefined;
    };
    AudioNode.prototype.disconnect = function (dest) {
      if (dest === undefined || typeof dest === 'number') { this._out.length = 0; return; }
      var i = this._out.indexOf(dest);
      if (i < 0) { A.errors++; throw DOMException("Failed to execute 'disconnect' on 'AudioNode': the given destination is not connected.", 'InvalidAccessError'); }
      this._out.splice(i, 1);
    };
    G.AudioNode = AudioNode;

    function nodeType(name, kind, ins, outs, init) {
      var C = function (ctx, opts) {
        if (!(ctx instanceof BaseAudioContext)) throw new TypeError("Failed to construct '" + name + "': parameter 1 is not of type 'BaseAudioContext'.");
        AudioNode.call(this, ctx, kind, ins, outs);
        if (init) init.call(this, ctx, opts || {});
      };
      C.prototype = Object.create(AudioNode.prototype);
      C.prototype.constructor = C;
      G[name] = C;
      return C;
    }

    // ------------------------------------------------------------ sources
    function sourceInit(ctx) { this._started = false; this._stopped = false; this._startAt = 0; this._endAt = Infinity; this._ended = false; this.onended = null; }
    function sourceStart(when) {
      when = when === undefined ? 0 : needTime(when, this._kind, 'start', 'start time');
      if (this._started) { A.errors++; throw DOMException("Failed to execute 'start' on '" + this._kind + "': cannot call start more than once.", 'InvalidStateError'); }
      var now = this.context.currentTime;
      if (when > 0 && when < now - 0.002) { A.pastSchedules++; if (A.pastSchedules <= 3) issue('audio-past', this._kind + '.start(' + when.toFixed(3) + ') is in the past (currentTime ' + now.toFixed(3) + ')', 'warn', true); }
      this._started = true;
      this._startAt = Math.max(when, now);
      A.started++;
      A.active.push(this);
      if (A.active.length > A.maxActive) A.maxActive = A.active.length;
    }
    function sourceStop(when) {
      when = when === undefined ? 0 : needTime(when, this._kind, 'stop', 'stop time');
      if (!this._started) { A.errors++; throw DOMException("Failed to execute 'stop' on '" + this._kind + "': cannot call stop without calling start first.", 'InvalidStateError'); }
      var t = Math.max(when, this.context.currentTime);
      if (t < this._endAt) this._endAt = t;
    }
    var Osc = nodeType('OscillatorNode', 'OscillatorNode', 0, 1, function (ctx, o) {
      sourceInit.call(this, ctx);
      this._type = o.type || 'sine';
      this.frequency = new AudioParam(ctx, 'OscillatorNode.frequency', o.frequency || 440, -24000, 24000);
      this.detune = new AudioParam(ctx, 'OscillatorNode.detune', o.detune || 0, -153600, 153600);
    });
    Object.defineProperty(Osc.prototype, 'type', {
      get: function () { return this._type; },
      set: function (v) {
        if (v === 'custom') { A.errors++; throw DOMException("Failed to set the 'type' property on 'OscillatorNode': 'type' cannot be set directly to 'custom'.  Use setPeriodicWave() to create a custom Oscillator type.", 'InvalidStateError'); }
        if (['sine', 'square', 'sawtooth', 'triangle'].indexOf(v) >= 0) this._type = v;
      }
    });
    Osc.prototype.start = sourceStart;
    Osc.prototype.stop = sourceStop;
    Osc.prototype.setPeriodicWave = function (w) { if (!(w instanceof PeriodicWave)) throw new TypeError("Failed to execute 'setPeriodicWave': parameter 1 is not of type 'PeriodicWave'."); this._type = 'custom'; };

    var BufSrc = nodeType('AudioBufferSourceNode', 'AudioBufferSourceNode', 0, 1, function (ctx, o) {
      sourceInit.call(this, ctx);
      this._buffer = null; this._bufferSet = false;
      this.playbackRate = new AudioParam(ctx, 'AudioBufferSourceNode.playbackRate', 1, -3.4e38, 3.4e38);
      this.detune = new AudioParam(ctx, 'AudioBufferSourceNode.detune', 0, -3.4e38, 3.4e38);
      this.loop = !!o.loop; this.loopStart = 0; this.loopEnd = 0;
      if (o.buffer) this.buffer = o.buffer;
    });
    Object.defineProperty(BufSrc.prototype, 'buffer', {
      get: function () { return this._buffer; },
      set: function (b) {
        if (b !== null && !(b instanceof AudioBuffer)) throw new TypeError("Failed to set the 'buffer' property on 'AudioBufferSourceNode': The provided value is not of type 'AudioBuffer'.");
        if (b && this._bufferSet) { A.errors++; throw DOMException("Failed to set the 'buffer' property on 'AudioBufferSourceNode': Cannot set buffer to non-null after it has been already been set to a non-null buffer", 'InvalidStateError'); }
        if (b) this._bufferSet = true;
        this._buffer = b;
      }
    });
    BufSrc.prototype.start = function (when, offset, duration) {
      sourceStart.call(this, when);
      if (offset !== undefined) needTime(offset, 'AudioBufferSourceNode', 'start', 'offset');
      if (duration !== undefined) { needTime(duration, 'AudioBufferSourceNode', 'start', 'duration'); this._endAt = Math.min(this._endAt, this._startAt + duration); }
      if (!this.loop && this._buffer) {
        var rate = Math.abs(this.playbackRate.value) || 1;
        this._endAt = Math.min(this._endAt, this._startAt + Math.max(0, this._buffer.duration - (offset || 0)) / rate);
      } else if (!this.loop && !this._buffer) {
        this._endAt = Math.min(this._endAt, this._startAt);
      }
    };
    BufSrc.prototype.stop = sourceStop;

    var Const = nodeType('ConstantSourceNode', 'ConstantSourceNode', 0, 1, function (ctx, o) {
      sourceInit.call(this, ctx);
      this.offset = new AudioParam(ctx, 'ConstantSourceNode.offset', o.offset === undefined ? 1 : o.offset, -3.4e38, 3.4e38);
    });
    Const.prototype.start = sourceStart;
    Const.prototype.stop = sourceStop;

    // ------------------------------------------------------------ processing nodes
    nodeType('GainNode', 'GainNode', 1, 1, function (ctx, o) { this.gain = new AudioParam(ctx, 'GainNode.gain', o.gain === undefined ? 1 : o.gain, -3.4e38, 3.4e38); });
    var Biquad = nodeType('BiquadFilterNode', 'BiquadFilterNode', 1, 1, function (ctx, o) {
      this._type = o.type || 'lowpass';
      this.frequency = new AudioParam(ctx, 'BiquadFilterNode.frequency', 350, 0, 24000);
      this.detune = new AudioParam(ctx, 'BiquadFilterNode.detune', 0, -153600, 153600);
      this.Q = new AudioParam(ctx, 'BiquadFilterNode.Q', 1, -3.4e38, 3.4e38);
      this.gain = new AudioParam(ctx, 'BiquadFilterNode.gain', 0, -3.4e38, 1541);
    });
    Object.defineProperty(Biquad.prototype, 'type', {
      get: function () { return this._type; },
      set: function (v) { if (['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'].indexOf(v) >= 0) this._type = v; else issue('audio-enum', 'BiquadFilterNode.type "' + v + '" is invalid (ignored)', 'warn', true); }
    });
    Biquad.prototype.getFrequencyResponse = function (f, m, p) {
      if (!f || !m || !p || f.length !== m.length || f.length !== p.length) { A.errors++; throw DOMException("Failed to execute 'getFrequencyResponse' on 'BiquadFilterNode': array lengths differ.", 'InvalidAccessError'); }
      for (var i = 0; i < f.length; i++) { m[i] = 1; p[i] = 0; }
    };
    var Comp = nodeType('DynamicsCompressorNode', 'DynamicsCompressorNode', 1, 1, function (ctx) {
      this.threshold = new AudioParam(ctx, 'DynamicsCompressorNode.threshold', -24, -100, 0);
      this.knee = new AudioParam(ctx, 'DynamicsCompressorNode.knee', 30, 0, 40);
      this.ratio = new AudioParam(ctx, 'DynamicsCompressorNode.ratio', 12, 1, 20);
      this.attack = new AudioParam(ctx, 'DynamicsCompressorNode.attack', 0.003, 0, 1);
      this.release = new AudioParam(ctx, 'DynamicsCompressorNode.release', 0.25, 0, 1);
    });
    Object.defineProperty(Comp.prototype, 'reduction', { get: function () { return 0; } });
    nodeType('StereoPannerNode', 'StereoPannerNode', 1, 1, function (ctx) { this.pan = new AudioParam(ctx, 'StereoPannerNode.pan', 0, -1, 1); });
    var Panner = nodeType('PannerNode', 'PannerNode', 1, 1, function (ctx) {
      var self = this;
      ['positionX', 'positionY', 'positionZ', 'orientationY', 'orientationZ'].forEach(function (n) { self[n] = new AudioParam(ctx, 'PannerNode.' + n, 0, -3.4e38, 3.4e38); });
      this.orientationX = new AudioParam(ctx, 'PannerNode.orientationX', 1, -3.4e38, 3.4e38);
      this.panningModel = 'equalpower'; this.distanceModel = 'inverse'; this.refDistance = 1; this.maxDistance = 10000;
      this.rolloffFactor = 1; this.coneInnerAngle = 360; this.coneOuterAngle = 360; this.coneOuterGain = 0;
    });
    Panner.prototype.setPosition = function () {};
    Panner.prototype.setOrientation = function () {};
    nodeType('DelayNode', 'DelayNode', 1, 1, function (ctx, o) {
      var max = o.maxDelayTime === undefined ? 1 : o.maxDelayTime;
      if (!(max > 0 && max < 180)) { A.errors++; throw DOMException("Failed to execute 'createDelay' on 'BaseAudioContext': The max delay time provided (" + max + ') is outside the range (0, 180).', 'NotSupportedError'); }
      this.delayTime = new AudioParam(ctx, 'DelayNode.delayTime', o.delayTime || 0, 0, max);
    });
    var Conv = nodeType('ConvolverNode', 'ConvolverNode', 1, 1, function () { this._buffer = null; this.normalize = true; });
    Object.defineProperty(Conv.prototype, 'buffer', {
      get: function () { return this._buffer; },
      set: function (b) {
        if (b !== null && !(b instanceof AudioBuffer)) throw new TypeError("Failed to set the 'buffer' property on 'ConvolverNode': The provided value is not of type 'AudioBuffer'.");
        if (b && b.numberOfChannels !== 1 && b.numberOfChannels !== 2 && b.numberOfChannels !== 4) { A.errors++; throw DOMException('ConvolverNode buffer must have 1, 2 or 4 channels', 'NotSupportedError'); }
        if (b && b.sampleRate !== this.context.sampleRate) { A.errors++; throw DOMException("Failed to set the 'buffer' property on 'ConvolverNode': The buffer sample rate " + b.sampleRate + ' does not match the context rate of ' + this.context.sampleRate + ' Hz.', 'NotSupportedError'); }
        this._buffer = b;
      }
    });
    var Shaper = nodeType('WaveShaperNode', 'WaveShaperNode', 1, 1, function () { this._curve = null; this._over = 'none'; });
    Object.defineProperty(Shaper.prototype, 'curve', {
      get: function () { return this._curve; },
      set: function (c) {
        if (c !== null && !(c instanceof Float32Array)) throw new TypeError("Failed to set the 'curve' property on 'WaveShaperNode': The provided value is not of type 'Float32Array'.");
        if (c && c.length < 2) { A.errors++; throw DOMException("Failed to set the 'curve' property on 'WaveShaperNode': The curve length provided (" + c.length + ') is less than the minimum bound (2).', 'InvalidAccessError'); }
        this._curve = c;
      }
    });
    Object.defineProperty(Shaper.prototype, 'oversample', { get: function () { return this._over; }, set: function (v) { if (['none', '2x', '4x'].indexOf(v) >= 0) this._over = v; } });
    var Analyser = nodeType('AnalyserNode', 'AnalyserNode', 1, 1, function () { this._fft = 2048; this.minDecibels = -100; this.maxDecibels = -30; this.smoothingTimeConstant = 0.8; });
    Object.defineProperty(Analyser.prototype, 'fftSize', {
      get: function () { return this._fft; },
      set: function (v) { if (v < 32 || v > 32768 || (v & (v - 1))) { A.errors++; throw DOMException("Failed to set the 'fftSize' property on 'AnalyserNode': The value provided (" + v + ') is not a power of two between 32 and 32768.', 'IndexSizeError'); } this._fft = v; }
    });
    Object.defineProperty(Analyser.prototype, 'frequencyBinCount', { get: function () { return this._fft / 2; } });
    Analyser.prototype.getFloatFrequencyData = function (a) { for (var i = 0; i < a.length; i++) a[i] = -100; };
    Analyser.prototype.getByteFrequencyData = function (a) { for (var i = 0; i < a.length; i++) a[i] = 0; };
    Analyser.prototype.getFloatTimeDomainData = function (a) { for (var i = 0; i < a.length; i++) a[i] = 0; };
    Analyser.prototype.getByteTimeDomainData = function (a) { for (var i = 0; i < a.length; i++) a[i] = 128; };
    nodeType('ChannelSplitterNode', 'ChannelSplitterNode', 1, 6);
    nodeType('ChannelMergerNode', 'ChannelMergerNode', 6, 1);
    nodeType('IIRFilterNode', 'IIRFilterNode', 1, 1);
    var Dest = nodeType('AudioDestinationNode', 'AudioDestinationNode', 1, 0, function () { this.maxChannelCount = 2; });

    // ------------------------------------------------------------ buffers / waves
    function AudioBuffer(o) {
      o = o || {};
      var ch = o.numberOfChannels === undefined ? 1 : o.numberOfChannels, len = o.length, rate = o.sampleRate;
      if (!(ch >= 1 && ch <= 32)) { A.errors++; throw DOMException("Failed to execute 'createBuffer' on 'BaseAudioContext': The number of channels provided (" + ch + ') is outside the range [1, 32].', 'NotSupportedError'); }
      if (!(len >= 1)) { A.errors++; throw DOMException("Failed to execute 'createBuffer' on 'BaseAudioContext': The number of frames provided (" + len + ') is less than or equal to the minimum bound (0).', 'NotSupportedError'); }
      if (!(rate >= 3000 && rate <= 768000)) { A.errors++; throw DOMException("Failed to execute 'createBuffer' on 'BaseAudioContext': The sample rate provided (" + rate + ') is outside the range [3000, 768000].', 'NotSupportedError'); }
      if (len > 48000 * 60) issue('audio-buffer', 'AudioBuffer of ' + (len / rate).toFixed(1) + ' s allocated', 'warn', true);
      this.numberOfChannels = ch | 0; this.length = len | 0; this.sampleRate = rate; this.duration = len / rate;
      this._data = [];
    }
    AudioBuffer.prototype.getChannelData = function (c) {
      if (!(c >= 0 && c < this.numberOfChannels)) { A.errors++; throw DOMException("Failed to execute 'getChannelData' on 'AudioBuffer': channel index (" + c + ') exceeds number of channels (' + this.numberOfChannels + ')', 'IndexSizeError'); }
      return this._data[c] || (this._data[c] = new Float32Array(this.length));
    };
    AudioBuffer.prototype.copyToChannel = function (src, c) { this.getChannelData(c).set(src.subarray(0, this.length)); };
    AudioBuffer.prototype.copyFromChannel = function (dst, c) { dst.set(this.getChannelData(c).subarray(0, dst.length)); };
    G.AudioBuffer = AudioBuffer;
    function PeriodicWave(real, imag) {
      if (!real || !imag || real.length !== imag.length || real.length < 2) { A.errors++; throw DOMException("Failed to execute 'createPeriodicWave' on 'BaseAudioContext': length of real array (" + (real && real.length) + ') and length of imaginary array (' + (imag && imag.length) + ') must match and be at least 2.', 'IndexSizeError'); }
    }
    G.PeriodicWave = PeriodicWave;

    // ------------------------------------------------------------ contexts
    function BaseAudioContext() {}
    G.BaseAudioContext = BaseAudioContext;
    var BP = BaseAudioContext.prototype;
    BP.createOscillator = function () { return new G.OscillatorNode(this); };
    BP.createGain = function () { return new G.GainNode(this); };
    BP.createBiquadFilter = function () { return new G.BiquadFilterNode(this); };
    BP.createBuffer = function (ch, len, rate) { return new AudioBuffer({ numberOfChannels: ch, length: len, sampleRate: rate }); };
    BP.createBufferSource = function () { return new G.AudioBufferSourceNode(this); };
    BP.createConstantSource = function () { return new G.ConstantSourceNode(this); };
    BP.createDynamicsCompressor = function () { return new G.DynamicsCompressorNode(this); };
    BP.createStereoPanner = function () { return new G.StereoPannerNode(this); };
    BP.createPanner = function () { return new G.PannerNode(this); };
    BP.createDelay = function (max) { return new G.DelayNode(this, { maxDelayTime: max === undefined ? 1 : max }); };
    BP.createConvolver = function () { return new G.ConvolverNode(this); };
    BP.createWaveShaper = function () { return new G.WaveShaperNode(this); };
    BP.createAnalyser = function () { return new G.AnalyserNode(this); };
    BP.createChannelSplitter = function () { return new G.ChannelSplitterNode(this); };
    BP.createChannelMerger = function () { return new G.ChannelMergerNode(this); };
    BP.createIIRFilter = function (ff, fb) {
      if (!ff || !fb || ff.length < 1 || ff.length > 20 || fb.length < 1 || fb.length > 20) { A.errors++; throw DOMException('createIIRFilter: coefficient arrays must have 1..20 entries', 'NotSupportedError'); }
      if (fb[0] === 0) { A.errors++; throw DOMException('createIIRFilter: first feedback coefficient must be non-zero', 'InvalidStateError'); }
      return new G.IIRFilterNode(this);
    };
    BP.createPeriodicWave = function (real, imag) { return new PeriodicWave(real, imag); };
    BP.decodeAudioData = function () { issue('asset', 'decodeAudioData called (sampled audio is banned; synthesize)', 'error', true); return Promise.reject(DOMException('Unable to decode audio data', 'EncodingError')); };
    BP.createMediaElementSource = function () { issue('asset', 'createMediaElementSource (media assets are banned)', 'error', true); return new G.GainNode(this); };
    BP.createMediaStreamSource = function () { issue('asset', 'createMediaStreamSource (microphone/media is not used)', 'error', true); return new G.GainNode(this); };
    BP.createScriptProcessor = function () { issue('audio-deprecated', 'createScriptProcessor is deprecated and runs on the main thread', 'warn', true); var n = new G.GainNode(this); n.onaudioprocess = null; return n; };

    function AudioContext(o) {
      o = o || {};
      mixEv(this);
      this.sampleRate = o.sampleRate || 48000;
      this.baseLatency = 0.01; this.outputLatency = 0.02; this.latencyHint = o.latencyHint || 'interactive';
      this._state = S.opts.audioStartsSuspended ? 'suspended' : 'running';
      this._t0 = S.clock; this._acc = 0; // seconds accumulated while running
      this._last = S.clock;
      this.onstatechange = null;
      this.destination = new Dest(this);
      var ctx = this;
      this.listener = { positionX: new AudioParam(ctx, 'listener.positionX', 0, -3.4e38, 3.4e38), positionY: new AudioParam(ctx, 'listener.positionY', 0, -3.4e38, 3.4e38), positionZ: new AudioParam(ctx, 'listener.positionZ', 0, -3.4e38, 3.4e38), setPosition: function () {}, setOrientation: function () {} };
      this.audioWorklet = { addModule: function () { issue('network', 'audioWorklet.addModule (loads a file; banned)', 'error', true); return Promise.reject(DOMException('blocked', 'AbortError')); } };
      A.contexts.push(this);
      if (A.contexts.length === 7) issue('audio-contexts', 'more than 6 AudioContexts created (browsers cap them; create one lazily and reuse it)', 'error', true);
    }
    AudioContext.prototype = Object.create(BP);
    AudioContext.prototype.constructor = AudioContext;
    Object.defineProperty(AudioContext.prototype, 'state', { get: function () { return this._state; } });
    Object.defineProperty(AudioContext.prototype, 'currentTime', {
      get: function () {
        if (this._state === 'running') { this._acc += (S.clock - this._last) / 1000; }
        this._last = S.clock;
        return Math.floor(this._acc * this.sampleRate / 128) * 128 / this.sampleRate;
      }
    });
    function setState(ctx, st) {
      void ctx.currentTime;
      if (ctx._state === st) return;
      ctx._state = st;
      var ev = new G.Event('statechange');
      ctx.dispatchEvent(ev);
      if (typeof ctx.onstatechange === 'function') S.invoke(ctx.onstatechange, ctx, [ev], 'onstatechange');
    }
    AudioContext.prototype.resume = function () { var c = this; if (c._state === 'closed') return Promise.reject(DOMException('Cannot resume a closed AudioContext.', 'InvalidStateError')); setState(c, 'running'); return Promise.resolve(); };
    AudioContext.prototype.suspend = function () { var c = this; if (c._state === 'closed') return Promise.reject(DOMException('Cannot suspend a closed AudioContext.', 'InvalidStateError')); setState(c, 'suspended'); return Promise.resolve(); };
    AudioContext.prototype.close = function () { setState(this, 'closed'); return Promise.resolve(); };
    AudioContext.prototype.getOutputTimestamp = function () { return { contextTime: this.currentTime, performanceTime: S.clock }; };
    AudioContext.prototype.createMediaStreamDestination = function () { return new G.GainNode(this); };
    G.AudioContext = AudioContext;
    G.webkitAudioContext = AudioContext;

    function OfflineAudioContext(ch, len, rate) {
      var o = typeof ch === 'object' ? ch : { numberOfChannels: ch, length: len, sampleRate: rate };
      AudioContext.call(this, { sampleRate: o.sampleRate });
      this.length = o.length;
      this._state = 'suspended';
    }
    OfflineAudioContext.prototype = Object.create(AudioContext.prototype);
    OfflineAudioContext.prototype.startRendering = function () { return Promise.resolve(new AudioBuffer({ numberOfChannels: 2, length: this.length || 1, sampleRate: this.sampleRate })); };
    G.OfflineAudioContext = OfflineAudioContext;

    // ------------------------------------------------------------ clock hook: fire 'ended'
    var prevAdvance = S.onAdvance;
    S.onAdvance = function () {
      if (prevAdvance) prevAdvance();
      if (!A.active.length) return;
      var keep = [];
      for (var i = 0; i < A.active.length; i++) {
        var n = A.active[i];
        var now = n.context.currentTime;
        if (n.context._state !== 'closed' && now >= n._endAt) {
          n._ended = true;
          A.ended++;
          var ev = new G.Event('ended');
          n.dispatchEvent(ev);
          if (typeof n.onended === 'function') S.invoke(n.onended, n, [ev], n._kind + '.onended');
        } else keep.push(n);
      }
      A.active = keep;
    };

    // Graph inspection for reports: context states, and (below) whether a compressor feeds the
    // destination and how many gain buses feed the compressor. Nodes register on first connect().
    S.audioGraph = function () {
      var out = [];
      for (var c = 0; c < A.contexts.length; c++) {
        var ctx = A.contexts[c];
        out.push({ state: ctx._state, sampleRate: ctx.sampleRate });
      }
      return out;
    };
    var allNodes = [];
    S.audioAllNodes = allNodes;
    var BaseCall = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest) {
      // O(1) membership via a marker (indexOf over thousands of per-note nodes was quadratic)
      if (!this.__inAll && allNodes.length < 50000) { Object.defineProperty(this, '__inAll', { value: true }); allNodes.push(this); }
      if (dest && !dest.__inAll && dest instanceof AudioNode && allNodes.length < 50000) { Object.defineProperty(dest, '__inAll', { value: true }); allNodes.push(dest); }
      return BaseCall.apply(this, arguments);
    };
    S.audioTopology = function () {
      var res = { compressorToDestination: false, gainsIntoCompressor: 0, nodesConnected: allNodes.length };
      for (var i = 0; i < allNodes.length; i++) {
        var n = allNodes[i];
        if (n instanceof G.DynamicsCompressorNode) {
          for (var j = 0; j < n._out.length; j++) if (n._out[j] instanceof Dest) res.compressorToDestination = true;
        }
        if (n instanceof G.GainNode) {
          for (var k = 0; k < n._out.length; k++) if (n._out[k] instanceof G.DynamicsCompressorNode) res.gainsIntoCompressor++;
        }
      }
      return res;
    };
    return true;
  };
})(globalThis);
