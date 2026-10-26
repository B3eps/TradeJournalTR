// Thin client for GET /api/graph. Throws Errors with Turkish messages.
const { authFetch } = require('../../helper.js');

const getGraph = async ({ types, limit, q } = {}) => {
  const p = new URLSearchParams();
  if (types && types.length) p.set('types', types.join(','));
  if (limit) p.set('limit', String(limit));
  if (q) p.set('q', q);
  const s = p.toString();
  let res;
  try {
    res = await authFetch(`/api/graph${s ? `?${s}` : ''}`);
  } catch (e) {
    const err = new Error('Sunucuya ulaşılamadı.');
    err.network = true;
    throw err;
  }
  let data = null;
  try { data = JSON.parse(await res.text()); } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `İstek başarısız (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return {
    nodes: Array.isArray(data && data.nodes) ? data.nodes : [],
    edges: Array.isArray(data && data.edges) ? data.edges : [],
    truncated: !!(data && data.truncated),
  };
};

module.exports = { getGraph };
