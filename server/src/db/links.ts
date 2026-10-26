/**
 * Cross-entity links (task <-> trade / news / note / url / task) and the
 * global search across tasks, trades, news and projects. User-scoped.
 * Links are stored directionally but always queried from both sides.
 */
import type { Db } from './connection';
import { generateId } from '../utils/id';
import { ApiError, containsPattern, ensureSqlFunctions, foldText, escapeLike, isValidDate, localDate } from './tasks';

export const LINK_TYPES = ['task', 'trade', 'news', 'note', 'url'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export interface LinkEndAPI {
  linkId: string;
  type: LinkType;
  id: string;
  label: string | null;
  /** 'out' = stored as (queried entity -> this end), 'in' = the reverse. */
  direction: 'out' | 'in';
  createdAt: string;
  /** True when the target no longer exists (e.g. pruned news, deleted trade). */
  missing: boolean;
  meta: Record<string, unknown> | null;
}

interface LinkRow {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  label: string | null;
  created_at: string;
}

const bad = (msg: string) => new ApiError(400, msg);

function tradeDate(enterTime: string): string {
  const d = new Date(enterTime);
  return Number.isNaN(d.getTime()) ? String(enterTime).slice(0, 10) : localDate(d);
}

interface Resolved {
  label: string | null;
  meta: Record<string, unknown> | null;
}

const tableCache = new WeakMap<Db, Set<string>>();
/** True once the table exists (positive results are cached per connection). */
function hasTable(db: Db, name: string): boolean {
  const known = tableCache.get(db) ?? new Set<string>();
  if (known.has(name)) return true;
  const found = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  if (found) { known.add(name); tableCache.set(db, known); }
  return found;
}

/** Public form of resolveMany, used by the notes module to label wikilink targets. */
export function resolveLinkEnds(db: Db, userId: string, type: LinkType, ids: string[]): Map<string, { label: string | null; meta: Record<string, unknown> | null }> {
  return resolveMany(db, userId, type, ids);
}

/** Looks up display labels for a batch of ids of one type. Missing ids are absent from the map. */
function resolveMany(db: Db, userId: string, type: LinkType, ids: string[]): Map<string, Resolved> {
  const out = new Map<string, Resolved>();
  if (!ids.length) return out;
  const json = JSON.stringify([...new Set(ids)]);
  if (type === 'task') {
    const rows = db
      .prepare('SELECT id, title, status, due_date, project_id FROM tasks WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))')
      .all(userId, json) as any[];
    for (const r of rows) out.set(r.id, { label: r.title, meta: { status: r.status, dueDate: r.due_date, projectId: r.project_id } });
  } else if (type === 'trade') {
    const rows = db
      .prepare('SELECT id, ticker, enter_time, manual_pl FROM trades WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))')
      .all(userId, json) as any[];
    for (const r of rows) {
      const date = tradeDate(r.enter_time);
      out.set(r.id, { label: `${r.ticker} · ${date}`, meta: { ticker: r.ticker, date, pl: r.manual_pl ?? null } });
    }
  } else if (type === 'news') {
    const rows = db
      .prepare('SELECT id, title, source, url, published_at FROM news_items WHERE id IN (SELECT value FROM json_each(?))')
      .all(json) as any[];
    for (const r of rows) out.set(r.id, { label: r.title, meta: { source: r.source, url: r.url, publishedAt: r.published_at } });
  } else if (type === 'note') {
    // Notes page notes (server/src/db/notes.ts; table created lazily, so check it exists).
    if (hasTable(db, 'notes')) {
      const noteRows = db
        .prepare('SELECT id, title, updated_at FROM notes WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))')
        .all(userId, json) as any[];
      for (const r of noteRows) out.set(r.id, { label: r.title, meta: { kind: 'note', noteId: r.id, updatedAt: r.updated_at } });
    }
    const rows = db
      .prepare('SELECT id, date FROM daily_notes WHERE user_id = ? AND (id IN (SELECT value FROM json_each(?)) OR date IN (SELECT value FROM json_each(?)))')
      .all(userId, json, json) as any[];
    for (const r of rows) {
      const res = { label: `Günlük not · ${r.date}`, meta: { date: r.date, noteId: r.id } };
      if (!out.has(r.id)) out.set(r.id, res);
      if (!out.has(r.date)) out.set(r.date, res);
    }
    // A note can also be referenced by its date before the note exists.
    for (const id of ids) if (!out.has(id) && isValidDate(id)) out.set(id, { label: `Günlük not · ${id}`, meta: { date: id, noteId: null } });
  } else if (type === 'url') {
    for (const id of ids) {
      let host: string | null = null;
      try { host = new URL(id).hostname; } catch { /* keep null */ }
      out.set(id, { label: host, meta: { url: id } });
    }
  }
  return out;
}

function validateType(v: unknown, field: string): LinkType {
  if (typeof v !== 'string' || !(LINK_TYPES as readonly string[]).includes(v)) {
    throw bad(`${field} şunlardan biri olmalı: ${LINK_TYPES.join(', ')}.`);
  }
  return v as LinkType;
}

function validateId(type: LinkType, v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${field} zorunludur.`);
  const id = v.trim();
  if (id.length > 2048) throw bad(`${field} çok uzun.`);
  if (type === 'url') {
    let u: URL;
    try { u = new URL(id); } catch { throw bad('Geçerli bir URL girin (http:// veya https://).'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('Yalnızca http ve https bağlantıları desteklenir.');
    return u.toString();
  }
  return id;
}

function assertExists(db: Db, userId: string, type: LinkType, id: string): Resolved {
  if (type === 'url') return resolveMany(db, userId, type, [id]).get(id)!;
  const r = resolveMany(db, userId, type, [id]).get(id);
  if (!r) {
    const names: Record<string, string> = { task: 'Görev', trade: 'İşlem', news: 'Haber', note: 'Not' };
    throw new ApiError(404, `${names[type]} bulunamadı.`);
  }
  return r;
}

function rowToEnd(row: LinkRow, type: string, id: string, resolved: Map<string, Map<string, Resolved>>): LinkEndAPI {
  const isOut = row.from_type === type && row.from_id === id;
  const endType = (isOut ? row.to_type : row.from_type) as LinkType;
  const endId = isOut ? row.to_id : row.from_id;
  const r = resolved.get(endType)?.get(endId);
  return {
    linkId: row.id,
    type: endType,
    id: endId,
    label: r?.label ?? row.label ?? null,
    direction: isOut ? 'out' : 'in',
    createdAt: row.created_at,
    missing: !r,
    meta: r?.meta ?? null,
  };
}

/** All links touching (type, id), normalized to the other end. */
export function listLinks(db: Db, userId: string, typeRaw: unknown, idRaw: unknown): LinkEndAPI[] {
  const type = validateType(typeRaw, 'type');
  const id = validateId(type, idRaw, 'id');
  const rows = db
    .prepare(
      `SELECT * FROM links WHERE user_id = ? AND ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?))
       ORDER BY created_at DESC`,
    )
    .all(userId, type, id, type, id) as LinkRow[];
  const wanted = new Map<LinkType, string[]>();
  for (const r of rows) {
    const isOut = r.from_type === type && r.from_id === id;
    const t = (isOut ? r.to_type : r.from_type) as LinkType;
    if (!(LINK_TYPES as readonly string[]).includes(t)) continue;
    wanted.set(t, [...(wanted.get(t) ?? []), isOut ? r.to_id : r.from_id]);
  }
  const resolved = new Map<string, Map<string, Resolved>>();
  for (const [t, ids] of wanted) resolved.set(t, resolveMany(db, userId, t, ids));
  return rows.map((r) => rowToEnd(r, type, id, resolved));
}

/**
 * Creates a link. Self links are rejected; an existing link between the same
 * two ends (either direction) is returned instead of creating a duplicate.
 */
export function createLink(db: Db, userId: string, body: Record<string, unknown>): { link: LinkEndAPI; existing: boolean } {
  const fromType = validateType(body.fromType, 'fromType');
  const toType = validateType(body.toType, 'toType');
  const fromId = validateId(fromType, body.fromId, 'fromId');
  const toId = validateId(toType, body.toId, 'toId');
  if (fromType === toType && fromId === toId) throw bad('Bir öğe kendisine bağlanamaz.');
  if (fromType === 'url' && toType === 'url') throw bad('İki URL birbirine bağlanamaz.');
  let label: string | null = null;
  if (body.label !== undefined && body.label !== null && body.label !== '') {
    if (typeof body.label !== 'string' || body.label.length > 300) throw bad('label en fazla 300 karakterlik metin olmalı.');
    label = body.label.trim();
  }

  const fromRes = assertExists(db, userId, fromType, fromId);
  const toRes = assertExists(db, userId, toType, toId);
  // Snapshot a label for ends that may disappear or have no title (news is pruned after 14 days).
  if (!label) {
    if (toType === 'news' || toType === 'url') label = toRes.label;
    else if (fromType === 'news' || fromType === 'url') label = fromRes.label;
  }

  const find = db.prepare(
    `SELECT * FROM links WHERE user_id = ? AND ((from_type = ? AND from_id = ? AND to_type = ? AND to_id = ?)
                                            OR (from_type = ? AND from_id = ? AND to_type = ? AND to_id = ?))`,
  );
  let existing = true;
  const row = db.transaction(() => {
    const found = find.get(userId, fromType, fromId, toType, toId, toType, toId, fromType, fromId) as LinkRow | undefined;
    if (found) return found;
    existing = false;
    const id = generateId();
    db.prepare(
      'INSERT INTO links (id, user_id, from_type, from_id, to_type, to_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, userId, fromType, fromId, toType, toId, label, new Date().toISOString());
    return db.prepare('SELECT * FROM links WHERE id = ?').get(id) as LinkRow;
  })();

  const resolved = new Map<string, Map<string, Resolved>>([[toType, new Map([[toId, toRes]])]]);
  // Normalized from the "from" side: the returned end is the target.
  const end = rowToEnd(row, fromType, fromId, resolved);
  if (end.type !== toType || end.id !== toId) {
    // Existing reverse link: still report the requested target.
    end.type = toType;
    end.id = toId;
    end.label = toRes.label ?? row.label;
    end.meta = toRes.meta;
    end.missing = false;
  }
  return { link: end, existing };
}

export function deleteLink(db: Db, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ─── Global search ───────────────────────────────────────────────────────────

export interface SearchResult {
  tasks: Array<{ id: string; title: string; projectName: string | null; status: string; dueDate: string | null }>;
  trades: Array<{ id: string; ticker: string; date: string; pl: number | null }>;
  news: Array<{ id: string; title: string; source: string; publishedAt: string }>;
  projects: Array<{ id: string; name: string }>;
}

export function searchAll(db: Db, userId: string, qRaw: string | undefined, limitRaw: string | undefined): SearchResult {
  ensureSqlFunctions(db);
  const empty: SearchResult = { tasks: [], trades: [], news: [], projects: [] };
  const q = (qRaw ?? '').trim();
  if (q.length > 200) throw bad('Arama metni en fazla 200 karakter olabilir.');
  const limit = limitRaw === undefined || limitRaw === '' ? 8 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw bad('limit 1 ile 50 arasında bir tam sayı olmalı.');
  if (!q) return empty;

  const like = containsPattern(q);
  const prefix = `${escapeLike(foldText(q))}%`;
  const ESC = "ESCAPE '\\'";

  const tasks = (db
    .prepare(
      `SELECT t.id, t.title, t.status, t.due_date, p.name AS project_name
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.user_id = @userId AND (tr_fold(t.title) LIKE @like ${ESC} OR tr_fold(t.notes) LIKE @like ${ESC})
       ORDER BY t.status = 'done', tr_fold(t.title) LIKE @prefix ${ESC} DESC, t.updated_at DESC
       LIMIT @limit`,
    )
    .all({ userId, like, prefix, limit }) as any[])
    .map((r) => ({ id: r.id, title: r.title, projectName: r.project_name ?? null, status: r.status, dueDate: r.due_date ?? null }));

  const trades = (db
    .prepare(
      `SELECT id, ticker, enter_time, manual_pl FROM trades
       WHERE user_id = @userId AND (tr_fold(ticker) LIKE @like ${ESC} OR tr_fold(comments) LIKE @like ${ESC} OR tr_fold(account) LIKE @like ${ESC})
       ORDER BY tr_fold(ticker) LIKE @prefix ${ESC} DESC, enter_time DESC
       LIMIT @limit`,
    )
    .all({ userId, like, prefix, limit }) as any[])
    .map((r) => ({ id: r.id, ticker: r.ticker, date: tradeDate(r.enter_time), pl: r.manual_pl ?? null }));

  const news = (db
    .prepare(
      `SELECT id, title, source, published_at FROM news_items
       WHERE tr_fold(title) LIKE @like ${ESC} OR tr_fold(summary) LIKE @like ${ESC}
       ORDER BY published_at DESC LIMIT @limit`,
    )
    .all({ like, limit }) as any[])
    .map((r) => ({ id: r.id, title: r.title, source: r.source, publishedAt: r.published_at }));

  const projects = (db
    .prepare(
      `SELECT id, name FROM projects WHERE user_id = @userId AND tr_fold(name) LIKE @like ${ESC}
       ORDER BY archived, tr_fold(name) LIKE @prefix ${ESC} DESC, sort_order LIMIT @limit`,
    )
    .all({ userId, like, prefix, limit }) as any[])
    .map((r) => ({ id: r.id, name: r.name }));

  return { tasks, trades, news, projects };
}
