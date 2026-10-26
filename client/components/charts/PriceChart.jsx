const React = require('react');
const { useEffect, useRef, useState, useCallback } = React;
const LWC = require('lightweight-charts');
const H = require('./chartHelpers');

// =====================================================
// PriceChart: imperative wrapper around TradingView Lightweight Charts v5.
// Candles + optional volume, SMA/EMA overlays, journal trade overlays
// (markers, entry->exit lines, HTML pill labels), user price lines,
// crosshair legend, lazy-load hooks. The TradingView attribution logo is
// kept (library licence requirement).
// =====================================================

const {
  createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers,
  CrosshairMode, LineStyle, PriceScaleMode, TickMarkType,
} = LWC;

const MONTH = (d, utc) => d.toLocaleDateString('tr-TR', { month: 'short', ...(utc ? { timeZone: 'UTC' } : {}) });

const makeTickFormatter = (tf) => (time, type) => {
  const d = new Date(Number(time) * 1000);
  const utc = tf === '1d';
  const day = utc ? d.getUTCDate() : d.getDate();
  switch (type) {
    case TickMarkType.Year: return String(utc ? d.getUTCFullYear() : d.getFullYear());
    case TickMarkType.Month: return MONTH(d, utc);
    case TickMarkType.DayOfMonth: return `${day} ${MONTH(d, utc)}`;
    case TickMarkType.TimeWithSeconds:
      return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    default:
      return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
};

const priceFormatOf = (precision) => ({ type: 'price', precision, minMove: 1 / 10 ** precision });

const PriceChart = ({
  candles = [],
  tf = '1h',
  dataKey = '',
  precision = 2,
  indicators = [],
  logScale = false,
  autoScale = true,
  trades = [],
  showTrades = true,
  focusId = null,
  focusRange = null,
  userLines = [],
  addLineMode = false,
  onAddLine,
  onVisibleRangeChange,
  onNeedOlder,
  onNeedNewer,
  onTradeClick,
  compact = false,
  className = '',
}) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const markersRef = useRef(null);
  const indicatorSeriesRef = useRef(new Map());
  const tradeSeriesRef = useRef([]);
  const focusLinesRef = useRef([]);
  const userLinesRef = useRef([]);
  const prevDataRef = useRef({ key: null, first: null, length: 0 });
  const timesRef = useRef([]);
  const candlesRef = useRef(candles);
  const geomsRef = useRef([]);
  const themeRef = useRef(null);
  const rafRef = useRef(0);
  const visTimerRef = useRef(0);
  const appliedFocusRef = useRef(null);

  // Latest callbacks/flags without re-subscribing chart handlers.
  const cbRef = useRef({});
  cbRef.current = { onAddLine, onVisibleRangeChange, onNeedOlder, onNeedNewer, onTradeClick, addLineMode, tf };

  const [hover, setHover] = useState(null);
  const [pills, setPills] = useState([]);

  // ---------- overlay pill positions ----------
  const updateOverlay = useCallback(() => {
    rafRef.current = 0;
    const chart = chartRef.current;
    const series = candleRef.current;
    const el = containerRef.current;
    if (!chart || !series || !el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const ts = chart.timeScale();
    const out = [];
    for (const g of geomsRef.current) {
      const pts = [{ k: 'in', t: g.entrySnap, p: g.entryPrice }];
      if (!g.open && g.exitSnap) pts.push({ k: 'out', t: g.exitSnap, p: g.exitPrice });
      for (const pt of pts) {
        const x = ts.timeToCoordinate(pt.t);
        const y = series.priceToCoordinate(pt.p);
        if (x === null || y === null || x < -40 || x > w + 40 || y < -20 || y > h + 20) continue;
        const long = g.side === 'long';
        const below = pt.k === 'in' ? long : !long;
        let text;
        let tone;
        if (pt.k === 'in') {
          text = `${H.sideLabel(g.side)} ${H.fmtPrice(g.entryPrice, precision)}${g.open ? ' · açık' : ''}`;
          tone = 'entry';
        } else {
          text = `${H.fmtPrice(g.exitPrice, precision)}${g.pl !== null ? ` · ${H.fmtMoney(g.pl)}` : ''}`;
          tone = g.pl === null ? 'neutral' : g.pl >= 0 ? 'pos' : 'neg';
        }
        out.push({ key: `${g.id}:${pt.k}`, id: g.id, x: Math.round(x), y: Math.round(y), below, text, tone, focus: g.id === focusId });
      }
    }
    setPills((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }, [precision, focusId]);

  const scheduleOverlay = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(() => updateOverlay());
  }, [updateOverlay]);
  const overlayRef = useRef(scheduleOverlay);
  overlayRef.current = scheduleOverlay;

  // ---------- create / dispose ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const theme = H.getChartTheme();
    themeRef.current = theme;
    const chart = createChart(el, {
      width: el.clientWidth || 600,
      height: el.clientHeight || 400,
      layout: {
        background: { color: theme.bg },
        textColor: theme.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: compact ? 10 : 11,
        attributionLogo: true,
      },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: compact ? 2 : 6,
        tickMarkFormatter: makeTickFormatter(tf),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.crosshair, labelBackgroundColor: theme.light ? '#334155' : '#1f2937' },
        horzLine: { color: theme.crosshair, labelBackgroundColor: theme.light ? '#334155' : '#1f2937' },
      },
      localization: {
        locale: 'tr-TR',
        timeFormatter: (t) => H.fmtDateTimeFull(Number(t), cbRef.current.tf),
      },
      handleScroll: !compact,
      handleScale: !compact,
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: theme.up,
      downColor: theme.down,
      borderUpColor: theme.up,
      borderDownColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      priceFormat: priceFormatOf(precision),
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    markersRef.current = createSeriesMarkers(candleSeries, []);
    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    const onCrosshair = (param) => {
      overlayRef.current();
      if (compact) return;
      if (!param || param.time === undefined || !param.point) { setHover(null); return; }
      const bar = param.seriesData.get(candleSeries);
      if (!bar || bar.open === undefined) { setHover(null); return; }
      const vol = param.seriesData.get(volumeSeries);
      const inds = {};
      indicatorSeriesRef.current.forEach((s, key) => {
        const d = param.seriesData.get(s);
        if (d && Number.isFinite(d.value)) inds[key] = d.value;
      });
      setHover({ time: Number(param.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: vol ? vol.value : null, inds });
    };
    const onClick = (param) => {
      const cb = cbRef.current;
      if (!param || !param.point) return;
      if (cb.addLineMode && cb.onAddLine) {
        const price = candleSeries.coordinateToPrice(param.point.y);
        if (price !== null && Number.isFinite(price)) cb.onAddLine(price);
        return;
      }
      // Click near a trade pill/marker focuses that trade.
      if (cb.onTradeClick && geomsRef.current.length) {
        const ts = chart.timeScale();
        let best = null;
        let bestD = 18;
        for (const g of geomsRef.current) {
          for (const [t, p] of [[g.entrySnap, g.entryPrice], [g.exitSnap, g.exitPrice]]) {
            if (!t || !p) continue;
            const x = ts.timeToCoordinate(t);
            const y = candleSeries.priceToCoordinate(p);
            if (x === null || y === null) continue;
            const d = Math.hypot(x - param.point.x, y - param.point.y);
            if (d < bestD) { bestD = d; best = g; }
          }
        }
        if (best) cb.onTradeClick(best.id);
      }
    };
    const onLogical = (range) => {
      overlayRef.current();
      if (!range || compact) return;
      const cb = cbRef.current;
      const n = timesRef.current.length;
      if (n > 0) {
        if (range.from < 3 && cb.onNeedOlder) cb.onNeedOlder();
        if (range.to > n + 1 && cb.onNeedNewer) cb.onNeedNewer();
      }
      if (cb.onVisibleRangeChange) {
        clearTimeout(visTimerRef.current);
        visTimerRef.current = setTimeout(() => {
          const vr = chart.timeScale().getVisibleRange();
          if (vr) cb.onVisibleRangeChange({ from: Number(vr.from), to: Number(vr.to) });
        }, 120);
      }
    };
    chart.subscribeCrosshairMove(onCrosshair);
    chart.subscribeClick(onClick);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onLogical);

    const ro = new ResizeObserver((entries) => {
      const r = entries[0] && entries[0].contentRect;
      if (!r || r.width <= 0 || r.height <= 0) return;
      chart.resize(Math.floor(r.width), Math.floor(r.height));
      overlayRef.current();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      clearTimeout(visTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      try {
        chart.unsubscribeCrosshairMove(onCrosshair);
        chart.unsubscribeClick(onClick);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogical);
      } catch { /* ignore */ }
      indicatorSeriesRef.current = new Map();
      tradeSeriesRef.current = [];
      focusLinesRef.current = [];
      userLinesRef.current = [];
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
    // The chart is created once; options that change are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- options that depend on props ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({ timeScale: { tickMarkFormatter: makeTickFormatter(tf), secondsVisible: false, timeVisible: tf !== '1d' } });
  }, [tf]);

  useEffect(() => {
    if (candleRef.current) candleRef.current.applyOptions({ priceFormat: priceFormatOf(precision) });
  }, [precision]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal, autoScale });
    scheduleOverlay();
  }, [logScale, autoScale, scheduleOverlay]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.style.cursor = addLineMode ? 'crosshair' : '';
  }, [addLineMode]);

  // ---------- candle data ----------
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleRef.current;
    const vs = volumeRef.current;
    if (!chart || !cs || !vs) return;
    candlesRef.current = candles;
    const theme = themeRef.current || H.getChartTheme();
    const prev = prevDataRef.current;
    const sameKey = prev.key === dataKey;
    const ts = chart.timeScale();
    const lrBefore = sameKey ? ts.getVisibleLogicalRange() : null;

    cs.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    const hasVolume = candles.some((c) => c.volume > 0);
    vs.setData(hasVolume ? candles.map((c) => ({ time: c.time, value: c.volume || 0, color: c.close >= c.open ? theme.upVol : theme.downVol })) : []);
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: hasVolume ? 0.2 : 0.06 } });
    timesRef.current = candles.map((c) => c.time);

    const first = candles.length ? candles[0].time : null;
    if (sameKey && lrBefore && prev.first !== null && first !== null && first < prev.first) {
      // Older data was prepended: keep the view where it was.
      const idx = timesRef.current.indexOf(prev.first);
      if (idx > 0) ts.setVisibleLogicalRange({ from: lrBefore.from + idx, to: lrBefore.to + idx });
    } else if (!sameKey && candles.length) {
      appliedFocusRef.current = null;
      if (!focusRange) {
        if (compact) ts.fitContent();
        else {
          const n = candles.length;
          ts.setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 4 });
        }
      }
    }
    prevDataRef.current = { key: candles.length ? dataKey : null, first, length: candles.length };
    scheduleOverlay();
    // focusRange is applied in its own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, dataKey, compact, scheduleOverlay]);

  // ---------- focus a time range (e.g. around a trade) ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focusRange || !candles.length) return;
    const tag = `${dataKey}|${focusRange.nonce || ''}|${focusRange.from}|${focusRange.to}`;
    if (appliedFocusRef.current === tag) return;
    const first = candles[0].time;
    const last = candles[candles.length - 1].time;
    const from = Math.max(first, Math.min(last, focusRange.from));
    const to = Math.max(from + 1, Math.min(last, focusRange.to));
    try {
      chart.timeScale().setVisibleRange({ from, to });
      appliedFocusRef.current = tag;
    } catch { /* range outside data */ }
    scheduleOverlay();
  }, [focusRange, candles, dataKey, scheduleOverlay]);

  // ---------- indicators ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const map = indicatorSeriesRef.current;
    const wanted = new Set(indicators.map((i) => i.key));
    map.forEach((s, key) => {
      if (!wanted.has(key)) { chart.removeSeries(s); map.delete(key); }
    });
    for (const ind of indicators) {
      let s = map.get(ind.key);
      if (!s) {
        s = chart.addSeries(LineSeries, {
          color: ind.color,
          lineWidth: compact ? 1 : 2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: priceFormatOf(precision),
        });
        map.set(ind.key, s);
      }
      s.setData(ind.data || []);
    }
  }, [indicators, precision, compact]);

  // ---------- trade overlays ----------
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleRef.current;
    if (!chart || !cs) return;
    const theme = themeRef.current || H.getChartTheme();
    for (const s of tradeSeriesRef.current) { try { chart.removeSeries(s); } catch { /* ignore */ } }
    tradeSeriesRef.current = [];
    for (const l of focusLinesRef.current) { try { cs.removePriceLine(l); } catch { /* ignore */ } }
    focusLinesRef.current = [];

    const times = timesRef.current;
    if (!showTrades || !times.length) {
      geomsRef.current = [];
      if (markersRef.current) markersRef.current.setMarkers([]);
      scheduleOverlay();
      return;
    }
    const step = H.TF_SEC[tf] || 3600;
    const first = times[0];
    const last = times[times.length - 1];
    const lastClose = candles.length ? candles[candles.length - 1].close : null;
    const geoms = [];
    for (const g of trades) {
      if (!g) continue;
      const end = g.exitTime || last;
      if (g.entryTime > last + step || end < first) continue;
      const entrySnap = H.snapToCandle(times, g.entryTime);
      const exitSnap = g.open ? last : H.snapToCandle(times, g.exitTime);
      geoms.push({ ...g, entrySnap, exitSnap });
    }
    geoms.sort((a, b) => a.entrySnap - b.entrySnap);
    geomsRef.current = geoms;

    const markers = [];
    for (const g of geoms) {
      const long = g.side === 'long';
      const isFocus = g.id === focusId;
      markers.push({
        id: `${g.id}:in`, time: g.entrySnap, price: g.entryPrice,
        position: long ? 'atPriceBottom' : 'atPriceTop',
        shape: long ? 'arrowUp' : 'arrowDown', color: theme.entry, size: isFocus ? 1.6 : 1.1,
      });
      if (!g.open && g.exitSnap) {
        const color = g.pl === null ? theme.muted : g.pl >= 0 ? theme.pos : theme.neg;
        markers.push({
          id: `${g.id}:out`, time: g.exitSnap, price: g.exitPrice,
          position: long ? 'atPriceTop' : 'atPriceBottom',
          shape: long ? 'arrowDown' : 'arrowUp', color, size: isFocus ? 1.6 : 1.1,
        });
      }
      // entry -> exit connector (dashed while the trade is open)
      const endPrice = g.open ? lastClose : g.exitPrice;
      if (endPrice && g.exitSnap && g.exitSnap > g.entrySnap) {
        const win = g.open ? (endPrice - g.entryPrice) * (long ? 1 : -1) >= 0 : (g.pl === null ? (g.exitPrice - g.entryPrice) * (long ? 1 : -1) >= 0 : g.pl >= 0);
        const line = chart.addSeries(LineSeries, {
          color: win ? theme.pos : theme.neg,
          lineWidth: isFocus ? 2 : 1,
          lineStyle: g.open ? LineStyle.Dashed : LineStyle.Solid,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        });
        line.setData([{ time: g.entrySnap, value: g.entryPrice }, { time: g.exitSnap, value: endPrice }]);
        tradeSeriesRef.current.push(line);
      }
    }
    markers.sort((a, b) => a.time - b.time);
    if (markersRef.current) markersRef.current.setMarkers(markers);

    // Horizontal entry / stop / target lines for the focused trade (or a lone visible trade).
    const target = geoms.find((g) => g.id === focusId) || (geoms.length === 1 ? geoms[0] : null);
    if (target && !compact) {
      const add = (price, color, title, style = LineStyle.Dashed) => {
        if (!price) return;
        focusLinesRef.current.push(cs.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
      };
      add(target.entryPrice, theme.entry, 'Giriş');
      if (target.exitPrice) add(target.exitPrice, target.pl !== null && target.pl < 0 ? theme.neg : theme.pos, 'Çıkış', LineStyle.Dotted);
      add(target.stop, theme.neg, 'Zarar durdur');
      add(target.target, theme.pos, 'Kâr al');
    }
    scheduleOverlay();
  }, [trades, showTrades, focusId, candles, tf, compact, scheduleOverlay]);

  // ---------- user price lines ----------
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs) return;
    const theme = themeRef.current || H.getChartTheme();
    for (const l of userLinesRef.current) { try { cs.removePriceLine(l); } catch { /* ignore */ } }
    userLinesRef.current = (userLines || []).map((l) => cs.createPriceLine({
      price: l.price, color: l.color || theme.userLine, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: l.label || '',
    }));
  }, [userLines]);

  useEffect(() => { scheduleOverlay(); }, [scheduleOverlay]);

  // ---------- render ----------
  const legendBar = hover || (candles.length ? { ...candles[candles.length - 1], inds: null, last: true } : null);
  const toneClass = {
    entry: 'bg-sky-500/15 text-sky-300 border-sky-400/40',
    pos: 'bg-positive/15 text-positive border-positive/40',
    neg: 'bg-negative/15 text-negative border-negative/40',
    neutral: 'bg-bg-input text-text-secondary border-border',
  };

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {/* trade pills */}
      {showTrades && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {pills.map((p) => (
            <div
              key={p.key}
              className={`absolute whitespace-nowrap rounded-full border px-1.5 py-[1px] font-mono shadow-sm backdrop-blur-sm ${compact ? 'text-[9px]' : 'text-[10px]'} ${toneClass[p.tone] || toneClass.neutral} ${p.focus ? 'ring-1 ring-accent/60' : ''}`}
              style={{ left: p.x, top: p.y, transform: `translate(-50%, ${p.below ? '14px' : 'calc(-100% - 14px)'})` }}
            >
              {p.text}
            </div>
          ))}
        </div>
      )}
      {/* crosshair legend */}
      {!compact && legendBar && (
        <div className="absolute left-2 top-2 z-10 pointer-events-none rounded-lg bg-bg-surface/85 backdrop-blur-sm border border-border/60 px-2.5 py-1.5 text-[11px] font-mono text-text-secondary space-y-0.5 max-w-[calc(100%-5rem)]">
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            <span className="text-text-tertiary">{H.fmtDateTimeFull(legendBar.time, tf)}</span>
            <span>A <b className="text-text-primary font-medium">{H.fmtPrice(legendBar.open, precision)}</b></span>
            <span>Y <b className="text-text-primary font-medium">{H.fmtPrice(legendBar.high, precision)}</b></span>
            <span>D <b className="text-text-primary font-medium">{H.fmtPrice(legendBar.low, precision)}</b></span>
            <span>K <b className={`font-medium ${legendBar.close >= legendBar.open ? 'text-positive' : 'text-negative'}`}>{H.fmtPrice(legendBar.close, precision)}</b></span>
            {legendBar.open > 0 && (
              <span className={legendBar.close >= legendBar.open ? 'text-positive' : 'text-negative'}>
                {`${legendBar.close >= legendBar.open ? '+' : ''}${(((legendBar.close - legendBar.open) / legendBar.open) * 100).toFixed(2)}%`}
              </span>
            )}
            {Number.isFinite(legendBar.volume) && legendBar.volume > 0 && <span>Hcm {H.fmtVolume(legendBar.volume)}</span>}
          </div>
          {indicators.length > 0 && (
            <div className="flex flex-wrap gap-x-2.5">
              {indicators.map((ind) => {
                const v = legendBar.inds ? legendBar.inds[ind.key] : (ind.data && ind.data.length ? ind.data[ind.data.length - 1].value : null);
                return (
                  <span key={ind.key} style={{ color: ind.color }}>
                    {ind.label} {Number.isFinite(v) ? H.fmtPrice(v, precision) : '-'}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

module.exports = PriceChart;
module.exports.default = PriceChart;
