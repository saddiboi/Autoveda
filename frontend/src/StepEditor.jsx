import { useCallback, useEffect, useState } from 'react';

// M2 UI: build a sequence of see-and-act steps, persist them, and run them.
// Each step: { find, type, action, value }. Running drives the real mouse/keyboard.

const ACTIONS = [
  { id: 'click', label: 'Click' },
  { id: 'double_click', label: 'Double-click' },
  { id: 'type', label: 'Type' },
  { id: 'move', label: 'Move to' },
];
const TYPES = ['text', 'button', 'field'];

const blankStep = () => ({ find: '', type: 'text', action: 'click', value: '' });

function MethodBadge({ method }) {
  const map = {
    accessibility: 'bg-sky-400/15 text-sky-300',
    ocr: 'bg-amber-400/15 text-amber-300',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${map[method] || 'bg-slate-500/15 text-slate-400'}`}>
      {method || 'none'}
    </span>
  );
}

function ResultLine({ result }) {
  if (!result) return null;
  const ok = result.ok;
  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
        ok ? 'border-emerald-400/20 bg-emerald-400/5' : 'border-rose-400/20 bg-rose-400/5'
      }`}
    >
      <span className={ok ? 'text-emerald-300' : 'text-rose-300'}>{ok ? '✓' : '✕'}</span>
      <MethodBadge method={result.method} />
      {result.match && (
        <span className="font-mono text-slate-400">
          @({result.match.center[0]},{result.match.center[1]})·{Math.round((result.match.confidence || 0) * 100)}%
        </span>
      )}
      <span className="text-slate-300">{result.message || result.error}</span>
      {typeof result.duration_ms === 'number' && (
        <span className="ml-auto font-mono text-slate-500">{result.duration_ms}ms</span>
      )}
    </div>
  );
}

export default function StepEditor({ baseUrl }) {
  const [steps, setSteps] = useState([]);
  const [results, setResults] = useState({}); // index -> result
  const [summary, setSummary] = useState(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preDelay, setPreDelay] = useState(true);
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

  useEffect(() => {
    if (!baseUrl) return;
    api('/steps')
      .then((d) => setSteps(d.steps?.length ? d.steps : [blankStep()]))
      .catch((e) => setError(e.message));
  }, [baseUrl, api]);

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

  const runAll = async () => {
    setRunning(true);
    setError(null);
    setResults({});
    setSummary(null);
    try {
      if (dirty) await save();
      const data = await api('/run/steps', {
        method: 'POST',
        body: JSON.stringify({ steps, pre_delay: preDelay ? 3 : 0 }),
      });
      const byIndex = {};
      (data.results || []).forEach((r) => (byIndex[r.index] = r));
      setResults(byIndex);
      setSummary(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const runOne = async (i) => {
    setRunning(true);
    setError(null);
    try {
      const data = await api('/run/step', { method: 'POST', body: JSON.stringify({ step: steps[i] }) });
      setResults((prev) => ({ ...prev, [i]: data.result }));
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Steps</h2>
        {summary && (
          <span className="text-xs text-slate-400">
            {summary.error ? (
              <span className="text-amber-300">{summary.error}</span>
            ) : (
              <>
                {summary.completed}/{summary.total} completed
              </>
            )}
          </span>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
        Running drives your real mouse &amp; keyboard. Slam the pointer into a screen
        corner to abort (full panic stop arrives in M3).
      </div>

      {/* Steps list */}
      <div className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center font-mono text-xs text-slate-500">{i + 1}</span>
              <input
                value={step.find || ''}
                onChange={(e) => updateStep(i, { find: e.target.value })}
                placeholder="Find (text on screen, e.g. Submit)"
                className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-400/50 focus:outline-none"
              />
              <select
                value={step.type}
                onChange={(e) => updateStep(i, { type: e.target.value })}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
                title="element type hint"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t} className="bg-slate-800">
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={step.action}
                onChange={(e) => updateStep(i, { action: e.target.value })}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
              >
                {ACTIONS.map((a) => (
                  <option key={a.id} value={a.id} className="bg-slate-800">
                    {a.label}
                  </option>
                ))}
              </select>
              {step.action === 'type' && (
                <input
                  value={step.value || ''}
                  onChange={(e) => updateStep(i, { value: e.target.value })}
                  placeholder="text to type"
                  className="w-40 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-400/50 focus:outline-none"
                />
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                <IconBtn label="Move up" onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</IconBtn>
                <IconBtn label="Move down" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>↓</IconBtn>
                <IconBtn label="Run this step" onClick={() => runOne(i)} disabled={running || !step.find}>▶</IconBtn>
                <IconBtn label="Delete" onClick={() => removeStep(i)} danger>✕</IconBtn>
              </div>
            </div>
            <ResultLine result={results[i]} />
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={addStep}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5"
        >
          + Add step
        </button>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40"
        >
          {saving ? 'Saving…' : dirty ? 'Save steps' : 'Saved'}
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={preDelay}
            onChange={(e) => setPreDelay(e.target.checked)}
            className="accent-indigo-500"
          />
          3s head start before running
        </label>
        <button
          onClick={runAll}
          disabled={running || steps.length === 0}
          className="ml-auto rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-400 disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run all'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
    </section>
  );
}

function IconBtn({ children, label, onClick, disabled, danger }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-sm transition disabled:opacity-30 ${
        danger ? 'text-rose-300 hover:bg-rose-400/10' : 'text-slate-300 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}
