// Shared helpers for the Tasks page (dates, formatting, sorting, view membership).
const { toISODate, addDays, startOfDay, normName, DAY_CODES } = require('../../utils/taskParse');

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

const todayISO = () => toISODate(new Date());
const isoPlus = (n) => toISODate(addDays(startOfDay(new Date()), n));

const parseISO = (iso) => {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

// whole days from today to iso (negative = past)
const dayDiff = (iso) => {
  const d = parseISO(iso);
  if (!d) return null;
  return Math.round((d - startOfDay(new Date())) / 86400000);
};

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const WEEKDAYS_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const WEEKDAYS_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const DAY_CODE_SHORT = { MO: 'Pzt', TU: 'Sal', WE: 'Çar', TH: 'Per', FR: 'Cum', SA: 'Cmt', SU: 'Paz' };

const shortDate = (iso) => {
  const d = parseISO(iso);
  if (!d) return '';
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() !== new Date().getFullYear() ? `${base} ${d.getFullYear()}` : base;
};

// "Bugün", "Yarın", "Dün", weekday name within a week, else "26 Eki"
const relativeDayLabel = (iso) => {
  const diff = dayDiff(iso);
  if (diff === null) return '';
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  if (diff === -1) return 'Dün';
  const d = parseISO(iso);
  if (diff > 1 && diff < 7) return WEEKDAYS_LONG[d.getDay()];
  return shortDate(iso);
};

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// { text, tone: 'overdue'|'today'|'future' } or null
const dueInfo = (task) => {
  if (!task || !task.dueDate) return null;
  const diff = dayDiff(task.dueDate);
  if (diff === null) return null;
  let tone = 'future';
  if (diff < 0) tone = 'overdue';
  else if (diff === 0) tone = task.dueTime && task.status !== 'done' && task.dueTime < nowHHMM() ? 'overdue' : 'today';
  const text = `${relativeDayLabel(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ''}`;
  return { text, tone };
};

const DUE_TONE_CLASS = {
  overdue: 'bg-negative/10 text-negative border-negative/30',
  today: 'bg-warning/10 text-warning border-warning/30',
  future: 'bg-bg-input text-text-secondary border-border',
};

const recurrenceLabel = (rec) => {
  if (!rec) return '';
  if (rec === 'daily') return 'Her gün';
  if (rec === 'weekdays') return 'Hafta içi her gün';
  if (rec.startsWith('weekly:')) {
    const codes = rec.slice(7).split(',').filter(Boolean);
    if (codes.length === 2 && codes.includes('SA') && codes.includes('SU')) return 'Her hafta sonu';
    return `Her ${codes.map(c => DAY_CODE_SHORT[c] || c).join(', ')}`;
  }
  if (rec.startsWith('monthly:')) return `Her ayın ${rec.slice(8)}. günü`;
  if (rec.startsWith('every:')) {
    const m = rec.slice(6).match(/^(\d+)([dw])$/);
    if (m) return `${m[1]} ${m[2] === 'd' ? 'günde' : 'haftada'} bir`;
  }
  return rec;
};

const PRIORITY = {
  1: { label: 'Öncelik 1', short: 'P1', color: 'rgb(var(--negative))', text: 'text-negative', chip: 'bg-negative/10 text-negative border-negative/30' },
  2: { label: 'Öncelik 2', short: 'P2', color: 'rgb(var(--warning))', text: 'text-warning', chip: 'bg-warning/10 text-warning border-warning/30' },
  3: { label: 'Öncelik 3', short: 'P3', color: 'rgb(var(--info))', text: 'text-info', chip: 'bg-info/10 text-info border-info/30' },
  4: { label: 'Öncelik 4', short: 'P4', color: 'rgb(var(--text-muted))', text: 'text-text-muted', chip: 'bg-bg-input text-text-secondary border-border' },
};
const prio = (p) => PRIORITY[p] || PRIORITY[4];

const PROJECT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b'];

const formatDuration = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} sa${m ? ` ${m} dk` : ''}`;
  if (m > 0) return `${m} dk`;
  return s > 0 ? `${s} sn` : '0 dk';
};

const formatClock = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// seconds of the current running session
const sessionSeconds = (task, nowMs) => {
  if (!task || !task.runningSince) return 0;
  const t = new Date(task.runningSince).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor(((nowMs || Date.now()) - t) / 1000));
};
const totalSpent = (task, nowMs) => (Number(task && task.spentSeconds) || 0) + sessionSeconds(task, nowMs);

const findInbox = (projects) => {
  if (!Array.isArray(projects) || projects.length === 0) return null;
  return projects.find(p => p.isInbox || p.inbox)
    || projects.find(p => normName(p.name) === 'gelenkutusu')
    || projects.find(p => normName(p.name) === 'inbox')
    || null;
};

// Defensive normalisation of a task coming from the server.
const normTask = (t) => {
  if (!t || typeof t !== 'object') return t;
  return {
    ...t,
    status: t.status === 'done' ? 'done' : 'open',
    priority: [1, 2, 3, 4].includes(Number(t.priority)) ? Number(t.priority) : 4,
    labels: Array.isArray(t.labels) ? t.labels : [],
    subtaskCount: Number(t.subtaskCount) || 0,
    subtaskDoneCount: Number(t.subtaskDoneCount) || 0,
    linkCount: Number(t.linkCount) || 0,
    spentSeconds: Number(t.spentSeconds) || 0,
  };
};

// Does `task` belong in the list currently displayed?
const belongsToView = (task, view, ctx = {}) => {
  if (!task || !view) return false;
  const open = task.status !== 'done';
  const today = todayISO();
  switch (view.type) {
    case 'inbox': {
      if (!open) return false;
      if (task.parentId) return false;
      return ctx.inboxId != null ? sameId(task.projectId, ctx.inboxId) : !task.projectId;
    }
    case 'today': return open && !!task.dueDate && task.dueDate <= today;
    case 'upcoming': return open && !!task.dueDate && task.dueDate >= today && task.dueDate <= isoPlus(6);
    case 'all': return open;
    case 'done': return !open;
    case 'project': return open && sameId(task.projectId, view.id);
    case 'label': return open && (task.labels || []).some(l => sameId(l.id, view.id));
    default: return open;
  }
};

const cmpDate = (a, b) => {
  const da = a.dueDate || '9999-99-99';
  const db = b.dueDate || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.dueTime || '99:99';
  const tb = b.dueTime || '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return 0;
};
const cmpManual = (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
const cmpCreated = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

const sortTasks = (list, sort) => {
  const arr = list.slice();
  if (sort === 'priority') arr.sort((a, b) => (a.priority - b.priority) || cmpDate(a, b) || cmpManual(a, b));
  else if (sort === 'date') arr.sort((a, b) => cmpDate(a, b) || (a.priority - b.priority) || cmpManual(a, b));
  else arr.sort((a, b) => cmpManual(a, b) || cmpCreated(a, b));
  return arr;
};

// Apply a PATCH body locally (labelIds -> label objects).
const applyPatch = (task, patch, labels) => {
  if (!task) return task;
  const next = { ...task, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'labelIds')) {
    const ids = patch.labelIds || [];
    next.labels = ids.map(id => (labels || []).find(l => sameId(l.id, id)) || (task.labels || []).find(l => sameId(l.id, id))).filter(Boolean);
    delete next.labelIds;
  }
  return next;
};

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
};

module.exports = {
  sameId,
  todayISO,
  isoPlus,
  parseISO,
  dayDiff,
  shortDate,
  relativeDayLabel,
  dueInfo,
  DUE_TONE_CLASS,
  recurrenceLabel,
  PRIORITY,
  prio,
  PROJECT_COLORS,
  formatDuration,
  formatClock,
  sessionSeconds,
  totalSpent,
  findInbox,
  normTask,
  belongsToView,
  sortTasks,
  applyPatch,
  isTypingTarget,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  MONTHS_SHORT,
  DAY_CODES,
  DAY_CODE_SHORT,
};
