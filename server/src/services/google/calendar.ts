/**
 * Google Calendar (read-only): upcoming events of the primary calendar and
 * "convert to task".
 */
import type { Db } from '../../db/connection';
import * as tasksDb from '../../db/tasks';
import * as linksDb from '../../db/links';
import { ApiError } from '../../db/tasks';
import { googleGet } from './oauth';
import * as store from './store';

const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const KIND = 'calendar';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export interface CalendarEvent {
  id: string;
  title: string;
  allDay: boolean;
  /** Local YYYY-MM-DD of the start. */
  date: string;
  startTime: string | null;
  endTime: string | null;
  endDate: string | null;
  start: string;
  end: string | null;
  location: string | null;
  description: string | null;
  htmlLink: string | null;
  taskId: string | null;
}

function toEvent(e: any): CalendarEvent | null {
  if (!e?.id || e.status === 'cancelled') return null;
  const title = typeof e.summary === 'string' && e.summary.trim() ? e.summary.trim() : '(Başlıksız etkinlik)';
  const base = {
    id: String(e.id),
    title,
    location: typeof e.location === 'string' ? e.location : null,
    description: typeof e.description === 'string' ? e.description : null,
    htmlLink: typeof e.htmlLink === 'string' ? e.htmlLink : null,
    taskId: null,
  };
  if (e.start?.dateTime) {
    const s = new Date(e.start.dateTime);
    if (Number.isNaN(s.getTime())) return null;
    const en = e.end?.dateTime ? new Date(e.end.dateTime) : null;
    const endOk = en && !Number.isNaN(en.getTime()) ? en : null;
    return {
      ...base, allDay: false, date: tasksDb.localDate(s), startTime: hhmm(s),
      endTime: endOk ? hhmm(endOk) : null, endDate: endOk ? tasksDb.localDate(endOk) : null,
      start: s.toISOString(), end: endOk ? endOk.toISOString() : null,
    };
  }
  if (e.start?.date && tasksDb.isValidDate(e.start.date)) {
    // All-day: end.date is exclusive.
    const endDate = e.end?.date && tasksDb.isValidDate(e.end.date) ? tasksDb.addDays(e.end.date, -1) : e.start.date;
    return { ...base, allDay: true, date: e.start.date, startTime: null, endTime: null, endDate, start: e.start.date, end: endDate };
  }
  return null;
}

export async function listUpcomingEvents(db: Db, userId: string, days: number): Promise<CalendarEvent[]> {
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days).toISOString();
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await googleGet(db, userId, `${EVENTS}?${q.toString()}`, 'Google Takvim');
    for (const raw of Array.isArray(data.items) ? data.items : []) {
      const ev = toEvent(raw);
      if (ev) out.push(ev);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  const mapped = store.listMapTaskIds(db, userId, KIND, out.map((e) => e.id));
  for (const e of out) e.taskId = mapped.get(e.id) ?? null;
  return out;
}

/** Creates (once) a task at the event's time. Event data is re-fetched from Google. */
export async function eventToTask(
  db: Db,
  userId: string,
  eventId: string,
  opts: { projectId?: string | null; priority?: number } = {},
): Promise<{ task: tasksDb.TaskAPI; existing: boolean }> {
  const prev = store.getMap(db, userId, KIND, eventId);
  if (prev) {
    const t = tasksDb.getTask(db, userId, prev.task_id);
    if (t) return { task: t, existing: true };
  }
  const raw = await googleGet(db, userId, `${EVENTS}/${encodeURIComponent(eventId)}`, 'Google Takvim etkinliği');
  const ev = toEvent(raw);
  if (!ev) throw new ApiError(404, 'Etkinlik bulunamadı veya iptal edilmiş.');

  let projectId = opts.projectId;
  if (projectId === undefined) {
    tasksDb.seedDefaultsIfNeeded(db, userId);
    projectId = tasksDb.listProjects(db, userId).projects.find((p) => p.isInbox)?.id ?? null;
  }
  const lines: string[] = [];
  if (ev.description) lines.push(ev.description.trim());
  if (ev.location) lines.push(`Konum: ${ev.location}`);
  if (!ev.allDay && ev.startTime) lines.push(`Saat: ${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}`);
  if (ev.htmlLink) lines.push(`Google Takvim: ${ev.htmlLink}`);
  const task = tasksDb.createTask(db, userId, {
    title: ev.title.slice(0, 500),
    notes: lines.join('\n\n').slice(0, 50000),
    projectId,
    priority: opts.priority ?? 3,
    dueDate: ev.date,
    dueTime: ev.startTime,
  });
  if (ev.htmlLink) {
    try { linksDb.createLink(db, userId, { fromType: 'task', fromId: task.id, toType: 'url', toId: ev.htmlLink, label: 'Google Takvim' }); } catch { /* optional */ }
  }
  store.upsertMap(db, {
    user_id: userId, kind: KIND, external_id: eventId, task_id: task.id, etag: null,
    synced_title: task.title, synced_notes: task.notes, synced_due_date: task.dueDate, synced_due_time: task.dueTime,
    synced_priority: task.priority, synced_state: null,
  });
  return { task: tasksDb.getTask(db, userId, task.id)!, existing: false };
}
