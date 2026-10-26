// "Bugünün planı": pick today's tasks, compare their estimates with the available hours.
const React = require('react');
const { useState, useEffect, useMemo, useCallback } = React;
const { Bar } = require('../ui/motion');
const tasksApi = require('../tasks/api');
const { localToday } = require('../habits/api');

const PLAN_KEY = 'focus-plan-v1';

const fmtMin = (m) => {
  const v = Math.max(0, Math.round(m));
  const h = Math.floor(v / 60);
  const r = v % 60;
  if (h > 0) return `${h} sa${r ? ` ${r} dk` : ''}`;
  return `${r} dk`;
};

const loadPlan = (today) => {
  try {
    const p = JSON.parse(localStorage.getItem(PLAN_KEY));
    if (p && typeof p === 'object') {
      const hours = Number(p.hours) > 0 ? Math.min(16, Number(p.hours)) : 4;
      const items = p.date === today && Array.isArray(p.items) ? p.items.filter((i) => i && typeof i.id === 'string') : [];
      return { date: today, hours, items };
    }
  } catch (e) { /* ignore */ }
  return { date: today, hours: 4, items: [] };
};

const EstimateEditor = ({ value, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setText(value ? String(value) : ''); setEditing(true); }}
        className={`text-xs tabular-nums px-1.5 py-0.5 rounded-md border transition-colors ${value ? 'border-border text-text-secondary hover:text-text-primary' : 'border-dashed border-border text-text-muted hover:text-text-secondary'}`}
        title="Tahmini süreyi düzenle"
      >
        {value ? fmtMin(value) : 'tahmin ekle'}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const n = Math.round(Number(text));
    if (text.trim() === '') { if (value) onSave(null); return; }
    if (Number.isFinite(n) && n > 0 && n <= 1440 && n !== value) onSave(n);
  };
  return (
    <input
      autoFocus
      type="number"
      min={1}
      max={1440}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      aria-label="Tahmini süre (dakika)"
      placeholder="dk"
      className="w-16 px-1.5 py-0.5 text-xs text-right tabular-nums rounded-md bg-bg-input border border-accent/60 text-text-primary outline-none"
    />
  );
};

