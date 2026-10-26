import { getDb, type Db } from '../../db/connection';

/**
 * Time-tracking categories, stored in SQLite (table timetrack_categories).
 * The tables are created lazily on first use, and a default set is seeded once.
 * Rules are regular expressions matched against the window app name, the window
 * title or a website domain. Categories are evaluated in sortOrder and the first
 * matching rule wins; anything unmatched falls into "Diğer".
 */

export type RuleField = 'app' | 'title' | 'domain';

export interface CategoryRule {
  field: RuleField;
  pattern: string;
  flags: string;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  rules: CategoryRule[];
  sortOrder: number;
  goalMinPerDay: number | null;
}

export const FALLBACK_NAME = 'Diğer';
export const FALLBACK_COLOR = '#64748b';

export const LIMITS = {
  maxCategories: 30,
  maxRulesPerCategory: 60,
  maxPatternLength: 200,
  maxNameLength: 40,
  maxGoalMin: 1440,
  /** Matched strings are truncated to this many characters before testing. */
  maxSubjectLength: 400,
};

const DDL = `
CREATE TABLE IF NOT EXISTS timetrack_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  rules TEXT NOT NULL DEFAULT '[]',
  sortOrder INTEGER NOT NULL DEFAULT 0,
  goalMinPerDay INTEGER
);
CREATE TABLE IF NOT EXISTS timetrack_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const r = (field: RuleField, ...patterns: string[]): CategoryRule[] =>
  patterns.map((pattern) => ({ field, pattern, flags: 'i' }));

const DEFAULT_CATEGORIES: Array<Omit<Category, 'id' | 'sortOrder'>> = [
  {
    name: 'Trade',
    color: '#22c55e',
    goalMinPerDay: null,
    rules: [
      ...r('app', 'tradingview', 'ctrader', 'metatrader', 'terminal64'),
      ...r('title', 'tradingview', 'ctrader', 'metatrader', 'binance', 'investing\\.com', 'forexfactory', 'forex factory', 'Trade Günlüğü'),
      ...r('domain', 'tradingview', 'binance', 'investing\\.com', 'forexfactory'),
    ],
  },
  {
    name: 'Okul',
    color: '#3b82f6',
    goalMinPerDay: null,
    rules: [
      ...r('app', 'obsidian', 'anki', 'notion', 'soffice', 'libreoffice', 'winword', 'powerpnt', 'zoom'),
      ...r('title', 'classroom', 'google docs', 'google dokümanlar', 'google drive', 'google meet', 'zoom', 'obsidian', 'anki', 'notion', 'libreoffice', 'microsoft word', 'powerpoint'),
      ...r('domain', 'classroom\\.google', 'docs\\.google', 'drive\\.google', 'meet\\.google', 'zoom\\.us', 'notion'),
    ],
  },
  {
    name: 'İletişim',
    color: '#a855f7',
    goalMinPerDay: null,
    rules: [
      ...r('app', 'whatsapp', 'telegram', 'discord', 'outlook', 'thunderbird', 'hxoutlook', 'mail'),
      ...r('title', 'whatsapp', 'telegram', 'discord', 'gmail', 'outlook'),
      ...r('domain', 'web\\.whatsapp', 'telegram', 'discord', 'mail\\.google', 'outlook'),
    ],
  },
  {
    name: 'Eğlence',
    color: '#f97316',
    goalMinPerDay: null,
    rules: [
      ...r('app', 'spotify', 'steam', 'vlc', 'netflix'),
      ...r('title', 'youtube', 'netflix', 'twitch', 'spotify'),
      ...r('domain', 'youtube', 'youtu\\.be', 'netflix', 'twitch', 'spotify'),
    ],
  },
  {
    name: 'Geliştirme',
    color: '#06b6d4',
    goalMinPerDay: null,
    rules: [
      ...r('app', '^code', 'cursor', 'windowsterminal', 'terminal', 'powershell', 'pwsh', '^cmd', 'claude', 'chatgpt', 'codex', 'github', 'devenv', 'idea'),
      ...r('title', 'github', 'stack overflow', 'claude', 'chatgpt', 'codex', 'visual studio code'),
      ...r('domain', 'github', 'stackoverflow', 'claude\\.ai', 'chatgpt\\.com'),
    ],
  },
  { name: FALLBACK_NAME, color: FALLBACK_COLOR, goalMinPerDay: null, rules: [] },
];

let initialized = false;

function ensureTables(db: Db): void {
  if (initialized) return;
  db.exec(DDL);
  const seeded = db.prepare('SELECT value FROM timetrack_meta WHERE key = ?').get('seeded') as { value: string } | undefined;
  if (!seeded) {
    const count = (db.prepare('SELECT COUNT(*) AS n FROM timetrack_categories').get() as { n: number }).n;
    const tx = db.transaction(() => {
      if (count === 0) {
        const insert = db.prepare(
          'INSERT INTO timetrack_categories (name, color, rules, sortOrder, goalMinPerDay) VALUES (?, ?, ?, ?, ?)',
        );
        DEFAULT_CATEGORIES.forEach((c, i) => insert.run(c.name, c.color, JSON.stringify(c.rules), i, c.goalMinPerDay));
      }
      db.prepare('INSERT OR REPLACE INTO timetrack_meta (key, value) VALUES (?, ?)').run('seeded', new Date().toISOString());
    });
    tx();
  }

  // Add ChatGPT/Codex defaults to installations that still have the untouched
  // pre-migration Development rules. Never rewrite a user's customized rules.
  const migrationKey = 'chatgpt_categorization_v1';
  const migrated = db.prepare('SELECT value FROM timetrack_meta WHERE key = ?').get(migrationKey);
  if (!migrated) {
    const development = DEFAULT_CATEGORIES.find((category) => category.name === 'Geliştirme');
    const oldDefaultRules = development?.rules.filter((rule) =>
      !['chatgpt', 'codex', 'chatgpt\\.com'].includes(rule.pattern),
    ) || [];
    const row = db.prepare('SELECT id, rules FROM timetrack_categories WHERE name = ?').get('Geliştirme') as { id: number; rules: string } | undefined;
    const tx = db.transaction(() => {
      if (development && row && JSON.stringify(parseRules(row.rules)) === JSON.stringify(oldDefaultRules)) {
        db.prepare('UPDATE timetrack_categories SET rules = ? WHERE id = ?')
          .run(JSON.stringify(development.rules), row.id);
      }
      db.prepare('INSERT OR REPLACE INTO timetrack_meta (key, value) VALUES (?, ?)')
        .run(migrationKey, new Date().toISOString());
    });
    tx();
  }
  initialized = true;
}

function parseRules(raw: unknown): CategoryRule[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.pattern === 'string' && ['app', 'title', 'domain'].includes(x.field))
      .map((x) => ({ field: x.field as RuleField, pattern: String(x.pattern), flags: x.flags === '' ? '' : 'i' }));
  } catch {
    return [];
  }
}

export function getCategories(): Category[] {
  const db = getDb();
  ensureTables(db);
  const rows = db
    .prepare('SELECT id, name, color, rules, sortOrder, goalMinPerDay FROM timetrack_categories ORDER BY sortOrder ASC, id ASC')
    .all() as Array<{ id: number; name: string; color: string; rules: string; sortOrder: number; goalMinPerDay: number | null }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    rules: parseRules(row.rules),
    sortOrder: row.sortOrder,
    goalMinPerDay: row.goalMinPerDay == null ? null : Number(row.goalMinPerDay),
  }));
}

export class CategoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryValidationError';
  }
}

// Heuristics against catastrophic backtracking: nested quantifiers such as
// (a+)+ or (\w*)*, quantified groups containing alternation followed by a
// quantifier, and backreferences are rejected outright.
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d)/;
const BACKREFERENCE = /\\[1-9]|\\k</;

function validatePattern(pattern: string, flags: string, where: string): void {
  if (pattern.length === 0) throw new CategoryValidationError(`${where}: boş kural olamaz.`);
  if (pattern.length > LIMITS.maxPatternLength) {
    throw new CategoryValidationError(`${where}: kural en fazla ${LIMITS.maxPatternLength} karakter olabilir.`);
  }
  if (NESTED_QUANTIFIER.test(pattern) || BACKREFERENCE.test(pattern)) {
    throw new CategoryValidationError(
      `${where}: "${pattern}" kuralı çok karmaşık (iç içe tekrar veya geri başvuru içeriyor). Daha basit bir ifade kullanın.`,
    );
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, flags);
  } catch {
    throw new CategoryValidationError(`${where}: "${pattern}" geçerli bir düzenli ifade değil.`);
  }
}

/** Validates and normalizes an incoming category list. Throws CategoryValidationError (Turkish message). */
export function validateCategories(input: unknown): Array<Omit<Category, 'id'> & { id: number | null }> {
  const list = Array.isArray(input) ? input : (input as any)?.categories;
  if (!Array.isArray(list)) throw new CategoryValidationError('Kategori listesi bekleniyordu.');
  if (list.length === 0) throw new CategoryValidationError('En az bir kategori olmalı.');
  if (list.length > LIMITS.maxCategories) {
    throw new CategoryValidationError(`En fazla ${LIMITS.maxCategories} kategori tanımlanabilir.`);
  }

  const seenNames = new Set<string>();
  const seenIds = new Set<number>();
  return list.map((raw: any, index: number) => {
    if (!raw || typeof raw !== 'object') throw new CategoryValidationError(`${index + 1}. kategori geçersiz.`);
    const name = String(raw.name ?? '').trim();
    if (!name) throw new CategoryValidationError(`${index + 1}. kategorinin adı boş.`);
    if (name.length > LIMITS.maxNameLength) {
      throw new CategoryValidationError(`"${name.slice(0, 20)}…" adı en fazla ${LIMITS.maxNameLength} karakter olabilir.`);
    }
    const key = name.toLocaleLowerCase('tr-TR');
    if (seenNames.has(key)) throw new CategoryValidationError(`"${name}" adı birden fazla kez kullanılmış.`);
    seenNames.add(key);

    const color = String(raw.color ?? '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new CategoryValidationError(`"${name}" için renk #RRGGBB biçiminde olmalı.`);
    }

    const rulesIn = raw.rules ?? [];
    if (!Array.isArray(rulesIn)) throw new CategoryValidationError(`"${name}" kuralları liste olmalı.`);
    if (rulesIn.length > LIMITS.maxRulesPerCategory) {
      throw new CategoryValidationError(`"${name}" en fazla ${LIMITS.maxRulesPerCategory} kural içerebilir.`);
    }
    const rules: CategoryRule[] = rulesIn.map((rule: any) => {
      const field = rule?.field;
      if (!['app', 'title', 'domain'].includes(field)) {
        throw new CategoryValidationError(`"${name}" içinde bilinmeyen kural alanı: ${String(field)}.`);
      }
      const pattern = String(rule?.pattern ?? '').trim();
      const flags = rule?.flags === '' ? '' : 'i';
      validatePattern(pattern, flags, `"${name}" kategorisi`);
      return { field, pattern, flags };
    });

    let goal: number | null = null;
    if (raw.goalMinPerDay !== null && raw.goalMinPerDay !== undefined && raw.goalMinPerDay !== '') {
      const g = Number(raw.goalMinPerDay);
      if (!Number.isFinite(g) || g < 0 || g > LIMITS.maxGoalMin) {
        throw new CategoryValidationError(`"${name}" için günlük hedef 0 ile ${LIMITS.maxGoalMin} dakika arasında olmalı.`);
      }
      goal = Math.round(g) || null;
    }

    let id: number | null = Number.isInteger(raw.id) && raw.id > 0 ? raw.id : null;
    if (id !== null && seenIds.has(id)) id = null;
    if (id !== null) seenIds.add(id);

    return { id, name, color: color.toLowerCase(), rules, sortOrder: index, goalMinPerDay: goal };
  });
}

