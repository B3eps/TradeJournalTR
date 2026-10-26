/**
 * Google integration persistence (SQLite). Tables are created lazily:
 *  - google_auth: one row per user with the user's own OAuth client (secret
 *    encrypted) and the encrypted tokens + sync settings/status.
 *  - google_sync_map: external Google object -> local task, with the values
 *    that were last written by the sync (used as the local-edit guard).
 * Secrets never leave this module unencrypted except through getSecrets().
 */
import type { Db } from '../../db/connection';
import { encrypt, decrypt } from '../../utils/crypto';
import { getEnv } from '../../config';

const DDL = `
CREATE TABLE IF NOT EXISTS google_auth (
  user_id TEXT PRIMARY KEY,
  client_id TEXT,
  client_secret_enc TEXT,
  refresh_token_enc TEXT,
  access_token_enc TEXT,
  expires_at INTEGER,
  scopes TEXT,
  email TEXT,
  connected_at TEXT,
  auto_sync INTEGER NOT NULL DEFAULT 1,
  include_undated INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_error TEXT,
  last_summary TEXT
);
CREATE TABLE IF NOT EXISTS google_sync_map (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  etag TEXT,
  synced_title TEXT,
  synced_notes TEXT,
  synced_due_date TEXT,
  synced_due_time TEXT,
  synced_priority INTEGER,
  synced_state TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_google_sync_map_task ON google_sync_map(task_id);
`;

const ready = new WeakSet<Db>();
export function ensureGoogleTables(db: Db): void {
  if (ready.has(db)) return;
  db.exec(DDL);
  ready.add(db);
}

export function encryptionKey(): string {
  return getEnv().ENCRYPTION_KEY;
}

export interface AuthRow {
  user_id: string;
  client_id: string | null;
  client_secret_enc: string | null;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  expires_at: number | null;
  scopes: string | null;
  email: string | null;
  connected_at: string | null;
  auto_sync: number;
  include_undated: number;
  last_sync_at: string | null;
  last_error: string | null;
  last_summary: string | null;
}

export function getAuthRow(db: Db, userId: string): AuthRow | null {
  ensureGoogleTables(db);
  return (db.prepare('SELECT * FROM google_auth WHERE user_id = ?').get(userId) as AuthRow | undefined) ?? null;
}

function ensureRow(db: Db, userId: string): void {
  ensureGoogleTables(db);
  db.prepare('INSERT OR IGNORE INTO google_auth (user_id) VALUES (?)').run(userId);
}

export function listConnectedUserIds(db: Db): Array<{ userId: string; autoSync: boolean }> {
  ensureGoogleTables(db);
  const rows = db
    .prepare('SELECT user_id, auto_sync FROM google_auth WHERE refresh_token_enc IS NOT NULL AND client_id IS NOT NULL')
    .all() as Array<{ user_id: string; auto_sync: number }>;
  return rows.map((r) => ({ userId: r.user_id, autoSync: !!r.auto_sync }));
}

/** Saves the user's OAuth client. A different client id invalidates existing tokens. */
export async function saveCredentials(db: Db, userId: string, clientId: string, clientSecret: string): Promise<void> {
  ensureRow(db, userId);
  const prev = getAuthRow(db, userId);
  const secretEnc = await encrypt(clientSecret, encryptionKey());
  if (prev?.client_id && prev.client_id !== clientId) {
    db.prepare(
      `UPDATE google_auth SET refresh_token_enc = NULL, access_token_enc = NULL, expires_at = NULL, scopes = NULL,
              email = NULL, connected_at = NULL WHERE user_id = ?`,
    ).run(userId);
  }
  db.prepare('UPDATE google_auth SET client_id = ?, client_secret_enc = ?, last_error = NULL WHERE user_id = ?').run(clientId, secretEnc, userId);
}

export interface Secrets {
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number | null;
}

export async function getSecrets(db: Db, userId: string): Promise<Secrets | null> {
  const row = getAuthRow(db, userId);
  if (!row?.client_id || !row.client_secret_enc) return null;
  const key = encryptionKey();
  const dec = async (v: string | null) => {
    if (!v) return null;
    try { return await decrypt(v, key); } catch { return null; }
  };
  const clientSecret = await dec(row.client_secret_enc);
  if (clientSecret === null) return null;
  return {
    clientId: row.client_id,
    clientSecret,
    refreshToken: await dec(row.refresh_token_enc),
    accessToken: await dec(row.access_token_enc),
    expiresAt: row.expires_at,
  };
}

