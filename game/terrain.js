// The arena: the ground under the fight. Walls, the paths of enemies around them and the
// lines of sight. No DOM here, so tests run it in jsc.
//   const T = LCSTerrain.create(map);   // map: maps.js, walls as [x, y, width, height]
//   T.walls                             // the boxes that stop everyone: {x, y, w, h}
//   T.pushOut(o, r)                     // moves a circle out of the walls
"use strict";

(function (root) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const FCELL = 16;   // px per cell of the enemies' distance field
  const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function create(map) {
    const W = map.width, H = map.height;
    const walls = map.walls.map(([x, y, w, h]) => ({x, y, w, h}));

    const inWall = (x, y, r) => walls.some((w) => x > w.x - r && x < w.x + w.w + r
                                                && y > w.y - r && y < w.y + w.h + r);

    // Moves a circle out of every wall it overlaps, so it slides along them.
    function pushOut(o, r) {
      for (const w of walls) {
        const nx = clamp(o.x, w.x, w.x + w.w), ny = clamp(o.y, w.y, w.y + w.h);
        const dx = o.x - nx, dy = o.y - ny, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          o.x = nx + dx / d * r;
          o.y = ny + dy / d * r;
        } else {
          // The centre is inside the wall: leave by the nearest side.
          const sides = [[o.x - w.x, w.x - r, o.y], [w.x + w.w - o.x, w.x + w.w + r, o.y],
                         [o.y - w.y, o.x, w.y - r], [w.y + w.h - o.y, o.x, w.y + w.h + r]];
          const best = sides.reduce((a, b) => (b[0] < a[0] ? b : a));
          o.x = best[1];
          o.y = best[2];
        }
      }
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

    // Enemies find their way around walls along a distance field: a breadth-first search
    // over 16 px cells from the player's cell, redone when the player changes cell.
    const FW = Math.ceil(W / FCELL), FH = Math.ceil(H / FCELL);
    const blocked = new Uint8Array(FW * FH);
    for (let c = 0; c < FW * FH; c++) {
      blocked[c] = inWall((c % FW + 0.5) * FCELL, (Math.floor(c / FW) + 0.5) * FCELL, 6) ? 1 : 0;
    }
    const flow = new Int32Array(FW * FH).fill(-1);
    const queue = new Int32Array(FW * FH);
    let flowFrom = -1;
    const cellOf = (o) => clamp(Math.floor(o.x / FCELL), 0, FW - 1)
      + clamp(Math.floor(o.y / FCELL), 0, FH - 1) * FW;

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
      if (!walls.length) return target;
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

    return {walls, inWall, pushOut, wallEntry, clearPath, toWall, inSight, firstInSight,
            updateFlow, waypoint};
  }

  root.LCSTerrain = {create};
})(typeof window !== "undefined" ? window : globalThis);
