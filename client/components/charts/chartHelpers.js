// =====================================================
// Pure helpers for the price chart ("Fiyat Grafiği"): symbol normalisation,
// trade geometry, indicators, formatting, theme colours and API access.
// No React here.
// =====================================================

const helper = require('../../helper.js');
const { parseForexSymbol, getPipSize } = require('../../utils/tickValues');
const { getTradePL } = require('../../utils/analytics');

const TIMEFRAMES = [
  { id: '1m', label: '1dk', sec: 60 },
  { id: '5m', label: '5dk', sec: 300 },
  { id: '15m', label: '15dk', sec: 900 },
  { id: '30m', label: '30dk', sec: 1800 },
  { id: '1h', label: '1s', sec: 3600 },
  { id: '4h', label: '4s', sec: 14400 },
  { id: '1d', label: '1G', sec: 86400 },
];
const TF_SEC = Object.fromEntries(TIMEFRAMES.map((t) => [t.id, t.sec]));
const DAY = 86400;
// Must match server/src/services/pricedata/timeframes.ts TF_MAX_SPAN.
const TF_MAX_SPAN = {
  '1m': 3 * DAY, '5m': 10 * DAY, '15m': 30 * DAY, '30m': 60 * DAY, '1h': 120 * DAY, '4h': 365 * DAY, '1d': 6 * 365 * DAY,
};

// ---------- Symbols ----------

const CRYPTO_BASES = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'LTC', 'TRX', 'TON',
  'MATIC', 'POL', 'SHIB', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'PEPE', 'UNI', 'BCH', 'ETC', 'FIL', 'INJ']);
const INDEX_ALIASES = {
  NAS100: 'NAS100', US100: 'NAS100', USTEC: 'NAS100', NDX: 'NAS100',
  US500: 'US500', SPX500: 'US500', SPX: 'US500', US30: 'US30', DJ30: 'US30', GER40: 'GER40', DE40: 'GER40',
};

/**
 * Client-side mirror of the server's resolveSymbol (canonical symbol only).
 * The server's /api/charts/symbols aliases are preferred when available.
 */
const normalizeSymbol = (raw) => {
  if (!raw) return '';
  let upper = String(raw).trim().toUpperCase();
  const word = upper.split('.')[0].replace(/[^A-Z]/g, '');
  if (word === 'GOLD') upper = 'XAUUSD';
  if (word === 'SILVER') upper = 'XAGUSD';
  const fx = parseForexSymbol(upper);
  if (fx) return fx.symbol;
  let s = upper.split(/[.:]/)[0].replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('PERP')) s = s.slice(0, -4);
  for (const q of ['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD']) {
    if (s.length > q.length && s.endsWith(q)) {
      let b = s.slice(0, -q.length);
      if (b === 'XBT') b = 'BTC';
      if (CRYPTO_BASES.has(b)) return `${b}USDT`;
    }
  }
  if (CRYPTO_BASES.has(s) && s.length >= 3) return `${s}USDT`;
  if (INDEX_ALIASES[s]) return INDEX_ALIASES[s];
  const m = upper.match(/^([A-Z]{1,5})(?:[.-]([A-Z]))?$/);
  if (m) return m[2] ? `${m[1]}-${m[2]}` : m[1];
  return s;
};

const isForexSymbol = (symbol) => !!parseForexSymbol(symbol);

// ---------- Trades ----------

const toSec = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const ms = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

const tradeSide = (t) => {
  const s = String(t.side || t.direction || '').toLowerCase();
  if (['sell', 'short', 'satış', 'satis'].includes(s)) return 'short';
  if (['buy', 'long', 'alış', 'alis'].includes(s)) return 'long';
  return Number(t.quantity) < 0 ? 'short' : 'long';
};
const sideLabel = (side) => (side === 'short' ? 'Satış' : 'Alış');

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n !== 0 ? n : null;
};

