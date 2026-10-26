import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as tasksDb from '../db/tasks';
import { ApiError, readJson, sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const notFound = () => new ApiError(404, 'Etiket bulunamadı.');

const labels = new Hono<HonoEnv>();

// GET /api/labels -> { labels }
labels.get('/api/labels', requiresLogin, (c) => {
  try {
    return c.json({ labels: tasksDb.listLabels(c.get('db'), c.get('user').id) });
  } catch (err) {
    return sendError(c, err, 'Labels list');
  }
});

// POST /api/labels { name, color? }
labels.post('/api/labels', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(tasksDb.createLabel(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return sendError(c, err, 'Labels create');
  }
});

// PATCH /api/labels/:id { name?, color? }
labels.patch('/api/labels/:id', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const label = tasksDb.updateLabel(c.get('db'), c.get('user').id, c.req.param('id'), body);
    if (!label) throw notFound();
    return c.json(label);
  } catch (err) {
    return sendError(c, err, 'Labels update');
  }
});

// DELETE /api/labels/:id
labels.delete('/api/labels/:id', requiresLogin, (c) => {
  try {
    if (!tasksDb.deleteLabel(c.get('db'), c.get('user').id, c.req.param('id'))) throw notFound();
    return c.json({ ok: true });
  } catch (err) {
    return sendError(c, err, 'Labels delete');
  }
});

export default labels;
