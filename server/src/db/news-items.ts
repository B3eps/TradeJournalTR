import type { Db } from './connection';

export interface NewsItemRow {
  id: string;
  source_id: string;
  source: string;
  category: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  first_seen_at: string;
  importance: number;
  tags: string;
  instruments: string;
}

export interface NewsItemInput {
  id: string;
  sourceId: string;
  source: string;
  category: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  firstSeenAt: string;
  importance: number;
  tags: string[];
  instruments: string[];
}

/** Inserts new items; re-seen items get refreshed text/score but keep first_seen_at. */
export function upsertNewsItems(db: Db, items: NewsItemInput[]): number {
  const exists = db.prepare('SELECT 1 FROM news_items WHERE id = ?');
  const stmt = db.prepare(`
    INSERT INTO news_items (id, source_id, source, category, title, summary, url, published_at, first_seen_at, importance, tags, instruments)
    VALUES (@id, @sourceId, @source, @category, @title, @summary, @url, @publishedAt, @firstSeenAt, @importance, @tags, @instruments)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, summary = excluded.summary, importance = excluded.importance,
      tags = excluded.tags, instruments = excluded.instruments, source = excluded.source
  `);
  let inserted = 0;
  db.transaction(() => {
    for (const it of items) {
      if (!exists.get(it.id)) inserted++;
      stmt.run({ ...it, tags: JSON.stringify(it.tags), instruments: JSON.stringify(it.instruments) });
    }
  })();
  return inserted;
}

export function countNewsItemsBySource(db: Db): Map<string, number> {
  const rows = db.prepare('SELECT source_id, COUNT(*) AS n FROM news_items GROUP BY source_id').all() as Array<{ source_id: string; n: number }>;
  return new Map(rows.map((r) => [r.source_id, r.n]));
}

export function listNewsItems(db: Db, opts: { category?: string; minImportance: number; limit: number; since?: string }): NewsItemRow[] {
  const where: string[] = ['importance >= @minImportance'];
  if (opts.category) where.push('category = @category');
  if (opts.since) where.push('first_seen_at > @since');
  return db.prepare(`SELECT * FROM news_items WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT @limit`)
    .all({ minImportance: opts.minImportance, category: opts.category ?? null, since: opts.since ?? null, limit: opts.limit }) as NewsItemRow[];
}

export function getNewsItem(db: Db, id: string): NewsItemRow | undefined {
  return db.prepare('SELECT * FROM news_items WHERE id = ?').get(id) as NewsItemRow | undefined;
}

export function listQueueCandidates(db: Db, minImportance: number, limit: number): NewsItemRow[] {
  return db.prepare('SELECT * FROM news_items WHERE importance >= ? ORDER BY published_at DESC LIMIT ?')
    .all(minImportance, limit) as NewsItemRow[];
}

export function pruneNewsItems(db: Db, olderThanIso: string): number {
  return db.prepare('DELETE FROM news_items WHERE published_at < ?').run(olderThanIso).changes;
}
