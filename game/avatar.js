// Avatars: drawing, the builder and the presets. Format: sidequest/avatar.py.
//   const p = await Sidequest.profile();
//   SidequestAvatar.animate(canvas, p.avatar)    // null avatar = the default one
//   p.avatar && p.avatar.parts                   // builder parts, to redraw in the game's style
"use strict";

(function (root) {
  const CHARS = "0123456789abcdefghijklmnopqrstuv";
  const SIZE = 16;

  // Fixed colors of the builder sprites. Slots that the player picks are below.
  const FIXED = {
    O: "#14142a",  // outline
    E: "#1b1b2f",  // eyes
    W: "#f4f2fa",  // white
    M: "#6a2a3a",  // mouth
    T: "#d9534f",  // tongue, red details
    K: "#22222e",  // black plastic
    G: "#8a8aa0",  // metal
    g: "#c8c8d4",  // light metal, highlights
    Y: "#e8c14a",  // gold
    y: "#b8902a",  // dark gold
    L: "#7ff0e8",  // glow
    P: "#e86aa8",  // pink
  };

  // Colors the player picks: [label, base, shade].
  const COLORS = {
    skin: {
      light: ["светлая", "#f6d3b3", "#e0b08f"], fair: ["бежевая", "#eec39a", "#d39e74"],
      tan: ["смуглая", "#d49a6a", "#b47b50"], brown: ["коричневая", "#a86b45", "#8a5233"],
      dark: ["тёмная", "#6e4430", "#553222"], orc: ["зелёная", "#8fbf6a", "#6f9a4f"],
      alien: ["голубая", "#8fb3e0", "#6f8fc0"],
    },
    hair_color: {
      black: ["чёрные", "#2a2333", "#18131f"], brown: ["каштановые", "#6b4226", "#4e2e19"],
      blonde: ["светлые", "#e8c66a", "#c9a44a"], ginger: ["рыжие", "#d0652e", "#a84d20"],
      gray: ["седые", "#c8c8d4", "#9a9aaa"], pink: ["розовые", "#e86aa8", "#c04c88"],
      blue: ["синие", "#4a7ae8", "#3459b8"], green: ["зелёные", "#4fbf6f", "#3a9a55"],
      purple: ["фиолетовые", "#8a5bd0", "#6a40a8"],
    },
    cloth: {
      red: ["красная", "#c8443c", "#9a3029"], blue: ["синяя", "#3f6fc8", "#2f529a"],
      green: ["зелёная", "#3f8f6b", "#2c6a4e"], purple: ["фиолетовая", "#6a4bb0", "#4e3486"],
      yellow: ["жёлтая", "#e8c14a", "#c09a2e"], gray: ["серая", "#6a6a80", "#4e4e60"],
      black: ["чёрная", "#2a2a3a", "#1a1a26"], white: ["белая", "#e8e6f0", "#bab8c8"],
    },
    bg: {
      none: ["нет", null, null], night: ["ночь", "#26264a", null], sky: ["небо", "#5b8bd0", null],
      mint: ["мята", "#7fc8a0", null], rose: ["роза", "#d07a8a", null],
      sand: ["песок", "#e0c890", null], void: ["пустота", "#0d0d1a", null],
    },
  };
  const SLOTS = {S: ["skin", 1], s: ["skin", 2], H: ["hair_color", 1], h: ["hair_color", 2],
                 C: ["cloth", 1], c: ["cloth", 2]};

  // Sprites, 16 rows of 16 characters each; "." is transparent. Drawn in LAYERS order.
  const BLANK = ".".repeat(SIZE);
  const rows = (top, lines) => {
    const out = Array(SIZE).fill(BLANK);
    lines.forEach((line, i) => { out[top + i] = line; });
    return out;
  };

  const HEAD = rows(3, [
    ".....OOOOOO.....",
    "....OSSSSSSO....",
    "...OSSSSSSSSO...",
    "...OSSSSSSSSO...",
    "...OSSSSSSSSO...",
    "...OSSSSSSSSO...",
    "...OSSSSSSSSO...",
    "....OsSSSSsO....",
    ".....OOSSOO.....",
    ".......ss.......",
  ]);

  const PARTS = {
    body: {
      tee: ["футболка", rows(12, [
        "...OOCCCCCCOO...",
        "..OCCCCCCCCCCO..",
        ".OCCCCCCCCCCCCO.",
        ".OCcCCCCCCCCcCO.",
      ])],
      hoodie: ["худи", rows(1, [
        "....OOOOOOOO....",
        "...OCCCCCCCCO...",
        "..OCCCCCCCCCCO..",
        ".OCCCCCCCCCCCCO.",
        ".OCC........CCO.",
        ".OCC........CCO.",
        ".OCC........CCO.",
        ".OCC........CCO.",
        ".OcC........CcO.",
        ".OcCC......CCcO.",
        ".OCCCC....CCCCO.",
        ".OCCCCCCCCCCCCO.",
        ".OCCCCWCCWCCCCO.",
        ".OCCCCWCCWCCCCO.",
        ".OCcCCCCCCCCcCO.",
      ])],
      jacket: ["пиджак", rows(12, [
        "...OOCCWWCCOO...",
        "..OCCCCWWCCCCO..",
        ".OCCCCcWWcCCCCO.",
        ".OCCCCcWWcCCCCO.",
      ])],
      armor: ["доспех", rows(12, [
        "...OOGGGGGGOO...",
        "..OGgGGGGGGgGO..",
        ".OGGGgGGGGgGGGO.",
        ".OGGGGGYYGGGGGO.",
      ])],
    },
    hair: {
      none: ["нет", []],
      short: ["короткие", rows(2, [
        ".....OOOOOO.....",
        "....OHHHHHHO....",
        "...OHHHHHHHHO...",
        "...OHHhHHhHHO...",
        "...OH......HO...",
      ])],
      spiky: ["ёжик", rows(0, [
        "....O.O..O.O....",
        "...OHOHOOHOHO...",
        "...OHHHHHHHHO...",
        "..OHHHHHHHHHHO..",
        "...OHHHHHHHHO...",
        "...OHhHHHHhHO...",
        "...OH......HO...",
      ])],
      long: ["длинные", rows(2, [
        ".....OOOOOO.....",
        "....OHHHHHHO....",
        "...OHHHHHHHHO...",
        "..OHHHhHHhHHHO..",
        "..OHH......HHO..",
        "..OHH......HHO..",
        "..OHH......HHO..",
        "..OHh......hHO..",
        "..OHh......hHO..",
        "..OHh......hHO..",
        "..OOO......OOO..",
      ])],
      bun: ["пучок", rows(0, [
        "......OOOO......",
        ".....OHHhHO.....",
        ".....OOOOOO.....",
        "....OHHHHHHO....",
        "...OHHHHHHHHO...",
        "...OHHhHHhHHO...",
        "...OH......HO...",
      ])],
      mohawk: ["ирокез", rows(0, [
        "......OOOO......",
        "......OHHO......",
        "......OHHO......",
        "......OHHO......",
        "......OHhO......",
      ])],
    },
    eyes: {
      dots: ["точки", rows(7, [
        ".....E....E.....",
      ])],
      big: ["большие", rows(6, [
        ".....WE..WE.....",
        ".....EE..EE.....",
      ])],
      sleepy: ["сонные", rows(7, [
        ".....EE..EE.....",
      ])],
      happy: ["радостные", rows(6, [
        ".....E....E.....",
        "....E.E..E.E....",
      ])],
      angry: ["сердитые", rows(6, [
        "....EE....EE....",
        ".....EE..EE.....",
      ])],
      wink: ["подмигивает", rows(6, [
        "..........E.....",
        ".....EE...E.....",
      ])],
    },
    mouth: {
      smile: ["улыбка", rows(9, [
        "......M..M......",
        ".......MM.......",
      ])],
      flat: ["прямо", rows(9, [
        "......MMMM......",
      ])],
      open: ["открыт", rows(9, [
        "......MMMM......",
        "......MTTM......",
      ])],
      grin: ["оскал", rows(9, [
        ".....MWWWWM.....",
        "......MMMM......",
      ])],
      frown: ["грусть", rows(9, [
        ".......MM.......",
        "......M..M......",
      ])],
    },
    acc: {
      none: ["нет", []],
      glasses: ["очки", rows(6, [
        "....KKK..KKK....",
        "...K...KK...K...",
        "....KKK..KKK....",
      ])],
      shades: ["тёмные очки", rows(6, [
        "...KKKKKKKKKK...",
        "....KgKKKKgK....",
        ".....KK..KK.....",
      ])],
      headphones: ["наушники", rows(1, [
        ".....KKKKKK.....",
        "....K......K....",
        "...K........K...",
        "...K........K...",
        "..KK........KK..",
        ".KTTK......KTTK.",
        ".KTTK......KTTK.",
        ".KTTK......KTTK.",
        "..KK........KK..",
      ])],
      cap: ["кепка", rows(1, [
        ".....OOOOOO.....",
        "....OCCCCCCO....",
        "...OCCCWWCCCO...",
        "...OCCCCCCCCO...",
        "...OccccccccccO.",
        "...OOOOOOOOOOO..",
      ])],
      beanie: ["шапка", rows(0, [
        "......OWWO......",
        ".....OCCCCO.....",
        "....OCCCCCCO....",
        "...OCCCCCCCCO...",
        "...OCCCCCCCCO...",
        "...OcCcCcCcCO...",
        "...OO......OO...",
      ])],
      crown: ["корона", rows(0, [
        "....Y..YY..Y....",
        "....YY.YY.YY....",
        "....YYYYYYYY....",
        "....YyTyyTyY....",
        "....YYYYYYYY....",
      ])],
    },
  };

  const LAYERS = ["body", "head", "hair", "eyes", "mouth", "acc"];

  // What the builder shows, in order. `shape` options come from PARTS, `color` from COLORS.
  const OPTIONS = [
    {key: "skin", label: "Кожа", type: "color"},
    {key: "hair", label: "Волосы", type: "shape"},
    {key: "hair_color", label: "Цвет волос", type: "color"},
    {key: "eyes", label: "Глаза", type: "shape"},
    {key: "mouth", label: "Рот", type: "shape"},
    {key: "body", label: "Одежда", type: "shape"},
    {key: "cloth", label: "Цвет одежды", type: "color"},
    {key: "acc", label: "Аксессуар", type: "shape"},
    {key: "bg", label: "Фон", type: "color"},
  ];
  // English labels (SidequestI18n.field(x, "label") picks the language).
  const EN = {
    skin: ["Skin", {light: "light", fair: "fair", tan: "tan", brown: "brown", dark: "dark",
                    orc: "green", alien: "blue"}],
    hair: ["Hair", {none: "none", short: "short", spiky: "spiky", long: "long", bun: "bun",
                    mohawk: "mohawk"}],
    hair_color: ["Hair color", {black: "black", brown: "chestnut", blonde: "blonde",
                                ginger: "ginger", gray: "gray", pink: "pink", blue: "blue",
                                green: "green", purple: "purple"}],
    eyes: ["Eyes", {dots: "dots", big: "big", sleepy: "sleepy", happy: "happy", angry: "angry",
                    wink: "wink"}],
    mouth: ["Mouth", {smile: "smile", flat: "flat", open: "open", grin: "grin", frown: "frown"}],
    body: ["Clothes", {tee: "t-shirt", hoodie: "hoodie", jacket: "jacket", armor: "armor"}],
    cloth: ["Clothes color", {red: "red", blue: "blue", green: "green", purple: "purple",
                              yellow: "yellow", gray: "gray", black: "black", white: "white"}],
    acc: ["Accessory", {none: "none", glasses: "glasses", shades: "sunglasses",
                        headphones: "headphones", cap: "cap", beanie: "beanie", crown: "crown"}],
    bg: ["Background", {none: "none", night: "night", sky: "sky", mint: "mint", rose: "rose",
                        sand: "sand", void: "void"}],
  };
  for (const o of OPTIONS) {
    const table = o.type === "shape" ? PARTS[o.key] : COLORS[o.key];
    const en = EN[o.key];
    o.label_en = en[0];
    o.choices = Object.entries(table).map(([id, v]) =>
      o.type === "shape" ? {id, label: v[0], label_en: en[1][id] || id}
        : {id, label: v[0], label_en: en[1][id] || id, color: v[1]});
  }

  const DEFAULT_PARTS = {skin: "light", hair: "none", hair_color: "brown", eyes: "dots",
                         mouth: "smile", body: "hoodie", cloth: "purple", acc: "none",
                         bg: "night"};

  // Builds a 16x16 grid of colors (null = transparent) and packs it.
  function pack(grid, extra) {
    const palette = [];
    let pixels = "";
    for (const color of grid) {
      if (!color) { pixels += "."; continue; }
      let i = palette.indexOf(color);
      if (i < 0) { i = palette.length; palette.push(color); }
      pixels += CHARS[i];
    }
    return Object.assign({size: SIZE, palette, frames: [{pixels, delay: 100}]}, extra);
  }

  // A part's entry by its saved id; an id that is no choice of its own (a "constructor" in a
  // save edited by hand) gets the default.
  const choice = (table, key, id) => (Object.hasOwn(table, id) ? table[id] : table[DEFAULT_PARTS[key]]);

  function partsGrid(parts) {
    const p = Object.assign({}, DEFAULT_PARTS, parts);
    const color = (ch) => {
      if (Object.hasOwn(FIXED, ch)) return FIXED[ch];
      const slot = Object.hasOwn(SLOTS, ch) ? SLOTS[ch] : null;
      if (!slot) return null;
      return choice(COLORS[slot[0]], slot[0], p[slot[0]])[slot[1]];
    };
    const bg = (Object.hasOwn(COLORS.bg, p.bg) ? COLORS.bg[p.bg] : COLORS.bg.none)[1];
    const grid = Array(SIZE * SIZE).fill(bg);
    for (const layer of LAYERS) {
      const sprite = layer === "head" ? HEAD
        : choice(PARTS[layer], layer, p[layer])[1];
      sprite.forEach((line, y) => {
        for (let x = 0; x < SIZE; x++) {
          if (line[x] !== ".") grid[y * SIZE + x] = color(line[x]);
        }
      });
    }
    return grid;
  }

  function compose(parts) {
    const clean = {};
    for (const o of OPTIONS) {
      const table = o.type === "shape" ? PARTS[o.key] : COLORS[o.key];
      clean[o.key] = parts && Object.hasOwn(table, parts[o.key]) ? parts[o.key] : DEFAULT_PARTS[o.key];
    }
    return pack(partsGrid(clean), {source: "builder", parts: clean});
  }

  // Presets: builder combinations, and a few creatures the builder cannot make.
  const PRESETS = [
    {id: "adventurer", name: "Искатель", name_en: "Adventurer", parts: {}},
    {id: "hacker", name: "Хакер", name_en: "Hacker", parts: {body: "hoodie", cloth: "black", acc: "shades",
                                          mouth: "flat", bg: "void"}},
    {id: "reviewer", name: "Ревьюер", name_en: "Reviewer", parts: {skin: "fair", hair: "short", hair_color: "gray",
                                              body: "jacket", cloth: "gray", acc: "glasses",
                                              mouth: "flat", bg: "sand"}},
    {id: "intern", name: "Стажёр", name_en: "Intern", parts: {skin: "tan", hair: "spiky", hair_color: "ginger",
                                           eyes: "big", mouth: "open", body: "tee",
                                           cloth: "yellow", bg: "sky"}},
    {id: "devops", name: "Девопс", name_en: "DevOps", parts: {skin: "brown", hair: "short", hair_color: "black",
                                           body: "tee", cloth: "blue", acc: "headphones",
                                           bg: "mint"}},
    {id: "lead", name: "Тимлид", name_en: "Team lead", parts: {skin: "light", hair: "bun", hair_color: "brown",
                                         body: "jacket", cloth: "blue", acc: "glasses",
                                         bg: "rose"}},
    {id: "merge-king", name: "Король мержей", name_en: "Merge king", parts: {skin: "fair", hair: "long",
                                                      hair_color: "blonde", body: "tee",
                                                      cloth: "purple", acc: "crown",
                                                      eyes: "happy", bg: "night"}},
    {id: "night-owl", name: "Сова", name_en: "Night owl", parts: {skin: "dark", hair: "none", body: "hoodie",
                                            cloth: "green", acc: "beanie", eyes: "sleepy",
                                            mouth: "flat", bg: "void"}},
    {id: "orc", name: "Орк", name_en: "Orc", parts: {skin: "orc", hair: "mohawk", hair_color: "black",
                                     body: "armor", eyes: "angry", mouth: "grin",
                                     bg: "sand"}},
    {id: "alien", name: "Пришелец", name_en: "Alien", parts: {skin: "alien", hair: "none", body: "tee",
                                            cloth: "white", eyes: "big", mouth: "smile",
                                            bg: "void"}},
    {id: "robot", name: "Робот", name_en: "Robot", colors: {".": "#5b8bd0"}, sprite: [
      ".......TT.......",
      ".......KK.......",
      "....OOOOOOOO....",
      "...OggggggggO...",
      "..OOgGGGGGGgOO..",
      "..KgGKKKKKKGgK..",
      "..KgGKLKKLKGgK..",
      "...OGKKKKKKGO...",
      "...OGGGGGGGGO...",
      "...OGGTGTGTGO...",
      "....OOOOOOOO....",
      "......OKKO......",
      "...OOGGGGGGOO...",
      "..OGGgLGGLgGGO..",
      ".OGGGGGGGGGGGGO.",
      ".OGGGGGGGGGGGGO.",
    ]},
    {id: "slime", name: "Слизень", name_en: "Slime", colors: {A: "#6fd08c", a: "#3f9a5a", B: "#26264a"}, sprite: [
      "BBBBBBBBBBBBBBBB",
      "BBBBBBBBBBBBBBBB",
      "BBBBBBBBBBBBBBBB",
      "BBBBBBBBBBBBBBBB",
      "BBBBBBOOOOBBBBBB",
      "BBBBOOAAAAOOBBBB",
      "BBBOAAgAAAAAOBBB",
      "BBOAAgAAAAAAAOBB",
      "BBOAAAAAAAAAAOBB",
      "BOAAAEAAAAEAAAOB",
      "BOAAAEAAAAEAAAOB",
      "BOAAAAAAAAAAAAOB",
      "BOAAAAAMMAAAAAOB",
      "BOaAAAAAAAAAAaOB",
      "BBOaaaaaaaaaaOBB",
      "BBBOOOOOOOOOOBBB",
    ]},
    {id: "ghost", name: "Призрак", name_en: "Ghost", colors: {B: "#0d0d1a"}, sprite: [
      "BBBBBBBBBBBBBBBB",
      "BBBBBOOOOOOBBBBB",
      "BBBBOWWWWWWOBBBB",
      "BBBOWWWWWWWWOBBB",
      "BBOWWWWWWWWWWOBB",
      "BBOWWEEWWEEWWOBB",
      "BBOWWEEWWEEWWOBB",
      "BBOWWWWWWWWWWOBB",
      "BBOWWWWMMWWWWOBB",
      "BBOWWWWMMWWWWOBB",
      "BBOWWWWWWWWWWOBB",
      "BBOWWWWWWWWWWOBB",
      "BBOWWWWWWWWWWOBB",
      "BBOWWOWWWWOWWOBB",
      "BBOWOBOWWOBOWOBB",
      "BBBOBBBOOBBBOBBB",
    ]},
    {id: "cat", name: "Кот", name_en: "Cat", colors: {A: "#e8a050", a: "#c07a30", B: "#7fc8a0"}, sprite: [
      "BBBBBBBBBBBBBBBB",
      "BBBOBBBBBBBBOBBB",
      "BBOAOBBBBBBOAOBB",
      "BBOAPOOOOOOPAOBB",
      "BBOAAAAAAAAAAOBB",
      "BOAAAAAAAAAAAAOB",
      "BOAAEEAAAAEEAAOB",
      "BOAAELAAAAELAAOB",
      "BOAAAAAAAAAAAAOB",
      "BOWAAAAPPAAAAWOB",
      "BOAWAAAMMAAAWAOB",
      "BBOAAAMAAMAAAOBB",
      "BBBOOaaaaaaOOBBB",
      "BBBOAAAAAAAAOBBB",
      "BBOAAWAAAAWAAOBB",
      "BBOAAWAAAAWAAOBB",
    ]},
  ];

  function spriteGrid(preset) {
    const grid = [];
    for (const line of preset.sprite) {
      for (const ch of line) grid.push(preset.colors[ch] || FIXED[ch] || null);
    }
    return grid;
  }

  function preset(id) {
    const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
    if (p.sprite) return pack(spriteGrid(p), {source: "preset", preset: p.id});
    const built = compose(p.parts);
    return Object.assign(built, {source: "preset", preset: p.id});
  }

  const DEFAULT = preset("adventurer");

  // --- drawing -------------------------------------------------------------------

  function resolve(avatar) { return avatar && avatar.frames ? avatar : DEFAULT; }

  // A picture avatar (an upload kept in full color) has `rgba` frames instead of
  // `pixels` and a palette; it is scaled smoothly, not as pixel art.
  const isPicture = (avatar) => !resolve(avatar).palette;

  const decoded = new WeakMap();   // frame -> its rgba bytes, decoded once

  function rgba(avatar, index) {
    const a = resolve(avatar);
    const frame = a.frames[index || 0];
    if (decoded.has(frame)) return decoded.get(frame);
    let out;
    if (frame.rgba) {
      const text = atob(frame.rgba);
      out = new Uint8ClampedArray(text.length);
      for (let k = 0; k < text.length; k++) out[k] = text.charCodeAt(k);
    } else {
      const colors = a.palette.map((hex) => [parseInt(hex.slice(1, 3), 16),
                                             parseInt(hex.slice(3, 5), 16),
                                             parseInt(hex.slice(5, 7), 16)]);
      out = new Uint8ClampedArray(a.size * a.size * 4);
      for (let k = 0; k < frame.pixels.length; k++) {
        const c = colors[CHARS.indexOf(frame.pixels[k])];
        if (!c) continue;
        out[k * 4] = c[0]; out[k * 4 + 1] = c[1]; out[k * 4 + 2] = c[2]; out[k * 4 + 3] = 255;
      }
    }
    decoded.set(frame, out);
    return out;
  }

  // Draws one frame at its real size; scale the canvas with CSS. Pixel avatars get
  // image-rendering: pixelated to stay sharp, pictures are smoothed.
  function draw(canvas, avatar, index) {
    const a = resolve(avatar);
    canvas.width = canvas.height = a.size;
    canvas.style.imageRendering = isPicture(a) ? "auto" : "pixelated";
    const ctx = canvas.getContext("2d");
    ctx.putImageData(new ImageData(rgba(a, index), a.size, a.size), 0, 0);
  }

  // Draws and plays the avatar; returns a function that stops the animation.
  function animate(canvas, avatar) {
    const a = resolve(avatar);
    let index = 0;
    let timer = null;
    const tick = () => {
      draw(canvas, a, index);
      if (a.frames.length < 2) return;
      timer = setTimeout(() => {
        index = (index + 1) % a.frames.length;
        tick();
      }, a.frames[index].delay);
    };
    tick();
    return () => clearTimeout(timer);
  }

  root.SidequestAvatar = {
    CHARS, SIZE, OPTIONS, PRESETS, DEFAULT, DEFAULT_PARTS, COLORS, MAX_COLORS: 32, MAX_FRAMES: 64,
    compose, preset, resolve, isPicture, rgba, draw, animate,
  };
})(typeof window !== "undefined" ? window : globalThis);
