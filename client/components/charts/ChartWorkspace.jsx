const React = require('react');
const { useEffect, useMemo, useState } = React;
const H = require('./chartHelpers');
const PriceChart = require('./PriceChart');

const KEY = 'charts-workspace-v1';
const read = () => {
  const saved = H.readJson(KEY, {});
  const count = [1, 2, 4, 6, 8].includes(saved.count) ? saved.count : 2;
  const panels = Array.from({ length: count }, (_, i) => {
    const p = saved.panels && saved.panels[i] || {};
    return { symbol: typeof p.symbol === 'string' ? p.symbol : 'EURUSD', tf: H.TF_SEC[p.tf] ? p.tf : '1h', ind: Array.isArray(p.ind) ? p.ind.filter((k) => H.INDICATORS.some((x) => x.key === k)) : ['ema20'] };
  });
  return { count, panels };
};

const Panel = ({ config, index, symbols, onChange, showTrades, trades }) => {
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawMode, setDrawMode] = useState('');
  const [pending, setPending] = useState(null);
  const [lines, setLines] = useState(() => H.readJson(`charts-lines:${config.symbol}`, []));
  useEffect(() => { const l = H.readJson(`charts-lines:${config.symbol}`, []); setLines(Array.isArray(l) ? l : []); }, [config.symbol]);
  useEffect(() => { H.writeJson(`charts-lines:${config.symbol}`, lines); }, [lines, config.symbol]);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true); setError('');
    H.fetchCandles({ symbol: config.symbol, tf: config.tf, limit: 500, signal: controller.signal })
      .then((r) => { if (alive) { setCandles(r.candles || []); setError(r.error || ''); setLoading(false); } })
      .catch(() => { if (alive) { setError('Fiyat verisi alınamadı.'); setCandles([]); setLoading(false); } });
    return () => { alive = false; controller.abort(); };
  }, [config.symbol, config.tf]);
  const indicators = useMemo(() => H.INDICATORS.filter((i) => config.ind.includes(i.key)).map((i) => ({ ...i, label: `${i.type} ${i.period}`, data: H.computeIndicator(i, candles) })), [config.ind, candles]);
  const addAt = (price) => {
    if (drawMode === 'line') {
      setLines((v) => [...v, { id: `${Date.now()}-${Math.random()}`, price, label: '' }].slice(-40)); setDrawMode(''); return;
    }
    if (drawMode === 'fib') {
      if (pending === null) setPending(price);
      else {
        const high = Math.max(pending, price); const low = Math.min(pending, price); const diff = high - low;
        const rising = price >= pending;
        const levels = [0, .236, .382, .5, .618, .786, 1].map((ratio) => {
          const percent = ratio * 100;
          const label = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
          return { id: `${Date.now()}-${ratio}`, price: rising ? high - diff * ratio : low + diff * ratio, label: `Fib ${label}%` };
        });
        setLines((v) => [...v, ...levels].slice(-50)); setPending(null); setDrawMode('');
      }
    }
  };
  const precision = H.pricePrecision(config.symbol, candles.length ? candles[candles.length - 1].close : 0);
  const selectedTrades = trades.filter((t) => t.symbol === config.symbol);
  return <section className="min-w-0 rounded-xl border border-border bg-bg-surface overflow-hidden">
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border p-2">
      <select value={config.symbol} onChange={(e) => onChange({ ...config, symbol: e.target.value })} className="rounded bg-bg-input border border-border px-2 py-1 text-xs text-text-primary">{symbols.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}</select>
      <select value={config.tf} onChange={(e) => onChange({ ...config, tf: e.target.value })} className="rounded bg-bg-input border border-border px-2 py-1 text-xs text-text-primary">{H.TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
      <button onClick={() => { setDrawMode('line'); setPending(null); }} className="rounded border border-border px-2 py-1 text-xs text-text-secondary">Yatay çizgi</button>
      <button onClick={() => { setDrawMode('fib'); setPending(null); }} className="rounded border border-border px-2 py-1 text-xs text-text-secondary">Fibonacci</button>
      {drawMode && <span className="text-[10px] text-accent">{drawMode === 'fib' ? (pending === null ? 'İlk noktaya tıklayın' : 'İkinci noktaya tıklayın') : 'Grafikte fiyata tıklayın'}</span>}
      {drawMode && <button onClick={() => { setDrawMode(''); setPending(null); }} className="rounded border border-border px-2 py-1 text-xs text-text-tertiary">İptal</button>}
      {loading && <span className="text-[10px] text-text-tertiary">Yükleniyor</span>}
      {error && <span className="text-[10px] text-negative">{error}</span>}
    </div>
    <div className="flex flex-wrap gap-1 px-2 pt-2">{H.INDICATORS.map((i) => <button key={i.key} onClick={() => onChange({ ...config, ind: config.ind.includes(i.key) ? config.ind.filter((k) => k !== i.key) : [...config.ind, i.key] })} className={`rounded-full border px-2 py-0.5 text-[10px] ${config.ind.includes(i.key) ? 'border-accent text-accent' : 'border-border text-text-tertiary'}`}>{i.type}{i.period}</button>)}</div>
    <div className="relative h-[330px]"><PriceChart candles={candles} tf={config.tf} dataKey={`${config.symbol}|${config.tf}`} precision={precision} indicators={indicators} trades={selectedTrades} showTrades={showTrades} userLines={lines} addLineMode={!!drawMode} onAddLine={addAt} /></div>
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-2 py-1.5">{lines.map((l) => <button key={l.id} title="Silmek için tıklayın" onClick={() => setLines((v) => v.filter((x) => x.id !== l.id))} className="text-[10px] text-text-tertiary">{l.label || 'Seviye'} {H.fmtPrice(l.price, precision)} ×</button>)}</div>
  </section>;
};

