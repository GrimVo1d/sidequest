// The arena: what the modes need besides the simulation itself. No DOM here.
//   LCSModes.MODES        // {id: {name, name_en, text, text_en, solo, agents, wins, endless}}
//   const random = LCSModes.makeRandom(seed)      // the seeded random the whole match uses
//   LCSModes.daily(balance, LCS_MAPS, "2026-10-09")   // the day's seed, map and modifiers
//   LCSModes.week(balance, "2026-10-09")         // Infinity's week: {week: 41, modifiers}
//   LCSModes.ghostSchedule(balance.ghost, events)     // a past session as the ghost's schedule
//   LCSModes.stage(balance, options)    // the campaign's stage options.stage, or null
//   LCSModes.carry(state)               // what the next stage takes from this one
//   LCSModes.resume(state, balance, stage, carried)   // a new stage's state from the last one
"use strict";

(function (root) {
  // Small seeded random generator (mulberry32): tests replay the same match.
  function makeRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The modes, in the menu's order: their names and what they are, in both languages, and
  // how they play. solo: alone, crystals, a final boss, death ends the run; agents: live
  // agents' events reach the match; wins: the run can be won; endless: it goes on after
  // the final boss until death.
  const MODES = {
    agent: {solo: false, agents: true, wins: false, endless: false,
            name: "С агентом", name_en: "With an agent",
            text: "Союзники — твои агенты: их действия становятся атаками. "
                  + "Матч заканчивается, когда все агенты закончили задачу.",
            text_en: "Your allies are your agents: what they do turns into attacks. "
                     + "The match ends when every agent has finished its task."},
    classic: {solo: true, agents: true, wins: true, endless: false,
              name: "Классика", name_en: "Classic",
              text: "Один, 20 минут: опыт — кристаллы с врагов, в конце — финальный босс. "
                    + "Смерть заканчивает забег. Агент, начавший работу, придёт на помощь.",
              text_en: "Alone, 20 minutes: experience comes as crystals from enemies, the "
                       + "final boss comes at the end. Death ends the run. An agent that "
                       + "starts working joins in to help."},
    campaign: {solo: true, agents: true, wins: true, endless: false,
               name: "Кампания", name_en: "Campaign",
               text: "Пять карт подряд, в конце каждой — босс. Оружие, вещи и уровень идут дальше, "
                     + "смерть заканчивает кампанию. Агент, начавший работу, придёт на помощь.",
               text_en: "Five maps in a row, a boss at the end of each. Weapons, gear and level carry "
                        + "over; death ends the campaign. An agent that starts working joins in to help."},
    ghost: {solo: false, agents: false, wins: false, endless: false,
            name: "Призрак сессии", name_en: "Session ghost",
            text: "Союзник — твоя прошлая сессия Claude Code: её действия повторяются, "
                  + "долгие паузы сжаты. Живые агенты в этом режиме не участвуют.",
            text_en: "Your ally is one of your past Claude Code sessions: its actions play "
                     + "again, long pauses squeezed. Live agents stay out of this mode."},
    daily: {solo: true, agents: false, wins: true, endless: false,
            name: "Задача дня", name_en: "Daily task",
            text: "«Классика» с картой, модификаторами и случайностью дня — одинаковыми весь "
                  + "день. Рекорд дня и серия дней подряд. Без агентов.",
            text_en: "Classic with the day's map, modifiers and luck, the same all day long. "
                     + "A record for the day and a streak of days. No agents."},
    infinity: {solo: true, agents: true, wins: false, endless: true,
               name: "Бесконечность", name_en: "Infinity",
               text: "«Классика» без конца: на 20-й минуте финальный босс, а дальше баги идут "
                     + "и сильнеют, пока ты жив. Модификаторы недели — одни на всю неделю. "
                     + "Агент, начавший работу, придёт на помощь.",
               text_en: "Classic with no end: the final boss comes at the 20th minute, then the "
                        + "bugs keep coming and growing stronger for as long as you live. The "
                        + "week's modifiers stay the same all week. An agent that starts working "
                        + "joins in to help."},
  };

  // FNV-1a of a text: the seed of a day or a week.
  function seedOf(text) {
    let h = 0x811c9dc5;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    return h;
  }

  // `n` different modifiers of the balance's, drawn with `random`.
  function pickModifiers(B, random, n) {
    const pool = B.modifiers.map((m) => m.id), out = [];
    while (out.length < Math.min(n, pool.length)) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    return out;
  }

  // The day's task: the same seed, map and modifiers for everyone on that date ("2026-10-09").
  function daily(B, maps, date) {
    const h = seedOf("lcs-daily-" + date);
    const random = makeRandom(h);
    const map = maps[Math.floor(random() * maps.length)];
    return {date, seed: h, map: map.id, modifiers: pickModifiers(B, random, B.daily.modifiers)};
  }

  // The ISO week of a date: "2026-10-09" -> {year: 2026, n: 41}. The week's Thursday names
  // its year.
  function isoWeek(date) {
    const [y, m, d] = date.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d));
    day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
    const year = day.getUTCFullYear();
    const n = Math.ceil(((day - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
    return {year, n};
  }

  // Infinity's modifiers for the week of a date: the same all week.
  function week(B, date) {
    const {year, n} = isoWeek(date);
    const random = makeRandom(seedOf(`lcs-week-${year}-W${String(n).padStart(2, "0")}`));
    return {week: n, modifiers: pickModifiers(B, random, B.infinity.week_modifiers)};
  }

  // A past session as the ghost's schedule: long pauses squeezed, every event at a game time.
  function ghostSchedule(G, events) {
    const list = (Array.isArray(events) ? events : [])
      .filter((e) => e && typeof e.kind === "string" && Number.isFinite(e.t))
      .sort((a, b) => a.t - b.t);
    const out = [];
    let at = G.lead, prev = null;
    for (const e of list) {
      if (prev) {
        // After a finished task the next one comes soon: the match goes on.
        const cap = prev.kind === "stop" && prev.final ? G.after_task : G.max_gap;
        at += Math.min(cap, Math.max(0, e.t - prev.t));
      }
      const copy = Object.assign({}, e, {session: "ghost", ts: e.t});
      delete copy.t;
      out.push({at, event: copy});
      prev = e;
    }
    return out;
  }

  // --- the campaign (0.9) ------------------------------------------------------------
  // Five maps in a row; a boss closes each, the last one is the final boss. A stage starts
  // where the last one ended on the clock, so the arena keeps getting harder, and the build
  // comes along: weapons, passives, gear, level, score and the counters of the results.

  const CARRY = ["time", "stats", "weapons", "taken", "gear", "gearLevels", "level", "xp", "xpNext",
                 "rerolls", "banishes", "banished", "score", "kills", "bosses", "bossKinds",
                 "evolutions", "damageTaken", "deaths", "bestStreak", "maxMultiplier", "elites",
                 "incidents", "deploys", "picked", "synced", "commits", "pushes", "turretsBuilt",
                 "reviews", "crits", "abilityUses", "everAlly", "withAgent", "met"];

  function stage(B, options) {
    const K = B.campaign, i = options && options.mode === "campaign" ? options.stage | 0 : -1;
    if (i < 0 || i >= K.stages.length) return null;
    const last = i === K.stages.length - 1, st = K.stages[i];
    return {index: i, count: K.stages.length, final: last, map: st.map, boss: st.boss,
            hp: last ? K.final_hp : K.boss_hp, score: last ? K.final_score : K.boss_score};
  }

  const carry = (s) => JSON.parse(JSON.stringify(Object.fromEntries(CARRY.map((k) => [k, s[k]]))));

  // The timers that count from the start of a match count from the stage's start instead.
  function resume(s, B, st, carried) {
    if (carried) Object.assign(s, carry(carried));
    const t = s.time;
    s.stage = Object.assign({start: t, until: t + B.campaign.stage_seconds}, st);
    s.finalAt = s.stage.until;
    s.itemAt += t;
    s.eventAt += t;
    s.nextBoss += t;
    s.player.hp = s.stats.max_hp;
  }

  root.LCSModes = {MODES, makeRandom, daily, week, ghostSchedule, stage, carry, resume};
})(typeof window !== "undefined" ? window : globalThis);
