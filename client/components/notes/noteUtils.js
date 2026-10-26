// Small helpers shared by the Notes page components.
const { navigate } = require('../../utils/navigation');

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

// "şimdi", "5 dk önce", "14:32", "dün", "12 Eki", "12 Eki 2025"
const relDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 45) return 'şimdi';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} dk önce`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'dün';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
};

// Rough plain-text excerpt for optimistic list updates (the server's version replaces it on reload).
const quickExcerpt = (md, max = 160) => {
  const s = String(md || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>+\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/\\([\\`*_[\]~#])/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

const PAGE_FOR_TYPE = { task: 'tasks', trade: 'trades', news: 'newsfeed' };

// Opens a non-note link target elsewhere in the app. Returns false for notes (handled by the page).
const openExternalTarget = (type, id) => {
  if (!id) return false;
  if (type === 'url') {
    try { window.open(id, '_blank', 'noopener,noreferrer'); } catch (e) { /* ignore */ }
    return true;
  }
  const page = PAGE_FOR_TYPE[type];
  if (!page) return false;
  navigate(page, id, { itemType: type });
  return true;
};

const downloadText = (filename, text, mime = 'text/markdown;charset=utf-8') => {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) {
    return false;
  }
};

const safeFileName = (title) => (String(title || 'not').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 120) || 'not');

// Front matter + body, same layout as GET /api/notes/export.
const noteToMarkdownFile = (note) => {
  const fm = [
    '---',
    `title: ${JSON.stringify(note.title || '')}`,
    `tags: [${(note.tags || []).map((t) => JSON.stringify(t)).join(', ')}]`,
    `created: ${note.createdAt || ''}`,
    `updated: ${note.updatedAt || ''}`,
    ...(note.pinned ? ['pinned: true'] : []),
    '---',
    '',
  ].join('\n');
  return fm + (note.body || '');
};

const isDateId = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

module.exports = { relDate, quickExcerpt, openExternalTarget, downloadText, safeFileName, noteToMarkdownFile, isDateId };
