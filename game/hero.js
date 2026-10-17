// The arena: the player's hero, a 16x24 figure seen from the side, facing right (render.js
// flips it), with the gun in the front hand sticking out past the body, so a frame is 20
// wide. The figure is assembled from layers of parts; each part is rows of region letters
// that the look turns into colors, so one drawing of a leg serves every pair of trousers.
// No DOM: frames are checked in jsc. Colors come from the avatar builder (avatar.js).
//   const look = LCSHero.clean(saved)               // a valid look from anything
//   LCSHero.fromAvatar(profile.avatar)               // the look nearest to the avatar
//   const f = LCSHero.frame(look, "walk", 2, {recoil}) // {rows, palette, muzzle}
//   LCSHero.ANIMS.walk                               // {frames, fps}
//   LCSHero.isOpen(balance.character.unlocks, got, "hat", "crown")   // for the editor
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

  // One eye: the face is in profile. The white behind the pupil keeps it visible on dark skin.
  const EYES = {
    dots: [["face", 5, [".........WE.....", "..........E....."]]],
    big: [["face", 4, ["..........E.....", ".........WE.....", ".........WE....."]]],
    sleepy: [["face", 5, [".........ss.....", ".........WE....."]]],
    happy: [["face", 5, ["..........E.....", ".........E.E...."]]],
    angry: [["face", 4, [".........E......", "..........E.....", ".........WE....."]]],
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
    // A cape behind the back from the shoulders to the knees, fastened with a gold clasp.
    // In the shade of the top's color with folds, so it does not merge with the body.
    cape: {sleeve: "top", layers: [["hair_back", 11, [
      "...ttt..........",
      "..tttt..........",
      "..tTtt..........",
      ".ttTtt..........",
      ".tTttt..........",
      ".tTtTt..........",
      "tTttt...........",
      "tTtTt...........",
      "tttt............",
    ]], ["over", 11, [".......Y........"]]]},
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
    // A knitted dome with a pompom and a folded ribbed band.
    beanie: [["hat", 0, [
      "......WWW.......",
      ".....CCWCCc.....",
      "....CCCCCCCc....",
      "...cCCCCCCCCc...",
      "...cCcCcCcCcC...",
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
    halo: [["hat", 0, ["....yYYYYy......"]]],
    // A short cone with a star and a wide brim.
    wizard: [["hat", 0, [
      "........Cc......",
      "......CCCC......",
      ".....CCYCCC.....",
      "..cccccccccccc..",
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

  // Clothes take the avatar builder's colors plus rare ones of their own:
  // [label, base, shade, English label].
  const EXTRA_CLOTH = {gold: ["золотая", "#d9a93a", "#a87c22", "gold"],
                       neon: ["неоновая", "#ff4fb0", "#c83088", "neon"]};
  let tables = null;
  function colorTables() {
    if (!tables) {
      const C = root.SidequestAvatar.COLORS;
      tables = {skin: C.skin, hair_color: C.hair_color, cloth: Object.assign({}, C.cloth, EXTRA_CLOTH)};
    }
    return tables;
  }
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

  // --- names, presets and unlocks ----------------------------------------------------

  const SLOT_NAMES = {
    skin: ["Кожа", "Skin"], hair: ["Причёска", "Hair"], hair_color: ["Цвет волос", "Hair color"],
    eyes: ["Глаза", "Eyes"], mouth: ["Рот", "Mouth"], face: ["Очки", "Glasses"],
    top: ["Верх", "Top"], top_color: ["Цвет верха", "Top color"], bottom: ["Низ", "Bottom"],
    bottom_color: ["Цвет низа", "Bottom color"], shoes: ["Обувь", "Shoes"],
    shoes_color: ["Цвет обуви", "Shoes color"], hat: ["Шапка", "Hat"],
  };
  // Names of the drawn parts; colors take theirs from the avatar builder.
  const PART_NAMES = {
    hair: {none: ["нет", "none"], short: ["короткая", "short"], spiky: ["ёжик", "spiky"],
           long: ["длинная", "long"], bun: ["пучок", "bun"], mohawk: ["ирокез", "mohawk"]},
    eyes: {dots: ["точки", "dots"], big: ["большие", "big"], sleepy: ["сонные", "sleepy"],
           happy: ["довольные", "happy"], angry: ["злые", "angry"], wink: ["закрытые", "closed"]},
    mouth: {smile: ["улыбка", "smile"], flat: ["ровный", "flat"], open: ["открытый", "open"],
            grin: ["оскал", "grin"], frown: ["грустный", "frown"]},
    face: {none: ["нет", "none"], glasses: ["очки", "glasses"], shades: ["тёмные", "shades"]},
    top: {tee: ["футболка", "t-shirt"], shirt: ["рубашка", "shirt"], tank: ["майка", "tank top"],
          hoodie: ["худи", "hoodie"], jacket: ["пиджак", "jacket"], cape: ["плащ", "cape"],
          armor: ["доспех", "armor"]},
    bottom: {pants: ["брюки", "trousers"], shorts: ["шорты", "shorts"], skirt: ["юбка", "skirt"]},
    shoes: {sneakers: ["кеды", "sneakers"], boots: ["ботинки", "boots"]},
    hat: {none: ["нет", "none"], cap: ["кепка", "cap"], beanie: ["шапка", "beanie"],
          headphones: ["наушники", "headphones"], crown: ["корона", "crown"], halo: ["нимб", "halo"],
          wizard: ["колпак", "wizard hat"]},
  };

  const slotOf = (key) => SLOTS.find((s) => s.key === key);
  const choiceIds = (key) => Object.keys(choices(slotOf(key)));
  const slotName = (key) => SLOT_NAMES[key];

  // [ru, en] of a choice of a slot.
  function choiceName(key, id) {
    const slot = slotOf(key);
    if (slot.parts) return PART_NAMES[key][id];
    const option = root.SidequestAvatar.OPTIONS.find((o) => o.key === slot.colors);
    const c = option && option.choices.find((x) => x.id === id);
    const extra = EXTRA_CLOTH[id];
    return c ? [c.label, c.label_en] : [extra[0], extra[3]];
  }

  const isColor = (key) => !slotOf(key).parts;

  // A color choice as CSS, for the editor's swatches.
  const swatch = (key, id) => colorTables()[slotOf(key).colors][id][1];

  // Ready looks for the editor; they use only parts that are open from the start.
  const PRESETS = [
    {id: "developer", name: "Разработчик", name_en: "Developer", look: DEFAULT_LOOK},
    {id: "reviewer", name: "Ревьюер", name_en: "Reviewer",
     look: {skin: "fair", hair: "short", hair_color: "gray", eyes: "dots", mouth: "flat",
            face: "glasses", top: "shirt", top_color: "blue", bottom: "pants",
            bottom_color: "black", shoes: "sneakers", shoes_color: "white", hat: "none"}},
    {id: "devops", name: "Девопс", name_en: "DevOps",
     look: {skin: "tan", hair: "bun", hair_color: "black", eyes: "sleepy", mouth: "flat",
            face: "none", top: "jacket", top_color: "black", bottom: "pants",
            bottom_color: "blue", shoes: "boots", shoes_color: "black", hat: "beanie"}},
    {id: "intern", name: "Стажёр", name_en: "Intern",
     look: {skin: "light", hair: "spiky", hair_color: "blonde", eyes: "big", mouth: "open",
            face: "none", top: "tee", top_color: "yellow", bottom: "shorts",
            bottom_color: "blue", shoes: "sneakers", shoes_color: "red", hat: "cap"}},
    {id: "lead", name: "Тимлид", name_en: "Team lead",
     look: {skin: "dark", hair: "short", hair_color: "black", eyes: "dots", mouth: "grin",
            face: "none", top: "hoodie", top_color: "black", bottom: "pants",
            bottom_color: "gray", shoes: "sneakers", shoes_color: "white", hat: "headphones"}},
    {id: "designer", name: "Дизайнер", name_en: "Designer",
     look: {skin: "brown", hair: "long", hair_color: "pink", eyes: "happy", mouth: "smile",
            face: "shades", top: "tank", top_color: "white", bottom: "skirt",
            bottom_color: "purple", shoes: "boots", shoes_color: "black", hat: "none"}},
    {id: "orc", name: "Орк с бэкенда", name_en: "Backend orc",
     look: {skin: "orc", hair: "mohawk", hair_color: "black", eyes: "angry", mouth: "frown",
            face: "none", top: "tank", top_color: "gray", bottom: "pants",
            bottom_color: "green", shoes: "boots", shoes_color: "black", hat: "none"}},
  ];

  // Rare choices open with achievements: `unlocks` is balance.character.unlocks, entries
  // {slot, id, achievement, rarity}, where `slot` is a slot or a color table ("cloth" covers
  // every clothes color). A choice that is open from the start is not in the list.
  function unlockOf(unlocks, key, id) {
    const slot = slotOf(key);
    return (unlocks || []).find((x) => x.id === id && (x.slot === slot.key || x.slot === slot.colors)) || null;
  }

  // The achievement that opens a choice, or null when it is open anyway.
  function lockedBy(unlocks, key, id) {
    const u = unlockOf(unlocks, key, id);
    return u ? u.achievement : null;
  }

  // "common" for a choice open from the start, otherwise "rare", "epic" or "legendary".
  function rarity(unlocks, key, id) {
    const u = unlockOf(unlocks, key, id);
    return u ? u.rarity : "common";
  }

  // `got`: the earned achievements, {id: when}. `owned`: the look carried over from the
  // avatar builder; what it wears stays open, so an old crown is not taken away.
  function isOpen(unlocks, got, key, id, owned) {
    const a = lockedBy(unlocks, key, id);
    return !a || Object.hasOwn(got || {}, a) || (!!owned && owned[key] === id);
  }

  // A look of open choices picked at random; `rnd` returns [0, 1).
  function random(unlocks, got, rnd, owned) {
    const out = {};
    for (const slot of SLOTS) {
      const ids = choiceIds(slot.key).filter((id) => isOpen(unlocks, got, slot.key, id, owned));
      out[slot.key] = ids[Math.floor((rnd || Math.random)() * ids.length)];
    }
    return out;
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

  root.LCSHero = {W, H, BODY_X, SLOTS, DEFAULT_LOOK, ANIMS, PRESETS, clean, fromAvatar, frame,
                  choiceIds, slotName, choiceName, isColor, swatch, lockedBy, rarity, isOpen, random};
})(typeof window !== "undefined" ? window : globalThis);
