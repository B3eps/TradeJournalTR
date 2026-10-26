// Thin client for the tasks backend. Every call throws an Error with a Turkish
// message on failure (network errors get `err.network = true`).
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

const qs = (params) => {
  const p = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Accept both `{ key: [...] }` and a bare array.
const pickArray = (data, key) => {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  return [];
};
// Accept both `{ task: {...} }` and a bare task object.
const pickTask = (data) => {
  if (data && data.task && typeof data.task === 'object') return data.task;
  return data;
};

const enc = encodeURIComponent;

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

module.exports = {
  pickArray,
  pickTask,

  // ---- projects ----
  listProjects: async () => pickArray(await request('GET', '/api/projects'), 'projects'),
  // also returns noProjectOpenCount
  listProjectsFull: async () => {
    const d = await request('GET', '/api/projects');
    return { projects: pickArray(d, 'projects'), noProjectOpenCount: (d && Number(d.noProjectOpenCount)) || 0 };
  },
  createProject: async (body) => {
    const d = await request('POST', '/api/projects', body);
    return (d && d.project) || d;
  },
  updateProject: async (id, body) => {
    const d = await request('PATCH', `/api/projects/${enc(id)}`, body);
    return (d && d.project) || d;
  },
  deleteProject: (id) => request('DELETE', `/api/projects/${enc(id)}`),

  // ---- labels ----
  listLabels: async () => pickArray(await request('GET', '/api/labels'), 'labels'),
  createLabel: async (body) => {
    const d = await request('POST', '/api/labels', body);
    return (d && d.label) || d;
  },

  // ---- tasks ----
  // The browser's local date is always sent as `today` so due filters match the user's day.
  listTasks: async (params) => {
    const d = await request('GET', `/api/tasks${qs({ today: localToday(), ...params })}`);
    const tasks = pickArray(d, 'tasks');
    return { tasks, total: d && typeof d.total === 'number' ? d.total : tasks.length };
  },
  getTask: async (id) => pickTask(await request('GET', `/api/tasks/${enc(id)}`)),
  createTask: async (body) => pickTask(await request('POST', '/api/tasks', body)),
  updateTask: async (id, patch) => pickTask(await request('PATCH', `/api/tasks/${enc(id)}`, patch)),
  deleteTask: (id) => request('DELETE', `/api/tasks/${enc(id)}`),
  // returns { task, next }
  completeTask: async (id) => {
    const d = await request('POST', `/api/tasks/${enc(id)}/complete${qs({ today: localToday() })}`);
    if (d && d.task) return { task: d.task, next: d.next || null };
    return { task: d, next: null };
  },
  reopenTask: async (id) => pickTask(await request('POST', `/api/tasks/${enc(id)}/reopen`)),
  reorderTasks: (ids) => request('POST', '/api/tasks/reorder', { ids }),

  // ---- timer ----
  startTimer: async (id) => pickTask(await request('POST', `/api/tasks/${enc(id)}/timer/start`)),
  stopTimer: async (id) => pickTask(await request('POST', `/api/tasks/${enc(id)}/timer/stop`)),
  getRunningTimer: async () => {
    const d = await request('GET', '/api/tasks/timer/running');
    if (!d) return null;
    if (Object.prototype.hasOwnProperty.call(d, 'task')) return d.task || null;
    return d.id ? d : null;
  },

  // ---- stats ----
  getStats: (days = 30) => request('GET', `/api/tasks/stats${qs({ days, today: localToday() })}`),

  // ---- links ----
  listLinks: async (id) => pickArray(await request('GET', `/api/links${qs({ type: 'task', id })}`), 'links'),
  createLink: (body) => request('POST', '/api/links', body),
  deleteLink: (linkId) => request('DELETE', `/api/links/${enc(linkId)}`),

  // ---- search ----
  search: async (q, limit = 8) => {
    const d = await request('GET', `/api/search${qs({ q, limit })}`);
    return {
      tasks: pickArray(d, 'tasks'),
      trades: pickArray(d, 'trades'),
      news: pickArray(d, 'news'),
      projects: pickArray(d, 'projects'),
    };
  },
};