/** Geometry + P/L of a journal trade for drawing. Returns null without a usable entry. */
const tradeGeometry = (t) => {
  const entryTime = toSec(t.enterTime);
  const entryPrice = num(t.enterPrice);
  if (!entryTime || !entryPrice) return null;
  const exitTimeRaw = toSec(t.exitTime);
  const exitPrice = num(t.exitPrice);
  const open = !exitTimeRaw || !exitPrice || exitTimeRaw < entryTime;
  let pl = null;
  if (!open) {
    try {
      const v = getTradePL(t);
      pl = Number.isFinite(v) ? v : null;
    } catch { pl = null; }
  }
  const pick = (...keys) => {
    for (const k of keys) { const v = num(t[k]); if (v) return v; }
    return null;
  };
  return {
    id: t._id || t.id || `${t.ticker}-${t.enterTime}`,
    trade: t,
    side: tradeSide(t),
    entryTime,
    entryPrice,
    exitTime: open ? null : exitTimeRaw,
    exitPrice: open ? null : exitPrice,
    open,
    pl,
    stop: pick('stopLoss', 'stop_loss', 'sl', 'stopPrice', 'stop'),
    target: pick('takeProfit', 'take_profit', 'tp', 'targetPrice', 'target'),
  };
};

/** Picks a timeframe that shows a trade with ~20-60 bars plus margin, within the server span cap. */
const pickTimeframeForTrade = (g) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const dur = Math.max(60, (g.exitTime || nowSec) - g.entryTime);
  for (const tf of TIMEFRAMES) {
    const bars = dur / tf.sec;
    const margin = Math.max(dur * 0.8, 40 * tf.sec);
    if (bars <= 60 && dur + 2 * margin <= TF_MAX_SPAN[tf.id]) return tf.id;
  }
  return '1d';
};

/** Visible window (and fetch window) around a trade for a timeframe. */
const tradeWindow = (g, tf) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const sec = TF_SEC[tf];
  const end = g.exitTime || nowSec;
  const dur = Math.max(sec, end - g.entryTime);
  const margin = Math.max(dur * 0.8, 30 * sec);
  const view = { from: g.entryTime - margin, to: Math.min(nowSec, end + margin) };
  // Fetch a bit more than the view so the user can scroll around.
  const extra = Math.min(TF_MAX_SPAN[tf] - (view.to - view.from), Math.max(margin * 2, 150 * sec));
  const fetch = {
    from: Math.floor(view.from - Math.max(0, extra * 0.6)),
    to: Math.min(nowSec, Math.ceil(view.to + Math.max(0, extra * 0.4))),
  };
  return { view, fetch };
};

/** Latest candle time <= t (binary search); first candle if t is before the data. */
const snapToCandle = (times, t) => {
  if (!times.length) return null;
  if (t <= times[0]) return times[0];
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return times[lo];
};

// ---------- Indicators ----------

const sma = (candles, period) => {
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
};

const ema = (candles, period) => {
  const out = [];
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
};

const INDICATORS = [
  { key: 'sma9', type: 'SMA', period: 9, color: '#f59e0b' },
  { key: 'sma20', type: 'SMA', period: 20, color: '#38bdf8' },
  { key: 'sma50', type: 'SMA', period: 50, color: '#a78bfa' },
  { key: 'sma200', type: 'SMA', period: 200, color: '#f472b6' },
  { key: 'ema9', type: 'EMA', period: 9, color: '#fbbf24' },
  { key: 'ema20', type: 'EMA', period: 20, color: '#22d3ee' },
  { key: 'ema50', type: 'EMA', period: 50, color: '#c084fc' },
  { key: 'ema200', type: 'EMA', period: 200, color: '#fb7185' },
];

const computeIndicator = (ind, candles) => (ind.type === 'EMA' ? ema(candles, ind.period) : sma(candles, ind.period));

// ---------- Formatting ----------

/** Decimal places for prices of a symbol (pipette precision for forex). */
const pricePrecision = (symbol, sample) => {
  const pip = getPipSize(symbol);
  if (pip) return Math.max(0, Math.round(-Math.log10(pip)) + 1);
  const p = Math.abs(sample || 0);
  if (p >= 1000) return 2;
  if (p >= 1) return 2;
  if (p >= 0.01) return 4;
  if (p > 0) return 6;
  return 2;
};

const fmtPrice = (v, precision) => (Number.isFinite(v)
  ? v.toLocaleString('tr-TR', { minimumFractionDigits: precision, maximumFractionDigits: precision })
  : '-');

