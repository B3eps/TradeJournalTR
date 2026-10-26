// Thin client for the notes backend (and the bits of /api/search and /api/cards
// the Notes page uses). Every call throws an Error with a Turkish message on
// failure; network errors get `err.network = true`, HTTP errors `err.status`.
const { authFetch } = require('../../helper.js');

const request = async (method, url, body, opts = {}) => {
  let res;
  try {
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    if (opts.signal) init.signal = opts.signal;
    if (opts.keepalive) init.keepalive = true;
    res = await authFetch(url, init);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    const err = new Error('Sunucuya ulaşılamadı.');
    err.network = true;
    throw err;
  }
  let data = null;
  let text = '';
  try { text = await res.text(); } catch (e) { text = ''; }
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = null; }
  }
  if (!res.ok) {
    const msg = data && (data.error || data.message);
    const err = new Error(typeof msg === 'string' && msg ? msg : `İstek başarısız (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }
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
const arr = (v) => (Array.isArray(v) ? v : []);

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

module.exports = {
  localToday,

  listNotes: async (params, opts) => {
    const d = await request('GET', `/api/notes${qs(params)}`, undefined, opts);
    return { notes: arr(d && d.notes), total: d && typeof d.total === 'number' ? d.total : arr(d && d.notes).length };
  },
  listTags: async () => {
    const d = await request('GET', '/api/notes/tags');
    return arr(d && d.tags);
  },
  getNote: (id, opts) => request('GET', `/api/notes/${enc(id)}`, undefined, opts),
  createNote: (body) => request('POST', '/api/notes', body || {}),
  updateNote: (id, patch, opts) => request('PATCH', `/api/notes/${enc(id)}`, patch, opts),
  deleteNote: (id) => request('DELETE', `/api/notes/${enc(id)}`),
  daily: (date) => request('POST', '/api/notes/daily', { date: date || localToday() }),
  exportNotes: async () => arr(await request('GET', '/api/notes/export')),
  importNotes: (files) => request('POST', '/api/notes/import', { files }),

  // Global search; a missing or failing endpoint yields empty sections.
  search: async (q, limit = 6, opts) => {
    const empty = { tasks: [], trades: [], news: [], notes: [] };
    if (!q) return empty;
    try {
      const d = await request('GET', `/api/search${qs({ q, limit })}`, undefined, opts);
      return { tasks: arr(d && d.tasks), trades: arr(d && d.trades), news: arr(d && d.news), notes: arr(d && d.notes) };
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      return empty;
    }
  },

  // Flashcards are built by another module; 404/405 means "not available yet".
  createCard: async (body) => {
    try {
      return await request('POST', '/api/cards', body);
    } catch (e) {
      if (e && (e.status === 404 || e.status === 405 || e.status === 501)) {
        const err = new Error('Kartlar özelliği henüz kullanılamıyor.');
        err.unavailable = true;
        throw err;
      }
      throw e;
    }
  },
};
