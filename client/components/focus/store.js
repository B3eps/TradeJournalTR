// Module-level Pomodoro store. The timer is defined by an absolute end timestamp
// (`endsAt`) that is persisted to localStorage, so it survives page navigation and
// reloads; there is no accumulating tick. A single setTimeout fires at `endsAt`
// (and the deadline is re-checked when the tab becomes visible again).
const { request, enc } = require('../habits/api');
const sound = require('../../utils/sound');

const KEY = 'focus-timer-v1';
const PENDING_KEY = 'focus-pending-sessions-v1';
const MIN_RECORD_SECONDS = 60;

const DEFAULT_SETTINGS = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStartBreaks: false, soundOn: true };

const KIND_LABELS = { work: 'Odak', short: 'Kısa mola', long: 'Uzun mola' };

const minutesFor = (kind, s) => (kind === 'work' ? s.workMin : kind === 'short' ? s.shortMin : s.longMin);
const durationMs = (kind, s) => minutesFor(kind, s) * 60 * 1000;

const readJson = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
};

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const initialState = () => {
  const saved = readJson(KEY);
  const settings = { ...DEFAULT_SETTINGS, ...((saved && saved.settings) || {}) };
  const base = {
    kind: 'work', status: 'idle', endsAt: null, remainingMs: durationMs('work', settings), totalMs: durationMs('work', settings),
    startedAt: null, taskId: null, taskTitle: '', cycle: 0, settings, version: 0, notice: '', timerTaskId: null,
  };
  if (!saved || typeof saved !== 'object') return base;
  const kind = ['work', 'short', 'long'].includes(saved.kind) ? saved.kind : 'work';
  const status = ['idle', 'running', 'paused'].includes(saved.status) ? saved.status : 'idle';
  const totalMs = Math.max(1000, num(saved.totalMs, durationMs(kind, settings)));
  return {
    ...base,
    kind,
    status: status === 'running' && !num(saved.endsAt, 0) ? 'idle' : status,
    endsAt: status === 'running' ? num(saved.endsAt, null) : null,
    totalMs,
    remainingMs: Math.min(totalMs, Math.max(0, num(saved.remainingMs, totalMs))),
    startedAt: num(saved.startedAt, null),
    taskId: typeof saved.taskId === 'string' ? saved.taskId : null,
    taskTitle: typeof saved.taskTitle === 'string' ? saved.taskTitle : '',
    cycle: Math.max(0, Math.floor(num(saved.cycle, 0))),
    timerTaskId: typeof saved.timerTaskId === 'string' ? saved.timerTaskId : null,
  };
};

let state = initialState();
const listeners = new Set();
let timeoutId = null;

const persist = () => {
  const { notice, version, ...rest } = state;
  writeJson(KEY, rest);
};

const set = (patch) => {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
};

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getState = () => state;

const remainingAt = (s, now) => (s.status === 'running' ? Math.max(0, s.endsAt - now) : s.remainingMs);
const elapsedAt = (s, now) => Math.max(0, s.totalMs - remainingAt(s, now));

// ---- server sync (sessions are queued when the request fails) ----

const flushPending = async () => {
  const queue = readJson(PENDING_KEY);
  if (!Array.isArray(queue) || !queue.length) return;
  writeJson(PENDING_KEY, []);
  const failed = [];
  for (const item of queue) {
    try { await request('POST', '/api/focus/sessions', item); } catch (e) { if (!e.status || e.status >= 500) failed.push(item); }
  }
  if (failed.length) writeJson(PENDING_KEY, failed);
};

const postSession = async (payload) => {
  try {
    await request('POST', '/api/focus/sessions', payload);
    set({ version: state.version + 1 });
    flushPending();
  } catch (e) {
    if (!e.status || e.status >= 500) {
      const queue = readJson(PENDING_KEY);
      writeJson(PENDING_KEY, [...(Array.isArray(queue) ? queue : []), payload].slice(-50));
    }
  }
};

const stopTaskTimer = () => {
  const id = state.timerTaskId;
  if (!id) return;
  set({ timerTaskId: null });
  request('POST', `/api/tasks/${enc(id)}/timer/stop`).catch(() => {});
};

const startTaskTimer = () => {
  if (state.kind !== 'work' || !state.taskId || state.status !== 'running') return;
  const id = state.taskId;
  request('POST', `/api/tasks/${enc(id)}/timer/start`)
    .then(() => { if (state.status === 'running' && state.taskId === id) set({ timerTaskId: id, notice: '' }); else request('POST', `/api/tasks/${enc(id)}/timer/stop`).catch(() => {}); })
    .catch(() => set({ notice: 'Görev zamanlayıcısı başlatılamadı; odak süresi yine de sayılıyor.' }));
};

const askNotificationPermission = () => {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
  } catch (e) { /* ignore */ }
};

const announce = (title, body) => {
  // Global ses ayarı (sol şerit > Ses ve animasyon) sound.play içinde denetlenir.
  sound.play('alert');
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, silent: true });
  } catch (e) { /* ignore */ }
};

const nextAfterWork = (cycleAfter, settings) => (cycleAfter >= settings.longEvery ? 'long' : 'short');

