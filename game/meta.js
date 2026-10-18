// The arena: what stays between matches besides the records (0.9): stars for counted
// matches and the bonuses bought with them, and the collection of the weapons and
// evolutions found. No DOM and no storage here: main.js keeps it as "meta" through the SDK.
//   const meta = LCSMeta.clean(saved, balance)    // a valid save from anything
//   LCSMeta.starsFor(balance.stars, results)      // the stars one counted match brings
//   LCSMeta.addMatch(meta, balance, results)      // a new save: the stars and the finds added
//   LCSMeta.price(balance, meta, perkId)          // the next level's price, null at the top
//   LCSMeta.buy(meta, balance, perkId)            // {meta, ok}
"use strict";

(function (root) {
  const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

  // Only ids the balance knows: a save is never trusted to name its own keys.
  function pickKnown(saved, ids) {
    const out = {};
    for (const id of ids) {
      const n = saved && typeof saved === "object" && Object.prototype.hasOwnProperty.call(saved, id)
        ? count(saved[id]) : 0;
      if (n) out[id] = n;
    }
    return out;
  }

  function clean(saved, B) {
    const s = saved && typeof saved === "object" ? saved : {};
    const weapons = B.weapons.map((w) => w.id);
    const perks = pickKnown(s.perks, B.stars.perks.map((p) => p.id));
    for (const p of B.stars.perks) if (perks[p.id] > p.cost.length) perks[p.id] = p.cost.length;
    return {stars: count(s.stars), earned: count(s.earned), perks,
            weapons: pickKnown(s.weapons, weapons), evolutions: pickKnown(s.evolutions, weapons)};
  }

  // A campaign counts the stages cleared: all of them after the win, else up to the one lost.
  function starsFor(S, res) {
    const won = res.reason === "win";
    const stages = res.mode === "campaign" ? Math.max(0, (res.stage | 0) - (won ? 0 : 1)) : 0;
    const n = S.match + S.per_boss * count(res.bosses) + (won ? S.win : 0) + S.per_stage * stages
      + Math.floor(count(res.time) / (S.per_minutes * 60));
    return Math.min(S.max, n);
  }

  function addMatch(saved, B, res) {
    const meta = clean(saved, B), n = starsFor(B.stars, res);
    meta.stars += n;
    meta.earned += n;
    const known = new Set(B.weapons.map((w) => w.id));
    const add = (list, ids) => {
      for (const id of Array.isArray(ids) ? ids : []) if (known.has(id)) list[id] = (list[id] || 0) + 1;
    };
    add(meta.weapons, res.weapon_ids);
    add(meta.evolutions, res.evolved_ids);
    return meta;
  }

  function price(B, meta, id) {
    const perk = B.stars.perks.find((p) => p.id === id);
    if (!perk) return null;
    const level = meta.perks[id] || 0;
    return level < perk.cost.length ? perk.cost[level] : null;
  }

  function buy(saved, B, id) {
    const meta = clean(saved, B), cost = price(B, meta, id);
    if (cost === null || meta.stars < cost) return {meta, ok: false};
    meta.stars -= cost;
    meta.perks[id] = (meta.perks[id] || 0) + 1;
    return {meta, ok: true};
  }

  root.LCSMeta = {clean, starsFor, addMatch, price, buy};
})(typeof window !== "undefined" ? window : globalThis);
