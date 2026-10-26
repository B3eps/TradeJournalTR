// Shared helpers for the Kartlar page.
const STATE_LABELS = { 0: 'Yeni', 1: 'Öğreniyor', 2: 'Tekrar', 3: 'Yeniden' };
const STATE_TONES = {
  0: 'bg-accent/10 text-accent border-accent/30',
  1: 'bg-warning/10 text-warning border-warning/30',
  2: 'bg-positive/10 text-positive border-positive/30',
  3: 'bg-negative/10 text-negative border-negative/30',
};

const DECK_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#eab308', '#64748b'];

const CLOZE_RE = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
const hasCloze = (text) => /\{\{c\d+::[\s\S]*?\}\}/.test(String(text || ''));

// Plain text (cloze answers revealed or hidden) for lists / previews.
const plainText = (text, hideCloze) => {
  let s = String(text || '');
  s = s.replace(CLOZE_RE, (m, ans, hint) => (hideCloze ? `[${hint || '...'}]` : ans));
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\s+/g, ' ')
    .trim();
};

const formatDue = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = d.getTime() - Date.now();
  const min = Math.abs(diff) / 60000;
  let txt;
  if (min < 1) return 'şimdi';
  if (min < 60) txt = `${Math.round(min)} dk`;
  else if (min < 60 * 24) txt = `${Math.round(min / 60)} sa`;
  else txt = `${Math.round(min / 1440)} g`;
  return diff < 0 ? `${txt} gecikmiş` : `${txt} sonra`;
};

const formatDuration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sn`;
  const m = Math.floor(s / 60);
  return `${m} dk ${String(s % 60).padStart(2, '0')} sn`;
};

const isTyping = (e) => {
  const t = e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
};

module.exports = { STATE_LABELS, STATE_TONES, DECK_COLORS, CLOZE_RE, hasCloze, plainText, formatDue, formatDuration, isTyping };
