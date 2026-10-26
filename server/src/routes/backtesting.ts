import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import * as backtestingDb from '../db/backtesting';
import { requiresLogin } from '../middleware/auth';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const backtesting = new Hono<HonoEnv>();

// GET /api/backtesting/sessions — list all sessions with stats
backtesting.get('/api/backtesting/sessions', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  try {
    const sessions = await backtestingDb.getSessionsWithStats(db, user.id);
    return c.json({ sessions });
  } catch (err) {
    console.error('getSessions error:', err);
    return c.json({ error: 'Test oturumları alınamadı.' }, 500);
  }
});

// POST /api/backtesting/sessions — start a new session
backtesting.post('/api/backtesting/sessions', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const { name, ticker, startDate } = body;

  if (!ticker || !startDate) {
    return c.json({ error: 'Sembol ve başlangıç tarihi zorunludur.' }, 400);
  }

  try {
    const session = await backtestingDb.createSession(db, user.id, { name, ticker, startDate });
    return c.json(session);
  } catch (err) {
    console.error('createSession error:', err);
    return c.json({ error: 'Test oturumu oluşturulamadı.' }, 500);
  }
});

// POST /api/backtesting/sessions/:id/end — end a session
backtesting.post('/api/backtesting/sessions/:id/end', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const { endDate } = body;

  if (!endDate) {
    return c.json({ error: 'Bitiş tarihi zorunludur.' }, 400);
  }

  try {
    const session = await backtestingDb.endSession(db, user.id, sessionId, endDate);
    return c.json(session);
  } catch (err) {
    console.error('endSession error:', err);
    return c.json({ error: 'Test oturumu bitirilemedi.' }, 500);
  }
});

// POST /api/backtesting/sessions/:id/continue — re-activate a session
backtesting.post('/api/backtesting/sessions/:id/continue', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sessionId = c.req.param('id');

  try {
    const session = await backtestingDb.continueSession(db, user.id, sessionId);
    return c.json(session);
  } catch (err) {
    console.error('continueSession error:', err);
    return c.json({ error: 'Test oturumu sürdürülemedi.' }, 500);
  }
});

// DELETE /api/backtesting/sessions/:id — delete a session and its trades
backtesting.delete('/api/backtesting/sessions/:id', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sessionId = c.req.param('id');

  try {
    await backtestingDb.deleteSession(db, user.id, sessionId);
    return c.json({ message: 'Test oturumu silindi.' });
  } catch (err) {
    console.error('deleteSession error:', err);
    return c.json({ error: 'Test oturumu silinemedi.' }, 500);
  }
});

// GET /api/backtesting/sessions/:id/trades — list trades for a session
backtesting.get('/api/backtesting/sessions/:id/trades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sessionId = c.req.param('id');

  try {
    const trades = await backtestingDb.getTradesForSession(db, user.id, sessionId);
    return c.json({ trades });
  } catch (err) {
    console.error('getTradesForSession error:', err);
    return c.json({ error: 'Test işlemleri alınamadı.' }, 500);
  }
});

// GET /api/backtesting/trades — list all trades across sessions
backtesting.get('/api/backtesting/trades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const trades = await backtestingDb.getTrades(db, user.id);
    return c.json({ trades });
  } catch (err) {
    console.error('getTrades error:', err);
    return c.json({ error: 'Test işlemleri alınamadı.' }, 500);
  }
});

// POST /api/backtesting/trades — add a trade to the active session
backtesting.post('/api/backtesting/trades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const { sessionId, result, profitFactor, timeOfDay } = body;

  if (!sessionId || !result || profitFactor == null || !timeOfDay) {
    return c.json({ error: 'Oturum, sonuç, kâr faktörü ve günün saati zorunludur.' }, 400);
  }
  if (result !== 'win' && result !== 'loss') {
    return c.json({ error: 'Sonuç "win" veya "loss" olmalıdır.' }, 400);
  }

  try {
    const trade = await backtestingDb.addTrade(db, user.id, { sessionId, result, profitFactor, timeOfDay });
    return c.json(trade);
  } catch (err) {
    console.error('addTrade error:', err);
    return c.json({ error: 'Test işlemi eklenemedi.' }, 500);
  }
});

// DELETE /api/backtesting/trades/:id — delete a trade
backtesting.delete('/api/backtesting/trades/:id', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const tradeId = c.req.param('id');

  try {
    await backtestingDb.deleteTrade(db, user.id, tradeId);
    return c.json({ message: 'Test işlemi silindi.' });
  } catch (err) {
    console.error('deleteTrade error:', err);
    return c.json({ error: 'Test işlemi silinemedi.' }, 500);
  }
});

export default backtesting;
