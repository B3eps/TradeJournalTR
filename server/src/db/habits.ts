/**
 * Alışkanlıklar (habit tracker). Tables are created lazily on first use:
 *   habits        one row per habit (user-scoped, soft-archived)
 *   habit_checks  one row per habit and day (PRIMARY KEY(habit_id, date))
 *
 * Streak rules
 *   - "daily" habits (no weekly target below 7, or a weekday mask): consecutive
 *     scheduled days with done=true. A scheduled day that is still open today does
 *     not break the streak; unscheduled days are skipped.
 *   - "weekly" habits (targetPerWeek < 7, no mask): consecutive Monday-Sunday
 *     weeks that reached the target. The running week never breaks the streak.
 * All functions are synchronous and owner-scoped by userId.
 */
import type { Db } from './connection';
import { generateId } from '../utils/id';
import { ApiError, addDays, isValidDate, localDate } from './tasks';

const bad = (msg: string) => new ApiError(400, msg);

export const HABIT_LIMITS = { nameMax: 60, maxActive: 60, noteMax: 500, maxHistoryDays: 730 };

const DDL = `
CREATE TABLE IF NOT EXISTS habits (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  icon            TEXT NOT NULL DEFAULT '✅',
  color           TEXT NOT NULL DEFAULT '#6366f1',
  target_per_week INTEGER NOT NULL DEFAULT 7 CHECK (target_per_week BETWEEN 1 AND 7),
  days_mask       INTEGER,
  sort_order      REAL NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id, archived, sort_order);
CREATE TABLE IF NOT EXISTS habit_checks (
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL,
  date     TEXT NOT NULL,
  done     INTEGER NOT NULL DEFAULT 1,
  note     TEXT,
  PRIMARY KEY (habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_habit_checks_user_date ON habit_checks(user_id, date);
`;

const ready = new WeakSet<Db>();
export function ensureHabitsSchema(db: Db): void {
  if (ready.has(db)) return;
  db.exec(DDL);
  ready.add(db);
}

// ─── Date helpers ────────────────────────────────────────────────────────────

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function weekStart(ymd: string): string {
  return addDays(ymd, -weekdayIndex(ymd));
}

function daysBetween(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

function resolveToday(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return localDate(new Date());
  if (!isValidDate(raw)) throw bad('today YYYY-AA-GG biçiminde olmalı.');
  return raw;
}

// ─── Streak math (pure) ──────────────────────────────────────────────────────

export interface ScheduleInfo { targetPerWeek: number; daysMask: number | null }

export type StreakMode = 'daily' | 'weekly';

export function modeOf(h: ScheduleInfo): StreakMode {
  return h.daysMask == null && h.targetPerWeek < 7 ? 'weekly' : 'daily';
}

export function isScheduled(h: ScheduleInfo, ymd: string): boolean {
  if (h.daysMask == null) return true;
  return (h.daysMask & (1 << weekdayIndex(ymd))) !== 0;
}

/** Current and best streak for a set of done dates, evaluated as of `today`. */
export function computeStreaks(h: ScheduleInfo, done: Set<string>, today: string): { streak: number; best: number; unit: 'day' | 'week' } {
  if (done.size === 0) return { streak: 0, best: 0, unit: modeOf(h) === 'weekly' ? 'week' : 'day' };
  const first = [...done].sort()[0];
  let run = 0;
  let best = 0;
  if (modeOf(h) === 'daily') {
    const span = daysBetween(first, today);
    for (let i = 0; i <= span; i++) {
      const d = addDays(first, i);
      if (!isScheduled(h, d)) continue;
      if (done.has(d)) { run++; if (run > best) best = run; }
      else if (d !== today) run = 0;
    }
    return { streak: run, best, unit: 'day' };
  }
  const perWeek = new Map<string, number>();
  for (const d of done) { const w = weekStart(d); perWeek.set(w, (perWeek.get(w) || 0) + 1); }
  const thisWeek = weekStart(today);
  for (let w = weekStart(first); w <= thisWeek; w = addDays(w, 7)) {
    if ((perWeek.get(w) || 0) >= h.targetPerWeek) { run++; if (run > best) best = run; }
    else if (w !== thisWeek) run = 0;
  }
  return { streak: run, best, unit: 'week' };
}

// ─── Rows / API shapes ───────────────────────────────────────────────────────

interface HabitRow {
  id: string; user_id: string; name: string; icon: string; color: string;
  target_per_week: number; days_mask: number | null; sort_order: number; archived: number; created_at: string;
}

export interface HabitAPI {
  id: string;
  name: string;
  icon: string;
  color: string;
  targetPerWeek: number;
  daysOfWeek: number[] | null;
  archived: boolean;
  createdAt: string;
  streak: number;
  bestStreak: number;
  streakUnit: 'day' | 'week';
  weekCount: number;
  doneToday: boolean;
  scheduledToday: boolean;
}

const maskToDays = (mask: number | null): number[] | null =>
  mask == null ? null : [0, 1, 2, 3, 4, 5, 6].filter((i) => (mask & (1 << i)) !== 0);

function loadDone(db: Db, habitIds: string[], sinceDate?: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const id of habitIds) out.set(id, new Set());
  if (!habitIds.length) return out;
  const rows = db
    .prepare(`SELECT habit_id, date FROM habit_checks WHERE done = 1 AND habit_id IN (SELECT value FROM json_each(?))${sinceDate ? ' AND date >= ?' : ''}`)
    .all(...(sinceDate ? [JSON.stringify(habitIds), sinceDate] : [JSON.stringify(habitIds)])) as Array<{ habit_id: string; date: string }>;
  for (const r of rows) out.get(r.habit_id)?.add(r.date);
  return out;
}

