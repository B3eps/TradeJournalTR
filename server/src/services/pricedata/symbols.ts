import type { Db } from '../../db/connection';
import type { ResolvedSymbol, SymbolType } from './types';

// =====================================================
// Symbol normalisation: journal tickers (cTrader/MT5 style "EURUSD.m",
// "EUR/USD", "XAUUSD+", "BTC/USD", "NAS100") -> canonical symbol + source.
// Mirrors client/utils/tickValues.js parseForexSymbol (kept in TS here).
// =====================================================

const FX_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'TRY', 'SEK', 'NOK',
  'DKK', 'PLN', 'HUF', 'CZK', 'ZAR', 'MXN', 'SGD', 'HKD', 'CNH', 'ILS', 'RUB',
]);
const METALS = new Set(['XAU', 'XAG', 'XPT', 'XPD']);

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'ABD Doları', EUR: 'Euro', GBP: 'Sterlin', JPY: 'Japon Yeni', CHF: 'İsviçre Frangı',
  AUD: 'Avustralya Doları', NZD: 'Yeni Zelanda Doları', CAD: 'Kanada Doları', TRY: 'Türk Lirası',
  SEK: 'İsveç Kronu', NOK: 'Norveç Kronu', DKK: 'Danimarka Kronu', PLN: 'Polonya Zlotisi',
  HUF: 'Macar Forinti', CZK: 'Çek Korunası', ZAR: 'G. Afrika Randı', MXN: 'Meksika Pesosu',
  SGD: 'Singapur Doları', HKD: 'Hong Kong Doları', CNH: 'Çin Yuanı', ILS: 'İsrail Şekeli', RUB: 'Rus Rublesi',
  XAU: 'Altın', XAG: 'Gümüş', XPT: 'Platin', XPD: 'Paladyum',
};

export interface ParsedForex {
  symbol: string;
  base: string;
  quote: string;
  isMetal: boolean;
}

export function parseForexSymbol(ticker: unknown): ParsedForex | null {
  if (!ticker) return null;
  const s = String(ticker).toUpperCase().split('.')[0].replace(/[^A-Z]/g, '');
  if (s.length < 6) return null;
  const base = s.slice(0, 3);
  const quote = s.slice(3, 6);
  const baseOk = FX_CURRENCIES.has(base) || METALS.has(base);
  if (!baseOk || !FX_CURRENCIES.has(quote)) return null;
  return { symbol: base + quote, base, quote, isMetal: METALS.has(base) };
}

const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP', ADA: 'Cardano',
  DOGE: 'Dogecoin', AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin',
  TRX: 'TRON', TON: 'Toncoin', MATIC: 'Polygon', POL: 'Polygon', SHIB: 'Shiba Inu', ATOM: 'Cosmos',
  NEAR: 'NEAR', APT: 'Aptos', ARB: 'Arbitrum', OP: 'Optimism', SUI: 'Sui', PEPE: 'Pepe',
  UNI: 'Uniswap', BCH: 'Bitcoin Cash', ETC: 'Ethereum Classic', FIL: 'Filecoin', INJ: 'Injective',
};
const CRYPTO_ALIASES: Record<string, string> = { XBT: 'BTC' };
const CRYPTO_QUOTES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD'];

function parseCrypto(raw: string): { base: string } | null {
  let s = raw.toUpperCase().split(/[.:]/)[0].replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('PERP')) s = s.slice(0, -4);
  for (const q of CRYPTO_QUOTES) {
    if (s.length > q.length && s.endsWith(q)) {
      const b = s.slice(0, -q.length);
      const base = CRYPTO_ALIASES[b] || b;
      if (CRYPTO_NAMES[base]) return { base };
    }
  }
  const bare = CRYPTO_ALIASES[s] || s;
  if (CRYPTO_NAMES[bare] && bare.length >= 3) return { base: bare };
  return null;
}

