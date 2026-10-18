// The arena: the hero's class and the bonuses bought for stars (0.9). A class brings its
// starting weapon, its stats and an ability on a key; the bonuses add to the stats. No DOM
// here: tests run it in jsc through game.js.
//   const kit = LCSClasses.create(B, s, hooks, {cls: "devops", perks: {hp: 2}});
//   kit.start()          // a new run (not the next stage of a campaign): weapon, stats, bonuses
//   kit.use()            // the ability, when it is ready; true when it went off
//   kit.update(dt, input)
//   kit.crit(enemy)      // the multiplier of a hit: the tester's critical hits
//   LCSClasses.byId(B, id), LCSClasses.isOpen(B, id, got)   // for the menu
// hooks: random(), effect(fx), text(x, y, value, color, life), tr(ru, en), pushOut(p, r, solid)
// The ability's state is in s.cls: {id, ability, ready (the time it can go again), until
// (the time its effect ends), cooldown}.
"use strict";

(function (root) {
  const byId = (B, id) => B.classes.find((c) => c.id === id) || B.classes[0];
  const isOpen = (B, id, got) => {
    const c = B.classes.find((x) => x.id === id);
    return Boolean(c) && (!c.unlock || Boolean(got && got[c.unlock]));
  };
  // The stars' bonus levels a save holds, each within its price list.
  const perkLevel = (perk, perks) => Math.max(0, Math.min(perk.cost.length, (perks && perks[perk.id]) | 0));

  function create(B, s, hooks, options) {
    const o = options || {};
    const cls = byId(B, o.cls), A = cls.ability || null;
    const {random, effect, text, tr, pushOut} = hooks;
    s.cls = {id: cls.id, ability: A ? A.id : null, ready: 0, until: 0, cooldown: A ? A.cooldown : 0};
    if (A) s.met.ability = true;
    const trail = [];          // the rollback: where the player was and the health, by time
    let heading = {x: 1, y: 0}, dash = null;

    function start() {
      for (const [k, v] of Object.entries(cls.stats || {})) s.stats[k] *= v;
      for (const perk of B.stars.perks) {
        const n = perkLevel(perk, o.perks);
        if (!n) continue;
        if (perk.stat === "rerolls") s.rerolls += perk.add * n;
        else if (perk.mul) s.stats[perk.stat] *= perk.mul ** n;
        else s.stats[perk.stat] += perk.add * n;
      }
      if (cls.weapon) s.weapons.push({id: cls.weapon, level: 1, evolved: false, timer: 0});
      s.player.hp = s.stats.max_hp;
    }

    const ACTIONS = {
      dash(p) {
        dash = {x: heading.x, y: heading.y};
        effect({type: "ring", x: p.x, y: p.y, r: 10, color: "#ff6ad5", life: 0.25});
      },
      turret(p) {
        s.turrets.push({x: p.x, y: p.y, born: s.time, until: s.time + A.seconds, cooldown: 0, aim: p.aim,
                        color: "#ff6ad5", firedAt: -1, own: true});
        const own = s.turrets.filter((t) => t.own);
        if (own.length > A.max) s.turrets.splice(s.turrets.indexOf(own[0]), 1);
        effect({type: "ring", x: p.x, y: p.y, r: 12, color: "#ff6ad5", life: 0.3});
      },
      rollback(p) {
        const back = trail.find((x) => x.t >= s.time - A.back) || {x: p.x, y: p.y, hp: p.hp};
        effect({type: "ring", x: p.x, y: p.y, r: 14, color: "#7fe0e0", life: 0.35});
        p.x = back.x;
        p.y = back.y;
        pushOut(p, p.r, true);
        p.hp = Math.min(s.stats.max_hp, Math.max(p.hp, back.hp));
        p.invulnerable = Math.max(p.invulnerable, A.invulnerable);
        effect({type: "ring", x: p.x, y: p.y, r: 18, color: "#7fe0e0", life: 0.45});
        trail.length = 0;
      },
      test_run(p) {
        text(p.x, p.y - 16, tr("ПРОГОН ТЕСТОВ", "TEST RUN"), "#ffd84a", 1.5);
      },
      // Crystals fly in on their own once pulled; items land at the player's feet.
      google(p) {
        for (const g of s.gems) g.pull = true;
        for (const it of s.items) {
          it.x = p.x;
          it.y = p.y;
        }
        effect({type: "ring", x: p.x, y: p.y, r: 60, color: "#e8c14a", life: 0.5});
      },
    };

    function use() {
      const p = s.player;
      if (!A || s.over || s.choices || p.dead || s.time < s.cls.ready) return false;
      s.cls.ready = s.time + A.cooldown;
      s.cls.until = s.time + (A.seconds || 0);
      ACTIONS[A.id](p);
      return true;
    }

    function update(dt, input) {
      const p = s.player;
      if (input && (input.x || input.y)) {
        const d = Math.hypot(input.x, input.y);
        heading = {x: input.x / d, y: input.y / d};
      }
      if (!A) return;
      if (A.id === "rollback") {
        trail.push({t: s.time, x: p.x, y: p.y, hp: p.hp});
        while (trail.length && trail[0].t < s.time - A.back - 0.5) trail.shift();
      }
      if (!dash) return;
      if (p.dead || s.time >= s.cls.until) { dash = null; return; }
      const v = A.distance / A.seconds, W = s.map.width, H = s.map.height;
      p.x = Math.max(p.r, Math.min(W - p.r, p.x + dash.x * v * dt));
      p.y = Math.max(p.r, Math.min(H - p.r, p.y + dash.y * v * dt));
      pushOut(p, p.r, true);
      p.invulnerable = Math.max(p.invulnerable, s.cls.until - s.time);
    }

    function crit(e) {
      if (!cls.crit) return 1;
      const sure = A && A.id === "test_run" && s.time < s.cls.until;
      if (!sure && random() >= cls.crit.chance) return 1;
      s.crits = (s.crits || 0) + 1;
      effect({type: "ring", x: e.x, y: e.y, r: e.r + 3, color: "#ffd84a", life: 0.2});
      return cls.crit.mul;
    }

    return {start, use, update, crit};
  }

  root.LCSClasses = {create, byId, isOpen, perkLevel};
})(typeof window !== "undefined" ? window : globalThis);
