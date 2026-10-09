// Last Commit Standing: screens, input, the loop and the link to Sidequest.
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);
  const STEP = 1 / 60;
  const MAX_STEPS = 5;  // per frame; after a long stall the game slows down instead of jumping

  let balance = null;
  let renderer = null;
  let profile = null;
  let fpsLimit = 60;
  let game = null;
  let escOpen = false;
  let lastDraw = 0, acc = 0, hudAt = 0;
  let choicesKey = "";
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
    for (const s of ["menu", "levelup", "esc", "results"]) $(s).hidden = s !== id;
  }

  function clock(seconds) {
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function fillList(dl, rows) {
    clear(dl);
    for (const [k, v] of rows) { dl.appendChild(el("dt", k)); dl.appendChild(el("dd", v)); }
  }

  // --- menu and records -------------------------------------------------------------

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
    const r = (await Sidequest.storage.get("records")) || {};
    fillList($("records"), [
      ["Лучший счёт", r.best_score || 0],
      ["Дольше всего", clock(r.best_time || 0)],
      ["Лучший уровень", r.best_level || 0],
      ["Матчей", r.matches || 0],
      ["Убито всего", r.kills || 0],
    ]);
    $("btn-play").focus();
  }

  async function saveRecords(res) {
    const r = (await Sidequest.storage.get("records")) || {};
    await Sidequest.storage.set("records", {
      best_score: Math.max(r.best_score || 0, res.score),
      best_time: Math.max(r.best_time || 0, res.time),
      best_level: Math.max(r.best_level || 0, res.level),
      matches: (r.matches || 0) + 1,
      kills: (r.kills || 0) + res.kills,
    });
  }

  // --- a match ----------------------------------------------------------------------

  function startMatch() {
    game = LCS.createGame(balance, {seed: Date.now()});
    escOpen = false;
    choicesKey = "";
    acc = 0;
    keys.clear();
    show(null);
    $("hud").hidden = false;
    Sidequest.match.start();
    window.focus();
  }

  async function endMatch() {
    const res = game.state.results;
    $("hud").hidden = true;
    $("results-title").textContent = res.reason === "done"
      ? "Последний коммит выстоял" : "Матч завершён";
    fillList($("results-list"), [
      ["Счёт", res.score], ["Время", clock(res.time)], ["Уровень", res.level],
      ["Убито", res.kills], ["Лучшая серия", res.best_streak], ["Смертей", res.deaths],
      ["Получено урона", res.damage_taken], ["Агентов", res.allies],
    ]);
    $("results-note").hidden = true;
    show("results");
    $("btn-again").focus();
    const {counted} = await Sidequest.match.end(res);
    if (counted) await saveRecords(res);
    else $("results-note").hidden = false;
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
    if (game && game.choose(index)) choicesKey = "";
  }

  // e.code, not e.key: WASD works on any keyboard layout.
  addEventListener("keydown", (e) => {
    if (!game || game.state.over) return;
    if (e.code === "Escape") {
      if (!game.state.choices) escOpen = !escOpen;
      e.preventDefault();
      return;
    }
    const digit = /^Digit([1-3])$/.exec(e.code) || /^Numpad([1-3])$/.exec(e.code);
    if (digit && game.state.choices && !escOpen) { pick(Number(digit[1]) - 1); return; }
    if (MOVE[e.code]) { keys.add(e.code); e.preventDefault(); }
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  addEventListener("mousedown", () => window.focus());

  // --- HUD and overlays -------------------------------------------------------------

  const ALLY_STATE = (a) => a.state === "leaving" || a.state === "gone" ? "задача готова"
    : a.stun > 0 ? "ошибка" : a.blocked > 0 ? "запрет" : a.meditate > 0 ? "сжимает контекст"
    : a.spirits.size ? `духов: ${a.spirits.size}` : "";

  function updateHud() {
    const s = game.state, p = s.player;
    $("hp-fill").style.width = Math.max(0, p.hp / s.stats.max_hp * 100) + "%";
    $("hp-text").textContent = p.dead > 0 ? "воскрешение…" : `${Math.ceil(p.hp)} / ${Math.round(s.stats.max_hp)}`;
    $("xp-fill").style.width = Math.min(100, s.xp / s.xpNext * 100) + "%";
    $("xp-text").textContent = `ур. ${s.level}`;
    $("time").textContent = clock(s.time);
    $("score").textContent = `счёт ${Math.floor(s.score)}`;
    $("multiplier").textContent = s.multiplier > 1 ? `×${s.multiplier}` : "";
    $("rage").hidden = s.rage <= 0;

    const list = $("allies");
    clear(list);
    for (const a of s.allies) {
      const li = el("li");
      const sw = el("span", null, "swatch");
      sw.style.backgroundColor = a.color;
      li.appendChild(sw);
      li.appendChild(el("span", a.project));
      li.appendChild(el("span", ALLY_STATE(a), "state"));
      list.appendChild(li);
    }

    const notice = $("notice");
    let message = "";
    if (s.finaleAt !== null) message = `Все задачи готовы — финал через ${Math.ceil(s.finaleAt - s.time)}`;
    else if (!s.everAlly) message = "Ждём агента: дай Claude Code задачу";
    notice.textContent = message;
    notice.hidden = !message;
  }

  function updateOverlays() {
    const s = game.state;
    if (s.choices && !escOpen) {
      const key = JSON.stringify(s.choices) + s.level;
      if (key !== choicesKey) {
        choicesKey = key;
        const box = $("choices");
        clear(box);
        s.choices.forEach((c, i) => {
          const b = el("button", null, "choice");
          b.appendChild(el("span", String(i + 1), "key"));
          b.appendChild(el("span", c.level > 1 ? `${c.name} ${c.level}` : c.name, "name"));
          b.appendChild(el("span", c.text, "text"));
          b.addEventListener("click", () => pick(i));
          box.appendChild(b);
        });
      }
      show("levelup");
    } else {
      show(escOpen ? "esc" : null);
    }
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
    } else {
      acc = 0;
    }
    renderer.draw(game.state, sprite);
    updateOverlays();
    if (now - hudAt > 100) { hudAt = now; updateHud(); }
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
  dev("wave", "Волна", (d) => d.wave());
  dev("boss", "Босс", (d) => d.boss());
  dev("finale", "Финал", (d) => d.finale());

  $("btn-play").addEventListener("click", startMatch);
  $("btn-resume").addEventListener("click", () => { escOpen = false; window.focus(); });
  $("btn-quit").addEventListener("click", () => { escOpen = false; quit(); });
  $("btn-again").addEventListener("click", openMenu);

  Sidequest.ready().then(async () => {
    balance = await Sidequest.balance();
    const settings = await Sidequest.settings();
    fpsLimit = settings.fps_limit === 30 ? 30 : 60;
    renderer = LCSRender.createRenderer($("arena"), balance);
    await openMenu();
    requestAnimationFrame((now) => { lastDraw = now; frame(now); });
  });
})();
