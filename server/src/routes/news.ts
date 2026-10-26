import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

// Forex Factory weekly economic calendar (free public JSON feed, no API key).
// The feed is rate-limited, so results are cached in memory. No user data is
// ever sent outwards: the request carries no query string, cookies or body.
const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000; // back off 5 min after a failed fetch
const FETCH_TIMEOUT_MS = 10 * 1000;

interface CalendarEvent {
  title: string;
  country: string;
  date: string; // ISO 8601 with offset
  impact: string; // High | Medium | Low | Holiday
  forecast: string;
  previous: string;
  actual: string;
}

let cache: { events: CalendarEvent[]; fetchedAt: number } | null = null;
let lastFailureAt = 0;
let inflight: Promise<CalendarEvent[]> | null = null;

function normalize(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) throw new Error('Unexpected feed format');
  return raw
    .filter((e: any) => e && typeof e === 'object' && e.date && e.title)
    .map((e: any) => ({
      title: String(e.title ?? ''),
      country: String(e.country ?? ''),
      date: String(e.date ?? ''),
      impact: String(e.impact ?? ''),
      forecast: String(e.forecast ?? ''),
      previous: String(e.previous ?? ''),
      actual: String(e.actual ?? ''),
    }))
    .filter((e) => !isNaN(new Date(e.date).getTime()))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

async function fetchFeed(): Promise<CalendarEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FEED_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Feed responded with HTTP ${res.status}`);
    return normalize(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

const news = new Hono<HonoEnv>();

// GET /api/news/calendar
// Response: { events, fetchedAt, stale, error? }
news.get('/api/news/calendar', requiresLogin, async (c) => {
  const now = Date.now();
  const fresh = cache && now - cache.fetchedAt < CACHE_TTL_MS;
  const inBackoff = now - lastFailureAt < RETRY_AFTER_FAILURE_MS;

  if (fresh || (cache && inBackoff)) {
    return c.json({
      events: cache!.events,
      fetchedAt: new Date(cache!.fetchedAt).toISOString(),
      stale: !fresh,
    });
  }

  if (!cache && inBackoff) {
    return c.json({ events: [], fetchedAt: null, stale: true, error: 'fetch_failed' });
  }

  try {
    if (!inflight) {
      inflight = fetchFeed().finally(() => { inflight = null; });
    }
    const events = await inflight;
    cache = { events, fetchedAt: Date.now() };
    lastFailureAt = 0;
    return c.json({ events, fetchedAt: new Date(cache.fetchedAt).toISOString(), stale: false });
  } catch (err: any) {
    lastFailureAt = Date.now();
    console.error('[News] calendar fetch failed:', err?.message || err);
    return c.json({
      events: cache ? cache.events : [],
      fetchedAt: cache ? new Date(cache.fetchedAt).toISOString() : null,
      stale: true,
      error: 'fetch_failed',
    });
  }
});

export default news;
