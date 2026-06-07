"""Screen capture via mss. Returns a PIL image plus the region origin so callers
can convert region-local coordinates back to absolute screen pixels.
"""

from __future__ import annotations

import mss
from PIL import Image


def grab_region(region: dict):
    """Capture {x, y, width, height} (physical px). Returns (PIL.Image, (ox, oy))."""
    monitor = {
        "left": int(region["x"]),
        "top": int(region["y"]),
        "width": int(region["width"]),
        "height": int(region["height"]),
    }
    with mss.mss() as sct:
        shot = sct.grab(monitor)
    img = Image.frombytes("RGB", shot.size, shot.rgb)
    return img, (monitor["left"], monitor["top"])


def primary_monitor() -> dict:
    """Bounds of the primary monitor in physical pixels."""
    with mss.mss() as sct:
        m = sct.monitors[1]  # [0] is the virtual "all monitors" rect; [1] is primary
    return {"x": m["left"], "y": m["top"], "width": m["width"], "height": m["height"]}
