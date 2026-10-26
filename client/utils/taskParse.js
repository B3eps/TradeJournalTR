// =====================================================
// Quick-add natural-language parser (Turkish)
//
//   parseTaskInput("Yarın 18:00 ders çalış !1 #okul @acil", { projects, labels, now })
//
// Returns:
//   {
//     title,                     // text left after removing recognised tokens
//     dueDate: 'YYYY-MM-DD'|null,
//     dueTime: 'HH:MM'|null,
//     priority: 1..4|null,
//     recurrence: null|'daily'|'weekdays'|'weekly:MO,WE'|'monthly:15'|'every:3d'|'every:2w',
//     project: { id, name, raw, matched } | null,   // matched=false when no project fits
//     labels: [{ id|null, name, raw, isNew }],
//     tokens: [{ key, type, raw, start, end }],     // every recognised piece, for chips
//     timeRolledToTomorrow: boolean                  // only a time was given and it already passed
//   }
//
// `disabled` (Set of token keys) lets the UI "remove" a chip: a disabled token is not
// parsed, so its text simply stays in the title. Keys: a whole type ('date', 'time',
// 'priority', 'recurrence', 'project'), one specific token '<type>|<folded raw text>'
// (e.g. 'date|yarin', as built by tokenDisableKey), or 'label:<folded name>'.
//
// Matching is done on a "folded" copy of the input (Turkish lower-case + diacritics
// stripped, same length as the original) so indexes map 1:1 back to the original text.
//
// ---- Mental unit tests (now = Sunday 2026-10-25 12:00, projects: Gelen Kutusu, Okul,
// ---- Trade, Kişisel; labels: acil) ----
// parse("Yarın 18:00 ders çalış !1 #okul @acil")
//   -> title 'ders çalış', dueDate '2026-10-26', dueTime '18:00', priority 1,
//      project Okul (matched), labels [{name:'acil', isNew:false}]
// parse("öbür gün rapor")            -> dueDate '2026-10-27', title 'rapor'
// parse("pazartesi toplantı")        -> dueDate '2026-10-26' (next occurrence, today excluded)
// parse("pazar spor")                -> dueDate '2026-11-01' (today is Sunday -> next week)
// parse("bu pazar spor")             -> dueDate '2026-10-25' ('bu' includes today)
// parse("3 gün sonra fatura")        -> dueDate '2026-10-28'
// parse("gelecek hafta plan")        -> dueDate '2026-10-26' (next Monday)
// parse("haftaya cuma sınav")        -> dueDate '2026-10-30' (Friday of the week starting next Monday)
// parse("12.11 vize")                -> dueDate '2026-11-12'
// parse("01.02.2027 kayıt")          -> dueDate '2027-02-01'
// parse("15 Kasım doğum günü")       -> dueDate '2026-11-15'
// parse("rapor 18.30")               -> dueTime '18:30', dueDate '2026-10-25' (no month 30 -> time)
// parse("saat 5 ara")                -> dueTime '17:00' (bare 1..6 o'clock => afternoon)
// parse("sabah 8 koşu")              -> dueTime '08:00'
// parse("akşam 9'da film")           -> dueTime '21:00'
// parse("09:00 kahvaltı")            -> dueTime '09:00', dueDate '2026-10-26' (09:00 already passed)
// parse("her gün kitap oku")         -> recurrence 'daily', dueDate '2026-10-25'
// parse("hafta içi her gün borsa")   -> recurrence 'weekdays', dueDate '2026-10-26'
// parse("her pazartesi ve çarşamba gym") -> recurrence 'weekly:MO,WE', dueDate '2026-10-26'
// parse("her hafta rapor")           -> recurrence 'weekly:SU', dueDate '2026-10-25'
// parse("her ay 15'inde kira")       -> recurrence 'monthly:15', dueDate '2026-11-15'
// parse("her 3 günde bir sulama")    -> recurrence 'every:3d', dueDate '2026-10-25'
// parse("2 haftada bir rapor")       -> recurrence 'every:2w'
// parse("p2 #gelen not al")          -> priority 2, project Gelen Kutusu (prefix match)
// parse("#okl ödev")                 -> project Okul (edit distance 1)
// parse("@yeni ödev")                -> labels [{name:'yeni', isNew:true}]
// parse("mail a@b.com")              -> no label (an '@' must start a word)
// parse("yarın ders", { disabled: new Set(['date']) }) -> title 'yarın ders', dueDate null
// =====================================================

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // index = Date#getDay()

