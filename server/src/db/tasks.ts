/**
 * Life OS task manager: projects, labels, tasks, time entries and stats.
 * All functions are synchronous (better-sqlite3) and owner-scoped by userId.
 * Tables are created in db/connection.ts (LIFE_OS_DDL).
 */
import type { Context } from 'hono';
import type { Db } from './connection';
import { generateId } from '../utils/id';

// ─── Errors & request helpers (shared by the Life OS routes) ────────────────

export class ApiError extends Error {
  status: 400 | 404 | 409;
  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

const bad = (msg: string) => new ApiError(400, msg);

/** Parses a JSON object body; anything else becomes a 400. */
export async function readJson(c: Context<any>): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw bad('Geçersiz JSON gövdesi.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('İstek gövdesi bir JSON nesnesi olmalı.');
  return body as Record<string, unknown>;
}

/** Converts thrown errors into the JSON error response used by these routes. */
export function sendError(c: Context<any>, err: unknown, tag: string) {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  console.error(`[${tag}]`, err);
  return c.json({ error: 'Sunucu hatası, işlem tamamlanamadı.' }, 500);
}

// ─── Text folding for Turkish-aware, case-insensitive search ────────────────

/** Lowercases with Turkish I/İ/ı handling and strips diacritics (ş→s, ğ→g, ü→u ...). */
export function foldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Escapes LIKE wildcards; use together with `ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** LIKE pattern for a "contains" match on tr_fold()-ed columns. */
export function containsPattern(q: string): string {
  return `%${escapeLike(foldText(q))}%`;
}

const fnRegistered = new WeakSet<Db>();

/** Registers the tr_fold() SQL function on this connection (idempotent). */
export function ensureSqlFunctions(db: Db): void {
  if (fnRegistered.has(db)) return;
  db.function('tr_fold', { deterministic: true }, (v: unknown) => foldText(v));
  fnRegistered.add(db);
}

// ─── Date helpers ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD of a Date in the server's local timezone. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtYmd(d);
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Date in (year, month0 + offset) with the day clamped to that month's length. */
function monthWithDay(year: number, month0: number, offset: number, day: number): string {
  const first = new Date(Date.UTC(year, month0 + offset, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  return fmtYmd(new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m)))));
}

// ─── Recurrence (pure) ───────────────────────────────────────────────────────

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekdays' }
  | { kind: 'weekly'; days: number[] }
  | { kind: 'monthly'; day: number | null }
  | { kind: 'yearly' }
  | { kind: 'every'; n: number; unit: 'd' | 'w' | 'm' | 'y' };

/**
 * Parses 'daily' | 'weekdays' | 'weekly' | 'weekly:MO,WE' | 'monthly' |
 * 'monthly:15' | 'yearly' | 'every:3d' | 'every:2w' | 'every:1m' | 'every:1y'.
 * Returns null for anything else.
 */
export function parseRecurrence(input: string): Recurrence | null {
  const r = input.trim().toLowerCase();
  if (r === 'daily') return { kind: 'daily' };
  if (r === 'weekdays') return { kind: 'weekdays' };
  if (r === 'weekly') return { kind: 'weekly', days: [] };
  if (r === 'monthly') return { kind: 'monthly', day: null };
  if (r === 'yearly') return { kind: 'yearly' };
  let m = /^weekly:([a-z]{2}(?:,[a-z]{2})*)$/.exec(r);
  if (m) {
    const days = new Set<number>();
    for (const code of m[1].split(',')) {
      const idx = WEEKDAY_CODES.indexOf(code.toUpperCase());
      if (idx < 0) return null;
      days.add(idx);
    }
    return { kind: 'weekly', days: [...days].sort((a, b) => a - b) };
  }
  m = /^monthly:(\d{1,2})$/.exec(r);
  if (m) {
    const day = Number(m[1]);
    return day >= 1 && day <= 31 ? { kind: 'monthly', day } : null;
  }
  m = /^every:(\d{1,3})([dwmy])$/.exec(r);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 365 ? { kind: 'every', n, unit: m[2] as 'd' | 'w' | 'm' | 'y' } : null;
  }
  return null;
}

/** Canonical string form of a parsed rule (e.g. 'weekly:MO,WE'). */
export function formatRecurrence(rule: Recurrence): string {
  switch (rule.kind) {
    case 'weekly':
      // Monday-first ordering: MO,TU,...,SU
      return rule.days.length
        ? `weekly:${[...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_CODES[d]).join(',')}`
        : 'weekly';
    case 'monthly':
      return rule.day ? `monthly:${rule.day}` : 'monthly';
    case 'every':
      return `every:${rule.n}${rule.unit}`;
    default:
      return rule.kind;
  }
}

/** The first occurrence strictly after `from` (YYYY-MM-DD). */
export function nextOccurrence(rule: Recurrence, from: string): string {
  const d = parseYmd(from);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (rule.kind) {
    case 'daily':
      return addDays(from, 1);
    case 'weekdays': {
      let next = addDays(from, 1);
      while ([0, 6].includes(parseYmd(next).getUTCDay())) next = addDays(next, 1);
      return next;
    }
    case 'weekly': {
      if (!rule.days.length) return addDays(from, 7);
      for (let i = 1; i <= 7; i++) {
        const cand = addDays(from, i);
        if (rule.days.includes(parseYmd(cand).getUTCDay())) return cand;
      }
      return addDays(from, 7);
    }
    case 'monthly': {
      if (rule.day === null) return monthWithDay(y, mo, 1, day);
      const sameMonth = monthWithDay(y, mo, 0, rule.day);
      return sameMonth > from ? sameMonth : monthWithDay(y, mo, 1, rule.day);
    }
    case 'yearly':
      return monthWithDay(y, mo, 12, day);
    case 'every':
      if (rule.unit === 'd') return addDays(from, rule.n);
      if (rule.unit === 'w') return addDays(from, rule.n * 7);
      return monthWithDay(y, mo, rule.unit === 'm' ? rule.n : rule.n * 12, day);
  }
}

/**
 * Next due date when completing a recurring task due on `due`: advances by the
 * rule until the date is after `today`, so overdue habits land in the future.
 */
export function nextDueAfter(rule: Recurrence, due: string, today: string): string {
  let next = nextOccurrence(rule, due);
  for (let i = 0; next <= today && i < 5000; i++) next = nextOccurrence(rule, next);
  return next;
}

// ─── Small validators ────────────────────────────────────────────────────────

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function reqString(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${field} zorunludur.`);
  const s = v.trim();
  if (s.length > max) throw bad(`${field} en fazla ${max} karakter olabilir.`);
  return s;
}

