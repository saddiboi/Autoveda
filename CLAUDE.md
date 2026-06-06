# CLAUDE.md — Autoveda

Project context for Claude Code. Read this before making changes. Keep it updated as the architecture evolves.

## What Autoveda is

Autoveda is a cross-platform desktop app that lets **non-technical users** automate repetitive tasks in **any** application by showing or describing what to do. It fills the gap when software lacks a needed feature or integration. It operates **visually, like a human** — it does not require the target app to expose an API. Execution runs **offline**; the cloud is used only for first-run planning and for recovering from unexpected situations.

Core idea: the user teaches a task **once**, Autoveda saves a reusable **playbook**, and every run after that is fast, local, and free to execute.

## Guiding principles (do not violate)

1. **Most steps resolve locally with NO cloud call.** Cloud AI is for first-run reasoning and self-healing only. If you find yourself calling the cloud during routine execution, that's a design error.
2. **API keys NEVER live in the desktop app.** They live only in a hosted backend proxy. During development the proxy is a local stub; architect so the real proxy drops in without rewrites.
3. **Safety is not optional and not deferred.** The panic stop, corner failsafe, and confidence pause must work before any "smarter" feature is trusted to control the mouse.
4. **Privacy by default.** Screenshots are processed into metadata, then deleted. Only metadata playbooks persist. Playbooks must be shareable without containing screen images.
5. **The app must run fully offline** (except cloud planning/recovery) and install like a normal desktop app with a desktop icon and system-tray presence.

## Tech stack

- **Frontend / shell:** Electron + React + Tailwind CSS. Packages to `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux).
- **Local backend:** Python + FastAPI, launched automatically when the Electron app starts. Runs on `localhost`.
- **Frontend ↔ backend:** local HTTP over a fixed/negotiated port (see Handshake below).
- **Perception (layered):** OS accessibility tree → Tesseract OCR (`pytesseract`) → local vision model (default **Moondream 2**, swappable to **Qwen2.5-VL 7B** on capable GPUs).
- **Screenshots:** `mss`.
- **Input control:** `pyautogui` (mouse + keyboard), with its corner failsafe enabled.
- **Cloud reasoning:** pluggable client supporting **Anthropic** and **OpenAI**. Calls route through the proxy (stubbed locally for now).

## Architecture

### Layered perception (per step)
Resolve each target by trying methods in order, stopping at the first success:
1. **Accessibility tree** — fast, precise, no model needed. Works for most browsers/desktop apps.
2. **Tesseract OCR** — for locating text the accessibility tree didn't expose.
3. **Local vision model** — for non-text elements / layout when the above fail.
4. **Cloud escalation** — only if all local methods fail (this is the self-healing path, not routine).

Report which method resolved each step so it's visible in the UI.

### Planner + executor
- **First run:** cloud AI reasons through the task step by step and writes a structured **playbook** (JSON) saved locally.
- **Run 2 onward:** the local executor runs the playbook fast and fully offline.

### Instruction input
The user defines a task by any of: (a) typing a natural-language goal, (b) recording their screen doing it once, (c) entering explicit steps. Cloud AI converts any of these into a playbook.

### Self-healing
If the executor hits an unexpected screen/popup or can't find an expected element within a timeout: slow down → escalate that step to cloud AI with context (goal + current step + current screen) → perform recovery → **update and version the playbook** so future runs handle it locally.

### Gap-filling
If instructions are incomplete, cloud AI either infers the missing steps or surfaces a **minimal** set of clarifying questions in the UI before saving the playbook.

### Privacy storage
Screenshots → extract metadata (element text, type, region, nearby visual anchors, action taken) → **delete the screenshot** (optional ~60s retention window as a safety net during extraction). Only the metadata playbook persists. Playbooks export/import as shareable files with no screen images.

## Scan modes

- **Window:** user picks an open app window; only that window is captured. If it minimizes, automation pauses; resumes when restored.
- **Rectangle:** user draws a region overlay; only those pixels are scanned (fastest).
- **Full screen:** captures everything (slowest; for multi-app tasks).

Smaller region = faster screenshots, faster perception, cheaper cloud calls.

## Safety layer (build early, keep working)

- **Panic hotkey** `Ctrl+Shift+Space` — instantly halts all mouse/keyboard control, works even when the app isn't focused, responds in <100ms.
- **Corner failsafe** — `pyautogui` stop when mouse hits top-left.
- **Confidence threshold** — matches below a configurable confidence pause and ask instead of acting.
- **Action-preview mode** (optional) — show the next action, require approval.
- **STOP control** — large, red, always visible while automation runs.
- **Action history log** — full timestamped log per run, viewable in the UI.

## Activity widget

Small, always-on-top, frameless, draggable widget in a screen corner. Shows: running automation name, last 2–3 steps with status icons, current step, and a Stop button. Toggle hide/show via tray menu and `Ctrl+Shift+W` (automation + panic hotkey still work when hidden). States: `running`, `needs-input`, `completed`, `error`. Shows **cloud calls used** per run so the user can see when it ran fully locally.

## Frontend ↔ backend handshake

- On app start, Electron spawns the Python FastAPI service on `localhost`.
- Backend exposes `GET /health` returning status + version.
- Frontend polls `/health` on launch and shows backend status in the UI; surface a clear error if the backend fails to start.
- Document the chosen port here once decided: `PORT = <fill in>`.

## Suggested folder structure

```
autoveda/
  electron/            # Electron main process, tray, window mgmt, packaging
  frontend/            # React + Tailwind UI
    src/
      components/
      views/           # dashboard, step editor, playbook viewer, settings
      widget/          # always-on-top activity widget
  backend/             # Python FastAPI service
    perception/        # accessibility tree, OCR, vision model adapters
    execution/         # pyautogui actions, run loop, verification
    playbooks/         # schema, storage, export/import, versioning
    cloud/             # pluggable Anthropic/OpenAI client + proxy stub
    safety/            # panic hotkey, failsafe, confidence, logging
  shared/              # shared types / contracts between FE and BE
  CLAUDE.md
