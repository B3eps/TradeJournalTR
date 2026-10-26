// Thin client for the Kartlar backend. Every call throws an Error with a Turkish
// message on failure (network errors get `err.network = true`).
const { authFetch } = require('../../helper.js');

const toError = async (res) => {
  let data = null;
  try { data = JSON.parse(await res.text()); } catch (e) { data = null; }
  const msg = data && (data.error || data.message);
  const err = new Error(typeof msg === 'string' && msg ? msg : `İstek başarısız (HTTP ${res.status}).`);
  err.status = res.status;
  return err;
};

const send = async (method, url, body) => {
  let res;
  try {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    res = await authFetch(url, opts);
  } catch (e) {
    const err = new Error('Sunucuya ulaşılamadı.');
    err.network = true;
    throw err;
  }
  return res;
};

const request = async (method, url, body) => {
  const res = await send(method, url, body);
  if (!res.ok) throw await toError(res);
  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch (e) { data = null; }
  return data;
};

const qs = (params) => {
  const p = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

const enc = encodeURIComponent;

module.exports = {
  listDecks: async () => {
    const d = await request('GET', '/api/decks');
    return d && Array.isArray(d.decks) ? d.decks : [];
  },
  createDeck: (body) => request('POST', '/api/decks', body),
  updateDeck: (id, body) => request('PATCH', `/api/decks/${enc(id)}`, body),
  deleteDeck: (id) => request('DELETE', `/api/decks/${enc(id)}`),

  listCards: async (params) => {
    const d = await request('GET', `/api/cards${qs(params)}`);
    const cards = d && Array.isArray(d.cards) ? d.cards : [];
    return { cards, total: d && typeof d.total === 'number' ? d.total : cards.length };
  },
  getCard: (id) => request('GET', `/api/cards/${enc(id)}`),
  createCard: (body) => request('POST', '/api/cards', body),
  updateCard: (id, body) => request('PATCH', `/api/cards/${enc(id)}`, body),
  deleteCard: (id) => request('DELETE', `/api/cards/${enc(id)}`),
  toggleSuspend: (id) => request('POST', `/api/cards/${enc(id)}/suspend`),

  getQueue: async (deckId, limit) => {
    const d = await request('GET', `/api/cards/queue${qs({ deckId, limit })}`);
    return {
      cards: d && Array.isArray(d.cards) ? d.cards : [],
      counts: (d && d.counts) || { new: 0, learning: 0, review: 0 },
    };
  },
  review: (id, rating, durationMs, deckId) =>
    request('POST', `/api/cards/${enc(id)}/review${qs({ deckId })}`, { rating, durationMs }),
  undoReview: (id, deckId) => request('POST', `/api/cards/${enc(id)}/undo-review${qs({ deckId })}`),

  getStats: () => request('GET', '/api/cards/stats'),
  getSettings: () => request('GET', '/api/cards/settings'),
  updateSettings: (body) => request('PATCH', '/api/cards/settings', body),

  importTsv: (deckId, tsv) => request('POST', '/api/cards/import', { deckId, tsv }),
  exportTsv: async (deckId) => {
    const res = await send('GET', `/api/cards/export${qs({ deckId })}`);
    if (!res.ok) throw await toError(res);
    return res.text();
  },
};
