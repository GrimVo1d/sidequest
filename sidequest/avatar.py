"""The player's avatar: a small pixel grid with a palette, or a full-color picture.

Every source (preset, builder, uploaded picture or GIF) is turned into one of these
formats in the page; Python only checks it. The uploaded file itself is never stored or
passed on.

Pixel avatar (presets, the builder, an upload turned into pixels):

    {"source": "preset" | "builder" | "upload",
     "preset": "<id>",                  # preset only
     "parts": {"hair": "short", ...},   # preset and builder: lets a DLC redraw it
     "size": 16 | 32,
     "palette": ["#rrggbb", ...],       # up to 32 colors
     "frames": [{"pixels": "..0a1", "delay": 100}, ...]}

`pixels` holds size * size characters, row by row: "." is transparent, "0".."9" and
"a".."v" are palette indexes 0..31. `delay` is in milliseconds.

Picture avatar (an upload kept as is, only shrunk to a square):

    {"source": "upload",
     "size": 128 | 256,
     "frames": [{"rgba": "<base64>", "delay": 100}, ...]}

`rgba` is size * size * 4 bytes, row by row. All frames together are at most
MAX_PICTURE_BYTES, so a long GIF comes as 128 x 128.
"""

import base64
import binascii
import re
from typing import Any, NotRequired, TypedDict


class PixelFrame(TypedDict):
    pixels: str
    delay: int


class PictureFrame(TypedDict):
    rgba: str
    delay: int


class PixelAvatar(TypedDict):
    source: str
    size: int
    palette: list[str]
    frames: list[PixelFrame]
    preset: NotRequired[str]
    parts: NotRequired[dict[str, str]]


class PictureAvatar(TypedDict):
    source: str
    size: int
    frames: list[PictureFrame]


SOURCES = ("preset", "builder", "upload")
SIZES = (16, 32)
PICTURE_SIZES = (128, 256)
MAX_PICTURE_BYTES = 4 * 1024 * 1024
MAX_COLORS = 32
MAX_FRAMES = 64
MAX_PARTS = 16
MIN_DELAY, MAX_DELAY = 20, 10000
PIXEL_CHARS = "0123456789abcdefghijklmnopqrstuv"

_COLOR_RE = re.compile(r"^#[0-9a-f]{6}\Z")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}\Z")


def clean(avatar: object) -> PixelAvatar | PictureAvatar:
    """Return a checked copy of `avatar` with only known fields; raise ValueError."""
    if not isinstance(avatar, dict):
        raise ValueError("avatar must be an object")
    source = avatar.get("source")
    if source not in SOURCES:
        raise ValueError("unknown avatar source")
    size = avatar.get("size")
    if isinstance(size, bool) or size not in SIZES + PICTURE_SIZES:
        raise ValueError("avatar size must be 16, 32, 128 or 256")
    if size in PICTURE_SIZES:
        if source != "upload":
            raise ValueError("only an uploaded avatar can be a picture")
        return {"source": source, "size": size, "frames": _picture_frames(avatar, size)}

    palette = avatar.get("palette")
    if not isinstance(palette, list) or not 1 <= len(palette) <= MAX_COLORS:
        raise ValueError(f"palette must have 1..{MAX_COLORS} colors")
    palette = [str(c).lower() for c in palette]
    if not all(_COLOR_RE.match(c) for c in palette):
        raise ValueError("palette colors must look like #rrggbb")

    frames = avatar.get("frames")
    if not isinstance(frames, list) or not 1 <= len(frames) <= MAX_FRAMES:
        raise ValueError(f"avatar must have 1..{MAX_FRAMES} frames")
    allowed = set("." + PIXEL_CHARS[: len(palette)])
    clean_frames: list[PixelFrame] = []
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError("frame must be an object")
        pixels = frame.get("pixels")
        if not isinstance(pixels, str) or len(pixels) != size * size:
            raise ValueError("frame must have size * size pixels")
        if not set(pixels) <= allowed:
            raise ValueError("pixel outside the palette")
        clean_frames.append({"pixels": pixels, "delay": _delay(frame)})

    result: PixelAvatar = {
        "source": source,
        "size": size,
        "palette": palette,
        "frames": clean_frames,
    }
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
            if not (
                isinstance(key, str)
                and _ID_RE.match(key)
                and isinstance(value, str)
                and _ID_RE.match(value)
            ):
                raise ValueError("bad part")
        result["parts"] = dict(parts)
    return result


def _delay(frame: dict[str, Any]) -> int:
    delay = frame.get("delay", 100)
    if not isinstance(delay, (int, float)) or isinstance(delay, bool):
        raise ValueError("delay must be a number")
    return max(MIN_DELAY, min(MAX_DELAY, int(delay)))


def _picture_frames(avatar: dict[str, Any], size: int) -> list[PictureFrame]:
    frames = avatar.get("frames")
    if not isinstance(frames, list) or not 1 <= len(frames) <= MAX_FRAMES:
        raise ValueError(f"avatar must have 1..{MAX_FRAMES} frames")
    if len(frames) * size * size * 4 > MAX_PICTURE_BYTES:
        raise ValueError("picture avatar is too big")
    result: list[PictureFrame] = []
    for frame in frames:
        if not isinstance(frame, dict) or not isinstance(frame.get("rgba"), str):
            raise ValueError("frame must have rgba")
        # The length is checked before decoding, so a huge string is never decoded.
        if len(frame["rgba"]) != 4 * ((size * size * 4 + 2) // 3):
            raise ValueError("frame must have size * size * 4 bytes")
        try:
            raw = base64.b64decode(frame["rgba"], validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("rgba must be base64") from None
        if len(raw) != size * size * 4:
            raise ValueError("frame must have size * size * 4 bytes")
        result.append({"rgba": base64.b64encode(raw).decode("ascii"), "delay": _delay(frame)})
    return result
