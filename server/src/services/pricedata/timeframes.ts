import type { Timeframe } from './types';

const DAY = 86400;

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

export const TF_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 4 * 3600,
  '1d': DAY,
};

/**
 * Largest span served by one /candles request per timeframe (~1.5-4k bars).
 * Keeps provider requests small; the client pages older data on demand.
 */
export const TF_MAX_SPAN: Record<Timeframe, number> = {
  '1m': 3 * DAY,
  '5m': 10 * DAY,
  '15m': 30 * DAY,
  '30m': 60 * DAY,
  '1h': 120 * DAY,
  '4h': 365 * DAY,
  '1d': 6 * 365 * DAY,
};

/** How long the still-forming (latest) candle may be served from cache. */
export const TF_LIVE_TTL_SEC: Record<Timeframe, number> = {
  '1m': 30,
  '5m': 60,
  '15m': 90,
  '30m': 120,
  '1h': 180,
  '4h': 300,
  '1d': 600,
};

export function isTimeframe(v: unknown): v is Timeframe {
  return typeof v === 'string' && (TIMEFRAMES as string[]).includes(v);
}

export function alignDown(sec: number, tf: Timeframe): number {
  const s = TF_SECONDS[tf];
  return Math.floor(sec / s) * s;
}

export function alignUp(sec: number, tf: Timeframe): number {
  const s = TF_SECONDS[tf];
  return Math.ceil(sec / s) * s;
}

/** Re-buckets candles into a coarser timeframe (UTC-aligned buckets). Input must be sorted. */
export function aggregateCandles<T extends { time: number; open: number; high: number; low: number; close: number; volume: number }>(
  candles: T[],
  tf: Timeframe,
): Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> {
  const out: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = [];
  for (const c of candles) {
    const t = alignDown(c.time, tf);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume || 0;
    } else {
      out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
    }
  }
  return out;
}
