/**
 * Dedupe ledger for pushed notifications: reminders_sent(user_id, task_id, due_key).
 * task_id is a task id, or a pseudo id such as 'news:<id>' / 'digest'.
 * Created lazily; rows older than 30 days are pruned.
 */
import { getDb, type Db } from '../../db/connection';

const DDL = `
CREATE TABLE IF NOT EXISTS reminders_sent (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  due_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id, due_key)
);
CREATE INDEX IF NOT EXISTS idx_reminders_sent_at ON reminders_sent(sent_at);
`;

const ready = new WeakSet<Db>();

export function remindersDb(): Db {
  const d = getDb();
  if (!ready.has(d)) {
    d.exec(DDL);
    ready.add(d);
  }
  return d;
}

/** Atomically records (user, id, key); true only for the first caller. */
export function claimOnce(userId: string, taskId: string, dueKey: string): boolean {
  return remindersDb()
    .prepare('INSERT OR IGNORE INTO reminders_sent (user_id, task_id, due_key, sent_at) VALUES (?, ?, ?, ?)')
    .run(userId, taskId, dueKey, new Date().toISOString()).changes === 1;
}

/** Undo a claim after a failed send so the next tick may retry. */
export function releaseClaim(userId: string, taskId: string, dueKey: string): void {
  remindersDb().prepare('DELETE FROM reminders_sent WHERE user_id = ? AND task_id = ? AND due_key = ?').run(userId, taskId, dueKey);
}

export function wasSent(userId: string, taskId: string, dueKey: string): boolean {
  return !!remindersDb().prepare('SELECT 1 FROM reminders_sent WHERE user_id = ? AND task_id = ? AND due_key = ?').get(userId, taskId, dueKey);
}

export function pruneSent(days = 30): number {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return remindersDb().prepare('DELETE FROM reminders_sent WHERE sent_at < ?').run(cutoff).changes;
}
