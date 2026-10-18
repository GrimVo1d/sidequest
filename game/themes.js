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
  };

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
      if (map.theme === "office") {
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
      } else if (map.theme === "servers") {
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
      } else if (map.theme === "hazard") {
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
