'use strict';

// Spawns the Python FastAPI backend and performs the port handshake described in
// CLAUDE.md: the backend negotiates a port (preferring 8756) and writes the chosen
// port to a JSON file in userData. Electron watches for that file, then hands the
// port to the renderer.

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PREFERRED_PORT = 8756;
const PORT_FILE_TIMEOUT_MS = 30000;

let backendProcess = null;

function portFilePath() {
  return path.join(app.getPath('userData'), 'autoveda-port.json');
}

// Resolve how to launch the backend: a bundled executable when packaged, or the
// local Python interpreter + source during development.
function backendCommand() {
  if (app.isPackaged) {
    const exeName =
      process.platform === 'win32' ? 'autoveda-backend.exe' : 'autoveda-backend';
    const exePath = path.join(process.resourcesPath, 'backend', exeName);
    return { command: exePath, args: [], cwd: path.dirname(exePath) };
  }
  // Dev: run the source with the user's Python. Override with AUTOVEDA_PYTHON if
  // your interpreter isn't on PATH as `python`.
  const python =
    process.env.AUTOVEDA_PYTHON ||
    (process.platform === 'win32' ? 'python' : 'python3');
  const backendDir = path.join(__dirname, '..', 'backend');
  return { command: python, args: ['main.py'], cwd: backendDir };
}

function startBackend() {
  const pf = portFilePath();
  // Clear any stale handshake file from a previous run before launching.
  try {
    fs.unlinkSync(pf);
  } catch (_) {
    /* not present — fine */
  }

  const { command, args, cwd } = backendCommand();
  const env = {
    ...process.env,
    AUTOVEDA_PORT_FILE: pf,
    AUTOVEDA_PREFERRED_PORT: String(PREFERRED_PORT),
    AUTOVEDA_DATA_DIR: app.getPath('userData'),
    PYTHONUNBUFFERED: '1',
  };

  backendProcess = spawn(command, args, { cwd, env });

  backendProcess.stdout.on('data', (d) =>
    console.log('[backend]', d.toString().trim())
  );
  backendProcess.stderr.on('data', (d) =>
    console.error('[backend]', d.toString().trim())
  );
  backendProcess.on('error', (err) =>
    console.error('[backend] failed to spawn:', err.message)
  );
  backendProcess.on('exit', (code, signal) =>
    console.log(`[backend] exited (code=${code} signal=${signal})`)
  );

  return waitForPortFile(pf);
}

// Poll for the handshake file until the backend reports its port (or we time out).
function waitForPortFile(pf, timeoutMs = PORT_FILE_TIMEOUT_MS) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      // If the process died before writing the file, fail fast with a clear message.
      if (backendProcess && backendProcess.exitCode !== null) {
        return reject(
          new Error(
            `Backend process exited early (code ${backendProcess.exitCode}). ` +
              'Is Python installed and on PATH? Set AUTOVEDA_PYTHON to override.'
          )
        );
      }
      try {
        const info = JSON.parse(fs.readFileSync(pf, 'utf-8'));
        if (info && info.port) {
          const baseUrl = `http://${info.host || '127.0.0.1'}:${info.port}`;
          return resolve({ ...info, baseUrl });
        }
      } catch (_) {
        /* file not ready yet */
      }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error('Backend did not report a port within the timeout.'));
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

function stopBackend() {
  if (!backendProcess) return;
  const pid = backendProcess.pid;
  try {
    if (process.platform === 'win32' && pid) {
      // Kill the whole tree so uvicorn's reloader/children don't linger.
      spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    } else {
      backendProcess.kill('SIGTERM');
    }
  } catch (err) {
    console.error('[backend] stop error:', err.message);
  }
  backendProcess = null;
}

module.exports = { startBackend, stopBackend, portFilePath, PREFERRED_PORT };
