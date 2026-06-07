import { useEffect, useState, useCallback, useRef } from 'react';
import ScanTarget from './ScanTarget.jsx';
import StepEditor from './StepEditor.jsx';

// M0 UI: confirm the frontend <-> backend handshake is alive.
// Flow: ask Electron for the negotiated backend URL (port handshake), then poll
// GET /health on an interval and surface the result.

const HEALTH_POLL_MS = 3000;
const FALLBACK_BASE_URL = 'http://127.0.0.1:8756'; // used when opened in a plain browser

const PHASE = {
  STARTING: 'starting', // waiting for Electron to report the backend port
  CONNECTING: 'connecting', // have a URL, waiting for first successful /health
  ONLINE: 'online',
  ERROR: 'error',
};

function StatusDot({ phase }) {
  const color =
    phase === PHASE.ONLINE
      ? 'bg-emerald-400'
      : phase === PHASE.ERROR
        ? 'bg-rose-400'
        : 'bg-amber-400';
  const ring =
    phase === PHASE.ONLINE
      ? 'bg-emerald-400/30'
      : phase === PHASE.ERROR
        ? 'bg-rose-400/30'
        : 'bg-amber-400/30';
  return (
    <span className="relative inline-flex h-3 w-3">
      {phase !== PHASE.ERROR && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${ring}`} />
      )}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${color}`} />
    </span>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-slate-500">{label}</span>
      <span className="font-mono text-sm text-slate-200">{value ?? '—'}</span>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState(PHASE.STARTING);
  const [baseUrl, setBaseUrl] = useState(null);
  const [handshake, setHandshake] = useState(null); // { port, pid, version, baseUrl }
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const inElectron = typeof window !== 'undefined' && !!window.autoveda;
  const pollRef = useRef(null);

  // Step 1: resolve the backend base URL via the Electron handshake.
  useEffect(() => {
    let cancelled = false;

    if (!inElectron) {
      // Opened directly in a browser (e.g. visiting the Vite URL) — try the
      // preferred port so the page is still useful for debugging.
      setBaseUrl(FALLBACK_BASE_URL);
      setPhase(PHASE.CONNECTING);
      return;
    }

    const adopt = (info) => {
      if (cancelled || !info) return;
      setHandshake(info);
      setBaseUrl(info.baseUrl || `http://${info.host || '127.0.0.1'}:${info.port}`);
      setPhase(PHASE.CONNECTING);
    };

    window.autoveda.onBackendReady(adopt);
    window.autoveda.onBackendError((err) => {
      if (cancelled) return;
      setError(typeof err === 'string' ? err : 'Backend failed to start.');
      setPhase(PHASE.ERROR);
    });

    // Also poll, in case the ready event fired before this listener attached.
    const probe = setInterval(async () => {
      const info = await window.autoveda.getBackendInfo();
      if (info?.ok) {
        adopt(info);
        clearInterval(probe);
      } else if (info && info.ok === false && info.error) {
        setError(info.error);
        setPhase(PHASE.ERROR);
        clearInterval(probe);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(probe);
    };
  }, [inElectron]);

  // Step 2: once we have a URL, poll /health.
  const checkHealth = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const res = await fetch(`${baseUrl}/health`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealth(data);
      setError(null);
      setPhase(PHASE.ONLINE);
      setLastChecked(new Date());
    } catch (e) {
      setHealth(null);
      setError(e.message);
      // Don't flip to hard ERROR on a transient miss if the handshake succeeded;
      // show "connecting" so a brief blip recovers on the next tick.
      setPhase((p) => (p === PHASE.ONLINE ? PHASE.CONNECTING : p));
      setLastChecked(new Date());
    }
  }, [baseUrl]);

  useEffect(() => {
    if (!baseUrl) return;
    checkHealth();
    pollRef.current = setInterval(checkHealth, HEALTH_POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [baseUrl, checkHealth]);

  const statusLabel = {
    [PHASE.STARTING]: 'Starting backend…',
    [PHASE.CONNECTING]: 'Connecting…',
    [PHASE.ONLINE]: 'Backend online',
    [PHASE.ERROR]: 'Backend unavailable',
  }[phase];

  return (
    <div className="min-h-full bg-gradient-to-br from-[#0b1020] via-[#0e1430] to-[#0b1020] text-slate-100">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6 py-10">
        {/* Header */}
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-indigo-700 shadow-lg shadow-indigo-900/40">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Autoveda</h1>
            <p className="text-sm text-slate-400">Milestone&nbsp;0 — runnable skeleton</p>
          </div>
        </header>

        {/* Status card */}
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusDot phase={phase} />
              <span className="text-lg font-medium">{statusLabel}</span>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                phase === PHASE.ONLINE
                  ? 'bg-emerald-400/10 text-emerald-300'
                  : phase === PHASE.ERROR
                    ? 'bg-rose-400/10 text-rose-300'
                    : 'bg-amber-400/10 text-amber-300'
              }`}
            >
              {inElectron ? 'desktop app' : 'browser preview'}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Detail label="Service" value={health?.service} />
            <Detail label="Version" value={health?.version || handshake?.version} />
            <Detail
              label="Port"
              value={handshake?.port ?? (baseUrl ? baseUrl.split(':').pop() : null)}
            />
            <Detail label="Backend PID" value={health?.pid ?? handshake?.pid} />
            <Detail
              label="Uptime"
              value={health ? `${health.uptime_seconds}s` : null}
            />
            <Detail
              label="Last check"
              value={lastChecked ? lastChecked.toLocaleTimeString() : null}
            />
          </div>

          {error && phase !== PHASE.ONLINE && (
            <div className="mt-5 rounded-lg border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <div className="mt-6 flex items-center gap-3 border-t border-white/5 pt-5">
            <code className="rounded bg-black/30 px-2 py-1 text-xs text-slate-300">
              {baseUrl ? `${baseUrl}/health` : 'awaiting port handshake…'}
            </code>
          </div>
        </section>

        {/* M0 checklist */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            M0 handshake
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-300">
            <Check done={inElectron}>Electron shell running</Check>
            <Check done={!!handshake || !inElectron}>
              Backend port negotiated &amp; reported
            </Check>
            <Check done={phase === PHASE.ONLINE}>/health reachable from the UI</Check>
          </ul>
        </section>

        {/* M1 — scan target selection (shown once the backend is reachable) */}
        {phase === PHASE.ONLINE && baseUrl && (
          <ScanTarget baseUrl={baseUrl} inElectron={inElectron} />
        )}

        {/* M2 — step editor + see-and-act run loop (M3 safety controls inside) */}
        {phase === PHASE.ONLINE && baseUrl && (
          <StepEditor baseUrl={baseUrl} inElectron={inElectron} />
        )}

        <footer className="mt-auto pt-8 text-center text-xs text-slate-600">
          Local-first · backend on 127.0.0.1 · no automation features yet
        </footer>
      </div>
    </div>
  );
}

function Check({ done, children }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
          done ? 'bg-emerald-400/20 text-emerald-300' : 'bg-slate-600/30 text-slate-500'
        }`}
      >
        {done ? '✓' : '•'}
      </span>
      <span className={done ? 'text-slate-200' : 'text-slate-500'}>{children}</span>
    </li>
  );
}
