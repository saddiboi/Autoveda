"""RunController: the safety-gated, interruptible see-and-act engine.

Runs a step sequence on a worker thread so the HTTP server stays responsive (the
panic endpoint must be served while a run is in flight). Provides:
  - panic stop (halts input in <100ms via the actions HALT flag + stop event),
  - corner-failsafe handling,
  - confidence-threshold and action-preview gating (pause and ask),
  - a full timestamped action-history log per run.
"""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone

from execution import actions
from execution.runner import resolve_region
from perception.capture import grab_region
from perception.locate import locate
from storage import load_safety_settings, save_safety_settings

log = logging.getLogger("autoveda.safety")

_MAX_HISTORY = 500
_VALID_DECISIONS = {"act", "skip", "stop"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class RunController:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._resume = threading.Event()
        self._decision: dict | None = None
        self._reset()

    # --- state -------------------------------------------------------------
    def _reset(self) -> None:
        self.status = "idle"  # idle|running|paused|completed|stopped|error
        self.run_id = None
        self.steps: list[dict] = []
        self.index = 0
        self.total = 0
        self.history: list[dict] = []
        self.pending: dict | None = None
        self.started_at = None
        self.ended_at = None

    def _add(self, kind: str, message: str, data: dict | None = None) -> dict:
        entry = {"ts": _now_iso(), "type": kind, "message": message, "data": data or {}}
        self.history.append(entry)
        if len(self.history) > _MAX_HISTORY:
            del self.history[: len(self.history) - _MAX_HISTORY]
        log.info("[%s] %s", kind, message)
        return entry

    def is_active(self) -> bool:
        return self.status in ("running", "paused")

    # --- settings ----------------------------------------------------------
    def get_settings(self) -> dict:
        return load_safety_settings()

    def update_settings(self, patch: dict) -> dict:
        return save_safety_settings(patch)

    # --- control -----------------------------------------------------------
    def start(self, steps: list[dict]) -> dict:
        with self._lock:
            if self.is_active():
                return {"ok": False, "error": "A run is already active.", "state": self.state()}
            self._reset()
            self.run_id = uuid.uuid4().hex[:8]
            self.steps = steps
            self.total = len(steps)
            self.status = "running"
            self.started_at = _now_iso()
            self._stop.clear()
            self._resume.clear()
            self._decision = None
            actions.clear_halt()
            self._add("run_start", f"Run {self.run_id} started — {self.total} step(s)")
            self._thread = threading.Thread(target=self._run, name="autoveda-run", daemon=True)
            self._thread.start()
            return {"ok": True, "state": self.state()}

    def panic(self, reason: str = "user") -> dict:
        """Instant halt: stop input now, unblock any pending wait, mark stopped."""
        actions.set_halt()
        self._stop.set()
        self._decision = {"decision": "stop", "reason": reason}
        self._resume.set()
        if self.status != "completed":
            if self.is_active():
                self._add("stop", f"PANIC STOP ({reason}) — all mouse/keyboard control halted")
            self.status = "stopped"
            self.pending = None
            self.ended_at = _now_iso()
        return {"ok": True, "state": self.state()}

    def decide(self, decision: str) -> dict:
        if decision not in _VALID_DECISIONS:
            return {"ok": False, "error": f"invalid decision: {decision!r}", "state": self.state()}
        if self.status != "paused" or not self.pending:
            return {"ok": False, "error": "No pending action to decide.", "state": self.state()}
        self._decision = {"decision": decision}
        self._resume.set()
        return {"ok": True, "state": self.state()}

    def _wait_decision(self) -> str:
        self._resume.wait()
        self._resume.clear()
        decision = (self._decision or {}).get("decision", "stop")
        self._decision = None
        return decision

    def _should_stop(self) -> bool:
        return self._stop.is_set()

    # --- run loop ----------------------------------------------------------
    def _run(self) -> None:
        try:
            region, window_id, err = resolve_region()
            if err:
                self._add("error", err)
                self.status = "error"
                self.ended_at = _now_iso()
                return
            self._add("region", "Scan region resolved", {"region": region, "window_id": window_id})

            settings = self.get_settings()
            threshold = float(settings.get("confidence_threshold", 0.7))
            preview = bool(settings.get("preview_mode", False))

            for i, step in enumerate(self.steps):
                if self._should_stop():
                    break
                self.index = i
                find = step.get("find")
                action = step.get("action", "click")
                value = step.get("value")
                self._add(
                    "step_start",
                    f"Step {i + 1}/{self.total}: {action} {find!r}",
                    {"index": i, "step": step},
                )

                if not find:
                    self._add("step_result", "skipped — no find text", {"index": i, "ok": False})
                    continue

                try:
                    image, origin = grab_region(region)
                except Exception as exc:
                    self._add("error", f"capture failed: {exc}", {"index": i})
                    self.status = "error"
                    self.ended_at = _now_iso()
                    return

                match, locate_err = locate(find, image, origin, region=region, window_id=window_id)
                if not match:
                    self._add("perception", f"not found: {locate_err}", {"index": i, "found": False})
                    self._add("step_result", f"failed — {locate_err}", {"index": i, "ok": False})
                    self.status = "error"
                    self.ended_at = _now_iso()
                    return

                conf = float(match.get("confidence", 0.0))
                self._add(
                    "perception",
                    f"{match['method']} matched {find!r} ({int(conf * 100)}%) at "
                    f"({match['center'][0]}, {match['center'][1]})",
                    {"index": i, "found": True, "method": match["method"], "confidence": conf,
                     "center": match["center"]},
                )

                low_conf = conf < threshold
                if preview or low_conf:
                    if low_conf and preview:
                        reason = "preview + low-confidence"
                    elif low_conf:
                        reason = "low-confidence"
                    else:
                        reason = "preview"
                    self.pending = {
                        "index": i,
                        "step": step,
                        "action": action,
                        "reason": reason,
                        "threshold": threshold,
                        "match": {
                            "method": match["method"],
                            "confidence": conf,
                            "center": match["center"],
                            "text": match.get("text"),
                        },
                    }
                    self.status = "paused"
                    self._add("prompt", f"Awaiting approval ({reason}) for step {i + 1}", self.pending)
                    decision = self._wait_decision()
                    self.pending = None
                    if self._should_stop() or decision == "stop":
                        self._add("decision", "stopped by user")
                        self.status = "stopped"
                        self.ended_at = _now_iso()
                        return
                    if decision == "skip":
                        self.status = "running"
                        self._add("decision", f"skipped step {i + 1}")
                        continue
                    self.status = "running"
                    self._add("decision", f"approved step {i + 1}")

                if self._should_stop():
                    break

                try:
                    summary = actions.do_action(action, match["center"], value=value,
                                                should_stop=self._should_stop)
                    self._add("action", summary, {"index": i, "action": action})
                    self._add("step_result", f"ok — {match['method']}: {summary}", {"index": i, "ok": True})
                except actions.PanicAbort:
                    self._add("stop", "Action halted (panic stop)")
                    self.status = "stopped"
                    self.ended_at = _now_iso()
                    return
                except Exception as exc:
                    if actions.is_failsafe(exc):
                        actions.set_halt()
                        self._add("failsafe", "Corner failsafe triggered — all control halted")
                        self.status = "stopped"
                        self.ended_at = _now_iso()
                        return
                    self._add("error", f"action error: {exc}", {"index": i})
                    self.status = "error"
                    self.ended_at = _now_iso()
                    return

            if self.status not in ("stopped", "error"):
                if self._should_stop():
                    self.status = "stopped"
                else:
                    self.status = "completed"
                    self._add("complete", f"Run {self.run_id} completed — {self.total} step(s)")
            self.ended_at = _now_iso()
        except Exception as exc:  # never leave the engine wedged
            log.exception("run loop crashed")
            self._add("error", f"run crashed: {exc}")
            self.status = "error"
            self.ended_at = _now_iso()

    def state(self) -> dict:
        return {
            "status": self.status,
            "run_id": self.run_id,
            "index": self.index,
            "total": self.total,
            "pending": self.pending,
            "history": self.history[-200:],
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "settings": self.get_settings(),
        }


controller = RunController()
