import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import { getDb } from '../db/connection';
import { ApiError, readJson, sendError } from '../db/tasks';
import * as store from '../services/google/store';
import * as oauth from '../services/google/oauth';
import { GoogleError } from '../services/google/http';
import { syncClassroom } from '../services/google/sync';
import { listUpcomingEvents, eventToTask } from '../services/google/calendar';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const google = new Hono<HonoEnv>();

/** GoogleError -> JSON with its Turkish message; everything else via sendError. */
function fail(c: Context<HonoEnv>, err: unknown, tag: string) {
  if (err instanceof GoogleError) {
    const known = [400, 401, 403, 404, 429] as const;
    const status = (known as readonly number[]).includes(err.status) ? (err.status as (typeof known)[number]) : 502;
    return c.json({ error: err.message, code: err.code }, status);
  }
  return sendError(c, err, tag);
}

function requestPort(c: Context<HonoEnv>): number {
  let host = c.req.header('host');
  if (!host) {
    try { host = new URL(c.req.url).host; } catch { /* ignore */ }
  }
  return oauth.resolvePort(host);
}

function maskClientId(id: string): string {
  const dot = id.indexOf('.');
  const head = dot > 0 ? id.slice(0, dot) : id;
  return `${head.slice(0, 6)}…${dot > 0 ? id.slice(dot) : ''}`;
}

// GET /api/google/status
google.get('/api/google/status', requiresLogin, (c) => {
  try {
    const row = store.getAuthRow(c.get('db'), c.get('user').id);
    let lastSummary: unknown = null;
    try { lastSummary = row?.last_summary ? JSON.parse(row.last_summary) : null; } catch { /* ignore */ }
    return c.json({
      configured: !!(row?.client_id && row.client_secret_enc),
      connected: !!(row?.client_id && row.refresh_token_enc),
      email: row?.email ?? null,
      clientIdHint: row?.client_id ? maskClientId(row.client_id) : null,
      connectedAt: row?.connected_at ?? null,
      autoSync: row ? !!row.auto_sync : true,
      includeUndated: row ? !!row.include_undated : true,
      lastSyncAt: row?.last_sync_at ?? null,
      lastError: row?.last_error ?? null,
      lastSummary,
      redirectUri: oauth.redirectUriFor(requestPort(c)),
      scopes: oauth.SCOPES,
    });
  } catch (err) {
    return fail(c, err, 'Google status');
  }
});

// PUT /api/google/credentials { clientId, clientSecret }
google.put('/api/google/credentials', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    if (!clientId || !clientSecret) throw new ApiError(400, 'İstemci kimliği ve gizli anahtar zorunludur.');
    if (clientId.length > 300 || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new ApiError(400, 'İstemci kimliği "...apps.googleusercontent.com" ile biten bir değer olmalı.');
    }
    if (clientSecret.length > 300 || /\s/.test(clientSecret)) throw new ApiError(400, 'Gizli anahtar geçersiz görünüyor.');
    await store.saveCredentials(c.get('db'), c.get('user').id, clientId, clientSecret);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err, 'Google credentials');
  }
});

// PUT /api/google/settings { autoSync?, includeUndated? }
google.put('/api/google/settings', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const s: { autoSync?: boolean; includeUndated?: boolean } = {};
    if (body.autoSync !== undefined) s.autoSync = !!body.autoSync;
    if (body.includeUndated !== undefined) s.includeUndated = !!body.includeUndated;
    store.updateSettings(c.get('db'), c.get('user').id, s);
    return c.json({ ok: true, ...s });
  } catch (err) {
    return fail(c, err, 'Google settings');
  }
});

