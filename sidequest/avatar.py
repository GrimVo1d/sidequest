"""The player's avatar: a small pixel grid with a palette, optionally animated.

Every source (preset, builder, uploaded picture or GIF) is turned into this format in the
page; Python only checks it. The uploaded file itself is never stored or passed on.

    {"source": "preset" | "builder" | "upload",
     "preset": "<id>",                  # preset only
     "parts": {"hair": "short", ...},   # preset and builder: lets a DLC redraw it
     "size": 16 | 32,
     "palette": ["#rrggbb", ...],       # up to 32 colors
     "frames": [{"pixels": "..0a1", "delay": 100}, ...]}

`pixels` holds size * size characters, row by row: "." is transparent, "0".."9" and
"a".."v" are palette indexes 0..31. `delay` is in milliseconds.
"""
import re

SOURCES = ("preset", "builder", "upload")
SIZES = (16, 32)
MAX_COLORS = 32
MAX_FRAMES = 64
MAX_PARTS = 16
MIN_DELAY, MAX_DELAY = 20, 10000
PIXEL_CHARS = "0123456789abcdefghijklmnopqrstuv"

_COLOR_RE = re.compile(r"^#[0-9a-f]{6}$")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


def clean(avatar):
    """Return a checked copy of `avatar` with only known fields; raise ValueError."""
    if not isinstance(avatar, dict):
        raise ValueError("avatar must be an object")
    source = avatar.get("source")
    if source not in SOURCES:
        raise ValueError("unknown avatar source")
    size = avatar.get("size")
    if size not in SIZES or isinstance(size, bool):
        raise ValueError("avatar size must be 16 or 32")

    palette = avatar.get("palette")
    if not isinstance(palette, list) or not 1 <= len(palette) <= MAX_COLORS:
        raise ValueError(f"palette must have 1..{MAX_COLORS} colors")
    palette = [str(c).lower() for c in palette]
    if not all(_COLOR_RE.match(c) for c in palette):
        raise ValueError("palette colors must look like #rrggbb")

    frames = avatar.get("frames")
    if not isinstance(frames, list) or not 1 <= len(frames) <= MAX_FRAMES:
        raise ValueError(f"avatar must have 1..{MAX_FRAMES} frames")
    allowed = set("." + PIXEL_CHARS[:len(palette)])
    clean_frames = []
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError("frame must be an object")
        pixels = frame.get("pixels")
        if not isinstance(pixels, str) or len(pixels) != size * size:
            raise ValueError("frame must have size * size pixels")
        if not set(pixels) <= allowed:
            raise ValueError("pixel outside the palette")
        delay = frame.get("delay", 100)
        if not isinstance(delay, (int, float)) or isinstance(delay, bool):
            raise ValueError("delay must be a number")
        clean_frames.append({"pixels": pixels,
                             "delay": max(MIN_DELAY, min(MAX_DELAY, int(delay)))})

    result = {"source": source, "size": size, "palette": palette, "frames": clean_frames}
    if source == "preset":
        preset = avatar.get("preset")
        if not isinstance(preset, str) or not _ID_RE.match(preset):
            raise ValueError("bad preset id")
        result["preset"] = preset
    if source in ("preset", "builder") and avatar.get("parts") is not None:
        parts = avatar["parts"]
        if not isinstance(parts, dict) or len(parts) > MAX_PARTS:
            raise ValueError("bad parts")
        for key, value in parts.items():
            if not (isinstance(key, str) and _ID_RE.match(key)
                    and isinstance(value, str) and _ID_RE.match(value)):
                raise ValueError("bad part")
        result["parts"] = dict(parts)
    return result
