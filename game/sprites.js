// The arena: the sprites, drawn in code as rows of palette letters, like avatars.
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

  // --- the maps' own enemies --------------------------------------------------------

  // Memory leak: a slime that splits in two.
  const LEAK_BODY = [
    "....GGGG....",
    "..GGHHGGGG..",
    ".GHHGGGGGGG.",
    ".GHWWGGWWGG.",
    "GGGWEGGWEGGG",
    "GGGGGGGGGGGG",
    "GgGGGMMGGGgG",
  ];
  const leak = {
    palette: Object.assign({G: "#5fbf5a", g: "#3f8f3c", H: "#a8e89a"}, EYES_DARK),
    frames: [
      LEAK_BODY.concat([".gggggggggg.", "..g..g..g..."]),
      ["............"].concat(LEAK_BODY.slice(0, 6), ["GgGGGMMGGGgG", "gggggggggggg"]),
    ],
  };
  const leak_small = {
    palette: Object.assign({G: "#5fbf5a", g: "#3f8f3c", H: "#a8e89a"}, EYES_DARK),
    frames: [
      ["..GG..", ".GHGG.", "GWGGWG", "GGGGGG", ".gggg."],
      ["......", ".GGGG.", "GWGGWG", "GGGGGG", "gggggg"],
    ],
  };

  // Race condition: twins, each with a clock.
  const RACE_BODY = [
    "...CCCCCC...",
    "..CWWWWWWC..",
    "..CWWKWWWC..",
    "..CWWKKKWC..",
    "...CCCCCC...",
    "..AAAAAAAA..",
    ".AWWAAAAWWA.",
    ".AWEAAAAWEA.",
    ".AAAAAAAAAA.",
    "..aaaaaaaa..",
  ];
  const race = {
    palette: Object.assign({C: "#c8c8d4", A: "#4ac0c8", a: "#2e8a92"}, EYES_DARK),
    frames: [
      RACE_BODY.concat(["..K.K..K.K..", ".K..K..K..K."]),
      RACE_BODY.concat([".K..K..K..K.", "..K.K..K.K.."]),
    ],
  };

  // Null pointer: a hollow, glitching ring that points nowhere.
  const nullptr = {
    palette: Object.assign({N: "#d07ad0", n: "#9a4a9a", G: "#7fe0e0"}, EYES_DARK),
    frames: [
      ["...NNNN...", ".NNnnnnNN.", ".Nn....nN.", "Nn.W..W.nN", "Nn.E..E.nN",
       "Nn......nN", ".Nn.MM.nN.", ".NNnnnnNN.", "...NNNN..."],
      ["...NNNN...", ".NNnnnnNN.", "GNn....nN.", "Nn.W..W.nN", "Nn.E..E.nNG",
       "Nn......nN", ".Nn.MM.nN.", ".NNnnnnNN.", "...NNNN..."].map((r) => r.slice(0, 10)),
    ],
  };

  // Deprecated: a ghost of old code; render.js draws it see-through.
  const DEPRECATED_BODY = [
    "...PPPPPP...",
    "..PPPPPPPP..",
    ".PPWWPPWWPP.",
    ".PPWEPPWEPP.",
    ".PPPPPPPPPP.",
    ".PPPPMMPPPP.",
    ".PPPPPPPPPP.",
    ".PpPPPPPPpP.",
    ".PPPPPPPPPP.",
  ];
  const deprecated = {
    palette: Object.assign({P: "#b8b4cc", p: "#8a86a0"}, EYES_DARK),
    frames: [
      DEPRECATED_BODY.concat([".P.PP.PP.P..", "P...P..P...."]),
      DEPRECATED_BODY.concat(["..P.PP.PP.P.", "....P..P...P"]),
    ],
  };

  // --- the bestiary (0.6) ------------------------------------------------------------

  const recolor = (rows, map) => rows.map((r) => [...r].map((c) => map[c] || c).join(""));

  // Flaky test: half passing, half failing, and the halves swap all the time.
  const FLAKY_BODY = [
    "...GGGRRR...",
    "..GGGGRRRR..",
    ".GGWWGRWWRR.",
    ".GGWEGRWERR.",
    ".GGGGGRRRRR.",
    ".GgGGMMRRrR.",
    "..gGGGRRRr..",
    "...gggrrr...",
  ];
  const flaky = {
    palette: Object.assign({G: "#4fbf6f", g: "#3a9a55", R: "#d9534f", r: "#a83a36"}, EYES_DARK),
    frames: [
      FLAKY_BODY.concat(["..K.K..K.K..", ".K..K..K..K."]),
      recolor(FLAKY_BODY, {G: "R", g: "r", R: "G", r: "g"}).concat([".K..K..K..K.", "..K.K..K.K.."]),
    ],
  };

  // Spaghetti code: a tangle of noodles in sauce.
  const SPAGHETTI_BODY = [
    "...Y..Y..Y..",
    "..YyYSyYYy..",
    ".YyYYYYyYYY.",
    "YYWWyYYWWyYY",
    "YyWEYyYWEYyY",
    "YYyYYyYYyYYY",
    ".yYYyMMyYYy.",
    "Y.yYYyYYyY.Y",
  ];
  const spaghetti = {
    palette: Object.assign({Y: "#e8c14a", y: "#b8902a", S: "#c8443c"}, EYES_DARK),
    frames: [SPAGHETTI_BODY.concat([".Y.y..y..yY."]), SPAGHETTI_BODY.concat(["Y..y.y...y.Y"])],
  };

  // Off-by-one: a block with a 1 on it; the second frame is the crouch before a jump.
  const OFF_BODY = [
    "..OOOOOO..",
    ".OWWOOWWO.",
    ".OWEOOWEO.",
    ".OOOOOOOO.",
    ".OOOWWOOO.",
    ".OOWWWOOO.",
    ".OOOWWOOO.",
    ".OOOWWOOO.",
    ".oOWWWWOo.",
    "..oooooo..",
  ];
  const offbyone = {
    palette: Object.assign({O: "#4ac0a0", o: "#2e8a72"}, EYES_DARK),
    frames: [OFF_BODY.concat(["..K....K..", ".K......K."]),
             OFF_BODY.concat([".K......K.", "K........K"])],
  };

  // Technical debt: a heavy sack of it.
  const DEBT_BODY = [
    "...BBBBBB...",
    "..BWWBBWWB..",
    ".BBWEBBWEBB.",
    ".BBBBYYYBBB.",
    "BBBBYBBBBBBB",
    "BBBBBYYBBBBB",
    "BBBBBBBYBBBB",
    "BbBBYYYBBBbB",
    ".bbBBBBBBbb.",
    "..bbbbbbbb..",
  ];
  const debt = {
    palette: Object.assign({B: "#8a7a5a", b: "#6a5a40", k: "#4a3a2a", Y: "#e8c14a"}, EYES_DARK),
    frames: [["....kkkk....", ".....kk....."].concat(DEBT_BODY),
             ["...kkkk.....", "....kk......"].concat(DEBT_BODY)],
  };

  // Log spammer: a terminal on a stand, lines scrolling up its screen.
  const LOG_LINES = ["FSLLLSLLSSSF", "FSLLSLLLLSSF", "FSSLLLSLLSSF"];
  const logspamFrame = (a, b, c) => ["FFFFFFFFFFFF", "FSSSSSSSSSSF", a, "FSSTSSSSTSSF", b, c,
                                     "FSSSSSSSSSSF", "FFFFFFFFFFFF", "....FFFF....", "...ffffff..."];
  const logspam = {
    palette: {F: "#8a8aa0", f: "#5a5a72", S: "#1b1b2f", L: "#4fbf6f", T: "#ff5040"},
    frames: [logspamFrame(...LOG_LINES), logspamFrame(LOG_LINES[1], LOG_LINES[2], LOG_LINES[0])],
  };
  const log_line = {
    palette: {L: "#7fe08a", l: "#3f8f5a"},
    frames: [["LLlLLLlL"]],
  };

  // Regression: a bug with an arrow turning back.
  const REGRESSION_BODY = [
    "...PPPPPP...",
    "..PPPPPPPP..",
    ".PPWWPPWWPP.",
    ".PPWEPPWEPP.",
    ".PPPPPPPPPP.",
    ".PPYPPPPPPP.",
    ".PYYYYYYPPP.",
    ".PPYPPPPYPP.",
    ".pPPPPPPYpP.",
    "..pppYYYpp..",
  ];
  const regression = {
    palette: Object.assign({P: "#c84a8a", p: "#963066", Y: "#fffbe0"}, EYES_DARK),
    frames: [REGRESSION_BODY.concat(["..K.K..K.K..", ".K..K..K..K."]),
             REGRESSION_BODY.concat([".K..K..K..K.", "..K.K..K.K.."])],
  };

  // Scope creep: a small blob; render.js draws it two and three times bigger as it grows.
  const SCOPE_BODY = [
    "...SSSS...",
    "..SSSSSS..",
    ".SSWWSWWS.",
    ".SSWESWES.",
    "SSSSSSSSSS",
    "SsSSSMSSsS",
    ".sSSSSSSs.",
  ];
  const scope = {
    palette: Object.assign({S: "#e87aa8", s: "#b84a7a"}, EYES_DARK),
    frames: [SCOPE_BODY.concat(["s.ssssss.s"]), SCOPE_BODY.concat([".s.ssss.s."])],
  };

  // The monolith: a block of stone full of lit windows; microservices come out of it.
  const MONO_ROW = ".GHGGGGGGGGGGGGGGGG.", MONO_WINDOWS = ".GHGcGcGcGGcGcGcGGG.";
  const MONOLITH_BODY = [
    "...GGGGGGGGGGGGGG...",
    "..GHHHHHHHHHHHHHHG..",
    MONO_ROW, MONO_WINDOWS, MONO_ROW,
    ".GHGTTGGGGGGGGTTGGG.",
    ".GHGTEGGGGGGGGTEGGG.",
    MONO_ROW, MONO_WINDOWS, MONO_ROW,
    ".GHGGGMMMMMMMMGGGGG.",
    MONO_ROW, MONO_WINDOWS, MONO_ROW, MONO_WINDOWS, MONO_ROW,
    ".GgGGGGGGGGGGGGGGgG.",
    ".ggGGGGGGGGGGGGGGgg.",
    "..gggggggggggggggg..",
  ];
  const monolith = {
    palette: {G: "#6a6a82", g: "#4a4a62", H: "#8a8aa0", c: "#5bd0e8", T: "#ff5040",
              E: "#1b1b2f", M: "#2a2a3a", K: "#2a1f33"},
    frames: [MONOLITH_BODY.concat(["...KK..........KK...", "..KK............KK.."]),
             MONOLITH_BODY.concat(["....KK........KK....", "...KK..........KK..."])],
  };
  const micro = {
    palette: Object.assign({C: "#4ac0c8", c: "#2e8a92"}, EYES_DARK),
    frames: [[".CCCC.", "CWCCWC", "CECCEC", "CCCCCC", ".cccc.", ".K..K."],
             [".CCCC.", "CWCCWC", "CECCEC", "CCCCCC", ".cccc.", "K....K"]],
  };

  // --- the bosses --------------------------------------------------------------------

  // Out of memory: a huge slime; render.js draws it twice as big once it has grown.
  const OOM_BODY = [
    "........GGGG........",
    "......GGGGGGGG......",
    "....GGHHGGGGGGGG....",
    "...GHHGGGGGGGGGGG...",
    "..GHGGGGGGGGGGGGGG..",
    "..GHGWWWGGGGWWWGGG..",
    ".GGGGWEEGGGGWEEGGGG.",
    ".GGGGWEEGGGGWEEGGGG.",
    "GGGGGGGGGGGGGGGGGGGG",
    "GGGGGGMMMMMMMMGGGGGG",
    "GGGGGGMTTTTTTMGGGGGG",
    "GgGGGGGMMMMMMGGGGGgG",
    "GggGGGGGGGGGGGGGGggG",
  ];
  const boss_oom = {
    palette: Object.assign({G: "#7fbf3a", g: "#5a8f2a", H: "#c8e87a"}, EYES_DARK),
    frames: [OOM_BODY.concat([".gggGGGGGGGGGGGGggg.", "..gggggggggggggggg.."]),
             OOM_BODY.concat([".ggGGGGGGGGGGGGGGgg.", "gggggggggggggggggggg"])],
  };

  // The infinite loop: a head and pieces of body with an arrow going round.
  const LOOP_HEAD = [
    "....LLLLLL....",
    "..LLLLLLLLLL..",
    ".LLHLLLLLLLLL.",
    ".LHWWLLLLWWLL.",
    "LLHWELLLLWELLL",
    "LLLLLLLLLLLLLL",
    "LLLLLLLLLLLLLL",
    "LLLMMMMMMMMLLL",
    "LLLMTTTTTTMLLL",
    ".LLLMMMMMMLLL.",
    ".lLLLLLLLLLLl.",
    "..llLLLLLLll..",
    "....llllll....",
  ];
  const LOOP_PALETTE = Object.assign({L: "#5b6ad0", l: "#3a48a0", H: "#9aa8f0", Y: "#e8c14a"}, EYES_DARK);
  const boss_loop = {
    palette: LOOP_PALETTE,
    frames: [LOOP_HEAD, patch(LOOP_HEAD, 8, ["LLLMMMMMMMMLLL"])],
  };
  const loop_segment = {
    palette: LOOP_PALETTE,
    frames: [["...LLLL...", ".LLHHLLLL.", ".LHLLLLLL.", "LLLLYLLLLL", "LLLLYYLLLL",
              "LYYYYYYLLL", "LLLLYYLLLL", "LLLLYLLLLL", ".lLLLLLLl.", "...llll..."]],
  };

  // Data race: big twins with a clock for a head; the second one is drawn in another color.
  const RACE_BOSS = [
    ".....CCCCCCCC.....",
    "....CWWWWWWWWC....",
    "...CWWWWKWWWWWC...",
    "...CWWWWKWWWWWC...",
    "...CWWWWKKKKWWC...",
    "...CWWWWWWWWWWC...",
    "....CWWWWWWWWC....",
    ".....CCCCCCCC.....",
    "...AAAAAAAAAAAA...",
    "..AAAAAAAAAAAAAA..",
    ".AAWWWAAAAAAWWWAA.",
    ".AAWEEAAAAAAWEEAA.",
    ".AAAAAAAAAAAAAAAA.",
    ".AAAAAMMMMMMAAAAA.",
    ".aAAAAAAAAAAAAAAa.",
    "..aaAAAAAAAAAAaa..",
    "...aaaaaaaaaaaa...",
  ];
  const boss_race = {
    palette: Object.assign({C: "#c8c8d4", A: "#4ac0c8", a: "#2e8a92"}, EYES_DARK),
    frames: [RACE_BOSS.concat(["...KK.KK..KK.KK...", "..KK..KK..KK..KK.."]),
             RACE_BOSS.concat(["..KK..KK..KK..KK..", "...KK.KK..KK.KK..."])],
  };

  // Prod is down: a server rack on fire.
  const RACK_LEDS = "RKgGgGgGgGgGgGTKKR", RACK_ROW = "RKKKKKKKKKKKKKKKKR";
  const RACK = [
    "RRRRRRRRRRRRRRRRRR",
    RACK_ROW, RACK_LEDS, RACK_ROW,
    "RKWWWKKKKKKKKWWWKR",
    "RKWEEKKKKKKKKWEEKR",
    RACK_ROW, RACK_LEDS,
    "RKKKKKKMMMMKKKKKKR",
    "RKKKKKMTTTTMKKKKKR",
    RACK_LEDS, RACK_ROW,
    "RRRRRRRRRRRRRRRRRR",
    ".rr............rr.",
  ];
  const boss_fire = {
    palette: {R: "#5a5a72", r: "#3a3a52", K: "#1b1b2f", g: "#4fbf6f", G: "#2a4a3a", T: "#ff3030",
              W: "#f4f2fa", E: "#ff5040", M: "#5a5a72", F: "#e85a2a", f: "#ff9a3a", Y: "#ffe066"},
    frames: [["..F....F...F...F..", "..FF..FfF..FF..FF.", ".FfF.FfYfFFfF.FfF.",
              ".FYfFfYYfFfYfFfYF."].concat(RACK),
             ["...F...F...F....F.", ".FF..FF..FFF..FF..", ".FfFFfF.FfYfF.FfF.",
              ".FYfFYYfFfYYfFfYF."].concat(RACK)],
  };

  // --- on the floor and in the handbook -------------------------------------------------

  const fire = {
    palette: {F: "#e85a2a", f: "#ff9a3a", Y: "#ffe066", W: "#fffbe0"},
    frames: [["...F...", "..FF.F.", ".FfF.F.", ".FfYfFF", "FfYYYfF", "FfYWYfF", ".fYYYf.", "..fff.."],
             ["..F....", "..F.FF.", ".FF.FfF", "FFfYfF.", "FfYYYfF", "FfYWYfF", ".fYYYf.", "..fff.."]],
  };
  // Spaghetti's trail: sauce on the floor.
  const goo = {
    palette: {G: "#c8443c", g: "#9a3029", H: "#e87a6a"},
    frames: [["..ggggg..", ".gGGGGGg.", "gGGHGGGGg", ".gGGGGGg.", "..g.g.g.."]],
  };
  const incident = {
    palette: {R: "#d9534f", Y: "#e8c14a", K: "#1b1b2f"},
    frames: [["....R....", "...RYR...", "...RYR...", "..RYKYR..", "..RYKYR..", ".RYYYYYR.",
              ".RYYKYYR.", "RRRRRRRRR"]],
  };
  const deploy = {
    palette: {W: "#e8e6f0", B: "#5b8bd0", R: "#d9534f", O: "#e89a4a", Y: "#ffe066"},
    frames: [["....W....", "...WWW...", "...WBW...", "...WWW...", "..WWWWW..", ".RWWWWWR.",
              ".R.WWW.R.", "...OYO...", "....O...."]],
  };
  const elite = {
    palette: {Y: "#e8c14a", y: "#b8902a", R: "#d9534f"},
    frames: [["Y...Y...Y", "YY.YYY.YY", "YYYYRYYYY", "YyYYYYYyY", "yyyyyyyyy"]],
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

  // Explore: goggles to look around. Plan: a halo, it heals.
  const SPIRIT_SCOUT = ["..WWWW..", ".WWWWWW.", "KKKWWKKK", "KAKWWKAK", "WWWWWWWW", "WwWWWWwW"];
  const spirit_scout = {
    palette: {W: "#e8e6f0", w: "#bab8c8", A: "#4fbf6f", K: "#2a2a3a"},
    frames: [SPIRIT_SCOUT.concat(["W.WW.WW."]), SPIRIT_SCOUT.concat([".WW.WW.W"])],
  };
  const SPIRIT_PLAN = ["..YYYY..", "........", "..WWWW..", ".WWWWWW.", "WWAWWAWW", "WWWWWWWW", "WwWWWWwW"];
  const spirit_plan = {
    palette: {W: "#e8e6f0", w: "#bab8c8", A: "#4fbf6f", Y: "#e8c14a"},
    frames: [SPIRIT_PLAN.concat(["W.WW.WW."]), SPIRIT_PLAN.concat([".WW.WW.W"])],
  };

  // --- the agent's real work: a turret, a commit, a question, the orchestra ----------

  const turret = {
    palette: {g: "#c8c8d4", A: "#4fbf6f", W: "#fffbe0", G: "#8a8aa0", K: "#3a3a4a"},
    frames: [["..ggg..", ".gAAAg.", ".gAWAg.", "..ggg..", ".GGGGG.", "GgGGGgG", "GKGGGKG"]],
  };
  const commit = {
    palette: {Y: "#e8c14a", W: "#fffbe0"},
    frames: [["...YYY...", "..Y...Y..", "WWY...YWW", "..Y...Y..", "...YYY..."]],
  };
  const ask = {
    palette: {W: "#f4f2fa", K: "#1b1b2f"},
    frames: [[".WWWWWWW.", "WWWKKKWWW", "WWKWWWKWW", "WWWWWKWWW", "WWWWKWWWW", "WWWWWWWWW",
              "WWWWKWWWW", ".WWWWWWW.", "..WW....."]],
  };
  const orchestra = {
    palette: {P: "#d07ad0", p: "#9a4a9a"},
    frames: [["..PPPPP", "..PPPPP", "..P...P", "..P...P", ".pP..pP", "PPP.PPP", "PP..PP."]],
  };
  const red_ci = {
    palette: {R: "#d9534f", W: "#fffbe0"},
    frames: [["..RRR..", ".RRRRR.", "RRWRWRR", "RRRWRRR", "RRWRWRR", ".RRRRR.", "..RRR.."]],
  };
  const tests_ok = {
    palette: {G: "#4fbf6f", W: "#fffbe0"},
    frames: [["..GGG..", ".GGGGG.", "GGGGGWG", "GGGGWGG", "GWGWGGG", ".GWGGG.", "..GGG.."]],
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
  // A crystal of experience (classic): small and big.
  const gem = {
    palette: {C: "#5bd0e8", c: "#2e8aa8", W: "#e8fbff"},
    frames: [[".C.", "CWC", "cCc", ".c."]],
  };
  const gem_big = {
    palette: {C: "#e8c14a", c: "#b8902a", W: "#fffbe0"},
    frames: [["..C..", ".CWC.", "CCWCC", "cCCCc", ".cCc.", "..c.."]],
  };
  // The boss's chest: three pieces of gear to choose from.
  const chest = {
    palette: {B: "#8a5a2a", b: "#6a4220", Y: "#e8c14a", y: "#b8902a", K: "#2a1f33"},
    frames: [[
      ".BBBBBBBBBB.",
      "BbBBBBBBBBbB",
      "BBBBBBBBBBBB",
      "YYYYYKKYYYYY",
      "BBBBBYYBBBBB",
      "BbBBBKKBBBbB",
      "BBBBBBBBBBBB",
      "yyyyyyyyyyyy",
    ]],
  };

  // --- gear, as icons on the choice cards ----------------------------------------------

  const keyboard = {
    palette: {K: "#3a3a52", W: "#c8c8d4", w: "#8a8aa0", R: "#d9534f"},
    frames: [["KKKKKKKKKKKK", "KWKWKWKWKWRK", "KKKKKKKKKKKK", "KwKWKWKWKWKK",
              "KKKKKKKKKKKK", "KKWWWWWWWKKK", "KKKKKKKKKKKK"]],
  };
  const monitor = {
    palette: {K: "#3a3a52", S: "#5b8bd0", s: "#7fb3e0", G: "#8a8aa0"},
    frames: [["KKKKKKKKKKKK", "KSSSSSSSSSsK", "KSSSSSSSSsSK", "KSSSSSSSsSSK",
              "KSSSSSSSSSSK", "KKKKKKKKKKKK", ".....GG.....", "...GGGGGG..."]],
  };
  const headphones = {
    palette: {K: "#3a3a52", k: "#5a5a72", R: "#d07ad0"},
    frames: [["...KKKKKK...", "..K......K..", ".K........K.", ".K........K.",
              "RRk......kRR", "RRk......kRR", "RRk......kRR", ".R........R."]],
  };
  const chair = {
    palette: {C: "#4a4a6a", c: "#33334f", G: "#8a8aa0"},
    frames: [["..CCCCCC..", "..CccccC..", "..CccccC..", "..CCCCCC..", ".CCCCCCCC.",
              "....GG....", "....GG....", ".G..GG..G.", "GGGGGGGGGG"]],
  };
  const sticker = {
    palette: {Y: "#e8c14a", O: "#e89a4a", E: "#1b1b2f", W: "#f4f2fa", P: "#e87a9a"},
    frames: [["WWWWWWWWWW", "WO.WWWW.OW", "WOOOOOOOOW", "WOEOOOOEOW", "WOOOPPOOOW",
              "WOOOOOOOOW", "WWOOOOOOWW", "WWWWWWWWW."]],
  };
  const thermos = {
    palette: {G: "#8a8aa0", g: "#c8c8d4", R: "#d9534f", K: "#3a3a52"},
    frames: [[".KKKK.", ".gggg.", "GGGGGG", "GgGGGG", "RRRRRR", "GgGGGG", "GgGGGG",
              "GgGGGG", "GGGGGG", ".GGGG."]],
  };

  // Rare gear: only from a chest once the usual pieces are taken.
  const standing_desk = {
    palette: {W: "#a8743f", w: "#86582f", G: "#8a8aa0", S: "#5b8bd0", K: "#3a3a52"},
    frames: [["..KKKKKK..", "..KSSSSK..", "..KKKKKK..", "....GG....", "WWWWWWWWWW", "wwwwwwwwww",
              ".G......G.", ".G......G.", ".G......G.", "GGG....GGG"]],
  };
  const cactus = {
    palette: {G: "#4fbf6f", g: "#2f8a4a", W: "#e8e6f0", P: "#c8603a", p: "#9a4a2a", F: "#e87a9a"},
    frames: [["....F.....", "...GGG....", "G..GgG....", "GW.GgG..G.", "GGGGgG.WG.", "...GgGGGG.",
              "...GgG....", "..PPPPP...", "..PpppP...", "...PPP...."]],
  };
  const plaid = {
    palette: {R: "#d9534f", r: "#a83a3a", Y: "#e8c14a", W: "#f4e0c0"},
    frames: [["RRYRRRYRRR", "RRYRRRYRRR", "YYYYYYYYYY", "RRYRRRYRRR", "rrYrrrYrrr", "YYYYYYYYYY",
              "RRYRRRYRRR", ".W.W.W.W.W"]],
  };
  const homelab = {
    palette: {K: "#2a2a3e", k: "#45455e", G: "#4fbf6f", B: "#5b8bd0", Y: "#e8c14a"},
    frames: [["KKKKKKKKKKKK", "KkkkkkkkkGkK", "KKKKKKKKKKKK", "KkkkkkkkkBkK", "KKKKKKKKKKKK",
              "KkkkkkkkkYkK", "KKKKKKKKKKKK", ".K........K."]],
  };

  // --- weapons: icons for the cards and the build bar, and what they leave on the floor ---

  const pistol = {
    palette: {G: "#8a8aa0", g: "#c8c8d4", B: "#6b4a2e"},
    frames: [["GGGGGGGGGg", "GggggggGGG", "GGGGGGGGG.", "BBBG......", "BBB.......", "BB........"]],
  };
  const shotgun = {
    palette: {G: "#8a8aa0", g: "#c8c8d4", B: "#8a5a2a", b: "#6a4220"},
    frames: [["....GGGGGGGGGg", "BBBBGgggggggGg", "BbbBBGGGGGGGG.", "BB..B........."]],
  };
  // grep: a magnifying glass that burns.
  const laser = {
    palette: {F: "#c8c8d4", s: "#e87aa8", W: "#fff0f6", B: "#8a5a2a"},
    frames: [["..FFFF....", ".FssssF...", "FssWsssF..", "FsWssssF..", "FssssssF..", "FssssssF..",
              ".FssssF...", "..FFFFBB..", "......BBB.", ".......BBB"]],
  };
  const linters = {
    palette: {G: "#3f8f5a", L: "#7fe08a"},
    frames: [["..GGGG..", ".G....G.", "G.....LG", "G....L.G", "GL..L..G", "G.LL...G", ".G....G.",
              "..GGGG.."]],
  };
  // A linter circling the player: a check mark, tinted.
  const linter = {
    palette: {A: "#7fe08a", a: "#4fbf6f"},
    frames: [[".....A", "....AA", "A..AA.", "AAAa..", ".aa..."]],
  };
  const mines = {
    palette: {G: "#5a5a72", g: "#8a8aa0", R: "#ff4040"},
    frames: [["....R....", ".G.GGG.G.", "..GGGGG..", "GGGgGgGGG", "..GGGGG..", ".G.GGG.G.",
              "....G...."]],
  };
  // A mine on the floor; the light blinks once it is armed.
  const mine = {
    palette: {G: "#5a5a72", g: "#8a8aa0", R: "#ff4040", r: "#6a2a3a"},
    frames: [["..GRG..", ".GGGGG.", "GGgGGgG", ".GGGGG."],
             ["..GrG..", ".GGGGG.", "GGgGGgG", ".GGGGG."]],
  };
  const regex = {
    palette: {C: "#7fe0e0", W: "#e8fbff"},
    frames: [["....CCC", "...CWC.", "..CWC..", ".CCCCCC", "...CWC.", "..CWC..", ".CC....",
              "CC....."]],
  };
  const ping = {
    palette: {B: "#5bd0e8", W: "#e8fbff"},
    frames: [["..BBBBB..", ".B.....B.", "B..BBB..B", "..B...B..", "....W....", "...WWW..."]],
  };
  const cron = {
    palette: {P: "#c8a8ff", F: "#e8e6f0", K: "#2a2a3a"},
    frames: [["..PPPPP..", ".PFFFFFP.", "PFFFKFFFP", "PFFFKFFFP", "PFFFKKKFP", "PFFFFFFFP",
              ".PFFFFFP.", "..PPPPP.."]],
  };

  // --- passives ------------------------------------------------------------------------

  const damage = {
    palette: {W: "#e8e6f0", Y: "#e8c14a", B: "#8a5a2a"},
    frames: [[".......W", "......WW", ".....WW.", "....WW..", ".Y.WW...", "..YW....", ".BYY....",
              "B..Y...."]],
  };
  const firerate = {
    palette: {Y: "#e8d36a"},
    frames: [["YY..YY..", ".YY..YY.", "..YY..YY", ".YY..YY.", "YY..YY.."]],
  };
  const multishot = {
    palette: {Y: "#e8d36a", W: "#fffbe0", y: "#b8902a"},
    frames: [[".Y...Y...Y.", "YWY.YWY.YWY", "YYY.YYY.YYY", "yyy.yyy.yyy", "yyy.yyy.yyy"]],
  };
  const area = {
    palette: {B: "#4fbf6f", W: "#e8fbff"},
    frames: [["BB...BB", "B.....B", "..BBB..", "..BWB..", "..BBB..", "B.....B", "BB...BB"]],
  };
  const pierce = {
    palette: {R: "#d9534f", W: "#e8e6f0"},
    frames: [["...RR.....", "..RRRR..W.", "WWWWWWWWWW", "..RRRR..W.", "...RR....."]],
  };
  const reload = {
    palette: {Y: "#e8d36a"},
    frames: [["..YYYY.", ".Y...YY", "Y...YYY", "Y......", "Y.....Y", ".Y...Y.", "..YYY.."]],
  };
  const magazine = {
    palette: {Y: "#e8d36a", G: "#5a5a72", g: "#8a8aa0"},
    frames: [[".YYY.", ".GGG.", "GGGGG", "GgGGG", "GgGGG", "GgGGG", "GGGGG"]],
  };
  const speed = {
    palette: {B: "#5b8bd0", w: "#e8e6f0", W: "#8a88a0"},
    frames: [["...BBB..", "...BBB..", "W..BBB..", "...BBBB.", "W..BBBBB", "..BBBBBB", "..wwwwww"]],
  };
  const vitality = {
    palette: {R: "#d9534f", W: "#f4c0c0"},
    frames: [[".RR.RR.", "RWRRRRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."]],
  };
  const regen = {
    palette: {G: "#4fbf6f", W: "#e8fbff"},
    frames: [[".GG.GG.", "GGGGGGG", "GGGWGGG", ".GWWWG.", "..GWG..", "...G..."]],
  };
  // Code review: an eye on the diff.
  const ally_power = {
    palette: {W: "#e8e6f0", B: "#5b8bd0", K: "#1b1b2f"},
    frames: [["..WWWW..", ".WWBBWW.", "WWBKKBWW", ".WWBBWW.", "..WWWW.."]],
  };
  const missiles = {
    palette: {A: "#4fbf6f", W: "#f4f2fa"},
    frames: [["..A.....A..", ".AAA...AAA.", "AAWAA.AAWAA", ".AAA...AAA.", "..A.....A.."]],
  };

  // --- the map's objects, as icons in the handbook and the hints --------------------

  const door = {
    palette: {F: "#5a4a3a", W: "#a8743f", w: "#86582f", Y: "#e8c14a"},
    frames: [["FFFFFFFFFF", "FWWwWWwWWF", "FWWwWWwWWF", "FWWwWWwWWF", "FWWwWWwYWF", "FWWwWWwWWF",
              "FWWwWWwWWF", "FWWwWWwWWF", "FFFFFFFFFF"]],
  };
  const crack = {
    palette: {G: "#7a7486", g: "#5a5466", K: "#2a2633"},
    frames: [["GGGGgGGGGGGg", "GGKGgGGGGGGg", "gggKgggggggg", "GGGGKGGgGGGG", "GGGgKKGgGGGG",
              "ggggggKKgggg", "GgGGGGGgKGGG", "GgGGGGGgGKGG"]],
  };
  const rack = {
    palette: {K: "#2a2a3e", k: "#45455e", G: "#4fbf6f", R: "#e85a2a", B: "#5b8bd0"},
    frames: [["KKKKKKKK", "KkkkkkkK", "KkGkBkkK", "KkkkkkkK", "KkRkGkkK", "KkkkkkkK",
              "KkBkkRkK", "KkkkkkkK", "KKKKKKKK", "K......K"]],
  };
  const belt = {
    palette: {K: "#3a3a52", G: "#8a8aa0", Y: "#e8c14a"},
    frames: [["GGGGGGGGGGGG", "KKKKKKKKKKKK", "KYKKKYKKKYKK", "KKYKKKYKKKYK", "KYKKKYKKKYKK",
              "KKKKKKKKKKKK", "GGGGGGGGGGGG"]],
  };
  const pit = {
    palette: {W: "#e8f0ff", w: "#b8c8e8", K: "#0e0e1e", S: "#c8c8ff"},
    frames: [["..wwwwwwww..", ".wWWWWWWWWw.", "wWKKKKKKKKWw", "wKKKSKKKKKKw", "wKKKKKKKSKKw",
              "wKSKKKKKKKKw", ".wKKKKSKKKw.", "..wwwwwwww.."]],
  };
  const pad = {
    palette: {P: "#d07ad0", p: "#8a4a9a", W: "#fff0ff"},
    frames: [["...PPPPP...", ".PPpppppPP.", "PpppWWWpppP", "PppWpppWppP", "PpppWWWpppP",
              ".PPpppppPP.", "...PPPPP..."]],
  };
  const vent = {
    palette: {G: "#5a5a72", K: "#1e1e2e", R: "#e85a2a", Y: "#e8c14a"},
    frames: [["...Y..Y...", "..YR.YR.Y.", "..RR.RR.R.", "GGGGGGGGGG", "GKGKGKGKGG", "GKGKGKGKGG",
              "GGGGGGGGGG"]],
  };
  // The night office: a moon over the dark.
  const dark = {
    palette: {Y: "#e8d36a", y: "#b8a44a", K: "#1e1e3a"},
    frames: [["..YYYY..", ".YYYK...", "YYyK....", "YYy.....", "YYy.....", "YYyK....", ".YYYK...",
              "..YYYY.."]],
  };

  const SPRITES = {grunt, runner, tank, boss, leak, leak_small, race, nullptr, deprecated,
                   flaky, spaghetti, offbyone, debt, logspam, log_line, regression, scope, monolith,
                   micro, boss_oom, boss_loop, loop_segment, boss_race, boss_fire, fire, goo, incident,
                   deploy, elite,
                   ally, spirit, gun, bullet, missile, spark, medkit, coffee, duck, shield,
                   gem, gem_big, chest, keyboard, monitor, headphones, chair, sticker, thermos,
                   standing_desk, cactus, plaid, homelab,
                   pistol, shotgun, laser, linters, linter, mines, mine, regex, ping, cron,
                   damage, firerate, multishot, area, pierce, reload, magazine, speed, vitality,
                   regen, ally_power, missiles, spirit_scout, spirit_plan, turret, commit, ask,
                   orchestra, red_ci, tests_ok,
                   door, crack, rack, belt, pit, pad, vent, dark};

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
    return decodeRows(rows, Object.assign({}, def.palette, o.colors || {}), o);
  }

  // The same for rows made elsewhere (the hero); options: outline, fill.
  function decodeRows(rows, palette, options) {
    const o = options || {};
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

  root.LCSSprites = {SPRITES, decode, decodeRows, shade, rgb, OUTLINE};
})(typeof window !== "undefined" ? window : globalThis);
