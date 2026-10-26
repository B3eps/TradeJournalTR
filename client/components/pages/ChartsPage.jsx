const React = require('react');
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const {
  Search, Star, ChevronDown, LineChart, Crosshair, Trash2, History, RotateCcw, AlertTriangle, Eye, EyeOff, Minus, Loader2,
} = require('lucide-react');
const helper = require('../../helper.js');
const { Popover, PopoverTrigger, PopoverContent } = require('../ui/popover');
const { FadeIn } = require('../ui/motion');
const sound = require('../../utils/sound');
const PriceChart = require('../charts/PriceChart');
const H = require('../charts/chartHelpers');

// =====================================================
// FİYAT GRAFİĞİ: candlestick chart with the user's journal trades overlaid.
// Data: GET /api/charts/symbols, GET /api/charts/candles (server caches in SQLite).
// Purely a journal/review tool: no signals, forecasts or recommendations.
// =====================================================

const PREFS_KEY = 'charts-prefs';
const FAVS_KEY = 'charts-favorites';
const LINES_KEY = (s) => `charts-lines:${s}`;
const DEFAULT_SYMBOL = 'EURUSD';
const FETCH_ERROR = 'Fiyat verisi alınamadı, daha sonra tekrar deneyin.';
const OLDER_RETRY_MS = 15 * 1000;

const GROUPS = [
  { id: 'forex', label: 'Forex' },
  { id: 'metal', label: 'Metaller' },
  { id: 'crypto', label: 'Kripto' },
  { id: 'stock', label: 'Hisse & Endeks' },
];

const FALLBACK_SYMBOLS = [
  ['EURUSD', 'Euro / ABD Doları', 'forex'], ['GBPUSD', 'Sterlin / ABD Doları', 'forex'], ['USDJPY', 'ABD Doları / Japon Yeni', 'forex'],
  ['XAUUSD', 'Altın / ABD Doları', 'metal'], ['BTCUSDT', 'Bitcoin / Tether', 'crypto'], ['ETHUSDT', 'Ethereum / Tether', 'crypto'],
  ['AAPL', 'Apple', 'stock'], ['NVDA', 'NVIDIA', 'stock'], ['QQQ', 'Invesco QQQ (Nasdaq 100 ETF)', 'stock'],
].map(([symbol, name, type]) => ({ symbol, name, type, source: '' }));

const loadPrefs = () => {
  const p = H.readJson(PREFS_KEY, {});
  const tfOk = H.TIMEFRAMES.some((t) => t.id === p.tf);
  return {
    symbol: typeof p.symbol === 'string' && p.symbol ? p.symbol : DEFAULT_SYMBOL,
    tf: tfOk ? p.tf : '1h',
    ind: Array.isArray(p.ind) ? p.ind.filter((k) => H.INDICATORS.some((i) => i.key === k)) : ['ema20'],
    log: !!p.log,
    auto: p.auto !== false,
    showTrades: p.showTrades !== false,
  };
};

const chipBase = 'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors';
const chipOn = 'bg-accent/15 border-accent text-accent';
const chipOff = 'bg-bg-input border-border text-text-secondary hover:text-text-primary';
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50';
const btnOff = 'bg-bg-input border-border text-text-secondary hover:text-text-primary';
const btnOn = 'bg-accent/15 border-accent text-accent';

