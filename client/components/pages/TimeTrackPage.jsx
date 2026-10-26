const React = require('react');
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const { motion } = require('framer-motion');
const helper = require('../../helper.js');
const { authFetch } = helper;
const Icons = require('../shared/Icons');
const {
  FadeIn, Stagger, StaggerItem, CountUp, HoverLift, ProgressRing, Bar, useAnimationsEnabled,
} = require('../ui/motion');
const { useSound } = require('../../utils/sound');

// =====================================================
// ZAMAN TAKİBİ (time tracking)
// Data: GET /api/timetrack/status, /api/timetrack/summary?from&to,
//       GET/PUT /api/timetrack/categories (local ActivityWatch at :5600)
// =====================================================

const POLL_MS = 60 * 1000;
const AW_ADDRESS = 'http://localhost:5600';
const OTHER_NAME = 'Diğer';

const PRESETS = [
  { id: 'today', label: 'Bugün' },
  { id: 'yesterday', label: 'Dün' },
  { id: '7d', label: '7 gün' },
  { id: '30d', label: '30 gün' },
  { id: 'custom', label: 'Özel' },
];

const FIELD_LABELS = {
  app: 'Uygulama adı',
  title: 'Pencere başlığı',
  domain: 'Site (alan adı)',
};

/* ── Helpers ─────────────────────────────────────────────── */

