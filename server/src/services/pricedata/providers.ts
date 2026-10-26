import path from 'node:path';
import { DATA_DIR } from '../../config';
import type { Candle, CandleProvider, ProviderResult, ResolvedSymbol, Timeframe } from './types';
import { ProviderError } from './types';
import { TF_SECONDS, aggregateCandles } from './timeframes';
import { DEFAULT_TIMEOUT_MS, getJson } from './http';

// =====================================================
// Candle providers. All are free public endpoints without API keys:
//  - Dukascopy (forex / metals) via the dukascopy-node package
//  - Binance public klines (crypto), fallback host data-api.binance.vision
//  - Yahoo Finance chart JSON (stocks / ETFs / indices), unofficial, personal use
// Each returns candles with UTC open times in seconds; never touches the DB.
// =====================================================

function sortDedupe(candles: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of candles) map.set(c.time, c);
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

// ---------- Dukascopy ----------

const DUKA_TF: Record<Timeframe, 'm1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h4' | 'd1'> = {
  '1m': 'm1', '5m': 'm5', '15m': 'm15', '30m': 'm30', '1h': 'h1', '4h': 'h4', '1d': 'd1',
};

let dukaModule: Promise<typeof import('dukascopy-node')> | null = null;
const loadDuka = () => {
  if (!dukaModule) dukaModule = import('dukascopy-node');
  return dukaModule;
};

export const dukascopyProvider: CandleProvider = {
  id: 'dukascopy',
  // Dukascopy sits behind an AWS WAF: the first call of a session solves the
  // challenge in headless Chrome (dukascopy-node), which can take ~20 s. The
  // token is cached in DATA_DIR afterwards so later calls are fast.
  timeoutMs: 30 * 1000,
  async fetch(sym: ResolvedSymbol, tf: Timeframe, fromSec: number, toSec: number): Promise<ProviderResult> {
    const duka = await loadDuka();
    const meta = (duka.instrumentMetaData as Record<string, unknown>)[sym.providerSymbol];
    if (!meta) throw new ProviderError('unsupported_instrument');
    const nowMs = Date.now();
    const toMs = Math.min((toSec + 1) * 1000, nowMs);
    if (toMs <= fromSec * 1000) return { candles: [] };
    let rows: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }>;
    try {
      rows = await duka.getHistoricalRates({
        instrument: sym.providerSymbol as any,
        dates: { from: new Date(fromSec * 1000), to: new Date(toMs) },
        timeframe: DUKA_TF[tf],
        format: 'json',
        priceType: 'bid',
        volumes: true,
        ignoreFlats: true,
        batchSize: 5,
        pauseBetweenBatchesMs: 250,
        retryCount: 1,
        pauseBetweenRetriesMs: 500,
        wafMode: 'auto',
        wafTokenCache: true,
        wafTokenCachePath: path.join(DATA_DIR, 'dukascopy-waf-token.json'),
      });
    } catch (err: any) {
      throw new ProviderError(err?.code === 'DUKASCOPY_WAF_CHALLENGE' ? 'waf_challenge' : (err?.message || 'dukascopy_error'));
    }
    const candles = (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        time: Math.floor(r.timestamp / 1000),
        open: r.open, high: r.high, low: r.low, close: r.close,
        volume: typeof r.volume === 'number' ? r.volume : 0,
      }))
      .filter((c) => c.time >= fromSec && c.time <= toSec);
    return { candles: sortDedupe(candles) };
  },
};

// ---------- Binance ----------

const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
let binanceHostIdx = 0;
let binanceHostResetAt = 0;

type Kline = [number, string, string, string, string, string, ...unknown[]];

