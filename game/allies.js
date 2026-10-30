// The arena: the allies, the player's live agents (or a past session's ghost): an ally joins
// with its session, its tools turn into abilities, its Bash commands into commits, turrets,
// a shield or a red CI, its subagents into spirits around it; three or more agents make an
// orchestra. No DOM here: tests run it in jsc through game.js.
//   const allies = LCSAllies.create(B, s, mode, hooks);
//   allies.agentEvent(e)    // a game event from Sidequest.on("*"), when the mode takes agents
//   allies.update(dt)       // the ghost's events, the allies, the orchestra and the turrets
//   allies.leave(a, ult)    // an ally is done (`ult`: with its task done, a blast)
// mode: {classic, ownAgents, ghost} (game.js); hooks: random(), text(x, y, value, color, life),
//   effect(fx), tr(ru, en), nearby(x, y, r, fn), nearestEnemies(from, n, range, sight),
//   hurtEnemy(e, damage), explode(x, y, r, damage, color), drop(type, x, y, force), pickItem(),
//   addXp(n), terrain (terrain.js)
"use strict";

(function (root) {
  const ALLY_COLORS = ["#4fbf6f", "#5b8bd0", "#d07ad0", "#e89a4a", "#7fe0e0", "#e86a6a"];
  const REJOIN_KINDS = new Set(["session_start", "prompt", "tool", "tool_error",
                                "subagent_start", "compact"]);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function create(B, s, mode, hooks) {
    const A = B.abilities, AG = B.agent, I = B.items, W = s.map.width, H = s.map.height;
    const {classic, ownAgents, ghost} = mode;
    const {random, text, effect, tr, nearby, nearestEnemies, hurtEnemy, explode, drop, pickItem, addXp,
           terrain} = hooks;
    const {pushOut, clearPath} = terrain;
    const bySession = new Map();

    function ally(e, create) {
      let a = bySession.get(e.session);
      if (!a) {
        if (!create) return null;
        const slot = s.allies.length;
        a = {session: e.session, project: e.project || "?", color: ALLY_COLORS[slot % ALLY_COLORS.length],
             slot, x: s.player.x, y: s.player.y, r: B.ally.radius, state: "active", leave: 0,
             stun: 0, blocked: 0, meditate: 0, spirits: new Map(), actions: 0,
             waiting: false, waitingSince: null};
        bySession.set(e.session, a);
        s.allies.push(a);
        text(a.x, a.y - 12, a.project, a.color, 2);
      } else if (a.state !== "active" && create) {
        a.state = "active";
        a.x = s.player.x; a.y = s.player.y;
        text(a.x, a.y - 12, tr("снова в бою", "back in action"), a.color, 2);
      }
      if (a.state === "active") {
        s.everAlly = true;
        if (classic) s.withAgent = true;
        if (s.finaleAt !== null && !s.over) s.finaleAt = null;
      }
      return a;
    }

    const canAct = (a) => a.state === "active" && a.stun <= 0 && a.blocked <= 0 && a.meditate <= 0;
    // Everything the agents hit with; the orchestra makes it stronger.
    const allyDamage = () => s.stats.ally_damage * (s.orchestra ? AG.orchestra.ally_damage : 1);
    const agentXp = (n) => addXp(n * (s.orchestra ? AG.orchestra.xp : 1));
    const gitOps = (e) => (Array.isArray(e.git) ? e.git : []);

    function ability(a, src, e) {
      const st = s.stats;
      switch (e.action) {
        case "attack": {
          const lines = (e.lines_added || 0) + (e.lines_removed || 0);
          const damage = Math.min(A.attack.max_damage, A.attack.damage + A.attack.per_line * lines)
            * allyDamage();
          const n = A.attack.missiles + Math.round(st.ally_missiles);
          const targets = nearestEnemies(src, n, Infinity);
          for (let i = 0; i < n; i++) {
            const angle = random() * Math.PI * 2;
            s.shots.push({x: src.x, y: src.y, vx: Math.cos(angle) * A.attack.speed,
                          vy: Math.sin(angle) * A.attack.speed, r: 3, damage, pierce: 0,
                          hit: new Set(), life: 4, color: a.color,
                          target: targets.length ? targets[i % targets.length] : null});
          }
          break;
        }
        case "scout": {
          const radius = A.scout.radius * st.area;
          effect({type: "ring", x: src.x, y: src.y, r: radius, color: "#7fb3e0", life: 0.6});
          nearby(src.x, src.y, radius, (en) => {
            if (Math.hypot(en.x - src.x, en.y - src.y) <= radius) {
              en.slow = A.scout.seconds;
              en.slowFactor = A.scout.slow;
            }
          });
          break;
        }
        case "cast": {
          if (gitOps(e).includes("commit")) { commitBomb(a, src); break; }
          const cfg = e.category === "test" ? A.cast_test : A.cast;
          const target = nearestEnemies(src, 1, A.cast.range)[0] || src;
          explode(target.x, target.y, cfg.radius * st.area, cfg.damage * allyDamage(),
                  e.category === "test" ? "#e8c14a" : "#e89a4a");
          break;
        }
        case "scout_far": {
          const target = nearestEnemies(src, 1, Infinity)[0];
          const angle = target ? Math.atan2(target.y - src.y, target.x - src.x) : random() * Math.PI * 2;
          const dx = Math.cos(angle), dy = Math.sin(angle), len = Math.hypot(W, H);
          effect({type: "beam", x: src.x, y: src.y, x2: src.x + dx * len, y2: src.y + dy * len,
                  r: A.scout_far.width, color: "#7fe0e0", life: 0.4});
          for (const en of s.enemies) {
            const along = (en.x - src.x) * dx + (en.y - src.y) * dy;
            const across = Math.abs((en.x - src.x) * dy - (en.y - src.y) * dx);
            if (along > 0 && across <= A.scout_far.width / 2 + en.r) {
              hurtEnemy(en, A.scout_far.damage * allyDamage());
            }
          }
          break;
        }
        case "todo":
          break;
        case "summon":
          explode(src.x, src.y, A.generic.radius * 1.5 * st.area,
                  A.generic.damage * 2 * allyDamage(), a.color);
          break;
        default:
          explode(src.x, src.y, A.generic.radius * st.area, A.generic.damage * allyDamage(),
                  a.color);
      }
    }

    // --- the agent's real work: git, builds, tests, answers -------------------------

    function commitBomb(a, src) {
      const radius = AG.commit.radius * s.stats.area;
      effect({type: "ring", x: src.x, y: src.y, r: radius, color: "#e8c14a", life: 0.6});
      effect({type: "ring", x: src.x, y: src.y, r: radius * 0.6, color: "#fffbe0", life: 0.45});
      nearby(src.x, src.y, radius + 20, (en) => {
        if (Math.hypot(en.x - src.x, en.y - src.y) <= radius + en.r) {
          hurtEnemy(en, AG.commit.damage * allyDamage());
        }
      });
      text(a.x, a.y - 14, "COMMIT", "#e8c14a", 1.8);
      s.met.commit = true;
    }

    // A successful Bash command: what its category and git steps turn into.
    function bashDone(a, src, e) {
      const ops = gitOps(e);
      if (ops.includes("commit")) s.commits++;
      if (ops.includes("push")) {
        s.pushes++;
        if (s.time >= s.pushChestAt && s.finaleAt === null && s.endAt === null) {
          s.pushChestAt = s.time + AG.push.cooldown_seconds;
          drop("chest", a.x + 16, a.y + 10, true);
          text(a.x, a.y - 14, "PUSH", "#e8c14a", 1.8);
          s.met.push = true;
        }
      }
      if (e.category === "build") placeTurret(a, src);
      if (e.category === "test") {
        const p = s.player;
        p.shield = Math.max(p.shield, Math.min(AG.tests_passed.max_shield,
                                               p.shield + AG.tests_passed.shield));
        s.redCi = 0;
        text(a.x, a.y - 14, tr("ТЕСТЫ OK", "TESTS OK"), "#4fbf6f", 1.5);
        s.met.tests = true;
      }
    }

    function placeTurret(a, src) {
      const angle = random() * Math.PI * 2;
      const o = {x: clamp(src.x + Math.cos(angle) * 14, 8, W - 8), y: clamp(src.y + Math.sin(angle) * 14, 8, H - 8)};
      pushOut(o, 6, true);
      s.turrets.push({x: o.x, y: o.y, born: s.time, until: s.time + AG.turret.seconds, cooldown: 0,
                      aim: angle, color: a.color, firedAt: -1});
      while (s.turrets.length > AG.turret.max) s.turrets.shift();
      s.turretsBuilt++;
      effect({type: "ring", x: o.x, y: o.y, r: 12, color: a.color, life: 0.3});
      s.met.turret = true;
    }

    function updateTurrets(dt) {
      s.turrets = s.turrets.filter((t) => s.time < t.until);
      for (const t of s.turrets) {
        t.cooldown -= dt;
        if (t.cooldown > 0) continue;
        const target = nearestEnemies(t, 1, AG.turret.range, true)[0];
        if (!target) continue;
        t.aim = Math.atan2(target.y - t.y, target.x - t.x);
        t.firedAt = s.time;
        t.cooldown = AG.turret.cooldown;
        s.shots.push({x: t.x, y: t.y, vx: Math.cos(t.aim) * AG.turret.speed, vy: Math.sin(t.aim) * AG.turret.speed,
                      r: 2, damage: AG.turret.damage * allyDamage(), pierce: 0, hit: new Set(),
                      life: AG.turret.range / AG.turret.speed, color: "#e8c14a"});
      }
    }

    function redCi(a) {
      s.redCi = AG.red_ci.seconds;
      text(a.x, a.y - 22, tr("КРАСНЫЙ CI", "RED CI"), "#ff3030", 2);
      s.met.red_ci = true;
    }

    // The agent waited for an answer; one within a few seconds of real time earns a bonus.
    function answered(a, e) {
      const since = a.waitingSince;
      a.waiting = false;
      a.waitingSince = null;
      if (e.source || typeof e.ts !== "number" || typeof since !== "number") return;
      if (e.ts - since > AG.reviewer.answer_seconds || e.ts < since) return;
      s.reviews++;
      s.buffs.coffee = Math.max(s.buffs.coffee, AG.reviewer.coffee_seconds * s.stats.coffee);
      s.score += AG.reviewer.score * s.multiplier;
      text(a.x, a.y - 14, tr("БЫСТРЫЙ РЕВЬЮЕР", "FAST REVIEWER"), "#7fe0e0", 2);
      s.met.reviewer = true;
    }

    function spiritType(agentType) {
      const key = typeof agentType === "string" ? agentType.toLowerCase() : "";
      return Object.hasOwn(AG.spirits.types, key) ? AG.spirits.types[key] : "shooter";
    }

    // Three or more agents at once, the sessions and their subagents: the orchestra.
    function updateOrchestra() {
      let n = 0;
      for (const a of s.allies) if (a.state === "active") n += 1 + a.spirits.size;
      const on = n >= AG.orchestra.agents;
      if (on && !s.orchestra) {
        const p = s.player;
        text(p.x, p.y - 30, tr("ОРКЕСТР", "ORCHESTRA"), "#d07ad0", 2.5);
        effect({type: "ring", x: p.x, y: p.y, r: 60, color: "#d07ad0", life: 0.6});
        s.met.orchestra = true;
      }
      s.orchestra = on;
    }

    function leave(a, ult) {
      if (a.state !== "active") return;
      if (ult) {
        effect({type: "ult", x: a.x, y: a.y, r: Math.hypot(s.view.width, s.view.height),
                color: a.color, life: 0.8});
        for (const en of s.enemies) hurtEnemy(en, A.ult.damage);
        text(a.x, a.y - 14, tr("ЗАДАЧА ГОТОВА", "TASK DONE"), a.color, 2.5);
      }
      a.state = "leaving";
      a.leave = 1.5;
      a.waiting = false;
      a.spirits.clear();
      // A ghost between its tasks is not done yet: its recording goes on.
      const ghostDone = !ghost || ghost.index >= ghost.queue.length;
      if (!classic && ghostDone && s.allies.every((x) => x.state !== "active")) {
        s.finaleAt = s.time + B.finale.seconds;
      }
    }

    // A game event from Sidequest; the ghost and the daily task have no real agents.
    function agentEvent(e) {
      if (ownAgents) handleEvent(e);
    }

    // The ghost's events, each at its time.
    function updateGhost() {
      const q = ghost.queue;
      while (ghost.index < q.length && q[ghost.index].at <= s.time) handleEvent(q[ghost.index++].event);
      // The recording is over: the ghost finishes its task, the finale follows.
      const last = q.length ? q[q.length - 1].at : 0;
      if (ghost.index >= q.length && s.time >= last + B.ghost.end_after) {
        for (const a of s.allies) leave(a, true);
        if (s.finaleAt === null && s.endAt === null && s.allies.every((a) => a.state !== "active")) {
          s.finaleAt = s.time + B.finale.seconds;
        }
      }
    }

    function handleEvent(e) {
      if (s.over || !e || typeof e.session !== "string") return;
      const create = REJOIN_KINDS.has(e.kind);
      const a = ally(e, create);
      if (!a) return;
      const src = (e.agent && a.spirits.get(e.agent)) || a;
      switch (e.kind) {
        case "tool":
          a.actions++;
          agentXp(B.xp.per_action[Object.hasOwn(B.xp.per_action, e.action) ? e.action : "generic"]);
          if (canAct(a)) ability(a, src, e);
          if (e.tool === "Bash") bashDone(a, src, e);
          if (a.actions % I.ally_every_actions === 0 && s.finaleAt === null && s.endAt === null) {
            drop(pickItem(), a.x + (random() - 0.5) * 20, a.y + 12);
          }
          break;
        case "tool_error":
          a.actions++;
          agentXp(B.xp.error);
          if (!e.agent) {
            a.stun = B.ally.stun_seconds;
            text(a.x, a.y - 12, tr("ОШИБКА", "ERROR"), "#d9534f");
          }
          // Failed tests turn the CI red instead of the usual rage.
          if (e.category === "test") redCi(a);
          else {
            s.rage = B.rage.seconds * s.stats.rage;
            s.met.rage = true;
          }
          break;
        case "waiting":
          a.waiting = true;
          a.waitingSince = typeof e.ts === "number" ? e.ts : null;
          break;
        case "resumed":
          if (a.waiting) answered(a, e);
          break;
        case "blocked":
          a.blocked = B.ally.blocked_seconds;
          text(a.x, a.y - 12, tr("ЗАПРЕТ", "BLOCKED"), "#d9534f", 1.5);
          break;
        case "compact":
          a.meditate = e.phase === "end" ? 0 : B.ally.compact_max_seconds;
          break;
        case "subagent_start":
          if (e.agent && !a.spirits.has(e.agent)) {
            const type = spiritType(e.agent_type);
            a.spirits.set(e.agent, {x: a.x, y: a.y, angle: random() * Math.PI * 2, type,
                                    cooldown: 0, until: s.time + A.summon.max_seconds});
            s.met["spirit_" + type] = true;
          }
          break;
        case "subagent_stop":
          a.spirits.delete(e.agent);
          break;
        case "stop":
          if (e.final) leave(a, true);
          break;
        case "session_end":
          leave(a, false);
          break;
      }
    }

    function updateAllies(dt) {
      const p = s.player;
      for (const a of s.allies) {
        if (a.state === "gone") continue;
        if (a.state === "leaving") {
          a.leave -= dt;
          a.y -= 40 * dt;
          if (a.leave <= 0) a.state = "gone";
          continue;
        }
        a.stun = Math.max(0, a.stun - dt);
        a.blocked = Math.max(0, a.blocked - dt);
        a.meditate = Math.max(0, a.meditate - dt);
        const angle = a.slot * 2.4 + Math.PI * 0.75;
        let tx = p.x + Math.cos(angle) * B.ally.follow_distance;
        let ty = p.y + Math.sin(angle) * B.ally.follow_distance;
        // A wall in the way: around it along the enemies' path to the player.
        if (!terrain.flat && !clearPath(a, tx, ty, a.r)) {
          terrain.updateFlow(p);
          const w = terrain.waypoint(a, p);
          tx = w.x;
          ty = w.y;
        }
        const d = Math.hypot(tx - a.x, ty - a.y);
        if (d > 1 && a.stun <= 0) {
          const step = Math.min(d, B.ally.speed * dt * Math.max(1, d / 40));
          a.x += (tx - a.x) / d * step;
          a.y += (ty - a.y) / d * step;
        }
        pushOut(a, a.r, true);
        a.x = clamp(a.x, a.r, W - a.r);
        a.y = clamp(a.y, a.r, H - a.r);
        for (const [id, sp] of a.spirits) {
          if (s.time > sp.until) { a.spirits.delete(id); continue; }
          sp.angle += 3 * dt;
          sp.x = a.x + Math.cos(sp.angle) * A.summon.orbit;
          sp.y = a.y + Math.sin(sp.angle) * A.summon.orbit;
          sp.cooldown -= dt;
          if (sp.cooldown <= 0) spiritAct(a, sp);
        }
      }
    }

    // A subagent's spirit: Explore slows the enemies around it, Plan heals the player,
    // every other type shoots.
    function spiritAct(a, sp) {
      const SP = AG.spirits;
      if (sp.type === "scout") {
        const radius = SP.scout.radius * s.stats.area;
        effect({type: "ring", x: sp.x, y: sp.y, r: radius, color: "#7fb3e0", life: 0.5});
        nearby(sp.x, sp.y, radius + 20, (en) => {
          if (Math.hypot(en.x - sp.x, en.y - sp.y) <= radius + en.r) {
            en.slow = SP.scout.seconds;
            en.slowFactor = SP.scout.slow;
          }
        });
        sp.cooldown = SP.scout.every;
      } else if (sp.type === "plan") {
        const p = s.player;
        sp.cooldown = SP.plan.every;
        if (p.dead || p.hp >= s.stats.max_hp) return;
        const before = p.hp;
        p.hp = Math.min(s.stats.max_hp, p.hp + SP.plan.heal);
        text(p.x, p.y - 14, `+${Math.round(p.hp - before)}`, "#4fbf6f", 0.8);
        effect({type: "beam", x: sp.x, y: sp.y, x2: p.x, y2: p.y, r: 1, color: "#4fbf6f", life: 0.25});
      } else {
        const t = nearestEnemies(sp, 1, A.summon.range, true)[0];
        if (!t) return;
        const angle = Math.atan2(t.y - sp.y, t.x - sp.x);
        s.shots.push({x: sp.x, y: sp.y, vx: Math.cos(angle) * 200, vy: Math.sin(angle) * 200,
                      r: 2, damage: A.summon.damage * allyDamage(), pierce: 0,
                      hit: new Set(), life: 1, color: a.color});
        sp.cooldown = A.summon.cooldown;
      }
    }

    function update(dt) {
      if (ghost) updateGhost();
      updateAllies(dt);
      updateOrchestra();
      updateTurrets(dt);
    }

    return {agentEvent, update, leave};
  }

  root.LCSAllies = {create};
})(typeof window !== "undefined" ? window : globalThis);
