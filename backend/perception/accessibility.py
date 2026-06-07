"""Accessibility-tree lookup via UI Automation (uiautomation on Windows).

This is the fast, precise, no-model path tried first. Searches the target window's
control subtree (or the desktop) for a control whose Name matches the target text,
returning its bounding rectangle in physical pixels.
"""

from __future__ import annotations

from collections import deque
from typing import Optional


class AccessibilityUnavailable(RuntimeError):
    """UI Automation backend not available on this platform."""


def _ua():
    try:
        import uiautomation as ua
        return ua
    except Exception as exc:
        raise AccessibilityUnavailable(
            f"UI Automation unavailable on this platform: {exc}"
        ) from exc


def _center_in_region(rect, region: Optional[dict]) -> bool:
    if region is None:
        return True
    cx = (rect.left + rect.right) // 2
    cy = (rect.top + rect.bottom) // 2
    return (
        region["x"] <= cx <= region["x"] + region["width"]
        and region["y"] <= cy <= region["y"] + region["height"]
    )


def find_element(
    target: str,
    region: Optional[dict] = None,
    window_id: Optional[int] = None,
    max_nodes: int = 4000,
    max_depth: int = 30,
) -> Optional[dict]:
    """Bounded BFS over the UIA tree for a control whose Name contains `target`.
    Exact (case-insensitive) name matches win over substring matches.
    """
    ua = _ua()
    target_norm = target.strip().lower()
    if not target_norm:
        return None

    if window_id:
        root = ua.ControlFromHandle(int(window_id))
        if not root:
            return None
    else:
        root = ua.GetRootControl()

    queue = deque([(root, 0)])
    visited = 0
    best = None

    while queue and visited < max_nodes:
        ctrl, depth = queue.popleft()
        visited += 1
        try:
            name = (ctrl.Name or "").strip()
        except Exception:
            name = ""

        if name and target_norm in name.lower():
            try:
                if not ctrl.IsOffscreen:
                    rect = ctrl.BoundingRectangle
                    if rect and rect.width() > 0 and rect.height() > 0 and _center_in_region(rect, region):
                        exact = name.lower() == target_norm
                        cand = {
                            "name": name,
                            "bbox": [rect.left, rect.top, rect.right, rect.bottom],
                            "center": [rect.xcenter(), rect.ycenter()],
                            "control_type": ctrl.ControlTypeName,
                            "exact": exact,
                        }
                        if best is None or (exact and not best["exact"]):
                            best = cand
                            if exact:
                                break
            except Exception:
                pass

        if depth < max_depth:
            try:
                for child in ctrl.GetChildren():
                    queue.append((child, depth + 1))
            except Exception:
                pass

    if best is None:
        return None
    return {
        "method": "accessibility",
        "text": best["name"],
        "bbox": best["bbox"],
        "center": best["center"],
        "confidence": 1.0,
        "control_type": best["control_type"],
        "exact": best["exact"],
    }
