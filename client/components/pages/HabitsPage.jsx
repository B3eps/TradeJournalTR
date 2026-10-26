const React = require('react');
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { FadeIn, Stagger, StaggerItem, CountUp, AnimatedCheck, HoverLift, ProgressRing } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const api = require('../habits/api');
const { HabitDialog, SUGGESTIONS } = require('../habits/HabitDialog');
const { Heatmap, WeekGrid } = require('../habits/Charts');

// =====================================================
// ALIŞKANLIKLAR (habit tracker)
// Today checklist, weekly grid, 120-day heatmap, streaks and stats.
// Streaks: consecutive scheduled days (or weeks that met the weekly target).
// =====================================================

const Flame = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.5c.6 3.2 4.6 5.1 4.6 9.6a4.6 4.6 0 01-9.2 0c0-1.7.8-2.9 1.6-3.8.2 1.2.8 1.8 1.5 2.1C10.1 7.3 10.6 4.7 12 2.5z" />
  </svg>
);

const unitLabel = (h) => (h.streakUnit === 'week' ? 'hafta' : 'gün');

const scheduleText = (h) => {
  if (h.daysOfWeek && h.daysOfWeek.length) return h.daysOfWeek.map((i) => ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'][i]).join(' · ');
  return h.targetPerWeek < 7 ? `Haftada ${h.targetPerWeek} gün` : 'Her gün';
};

const microcopy = (habits, doneCount, todayList) => {
  if (habits.length === 0) return 'Küçük başla. Tek bir alışkanlık bile yeter.';
  if (todayList.length === 0) return 'Bugün planlı bir alışkanlığın yok. İyi dinlenmeler.';
  if (doneCount === todayList.length) return 'Bugünlük hepsi tamam. Kendine nazik ol.';
  if (doneCount === 0) return 'Hazır olduğunda başla; tek bir adım bile sayılır.';
  return `Güzel gidiyor. ${todayList.length - doneCount} tane kaldı, acele yok.`;
};

const StatCard = ({ label, children, hint }) => (
  <HoverLift className="bg-bg-surface border border-border rounded-2xl px-4 py-3.5">
    <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
    <div className="mt-1 text-2xl font-semibold text-text-primary tabular-nums">{children}</div>
    {hint && <div className="text-xs text-text-muted mt-0.5 truncate">{hint}</div>}
  </HoverLift>
);

const HabitsPage = () => {
  const { play } = useSound();
  const [today, setToday] = useState(api.localToday());
  const [habits, setHabits] = useState([]);
  const [hist, setHist] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { habit | null, preset? }
  const [selected, setSelected] = useState(null); // habit id for the heatmap, null = all
  const [archived, setArchived] = useState(null); // null = hidden, [] = shown
  const [toast, setToast] = useState('');
  const alive = useRef(true);
  const toastTimer = useRef(null);

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await api.listHabits(false);
      const entries = await Promise.all(list.map((h) => api.getHistory(h.id, 120).then((d) => [h.id, d]).catch(() => [h.id, null])));
      if (!alive.current) return;
      const map = {};
      entries.forEach(([id, d]) => { if (d) map[id] = d; });
      setHabits(list);
      setHist(map);
      setError('');
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    // Day rollover: reload when the local date changes while the page stays open.
    const t = setInterval(() => {
      const now = api.localToday();
      setToday((prev) => { if (prev !== now) { load(); return now; } return prev; });
    }, 60 * 1000);
    return () => { alive.current = false; clearInterval(t); clearTimeout(toastTimer.current); };
  }, [load]);

  const loadArchived = useCallback(async () => {
    try { setArchived(await api.listHabits(true)); } catch (err) { say(err.message); }
  }, [say]);

  // ---- derived ----
  const todayList = useMemo(() => habits.filter((h) => h.scheduledToday), [habits]);
  const doneCount = todayList.filter((h) => h.doneToday).length;
  const weekStart = useMemo(() => api.addDays(today, -api.weekdayIndex(today)), [today]);

  const stats = useMemo(() => {
    let best = null;
    let weekDone = 0;
    let weekGoal = 0;
    let rateSum = 0;
    let rateN = 0;
    habits.forEach((h) => {
      if (!best || h.bestStreak > best.bestStreak) best = h;
      weekDone += Math.min(h.weekCount, h.targetPerWeek);
      weekGoal += h.targetPerWeek;
      const hh = hist[h.id];
      if (hh) { rateSum += hh.completionRate30; rateN++; }
    });
    return {
      best,
      weekPct: weekGoal ? Math.round((weekDone / weekGoal) * 100) : 0,
      rate: rateN ? Math.round((rateSum / rateN) * 100) : 0,
    };
  }, [habits, hist]);

  const heatDays = useMemo(() => {
    const list = selected ? habits.filter((h) => h.id === selected) : habits;
    const first = list.map((h) => hist[h.id]).find(Boolean);
    if (!first) return [];
    return first.days.map((_, i) => {
      let sched = 0;
      let done = 0;
      list.forEach((h) => {
        const d = hist[h.id] && hist[h.id].days[i];
        if (d && d.scheduled) { sched++; if (d.done) done++; }
      });
      const date = first.days[i].date;
      if (!sched) return { date, value: null, label: 'planlı alışkanlık yok' };
      return { date, value: done / sched, label: `${done}/${sched} tamam` };
    });
  }, [habits, hist, selected]);

  const heatColor = selected ? ((habits.find((h) => h.id === selected) || {}).color || '#6366f1') : '#6366f1';

  // ---- actions ----
  const toggle = useCallback(async (habit, date, done) => {
    const prevHabit = habit;
    const prevHist = hist[habit.id];
    // optimistic update
    setHist((m) => {
      const cur = m[habit.id];
      if (!cur) return m;
      return { ...m, [habit.id]: { ...cur, days: cur.days.map((d) => (d.date === date ? { ...d, done } : d)) } };
    });
    setHabits((list) => list.map((h) => {
      if (h.id !== habit.id) return h;
      const inWeek = date >= weekStart && date <= api.addDays(weekStart, 6);
      return {
        ...h,
        doneToday: date === today ? done : h.doneToday,
        weekCount: inWeek ? Math.max(0, h.weekCount + (done ? 1 : -1)) : h.weekCount,
      };
    }));
    try {
      const res = await api.checkHabit(habit.id, done, date);
      if (!alive.current) return;
      setHabits((list) => list.map((h) => (h.id === habit.id ? res.habit : h)));
      if (done && date === today) {
        const after = habits.map((h) => (h.id === habit.id ? { ...h, doneToday: true } : h)).filter((h) => h.scheduledToday);
        if (after.length && after.every((h) => h.doneToday)) play('complete-all');
      }
      api.getHistory(habit.id, 120).then((d) => { if (alive.current) setHist((m) => ({ ...m, [habit.id]: d })); }).catch(() => {});
    } catch (err) {
      if (!alive.current) return;
      play('error');
      setHabits((list) => list.map((h) => (h.id === habit.id ? prevHabit : h)));
      if (prevHist) setHist((m) => ({ ...m, [habit.id]: prevHist }));
      say(err.message);
    }
  }, [hist, today, weekStart, habits, play, say]);

  const saveHabit = async (body) => {
    if (dialog && dialog.habit) await api.updateHabit(dialog.habit.id, body);
    else await api.createHabit(body);
    setDialog(null);
    play('pop');
    await load();
  };

  const archiveHabit = async (h) => {
    try {
      await api.updateHabit(h.id, { archived: !h.archived });
      setDialog(null);
      play('toggle-off');
      await load();
      if (archived) loadArchived();
    } catch (err) { say(err.message); }
  };

  const deleteHabit = async (h) => {
    try {
      await api.deleteHabit(h.id);
      setDialog(null);
      play('delete');
      if (selected === h.id) setSelected(null);
      await load();
      if (archived) loadArchived();
    } catch (err) { say(err.message); }
  };

  const addSuggestion = async (s) => {
    try {
      await api.createHabit(s);
      play('pop');
      await load();
    } catch (err) { say(err.message); }
  };

  const existingNames = new Set(habits.map((h) => h.name.toLowerCase()));
  const suggestions = SUGGESTIONS.filter((s) => !existingNames.has(s.name.toLowerCase()));

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <FadeIn className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Alışkanlıklar</h1>
          <p className="text-sm text-text-secondary mt-0.5" aria-live="polite">{loading ? ' ' : microcopy(habits, doneCount, todayList)}</p>
        </div>
        <button type="button" onClick={() => setDialog({ habit: null })} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-accent text-accent-text hover:bg-accent/90 transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Yeni alışkanlık
        </button>
      </FadeIn>

      {error && !habits.length ? (
        <div className="bg-bg-surface border border-border rounded-2xl p-6 text-center">
          <p className="text-sm text-text-secondary">{error}</p>
          <button type="button" onClick={() => { setLoading(true); load(); }} className="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text">Tekrar dene</button>
        </div>
      ) : (
        <>
          {habits.length > 0 && (
            <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StaggerItem>
                <StatCard label="Bugün" hint={todayList.length ? 'tamamlanan alışkanlık' : 'planlı alışkanlık yok'}>
                  <CountUp value={doneCount} /><span className="text-text-muted text-lg"> / {todayList.length}</span>
                </StatCard>
              </StaggerItem>
              <StaggerItem>
                <StatCard label="En uzun seri" hint={stats.best && stats.best.bestStreak > 0 ? stats.best.name : 'henüz seri yok'}>
                  <CountUp value={stats.best ? stats.best.bestStreak : 0} /><span className="text-text-muted text-lg"> {stats.best ? unitLabel(stats.best) : 'gün'}</span>
                </StatCard>
              </StaggerItem>
              <StaggerItem>
                <StatCard label="Bu hafta" hint="haftalık hedefe göre">
                  %<CountUp value={stats.weekPct} />
                </StatCard>
              </StaggerItem>
              <StaggerItem>
                <StatCard label="Son 30 gün" hint="ortalama tamamlanma">
                  %<CountUp value={stats.rate} />
                </StatCard>
              </StaggerItem>
            </Stagger>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            <section className="xl:col-span-2 bg-bg-surface border border-border rounded-2xl p-4" aria-label="Bugünün alışkanlıkları">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-text-primary">Bugün</h2>
                {todayList.length > 0 && (
                  <ProgressRing value={(doneCount / todayList.length) * 100} size={34} stroke={4} aria-label={`${doneCount} / ${todayList.length}`} />
                )}
              </div>

              {loading ? (
                <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-xl bg-bg-input animate-pulse motion-reduce:animate-none" />)}</div>
              ) : habits.length === 0 ? (
                <p className="text-sm text-text-secondary py-2">Henüz alışkanlık yok. Aşağıdaki önerilerden birini seçebilir ya da kendin ekleyebilirsin.</p>
              ) : todayList.length === 0 ? (
                <p className="text-sm text-text-secondary py-2">Bugün planlı alışkanlık yok.</p>
              ) : (
                <ul className="space-y-1.5">
                  {todayList.map((h) => (
                    <li key={h.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:border-border hover:bg-bg-input/50 transition-colors">
                      <AnimatedCheck
                        checked={h.doneToday}
                        color={h.color}
                        size={22}
                        sound
                        label={undefined}
                        aria-label={`${h.name} bugün ${h.doneToday ? 'tamamlandı' : 'tamamlanmadı'}`}
                        onChange={(next) => toggle(h, today, next)}
                      />
                      <button type="button" onClick={() => setSelected(selected === h.id ? null : h.id)} className="flex-1 min-w-0 text-left" title="Isı haritasında göster">
                        <span className={`flex items-center gap-2 text-sm ${h.doneToday ? 'text-text-tertiary' : 'text-text-primary'}`}>
                          <span aria-hidden="true">{h.icon}</span>
                          <span className="truncate">{h.name}</span>
                        </span>
                        <span className="block text-[11px] text-text-muted">{scheduleText(h)} · bu hafta {h.weekCount}/{h.targetPerWeek}</span>
                      </button>
                      <span className={`flex items-center gap-1 text-xs tabular-nums flex-shrink-0 ${h.streak > 0 ? 'text-warning' : 'text-text-muted'}`} title={`En iyi seri: ${h.bestStreak} ${unitLabel(h)}`}>
                        <Flame className="w-3.5 h-3.5" />
                        {h.streak} {unitLabel(h)}
                      </span>
                      <button type="button" onClick={() => setDialog({ habit: h })} aria-label={`${h.name} düzenle`} className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-text-primary transition-opacity">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* habits not scheduled today */}
              {habits.length > todayList.length && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Bugün planlı değil</div>
                  <ul className="space-y-1">
                    {habits.filter((h) => !h.scheduledToday).map((h) => (
                      <li key={h.id} className="flex items-center gap-2 text-xs text-text-tertiary">
                        <span aria-hidden="true">{h.icon}</span>
                        <span className="flex-1 truncate">{h.name}</span>
                        <span>{scheduleText(h)}</span>
                        <button type="button" onClick={() => setDialog({ habit: h })} aria-label={`${h.name} düzenle`} className="text-text-muted hover:text-text-primary">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!loading && suggestions.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border">
                  <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Öneriler</div>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button key={s.name} type="button" onClick={() => addSuggestion(s)} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">
                        <span aria-hidden="true">{s.icon}</span>{s.name}
                        <span className="text-text-muted">+</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <div className="xl:col-span-3 space-y-5">
              {habits.length > 0 && (
                <section className="bg-bg-surface border border-border rounded-2xl p-4" aria-label="Haftalık görünüm">
                  <WeekGrid habits={habits} hist={hist} weekStart={weekStart} today={today} onToggle={toggle} />
                </section>
              )}

              {habits.length > 0 && (
                <section className="bg-bg-surface border border-border rounded-2xl p-4" aria-label="Son 120 gün">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h2 className="text-sm font-semibold text-text-primary">Son 120 gün</h2>
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Isı haritası kaynağı">
                      <button type="button" onClick={() => setSelected(null)} aria-pressed={!selected} className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${!selected ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-muted hover:text-text-secondary'}`}>Tümü</button>
                      {habits.map((h) => (
                        <button key={h.id} type="button" onClick={() => setSelected(selected === h.id ? null : h.id)} aria-pressed={selected === h.id} className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${selected === h.id ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-muted hover:text-text-secondary'}`}>
                          <span aria-hidden="true">{h.icon}</span> {h.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Heatmap days={heatDays} color={heatColor} />
                  {selected && hist[selected] && (
                    <p className="mt-2 text-xs text-text-muted">
                      Son 30 günde %{Math.round(hist[selected].completionRate30 * 100)} · toplam {hist[selected].total} gün işaretlendi · en iyi seri {hist[selected].bestStreak} {hist[selected].streakUnit === 'week' ? 'hafta' : 'gün'}
                    </p>
                  )}
                </section>
              )}

              <section aria-label="Arşiv">
                {archived === null ? (
                  <button type="button" onClick={loadArchived} className="text-xs text-text-muted hover:text-text-secondary transition-colors">Arşivlenenleri göster</button>
                ) : (
                  <div className="bg-bg-surface border border-border rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-sm font-semibold text-text-primary">Arşiv</h2>
                      <button type="button" onClick={() => setArchived(null)} className="text-xs text-text-muted hover:text-text-secondary">Gizle</button>
                    </div>
                    {archived.length === 0 ? <p className="text-xs text-text-muted">Arşivde alışkanlık yok.</p> : (
                      <ul className="space-y-1">
                        {archived.map((h) => (
                          <li key={h.id} className="flex items-center gap-2 text-sm text-text-secondary">
                            <span aria-hidden="true">{h.icon}</span>
                            <span className="flex-1 truncate">{h.name}</span>
                            <button type="button" onClick={() => archiveHabit(h)} className="text-xs text-accent hover:underline">Geri getir</button>
                            <button type="button" onClick={() => setDialog({ habit: h })} className="text-xs text-text-muted hover:text-text-primary">Düzenle</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}

      {dialog && (
        <HabitDialog
          habit={dialog.habit}
          onSave={saveHabit}
          onClose={() => setDialog(null)}
          onArchive={archiveHabit}
          onDelete={deleteHabit}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[210] px-4 py-2 rounded-xl bg-bg-surface border border-border shadow-xl text-sm text-text-primary">{toast}</div>
      )}
    </div>
  );
};

module.exports = HabitsPage;
