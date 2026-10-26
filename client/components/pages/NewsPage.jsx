const React = require('react');
const { useState, useEffect, useMemo } = React;
const helper = require('../../helper.js');
const { authFetch } = helper;
const Icons = require('../shared/Icons');

// =====================================================
// NEWS / ECONOMIC CALENDAR PAGE
// Data: GET /api/news/calendar (server-side cached Forex Factory weekly feed)
// =====================================================

const REFRESH_MS = 15 * 60 * 1000;
const FILTER_STORAGE_KEY = 'news-calendar-filters';

const IMPACTS = [
  { id: 'High', label: 'Yüksek', badge: 'bg-negative/15 text-negative border-negative/30', dot: 'bg-negative' },
  { id: 'Medium', label: 'Orta', badge: 'bg-warning/15 text-warning border-warning/30', dot: 'bg-warning' },
  { id: 'Low', label: 'Düşük', badge: 'bg-bg-input text-text-tertiary border-border', dot: 'bg-text-muted' },
  { id: 'Holiday', label: 'Tatil', badge: 'bg-info/15 text-info border-info/30', dot: 'bg-info' },
];
const IMPACT_MAP = IMPACTS.reduce((acc, i) => { acc[i.id] = i; return acc; }, {});

const loadFilters = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY));
    if (saved && Array.isArray(saved.impacts) && Array.isArray(saved.currencies)) return saved;
  } catch {}
  return { impacts: ['High', 'Medium', 'Low', 'Holiday'], currencies: [], hidePast: false };
};

const saveFilters = (filters) => {
  try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters)); } catch {}
};

const pad2 = (n) => String(n).padStart(2, '0');

// Countdown as HH:MM (hours may exceed 24), with seconds in the last hour
const formatCountdown = (ms) => {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h === 0 ? `${pad2(m)}:${pad2(s)} dk` : `${pad2(h)}:${pad2(m)}`;
};