function optColor(v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string' || !HEX_COLOR.test(v)) throw bad('Renk #RRGGBB biçiminde olmalı.');
  return v;
}

function optBool(v: unknown, field: string): number {
  if (v === true || v === 1 || v === '1') return 1;
  if (v === false || v === 0 || v === '0') return 0;
  throw bad(`${field} true/false olmalı.`);
}

function optNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${field} sayı olmalı.`);
  return v;
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

const nowIso = () => new Date().toISOString();

// ─── Projects ────────────────────────────────────────────────────────────────

export interface ProjectAPI {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  isInbox: boolean;
  archived: boolean;
  sortOrder: number;
  createdAt: string;
  openTaskCount: number;
}

function projectToApi(r: any): ProjectAPI {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    icon: r.icon ?? null,
    isInbox: !!r.is_inbox,
    archived: !!r.archived,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    openTaskCount: r.open_task_count ?? 0,
  };
}

const DEFAULT_PROJECTS = [
  { name: 'Gelen Kutusu', color: '#808080', icon: '📥', inbox: 1 },
  { name: 'Okul', color: '#3b82f6', icon: '🎓', inbox: 0 },
  { name: 'Trade', color: '#22c55e', icon: '📈', inbox: 0 },
  { name: 'Kişisel', color: '#a855f7', icon: '🏠', inbox: 0 },
];
const DEFAULT_LABELS = [
  { name: 'acil', color: '#ef4444' },
  { name: 'okuma', color: '#3b82f6' },
  { name: 'analiz', color: '#f59e0b' },
];
const SEED_FLAG = 'tasks_seeded';

/**
 * Creates the default projects/labels once per user: only when the user has
 * no projects and has never been seeded (so deleting everything later does
 * not bring the defaults back).
 */
export function seedDefaultsIfNeeded(db: Db, userId: string): boolean {
  const flagged = db.prepare('SELECT 1 FROM user_flags WHERE user_id = ? AND key = ?').get(userId, SEED_FLAG);
  if (flagged) return false;
  let seeded = false;
  db.transaction(() => {
    const count = (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(userId) as { n: number }).n;
    if (count === 0) {
      const now = nowIso();
      const insP = db.prepare(
        `INSERT INTO projects (id, user_id, name, color, icon, is_inbox, archived, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      );
      DEFAULT_PROJECTS.forEach((p, i) => insP.run(generateId(), userId, p.name, p.color, p.icon, p.inbox, i + 1, now));
      const insL = db.prepare('INSERT OR IGNORE INTO labels (id, user_id, name, color) VALUES (?, ?, ?, ?)');
      for (const l of DEFAULT_LABELS) insL.run(generateId(), userId, l.name, l.color);
      seeded = true;
    }
    db.prepare('INSERT OR REPLACE INTO user_flags (user_id, key, value) VALUES (?, ?, ?)').run(userId, SEED_FLAG, nowIso());
  })();
  return seeded;
}

const PROJECT_SELECT = `
  SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'open') AS open_task_count
  FROM projects p`;

export function listProjects(db: Db, userId: string): { projects: ProjectAPI[]; noProjectOpenCount: number } {
  const rows = db.prepare(`${PROJECT_SELECT} WHERE p.user_id = ? ORDER BY p.archived, p.is_inbox DESC, p.sort_order, p.created_at`).all(userId);
  const none = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND project_id IS NULL AND status = 'open'")
    .get(userId) as { n: number };
  return { projects: rows.map(projectToApi), noProjectOpenCount: none.n };
}

export function getProject(db: Db, userId: string, id: string): ProjectAPI | null {
  const r = db.prepare(`${PROJECT_SELECT} WHERE p.user_id = ? AND p.id = ?`).get(userId, id);
  return r ? projectToApi(r) : null;
}

