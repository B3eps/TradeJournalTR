/**
 * Finans: personal bookkeeping (accounts, categories, transactions, envelope-style
 * monthly budgets, recurring items, manual FX rates, CSV import/export).
 *
 * Tables are created lazily (CREATE TABLE IF NOT EXISTS) the first time a user
 * touches the feature. All rows are user-scoped. Money is stored as REAL rounded
 * to 2 decimals (r2) everywhere; amounts in transactions are always positive and
 * the sign comes from `kind` (gider / gelir / transfer + direction).
 *
 * Original implementation; no third-party budgeting code is used.
 */
import type { Db } from './connection';
import { generateId } from '../utils/id';
import { ApiError, foldText, isValidDate, localDate } from './tasks';

const bad = (msg: string) => new ApiError(400, msg);

// ─── Constants ───────────────────────────────────────────────────────────────

export const ACCOUNT_TYPES = ['nakit', 'banka', 'trade', 'birikim', 'kredi kartı'] as const;
export const CURRENCIES = ['TRY', 'USD', 'EUR'] as const;
export const SYSTEM_CATEGORY = 'Trade para yatırma/çekme';
const MAX_AMOUNT = 1e12;

const DEFAULT_EXPENSE: Array<[string, string, string]> = [
  ['Gıda', '#f59e0b', '🛒'],
  ['Ulaşım', '#3b82f6', '🚌'],
  ['Fatura', '#ef4444', '🧾'],
  ['Eğitim', '#8b5cf6', '🎓'],
  ['Eğlence', '#ec4899', '🎮'],
  ['Sağlık', '#10b981', '💊'],
  ['Alışveriş', '#06b6d4', '🛍️'],
  ['Abonelik', '#f97316', '🔁'],
  ['Diğer', '#64748b', '📦'],
];
const DEFAULT_INCOME: Array<[string, string, string]> = [
  ['Burs/Harçlık', '#22c55e', '🎒'],
  ['Maaş', '#16a34a', '💼'],
  ['Trade kazancı', '#14b8a6', '📈'],
  ['Diğer', '#64748b', '📦'],
];

const DDL = `
CREATE TABLE IF NOT EXISTS fin_accounts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'TRY',
  opening_balance REAL NOT NULL DEFAULT 0,
  color           TEXT NOT NULL DEFAULT '#3b82f6',
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_accounts_user ON fin_accounts(user_id);
CREATE TABLE IF NOT EXISTS fin_categories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#64748b',
  icon       TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  system     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_categories_user ON fin_categories(user_id, kind);
CREATE TABLE IF NOT EXISTS fin_transactions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  account_id          TEXT NOT NULL,
  date                TEXT NOT NULL,
  amount              REAL NOT NULL,
  kind                TEXT NOT NULL,
  category_id         TEXT,
  payee               TEXT NOT NULL DEFAULT '',
  note                TEXT NOT NULL DEFAULT '',
  transfer_account_id TEXT,
  direction           TEXT,
  transfer_group      TEXT,
  recurring_id        TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_tx_user_date ON fin_transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_fin_tx_user_account ON fin_transactions(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_group ON fin_transactions(transfer_group);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_tx_recurring ON fin_transactions(recurring_id, date) WHERE recurring_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS fin_budgets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  month        TEXT NOT NULL,
  category_id  TEXT NOT NULL,
  limit_amount REAL NOT NULL,
  UNIQUE (user_id, month, category_id)
);
CREATE TABLE IF NOT EXISTS fin_recurring (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  amount      REAL NOT NULL,
  account_id  TEXT NOT NULL,
  category_id TEXT,
  every       TEXT NOT NULL,
  day         INTEGER NOT NULL,
  next_date   TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_fin_recurring_user ON fin_recurring(user_id, active, next_date);
CREATE TABLE IF NOT EXISTS fin_rates (
  user_id    TEXT NOT NULL,
  currency   TEXT NOT NULL,
  to_try     REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, currency)
);
CREATE TABLE IF NOT EXISTS fin_meta (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);
`;

const ready = new WeakSet<Db>();
const seededFor = new WeakMap<Db, Set<string>>();

/** Creates the tables (once per connection) and seeds default categories (once per user). */
export function ensureFinance(db: Db, userId: string): void {
  if (!ready.has(db)) {
    db.exec(DDL);
    ready.add(db);
    seededFor.set(db, new Set());
  }
  const seen = seededFor.get(db)!;
  if (seen.has(userId)) return;
  const seeded = db.prepare("SELECT value FROM fin_meta WHERE user_id = ? AND key = 'seeded'").get(userId);
  if (!seeded) {
    const now = new Date().toISOString();
    const ins = db.prepare(
      'INSERT INTO fin_categories (id, user_id, name, kind, color, icon, archived, system, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
    );
    db.transaction(() => {
      for (const [n, c, i] of DEFAULT_EXPENSE) ins.run(generateId(), userId, n, 'gider', c, i, 0, now);
      for (const [n, c, i] of DEFAULT_INCOME) ins.run(generateId(), userId, n, 'gelir', c, i, 0, now);
      ins.run(generateId(), userId, SYSTEM_CATEGORY, 'gider', '#0ea5e9', '🏦', 1, now);
      ins.run(generateId(), userId, SYSTEM_CATEGORY, 'gelir', '#0ea5e9', '🏦', 1, now);
      db.prepare("INSERT OR REPLACE INTO fin_meta (user_id, key, value) VALUES (?, 'seeded', ?)").run(userId, now);
    })();
  }
  seen.add(userId);
}

// ─── Validators / helpers ────────────────────────────────────────────────────

export const r2 = (n: number) => Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const isNullish = (v: unknown) => v === undefined || v === null || v === '';