// folded weekday name -> getDay() index
const WEEKDAY_INDEX = {
  pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6, pazar: 0,
};
// longer names first so "cumartesi" wins over "cuma", "pazartesi" over "pazar"
const DAYS_RE = '(pazartesi|cumartesi|carsamba|persembe|sali|cuma|pazar)';

const MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
const MONTHS_RE = `(${MONTHS.join('|')})`;

const B = '(?<![\\p{L}\\p{N}])'; // word start
const E = '(?![\\p{L}\\p{N}])'; // word end
// optional Turkish case suffix after dates/times: yarın'a, cumaya, 18:00'de, 5'te, 15'inde
const SUF = "(?:['’]?(?:[dt][ae]n?|y?[ae]|ki))?";

const FOLD_MAP = {
  ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u', é: 'e',
};

// Lower-case (Turkish rules) and strip diacritics, keeping exactly the same length.
const fold = (s) => {
  const str = String(s || '');
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    let l = c.toLocaleLowerCase('tr-TR');
    if (l.length !== 1) l = c.toLowerCase();
    if (l.length !== 1) l = c;
    out += FOLD_MAP[l] || l;
  }
  return out;
};

// Normalised key for fuzzy name matching ("Gelen Kutusu" -> "gelenkutusu").
const normName = (s) => fold(s).replace(/[\s_\-./]+/g, '');

const pad2 = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isValidYMD = (y, m, d) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
const nextMonday = (today) => {
  const dow = today.getDay();
  const delta = dow === 1 ? 7 : (8 - dow) % 7 || 7;
  return addDays(today, delta);
};
const addMonthsClamped = (d, n) => {
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), last));
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
};

// Best fuzzy match of `query` among items with a `name`; null if nothing is close.
const fuzzyFind = (query, items) => {
  const q = normName(query);
  if (!q || !Array.isArray(items) || items.length === 0) return null;
  const list = items.filter(it => it && it.name).map(it => ({ it, n: normName(it.name) }));
  let hit = list.find(x => x.n === q);
  if (hit) return hit.it;
  hit = list.find(x => x.n.startsWith(q));
  if (hit) return hit.it;
  if (q.length >= 3) {
    hit = list.find(x => x.n.includes(q));
    if (hit) return hit.it;
  }
  const maxDist = q.length > 4 ? 2 : 1;
  let best = null;
  let bestD = Infinity;
  list.forEach(x => {
    const d = Math.min(levenshtein(q, x.n), levenshtein(q, x.n.slice(0, q.length)));
    if (d < bestD) { bestD = d; best = x.it; }
  });
  return bestD <= maxDist ? best : null;
};

// Convert a spoken hour to 24h using an optional day-part word.
const adjustHour = (h, part, hasMinutes, viaSaat) => {
  let hour = h;
  if (part === 'sabah') {
    if (hour === 12) hour = 0;
  } else if (part === 'ogle' || part === 'oglen') {
    if (hour >= 1 && hour <= 5) hour += 12;
  } else if (part === 'ogleden sonra' || part === 'aksam') {
    if (hour < 12) hour += 12;
  } else if (part === 'gece') {
    if (hour >= 7 && hour < 12) hour += 12;
    else if (hour === 12) hour = 0;
  } else if (viaSaat && !hasMinutes && hour >= 1 && hour <= 6) {
    // "saat 5" in everyday Turkish almost always means 17:00
    hour += 12;
  }
  return hour;
};

// First due date that satisfies a recurrence rule, starting today.
const firstOccurrence = (rec, today) => {
  if (!rec) return null;
  if (rec === 'daily' || rec.startsWith('every:')) return today;
  if (rec === 'weekdays') {
    let d = today;
    while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
    return d;
  }
  if (rec.startsWith('weekly:')) {
    const codes = rec.slice(7).split(',');
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      if (codes.includes(DAY_CODES[d.getDay()])) return d;
    }
    return today;
  }
  if (rec.startsWith('monthly:')) {
    const dom = parseInt(rec.slice(8), 10);
    for (let i = 0; i < 3; i++) {
      const y = today.getFullYear();
      const m = today.getMonth() + i;
      const last = new Date(y, m + 1, 0).getDate();
      const d = new Date(y, m, Math.min(dom, last));
      if (d >= today) return d;
    }
  }
  return today;
};

