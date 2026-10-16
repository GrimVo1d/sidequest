// Sidequest SDK for DLC. Include it in the DLC page:
//   <script src="../../sdk/sidequest-sdk.js"></script>
// A DLC runs inside the hub's <iframe> and reaches the core only through this file.
//
//   Sidequest.on("tool", (e) => ...)       // one kind of game event ("*" for all)
//   Sidequest.onPause((paused, sessions) => ...)
//   await Sidequest.profile()               // {name, avatar, stats}; avatar: sdk/avatar.js
//   await Sidequest.balance()               // the DLC's own balance.json
//   await Sidequest.storage.get("save")     // the DLC's own data (data/dlc/<id>/)
//   await Sidequest.storage.set("save", {...})
//   await Sidequest.match.start(); await Sidequest.match.end({score: 120})
//   await Sidequest.achievements.unlock("first-blood", "Первая кровь")
//   await Sidequest.card([["Лучший счёт", 1200], ["Матчей", 5]])   // rows on the hub card, up to 4;
//                                           // a label may be {ru: "Матчей", en: "Matches"};
//                                           // a third item, a screen ("achievements"), makes
//                                           // the row a link: the hub opens the DLC with
//                                           // info.screen set to it
//   await Sidequest.history.sessions()      // past sessions: [{session, project, started_at,
//                                           //   duration, actions}], newest first
//   await Sidequest.history.events(session) // its normalized events, "t" — seconds from the start
//   await Sidequest.live()                  // sessions open now: [{session, project, status}],
//                                           //   status "working" / "waiting" / "silent" / "idle"
//   Sidequest.dev.command("wave", "Вызвать волну", () => ...)   // dev panel button
//   Sidequest.exit()                        // back to the hub (the DLC has the whole window)
//   Sidequest.ready()                       // call once the DLC is set up; resolves to
//                                           // info {dlc, dev, lang, screen} — lang is "ru"
//                                           // or "en", screen the one to open or null
"use strict";

(function () {
  const handlers = Object.create(null);  // event kinds come from outside: no "constructor"
  const pauseHandlers = [];
  const devCommands = {};
  const pending = {};
  let nextId = 1;
  let paused = false;
  let info = {dlc: null, dev: false, lang: "ru", screen: null};
  let helloResolve;
  const hello = new Promise((resolve) => { helloResolve = resolve; });

  function post(message) {
    window.parent.postMessage(Object.assign({sidequest: true}, message), "*");
  }

  function call(method, ...args) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending[id] = {resolve, reject};
      post({kind: "call", id, method, args});
    });
  }

  function emit(kind, event) {
    for (const fn of (handlers[kind] || []).concat(handlers["*"] || [])) {
      try { fn(event); } catch (e) { console.error(e); }
    }
  }

  window.addEventListener("message", (msg) => {
    if (msg.source !== window.parent) return;
    const m = msg.data;
    if (!m || m.sidequest !== true) return;
    if (m.kind === "event") {
      emit(m.event.kind, m.event);
    } else if (m.kind === "pause") {
      paused = !!m.paused;
      for (const fn of pauseHandlers) {
        try { fn(paused, m.sessions || []); } catch (e) { console.error(e); }
      }
    } else if (m.kind === "reply" && pending[m.id]) {
      const p = pending[m.id];
      delete pending[m.id];
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    } else if (m.kind === "hello") {
      info = {dlc: m.dlc, dev: !!m.dev, lang: m.lang === "en" ? "en" : "ru",
              screen: typeof m.screen === "string" ? m.screen : null};
      if (window.SidequestI18n) window.SidequestI18n.set(info.lang);
      helloResolve(info);
    } else if (m.kind === "dev_command" && devCommands[m.id]) {
      devCommands[m.id].fn();
    } else if (m.kind === "key" && (m.type === "keydown" || m.type === "keyup")) {
      // A key pressed while the hub had the focus: the frame is sandboxed, so the hub
      // cannot dispatch it here itself.
      window.dispatchEvent(new KeyboardEvent(m.type, {code: String(m.code), key: String(m.key), bubbles: true}));
    }
  });

  window.Sidequest = {
    version: 1,
    on(kind, fn) { (handlers[kind] = handlers[kind] || []).push(fn); },
    onPause(fn) { pauseHandlers.push(fn); },
    get paused() { return paused; },
    get info() { return info; },
    ready() { post({kind: "ready"}); return hello; },
    profile: () => call("profile"),
    balance: () => call("balance"),
    settings: () => call("settings"),
    storage: {
      get: (key) => call("load", key),
      set: (key, value) => call("save", key, value),
    },
    match: {
      // match.end returns {counted}: false after a replay or the dev panel.
      start: () => call("match_start"),
      end: (result) => call("match_end", result),
    },
    card: (rows) => call("save", "card", rows),
    // Past sessions, to replay one inside the game on its own clock.
    history: {
      sessions: () => call("sessions"),
      events: (session) => call("session_events", session),
    },
    // Sessions open right now: a new match picks up agents that are already at work.
    live: () => call("live_sessions"),
    exit() { post({kind: "exit"}); },
    achievements: {
      async list() { return (await call("load", "achievements")) || {}; },
      async unlock(id, title) {
        const all = (await call("load", "achievements")) || {};
        if (all[id]) return false;
        all[id] = {title: title || id, at: Date.now() / 1000};
        await call("save", "achievements", all);
        return true;
      },
    },
    dev: {
      command(id, label, fn) {
        devCommands[id] = {label, fn};
        post({kind: "dev_register",
              commands: Object.entries(devCommands).map(([i, c]) => ({id: i, label: c.label}))});
      },
    },
  };
})();
