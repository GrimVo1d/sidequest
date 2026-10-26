// The arena: its own events, a Friday deploy and an incident, one every few minutes. A deploy
// speeds the spawns up for a while and pays when it is over; an incident is a zone to hold
// before it escalates into rage. No DOM here: tests run it in jsc through game.js.
//   const events = LCSEvents.create(B, s, hooks);
//   events.start(kind)    // "deploy" or "incident": it starts now, the next one is scheduled
//   events.update(dt)     // the running one goes on or ends
// hooks: random(), text(x, y, value, color, life), effect(fx), tr(ru, en),
//        drop(type, x, y, force), inWall(x, y, r, ground), size: {width, height}
"use strict";

(function (root) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function create(B, s, hooks) {
    const EV = B.events, {random, text, effect, tr, drop, inWall, size} = hooks;

    function start(kind) {
      const p = s.player, [lo, hi] = EV.every;
      s.eventAt = s.time + lo + random() * (hi - lo);
      s.nextEvent = kind === "deploy" ? "incident" : "deploy";
      s.met[kind] = true;
      if (kind === "deploy") {
        s.deploy = {left: EV.deploy.seconds};
        text(p.x, p.y - 30, tr("ПЯТНИЧНЫЙ ДЕПЛОЙ", "FRIDAY DEPLOY"), "#e89a4a", 3);
        return;
      }
      const Z = EV.incident;
      let at = {x: p.x, y: p.y};
      for (let tries = 0; tries < 30; tries++) {
        const angle = random() * Math.PI * 2, d = Z.distance[0] + random() * (Z.distance[1] - Z.distance[0]);
        const x = clamp(p.x + Math.cos(angle) * d, Z.radius, size.width - Z.radius);
        const y = clamp(p.y + Math.sin(angle) * d, Z.radius, size.height - Z.radius);
        if (!inWall(x, y, Z.radius / 2, true)) { at = {x, y}; break; }
      }
      s.incident = {x: at.x, y: at.y, r: Z.radius, held: 0, left: Z.seconds};
      text(p.x, p.y - 30, tr("ИНЦИДЕНТ", "INCIDENT"), "#d9534f", 3);
    }

    function update(dt) {
      const p = s.player;
      if (s.deploy) {
        s.deploy.left -= dt;
        if (s.deploy.left <= 0) {
          s.deploy = null;
          if (s.endAt === null) {
            s.deploys++;
            s.score += EV.deploy.score * s.multiplier;
            text(p.x, p.y - 24, tr("ДЕПЛОЙ ПЕРЕЖИТ", "DEPLOY SURVIVED"), "#4fbf6f", 2.5);
          }
        }
      }
      if (s.incident) {
        const z = s.incident, Z = EV.incident;
        z.left -= dt;
        if (!p.dead && (z.x - p.x) ** 2 + (z.y - p.y) ** 2 <= z.r * z.r) z.held += dt;
        if (z.held >= Z.hold) {
          s.incident = null;
          s.incidents++;
          s.score += Z.score * s.multiplier;
          drop("chest", z.x, z.y, true);
          effect({type: "ring", x: z.x, y: z.y, r: z.r + 10, color: "#4fbf6f", life: 0.6});
          text(z.x, z.y - 20, tr("ИНЦИДЕНТ ЗАКРЫТ", "INCIDENT CLOSED"), "#4fbf6f", 2.5);
        } else if (z.left <= 0) {
          s.incident = null;
          s.rage = Math.max(s.rage, Z.fail_rage * s.stats.rage);
          s.met.rage = true;
          text(p.x, p.y - 24, tr("ИНЦИДЕНТ ЭСКАЛИРОВАН", "INCIDENT ESCALATED"), "#d9534f", 2.5);
        }
      }
    }

    return {start, update};
  }

  root.LCSEvents = {create};
})(typeof window !== "undefined" ? window : globalThis);
