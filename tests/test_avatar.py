import json
import os
import subprocess
import unittest

from sidequest import avatar, paths

from .helpers import temp_dir

JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
HARNESS = os.path.join(os.path.dirname(__file__), "avatar_harness.js")


def good(**changes):
    value = {"source": "upload", "size": 16, "palette": ["#112233", "#AABBCC"],
             "frames": [{"pixels": "01." * 85 + "0", "delay": 50}]}
    value.update(changes)
    return value


class CleanTest(unittest.TestCase):
    def test_valid_avatar_is_normalized(self):
        result = avatar.clean(dict(good(), extra="dropped", preset="x"))
        self.assertEqual(result["palette"], ["#112233", "#aabbcc"])
        self.assertNotIn("extra", result)
        self.assertNotIn("preset", result)  # only presets keep their id

    def test_builder_keeps_parts(self):
        result = avatar.clean(good(source="builder", parts={"hair": "short", "bg": "night"}))
        self.assertEqual(result["parts"], {"hair": "short", "bg": "night"})

    def test_delays_are_clamped(self):
        frames = [{"pixels": "0" * 256, "delay": 1}, {"pixels": "1" * 256, "delay": 10 ** 9}]
        result = avatar.clean(good(frames=frames))
        self.assertEqual([f["delay"] for f in result["frames"]], [20, 10000])

    def test_rejects_bad_input(self):
        bad = [
            None, "x", good(source="url"), good(size=64), good(size=True),
            good(palette=[]), good(palette=["red"]), good(palette=["#000000"] * 33),
            good(palette=["#000000;background:url(x)"]),
            good(frames=[]), good(frames=[{"pixels": "0" * 255}]),
            good(frames=[{"pixels": "2" * 256}]),            # index outside the palette
            good(frames=[{"pixels": "<" * 256}]),
            good(frames=[{"pixels": "0" * 256, "delay": "1"}]),
            good(frames=[{"pixels": "0" * 256}] * 65),
            good(source="preset"), good(source="preset", preset="../x"),
            good(source="builder", parts={"hair": "<b>"}),
            good(source="builder", parts={str(i): "a" for i in range(17)}),
            good(source="builder", parts=["hair"]),
        ]
        for value in bad:
            with self.subTest(value=str(value)[:80]):
                with self.assertRaises(ValueError):
                    avatar.clean(value)


# --- a tiny GIF writer, independent from the decoder under test ----------------------

def lzw_encode(indices, min_code):
    clear, end = 1 << min_code, (1 << min_code) + 1
    size, next_code = min_code + 1, end + 1
    table = {(i,): i for i in range(clear)}
    codes = [(clear, size)]
    w = ()
    for k in indices:
        if w + (k,) in table:
            w += (k,)
            continue
        codes.append((table[w], size))
        if next_code < 4096:
            table[w + (k,)] = next_code
            next_code += 1
            if next_code > (1 << size) and size < 12:
                size += 1
        w = (k,)
    codes.append((table[w], size))
    codes.append((end, size))
    data, acc, bits = bytearray(), 0, 0
    for code, n in codes:
        acc |= code << bits
        bits += n
        while bits >= 8:
            data.append(acc & 255)
            acc >>= 8
            bits -= 8
    if bits:
        data.append(acc)
    out = bytearray([min_code])
    for i in range(0, len(data), 255):
        chunk = data[i:i + 255]
        out += bytes([len(chunk)]) + chunk
    return bytes(out + b"\0")


def gif(width, height, palette, frames):
    """frames: dicts with rect, rows (palette indexes), delay, disposal, transparent,
    optional local palette and interlace."""
    def table(colors):
        size = 1
        while (2 << (size - 1)) < len(colors):
            size += 1
        colors = colors + [(0, 0, 0)] * ((2 << (size - 1)) - len(colors))
        return size - 1, b"".join(bytes(c) for c in colors)

    bits, gct = table(palette)
    out = bytearray(b"GIF89a") + bytes([width & 255, width >> 8, height & 255, height >> 8,
                                        0x80 | bits, 0, 0]) + gct
    for f in frames:
        t = f.get("transparent", -1)
        out += bytes([0x21, 0xF9, 4, (f.get("disposal", 0) << 2) | (t >= 0),
                      f["delay"] & 255, f["delay"] >> 8, max(t, 0), 0])
        x, y, w, h = f["rect"]
        flags, local = 0, b""
        if "palette" in f:
            lbits, local = table(f["palette"])
            flags = 0x80 | lbits
        rows = f["rows"]
        if f.get("interlace"):
            flags |= 0x40
            order = [r for start, step in ((0, 8), (4, 8), (2, 4), (1, 2))
                     for r in range(start, h, step)]
            rows = [rows[r] for r in order]
        out += bytes([0x2C, x, 0, y, 0, w, 0, h, 0, flags]) + local
        out += lzw_encode([i for row in rows for i in row], 2)
    return bytes(out + b"\x3B")


