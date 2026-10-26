/**
 * "Kartlar": spaced-repetition flashcards scheduled with FSRS (ts-fsrs).
 * Decks, cards, review logs and per-user settings live in SQLite; the tables
 * are created lazily on first use (CREATE TABLE IF NOT EXISTS) and the decks
 * 'Okul', 'Trade' and 'Genel' are seeded once per user. All functions are
 * synchronous and owner-scoped by userId. The study day rolls over at 04:00
 * local time.
 */
import { fsrs, createEmptyCard, Rating, State, generatorParameters } from 'ts-fsrs';
import type { Card as FsrsCard, Grade } from 'ts-fsrs';
import type { Db } from './connection';
import { generateId } from '../utils/id';
import { ApiError, containsPattern, ensureSqlFunctions, foldText, localDate } from './tasks';

const bad = (msg: string) => new ApiError(400, msg);

// ─── Constants ───────────────────────────────────────────────────────────────

export const LIMITS = {
  textMax: 5000,
  nameMax: 40,
  tagMax: 30,
  tagsMax: 10,
  decksMax: 100,
  importMaxBytes: 5 * 1024 * 1024,
  importMaxCards: 5000,
  queueDefault: 200,
  queueMax: 500,
  pageMax: 500,
  newPerDayMax: 500,
};

export const DEFAULT_NEW_PER_DAY = 20;
export const DEFAULT_RETENTION = 0.9;
const DAY_START_HOUR = 4;
const LEARN_AHEAD_MS = 20 * 60 * 1000;
const MATURE_DAYS = 21;
const SOURCE_TYPES = ['note', 'task', 'trade', 'news'];
const DECK_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#eab308', '#64748b'];
const SEED_DECKS: Array<{ name: string; color: string }> = [
  { name: 'Okul', color: '#3b82f6' },
  { name: 'Trade', color: '#22c55e' },
  { name: 'Genel', color: '#a855f7' },
];
export const DEFAULT_DECK_NAME = 'Genel';

// ─── Schema ──────────────────────────────────────────────────────────────────

const DDL = `
CREATE TABLE IF NOT EXISTS card_decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_decks_user ON card_decks(user_id);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deckId TEXT NOT NULL REFERENCES card_decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  sourceType TEXT,
  sourceId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(user_id, due, state);
CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(user_id, deckId, state, due);
CREATE TABLE IF NOT EXISTS card_review_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cardId TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  state INTEGER NOT NULL,
  due INTEGER NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  reviewedAt INTEGER NOT NULL,
  durationMs INTEGER,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER
);
CREATE INDEX IF NOT EXISTS idx_card_logs_card ON card_review_logs(cardId, reviewedAt);
CREATE INDEX IF NOT EXISTS idx_card_logs_user ON card_review_logs(user_id, reviewedAt);
CREATE TABLE IF NOT EXISTS card_settings (
  user_id TEXT PRIMARY KEY,
  newPerDay INTEGER NOT NULL DEFAULT ${DEFAULT_NEW_PER_DAY},
  retention REAL NOT NULL DEFAULT ${DEFAULT_RETENTION},
  seeded INTEGER NOT NULL DEFAULT 0
);
`;

const ready = new WeakSet<Db>();
const seededUsers = new Set<string>();

function ensureReady(db: Db, userId: string): void {
  if (!ready.has(db)) {
    db.exec(DDL);
    ensureSqlFunctions(db);
    ready.add(db);
  }
  const key = String(userId);
  if (seededUsers.has(key)) return;
  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO card_settings (user_id) VALUES (?)').run(userId);
    const row = db.prepare('SELECT seeded FROM card_settings WHERE user_id = ?').get(userId) as { seeded: number };
    if (!row.seeded) {
      const ins = db.prepare('INSERT INTO card_decks (id, user_id, name, color, createdAt) VALUES (?, ?, ?, ?, ?)');
      const now = Date.now();
      SEED_DECKS.forEach((d, i) => ins.run(generateId(), userId, d.name, d.color, now + i));
      db.prepare('UPDATE card_settings SET seeded = 1 WHERE user_id = ?').run(userId);
    }
  });
  tx();
  seededUsers.add(key);
}

// ─── Types & mapping ─────────────────────────────────────────────────────────

interface CardRow {
  id: string; user_id: string; deckId: string; front: string; back: string; tags: string;
  sourceType: string | null; sourceId: string | null; createdAt: number; updatedAt: number; suspended: number;
  due: number; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number;
  learning_steps: number; reps: number; lapses: number; state: number; last_review: number | null;
}