// Index CFDs (broker names) and futures roots -> Yahoo Finance symbols.
const INDEX_CFDS: Record<string, { y: string; name: string; symbol: string }> = {
  NAS100: { y: '^NDX', name: 'Nasdaq 100 endeksi', symbol: 'NAS100' },
  US100: { y: '^NDX', name: 'Nasdaq 100 endeksi', symbol: 'NAS100' },
  USTEC: { y: '^NDX', name: 'Nasdaq 100 endeksi', symbol: 'NAS100' },
  NDX: { y: '^NDX', name: 'Nasdaq 100 endeksi', symbol: 'NAS100' },
  US500: { y: '^GSPC', name: 'S&P 500 endeksi', symbol: 'US500' },
  SPX500: { y: '^GSPC', name: 'S&P 500 endeksi', symbol: 'US500' },
  SPX: { y: '^GSPC', name: 'S&P 500 endeksi', symbol: 'US500' },
  US30: { y: '^DJI', name: 'Dow Jones endeksi', symbol: 'US30' },
  DJ30: { y: '^DJI', name: 'Dow Jones endeksi', symbol: 'US30' },
  GER40: { y: '^GDAXI', name: 'DAX 40 endeksi', symbol: 'GER40' },
  DE40: { y: '^GDAXI', name: 'DAX 40 endeksi', symbol: 'GER40' },
};
const FUTURES: Record<string, { y: string; name: string }> = {
  NQ: { y: 'NQ=F', name: 'Nasdaq 100 vadeli' }, MNQ: { y: 'NQ=F', name: 'Mikro Nasdaq 100 vadeli' },
  ES: { y: 'ES=F', name: 'S&P 500 vadeli' }, MES: { y: 'ES=F', name: 'Mikro S&P 500 vadeli' },
  YM: { y: 'YM=F', name: 'Dow vadeli' }, MYM: { y: 'YM=F', name: 'Mikro Dow vadeli' },
  RTY: { y: 'RTY=F', name: 'Russell 2000 vadeli' }, M2K: { y: 'RTY=F', name: 'Mikro Russell vadeli' },
  GC: { y: 'GC=F', name: 'Altın vadeli' }, MGC: { y: 'GC=F', name: 'Mikro altın vadeli' },
  SI: { y: 'SI=F', name: 'Gümüş vadeli' }, SIL: { y: 'SI=F', name: 'Mikro gümüş vadeli' },
  CL: { y: 'CL=F', name: 'Ham petrol vadeli' }, MCL: { y: 'CL=F', name: 'Mikro ham petrol vadeli' },
  NG: { y: 'NG=F', name: 'Doğalgaz vadeli' },
  ZB: { y: 'ZB=F', name: 'ABD 30Y tahvil vadeli' }, ZN: { y: 'ZN=F', name: 'ABD 10Y tahvil vadeli' },
  ZF: { y: 'ZF=F', name: 'ABD 5Y tahvil vadeli' },
};

const STOCK_NAMES: Record<string, string> = {
  AAPL: 'Apple', NVDA: 'NVIDIA', MSFT: 'Microsoft', QQQ: 'Invesco QQQ (Nasdaq 100 ETF)',
  TSLA: 'Tesla', AMZN: 'Amazon', META: 'Meta Platforms', GOOGL: 'Alphabet', AMD: 'AMD',
  SPY: 'SPDR S&P 500 ETF', NFLX: 'Netflix', AVGO: 'Broadcom', PLTR: 'Palantir', COIN: 'Coinbase',
};

function fxResolved(fx: ParsedForex): ResolvedSymbol {
  const type: SymbolType = fx.isMetal ? 'metal' : 'forex';
  return {
    symbol: fx.symbol,
    name: `${CURRENCY_NAMES[fx.base] || fx.base} / ${CURRENCY_NAMES[fx.quote] || fx.quote}`,
    type,
    source: 'dukascopy',
    providerSymbol: fx.symbol.toLowerCase(),
  };
}

