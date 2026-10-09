// Hub: main menu, pause banner, journal, self-check, DLC host and dev panel.
// Event data is only ever shown with textContent, never as HTML.
"use strict";

let api = null;
let status = null;
let currentDlc = null;          // {id, name, url} while a DLC is open
let dlcDevCommands = [];
let replayInfo = null;
const JOURNAL_MAX = 200;

const $ = (id) => document.getElementById(id);

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
  return d.toLocaleTimeString("ru-RU", {hour12: false});
}

function duration(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

// --- events ------------------------------------------------------------------------

const ACTIONS = {attack: "правка", scout: "чтение", cast: "команда", scout_far: "веб",
                 summon: "сабагент", todo: "todo", generic: "инструмент"};
const BLOCK_REASONS = {rule: "запрещено правилом", rejected: "отказано в диалоге",
                       denied: "отказ автомода"};

function describe(e) {
  switch (e.kind) {
    case "session_start": return e.joined ? "сессия (подключились посреди)" : "сессия началась";
    case "session_end": return "сессия закончилась";
    case "prompt": return "новый промпт";
    case "tool": {
      let s = `${ACTIONS[e.action] || e.action} · ${e.tool}`;
      if (e.category && e.category !== "other") s += ` (${e.category})`;
      if (e.file) s += ` · ${e.file}`;
      if (e.lines_added || e.lines_removed) s += ` +${e.lines_added || 0}/-${e.lines_removed || 0}`;
      if (e.agent) s += " · сабагент";
      return s;
    }
    case "tool_error": {
      let s = `ошибка · ${e.tool}`;
      if (e.category && e.category !== "other") s += ` (${e.category})`;
      if (e.exit_code !== null && e.exit_code !== undefined) s += ` · код ${e.exit_code}`;
      return s;
    }
    case "blocked": return `запрет · ${e.tool || "?"} · ${BLOCK_REASONS[e.reason] || e.reason}`;
    case "waiting": return `ждёт ответа · ${e.tool || ""}`;
    case "silent": return `агент молчит ${e.seconds} с`;
    case "resumed": return e.source === "button" ? "продолжено кнопкой" : "продолжил";
    case "compact": return e.phase === "start" ? "compaction…" : "compaction закончен";
    case "subagent_start": return `сабагент запущен · ${e.agent_type || ""}`;
    case "subagent_stop": return "сабагент закончил";
    case "todo": return `todo · ${e.change}`;
    case "stop": return e.manual ? "матч завершён кнопкой"
      : e.final ? "задача закончена" : `ход закончен, фоновых задач: ${e.background}`;
    case "unknown": return `незнакомое событие · ${e.event}`;
    default: return e.kind;
  }
}

function addJournal(e, prepend) {
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
    toGame({kind: "event", event: e});
    if (["waiting", "resumed", "silent", "session_start", "session_end", "stop", "prompt"].includes(e.kind)) {
      refresh = true;
    }
  }
  if (refresh) refreshStatus();
}

window.__sidequestWake = () => { drain(); };

// --- status, pause, self-check -----------------------------------------------------

const INDICATOR_TEXT = {green: "Всё в порядке", yellow: "Есть что проверить",
                        red: "Не работает"};
const STATUS_TEXT = {working: "работает", idle: "ждёт промпт", waiting: "ждёт ответа",
                     silent: "молчит"};

