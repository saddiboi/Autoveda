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
SAFETY_FILE = os.path.join(DATA_DIR, "safety.json")

DEFAULT_SAFETY = {"confidence_threshold": 0.7, "preview_mode": False}


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


def load_safety_settings() -> dict:
    settings = dict(DEFAULT_SAFETY)
    try:
        with open(SAFETY_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            settings.update({k: data[k] for k in DEFAULT_SAFETY if k in data})
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return settings


def save_safety_settings(patch: dict) -> dict:
    settings = load_safety_settings()
    for key in DEFAULT_SAFETY:
        if key in patch and patch[key] is not None:
            settings[key] = patch[key]
    # clamp threshold into [0, 1]
    try:
        settings["confidence_threshold"] = max(0.0, min(1.0, float(settings["confidence_threshold"])))
    except (TypeError, ValueError):
        settings["confidence_threshold"] = DEFAULT_SAFETY["confidence_threshold"]
    settings["preview_mode"] = bool(settings["preview_mode"])
    _atomic_write(SAFETY_FILE, settings)
    return settings
