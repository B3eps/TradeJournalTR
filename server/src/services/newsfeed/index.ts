import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../../config';
import { getDb } from '../../db/connection';
import * as newsDb from '../../db/news-items';
import type { NewsItemRow } from '../../db/news-items';
import { NEWS_SOURCES, userAgent, type NewsCategory, type NewsSource } from './sources';
import { truncate } from './feed-parser';
import { scoreItem } from './scoring';
import { QUEUE_SCHEMA_MD, buildAskPrompt, evaluationInputSchema, sanitizeEvaluation, type Evaluation } from './evaluation';
import { notifyCriticalNews, notifyCriticalEvaluation } from '../ntfy';

export const NEWS_QUEUE_DIR = path.join(DATA_DIR, 'news-queue');
export const NEWS_EVAL_DIR = path.join(DATA_DIR, 'news-eval');

const POLL_INTERVAL_MS = 90 * 1000;
const POLL_JITTER_MS = 20 * 1000;
const MIN_REQUEST_SPACING_MS = 60 * 1000; // never more than 1 request/source/minute
const MAX_BACKOFF_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
const FORCE_REFRESH_MIN_MS = 20 * 1000;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const BACKLOG_AGE_MS = 6 * 60 * 60 * 1000; // older items are never flagged as "new"
const QUEUE_MIN_IMPORTANCE = 2;
const QUEUE_MAX = 15;
const TICK_MS = 5 * 1000;

export interface NewsItem {
  id: string;
  source: string;
  sourceId: string;
  category: NewsCategory;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  importance: number;
  tags: string[];
  instruments: string[];
  evaluation: Evaluation | null;
}

interface SourceState {
  ok: boolean;
  lastFetchAt: string | null; // last successful fetch
  lastAttemptAt: number;
  error?: string;
  failures: number;
  nextAt: number;
  etag?: string;
  lastModified?: string;
  lastCount: number;
  inflight: Promise<void> | null;
}

const state = new Map<string, SourceState>(
  NEWS_SOURCES.map((s) => [s.id, { ok: false, lastFetchAt: null, lastAttemptAt: 0, failures: 0, nextAt: 0, lastCount: 0, inflight: null }]),
);
let started = false;
let lastForcedAt = 0;
let lastCycleAt: string | null = null;

export function newsItemId(sourceId: string, link: string): string {
  return crypto.createHash('sha1').update(`${sourceId}|${link}`).digest('hex').slice(0, 16);
}

