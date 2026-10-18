// The arena: the looks of the maps. A theme gives a color to every pixel of the floor and
// of the walls' tops and faces; decorate() scatters small things over the painted floor.
// render.js paints a map once with them. No DOM here but the canvas it is handed.
"use strict";

(function (root) {
  const SP = root.LCSSprites;
  const DARK = SP.OUTLINE;
  const TAU = Math.PI * 2;

  const THEMES = {
    office: {
      colors: {a: "#262a4c", b: "#24284a", seam: "#212546", speck: "#2c3158", dot: "#1f2344",
               top: "#4a4f80", top2: "#454a78", edge: "#5d63a0", face: "#33375e", base: "#2a2d50",
               frame: "#33375e"},
      floor(x, y, n, C) {
        if ((x & 31) === 0 || (y & 31) === 0) return C.seam;
        if (n < 0.03) return C.dot;
        if (n < 0.07) return C.speck;
        return ((x >> 5) + (y >> 5)) & 1 ? C.a : C.b;
      },
      top: (lx, ly, n, C) => (n < 0.1 ? C.top2 : C.top),
      face: (lx, fy, F, n, C) => (fy >= F - 2 ? C.base : C.face),
    },
    servers: {
      colors: {a: "#1e2433", b: "#1c2230", seam: "#11151f", light: "#2c3446", rivet: "#3c4660",
               hole: "#0f121a", top: "#2a3040", vent: "#20252f", edge: "#3c4458", face: "#161a24",
               faceLine: "#1c2130", frame: "#161a24"},
      floor(x, y, n, C, tile) {
        const lx = x & 31, ly = y & 31;
        if (lx === 0 || ly === 0) return C.seam;
        if (lx === 1 || ly === 1) return C.light;
        if ((lx === 4 || lx === 27) && (ly === 4 || ly === 27)) return C.rivet;
        if (tile < 0.25 && lx > 6 && lx < 26 && ly > 6 && ly < 26 && !(lx & 3) && !(ly & 3)) return C.hole;
        return tile < 0.6 ? C.a : C.b;
      },
      top: (lx, ly, n, C, w) => (ly % 4 === 0 && lx > 3 && lx < w.w - 4 ? C.vent : C.top),
      face: (lx, fy, F, n, C) => (fy % 3 === 0 ? C.faceLine : C.face),
    },
    dungeon: {
      colors: {s0: "#29242f", s1: "#2d2836", s2: "#26222c", s3: "#312b3a", mortar: "#1c1822",
               hi: "#352f3e", lo: "#221e28", crack: "#1f1b25", pit: "#24202b", top: "#4a4256", topLine: "#3c3548", edge: "#5d5470",
               face: "#3a3346", faceLine: "#241f2c", moss: "#3a5a40", frame: "#3a3346"},
      // Flagstones 32x20 in shifted rows, each a little different, some cracked.
      floor(x, y, n, C, tile, hash) {
        const row = Math.floor(y / 20), ox = (row & 1) * 16;
        const col = Math.floor((x + ox) / 32), lx = (x + ox) & 31, ly = y % 20;
        if (lx === 0 || ly === 0) return C.mortar;
        if (ly === 1 || lx === 1) return C.hi;
        if (ly === 19 || lx === 31) return C.lo;
        const k = hash(col, row, 7);
        if (k > 0.8 && Math.abs(lx - 6 - ly * (k - 0.5) * 2) < 0.6) return C.crack;
        if (n < 0.03) return C.pit;
        return k < 0.25 ? C.s0 : k < 0.5 ? C.s1 : k < 0.75 ? C.s2 : C.s3;
      },
      top: (lx, ly, n, C) => (ly % 4 === 0 || (lx + ((ly >> 2) & 1) * 4) % 8 === 0 ? C.topLine : C.top),
      face(lx, fy, F, n, C) {
        if (n < 0.05) return C.moss;
        return fy % 3 === 0 || (lx + (Math.floor(fy / 3) & 1) * 3) % 6 === 0 ? C.faceLine : C.face;
      },
    },
    hazard: {
      colors: {bar: "#30232a", barHi: "#382930", hole: "#241a20", stripe: "#c9a43a",
               black: "#1b1b2f", top: "#e8c14a", top2: "#24242e", edge: "#f0d070", face: "#3a2a2a",
               faceLine: "#2e2024", frame: "#3a2a2a"},
      floor(x, y, n, C, tile, hash, W, H) {
        if (x < 12 || y < 12 || x >= W - 12 || y >= H - 12) {
          return ((x + y) >> 3) & 1 ? C.stripe : C.black;
        }
        const lx = x & 7, ly = y & 7;
        if (lx === 0 || ly === 0) return C.barHi;
        if (lx === 1 || ly === 1) return C.bar;
        return C.hole;
      },
      top: (lx, ly, n, C) => (((lx + ly) >> 2) & 1 ? C.top : C.top2),
      face: (lx, fy, F, n, C) => (fy % 3 === 0 ? C.faceLine : C.face),
    },
    // Production: a tread plate floor; machines with hazard stripes on top.
    factory: {
      colors: {a: "#2b2a2e", b: "#29282c", seam: "#1e1d21", stud: "#3a393f", studLo: "#201f23",
               oil: "#3d3524", top: "#4a4650", top2: "#c9a43a", edge: "#5e5a66", face: "#36333c",
               faceLine: "#2a2830", frame: "#36333c"},
      floor(x, y, n, C) {
        if ((x & 31) === 0 || (y & 31) === 0) return C.seam;
        const sx = (x + ((y >> 3) & 1) * 4) & 7, sy = y & 7;
        if (sx === 2 || sx === 3) {
          if (sy === 3) return C.stud;
          if (sy === 4) return C.studLo;
        }
        if (n < 0.02) return C.oil;
        return ((x >> 5) + (y >> 5)) & 1 ? C.a : C.b;
      },
      top: (lx, ly, n, C) => (ly < 5 && ((lx + ly) >> 2) & 1 ? C.top2 : C.top),
      face: (lx, fy, F, n, C) => (fy % 3 === 0 ? C.faceLine : C.face),
    },
    // Microservices: small teal tiles, racks of little services for walls.
    micro: {
      colors: {a: "#1c2a30", b: "#1f2e35", seam: "#142026", hi: "#26383f", top: "#2e4a52",
               top2: "#355660", edge: "#4a7a84", face: "#20363c", faceLine: "#182a30", frame: "#20363c"},
      floor(x, y, n, C, tile, hash) {
        const lx = x & 15, ly = y & 15;
        if (lx === 0 || ly === 0) return C.seam;
        if (lx === 1 || ly === 1) return C.hi;
        return hash(x >> 4, y >> 4, 11) < 0.5 ? C.a : C.b;
      },
      top: (lx, ly, n, C) => (ly % 3 === 0 ? C.top2 : C.top),
      face: (lx, fy, F, n, C) => (fy % 3 === 0 ? C.faceLine : C.face),
    },
    // CI/CD: concrete slabs with lane paint between the belts.
    pipeline: {
      colors: {a: "#272c2b", b: "#2a2f2e", seam: "#1f2322", speck: "#323837", paint: "#5a5530",
               top: "#48524e", top2: "#3e4744", edge: "#66746e", face: "#333b38", faceLine: "#29302d",
               frame: "#333b38"},
      floor(x, y, n, C) {
        if ((x & 63) === 0 || (y & 63) === 0) return C.seam;
        if ((y & 127) === 96 && (x & 15) < 8) return C.paint;
        if (n < 0.05) return C.speck;
        return ((x >> 6) + (y >> 6)) & 1 ? C.a : C.b;
      },
      top: (lx, ly, n, C) => (lx % 6 === 0 ? C.top2 : C.top),
      face: (lx, fy, F, n, C) => (fy % 3 === 0 ? C.faceLine : C.face),
    },
    // Cloud: a floor of puffs at dusk; the pits are holes in it down to the night sky.
    cloud: {
      colors: {a: "#4a5a7c", b: "#4d5e80", puff: "#5a6c90", puffHi: "#6a7ca0", shade: "#42506e",
               top: "#8a9ac0", top2: "#7a8ab0", edge: "#a8b8d8", face: "#5a6a90", faceLine: "#4a5a80",
               frame: "#3a4868"},
      floor(x, y, n, C, tile, hash) {
        const cx = Math.floor(x / 48), cy = Math.floor(y / 48), k = hash(cx, cy, 5);
        if (k > 0.4) {
          const ox = cx * 48 + 24 + (k - 0.7) * 30, oy = cy * 48 + 24, r = 10 + k * 12;
          const d2 = (x - ox) ** 2 + (y - oy) ** 2;
          if (d2 < r * r) return y < oy - r * 0.4 ? C.puffHi : C.puff;
          if (d2 < (r + 2) ** 2 && y > oy) return C.shade;
        }
        return n < 0.5 ? C.a : C.b;
      },
      top: (lx, ly, n, C) => (n < 0.2 ? C.top2 : C.top),
      face: (lx, fy, F, n, C) => (fy % 3 === 0 ? C.faceLine : C.face),
    },
  };
  // The night office: the office with the lights off.
  THEMES.night = Object.assign({}, THEMES.office, {
    colors: {a: "#171a2e", b: "#16192c", seam: "#121428", speck: "#1d2140", dot: "#101225",
             top: "#2e3256", top2: "#2a2e50", edge: "#3c4270", face: "#22264a", base: "#1c1f3e",
             frame: "#22264a"},
  });

  function hash(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Small things on the floor, never under a wall.
  function decorate(cx, map, owner, seed) {
    const W = map.width, H = map.height;
    let i = 0;
    const rand = () => hash(i++, 3, seed + 99);
    const free = (x, y, w, h) => x > 8 && y > 8 && x + w < W - 8 && y + h < H - 8
      && !owner[y * W + x] && !owner[(y + h) * W + x + w] && !owner[y * W + x + w]
      && !owner[(y + h) * W + x] && !owner[(y + h + 4) * W + x];
    const count = Math.round(W * H / 50000);
    const dot = (x, y, color) => { cx.fillStyle = color; cx.fillRect(x, y, 1, 1); };
    for (let k = 0; k < count; k++) {
      const x = Math.floor(rand() * W), y = Math.floor(rand() * H), r = rand();
      if (map.theme === "office" || map.theme === "night") {
        if (!free(x, y, 8, 8)) continue;
        if (r < 0.5) {  // a sticky note
          const color = ["#e8d36a", "#e86aa8", "#7fc8a0"][Math.floor(rand() * 3)];
          cx.fillStyle = "rgba(6, 6, 16, 0.4)";
          cx.fillRect(x + 1, y + 1, 5, 5);
          cx.fillStyle = color;
          cx.fillRect(x, y, 5, 5);
          cx.fillStyle = SP.shade(color, 0.7);
          cx.fillRect(x + 1, y + 2, 3, 1);
        } else if (r < 0.8) {  // a sheet of paper
          cx.fillStyle = "#bab8c8";
          cx.fillRect(x, y, 6, 8);
          cx.fillStyle = "#8a88a0";
          for (let l = 0; l < 3; l++) cx.fillRect(x + 1, y + 2 + l * 2, 4, 1);
        } else {  // a coffee stain
          for (let a = 0; a < 14; a++) {
            const t = a / 14 * TAU;
            dot(Math.round(x + 4 + Math.cos(t) * 3), Math.round(y + 4 + Math.sin(t) * 3), "#3a2e44");
          }
        }
      } else if (map.theme === "servers" || map.theme === "micro") {
        if (r > 0.35 || !free(x, y, 4, 4)) continue;
        // A cable: a few straight runs with turns.
        const color = ["#3f6fc8", "#c8443c", "#b8902a"][Math.floor(rand() * 3)];
        let cx0 = x, cy0 = y;
        for (let seg = 0; seg < 4; seg++) {
          const len = 20 + Math.floor(rand() * 80), horizontal = seg % 2 === 0;
          const dir = rand() < 0.5 ? -1 : 1;
          for (let s = 0; s < len; s++) {
            const nx = cx0 + (horizontal ? dir : 0), ny = cy0 + (horizontal ? 0 : dir);
            if (nx < 8 || ny < 8 || nx >= W - 8 || ny >= H - 8 || owner[ny * W + nx]) break;
            cx0 = nx;
            cy0 = ny;
            dot(cx0, cy0 + 1, "#0f121a");
            dot(cx0, cy0, color);
          }
        }
      } else if (map.theme === "dungeon") {
        if (!free(x, y, 6, 6)) continue;
        const color = r < 0.6 ? "#33503a" : "#22263a";  // moss or a puddle
        for (let a = 0; a < 18; a++) {
          const dx = Math.round((rand() - 0.5) * 8), dy = Math.round((rand() - 0.5) * 5);
          dot(x + 3 + dx, y + 3 + dy, color);
        }
        if (r > 0.9) {  // a little skull
          cx.fillStyle = "#c8c8d4";
          cx.fillRect(x, y, 4, 3);
          cx.fillRect(x + 1, y + 3, 2, 1);
          dot(x + 1, y + 1, DARK);
          dot(x + 2, y + 1, DARK);
        }
      } else if (map.theme === "hazard" || map.theme === "factory") {
        if (r > 0.25 || !free(x, y, 10, 10)) continue;
        // An oil stain.
        for (let a = 0; a < 26; a++) {
          const dx = Math.round((rand() - 0.5) * 10), dy = Math.round((rand() - 0.5) * 6);
          dot(x + 5 + dx, y + 5 + dy, "#120c10");
        }
      }
    }
  }

  root.LCSThemes = {THEMES, hash, decorate};
})(typeof window !== "undefined" ? window : globalThis);
