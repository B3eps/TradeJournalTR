const React = require('react');
const { useState, useEffect } = React;
const Papa = require('papaparse');
const helper = require('../../helper.js');
const { authFetch } = helper;
const { getESTOffset, getNewYorkOffset } = require('../../utils/dateUtils');
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
    transform: (row) => {
      const isShort = row.Type && row.Type.toLowerCase() === 'short';
      const qty = Math.abs(parseFloat(row.Size) || 0);
      const pnl = parseFloat(row.PnL) || 0;
      const fees = parseFloat(row.Fees) || 0;
      return {
        ticker: parseContractTicker(row.ContractName),
        enterTime: row.EnteredAt,
        exitTime: row.ExitedAt,
        enterPrice: row.EntryPrice,
        exitPrice: row.ExitPrice,
        quantity: isShort ? -qty : qty,
        manualPL: pnl - fees,
        comments: '',
      };
    },
  },
  {
    name: 'Tradovate (Positions)',
    requiredHeaders: ['Product', 'Avg. Buy', 'Avg. Sell', 'Paired Qty', 'P/L', 'Buy Fill ID', 'Sell Fill ID', 'Bought Timestamp', 'Sold Timestamp'],
    transform: (row) => {
      const buyFillId = parseInt(row['Buy Fill ID']) || 0;
      const sellFillId = parseInt(row['Sell Fill ID']) || 0;
      const isLong = sellFillId > buyFillId;
      const qty = Math.abs(parseFloat(row['Paired Qty']) || 0);
      return {
        ticker: parseContractTicker(row.Product),
        enterTime: isLong ? row['Bought Timestamp'] : row['Sold Timestamp'],
        exitTime: isLong ? row['Sold Timestamp'] : row['Bought Timestamp'],
        enterPrice: isLong ? row['Avg. Buy'] : row['Avg. Sell'],
        exitPrice: isLong ? row['Avg. Sell'] : row['Avg. Buy'],
        quantity: isLong ? qty : -qty,
        manualPL: parseFloat(row['P/L']) || 0,
        comments: '',
      };
    },
  },
  {
    name: 'Tradovate (Fills)',
    requiredHeaders: ['symbol', 'buyFillId', 'sellFillId', 'qty', 'buyPrice', 'sellPrice', 'pnl', 'boughtTimestamp', 'soldTimestamp'],
    transform: (row) => {
      const buyFillId = parseInt(row.buyFillId) || 0;
      const sellFillId = parseInt(row.sellFillId) || 0;
      const isLong = sellFillId > buyFillId;
      const qty = Math.abs(parseFloat(row.qty) || 0);
      return {
        ticker: parseContractTicker(row.symbol),
        enterTime: isLong ? row.boughtTimestamp : row.soldTimestamp,
        exitTime: isLong ? row.soldTimestamp : row.boughtTimestamp,
        enterPrice: isLong ? row.buyPrice : row.sellPrice,
        exitPrice: isLong ? row.sellPrice : row.buyPrice,
        quantity: isLong ? qty : -qty,
        manualPL: parseFloat(row.pnl) || 0,
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
  let s = String(value).replace(/[−–]/g, '-').replace(/[\s  ']/g, '');
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
  return parseFloat(s);
};

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
  const p = parseBrokerDateParts(value);
  if (!p) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toISOString();
  }
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
  return isNaN(d.getTime()) ? value : d.toISOString();
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

  useEffect(() => {
    if (!isOpen) {
      setStep(1); setCsvData([]); setCsvHeaders([]); setColumnMap({});
      setMappedTrades([]); setImporting(false); setImportResult(null);
      setError(null); setDetectedFormat(null); setIsForexExport(false); setForexTz('local');
    }
  }, [isOpen]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);

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
          const trades = results.data
            .map(knownFormat.transform)
            .filter(t => t.ticker && t.enterTime && t.exitTime);
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
            const trades = results.data
              .map(buildForexTransform(fxMap))
              .filter(t => t.ticker && t.enterTime && t.exitTime && !isNaN(t.enterPrice) && !isNaN(t.exitPrice) && t.quantity);
            if (trades.length === 0) {
              setError('Dosyada içe aktarılabilecek kapanmış pozisyon bulunamadı. cTrader\'da "Geçmiş" (History) sekmesini, MT5\'te "Pozisyonlar" raporunu CSV olarak dışa aktardığınızdan emin olun.');
              return;
            }
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
    const missing = CSV_TRADE_FIELDS.filter(f => f.required && !columnMap[f.key]);
    if (missing.length > 0) {
      setError(`Eşleştirilmesi zorunlu alanlar eksik: ${missing.map(f => f.label).join(', ')}`);
      return;
    }

    const trades = csvData.map(row => {
      const trade = {};
      CSV_TRADE_FIELDS.forEach(field => {
        if (columnMap[field.key]) {
          trade[field.key] = row[columnMap[field.key]];
        }
      });
      return trade;
    }).filter(t => t.ticker && t.enterTime && t.exitTime)
      .map(t => ({ ...t, ticker: parseContractTicker(t.ticker) }));

    setMappedTrades(trades);
    setStep(3);
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      // CSV timestamps carry no timezone info; they are read as local time (the app's timezone).
      // Append the local offset so the server stores the correct UTC value instead of treating them as UTC.
      const toLocalIso = (ts) => {
        if (!ts) return ts;
        const s = String(ts).trim();
        const offset = getESTOffset(new Date(s));
        // Normalize "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS" for reliable parsing
        const normalized = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:)/, '$1T$2');
        const d = new Date(normalized + offset);
        return isNaN(d.getTime()) ? s : d.toISOString();
      };
      // Forex platform exports use the platform's display timezone (chosen by the user)
      const convertTime = isForexExport ? (ts) => brokerTimeToIso(ts, forexTz) : toLocalIso;
      const tradesToSend = mappedTrades.map(t => ({
        ...t,
        enterTime: convertTime(t.enterTime),
        exitTime: convertTime(t.exitTime),
        account: t.account || null,
      }));
      const response = await authFetch('/api/importTrades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: tradesToSend }),
      });
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setImportResult(data);
        sound.play('complete-all');
        triggerReload();
        if (data.skipped > 0 && onDuplicatesSkipped) {
          onDuplicatesSkipped(data.skipped);
        }
      }
    } catch (err) {
      setError('İçe aktarma başarısız oldu. Lütfen tekrar deneyin.');
    }
    setImporting(false);
  };

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
              <p className="text-text-secondary text-sm">{mappedTrades.length} işlem içe aktarılmaya hazır. Önizleme (ilk 50):</p>
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-bg-input">
                      <th className="px-3 py-2 text-left text-text-tertiary font-medium">#</th>
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
                    {mappedTrades.slice(0, 50).map((t, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-3 py-1.5 text-text-muted">{i + 1}</td>
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
              {mappedTrades.length > 50 && (
                <p className="text-text-muted text-xs">...ve {mappedTrades.length - 50} işlem daha</p>
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
              <p className="text-text-secondary text-sm">{importResult.imported} işlem başarıyla içe aktarıldı.{importResult.skipped > 0 ? ` ${importResult.skipped} tekrar eden işlem atlandı.` : ''}</p>
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
                disabled={importing}
              >
                {importing ? 'İçe aktarılıyor...' : `${mappedTrades.length} İşlemi İçe Aktar`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

module.exports = CSVImportModal;