function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 200));
  const label = contentType?.match(/charset=([\w-]+)/i)?.[1] || head.match(/encoding=["']([\w-]+)["']/i)?.[1] || 'utf-8';
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** One HTTP fetch + parse of a source. Returns null on 304 Not Modified. */
export async function fetchSourceItems(src: NewsSource, st?: SourceState) {
  const headers: Record<string, string> = {
    'User-Agent': userAgent(),
    Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, application/json;q=0.8, */*;q=0.5',
  };
  if (st?.etag) headers['If-None-Match'] = st.etag;
  if (st?.lastModified) headers['If-Modified-Since'] = st.lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(src.url, { headers, signal: controller.signal, redirect: 'follow' });
    if (res.status === 304) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = decodeBody(await res.arrayBuffer(), res.headers.get('content-type'));
    if (st) {
      st.etag = res.headers.get('etag') || undefined;
      st.lastModified = res.headers.get('last-modified') || undefined;
    }
    return src.parser(body);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Raw feed item -> scored item, or null when unusable / out of retention. */
export function normalizeItem(src: NewsSource, raw: { title: string; url: string; summary: string; publishedAt: string | null }, now = Date.now()) {
  const url = raw.url.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  let published = raw.publishedAt ? Date.parse(raw.publishedAt) : now;
  if (!Number.isFinite(published) || published > now + 5 * 60 * 1000) published = now;
  if (published < now - RETENTION_MS) return null;
  const title = truncate(raw.title, 300);
  let summary = raw.summary;
  if (summary === title || summary.startsWith(title)) summary = summary.slice(title.length).trim();
  summary = truncate(summary, 400);
  const scored = scoreItem({ title, summary, sourceId: src.id, category: src.category });
  return {
    id: newsItemId(src.id, url),
    sourceId: src.id,
    source: src.name,
    category: src.category,
    title,
    summary,
    url,
    publishedAt: new Date(published).toISOString(),
    ...scored,
  };
}

async function pollSource(src: NewsSource, counts: Map<string, number>): Promise<void> {
  const st = state.get(src.id)!;
  const now = Date.now();
  st.lastAttemptAt = now;
  try {
    const raw = await fetchSourceItems(src, st);
    st.ok = true;
    st.error = undefined;
    st.failures = 0;
    st.lastFetchAt = new Date().toISOString();
    if (raw) {
      const backlog = (counts.get(src.id) ?? 0) === 0; // first time we ever see this source
      const items = raw
        .map((r) => normalizeItem(src, r, now))
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((it) => ({
          ...it,
          firstSeenAt: backlog || Date.parse(it.publishedAt) < now - BACKLOG_AGE_MS ? it.publishedAt : new Date(now).toISOString(),
        }));
      st.lastCount = items.length;
      // Integrations hook: newly stored, recent important items (never the initial backlog)
      let fresh: typeof items = [];
      try {
        if (!backlog) fresh = items.filter((it) => it.importance >= 2 && Date.parse(it.publishedAt) >= now - BACKLOG_AGE_MS && !newsDb.getNewsItem(getDb(), it.id));
      } catch { fresh = []; }
      if (items.length) newsDb.upsertNewsItems(getDb(), items);
      for (const it of fresh) {
        // Precious-metal pushes wait for the Turkish evaluation; other categories keep their current headline alert.
        if (it.instruments.includes('XAU') || it.instruments.includes('XAG')) continue;
        try { notifyCriticalNews(it); } catch { /* never break polling */ }
      }
    }
    st.nextAt = Date.now() + POLL_INTERVAL_MS + Math.random() * POLL_JITTER_MS;
  } catch (err: any) {
    st.ok = false;
    st.error = String(err?.message || err).slice(0, 200);
    st.failures++;
    const backoff = Math.min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2 ** st.failures);
    st.nextAt = Date.now() + backoff + Math.random() * POLL_JITTER_MS;
    console.warn(`[NewsFeed] ${src.id} failed (${st.failures}x): ${st.error}`);
  }
}

/** Polls the given sources (skipping inflight / too-recent ones), then rewrites the queue. */
async function runCycle(sources: NewsSource[]): Promise<void> {
  let counts: Map<string, number>;
  try {
    counts = newsDb.countNewsItemsBySource(getDb());
  } catch (err) {
    console.error('[NewsFeed] db unavailable:', err);
    return;
  }
  const jobs = sources.map((src) => {
    const st = state.get(src.id)!;
    if (st.inflight) return st.inflight;
    if (Date.now() - st.lastAttemptAt < MIN_REQUEST_SPACING_MS) return Promise.resolve();
    st.inflight = pollSource(src, counts).finally(() => { st.inflight = null; });
    return st.inflight;
  });
  await Promise.allSettled(jobs);
  lastCycleAt = new Date().toISOString();
  try {
    writeQueue();
  } catch (err: any) {
    console.warn('[NewsFeed] queue write failed:', err?.message || err);
  }
}

function tick(): void {
  const now = Date.now();
  const due = NEWS_SOURCES.filter((s) => {
    const st = state.get(s.id)!;
    return !st.inflight && st.nextAt <= now;
  });
  if (due.length) runCycle(due).catch((err) => console.error('[NewsFeed] cycle failed:', err));
}

// --- evaluations (read from DATA_DIR/news-eval/<id>.json) ---

const evalCache = new Map<string, { mtimeMs: number; size: number; ev: Evaluation | null }>();
let lastEvalScan = 0;

export function scanEvaluations(force = false): Map<string, Evaluation> {
  const now = Date.now();
  if (force || now - lastEvalScan > 2000) {
    lastEvalScan = now;
    let files: string[] = [];
    try {
      files = fs.readdirSync(NEWS_EVAL_DIR);
    } catch {
      files = [];
    }
    const seen = new Set<string>();
    for (const f of files) {
      const m = f.match(/^([0-9a-f]{16})\.json$/);
      if (!m) continue;
      const id = m[1];
      seen.add(id);
      try {
        const full = path.join(NEWS_EVAL_DIR, f);
        const stat = fs.statSync(full);
        const cached = evalCache.get(id);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) continue;
        let ev: Evaluation | null = null;
        if (stat.size <= 256 * 1024) {
          try {
            const text = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
            ev = sanitizeEvaluation(JSON.parse(text), id, stat.mtime);
          } catch {
            ev = null; // invalid JSON: ignore until the file changes
          }
        }
        evalCache.set(id, { mtimeMs: stat.mtimeMs, size: stat.size, ev });
      } catch {
        // file vanished between readdir and stat
      }
    }
    for (const id of [...evalCache.keys()]) if (!seen.has(id)) evalCache.delete(id);
  }
  const out = new Map<string, Evaluation>();
  for (const [id, c] of evalCache) if (c.ev) out.set(id, c.ev);
  return out;
}

/** An evaluation file that exists but is invalid still counts as "has a file". */
function hasEvaluationFile(id: string): boolean {
  return evalCache.has(id);
}

// --- queue (DATA_DIR/news-queue/pending.json) ---

let lastQueueJson = '';

function rowToQueueEntry(r: NewsItemRow) {
  return {
    id: r.id, source: r.source, category: r.category, title: r.title, summary: r.summary,
    url: r.url, publishedAt: r.published_at, importance: r.importance,
    tags: safeJsonArray(r.tags), instruments: safeJsonArray(r.instruments),
  };
}

function pendingRows(): NewsItemRow[] {
  scanEvaluations();
  return newsDb.listQueueCandidates(getDb(), QUEUE_MIN_IMPORTANCE, 300)
    .filter((r) => !hasEvaluationFile(r.id))
    .slice(0, QUEUE_MAX);
}

function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows: target may be briefly locked by a reader; fall back to direct write
    fs.writeFileSync(file, content, 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** Save a user-pasted external evaluation after validating it against this news item. */
export function saveEvaluation(id: string, raw: unknown): Evaluation | null {
  if (!/^[0-9a-f]{16}$/.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = evaluationInputSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== id) return null;
  const item = newsDb.getNewsItem(getDb(), id);
  if (!item) return null;
  const evaluation = sanitizeEvaluation(parsed.data, id, new Date());
  if (!evaluation || !evaluation.ozet) return null;
  fs.mkdirSync(NEWS_EVAL_DIR, { recursive: true });
  writeFileAtomic(path.join(NEWS_EVAL_DIR, `${id}.json`), `${JSON.stringify(evaluation, null, 2)}\n`);
  evalCache.delete(id);
  lastEvalScan = 0;
  scanEvaluations(true);
  try {
    const instruments = safeJsonArray(item.instruments);
    notifyCriticalEvaluation({
      id, source: item.source, category: item.category, title: item.title,
      importance: item.importance, url: item.url, publishedAt: item.published_at,
      instruments, evaluation,
    });
  } catch { /* push notifications must not prevent saving a valid evaluation */ }
  return evaluation;
}

export function writeQueue(): void {
  const json = JSON.stringify(pendingRows().map(rowToQueueEntry), null, 2);
  const file = path.join(NEWS_QUEUE_DIR, 'pending.json');
  if (json === lastQueueJson && fs.existsSync(file)) return;
  fs.mkdirSync(NEWS_QUEUE_DIR, { recursive: true });
  writeFileAtomic(file, json + '\n');
  lastQueueJson = json;
}

// --- API helpers ---

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rowToItem(r: NewsItemRow, evals: Map<string, Evaluation>): NewsItem {
  return {
    id: r.id,
    source: r.source,
    sourceId: r.source_id,
    category: r.category as NewsCategory,
    title: r.title,
    summary: r.summary,
    url: r.url,
    publishedAt: r.published_at,
    importance: r.importance,
    tags: safeJsonArray(r.tags),
    instruments: safeJsonArray(r.instruments),
    evaluation: evals.get(r.id) ?? null,
  };
}

export interface FeedQuery {
  category?: NewsCategory;
  minImportance: number;
  limit: number;
  since?: string;
}

export function buildFeedResponse(q: FeedQuery) {
  const db = getDb();
  const evals = scanEvaluations();
  const rows = newsDb.listNewsItems(db, q);
  const counts = newsDb.countNewsItemsBySource(db);
  const sources = NEWS_SOURCES.map((s) => {
    const st = state.get(s.id)!;
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      ok: st.ok,
      lastFetchAt: st.lastFetchAt,
      itemCount: counts.get(s.id) ?? 0,
      ...(st.error ? { error: st.error } : {}),
    };
  });
  let pendingEvaluations = 0;
  try {
    pendingEvaluations = pendingRows().length;
  } catch {
    pendingEvaluations = 0;
  }
  return {
    items: rows.map((r) => rowToItem(r, evals)),
    fetchedAt: lastCycleAt,
    sources,
    pendingEvaluations,
  };
}

/** Forced poll, at most once per 20 s. Returns false when throttled. */
export async function forceRefresh(): Promise<boolean> {
  const now = Date.now();
  if (now - lastForcedAt < FORCE_REFRESH_MIN_MS) return false;
  lastForcedAt = now;
  ensureStarted();
  await runCycle(NEWS_SOURCES);
  return true;
}

export function getItemWithEvaluation(id: string): NewsItem | null {
  const row = newsDb.getNewsItem(getDb(), id);
  return row ? rowToItem(row, scanEvaluations()) : null;
}

/** Return the newest fresh, unevaluated XAU/XAG story for the local ChatGPT worker. */
export function getNextMetalEvaluation(excludedIds: string[] = []): { id: string; prompt: string } | null {
  const excluded = new Set(excludedIds.filter((id) => /^[0-9a-f]{16}$/.test(id)));
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates = pendingRows();
  for (const row of candidates) {
    if (excluded.has(row.id) || Date.parse(row.first_seen_at) < cutoff) continue;
    const values = [row.instruments, row.tags, row.title, row.summary].join(' ').toLocaleLowerCase('en-US');
    if (!/(?:\bxau\b|\bxag\b|\bgold\b|\bsilver\b|\bprecious metals?\b)/i.test(values)) continue;
    const item = rowToItem(row, scanEvaluations());
    return { id: row.id, prompt: buildMetalPrompt(item) };
  }
  return null;
}

/** Build the validated one-item prompt used by both manual and automatic ChatGPT analysis. */
export function getMetalEvaluationPrompt(id: string): string | null {
  if (!/^[0-9a-f]{16}$/.test(id)) return null;
  const item = getItemWithEvaluation(id);
  if (!item || item.evaluation) return null;
  const values = [...item.instruments, ...item.tags, item.title, item.summary].join(' ').toLocaleLowerCase('en-US');
  if (!/(?:\bxau\b|\bxag\b|\bgold\b|\bsilver\b|\bprecious metals?\b)/i.test(values)) return null;
  return buildMetalPrompt(item);
}

function buildMetalPrompt(item: NewsItem): string {
  return [
    'Bu haber için kısa, anlaşılır ve arkadaşça Türkçe bir piyasa özeti hazırla. Başlığı da doğal Türkçeye çevir.',
    'Özellikle altın (XAU) ve gümüş (XAG) etkisini ayrı ayrı değerlendir. Haber bunlarla ilgili değilse ilişki uydurma; yalnız kanıtlanan bağlantıyı ve belirsizliği yaz.',
    'Yalnızca JSON döndür; al/sat, işlem aç/kapat, fiyat seviyesi, lot veya pozisyon önerisi verme. Haberde olmayan bilgiyi uydurma.',
    buildAskPrompt(item),
  ].join('\n\n');
}

/** Recent evaluated gold/silver stories for the morning digest. */
export function getRecentMetalEvaluations(since: Date, limit = 3): NewsItem[] {
  try {
    const evals = scanEvaluations();
    return newsDb.listNewsItems(getDb(), { minImportance: 1, limit: 300 })
      .map((row) => rowToItem(row, evals))
      .filter((item) => Date.parse(item.publishedAt) >= since.getTime())
      .filter((item) => item.evaluation && (item.instruments.includes('XAU') || item.instruments.includes('XAG')))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, Math.max(0, Math.min(5, limit)));
  } catch {
    return [];
  }
}

function prune(): void {
  try {
    const removed = newsDb.pruneNewsItems(getDb(), new Date(Date.now() - RETENTION_MS).toISOString());
    if (removed) console.log(`[NewsFeed] pruned ${removed} old items`);
  } catch (err: any) {
    console.warn('[NewsFeed] prune failed:', err?.message || err);
  }
}

function ensureStarted(): void {
  if (started) return;
  started = true;
  try {
    fs.mkdirSync(NEWS_QUEUE_DIR, { recursive: true });
    fs.mkdirSync(NEWS_EVAL_DIR, { recursive: true });
    writeFileAtomic(path.join(NEWS_QUEUE_DIR, 'SCHEMA.md'), QUEUE_SCHEMA_MD);
  } catch (err: any) {
    console.warn('[NewsFeed] could not prepare queue dirs:', err?.message || err);
  }
  prune();
  setInterval(prune, 24 * 60 * 60 * 1000).unref();
  setInterval(tick, TICK_MS).unref();
  tick(); // initial fetch of every source (nextAt = 0)
}

/** Boot hook (node.ts). Never throws. */
export function startNewsFeed(): void {
  try {
    ensureStarted();
    console.log(`[NewsFeed] polling ${NEWS_SOURCES.length} sources`);
  } catch (err) {
    console.error('[NewsFeed] failed to start:', err);
  }
}
