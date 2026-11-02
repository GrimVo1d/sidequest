// The hero's portrait: a 64x64 bust seen from the front, for the hero editor, the menu and
// the results. It is built from the same look as the arena hero (hero.js): the same parts
// and colors, drawn bigger and facing the player. No DOM but paint(): checked in jsc.
//   const f = LCSPortrait.frame(look)   // {rows, palette}: 64 rows of 64 letters, "." clear
//   LCSPortrait.image(look)             // {width, height, data}: RGBA pixels
//   LCSPortrait.paint(canvas, look)     // onto a page's canvas, 64x64; CSS scales it
"use strict";

(function (root) {
  const N = 64;

  // Region letters: S skin, H hair, T top, U the shirt under a jacket, C hat cloth, E eyes
  // and lashes, W white, I iris, M mouth, R lips and red details, K black plastic, G/g metal,
  // Y/y gold. Masses (skin, hair, top, hat) are drawn flat; shade() adds their shading. The
  // cloth's shades c and q also draw the tops' seams and folds by hand.
  // A part is [slot, top row, left column, rows]; rows up to 32 wide stand for the left
  // half and are mirrored onto the right one, wider rows are drawn as they are.

  // The head with the ears, the neck under it.
  const HEAD = [
    "........................SSSSSSSS",
    ".....................SSSSSSSSSSS",
    "....................SSSSSSSSSSSS",
    "...................SSSSSSSSSSSSS",
    "..................SSSSSSSSSSSSSS",
    "..................SSSSSSSSSSSSSS",
    ".................SSSSSSSSSSSSSSS",
    ".................SSSSSSSSSSSSSSS",
    ".................SSSSSSSSSSSSSSS",
    ".................SSSSSSSSSSSSSSS",
    ".................SSSSSSSSSSSSSSS",
    ".................SSSSSSSSSSSSSSS",
    ".................SSSSSSSSSSSSSSS",
    "...............SsSSSSSSSSSSSSSSS",
    "...............SszSSSSSSSSSSSSSS",
    "...............SszSSSSSSSSSSSSSS",
    "...............SsSSSSSSSSSSSSSSS",
    "...............SSSSSSSSSSSSSSSSS",
    "................SSSSSSSSSSSSSSSS",
    ".................SSSSSSSSSSSSSSS",
    "..................SSSSSSSSSSSSSS",
    "..................SSSSSSSSSSSSSS",
    "...................SSSSSSSSSSSSS",
    "...................SSSSSSSSSSSSS",
    "....................SSSSSSSSSSSS",
    ".....................SSSSSSSSSSS",
    "......................SSSSSSSSSS",
    ".......................SSSSSSSSS",
    "........................SSSSSSSS",
    "..........................SSSSSS",
  ];
  const HEAD_TOP = 12;
  const NECK = ["zzzzz", "zzzzz", "sssss", "sssss", "sssss", "sssss", "sssss", "sssss", "sssss"];
  const NECK_TOP = 40, NECK_LEFT = 27;

  // Shoulders and chest in the top's color; the neckline is the top's own part.
  const BODY = [
    "......................TTTTTTTTTT",
    ".................TTTTTTTTTTTTTTT",
    ".............TTTTTTTTTTTTTTTTTTT",
    "..........TTTTTTTTTTTTTTTTTTTTTT",
    "........TTTTTTTTTTTTTTTTTTTTTTTT",
    ".......TTTTTTTTTTTTTTTTTTTTTTTTT",
    "......TTTTTTTTTTTTTTTTTTTTTTTTTT",
    ".....TTTTTTTTTTTTTTTTTTTTTTTTTTT",
    ".....TTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
  ];
  const BODY_TOP = 47;

  // The nose: a shade under its tip, right of the middle (the light is on the left); a
  // blush on the cheeks.
  const NOSE = [["face", 34, 32, ["s"]]];
  const BLUSH = [["face", 34, 19, ["bbb"]]];

  // The left eye; the right one is its mirror. I is the iris, a dark brown with a touch of the hair.
  const EYES = {
    dots: [["face", 28, 23, ["EE", "EE", "EE"]]],
    // Like the dots, a size bigger.
    big: [["face", 27, 22, ["EEE", "EEE", "EEE", "EEE"]]],
    sleepy: [["face", 28, 21, ["EEEEEE", "EIIEIE", ".EIIE."]]],
    happy: [["face", 28, 21, [".EEEE.", "E....E"]]],
    angry: [["face", 25, 21, ["EE....", "..EEEE", "...EEE", ".EIIEE", ".EIEIE", "..EIE."]]],
    wink: [["face", 29, 21, ["E....E", ".EEEE."]]],
  };

  // Mouths in the middle, mirrored like the eyes.
  const MOUTH = {
    smile: [["face", 37, 29, ["M..", ".MM"]]],
    flat: [["face", 38, 30, ["MM"]]],
    open: [["face", 37, 28, ["M...", ".MMM", "..RR"]]],
    grin: [["face", 37, 28, ["MMMM", "MWWW", ".MMM"]]],
    frown: [["face", 37, 29, [".MM", "M.."]]],
  };

  // Hair over the head, and long hair behind the shoulders in a darker tone. j is the shine.
  const HAIR_TOP = 6;
  // The top of the head that the short, the long and the bun hair share.
  const CROWN = [
    "......................HHHHHHHHHH",
    "...................HHHHHHHHHHHHH",
    ".................HHHHHjjjjjHHHHH",
    "................HHHjjHHHHHHHHHHH",
    "...............HHHHHHHHHHHHHHHHH",
    "..............HHHHHHHHHHHHHHHHHH",
    "..............HHHHHHHHHHHHHHHHHH",
    ".............HHHHHHHHHHHHHHHHHHH",
    ".............HHHHHHHHHHHHHHHHHHH",
  ];
  const HAIR = {
    none: [],
    short: [["hair", HAIR_TOP, 0, [
      ...CROWN,
      ".............HHHHHHHHHHHhHHHHHHH",
      ".............HHHHHHHhHHHhHHHHhHH",
      ".............HHHHHHHhHHhHHHHHhHH",
      ".............HHHHHHhHHHhHHHHhHHH",
      ".............HHHHHHhHHhHHHHHhHHH",
      ".............HHHHHhHHHhHHHHhHHHH",
      ".............HHHHHHHH.HHHHHHHHHH",
      "..............HHHHHH...HHHHH.HHH",
      "..............HHHH......HHH...HH",
      "..............HHH........H.....H",
      "..............HH................",
      "..............H.................",
    ]]],
    spiky: [["hair", 0, 0, [
      ".........................H......",
      "...................H.....HH.....",
      "..................HH....HHH...H.",
      ".................HHH...HHHH..HH.",
      "...............HHHHHH.HHHHHHHHH.",
      "..............HHHHHHHHHHHHHHHHHH",
      "............HHHHHHjjjjjHHHHHHHHH",
      "...........HHHHjjHHHHHHHHHHHHHHH",
      "............HHHHHHHHHHHHHHHHHHHH",
      "..........HHHHHHHHHHHHHHHHHHHHHH",
      "...........HHHHHHHHHHHHHHHHHHHHH",
      ".............HHHHHHHHHHHHHHHHHHH",
      "............HHHHHHHHHHHhHHHHHHHH",
      "...........HHHHHHHHhHHHhHHHHhHHH",
      ".............HHHHHHhHHhHHHHHhHHH",
      ".............HHHHHHhHHHhHHHHhHHH",
      ".............HHHHHhHHHhHHHHhHHHH",
      ".............HHHH.HHHH.HHHH.HHHH",
      "..............HHH..HHH..HHH..HHH",
      "...............HH...HH...HH...HH",
      "................H....H....H....H",
    ]]],
    long: [["hair_back", 20, 0, Array(30).fill("............hhhhhhhhhhhhhhhhhhhh")], ["hair", HAIR_TOP, 0, [
      ...CROWN,
      ".............HHHHHHHHHHHhHHHHHHH",
      ".............HHHHHHHhHHHhHHHHhHH",
      ".............HHHHHHHhHHhHHHHHhHH",
      ".............HHHHHHhHHHhHHHHhHHH",
      ".............HHHHHHhHHhHHHHHhHHH",
      "............HHHHHhHHHhHHHHhHHHHH",
      "............HHHHHHHH.HHHHHHHHHHH",
      "............HHHHHHH...HHHHH.HHHH",
      "............HHHHHH......HHH...HH",
      "............HHHHH........H.....H",
      "............HHHhH...............",
      "............HHHhH...............",
      "............HHHhH...............",
      "............HHhHH...............",
      "............HHhHH...............",
      "............HHhHH...............",
      "............HHhHH...............",
      "............HhHHH...............",
      "............HhHHHH..............",
      "............HhHHHH..............",
      "...........HHhHHHH..............",
      "...........HHhHHHH..............",
      "...........HhHHHHH..............",
      "...........HhHHHHH..............",
      "...........HhHHHHHH.............",
      "...........HhHHHHHH.............",
      "..........HHhHHHHHH.............",
      "..........HHhHHHHHH.............",
      "..........HhHHHHHHH.............",
      "..........HhHHHHHHH.............",
      "..........HhHHHHHHHH............",
      "..........HhHHHhHHHH............",
      "..........HhHHHhHHHH............",
      "...........hHH.hHHH.............",
      "...........hH...hH..............",
      "............h....h..............",
    ]]],
    bun: [["hair", 0, 0, [
      "..........................HHHHHH",
      ".........................HHHjjHH",
      "........................HHHjHHHH",
      "........................HHHHHHHH",
      "........................HHHHHHHH",
      ".........................RRRRRRR",
      ...CROWN,
      ".............HHHHHHHhHHHHHH.....",
      ".............HHHHHHhHHH.........",
      ".............HHHHHhHH...........",
      "..............HHHhH.............",
      "..............HHhH..............",
      "..............HHH...............",
      "..............HHH...............",
      "...............HH...............",
    ]]],
    mohawk: [["hair", 1, 0, [
      ".............................HHH",
      "............................HHjH",
      "...........................HHjHH",
      "...........................HjHHH",
      "...........................HjHHH",
      "...........................HHHHH",
      "...........................HHHHH",
      "...........................HHhHH",
      "...........................HHhHH",
      "...........................HhHHH",
      "...........................HhHHH",
      "...........................HHHHH",
      "...........................HHHHH",
      "............................HHHH",
      "............................HHH.",
    ]]],
  };

  // Glasses over the eyes, with the temples back to the ears.
  const FACE = {
    none: [],
    glasses: [["glasses", 25, 15, [
      "....KKKKKKKKKK...",
      "KKKKK........KKKK",
      "....K........K...",
      "....K........K...",
      "....K........K...",
      "....K........K...",
      "....KKKKKKKKKK...",
    ]]],
    shades: [["glasses", 26, 15, [
      "....KKKKKKKKKK...",
      "KKKKKgKKKKKKKKKKK",
      "....KKgKKKKKKK...",
      "....KKKKKKKKKK...",
      "....KKKKKKKKKK...",
      ".....KKKKKKKK....",
    ]]],
  };

  // Hats; a cloth one hides the hair above the row in HAT_HIDES.
  const HATS = {
    none: [],
    cap: [["hat", 4, 0, [
      "......................CCCCCCCCcc",
      "...................CCCCCCCCcCCCC",
      ".................CCCCCCCCCcCCCCC",
      "................CCCCCCCCCcCCCCCC",
      "...............CCCCCCCCCcCCCCCCC",
      "..............CCCCCCCCCcCCCCCCCC",
      "..............CCCCCCCCcCCCCCCCCC",
      ".............CCCCCCCCcCCCCCCCCCC",
      ".............CCCCCCCcCCCCCCCCCCC",
      ".............CCCCCCCcCCCCCCCCCCC",
      ".............CCCCCCCcCCCCCCCCCCC",
      "............cccccccccccccccccccc",
      "...........ccccccccccccccccccccc",
      "............qqqqqqqqqqqqqqqqqqqq",
    ]]],
    beanie: [["hat", 0, 0, [
      ".............................WWW",
      "............................WWWW",
      "............................WWWW",
      "......................CCCCCCWWWW",
      "...................CCCCCCCCCCCCC",
      ".................CCCCCCCCCCCCCCC",
      "................CCCCCCCCCCCCCCCC",
      "...............CCCCCCCCCCCCCCCCC",
      "..............CCCCCCCCCCCCCCCCCC",
      "..............CCCCCCCCCCCCCCCCCC",
      ".............CCCCCCCCCCCCCCCCCCC",
      ".............CCCCCCCCCCCCCCCCCCC",
      ".............CCCCCCCCCCCCCCCCCCC",
      "............CcCcCcCcCcCcCcCcCcCc",
      "............CcCcCcCcCcCcCcCcCcCc",
      "............CcCcCcCcCcCcCcCcCcCc",
      "............CcCcCcCcCcCcCcCcCcCc",
    ]]],
    headphones: [["hat", 3, 0, [
      "......................KKKKKKKKKK",
      "...................KKKKKKKKKKKKK",
      ".................KKKK...........",
      "................KKK.............",
      "...............KKK..............",
      "..............KKK...............",
      "..............KK................",
      ".............KKK................",
      ".............KK.................",
      ".............KK.................",
      ".............KK.................",
      ".............KK.................",
      ".............KK.................",
      ".............KK.................",
      ".............KK.................",
      ".............KK.................",
      ".............KK.................",
      ".............KK.................",
      "..........KKKKK.................",
      ".........KKKRKK.................",
      ".........KKRRKK.................",
      ".........KKRRKK.................",
      ".........KKRRKK.................",
      ".........KKRRKK.................",
      ".........KKKRKK.................",
      "..........KKKKK.................",
    ]]],
    crown: [["hat", 1, 0, [
      ".....................Y.....Y....",
      ".....................YY...YYY...",
      ".....................YYY.YYYYY.Y",
      ".....................YYYYYYYYYYY",
      ".....................YYYYYYYYYYY",
      ".....................yYRRYYYYYYY",
      ".....................yYRRYYYYyRR",
      ".....................yyyyyyyyyyy",
    ]]],
    halo: [["hat", 0, 0, [
      "....................yYYYYYYYYYYY",
      "..................yYY...........",
      "...................yYYYYYYYYYYYY",
    ]]],
    wizard: [["hat", 0, 0, [
      "..............................CC",
      ".............................CCC",
      "............................CCCC",
      "...........................CCCCC",
      "..........................CCCCCC",
      ".........................CCCCCCC",
      "........................CCCCCYCC",
      ".......................CCCCCYYYC",
      "......................CCCCCCCYCC",
      ".....................CCCCCCCCCCC",
      "....................CCCCCCCCCCCC",
      "...................CCCCCCCCCCCCC",
      "..................CCCCCCCCCCCCCC",
      ".......ccccccccccccccccccccccccc",
      ".....cccccccccccccccccccccccccc.",
      ".......qqqqqqqqqqqqqqqqqqqqqqqqq",
    ]]],
  };
  const HAT_HIDES = {cap: 15, beanie: 15, wizard: 14};

  // The neckline and what lies on the chest; the shoulders are BODY in the top's color.
  const TOPS = {
    // A ribbed crew neck and the sleeves' seams down from the shoulders.
    tee: [
      ["top", 47, 25, ["cc.....", ".cccccc", "..ttttt"]],
      ["top", 51, 9, ["....t", "....t", "...t.", "...t.", "...t.", "..t..", "..t..", "..t..",
                      ".t...", ".t...", ".t...", ".t...", ".t..."]],
    ],
    shirt: [["top", 45, 21, [
      "....UUUUUU.",
      "...UUUuuUU.",
      "..UUUUuUUU.",
      "...UUUUUUq.",
      "......UUqq.",
      "..........q",
      "..........U",
      "..........q",
      "..........q",
      "..........U",
      "..........q",
      "..........q",
      "..........U",
    ]]],
    tank: [["top", 47, 0, [
      "......................ssss......",
      ".................SSSSSssss......",
      ".............SSSSSSSSTTsss......",
      "..........SSSSSSSSSSSTTsss......",
      "........SSSSSSSSSSSSSTTss.......",
      ".......SSSSSSSSSSSSSSTTs........",
      "......SSSSSSSSSSSSSSTTTTs.......",
      ".....SSSSSSSSSSSSSSSTTTTTT......",
      ".....SSSSSSSSSSSSSSSTTTTTTTTTTTT",
      "....SSSSSSSSSSSSSSSTTTTTTTTTTTTT",
      "....SSSSSSSSSSSSSSSTTTTTTTTTTTTT",
      "....SSSSSSSSSSSSSSTTTTTTTTTTTTTT",
      "....SSSSSSSSSSSSSSTTTTTTTTTTTTTT",
      "....SSSSSSSSSSSSSSTTTTTTTTTTTTTT",
      "....SSSSSSSSSSSSSSTTTTTTTTTTTTTT",
      "....SSSSSSSSSSSSSSTTTTTTTTTTTTTT",
      "....SSSSSSSSSSSSSSTTTTTTTTTTTTTT",
    ]]],
    hoodie: [["top", 43, 19, [
      "...tttt......",
      "..tTTTtt.....",
      ".tTTTTTt.....",
      ".tTTTTTTt....",
      ".ttTTTTTTtttt",
      "..ttTTTTTTTTt",
      "....tttttTTTT",
      ".........U...",
      ".........U...",
      ".........U...",
      ".........W...",
    ]]],
    jacket: [["top", 46, 22, [
      "...qUUUUUU",
      "..qqUUUUUU",
      "..qtqUUUUU",
      "...tqUUUUU",
      "...ttqUUUU",
      "....tqUUUU",
      "....ttqUUU",
      ".....tqUUU",
      ".....ttqUU",
      "......tqUU",
      "......ttqU",
      ".......tqU",
      ".......ttq",
      "........tq",
      "........tq",
      "........tq",
      "........tq",
    ]]],
    cape: [["top", 38, 18, [
      "..cc..........",
      "..ccc.........",
      "..cccc........",
      "..ccccc.......",
      "..cccccc......",
      "..ccccccc.....",
      "...cccccccc...",
      "...ccccccccc..",
      "....cccccccc..",
      "..........YYYY",
      "..........YyYY",
      "...........YYY",
    ]]],
    armor: [["top", 46, 0, [
      "..................gggg..........",
      "..............gggGGGGGg.........",
      "............ggGGGGGGGGGg........",
      "..........ggGGGGGGGGGGGGg..GGGGG",
      "........ggGGGGGGGGGGGGGGGgGGGGGg",
      ".......gGGGGGGGGGGGGGGGGGgGGGGGg",
      "......gGGGGGGGGGGGGGGGGGGgGGGGGg",
      ".....gGGGGGGGGGGGGGGGGGGGgGGGGGg",
      "....GGGGGGGGGGGGGGGGGGGGgGGGGGGg",
      "....ggggggggggggggggggggGGGGGGGg",
      "....GGGGGGGGGGGGGGGGGGGGGGGGGGGg",
      "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "....TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "....GGGGGGGGGGGGGGGGGGGGGGGGGGGg",
      "....GGGGGGGGGGGGGGGGGGGGGGGGGGGg",
      "....GGGGGGGGGGGGGGGGGGGGGGGGGGGg",
      "....GGGGGGGGGGGGGGGGGGGGGGGGGGGg",
      "....GGGGGGGGGGGGGGGGGGGGGGGGGGGg",
    ]]],
  };

  // Draw order, back to front.
  const STACK = ["hair_back", "body", "neck", "top", "head", "face", "hair", "glasses", "hat"];
  // Masses that get shading, by slot: the letter of each tone.
  const MASS = {hair_back: "H", body: "T", neck: "S", head: "S", hair: "H", hat: "C"};

  const blank = () => Array.from({length: N}, () => Array(N).fill("."));

  // A part onto a grid; half rows are mirrored around the middle.
  function put(grid, top, left, rows) {
    rows.forEach((row, i) => {
      const y = top + i;
      if (y < 0 || y >= N) return;
      const half = left + row.length <= N / 2;
      for (let x = 0; x < row.length; x++) {
        const c = row[x];
        if (c === ".") continue;
        const at = left + x;
        if (at >= 0 && at < N) grid[y][at] = c;
        if (half) grid[y][N - 1 - at] = c;
      }
    });
  }

  // Shading of a flat mass: the light comes from the upper left, so the right and lower
  // edges fall into shade, two pixels deep, and the deepest pixel next to the edge goes
  // darker still. Lower case is the shade, the "deep" letter darker.
  const TONES = {S: ["s", "z"], H: ["h", "k"], T: ["t", "q"], C: ["c", "q"]};
  function shade(layer, base) {
    const [mid, deep] = TONES[base];
    // The bust goes on below the frame: its bottom edge is not the edge of the body.
    const filled = (x, y) => y >= N || (x >= 0 && y >= 0 && x < N && layer[y][x] !== ".");
    const out = layer.map((r) => r.slice());
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (layer[y][x] !== base) continue;
        if (!filled(x + 1, y) || !filled(x, y + 1)) out[y][x] = deep;
        else if (!filled(x + 2, y) || !filled(x + 1, y + 1) || !filled(x, y + 2)) out[y][x] = mid;
      }
    }
    return out;
  }

  function frame(look) {
    const L = root.LCSHero.clean(look);
    const layers = Object.fromEntries(STACK.map((slot) => [slot, []]));
    layers.body.push([BODY_TOP, 0, BODY]);
    layers.neck.push([NECK_TOP, NECK_LEFT, NECK]);
    layers.head.push([HEAD_TOP, 0, HEAD]);
    const parts = [].concat(NOSE, BLUSH, EYES[L.eyes], MOUTH[L.mouth], HAIR[L.hair], FACE[L.face],
                            TOPS[L.top], HATS[L.hat]);
    const hides = HAT_HIDES[L.hat] || 0;
    for (const [slot, top, left, rows] of parts) {
      const cut = slot === "hair" || slot === "hair_back" ? hides - top : 0;
      layers[slot].push([top, left, cut > 0 ? rows.map((row, i) => (i < cut ? "" : row)) : rows]);
    }

    const grid = blank();
    for (const slot of STACK) {
      let layer = blank();
      for (const [top, left, rows] of layers[slot]) put(layer, top, left, rows);
      if (MASS[slot]) layer = shade(layer, MASS[slot]);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (layer[y][x] !== ".") grid[y][x] = layer[y][x];
    }
    outline(grid);
    return {rows: grid.map((r) => r.join("")), palette: palette(L)};
  }

  // A dark line around the whole figure.
  function outline(grid) {
    const edge = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (grid[y][x] !== ".") continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const v = grid[y + dy] && grid[y + dy][x + dx];
          return v && v !== ".";
        });
        if (near) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) grid[y][x] = "O";
  }

  // Colors: the look's pairs from the avatar builder, with a darker tone made from the shade
  // and a blush from the skin.
  function mix(a, b, k) {
    const x = root.LCSSprites.rgb(a), y = root.LCSSprites.rgb(b);
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("");
  }

  const OUTLINE = root.LCSSprites.OUTLINE;
  const BLUSH_RED = "#e86a7a", IRIS_BROWN = "#3a2418";   // what the blush and the iris mix towards
  const FIXED = {O: OUTLINE, E: "#1b1b2f", W: "#f4f2fa", M: "#6a2a3a", R: "#d9534f",
                 K: "#22222e", G: "#8a8aa0", g: "#c8c8d4", Y: "#e8c14a", y: "#b8902a", U: "#f4f2fa",
                 u: "#c8c6d4"};

  function palette(L) {
    const C = root.LCSHero.colorTables();
    const pair = (table, id) => C[table][id].slice(1, 3);
    const [S, s] = pair("skin", L.skin), [H, h] = pair("hair_color", L.hair_color);
    const [T, t] = pair("cloth", L.top_color);
    return Object.assign({}, FIXED, {
      S, s, z: mix(s, OUTLINE, 0.25), b: mix(S, BLUSH_RED, 0.35),
      H, h, k: mix(h, OUTLINE, 0.35),
      j: mix(H, "#ffffff", 0.3), I: mix(h, IRIS_BROWN, 0.7),
      T, t, q: mix(t, OUTLINE, 0.3), C: T, c: t,
    });
  }

  // The frame as RGBA pixels, for an ImageData.
  function image(look) {
    const f = frame(look), data = new Uint8ClampedArray(N * N * 4), rgb = {};
    for (const [k, v] of Object.entries(f.palette)) {
      rgb[k] = root.LCSSprites.rgb(v).concat(255);
    }
    f.rows.forEach((row, y) => {
      for (let x = 0; x < N; x++) if (rgb[row[x]]) data.set(rgb[row[x]], (y * N + x) * 4);
    });
    return {width: N, height: N, data};
  }

  // On a page: the portrait onto a canvas of its own size; CSS scales it up.
  function paint(canvas, look) {
    canvas.width = canvas.height = N;
    canvas.getContext("2d").putImageData(new ImageData(image(look).data, N, N), 0, 0);
  }

  root.LCSPortrait = {N, frame, image, paint};
})(typeof window !== "undefined" ? window : globalThis);