/** Max length / charset accepted for raw symbols coming from the query string. */
export const RAW_SYMBOL_RE = /^[A-Za-z0-9./_\-+=!^:#\s]{1,24}$/;

/**
 * Resolves any journal or user-entered ticker to a canonical symbol and data source.
 * Returns null when the ticker cannot be mapped to a supported provider.
 */
export function resolveSymbol(raw: unknown): ResolvedSymbol | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || !RAW_SYMBOL_RE.test(trimmed)) return null;
  let upper = trimmed.toUpperCase();
  const word = upper.split('.')[0].replace(/[^A-Z]/g, '');
  if (word === 'GOLD') upper = 'XAUUSD';
  else if (word === 'SILVER') upper = 'XAGUSD';

  const fx = parseForexSymbol(upper);
  if (fx) return fxResolved(fx);

  const cr = parseCrypto(upper);
  if (cr) {
    return {
      symbol: `${cr.base}USDT`,
      name: `${CRYPTO_NAMES[cr.base]} / Tether`,
      type: 'crypto',
      source: 'binance',
      providerSymbol: `${cr.base}USDT`,
    };
  }

  const compact = upper.split('.')[0].replace(/[^A-Z0-9]/g, '');
  const idx = INDEX_CFDS[compact];
  if (idx) return { symbol: idx.symbol, name: idx.name, type: 'stock', source: 'yahoo', providerSymbol: idx.y };

  // Futures: plain root (NQ) or root + month code + year (NQZ5, MNQZ25).
  const futRoot = FUTURES[compact] ? compact : (compact.match(/^([A-Z0-9]{1,3}?)[FGHJKMNQUVXZ]\d{1,2}$/)?.[1] ?? '');
  if (futRoot && FUTURES[futRoot]) {
    return { symbol: futRoot, name: FUTURES[futRoot].name, type: 'stock', source: 'yahoo', providerSymbol: FUTURES[futRoot].y };
  }

  // US stock / ETF ticker (BRK.B style suffix -> BRK-B on Yahoo).
  const m = upper.match(/^([A-Z]{1,5})(?:[.-]([A-Z]))?$/);
  if (m) {
    const sym = m[2] ? `${m[1]}-${m[2]}` : m[1];
    return { symbol: sym, name: STOCK_NAMES[sym] || sym, type: 'stock', source: 'yahoo', providerSymbol: sym };
  }
  return null;
}

const STATIC_LIST = [
  // Forex majors
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD',
  // Common crosses
  'EURJPY', 'GBPJPY', 'EURGBP', 'EURCHF', 'EURAUD', 'EURCAD', 'EURNZD', 'GBPAUD', 'GBPCAD',
  'GBPCHF', 'GBPNZD', 'AUDJPY', 'AUDCAD', 'AUDCHF', 'AUDNZD', 'CADJPY', 'CADCHF', 'CHFJPY',
  'NZDJPY', 'NZDCAD', 'NZDCHF', 'USDTRY', 'EURTRY', 'USDMXN', 'USDZAR',
  // Metals
  'XAUUSD', 'XAGUSD',
  // Crypto
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT',
  // Nasdaq / US
  'AAPL', 'NVDA', 'MSFT', 'QQQ', 'TSLA', 'AMZN', 'META', 'GOOGL', 'AMD', 'SPY', 'NAS100', 'US500',
];

export interface SymbolListItem {
  symbol: string;
  name: string;
  type: SymbolType;
  source: string;
  /** True when the symbol appears in the user's journal. */
  inJournal?: boolean;
  /** Raw journal tickers that map to this symbol (e.g. ["EURUSD.m"]). */
  aliases?: string[];
}

/** Distinct tickers in the user's trades (owner-scoped). */
export function listJournalTickers(db: Db, userId: string): string[] {
  const rows = db
    .prepare('SELECT DISTINCT ticker FROM trades WHERE user_id = ? AND ticker IS NOT NULL AND ticker <> \'\'')
    .all(userId) as Array<{ ticker: string }>;
  return rows.map((r) => String(r.ticker));
}

export function buildSymbolList(journalTickers: string[]): SymbolListItem[] {
  const map = new Map<string, SymbolListItem>();
  for (const s of STATIC_LIST) {
    const r = resolveSymbol(s);
    if (r && !map.has(r.symbol)) map.set(r.symbol, { symbol: r.symbol, name: r.name, type: r.type, source: r.source });
  }
  for (const t of journalTickers) {
    const r = resolveSymbol(t);
    if (!r) continue;
    const item = map.get(r.symbol) || { symbol: r.symbol, name: r.name, type: r.type, source: r.source };
    item.inJournal = true;
    item.aliases = Array.from(new Set([...(item.aliases || []), t]));
    map.set(r.symbol, item);
  }
  return Array.from(map.values());
}
