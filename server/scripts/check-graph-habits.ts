/**
 * Throwaway sanity check for Bağlantı Haritası (graph), Alışkanlıklar (habits) and Odak (focus).
 * In-process against a temporary DATA_DIR; no server/port is started.
 * Usage: npx tsx server/scripts/check-graph-habits.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-habits-check-'));
process.env.DATA_DIR = tmp;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
}

async function main() {
  const app = (await import('../src/index')).default;
  const H = await import('../src/db/habits');
  const { addDays, localDate } = await import('../src/db/tasks');
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  };

  // ── Graph ──
  let r = await call('GET', '/api/graph');
  check('graph empty', r.status === 200 && r.json.nodes.length === 0 && r.json.edges.length === 0 && r.json.truncated === false, r.json);

  const proj = (await call('POST', '/api/projects', { name: 'Okul' })).json;
  const projectId = proj.id || (proj.project && proj.project.id);
  const t1 = (await call('POST', '/api/tasks', { title: 'Ödev yaz', projectId })).json;
  const t2 = (await call('POST', '/api/tasks', { title: 'Kaynak tara', parentId: t1.id, projectId })).json;
  const t3 = (await call('POST', '/api/tasks', { title: 'Yalnız görev' })).json;
  const n1 = (await call('POST', '/api/notes', { title: 'Matematik notu', body: `Bkz [[Fizik notu]] ve [[görev:${t1.id}|Ödev]]` })).json;
  const n2 = (await call('POST', '/api/notes', { title: 'Fizik notu', body: 'içerik' })).json;
  await call('POST', '/api/notes', { title: 'Yalnız not', body: 'bağlantı yok' });
  const lk = await call('POST', '/api/links', { fromType: 'task', fromId: t2.id, toType: 'note', toId: n2.id });
  check('manual link created', lk.status === 201, lk.json);
  // note body may be re-synced by a later save; fetch the note to be safe
  const deck = (await call('POST', '/api/decks', { name: 'Test', color: '#ff0000' })).json;
  const card = await call('POST', '/api/cards', { deckId: deck.id || (deck.deck && deck.deck.id), front: 'Soru **kalın**', back: 'Cevap', sourceType: 'note', sourceId: n1.id });
  check('card created', card.status === 201, card.json);

  r = await call('GET', '/api/graph');
  const ids = new Set(r.json.nodes.map((n: any) => n.id));
  check('graph status', r.status === 200, r.text.slice(0, 300));
  check('linked tasks/notes present', ids.has(`task:${t1.id}`) && ids.has(`task:${t2.id}`) && ids.has(`note:${n1.id}`) && ids.has(`note:${n2.id}`), [...ids]);
  check('unlinked task absent', !ids.has(`task:${t3.id}`));
  check('orphan note absent', !r.json.nodes.some((n: any) => n.label === 'Yalnız not'));
  check('card node present, markdown cleaned', r.json.nodes.some((n: any) => n.type === 'card' && n.label === 'Soru kalın'), r.json.nodes.filter((n: any) => n.type === 'card'));
  const kinds = new Set(r.json.edges.map((e: any) => e.kind));
  for (const k of ['link', 'wikilink', 'parent', 'card-source', 'project']) check(`edge kind ${k}`, kinds.has(k), [...kinds]);
  check('project node', r.json.nodes.some((n: any) => n.type === 'project' && n.label === 'Okul'));
  check('edge endpoints exist', r.json.edges.every((e: any) => (ids.has(e.source) || r.json.nodes.some((n: any) => n.id === e.source)) && r.json.nodes.some((n: any) => n.id === e.target)));
  check('node ids are type:rawId', r.json.nodes.every((n: any) => n.id.startsWith(`${n.type}:`)));

  r = await call('GET', '/api/graph?types=task,note');
  check('type filter', r.json.nodes.every((n: any) => n.type === 'task' || n.type === 'note') && r.json.edges.every((e: any) => e.kind !== 'card-source' && e.kind !== 'project'));
  r = await call('GET', '/api/graph?q=FİZİK');
  check('search keeps match + neighbours', r.json.nodes.some((n: any) => n.label === 'Fizik notu') && !r.json.nodes.some((n: any) => n.type === 'card'), r.json.nodes.map((n: any) => n.label));
  r = await call('GET', '/api/graph?limit=2&types=task,note');
  check('limit truncates', r.json.truncated === true && r.json.nodes.length <= 2, r.json.nodes.length);

  // ── Streak math ──
  const today = '2026-10-26'; // Monday
  const day = { targetPerWeek: 7, daysMask: null };
  const set = (...offsets: number[]) => new Set(offsets.map((o) => addDays(today, o)));
  check('streak: none', H.computeStreaks(day, new Set(), today).streak === 0);
  check('streak: today+2 prior', H.computeStreaks(day, set(0, -1, -2), today).streak === 3);
  check('streak: today pending keeps yesterday run', H.computeStreaks(day, set(-1, -2), today).streak === 2);
  check('streak: gap breaks', H.computeStreaks(day, set(0, -1, -3), today).streak === 2);
  check('streak: missed yesterday -> 0', H.computeStreaks(day, set(-2, -3), today).streak === 0);
  const bs = H.computeStreaks(day, set(-10, -9, -8, -7, -5, -4), today);
  check('best streak', bs.best === 4 && bs.streak === 0, bs);
  const mwf = { targetPerWeek: 3, daysMask: 0b0010101 }; // Mon, Wed, Fri
  // 2026-10-26 Mon, 10-24 Sat, 10-23 Fri, 10-21 Wed
  check('masked: skips unscheduled days', H.computeStreaks(mwf, new Set(['2026-10-23', '2026-10-21', '2026-10-19']), today).streak === 3);
  check('masked: missed scheduled day breaks', H.computeStreaks(mwf, new Set(['2026-10-23', '2026-10-19']), today).streak === 1);
  const wk = { targetPerWeek: 3, daysMask: null };
  const weeks = new Set(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-12', '2026-10-13', '2026-10-14']);
  const ws = H.computeStreaks(wk, weeks, today);
  check('weekly: two met weeks, running week open', ws.streak === 2 && ws.unit === 'week' && ws.best === 2, ws);
  check('weekly: missed week breaks', H.computeStreaks(wk, new Set(['2026-10-12', '2026-10-13', '2026-10-14']), today).streak === 0);

  // ── Habits API ──
  const real = localDate(new Date());
  r = await call('POST', '/api/habits', { name: '' });
  check('habit empty name 400', r.status === 400);
  r = await call('POST', '/api/habits', { name: 'Egzersiz', icon: '🏃', color: '#22c55e' });
  const hid = r.json.id;
  check('habit created', r.status === 201 && r.json.targetPerWeek === 7 && r.json.streak === 0, r.json);
  r = await call('POST', '/api/habits', { name: 'Okuma', targetPerWeek: 9 });
  check('target validated', r.status === 400);
  r = await call('POST', `/api/habits/${hid}/check`, { done: true, date: real });
  check('check today', r.status === 200 && r.json.streak === 1 && r.json.habit.doneToday === true, r.json);
  r = await call('POST', `/api/habits/${hid}/check`, { done: true, date: addDays(real, -1) });
  check('check yesterday', r.json.streak === 2, r.json);
  r = await call('POST', `/api/habits/${hid}/check`, { done: true, date: addDays(real, 5) });
  check('future date rejected', r.status === 400);
  r = await call('POST', `/api/habits/nope/check`, { done: true });
  check('unknown habit 404', r.status === 404);
  r = await call('GET', `/api/habits/today?today=${real}`);
  check('today shape', r.status === 200 && r.json.habits[0].done === true && r.json.habits[0].streak === 2 && ['id', 'name', 'icon', 'color'].every((k) => k in r.json.habits[0]), r.json);
  r = await call('GET', `/api/habits/${hid}/history?days=120&today=${real}`);
  check('history', r.status === 200 && r.json.days.length === 120 && r.json.days[119].done === true && r.json.bestStreak === 2 && r.json.completionRate30 > 0, r.json.completionRate30);
  r = await call('POST', `/api/habits/${hid}/check`, { done: false, date: real });
  check('uncheck', r.json.habit.doneToday === false && r.json.streak === 1, r.json);
  r = await call('PATCH', `/api/habits/${hid}`, { archived: true });
  check('archive', r.json.archived === true);
  r = await call('GET', '/api/habits?archived=0');
  check('archived hidden', r.json.habits.length === 0);
  r = await call('GET', '/api/habits?archived=1');
  check('archived listed', r.json.habits.length === 1);
  r = await call('DELETE', `/api/habits/${hid}`);
  check('delete', r.status === 200);
  r = await call('DELETE', `/api/habits/${hid}`);
  check('delete again 404', r.status === 404);

  // ── Focus ──
  r = await call('GET', '/api/focus/settings');
  check('focus defaults', r.json.workMin === 25 && r.json.shortMin === 5 && r.json.longMin === 15 && r.json.longEvery === 4 && r.json.soundOn === true, r.json);
  r = await call('PUT', '/api/focus/settings', { workMin: 50, autoStartBreaks: true });
  check('focus settings saved', r.json.workMin === 50 && r.json.autoStartBreaks === true && r.json.shortMin === 5, r.json);
  r = await call('PUT', '/api/focus/settings', { workMin: 0 });
  check('focus settings validated', r.status === 400);
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  r = await call('POST', '/api/focus/sessions', { taskId: t1.id, kind: 'work', startedAt: iso(now - 1500000), endedAt: iso(now), seconds: 1500, completed: true });
  check('session recorded', r.status === 201 && r.json.taskId === t1.id, r.json);
  r = await call('POST', '/api/focus/sessions', { kind: 'work', startedAt: iso(now - 600000), endedAt: iso(now - 300000), seconds: 300, completed: false, taskId: 'deleted' });
  check('unknown task dropped', r.status === 201 && r.json.taskId === null, r.json);
  r = await call('POST', '/api/focus/sessions', { kind: 'bogus', startedAt: iso(now), endedAt: iso(now), seconds: 5, completed: true });
  check('bad kind 400', r.status === 400);
  r = await call('POST', '/api/focus/sessions', { kind: 'short', startedAt: iso(now - 300000), endedAt: iso(now), seconds: 300, completed: true });
  r = await call('GET', `/api/focus/stats?days=7&today=${real}`);
  check('focus stats', r.status === 200 && r.json.byDay.length === 7 && r.json.todaySeconds === 1800 && r.json.todayPomodoros === 1 && r.json.streakDays === 1, r.json);

  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* db file still open on Windows */ }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
