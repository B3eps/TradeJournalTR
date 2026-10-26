/** Shared types for the price-data service (candles for the "Fiyat Grafiği" page). */

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export type SymbolType = 'forex' | 'metal' | 'crypto' | 'stock';
export type SourceId = 'dukascopy' | 'binance' | 'yahoo';

export interface Candle {
  /** Candle open time, unix seconds (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ResolvedSymbol {
  /** Canonical display symbol, e.g. EURUSD, XAUUSD, BTCUSDT, AAPL. */
  symbol: string;
  name: string;
  type: SymbolType;
  source: SourceId;
  /** Symbol in the provider's own notation (eurusd, BTCUSDT, NQ=F ...). */
  providerSymbol: string;
}

/** A provider fetches candles for a closed interval [fromSec, toSec] (open times). */
export interface ProviderResult {
  candles: Candle[];
  /** Optional Turkish note (e.g. provider history limits). */
  note?: string;
  /** Earliest open time the provider can serve for this tf (used to mark coverage). */
  earliestAvailable?: number;
}

export interface CandleProvider {
  id: SourceId;
  fetch(sym: ResolvedSymbol, tf: Timeframe, fromSec: number, toSec: number): Promise<ProviderResult>;
  /** Hard timeout for one provider call in ms. */
  timeoutMs: number;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}
