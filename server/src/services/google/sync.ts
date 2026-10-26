/**
 * One-way sync: Google Classroom coursework -> local tasks ('Okul' project).
 * Never deletes tasks. Updates only fields the user has not edited locally
 * (a field is updated only while it still equals the last synced value).
 */
import crypto from 'node:crypto';
import type { Db } from '../../db/connection';
import * as tasksDb from '../../db/tasks';
import * as linksDb from '../../db/links';
import { googleGet } from './oauth';
import { GoogleError } from './http';
import * as store from './store';

const CLASSROOM = 'https://classroom.googleapis.com/v1';
const MAX_PAGES = 10;
const MAX_COURSEWORK_PAGES = 4;
/** New tasks are not created for work that was due longer ago than this. */
const OLD_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
const KIND = 'classroom';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Classroom dueDate/dueTime are UTC. Returns the local date/time
 * (server time zone). Proto3 JSON omits zero fields, so {} means 00:00.
 */
export function classroomDueToLocal(
  dueDate: { year?: number; month?: number; day?: number } | undefined,
  dueTime: { hours?: number; minutes?: number } | undefined,
): { date: string; time: string | null; at: Date } | null {
  if (!dueDate || !dueDate.year || !dueDate.month || !dueDate.day) return null;
  if (!dueTime) {
    // Date-only due date: keep the calendar day as given.
    const date = `${dueDate.year}-${pad(dueDate.month)}-${pad(dueDate.day)}`;
    return { date, time: null, at: new Date(dueDate.year, dueDate.month - 1, dueDate.day, 23, 59) };
  }
  const at = new Date(Date.UTC(dueDate.year, dueDate.month - 1, dueDate.day, dueTime.hours ?? 0, dueTime.minutes ?? 0));
  return { date: tasksDb.localDate(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}`, at };
}

/** App convention: 1 = most urgent, 4 = lowest. */
export function priorityFor(at: Date | null, now = Date.now()): number {
  if (!at) return 4;
  return at.getTime() - now <= 48 * 60 * 60 * 1000 ? 2 : 3;
}

const DONE_STATES = new Set(['TURNED_IN', 'RETURNED']);

export interface SyncSummary {
  courses: number;
  assignments: number;
  created: number;
  updated: number;
  completed: number;
  reopened: number;
  skipped: number;
  errors: string[];
  startedAt: string;
  finishedAt?: string;
}

async function listAll(db: Db, userId: string, baseUrl: string, key: string, what: string, maxPages = MAX_PAGES): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const url = pageToken ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
    const data = await googleGet(db, userId, url, what);
    if (Array.isArray(data?.[key])) out.push(...data[key]);
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

function findOrCreateOkulProject(db: Db, userId: string): string {
  tasksDb.seedDefaultsIfNeeded(db, userId);
  const { projects } = tasksDb.listProjects(db, userId);
  const okul = projects.find((p) => tasksDb.foldText(p.name) === 'okul' && !p.archived) ?? projects.find((p) => tasksDb.foldText(p.name) === 'okul');
  if (okul) return okul.id;
  return tasksDb.createProject(db, userId, { name: 'Okul', color: '#3b82f6', icon: '🎓' }).id;
}

function findOrCreateLabel(db: Db, userId: string, name: string, color: string): string {
  const existing = tasksDb.listLabels(db, userId).find((l) => tasksDb.foldText(l.name) === tasksDb.foldText(name));
  if (existing) return existing.id;
  return tasksDb.createLabel(db, userId, { name, color }).id;
}

function buildNotes(description: string | undefined, link: string | undefined): string {
  const parts: string[] = [];
  if (description && description.trim()) parts.push(description.trim());
  if (link) parts.push(`Google Classroom: ${link}`);
  return parts.join('\n\n').slice(0, 50000);
}

function addUrlLink(db: Db, userId: string, taskId: string, url: string | undefined, label: string): void {
  if (!url) return;
  try {
    linksDb.createLink(db, userId, { fromType: 'task', fromId: taskId, toType: 'url', toId: url, label });
  } catch { /* invalid URL etc.: links are optional */ }
}

const hash = (v: unknown) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');

const running = new Map<string, Promise<SyncSummary>>();

/** Runs a Classroom sync (deduplicated per user while one is in flight). Never throws. */
export function syncClassroom(db: Db, userId: string): Promise<SyncSummary> {
  const inflight = running.get(userId);
  if (inflight) return inflight;
  const p = doSync(db, userId).finally(() => running.delete(userId));
  running.set(userId, p);
  return p;
}

async function doSync(db: Db, userId: string): Promise<SyncSummary> {
  const summary: SyncSummary = {
    courses: 0, assignments: 0, created: 0, updated: 0, completed: 0, reopened: 0, skipped: 0, errors: [],
    startedAt: new Date().toISOString(),
  };
  let fatal: string | null = null;
  try {
    const auth = store.getAuthRow(db, userId);
    const includeUndated = auth ? !!auth.include_undated : true;
    const courses = await listAll(db, userId, `${CLASSROOM}/courses?courseStates=ACTIVE&studentId=me&pageSize=100`, 'courses', 'Classroom kursları');
    summary.courses = courses.length;
    let projectId: string | null = null;
    let labelId: string | null = null;
    const now = Date.now();

    for (const course of courses) {
      const courseName: string = course.name || 'Kurs';
      let works: any[];
      let subs: any[];
      try {
        works = await listAll(
          db, userId,
          `${CLASSROOM}/courses/${encodeURIComponent(course.id)}/courseWork?orderBy=${encodeURIComponent('dueDate desc')}&pageSize=50`,
          'courseWork', `"${courseName}" ödevleri`, MAX_COURSEWORK_PAGES,
        );
        subs = await listAll(
          db, userId,
          `${CLASSROOM}/courses/${encodeURIComponent(course.id)}/courseWork/-/studentSubmissions?userId=me&pageSize=100`,
          'studentSubmissions', `"${courseName}" teslimleri`,
        );
      } catch (err) {
        if (err instanceof GoogleError && (err.status === 403 || err.status === 404)) {
          summary.errors.push(err.message);
          continue; // no permission for this course: skip it
        }
        throw err;
      }
      const stateByWork = new Map<string, string>();
      for (const s of subs) if (s?.courseWorkId) stateByWork.set(s.courseWorkId, s.state || 'NEW');

      for (const w of works) {
        if (!w?.id || (w.state && w.state !== 'PUBLISHED')) continue;
        summary.assignments++;
        const subState = stateByWork.get(w.id) ?? null;
        const isDone = subState !== null && DONE_STATES.has(subState);
        const due = classroomDueToLocal(w.dueDate, w.dueTime);
        const title = `[${courseName}] ${String(w.title || 'Ödev').trim()}`.slice(0, 500);
        const notes = buildNotes(w.description, w.alternateLink);
        const priority = priorityFor(due?.at ?? null, now);
        const externalId = `${course.id}:${w.id}`;
        const etag = hash([title, notes, due?.date, due?.time, subState, priority]);
        const map = store.getMap(db, userId, KIND, externalId);

        if (!map) {
          // Create only open work: dated (not too old), or undated plain assignments.
          if (isDone) { summary.skipped++; continue; }
          if (due) {
            if (due.at.getTime() < now - OLD_CUTOFF_MS) { summary.skipped++; continue; }
          } else if (!includeUndated || w.workType !== 'ASSIGNMENT') { summary.skipped++; continue; }
          projectId ??= findOrCreateOkulProject(db, userId);
          labelId ??= findOrCreateLabel(db, userId, 'classroom', '#10b981');
          const task = tasksDb.createTask(db, userId, {
            title, notes, projectId, priority, dueDate: due?.date ?? null, dueTime: due?.time ?? null, labelIds: [labelId],
          });
          addUrlLink(db, userId, task.id, w.alternateLink, 'Google Classroom');
          store.upsertMap(db, {
            user_id: userId, kind: KIND, external_id: externalId, task_id: task.id, etag,
            synced_title: title, synced_notes: notes, synced_due_date: due?.date ?? null, synced_due_time: due?.time ?? null,
            synced_priority: priority, synced_state: subState,
          });
          summary.created++;
          continue;
        }

        if (map.etag === etag) continue; // nothing changed upstream
        const task = tasksDb.getTask(db, userId, map.task_id);
        if (!task) {
          // The user deleted the task: never recreate it, just remember the new state.
          store.upsertMap(db, { ...map, etag });
          summary.skipped++;
          continue;
        }
        const patch: Record<string, unknown> = {};
        if (task.title === map.synced_title && title !== map.synced_title) patch.title = title;
        if (task.notes === (map.synced_notes ?? '') && notes !== map.synced_notes) patch.notes = notes;
        const newDate = due?.date ?? null;
        const newTime = due?.time ?? null;
        if (task.dueDate === map.synced_due_date && task.dueTime === map.synced_due_time
            && (newDate !== map.synced_due_date || newTime !== map.synced_due_time)) {
          patch.dueDate = newDate;
          patch.dueTime = newTime;
        }
        if (task.priority === map.synced_priority && priority !== map.synced_priority) patch.priority = priority;

        const wasDone = map.synced_state !== null && DONE_STATES.has(map.synced_state);
        let completed = false;
        let reopened = false;
        if (isDone && !wasDone && task.status === 'open') { patch.status = 'done'; completed = true; }
        // Reclaimed upstream after we closed it: reopen (only if still closed).
        if (!isDone && wasDone && task.status === 'done') { patch.status = 'open'; reopened = true; }

        if (Object.keys(patch).length) {
          tasksDb.updateTask(db, userId, task.id, patch);
          if (completed) summary.completed++;
          else if (reopened) summary.reopened++;
          else summary.updated++;
        }
        // Remember what upstream says now; fields the user changed keep diverging from it on purpose.
        store.upsertMap(db, {
          ...map, etag,
          synced_title: patch.title !== undefined || task.title === map.synced_title ? title : map.synced_title,
          synced_notes: patch.notes !== undefined || task.notes === (map.synced_notes ?? '') ? notes : map.synced_notes,
          synced_due_date: patch.dueDate !== undefined ? newDate : map.synced_due_date,
          synced_due_time: patch.dueDate !== undefined ? newTime : map.synced_due_time,
          synced_priority: patch.priority !== undefined ? priority : map.synced_priority,
          synced_state: subState,
        });
      }
    }
  } catch (err) {
    fatal = err instanceof GoogleError ? err.message : 'Eşitleme sırasında beklenmeyen bir hata oluştu.';
    if (!(err instanceof GoogleError)) console.error('[Google sync]', err);
    summary.errors.push(fatal);
  }
  summary.finishedAt = new Date().toISOString();
  try {
    store.recordSyncResult(db, userId, summary, fatal ?? (summary.errors.length ? summary.errors[0] : null));
  } catch (err) {
    console.error('[Google sync] could not record result', err);
  }
  return summary;
}
