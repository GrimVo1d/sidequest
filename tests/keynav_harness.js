// Run by tests/test_keynav.py through jsc: the menus' arrow keys (keynav.js) on the main menu's
// layout with the trials open, as boxes at a 1200 px wide window.
// Usage: jsc keynav_harness.js -- <project dir>
"use strict";
const [project] = arguments;
load(`${project}/game/keynav.js`);

const box = (id, left, top, right, bottom) => ({id, getBoundingClientRect: () => (
  {left, top, right, bottom, width: right - left, height: bottom - top})});
const menu = [
  box("settings", 1676, 15, 1842, 68), box("quit", 1862, 15, 1978, 68),
  box("agent", 670, 178, 917, 232), box("classic", 932, 178, 1178, 232),
  box("campaign", 1194, 178, 1440, 232), box("ghost", 1455, 178, 1700, 232),
  box("daily", 802, 247, 1047, 302), box("infinity", 1063, 247, 1308, 302),
  box("trials", 1322, 245, 1577, 305),
  box("rush", 670, 388, 1182, 468), box("rush_plus", 1191, 388, 1700, 468),
  box("clean", 670, 480, 1182, 560), box("oldschool", 1191, 480, 1700, 560),
  box("avatar", 360, 353, 567, 386), box("play", 683, 1180, 817, 1240),
  box("handbook", 1130, 1180, 1315, 1240),
];
const at = (id) => menu.find((b) => b.id === id);
const DIRS = {right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1]};
const go = (id, dir) => {
  const to = SidequestKeys.next(at(id), menu, DIRS[dir]);
  return to ? to.id : null;
};
const moves = [["agent", "right"], ["ghost", "right"], ["trials", "right"], ["rush_plus", "right"],
               ["oldschool", "right"], ["infinity", "down"], ["ghost", "down"], ["daily", "left"],
               ["rush", "right"], ["oldschool", "left"], ["avatar", "right"], ["clean", "down"]];
print(JSON.stringify(moves.map(([id, dir]) => [id, dir, go(id, dir)])));