// POST /api/google/connect -> { authUrl, redirectUri }
google.post('/api/google/connect', requiresLogin, (c) => {
  try {
    const row = store.getAuthRow(c.get('db'), c.get('user').id);
    if (!row?.client_id || !row.client_secret_enc) throw new ApiError(400, 'Önce OAuth istemci kimliğini ve gizli anahtarı kaydedin.');
    const redirectUri = oauth.redirectUriFor(requestPort(c));
    const { authUrl } = oauth.buildAuthUrl(c.get('user').id, row.client_id, redirectUri);
    return c.json({ authUrl, redirectUri });
  } catch (err) {
    return fail(c, err, 'Google connect');
  }
});

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function resultPage(ok: boolean, message: string): string {
  const title = ok ? 'Bağlandı, bu pencereyi kapatabilirsiniz' : 'Google bağlantısı başarısız';
  const color = ok ? '#22c55e' : '#ef4444';
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.card{max-width:420px;margin:16px;padding:28px;border-radius:16px;background:#1e293b;border:1px solid #334155;text-align:center}
.dot{width:48px;height:48px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;background:${color}22;color:${color};font-size:26px}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#94a3b8;margin:0;line-height:1.5}</style></head>
<body><div class="card"><div class="dot">${ok ? '&#10003;' : '!'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div>
<script>try{window.opener&&window.opener.postMessage({type:'google-oauth',ok:${ok ? 'true' : 'false'}},'*')}catch(e){}
${ok ? 'setTimeout(function(){try{window.close()}catch(e){}},1500);' : ''}</script></body></html>`;
}

// GET /api/google/oauth/callback?code&state  (public: hit by the browser redirect, no requiresLogin)
google.get('/api/google/oauth/callback', async (c) => {
  const err = c.req.query('error');
  const pending = oauth.takePendingState(c.req.query('state'));
  if (err) {
    const msg = err === 'access_denied'
      ? 'İzin verilmedi. Tekrar denemek için uygulamada "Bağlan" düğmesine basın.'
      : `Google bir hata döndürdü: ${err}`;
    return c.html(resultPage(false, msg), 400);
  }
  if (!pending) return c.html(resultPage(false, 'Geçersiz veya süresi dolmuş istek. Uygulamada "Bağlan" düğmesine yeniden basın.'), 400);
  const code = c.req.query('code');
  if (!code) return c.html(resultPage(false, 'Google yetkilendirme kodu gelmedi.'), 400);
  const db = c.get('db') ?? getDb();
  try {
    const { email } = await oauth.completeAuthorization(db, pending, code);
    return c.html(resultPage(true, email ? `${email} hesabı bağlandı. Uygulamaya dönebilirsiniz.` : 'Google hesabınız bağlandı. Uygulamaya dönebilirsiniz.'));
  } catch (e) {
    const msg = e instanceof GoogleError ? e.message : 'Beklenmeyen bir hata oluştu.';
    if (!(e instanceof GoogleError)) console.error('[Google callback]', e);
    try { store.setLastError(db, pending.userId, msg); } catch { /* ignore */ }
    return c.html(resultPage(false, msg), 400);
  }
});

// POST /api/google/disconnect
google.post('/api/google/disconnect', requiresLogin, async (c) => {
  try {
    const r = await oauth.disconnect(c.get('db'), c.get('user').id);
    return c.json({ ok: true, revoked: r.revoked });
  } catch (err) {
    return fail(c, err, 'Google disconnect');
  }
});

// POST /api/google/sync -> SyncSummary
google.post('/api/google/sync', requiresLogin, async (c) => {
  try {
    const row = store.getAuthRow(c.get('db'), c.get('user').id);
    if (!row?.refresh_token_enc) throw new ApiError(400, 'Google hesabı bağlı değil.');
    return c.json(await syncClassroom(c.get('db'), c.get('user').id));
  } catch (err) {
    return fail(c, err, 'Google sync');
  }
});

// GET /api/google/calendar?days=14
google.get('/api/google/calendar', requiresLogin, async (c) => {
  try {
    const raw = Number(c.req.query('days') ?? 14);
    const days = Number.isFinite(raw) ? Math.min(60, Math.max(1, Math.round(raw))) : 14;
    const events = await listUpcomingEvents(c.get('db'), c.get('user').id, days);
    return c.json({ days, events });
  } catch (err) {
    return fail(c, err, 'Google calendar');
  }
});

// POST /api/google/calendar/to-task { eventId, projectId?, priority? }
google.post('/api/google/calendar/to-task', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
    if (!eventId || eventId.length > 1024) throw new ApiError(400, 'eventId zorunludur.');
    const opts: { projectId?: string | null; priority?: number } = {};
    if (body.projectId !== undefined) opts.projectId = body.projectId === null || body.projectId === '' ? null : String(body.projectId);
    if (body.priority !== undefined) {
      const p = Number(body.priority);
      if (!Number.isInteger(p) || p < 1 || p > 4) throw new ApiError(400, 'Öncelik 1 ile 4 arasında olmalı.');
      opts.priority = p;
    }
    const r = await eventToTask(c.get('db'), c.get('user').id, eventId, opts);
    return c.json(r, r.existing ? 200 : 201);
  } catch (err) {
    return fail(c, err, 'Google calendar to-task');
  }
});

export default google;