const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseKey = (k) => {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const shiftDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

const presetRange = (preset) => {
  const today = startOfToday();
  switch (preset) {
    case 'yesterday': { const y = shiftDays(today, -1); return { from: dateKey(y), to: dateKey(y) }; }
    case '7d': return { from: dateKey(shiftDays(today, -6)), to: dateKey(today) };
    case '30d': return { from: dateKey(shiftDays(today, -29)), to: dateKey(today) };
    default: return { from: dateKey(today), to: dateKey(today) };
  }
};

const daysBetween = (from, to) => Math.round((parseKey(to) - parseKey(from)) / 86400000) + 1;

/** "3 sa 12 dk", "45 dk", "30 sn" */
const fmtDur = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s === 0) return '0 dk';
  if (s < 60) return `${s} sn`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m} dk`;
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
};

const fmtClock = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

const fmtPct = (n) => `%${Math.round(n)}`;

const fmtRangeLabel = (from, to) => {
  const opts = { day: 'numeric', month: 'long' };
  const a = parseKey(from).toLocaleDateString('tr-TR', opts);
  if (from === to) return parseKey(from).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `${a} – ${parseKey(to).toLocaleDateString('tr-TR', opts)}`;
};

const hexToRgba = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(100,116,139,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const fetchJson = async (url, options) => {
  const res = await authFetch(url, options);
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
};

/* ── Small inline icons (not in shared Icons) ────────────── */

const svgProps = (props) => ({
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props,
});
const ClockIcon = (p) => (<svg {...svgProps(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const MonitorIcon = (p) => (<svg {...svgProps(p)}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>);
const AppIcon = (p) => (<svg {...svgProps(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>);
const GlobeIcon = (p) => (<svg {...svgProps(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>);
const WindowIcon = (p) => (<svg {...svgProps(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg>);

/* ── Layout primitives ───────────────────────────────────── */

const Card = ({ title, subtitle, icon, action, children, className = '' }) => (
  <div className={`bg-bg-surface border border-border rounded-2xl p-5 sm:p-6 ${className}`}>
    {(title || action) && (
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && (
            <div className="w-8 h-8 rounded-lg bg-bg-input flex items-center justify-center flex-shrink-0 text-text-secondary">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-text-primary font-semibold text-[15px] leading-tight">{title}</h3>
            {subtitle && <p className="text-text-tertiary text-xs mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
    )}
    {children}
  </div>
);

const EmptyNote = ({ children }) => (
  <div className="py-8 text-center text-text-tertiary text-sm">{children}</div>
);

const StatCard = ({ icon, label, children, sub, accent }) => (
  <HoverLift className="h-full bg-bg-surface border border-border rounded-2xl p-5">
    <div className="flex items-center justify-between mb-4">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: accent ? hexToRgba(accent, 0.14) : 'rgb(var(--bg-input))', color: accent || 'rgb(var(--text-secondary))' }}
      >
        {icon}
      </div>
    </div>
    <div className="text-text-tertiary text-xs font-medium uppercase tracking-wider">{label}</div>
    <div className="mt-1.5 text-text-primary text-2xl font-bold leading-tight min-w-0">{children}</div>
    {sub && <div className="mt-1.5 text-text-secondary text-xs">{sub}</div>}
  </HoverLift>
);

/* ── Charts ──────────────────────────────────────────────── */

// Segmented donut (each category a stroke segment), animates once on mount.
const CategoryDonut = ({ segments, total, size = 184, stroke = 22 }) => {
  const on = useAnimationsEnabled();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const visible = segments.filter((s) => s.sec > 0);
  const gap = visible.length > 1 ? Math.min(4, c * 0.01) : 0;
  let acc = 0;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label="Kategori dağılımı">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--bg-input))" strokeWidth={stroke} />
        {total > 0 && visible.map((s, i) => {
          const len = Math.max(0, (s.sec / total) * c - gap);
          const offset = -acc;
          acc += (s.sec / total) * c;
          return (
            <motion.circle
              key={s.name}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDashoffset={offset}
              initial={{ strokeDasharray: on ? `0 ${c}` : `${len} ${c}` }}
              animate={{ strokeDasharray: `${len} ${c}` }}
              transition={on ? { duration: 0.7, delay: 0.08 * i, ease: [0.22, 0.61, 0.36, 1] } : { duration: 0 }}
            >
              <title>{`${s.name}: ${fmtDur(s.sec)}`}</title>
            </motion.circle>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
        <span className="text-text-tertiary text-[11px] uppercase tracking-wider">Toplam</span>
        <span className="text-text-primary font-bold text-lg leading-tight">{fmtDur(total)}</span>
      </div>
    </div>
  );
};

// One-shot "grow" flag: false on first paint, true right after (instant when motion is off).
const useGrow = () => {
  const on = useAnimationsEnabled();
  const [grown, setGrown] = useState(!on);
  useEffect(() => {
    if (!on) { setGrown(true); return undefined; }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(id);
  }, [on]);
  return grown;
};

const DailyStackedChart = ({ daily, categories }) => {
  const grown = useGrow();
  const max = Math.max(1, ...daily.map((d) => d.activeSec || 0));
  const todayKey = dateKey(startOfToday());
  const dense = daily.length > 14;
  const order = categories.map((c) => c.name);
  const colorOf = Object.fromEntries(categories.map((c) => [c.name, c.color]));
  const ticks = [1, 0.5, 0];

  return (
    <div>
      <div className="flex gap-3">
        <div className="flex flex-col justify-between h-48 text-[10px] text-text-muted text-right w-12 flex-shrink-0 py-0.5">
          {ticks.map((t) => <span key={t}>{fmtDur(max * t)}</span>)}
        </div>
        <div className="relative flex-1 h-48">
          {ticks.map((t) => (
            <div key={t} className="absolute left-0 right-0 border-t border-dashed border-border/70" style={{ bottom: `${t * 100}%` }} />
          ))}
          <div className={`absolute inset-0 flex items-end ${dense ? 'gap-[3px]' : 'gap-2 sm:gap-3'}`}>
            {daily.map((d) => {
              const total = d.activeSec || 0;
              const catSum = Object.values(d.byCategory || {}).reduce((a, b) => a + b, 0) || 1;
              const h = (total / max) * 100;
              const tip = [`${parseKey(d.date).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}: ${fmtDur(total)}`]
                .concat(order.filter((n) => d.byCategory?.[n] > 0).map((n) => `${n}: ${fmtDur(d.byCategory[n])}`))
                .join('\n');
              return (
                <div key={d.date} className="flex-1 h-full flex items-end justify-center min-w-0" title={tip}>
                  <div
                    className="w-full max-w-[44px] rounded-md overflow-hidden flex flex-col-reverse transition-[height] duration-700 ease-out"
                    style={{ height: grown ? `${h}%` : '0%', minHeight: total > 0 && grown ? 3 : 0 }}
                  >
                    {order.filter((n) => d.byCategory?.[n] > 0).map((n) => (
                      <div
                        key={n}
                        style={{ height: `${(d.byCategory[n] / catSum) * 100}%`, backgroundColor: colorOf[n] || '#64748b' }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-2">
        <div className="w-12 flex-shrink-0" />
        <div className={`flex-1 flex ${dense ? 'gap-[3px]' : 'gap-2 sm:gap-3'}`}>
          {daily.map((d, i) => {
            const dt = parseKey(d.date);
            const show = !dense || i % 5 === 0 || i === daily.length - 1;
            return (
              <div key={d.date} className={`flex-1 min-w-0 text-center text-[10px] leading-tight ${d.date === todayKey ? 'text-accent font-semibold' : 'text-text-muted'}`}>
                {show && (
                  <>
                    {!dense && <div className="capitalize">{dt.toLocaleDateString('tr-TR', { weekday: 'short' })}</div>}
                    <div>{dense ? `${dt.getDate()}/${dt.getMonth() + 1}` : dt.getDate()}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const HourChart = ({ byHour, days }) => {
  const grown = useGrow();
  const hours = Array.from({ length: 24 }, (_, h) => (byHour.find((x) => x.hour === h) || { sec: 0 }).sec);
  const max = Math.max(1, ...hours);
  const nowHour = new Date().getHours();
  return (
    <div>
      <div className="flex items-end gap-[3px] sm:gap-1 h-40">
        {hours.map((sec, h) => {
          const ratio = sec / max;
          const avg = days > 1 ? ` (günlük ort. ${fmtDur(sec / days)})` : '';
          return (
            <div key={h} className="flex-1 h-full flex items-end min-w-0" title={`${pad2(h)}:00–${pad2((h + 1) % 24)}:00 · ${fmtDur(sec)}${avg}`}>
              <div
                className="w-full rounded-t-[4px] transition-[height] duration-700 ease-out"
                style={{
                  height: grown ? `${Math.max(sec > 0 ? 3 : 1.5, ratio * 100)}%` : '0%',
                  backgroundColor: sec > 0 ? `rgb(var(--accent) / ${0.25 + ratio * 0.75})` : 'rgb(var(--bg-input))',
                  transitionDelay: `${h * 12}ms`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] sm:gap-1 mt-2">
        {hours.map((_, h) => (
          <div key={h} className={`flex-1 min-w-0 text-center text-[10px] ${h === nowHour ? 'text-accent font-semibold' : 'text-text-muted'}`}>
            {h % 3 === 0 ? pad2(h) : ''}
          </div>
        ))}
      </div>
    </div>
  );
};

const RankList = ({ items, colorOf, emptyText, renderLabel }) => {
  if (!items.length) return <EmptyNote>{emptyText}</EmptyNote>;
  const max = Math.max(1, ...items.map((i) => i.sec));
  return (
    <Stagger className="space-y-3.5" stagger={0.03}>
      {items.map((item, i) => {
        const color = colorOf(item) || '#64748b';
        return (
          <StaggerItem key={`${i}-${item.key}`}>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                {renderLabel(item)}
              </div>
              <span className="text-text-secondary text-xs font-mono flex-shrink-0">{fmtDur(item.sec)}</span>
            </div>
            <Bar value={(item.sec / max) * 100} color={color} height={6} duration={0.6} />
          </StaggerItem>
        );
      })}
    </Stagger>
  );
};

/* ── Category editor ─────────────────────────────────────── */

const PALETTE = ['#22c55e', '#3b82f6', '#a855f7', '#f97316', '#06b6d4', '#eab308', '#ec4899', '#ef4444', '#14b8a6', '#64748b'];

const toDraft = (categories) => categories.map((c) => ({
  key: `c${c.id}-${Math.random().toString(36).slice(2, 7)}`,
  id: c.id,
  name: c.name,
  color: c.color,
  goal: c.goalMinPerDay ? String(c.goalMinPerDay) : '',
  app: c.rules.filter((r) => r.field === 'app').map((r) => r.pattern).join(', '),
  title: c.rules.filter((r) => r.field === 'title').map((r) => r.pattern).join(', '),
  domain: c.rules.filter((r) => r.field === 'domain').map((r) => r.pattern).join(', '),
}));

const fromDraft = (draft) => draft.map((d) => {
  const rules = [];
  ['app', 'title', 'domain'].forEach((field) => {
    String(d[field] || '').split(',').map((s) => s.trim()).filter(Boolean)
      .forEach((pattern) => rules.push({ field, pattern, flags: 'i' }));
  });
  const goal = String(d.goal).trim();
  return {
    id: d.id || undefined,
    name: d.name.trim(),
    color: d.color,
    rules,
    goalMinPerDay: goal === '' ? null : Number(goal),
  };
});

const CategoryEditor = ({ open, onClose, onSaved, play }) => {
  const [draft, setDraft] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchJson('/api/timetrack/categories')
      .then((data) => { if (!cancelled) setDraft(toDraft(data.categories || [])); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Kategoriler yüklenemedi.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelled = true; window.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!open) return null;

  const update = (key, patch) => setDraft((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (index, dir) => setDraft((list) => {
    const next = [...list];
    const j = index + dir;
    if (j < 0 || j >= next.length) return list;
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });
  const remove = (key) => { play('delete'); setDraft((list) => list.filter((d) => d.key !== key)); };
  const add = () => {
    play('pop');
    const key = `new-${Date.now()}`;
    setDraft((list) => {
      const color = PALETTE[list.length % PALETTE.length];
      const item = { key, id: null, name: 'Yeni kategori', color, goal: '', app: '', title: '', domain: '' };
      // Keep "Diğer" last
      const otherIdx = list.findIndex((d) => d.name === OTHER_NAME);
      if (otherIdx === -1) return [...list, item];
      return [...list.slice(0, otherIdx), item, ...list.slice(otherIdx)];
    });
    setExpanded(key);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = { categories: fromDraft(draft) };
      const data = await fetchJson('/api/timetrack/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      play('complete');
      onSaved(data.categories || []);
      onClose();
    } catch (e) {
      play('error');
      setError(e.message || 'Kaydedilemedi.');
    }
    setSaving(false);
  };

  const inputCls = 'w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/70';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Kategorileri düzenle">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <FadeIn y={0} className="relative w-full max-w-xl h-full bg-bg-surface border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-text-primary font-semibold text-lg">Kategoriler</h2>
            <p className="text-text-tertiary text-xs mt-0.5">Sıra önemlidir: ilk eşleşen kategori kazanır. Eşleşmeyenler "{OTHER_NAME}"e gider.</p>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-input" aria-label="Kapat">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-3">
          <div className="bg-bg-input/60 border border-border rounded-xl px-4 py-3 text-xs text-text-secondary leading-relaxed">
            Kuralları virgülle ayırın. Her kural büyük/küçük harf duyarsız bir düzenli ifadedir; düz bir kelime yazmanız yeterli
            (ör. <span className="font-mono text-text-primary">tradingview, binance</span>). Uygulama adı örnekleri:
            {' '}<span className="font-mono text-text-primary">msedge.exe, code.exe</span>.
          </div>

          {loading && <EmptyNote>Yükleniyor...</EmptyNote>}

          {!loading && draft.map((d, i) => {
            const isOpen = expanded === d.key;
            const ruleCount = ['app', 'title', 'domain'].reduce((n, f) => n + String(d[f]).split(',').filter((s) => s.trim()).length, 0);
            return (
              <div key={d.key} className="border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <input
                    type="color"
                    value={d.color}
                    onChange={(e) => update(d.key, { color: e.target.value })}
                    className="w-8 h-8 rounded-md bg-transparent border border-border cursor-pointer flex-shrink-0 p-0.5"
                    aria-label={`${d.name} rengi`}
                  />
                  <input
                    type="text"
                    value={d.name}
                    maxLength={40}
                    onChange={(e) => update(d.key, { name: e.target.value })}
                    className="flex-1 min-w-0 bg-transparent text-sm font-medium text-text-primary focus:outline-none px-1"
                    aria-label="Kategori adı"
                  />
                  <span className="hidden sm:inline text-[11px] text-text-muted flex-shrink-0">{ruleCount} kural</span>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-input disabled:opacity-30" aria-label="Yukarı taşı">
                    <Icons.ChevronUp className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-input disabled:opacity-30" aria-label="Aşağı taşı">
                    <Icons.ChevronDown className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setExpanded(isOpen ? null : d.key)} className="px-2 h-7 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-bg-input" aria-expanded={isOpen}>
                    {isOpen ? 'Kapat' : 'Düzenle'}
                  </button>
                  <button type="button" onClick={() => remove(d.key)} className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-negative hover:bg-negative/10" aria-label="Kategoriyi sil">
                    <Icons.Trash className="w-4 h-4" />
                  </button>
                </div>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border bg-bg-input/30">
                    {['app', 'title', 'domain'].map((field) => (
                      <label key={field} className="block">
                        <span className="block text-xs text-text-tertiary mb-1">{FIELD_LABELS[field]}</span>
                        <textarea
                          rows={2}
                          value={d[field]}
                          onChange={(e) => update(d.key, { [field]: e.target.value })}
                          placeholder={field === 'domain' ? 'youtube, netflix' : field === 'app' ? 'spotify, steam' : 'youtube, twitch'}
                          className={`${inputCls} font-mono text-xs resize-y`}
                        />
                      </label>
                    ))}
                    <label className="block">
                      <span className="block text-xs text-text-tertiary mb-1">Günlük hedef (dakika, boş bırakılabilir)</span>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        value={d.goal}
                        onChange={(e) => update(d.key, { goal: e.target.value })}
                        placeholder="ör. 120"
                        className={`${inputCls} w-40`}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}

          {!loading && (
            <button type="button" onClick={add} className="w-full flex items-center justify-center gap-2 border border-dashed border-border rounded-xl py-3 text-sm text-text-secondary hover:text-text-primary hover:border-accent/60 transition-colors">
              <Icons.Plus className="w-4 h-4" /> Kategori ekle
            </button>
          )}
        </div>

        <div className="border-t border-border px-5 sm:px-6 py-4 space-y-3">
          {error && (
            <div className="flex items-start gap-2 bg-negative/10 border border-negative/30 rounded-lg px-3 py-2 text-negative text-xs">
              <Icons.AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary bg-bg-input border border-border">
              Vazgeç
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || loading || draft.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-text hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </FadeIn>
    </div>
  );
};

/* ── Unavailable state ───────────────────────────────────── */

const Unavailable = ({ message, onRetry, retrying, onStart, starting, startError }) => (
  <FadeIn>
    <div className="bg-bg-surface border border-border rounded-2xl p-8 sm:p-10 text-center max-w-2xl mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-warning/15 text-warning flex items-center justify-center mx-auto mb-4">
        <ClockIcon className="w-7 h-7" />
      </div>
      <h2 className="text-text-primary text-lg font-semibold">ActivityWatch'a bağlanılamadı</h2>
      <p className="text-text-secondary text-sm mt-2 leading-relaxed">
        Zaman takibi ActivityWatch ile çalışır. Bu kurulumda ActivityWatch uygulamaya dahildir ve isterseniz buradan başlatabilirsiniz.
      </p>
      <p className="font-mono text-accent text-sm mt-2">{AW_ADDRESS}</p>
      {message && <p className="text-text-tertiary text-xs mt-2">{message}</p>}
      <div className="mt-5 rounded-xl border border-warning/30 bg-warning/5 p-4 text-left text-xs text-text-secondary">
        Başlatınca bilgisayarınızdaki etkin uygulama ve pencere başlıkları, ayrıca uyumlu tarayıcılarda açık site adresleri bu bilgisayarda kaydedilir. Veriler ActivityWatch’ın yerel veritabanında kalır; uygulamanın sunucusuna gönderilmez. İstediğiniz zaman ActivityWatch tepsi menüsünden çıkabilirsiniz.
      </div>
      <ul className="text-left text-sm text-text-secondary mt-6 space-y-2 bg-bg-input/50 border border-border rounded-xl p-4">
        <li>• ActivityWatch yalnızca aşağıdaki başlat düğmesine bastığınızda çalışır.</li>
        <li>• Web sitesi ayrıntıları için tarayıcı eklentisi ayrıca gerekir.</li>
        <li>• Uygulamaya sonraki girişlerde otomatik başlatma tercihi bu bilgisayarda saklanır.</li>
      </ul>
      {startError && <p role="alert" className="mt-3 text-sm text-negative">{startError}</p>}
      <button type="button" onClick={onStart} disabled={starting} className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-accent-text text-sm font-semibold hover:brightness-110 disabled:opacity-50">
        {starting ? 'ActivityWatch başlatılıyor…' : 'Bilgisayarımda zaman takibini başlat'}
      </button>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-accent-text text-sm font-semibold hover:brightness-110"
      >
        <Icons.RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} /> Tekrar dene
      </button>
    </div>
  </FadeIn>
);

const SkeletonGrid = () => (
  <div className="space-y-6 animate-pulse">
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-36 bg-bg-surface border border-border rounded-2xl" />)}
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="h-80 bg-bg-surface border border-border rounded-2xl" />
      <div className="h-80 bg-bg-surface border border-border rounded-2xl xl:col-span-2" />
    </div>
  </div>
);

/* ── Page ────────────────────────────────────────────────── */

const TimeTrackPage = () => {
  const { play } = useSound();
  const [preset, setPreset] = useState('today');
  const [range, setRange] = useState(() => presetRange('today'));
  const [customDraft, setCustomDraft] = useState(() => presetRange('7d'));
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startingTracker, setStartingTracker] = useState(false);
  const [trackerStartError, setTrackerStartError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const reqId = useRef(0);

  const days = daysBetween(range.from, range.to);
  const trendRange = useMemo(() => {
    if (days >= 7) return null;
    return { from: dateKey(shiftDays(parseKey(range.to), -6)), to: range.to };
  }, [range.from, range.to, days]);

  const load = useCallback(async (opts = {}) => {
    const id = ++reqId.current;
    if (opts.manual) setRefreshing(true);
    try {
      const qs = `from=${range.from}&to=${range.to}`;
      const [st, sum, tr] = await Promise.all([
        fetchJson('/api/timetrack/status').catch(() => ({ available: false })),
        fetchJson(`/api/timetrack/summary?${qs}`).catch((e) => ({ available: false, message: e.message })),
        trendRange
          ? fetchJson(`/api/timetrack/summary?from=${trendRange.from}&to=${trendRange.to}`).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (id !== reqId.current) return;
      setStatus(st);
      setSummary(sum);
      setTrend(tr);
    } finally {
      if (id === reqId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [range.from, range.to, trendRange]);

  const enableActivityWatch = async () => {
    setStartingTracker(true); setTrackerStartError('');
    try {
      await fetchJson('/api/timetrack/start', { method: 'POST' });
      await load({ manual: true });
    } catch (err) {
      setTrackerStartError(err.message || 'ActivityWatch başlatılamadı.');
    } finally { setStartingTracker(false); }
  };

  const disableActivityWatchAutoStart = async () => {
    try {
      await fetchJson('/api/timetrack/disable-autostart', { method: 'POST' });
      setStatus((current) => ({ ...(current || {}), autoStart: false }));
    } catch (err) { setTrackerStartError(err.message || 'Otomatik başlatma kapatılamadı.'); }
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load();
    }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const choosePreset = (id) => {
    play('click');
    setPreset(id);
    if (id === 'custom') {
      setRange({ ...customDraft });
    } else {
      setRange(presetRange(id));
    }
  };

  const updateCustom = (patch) => {
    const next = { ...customDraft, ...patch };
    if (next.from > next.to) {
      if (patch.from) next.to = next.from; else next.from = next.to;
    }
    setCustomDraft(next);
    setRange(next);
  };

  const available = !!(summary && summary.available);
  const connected = !!(status && status.available);
  const todayKey = dateKey(startOfToday());

  // Derived data
  const categories = (summary && summary.byCategory) || [];
  const colorOf = useMemo(() => Object.fromEntries(categories.map((c) => [c.name, c.color])), [categories]);
  const catTotal = categories.reduce((a, c) => a + c.sec, 0);
  const sortedCats = [...categories].filter((c) => c.sec > 0).sort((a, b) => b.sec - a.sec);
  const goalCats = categories.filter((c) => c.goalMinPerDay);
  const goalPct = goalCats.length
    ? (goalCats.reduce((a, c) => a + Math.min(1, c.sec / (c.goalMinPerDay * 60 * days)), 0) / goalCats.length) * 100
    : null;
  const topApp = summary && summary.byApp && summary.byApp[0];
  const total = (summary && summary.totalActiveSec) || 0;
  const notAfk = (summary && summary.notAfkSec) || 0;
  const afk = (summary && summary.afkSec) || 0;
  const screenRatio = notAfk + afk > 0 ? (notAfk / (notAfk + afk)) * 100 : 0;
  const dailySource = trendRange ? (trend && trend.available ? trend.daily : (summary && summary.daily) || []) : (summary && summary.daily) || [];
  const peakHour = summary && summary.byHour && summary.byHour.reduce((best, h) => (h.sec > (best ? best.sec : 0) ? h : best), null);
  const hasWeb = !!((summary && summary.hasWebWatcher) || (status && status.hasWebWatcher));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-text-primary">Zaman Takibi</h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${
                status == null ? 'border-border text-text-tertiary'
                  : connected ? 'border-positive/30 bg-positive/10 text-positive' : 'border-negative/30 bg-negative/10 text-negative'
              }`}
              title={connected && status.version ? `ActivityWatch ${status.version}${status.hostname ? ` · ${status.hostname}` : ''}` : AW_ADDRESS}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${status == null ? 'bg-text-muted' : connected ? 'bg-positive' : 'bg-negative'} ${connected ? 'animate-pulse' : ''}`} />
              {status == null ? 'Kontrol ediliyor' : connected ? 'ActivityWatch bağlı' : 'ActivityWatch bağlı değil'}
            </span>
            {connected && status.autoStart && <button type="button" onClick={disableActivityWatchAutoStart} className="text-[11px] text-text-tertiary hover:text-text-primary underline">Uygulamayla otomatik başlatmayı kapat</button>}
          </div>
          <p className="text-text-secondary text-sm mt-1">
            {(() => { const l = fmtRangeLabel(range.from, range.to); return l.charAt(0).toLocaleUpperCase('tr-TR') + l.slice(1); })()}
            {available && summary.firstActiveAt && <> · İlk etkinlik {fmtClock(summary.firstActiveAt)}, son {fmtClock(summary.lastActiveAt)}</>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap bg-bg-surface border border-border rounded-xl p-1 gap-1" role="tablist" aria-label="Tarih aralığı">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={preset === p.id}
                onClick={() => choosePreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  preset === p.id ? 'bg-accent text-accent-text' : 'text-text-secondary hover:text-text-primary hover:bg-bg-input'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { play('click'); setEditorOpen(true); }}
            className="flex items-center gap-2 px-3 py-2 text-xs rounded-xl bg-bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-accent/60 transition-colors"
          >
            <Icons.Tag className="w-3.5 h-3.5" /> Kategoriler
          </button>
          <button
            type="button"
            onClick={() => { play('click'); load({ manual: true }); }}
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-accent/60 transition-colors"
            title="Yenile"
            aria-label="Yenile"
          >
            <Icons.RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {preset === 'custom' && (
        <FadeIn className="flex flex-wrap items-center gap-3 bg-bg-surface border border-border rounded-xl px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-text-tertiary">
            Başlangıç
            <input type="date" value={customDraft.from} max={todayKey} onChange={(e) => e.target.value && updateCustom({ from: e.target.value })}
              className="bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent/70" />
          </label>
          <label className="flex items-center gap-2 text-xs text-text-tertiary">
            Bitiş
            <input type="date" value={customDraft.to} max={todayKey} onChange={(e) => e.target.value && updateCustom({ to: e.target.value })}
              className="bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent/70" />
          </label>
          <span className="text-xs text-text-muted">{days} gün · en fazla 92 gün</span>
        </FadeIn>
      )}

      {loading && !summary ? (
        <SkeletonGrid />
      ) : !available ? (
        <Unavailable message={summary && summary.reason !== 'unreachable' ? summary.message : ''} onRetry={() => load({ manual: true })} retrying={refreshing} onStart={enableActivityWatch} starting={startingTracker} startError={trackerStartError} />
      ) : (
        <>
          {/* Stat cards */}
          <Stagger className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" stagger={0.06}>
            <StaggerItem className="h-full">
              <StatCard icon={<ClockIcon className="w-5 h-5" />} label="Aktif süre" accent="#22c55e"
                sub={days > 1 ? `Günlük ortalama ${fmtDur(total / days)}` : (summary.lastActiveAt ? `Son etkinlik ${fmtClock(summary.lastActiveAt)}` : 'Henüz etkinlik yok')}>
                <CountUp value={total} format={fmtDur} duration={700} />
              </StatCard>
            </StaggerItem>
            <StaggerItem className="h-full">
              <StatCard icon={<MonitorIcon className="w-5 h-5" />} label="Ekran başında / AFK" accent="#3b82f6"
                sub={
                  <div className="space-y-1.5">
                    <Bar value={screenRatio} color="#3b82f6" height={5} />
                    <div>Uzakta (AFK): <span className="text-text-primary">{fmtDur(afk)}</span></div>
                  </div>
                }>
                <CountUp value={notAfk} format={fmtDur} duration={700} />
              </StatCard>
            </StaggerItem>
            <StaggerItem className="h-full">
              <StatCard icon={<AppIcon className="w-5 h-5" />} label="En çok kullanılan" accent={(topApp && colorOf[topApp.category]) || '#a855f7'}
                sub={topApp ? `${fmtDur(topApp.sec)} · aktif sürenin ${fmtPct(total ? (topApp.sec / total) * 100 : 0)}'i` : 'Veri yok'}>
                <span className="block truncate" title={topApp ? topApp.app : ''}>{topApp ? topApp.app : '—'}</span>
              </StatCard>
            </StaggerItem>
            <StaggerItem className="h-full">
              <StatCard icon={<Icons.Target className="w-5 h-5" />} label="Hedef tamamlama" accent="#f97316"
                sub={goalCats.length
                  ? `${goalCats.length} kategoride günlük hedef`
                  : <button type="button" onClick={() => setEditorOpen(true)} className="text-accent hover:underline">Kategorilere hedef ekleyin</button>}>
                {goalPct == null ? <span className="text-text-muted">—</span> : (
                  <div className="flex items-center gap-3">
                    <CountUp value={goalPct} format={(n) => fmtPct(n)} duration={700} />
                    <ProgressRing value={goalPct} size={34} stroke={4} color="#f97316" />
                  </div>
                )}
              </StatCard>
            </StaggerItem>
          </Stagger>

          {/* Category split + daily */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <FadeIn delay={0.05} className="xl:col-span-2 h-full">
              <Card title="Kategori dağılımı" subtitle={goalCats.length ? 'Hedefler günlük dakika üzerinden' : 'Kategorilere göre aktif süre'}
                icon={<Icons.Layers className="w-4 h-4" />} className="h-full">
                {catTotal === 0 ? <EmptyNote>Bu aralıkta kayıtlı etkinlik yok.</EmptyNote> : (
                  <div className="flex flex-col sm:flex-row xl:flex-col 2xl:flex-row items-center gap-6">
                    <CategoryDonut segments={sortedCats} total={catTotal} />
                    <div className="w-full min-w-0 space-y-3">
                      {sortedCats.map((c) => (
                        <div key={c.name} className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: c.color }} />
                            <span className="text-text-primary truncate">{c.name}</span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-text-secondary text-xs font-mono">{fmtDur(c.sec)}</span>
                            <span className="text-text-muted text-xs w-10 text-right">{fmtPct((c.sec / catTotal) * 100)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {goalCats.length > 0 && (
                  <div className="mt-6 pt-5 border-t border-border space-y-4">
                    <div className="text-text-tertiary text-xs font-medium uppercase tracking-wider">Günlük hedefler</div>
                    {goalCats.map((c) => {
                      const perDay = c.sec / days;
                      const pct = (perDay / (c.goalMinPerDay * 60)) * 100;
                      return (
                        <div key={c.name}>
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-text-primary">{c.name}</span>
                            <span className={pct >= 100 ? 'text-positive font-medium' : 'text-text-secondary'}>
                              {fmtDur(perDay)} / {fmtDur(c.goalMinPerDay * 60)}{days > 1 ? ' (gün ort.)' : ''} · {fmtPct(Math.min(999, pct))}
                            </span>
                          </div>
                          <Bar value={pct} color={c.color} height={7} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </FadeIn>

            <FadeIn delay={0.1} className="xl:col-span-3 h-full">
              <Card title="Günlük aktif süre" subtitle={trendRange ? 'Son 7 gün, kategorilere göre' : 'Seçili aralık, kategorilere göre'}
                icon={<Icons.BarChart className="w-4 h-4" />} className="h-full">
                {dailySource.every((d) => !d.activeSec) ? <EmptyNote>Bu aralıkta kayıtlı etkinlik yok.</EmptyNote> : (
                  <DailyStackedChart key={`${dailySource.length}-${dailySource[0] && dailySource[0].date}`} daily={dailySource} categories={categories} />
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4">
                  {categories.map((c) => (
                    <span key={c.name} className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary">
                      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: c.color }} />{c.name}
                    </span>
                  ))}
                </div>
              </Card>
            </FadeIn>
          </div>

          {/* Focus hours */}
          <FadeIn delay={0.12}>
            <Card
              title="Odak saatleri"
              subtitle={days > 1 ? `${days} günün toplamı, saat dilimine göre` : 'Saat dilimine göre aktif süre'}
              icon={<ClockIcon className="w-4 h-4" />}
              action={peakHour && peakHour.sec > 0 ? (
                <span className="text-xs text-text-secondary bg-bg-input border border-border rounded-lg px-2.5 py-1">
                  En yoğun: <span className="text-text-primary font-medium">{pad2(peakHour.hour)}:00–{pad2((peakHour.hour + 1) % 24)}:00</span>
                </span>
              ) : null}
            >
              <HourChart key={`${range.from}-${range.to}`} byHour={summary.byHour || []} days={days} />
            </Card>
          </FadeIn>

          {/* Apps + titles */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FadeIn delay={0.14} className="h-full">
              <Card title="En çok kullanılan uygulamalar" subtitle="AFK dışı süre" icon={<AppIcon className="w-4 h-4" />} className="h-full">
                <RankList
                  key={`apps-${range.from}-${range.to}`}
                  items={(summary.byApp || []).map((a) => ({ ...a, key: a.app }))}
                  colorOf={(a) => colorOf[a.category]}
                  emptyText="Henüz uygulama verisi yok."
                  renderLabel={(a) => (
                    <span className="min-w-0 flex items-baseline gap-2">
                      <span className="text-sm text-text-primary truncate">{a.app}</span>
                      <span className="text-[11px] text-text-muted flex-shrink-0">{a.category}</span>
                    </span>
                  )}
                />
              </Card>
            </FadeIn>
            <FadeIn delay={0.16} className="h-full">
              <Card title="Pencere başlıkları" subtitle="En uzun süre açık kalan sayfa ve pencereler" icon={<WindowIcon className="w-4 h-4" />} className="h-full">
                <RankList
                  key={`titles-${range.from}-${range.to}`}
                  items={(summary.byTitle || []).map((t) => ({ ...t, key: `${t.app}-${t.title}` }))}
                  colorOf={(t) => colorOf[t.category]}
                  emptyText="Henüz pencere verisi yok."
                  renderLabel={(t) => (
                    <span className="min-w-0">
                      <span className="block text-sm text-text-primary truncate" title={t.title}>{t.title}</span>
                      <span className="block text-[11px] text-text-muted truncate">{t.app}</span>
                    </span>
                  )}
                />
              </Card>
            </FadeIn>
          </div>

          {/* Sites */}
          <FadeIn delay={0.18}>
            {(summary.topSites || []).length > 0 ? (
              <Card title="Siteler" subtitle="Tarayıcıda etkin sekme süresi" icon={<GlobeIcon className="w-4 h-4" />}>
                <RankList
                  key={`sites-${range.from}-${range.to}`}
                  items={summary.topSites.map((s) => ({ ...s, key: s.domain }))}
                  colorOf={(s) => colorOf[s.category]}
                  emptyText=""
                  renderLabel={(s) => (
                    <span className="min-w-0 flex items-baseline gap-2">
                      <span className="text-sm text-text-primary truncate font-mono">{s.domain}</span>
                      <span className="text-[11px] text-text-muted flex-shrink-0">{s.category}</span>
                    </span>
                  )}
                />
              </Card>
            ) : (
              <Card title="Siteler" icon={<GlobeIcon className="w-4 h-4" />}>
                {hasWeb ? (
                  <EmptyNote>Bu aralıkta site verisi yok.</EmptyNote>
                ) : (
                  <div className="flex items-start gap-3 bg-info/10 border border-info/30 rounded-xl px-4 py-3 text-sm text-text-secondary">
                    <Icons.AlertTriangle className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-text-primary font-medium">Web izleyici kurulu değil</p>
                      <p className="mt-0.5">
                        Site bazlı süre için tarayıcınıza ActivityWatch Web Watcher eklentisini kurun
                        (Chrome/Edge ve Firefox eklenti mağazalarında "ActivityWatch Web Watcher").
                        Şimdilik tarayıcı süresi pencere başlıklarından hesaplanıyor.
                      </p>
                    </div>
                  </div>
                )}
              </Card>
            )}
          </FadeIn>

          <p className="text-text-muted text-xs">
            Kaynak: ActivityWatch ({AW_ADDRESS}){status && status.version ? ` ${status.version}` : ''}. Veriler her dakika yenilenir;
            yalnızca klavye/fare etkinliği olan (AFK dışı) süreler sayılır.
            {summary.generatedAt ? ` Son güncelleme ${fmtClock(summary.generatedAt)}.` : ''}
          </p>
        </>
      )}

      <CategoryEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => load()}
        play={play}
      />
    </div>
  );
};

module.exports = TimeTrackPage;