interface LogRow {
  id: string; user_id: string; cardId: string; rating: number; state: number; due: number; stability: number;
  difficulty: number; elapsed_days: number; scheduled_days: number; reviewedAt: number; durationMs: number | null;
  learning_steps: number; reps: number; lapses: number; last_review: number | null;
}

export interface CardOut {
  id: string; deckId: string; front: string; back: string; tags: string[];
  sourceType: string | null; sourceId: string | null; createdAt: string; updatedAt: string; suspended: boolean;
  due: string; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number;
  learning_steps: number; reps: number; lapses: number; state: number; last_review: string | null;
}

export interface NextIntervals { again: string; hard: string; good: string; easy: string }
export interface Counts { new: number; learning: number; review: number }

const iso = (ms: number) => new Date(ms).toISOString();

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function mapCard(r: CardRow): CardOut {
  return {
    id: r.id, deckId: r.deckId, front: r.front, back: r.back, tags: parseTags(r.tags),
    sourceType: r.sourceType, sourceId: r.sourceId, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
    suspended: !!r.suspended, due: iso(r.due), stability: r.stability, difficulty: r.difficulty,
    elapsed_days: r.elapsed_days, scheduled_days: r.scheduled_days, learning_steps: r.learning_steps,
    reps: r.reps, lapses: r.lapses, state: r.state, last_review: r.last_review == null ? null : iso(r.last_review),
  };
}

function toFsrsCard(r: CardRow): FsrsCard {
  return {
    due: new Date(r.due), stability: r.stability, difficulty: r.difficulty, elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days, learning_steps: r.learning_steps, reps: r.reps, lapses: r.lapses,
    state: r.state as State, last_review: r.last_review == null ? undefined : new Date(r.last_review),
  };
}

// ─── Study day ───────────────────────────────────────────────────────────────

/** Start (04:00 local) of the study day that contains `now`. */
export function studyDayStart(now: Date): Date {
  const s = new Date(now.getTime() - DAY_START_HOUR * 3600_000);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate(), DAY_START_HOUR, 0, 0, 0);
}

export function studyDayEnd(now: Date): Date {
  const s = studyDayStart(now);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1, DAY_START_HOUR, 0, 0, 0);
}

/** YYYY-MM-DD study-day key for a timestamp. */
export function studyDayKey(ms: number): string {
  return localDate(new Date(ms - DAY_START_HOUR * 3600_000));
}

// ─── Human intervals ─────────────────────────────────────────────────────────

const trNum = (n: number) => String(n).replace('.', ',');

export function formatInterval(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return '<1 dk';
  if (min < 60) return `${Math.round(min)} dk`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)} sa`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} g`;
  if (days < 365) {
    const months = days / 30.4375;
    return `${trNum(Math.round(months * 10) / 10)} ay`.replace(',0 ay', ' ay');
  }
  return `${trNum(Math.round((days / 365.25) * 10) / 10)} yıl`.replace(',0 yıl', ' yıl');
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface CardSettings { newPerDay: number; retention: number }

export function getSettings(db: Db, userId: string): CardSettings {
  ensureReady(db, userId);
  const r = db.prepare('SELECT newPerDay, retention FROM card_settings WHERE user_id = ?').get(userId) as CardSettings;
  return { newPerDay: r.newPerDay, retention: r.retention };
}

export function updateSettings(db: Db, userId: string, body: Record<string, unknown>): CardSettings {
  const cur = getSettings(db, userId);
  let { newPerDay, retention } = cur;
  if (body.newPerDay !== undefined) {
    const n = Number(body.newPerDay);
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.newPerDayMax) throw bad(`Günlük yeni kart sayısı 0 ile ${LIMITS.newPerDayMax} arasında bir tam sayı olmalı.`);
    newPerDay = n;
  }
  if (body.retention !== undefined) {
    const n = Number(body.retention);
    if (!Number.isFinite(n) || n < 0.7 || n > 0.97) throw bad('Hedef tutma oranı 0,70 ile 0,97 arasında olmalı.');
    retention = Math.round(n * 100) / 100;
  }
  db.prepare('UPDATE card_settings SET newPerDay = ?, retention = ? WHERE user_id = ?').run(newPerDay, retention, userId);
  return { newPerDay, retention };
}

function scheduler(db: Db, userId: string) {
  const { retention } = getSettings(db, userId);
  return fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true }));
}

