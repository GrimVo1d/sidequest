"""The menus' pixel font (pixelfont.js): a well-formed TrueType file built in jsc."""

import base64
import json
import os
import struct
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "pixelfont_harness.js")
P = 128  # font units in one pixel of a glyph


def checksum(data: bytes) -> int:
    data += b"\0" * (-len(data) % 4)
    return sum(struct.unpack(f">{len(data) // 4}I", data)) % 2**32


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class PixelFontTest(unittest.TestCase):
    font: bytes
    glyphs: dict[str, str]
    same: dict[str, str]
    tables: dict[str, tuple[int, bytes]]

    @classmethod
    def setUpClass(cls):
        run = subprocess.run(
            [JSC, HARNESS, "--", paths.PROJECT_DIR], capture_output=True, text=True, timeout=60
        )
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        out = json.loads(run.stdout)
        cls.font = base64.b64decode(out["font"])
        cls.glyphs, cls.same = out["glyphs"], out["same"]
        count = struct.unpack(">H", cls.font[4:6])[0]
        cls.tables = {}
        for i in range(count):
            tag, check, offset, length = struct.unpack(
                ">4sIII", cls.font[12 + 16 * i : 28 + 16 * i]
            )
            cls.tables[tag.decode()] = (check, cls.font[offset : offset + length])

    def table(self, tag: str) -> bytes:
        return self.tables[tag][1]

    def test_tables_and_checksums(self):
        self.assertEqual(
            sorted(self.tables),
            ["OS/2", "cmap", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "post"],
        )
        for tag, (check, data) in self.tables.items():
            if tag == "head":
                data = data[:8] + b"\0\0\0\0" + data[12:]
            self.assertEqual(checksum(data), check, tag)
        self.assertEqual(checksum(self.font), 0xB1B0AFBA)
        self.assertEqual(struct.unpack(">I", self.table("head")[12:16])[0], 0x5F0F3CF5)

    def cmap(self) -> dict[int, int]:
        data = self.table("cmap")
        sub = data[struct.unpack(">I", data[8:12])[0] :]
        self.assertEqual(struct.unpack(">H", sub[:2])[0], 4)
        segs = struct.unpack(">H", sub[6:8])[0] // 2
        ends = struct.unpack(f">{segs}H", sub[14 : 14 + 2 * segs])
        at = 16 + 2 * segs
        starts = struct.unpack(f">{segs}H", sub[at : at + 2 * segs])
        deltas = struct.unpack(f">{segs}h", sub[at + 2 * segs : at + 4 * segs])
        self.assertEqual(list(starts), sorted(starts))
        found = {}
        for start, end, delta in zip(starts, ends, deltas, strict=True):
            for code in range(start, end + 1):
                if code != 0xFFFF:
                    found[code] = (code + delta) % 65536
        return found

    def test_upper_and_lower_case_share_a_glyph(self):
        cmap = self.cmap()
        keys = list(self.glyphs)
        for ch in ("A", "Z", "Б", "Я", "0", "…"):
            self.assertEqual(cmap[ord(ch)], keys.index(ch) + 1, ch)
        for upper, lower in (("A", "a"), ("Ж", "ж"), ("Я", "я")):
            self.assertEqual(cmap[ord(lower)], cmap[ord(upper)])
        # Letters drawn alike in both alphabets: Cyrillic А is Latin A, ё is E.
        self.assertEqual(cmap[ord("А")], cmap[ord("A")])
        self.assertEqual(cmap[ord("ё")], cmap[ord("E")])
        self.assertNotIn(ord("&"), cmap)

    def test_glyphs_keep_their_pixels(self):
        head, loca, glyf = self.table("head"), self.table("loca"), self.table("glyf")
        self.assertEqual(struct.unpack(">h", head[50:52])[0], 1)  # long offsets
        n = struct.unpack(">H", self.table("maxp")[4:6])[0]
        self.assertEqual(n, len(self.glyphs) + 1)
        offsets = struct.unpack(f">{n + 1}I", loca[: 4 * (n + 1)])
        hmtx = self.table("hmtx")
        for i, (ch, rows) in enumerate(self.glyphs.items(), start=1):
            rows = rows.split("|")
            advance = struct.unpack(">H", hmtx[4 * i : 4 * i + 2])[0]
            self.assertEqual(advance, (len(rows[0]) + 1) * P, ch)
            body = glyf[offsets[i] : offsets[i + 1]]
            lit = [(x, y) for y, row in enumerate(rows) for x, c in enumerate(row) if c == "#"]
            if not lit:
                self.assertEqual(body, b"", ch)
                continue
            contours, *box = struct.unpack(">5h", body[:10])
            self.assertGreater(contours, 0, ch)
            expected = [
                min(x for x, _ in lit) * P,
                (5 - max(y for _, y in lit) - 1) * P,
                (max(x for x, _ in lit) + 1) * P,
                (5 - min(y for _, y in lit)) * P,
            ]
            self.assertEqual(box, expected, ch)

    def test_metrics_fit_the_line(self):
        hhea = self.table("hhea")
        ascent, descent = struct.unpack(">hh", hhea[4:8])
        em = struct.unpack(">H", self.table("head")[18:20])[0]
        self.assertEqual(ascent - descent, em)
        self.assertGreaterEqual(ascent, 5 * P)
        self.assertLessEqual(descent, -P)


if __name__ == "__main__":
    unittest.main()
