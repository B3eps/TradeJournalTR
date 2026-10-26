/**
 * Sanity check for the local-only guard, JSON error handling and a few fixes.
 * Runs in-process against a temporary DATA_DIR; no port is opened.
 * Usage: npx tsx server/scripts/check-security.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-check-'));
process.env.DATA_DIR = tmp;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
}

async function main() {
  const { ensureDataDirs, getSecretKey } = await import('../src/config');
  const { getDb, initDb } = await import('../src/db/connection');
  const { ensureLocalUser } = await import('../src/db/profiles');
  ensureDataDirs();
  getSecretKey();
  initDb();
  await ensureLocalUser(getDb());
  const app = (await import('../src/index')).default;

  const call = (p: string, init: RequestInit = {}, host = 'localhost:8471') =>
    app.request(`http://${host}${p}`, { ...init, headers: { Host: host, ...(init.headers as any) } });
  const json = { 'Content-Type': 'application/json' };

  check('health ok (localhost)', (await call('/api/health')).status === 200);
  check('health ok (127.0.0.1)', (await call('/api/health', {}, '127.0.0.1:8471')).status === 200);
  check('foreign Host rejected', (await call('/api/health', {}, 'evil.example')).status === 403);
  check('POST without Origin allowed', (await call('/api/makeTag', { method: 'POST', headers: json, body: JSON.stringify({ name: 'A', color: '#fff' }) })).status === 201);
  check('POST with foreign Origin -> 403', (await call('/api/makeTag', { method: 'POST', headers: { ...json, Origin: 'http://evil.example' }, body: '{}' })).status === 403);
  check('POST with same Origin allowed', (await call('/api/makeTag', { method: 'POST', headers: { ...json, Origin: 'http://localhost:8471' }, body: JSON.stringify({ name: 'B', color: '#fff' }) })).status === 201);
  check('GET with foreign Origin allowed', (await call('/api/health', { headers: { Origin: 'http://evil.example' } })).status === 200);

  const dup = await call('/api/makeTag', { method: 'POST', headers: json, body: JSON.stringify({ name: 'a', color: '#000' }) });
  check('duplicate tag (case-insensitive) -> 409', dup.status === 409, await dup.clone().text());

  const bad = await call('/api/preferences/theme', { method: 'POST', headers: json, body: '{oops' });
  check('malformed JSON -> 400 JSON', bad.status === 400 && ((await bad.json()) as any).error !== undefined);

  const nf = await call('/api/does-not-exist');
  check('unknown API -> 404 JSON', nf.status === 404 && (nf.headers.get('content-type') || '').includes('json'));

  const big = await call('/api/makeTag', { method: 'POST', headers: { ...json, 'Content-Length': String(11 * 1024 * 1024) }, body: 'x'.repeat(11 * 1024 * 1024) });
  check('oversized body -> 413', big.status === 413, big.status);

  const today = new Date().toISOString().slice(0, 10);
  const cons = await call(`/api/premarket/consistency?startDate=${today}&endDate=${today}`);
  check('premarket consistency -> 200 {completionsByDate}', cons.status === 200 && typeof ((await cons.json()) as any).completionsByDate === 'object');
  check('premarket consistency bad dates -> 400', (await call('/api/premarket/consistency?startDate=x&endDate=y')).status === 400);

  const an = await call('/api/strategy/analytics');
  check('strategy analytics 200', an.status === 200);

  console.log(failures ? `\n${failures} FAILED` : '\nALL OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
