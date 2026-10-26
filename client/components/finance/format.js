// Formatting + date helpers for the Finans page.
const pad = (n) => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const currentMonth = () => todayKey().slice(0, 7);
const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
};
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const monthShort = (ym) => MONTHS[Number(ym.split('-')[1]) - 1].slice(0, 3);

const SYMBOLS = { TRY: '₺', USD: '$', EUR: '€' };
const nfCache = {};
const fmtNum = (n, digits = 2) => {
  const k = `n${digits}`;
  if (!nfCache[k]) nfCache[k] = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return nfCache[k].format(Number.isFinite(n) ? n : 0);
};
const fmtMoney = (n, cur = 'TRY', digits = 2) => `${(n < 0 ? '-' : '')}${SYMBOLS[cur] || ''}${fmtNum(Math.abs(n), digits)}`;
const fmtDate = (d) => { const [y, m, day] = String(d).split('-'); return `${day}.${m}.${y}`; };

// "12,5" / "1.234,56" / "12.5" -> number | NaN
const parseInput = (s) => {
  let t = String(s == null ? '' : s).trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  return Number(t);
};

const TYPE_LABELS = { nakit: 'Nakit', banka: 'Banka', trade: 'Trade', birikim: 'Birikim', 'kredi kartı': 'Kredi kartı' };
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

module.exports = {
  pad, todayKey, currentMonth, shiftMonth, monthLabel, monthShort, fmtNum, fmtMoney, fmtDate, parseInput,
  TYPE_LABELS, COLORS, SYMBOLS,
};
