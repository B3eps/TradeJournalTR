const React = require('react');
const { useState, useEffect } = React;
const Papa = require('papaparse');
const helper = require('../../helper.js');
const { authFetch } = helper;
const { getNewYorkOffset } = require('../../utils/dateUtils');
const { parseForexSymbol, getContractSize } = require('../../utils/tickValues');
const Icons = require('../shared/Icons');
const sound = require('../../utils/sound');
const { useEscapeClose } = require('../../utils/hooks');

// =====================================================
// CSV IMPORT MODAL
// =====================================================

// Strip futures contract month+year suffix (e.g. NQH6 -> NQ, MNQH6 -> MNQ, ESZ25 -> ES)
const parseContractTicker = (name) => {
  if (!name) return name;
  // Forex symbols (EURUSD, XAUUSD.m, ...) are normalized, never stripped
  const fx = parseForexSymbol(name);
  if (fx) return fx.symbol;
  return name.trim().replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '').trim() || name.trim();
};

// Known broker CSV formats — matched by required header presence
const KNOWN_BROKER_FORMATS = [
  {
    name: 'Topstep',
    requiredHeaders: ['ContractName', 'EnteredAt', 'ExitedAt', 'EntryPrice', 'ExitPrice', 'PnL', 'Size', 'Type', 'Fees'],
    numericHeaders: ['EntryPrice', 'ExitPrice', 'PnL', 'Size', 'Fees'],
    transform: (row) => {
      const isShort = row.Type && row.Type.toLowerCase() === 'short';
      const qty = Math.abs(parseNum(row.Size));
      const pnl = parseNum(row.PnL);
      const fees = parseNumOrEmptyZero(row.Fees);
      return {
        ticker: parseContractTicker(row.ContractName),
        enterTime: row.EnteredAt,
        exitTime: row.ExitedAt,
        enterPrice: parseNum(row.EntryPrice),
        exitPrice: parseNum(row.ExitPrice),
        quantity: isShort ? -qty : qty,
        manualPL: pnl - fees,
        comments: '',
      };
    },
  },
  {
    name: 'Tradovate (Positions)',
    requiredHeaders: ['Product', 'Avg. Buy', 'Avg. Sell', 'Paired Qty', 'P/L', 'Buy Fill ID', 'Sell Fill ID', 'Bought Timestamp', 'Sold Timestamp'],
    numericHeaders: ['Avg. Buy', 'Avg. Sell', 'Paired Qty', 'P/L'],
    transform: (row) => {
      const buyFillId = parseInt(row['Buy Fill ID']) || 0;
      const sellFillId = parseInt(row['Sell Fill ID']) || 0;
      const isLong = sellFillId > buyFillId;
      const qty = Math.abs(parseNum(row['Paired Qty']));
      return {
        ticker: parseContractTicker(row.Product),
        enterTime: isLong ? row['Bought Timestamp'] : row['Sold Timestamp'],
        exitTime: isLong ? row['Sold Timestamp'] : row['Bought Timestamp'],
        enterPrice: parseNum(isLong ? row['Avg. Buy'] : row['Avg. Sell']),
        exitPrice: parseNum(isLong ? row['Avg. Sell'] : row['Avg. Buy']),
        quantity: isLong ? qty : -qty,
        manualPL: parseNum(row['P/L']),
        comments: '',
      };
    },
  },
  {
    name: 'Tradovate (Fills)',
    requiredHeaders: ['symbol', 'buyFillId', 'sellFillId', 'qty', 'buyPrice', 'sellPrice', 'pnl', 'boughtTimestamp', 'soldTimestamp'],
    numericHeaders: ['qty', 'buyPrice', 'sellPrice', 'pnl'],
    transform: (row) => {
      const buyFillId = parseInt(row.buyFillId) || 0;
      const sellFillId = parseInt(row.sellFillId) || 0;
      const isLong = sellFillId > buyFillId;
      const qty = Math.abs(parseNum(row.qty));
      return {
        ticker: parseContractTicker(row.symbol),
        enterTime: isLong ? row.boughtTimestamp : row.soldTimestamp,
        exitTime: isLong ? row.soldTimestamp : row.boughtTimestamp,
        enterPrice: parseNum(isLong ? row.buyPrice : row.sellPrice),
        exitPrice: parseNum(isLong ? row.sellPrice : row.buyPrice),
        quantity: isLong ? qty : -qty,
        manualPL: parseNum(row.pnl),
        comments: '',
      };
    },
  },
];

// =====================================================
// FOREX PLATFORM EXPORTS (cTrader / MetaTrader 5)
// Header names vary by platform version and UI language, so columns are
// matched case-insensitively against several aliases.
// =====================================================

// Lowercase, fold Turkish characters, drop everything that isn't a-z/0-9.
const normHeader = (h) => String(h || '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u')
  .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a').replace(/î/g, 'i')
  .replace(/[^a-z0-9]/g, '');

