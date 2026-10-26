// Thin client for the habits and focus backends (both are served by routes/habits.ts).
// Every call throws an Error with a Turkish message on failure (network errors get `err.network = true`).
const { authFetch } = require('../../helper.js');

const request = async (method, url, body) => {
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

const enc = encodeURIComponent;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localToday = () => ymd(new Date());

const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return ymd(dt);
};

// 0 = Monday ... 6 = Sunday
const weekdayIndex = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
};

module.exports = {
  request,
  enc,
  localToday,
  addDays,
  weekdayIndex,
  ymd,

  listHabits: async (archived) => {
    const d = await request('GET', `/api/habits?archived=${archived ? 1 : 0}&today=${localToday()}`);
    return Array.isArray(d && d.habits) ? d.habits : [];
  },
  createHabit: (body) => request('POST', '/api/habits', body),
  updateHabit: (id, body) => request('PATCH', `/api/habits/${enc(id)}`, body),
  deleteHabit: (id) => request('DELETE', `/api/habits/${enc(id)}`),
  checkHabit: (id, done, date) => request('POST', `/api/habits/${enc(id)}/check`, { done, date, today: localToday() }),
  getHistory: (id, days = 120) => request('GET', `/api/habits/${enc(id)}/history?days=${days}&today=${localToday()}`),
};
