// The arena: drawing what lives on the map besides the painted floor — the lights on the
// walls and the map's objects from terrain.js: pits, conveyor belts, fire vents, teleport
// pads, doors, cracked walls, server racks, and the dark of the night office. Looks only:
// it reads the state and never changes it.
//   const art = LCSTerrainArt.create(ctx, helpers, balance.terrain);
//   helpers: {px, pixelRing, hash, sprite, faceHeight}
"use strict";

(function (root) {
  const DARK = root.LCSSprites.OUTLINE;
  const PAD_COLORS = ["#7fe0e0", "#f07ab4", "#e8c14a", "#7fe07f"];
  const FLAMES = ["#fffbe0", "#e8c14a", "#e89a4a", "#d9534f"];

  function create(ctx, h, TB) {
    const {px, pixelRing, hash, sprite, faceHeight} = h;
    const K = TB || {};

    function rect(x, y, w, ht, color) {
      ctx.fillStyle = color;
      ctx.fillRect(px(x), px(y), Math.round(w), Math.round(ht));
    }
    function outline(x, y, w, ht, color) {
      rect(x, y, w, 1, color);
      rect(x, y + ht - 1, w, 1, color);
      rect(x, y, 1, ht, color);
      rect(x + w - 1, y, 1, ht, color);
    }

    // --- lights on the still walls: server lights, torches, alarm lamps -------------------

    function torch(x, y, t, seed) {
      x = px(x);
      ctx.fillStyle = "#5a4a3a";
      ctx.fillRect(x - 1, y + 2, 2, 4);
      const flicker = hash(seed, 0, Math.floor(t * 10));
      const n = 3 + Math.floor(flicker * 3);
      for (let row = 0; row < n; row++) {
        const wdt = row < 1 ? 1 : row < n - 1 ? 3 : 2;
        ctx.fillStyle = FLAMES[Math.min(3, Math.floor(row / n * 4))];
        ctx.fillRect(x - Math.floor(wdt / 2) + (row === 0 && flicker > 0.5 ? 1 : 0), y + 1 - row, wdt, 1);
      }
      pixelRing(x, y, 10 + flicker * 2, "#e89a4a", 0.12, 2);
      pixelRing(x, y, 6 + flicker, "#e8c14a", 0.15, 2);
    }

    function details(s, camX, camY, VW, VH) {
      const theme = s.map.theme, t = s.time;
      for (const [i, w] of s.map.walls.entries()) {
        if (w.x > camX + VW + 20 || w.y > camY + VH + 20 || w.x + w.w < camX - 20 || w.y + w.h < camY - 20) {
          continue;
        }
        const F = faceHeight(w), faceY = w.y + w.h - F;
        if (theme === "servers" || theme === "micro") {
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
        } else if (theme === "hazard" || theme === "factory") {
          const on = Math.floor(t * 2 + i) % 2 === 0;
          for (const lx of [3, w.w - 5]) {
            ctx.fillStyle = on ? "#ff4040" : "#5a1a1a";
            ctx.fillRect(w.x + lx, w.y + 3, 2, 2);
            if (on) pixelRing(w.x + lx + 1, w.y + 4, 4, "#ff4040", 0.25);
          }
        } else if (theme === "night") {
          // A monitor left on: a cold glow over the desk.
          if (i % 2) continue;
          const mx = w.x + Math.min(w.w - 10, 6);
          rect(mx, w.y + 2, 8, 5, "#1a2a3a");
          rect(mx + 1, w.y + 3, 6, 3, Math.floor(t + i) % 4 ? "#5bd0e8" : "#7fe0e0");
          pixelRing(mx + 4, w.y + 5, 14, "#5bd0e8", 0.12, 2);
        }
      }
    }

    // --- the ground: pits, belts, vents and pads, under everyone ----------------------------

    function pit(w) {
      rect(w.x, w.y, w.w, w.h, "#0b1026");
      // Far below: a few stars, and the lip of the cloud on the top edge.
      for (let i = 0; i < w.w * w.h / 900; i++) {
        const sx = w.x + 3 + Math.floor(hash(i, w.x, w.y) * (w.w - 6));
        const sy = w.y + 6 + Math.floor(hash(w.y, i, w.x) * (w.h - 9));
        rect(sx, sy, 1, 1, i % 3 ? "#3a4a7a" : "#c8d4f0");
      }
      rect(w.x, w.y, w.w, 4, "#2c3a66");
      rect(w.x, w.y + 4, w.w, 1, "#1a2448");
      outline(w.x, w.y, w.w, w.h, DARK);
    }

    function belt(b, t) {
      const [dx, dy] = root.LCSTerrain.BELT_DIRS[b.dir] || [1, 0];
      const along = dx !== 0, len = along ? b.w : b.h, across = along ? b.h : b.w;
      rect(b.x, b.y, b.w, b.h, "#25292b");
      // Rails on both long sides.
      if (along) { rect(b.x, b.y, b.w, 2, "#4a5252"); rect(b.x, b.y + b.h - 2, b.w, 2, "#4a5252"); }
      else { rect(b.x, b.y, 2, b.h, "#4a5252"); rect(b.x + b.w - 2, b.y, 2, b.h, "#4a5252"); }
      // Chevrons that move with the belt.
      const shift = Math.floor(t * (K.belt ? K.belt.speed : 40)) % 16, dir = dx + dy > 0 ? 1 : -1;
      const mid = Math.floor(across / 2);
      for (let a = (dir > 0 ? shift : 16 - shift) - 16; a < len; a += 16) {
        for (let k = -4; k <= 4; k++) {
          const off = a + (4 - Math.abs(k)) * dir;
          if (off < 2 || off >= len - 2) continue;
          if (along) rect(b.x + off, b.y + mid + k * 2, 2, 2, "#6a7470");
          else rect(b.x + mid + k * 2, b.y + off, 2, 2, "#6a7470");
        }
      }
      outline(b.x, b.y, b.w, b.h, DARK);
    }

    function vent(v, t) {
      rect(v.x, v.y, v.w, v.h, "#1a1414");
      const across = v.w > v.h;
      for (let a = 2; a < (across ? v.w : v.h) - 1; a += 4) {
        if (across) rect(v.x + a, v.y + 2, 1, v.h - 4, "#3a3030");
        else rect(v.x + 2, v.y + a, v.w - 4, 1, "#3a3030");
      }
      outline(v.x, v.y, v.w, v.h, DARK);
      if (v.state === "warn") {
        if (Math.floor(t * 8) & 1) outline(v.x - 1, v.y - 1, v.w + 2, v.h + 2, "#ff3030");
        rect(v.x + 2, v.y + 2, v.w - 4, v.h - 4, "rgba(232, 90, 42, 0.25)");
      } else if (v.state === "burn") {
        rect(v.x + 1, v.y + 1, v.w - 2, v.h - 2, "rgba(232, 90, 42, 0.35)");
        const c = sprite("fire", {frame: Math.floor(t * 8) & 1});
        for (let yy = v.y; yy < v.y + v.h - 4; yy += 10) {
          for (let xx = v.x; xx < v.x + v.w - 4; xx += 10) {
            const j = hash(xx, yy, Math.floor(t * 6));
            ctx.drawImage(c, px(xx + j * 3), px(yy + 8 - c.height + j * 2));
          }
        }
      }
    }

    function pad(o, t) {
      const color = PAD_COLORS[o.pair % PAD_COLORS.length], r = K.pad ? K.pad.radius : 12;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = color;
      for (let y = -r + 2; y <= r - 2; y++) {
        const half = Math.floor(Math.sqrt((r - 2) ** 2 - y * y));
        ctx.fillRect(px(o.x) - half, px(o.y) + y, half * 2 + 1, 1);
      }
      ctx.globalAlpha = 1;
      pixelRing(o.x, o.y, r, color, 0.9, 1);
      pixelRing(o.x, o.y, 2 + (t * 10) % (r - 2), "#fffbe0", 0.6, 1);
    }

    function ground(s, visible) {
      const T = s.map.terrain;
      if (!T) return;
      const seen = (b) => visible({x: b.x + b.w / 2, y: b.y + b.h / 2}, Math.max(b.w, b.h));
      for (const w of T.pits) if (seen(w)) pit(w);
      for (const b of T.belts) if (seen(b)) belt(b, s.time);
      for (const v of T.vents) if (seen(v)) vent(v, s.time);
      for (const pair of T.pads) for (const o of pair) if (visible(o, 20)) pad(o, s.time);
    }

    // --- walls that come and go: doors, cracked walls, racks --------------------------------

    function door(d, t) {
      if (!d.closed) {
        // Open: only the frame on the floor; a closing one blinks its shape.
        outline(d.x, d.y, d.w, d.h, "#3a3046");
        if (d.warn && Math.floor(t * 6) & 1) {
          ctx.globalAlpha = 0.45;
          rect(d.x, d.y, d.w, d.h, "#8a6a4a");
          ctx.globalAlpha = 1;
        }
        return;
      }
      rect(d.x, d.y, d.w, d.h, "#6a5038");
      const along = d.w > d.h;
      for (let a = 4; a < (along ? d.w : d.h); a += 6) {
        if (along) rect(d.x + a, d.y + 1, 1, d.h - 2, "#4a3828");
        else rect(d.x + 1, d.y + a, d.w - 2, 1, "#4a3828");
      }
      rect(d.x + (along ? 0 : 1), d.y + (along ? 1 : 0), along ? d.w : 2, along ? 2 : d.h, "#8a6a4a");
      outline(d.x, d.y, d.w, d.h, DARK);
    }

    function crack(w, t) {
      if (w.hp <= 0) {
        // Rubble where it stood.
        for (let i = 0; i < w.w * w.h / 40; i++) {
          rect(w.x + hash(i, w.x, 1) * (w.w - 2), w.y + hash(w.y, i, 2) * (w.h - 2), 2, 1,
               i % 2 ? "#3a3346" : "#241f2c");
        }
        return;
      }
      const hit = w.hitAt !== undefined && t - w.hitAt < 0.08;
      rect(w.x, w.y, w.w, w.h, hit ? "#8a7a9a" : "#4a4256");
      for (let y = w.y + 4; y < w.y + w.h; y += 6) rect(w.x + 1, y, w.w - 2, 1, "#3c3548");
      // More cracks as it wears down.
      const lines = Math.ceil((1 - w.hp / w.maxHp) * 6) + 1;
      for (let i = 0; i < lines; i++) {
        const cx = w.x + 3 + hash(i, w.x, 3) * (w.w - 6), cy = w.y + 2 + hash(w.y, i, 4) * (w.h - 4);
        for (let k = 0; k < 5; k++) rect(cx + k * (i % 2 ? 1 : -1), cy + k, 1, 1, "#1c1822");
      }
      outline(w.x, w.y, w.w, w.h, DARK);
    }

    function rack(r, t, i) {
      if (r.hp <= 0) {
        rect(r.x + 2, r.y + r.h - 8, r.w - 4, 6, "#161a24");
        for (let k = 0; k < 6; k++) rect(r.x + hash(k, i, 5) * r.w, r.y + r.h - 10 + hash(i, k, 6) * 8, 2, 2, "#2a3040");
        if (Math.floor(t * 3 + i) % 3 === 0) rect(r.x + r.w / 2, r.y + r.h - 14 - (t * 10) % 8, 2, 2, "#5a5a6a");
        return;
      }
      const hit = r.hitAt !== undefined && t - r.hitAt < 0.08;
      rect(r.x, r.y, r.w, r.h, hit ? "#8a90a0" : "#20252f");
      rect(r.x + 1, r.y + 1, r.w - 2, 4, "#2a3040");
      for (let y = r.y + 7; y < r.y + r.h - 3; y += 4) {
        rect(r.x + 3, y, r.w - 6, 3, "#161a24");
        const k = hash(i * 31 + y, 1, Math.floor(t * 3 + hash(i, y, 2) * 5));
        rect(r.x + r.w - 6, y + 1, 2, 1, k < 0.6 ? "#4fbf6f" : k < 0.8 ? "#e8c14a" : "#d9534f");
      }
      // A worn rack sparks.
      if (r.hp < r.maxHp && Math.floor(t * 12 + i) % 4 === 0) {
        rect(r.x + hash(i, Math.floor(t * 12), 7) * r.w, r.y + 4, 1, 1, "#fffbe0");
      }
      outline(r.x, r.y, r.w, r.h, DARK);
    }

    function solids(s, visible) {
      const T = s.map.terrain;
      if (!T) return;
      const seen = (b) => visible({x: b.x + b.w / 2, y: b.y + b.h / 2}, Math.max(b.w, b.h));
      for (const d of T.doors) if (seen(d)) door(d, s.time);
      for (const w of T.cracks) if (seen(w)) crack(w, s.time);
      T.racks.forEach((r, i) => { if (seen(r)) rack(r, s.time, i); });
    }

    // Effects of the terrain: a wall crumbling, an enemy falling into a pit.
    function effect(fx, s, k) {
      if (fx.type === "crumble") {
        for (let i = 0; i < 14; i++) {
          const a = hash(i, fx.x | 0, 8) * Math.PI * 2, d = k * (10 + hash(fx.y | 0, i, 9) * 20);
          ctx.globalAlpha = 1 - k;
          rect(fx.x + Math.cos(a) * d * fx.w / 40, fx.y + Math.sin(a) * d + k * k * 12, 2, 2,
               i % 2 ? "#4a4256" : "#8a7a9a");
        }
        ctx.globalAlpha = 1;
      } else if (fx.type === "fall") {
        pixelRing(fx.x, fx.y, Math.max(1, fx.r * (1 - k)), "#e8e6f0", 1 - k, 1);
        pixelRing(fx.x, fx.y, Math.max(1, fx.r * (1 - k) * 0.5), "#7fe0e0", 1 - k, 1);
      }
    }

    // --- the dark of the night office -------------------------------------------------------

    let shade = null;
    function dark(s, camX, camY, VW, VH) {
      const T = s.map.terrain;
      if (!T || !T.dark) return;
      if (!shade || shade.width !== VW || shade.height !== VH) {
        shade = h.newCanvas(VW, VH);
      }
      const c = shade.getContext("2d");
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, VW, VH);
      c.fillStyle = "rgba(3, 4, 12, 0.94)";
      c.fillRect(0, 0, VW, VH);
      c.globalCompositeOperation = "destination-out";
      // A pixel disc of light, with a dimmer ring around it.
      const light = (x, y, r) => {
        x = Math.round(x - camX);
        y = Math.round(y - camY);
        for (const [rr, a] of [[r, 0.55], [r * 0.75, 1]]) {
          c.globalAlpha = a;
          for (let dy = -Math.floor(rr); dy <= rr; dy++) {
            const half = Math.floor(Math.sqrt(rr * rr - dy * dy));
            c.fillRect(x - half, y + dy, half * 2 + 1, 1);
          }
        }
        c.globalAlpha = 1;
      };
      const D = K.dark || {light: 110, ally_light: 60};
      if (!s.player.dead) light(s.player.x, s.player.y, D.light);
      for (const a of s.allies) if (a.state === "active") light(a.x, a.y, D.ally_light);
      for (const fx of s.effects) if (fx.type === "ring" || fx.type === "ult") light(fx.x, fx.y, Math.min(80, fx.r));
      for (const z of s.hazards) if (z.kind === "fire" && s.time >= z.from) light(z.x, z.y, z.r + 10);
      c.globalCompositeOperation = "source-over";
      ctx.drawImage(shade, 0, 0);
    }

    // --- the map's small picture in the menu -------------------------------------------------

    function preview(sx, map, k) {
      const mark = (list, color, min) => {
        sx.fillStyle = color;
        for (const [x, y, w, ht] of list || []) {
          sx.fillRect(Math.floor(x * k), Math.floor(y * k), Math.max(min, Math.round(w * k)),
                      Math.max(min, Math.round(ht * k)));
        }
      };
      mark(map.pits, "#0b1026", 2);
      mark(map.belts, "#4a5252", 2);
      mark(map.vents, "#e85a2a", 1);
      mark(map.doors, "#8a6a4a", 2);
      mark(map.cracks, "#8a7a9a", 2);
      mark((map.racks || []).map(([x, y]) => [x - 10, y - 14, 20, 28]), "#5bd0e8", 2);
      for (const pair of map.pads || []) {
        mark([[pair[0] - 8, pair[1] - 8, 16, 16], [pair[2] - 8, pair[3] - 8, 16, 16]], "#7fe0e0", 2);
      }
    }

    return {details, ground, solids, effect, dark, preview};
  }

  root.LCSTerrainArt = {create};
})(typeof window !== "undefined" ? window : globalThis);
