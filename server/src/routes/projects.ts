import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as tasksDb from '../db/tasks';
import { ApiError, readJson, sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const notFound = () => new ApiError(404, 'Proje bulunamadı.');

const projects = new Hono<HonoEnv>();

// GET /api/projects -> { projects, noProjectOpenCount } (seeds defaults on first use)
projects.get('/api/projects', requiresLogin, (c) => {
  try {
    const db = c.get('db');
    const userId = c.get('user').id;
    tasksDb.seedDefaultsIfNeeded(db, userId);
    return c.json(tasksDb.listProjects(db, userId));
  } catch (err) {
    return sendError(c, err, 'Projects list');
  }
});

// POST /api/projects { name, color?, icon?, archived?, sortOrder? }
projects.post('/api/projects', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(tasksDb.createProject(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return sendError(c, err, 'Projects create');
  }
});

// PATCH /api/projects/:id
projects.patch('/api/projects/:id', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const project = tasksDb.updateProject(c.get('db'), c.get('user').id, c.req.param('id'), body);
    if (!project) throw notFound();
    return c.json(project);
  } catch (err) {
    return sendError(c, err, 'Projects update');
  }
});

// DELETE /api/projects/:id (tasks become project-less)
projects.delete('/api/projects/:id', requiresLogin, (c) => {
  try {
    if (!tasksDb.deleteProject(c.get('db'), c.get('user').id, c.req.param('id'))) throw notFound();
    return c.json({ ok: true });
  } catch (err) {
    return sendError(c, err, 'Projects delete');
  }
});

export default projects;