/** Replaces the whole category list atomically. */
export function replaceCategories(input: unknown): Category[] {
  const items = validateCategories(input);
  const db = getDb();
  ensureTables(db);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM timetrack_categories').run();
    const withId = db.prepare(
      'INSERT INTO timetrack_categories (id, name, color, rules, sortOrder, goalMinPerDay) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const withoutId = db.prepare(
      'INSERT INTO timetrack_categories (name, color, rules, sortOrder, goalMinPerDay) VALUES (?, ?, ?, ?, ?)',
    );
    for (const c of items) {
      const rules = JSON.stringify(c.rules);
      if (c.id !== null) withId.run(c.id, c.name, c.color, rules, c.sortOrder, c.goalMinPerDay);
      else withoutId.run(c.name, c.color, rules, c.sortOrder, c.goalMinPerDay);
    }
  });
  tx();
  compiledCache = null;
  return getCategories();
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

interface CompiledCategory {
  category: Category;
  app: RegExp[];
  title: RegExp[];
  domain: RegExp[];
}

let compiledCache: { key: string; list: CompiledCategory[] } | null = null;

function compile(categories: Category[]): CompiledCategory[] {
  const key = JSON.stringify(categories);
  if (compiledCache && compiledCache.key === key) return compiledCache.list;
  const list = categories.map((category) => {
    const out: CompiledCategory = { category, app: [], title: [], domain: [] };
    for (const rule of category.rules) {
      try {
        out[rule.field].push(new RegExp(rule.pattern, rule.flags));
      } catch {
        /* invalid rules are skipped (they cannot be saved through the API) */
      }
    }
    return out;
  });
  compiledCache = { key, list };
  return list;
}

