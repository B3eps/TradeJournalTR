// Shared building blocks for the home page widgets.
const React = require('react');
const { FadeIn } = require('../ui/motion');

const ICONS = {
  check: 'M4 12.5l5 5L20 6.5',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  chart: 'M4 19V5M4 19h16M8 15l3-4 3 3 5-7',
  news: 'M5 5h12a2 2 0 012 2v12H7a2 2 0 01-2-2V5zM9 9h6M9 13h6',
  cards: 'M4 8l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  note: 'M7 3h8l4 4v14H7V3zM15 3v4h4M10 12h6M10 16h6',
  habit: 'M12 3c3 3 5 5.5 5 9a5 5 0 11-10 0c0-1.8.8-3 2-4 .2 1.5 1 2.3 2 2.5C11 8.5 11 5.5 12 3z',
  review: 'M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9',
  plus: 'M12 5v14M5 12h14',
  play: 'M8 5v14l11-7L8 5z',
  stop: 'M7 7h10v10H7z',
  arrow: 'M9 6l6 6-6 6',
  trade: 'M3 17l5-5 4 4 8-9M15 7h5v5',
};

const Icon = ({ name, className = 'w-4 h-4', fill }) => (
  <svg viewBox="0 0 24 24" className={className} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICONS[name] || ICONS.check} />
  </svg>
);

const Card = ({ title, icon, onMore, moreLabel = 'Tümünü gör', right, children, className = '', delay = 0 }) => (
  <FadeIn delay={delay} className={`bg-bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 min-w-0 ${className}`}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-7 h-7 rounded-lg bg-bg-input text-text-secondary inline-flex items-center justify-center flex-shrink-0">
          <Icon name={icon} className="w-4 h-4" />
        </span>
        <h2 className="text-sm font-semibold text-text-primary truncate">{title}</h2>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {right}
        {onMore && (
          <button type="button" onClick={onMore} className="text-xs text-text-tertiary hover:text-accent transition-colors inline-flex items-center gap-0.5">
            {moreLabel}<Icon name="arrow" className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
    {children}
  </FadeIn>
);

const Skeleton = ({ rows = 3 }) => (
  <div className="flex flex-col gap-2.5 animate-pulse" aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-4 rounded bg-bg-input" style={{ width: `${90 - i * 14}%` }} />
    ))}
  </div>
);

const ErrorNote = ({ message, onRetry }) => (
  <div className="text-xs text-text-tertiary flex items-center justify-between gap-3 bg-bg-input rounded-lg px-3 py-2">
    <span className="truncate">{message || 'Veri alınamadı.'}</span>
    {onRetry && <button type="button" onClick={onRetry} className="text-accent hover:underline flex-shrink-0">Tekrar dene</button>}
  </div>
);

const Empty = ({ children }) => <div className="text-xs text-text-tertiary py-2">{children}</div>;

const Btn = ({ children, onClick, primary, className = '', disabled, title }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
      primary ? 'bg-accent text-accent-text border-accent hover:opacity-90' : 'bg-bg-input text-text-primary border-border hover:border-text-tertiary'
    } ${className}`}
  >
    {children}
  </button>
);

const Badge = ({ children, tone = 'neutral' }) => {
  const tones = {
    neutral: 'bg-bg-input text-text-secondary border-border',
    red: 'bg-negative/15 text-negative border-negative/30',
    green: 'bg-positive/15 text-positive border-positive/30',
    blue: 'bg-info/15 text-info border-info/30',
    amber: 'bg-warning/15 text-warning border-warning/30',
  };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${tones[tone] || tones.neutral}`}>{children}</span>;
};

// Mini bar chart; values array of numbers, last bar highlighted.
const MiniBars = ({ values, height = 40, color = 'rgb(var(--accent))' }) => {
  const vals = (values || []).map((v) => Number(v) || 0);
  const max = Math.max(1, ...vals);
  const n = Math.max(1, vals.length);
  const w = 100 / n;
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      {vals.map((v, i) => {
        const h = Math.max(v > 0 ? 3 : 1.5, (v / max) * (height - 2));
        return <rect key={i} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx="1" fill={color} opacity={i === n - 1 ? 1 : v > 0 ? 0.55 : 0.2} />;
      })}
    </svg>
  );
};

// Line sparkline with soft area.
const Sparkline = ({ values, height = 44, positive = true }) => {
  const vals = (values || []).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return <div className="text-[11px] text-text-tertiary" style={{ height }}>Yeterli veri yok</div>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 100, 4 + (1 - (v - min) / span) * (height - 8)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  const color = positive ? 'rgb(var(--positive))' : 'rgb(var(--negative))';
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      <path d={`${line} L100 ${height} L0 ${height} Z`} fill={color} opacity="0.1" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// Donut from [{value,color}].
const Donut = ({ parts, size = 84, stroke = 12, children }) => {
  const total = parts.reduce((s, p) => s + (p.value > 0 ? p.value : 0), 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="relative inline-flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--border))" strokeWidth={stroke} />
        {total > 0 && parts.map((p, i) => {
          if (!(p.value > 0)) return null;
          const len = (p.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-acc} />
          );
          acc += len;
          return el;
        })}
      </svg>
      {children != null && <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-text-primary">{children}</div>}
    </div>
  );
};

// ── formatters ──
const fmtDur = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} sa ${m} dk`;
  if (m > 0) return `${m} dk`;
  return `${s} sn`;
};
const fmtClock = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
};
const fmtMoney = (n) => {
  const v = Number(n) || 0;
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const plColor = (n) => (n > 0 ? 'text-positive' : n < 0 ? 'text-negative' : 'text-text-secondary');

// Accepts array of numbers, array of {date,count|completed|value}, or {date:count} map.
const normalizeDaily = (raw, days, endDate = new Date()) => {
  const out = new Array(days).fill(0);
  if (!raw) return out;
  if (Array.isArray(raw)) {
    if (raw.length && typeof raw[0] === 'object' && raw[0] !== null) {
      const map = {};
      raw.forEach((r) => {
        const k = r.date || r.day;
        if (k) map[String(k).slice(0, 10)] = Number(r.count != null ? r.count : r.completed != null ? r.completed : r.value) || 0;
      });
      return normalizeDaily(map, days, endDate);
    }
    const arr = raw.map((v) => Number(v) || 0).slice(-days);
    return new Array(days - arr.length).fill(0).concat(arr);
  }
  const p = (n) => String(n).padStart(2, '0');
  for (let i = 0; i < days; i++) {
    const d = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - (days - 1 - i));
    out[i] = Number(raw[`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`]) || 0;
  }
  return out;
};

module.exports = { Icon, Card, Skeleton, ErrorNote, Empty, Btn, Badge, MiniBars, Sparkline, Donut, fmtDur, fmtClock, fmtMoney, plColor, normalizeDaily };