// ─── Decks ───────────────────────────────────────────────────────────────────

interface DeckRow { id: string; user_id: string; name: string; color: string; createdAt: number }
export interface DeckOut { id: string; name: string; color: string; createdAt: string }

const mapDeck = (r: DeckRow): DeckOut => ({ id: r.id, name: r.name, color: r.color, createdAt: iso(r.createdAt) });

function cleanName(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw bad('Deste adı boş olamaz.');
  const name = v.trim().replace(/\s+/g, ' ');
  if (name.length > LIMITS.nameMax) throw bad(`Deste adı en fazla ${LIMITS.nameMax} karakter olabilir.`);
  return name;
}

function cleanColor(v: unknown): string {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('Renk #rrggbb biçiminde olmalı.');
  return v.toLowerCase();
}

function assertDeckNameFree(db: Db, userId: string, name: string, exceptId?: string) {
  const rows = db.prepare('SELECT id, name FROM card_decks WHERE user_id = ?').all(userId) as Array<{ id: string; name: string }>;
  if (rows.some((r) => r.id !== exceptId && foldText(r.name) === foldText(name))) {
    throw new ApiError(409, 'Bu adda bir deste zaten var.');
  }
}

export function getDeck(db: Db, userId: string, id: string): DeckRow | undefined {
  ensureReady(db, userId);
  return db.prepare('SELECT * FROM card_decks WHERE id = ? AND user_id = ?').get(id, userId) as DeckRow | undefined;
}

export function listDecks(db: Db, userId: string, now = new Date()) {
  ensureReady(db, userId);
  const decks = db.prepare('SELECT * FROM card_decks WHERE user_id = ? ORDER BY createdAt, rowid').all(userId) as DeckRow[];
  const end = studyDayEnd(now).getTime();
  const ahead = now.getTime() + LEARN_AHEAD_MS;
  const agg = db.prepare(
    `SELECT deckId,
       COUNT(*) AS total,
       SUM(CASE WHEN state = 0 AND suspended = 0 THEN 1 ELSE 0 END) AS newCount,
       SUM(CASE WHEN state IN (1,3) AND suspended = 0 AND due <= @ahead THEN 1 ELSE 0 END) AS learning,
       SUM(CASE WHEN state = 2 AND suspended = 0 AND due <= @end THEN 1 ELSE 0 END) AS review,
       SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END) AS suspended
     FROM cards WHERE user_id = @userId GROUP BY deckId`,
  ).all({ ahead, end, userId }) as Array<{ deckId: string; total: number; newCount: number; learning: number; review: number; suspended: number }>;
  const byDeck = new Map(agg.map((a) => [a.deckId, a]));
  const remaining = newRemaining(db, userId, now);
  return decks.map((d) => {
    const a = byDeck.get(d.id);
    const newCount = a?.newCount ?? 0;
    return {
      ...mapDeck(d),
      total: a?.total ?? 0,
      suspended: a?.suspended ?? 0,
      new: Math.min(newCount, remaining),
      newTotal: newCount,
      learning: a?.learning ?? 0,
      review: a?.review ?? 0,
    };
  });
}

export function createDeck(db: Db, userId: string, body: Record<string, unknown>): DeckOut {
  ensureReady(db, userId);
  const name = cleanName(body.name);
  assertDeckNameFree(db, userId, name);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM card_decks WHERE user_id = ?').get(userId) as { n: number }).n;
  if (n >= LIMITS.decksMax) throw bad(`En fazla ${LIMITS.decksMax} deste oluşturabilirsin.`);
  const color = body.color === undefined || body.color === null ? DECK_COLORS[n % DECK_COLORS.length] : cleanColor(body.color);
  const row: DeckRow = { id: generateId(), user_id: userId, name, color, createdAt: Date.now() };
  db.prepare('INSERT INTO card_decks (id, user_id, name, color, createdAt) VALUES (@id, @user_id, @name, @color, @createdAt)').run(row);
  return mapDeck(row);
}

export function updateDeck(db: Db, userId: string, id: string, body: Record<string, unknown>): DeckOut | null {
  const cur = getDeck(db, userId, id);
  if (!cur) return null;
  const name = body.name !== undefined ? cleanName(body.name) : cur.name;
  const color = body.color !== undefined ? cleanColor(body.color) : cur.color;
  if (name !== cur.name) assertDeckNameFree(db, userId, name, id);
  db.prepare('UPDATE card_decks SET name = ?, color = ? WHERE id = ? AND user_id = ?').run(name, color, id, userId);
  return mapDeck({ ...cur, name, color });
}

