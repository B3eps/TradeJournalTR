import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as tasksDb from '../db/tasks';
import * as linksDb from '../db/links';
import { ApiError, readJson, sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const notFound = () => new ApiError(404, 'Görev bulunamadı.');

const tasks = new Hono<HonoEnv>();

// Static sub-paths are registered before /api/tasks/:id on purpose.

// GET /api/tasks?projectId=&status=open|done|all&due=today|overdue|today_overdue|upcoming|week|none|all
//               &label=&q=&parentId=root|all|<id>&sort=&limit=&offset=&today=YYYY-MM-DD
tasks.get('/api/tasks', requiresLogin, (c) => {
  try {
    const q = (k: string) => c.req.query(k);
    return c.json(tasksDb.listTasks(c.get('db'), c.get('user').id, {
      projectId: q('projectId'), status: q('status'), due: q('due'), label: q('label'), q: q('q'),
      parentId: q('parentId'), sort: q('sort'), limit: q('limit'), offset: q('offset'), today: q('today'),
    }));
  } catch (err) {
    return sendError(c, err, 'Tasks list');
  }
});

// GET /api/tasks/stats?days=30&today=YYYY-MM-DD
tasks.get('/api/tasks/stats', requiresLogin, (c) => {
  try {
    return c.json(tasksDb.getTaskStats(c.get('db'), c.get('user').id, c.req.query('days'), c.req.query('today')));
  } catch (err) {
    return sendError(c, err, 'Tasks stats');
  }
});

// GET /api/tasks/timer/running -> { task | null }
tasks.get('/api/tasks/timer/running', requiresLogin, (c) => {
  try {
    return c.json({ task: tasksDb.getRunningTask(c.get('db'), c.get('user').id) });
  } catch (err) {
    return sendError(c, err, 'Tasks timer');
  }
});

// POST /api/tasks/reorder { ids: string[] }
tasks.post('/api/tasks/reorder', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const updated = tasksDb.reorderTasks(c.get('db'), c.get('user').id, body.ids);
    return c.json({ ok: true, updated });
  } catch (err) {
    return sendError(c, err, 'Tasks reorder');
  }
});

// POST /api/tasks
tasks.post('/api/tasks', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(tasksDb.createTask(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return sendError(c, err, 'Tasks create');
  }
});

// GET /api/tasks/:id -> Task + { subtasks, links, parent }
tasks.get('/api/tasks/:id', requiresLogin, (c) => {
  try {
    const db = c.get('db');
    const userId = c.get('user').id;
    const task = tasksDb.getTask(db, userId, c.req.param('id'));
    if (!task) throw notFound();
    const parent = task.parentId ? tasksDb.getTask(db, userId, task.parentId) : null;
    return c.json({
      ...task,
      subtasks: tasksDb.getSubtasks(db, userId, task.id),
      links: linksDb.listLinks(db, userId, 'task', task.id),
      parent: parent ? { id: parent.id, title: parent.title, status: parent.status } : null,
    });
  } catch (err) {
    return sendError(c, err, 'Tasks get');
  }
});

// PATCH /api/tasks/:id (partial; labelIds replaces labels)
tasks.patch('/api/tasks/:id', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const task = tasksDb.updateTask(c.get('db'), c.get('user').id, c.req.param('id'), body);
    if (!task) throw notFound();
    return c.json(task);
  } catch (err) {
    return sendError(c, err, 'Tasks update');
  }
});

// DELETE /api/tasks/:id (cascades subtasks, time entries, links)
tasks.delete('/api/tasks/:id', requiresLogin, (c) => {
  try {
    const deleted = tasksDb.deleteTask(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!deleted) throw notFound();
    return c.json({ ok: true, deleted });
  } catch (err) {
    return sendError(c, err, 'Tasks delete');
  }
});

// POST /api/tasks/:id/complete (toggle) -> { task, next? }
tasks.post('/api/tasks/:id/complete', requiresLogin, (c) => {
  try {
    const today = tasksDb.resolveToday(c.req.query('today'));
    const result = tasksDb.completeTask(c.get('db'), c.get('user').id, c.req.param('id'), today);
    if (!result) throw notFound();
    return c.json(result);
  } catch (err) {
    return sendError(c, err, 'Tasks complete');
  }
});

// POST /api/tasks/:id/reopen -> Task
tasks.post('/api/tasks/:id/reopen', requiresLogin, (c) => {
  try {
    const task = tasksDb.reopenTask(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!task) throw notFound();
    return c.json(task);
  } catch (err) {
    return sendError(c, err, 'Tasks reopen');
  }
});

// POST /api/tasks/:id/timer/start -> Task (stops any other running timer)
tasks.post('/api/tasks/:id/timer/start', requiresLogin, (c) => {
  try {
    const task = tasksDb.startTimer(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!task) throw notFound();
    return c.json(task);
  } catch (err) {
    return sendError(c, err, 'Tasks timer');
  }
});

// POST /api/tasks/:id/timer/stop -> Task
tasks.post('/api/tasks/:id/timer/stop', requiresLogin, (c) => {
  try {
    const task = tasksDb.stopTimer(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!task) throw notFound();
    return c.json(task);
  } catch (err) {
    return sendError(c, err, 'Tasks timer');
  }
});

export default tasks;