const idleState = (kind, cycle) => ({
  kind, status: 'idle', endsAt: null, startedAt: null, cycle,
  totalMs: durationMs(kind, state.settings), remainingMs: durationMs(kind, state.settings),
});

const recordPartial = () => {
  const s = state;
  if (s.status === 'idle') return;
  const now = Date.now();
  const seconds = Math.round(elapsedAt(s, now) / 1000);
  if (seconds < MIN_RECORD_SECONDS || s.kind !== 'work') return;
  postSession({
    taskId: s.taskId, kind: s.kind, startedAt: new Date(s.startedAt || now - seconds * 1000).toISOString(),
    endedAt: new Date(now).toISOString(), seconds, completed: false,
  });
};

const clearTimer = () => { if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; } };

const schedule = () => {
  clearTimer();
  if (state.status !== 'running') return;
  const wait = Math.max(0, state.endsAt - Date.now());
  timeoutId = setTimeout(checkDue, Math.min(wait, 2147000000));
};

const complete = (late) => {
  const s = state;
  if (s.status !== 'running') return;
  clearTimer();
  const endedAt = s.endsAt;
  postSession({
    taskId: s.kind === 'work' ? s.taskId : null, kind: s.kind,
    startedAt: new Date(s.startedAt || endedAt - s.totalMs).toISOString(), endedAt: new Date(endedAt).toISOString(),
    seconds: Math.max(1, Math.round(s.totalMs / 1000)), completed: true,
  });
  if (s.kind === 'work') stopTaskTimer();
  let nextKind;
  let cycle = s.cycle;
  if (s.kind === 'work') { cycle += 1; nextKind = nextAfterWork(cycle, s.settings); }
  else { nextKind = 'work'; if (s.kind === 'long') cycle = 0; }
  set(idleState(nextKind, cycle));
  if (!late) {
    announce(s.kind === 'work' ? 'Odak tamamlandı' : 'Mola bitti', s.kind === 'work' ? `${KIND_LABELS[nextKind]} zamanı. Biraz nefes al.` : 'Hazır olduğunda yeni bir odak oturumu başlat.');
  }
  if (s.settings.autoStartBreaks && nextKind !== 'work' && !late) start();
};

function checkDue() {
  if (state.status !== 'running') return;
  const now = Date.now();
  if (now + 30 >= state.endsAt) complete(now - state.endsAt > 60 * 1000);
  else schedule();
}

function start() {
  const s = state;
  if (s.status === 'running') return;
  const now = Date.now();
  const remaining = s.remainingMs > 0 ? s.remainingMs : s.totalMs;
  set({ status: 'running', endsAt: now + remaining, remainingMs: remaining, startedAt: s.startedAt || now, notice: '' });
  schedule();
  startTaskTimer();
  askNotificationPermission();
}

const pause = () => {
  if (state.status !== 'running') return;
  const remaining = remainingAt(state, Date.now());
  clearTimer();
  set({ status: 'paused', endsAt: null, remainingMs: remaining });
  stopTaskTimer();
};

const toggle = () => { if (state.status === 'running') pause(); else start(); };

const skip = () => {
  const s = state;
  recordPartial();
  clearTimer();
  if (s.kind === 'work') {
    stopTaskTimer();
    set(idleState(nextAfterWork(s.cycle, s.settings), s.cycle));
  } else {
    set(idleState('work', s.kind === 'long' ? 0 : s.cycle));
  }
};

const reset = () => {
  recordPartial();
  clearTimer();
  if (state.kind === 'work') stopTaskTimer();
  set(idleState(state.kind, state.cycle));
};

const switchKind = (kind) => {
  if (kind === state.kind) return;
  recordPartial();
  clearTimer();
  stopTaskTimer();
  set(idleState(kind, state.cycle));
};

const setTask = (id, title) => {
  const changed = id !== state.taskId;
  if (changed && state.timerTaskId) stopTaskTimer();
  set({ taskId: id || null, taskTitle: id ? title || '' : '' });
  if (changed) startTaskTimer();
};

const applySettings = (incoming) => {
  const settings = { ...DEFAULT_SETTINGS, ...incoming };
  const patch = { settings };
  if (state.status === 'idle') {
    patch.totalMs = durationMs(state.kind, settings);
    patch.remainingMs = patch.totalMs;
  }
  set(patch);
};

let settingsLoaded = false;
const ensureSettings = async () => {
  if (settingsLoaded) return;
  try {
    const s = await request('GET', '/api/focus/settings');
    settingsLoaded = true;
    if (s) applySettings(s);
  } catch (e) { /* keep cached settings */ }
};

const saveSettings = async (patch) => {
  const s = await request('PUT', '/api/focus/settings', patch);
  settingsLoaded = true;
  applySettings(s);
  return s;
};

const clearNotice = () => set({ notice: '' });

// Boot: finish a session that ended while the page was closed, or re-arm the timeout.
if (state.status === 'running') checkDue();
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDue(); });
}
flushPending();

module.exports = {
  KIND_LABELS,
  DEFAULT_SETTINGS,
  getState,
  subscribe,
  start,
  pause,
  toggle,
  skip,
  reset,
  switchKind,
  setTask,
  ensureSettings,
  saveSettings,
  clearNotice,
  remainingAt,
  elapsedAt,
  minutesFor,
};