/** Deletes the deck and (by cascade) its cards and logs. Returns the number of deleted cards, or null if missing. */
export function deleteDeck(db: Db, userId: string, id: string): number | null {
  const cur = getDeck(db, userId, id);
  if (!cur) return null;
  const tx = db.transaction(() => {
    const ids = db.prepare('SELECT id FROM cards WHERE deckId = ? AND user_id = ?').all(id, userId) as Array<{ id: string }>;
    const delLogs = db.prepare('DELETE FROM card_review_logs WHERE cardId = ?');
    for (const c of ids) delLogs.run(c.id);
    db.prepare('DELETE FROM cards WHERE deckId = ? AND user_id = ?').run(id, userId);
    db.prepare('DELETE FROM card_decks WHERE id = ? AND user_id = ?').run(id, userId);
    return ids.length;
  });
  return tx();
}

/** Resolves a deck id for a new card; falls back to 'Genel' (created if it was deleted). */
function resolveDeckId(db: Db, userId: string, deckId: unknown): string {
  ensureReady(db, userId);
  if (deckId !== undefined && deckId !== null && deckId !== '') {
    if (typeof deckId !== 'string') throw bad('Geçersiz deste.');
    const d = getDeck(db, userId, deckId);
    if (!d) throw new ApiError(404, 'Deste bulunamadı.');
    return d.id;
  }
  const rows = db.prepare('SELECT id, name FROM card_decks WHERE user_id = ?').all(userId) as Array<{ id: string; name: string }>;
  const found = rows.find((r) => foldText(r.name) === foldText(DEFAULT_DECK_NAME));
  if (found) return found.id;
  return createDeck(db, userId, { name: DEFAULT_DECK_NAME }).id;
}

// ─── Cards: validation ───────────────────────────────────────────────────────

