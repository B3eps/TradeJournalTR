// Desktop notifications for the live news feed (web Notification API; works in Electron).
// Every function here is defensive: it must never throw if the API is unavailable.

const sound = require('./sound');

const SETTINGS_KEY = 'newsfeed-notify';
const SEEN_KEY = 'newsfeed-seen-ids';
const EVAL_KEY = 'newsfeed-evaluated-ids';

const LEVELS = [
  { id: 3, label: 'Sadece kritik (3)' },
  { id: 2, label: 'Önemli ve üstü (2+)' },
];

const isSupported = () => {
  try { return typeof window !== 'undefined' && 'Notification' in window; } catch { return false; }
};

const getPermission = () => {
  try { return isSupported() ? Notification.permission : 'unsupported'; } catch { return 'unsupported'; }
};

const loadSettings = () => {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && typeof s === 'object') {
      return { enabled: !!s.enabled, level: s.level === 2 ? 2 : 3 };
    }
  } catch {}
  return { enabled: false, level: 3 };
};

const saveSettings = (settings) => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
};

// Resolves to 'granted' | 'denied' | 'default' | 'unsupported'
const requestPermission = async () => {
  try {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
    const result = await Notification.requestPermission();
    return result || Notification.permission;
  } catch {
    return getPermission();
  }
};

// ---- seen / evaluated tracking (module variables mirrored to sessionStorage) ----
const readSet = (key) => {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return { set: new Set(), existed: false };
    const arr = JSON.parse(raw);
    return { set: new Set(Array.isArray(arr) ? arr : []), existed: true };
  } catch {
    return { set: new Set(), existed: false };
  }
};
const writeSet = (key, set) => {
  try {
    // Cap size so sessionStorage does not grow forever
    const arr = Array.from(set).slice(-2000);
    sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
};

const seenState = readSet(SEEN_KEY);
const evalState = readSet(EVAL_KEY);
let seenIds = seenState.set;
let evaluatedIds = evalState.set;
// If sessionStorage already had a seen list, the backlog was handled earlier in this session.
let initialized = seenState.existed;

const fire = (title, body) => {
  try {
    if (!isSupported() || Notification.permission !== 'granted') return;
    new Notification(title, { body, silent: false });
  } catch {}
};

const categoryLabel = (c) => (c === 'forex' ? 'Forex' : c === 'nasdaq' ? 'Nasdaq' : c === 'crypto' ? 'Coin' : c === 'metals' ? 'Değerli metaller' : (c || ''));
const isMetalNews = (item) => Array.isArray(item && item.instruments) && item.instruments.some((x) => x === 'XAU' || x === 'XAG');
const localizedTitle = (item) => item && item.evaluation && item.evaluation.turkce_baslik || item && item.title || 'Yeni haber';
const localizedSummary = (item) => {
  const ev = item && item.evaluation;
  if (!ev) return `${item && item.source || ''} · ${categoryLabel(item && item.category)}`;
  const metals = Array.isArray(ev.etkilenen) ? ev.etkilenen.filter((x) => x.enstruman === 'XAU' || x.enstruman === 'XAG') : [];
  const effects = metals.map((x) => `${x.enstruman}: ${x.etki}`).join(', ');
  return [ev.ozet, effects].filter(Boolean).join(' · ').slice(0, 500);
};

// Call after each successful poll with the full item list.
// pageVisible: true when the news page is the one currently on screen.
const processItems = (items, { pageVisible = true } = {}) => {
  try {
    if (!Array.isArray(items)) return;
    const settings = loadSettings();
    const suppress = (() => {
      try { return pageVisible && document.hasFocus() && document.visibilityState === 'visible'; } catch { return false; }
    })();
    const canNotify = initialized && settings.enabled && getPermission() === 'granted' && !suppress;

    let changed = false;
    let evalChanged = false;
    let criticalArrived = false;
    for (const item of items) {
      if (!item || !item.id) continue;
      const imp = Number(item.importance) || 0;
      const meets = imp >= settings.level;
      const wasSeen = seenIds.has(item.id);

      if (!wasSeen) {
        seenIds.add(item.id);
        changed = true;
        if (initialized && imp >= 3) criticalArrived = true;
        if (item.evaluation) { evaluatedIds.add(item.id); evalChanged = true; }
        if (canNotify && meets && (!isMetalNews(item) || item.evaluation)) {
          fire(localizedTitle(item), localizedSummary(item));
        }
      } else if (item.evaluation && !evaluatedIds.has(item.id)) {
        evaluatedIds.add(item.id);
        evalChanged = true;
        if (canNotify && meets) {
          fire(localizedTitle(item), localizedSummary(item));
          if (isMetalNews(item) && imp >= 2) criticalArrived = true;
        }
      }
    }
    initialized = true;
    // Kritik (3) bir haber geldiğinde tek bir uyarı sesi (ses ayarı sound.play içinde denetlenir).
    if (criticalArrived) sound.play('alert');
    if (changed) writeSet(SEEN_KEY, seenIds);
    if (evalChanged) writeSet(EVAL_KEY, evaluatedIds);
    // Make sure the "initialized" marker survives even when nothing changed on an empty first load
    if (!seenState.existed && !changed) writeSet(SEEN_KEY, seenIds);
  } catch {}
};

module.exports = {
  LEVELS,
  isSupported,
  getPermission,
  loadSettings,
  saveSettings,
  requestPermission,
  processItems,
};
