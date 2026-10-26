import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as linksDb from '../db/links';
import { ApiError, readJson, sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const links = new Hono<HonoEnv>();

// GET /api/links?type=task&id=... -> { links: [{ linkId, type, id, label, direction, createdAt, missing, meta }] }
links.get('/api/links', requiresLogin, (c) => {
  try {
    return c.json({ links: linksDb.listLinks(c.get('db'), c.get('user').id, c.req.query('type'), c.req.query('id')) });
  } catch (err) {
    return sendError(c, err, 'Links list');
  }
});

// POST /api/links { fromType, fromId, toType, toId, label? } -> 201 { link, existing:false } | 200 { link, existing:true }
links.post('/api/links', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const result = linksDb.createLink(c.get('db'), c.get('user').id, body);
    return c.json(result, result.existing ? 200 : 201);
  } catch (err) {
    return sendError(c, err, 'Links create');
  }
});

// DELETE /api/links/:id
links.delete('/api/links/:id', requiresLogin, (c) => {
  try {
    if (!linksDb.deleteLink(c.get('db'), c.get('user').id, c.req.param('id'))) throw new ApiError(404, 'Bağlantı bulunamadı.');
    return c.json({ ok: true });
  } catch (err) {
    return sendError(c, err, 'Links delete');
  }
});

export default links;