function reqString(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${field} zorunludur.`);
  const s = v.trim();
  if (s.length > max) throw bad(`${field} en fazla ${max} karakter olabilir.`);
  return s;
}
function optString(v: unknown, field: string, max: number): string {
  if (isNullish(v)) return '';
  if (typeof v !== 'string') throw bad(`${field} metin olmalı.`);
  const s = v.trim();
  if (s.length > max) throw bad(`${field} en fazla ${max} karakter olabilir.`);
  return s;
}
function optColor(v: unknown, fallback: string): string {
  if (isNullish(v)) return fallback;
  if (typeof v !== 'string' || !HEX.test(v)) throw bad('Renk #RRGGBB biçiminde olmalı.');
  return v;
}
function amountOf(v: unknown, field = 'Tutar'): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${field} sayı olmalı.`);
  const x = r2(n);
  if (!(x > 0)) throw bad(`${field} sıfırdan büyük olmalı.`);
  if (x > MAX_AMOUNT) throw bad(`${field} çok büyük.`);
  return x;
}
function moneyOf(v: unknown, field: string): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${field} sayı olmalı.`);
  if (Math.abs(n) > MAX_AMOUNT) throw bad(`${field} çok büyük.`);
  return r2(n);
}
function dateOf(v: unknown, field = 'Tarih'): string {
  if (!isValidDate(v)) throw bad(`${field} YYYY-AA-GG biçiminde geçerli bir tarih olmalı.`);
  if (v < '1970-01-01' || v > '2100-12-31') throw bad(`${field} 1970-2100 arasında olmalı.`);
  return v;
}
export function monthOf(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw bad('Ay YYYY-AA biçiminde olmalı.');
  return v;
}
function currencyOf(v: unknown): string {
  if (typeof v !== 'string' || !(CURRENCIES as readonly string[]).includes(v)) throw bad('Para birimi TRY, USD veya EUR olmalı.');
  return v;
}
function boolInt(v: unknown, field: string): number {
  if (v === true || v === 1 || v === '1') return 1;
  if (v === false || v === 0 || v === '0') return 0;
  throw bad(`${field} true/false olmalı.`);
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthStart = (ym: string) => `${ym}-01`;
const monthEnd = (ym: string) => `${ym}-31`;
export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// ─── Rates ───────────────────────────────────────────────────────────────────

export interface RateAPI { currency: string; toTry: number; updatedAt: string | null }

export function getRates(db: Db, userId: string): RateAPI[] {
  ensureFinance(db, userId);
  const rows = db.prepare('SELECT currency, to_try, updated_at FROM fin_rates WHERE user_id = ?').all(userId) as any[];
  const by = new Map(rows.map((r) => [r.currency as string, r]));
  return CURRENCIES.map((c) => {
    if (c === 'TRY') return { currency: 'TRY', toTry: 1, updatedAt: null };
    const r = by.get(c);
    return { currency: c, toTry: r ? r.to_try : 0, updatedAt: r ? r.updated_at : null };
  });
}

export function setRates(db: Db, userId: string, body: Record<string, unknown>): RateAPI[] {
  ensureFinance(db, userId);
  const entries: Array<[string, unknown]> = [];
  if (body.rates && typeof body.rates === 'object' && !Array.isArray(body.rates)) {
    for (const [k, v] of Object.entries(body.rates as Record<string, unknown>)) entries.push([k, v]);
  } else if (body.currency !== undefined) {
    entries.push([String(body.currency), body.toTry]);
  } else {
    throw bad('Kur bilgisi gerekli: { rates: { USD: 34.5 } }.');
  }
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const [cur, val] of entries) {
      const c = currencyOf(cur);
      if (c === 'TRY') continue;
      const n = typeof val === 'string' ? Number(val.replace(',', '.')) : val;
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1e6) throw bad(`${c} kuru sıfırdan büyük bir sayı olmalı.`);
      db.prepare(
        'INSERT INTO fin_rates (user_id, currency, to_try, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, currency) DO UPDATE SET to_try = excluded.to_try, updated_at = excluded.updated_at',
      ).run(userId, c, Math.round(n * 1e6) / 1e6, now);
    }
  })();
  return getRates(db, userId);
}

function rateMap(db: Db, userId: string): Record<string, number> {
  const m: Record<string, number> = { TRY: 1 };
  for (const r of getRates(db, userId)) if (r.toTry > 0) m[r.currency] = r.toTry;
  return m;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export interface AccountAPI {
  id: string; name: string; type: string; currency: string; openingBalance: number; color: string;
  archived: boolean; createdAt: string; balance: number; balanceTRY: number | null; txCount: number;
}

function balances(db: Db, userId: string): Map<string, { sum: number; n: number }> {
  const rows = db.prepare(
    `SELECT account_id AS id, COUNT(*) AS n,
       SUM(CASE kind WHEN 'gelir' THEN amount WHEN 'gider' THEN -amount
             WHEN 'transfer' THEN (CASE direction WHEN 'in' THEN amount ELSE -amount END) ELSE 0 END) AS s
     FROM fin_transactions WHERE user_id = ? GROUP BY account_id`,
  ).all(userId) as any[];
  return new Map(rows.map((r) => [r.id, { sum: r.s || 0, n: r.n }]));
}

function mapAccount(row: any, bal: Map<string, { sum: number; n: number }>, rates: Record<string, number>): AccountAPI {
  const b = bal.get(row.id);
  const balance = r2(row.opening_balance + (b ? b.sum : 0));
  const rate = rates[row.currency];
  return {
    id: row.id, name: row.name, type: row.type, currency: row.currency, openingBalance: row.opening_balance,
    color: row.color, archived: !!row.archived, createdAt: row.created_at, balance,
    balanceTRY: rate ? r2(balance * rate) : null, txCount: b ? b.n : 0,
  };
}

export function listAccounts(db: Db, userId: string, includeArchived = false): AccountAPI[] {
  ensureFinance(db, userId);
  const rows = db.prepare(
    `SELECT * FROM fin_accounts WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'} ORDER BY archived, created_at, rowid`,
  ).all(userId);
  const bal = balances(db, userId);
  const rates = rateMap(db, userId);
  return rows.map((r) => mapAccount(r, bal, rates));
}

export function getAccount(db: Db, userId: string, id: string): AccountAPI | null {
  ensureFinance(db, userId);
  const row = db.prepare('SELECT * FROM fin_accounts WHERE id = ? AND user_id = ?').get(id, userId);
  return row ? mapAccount(row, balances(db, userId), rateMap(db, userId)) : null;
}

export function createAccount(db: Db, userId: string, body: Record<string, unknown>): AccountAPI {
  ensureFinance(db, userId);
  const name = reqString(body.name, 'Hesap adı', 60);
  const type = String(body.type ?? 'banka');
  if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) throw bad('Hesap türü geçersiz.');
  const currency = isNullish(body.currency) ? 'TRY' : currencyOf(body.currency);
  const opening = isNullish(body.openingBalance) ? 0 : moneyOf(body.openingBalance, 'Açılış bakiyesi');
  const color = optColor(body.color, '#3b82f6');
  const count = (db.prepare('SELECT COUNT(*) AS n FROM fin_accounts WHERE user_id = ?').get(userId) as any).n;
  if (count >= 50) throw bad('En fazla 50 hesap açılabilir.');
  const id = generateId();
  db.prepare(
    'INSERT INTO fin_accounts (id, user_id, name, type, currency, opening_balance, color, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
  ).run(id, userId, name, type, currency, opening, color, new Date().toISOString());
  return getAccount(db, userId, id)!;
}

