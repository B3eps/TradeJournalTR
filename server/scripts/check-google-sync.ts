/**
 * Throwaway check for the Google integration (OAuth + Classroom sync + Calendar).
 * Mocks global fetch with canned Google responses; never contacts Google.
 * Runs in-process against a temporary DATA_DIR.  Usage: npx tsx server/scripts/check-google-sync.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

process.env.TZ = 'Europe/Istanbul'; // UTC+3 all year
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'google-check-'));
process.env.DATA_DIR = tmp;
delete process.env.ENCRYPTION_KEY;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
}

const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-super-secret-value';
const REFRESH = 'refresh-token-XYZ';

// ── Fake Google ──────────────────────────────────────────────────────────────
const now = Date.now();
const utcParts = (ms: number) => {
  const d = new Date(ms);
  return { dueDate: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, dueTime: { hours: d.getUTCHours(), minutes: d.getUTCMinutes() } };
};
const H = 3600_000;
const fake = {
  validTokens: new Set<string>(),
  tokenCounter: 0,
  refreshCalls: 0,
  authCodeCalls: 0,
  revokeCalls: 0,
  lastVerifier: '',
  lastRedirect: '',
  fail503Once: false,
  refreshInvalidGrant: false,
  works: [
    { id: 'w1', title: 'Türev ödevi', description: 'Sayfa 42', alternateLink: 'https://classroom.google.com/c/c1/a/w1', state: 'PUBLISHED', workType: 'ASSIGNMENT', ...utcParts(now + 24 * H) },
    { id: 'w2', title: 'İntegral', description: '', alternateLink: 'https://classroom.google.com/c/c1/a/w2', state: 'PUBLISHED', workType: 'ASSIGNMENT', ...utcParts(now + 5 * 24 * H) },
    { id: 'w3', title: 'Proje (tarihsiz)', alternateLink: 'https://classroom.google.com/c/c1/a/w3', state: 'PUBLISHED', workType: 'ASSIGNMENT' },
    { id: 'w4', title: 'Teslim edilmiş', alternateLink: 'https://classroom.google.com/c/c1/a/w4', state: 'PUBLISHED', workType: 'ASSIGNMENT', ...utcParts(now + 2 * 24 * H) },
    { id: 'w5', title: 'Soru (tarihsiz)', alternateLink: 'https://classroom.google.com/c/c1/a/w5', state: 'PUBLISHED', workType: 'SHORT_ANSWER_QUESTION' },
    { id: 'w6', title: 'Çok eski', alternateLink: 'https://classroom.google.com/c/c1/a/w6', state: 'PUBLISHED', workType: 'ASSIGNMENT', ...utcParts(now - 90 * 24 * H) },
  ] as any[],
  subs: { w1: 'CREATED', w2: 'NEW', w3: 'NEW', w4: 'TURNED_IN', w5: 'NEW', w6: 'NEW' } as Record<string, string>,
  events: [
    { id: 'ev1', status: 'confirmed', summary: 'Matematik sınavı', location: 'A-101', htmlLink: 'https://www.google.com/calendar/event?eid=ev1',
      start: { dateTime: new Date(now + 2 * 24 * H).toISOString() }, end: { dateTime: new Date(now + 2 * 24 * H + 2 * H).toISOString() } },
    { id: 'ev2', status: 'confirmed', summary: 'Tatil', start: { date: '2026-11-02' }, end: { date: '2026-11-04' } },
    { id: 'ev3', status: 'cancelled', summary: 'İptal' },
  ] as any[],
  requests: [] as string[],
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function issueToken(): string {
  const t = `at-${++fake.tokenCounter}`;
  fake.validTokens.add(t);
  return t;
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  fake.requests.push(`${init.method || 'GET'} ${url.origin}${url.pathname}`);
  const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!/googleapis\.com$|google\.com$/.test(url.hostname)) throw new Error(`unexpected host ${url.hostname}`);

  if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
    const form = new URLSearchParams(String(init.body));
    if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) return json(401, { error: 'invalid_client' });
    if (form.get('grant_type') === 'authorization_code') {
      fake.authCodeCalls++;
      fake.lastVerifier = form.get('code_verifier') || '';
      fake.lastRedirect = form.get('redirect_uri') || '';
      if (form.get('code') !== 'good-code') return json(400, { error: 'invalid_grant' });
      // First token is deliberately rejected by Classroom -> tests 401 refresh.
      return json(200, { access_token: 'at-stale', expires_in: 3599, refresh_token: REFRESH, scope: 'openid email', token_type: 'Bearer' });
    }
    if (form.get('grant_type') === 'refresh_token') {
      fake.refreshCalls++;
      if (fake.refreshInvalidGrant || form.get('refresh_token') !== REFRESH) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: issueToken(), expires_in: 3599, token_type: 'Bearer' });
    }
    return json(400, { error: 'unsupported_grant_type' });
  }
  if (url.href.startsWith('https://oauth2.googleapis.com/revoke')) { fake.revokeCalls++; return new Response('', { status: 200 }); }
  if (url.href.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
    return bearer ? json(200, { sub: '1', email: 'ogrenci@example.com', email_verified: true }) : json(401, {});
  }
  if (!fake.validTokens.has(bearer)) return json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });

  if (url.hostname === 'classroom.googleapis.com') {
    const p = url.pathname;
    if (p === '/v1/courses') {
      if (fake.fail503Once) { fake.fail503Once = false; return json(503, { error: { code: 503 } }); }
      if (url.searchParams.get('studentId') !== 'me' || url.searchParams.get('courseStates') !== 'ACTIVE') return json(400, {});
      if (!url.searchParams.get('pageToken')) return json(200, { courses: [{ id: 'c1', name: 'Matematik' }], nextPageToken: 'p2' });
      return json(200, { courses: [{ id: 'c2', name: 'Kilitli Kurs' }] });
    }
    if (p === '/v1/courses/c2/courseWork') return json(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } });
    if (p === '/v1/courses/c1/courseWork') {
      if (url.searchParams.get('orderBy') !== 'dueDate desc') return json(400, {});
      // two pages to exercise pagination
      if (!url.searchParams.get('pageToken')) return json(200, { courseWork: fake.works.slice(0, 3), nextPageToken: 'cw2' });
      return json(200, { courseWork: fake.works.slice(3) });
    }
    if (p === '/v1/courses/c1/courseWork/-/studentSubmissions') {
      if (url.searchParams.get('userId') !== 'me') return json(400, {});
      return json(200, { studentSubmissions: Object.entries(fake.subs).map(([w, s], i) => ({ id: `s${i}`, courseWorkId: w, state: s })) });
    }
  }
  if (url.hostname === 'www.googleapis.com' && url.pathname === '/calendar/v3/calendars/primary/events') {
    const ok = url.searchParams.get('singleEvents') === 'true' && url.searchParams.get('orderBy') === 'startTime'
      && !!url.searchParams.get('timeMin') && !!url.searchParams.get('timeMax');
    return ok ? json(200, { items: fake.events }) : json(400, {});
  }
  const evMatch = /^\/calendar\/v3\/calendars\/primary\/events\/(.+)$/.exec(url.pathname);
  if (url.hostname === 'www.googleapis.com' && evMatch) {
    const ev = fake.events.find((e) => e.id === decodeURIComponent(evMatch[1]));
    return ev ? json(200, ev) : json(404, { error: { code: 404 } });
  }
  return json(404, { error: { code: 404, message: `no mock for ${url.pathname}` } });
}) as typeof fetch;

async function main() {
  const http = await import('../src/services/google/http');
  http._setTimingForTests({ minSpacingMs: 0, baseBackoffMs: 5 });
  const sync = await import('../src/services/google/sync');
  const oauth = await import('../src/services/google/oauth');
  const { getDb } = await import('../src/db/connection');
  const tasksDb = await import('../src/db/tasks');
  const linksDb = await import('../src/db/links');
  const app = (await import('../src/index')).default;

  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(url, {
      method,
      headers: { Host: '127.0.0.1:8459', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json: j, text };
  };

  // ── Pure: UTC -> local conversion (Europe/Istanbul = UTC+3) ──
  let d = sync.classroomDueToLocal({ year: 2026, month: 10, day: 28 }, { hours: 20, minutes: 59 });
  check('due 20:59Z -> 23:59 local same day', d?.date === '2026-10-28' && d?.time === '23:59', d);
  d = sync.classroomDueToLocal({ year: 2026, month: 12, day: 31 }, { hours: 22 });
  check('due 22:00Z Dec 31 -> Jan 1 01:00 (rollover, minutes omitted)', d?.date === '2027-01-01' && d?.time === '01:00', d);
  d = sync.classroomDueToLocal({ year: 2026, month: 3, day: 5 }, {});
  check('dueTime {} means 00:00Z -> 03:00 local', d?.date === '2026-03-05' && d?.time === '03:00', d);
  d = sync.classroomDueToLocal({ year: 2026, month: 3, day: 5 }, undefined);
  check('date-only due keeps the day, no time', d?.date === '2026-03-05' && d?.time === null, d);
  check('no dueDate -> null', sync.classroomDueToLocal(undefined, { hours: 1 }) === null);
  check('priority: within 48h -> 2, later -> 3, undated -> 4',
    sync.priorityFor(new Date(now + 47 * H), now) === 2 && sync.priorityFor(new Date(now + 72 * H), now) === 3 && sync.priorityFor(null, now) === 4);

  // ── Status / credentials ──
  let r = await call('GET', '/api/google/status');
  check('status: not configured', r.status === 200 && r.json.configured === false && r.json.connected === false, r.json);
  check('status: redirectUri uses request port', r.json.redirectUri === 'http://127.0.0.1:8459/api/google/oauth/callback', r.json.redirectUri);
  r = await call('POST', '/api/google/connect');
  check('connect before credentials -> 400', r.status === 400, r);
  r = await call('PUT', '/api/google/credentials', { clientId: 'bad', clientSecret: 'x' });
  check('invalid client id rejected', r.status === 400, r.json);
  r = await call('PUT', '/api/google/credentials', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  check('credentials saved', r.status === 200, r.json);
  r = await call('GET', '/api/google/status');
  check('status: configured, not connected, no secret leaked',
    r.json.configured === true && r.json.connected === false && !r.text.includes(CLIENT_SECRET), r.json);

  // ── Connect: URL with PKCE ──
  r = await call('POST', '/api/google/connect', undefined, { Host: '127.0.0.1:8471' });
  check('connect returns authUrl', r.status === 200 && typeof r.json.authUrl === 'string', r.json);
  const au = new URL(r.json.authUrl);
  const q = au.searchParams;
  check('auth endpoint', au.origin + au.pathname === 'https://accounts.google.com/o/oauth2/v2/auth');
  check('client_id/response_type/access_type/prompt', q.get('client_id') === CLIENT_ID && q.get('response_type') === 'code'
    && q.get('access_type') === 'offline' && q.get('prompt') === 'consent');
  check('redirect_uri from Host port', q.get('redirect_uri') === 'http://127.0.0.1:8471/api/google/oauth/callback', q.get('redirect_uri'));
  const scopes = (q.get('scope') || '').split(' ');
  check('scopes are read-only + openid email', scopes.includes('openid') && scopes.includes('email')
    && scopes.filter((s) => s.startsWith('https://')).every((s) => s.endsWith('.readonly')) && scopes.length === 6, scopes);
  const state = q.get('state')!;
  const pend = oauth._peekPending(state);
  const expected = crypto.createHash('sha256').update(pend!.verifier).digest('base64url');
  check('PKCE S256 challenge matches stored verifier', q.get('code_challenge_method') === 'S256' && q.get('code_challenge') === expected);
  check('verifier length 43..128', pend!.verifier.length >= 43 && pend!.verifier.length <= 128);

  // ── Callback ──
  r = await call('GET', '/api/google/oauth/callback?code=good-code&state=wrong');
  check('callback with bad state -> 400 page', r.status === 400 && r.text.includes('Geçersiz'), r.status);
  r = await call('GET', `/api/google/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`);
  check('callback success page', r.status === 200 && r.text.includes('Bağlandı, bu pencereyi kapatabilirsiniz') && r.text.includes('postMessage'), r.text.slice(0, 200));
  check('token exchange sent verifier + same redirect_uri', fake.lastVerifier === pend!.verifier && fake.lastRedirect === 'http://127.0.0.1:8471/api/google/oauth/callback');
  r = await call('GET', `/api/google/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`);
  check('state is single-use', r.status === 400 && fake.authCodeCalls === 1);
  r = await call('GET', '/api/google/status');
  check('status: connected with email', r.json.connected === true && r.json.email === 'ogrenci@example.com', r.json);

  // ── Encrypted at rest ──
  const db = getDb();
  const row = db.prepare('SELECT * FROM google_auth').get() as any;
  const rowText = JSON.stringify(row);
  check('client secret encrypted at rest', !!row.client_secret_enc && !rowText.includes(CLIENT_SECRET));
  check('refresh/access tokens encrypted at rest', !!row.refresh_token_enc && !rowText.includes(REFRESH) && !rowText.includes('at-stale'));
  const dbFile = fs.readFileSync(path.join(tmp, 'rrmetrics.db'));
  const walPath = path.join(tmp, 'rrmetrics.db-wal');
  const raw = Buffer.concat([dbFile, fs.existsSync(walPath) ? fs.readFileSync(walPath) : Buffer.alloc(0)]).toString('latin1');
  check('raw db files contain no plaintext secret/token', !raw.includes(CLIENT_SECRET) && !raw.includes(REFRESH));
  const userId = row.user_id as string;

  // ── Sync #1 (401 on stale token -> refresh) ──
  r = await call('POST', '/api/google/sync');
  const s1 = r.json;
  check('sync 1 ok', r.status === 200, r.json);
  check('refresh happened after 401', fake.refreshCalls === 1, fake.refreshCalls);
  check('courses counted (2, paginated)', s1.courses === 2, s1);
  check('assignments counted (6, paginated)', s1.assignments === 6, s1);
  check('created w1, w2, w3 only', s1.created === 3, s1);
  check('403 course reported in errors', s1.errors.length === 1 && /erişim izniniz yok/.test(s1.errors[0]), s1.errors);
  const okul = tasksDb.listProjects(db, userId).projects.find((p) => p.name === 'Okul')!;
  let list = tasksDb.listTasks(db, userId, { projectId: okul.id, status: 'all' }).tasks;
  const byTitle = (t: string) => list.find((x) => x.title === t);
  const t1 = byTitle('[Matematik] Türev ödevi');
  const t2 = byTitle('[Matematik] İntegral');
  const t3 = byTitle('[Matematik] Proje (tarihsiz)');
  check('tasks in Okul project', !!t1 && !!t2 && !!t3, list.map((x) => x.title));
  const exp1 = new Date(now + 24 * H);
  const pad = (n: number) => String(n).padStart(2, '0');
  check('t1 due local date/time', t1?.dueDate === tasksDb.localDate(exp1) && t1?.dueTime === `${pad(exp1.getHours())}:${pad(exp1.getMinutes())}`, t1);
  check('t1 priority 2 (<48h), t2 priority 3, t3 priority 4', t1?.priority === 2 && t2?.priority === 3 && t3?.priority === 4, [t1?.priority, t2?.priority, t3?.priority]);
  check('t3 has no due date', t3?.dueDate === null);
  check('label classroom attached', t1?.labels.some((l) => l.name === 'classroom') === true, t1?.labels);
  check('notes contain description and link', !!t1?.notes.includes('Sayfa 42') && !!t1?.notes.includes('https://classroom.google.com/c/c1/a/w1'));
  const links = linksDb.listLinks(db, userId, 'task', t1!.id);
  check('url link to alternateLink', links.some((l) => l.type === 'url' && l.id === 'https://classroom.google.com/c/c1/a/w1'), links);
  check('no task for turned-in, question, or very old work',
    !byTitle('[Matematik] Teslim edilmiş') && !byTitle('[Matematik] Soru (tarihsiz)') && !byTitle('[Matematik] Çok eski'));

  // ── Sync #2: dedupe ──
  r = await call('POST', '/api/google/sync');
  check('sync 2 dedupes (0 created, 0 updated)', r.json.created === 0 && r.json.updated === 0, r.json);
  check('task count unchanged', tasksDb.listTasks(db, userId, { projectId: okul.id, status: 'all' }).tasks.length === 3);

  // ── Upstream change + local-edit guard ──
  tasksDb.updateTask(db, userId, t2!.id, { title: 'Benim başlığım' }); // user edits t2 title locally
  fake.works[0].title = 'Türev ödevi (güncellendi)';
  Object.assign(fake.works[0], utcParts(now + 30 * H));
  fake.works[1].title = 'İntegral v2';
  Object.assign(fake.works[1], utcParts(now + 6 * 24 * H));
  r = await call('POST', '/api/google/sync');
  check('sync 3 updated 2', r.json.updated === 2, r.json);
  let n1 = tasksDb.getTask(db, userId, t1!.id)!;
  const n2 = tasksDb.getTask(db, userId, t2!.id)!;
  const exp1b = new Date(now + 30 * H);
  check('t1 title updated upstream', n1.title === '[Matematik] Türev ödevi (güncellendi)', n1.title);
  check('t1 due updated upstream', n1.dueDate === tasksDb.localDate(exp1b) && n1.dueTime === `${pad(exp1b.getHours())}:${pad(exp1b.getMinutes())}`, n1);
  check('t2 local title kept (guard)', n2.title === 'Benim başlığım', n2.title);
  check('t2 due still updated (not edited locally)', n2.dueDate === tasksDb.localDate(new Date(now + 6 * 24 * H)), n2.dueDate);

  // user moves t1 due locally, upstream moves again -> keep local
  tasksDb.updateTask(db, userId, t1!.id, { dueDate: '2030-01-01', dueTime: '10:00' });
  Object.assign(fake.works[0], utcParts(now + 40 * H));
  r = await call('POST', '/api/google/sync');
  n1 = tasksDb.getTask(db, userId, t1!.id)!;
  check('t1 local due kept (guard)', n1.dueDate === '2030-01-01' && n1.dueTime === '10:00', n1);

  // ── Turn in -> done ──
  fake.subs.w1 = 'TURNED_IN';
  r = await call('POST', '/api/google/sync');
  check('sync reports 1 completed', r.json.completed === 1, r.json);
  check('t1 marked done', tasksDb.getTask(db, userId, t1!.id)!.status === 'done');
  fake.subs.w1 = 'RETURNED';
  r = await call('POST', '/api/google/sync');
  check('RETURNED keeps it done, no double count', r.json.completed === 0 && tasksDb.getTask(db, userId, t1!.id)!.status === 'done', r.json);
  fake.subs.w1 = 'RECLAIMED_BY_STUDENT';
  r = await call('POST', '/api/google/sync');
  check('reclaimed -> reopened', r.json.reopened === 1 && tasksDb.getTask(db, userId, t1!.id)!.status === 'open', r.json);

  // deleted task is never recreated
  tasksDb.deleteTask(db, userId, t3!.id);
  fake.works[2].title = 'Proje (tarihsiz) v2';
  r = await call('POST', '/api/google/sync');
  check('deleted task not recreated', r.json.created === 0 && !tasksDb.listTasks(db, userId, { q: 'Proje', status: 'all' }).tasks.length, r.json);

  // ── Expired token -> refresh before request ──
  const before = fake.refreshCalls;
  db.prepare('UPDATE google_auth SET expires_at = ?').run(Date.now() - 1000);
  await call('POST', '/api/google/sync');
  check('expired access token refreshed proactively', fake.refreshCalls === before + 1);

  // ── 503 backoff ──
  fake.fail503Once = true;
  r = await call('POST', '/api/google/sync');
  check('503 retried transparently', r.status === 200 && r.json.courses === 2 && r.json.errors.length === 1, r.json);

  // ── Calendar ──
  r = await call('GET', '/api/google/calendar?days=14');
  check('calendar list ok (cancelled dropped)', r.status === 200 && r.json.events.length === 2, r.json);
  const e1 = r.json.events.find((e: any) => e.id === 'ev1');
  const e1Start = new Date(now + 2 * 24 * H);
  check('timed event local date/time', e1?.date === tasksDb.localDate(e1Start) && e1?.startTime === `${pad(e1Start.getHours())}:${pad(e1Start.getMinutes())}` && e1?.location === 'A-101', e1);
  const e2 = r.json.events.find((e: any) => e.id === 'ev2');
  check('all-day event end is inclusive', e2?.allDay === true && e2?.date === '2026-11-02' && e2?.endDate === '2026-11-03', e2);
  r = await call('POST', '/api/google/calendar/to-task', { eventId: 'ev1' });
  check('event -> task created', r.status === 201 && r.json.task.title === 'Matematik sınavı' && r.json.task.dueDate === e1.date && r.json.task.dueTime === e1.startTime, r.json);
  const evTaskId = r.json.task.id;
  r = await call('POST', '/api/google/calendar/to-task', { eventId: 'ev1' });
  check('event -> task deduped', r.status === 200 && r.json.existing === true && r.json.task.id === evTaskId, r.json);
  r = await call('GET', '/api/google/calendar?days=14');
  check('calendar list shows taskId for converted event', r.json.events.find((e: any) => e.id === 'ev1')?.taskId === evTaskId);
  r = await call('POST', '/api/google/calendar/to-task', { eventId: 'nope' });
  check('unknown event -> 404', r.status === 404, r.json);

  // ── Settings ──
  r = await call('PUT', '/api/google/settings', { autoSync: false });
  r = await call('GET', '/api/google/status');
  check('autoSync toggle persisted', r.json.autoSync === false && r.json.lastSyncAt !== null);

  // ── invalid_grant -> disconnected with Turkish error ──
  fake.refreshInvalidGrant = true;
  db.prepare('UPDATE google_auth SET expires_at = ?').run(Date.now() - 1000);
  r = await call('POST', '/api/google/sync');
  check('sync with revoked grant fails soft', r.status === 200 && /yeniden bağlanın/.test(r.json.errors[0] || ''), r.json);
  r = await call('GET', '/api/google/status');
  check('status: disconnected with lastError', r.json.connected === false && /yeniden bağlanın/.test(r.json.lastError || ''), r.json);
  fake.refreshInvalidGrant = false;

  // ── Reconnect + disconnect (revoke) ──
  r = await call('POST', '/api/google/connect');
  const st2 = new URL(r.json.authUrl).searchParams.get('state')!;
  await call('GET', `/api/google/oauth/callback?code=good-code&state=${encodeURIComponent(st2)}`);
  r = await call('GET', '/api/google/status');
  check('reconnected', r.json.connected === true);
  r = await call('POST', '/api/google/disconnect');
  check('disconnect ok + revoke called', r.status === 200 && fake.revokeCalls === 1, r.json);
  const after = db.prepare('SELECT * FROM google_auth').get() as any;
  check('tokens deleted, credentials kept', after.refresh_token_enc === null && after.access_token_enc === null && !!after.client_secret_enc);
  check('tasks never deleted by disconnect', !!tasksDb.getTask(db, userId, t1!.id));

  check('no request left Google hosts', fake.requests.every((x) => /google(apis)?\.com/.test(x)));
  globalThis.fetch = realFetch;
  console.log(failures ? `\n${failures} FAILED` : '\nALL OK');
  try { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
