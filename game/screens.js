// The arena: the menu's screens about the player's progress — achievements, the class
// picker, the stars with their bonuses and the collection — and the ability's HUD chip.
// Saves are read and written by main.js; this file only draws, and data goes in as text.
//   const screens = LCSScreens.create({balance, el, clear, iconCanvas, clock});
//   screens.achievements(got)              // the menu's count and the latest one
//   screens.awards({records, got, bests})  // the achievements screen
//   screens.classes(cls, got, pick)        // the class picker; pick(id) on a click
//   screens.ghosts(shown, list, id, records, pick)   // past sessions for a ghost match
//   screens.trials(shown, id, records, pick)   // the trials' list (trials.js); pick(id) on a click
//   screens.stars(meta, buy)               // the stars screen; buy(id) on a click
//   screens.found(entry, meta)             // the handbook: has this weapon been found
//   screens.abilityChip(state)             // {id, icon, cls, text} for the HUD, or null
"use strict";

(function (root) {
  const $ = (id) => document.getElementById(id);

  function create({balance, el, clear, iconCanvas, clock}) {
    const t = SidequestI18n.t, tf = SidequestI18n.field;
    const KEY = ["Пробел", "Space"];

    // --- achievements ---------------------------------------------------------------

    // When an achievement was earned, in milliseconds: the game saves Date.now(); old saves
    // may hold {at} in seconds. 0 when the save holds no time.
    function earnedAt(v) {
      if (typeof v === "number") return v;
      return v && Number.isFinite(v.at) ? v.at * 1000 : 0;
    }

    // The earned achievements, the latest first.
    function earnedList(got) {
      return balance.achievements.filter((a) => got[a.id])
        .sort((a, b) => earnedAt(got[b.id]) - earnedAt(got[a.id]));
    }

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function earnedDay(v) {
      const ms = earnedAt(v);
      if (!ms) return t("получена", "earned");
      const d = new Date(ms), day = String(d.getDate()).padStart(2, "0");
      return t(`получена ${day}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`,
               `earned ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`);
    }

    function progressText(p) {
      const n = (v) => (p.field === "time" ? clock(v) : String(v));
      const of = p.field === "daily_streak" ? t("дней подряд", "days in a row")
        : p.field === "trials_done" ? t("пройдено", "passed")
        : p.of === "match" ? t("лучший матч", "best match") : t("всего", "so far");
      return `${of}: ${n(p.have)} / ${n(p.need)}`;
    }

    // The menu shows the count and the latest one; all of them are on the achievements screen.
    function achievements(got) {
      const list = $("achievements");
      clear(list);
      const earned = earnedList(got);
      for (const a of earned.slice(0, 1)) {
        const li = el("li", null, "got");
        li.appendChild(el("span", tf(a, "name"), "name"));
        li.appendChild(el("span", tf(a, "text"), "text"));
        list.appendChild(li);
      }
      $("achievements-none").hidden = earned.length > 0;
      $("achievements-count").textContent = `${earned.length}/${balance.achievements.length}`;
    }

    // Every achievement with its icon: the earned ones first with the day, then the locked
    // ones, the closest first, with how far they are when there is something to count.
    function awards({records, got, bests}) {
      const list = $("awards-list");
      clear(list);
      const earned = earnedList(got);
      const share = (x) => (x.p ? x.p.have / x.p.need : -1);
      const locked = balance.achievements.filter((a) => !got[a.id])
        .map((a) => ({a, p: LCSProgress.progressOf(a, records, bests, LCSProgress.known(balance, LCS_MAPS))}))
        .sort((x, y) => share(y) - share(x));
      const item = (a, done, note, p) => {
        const li = el("li", null, done ? "got" : "");
        const icon = el("div", null, "icon");
        icon.appendChild(iconCanvas(a.icon, 40));
        li.appendChild(icon);
        const body = el("div", null, "body");
        body.appendChild(el("div", tf(a, "name"), "name"));
        body.appendChild(el("div", tf(a, "text"), "text"));
        // A class this achievement opens is said right under it.
        const opens = balance.classes.filter((c) => c.unlock === a.id).map((c) => tf(c, "name"));
        const unlocks = opens.length ? ` · ${t("открывает класс", "unlocks the class")} ${opens.join(", ")}` : "";
        body.appendChild(el("div", note + unlocks, "when"));
        if (p) {
          const meter = el("div", null, "meter"), fill = el("div");
          fill.style.width = Math.round(100 * p.have / p.need) + "%";
          meter.appendChild(fill);
          body.appendChild(meter);
        }
        li.appendChild(body);
        list.appendChild(li);
      };
      for (const a of earned) item(a, true, earnedDay(got[a.id]), null);
      for (const {a, p} of locked) item(a, false, p ? progressText(p) : t("ещё не получена", "not earned yet"), p);
      $("awards-count").textContent = `${earned.length}/${balance.achievements.length}`;
    }

    // --- classes ----------------------------------------------------------------------

    function abilityText(c) {
      const A = c.ability;
      if (!A) return "";
      return ` ${t("Способность", "Ability")} (${t(...KEY)}): ${tf(A, "name")} — ${tf(A, "text")}, `
        + t(`раз в ${A.cooldown} сек.`, `every ${A.cooldown} sec.`);
    }

    // Locked classes stay in the row, greyed, with the achievement that opens them.
    function classes(current, got, pick) {
      const box = $("classes");
      clear(box);
      for (const c of balance.classes) {
        const open = LCSClasses.isOpen(balance, c.id, got);
        const b = el("button", tf(c, "name"), "mod" + (c.id === current ? " on" : "") + (open ? "" : " locked"));
        b.disabled = !open;
        if (!open) {
          const a = balance.achievements.find((x) => x.id === c.unlock);
          b.title = t("Откроется за ачивку «", "Unlocks with the achievement \"") + tf(a, "name")
            + t("»: ", "\": ") + tf(a, "text");
        }
        b.addEventListener("click", () => pick(c.id));
        box.appendChild(b);
      }
      const c = LCSClasses.byId(balance, current);
      $("class-text").textContent = `${tf(c, "name")}: ${tf(c, "text")}${abilityText(c)}`;
    }

    // --- stars and the collection ------------------------------------------------------

    function stars(meta, buy) {
      $("stars-count").textContent = `★ ${meta.stars}`;
      const list = $("perks");
      clear(list);
      for (const p of balance.stars.perks) {
        const level = meta.perks[p.id] || 0, price = LCSMeta.price(balance, meta, p.id);
        const li = el("li");
        const body = el("div", null, "body");
        body.appendChild(el("div", tf(p, "name"), "name"));
        body.appendChild(el("div", `${tf(p, "text")} ${t("за уровень", "per level")}`, "text"));
        body.appendChild(el("div", "■".repeat(level) + "□".repeat(p.cost.length - level), "pips"));
        li.appendChild(body);
        const b = el("button", price === null ? t("Всё куплено", "Maxed") : `${t("Купить", "Buy")} · ★ ${price}`);
        b.disabled = price === null || meta.stars < price;
        b.addEventListener("click", () => buy(p.id));
        li.appendChild(b);
        list.appendChild(li);
      }
      const n = balance.weapons.length;
      const weapons = balance.weapons.filter((w) => meta.weapons[w.id]).length;
      const evolutions = balance.weapons.filter((w) => meta.evolutions[w.id]).length;
      $("collection").textContent = t(`Найдено оружия: ${weapons} из ${n}, эволюций: ${evolutions} из ${n}. `
                                      + "Подробно — в справочнике, на вкладке «Оружие».",
                                      `Weapons found: ${weapons} of ${n}, evolutions: ${evolutions} of ${n}. `
                                      + "The details are in the handbook, on the Weapons tab.");
    }

    // A weapon entry: its own id; an evolution entry: gold, with the weapon's id as its icon.
    function found(entry, meta) {
      if (!balance.weapons.some((w) => w.id === entry.icon)) return true;
      return Boolean(entry.gold ? meta.evolutions[entry.icon] : meta.weapons[entry.id]);
    }

    // --- the ghost's sessions and the trials -------------------------------------------

    function dateText(seconds) {
      const d = new Date(seconds * 1000);
      return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} `
        + `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }

    // Past sessions to play as a ghost; the project name is shown as text only.
    function ghosts(shown, list, current, records, pick) {
      const box = $("ghosts");
      clear(box);
      box.hidden = !shown;
      if (!shown) return;
      if (!list.length) {
        box.appendChild(el("p", t("Прошлых сессий пока нет: поиграй с агентом, и его сессия появится здесь.",
                                  "No past sessions yet: play with an agent and its session shows up here."),
                           "hint"));
        return;
      }
      for (const g of list) {
        const b = el("button", null, "ghost" + (g.session === current ? " on" : ""));
        b.appendChild(el("span", g.project || "?", "name"));
        const best = records[g.session] ? records[g.session].best_score : null;
        b.appendChild(el("span", `${dateText(g.started_at)} · ${clock(g.duration)} · `
          + `${t("действий", "actions")} ${g.actions}`
          + (best !== null ? ` · ${t("рекорд", "best")} ${best}` : ""), "text"));
        b.addEventListener("click", () => pick(g.session));
        box.appendChild(b);
      }
    }

    // The trials: the passed ones marked, each with its map, its goal and the best time of a pass.
    function trials(shown, current, records, pick) {
      const box = $("trials");
      clear(box);
      box.hidden = !shown;
      if (!shown) return;
      for (const x of balance.trials.list) {
        const r = records[x.id], done = Boolean(r && r.done);
        const b = el("button", null, "trial" + (x.id === current ? " on" : "") + (done ? " done" : ""));
        b.appendChild(el("span", (done ? "✓ " : "") + tf(x, "name"), "name"));
        const map = LCS_MAPS.find((m) => m.id === x.map);
        b.appendChild(el("span", `${tf(map, "name")} · ${t(...LCSTrials.goal(balance, x))}`
          + (r && r.best ? ` · ${t("лучшее", "best")} ${clock(r.best)}` : ""), "text"));
        b.addEventListener("click", () => pick(x.id));
        box.appendChild(b);
      }
    }

    // --- the HUD ----------------------------------------------------------------------

    function abilityChip(s) {
      if (!s.cls || !s.cls.ability) return null;
      const A = LCSClasses.byId(balance, s.cls.id).ability;
      const left = s.cls.ready - s.time;
      const active = s.time < s.cls.until;
      const waiting = left > 0 && !active;
      return {id: "ability" + (left > 0 ? "-wait" : "") + (active ? "-on" : ""), cls: waiting ? "dim" : "pink",
              text: `${tf(A, "name")} · ` + (waiting ? Math.ceil(left) + t(" с", "s") : t(...KEY))};
    }

    return {achievements, awards, classes, stars, found, ghosts, trials, abilityChip};
  }

  root.LCSScreens = {create};
})(typeof window !== "undefined" ? window : globalThis);
