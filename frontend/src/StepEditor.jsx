import { useCallback, useEffect, useRef, useState } from 'react';

// M2 step editor + M3 safety-gated run engine.
// Steps run on the backend controller: capture -> locate -> (confidence/preview
// gate) -> act, all interruptible by the panic stop. The UI shows a STOP control,
// approval prompts, and a live timestamped action history.

const ACTIONS = [
  { id: 'click', label: 'Click' },
  { id: 'double_click', label: 'Double-click' },
  { id: 'type', label: 'Type' },
  { id: 'move', label: 'Move to' },
];
const TYPES = ['text', 'button', 'field'];
const ACTIVE = ['running', 'paused'];

const blankStep = () => ({ find: '', type: 'text', action: 'click', value: '' });

// History entry type -> accent color for the log.
const TYPE_COLOR = {
  run_start: 'border-indigo-400/50 text-indigo-200',
  region: 'border-slate-500/40 text-slate-300',
  step_start: 'border-slate-500/40 text-slate-200',
  perception: 'border-sky-400/40 text-sky-200',
  prompt: 'border-amber-400/50 text-amber-200',
  decision: 'border-slate-400/40 text-slate-200',
  action: 'border-emerald-400/40 text-emerald-200',
  step_result: 'border-emerald-400/40 text-emerald-100',
  complete: 'border-emerald-400/60 text-emerald-200',
  stop: 'border-rose-400/60 text-rose-200',
  failsafe: 'border-rose-400/60 text-rose-200',
  error: 'border-rose-400/50 text-rose-200',
};

function deriveResults(history = []) {
  const byIndex = {};
  for (const e of history) {
    const i = e.data?.index;
    if (typeof i !== 'number') continue;
    if (e.type === 'perception' && e.data.found) {
      byIndex[i] = { ...(byIndex[i] || {}), method: e.data.method, confidence: e.data.confidence, center: e.data.center };
    } else if (e.type === 'step_result') {
      byIndex[i] = { ...(byIndex[i] || {}), ok: e.data.ok, message: e.message };
    }
  }
  return byIndex;
}

