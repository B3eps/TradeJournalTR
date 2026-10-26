const React = require('react');
const { useState, useEffect, useCallback, useSyncExternalStore } = React;
const { FadeIn, ProgressRing, CountUp } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const store = require('../focus/store');
const SettingsDrawer = require('../focus/SettingsDrawer');
const PlanPanel = require('../focus/PlanPanel');
const habitsApi = require('../habits/api');
const tasksApi = require('../tasks/api');

// =====================================================
// ODAK (Pomodoro + daily plan)
// The timer lives in focus/store.js (absolute end timestamp, persisted), so it keeps
// running while you visit other pages. Space starts / pauses outside inputs.
// A work session with a task also runs that task's own timer (POST /api/tasks/:id/timer/*).
// =====================================================

const KIND_COLOR = { work: 'rgb(var(--accent))', short: 'rgb(var(--positive))', long: 'rgb(var(--info))' };
const DAY_INITIALS = ['P', 'S', 'Ç', 'P', 'C', 'C', 'P'];

const useFocusState = () => useSyncExternalStore(store.subscribe, store.getState, store.getState);

// Re-renders ~4x per second while the timer runs. The value shown is always derived
// from the absolute end timestamp, so nothing accumulates or drifts.
const useNow = (active) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
};

const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const fmtHm = (sec) => {
  const m = Math.round(sec / 60);
  if (m >= 60) return `${Math.floor(m / 60)} sa${m % 60 ? ` ${m % 60} dk` : ''}`;
  return `${m} dk`;
};

const isTyping = (e) => {
  const t = e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || t.isContentEditable;
};

const microcopy = (s, stats) => {
  if (s.status === 'running') return s.kind === 'work' ? 'Tek bir şeye odaklan. Gerisi bekleyebilir.' : 'Mola zamanı. Ekrandan biraz uzaklaş.';
  if (s.status === 'paused') return 'Duraklatıldı. Hazır olduğunda devam et.';
  if (stats && stats.todayPomodoros > 0) return `Bugün ${stats.todayPomodoros} oturum tamamladın. İstersen bir tane daha.`;
  return 'Bir görev seç, süreyi başlat. Mükemmel olması gerekmiyor.';
};

const StatTile = ({ label, children }) => (
  <div className="bg-bg-input/60 rounded-xl px-3 py-2.5">
    <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
    <div className="text-lg font-semibold text-text-primary tabular-nums mt-0.5">{children}</div>
  </div>
);

