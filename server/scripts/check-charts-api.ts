/**
 * Throwaway sanity check for the price-data service ("Fiyat Grafiği").
 *  (a) cache / coverage logic against a fake provider in a temporary DATA_DIR
 *  (b) ONE small live fetch per real provider (Dukascopy, Binance, Yahoo)
 * No server/port is started.  Usage: npx tsx server/scripts/check-charts-api.ts [--offline]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'charts-check-'));
process.env.DATA_DIR = tmp;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
}

async function main() {
  const { getDb } = await import('../src/db/connection');
  const svc = await import('../src/services/pricedata');
  const cache = await import('../src/services/pricedata/cache');
  const { resolveSymbol, buildSymbolList } = await import('../src/services/pricedata/symbols');
  const { ProviderError } = await import('../src/services/pricedata/types');
  type Provider = import('../src/services/pricedata/types').CandleProvider;

  // ── Symbol normalisation ──
  const r = (s: string) => resolveSymbol(s);
  check('EURUSD.m -> EURUSD/dukascopy', r('EURUSD.m')?.symbol === 'EURUSD' && r('EURUSD.m')?.providerSymbol === 'eurusd');
  check('EUR/USD -> EURUSD', r('EUR/USD')?.symbol === 'EURUSD');
  check('xauusd+ -> XAUUSD metal', r('xauusd+')?.type === 'metal');
  check('GOLD -> XAUUSD', r('GOLD')?.symbol === 'XAUUSD');
  check('BTC/USD -> BTCUSDT binance', r('BTC/USD')?.symbol === 'BTCUSDT' && r('BTC/USD')?.source === 'binance');
  check('ETHUSDT -> ETHUSDT', r('ETHUSDT')?.symbol === 'ETHUSDT');
  check('AAPL -> yahoo stock', r('AAPL')?.source === 'yahoo' && r('AAPL')?.type === 'stock');
  check('NAS100 -> ^NDX', r('NAS100')?.providerSymbol === '^NDX');
  check('MNQZ25 -> NQ=F', r('MNQZ25')?.providerSymbol === 'NQ=F', r('MNQZ25'));
  check('garbage rejected', r('<script>') === null && r('') === null && r('A'.repeat(40)) === null);
  const list = buildSymbolList(['EURUSD.m', 'BTCUSD', 'nonsense!!']);
  check('journal aliases merged', list.find((s) => s.symbol === 'EURUSD')?.aliases?.[0] === 'EURUSD.m' && !!list.find((s) => s.symbol === 'BTCUSDT')?.inJournal);

  // ── Range helpers ──
  const mr = cache.missingRanges([{ start: 1000, end: 1999, fetchedAt: 0, liveUntil: 0 }], 0, 3599, '1m', 10_000);
  check('missingRanges splits around coverage', JSON.stringify(mr) === JSON.stringify([[0, 999], [1980, 3599]]), mr);
  check('coalesceRanges bridges smallest gap', JSON.stringify(cache.coalesceRanges([[0, 10], [20, 30], [100, 110]], 2)) === '[[0,30],[100,110]]');

  // ── Cache logic with a fake provider ──
  const H = 3600;
  let fakeNow = Date.UTC(2026, 9, 21, 12, 30); // Wed 12:30 UTC
  const calls: Array<[number, number]> = [];
  // Number of upcoming provider calls that fail. Dukascopy errors fall back to Yahoo (same fake here),
  // so a full provider outage needs both the primary call and the fallback call to fail.
  let failNext = 0;
  const fake: Provider = {
    id: 'dukascopy',
    timeoutMs: 2000,
    async fetch(_sym, tf, from, to) {
      calls.push([from, to]);
      if (failNext > 0) { failNext -= 1; throw new ProviderError('timeout'); }
      const out = [];
      const nowS = Math.floor(fakeNow / 1000);
      for (let t = Math.ceil(from / H) * H; t <= Math.min(to, nowS); t += H) {
        out.push({ time: t, open: 1.1, high: 1.2, low: 1.0, close: 1.15 + (t === Math.floor(nowS / H) * H ? fakeNow / 1e15 : 0), volume: 5 });
      }
      return { candles: tf === '1h' ? out : [] };
    },
  };
  const service = svc.createPriceService({
    db: getDb,
    providers: { dukascopy: fake, binance: fake, yahoo: fake },
    now: () => fakeNow,
    spacingMs: { dukascopy: 0, binance: 0, yahoo: 0 },
  });
  const nowS = () => Math.floor(fakeNow / 1000);
  const from1 = nowS() - 48 * H;
  const to1 = nowS() - 24 * H;

  const a = await service.getCandles({ symbol: 'EURUSD', tf: '1h', from: from1, to: to1 });
  check('first historic request hits provider', calls.length === 1 && !a.cached, { calls, cached: a.cached });
  check('historic candles returned (25)', a.candles.length === 25, a.candles.length);
  const b = await service.getCandles({ symbol: 'EURUSD.m', tf: '1h', from: from1, to: to1 });
  check('repeat request served from cache', calls.length === 1 && b.cached && b.candles.length === 25);

  // Overlapping, wider request: only the missing tail is fetched
  calls.length = 0;
  const c = await service.getCandles({ symbol: 'EURUSD', tf: '1h', from: from1, to: nowS() });
  check('wider request fetches only missing range', calls.length === 1 && calls[0][0] >= to1 - H, calls);
  check('wider request returns all candles', c.candles.length === 49, c.candles.length);

  // Within live TTL: no refetch; after TTL: only the tail
  calls.length = 0;
  fakeNow += 60 * 1000;
  await service.getCandles({ symbol: 'EURUSD', tf: '1h', from: from1, to: nowS() });
  check('live edge cached within TTL', calls.length === 0, calls);
  fakeNow += 10 * 60 * 1000;
  const d = await service.getCandles({ symbol: 'EURUSD', tf: '1h', from: from1, to: nowS() });
  check('after TTL only latest candle range refetched', calls.length === 1 && calls[0][0] >= nowS() - 2 * H, calls);
  check('latest candle updated in cache', d.candles.length === 49 && d.candles[d.candles.length - 1].close > 1.15);

  // Provider failure -> soft error with cached data, never throws
  calls.length = 0;
  failNext = 2; // primary (dukascopy) + Yahoo fallback both fail
  const e = await service.getCandles({ symbol: 'EURUSD', tf: '1h', from: from1 - 24 * H, to: nowS() });
  check('provider failure returns Turkish error + cached candles', !!e.error && e.candles.length >= 49, { error: e.error, n: e.candles.length });
  const e2 = await service.getCandles({ symbol: 'EURUSD', tf: '1h', from: from1 - 24 * H, to: from1 - 1 });
  check('failed range retried later and filled', !e2.error && e2.candles.length === 25, { error: e2.error, n: e2.candles.length });

  // Empty ranges (weekend / no data) are remembered too
  calls.length = 0;
  await service.getCandles({ symbol: 'EURUSD', tf: '1d', from: from1, to: to1 });
  await service.getCandles({ symbol: 'EURUSD', tf: '1d', from: from1, to: to1 });
  check('empty historic range cached (1 call for 2 requests)', calls.length === 1, calls);

  // Span cap
  const capped = await service.getCandles({ symbol: 'EURUSD', tf: '1m', from: nowS() - 30 * 86400, to: nowS() });
  check('1m span capped to 3 days', capped.capped === true && capped.range.to - capped.range.from <= 3 * 86400 + 60, capped.range);

  // Limit
  const lim = await service.getCandles({ symbol: 'EURUSD', tf: '1h', from: from1, to: nowS(), limit: 10 });
  check('limit keeps latest N', lim.candles.length === 10 && lim.candles[9].time === d.candles[d.candles.length - 1].time);

  if (process.argv.includes('--offline')) return;

  // ── ONE live fetch per provider (a few candles each) ──
  console.log('\nLive provider check (one small request each):');
  const { PROVIDERS } = await import('../src/services/pricedata/providers');
  const live = async (label: string, raw: string, tf: '1h' | '5m', hours: number) => {
    const sym = resolveSymbol(raw)!;
    const p = PROVIDERS[sym.source];
    // A recent weekday window so forex has data even on weekends.
    const end = new Date();
    while (end.getUTCDay() === 0 || end.getUTCDay() === 6) end.setUTCDate(end.getUTCDate() - 1);
    end.setUTCHours(Math.min(end.getUTCHours(), 18), 0, 0, 0);
    const to = Math.floor(end.getTime() / 1000) - 3600;
    const from = to - hours * 3600;
    const t0 = Date.now();
    try {
      const res = await Promise.race([
        p.fetch(sym, tf, from, to),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), p.timeoutMs)),
      ]);
      const last = res.candles[res.candles.length - 1];
      console.log(`  ${label.padEnd(10)} ${sym.symbol.padEnd(8)} ${tf}: ${res.candles.length} candles in ${Date.now() - t0} ms${last ? ` (last ${new Date(last.time * 1000).toISOString()} close ${last.close})` : ''}${res.note ? ` note: ${res.note}` : ''}`);
    } catch (err: any) {
      console.log(`  ${label.padEnd(10)} ${sym.symbol.padEnd(8)} ${tf}: FAILED after ${Date.now() - t0} ms: ${err?.message || err}`);
    }
  };
  await live('dukascopy', 'EURUSD.m', '1h', 6);
  await live('binance', 'BTCUSDT', '1h', 6);
  await live('yahoo', 'AAPL', '5m', 30);
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll cache checks passed');
  })
  .catch((err) => {
    console.error('Check script crashed:', err);
    failures++;
  })
  .finally(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* db may still be open on Windows */ }
    process.exit(failures ? 1 : 0);
  });