function MethodBadge({ method }) {
  const map = { accessibility: 'bg-sky-400/15 text-sky-300', ocr: 'bg-amber-400/15 text-amber-300' };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${map[method] || 'bg-slate-500/15 text-slate-400'}`}>
      {method || 'none'}
    </span>
  );
}

function ResultLine({ result }) {
  if (!result || result.ok === undefined) return null;
  const ok = result.ok;
  return (
    <div className={`mt-1 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${ok ? 'border-emerald-400/20 bg-emerald-400/5' : 'border-rose-400/20 bg-rose-400/5'}`}>
      <span className={ok ? 'text-emerald-300' : 'text-rose-300'}>{ok ? '✓' : '✕'}</span>
      <MethodBadge method={result.method} />
      {result.center && (
        <span className="font-mono text-slate-400">
          @({result.center[0]},{result.center[1]}){result.confidence != null && `·${Math.round(result.confidence * 100)}%`}
        </span>
      )}
      <span className="text-slate-300">{result.message}</span>
    </div>
  );
}

export default function StepEditor({ baseUrl, inElectron }) {
  const [steps, setSteps] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState({ confidence_threshold: 0.7, preview_mode: false });
  const [runState, setRunState] = useState(null);
  const [stopping, setStopping] = useState(false);
  const pollRef = useRef(null);

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

  const status = runState?.status;
  const active = ACTIVE.includes(status);
  const results = deriveResults(runState?.history);

  const fetchState = useCallback(async () => {
    try {
      const s = await api('/run/state');
      setRunState(s);
      return s;
    } catch {
      return null;
    }
  }, [api]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await fetchState();
      if (!s || !ACTIVE.includes(s.status)) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setStopping(false);
      }
    }, 400);
  }, [fetchState]);

  // Initial load.
  useEffect(() => {
    if (!baseUrl) return;
    api('/steps').then((d) => setSteps(d.steps?.length ? d.steps : [blankStep()])).catch((e) => setError(e.message));
    api('/safety/settings').then((d) => setSettings(d.settings)).catch(() => {});
    fetchState().then((s) => s && ACTIVE.includes(s.status) && startPolling());
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [baseUrl, api, fetchState, startPolling]);

  // React to the global panic hotkey: reflect the stop immediately.
  useEffect(() => {
    if (!inElectron || !window.autoveda?.onPanic) return;
    window.autoveda.onPanic(() => {
      setStopping(true);
      fetchState();
    });
  }, [inElectron, fetchState]);

  // --- step editing ---
  const mutate = (next) => {
    setSteps(next);
    setDirty(true);
  };
  const updateStep = (i, patch) => mutate(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addStep = () => mutate([...steps, blankStep()]);
  const removeStep = (i) => mutate(steps.filter((_, idx) => idx !== i));
  const moveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    mutate(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('/steps', { method: 'PUT', body: JSON.stringify({ steps }) });
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const d = await api('/safety/settings', { method: 'PUT', body: JSON.stringify(patch) });
      setSettings(d.settings);
    } catch (e) {
      setError(e.message);
    }
  };

  // --- run control ---
  const runAll = async () => {
    setError(null);
    try {
      if (dirty) await save();
      const res = await api('/run/start', { method: 'POST', body: JSON.stringify({ steps }) });
      if (res.ok === false) {
        setError(res.error);
        return;
      }
      setRunState(res.state);
      startPolling();
    } catch (e) {
      setError(e.message);
    }
  };

  const stop = async () => {
    setStopping(true);
    try {
      if (inElectron && window.autoveda?.panic) await window.autoveda.panic('stop-button');
      else await api('/safety/panic', { method: 'POST', body: JSON.stringify({ reason: 'stop-button' }) });
    } catch (e) {
      setError(e.message);
    }
    fetchState();
  };

  const decide = async (decision) => {
    try {
      await api('/run/decide', { method: 'POST', body: JSON.stringify({ decision }) });
      const s = await fetchState();
      if (s && ACTIVE.includes(s.status)) startPolling();
    } catch (e) {
      setError(e.message);
    }
  };

  const runOne = async (i) => {
    setError(null);
    try {
      await api('/run/step', { method: 'POST', body: JSON.stringify({ step: steps[i] }) });
      fetchState();
    } catch (e) {
      setError(e.message);
    }
  };

  const pending = runState?.pending;

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Steps &amp; run</h2>
        <RunStatusPill status={status} index={runState?.index} total={runState?.total} />
      </div>

      {/* Big red STOP — visible whenever automation runs */}
      {(active || stopping) && (
        <button
          onClick={stop}
          className="mt-4 flex w-full items-center justify-center gap-3 rounded-xl bg-rose-600 px-4 py-3 text-base font-bold uppercase tracking-wide text-white shadow-lg shadow-rose-900/40 transition hover:bg-rose-500 active:scale-[0.99]"
        >
          <span className="grid h-5 w-5 place-items-center rounded-sm bg-white/90 text-rose-600">■</span>
          STOP
          <span className="text-xs font-normal normal-case text-rose-100/80">Ctrl+Shift+Space</span>
        </button>
      )}

      {/* Approval prompt (confidence / preview) */}
      {pending && status === 'paused' && (
        <ApprovalPrompt pending={pending} onDecide={decide} />
      )}

      {/* Safety settings */}
      <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <label className="text-xs uppercase tracking-wider text-slate-500">Confidence pause below</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.confidence_threshold}
            onChange={(e) => saveSettings({ confidence_threshold: parseFloat(e.target.value) })}
            className="accent-indigo-500"
          />
          <span className="w-10 font-mono text-sm text-slate-200">
            {Math.round(settings.confidence_threshold * 100)}%
          </span>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={settings.preview_mode}
            onChange={(e) => saveSettings({ preview_mode: e.target.checked })}
            className="accent-indigo-500"
          />
          Action preview (approve every step)
        </label>
      </div>

      <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
        Running drives your real mouse &amp; keyboard. Panic stop: <b>Ctrl+Shift+Space</b> (works
        even when Autoveda isn’t focused), or slam the pointer into the top-left corner.
      </div>

      {/* Steps list */}
      <div className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <div
            key={i}
            className={`rounded-xl border bg-black/20 p-3 ${
              active && runState?.index === i ? 'border-indigo-400/50' : 'border-white/10'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center font-mono text-xs text-slate-500">{i + 1}</span>
              <input
                value={step.find || ''}
                onChange={(e) => updateStep(i, { find: e.target.value })}
                placeholder="Find (text on screen, e.g. Submit)"
                disabled={active}
                className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-400/50 focus:outline-none disabled:opacity-60"
              />
              <select
                value={step.type}
                onChange={(e) => updateStep(i, { type: e.target.value })}
                disabled={active}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-200 focus:outline-none disabled:opacity-60"
                title="element type hint"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t} className="bg-slate-800">{t}</option>
                ))}
              </select>
              <select
                value={step.action}
                onChange={(e) => updateStep(i, { action: e.target.value })}
                disabled={active}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-200 focus:outline-none disabled:opacity-60"
              >
                {ACTIONS.map((a) => (
                  <option key={a.id} value={a.id} className="bg-slate-800">{a.label}</option>
                ))}
              </select>
              {step.action === 'type' && (
                <input
                  value={step.value || ''}
                  onChange={(e) => updateStep(i, { value: e.target.value })}
                  placeholder="text to type"
                  disabled={active}
                  className="w-40 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-400/50 focus:outline-none disabled:opacity-60"
                />
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                <IconBtn label="Move up" onClick={() => moveStep(i, -1)} disabled={i === 0 || active}>↑</IconBtn>
                <IconBtn label="Move down" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1 || active}>↓</IconBtn>
                <IconBtn label="Run this step" onClick={() => runOne(i)} disabled={active || !step.find}>▶</IconBtn>
                <IconBtn label="Delete" onClick={() => removeStep(i)} disabled={active} danger>✕</IconBtn>
              </div>
            </div>
            <ResultLine result={results[i]} />
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={addStep} disabled={active} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40">
          + Add step
        </button>
        <button onClick={save} disabled={saving || !dirty || active} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40">
          {saving ? 'Saving…' : dirty ? 'Save steps' : 'Saved'}
        </button>
        <button onClick={runAll} disabled={active || steps.length === 0} className="ml-auto rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-400 disabled:opacity-50">
          {active ? 'Running…' : 'Run all'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

      <HistoryLog history={runState?.history} />
    </section>
  );
}

