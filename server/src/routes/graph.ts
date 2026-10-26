/**
 * Bağlantı Haritası: GET /api/graph
 * Builds a node/edge graph out of tasks, notes, trades, news, cards and projects
 * from the generic `links` table, note wikilinks, card sources, task parents and
 * task projects. Only connected entities become nodes (plus project hubs for
 * included tasks). User-scoped, read-only.
 */
import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import type { Db } from '../db/connection';
import { ensureNotesSchema } from '../db/notes';
import { resolveLinkEnds } from '../db/links';
import { foldText, sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

export type GraphNodeType = 'task' | 'note' | 'trade' | 'news' | 'card' | 'project';
export type GraphEdgeKind = 'link' | 'wikilink' | 'parent' | 'card-source' | 'project';

export interface GraphNode { id: string; type: GraphNodeType; label: string; meta: Record<string, unknown> }
export interface GraphEdge { id: string; source: string; target: string; kind: GraphEdgeKind }

const NODE_TYPES: GraphNodeType[] = ['task', 'note', 'trade', 'news', 'card', 'project'];
const ENTITY_TYPES = ['task', 'note', 'trade', 'news'] as const;
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;
const MAX_ROWS = 20000;

interface Ref { type: GraphNodeType; id: string }
interface RawEdge { id: string; a: Ref; b: Ref; kind: GraphEdgeKind }

const key = (r: Ref) => `${r.type}:${r.id}`;

function tableExists(db: Db, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function clean(text: unknown, max = 80): string {
  const s = String(text ?? '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function toTs(v: unknown): number {
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v ?? ''));
  return Number.isNaN(t) ? 0 : t;
}

export function buildGraph(db: Db, userId: string, opts: { types: Set<GraphNodeType>; limit: number; q: string }) {
  ensureNotesSchema(db);

  // ── Load entities that we can resolve cheaply ──
  const taskRows = db
    .prepare('SELECT id, title, status, priority, due_date, project_id, parent_id, updated_at FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(userId, MAX_ROWS) as any[];
  const tasks = new Map<string, any>(taskRows.map((r) => [r.id, r]));

  const noteRows = db
    .prepare('SELECT id, title, title_key, tags, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(userId, MAX_ROWS) as any[];
  const notes = new Map<string, any>(noteRows.map((r) => [r.id, r]));
  const noteByKey = new Map<string, string>(noteRows.map((r) => [r.title_key, r.id]));

  const cardRows = tableExists(db, 'cards')
    ? (db
        .prepare('SELECT id, front, deckId, sourceType, sourceId, updatedAt FROM cards WHERE user_id = ? AND sourceType IS NOT NULL AND sourceId IS NOT NULL LIMIT ?')
        .all(userId, MAX_ROWS) as any[])
    : [];
  const cards = new Map<string, any>(cardRows.map((r) => [r.id, r]));

  const projectRows = db
    .prepare('SELECT id, name, color, icon, is_inbox FROM projects WHERE user_id = ?')
    .all(userId) as any[];
  const projects = new Map<string, any>(projectRows.map((r) => [r.id, r]));

  // Daily notes referenced by links (they are not rows of the notes table)
  const dailyRefs = new Set<string>();

  // ── Candidate edges ──
  const raw: RawEdge[] = [];

  const syncedLinkIds = new Set(
    (db.prepare('SELECT s.link_id FROM note_link_sync s JOIN notes n ON n.id = s.note_id WHERE n.user_id = ?').all(userId) as any[]).map((r) => r.link_id),
  );
  const linkRows = db
    .prepare('SELECT id, from_type, from_id, to_type, to_id FROM links WHERE user_id = ? LIMIT ?')
    .all(userId, MAX_ROWS) as any[];
  const isEntity = (t: string) => (ENTITY_TYPES as readonly string[]).includes(t);
  for (const l of linkRows) {
    if (!isEntity(l.from_type) || !isEntity(l.to_type)) continue;
    const mk = (type: string, id: string): Ref => {
      if (type === 'note' && !notes.has(id)) dailyRefs.add(id);
      return { type: type as GraphNodeType, id };
    };
    raw.push({ id: `link:${l.id}`, a: mk(l.from_type, l.from_id), b: mk(l.to_type, l.to_id), kind: syncedLinkIds.has(l.id) ? 'wikilink' : 'link' });
  }

  const refRows = db
    .prepare('SELECT note_id, target_key FROM note_refs WHERE user_id = ? LIMIT ?')
    .all(userId, MAX_ROWS) as any[];
  for (const r of refRows) {
    const tk = String(r.target_key);
    const targetId = tk.startsWith('id:') ? tk.slice(3) : noteByKey.get(tk);
    if (!targetId || targetId === r.note_id || !notes.has(targetId) || !notes.has(r.note_id)) continue;
    raw.push({ id: `ref:${r.note_id}:${targetId}`, a: { type: 'note', id: r.note_id }, b: { type: 'note', id: targetId }, kind: 'wikilink' });
  }

  for (const c of cardRows) {
    const t = String(c.sourceType);
    if (isEntity(t)) {
      if (t === 'note' && !notes.has(c.sourceId)) dailyRefs.add(c.sourceId);
      raw.push({ id: `card:${c.id}`, a: { type: 'card', id: c.id }, b: { type: t as GraphNodeType, id: c.sourceId }, kind: 'card-source' });
    }
  }

  for (const t of taskRows) {
    if (t.parent_id && tasks.has(t.parent_id)) {
      raw.push({ id: `parent:${t.id}`, a: { type: 'task', id: t.parent_id }, b: { type: 'task', id: t.id }, kind: 'parent' });
    }
  }

  // ── Resolve trade / news / daily-note endpoints in batches ──
  const need: Record<'trade' | 'news', Set<string>> = { trade: new Set(), news: new Set() };
  for (const e of raw) for (const r of [e.a, e.b]) if (r.type === 'trade' || r.type === 'news') need[r.type].add(r.id);
  const tradeInfo = resolveLinkEnds(db, userId, 'trade', [...need.trade]);
  const newsInfo = resolveLinkEnds(db, userId, 'news', [...need.news]);
  const dailyInfo = dailyRefs.size ? resolveLinkEnds(db, userId, 'note', [...dailyRefs]) : new Map();

  const exists = (r: Ref): boolean => {
    switch (r.type) {
      case 'task': return tasks.has(r.id);
      case 'note': return notes.has(r.id) || dailyInfo.has(r.id);
      case 'trade': return tradeInfo.has(r.id);
      case 'news': return newsInfo.has(r.id);
      case 'card': return cards.has(r.id);
      default: return false;
    }
  };

  // ── Filter by type, dedupe, degree ──
  const seenPair = new Set<string>();
  let edges = raw.filter((e) => {
    if (!opts.types.has(e.a.type) || !opts.types.has(e.b.type)) return false;
    if (!exists(e.a) || !exists(e.b)) return false;
    const ka = key(e.a);
    const kb = key(e.b);
    if (ka === kb) return false;
    const pair = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (seenPair.has(pair)) return false;
    seenPair.add(pair);
    return true;
  });

  type Info = { label: string; meta: Record<string, unknown>; ts: number };
  const nodeInfo = (r: Ref): Info => {
    if (r.type === 'task') {
      const t = tasks.get(r.id);
      const p = t.project_id ? projects.get(t.project_id) : null;
      return {
        label: clean(t.title), ts: toTs(t.updated_at),
        meta: { status: t.status, priority: t.priority, dueDate: t.due_date, projectId: t.project_id, projectName: p ? p.name : null, date: t.updated_at },
      };
    }
    if (r.type === 'note') {
      const n = notes.get(r.id);
      if (n) {
        let tags: unknown = [];
        try { tags = JSON.parse(n.tags); } catch { /* ignore */ }
        return { label: clean(n.title), ts: toTs(n.updated_at), meta: { tags, date: n.updated_at } };
      }
      const d = dailyInfo.get(r.id);
      const date = d && d.meta ? (d.meta as any).date : null;
      return { label: clean(d ? d.label : 'Günlük not'), ts: toTs(date), meta: { daily: true, date } };
    }
    if (r.type === 'trade') {
      const t = tradeInfo.get(r.id)!;
      const m = (t.meta || {}) as any;
      return { label: clean(t.label), ts: toTs(m.date), meta: { ticker: m.ticker, pl: m.pl, date: m.date } };
    }
    if (r.type === 'news') {
      const t = newsInfo.get(r.id)!;
      const m = (t.meta || {}) as any;
      return { label: clean(t.label), ts: toTs(m.publishedAt), meta: { source: m.source, url: m.url, date: m.publishedAt } };
    }
    const c = cards.get(r.id);
    return { label: clean(c.front, 60) || 'Kart', ts: toTs(c.updatedAt), meta: { deckId: c.deckId, date: new Date(c.updatedAt).toISOString() } };
  };

  const degree = new Map<string, number>();
  const refByKey = new Map<string, Ref>();
  const recount = () => {
    degree.clear();
    for (const e of edges) {
      for (const r of [e.a, e.b]) {
        const k = key(r);
        refByKey.set(k, r);
        degree.set(k, (degree.get(k) || 0) + 1);
      }
    }
  };
  recount();

  const info = new Map<string, Info>();
  const infoOf = (k: string): Info => {
    let v = info.get(k);
    if (!v) { v = nodeInfo(refByKey.get(k)!); info.set(k, v); }
    return v;
  };

  // ── Search: matching nodes plus their direct neighbours ──
  const q = foldText(opts.q).trim();
  if (q) {
    const hit = new Set<string>();
    for (const k of degree.keys()) if (foldText(infoOf(k).label).includes(q)) hit.add(k);
    const keep = new Set(hit);
    for (const e of edges) {
      const ka = key(e.a);
      const kb = key(e.b);
      if (hit.has(ka)) keep.add(kb);
      if (hit.has(kb)) keep.add(ka);
    }
    edges = edges.filter((e) => keep.has(key(e.a)) && keep.has(key(e.b)));
    recount();
  }

  // ── Cap: prefer well connected, then recently updated ──
  let keys = [...degree.keys()];
  let truncated = false;
  if (keys.length > opts.limit) {
    truncated = true;
    keys.sort((x, y) => (degree.get(y)! - degree.get(x)!) || (infoOf(y).ts - infoOf(x).ts));
    const keep = new Set(keys.slice(0, opts.limit));
    edges = edges.filter((e) => keep.has(key(e.a)) && keep.has(key(e.b)));
    recount();
    keys = [...degree.keys()];
  }

  const nodes: GraphNode[] = keys.map((k) => {
    const i = infoOf(k);
    return { id: k, type: refByKey.get(k)!.type, label: i.label, meta: { ...i.meta, degree: degree.get(k) || 0 } };
  });
  const outEdges: GraphEdge[] = edges.map((e) => ({ id: e.id, source: key(e.a), target: key(e.b), kind: e.kind }));

  // ── Project hubs for the included tasks ──
  if (opts.types.has('project')) {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      if (n.type !== 'task') continue;
      const pid = (n.meta as any).projectId as string | null;
      const p = pid ? projects.get(pid) : null;
      if (!p || p.is_inbox) continue;
      counts.set(p.id, (counts.get(p.id) || 0) + 1);
      outEdges.push({ id: `proj:${p.id}:${n.id}`, source: `project:${p.id}`, target: n.id, kind: 'project' });
    }
    for (const [pid, count] of counts) {
      const p = projects.get(pid);
      nodes.push({ id: `project:${pid}`, type: 'project', label: clean(p.name), meta: { color: p.color, icon: p.icon, taskCount: count, degree: count } });
    }
  }

  return { nodes, edges: outEdges, truncated };
}

const graph = new Hono<HonoEnv>();

// GET /api/graph?types=task,note,trade,news,card,project&limit=300&q=
graph.get('/api/graph', requiresLogin, (c) => {
  try {
    const typesRaw = c.req.query('types');
    const types = new Set<GraphNodeType>(
      typesRaw
        ? typesRaw.split(',').map((s) => s.trim()).filter((s): s is GraphNodeType => (NODE_TYPES as string[]).includes(s))
        : NODE_TYPES,
    );
    const limitNum = Number(c.req.query('limit'));
    const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(MAX_LIMIT, Math.floor(limitNum)) : DEFAULT_LIMIT;
    const q = (c.req.query('q') || '').slice(0, 100);
    return c.json(buildGraph(c.get('db'), c.get('user').id, { types, limit, q }));
  } catch (err) {
    return sendError(c, err, 'Graph');
  }
});

export default graph;
