// Last Commit Standing: drawing the arena. Sprites come from sprites.js, text is in the
// pixel font from font.js. The canvas is small (balance.view) and scaled up in whole device
// pixels, so pixels stay sharp. Everything here is looks only: particles, splats and screen
// shake use Math.random and never touch the simulation.
"use strict";

(function (root) {
  const SP = root.LCSSprites, FONT = root.LCSFont;
  const DARK = SP.OUTLINE;
  const TAU = Math.PI * 2;

  // Debris colors of each enemy: body, shade, highlight.
  const GORE = {
    grunt: ["#c8443c", "#9a3029", "#e87a6a"], runner: ["#e89a4a", "#b86a2a", "#f0c080"],
    tank: ["#8a5bd0", "#6a40a8", "#8a8aa0"], boss: ["#c8443c", "#4a7ae8", "#e8c14a"],
    leak: ["#5fbf5a", "#3f8f3c", "#a8e89a"], leak_small: ["#5fbf5a", "#3f8f3c", "#a8e89a"],
    race: ["#4ac0c8", "#2e8a92", "#c8c8d4"], nullptr: ["#d07ad0", "#9a4a9a", "#7fe0e0"],
    deprecated: ["#b8b4cc", "#8a86a0", "#e8e6f0"],
    flaky: ["#4fbf6f", "#d9534f", "#e8e6f0"], spaghetti: ["#e8c14a", "#b8902a", "#c8443c"],
    offbyone: ["#4ac0a0", "#2e8a72", "#fffbe0"], debt: ["#8a7a5a", "#6a5a40", "#e8c14a"],
    logspam: ["#8a8aa0", "#1b1b2f", "#4fbf6f"], regression: ["#c84a8a", "#963066", "#fffbe0"],
    scope: ["#e87aa8", "#b84a7a", "#fff0f6"], monolith: ["#6a6a82", "#4a4a62", "#5bd0e8"],
    micro: ["#4ac0c8", "#2e8a92", "#e8e6f0"], boss_oom: ["#7fbf3a", "#5a8f2a", "#c8e87a"],
    boss_loop: ["#5b6ad0", "#3a48a0", "#e8c14a"], loop_segment: ["#5b6ad0", "#3a48a0", "#e8c14a"],
    boss_race: ["#4ac0c8", "#e89a4a", "#c8c8d4"], boss_fire: ["#5a5a72", "#e85a2a", "#ffe066"],
  };
  // Enemies with a health bar over them: the tough ones, and every elite.
  const BAR_TYPES = new Set(["tank", "monolith", "debt", "scope"]);
  const ITEM_COLORS = {medkit: "#d9534f", coffee: "#e89a4a", duck: "#e8c14a", shield: "#5b8bd0",
                       chest: "#e8c14a"};
  const tr = (ru, en) => root.SidequestI18n ? root.SidequestI18n.t(ru, en) : ru;
  const AMMO_MARKS = 10;   // the most rounds shown as marks under the player
  const BOSS_NAME = ["Конфликт слияния", "Merge conflict"];
  const FINAL_NAME = ["Финальный конфликт", "Final conflict"];

  // --- map themes: a color for every floor and wall pixel ------------------------------

  const hex = (c) => SP.rgb(c);
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

  const faceHeight = (w) => Math.min(8, Math.floor(w.h / 2));

  // `hud`: the page's top row of the HUD; the boss bar goes under it.
  function createRenderer(canvas, balance, hud) {
    // The view is at least balance.view and fills the whole window: the scale goes in whole
    // steps of device pixels (1, 1.5, 2, ... on a Retina screen) so pixels stay sharp, and
    // the view grows to cover what is left, up to balance.view.max_*.
    const V = balance.view;
    let VW = V.width, VH = V.height;
    const ctx = canvas.getContext("2d");

    function fit() {
      const dpr = devicePixelRatio || 1;
      const scale = Math.max(1, Math.floor(Math.min(innerWidth / V.width, innerHeight / V.height) * dpr)) / dpr;
      const w = Math.min(V.max_width || V.width, Math.ceil(innerWidth / scale));
      const h = Math.min(V.max_height || V.height, Math.ceil(innerHeight / scale));
      if (w !== canvas.width || h !== canvas.height) {
        VW = canvas.width = w;
        VH = canvas.height = h;
      }
      ctx.imageSmoothingEnabled = false;
      canvas.style.width = VW * scale + "px";
      canvas.style.height = VH * scale + "px";
    }
    addEventListener("resize", fit);
    fit();

    const px = (v) => Math.round(v);
    const newCanvas = (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    };

    // --- sprites, shadows and text, each made once ------------------------------------

    const sprites = new Map();
    // options: frame, face, tint (an ally's color), fill, outline, flip
    function sprite(name, o) {
      const key = `${name}|${o.frame || 0}|${o.face || ""}|${o.tint || ""}|${o.fill || ""}|`
        + `${o.outline === undefined ? "" : o.outline}|${o.flip ? 1 : 0}`;
      let c = sprites.get(key);
      if (c) return c;
      const colors = o.tint ? {A: o.tint, a: SP.shade(o.tint, 0.72)} : null;
      const img = SP.decode(name, {frame: o.frame, face: o.face, colors, fill: o.fill,
                                   outline: o.outline});
      c = newCanvas(img.width, img.height);
      const cx = c.getContext("2d");
      const data = cx.createImageData(img.width, img.height);
      data.data.set(img.data);
      cx.putImageData(data, 0, 0);
      if (o.flip) {
        const f = newCanvas(img.width, img.height), fx = f.getContext("2d");
        fx.scale(-1, 1);
        fx.drawImage(c, -img.width, 0);
        c = f;
      }
      sprites.set(key, c);
      return c;
    }

    const shadows = new Map();
    function shadow(x, y, w) {
      w = Math.max(4, Math.round(w));
      let c = shadows.get(w);
      if (!c) {
        const h = Math.max(2, Math.round(w / 3));
        c = newCanvas(w, h);
        const cx = c.getContext("2d");
        cx.fillStyle = "rgba(6, 6, 16, 0.4)";
        for (let row = 0; row < h; row++) {
          const k = (row + 0.5) / h * 2 - 1, half = Math.round(w / 2 * Math.sqrt(1 - k * k));
          cx.fillRect(Math.round(w / 2) - half, row, half * 2, 1);
        }
        shadows.set(w, c);
      }
      ctx.drawImage(c, px(x) - (c.width >> 1), px(y) - (c.height >> 1));
    }

    const texts = new Map();
    function textCanvas(value, color) {
      const key = color + "|" + value;
      let c = texts.get(key);
      if (c) return c;
      if (texts.size > 300) texts.clear();
      const t = FONT.layout(value);
      c = newCanvas(t.width + 2, t.height + 2);
      const cx = c.getContext("2d");
      cx.fillStyle = DARK;
      for (const [x, y] of t.pixels) cx.fillRect(x, y, 3, 3);
      cx.fillStyle = color;
      for (const [x, y] of t.pixels) cx.fillRect(x + 1, y + 1, 1, 1);
      texts.set(key, c);
      return c;
    }
    function label(x, y, value, color, alpha) {
      const c = textCanvas(value, color);
      ctx.globalAlpha = alpha === undefined ? 1 : Math.max(0, alpha);
      ctx.drawImage(c, px(x) - (c.width >> 1), px(y) - (c.height >> 1));
      ctx.globalAlpha = 1;
    }

    // A ring of single pixels: crisper than a stroked arc.
    function pixelRing(x, y, r, color, alpha, size) {
      if (r < 1 || alpha <= 0) return;
      const n = Math.max(8, Math.ceil(r * TAU / (size || 1)));
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        ctx.fillRect(px(x + Math.cos(a) * r), px(y + Math.sin(a) * r), size || 1, size || 1);
      }
      ctx.globalAlpha = 1;
    }

    // --- the map: floor, walls and their shadows, painted once per map ------------------

    let floor = null, floorId = null;
    function paintMap(map) {
      const W = map.width, H = map.height, th = THEMES[map.theme] || THEMES.office;
      const C = {};
      for (const [k, v] of Object.entries(th.colors)) C[k] = hex(v);
      const DK = hex(DARK);
      const seed = [...map.id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) | 0;
      const walls = map.walls;
      const owner = new Int16Array(W * H);
      walls.forEach((w, i) => {
        for (let y = Math.max(0, w.y); y < Math.min(H, w.y + w.h); y++) {
          owner.fill(i + 1, y * W + Math.max(0, w.x), y * W + Math.min(W, w.x + w.w));
        }
      });
      const c = newCanvas(W, H), cx = c.getContext("2d");
      const img = cx.createImageData(W, H), d = img.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = y * W + x, n = hash(x, y, seed);
          let col, dim = false;
          const wi = owner[p];
          if (wi) {
            const w = walls[wi - 1], lx = x - w.x, ly = y - w.y, F = faceHeight(w);
            if (lx === 0 || ly === 0 || lx === w.w - 1 || ly === w.h - 1) col = DK;
            else if (ly === w.h - 1 - F) col = DK;
            else if (ly > w.h - 1 - F) col = th.face(lx, ly - (w.h - F), F, n, C);
            else if (ly === 1 || lx === 1) col = C.edge;
            else col = th.top(lx, ly, n, C, w);
          } else if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) {
            col = C.frame;
          } else if (x === 3 || y === 3 || x === W - 4 || y === H - 4) {
            col = DK;
          } else {
            col = th.floor(x, y, n, C, hash(x >> 5, y >> 5, seed + 1), hash, W, H);
            // Walls cast a shadow down and to the right.
            const sx = x - 3, sy = y - 4;
            dim = sx >= 0 && sy >= 0 && owner[sy * W + sx] > 0;
          }
          const k = dim ? 0.6 : 1;
          d[p * 4] = col[0] * k;
          d[p * 4 + 1] = col[1] * k;
          d[p * 4 + 2] = col[2] * k;
          d[p * 4 + 3] = 255;
        }
      }
      cx.putImageData(img, 0, 0);
      decorate(cx, map, owner, seed);
      return c;
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

    // Moving details on walls: server lights, torches, alarm lamps.
    function wallDetails(s, camX, camY) {
      const theme = s.map.theme, t = s.time;
      for (const [i, w] of s.map.walls.entries()) {
        if (w.x > camX + VW + 20 || w.y > camY + VH + 20 || w.x + w.w < camX - 20 || w.y + w.h < camY - 20) {
          continue;
        }
        const F = faceHeight(w), faceY = w.y + w.h - F;
        if (theme === "servers") {
          for (let lx = 3; lx < w.w - 3; lx += 4) {
            for (const fy of [2, 5]) {
              if (fy >= F - 1) continue;
              const k = hash(i * 64 + lx, fy, Math.floor(t * 2 + hash(i, lx, fy) * 7));
              ctx.fillStyle = k < 0.55 ? "#4fbf6f" : k < 0.7 ? "#e8c14a" : k < 0.8 ? "#5b8bd0" : "#0d0f15";
              ctx.fillRect(w.x + lx, faceY + fy, 2, 1);
            }
          }
        } else if (theme === "dungeon") {
          const n = Math.max(1, Math.floor(w.w / 100));
          for (let k = 0; k < n; k++) torch(w.x + (k + 0.5) * w.w / n, faceY + 1, t, i * 7 + k);
        } else if (theme === "hazard") {
          const on = Math.floor(t * 2 + i) % 2 === 0;
          for (const lx of [3, w.w - 5]) {
            ctx.fillStyle = on ? "#ff4040" : "#5a1a1a";
            ctx.fillRect(w.x + lx, w.y + 3, 2, 2);
            if (on) pixelRing(w.x + lx + 1, w.y + 4, 4, "#ff4040", 0.25);
          }
        }
      }
    }

    const FLAMES = ["#fffbe0", "#e8c14a", "#e89a4a", "#d9534f"];
    function torch(x, y, t, seed) {
      x = px(x);
      ctx.fillStyle = "#5a4a3a";
      ctx.fillRect(x - 1, y + 2, 2, 4);
      const flicker = hash(seed, 0, Math.floor(t * 10));
      const h = 3 + Math.floor(flicker * 3);
      for (let row = 0; row < h; row++) {
        const wdt = row < 1 ? 1 : row < h - 1 ? 3 : 2;
        ctx.fillStyle = FLAMES[Math.min(3, Math.floor(row / h * 4))];
        ctx.fillRect(x - Math.floor(wdt / 2) + (row === 0 && flicker > 0.5 ? 1 : 0), y + 1 - row, wdt, 1);
      }
      pixelRing(x, y, 10 + flicker * 2, "#e89a4a", 0.12, 2);
      pixelRing(x, y, 6 + flicker, "#e8c14a", 0.15, 2);
    }

    // --- particles and floor splats ---------------------------------------------------

    let particles = [], splats = [];
    const MAX_PARTICLES = 700, MAX_SPLATS = 140;

    function particle(x, y, vx, vy, color, life, o) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      particles.push(Object.assign({x, y, vx, vy, color, life, t: 0, z: 0, vz: 0, gravity: 0,
                                    drag: 3, size: 1}, o));
    }

    function burst(x, y, n, colors, speed, o) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, v = speed * (0.4 + Math.random() * 0.6);
        particle(x, y, Math.cos(a) * v, Math.sin(a) * v * 0.7, colors[i % colors.length],
                 0.4 + Math.random() * 0.4, o);
      }
    }

    function splat(x, y, r, color) {
      if (splats.length >= MAX_SPLATS) splats.shift();
      const dots = [];
      for (let i = 0; i < r * 3; i++) {
        const a = Math.random() * TAU, d = Math.random() * (r + 1);
        dots.push([Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d * 0.6)]);
      }
      splats.push({x: px(x), y: px(y + r * 0.5), color, dots, t: 0, life: 20});
    }

    function updateParticles(dt) {
      for (const p of particles) {
        p.t += dt;
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.gravity) {
          p.vz -= p.gravity * dt;
          p.z += p.vz * dt;
          if (p.z < 0) { p.z = 0; p.vz *= -0.35; p.vx *= 0.5; p.vy *= 0.5; }
        }
      }
      particles = particles.filter((p) => p.t < p.life);
      for (const sp of splats) sp.t += dt;
      splats = splats.filter((sp) => sp.t < sp.life);
    }

    function drawParticles() {
      for (const p of particles) {
        const k = p.t / p.life;
        ctx.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
        ctx.fillStyle = p.color;
        ctx.fillRect(px(p.x), px(p.y - p.z), p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }

    function drawSplats() {
      for (const sp of splats) {
        ctx.globalAlpha = sp.t > sp.life - 5 ? (sp.life - sp.t) / 5 : 1;
        ctx.fillStyle = sp.color;
        for (const [dx, dy] of sp.dots) ctx.fillRect(sp.x + dx, sp.y + dy, 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // --- reacting to what happened since the last frame ---------------------------------

    let last = null;       // the state drawn last time; a new one means a new match
    let lastTime = 0, lastLevel = 1, lastDead = 0, lastHurt = -1;
    let shake = 0, flash = 0, hurtFlash = 0, levelGlow = 0;
    let seen = new WeakSet();
    let flashes = new WeakMap(), prevPos = new WeakMap();

    function reset(s) {
      last = s;
      lastTime = s.time;
      lastLevel = s.level;
      lastDead = 0;
      lastHurt = -1;
      particles = [];
      splats = [];
      shake = flash = hurtFlash = levelGlow = 0;
      seen = new WeakSet();
      flashes = new WeakMap();
      prevPos = new WeakMap();
    }

    function react(s, dt) {
      const p = s.player;
      for (const fx of s.effects) {
        if (seen.has(fx)) continue;
        seen.add(fx);
        if (fx.type === "pop") {
          const colors = GORE[fx.kind] || ["#e8e6f0"];
          burst(fx.x, fx.y, 6 + fx.r, colors, 40 + fx.r * 4,
                {gravity: 220, vz: 40 + Math.random() * 40, drag: 2, size: fx.boss ? 2 : 1});
          splat(fx.x, fx.y, fx.r, SP.shade(colors[0], 0.38));
          if (fx.boss) { shake = Math.max(shake, 5); flash = 0.3; }
        } else if (fx.type === "ring") {
          burst(fx.x, fx.y, Math.min(24, 6 + fx.r / 4), [fx.color, "#fffbe0"], fx.r * 3, {drag: 5});
          if (fx.r > 60) shake = Math.max(shake, 1.5);
        } else if (fx.type === "ult") {
          flash = 0.6;
          shake = Math.max(shake, 4);
        } else if (fx.type === "pickup") {
          burst(fx.x, fx.y, 12, [ITEM_COLORS[fx.item] || "#fffbe0", "#fffbe0"], 70, {drag: 4});
        }
      }
      for (const a of s.allies) {
        if (seen.has(a)) continue;
        seen.add(a);
        for (let i = 0; i < 14; i++) {
          particle(a.x + (Math.random() - 0.5) * 8, a.y + 4, 0, -30 - Math.random() * 50, i % 2 ? a.color : "#fffbe0",
                   0.5 + Math.random() * 0.4, {drag: 1});
        }
      }
      for (const e of s.enemies) {
        const before = flashes.get(e) || 0;
        if (e.flash > before + 0.001) {
          burst(e.x, e.y, 2, ["#fffbe0", (GORE[e.type] || GORE.grunt)[0]], 50, {drag: 6});
        }
        flashes.set(e, e.flash);
        // Elites: a fast one kicks up dust, a vampire drips.
        if (e.elite === "fast" && Math.random() < dt * 12) {
          particle(e.x, e.y + e.r, (Math.random() - 0.5) * 10, -6, "#e8c14a", 0.3, {drag: 4});
        } else if (e.elite === "vampire" && Math.random() < dt * 4) {
          particle(e.x + (Math.random() - 0.5) * e.r, e.y, 0, 10, "#d9534f", 0.5, {gravity: 60});
        }
      }
      if (s.level > lastLevel) {
        levelGlow = 1;
        burst(p.x, p.y, 24, ["#e8c14a", "#fffbe0", "#f0d070"], 90, {drag: 3});
      }
      lastLevel = s.level;
      if (p.dead > 0 && !lastDead) {
        burst(p.x, p.y, 20, ["#d9534f", "#e8e6f0", "#9a3029"], 80, {gravity: 200, vz: 60, drag: 2});
        shake = Math.max(shake, 4);
      }
      lastDead = p.dead;
      if (p.hurtAt !== lastHurt && p.hurtAt > 0 && lastHurt !== -1) {
        hurtFlash = p.shield > 0 || s.immortal ? 0 : 0.25;
        shake = Math.max(shake, p.shield > 0 ? 1 : 2.5);
      }
      lastHurt = p.hurtAt;
      // Walking dust and smoke trails.
      if (!p.dead && p.moving && Math.random() < dt * 14) {
        particle(p.x + (Math.random() - 0.5) * 6, p.y + 7, (Math.random() - 0.5) * 10, -6,
                 "#8a88a0", 0.35, {drag: 4});
      }
      for (const sh of s.shots) {
        if (sh.target !== undefined && Math.random() < 0.7) {
          particle(sh.x, sh.y, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8,
                   Math.random() < 0.5 ? "#6a6a80" : "#8a8aa0", 0.35, {drag: 2});
        }
      }
      for (const a of s.allies) {
        if (a.state === "leaving" && Math.random() < 0.8) {
          particle(a.x + (Math.random() - 0.5) * 4, a.y + 7, (Math.random() - 0.5) * 10, 30 + Math.random() * 20,
                   Math.random() < 0.5 ? "#e89a4a" : "#e8c14a", 0.3, {drag: 2});
        }
      }
      if (s.buffs && s.buffs.coffee > 0 && !p.dead && Math.random() < dt * 6) {
        particle(p.x + 4, p.y - 8, (Math.random() - 0.5) * 6, -18, "#e8e6f0", 0.6, {drag: 1});
      }
      shake = Math.max(0, shake - dt * 12);
      flash = Math.max(0, flash - dt * 1.5);
      hurtFlash = Math.max(0, hurtFlash - dt);
      levelGlow = Math.max(0, levelGlow - dt * 1.5);
    }

    // --- actors --------------------------------------------------------------------

    function drawEnemy(e, s) {
      const age = s.time - (e.born === undefined ? -1 : e.born);
      let frame = Math.floor(s.time * (e.slow > 0 ? 3 : 7) + (e.born || 0) * 13) & 1;
      // Off-by-one crouches before it jumps.
      if (e.type === "offbyone") frame = e.windupAt ? 1 : 0;
      const o = {frame};
      if (e.flash > 0) o.fill = "#ffffff";
      else if (e.elite) o.outline = Math.floor(s.time * 4) & 1 ? "#e8c14a" : "#fff0a0";
      else if (s.rage > 0) o.outline = "#ff3030";
      else if (e.slow > 0) o.outline = "#7fb3e0";
      else if (e.final) o.outline = Math.floor(s.time * 4) & 1 ? "#e8c14a" : "#b8902a";
      else if (e.returned) o.outline = "#d9534f";
      if (e.type === "boss_race" && e.twinB) o.tint = "#e89a4a";
      const c = sprite(e.type, o);
      // Scope creep and out of memory grow in whole steps.
      const k = e.size || 1, cw = c.width * k, ch = c.height * k;
      let x = px(e.x) - (cw >> 1), y = e.y - ch / 2 - 2;
      // Null pointer glitches: now and then it slips a pixel or two sideways.
      if (e.type === "nullptr" && hash(Math.floor(s.time * 10), e.born * 100, 3) < 0.15) x += 2;
      if (e.windupAt) x += Math.floor(s.time * 30) & 1 ? 1 : -1;
      if (e.ghost) ctx.globalAlpha = 0.55 + Math.sin(s.time * 5 + e.born) * 0.15;
      if (age < 0.35) {
        // Crawling out of the floor.
        const k = age / 0.35;
        shadow(e.x, e.y + e.r, e.r * 3);
        ctx.globalAlpha = k;
        y += (1 - k) * 6;
      }
      if (k === 1) ctx.drawImage(c, px(x), px(y));
      else ctx.drawImage(c, px(x), px(y), cw, ch);
      ctx.globalAlpha = 1;
      // A twin left alone: it is about to bring the other one back.
      if (e.revive && Math.floor(s.time * 8) & 1) label(e.x, y - 5, "!", "#7fe0e0");
      if (e.windupAt) label(e.x, y - 5, "!", "#4ac0a0");
      if (e.shield > 0) pixelRing(e.x, e.y, e.r + 4, "#5b8bd0", 0.4 + 0.6 * e.shield / e.shieldMax, 1);
      if (e.elite) {
        const crown = sprite("elite", {});
        ctx.drawImage(crown, px(e.x) - (crown.width >> 1), px(y - crown.height - (e.hp < e.maxHp ? 4 : 1)));
      }
      if ((BAR_TYPES.has(e.type) || e.elite) && e.hp < e.maxHp) {
        const w = Math.max(14, Math.min(30, Math.round(cw * 0.8))), x0 = px(e.x) - (w >> 1), y0 = px(y - 3);
        ctx.fillStyle = DARK;
        ctx.fillRect(x0 - 1, y0 - 1, w + 2, 4);
        ctx.fillStyle = "#d9534f";
        ctx.fillRect(x0, y0, Math.max(0, Math.round(w * e.hp / e.maxHp)), 2);
      }
    }

    function moved(o) {
      const prev = prevPos.get(o);
      prevPos.set(o, {x: o.x, y: o.y});
      return prev ? Math.hypot(o.x - prev.x, o.y - prev.y) > 0.2 : false;
    }

    const SPIRIT_SPRITES = {scout: "spirit_scout", plan: "spirit_plan"};

    function drawAlly(a, s) {
      const walking = moved(a);
      const frame = walking ? Math.floor(s.time * 8) & 1 : 0;
      const bob = walking ? 0 : (Math.sin(s.time * 3 + a.slot * 1.7) > 0.2 ? -1 : 0);
      const blink = (s.time + a.slot * 1.3) % 3.2 < 0.12;
      const face = a.stun > 0 ? "error" : a.meditate > 0 ? "sleep" : blink ? "blink" : "normal";
      const c = sprite("ally", {frame, face, tint: a.stun > 0 ? "#6a6a80" : a.color});
      const alpha = a.state === "leaving" ? Math.max(0, a.leave / 1.5) : 1;
      const x = px(a.x) - (c.width >> 1), y = px(a.y - 2 + bob) - (c.height >> 1);
      ctx.globalAlpha = alpha;
      ctx.drawImage(c, x, y);
      ctx.globalAlpha = 1;
      if (a.stun > 0) {
        // Stars circling the head.
        for (let i = 0; i < 2; i++) {
          const t = s.time * 7 + i * Math.PI;
          ctx.fillStyle = i ? "#fffbe0" : "#e8c14a";
          ctx.fillRect(px(a.x + Math.cos(t) * 6), px(y - 1 + Math.sin(t) * 1.5), 1, 1);
        }
      }
      if (a.meditate > 0) {
        const k = (s.time * 0.8 + a.slot * 0.3) % 1;
        label(a.x + 6 + k * 3, y - 2 - k * 10, "z", "#c8c8d4", 1 - k);
        pixelRing(a.x, a.y - 2, 10 + Math.sin(s.time * 3) * 1.5, "#e8e6f0", 0.35);
      }
      if (a.blocked > 0) {
        // A force field the agent bumps into.
        ctx.globalAlpha = 0.7 + Math.sin(s.time * 30) * 0.3;
        ctx.fillStyle = "#7fe0e0";
        for (let i = 0; i < 16; i += 2) ctx.fillRect(px(a.x + 9), y + i, 2, 1);
        ctx.fillRect(px(a.x + 8), y + Math.floor(s.time * 20) % 16, 1, 3);
        ctx.globalAlpha = 1;
      }
      if (a.waiting && a.state === "active") {
        // Waiting for an answer: a question over the head.
        const q = sprite("ask", {});
        const qy = y - q.height - 2 + (Math.floor(s.time * 2) & 1);
        ctx.drawImage(q, px(a.x) - (q.width >> 1), qy);
      }
      for (const sp of a.spirits.values()) {
        const name = SPIRIT_SPRITES[sp.type] || "spirit";
        const g = sprite(name, {frame: Math.floor(s.time * 6) & 1, tint: a.color});
        ctx.globalAlpha = 0.85 * alpha;
        ctx.drawImage(g, px(sp.x) - (g.width >> 1), px(sp.y + Math.sin(s.time * 5 + sp.angle) * 1.5) - (g.height >> 1));
        ctx.globalAlpha = 1;
      }
    }

    // The player's avatar gets the same outline as the sprites: a dark silhouette under it.
    const avatarBox = newCanvas(16, 16), avatarCtx = avatarBox.getContext("2d");
    const silhouette = newCanvas(16, 16), silCtx = silhouette.getContext("2d");
    function silhouetteOf(color) {
      silCtx.globalCompositeOperation = "copy";
      silCtx.drawImage(avatarBox, 0, 0);
      silCtx.globalCompositeOperation = "source-in";
      silCtx.fillStyle = color;
      silCtx.fillRect(0, 0, 16, 16);
      silCtx.globalCompositeOperation = "source-over";
      return silhouette;
    }

    function drawGun(p, s, x, y) {
      const flip = Math.cos(p.aim) < 0;
      const recoil = s.time - p.firedAt < 0.06 ? 1 : 0;
      // Held in a hand at the side: the avatar is an opaque square, so a gun in front of
      // it (aiming up or down) would cover the face and one behind it would vanish.
      // Whole-pixel offsets from the rounded hero, so the gun keeps its place on a walk.
      const side = Math.round(Math.max(5, Math.abs(Math.cos(p.aim)) * 7)) * (flip ? -1 : 1);
      const gx = px(x) + side - (flip ? -recoil : recoil), gy = px(y) + 3 + Math.round(Math.sin(p.aim) * 3);
      const c = sprite("gun", {flip});
      ctx.drawImage(c, flip ? gx - c.width + 3 : gx - 3, gy - 2);
      if (recoil) {
        const mx = gx + (flip ? -9 : 9), my = gy - 1;
        ctx.fillStyle = "#fffbe0";
        ctx.fillRect(mx - 1, my - 1, 3, 3);
        ctx.fillStyle = "#e8c14a";
        ctx.fillRect(mx + (flip ? -2 : 2), my, 1, 1);
      }
    }

    function drawPlayer(p, s, avatar) {
      avatarCtx.clearRect(0, 0, 16, 16);
      avatarCtx.imageSmoothingEnabled = avatar.width > 32;
      avatarCtx.drawImage(avatar, 0, 0, 16, 16);
      const bob = p.moving && !p.dead ? (Math.floor(s.time * 10) & 1 ? -1 : 0) : 0;
      const x = px(p.x - 8), y = px(p.y - 10 + bob);
      if (p.dead > 0) {
        ctx.globalAlpha = 0.35;
        ctx.drawImage(avatarBox, x, y - Math.round((3 - p.dead) * 3));
        ctx.globalAlpha = 1;
        // Alone (classic) there is no coming back, so no countdown.
        if (!s.solo) label(p.x, p.y - 16, String(Math.ceil(p.dead)), "#e8e6f0");
        return;
      }
      const blink = p.invulnerable > 0 && Math.floor(s.time * 12) % 2 === 0;
      ctx.globalAlpha = blink ? 0.4 : 1;
      const sil = silhouetteOf(DARK);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(sil, x + dx, y + dy);
      ctx.drawImage(avatarBox, x, y);
      if (hurtFlash > 0) {
        ctx.globalAlpha = hurtFlash * 3;
        ctx.drawImage(silhouetteOf("#ff4040"), x, y);
      }
      ctx.globalAlpha = 1;
      drawGun(p, s, p.x, p.y + bob);
      if (p.shield > 0) {
        const r = 13 + Math.sin(s.time * 4);
        pixelRing(p.x, p.y - 2, r, "#5b8bd0", 0.5);
        for (let i = 0; i < p.shield; i++) {
          const t = s.time * 2 + i / p.shield * TAU;
          ctx.fillStyle = "#8fb3e0";
          ctx.fillRect(px(p.x + Math.cos(t) * r) - 1, px(p.y - 2 + Math.sin(t) * r) - 1, 2, 2);
        }
      }
      if (s.immortal) pixelRing(p.x, p.y - 2, 12, "#e8c14a", 0.6);
      drawHealth(p, s);
      drawAmmo(p);
    }

    // Right under the player, where the eyes are: the health, blinking when it runs low.
    function drawHealth(p, s) {
      const k = Math.max(0, Math.min(1, p.hp / s.stats.max_hp)), y = px(p.y + 10);
      ctx.fillStyle = DARK;
      ctx.fillRect(px(p.x - 11), y - 2, 22, 5);
      ctx.fillStyle = "#4a2030";
      ctx.fillRect(px(p.x - 10), y - 1, 20, 3);
      const low = k < 0.3 && Math.floor(s.time * 4) % 2 === 0;
      ctx.fillStyle = low ? "#ff8080" : "#d9534f";
      ctx.fillRect(px(p.x - 10), y - 1, Math.round(20 * k), 3);
    }

    // Under the health: a bar while reloading, otherwise one mark per round; a big
    // magazine would be too wide for marks, so it shows the rounds left as a number.
    function drawAmmo(p) {
      const y = px(p.y + 15);
      if (p.reload > 0) {
        ctx.fillStyle = DARK;
        ctx.fillRect(px(p.x - 10), y - 2, 20, 4);
        ctx.fillStyle = "#e8d36a";
        ctx.fillRect(px(p.x - 9), y - 1, Math.round(18 * (1 - p.reload / p.reloadTotal)), 2);
        return;
      }
      const n = p.magazine, w = n * 3 - 1;
      if (n > AMMO_MARKS) {
        label(p.x, y + 1, String(p.ammo), p.ammo > 0 ? "#e8d36a" : "#8a88a0");
        return;
      }
      ctx.fillStyle = DARK;
      ctx.fillRect(px(p.x) - (w >> 1) - 1, y - 2, w + 2, 4);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i < p.ammo ? "#e8d36a" : "#4a4a66";
        ctx.fillRect(px(p.x) - (w >> 1) + i * 3, y - 1, 2, 2);
      }
    }

    // Sauce left by spaghetti code; fire on the floor, first a blinking warning.
    function drawHazard(h, s) {
      const left = h.until - s.time;
      if (h.kind === "goo") {
        const c = sprite("goo", {outline: null});
        const k = Math.max(1, Math.round(h.r * 2 / c.width));
        ctx.globalAlpha = Math.max(0, Math.min(0.8, left / 1.5));
        ctx.drawImage(c, px(h.x - c.width * k / 2), px(h.y - c.height * k / 2), c.width * k, c.height * k);
        ctx.globalAlpha = 1;
        return;
      }
      if (s.time < h.from) {
        if (Math.floor(s.time * 10) & 1) pixelRing(h.x, h.y, h.r, "#ff3030", 0.9, 1);
        pixelRing(h.x, h.y, h.r * 0.5, "#e89a4a", 0.5, 1);
        return;
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, left / 0.6));
      pixelRing(h.x, h.y, h.r, "#e85a2a", 0.35, 1);
      const n = Math.max(1, Math.round(h.r * h.r / 90));
      for (let i = 0; i < n; i++) {
        const a = hash(h.x | 0, h.y | 0, i) * TAU, d = i ? Math.sqrt(hash(h.y | 0, h.x | 0, i)) * (h.r - 3) : 0;
        const c = sprite("fire", {frame: (Math.floor(s.time * 8) + i) & 1});
        ctx.globalAlpha = Math.max(0, Math.min(1, left / 0.6));
        ctx.drawImage(c, px(h.x + Math.cos(a) * d - c.width / 2), px(h.y + Math.sin(a) * d - c.height + 2));
      }
      ctx.globalAlpha = 1;
    }

    function drawEnemyShot(sh) {
      const c = sprite("log_line", {});
      ctx.drawImage(c, px(sh.x) - (c.width >> 1), px(sh.y) - (c.height >> 1));
    }

    // The incident: a zone to stand in; the green ring fills up while the player holds it.
    function drawIncident(z, s) {
      const hold = balance.events.incident.hold;
      pixelRing(z.x, z.y, z.r, "#d9534f", 0.6 + Math.sin(s.time * 6) * 0.3, 2);
      pixelRing(z.x, z.y, z.r * Math.min(1, z.held / hold), "#4fbf6f", 0.9, 1);
      const c = sprite("incident", {});
      ctx.drawImage(c, px(z.x) - (c.width >> 1), px(z.y) - (c.height >> 1));
      label(z.x, z.y - z.r - 6, String(Math.ceil(z.left)), "#d9534f");
    }

    function drawItem(it, s) {
      const left = it.life - it.t;
      if (left < 5 && Math.floor(it.t * 8) & 1) return;
      const hop = it.t < 0.5 ? Math.sin(it.t / 0.5 * Math.PI) * 10 : 0;
      const bob = Math.round(Math.sin(s.time * 3 + it.x * 0.1) * 1.2);
      shadow(it.x, it.y + 5, 10 - Math.min(4, hop / 3));
      const pulse = 0.25 + Math.sin(s.time * 4 + it.y) * 0.1;
      pixelRing(it.x, it.y - 1, 8, ITEM_COLORS[it.type] || "#fffbe0", pulse);
      const c = sprite(it.type, {frame: Math.floor(s.time * 4) & 1});
      const ix = px(it.x) - (c.width >> 1), iy = px(it.y - 2 - hop + bob) - (c.height >> 1);
      ctx.drawImage(c, ix, iy);
      if ((Math.floor(s.time * 3 + it.x) % 4) === 0) {
        // The sparkle sits on the top right corner and hops with the item.
        const sx = ix + c.width - 1, sy = iy;
        ctx.fillStyle = "#fffbe0";
        ctx.fillRect(sx, sy - 1, 1, 3);
        ctx.fillRect(sx - 1, sy, 3, 1);
      }
    }

    function drawMine(m, s) {
      const armed = s.time >= m.armAt;
      const c = sprite("mine", {frame: armed && Math.floor(s.time * 4) & 1 ? 0 : 1,
                                outline: m.evolved ? "#b8902a" : undefined});
      ctx.drawImage(c, px(m.x) - (c.width >> 1), px(m.y) - (c.height >> 1));
    }

    // A turret from a build: its barrel follows the target, it blinks before it goes.
    function drawTurret(t, s) {
      const left = t.until - s.time;
      if (left < 3 && Math.floor(s.time * 6) & 1) return;
      const c = sprite("turret", {tint: t.color});
      const x = px(t.x) - (c.width >> 1), y = px(t.y) - (c.height >> 1);
      ctx.drawImage(c, x, y);
      const cx = t.x, cy = t.y - 2, len = s.time - t.firedAt < 0.08 ? 4 : 5;
      line(cx, cy, cx + Math.cos(t.aim) * len, cy + Math.sin(t.aim) * len, "#3a3a4a");
    }

    // Linters circling the player, with a short trail behind each.
    function drawLinters(w, s) {
      const tint = w.evolved ? "#e8c14a" : "#7fe08a";
      const c = sprite("linter", {tint});
      const p = s.player;
      for (const b of w.blades) {
        const a = Math.atan2(b.y - p.y, b.x - p.x), d = Math.hypot(b.x - p.x, b.y - p.y);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = tint;
        for (let i = 1; i <= 3; i++) {
          const t = a - i * 0.12;
          ctx.fillRect(px(p.x + Math.cos(t) * d), px(p.y + Math.sin(t) * d), 1, 1);
        }
        ctx.globalAlpha = 1;
        ctx.drawImage(c, px(b.x) - (c.width >> 1), px(b.y) - (c.height >> 1));
      }
    }

    function drawGem(g, s) {
      const c = sprite(g.xp >= 10 ? "gem_big" : "gem", {});
      const bob = g.pull ? 0 : Math.round(Math.sin(s.time * 4 + g.x * 0.3) * 1);
      ctx.drawImage(c, px(g.x) - (c.width >> 1), px(g.y + bob) - (c.height >> 1));
    }

    function drawShot(sh) {
      if (sh.target !== undefined) {
        const c = sprite("missile", {tint: sh.color});
        ctx.drawImage(c, px(sh.x) - (c.width >> 1), px(sh.y) - (c.height >> 1));
      } else if (sh.aim !== undefined) {
        const v = Math.hypot(sh.vx, sh.vy) || 1;
        ctx.fillStyle = "#b8902a";
        ctx.fillRect(px(sh.x - sh.vx / v * 4), px(sh.y - sh.vy / v * 4), 1, 1);
        ctx.fillStyle = "#e8c14a";
        ctx.fillRect(px(sh.x - sh.vx / v * 2), px(sh.y - sh.vy / v * 2), 1, 1);
        const c = sprite("bullet", {});
        ctx.drawImage(c, px(sh.x) - (c.width >> 1), px(sh.y) - (c.height >> 1));
      } else {
        const c = sprite("spark", {tint: sh.color});
        ctx.drawImage(c, px(sh.x) - (c.width >> 1), px(sh.y) - (c.height >> 1));
      }
    }

    // A one-pixel line, pixel by pixel: sharper than a stroked path.
    function line(x0, y0, x1, y1, color) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      ctx.fillStyle = color;
      for (let i = 0; i <= n; i++) ctx.fillRect(px(x0 + (x1 - x0) * i / n), px(y0 + (y1 - y0) * i / n), 1, 1);
    }

    function drawEffect(fx, s) {
      const k = fx.t / fx.life;
      if (fx.type === "ring") {
        const r = fx.r * (0.3 + 0.7 * Math.sqrt(k));
        if (k < 0.25) pixelRing(fx.x, fx.y, r * 0.6, "#fffbe0", 0.8, 2);
        pixelRing(fx.x, fx.y, r, fx.color, 1 - k, 2);
        pixelRing(fx.x, fx.y, r - 3, fx.color, (1 - k) * 0.4, 1);
      } else if (fx.type === "pop") {
        pixelRing(fx.x, fx.y, fx.r * (1 + k * 1.5), "#fffbe0", 1 - k, 1);
      } else if (fx.type === "miss") {
        // A flaky test let the bullet through.
        label(fx.x, fx.y - k * 6, tr("МИМО", "MISS"), "#a8a6c0", 1 - k);
      } else if (fx.type === "ult") {
        pixelRing(fx.x, fx.y, fx.r * k, fx.color, 1 - k, 4);
        pixelRing(fx.x, fx.y, fx.r * k * 0.8, "#fffbe0", (1 - k) * 0.6, 2);
      } else if (fx.type === "beam") {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = Math.max(1, Math.round(fx.r * (1 - k)));
        ctx.beginPath();
        ctx.moveTo(px(fx.x), px(fx.y));
        ctx.lineTo(px(fx.x2), px(fx.y2));
        ctx.stroke();
        ctx.strokeStyle = "#fffbe0";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (fx.type === "bolt") {
        // Lightning: a jagged line through every enemy hit, redrawn each frame.
        ctx.globalAlpha = 1 - k;
        for (let i = 1; i < fx.points.length; i++) {
          const a = fx.points[i - 1], b = fx.points[i];
          const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
          let x0 = a.x, y0 = a.y;
          for (let j = 1; j <= n; j++) {
            const jitter = j === n ? 0 : (Math.random() - 0.5) * 6;
            const x1 = a.x + (b.x - a.x) * j / n + jitter, y1 = a.y + (b.y - a.y) * j / n + jitter;
            line(x0, y0, x1, y1, j % 2 ? fx.color : "#e8fbff");
            x0 = x1;
            y0 = y1;
          }
        }
        ctx.globalAlpha = 1;
      } else if (fx.type === "heal") {
        // Plan's spirit heals: green dots running from it to the player.
        const n = Math.max(2, Math.ceil(Math.hypot(fx.x2 - fx.x, fx.y2 - fx.y) / 4));
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = "#4fbf6f";
        for (let i = 0; i <= n; i++) {
          if ((i + Math.floor(k * 8)) % 2) continue;
          ctx.fillRect(px(fx.x + (fx.x2 - fx.x) * i / n), px(fx.y + (fx.y2 - fx.y) * i / n), 1, 1);
        }
        ctx.globalAlpha = 1;
      } else if (fx.type === "strike") {
        // Cron: a bolt from the top of the screen, then a ring where it lands.
        if (k < 0.4) {
          ctx.globalAlpha = 1 - k / 0.4;
          ctx.fillStyle = fx.color;
          ctx.fillRect(px(fx.x) - 1, px(fx.y - 120), 3, 120);
          ctx.fillStyle = "#fffbe0";
          ctx.fillRect(px(fx.x), px(fx.y - 120), 1, 120);
          ctx.globalAlpha = 1;
        }
        pixelRing(fx.x, fx.y, fx.r * (0.4 + 0.6 * k), fx.color, 1 - k, 1);
      } else if (fx.type === "pickup") {
        // The item flies into the player.
        const p = s.player, e = k * k;
        const c = sprite(fx.item, {});
        ctx.globalAlpha = 1 - k;
        ctx.drawImage(c, px(fx.x + (p.x - fx.x) * e - c.width / 2), px(fx.y + (p.y - 4 - fx.y) * e - c.height / 2));
        ctx.globalAlpha = 1;
        pixelRing(p.x, p.y - 2, 6 + k * 10, ITEM_COLORS[fx.item] || "#fffbe0", 1 - k, 1);
      } else if (fx.type === "blink") {
        // A dotted trail from where the null pointer was to where it is now.
        pixelRing(fx.x, fx.y, 6 + k * 6, "#d07ad0", 1 - k, 1);
        pixelRing(fx.x2, fx.y2, 10 - k * 6, "#7fe0e0", 1 - k, 1);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = "#d07ad0";
        const n = Math.ceil(Math.hypot(fx.x2 - fx.x, fx.y2 - fx.y) / 6);
        for (let i = 1; i < n; i++) {
          ctx.fillRect(px(fx.x + (fx.x2 - fx.x) * i / n), px(fx.y + (fx.y2 - fx.y) * i / n), 1, 1);
        }
        ctx.globalAlpha = 1;
      }
    }

    // --- overlays in screen space ---------------------------------------------------

    // Under the HUD's top row (time and score), in the canvas's pixels.
    function bossBarTop() {
      if (!hud) return 14;
      const r = hud.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      if (!r.height || !c.height) return 14;
      return Math.max(14, Math.ceil((r.bottom - c.top) * VH / c.height) + 10);
    }

    // One bar a live boss, the final one first, stacked under the HUD; twins share a bar.
    const BOSS_BARS = 3, BOSS_ROW = 16;
    let barsEnd = 0;   // where the last bar ends, in the canvas's pixels; 0 with no boss
    function drawBossBar(s) {
      barsEnd = 0;
      const bosses = [];
      for (const e of s.enemies) {
        if (e.dead || !(e.final || e.boss) || (e.partner && bosses.includes(e.partner))) continue;
        bosses.push(e);
      }
      if (!bosses.length) return;
      bosses.sort((a, b) => (b.final ? 1 : 0) - (a.final ? 1 : 0));
      const top = bossBarTop();
      const rows = Math.min(bosses.length, BOSS_BARS);
      bosses.slice(0, rows).forEach((boss, i) => drawOneBossBar(boss, top + i * BOSS_ROW));
      barsEnd = top + (rows - 1) * BOSS_ROW + 5;
      if (bosses.length > rows) {
        label(VW / 2, top + rows * BOSS_ROW - 6, "+" + (bosses.length - rows), "#e8c14a");
        barsEnd += BOSS_ROW - 6;
      }
    }

    // The bottom of the boss bars in the page's pixels, for the HUD to keep clear of; 0 with none.
    function bossBarsBottom() {
      if (!barsEnd) return 0;
      const c = canvas.getBoundingClientRect();
      return c.top + barsEnd * c.height / VH;
    }

    function drawOneBossBar(boss, y) {
      const cfg = balance.enemies[boss.type];
      const name = boss.final ? FINAL_NAME : boss.type === "boss" ? BOSS_NAME : [cfg.name, cfg.name_en];
      const pair = boss.partner ? [boss, boss.partner] : [boss];
      const hp = pair.reduce((sum, e) => sum + (e.dead ? 0 : Math.max(0, e.hp)), 0);
      const max = pair.reduce((sum, e) => sum + e.maxHp, 0);
      const w = 160, x = Math.round((VW - w) / 2);
      label(VW / 2, y - 6, tr(...name), "#e8c14a");
      ctx.fillStyle = DARK;
      ctx.fillRect(x - 1, y - 1, w + 2, 6);
      ctx.fillStyle = "#26264a";
      ctx.fillRect(x, y, w, 4);
      const fill = Math.max(0, Math.round(w * hp / max));
      // The merge conflict: ours and theirs; every other boss in its own color.
      ctx.fillStyle = boss.type === "boss" ? "#c8443c" : (GORE[boss.type] || GORE.boss)[0];
      ctx.fillRect(x, y, boss.type === "boss" ? Math.min(fill, w / 2) : fill, 4);
      if (boss.type === "boss" && fill > w / 2) {
        ctx.fillStyle = "#4a7ae8";
        ctx.fillRect(x + w / 2, y, fill - w / 2, 4);
      }
      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.fillRect(x, y, fill, 1);
    }

    // A small head of each agent that is off screen, at the edge, pointing at it.
    function drawAllyMarkers(s, camX, camY) {
      for (const a of s.allies) {
        if (a.state !== "active") continue;
        const sx = a.x - camX, sy = a.y - camY;
        if (sx > -4 && sx < VW + 4 && sy > -4 && sy < VH + 4) continue;
        const x = px(Math.max(6, Math.min(VW - 7, sx))), y = px(Math.max(6, Math.min(VH - 7, sy)));
        ctx.fillStyle = DARK;
        ctx.fillRect(x - 4, y - 3, 9, 7);
        ctx.fillStyle = a.color;
        ctx.fillRect(x - 3, y - 2, 7, 5);
        ctx.fillStyle = "#1b1b2f";
        ctx.fillRect(x - 2, y - 1, 5, 3);
        ctx.fillStyle = "#7ff0e8";
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x + 1, y, 1, 1);
        const ang = Math.atan2(sy - y, sx - x);
        ctx.fillStyle = a.color;
        ctx.fillRect(px(x + Math.cos(ang) * 7), px(y + Math.sin(ang) * 6), 2, 2);
      }
    }

    // The incident off screen: a blinking sign at the edge.
    function drawIncidentMarker(z, camX, camY, s) {
      const sx = z.x - camX, sy = z.y - camY;
      if (sx > -z.r && sx < VW + z.r && sy > -z.r && sy < VH + z.r) return;
      if (!(Math.floor(s.time * 4) & 1)) return;
      const c = sprite("incident", {});
      const x = Math.max(4, Math.min(VW - c.width - 4, sx - c.width / 2));
      const y = Math.max(22, Math.min(VH - c.height - 22, sy - c.height / 2));
      ctx.drawImage(c, px(x), px(y));
    }

    function frameBorder(color, alpha, width) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, VW, width);
      ctx.fillRect(0, VH - width, VW, width);
      ctx.fillRect(0, 0, width, VH);
      ctx.fillRect(VW - width, 0, width, VH);
      ctx.globalAlpha = 1;
    }

    // --- the frame ------------------------------------------------------------------

    function draw(s, avatar) {
      if (s !== last) reset(s);
      if (floorId !== s.map.id + s.map.theme) {
        floor = paintMap(s.map);
        floorId = s.map.id + s.map.theme;
      }
      const dt = Math.max(0, Math.min(0.1, s.time - lastTime));
      lastTime = s.time;
      react(s, dt);
      updateParticles(dt);

      const p = s.player, W = s.map.width, H = s.map.height;
      const sx = shake > 0 ? Math.round((Math.random() - 0.5) * 2 * shake) : 0;
      const sy = shake > 0 ? Math.round((Math.random() - 0.5) * 2 * shake) : 0;
      // A map smaller than the view sits in the middle.
      const cam = (pos, size, view) => (size <= view ? (size - view) / 2
        : Math.max(0, Math.min(size - view, pos - view / 2)));
      // On the player's whole pixel: with an odd view the half pixel would round now one way,
      // now the other, and the player would jitter on screen as it walks.
      const camX = Math.round(cam(Math.round(p.x), W, VW)) + sx;
      const camY = Math.round(cam(Math.round(p.y), H, VH)) + sy;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#0d0d1a";
      ctx.fillRect(0, 0, VW, VH);
      ctx.setTransform(1, 0, 0, 1, -camX, -camY);

      const fx0 = Math.max(0, camX), fy0 = Math.max(0, camY);
      const fw = Math.min(W, camX + VW) - fx0, fh = Math.min(H, camY + VH) - fy0;
      if (fw > 0 && fh > 0) ctx.drawImage(floor, fx0, fy0, fw, fh, fx0, fy0, fw, fh);
      wallDetails(s, camX, camY);
      drawSplats();

      const visible = (o, m) => o.x > camX - m && o.x < camX + VW + m && o.y > camY - m && o.y < camY + VH + m;

      for (const h of s.hazards) if (h.kind === "goo" && visible(h, h.r)) drawHazard(h, s);
      if (s.incident) drawIncident(s.incident, s);
      for (const h of s.hazards) if (h.kind === "fire" && visible(h, h.r + 8)) drawHazard(h, s);
      for (const g of s.gems) if (visible(g, 6)) drawGem(g, s);
      for (const it of s.items) if (visible(it, 16)) drawItem(it, s);
      for (const m of s.mines) if (visible(m, 8)) drawMine(m, s);
      for (const t of s.turrets) if (visible(t, 10)) drawTurret(t, s);

      // Shadows first, then everyone sorted by height on screen.
      const actors = [];
      for (const e of s.enemies) {
        if (!visible(e, 40)) continue;
        if (s.time - (e.born || -1) >= 0.35) shadow(e.x, e.y + e.r, e.r * 2.4);
        actors.push(e);
      }
      for (const a of s.allies) {
        if (a.state === "gone") continue;
        if (a.state === "active") shadow(a.x, a.y + 6, 10);
        actors.push(a);
      }
      if (!p.dead) {
        shadow(p.x, p.y + 6, 14);
        // A gold mark under the player's feet, to find yourself in a crowd.
        pixelRing(p.x, p.y + 6, 9, "#e8c14a", 0.45 + levelGlow * 0.5);
      }
      actors.push(p);
      actors.sort((a, b) => a.y - b.y);
      for (const o of actors) {
        if (o === p) drawPlayer(p, s, avatar);
        else if (o.session !== undefined) drawAlly(o, s);
        else drawEnemy(o, s);
      }

      if (!p.dead) for (const w of s.weapons) if (w.on && w.blades) drawLinters(w, s);
      for (const sh of s.shots) if (visible(sh, 10)) drawShot(sh);
      for (const sh of s.enemyShots) if (visible(sh, 10)) drawEnemyShot(sh);
      for (const fx of s.effects) drawEffect(fx, s);
      drawParticles();
      if (levelGlow > 0) pixelRing(p.x, p.y - 2, 10 + (1 - levelGlow) * 30, "#e8c14a", levelGlow, 2);

      for (const t of s.texts) {
        label(t.x, t.y - t.t * 14, t.text, t.color, t.t > t.life * 0.6 ? (t.life - t.t) / (t.life * 0.4) : 1);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawAllyMarkers(s, camX, camY);
      if (s.incident) drawIncidentMarker(s.incident, camX, camY, s);
      drawBossBar(s);
      if (s.rage > 0) frameBorder("#ff3030", 0.35 + Math.sin(s.time * 8) * 0.15, 3);
      else if (s.redCi > 0) frameBorder("#d9534f", 0.3, 2);
      if (hurtFlash > 0) frameBorder("#ff3030", hurtFlash * 2.5, 6);
      if (flash > 0) {
        ctx.globalAlpha = Math.min(0.8, flash);
        ctx.fillStyle = "#fffbe0";
        ctx.fillRect(0, 0, VW, VH);
        ctx.globalAlpha = 1;
      }
    }

    // A small picture of a map for the menu, made once per map.
    const previews = new Map();
    function preview(map, target) {
      const key = map.id + map.theme;
      let small = previews.get(key);
      if (!small) {
        const walls = map.walls.map((w) => (Array.isArray(w) ? {x: w[0], y: w[1], w: w[2], h: w[3]} : w));
        const full = paintMap(Object.assign({}, map, {walls}));
        small = newCanvas(target.width, target.height);
        const sx = small.getContext("2d");
        sx.imageSmoothingEnabled = true;
        sx.drawImage(full, 0, 0, map.width, map.height, 0, 0, small.width, small.height);
        // Walls shrink to a pixel or two, so they are drawn again in a light color.
        const k = small.width / map.width, th = THEMES[map.theme] || THEMES.office;
        sx.fillStyle = th.colors.edge;
        for (const w of walls) {
          sx.fillRect(Math.floor(w.x * k), Math.floor(w.y * k), Math.max(2, Math.round(w.w * k)),
                      Math.max(2, Math.round(w.h * k)));
        }
        previews.set(key, small);
      }
      const tx = target.getContext("2d");
      tx.clearRect(0, 0, target.width, target.height);
      tx.drawImage(small, 0, 0);
    }

    // A sprite as a small canvas, for the menus: cards, the build bar, the handbook.
    // `gold`: an evolved weapon, outlined in gold.
    const icon = (name, gold) => sprite(name, gold ? {outline: "#e8c14a"} : {});

    const view = () => ({width: VW, height: VH});

    return {draw, preview, icon, view, bossBarsBottom};
  }

  root.LCSRender = {createRenderer, THEMES};
})(typeof window !== "undefined" ? window : globalThis);
