import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import { NEWS_CATEGORIES, type NewsCategory } from '../services/newsfeed/sources';
import { buildFeedResponse, forceRefresh, getItemWithEvaluation, saveEvaluation, type FeedQuery } from '../services/newsfeed';
import { buildAskPrompt } from '../services/newsfeed/evaluation';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

// Live news feed aggregated from public RSS/Atom/JSON sources (see
// services/newsfeed). Only outbound requests are the feed GETs themselves.

function parseQuery(q: (k: string) => string | undefined): FeedQuery {
  const cat = (q('category') || 'all').toLowerCase();
  const minImp = parseInt(q('minImportance') || '0', 10);
  const limit = parseInt(q('limit') || '100', 10);
  const sinceRaw = q('since');
  const sinceTs = sinceRaw ? Date.parse(sinceRaw) : NaN;
  return {
    category: NEWS_CATEGORIES.includes(cat as NewsCategory) ? (cat as NewsCategory) : undefined,
    minImportance: Number.isFinite(minImp) ? Math.min(3, Math.max(0, minImp)) : 0,
    limit: Number.isFinite(limit) ? Math.min(300, Math.max(1, limit)) : 100,
    since: Number.isFinite(sinceTs) ? new Date(sinceTs).toISOString() : undefined,
  };
}

const newsfeed = new Hono<HonoEnv>();

// GET /api/newsfeed?category=all|forex|nasdaq|crypto&minImportance=0..3&limit=1..300&since=ISO
newsfeed.get('/api/newsfeed', requiresLogin, (c) => {
  try {
    return c.json(buildFeedResponse(parseQuery((k) => c.req.query(k))));
  } catch (err: any) {
    console.error('[NewsFeed] GET failed:', err?.message || err);
    return c.json({ items: [], fetchedAt: null, sources: [], pendingEvaluations: 0, error: 'newsfeed_failed' }, 500);
  }
});

// POST /api/newsfeed/refresh (forced poll, max once per 20 s)
newsfeed.post('/api/newsfeed/refresh', requiresLogin, async (c) => {
  try {
    const refreshed = await forceRefresh();
    const body = buildFeedResponse(parseQuery((k) => c.req.query(k)));
    return c.json(refreshed ? body : { ...body, throttled: true });
  } catch (err: any) {
    console.error('[NewsFeed] refresh failed:', err?.message || err);
    return c.json({ items: [], fetchedAt: null, sources: [], pendingEvaluations: 0, error: 'newsfeed_failed' }, 500);
  }
});

// GET /api/newsfeed/ask/:id -> { prompt } (self-contained Turkish evaluation prompt)
newsfeed.get('/api/newsfeed/ask/:id', requiresLogin, (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: 'invalid_id' }, 400);
  const item = getItemWithEvaluation(id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  return c.json({ prompt: buildAskPrompt(item) });
});

// POST /api/newsfeed/evaluation/:id accepts only the matching JSON response.
newsfeed.post('/api/newsfeed/evaluation/:id', requiresLogin, async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: 'invalid_id' }, 400);
  const text = await c.req.text();
  if (text.length > 256 * 1024) return c.json({ error: 'payload_too_large' }, 413);
  let raw: unknown;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    raw = JSON.parse(cleaned);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const item = getItemWithEvaluation(id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  if (item.evaluation) return c.json({ error: 'already_evaluated' }, 409);
  const evaluation = saveEvaluation(id, raw);
  if (!evaluation) return c.json({ error: 'invalid_evaluation' }, 400);
  return c.json({ evaluation });
});

export default newsfeed;