async function refreshStatus() {
  status = await api.status();
  const ind = $("indicator");
  ind.className = "indicator " + status.indicator;
  let text = INDICATOR_TEXT[status.indicator];
  if (!status.connected) text = "Не подключено к Claude Code";
  else if (status.control.active) text = `Контрольная сессия ${status.control.version}`;
  $("indicator-text").textContent = text;
  $("btn-connect").textContent = status.connected ? "Отключить от Claude Code" : "Подключить к Claude Code";
  $("first-event").hidden = !status.waiting_first_event;

  const sessions = $("sessions");
  clear(sessions);
  for (const s of status.sessions) {
    const li = el("li");
    li.appendChild(el("span", (s.project || "?") + " "));
    li.appendChild(el("span", STATUS_TEXT[s.status] || s.status, s.status === "working" ? "ok" : "tag"));
    sessions.appendChild(li);
  }
  if (!status.sessions.length) sessions.appendChild(el("li", "нет активных", "tag"));

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
      list.appendChild(el("li", "Контрольная сессия: есть замечания", "warn"));
      for (const r of report) list.appendChild(el("li", "→ " + r, "fix"));
    } else if (report) {
      list.appendChild(el("li", "Контрольная сессия: всё на месте", "ok"));
    }
    for (const [name, n] of Object.entries(status.unknown_events)) {
      list.appendChild(el("li", `! незнакомое событие ${name} ×${n}`, "warn"));
    }
    for (const [name, n] of Object.entries(status.unknown_tools)) {
      list.appendChild(el("li", `! незнакомый инструмент ${name} ×${n}`, "warn"));
    }
  }
  if (!list.children.length) list.appendChild(el("li", "проверка идёт…", "tag"));
}

let lastPauseKey = "";
function renderPause(paused) {
  const overlay = $("pause");
  const key = JSON.stringify(paused);
  if (key === lastPauseKey) return;
  lastPauseKey = key;
  overlay.hidden = paused.length === 0;
  toGame({kind: "pause", paused: paused.length > 0, sessions: paused});
  if (!paused.length) return;
  const anyWaiting = paused.some((p) => p.reason === "waiting");
  $("pause-title").textContent = anyWaiting ? "Claude ждёт ответа в терминале"
                                            : "Агент молчит — возможно, его прервали";
  const list = $("pause-list");
  clear(list);
  for (const p of paused) {
    const li = el("li");
    li.appendChild(el("span", `${p.project || "?"} · ${p.reason === "waiting" ? "ждёт ответа" : "молчит"}`));
    if (p.reason === "silent") {
      li.appendChild(button("Завершить матч", () => api.end_match(p.session).then(refreshStatus)));
    }
    list.appendChild(li);
  }
}

async function runCheck() {
  $("indicator-text").textContent = "Проверка…";
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
  if (!p.ok) return modal("Не получилось", [el("p", p.error)], [["Закрыть", closeModal]]);
  if (!p.changes.length) return modal("Уже подключено", [el("p", "Все записи на месте.")], [["Закрыть", closeModal]]);
  const lines = p.changes.map((c) => `${c.event}: ${c.what}`).join("\n");
  modal("Подключить к Claude Code", [
    el("p", `В ${p.path} будут добавлены хуки Sidequest. Перед записью будет сделана резервная копия.`),
    el("p", `Скрипт: ${p.script}`, "tag"),
    el("pre", lines),
  ], [["Отмена", closeModal], ["Подключить", async () => {
    const r = await api.install_apply();
    modal(r.ok ? "Подключено" : "Ошибка", [
      el("p", r.ok ? "Уже открытые сессии Claude Code, возможно, нужно перезапустить." : r.error),
      el("p", r.backup ? `Резервная копия: ${r.backup}` : "", "tag"),
    ], [["Закрыть", closeModal]]);
    refreshStatus();
  }, "primary"]]);
}

async function disconnectFlow() {
  const p = await api.uninstall_preview();
  if (!p.ok) return modal("Не получилось", [el("p", p.error)], [["Закрыть", closeModal]]);
  const core = el("input"); core.type = "checkbox";
  const dlcBox = el("input"); dlcBox.type = "checkbox";
  const coreLabel = el("label"); coreLabel.appendChild(core); coreLabel.appendChild(el("span", " Профиль и общая статистика"));
  const dlcLabel = el("label"); dlcLabel.appendChild(dlcBox); dlcLabel.appendChild(el("span", " Данные всех DLC"));
  modal("Отключить от Claude Code", [
    el("p", `Из ${p.path} будут удалены только записи Sidequest (${p.changes.length}). Будет сделана резервная копия.`),
    el("p", "Заодно удалить данные:"), coreLabel, dlcLabel,
  ], [["Отмена", closeModal], ["Отключить", async () => {
    const dlcIds = dlcBox.checked ? (await api.list_dlc()).map((d) => d.id) : [];
    const r = await api.uninstall_apply(core.checked, dlcIds);
    modal(r.ok ? "Отключено" : "Ошибка", [el("p", r.ok ? "Хуки Sidequest удалены." : r.error)],
          [["Закрыть", closeModal]]);
    refreshStatus(); loadProfile();
  }, "primary"]]);
}