```

(Adjust as needed, but keep perception / execution / safety / cloud as clear boundaries.)

## Build order (milestones)

Build one at a time and **stop after each** for testing. Do not move past M3 until M2 (find-and-act) and M3 (instant stop) are solid on a real target app.

- **M0** — CLAUDE.md + plan + runnable skeleton (Electron + FastAPI + health handshake, installable, tray icon)
- **M1** — Scan modes (window / rectangle / full screen)
- **M2** — Perception + execution core (capture → accessibility/OCR → act → verify) + step editor
- **M3** — Safety layer (panic hotkey, corner failsafe, confidence pause, STOP, action log)
- **M4** — Local vision model (Moondream; hardware detection; Qwen2.5-VL upgrade path)
- **M5** — Activity widget (all states + toggles)
- **M6** — Cloud planner: NL / screen-recording / explicit steps → playbook
- **M7** — Self-healing + playbook versioning on unexpected screens
- **M8** — Gap-filling with clarifying-question UI
- **M9** — Privacy storage (metadata extraction + screenshot deletion + playbook export/import)

## Commands

Fill these in as the project takes shape:

```
# install
# frontend: npm install
# backend:  pip install -r backend/requirements.txt   (Tesseract installed at OS level)

# dev
# (command to run Electron + backend together)

# build/package
# (electron-builder targets for win/mac/linux)
```

## Conventions

- Keep perception methods behind a common interface so OCR / vision / accessibility are swappable.
- Keep the cloud client behind one interface; switching Anthropic↔OpenAI or stub↔real-proxy must not touch feature code.
- Every action that controls input must be interruptible by the panic stop at all times.
- Log decisions (which perception method, confidence, action) — observability is a feature here.