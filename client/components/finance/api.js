// Thin client for /api/finance. Every call throws an Error with a Turkish message on failure
// (network errors get `err.network = true`).
const { authFetch } = require('../../helper.js');

const request = async (method, url, body, raw) => {
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
  if (raw && res.ok) return res;
  let data = null;
  let text = '';
  try { text = await res.text(); } catch (e) { text = ''; }
  if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
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
const B = '/api/finance';

module.exports = {
  summary: (month, today) => request('GET', `${B}/summary${qs({ month, today })}`),
  accounts: async (archived) => ((await request('GET', `${B}/accounts${qs({ archived: archived ? 1 : '' })}`)) || {}).accounts || [],
  createAccount: (b) => request('POST', `${B}/accounts`, b),
  updateAccount: (id, b) => request('PATCH', `${B}/accounts/${enc(id)}`, b),
  deleteAccount: (id, force) => request('DELETE', `${B}/accounts/${enc(id)}${qs({ force: force ? 1 : '' })}`),
  categories: async () => ((await request('GET', `${B}/categories`)) || {}).categories || [],
  createCategory: (b) => request('POST', `${B}/categories`, b),
  updateCategory: (id, b) => request('PATCH', `${B}/categories/${enc(id)}`, b),
  deleteCategory: (id) => request('DELETE', `${B}/categories/${enc(id)}`),
  transactions: (params) => request('GET', `${B}/transactions${qs(params)}`),
  createTransaction: (b) => request('POST', `${B}/transactions`, b),
  updateTransaction: (id, b) => request('PATCH', `${B}/transactions/${enc(id)}`, b),
  deleteTransaction: (id) => request('DELETE', `${B}/transactions/${enc(id)}`),
  budgets: async (month) => { const d = await request('GET', `${B}/budgets${qs({ month })}`); return Array.isArray(d) ? d : []; },
  setBudget: (b) => request('PUT', `${B}/budgets`, b),
  copyBudgets: (to) => request('POST', `${B}/budgets/copy`, { to }),
  recurring: async () => ((await request('GET', `${B}/recurring`)) || {}).recurring || [],
  createRecurring: (b) => request('POST', `${B}/recurring`, b),
  updateRecurring: (id, b) => request('PATCH', `${B}/recurring/${enc(id)}`, b),
  deleteRecurring: (id) => request('DELETE', `${B}/recurring/${enc(id)}`),
  rates: async () => ((await request('GET', `${B}/rates`)) || {}).rates || [],
  setRates: (rates) => request('PUT', `${B}/rates`, { rates }),
  importCsv: (b) => request('POST', `${B}/import`, b),
  exportCsv: async (month) => (await request('GET', `${B}/export${qs({ month })}`, undefined, true)).blob(),
};
