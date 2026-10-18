// The arena: the maps. Walls are rectangles [x, y, width, height]; the player
// starts in the middle, so no wall may cover it, and every open area must stay reachable,
// with every door closed too. The theme picks how themes.js paints the floor and the walls;
// `special` is the map's own enemy (balance.json, enemies). The map's objects (terrain.js):
//   doors [x, y, w, h, offset s]   cracks [x, y, w, h]   racks [x, y] (the middle)
//   belts [x, y, w, h, "r"|"l"|"u"|"d"]   pits [x, y, w, h]   pads [x1, y1, x2, y2] (a pair)
//   vents [x, y, w, h, group]   dark: true
"use strict";

(function (root) {
  // A grid of square pillars, leaving the middle free.
  function pillars(width, height, step, size, keepClear) {
    const walls = [];
    for (let y = step; y < height; y += step) {
      for (let x = step; x < width; x += step) {
        if (Math.hypot(x - width / 2, y - height / 2) < keepClear) continue;
        walls.push([x - size / 2, y - size / 2, size, size]);
      }
    }
    return walls;
  }

  // A grid of small rooms: walls between them with a gap in the middle of each side. The
  // gaps in `doors` (["h" | "v", column, row]) get a door that closes now and then.
  function rooms(width, height, cols, rows, gap, thick, doorAt) {
    const cw = width / cols, rh = height / rows, walls = [], doors = [];
    const t = thick / 2;
    for (let c = 1; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = c * cw - t, y0 = r * rh, mid = y0 + rh / 2;
        walls.push([x, y0, thick, mid - gap / 2 - y0], [x, mid + gap / 2, thick, y0 + rh - mid - gap / 2]);
        const k = doorAt.findIndex(([d, dc, dr]) => d === "v" && dc === c && dr === r);
        if (k >= 0) doors.push([x, mid - gap / 2, thick, gap, k * 2]);
      }
    }
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const y = r * rh - t, x0 = c * cw, mid = x0 + cw / 2;
        walls.push([x0, y, mid - gap / 2 - x0, thick], [mid + gap / 2, y, x0 + cw - mid - gap / 2, thick]);
        const k = doorAt.findIndex(([d, dc, dr]) => d === "h" && dc === c && dr === r);
        if (k >= 0) doors.push([mid - gap / 2, y, gap, thick, k * 2]);
      }
    }
    return {walls, doors};
  }

  // Microservices: 5 by 3 rooms; the doors close between the columns in the top and the
  // bottom rows, the middle row and every passage up and down always stay open.
  const MICRO = rooms(1600, 1200, 5, 3, 64, 20, [
    ["v", 1, 0], ["v", 2, 0], ["v", 3, 0], ["v", 4, 0], ["v", 1, 2], ["v", 2, 2], ["v", 3, 2], ["v", 4, 2]]);

  const MAPS = [
    {id: "open", name: "Open space", theme: "office", special: "race",
     text: "Пустая арена: бегай где хочешь", text_en: "An empty arena: run anywhere",
     width: 1600, height: 1200, walls: []},
    {id: "monorepo", name: "Монорепо", name_en: "Monorepo", theme: "servers", special: "leak",
     text: "Колонны и серверные стойки: стойка взрывается от выстрелов",
     text_en: "Pillars and server racks that blow up when shot",
     width: 1600, height: 1200, walls: pillars(1600, 1200, 200, 40, 120),
     racks: [[300, 300], [1300, 300], [300, 900], [1300, 900], [500, 700], [1100, 500]]},
    {id: "legacy", name: "Легаси", name_en: "Legacy", theme: "dungeon", special: "deprecated",
     text: "Комнаты и двери; треснувшие стены можно пробить",
     text_en: "Rooms and doors; cracked walls can be shot through",
     width: 1600, height: 1200, walls: [
       [520, 0, 24, 460], [520, 740, 24, 460],
       [1056, 160, 24, 420], [1056, 820, 24, 380],
       [160, 300, 200, 24], [160, 880, 200, 24],
       [1240, 600, 200, 24],
     ],
     cracks: [[690, 300, 220, 24], [690, 880, 220, 24]],
     doors: [[520, 460, 24, 100, 0], [1056, 720, 24, 100, 8]]},
    {id: "hotfix", name: "Хотфикс", name_en: "Hotfix", theme: "hazard", special: "nullptr",
     text: "Маленькая арена: врагам негде потеряться",
     text_en: "A small arena: enemies have nowhere to get lost",
     width: 960, height: 720, walls: [[300, 120, 24, 120], [636, 480, 24, 120]]},
    {id: "prod", name: "Прод", name_en: "Production", theme: "factory", special: "regression",
     text: "Огонь из решёток в полу: решётки горят по очереди",
     text_en: "Fire from the vents in the floor: they burn in turn",
     width: 1600, height: 1200,
     walls: [[300, 250, 120, 60], [1180, 250, 120, 60], [300, 890, 120, 60], [1180, 890, 120, 60],
             [740, 140, 120, 40], [740, 1020, 120, 40]],
     vents: [[200, 450, 400, 32, 0], [1000, 700, 400, 32, 0], [1000, 450, 400, 32, 1], [200, 700, 400, 32, 1],
             [650, 820, 32, 260, 2], [918, 120, 32, 260, 2], [650, 120, 32, 260, 3], [918, 820, 32, 260, 3]],
     racks: [[520, 600], [1080, 600], [150, 150], [1450, 150], [150, 1050], [1450, 1050]]},
    {id: "micro", name: "Микросервисы", name_en: "Microservices", theme: "micro", special: "micro",
     text: "Много комнат, двери закрываются; телепорты связывают дальние",
     text_en: "Many rooms, doors that close; teleports link the far ones",
     width: 1600, height: 1200, walls: MICRO.walls, doors: MICRO.doors,
     pads: [[160, 140, 1440, 1060], [1440, 140, 160, 1060], [800, 120, 800, 1080]]},
    {id: "cicd", name: "CI/CD", name_en: "CI/CD", theme: "pipeline", special: "flaky",
     text: "Конвейеры несут всех — и тебя, и врагов",
     text_en: "Belts carry everyone, you and the enemies",
     width: 1600, height: 1200,
     walls: [[300, 560, 60, 80], [1240, 560, 60, 80], [100, 300, 80, 40], [1420, 860, 80, 40]],
     belts: [[100, 160, 1400, 56, "r"], [100, 420, 1400, 56, "l"], [100, 724, 1400, 56, "r"],
             [100, 984, 1400, 56, "l"]]},
    {id: "cloud", name: "Облако", name_en: "Cloud", theme: "cloud", special: "scope",
     text: "Дыры в облаке: сталкивай в них врагов взрывами",
     text_en: "Holes in the cloud: blast the enemies into them",
     width: 1600, height: 1200, walls: [],
     pits: [[260, 220, 220, 160], [1120, 220, 220, 160], [260, 820, 220, 160], [1120, 820, 220, 160],
            [700, 40, 200, 120], [700, 1040, 200, 120], [40, 520, 140, 160], [1420, 520, 140, 160],
            [600, 560, 80, 80], [920, 560, 80, 80]]},
    {id: "night", name: "Ночной офис", name_en: "Night office", theme: "night", special: "offbyone", dark: true,
     text: "Темно: видно только рядом с тобой и агентами",
     text_en: "Dark: you see only around you and the agents",
     width: 1600, height: 1200, walls: [
       [200, 200, 160, 16], [200, 200, 16, 120], [560, 200, 160, 16], [560, 200, 16, 120],
       [920, 200, 160, 16], [920, 200, 16, 120], [1280, 200, 160, 16], [1280, 200, 16, 120],
       [200, 840, 160, 16], [200, 840, 16, 120], [560, 840, 160, 16], [560, 840, 16, 120],
       [920, 840, 160, 16], [920, 840, 16, 120], [1280, 840, 160, 16], [1280, 840, 16, 120],
       [200, 520, 160, 16], [1240, 520, 160, 16],
     ]},
  ];

  root.LCS_MAPS = MAPS;
})(typeof window !== "undefined" ? window : globalThis);