const formatTime = (date) => date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const formatDay = (date) => date.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const NewsPage = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [stale, setStale] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [filters, setFiltersState] = useState(loadFilters);

  const setFilters = (next) => {
    setFiltersState(next);
    saveFilters(next);
  };

  const loadCalendar = async () => {
    try {
      const response = await authFetch('/api/news/calendar');
      const data = await response.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
      setFetchError(!!data.error);
      setStale(!!data.stale);
      setFetchedAt(data.fetchedAt || null);
    } catch (err) {
      console.error('Failed to fetch economic calendar:', err);
      setFetchError(true);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCalendar();
    const refresh = setInterval(loadCalendar, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, []);

  const parsedEvents = useMemo(() => events
    .map((e, idx) => ({ ...e, idx, ts: new Date(e.date).getTime() }))
    .filter(e => !isNaN(e.ts)), [events]);

  const currencies = useMemo(() => [...new Set(parsedEvents.map(e => e.country).filter(Boolean))].sort(), [parsedEvents]);

  const matchesFilters = (e) =>
    filters.impacts.includes(e.impact) &&
    (filters.currencies.length === 0 || filters.currencies.includes(e.country));

  const visibleEvents = parsedEvents.filter(e => matchesFilters(e) && (!filters.hidePast || e.ts >= now));

  // Next high-impact event (respects the currency filter)
  const nextHigh = parsedEvents.find(e =>
    e.impact === 'High' && e.ts > now &&
    (filters.currencies.length === 0 || filters.currencies.includes(e.country))
  );
  const nextHighGroup = nextHigh ? parsedEvents.filter(e => e.impact === 'High' && e.ts === nextHigh.ts && (filters.currencies.length === 0 || filters.currencies.includes(e.country))) : [];

  // Group by local day
  const grouped = [];
  visibleEvents.forEach(e => {
    const d = new Date(e.ts);
    const key = dayKey(d);
    const last = grouped[grouped.length - 1];
    if (!last || last.key !== key) grouped.push({ key, label: formatDay(d), items: [e] });
    else last.items.push(e);
  });

  const toggleImpact = (id) => {
    const impacts = filters.impacts.includes(id) ? filters.impacts.filter(i => i !== id) : [...filters.impacts, id];
    setFilters({ ...filters, impacts });
  };
  const toggleCurrency = (cur) => {
    const list = filters.currencies.includes(cur) ? filters.currencies.filter(c => c !== cur) : [...filters.currencies, cur];
    setFilters({ ...filters, currencies: list });
  };

  const timeZoneName = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
  })();
  const todayKey = dayKey(new Date(now));

  const chipBase = 'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Haber Takvimi</h1>
          <p className="text-text-secondary text-sm mt-1">
            Bu haftanın ekonomik takvimi · Saatler yerel saatinizle gösterilir{timeZoneName ? ` (${timeZoneName})` : ''}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); loadCalendar(); }}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors"
        >
          <Icons.RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      {/* Fetch status */}
      {fetchError && (
        <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 text-warning text-sm">
          <Icons.AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {events.length > 0
            ? `Takvim şu anda güncellenemedi; son alınan veriler gösteriliyor${fetchedAt ? ` (${formatTime(new Date(fetchedAt))})` : ''}.`
            : 'Haber takvimi şu anda alınamadı. Lütfen birkaç dakika sonra tekrar deneyin.'}
        </div>
      )}

      {/* Next high-impact event countdown */}
      <div className={`bg-bg-surface border rounded-xl p-5 ${nextHigh ? 'border-negative/40' : 'border-border'}`}>
        {nextHigh ? (
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-negative/15 flex items-center justify-center flex-shrink-0">
                <Icons.AlertTriangle className="w-5 h-5 text-negative" />
              </div>
              <div className="min-w-0">
                <p className="text-text-tertiary text-xs font-semibold uppercase tracking-wider">Sonraki yüksek etkili haber</p>
                <p className="text-text-primary font-semibold truncate">
                  <span className="font-mono text-accent mr-2">{nextHigh.country}</span>
                  {nextHighGroup.map(e => e.title).join(' · ')}
                </p>
                <p className="text-text-secondary text-xs mt-0.5">{formatDay(new Date(nextHigh.ts))}, {formatTime(new Date(nextHigh.ts))}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-text-tertiary text-xs">Kalan süre</p>
              <p className="text-3xl font-bold font-mono text-negative">{formatCountdown(nextHigh.ts - now)}</p>
            </div>
          </div>
        ) : (
          <p className="text-text-secondary text-sm">{loading ? 'Takvim yükleniyor...' : 'Bu hafta için yaklaşan yüksek etkili haber yok.'}</p>
        )}
      </div>

      {/* Filters */}
      <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-tertiary text-xs font-medium w-24 flex-shrink-0">Etki</span>
          {IMPACTS.map(imp => {
            const active = filters.impacts.includes(imp.id);
            return (
              <button
                key={imp.id}
                type="button"
                onClick={() => toggleImpact(imp.id)}
                className={`${chipBase} flex items-center gap-1.5 ${active ? imp.badge : 'bg-bg-input border-border text-text-muted hover:text-text-primary'}`}
              >
                <span className={`w-2 h-2 rounded-full ${active ? imp.dot : 'bg-text-muted'}`}></span>
                {imp.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-tertiary text-xs font-medium w-24 flex-shrink-0">Para birimi</span>
          <button
            type="button"
            onClick={() => setFilters({ ...filters, currencies: [] })}
            className={`${chipBase} ${filters.currencies.length === 0 ? 'bg-accent/15 border-accent text-accent' : 'bg-bg-input border-border text-text-secondary hover:text-text-primary'}`}
          >
            Tümü
          </button>
          {currencies.map(cur => {
            const active = filters.currencies.includes(cur);
            return (
              <button
                key={cur}
                type="button"
                onClick={() => toggleCurrency(cur)}
                className={`${chipBase} font-mono ${active ? 'bg-accent/15 border-accent text-accent' : 'bg-bg-input border-border text-text-secondary hover:text-text-primary'}`}
              >
                {cur === 'All' ? 'Genel' : cur}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer select-none group w-fit">
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
              filters.hidePast ? 'bg-accent border-accent' : 'border-border group-hover:border-accent/60'
            }`}
            onClick={() => setFilters({ ...filters, hidePast: !filters.hidePast })}
          >
            {filters.hidePast && <Icons.Check className="w-3 h-3 text-accent-text" />}
          </div>
          <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors" onClick={() => setFilters({ ...filters, hidePast: !filters.hidePast })}>
            Geçmiş haberleri gizle
          </span>
        </label>
      </div>

      {/* Event list */}
      {grouped.length === 0 ? (
        <div className="bg-bg-surface border border-border rounded-xl p-8 text-center">
          <Icons.Calendar className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary text-sm">{loading ? 'Takvim yükleniyor...' : 'Seçili filtrelere uygun haber bulunamadı.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <div key={group.key} className="bg-bg-surface border border-border rounded-xl overflow-hidden">
              <div className={`px-4 py-2.5 border-b border-border flex items-center justify-between ${group.key === todayKey ? 'bg-accent/10' : 'bg-bg-input'}`}>
                <span className={`text-sm font-semibold capitalize ${group.key === todayKey ? 'text-accent' : 'text-text-primary'}`}>{group.label}</span>
                {group.key === todayKey && <span className="text-[10px] font-bold uppercase text-accent">Bugün</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left text-text-tertiary font-medium text-xs w-20">Saat</th>
                      <th className="px-3 py-2 text-left text-text-tertiary font-medium text-xs w-20">Birim</th>
                      <th className="px-3 py-2 text-left text-text-tertiary font-medium text-xs w-24">Etki</th>
                      <th className="px-3 py-2 text-left text-text-tertiary font-medium text-xs">Olay</th>
                      <th className="px-3 py-2 text-right text-text-tertiary font-medium text-xs">Gerçekleşen</th>
                      <th className="px-3 py-2 text-right text-text-tertiary font-medium text-xs">Beklenti</th>
                      <th className="px-4 py-2 text-right text-text-tertiary font-medium text-xs">Önceki</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(e => {
                      const imp = IMPACT_MAP[e.impact] || IMPACT_MAP.Low;
                      const isPast = e.ts < now;
                      const isNext = nextHigh && e.impact === 'High' && e.ts === nextHigh.ts;
                      return (
                        <tr key={e.idx} className={`border-b border-border/50 last:border-b-0 ${isNext ? 'bg-negative/10' : ''} ${isPast ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-2 font-mono text-text-secondary whitespace-nowrap">{formatTime(new Date(e.ts))}</td>
                          <td className="px-3 py-2 font-mono font-semibold text-text-primary">{e.country === 'All' ? 'Genel' : e.country}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-semibold ${imp.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${imp.dot}`}></span>
                              {imp.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-text-primary">{e.title}</td>
                          <td className="px-3 py-2 text-right font-mono text-text-primary">{e.actual || '—'}</td>
                          <td className="px-3 py-2 text-right font-mono text-text-secondary">{e.forecast || '—'}</td>
                          <td className="px-4 py-2 text-right font-mono text-text-secondary">{e.previous || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-text-muted text-xs">
        Kaynak: Forex Factory haftalık takvimi. Veriler sunucuda 15 dakika önbelleğe alınır{stale && !fetchError ? ' (önbellekten)' : ''}{fetchedAt ? ` · Son güncelleme ${formatTime(new Date(fetchedAt))}` : ''}.
      </p>
    </div>
  );
};

module.exports = NewsPage;
