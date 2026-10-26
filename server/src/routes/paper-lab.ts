import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as paperLab from '../db/paper-lab';

type HonoEnv = { Bindings: Env; Variables: AuthContext };
const routes = new Hono<HonoEnv>();

routes.get('/api/paper-lab', requiresLogin, (c) =>
  c.json(paperLab.getState(c.get('db'), c.get('user').id)));

routes.post('/api/paper-lab/runs', requiresLogin, async (c) => {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Geçersiz deneme.' }, 400);
    return c.json(paperLab.startRun(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Deneme oluşturulamadı.' }, 400);
  }
});

routes.post('/api/paper-lab', requiresLogin, async (c) => {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Geçersiz kayıt.' }, 400);
    return c.json(paperLab.createEntry(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Kayıt oluşturulamadı.' }, 400);
  }
});

routes.delete('/api/paper-lab/:id', requiresLogin, (c) => {
  try {
    const ok = paperLab.deleteEntry(c.get('db'), c.get('user').id, c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Kayıt bulunamadı.' }, 404);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Kayıt silinemedi.' }, 409);
  }
});

export default routes;