function cleanText(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${label} boş olamaz.`);
  const t = v.replace(/\r\n/g, '\n').trim();
  if (t.length > LIMITS.textMax) throw bad(`${label} en fazla ${LIMITS.textMax} karakter olabilir.`);
  return t;
}

export function cleanTags(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]+/) : null;
  if (!list) throw bad('Etiketler bir liste olmalı.');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    if (typeof t !== 'string') throw bad('Etiketler metin olmalı.');
    const tag = t.trim().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!tag) continue;
    if (tag.length > LIMITS.tagMax) throw bad(`Etiket en fazla ${LIMITS.tagMax} karakter olabilir.`);
    const k = foldText(tag);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(tag);
  }
  if (out.length > LIMITS.tagsMax) throw bad(`En fazla ${LIMITS.tagsMax} etiket eklenebilir.`);
  return out;
}

function cleanSource(type: unknown, id: unknown): { sourceType: string | null; sourceId: string | null } {
  if (type === undefined || type === null || type === '') return { sourceType: null, sourceId: null };
  if (typeof type !== 'string' || !SOURCE_TYPES.includes(type)) throw bad('Geçersiz kaynak türü.');
  if (id === undefined || id === null || id === '') return { sourceType: type, sourceId: null };
  if (typeof id !== 'string' && typeof id !== 'number') throw bad('Geçersiz kaynak kimliği.');
  const sid = String(id);
  if (sid.length > 120) throw bad('Kaynak kimliği çok uzun.');
  return { sourceType: type, sourceId: sid };
}

// ─── Cards: CRUD ─────────────────────────────────────────────────────────────

function insertCardRow(db: Db, userId: string, deckId: string, front: string, back: string, tags: string[], src: { sourceType: string | null; sourceId: string | null }, nowMs: number): CardRow {
  const empty = createEmptyCard(new Date(nowMs));
  const row: CardRow = {
    id: generateId(), user_id: userId, deckId, front, back, tags: JSON.stringify(tags),
    sourceType: src.sourceType, sourceId: src.sourceId, createdAt: nowMs, updatedAt: nowMs, suspended: 0,
    due: empty.due.getTime(), stability: empty.stability, difficulty: empty.difficulty,
    elapsed_days: empty.elapsed_days, scheduled_days: empty.scheduled_days, learning_steps: empty.learning_steps,
    reps: empty.reps, lapses: empty.lapses, state: empty.state, last_review: null,
  };
  db.prepare(
    `INSERT INTO cards (id, user_id, deckId, front, back, tags, sourceType, sourceId, createdAt, updatedAt, suspended,
       due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
     VALUES (@id, @user_id, @deckId, @front, @back, @tags, @sourceType, @sourceId, @createdAt, @updatedAt, @suspended,
       @due, @stability, @difficulty, @elapsed_days, @scheduled_days, @learning_steps, @reps, @lapses, @state, @last_review)`,
  ).run(row);
  return row;
}

export function createCard(db: Db, userId: string, body: Record<string, unknown>): CardOut {
  const front = cleanText(body.front, 'Ön yüz');
  const back = cleanText(body.back, 'Arka yüz');
  const tags = cleanTags(body.tags);
  const src = cleanSource(body.sourceType, body.sourceId);
  const tx = db.transaction(() => {
    const deckId = resolveDeckId(db, userId, body.deckId);
    return insertCardRow(db, userId, deckId, front, back, tags, src, Date.now());
  });
  return mapCard(tx());
}

function getCardRow(db: Db, userId: string, id: string): CardRow | undefined {
  ensureReady(db, userId);
  return db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(id, userId) as CardRow | undefined;
}

export function getCard(db: Db, userId: string, id: string): CardOut | null {
  const r = getCardRow(db, userId, id);
  return r ? mapCard(r) : null;
}

export function updateCard(db: Db, userId: string, id: string, body: Record<string, unknown>): CardOut | null {
  const cur = getCardRow(db, userId, id);
  if (!cur) return null;
  const front = body.front !== undefined ? cleanText(body.front, 'Ön yüz') : cur.front;
  const back = body.back !== undefined ? cleanText(body.back, 'Arka yüz') : cur.back;
  const tags = body.tags !== undefined ? JSON.stringify(cleanTags(body.tags)) : cur.tags;
  const tx = db.transaction(() => {
    let deckId = cur.deckId;
    if (body.deckId !== undefined) {
      if (typeof body.deckId !== 'string' || !getDeck(db, userId, body.deckId)) throw new ApiError(404, 'Deste bulunamadı.');
      deckId = body.deckId;
    }
    let suspended = cur.suspended;
    if (body.suspended !== undefined) suspended = body.suspended ? 1 : 0;
    const now = Date.now();
    db.prepare('UPDATE cards SET front = ?, back = ?, tags = ?, deckId = ?, suspended = ?, updatedAt = ? WHERE id = ? AND user_id = ?')
      .run(front, back, tags, deckId, suspended, now, id, userId);
  });
  tx();
  return getCard(db, userId, id);
}

export function deleteCard(db: Db, userId: string, id: string): boolean {
  ensureReady(db, userId);
  const tx = db.transaction(() => {
    const card = db.prepare('SELECT id FROM cards WHERE id = ? AND user_id = ?').get(id, userId);
    if (!card) return false;
    db.prepare('DELETE FROM card_review_logs WHERE cardId = ?').run(id);
    db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(id, userId);
    return true;
  });
  return tx();
}

export function toggleSuspend(db: Db, userId: string, id: string): CardOut | null {
  const cur = getCardRow(db, userId, id);
  if (!cur) return null;
  db.prepare('UPDATE cards SET suspended = ?, updatedAt = ? WHERE id = ? AND user_id = ?').run(cur.suspended ? 0 : 1, Date.now(), id, userId);
  return getCard(db, userId, id);
}

const STATE_FILTER: Record<string, number> = { new: 0, learning: 1, review: 2, relearning: 3 };

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function listCards(db: Db, userId: string, p: Record<string, string | undefined>, now = new Date()) {
  ensureReady(db, userId);
  const where: string[] = ['user_id = @userId'];
  const args: Record<string, unknown> = { userId };
  if (p.deckId) { where.push('deckId = @deckId'); args.deckId = p.deckId; }
  if (p.q && p.q.trim()) {
    where.push(`(tr_fold(front) LIKE @q ESCAPE '\\' OR tr_fold(back) LIKE @q ESCAPE '\\' OR tr_fold(tags) LIKE @q ESCAPE '\\')`);
    args.q = containsPattern(p.q.trim());
  }
  if (p.state) {
    const s = p.state.toLowerCase();
    if (s === 'suspended') where.push('suspended = 1');
    else if (s in STATE_FILTER) { where.push('state = @state'); args.state = STATE_FILTER[s]; }
    else if (/^[0-3]$/.test(s)) { where.push('state = @state'); args.state = Number(s); }
    else throw bad('Geçersiz durum filtresi.');
  }
  const dueOnly = p.due === '1' || p.due === 'true';
  if (dueOnly) {
    where.push('suspended = 0 AND state <> 0 AND due <= @dueEnd');
    args.dueEnd = studyDayEnd(now).getTime();
  }
  const limit = clampInt(p.limit, 100, 1, LIMITS.pageMax);
  const offset = clampInt(p.offset, 0, 0, 1_000_000);
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE ${w}`).get(args) as { n: number }).n;
  const order = dueOnly ? 'due ASC, rowid' : 'createdAt DESC, rowid DESC';
  const rows = db.prepare(`SELECT * FROM cards WHERE ${w} ORDER BY ${order} LIMIT @limit OFFSET @offset`).all({ ...args, limit, offset }) as CardRow[];
  return { cards: rows.map(mapCard), total };
}

