# Autoveda

Visual desktop task automation for non-technical users. See [`CLAUDE.md`](./CLAUDE.md)
for the full product spec and architecture.

> **Status: M0 — runnable skeleton.** Electron shell + React/Tailwind UI + Python
> FastAPI backend with an auto-launch port handshake and a health check. No
> automation features yet.

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+ on `PATH` as `python` (Windows) / `python3` (macOS/Linux)
  - If your interpreter is named differently, set `AUTOVEDA_PYTHON` to its path.

## Install

```bash
# 1. Python backend deps (use a venv if you prefer)
pip install -r backend/requirements.txt

# 2. Node deps for the shell + frontend (postinstall installs frontend too)
npm install

# 3. Generate the app/tray icons (placeholder branding)
npm run gen:icons
```

## Run (dev)

```bash
npm run dev
```

This starts the Vite dev server and, once it's up, launches Electron. Electron
spawns the Python backend, negotiates a port (preferring **8756**), and the UI
polls `/health`. You should see **“Backend online”** with the port, version, and
uptime, plus a system-tray icon. Closing the window hides to tray; quit from the
tray menu.

Run just the backend on its own to sanity-check it:

```bash
python backend/main.py
# then open http://127.0.0.1:8756/health
```

## Build installers

Produces a desktop-installable app with desktop + tray icons.

```bash
# bundles the Python backend into a standalone exe, then packages with electron-builder
npm run dist
```

Output lands in `release/`. Targets: `.exe` (NSIS, Windows), `.dmg` (macOS),
`.AppImage` (Linux). `npm run pack` skips the backend bundling step (UI-only shell).

## Layout

```
electron/   Electron main process, backend spawner, preload, tray
frontend/   React + Tailwind UI (Vite)
backend/    FastAPI service + PyInstaller spec
assets/     generated app/tray icons (committed)
scripts/    icon generator
shared/     frontend ↔ backend contract
```

See [`shared/handshake.md`](./shared/handshake.md) for the port/health contract.