const FOREX_FIELDS = [
  { key: 'symbol', label: 'Sembol', required: true, aliases: ['symbol', 'sembol', 'instrument', 'enstruman', 'pair', 'parite', 'item'] },
  { key: 'direction', label: 'Yön', required: false, aliases: ['direction', 'openingdirection', 'tradeside', 'side', 'type', 'yon', 'islemyonu', 'acilisyonu', 'tip', 'buysell'] },
  { key: 'volume', label: 'Hacim / Lot', required: true, aliases: ['volumelots', 'lots', 'lot', 'closingquantity', 'closingvolume', 'quantity', 'volume', 'qty', 'hacim', 'kapanishacmi', 'miktar', 'size'] },
  { key: 'enterTime', label: 'Açılış Zamanı', required: true, aliases: ['openingtime', 'opentime', 'opened', 'entrytime', 'opendate', 'timeopen', 'time', 'acilissaati', 'acilistarihi', 'acilis', 'acilmazamani', 'acilisazamani', 'giriszamani', 'acilisaati'] },
  { key: 'exitTime', label: 'Kapanış Zamanı', required: true, aliases: ['closingtime', 'closetime', 'closed', 'exittime', 'closedate', 'timeclose', 'time1', 'kapanissaati', 'kapanistarihi', 'kapanis', 'kapanmazamani', 'kapaniszamani', 'cikiszamani'] },
  { key: 'enterPrice', label: 'Giriş Fiyatı', required: true, aliases: ['entryprice', 'openingprice', 'openprice', 'priceopen', 'price', 'girisfiyati', 'acilisfiyati'] },
  { key: 'exitPrice', label: 'Kapanış Fiyatı', required: true, aliases: ['closingprice', 'closeprice', 'exitprice', 'priceclose', 'price1', 'kapanisfiyati', 'cikisfiyati'] },
  { key: 'netProfit', label: 'Net Kâr', required: false, aliases: ['netprofit', 'netusd', 'neteur', 'netgbp', 'nettry', 'netpl', 'netpnl', 'netkar', 'netkarzarar', 'net'] },
  { key: 'grossProfit', label: 'Brüt Kâr', required: false, aliases: ['grossprofit', 'grossusd', 'grosseur', 'grossgbp', 'grosstry', 'gross', 'profit', 'brutkar', 'brut', 'kar', 'karzarar'] },
  { key: 'commission', label: 'Komisyon', required: false, aliases: ['commission', 'commissions', 'komisyon', 'fee', 'fees'] },
  { key: 'swap', label: 'Swap', required: false, aliases: ['swap', 'swaps', 'rollover', 'storage'] },
  { key: 'positionId', label: 'Pozisyon No', required: false, aliases: ['positionid', 'position', 'ticket', 'id', 'pozisyonid', 'pozisyon', 'pozisyonno'] },
  { key: 'comment', label: 'Yorum', required: false, aliases: ['comment', 'comments', 'label', 'yorum', 'etiket'] },
];

// Headers that only appear in forex platform exports → treat file as forex export
const FOREX_HINT_HEADERS = ['swap', 'swaps', 'positionid', 'closingprice', 'openingdirection', 'closingquantity', 'grossusd', 'netusd', 'price1', 'time1', 'kapanisfiyati', 'komisyon'];

// Maps each forex field to a header: exact alias match first, then prefix match.
// A header is never used for two fields.
const mapForexHeaders = (headers) => {
  const normed = headers.map(h => ({ raw: h, n: normHeader(h) }));
  const used = new Set();
  const map = {};
  const pick = (field, matcher) => {
    for (const alias of field.aliases) {
      const hit = normed.find(h => !used.has(h.raw) && matcher(h.n, alias));
      if (hit) { map[field.key] = hit.raw; used.add(hit.raw); return true; }
    }
    return false;
  };
  FOREX_FIELDS.forEach(f => { pick(f, (n, a) => n === a); });
  FOREX_FIELDS.forEach(f => {
    if (!map[f.key]) pick(f, (n, a) => a.length >= 4 && n.startsWith(a));
  });
  return map;
};

