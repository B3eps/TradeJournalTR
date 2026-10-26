const React = require('react');
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const { AnimatePresence } = require('framer-motion');
const { FadeIn, ProgressRing } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const nav = require('../../utils/navigation');
const api = require('../tasks/api');
const U = require('../tasks/taskUtils');
const TI = require('../tasks/TaskIcons');
const ListSwitcher = require('../tasks/ListSwitcher');
const QuickAdd = require('../tasks/QuickAdd');
const TaskList = require('../tasks/TaskList');
const BoardView = require('../tasks/BoardView');
const TaskDrawer = require('../tasks/TaskDrawer');
const StatsStrip = require('../tasks/StatsStrip');
const FocusBar = require('../tasks/FocusBar');
const ToastStack = require('../tasks/ToastStack');

// =====================================================
// GÖREVLER (tasks) PAGE
// Lists: Gelen Kutusu, Bugün, Yaklaşan, Tüm Görevler, Tamamlananlar, projects, labels.
// Keyboard (outside inputs): q quick add · j/k move · x complete · e/Enter edit ·
// Delete remove · t due today · 1-4 priority · Esc closes the drawer.
// =====================================================

const PREFS_KEY = 'tasks-prefs';
const RUNNING_POLL_MS = 30 * 1000;
const LIST_POLL_MS = 60 * 1000;
const COMPLETE_ANIM_MS = 420;
const UNDO_MS = 5000;

const VIEW_TYPES = ['inbox', 'today', 'upcoming', 'all', 'done', 'project', 'label'];
const VIEW_TITLES = {
  inbox: 'Gelen Kutusu', today: 'Bugün', upcoming: 'Yaklaşan', all: 'Tüm Görevler', done: 'Tamamlananlar',
};
const EMPTY_COPY = {
  inbox: { title: 'Gelen kutun tertemiz', text: 'Aklına geleni yukarıdaki kutuya yaz, sonra düzenlersin.' },
  today: { title: 'Bugün için görev yok', text: 'Keyfine bak ya da yarını planlamaya başla.' },
  upcoming: { title: 'Önümüzdeki 7 gün boş', text: 'Tarihli bir görev ekle: ör. "cuma rapor teslim".' },
  all: { title: 'Hiç açık görev yok', text: 'Yeni bir şeye başlamak için harika bir an.' },
  done: { title: 'Henüz tamamlanan görev yok', text: 'İlk görevini bitirdiğinde burada görünecek.' },
  project: { title: 'Bu projede açık görev yok', text: 'Yukarıdan bu projeye görev ekleyebilirsin.' },
  label: { title: 'Bu etikette açık görev yok', text: 'Hızlı eklemede @etiket yazarak görev etiketleyebilirsin.' },
};

const loadPrefs = () => {
  const def = { view: { type: 'today' }, mode: 'list', boardGroup: 'project', sort: 'priority' };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p && typeof p === 'object') {
      return {
        view: p.view && VIEW_TYPES.includes(p.view.type) ? p.view : def.view,
        mode: p.mode === 'board' ? 'board' : 'list',
        boardGroup: p.boardGroup === 'priority' ? 'priority' : 'project',
        sort: ['priority', 'date', 'manual'].includes(p.sort) ? p.sort : 'priority',
      };
    }
  } catch (e) { /* ignore */ }
  return def;
};
const savePrefs = (p) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } };

const insertAt = (list, task, idx) => {
  const arr = list.filter(x => !U.sameId(x.id, task.id));
  arr.splice(idx < 0 ? arr.length : Math.min(idx, arr.length), 0, task);
  return arr;
};
const stripDetail = (t) => {
  if (!t) return t;
  const { subtasks, links, parent, ...rest } = t; // eslint-disable-line no-unused-vars
  return U.normTask(rest);
};
const short = (s, n = 40) => { const str = String(s || ''); return str.length > n ? `${str.slice(0, n - 1)}…` : str; };

const fetchForView = (v, projects) => {
  switch (v.type) {
    case 'inbox': {
      const ib = U.findInbox(projects);
      return api.listTasks({ projectId: ib ? ib.id : 'none', status: 'open', limit: 500 });
    }
    case 'today': return api.listTasks({ due: 'today_overdue', status: 'open', limit: 500 });
    case 'upcoming': return api.listTasks({ due: 'week', status: 'open', limit: 500 });
    case 'done': return api.listTasks({ status: 'done', sort: 'completed', limit: 200 });
    case 'project': return api.listTasks({ projectId: v.id, status: 'open', limit: 500 });
    case 'label': return api.listTasks({ label: v.id, status: 'open', limit: 500 });
    case 'all':
    default: return api.listTasks({ status: 'open', limit: 1000 });
  }
};

