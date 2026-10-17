// The arena: the player's hero, a 16x24 figure seen from the side, facing right (render.js
// flips it), with the gun in the front hand sticking out past the body, so a frame is 20
// wide. The figure is assembled from layers of parts; each part is rows of region letters
// that the look turns into colors, so one drawing of a leg serves every pair of trousers.
// No DOM: frames are checked in jsc. Colors come from the avatar builder (avatar.js).
//   const look = LCSHero.clean(saved)               // a valid look from anything
//   LCSHero.fromAvatar(profile.avatar)               // the look nearest to the avatar
//   const f = LCSHero.frame(look, "walk", 2, {recoil}) // {rows, palette, muzzle}
//   LCSHero.ANIMS.walk                               // {frames, fps}
"use strict";

(function (root) {
  const W = 20, H = 24;
  const BODY_X = 8;   // the column under the middle of the body: the hero stands there

  // --- the body ------------------------------------------------------------------
  // Region letters: S/s skin, E eyes, W white, M mouth, T/t top, U the shirt under a
  // jacket, A/a upper sleeve, B/b forearm, P/p hips and thighs, L/l shins, F/f shoes,
  // H/h hair, C/c hat cloth. The lower case is the far side or the shade.

  // A profile: the back of the head on the left, the ear, the nose, the chin, the neck.
  const HEAD = [
    ".....SSSSS......",
    "....SSSSSSS.....",
    "...SSSSSSSSS....",
    "...SSSSSSSSS....",
    "...sSSsSSSSSS...",
    "...sSSsSSSSS....",
    "....sSSSSSSS....",
    ".....ssSSSS.....",
    "......sSS.......",
  ];
  const HEAD_TOP = 2;

  const TORSO = [
    ".....TTTTT......",
    "....TTTTTTT.....",
    "....TTTTTTT.....",
    "....TTTTTTT.....",
    "....tTTTTTt.....",
    "....ttttttt.....",
  ];
  const TORSO_TOP = 11;

  const ARM_TOP = 12;
  // Aiming, the front hand holds the gun forward; at rest the gun hangs at the hip. The gun
  // is the last layer.
  const AIM_ARM = ["........AA......", ".........ABBS..."];
  const AIM_GUN = [".............GGGGg..", "............SKK.....", ".............K......"];
  const REST_ARM = ["........A.......", "........A.......", "........B.......", "........S......."];
  const REST_GUN = ["", "", "", ".........KGGGg..", ".........K......"];
  const HANGING_ARM = ["........A.......", "........B.......", "........S......."];
  const MUZZLE = {x: 18, y: ARM_TOP};   // the pixel right after the raised barrel

  // Legs end on the last row; the upper body sits on them `bob` rows lower.
  const HIPS_TOP = 17;   // where the hips are on standing legs
  const LEGS = {
    stand: [
      ".....PPPPPP.....",
      ".....pp..PP.....",
      ".....pp..PP.....",
      ".....ll..LL.....",
      ".....ll..LL.....",
      ".....ll..LL.....",
      ".....ff..FFF....",
    ],
    stride: [
      ".....PPPPPP.....",
      ".....pp..PP.....",
      "....pp....PP....",
      "....ll....LL....",
      "...ll......LL...",
      "...ll......LL...",
      "..ff.......FFF..",
    ],
    stride2: [
      ".....PPPPPP.....",
      ".....PP..pp.....",
      "....PP....pp....",
      "....LL....ll....",
      "...LL......ll...",
      "...LL......ll...",
      "..FFF.......ff..",
    ],
    pass: [
      ".....PPPPPP.....",
      "......pPPP......",
      "......pPPP......",
      "......lLL.......",
      "......lLL.......",
      ".......LL.......",
      ".......FFF......",
    ],
    kneel: [
      ".....PPPPPP.....",
      "....pPPPPPPPP...",
      "...ll......LL...",
      ".fffll.....FFF..",
    ],
  };

  // --- parts -----------------------------------------------------------------------
  // A part is a list of layers [slot, top row, rows]; the slot is its place in STACK.

  const HAIR = {
    none: [],
    short: [["hair", 1, [
      ".....HHHHH......",
      "....HHHHHHHH....",
      "...HHHHHHHHHH...",
      "...HHHHHh..H....",
      "...HHh..........",
      "...Hh...........",
      "...h............",
    ]]],
    spiky: [["hair", 0, [
      "....H..H..H.....",
      "....HH.HH.HH....",
      "...HHHHHHHHH....",
      "...HHHHHHHHHHH..",
      "...HHHHHh..H....",
      "...HHh..........",
      "...Hh...........",
    ]]],
    // Hair to the shoulders, falling behind the neck.
    long: [["hair_back", 9, [
      "..HHH...........",
      "..hHH...........",
      "..hHh...........",
      "...h............",
    ]], ["hair", 1, [
      ".....HHHHH......",
      "....HHHHHHHH....",
      "...HHHHHHHHHH...",
      "..HHHHHHh..H....",
      "..HHHh..........",
      "..HHHh..........",
      "..HHh...........",
      "..HHh...........",
    ]]],
    // Pulled back into a knot on the back of the head: the forehead stays open.
    bun: [["hair", 0, [
      ".hHh............",
      ".HHHhHHHH.......",
      ".hHhHHHHHHH.....",
      "...HHHHHHHHH....",
      "...HHHHHHh......",
      "...HHh..........",
    ]]],
    // A crest along the top; the sides are shaved.
    mohawk: [["hair", 0, [
      "....HHHH........",
      ".....HHHHHH.....",
      "....hhHHHHHh....",
      "...h.h..........",
      "...h............",
    ]]],
  };

  // One eye: the face is in profile.
  const EYES = {
    dots: [["face", 5, ["..........E.....", "..........E....."]]],
    big: [["face", 5, [".........WE.....", ".........WE....."]]],
    sleepy: [["face", 5, [".........ss.....", "..........E....."]]],
    happy: [["face", 5, ["..........E.....", ".........E.E...."]]],
    angry: [["face", 4, [".........E......", "..........E.....", "..........E....."]]],
    wink: [["face", 6, [".........EE....."]]],
  };
  // Eyes of the hurt and the downed hero, whatever the look.
  const EYES_HURT = [["face", 4, [".........E......", "..........E.....", ".........E......"]]];
  const EYES_DOWN = [["face", 5, [".........E.E....", "..........E.....", ".........E.E...."]]];

  const MOUTH = {
    smile: [["face", 8, [".........MM....."]]],
    flat: [["face", 8, ["..........E....."]]],
    open: [["face", 8, [".........EE.....", "..........M....."]]],
    grin: [["face", 8, [".........WW....."]]],
    frown: [["face", 8, ["..........M.....", ".........M......"]]],
  };

  // One lens in front of the eye and the temple back to the ear.
  const FACE = {
    none: [],
    glasses: [["face", 4, [".........KKK....", "......KKK.K.....", ".........K.K...."]]],
    shades: [["face", 5, ["......KKKKWK....", ".........KKK...."]]],
  };

  // `sleeve`: what the forearms are (top color, or bare skin); `bare`: bare arms.
  const TOPS = {
    tee: {sleeve: "skin"},
    shirt: {sleeve: "top", layers: [["over", 11, ["......WWW......."]]]},
    tank: {sleeve: "skin", bare: true, layers: [["over", 11, ["......SSS......."]]]},
    // The hood lies on the shoulders behind the neck; a pocket on the belly.
    hoodie: {sleeve: "top", layers: [["over", 10, ["....ttt.........", "....tTt........."]],
                                     ["over", 14, [".......ttt......"]]]},
    // Open at the front over a white shirt.
    jacket: {sleeve: "top", layers: [["over", 11, [
      "........UU......",
      ".........UU.....",
      ".........UU.....",
      "..........U.....",
    ]]]},
    // Metal with a trim in the top color.
    armor: {sleeve: "metal", layers: [["over", 11, [
      ".....ggggg......",
      "....gGGGGGg.....",
      "....GGGgGGG.....",
      "....GGGGGGG.....",
      "....tTTTTTt.....",
      "....GGGGGGG.....",
    ]]]},
  };

  const BOTTOMS = {
    pants: {shins: "bottom"},
    shorts: {shins: "skin"},
    skirt: {shins: "skin", layers: [["hips", HIPS_TOP, [
      ".....PPPPPP.....",
      "....PPPPPPPP....",
      "....pPpPpPpP....",
    ]]]},
  };

  // `tall`: the shoe color climbs up the shins.
  const SHOES = {sneakers: {}, boots: {tall: true}};

  const HATS = {
    none: [],
    cap: [["hat", 1, [
      ".....CCCCC......",
      "....CCCCCCC.....",
      "...CCCCCCCCcccc.",
    ]]],
    beanie: [["hat", 0, [
      ".......W........",
      ".....CCCCC......",
      "....CCCCCCC.....",
      "...CCCCCCCCC....",
      "...cCcCcCcCc....",
    ]]],
    // The band over the top down to the cup on the ear.
    headphones: [["hat", 1, [
      ".....KKK........",
      "......K.........",
      "......K.........",
      ".....KKK........",
      ".....KRK........",
      ".....KRK........",
      "......K.........",
    ]]],
    crown: [["hat", 0, [
      "....Y..Y..Y.....",
      "....YYYYYYY.....",
      "....yRyyyRy.....",
    ]]],
  };

  // --- the look --------------------------------------------------------------------

  // Slots of a look in the order the editor shows them; `parts` or `colors` names the
  // table of choices (colors are the avatar builder's tables).
  const SLOTS = [
    {key: "skin", colors: "skin"},
    {key: "hair", parts: HAIR},
    {key: "hair_color", colors: "hair_color"},
    {key: "eyes", parts: EYES},
    {key: "mouth", parts: MOUTH},
    {key: "face", parts: FACE},
    {key: "top", parts: TOPS},
    {key: "top_color", colors: "cloth"},
    {key: "bottom", parts: BOTTOMS},
    {key: "bottom_color", colors: "cloth"},
    {key: "shoes", parts: SHOES},
    {key: "shoes_color", colors: "cloth"},
    {key: "hat", parts: HATS},
  ];
  const DEFAULT_LOOK = {skin: "light", hair: "short", hair_color: "brown", eyes: "dots",
                        mouth: "smile", face: "none", top: "hoodie", top_color: "purple",
                        bottom: "pants", bottom_color: "gray", shoes: "sneakers",
                        shoes_color: "white", hat: "none"};

  const colorTables = () => root.SidequestAvatar.COLORS;
  const choices = (slot) => (slot.parts || colorTables()[slot.colors]);

  // Keeps known choices only; everything else falls back to the default look.
  function clean(look) {
    const out = {};
    for (const slot of SLOTS) {
      const v = look && look[slot.key];
      out[slot.key] = typeof v === "string" && Object.hasOwn(choices(slot), v) ? v : DEFAULT_LOOK[slot.key];
    }
    return out;
  }

  // The avatar builder's accessory is a hat or a thing on the face here.
  const ACC_FACE = {glasses: "glasses", shades: "shades"};
  const ACC_HAT = {headphones: "headphones", cap: "cap", beanie: "beanie", crown: "crown"};

  // The look closest to a builder avatar; a drawn or uploaded one has no parts and gets the
  // default look.
  function fromAvatar(avatar) {
    const parts = avatar && avatar.parts;
    if (!parts || typeof parts !== "object") return clean(null);
    return clean({
      skin: parts.skin, hair: parts.hair, hair_color: parts.hair_color, eyes: parts.eyes,
      mouth: parts.mouth, top: parts.body, top_color: parts.cloth,
      face: Object.hasOwn(ACC_FACE, parts.acc) ? ACC_FACE[parts.acc] : "none",
      hat: Object.hasOwn(ACC_HAT, parts.acc) ? ACC_HAT[parts.acc] : "none",
    });
  }

  // --- frames ----------------------------------------------------------------------

  const FIXED = {E: "#1b1b2f", W: "#f4f2fa", M: "#6a2a3a", K: "#22222e", R: "#d9534f",
                 G: "#8a8aa0", g: "#c8c8d4", Y: "#e8c14a", y: "#b8902a", U: "#f4f2fa"};

  // Draw order, back to front.
  const STACK = ["hair_back", "legs", "torso", "over", "hips", "head", "face", "hair",
                 "hat", "front_arm", "weapon"];
  const HEAD_SLOTS = new Set(["head", "face", "hair", "hat", "hair_back"]);

  // Pose of every frame: legs, how many rows the upper body sinks (`bob`), the head
  // thrown back (`lean`), the eyes and the front arm.
  const ANIMS = {
    idle: {fps: 2, poses: [{legs: "stand", bob: 0}, {legs: "stand", bob: 1}]},
    walk: {fps: 10, poses: [{legs: "stride", bob: 1}, {legs: "pass", bob: 0},
                            {legs: "stride2", bob: 1}, {legs: "pass", bob: 0}]},
    hurt: {fps: 1, poses: [{legs: "stand", bob: 0, lean: -1, eyes: EYES_HURT}]},
    down: {fps: 1, poses: [{legs: "kneel", bob: 3, eyes: EYES_DOWN, unarmed: true}]},
  };
  for (const a of Object.values(ANIMS)) a.frames = a.poses.length;

  function put(grid, top, left, rows, map) {
    rows.forEach((row, i) => {
      const y = top + i;
      if (y < 0 || y >= H) return;
      for (let x = 0; x < row.length; x++) {
        const c = row[x];
        if (c === "." || x + left < 0 || x + left >= W) continue;
        grid[y][x + left] = map[c] || c;
      }
    });
  }

  // {rows, palette, muzzle}: rows of W letters, "." transparent; `muzzle` is where shots
  // leave the barrel, or null when the gun is not raised. options: recoil (pulls the arm and
  // the gun back), rest (the gun lowered: nothing to shoot at for a while).
  function frame(look, anim, n, options) {
    const o = options || {};
    const a = ANIMS[anim] || ANIMS.idle;
    const pose = a.poses[Math.abs(n | 0) % a.poses.length];
    const L = clean(look);
    const top = TOPS[L.top], bottom = BOTTOMS[L.bottom], shoes = SHOES[L.shoes];
    // Letters that switch with the parts: sleeves and shins can be bare skin.
    const map = {};
    if (top.sleeve === "skin") Object.assign(map, {B: "S", b: "s"});
    if (top.bare) Object.assign(map, {A: "S", a: "s"});
    if (top.sleeve === "metal") Object.assign(map, {A: "G", a: "G", B: "g", b: "G"});
    if (bottom.shins === "skin") Object.assign(map, {L: "S", l: "s"});

    const legs = LEGS[pose.legs];
    const layers = Object.fromEntries(STACK.map((slot) => [slot, []]));
    layers.legs.push([H - legs.length, legs]);
    // Boots: the shoe color over the shin row right above the shoes.
    if (shoes.tall) {
      layers.legs.push([H - 2, [legs[legs.length - 2].replace(/[Ll]/g, (c) => (c === "L" ? "F" : "f"))]]);
    }
    layers.torso.push([TORSO_TOP, TORSO]);
    layers.head.push([HEAD_TOP, HEAD]);
    const raised = !pose.unarmed && (o.recoil || !o.rest);
    if (pose.unarmed) {
      layers.front_arm.push([ARM_TOP, HANGING_ARM]);
    } else {
      layers.front_arm.push([ARM_TOP, raised ? AIM_ARM : REST_ARM]);
      layers.weapon.push([ARM_TOP, raised ? AIM_GUN : REST_GUN]);
    }
    const parts = [].concat(HAIR[L.hair], pose.eyes || EYES[L.eyes], MOUTH[L.mouth], FACE[L.face],
                            top.layers || [], bottom.layers || [], HATS[L.hat]);
    for (const [slot, y, rows] of parts) layers[slot].push([y, rows]);

    const grid = Array.from({length: H}, () => Array(W).fill("."));
    const back = o.recoil ? -1 : 0;
    for (const slot of STACK) {
      for (const [y, rows] of layers[slot]) {
        // The legs stay put; the hips follow the legs, the rest sinks by `bob`.
        const dy = slot === "legs" ? 0 : slot === "hips" ? H - legs.length - HIPS_TOP : pose.bob;
        const dx = (HEAD_SLOTS.has(slot) ? pose.lean || 0 : 0)
          + (slot === "front_arm" || slot === "weapon" ? back : 0);
        put(grid, y + dy, dx, rows, map);
      }
    }

    const C = colorTables();
    const pair = (table, id) => C[table][id].slice(1, 3);
    const [S, s] = pair("skin", L.skin), [Hc, h] = pair("hair_color", L.hair_color);
    const [T, t] = pair("cloth", L.top_color), [P, p] = pair("cloth", L.bottom_color);
    const [F, f] = pair("cloth", L.shoes_color);
    const palette = Object.assign({}, FIXED, {S, s, H: Hc, h, T, t, A: T, a: t, B: T, b: t,
                                              C: T, c: t, P, p, L: P, l: p, F, f});
    const muzzle = raised ? {x: MUZZLE.x + back, y: MUZZLE.y + pose.bob} : null;
    return {rows: grid.map((r) => r.join("")), palette, muzzle};
  }

  root.LCSHero = {W, H, BODY_X, SLOTS, DEFAULT_LOOK, ANIMS, clean, fromAvatar, frame};
})(typeof window !== "undefined" ? window : globalThis);