// Number parsing tolerant of "1 234,56", "1,234.56", "−12.30", "0.10 Lots", "USD 12.5"
const parseNum = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;
  let s = String(value).trim();
  const parenthesizedNegative = /^\(.*\)$/.test(s);
  if (parenthesizedNegative) s = s.slice(1, -1);
  s = s.replace(/[−–]/g, '-').replace(/[\s  ']/g, '');
  s = s.replace(/[^0-9.,\-]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // The separator that appears last is the decimal separator
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const decimals = s.length - lastComma - 1;
    const commaCount = (s.match(/,/g) || []).length;
    if (commaCount === 1 && decimals !== 3) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  }
  const parsed = Number(s);
  return Number.isFinite(parsed) ? (parenthesizedNegative ? -Math.abs(parsed) : parsed) : NaN;
};

// Empty broker fee fields can mean no fee; malformed non-empty values must stay invalid.
const parseNumOrEmptyZero = (value) => String(value ?? '').trim() === '' ? 0 : parseNum(value);

// Parses broker date strings into components:
// "2026.10.21 14:35:12" (MT5), "2026-10-21 14:35:12.123", "21/10/2026 14:35", "21.10.2026 14:35:12"
const parseBrokerDateParts = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0), ms: +((m[7] || '0').padEnd(3, '0')) };
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?/);
  if (m) {
    let a = +m[1], b = +m[2];
    // Day-first unless that is impossible (US style month/day)
    let d = a, mo = b;
    if (b > 12 && a <= 12) { d = b; mo = a; }
    return { y: +m[3], mo, d, h: +m[4], mi: +m[5], s: +(m[6] || 0), ms: +((m[7] || '0').padEnd(3, '0')) };
  }
  return null;
};

// Converts a broker timestamp to an ISO string in the chosen timezone mode.
const brokerTimeToIso = (value, tzMode) => {
  // An explicit UTC offset is authoritative; never reinterpret it as local/broker time.
  if (typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
    const isoParts = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i);
    if (isoParts) {
      const check = new Date(Date.UTC(+isoParts[1], +isoParts[2] - 1, +isoParts[3], +isoParts[4], +isoParts[5], +isoParts[6]));
      if (check.getUTCFullYear() !== +isoParts[1] || check.getUTCMonth() !== +isoParts[2] - 1 ||
          check.getUTCDate() !== +isoParts[3] || check.getUTCHours() !== +isoParts[4] ||
          check.getUTCMinutes() !== +isoParts[5] || check.getUTCSeconds() !== +isoParts[6]) return null;
    }
    const explicit = new Date(value);
    return isNaN(explicit.getTime()) ? null : explicit.toISOString();
  }
  const p = parseBrokerDateParts(value);
  if (!p) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const calendarCheck = new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms));
  if (
    calendarCheck.getUTCFullYear() !== p.y || calendarCheck.getUTCMonth() !== p.mo - 1 ||
    calendarCheck.getUTCDate() !== p.d || calendarCheck.getUTCHours() !== p.h ||
    calendarCheck.getUTCMinutes() !== p.mi || calendarCheck.getUTCSeconds() !== p.s
  ) return null;
  let d;
  if (tzMode === 'utc') {
    d = new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms));
  } else if (tzMode === 'est') {
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
    d = new Date(local + getNewYorkOffset(new Date(local)));
  } else {
    d = new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms);
  }
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const localTimeToIso = (ts) => {
  if (!ts) return ts;
  const s = String(ts).trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const isoParts = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i);
    if (isoParts) {
      const check = new Date(Date.UTC(+isoParts[1], +isoParts[2] - 1, +isoParts[3], +isoParts[4], +isoParts[5], +isoParts[6]));
      if (check.getUTCFullYear() !== +isoParts[1] || check.getUTCMonth() !== +isoParts[2] - 1 ||
          check.getUTCDate() !== +isoParts[3] || check.getUTCHours() !== +isoParts[4] ||
          check.getUTCMinutes() !== +isoParts[5] || check.getUTCSeconds() !== +isoParts[6]) return null;
    }
    const explicit = new Date(s);
    return isNaN(explicit.getTime()) ? null : explicit.toISOString();
  }
  const parts = parseBrokerDateParts(s);
  if (parts) {
    const check = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s, parts.ms));
    if (check.getUTCFullYear() !== parts.y || check.getUTCMonth() !== parts.mo - 1 || check.getUTCDate() !== parts.d ||
        check.getUTCHours() !== parts.h || check.getUTCMinutes() !== parts.mi || check.getUTCSeconds() !== parts.s) return null;
    const local = new Date(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s, parts.ms);
    if (local.getFullYear() !== parts.y || local.getMonth() !== parts.mo - 1 || local.getDate() !== parts.d ||
        local.getHours() !== parts.h || local.getMinutes() !== parts.mi || local.getSeconds() !== parts.s) return null;
    return local.toISOString();
  }
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const year = +ymd[1], month = +ymd[2], day = +ymd[3];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return new Date(year, month - 1, day).toISOString();
  }
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
};