// ─── Queue & counts ──────────────────────────────────────────────────────────

/** New cards that may still be introduced in the current study day. */
function newRemaining(db: Db, userId: string, now: Date): number {
  const { newPerDay } = getSettings(db, userId);
  const start = studyDayStart(now).getTime();
  const done = (db.prepare(
    'SELECT COUNT(DISTINCT cardId) AS n FROM card_review_logs WHERE user_id = ? AND state = 0 AND reviewedAt >= ?',
  ).get(userId, start) as { n: number }).n;
  return Math.max(0, newPerDay - done);
}

export function getCounts(db: Db, userId: string, deckId?: string, now = new Date()): Counts {
  ensureReady(db, userId);
  const args: Record<string, unknown> = { userId, ahead: now.getTime() + LEARN_AHEAD_MS, end: studyDayEnd(now).getTime() };
  let deckSql = '';
  if (deckId) { deckSql = ' AND deckId = @deckId'; args.deckId = deckId; }
  const r = db.prepare(
    `SELECT
       SUM(CASE WHEN state = 0 THEN 1 ELSE 0 END) AS newCount,
       SUM(CASE WHEN state IN (1,3) AND due <= @ahead THEN 1 ELSE 0 END) AS learning,
       SUM(CASE WHEN state = 2 AND due <= @end THEN 1 ELSE 0 END) AS review
     FROM cards WHERE user_id = @userId AND suspended = 0${deckSql}`,
  ).get(args) as { newCount: number | null; learning: number | null; review: number | null };
  return {
    new: Math.min(r.newCount ?? 0, newRemaining(db, userId, now)),
    learning: r.learning ?? 0,
    review: r.review ?? 0,
  };
}

function previewIntervals(f: ReturnType<typeof fsrs>, row: CardRow, now: Date): NextIntervals {
  const rec = f.repeat(toFsrsCard(row), now);
  const fmt = (g: Grade) => formatInterval(Math.max(0, rec[g].card.due.getTime() - now.getTime()));
  return { again: fmt(Rating.Again), hard: fmt(Rating.Hard), good: fmt(Rating.Good), easy: fmt(Rating.Easy) };
}

export function getQueue(db: Db, userId: string, deckId: string | undefined, limitRaw: unknown, now = new Date()) {
  ensureReady(db, userId);
  if (deckId && !getDeck(db, userId, deckId)) throw new ApiError(404, 'Deste bulunamadı.');
  const limit = clampInt(limitRaw, LIMITS.queueDefault, 1, LIMITS.queueMax);
  const counts = getCounts(db, userId, deckId, now);
  const args: Record<string, unknown> = { userId, ahead: now.getTime() + LEARN_AHEAD_MS, end: studyDayEnd(now).getTime() };
  let deckSql = '';
  if (deckId) { deckSql = ' AND deckId = @deckId'; args.deckId = deckId; }
  const base = `SELECT * FROM cards WHERE user_id = @userId AND suspended = 0${deckSql}`;
  const learning = db.prepare(`${base} AND state IN (1,3) AND due <= @ahead ORDER BY due LIMIT @n`).all({ ...args, n: limit }) as CardRow[];
  const review = db.prepare(`${base} AND state = 2 AND due <= @end ORDER BY due LIMIT @n`).all({ ...args, n: limit }) as CardRow[];
  const fresh = counts.new > 0
    ? db.prepare(`${base} AND state = 0 ORDER BY createdAt, rowid LIMIT @n`).all({ ...args, n: Math.min(limit, counts.new) }) as CardRow[]
    : [];
  const rows = [...learning, ...review, ...fresh].slice(0, limit);
  const f = scheduler(db, userId);
  return {
    cards: rows.map((r) => ({ ...mapCard(r), nextIntervals: previewIntervals(f, r, now) })),
    counts,
  };
}

