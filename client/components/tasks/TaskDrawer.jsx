// Task detail drawer (slides in from the right, Esc closes, autosave on blur).
const React = require('react');
const { useState, useEffect, useRef, useCallback } = React;
const { motion } = require('framer-motion');
const { AnimatedCheck, Bar, useAnimationsEnabled } = require('../ui/motion');
const nav = require('../../utils/navigation');
const { firstOccurrence, toISODate } = require('../../utils/taskParse');
const api = require('./api');
const TI = require('./TaskIcons');
const U = require('./taskUtils');
const MarkdownPreview = require('./MarkdownPreview');

const LIVE_FIELDS = ['status', 'priority', 'dueDate', 'dueTime', 'projectId', 'labels', 'recurrence', 'spentSeconds',
  'runningSince', 'estimateMin', 'subtaskCount', 'subtaskDoneCount', 'linkCount', 'completedAt', 'updatedAt'];

const inputCls = 'w-full bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent';
const labelCls = 'block text-[11px] font-medium uppercase tracking-wider text-text-tertiary mb-1';

const Section = ({ title, icon: Icon, right, children }) => (
  <section className="border-t border-border pt-4 mt-4">
    <div className="flex items-center gap-2 mb-2.5">
      {Icon && <Icon className="w-4 h-4 text-text-tertiary" />}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary flex-1">{title}</h3>
      {right}
    </div>
    {children}
  </section>
);

const LINK_META = {
  task: { icon: TI.CheckCircle, label: 'Görev' },
  trade: { icon: TI.Trend, label: 'İşlem' },
  news: { icon: TI.News, label: 'Haber' },
  note: { icon: TI.Note, label: 'Not' },
  url: { icon: TI.Globe, label: 'Bağlantı' },
};

const recKind = (rec) => {
  if (!rec) return '';
  if (rec === 'daily' || rec === 'weekdays') return rec;
  if (rec.startsWith('weekly:')) return 'weekly';
  if (rec.startsWith('monthly:')) return 'monthly';
  if (rec.startsWith('every:')) return 'every';
  return '';
};
const WEEK_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const normalizeUrl = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return '';
    return u.toString();
  } catch (e) {
    return '';
  }
};

