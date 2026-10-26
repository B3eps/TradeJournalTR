const React = require('react');
const { useEffect, useMemo, useState } = React;
const PriceChart = require('./PriceChart');
const H = require('./chartHelpers');

// =====================================================
// TradeMiniChart: small, non-interactive candlestick chart of one journal
// trade with its entry/exit markers and connector line. Picks a timeframe
// from the trade's duration and loads candles via /api/charts/candles
// (the server normalises broker tickers such as "EURUSD.m").
// Usage: <TradeMiniChart trade={trade} height={180} onOpen={() => ...} />
// =====================================================

const cache = new Map(); // bounded session LRU: avoids repeat fetches without retaining every chart forever
const MAX_CACHE_ENTRIES = 24;

const TradeMiniChart = ({ trade, height = 180, timeframe, className = '', onOpen }) => {
  const geom = useMemo(() => (trade ? H.tradeGeometry(trade) : null), [trade]);
  const tf = useMemo(() => timeframe || (geom ? H.pickTimeframeForTrade(geom) : '1h'), [geom, timeframe]);
  const win = useMemo(() => (geom ? H.tradeWindow(geom, tf) : null), [geom, tf]);
  const [state, setState] = useState({ loading: true, candles: [], error: null, symbol: '' });

  useEffect(() => {
    if (!geom || !win) { setState({ loading: false, candles: [], error: 'İşlemde giriş zamanı/fiyatı yok.', symbol: '' }); return undefined; }
    const key = `${trade.ticker}|${tf}|${win.view.from}|${win.view.to}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      setState({ loading: false, candles: hit.candles, error: hit.error || null, symbol: hit.symbol });
      return undefined;
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    H.fetchCandles({ symbol: trade.ticker, tf, from: win.view.from, to: win.view.to, limit: 600, signal: ctrl ? ctrl.signal : undefined })
      .then((res) => {
        if (!alive) return;
        if (!res.error) {
          cache.delete(key);
          cache.set(key, res);
          if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        }
        setState({ loading: false, candles: res.candles || [], error: res.error || null, symbol: res.symbol || '' });
      })
      .catch((err) => {
        if (!alive || (err && err.name === 'AbortError')) return;
        setState({ loading: false, candles: [], error: 'Fiyat verisi alınamadı, daha sonra tekrar deneyin.', symbol: '' });
      });
    return () => { alive = false; if (ctrl) ctrl.abort(); };
  }, [geom, win, tf, trade]);

  const precision = useMemo(
    () => H.pricePrecision(state.symbol || H.normalizeSymbol(trade && trade.ticker), geom ? geom.entryPrice : 0),
    [state.symbol, trade, geom],
  );
  const trades = useMemo(() => (geom ? [geom] : []), [geom]);
  const tfLabel = (H.TIMEFRAMES.find((t) => t.id === tf) || {}).label || tf;

  return (
    <div
      className={`relative rounded-lg border border-border bg-bg-surface overflow-hidden ${onOpen ? 'cursor-pointer hover:border-accent/40 transition-colors' : ''} ${className}`}
      style={{ height }}
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter') onOpen(); } : undefined}
    >
      <PriceChart
        compact
        candles={state.candles}
        tf={tf}
        dataKey={`${trade && trade._id}|${tf}`}
        precision={precision}
        trades={trades}
        showTrades
        focusId={geom ? geom.id : null}
      />
      <span className="absolute right-2 top-1.5 z-10 text-[10px] font-mono text-text-tertiary bg-bg-surface/80 rounded px-1 pointer-events-none">
        {(state.symbol || (trade && trade.ticker) || '').toUpperCase()} · {tfLabel}
      </span>
      {state.loading && (
        <div className="absolute inset-0 z-20 bg-bg-surface flex items-end gap-1 px-3 pb-6 pt-8 animate-pulse">
          {Array.from({ length: 24 }, (_, i) => (
            <div key={i} className="flex-1 rounded-sm bg-bg-input" style={{ height: `${25 + ((i * 37) % 55)}%` }} />
          ))}
        </div>
      )}
      {!state.loading && (state.error || !state.candles.length) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-surface/90 px-3 text-center text-xs text-text-tertiary">
          {state.error || 'Bu işlem aralığı için fiyat verisi yok.'}
        </div>
      )}
    </div>
  );
};

module.exports = TradeMiniChart;
module.exports.default = TradeMiniChart;
