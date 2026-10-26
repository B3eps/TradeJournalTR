/**
 * Notes ("Notlar"): Obsidian-style Markdown notes with [[wikilinks]], #tags,
 * backlinks and a daily note. Bodies are stored as plain Markdown text.
 *
 * Tables are created lazily (CREATE TABLE IF NOT EXISTS) on first use:
 *   notes             one row per note, title unique per user (Turkish-folded key)
 *   note_tags         parsed #tags (for filtering / tag list)
 *   note_refs         parsed note wikilinks by folded title (or 'id:<noteId>'),
 *                     kept even when the target does not exist yet ("missing")
 *   note_link_sync    which rows of the generic `links` table were created by
 *                     body sync (so manual links are never removed by a save)
 *
 * Wikilink syntax:  [[Başlık]]  [[Başlık|görünen metin]]  [[Başlık#Bölüm]]
 *   typed:          [[görev:<id>|Başlık]]  [[işlem:<id>|Etiket]]  [[haber:<id>|Başlık]]  [[not:<id>|Başlık]]
 * Tags:             #etiket (Turkish letters allowed), ignored in code and headings.
 *
 * All functions are synchronous (better-sqlite3) and owner-scoped by userId.
 */
import type { Db } from './connection';
import { generateId } from '../utils/id';
import { ApiError, containsPattern, ensureSqlFunctions, escapeLike, foldText, isValidDate, localDate } from './tasks';
import { listLinks, resolveLinkEnds, type LinkType } from './links';

// ─── Schema ──────────────────────────────────────────────────────────────────

const DDL = `
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  title_key  TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '[]',
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, title_key)
);
CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, pinned, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_user_created ON notes(user_id, created_at);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tag_key TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (note_id, tag_key)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_user_tag ON note_tags(user_id, tag_key);

CREATE TABLE IF NOT EXISTS note_refs (
  note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  target_key   TEXT NOT NULL,
  target_title TEXT NOT NULL,
  PRIMARY KEY (note_id, target_key)
);
CREATE INDEX IF NOT EXISTS idx_note_refs_user_target ON note_refs(user_id, target_key);

CREATE TABLE IF NOT EXISTS note_link_sync (
  link_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_link_sync_note ON note_link_sync(note_id);
`;

const ready = new WeakSet<Db>();

/** Creates the notes tables on this connection (idempotent, cheap after the first call). */
export function ensureNotesSchema(db: Db): void {
  if (ready.has(db)) return;
  db.exec(DDL);
  ensureSqlFunctions(db);
  ready.add(db);
}

// ─── Limits & validation ─────────────────────────────────────────────────────

export const NOTE_LIMITS = {
  titleMax: 200,
  bodyMax: 500_000,
  importFilesMax: 1000,
  importFileMax: 1_000_000,
  tagMax: 60,
};

const bad = (msg: string) => new ApiError(400, msg);
const notFound = () => new ApiError(404, 'Not bulunamadı.');
const conflict = () => new ApiError(409, 'Bu başlıkta bir not zaten var.');

const TITLE_FORBIDDEN = /[[\]|#^\n\r]/;

/** Folded, whitespace-collapsed key used for unique titles and [[link]] matching. */
export function titleKey(title: string): string {
  return foldText(title).replace(/\s+/g, ' ').trim();
}

function validateTitle(v: unknown): string {
  if (typeof v !== 'string') throw bad('Başlık metin olmalı.');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) throw bad('Başlık boş olamaz.');
  if (t.length > NOTE_LIMITS.titleMax) throw bad(`Başlık en fazla ${NOTE_LIMITS.titleMax} karakter olabilir.`);
  if (TITLE_FORBIDDEN.test(t)) throw bad('Başlık şu karakterleri içeremez: [ ] | # ^');
  return t;
}

function validateBody(v: unknown): string {
  if (typeof v !== 'string') throw bad('Not içeriği metin olmalı.');
  if (v.length > NOTE_LIMITS.bodyMax) throw bad('Not içeriği çok uzun (en fazla 500.000 karakter).');
  return v.replace(/\r\n?/g, '\n');
}

function validateBool(v: unknown, field: string): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return v === 1;
  throw bad(`${field} true ya da false olmalı.`);
}

// ─── Markdown scanning (pure) ────────────────────────────────────────────────

/**
 * Calls `fn` for every prose fragment of the Markdown (outside fenced code
 * blocks and inline code spans) and stitches the results back together.
 * `heading` is true for ATX heading lines.
 */