const prepareImportRows = (rows, isForexExport, forexTz) => {
  const valid = [];
  const issues = [];
  const convertTime = isForexExport ? (ts) => brokerTimeToIso(ts, forexTz) : localTimeToIso;
  const numberValue = (value) => (typeof value === 'number' ? value : parseNum(value));

  rows.forEach((row, index) => {
    const sourceRow = Number(row.sourceRow) || index + 1;
    const ticker = parseContractTicker(row.ticker);
    const enterTime = convertTime(row.enterTime);
    const exitTime = convertTime(row.exitTime);
    const enterMs = new Date(enterTime).getTime();
    const exitMs = new Date(exitTime).getTime();
    const enterPrice = numberValue(row.enterPrice);
    const exitPrice = numberValue(row.exitPrice);
    const quantity = numberValue(row.quantity);
    const manualPL = row.manualPL == null || row.manualPL === '' ? null : numberValue(row.manualPL);
    const commission = row.commission == null || row.commission === '' ? null : numberValue(row.commission);
    const swap = row.swap == null || row.swap === '' ? null : numberValue(row.swap);
    const reasons = [];

    if (!ticker) reasons.push('sembol eksik');
    if (!row.enterTime || !Number.isFinite(enterMs)) reasons.push('giriş zamanı geçersiz');
    if (!row.exitTime || !Number.isFinite(exitMs)) reasons.push('çıkış zamanı geçersiz');
    if (Number.isFinite(enterMs) && Number.isFinite(exitMs) && exitMs < enterMs) reasons.push('çıkış zamanı girişten önce');
    if (!Number.isFinite(enterPrice) || enterPrice <= 0) reasons.push('giriş fiyatı geçersiz');
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) reasons.push('çıkış fiyatı geçersiz');
    if (!Number.isFinite(quantity) || quantity === 0) reasons.push('miktar sıfır veya geçersiz');
    if (manualPL !== null && !Number.isFinite(manualPL)) reasons.push('K/Z sayısal değil');
    if (commission !== null && !Number.isFinite(commission)) reasons.push('komisyon sayısal değil');
    if (swap !== null && !Number.isFinite(swap)) reasons.push('swap sayısal değil');

    if (reasons.length > 0) {
      issues.push({ sourceRow, reasons });
      return;
    }

    valid.push({
      sourceRow,
      ticker,
      enterTime,
      exitTime,
      enterPrice,
      exitPrice,
      quantity,
      manualPL,
      commission,
      swap,
      comments: typeof row.comments === 'string' ? row.comments : '',
      account: typeof row.account === 'string' && row.account.trim() ? row.account.trim() : null,
    });
  });

  return { valid, issues };
};

const downloadRejectedRows = (issues) => {
  if (!issues || issues.length === 0) return;
  const escapeCell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const rows = [['Kayıt', 'Neden'], ...issues.map((issue) => [issue.sourceRow, issue.reasons.join('; ')])];
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCell).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `islem-ice-aktarma-hatalari-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const findAmbiguousCommaValues = (rows, columns) => {
  const samples = [];
  let count = 0;
  const pattern = /^[-+]?\d+,\d{3}$/;
  for (let i = 0; i < rows.length; i++) {
    for (const column of columns.filter(Boolean)) {
      const value = rows[i]?.[column];
      if (typeof value === 'string') {
        const normalized = value.trim()
          .replace(/^\((.*)\)$/, '$1')
          .replace(/[−–]/g, '-')
          .replace(/[\s  ']/g, '')
          .replace(/[^0-9.,\-]/g, '');
        if (!pattern.test(normalized)) continue;
        count++;
        if (samples.length < 5) samples.push({ record: i + 1, column, value: value.trim() });
      }
    }
  }
  return { count, samples };
};

const buildForexTransform = (map) => (row) => {
  const rawSymbol = row[map.symbol];
  const fx = parseForexSymbol(rawSymbol);
  const ticker = fx ? fx.symbol : String(rawSymbol || '').trim().toUpperCase();

  // Volume: "0.10 Lots" → 0.10; units ("10 000", "10000 EUR") → lots via contract size
  const rawVol = row[map.volume];
  let lots = Math.abs(parseNum(rawVol));
  const volText = String(rawVol || '');
  const cs = getContractSize(ticker);
  if (cs && !/lot/i.test(volText) && (/[a-z]{2,}/i.test(volText) || lots >= 1000)) {
    lots = lots / cs;
  }
  lots = Math.round(lots * 100000) / 100000;

  // Direction from column, else from the sign of the volume
  const dirText = map.direction ? String(row[map.direction] || '') : '';
  let isShort;
  if (dirText) isShort = /sell|short|sat/i.test(dirText);
  else isShort = parseNum(rawVol) < 0;

  const commissionVal = map.commission ? parseNum(row[map.commission]) : NaN;
  const swapVal = map.swap ? parseNum(row[map.swap]) : NaN;
  const commission = isNaN(commissionVal) ? null : -Math.abs(commissionVal);
  const swap = isNaN(swapVal) ? null : swapVal;

  let manualPL = null;
  const net = map.netProfit ? parseNum(row[map.netProfit]) : NaN;
  const gross = map.grossProfit ? parseNum(row[map.grossProfit]) : NaN;
  if (!isNaN(net)) manualPL = net;
  else if (!isNaN(gross)) manualPL = gross + (commission || 0) + (swap || 0);
  if (manualPL !== null) manualPL = Math.round(manualPL * 100) / 100;

  const posId = map.positionId ? String(row[map.positionId] || '').trim() : '';
  const comment = map.comment ? String(row[map.comment] || '').trim() : '';

  return {
    ticker,
    enterTime: row[map.enterTime],
    exitTime: row[map.exitTime],
    enterPrice: parseNum(row[map.enterPrice]),
    exitPrice: parseNum(row[map.exitPrice]),
    quantity: isShort ? -lots : lots,
    manualPL,
    commission,
    swap,
    comments: [posId ? `#${posId}` : '', comment].filter(Boolean).join(' '),
  };
};

