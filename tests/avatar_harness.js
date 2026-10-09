// Run by tests/test_avatar.py through the system JavaScriptCore (jsc), no browser needed.
// Usage: jsc avatar_harness.js -- <project dir> <gif file>
"use strict";
const [project, gifPath] = arguments;
load(project + "/sdk/avatar.js");
load(project + "/hub/avatar-import.js");
const A = globalThis.SidequestAvatar, I = globalThis.AvatarImport;

const result = {builder: [], gif: null, gif_kept: null, quantized: null, fit: null};

for (const p of A.PRESETS) result.builder.push(A.preset(p.id));
for (const o of A.OPTIONS) {
  for (const c of o.choices) result.builder.push(A.compose({[o.key]: c.id}));
}
result.builder.push(A.compose({hair: "../../etc", skin: "nope"}));

const frameHex = (f) => Array.from(f.rgba, (v) => v.toString(16).padStart(2, "0")).join("");
const bytes = new Uint8Array(readFile(gifPath, "binary"));
result.gif = I.decodeGif(bytes, 64).map((f) => ({w: f.w, h: f.h, delay: f.delay, rgba: frameHex(f)}));
result.gif_kept = I.decodeGif(bytes, 2).map((f) => f.delay);

// 40 distinct colors must come down to at most 32.
const rgba = new Uint8ClampedArray(32 * 32 * 4);
for (let k = 0; k < 32 * 32; k++) {
  const c = k % 40;
  rgba[k * 4] = c * 6; rgba[k * 4 + 1] = 255 - c * 6; rgba[k * 4 + 2] = (c * 37) % 256;
  rgba[k * 4 + 3] = k < 32 ? 0 : 255;
}
result.quantized = I.toAvatar([{rgba, delay: 100}, {rgba, delay: 100}], 32, 32);

// A wide 8x2 opaque picture: "fit" leaves transparent bands, "crop" does not.
const wide = {w: 8, h: 2, delay: 100, rgba: new Uint8ClampedArray(8 * 2 * 4).fill(200)};
result.fit = {
  fit: I.convert({frames: [wide]}, {size: 16, colors: 4, mode: "fit"}),
  crop: I.convert({frames: [wide]}, {size: 16, colors: 4, mode: "crop"}),
};

let error = null;
try { I.decodeGif(new Uint8Array([71, 73, 70, 56, 57, 97, 0, 64, 0, 64, 0, 0, 0, 59]), 64); }
catch (e) { error = String(e.message); }
result.huge_error = error;

print(JSON.stringify(result));
