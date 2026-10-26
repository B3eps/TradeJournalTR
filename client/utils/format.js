// Ortak sayı / para / tarih biçimleyicileri (tr-TR, Intl).
// Örnek: formatMoney(19165) -> "$19.165,00", formatMoney(-55, { sign: true }) -> "-$55,00",
//        formatNumber(0.5, { decimals: 1 }) -> "0,5", formatDateShort('2026-10-26') -> "26 Eki 2026".

const LOCALE = 'tr-TR';
const nfCache = new Map();
const { getPipSize } = require('./tickValues');

const getNf = (min, max) => {
  const key = `${min}|${max}`;
  let nf = nfCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max });
    nfCache.set(key, nf);
  }
  return nf;
};

const toFinite = (value) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

// Binlik ayraçlı, virgüllü ondalık sayı. Geçersiz değer için "—".
const formatNumber = (value, { decimals = 2, minDecimals } = {}) => {
  const n = toFinite(value);
  if (n === null) return '—';
  return getNf(minDecimals === undefined ? decimals : minDecimals, decimals).format(n);
};

// Instrument price, not money: forex keeps pipette precision and no currency prefix.
const formatPrice = (value, symbol) => {
  const n = toFinite(value);
  if (n === null) return '—';
  const pip = getPipSize(symbol);
  const abs = Math.abs(n);
  const decimals = pip
    ? Math.max(0, Math.round(-Math.log10(pip)) + 1)
    : abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;
  return getNf(decimals, decimals).format(n);
};

// Para: işaret her zaman simgeden ÖNCE gelir ("-$55,00", "+$360,00"). sign:true pozitiflere "+" ekler.
const formatMoney = (value, { currency = '$', decimals = 2, sign = false } = {}) => {
  const n = toFinite(value);
  if (n === null) return '—';
  const abs = getNf(decimals, decimals).format(Math.abs(n));
  const isNeg = n < 0 && Number(abs.replace(/[^\d]/g, '')) !== 0;
  const prefix = isNeg ? '-' : sign && n > 0 ? '+' : '';
  return `${prefix}${currency}${abs}`;
};

// Yüzde: formatPercent(58.5) -> "%58,5" (değer zaten 0-100 aralığında).
const formatPercent = (value, { decimals = 1 } = {}) => {
  const n = toFinite(value);
  if (n === null) return '—';
  return `%${getNf(0, decimals).format(n)}`;
};

// Kısa tarih (yerel saat dilimi): "26 Eki 2026".
const formatDateShort = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
};

module.exports = { formatMoney, formatNumber, formatPrice, formatPercent, formatDateShort };
