// The arena: the tutorial of the first match ever (1.0). The steps and their goals are in
// balance.json (`tutorial`); this file only follows the match and says which step is on.
// No DOM here: tests run it in jsc. A step's `need`: moved (points walked), kills, level,
// ability (used once), seconds (shown that long); `only`: shown when the class has an ability
// ("ability"), in the mode with agents ("agent") or where enemies drop crystals ("gems": not
// with agents, whose work brings the experience there); `covers`: the handbook entries the step
// teaches, so their "New: …" hints are not shown again.
//   const lesson = LCSTutorial.create(B.tutorial, {ability: true, agent: false, gems: true});
//   lesson.update(state)   // the current step ({id, icon, name, text, index, count}) or null
//   lesson.done            // true once every step is passed
//   lesson.covers          // a Set of the handbook ids the lesson teaches
"use strict";

(function (root) {
  const JUMP = 60;   // points between two updates that cannot have been walked

  function create(T, has) {
    const steps = T.steps.filter((st) => !st.only || (has && has[st.only]));
    let index = 0, since = null, from = null, moved = 0, skipped = 0;

    // The allies' step has nothing to show while no agent is on the field: it is skipped, and
    // the steps are counted without it.
    const empty = (st, s) => st.only === "agent" && !s.allies.length;

    // How far the player is towards a step's goal; the step is passed when every goal is met.
    function passed(st, s) {
      const need = st.need;
      return (!need.moved || moved >= need.moved)
        && (!need.kills || s.kills >= need.kills)
        && (!need.level || s.level >= need.level)
        && (!need.ability || Boolean(s.cls && s.cls.ready > 0))
        && (!need.seconds || s.time - since >= need.seconds);
    }

    const lesson = {
      done: steps.length === 0,
      covers: new Set(steps.flatMap((st) => st.covers || [])),
      update(s) {
        if (lesson.done) return null;
        const p = s.player;
        // A jump (the next campaign stage's start) is not walking.
        const step = from ? Math.hypot(p.x - from.x, p.y - from.y) : 0;
        if (step < JUMP) moved += step;
        from = {x: p.x, y: p.y};
        if (since === null) since = s.time;
        while (index < steps.length && (empty(steps[index], s) || passed(steps[index], s))) {
          if (empty(steps[index], s)) skipped++;
          index++;
          since = s.time;
        }
        if (index >= steps.length) {
          lesson.done = true;
          return null;
        }
        const st = steps[index], later = steps.filter((x, i) => i > index && empty(x, s)).length;
        return {id: st.id, icon: st.icon, name: [st.name, st.name_en], text: [st.text, st.text_en],
                index: index - skipped, count: steps.length - skipped - later};
      },
    };
    return lesson;
  }

  root.LCSTutorial = {create};
})(typeof window !== "undefined" ? window : globalThis);
