import type { Db } from '../../db/connection';
import type { Candle, Timeframe } from './types';
import { TF_SECONDS, alignDown } from './timeframes';

// =====================================================
// SQLite candle cache + coverage bookkeeping.
// price_candles   : one row per (symbol, tf, open time)
// price_coverage  : closed [start, end] second ranges already fetched from the
//                   provider (even when empty, e.g. weekends), so repeated views
//                   never hit the provider again. A range that reached the live
//                   edge carries live_until: until then it also covers "now".
// Tables are created lazily on first use.
// =====================================================

const DDL = `
CREATE TABLE IF NOT EXISTS price_candles (
  symbol TEXT NOT NULL,
  tf     TEXT NOT NULL,
  time   INTEGER NOT NULL,
  o      REAL NOT NULL,
  h      REAL NOT NULL,
  l      REAL NOT NULL,
  c      REAL NOT NULL,
  v      REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, tf, time)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS price_coverage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol     TEXT NOT NULL,
  tf         TEXT NOT NULL,
  start      INTEGER NOT NULL,
  "end"      INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  live_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_price_coverage_key ON price_coverage(symbol, tf, start);
`;

const ready = new WeakSet<Db>();

export function ensurePriceTables(db: Db): void {
  if (ready.has(db)) return;
  db.exec(DDL);
  ready.add(db);
}

export interface CoverageRange {
  start: number;
  end: number;
  fetchedAt: number;
  liveUntil: number;
}

export function readCandles(db: Db, symbol: string, tf: Timeframe, from: number, to: number): Candle[] {
  ensurePriceTables(db);
  const rows = db
    .prepare('SELECT time, o, h, l, c, v FROM price_candles WHERE symbol = ? AND tf = ? AND time >= ? AND time <= ? ORDER BY time ASC')
    .all(symbol, tf, from, to) as Array<{ time: number; o: number; h: number; l: number; c: number; v: number }>;
  return rows.map((r) => ({ time: r.time, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
}

/** Oldest cached candle time for (symbol, tf), or null. */
export function oldestCachedTime(db: Db, symbol: string, tf: Timeframe): number | null {
  ensurePriceTables(db);
  const row = db.prepare('SELECT MIN(time) AS t FROM price_candles WHERE symbol = ? AND tf = ?').get(symbol, tf) as { t: number | null };
  return row?.t ?? null;
}

function validCandle(c: Candle): boolean {
  return [c.time, c.open, c.high, c.low, c.close].every((n) => typeof n === 'number' && Number.isFinite(n))
    && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0;
}

export function writeCandles(db: Db, symbol: string, tf: Timeframe, candles: Candle[]): number {
  ensurePriceTables(db);
  const ins = db.prepare('INSERT OR REPLACE INTO price_candles (symbol, tf, time, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  let n = 0;
  const run = db.transaction((list: Candle[]) => {
    for (const c of list) {
      if (!validCandle(c)) continue;
      ins.run(symbol, tf, Math.floor(c.time), c.open, c.high, c.low, c.close, Number.isFinite(c.volume) ? c.volume : 0);
      n++;
    }
  });
  run(candles);
  return n;
}

export function getCoverage(db: Db, symbol: string, tf: Timeframe): CoverageRange[] {
  ensurePriceTables(db);
  const rows = db
    .prepare('SELECT start, "end" AS e, fetched_at, live_until FROM price_coverage WHERE symbol = ? AND tf = ? ORDER BY start ASC')
    .all(symbol, tf) as Array<{ start: number; e: number; fetched_at: number; live_until: number }>;
  return rows.map((r) => ({ start: r.start, end: r.e, fetchedAt: r.fetched_at, liveUntil: r.live_until }));
}

/**
 * Records [start, end] as fetched and merges it with overlapping / adjacent
 * ranges. The merged range inherits fetched_at / live_until from whichever
 * range contributes the furthest end (the freshest information about it).
 */
export function addCoverage(db: Db, symbol: string, tf: Timeframe, range: CoverageRange): void {
  ensurePriceTables(db);
  if (!(range.end >= range.start)) return;
  const gap = TF_SECONDS[tf];
  const run = db.transaction(() => {
    const overlapping = db
      .prepare('SELECT id, start, "end" AS e, fetched_at, live_until FROM price_coverage WHERE symbol = ? AND tf = ? AND start <= ? AND "end" >= ?')
      .all(symbol, tf, range.end + gap, range.start - gap) as Array<{ id: number; start: number; e: number; fetched_at: number; live_until: number }>;
    let merged = { ...range };
    for (const r of overlapping) {
      const other: CoverageRange = { start: r.start, end: r.e, fetchedAt: r.fetched_at, liveUntil: r.live_until };
      const tail = other.end > merged.end || (other.end === merged.end && other.fetchedAt > merged.fetchedAt) ? other : merged;
      merged = {
        start: Math.min(merged.start, other.start),
        end: Math.max(merged.end, other.end),
        fetchedAt: tail.fetchedAt,
        liveUntil: tail.liveUntil,
      };
    }
    if (overlapping.length) {
      const del = db.prepare('DELETE FROM price_coverage WHERE id = ?');
      for (const r of overlapping) del.run(r.id);
    }
    db.prepare('INSERT INTO price_coverage (symbol, tf, start, "end", fetched_at, live_until) VALUES (?, ?, ?, ?, ?, ?)')
      .run(symbol, tf, merged.start, merged.end, merged.fetchedAt, merged.liveUntil);
  });
  run();
}

/**
 * Sub-ranges of [from, to] not covered by cached coverage. A range whose
 * live_until has not passed yet is treated as covering up to "now".
 * Output ranges are aligned to candle boundaries.
 */
export function missingRanges(coverage: CoverageRange[], from: number, to: number, tf: Timeframe, nowSec: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cursor = from;
  const sorted = [...coverage].sort((a, b) => a.start - b.start);
  for (const r of sorted) {
    if (cursor > to) break;
    const effEnd = r.liveUntil > nowSec ? Number.POSITIVE_INFINITY : r.end;
    if (effEnd < cursor) continue;
    if (r.start > cursor) out.push([cursor, Math.min(to, r.start - 1)]);
    cursor = Math.max(cursor, effEnd === Number.POSITIVE_INFINITY ? to + 1 : effEnd + 1);
  }
  if (cursor <= to) out.push([cursor, to]);
  const step = TF_SECONDS[tf];
  // Align to bucket boundaries and drop ranges that cannot contain a candle open.
  return out
    .map(([a, b]) => [alignDown(a, tf), b] as [number, number])
    .filter(([a, b]) => b >= a && Math.floor(b / step) * step >= a);
}

/** Merges ranges into at most `max` requests by bridging the smallest gaps. */
export function coalesceRanges(ranges: Array<[number, number]>, max: number): Array<[number, number]> {
  const list = ranges.map((r) => [...r] as [number, number]);
  while (list.length > max) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < list.length - 1; i++) {
      const g = list[i + 1][0] - list[i][1];
      if (g < bestGap) { bestGap = g; best = i; }
    }
    list.splice(best, 2, [list[best][0], list[best + 1][1]]);
  }
  return list;
}

/** Drops all cached candles and coverage (used by the check script). */
export function clearPriceCache(db: Db, symbol?: string): void {
  ensurePriceTables(db);
  if (symbol) {
    db.prepare('DELETE FROM price_candles WHERE symbol = ?').run(symbol);
    db.prepare('DELETE FROM price_coverage WHERE symbol = ?').run(symbol);
  } else {
    db.exec('DELETE FROM price_candles; DELETE FROM price_coverage;');
  }
}
