// The menus' and the HUD's pixel font (1.0): the arena's own glyphs (font.js) built into a
// TrueType font in memory and handed to the page as "Sidequest Pixel" — no font file and no
// network. Upper case only: lower-case letters map to the same glyphs. Characters it lacks
// fall back to the next font in the CSS list.
//   LCSPixelFont.build(LCSFont)  // the font as an ArrayBuffer (tests read it in jsc)
// In the page the font is added to document.fonts as soon as this file loads.
"use strict";

(function (root) {
  const P = 128;               // one pixel of a glyph in font units
  const EM = 8 * P;            // 5 rows of a letter, a row below the line, two of air
  const ASCENT = 6.5 * P, DESCENT = 1.5 * P;
  const NAME = "Sidequest Pixel";

  // --- outlines ----------------------------------------------------------------------

  // The outline of a glyph's lit pixels as closed loops of points (font units, y up): every
  // pixel's edges clockwise, the edges two pixels share cancelled, the rest chained. Holes
  // come out counter-clockwise by themselves.
  function outline(rows) {
    const lit = (x, y) => y >= 0 && y < rows.length && rows[y][x] === "#";
    const edges = new Map();   // "x,y" of a start corner -> list of end corners
    const add = (a, b) => {
      const k = a.join(",");
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(b);
    };
    // Corners in pixel units with y down; a pixel (x, y) spans x..x+1, y..y+1.
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (!lit(x, y)) continue;
        if (!lit(x, y - 1)) add([x, y], [x + 1, y]);          // top, left to right
        if (!lit(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);  // right, downwards
        if (!lit(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);  // bottom, right to left
        if (!lit(x - 1, y)) add([x, y + 1], [x, y]);          // left, upwards
      }
    });
    const loops = [];
    for (const start of edges.keys()) {
      while (edges.get(start).length) {
        const loop = [];
        let at = start.split(",").map(Number);
        for (;;) {
          const out = edges.get(at.join(","));
          if (!out || !out.length) break;
          const next = out.shift();
          loop.push(at);
          at = next;
          if (at.join(",") === start) break;
        }
        loops.push(simplify(loop));
      }
    }
    // Pixel rows down to font units up: row 4's bottom is the baseline.
    return loops.map((loop) => loop.map(([x, y]) => [x * P, (5 - y) * P]));
  }

  // Drops the corners in the middle of a straight side.
  function simplify(loop) {
    return loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
      return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
    });
  }

  // --- binary ------------------------------------------------------------------------

  class Out {
    constructor() { this.bytes = []; }
    u8(v) { this.bytes.push(v & 255); return this; }
    u16(v) { return this.u8(v >> 8).u8(v); }
    i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
    u32(v) { return this.u16(Math.floor(v / 65536) & 65535).u16(v & 65535); }
    tag(s) { for (const ch of s) this.u8(ch.charCodeAt(0)); return this; }
    pad() { while (this.bytes.length % 4) this.u8(0); return this; }
  }

  function checksum(bytes) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      sum = (sum + ((bytes[i] << 24) >>> 0) + ((bytes[i + 1] || 0) << 16) + ((bytes[i + 2] || 0) << 8)
             + (bytes[i + 3] || 0)) % 4294967296;
    }
    return sum;
  }

  // One simple glyph: its loops as on-curve points with 16-bit deltas.
  function glyf(loops) {
    const o = new Out();
    if (!loops.length) return o;
    const all = loops.flat(), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    o.i16(loops.length).i16(Math.min(...xs)).i16(Math.min(...ys)).i16(Math.max(...xs)).i16(Math.max(...ys));
    let end = -1;
    for (const loop of loops) o.u16(end += loop.length);
    o.u16(0);
    for (let i = 0; i < all.length; i++) o.u8(1);
    let x = 0, y = 0;
    for (const p of all) { o.i16(p[0] - x); x = p[0]; }
    for (const p of all) { o.i16(p[1] - y); y = p[1]; }
    return o.pad();
  }

  function build(font) {
    // The glyphs: .notdef first, then every drawn character.
    const keys = Object.keys(font.GLYPHS);
    const glyphs = [{rows: ["###", "#.#", "#.#", "#.#", "###"]}]
      .concat(keys.map((k) => ({rows: font.GLYPHS[k].split("|")})));
    for (const g of glyphs) {
      g.width = g.rows[0].length;
      g.loops = outline(g.rows);
      g.advance = (g.width + 1) * P;
    }
    // Characters to glyphs: each drawn one, its lower case, and the stand-ins.
    const map = new Map();
    keys.forEach((k, i) => {
      map.set(k.codePointAt(0), i + 1);
      const lower = k.toLowerCase();
      if (lower !== k) map.set(lower.codePointAt(0), i + 1);
    });
    for (const [ch, same] of Object.entries(font.SAME)) {
      const gid = keys.indexOf(same) + 1;
      map.set(ch.codePointAt(0), gid);
      if (ch.toLowerCase() !== ch) map.set(ch.toLowerCase().codePointAt(0), gid);
    }
    const codes = [...map.keys()].filter((c) => c < 65535).sort((a, b) => a - b);

    const tables = {};
    const bodies = glyphs.map((g) => glyf(g.loops).bytes);
    const loca = new Out(), glyfOut = new Out();
    for (const b of bodies) {
      loca.u32(glyfOut.bytes.length);
      glyfOut.bytes.push(...b);
    }
    loca.u32(glyfOut.bytes.length);
    tables.glyf = glyfOut;
    tables.loca = loca;

    const points = glyphs.map((g) => g.loops.flat().length), contours = glyphs.map((g) => g.loops.length);
    const maxAdvance = Math.max(...glyphs.map((g) => g.advance));
    const width = Math.max(...glyphs.map((g) => g.width)) * P;

    tables.head = new Out().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5F0F3CF5).u16(0x000B).u16(EM)
      .u32(0).u32(0).u32(0).u32(0)                       // created and modified: no dates
      .i16(0).i16(-P).i16(width).i16(5 * P)
      .u16(0).u16(8).i16(2).i16(1).i16(0);

    tables.hhea = new Out().u32(0x00010000).i16(ASCENT).i16(-DESCENT).i16(0).u16(maxAdvance)
      .i16(0).i16(P).i16(width).i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length);

    tables.maxp = new Out().u32(0x00010000).u16(glyphs.length).u16(Math.max(...points))
      .u16(Math.max(...contours)).u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

    const hmtx = new Out();
    for (const g of glyphs) hmtx.u16(g.advance).i16(0);
    tables.hmtx = hmtx;

    const avg = Math.round(glyphs.reduce((n, g) => n + g.advance, 0) / glyphs.length);
    tables["OS/2"] = new Out().u16(4).i16(avg).u16(400).u16(5).u16(0)
      .i16(3 * P).i16(3 * P).i16(0).i16(P).i16(3 * P).i16(3 * P).i16(0).i16(3 * P)
      .i16(P).i16(3 * P).i16(0)
      .u8(0).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0)
      .u32(1 | 2 | 512).u32(0).u32(0).u32(0)            // Basic Latin, Latin-1, Cyrillic
      .tag("SDQT").u16(0x40).u16(codes[0]).u16(codes[codes.length - 1])
      .i16(ASCENT).i16(-DESCENT).i16(0).u16(ASCENT).u16(DESCENT)
      .u32(1 | 4).u32(0)                                // Latin 1, Cyrillic code pages
      .i16(5 * P).i16(5 * P).u16(0).u16(32).u16(1);

    // cmap: format 4, one segment per character, each with its own delta.
    const segs = codes.length + 1, cmap = new Out();
    let search = 1, selector = 0;
    while (search * 2 <= segs) { search *= 2; selector++; }
    cmap.u16(0).u16(1).u16(3).u16(1).u32(12);
    cmap.u16(4).u16(16 + 8 * segs).u16(0).u16(segs * 2).u16(search * 2).u16(selector).u16(segs * 2 - search * 2);
    for (const c of codes) cmap.u16(c);
    cmap.u16(0xFFFF).u16(0);
    for (const c of codes) cmap.u16(c);
    cmap.u16(0xFFFF);
    for (const c of codes) cmap.u16((map.get(c) - c + 65536) % 65536);
    cmap.u16(1);
    for (let i = 0; i < segs; i++) cmap.u16(0);
    tables.cmap = cmap;

    const names = [[1, NAME], [2, "Regular"], [3, NAME + " Regular"], [4, NAME + " Regular"], [6, "SidequestPixel-Regular"]];
    const name = new Out().u16(0).u16(names.length).u16(6 + 12 * names.length);
    const strings = new Out();
    for (const [id, text] of names) {
      name.u16(3).u16(1).u16(0x409).u16(id).u16(text.length * 2).u16(strings.bytes.length);
      for (const ch of text) strings.u16(ch.charCodeAt(0));
    }
    name.bytes.push(...strings.bytes);
    tables.name = name;

    tables.post = new Out().u32(0x00030000).u32(0).i16(-P).i16(P / 2).u32(0).u32(0).u32(0).u32(0).u32(0);

    // The file: the table directory, then each table padded to 4 bytes.
    const tags = Object.keys(tables).sort();
    const n = tags.length;
    let pow = 1, log = 0;
    while (pow * 2 <= n) { pow *= 2; log++; }
    const head = new Out().u32(0x00010000).u16(n).u16(pow * 16).u16(log).u16(n * 16 - pow * 16);
    let offset = 12 + 16 * n;
    const body = [];
    for (const tag of tags) {
      const bytes = tables[tag].bytes;
      head.tag(tag).u32(checksum(bytes)).u32(offset).u32(bytes.length);
      const padded = bytes.slice();
      while (padded.length % 4) padded.push(0);
      body.push(...padded);
      offset += padded.length;
    }
    const all = head.bytes.concat(body);
    // head.checkSumAdjustment makes the whole file sum to the magic number.
    const at = head.bytes.length + tags.slice(0, tags.indexOf("head"))
      .reduce((sum, t) => sum + Math.ceil(tables[t].bytes.length / 4) * 4, 0) + 8;
    const adjust = (0xB1B0AFBA - checksum(all) + 4294967296) % 4294967296;
    all[at] = adjust >>> 24;
    all[at + 1] = (adjust >>> 16) & 255;
    all[at + 2] = (adjust >>> 8) & 255;
    all[at + 3] = adjust & 255;
    return new Uint8Array(all).buffer;
  }

  root.LCSPixelFont = {build, NAME};

  if (typeof document !== "undefined" && root.FontFace && root.LCSFont) {
    try {
      const face = new FontFace(NAME, build(root.LCSFont));
      document.fonts.add(face);
      face.load().catch(() => {});
    } catch (e) {
      // The page keeps its monospace font.
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