export function mapProse(md: string, fn: (text: string, heading: boolean) => string): string {
  const lines = String(md ?? '').split('\n');
  let fence: { ch: string; len: number } | null = null;
  const out: string[] = [];
  for (const line of lines) {
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      out.push(line);
      continue;
    }
    if (fm) {
      fence = { ch: fm[1][0], len: fm[1].length };
      out.push(line);
      continue;
    }
    const heading = /^ {0,3}#{1,6}(\s|$)/.test(line);
    // Split off inline code spans (`code`, ``co`de``).
    let res = '';
    let last = 0;
    const codeRe = /(`+)([\s\S]*?[^`])\1(?!`)/g;
    let m: RegExpExecArray | null;
    while ((m = codeRe.exec(line))) {
      res += fn(line.slice(last, m.index), heading) + m[0];
      last = m.index + m[0].length;
    }
    res += fn(line.slice(last), heading);
    out.push(res);
  }
  return out.join('\n');
}

export type WikiKind = 'note' | 'task' | 'trade' | 'news';

export interface WikiRef {
  kind: WikiKind;
  /** For notes: the title (without #section); for typed links: the item id. */
  target: string;
  /** 'note' title links: folded title; typed links: '<kind>:<id>' (typed note: 'id:<id>'). */
  key: string;
  alias: string | null;
  /** `#Bölüm` / `^blok` suffix of note links, kept on rename. */
  suffix: string;
  typed: boolean;
}

const TYPED_PREFIX: Record<string, WikiKind> = { gorev: 'task', islem: 'trade', haber: 'news', not: 'note' };
const TYPED_LABEL: Record<WikiKind, string> = { task: 'görev', trade: 'işlem', news: 'haber', note: 'not' };
const WIKI_RE = /\[\[([^[\]\n]{1,400}?)\]\]/g;

