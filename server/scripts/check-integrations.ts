/**
 * Throwaway checks for the "Bağlantılar" backend (ntfy, reminders, backup,
 * Ollama). In-process, temporary DATA_DIR, fake fetch: no network, no ports.
 * Usage: npx tsx server/scripts/check-integrations.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'integrations-check-'));
process.env.DATA_DIR = path.join(tmpRoot, 'data');
delete process.env.BACKUP_DIR;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : ''}`);
}

interface Call { url: string; method: string; headers: Record<string, string>; body: string }
const calls: Call[] = [];
let ollamaReply = '';
let ntfyStatus = 200;

const fakeFetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  const headers: Record<string, string> = { ...(init.headers || {}) };
  const body = typeof init.body === 'string' ? init.body : '';
  calls.push({ url, method: init.method || 'GET', headers, body });
  if (url.startsWith('http://ollama.test')) {
    if (url.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [
        { name: 'qwen3:4b', size: 2.6 * 1024 ** 3, details: { parameter_size: '4.0B' } },
        { name: 'big:14b', size: 9 * 1024 ** 3, details: { parameter_size: '14B' } },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/chat')) {
      return new Response(JSON.stringify({ message: { role: 'assistant', content: ollamaReply } }), { status: 200 });
    }
  }
  if (url.startsWith('https://ntfy.test')) return new Response('{}', { status: ntfyStatus });
  if (url.includes('faireconomy')) {
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    return new Response(JSON.stringify([{ title: 'CPI m/m', country: 'USD', date: soon, impact: 'High', forecast: '', previous: '', actual: '' }]), { status: 200 });
  }
  throw new Error(`unexpected network call: ${url}`);
}) as typeof fetch;
(globalThis as any).fetch = fakeFetch; // also covers the calendar route

async function main() {
  const http = await import('../src/services/ntfy/http');
  http.setIntegrationsFetch(fakeFetch);
  const { getDb } = await import('../src/db/connection');
  const { ensureLocalUser } = await import('../src/db/profiles');
  const user = await ensureLocalUser(getDb());
  const app = (await import('../src/index')).default;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  };

  // ── settings table + secrets ──
  const settings = await import('../src/db/settings');
  settings.setSetting(user.id, 'x', { a: 1 });
  check('settings roundtrip', settings.getSetting<any>(user.id, 'x')?.a === 1);
  check('settings delete', settings.deleteSetting(user.id, 'x') && settings.getSetting(user.id, 'x') === null);

  // ── ntfy ──
  let r = await call('GET', '/api/integrations/ntfy');
  check('ntfy defaults', r.status === 200 && r.json.settings.server === 'https://ntfy.sh' && r.json.settings.enabled === false, r.json);
  r = await call('POST', '/api/integrations/ntfy/generate-topic');
  check('generated topic format', /^tg-[A-Za-z0-9_-]{20}$/.test(r.json.topic), r.json);
  r = await call('PUT', '/api/integrations/ntfy', { server: 'file:///etc/passwd' });
  check('ntfy rejects non-http server', r.status === 400, r.json);
  r = await call('PUT', '/api/integrations/ntfy', { server: 'javascript:alert(1)' });
  check('ntfy rejects javascript: url', r.status === 400);
  r = await call('PUT', '/api/integrations/ntfy', { topic: 'bad topic/../x' });
  check('ntfy rejects bad topic charset', r.status === 400);
  r = await call('PUT', '/api/integrations/ntfy', { reminderLeadMinutes: 0 });
  check('ntfy rejects lead out of range', r.status === 400);
  r = await call('PUT', '/api/integrations/ntfy', { enabled: true, topic: '' });
  check('ntfy cannot enable without topic', r.status === 400);
  r = await call('PUT', '/api/integrations/ntfy', {
    enabled: true, server: 'https://ntfy.test/', topic: 'tg-abcDEF123_-xyz', token: 'tk_SECRET123',
    taskReminders: true, reminderLeadMinutes: 15, morningDigest: true, minNewsImportance: 3,
    digestTime: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
  });
  check('ntfy saved', r.status === 200 && r.json.settings.enabled && r.json.settings.server === 'https://ntfy.test', r.json);
  check('ntfy token masked in response', r.json.settings.tokenSet === true && !JSON.stringify(r.json).includes('SECRET123'));
  const rawRow = getDb().prepare("SELECT value_json FROM app_settings WHERE key = 'ntfy'").get() as { value_json: string };
  check('ntfy token encrypted at rest', !rawRow.value_json.includes('SECRET123'));

  calls.length = 0;
  r = await call('POST', '/api/integrations/ntfy/test');
  const t = calls[0];
  check('test push posted to server/topic', r.status === 200 && t?.url === 'https://ntfy.test/tg-abcDEF123_-xyz' && t.method === 'POST', { r: r.json, t });
  check('test push headers', t?.headers.Priority === '3' && t?.headers.Authorization === 'Bearer tk_SECRET123' && !!t?.headers.Title);
  check('test push body has no secret', !t?.body.includes('SECRET'));
  check('non-ASCII title is RFC2047 encoded', /^[\x20-\x7e]*$/.test(t?.headers.Title || ''));

  ntfyStatus = 403;
  r = await call('POST', '/api/integrations/ntfy/test');
  check('failed push reported (502) without secret', r.status === 502 && !JSON.stringify(r.json).includes('SECRET'), r.json);
  ntfyStatus = 200;

  // quiet hours
  const ntfy = await import('../src/services/ntfy');
  const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  check('quiet hours crossing midnight', ntfy.inQuietHours({ start: '23:00', end: '07:00' }, at(2, 0)) && !ntfy.inQuietHours({ start: '23:00', end: '07:00' }, at(12, 0)));

  // ── task reminders + digest ──
  const tasksDb = await import('../src/db/tasks');
  const soon = new Date(Date.now() + 10 * 60 * 1000);
  const later = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const ymd = (d: Date) => tasksDb.localDate(d);
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  tasksDb.createTask(getDb(), user.id, { title: 'Ödev teslimi', dueDate: ymd(soon), dueTime: hm(soon) });
  tasksDb.createTask(getDb(), user.id, { title: 'Uzak görev', dueDate: ymd(later), dueTime: hm(later) });
  const reminders = await import('../src/services/reminders');
  calls.length = 0;
  const tick1 = await reminders.runReminderTick(new Date());
  const reminderCalls = calls.filter((c) => c.url.startsWith('https://ntfy.test') && c.headers.Tags === 'alarm_clock' && c.body.includes('Ödev teslimi'));
  check('task reminder sent once for the near task', tick1.reminders === 1 && reminderCalls.length === 1, { tick1, n: reminderCalls.length });
  check('far task not reminded', !calls.some((c) => c.body.includes('Uzak görev') && c.headers.Tags === 'alarm_clock'));
  const digestCall = calls.find((c) => c.headers.Tags === 'sunrise');
  check('morning digest sent with counts + calendar', tick1.digests === 1 && !!digestCall && /görev/.test(digestCall.body) && digestCall.body.includes('CPI'), digestCall?.body);
  calls.length = 0;
  const tick2 = await reminders.runReminderTick(new Date());
  check('second tick sends nothing (dedupe)', tick2.reminders === 0 && tick2.digests === 0 && calls.filter((c) => c.url.startsWith('https://ntfy.test')).length === 0, tick2);

  // ── critical news push ──
  calls.length = 0;
  ntfy.notifyCriticalNews({ id: 'aaaaaaaaaaaaaaaa', source: 'Fed', category: 'forex', title: 'Fed surprise rate cut', importance: 3, url: 'https://example.com/a', publishedAt: new Date().toISOString() });
  ntfy.notifyCriticalNews({ id: 'bbbbbbbbbbbbbbbb', source: 'X', category: 'crypto', title: 'Minor item', importance: 2, publishedAt: new Date().toISOString() });
  await new Promise((res) => setTimeout(res, 50));
  const newsCalls = calls.filter((c) => c.url.startsWith('https://ntfy.test'));
  check('critical news pushed (headline only), importance 2 skipped at threshold 3',
    newsCalls.length === 1 && newsCalls[0].body === 'Fed surprise rate cut' && newsCalls[0].headers.Priority === '4', newsCalls);
  calls.length = 0;
  ntfy.notifyCriticalNews({ id: 'aaaaaaaaaaaaaaaa', source: 'Fed', category: 'forex', title: 'Fed surprise rate cut', importance: 3, publishedAt: new Date().toISOString() });
  await new Promise((res) => setTimeout(res, 50));
  check('same news not pushed twice', calls.length === 0);

  // ── backup ──
  const backup = await import('../src/services/backup');
  check('backup root is DATA_DIR/../yedekler', backup.BACKUP_ROOT === path.resolve(tmpRoot, 'yedekler'), backup.BACKUP_ROOT);
  r = await call('PUT', '/api/integrations/backup', { keep: 2, hour: '25:00' });
  check('backup rejects bad hour', r.status === 400);
  r = await call('PUT', '/api/integrations/backup', { keep: 2, autoEnabled: false, hour: '03:00' });
  check('backup settings saved', r.status === 200 && r.json.settings.keep === 2, r.json);
  // fake older backups so names differ from the real ones created this minute
  for (const n of ['yedek-20200101-0300', 'yedek-20200102-0300']) {
    fs.mkdirSync(path.join(backup.BACKUP_ROOT, n), { recursive: true });
    fs.writeFileSync(path.join(backup.BACKUP_ROOT, n, 'manifest.json'), JSON.stringify({ createdAt: '2020-01-01T00:00:00Z' }));
  }
  r = await call('POST', '/api/integrations/backup/run');
  const created = r.json?.created;
  check('backup created', r.status === 200 && /^yedek-\d{8}-\d{4}/.test(created?.name || ''), r.json);
  const dir = path.join(backup.BACKUP_ROOT, created?.name || 'x');
  check('backup has db + manifest', fs.existsSync(path.join(dir, 'rrmetrics.db')) && fs.existsSync(path.join(dir, 'manifest.json')));
  check('backup excludes secret.key and screenshots', !fs.existsSync(path.join(dir, 'secret.key')) && !fs.existsSync(path.join(dir, 'screenshots')));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  check('manifest counts tasks', manifest.version === 1 && manifest.counts.tasks === 2, manifest);
  const Database = (await import('better-sqlite3')).default;
  const copy = new Database(path.join(dir, 'rrmetrics.db'), { readonly: true });
  check('backup db is readable and consistent', (copy.prepare('SELECT COUNT(*) AS n FROM tasks').get() as any).n === 2);
  copy.close();
  r = await call('POST', '/api/integrations/backup/run');
  check('second backup created', r.status === 200, r.json);
  r = await call('GET', '/api/integrations/backup');
  check('pruned to keep=2 (oldest removed)', r.json.backups.length === 2 && !r.json.backups.some((b: any) => b.name.startsWith('yedek-2020')), r.json.backups.map((b: any) => b.name));
  check('listing has size/date', r.json.backups.every((b: any) => b.sizeBytes > 0 && !!b.createdAt));
  for (const evil of ['..', '..%2F..%2Fdata', 'yedek-20200101-0300%2F..%2F..', '%2E%2E', 'yedek-2020']) {
    r = await call('DELETE', `/api/integrations/backup/${evil}`);
    check(`path traversal rejected: ${evil}`, r.status === 400 || r.status === 404, r);
  }
  check('resolveBackupDir rejects ../', (() => { try { backup.resolveBackupDir('../data'); return false; } catch { return true; } })());
  check('data dir intact', fs.existsSync(path.join(process.env.DATA_DIR!, 'rrmetrics.db')));
  r = await call('DELETE', `/api/integrations/backup/${created.name}`);
  check('backup delete works', r.status === 200 && !fs.existsSync(dir), r.json);

  // ── Ollama ──
  r = await call('PUT', '/api/integrations/ai', { baseUrl: 'ftp://x' });
  check('ai rejects non-http url', r.status === 400);
  r = await call('PUT', '/api/integrations/ai', { model: 'bad model; rm -rf' });
  check('ai rejects bad model name', r.status === 400);
  r = await call('GET', '/api/integrations/ai');
  check('ai default off', r.json.settings.enabled === false && r.json.settings.model === 'qwen3:4b' && r.json.settings.autoSummarize === false, r.json.settings);
  r = await call('PUT', '/api/integrations/ai', { enabled: true, baseUrl: 'http://ollama.test', maxPerHour: 2 });
  check('ai saved', r.status === 200 && r.json.settings.enabled === true);
  r = await call('GET', '/api/integrations/ai');
  check('ai status lists models + RAM hints', r.json.status.available && r.json.status.models.length === 2 && r.json.status.modelInstalled
    && r.json.status.models.find((m: any) => m.name === 'big:14b').heavy === true, r.json.status);

  const newsDb = await import('../src/db/news-items');
  const nid = '0123456789abcdef';
  const nowIso = new Date().toISOString();
  newsDb.upsertNewsItems(getDb(), [{ id: nid, sourceId: 'fed', source: 'Fed', category: 'forex', title: 'FOMC statement', summary: 'Rates unchanged.', url: 'https://example.com/fomc', publishedAt: nowIso, firstSeenAt: nowIso, importance: 3, tags: ['fed'], instruments: ['USD'] }]);
  ollamaReply = '<think>hmm</think>\n```json\n' + JSON.stringify({
    id: nid,
    ozet: 'Fed faizi sabit tuttu; piyasa açıklamanın tonunu izliyor.',
    onem: 4,
    etkilenen: [
      { enstruman: 'USD', etki: 'yukarı baskı', neden: 'Şahin ton beklentisi' },
      { enstruman: 'EURUSD', etki: 'aşağı baskı', neden: 'EURUSD buy limit @ 1.0850 koy' },
    ],
    volatilite_riski: 'yüksek',
    senaryolar: [
      { eger: 'Basın toplantısı şahin olursa', o_zaman: 'Dolar güçlenebilir' },
      { eger: 'Fiyat düşerse', o_zaman: 'stop loss 1.0800, take profit 1.0950' },
    ],
    izlenecekler: ['Powell basın toplantısı', 'NQ long aç'],
    uyari: 'Belirsizlik yüksek.',
    haber_penceresi_dk: 60,
    guven: 'yüksek',
  }) + '\n```';
  calls.length = 0;
  r = await call('POST', '/api/integrations/ai/summarize-news', { id: nid });
  const ev = r.json?.evaluation;
  const chatCall = calls.find((c) => c.url.endsWith('/api/chat'));
  const chatBody = chatCall ? JSON.parse(chatCall.body) : {};
  check('summarize ok', r.status === 200 && !!ev, r.json);
  check('chat uses keep_alive 0s, stream false, modest num_ctx', chatBody.keep_alive === '0s' && chatBody.stream === false && chatBody.options?.num_ctx <= 4096, chatBody);
  check('system prompt embeds safety rule', String(chatBody.messages?.[0]?.content).includes('GÜVENLİK KURALI'));
  const evText = JSON.stringify(ev || {});
  check('sanitizer dropped order language', !/limit|stop loss|take profit|1\.08|long aç/i.test(evText), ev);
  check('safe content kept', ev?.ozet?.includes('Fed') && ev?.etkilenen?.some((e: any) => e.enstruman === 'USD'));
  check('guven forced düşük', ev?.guven === 'düşük');
  check('uyari prefixed + filtrelendi', ev?.uyari?.startsWith('Yerel yapay zeka çıktısıdır; hata yapabilir.') && ev?.uyari?.includes('filtrelendi'), ev?.uyari);
  const evalFile = path.join(process.env.DATA_DIR!, 'news-eval', `${nid}.json`);
  check('evaluation file written', fs.existsSync(evalFile));
  const { getItemWithEvaluation } = await import('../src/services/newsfeed');
  const item = getItemWithEvaluation(nid);
  check('news feed picks up the local evaluation', item?.evaluation?.guven === 'düşük' && !!item?.evaluation?.ozet, item?.evaluation);
  r = await call('POST', '/api/integrations/ai/summarize-news', { id: nid });
  check('existing evaluation not overwritten without force', r.status === 409, r.json);
  r = await call('POST', '/api/integrations/ai/summarize-news', { id: '../../etc' });
  check('summarize rejects bad id', r.status === 400);
  r = await call('POST', '/api/integrations/ai/summarize-news', { id: nid, force: true });
  check('force re-summarize ok (2nd of 2/hour)', r.status === 200, r.json);
  r = await call('POST', '/api/integrations/ai/summarize-news', { id: nid, force: true });
  check('rate limit maxPerHour enforced', r.status === 429, r.json);
  ollamaReply = 'not json at all';
  const ollama = await import('../src/services/ollama');
  check('garbage reply parses to null', ollama.parseModelJson(ollamaReply) === null);
  check('finalize rejects empty object', ollama.finalizeLocalEvaluation({}, nid) === null);
  ollamaReply = 'Merhaba, hazırım.';
  r = await call('POST', '/api/integrations/ai/test');
  check('ai test ok', r.status === 200 && r.json.reply.includes('hazırım'), r.json);

  // ── startIntegrations idempotent ──
  const { startIntegrations } = await import('../src/services/integrations');
  startIntegrations();
  startIntegrations();
  check('startIntegrations idempotent / no throw', true);

  check('no unexpected network calls', !calls.some((c) => !/ntfy\.test|ollama\.test|faireconomy/.test(c.url)), calls.map((c) => c.url));

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  try { getDb().close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