const TaskDrawer = ({
  taskId, liveTask, projects, labels, runningId, now,
  onClose, patchTask, toggleComplete, deleteTask, toggleTimer, onOpenTask, onCreateLabel, onTaskChanged, play,
}) => {
  const animate = useAnimationsEnabled();
  const [detail, setDetail] = useState(() => (liveTask ? U.normTask(liveTask) : null));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [subtasks, setSubtasks] = useState([]);
  const [links, setLinks] = useState([]);
  const [parent, setParent] = useState(null);

  const [titleDraft, setTitleDraft] = useState(liveTask ? liveTask.title || '' : '');
  const [notesDraft, setNotesDraft] = useState(liveTask ? liveTask.notes || '' : '');
  const [estDraft, setEstDraft] = useState(liveTask && liveTask.estimateMin ? String(liveTask.estimateMin) : '');
  const [notesMode, setNotesMode] = useState('edit');
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [newSub, setNewSub] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [labelMenu, setLabelMenu] = useState(false);

  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [linkMsg, setLinkMsg] = useState('');

  const mountedRef = useRef(true);
  const savedTimer = useRef(null);
  const asideRef = useRef(null);
  const detailRef = useRef(detail);
  const searchRequestRef = useRef(0);
  detailRef.current = detail;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  // ---- load detail whenever the task changes ----
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const t = await api.getTask(taskId);
      if (!mountedRef.current) return;
      const n = U.normTask(t);
      setDetail(n);
      setSubtasks(Array.isArray(t && t.subtasks) ? t.subtasks.map(U.normTask) : []);
      setLinks(Array.isArray(t && t.links) ? t.links : []);
      setParent(t && t.parent ? t.parent : null);
      setTitleDraft(n.title || '');
      setNotesDraft(n.notes || '');
      setEstDraft(n.estimateMin ? String(n.estimateMin) : '');
      setNotesMode(n.notes ? 'preview' : 'edit');
    } catch (e) {
      if (mountedRef.current) setLoadError(e.message || 'Görev yüklenemedi.');
    }
    if (mountedRef.current) setLoading(false);
  }, [taskId]);

  useEffect(() => {
    const lt = liveTask ? U.normTask(liveTask) : null;
    setDetail(lt);
    setTitleDraft(lt ? lt.title || '' : '');
    setNotesDraft(lt ? lt.notes || '' : '');
    setEstDraft(lt && lt.estimateMin ? String(lt.estimateMin) : '');
    setSubtasks([]);
    setLinks([]);
    setParent(null);
    setQ('');
    setResults(null);
    setLinkMsg('');
    setSaveState('idle');
    load();
    if (asideRef.current) asideRef.current.scrollTop = 0;
  }, [taskId]); // reset only when a different task is opened

  // ---- merge live list data (timer, completion, counts) ----
  useEffect(() => {
    if (!liveTask) return;
    setDetail(d => {
      if (!d || !U.sameId(d.id, liveTask.id)) return d;
      const next = { ...d };
      LIVE_FIELDS.forEach(f => { if (Object.prototype.hasOwnProperty.call(liveTask, f)) next[f] = liveTask[f]; });
      return U.normTask(next);
    });
  }, [liveTask]);

  // ---- saving ----
  const markSaved = () => {
    setSaveState('saved');
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => { if (mountedRef.current) setSaveState('idle'); }, 2200);
  };

  const save = async (patch) => {
    const prev = detailRef.current;
    if (!prev) return null;
    setDetail(d => U.applyPatch(d, patch, labels));
    setSaveState('saving');
    setSaveError('');
    try {
      const t = await patchTask(prev.id, patch, prev);
      if (mountedRef.current && t) setDetail(d => (d && U.sameId(d.id, t.id) ? U.normTask({ ...d, ...t }) : d));
      if (mountedRef.current) markSaved();
      return t;
    } catch (e) {
      if (!mountedRef.current) return null;
      setDetail(d => (d && U.sameId(d.id, prev.id) ? prev : d));
      if ('title' in patch) setTitleDraft(prev.title || '');
      if ('notes' in patch) setNotesDraft(prev.notes || '');
      if ('estimateMin' in patch) setEstDraft(prev.estimateMin ? String(prev.estimateMin) : '');
      setSaveState('error');
      setSaveError(e.message || 'Kaydedilemedi.');
      return null;
    }
  };

  const flushDrafts = () => {
    const d = detailRef.current;
    if (!d) return;
    const patch = {};
    const t = titleDraft.trim();
    if (t && t !== (d.title || '')) patch.title = t;
    if (!t) setTitleDraft(d.title || '');
    if (notesDraft !== (d.notes || '')) patch.notes = notesDraft;
    const est = estDraft.trim() === '' ? null : Math.max(0, Math.round(Number(estDraft)));
    if (estDraft.trim() !== '' && !Number.isFinite(est)) setEstDraft(d.estimateMin ? String(d.estimateMin) : '');
    else if ((est || null) !== (d.estimateMin || null)) patch.estimateMin = est;
    if (Object.keys(patch).length) save(patch);
  };

  const requestClose = () => { flushDrafts(); onClose(); };
  const openOther = (id) => { flushDrafts(); onOpenTask(id); };

  // Esc closes (inner widgets stop propagation when they use Esc themselves)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); requestClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- link search (debounced) ----
  useEffect(() => {
    const term = q.trim();
    const requestId = ++searchRequestRef.current;
    setResults(null);
    setSearchError('');
    if (term.length < 2) { setSearching(false); return undefined; }
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const r = await api.search(term, 6);
        if (mountedRef.current && requestId === searchRequestRef.current) { setResults(r); setSearchError(''); }
      } catch (e) {
        if (mountedRef.current && requestId === searchRequestRef.current) { setResults(null); setSearchError(e.message || 'Arama yapılamadı.'); }
      }
      if (mountedRef.current && requestId === searchRequestRef.current) setSearching(false);
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  if (!detail && loading) {
    return (
      <DrawerShell animate={animate} onBackdrop={requestClose} asideRef={asideRef}>
        <div className="p-6 space-y-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-6 rounded bg-bg-input animate-pulse" />)}
        </div>
      </DrawerShell>
    );
  }
  if (!detail) {
    return (
      <DrawerShell animate={animate} onBackdrop={requestClose} asideRef={asideRef}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Görev</h2>
            <button type="button" onClick={onClose} aria-label="Kapat" className="text-text-muted hover:text-text-primary"><TI.X className="w-5 h-5" /></button>
          </div>
          <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 text-warning text-sm">
            <TI.Alert className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{loadError || 'Görev bulunamadı.'}</span>
            <button type="button" onClick={load} className="text-xs font-semibold hover:underline">Tekrar dene</button>
          </div>
        </div>
      </DrawerShell>
    );
  }

  const done = detail.status === 'done';
  const isRunning = U.sameId(runningId, detail.id);
  const spent = U.totalSpent(detail, now);
  const est = Number(detail.estimateMin) || 0;
  const pct = est ? (spent / (est * 60)) * 100 : 0;
  const kind = recKind(detail.recurrence);
  const selectedLabelIds = (detail.labels || []).map(l => l.id);
  const activeProjects = (projects || []).filter(p => !p.archived || U.sameId(p.id, detail.projectId));
  const baseDate = U.parseISO(detail.dueDate) || new Date();

  const setRecurrence = (rec) => {
    const patch = { recurrence: rec };
    if (rec && !detail.dueDate) {
      const d = firstOccurrence(rec, new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
      if (d) patch.dueDate = toISODate(d);
    }
    save(patch);
  };
  const onKindChange = (k) => {
    if (k === '') setRecurrence(null);
    else if (k === 'daily' || k === 'weekdays') setRecurrence(k);
    else if (k === 'weekly') setRecurrence(`weekly:${U.DAY_CODES[baseDate.getDay()]}`);
    else if (k === 'monthly') setRecurrence(`monthly:${baseDate.getDate()}`);
    else if (k === 'every') setRecurrence('every:2d');
  };
  const weeklyCodes = kind === 'weekly' ? detail.recurrence.slice(7).split(',').filter(Boolean) : [];
  const toggleWeekDay = (code) => {
    const set = new Set(weeklyCodes);
    if (set.has(code)) { if (set.size === 1) return; set.delete(code); } else set.add(code);
    setRecurrence(`weekly:${WEEK_ORDER.filter(c => set.has(c)).join(',')}`);
  };
  const everyMatch = kind === 'every' ? detail.recurrence.slice(6).match(/^(\d+)([dw])$/) : null;
  const everyN = everyMatch ? Number(everyMatch[1]) : 2;
  const everyUnit = everyMatch ? everyMatch[2] : 'd';

  const toggleLabel = (id) => {
    const has = selectedLabelIds.some(x => U.sameId(x, id));
    const ids = has ? selectedLabelIds.filter(x => !U.sameId(x, id)) : [...selectedLabelIds, id];
    save({ labelIds: ids });
  };
  const addNewLabel = async () => {
    const name = newLabel.trim().replace(/^@/, '');
    if (!name) return;
    try {
      const l = await onCreateLabel(name);
      setNewLabel('');
      if (l && l.id != null) save({ labelIds: [...selectedLabelIds, l.id] });
    } catch (e) { /* page shows the error */ }
  };

  // ---- subtasks ----
  const addSubtask = async () => {
    const title = newSub.trim();
    if (!title) return;
    setNewSub('');
    const tempId = `tmp-${Date.now()}`;
    setSubtasks(s => [...s, U.normTask({ id: tempId, title, status: 'open', priority: 4, parentId: detail.id })]);
    play('pop');
    try {
      const body = { title, parentId: detail.id };
      if (detail.projectId != null) body.projectId = detail.projectId;
      const t = await api.createTask(body);
      if (!mountedRef.current) return;
      setSubtasks(s => s.map(x => (x.id === tempId ? U.normTask(t) : x)));
      onTaskChanged(detail.id);
    } catch (e) {
      if (!mountedRef.current) return;
      setSubtasks(s => s.filter(x => x.id !== tempId));
      setNewSub(title);
      play('error');
      setSaveState('error');
      setSaveError(e.message || 'Alt görev eklenemedi.');
    }
  };
  const toggleSubtask = async (sub) => {
    const wasDone = sub.status === 'done';
    setSubtasks(s => s.map(x => (U.sameId(x.id, sub.id) ? { ...x, status: wasDone ? 'open' : 'done' } : x)));
    play(wasDone ? 'toggle-off' : 'complete');
    try {
      const r = await api.completeTask(sub.id);
      if (!mountedRef.current) return;
      setSubtasks(s => {
        let list = s.map(x => (U.sameId(x.id, sub.id) && r.task ? U.normTask(r.task) : x));
        if (r.next && !list.some(x => U.sameId(x.id, r.next.id))) list = [...list, U.normTask(r.next)];
        return list;
      });
      onTaskChanged(detail.id);
    } catch (e) {
      if (!mountedRef.current) return;
      setSubtasks(s => s.map(x => (U.sameId(x.id, sub.id) ? sub : x)));
      play('error');
      setSaveState('error');
      setSaveError(e.message || 'Alt görev güncellenemedi.');
    }
  };
  const removeSubtask = async (sub) => {
    const before = subtasks;
    setSubtasks(s => s.filter(x => !U.sameId(x.id, sub.id)));
    play('delete');
    try {
      await api.deleteTask(sub.id);
      onTaskChanged(detail.id);
    } catch (e) {
      if (!mountedRef.current) return;
      setSubtasks(before);
      play('error');
      setSaveState('error');
      setSaveError(e.message || 'Alt görev silinemedi.');
    }
  };

  // ---- links ----
  const reloadLinks = async () => {
    try {
      const l = await api.listLinks(detail.id);
      if (mountedRef.current) setLinks(l);
    } catch (e) { /* keep current */ }
  };
  const addLink = async (toType, toId, label) => {
    setLinkMsg('');
    try {
      const body = { fromType: 'task', fromId: detail.id, toType, toId };
      if (label) body.label = label;
      const r = await api.createLink(body);
      if (!mountedRef.current) return;
      if (r && r.existing) setLinkMsg('Bu öğe zaten bağlı.');
      else play('pop');
      setQ('');
      setResults(null);
      if (r && r.link && !links.some(l => U.sameId(l.linkId, r.link.linkId))) setLinks(ls => [...ls, r.link]);
      reloadLinks();
      onTaskChanged(detail.id);
    } catch (e) {
      if (!mountedRef.current) return;
      play('error');
      setLinkMsg(e.message || 'Bağlantı eklenemedi.');
    }
  };
  const removeLink = async (link) => {
    const before = links;
    setLinks(ls => ls.filter(l => !U.sameId(l.linkId, link.linkId)));
    try {
      await api.deleteLink(link.linkId);
      play('delete');
      onTaskChanged(detail.id);
    } catch (e) {
      if (!mountedRef.current) return;
      setLinks(before);
      play('error');
      setLinkMsg(e.message || 'Bağlantı kaldırılamadı.');
    }
  };
  const openLink = (link) => {
    if (link.missing) return;
    const id = link.id;
    if (link.type === 'task') openOther(id);
    else if (link.type === 'trade') { flushDrafts(); nav.navigate('trades', id, { itemType: 'trade' }); }
    else if (link.type === 'news') { flushDrafts(); nav.navigate('newsfeed', id, { itemType: 'news' }); }
    else if (link.type === 'note') { flushDrafts(); nav.navigate('dashboard', id, { itemType: 'note' }); }
    else if (link.type === 'url') {
      const url = normalizeUrl((link.meta && link.meta.url) || id);
      if (url) { try { window.open(url, '_blank', 'noopener'); } catch (e) { /* ignore */ } }
    }
  };
  const addUrl = () => {
    const url = normalizeUrl(urlInput);
    if (!url) { setLinkMsg('Geçerli bir adres gir (ör. https://ornek.com).'); return; }
    setUrlInput('');
    addLink('url', url, url);
  };

  const fmtPl = (pl) => {
    if (pl == null || pl === '' || isNaN(Number(pl))) return null;
    const n = Number(pl);
    return { text: `${n >= 0 ? '+' : ''}${n.toFixed(2)}`, cls: n >= 0 ? 'text-positive' : 'text-negative' };
  };

  const resultGroups = results ? [
    { key: 'trades', title: 'İşlemler', items: results.trades.map(t => ({ id: t.id, type: 'trade', title: `${t.ticker || 'İşlem'}${t.date ? ` · ${U.shortDate(String(t.date).slice(0, 10)) || t.date}` : ''}`, pl: fmtPl(t.pl), label: `${t.ticker || 'İşlem'} ${t.date || ''}`.trim() })) },
    { key: 'news', title: 'Haberler', items: results.news.map(n => ({ id: n.id, type: 'news', title: n.title, sub: n.source, label: n.title })) },
    { key: 'tasks', title: 'Görevler', items: results.tasks.filter(t => !U.sameId(t.id, detail.id)).map(t => ({ id: t.id, type: 'task', title: t.title, sub: t.projectName, done: t.status === 'done', label: t.title })) },
    { key: 'projects', title: 'Projeler (görevi taşı)', items: results.projects.map(p => ({ id: p.id, type: 'project', title: p.name, label: p.name })) },
  ].filter(g => g.items.length) : [];

  const saveIndicator = saveState === 'saving'
    ? <span className="text-[11px] text-text-muted">Kaydediliyor…</span>
    : saveState === 'saved'
      ? <span className="text-[11px] text-positive flex items-center gap-1"><TI.Check className="w-3 h-3" />Kaydedildi</span>
      : saveState === 'error'
        ? <span className="text-[11px] text-negative" title={saveError}>Kaydedilemedi</span>
        : null;

  return (
    <DrawerShell animate={animate} onBackdrop={requestClose} asideRef={asideRef}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-bg-surface/95 backdrop-blur border-b border-border px-5 py-3 flex items-center gap-2">
        <span className="text-xs text-text-tertiary flex-1 truncate">
          {parent ? (
            <button type="button" onClick={() => openOther(parent.id)} className="hover:text-accent inline-flex items-center gap-1">
              <TI.Subtask className="w-3 h-3 rotate-180" />{parent.title}
            </button>
          ) : 'Görev ayrıntısı'}
        </span>
        {saveIndicator}
        <button
          type="button"
          onClick={() => deleteTask(detail)}
          className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-text-tertiary hover:text-negative hover:bg-negative/10"
          aria-label="Görevi sil"
          title="Sil"
        >
          <TI.Trash className="w-4 h-4" />
        </button>
        <button type="button" onClick={requestClose} aria-label="Kapat (Esc)" title="Kapat (Esc)" className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-input">
          <TI.X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 py-4">
        {saveState === 'error' && saveError && (
          <div className="mb-3 flex items-center gap-2 bg-negative/10 border border-negative/30 rounded-lg px-3 py-2 text-negative text-xs">
            <TI.Alert className="w-3.5 h-3.5 flex-shrink-0" />{saveError}
          </div>
        )}
        {loadError && (
          <div className="mb-3 flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 text-warning text-xs">
            <TI.Alert className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1">Ayrıntılar yüklenemedi: {loadError}</span>
            <button type="button" onClick={load} className="font-semibold hover:underline">Tekrar dene</button>
          </div>
        )}

        {/* Title */}
        <div className="flex items-start gap-3">
          <div className="pt-1.5">
            <AnimatedCheck
              checked={done}
              onChange={() => toggleComplete(detail)}
              size={20}
              color={detail.priority < 4 ? U.prio(detail.priority).color : 'rgb(var(--accent))'}
              aria-label={done ? 'Yeniden aç' : 'Tamamla'}
            />
          </div>
          <textarea
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value.replace(/\n/g, ' '))}
            onBlur={flushDrafts}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
            rows={1}
            aria-label="Görev başlığı"
            className={`flex-1 resize-none bg-transparent text-lg font-semibold leading-snug focus:outline-none rounded-md px-1 -mx-1 focus:bg-bg-input ${done ? 'line-through text-text-tertiary' : 'text-text-primary'}`}
            style={{ fieldSizing: 'content' }}
            maxLength={300}
          />
        </div>

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className={labelCls} htmlFor="td-project">Proje</label>
            <select
              id="td-project"
              value={detail.projectId != null ? String(detail.projectId) : ''}
              onChange={(e) => {
                const v = e.target.value;
                const p = activeProjects.find(x => String(x.id) === v);
                save({ projectId: p ? p.id : null });
              }}
              className={inputCls}
            >
              <option value="">Projesiz</option>
              {activeProjects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <span className={labelCls}>Öncelik</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Öncelik">
              {[1, 2, 3, 4].map(p => {
                const pm = U.prio(p);
                const on = detail.priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => { if (!on) save({ priority: p }); }}
                    title={pm.label}
                    className={`flex-1 h-[34px] inline-flex items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-colors ${on ? pm.chip : 'border-border text-text-tertiary hover:text-text-primary bg-bg-input'}`}
                  >
                    <TI.Flag className={`w-3 h-3 ${p < 4 ? pm.text : ''}`} />{p}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="td-date">Tarih</label>
            <div className="flex gap-1">
              <input
                id="td-date"
                type="date"
                value={detail.dueDate || ''}
                onChange={(e) => save({ dueDate: e.target.value || null, ...(e.target.value ? {} : { dueTime: null }) })}
                className={inputCls}
              />
              {detail.dueDate && (
                <button type="button" onClick={() => save({ dueDate: null, dueTime: null })} aria-label="Tarihi temizle" className="px-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-input"><TI.X className="w-3.5 h-3.5" /></button>
              )}
            </div>
            <div className="flex gap-1 mt-1.5">
              {[['Bugün', 0], ['Yarın', 1], ['+1 hafta', 7]].map(([lbl, n]) => (
                <button key={lbl} type="button" onClick={() => save({ dueDate: U.isoPlus(n) })} className="px-2 py-0.5 rounded-md text-[11px] border border-border text-text-tertiary hover:text-accent hover:border-accent/50">{lbl}</button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="td-time">Saat</label>
            <div className="flex gap-1">
              <input
                id="td-time"
                type="time"
                value={detail.dueTime || ''}
                onChange={(e) => {
                  const v = e.target.value || null;
                  save(v && !detail.dueDate ? { dueTime: v, dueDate: U.todayISO() } : { dueTime: v });
                }}
                className={inputCls}
              />
              {detail.dueTime && (
                <button type="button" onClick={() => save({ dueTime: null })} aria-label="Saati temizle" className="px-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-input"><TI.X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          </div>
          <div className="col-span-2">
            <label className={labelCls} htmlFor="td-rec">Tekrar</label>
            <div className="flex flex-wrap gap-2 items-center">
              <select id="td-rec" value={kind} onChange={(e) => onKindChange(e.target.value)} className={`${inputCls} w-auto`}>
                <option value="">Tekrarlanmaz</option>
                <option value="daily">Her gün</option>
                <option value="weekdays">Hafta içi her gün</option>
                <option value="weekly">Haftalık…</option>
                <option value="monthly">Aylık…</option>
                <option value="every">Özel aralık…</option>
              </select>
              {kind === 'weekly' && (
                <div className="flex gap-1" aria-label="Haftanın günleri">
                  {WEEK_ORDER.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={weeklyCodes.includes(c)}
                      onClick={() => toggleWeekDay(c)}
                      className={`w-9 h-8 rounded-md text-[11px] font-medium border transition-colors ${weeklyCodes.includes(c) ? 'bg-accent/15 border-accent text-accent' : 'border-border text-text-tertiary hover:text-text-primary'}`}
                    >
                      {U.DAY_CODE_SHORT[c]}
                    </button>
                  ))}
                </div>
              )}
              {kind === 'monthly' && (
                <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                  Her ayın
                  <input
                    key={detail.recurrence}
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={detail.recurrence.slice(8)}
                    onBlur={(e) => {
                      const n = Math.min(31, Math.max(1, Math.round(Number(e.target.value) || 1)));
                      if (`monthly:${n}` !== detail.recurrence) setRecurrence(`monthly:${n}`);
                    }}
                    className={`${inputCls} w-16`}
                  />
                  . günü
                </label>
              )}
              {kind === 'every' && (
                <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input
                    key={detail.recurrence}
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={everyN}
                    onBlur={(e) => {
                      const n = Math.min(365, Math.max(1, Math.round(Number(e.target.value) || 1)));
                      if (n !== everyN) setRecurrence(`every:${n}${everyUnit}`);
                    }}
                    className={`${inputCls} w-16`}
                    aria-label="Aralık"
                  />
                  <select value={everyUnit} onChange={(e) => setRecurrence(`every:${everyN}${e.target.value}`)} className={`${inputCls} w-auto`} aria-label="Birim">
                    <option value="d">günde bir</option>
                    <option value="w">haftada bir</option>
                  </select>
                </div>
              )}
            </div>
            {detail.recurrence && <p className="text-[11px] text-text-muted mt-1">{U.recurrenceLabel(detail.recurrence)} · tamamlandığında sıradaki tarih otomatik oluşur.</p>}
          </div>
          <div className="col-span-2">
            <span className={labelCls}>Etiketler</span>
            <div className="flex flex-wrap gap-1.5 items-center">
              {(detail.labels || []).map(l => (
                <span key={l.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border text-[11px] font-medium bg-info/10 text-info border-info/30">
                  <TI.Tag className="w-3 h-3" />{l.name}
                  <button type="button" onClick={() => toggleLabel(l.id)} aria-label={`${l.name} etiketini kaldır`} className="rounded p-0.5 hover:bg-black/10"><TI.X className="w-3 h-3" /></button>
                </span>
              ))}
              <button type="button" onClick={() => setLabelMenu(v => !v)} aria-expanded={labelMenu} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-border text-[11px] text-text-tertiary hover:text-accent hover:border-accent/50">
                <TI.Plus className="w-3 h-3" />Etiket
              </button>
            </div>
            {labelMenu && (
              <div className="mt-2 bg-bg-input border border-border rounded-lg p-2">
                <div className="flex flex-wrap gap-1.5">
                  {(labels || []).map(l => {
                    const on = selectedLabelIds.some(x => U.sameId(x, l.id));
                    return (
                      <button key={l.id} type="button" aria-pressed={on} onClick={() => toggleLabel(l.id)} className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${on ? 'bg-info/15 text-info border-info/40' : 'border-border text-text-secondary hover:text-text-primary bg-bg-surface'}`}>
                        {on && <TI.Check className="w-3 h-3 inline mr-0.5" />}{l.name}
                      </button>
                    );
                  })}
                  {(labels || []).length === 0 && <span className="text-[11px] text-text-muted">Henüz etiket yok.</span>}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addNewLabel(); }
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLabelMenu(false); }
                    }}
                    placeholder="Yeni etiket adı"
                    maxLength={40}
                    className={inputCls}
                  />
                  <button type="button" onClick={addNewLabel} disabled={!newLabel.trim()} className="px-3 rounded-lg text-xs bg-accent text-accent-text disabled:opacity-40">Oluştur</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <Section
          title="Notlar"
          icon={TI.Note}
          right={(
            <div className="flex rounded-lg border border-border overflow-hidden text-[11px]">
              {[['edit', 'Düzenle'], ['preview', 'Önizle']].map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { if (m === 'preview') flushDrafts(); setNotesMode(m); }}
                  aria-pressed={notesMode === m}
                  className={`px-2.5 py-1 ${notesMode === m ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:text-text-primary'}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}
        >
          {notesMode === 'edit' ? (
            <>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={flushDrafts}
                rows={5}
                placeholder="Notlar… (**kalın**, - liste, - [ ] yapılacak)"
                className={`${inputCls} resize-y min-h-[110px] font-mono text-[13px] leading-relaxed`}
              />
              <p className="text-[10px] text-text-muted mt-1">Alandan çıkınca otomatik kaydedilir.</p>
            </>
          ) : (
            <div className="bg-bg-input/50 border border-border rounded-lg px-3 py-2.5 min-h-[60px] cursor-text" onDoubleClick={() => setNotesMode('edit')} title="Düzenlemek için çift tıkla">
              <MarkdownPreview
                text={notesDraft}
                onToggleCheckbox={(idx) => {
                  const next = MarkdownPreview.toggleCheckboxLine(notesDraft, idx);
                  setNotesDraft(next);
                  save({ notes: next });
                }}
              />
            </div>
          )}
        </Section>

        {/* Subtasks */}
        <Section
          title="Alt görevler"
          icon={TI.Subtask}
          right={subtasks.length > 0 ? <span className="text-[11px] text-text-muted tabular-nums">{subtasks.filter(s => s.status === 'done').length}/{subtasks.length}</span> : null}
        >
          {subtasks.length > 0 && (
            <div className="mb-2"><Bar value={(subtasks.filter(s => s.status === 'done').length / subtasks.length) * 100} height={4} color="rgb(var(--positive))" /></div>
          )}
          <ul className="space-y-0.5">
            {subtasks.map(s => {
              const sDone = s.status === 'done';
              const temp = String(s.id).startsWith('tmp-');
              return (
                <li key={s.id} className={`group flex items-center gap-2.5 px-1.5 py-1 rounded-md hover:bg-bg-input/60 ${temp ? 'opacity-60' : ''}`}>
                  <AnimatedCheck checked={sDone} onChange={() => { if (!temp) toggleSubtask(s); }} size={16} aria-label="Alt görevi tamamla" />
                  <button type="button" disabled={temp} onClick={() => openOther(s.id)} className={`flex-1 min-w-0 text-left text-sm truncate ${sDone ? 'line-through text-text-tertiary' : 'text-text-primary hover:text-accent'}`}>
                    {s.title}
                  </button>
                  {s.dueDate && <span className={`text-[10px] px-1.5 rounded border ${U.DUE_TONE_CLASS[(U.dueInfo(s) || {}).tone || 'future']}`}>{U.relativeDayLabel(s.dueDate)}</span>}
                  {!temp && (
                    <button type="button" onClick={() => removeSubtask(s)} aria-label="Alt görevi sil" className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-negative">
                      <TI.X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2 mt-1.5 px-1.5">
            <TI.Plus className="w-3.5 h-3.5 text-text-muted" />
            <input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
                if (e.key === 'Escape' && newSub) { e.preventDefault(); e.stopPropagation(); setNewSub(''); }
              }}
              placeholder="Alt görev ekle ve Enter'a bas"
              maxLength={300}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none py-1"
            />
          </div>
        </Section>

        {/* Time tracking */}
        <Section title="Zaman takibi" icon={TI.Clock}>
          <div className="flex items-center gap-3">
            {!done && (
              <button
                type="button"
                onClick={() => toggleTimer(detail)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isRunning ? 'bg-accent text-accent-text hover:bg-accent/90' : 'bg-bg-input border border-border text-text-secondary hover:text-text-primary'}`}
              >
                {isRunning ? <><TI.Stop className="w-3 h-3" />Durdur</> : <><TI.Play className="w-3 h-3" />Başlat</>}
              </button>
            )}
            <div className="flex-1">
              <div className="flex items-baseline justify-between text-xs mb-1">
                <span className={`font-mono tabular-nums ${isRunning ? 'text-accent font-semibold' : 'text-text-primary'}`}>
                  {isRunning ? U.formatClock(spent) : U.formatDuration(spent)}
                </span>
                <span className="text-text-muted">{est ? `Tahmin: ${est} dk` : 'Tahmin yok'}</span>
              </div>
              {est > 0 && <Bar value={pct} height={6} color={pct > 100 ? 'rgb(var(--negative))' : 'rgb(var(--accent))'} />}
              {est > 0 && pct > 100 && <p className="text-[11px] text-negative mt-1">Tahmini %{Math.round(pct - 100)} aştın.</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <label htmlFor="td-est" className="text-xs text-text-tertiary">Tahmini süre</label>
            <input
              id="td-est"
              type="number"
              min={0}
              max={10000}
              step={5}
              value={estDraft}
              onChange={(e) => setEstDraft(e.target.value)}
              onBlur={flushDrafts}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              placeholder="0"
              className={`${inputCls} w-24`}
            />
            <span className="text-xs text-text-muted">dk</span>
          </div>
        </Section>

        {/* Cross-links */}
        <Section title="Bağlantılar" icon={TI.Link} right={links.length ? <span className="text-[11px] text-text-muted">{links.length}</span> : null}>
          {links.length === 0 && !loading && (
            <p className="text-xs text-text-muted mb-2">Bu görevi bir işlem, haber, başka bir görev ya da web adresiyle ilişkilendirebilirsin.</p>
          )}
          <ul className="space-y-1 mb-3">
            {links.map(l => {
              const meta = LINK_META[l.type] || LINK_META.url;
              const Icon = meta.icon;
              return (
                <li key={l.linkId} className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border ${l.missing ? 'opacity-50' : 'hover:border-accent/40'}`}>
                  <Icon className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                  <button
                    type="button"
                    onClick={() => openLink(l)}
                    disabled={l.missing}
                    title={l.missing ? 'Bağlı öğe artık yok' : `${meta.label} aç`}
                    className="flex-1 min-w-0 text-left text-sm text-text-primary truncate hover:text-accent disabled:hover:text-text-primary disabled:cursor-not-allowed"
                  >
                    {l.label || `${meta.label} #${l.id}`}
                  </button>
                  <span className="text-[10px] text-text-muted flex-shrink-0">
                    {meta.label}{l.direction === 'in' ? ' · gelen' : ''}{l.missing ? ' · silinmiş' : ''}
                  </span>
                  {l.type === 'url' && !l.missing && <TI.External className="w-3 h-3 text-text-muted" />}
                  <button type="button" onClick={() => removeLink(l)} aria-label="Bağlantıyı kaldır" className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-negative">
                    <TI.X className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="relative">
            <div className="flex items-center gap-2 bg-bg-input border border-border rounded-lg px-2.5 focus-within:border-accent">
              <TI.Search className="w-3.5 h-3.5 text-text-muted" />
              <input
                value={q}
                onChange={(e) => { searchRequestRef.current += 1; setResults(null); setSearchError(''); setSearching(false); setQ(e.target.value); setLinkMsg(''); }}
                onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ(''); } }}
                placeholder="İlişkilendir: işlem, haber, görev ara…"
                aria-label="İlişkilendirilecek öğeyi ara"
                className="flex-1 bg-transparent py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              {searching && <TI.Refresh className="w-3.5 h-3.5 text-text-muted animate-spin" />}
            </div>
            {q.trim().length >= 2 && !searching && (results || searchError) && (
              <div className="mt-1.5 bg-bg-surface border border-border rounded-lg shadow-xl max-h-72 overflow-y-auto">
                {searchError && <p className="px-3 py-2 text-xs text-negative">{searchError}</p>}
                {!searchError && resultGroups.length === 0 && <p className="px-3 py-2 text-xs text-text-muted">Sonuç bulunamadı.</p>}
                {resultGroups.map(g => (
                  <div key={g.key} className="py-1">
                    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{g.title}</p>
                    {g.items.map(it => {
                      const Icon = it.type === 'project' ? TI.Hash : (LINK_META[it.type] || LINK_META.url).icon;
                      return (
                        <button
                          key={`${it.type}-${it.id}`}
                          type="button"
                          onClick={() => {
                            if (it.type === 'project') { save({ projectId: it.id }); setQ(''); setResults(null); }
                            else addLink(it.type, it.id, it.label);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg-input"
                        >
                          <Icon className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                          <span className={`flex-1 min-w-0 truncate ${it.done ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{it.title}</span>
                          {it.sub && <span className="text-[10px] text-text-muted truncate max-w-[110px]">{it.sub}</span>}
                          {it.pl && <span className={`text-[11px] font-mono ${it.pl.cls}`}>{it.pl.text}</span>}
                          <span className="text-[10px] text-accent flex-shrink-0">{it.type === 'project' ? 'Taşı' : 'Bağla'}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-1.5 mt-2">
            <input
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setLinkMsg(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }}
              placeholder="https://…"
              aria-label="Web adresi"
              className={inputCls}
            />
            <button type="button" onClick={addUrl} disabled={!urlInput.trim()} className="flex items-center gap-1 px-3 rounded-lg text-xs bg-bg-input border border-border text-text-secondary hover:text-text-primary disabled:opacity-40 whitespace-nowrap">
              <TI.Globe className="w-3.5 h-3.5" />URL ekle
            </button>
          </div>
          {linkMsg && <p className="text-[11px] text-warning mt-1.5">{linkMsg}</p>}
        </Section>

        <p className="text-[10px] text-text-muted mt-6">
          {detail.createdAt ? `Oluşturuldu: ${new Date(detail.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          {detail.completedAt && done ? ` · Tamamlandı: ${new Date(detail.completedAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
        </p>
      </div>
    </DrawerShell>
  );
};

const DrawerShell = ({ animate, onBackdrop, asideRef, children }) => (
  <div className="fixed inset-0 z-[150] flex justify-end" role="presentation">
    <motion.div
      className="absolute inset-0 bg-black/40"
      initial={animate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: animate ? 0.2 : 0 }}
      onClick={onBackdrop}
    />
    <motion.aside
      ref={asideRef}
      role="dialog"
      aria-modal="true"
      aria-label="Görev ayrıntısı"
      className="relative w-full max-w-[520px] h-full bg-bg-surface border-l border-border shadow-2xl overflow-y-auto"
      initial={animate ? { x: '100%' } : false}
      animate={{ x: 0 }}
      exit={animate ? { x: '100%' } : { opacity: 0 }}
      transition={animate ? { type: 'spring', stiffness: 380, damping: 38 } : { duration: 0 }}
    >
      {children}
    </motion.aside>
  </div>
);

module.exports = TaskDrawer;
