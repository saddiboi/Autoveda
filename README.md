# Autoveda

Visual desktop task automation for non-technical users. See [`CLAUDE.md`](./CLAUDE.md)
for the full product spec and architecture.

> **Status: M3 — safety layer in place.** A working see-and-act core with a panic
> stop, corner failsafe, confidence/preview gating, a STOP control, and a
> timestamped action log. Built on the M0 skeleton, M1 scan modes, and M2
> perception/execution core.

## What works today (M0–M3)

- **M0 — Skeleton + handshake.** Electron + React/Tailwind shell; Python FastAPI
  backend auto-launched on `localhost`; port negotiation (prefers **8756**, falls
  back) written to a handshake file; `/health` polled by the UI; system-tray icon;
  installable.
- **M1 — Scan modes.** Choose what gets captured: a specific **window** (picked
  from a live list), a **rectangle** drawn on a screen overlay, or the **full
  screen**. The choice persists. A selected window that is minimized marks
  automation **paused**, and resumes when restored.
- **M2 — See-and-act core.** Given a region and a step like
  `{ find: "Submit", action: "click" }`, the backend captures the region with
  `mss`, locates the target via the **accessibility tree first, then Tesseract
  OCR**, and acts with `pyautogui` (click / double-click / type / move). A step
  editor lets you create, edit, reorder, and run steps in sequence; each step
  reports which method resolved it.
- **M3 — Safety layer.** Global panic hotkey **`Ctrl+Shift+Space`** halts all
  input in <100ms even when Autoveda isn't focused; `pyautogui` **corner failsafe**
  (mouse to top-left); **confidence threshold** that pauses and asks when a match
  is weak; optional **action-preview** mode (approve every step); a large red
  **STOP** control while running; and a full **timestamped action history** per
  run, viewable in the UI.

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+ on `PATH` as `python` (Windows) / `python3` (macOS/Linux)
  - If your interpreter is named differently, set `AUTOVEDA_PYTHON` to its path.
- **Tesseract OCR** (optional, for the OCR fallback in M2) installed at OS level.
  The accessibility-tree path works without it; OCR only kicks in when accessibility
  finds nothing. Install on Windows with `winget install UB-Mannheim.TesseractOCR`,
  then set `TESSERACT_CMD` to `tesseract.exe` if it isn't on `PATH` (the default
  install path is auto-detected).

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

### Trying the see-and-act loop (M1–M3)

1. **Pick a scan target** under *Scan target*: a window, a drawn rectangle, or full
   screen. (Minimizing a chosen window shows *Paused*; restoring it resumes.)
2. **Add steps** in *Steps & run* — e.g. `find: "File"`, `action: Click`. Use the
   per-row ▶ to test one step, or **Run all** for the sequence.
3. **Safety:** set the *confidence pause* threshold and toggle *action preview*.
   Running drives your real mouse/keyboard — halt instantly with the red **STOP**,
   the global hotkey **`Ctrl+Shift+Space`** (works unfocused), or by slamming the
   pointer into the top-left corner. The **action history** logs every step with
   timestamps and which method (accessibility/OCR) resolved it.

> **Heads-up:** the accessibility path covers most apps without Tesseract; the OCR
> fallback only runs when accessibility finds nothing (see Prerequisites).

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
electron/   Electron main, backend spawner, preload, tray, panic hotkey,
            rectangle-overlay window
frontend/   React + Tailwind UI (Vite): App, ScanTarget, StepEditor
backend/    FastAPI service + PyInstaller spec
  perception/   capture (mss), accessibility tree, OCR, layered locate, windows
  execution/    pyautogui actions (interruptible), run loop
  safety/       run controller: panic, confidence/preview gating, action history
  storage.py    local JSON store (scan target, steps, safety settings)
assets/     generated app/tray icons (committed)
scripts/    icon generator
shared/     frontend ↔ backend contract
```

Key endpoints: `/health`, `/scan/{windows,target,status}`, `/steps`,
`/run/{step,start,state,decide,log}`, `/safety/{panic,settings}`.

See [`shared/handshake.md`](./shared/handshake.md) for the port/health contract.
