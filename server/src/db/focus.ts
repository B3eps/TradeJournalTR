/**
 * Odak (Pomodoro): per-user timer settings and finished focus sessions.
 * Tables are created lazily on first use. Synchronous and owner-scoped.
 */
import type { Db } from './connection';
import { generateId } from '../utils/id';
import { ApiError, addDays, isValidDate, localDate } from './tasks';

const bad = (msg: string) => new ApiError(400, msg);

const DDL = `
CREATE TABLE IF NOT EXISTS focus_settings (
  user_id           TEXT PRIMARY KEY,
  work_min          INTEGER NOT NULL DEFAULT 25,
  short_min         INTEGER NOT NULL DEFAULT 5,
  long_min          INTEGER NOT NULL DEFAULT 15,
  long_every        INTEGER NOT NULL DEFAULT 4,
  auto_start_breaks INTEGER NOT NULL DEFAULT 0,
  sound_on          INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS focus_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id    TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('work', 'short', 'long')),
  started_at TEXT NOT NULL,
  ended_at   TEXT NOT NULL,
  seconds    INTEGER NOT NULL,
  completed  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_started ON focus_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions(task_id);
`;

const ready = new WeakSet<Db>();
export function ensureFocusSchema(db: Db): void {
  if (ready.has(db)) return;
  db.exec(DDL);
  ready.add(db);
}

export interface FocusSettings {
  workMin: number; shortMin: number; longMin: number; longEvery: number; autoStartBreaks: boolean; soundOn: boolean;
}

export const FOCUS_DEFAULTS: FocusSettings = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStartBreaks: false, soundOn: true };

interface SettingsRow {
  work_min: number; short_min: number; long_min: number; long_every: number; auto_start_breaks: number; sound_on: number;
}

export function getSettings(db: Db, userId: string): FocusSettings {
  ensureFocusSchema(db);
  const r = db.prepare('SELECT * FROM focus_settings WHERE user_id = ?').get(userId) as SettingsRow | undefined;
  if (!r) return { ...FOCUS_DEFAULTS };
  return { workMin: r.work_min, shortMin: r.short_min, longMin: r.long_min, longEvery: r.long_every, autoStartBreaks: !!r.auto_start_breaks, soundOn: !!r.sound_on };
}