const detectForexPlatform = (headers) => {
  const n = headers.map(normHeader);
  if (n.some(h => ['positionid', 'closingprice', 'openingdirection', 'closingquantity'].includes(h) || /^(gross|net)(usd|eur|gbp|try)$/.test(h))) return 'cTrader';
  if (n.includes('price1') || n.includes('time1') || n.includes('ticket') || (n.includes('position') && n.includes('profit'))) return 'MetaTrader 5';
  return 'cTrader / MetaTrader';
};

const CSV_TRADE_FIELDS = [
  { key: 'ticker', label: 'Sembol', required: true, aliases: ['ticker', 'symbol', 'sembol', 'instrument', 'name', 'asset'] },
  { key: 'enterTime', label: 'Giriş Zamanı', required: true, aliases: ['entertime', 'opendate', 'opentime', 'openingtime', 'entrydate', 'entrytime', 'entry_time', 'open_date', 'entry date', 'entry time'] },
  { key: 'exitTime', label: 'Çıkış Zamanı', required: true, aliases: ['exittime', 'closedate', 'closetime', 'closingtime', 'exitdate', 'exit_time', 'close_date', 'close date', 'close time'] },
  { key: 'enterPrice', label: 'Giriş Fiyatı', required: true, aliases: ['enterprice', 'openprice', 'openingprice', 'entryprice', 'entry_price', 'open_price', 'entry price', 'open price'] },
  { key: 'exitPrice', label: 'Çıkış Fiyatı', required: true, aliases: ['exitprice', 'closeprice', 'closingprice', 'exit_price', 'close_price', 'exit price', 'close price'] },
  { key: 'quantity', label: 'Miktar / Lot', required: true, aliases: ['quantity', 'qty', 'size', 'shares', 'contracts', 'lots', 'volume'] },
  { key: 'manualPL', label: 'K/Z (İsteğe bağlı)', required: false, aliases: ['pl', 'pnl', 'profit', 'profitloss', 'profit_loss', 'profit/loss', 'net p/l', 'net profit', 'realized p/l'] },
  { key: 'comments', label: 'Notlar (İsteğe bağlı)', required: false, aliases: ['comments', 'notes', 'comment', 'note', 'description'] },
  { key: 'account', label: 'Hesap (İsteğe bağlı)', required: false, aliases: ['account', 'account_name', 'accountname', 'broker', 'broker_account'] },
];

