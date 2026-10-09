// Last Commit Standing: the sprites, drawn in code as rows of palette letters, like avatars.
// "." is transparent. decode() adds a one-pixel outline and returns RGBA bytes, so the
// sprites are checked in jsc; render.js turns them into canvases once and caches them.
"use strict";

(function (root) {
  const OUTLINE = "#14142a";

  // Mirrors the left half of a symmetric sprite; `swap` recolors the right half.
  function mirror(half, swap) {
    return half.map((row) => row + [...row].reverse().map((c) => (swap && swap[c]) || c).join(""));
  }

  // Replaces rows `from`.. of every frame, for face and leg variants.
  const patch = (rows, from, lines) => rows.map((r, i) => (i >= from && i < from + lines.length
                                                            ? lines[i - from] : r));

  const EYES_DARK = {W: "#f4f2fa", E: "#1b1b2f", K: "#2a1f33", M: "#6a2a3a", T: "#d9534f"};

  // --- enemies: bugs ---------------------------------------------------------------

  const GRUNT_BODY = [
    "..K......K..",
    "...K....K...",
    "...RRRRRR...",
    "..RHHRRRRR..",
    ".RHWWRRWWRR.",
    ".RRWERRWERR.",
    ".RRRRRRRRRR.",
    ".RrRRMMRRrR.",
    "..rRRRRRRr..",
    "...rrrrrr...",
  ];
  const grunt = {
    palette: Object.assign({R: "#c8443c", r: "#9a3029", H: "#e87a6a"}, EYES_DARK),
    frames: [
      GRUNT_BODY.concat(["..K.K..K.K..", ".K..K..K..K."]),
      GRUNT_BODY.concat([".K..K..K..K.", "..K.K..K.K.."]),
    ],
  };

  const RUNNER_BODY = [
    "K..QQQQ..K",
    ".KQQQQQQK.",
    ".QWEQQWEQ.",
    "KQQQQQQQQK",
    ".QqQQQQqQ.",
    "K.qqqqqq.K",
  ];
  const runner = {
    palette: Object.assign({Q: "#e89a4a", q: "#b86a2a"}, EYES_DARK),
    frames: [
      RUNNER_BODY.concat([".K.K..K.K.", "K..K..K..K"]),
      RUNNER_BODY.concat(["K..K..K..K", ".K.K..K.K."]),
    ],
  };

  const TANK_BODY = [
    "......GGGGGG......",
    "....GGVVVVVVGG....",
    "...GVVVVVVVVVVG...",
    "..GVVHHVVVVVVVVG..",
    "..VVHVVVVVVVVVVV..",
    ".VVVVWWVVVVWWVVVV.",
    ".VVVVWEVVVVEWVVVV.",
    ".VVVVVVVVVVVVVVVV.",
    ".DVVVVMWMMWMVVVVD.",
    ".DvVVVVVVVVVVVVvD.",
    "..DvvVVVVVVVVvvD..",
    "..GDDvvvvvvvvDDG..",
    "...GGDDDDDDDDGG...",
  ];
  const tank = {
    palette: Object.assign({V: "#8a5bd0", v: "#6a40a8", D: "#4e3486", H: "#b08ae8",
                            G: "#8a8aa0"}, EYES_DARK),
    frames: [
      TANK_BODY.concat(["..KK..KK..KK..KK..", ".KK...KK..KK...KK."]),
      TANK_BODY.concat(["...KK.KK..KK.KK...", "..KK..KK..KK..KK.."]),
    ],
  };

  // The boss: a merge conflict, one half ours and the other theirs.
  const BOSS_HALF = [
    "........Y..Y...Y",
    "........YY.YY.YY",
    "........YYYYYYYY",
    "........YTYYYTYY",
    "........yyyyyyyy",
    ".....RRRRRRRRRRR",
    "...RRRRRRRRRRRRR",
    "..RHHRRRRRRRRRRR",
    ".RHHRRRRRRRRRRRR",
    ".RHRRKKKKKKRRRRR",
    "RRHRRRWWWKKRRRRR",
    "RRRRRWWWWWWRRRRR",
    "RRRRRWWWWWWRRRRR",
    "RRRRRWWEEWWRRRRR",
    "RRRRRRWWWWRRRRRR",
    "RRRRRRRRRRRRRRRR",
    "RRRRMMMMMMMMMMMM",
    "RRRMWWMWWMWWMWWM",
    "RRRMMMMMMMMMMMMM",
    "RRRMMMTTTTTTTTTT",
    "rRRRMMMMMMMMMMMM",
    "rrRRRRRRRRRRRRRR",
    ".rrRRRRRRRRRRRRR",
    ".rrrRRRRRRRRRRRR",
    "..rrrrRRRRRRRRRR",
    "...rrrrrrrrrrrrr",
    ".....rrrrrrrrrrr",
  ];
  const BOSS_SWAP = {R: "B", r: "b", H: "h"};
  const boss = {
    palette: Object.assign({R: "#c8443c", r: "#9a3029", H: "#e87a6a",
                            B: "#4a7ae8", b: "#3459b8", h: "#8fb3e0",
                            Y: "#e8c14a", y: "#b8902a"}, EYES_DARK),
    frames: [
      mirror(BOSS_HALF.concat(["....KK.....KK...", "...KK.....KK....", "..KK.....KK....."]),
             BOSS_SWAP),
      mirror(BOSS_HALF.concat(["....KK.....KK...", "....KK.....KK...", "....KK.....KK..."]),
             BOSS_SWAP),
    ],
  };

  // --- allies: the agents, small robots in their agent's color (A, a) -------------------

  const ALLY_BODY = [
    ".....LL.....",
    ".....GG.....",
    "..AAAAAAAA..",
    ".AAAAAAAAAA.",
    ".ASSSSSSSSA.",
    ".ASLSSSSLSA.",
    ".ASSSSSSSSA.",
    ".ASSSLLSSSA.",
    ".AAAAAAAAAA.",
    "..aaaaaaaa..",
    ".GgAAAAAAgG.",
    ".G.AaAAaA.G.",
    "...aaaaaa...",
  ];
  const ALLY_FACES = {
    normal: null,
    blink: [".ASSSSSSSSA.", ".ASSSSSSSSA.", ".ASSSSSSSSA.", ".ASSSLLSSSA."],
    error: [".ATSTSSTSTA.", ".ASTSSSSTSA.", ".ATSTSSTSTA.", ".ASSSSSSSSA."],
    sleep: [".ASSSSSSSSA.", ".ASSSSSSSSA.", ".ALLSSSSLLA.", ".ASSSSSSSSA."],
  };
  const ally = {
    palette: {A: "#4fbf6f", a: "#3a9a55", S: "#1b1b2f", L: "#7ff0e8", G: "#8a8aa0",
              g: "#c8c8d4", T: "#d9534f"},
    frames: [ALLY_BODY.concat(["...GG..GG..."]), ALLY_BODY.concat(["..GG....GG.."])],
    faces: ALLY_FACES,
    faceRow: 4,
  };

  // Subagents: small ghosts around their agent.
  const SPIRIT_BODY = ["..WWWW..", ".WWWWWW.", "WWAWWAWW", "WWAWWAWW", "WWWWWWWW", "WwWWWWwW"];
  const spirit = {
    palette: {W: "#e8e6f0", w: "#bab8c8", A: "#4fbf6f"},
    frames: [SPIRIT_BODY.concat(["W.WW.WW."]), SPIRIT_BODY.concat([".WW.WW.W"])],
  };

  // --- the player's weapon, shots and items -------------------------------------------

  const gun = {
    palette: {G: "#8a8aa0", g: "#c8c8d4", K: "#2a2a3a"},
    frames: [[".GGGGGGg", "KKKGG...", "KK......"]],
  };

  const bullet = {palette: {Y: "#e8d36a", W: "#fffbe0"}, frames: [[".Y.", "YWY", ".Y."]]};
  const missile = {
    palette: {A: "#4fbf6f", W: "#f4f2fa"},
    frames: [["..A..", ".AAA.", "AAWAA", ".AAA.", "..A.."]],
  };
  const spark = {palette: {A: "#4fbf6f"}, frames: [["AA", "AA"]]};

  const medkit = {
    palette: {W: "#f4f2fa", w: "#bab8c8", T: "#d9534f", g: "#8a8aa0"},
    frames: [[
      "...gggg...",
      "...g..g...",
      "wWWWWWWWWw",
      "wWWWTTWWWw",
      "wWWWTTWWWw",
      "wWTTTTTTWw",
      "wWTTTTTTWw",
      "wWWWTTWWWw",
      "wWWWTTWWWw",
      "wwwwwwwwww",
    ]],
  };
  // Coffee: a short burst of speed and fire rate.
  const coffee = {
    palette: {W: "#f4f2fa", w: "#bab8c8", C: "#6b4226", c: "#4e2e19", S: "#c8c8d4"},
    frames: [
      ["..S..S..", "...S..S.", "WWWWWW..", "WCCCCWWW", "WCCCCW.W", "WWWWWWWW", ".wwwww.."],
      ["...S..S.", "..S..S..", "WWWWWW..", "WCCCCWWW", "WCCCCW.W", "WWWWWWWW", ".wwwww.."],
    ],
  };
  // A rubber duck: for a while, every shot pierces one more enemy.
  const duck = {
    palette: {Y: "#e8c14a", y: "#b8902a", O: "#e89a4a", E: "#1b1b2f", W: "#f4f2fa"},
    frames: [[
      "..YYY....",
      ".YYEYY...",
      ".YYYYOO..",
      "..YYY....",
      "YYYYYYYY.",
      "YYWYYYYYY",
      ".yYYYYYy.",
      "..yyyyy..",
    ]],
  };
  // A shield: blocks the next hits.
  const shield = {
    palette: {B: "#5b8bd0", b: "#3f6fa8", W: "#f4f2fa", Y: "#e8c14a"},
    frames: [[
      "BBBBBBBB",
      "BWBBBBYB",
      "BWBBBYYB",
      "BBBBYYBB",
      ".BBYYBB.",
      ".bBBBBb.",
      "..bBBb..",
      "...bb...",
    ]],
  };
  const SPRITES = {grunt, runner, tank, boss, ally, spirit, gun, bullet, missile, spark,
                   medkit, coffee, duck, shield};

  // --- decoding --------------------------------------------------------------------

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Darker shade of a color, for an ally's second body color.
  function shade(hex, k) {
    const [r, g, b] = rgb(hex);
    const f = (v) => Math.round(v * k).toString(16).padStart(2, "0");
    return "#" + f(r) + f(g) + f(b);
  }

  function rowsOf(name, frame, face) {
    const def = SPRITES[name];
    let rows = def.frames[frame % def.frames.length];
    if (face && def.faces && def.faces[face]) rows = patch(rows, def.faceRow, def.faces[face]);
    return rows;
  }

  // {width, height, data}: RGBA bytes with a one-pixel outline around the sprite.
  // options: frame, face, colors (palette overrides), outline (color or null),
  // fill (paint every pixel one color: a hit flash).
  function decode(name, options) {
    const o = options || {};
    const def = SPRITES[name];
    const rows = rowsOf(name, o.frame || 0, o.face);
    const palette = Object.assign({}, def.palette, o.colors || {});
    const w = rows[0].length + 2, h = rows.length + 2;
    const data = new Uint8ClampedArray(w * h * 4);
    const solid = new Uint8Array(w * h);
    const fill = o.fill ? rgb(o.fill) : null;
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = row[x];
        if (c === ".") continue;
        const i = (x + 1) + (y + 1) * w;
        const [r, g, b] = fill || rgb(palette[c]);
        data.set([r, g, b, 255], i * 4);
        solid[i] = 1;
      }
    });
    const outline = o.outline === undefined ? OUTLINE : o.outline;
    if (outline) {
      const [r, g, b] = rgb(outline);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = x + y * w;
          if (solid[i]) continue;
          const near = (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1])
            || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]);
          if (near) data.set([r, g, b, 255], i * 4);
        }
      }
    }
    return {width: w, height: h, data};
  }

  root.LCSSprites = {SPRITES, decode, shade, rgb, OUTLINE};
})(typeof window !== "undefined" ? window : globalThis);
