import type { Db } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { Candle, CandleProvider, ResolvedSymbol, SourceId, Timeframe } from './types';
import { ProviderError } from './types';
import { TF_LIVE_TTL_SEC, TF_MAX_SPAN, TF_SECONDS, alignDown } from './timeframes';
import { addCoverage, coalesceRanges, getCoverage, missingRanges, readCandles, writeCandles } from './cache';
import { RateLimiter, withTimeout } from './http';
import { PROVIDERS } from './providers';
import { resolveSymbol } from './symbols';

export { resolveSymbol, buildSymbolList, listJournalTickers } from './symbols';
export { TIMEFRAMES, isTimeframe } from './timeframes';
export type { Candle, Timeframe } from './types';

export const SOURCE_LABEL: Record<SourceId, string> = {
  dukascopy: 'Dukascopy',
  binance: 'Binance',
  yahoo: 'Yahoo Finance',
};

const MAX_REQUESTS_PER_CALL = 3;
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 5000;

export interface CandleQuery {
  symbol: string;
  tf: Timeframe;
  /** unix seconds; optional */
  from?: number;
  /** unix seconds; optional (defaults to now) */
  to?: number;
  limit?: number;
}

export interface CandleResponse {
  symbol: string;
  tf: Timeframe;
  candles: Candle[];
  source: string;
  cached: boolean;
  /** Effective range served (after span capping), unix seconds. */
  range: { from: number; to: number };
  /** True when the span was capped (client can page older data). */
  capped?: boolean;
  note?: string;
  error?: string;
}

export interface PriceServiceDeps {
  db: () => Db;
  providers: Record<SourceId, CandleProvider>;
  now?: () => number; // ms
  spacingMs?: Partial<Record<SourceId, number>>;
}

const ERROR_TEXT = {
  generic: 'Fiyat verisi alınamadı, daha sonra tekrar deneyin.',
  timeout: 'Veri sağlayıcısı zamanında yanıt vermedi, birazdan tekrar deneyin.',
  unsupported: 'Bu sembol için veri sağlayıcısında fiyat verisi bulunamadı.',
  rate: 'Veri sağlayıcısı istek sınırına ulaşıldı, biraz sonra tekrar deneyin.',
};

function forexFallback(sym: ResolvedSymbol): ResolvedSymbol | null {
  const s = sym.symbol;
  if (s === 'XAUUSD') return { ...sym, source: 'yahoo', providerSymbol: 'GC=F' };
  if (s === 'XAGUSD') return { ...sym, source: 'yahoo', providerSymbol: 'SI=F' };
  if (/^[A-Z]{6}$/.test(s)) return { ...sym, source: 'yahoo', providerSymbol: `${s}=X` };
  return null;
}

function errorText(err: unknown): string {
  if (err instanceof ProviderError) {
    if (err.message === 'unsupported_instrument') return ERROR_TEXT.unsupported;
    if (err.message === 'timeout') return ERROR_TEXT.timeout;
    if (err.status === 429 || err.status === 418) return ERROR_TEXT.rate;
  }
  return ERROR_TEXT.generic;
}

