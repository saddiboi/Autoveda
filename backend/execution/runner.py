"""The see-and-act run loop: resolve region -> capture -> locate -> act -> log.

Keeps an in-memory log of recent step results for the UI (observability is a
feature here). Stops a sequence at the first failing step.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional

from perception.capture import grab_region, primary_monitor
from perception.locate import locate
from perception.windows import WindowBackendUnavailable, window_status
from storage import load_scan_target

from .actions import do_action

log = logging.getLogger("autoveda.runner")

_RUN_LOG: list[dict] = []
_MAX_LOG = 200


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def resolve_region():
    """Map the saved scan target to a concrete capture region (physical px).

    Returns (region | None, window_id | None, error | None). Window mode pauses
    (error) while the window is minimized or missing.
    """
    target = load_scan_target()
    if not target:
        return None, None, "No scan target selected. Choose one under Scan target."
    mode = target.get("mode")
    if mode == "fullscreen":
        return primary_monitor(), None, None
    if mode == "rectangle":
        r = target.get("region")
        if not r:
            return None, None, "Rectangle target has no saved region."
        return {"x": r["x"], "y": r["y"], "width": r["width"], "height": r["height"]}, None, None
    if mode == "window":
        win = target.get("window") or {}
        wid = win.get("id")
        try:
            st = window_status(wid)
        except WindowBackendUnavailable as exc:
            return None, wid, f"Window mode unsupported: {exc}"
        if not st["present"]:
            return None, wid, "Target window not found — automation paused."
        if st["minimized"]:
            return None, wid, "Target window is minimized — automation paused."
        b = st["bounds"]
        return {"x": b["x"], "y": b["y"], "width": b["width"], "height": b["height"]}, wid, None
    return None, None, f"Unknown scan mode: {mode!r}"


def _record(result: dict, started: float) -> dict:
    result["duration_ms"] = round((time.perf_counter() - started) * 1000, 1)
    log.info(
        "step find=%r action=%s -> ok=%s method=%s msg=%s",
        result["step"].get("find"),
        result["step"].get("action"),
        result["ok"],
        result["method"],
        result["message"],
    )
    _RUN_LOG.append(result)
    if len(_RUN_LOG) > _MAX_LOG:
        del _RUN_LOG[: len(_RUN_LOG) - _MAX_LOG]
    return result


def run_step(step: dict, region: Optional[dict] = None, window_id: Optional[int] = None) -> dict:
    """Execute one step. If region is None it's resolved from the saved target."""
    started = time.perf_counter()
    result = {
        "step": step,
        "timestamp": _now(),
        "ok": False,
        "found": False,
        "method": None,
        "match": None,
        "action": step.get("action", "click"),
        "action_done": False,
        "message": None,
        "error": None,
    }

    find = step.get("find")
    action = step.get("action", "click")
    value = step.get("value")

    try:
        if region is None:
            region, window_id, err = resolve_region()
            if err:
                result["error"] = err
                result["message"] = err
                return _record(result, started)

        if not find:
            result["error"] = "step has no 'find' text"
            result["message"] = result["error"]
            return _record(result, started)

        image, origin = grab_region(region)
        match, locate_err = locate(find, image, origin, region=region, window_id=window_id)
        if not match:
            result["error"] = locate_err or "target not found"
            result["message"] = result["error"]
            return _record(result, started)

        result["found"] = True
        result["method"] = match["method"]
        result["match"] = match

        summary = do_action(action, match["center"], value=value)
        result["action_done"] = True
        result["ok"] = True
        result["message"] = (
            f"{match['method']}: found {find!r} at "
            f"({match['center'][0]}, {match['center'][1]}); {summary}"
        )
    except Exception as exc:
        result["error"] = str(exc)
        result["message"] = f"error: {exc}"
        log.exception("step failed")

    return _record(result, started)


def run_steps(steps: list[dict], pre_delay: float = 0.0) -> dict:
    """Resolve the region once, then run steps in order, stopping at first failure."""
    region, window_id, err = resolve_region()
    if err:
        return {"ok": False, "error": err, "completed": 0, "total": len(steps), "results": []}

    if pre_delay and pre_delay > 0:
        time.sleep(min(pre_delay, 10))

    results = []
    for i, step in enumerate(steps):
        r = run_step(step, region=region, window_id=window_id)
        r["index"] = i
        results.append(r)
        if not r["ok"]:
            break

    completed = sum(1 for r in results if r["ok"])
    return {
        "ok": completed == len(steps) and len(steps) > 0,
        "completed": completed,
        "total": len(steps),
        "results": results,
    }


def get_run_log() -> list[dict]:
    return list(_RUN_LOG)