// ─── Review & undo ───────────────────────────────────────────────────────────

export function reviewCard(db: Db, userId: string, id: string, ratingRaw: unknown, durationRaw: unknown, now = new Date(), deckId?: string) {
  const rating = Number(ratingRaw);
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) throw bad('Puan 1 ile 4 arasında olmalı.');
  let durationMs: number | null = null;
  if (durationRaw !== undefined && durationRaw !== null) {
    const d = Number(durationRaw);
    if (!Number.isFinite(d) || d < 0) throw bad('Geçersiz süre.');
    durationMs = Math.min(Math.round(d), 3600_000);
  }
  const f = scheduler(db, userId);
  const tx = db.transaction(() => {
    const row = getCardRow(db, userId, id);
    if (!row) throw new ApiError(404, 'Kart bulunamadı.');
    if (row.suspended) throw bad('Askıya alınmış kart çalışılamaz.');
    const { card: next, log } = f.next(toFsrsCard(row), now, rating as Grade);
    db.prepare(
      `INSERT INTO card_review_logs (id, user_id, cardId, rating, state, due, stability, difficulty, elapsed_days, scheduled_days,
         reviewedAt, durationMs, learning_steps, reps, lapses, last_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(generateId(), userId, id, rating, row.state, row.due, row.stability, row.difficulty, row.elapsed_days,
      row.scheduled_days, now.getTime(), durationMs, row.learning_steps, row.reps, row.lapses, row.last_review);
    void log;
    db.prepare(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, learning_steps = ?,
         reps = ?, lapses = ?, state = ?, last_review = ?, updatedAt = ? WHERE id = ? AND user_id = ?`,
    ).run(next.due.getTime(), next.stability, next.difficulty, next.elapsed_days, next.scheduled_days, next.learning_steps,
      next.reps, next.lapses, next.state, next.last_review ? next.last_review.getTime() : now.getTime(), now.getTime(), id, userId);
  });
  tx();
  const updated = getCardRow(db, userId, id)!;
  return {
    card: mapCard(updated),
    nextIntervals: previewIntervals(f, updated, now),
    counts: getCounts(db, userId, deckId, now),
  };
}

