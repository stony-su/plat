/* js/engine/tilemap.js — owner: CORE */
(function (AP) {
  'use strict';

  var T = AP.TILE;
  var C = AP.C;
  var D = C.SPIKE_DEPTH;     // 14
  var IN = C.SPIKE_INSET;    // 3

  function isSolid(code) { return code === T.SOLID || code === T.BREAK; }
  function isSpike(code) { return code >= T.SPIKE_U && code <= T.SPIKE_R; }
  // standable for lint / placement purposes: # = + (crumble '~' is an entity)
  function isStandable(code) { return code === T.SOLID || code === T.ONEWAY || code === T.BREAK; }

  // spike hurtbox for a tile, out = [x, y, w, h] (CONTRACT section 3)
  function spikeRect(code, tx, ty, out) {
    out = out || [0, 0, 0, 0];
    var x = tx * 32, y = ty * 32;
    if (code === T.SPIKE_U) { out[0] = x + IN; out[1] = y + 32 - D; out[2] = 32 - 2 * IN; out[3] = D; }
    else if (code === T.SPIKE_D) { out[0] = x + IN; out[1] = y; out[2] = 32 - 2 * IN; out[3] = D; }
    else if (code === T.SPIKE_L) { out[0] = x + 32 - D; out[1] = y + IN; out[2] = D; out[3] = 32 - 2 * IN; }
    else if (code === T.SPIKE_R) { out[0] = x; out[1] = y + IN; out[2] = D; out[3] = 32 - 2 * IN; }
    else { out[0] = x; out[1] = y; out[2] = 0; out[3] = 0; }
    return out;
  }

  var sr = [0, 0, 0, 0];
  var spikeHit = { tx: -1, ty: -1, code: 0 };
  // first spike tile whose hurtbox overlaps the rect -> code (0 if none); details in AP.Tilemap.spikeHit
  function rectHitsSpike(L, x, y, w, h) {
    var tx0 = Math.max(0, Math.floor(x / 32)), tx1 = Math.min(L.w - 1, Math.ceil((x + w) / 32) - 1);
    var ty0 = Math.max(0, Math.floor(y / 32)), ty1 = Math.min(L.h - 1, Math.ceil((y + h) / 32) - 1);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var c = L.tiles[ty * L.w + tx];
        if (c < T.SPIKE_U || c > T.SPIKE_R) continue;
        spikeRect(c, tx, ty, sr);
        if (x < sr[0] + sr[2] && x + w > sr[0] && y < sr[1] + sr[3] && y + h > sr[1]) {
          spikeHit.tx = tx; spikeHit.ty = ty; spikeHit.code = c;
          return c;
        }
      }
    }
    return 0;
  }

  // 4-connected groups of `code` cells -> [{cells:[[tx,ty],...], x0, y0, x1, y1}] (tile coords, inclusive)
  function groups(tiles, w, h, code) {
    var seen = new Uint8Array(w * h);
    var out = [];
    var stack = [];
    for (var i = 0; i < w * h; i++) {
      if (tiles[i] !== code || seen[i]) continue;
      var g = { cells: [], x0: w, y0: h, x1: -1, y1: -1 };
      stack.length = 0;
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        var k = stack.pop();
        var tx = k % w, ty = (k - tx) / w;
        g.cells.push([tx, ty]);
        if (tx < g.x0) g.x0 = tx;
        if (ty < g.y0) g.y0 = ty;
        if (tx > g.x1) g.x1 = tx;
        if (ty > g.y1) g.y1 = ty;
        if (tx > 0 && !seen[k - 1] && tiles[k - 1] === code) { seen[k - 1] = 1; stack.push(k - 1); }
        if (tx < w - 1 && !seen[k + 1] && tiles[k + 1] === code) { seen[k + 1] = 1; stack.push(k + 1); }
        if (ty > 0 && !seen[k - w] && tiles[k - w] === code) { seen[k - w] = 1; stack.push(k - w); }
        if (ty < h - 1 && !seen[k + w] && tiles[k + w] === code) { seen[k + w] = 1; stack.push(k + w); }
      }
      g.cells.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
      out.push(g);
    }
    return out;
  }

  // map rows -> {w, h, tiles, chars:[{ch, tx, ty}] for non-tile characters, bad:[chars]}
  function parse(map, legend) {
    var rows = Array.isArray(map) ? map : [];
    var h = rows.length;
    var w = 0;
    for (var r = 0; r < h; r++) w = Math.max(w, String(rows[r]).length);
    var tiles = new Uint8Array(Math.max(1, w * h));
    var chars = [];
    var bad = {};
    for (var ty = 0; ty < h; ty++) {
      var row = String(rows[ty]);
      for (var tx = 0; tx < w; tx++) {
        var ch = tx < row.length ? row.charAt(tx) : '.';
        var code = AP.TILE_CHARS[ch];
        if (code !== undefined) { tiles[ty * w + tx] = code; continue; }
        if (AP.ENTITY_CHARS[ch] !== undefined || (legend && legend[ch] !== undefined)) {
          chars.push({ ch: ch, tx: tx, ty: ty });
          continue;
        }
        bad[ch] = true;
      }
    }
    return { w: w, h: h, tiles: tiles, chars: chars, bad: Object.keys(bad) };
  }

  function index(L, tx, ty) { return ty * L.w + tx; }

  AP.Tilemap = {
    create: function (w, h) { return new Uint8Array(Math.max(1, w * h)); },
    code: function (L, tx, ty) { return AP.Phys.tileCode(L, tx, ty); },
    index: index,
    isSolid: isSolid,
    isSpike: isSpike,
    isStandable: isStandable,
    spikeRect: spikeRect,
    rectHitsSpike: rectHitsSpike,
    spikeHit: spikeHit,
    groups: groups,
    parse: parse
  };
})(window.AP = window.AP || {});
