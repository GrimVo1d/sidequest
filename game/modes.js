// The arena: what the modes need besides the simulation itself. No DOM here.
//   const random = LCSModes.makeRandom(seed)      // the seeded random the whole match uses
//   LCSModes.daily(balance, LCS_MAPS, "2026-10-09")   // the day's seed, map and modifiers
//   LCSModes.ghostSchedule(balance.ghost, events)     // a past session as the ghost's schedule
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

  // The day's task: the same seed, map and modifiers for everyone on that date ("2026-10-09").
  function daily(B, maps, date) {
    let h = 0x811c9dc5;  // FNV-1a
    for (const ch of "lcs-daily-" + date) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    const random = makeRandom(h);
    const map = maps[Math.floor(random() * maps.length)];
    const pool = B.modifiers.map((m) => m.id), modifiers = [];
    while (modifiers.length < Math.min(B.daily.modifiers, pool.length)) {
      modifiers.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    return {date, seed: h, map: map.id, modifiers};
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

  root.LCSModes = {makeRandom, daily, ghostSchedule};
})(typeof window !== "undefined" ? window : globalThis);
