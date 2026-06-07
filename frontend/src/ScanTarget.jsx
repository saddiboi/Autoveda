import { useCallback, useEffect, useState } from 'react';

// M1 UI: choose how Autoveda scans the screen — a specific window, a drawn
// rectangle, or the full screen. Persists the choice via the backend and shows
// live status (window mode pauses while the target is minimized).

const STATUS_POLL_MS = 2000;

const MODES = [
  { id: 'window', label: 'Window', hint: 'Capture one app window' },
  { id: 'rectangle', label: 'Rectangle', hint: 'Draw a region (fastest)' },
  { id: 'fullscreen', label: 'Full screen', hint: 'Capture everything' },
];

function StatusBadge({ status }) {
  if (!status) return null;
  const map = {
    ready: ['Ready', 'bg-emerald-400/10 text-emerald-300'],
    paused: ['Paused — window minimized', 'bg-amber-400/10 text-amber-300'],
    'window-missing': ['Paused — window not found', 'bg-amber-400/10 text-amber-300'],
    unsupported: ['Unsupported on this OS', 'bg-slate-400/10 text-slate-300'],
    none: ['No target selected', 'bg-slate-400/10 text-slate-400'],
  };
  const [label, cls] = map[status.state] || [status.state, 'bg-slate-400/10 text-slate-300'];
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ModeTile({ mode, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-start rounded-xl border px-4 py-3 text-left transition ${
        active
          ? 'border-indigo-400/60 bg-indigo-400/10'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      <span className="text-sm font-medium text-slate-100">{mode.label}</span>
      <span className="mt-0.5 text-xs text-slate-400">{mode.hint}</span>
    </button>
  );
}

export default function ScanTarget({ baseUrl, inElectron }) {
  const [mode, setMode] = useState('window');
  const [windows, setWindows] = useState([]);
  const [windowsError, setWindowsError] = useState(null);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [target, setTarget] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const api = useCallback(
    async (path, options) => {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        ...options,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [baseUrl]
  );

  // Load the persisted target once we have a backend URL.
  useEffect(() => {
    if (!baseUrl) return;
    let cancelled = false;
    api('/scan/target')
      .then((data) => {
        if (cancelled) return;
        setTarget(data.target);
        setStatus(data.status);
        if (data.target?.mode) setMode(data.target.mode);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [baseUrl, api]);

  // Poll live status so a minimized/restored window flips paused <-> ready.
  useEffect(() => {
    if (!baseUrl) return;
    const tick = () =>
      api('/scan/status')
        .then((data) => setStatus(data.status))
        .catch(() => {});
    const id = setInterval(tick, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [baseUrl, api]);

  const refreshWindows = useCallback(async () => {
    setLoadingWindows(true);
    setWindowsError(null);
    try {
      const data = await api('/scan/windows');
      setWindows(data.windows || []);
      if (data.error) setWindowsError(data.error);
    } catch (e) {
      setWindowsError(e.message);
    } finally {
      setLoadingWindows(false);
    }
  }, [api]);

  useEffect(() => {
    if (mode === 'window' && baseUrl) refreshWindows();
  }, [mode, baseUrl, refreshWindows]);

  const saveTarget = useCallback(
    async (body) => {
      setBusy(true);
      setError(null);
      try {
        const data = await api('/scan/target', { method: 'PUT', body: JSON.stringify(body) });
        setTarget(data.target);
        setStatus(data.status);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [api]
  );

  const pickWindow = (w) =>
    saveTarget({ mode: 'window', window: { id: w.id, title: w.title, bounds: w.bounds } });

  const drawRectangle = async () => {
    if (!inElectron) {
      setError('Region drawing is only available in the desktop app.');
      return;
    }
    const region = await window.autoveda.selectRegion();
    if (!region) return; // cancelled
    await saveTarget({ mode: 'rectangle', region });
  };

  const selectedWindowId = target?.mode === 'window' ? target?.window?.id : null;

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Scan target
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="mt-4 flex gap-3">
        {MODES.map((m) => (
          <ModeTile key={m.id} mode={m} active={mode === m.id} onClick={() => setMode(m.id)} />
        ))}
      </div>

      {/* Mode-specific controls */}
      <div className="mt-5">
        {mode === 'window' && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-500">
                Open windows
              </span>
              <button
                onClick={refreshWindows}
                disabled={loadingWindows}
                className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
              >
                {loadingWindows ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {windowsError && (
              <p className="mb-2 text-xs text-amber-300">{windowsError}</p>
            )}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-1">
              {windows.length === 0 && !loadingWindows && (
                <p className="px-3 py-4 text-center text-sm text-slate-500">
                  No windows found.
                </p>
              )}
              {windows.map((w) => (
                <button
                  key={w.id}
                  onClick={() => pickWindow(w)}
                  disabled={busy}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                    selectedWindowId === w.id
                      ? 'bg-indigo-400/15 text-indigo-100'
                      : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <span className="truncate pr-3">{w.title}</span>
                  <span className="shrink-0 font-mono text-xs text-slate-500">
                    {w.minimized ? 'minimized' : `${w.bounds.width}×${w.bounds.height}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'rectangle' && (
          <div className="flex items-center gap-4">
            <button
              onClick={drawRectangle}
              disabled={busy || !inElectron}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-900/30 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {target?.mode === 'rectangle' ? 'Redraw region' : 'Draw region'}
            </button>
            {!inElectron && (
              <span className="text-xs text-slate-500">
                Available in the desktop app only.
              </span>
            )}
          </div>
        )}

        {mode === 'fullscreen' && (
          <button
            onClick={() => saveTarget({ mode: 'fullscreen' })}
            disabled={busy}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-900/30 transition hover:bg-indigo-400 disabled:opacity-50"
          >
            Use full screen
          </button>
        )}
      </div>

      {/* Current persisted target */}
      <div className="mt-5 border-t border-white/5 pt-4">
        <span className="text-xs uppercase tracking-wider text-slate-500">Saved target</span>
        <div className="mt-2">
          {target ? (
            <TargetSummary target={target} />
          ) : (
            <p className="text-sm text-slate-500">Nothing saved yet.</p>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
    </section>
  );
}

function TargetSummary({ target }) {
  if (target.mode === 'window') {
    return (
      <p className="text-sm text-slate-300">
        <span className="rounded bg-black/30 px-2 py-0.5 text-xs">window</span>{' '}
        <span className="text-slate-200">{target.window?.title || 'Untitled'}</span>
      </p>
    );
  }
  if (target.mode === 'rectangle') {
    const r = target.region || {};
    return (
      <p className="text-sm text-slate-300">
        <span className="rounded bg-black/30 px-2 py-0.5 text-xs">rectangle</span>{' '}
        <span className="font-mono text-slate-200">
          {r.width}×{r.height} @ ({r.x}, {r.y})
        </span>
        {r.scaleFactor && r.scaleFactor !== 1 && (
          <span className="ml-2 text-xs text-slate-500">·{r.scaleFactor}× scale · physical px</span>
        )}
      </p>
    );
  }
  return (
    <p className="text-sm text-slate-300">
      <span className="rounded bg-black/30 px-2 py-0.5 text-xs">full screen</span>{' '}
      <span className="text-slate-200">Entire desktop</span>
    </p>
  );
}
