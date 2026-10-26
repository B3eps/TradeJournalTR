const React = require('react');
const { useState } = React;
const { fmtMoney, monthShort } = require('./format');

// Plain SVG/CSS charts (no chart library).

const Donut = ({ slices, size = 168, thickness = 22, centerLabel, centerValue }) => {
  const total = slices.reduce((s, x) => s + x.amount, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const [hover, setHover] = useState(null);
  let offset = 0;
  const hv = hover != null ? slices[hover] : null;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Kategoriye göre harcama dağılımı">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--bg-input))" strokeWidth={thickness} />
        {total > 0 && slices.map((s, i) => {
          const len = (s.amount / total) * c;
          const el = (
            <circle key={s.key || i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={hover === i ? thickness + 4 : thickness}
              strokeDasharray={`${Math.max(0, len - (slices.length > 1 ? 1.5 : 0))} ${c}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-width 120ms' }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6 text-center">
        <span className="text-[10px] text-text-tertiary truncate max-w-full">{hv ? hv.name : centerLabel}</span>
        <span className="text-sm font-semibold text-text-primary tabular-nums">{hv ? fmtMoney(hv.amount, 'TRY', 0) : centerValue}</span>
      </div>
    </div>
  );
};

const MonthBars = ({ data, height = 150 }) => {
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  return (
    <div>
      <div className="flex items-end gap-2 sm:gap-3" style={{ height }} role="img" aria-label="Son 6 ay gelir ve gider">
        {data.map((d) => (
          <div key={d.month} className="flex-1 min-w-0 h-full flex items-end justify-center gap-1">
            <div className="w-full max-w-[18px] rounded-t bg-positive/80 transition-all" style={{ height: `${(d.income / max) * 100}%`, minHeight: d.income > 0 ? 2 : 0 }} title={`${monthShort(d.month)} gelir: ${fmtMoney(d.income)}`} />
            <div className="w-full max-w-[18px] rounded-t bg-negative/80 transition-all" style={{ height: `${(d.expense / max) * 100}%`, minHeight: d.expense > 0 ? 2 : 0 }} title={`${monthShort(d.month)} gider: ${fmtMoney(d.expense)}`} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 sm:gap-3 mt-2">
        {data.map((d) => <div key={d.month} className="flex-1 text-center text-[10px] text-text-tertiary">{monthShort(d.month)}</div>)}
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px] text-text-tertiary">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-positive/80" />Gelir</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-negative/80" />Gider</span>
      </div>
    </div>
  );
};

module.exports = { Donut, MonthBars };
