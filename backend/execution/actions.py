"""pyautogui input actions, made interruptible for the M3 safety layer.

Two stop mechanisms:
  - a process-wide HALT event (set by the panic stop) checked before every action
    and between sub-steps of long actions (segmented moves, per-character typing),
    so a panic lands in well under 100ms even mid-action;
  - pyautogui's built-in corner failsafe (mouse to top-left raises FailSafeException).
"""

from __future__ import annotations

import logging
import threading
import time

log = logging.getLogger("autoveda.actions")

_VALID = {"click", "double_click", "type", "move"}
_HALT = threading.Event()


class PanicAbort(RuntimeError):
    """Raised mid-action when the panic stop / halt is engaged."""


def set_halt() -> None:
    _HALT.set()


def clear_halt() -> None:
    _HALT.clear()


def is_halted() -> bool:
    return _HALT.is_set()


def is_failsafe(exc: BaseException) -> bool:
    """True if exc is pyautogui's corner-failsafe exception."""
    try:
        import pyautogui

        return isinstance(exc, pyautogui.FailSafeException)
    except Exception:
        return False


def _pg():
    import pyautogui

    pyautogui.FAILSAFE = True  # corner = stop
    pyautogui.PAUSE = 0  # we pace + check halt ourselves for interruptibility
    return pyautogui


def _check(should_stop) -> None:
    if _HALT.is_set() or (should_stop and should_stop()):
        raise PanicAbort("halted")


def _move(pg, x: int, y: int, duration: float, should_stop) -> None:
    """Move in small hops, checking the halt flag between each so panic interrupts."""
    sx, sy = pg.position()
    hops = 1 if duration <= 0 else max(1, min(40, int(duration / 0.015)))
    for i in range(1, hops + 1):
        _check(should_stop)
        nx = round(sx + (x - sx) * i / hops)
        ny = round(sy + (y - sy) * i / hops)
        pg.moveTo(nx, ny)
        if duration > 0:
            time.sleep(duration / hops)


def do_action(action: str, center, value=None, move_duration: float = 0.2, should_stop=None) -> str:
    """Move to `center` and perform `action`. Raises PanicAbort if halted."""
    if action not in _VALID:
        raise ValueError(f"unknown action: {action!r}")
    _check(should_stop)
    pg = _pg()
    x, y = int(center[0]), int(center[1])

    _move(pg, x, y, move_duration, should_stop)
    if action == "move":
        return f"moved to ({x}, {y})"
    if action == "click":
        _check(should_stop)
        pg.click(x, y)
        return f"clicked at ({x}, {y})"
    if action == "double_click":
        _check(should_stop)
        pg.doubleClick(x, y)
        return f"double-clicked at ({x}, {y})"
    if action == "type":
        _check(should_stop)
        pg.click(x, y)  # focus first
        for ch in str(value or ""):
            _check(should_stop)
            pg.typewrite(ch, interval=0)
            time.sleep(0.01)
        return f"typed {value!r} at ({x}, {y})"
    raise ValueError(f"unhandled action: {action!r}")  # pragma: no cover
