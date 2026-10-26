// Piyasa: next high-impact economic events + latest important news. Informational only.
const React = require('react');
const { Stagger, StaggerItem } = require('../ui/motion');
const { request } = require('./api');
const { useResource, useNow } = require('./hooks');
const { Card, Skeleton, ErrorNote, Empty, Badge } = require('./ui');

const CAT_TONE = { forex: 'blue', nasdaq: 'green', coin: 'amber', crypto: 'amber' };
const CAT_LABEL = { forex: 'Forex', nasdaq: 'Nasdaq', coin: 'Coin', crypto: 'Coin' };

const fetchCalendar = () => request('GET', '/api/news/calendar');
const fetchNews = () => request('GET', '/api/newsfeed?minImportance=2&limit=6');

const countdown = (ms) => {
  if (ms <= 0) return 'şimdi';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  if (d > 0) return `${d} g ${h} sa`;
  if (h > 0) return `${h} sa ${m} dk`;
  return `${m} dk ${String(x).padStart(2, '0')} sn`;
};

const fmtWhen = (date) => {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Bugün ${time}`;
  return `${date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })} ${time}`;
};

const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'şimdi';
  if (m < 60) return `${m} dk önce`;
  if (m < 1440) return `${Math.floor(m / 60)} sa önce`;
  return `${Math.floor(m / 1440)} g önce`;
};

const MarketWidget = ({ onNavigate, navigate }) => {
  const cal = useResource(fetchCalendar);
  const news = useResource(fetchNews);

  const events = React.useMemo(() => {
    const list = cal.data && Array.isArray(cal.data.events) ? cal.data.events : [];
    return list
      .filter((e) => String(e.impact).toLowerCase() === 'high')
      .map((e) => ({ ...e, ts: new Date(e.date).getTime() }))
      .filter((e) => !isNaN(e.ts))
      .sort((a, b) => a.ts - b.ts);
  }, [cal.data]);

  const nowTick = useNow(1000, events.length > 0);
  const upcoming = events.filter((e) => e.ts > nowTick - 60000).slice(0, 3);
  const next = upcoming[0];

  const items = news.data && Array.isArray(news.data.items) ? news.data.items : [];

  return (
    <Card title="Piyasa" icon="news" onMore={() => onNavigate('newsfeed')} className="md:col-span-2 xl:col-span-1" delay={0.15}>
      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Yaklaşan yüksek etkili veriler</div>
        {cal.loading ? <Skeleton rows={2} /> : cal.error && !cal.data ? <ErrorNote message="Takvim alınamadı." onRetry={cal.reload} /> : upcoming.length === 0 ? (
          <Empty>Bu hafta için yaklaşan yüksek etkili veri yok.</Empty>
        ) : (
          <>
            {next && (
              <button type="button" onClick={() => onNavigate('news')} className="text-left rounded-xl bg-bg-input px-3 py-2.5 hover:bg-bg-input/70 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-text-tertiary">Sıradaki</span>
                  <span className="font-mono text-sm font-semibold text-warning tabular-nums">{countdown(next.ts - nowTick)}</span>
                </div>
                <div className="text-sm text-text-primary truncate mt-0.5">{next.country ? `${next.country} · ` : ''}{next.title}</div>
              </button>
            )}
            <Stagger stagger={0.04} className="flex flex-col">
              {upcoming.map((e, i) => (
                <StaggerItem key={`${e.title}-${e.ts}-${i}`} y={4} className="flex items-center gap-2 py-1.5 border-b border-border/60 last:border-0 text-xs">
                  <Badge tone="red">Yüksek</Badge>
                  <span className="flex-1 min-w-0 truncate text-text-primary">{e.country ? `${e.country} ` : ''}{e.title}</span>
                  <span className="text-text-tertiary tabular-nums flex-shrink-0">{fmtWhen(new Date(e.ts))}</span>
                </StaggerItem>
              ))}
            </Stagger>
            {cal.data && cal.data.stale && <div className="text-[11px] text-text-tertiary">Takvim verisi güncel olmayabilir.</div>}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Önemli haberler</div>
        {news.loading ? <Skeleton rows={3} /> : news.error && !news.data ? <ErrorNote message="Haberler alınamadı." onRetry={news.reload} /> : items.length === 0 ? (
          <Empty>Şu an önemli haber yok.</Empty>
        ) : (
          <Stagger stagger={0.04} className="flex flex-col">
            {items.slice(0, 6).map((it) => {
              const cat = String(it.category || '').toLowerCase();
              return (
                <StaggerItem key={it.id} y={4}>
                  <button type="button" onClick={() => navigate('newsfeed', it.id)} className="w-full text-left flex items-start gap-2 py-2 border-b border-border/60 last:border-0 hover:bg-bg-input/50 rounded transition-colors">
                    <div className="flex flex-col gap-1 flex-shrink-0 items-start pt-0.5">
                      {CAT_LABEL[cat] && <Badge tone={CAT_TONE[cat]}>{CAT_LABEL[cat]}</Badge>}
                      {Number(it.importance) >= 3 && <Badge tone="red">Kritik</Badge>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-primary line-clamp-2">{it.title}</div>
                      <div className="text-[11px] text-text-tertiary mt-0.5">{[it.source, ago(it.publishedAt)].filter(Boolean).join(' · ')}</div>
                    </div>
                  </button>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
        <div className="text-[10px] text-text-muted">Bilgi amaçlıdır, yatırım tavsiyesi değildir.</div>
      </div>
    </Card>
  );
};

module.exports = MarketWidget;
