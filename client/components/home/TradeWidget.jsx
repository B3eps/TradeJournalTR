// Trade özeti: computed entirely from the `trades` prop.
const React = require('react');
const { CountUp, Stagger, StaggerItem } = require('../ui/motion');
const { getTradePL } = require('../../utils/analytics');
const { Card, Empty, Btn, Sparkline, fmtMoney, plColor } = require('./ui');

const safePL = (t) => {
  try {
    const v = getTradePL(t);
    return Number.isFinite(v) ? v : 0;
  } catch (e) { return 0; }
};
const exitMs = (t) => {
  const ms = new Date(t.exitTime || t.enterTime).getTime();
  return isNaN(ms) ? 0 : ms;
};

const summarize = (trades) => {
  const list = Array.isArray(trades) ? trades.filter(Boolean) : [];
  const withPL = list.map((t) => ({ t, pl: safePL(t), ms: exitMs(t) })).sort((a, b) => a.ms - b.ms);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dow = (now.getDay() + 6) % 7;
  const weekStartMs = dayStart - dow * 86400000;
  const monthAgo = now.getTime() - 30 * 86400000;

  const sum = (arr) => arr.reduce((s, x) => s + x.pl, 0);
  const today = withPL.filter((x) => x.ms >= dayStart);
  const week = withPL.filter((x) => x.ms >= weekStartMs);
  const last30 = withPL.filter((x) => x.ms >= monthAgo);
  const decisive = last30.filter((x) => x.pl !== 0);
  const winRate = decisive.length ? (decisive.filter((x) => x.pl > 0).length / decisive.length) * 100 : null;

  const lastClosed = withPL.slice(-30);
  let acc = 0;
  const equity = lastClosed.map((x) => (acc += x.pl));
  return {
    count: list.length,
    todayPL: sum(today), todayCount: today.length,
    weekPL: sum(week), weekCount: week.length,
    winRate, last30Count: last30.length,
    recent: withPL.slice(-5).reverse(),
    equity,
  };
};

const TradeWidget = ({ onNavigate, trades }) => {
  const s = React.useMemo(() => summarize(trades), [trades]);

  return (
    <Card title="Trade özeti" icon="trade" onMore={() => onNavigate('trades')} delay={0.2}>
      {s.count === 0 ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <Empty>Henüz işlem yok. İlk kaydını girerek günlüğünü başlat.</Empty>
          <Btn primary onClick={() => onNavigate('trades')}>İlk işlemini ekle</Btn>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[11px] text-text-tertiary">Bugün</div>
              <div className={`font-mono text-lg font-bold tabular-nums ${plColor(s.todayPL)}`}>
                <CountUp value={s.todayPL} format={fmtMoney} />
              </div>
              <div className="text-[10px] text-text-tertiary">{s.todayCount} işlem</div>
            </div>
            <div>
              <div className="text-[11px] text-text-tertiary">Bu hafta</div>
              <div className={`font-mono text-lg font-bold tabular-nums ${plColor(s.weekPL)}`}>
                <CountUp value={s.weekPL} format={fmtMoney} />
              </div>
              <div className="text-[10px] text-text-tertiary">{s.weekCount} işlem</div>
            </div>
            <div>
              <div className="text-[11px] text-text-tertiary">Kazanma (30 g)</div>
              <div className="font-mono text-lg font-bold tabular-nums text-text-primary">
                {s.winRate == null ? '-' : <CountUp value={s.winRate} format={(n) => `%${Math.round(n)}`} />}
              </div>
              <div className="text-[10px] text-text-tertiary">{s.last30Count} işlem</div>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-text-tertiary mb-1">Kümülatif P/L (son {s.equity.length} işlem)</div>
            <Sparkline values={s.equity} height={48} positive={s.equity.length === 0 || s.equity[s.equity.length - 1] >= 0} />
          </div>

          <Stagger stagger={0.04} className="flex flex-col">
            {s.recent.map(({ t, pl }, i) => {
              const long = Number(t.quantity) > 0;
              return (
                <StaggerItem key={t.id != null ? t.id : i} y={4} className="flex items-center gap-2 py-1.5 border-b border-border/60 last:border-0 text-xs">
                  <span className="font-semibold text-text-primary w-20 truncate">{t.ticker || '-'}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${long ? 'bg-positive/15 text-positive' : 'bg-negative/15 text-negative'}`}>{long ? 'Long' : 'Short'}</span>
                  <span className={`ml-auto font-mono tabular-nums ${plColor(pl)}`}>{fmtMoney(pl)}</span>
                </StaggerItem>
              );
            })}
          </Stagger>
        </>
      )}
    </Card>
  );
};

module.exports = TradeWidget;
module.exports.summarize = summarize;