const PlanPanel = ({ workMin, currentTaskId, onFocusTask }) => {
  const today = localToday();
  const [plan, setPlan] = useState(() => loadPlan(today));
  const [openTasks, setOpenTasks] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const persist = (next) => {
    setPlan(next);
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  };

  const refresh = useCallback(async () => {
    try {
      const { tasks } = await tasksApi.listTasks({ status: 'open', limit: 100 });
      setOpenTasks(tasks);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const byId = useMemo(() => new Map(openTasks.map((t) => [t.id, t])), [openTasks]);
  const inPlan = useMemo(() => new Set(plan.items.map((i) => i.id)), [plan.items]);
  const candidates = openTasks.filter((t) => !inPlan.has(t.id));

  const rows = plan.items.map((i) => {
    const t = byId.get(i.id);
    return { id: i.id, title: t ? t.title : i.title, estimate: t ? t.estimateMin : null, done: loaded && !t };
  });
  const active = rows.filter((r) => !r.done);
  const plannedMin = active.reduce((s, r) => s + (r.estimate || 0), 0);
  const unestimated = active.filter((r) => !r.estimate).length;
  const capacity = Math.max(0.5, plan.hours) * 60;
  const pct = (plannedMin / capacity) * 100;
  const overflow = plannedMin - capacity;
  const barColor = overflow > 0 ? 'rgb(var(--negative))' : pct > 85 ? 'rgb(var(--warning))' : 'rgb(var(--positive))';

  const add = (t) => persist({ ...plan, items: [...plan.items, { id: t.id, title: t.title }] });
  const remove = (id) => persist({ ...plan, items: plan.items.filter((i) => i.id !== id) });
  const addDue = () => {
    const due = candidates.filter((t) => t.dueDate && t.dueDate <= today).slice(0, 12);
    if (due.length) persist({ ...plan, items: [...plan.items, ...due.map((t) => ({ id: t.id, title: t.title }))] });
  };
  const setEstimate = async (id, minutes) => {
    setOpenTasks((list) => list.map((t) => (t.id === id ? { ...t, estimateMin: minutes } : t)));
    try { await tasksApi.updateTask(id, { estimateMin: minutes }); } catch (err) { setError(err.message); refresh(); }
  };
  const setHours = (v) => {
    const n = Number(v);
    if (Number.isFinite(n)) persist({ ...plan, hours: Math.min(16, Math.max(0.5, n)) });
  };

  const dueCount = candidates.filter((t) => t.dueDate && t.dueDate <= today).length;

  return (
    <section className="bg-bg-surface border border-border rounded-2xl p-4" aria-label="Bugünün planı">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-text-primary">Bugünün planı</h2>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          Müsait süre
          <input
            type="number"
            min={0.5}
            max={16}
            step={0.5}
            value={plan.hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-14 px-2 py-1 text-sm text-right tabular-nums rounded-lg bg-bg-input border border-border text-text-primary outline-none focus:border-accent/60"
          />
          sa
        </label>
      </div>

      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-text-secondary tabular-nums">{fmtMin(plannedMin)} planlandı</span>
        <span className="text-text-muted tabular-nums">/ {fmtMin(capacity)}{plannedMin > 0 && workMin ? ` · ≈ ${Math.ceil(plannedMin / workMin)} pomodoro` : ''}</span>
      </div>
      <Bar value={Math.min(100, pct)} color={barColor} height={8} aria-label="Plan doluluğu" />
      {overflow > 0 && (
        <p className="mt-2 text-xs text-warning" role="status">
          Plan müsait süreni {fmtMin(overflow)} aşıyor. Bir iki işi yarına bırakmak iyi olabilir.
        </p>
      )}
      {unestimated > 0 && (
        <p className="mt-1.5 text-xs text-text-muted">{unestimated} görevin tahmini yok; ekledikçe plan netleşir.</p>
      )}

      <ul className="mt-3 space-y-1.5">
        {rows.length === 0 && loaded && (
          <li className="text-sm text-text-secondary py-2">Bugün için görev seçerek başla. Az ama net bir plan, uzun bir listeden iyidir.</li>
        )}
        {rows.map((r) => (
          <li key={r.id} className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl border ${currentTaskId === r.id ? 'border-accent/50 bg-accent/5' : 'border-border'}`}>
            <span className={`flex-1 min-w-0 truncate text-sm ${r.done ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{r.title}</span>
            {r.done ? (
              <span className="text-xs text-positive">bitti</span>
            ) : (
              <>
                <EstimateEditor value={r.estimate} onSave={(m) => setEstimate(r.id, m)} />
                <button type="button" onClick={() => onFocusTask(r.id, r.title)} className="text-xs px-2 py-0.5 rounded-md text-accent hover:bg-accent/10 transition-colors" title="Bu göreve odaklan">
                  {currentTaskId === r.id ? 'Seçili' : 'Odaklan'}
                </button>
              </>
            )}
            <button type="button" onClick={() => remove(r.id)} aria-label={`${r.title} planından çıkar`} className="text-text-muted hover:text-negative opacity-60 group-hover:opacity-100 focus:opacity-100 transition-opacity">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value=""
          onChange={(e) => { const t = byId.get(e.target.value); if (t) add(t); }}
          aria-label="Plana görev ekle"
          className="flex-1 min-w-[160px] py-1.5 px-2 text-xs rounded-lg bg-bg-input border border-border text-text-secondary outline-none"
        >
          <option value="">{candidates.length ? 'Plana görev ekle…' : 'Eklenecek açık görev yok'}</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>{t.title}{t.estimateMin ? ` · ${fmtMin(t.estimateMin)}` : ''}</option>
          ))}
        </select>
        {dueCount > 0 && (
          <button type="button" onClick={addDue} className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">
            Bugün vadeli {dueCount} görevi ekle
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-negative" role="alert">{error}</p>}
    </section>
  );
};

module.exports = PlanPanel;
