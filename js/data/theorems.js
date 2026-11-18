/* js/data/theorems.js — owner: UI */
(function (AP) {
  'use strict';

  // AP.Theorems: the achievement list (DESIGN section 6). Pure data; the engine that proves them lives in
  // js/ui/meta.js and is driven only by CONTRACT section 2.4 events plus AP.Save.data.
  //   id      stable key in AP.Save.data.theorems
  //   name    shown in the gallery, toasts and results
  //   desc    the condition, in plain words
  //   hidden  true: name and condition stay secret until proved
  //   flavor  one line of mathematical colour for the gallery
  //   goal    optional numeric target (the gallery shows progress toward it)
  AP.Theorems = [
    { id: 'axiom', name: 'Axiom', desc: 'Complete any level.',
      flavor: 'Every system begins with one thing taken as true.' },
    { id: 'pythagoras', name: 'Pythagoras', desc: 'Become the Square.',
      flavor: 'The square on the long side equals the squares on the other two.' },
    { id: 'golden-ratio', name: 'Golden Ratio', desc: 'Become the Pentagon.',
      flavor: 'Every diagonal of the pentagon is the golden ratio times its side.' },
    { id: 'honeycomb', name: 'Honeycomb Conjecture', desc: 'Become the Hexagon.',
      flavor: 'No partition of the plane into equal cells uses less wall.' },
    { id: 'squaring-circle', name: 'Squaring the Circle', desc: 'Become the Circle.',
      flavor: 'Impossible with compass and straightedge. Possible with persistence.' },
    { id: 'tiling', name: 'Tiling Theorem', desc: 'Defeat The Tessellator.',
      flavor: 'Only triangles, squares and hexagons tile the plane alone.' },
    { id: 'crystallographic', name: 'Crystallographic Restriction', desc: 'Defeat the Crystal Monarch.',
      flavor: 'A lattice may turn by halves, thirds, quarters or sixths. Never fifths.' },
    { id: 'navier-stokes', name: 'Navier–Stokes', desc: 'Defeat the Maelstrom.',
      flavor: 'The flow is written down. Whether it stays smooth is still unknown.' },
    { id: 'banach-tarski', name: 'Banach–Tarski', desc: 'Defeat The Recursion.',
      flavor: 'Cut a ball into five pieces; reassemble two balls of the same size.' },
    { id: 'qed', name: 'Q.E.D.', desc: 'Defeat the Null.',
      flavor: 'Quod erat demonstrandum: which was to be shown.' },
    { id: 'euler-path', name: "Euler's Path", desc: 'Finish a level without dying.',
      flavor: 'Walk every bridge once and never retrace a step.' },
    { id: 'zeno', name: "Zeno's Paradox", desc: "Beat a level's par time.",
      flavor: 'Half the distance, then half again; and still the runner arrives.' },
    { id: 'brachistochrone', name: 'Brachistochrone', desc: 'Beat par on every level of one world.',
      flavor: 'The fastest descent is not the straight line but the cycloid.' },
    { id: 'prime-hunter', name: 'Prime Hunter', desc: 'Collect 10 prime gems.', goal: 10,
      flavor: 'Two, three, five, seven: the atoms of arithmetic.' },
    { id: 'sieve', name: 'Sieve of Eratosthenes', desc: 'Collect 36 prime gems.', goal: 36,
      flavor: 'Cross out every multiple; what survives is prime.' },
    { id: 'infinitude', name: 'Infinitude of Primes', desc: 'Collect all 72 prime gems.', goal: 72, hidden: true,
      flavor: 'Multiply them all and add one. There is always another.' },
    { id: 'tessellation', name: 'Tessellation', desc: 'Collect every shard in a level.',
      flavor: 'Leave no gap and no overlap.' },
    { id: 'fibonacci', name: 'Fibonacci', desc: 'Collect 13 shards in one airborne arc.', goal: 13,
      flavor: '1, 1, 2, 3, 5, 8, 13: each the sum of the two before.' },
    { id: 'seven-bridges', name: 'Seven Bridges', desc: 'Find 7 secrets.', goal: 7,
      flavor: 'Königsberg asked a question; Euler answered with a new field.' },
    { id: 'large-numbers', name: 'Law of Large Numbers', desc: 'Collect 1000 shards in total.', goal: 1000,
      flavor: 'Average enough trials and the truth appears.' },
    { id: 'mobius', name: 'Möbius Strip', desc: 'Die 100 times.', goal: 100, hidden: true,
      flavor: 'One side, one edge, and you keep coming back to the start.' },
    { id: 'parallel', name: 'Parallel Postulate', desc: 'Wall-jump 100 times.', goal: 100,
      flavor: 'Two walls that never meet, and you between them.' },
    { id: 'pentagram', name: 'Pentagram', desc: 'Double-jump 200 times.', goal: 200,
      flavor: 'Draw a star inside the pentagon and the ratios turn golden.' },
    { id: 'vector-space', name: 'Vector Space', desc: 'Dash 500 times.', goal: 500,
      flavor: 'Any direction is a sum of a few you already know.' },
    { id: 'kepler', name: "Kepler's Laws", desc: 'Fling from 5 nodes without touching the ground.', goal: 5,
      flavor: 'Equal areas in equal times, around a point you never touch.' },
    { id: 'hilbert', name: "Hilbert's Hotel", desc: 'Clear 10 segments in one Endless run.', goal: 10,
      flavor: 'Every room is full, and there is always room for one more.' },
    { id: 'monte-carlo', name: 'Monte Carlo', desc: 'Play 10 Endless runs.', goal: 10,
      flavor: 'Throw enough random darts and they will find π.' },
    { id: 'four-color', name: 'Four Colour Theorem', desc: 'Unlock 4 cosmetics.', goal: 4,
      flavor: 'Four colours are enough for any map. A computer checked.' },
    { id: 'godel', name: 'Incompleteness', desc: 'Reach 100% completion.', goal: 100, hidden: true,
      flavor: 'Some true statements cannot be proved from inside the system.' },
    { id: 'galileo', name: "Galileo's Law of Fall", desc: 'Land at full fast-fall speed.',
      flavor: 'Heavy or light, everything falls the same way.' },
    { id: 'escape-velocity', name: 'Escape Velocity', desc: 'Fling from a node at over 1100 units per second.',
      flavor: 'Fast enough, and the orbit lets go of you.' },
    { id: 'pigeonhole', name: 'Pigeonhole Principle', desc: 'Collect all three prime gems in a single run of a level.',
      flavor: 'Three gems, one journey: something had to give.' },
    { id: 'halting', name: 'Halting Problem', desc: 'Pause the game 25 times.', goal: 25, hidden: true,
      flavor: 'No program can always decide when another should stop.' }
  ];
})(window.AP = window.AP || {});