function toApi(row: HabitRow, done: Set<string>, today: string): HabitAPI {
  const sched: ScheduleInfo = { targetPerWeek: row.target_per_week, daysMask: row.days_mask };
  const s = computeStreaks(sched, done, today);
  const ws = weekStart(today);
  let weekCount = 0;
  for (const d of done) if (d >= ws && d <= addDays(ws, 6)) weekCount++;
  return {
    id: row.id, name: row.name, icon: row.icon, color: row.color,
    targetPerWeek: row.target_per_week, daysOfWeek: maskToDays(row.days_mask),
    archived: !!row.archived, createdAt: row.created_at,
    streak: s.streak, bestStreak: s.best, streakUnit: s.unit,
    weekCount, doneToday: done.has(today), scheduledToday: isScheduled(sched, today),
  };
}

function fetchRows(db: Db, userId: string, archived: boolean | 'all'): HabitRow[] {
  ensureHabitsSchema(db);
  const where = archived === 'all' ? '' : ` AND archived = ${archived ? 1 : 0}`;
  return db.prepare(`SELECT * FROM habits WHERE user_id = ?${where} ORDER BY sort_order, created_at`).all(userId) as HabitRow[];
}

export function listHabits(db: Db, userId: string, archivedRaw: unknown, todayRaw: unknown): HabitAPI[] {
  const today = resolveToday(todayRaw);
  const archived = archivedRaw === '1' || archivedRaw === 'true' ? true : archivedRaw === 'all' ? 'all' : false;
  const rows = fetchRows(db, userId, archived);
  const done = loadDone(db, rows.map((r) => r.id));
  return rows.map((r) => toApi(r, done.get(r.id)!, today));
}

export function getHabit(db: Db, userId: string, id: string, todayRaw?: unknown): HabitAPI | null {
  ensureHabitsSchema(db);
  const row = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(id, userId) as HabitRow | undefined;
  if (!row) return null;
  return toApi(row, loadDone(db, [row.id]).get(row.id)!, resolveToday(todayRaw));
}

export interface TodayHabit { id: string; name: string; icon: string; color: string; done: boolean; streak: number; targetPerWeek: number; weekCount: number }

