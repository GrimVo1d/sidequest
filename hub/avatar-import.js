// Turns a picture or an animated GIF chosen by the player into an avatar (format:
// sidequest/avatar.py): a full-color picture or, if asked, pixels with a small palette.
// Everything happens in the page: the file is read once and shrunk; the file itself is
// never stored or sent anywhere.
"use strict";

(function (root) {
  const MAX_FILE = 8 * 1024 * 1024;
  const MAX_SIDE = 2048;         // GIF canvas: bigger files are refused, not decoded
  const MAX_GIF_FRAMES = 1000;
  const WORK_SIDE = 128;         // GIF frames are kept at most this big between steps
  const STILL_SIDE = 512;        // the same for a still picture
  const PICTURE_SIZE = 256, GIF_PICTURE_SIZE = 128;   // see PICTURE_SIZES in avatar.py
  const CHARS = "0123456789abcdefghijklmnopqrstuv";
  // Tests run this file in jsc without sdk/i18n.js.
  const tr = (ru, en) => root.SidequestI18n ? root.SidequestI18n.t(ru, en) : ru;

  // --- GIF ---------------------------------------------------------------------------

  function isGif(bytes) {
    return bytes.length > 13 && String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF8[79]a$/);
  }

  // Walks the GIF blocks; calls onImage(descriptor, control) for every frame.
  function walkGif(bytes, onImage) {
    let pos = 6;
    const u8 = () => { if (pos >= bytes.length) throw new Error(tr("GIF обрывается", "the GIF is cut short")); return bytes[pos++]; };
    const u16 = () => u8() | (u8() << 8);
    const skipBlocks = () => { for (let n = u8(); n; n = u8()) pos += n; };
    const width = u16(), height = u16(), packed = u8();
    pos += 2;
    if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) {
      throw new Error(tr(`GIF слишком большой: ${width}×${height}, можно до ${MAX_SIDE}`,
                                `the GIF is too big: ${width}×${height}, up to ${MAX_SIDE}`));
    }
    let globalTable = null;
    if (packed & 0x80) {
      const n = 2 << (packed & 7);
      globalTable = bytes.subarray(pos, pos + n * 3);
      pos += n * 3;
    }
    let control = {delay: 0, disposal: 0, transparent: -1};
    let frames = 0;
    for (;;) {
      const block = u8();
      if (block === 0x3b) break;
      if (block === 0x21) {
        const label = u8();
        if (label === 0xf9) {
          const size = u8();
          const start = pos;
          const p = u8();
          const delay = u16();
          const index = u8();
          pos = start + size;
          skipBlocks();
          control = {delay: delay * 10, disposal: (p >> 2) & 7, transparent: p & 1 ? index : -1};
        } else {
          skipBlocks();
        }
      } else if (block === 0x2c) {
        const left = u16(), top = u16(), w = u16(), h = u16(), p = u8();
        let table = globalTable;
        if (p & 0x80) {
          const n = 2 << (p & 7);
          table = bytes.subarray(pos, pos + n * 3);
          pos += n * 3;
        }
        const minCode = u8();
        const dataStart = pos;
        skipBlocks();
        if (++frames > MAX_GIF_FRAMES) throw new Error(tr(`в GIF больше ${MAX_GIF_FRAMES} кадров`,
                                                                  `the GIF has more than ${MAX_GIF_FRAMES} frames`));
        onImage({left, top, w, h, interlaced: !!(p & 0x40), table, minCode, dataStart}, control);
        control = {delay: 0, disposal: 0, transparent: -1};
      } else if (pos >= bytes.length) {
        break;  // a missing trailer is common and harmless
      } else {
        throw new Error(tr("GIF повреждён", "the GIF is damaged"));
      }
    }
    if (!frames) throw new Error(tr("в GIF нет кадров", "the GIF has no frames"));
    return {width, height, frames};
  }

  // LZW: returns w*h palette indexes (missing tail stays 0).
  function lzw(bytes, pos, minCode, count) {
    if (minCode < 2 || minCode > 8) throw new Error(tr("GIF повреждён", "the GIF is damaged"));
    const out = new Uint8Array(count);
    const clear = 1 << minCode, end = clear + 1;
    const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096);
    const stack = new Uint8Array(4097);
    for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; }
    let size = minCode + 1, next = end + 1, prev = -1;
    let bits = 0, acc = 0, n = 0, left = 0;
    while (n < count) {
      while (bits < size) {
        if (!left) {
          if (pos >= bytes.length) return out;
          left = bytes[pos++];
          if (!left) return out;
        }
        acc |= bytes[pos++] << bits;
        bits += 8;
        left--;
      }
      const code = acc & ((1 << size) - 1);
      acc >>>= size;
      bits -= size;
      if (code === clear) { size = minCode + 1; next = end + 1; prev = -1; continue; }
      if (code === end) break;
      let cur = code, sp = 0;
      if (prev === -1) {
        if (code >= clear) return out;
        out[n++] = code;
        prev = code;
        continue;
      }
      if (code > next || (code === next && next >= 4096)) return out;
      if (code === next) { stack[sp++] = first[prev]; cur = prev; }
      while (cur >= clear) { stack[sp++] = suffix[cur]; cur = prefix[cur]; }
      stack[sp++] = cur;
      if (next < 4096) {
        prefix[next] = prev; suffix[next] = cur; first[next] = first[prev];
        next++;
        if (next === 1 << size && size < 12) size++;
      }
      while (sp && n < count) out[n++] = stack[--sp];
      prev = code;
    }
    return out;
  }

  // Decodes the GIF and keeps at most `keep` frames, spread evenly, each shrunk to
  // WORK_SIDE; the delays of the dropped frames go to the kept ones.
  function decodeGif(bytes, keep) {
    const info = walkGif(bytes, () => {});
    const total = info.frames;
    const take = new Set();
    for (let i = 0; i < Math.min(total, keep); i++) take.add(Math.floor(i * total / Math.min(total, keep)));
    const W = info.width, H = info.height;
    const canvas = new Uint8ClampedArray(W * H * 4);
    const frames = [];
    let index = 0;
    walkGif(bytes, (img, control) => {
      const before = control.disposal === 3 ? canvas.slice() : null;
      const pixels = lzw(bytes, img.dataStart, img.minCode, img.w * img.h);
      const rowsOrder = img.interlaced ? interlaceRows(img.h) : null;
      for (let r = 0; r < img.h; r++) {
        const y = img.top + (rowsOrder ? rowsOrder[r] : r);
        if (y >= H) continue;
        for (let c = 0; c < img.w; c++) {
          const x = img.left + c;
          if (x >= W) continue;
          const k = pixels[r * img.w + c];
          if (k === control.transparent || !img.table || k * 3 + 2 >= img.table.length) continue;
          const o = (y * W + x) * 4;
          canvas[o] = img.table[k * 3]; canvas[o + 1] = img.table[k * 3 + 1];
          canvas[o + 2] = img.table[k * 3 + 2]; canvas[o + 3] = 255;
        }
      }
      // Browsers show delays under 20 ms as 100 ms; do the same.
      const delay = control.delay < 20 ? 100 : control.delay;
      if (take.has(index)) frames.push(Object.assign(fitWork(canvas, W, H), {delay}));
      else if (frames.length) frames[frames.length - 1].delay += delay;
      index++;
      if (control.disposal === 2) {
        for (let y = img.top; y < Math.min(H, img.top + img.h); y++) {
          canvas.fill(0, (y * W + img.left) * 4, (y * W + Math.min(W, img.left + img.w)) * 4);
        }
      } else if (before) {
        canvas.set(before);
      }
    });
    return frames;
  }

  function interlaceRows(h) {
    const order = [];
    for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
      for (let y = start; y < h; y += step) order.push(y);
    }
    return order;
  }

  // --- shrinking ---------------------------------------------------------------------

  // Box filter: the area [x0, x0+side) x [y0, y0+side) of the source becomes n x n.
  // Areas outside the source are transparent. Colors are weighted by alpha.
  function box(src, W, H, x0, y0, sideX, sideY, nx, ny) {
    const out = new Uint8ClampedArray(nx * ny * 4);
    for (let ty = 0; ty < ny; ty++) {
      const ya = Math.floor(y0 + ty * sideY / ny), yb = Math.max(ya + 1, Math.floor(y0 + (ty + 1) * sideY / ny));
      for (let tx = 0; tx < nx; tx++) {
        const xa = Math.floor(x0 + tx * sideX / nx), xb = Math.max(xa + 1, Math.floor(x0 + (tx + 1) * sideX / nx));
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        for (let y = ya; y < yb; y++) {
          for (let x = xa; x < xb; x++) {
            count++;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const o = (y * W + x) * 4, al = src[o + 3];
            r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al;
          }
        }
        const o = (ty * nx + tx) * 4;
        if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a / count; }
      }
    }
    return out;
  }

  // Keeps the aspect ratio, at most WORK_SIDE on the longer side.
  function fitWork(src, W, H) {
    const scale = Math.min(1, WORK_SIDE / Math.max(W, H));
    const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    return {w, h, rgba: scale === 1 ? src.slice() : box(src, W, H, 0, 0, W, H, w, h)};
  }

  // mode "crop": the centered square; "fit": the whole picture with transparent edges.
  function square(frame, n, mode) {
    const side = mode === "fit" ? Math.max(frame.w, frame.h) : Math.min(frame.w, frame.h);
    const x0 = (frame.w - side) / 2, y0 = (frame.h - side) / 2;
    return box(frame.rgba, frame.w, frame.h, x0, y0, side, side, n, n);
  }

  // --- palette -----------------------------------------------------------------------

  // Median cut over the opaque pixels of all frames.
  function medianCut(colors, k) {
    let boxes = [colors];
    while (boxes.length < k) {
      let best = -1, bestRange = 0, bestChannel = 0;
      boxes.forEach((bx, i) => {
        if (bx.length < 2) return;
        for (let ch = 0; ch < 3; ch++) {
          let lo = 255, hi = 0;
          for (const c of bx) { if (c[ch] < lo) lo = c[ch]; if (c[ch] > hi) hi = c[ch]; }
          if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestChannel = ch; }
        }
      });
      if (best < 0) break;
      const bx = boxes[best].slice().sort((a, b) => a[bestChannel] - b[bestChannel]);
      const total = bx.reduce((s, c) => s + c[3], 0);
      let acc = 0, cut = 1;
      for (let i = 0; i < bx.length - 1; i++) {
        acc += bx[i][3];
        if (acc >= total / 2) { cut = i + 1; break; }
        cut = i + 1;
      }
      boxes.splice(best, 1, bx.slice(0, cut), bx.slice(cut));
    }
    return boxes.map((bx) => {
      let r = 0, g = 0, b = 0, w = 0;
      for (const c of bx) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; w += c[3]; }
      return [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
    });
  }

  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

  // frames: [{rgba (n*n*4), delay}] -> avatar. Pixels with alpha < 128 become transparent.
  function toAvatar(frames, n, k) {
    const counts = new Map();
    for (const f of frames) {
      for (let o = 0; o < f.rgba.length; o += 4) {
        if (f.rgba[o + 3] < 128) continue;
        const key = (f.rgba[o] << 16) | (f.rgba[o + 1] << 8) | f.rgba[o + 2];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    if (!counts.size) throw new Error(tr("картинка получилась пустой — она вся прозрачная",
                                            "the picture came out empty — it is all transparent"));
    const colors = [...counts].map(([key, w]) => [key >> 16, (key >> 8) & 255, key & 255, w]);
    const palette = medianCut(colors, Math.min(k, CHARS.length));
    const nearest = new Map();
    const pick = (key) => {
      if (nearest.has(key)) return nearest.get(key);
      const r = key >> 16, g = (key >> 8) & 255, b = key & 255;
      let best = 0, bestD = Infinity;
      palette.forEach((p, i) => {
        const d = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      nearest.set(key, CHARS[best]);
      return CHARS[best];
    };
    const out = [];
    for (const f of frames) {
      let pixels = "";
      for (let o = 0; o < f.rgba.length; o += 4) {
        pixels += f.rgba[o + 3] < 128 ? "."
          : pick((f.rgba[o] << 16) | (f.rgba[o + 1] << 8) | f.rgba[o + 2]);
      }
      const last = out[out.length - 1];
      if (last && last.pixels === pixels) last.delay = Math.min(10000, last.delay + f.delay);
      else out.push({pixels, delay: Math.max(20, Math.min(10000, Math.round(f.delay)))});
    }
    return {source: "upload", size: n, palette: palette.map(hex), frames: out};
  }

  // --- entry points ------------------------------------------------------------------

  // Reads the file once. Returns working frames for convert().
  async function load(file) {
    if (file.size > MAX_FILE) throw new Error(tr("файл больше 8 МБ", "the file is over 8 MB"));
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isGif(bytes)) return {animated: true, frames: decodeGif(bytes, 64)};
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      throw new Error(tr("это не картинка или формат не поддерживается",
                             "not a picture, or the format is not supported"));
    }
    const scale = Math.min(1, STILL_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return {animated: false, frames: [{w, h, rgba: ctx.getImageData(0, 0, w, h).data, delay: 100}]};
  }

  function toBase64(bytes) {
    let text = "";
    for (let k = 0; k < bytes.length; k += 8192) {
      text += String.fromCharCode.apply(null, bytes.subarray(k, k + 8192));
    }
    return btoa(text);
  }

  // frames: [{rgba (n*n*4), delay}] -> a full-color avatar; repeated frames are merged.
  function toPicture(frames, n) {
    const out = [];
    let last = null;
    for (const f of frames) {
      const same = last && last.rgba.length === f.rgba.length && last.rgba.every((v, k) => v === f.rgba[k]);
      if (same) {
        out[out.length - 1].delay = Math.min(10000, out[out.length - 1].delay + f.delay);
      } else {
        out.push({rgba: toBase64(f.rgba), delay: Math.max(20, Math.min(10000, Math.round(f.delay)))});
      }
      last = f;
    }
    return {source: "upload", size: n, frames: out};
  }

  // options: {style: "picture" | "pixels", mode: "crop" | "fit",
  //           size: 16 | 32 and colors: up to 32 — for pixels only}
  function convert(loaded, options) {
    if (options.style === "picture") {
      const n = loaded.frames.length > 1 ? GIF_PICTURE_SIZE : PICTURE_SIZE;
      return toPicture(loaded.frames.map((f) => ({rgba: square(f, n, options.mode), delay: f.delay})), n);
    }
    const n = options.size === 16 ? 16 : 32;
    const frames = loaded.frames.map((f) => ({rgba: square(f, n, options.mode), delay: f.delay}));
    return toAvatar(frames, n, options.colors || 16);
  }

  root.AvatarImport = {load, convert, decodeGif, toAvatar, toPicture, square, MAX_FILE};
})(typeof window !== "undefined" ? window : globalThis);
