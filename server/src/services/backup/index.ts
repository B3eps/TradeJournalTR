/**
 * Local backups: `<DATA_DIR>/../yedekler/yedek-YYYYMMDD-HHmm/` holding a
 * consistent SQLite copy (better-sqlite3 online backup API), screenshots,
 * news evaluations and
 * manifest.json. The encryption key is intentionally NOT copied: a backup
 * folder may be shared or synced, so portable recovery requires a separately
 * protected copy of the complete data directory.
 * Restore is manual (documented in the UI).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH, SCREENSHOTS_DIR, getEnv } from '../../config';
import { getDb } from '../../db/connection';
import { getSetting, setSetting, listSettingsByKey } from '../../db/settings';
import { IntegrationError, bad, optBool, intInRange, optTime, localHm, localYmd, minutesOf } from '../ntfy/http';

export const BACKUP_KEY = 'backup';
export const BACKUP_ROOT = path.resolve(process.env.BACKUP_DIR || path.join(path.resolve(DATA_DIR), '..', 'yedekler'));
const NAME_RE = /^yedek-\d{8}-\d{4}(?:-\d{1,2})?$/;
const MANIFEST_VERSION = 2;
const COUNT_TABLES = ['trades', 'tasks', 'projects', 'notes', 'cards', 'daily_notes', 'news_items', 'habits', 'fin_transactions'];

export interface BackupSettings { autoEnabled: boolean; hour: string; keep: number }
export const BACKUP_DEFAULTS: BackupSettings = { autoEnabled: false, hour: '03:00', keep: 14 };

export interface BackupInfo {
  name: string;
  createdAt: string;
  sizeBytes: number;
  dbFile: string | null;
  counts: Record<string, number> | null;
  screenshotCount: number | null;
  evaluationCount: number | null;
  keyMatches: boolean | null;
  auto: boolean;
}

export function getBackupSettings(userId: string): BackupSettings {
  const raw = getSetting<Partial<BackupSettings>>(userId, BACKUP_KEY);
  return { ...BACKUP_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

export function saveBackupSettings(userId: string, body: Record<string, unknown>): BackupSettings {
  const cur = getBackupSettings(userId);
  const next: BackupSettings = {
    autoEnabled: optBool(body.autoEnabled, cur.autoEnabled),
    hour: optTime(body.hour, 'Yedekleme saati', cur.hour),
    keep: intInRange(body.keep, 1, 365, 'Saklanacak yedek sayısı', cur.keep),
  };
  setSetting(userId, BACKUP_KEY, next);
  return next;
}

/** Validates a backup folder name and returns its absolute path (path-traversal safe). */
export function resolveBackupDir(name: unknown): string {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw bad('Geçersiz yedek adı.');
  const full = path.resolve(BACKUP_ROOT, name);
  if (path.dirname(full) !== BACKUP_ROOT) throw bad('Geçersiz yedek adı.');
  return full;
}

function dirSize(dir: string): number {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isFile()) total += fs.statSync(p).size;
    else if (ent.isDirectory()) total += dirSize(p);
  }
  return total;
}

export function listBackups(): BackupInfo[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && NAME_RE.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  const currentKeyFingerprint = crypto.createHash('sha256').update(getEnv().ENCRYPTION_KEY).digest('hex');
  for (const name of names) {
    const dir = path.join(BACKUP_ROOT, name);
    try {
      let manifest: any = null;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      } catch { /* missing / broken manifest */ }
      const created = manifest && typeof manifest.createdAt === 'string' && Number.isFinite(Date.parse(manifest.createdAt))
        ? manifest.createdAt
        : fs.statSync(dir).mtime.toISOString();
      out.push({
        name,
        createdAt: created,
        sizeBytes: dirSize(dir),
        dbFile: manifest && typeof manifest.dbFile === 'string' ? manifest.dbFile : null,
        counts: manifest && manifest.counts && typeof manifest.counts === 'object' ? manifest.counts : null,
        screenshotCount: Number.isInteger(manifest?.screenshotCount) ? manifest.screenshotCount : null,
        evaluationCount: Number.isInteger(manifest?.evaluationCount) ? manifest.evaluationCount : null,
        keyMatches: typeof manifest?.keyFingerprint === 'string' ? manifest.keyFingerprint === currentKeyFingerprint : null,
        auto: !!manifest?.auto,
      });
    } catch { /* vanished */ }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

export function deleteBackup(name: string): void {
  const dir = resolveBackupDir(name);
  if (!fs.existsSync(dir)) throw new IntegrationError(404, 'Yedek bulunamadı.');
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Deletes the oldest backups beyond `keep`. Returns the removed names. */
export function pruneBackups(keep: number): string[] {
  const removed: string[] = [];
  for (const b of listBackups().slice(Math.max(1, keep))) {
    try {
      deleteBackup(b.name);
      removed.push(b.name);
    } catch (err: any) {
      console.warn('[Backup] prune failed for', b.name, err?.message || err);
    }
  }
  return removed;
}

function stamp(d: Date): string {
  return `${localYmd(d).replace(/-/g, '')}-${localHm(d).replace(':', '')}`;
}

/** Copy only ordinary files; never follow a symlink out of the data folder. */
function copyFlatFiles(source: string, destination: string): number {
  fs.mkdirSync(destination, { recursive: true });
  if (!fs.existsSync(source)) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error(`Unsupported backup entry: ${entry.name}`);
    const sourceFile = path.join(source, entry.name);
    const destFile = path.join(destination, entry.name);
    const before = fs.statSync(sourceFile);
    fs.copyFileSync(sourceFile, destFile);
    const after = fs.statSync(sourceFile);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || fs.statSync(destFile).size !== after.size) {
      throw new Error(`File changed during backup: ${entry.name}`);
    }
    copied++;
  }
  return copied;
}

