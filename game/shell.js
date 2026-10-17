// The page around the arena: the status bar, the Claude Code screen (connection,
// self-check, sessions, journal), settings, the agents' pause and the dev panel.
// Event data is only ever shown with textContent, never as HTML.
"use strict";

let api = null;
let status = null;
let replayInfo = null;
const JOURNAL_MAX = 200;

const $ = (id) => document.getElementById(id);
const t = (ru, en) => SidequestI18n.t(ru, en);

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (cls) node.className = cls;
  return node;
}

function button(text, onClick, cls) {
  const b = el("button", text, cls);
  b.addEventListener("click", onClick);
  return b;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function time(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(t("ru-RU", "en-GB"), {hour12: false});
}

function duration(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? t(`${h} ч ${m} мин`, `${h} h ${m} min`) : t(`${m} мин`, `${m} min`);
}

// --- events ------------------------------------------------------------------------

const ACTIONS = {attack: ["правка", "edit"], scout: ["чтение", "read"], cast: ["команда", "command"],
                 scout_far: ["веб", "web"], summon: ["сабагент", "subagent"], todo: ["todo", "todo"],
                 generic: ["инструмент", "tool"]};
const BLOCK_REASONS = {rule: ["запрещено правилом", "denied by a rule"],
                       rejected: ["отказано в диалоге", "rejected in the dialog"],
                       denied: ["отказ автомода", "denied by auto mode"]};
const pair = (table, key) => table[key] ? t(...table[key]) : key;

function describe(e) {
  switch (e.kind) {
    case "session_start": return e.joined ? t("сессия (подключились посреди)", "session (joined midway)")
      : t("сессия началась", "session started");
    case "session_end": return t("сессия закончилась", "session ended");
    case "prompt": return t("новый промпт", "new prompt");
    case "tool": {
      let s = `${pair(ACTIONS, e.action)} · ${e.tool}`;
      if (e.category && e.category !== "other") s += ` (${e.category})`;
      if (Array.isArray(e.git) && e.git.length) s += ` · ${e.git.join(" + ")}`;
      if (e.file) s += ` · ${e.file}`;
      if (e.lines_added || e.lines_removed) s += ` +${e.lines_added || 0}/-${e.lines_removed || 0}`;
      if (e.agent) s += t(" · сабагент", " · subagent");
      return s;
    }
    case "tool_error": {
      let s = `${t("ошибка", "error")} · ${e.tool}`;
      if (e.category && e.category !== "other") s += ` (${e.category})`;
      if (e.exit_code !== null && e.exit_code !== undefined) s += ` · ${t("код", "code")} ${e.exit_code}`;
      return s;
    }
    case "blocked": return `${t("запрет", "blocked")} · ${e.tool || "?"} · ${pair(BLOCK_REASONS, e.reason)}`;
    case "waiting": return `${t("ждёт ответа", "waiting for an answer")} · ${e.tool || ""}`;
    case "silent": return t(`агент молчит ${e.seconds} сек`, `agent silent for ${e.seconds} sec`);
    case "resumed": return e.source === "button" ? t("продолжено кнопкой", "resumed with the button")
      : t("продолжил", "resumed");
    case "compact": return e.phase === "start" ? "compaction…" : t("compaction закончен", "compaction done");
    case "subagent_start": return `${t("сабагент запущен", "subagent started")} · ${e.agent_type || ""}`;
    case "subagent_stop": return t("сабагент закончил", "subagent finished");
    case "todo": return `todo · ${e.change}`;
    case "stop": return e.manual ? t("матч завершён кнопкой", "match ended with the button")
      : e.final ? t("задача закончена", "task done")
      : t(`ход закончен, фоновых задач: ${e.background}`, `turn over, background tasks: ${e.background}`);
    case "unknown": return `${t("незнакомое событие", "unknown event")} · ${e.event}`;
    default: return e.kind;
  }
}

let journalEvents = [];  // newest first, kept to redraw the journal in another language

function addJournal(e, prepend) {
  if (prepend) journalEvents.unshift(e); else journalEvents.push(e);
  journalEvents.length = Math.min(journalEvents.length, JOURNAL_MAX);
  const list = $("journal");
  const li = el("li");
  li.appendChild(el("span", time(e.ts) + " "));
  li.appendChild(el("span", (e.project || "?") + " · ", "tag"));
  li.appendChild(el("span", describe(e), e.kind === "tool_error" || e.kind === "blocked" ? "bad" : ""));
  if (e.replay) li.appendChild(el("span", " ⟲", "tag"));
  if (prepend) list.insertBefore(li, list.firstChild); else list.appendChild(li);
  while (list.children.length > JOURNAL_MAX) list.removeChild(list.lastChild);
}

async function drain() {
  const events = await api.drain();
  let refresh = false;
  for (const e of events) {
    addJournal(e, true);
    Sidequest.shell.deliver(e);
    if (["waiting", "resumed", "silent", "session_start", "session_end", "stop", "prompt"].includes(e.kind)) {
      refresh = true;
    }
  }
  if (refresh) refreshStatus();
}

window.__sidequestWake = () => { if (api) drain(); };

// --- status, pause, self-check -----------------------------------------------------

const INDICATOR_TEXT = {green: ["Всё в порядке", "All good"], yellow: ["Есть что проверить", "Worth a look"],
                        red: ["Не работает", "Not working"]};
const STATUS_TEXT = {working: ["работает", "working"], idle: ["ждёт промпт", "waiting for a prompt"],
                     waiting: ["ждёт ответа", "waiting for an answer"], silent: ["молчит", "silent"]};

async function refreshStatus() {
  status = await api.status();
  const ind = $("btn-agent");
  ind.className = "indicator " + status.indicator;
  let text = pair(INDICATOR_TEXT, status.indicator);
  if (!status.connected) text = t("Не подключено к Claude Code", "Not connected to Claude Code");
  else if (status.control.active) text = t("Контрольная сессия ", "Control session ") + status.control.version;
  $("indicator-text").textContent = text;
  $("btn-connect").textContent = status.connected ? t("Отключить от Claude Code", "Disconnect from Claude Code")
                                                  : t("Подключить к Claude Code", "Connect to Claude Code");
  $("first-event").hidden = !status.waiting_first_event;

  const sessions = $("sessions");
  clear(sessions);
  for (const s of status.sessions) {
    const li = el("li");
    li.appendChild(el("span", (s.project || "?") + " "));
    li.appendChild(el("span", pair(STATUS_TEXT, s.status), s.status === "working" ? "ok" : "tag"));
    sessions.appendChild(li);
  }
  if (!status.sessions.length) sessions.appendChild(el("li", t("нет активных", "none active"), "tag"));

  renderChecks(status.checks);
  renderPause(status.paused);
  $("game-flag").hidden = !(status.tainted || status.replaying);
  $("dev").hidden = !status.dev;
}

function renderChecks(checks) {
  const list = $("checks");
  clear(list);
  for (const c of checks) {
    const li = el("li");
    li.appendChild(el("span", (c.ok ? (c.warn ? "! " : "✓ ") : "✗ ") + c.name + ": ",
                      c.ok ? (c.warn ? "warn" : "ok") : "bad"));
    li.appendChild(el("span", c.detail));
    list.appendChild(li);
    if (c.fix && (!c.ok || c.warn)) list.appendChild(el("li", "→ " + c.fix, "fix"));
  }
  if (status) {
    const report = status.control.report;
    if (report && report.length) {
      list.appendChild(el("li", t("Контрольная сессия: есть замечания", "Control session: some remarks"), "warn"));
      for (const r of report) list.appendChild(el("li", "→ " + r, "fix"));
    } else if (report) {
      list.appendChild(el("li", t("Контрольная сессия: всё на месте", "Control session: everything in place"), "ok"));
    }
    for (const [name, n] of Object.entries(status.unknown_events)) {
      list.appendChild(el("li", `! ${t("незнакомое событие", "unknown event")} ${name} ×${n}`, "warn"));
    }
    for (const [name, n] of Object.entries(status.unknown_tools)) {
      list.appendChild(el("li", `! ${t("незнакомый инструмент", "unknown tool")} ${name} ×${n}`, "warn"));
    }
  }
  if (!list.children.length) list.appendChild(el("li", t("проверка идёт…", "checking…"), "tag"));
}

let lastPauseKey = "";
function renderPause(paused) {
  const overlay = $("agent-pause");
  const key = JSON.stringify(paused);
  if (key === lastPauseKey) return;
  lastPauseKey = key;
  const wasHidden = overlay.hidden;
  overlay.hidden = paused.length === 0;
  Sidequest.shell.setPaused(paused.length > 0, paused);
  // The keys follow the overlay: to its buttons while it is up, back to the game after.
  if (!paused.length) {
    if (!wasHidden && document.activeElement) document.activeElement.blur();
    return;
  }
  const anyWaiting = paused.some((p) => p.reason === "waiting");
  $("agent-pause-title").textContent = anyWaiting
    ? t("Claude ждёт ответа в терминале", "Claude is waiting for an answer in the terminal")
    : t("Агент молчит — возможно, его прервали", "The agent is silent — maybe it was interrupted");
  const list = $("agent-pause-list");
  clear(list);
  for (const p of paused) {
    const li = el("li");
    li.appendChild(el("span", `${p.project || "?"} · ${pair(STATUS_TEXT, p.reason === "waiting" ? "waiting" : "silent")}`));
    if (p.reason === "silent") {
      li.appendChild(button(t("Завершить матч", "End the match"), () => api.end_match(p.session).then(refreshStatus)));
    }
    list.appendChild(li);
  }
  if (wasHidden) $("btn-agent-resume").focus();
}

async function runCheck() {
  $("indicator-text").textContent = t("Проверка…", "Checking…");
  await api.run_check();
  await refreshStatus();
}

// --- modal dialogs -----------------------------------------------------------------

function modal(title, body, actions, options) {
  $("modal").querySelector(".dialog").classList.toggle("wide", !!(options && options.wide));
  $("modal-title").textContent = title;
  const b = $("modal-body");
  clear(b);
  for (const node of body) b.appendChild(node);
  const a = $("modal-actions");
  clear(a);
  for (const [label, fn, cls] of actions) a.appendChild(button(label, fn, cls));
  $("modal").hidden = false;
}
function closeModal() { $("modal").hidden = true; }

async function connectFlow() {
  if (status && status.connected) return disconnectFlow();
  const p = await api.install_preview();
  if (!p.ok) return modal(t("Не получилось", "Failed"), [el("p", p.error)], [[t("Закрыть", "Close"), closeModal]]);
  if (!p.changes.length) {
    return modal(t("Уже подключено", "Already connected"), [el("p", t("Все записи на месте.", "All entries are in place."))],
                 [[t("Закрыть", "Close"), closeModal]]);
  }
  const lines = p.changes.map((c) => `${c.event}: ${c.what}`).join("\n");
  modal(t("Подключить к Claude Code", "Connect to Claude Code"), [
    el("p", t(`В ${p.path} будут добавлены хуки Sidequest. Перед записью будет сделана резервная копия.`,
              `Sidequest hooks will be added to ${p.path}. A backup is made before writing.`)),
    el("p", t("Скрипт: ", "Script: ") + p.script, "tag"),
    el("pre", lines),
  ], [[t("Отмена", "Cancel"), closeModal], [t("Подключить", "Connect"), async () => {
    const r = await api.install_apply();
    modal(r.ok ? t("Подключено", "Connected") : t("Ошибка", "Error"), [
      el("p", r.ok ? t("Уже открытые сессии Claude Code, возможно, нужно перезапустить.",
                       "Claude Code sessions that are already open may need a restart.") : r.error),
      el("p", r.backup ? t("Резервная копия: ", "Backup: ") + r.backup : "", "tag"),
    ], [[t("Закрыть", "Close"), closeModal]]);
    refreshStatus();
  }, "primary"]]);
}

async function disconnectFlow() {
  const p = await api.uninstall_preview();
  if (!p.ok) return modal(t("Не получилось", "Failed"), [el("p", p.error)], [[t("Закрыть", "Close"), closeModal]]);
  const core = el("input"); core.type = "checkbox";
  const saves = el("input"); saves.type = "checkbox";
  const coreLabel = el("label"); coreLabel.appendChild(core); coreLabel.appendChild(el("span", t(" Профиль и общая статистика", " Profile and shared stats")));
  const savesLabel = el("label"); savesLabel.appendChild(saves); savesLabel.appendChild(el("span", t(" Сохранения игры: рекорды, ачивки, персонаж", " The game's saves: records, achievements, the character")));
  modal(t("Отключить от Claude Code", "Disconnect from Claude Code"), [
    el("p", t(`Из ${p.path} будут удалены только записи Sidequest (${p.changes.length}). Будет сделана резервная копия.`,
              `Only Sidequest entries (${p.changes.length}) will be removed from ${p.path}. A backup is made.`)),
    el("p", t("Заодно удалить данные:", "Also delete data:")), coreLabel, savesLabel,
  ], [[t("Отмена", "Cancel"), closeModal], [t("Отключить", "Disconnect"), async () => {
    const r = await api.uninstall_apply(core.checked, saves.checked);
    modal(r.ok ? t("Отключено", "Disconnected") : t("Ошибка", "Error"),
          [el("p", r.ok ? t("Хуки Sidequest удалены.", "Sidequest hooks removed.") : r.error)],
          [[t("Закрыть", "Close"), closeModal]]);
    refreshStatus(); loadProfile(); Sidequest.shell.profileChanged();
  }, "primary"]]);
}

async function settingsFlow() {
  const s = await api.get_settings();
  const silence = el("input"); silence.type = "number"; silence.min = 10; silence.max = 3600;
  silence.value = s.silence_pause_seconds;
  const fps = el("select");
  for (const v of [30, 60]) { const o = el("option", v); o.value = v; o.selected = v === s.fps_limit; fps.appendChild(o); }
  const language = el("select");
  for (const [v, label] of [["en", "English"], ["ru", "Русский"], ["auto", t("Как в системе", "System")]]) {
    const o = el("option", label); o.value = v; o.selected = v === s.language; language.appendChild(o);
  }
  const l1 = el("label");
  l1.appendChild(el("span", t("Пауза, если агент молчит дольше, сек: ", "Pause when the agent is silent longer than, sec: ")));
  l1.appendChild(silence);
  const l2 = el("label"); l2.appendChild(el("span", t("Ограничение FPS: ", "FPS limit: "))); l2.appendChild(fps);
  const l3 = el("label"); l3.appendChild(el("span", t("Язык: ", "Language: "))); l3.appendChild(language);
  modal(t("Настройки", "Settings"), [l1, l2, l3], [[t("Отмена", "Cancel"), closeModal], [t("Сохранить", "Save"), async () => {
    await api.set_setting("silence_pause_seconds", Number(silence.value));
    await api.set_setting("fps_limit", Number(fps.value));
    const changed = language.value !== s.language;
    await api.set_setting("language", language.value);
    closeModal();
    // The whole page is drawn again in the other language; the core keeps running.
    if (changed) location.reload();
  }, "primary"]]);
}

// --- profile -------------------------------------------------------------------------

let profile = null;
let stopAvatar = () => {};

// The name and the picture on the menu, the agent's work on the Claude Code screen.
async function loadProfile() {
  const p = profile = await api.profile();
  $("profile-name").value = p.name;
  stopAvatar();
  stopAvatar = SidequestAvatar.animate($("avatar"), p.avatar);
  const dl = $("stats");
  clear(dl);
  const rows = [[t("Сессий", "Sessions"), p.stats.sessions],
                [t("Время агента", "Agent time"), duration(p.stats.agent_seconds)],
                [t("Действий", "Actions"), p.stats.actions], [t("Строк добавлено", "Lines added"), p.stats.lines_added],
                [t("Ошибок", "Errors"), p.stats.errors], [t("Запретов", "Blocked"), p.stats.blocked]];
  for (const [k, v] of rows) { dl.appendChild(el("dt", k)); dl.appendChild(el("dd", v)); }
}

// --- the Claude Code screen: over the menu, back to it ------------------------------

function openAgent() {
  $("menu").hidden = true;
  $("agent").hidden = false;
  loadProfile();
  runCheck();
  $("btn-agent-back").focus({preventScroll: true});
}

function closeAgent() {
  $("agent").hidden = true;
  $("menu").hidden = false;
  $("btn-agent").focus({preventScroll: true});
}

// --- dev panel ---------------------------------------------------------------------

const DEV_EVENTS = [
  ["Edit", "tool", {tool: "Edit", action: "attack", ok: true, file: "src/app.py", lines_added: 5, lines_removed: 1}],
  ["Read", "tool", {tool: "Read", action: "scout", ok: true, file: "src/app.py"}],
  ["Bash: тесты", "tool", {tool: "Bash", action: "cast", category: "test", ok: true}],
  ["Bash: поиск", "tool", {tool: "Bash", action: "scout", category: "search", ok: true}],
  ["Bash: сборка", "tool", {tool: "Bash", action: "cast", category: "build", ok: true}],
  ["git commit", "tool", {tool: "Bash", action: "cast", category: "git", git: ["commit"], ok: true}],
  ["git push", "tool", {tool: "Bash", action: "cast", category: "git", git: ["push"], ok: true}],
  ["Ошибка", "tool_error", {tool: "Bash", action: "cast", category: "other", ok: false, exit_code: 1}],
  ["Тесты упали", "tool_error", {tool: "Bash", action: "cast", category: "test", ok: false, exit_code: 1}],
  ["Запрет", "blocked", {tool: "Bash", reason: "rule"}],
  ["Ждёт ответа", "waiting", {tool: "Write"}],
  ["Продолжил", "resumed", {}],
  ["Compaction", "compact", {phase: "start"}],
  ["Compaction ✓", "compact", {phase: "end"}],
  ["Сабагент", "subagent_start", {agent: "dev-agent", agent_type: "general-purpose"}],
  ["Сабагент Explore", "subagent_start", {agent: "dev-explore", agent_type: "Explore"}],
  ["Сабагент Plan", "subagent_start", {agent: "dev-plan", agent_type: "Plan"}],
  ["Сабагент ✓", "subagent_stop", {agent: "dev-agent"}],
  ["Задача закончена", "stop", {ok: true, background: 0, final: true}],
];

function renderGameDev() {
  const row = $("dev-game");
  clear(row);
  row.appendChild(el("span", "Игра:", "tag"));
  for (const c of Sidequest.dev.commands) {
    row.appendChild(button(c.label, () => {
      api.dev_taint();
      Sidequest.dev.run(c.id);
    }));
  }
}

async function setupDev() {
  const send = $("dev-send");
  clear(send);
  send.appendChild(el("span", "Отправить:", "tag"));
  for (const [label, kind, fields] of DEV_EVENTS) {
    send.appendChild(button(label, () => api.dev_send(kind, fields)));
  }
  const sources = await api.dev_sources();
  const select = $("dev-source");
  clear(select);
  for (const s of sources) {
    const o = el("option", `${s.folder}/${s.name}`);
    o.value = JSON.stringify([s.folder, s.name]);
    select.appendChild(o);
  }
  if (!sources.length) select.appendChild(el("option", "нет записей и сценариев"));
  const sessions = $("dev-session");
  clear(sessions);
  for (const s of await api.dev_sessions()) {
    const o = el("option", `${s.project || "?"} · ${time(s.started_at)} · ${s.id.slice(0, 8)}`);
    o.value = s.id;
    sessions.appendChild(o);
  }
}

async function devPlay() {
  const value = $("dev-source").value;
  if (!value || value[0] !== "[") return;
  const [folder, name] = JSON.parse(value);
  replayInfo = await api.dev_replay_start(folder, name, Number($("dev-speed").value));
  $("dev-seek").max = replayInfo.duration;
  refreshStatus();
}

async function devPoll() {
  if (!replayInfo) return;
  const r = await api.dev_replay_control("position");
  if (!r) { replayInfo = null; return; }
  $("dev-seek").value = r.position;
  $("dev-pos").textContent = `${r.position.toFixed(1)} / ${r.duration.toFixed(1)} сек`;
}

let devPaused = false;
function bindDev() {
  $("dev-toggle").addEventListener("click", () => { $("dev-body").hidden = !$("dev-body").hidden; });
  $("dev-play").addEventListener("click", devPlay);
  $("dev-pause").addEventListener("click", () => {
    devPaused = !devPaused;
    api.dev_replay_control("pause", devPaused);
  });
  $("dev-step").addEventListener("click", () => api.dev_replay_control("step"));
  $("dev-stop").addEventListener("click", async () => {
    await api.dev_replay_stop();
    replayInfo = null;
    refreshStatus();
  });
  $("dev-speed").addEventListener("change", () => api.dev_replay_control("speed", Number($("dev-speed").value)));
  $("dev-seek").addEventListener("change", () => api.dev_replay_control("seek", Number($("dev-seek").value)));
  $("dev-export").addEventListener("click", async () => {
    const id = $("dev-session").value;
    if (!id) return;
    try {
      const path = await api.dev_export(id);
      $("dev-msg").textContent = "сохранено: " + path;
      setupDev();
    } catch (e) {
      $("dev-msg").textContent = "ошибка: " + e;
    }
  });
}

// --- start -------------------------------------------------------------------------

// Arrows and Enter on the shell's overlays and its screen. Caught before the arena's own
// keys: while one of them is up, the game under it does not move.
// A file dropped onto the window would open in place of the game: the drop does nothing.
for (const type of ["dragover", "drop"]) window.addEventListener(type, (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  const overlay = [$("modal"), $("agent-pause"), $("agent")].find((x) => !x.hidden);
  if (!overlay) return;
  e.stopImmediatePropagation();
  if (e.code === "Escape" && overlay === $("agent")) { closeAgent(); e.preventDefault(); return; }
  if (e.code === "Escape" && overlay === $("modal")) { closeModal(); e.preventDefault(); return; }
  SidequestKeys.handle(e, overlay);
}, true);

window.addEventListener("error", (e) => {
  if (api) api.report_error(`${e.message} at ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  if (api) api.report_error(`unhandled: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`);
});

Sidequest.ready().then(async () => {
  api = window.pywebview.api;
  $("btn-agent").addEventListener("click", openAgent);
  $("btn-agent-back").addEventListener("click", closeAgent);
  $("btn-check").addEventListener("click", runCheck);
  $("btn-connect").addEventListener("click", connectFlow);
  $("btn-settings").addEventListener("click", settingsFlow);
  $("btn-exit").addEventListener("click", () => api.quit());
  $("btn-agent-resume").addEventListener("click", () => api.resume(null).then(refreshStatus));
  const editAvatar = () => openAvatarEditor(profile && profile.avatar, () => {
    loadProfile();
    Sidequest.shell.profileChanged();
  });
  $("avatar").addEventListener("click", editAvatar);
  $("btn-avatar").addEventListener("click", editAvatar);
  $("profile-name").addEventListener("change", async (e) => {
    e.target.value = await api.set_profile_name(e.target.value);
  });
  await refreshStatus();
  for (const e of (await api.journal(100)).reverse()) addJournal(e, true);
  loadProfile();
  if (status.dev) { bindDev(); setupDev(); renderGameDev(); setInterval(devPoll, 500); }
  setInterval(refreshStatus, 1000);
  drain();
});
