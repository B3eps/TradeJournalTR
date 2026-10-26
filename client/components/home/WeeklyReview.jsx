// Haftalık gözden geçirme: auto-open on Sundays, otherwise behind a small link.
const React = require('react');
const { useState } = React;
const { request, dateKey, weekStart, localToday } = require('./api');
const { useResource } = require('./hooks');
const { Card, Skeleton, Btn, fmtDur, fmtMoney, plColor, normalizeDaily } = require('./ui');
const { getTradePL } = require('../../utils/analytics');

const STEPS = [
  'Geçen haftanın görevlerini gözden geçir, yarım kalanları ya taşı ya sil',
  'İşlem günlüğünü oku: kurallara uyduğun ve uymadığın işlemleri işaretle',
  'Bu haftanın en önemli dersini tek cümleyle yaz',
  'Kart ve not birikimini temizle, gelen kutusunu sıfırla',
  'Önümüzdeki haftanın takvimine bak: yüksek etkili veriler ve toplantılar',
  'Gelecek haftanın 3 ana önceliğini belirle',
];

const fetchWeek = async () => {
  const ws = weekStart();
  const from = dateKey(ws);
  const to = localToday();
  const days = Math.max(1, Math.round((Date.now() - ws.getTime()) / 86400000) + 1);
  const [stats, time, cards] = await Promise.all([
    request('GET', `/api/tasks/stats?days=${days}&today=${to}`).catch(() => null),
    request('GET', `/api/timetrack/summary?from=${from}&to=${to}`).catch(() => null),
    request('GET', '/api/cards/stats').catch(() => null),
  ]);
  return { stats, time, cards, days };
};

const Stat = ({ label, value, tone }) => (
  <div className="bg-bg-input rounded-xl px-3 py-2.5">
    <div className="text-[11px] text-text-tertiary">{label}</div>
    <div className={`text-base font-bold tabular-nums ${tone || 'text-text-primary'}`}>{value}</div>
  </div>
);

const WeeklyReview = ({ trades }) => {
  const isSunday = new Date().getDay() === 0;
  const [open, setOpen] = useState(isSunday);
  const [checked, setChecked] = useState({});
  const { data, loading } = useResource(fetchWeek, 5 * 60000);

  if (!open) {
    return (
      <div className="flex justify-center">
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-text-tertiary hover:text-accent transition-colors">
          Haftalık gözden geçirmeyi aç
        </button>
      </div>
    );
  }

  const ws = weekStart().getTime();
  const weekTrades = (Array.isArray(trades) ? trades : []).filter((t) => {
    const ms = new Date(t.exitTime || t.enterTime).getTime();
    return !isNaN(ms) && ms >= ws;
  });
  let weekPL = 0;
  weekTrades.forEach((t) => { try { const v = getTradePL(t); if (Number.isFinite(v)) weekPL += v; } catch (e) { /* ignore */ } });

  const completed = data && data.stats ? normalizeDaily(data.stats.completedByDay, data.days).reduce((a, b) => a + b, 0) : null;
  const focusSec = data && data.time && data.time.available !== false ? Number(data.time.totalActiveSec) || 0 : null;
  const reviewed = data && data.cards ? Number(data.cards.reviewedToday) || 0 : null;

  return (
    <Card title="Haftalık gözden geçirme" icon="review" right={!isSunday ? <button type="button" onClick={() => setOpen(false)} className="text-xs text-text-tertiary hover:text-text-primary">Gizle</button> : null} delay={0.4}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? <div className="col-span-full"><Skeleton rows={2} /></div> : (
          <>
            <Stat label="Tamamlanan görev" value={completed == null ? '-' : completed} />
            <Stat label="Odak süresi" value={focusSec == null ? '-' : fmtDur(focusSec)} />
            <Stat label="İşlem / P/L" value={<>{weekTrades.length} <span className={`font-mono ${plColor(weekPL)}`}>{fmtMoney(weekPL)}</span></>} />
            <Stat label="Çalışılan kart (bugün)" value={reviewed == null ? '-' : reviewed} />
          </>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {STEPS.map((s, i) => (
          <li key={i}>
            <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
              <input type="checkbox" className="mt-1 accent-[rgb(var(--accent))]" checked={!!checked[i]} onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))} />
              <span className={checked[i] ? 'text-text-tertiary line-through' : 'text-text-primary'}>{s}</span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
};

module.exports = WeeklyReview;