const parseTaskInput = (input, opts = {}) => {
  const text = String(input || '');
  const folded = fold(text);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const today = startOfDay(now);
  const disabled = opts.disabled instanceof Set ? opts.disabled : new Set(opts.disabled || []);
  const projects = Array.isArray(opts.projects) ? opts.projects : [];
  const labels = Array.isArray(opts.labels) ? opts.labels : [];

  const consumed = []; // [start, end)
  const tokens = [];
  const isFree = (s, e) => consumed.every(([a, b]) => e <= a || s >= b);

  const result = {
    title: '',
    dueDate: null,
    dueTime: null,
    priority: null,
    recurrence: null,
    project: null,
    labels: [],
    tokens,
    timeRolledToTomorrow: false,
  };
  let date = null; // Date
  let weeklyAuto = false;
  let monthlyAuto = false;

  // Runs `pattern` over the folded text; `handler(match)` returns true if it took the match.
  const scan = (type, pattern, handler) => {
    const re = new RegExp(pattern, 'gu');
    let m;
    while ((m = re.exec(folded)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const start = m.index;
      const end = start + m[0].length;
      if (!isFree(start, end)) continue;
      const key = handler(m, start, end);
      if (key) {
        consumed.push([start, end]);
        tokens.push({ key, type, raw: text.slice(start, end), start, end });
      }
    }
  };
  // `disabled` may hold a whole type ('date') or one specific token ('date|yarin', folded raw text)
  const once = (type, pattern, handler) => {
    if (disabled.has(type)) return;
    scan(type, pattern, (m, s, e) => {
      if (tokens.some(t => t.type === type)) return null;
      if (disabled.has(`${type}|${folded.slice(s, e)}`)) return null;
      return handler(m, s, e) ? type : null;
    });
  };

  // ---------- 1. Recurrence ----------
  const setRec = (r) => { result.recurrence = r; return true; };
  once('recurrence', `${B}(?:hafta\\s+ici\\s+her\\s+gun|her\\s+hafta\\s+ici)${E}`, () => setRec('weekdays'));
  once('recurrence', `${B}her\\s+hafta\\s+sonu${E}`, () => setRec('weekly:SA,SU'));
  once('recurrence', `${B}(?:her\\s+)?(\\d{1,3})\\s+(gun|hafta)[dt][ae]\\s+bir${E}`, (m) => {
    const n = parseInt(m[1], 10);
    if (!n) return false;
    return setRec(`every:${n}${m[2] === 'gun' ? 'd' : 'w'}`);
  });
  once('recurrence', `${B}her\\s+(\\d{1,3})\\s+(gun|hafta)${E}`, (m) => {
    const n = parseInt(m[1], 10);
    if (!n) return false;
    return setRec(`every:${n}${m[2] === 'gun' ? 'd' : 'w'}`);
  });
  once('recurrence', `${B}gun\\s+asiri${E}`, () => setRec('every:2d'));
  once('recurrence', `${B}(?:her\\s+gun|hergun)${E}`, () => setRec('daily'));
  once('recurrence', `${B}her\\s+${DAYS_RE}(?:(?:\\s*,\\s*|\\s+ve\\s+|\\s+)${DAYS_RE})*(?:\\s+gun(?:u|leri))?${E}`, (m) => {
    const names = m[0].match(new RegExp(DAYS_RE, 'g')) || [];
    const idx = [...new Set(names.map(n => WEEKDAY_INDEX[n]))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    return setRec(`weekly:${idx.map(i => DAY_CODES[i]).join(',')}`);
  });
  once('recurrence', `${B}${DAYS_RE}(?:leri|lari)${E}`, (m) => setRec(`weekly:${DAY_CODES[WEEKDAY_INDEX[m[1]]]}`));
  once('recurrence', `${B}her\\s+ay(?:in)?\\s+(\\d{1,2})(?:\\s*['’]?\\s*(?:sinde|inde|unde|inda|unda|nde|nda|si|su|i|u))?${E}`, (m) => {
    const dom = parseInt(m[1], 10);
    if (dom < 1 || dom > 31) return false;
    return setRec(`monthly:${dom}`);
  });
  once('recurrence', `${B}her\\s+ay${E}`, () => { monthlyAuto = true; return setRec('monthly:auto'); });
  once('recurrence', `${B}her\\s+hafta${E}`, () => { weeklyAuto = true; return setRec('weekly:auto'); });

  // ---------- 2. Times with "saat" or a day-part word ----------
  const setTime = (h, min) => {
    if (h < 0 || h > 23 || min < 0 || min > 59) return false;
    result.dueTime = `${pad2(h)}:${pad2(min)}`;
    return true;
  };
  const PART = '(sabah|ogleden\\s+sonra|oglen|ogle|aksam|gece)';
  once('time', `${B}(?:${PART}\\s+)?saat\\s+(\\d{1,2})(?:[:.](\\d{2}))?${SUF}${E}`, (m) => {
    const part = m[1] ? m[1].replace(/\s+/g, ' ') : null;
    const hasMin = m[3] != null;
    const h = adjustHour(parseInt(m[2], 10), part, hasMin, true);
    return setTime(h, hasMin ? parseInt(m[3], 10) : 0);
  });
  once('time', `${B}${PART}\\s+(\\d{1,2})(?:[:.](\\d{2}))?${SUF}${E}`, (m) => {
    const part = m[1].replace(/\s+/g, ' ');
    const hasMin = m[3] != null;
    const h = adjustHour(parseInt(m[2], 10), part, hasMin, false);
    return setTime(h, hasMin ? parseInt(m[3], 10) : 0);
  });
  // ---------- 3. HH:MM ----------
  once('time', `${B}(\\d{1,2}):(\\d{2})${SUF}${E}`, (m) => setTime(parseInt(m[1], 10), parseInt(m[2], 10)));

  // ---------- 4. Explicit dates ----------
  const setDate = (d) => { date = d; return true; };
  once('date', `${B}(\\d{1,2})[./](\\d{1,2})[./](\\d{4}|\\d{2})${SUF}${E}`, (m) => {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    if (!isValidYMD(y, mo, d)) return false;
    return setDate(new Date(y, mo - 1, d));
  });
  const dayMonth = (d, mo, yearGiven) => {
    let y = yearGiven || today.getFullYear();
    if (!isValidYMD(y, mo, d)) return null;
    let dt = new Date(y, mo - 1, d);
    if (!yearGiven && dt < today) {
      y += 1;
      if (!isValidYMD(y, mo, d)) return null;
      dt = new Date(y, mo - 1, d);
    }
    return dt;
  };
  once('date', `${B}(\\d{1,2})\\s+${MONTHS_RE}(?:\\s+(\\d{4}))?${SUF}${E}`, (m) => {
    const dt = dayMonth(parseInt(m[1], 10), MONTHS.indexOf(m[2]) + 1, m[3] ? parseInt(m[3], 10) : null);
    return dt ? setDate(dt) : false;
  });
  // dd.mm / dd/mm : a date only when the second part is a real month (else it's a time, e.g. 18.30)
  once('date', `${B}(\\d{1,2})([./])(\\d{1,2})${SUF}${E}`, (m) => {
    const dt = dayMonth(parseInt(m[1], 10), parseInt(m[3], 10), null);
    return dt ? setDate(dt) : false;
  });

  // ---------- 5. HH.MM ----------
  // two-digit hour required so prices like "3.50" are not read as a time
  once('time', `${B}(\\d{2})\\.(\\d{2})${SUF}${E}`, (m) => setTime(parseInt(m[1], 10), parseInt(m[2], 10)));

  // ---------- 6. Relative dates ----------
  once('date', `${B}(?:obur\\s?gun|obursu\\s?gun)${SUF}${E}`, () => setDate(addDays(today, 2)));
  once('date', `${B}bugun${SUF}${E}`, () => setDate(today));
  once('date', `${B}yarin${SUF}${E}`, () => setDate(addDays(today, 1)));
  once('date', `${B}(\\d{1,3})\\s+(gun|hafta|ay)\\s+sonra(?:ya|ki)?${E}`, (m) => {
    const n = parseInt(m[1], 10);
    if (m[2] === 'gun') return setDate(addDays(today, n));
    if (m[2] === 'hafta') return setDate(addDays(today, n * 7));
    return setDate(addMonthsClamped(today, n));
  });
  once('date', `${B}(?:(gelecek|onumuzdeki|haftaya|bu)\\s+)?${DAYS_RE}${SUF}${E}`, (m) => {
    const target = WEEKDAY_INDEX[m[2]];
    const prefix = m[1];
    if (prefix && prefix !== 'bu') {
      const mon = nextMonday(today);
      return setDate(addDays(mon, (target + 6) % 7));
    }
    let delta = (target - today.getDay() + 7) % 7;
    if (delta === 0 && prefix !== 'bu') delta = 7;
    return setDate(addDays(today, delta));
  });
  once('date', `${B}(?:(?:gelecek|onumuzdeki)\\s+hafta(?:ya)?|haftaya)${E}`, () => setDate(nextMonday(today)));
  once('date', `${B}(?:gelecek|onumuzdeki)\\s+ay${E}`, () => setDate(addMonthsClamped(today, 1)));

  // ---------- 7. Priority ----------
  once('priority', `(?<![\\p{L}\\p{N}!])!([1-4])(?![\\p{N}])`, (m) => { result.priority = parseInt(m[1], 10); return true; });
  once('priority', `${B}p([1-4])${E}`, (m) => { result.priority = parseInt(m[1], 10); return true; });

  // ---------- 8. Project ----------
  once('project', `(?<!\\S)#([\\p{L}\\p{N}_\\-./]+)`, (m, s, e) => {
    const raw = text.slice(s + 1, e);
    const hit = fuzzyFind(raw, projects);
    result.project = hit
      ? { id: hit.id, name: hit.name, raw, matched: true }
      : { id: null, name: raw, raw, matched: false };
    return true;
  });

  // ---------- 9. Labels (several allowed) ----------
  scan('label', `(?<!\\S)@([\\p{L}\\p{N}_\\-]+)`, (m, s, e) => {
    const raw = text.slice(s + 1, e);
    const key = `label:${fold(raw)}`;
    if (disabled.has(key)) return null;
    if (result.labels.some(l => fold(l.name) === fold(raw))) return key; // duplicate: just strip it
    const hit = labels.find(l => l && l.name && normName(l.name) === normName(raw));
    result.labels.push(hit ? { id: hit.id, name: hit.name, raw, isNew: false } : { id: null, name: raw, raw, isNew: true });
    return key;
  });

  // ---------- Finalise ----------
  if (result.recurrence && (weeklyAuto || monthlyAuto)) {
    const base = date || today;
    result.recurrence = weeklyAuto ? `weekly:${DAY_CODES[base.getDay()]}` : `monthly:${base.getDate()}`;
  }
  if (!date && result.recurrence) date = firstOccurrence(result.recurrence, today);
  if (!date && result.dueTime) {
    const [hh, mm] = result.dueTime.split(':').map(Number);
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hh, mm);
    if (at < now) { date = addDays(today, 1); result.timeRolledToTomorrow = true; } else date = today;
  }
  result.dueDate = date ? toISODate(date) : null;

  // Title = original text minus consumed spans
  const spans = consumed.slice().sort((a, b) => a[0] - b[0]);
  let title = '';
  let pos = 0;
  spans.forEach(([s, e]) => { title += `${text.slice(pos, s)} `; pos = e; });
  title += text.slice(pos);
  result.title = title.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, '').trim();
  tokens.sort((a, b) => a.start - b.start);
  return result;
};

// Key that disables exactly this token (the same words typed again elsewhere stay disabled,
// but a different date/time/etc. is parsed normally).
const tokenDisableKey = (token) => {
  if (!token) return '';
  if (token.type === 'label') return token.key;
  return `${token.type}|${fold(token.raw)}`;
};

module.exports = {
  parseTaskInput,
  tokenDisableKey,
  fold,
  normName,
  fuzzyFind,
  toISODate,
  addDays,
  startOfDay,
  firstOccurrence,
  DAY_CODES,
};
