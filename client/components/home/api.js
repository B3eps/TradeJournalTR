// Small fetch helpers for the "Bugün" page. Errors carry `status` (HTTP) or `network`.
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
  try {
    const text = await res.text();
    if (text) data = JSON.parse(text);
  } catch (e) { data = null; }
  if (!res.ok) {
    const msg = data && (data.error || data.message);
    const err = new Error(typeof msg === 'string' && msg ? msg : `İstek başarısız (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
};

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localToday = () => dateKey(new Date());

// Monday (local) of the week containing `d`.
const weekStart = (d = new Date()) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
};

const enc = encodeURIComponent;

module.exports = { request, pad, dateKey, localToday, weekStart, enc };