/** Active habits that are scheduled today (the Home widget shape). */
export function listToday(db: Db, userId: string, todayRaw: unknown): TodayHabit[] {
  return listHabits(db, userId, false, todayRaw)
    .filter((h) => h.scheduledToday)
    .map((h) => ({ id: h.id, name: h.name, icon: h.icon, color: h.color, done: h.doneToday, streak: h.streak, targetPerWeek: h.targetPerWeek, weekCount: h.weekCount }));
}

// ─── Validation ──────────────────────────────────────────────────────────────

function cleanName(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw bad('Alışkanlık adı zorunludur.');
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length > HABIT_LIMITS.nameMax) throw bad(`Ad en fazla ${HABIT_LIMITS.nameMax} karakter olabilir.`);
  return s;
}

function cleanIcon(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) return '✅';
  const s = v.trim();
  if ([...s].length > 4) throw bad('Simge tek bir emoji olmalı.');
  return s;
}

function cleanColor(v: unknown): string {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('Renk #rrggbb biçiminde olmalı.');
  return v.toLowerCase();
}

function cleanTarget(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 7) throw bad('Haftalık hedef 1 ile 7 arasında olmalı.');
  return n;
}

function cleanDays(v: unknown): number | null {
  if (v === null) return null;
  if (!Array.isArray(v)) throw bad('daysOfWeek bir dizi olmalı (0=Pzt ... 6=Paz).');
  let mask = 0;
  for (const x of v) {
    if (!Number.isInteger(x) || x < 0 || x > 6) throw bad('daysOfWeek değerleri 0-6 arasında olmalı.');
    mask |= 1 << x;
  }
  return mask === 0 ? null : mask === 127 ? null : mask;
}

const popcount = (m: number) => [0, 1, 2, 3, 4, 5, 6].filter((i) => (m & (1 << i)) !== 0).length;

export function createHabit(db: Db, userId: string, body: Record<string, unknown>): HabitAPI {
  ensureHabitsSchema(db);
  const name = cleanName(body.name);
  const icon = cleanIcon(body.icon);
  const color = body.color === undefined ? '#6366f1' : cleanColor(body.color);
  let mask = body.daysOfWeek === undefined ? null : cleanDays(body.daysOfWeek);
  let target = body.targetPerWeek === undefined ? 7 : cleanTarget(body.targetPerWeek);
  if (mask != null) target = popcount(mask);
  const id = generateId();
  db.transaction(() => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM habits WHERE user_id = ? AND archived = 0').get(userId) as { n: number }).n;
    if (n >= HABIT_LIMITS.maxActive) throw bad(`En fazla ${HABIT_LIMITS.maxActive} aktif alışkanlık olabilir.`);
    const maxSort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM habits WHERE user_id = ?').get(userId) as { m: number }).m;
    db.prepare('INSERT INTO habits (id, user_id, name, icon, color, target_per_week, days_mask, sort_order, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .run(id, userId, name, icon, color, target, mask, maxSort + 1, new Date().toISOString());
  })();
  return getHabit(db, userId, id)!;
}

export function updateHabit(db: Db, userId: string, id: string, body: Record<string, unknown>): HabitAPI | null {
  ensureHabitsSchema(db);
  const row = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(id, userId) as HabitRow | undefined;
  if (!row) return null;
  const name = body.name === undefined ? row.name : cleanName(body.name);
  const icon = body.icon === undefined ? row.icon : cleanIcon(body.icon);
  const color = body.color === undefined ? row.color : cleanColor(body.color);
  let mask = body.daysOfWeek === undefined ? row.days_mask : cleanDays(body.daysOfWeek);
  let target = body.targetPerWeek === undefined ? row.target_per_week : cleanTarget(body.targetPerWeek);
  if (mask != null) target = popcount(mask);
  let archived = row.archived;
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') throw bad('archived true/false olmalı.');
    archived = body.archived ? 1 : 0;
  }
  db.prepare('UPDATE habits SET name = ?, icon = ?, color = ?, target_per_week = ?, days_mask = ?, archived = ? WHERE id = ? AND user_id = ?')
    .run(name, icon, color, target, mask, archived, id, userId);
  return getHabit(db, userId, id);
}

