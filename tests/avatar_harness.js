// Run by tests/test_avatar.py through the system JavaScriptCore (jsc), no browser needed.
// Usage: jsc avatar_harness.js -- <project dir> <gif file>
"use strict";
const [project, gifPath] = arguments;
load(project + "/game/avatar.js");
load(project + "/game/avatar-import.js");
const A = globalThis.SidequestAvatar, I = globalThis.AvatarImport;

const result = {builder: [], gif: null, gif_kept: null, quantized: null, fit: null};

for (const p of A.PRESETS) result.builder.push(A.preset(p.id));
for (const o of A.OPTIONS) {
  for (const c of o.choices) result.builder.push(A.compose({[o.key]: c.id}));
}
result.builder.push(A.compose({hair: "../../etc", skin: "nope"}));
// Ids that are names on every object's prototype (a save edited by hand) get the default too.
result.builder.push(A.compose({hair: "constructor", skin: "toString", bg: "__proto__"}));

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

// Full-color pictures: a GIF becomes 128 px, a still picture 256 px.
result.picture_gif = I.convert({frames: I.decodeGif(bytes, 64)}, {style: "picture", mode: "crop"});
result.picture_still = I.convert({frames: [wide]}, {style: "picture", mode: "fit"});
const back = A.rgba(result.picture_still, 0);
result.picture_decoded = back.length === 256 * 256 * 4 && back[128 * 256 * 4] === 200 && A.isPicture(result.picture_still);

let error = null;
try { I.decodeGif(new Uint8Array([71, 73, 70, 56, 57, 97, 0, 64, 0, 64, 0, 0, 0, 59]), 64); }
catch (e) { error = String(e.message); }
result.huge_error = error;

// Hostile files: each must be refused with a message, never decoded.
const errorOf = (f) => { try { f(); return null; } catch (e) { return String(e.message); } };
const le = (v) => [v & 255, v >> 8];
function gifOf(w, h, frames) {  // frames: [[fw, fh]], each a 1-pixel LZW stream
  const out = [71, 73, 70, 56, 57, 97, ...le(w), ...le(h), 0, 0, 0];
  for (const [fw, fh] of frames) out.push(0x2c, 0, 0, 0, 0, ...le(fw), ...le(fh), 0, 2, 2, 0x4c, 0x01, 0);
  return new Uint8Array([...out, 0x3b]);
}
result.gif_big_frame = errorOf(() => I.decodeGif(gifOf(4, 4, [[60000, 60000]]), 64));
result.gif_bomb = errorOf(() => I.decodeGif(gifOf(2000, 2000, Array(30).fill([1, 1])), 64));
result.gif_small = errorOf(() => I.decodeGif(gifOf(4, 4, Array(30).fill([1, 1])), 64));

const be32 = (v) => [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const png = (w, h) => new Uint8Array([0x89, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
                                      ...be32(w), ...be32(h), 1, 0, 0, 0, 0]);
// SOI, an APP0 segment to skip, then SOF2 (progressive) with the size.
const jpeg = (w, h) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc2, 0, 11, 8,
                                       h >> 8, h & 255, w >> 8, w & 255, 1, 0, 0, 0]);
const riff = (chunk, body) => new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80,
                                              ...Array.from(chunk, (c) => c.charCodeAt(0)), ...body]);
const webpX = (w, h) => riff("VP8X", [10, 0, 0, 0, 0, 0, 0, 0,
                                      (w - 1) & 255, ((w - 1) >> 8) & 255, (w - 1) >> 16,
                                      (h - 1) & 255, ((h - 1) >> 8) & 255, (h - 1) >> 16, 0, 0]);
result.still = {
  png_ok: errorOf(() => I.checkStill(png(640, 480))),
  png_bomb: errorOf(() => I.checkStill(png(20000, 20000))),
  png_wide: errorOf(() => I.checkStill(png(30000, 10))),
  jpeg_ok: errorOf(() => I.checkStill(jpeg(4032, 3024))),
  jpeg_bomb: errorOf(() => I.checkStill(jpeg(65000, 65000))),
  webp_ok: errorOf(() => I.checkStill(webpX(1000, 1000))),
  webp_bomb: errorOf(() => I.checkStill(webpX(16000, 16000))),
  unknown: errorOf(() => I.checkStill(new Uint8Array(64).fill(7))),
};

print(JSON.stringify(result));