async function settingsFlow() {
  const s = await api.get_settings();
  const silence = el("input"); silence.type = "number"; silence.min = 10; silence.max = 3600;
  silence.value = s.silence_pause_seconds;
  const fps = el("select");
  for (const v of [30, 60]) { const o = el("option", v); o.value = v; o.selected = v === s.fps_limit; fps.appendChild(o); }
  const l1 = el("label"); l1.appendChild(el("span", "Пауза, если агент молчит дольше, с: ")); l1.appendChild(silence);
  const l2 = el("label"); l2.appendChild(el("span", "Ограничение FPS: ")); l2.appendChild(fps);
  modal("Настройки", [l1, l2], [["Отмена", closeModal], ["Сохранить", async () => {
    await api.set_setting("silence_pause_seconds", Number(silence.value));
    await api.set_setting("fps_limit", Number(fps.value));
    closeModal();
  }, "primary"]]);
}

// --- profile and DLC list ----------------------------------------------------------

let profile = null;
let stopAvatar = () => {};

async function loadProfile() {
  const p = profile = await api.profile();
  $("profile-name").value = p.name;
  stopAvatar();
  stopAvatar = SidequestAvatar.animate($("avatar"), p.avatar);
  const dl = $("stats");
  clear(dl);
  const rows = [["Сессий", p.stats.sessions], ["Время агента", duration(p.stats.agent_seconds)],
                ["Действий", p.stats.actions], ["Строк добавлено", p.stats.lines_added],
                ["Ошибок", p.stats.errors], ["Запретов", p.stats.blocked]];
  for (const [k, v] of rows) { dl.appendChild(el("dt", k)); dl.appendChild(el("dd", v)); }
}

async function loadDlc() {
  const list = await api.list_dlc();
  const grid = $("dlc-list");
  clear(grid);
  for (const d of list) {
    const card = el("div", null, "dlc");
    card.appendChild(el("div", d.name, "name"));
    card.appendChild(el("div", d.dev_only ? "только --dev" : "", "tag"));
    card.appendChild(button("Играть", () => openDlc(d), "primary"));
    grid.appendChild(card);
  }
  if (!list.length) grid.appendChild(el("p", "Пока нет ни одного режима — они появятся на этапе 2.", "hint"));
}

// --- DLC host: the DLC talks to the core only through these messages ----------------

const DLC_METHODS = {
  load: (id, args) => api.dlc_load(id, String(args[0])),
  save: (id, args) => api.dlc_save(id, String(args[0]), args[1]),
  match_start: (id) => api.match_start(id),
  match_end: (id, args) => api.match_end(id, args[0]),
  profile: () => api.profile(),
  settings: () => api.get_settings(),
};

function openDlc(d) {
  currentDlc = d;
  dlcDevCommands = [];
  renderDlcDev();
  $("hub").hidden = true;
  $("game").hidden = false;
  $("game-title").textContent = d.name;
  $("game-frame").src = d.url;
}

function closeDlc() {
  currentDlc = null;
  dlcDevCommands = [];
  renderDlcDev();
  $("game-frame").src = "about:blank";
  $("game").hidden = true;
  $("hub").hidden = false;
  loadProfile();
}

function toGame(message) {
  const frame = $("game-frame");
  if (currentDlc && frame.contentWindow) {
    frame.contentWindow.postMessage(Object.assign({sidequest: true}, message), "*");
  }
}