/** Parses the inside of a [[...]] link; null when it is not a usable link. */
export function parseWikiInner(inner: string): WikiRef | null {
  const pipe = inner.indexOf('|');
  const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() || null : null;
  if (!rawTarget) return null;
  const typed = /^([^\s:]{2,6}):\s*([A-Za-z0-9_-]{1,128})$/.exec(rawTarget);
  if (typed) {
    const kind = TYPED_PREFIX[foldText(typed[1])];
    if (kind) {
      const id = typed[2];
      return { kind, target: id, key: kind === 'note' ? `id:${id}` : `${kind}:${id}`, alias, suffix: '', typed: true };
    }
  }
  const cut = rawTarget.search(/[#^]/);
  const title = (cut >= 0 ? rawTarget.slice(0, cut) : rawTarget).replace(/\s+/g, ' ').trim();
  const suffix = cut >= 0 ? rawTarget.slice(cut).trim() : '';
  if (!title) return null; // [[#Bölüm]] = link inside the same note
  return { kind: 'note', target: title, key: titleKey(title), alias, suffix, typed: false };
}

/** All wikilinks in reading order (duplicates kept), code excluded. */
export function extractWikiLinks(md: string): WikiRef[] {
  const refs: WikiRef[] = [];
  mapProse(md, (text) => {
    for (const m of text.matchAll(WIKI_RE)) {
      const r = parseWikiInner(m[1]);
      if (r) refs.push(r);
    }
    return text;
  });
  return refs;
}

const TAG_RE = /(^|[\s(,;:!?"'{])#([\p{L}\p{N}_\-/]+)/gu;

/** Unique #tags (first spelling wins), ignoring code and heading lines. */
export function extractTags(md: string): string[] {
  const seen = new Map<string, string>();
  mapProse(md, (text, heading) => {
    if (heading) return text;
    for (const m of text.matchAll(TAG_RE)) {
      const tag = m[2].replace(/[-/]+$/, '');
      if (!tag || tag.length > NOTE_LIMITS.tagMax || !/\p{L}/u.test(tag)) continue;
      const key = foldText(tag);
      if (!seen.has(key)) seen.set(key, tag);
    }
    return text;
  });
  return [...seen.values()];
}

/** Rewrites note links whose folded title is `oldKey` to `newTitle`, keeping alias and #section. */
export function rewriteNoteLinks(md: string, oldKey: string, newTitle: string): { body: string; changed: boolean } {
  let changed = false;
  const body = mapProse(md, (text) => text.replace(WIKI_RE, (full, inner: string) => {
    const r = parseWikiInner(inner);
    if (!r || r.typed || r.key !== oldKey) return full;
    changed = true;
    return `[[${newTitle}${r.suffix}${r.alias ? `|${r.alias}` : ''}]]`;
  }));
  return { body, changed };
}

const decodeEntities = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

/** Plain-text preview of a Markdown body. */
export function makeExcerpt(md: string, max = 180): string {
  const parts: string[] = [];
  let len = 0;
  mapProse(md, (text, heading) => {
    if (len > max * 2) return text;
    let t = text;
    if (heading) t = t.replace(/^ {0,3}#{1,6}\s*/, '');
    t = t
      .replace(WIKI_RE, (_f, inner: string) => {
        const r = parseWikiInner(inner);
        return r ? (r.alias || (r.typed ? '' : r.target)) : '';
      })
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*>+\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, '')
      .replace(/\\([\\`*_[\]~#])/g, '$1')
      .replace(/(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2');
    t = decodeEntities(t).trim();
    if (t) { parts.push(t); len += t.length + 1; }
    return text;
  });
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

export interface NoteSummaryAPI {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  pinned: boolean;
  updatedAt: string;
  createdAt: string;
  backlinkCount: number;
}

export interface NoteAPI {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoteLinkAPI {
  type: LinkType;
  id: string | null;
  label: string;
  missing: boolean;
  /** Only on outgoing links: the [[target]] title (notes) and a stable match key. */
  target?: string;
  key?: string;
  linkId?: string;
}

interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  title_key: string;
  body: string;
  tags: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

function parseTags(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToNote(r: NoteRow): NoteAPI {
  return {
    id: r.id,
    title: r.title,
    body: r.body ?? '',
    tags: parseTags(r.tags),
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const BACKLINK_COUNT_SQL = `(
  (SELECT COUNT(DISTINCT r.note_id) FROM note_refs r
     WHERE r.user_id = n.user_id AND r.target_key IN (n.title_key, 'id:' || n.id) AND r.note_id <> n.id)
  + (SELECT COUNT(*) FROM links k
     WHERE k.user_id = n.user_id
       AND ((k.to_type = 'note' AND k.to_id = n.id) OR (k.from_type = 'note' AND k.from_id = n.id))
       AND k.id NOT IN (SELECT link_id FROM note_link_sync))
)`;

function getRow(db: Db, userId: string, id: string): NoteRow | undefined {
  return db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as NoteRow | undefined;
}

function rowByKey(db: Db, userId: string, key: string): NoteRow | undefined {
  return db.prepare('SELECT * FROM notes WHERE user_id = ? AND title_key = ?').get(userId, key) as NoteRow | undefined;
}

// ─── Derived data sync (tags, refs, links) ───────────────────────────────────

/** Rewrites note_tags/note_refs/tags for one note from its body and syncs link rows. */
function syncDerived(db: Db, userId: string, noteId: string, body: string): void {
  const tags = extractTags(body);
  db.prepare('UPDATE notes SET tags = ? WHERE id = ?').run(JSON.stringify(tags), noteId);
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
  const insTag = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, user_id, tag_key, tag) VALUES (?, ?, ?, ?)');
  for (const t of tags) insTag.run(noteId, userId, foldText(t), t);

  const refs = extractWikiLinks(body);
  db.prepare('DELETE FROM note_refs WHERE note_id = ?').run(noteId);
  const insRef = db.prepare('INSERT OR IGNORE INTO note_refs (note_id, user_id, target_key, target_title) VALUES (?, ?, ?, ?)');
  for (const r of refs) if (r.kind === 'note') insRef.run(noteId, userId, r.key, r.target);

  syncLinks(db, userId, noteId, refs);
}

/** Keeps the generic `links` rows created from this note's body in step with its wikilinks. */
function syncLinks(db: Db, userId: string, noteId: string, refs: WikiRef[]): void {
  const desired = new Map<string, { type: LinkType; id: string; label: string | null }>();
  const byKind: Record<string, string[]> = { task: [], trade: [], news: [] };
  for (const r of refs) {
    if (r.kind === 'note') {
      const row = r.typed ? getRow(db, userId, r.target) : rowByKey(db, userId, r.key);
      if (row && row.id !== noteId) desired.set(`note|${row.id}`, { type: 'note', id: row.id, label: null });
    } else {
      byKind[r.kind].push(r.target);
    }
  }
  for (const kind of ['task', 'trade', 'news'] as const) {
    if (!byKind[kind].length) continue;
    const found = resolveLinkEnds(db, userId, kind, byKind[kind]);
    for (const r of refs) {
      if (r.kind !== kind || !found.has(r.target)) continue;
      // Snapshot a label for news (pruned after 14 days), like createLink does.
      const label = kind === 'news' ? (r.alias || found.get(r.target)?.label || null) : null;
      desired.set(`${kind}|${r.target}`, { type: kind, id: r.target, label });
    }
  }

  db.prepare('DELETE FROM note_link_sync WHERE note_id = ? AND link_id NOT IN (SELECT id FROM links)').run(noteId);
  const ours = db
    .prepare(
      `SELECT s.link_id, k.from_type, k.from_id, k.to_type, k.to_id FROM note_link_sync s
       JOIN links k ON k.id = s.link_id WHERE s.note_id = ?`,
    )
    .all(noteId) as Array<{ link_id: string; from_type: string; from_id: string; to_type: string; to_id: string }>;
  const have = new Set<string>();
  const delLink = db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?');
  const delSync = db.prepare('DELETE FROM note_link_sync WHERE link_id = ?');
  for (const o of ours) {
    const isOut = o.from_type === 'note' && o.from_id === noteId;
    const k = isOut ? `${o.to_type}|${o.to_id}` : `${o.from_type}|${o.from_id}`;
    if (desired.has(k) && !have.has(k)) {
      have.add(k);
    } else {
      delLink.run(o.link_id, userId);
      delSync.run(o.link_id);
    }
  }
  const findAny = db.prepare(
    `SELECT id FROM links WHERE user_id = ? AND ((from_type = 'note' AND from_id = ? AND to_type = ? AND to_id = ?)
                                             OR (from_type = ? AND from_id = ? AND to_type = 'note' AND to_id = ?))`,
  );
  const insLink = db.prepare(
    'INSERT INTO links (id, user_id, from_type, from_id, to_type, to_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insSync = db.prepare('INSERT OR IGNORE INTO note_link_sync (link_id, note_id) VALUES (?, ?)');
  const now = new Date().toISOString();
  for (const [k, d] of desired) {
    if (have.has(k)) continue;
    // A manual link between the same two ends already exists: leave it alone.
    if (findAny.get(userId, noteId, d.type, d.id, d.type, d.id, noteId)) continue;
    const id = generateId();
    insLink.run(id, userId, 'note', noteId, d.type, d.id, d.label, now);
    insSync.run(id, noteId);
  }
}

/** Re-syncs link rows of every note that references one of these title keys (or note ids). */
function resyncReferrers(db: Db, userId: string, keys: string[], exceptId?: string): void {
  if (!keys.length) return;
  const rows = db
    .prepare(
      `SELECT DISTINCT n.id, n.body FROM note_refs r JOIN notes n ON n.id = r.note_id
       WHERE r.user_id = ? AND r.target_key IN (SELECT value FROM json_each(?))`,
    )
    .all(userId, JSON.stringify([...new Set(keys)])) as Array<{ id: string; body: string }>;
  for (const r of rows) if (r.id !== exceptId) syncLinks(db, userId, r.id, extractWikiLinks(r.body));
}

function uniqueTitle(db: Db, userId: string, base: string, taken?: Set<string>): string {
  const clean = base.slice(0, NOTE_LIMITS.titleMax - 6).trim() || 'Adsız not';
  const isTaken = (t: string) => !!rowByKey(db, userId, titleKey(t)) || !!taken?.has(titleKey(t));
  if (!isTaken(clean)) return clean;
  for (let i = 2; i < 10000; i++) {
    const t = `${clean} ${i}`;
    if (!isTaken(t)) return t;
  }
  return `${clean} ${generateId().slice(0, 6)}`;
}

function insertNote(
  db: Db,
  userId: string,
  data: { title: string; body: string; pinned: boolean; createdAt?: string; updatedAt?: string },
): string {
  const id = generateId();
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO notes (id, user_id, title, title_key, body, tags, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
    ).run(id, userId, data.title, titleKey(data.title), data.body, data.pinned ? 1 : 0, data.createdAt ?? now, data.updatedAt ?? now);
  } catch (e: any) {
    if (String(e?.code || '').startsWith('SQLITE_CONSTRAINT')) throw conflict();
    throw e;
  }
  return id;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ListOptions {
  q?: string;
  tag?: string;
  pinned?: string;
  limit?: string;
  offset?: string;
  sort?: string;
}

export function listNotes(db: Db, userId: string, opts: ListOptions): { notes: NoteSummaryAPI[]; total: number } {
  ensureNotesSchema(db);
  const where = ['n.user_id = @userId'];
  const params: Record<string, unknown> = { userId };
  const q = (opts.q ?? '').trim();
  if (q.length > 200) throw bad('Arama metni en fazla 200 karakter olabilir.');
  if (q) {
    where.push(`(tr_fold(n.title) LIKE @like ESCAPE '\\' OR tr_fold(n.body) LIKE @like ESCAPE '\\')`);
    params.like = containsPattern(q);
  }
  const tag = (opts.tag ?? '').trim().replace(/^#/, '');
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag_key = @tag)');
    params.tag = foldText(tag);
  }
  if (opts.pinned !== undefined && opts.pinned !== '') {
    if (['1', 'true'].includes(opts.pinned)) where.push('n.pinned = 1');
    else if (['0', 'false'].includes(opts.pinned)) where.push('n.pinned = 0');
    else throw bad('pinned true ya da false olmalı.');
  }
  const limit = opts.limit === undefined || opts.limit === '' ? 100 : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw bad('limit 1 ile 500 arasında bir tam sayı olmalı.');
  const offset = opts.offset === undefined || opts.offset === '' ? 0 : Number(opts.offset);
  if (!Number.isInteger(offset) || offset < 0) throw bad('offset negatif olmayan bir tam sayı olmalı.');
  const sort = opts.sort || 'updated';
  const orderBy: Record<string, string> = {
    updated: 'n.pinned DESC, n.updated_at DESC',
    created: 'n.pinned DESC, n.created_at DESC',
    title: 'n.pinned DESC, n.title_key ASC',
  };
  if (!orderBy[sort]) throw bad('sort şunlardan biri olmalı: updated, created, title.');

  const whereSql = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM notes n WHERE ${whereSql}`).get(params) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT n.*, ${BACKLINK_COUNT_SQL} AS backlink_count FROM notes n WHERE ${whereSql}
       ORDER BY ${orderBy[sort]} LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as Array<NoteRow & { backlink_count: number }>;
  return {
    total,
    notes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      excerpt: makeExcerpt(r.body),
      tags: parseTags(r.tags),
      pinned: !!r.pinned,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
      backlinkCount: r.backlink_count,
    })),
  };
}

/** Tag cloud for the sidebar: [{ tag, count }] sorted by count. */
export function listTags(db: Db, userId: string): Array<{ tag: string; count: number }> {
  ensureNotesSchema(db);
  return (db
    .prepare(
      `SELECT MIN(tag) AS tag, COUNT(*) AS count FROM note_tags WHERE user_id = ?
       GROUP BY tag_key ORDER BY count DESC, tag_key ASC LIMIT 300`,
    )
    .all(userId) as Array<{ tag: string; count: number }>);
}

export function getNote(db: Db, userId: string, id: string): NoteAPI | null {
  ensureNotesSchema(db);
  const r = getRow(db, userId, id);
  return r ? rowToNote(r) : null;
}

export interface NoteDetail {
  note: NoteAPI;
  backlinks: NoteLinkAPI[];
  outgoing: NoteLinkAPI[];
}

export function getNoteDetail(db: Db, userId: string, id: string): NoteDetail | null {
  ensureNotesSchema(db);
  const row = getRow(db, userId, id);
  if (!row) return null;
  return { note: rowToNote(row), backlinks: backlinksOf(db, userId, row), outgoing: outgoingOf(db, userId, row) };
}

function backlinksOf(db: Db, userId: string, row: NoteRow): NoteLinkAPI[] {
  const out: NoteLinkAPI[] = [];
  const seen = new Set<string>();
  const fromNotes = db
    .prepare(
      `SELECT DISTINCT n.id, n.title, n.updated_at FROM note_refs r JOIN notes n ON n.id = r.note_id
       WHERE r.user_id = ? AND r.target_key IN (?, ?) AND r.note_id <> ? ORDER BY n.updated_at DESC`,
    )
    .all(userId, row.title_key, `id:${row.id}`, row.id) as Array<{ id: string; title: string }>;
  for (const n of fromNotes) {
    seen.add(`note|${n.id}`);
    out.push({ type: 'note', id: n.id, label: n.title, missing: false });
  }
  const synced = new Set(
    (db.prepare('SELECT link_id FROM note_link_sync').all() as Array<{ link_id: string }>).map((r) => r.link_id),
  );
  for (const l of listLinks(db, userId, 'note', row.id)) {
    if (synced.has(l.linkId)) continue;
    const k = `${l.type}|${l.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type: l.type, id: l.id, label: l.label ?? l.id, missing: l.missing, linkId: l.linkId });
  }
  return out;
}

function outgoingOf(db: Db, userId: string, row: NoteRow): NoteLinkAPI[] {
  const refs = extractWikiLinks(row.body);
  const unique: WikiRef[] = [];
  const seen = new Set<string>();
  for (const r of refs) if (!seen.has(r.key)) { seen.add(r.key); unique.push(r); }
  const typedIds: Record<string, string[]> = { task: [], trade: [], news: [] };
  for (const r of unique) if (r.kind !== 'note') typedIds[r.kind].push(r.target);
  const resolved: Record<string, Map<string, { label: string | null }>> = {};
  for (const k of ['task', 'trade', 'news'] as const) resolved[k] = resolveLinkEnds(db, userId, k, typedIds[k]);

  return unique.map((r) => {
    if (r.kind === 'note') {
      const n = r.typed ? getRow(db, userId, r.target) : rowByKey(db, userId, r.key);
      return {
        type: 'note' as LinkType,
        id: n ? n.id : null,
        label: r.alias || (n ? n.title : r.target),
        missing: !n,
        target: n ? n.title : r.target,
        key: r.key,
      };
    }
    const hit = resolved[r.kind].get(r.target);
    return {
      type: r.kind as LinkType,
      id: r.target,
      label: hit?.label || r.alias || `${TYPED_LABEL[r.kind]}:${r.target}`,
      missing: !hit,
      target: r.target,
      key: r.key,
    };
  });
}

export function createNote(db: Db, userId: string, input: Record<string, unknown>): NoteAPI {
  ensureNotesSchema(db);
  const title = input.title === undefined || input.title === null || input.title === ''
    ? null
    : validateTitle(input.title);
  const body = input.body === undefined || input.body === null ? '' : validateBody(input.body);
  const pinned = input.pinned === undefined ? false : validateBool(input.pinned, 'pinned');
  const id = db.transaction(() => {
    const finalTitle = title ?? uniqueTitle(db, userId, 'Adsız not');
    if (rowByKey(db, userId, titleKey(finalTitle))) throw conflict();
    const newId = insertNote(db, userId, { title: finalTitle, body, pinned });
    syncDerived(db, userId, newId, body);
    resyncReferrers(db, userId, [titleKey(finalTitle), `id:${newId}`], newId);
    return newId;
  })();
  return rowToNote(getRow(db, userId, id)!);
}

export function updateNote(db: Db, userId: string, id: string, input: Record<string, unknown>): NoteDetail {
  ensureNotesSchema(db);
  const patch: { title?: string; body?: string; pinned?: boolean } = {};
  if (input.title !== undefined) patch.title = validateTitle(input.title);
  if (input.body !== undefined) patch.body = validateBody(input.body);
  if (input.pinned !== undefined) patch.pinned = validateBool(input.pinned, 'pinned');
  if (!Object.keys(patch).length) throw bad('Güncellenecek alan yok (title, body, pinned).');

  db.transaction(() => {
    const row = getRow(db, userId, id);
    if (!row) throw notFound();
    const now = new Date().toISOString();
    let touched = false;

    if (patch.body !== undefined && patch.body !== row.body) {
      db.prepare('UPDATE notes SET body = ? WHERE id = ?').run(patch.body, id);
      syncDerived(db, userId, id, patch.body);
      touched = true;
    }

    if (patch.title !== undefined && patch.title !== row.title) {
      const newKey = titleKey(patch.title);
      const clash = rowByKey(db, userId, newKey);
      if (clash && clash.id !== id) throw conflict();
      db.prepare('UPDATE notes SET title = ?, title_key = ? WHERE id = ?').run(patch.title, newKey, id);
      // Rewrite [[Old title]] in every other note that links here by title.
      const referrers = db
        .prepare(
          `SELECT DISTINCT n.id, n.body FROM note_refs r JOIN notes n ON n.id = r.note_id
           WHERE r.user_id = ? AND r.target_key = ? AND n.id <> ?`,
        )
        .all(userId, row.title_key, id) as Array<{ id: string; body: string }>;
      const upd = db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?');
      for (const ref of referrers) {
        const { body, changed } = rewriteNoteLinks(ref.body, row.title_key, patch.title);
        if (!changed) continue;
        upd.run(body, now, ref.id);
        syncDerived(db, userId, ref.id, body);
      }
      // Notes that pointed at the new title before it existed now resolve.
      if (newKey !== row.title_key) resyncReferrers(db, userId, [newKey], id);
      touched = true;
    }

    if (patch.pinned !== undefined) db.prepare('UPDATE notes SET pinned = ? WHERE id = ?').run(patch.pinned ? 1 : 0, id);
    if (touched) db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now, id);
  })();
  return getNoteDetail(db, userId, id)!;
}

export function deleteNote(db: Db, userId: string, id: string): boolean {
  ensureNotesSchema(db);
  let ok = false;
  db.transaction(() => {
    if (!getRow(db, userId, id)) return;
    db.prepare(
      `DELETE FROM note_link_sync WHERE note_id = ? OR link_id IN (
         SELECT id FROM links WHERE user_id = ? AND ((from_type = 'note' AND from_id = ?) OR (to_type = 'note' AND to_id = ?)))`,
    ).run(id, userId, id, id);
    db.prepare(`DELETE FROM links WHERE user_id = ? AND ((from_type = 'note' AND from_id = ?) OR (to_type = 'note' AND to_id = ?))`)
      .run(userId, id, id);
    db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(id);
    db.prepare('DELETE FROM note_refs WHERE note_id = ?').run(id);
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, userId);
    ok = true;
  })();
  return ok;
}

/** Body of a new daily note (the date itself is the title). */
export function dailyTemplate(): string {
  return [
    '#günlük',
    '',
    '## Bugünün planı',
    '',
    '- [ ] ',
    '',
    '## Notlar',
    '',
    '',
    '',
    '## Akşam değerlendirmesi',
    '',
    '',
  ].join('\n');
}

/** Get-or-create the note titled YYYY-MM-DD. */
export function getOrCreateDaily(db: Db, userId: string, dateRaw: unknown): { note: NoteAPI; created: boolean } {
  ensureNotesSchema(db);
  let date: string;
  if (dateRaw === undefined || dateRaw === null || dateRaw === '') date = localDate(new Date());
  else if (isValidDate(dateRaw)) date = dateRaw;
  else throw bad('date YYYY-MM-DD biçiminde geçerli bir tarih olmalı.');
  let created = false;
  const id = db.transaction(() => {
    const existing = rowByKey(db, userId, titleKey(date));
    if (existing) return existing.id;
    created = true;
    const body = dailyTemplate();
    const newId = insertNote(db, userId, { title: date, body, pinned: false });
    syncDerived(db, userId, newId, body);
    resyncReferrers(db, userId, [titleKey(date)], newId);
    return newId;
  })();
  return { note: rowToNote(getRow(db, userId, id)!), created };
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function searchNotes(db: Db, userId: string, qRaw: string | undefined, limit: number): Array<{ id: string; title: string; updatedAt: string }> {
  ensureNotesSchema(db);
  const q = (qRaw ?? '').trim();
  if (!q) return [];
  const like = containsPattern(q);
  const prefix = `${escapeLike(foldText(q))}%`;
  return (db
    .prepare(
      `SELECT id, title, updated_at FROM notes
       WHERE user_id = @userId AND (tr_fold(title) LIKE @like ESCAPE '\\' OR tr_fold(body) LIKE @like ESCAPE '\\')
       ORDER BY title_key LIKE @prefix ESCAPE '\\' DESC, tr_fold(title) LIKE @like ESCAPE '\\' DESC, updated_at DESC
       LIMIT @limit`,
    )
    .all({ userId, like, prefix, limit }) as Array<{ id: string; title: string; updated_at: string }>)
    .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

// ─── Export / import ─────────────────────────────────────────────────────────

function safeFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'not';
  return base.replace(/^\.+/, '_');
}

export function exportNotes(db: Db, userId: string): Array<{ name: string; content: string }> {
  ensureNotesSchema(db);
  const rows = db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY title_key').all(userId) as NoteRow[];
  const used = new Set<string>();
  return rows.map((r) => {
    let name = safeFileName(r.title);
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${safeFileName(r.title)} (${n++})`;
    used.add(name.toLowerCase());
    const tags = parseTags(r.tags);
    const fm = [
      '---',
      `title: ${JSON.stringify(r.title)}`,
      `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
      `created: ${r.created_at}`,
      `updated: ${r.updated_at}`,
      ...(r.pinned ? ['pinned: true'] : []),
      '---',
      '',
    ].join('\n');
    return { name: `${name}.md`, content: fm + (r.body ?? '') };
  });
}

interface FrontMatter {
  title?: string;
  tags: string[];
  created?: string;
  updated?: string;
  pinned?: boolean;
}

const unquote = (s: string) => {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    if (t[0] === '"') { try { return String(JSON.parse(t)); } catch { /* fall through */ } }
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
};

/** Minimal YAML front matter reader (title, tags, created, updated, pinned). Never throws. */
export function parseFrontMatter(content: string): { fm: FrontMatter; body: string } {
  const fm: FrontMatter = { tags: [] };
  const m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(content);
  if (!m) return { fm, body: content };
  const lines = m[1].split('\n');
  let listKey: string | null = null;
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey === 'tags') { fm.tags.push(unquote(item[1])); continue; }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let key = kv[1].toLowerCase();
    if (key === 'tag') key = 'tags';
    const value = kv[2].trim();
    listKey = value === '' ? key : null;
    if (key === 'title' && value) fm.title = unquote(value);
    else if (key === 'tags' && value) {
      const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
      fm.tags.push(...inner.split(inner.includes(',') ? ',' : /\s+/).map(unquote));
    } else if ((key === 'created' || key === 'updated') && value) {
      const d = new Date(unquote(value));
      if (!Number.isNaN(d.getTime())) fm[key] = d.toISOString();
    } else if (key === 'pinned') fm.pinned = /^(true|yes|1)$/i.test(value);
  }
  fm.tags = fm.tags.map((t) => t.replace(/^#/, '').trim().replace(/\s+/g, '-')).filter((t) => t && /\p{L}/u.test(t));
  return { fm, body: content.slice(m[0].length) };
}

export interface ImportResult {
  imported: number;
  notes: Array<{ id: string; title: string; name: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

export function importNotes(db: Db, userId: string, input: Record<string, unknown>): ImportResult {
  ensureNotesSchema(db);
  const files = input.files;
  if (!Array.isArray(files) || !files.length) throw bad('files boş olmayan bir dizi olmalı.');
  if (files.length > NOTE_LIMITS.importFilesMax) throw bad(`Tek seferde en fazla ${NOTE_LIMITS.importFilesMax} dosya içe aktarılabilir.`);
  const result: ImportResult = { imported: 0, notes: [], skipped: [] };

  db.transaction(() => {
    const taken = new Set<string>();
    const created: Array<{ id: string; body: string; key: string }> = [];
    for (const f of files as unknown[]) {
      const name = f && typeof (f as any).name === 'string' ? String((f as any).name).slice(0, 255) : '';
      const content = f && typeof (f as any).content === 'string' ? (f as any).content as string : null;
      if (!name || content === null) { result.skipped.push({ name: name || '?', reason: 'Geçersiz dosya (name ve content gerekli).' }); continue; }
      if (!/\.(md|markdown|txt)$/i.test(name)) { result.skipped.push({ name, reason: 'Yalnızca .md dosyaları içe aktarılabilir.' }); continue; }
      if (content.length > NOTE_LIMITS.importFileMax) { result.skipped.push({ name, reason: 'Dosya çok büyük (en fazla 1 MB).' }); continue; }

      const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      const { fm, body: rawBody } = parseFrontMatter(text);
      let body = rawBody.replace(/^\n+/, '');
      const heading = /^ {0,3}#\s+(.+?)\s*#*\s*$/m.exec(body);
      const fileBase = name.replace(/^.*[\\/]/, '').replace(/\.(md|markdown|txt)$/i, '');
      const rawTitle = fm.title || (heading ? heading[1] : '') || fileBase || 'İçe aktarılan not';
      let title = rawTitle.replace(/[[\]|#^\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_LIMITS.titleMax) || 'İçe aktarılan not';
      title = uniqueTitle(db, userId, title, taken);
      taken.add(titleKey(title));

      // Front matter tags that are not in the body would be lost on the next parse: append them.
      const bodyTags = new Set(extractTags(body).map((t) => foldText(t)));
      const extra = [...new Set(fm.tags)].filter((t) => !bodyTags.has(foldText(t)) && /^[\p{L}\p{N}_\-/]+$/u.test(t));
      if (extra.length) body = `${body.replace(/\s+$/, '')}\n\n${extra.map((t) => `#${t}`).join(' ')}\n`;
      if (body.length > NOTE_LIMITS.bodyMax) { result.skipped.push({ name, reason: 'Not içeriği çok uzun.' }); continue; }

      const id = insertNote(db, userId, {
        title, body, pinned: !!fm.pinned, createdAt: fm.created, updatedAt: fm.updated ?? fm.created,
      });
      created.push({ id, body, key: titleKey(title) });
      result.notes.push({ id, title, name });
    }
    for (const c of created) syncDerived(db, userId, c.id, c.body);
    resyncReferrers(db, userId, created.map((c) => c.key));
    result.imported = created.length;
  })();
  return result;
}
