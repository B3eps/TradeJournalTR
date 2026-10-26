// Bugünün görevleri: today + overdue open tasks, quick add, progress ring and 14-day bars.
const React = require('react');
const { useState, useCallback } = React;
const { AnimatedCheck, ProgressRing, CountUp, Stagger, StaggerItem } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const { parseTaskInput } = require('../../utils/taskParse');
const { navigate } = require('../../utils/navigation');
const { request, localToday, enc } = require('./api');
const { useResource } = require('./hooks');
const { Card, Skeleton, ErrorNote, Empty, MiniBars, Icon, normalizeDaily } = require('./ui');

const fetchTasks = async () => {
  const today = localToday();
  const [list, stats] = await Promise.all([
    request('GET', `/api/tasks?due=today_overdue&status=open&today=${today}&sort=due`),
    request('GET', `/api/tasks/stats?days=14&today=${today}`).catch(() => null),
  ]);
  const tasks = Array.isArray(list) ? list : (list && Array.isArray(list.tasks) ? list.tasks : []);
  const total = list && typeof list.total === 'number' ? list.total : tasks.length;
  return { tasks, total, stats };
};

const TasksWidget = ({ onNavigate }) => {
  const { data, error, loading, reload, mutate } = useResource(fetchTasks);
  const { play } = useSound();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const today = localToday();

  const complete = useCallback(async (task) => {
    mutate((d) => (d ? { ...d, tasks: d.tasks.filter((t) => t.id !== task.id), total: Math.max(0, d.total - 1) } : d));
    try {
      await request('POST', `/api/tasks/${enc(task.id)}/complete?today=${localToday()}`);
    } catch (e) {
      setFormErr('Görev tamamlanamadı.');
    }
    reload();
  }, [mutate, reload]);

  const add = async (e) => {
    e.preventDefault();
    const raw = text.trim();
    if (!raw || busy) return;
    setBusy(true);
    setFormErr('');
    try {
      let parsed = null;
      try { parsed = parseTaskInput(raw, {}); } catch (err) { parsed = null; }
      const payload = { title: (parsed && parsed.title && parsed.title.trim()) || raw, dueDate: (parsed && parsed.dueDate) || today };
      if (parsed && parsed.dueTime) payload.dueTime = parsed.dueTime;
      if (parsed && parsed.priority) payload.priority = parsed.priority;
      if (parsed && parsed.recurrence) payload.recurrence = parsed.recurrence;
      await request('POST', '/api/tasks', payload);
      setText('');
      play('pop');
      reload();
    } catch (err) {
      setFormErr((err && err.message) || 'Görev eklenemedi.');
      play('error');
    } finally {
      setBusy(false);
    }
  };

  const stats = data && data.stats;
  const tasks = (data && data.tasks) || [];
  const completedToday = stats ? Number(stats.completedToday) || 0 : 0;
  const open = data ? data.total : 0;
  const denom = completedToday + open;
  const pct = denom > 0 ? (completedToday / denom) * 100 : 0;
  const overdueCount = stats ? Number(stats.overdueCount) || 0 : tasks.filter((t) => t.dueDate && t.dueDate < today).length;
  const bars = stats ? normalizeDaily(stats.completedByDay, 14) : null;

  return (
    <Card title="Bugünün görevleri" icon="check" onMore={() => onNavigate('tasks')} className="md:col-span-2" delay={0.05}>
      {loading ? <Skeleton rows={4} /> : error && !data ? <ErrorNote message="Görevler yüklenemedi." onRetry={reload} /> : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 flex flex-col gap-3 min-w-0">
            {tasks.length === 0 ? (
              <Empty>Bugün için açık görev yok. Harika, ya da aşağıdan bir tane ekle.</Empty>
            ) : (
              <Stagger stagger={0.03} className="flex flex-col">
                {tasks.slice(0, 6).map((t) => {
                  const overdue = t.dueDate && t.dueDate < today;
                  return (
                    <StaggerItem key={t.id} y={4} className="flex items-center gap-3 py-2 border-b border-border/60 last:border-0">
                      <AnimatedCheck checked={false} onChange={() => complete(t)} sound="complete" size={18} aria-label={`Tamamla: ${t.title}`} />
                      <button type="button" onClick={() => navigate('tasks', t.id)} className={`flex-1 min-w-0 text-left text-sm truncate ${overdue ? 'text-negative' : 'text-text-primary'}`}>
                        {t.title}
                      </button>
                      {(t.dueTime || overdue) && (
                        <span className={`text-[11px] tabular-nums flex-shrink-0 ${overdue ? 'text-negative' : 'text-text-tertiary'}`}>
                          {overdue ? `Gecikmiş${t.dueTime ? ' ' + t.dueTime : ''}` : t.dueTime}
                        </span>
                      )}
                    </StaggerItem>
                  );
                })}
              </Stagger>
            )}
            {data && data.total > 6 && (
              <button type="button" onClick={() => onNavigate('tasks')} className="text-xs text-text-tertiary hover:text-accent text-left">
                +{data.total - 6} görev daha
              </button>
            )}
            <form onSubmit={add} className="flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Hızlı görev ekle (ör. yarın 18:00 rapor)"
                className="flex-1 min-w-0 px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
              />
              <button type="submit" disabled={busy || !text.trim()} className="w-9 h-9 rounded-lg bg-accent text-accent-text inline-flex items-center justify-center disabled:opacity-40" aria-label="Görevi ekle">
                <Icon name="plus" className="w-4 h-4" />
              </button>
            </form>
            {formErr && <div className="text-xs text-negative">{formErr}</div>}
          </div>

          <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
            <div className="flex items-center gap-4">
              <ProgressRing value={pct} size={72} stroke={7} color="rgb(var(--accent))">
                <span className="text-sm"><CountUp value={Math.round(pct)} format={(n) => `${Math.round(n)}%`} /></span>
              </ProgressRing>
              <div className="text-xs text-text-secondary leading-relaxed">
                <div><span className="text-text-primary font-semibold tabular-nums">{completedToday}</span> tamamlandı</div>
                <div><span className="text-text-primary font-semibold tabular-nums">{open}</span> açık</div>
                {overdueCount > 0 && <div className="text-negative">{overdueCount} gecikmiş</div>}
                {stats && Number(stats.streakDays) > 0 && <div>Seri: {stats.streakDays} gün</div>}
              </div>
            </div>
            {bars && (
              <div>
                <div className="text-[11px] text-text-tertiary mb-1">Son 14 gün tamamlanan</div>
                <MiniBars values={bars} height={44} />
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};

module.exports = TasksWidget;
