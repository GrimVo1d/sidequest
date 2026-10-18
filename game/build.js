// The arena: the player's build. Experience and level-ups with their three cards (weapons,
// passives, evolutions, reroll and banish), and chests with gear. No DOM here: tests run it
// in jsc through game.js.
//   const build = LCSBuild.create(B, s, hooks);
//   build.addXp(n), build.choose(i), build.reroll(), build.banish(i), build.nextChoice()
//   build.chestLeft()   // a chest still has something to give
//   build.offers(), build.take(key)   // for the dev panel: what a level-up could bring, take one
// hooks: random(), text(x, y, value, color, life), effect(fx), tr(ru, en), mod(id),
//        magazine() (the pistol's magazine now), levelText(cfg, changes)
// Gear (0.8): a chest offers three pieces not taken yet. Once every usual piece is taken,
// it offers three of: a taken piece's next level (up to `chest.max_level`) and the rare
// pieces that come only from a chest. With nothing left, it gives score.
"use strict";

(function (root) {
  function create(B, s, hooks) {
    const {random, text, effect, tr, mod, magazine, levelText} = hooks;
    const WEAPONS = new Map(B.weapons.map((w) => [w.id, w]));
    const PASSIVES = new Map(B.upgrades.map((u) => [u.id, u]));
    const GEAR = new Map(B.gear.map((g) => [g.id, g]));
    const CH = B.chest;

    // --- level-ups ---------------------------------------------------------------------

    function addXp(n) {
      s.xp += n;
      while (s.xp >= s.xpNext) {
        s.xp -= s.xpNext;
        s.level++;
        s.pendingLevels++;
        s.xpNext = Math.round(s.xpNext * B.xp.growth);
        text(s.player.x, s.player.y - 16, tr(`УРОВЕНЬ ${s.level}`, `LEVEL ${s.level}`), "#e8c14a", 1.5);
      }
      if (s.pendingLevels && !s.choices) offerChoices();
    }

    // Everything a level-up could offer now: new levels of what the player has, new weapons
    // and passives while there are free slots, and evolutions. Keys are "kind:id".
    function offers() {
      const out = [], evolutions = [];
      const banned = (key) => s.banished.includes(key);
      const owned = new Set(s.weapons.map((w) => w.id));
      for (const w of s.weapons) {
        const cfg = WEAPONS.get(w.id);
        if (w.level <= cfg.levels.length) {
          if (!banned("weapon:" + w.id)) out.push("weapon:" + w.id);
        } else if (!w.evolved && s.taken[cfg.evolution.passive]) {
          evolutions.push("evolution:" + w.id);
        }
      }
      if (s.weapons.length < B.build.weapon_slots && !mod("pistol_only")) {
        for (const cfg of B.weapons) {
          if (!owned.has(cfg.id) && !banned("weapon:" + cfg.id)) out.push("weapon:" + cfg.id);
        }
      }
      const passives = Object.keys(s.taken).length;
      for (const u of B.upgrades) {
        const level = s.taken[u.id] || 0;
        if (banned("passive:" + u.id) || level >= (u.max_level || 5)) continue;
        if (!level && (passives >= B.build.passive_slots || (u.ally && !s.everAlly))) continue;
        out.push("passive:" + u.id);
      }
      return {evolutions, rest: out};
    }

    // A choice card: names and texts in both languages, the level it brings.
    function card(key) {
      const [kind, id] = key.split(":");
      if (kind === "passive") {
        const u = PASSIVES.get(id);
        return {key, kind, id, icon: id, name: u.name, name_en: u.name_en, text: u.text,
                text_en: u.text_en, level: (s.taken[id] || 0) + 1, fresh: !s.taken[id]};
      }
      const cfg = WEAPONS.get(id), w = s.weapons.find((x) => x.id === id);
      if (kind === "evolution") {
        const ev = cfg.evolution;
        return {key, kind, id, icon: id, name: ev.name, name_en: ev.name_en, text: ev.text,
                text_en: ev.text_en, level: null};
      }
      if (!w) {
        return {key, kind, id, icon: id, name: cfg.name, name_en: cfg.name_en, text: cfg.text,
                text_en: cfg.text_en, level: 1, fresh: true};
      }
      const [ru, en] = levelText(cfg, cfg.levels[w.level - 1]);
      return {key, kind, id, icon: id, name: cfg.name, name_en: cfg.name_en, text: ru, text_en: en,
              level: w.level + 1};
    }

    // Up to `n` distinct things from `list`, in a random order.
    function pick(list, n) {
      const rest = list.slice(), out = [];
      while (out.length < n && rest.length) out.push(rest.splice(Math.floor(random() * rest.length), 1)[0]);
      return out;
    }

    // Three cards; evolutions always make it. Nothing left to take: a coffee break.
    function offerChoices() {
      const {evolutions, rest} = offers();
      const picked = evolutions.slice(0, 3).concat(pick(rest, 3 - Math.min(3, evolutions.length)));
      const F = B.build.filler;
      s.choices = picked.length ? picked.map(card)
        : [{key: "filler", kind: "filler", id: "filler", icon: "medkit", level: null,
            name: "Кофе-брейк", name_en: "Coffee break",
            text: `+${F.heal} к здоровью и +${F.score} очков`,
            text_en: `+${F.heal} health and +${F.score} score`}];
      s.choiceKind = "level";
    }

    // --- chests and gear ----------------------------------------------------------------

    const level = (id) => s.gearLevels[id] || 0;
    const usual = () => B.gear.filter((g) => !g.rare && !level(g.id));

    // What a chest could offer now, as gear ids: new usual pieces first; then next levels and
    // the rare pieces.
    function chestPool() {
      const fresh = usual();
      if (fresh.length) return fresh.map((g) => g.id);
      return B.gear.filter((g) => (level(g.id) ? level(g.id) < CH.max_level : g.rare)).map((g) => g.id);
    }
    const chestLeft = () => chestPool().length > 0;

    function gearCard(id) {
      const g = GEAR.get(id), next = level(id) + 1;
      const up = next > 1;
      return {key: "gear:" + id, kind: "gear", id, icon: id, gear: true, rare: Boolean(g.rare),
              level: next, name: g.name, name_en: g.name_en,
              text: up ? g.up.text : g.text, text_en: up ? g.up.text_en : g.text_en};
    }

    function offerChest() {
      const pool = chestPool();
      if (!pool.length) {
        s.pendingChests = 0;
        s.score += B.classic.empty_chest_score;
        text(s.player.x, s.player.y - 16, `+${B.classic.empty_chest_score}`, "#e8c14a");
        return;
      }
      s.choices = pick(pool, 3).map(gearCard);
      s.choiceKind = "chest";
    }

    function nextChoice() {
      if (s.pendingChests > 0) offerChest();
      if (!s.choices && s.pendingLevels > 0) offerChoices();
    }

    // The piece's own effect the first time, its `up` effect on every next level.
    function applyGear(id) {
      const g = GEAR.get(id), p = s.player;
      const fx = level(id) ? g.up : g;
      if (!level(id)) s.gear.push(id);
      s.gearLevels[id] = level(id) + 1;
      if (fx.mul) s.stats[g.stat] *= fx.mul;
      if (fx.add) s.stats[g.stat] += fx.add;
      if (g.stat === "max_hp" && !p.dead) p.hp += fx.add || 0;
      if (fx.heal && !p.dead) p.hp = s.stats.max_hp;
      if (fx.shield) p.shield += fx.shield;
      const name = tr(g.name, g.name_en) + (level(id) > 1 ? " " + level(id) : "");
      text(p.x, p.y - 16, name, "#e8c14a", 2);
    }

    function applyUpgrade(u) {
      s.taken[u.id] = (s.taken[u.id] || 0) + 1;
      if (u.mul) s.stats[u.stat] *= u.mul;
      if (u.add) s.stats[u.stat] += u.add;
      if (u.stat === "max_hp" && !s.player.dead) s.player.hp += u.add || 0;
      if (u.heal && !s.player.dead) s.player.hp = s.stats.max_hp;
    }

    function applyCard(c) {
      const p = s.player;
      const before = magazine();
      if (c.kind === "passive") {
        applyUpgrade(PASSIVES.get(c.id));
      } else if (c.kind === "weapon") {
        const w = s.weapons.find((x) => x.id === c.id);
        if (w) w.level++;
        else s.weapons.push({id: c.id, level: 1, evolved: false, timer: 0});
      } else if (c.kind === "evolution") {
        s.weapons.find((x) => x.id === c.id).evolved = true;
        s.evolutions++;
        effect({type: "ring", x: p.x, y: p.y, r: 60, color: "#e8c14a", life: 0.6});
        text(p.x, p.y - 22, tr(c.name, c.name_en), "#e8c14a", 2.5);
      } else if (c.kind === "filler") {
        if (!p.dead) p.hp = Math.min(s.stats.max_hp, p.hp + B.build.filler.heal);
        s.score += B.build.filler.score;
      }
      // A bigger magazine is filled right away.
      const more = magazine() - before;
      if (more > 0 && p.reload <= 0) p.ammo += more;
      p.magazine = magazine();
    }

    function choose(index) {
      if (!s.choices || !s.choices[index]) return false;
      const c = s.choices[index];
      if (s.choiceKind === "chest") {
        applyGear(c.id);
        s.pendingChests--;
      } else {
        applyCard(c);
        s.pendingLevels--;
      }
      s.choices = null;
      s.choiceKind = null;
      nextChoice();
      return true;
    }

    // Three new cards for a level-up, a few times a match.
    function reroll() {
      if (s.choiceKind !== "level" || s.rerolls <= 0) return false;
      s.rerolls--;
      offerChoices();
      return true;
    }

    // A card that should never come again this match; the others are dealt anew.
    function banish(index) {
      const c = s.choices && s.choices[index];
      if (s.choiceKind !== "level" || s.banishes <= 0 || !c) return false;
      if (c.kind !== "weapon" && c.kind !== "passive") return false;
      s.banishes--;
      s.banished.push(c.key);
      offerChoices();
      return true;
    }

    // The dev panel: a card by its key, taken at once.
    const take = (key) => applyCard(card(key));

    return {addXp, choose, reroll, banish, nextChoice, chestLeft, offers, take};
  }

  root.LCSBuild = {create};
})(typeof window !== "undefined" ? window : globalThis);