window.addEventListener("message", async (msg) => {
  if (!currentDlc || msg.source !== $("game-frame").contentWindow) return;
  const m = msg.data;
  if (!m || m.sidequest !== true) return;
  if (m.kind === "ready") {
    toGame({kind: "hello", dlc: currentDlc.id, dev: status ? status.dev : false});
    lastPauseKey = "";
    if (status) renderPause(status.paused);
  } else if (m.kind === "call") {
    const fn = DLC_METHODS[m.method];
    let reply;
    try {
      if (!fn) throw new Error("unknown method " + m.method);
      // The DLC id is fixed by the hub: a DLC can only reach its own data.
      reply = {kind: "reply", id: m.id, result: await fn(currentDlc.id, m.args || [])};
    } catch (e) {
      reply = {kind: "reply", id: m.id, error: String(e && e.message || e)};
    }
    toGame(reply);
  } else if (m.kind === "dev_register" && Array.isArray(m.commands)) {
    dlcDevCommands = m.commands.slice(0, 40).map((c) => ({id: String(c.id), label: String(c.label)}));
    renderDlcDev();
  }
});

// --- dev panel ---------------------------------------------------------------------

const DEV_EVENTS = [
  ["Edit", "tool", {tool: "Edit", action: "attack", ok: true, file: "src/app.py", lines_added: 5, lines_removed: 1}],
  ["Read", "tool", {tool: "Read", action: "scout", ok: true, file: "src/app.py"}],
  ["Bash: тесты", "tool", {tool: "Bash", action: "cast", category: "test", ok: true}],
  ["Bash: поиск", "tool", {tool: "Bash", action: "scout", category: "search", ok: true}],
  ["Ошибка", "tool_error", {tool: "Bash", action: "cast", category: "test", ok: false, exit_code: 1}],
  ["Запрет", "blocked", {tool: "Bash", reason: "rule"}],
  ["Ждёт ответа", "waiting", {tool: "Write"}],
  ["Продолжил", "resumed", {}],
  ["Compaction", "compact", {phase: "start"}],
  ["Compaction ✓", "compact", {phase: "end"}],
  ["Сабагент", "subagent_start", {agent: "dev-agent", agent_type: "general-purpose"}],
  ["Сабагент ✓", "subagent_stop", {agent: "dev-agent"}],
  ["Задача закончена", "stop", {ok: true, background: 0, final: true}],
];

function renderDlcDev() {
  const row = $("dev-dlc");
  clear(row);
  if (!dlcDevCommands.length) return;
  row.appendChild(el("span", "DLC:", "tag"));
  for (const c of dlcDevCommands) {
    row.appendChild(button(c.label, () => {
      api.dev_taint();
      toGame({kind: "dev_command", id: c.id});
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
  $("dev-pos").textContent = `${r.position.toFixed(1)} / ${r.duration.toFixed(1)} с`;
}

let devPaused = false;
function bindDev() {
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

window.addEventListener("error", (e) => {
  if (api) api.report_error(`${e.message} at ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  if (api) api.report_error(`unhandled: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`);
});

window.addEventListener("pywebviewready", async () => {
  api = window.pywebview.api;
  $("btn-check").addEventListener("click", runCheck);
  $("btn-connect").addEventListener("click", connectFlow);
  $("btn-settings").addEventListener("click", settingsFlow);
  $("btn-back").addEventListener("click", closeDlc);
  $("btn-resume").addEventListener("click", () => api.resume(null).then(refreshStatus));
  const editAvatar = () => openAvatarEditor(profile && profile.avatar, loadProfile);
  $("avatar").addEventListener("click", editAvatar);
  $("btn-avatar").addEventListener("click", editAvatar);
  $("profile-name").addEventListener("change", async (e) => {
    e.target.value = await api.set_profile_name(e.target.value);
  });
  await refreshStatus();
  for (const e of (await api.journal(100)).reverse()) addJournal(e, true);
  loadProfile();
  loadDlc();
  if (status.dev) { bindDev(); setupDev(); setInterval(devPoll, 500); }
  setInterval(refreshStatus, 1000);
  drain();
});