export function deleteHabit(db: Db, userId: string, id: string): boolean {
  ensureHabitsSchema(db);
  return db.transaction(() => {
    const own = db.prepare('SELECT 1 FROM habits WHERE id = ? AND user_id = ?').get(id, userId);
    if (!own) return false;
    db.prepare('DELETE FROM habit_checks WHERE habit_id = ?').run(id);
    db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').run(id, userId);
    return true;
  })();
}

export function checkHabit(db: Db, userId: string, id: string, body: Record<string, unknown>, todayRaw: unknown): { habit: HabitAPI; streak: number } | null {
  ensureHabitsSchema(db);
  if (typeof body.done !== 'boolean') throw bad('done true/false olmalı.');
  const today = resolveToday(todayRaw ?? body.today);
  let date = today;
  if (body.date !== undefined && body.date !== null && body.date !== '') {
    if (!isValidDate(body.date)) throw bad('date YYYY-AA-GG biçiminde olmalı.');
    date = body.date;
  }
  if (date > addDays(today, 1)) throw bad('Gelecek bir güne işaret konamaz.');
  if (date < addDays(today, -HABIT_LIMITS.maxHistoryDays)) throw bad('Bu tarih çok eski.');
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') throw bad('note metin olmalı.');
    note = body.note.trim().slice(0, HABIT_LIMITS.noteMax) || null;
  }
  const own = db.prepare('SELECT 1 FROM habits WHERE id = ? AND user_id = ?').get(id, userId);
  if (!own) return null;
  if (body.done) {
    db.prepare(
      `INSERT INTO habit_checks (habit_id, user_id, date, done, note) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET done = 1, note = COALESCE(excluded.note, habit_checks.note)`,
    ).run(id, userId, date, note);
  } else {
    db.prepare('DELETE FROM habit_checks WHERE habit_id = ? AND date = ? AND user_id = ?').run(id, date, userId);
  }
  const habit = getHabit(db, userId, id, today)!;
  return { habit, streak: habit.streak };
}

export interface HabitHistory {
  days: Array<{ date: string; done: boolean; scheduled: boolean }>;
  streak: number;
  bestStreak: number;
  streakUnit: 'day' | 'week';
  completionRate30: number;
  total: number;
}

export function getHistory(db: Db, userId: string, id: string, daysRaw: unknown, todayRaw: unknown): HabitHistory | null {
  ensureHabitsSchema(db);
  const row = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(id, userId) as HabitRow | undefined;
  if (!row) return null;
  const today = resolveToday(todayRaw);
  let n = daysRaw === undefined || daysRaw === '' ? 120 : Number(daysRaw);
  if (!Number.isFinite(n) || n < 1) throw bad('days pozitif bir sayı olmalı.');
  n = Math.min(HABIT_LIMITS.maxHistoryDays, Math.floor(n));
  const done = loadDone(db, [row.id]).get(row.id)!;
  const sched: ScheduleInfo = { targetPerWeek: row.target_per_week, daysMask: row.days_mask };
  const days: HabitHistory['days'] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push({ date: d, done: done.has(d), scheduled: isScheduled(sched, d) });
  }
  const s = computeStreaks(sched, done, today);
  const last30 = days.slice(-30);
  let rate: number;
  if (modeOf(sched) === 'daily') {
    const scheduled = last30.filter((d) => d.scheduled).length;
    const hit = last30.filter((d) => d.scheduled && d.done).length;
    rate = scheduled ? hit / scheduled : 0;
  } else {
    const hit = last30.filter((d) => d.done).length;
    rate = Math.min(1, hit / Math.max(1, (row.target_per_week * 30) / 7));
  }
  return { days, streak: s.streak, bestStreak: s.best, streakUnit: s.unit, completionRate30: Math.round(rate * 1000) / 1000, total: done.size };
}
