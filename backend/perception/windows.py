"""Open-window enumeration for the Window scan mode.

Uses pygetwindow (ctypes-based on Windows; limited elsewhere). All access is behind
small functions so the rest of the app doesn't depend on the library directly, and
so an unsupported platform degrades to an empty list / clear error instead of crashing.
"""

from __future__ import annotations

from typing import Optional


class WindowBackendUnavailable(RuntimeError):
    """Raised when no window-management backend is available on this platform."""


def _gw():
    try:
        import pygetwindow as gw  # noqa: WPS433 (lazy import on purpose)
        return gw
    except Exception as exc:  # ImportError or platform error
        raise WindowBackendUnavailable(
            "Window enumeration is unavailable on this platform "
            "(pygetwindow not installed or unsupported). "
            f"Underlying error: {exc}"
        ) from exc


def _bounds(w) -> dict:
    return {"x": int(w.left), "y": int(w.top), "width": int(w.width), "height": int(w.height)}


def _is_listable(w) -> bool:
    title = (w.title or "").strip()
    if not title:
        return False
    # IsWindowVisible-style check: minimized windows still count as visible, hidden
    # system surfaces don't. Keep minimized ones so the user can still pick them.
    if getattr(w, "visible", True) is False:
        return False
    return True


def list_windows() -> list[dict]:
    """Return open, titled windows as plain dicts (id = native handle)."""
    gw = _gw()
    out: list[dict] = []
    seen = set()
    for w in gw.getAllWindows():
        try:
            if not _is_listable(w):
                continue
            handle = getattr(w, "_hWnd", None)
            if handle is None or handle in seen:
                continue
            seen.add(handle)
            out.append(
                {
                    "id": int(handle),
                    "title": (w.title or "").strip(),
                    "bounds": _bounds(w),
                    "minimized": bool(w.isMinimized),
                }
            )
        except Exception:
            # A window can vanish mid-enumeration; skip it rather than fail the list.
            continue
    out.sort(key=lambda d: d["title"].lower())
    return out


def get_window(win_id: int):
    gw = _gw()
    for w in gw.getAllWindows():
        if getattr(w, "_hWnd", None) == win_id:
            return w
    return None


def window_status(win_id: Optional[int]) -> dict:
    """Live status for a previously chosen window: present? minimized? where?"""
    if win_id is None:
        return {"present": False, "minimized": False, "bounds": None}
    w = get_window(int(win_id))
    if w is None:
        return {"present": False, "minimized": False, "bounds": None}
    minimized = bool(w.isMinimized)
    return {
        "present": True,
        "minimized": minimized,
        # Minimized windows report off-screen junk coords; don't trust bounds then.
        "bounds": None if minimized else _bounds(w),
    }
