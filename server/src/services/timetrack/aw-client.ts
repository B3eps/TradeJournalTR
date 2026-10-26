/**
 * Minimal client for the local ActivityWatch REST API (http://localhost:5600).
 * Every call has a short timeout and throws a typed error, so callers can fail
 * soft when ActivityWatch is not running. Only the local server is contacted.
 */

export const AW_BASE_URL = (process.env.ACTIVITYWATCH_URL || 'http://localhost:5600').replace(/\/+$/, '');
const TIMEOUT_MS = 4000;
const QUERY_TIMEOUT_MS = 20000;

export interface AwInfo {
  hostname?: string;
  version?: string;
  device_id?: string;
  testing?: boolean;
}

export interface AwBucket {
  id: string;
  type?: string;
  client?: string;
  hostname?: string;
  last_updated?: string;
}

export interface AwEvent {
  id?: number | null;
  timestamp: string;
  duration: number;
  data: Record<string, any>;
}

export class AwUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AwUnavailableError';
  }
}

async function awFetch<T>(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${AW_BASE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new AwUnavailableError(err?.name === 'AbortError' ? 'timeout' : (err?.cause?.code || err?.message || 'unreachable'));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
    throw new Error(`ActivityWatch HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

export function getInfo(): Promise<AwInfo> {
  return awFetch<AwInfo>('/api/0/info');
}

export async function getBuckets(): Promise<AwBucket[]> {
  const raw = await awFetch<Record<string, AwBucket>>('/api/0/buckets/');
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw).map(([id, b]) => ({ ...(b || {}), id: (b && b.id) || id }));
}

/**
 * Runs a query2 program over one or more "start/end" ISO time periods.
 * ActivityWatch returns one result per time period, in order.
 */
export async function runQuery<T = any>(query: string[], timeperiods: string[]): Promise<T[]> {
  const result = await awFetch<T[]>(
    '/api/0/query/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, timeperiods }),
    },
    QUERY_TIMEOUT_MS,
  );
  if (!Array.isArray(result)) throw new Error('Unexpected query response');
  return result;
}

export interface ResolvedBuckets {
  hostname: string | null;
  window: string | null;
  afk: string | null;
  web: string[];
  all: string[];
}

/** Picks the window/afk buckets for this machine (falls back to the first found). */
export function resolveBuckets(buckets: AwBucket[], hostname?: string | null): ResolvedBuckets {
  const ids = buckets.map((b) => b.id).sort();
  const pick = (prefix: string): string | null => {
    const matches = ids.filter((id) => id.startsWith(prefix));
    if (matches.length === 0) return null;
    if (hostname) {
      const exact = matches.find((id) => id === `${prefix}${hostname}`);
      if (exact) return exact;
    }
    // Prefer the most recently updated bucket
    const byUpdate = buckets
      .filter((b) => matches.includes(b.id))
      .sort((a, b) => String(b.last_updated || '').localeCompare(String(a.last_updated || '')));
    return byUpdate[0]?.id || matches[0];
  };
  return {
    hostname: hostname || null,
    window: pick('aw-watcher-window_'),
    afk: pick('aw-watcher-afk_'),
    web: ids.filter((id) => id.startsWith('aw-watcher-web')),
    all: ids,
  };
}