async function binanceKlines(params: string): Promise<Kline[]> {
  if (binanceHostIdx !== 0 && Date.now() > binanceHostResetAt) binanceHostIdx = 0;
  let lastErr: unknown;
  for (let i = binanceHostIdx; i < BINANCE_HOSTS.length; i++) {
    try {
      const data = await getJson<Kline[]>(`${BINANCE_HOSTS[i]}/api/v3/klines?${params}`, { timeoutMs: DEFAULT_TIMEOUT_MS });
      if (i !== binanceHostIdx) {
        binanceHostIdx = i;
        binanceHostResetAt = Date.now() + 60 * 60 * 1000; // retry primary after 1 h
      }
      return Array.isArray(data) ? data : [];
    } catch (err) {
      lastErr = err;
      const status = err instanceof ProviderError ? err.status : undefined;
      // 400 = bad symbol: no point retrying on the mirror.
      if (status === 400) throw new ProviderError('unsupported_instrument', 400);
      // 451/403 (geo block), 5xx, network/timeout -> try the next host
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError('binance_error');
}

export const binanceProvider: CandleProvider = {
  id: 'binance',
  timeoutMs: 25 * 1000, // covers pagination (each HTTP call has its own 10 s timeout)
  async fetch(sym, tf, fromSec, toSec) {
    const step = TF_SECONDS[tf];
    const out: Candle[] = [];
    let start = fromSec * 1000;
    const endMs = toSec * 1000 + step * 1000 - 1;
    for (let page = 0; page < 6 && start <= endMs; page++) {
      const q = new URLSearchParams({
        symbol: sym.providerSymbol, interval: tf, startTime: String(start), endTime: String(endMs), limit: '1000',
      });
      const rows = await binanceKlines(q.toString());
      for (const k of rows) {
        out.push({
          time: Math.floor(Number(k[0]) / 1000),
          open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
          volume: parseFloat(k[5]) || 0,
        });
      }
      if (rows.length < 1000) break;
      start = Number(rows[rows.length - 1][0]) + step * 1000;
    }
    return { candles: sortDedupe(out.filter((c) => c.time >= fromSec && c.time <= toSec)) };
  },
};

// ---------- Yahoo Finance ----------

const DAY = 86400;
const YAHOO_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m', '4h': '60m', '1d': '1d',
};
// How far back Yahoo serves each intraday interval (with a safety margin).
const YAHOO_LOOKBACK: Partial<Record<Timeframe, number>> = {
  '1m': 29 * DAY, '5m': 59 * DAY, '15m': 59 * DAY, '30m': 59 * DAY, '1h': 729 * DAY, '4h': 729 * DAY,
};

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

export const yahooProvider: CandleProvider = {
  id: 'yahoo',
  timeoutMs: DEFAULT_TIMEOUT_MS + 1000,
  async fetch(sym, tf, fromSec, toSec) {
    const nowSec = Math.floor(Date.now() / 1000);
    const lookback = YAHOO_LOOKBACK[tf];
    let note: string | undefined;
    let earliestAvailable: number | undefined;
    let from = fromSec;
    if (lookback) {
      earliestAvailable = nowSec - lookback;
      if (toSec < earliestAvailable) {
        return { candles: [], note: `Yahoo bu zaman dilimi için yalnızca son ${Math.round(lookback / DAY)} günü sağlıyor.`, earliestAvailable };
      }
      if (from < earliestAvailable) {
        from = earliestAvailable;
        note = `Yahoo bu zaman dilimi için yalnızca son ${Math.round(lookback / DAY)} günü sağlıyor.`;
      }
    }
    const q = new URLSearchParams({
      interval: YAHOO_INTERVAL[tf],
      period1: String(from),
      period2: String(Math.min(nowSec, toSec + TF_SECONDS[tf])),
      includePrePost: 'false',
      events: '',
    });
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.providerSymbol)}?${q.toString()}`;
    let data: YahooChart;
    try {
      data = await getJson<YahooChart>(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) throw new ProviderError('unsupported_instrument', 404);
      throw err;
    }
    const res = data?.chart?.result?.[0];
    if (!res) {
      const code = data?.chart?.error?.code;
      if (code === 'Not Found') throw new ProviderError('unsupported_instrument', 404);
      return { candles: [], note, earliestAvailable };
    }
    const ts = res.timestamp || [];
    const qd = res.indicators?.quote?.[0] || {};
    const raw: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = qd.open?.[i]; const h = qd.high?.[i]; const l = qd.low?.[i]; const c = qd.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      raw.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: qd.volume?.[i] ?? 0 });
    }
    raw.sort((a, b) => a.time - b.time);
    // Yahoo hourly bars start at :30 for US equities and 4h is not offered:
    // re-bucket everything onto UTC-aligned candle boundaries.
    const candles = aggregateCandles(raw, tf).filter((c) => c.time >= alignStart(fromSec, tf) && c.time <= toSec);
    return { candles, note, earliestAvailable };
  },
};

function alignStart(sec: number, tf: Timeframe) {
  const s = TF_SECONDS[tf];
  return Math.floor(sec / s) * s;
}

export const PROVIDERS: Record<'dukascopy' | 'binance' | 'yahoo', CandleProvider> = {
  dukascopy: dukascopyProvider,
  binance: binanceProvider,
  yahoo: yahooProvider,
};
