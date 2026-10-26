// Plain SVG / CSS visuals for the habits page: the 120-day heatmap and the weekly grid.
const React = require('react');
const { addDays, weekdayIndex } = require('./api');

const DAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

const fmt = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const CELL = 13;
const GAP = 3;

// days: [{ date, value (0..1 or null for "not scheduled"), label }], oldest first.
const Heatmap = ({ days, color = '#6366f1' }) => {
  if (!days.length) return null;
  const lead = weekdayIndex(days[0].date); // empty cells before the first day in its week column
  const cols = Math.ceil((lead + days.length) / 7);
  const leftPad = 26;
  const topPad = 16;
  const width = leftPad + cols * (CELL + GAP);
  const height = topPad + 7 * (CELL + GAP);
  const monthMarks = [];
  let lastMonth = -1;
  days.forEach((d, i) => {
    const col = Math.floor((lead + i) / 7);
    const month = Number(d.date.slice(5, 7)) - 1;
    if (month !== lastMonth && weekdayIndex(d.date) <= 3 && (monthMarks.length === 0 || col - monthMarks[monthMarks.length - 1].col >= 3)) {
      monthMarks.push({ col, label: MONTHS[month] });
      lastMonth = month;
    }
  });
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Son 120 günün tamamlanma haritası" className="block">
        {[0, 2, 4].map((r) => (
          <text key={r} x={0} y={topPad + r * (CELL + GAP) + CELL - 2} fontSize="9" fill="rgb(var(--text-muted))">{DAY_SHORT[r]}</text>
        ))}
        {monthMarks.map((m) => (
          <text key={m.col} x={leftPad + m.col * (CELL + GAP)} y={10} fontSize="9" fill="rgb(var(--text-muted))">{m.label}</text>
        ))}
        {days.map((d, i) => {
          const pos = lead + i;
          const x = leftPad + Math.floor(pos / 7) * (CELL + GAP);
          const y = topPad + (pos % 7) * (CELL + GAP);
          const v = d.value;
          const none = v === null;
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx={3}
              fill={none || v === 0 ? 'rgb(var(--bg-input))' : color}
              fillOpacity={none ? 0.35 : v === 0 ? 1 : 0.25 + 0.75 * v}
            >
              <title>{`${fmt(d.date)}${d.label ? ` · ${d.label}` : ''}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
};

// habits: [{ id, name, icon, color, daysOfWeek }], hist: { id: { days } }, week start date (Monday), today
const WeekGrid = ({ habits, hist, weekStart, today, onToggle }) => {
  const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-separate" style={{ borderSpacing: '4px' }}>
        <thead>
          <tr>
            <th className="text-left font-medium text-text-muted pl-1 pb-1">Bu hafta</th>
            {dates.map((d, i) => (
              <th key={d} className={`font-medium pb-1 w-9 ${d === today ? 'text-text-primary' : 'text-text-muted'}`}>{DAY_SHORT[i]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {habits.map((h) => {
            const days = (hist[h.id] && hist[h.id].days) || [];
            const byDate = new Map(days.map((x) => [x.date, x]));
            return (
              <tr key={h.id}>
                <td className="pr-2 pl-1 max-w-[140px]">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span aria-hidden="true">{h.icon}</span>
                    <span className="truncate text-text-secondary">{h.name}</span>
                  </span>
                </td>
                {dates.map((d) => {
                  const rec = byDate.get(d);
                  const future = d > today;
                  const scheduled = rec ? rec.scheduled : true;
                  const done = !!(rec && rec.done);
                  return (
                    <td key={d} className="text-center">
                      <button
                        type="button"
                        disabled={future}
                        onClick={() => onToggle(h, d, !done)}
                        aria-label={`${h.name}, ${fmt(d)}: ${done ? 'tamamlandı' : 'tamamlanmadı'}`}
                        aria-pressed={done}
                        className={`w-8 h-8 rounded-lg border transition-colors ${future ? 'cursor-default opacity-30' : 'hover:border-text-secondary'} ${d === today ? 'border-text-tertiary' : 'border-transparent'}`}
                        style={{
                          backgroundColor: done ? h.color : 'rgb(var(--bg-input))',
                          opacity: future ? 0.3 : scheduled ? 1 : 0.4,
                        }}
                      >
                        {done && (
                          <svg viewBox="0 0 16 16" className="w-4 h-4 mx-auto" fill="none" aria-hidden="true">
                            <path d="M3.5 8.4l3.1 2.9 5.9-6.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

module.exports = { Heatmap, WeekGrid, fmt };