export function createProject(db: Db, userId: string, body: Record<string, unknown>): ProjectAPI {
  const name = reqString(body.name, 'Proje adı', 100);
  const color = optColor(body.color, '#808080');
  const icon = isNullish(body.icon) ? null : reqString(body.icon, 'İkon', 16);
  const archived = body.archived === undefined ? 0 : optBool(body.archived, 'archived');
  let sortOrder: number;
  if (body.sortOrder !== undefined) sortOrder = optNumber(body.sortOrder, 'sortOrder');
  else {
    sortOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM projects WHERE user_id = ?').get(userId) as { n: number }).n;
  }
  const id = generateId();
  db.prepare(
    `INSERT INTO projects (id, user_id, name, color, icon, is_inbox, archived, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, userId, name, color, icon, archived, sortOrder, nowIso());
  // Mark as seeded: the user clearly manages projects already.
  db.prepare('INSERT OR IGNORE INTO user_flags (user_id, key, value) VALUES (?, ?, ?)').run(userId, SEED_FLAG, nowIso());
  return getProject(db, userId, id)!;
}

export function updateProject(db: Db, userId: string, id: string, body: Record<string, unknown>): ProjectAPI | null {
  if (!getProject(db, userId, id)) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(reqString(body.name, 'Proje adı', 100)); }
  if (body.color !== undefined) { sets.push('color = ?'); vals.push(optColor(body.color, '#808080')); }
  if (body.icon !== undefined) { sets.push('icon = ?'); vals.push(isNullish(body.icon) ? null : reqString(body.icon, 'İkon', 16)); }
  if (body.archived !== undefined) { sets.push('archived = ?'); vals.push(optBool(body.archived, 'archived')); }
  if (body.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(optNumber(body.sortOrder, 'sortOrder')); }
  if (sets.length) db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
  return getProject(db, userId, id);
}

/** Deletes a project; its tasks become project-less. */
export function deleteProject(db: Db, userId: string, id: string): boolean {
  let ok = false;
  db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
    if (!exists) return;
    db.prepare('UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ? AND user_id = ?').run(nowIso(), id, userId);
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
    ok = true;
  })();
  return ok;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export interface LabelAPI {
  id: string;
  name: string;
  color: string;
  openTaskCount: number;
}

function labelToApi(r: any): LabelAPI {
  return { id: r.id, name: r.name, color: r.color, openTaskCount: r.open_task_count ?? 0 };
}

const LABEL_SELECT = `
  SELECT l.*, (SELECT COUNT(*) FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
               WHERE tl.label_id = l.id AND t.status = 'open') AS open_task_count
  FROM labels l`;

export function listLabels(db: Db, userId: string): LabelAPI[] {
  return db.prepare(`${LABEL_SELECT} WHERE l.user_id = ? ORDER BY l.name`).all(userId).map(labelToApi);
}

function getLabel(db: Db, userId: string, id: string): LabelAPI | null {
  const r = db.prepare(`${LABEL_SELECT} WHERE l.user_id = ? AND l.id = ?`).get(userId, id);
  return r ? labelToApi(r) : null;
}

function assertLabelNameFree(db: Db, userId: string, name: string, exceptId?: string): void {
  const folded = foldText(name);
  const rows = db.prepare('SELECT id, name FROM labels WHERE user_id = ?').all(userId) as Array<{ id: string; name: string }>;
  if (rows.some((r) => r.id !== exceptId && foldText(r.name) === folded)) {
    throw new ApiError(409, 'Bu isimde bir etiket zaten var.');
  }
}

export function createLabel(db: Db, userId: string, body: Record<string, unknown>): LabelAPI {
  const name = reqString(body.name, 'Etiket adı', 50);
  const color = optColor(body.color, '#808080');
  assertLabelNameFree(db, userId, name);
  const id = generateId();
  db.prepare('INSERT INTO labels (id, user_id, name, color) VALUES (?, ?, ?, ?)').run(id, userId, name, color);
  return getLabel(db, userId, id)!;
}

export function updateLabel(db: Db, userId: string, id: string, body: Record<string, unknown>): LabelAPI | null {
  if (!getLabel(db, userId, id)) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) {
    const name = reqString(body.name, 'Etiket adı', 50);
    assertLabelNameFree(db, userId, name, id);
    sets.push('name = ?');
    vals.push(name);
  }
  if (body.color !== undefined) { sets.push('color = ?'); vals.push(optColor(body.color, '#808080')); }
  if (sets.length) db.prepare(`UPDATE labels SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
  return getLabel(db, userId, id);
}

export function deleteLabel(db: Db, userId: string, id: string): boolean {
  let ok = false;
  db.transaction(() => {
    db.prepare('DELETE FROM task_labels WHERE label_id IN (SELECT id FROM labels WHERE id = ? AND user_id = ?)').run(id, userId);
    ok = db.prepare('DELETE FROM labels WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  })();
  return ok;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface TaskAPI {
  id: string;
  title: string;
  notes: string;
  projectId: string | null;
  parentId: string | null;
  status: 'open' | 'done';
  priority: number;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: string | null;
  estimateMin: number | null;
  spentSeconds: number;
  runningSince: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  labels: Array<{ id: string; name: string; color: string }>;
  subtaskCount: number;
  subtaskDoneCount: number;
  linkCount: number;
}

const TASK_SELECT = `
  SELECT t.*,
    (SELECT COALESCE(SUM(e.seconds), 0) FROM time_entries e WHERE e.task_id = t.id AND e.ended_at IS NOT NULL) AS spent_seconds,
    (SELECT e.started_at FROM time_entries e WHERE e.task_id = t.id AND e.ended_at IS NULL ORDER BY e.started_at DESC LIMIT 1) AS running_since,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS subtask_count,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS subtask_done_count,
    (SELECT COUNT(*) FROM links k WHERE k.user_id = t.user_id
       AND ((k.from_type = 'task' AND k.from_id = t.id) OR (k.to_type = 'task' AND k.to_id = t.id))) AS link_count
  FROM tasks t`;

function rowsToTasks(db: Db, rows: any[]): TaskAPI[] {
  const byTask = new Map<string, Array<{ id: string; name: string; color: string }>>();
  if (rows.length) {
    const labelRows = db
      .prepare(
        `SELECT tl.task_id, l.id, l.name, l.color FROM task_labels tl JOIN labels l ON l.id = tl.label_id
         WHERE tl.task_id IN (SELECT value FROM json_each(?)) ORDER BY l.name`,
      )
      .all(JSON.stringify(rows.map((r) => r.id))) as Array<{ task_id: string; id: string; name: string; color: string }>;
    for (const lr of labelRows) {
      const list = byTask.get(lr.task_id) ?? [];
      list.push({ id: lr.id, name: lr.name, color: lr.color });
      byTask.set(lr.task_id, list);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes ?? '',
    projectId: r.project_id ?? null,
    parentId: r.parent_id ?? null,
    status: r.status,
    priority: r.priority,
    dueDate: r.due_date ?? null,
    dueTime: r.due_time ?? null,
    recurrence: r.recurrence ?? null,
    estimateMin: r.estimate_min ?? null,
    spentSeconds: r.spent_seconds ?? 0,
    runningSince: r.running_since ?? null,
    completedAt: r.completed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sortOrder: r.sort_order,
    labels: byTask.get(r.id) ?? [],
    subtaskCount: r.subtask_count ?? 0,
    subtaskDoneCount: r.subtask_done_count ?? 0,
    linkCount: r.link_count ?? 0,
  }));
}

export function getTask(db: Db, userId: string, id: string): TaskAPI | null {
  const r = db.prepare(`${TASK_SELECT} WHERE t.user_id = ? AND t.id = ?`).get(userId, id);
  return r ? rowsToTasks(db, [r])[0] : null;
}

export function getSubtasks(db: Db, userId: string, parentId: string): TaskAPI[] {
  const rows = db
    .prepare(`${TASK_SELECT} WHERE t.user_id = ? AND t.parent_id = ? ORDER BY t.status = 'done', t.sort_order, t.created_at`)
    .all(userId, parentId);
  return rowsToTasks(db, rows);
}

export interface TaskListQuery {
  projectId?: string;
  status?: string;
  due?: string;
  label?: string;
  q?: string;
  parentId?: string;
  sort?: string;
  limit?: string;
  offset?: string;
  today?: string;
}

const DUE_FILTERS = ['today', 'overdue', 'upcoming', 'week', 'none', 'all', 'today_overdue'];
const SORTS = ['manual', 'due', 'priority', 'created', 'updated', 'completed'];

/** Resolves "today": a valid ?today=YYYY-MM-DD from the client wins over server local date. */
export function resolveToday(today?: string): string {
  if (today !== undefined && today !== '') {
    if (!isValidDate(today)) throw bad('today parametresi YYYY-AA-GG biçiminde olmalı.');
    return today;
  }
  return localDate(new Date());
}

export function listTasks(db: Db, userId: string, query: TaskListQuery): { tasks: TaskAPI[]; total: number } {
  ensureSqlFunctions(db);
  const today = resolveToday(query.today);
  const where: string[] = ['t.user_id = @userId'];
  const params: Record<string, unknown> = { userId, today };

  const status = (query.status || 'open').toLowerCase();
  if (!['open', 'done', 'all'].includes(status)) throw bad('status open, done veya all olmalı.');
  if (status !== 'all') { where.push('t.status = @status'); params.status = status; }

  if (query.projectId) {
    if (query.projectId === 'none') where.push('t.project_id IS NULL');
    else { where.push('t.project_id = @projectId'); params.projectId = query.projectId; }
  }

  // Default: top-level tasks only, unless searching.
  const parentId = query.parentId ?? (query.q ? 'all' : 'root');
  if (parentId === 'root' || parentId === 'none') where.push('t.parent_id IS NULL');
  else if (parentId !== 'all') { where.push('t.parent_id = @parentId'); params.parentId = parentId; }

  const due = (query.due || 'all').toLowerCase();
  if (!DUE_FILTERS.includes(due)) throw bad('due today, overdue, upcoming, week, none veya all olmalı.');
  if (due === 'today') where.push('t.due_date = @today');
  else if (due === 'overdue') where.push('t.due_date < @today');
  else if (due === 'today_overdue') where.push('t.due_date <= @today');
  else if (due === 'upcoming') where.push('t.due_date > @today');
  else if (due === 'week') { where.push('t.due_date >= @today AND t.due_date <= @weekEnd'); params.weekEnd = addDays(today, 6); }
  else if (due === 'none') where.push('t.due_date IS NULL');

  if (query.label) {
    where.push(`EXISTS (SELECT 1 FROM task_labels tl JOIN labels l ON l.id = tl.label_id
                 WHERE tl.task_id = t.id AND (l.id = @label OR tr_fold(l.name) = @labelFolded))`);
    params.label = query.label;
    params.labelFolded = foldText(query.label);
  }

  if (query.q && query.q.trim()) {
    where.push("(tr_fold(t.title) LIKE @q ESCAPE '\\' OR tr_fold(t.notes) LIKE @q ESCAPE '\\')");
    params.q = containsPattern(query.q.trim());
  }

  const defaultSort = status === 'done' ? 'completed' : ['today', 'overdue', 'upcoming', 'week', 'today_overdue'].includes(due) ? 'due' : 'manual';
  const sort = (query.sort || defaultSort).toLowerCase();
  if (!SORTS.includes(sort)) throw bad('sort manual, due, priority, created, updated veya completed olmalı.');
  const orderBy: Record<string, string> = {
    manual: "t.status = 'done', t.sort_order, t.created_at",
    due: "t.status = 'done', t.due_date IS NULL, t.due_date, t.due_time IS NULL, t.due_time, t.priority, t.sort_order",
    priority: "t.status = 'done', t.priority, t.due_date IS NULL, t.due_date, t.sort_order",
    created: 't.created_at DESC',
    updated: 't.updated_at DESC',
    completed: 't.completed_at DESC, t.updated_at DESC',
  };

  const limitN = query.limit === undefined || query.limit === '' ? 200 : Number(query.limit);
  const offsetN = query.offset === undefined || query.offset === '' ? 0 : Number(query.offset);
  if (!Number.isInteger(limitN) || limitN < 1 || limitN > 1000) throw bad('limit 1 ile 1000 arasında bir tam sayı olmalı.');
  if (!Number.isInteger(offsetN) || offsetN < 0) throw bad('offset 0 veya pozitif bir tam sayı olmalı.');

  const whereSql = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM tasks t WHERE ${whereSql}`).get(params) as { n: number }).n;
  const rows = db
    .prepare(`${TASK_SELECT} WHERE ${whereSql} ORDER BY ${orderBy[sort]} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: limitN, offset: offsetN });
  return { tasks: rowsToTasks(db, rows), total };
}

interface TaskColumns {
  title?: string;
  notes?: string;
  project_id?: string | null;
  parent_id?: string | null;
  status?: 'open' | 'done';
  priority?: number;
  due_date?: string | null;
  due_time?: string | null;
  recurrence?: string | null;
  estimate_min?: number | null;
  sort_order?: number;
}

/** Validates a create/patch body into DB columns. `existingId` enables cycle checks. */
function parseTaskBody(
  db: Db,
  userId: string,
  body: Record<string, unknown>,
  existingId?: string,
  existingDueDate: string | null = null,
): { cols: TaskColumns; labelIds?: string[] } {
  const cols: TaskColumns = {};
  if (body.title !== undefined || !existingId) cols.title = reqString(body.title, 'Görev başlığı', 500);
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') throw bad('Notlar metin olmalı.');
    const notes = (body.notes as string | null) ?? '';
    if (notes.length > 50000) throw bad('Notlar en fazla 50000 karakter olabilir.');
    cols.notes = notes;
  }
  if (body.projectId !== undefined) {
    if (isNullish(body.projectId)) cols.project_id = null;
    else {
      if (typeof body.projectId !== 'string') throw bad('projectId metin olmalı.');
      if (!db.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(body.projectId, userId)) throw bad('Proje bulunamadı.');
      cols.project_id = body.projectId;
    }
  }
  if (body.parentId !== undefined) {
    if (isNullish(body.parentId)) cols.parent_id = null;
    else {
      if (typeof body.parentId !== 'string') throw bad('parentId metin olmalı.');
      if (body.parentId === existingId) throw bad('Bir görev kendi alt görevi olamaz.');
      const parent = db.prepare('SELECT id, parent_id, project_id FROM tasks WHERE id = ? AND user_id = ?').get(body.parentId, userId) as
        | { id: string; parent_id: string | null; project_id: string | null }
        | undefined;
      if (!parent) throw bad('Üst görev bulunamadı.');
      if (existingId) {
        // Walk up the chain from the new parent; meeting this task means a cycle.
        let cur: string | null = parent.parent_id;
        for (let i = 0; cur && i < 1000; i++) {
          if (cur === existingId) throw bad('Bu işlem görev hiyerarşisinde döngü oluşturur.');
          cur = (db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(cur) as { parent_id: string | null } | undefined)?.parent_id ?? null;
        }
      }
      cols.parent_id = parent.id;
      // New subtasks inherit the parent's project unless one was given.
      if (!existingId && body.projectId === undefined) cols.project_id = parent.project_id;
    }
  }
  if (body.status !== undefined) {
    if (body.status !== 'open' && body.status !== 'done') throw bad("status 'open' veya 'done' olmalı.");
    cols.status = body.status;
  }
  if (body.priority !== undefined && body.priority !== null) {
    const p = Number(body.priority);
    if (!Number.isInteger(p) || p < 1 || p > 4) throw bad('Öncelik 1 ile 4 arasında olmalı (1 = en acil).');
    cols.priority = p;
  }
  if (body.dueDate !== undefined) {
    if (isNullish(body.dueDate)) { cols.due_date = null; cols.due_time = null; }
    else if (!isValidDate(body.dueDate)) throw bad('Bitiş tarihi YYYY-AA-GG biçiminde geçerli bir tarih olmalı.');
    else cols.due_date = body.dueDate;
  }
  const effectiveDueDate = cols.due_date === undefined ? existingDueDate : cols.due_date;
  if (body.dueTime !== undefined && !isNullish(body.dueTime) && !effectiveDueDate) {
    throw bad('Saat için bir bitiş tarihi de gerekli.');
  }
  if (body.dueTime !== undefined && effectiveDueDate !== null) {
    if (isNullish(body.dueTime)) cols.due_time = null;
    else if (!isValidTime(body.dueTime)) throw bad('Saat SS:DD biçiminde olmalı (ör. 09:30).');
    else cols.due_time = body.dueTime;
  }
  if (body.recurrence !== undefined) {
    if (isNullish(body.recurrence)) cols.recurrence = null;
    else {
      const rule = typeof body.recurrence === 'string' ? parseRecurrence(body.recurrence) : null;
      if (!rule) throw bad("Geçersiz tekrar kuralı. Örnekler: 'daily', 'weekdays', 'weekly:MO,WE', 'monthly:15', 'every:3d', 'every:2w'.");
      cols.recurrence = formatRecurrence(rule);
    }
  }
  if (body.estimateMin !== undefined) {
    if (isNullish(body.estimateMin)) cols.estimate_min = null;
    else {
      const e = Number(body.estimateMin);
      if (!Number.isInteger(e) || e < 1 || e > 100000) throw bad('Tahmini süre pozitif bir tam sayı (dakika) olmalı.');
      cols.estimate_min = e;
    }
  }
  if (body.sortOrder !== undefined && body.sortOrder !== null) cols.sort_order = optNumber(body.sortOrder, 'sortOrder');

  let labelIds: string[] | undefined;
  if (body.labelIds !== undefined && body.labelIds !== null) {
    if (!Array.isArray(body.labelIds) || body.labelIds.some((x) => typeof x !== 'string')) throw bad('labelIds metin dizisi olmalı.');
    labelIds = [...new Set(body.labelIds as string[])];
    if (labelIds.length) {
      const found = db
        .prepare('SELECT COUNT(*) AS n FROM labels WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))')
        .get(userId, JSON.stringify(labelIds)) as { n: number };
      if (found.n !== labelIds.length) throw bad('Etiketlerden biri bulunamadı.');
    }
  }
  return { cols, labelIds };
}

function setTaskLabels(db: Db, taskId: string, labelIds: string[]): void {
  db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId);
  const ins = db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)');
  for (const lid of labelIds) ins.run(taskId, lid);
}