const Skeleton = () => (
  <div className="space-y-2" aria-hidden="true">
    {[0, 1, 2, 3, 4].map(i => (
      <div key={i} className="flex items-start gap-3 px-3 py-2.5">
        <div className="w-[18px] h-[18px] rounded-[5px] bg-bg-input animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 rounded bg-bg-input animate-pulse" style={{ width: `${70 - i * 9}%` }} />
          <div className="h-2.5 w-24 rounded bg-bg-input/70 animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);

const SegBtn = ({ active, onClick, children, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    title={label}
    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary'}`}
  >
    {children}
  </button>
);

const chipBase = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors';
const chipOff = 'bg-bg-input border-border text-text-secondary hover:text-text-primary';

const TasksPage = () => {
  const sound = useSound();
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const play = useCallback((name) => {
    try { if (soundRef.current && soundRef.current.play) soundRef.current.play(name); } catch (e) { /* ignore */ }
  }, []);

  const [prefs, setPrefsState] = useState(loadPrefs);
  const { view, mode, boardGroup, sort } = prefs;
  const updatePrefs = useCallback((patch) => {
    setPrefsState(p => { const n = { ...p, ...patch }; savePrefs(n); return n; });
  }, []);

  const [projects, setProjects] = useState([]);
  const [labels, setLabels] = useState([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [metaError, setMetaError] = useState('');

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [stats, setStats] = useState(null);
  const [statsFailed, setStatsFailed] = useState(false);

  const [filters, setFilters] = useState({ labelIds: [], priorities: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const [drawerLive, setDrawerLive] = useState(null);
  const [completingIds, setCompletingIds] = useState(() => new Set());
  const [running, setRunning] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [toasts, setToasts] = useState([]);

  // ---- refs mirroring state for stable callbacks ----
  const mountedRef = useRef(true);
  const tasksRef = useRef(tasks); tasksRef.current = tasks;
  const viewRef = useRef(view); viewRef.current = view;
  const projectsRef = useRef(projects); projectsRef.current = projects;
  const labelsRef = useRef(labels); labelsRef.current = labels;
  const runningRef = useRef(running); runningRef.current = running;
  const drawerIdRef = useRef(drawerId); drawerIdRef.current = drawerId;
  const completingRef = useRef(completingIds); completingRef.current = completingIds;
  const metaLoadedRef = useRef(false);
  const reqSeq = useRef(0);
  const busyRef = useRef(0);
  const pendingDeletes = useRef(new Set());
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Map());
  const toastHandlers = useRef(new Map());
  const allClearRef = useRef(false);
  const quickRef = useRef(null);
  const metaTimer = useRef(null);
  const statsTimer = useRef(null);
  const kbNavRef = useRef(false);

  const viewCtx = useCallback(() => {
    const ib = U.findInbox(projectsRef.current);
    return { inboxId: ib ? ib.id : null };
  }, []);
  const belongs = useCallback((t) => U.belongsToView(t, viewRef.current, viewCtx()), [viewCtx]);

  const setCompleting = (id, on) => setCompletingIds(prev => {
    const n = new Set(prev);
    if (on) n.add(String(id)); else n.delete(String(id));
    return n;
  });

  const syncDrawer = useCallback((t) => {
    if (t && U.sameId(drawerIdRef.current, t.id)) setDrawerLive(stripDetail(t));
  }, []);

  // ---------------- toasts ----------------
  const removeToast = (id) => {
    const tm = toastTimers.current.get(id);
    if (tm) clearTimeout(tm);
    toastTimers.current.delete(id);
    const h = toastHandlers.current.get(id);
    toastHandlers.current.delete(id);
    if (mountedRef.current) setToasts(prev => prev.filter(t => t.id !== id));
    return h;
  };
  const expireToast = useCallback((id) => {
    const h = removeToast(id);
    if (h && h.onExpire) h.onExpire();
  }, []);
  const actionToast = useCallback((id) => {
    const h = removeToast(id);
    if (h && h.onAction) h.onAction();
  }, []);
  const pushToast = useCallback(({ message, tone = 'info', actionLabel, onAction, onExpire, duration }) => {
    const id = ++toastSeq.current;
    const dur = duration || (actionLabel ? UNDO_MS : 3500);
    toastHandlers.current.set(id, { onAction, onExpire });
    setToasts(prev => [...prev, { id, message, tone, actionLabel, duration: dur }]);
    toastTimers.current.set(id, setTimeout(() => expireToast(id), dur));
    return id;
  }, [expireToast]);
  const pushError = useCallback((message) => pushToast({ message, tone: 'error', duration: 4500 }), [pushToast]);

  // ---------------- loading ----------------
  const loadMeta = useCallback(async () => {
    const [pr, lb] = await Promise.allSettled([api.listProjectsFull(), api.listLabels()]);
    if (!mountedRef.current) return;
    if (pr.status === 'fulfilled') setProjects(pr.value.projects);
    if (lb.status === 'fulfilled') setLabels(lb.value);
    const failed = [pr, lb].find(r => r.status === 'rejected');
    setMetaError(failed ? (failed.reason && failed.reason.message) || 'Projeler yüklenemedi.' : '');
    setMetaLoading(false);
    if (!metaLoadedRef.current) { metaLoadedRef.current = true; setMetaLoaded(true); }
  }, []);
  const scheduleMeta = useCallback(() => {
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => { if (mountedRef.current) loadMeta(); }, 700);
  }, [loadMeta]);

  const loadStats = useCallback(async () => {
    try {
      const s = await api.getStats(30);
      if (!mountedRef.current) return;
      setStats(s && typeof s === 'object' ? s : null);
      setStatsFailed(!s);
    } catch (e) {
      if (mountedRef.current) setStatsFailed(true);
    }
  }, []);
  const scheduleStats = useCallback(() => {
    if (statsTimer.current) clearTimeout(statsTimer.current);
    statsTimer.current = setTimeout(() => { if (mountedRef.current) loadStats(); }, 1200);
  }, [loadStats]);

  const loadTasks = useCallback(async (opts = {}) => {
    const v = viewRef.current;
    if (v.type === 'inbox' && !metaLoadedRef.current) return;
    if (opts.silent && (busyRef.current > 0 || completingRef.current.size > 0)) return;
    const seq = ++reqSeq.current;
    if (!opts.silent) setLoading(true);
    try {
      const { tasks: list } = await fetchForView(v, projectsRef.current);
      if (!mountedRef.current || seq !== reqSeq.current) return;
      if (opts.silent && (busyRef.current > 0 || completingRef.current.size > 0)) return;
      const pd = pendingDeletes.current;
      const cur = runningRef.current;
      setTasks(list.map(U.normTask).filter(t => !pd.has(String(t.id))).map(t => (
        cur && U.sameId(cur.id, t.id) && !t.runningSince ? { ...t, runningSince: cur.runningSince } : t
      )));
      setListError('');
    } catch (e) {
      if (!mountedRef.current || seq !== reqSeq.current) return;
      setListError(e.message || 'Görevler yüklenemedi.');
    }
    if (mountedRef.current && seq === reqSeq.current) setLoading(false);
  }, []);

  const loadRunning = useCallback(async () => {
    try {
      const t = await api.getRunningTimer();
      if (!mountedRef.current) return;
      const n = t ? U.normTask(t) : null;
      setRunning(n);
      setTasks(prev => prev.map(x => {
        if (n && U.sameId(x.id, n.id)) return { ...x, runningSince: n.runningSince, spentSeconds: n.spentSeconds };
        return x.runningSince ? { ...x, runningSince: null } : x;
      }));
    } catch (e) { /* keep current state; the list error banner covers outages */ }
  }, []);

  const refreshTask = useCallback(async (id) => {
    try {
      const t = stripDetail(await api.getTask(id));
      if (!mountedRef.current || !t) return;
      setTasks(prev => prev.map(x => (U.sameId(x.id, t.id) ? { ...x, ...t } : x)));
      syncDrawer(t);
    } catch (e) { /* not critical */ }
  }, [syncDrawer]);

  // ---------------- navigation helpers ----------------
  const openTask = useCallback((id) => {
    if (id == null) return;
    setDrawerLive(null);
    setDrawerId(id);
    setSelectedId(id);
  }, []);
  const closeDrawer = useCallback(() => { setDrawerId(null); setDrawerLive(null); }, []);
  const selectView = useCallback((v) => {
    updatePrefs({ view: v });
    setSelectedId(null);
    setFilters(f => (f.labelIds.length || f.priorities.length ? { labelIds: [], priorities: [] } : f));
  }, [updatePrefs]);
  const focusQuickAdd = useCallback(() => {
    // "Tamamlananlar" görünümünde hızlı ekleme yok: Bugün görünümüne geç.
    if (viewRef.current && viewRef.current.type === 'done') selectView({ type: 'today' });
    setTimeout(() => {
      if (quickRef.current) {
        quickRef.current.focus();
        try { quickRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
      }
    }, 0);
  }, [selectView]);
  const handlePending = useCallback((p) => {
    if (!p || p.itemId == null) return;
    if (p.itemType === 'project') selectView({ type: 'project', id: p.itemId });
    else if (p.itemType === 'label') selectView({ type: 'label', id: p.itemId });
    else openTask(p.itemId);
  }, [openTask, selectView]);

  // ---------------- mount: initial loads, polling, global events ----------------
  useEffect(() => {
    mountedRef.current = true;
    loadMeta();
    loadStats();
    loadRunning();
    handlePending(nav.consumePendingItem('tasks'));
    if (nav.consumePendingAction('quick-add-task')) focusQuickAdd();

    const onQuickAdd = () => { nav.consumePendingAction('quick-add-task'); focusQuickAdd(); };
    const onNav = (e) => {
      const d = (e && e.detail) || {};
      if (d.page !== 'tasks') return;
      setTimeout(() => {
        const p = nav.consumePendingItem('tasks');
        handlePending(p || d);
      }, 0);
    };
    window.addEventListener(nav.QUICK_ADD_TASK_EVENT || 'app:quick-add-task', onQuickAdd);
    window.addEventListener(nav.NAV_EVENT || 'app:navigate', onNav);

    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const runT = setInterval(() => { if (visible()) loadRunning(); }, RUNNING_POLL_MS);
    const listT = setInterval(() => {
      if (!visible()) return;
      loadTasks({ silent: true });
      loadStats();
      loadMeta();
    }, LIST_POLL_MS);
    const onVis = () => { if (visible()) { loadRunning(); loadTasks({ silent: true }); } };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      mountedRef.current = false;
      window.removeEventListener(nav.QUICK_ADD_TASK_EVENT || 'app:quick-add-task', onQuickAdd);
      window.removeEventListener(nav.NAV_EVENT || 'app:navigate', onNav);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(runT);
      clearInterval(listT);
      if (metaTimer.current) clearTimeout(metaTimer.current);
      if (statsTimer.current) clearTimeout(statsTimer.current);
      // commit pending deferred actions (e.g. deletes waiting for their undo window)
      const handlers = Array.from(toastHandlers.current.entries());
      toastTimers.current.forEach(tm => clearTimeout(tm));
      toastTimers.current.clear();
      toastHandlers.current.clear();
      handlers.forEach(([, h]) => { try { if (h.onExpire) h.onExpire(); } catch (e) { /* ignore */ } });
    };
  }, []); // mount-only on purpose: all callbacks used here are stable

  const viewKey = `${view.type}:${view.id != null ? view.id : ''}`;
  // the inbox list needs the projects (inbox id) first; other lists load right away
  const metaGate = view.type === 'inbox' ? metaLoaded : true;
  useEffect(() => {
    setTasks([]);
    setListError('');
    setLoading(true);
    loadTasks();
  }, [viewKey, metaGate]);

  // live clock while a timer runs
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running && running.id, running && running.runningSince]);

  // ---------------- mutations ----------------
  const createTask = useCallback(async (payload) => {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const labelObjs = (payload.labelIds || []).map(id => labelsRef.current.find(l => U.sameId(l.id, id))).filter(Boolean);
    const temp = U.normTask({
      id: tempId,
      title: payload.title,
      notes: '',
      projectId: payload.projectId != null ? payload.projectId : null,
      parentId: null,
      status: 'open',
      priority: payload.priority || 4,
      dueDate: payload.dueDate || null,
      dueTime: payload.dueTime || null,
      recurrence: payload.recurrence || null,
      labels: labelObjs,
      sortOrder: Number.MAX_SAFE_INTEGER,
      createdAt: new Date().toISOString(),
    });
    const shown = belongs(temp);
    if (shown) setTasks(prev => [...prev, temp]);
    play('pop');
    busyRef.current += 1;
    try {
      const created = U.normTask(await api.createTask(payload));
      if (!mountedRef.current) return created;
      setTasks(prev => {
        const without = prev.filter(x => x.id !== tempId);
        return belongs(created) ? [...without, created] : without;
      });
      if (!belongs(created)) {
        const p = projectsRef.current.find(x => U.sameId(x.id, created.projectId));
        pushToast({ message: `“${short(created.title, 32)}” eklendi${p ? ` · ${p.name}` : ''}${created.dueDate ? ` · ${U.relativeDayLabel(created.dueDate)}` : ''}` });
      }
      scheduleMeta();
      scheduleStats();
      return created;
    } catch (e) {
      if (mountedRef.current) setTasks(prev => prev.filter(x => x.id !== tempId));
      play('error');
      pushError(e.message || 'Görev eklenemedi.');
      throw e;
    } finally {
      busyRef.current -= 1;
    }
  }, [belongs, play, pushToast, pushError, scheduleMeta, scheduleStats]);

  const patchTask = useCallback(async (id, patch) => {
    const before = tasksRef.current.find(x => U.sameId(x.id, id));
    if (before) setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? U.applyPatch(x, patch, labelsRef.current) : x)));
    busyRef.current += 1;
    try {
      const t = U.normTask(await api.updateTask(id, patch));
      if (!mountedRef.current) return t;
      setTasks(prev => {
        const exists = prev.some(x => U.sameId(x.id, id));
        const fits = belongs(t);
        if (exists && !fits && !completingRef.current.has(String(id))) return prev.filter(x => !U.sameId(x.id, id));
        if (exists) return prev.map(x => (U.sameId(x.id, id) ? { ...x, ...t } : x));
        if (fits && !t.parentId) return [...prev, t];
        return prev;
      });
      syncDrawer(t);
      if ('projectId' in patch || 'labelIds' in patch) scheduleMeta();
      if ('dueDate' in patch || 'priority' in patch) scheduleStats();
      return t;
    } catch (e) {
      if (before && mountedRef.current) setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? before : x)));
      play('error');
      pushError(e.message || 'Değişiklik kaydedilemedi.');
      throw e;
    } finally {
      busyRef.current -= 1;
    }
  }, [belongs, play, pushError, scheduleMeta, scheduleStats, syncDrawer]);

  const undoComplete = useCallback(async (original, next, idx) => {
    busyRef.current += 1;
    try {
      if (next && !U.sameId(next.id, original.id)) {
        try { await api.deleteTask(next.id); } catch (e) { /* the copy may already be gone */ }
        if (mountedRef.current) setTasks(prev => prev.filter(x => !U.sameId(x.id, next.id)));
      }
      let t = U.normTask(await api.reopenTask(original.id));
      if (original.recurrence && !t.recurrence) {
        t = U.normTask(await api.updateTask(original.id, { recurrence: original.recurrence }));
      }
      if (!mountedRef.current) return;
      if (belongs(t) && (!t.parentId || idx >= 0)) setTasks(prev => insertAt(prev, t, idx));
      else setTasks(prev => (belongs(t) ? prev : prev.filter(x => !U.sameId(x.id, t.id))));
      syncDrawer(t);
      allClearRef.current = false;
      play('toggle-off');
      scheduleMeta();
      scheduleStats();
    } catch (e) {
      play('error');
      pushError(e.message || 'Geri alınamadı.');
      loadTasks({ silent: true });
    } finally {
      busyRef.current -= 1;
    }
  }, [belongs, play, pushError, scheduleMeta, scheduleStats, syncDrawer, loadTasks]);

  const toggleComplete = useCallback(async (task) => {
    if (!task || String(task.id).startsWith('tmp-')) return;
    const id = String(task.id);
    if (completingRef.current.has(id)) return;
    const prevList = tasksRef.current;
    const idx = prevList.findIndex(x => U.sameId(x.id, id));
    const original = idx >= 0 ? prevList[idx] : U.normTask(task);

    // ----- reopen a done task -----
    if (original.status === 'done') {
      const optimistic = { ...original, status: 'open', completedAt: null };
      if (idx >= 0) setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? optimistic : x)));
      syncDrawer(optimistic);
      play('toggle-off');
      busyRef.current += 1;
      try {
        const t = U.normTask(await api.reopenTask(id));
        if (!mountedRef.current) return;
        setTasks(prev => {
          if (!prev.some(x => U.sameId(x.id, id))) return prev;
          return belongs(t) ? prev.map(x => (U.sameId(x.id, id) ? t : x)) : prev.filter(x => !U.sameId(x.id, id));
        });
        syncDrawer(t);
        scheduleMeta();
        scheduleStats();
      } catch (e) {
        if (mountedRef.current && idx >= 0) setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? original : x)));
        syncDrawer(original);
        play('error');
        pushError(e.message || 'Görev yeniden açılamadı.');
      } finally {
        busyRef.current -= 1;
      }
      return;
    }

    // ----- complete -----
    const optimistic = { ...original, status: 'done', completedAt: new Date().toISOString(), runningSince: null };
    const leaves = !belongs(optimistic);
    if (idx >= 0) {
      setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? optimistic : x)));
      if (leaves) setCompleting(id, true);
    }
    syncDrawer(optimistic);
    let allClear = false;
    if (viewRef.current.type === 'today' && idx >= 0) {
      const remaining = prevList.filter(x => x.status !== 'done' && !U.sameId(x.id, id)
        && !completingRef.current.has(String(x.id)) && !String(x.id).startsWith('tmp-') && !x.parentId).length;
      if (remaining === 0 && !allClearRef.current) { allClear = true; allClearRef.current = true; }
    }
    play(allClear ? 'complete-all' : 'complete');
    const wasRunning = runningRef.current && U.sameId(runningRef.current.id, id);
    if (wasRunning) setRunning(null);

    const animDone = new Promise(r => setTimeout(r, leaves && idx >= 0 ? COMPLETE_ANIM_MS : 0));
    busyRef.current += 1;
    try {
      const res = await api.completeTask(id);
      const doneTask = res.task ? U.normTask(res.task) : optimistic;
      const next = res.next ? U.normTask(res.next) : null;
      await animDone;
      if (!mountedRef.current) return;
      setTasks(prev => {
        let list = belongs(doneTask)
          ? prev.map(x => (U.sameId(x.id, id) ? doneTask : x))
          : prev.filter(x => !U.sameId(x.id, id));
        if (next && belongs(next) && !next.parentId && !list.some(x => U.sameId(x.id, next.id))) list = insertAt(list, next, idx);
        return list;
      });
      setCompleting(id, false);
      syncDrawer(doneTask);
      pushToast({
        message: next
          ? `Tamamlandı · sıradaki ${next.dueDate ? U.relativeDayLabel(next.dueDate).toLocaleLowerCase('tr-TR') : 'oluşturuldu'}`
          : allClear ? 'Bugünün tüm görevleri tamam!' : `“${short(original.title, 30)}” tamamlandı`,
        actionLabel: 'Geri al',
        onAction: () => undoComplete(original, next, idx),
      });
      scheduleMeta();
      scheduleStats();
      if (wasRunning) loadRunning();
    } catch (e) {
      await animDone;
      if (!mountedRef.current) return;
      if (idx >= 0) setTasks(prev => insertAt(prev, original, idx));
      setCompleting(id, false);
      syncDrawer(original);
      if (allClear) allClearRef.current = false;
      if (wasRunning) loadRunning();
      play('error');
      pushError(e.message || 'Görev tamamlanamadı.');
    } finally {
      busyRef.current -= 1;
    }
  }, [belongs, play, pushToast, pushError, scheduleMeta, scheduleStats, syncDrawer, undoComplete, loadRunning]);

  const deleteTask = useCallback((task) => {
    if (!task || String(task.id).startsWith('tmp-')) return;
    const id = String(task.id);
    const prevList = tasksRef.current;
    const idx = prevList.findIndex(x => U.sameId(x.id, id));
    const original = idx >= 0 ? prevList[idx] : U.normTask(task);
    const wasRunning = runningRef.current && U.sameId(runningRef.current.id, id);
    pendingDeletes.current.add(id);
    setTasks(prev => prev.filter(x => !U.sameId(x.id, id)));
    if (U.sameId(drawerIdRef.current, id)) { setDrawerId(null); setDrawerLive(null); }
    if (wasRunning) setRunning(null);
    play('delete');
    pushToast({
      message: `“${short(original.title, 30)}” silindi`,
      actionLabel: 'Geri al',
      onAction: () => {
        pendingDeletes.current.delete(id);
        if (idx >= 0 && mountedRef.current) setTasks(prev => insertAt(prev, original, idx));
        if (wasRunning) loadRunning();
      },
      onExpire: async () => {
        try {
          await api.deleteTask(id);
          if (mountedRef.current) {
            scheduleMeta();
            scheduleStats();
            if (wasRunning) loadRunning();
          }
        } catch (e) {
          if (mountedRef.current) {
            if (idx >= 0) setTasks(prev => insertAt(prev, original, idx));
            play('error');
            pushError(e.message || 'Görev silinemedi.');
          }
        } finally {
          pendingDeletes.current.delete(id);
        }
      },
    });
  }, [play, pushToast, pushError, scheduleMeta, scheduleStats, loadRunning]);

  const toggleTimer = useCallback(async (task) => {
    if (!task || String(task.id).startsWith('tmp-')) return;
    const id = String(task.id);
    const cur = runningRef.current;
    if (cur && U.sameId(cur.id, id)) {
      // ----- stop -----
      const spent = (Number(cur.spentSeconds) || 0) + U.sessionSeconds(cur, Date.now());
      const optimistic = { ...cur, runningSince: null, spentSeconds: spent };
      runningRef.current = null;
      setRunning(null);
      setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? { ...x, runningSince: null, spentSeconds: spent } : x)));
      syncDrawer({ ...(tasksRef.current.find(x => U.sameId(x.id, id)) || optimistic), runningSince: null, spentSeconds: spent });
      play('stop');
      try {
        const t = U.normTask(await api.stopTimer(id));
        if (!mountedRef.current) return;
        setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? { ...x, ...t } : x)));
        syncDrawer(t);
        scheduleStats();
      } catch (e) {
        if (!mountedRef.current) return;
        runningRef.current = cur;
        setRunning(cur);
        setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? { ...x, runningSince: cur.runningSince, spentSeconds: cur.spentSeconds } : x)));
        syncDrawer(cur);
        play('error');
        pushError(e.message || 'Zamanlayıcı durdurulamadı.');
      }
      return;
    }
    // ----- start (the server stops any other running timer) -----
    const nowIso = new Date().toISOString();
    const base = tasksRef.current.find(x => U.sameId(x.id, id)) || U.normTask(task);
    const optimistic = { ...base, runningSince: nowIso };
    const prevRunning = cur;
    runningRef.current = optimistic;
    setRunning(optimistic);
    setTasks(prev => prev.map(x => {
      if (U.sameId(x.id, id)) return { ...x, runningSince: nowIso };
      if (prevRunning && U.sameId(x.id, prevRunning.id)) {
        return { ...x, runningSince: null, spentSeconds: (Number(x.spentSeconds) || 0) + U.sessionSeconds(prevRunning, Date.now()) };
      }
      return x;
    }));
    syncDrawer(optimistic);
    play('start');
    try {
      const t = U.normTask(await api.startTimer(id));
      if (!mountedRef.current) return;
      const live = t && t.runningSince ? t : { ...t, runningSince: nowIso };
      runningRef.current = live;
      setRunning(live);
      setTasks(prev => prev.map(x => (U.sameId(x.id, id) ? { ...x, ...live } : x)));
      syncDrawer(live);
      if (prevRunning) refreshTask(prevRunning.id);
    } catch (e) {
      if (!mountedRef.current) return;
      runningRef.current = prevRunning;
      setRunning(prevRunning);
      setTasks(prev => prev.map(x => {
        if (U.sameId(x.id, id)) return { ...x, runningSince: base.runningSince || null };
        if (prevRunning && U.sameId(x.id, prevRunning.id)) return { ...x, runningSince: prevRunning.runningSince, spentSeconds: prevRunning.spentSeconds };
        return x;
      }));
      syncDrawer(base);
      play('error');
      pushError(e.message || 'Zamanlayıcı başlatılamadı.');
    }
  }, [play, pushError, scheduleStats, syncDrawer, refreshTask]);

  const createLabel = useCallback(async (name) => {
    const clean = String(name || '').trim().replace(/^@/, '');
    if (!clean) return null;
    const existing = labelsRef.current.find(l => l.name && l.name.toLocaleLowerCase('tr-TR') === clean.toLocaleLowerCase('tr-TR'));
    if (existing) return existing;
    try {
      const l = await api.createLabel({ name: clean, color: U.PROJECT_COLORS[labelsRef.current.length % U.PROJECT_COLORS.length] });
      if (mountedRef.current && l && l.id != null) setLabels(prev => [...prev, l]);
      return l;
    } catch (e) {
      if (e.status === 409) {
        try {
          const list = await api.listLabels();
          if (mountedRef.current) setLabels(list);
          const found = list.find(x => x.name && x.name.toLocaleLowerCase('tr-TR') === clean.toLocaleLowerCase('tr-TR'));
          if (found) return found;
        } catch (e2) { /* fall through */ }
      }
      play('error');
      pushError(e.message || 'Etiket oluşturulamadı.');
      throw e;
    }
  }, [play, pushError]);

  const addProject = useCallback(async (name) => {
    try {
      const p = await api.createProject({ name, color: U.PROJECT_COLORS[projectsRef.current.length % U.PROJECT_COLORS.length] });
      if (!mountedRef.current) return true;
      if (p && p.id != null) {
        setProjects(prev => [...prev, { openTaskCount: 0, ...p }]);
        selectView({ type: 'project', id: p.id });
      } else {
        loadMeta();
      }
      play('pop');
      return true;
    } catch (e) {
      play('error');
      pushError(e.message || 'Proje eklenemedi.');
      return false;
    }
  }, [play, pushError, selectView, loadMeta]);

  const addLabel = useCallback(async (name) => {
    try {
      const l = await createLabel(name);
      if (l && l.id != null) { play('pop'); selectView({ type: 'label', id: l.id }); }
      return true;
    } catch (e) {
      return false;
    }
  }, [createLabel, play, selectView]);

  const moveOnBoard = useCallback((task, value) => {
    patchTask(task.id, value).catch(() => { /* error toast already shown */ });
  }, [patchTask]);

  const onSelectRow = useCallback((id) => setSelectedId(id), []);
  const onOpenRow = useCallback((task) => openTask(task.id), [openTask]);

  // ---------------- derived data ----------------
  const inbox = useMemo(() => U.findInbox(projects), [projects]);
  const projectMap = useMemo(() => {
    const m = new Map();
    projects.forEach(p => m.set(String(p.id), p));
    return m;
  }, [projects]);
  const projectById = useCallback((id) => (id == null ? null : projectMap.get(String(id)) || null), [projectMap]);

  const { filtered, orphanIds } = useMemo(() => {
    const ids = new Set(tasks.map(t => String(t.id)));
    const orphans = new Set();
    const top = tasks.filter(t => {
      if (!t.parentId) return true;
      if (ids.has(String(t.parentId))) return false;
      orphans.add(String(t.id));
      return true;
    });
    const f = top.filter(t => (filters.priorities.length === 0 || filters.priorities.includes(t.priority))
      && (filters.labelIds.length === 0 || (t.labels || []).some(l => filters.labelIds.some(fid => U.sameId(fid, l.id)))));
    return { filtered: f, orphanIds: orphans };
  }, [tasks, filters]);

  const groups = useMemo(() => {
    const today = U.todayISO();
    const sorted = (list) => U.sortTasks(list, sort);
    if (view.type === 'today') {
      const overdue = sorted(filtered.filter(t => t.dueDate && t.dueDate < today));
      const rest = sorted(filtered.filter(t => !t.dueDate || t.dueDate >= today));
      const d = new Date();
      const out = [];
      if (overdue.length) out.push({ key: 'overdue', title: 'Gecikmiş', tone: 'overdue', tasks: overdue });
      out.push({ key: 'today', title: overdue.length ? 'Bugün' : null, subtitle: `${d.getDate()} ${U.MONTHS_SHORT[d.getMonth()]} ${U.WEEKDAYS_LONG[d.getDay()]}`, tasks: rest });
      return out;
    }
    if (view.type === 'upcoming') {
      const out = [];
      const earlier = sorted(filtered.filter(t => t.dueDate && t.dueDate < today));
      if (earlier.length) out.push({ key: 'earlier', title: 'Gecikmiş', tone: 'overdue', tasks: earlier });
      for (let i = 0; i < 7; i++) {
        const iso = U.isoPlus(i);
        const dt = U.parseISO(iso);
        out.push({
          key: iso,
          title: i <= 1 ? U.relativeDayLabel(iso) : U.WEEKDAYS_LONG[dt.getDay()],
          subtitle: `${dt.getDate()} ${U.MONTHS_SHORT[dt.getMonth()]}${i <= 1 ? ` · ${U.WEEKDAYS_LONG[dt.getDay()]}` : ''}`,
          tone: i === 0 ? 'today' : undefined,
          tasks: sorted(filtered.filter(t => t.dueDate === iso)),
          emptyText: 'Boş gün',
        });
      }
      const last = U.isoPlus(6);
      const later = sorted(filtered.filter(t => !t.dueDate || t.dueDate > last));
      if (later.length) out.push({ key: 'later', title: 'Daha sonra', tasks: later });
      return out;
    }
    if (view.type === 'done') {
      const byDay = new Map();
      filtered
        .slice()
        .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
        .forEach(t => {
          const d = t.completedAt ? new Date(t.completedAt) : null;
          const iso = d && !isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'unknown';
          if (!byDay.has(iso)) byDay.set(iso, []);
          byDay.get(iso).push(t);
        });
      return Array.from(byDay.entries()).map(([iso, list]) => ({
        key: iso,
        title: iso === 'unknown' ? 'Tarihsiz' : U.relativeDayLabel(iso),
        subtitle: iso !== 'unknown' && U.dayDiff(iso) >= -1 ? U.shortDate(iso) : undefined,
        tasks: list,
      }));
    }
    return [{ key: 'all', title: null, tasks: sorted(filtered) }];
  }, [filtered, view.type, sort]);

  const visibleOrder = useMemo(() => (mode === 'board' && view.type !== 'done'
    ? U.sortTasks(filtered, sort)
    : groups.flatMap(g => g.tasks)), [mode, view.type, filtered, sort, groups]);

  // ---------------- manual reorder ----------------
  const reorder = useCallback((dragged, target, pos) => {
    const order = visibleOrder.filter(t => !U.sameId(t.id, dragged.id));
    let at = order.findIndex(t => U.sameId(t.id, target.id));
    if (at < 0) return;
    if (pos === 'after') at += 1;
    order.splice(at, 0, dragged);
    const ids = order.map(t => t.id);
    const rank = new Map(ids.map((id, i) => [String(id), i]));
    const snapshot = tasksRef.current;
    setTasks(prev => prev.map(x => (rank.has(String(x.id)) ? { ...x, sortOrder: rank.get(String(x.id)) } : x)));
    api.reorderTasks(ids).catch((e) => {
      if (!mountedRef.current) return;
      setTasks(snapshot);
      play('error');
      pushError(e.message || 'Sıralama kaydedilemedi.');
    });
    // dropping onto another day in "Yaklaşan" also moves the date
    if (viewRef.current.type === 'upcoming' && target.dueDate && target.dueDate !== dragged.dueDate) {
      patchTask(dragged.id, { dueDate: target.dueDate }).catch(() => {});
    }
  }, [visibleOrder, play, pushError, patchTask]);

  // ---------------- keyboard ----------------
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (U.isTypingTarget(e.target) || U.isTypingTarget(document.activeElement)) return;
    if (drawerId != null) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const key = e.key;
    // let focused buttons/links handle Enter and Space themselves
    if ((key === 'Enter' || key === ' ') && e.target && e.target.closest && e.target.closest('button, a, [role="checkbox"], [role="option"]')) return;
    if (key === 'q' || key === 'Q') { e.preventDefault(); focusQuickAdd(); return; }
    const order = visibleOrder;
    if (!order.length) return;
    const idx = order.findIndex(t => U.sameId(t.id, selectedId));
    const sel = idx >= 0 ? order[idx] : null;
    if (key === 'j' || key === 'k') {
      e.preventDefault();
      let ni;
      if (idx < 0) ni = key === 'j' ? 0 : order.length - 1;
      else ni = key === 'j' ? Math.min(order.length - 1, idx + 1) : Math.max(0, idx - 1);
      kbNavRef.current = true;
      setSelectedId(order[ni].id);
      return;
    }
    if (!sel) return;
    if (key === 'x') { e.preventDefault(); toggleComplete(sel); return; }
    if (key === 'e' || key === 'Enter') { e.preventDefault(); openTask(sel.id); return; }
    if (key === 'Delete') {
      e.preventDefault();
      const nextSel = order[idx + 1] || order[idx - 1] || null;
      deleteTask(sel);
      setSelectedId(nextSel ? nextSel.id : null);
      return;
    }
    if (key === 't') {
      e.preventDefault();
      if (sel.dueDate !== U.todayISO()) { play('click'); patchTask(sel.id, { dueDate: U.todayISO() }).catch(() => {}); }
      return;
    }
    if (['1', '2', '3', '4'].includes(key)) {
      e.preventDefault();
      const p = Number(key);
      if (sel.priority !== p) { play('click'); patchTask(sel.id, { priority: p }).catch(() => {}); }
    }
  };
  useEffect(() => {
    const h = (e) => { if (keyRef.current) keyRef.current(e); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    if (!kbNavRef.current || selectedId == null) return;
    kbNavRef.current = false;
    const el = document.getElementById(`task-row-${selectedId}`);
    if (el) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  }, [selectedId]);

  // reset the "all clear" chime once there are open tasks again
  useEffect(() => {
    if (view.type === 'today' && tasks.some(t => t.status !== 'done')) allClearRef.current = false;
  }, [tasks, view.type]);

  // ---------------- view meta ----------------
  const currentProject = view.type === 'project' ? projectById(view.id) : null;
  const currentLabel = view.type === 'label' ? labels.find(l => U.sameId(l.id, view.id)) : null;
  const title = view.type === 'project'
    ? (currentProject ? currentProject.name : 'Proje')
    : view.type === 'label'
      ? (currentLabel ? `@${currentLabel.name}` : 'Etiket')
      : VIEW_TITLES[view.type] || 'Görevler';

  const openCount = filtered.filter(t => t.status !== 'done').length;
  const doneCount = filtered.filter(t => t.status === 'done').length;
  const completedToday = stats ? Number(stats.completedToday) || 0 : 0;
  const remainingToday = view.type === 'today' && !loading && !listError
    ? tasks.filter(t => t.status !== 'done' && !t.parentId).length
    : stats ? (Number(stats.dueTodayCount) || 0) + (Number(stats.overdueCount) || 0) : 0;
  const todayDen = completedToday + remainingToday;
  const todayPct = todayDen > 0 ? (completedToday / todayDen) * 100 : 0;

  const counts = {
    inbox: inbox ? Number(inbox.openTaskCount) || 0 : 0,
    today: stats ? (Number(stats.dueTodayCount) || 0) + (Number(stats.overdueCount) || 0) : 0,
    overdue: stats ? Number(stats.overdueCount) || 0 : 0,
    all: stats ? Number(stats.openCount) || 0 : 0,
  };

  const qaDefaults = useMemo(() => {
    const d = { projectId: inbox ? inbox.id : null, dueDate: null, labelId: null };
    if (view.type === 'project') d.projectId = view.id;
    if (view.type === 'today') d.dueDate = U.todayISO();
    if (view.type === 'label') d.labelId = view.id;
    return d;
  }, [inbox, view.type, view.id]);

  const drawerListTask = drawerId != null ? tasks.find(t => U.sameId(t.id, drawerId)) || null : null;
  const drawerRunning = running && drawerId != null && U.sameId(running.id, drawerId) ? running : null;
  const liveTask = useMemo(() => {
    const base = drawerListTask || (drawerLive && U.sameId(drawerLive.id, drawerId) ? drawerLive : null);
    if (drawerRunning) return base ? { ...base, runningSince: drawerRunning.runningSince } : drawerRunning;
    return base;
  }, [drawerListTask, drawerLive, drawerRunning, drawerId]);

  const showStats = (view.type === 'today' || view.type === 'all') && stats && !statsFailed;
  const filtersActive = filters.labelIds.length > 0 || filters.priorities.length > 0;
  const showBoard = mode === 'board' && view.type !== 'done';
  const empty = !loading && !listError && filtered.length === 0;
  const emptyCopy = filtersActive && tasks.length > 0
    ? { title: 'Filtrelere uyan görev yok', text: 'Filtreleri gevşetmeyi ya da temizlemeyi dene.' }
    : view.type === 'today' && completedToday > 0
      ? { title: 'Bugünün tüm görevleri tamam!', text: 'Harika iş çıkardın. Biraz dinlenmeyi hak ettin.' }
      : EMPTY_COPY[view.type] || EMPTY_COPY.all;

  const togglePriorityFilter = (p) => setFilters(f => ({ ...f, priorities: f.priorities.includes(p) ? f.priorities.filter(x => x !== p) : [...f.priorities, p] }));
  const toggleLabelFilter = (id) => setFilters(f => ({ ...f, labelIds: f.labelIds.some(x => U.sameId(x, id)) ? f.labelIds.filter(x => !U.sameId(x, id)) : [...f.labelIds, id] }));

  const mobileValue = view.type === 'project' || view.type === 'label' ? `${view.type}:${view.id}` : view.type;

  return (
    <div className="space-y-4">
      <AnimatePresence initial={false}>
        {running && (
          <FadeIn key="focus" y={-6} className="sticky top-2 z-20">
            <FocusBar task={running} now={now} onStop={toggleTimer} onOpen={(t) => openTask(t.id)} />
          </FadeIn>
        )}
      </AnimatePresence>

      <div className="flex gap-6 items-start">
        {/* List switcher column */}
        <aside className="hidden md:block w-60 flex-shrink-0 sticky top-4">
          <ListSwitcher
            view={view}
            onSelect={selectView}
            projects={projects}
            labels={labels}
            counts={counts}
            onAddProject={addProject}
            onAddLabel={addLabel}
            metaLoading={metaLoading}
          />
          <p className="text-[10px] text-text-muted mt-3 px-2 leading-relaxed">
            Kısayollar: <b>q</b> ekle · <b>j/k</b> gez · <b>x</b> tamamla · <b>e</b> düzenle · <b>t</b> bugüne al · <b>1-4</b> öncelik · <b>Delete</b> sil
          </p>
        </aside>

        {/* Main column */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Mobile list picker */}
          <select
            className="md:hidden w-full bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
            value={mobileValue}
            onChange={(e) => {
              const [t, id] = e.target.value.split(':');
              if (t === 'project' || t === 'label') {
                const src = t === 'project' ? projects : labels;
                const item = src.find(x => String(x.id) === id);
                selectView({ type: t, id: item ? item.id : id });
              } else selectView({ type: t });
            }}
            aria-label="Liste seç"
          >
            {ListSwitcher.SMART_LISTS.map(l => <option key={l.type} value={l.type}>{l.label}</option>)}
            {projects.filter(p => !p.archived && !p.isInbox).map(p => <option key={`p${p.id}`} value={`project:${p.id}`}>Proje: {p.name}</option>)}
            {labels.map(l => <option key={`l${l.id}`} value={`label:${l.id}`}>Etiket: {l.name}</option>)}
          </select>

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <ProgressRing
                value={todayPct}
                size={46}
                stroke={4}
                color="rgb(var(--positive))"
                title={`Bugünün ilerlemesi: ${completedToday}/${todayDen}`}
                aria-label={`Bugünün ilerlemesi yüzde ${Math.round(todayPct)}`}
              >
                <span className="text-[10px]">%{Math.round(todayPct)}</span>
              </ProgressRing>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2 truncate">
                  {currentProject && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: currentProject.color || '#64748b' }} />}
                  {title}
                </h1>
                <p className="text-text-secondary text-sm mt-0.5">
                  {loading ? 'Yükleniyor…' : view.type === 'done' ? `${doneCount} tamamlanan görev` : `${openCount} açık görev`}
                  {todayDen > 0 ? ` · Bugün ${completedToday}/${todayDen} tamamlandı` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {view.type !== 'done' && (
                <div className="flex rounded-lg border border-border bg-bg-surface overflow-hidden" role="group" aria-label="Görünüm">
                  <SegBtn active={!showBoard} onClick={() => updatePrefs({ mode: 'list' })} label="Liste görünümü"><TI.Rows className="w-3.5 h-3.5" />Liste</SegBtn>
                  <SegBtn active={showBoard} onClick={() => updatePrefs({ mode: 'board' })} label="Pano görünümü"><TI.Columns className="w-3.5 h-3.5" />Pano</SegBtn>
                </div>
              )}
              {showBoard && (
                <select
                  value={boardGroup}
                  onChange={(e) => updatePrefs({ boardGroup: e.target.value })}
                  aria-label="Pano sütunları"
                  className="bg-bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-secondary focus:outline-none focus:border-accent"
                >
                  <option value="project">Sütun: Proje</option>
                  <option value="priority">Sütun: Öncelik</option>
                </select>
              )}
              {view.type !== 'done' && (
                <label className="flex items-center gap-1.5 bg-bg-surface border border-border rounded-lg pl-2.5 text-xs text-text-tertiary focus-within:border-accent">
                  <TI.Sort className="w-3.5 h-3.5" />
                  <select
                    value={sort}
                    onChange={(e) => updatePrefs({ sort: e.target.value })}
                    aria-label="Sıralama"
                    className="bg-transparent pr-2 py-1.5 text-xs text-text-secondary focus:outline-none"
                  >
                    <option value="priority">Öncelik</option>
                    <option value="date">Tarih</option>
                    <option value="manual">Manuel</option>
                  </select>
                </label>
              )}
              <button
                type="button"
                onClick={() => { loadTasks(); loadStats(); loadMeta(); loadRunning(); }}
                aria-label="Yenile"
                title="Yenile"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors"
              >
                <TI.Refresh className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Errors */}
          {listError && (
            <div role="alert" className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 text-warning text-sm">
              <TI.Alert className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">
                {tasks.length > 0 ? `Liste güncellenemedi; son alınan veriler gösteriliyor. (${listError})` : `Görevler yüklenemedi: ${listError}`}
              </span>
              <button type="button" onClick={() => { loadMeta(); loadTasks(); }} className="text-xs font-semibold hover:underline flex-shrink-0">Tekrar dene</button>
            </div>
          )}
          {metaError && !listError && (
            <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-2 text-warning text-xs">
              <TI.Alert className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1">Projeler veya etiketler alınamadı: {metaError}</span>
              <button type="button" onClick={loadMeta} className="font-semibold hover:underline">Tekrar dene</button>
            </div>
          )}

          {/* Analytics */}
          {showStats && <StatsStrip stats={stats} />}

          {/* Quick add */}
          {view.type !== 'done' && (
            <QuickAdd
              projects={projects}
              labels={labels}
              defaults={qaDefaults}
              onCreate={createTask}
              onCreateLabel={createLabel}
              inputRef={quickRef}
              play={play}
            />
          )}

          {/* Filters */}
          {view.type !== 'done' && (tasks.length > 0 || filtersActive) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-text-tertiary font-medium mr-1">Filtre</span>
              {[1, 2, 3, 4].map(p => {
                const on = filters.priorities.includes(p);
                const pm = U.prio(p);
                return (
                  <button key={p} type="button" aria-pressed={on} onClick={() => togglePriorityFilter(p)} className={`${chipBase} ${on ? pm.chip : chipOff}`}>
                    <TI.Flag className={`w-3 h-3 ${p < 4 ? pm.text : ''}`} />{pm.short}
                  </button>
                );
              })}
              {labels.length > 0 && <span className="w-px h-4 bg-border mx-1" />}
              {labels.map(l => {
                const on = filters.labelIds.some(x => U.sameId(x, l.id));
                return (
                  <button key={l.id} type="button" aria-pressed={on} onClick={() => toggleLabelFilter(l.id)} className={`${chipBase} ${on ? 'bg-info/15 border-info/40 text-info' : chipOff}`}>
                    <TI.Tag className="w-3 h-3" />{l.name}
                  </button>
                );
              })}
              {filtersActive && (
                <button type="button" onClick={() => setFilters({ labelIds: [], priorities: [] })} className="text-[11px] text-accent hover:underline ml-1">
                  Filtreleri temizle
                </button>
              )}
            </div>
          )}

          {/* Content */}
          {loading && tasks.length === 0 ? (
            <div className="bg-bg-surface border border-border rounded-xl p-2"><Skeleton /></div>
          ) : empty ? (
            <FadeIn className="bg-bg-surface border border-border rounded-xl p-10 text-center">
              {view.type === 'today' && completedToday > 0
                ? <TI.CheckCircle className="w-10 h-10 text-positive mx-auto mb-3" />
                : <TI.Inbox className="w-10 h-10 text-text-muted mx-auto mb-3" />}
              <p className="text-text-primary font-semibold">{emptyCopy.title}</p>
              <p className="text-text-secondary text-sm mt-1">{emptyCopy.text}</p>
              {view.type !== 'done' && !filtersActive && (
                <button type="button" onClick={focusQuickAdd} className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-colors">
                  <TI.Plus className="w-3.5 h-3.5" />Görev ekle
                </button>
              )}
            </FadeIn>
          ) : !listError || tasks.length > 0 ? (
            showBoard ? (
              <BoardView
                tasks={U.sortTasks(filtered, sort)}
                groupBy={boardGroup}
                projects={projects}
                selectedId={selectedId}
                completingIds={completingIds}
                runningId={running ? running.id : null}
                now={now}
                onMove={moveOnBoard}
                onToggle={toggleComplete}
                onOpen={onOpenRow}
                onTimer={toggleTimer}
                onSelect={onSelectRow}
              />
            ) : (
              <div className="bg-bg-surface border border-border rounded-xl p-2">
                <TaskList
                  groups={groups}
                  projectById={projectById}
                  selectedId={selectedId}
                  completingIds={completingIds}
                  runningId={running ? running.id : null}
                  now={now}
                  showProject={view.type !== 'project'}
                  manual={sort === 'manual' && view.type !== 'done'}
                  orphanIds={orphanIds}
                  onReorder={reorder}
                  onToggle={toggleComplete}
                  onOpen={onOpenRow}
                  onDelete={deleteTask}
                  onTimer={toggleTimer}
                  onSelect={onSelectRow}
                />
                {sort === 'manual' && view.type !== 'done' && (
                  <p className="text-[10px] text-text-muted px-3 pt-2 pb-1">Sürükleyip bırakarak sıralayabilirsin.</p>
                )}
              </div>
            )
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {drawerId != null && (
          <TaskDrawer
            key="task-drawer"
            taskId={drawerId}
            liveTask={liveTask}
            projects={projects}
            labels={labels}
            runningId={running ? running.id : null}
            now={now}
            onClose={closeDrawer}
            patchTask={patchTask}
            toggleComplete={toggleComplete}
            deleteTask={deleteTask}
            toggleTimer={toggleTimer}
            onOpenTask={openTask}
            onCreateLabel={createLabel}
            onTaskChanged={refreshTask}
            play={play}
          />
        )}
      </AnimatePresence>

      <ToastStack toasts={toasts} onAction={actionToast} onDismiss={expireToast} />
    </div>
  );
};

module.exports = TasksPage;
