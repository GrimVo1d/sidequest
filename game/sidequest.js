// The game's link to the core: window.Sidequest over the pywebview bridge. The arena
// (main.js) reaches the core only through this file; shell.js runs the rest of the page
// (the status bar, the Claude Code screen, the agents' pause, the dev panel).
//
//   Sidequest.on("tool", (e) => ...)       // one kind of agent event ("*" for all)
//   Sidequest.onPause((paused, sessions) => ...)
//   Sidequest.onProfile(() => ...)          // the player changed their name or picture
//   await Sidequest.ready()                 // the bridge is up: info {dev, lang}
//   await Sidequest.profile()               // {name, avatar, stats}; avatar: avatar.js
//   await Sidequest.balance()               // game/balance.json
//   await Sidequest.storage.get("records")  // the game's saves (data/game/<key>.json)
//   await Sidequest.storage.set("records", {...})
//   await Sidequest.match.start(); await Sidequest.match.end({score: 120})   // {counted}
//   await Sidequest.history.sessions()      // past sessions: [{session, project, started_at,
//                                           //   duration, actions}], newest first
//   await Sidequest.history.events(session) // its normalized events, "t" — seconds from the start
//   await Sidequest.live()                  // sessions open now: [{session, project, status}],
//                                           //   status "working" / "waiting" / "silent" / "idle"
//   Sidequest.dev.command("wave", "Волна", () => ...)   // a dev panel button (only with --dev)
"use strict";

(function () {
  const handlers = Object.create(null);  // event kinds come from outside: no "constructor"
  const pauseHandlers = [];
  const profileHandlers = [];
  const devCommands = [];
  let api = null;
  let paused = false;
  let info = {dev: false, lang: "en"};
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  // Every call waits for the bridge: pywebview sets it up after the page has loaded.
  function call(method, ...args) {
    return ready.then(() => api[method](...args));
  }

  function emit(kind, event) {
    for (const fn of (handlers[kind] || []).concat(handlers["*"] || [])) {
      try { fn(event); } catch (e) { console.error(e); }
    }
  }

  window.addEventListener("pywebviewready", async () => {
    api = window.pywebview.api;
    const [settings, status] = await Promise.all([api.get_settings(), api.status()]);
    info = {dev: !!status.dev, lang: settings.lang === "ru" ? "ru" : "en"};
    SidequestI18n.set(info.lang);
    SidequestI18n.apply(document);
    readyResolve(info);
  });

  window.Sidequest = {
    on(kind, fn) { (handlers[kind] = handlers[kind] || []).push(fn); },
    onPause(fn) { pauseHandlers.push(fn); },
    onProfile(fn) { profileHandlers.push(fn); },
    get paused() { return paused; },
    get info() { return info; },
    ready: () => ready,
    profile: () => call("profile"),
    balance: () => call("balance"),
    settings: () => call("get_settings"),
    storage: {
      get: (key) => call("load", key),
      set: (key, value) => call("save", key, value),
    },
    match: {
      // match.end returns {counted}: false after a replay or the dev panel.
      start: () => call("match_start"),
      end: (result) => call("match_end", result),
    },
    // Past sessions, to replay one inside the game on its own clock.
    history: {
      sessions: () => call("past_sessions"),
      events: (session) => call("session_events", String(session)),
    },
    // Sessions open right now: a new match picks up agents that are already at work.
    live: () => call("live_sessions"),
    dev: {
      command(id, label, fn) { devCommands.push({id, label, fn}); },
      get commands() { return devCommands.map(({id, label}) => ({id, label})); },
      run(id) {
        const c = devCommands.find((x) => x.id === id);
        if (c) c.fn();
      },
    },
    // For shell.js only: it pulls the events from the core and decides the agents' pause.
    shell: {
      deliver(event) { emit(event.kind, event); },
      setPaused(value, sessions) {
        paused = !!value;
        for (const fn of pauseHandlers) {
          try { fn(paused, sessions || []); } catch (e) { console.error(e); }
        }
      },
      profileChanged() {
        for (const fn of profileHandlers) {
          try { fn(); } catch (e) { console.error(e); }
        }
      },
    },
  };
})();
