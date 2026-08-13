// levels.js — the five level definitions, easy to hard.
//
// Geometry rules (enforced by test/levels-verify.js):
//   - ground top is Game.GROUND_Y (640)
//   - every block's bottom edge must exactly touch its support's top edge,
//     so the stack settles in under a pixel and falls asleep
//   - enemies are circles of radius 20: an enemy resting on a surface whose
//     top is T sits at y = T - 20 (on the ground: y = 620)
//   - the slingshot fires from x≈220, so structures live in x ∈ [840, 1180]
//
// blocks: {mat: 'wood'|'stone', x, y, w, h} — x/y are the CENTER of the block
// enemies: {x, y}
// birds: attempts granted for this level

(function () {
  'use strict';

  window.LEVELS = [
    {
      name: 'Cabana',
      difficulty: 'Fácil',
      birds: 3,
      blocks: [
        // first story: two wood columns + wood beam
        { mat: 'wood',  x: 900,  y: 580, w: 20,  h: 120 }, // 520..640
        { mat: 'wood',  x: 1060, y: 580, w: 20,  h: 120 }, // 520..640
        { mat: 'wood',  x: 980,  y: 510, w: 200, h: 20  }, // 500..520
        // second story: two stone cubes + wood roof
        { mat: 'stone', x: 910,  y: 480, w: 40,  h: 40  }, // 460..500
        { mat: 'stone', x: 1050, y: 480, w: 40,  h: 40  }, // 460..500
        { mat: 'wood',  x: 980,  y: 452, w: 160, h: 16  }, // 444..460
      ],
      enemies: [{ x: 980, y: 620 }],
    },

    {
      name: 'Vila',
      difficulty: 'Fácil',
      birds: 3,
      blocks: [
        // left hut
        { mat: 'wood',  x: 860,  y: 590, w: 20,  h: 100 }, // 540..640
        { mat: 'wood',  x: 960,  y: 590, w: 20,  h: 100 }, // 540..640
        { mat: 'wood',  x: 910,  y: 530, w: 120, h: 20  }, // 520..540
        // right hut
        { mat: 'wood',  x: 1060, y: 590, w: 20,  h: 100 }, // 540..640
        { mat: 'wood',  x: 1160, y: 590, w: 20,  h: 100 }, // 540..640
        { mat: 'wood',  x: 1110, y: 530, w: 120, h: 20  }, // 520..540
        // shared roof plank bridging both huts, weighted with one stone cube
        { mat: 'wood',  x: 1010, y: 510, w: 320, h: 20  }, // 500..520
        { mat: 'stone', x: 1010, y: 480, w: 40,  h: 40  }, // 460..500
      ],
      enemies: [{ x: 910, y: 620 }, { x: 1110, y: 620 }],
    },

    {
      name: 'Torre',
      difficulty: 'Médio',
      birds: 3,
      blocks: [
        // stone base
        { mat: 'stone', x: 940,  y: 580, w: 30,  h: 120 }, // 520..640
        { mat: 'stone', x: 1060, y: 580, w: 30,  h: 120 }, // 520..640
        { mat: 'wood',  x: 1000, y: 510, w: 160, h: 20  }, // 500..520
        // upper story on thin wood legs
        { mat: 'wood',  x: 950,  y: 460, w: 20,  h: 80  }, // 420..500
        { mat: 'wood',  x: 1050, y: 460, w: 20,  h: 80  }, // 420..500
        { mat: 'wood',  x: 1000, y: 410, w: 140, h: 20  }, // 400..420
        // cover for the rooftop enemy
        { mat: 'stone', x: 950,  y: 380, w: 40,  h: 40  }, // 360..400
        { mat: 'stone', x: 1050, y: 380, w: 40,  h: 40  }, // 360..400
      ],
      // one exposed on top (needs a lob), one sheltered at the base
      enemies: [{ x: 1000, y: 380 }, { x: 1000, y: 620 }],
    },

    {
      name: 'Fortaleza',
      difficulty: 'Difícil',
      birds: 4,
      blocks: [
        // wooden outer shield you must clear first
        { mat: 'wood',  x: 850,  y: 590, w: 20,  h: 100 }, // 540..640
        // stone walls carrying a heavy stone roof
        { mat: 'stone', x: 880,  y: 570, w: 30,  h: 140 }, // 500..640
        { mat: 'stone', x: 1120, y: 570, w: 30,  h: 140 }, // 500..640
        { mat: 'stone', x: 1000, y: 480, w: 270, h: 40  }, // 460..500
        // wood on the roof — knock these off to lighten it, or ride them in
        { mat: 'wood',  x: 940,  y: 445, w: 100, h: 30  }, // 430..460
        { mat: 'wood',  x: 1060, y: 445, w: 100, h: 30  }, // 430..460
      ],
      // both sealed inside: win by collapsing the roof onto them
      enemies: [{ x: 940, y: 620 }, { x: 1060, y: 620 }],
    },

    {
      name: 'Cidadela',
      difficulty: 'Difícil',
      birds: 4,
      blocks: [
        // left tower
        { mat: 'stone', x: 860,  y: 580, w: 30,  h: 120 }, // 520..640
        { mat: 'stone', x: 940,  y: 580, w: 30,  h: 120 }, // 520..640
        { mat: 'wood',  x: 900,  y: 510, w: 120, h: 20  }, // 500..520
        // right tower
        { mat: 'stone', x: 1080, y: 580, w: 30,  h: 120 }, // 520..640
        { mat: 'stone', x: 1160, y: 580, w: 30,  h: 120 }, // 520..640
        { mat: 'wood',  x: 1120, y: 510, w: 120, h: 20  }, // 500..520
        // span between the towers
        { mat: 'wood',  x: 1010, y: 490, w: 240, h: 20  }, // 480..500
        // corner blocks guarding the tower tops
        { mat: 'stone', x: 860,  y: 480, w: 40,  h: 40  }, // 460..500
        { mat: 'stone', x: 1160, y: 480, w: 40,  h: 40  }, // 460..500
      ],
      // one on the span, two on the ground under the towers
      enemies: [{ x: 1010, y: 460 }, { x: 900, y: 620 }, { x: 1120, y: 620 }],
    },
  ];
})();
