/* js/data/worlds.js — owner: CORE — VERBATIM from CONTRACT §5 */
(function (AP) {
  'use strict';
  var S = {
    title:   { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' },
    map:     { bg: '#0B0D17', primary: '#C9D1FF', accent: '#FFD36E', hazard: '#FF5470', ink: '#FFFFFF' },
    w1:      { bg: '#0F1630', primary: '#39D3C3', accent: '#FFC857', hazard: '#FF4F6D', ink: '#EAF2FF' },
    w2:      { bg: '#120A24', primary: '#9B7BFF', accent: '#5EF2FF', hazard: '#FF6B3D', ink: '#F4EDFF' },
    w3:      { bg: '#061723', primary: '#4EA8FF', accent: '#FFE27A', hazard: '#FF4F8B', ink: '#E8FBFF' },
    w4:      { bg: '#0C1A10', primary: '#7EDC6A', accent: '#FF9ED8', hazard: '#FF7A2F', ink: '#F1FFE8' },
    w5:      { bg: '#0B0912', primary: '#E9DFC7', accent: '#FFC94A', hazard: '#FF3E9A', ink: '#FFFFFF' },
    endless: { bg: '#050508', primary: '#FFFFFF', accent: '#7CF7D4', hazard: '#FF4D6D', ink: '#FFFFFF' },
    void:    { bg: '#000000', primary: '#F5F5F5', accent: '#8A7CFF', hazard: '#FF2E63', ink: '#FFFFFF' }
  };
  var W = [
    { n: 1, id: 'w1', name: 'The Lattice', art: 'truchet', form: 3, reward: 4, levels: 3, style: 'w1', music: 'w1',
      boss: 'w1-boss', bossType: 'w1.tessellator', bossName: 'The Tessellator', bossStyle: 'w1', bossMusic: 'boss1', shared: [] },
    { n: 2, id: 'w2', name: 'Voronoi Caverns', art: 'voronoi', form: 4, reward: 5, levels: 4, style: 'w2', music: 'w2',
      boss: 'w2-boss', bossType: 'w2.monarch', bossName: 'Crystal Monarch', bossStyle: 'w2', bossMusic: 'boss2', shared: [] },
    { n: 3, id: 'w3', name: 'The Currents', art: 'flow', form: 5, reward: 6, levels: 5, style: 'w3', music: 'w3',
      boss: 'w3-boss', bossType: 'w3.maelstrom', bossName: 'Maelstrom', bossStyle: 'w3', bossMusic: 'boss3', shared: [] },
    { n: 4, id: 'w4', name: 'Fractal Gardens', art: 'fractal', form: 6, reward: 99, levels: 6, style: 'w4', music: 'w4',
      boss: 'w4-boss', bossType: 'w4.recursion', bossName: 'The Recursion', bossStyle: 'w4', bossMusic: 'boss4', shared: [] },
    { n: 5, id: 'w5', name: 'Harmonic Spire', art: 'harmonic', form: 99, reward: 0, levels: 6, style: 'w5', music: 'w5',
      boss: 'w5-boss', bossType: 'w5.null', bossName: 'The Null', bossStyle: 'void', bossMusic: 'boss5', shared: [] }
  ];
  AP.Worlds = {
    list: W, styles: S,
    get: function (n) { return W[n - 1] || null; },
    pal: function (k) { return S[k] || S.title; },
    types: {
      common: ['player', 'checkpoint', 'exit', 'shard', 'gem', 'sign', 'bounce', 'crumble', 'node', 'vertex', 'mover',
               'secretwall', 'trigger', 'camzone', 'killzone', 'text', 'missing'],
      w1: ['w1.crawler', 'w1.bouncer', 'w1.saw', 'w1.tessellator'],
      w2: ['w2.mite', 'w2.turret', 'w2.bolt', 'w2.geode', 'w2.monarch'],
      w3: ['w3.wind', 'w3.drift', 'w3.drifter', 'w3.kite', 'w3.maelstrom'],
      w4: ['w4.vine', 'w4.thorn', 'w4.sierp', 'w4.fruit', 'w4.recursion'],
      w5: ['w5.wave', 'w5.laser', 'w5.ring', 'w5.null']
    }
  };
})(window.AP = window.AP || {});