export function updateAccount(db: Db, userId: string, id: string, body: Record<string, unknown>): AccountAPI | null {
  const cur = getAccount(db, userId, id);
  if (!cur) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(reqString(body.name, 'Hesap adı', 60)); }
  if (body.type !== undefined) {
    if (!(ACCOUNT_TYPES as readonly string[]).includes(String(body.type))) throw bad('Hesap türü geçersiz.');
    sets.push('type = ?'); vals.push(String(body.type));
  }
  if (body.currency !== undefined) {
    const c = currencyOf(body.currency);
    if (c !== cur.currency && cur.txCount > 0) throw new ApiError(409, 'İşlemi olan hesabın para birimi değiştirilemez.');
    sets.push('currency = ?'); vals.push(c);
  }
  if (body.openingBalance !== undefined) { sets.push('opening_balance = ?'); vals.push(moneyOf(body.openingBalance, 'Açılış bakiyesi')); }
  if (body.color !== undefined) { sets.push('color = ?'); vals.push(optColor(body.color, '#3b82f6')); }
  if (body.archived !== undefined) { sets.push('archived = ?'); vals.push(boolInt(body.archived, 'archived')); }
  if (sets.length) db.prepare(`UPDATE fin_accounts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
  return getAccount(db, userId, id);
}

/** Deletes an account. With transactions present it requires force (which removes them and their transfer counterparts). */
export function deleteAccount(db: Db, userId: string, id: string, force: boolean): boolean {
  const cur = getAccount(db, userId, id);
  if (!cur) return false;
  if (cur.txCount > 0 && !force) {
    throw new ApiError(409, 'Bu hesapta işlemler var. Önce arşivleyin ya da işlemlerle birlikte silmeyi onaylayın.');
  }
  db.transaction(() => {
    const groups = db.prepare('SELECT DISTINCT transfer_group AS g FROM fin_transactions WHERE user_id = ? AND account_id = ? AND transfer_group IS NOT NULL').all(userId, id) as any[];
    for (const g of groups) db.prepare('DELETE FROM fin_transactions WHERE user_id = ? AND transfer_group = ?').run(userId, g.g);
    db.prepare('DELETE FROM fin_transactions WHERE user_id = ? AND account_id = ?').run(userId, id);
    db.prepare('DELETE FROM fin_recurring WHERE user_id = ? AND account_id = ?').run(userId, id);
    db.prepare('DELETE FROM fin_accounts WHERE id = ? AND user_id = ?').run(id, userId);
  })();
  return true;
}

// ─── Categories ──────────────────────────────────────────────────────────────

export interface CategoryAPI { id: string; name: string; kind: string; color: string; icon: string | null; archived: boolean; system: boolean }

const mapCategory = (r: any): CategoryAPI => ({
  id: r.id, name: r.name, kind: r.kind, color: r.color, icon: r.icon ?? null, archived: !!r.archived, system: !!r.system,
});

export function listCategories(db: Db, userId: string, includeArchived = false): CategoryAPI[] {
  ensureFinance(db, userId);
  return (db.prepare(
    `SELECT * FROM fin_categories WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'} ORDER BY kind DESC, system, created_at, rowid`,
  ).all(userId) as any[]).map(mapCategory);
}

function getCategoryRow(db: Db, userId: string, id: string): any | null {
  return db.prepare('SELECT * FROM fin_categories WHERE id = ? AND user_id = ?').get(id, userId) || null;
}

function categoryNameTaken(db: Db, userId: string, kind: string, name: string, exceptId?: string): boolean {
  const rows = db.prepare('SELECT id, name FROM fin_categories WHERE user_id = ? AND kind = ? AND archived = 0').all(userId, kind) as any[];
  const f = foldText(name);
  return rows.some((r) => r.id !== exceptId && foldText(r.name) === f);
}

export function createCategory(db: Db, userId: string, body: Record<string, unknown>): CategoryAPI {
  ensureFinance(db, userId);
  const name = reqString(body.name, 'Kategori adı', 40);
  const kind = body.kind === 'gelir' ? 'gelir' : body.kind === 'gider' ? 'gider' : null;
  if (!kind) throw bad("Kategori türü 'gider' veya 'gelir' olmalı.");
  if (categoryNameTaken(db, userId, kind, name)) throw new ApiError(409, 'Bu isimde bir kategori zaten var.');
  const color = optColor(body.color, '#64748b');
  const icon = optString(body.icon, 'İkon', 8) || null;
  const id = generateId();
  db.prepare('INSERT INTO fin_categories (id, user_id, name, kind, color, icon, archived, system, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)')
    .run(id, userId, name, kind, color, icon, new Date().toISOString());
  return mapCategory(getCategoryRow(db, userId, id));
}