RED, GREEN, BLUE, WHITE = (200, 0, 0), (0, 200, 0), (0, 0, 200), (255, 255, 255)
LOCAL = [(10, 10, 10), (20, 20, 20), (30, 30, 30), (40, 40, 40)]


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class AvatarJsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        folder = temp_dir(cls)
        frames = [
            # Red with a transparent corner; kept as is.
            {"rect": (0, 0, 4, 4), "rows": [[3, 0, 0, 0]] + [[0] * 4] * 3, "delay": 5,
             "disposal": 1, "transparent": 3},
            # Blue square, cleared after showing (disposal 2); 10 ms becomes 100 ms.
            {"rect": (1, 1, 2, 2), "rows": [[2, 2], [2, 2]], "delay": 1, "disposal": 2},
            # One green pixel where the blue was; restored away afterwards (disposal 3).
            {"rect": (2, 2, 1, 1), "rows": [[1]], "delay": 30, "disposal": 3},
            # Interlaced rows of local colors; pixel (3,3) transparent shows what is below.
            {"rect": (0, 0, 4, 4), "rows": [[0] * 4, [1] * 4, [2] * 4, [2, 2, 2, 3]],
             "delay": 40, "palette": LOCAL, "interlace": True, "transparent": 3},
        ]
        path = os.path.join(folder, "t.gif")
        with open(path, "wb") as f:
            f.write(gif(4, 4, [RED, GREEN, BLUE, WHITE], frames))
        run = subprocess.run([JSC, HARNESS, "--", paths.PROJECT_DIR, path],
                             capture_output=True, text=True, timeout=60)
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.result = json.loads(run.stdout)

    def pixels(self, frame):
        raw = bytes.fromhex(frame["rgba"])
        return [tuple(raw[i:i + 3]) if raw[i + 3] else None for i in range(0, len(raw), 4)]

    def test_builder_and_presets_pass_the_python_check(self):
        for value in self.result["builder"]:
            with self.subTest(value.get("preset") or value.get("parts")):
                self.assertEqual(avatar.clean(value)["size"], 16)
        unknown = self.result["builder"][-1]["parts"]
        self.assertEqual((unknown["hair"], unknown["skin"]), ("none", "light"))

    def test_gif_frames_follow_disposal_and_transparency(self):
        frames = self.result["gif"]
        self.assertEqual([f["delay"] for f in frames], [50, 100, 300, 400])
        f1, f2, f3, f4 = (self.pixels(f) for f in frames)
        self.assertEqual(f1, [None] + [RED] * 15)
        self.assertEqual([f2[5], f2[6], f2[9], f2[10], f2[0], f2[15]],
                         [BLUE, BLUE, BLUE, BLUE, None, RED])
        # Blue area was cleared (disposal 2), then one green pixel drawn at (2,2).
        self.assertEqual([f3[5], f3[6], f3[9], f3[10], f3[4]], [None, None, None, GREEN, RED])
        # Frame 3 used disposal 3, so frame 4 is drawn over frame 2's cleared state.
        self.assertEqual(f4[0:4], [LOCAL[0]] * 4)
        self.assertEqual(f4[4:8], [LOCAL[1]] * 4)
        self.assertEqual(f4[12:15], [LOCAL[2]] * 3)
        self.assertEqual(f4[15], RED)  # transparent pixel shows the frame below

    def test_dropped_frames_give_their_delay_to_kept_ones(self):
        self.assertEqual(self.result["gif_kept"], [150, 700])

    def test_quantized_upload_is_valid(self):
        value = avatar.clean(self.result["quantized"])
        self.assertLessEqual(len(value["palette"]), 32)
        self.assertEqual(len(value["frames"]), 1)       # identical frames are merged
        self.assertEqual(value["frames"][0]["delay"], 200)
        self.assertEqual(value["frames"][0]["pixels"][:32], "." * 32)

    def test_fit_and_crop(self):
        fit, crop = self.result["fit"]["fit"], self.result["fit"]["crop"]
        self.assertTrue(fit["frames"][0]["pixels"].startswith("." * 16))
        self.assertNotIn(".", crop["frames"][0]["pixels"])

    def test_huge_gif_is_refused_before_decoding(self):
        self.assertIn("слишком большой", self.result["huge_error"])


if __name__ == "__main__":
    unittest.main()
