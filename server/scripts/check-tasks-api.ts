/**
 * Throwaway sanity check for the Life OS backend (tasks, projects, labels,
 * links, search, recurrence). Runs in-process against a temporary DATA_DIR;
 * no server/port is started.  Usage: npx tsx server/scripts/check-tasks-api.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-check-'));
process.env.DATA_DIR = tmp;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
}

async function main() {
  const rec = await import('../src/db/tasks');
  const { parseRecurrence: P, nextOccurrence: N, nextDueAfter, foldText } = rec;

  // ── Recurrence (pure) ──
  check('weekly:MO,WE from Fri 2026-10-23 -> Mon 10-26', N(P('weekly:MO,WE')!, '2026-10-23') === '2026-10-26');
  check('weekly:MO,WE from Mon -> Wed', N(P('weekly:MO,WE')!, '2026-10-26') === '2026-10-28');
  check('monthly:31 from Jan 31 -> Feb 28 (2026)', N(P('monthly:31')!, '2026-01-31') === '2026-02-28');
  check('monthly:31 from Feb 28 -> Mar 31', N(P('monthly:31')!, '2026-02-28') === '2026-03-31');
  check('monthly:31 leap year -> Feb 29 2028', N(P('monthly:31')!, '2028-01-31') === '2028-02-29');
  check('monthly:15 from Jan 10 -> Jan 15', N(P('monthly:15')!, '2026-01-10') === '2026-01-15');
  check('monthly:15 from Dec 20 -> Jan 15 next year', N(P('monthly:15')!, '2026-12-20') === '2027-01-15');
  check('every:3d adds 3 days', N(P('every:3d')!, '2026-10-30') === '2026-11-02');
  check('every:2w adds 14 days', N(P('every:2w')!, '2026-10-25') === '2026-11-08');
  check('weekdays from Fri -> Mon', N(P('weekdays')!, '2026-10-23') === '2026-10-26');
  check('weekdays from Sat -> Mon', N(P('weekdays')!, '2026-10-24') === '2026-10-26');
  check('weekdays from Tue -> Wed', N(P('weekdays')!, '2026-10-27') === '2026-10-28');
  check('daily across year end', N(P('daily')!, '2026-12-31') === '2027-01-01');
  check('yearly Feb 29 clamps', N(P('yearly')!, '2028-02-29') === '2029-02-28');
  check('invalid rules rejected', [P('weekly:XX'), P('monthly:32'), P('every:0d'), P('hourly')].every((r) => r === null));
  check('canonical weekly order', rec.formatRecurrence(P('weekly:su,we,mo')!) === 'weekly:MO,WE,SU', rec.formatRecurrence(P('weekly:su,we,mo')!));
  check('overdue daily skips to after today', nextDueAfter(P('daily')!, '2026-10-01', '2026-10-25') === '2026-10-26');
  check('fold Turkish', foldText('İSTANBUL Işık ŞEKER Güneş') === 'istanbul isik seker gunes', foldText('İSTANBUL Işık ŞEKER Güneş'));

  // ── HTTP layer, in-process ──
  const app = (await import('../src/index')).default;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  };

  let r = await call('GET', '/api/projects');
  check('projects seeded (4)', r.status === 200 && r.json.projects.length === 4, r.json);
  const inbox = r.json.projects.find((p: any) => p.isInbox);
  check('inbox is Gelen Kutusu', inbox?.name === 'Gelen Kutusu');
  r = await call('GET', '/api/projects');
  check('seed idempotent', r.json.projects.length === 4);
  r = await call('GET', '/api/labels');
  check('labels seeded (3)', r.json.labels.length === 3, r.json);
  const acil = r.json.labels.find((l: any) => l.name === 'acil');

  r = await call('POST', '/api/labels', { name: 'ACİL' });
  check('duplicate label (case/Turkish fold) -> 409', r.status === 409, r);
  r = await call('POST', '/api/tasks', { title: '' });
  check('empty title -> 400', r.status === 400 && typeof r.json.error === 'string', r);
  r = await call('POST', '/api/tasks', '{bad json');
  check('bad json -> 400', r.status === 400, r);
  r = await call('POST', '/api/tasks', { title: 'x', dueDate: '2026-02-30' });
  check('invalid date -> 400', r.status === 400, r);
  r = await call('POST', '/api/tasks', { title: 'x', priority: 7 });
  check('invalid priority -> 400', r.status === 400, r);
  r = await call('POST', '/api/tasks', { title: 'x', recurrence: 'sometimes' });
  check('invalid recurrence -> 400', r.status === 400, r);

  r = await call('POST', '/api/tasks', {
    title: 'Şirket bilançosunu oku', notes: 'Q3 **analiz**', projectId: inbox.id, priority: 1,
    dueDate: '2026-10-23', dueTime: '09:30', recurrence: 'weekly:mo,we', estimateMin: 45, labelIds: [acil.id],
  });
  check('create task 201', r.status === 201 && r.json.labels[0]?.name === 'acil' && r.json.recurrence === 'weekly:MO,WE', r.json);
  const t1 = r.json;
  r = await call('POST', '/api/tasks', { title: 'Alt görev', parentId: t1.id, dueDate: '2026-10-23' });
  check('subtask inherits project', r.status === 201 && r.json.projectId === inbox.id, r.json);
  const sub = r.json;
  r = await call('PATCH', `/api/tasks/${t1.id}`, { parentId: sub.id });
  check('cycle prevented -> 400', r.status === 400, r);

  r = await call('GET', '/api/tasks?due=overdue&today=2026-10-25');
  check('overdue list has root only', r.json.total === 1 && r.json.tasks[0].id === t1.id && r.json.tasks[0].subtaskCount === 1, r.json);
  r = await call('GET', '/api/tasks?q=SIRKET');
  check('q search ascii-folded', r.json.total === 1, r.json);
  r = await call('GET', '/api/tasks?label=acil');
  check('label filter by name', r.json.total === 1, r.json);
  r = await call('GET', '/api/tasks?status=bogus');
  check('bad status -> 400', r.status === 400);

  // Timer
  const t2 = (await call('POST', '/api/tasks', { title: 'Matematik ödevi' })).json;
  r = await call('POST', `/api/tasks/${t1.id}/timer/start`);
  check('timer start', r.status === 200 && !!r.json.runningSince, r.json);
  r = await call('POST', `/api/tasks/${t2.id}/timer/start`);
  r = await call('GET', '/api/tasks/timer/running');
  check('only one running (t2)', r.json.task?.id === t2.id, r.json);
  const t1now = (await call('GET', `/api/tasks/${t1.id}`)).json;
  check('t1 timer stopped by t2 start', t1now.runningSince === null);
  r = await call('POST', `/api/tasks/${t2.id}/timer/stop`);
  check('timer stop', r.status === 200 && r.json.runningSince === null && typeof r.json.spentSeconds === 'number', r.json);
  r = await call('GET', '/api/tasks/timer/running');
  check('nothing running', r.json.task === null);

  // Links
  r = await call('POST', '/api/links', { fromType: 'task', fromId: t1.id, toType: 'url', toId: 'https://example.com/a' });
  check('link to url 201', r.status === 201 && r.json.link.label === 'example.com', r);
  r = await call('POST', '/api/links', { fromType: 'task', fromId: t1.id, toType: 'task', toId: t2.id });
  check('task-task link 201', r.status === 201);
  const linkId = r.json.link.linkId;
  r = await call('POST', '/api/links', { fromType: 'task', fromId: t2.id, toType: 'task', toId: t1.id });
  check('reverse duplicate -> existing', r.status === 200 && r.json.existing === true && r.json.link.linkId === linkId, r.json);
  r = await call('POST', '/api/links', { fromType: 'task', fromId: t1.id, toType: 'task', toId: t1.id });
  check('self link -> 400', r.status === 400);
  r = await call('POST', '/api/links', { fromType: 'task', fromId: t1.id, toType: 'trade', toId: 'nope' });
  check('missing trade -> 404', r.status === 404, r);
  r = await call('GET', `/api/links?type=task&id=${t2.id}`);
  check('symmetric listing from t2', r.json.links.length === 1 && r.json.links[0].id === t1.id && r.json.links[0].direction === 'in', r.json);
  r = await call('GET', `/api/tasks/${t1.id}`);
  check('detail has subtasks+links', r.json.subtasks.length === 1 && r.json.links.length === 2 && r.json.linkCount === 2, r.json);

  // Recurring complete
  r = await call('POST', `/api/tasks/${t1.id}/complete?today=2026-10-25`);
  check('recurring complete -> next Mon 10-26', r.json.task.status === 'done' && r.json.task.recurrence === null && r.json.next?.dueDate === '2026-10-26', r.json);
  check('next copies labels & subtask', r.json.next?.labels.length === 1 && r.json.next?.subtaskCount === 1, r.json.next);
  const nextId = r.json.next.id;
  const nextSubs = (await call('GET', `/api/tasks/${nextId}`)).json.subtasks;
  check('copied subtask due shifted by 3 days', nextSubs[0]?.dueDate === '2026-10-26', nextSubs);
  r = await call('POST', `/api/tasks/${t2.id}/complete`);
  check('plain complete', r.json.task.status === 'done' && !!r.json.task.completedAt && !r.json.next);
  r = await call('POST', `/api/tasks/${t2.id}/complete`);
  check('toggle reopens', r.json.task.status === 'open' && r.json.task.completedAt === null);
  r = await call('POST', `/api/tasks/${t2.id}/complete`);

  // Reorder
  r = await call('POST', '/api/tasks/reorder', { ids: [t2.id, nextId] });
  check('reorder', r.json.updated === 2);
  r = await call('POST', '/api/tasks/reorder', { ids: 'x' });
  check('reorder bad body -> 400', r.status === 400);

  // Stats
  r = await call('GET', '/api/tasks/stats?days=7');
  check('stats shape', r.status === 200 && r.json.completedByDay.length === 7 && r.json.completedToday >= 2 && r.json.streakDays === 1
    && Array.isArray(r.json.byProject) && r.json.focusSecondsByDay.length === 7, r.json);
  r = await call('GET', '/api/tasks/stats?days=999');
  check('stats bad days -> 400', r.status === 400);

  // Search
  r = await call('GET', '/api/search?q=bilanço');
  check('search tasks (Turkish)', r.json.tasks.length >= 1 && r.json.tasks[0].projectName === 'Gelen Kutusu', r.json);
  r = await call('GET', '/api/search?q=gelen');
  check('search projects', r.json.projects.length === 1);
  r = await call('GET', '/api/search?q=100%25');
  check('search with % escaped (no match)', r.json.tasks.length === 0, r.json);
  r = await call('GET', '/api/search?q=');
  check('empty search', r.status === 200 && r.json.tasks.length === 0);

  // Project delete -> tasks project-less
  r = await call('DELETE', `/api/projects/${inbox.id}`);
  check('project delete', r.status === 200);
  r = await call('GET', `/api/tasks/${nextId}`);
  check('task became project-less', r.json.projectId === null, r.json);
  r = await call('GET', '/api/projects');
  check('no reseed after delete', r.json.projects.length === 3, r.json.projects.length);

  // Delete cascade
  r = await call('DELETE', `/api/tasks/${t1.id}`);
  check('delete cascades subtask', r.json.deleted === 2, r.json);
  r = await call('GET', `/api/links?type=task&id=${t2.id}`);
  check('links removed with task', r.json.links.length === 0, r.json);
  r = await call('GET', `/api/tasks/${t1.id}`);
  check('deleted task -> 404', r.status === 404 && typeof r.json.error === 'string');
  r = await call('PATCH', '/api/labels/nope', { name: 'x' });
  check('missing label -> 404', r.status === 404);

  console.log(failures ? `\n${failures} FAILED` : '\nALL OK');
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* db may still be open on Windows */ }
    process.exit(failures ? 1 : 0);
  });