export async function saveTokens(
  db: Db,
  userId: string,
  t: { accessToken: string; expiresAt: number; refreshToken?: string | null; scopes?: string | null; email?: string | null; connected?: boolean },
): Promise<void> {
  ensureRow(db, userId);
  const key = encryptionKey();
  const sets = ['access_token_enc = ?', 'expires_at = ?'];
  const vals: unknown[] = [await encrypt(t.accessToken, key), t.expiresAt];
  if (t.refreshToken) { sets.push('refresh_token_enc = ?'); vals.push(await encrypt(t.refreshToken, key)); }
  if (t.scopes !== undefined) { sets.push('scopes = ?'); vals.push(t.scopes); }
  if (t.email !== undefined) { sets.push('email = ?'); vals.push(t.email); }
  if (t.connected) { sets.push('connected_at = ?', 'last_error = NULL'); vals.push(new Date().toISOString()); }
  db.prepare(`UPDATE google_auth SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals, userId);
}

export function clearTokens(db: Db, userId: string, error: string | null = null): void {
  ensureGoogleTables(db);
  db.prepare(
    `UPDATE google_auth SET refresh_token_enc = NULL, access_token_enc = NULL, expires_at = NULL, scopes = NULL,
            email = NULL, connected_at = NULL, last_error = ? WHERE user_id = ?`,
  ).run(error, userId);
}

export function updateSettings(db: Db, userId: string, s: { autoSync?: boolean; includeUndated?: boolean }): void {
  ensureRow(db, userId);
  if (s.autoSync !== undefined) db.prepare('UPDATE google_auth SET auto_sync = ? WHERE user_id = ?').run(s.autoSync ? 1 : 0, userId);
  if (s.includeUndated !== undefined) db.prepare('UPDATE google_auth SET include_undated = ? WHERE user_id = ?').run(s.includeUndated ? 1 : 0, userId);
}

export function recordSyncResult(db: Db, userId: string, summary: unknown, error: string | null): void {
  ensureRow(db, userId);
  db.prepare('UPDATE google_auth SET last_sync_at = ?, last_error = ?, last_summary = ? WHERE user_id = ?')
    .run(new Date().toISOString(), error, summary === undefined ? null : JSON.stringify(summary), userId);
}

export function setLastError(db: Db, userId: string, error: string | null): void {
  ensureRow(db, userId);
  db.prepare('UPDATE google_auth SET last_error = ? WHERE user_id = ?').run(error, userId);
}

// ─── Sync map ────────────────────────────────────────────────────────────────

export interface MapRow {
  user_id: string;
  kind: string;
  external_id: string;
  task_id: string;
  etag: string | null;
  synced_title: string | null;
  synced_notes: string | null;
  synced_due_date: string | null;
  synced_due_time: string | null;
  synced_priority: number | null;
  synced_state: string | null;
}

export function getMap(db: Db, userId: string, kind: string, externalId: string): MapRow | null {
  ensureGoogleTables(db);
  return (db.prepare('SELECT * FROM google_sync_map WHERE user_id = ? AND kind = ? AND external_id = ?').get(userId, kind, externalId) as MapRow | undefined) ?? null;
}

export function listMapTaskIds(db: Db, userId: string, kind: string, externalIds: string[]): Map<string, string> {
  ensureGoogleTables(db);
  const out = new Map<string, string>();
  if (!externalIds.length) return out;
  const rows = db
    .prepare(
      `SELECT m.external_id, m.task_id FROM google_sync_map m JOIN tasks t ON t.id = m.task_id
       WHERE m.user_id = ? AND m.kind = ? AND m.external_id IN (SELECT value FROM json_each(?))`,
    )
    .all(userId, kind, JSON.stringify(externalIds)) as Array<{ external_id: string; task_id: string }>;
  for (const r of rows) out.set(r.external_id, r.task_id);
  return out;
}

export function upsertMap(db: Db, row: Omit<MapRow, 'synced_priority'> & { synced_priority: number | null }): void {
  ensureGoogleTables(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO google_sync_map (user_id, kind, external_id, task_id, etag, synced_title, synced_notes, synced_due_date,
                                  synced_due_time, synced_priority, synced_state, created_at, updated_at)
     VALUES (@user_id, @kind, @external_id, @task_id, @etag, @synced_title, @synced_notes, @synced_due_date,
             @synced_due_time, @synced_priority, @synced_state, @now, @now)
     ON CONFLICT(user_id, kind, external_id) DO UPDATE SET
       task_id = excluded.task_id, etag = excluded.etag, synced_title = excluded.synced_title,
       synced_notes = excluded.synced_notes, synced_due_date = excluded.synced_due_date,
       synced_due_time = excluded.synced_due_time, synced_priority = excluded.synced_priority,
       synced_state = excluded.synced_state, updated_at = excluded.updated_at`,
  ).run({ ...row, now });
}
