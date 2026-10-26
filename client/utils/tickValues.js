// Dollar value per 1 point of price movement for common futures contracts.
// Used when manualPL is not set. Add more tickers here as needed.
const TICK_VALUES = {
  // Equity index futures
  NQ: 20, MNQ: 2,
  ES: 50, MES: 5,
  YM: 5,  MYM: 0.5,
  RTY: 50, M2K: 5,
  // Metals
  GC: 100, MGC: 10,
  SI: 5000, SIL: 1000,
  // Energy
  CL: 1000, MCL: 100,
  NG: 10000,
  // Rates
  ZB: 1000, ZN: 1000, ZF: 1000,
};

// Popular forex / metals symbols (cTrader / TradingView style, no slash)
const FOREX_TICKERS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD',
  'EURJPY', 'GBPJPY', 'EURGBP', 'EURCHF', 'AUDJPY', 'CADJPY', 'CHFJPY',
  'EURAUD', 'GBPAUD', 'AUDCAD', 'AUDNZD', 'USDTRY', 'EURTRY',
  'XAUUSD', 'XAGUSD',
];

const COMMON_TICKERS = [
  // Forex & metals
  ...FOREX_TICKERS,
  // Futures (from TICK_VALUES)
  'ES', 'MES', 'NQ', 'MNQ', 'YM', 'MYM', 'RTY', 'M2K',
  'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL', 'NG',
  'ZB', 'ZN', 'ZF',
  // Popular stocks & ETFs
  'SPY', 'QQQ', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'GOOGL',
  'META', 'AMD', 'INTC', 'JPM', 'BAC', 'DIS', 'NFLX',
  'COIN', 'SOFI', 'PLTR', 'IWM', 'DIA', 'GLD', 'TLT',
];

// Minimum price increment per contract. Stocks default to 0.01.
const TICK_SIZES = {
  NQ: 0.25, MNQ: 0.25,
  ES: 0.25, MES: 0.25,
  YM: 1.0,  MYM: 1.0,
  RTY: 0.10, M2K: 0.10,
  GC: 0.10, MGC: 0.10,
  SI: 0.005, SIL: 0.005,
  CL: 0.01, MCL: 0.01,
  NG: 0.001,
  ZB: 1/32, ZN: 1/64, ZF: 1/128,
};

// =====================================================
// FOREX
// =====================================================

const FX_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'TRY', 'SEK', 'NOK',
  'DKK', 'PLN', 'HUF', 'CZK', 'ZAR', 'MXN', 'SGD', 'HKD', 'CNH', 'ILS', 'RUB',
]);
const METALS = new Set(['XAU', 'XAG', 'XPT', 'XPD']);

// Pip size per metal (price units). Gold: 0.1, silver: 0.01.
const METAL_PIP_SIZES = { XAU: 0.1, XAG: 0.01, XPT: 0.1, XPD: 0.1 };
// Units per 1.00 lot
const METAL_CONTRACT_SIZES = { XAU: 100, XAG: 5000, XPT: 100, XPD: 100 };
const FX_CONTRACT_SIZE = 100000;

// Normalizes broker symbols to a 6-letter pair: "EUR/USD" → EURUSD,
// "EURUSD.m" / "EURUSDm" / "EURUSD+" → EURUSD. Returns null if not forex/metal.
const parseForexSymbol = (ticker) => {
  if (!ticker) return null;
  const s = String(ticker).toUpperCase().split('.')[0].replace(/[^A-Z]/g, '');
  if (s.length < 6) return null;
  const base = s.slice(0, 3);
  const quote = s.slice(3, 6);
  const baseOk = FX_CURRENCIES.has(base) || METALS.has(base);
  if (!baseOk || !FX_CURRENCIES.has(quote)) return null;
  return { symbol: base + quote, base, quote, isMetal: METALS.has(base) };
};

const isForexTicker = (ticker) => parseForexSymbol(ticker) !== null;

// Pip size: 0.0001 for most pairs, 0.01 for JPY/HUF quoted pairs, per-metal table.
const getPipSize = (ticker) => {
  const fx = parseForexSymbol(ticker);
  if (!fx) return null;
  if (fx.isMetal) return METAL_PIP_SIZES[fx.base];
  if (fx.quote === 'JPY' || fx.quote === 'HUF') return 0.01;
  return 0.0001;
};

const getContractSize = (ticker) => {
  const fx = parseForexSymbol(ticker);
  if (!fx) return null;
  return fx.isMetal ? METAL_CONTRACT_SIZES[fx.base] : FX_CONTRACT_SIZE;
};

// Signed pips for a trade (quantity < 0 means short). null if not forex / no prices.
const calculatePips = (trade) => {
  const pip = getPipSize(trade.ticker);
  const enter = parseFloat(trade.enterPrice);
  const exit = parseFloat(trade.exitPrice);
  if (!pip || !enter || !exit) return null;
  const direction = parseFloat(trade.quantity) < 0 ? -1 : 1;
  return ((exit - enter) / pip) * direction;
};

// Estimated gross P/L in USD (account currency assumed USD) from prices and lots.
// Exact for XXX/USD pairs and metals; for USD/XXX pairs converted with the exit
// price. Crosses (e.g. EURGBP) cannot be converted without rates → null.
const estimateForexPL = (trade) => {
  const fx = parseForexSymbol(trade.ticker);
  const enter = parseFloat(trade.enterPrice);
  const exit = parseFloat(trade.exitPrice);
  const lots = parseFloat(trade.quantity);
  if (!fx || !enter || !exit || !lots) return null;
  const quoteAmount = (exit - enter) * lots * getContractSize(trade.ticker);
  if (fx.quote === 'USD') return quoteAmount;
  if (fx.base === 'USD') return quoteAmount / exit;
  return null;
};

// For forex, 1 point = 1 lot's contract size in quote currency (USD for XXXUSD).
const getPointValue = (ticker) => {
  const upper = (ticker || '').toUpperCase();
  if (TICK_VALUES[upper] !== undefined) return TICK_VALUES[upper];
  const cs = getContractSize(upper);
  return cs ?? 1;
};

// Forex tick size = 1/10 pip (pipette), so 4 ticks = 0.4 pip breakeven band.
const getTickSize = (ticker) => {
  const upper = (ticker || '').toUpperCase();
  if (TICK_SIZES[upper] !== undefined) return TICK_SIZES[upper];
  const pip = getPipSize(upper);
  return pip ? pip / 10 : 0.01;
};

const BREAKEVEN_TICK_THRESHOLD = 4;

const isBreakevenTrade = (trade) => {
  // P/L-only trades (no prices entered): breakeven only if P/L is exactly 0
  if (!trade.enterPrice && !trade.exitPrice && trade.manualPL !== null && trade.manualPL !== undefined) {
    return Number(trade.manualPL) === 0;
  }
  const priceDiff = Math.abs(trade.exitPrice - trade.enterPrice);
  const threshold = getTickSize(trade.ticker) * BREAKEVEN_TICK_THRESHOLD;
  return priceDiff <= threshold;
};

module.exports = {
  TICK_VALUES, TICK_SIZES, COMMON_TICKERS, FOREX_TICKERS,
  getPointValue, getTickSize, isBreakevenTrade,
  parseForexSymbol, isForexTicker, getPipSize, getContractSize, calculatePips, estimateForexPL,
};
