// The arena: records and achievements. No DOM and no storage here: main.js
// reads and saves through the SDK, tests run this in jsc.
//   records = LCSProgress.addMatch(records, results)   // only for counted matches
//   LCSProgress.earned(balance.achievements, results, records, mapIds)  // ids, met now
//   days = LCSProgress.addDay(days, results)            // the daily task: best score per day
//   LCSProgress.streak(days, "2026-10-09")              // days in a row up to that day
//   ghosts = LCSProgress.addGhost(ghosts, results)      // best score per replayed session
//   bests = LCSProgress.addBests(bests, balance.achievements, results)   // best single match
//   LCSProgress.progressOf(achievement, records, bests, mapIds)   // how far a locked one is
"use strict";

(function (root) {
  const MODES = ["agent", "classic", "daily", "ghost", "campaign"];
  const KEEP_DAYS = 400, KEEP_GHOSTS = 100;

  function emptyMode() {
    return {best_score: 0, best_time: 0, best_level: 0, matches: 0, kills: 0, wins: 0};
  }

  // Records as saved, from any version: the first version kept one flat set of numbers
  // for matches with an agent.
  function migrate(saved) {
    const r = Object.fromEntries(MODES.map((m) => [m, emptyMode()]));
    r.totals = {matches: 0, kills: 0, bosses: 0, wins: 0, done: 0, maps: {}};
    if (!saved || typeof saved !== "object") return r;
    if (!saved.totals) {
      for (const k of Object.keys(r.agent)) if (Number.isFinite(saved[k])) r.agent[k] = saved[k];
      r.totals.matches = r.agent.matches;
      r.totals.kills = r.agent.kills;
      return r;
    }
    for (const mode of MODES) {
      for (const k of Object.keys(r[mode])) {
        const v = saved[mode] && saved[mode][k];
        if (Number.isFinite(v)) r[mode][k] = v;
      }
    }
    for (const k of Object.keys(r.totals)) {
      if (k !== "maps" && Number.isFinite(saved.totals[k])) r.totals[k] = saved.totals[k];
    }
    const maps = saved.totals.maps;
    if (maps && typeof maps === "object") {
      for (const [id, n] of Object.entries(maps)) if (Number.isFinite(n)) r.totals.maps[id] = n;
    }
    return r;
  }

  function addMatch(saved, res) {
    const r = migrate(saved);
    const m = r[MODES.includes(res.mode) ? res.mode : "agent"], t = r.totals;
    const won = res.reason === "win";
    m.best_score = Math.max(m.best_score, res.score);
    m.best_time = Math.max(m.best_time, res.time);
    m.best_level = Math.max(m.best_level, res.level);
    m.matches++;
    m.kills += res.kills;
    if (won) m.wins++;
    t.matches++;
    t.kills += res.kills;
    t.bosses += res.bosses || 0;
    if (won) t.wins++;
    if (res.reason === "done") t.done++;
    t.maps[res.map] = (t.maps[res.map] || 0) + 1;
    return r;
  }

  // The daily task: {"2026-10-09": best score}, the latest days only.
  function addDay(saved, res) {
    const days = {};
    if (saved && typeof saved === "object") {
      for (const [d, n] of Object.entries(saved)) if (/^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(n)) days[d] = n;
    }
    if (typeof res.day === "string") days[res.day] = Math.max(days[res.day] || 0, res.score);
    const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
    return Object.fromEntries(keep.map((d) => [d, days[d]]));
  }

  // Days played in a row, ending with `today` (or yesterday, while today is still ahead).
  function streak(days, today) {
    const shift = (d, n) => {
      const x = new Date(d + "T12:00:00Z");
      x.setUTCDate(x.getUTCDate() + n);
      return x.toISOString().slice(0, 10);
    };
    let d = days && days[today] !== undefined ? today : shift(today, -1), n = 0;
    while (days && days[d] !== undefined) { n++; d = shift(d, -1); }
    return n;
  }

  // Replayed sessions: {session: {best_score, runs, at}}, the most recent ones.
  function addGhost(saved, res) {
    const all = {};
    if (saved && typeof saved === "object") {
      for (const [id, g] of Object.entries(saved)) {
        if (g && Number.isFinite(g.best_score) && Number.isFinite(g.runs)) {
          all[id] = {best_score: g.best_score, runs: g.runs, at: Number.isFinite(g.at) ? g.at : 0};
        }
      }
    }
    if (typeof res.ghost === "string") {
      const g = all[res.ghost] || {best_score: 0, runs: 0, at: 0};
      all[res.ghost] = {best_score: Math.max(g.best_score, res.score), runs: g.runs + 1,
                        at: Number.isFinite(res.at) ? res.at : g.at};
    }
    const keep = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, KEEP_GHOSTS);
    return Object.fromEntries(keep.map((id) => [id, all[id]]));
  }

  // A condition holds when every part of it holds:
  //   min / max: {field: n} on the match results, is: {field: value},
  //   total_min: {field: n} on the totals after the match, maps_all: every map played.
  function holds(when, res, records, mapIds) {
    const w = when || {};
    for (const [k, n] of Object.entries(w.min || {})) if (!((res[k] || 0) >= n)) return false;
    for (const [k, n] of Object.entries(w.max || {})) if (!((res[k] || 0) <= n)) return false;
    for (const [k, v] of Object.entries(w.is || {})) if (res[k] !== v) return false;
    for (const [k, n] of Object.entries(w.total_min || {})) {
      if (!((records.totals[k] || 0) >= n)) return false;
    }
    if (w.maps_all && !mapIds.every((id) => records.totals.maps[id] > 0)) return false;
    return true;
  }

  function earned(list, res, records, mapIds) {
    return list.filter((a) => holds(a.when, res, records, mapIds)).map((a) => a.id);
  }

  // The best of single matches, for the fields that achievements ask of one match: the
  // achievements screen shows how close the player came. Counted matches only.
  function addBests(saved, list, res) {
    const bests = {};
    for (const a of list) {
      for (const k of Object.keys((a.when && a.when.min) || {})) {
        const old = saved && Number.isFinite(saved[k]) ? saved[k] : 0;
        bests[k] = Math.max(old, Number.isFinite(res[k]) ? res[k] : 0);
      }
    }
    return bests;
  }

  // How far a locked achievement is: {field, have, need, of} with `of` "match" (the best
  // match), "total" (all matches) or maps played, or null when there is nothing to count: a
  // condition on how the match ended, several conditions at once, or a single step.
  function progressOf(a, records, bests, mapIds) {
    const w = a.when || {};
    if (w.is || w.max) return null;
    const parts = [
      ...Object.entries(w.min || {}).map(([k, n]) => ({field: k, have: bests[k] || 0, need: n, of: "match"})),
      ...Object.entries(w.total_min || {}).map(([k, n]) => ({field: k, have: records.totals[k] || 0, need: n, of: "total"}))];
    if (w.maps_all) {
      parts.push({field: "maps", have: mapIds.filter((id) => records.totals.maps[id] > 0).length,
                  need: mapIds.length, of: "total"});
    }
    if (parts.length !== 1 || !(parts[0].need > 1)) return null;
    const p = parts[0];
    return Object.assign(p, {have: Math.min(p.have, p.need)});
  }

  root.LCSProgress = {migrate, addMatch, earned, addBests, progressOf, addDay, streak, addGhost, MODES};
})(typeof window !== "undefined" ? window : globalThis);
