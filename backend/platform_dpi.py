"""Make the backend process DPI-aware so mss, pyautogui, uiautomation and
pygetwindow all speak the same coordinate space (physical pixels) on Windows.

Must run before pyautogui / uiautomation are imported, so the perception and
execution packages call this from their __init__.
"""

from __future__ import annotations

import ctypes
import logging
import sys

log = logging.getLogger("autoveda.dpi")
_done = False


def enable_dpi_awareness() -> None:
    global _done
    if _done:
        return
    _done = True
    if sys.platform != "win32":
        return
    try:
        # PROCESS_PER_MONITOR_DPI_AWARE = 2
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception as exc:  # pragma: no cover - very old Windows
            log.warning("could not set DPI awareness: %s", exc)