function int(v: unknown, field: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} ${min} ile ${max} arasında bir tam sayı olmalı.`);
  return n;
}

export function saveSettings(db: Db, userId: string, body: Record<string, unknown>): FocusSettings {
  const cur = getSettings(db, userId);
  const next: FocusSettings = {
    workMin: body.workMin === undefined ? cur.workMin : int(body.workMin, 'Odak süresi', 1, 180),
    shortMin: body.shortMin === undefined ? cur.shortMin : int(body.shortMin, 'Kısa mola', 1, 60),
    longMin: body.longMin === undefined ? cur.longMin : int(body.longMin, 'Uzun mola', 1, 120),
    longEvery: body.longEvery === undefined ? cur.longEvery : int(body.longEvery, 'Uzun mola aralığı', 2, 12),
    autoStartBreaks: cur.autoStartBreaks,
    soundOn: cur.soundOn,
  };
  for (const k of ['autoStartBreaks', 'soundOn'] as const) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== 'boolean') throw bad(`${k} true/false olmalı.`);
      next[k] = body[k] as boolean;
    }
  }
  db.prepare(
    `INSERT INTO focus_settings (user_id, work_min, short_min, long_min, long_every, auto_start_breaks, sound_on)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET work_min = excluded.work_min, short_min = excluded.short_min, long_min = excluded.long_min,
       long_every = excluded.long_every, auto_start_breaks = excluded.auto_start_breaks, sound_on = excluded.sound_on`,
  ).run(userId, next.workMin, next.shortMin, next.longMin, next.longEvery, next.autoStartBreaks ? 1 : 0, next.soundOn ? 1 : 0);
  return next;
}

export interface FocusSessionAPI {
  id: string; taskId: string | null; kind: 'work' | 'short' | 'long'; startedAt: string; endedAt: string; seconds: number; completed: boolean;
}

function isoDate(v: unknown, field: string): string {
  if (typeof v !== 'string') throw bad(`${field} ISO tarih olmalı.`);
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw bad(`${field} geçerli bir tarih olmalı.`);
  return new Date(t).toISOString();
}

export function recordSession(db: Db, userId: string, body: Record<string, unknown>): FocusSessionAPI {
  ensureFocusSchema(db);
  const kind = body.kind;
  if (kind !== 'work' && kind !== 'short' && kind !== 'long') throw bad("kind 'work', 'short' veya 'long' olmalı.");
  const startedAt = isoDate(body.startedAt, 'startedAt');
  const endedAt = isoDate(body.endedAt, 'endedAt');
  if (endedAt < startedAt) throw bad('Bitiş, başlangıçtan önce olamaz.');
  const seconds = int(body.seconds, 'seconds', 0, 86400);
  if (typeof body.completed !== 'boolean') throw bad('completed true/false olmalı.');
  if (seconds === 0) throw bad('Süresi olmayan oturum kaydedilmez.');
  let taskId: string | null = null;
  if (body.taskId !== undefined && body.taskId !== null && body.taskId !== '') {
    if (typeof body.taskId !== 'string') throw bad('taskId metin olmalı.');
    // A task that was deleted during the session is simply dropped.
    const own = db.prepare('SELECT 1 FROM tasks WHERE id = ? AND user_id = ?').get(body.taskId, userId);
    taskId = own ? body.taskId : null;
  }
  const id = generateId();
  db.prepare('INSERT INTO focus_sessions (id, user_id, task_id, kind, started_at, ended_at, seconds, completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, taskId, kind, startedAt, endedAt, seconds, body.completed ? 1 : 0);
  return { id, taskId, kind, startedAt, endedAt, seconds, completed: body.completed };
}

export interface FocusStats {
  todaySeconds: number;
  todayPomodoros: number;
  byDay: Array<{ date: string; seconds: number; pomodoros: number }>;
  streakDays: number;
}

export function getStats(db: Db, userId: string, daysRaw: unknown, todayRaw: unknown): FocusStats {
  ensureFocusSchema(db);
  let days = daysRaw === undefined || daysRaw === '' ? 14 : Number(daysRaw);
  if (!Number.isFinite(days) || days < 1) throw bad('days pozitif bir sayı olmalı.');
  days = Math.min(365, Math.floor(days));
  if (todayRaw !== undefined && todayRaw !== '' && !isValidDate(todayRaw)) throw bad('today YYYY-AA-GG biçiminde olmalı.');
  const today = (todayRaw as string) || localDate(new Date());
  const lookback = Math.max(days, 400);
  const since = new Date(`${addDays(today, -lookback)}T00:00:00`).toISOString();
  const rows = db
    .prepare("SELECT started_at, seconds, completed FROM focus_sessions WHERE user_id = ? AND kind = 'work' AND started_at >= ?")
    .all(userId, since) as Array<{ started_at: string; seconds: number; completed: number }>;
  const per = new Map<string, { seconds: number; pomodoros: number }>();
  for (const r of rows) {
    const d = localDate(new Date(r.started_at));
    const cur = per.get(d) || { seconds: 0, pomodoros: 0 };
    cur.seconds += r.seconds;
    if (r.completed) cur.pomodoros++;
    per.set(d, cur);
  }
  const byDay: FocusStats['byDay'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const v = per.get(d);
    byDay.push({ date: d, seconds: v ? v.seconds : 0, pomodoros: v ? v.pomodoros : 0 });
  }
  // Streak: consecutive days with at least one completed pomodoro; today may still be empty.
  let streak = 0;
  let cursor = today;
  if (!(per.get(cursor)?.pomodoros)) cursor = addDays(cursor, -1);
  while (per.get(cursor)?.pomodoros) { streak++; cursor = addDays(cursor, -1); }
  const t = per.get(today);
  return { todaySeconds: t ? t.seconds : 0, todayPomodoros: t ? t.pomodoros : 0, byDay, streakDays: streak };
}
