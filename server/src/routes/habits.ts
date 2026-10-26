import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as habitsDb from '../db/habits';
import * as focusDb from '../db/focus';
import { ApiError, readJson, sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const notFound = () => new ApiError(404, 'Alışkanlık bulunamadı.');

const habits = new Hono<HonoEnv>();

// Static sub-paths are registered before /api/habits/:id on purpose.

// GET /api/habits?archived=0|1|all&today=YYYY-MM-DD -> { habits }
habits.get('/api/habits', requiresLogin, (c) => {
  try {
    return c.json({ habits: habitsDb.listHabits(c.get('db'), c.get('user').id, c.req.query('archived'), c.req.query('today')) });
  } catch (err) {
    return sendError(c, err, 'Habits list');
  }
});

// GET /api/habits/today?today=YYYY-MM-DD -> { habits: [{ id, name, icon, color, done, streak, ... }] }
habits.get('/api/habits/today', requiresLogin, (c) => {
  try {
    return c.json({ habits: habitsDb.listToday(c.get('db'), c.get('user').id, c.req.query('today')) });
  } catch (err) {
    return sendError(c, err, 'Habits today');
  }
});

// POST /api/habits { name, icon?, color?, targetPerWeek?, daysOfWeek? } -> habit
habits.post('/api/habits', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(habitsDb.createHabit(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return sendError(c, err, 'Habits create');
  }
});

// PATCH /api/habits/:id (partial; archived:true archives)
habits.patch('/api/habits/:id', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const h = habitsDb.updateHabit(c.get('db'), c.get('user').id, c.req.param('id'), body);
    if (!h) throw notFound();
    return c.json(h);
  } catch (err) {
    return sendError(c, err, 'Habits update');
  }
});

// DELETE /api/habits/:id (removes its checks)
habits.delete('/api/habits/:id', requiresLogin, (c) => {
  try {
    if (!habitsDb.deleteHabit(c.get('db'), c.get('user').id, c.req.param('id'))) throw notFound();
    return c.json({ ok: true });
  } catch (err) {
    return sendError(c, err, 'Habits delete');
  }
});

// POST /api/habits/:id/check { done, date?, note?, today? } -> { habit, streak }
habits.post('/api/habits/:id/check', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const result = habitsDb.checkHabit(c.get('db'), c.get('user').id, c.req.param('id'), body, c.req.query('today') ?? body.today);
    if (!result) throw notFound();
    return c.json(result);
  } catch (err) {
    return sendError(c, err, 'Habits check');
  }
});

// GET /api/habits/:id/history?days=120&today= -> { days, streak, bestStreak, completionRate30 }
habits.get('/api/habits/:id/history', requiresLogin, (c) => {
  try {
    const h = habitsDb.getHistory(c.get('db'), c.get('user').id, c.req.param('id'), c.req.query('days'), c.req.query('today'));
    if (!h) throw notFound();
    return c.json(h);
  } catch (err) {
    return sendError(c, err, 'Habits history');
  }
});

// ─── Odak (focus sessions); hosted here so the habits module owns both ───────

// GET /api/focus/settings
habits.get('/api/focus/settings', requiresLogin, (c) => {
  try {
    return c.json(focusDb.getSettings(c.get('db'), c.get('user').id));
  } catch (err) {
    return sendError(c, err, 'Focus settings');
  }
});

// PUT /api/focus/settings { workMin, shortMin, longMin, longEvery, autoStartBreaks, soundOn }
habits.put('/api/focus/settings', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(focusDb.saveSettings(c.get('db'), c.get('user').id, body));
  } catch (err) {
    return sendError(c, err, 'Focus settings');
  }
});

// POST /api/focus/sessions { taskId?, kind, startedAt, endedAt, seconds, completed }
habits.post('/api/focus/sessions', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(focusDb.recordSession(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return sendError(c, err, 'Focus session');
  }
});

// GET /api/focus/stats?days=14&today=YYYY-MM-DD
habits.get('/api/focus/stats', requiresLogin, (c) => {
  try {
    return c.json(focusDb.getStats(c.get('db'), c.get('user').id, c.req.query('days'), c.req.query('today')));
  } catch (err) {
    return sendError(c, err, 'Focus stats');
  }
});

export default habits;
