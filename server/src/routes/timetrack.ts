import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import { disableActivityWatchAutoStart, isActivityWatchAutoStartEnabled, startActivityWatch } from '../services/timetrack/launcher';
import {
  getStatus,
  getSummary,
  clearSummaryCache,
  RangeError400,
  getCategories,
  replaceCategories,
  CategoryValidationError,
  CATEGORY_LIMITS,
} from '../services/timetrack';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

// Time tracking backed by the local ActivityWatch server (http://localhost:5600).
// All ActivityWatch failures are reported as { available: false, reason } with
// HTTP 200 so the page can show a friendly state instead of an error.
const timetrack = new Hono<HonoEnv>();

timetrack.post('/api/timetrack/start', requiresLogin, async (c) => {
  try {
    return c.json(await startActivityWatch());
  } catch (err: any) {
    console.error('[TimeTrack] ActivityWatch start failed:', err?.message || err);
    return c.json({ error: err?.message || 'ActivityWatch başlatılamadı.' }, 503);
  }
});

timetrack.post('/api/timetrack/disable-autostart', requiresLogin, (c) => {
  disableActivityWatchAutoStart();
  return c.json({ autoStart: false });
});

// GET /api/timetrack/status
timetrack.get('/api/timetrack/status', requiresLogin, async (c) => {
  try {
    return c.json({ ...await getStatus(), autoStart: isActivityWatchAutoStartEnabled() });
  } catch (err: any) {
    console.error('[TimeTrack] status failed:', err?.message || err);
    return c.json({ available: false, reason: 'error', buckets: [], hasWebWatcher: false });
  }
});

// GET /api/timetrack/summary?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive local days, default today)
timetrack.get('/api/timetrack/summary', requiresLogin, async (c) => {
  const from = c.req.query('from') || null;
  const to = c.req.query('to') || null;
  try {
    return c.json(await getSummary(from, to));
  } catch (err: any) {
    if (err instanceof RangeError400) return c.json({ error: err.message }, 400);
    console.error('[TimeTrack] summary failed:', err?.message || err);
    return c.json({ available: false, reason: 'error', message: 'Özet hesaplanamadı.' });
  }
});

// GET /api/timetrack/categories
timetrack.get('/api/timetrack/categories', requiresLogin, (c) => {
  try {
    return c.json({ categories: getCategories(), limits: CATEGORY_LIMITS });
  } catch (err: any) {
    console.error('[TimeTrack] categories read failed:', err?.message || err);
    return c.json({ error: 'Kategoriler okunamadı.' }, 500);
  }
});

// PUT /api/timetrack/categories  body: { categories: [...] } or [...]
timetrack.put('/api/timetrack/categories', requiresLogin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Geçersiz istek gövdesi (JSON bekleniyordu).' }, 400);
  }
  try {
    const categories = replaceCategories(body);
    clearSummaryCache();
    return c.json({ categories, limits: CATEGORY_LIMITS });
  } catch (err: any) {
    if (err instanceof CategoryValidationError) return c.json({ error: err.message }, 400);
    console.error('[TimeTrack] categories save failed:', err?.message || err);
    return c.json({ error: 'Kategoriler kaydedilemedi.' }, 500);
  }
});

export default timetrack;
