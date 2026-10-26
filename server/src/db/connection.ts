import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH, ensureDataDirs } from '../config';

/** The better-sqlite3 database handle type used across the db layer. */
export type Db = Database.Database;

let instance: Db | null = null;

/**
 * Additive, idempotent migrations for databases created by older schema
 * versions. Each column is only added when it is missing, so this is safe to
 * run on every boot.
 */
const TRADE_COLUMN_MIGRATIONS: Array<{ column: string; ddl: string }> = [
  // Forex: broker commission and overnight swap, in account currency (nullable)
  { column: 'commission', ddl: 'ALTER TABLE trades ADD COLUMN commission REAL' },
  { column: 'swap', ddl: 'ALTER TABLE trades ADD COLUMN swap REAL' },
];

/** Live news feed cache (server/src/services/newsfeed). Pruned to 14 days. */
const NEWS_ITEMS_DDL = `
CREATE TABLE IF NOT EXISTS news_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',
  instruments TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_news_items_published ON news_items(published_at);
CREATE INDEX IF NOT EXISTS idx_news_items_first_seen ON news_items(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_news_items_category ON news_items(category, importance);
`;

/**
 * Life OS: projects, labels, tasks, time entries and cross-entity links
 * (server/src/db/tasks.ts, server/src/db/links.ts). All rows are user-scoped.
 */
const LIFE_OS_DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#808080',
  icon       TEXT,
  is_inbox   INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, sort_order);

CREATE TABLE IF NOT EXISTS labels (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name    TEXT NOT NULL COLLATE NOCASE,
  color   TEXT NOT NULL DEFAULT '#808080',
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  priority     INTEGER NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 4),
  due_date     TEXT,
  due_time     TEXT,
  recurrence   TEXT,
  estimate_min INTEGER,
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  sort_order   REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due ON tasks(user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(user_id, completed_at);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);

CREATE TABLE IF NOT EXISTS time_entries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  seconds    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_started ON time_entries(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_time_entries_running ON time_entries(user_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS links (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_type  TEXT NOT NULL,
  from_id    TEXT NOT NULL,
  to_type    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  label      TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, from_type, from_id, to_type, to_id)
);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(user_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(user_id, to_type, to_id);

CREATE TABLE IF NOT EXISTS user_flags (
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);
`;

function runMigrations(db: Db): void {
  db.exec(NEWS_ITEMS_DDL);
  db.exec(LIFE_OS_DDL);

  const existing = new Set(
    (db.prepare('PRAGMA table_info(trades)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const m of TRADE_COLUMN_MIGRATIONS) {
    if (!existing.has(m.column)) {
      db.exec(m.ddl);
      console.log(`[DB] migration: added trades.${m.column}`);
    }
  }
}

/**
 * Returns the process-wide SQLite connection, creating the data directory,
 * database file, and schema on first use.
 */
export function getDb(): Db {
  if (instance) return instance;

  ensureDataDirs();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  runMigrations(db);

  instance = db;
  return db;
}

/** Explicit boot-time initialization (schema creation happens here). */
export function initDb(): Db {
  return getDb();
}
