/* js/core/const.js — owner: CORE — VERBATIM from CONTRACT §2.2 */
(function (AP) {
  'use strict';
  AP.C = Object.freeze({
    T: 32, VIEW_W: 960, VIEW_H: 540, STEP: 1 / 120, MAX_FRAME_DT: 0.1, MAX_STEPS: 12,
    PLAYER_W: 22, PLAYER_H: 22,
    GRAVITY: 2400, MAX_FALL: 900, FAST_FALL: 1100,
    JUMP_V: 733, JUMP_CUT: 0.45, HANG_V: 80, HANG_MULT: 0.5,
    RUN: 300, GROUND_ACCEL: 3000, GROUND_DECEL: 3600, AIR_ACCEL: 2200, AIR_DECEL: 1200, OVERSPEED_DECEL: 400,
    COYOTE: 0.10, JUMP_BUFFER: 0.12, CORNER_CORRECT: 8, LEDGE_CORRECT: 8, DROP_THROUGH: 0.15,
    WALL_SLIDE_MAX: 140, WALL_JUMP_DIST: 4, WALL_COYOTE: 0.08,
    WALLJUMP_VX: 340, WALLJUMP_VY: 680, WALLJUMP_LOCK: 0.12,
    DOUBLE_JUMP_V: 650, BURST_RADIUS: 64,
    DASH_SPEED: 760, DASH_TIME: 0.14, DASH_END_SPEED: 300, DASH_COOLDOWN: 0.20, DASH_FREEZE: 0.03, DASH_BUFFER: 0.08,
    ORBIT_RANGE: 110, ORBIT_R_MIN: 40, ORBIT_R_MAX: 110, ORBIT_MIN_SPEED: 420, ORBIT_CRUISE: 800,
    ORBIT_ACCEL: 1200, ORBIT_MAX: 1000, ORBIT_RELEASE_MULT: 1.15, ORBIT_AIM_ASSIST_DEG: 45, ORBIT_COOLDOWN: 0.20,
    BOUNCE_V: 1040, BOUNCE_SIDE_VX: 700, BOUNCE_SIDE_VY: 420,
    STOMP_V: 520, STOMP_V_HELD: 733, STOMP_TOL: 8,
    EXT_MAX_VX: 600,
    DEATH_TIME: 0.5, RESPAWN_TIME: 0.3, RESPAWN_INVULN: 0.6,
    CRUMBLE_DELAY: 0.45, CRUMBLE_RESPAWN: 2.5, HITSTOP_MAX: 0.12, PIT_MARGIN: 64,
    SPIKE_DEPTH: 14, SPIKE_INSET: 3, ONEWAY_THICK: 8,
    CHUNK: 256, CHUNK_CACHE: 48, CHUNK_PX_MAX: 2, PARTICLES_MAX: 1800,
    LINT_RUN_FACTOR: 0.95, LINT_VEL_FACTOR: 0.97, LINT_LEDGE_OVERLAP: 8
  });
  AP.TILE = Object.freeze({ EMPTY: 0, SOLID: 1, ONEWAY: 2, SPIKE_U: 3, SPIKE_D: 4, SPIKE_L: 5, SPIKE_R: 6, BREAK: 7, FAKE: 8 });
  AP.TILE_CHARS = Object.freeze({ '.': 0, '#': 1, '=': 2, '^': 3, 'v': 4, '<': 5, '>': 6, '+': 7, '%': 8 });
  AP.ENTITY_CHARS = Object.freeze({ P: 'player', E: 'exit', V: 'vertex', C: 'checkpoint', '*': 'shard',
    '1': 'gem', '2': 'gem', '3': 'gem', B: 'bounce', S: 'sign', O: 'node', '~': 'crumble' });
  AP.FORMS = Object.freeze([3, 4, 5, 6, 99]);
  AP.FORM_NAMES = Object.freeze({ 3: 'Triangle', 4: 'Square', 5: 'Pentagon', 6: 'Hexagon', 99: 'Circle' });
  AP.abilities = function (f) { return { wall: f >= 4, double: f >= 5, dash: f >= 6, orbit: f >= 99 }; };
  AP.ACTIONS = Object.freeze(['left', 'right', 'up', 'down', 'jump', 'dash', 'orbit', 'pause', 'confirm', 'back', 'retry']);
  AP.SFX = Object.freeze(['jump', 'jump2', 'walljump', 'land', 'step', 'dash', 'refill', 'orbit', 'fling', 'burst',
    'death', 'respawn', 'bounce', 'stomp', 'shard', 'gem', 'checkpoint', 'secret', 'vertex', 'portal', 'complete',
    'crumble', 'break', 'shoot', 'laser', 'charge', 'pulse', 'chime', 'grow', 'split', 'hit', 'explode', 'whoosh',
    'rumble', 'gust', 'bossHit', 'bossPhase', 'bossRoar', 'bossDeath',
    'uiMove', 'uiSelect', 'uiBack', 'uiDeny', 'pause', 'unpause', 'toast', 'type']);
  AP.LOOPS = Object.freeze(['wind', 'hum', 'void']);
  AP.MUSIC = Object.freeze({
    title: { bpm: 84, meter: 5 }, map: { bpm: 90, meter: 4 },
    w1: { bpm: 112, meter: 3 }, boss1: { bpm: 132, meter: 3 },
    w2: { bpm: 96, meter: 4 }, boss2: { bpm: 116, meter: 4 },
    w3: { bpm: 100, meter: 5 }, boss3: { bpm: 120, meter: 5 },
    w4: { bpm: 168, meter: 6 }, boss4: { bpm: 192, meter: 6 },
    w5: { bpm: 120, meter: 4, poly: [3, 4, 5] }, boss5: { bpm: 128, meter: 4, poly: [3, 4, 5] },
    endless: { bpm: 120, meter: 4 }, ending: { bpm: 72, meter: 4 }, credits: { bpm: 96, meter: 4 }
  });
  AP.STYLES = Object.freeze(['title', 'map', 'w1', 'w2', 'w3', 'w4', 'w5', 'endless', 'void']);
  AP.EVENTS = Object.freeze(['level:start', 'level:complete', 'level:quit', 'player:jump', 'player:land',
    'player:dash', 'player:orbit', 'player:fling', 'player:death', 'player:respawn', 'checkpoint',
    'collect:shard', 'collect:gem', 'secret:found', 'tile:changed', 'boss:start', 'boss:phase', 'boss:hit',
    'boss:defeat', 'form:gain', 'beat', 'bar', 'theorem', 'settings:changed', 'scene:change',
    'endless:segment', 'endless:end']);
  AP.U = Object.freeze({ t: function (n) { return n * 32; }, deg: function (d) { return d * Math.PI / 180; } });
})(window.AP = window.AP || {});
