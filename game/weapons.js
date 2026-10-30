// The arena: the player's weapons (balance.weapons): their numbers with levels, evolution,
// passives, gear and buffs, and how each one fires. No DOM here: tests run it in jsc
// through game.js.
//   const weapons = LCSWeapons.create(B, s, hooks);
//   weapons.weaponStats(w)    // a weapon's numbers now
//   weapons.updateWeapons(dt) // every weapon the player carries fires or waits
//   weapons.updateMines()     // the mines on the floor go off under enemies or in time
// hooks: random(), effect(fx), hurtEnemy(e, damage), explode(x, y, r, damage, color),
//        nearby(x, y, r, fn), nearestEnemies(from, n, range, sight), and the terrain's
//        pushOut, toWall, inSight, firstInSight (terrain.js)
"use strict";

(function (root) {
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  function create(B, s, hooks) {
    const WEAPONS = new Map(B.weapons.map((w) => [w.id, w])), I = B.items;
    const {MUL_KEYS} = root.LCSBuild;   // weapon stats that multiply rather than add
    const {random, effect, hurtEnemy, explode, nearby, nearestEnemies, pushOut, toWall, inSight,
           firstInSight} = hooks;
    function applyChanges(o, changes) {
      for (const [k, v] of Object.entries(changes)) o[k] = MUL_KEYS.has(k) ? o[k] * v : (o[k] || 0) + v;
    }

    // A weapon's numbers: its base, its levels and evolution, then passives, gear and buffs.
    function weaponStats(w) {
      const cfg = WEAPONS.get(w.id), st = s.stats;
      const o = Object.assign({area: 1, duration: 1, count: 1}, cfg.base);
      for (let i = 0; i < w.level - 1; i++) applyChanges(o, cfg.levels[i]);
      if (w.evolved) applyChanges(o, cfg.evolution.changes);
      const fast = s.buffs.coffee > 0 ? I.coffee.fire : 1;
      o.damage *= st.damage;
      o.cooldown *= st.cooldown * fast;
      o.count = Math.max(1, Math.round(o.count + st.amount));
      o.area *= st.area;
      o.pierce = Math.round((o.pierce || 0) + st.pierce) + (s.buffs.duck > 0 ? I.duck.pierce : 0);
      if (o.magazine !== undefined) {
        o.magazine = Math.round(o.magazine + st.magazine);
        o.reload *= st.reload * fast;
      }
      return o;
    }

    // An enemy is hit by the same blade or pulse at most once every `every` seconds.
    function ready(e, id, every) {
      const hits = e.hitAt || (e.hitAt = {});
      if (hits[id] > s.time) return false;
      hits[id] = s.time + every;
      return true;
    }

    function startReload(o) {
      const p = s.player;
      // `while (true)`: no reload at all.
      if (o.reload <= 0.01) { p.ammo = o.magazine; return; }
      p.reload = p.reloadTotal = o.reload;
    }

    // The pistol fires on its own while there are rounds in the magazine, then reloads.
    // With no target in range a partly spent magazine is reloaded right away.
    function updatePistol(w, o, dt) {
      const p = s.player;
      p.magazine = o.magazine;
      w.timer -= dt;
      if (p.reload > 0) {
        p.reload -= dt;
        if (p.reload <= 0) { p.reload = 0; p.ammo = o.magazine; }
      } else if (w.timer <= 0) {
        if (firePistol(o)) {
          w.timer = o.cooldown;
          if (--p.ammo <= 0) startReload(o);
        } else if (p.ammo < o.magazine) {
          startReload(o);
        }
      }
    }

    // Shots in flight are counted against their target (`incoming`), so a quick burst
    // spreads over the crowd instead of piling into one enemy that is already done for.
    function firePistol(o) {
      const p = s.player, n = o.count, r2 = o.range * o.range;
      const near = s.enemies.filter((e) => !e.dead && e.incoming < e.hp && dist2(e, p) <= r2)
        .sort((a, b) => dist2(a, p) - dist2(b, p));
      const targets = firstInSight(near, p, n);
      if (!targets.length) return false;
      p.aim = Math.atan2(targets[0].y - p.y, targets[0].x - p.x);
      p.firedAt = s.time;
      for (let i = 0; i < n; i++) {
        const t = targets[i % targets.length];
        let angle = Math.atan2(t.y - p.y, t.x - p.x);
        if (i >= targets.length) angle += (i - targets.length + 1) * 0.25 * (i % 2 ? 1 : -1);
        s.shots.push({x: p.x, y: p.y, vx: Math.cos(angle) * o.speed, vy: Math.sin(angle) * o.speed,
                      r: o.radius * o.area, damage: o.damage, pierce: o.pierce, hit: new Set(),
                      life: o.range / o.speed + 0.2, color: "#e8d36a", aim: t});
        t.incoming += o.damage;
      }
      return true;
    }

    // `--force`: a fan of pellets at the nearest enemy.
    function fireShotgun(w, o) {
      const p = s.player, t = nearestEnemies(p, 1, o.range, true)[0];
      if (!t) return false;
      const base = Math.atan2(t.y - p.y, t.x - p.x), n = o.count;
      for (let i = 0; i < n; i++) {
        const angle = base + (n > 1 ? (i / (n - 1) - 0.5) * o.spread : 0);
        s.shots.push({x: p.x, y: p.y, vx: Math.cos(angle) * o.speed, vy: Math.sin(angle) * o.speed,
                      r: o.radius * o.area, damage: o.damage, pierce: o.pierce, hit: new Set(),
                      life: o.range / o.speed, color: w.evolved ? "#e8c14a" : "#e89a4a"});
      }
      effect({type: "ring", x: p.x + Math.cos(base) * 8, y: p.y + Math.sin(base) * 8, r: 6,
              color: "#e89a4a", life: 0.15});
      return true;
    }

    // A straight beam that hurts everyone along it, up to the first wall.
    function beam(x, y, angle, length, width, damage, color) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      length = toWall(x, y, dx, dy, length);
      effect({type: "beam", x, y, x2: x + dx * length, y2: y + dy * length, r: width, color,
              life: 0.3});
      for (const e of s.enemies) {
        if (e.dead) continue;
        const along = (e.x - x) * dx + (e.y - y) * dy;
        const across = Math.abs((e.x - x) * dy - (e.y - y) * dx);
        if (along > 0 && along < length + e.r && across <= width / 2 + e.r) hurtEnemy(e, damage);
      }
    }

    // `grep`: a beam through everyone in line, one per target.
    function fireLaser(w, o) {
      const p = s.player, targets = nearestEnemies(p, o.count, o.range, true);
      if (!targets.length) return false;
      const first = Math.atan2(targets[0].y - p.y, targets[0].x - p.x);
      for (let i = 0; i < o.count; i++) {
        // Beams without a target of their own fan out evenly around the first one.
        const t = targets[i];
        const angle = t ? Math.atan2(t.y - p.y, t.x - p.x) : first + i / o.count * Math.PI * 2;
        beam(p.x, p.y, angle, o.range, o.radius * 2 * o.area, o.damage,
             w.evolved ? "#e8c14a" : "#e84a8a");
      }
      return true;
    }

    // Linters circle the player for `duration`, then rest for `cooldown` (never, evolved).
    function updateLinters(w, o, dt) {
      const p = s.player;
      if (o.cooldown <= 0.01) {
        w.on = true;
      } else {
        w.timer -= dt;
        if (w.timer <= 0) {
          w.on = !w.on;
          w.timer = w.on ? o.duration : o.cooldown;
        }
      }
      w.blades = [];
      if (!w.on || p.dead) return;
      w.angle = (w.angle || 0) + o.spin * dt;
      const orbit = o.orbit * o.area, size = o.radius * o.area;
      for (let i = 0; i < o.count; i++) {
        const a = w.angle + i / o.count * Math.PI * 2;
        const b = {x: p.x + Math.cos(a) * orbit, y: p.y + Math.sin(a) * orbit, r: size};
        w.blades.push(b);
        nearby(b.x, b.y, size + 20, (e) => {
          if (Math.hypot(e.x - b.x, e.y - b.y) <= size + e.r && ready(e, w.id, o.hit_every)) {
            hurtEnemy(e, o.damage);
          }
        });
      }
    }

    // `rm -rf`: mines are left where the player walks; an enemy steps on one, it blows up.
    function fireMines(w, o) {
      const p = s.player;
      for (let i = 0; i < o.count && s.mines.length < o.max; i++) {
        const angle = random() * Math.PI * 2, d = i ? 8 + random() * 16 : 0;
        const m = {x: p.x + Math.cos(angle) * d, y: p.y + Math.sin(angle) * d, r: o.radius * o.area,
                   damage: o.damage, trigger: o.trigger, armAt: s.time + o.arm,
                   until: s.time + o.life, evolved: w.evolved};
        pushOut(m, 4, true);
        s.mines.push(m);
      }
      return true;
    }

    function updateMines() {
      for (const m of s.mines) {
        let boom = s.time >= m.until;
        if (!boom && s.time >= m.armAt) {
          nearby(m.x, m.y, m.trigger + 20, (e) => {
            if (Math.hypot(e.x - m.x, e.y - m.y) <= m.trigger + e.r) boom = true;
          });
        }
        if (boom) {
          m.done = true;
          explode(m.x, m.y, m.r, m.damage, m.evolved ? "#e8c14a" : "#e89a4a");
        }
      }
      s.mines = s.mines.filter((m) => !m.done);
    }

    // A regex: lightning hits an enemy and jumps to the nearest one not hit yet; neither
    // the strike nor a jump goes through a wall.
    function fireRegex(w, o) {
      const p = s.player, hit = new Set(), jump = o.jump * o.area;
      const first = nearestEnemies(p, o.count, o.range, true);
      for (const start of first) {
        if (hit.has(start)) continue;
        const points = [{x: p.x, y: p.y}];   // from where the sight was checked
        let target = start;
        for (let j = 0; j < o.chain && target; j++) {
          hit.add(target);
          points.push({x: target.x, y: target.y});
          hurtEnemy(target, o.damage);
          let best = null, bestD = jump * jump;
          nearby(target.x, target.y, jump, (e) => {
            const d = dist2(e, target);
            if (!hit.has(e) && d < bestD && inSight(target, e)) { bestD = d; best = e; }
          });
          target = best;
        }
        effect({type: "bolt", points, color: w.evolved ? "#e8c14a" : "#7fe0e0", life: 0.25});
      }
      return first.length > 0;
    }

    // Ping: pulses around the player, `count` of them one after another.
    function updatePing(w, o, dt) {
      const p = s.player;
      w.timer -= dt;
      if (w.pulses > 0 && s.time >= w.nextPulse) {
        w.pulses--;
        w.nextPulse = s.time + 0.2;
        const r = o.radius * o.area;
        effect({type: "ring", x: p.x, y: p.y, r, color: w.evolved ? "#e8c14a" : "#5bd0e8",
                life: 0.3});
        nearby(p.x, p.y, r + 20, (e) => {
          if (Math.hypot(e.x - p.x, e.y - p.y) > r + e.r) return;
          hurtEnemy(e, o.damage);
          if (o.slow > 0) { e.slow = o.slow_seconds; e.slowFactor = 1 - o.slow; }
        });
      }
      if (w.timer > 0 || p.dead) return;
      const r = o.radius * o.area;
      if (!nearestEnemies(p, 1, r + 10).length) return;
      w.timer = o.cooldown;
      w.pulses = o.count;
      w.nextPulse = s.time;
    }

    // Cron: strikes from the sky at random enemies on screen.
    function fireCron(w, o) {
      const p = s.player, hw = s.view.width / 2, hh = s.view.height / 2;
      const pool = s.enemies.filter((e) => !e.dead && Math.abs(e.x - p.x) < hw && Math.abs(e.y - p.y) < hh);
      if (!pool.length) return false;
      const r = o.radius * o.area;
      for (let i = 0; i < o.count; i++) {
        const t = pool[Math.floor(random() * pool.length)];
        effect({type: "strike", x: t.x, y: t.y, r, color: w.evolved ? "#e8c14a" : "#c8a8ff",
                life: 0.35});
        nearby(t.x, t.y, r + 20, (e) => {
          if (Math.hypot(e.x - t.x, e.y - t.y) <= r + e.r) hurtEnemy(e, o.damage);
        });
      }
      return true;
    }

    const FIRE = {shotgun: fireShotgun, laser: fireLaser, mines: fireMines, regex: fireRegex,
                  cron: fireCron};

    function updateWeapons(dt) {
      for (const w of s.weapons) {
        const o = weaponStats(w);
        if (w.id === "pistol") updatePistol(w, o, dt);
        else if (w.id === "linters") updateLinters(w, o, dt);
        else if (w.id === "ping") updatePing(w, o, dt);
        else {
          w.timer -= dt;
          // No target: try again on the next step.
          if (w.timer <= 0 && FIRE[w.id](w, o)) w.timer = o.cooldown;
        }
      }
    }

    return {weaponStats, updateWeapons, updateMines};
  }

  root.LCSWeapons = {create};
})(typeof window !== "undefined" ? window : globalThis);
