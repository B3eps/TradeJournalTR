import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import {
  buildSymbolList, getPriceService, isTimeframe, listJournalTickers, resolveSymbol, MAX_LIMIT, TIMEFRAMES,
} from '../services/pricedata';
import { RAW_SYMBOL_RE } from '../services/pricedata/symbols';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

// "Fiyat Grafiği": candles for the price chart page (services/pricedata).
// Provider failures never surface as HTTP errors: the body carries a Turkish
// `error` with HTTP 200 so the page can show a banner and cached data.

const charts = new Hono<HonoEnv>();

/** Accepts ISO 8601 strings or unix seconds / milliseconds. Returns unix seconds, undefined, or NaN (invalid). */
function parseTime(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw.length > 40) return NaN;
  if (/^\d{9,13}$/.test(raw)) {
    const n = Number(raw);
    return Math.floor(raw.length >= 12 ? n / 1000 : n);
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

const MIN_TIME = Date.UTC(1990, 0, 1) / 1000;

// GET /api/charts/symbols -> { symbols: [{ symbol, name, type, source, inJournal?, aliases? }] }
charts.get('/api/charts/symbols', requiresLogin, (c) => {
  try {
    const user = c.get('user');
    const db = c.get('db');
    let tickers: string[] = [];
    try {
      tickers = listJournalTickers(db, user.id);
    } catch (err: any) {
      console.warn('[Charts] journal tickers failed:', err?.message || err);
    }
    return c.json({ symbols: buildSymbolList(tickers) });
  } catch (err: any) {
    console.error('[Charts] symbols failed:', err?.message || err);
    return c.json({ symbols: buildSymbolList([]), error: 'Sembol listesi yüklenemedi.' });
  }
});

// GET /api/charts/candles?symbol=&tf=1m|5m|15m|30m|1h|4h|1d&from=ISO&to=ISO&limit=
charts.get('/api/charts/candles', requiresLogin, async (c) => {
  const rawSymbol = (c.req.query('symbol') || '').trim();
  const tf = c.req.query('tf') || '1h';
  const limitRaw = c.req.query('limit');

  if (!rawSymbol || !RAW_SYMBOL_RE.test(rawSymbol)) return c.json({ error: 'Geçersiz sembol.', candles: [] }, 400);
  if (!isTimeframe(tf)) return c.json({ error: `Geçersiz zaman dilimi. Geçerli değerler: ${TIMEFRAMES.join(', ')}`, candles: [] }, 400);

  const from = parseTime(c.req.query('from'));
  const to = parseTime(c.req.query('to'));
  if (Number.isNaN(from) || Number.isNaN(to)) return c.json({ error: 'Geçersiz tarih (ISO 8601 bekleniyor).', candles: [] }, 400);
  const nowSec = Math.floor(Date.now() / 1000);
  if ((from !== undefined && (from < MIN_TIME || from > nowSec + 86400)) || (to !== undefined && to < MIN_TIME)) {
    return c.json({ error: 'Tarih aralığı desteklenmiyor.', candles: [] }, 400);
  }
  if (from !== undefined && to !== undefined && from >= to) {
    return c.json({ error: '"from" değeri "to" değerinden küçük olmalı.', candles: [] }, 400);
  }

  let limit: number | undefined;
  if (limitRaw !== undefined && limitRaw !== '') {
    if (!/^\d{1,5}$/.test(limitRaw)) return c.json({ error: 'Geçersiz limit.', candles: [] }, 400);
    limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(limitRaw, 10)));
  }

  const sym = resolveSymbol(rawSymbol);
  if (!sym) {
    return c.json({
      symbol: rawSymbol.toUpperCase(), tf, candles: [], source: '', cached: false, error: 'Bu sembol desteklenmiyor veya tanınmadı.',
    });
  }

  try {
    const res = await getPriceService().getCandles({ symbol: rawSymbol, tf, from, to, limit }, sym);
    return c.json(res);
  } catch (err: any) {
    console.error('[Charts] candles failed:', err?.message || err);
    return c.json({
      symbol: sym.symbol, tf, candles: [], source: '', cached: false, error: 'Fiyat verisi alınamadı, daha sonra tekrar deneyin.',
    });
  }
});

export default charts;
