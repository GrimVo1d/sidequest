// The arena: the trials (balance.trials), short runs alone with a goal and a condition each:
// every boss in a row, holding out for a while, a short classic, so many kills in time. No
// DOM here: tests run it in jsc through game.js.
//   LCSTrials.byId(balance, id)         // a trial, the first one for an unknown id
//   LCSTrials.goal(balance, trial)      // [ru, en]: "survive 3:00 without taking a hit"
//   LCSTrials.status(balance, state)    // [ru, en] for the HUD: how far the trial is
//   const run = LCSTrials.create(B, s, trial, hooks);   // sets the match up for it
//   run.update()        // the rush's next boss, the goal reached or the condition broken
//   run.spawn           // the factor on the bugs' spawn rate
// hooks: spawnBoss(type), spawnFinal(type), makeElite(e, kind, hpScale), win(at),
//        text(x, y, value, color, life), tr(ru, en)
"use strict";

(function (root) {
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  const both = (text) => [text, text];
  // The trial's clock: it stops at the pass and never runs past the goal's time.
  const now = (s, cap) => clock(Math.min(s.trial.time || s.time, cap));

  // Behaviour by goal (balance.trials.list[].goal): what the menu says, what the HUD says,
  // how the match is set up for it and whether it is passed (true), failed (false) or neither
  // yet (null). The rush brings its own bosses; a final goal is won by the game's final boss.
  const GOALS = {
    rush: {
      bosses: true,
      text(B, T) {
        const R = B.trials.rush, n = R.bosses.length, limit = clock(R.limit);
        return T.elite
          ? [`${n} усиленных боссов подряд за ${limit}`, `${n} enhanced bosses in a row in ${limit}`]
          : [`все ${n} боссов подряд за ${limit}`, `all ${n} bosses in a row in ${limit}`];
      },
      // Between bosses it counts down to the next one.
      status(B, s) {
        const R = B.trials.rush, st = s.trial, n = R.bosses.length;
        const time = `${now(s, R.limit)} / ${clock(R.limit)}`;
        if (st.bosses === null && st.index < n) {
          const wait = clock(Math.max(0, st.nextAt - s.time) + 0.999);
          return [`босс ${st.index + 1}/${n} через ${wait} · ${time}`,
                  `boss ${st.index + 1}/${n} in ${wait} · ${time}`];
        }
        return [`босс ${st.index}/${n} · ${time}`, `boss ${st.index}/${n} · ${time}`];
      },
      setup(B, s) { s.nextBoss = Infinity; },
      spawn: (B) => B.trials.rush.spawn,
      // Failed at the limit, so a boss that cannot be finished does not hold the run forever.
      done: (B, s) => (s.time >= B.trials.rush.limit ? false : null),
    },
    survive: {
      text(B, T) {
        const [ru, en] = [`продержись ${clock(T.seconds)}`, `survive ${clock(T.seconds)}`];
        return T.no_damage ? [ru + " без урона", en + " without taking a hit"] : [ru, en];
      },
      status: (B, s, T) => both(`${now(s, T.seconds)} / ${clock(T.seconds)}`),
      done: (B, s, T) => s.time >= T.seconds || null,
    },
    final: {
      text(B, T) {
        const minute = T.final_at / 60;
        return [`финальный босс на ${minute}-й минуте`, `the final boss at minute ${minute}`];
      },
      // Once the boss is up, only the clock.
      status: (B, s, T) => (s.time < T.final_at ? both(`${clock(s.time)} / ${clock(T.final_at)}`)
        : [`финальный босс · ${now(s, Infinity)}`, `final boss · ${now(s, Infinity)}`]),
      setup(B, s, T) { s.finalAt = T.final_at; },
      done: () => null,
    },
    kills: {
      text: (B, T) => [`${T.kills} убийств за ${clock(T.limit)}`, `${T.kills} kills in ${clock(T.limit)}`],
      status(B, s, T) {
        const left = `${s.kills}/${T.kills} · ${now(s, T.limit)} / ${clock(T.limit)}`;
        return ["убито " + left, "kills " + left];
      },
      done: (B, s, T) => (s.kills >= T.kills ? true : s.time >= T.limit ? false : null),
    },
  };

  function byId(B, id) {
    return B.trials.list.find((x) => x.id === id) || B.trials.list[0];
  }

  const goal = (B, T) => GOALS[T.goal].text(B, T);

  // The condition goes after the goal's progress, as a reminder.
  function status(B, s) {
    const T = byId(B, s.trial.id), [ru, en] = GOALS[T.goal].status(B, s, T);
    return T.no_damage ? [ru + " · без урона", en + " · no hits"] : [ru, en];
  }

  function create(B, s, T, hooks) {
    const R = B.trials.rush, G = GOALS[T.goal], {text, tr} = hooks;
    // bosses: how many bosses were down when the rush's current one came, null between them.
    s.trial = {id: T.id, index: 0, nextAt: R.first_at, bosses: null};
    // No final boss unless the goal brings one.
    s.finalAt = Infinity;
    if (G.setup) G.setup(B, s, T);

    function fail() {
      s.endAt = s.time + B.classic.death_delay;
      s.endReason = "failed";
      text(s.player.x, s.player.y - 30, tr("ИСПЫТАНИЕ ПРОВАЛЕНО", "TRIAL FAILED"), "#d9534f", 3);
    }

    // The next boss comes a little after the last one is down: the game counts a boss once
    // all of it is, both twins and whatever came back. The last one is final, and beating it
    // wins the trial.
    function rush() {
      const st = s.trial;
      if (st.bosses !== null) {
        if (s.bosses === st.bosses) return;
        st.bosses = null;
        st.nextAt = s.time + R.pause;
      }
      if (s.time < st.nextAt || st.index >= R.bosses.length) return;
      const type = R.bosses[st.index], last = st.index === R.bosses.length - 1;
      const boss = last ? hooks.spawnFinal(type) : hooks.spawnBoss(type);
      if (!boss) {
        st.nextAt = s.time + 1;
        return;
      }
      // The final boss is up: no arena events from here, as in a classic.
      if (last) s.finalAt = null;
      st.index++;
      st.bosses = s.bosses;
      // Enhanced: an elite's trait, with its own health on top of the boss's.
      if (T.elite) for (const e of [boss, boss.partner].filter(Boolean)) hooks.makeElite(e, null, R.elite_hp);
    }

    function update() {
      if (s.over || s.endAt !== null || s.player.dead) return;
      if (T.no_damage && s.damageTaken > 0) return fail();
      if (G.bosses) rush();
      const done = G.done(B, s, T);
      if (done === true) hooks.win(s.player);
      else if (done === false) fail();
    }

    return {update, spawn: G.spawn ? G.spawn(B) : 1};
  }

  root.LCSTrials = {GOALS, byId, goal, status, create};
})(typeof window !== "undefined" ? window : globalThis);