function RunStatusPill({ status, index, total }) {
  if (!status || status === 'idle') return null;
  const map = {
    running: ['bg-indigo-400/10 text-indigo-300', `Running ${(index ?? 0) + 1}/${total}`],
    paused: ['bg-amber-400/10 text-amber-300', 'Paused — needs input'],
    completed: ['bg-emerald-400/10 text-emerald-300', 'Completed'],
    stopped: ['bg-rose-400/10 text-rose-300', 'Stopped'],
    error: ['bg-rose-400/10 text-rose-300', 'Error'],
  };
  const [cls, label] = map[status] || ['bg-slate-400/10 text-slate-300', status];
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ApprovalPrompt({ pending, onDecide }) {
  const m = pending.match || {};
  return (
    <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
        <span>⏸</span> Approval needed — {pending.reason}
      </div>
      <p className="mt-2 text-sm text-slate-200">
        Step {pending.index + 1}: <b>{pending.action}</b> on{' '}
        <span className="font-mono">{pending.step?.find}</span>
        {m.method && (
          <>
            {' '}— matched via <MethodBadge method={m.method} />{' '}
            {m.confidence != null && (
              <span className="font-mono">{Math.round(m.confidence * 100)}%</span>
            )}{' '}
            at <span className="font-mono">({m.center?.[0]}, {m.center?.[1]})</span>
          </>
        )}
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => onDecide('act')} className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-400">
          Act
        </button>
        <button onClick={() => onDecide('skip')} className="rounded-lg border border-white/15 px-4 py-1.5 text-sm text-slate-200 hover:bg-white/5">
          Skip
        </button>
        <button onClick={() => onDecide('stop')} className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-500">
          Stop
        </button>
      </div>
    </div>
  );
}

function HistoryLog({ history }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [history]);
  if (!history?.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">Action history</div>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-white/5 bg-black/30 p-2">
        {history.map((e, i) => (
          <div key={i} className={`border-l-2 pl-2 text-xs ${TYPE_COLOR[e.type] || 'border-slate-600 text-slate-300'}`}>
            <span className="font-mono text-slate-500">{(e.ts || '').slice(11, 23)}</span>{' '}
            <span className="uppercase opacity-70">{e.type}</span> — {e.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled, danger }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-sm transition disabled:opacity-30 ${danger ? 'text-rose-300 hover:bg-rose-400/10' : 'text-slate-300 hover:bg-white/10'}`}
    >
      {children}
    </button>
  );
}