function nextSortOrder(db: Db, userId: string): number {
  return (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tasks WHERE user_id = ?').get(userId) as { n: number }).n;
}

export function createTask(db: Db, userId: string, body: Record<string, unknown>): TaskAPI {
  const { cols, labelIds } = parseTaskBody(db, userId, body);
  if (cols.due_time && !cols.due_date) throw bad('Saat için bir bitiş tarihi de gerekli.');
  const id = generateId();
  const now = nowIso();
  const status = cols.status ?? 'open';
  db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks (id, user_id, title, notes, project_id, parent_id, status, priority, due_date, due_time,
                          recurrence, estimate_min, completed_at, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, userId, cols.title, cols.notes ?? '', cols.project_id ?? null, cols.parent_id ?? null, status,
      cols.priority ?? 4, cols.due_date ?? null, cols.due_time ?? null, cols.recurrence ?? null,
      cols.estimate_min ?? null, status === 'done' ? now : null, now, now, cols.sort_order ?? nextSortOrder(db, userId),
    );
    if (labelIds) setTaskLabels(db, id, labelIds);
  })();
  return getTask(db, userId, id)!;
}

export function updateTask(db: Db, userId: string, id: string, body: Record<string, unknown>): TaskAPI | null {
  const existing = db.prepare('SELECT status, due_date FROM tasks WHERE id = ? AND user_id = ?').get(id, userId) as
    | { status: string; due_date: string | null }
    | undefined;
  if (!existing) return null;
  const { cols, labelIds } = parseTaskBody(db, userId, body, id, existing.due_date);
  const entries = Object.entries(cols);
  const now = nowIso();
  db.transaction(() => {
    if (cols.status && cols.status !== existing.status) {
      entries.push(['completed_at', cols.status === 'done' ? now : null]);
      if (cols.status === 'done') stopTimersForTask(db, userId, id);
    }
    entries.push(['updated_at', now]);
    db.prepare(`UPDATE tasks SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...entries.map(([, v]) => v), id, userId);
    if (labelIds) setTaskLabels(db, id, labelIds);
  })();
  return getTask(db, userId, id);
}

/** Ids of a task and all of its descendants. */
function taskTreeIds(db: Db, userId: string, id: string): string[] {
  return (
    db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM tasks WHERE id = ? AND user_id = ?
           UNION SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id
         ) SELECT id FROM sub`,
      )
      .all(id, userId) as Array<{ id: string }>
  ).map((r) => r.id);
}

/** Deletes a task with its subtasks, time entries, labels and links. */
export function deleteTask(db: Db, userId: string, id: string): number {
  let deleted = 0;
  db.transaction(() => {
    const ids = taskTreeIds(db, userId, id);
    if (!ids.length) return;
    const json = JSON.stringify(ids);
    db.prepare(
      `DELETE FROM links WHERE user_id = ? AND ((from_type = 'task' AND from_id IN (SELECT value FROM json_each(?)))
                                             OR (to_type = 'task' AND to_id IN (SELECT value FROM json_each(?))))`,
    ).run(userId, json, json);
    db.prepare('DELETE FROM time_entries WHERE task_id IN (SELECT value FROM json_each(?))').run(json);
    db.prepare('DELETE FROM task_labels WHERE task_id IN (SELECT value FROM json_each(?))').run(json);
    // FK cascades may remove children before they are visited, so report the tree size.
    db.prepare('DELETE FROM tasks WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))').run(userId, json);
    deleted = ids.length;
  })();
  return deleted;
}

/**
 * Toggles completion. Completing a recurring task that has a due date keeps
 * the original as done history (recurrence cleared) and creates the next open
 * occurrence (labels and direct subtasks copied, subtask due dates shifted).
 */
export function completeTask(db: Db, userId: string, id: string, today: string): { task: TaskAPI; next?: TaskAPI } | null {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!t) return null;
  if (t.status === 'done') return { task: reopenTask(db, userId, id)! };

  const now = nowIso();
  let nextId: string | null = null;
  db.transaction(() => {
    stopTimersForTask(db, userId, id);
    const rule = t.recurrence && t.due_date ? parseRecurrence(t.recurrence) : null;
    if (rule) {
      const nextDate = nextDueAfter(rule, t.due_date, today);
      const shift = daysBetween(t.due_date, nextDate);
      nextId = generateId();
      const insert = db.prepare(
        `INSERT INTO tasks (id, user_id, title, notes, project_id, parent_id, status, priority, due_date, due_time,
                            recurrence, estimate_min, completed_at, created_at, updated_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      );
      insert.run(nextId, userId, t.title, t.notes, t.project_id, t.parent_id, t.priority, nextDate, t.due_time,
        t.recurrence, t.estimate_min, now, now, t.sort_order);
      db.prepare('INSERT INTO task_labels (task_id, label_id) SELECT ?, label_id FROM task_labels WHERE task_id = ?').run(nextId, id);
      const subs = db.prepare('SELECT * FROM tasks WHERE parent_id = ? AND user_id = ?').all(id, userId) as any[];
      for (const s of subs) {
        const sid = generateId();
        insert.run(sid, userId, s.title, s.notes, s.project_id, nextId, s.priority,
          s.due_date ? addDays(s.due_date, shift) : null, s.due_time, s.recurrence, s.estimate_min, now, now, s.sort_order);
        db.prepare('INSERT INTO task_labels (task_id, label_id) SELECT ?, label_id FROM task_labels WHERE task_id = ?').run(sid, s.id);
      }
      db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?, recurrence = NULL WHERE id = ?").run(now, now, id);
    } else {
      db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    }
  })();
  const task = getTask(db, userId, id)!;
  return nextId ? { task, next: getTask(db, userId, nextId)! } : { task };
}

export function reopenTask(db: Db, userId: string, id: string): TaskAPI | null {
  const r = db
    .prepare("UPDATE tasks SET status = 'open', completed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(nowIso(), id, userId);
  return r.changes ? getTask(db, userId, id) : null;
}

/** Sets sort_order = position for the given ids (unknown ids are ignored). */
export function reorderTasks(db: Db, userId: string, ids: unknown): number {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw bad('ids metin dizisi olmalı.');
  if (ids.length > 5000) throw bad('Tek seferde en fazla 5000 görev sıralanabilir.');
  let updated = 0;
  db.transaction(() => {
    const stmt = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ? AND user_id = ?');
    ids.forEach((id, i) => { updated += stmt.run(i + 1, id, userId).changes; });
  })();
  return updated;
}

// ─── Timer / time entries ────────────────────────────────────────────────────

function closeEntries(db: Db, entries: Array<{ id: string; started_at: string }>): void {
  const now = new Date();
  const stmt = db.prepare('UPDATE time_entries SET ended_at = ?, seconds = ? WHERE id = ?');
  for (const e of entries) {
    const secs = Math.max(0, Math.round((now.getTime() - Date.parse(e.started_at)) / 1000));
    stmt.run(now.toISOString(), Number.isFinite(secs) ? secs : 0, e.id);
  }
}

function stopTimersForTask(db: Db, userId: string, taskId: string): void {
  const running = db
    .prepare('SELECT id, started_at FROM time_entries WHERE user_id = ? AND task_id = ? AND ended_at IS NULL')
    .all(userId, taskId) as Array<{ id: string; started_at: string }>;
  closeEntries(db, running);
}

/** Starts a timer on the task, stopping any other running timer of the user. */
export function startTimer(db: Db, userId: string, taskId: string): TaskAPI | null {
  if (!db.prepare('SELECT 1 FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId)) return null;
  db.transaction(() => {
    const running = db
      .prepare('SELECT id, task_id, started_at FROM time_entries WHERE user_id = ? AND ended_at IS NULL')
      .all(userId) as Array<{ id: string; task_id: string; started_at: string }>;
    const others = running.filter((e) => e.task_id !== taskId);
    closeEntries(db, others);
    if (running.length === others.length) {
      db.prepare('INSERT INTO time_entries (id, user_id, task_id, started_at, ended_at, seconds) VALUES (?, ?, ?, ?, NULL, NULL)')
        .run(generateId(), userId, taskId, nowIso());
    }
  })();
  return getTask(db, userId, taskId);
}

export function stopTimer(db: Db, userId: string, taskId: string): TaskAPI | null {
  if (!db.prepare('SELECT 1 FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId)) return null;
  db.transaction(() => stopTimersForTask(db, userId, taskId))();
  return getTask(db, userId, taskId);
}

export function getRunningTask(db: Db, userId: string): TaskAPI | null {
  const e = db
    .prepare('SELECT task_id FROM time_entries WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .get(userId) as { task_id: string } | undefined;
  return e ? getTask(db, userId, e.task_id) : null;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface TaskStats {
  completedByDay: Array<{ date: string; count: number }>;
  createdByDay: Array<{ date: string; count: number }>;
  openCount: number;
  overdueCount: number;
  dueTodayCount: number;
  completedToday: number;
  streakDays: number;
  byProject: Array<{ projectId: string | null; name: string; color: string; open: number; done: number }>;
  focusSecondsByDay: Array<{ date: string; seconds: number }>;
  avgCompletedPerDay: number;
}

export function getTaskStats(db: Db, userId: string, daysRaw: string | undefined, todayRaw?: string): TaskStats {
  const days = daysRaw === undefined || daysRaw === '' ? 30 : Number(daysRaw);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw bad('days 1 ile 365 arasında bir tam sayı olmalı.');
  const today = resolveToday(todayRaw);
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(addDays(today, -i));
  const first = dates[0];
  // Lower bound for ISO filtering with a one-day margin for timezone offsets.
  const sinceIso = new Date(parseYmd(first).getTime() - 86400000 * 2).toISOString();

  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const bucket = (isoList: string[]) => {
    const m = new Map<string, number>();
    for (const iso of isoList) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      const key = localDate(d);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };

  const completedAll = (db.prepare('SELECT completed_at FROM tasks WHERE user_id = ? AND completed_at IS NOT NULL').all(userId) as Array<{ completed_at: string }>)
    .map((r) => r.completed_at);
  const completedMap = bucket(completedAll);
  const createdMap = bucket(
    (db.prepare('SELECT created_at FROM tasks WHERE user_id = ? AND created_at >= ?').all(userId, sinceIso) as Array<{ created_at: string }>)
      .map((r) => r.created_at),
  );

  let streak = 0;
  let cursor = (completedMap.get(today) ?? 0) > 0 ? today : addDays(today, -1);
  while ((completedMap.get(cursor) ?? 0) > 0) { streak++; cursor = addDays(cursor, -1); }

  // Focus seconds, split across local midnights.
  const focus = new Map<string, number>();
  const entries = db
    .prepare('SELECT started_at, ended_at FROM time_entries WHERE user_id = ? AND (ended_at IS NULL OR ended_at >= ?)')
    .all(userId, sinceIso) as Array<{ started_at: string; ended_at: string | null }>;
  const nowMs = Date.now();
  for (const e of entries) {
    let cur = Date.parse(e.started_at);
    const end = e.ended_at ? Date.parse(e.ended_at) : nowMs;
    if (!Number.isFinite(cur) || !Number.isFinite(end)) continue;
    for (let guard = 0; cur < end && guard < 400; guard++) {
      const c = new Date(cur);
      const nextMidnight = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1).getTime();
      const segEnd = Math.min(end, nextMidnight);
      const key = localDate(c);
      focus.set(key, (focus.get(key) ?? 0) + Math.round((segEnd - cur) / 1000));
      cur = segEnd;
    }
  }

  const byProject = (db
    .prepare(
      `SELECT p.id, p.name, p.color,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'open') AS open,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done
       FROM projects p WHERE p.user_id = ? ORDER BY p.archived, p.is_inbox DESC, p.sort_order`,
    )
    .all(userId) as Array<{ id: string; name: string; color: string; open: number; done: number }>)
    .map((r) => ({ projectId: r.id as string | null, name: r.name, color: r.color, open: r.open, done: r.done }));
  const noProj = db
    .prepare(
      `SELECT SUM(status = 'open') AS open, SUM(status = 'done') AS done FROM tasks WHERE user_id = ? AND project_id IS NULL`,
    )
    .get(userId) as { open: number | null; done: number | null };
  if ((noProj.open ?? 0) + (noProj.done ?? 0) > 0) {
    byProject.push({ projectId: null, name: 'Projesiz', color: '#9ca3af', open: noProj.open ?? 0, done: noProj.done ?? 0 });
  }

  const completedByDay = dates.map((date) => ({ date, count: completedMap.get(date) ?? 0 }));
  const totalInRange = completedByDay.reduce((s, d) => s + d.count, 0);
  return {
    completedByDay,
    createdByDay: dates.map((date) => ({ date, count: createdMap.get(date) ?? 0 })),
    openCount: count("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'open'", userId),
    overdueCount: count("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'open' AND due_date < ?", userId, today),
    dueTodayCount: count("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'open' AND due_date = ?", userId, today),
    completedToday: completedMap.get(today) ?? 0,
    streakDays: streak,
    byProject,
    focusSecondsByDay: dates.map((date) => ({ date, seconds: focus.get(date) ?? 0 })),
    avgCompletedPerDay: Math.round((totalInRange / days) * 100) / 100,
  };
}
