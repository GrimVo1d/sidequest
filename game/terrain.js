// The arena: the ground under the fight. Walls, the paths of enemies around them, the lines
// of sight, and the map's own objects (maps.js, 0.8): doors that close, cracked walls and
// server racks that shots break, conveyor belts, pits, teleport pads, fire vents and the
// dark. No DOM here, so tests run it in jsc.
//   const T = LCSTerrain.create(map, balance.terrain, hooks);
//   T.walls              // the boxes that stop everyone and every bullet: {x, y, w, h}; the
//                        // array stays the same, its contents follow doors, cracks and racks
//   T.still              // the walls that never change: render.js paints them into the floor
//   T.pushOut(o, r, ground)   // `ground`: pits stop it too (the player, allies, items)
//   T.update(dt, s)      // doors, racks, belts, vents, pits and pads; s: the game's state
//   T.shot(sh)           // true: the bullet hit a wall (and maybe broke it)
//   T.blast(x, y, r, damage), T.knock(e, x, y)   // an explosion breaks walls, throws enemies
// hooks: explode(x, y, r, damage, color), hurtPlayer(damage), hurtEnemy(e, damage),
//        fall(e), effect(fx), text(x, y, value, color, life), met(id)
"use strict";

(function (root) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const FCELL = 16;   // px per cell of the enemies' distance field
  const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const RACK_W = 20, RACK_H = 28;   // a server rack's box
  const BELT_DIRS = {r: [1, 0], l: [-1, 0], d: [0, 1], u: [0, -1]};
  const box = ([x, y, w, h]) => ({x, y, w, h});
  const inside = (b, x, y, m) => x > b.x - m && x < b.x + b.w + m && y > b.y - m && y < b.y + b.h + m;

  function create(map, TB, hooks) {
    const W = map.width, H = map.height, K = TB || {}, on = hooks || {};
    const call = (name, ...args) => (on[name] ? on[name](...args) : undefined);
    const still = map.walls.map(box);
    const doors = (map.doors || []).map(([x, y, w, h, offset]) =>
      ({x, y, w, h, offset: offset || 0, closed: false, warn: false}));
    const cracks = (map.cracks || []).map((c) => Object.assign(box(c), {hp: K.crack.hp, maxHp: K.crack.hp}));
    const racks = (map.racks || []).map(([x, y]) => ({x: x - RACK_W / 2, y: y - RACK_H / 2, w: RACK_W, h: RACK_H,
                                                      hp: K.rack.hp, maxHp: K.rack.hp, downUntil: 0}));
    const belts = (map.belts || []).map(([x, y, w, h, dir]) => Object.assign(box([x, y, w, h]), {dir}));
    const pits = (map.pits || []).map(box);
    const pads = (map.pads || []).map(([x1, y1, x2, y2], pair) => [{x: x1, y: y1, pair}, {x: x2, y: y2, pair}]);
    const vents = (map.vents || []).map(([x, y, w, h, group]) =>
      Object.assign(box([x, y, w, h]), {group: group || 0, state: "idle"}));
    const groups = vents.reduce((n, v) => Math.max(n, v.group + 1), 0);
    const walls = [];
    const solid = (o) => o.hp === undefined || o.hp > 0;

    const inWall = (x, y, r, ground) => walls.some((w) => inside(w, x, y, r))
      || (!!ground && pits.some((w) => inside(w, x, y, r)));

    // Moves a circle out of every box it overlaps, so it slides along them.
    function pushFrom(list, o, r) {
      for (const w of list) {
        const nx = clamp(o.x, w.x, w.x + w.w), ny = clamp(o.y, w.y, w.y + w.h);
        const dx = o.x - nx, dy = o.y - ny, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          o.x = nx + dx / d * r;
          o.y = ny + dy / d * r;
        } else {
          // The centre is inside the box: leave by the nearest side.
          const sides = [[o.x - w.x, w.x - r, o.y], [w.x + w.w - o.x, w.x + w.w + r, o.y],
                         [o.y - w.y, o.x, w.y - r], [w.y + w.h - o.y, o.x, w.y + w.h + r]];
          const best = sides.reduce((a, b) => (b[0] < a[0] ? b : a));
          o.x = best[1];
          o.y = best[2];
        }
      }
    }
    function pushOut(o, r, ground) {
      pushFrom(walls, o, r);
      if (ground && pits.length) pushFrom(pits, o, r);
    }

    // Where the segment from (x0, y0) by (dx, dy) first enters a wall grown by r (the same
    // box as inWall), as a share of its length from 0 to 1, or Infinity when it enters none.
    // Exact: the segment is clipped against each box on both axes (the slab method), so a
    // line never cuts the corner of a wall the way a check every few pixels did.
    function wallEntry(x0, y0, dx, dy, r) {
      let first = Infinity;
      for (const w of walls) {
        let t0 = 0, t1 = 1;
        for (const [p, d, lo, hi] of [[x0, dx, w.x - r, w.x + w.w + r], [y0, dy, w.y - r, w.y + w.h + r]]) {
          if (d === 0) {
            if (p <= lo || p >= hi) t1 = -1;
            continue;
          }
          const a = (lo - p) / d, b = (hi - p) / d;
          t0 = Math.max(t0, Math.min(a, b));
          t1 = Math.min(t1, Math.max(a, b));
        }
        if (t0 < t1) first = Math.min(first, t0);
      }
      return first;
    }

    // No wall between a point and (x, y) for a circle of radius r.
    const clearPath = (o, x, y, r) => wallEntry(o.x, o.y, x - o.x, y - o.y, r) === Infinity;

    // How far a line from (x, y) along (dx, dy) goes before a wall, up to `length`.
    function toWall(x, y, dx, dy, length) {
      return Math.min(length, wallEntry(x, y, dx * length, dy * length, 0) * length);
    }

    const inSight = (from, e) => !walls.length || clearPath(from, e.x, e.y, 0);

    // The first `n` of the sorted enemies with no wall in between: the path is checked
    // only until enough are found.
    function firstInSight(sorted, from, n) {
      const out = [];
      for (const e of sorted) {
        if (out.length >= n) break;
        if (inSight(from, e)) out.push(e);
      }
      return out;
    }

    // --- the enemies' paths ------------------------------------------------------------

    // Enemies find their way around walls and pits along a distance field: a breadth-first
    // search over 16 px cells from the player's cell, redone when the player changes cell
    // or a wall comes or goes.
    const FW = Math.ceil(W / FCELL), FH = Math.ceil(H / FCELL);
    const blocked = new Uint8Array(FW * FH);
    const flow = new Int32Array(FW * FH).fill(-1);
    const queue = new Int32Array(FW * FH);
    let flowFrom = -1;
    const cellOf = (o) => clamp(Math.floor(o.x / FCELL), 0, FW - 1)
      + clamp(Math.floor(o.y / FCELL), 0, FH - 1) * FW;

    // The walls now: the still ones, closed doors, cracked walls and racks still standing.
    function rebuild() {
      walls.length = 0;
      walls.push(...still, ...doors.filter((d) => d.closed), ...cracks.filter(solid),
                 ...racks.filter(solid));
      for (let c = 0; c < FW * FH; c++) {
        blocked[c] = inWall((c % FW + 0.5) * FCELL, (Math.floor(c / FW) + 0.5) * FCELL, 6, true) ? 1 : 0;
      }
      flowFrom = -1;
    }
    rebuild();
    const flat = !walls.length && !pits.length && !doors.length;

    // A diagonal step is allowed only if both straight steps next to it are open.
    function open(cx, cy, dx, dy) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= FW || y >= FH || blocked[x + y * FW]) return false;
      return !dx || !dy || (!blocked[cx + dx + cy * FW] && !blocked[cx + (cy + dy) * FW]);
    }

    function updateFlow(target) {
      const start = cellOf(target);
      if (start === flowFrom) return;
      flowFrom = start;
      flow.fill(-1);
      flow[start] = 0;
      let head = 0, tail = 0;
      queue[tail++] = start;
      while (head < tail) {
        const c = queue[head++], cx = c % FW, cy = (c - cx) / FW;
        for (const [dx, dy] of STEPS) {
          if (!open(cx, cy, dx, dy)) continue;
          const n = cx + dx + (cy + dy) * FW;
          if (flow[n] < 0) { flow[n] = flow[c] + 1; queue[tail++] = n; }
        }
      }
    }

    // Where `e` should head to reach `target`: the target itself, or the next cell towards it
    // on the field made by updateFlow(target).
    function waypoint(e, target) {
      if (flat) return target;
      const c = cellOf(e);
      if (flow[c] >= 0 && flow[c] <= 2) return target;
      const cx = c % FW, cy = (c - cx) / FW;
      let best = -1, bestFlow = flow[c] >= 0 ? flow[c] : Infinity;
      for (const [dx, dy] of STEPS) {
        if (!open(cx, cy, dx, dy)) continue;
        const n = cx + dx + (cy + dy) * FW;
        if (flow[n] >= 0 && flow[n] < bestFlow) { bestFlow = flow[n]; best = n; }
      }
      if (best < 0) return target;
      return {x: (best % FW + 0.5) * FCELL, y: (Math.floor(best / FW) + 0.5) * FCELL};
    }

    // --- walls that break ----------------------------------------------------------------

    // A cracked wall crumbles for good; a rack blows up and stands again a while later.
    function damage(w, amount, time) {
      if (w.hp === undefined || w.hp <= 0) return;
      w.hp -= amount;
      w.hitAt = time;
      if (w.hp > 0) return;
      rebuild();
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      if (cracks.includes(w)) {
        call("effect", {type: "crumble", x: cx, y: cy, w: w.w, h: w.h, life: 0.5});
        call("met", "crack");
        return;
      }
      const R = K.rack;
      w.downUntil = time + R.back;
      call("met", "rack");
      call("explode", cx, cy, R.radius, R.damage, "#e85a2a");
      call("effect", {type: "ult", x: cx, y: cy, r: R.radius, color: "#e89a4a", life: 0.5});
      const p = state && state.player;
      if (p && !p.dead && Math.hypot(p.x - cx, p.y - cy) < R.radius + p.r) call("hurtPlayer", R.player_damage);
    }

    let now = 0, state = null;
    // A bullet in a wall stops; one in a cracked wall or a rack wears it down.
    function shot(sh) {
      for (const w of walls) {
        if (!inside(w, sh.x, sh.y, 0)) continue;
        damage(w, sh.damage, now);
        return true;
      }
      return false;
    }

    function blast(x, y, r, amount) {
      for (const w of [...cracks, ...racks]) {
        const nx = clamp(x, w.x, w.x + w.w), ny = clamp(y, w.y, w.y + w.h);
        if ((nx - x) ** 2 + (ny - y) ** 2 <= r * r) damage(w, amount, now);
      }
    }

    // On a map with pits an explosion throws the enemies around it back: maybe into a pit.
    function knock(e, x, y) {
      if (!pits.length || e.boss || e.rigid || e.noclip) return;
      const d = Math.hypot(e.x - x, e.y - y) || 1;
      e.x += (e.x - x) / d * K.pit.knockback;
      e.y += (e.y - y) / d * K.pit.knockback;
    }

    // --- the step ------------------------------------------------------------------------

    function updateDoors(s) {
      const D = K.door, cycle = D.open + D.closed;
      let changed = false;
      for (const d of doors) {
        const t = (s.time + d.offset) % cycle;
        const closed = t >= D.open;
        d.warn = !closed && t >= D.open - D.warn;
        if (closed !== d.closed) { d.closed = closed; changed = true; }
      }
      if (changed) { rebuild(); call("met", "door"); }
    }

    function updateRacks(s) {
      for (const r of racks) {
        if (r.hp > 0 || s.time < r.downUntil) continue;
        // Back up only when no one stands in its place.
        if ([s.player, ...s.allies].some((o) => inside(r, o.x, o.y, o.r || 8))) continue;
        r.hp = r.maxHp;
        rebuild();
      }
    }

    function updateBelts(s, dt) {
      const step = K.belt.speed * dt, p = s.player;
      const ride = (o) => {
        for (const b of belts) {
          if (!inside(b, o.x, o.y, 0)) continue;
          const [dx, dy] = BELT_DIRS[b.dir] || [0, 0];
          o.x = clamp(o.x + dx * step, 0, W);
          o.y = clamp(o.y + dy * step, 0, H);
          return true;
        }
        return false;
      };
      if (!p.dead && ride(p)) call("met", "belt");
      for (const a of s.allies) if (a.state === "active") ride(a);
      for (const e of s.enemies) if (!e.dead && !e.rigid && !e.noclip) ride(e);
      for (const g of s.gems) ride(g);
    }

    // Vents burn in groups, one after another; a warning first.
    function updateVents(s, dt) {
      const V = K.vent, slot = V.every / Math.max(1, groups);
      const t = s.time % V.every;
      for (const v of vents) {
        const at = (t - v.group * slot + V.every) % V.every;
        v.state = at < V.warn ? "warn" : at < V.warn + V.burn ? "burn" : "idle";
        if (v.state !== "burn") continue;
        const p = s.player;
        if (!p.dead && inside(v, p.x, p.y, p.r / 2)) { call("met", "vent"); call("hurtPlayer", V.damage); }
        for (const e of s.enemies) {
          if (!e.dead && !e.ghost && inside(v, e.x, e.y, 0)) call("hurtEnemy", e, V.enemy_dps * dt);
        }
      }
    }

    function updatePits(s) {
      for (const e of s.enemies) {
        if (e.dead || e.boss || e.ghost || e.rigid || e.noclip) continue;
        if (pits.some((w) => inside(w, e.x, e.y, -2))) { call("met", "pit"); call("fall", e); }
      }
    }

    // A pad sends the player to its twin; it works again once the player has stepped off.
    function updatePads(s) {
      const p = s.player, r = K.pad.radius;
      if (p.dead) return;
      const on = pads.flat().find((o) => (o.x - p.x) ** 2 + (o.y - p.y) ** 2 <= r * r);
      if (!on) { p.padArmed = true; return; }
      if (p.padArmed === false || (p.padAt !== undefined && s.time < p.padAt + K.pad.cooldown)) return;
      const to = pads[on.pair].find((o) => o !== on);
      call("effect", {type: "ring", x: p.x, y: p.y, r: 16, color: "#7fe0e0", life: 0.35});
      p.x = to.x;
      p.y = to.y;
      p.padArmed = false;
      p.padAt = s.time;
      call("effect", {type: "ring", x: p.x, y: p.y, r: 22, color: "#7fe0e0", life: 0.45});
      call("met", "pad");
    }

    function update(dt, s) {
      now = s.time;
      state = s;
      if (map.dark) call("met", "dark");
      if (doors.length) updateDoors(s);
      if (racks.length) updateRacks(s);
      if (belts.length) updateBelts(s, dt);
      if (vents.length) updateVents(s, dt);
      if (pits.length) updatePits(s);
      if (pads.length) updatePads(s);
    }

    return {walls, still, inWall, pushOut, wallEntry, clearPath, toWall, inSight, firstInSight,
            updateFlow, waypoint, update, shot, blast, knock, flat,
            // What render.js draws: the objects as they are now.
            objects: {doors, cracks, racks, belts, pits, pads, vents, dark: !!map.dark}};
  }

  root.LCSTerrain = {create, RACK_W, RACK_H, BELT_DIRS};
})(typeof window !== "undefined" ? window : globalThis);
