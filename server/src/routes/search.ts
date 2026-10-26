import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import { searchAll } from '../db/links';
import { searchNotes } from '../db/notes';
import { sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const search = new Hono<HonoEnv>();

// GET /api/search?q=...&limit=8 -> { tasks, trades, news, projects, notes: [{ id, title, updatedAt }] }
search.get('/api/search', requiresLogin, (c) => {
  try {
    const db = c.get('db');
    const userId = c.get('user').id;
    const limitRaw = c.req.query('limit');
    // searchAll validates q and limit (400 on bad input) before notes are queried.
    const base = searchAll(db, userId, c.req.query('q'), limitRaw);
    const limit = limitRaw === undefined || limitRaw === '' ? 8 : Number(limitRaw);
    return c.json({ ...base, notes: searchNotes(db, userId, c.req.query('q'), limit) });
  } catch (err) {
    return sendError(c, err, 'Search');
  }
});

export default search;
