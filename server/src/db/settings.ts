/**
 * Per-user key/value settings for the "Bağlantılar" page (ntfy, backup, local AI).
 * Table app_settings is created lazily on first use. Values are JSON; secret
 * fields are stored encrypted (AES-GCM, utils/crypto) and never returned as-is.
 */
import { getDb, type Db } from './connection';
import { getSecretKey } from '../config';
import { encrypt, decrypt } from '../utils/crypto';

const DDL = `
CREATE TABLE IF NOT EXISTS app_settings (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
`;

const ready = new WeakSet<Db>();

function db(): Db {
  const d = getDb();
  if (!ready.has(d)) {
    d.exec(DDL);
    ready.add(d);
  }
  return d;
}

export function getSetting<T = unknown>(userId: string, key: string): T | null {
  const row = db().prepare('SELECT value_json FROM app_settings WHERE user_id = ? AND key = ?').get(userId, key) as
    | { value_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

export function setSetting(userId: string, key: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO app_settings (user_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(userId, key, JSON.stringify(value ?? null), new Date().toISOString());
}

export function deleteSetting(userId: string, key: string): boolean {
  return db().prepare('DELETE FROM app_settings WHERE user_id = ? AND key = ?').run(userId, key).changes > 0;
}

/** All (userId, value) pairs stored under a key; used by the background schedulers. */
export function listSettingsByKey<T = unknown>(key: string): Array<{ userId: string; value: T }> {
  const rows = db().prepare('SELECT user_id, value_json FROM app_settings WHERE key = ?').all(key) as Array<{
    user_id: string;
    value_json: string;
  }>;
  const out: Array<{ userId: string; value: T }> = [];
  for (const r of rows) {
    try {
      out.push({ userId: r.user_id, value: JSON.parse(r.value_json) as T });
    } catch {
      /* skip corrupt rows */
    }
  }
  return out;
}

function encryptionKey(): string {
  return process.env.ENCRYPTION_KEY || getSecretKey();
}

export function encryptSecret(plain: string): Promise<string> {
  return encrypt(plain, encryptionKey());
}

/** Returns null when the value cannot be decrypted (e.g. the key changed). */
export async function decryptSecret(enc: string | null | undefined): Promise<string | null> {
  if (!enc) return null;
  try {
    return await decrypt(enc, encryptionKey());
  } catch {
    return null;
  }
}
