"""Tiny local JSON store for user selections (M1: the chosen scan target).

Persists under AUTOVEDA_DATA_DIR (Electron passes userData); falls back to a local
.data dir when the backend is run standalone. Writes are atomic (temp + rename).
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional

DATA_DIR = os.environ.get("AUTOVEDA_DATA_DIR") or os.path.join(
    os.path.dirname(__file__), ".data"
)
SCAN_TARGET_FILE = os.path.join(DATA_DIR, "scan_target.json")
STEPS_FILE = os.path.join(DATA_DIR, "steps.json")


def _atomic_write(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def load_scan_target() -> Optional[dict]:
    try:
        with open(SCAN_TARGET_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def save_scan_target(target: dict) -> dict:
    target = dict(target)
    target["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _atomic_write(SCAN_TARGET_FILE, target)
    return target


def load_steps() -> list:
    try:
        with open(STEPS_FILE, encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_steps(steps: list) -> list:
    _atomic_write(STEPS_FILE, list(steps))
    return list(steps)
