// Zaman / Odak: ActivityWatch daily summary + running task timer.
const React = require('react');
const { useState } = React;
const { CountUp } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const { totalSpent } = require('../tasks/taskUtils');
const { request, localToday, enc } = require('./api');
const { useResource, useNow } = require('./hooks');
const { Card, Skeleton, ErrorNote, Empty, Donut, Icon, fmtDur, fmtClock } = require('./ui');
const { Bar } = require('../ui/motion');

const PALETTE = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf', '#94a3b8'];

const fetchSummary = async () => {
  const d = localToday();
  return request('GET', `/api/timetrack/summary?from=${d}&to=${d}`);
};
const fetchTimer = async () => {
  const d = await request('GET', '/api/tasks/timer/running');
  if (!d) return null;
  if (Object.prototype.hasOwnProperty.call(d, 'task')) return d.task || null;
  return d.id ? d : null;
};

const RunningTimer = ({ timer, onStopped }) => {
  const { play } = useSound();
  const now = useNow(1000, !!timer);
  const [busy, setBusy] = useState(false);
  if (!timer) return null;
  const stop = async () => {
    setBusy(true);
    try {
      await request('POST', `/api/tasks/${enc(timer.id)}/timer/stop`);
      play('stop');
    } catch (e) { /* reload below shows the real state */ }
    setBusy(false);
    onStopped();
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5">
      <span className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-secondary">Çalışan zamanlayıcı</div>
        <div className="text-sm text-text-primary truncate">{timer.title}</div>
      </div>
      <span className="font-mono text-sm tabular-nums text-text-primary">{fmtClock(totalSpent(timer, now))}</span>
      <button type="button" disabled={busy} onClick={stop} className="w-8 h-8 rounded-lg bg-bg-surface border border-border text-text-primary inline-flex items-center justify-center hover:border-negative hover:text-negative disabled:opacity-50" aria-label="Zamanlayıcıyı durdur">
        <Icon name="stop" className="w-3.5 h-3.5" fill />
      </button>
    </div>
  );
};

const TimeWidget = ({ onNavigate }) => {
  const sum = useResource(fetchSummary);
  const timer = useResource(fetchTimer);
  const s = sum.data;
  const unavailable = s && s.available === false;
  const cats = s && Array.isArray(s.byCategory) ? s.byCategory.filter((c) => Number(c.sec) > 0) : [];
  const total = s ? Number(s.totalActiveSec) || 0 : 0;
  const goals = cats.filter((c) => Number(c.goalMinPerDay) > 0);

  return (
    <Card title="Zaman / Odak" icon="clock" onMore={() => onNavigate('timetrack')} delay={0.1}>
      <RunningTimer timer={timer.data} onStopped={() => { timer.reload(); }} />
      {sum.loading ? <Skeleton rows={3} /> : sum.error && !s ? <ErrorNote message="Zaman verisi alınamadı." onRetry={sum.reload} /> : unavailable ? (
        <Empty>ActivityWatch bağlı değil. Bağlandığında bugünkü aktif süren burada görünür.</Empty>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <Donut parts={cats.map((c, i) => ({ value: Number(c.sec), color: c.color || PALETTE[i % PALETTE.length] }))} size={88} stroke={12}>
              {cats.length === 0 ? '-' : `${cats.length}`}
            </Donut>
            <div className="min-w-0">
              <div className="text-[11px] text-text-tertiary">Bugün aktif süre</div>
              <div className="text-xl font-bold text-text-primary tabular-nums">
                <CountUp value={total} duration={700} format={(n) => fmtDur(n)} />
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {cats.slice(0, 3).map((c, i) => (
                  <div key={c.name} className="flex items-center gap-1.5 text-[11px] text-text-secondary min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color || PALETTE[i % PALETTE.length] }} />
                    <span className="truncate">{c.name}</span>
                    <span className="text-text-tertiary tabular-nums ml-auto pl-2">{fmtDur(c.sec)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {goals.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {goals.slice(0, 3).map((c, i) => {
                const pct = Math.min(100, (Number(c.sec) / 60 / Number(c.goalMinPerDay)) * 100);
                return (
                  <div key={c.name}>
                    <div className="flex justify-between text-[11px] text-text-secondary mb-1">
                      <span className="truncate">{c.name} hedefi</span>
                      <span className="tabular-nums">{fmtDur(c.sec)} / {fmtDur(c.goalMinPerDay * 60)}</span>
                    </div>
                    <Bar value={pct} color={pct >= 100 ? 'rgb(var(--positive))' : (c.color || PALETTE[i % PALETTE.length])} height={6} />
                  </div>
                );
              })}
            </div>
          )}
          {cats.length === 0 && <Empty>Bugün henüz kayıtlı aktivite yok.</Empty>}
        </>
      )}
    </Card>
  );
};

module.exports = TimeWidget;