let inflight: Promise<BackupInfo> | null = null;
let lastError: string | null = null;
let lastRunAt: string | null = null;

export function backupStatus() {
  return { running: !!inflight, lastError, lastRunAt };
}

async function doBackup(opts: { keep: number; auto: boolean }): Promise<BackupInfo> {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  const now = new Date();
  let name = `yedek-${stamp(now)}`;
  for (let i = 2; fs.existsSync(path.join(BACKUP_ROOT, name)); i++) {
    if (i > 99) throw new IntegrationError(409, 'Bu dakika için çok fazla yedek var.');
    name = `yedek-${stamp(now)}-${i}`;
  }
  const finalDir = resolveBackupDir(name);
  const tmpDir = path.join(BACKUP_ROOT, `.tmp-${name}-${process.pid}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbFile = path.basename(DB_PATH);
  try {
    // Online backup: consistent snapshot even while the app keeps writing (WAL).
    await getDb().backup(path.join(tmpDir, dbFile));
    const screenshotCount = copyFlatFiles(SCREENSHOTS_DIR, path.join(tmpDir, 'screenshots'));
    const evaluationCount = copyFlatFiles(path.join(DATA_DIR, 'news-eval'), path.join(tmpDir, 'news-eval'));
    // Detect a mismatched key at restore time without putting the key in a shareable backup.
    const keyFingerprint = crypto.createHash('sha256').update(getEnv().ENCRYPTION_KEY).digest('hex');

    const counts: Record<string, number> = {};
    const copy = new Database(path.join(tmpDir, dbFile), { readonly: true, fileMustExist: true });
    try {
      const check = copy.pragma('quick_check', { simple: true });
      if (check !== 'ok') throw new Error(`integrity: ${String(check)}`);
      const tables = new Set((copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
      for (const t of COUNT_TABLES) {
        if (tables.has(t)) counts[t] = (copy.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
      }
    } finally {
      copy.close();
    }

    const manifest = {
      version: MANIFEST_VERSION,
      app: 'Trade Günlüğü',
      createdAt: now.toISOString(),
      auto: opts.auto,
      dbFile,
      dbSizeBytes: fs.statSync(path.join(tmpDir, dbFile)).size,
      counts,
      screenshotCount,
      evaluationCount,
      keyFingerprint,
      excluded: ['secret.key'],
      note: 'Bu yerel yedek veritabanını, ekran görüntülerini ve haber değerlendirmelerini içerir. Şifreleme anahtarı dahil değildir. Başka bilgisayara taşımak için uygulama kapalıyken data klasörünü anahtarıyla birlikte ayrıca güvenli şekilde kopyalayın.',
    };
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpDir, finalDir);
  } catch (err) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
  pruneBackups(opts.keep);
  const info = listBackups().find((b) => b.name === name);
  if (!info) throw new Error('backup vanished after creation');
  return info;
}

/** Runs one backup (at most one at a time). */
export async function runBackup(opts: { keep: number; auto?: boolean }): Promise<BackupInfo> {
  if (inflight) throw new IntegrationError(409, 'Bir yedekleme zaten sürüyor.');
  inflight = doBackup({ keep: opts.keep, auto: !!opts.auto });
  try {
    const info = await inflight;
    lastError = null;
    return info;
  } catch (err: any) {
    lastError = err instanceof IntegrationError ? err.message : 'Yedekleme başarısız oldu.';
    console.error('[Backup] failed:', err?.message || err);
    throw err instanceof IntegrationError ? err : new IntegrationError(500, 'Yedekleme başarısız oldu. Disk alanını ve klasör izinlerini kontrol edin.');
  } finally {
    lastRunAt = new Date().toISOString();
    inflight = null;
  }
}

// --- automatic daily backup ---

let autoTimer: NodeJS.Timeout | null = null;
let lastAutoAttempt = 0;

/** One auto-backup check (exported for checks). Catches up later the same day if the app was off. */
export async function autoBackupTick(now = new Date()): Promise<boolean> {
  try {
    const conf = listSettingsByKey<Partial<BackupSettings>>(BACKUP_KEY)
      .map((r) => ({ ...BACKUP_DEFAULTS, ...(r.value || {}) }))
      .find((s) => s.autoEnabled);
    if (!conf || inflight) return false;
    if (minutesOf(localHm(now)) < minutesOf(conf.hour)) return false;
    const todayPrefix = `yedek-${localYmd(now).replace(/-/g, '')}-`;
    if (listBackups().some((b) => b.name.startsWith(todayPrefix))) return false;
    if (Date.now() - lastAutoAttempt < 60 * 60 * 1000) return false; // retry failures hourly
    lastAutoAttempt = Date.now();
    await runBackup({ keep: conf.keep, auto: true });
    console.log('[Backup] automatic backup created');
    return true;
  } catch (err: any) {
    console.warn('[Backup] automatic backup failed:', err?.message || err);
    return false;
  }
}

export function startAutoBackup(): void {
  if (autoTimer) return;
  autoTimer = setInterval(() => { autoBackupTick().catch(() => {}); }, 60 * 1000);
  autoTimer.unref();
}

export const BACKUP_PATHS = { root: BACKUP_ROOT, dataDir: path.resolve(DATA_DIR), dbFile: path.basename(DB_PATH) };
