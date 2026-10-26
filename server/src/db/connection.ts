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

const TRADOVATE_COLUMN_MIGRATIONS: Array<{ column: string; ddl: string }> = [
  { column: 'accounts_disabled', ddl: 'ALTER TABLE tradovate_connections ADD COLUMN accounts_disabled INTEGER NOT NULL DEFAULT 0' },
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

/** Experimental paper-trading journal; intentionally separate from trades. */
const PAPER_LAB_DDL = `
CREATE TABLE IF NOT EXISTS paper_lab_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target REAL NOT NULL CHECK (target > 0),
  loss_guard REAL CHECK (loss_guard IS NULL OR loss_guard > 0),
  mode TEXT NOT NULL DEFAULT 'stages' CHECK (mode IN ('stages', 'prop')),
  program TEXT,
  initial_balance REAL,
  max_daily_drawdown REAL,
  max_total_drawdown REAL,
  consistency_limit REAL,
  current_stage INTEGER NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'failed', 'completed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_lab_runs_user ON paper_lab_runs(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_lab_one_active_run ON paper_lab_runs(user_id) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS paper_lab_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL DEFAULT 1 CHECK (stage >= 1),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  fees REAL NOT NULL DEFAULT 0 CHECK (fees >= 0),
  note TEXT NOT NULL DEFAULT '',
  pnl REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_lab_user_stage ON paper_lab_entries(user_id, stage, created_at);
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
  db.exec(PAPER_LAB_DDL);
  const runColumns = new Set((db.prepare('PRAGMA table_info(paper_lab_runs)').all() as Array<{ name: string }>).map((c) => c.name));
  const runMigrations: Array<{ column: string; ddl: string }> = [
    { column: 'mode', ddl: "ALTER TABLE paper_lab_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'stages'" },
    { column: 'program', ddl: 'ALTER TABLE paper_lab_runs ADD COLUMN program TEXT' },
    { column: 'initial_balance', ddl: 'ALTER TABLE paper_lab_runs ADD COLUMN initial_balance REAL' },
    { column: 'max_daily_drawdown', ddl: 'ALTER TABLE paper_lab_runs ADD COLUMN max_daily_drawdown REAL' },
    { column: 'max_total_drawdown', ddl: 'ALTER TABLE paper_lab_runs ADD COLUMN max_total_drawdown REAL' },
    { column: 'consistency_limit', ddl: 'ALTER TABLE paper_lab_runs ADD COLUMN consistency_limit REAL' },
  ];
  for (const m of runMigrations) if (!runColumns.has(m.column)) db.exec(m.ddl);
  const paperColumns = new Set((db.prepare('PRAGMA table_info(paper_lab_entries)').all() as Array<{ name: string }>).map((c) => c.name));
  if (!paperColumns.has('run_id')) db.exec('ALTER TABLE paper_lab_entries ADD COLUMN run_id TEXT REFERENCES paper_lab_runs(id) ON DELETE CASCADE');
  if (!paperColumns.has('multiplier')) db.exec('ALTER TABLE paper_lab_entries ADD COLUMN multiplier REAL NOT NULL DEFAULT 1');
  db.exec('CREATE INDEX IF NOT EXISTS idx_paper_lab_run ON paper_lab_entries(run_id, stage, created_at)');

  const existing = new Set(
    (db.prepare('PRAGMA table_info(trades)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const m of TRADE_COLUMN_MIGRATIONS) {
    if (!existing.has(m.column)) {
      db.exec(m.ddl);
      console.log(`[DB] migration: added trades.${m.column}`);
    }
  }

  const tradovateColumns = new Set(
    (db.prepare('PRAGMA table_info(tradovate_connections)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const m of TRADOVATE_COLUMN_MIGRATIONS) {
    if (!tradovateColumns.has(m.column)) {
      db.exec(m.ddl);
      console.log(`[DB] migration: added tradovate_connections.${m.column}`);
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
