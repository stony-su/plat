/* js/engine/camera.js — owner: CORE */
(function (AP) {
  'use strict';

  var M = AP.M;
  var LOOK_X = 56, LOOK_VX = 0.12, LOOK_VX_MAX = 110, LOOK_FALL = 64, FALL_VY = 500;
  var LAMBDA_X = 7, LAMBDA_Y = 5;

  function Camera(L) {
    this.L = L || null;
    this.x = 0;
    this.y = 0;
    this.w = 960;
    this.h = 540;
    this.prevX = 0;
    this.prevY = 0;
    this.renderX = 0;
    this.renderY = 0;
    this.target = null;
    this.focusX = 0;
    this.focusY = 0;
    this.focusOn = false;
    this.lookX = 0;
    this.bounds = { x: 0, y: 0, w: 960, h: 540 };
    this.lockRect = null;
    this.lockOwner = null;
    this.shakeMag = 0;
    this.shakeT = 0;
    this.shakeDur = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeSeed = 0;
    this.kickX = 0;
    this.kickY = 0;
    this.lambdaX = LAMBDA_X;
    this.lambdaY = LAMBDA_Y;
    this.time = 0;
    if (L && L.pw) this.setBounds(0, 0, L.pw, L.ph);
  }

  var P = Camera.prototype;

  P.follow = function (e) {
    this.target = e || null;
    this.focusOn = false;
  };

  // fixed world point to look at (death pans, cutscenes); follow(e) cancels it
  P.focus = function (x, y) {
    this.focusX = x;
    this.focusY = y;
    this.focusOn = true;
  };

  P.setBounds = function (x, y, w, h) {
    this.bounds.x = x;
    this.bounds.y = y;
    this.bounds.w = w;
    this.bounds.h = h;
  };

  // confine to rect while set; null releases. opts.snap jumps immediately.
  P.lock = function (rect, opts) {
    if (!rect) {
      this.lockRect = null;
      this.lockOwner = null;
      return;
    }
    if (!this.lockRect) this.lockRect = { x: 0, y: 0, w: 0, h: 0 };
    this.lockRect.x = rect.x;
    this.lockRect.y = rect.y;
    this.lockRect.w = rect.w;
    this.lockRect.h = rect.h;
    this.lockOwner = (opts && opts.owner) || null;
    if (opts && opts.snap) this.snap();
  };

  function clampAxis(v, lo, size, view) {
    if (size <= view) return lo + (size - view) / 2;
    return v < lo ? lo : (v > lo + size - view ? lo + size - view : v);
  }

  P.desired = function (out) {
    var tx, ty;
    var t = this.target;
    if (this.focusOn || !t) {
      tx = this.focusX - this.w / 2;
      ty = this.focusY - this.h / 2;
      if (!this.focusOn && !t) { tx = this.x; ty = this.y; }
    } else {
      var vx = t.vx || 0, vy = t.vy || 0;
      var facing = t.facing || 0;
      var look = facing * LOOK_X + M.clamp(vx * LOOK_VX, -LOOK_VX_MAX, LOOK_VX_MAX);
      tx = t.x + t.w / 2 + look - this.w / 2;
      ty = t.y + t.h / 2 + (vy > FALL_VY ? LOOK_FALL : 0) - this.h / 2;
    }
    var r = this.lockRect || this.bounds;
    out.x = clampAxis(tx, r.x, r.w, this.w);
    out.y = clampAxis(ty, r.y, r.h, this.h);
    return out;
  };

  var dOut = { x: 0, y: 0 };
  P.snap = function () {
    this.desired(dOut);
    this.x = dOut.x;
    this.y = dOut.y;
    this.clampBounds();
    this.prevX = this.x;
    this.prevY = this.y;
    this.renderX = AP.R ? AP.R.snap(this.x) : this.x;
    this.renderY = AP.R ? AP.R.snap(this.y) : this.y;
  };

  P.clampBounds = function () {
    var b = this.bounds;
    this.x = clampAxis(this.x, b.x, b.w, this.w);
    this.y = clampAxis(this.y, b.y, b.h, this.h);
  };

  P.update = function (dt) {
    this.time += dt;
    this.prevX = this.x;
    this.prevY = this.y;
    this.desired(dOut);
    this.x = M.damp(this.x, dOut.x, this.lambdaX, dt);
    this.y = M.damp(this.y, dOut.y, this.lambdaY, dt);
    this.clampBounds();
    // shake (smooth noise) and kick (decaying impulse)
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      var env = this.shakeDur > 0 ? this.shakeT / this.shakeDur : 0;
      var m = this.shakeMag * env * env;
      var n2 = AP.Noise.n2;
      this.shakeX = m * n2(this.time * 38, this.shakeSeed);
      this.shakeY = m * n2(this.shakeSeed + 17.3, this.time * 38);
      if (this.shakeT === 0) { this.shakeMag = 0; this.shakeX = 0; this.shakeY = 0; }
    }
    this.kickX = M.damp(this.kickX, 0, 14, dt);
    this.kickY = M.damp(this.kickY, 0, 14, dt);
    if (Math.abs(this.kickX) < 0.01) this.kickX = 0;
    if (Math.abs(this.kickY) < 0.01) this.kickY = 0;
  };

  // computes renderX/renderY for this frame (interpolated + shake + kick, snapped to device pixels)
  P.prepareRender = function (alpha) {
    var x = this.prevX + (this.x - this.prevX) * alpha + this.shakeX + this.kickX;
    var y = this.prevY + (this.y - this.prevY) * alpha + this.shakeY + this.kickY;
    this.renderX = AP.R ? AP.R.snap(x) : x;
    this.renderY = AP.R ? AP.R.snap(y) : y;
  };

  P.shake = function (mag, dur) {
    var st = AP.Save && AP.Save.data && AP.Save.data.settings;
    var k = st && typeof st.shake === 'number' ? st.shake : 1;
    mag = (mag || 0) * k;
    dur = dur || 0.2;
    if (mag <= 0) return;
    var cur = this.shakeDur > 0 ? this.shakeMag * Math.pow(this.shakeT / this.shakeDur, 2) : 0;
    if (mag >= cur) {
      this.shakeMag = mag;
      this.shakeDur = dur;
      this.shakeT = dur;
      this.shakeSeed = (this.shakeSeed + 11.7) % 1000;
    }
  };

  P.kick = function (dx, dy) {
    var st = AP.Save && AP.Save.data && AP.Save.data.settings;
    var k = st && typeof st.shake === 'number' ? Math.max(0.25, st.shake) : 1;
    this.kickX += (dx || 0) * k;
    this.kickY += (dy || 0) * k;
  };

  P.visible = function (x, y, w, h, pad) {
    if (pad === undefined) pad = 32;
    return x + w > this.x - pad && x < this.x + this.w + pad && y + h > this.y - pad && y < this.y + this.h + pad;
  };

  P.toScreen = function (wx, wy, out) {
    out = out || { x: 0, y: 0 };
    out.x = wx - this.renderX;
    out.y = wy - this.renderY;
    return out;
  };

  P.toWorld = function (sx, sy, out) {
    out = out || { x: 0, y: 0 };
    out.x = sx + this.renderX;
    out.y = sy + this.renderY;
    return out;
  };

  P.cx = function () { return this.x + this.w / 2; };
  P.cy = function () { return this.y + this.h / 2; };

  AP.Camera = Camera;
})(window.AP = window.AP || {});