export interface Classifier {
  /** Returns the category name for a window event. */
  classifyWindow(app: string, title: string): string;
  /** Returns the category name for a domain (web watcher). */
  classifyDomain(domain: string): string;
  fallbackName: string;
}

export function createClassifier(categories: Category[]): Classifier {
  const compiled = compile(categories);
  const fallback = categories.find((c) => c.name === FALLBACK_NAME)?.name || FALLBACK_NAME;
  const cut = (s: string) => (s.length > LIMITS.maxSubjectLength ? s.slice(0, LIMITS.maxSubjectLength) : s);
  const memo = new Map<string, string>();

  return {
    fallbackName: fallback,
    classifyWindow(app: string, title: string): string {
      const memoKey = `${app}\u0000${title}`;
      const hit = memo.get(memoKey);
      if (hit) return hit;
      const a = cut(app || '');
      const t = cut(title || '');
      let result = fallback;
      outer: for (const c of compiled) {
        for (const re of c.app) if (re.test(a)) { result = c.category.name; break outer; }
        for (const re of c.title) if (re.test(t)) { result = c.category.name; break outer; }
      }
      if (memo.size < 20000) memo.set(memoKey, result);
      return result;
    },
    classifyDomain(domain: string): string {
      const d = cut(domain || '');
      for (const c of compiled) {
        for (const re of c.domain) if (re.test(d)) return c.category.name;
      }
      return fallback;
    },
  };
}
