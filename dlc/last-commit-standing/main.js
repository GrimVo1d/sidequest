// Last Commit Standing: screens, input, the loop and the link to Sidequest.
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);
  const t = SidequestI18n.t, tf = SidequestI18n.field;
  const STEP = 1 / 60;
  const TIP_SECONDS = 6;
  const MAX_STEPS = 5;  // per frame; after a long stall the game slows down instead of jumping

  let balance = null;
  let renderer = null;
  let profile = null;
  let fpsLimit = 60;
  let game = null;
  let escOpen = false;
  let codexFrom = null;      // the screen the handbook was opened from, while it is open
  let codexScreen = "codex"; // "codex" or "awards": both open over the menu or the pause
  let codexTab = "items";
  let seen = {};             // codex ids the player has met in any match: no second hint
  let tips = [], tip = null;
  let shownEvents = {};      // the deploy and the incident whose hint has been shown
  let lastDraw = 0, acc = 0, hudAt = 0;
  let choicesKey = "";
  let banishing = false;     // the next card picked is banished instead of taken
  let buildKey = "", buffsKey = "";
  let mapId = LCS_MAPS[0].id;
  let mode = "agent";
  let mods = [];             // modifiers picked for the next match (not for the daily task)
  let ghostId = null;        // the past session picked for a ghost match
  let ghostList = [];        // past sessions, from the core
  let ghostRecords = {};
  let days = {};             // the daily task: best score per day
  const keys = new Set();
  const sprite = document.createElement("canvas");
  let stopSprite = () => {};
  let stopMenuAvatar = () => {};

  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function show(id) {
    for (const s of ["menu", "levelup", "esc", "results", "codex", "awards"]) $(s).hidden = s !== id;
  }

  function clock(seconds) {
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // A sprite from render.js scaled up whole: at most `size` px on its longer side and at
  // most 4 times, so tiny sprites (a spark) stay small. `gold`: an evolved weapon.
  function iconCanvas(name, size, gold) {
    const src = renderer.icon(name, gold), pic = el("canvas", null, "icon");
    const k = Math.max(1, Math.min(4, Math.floor(size / Math.max(src.width, src.height))));
    pic.width = src.width;
    pic.height = src.height;
    pic.getContext("2d").drawImage(src, 0, 0);
    pic.style.width = src.width * k + "px";
    pic.style.height = src.height * k + "px";
    return pic;
  }

  function fillList(dl, rows) {
    clear(dl);
    for (const [k, v] of rows) { dl.appendChild(el("dt", k)); dl.appendChild(el("dd", v)); }
  }

  // --- menu and records -------------------------------------------------------------

  const MODES = {
    agent: {name: "С агентом", name_en: "With an agent",
            text: "Союзники — твои агенты: их действия становятся атаками. "
                  + "Матч заканчивается, когда все агенты закончили задачу.",
            text_en: "Your allies are your agents: what they do turns into attacks. "
                     + "The match ends when every agent has finished its task."},
    classic: {name: "Классика", name_en: "Classic",
              text: "Один, 20 минут: опыт — кристаллы с врагов, в конце — финальный босс. "
                    + "Смерть заканчивает забег. Агент, начавший работу, придёт на помощь.",
              text_en: "Alone, 20 minutes: experience comes as crystals from enemies, the "
                       + "final boss comes at the end. Death ends the run. An agent that "
                       + "starts working joins in to help."},
    ghost: {name: "Призрак сессии", name_en: "Session ghost",
            text: "Союзник — твоя прошлая сессия Claude Code: её действия повторяются, "
                  + "долгие паузы сжаты. Живые агенты в этом режиме не участвуют.",
            text_en: "Your ally is one of your past Claude Code sessions: its actions play "
                     + "again, long pauses squeezed. Live agents stay out of this mode."},
    daily: {name: "Задача дня", name_en: "Daily task",
            text: "«Классика» с картой, модификаторами и случайностью дня — одинаковыми весь "
                  + "день. Рекорд дня и серия дней подряд. Без агентов.",
            text_en: "Classic with the day's map, modifiers and luck, the same all day long. "
                     + "A record for the day and a streak of days. No agents."},
  };

  // The local date as "2026-10-09": the daily task changes at the player's midnight.
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const todayTask = () => LCS.daily(balance, LCS_MAPS, today());
  const modifier = (id) => balance.modifiers.find((m) => m.id === id);

  async function savePrefs() {
    await Sidequest.storage.set("prefs", {map: mapId, mode, mods, ghost: ghostId});
  }

  async function progress() {
    const records = LCSProgress.migrate(await Sidequest.storage.get("records"));
    const got = (await Sidequest.storage.get("achievements")) || {};
    const bests = LCSProgress.addBests(await Sidequest.storage.get("bests"), balance.achievements, {});
    return {records, got, bests};
  }

  function updateCard(records, got) {
    const n = balance.achievements.filter((a) => got[a.id]).length;
    return Sidequest.card(LCSProgress.card(records, n, balance.achievements.length));
  }

  async function openMenu() {
    game = null;
    escOpen = false;
    $("hud").hidden = true;
    show("menu");
    profile = await Sidequest.profile();
    $("menu-name").textContent = profile.name;
    stopMenuAvatar();
    stopMenuAvatar = SidequestAvatar.animate($("menu-avatar"), profile.avatar);
    stopSprite();
    stopSprite = SidequestAvatar.animate(sprite, profile.avatar);
    const prefs = (await Sidequest.storage.get("prefs")) || {};
    if (LCS_MAPS.some((m) => m.id === prefs.map)) mapId = prefs.map;
    if (MODES[prefs.mode]) mode = prefs.mode;
    if (Array.isArray(prefs.mods)) mods = prefs.mods.filter((id) => modifier(id));
    if (typeof prefs.ghost === "string") ghostId = prefs.ghost;
    const {records, got} = await progress();
    seen = (await Sidequest.storage.get("seen")) || {};
    ghostRecords = LCSProgress.addGhost(await Sidequest.storage.get("ghosts"), {});
    days = LCSProgress.addDay(await Sidequest.storage.get("days"), {});
    try { ghostList = await Sidequest.history.sessions(); } catch (e) { ghostList = []; }
    if (!ghostList.some((g) => g.session === ghostId)) ghostId = ghostList.length ? ghostList[0].session : null;
    menuRecords = records;
    renderModes();
    renderAchievements(got);
    await updateCard(records, got);
    $("menu").scrollTop = 0;
    $("btn-play").focus({preventScroll: true});
  }

  let menuRecords = LCSProgress.migrate(null);

  function renderRecords() {
    const r = menuRecords[mode], all = menuRecords.totals;
    $("records-title").textContent = t("Рекорды: ", "Records: ") + tf(MODES[mode], "name").toLowerCase();
    const rows = [[t("Лучший счёт", "Best score"), r.best_score],
                  [t("Дольше всего", "Longest"), clock(r.best_time)],
                  [t("Лучший уровень", "Best level"), r.best_level],
                  [t("Матчей", "Matches"), r.matches], [t("Убито", "Kills"), r.kills]];
    if (mode === "classic" || mode === "daily") rows.push([t("Побед", "Wins"), r.wins]);
    if (mode === "daily") {
      rows.push([t("Рекорд дня", "Today's best"), days[today()] || 0],
                [t("Дней подряд", "Days in a row"), LCSProgress.streak(days, today())]);
    }
    fillList($("records"), rows);
    fillList($("totals"), [[t("Матчей", "Matches"), all.matches], [t("Убито", "Kills"), all.kills],
                           [t("Боссов", "Bosses"), all.bosses]]);
  }

  function renderModes() {
    const box = $("modes");
    clear(box);
    for (const [id, m] of Object.entries(MODES)) {
      const b = el("button", tf(m, "name"), "mode" + (id === mode ? " on" : ""));
      b.addEventListener("click", () => {
        mode = id;
        renderModes();
        savePrefs();
      });
      box.appendChild(b);
    }
    $("mode-text").textContent = tf(MODES[mode], "text");
    renderRecords();
    renderGhosts();
    renderDaily();
    renderMaps();
    renderMods();
    $("btn-play").disabled = mode === "ghost" && !ghostId;
  }

  function dateText(seconds) {
    const d = new Date(seconds * 1000);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} `
      + `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // Past sessions to play as a ghost; the project name is shown as text only.
  function renderGhosts() {
    const box = $("ghosts");
    clear(box);
    box.hidden = mode !== "ghost";
    if (mode !== "ghost") return;
    if (!ghostList.length) {
      box.appendChild(el("p", t("Прошлых сессий пока нет: поиграй с агентом, и его сессия появится здесь.",
                                "No past sessions yet: play with an agent and its session shows up here."),
                         "hint"));
      return;
    }
    for (const g of ghostList) {
      const b = el("button", null, "ghost" + (g.session === ghostId ? " on" : ""));
      b.appendChild(el("span", g.project || "?", "name"));
      const best = ghostRecords[g.session] ? ghostRecords[g.session].best_score : null;
      b.appendChild(el("span", `${dateText(g.started_at)} · ${clock(g.duration)} · `
        + `${t("действий", "actions")} ${g.actions}`
        + (best !== null ? ` · ${t("рекорд", "best")} ${best}` : ""), "text"));
      b.addEventListener("click", () => {
        ghostId = g.session;
        renderGhosts();
        savePrefs();
      });
      box.appendChild(b);
    }
  }

  function renderDaily() {
    const p = $("daily-text");
    p.hidden = mode !== "daily";
    if (mode !== "daily") return;
    const task = todayTask(), map = LCS_MAPS.find((m) => m.id === task.map);
    p.textContent = t(`Сегодня: ${tf(map, "name")}, `, `Today: ${tf(map, "name")}, `)
      + task.modifiers.map((id) => tf(modifier(id), "name")).join(", ") + ".";
  }

  // The modifiers of the next match; the daily task has its own, fixed.
  function renderMods() {
    const box = $("mods");
    clear(box);
    const fixed = mode === "daily", on = fixed ? todayTask().modifiers : mods;
    for (const m of balance.modifiers) {
      const b = el("button", tf(m, "name"), "mod" + (on.includes(m.id) ? " on" : ""));
      b.title = `${tf(m, "text")} · ${t("счёт", "score")} ×${m.score}`;
      b.disabled = fixed;
      b.addEventListener("click", () => {
        mods = mods.includes(m.id) ? mods.filter((id) => id !== m.id) : mods.concat(m.id);
        renderMods();
        savePrefs();
      });
      box.appendChild(b);
    }
    const k = on.reduce((x, id) => x * modifier(id).score, 1);
    $("mods-mul").textContent = on.length ? `· ${t("счёт", "score")} ×${Math.round(k * 100) / 100}` : "";
    $("mods-text").textContent = on.map((id) => `${tf(modifier(id), "name")}: ${tf(modifier(id), "text")}`).join("; ");
  }

  // The menu shows the count and the latest three; all of them are on the achievements screen.
  function renderAchievements(got) {
    const list = $("achievements");
    clear(list);
    const earned = earnedList(got);
    for (const a of earned.slice(0, 3)) {
      const li = el("li", null, "got");
      li.appendChild(el("span", tf(a, "name"), "name"));
      li.appendChild(el("span", tf(a, "text"), "text"));
      list.appendChild(li);
    }
    $("achievements-none").hidden = earned.length > 0;
    $("achievements-count").textContent = `${earned.length}/${balance.achievements.length}`;
  }

  // When an achievement was earned, in milliseconds: DLCs save Date.now(), the SDK's
  // unlock() {at} in seconds. 0 when the save holds no time.
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
      : p.of === "match" ? t("лучший матч", "best match") : t("всего", "so far");
    return `${of}: ${n(p.have)} / ${n(p.need)}`;
  }

  // Every achievement with its icon: the earned ones first with the day, then the locked
  // ones, the closest first, with how far they are when there is something to count.
  function renderAwards({records, got, bests}) {
    const list = $("awards-list");
    clear(list);
    const earned = earnedList(got);
    const share = (x) => (x.p ? x.p.have / x.p.need : -1);
    const locked = balance.achievements.filter((a) => !got[a.id])
      .map((a) => ({a, p: LCSProgress.progressOf(a, records, bests, LCS_MAPS.map((m) => m.id))}))
      .sort((x, y) => share(y) - share(x));
    const item = (a, done, note, p) => {
      const li = el("li", null, done ? "got" : "");
      const icon = el("div", null, "icon");
      icon.appendChild(iconCanvas(a.icon, 40));
      li.appendChild(icon);
      const body = el("div", null, "body");
      body.appendChild(el("div", tf(a, "name"), "name"));
      body.appendChild(el("div", tf(a, "text"), "text"));
      body.appendChild(el("div", note, "when"));
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

  function renderMaps() {
    const box = $("maps");
    clear(box);
    const daily = mode === "daily" ? todayTask().map : null;
    for (const m of LCS_MAPS) {
      const b = el("button", null, "map" + ((daily || mapId) === m.id ? " on" : ""));
      b.disabled = daily !== null && daily !== m.id;
      const pic = el("canvas", null, "preview");
      pic.width = 136;
      pic.height = Math.round(136 * m.height / m.width);
      renderer.preview(m, pic);
      b.appendChild(pic);
      b.appendChild(el("span", tf(m, "name"), "name"));
      b.appendChild(el("span", tf(m, "text"), "text"));
      b.addEventListener("click", () => {
        mapId = m.id;
        renderMaps();
        savePrefs();
      });
      box.appendChild(b);
    }
  }

  // Records and achievements: only for counted matches. Returns the new achievements.
  async function saveProgress(res) {
    const before = await progress();
    const records = LCSProgress.addMatch(before.records, res);
    await Sidequest.storage.set("records", records);
    // The daily streak and the ghost's record live apart from the records by mode.
    res = Object.assign({}, res);
    if (res.mode === "daily") {
      days = LCSProgress.addDay(await Sidequest.storage.get("days"), res);
      await Sidequest.storage.set("days", days);
      res.daily_streak = LCSProgress.streak(days, res.day);
    }
    if (res.mode === "ghost") {
      ghostRecords = LCSProgress.addGhost(await Sidequest.storage.get("ghosts"),
                                          Object.assign({at: Date.now() / 1000}, res));
      await Sidequest.storage.set("ghosts", ghostRecords);
    }
    const got = before.got;
    const fresh = LCSProgress.earned(balance.achievements, res, records, LCS_MAPS.map((m) => m.id))
      .filter((id) => !got[id]);
    for (const id of fresh) got[id] = Date.now();
    if (fresh.length) await Sidequest.storage.set("achievements", got);
    await Sidequest.storage.set("bests", LCSProgress.addBests(before.bests, balance.achievements, res));
    await updateCard(records, got);
    return balance.achievements.filter((a) => fresh.includes(a.id));
  }

  // --- a match ----------------------------------------------------------------------

  // Agents already at work join the new match at once, not on their next event: a long
  // command or a big edit can keep a session quiet for minutes.
  async function joinLiveAgents() {
    let live = [];
    try { live = await Sidequest.live(); } catch (e) { live = []; }
    for (const x of live) {
      if (x.status === "idle" || !game || game.state.over) continue;
      game.agentEvent({kind: "session_start", session: x.session, project: x.project, joined: true,
                       ts: Date.now() / 1000});
    }
  }

  async function startMatch() {
    let options = {seed: Date.now(), map: LCS_MAPS.find((m) => m.id === mapId), mode, modifiers: mods};
    if (mode === "daily") {
      const task = todayTask();
      options = {seed: task.seed, map: LCS_MAPS.find((m) => m.id === task.map), mode,
                 modifiers: task.modifiers, day: task.date};
    } else if (mode === "ghost") {
      if (!ghostId) return;
      const events = await Sidequest.history.events(ghostId);
      options.ghost = {session: ghostId, events};
    }
    game = LCS.createGame(balance, options);
    const v = renderer.view();
    game.setView(v.width, v.height);
    escOpen = false;
    codexFrom = null;
    tips = [];
    tip = null;
    shownEvents = {};
    $("tip").hidden = true;
    choicesKey = "";
    banishing = false;
    buildKey = "";
    buffsKey = "";
    acc = 0;
    keys.clear();
    show(null);
    $("hud").hidden = false;
    Sidequest.match.start();
    joinLiveAgents();
    window.focus();
  }

  const TITLES = {done: ["Последний коммит выстоял", "The last commit stands"],
                  win: ["Конфликт разрешён", "Conflict resolved"],
                  dead: ["Забег окончен", "The run is over"], quit: ["Матч завершён", "Match over"]};

  async function endMatch() {
    const res = game.state.results;
    $("hud").hidden = true;
    codexFrom = null;
    $("results-title").textContent = t(...(TITLES[res.reason] || TITLES.quit));
    const rows = [
      [t("Режим", "Mode"), tf(MODES[res.mode], "name")
        + (res.mode === "classic" && res.with_agent ? t(" с агентом", " with an agent") : "")],
      [t("Карта", "Map"), tf(game.state.map, "name")],
      [t("Счёт", "Score"), res.score], [t("Время", "Time"), clock(res.time)],
      [t("Уровень", "Level"), res.level], [t("Убито", "Kills"), res.kills],
      [t("Боссов", "Bosses"), res.bosses], [t("Лучшая серия", "Best streak"), res.best_streak],
      [t("Получено урона", "Damage taken"), res.damage_taken], [t("Снаряжение", "Gear"), res.gear],
      [t("Оружие", "Weapons"), res.weapons], [t("Эволюций", "Evolutions"), res.evolutions],
    ];
    if (res.mode === "agent") {
      rows.push([t("Смертей", "Deaths"), res.deaths], [t("Агентов", "Agents"), res.allies]);
    }
    if (res.modifiers) {
      rows.push([t("Модификаторы", "Modifiers"),
                 res.modifier_ids.map((id) => tf(modifier(id), "name")).join(", ") + ` (×${res.score_mul})`]);
    }
    // The agent's real work, when there was any.
    for (const [ru, en, key] of [["Коммитов", "Commits", "commits"], ["Пушей", "Pushes", "pushes"],
                                 ["Турелей", "Turrets", "turrets"],
                                 ["Быстрых ответов", "Fast answers", "reviews"],
                                 ["Элитных врагов", "Elite enemies", "elites"],
                                 ["Инцидентов закрыто", "Incidents closed", "incidents"],
                                 ["Деплоев пережито", "Deploys survived", "deploys"]]) {
      if (res[key]) rows.push([t(ru, en), res[key]]);
    }
    fillList($("results-list"), rows);
    $("results-note").hidden = true;
    $("results-new").hidden = true;
    show("results");
    $("results").scrollTop = 0;
    $("btn-again").focus({preventScroll: true});
    const {counted} = await Sidequest.match.end(res);
    if (!counted) { $("results-note").hidden = false; return; }
    const fresh = await saveProgress(res);
    if (fresh.length) {
      const list = $("results-achievements");
      clear(list);
      for (const a of fresh) {
        const li = el("li");
        li.appendChild(el("span", tf(a, "name"), "name"));
        li.appendChild(el("span", tf(a, "text"), "text"));
        list.appendChild(li);
      }
      $("results-new").hidden = false;
    }
  }

  function quit() {
    if (!game || game.state.over) return;
    game.finish("quit");
    endMatch();
  }

  // --- input ------------------------------------------------------------------------

  const MOVE = {KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
                KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0]};

  function input() {
    let x = 0, y = 0;
    for (const code of keys) {
      const m = MOVE[code];
      if (m) { x += m[0]; y += m[1]; }
    }
    return {x: Math.sign(x), y: Math.sign(y)};
  }

  function pick(index) {
    if (!game) return;
    if (banishing) {
      banishing = false;
      game.banish(index);
      choicesKey = "";
    } else if (game.choose(index)) {
      choicesKey = "";
    }
  }

  function reroll() {
    banishing = false;
    if (game) game.reroll();
    choicesKey = "";
  }

  function toggleBanish() {
    banishing = !banishing && game.state.banishes > 0;
    choicesKey = "";
  }

  // e.code, not e.key: WASD works on any keyboard layout.
  addEventListener("keydown", (e) => {
    // A screen is open: the arrows and Enter work its buttons.
    const screen = ["menu", "levelup", "esc", "codex", "awards", "results"].find((id) => !$(id).hidden);
    if (screen && SidequestKeys.handle(e, $(screen))) return;
    if (codexFrom && e.code === "Escape") { closeCodex(); e.preventDefault(); return; }
    if (codexFrom) return;
    if (!game || game.state.over) return;
    if (e.code === "Escape") {
      if (banishing) { banishing = false; choicesKey = ""; }
      else if (!game.state.choices) escOpen = !escOpen;
      e.preventDefault();
      return;
    }
    const digit = /^Digit([1-3])$/.exec(e.code) || /^Numpad([1-3])$/.exec(e.code);
    if (digit && game.state.choices && !escOpen) { pick(Number(digit[1]) - 1); return; }
    if (game.state.choiceKind === "level" && !escOpen) {
      if (e.code === "KeyR") { reroll(); return; }
      if (e.code === "KeyX") { toggleBanish(); return; }
    }
    if (MOVE[e.code]) { keys.add(e.code); e.preventDefault(); }
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  addEventListener("mousedown", () => window.focus());

  // --- HUD and overlays -------------------------------------------------------------

  const ALLY_STATE = (a) => a.state === "leaving" || a.state === "gone" ? t("задача готова", "task done")
    : a.stun > 0 ? t("ошибка", "error") : a.blocked > 0 ? t("запрет", "blocked")
    : a.meditate > 0 ? t("сжимает контекст", "compacting")
    : a.waiting ? t("ждёт ответа", "waiting for you")
    : a.spirits.size ? t("духов: ", "spirits: ") + a.spirits.size : "";

  function updateHud() {
    const s = game.state, p = s.player;
    $("xp-fill").style.width = Math.min(100, s.xp / s.xpNext * 100) + "%";
    $("xp-text").textContent = t("ур. ", "lv. ") + s.level;
    $("time").textContent = s.solo
      ? `${clock(s.time)} / ${clock(balance.classic.seconds)}` : clock(s.time);
    $("score").textContent = `${t("счёт", "score")} ${Math.floor(s.score * s.scoreMul)}`;
    $("multiplier").textContent = s.multiplier > 1 ? `×${s.multiplier}` : "";

    updateBuild(s);
    updateBuffs(s);

    const list = $("allies");
    clear(list);
    for (const a of s.allies) {
      const li = el("li");
      const sw = el("span", null, "swatch");
      sw.style.backgroundColor = a.color;
      li.appendChild(sw);
      li.appendChild(el("span", a.project, "project"));
      li.appendChild(el("span", ALLY_STATE(a), "state"));
      list.appendChild(li);
    }

    const notice = $("notice");
    let message = "";
    if (s.finaleAt !== null) {
      message = t("Все задачи готовы — финал через ", "All tasks done — the finale in ")
        + Math.ceil(s.finaleAt - s.time);
    } else if (!s.everAlly && s.mode === "ghost") {
      message = t("Призрак сессии вот-вот появится", "The session ghost is about to appear");
    } else if (!s.everAlly && s.mode === "agent") {
      message = t("Ждём агента: дай Claude Code задачу", "Waiting for an agent: give Claude Code a task");
    }
    notice.textContent = message;
    notice.hidden = !message;
  }

  // Weapons and passives held, with their levels; redrawn only when they change.
  // What is on right now, with the seconds left; one about to end blinks.
  function activeBuffs(s) {
    const I = balance.items, AG = balance.agent, p = s.player, list = [];
    const timed = (id, icon, name, left, total, cls) =>
      list.push({id, icon, cls, text: `${name} ${Math.ceil(left)}`, ending: left / total < 0.25});
    if (s.buffs.coffee > 0) timed("coffee", "coffee", t("кофе", "coffee"), s.buffs.coffee, I.coffee.seconds);
    if (s.buffs.duck > 0) timed("duck", "duck", t("уточка", "duck"), s.buffs.duck, I.duck.seconds);
    if (p.shield > 0) list.push({id: "shield", icon: "shield", cls: "blue", text: "×" + p.shield});
    if (s.rage > 0) timed("rage", null, t("ЯРОСТЬ", "RAGE"), s.rage, balance.rage.seconds, "red");
    if (s.redCi > 0) timed("red-ci", "red_ci", t("КРАСНЫЙ CI", "RED CI"), s.redCi, AG.red_ci.seconds, "red");
    if (s.orchestra) list.push({id: "orchestra", icon: "orchestra", cls: "violet", text: t("ОРКЕСТР", "ORCHESTRA")});
    if (s.deploy) list.push({id: "deploy", cls: "orange", text: t("ДЕПЛОЙ ", "DEPLOY ") + Math.ceil(s.deploy.left)});
    if (s.incident) {
      list.push({id: "incident", cls: "red", text: t("ИНЦИДЕНТ ", "INCIDENT ")
        + `${Math.floor(s.incident.held)}/${balance.events.incident.hold} · ${Math.ceil(s.incident.left)}`});
    }
    return list;
  }

  function updateBuffs(s) {
    const list = activeBuffs(s), box = $("buffs");
    const key = list.map((b) => b.id).join(" ");
    if (key !== buffsKey) {
      buffsKey = key;
      clear(box);
      for (const b of list) {
        const chip = el("span", null, "buff" + (b.cls ? " " + b.cls : ""));
        if (b.icon) chip.appendChild(iconCanvas(b.icon, 28));
        chip.appendChild(el("span"));
        box.appendChild(chip);
      }
    }
    list.forEach((b, i) => {
      const chip = box.children[i];
      chip.lastChild.textContent = b.text;
      chip.classList.toggle("ending", !!b.ending);
    });
  }

  function updateBuild(s) {
    const key = JSON.stringify([s.weapons.map((w) => [w.id, w.level, w.evolved]), s.taken]);
    if (key === buildKey) return;
    buildKey = key;
    const box = $("build");
    clear(box);
    const slot = (icon, level, gold, title) => {
      const item = el("span", null, "slot" + (gold ? " gold" : ""));
      item.appendChild(iconCanvas(icon, 38, gold));
      item.appendChild(el("span", gold ? "★" : String(level), "lv"));
      item.title = title;
      return item;
    };
    const weapons = el("span", null, "slots");
    for (const w of s.weapons) {
      const cfg = balance.weapons.find((x) => x.id === w.id);
      weapons.appendChild(slot(w.id, w.level, w.evolved, w.evolved ? tf(cfg.evolution, "name") : tf(cfg, "name")));
    }
    const passives = el("span", null, "slots");
    for (const [id, level] of Object.entries(s.taken)) {
      passives.appendChild(slot(id, level, false, tf(balance.upgrades.find((u) => u.id === id), "name")));
    }
    box.appendChild(weapons);
    box.appendChild(passives);
  }

  const KIND_TAGS = {evolution: ["ЭВОЛЮЦИЯ", "EVOLUTION"], filler: ["ВСЁ СОБРАНО", "ALL MAXED"]};

  function choiceCard(c, i, chest) {
    const b = el("button", null, "choice " + c.kind + (banishing && !chest ? " banishing" : ""));
    const head = el("span", null, "head");
    head.appendChild(el("span", String(i + 1), "key"));
    const tag = KIND_TAGS[c.kind] ? t(...KIND_TAGS[c.kind])
      : c.fresh ? t("НОВОЕ", "NEW")
      : c.kind === "weapon" || c.kind === "passive" ? t("ур. ", "lv. ") + c.level : "";
    head.appendChild(el("span", tag, "tag"));
    b.appendChild(head);
    b.appendChild(iconCanvas(c.icon, 48, c.kind === "evolution"));
    b.appendChild(el("span", tf(c, "name"), "name"));
    b.appendChild(el("span", tf(c, "text"), "text"));
    b.addEventListener("click", () => pick(i));
    return b;
  }

  function updateOverlays() {
    const s = game.state;
    if (codexFrom) return;
    if (s.choices && !escOpen) {
      const key = JSON.stringify(s.choices) + s.level + s.choiceKind + banishing + s.rerolls
        + s.banishes;
      if (key !== choicesKey) {
        choicesKey = key;
        const chest = s.choiceKind === "chest";
        $("choices-title").textContent = chest ? t("Сундук: выбери вещь", "Chest: pick an item")
          : banishing ? t("Что исключить до конца матча?", "Banish what for the rest of the match?")
          : t("Новый уровень", "Level up");
        const box = $("choices");
        clear(box);
        s.choices.forEach((c, i) => box.appendChild(choiceCard(c, i, chest)));
        const canBanish = s.choices.some((c) => c.kind === "weapon" || c.kind === "passive");
        $("choice-actions").hidden = chest;
        $("btn-reroll").textContent = t("Перебросить", "Reroll") + ` (R) ×${s.rerolls}`;
        $("btn-reroll").disabled = s.rerolls <= 0;
        $("btn-banish").textContent = banishing ? t("Отмена (X)", "Cancel (X)")
          : t("Исключить", "Banish") + ` (X) ×${s.banishes}`;
        $("btn-banish").disabled = !banishing && (s.banishes <= 0 || !canBanish);
      }
      show("levelup");
    } else {
      show(escOpen ? "esc" : null);
    }
  }

  // --- handbook and first-time hints ----------------------------------------------

  // The handbook and the achievements screen open over the menu or the pause and go back there.
  function openCodex(from, screen = "codex") {
    codexFrom = from;
    codexScreen = screen;
    if (screen === "codex") renderCodex();
    show(screen);
    $(screen + "-list").scrollTop = 0;
  }

  async function openAwards(from) {
    renderAwards(await progress());
    openCodex(from, "awards");
  }

  function closeCodex() {
    const from = codexFrom;
    codexFrom = null;
    if (from === "menu") {
      show("menu");
      $(codexScreen === "codex" ? "btn-codex" : "btn-awards").focus({preventScroll: true});
    } else {
      show("esc");   // the match stays paused under the handbook
    }
  }

  function renderCodex() {
    const sections = LCSCodex.sections(balance);
    const tabs = $("codex-tabs");
    clear(tabs);
    for (const sec of sections) {
      const b = el("button", t(...sec.name), sec.id === codexTab ? "on" : "");
      b.addEventListener("click", () => { codexTab = sec.id; renderCodex(); });
      tabs.appendChild(b);
    }
    const list = $("codex-list");
    clear(list);
    const sec = sections.find((x) => x.id === codexTab) || sections[0];
    for (const e of sec.entries) {
      const li = el("li");
      const icon = el("div", null, "icon");
      if (e.icon) icon.appendChild(iconCanvas(e.icon, 48, e.gold));
      li.appendChild(icon);
      const body = el("div");
      body.appendChild(el("div", t(...e.name), "name"));
      body.appendChild(el("div", t(...e.text), "text"));
      li.appendChild(body);
      list.appendChild(li);
    }
  }

  // The first time ever the player meets an item or an enemy: a hint for a few seconds of
  // game time, one after another. What was shown is remembered in the DLC storage.
  // An arena event gets its hint every time it starts, right away: it is easy to forget
  // what a deploy or an incident wants from you.
  function updateTips() {
    const s = game.state;
    let fresh = false;
    for (const id of Object.keys(s.met)) {
      if (seen[id]) continue;
      seen[id] = Date.now();
      fresh = true;
      const entry = LCSCodex.entry(balance, id);
      if (entry && entry.kind !== "event") tips.push(entry);
    }
    if (fresh) Sidequest.storage.set("seen", seen);
    for (const id of ["deploy", "incident"]) {
      if (s[id] && s[id] !== shownEvents[id]) {
        tips.unshift(LCSCodex.entry(balance, id));
        tip = null;
      }
      shownEvents[id] = s[id];
    }
    if (tip && s.time >= tip.until) tip = null;
    if (!tip && tips.length) {
      const e = tips.shift();
      tip = {until: s.time + TIP_SECONDS};
      const icon = $("tip-icon"), src = iconCanvas(e.icon, 40);
      icon.width = src.width;
      icon.height = src.height;
      icon.getContext("2d").drawImage(src, 0, 0);
      icon.style.width = src.style.width;
      icon.style.height = src.style.height;
      $("tip-title").textContent = (e.kind === "enemy" ? t("Новый враг: ", "New enemy: ")
                                    : e.kind === "event" ? t("Событие: ", "Event: ")
                                    : t("Новое: ", "New: ")) + t(...e.name);
      $("tip-text").textContent = t(...e.text);
    }
    $("tip").hidden = !tip;
  }

  // How far down a tip raised on a short field must stay: under the boss bars, and under the
  // allies when it is wide enough to reach them. The width comes from CSS even while hidden.
  function tipClearance() {
    let y = renderer.bossBarsBottom();
    const list = $("allies").getBoundingClientRect();
    const tipLeft = (innerWidth - parseFloat(getComputedStyle($("tip")).width)) / 2;
    if (list.height && list.right > tipLeft) y = Math.max(y, list.bottom);
    return Math.ceil(y);
  }

  // --- the loop ---------------------------------------------------------------------

  function frame(now) {
    requestAnimationFrame(frame);
    if (!game || game.state.over) return;
    if (now - lastDraw < 1000 / fpsLimit - 2) return;
    const dt = Math.min(0.25, (now - lastDraw) / 1000 || 0);
    lastDraw = now;

    // The hub pauses the game while an agent waits for its user or goes silent.
    const running = !escOpen && !Sidequest.paused && !document.hidden;
    if (running) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        game.step(STEP, input());
        acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) acc = 0;
      const v = renderer.view();
      game.setView(v.width, v.height);
    } else {
      acc = 0;
    }
    renderer.draw(game.state, sprite);
    updateOverlays();
    if (now - hudAt > 100) {
      hudAt = now;
      updateHud();
      updateTips();
      $("tip").style.setProperty("--clear-top", tipClearance() + "px");
    }
    if (game.state.over) endMatch();
  }

  // --- Sidequest --------------------------------------------------------------------

  Sidequest.on("*", (e) => {
    if (game && !game.state.over) game.agentEvent(e);
  });

  function dev(id, label, fn) {
    Sidequest.dev.command(id, label, () => { if (game && !game.state.over) fn(game.dev); });
  }
  dev("immortal", "Бессмертие", (d) => d.immortal());
  dev("level", "+уровень", (d) => d.level());
  dev("upgrade", "Улучшение", (d) => d.upgrade());
  dev("weapon", "Оружие", (d) => d.weapon());
  dev("evolve", "Эволюция", (d) => d.evolve());
  dev("wave", "Волна", (d) => d.wave());
  dev("boss", "Босс", (d) => d.boss());
  dev("boss_oom", "Босс: Out of memory", (d) => d.boss("boss_oom"));
  dev("boss_loop", "Босс: Бесконечный цикл", (d) => d.boss("boss_loop"));
  dev("boss_race", "Босс: Data race", (d) => d.boss("boss_race"));
  dev("boss_fire", "Босс: Прод упал", (d) => d.boss("boss_fire"));
  dev("bestiary", "Все новые враги", (d) => {
    for (const type of ["flaky", "spaghetti", "offbyone", "debt", "logspam", "regression", "scope", "monolith"]) {
      d.enemy(type);
    }
  });
  dev("elite", "Элитный враг", (d) => d.elite());
  dev("deploy", "Пятничный деплой", (d) => d.event("deploy"));
  dev("incident", "Инцидент", (d) => d.event("incident"));
  dev("item", "Предмет", (d) => d.item());
  dev("chest", "Сундук", (d) => d.chest());
  dev("enemy", "Враг карты", (d) => d.enemy());
  dev("final", "Финальный босс", (d) => d.final());
  dev("finale", "Финал", (d) => d.finale());

  $("btn-play").addEventListener("click", startMatch);
  $("btn-resume").addEventListener("click", () => { escOpen = false; window.focus(); });
  $("btn-quit").addEventListener("click", () => { escOpen = false; quit(); });
  $("btn-again").addEventListener("click", openMenu);
  $("btn-hub").addEventListener("click", () => Sidequest.exit());
  $("btn-codex").addEventListener("click", () => openCodex("menu"));
  $("btn-esc-codex").addEventListener("click", () => openCodex("esc"));
  $("btn-codex-back").addEventListener("click", closeCodex);
  $("btn-awards").addEventListener("click", () => openAwards("menu"));
  $("btn-esc-awards").addEventListener("click", () => openAwards("esc"));
  $("btn-awards-back").addEventListener("click", closeCodex);
  $("btn-reroll").addEventListener("click", reroll);
  $("btn-banish").addEventListener("click", toggleBanish);

  Sidequest.ready().then(async () => {
    SidequestI18n.apply(document);  // the SDK has set the language from the hub
    balance = await Sidequest.balance();
    const settings = await Sidequest.settings();
    fpsLimit = settings.fps_limit === 30 ? 30 : 60;
    renderer = LCSRender.createRenderer($("arena"), balance, $("top"));
    await openMenu();
    // The hub's card links straight to the achievements.
    if (Sidequest.info.screen === "achievements") await openAwards("menu");
    requestAnimationFrame((now) => { lastDraw = now; frame(now); });
  });
})();