const FocusPage = () => {
  const s = useFocusState();
  const { play } = useSound();
  const running = s.status === 'running';
  const now = useNow(running);
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { store.ensureSettings(); }, []);

  const loadStats = useCallback(async () => {
    try { setStats(await habitsApi.request('GET', `/api/focus/stats?days=14&today=${habitsApi.localToday()}`)); } catch (e) { /* keep previous */ }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats, s.version]);

  useEffect(() => {
    let alive = true;
    tasksApi.listTasks({ status: 'open', limit: 100 })
      .then(({ tasks: list }) => { if (alive) setTasks(list); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const remaining = store.remainingAt(s, now);
  const elapsedPct = s.totalMs > 0 ? ((s.totalMs - remaining) / s.totalMs) * 100 : 0;

  const toggle = useCallback(() => {
    play(store.getState().status === 'running' ? 'stop' : 'start');
    store.toggle();
  }, [play]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTyping(e) || showSettings) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, showSettings]);

  const pickTask = (id) => {
    const t = tasks.find((x) => x.id === id);
    store.setTask(id || null, t ? t.title : '');
  };

  const focusFromPlan = (id, title) => {
    if (!tasks.some((t) => t.id === id)) setTasks((l) => [...l, { id, title }]);
    store.setTask(id, title);
  };

  const color = KIND_COLOR[s.kind];
  const longEvery = s.settings.longEvery;
  const filled = Math.min(longEvery, s.cycle);
  const maxSec = stats ? Math.max(1, ...stats.byDay.map((d) => d.seconds)) : 1;
  const taskKnown = !s.taskId || tasks.some((t) => t.id === s.taskId);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <FadeIn className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Odak</h1>
          <p className="text-sm text-text-secondary mt-0.5" aria-live="polite">{microcopy(s, stats)}</p>
        </div>
        <button type="button" onClick={() => setShowSettings(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></svg>
          Ayarlar
        </button>
      </FadeIn>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-5">
          <section className="bg-bg-surface border border-border rounded-2xl p-5 sm:p-6 flex flex-col items-center" aria-label="Zamanlayıcı">
            <div className="inline-flex rounded-xl border border-border overflow-hidden text-xs" role="tablist" aria-label="Oturum türü">
              {['work', 'short', 'long'].map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={s.kind === k}
                  onClick={() => { if (s.kind !== k) { play('click'); store.switchKind(k); } }}
                  className={`px-3.5 py-1.5 transition-colors ${s.kind === k ? 'bg-bg-input text-text-primary font-medium' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  {store.KIND_LABELS[k]}
                </button>
              ))}
            </div>

            <div className="my-6" role="timer" aria-label={`${store.KIND_LABELS[s.kind]}, kalan süre ${clock(remaining)}`}>
              <ProgressRing value={elapsedPct} size={280} stroke={10} color={color} duration={0.3}>
                <div className="text-center">
                  <div className="font-mono text-6xl font-semibold tracking-tight text-text-primary tabular-nums">{clock(remaining)}</div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-widest" style={{ color }}>
                    {s.status === 'paused' ? 'Duraklatıldı' : store.KIND_LABELS[s.kind]}
                  </div>
                </div>
              </ProgressRing>
            </div>

            <div className="flex items-center gap-1.5 mb-5" aria-label={`${filled} / ${longEvery} oturum tamamlandı`} role="img">
              {Array.from({ length: longEvery }).map((_, i) => {
                const current = s.kind === 'work' && i === filled && s.status !== 'idle';
                return (
                  <span
                    key={i}
                    className={`w-2.5 h-2.5 rounded-full border transition-colors ${current ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                    style={{ backgroundColor: i < filled ? KIND_COLOR.work : 'transparent', borderColor: i < filled || current ? KIND_COLOR.work : 'rgb(var(--border))' }}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={toggle}
                className="min-w-[132px] px-6 py-2.5 text-sm font-semibold rounded-xl bg-accent text-accent-text hover:bg-accent/90 transition-colors"
              >
                {running ? 'Duraklat' : s.status === 'paused' ? 'Devam et' : 'Başlat'}
              </button>
              <button type="button" onClick={() => { play('click'); store.skip(); }} className="px-4 py-2.5 text-sm rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">Atla</button>
              <button type="button" onClick={() => { play('click'); store.reset(); }} className="px-4 py-2.5 text-sm rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">Sıfırla</button>
            </div>
            <p className="mt-3 text-[11px] text-text-muted">Boşluk tuşu başlatır / duraklatır</p>

            <div className="mt-5 w-full max-w-sm">
              <label htmlFor="focus-task" className="block text-xs text-text-muted mb-1">Üzerinde çalıştığın görev</label>
              <select
                id="focus-task"
                value={s.taskId || ''}
                onChange={(e) => pickTask(e.target.value)}
                className="w-full py-2 px-2.5 text-sm rounded-lg bg-bg-input border border-border text-text-primary outline-none focus:border-accent/60"
              >
                <option value="">Görev seçilmedi</option>
                {!taskKnown && <option value={s.taskId}>{s.taskTitle || 'Seçili görev'}</option>}
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}{t.estimateMin ? ` · ${t.estimateMin} dk` : ''}</option>)}
              </select>
              <p className="mt-1.5 text-[11px] text-text-muted">
                {s.taskId && s.kind === 'work' ? 'Odak süresi bu görevin zamanlayıcısına da işlenir.' : 'Görev seçersen süre görevin kendi zamanlayıcısına da yazılır.'}
              </p>
              {s.notice && (
                <p className="mt-1.5 text-xs text-warning" role="status">
                  {s.notice} <button type="button" onClick={store.clearNotice} className="underline">Tamam</button>
                </p>
              )}
            </div>
          </section>

          <section className="bg-bg-surface border border-border rounded-2xl p-4" aria-label="Odak istatistikleri">
            <h2 className="text-sm font-semibold text-text-primary mb-3">Son 14 gün</h2>
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              <StatTile label="Bugün">{stats ? fmtHm(stats.todaySeconds) : '–'}</StatTile>
              <StatTile label="Oturum">{stats ? <CountUp value={stats.todayPomodoros} /> : '–'}</StatTile>
              <StatTile label="Seri">{stats ? <><CountUp value={stats.streakDays} /> <span className="text-sm font-normal text-text-muted">gün</span></> : '–'}</StatTile>
            </div>
            {stats && (
              <div className="flex items-end gap-1.5 h-24" role="img" aria-label="Günlük odak süresi grafiği">
                {stats.byDay.map((d, i) => {
                  const wd = (new Date(`${d.date}T00:00:00`).getDay() + 6) % 7;
                  const isToday = i === stats.byDay.length - 1;
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${d.date}: ${fmtHm(d.seconds)} · ${d.pomodoros} oturum`}>
                      <div className="w-full rounded-t-md min-h-[3px]" style={{ height: `${Math.max(3, (d.seconds / maxSec) * 100)}%`, backgroundColor: d.seconds ? KIND_COLOR.work : 'rgb(var(--bg-input))', opacity: isToday ? 1 : 0.65 }} />
                      <span className={`text-[10px] ${isToday ? 'text-text-primary' : 'text-text-muted'}`}>{DAY_INITIALS[wd]}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="lg:col-span-2">
          <PlanPanel workMin={s.settings.workMin} currentTaskId={s.taskId} onFocusTask={focusFromPlan} />
        </div>
      </div>

      {showSettings && (
        <SettingsDrawer settings={s.settings} onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); play('pop'); }} />
      )}
    </div>
  );
};

module.exports = FocusPage;