// ---------- Symbol picker ----------
const SymbolPicker = ({ symbols, value, favorites, onToggleFav, onPick }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = symbols.find((s) => s.symbol === value);
  const query = q.trim().toUpperCase();
  const filtered = useMemo(() => {
    if (!query) return symbols;
    return symbols.filter((s) => s.symbol.includes(query) || (s.name || '').toUpperCase().includes(query)
      || (s.aliases || []).some((a) => a.toUpperCase().includes(query)));
  }, [symbols, query]);
  const favSet = new Set(favorites);
  const sections = [
    { id: 'fav', label: 'Favoriler', items: filtered.filter((s) => favSet.has(s.symbol)) },
    { id: 'journal', label: 'Günlüğümdeki semboller', items: filtered.filter((s) => s.inJournal) },
    ...GROUPS.map((g) => ({ id: g.id, label: g.label, items: filtered.filter((s) => s.type === g.id) })),
  ].filter((s) => s.items.length);
  const customOk = query && /^[A-Z0-9./_\-+=^]{1,20}$/.test(query) && !symbols.some((s) => s.symbol === query);

  const pick = (sym) => { onPick(sym); setOpen(false); setQ(''); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg bg-bg-input border border-border hover:border-accent/40 transition-colors min-w-[180px]">
          <span className="font-semibold text-text-primary text-sm">{value}</span>
          <span className="text-text-tertiary text-xs truncate max-w-[140px] hidden sm:inline">{current ? current.name : ''}</span>
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary ml-auto" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0 overflow-hidden">
        <div className="p-2 border-b border-border">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg-input border border-border">
            <Search className="w-3.5 h-3.5 text-text-tertiary" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (filtered[0]) pick(filtered[0].symbol);
                  else if (customOk) pick(query);
                }
              }}
              placeholder="Sembol ara (EURUSD, BTC, AAPL...)"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
        </div>
        <div className="max-h-[360px] overflow-y-auto py-1">
          {sections.map((sec) => (
            <div key={sec.id} className="py-1">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">{sec.label}</div>
              {sec.items.map((s) => (
                <div key={`${sec.id}-${s.symbol}`} className={`group flex items-center gap-2 px-2 py-1 mx-1 rounded-md hover:bg-bg-input ${s.symbol === value ? 'bg-bg-input' : ''}`}>
                  <button
                    type="button"
                    aria-label={favSet.has(s.symbol) ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                    onClick={() => onToggleFav(s.symbol)}
                    className="p-1 rounded text-text-tertiary hover:text-warning"
                  >
                    <Star className={`w-3.5 h-3.5 ${favSet.has(s.symbol) ? 'fill-warning text-warning' : ''}`} />
                  </button>
                  <button type="button" onClick={() => pick(s.symbol)} className="flex-1 flex items-center gap-2 text-left min-w-0 py-0.5">
                    <span className="text-sm font-medium text-text-primary w-20 flex-shrink-0">{s.symbol}</span>
                    <span className="text-xs text-text-tertiary truncate">{s.name}</span>
                  </button>
                  {s.source && <span className="text-[10px] text-text-muted flex-shrink-0">{s.source}</span>}
                </div>
              ))}
            </div>
          ))}
          {customOk && (
            <button type="button" onClick={() => pick(query)} className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-input">
              “{query}” sembolünü aç
            </button>
          )}
          {!sections.length && !customOk && <div className="px-3 py-6 text-center text-xs text-text-tertiary">Sonuç yok</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// ---------- Trade picker ----------
const TradePicker = ({ geoms, onPick }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const sorted = [...geoms].sort((a, b) => b.entryTime - a.entryTime);
    const f = query ? sorted.filter((g) => g.label.toLowerCase().includes(query)) : sorted;
    return f.slice(0, 150);
  }, [geoms, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={!geoms.length} className={`${btn} ${btnOff}`}>
          <History className="w-3.5 h-3.5" />
          Trade seç
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-0 overflow-hidden">
        <div className="p-2 border-b border-border">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg-input border border-border">
            <Search className="w-3.5 h-3.5 text-text-tertiary" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="İşlem ara"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
        </div>
        <div className="max-h-[360px] overflow-y-auto py-1">
          {list.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => { onPick(g); setOpen(false); setQ(''); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-input"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${g.open ? 'bg-info' : g.pl === null ? 'bg-text-muted' : g.pl >= 0 ? 'bg-positive' : 'bg-negative'}`} />
              <span className="text-text-primary truncate">{g.label}</span>
            </button>
          ))}
          {!list.length && <div className="px-3 py-6 text-center text-xs text-text-tertiary">Günlükte fiyatı olan işlem yok</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// ---------- Stat strip ----------
const Stat = ({ label, value, tone }) => (
  <div className="flex flex-col min-w-[70px]">
    <span className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</span>
    <span className={`text-sm font-mono font-medium ${tone || 'text-text-primary'}`}>{value}</span>
  </div>
);

// ---------- Page ----------
const ChartsPage = ({ trades = [] }) => {
  const initial = useMemo(loadPrefs, []);
  const [symbols, setSymbols] = useState(FALLBACK_SYMBOLS);
  const [favorites, setFavorites] = useState(() => {
    const f = H.readJson(FAVS_KEY, ['EURUSD', 'XAUUSD']);
    return Array.isArray(f) ? f.filter((x) => typeof x === 'string').slice(0, 50) : [];
  });
  const [symbol, setSymbol] = useState(initial.symbol);
  const [tf, setTf] = useState(initial.tf);
  const [indKeys, setIndKeys] = useState(initial.ind);
  const [logScale, setLogScale] = useState(initial.log);
  const [autoScale, setAutoScale] = useState(initial.auto);
  const [showTrades, setShowTrades] = useState(initial.showTrades);
  const [request, setRequest] = useState({ symbol: initial.symbol, tf: initial.tf, nonce: 1 });
  const [data, setData] = useState({ key: '', candles: [], source: '', note: '', error: '', loading: true });
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [olderError, setOlderError] = useState('');
  const [visible, setVisible] = useState(null);
  const [focus, setFocus] = useState(null);
  const [lines, setLines] = useState(() => H.readJson(LINES_KEY(initial.symbol), []));
  const [addLineMode, setAddLineMode] = useState(false);

  const nonceRef = useRef(1);
  const dataRef = useRef(data);
  dataRef.current = data;
  const olderRef = useRef({ loading: false, exhausted: false, blockedUntil: 0, cursor: null, empties: 0 });
  const newerRef = useRef({ loading: false, done: false, blockedUntil: 0 });

  // Persist preferences
  useEffect(() => {
    H.writeJson(PREFS_KEY, { symbol, tf, ind: indKeys, log: logScale, auto: autoScale, showTrades });
  }, [symbol, tf, indKeys, logScale, autoScale, showTrades]);
  useEffect(() => { H.writeJson(FAVS_KEY, favorites); }, [favorites]);

  // Symbols
  useEffect(() => {
    let alive = true;
    helper.authFetch('/api/charts/symbols')
      .then((r) => r.json())
      .then((body) => { if (alive && body && Array.isArray(body.symbols) && body.symbols.length) setSymbols(body.symbols); })
      .catch(() => { /* fallback list stays */ });
    return () => { alive = false; };
  }, []);

  // Per-symbol price lines
  useEffect(() => {
    const l = H.readJson(LINES_KEY(symbol), []);
    setLines(Array.isArray(l) ? l.filter((x) => x && Number.isFinite(x.price)) : []);
    setAddLineMode(false);
  }, [symbol]);
  const saveLines = useCallback((next) => {
    setLines(next);
    H.writeJson(LINES_KEY(symbol), next);
  }, [symbol]);

  // Journal ticker -> chart symbol (server aliases first, client mirror second)
  const aliasMap = useMemo(() => {
    const m = new Map();
    for (const s of symbols) for (const a of s.aliases || []) m.set(String(a).toUpperCase(), s.symbol);
    return m;
  }, [symbols]);
  const symbolOf = useCallback((ticker) => aliasMap.get(String(ticker || '').toUpperCase()) || H.normalizeSymbol(ticker), [aliasMap]);

  const allGeoms = useMemo(() => (Array.isArray(trades) ? trades : [])
    .map((t) => {
      const g = H.tradeGeometry(t);
      if (!g) return null;
      g.symbol = symbolOf(t.ticker);
      g.label = H.tradeLabel(g);
      return g;
    })
    .filter(Boolean), [trades, symbolOf]);
  const [dataSymbol, dataTf] = useMemo(() => {
    const [s, t] = (data.key || '').split('|');
    return [s || symbol, H.TF_SEC[t] ? t : tf];
  }, [data.key, symbol, tf]);
  const symbolGeoms = useMemo(() => allGeoms.filter((g) => g.symbol === dataSymbol), [allGeoms, dataSymbol]);

  // ---------- data loading ----------
  const startRequest = useCallback((sym, timeframe, range) => {
    nonceRef.current += 1;
    setRequest({ symbol: sym, tf: timeframe, nonce: nonceRef.current, ...(range || {}) });
  }, []);

  useEffect(() => {
    const reqKey = (sym) => `${sym}|${request.tf}|${request.nonce}`;
    let alive = true;
    olderRef.current = { loading: false, exhausted: false, blockedUntil: 0, cursor: null, empties: 0 };
    newerRef.current = { loading: false, done: !request.to, blockedUntil: 0 };
    setOlderExhausted(false);
    setOlderError('');
    setData((d) => ({ ...d, loading: true, error: '', note: '' }));
    // Önceki istek iptal edilir; yanıt gelmezse 40 sn sonra hata gösterilir (sonsuz "Yükleniyor" olmaz).
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => { if (controller) controller.abort(); }, 40000);
    H.fetchCandles({ symbol: request.symbol, tf: request.tf, from: request.from, to: request.to, limit: request.from ? 5000 : 500, signal: controller ? controller.signal : undefined })
      .then((res) => {
        clearTimeout(timer);
        if (!alive) return;
        olderRef.current.cursor = res.range && res.range.from ? res.range.from : null;
        const canonical = res.symbol && /^[A-Z0-9^=-]{1,20}$/.test(res.symbol) ? res.symbol : request.symbol;
        if (canonical !== request.symbol) setSymbol(canonical);
        const key = reqKey(canonical);
        setData({ key, candles: res.candles || [], source: res.source || '', note: res.note || '', error: res.error || '', loading: false });
      })
      .catch(() => {
        clearTimeout(timer);
        if (!alive) return;
        setData({ key: reqKey(request.symbol), candles: [], source: '', note: '', error: FETCH_ERROR, loading: false });
      });
    return () => { alive = false; clearTimeout(timer); if (controller) controller.abort(); };
  }, [request]);

  const loadOlder = useCallback(async () => {
    const st = olderRef.current;
    const d = dataRef.current;
    if (st.loading || st.exhausted || d.loading || !d.candles.length || Date.now() < st.blockedUntil) return;
    const key = d.key;
    const [sym, timeframe] = key.split('|');
    const step = H.TF_SEC[timeframe];
    const firstTime = d.candles[0].time;
    const to = Math.min(firstTime, st.cursor || firstTime) - 1;
    const from = to - Math.min(H.TF_MAX_SPAN[timeframe], Math.ceil(500 * step * (timeframe === '1d' ? 1.45 : 1.5)));
    if (to < Date.UTC(1995, 0, 1) / 1000) { st.exhausted = true; setOlderExhausted(true); return; }
    st.loading = true;
    setOlderLoading(true);
    try {
      const res = await H.fetchCandles({ symbol: sym, tf: timeframe, from, to, limit: 5000 });
      if (dataRef.current.key !== key) return;
      if (res.error) {
        st.blockedUntil = Date.now() + OLDER_RETRY_MS;
        setOlderError(res.error);
      } else {
        setOlderError('');
      }
      st.cursor = res.range && res.range.from ? Math.min(res.range.from, from) : from;
      if (res.candles && res.candles.length) {
        st.empties = 0;
        setData((cur) => (cur.key === key ? { ...cur, candles: H.mergeCandles(res.candles, cur.candles) } : cur));
      } else if (!res.error) {
        st.empties += 1;
        if (st.empties >= 3) { st.exhausted = true; setOlderExhausted(true); }
      }
    } catch {
      st.blockedUntil = Date.now() + OLDER_RETRY_MS;
      setOlderError(FETCH_ERROR);
    } finally {
      st.loading = false;
      setOlderLoading(false);
    }
  }, []);

  const loadNewer = useCallback(async () => {
    const st = newerRef.current;
    const d = dataRef.current;
    if (st.loading || st.done || d.loading || !d.candles.length || Date.now() < st.blockedUntil) return;
    const key = d.key;
    const [sym, timeframe] = key.split('|');
    const step = H.TF_SEC[timeframe];
    const nowSec = Math.floor(Date.now() / 1000);
    const last = d.candles[d.candles.length - 1].time;
    if (last >= nowSec - 2 * step) { st.done = true; return; }
    // The cursor skips past empty ranges (weekends / holidays) on the next call.
    const from = Math.max(last, st.cursor || 0);
    const to = Math.min(nowSec, from + Math.min(H.TF_MAX_SPAN[timeframe], 500 * step * 1.5));
    st.loading = true;
    try {
      const res = await H.fetchCandles({ symbol: sym, tf: timeframe, from, to, limit: 5000 });
      if (dataRef.current.key !== key) return;
      if (res.error) {
        st.blockedUntil = Date.now() + OLDER_RETRY_MS;
      } else {
        st.cursor = to;
        if (to >= nowSec - step) st.done = true;
      }
      if (res.candles && res.candles.length) {
        setData((cur) => (cur.key === key ? { ...cur, candles: H.mergeCandles(cur.candles, res.candles) } : cur));
      }
    } catch {
      st.blockedUntil = Date.now() + OLDER_RETRY_MS;
    } finally {
      st.loading = false;
    }
  }, []);

  // ---------- user actions ----------
  const pickSymbol = useCallback((sym) => {
    setFocus(null);
    setSymbol(sym);
    startRequest(sym, tf);
  }, [tf, startRequest]);

  const pickTf = useCallback((next) => {
    if (next === tf) return;
    setTf(next);
    if (focus) {
      const g = allGeoms.find((x) => x.id === focus.id);
      if (g) {
        const w = H.tradeWindow(g, next);
        nonceRef.current += 1;
        setFocus({ id: g.id, ...w.view, nonce: nonceRef.current });
        startRequest(symbol, next, w.fetch);
        return;
      }
    }
    startRequest(symbol, next);
  }, [tf, focus, allGeoms, symbol, startRequest]);

  const focusTrade = useCallback((g, opts = {}) => {
    const timeframe = opts.keepTf ? tf : H.pickTimeframeForTrade(g);
    const w = H.tradeWindow(g, timeframe);
    nonceRef.current += 1;
    const nonce = nonceRef.current;
    sound.play('click');
    setFocus({ id: g.id, ...w.view, nonce });
    const d = dataRef.current;
    const covered = d.key.startsWith(`${g.symbol}|${timeframe}|`) && d.candles.length
      && d.candles[0].time <= w.view.from && d.candles[d.candles.length - 1].time >= Math.min(w.view.to, Math.floor(Date.now() / 1000) - H.TF_SEC[timeframe] * 2);
    if (covered) return;
    setSymbol(g.symbol);
    setTf(timeframe);
    setRequest({ symbol: g.symbol, tf: timeframe, nonce, ...w.fetch });
  }, [tf]);

  const onTradeClick = useCallback((id) => {
    const g = symbolGeoms.find((x) => x.id === id);
    if (g) focusTrade(g, { keepTf: true });
  }, [symbolGeoms, focusTrade]);

  const goLatest = useCallback(() => {
    setFocus(null);
    startRequest(symbol, tf);
  }, [symbol, tf, startRequest]);

  const precision = useMemo(() => {
    const c = data.candles;
    return H.pricePrecision(dataSymbol, c.length ? c[c.length - 1].close : 0);
  }, [dataSymbol, data.candles]);

  const onAddLine = useCallback((price) => {
    const p = Number(price.toFixed(precision));
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    saveLines([...lines, { id, price: p, label: '' }].slice(-30));
    setAddLineMode(false);
    sound.play('pop');
  }, [lines, precision, saveLines]);

  useEffect(() => {
    if (!addLineMode) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAddLineMode(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addLineMode]);

  const toggleFav = useCallback((sym) => {
    setFavorites((f) => (f.includes(sym) ? f.filter((x) => x !== sym) : [...f, sym]));
  }, []);
  const toggleInd = (key) => setIndKeys((k) => (k.includes(key) ? k.filter((x) => x !== key) : [...k, key]));

  // ---------- derived ----------
  const indicators = useMemo(() => H.INDICATORS
    .filter((i) => indKeys.includes(i.key))
    .map((i) => ({ key: i.key, color: i.color, label: `${i.type} ${i.period}`, data: H.computeIndicator(i, data.candles) })), [indKeys, data.candles]);

  const stats = useMemo(() => {
    const c = data.candles;
    if (!c.length) return null;
    let list = c;
    if (visible) list = c.filter((x) => x.time >= visible.from && x.time <= visible.to);
    if (!list.length) list = c.slice(-160);
    const open = list[0].open;
    const close = list[list.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    for (const x of list) { if (x.high > high) high = x.high; if (x.low < low) low = x.low; }
    const pip = H.getPipSize(dataSymbol);
    return {
      open, high, low, close, bars: list.length,
      changePct: open ? ((close - open) / open) * 100 : 0,
      pips: pip ? (close - open) / pip : null,
      rangePips: pip ? (high - low) / pip : null,
      from: list[0].time,
      to: list[list.length - 1].time,
    };
  }, [data.candles, visible, dataSymbol]);

  const visibleTrades = useMemo(() => {
    if (!data.candles.length) return [];
    const nowSec = Math.floor(Date.now() / 1000);
    const from = visible ? visible.from : data.candles[0].time;
    const to = visible ? visible.to + H.TF_SEC[dataTf] : nowSec;
    return symbolGeoms
      .filter((g) => g.entryTime <= to && (g.exitTime || nowSec) >= from)
      .sort((a, b) => b.entryTime - a.entryTime);
  }, [symbolGeoms, visible, data.candles, dataTf]);

  const focusRange = focus ? { from: focus.from, to: focus.to, nonce: focus.nonce } : null;
  const chartKey = data.key;
  const showSkeleton = data.loading && !data.candles.length;
  const isEmpty = !data.loading && !data.error && !data.candles.length;
  const current = symbols.find((s) => s.symbol === symbol);
  const isForex = H.isForexSymbol(dataSymbol);
  const loadingOverlay = data.loading && data.candles.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <FadeIn className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Fiyat Grafiği</h1>
          <p className="text-text-secondary text-sm mt-1">
            Günlüğünüzdeki işlemleri fiyat grafiği üzerinde inceleyin
            {current && current.name ? ` · ${current.name}` : ''}
            {data.source ? ` · Kaynak: ${data.source}` : ''}
          </p>
        </div>
      </FadeIn>

      {/* Toolbar */}
      <div className="bg-bg-surface border border-border rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SymbolPicker symbols={symbols} value={symbol} favorites={favorites} onToggleFav={toggleFav} onPick={pickSymbol} />
          <button
            type="button"
            onClick={() => toggleFav(symbol)}
            aria-label={favorites.includes(symbol) ? 'Favorilerden çıkar' : 'Favorilere ekle'}
            className={`${btn} ${btnOff} px-2`}
          >
            <Star className={`w-3.5 h-3.5 ${favorites.includes(symbol) ? 'fill-warning text-warning' : ''}`} />
          </button>
          <div className="flex items-center rounded-lg bg-bg-input border border-border p-0.5">
            {H.TIMEFRAMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTf(t.id)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${tf === t.id ? 'bg-accent text-accent-text font-semibold' : 'text-text-secondary hover:text-text-primary'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <TradePicker geoms={allGeoms} onPick={(g) => focusTrade(g)} />
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button type="button" onClick={() => setShowTrades((v) => !v)} className={`${btn} ${showTrades ? btnOn : btnOff}`} aria-pressed={showTrades}>
              {showTrades ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              İşlemleri göster
            </button>
            <button
              type="button"
              onClick={() => setAddLineMode((v) => !v)}
              className={`${btn} ${addLineMode ? btnOn : btnOff}`}
              aria-pressed={addLineMode}
              title="Butona basıp grafikte bir fiyat seviyesine tıklayın (Esc ile iptal)"
            >
              <Minus className="w-3.5 h-3.5" />
              {addLineMode ? 'Grafiğe tıklayın…' : 'Çizgi ekle'}
            </button>
            <button type="button" onClick={() => setAutoScale((v) => !v)} className={`${btn} ${autoScale ? btnOn : btnOff}`} aria-pressed={autoScale}>
              Otomatik ölçek
            </button>
            <button type="button" onClick={() => setLogScale((v) => !v)} className={`${btn} ${logScale ? btnOn : btnOff}`} aria-pressed={logScale}>
              Log
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary mr-1">Göstergeler</span>
          {H.INDICATORS.map((i) => {
            const on = indKeys.includes(i.key);
            return (
              <button key={i.key} type="button" onClick={() => toggleInd(i.key)} className={`${chipBase} ${on ? chipOn : chipOff} inline-flex items-center gap-1.5`} aria-pressed={on}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: i.color }} />
                {i.type} {i.period}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stat strip */}
      <div className="bg-bg-surface border border-border rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        {stats ? (
          <>
            <Stat label="Açılış" value={H.fmtPrice(stats.open, precision)} />
            <Stat label="Yüksek" value={H.fmtPrice(stats.high, precision)} />
            <Stat label="Düşük" value={H.fmtPrice(stats.low, precision)} />
            <Stat label="Kapanış" value={H.fmtPrice(stats.close, precision)} />
            <Stat
              label="Değişim"
              value={`${stats.changePct >= 0 ? '+' : ''}${stats.changePct.toFixed(2)}%`}
              tone={stats.changePct >= 0 ? 'text-positive' : 'text-negative'}
            />
            {isForex && stats.pips !== null && (
              <Stat label="Pip" value={`${stats.pips >= 0 ? '+' : ''}${stats.pips.toFixed(1)}`} tone={stats.pips >= 0 ? 'text-positive' : 'text-negative'} />
            )}
            {isForex && stats.rangePips !== null && <Stat label="Aralık (pip)" value={stats.rangePips.toFixed(1)} />}
            <span className="text-[11px] text-text-tertiary ml-auto">
              Görünen aralık: {H.fmtDateTimeFull(stats.from, dataTf)} – {H.fmtDateTimeFull(stats.to, dataTf)} · {stats.bars} mum
            </span>
          </>
        ) : (
          <span className="text-xs text-text-tertiary">{data.loading ? 'Veriler yükleniyor…' : 'Görünen aralık için veri yok'}</span>
        )}
      </div>

      {/* Banners */}
      {data.error && (
        <div className="flex items-start gap-2 rounded-xl border border-negative/30 bg-negative/10 px-4 py-2.5 text-sm text-negative">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="flex-1">{data.error}</span>
          <button type="button" onClick={() => startRequest(symbol, tf, request.from ? { from: request.from, to: request.to } : undefined)} className="text-xs underline underline-offset-2">
            Tekrar dene
          </button>
        </div>
      )}
      {data.note && !data.error && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">{data.note}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4">
        {/* Chart */}
        <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
          <div className="relative h-[460px] md:h-[560px]">
            <PriceChart
              candles={data.candles}
              tf={dataTf}
              dataKey={chartKey}
              precision={precision}
              indicators={indicators}
              logScale={logScale}
              autoScale={autoScale}
              trades={symbolGeoms}
              showTrades={showTrades}
              focusId={focus ? focus.id : null}
              focusRange={focusRange}
              userLines={lines}
              addLineMode={addLineMode}
              onAddLine={onAddLine}
              onVisibleRangeChange={setVisible}
              onNeedOlder={loadOlder}
              onNeedNewer={loadNewer}
              onTradeClick={onTradeClick}
            />
            {showSkeleton && (
              <div className="absolute inset-0 z-20 bg-bg-surface p-6 flex flex-col">
                <div className="h-4 w-48 rounded bg-bg-input animate-pulse" />
                <div className="flex-1 flex items-end gap-1.5 mt-6 animate-pulse">
                  {Array.from({ length: 48 }, (_, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-bg-input" style={{ height: `${20 + ((i * 53) % 60)}%` }} />
                  ))}
                </div>
              </div>
            )}
            {isEmpty && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-bg-surface text-center px-6">
                <LineChart className="w-8 h-8 text-text-muted" />
                <p className="text-sm text-text-secondary">Bu sembol ve aralık için fiyat verisi bulunamadı.</p>
                <p className="text-xs text-text-tertiary">Piyasa kapalı olabilir veya veri sağlayıcısı bu aralığı sunmuyor olabilir.</p>
                <button type="button" onClick={goLatest} className={`${btn} ${btnOff} mt-1`}>
                  <RotateCcw className="w-3.5 h-3.5" /> Son veriyi yükle
                </button>
              </div>
            )}
            {!showSkeleton && data.error && !data.candles.length && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-bg-surface text-center px-6">
                <AlertTriangle className="w-8 h-8 text-negative/70" />
                <p className="text-sm text-text-secondary">{FETCH_ERROR}</p>
              </div>
            )}
            {loadingOverlay && (
              <div className="absolute right-20 top-2 z-20 flex items-center gap-1.5 rounded-full bg-bg-surface/90 border border-border px-2.5 py-1 text-[11px] text-text-secondary">
                <Loader2 className="w-3 h-3 animate-spin" /> Yükleniyor
              </div>
            )}
            {addLineMode && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-10 z-20 rounded-full bg-accent text-accent-text px-3 py-1 text-xs font-medium shadow pointer-events-none">
                Çizgi eklemek için grafikte bir fiyata tıklayın · Esc: iptal
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={loadOlder}
              disabled={olderLoading || olderExhausted || !data.candles.length}
              className={`${btn} ${btnOff}`}
            >
              {olderLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
              {olderExhausted ? 'Daha eski veri yok' : 'Daha eski veriyi yükle'}
            </button>
            <button type="button" onClick={goLatest} className={`${btn} ${btnOff}`}>
              <RotateCcw className="w-3.5 h-3.5" /> Son veriye dön
            </button>
            {olderError && <span className="text-[11px] text-negative">{olderError}</span>}
            <span className="ml-auto text-[11px] text-text-tertiary">
              Saatler yerel saat diliminizde · Sola kaydırınca eski veriler otomatik yüklenir
            </span>
          </div>
        </div>

        {/* Side panels */}
        <div className="space-y-4">
          <div className="bg-bg-surface border border-border rounded-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Görünen işlemler</h2>
              <span className="text-[11px] text-text-tertiary">{visibleTrades.length}</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
              {!showTrades && <p className="px-2 py-3 text-xs text-text-tertiary">İşlem katmanı kapalı.</p>}
              {showTrades && visibleTrades.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => focusTrade(g, { keepTf: true })}
                  className={`w-full text-left rounded-lg px-2.5 py-2 border transition-colors ${focus && focus.id === g.id ? 'border-accent/50 bg-accent/5' : 'border-transparent hover:bg-bg-input'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${g.side === 'long' ? 'bg-sky-500/15 text-sky-300' : 'bg-orange-500/15 text-orange-300'}`}>
                      {H.sideLabel(g.side)}
                    </span>
                    <span className="text-xs text-text-secondary">{H.fmtDateTime(g.entryTime)}</span>
                    <span className={`ml-auto text-xs font-mono ${g.open ? 'text-info' : g.pl === null ? 'text-text-tertiary' : g.pl >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {g.open ? 'Açık' : g.pl === null ? '-' : H.fmtMoney(g.pl)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-text-tertiary">
                    {H.fmtPrice(g.entryPrice, precision)}
                    {g.exitPrice ? ` → ${H.fmtPrice(g.exitPrice, precision)}` : ''}
                    {isForex && g.exitPrice ? ` · ${(((g.exitPrice - g.entryPrice) / (H.getPipSize(dataSymbol) || 1)) * (g.side === 'long' ? 1 : -1)).toFixed(1)} pip` : ''}
                  </div>
                </button>
              ))}
              {showTrades && !visibleTrades.length && (
                <p className="px-2 py-3 text-xs text-text-tertiary">
                  {symbolGeoms.length ? 'Görünen aralıkta bu sembole ait işlem yok.' : 'Günlükte bu sembole ait işlem yok.'}
                </p>
              )}
            </div>
          </div>

          <div className="bg-bg-surface border border-border rounded-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Fiyat çizgileri</h2>
              <button type="button" onClick={() => setAddLineMode((v) => !v)} className={`${btn} ${addLineMode ? btnOn : btnOff} py-1`}>
                <Crosshair className="w-3 h-3" /> Ekle
              </button>
            </div>
            <div className="p-2 space-y-1 max-h-[240px] overflow-y-auto">
              {lines.map((l) => (
                <div key={l.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-bg-input">
                  <span className="w-2.5 h-0.5 bg-amber-500 rounded flex-shrink-0" />
                  <span className="text-xs font-mono text-text-primary w-20 flex-shrink-0">{H.fmtPrice(l.price, precision)}</span>
                  <input
                    value={l.label || ''}
                    maxLength={40}
                    onChange={(e) => saveLines(lines.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)))}
                    placeholder="Etiket (isteğe bağlı)"
                    className="flex-1 min-w-0 bg-transparent text-xs text-text-secondary placeholder:text-text-muted outline-none border-b border-transparent focus:border-border"
                  />
                  <button
                    type="button"
                    aria-label="Çizgiyi sil"
                    onClick={() => saveLines(lines.filter((x) => x.id !== l.id))}
                    className="p-1 rounded text-text-tertiary hover:text-negative"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!lines.length && <p className="px-2 py-3 text-xs text-text-tertiary">“Çizgi ekle”ye basıp grafikte bir fiyata tıklayarak yatay çizgi ekleyebilirsiniz.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="text-[11px] text-text-tertiary leading-relaxed">
        Veri kaynakları: Dukascopy (forex ve metaller, bid fiyatı), Binance (kripto), Yahoo Finance (hisse, ETF ve endeksler; resmi olmayan
        uç nokta, yalnızca kişisel kullanım). Fiyatlar ve mum saatleri aracı kurumunuzun verilerinden farklı olabilir. Bu sayfa yalnızca
        günlük kayıtlarınızı incelemek içindir. Grafik:{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text-secondary">
          TradingView Lightweight Charts™
        </a>.
      </p>
    </div>
  );
};

module.exports = ChartsPage;
