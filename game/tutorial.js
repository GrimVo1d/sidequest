// The arena: the tutorial of the first match ever (1.0). The steps and their goals are in
// balance.json (`tutorial`); this file only follows the match and says which step is on.
// No DOM here: tests run it in jsc. A step's `need`: moved (points walked), kills, level,
// ability (used once), seconds (shown that long); `only`: shown when the class has an ability
// ("ability") or in the mode with agents ("agent").
//   const lesson = LCSTutorial.create(B.tutorial, {ability: true, agent: false});
//   lesson.update(state)   // the current step ({id, icon, name, text, index, count}) or null
//   lesson.done            // true once every step is passed
"use strict";

(function (root) {
  function create(T, has) {
    const steps = T.steps.filter((st) => !st.only || (has && has[st.only]));
    let index = 0, since = null, from = null, moved = 0;

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
      update(s) {
        if (lesson.done) return null;
        const p = s.player;
        if (from) moved += Math.hypot(p.x - from.x, p.y - from.y);
        from = {x: p.x, y: p.y};
        if (since === null) since = s.time;
        while (index < steps.length && passed(steps[index], s)) {
          index++;
          since = s.time;
        }
        if (index >= steps.length) {
          lesson.done = true;
          return null;
        }
        const st = steps[index];
        return {id: st.id, icon: st.icon, name: [st.name, st.name_en], text: [st.text, st.text_en],
                index, count: steps.length};
      },
    };
    return lesson;
  }

  root.LCSTutorial = {create};
})(typeof window !== "undefined" ? window : globalThis);
