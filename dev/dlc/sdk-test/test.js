// Exercises every SDK call; shows events and pause state as plain text.
"use strict";

const out = document.getElementById("out");
const show = (label, value) => { out.textContent = label + ": " + JSON.stringify(value); };
const click = (id, fn) => document.getElementById(id).addEventListener("click", () =>
  fn().then((r) => show(id, r), (e) => show(id + " error", String(e))));

Sidequest.on("*", (e) => {
  const li = document.createElement("li");
  li.textContent = `${new Date(e.ts * 1000).toLocaleTimeString("ru-RU")} ${e.kind} ` +
    JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["ts", "session"].includes(k))));
  const log = document.getElementById("log");
  log.insertBefore(li, log.firstChild);
});

Sidequest.onPause((paused, sessions) => {
  const p = document.getElementById("pause");
  p.textContent = paused ? `❚❚ пауза (${sessions.length})` : "▶ идёт";
  p.className = paused ? "paused" : "";
});

click("save", () => Sidequest.storage.set("save", {at: Date.now()}));
click("load", () => Sidequest.storage.get("save"));
click("start", () => Sidequest.match.start());
click("end", () => Sidequest.match.end({score: 42}));
click("ach", () => Sidequest.achievements.unlock("sdk-works", "SDK работает"));

Sidequest.dev.command("hello", "Привет из DLC", () => show("dev command", "hello"));

Sidequest.ready().then(async (info) => {
  const profile = await Sidequest.profile();
  document.getElementById("info").textContent =
    `dlc=${info.dlc} dev=${info.dev} игрок=${profile.name}`;
  SidequestAvatar.animate(document.getElementById("avatar"), profile.avatar);
});