const CSVImportModal = ({ isOpen, onClose, triggerReload, onDuplicatesSkipped }) => {
  useEscapeClose(!!isOpen, onClose);
  const [step, setStep] = useState(1);
  const [csvData, setCsvData] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [columnMap, setColumnMap] = useState({});
  const [mappedTrades, setMappedTrades] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);
  const [detectedFormat, setDetectedFormat] = useState(null);
  const [isForexExport, setIsForexExport] = useState(false);
  const [forexTz, setForexTz] = useState('local');
  const [numberWarnings, setNumberWarnings] = useState({ count: 0, samples: [] });
  const [ambiguousNumbersAccepted, setAmbiguousNumbersAccepted] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStep(1); setCsvData([]); setCsvHeaders([]); setColumnMap({});
      setMappedTrades([]); setImporting(false); setImportResult(null);
      setError(null); setDetectedFormat(null); setIsForexExport(false); setForexTz('local');
      setNumberWarnings({ count: 0, samples: [] });
      setAmbiguousNumbersAccepted(false);
    }
  }, [isOpen]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // allow selecting the same file again after fixing ambiguous values
    setError(null);
    setAmbiguousNumbersAccepted(false);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        // Duplicate-header renames and ragged trailing rows are not fatal
        const fatal = results.errors.filter(er => er.type !== 'FieldMismatch');
        if (fatal.length > 0 && results.data.length === 0) {
          setError(`CSV okunamadı: ${fatal[0].message}`);
          return;
        }
        if (results.data.length === 0) {
          setError('CSV dosyası boş');
          return;
        }

        const headers = (results.meta.fields || []).filter(Boolean);

        // Check for a known broker format first
        const knownFormat = KNOWN_BROKER_FORMATS.find(fmt =>
          fmt.requiredHeaders.every(h => headers.includes(h))
        );

        if (knownFormat) {
          setNumberWarnings(findAmbiguousCommaValues(results.data, knownFormat.numericHeaders));
          const trades = results.data
            .map((row, index) => ({ ...knownFormat.transform(row), sourceRow: index + 1 }));
          setDetectedFormat(knownFormat.name);
          setIsForexExport(false);
          setMappedTrades(trades);
          setStep(3);
          return;
        }

        // cTrader / MetaTrader 5 history exports (alias-based header matching)
        const normedHeaders = headers.map(normHeader);
        const looksForex = normedHeaders.some(h => FOREX_HINT_HEADERS.includes(h));
        if (looksForex) {
          const fxMap = mapForexHeaders(headers);
          const missing = FOREX_FIELDS.filter(f => f.required && !fxMap[f.key]);
          if (missing.length === 0) {
            const transform = buildForexTransform(fxMap);
            setNumberWarnings(findAmbiguousCommaValues(results.data, [
              fxMap.volume, fxMap.enterPrice, fxMap.exitPrice, fxMap.commission, fxMap.swap,
              fxMap.netProfit, fxMap.grossProfit,
            ]));
            const trades = results.data.map((row, index) => ({ ...transform(row), sourceRow: index + 1 }));
            setDetectedFormat(detectForexPlatform(headers));
            setIsForexExport(true);
            setMappedTrades(trades);
            setStep(3);
            return;
          }
          // Looks like a forex export but required columns are missing → explain, then manual mapping
          setError(`${detectForexPlatform(headers)} dosyası algılandı ancak zorunlu sütunlar bulunamadı: ${missing.map(f => f.label).join(', ')}. Bulunan sütunlar: ${headers.join(', ')}. Aşağıdan sütunları elle eşleştirebilirsiniz.`);
        }

        // Unknown format — fall through to manual column mapping
        setIsForexExport(false);
        setNumberWarnings({ count: 0, samples: [] });
        setCsvData(results.data);
        setCsvHeaders(headers);
        const autoMap = {};
        CSV_TRADE_FIELDS.forEach(field => {
          const match = headers.find(h =>
            field.aliases.some(alias => h.toLowerCase().replace(/[^a-z0-9]/g, '').includes(alias.replace(/[^a-z0-9]/g, '')))
          );
          if (match) autoMap[field.key] = match;
        });
        setColumnMap(autoMap);
        setStep(2);
      },
    });
  };

  const handleMapConfirm = () => {
    setError(null);
    setAmbiguousNumbersAccepted(false);
    const missing = CSV_TRADE_FIELDS.filter(f => f.required && !columnMap[f.key]);
    if (missing.length > 0) {
      setError(`Eşleştirilmesi zorunlu alanlar eksik: ${missing.map(f => f.label).join(', ')}`);
      return;
    }

    const trades = csvData.map((row, index) => {
      const trade = {};
      CSV_TRADE_FIELDS.forEach(field => {
        if (columnMap[field.key]) {
          const value = row[columnMap[field.key]];
          if (['enterPrice', 'exitPrice', 'quantity', 'manualPL'].includes(field.key)) {
            const parsed = parseNum(value);
            trade[field.key] = Number.isFinite(parsed) ? parsed : value;
          } else {
            trade[field.key] = value;
          }
        }
      });
      return { ...trade, sourceRow: index + 1, ticker: parseContractTicker(trade.ticker) };
    });

    setNumberWarnings(findAmbiguousCommaValues(
      csvData,
      ['enterPrice', 'exitPrice', 'quantity', 'manualPL', 'commission', 'swap'].map((field) => columnMap[field]),
    ));
    setMappedTrades(trades);
    setStep(3);
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const prepared = prepareImportRows(mappedTrades, isForexExport, forexTz);
      if (prepared.valid.length === 0) {
        setError('İçe aktarılabilecek geçerli işlem bulunamadı. Satır hatalarını gözden geçirin.');
        return;
      }
      if (prepared.valid.length > 500) {
        setError('Tek seferde en fazla 500 geçerli işlem aktarılabilir. CSV dosyasını bölüp yeniden deneyin.');
        return;
      }
      const tradesToSend = prepared.valid.map(({ sourceRow, ...trade }) => trade);
      const response = await authFetch('/api/importTrades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: tradesToSend }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        setError(data.error || `İçe aktarma başarısız oldu (HTTP ${response.status}).`);
      } else {
        setImportResult({ ...data, rejectedRows: prepared.issues.length, issues: prepared.issues });
        sound.play('complete-all');
        triggerReload();
        if (data.skipped > 0 && onDuplicatesSkipped) {
          onDuplicatesSkipped(data.skipped);
        }
      }
    } catch (err) {
      setError('İçe aktarma başarısız oldu. Lütfen tekrar deneyin.');
    } finally {
      setImporting(false);
    }
  };

  const preparedPreview = prepareImportRows(mappedTrades, isForexExport, forexTz);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="CSV'den İşlem İçe Aktar" className="bg-bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">CSV'den İşlem İçe Aktar</h2>
            <p className="text-text-tertiary text-xs mt-0.5">Adım {importResult ? 3 : step} / 3</p>
          </div>
          <button className="text-text-secondary hover:text-text-primary transition-colors" onClick={onClose}>
            <Icons.X />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-negative/10 border border-negative/30 rounded-lg text-negative text-sm">{error}</div>
          )}

          {/* Step 1: Upload */}
          {step === 1 && (
            <div className="text-center py-8">
              <Icons.Download className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <h3 className="text-text-primary font-semibold mb-2">CSV Dosyası Yükle</h3>
              <p className="text-text-tertiary text-sm mb-6">İşlem geçmişinizi içeren bir CSV dosyası seçin. cTrader (Geçmiş/History) ve MetaTrader 5 dışa aktarımları otomatik tanınır; diğer dosyalarda sembol, tarih, fiyat ve miktar sütunları bulunmalıdır.</p>
              <label className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-accent-text font-semibold rounded-lg hover:brightness-110 transition-all cursor-pointer">
                <Icons.Plus className="w-4 h-4" />
                Dosya Seç
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          )}

          {/* Step 2: Map columns */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-text-secondary text-sm">CSV sütunlarınızı işlem alanlarıyla eşleştirin. Bazı eşleşmeler otomatik bulundu.</p>
              <div className="space-y-3">
                {CSV_TRADE_FIELDS.map(field => (
                  <div key={field.key} className="flex items-center gap-3">
                    <div className="w-40 flex-shrink-0">
                      <span className="text-text-primary text-sm font-medium">{field.label}</span>
                      {field.required && <span className="text-negative text-xs ml-1">*</span>}
                    </div>
                    <select
                      value={columnMap[field.key] || ''}
                      onChange={(e) => setColumnMap(prev => ({ ...prev, [field.key]: e.target.value || undefined }))}
                      className="flex-1 px-3 py-2 bg-bg-input border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
                    >
                      <option value="">-- Atla --</option>
                      {csvHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-text-muted text-xs">CSV'de {csvData.length} satır bulundu</p>
            </div>
          )}

          {/* Step 3: Preview & Confirm */}
          {step === 3 && !importResult && (
            <div className="space-y-4">
              {detectedFormat && (
                <div className="flex items-center gap-2 px-3 py-2 bg-positive/10 border border-positive/20 rounded-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-positive flex-shrink-0"></span>
                  <span className="text-positive text-xs font-medium">{detectedFormat} formatı algılandı — sütunlar otomatik eşleştirildi</span>
                </div>
              )}
              {numberWarnings.count > 0 && (
                <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <p className="font-semibold">{numberWarnings.count} sayı virgül nedeniyle belirsiz olabilir.</p>
                  <p className="mt-1">Örneğin 1,234 şu an 1234 olarak yorumlanır. Ondalık değer kastettiyseniz CSV'de 1.234 biçimine çevirip dosyayı yeniden seçin.</p>
                  <p className="mt-1 text-warning/80">Örnekler: {numberWarnings.samples.map((sample) => `kayıt ${sample.record}, ${sample.column}: ${sample.value}`).join(' · ')}</p>
                  <label className="mt-2 flex items-start gap-2 text-warning cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ambiguousNumbersAccepted}
                      onChange={(event) => setAmbiguousNumbersAccepted(event.target.checked)}
                      className="mt-0.5 accent-warning"
                    />
                    <span>Belirsiz sayıları binlik ayraç (1,234 → 1234) olarak yorumlayıp içe aktarmayı onaylıyorum.</span>
                  </label>
                </div>
              )}
              {isForexExport && (
                <div className="flex items-center gap-3">
                  <span className="text-text-secondary text-sm flex-shrink-0">Dosyadaki saatlerin zaman dilimi</span>
                  <select
                    value={forexTz}
                    onChange={(e) => setForexTz(e.target.value)}
                    className="flex-1 px-3 py-2 bg-bg-input border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
                  >
                    <option value="local">Yerel saat (bu bilgisayar)</option>
                    <option value="utc">UTC</option>
                    <option value="est">New York (EST/EDT)</option>
                  </select>
                </div>
              )}
              <p className="text-text-secondary text-sm">
                CSV'de {mappedTrades.length} satır: {preparedPreview.valid.length} geçerli, {preparedPreview.issues.length} hatalı. Önizleme (ilk 50 geçerli işlem):
              </p>
              {preparedPreview.issues.length > 0 && (
                <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <p className="font-semibold mb-1">Hatalı satırlar içe aktarılmayacak:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {preparedPreview.issues.slice(0, 8).map((issue) => (
                      <li key={issue.sourceRow}>CSV kaydı {issue.sourceRow}: {issue.reasons.join(', ')}</li>
                    ))}
                  </ul>
                  {preparedPreview.issues.length > 8 && <p className="mt-1">ve {preparedPreview.issues.length - 8} satır daha.</p>}
                </div>
              )}
              {preparedPreview.valid.length > 500 && (
                <div role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  Tek seferde en fazla 500 işlem aktarılabilir. Dosyayı bölüp yeniden seçin.
                </div>
              )}
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-bg-input">
                      <th className="px-3 py-2 text-left text-text-tertiary font-medium">Kayıt</th>
                      <th className="px-3 py-2 text-left text-text-tertiary font-medium">Sembol</th>
                      <th className="px-3 py-2 text-left text-text-tertiary font-medium">Giriş Zamanı</th>
                      <th className="px-3 py-2 text-left text-text-tertiary font-medium">Çıkış Zamanı</th>
                      <th className="px-3 py-2 text-right text-text-tertiary font-medium">Giriş</th>
                      <th className="px-3 py-2 text-right text-text-tertiary font-medium">Çıkış</th>
                      <th className="px-3 py-2 text-right text-text-tertiary font-medium">{isForexExport ? 'Lot' : 'Miktar'}</th>
                      {isForexExport && <th className="px-3 py-2 text-right text-text-tertiary font-medium">Net K/Z</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preparedPreview.valid.slice(0, 50).map((t, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-3 py-1.5 text-text-muted">{t.sourceRow}</td>
                        <td className="px-3 py-1.5 font-mono text-text-primary font-semibold">{t.ticker}</td>
                        <td className="px-3 py-1.5 text-text-secondary">{t.enterTime}</td>
                        <td className="px-3 py-1.5 text-text-secondary">{t.exitTime}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-text-secondary">{t.enterPrice}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-text-secondary">{t.exitPrice}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-text-secondary">{t.quantity}</td>
                        {isForexExport && (
                          <td className={`px-3 py-1.5 text-right font-mono ${t.manualPL == null ? 'text-text-muted' : t.manualPL >= 0 ? 'text-positive' : 'text-negative'}`}>{t.manualPL == null ? '—' : t.manualPL.toFixed(2)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preparedPreview.valid.length > 50 && (
                <p className="text-text-muted text-xs">...ve {preparedPreview.valid.length - 50} işlem daha</p>
              )}
            </div>
          )}

          {/* Import success */}
          {importResult && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-positive/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icons.Check className="w-8 h-8 text-positive" />
              </div>
              <h3 className="text-text-primary font-semibold text-lg mb-2">İçe Aktarma Tamamlandı</h3>
              <p className="text-text-secondary text-sm">
                {importResult.imported} işlem başarıyla içe aktarıldı.
                {importResult.skipped > 0 ? ` ${importResult.skipped} tekrar eden işlem atlandı.` : ''}
                {importResult.rejectedRows > 0 ? ` ${importResult.rejectedRows} hatalı satır içe aktarılmadı.` : ''}
              </p>
              {importResult.issues?.length > 0 && (
                <div className="mx-auto mt-4 max-w-lg rounded-lg border border-warning/30 bg-warning/10 p-3 text-left">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-warning text-xs font-semibold">Reddedilen kayıtlar</p>
                    <button className="text-xs text-accent hover:underline" onClick={() => downloadRejectedRows(importResult.issues)}>
                      Raporu indir
                    </button>
                  </div>
                  <ul className="text-xs text-text-secondary space-y-1">
                    {importResult.issues.slice(0, 8).map((issue) => (
                      <li key={issue.sourceRow}>Kayıt {issue.sourceRow}: {issue.reasons.join(', ')}</li>
                    ))}
                  </ul>
                  {importResult.issues.length > 8 && <p className="mt-1 text-xs text-text-muted">Raporda {importResult.issues.length - 8} kayıt daha var.</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div>
            {step > 1 && !importResult && (
              <button className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors" onClick={() => setStep(step - 1)}>
                Geri
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors" onClick={onClose}>
              {importResult ? 'Bitti' : 'İptal'}
            </button>
            {step === 2 && (
              <button
                className="px-4 py-2 bg-accent text-accent-text text-sm font-semibold rounded-lg hover:brightness-110 transition-all"
                onClick={handleMapConfirm}
              >
                İşlemleri Önizle
              </button>
            )}
            {step === 3 && !importResult && (
              <button
                className="px-4 py-2 bg-accent text-accent-text text-sm font-semibold rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
                onClick={handleImport}
                disabled={importing || preparedPreview.valid.length === 0 || preparedPreview.valid.length > 500 || (numberWarnings.count > 0 && !ambiguousNumbersAccepted)}
              >
                {importing ? 'İçe aktarılıyor...' : `${preparedPreview.valid.length} İşlemi İçe Aktar`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

module.exports = CSVImportModal;
