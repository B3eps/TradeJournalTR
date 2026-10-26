// Top stat cards + 120-day review heatmap (plain SVG).
const React = require('react');
const { Stagger, StaggerItem, CountUp } = require('../ui/motion');
const CI = require('./CardIcons');

const StatCard = ({ label, icon: Icon, tone, sub, children }) => (
  <div className="bg-bg-surface border border-border rounded-xl px-4 py-3 h-full">
    <div className="flex items-center gap-1.5 text-text-tertiary text-[11px] font-medium uppercase tracking-wider">
      {Icon && <Icon className={`w-3.5 h-3.5 ${tone || ''}`} />}
      {label}
    </div>
    <div className={`mt-1 text-2xl font-bold font-mono ${tone || 'text-text-primary'}`}>{children}</div>
    {sub && <div className="text-[11px] text-text-muted mt-0.5">{sub}</div>}
  </div>
);

const StatsHeader = ({ stats }) => {
  const s = stats || {};
  const hasRet = typeof s.retention30 === 'number';
  return (
    <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3" stagger={0.04}>
      <StaggerItem>
        <StatCard label="Bugün tekrar" icon={CI.Refresh} tone="text-accent" sub={`Bugün çalışılan: ${Number(s.reviewedToday) || 0}`}>
          <CountUp value={Number(s.dueToday) || 0} />
        </StatCard>
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Yeni" icon={CI.Sparkle} tone="text-positive" sub={`Toplam kart: ${Number(s.totalCards) || 0}`}>
          <CountUp value={Number(s.newAvailable) || 0} />
        </StatCard>
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Seri" icon={CI.Fire} tone="text-warning" sub="Arka arkaya çalışılan gün">
          <CountUp value={Number(s.streak) || 0} /> <span className="text-sm font-sans font-medium text-text-tertiary">gün</span>
        </StatCard>
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Tutma oranı" icon={CI.Target} sub={hasRet ? `Son 30 gün · ${Number(s.matureCount) || 0} olgun kart` : 'Henüz tekrar yok'}>
          {hasRet
            ? <><CountUp value={s.retention30} format={(n) => (Math.round(n * 10) / 10).toLocaleString('tr-TR')} />%</>
            : <span className="text-text-muted">—</span>}
        </StatCard>
      </StaggerItem>
    </Stagger>
  );
};

const CELL = 13;
const GAP = 3;
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };

const Heatmap = ({ byDay }) => {
  const days = Array.isArray(byDay) ? byDay : [];
  if (!days.length) return null;
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((s, d) => s + d.count, 0);
  const active = days.filter((d) => d.count > 0).length;
  // Monday-first grid: column = week, row = weekday.
  const firstDow = (parseKey(days[0].date).getDay() + 6) % 7;
  const cells = days.map((d, i) => ({ ...d, col: Math.floor((i + firstDow) / 7), row: (i + firstDow) % 7 }));
  const cols = cells[cells.length - 1].col + 1;
  const width = cols * (CELL + GAP);
  const height = 7 * (CELL + GAP) + 16;
  const level = (c) => (c === 0 ? 0 : c <= max * 0.25 ? 1 : c <= max * 0.5 ? 2 : c <= max * 0.75 ? 3 : 4);
  const opacity = [0, 0.28, 0.5, 0.75, 1];
  const monthLabels = [];
  let lastMonth = -1;
  cells.forEach((c) => {
    const dt = parseKey(c.date);
    if (c.row === 0 && dt.getMonth() !== lastMonth) {
      lastMonth = dt.getMonth();
      monthLabels.push({ col: c.col, label: MONTHS[dt.getMonth()] });
    }
  });

  return (
    <div className="bg-bg-surface border border-border rounded-xl px-4 py-3">
      <div className="flex items-center justify-between text-text-tertiary text-[11px] font-medium uppercase tracking-wider">
        <span>Son 120 gün</span>
        <span className="normal-case tracking-normal text-text-muted">{total} tekrar · {active} aktif gün</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label={`Son 120 günde ${total} kart tekrarı`} className="block">
          {monthLabels.map((m) => (
            <text key={`${m.col}-${m.label}`} x={m.col * (CELL + GAP)} y={10} fontSize="10" fill="rgb(var(--text-muted, 120 120 130))">{m.label}</text>
          ))}
          {cells.map((c) => {
            const lv = level(c.count);
            const dt = parseKey(c.date);
            return (
              <rect
                key={c.date}
                x={c.col * (CELL + GAP)}
                y={16 + c.row * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={3}
                fill={lv === 0 ? 'rgb(var(--border))' : 'rgb(var(--accent))'}
                fillOpacity={lv === 0 ? 0.45 : opacity[lv]}
              >
                <title>{`${dt.getDate()} ${MONTHS[dt.getMonth()]}: ${c.count} tekrar`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

module.exports = { StatsHeader, Heatmap };