export function updateCategory(db: Db, userId: string, id: string, body: Record<string, unknown>): CategoryAPI | null {
  ensureFinance(db, userId);
  const cur = getCategoryRow(db, userId, id);
  if (!cur) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) {
    if (cur.system) throw new ApiError(409, 'Sistem kategorisi düzenlenemez.');
    const name = reqString(body.name, 'Kategori adı', 40);
    if (categoryNameTaken(db, userId, cur.kind, name, id)) throw new ApiError(409, 'Bu isimde bir kategori zaten var.');
    sets.push('name = ?'); vals.push(name);
  }
  if (body.color !== undefined) { sets.push('color = ?'); vals.push(optColor(body.color, '#64748b')); }
  if (body.icon !== undefined) { sets.push('icon = ?'); vals.push(optString(body.icon, 'İkon', 8) || null); }
  if (body.archived !== undefined) { sets.push('archived = ?'); vals.push(boolInt(body.archived, 'archived')); }
  if (sets.length) db.prepare(`UPDATE fin_categories SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
  return mapCategory(getCategoryRow(db, userId, id));
}

/** Unused categories are deleted; used ones are archived (history stays intact). */
export function deleteCategory(db: Db, userId: string, id: string): { deleted: boolean; archived: boolean } | null {
  ensureFinance(db, userId);
  const cur = getCategoryRow(db, userId, id);
  if (!cur) return null;
  if (cur.system) throw new ApiError(409, 'Sistem kategorisi silinemez.');
  const used = (db.prepare('SELECT COUNT(*) AS n FROM fin_transactions WHERE user_id = ? AND category_id = ?').get(userId, id) as any).n
    + (db.prepare('SELECT COUNT(*) AS n FROM fin_recurring WHERE user_id = ? AND category_id = ?').get(userId, id) as any).n;
  db.prepare('DELETE FROM fin_budgets WHERE user_id = ? AND category_id = ?').run(userId, id);
  if (used > 0) {
    db.prepare('UPDATE fin_categories SET archived = 1 WHERE id = ? AND user_id = ?').run(id, userId);
    return { deleted: false, archived: true };
  }
  db.prepare('DELETE FROM fin_categories WHERE id = ? AND user_id = ?').run(id, userId);
  return { deleted: true, archived: false };
}

// ─── Transactions ────────────────────────────────────────────────────────────

export interface TxAPI {
  id: string; accountId: string; accountName: string; accountCurrency: string; date: string; amount: number; kind: string;
  categoryId: string | null; categoryName: string | null; categoryColor: string | null; categoryIcon: string | null;
  payee: string; note: string; transferAccountId: string | null; transferAccountName: string | null;
  direction: string | null; transferGroup: string | null; toAmount: number | null; recurringId: string | null; createdAt: string;
}

const TX_SELECT = `
SELECT t.*, a.name AS account_name, a.currency AS account_currency, c.name AS cat_name, c.color AS cat_color, c.icon AS cat_icon,
       ta.name AS transfer_name, p.amount AS pair_amount
FROM fin_transactions t
JOIN fin_accounts a ON a.id = t.account_id
LEFT JOIN fin_categories c ON c.id = t.category_id
LEFT JOIN fin_accounts ta ON ta.id = t.transfer_account_id
LEFT JOIN fin_transactions p ON p.transfer_group = t.transfer_group AND p.id <> t.id AND t.transfer_group IS NOT NULL`;

const mapTx = (r: any): TxAPI => ({
  id: r.id, accountId: r.account_id, accountName: r.account_name, accountCurrency: r.account_currency, date: r.date,
  amount: r.amount, kind: r.kind, categoryId: r.category_id ?? null, categoryName: r.cat_name ?? null,
  categoryColor: r.cat_color ?? null, categoryIcon: r.cat_icon ?? null, payee: r.payee, note: r.note,
  transferAccountId: r.transfer_account_id ?? null, transferAccountName: r.transfer_name ?? null,
  direction: r.direction ?? null, transferGroup: r.transfer_group ?? null,
  toAmount: r.pair_amount ?? null, recurringId: r.recurring_id ?? null, createdAt: r.created_at,
});

export function getTransaction(db: Db, userId: string, id: string): TxAPI | null {
  ensureFinance(db, userId);
  const row = db.prepare(`${TX_SELECT} WHERE t.id = ? AND t.user_id = ?`).get(id, userId);
  return row ? mapTx(row) : null;
}

export interface TxQuery { month?: string; accountId?: string; categoryId?: string; q?: string; limit?: string; offset?: string; kind?: string }

export function listTransactions(db: Db, userId: string, q: TxQuery): { transactions: TxAPI[]; total: number; limit: number; offset: number } {
  ensureFinance(db, userId);
  const where: string[] = ['t.user_id = ?'];
  const args: unknown[] = [userId];
  if (q.month) {
    const m = monthOf(q.month);
    where.push('t.date >= ? AND t.date <= ?'); args.push(monthStart(m), monthEnd(m));
  }
  if (q.accountId) { where.push('t.account_id = ?'); args.push(q.accountId); }
  else where.push("(t.kind <> 'transfer' OR t.direction = 'out')");
  if (q.categoryId) { where.push('t.category_id = ?'); args.push(q.categoryId); }
  if (q.kind === 'gider' || q.kind === 'gelir' || q.kind === 'transfer') { where.push('t.kind = ?'); args.push(q.kind); }
  const text = (q.q || '').trim();
  const rows = db.prepare(`${TX_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.created_at DESC, t.rowid DESC`).all(...args) as any[];
  let filtered = rows;
  if (text) {
    const f = foldText(text);
    filtered = rows.filter((r) => foldText(`${r.payee} ${r.note} ${r.cat_name ?? ''} ${r.account_name}`).includes(f)
      || String(r.amount).includes(text.replace(',', '.')));
  }
  const limit = Math.min(500, Math.max(1, parseInt(q.limit || '100', 10) || 100));
  const offset = Math.max(0, parseInt(q.offset || '0', 10) || 0);
  return { transactions: filtered.slice(offset, offset + limit).map(mapTx), total: filtered.length, limit, offset };
}

function requireAccount(db: Db, userId: string, id: unknown, field = 'Hesap'): any {
  if (typeof id !== 'string' || !id) throw bad(`${field} seçilmeli.`);
  const row = db.prepare('SELECT * FROM fin_accounts WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!row) throw bad(`${field} bulunamadı.`);
  return row;
}

function checkCategory(db: Db, userId: string, categoryId: unknown, kind: string): string | null {
  if (isNullish(categoryId)) return null;
  if (typeof categoryId !== 'string') throw bad('Kategori geçersiz.');
  const c = getCategoryRow(db, userId, categoryId);
  if (!c) throw bad('Kategori bulunamadı.');
  if (c.kind !== kind) throw bad(`Bu kategori ${kind} işlemleri için değil.`);
  return c.id;
}

/** Converts between account currencies using manual rates. */
function convert(db: Db, userId: string, amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const rates = rateMap(db, userId);
  if (!rates[from] || !rates[to]) throw bad('Farklı para birimleri arasındaki transfer için kur girin ya da hedef tutarı belirtin.');
  return r2((amount * rates[from]) / rates[to]);
}

function insertTransfer(
  db: Db, userId: string, group: string, date: string, fromAcc: any, toAcc: any, amount: number, toAmount: number,
  payee: string, note: string, createdAt: string,
): string {
  const ins = db.prepare(
    `INSERT INTO fin_transactions (id, user_id, account_id, date, amount, kind, category_id, payee, note, transfer_account_id, direction, transfer_group, recurring_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'transfer', NULL, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  const outId = generateId();
  ins.run(outId, userId, fromAcc.id, date, amount, payee, note, toAcc.id, 'out', group, createdAt);
  ins.run(generateId(), userId, toAcc.id, date, toAmount, payee, note, fromAcc.id, 'in', group, createdAt);
  return outId;
}

export function createTransaction(db: Db, userId: string, body: Record<string, unknown>): TxAPI {
  ensureFinance(db, userId);
  const kind = String(body.kind ?? '');
  if (!['gider', 'gelir', 'transfer'].includes(kind)) throw bad("İşlem türü 'gider', 'gelir' veya 'transfer' olmalı.");
  const amount = amountOf(body.amount);
  const date = dateOf(body.date);
  const acc = requireAccount(db, userId, body.accountId);
  const payee = optString(body.payee, 'Alıcı/Açıklama', 120);
  const note = optString(body.note, 'Not', 500);
  const now = new Date().toISOString();

  if (kind === 'transfer') {
    const to = requireAccount(db, userId, body.transferAccountId, 'Hedef hesap');
    if (to.id === acc.id) throw bad('Kaynak ve hedef hesap farklı olmalı.');
    const toAmount = isNullish(body.toAmount) ? convert(db, userId, amount, acc.currency, to.currency) : amountOf(body.toAmount, 'Hedef tutar');
    const id = db.transaction(() => insertTransfer(db, userId, generateId(), date, acc, to, amount, toAmount, payee, note, now))();
    return getTransaction(db, userId, id)!;
  }
  const categoryId = checkCategory(db, userId, body.categoryId, kind);
  const id = generateId();
  db.prepare(
    `INSERT INTO fin_transactions (id, user_id, account_id, date, amount, kind, category_id, payee, note, transfer_account_id, direction, transfer_group, recurring_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run(id, userId, acc.id, date, amount, kind, categoryId, payee, note, now);
  return getTransaction(db, userId, id)!;
}

export function updateTransaction(db: Db, userId: string, id: string, body: Record<string, unknown>): TxAPI | null {
  const cur = getTransaction(db, userId, id);
  if (!cur) return null;
  if (body.kind !== undefined && body.kind !== cur.kind) throw bad('İşlem türü değiştirilemez; silip yeniden ekleyin.');

  if (cur.kind === 'transfer') {
    const rows = db.prepare('SELECT * FROM fin_transactions WHERE user_id = ? AND transfer_group = ?').all(userId, cur.transferGroup) as any[];
    const out = rows.find((r) => r.direction === 'out');
    const inn = rows.find((r) => r.direction === 'in');
    if (!out || !inn) throw new ApiError(409, 'Transferin karşı kaydı bulunamadı.');
    const fromAcc = requireAccount(db, userId, body.accountId !== undefined ? body.accountId : out.account_id);
    const toAcc = requireAccount(db, userId, body.transferAccountId !== undefined ? body.transferAccountId : inn.account_id, 'Hedef hesap');
    if (fromAcc.id === toAcc.id) throw bad('Kaynak ve hedef hesap farklı olmalı.');
    const amount = body.amount !== undefined ? amountOf(body.amount) : out.amount;
    const date = body.date !== undefined ? dateOf(body.date) : out.date;
    const payee = body.payee !== undefined ? optString(body.payee, 'Alıcı/Açıklama', 120) : out.payee;
    const note = body.note !== undefined ? optString(body.note, 'Not', 500) : out.note;
    let toAmount = inn.amount;
    if (!isNullish(body.toAmount)) toAmount = amountOf(body.toAmount, 'Hedef tutar');
    else if (body.amount !== undefined || body.accountId !== undefined || body.transferAccountId !== undefined) {
      toAmount = convert(db, userId, amount, fromAcc.currency, toAcc.currency);
    }
    db.transaction(() => {
      const up = db.prepare('UPDATE fin_transactions SET account_id = ?, transfer_account_id = ?, amount = ?, date = ?, payee = ?, note = ? WHERE id = ? AND user_id = ?');
      up.run(fromAcc.id, toAcc.id, amount, date, payee, note, out.id, userId);
      up.run(toAcc.id, fromAcc.id, toAmount, date, payee, note, inn.id, userId);
    })();
    return getTransaction(db, userId, out.id);
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.accountId !== undefined) { sets.push('account_id = ?'); vals.push(requireAccount(db, userId, body.accountId).id); }
  if (body.amount !== undefined) { sets.push('amount = ?'); vals.push(amountOf(body.amount)); }
  if (body.date !== undefined) { sets.push('date = ?'); vals.push(dateOf(body.date)); }
  if (body.payee !== undefined) { sets.push('payee = ?'); vals.push(optString(body.payee, 'Alıcı/Açıklama', 120)); }
  if (body.note !== undefined) { sets.push('note = ?'); vals.push(optString(body.note, 'Not', 500)); }
  if (body.categoryId !== undefined) { sets.push('category_id = ?'); vals.push(checkCategory(db, userId, body.categoryId, cur.kind)); }
  if (sets.length) db.prepare(`UPDATE fin_transactions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
  return getTransaction(db, userId, id);
}

/** Deletes a transaction (a transfer is removed together with its pair). Returns the removed visible row. */
export function deleteTransaction(db: Db, userId: string, id: string): TxAPI | null {
  const cur = getTransaction(db, userId, id);
  if (!cur) return null;
  db.transaction(() => {
    if (cur.transferGroup) db.prepare('DELETE FROM fin_transactions WHERE user_id = ? AND transfer_group = ?').run(userId, cur.transferGroup);
    else db.prepare('DELETE FROM fin_transactions WHERE id = ? AND user_id = ?').run(id, userId);
  })();
  return cur;
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export interface BudgetAPI {
  categoryId: string; name: string; color: string; icon: string | null; month: string; limit: number; spent: number; remaining: number;
}

/** Expense per category for a month, in TRY. Excludes transfers. */
function spentByCategory(db: Db, userId: string, month: string, rates: Record<string, number>): Map<string, number> {
  const rows = db.prepare(
    `SELECT t.category_id AS cid, a.currency AS cur, SUM(t.amount) AS s
     FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id
     WHERE t.user_id = ? AND t.kind = 'gider' AND t.date >= ? AND t.date <= ? AND t.category_id IS NOT NULL
     GROUP BY t.category_id, a.currency`,
  ).all(userId, monthStart(month), monthEnd(month)) as any[];
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.cid, (m.get(r.cid) || 0) + (r.s || 0) * (rates[r.cur] || 0));
  return m;
}

export function listBudgets(db: Db, userId: string, monthIn: unknown): BudgetAPI[] {
  ensureFinance(db, userId);
  const month = monthOf(monthIn);
  const rates = rateMap(db, userId);
  const spent = spentByCategory(db, userId, month, rates);
  const rows = db.prepare(
    `SELECT b.category_id AS cid, b.limit_amount AS lim, c.name, c.color, c.icon
     FROM fin_budgets b JOIN fin_categories c ON c.id = b.category_id
     WHERE b.user_id = ? AND b.month = ? ORDER BY c.created_at, c.rowid`,
  ).all(userId, month) as any[];
  return rows.map((r) => {
    const s = r2(spent.get(r.cid) || 0);
    return { categoryId: r.cid, name: r.name, color: r.color, icon: r.icon ?? null, month, limit: r.lim, spent: s, remaining: r2(r.lim - s) };
  });
}

export function setBudget(db: Db, userId: string, body: Record<string, unknown>): BudgetAPI[] {
  ensureFinance(db, userId);
  const month = monthOf(body.month);
  if (typeof body.categoryId !== 'string') throw bad('Kategori seçilmeli.');
  const cat = getCategoryRow(db, userId, body.categoryId);
  if (!cat || cat.kind !== 'gider') throw bad('Bütçe yalnızca gider kategorileri için tanımlanabilir.');
  const raw = body.limit;
  if (raw === null || raw === 0 || raw === '0' || raw === '') {
    db.prepare('DELETE FROM fin_budgets WHERE user_id = ? AND month = ? AND category_id = ?').run(userId, month, cat.id);
  } else {
    const limit = amountOf(raw, 'Limit');
    db.prepare(
      `INSERT INTO fin_budgets (id, user_id, month, category_id, limit_amount) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, month, category_id) DO UPDATE SET limit_amount = excluded.limit_amount`,
    ).run(generateId(), userId, month, cat.id, limit);
  }
  return listBudgets(db, userId, month);
}

/** Copies the previous month's limits into `to` for categories that have no limit there yet. */
export function copyBudgets(db: Db, userId: string, body: Record<string, unknown>): { copied: number; budgets: BudgetAPI[] } {
  ensureFinance(db, userId);
  const to = monthOf(body.to ?? body.month);
  const from = isNullish(body.from) ? addMonths(to, -1) : monthOf(body.from);
  if (from === to) throw bad('Kaynak ve hedef ay farklı olmalı.');
  const src = db.prepare(
    `SELECT b.category_id AS cid, b.limit_amount AS lim FROM fin_budgets b JOIN fin_categories c ON c.id = b.category_id
     WHERE b.user_id = ? AND b.month = ? AND c.archived = 0`,
  ).all(userId, from) as any[];
  let copied = 0;
  db.transaction(() => {
    for (const s of src) {
      const res = db.prepare('INSERT OR IGNORE INTO fin_budgets (id, user_id, month, category_id, limit_amount) VALUES (?, ?, ?, ?, ?)')
        .run(generateId(), userId, to, s.cid, s.lim);
      copied += res.changes;
    }
  })();
  return { copied, budgets: listBudgets(db, userId, to) };
}

// ─── Recurring ───────────────────────────────────────────────────────────────

export interface RecurringAPI {
  id: string; name: string; kind: string; amount: number; accountId: string; accountName: string | null;
  categoryId: string | null; categoryName: string | null; every: string; day: number; nextDate: string; active: boolean;
}

const mapRecurring = (r: any): RecurringAPI => ({
  id: r.id, name: r.name, kind: r.kind, amount: r.amount, accountId: r.account_id, accountName: r.account_name ?? null,
  categoryId: r.category_id ?? null, categoryName: r.cat_name ?? null, every: r.every, day: r.day, nextDate: r.next_date, active: !!r.active,
});

const REC_SELECT = `SELECT r.*, a.name AS account_name, c.name AS cat_name FROM fin_recurring r
  LEFT JOIN fin_accounts a ON a.id = r.account_id LEFT JOIN fin_categories c ON c.id = r.category_id`;

/** First occurrence on or after `from` (monthly: day-of-month clamped; weekly: 0=Pazar..6=Cumartesi). */
export function occurrenceOnOrAfter(every: string, day: number, from: string): string {
  if (every === 'weekly') {
    const [y, m, d] = from.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return addDays(from, (day - dow + 7) % 7);
  }
  const [y, m] = from.split('-').map(Number);
  const cand = `${y}-${pad(m)}-${pad(Math.min(day, daysIn(y, m)))}`;
  if (cand >= from) return cand;
  const nm = addMonths(`${y}-${pad(m)}`, 1);
  const [ny, nmm] = nm.split('-').map(Number);
  return `${nm}-${pad(Math.min(day, daysIn(ny, nmm)))}`;
}

export function listRecurring(db: Db, userId: string): RecurringAPI[] {
  ensureFinance(db, userId);
  return (db.prepare(`${REC_SELECT} WHERE r.user_id = ? ORDER BY r.active DESC, r.next_date, r.rowid`).all(userId) as any[]).map(mapRecurring);
}

function getRecurring(db: Db, userId: string, id: string): RecurringAPI | null {
  const row = db.prepare(`${REC_SELECT} WHERE r.id = ? AND r.user_id = ?`).get(id, userId);
  return row ? mapRecurring(row) : null;
}

function recDay(every: string, v: unknown): number {
  const n = Number(v);
  if (every === 'weekly') {
    if (!Number.isInteger(n) || n < 0 || n > 6) throw bad('Haftalık tekrar için gün 0 (Pazar) ile 6 (Cumartesi) arasında olmalı.');
  } else if (!Number.isInteger(n) || n < 1 || n > 31) throw bad('Aylık tekrar için gün 1-31 arasında olmalı.');
  return n;
}

function everyOf(v: unknown): 'monthly' | 'weekly' {
  if (v === 'weekly' || v === 'monthly') return v;
  throw bad("Tekrar 'monthly' veya 'weekly' olmalı.");
}

export function createRecurring(db: Db, userId: string, body: Record<string, unknown>): RecurringAPI {
  ensureFinance(db, userId);
  const name = reqString(body.name, 'Ad', 80);
  const kind = body.kind === 'gelir' ? 'gelir' : body.kind === 'gider' ? 'gider' : null;
  if (!kind) throw bad("Tür 'gider' veya 'gelir' olmalı.");
  const amount = amountOf(body.amount);
  const acc = requireAccount(db, userId, body.accountId);
  const categoryId = checkCategory(db, userId, body.categoryId, kind);
  const every = everyOf(body.every);
  const startRaw = body.startDate ?? body.nextDate;
  const startDate = isNullish(startRaw) ? localDate(new Date()) : dateOf(startRaw, 'Başlangıç tarihi');
  const day = isNullish(body.day)
    ? (every === 'weekly' ? new Date(`${startDate}T00:00:00Z`).getUTCDay() : Number(startDate.slice(8, 10)))
    : recDay(every, body.day);
  const nextDate = occurrenceOnOrAfter(every, day, startDate);
  const id = generateId();
  db.prepare('INSERT INTO fin_recurring (id, user_id, name, kind, amount, account_id, category_id, every, day, next_date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
    .run(id, userId, name, kind, amount, acc.id, categoryId, every, day, nextDate);
  return getRecurring(db, userId, id)!;
}

export function updateRecurring(db: Db, userId: string, id: string, body: Record<string, unknown>): RecurringAPI | null {
  ensureFinance(db, userId);
  const cur = getRecurring(db, userId, id);
  if (!cur) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(reqString(body.name, 'Ad', 80)); }
  if (body.amount !== undefined) { sets.push('amount = ?'); vals.push(amountOf(body.amount)); }
  if (body.accountId !== undefined) { sets.push('account_id = ?'); vals.push(requireAccount(db, userId, body.accountId).id); }
  if (body.categoryId !== undefined) { sets.push('category_id = ?'); vals.push(checkCategory(db, userId, body.categoryId, cur.kind)); }
  if (body.active !== undefined) { sets.push('active = ?'); vals.push(boolInt(body.active, 'active')); }
  if (body.every !== undefined || body.day !== undefined || body.nextDate !== undefined) {
    const every = body.every !== undefined ? everyOf(body.every) : (cur.every as 'monthly' | 'weekly');
    const day = body.day !== undefined ? recDay(every, body.day) : (every === cur.every ? cur.day : (every === 'weekly' ? 1 : 1));
    const from = body.nextDate !== undefined ? dateOf(body.nextDate, 'Sonraki tarih') : localDate(new Date());
    sets.push('every = ?', 'day = ?', 'next_date = ?');
    vals.push(every, day, occurrenceOnOrAfter(every, day, from));
  }
  if (sets.length) db.prepare(`UPDATE fin_recurring SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
  return getRecurring(db, userId, id);
}

export function deleteRecurring(db: Db, userId: string, id: string): boolean {
  ensureFinance(db, userId);
  const res = db.prepare('DELETE FROM fin_recurring WHERE id = ? AND user_id = ?').run(id, userId);
  if (res.changes) db.prepare('UPDATE fin_transactions SET recurring_id = NULL WHERE user_id = ? AND recurring_id = ?').run(userId, id);
  return res.changes > 0;
}

/**
 * Creates the transactions of every active recurring item whose next_date is due
 * (<= today), then advances next_date. Idempotent: a unique index on
 * (recurring_id, date) plus INSERT OR IGNORE means re-running never duplicates.
 * Returns the number of transactions created.
 */
export function materializeRecurring(db: Db, userId: string, today: string): number {
  ensureFinance(db, userId);
  const due = db.prepare('SELECT * FROM fin_recurring WHERE user_id = ? AND active = 1 AND next_date <= ?').all(userId, today) as any[];
  if (!due.length) return 0;
  let created = 0;
  db.transaction(() => {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO fin_transactions (id, user_id, account_id, date, amount, kind, category_id, payee, note, transfer_account_id, direction, transfer_group, recurring_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, NULL, NULL, ?, ?)`,
    );
    for (const r of due) {
      const accOk = db.prepare('SELECT 1 FROM fin_accounts WHERE id = ? AND user_id = ?').get(r.account_id, userId);
      let next: string = r.next_date;
      for (let i = 0; i < 120 && next <= today; i++) {
        if (accOk) created += ins.run(generateId(), userId, r.account_id, next, r.amount, r.kind, r.category_id, r.name, r.id, new Date().toISOString()).changes;
        next = occurrenceOnOrAfter(r.every, r.day, addDays(next, 1));
      }
      db.prepare('UPDATE fin_recurring SET next_date = ? WHERE id = ?').run(next, r.id);
    }
  })();
  return created;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

type CatSlice = { categoryId: string | null; name: string; color: string; icon: string | null; amount: number };

export interface SummaryAPI {
  month: string; income: number; expense: number; net: number; savingsRate: number;
  byCategory: CatSlice[]; incomeByCategory: CatSlice[];
  byDay: Array<{ date: string; income: number; expense: number }>;
  accountsTotalTRY: number; missingRates: string[];
  last6Months: Array<{ month: string; income: number; expense: number }>;
  materialized: number;
}

export function getSummary(db: Db, userId: string, monthIn: unknown, todayIn?: string): SummaryAPI {
  ensureFinance(db, userId);
  const today = isValidDate(todayIn) ? todayIn : localDate(new Date());
  const month = isNullish(monthIn) ? today.slice(0, 7) : monthOf(monthIn);
  const materialized = materializeRecurring(db, userId, today);
  const rates = rateMap(db, userId);
  const missing = new Set<string>();
  const toTry = (amount: number, cur: string) => {
    const r = rates[cur];
    if (!r) { missing.add(cur); return 0; }
    return amount * r;
  };

  const from = addMonths(month, -5);
  const rows = db.prepare(
    `SELECT t.date, t.amount, t.kind, t.category_id AS cid, a.currency AS cur, c.name AS cname, c.color AS ccolor, c.icon AS cicon
     FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id
     LEFT JOIN fin_categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.kind IN ('gelir','gider') AND t.date >= ? AND t.date <= ? AND COALESCE(c.system, 0) = 0`,
  ).all(userId, monthStart(from), monthEnd(month)) as any[];

  const months: Record<string, { income: number; expense: number }> = {};
  for (let i = 0; i < 6; i++) months[addMonths(from, i)] = { income: 0, expense: 0 };
  const cats = { gider: new Map<string, any>(), gelir: new Map<string, any>() };
  const days = new Map<string, { income: number; expense: number }>();
  let income = 0, expense = 0;

  for (const r of rows) {
    const v = toTry(r.amount, r.cur);
    const ym = r.date.slice(0, 7);
    const m = months[ym];
    if (m) { if (r.kind === 'gelir') m.income += v; else m.expense += v; }
    if (ym !== month) continue;
    if (r.kind === 'gelir') income += v; else expense += v;
    const key = r.cid || '_none';
    const bucket = cats[r.kind as 'gider' | 'gelir'];
    const e = bucket.get(key) || { categoryId: r.cid || null, name: r.cname || 'Kategorisiz', color: r.ccolor || '#64748b', icon: r.cicon ?? null, amount: 0 };
    e.amount += v;
    bucket.set(key, e);
    const d = days.get(r.date) || { income: 0, expense: 0 };
    if (r.kind === 'gelir') d.income += v; else d.expense += v;
    days.set(r.date, d);
  }

  const fin = (m: Map<string, any>): CatSlice[] => [...m.values()].map((e) => ({ ...e, amount: r2(e.amount) })).sort((a, b) => b.amount - a.amount);
  let total = 0;
  for (const a of listAccounts(db, userId, false)) total += toTry(a.balance, a.currency);

  const inc = r2(income), exp = r2(expense), net = r2(income - expense);
  return {
    month, income: inc, expense: exp, net,
    savingsRate: inc > 0 ? Math.round((net / inc) * 1000) / 10 : 0,
    byCategory: fin(cats.gider), incomeByCategory: fin(cats.gelir),
    byDay: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, income: r2(v.income), expense: r2(v.expense) })),
    accountsTotalTRY: r2(total), missingRates: [...missing],
    last6Months: Object.keys(months).map((k) => ({ month: k, income: r2(months[k].income), expense: r2(months[k].expense) })),
    materialized,
  };
}

