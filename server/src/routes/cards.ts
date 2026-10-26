import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as cardsDb from '../db/cards';
import { ApiError, readJson, sendError } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const cardNotFound = () => new ApiError(404, 'Kart bulunamadı.');
const deckNotFound = () => new ApiError(404, 'Deste bulunamadı.');

const cards = new Hono<HonoEnv>();

// Static sub-paths are registered before /api/cards/:id on purpose.

// ── Decks ──
cards.get('/api/decks', requiresLogin, (c) => {
  try {
    return c.json({ decks: cardsDb.listDecks(c.get('db'), c.get('user').id) });
  } catch (err) {
    return sendError(c, err, 'Decks list');
  }
});

cards.post('/api/decks', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(cardsDb.createDeck(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return sendError(c, err, 'Decks create');
  }
});

cards.patch('/api/decks/:id', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const deck = cardsDb.updateDeck(c.get('db'), c.get('user').id, c.req.param('id'), body);
    if (!deck) throw deckNotFound();
    return c.json(deck);
  } catch (err) {
    return sendError(c, err, 'Decks update');
  }
});

// Deleting a deck also deletes its cards.
cards.delete('/api/decks/:id', requiresLogin, (c) => {
  try {
    const deleted = cardsDb.deleteDeck(c.get('db'), c.get('user').id, c.req.param('id'));
    if (deleted === null) throw deckNotFound();
    return c.json({ ok: true, deletedCards: deleted });
  } catch (err) {
    return sendError(c, err, 'Decks delete');
  }
});

// ── Settings / queue / stats / import / export ──
cards.get('/api/cards/settings', requiresLogin, (c) => {
  try {
    return c.json(cardsDb.getSettings(c.get('db'), c.get('user').id));
  } catch (err) {
    return sendError(c, err, 'Cards settings');
  }
});

cards.patch('/api/cards/settings', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(cardsDb.updateSettings(c.get('db'), c.get('user').id, body));
  } catch (err) {
    return sendError(c, err, 'Cards settings update');
  }
});

// GET /api/cards/queue?deckId=&limit= -> { cards:[card + nextIntervals], counts }
cards.get('/api/cards/queue', requiresLogin, (c) => {
  try {
    return c.json(cardsDb.getQueue(c.get('db'), c.get('user').id, c.req.query('deckId') || undefined, c.req.query('limit')));
  } catch (err) {
    return sendError(c, err, 'Cards queue');
  }
});

cards.get('/api/cards/stats', requiresLogin, (c) => {
  try {
    return c.json(cardsDb.getStats(c.get('db'), c.get('user').id));
  } catch (err) {
    return sendError(c, err, 'Cards stats');
  }
});

cards.post('/api/cards/import', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(cardsDb.importTsv(c.get('db'), c.get('user').id, body));
  } catch (err) {
    return sendError(c, err, 'Cards import');
  }
});

cards.get('/api/cards/export', requiresLogin, (c) => {
  try {
    const text = cardsDb.exportTsv(c.get('db'), c.get('user').id, c.req.query('deckId') || undefined);
    return c.body(text, 200, { 'Content-Type': 'text/tab-separated-values; charset=utf-8' });
  } catch (err) {
    return sendError(c, err, 'Cards export');
  }
});

// ── Cards ──
cards.get('/api/cards', requiresLogin, (c) => {
  try {
    const q = (k: string) => c.req.query(k);
    return c.json(cardsDb.listCards(c.get('db'), c.get('user').id, {
      deckId: q('deckId'), q: q('q'), state: q('state'), due: q('due'), limit: q('limit'), offset: q('offset'),
    }));
  } catch (err) {
    return sendError(c, err, 'Cards list');
  }
});

cards.post('/api/cards', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(cardsDb.createCard(c.get('db'), c.get('user').id, body), 201);
  } catch (err) {
    return sendError(c, err, 'Cards create');
  }
});

cards.get('/api/cards/:id', requiresLogin, (c) => {
  try {
    const card = cardsDb.getCard(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!card) throw cardNotFound();
    return c.json(card);
  } catch (err) {
    return sendError(c, err, 'Cards get');
  }
});

cards.patch('/api/cards/:id', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const card = cardsDb.updateCard(c.get('db'), c.get('user').id, c.req.param('id'), body);
    if (!card) throw cardNotFound();
    return c.json(card);
  } catch (err) {
    return sendError(c, err, 'Cards update');
  }
});

cards.delete('/api/cards/:id', requiresLogin, (c) => {
  try {
    if (!cardsDb.deleteCard(c.get('db'), c.get('user').id, c.req.param('id'))) throw cardNotFound();
    return c.json({ ok: true });
  } catch (err) {
    return sendError(c, err, 'Cards delete');
  }
});

// Toggles the suspended flag.
cards.post('/api/cards/:id/suspend', requiresLogin, (c) => {
  try {
    const card = cardsDb.toggleSuspend(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!card) throw cardNotFound();
    return c.json(card);
  } catch (err) {
    return sendError(c, err, 'Cards suspend');
  }
});

// POST /api/cards/:id/review {rating, durationMs?}  (?deckId= scopes the returned counts)
cards.post('/api/cards/:id/review', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    return c.json(cardsDb.reviewCard(
      c.get('db'), c.get('user').id, c.req.param('id'), body.rating, body.durationMs, new Date(), c.req.query('deckId') || undefined,
    ));
  } catch (err) {
    return sendError(c, err, 'Cards review');
  }
});

cards.post('/api/cards/:id/undo-review', requiresLogin, (c) => {
  try {
    return c.json(cardsDb.undoReview(c.get('db'), c.get('user').id, c.req.param('id'), new Date(), c.req.query('deckId') || undefined));
  } catch (err) {
    return sendError(c, err, 'Cards undo');
  }
});

export default cards;
