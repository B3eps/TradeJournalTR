// Mini analytics strip shown on 'Bugün' and 'Tüm Görevler'.
const React = require('react');
const { Stagger, StaggerItem, CountUp } = require('../ui/motion');
const TI = require('./TaskIcons');
const U = require('./taskUtils');

const lastNDays = (n) => {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(U.isoPlus(-i));
  return out;
};

const byDate = (arr, field) => {
  const m = {};
  (Array.isArray(arr) ? arr : []).forEach(r => { if (r && r.date) m[String(r.date).slice(0, 10)] = Number(r[field]) || 0; });
  return m;
};

const StatCard = ({ label, icon: Icon, tone, children, sub }) => (
  <div className="bg-bg-surface border border-border rounded-xl px-4 py-3 h-full">
    <div className="flex items-center gap-1.5 text-text-tertiary text-[11px] font-medium uppercase tracking-wider">
      {Icon && <Icon className={`w-3.5 h-3.5 ${tone || ''}`} />}
      {label}
    </div>
    <div className={`mt-1 text-2xl font-bold font-mono ${tone || 'text-text-primary'}`}>{children}</div>
    {sub && <div className="text-[11px] text-text-muted mt-0.5">{sub}</div>}
  </div>
);

const StatsStrip = ({ stats }) => {
  if (!stats) return null;
  const days = lastNDays(14);
  const completed = byDate(stats.completedByDay, 'count');
  const focus = byDate(stats.focusSecondsByDay, 'seconds');
  const values = days.map(d => completed[d] || 0);
  const max = Math.max(1, ...values);
  const today = days[days.length - 1];
  const focusToday = focus[today] || 0;
  const focus14 = days.reduce((s, d) => s + (focus[d] || 0), 0);
  const total14 = values.reduce((s, v) => s + v, 0);
  const overdue = Number(stats.overdueCount) || 0;

  return (
    <Stagger className="grid grid-cols-2 xl:grid-cols-5 gap-3" stagger={0.04}>
      <StaggerItem>
        <StatCard label="Bugün tamamlanan" icon={TI.CheckCircle} tone="text-positive">
          <CountUp value={Number(stats.completedToday) || 0} />
        </StatCard>
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Gecikmiş" icon={TI.Alert} tone={overdue > 0 ? 'text-negative' : 'text-text-primary'} sub={overdue > 0 ? 'Bunları bugüne taşımayı düşün' : 'Gecikmiş görev yok'}>
          <CountUp value={overdue} />
        </StatCard>
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Seri" icon={TI.Fire} tone="text-warning" sub="Arka arkaya görev tamamlanan gün">
          <CountUp value={Number(stats.streakDays) || 0} /> <span className="text-sm font-sans font-medium text-text-tertiary">gün</span>
        </StatCard>
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Odak süresi" icon={TI.Clock} tone="text-accent" sub={`Son 14 gün: ${U.formatDuration(focus14)}`}>
          <span className="text-xl">{U.formatDuration(focusToday)}</span>
        </StatCard>
      </StaggerItem>
      <StaggerItem className="col-span-2 xl:col-span-1">
        <div className="bg-bg-surface border border-border rounded-xl px-4 py-3 h-full">
          <div className="flex items-center justify-between text-text-tertiary text-[11px] font-medium uppercase tracking-wider">
            <span>Son 14 gün</span>
            <span className="normal-case tracking-normal text-text-muted">{total14} görev</span>
          </div>
          <div className="mt-2 flex items-end gap-[3px] h-12" role="img" aria-label={`Son 14 günde ${total14} görev tamamlandı`}>
            {days.map((d, i) => {
              const v = values[i];
              const h = v === 0 ? 3 : Math.max(6, Math.round((v / max) * 48));
              const dt = U.parseISO(d);
              return (
                <div
                  key={d}
                  title={`${dt.getDate()} ${U.MONTHS_SHORT[dt.getMonth()]}: ${v} görev`}
                  className={`flex-1 rounded-sm transition-[height] duration-500 ${d === today ? 'bg-accent' : v ? 'bg-accent/45' : 'bg-bg-input'}`}
                  style={{ height: h }}
                />
              );
            })}
          </div>
        </div>
      </StaggerItem>
    </Stagger>
  );
};

module.exports = StatsStrip;