// ─── CSV import / export ─────────────────────────────────────────────────────

/** Parses CSV text with quoted fields; auto-detects the delimiter (; , tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Parses "1.234,56", "1,234.56", "-12,5", "₺ 1.500", "(250,00)". Returns null when not a number. */
export function parseAmount(raw: string): number | null {
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[₺$€\s]|TL|TRY|USD|EUR/gi, '');
  if (s.startsWith('-') || s.endsWith('-')) { neg = !neg; s = s.replace(/^-|-$/g, ''); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    if (s.indexOf(',') !== lastComma || after === 3) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Parses dd.mm.yyyy, dd/mm/yyyy, dd-mm-yyyy and yyyy-mm-dd (optionally followed by a time). */
export function parseCsvDate(raw: string): string | null {
  const s = String(raw).trim().split(/[ T]/)[0];
  let y: number, m: number, d: number;
  let mt = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else if ((mt = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = 2000 + +mt[3]; }
  else return null;
  const out = `${y}-${pad(m)}-${pad(d)}`;
  return isValidDate(out) && out >= '1970-01-01' && out <= '2100-12-31' ? out : null;
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ['tarih', 'date', 'islem tarihi', 'valor', 'tarih/saat'],
  amount: ['tutar', 'amount', 'miktar', 'islem tutari', 'borc/alacak'],
  desc: ['aciklama', 'description', 'desc', 'islem aciklamasi', 'detay', 'payee', 'alici', 'aciklama/alici'],
  category: ['kategori', 'category', 'cat'],
  type: ['tur', 'tip', 'type', 'kind', 'islem turu'],
  note: ['not', 'note', 'notlar'],
};

export interface ImportResult {
  imported: number; duplicates: number; skipped: number; createdCategories: number;
  errors: Array<{ line: number; reason: string }>; dryRun: boolean; columns: Record<string, string | null>;
}

export function importCsv(db: Db, userId: string, body: Record<string, unknown>): ImportResult {
  ensureFinance(db, userId);
  if (typeof body.csv !== 'string' || !body.csv.trim()) throw bad('CSV metni boş.');
  if (body.csv.length > 3_000_000) throw bad('CSV en fazla 3 MB olabilir.');
  const acc = requireAccount(db, userId, body.accountId);
  const dryRun = body.dryRun === true;
  const signMode = body.signMode === 'gider' || body.signMode === 'gelir' ? body.signMode : 'auto';
  const rows = parseCsv(body.csv);
  if (rows.length < 2) throw bad('CSV en az bir başlık ve bir veri satırı içermeli.');
  if (rows.length > 5001) throw bad('Bir seferde en fazla 5000 satır içe aktarılabilir.');

  const header = rows[0].map((h) => foldText(h).trim());
  const find = (key: string) => header.findIndex((h) => HEADER_ALIASES[key].includes(h));
  const ix = { date: find('date'), amount: find('amount'), desc: find('desc'), category: find('category'), type: find('type'), note: find('note') };
  if (ix.date < 0 || ix.amount < 0) throw bad("CSV başlığında 'Tarih' ve 'Tutar' sütunları bulunmalı (Date/Amount de olur).");
  const columns: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(ix)) columns[k] = v >= 0 ? rows[0][v].trim() : null;

  const parsed: Array<{ line: number; date: string; amount: number; desc: string; cat: string; type: string; note: string }> = [];
  const errors: Array<{ line: number; reason: string }> = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseCsvDate(r[ix.date] || '');
    const amt = parseAmount(r[ix.amount] || '');
    if (!date) { errors.push({ line: i + 1, reason: 'Tarih okunamadı.' }); continue; }
    if (amt === null || r2(amt) === 0 || Math.abs(amt) > MAX_AMOUNT) { errors.push({ line: i + 1, reason: 'Tutar okunamadı.' }); continue; }
    parsed.push({
      line: i + 1, date, amount: r2(amt), desc: ((ix.desc >= 0 ? r[ix.desc] : '') || '').trim().slice(0, 120),
      cat: ((ix.category >= 0 ? r[ix.category] : '') || '').trim(), type: foldText(ix.type >= 0 ? r[ix.type] || '' : '').trim(),
      note: ((ix.note >= 0 ? r[ix.note] : '') || '').trim().slice(0, 500),
    });
  }
  const anyNegative = parsed.some((p) => p.amount < 0);

  const cats = db.prepare('SELECT * FROM fin_categories WHERE user_id = ? AND archived = 0').all(userId) as any[];
  const catIndex = new Map<string, string>(); // `${kind}|${folded}` -> id
  for (const c of cats) catIndex.set(`${c.kind}|${foldText(c.name)}`, c.id);

  const existing = new Set<string>();
  const dates = parsed.map((p) => p.date).sort();
  if (dates.length) {
    const ex = db.prepare(
      `SELECT date, amount, kind, payee FROM fin_transactions WHERE user_id = ? AND account_id = ? AND date >= ? AND date <= ? AND kind IN ('gelir','gider')`,
    ).all(userId, acc.id, dates[0], dates[dates.length - 1]) as any[];
    for (const e of ex) existing.add(`${e.date}|${e.amount}|${e.kind}|${foldText(e.payee)}`);
  }

  let imported = 0, duplicates = 0, skipped = 0, createdCategories = 0;
  const now = new Date().toISOString();
  db.transaction(() => {
    const ins = db.prepare(
      `INSERT INTO fin_transactions (id, user_id, account_id, date, amount, kind, category_id, payee, note, transfer_account_id, direction, transfer_group, recurring_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
    );
    for (const p of parsed) {
      if (p.type.startsWith('transfer')) { skipped++; continue; }
      let kind: 'gider' | 'gelir';
      if (p.type.startsWith('gelir') || p.type === 'income' || p.type === 'credit') kind = 'gelir';
      else if (p.type.startsWith('gider') || p.type === 'expense' || p.type === 'debit') kind = 'gider';
      else if (signMode !== 'auto') kind = signMode;
      else kind = anyNegative ? (p.amount < 0 ? 'gider' : 'gelir') : 'gider';
      const amount = Math.abs(p.amount);
      const key = `${p.date}|${amount}|${kind}|${foldText(p.desc)}`;
      if (existing.has(key)) { duplicates++; continue; }
      existing.add(key);

      let categoryId: string | null = null;
      if (p.cat) {
        const ck = `${kind}|${foldText(p.cat)}`;
        categoryId = catIndex.get(ck) || null;
        if (!categoryId) {
          categoryId = generateId();
          if (!dryRun) {
            db.prepare('INSERT INTO fin_categories (id, user_id, name, kind, color, icon, archived, system, created_at) VALUES (?, ?, ?, ?, ?, NULL, 0, 0, ?)')
              .run(categoryId, userId, p.cat.slice(0, 40), kind, '#64748b', now);
          }
          catIndex.set(ck, categoryId);
          createdCategories++;
        }
      }
      if (!dryRun) ins.run(generateId(), userId, acc.id, p.date, amount, kind, categoryId, p.desc, p.note, now);
      imported++;
    }
  })();
  return { imported, duplicates, skipped, createdCategories, errors: errors.slice(0, 50), dryRun, columns };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvNum = (n: number) => String(n).replace('.', ',');

/** CSV export (; delimiter, decimal comma, UTF-8 BOM) that import can read back. */
export function exportCsv(db: Db, userId: string, month?: string): string {
  ensureFinance(db, userId);
  const lines = ['Tarih;Tutar;Tür;Hesap;Kategori;Açıklama;Not'];
  const where = ['t.user_id = ?', "(t.kind <> 'transfer' OR t.direction = 'out')"];
  const args: unknown[] = [userId];
  if (month) { const m = monthOf(month); where.push('t.date >= ? AND t.date <= ?'); args.push(monthStart(m), monthEnd(m)); }
  const rows = db.prepare(`${TX_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.date, t.created_at, t.rowid`).all(...args) as any[];
  for (const r of rows) {
    const tx = mapTx(r);
    const signed = tx.kind === 'gider' ? -tx.amount : tx.amount;
    const type = tx.kind === 'gider' ? 'Gider' : tx.kind === 'gelir' ? 'Gelir' : 'Transfer';
    const desc = tx.kind === 'transfer' ? `${tx.accountName} -> ${tx.transferAccountName}` : tx.payee;
    lines.push([tx.date, csvNum(signed), type, tx.accountName, tx.categoryName || '', desc, tx.note].map(csvCell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
