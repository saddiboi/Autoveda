"""Autoveda local backend (FastAPI).

M0 scope: a runnable service that the Electron shell auto-launches on localhost.
It negotiates a port (preferring 8756, falling back to any free port), writes the
chosen port to a handshake file that Electron reads, and exposes a health check.

No automation features yet — this only proves the frontend <-> backend handshake.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import time
from contextlib import closing
from typing import Literal, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from execution import actions
from execution.runner import get_run_log, run_step
from perception.windows import WindowBackendUnavailable, list_windows, window_status
from safety.controller import controller
from storage import (
    load_scan_target,
    load_steps,
    save_scan_target,
    save_steps,
)

VERSION = "0.1.0"
HOST = "127.0.0.1"
PREFERRED_PORT = int(os.environ.get("AUTOVEDA_PREFERRED_PORT", "8756"))
PORT_FILE = os.environ.get("AUTOVEDA_PORT_FILE")  # set by Electron; optional when run standalone

_START_TIME = time.time()

app = FastAPI(title="Autoveda Backend", version=VERSION)

# The renderer fetches /health directly from http://127.0.0.1:<port>, so allow the
# local Electron origin. Kept permissive for localhost-only dev; tighten later.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    """Liveness + version. Polled by the frontend to confirm the backend is alive."""
    return {
        "status": "ok",
        "service": "autoveda-backend",
        "version": VERSION,
        "pid": os.getpid(),
        "uptime_seconds": round(time.time() - _START_TIME, 2),
    }


# --- M1: scan modes (window / rectangle / full screen) ---------------------------


class Region(BaseModel):
    x: int
    y: int
    width: int
    height: int
    scaleFactor: Optional[float] = None
    displayId: Optional[int] = None


class WindowRef(BaseModel):
    id: int
    title: Optional[str] = None
    bounds: Optional[dict] = None


class ScanTargetIn(BaseModel):
    mode: Literal["window", "rectangle", "fullscreen"]
    window: Optional[WindowRef] = None
    region: Optional[Region] = None


def compute_status(target: Optional[dict]) -> dict:
    """Live status of the saved target. Window mode pauses while minimized/missing."""
    if not target:
        return {"state": "none", "paused": False}
    mode = target.get("mode")
    if mode in ("rectangle", "fullscreen"):
        return {"state": "ready", "paused": False}
    if mode == "window":
        win = target.get("window") or {}
        try:
            st = window_status(win.get("id"))
        except WindowBackendUnavailable as exc:
            return {"state": "unsupported", "paused": False, "detail": str(exc)}
        if not st["present"]:
            return {"state": "window-missing", "paused": True, "minimized": False}
        if st["minimized"]:
            return {"state": "paused", "paused": True, "minimized": True, "bounds": None}
        return {"state": "ready", "paused": False, "minimized": False, "bounds": st["bounds"]}
    return {"state": "none", "paused": False}


@app.get("/scan/windows")
def scan_windows() -> dict:
    """List open, titled windows for the Window scan mode."""
    try:
        return {"windows": list_windows(), "platform": sys.platform}
    except WindowBackendUnavailable as exc:
        return {"windows": [], "platform": sys.platform, "error": str(exc)}


@app.get("/scan/target")
def get_target() -> dict:
    target = load_scan_target()
    return {"target": target, "status": compute_status(target)}


@app.put("/scan/target")
def put_target(body: ScanTargetIn) -> dict:
    if body.mode == "window" and (body.window is None or body.window.id is None):
        raise HTTPException(status_code=422, detail="window mode requires window.id")
    if body.mode == "rectangle" and body.region is None:
        raise HTTPException(status_code=422, detail="rectangle mode requires region")
    saved = save_scan_target(body.model_dump(exclude_none=False))
    return {"target": saved, "status": compute_status(saved)}


@app.get("/scan/status")
def scan_status() -> dict:
    return {"status": compute_status(load_scan_target())}


# --- M2: steps + see-and-act run loop --------------------------------------------


class Step(BaseModel):
    find: Optional[str] = None
    type: str = "text"  # element-type hint (text/button/field); informational for now
    action: Literal["click", "double_click", "type", "move"] = "click"
    value: Optional[str] = None


class StepsIn(BaseModel):
    steps: list[Step]


class RunStepIn(BaseModel):
    step: Step


class RunStartIn(BaseModel):
    steps: list[Step]


class DecisionIn(BaseModel):
    decision: Literal["act", "skip", "stop"]


class PanicIn(BaseModel):
    reason: str = "user"


class SafetySettingsIn(BaseModel):
    confidence_threshold: Optional[float] = None
    preview_mode: Optional[bool] = None


@app.get("/steps")
def get_steps() -> dict:
    return {"steps": load_steps()}


@app.put("/steps")
def put_steps(body: StepsIn) -> dict:
    return {"steps": save_steps([s.model_dump() for s in body.steps])}


@app.post("/run/step")
def post_run_step(body: RunStepIn) -> dict:
    # Single-step quick test. Clear any prior halt; the action still obeys the
    # corner failsafe and a concurrent panic (which re-sets the halt).
    actions.clear_halt()
    return {"result": run_step(body.step.model_dump())}


@app.post("/run/start")
def post_run_start(body: RunStartIn) -> dict:
    """Start a safety-gated, interruptible run on the controller's worker thread."""
    return controller.start([s.model_dump() for s in body.steps])


@app.get("/run/state")
def get_run_state() -> dict:
    return controller.state()


@app.post("/run/decide")
def post_run_decide(body: DecisionIn) -> dict:
    return controller.decide(body.decision)


@app.get("/run/log")
def get_log() -> dict:
    return {"log": get_run_log()}


# --- M3: safety controls ---------------------------------------------------------


@app.post("/safety/panic")
def post_panic(body: PanicIn | None = None) -> dict:
    """Instant halt of all mouse/keyboard control. Hit by the global hotkey,
    the STOP button, and the corner failsafe path."""
    reason = body.reason if body else "user"
    return controller.panic(reason)


@app.get("/safety/settings")
def get_safety_settings() -> dict:
    return {"settings": controller.get_settings()}


@app.put("/safety/settings")
def put_safety_settings(body: SafetySettingsIn) -> dict:
    return {"settings": controller.update_settings(body.model_dump(exclude_none=True))}


def _can_bind(port: int) -> bool:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((HOST, port))
            return True
        except OSError:
            return False


def negotiate_port(preferred: int) -> int:
    """Prefer `preferred`; if taken, let the OS hand us any free port."""
    if _can_bind(preferred):
        return preferred
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def write_port_file(port: int) -> None:
    """Atomically write the handshake file so Electron never reads a partial value."""
    if not PORT_FILE:
        return
    payload = {
        "host": HOST,
        "port": port,
        "pid": os.getpid(),
        "version": VERSION,
    }
    os.makedirs(os.path.dirname(PORT_FILE), exist_ok=True)
    tmp = f"{PORT_FILE}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.replace(tmp, PORT_FILE)  # atomic on the same filesystem


def main() -> None:
    port = negotiate_port(PREFERRED_PORT)
    write_port_file(port)
    print(f"[autoveda-backend] v{VERSION} listening on http://{HOST}:{port}", flush=True)
    uvicorn.run(app, host=HOST, port=port, log_level="info")


if __name__ == "__main__":
    main()
