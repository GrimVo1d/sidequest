// Last Commit Standing: the maps. Walls are rectangles [x, y, width, height]; the player
// starts in the middle, so no wall may cover it, and every open area must stay reachable.
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

  const MAPS = [
    {id: "open", name: "Open space", text: "Пустая арена: бегай где хочешь",
     width: 1600, height: 1200, walls: []},
    {id: "monorepo", name: "Монорепо", text: "Колонны: за ними можно спрятаться",
     width: 1600, height: 1200, walls: pillars(1600, 1200, 200, 40, 120)},
    {id: "legacy", name: "Легаси", text: "Комнаты и двери: не дай зажать себя в углу",
     width: 1600, height: 1200, walls: [
       [520, 0, 24, 460], [520, 740, 24, 460],
       [1056, 160, 24, 420], [1056, 820, 24, 380],
       [690, 300, 220, 24], [690, 880, 220, 24],
       [160, 300, 200, 24], [160, 880, 200, 24],
       [1240, 600, 200, 24],
     ]},
    {id: "hotfix", name: "Хотфикс", text: "Маленькая арена: врагам негде потеряться",
     width: 960, height: 720, walls: [[300, 120, 24, 120], [636, 480, 24, 120]]},
  ];

  root.LCS_MAPS = MAPS;
})(typeof window !== "undefined" ? window : globalThis);