export function createPriceService(deps: PriceServiceDeps) {
  const now = deps.now || (() => Date.now());
  const spacing: Record<SourceId, number> = { dukascopy: 400, binance: 250, yahoo: 1000, ...(deps.spacingMs || {}) };
  const limiters: Record<SourceId, RateLimiter> = {
    dukascopy: new RateLimiter(spacing.dukascopy),
    binance: new RateLimiter(spacing.binance),
    yahoo: new RateLimiter(spacing.yahoo),
  };
  const inflight = new Map<string, Promise<{ note?: string }>>();
  let providerCalls = 0;

  /** Fetches one missing range from the provider and persists it (even if the caller times out). */
  function fetchAndStore(sym: ResolvedSymbol, tf: Timeframe, start: number, end: number): Promise<{ note?: string }> {
    const key = `${sym.source}|${sym.symbol}|${tf}|${start}|${end}`;
    const existing = inflight.get(key);
    if (existing) return existing;
    const provider = deps.providers[sym.source];
    const task = limiters[sym.source].schedule(async () => {
      providerCalls++;
      try {
        return await provider.fetch(sym, tf, start, end);
      } catch (err: any) {
        // Dukascopy needs a headless browser for its bot challenge: fall back to Yahoo for forex/metals.
        const fb = sym.source === 'dukascopy' ? forexFallback(sym) : null;
        if (!fb || !deps.providers.yahoo) throw err;
        console.warn(`[PriceData] dukascopy failed for ${sym.symbol} (${err?.message || err}); falling back to Yahoo (${fb.providerSymbol})`);
        const r = await deps.providers.yahoo.fetch(fb, tf, start, end);
        return { ...r, note: ['Dukascopy erişilemedi, Yahoo Finance verisi kullanıldı (geçmiş sınırlı).', r.note].filter(Boolean).join(' ') };
      }
    }).then((res) => {
      const db = deps.db();
      const fetchedAtSec = Math.floor(now() / 1000);
      const step = TF_SECONDS[tf];
      const candles = res.candles.filter((c) => c.time >= start && c.time <= end);
      writeCandles(db, sym.symbol, tf, candles);
      const reachesLive = end >= alignDown(fetchedAtSec, tf) - step;
      if (reachesLive) {
        // Only claim coverage up to (excluding) the last candle received: it may
        // still be forming, and the provider may lag. Until live_until the cached
        // tail is served as-is; afterwards the tail is re-fetched.
        const last = candles.length ? candles[candles.length - 1].time : null;
        const claimEnd = last !== null ? last - 1 : Math.max(start - 1, fetchedAtSec - 3 * 86400);
        addCoverage(db, sym.symbol, tf, {
          start, end: Math.max(start, claimEnd), fetchedAt: fetchedAtSec, liveUntil: fetchedAtSec + TF_LIVE_TTL_SEC[tf],
        });
      } else {
        addCoverage(db, sym.symbol, tf, { start, end, fetchedAt: fetchedAtSec, liveUntil: 0 });
      }
      return { note: res.note };
    });
    inflight.set(key, task);
    task.finally(() => inflight.delete(key)).catch(() => undefined);
    return task;
  }

  async function getCandles(q: CandleQuery, resolved?: ResolvedSymbol): Promise<CandleResponse> {
    const sym = resolved || resolveSymbol(q.symbol);
    const tf = q.tf;
    const nowSec = Math.floor(now() / 1000);
    const step = TF_SECONDS[tf];
    const limit = Math.min(MAX_LIMIT, Math.max(1, q.limit || DEFAULT_LIMIT));
    if (!sym) {
      return { symbol: String(q.symbol || ''), tf, candles: [], source: '', cached: false, range: { from: 0, to: 0 }, error: ERROR_TEXT.unsupported };
    }

    let to = Math.min(q.to ?? nowSec, nowSec);
    // Default window: `limit` bars (x1.5 for markets with weekend gaps).
    const weekendFactor = sym.type === 'crypto' ? 1 : 1.5;
    let from = q.from ?? to - Math.ceil(limit * step * weekendFactor);
    let capped = false;
    if (to - from > TF_MAX_SPAN[tf]) {
      capped = true;
      if (q.from !== undefined && q.to === undefined) to = Math.min(nowSec, from + TF_MAX_SPAN[tf]);
      else from = to - TF_MAX_SPAN[tf];
    }
    from = alignDown(from, tf);
    const base: Omit<CandleResponse, 'candles' | 'cached'> = { symbol: sym.symbol, tf, source: SOURCE_LABEL[sym.source], range: { from, to }, ...(capped ? { capped } : {}) };

    const db = deps.db();
    const missing = coalesceRanges(missingRanges(getCoverage(db, sym.symbol, tf), from, to, tf, nowSec), MAX_REQUESTS_PER_CALL);
    const notes = new Set<string>();
    let error: string | undefined;
    const provider = deps.providers[sym.source];
    for (const [a, b] of missing) {
      try {
        const r = await withTimeout(fetchAndStore(sym, tf, a, b), provider.timeoutMs + 2000);
        if (r.note) notes.add(r.note);
      } catch (err: any) {
        console.warn(`[PriceData] ${sym.source} ${sym.symbol} ${tf} ${new Date(a * 1000).toISOString()}..${new Date(b * 1000).toISOString()} failed:`, err?.message || err);
        error = errorText(err);
        break; // don't hammer a failing provider within one request
      }
    }

    let candles = readCandles(db, sym.symbol, tf, from, to);
    if (candles.length > limit) candles = candles.slice(candles.length - limit);
    const out: CandleResponse = { ...base, candles, cached: missing.length === 0 };
    if (notes.size) out.note = Array.from(notes).join(' ');
    if (error) {
      out.error = candles.length ? `${error} Önbellekteki veriler gösteriliyor.` : error;
    }
    return out;
  }

  return { getCandles, get providerCalls() { return providerCalls; } };
}

let defaultService: ReturnType<typeof createPriceService> | null = null;

export function getPriceService() {
  if (!defaultService) defaultService = createPriceService({ db: getDb, providers: PROVIDERS });
  return defaultService;
}