const ChartWorkspace = ({ symbols, trades = [], showTrades = true, mode = 'multi', onModeChange = () => {} }) => {
  const [state, setState] = useState(read);
  const [tradingViewLink, setTradingViewLink] = useState('');
  const [tradingViewError, setTradingViewError] = useState('');
  useEffect(() => { H.writeJson(KEY, { ...state, mode }); }, [state, mode]);
  const openTradingViewLink = () => {
    let url;
    try {
      url = new URL(tradingViewLink.trim());
    } catch {
      setTradingViewError('Geçerli bir TradingView HTTPS bağlantısı girin.');
      return;
    }
    try {
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || !(host === 'tradingview.com' || host.endsWith('.tradingview.com')) || url.username || url.password) {
        throw new Error('TradingView’in HTTPS bağlantısını girin.');
      }
      window.open(url.href, '_blank', 'noopener,noreferrer');
      setTradingViewError('');
    } catch (err) {
      setTradingViewError(err instanceof Error ? err.message : 'Bağlantı geçerli değil.');
    }
  };
  const setCount = (count) => setState((s) => ({ count, panels: Array.from({ length: count }, (_, i) => s.panels[i] || s.panels[0] || { symbol: 'EURUSD', tf: '1h', ind: ['ema20'] }) }));
  const update = (i, value) => setState((s) => ({ ...s, panels: s.panels.map((p, n) => n === i ? value : p) }));
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-1"><span className="mr-2 text-xs text-text-tertiary">Görünüm</span>{[['single', 'Tek grafik'], ['multi', 'Çoklu grafik']].map(([v, label]) => <button key={v} onClick={() => { onModeChange(v); H.writeJson(KEY, { ...state, mode: v }); }} className={`rounded border px-2.5 py-1 text-xs ${mode === v ? 'border-accent text-accent' : 'border-border text-text-secondary'}`}>{label}</button>)}{mode === 'multi' && <><span className="ml-3 mr-1 text-xs text-text-tertiary">Düzen</span>{[1, 2, 4, 6, 8].map((n) => <button key={n} onClick={() => setCount(n)} className={`rounded border px-2 py-1 text-xs ${state.count === n ? 'border-accent text-accent' : 'border-border text-text-secondary'}`}>{n}</button>)}</>}</div>
    <details className="rounded-lg border border-border bg-bg-surface px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-text-secondary">TradingView Desktop bağlantısını aç</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <input value={tradingViewLink} onChange={(e) => setTradingViewLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') openTradingViewLink(); }} placeholder="TradingView'den kopyaladığınız chart bağlantısı" className="min-w-0 flex-1 rounded border border-border bg-bg-input px-2 py-1.5 text-xs text-text-primary" />
        <button type="button" onClick={openTradingViewLink} disabled={!tradingViewLink.trim()} className="rounded border border-border px-2.5 py-1.5 text-xs text-text-secondary disabled:opacity-50">Bağlantıyı aç</button>
      </div>
      <p className="mt-2 text-[11px] text-text-tertiary">Bu işlem yalnızca TradingView’den kopyalanmış desteklenen bağlantıyı açar; Windows’un TradingView Desktop bağlantı ayarına bağlıdır. Grafikler, çizimler ve özel indikatörler bu uygulamayla eşitlenmez.</p>
      {tradingViewError && <p role="alert" className="mt-1 text-xs text-negative">{tradingViewError}</p>}
    </details>
    {mode === 'multi' && <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{state.panels.map((p, i) => <Panel key={i} index={i} config={p} symbols={symbols} onChange={(v) => update(i, v)} showTrades={showTrades} trades={trades} />)}</div>}
  </div>;
};
module.exports = ChartWorkspace;
