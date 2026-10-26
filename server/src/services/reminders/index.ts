/**
 * Reminder scheduler: a single tick every 60 s that sends
 *  - task reminders (open tasks with dueDate + dueTime inside the next
 *    reminderLeadMinutes, each (task, due) pair once), and
 *  - the morning digest (today's / overdue task counts + next high-impact
 *    economic calendar events) once per day at digestTime.
 * Everything goes through ntfy; failures are logged and retried next tick.
 */
import { addDays } from '../../db/tasks';
import newsRoutes from '../../routes/news'; // reuses its cached economic calendar
import { enabledNtfyUsers, sendNtfy, inQuietHours, type NtfyStored } from '../ntfy';
import { localYmd, localHm, minutesOf } from '../ntfy/http';
import { claimOnce, releaseClaim, remindersDb, pruneSent } from './sent';

const TICK_MS = 60 * 1000;
const LATE_GRACE_MS = 2 * 60 * 1000; // a tick may run a little after the due time
const DIGEST_WINDOW_MIN = 120; // app started later than this after digestTime: skip that day
const MAX_REMINDERS_PER_TICK = 10;

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastPrune = 0;

interface DueTaskRow { id: string; title: string; due_date: string; due_time: string; priority: number }

function dueAt(row: { due_date: string; due_time: string }): number {
  const [y, m, d] = row.due_date.split('-').map(Number);
  const [hh, mm] = row.due_time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

async function taskReminders(userId: string, s: NtfyStored, now: Date): Promise<number> {
  if (!s.taskReminders || inQuietHours(s.quietHours, now)) return 0;
  const today = localYmd(now);
  const rows = remindersDb()
    .prepare(
      `SELECT id, title, due_date, due_time, priority FROM tasks
       WHERE user_id = ? AND status = 'open' AND due_time IS NOT NULL AND due_date IN (?, ?, ?)
       ORDER BY due_date, due_time`,
    )
    .all(userId, addDays(today, -1), today, addDays(today, 1)) as DueTaskRow[];
  const lead = s.reminderLeadMinutes * 60 * 1000;
  const t = now.getTime();
  let sent = 0;
  for (const r of rows) {
    if (sent >= MAX_REMINDERS_PER_TICK) break;
    const at = dueAt(r);
    if (!Number.isFinite(at) || at - t > lead || at < t - LATE_GRACE_MS) continue;
    const key = `${r.due_date} ${r.due_time}`;
    if (!claimOnce(userId, r.id, key)) continue;
    const mins = Math.max(0, Math.round((at - t) / 60000));
    const res = await sendNtfy(s, {
      title: mins > 0 ? `Görev ${mins} dk sonra` : 'Görev zamanı geldi',
      body: `${r.title.slice(0, 300)} (${r.due_time})`,
      priority: r.priority === 1 ? 5 : 4,
      tags: ['alarm_clock'],
    });
    if (res.ok) sent++;
    else {
      releaseClaim(userId, r.id, key);
      console.warn('[Reminders] task push failed:', res.error);
    }
  }
  return sent;
}

interface CalendarEvent { title: string; country: string; date: string; impact: string }

/** High-impact events still ahead today, via the existing calendar route (cached there). */
async function upcomingHighImpact(now: Date): Promise<CalendarEvent[] | null> {
  try {
    const res = await newsRoutes.request('/api/news/calendar');
    if (!res.ok) return null;
    const data = (await res.json()) as { events?: CalendarEvent[]; error?: string };
    if (!Array.isArray(data.events) || (data.error && !data.events.length)) return null;
    const today = localYmd(now);
    return data.events
      .filter((e) => e && e.impact === 'High')
      .filter((e) => {
        const d = new Date(e.date);
        return !Number.isNaN(d.getTime()) && d.getTime() >= now.getTime() && localYmd(d) === today;
      })
      .slice(0, 5);
  } catch {
    return null;
  }
}

export async function buildDigest(userId: string, now: Date): Promise<{ title: string; body: string }> {
  const today = localYmd(now);
  const db = remindersDb();
  const count = (sql: string) => (db.prepare(sql).get(userId, today) as { n: number }).n;
  const dueToday = count("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'open' AND due_date = ?");
  const overdue = count("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'open' AND due_date < ?");
  const top = db
    .prepare(
      `SELECT title, due_time FROM tasks WHERE user_id = ? AND status = 'open' AND due_date = ?
       ORDER BY due_time IS NULL, due_time, priority LIMIT 3`,
    )
    .all(userId, today) as Array<{ title: string; due_time: string | null }>;
  const lines: string[] = [`Bugün ${dueToday} görev, gecikmiş ${overdue} görev.`];
  for (const t of top) lines.push(`• ${t.due_time ? t.due_time + ' ' : ''}${t.title.slice(0, 120)}`);
  const events = await upcomingHighImpact(now);
  if (events && events.length) {
    lines.push('', 'Yüksek etkili takvim:');
    for (const e of events) {
      const hm = new Date(e.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      lines.push(`• ${hm} ${e.country} ${e.title}`.slice(0, 140));
    }
  } else if (events) {
    lines.push('', 'Bugün kalan yüksek etkili takvim olayı yok.');
  }
  return { title: 'Günaydın · Günlük özet', body: lines.join('\n') };
}

async function morningDigest(userId: string, s: NtfyStored, now: Date): Promise<boolean> {
  if (!s.morningDigest) return false;
  const diff = minutesOf(localHm(now)) - minutesOf(s.digestTime);
  if (diff < 0 || diff > DIGEST_WINDOW_MIN) return false;
  const day = localYmd(now);
  if (!claimOnce(userId, 'digest', day)) return false;
  const d = await buildDigest(userId, now);
  const res = await sendNtfy(s, { ...d, priority: 3, tags: ['sunrise'] });
  if (!res.ok) {
    releaseClaim(userId, 'digest', day);
    console.warn('[Reminders] digest push failed:', res.error);
  }
  return res.ok;
}

/** One scheduler pass (exported for checks). Never throws. */
export async function runReminderTick(now = new Date()): Promise<{ reminders: number; digests: number }> {
  const out = { reminders: 0, digests: 0 };
  if (running) return out;
  running = true;
  try {
    if (Date.now() - lastPrune > 24 * 60 * 60 * 1000) {
      lastPrune = Date.now();
      try { pruneSent(); } catch { /* ignore */ }
    }
    for (const { userId, settings } of enabledNtfyUsers()) {
      try {
        out.reminders += await taskReminders(userId, settings, now);
        if (await morningDigest(userId, settings, now)) out.digests++;
      } catch (err: any) {
        console.warn('[Reminders] tick failed for user:', err?.message || err);
      }
    }
  } catch (err: any) {
    console.warn('[Reminders] tick failed:', err?.message || err);
  } finally {
    running = false;
  }
  return out;
}

export function startReminders(): void {
  if (timer) return;
  timer = setInterval(() => { runReminderTick().catch(() => {}); }, TICK_MS);
  timer.unref();
}
