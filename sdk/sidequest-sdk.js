// Sidequest SDK for DLC. Include it in the DLC page:
//   <script src="../../sdk/sidequest-sdk.js"></script>
// A DLC runs inside the hub's <iframe> and reaches the core only through this file.
//
//   Sidequest.on("tool", (e) => ...)       // one kind of game event ("*" for all)
//   Sidequest.onPause((paused, sessions) => ...)
//   await Sidequest.storage.get("save")     // the DLC's own data (data/dlc/<id>/)
//   await Sidequest.storage.set("save", {...})
//   await Sidequest.match.start(); await Sidequest.match.end({score: 120})
//   await Sidequest.achievements.unlock("first-blood", "Первая кровь")
//   Sidequest.dev.command("wave", "Вызвать волну", () => ...)   // dev panel button
//   Sidequest.ready()                       // call once the DLC is set up
"use strict";

(function () {
  const handlers = {};
  const pauseHandlers = [];
  const devCommands = {};
  const pending = {};
  let nextId = 1;
  let paused = false;
  let info = {dlc: null, dev: false};
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
      info = {dlc: m.dlc, dev: !!m.dev};
      helloResolve(info);
    } else if (m.kind === "dev_command" && devCommands[m.id]) {
      devCommands[m.id].fn();
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
