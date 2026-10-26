// Small JSON client for /api/integrations/* (Bağlantılar sayfası).
const helper = require('../../helper.js');

const { authFetch } = helper;

const request = async (method, url, body) => {
  let res;
  try {
    res = await authFetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Sunucuya ulaşılamadı.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `İstek başarısız (HTTP ${res.status}).`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
};

const api = {
  get: (url) => request('GET', url),
  put: (url, body) => request('PUT', url, body || {}),
  post: (url, body) => request('POST', url, body || {}),
  del: (url) => request('DELETE', url),
};

module.exports = api;
