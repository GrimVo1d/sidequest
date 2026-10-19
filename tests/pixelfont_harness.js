// Run by tests/test_pixelfont.py through jsc: the menus' pixel font built from the arena's
// glyphs (pixelfont.js), printed as base64 for Python to take apart.
// Usage: jsc pixelfont_harness.js -- <project dir>
"use strict";
const [project] = arguments;
for (const f of ["font", "pixelfont"]) load(`${project}/game/${f}.js`);
const bytes = new Uint8Array(LCSPixelFont.build(LCSFont));
let s = "";
for (const b of bytes) s += String.fromCharCode(b);
print(JSON.stringify({font: btoa(s), glyphs: LCSFont.GLYPHS, same: LCSFont.SAME}));
