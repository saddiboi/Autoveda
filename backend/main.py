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
import time
from contextlib import closing

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