export function undoReview(db: Db, userId: string, id: string, now = new Date(), deckId?: string) {
  const tx = db.transaction(() => {
    const row = getCardRow(db, userId, id);
    if (!row) throw new ApiError(404, 'Kart bulunamadı.');
    const log = db.prepare('SELECT * FROM card_review_logs WHERE cardId = ? AND user_id = ? ORDER BY reviewedAt DESC, rowid DESC LIMIT 1')
      .get(id, userId) as LogRow | undefined;
    if (!log) throw bad('Geri alınacak bir tekrar yok.');
    db.prepare(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, learning_steps = ?,
         reps = ?, lapses = ?, state = ?, last_review = ?, updatedAt = ? WHERE id = ? AND user_id = ?`,
    ).run(log.due, log.stability, log.difficulty, log.elapsed_days, log.scheduled_days, log.learning_steps,
      log.reps, log.lapses, log.state, log.last_review, Date.now(), id, userId);
    db.prepare('DELETE FROM card_review_logs WHERE id = ?').run(log.id);
  });
  tx();
  const updated = getCardRow(db, userId, id)!;
  const f = scheduler(db, userId);
  return {
    card: mapCard(updated),
    nextIntervals: previewIntervals(f, updated, now),
    counts: getCounts(db, userId, deckId, now),
  };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function getStats(db: Db, userId: string, now = new Date()) {
  ensureReady(db, userId);
  const end = studyDayEnd(now).getTime();
  const todayStart = studyDayStart(now).getTime();
  const counts = getCounts(db, userId, undefined, now);
  const dueToday = counts.learning + counts.review;

  const reviewedToday = (db.prepare('SELECT COUNT(*) AS n FROM card_review_logs WHERE user_id = ? AND reviewedAt >= ?').get(userId, todayStart) as { n: number }).n;

  const since = todayStart - 400 * 86400_000;
  const stamps = db.prepare('SELECT reviewedAt FROM card_review_logs WHERE user_id = ? AND reviewedAt >= ?').all(userId, since) as Array<{ reviewedAt: number }>;
  const perDay = new Map<string, number>();
  for (const s of stamps) {
    const k = studyDayKey(s.reviewedAt);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }

  const todayKey = studyDayKey(now.getTime());
  const dayBefore = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return localDate(new Date(y, m - 1, d - 1, 12));
  };
  let streak = 0;
  let cursor = perDay.has(todayKey) ? todayKey : dayBefore(todayKey);
  while (perDay.has(cursor)) {
    streak++;
    cursor = dayBefore(cursor);
  }

  const byDay: Array<{ date: string; count: number }> = [];
  let k = todayKey;
  for (let i = 0; i < 120; i++) {
    byDay.unshift({ date: k, count: perDay.get(k) ?? 0 });
    k = dayBefore(k);
  }

  const r30 = db.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN rating > 1 THEN 1 ELSE 0 END) AS good
     FROM card_review_logs WHERE user_id = ? AND reviewedAt >= ?`,
  ).get(userId, now.getTime() - 30 * 86400_000) as { total: number; good: number | null };
  const retention30 = r30.total > 0 ? Math.round(((r30.good ?? 0) / r30.total) * 1000) / 10 : null;

  const tot = db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN state = 2 AND scheduled_days >= ? THEN 1 ELSE 0 END) AS mature
     FROM cards WHERE user_id = ?`,
  ).get(MATURE_DAYS, userId) as { total: number; mature: number | null };

  void end;
  return {
    dueToday,
    newAvailable: counts.new,
    reviewedToday,
    streak,
    retention30,
    byDay,
    totalCards: tot.total,
    matureCount: tot.mature ?? 0,
  };
}

// ─── Import / export ─────────────────────────────────────────────────────────

const fromCell = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n').trim();
const toCell = (s: string) => s.replace(/\r?\n/g, '<br>').replace(/\t/g, ' ');

export function importTsv(db: Db, userId: string, body: Record<string, unknown>) {
  const tsvText = body.tsv;
  if (typeof tsvText !== 'string' || !tsvText.trim()) throw bad('İçe aktarılacak metin boş.');
  if (Buffer.byteLength(tsvText, 'utf8') > LIMITS.importMaxBytes) throw bad('Metin çok büyük (en fazla 5 MB).');
  const tx = db.transaction(() => {
    const deckId = resolveDeckId(db, userId, body.deckId);
    const existing = db.prepare('SELECT front FROM cards WHERE user_id = ? AND deckId = ?').all(userId, deckId) as Array<{ front: string }>;
    const seen = new Set(existing.map((e) => foldText(e.front.trim())));
    let imported = 0;
    let invalid = 0;
    let duplicates = 0;
    let lines = 0;
    const base = Date.now();
    for (const raw of tsvText.replace(/^﻿/, '').split(/\r?\n/)) {
      if (!raw.trim()) continue;
      lines++;
      const cols = raw.split('\t');
      const front = fromCell(cols[0] ?? '');
      const back = fromCell(cols[1] ?? '');
      if (!front || !back || front.length > LIMITS.textMax || back.length > LIMITS.textMax) { invalid++; continue; }
      const key = foldText(front);
      if (seen.has(key)) { duplicates++; continue; }
      if (imported >= LIMITS.importMaxCards) throw bad(`Tek seferde en fazla ${LIMITS.importMaxCards} kart içe aktarılabilir.`);
      let tags: string[] = [];
      try { tags = cleanTags((cols[2] ?? '').trim() ? (cols[2] as string).split(/[\s,;]+/) : []); } catch { tags = []; }
      seen.add(key);
      insertCardRow(db, userId, deckId, front, back, tags, { sourceType: null, sourceId: null }, base + imported);
      imported++;
    }
    return { imported, invalid, duplicates, lines, deckId };
  });
  return tx();
}

export function exportTsv(db: Db, userId: string, deckId?: string): string {
  ensureReady(db, userId);
  if (deckId && !getDeck(db, userId, deckId)) throw new ApiError(404, 'Deste bulunamadı.');
  const rows = (deckId
    ? db.prepare('SELECT * FROM cards WHERE user_id = ? AND deckId = ? ORDER BY createdAt, rowid').all(userId, deckId)
    : db.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY createdAt, rowid').all(userId)) as CardRow[];
  return rows.map((r) => `${toCell(r.front)}\t${toCell(r.back)}\t${parseTags(r.tags).join(' ')}`).join('\n') + (rows.length ? '\n' : '');
}