const fmtMoney = (v) => {
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: abs >= 100 || Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: abs >= 100 ? 0 : 2 });
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}$${s}`;
};

const fmtVolume = (v) => {
  if (!Number.isFinite(v) || v <= 0) return '-';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(v < 10 ? 2 : 0);
};

const fmtDateTime = (sec) => new Date(sec * 1000).toLocaleString('tr-TR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const fmtDateTimeFull = (sec, tf) => {
  const d = new Date(sec * 1000);
  if (tf === '1d') return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Label for the trade picker: "EURUSD Alış 25 Eki 14:32 +$42". */
const tradeLabel = (g) => {
  const parts = [g.symbol || normalizeSymbol(g.trade.ticker) || String(g.trade.ticker || '').toUpperCase(), sideLabel(g.side), fmtDateTime(g.entryTime)];
  if (g.open) parts.push('(açık)');
  else if (g.pl !== null) parts.push(fmtMoney(g.pl));
  return parts.join(' ');
};

// ---------- Theme ----------

const cssRgb = (name, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) {
      const parts = v.split(/[\s,]+/).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) return parts.slice(0, 3);
    }
  } catch { /* ignore */ }
  return fallback;
};
const rgba = (rgb, a = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

/** Chart colours derived from the app's CSS variables (dark defaults). */
const getChartTheme = () => {
  const bg = cssRgb('--bg-surface', [17, 17, 17]);
  const border = cssRgb('--border', [26, 26, 26]);
  const text = cssRgb('--text-secondary', [153, 153, 153]);
  const muted = cssRgb('--text-tertiary', [110, 110, 110]);
  const pos = cssRgb('--positive', [16, 185, 129]);
  const neg = cssRgb('--negative', [239, 68, 68]);
  const accent = cssRgb('--accent', [191, 255, 0]);
  const light = (bg[0] + bg[1] + bg[2]) / 3 > 128;
  return {
    bg: rgba(bg),
    text: rgba(text),
    muted: rgba(muted),
    grid: light ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)',
    border: rgba(border),
    crosshair: light ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.3)',
    up: rgba(pos),
    down: rgba(neg),
    upVol: rgba(pos, 0.35),
    downVol: rgba(neg, 0.35),
    pos: rgba(pos),
    neg: rgba(neg),
    accent: rgba(accent),
    entry: '#60a5fa',
    userLine: '#f59e0b',
    light,
  };
};

// ---------- Data ----------

const fetchCandles = async ({ symbol, tf, from, to, limit, signal }) => {
  const q = new URLSearchParams({ symbol, tf });
  if (from) q.set('from', new Date(from * 1000).toISOString());
  if (to) q.set('to', new Date(to * 1000).toISOString());
  if (limit) q.set('limit', String(limit));
  const res = await helper.authFetch(`/api/charts/candles?${q.toString()}`, signal ? { signal } : undefined);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!body) return { candles: [], error: 'Fiyat verisi alınamadı, daha sonra tekrar deneyin.' };
  if (!res.ok && !body.error) body.error = 'Fiyat verisi alınamadı, daha sonra tekrar deneyin.';
  if (!Array.isArray(body.candles)) body.candles = [];
  return body;
};

const mergeCandles = (a, b) => {
  if (!a.length) return b.slice();
  if (!b.length) return a.slice();
  const map = new Map();
  for (const c of a) map.set(c.time, c);
  for (const c of b) map.set(c.time, c);
  return Array.from(map.values()).sort((x, y) => x.time - y.time);
};

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

module.exports = {
  TIMEFRAMES, TF_SEC, TF_MAX_SPAN, INDICATORS,
  normalizeSymbol, isForexSymbol, getPipSize,
  toSec, tradeSide, sideLabel, tradeGeometry, pickTimeframeForTrade, tradeWindow, snapToCandle,
  sma, ema, computeIndicator,
  pricePrecision, fmtPrice, fmtMoney, fmtVolume, fmtDateTime, fmtDateTimeFull, tradeLabel,
  getChartTheme, fetchCandles, mergeCandles, readJson, writeJson,
};
