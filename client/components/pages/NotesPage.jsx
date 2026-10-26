const React = require('react');
const { useState, useEffect, useRef, useCallback } = React;
const { AnimatePresence } = require('framer-motion');
const L = require('lucide-react');
const { FadeIn } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const nav = require('../../utils/navigation');
const api = require('../notes/api');
const events = require('../notes/events');
const W = require('../notes/wikilinks');
const U = require('../notes/noteUtils');
const NOTES_CSS = require('../notes/styles');
const NoteList = require('../notes/NoteList');
const NoteEditor = require('../notes/NoteEditor');
const LinksPanel = require('../notes/LinksPanel');
const CardModal = require('../notes/CardModal');
const ToastStack = require('../tasks/ToastStack');

// =====================================================
// NOTLAR (notes) PAGE
// Obsidian-like Markdown notes: [[wikilinks]], backlinks, #tags, daily note.
// Events: listens to 'app:navigate' {page:'notes', itemId, itemType:'note'} and
// 'app:new-note' (see client/components/notes/events.js). Ctrl+S saves now;
// Ctrl+K is left to the global command palette.
// =====================================================

const SAVE_DELAY_MS = 800;
const LIST_LIMIT = 300;
const PANEL_KEY = 'notes-panel-open';
const LAST_KEY = 'notes-last-id';

const readLS = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
const writeLS = (k, v) => { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

const TITLE_BAD = /[[\]|#^]/;
const cleanTitle = (s) => String(s || '').replace(/[[\]|#^\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

const EditorSkeleton = () => (
  <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-4" aria-hidden="true">
    <div className="h-7 w-1/2 rounded bg-bg-input animate-pulse" />
    <div className="h-3 w-40 rounded bg-bg-input/70 animate-pulse" />
    <div className="h-8 w-full rounded bg-bg-input/60 animate-pulse" />
    {[92, 84, 88, 60, 75].map((w, i) => <div key={i} className="h-3.5 rounded bg-bg-input/70 animate-pulse" style={{ width: `${w}%` }} />)}
  </div>
);

const NotesPage = () => {
  const sound = useSound();
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const play = useCallback((name) => { try { soundRef.current.play(name); } catch (e) { /* ignore */ } }, []);

  // ---- list ----
  const [notes, setNotes] = useState([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState([]);

  // ---- active note ----
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [titleError, setTitleError] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');

  const [panelOpen, setPanelOpen] = useState(() => readLS(PANEL_KEY) !== 'false');
  const [card, setCard] = useState(null);
  const [creating, setCreating] = useState(false);
  const [toasts, setToasts] = useState([]);

  const mountedRef = useRef(true);
  const notesRef = useRef(notes); notesRef.current = notes;
  const activeIdRef = useRef(activeId); activeIdRef.current = activeId;
  const detailRef = useRef(detail); detailRef.current = detail;
  const listSeq = useRef(0);
  const detailSeq = useRef(0);
  const pending = useRef({ id: null });
  const saveTimer = useRef(null);
  const inflight = useRef(null);
  const tagsTimer = useRef(null);
  const listTimer = useRef(null);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Map());
  const toastHandlers = useRef(new Map());
  const initDone = useRef(false);

  // ---------------- toasts ----------------
  const dismissToast = useCallback((id) => {
    const tm = toastTimers.current.get(id);
    if (tm) clearTimeout(tm);
    toastTimers.current.delete(id);
    toastHandlers.current.delete(id);
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);
  const pushToast = useCallback(({ message, tone = 'info', actionLabel, onAction, duration = 4000 }) => {
    const id = ++toastSeq.current;
    setToasts((ts) => [...ts.slice(-3), { id, message, tone, actionLabel, duration }]);
    if (onAction) toastHandlers.current.set(id, onAction);
    toastTimers.current.set(id, setTimeout(() => dismissToast(id), duration));
    if (tone === 'error') play('error');
  }, [dismissToast, play]);
  const actionToast = useCallback((id) => {
    const h = toastHandlers.current.get(id);
    dismissToast(id);
    if (h) { try { h(); } catch (e) { /* ignore */ } }
  }, [dismissToast]);

  // ---------------- loading ----------------
  const loadList = useCallback(async () => {
    const seq = ++listSeq.current;
    setListLoading(true);
    try {
      const params = { q: debouncedQuery.trim(), tag, limit: LIST_LIMIT, sort: 'updated' };
      if (filter === 'pinned') params.pinned = 'true';
      const res = await api.listNotes(params);
      if (seq !== listSeq.current || !mountedRef.current) return;
      setNotes(res.notes);
      setTotal(res.total);
      setListError('');
    } catch (e) {
      if (seq !== listSeq.current || !mountedRef.current) return;
      setListError(e.message);
    } finally {
      if (seq === listSeq.current && mountedRef.current) setListLoading(false);
    }
  }, [debouncedQuery, tag, filter]);
  const loadListRef = useRef(loadList); loadListRef.current = loadList;

  const loadTags = useCallback(async () => {
    try {
      const t = await api.listTags();
      if (mountedRef.current) setTags(t);
    } catch (e) { /* tag list is optional */ }
  }, []);

  // Coalesced background refreshes after saves.
  const refreshListSoon = useCallback((ms = 600) => {
    clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => { if (mountedRef.current) loadListRef.current(); }, ms);
  }, []);
  const refreshTagsSoon = useCallback((ms = 1500) => {
    clearTimeout(tagsTimer.current);
    tagsTimer.current = setTimeout(() => { if (mountedRef.current) loadTags(); }, ms);
  }, [loadTags]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadTags(); }, [loadTags]);

  const patchListItem = useCallback((id, patch) => {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  // ---------------- saving ----------------
  const hasPending = () => {
    const p = pending.current;
    return !!p.id && (p.title !== undefined || p.body !== undefined);
  };

  const flush = useCallback(async (opts = {}) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (inflight.current) { try { await inflight.current; } catch (e) { /* handled below */ } }
    if (!hasPending()) return true;
    const p = pending.current;
    const patch = {};
    if (p.title !== undefined) patch.title = p.title;
    if (p.body !== undefined) patch.body = p.body;
    pending.current = { id: p.id };
    const isActive = () => p.id === activeIdRef.current;
    if (isActive() && mountedRef.current) setSaveState('saving');

    const run = api.updateNote(p.id, patch, { keepalive: !!opts.keepalive }).then((res) => {
      if (!mountedRef.current) return true;
      if (isActive()) {
        setDetail((d) => (d && d.note && d.note.id === p.id ? res : d));
        if (patch.title !== undefined) setTitleError('');
        setSaveError('');
        setSaveState(hasPending() ? 'dirty' : 'saved');
      }
      const item = { title: res.note.title, tags: res.note.tags, updatedAt: res.note.updatedAt, pinned: res.note.pinned };
      if (patch.body !== undefined) item.excerpt = U.quickExcerpt(patch.body);
      patchListItem(p.id, item);
      if (patch.title !== undefined) refreshListSoon(300);
      if (patch.body !== undefined) refreshTagsSoon();
      return true;
    }).catch((err) => {
      const titleProblem = patch.title !== undefined && (err.status === 409 || (err.status === 400 && /başlık/i.test(err.message)));
      // Put unsent fields back unless newer edits replaced them.
      const cur = pending.current;
      const restore = { id: p.id };
      if (cur.id === p.id) Object.assign(restore, cur);
      if (restore.body === undefined && patch.body !== undefined) restore.body = patch.body;
      if (!titleProblem && restore.title === undefined && patch.title !== undefined) restore.title = patch.title;
      if (cur.id === p.id || !cur.id) pending.current = restore;
      if (!mountedRef.current) return false;
      if (titleProblem) {
        if (isActive()) setTitleError(err.message);
        if (restore.body !== undefined && !saveTimer.current) {
          saveTimer.current = setTimeout(() => { flushRef.current(); }, SAVE_DELAY_MS);
          if (isActive()) setSaveState('dirty');
        } else if (isActive()) setSaveState('idle');
        return false;
      }
      if (isActive()) { setSaveState('error'); setSaveError(err.message); }
      return false;
    });
    inflight.current = run;
    const ok = await run;
    if (inflight.current === run) inflight.current = null;
    return ok;
  }, [patchListItem, refreshListSoon, refreshTagsSoon]);
  const flushRef = useRef(flush); flushRef.current = flush;

  const scheduleSave = useCallback(() => {
    setSaveState('dirty');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; flushRef.current(); }, SAVE_DELAY_MS);
  }, []);

  const onTitleChange = useCallback((value) => {
    setDraftTitle(value);
    const id = activeIdRef.current;
    if (!id) return;
    const t = value.replace(/\s+/g, ' ').trim();
    if (!t) { setTitleError('Başlık boş olamaz.'); pending.current.title = undefined; return; }
    if (TITLE_BAD.test(t)) { setTitleError('Başlık şu karakterleri içeremez: [ ] | # ^'); pending.current.title = undefined; return; }
    setTitleError('');
    if (pending.current.id !== id) pending.current = { id };
    const d = detailRef.current;
    if (d && d.note && d.note.title === t) { pending.current.title = undefined; if (!hasPending()) { clearTimeout(saveTimer.current); setSaveState('saved'); } return; }
    pending.current.title = t;
    patchListItem(id, { title: t });
    scheduleSave();
  }, [patchListItem, scheduleSave]);

  const onBodyChange = useCallback((md) => {
    const id = activeIdRef.current;
    if (!id) return;
    if (pending.current.id !== id) pending.current = { id };
    pending.current.body = md;
    scheduleSave();
  }, [scheduleSave]);

  const latestBody = () => {
    const d = detailRef.current;
    const p = pending.current;
    if (d && p.id === d.note.id && p.body !== undefined) return p.body;
    return d ? d.note.body : '';
  };

  // ---------------- opening notes ----------------
  const openNote = useCallback(async (id, opts = {}) => {
    if (!id) return false;
    if (id === activeIdRef.current && detailRef.current && detailRef.current.note.id === id && !opts.force) return true;
    // Never drop unsaved edits of the current note: retry once (a rejected title is dropped
    // on the first try, so the second sends the body alone), then stay put.
    let saved = await flushRef.current();
    if (!saved && hasPending()) saved = await flushRef.current();
    if (!saved && hasPending()) {
      pushToast({ message: 'Açık notun değişiklikleri kaydedilemedi; önce tekrar dene.', tone: 'error', actionLabel: 'Tekrar dene', onAction: () => flushRef.current() });
      return false;
    }
    const seq = ++detailSeq.current;
    setActiveId(id);
    activeIdRef.current = id;
    setDetailError('');
    setTitleError('');
    setSaveError('');
    setSaveState('idle');
    setDetailLoading(true);
    pending.current = { id };
    try {
      const d = opts.preloaded || await api.getNote(id);
      if (seq !== detailSeq.current || !mountedRef.current) return false;
      setDetail(d);
      setDraftTitle(d.note.title);
      writeLS(LAST_KEY, id);
      return true;
    } catch (e) {
      if (seq !== detailSeq.current || !mountedRef.current) return false;
      if (e.status === 404) {
        setActiveId(null);
        setDetail(null);
        if (readLS(LAST_KEY) === id) writeLS(LAST_KEY, null);
        if (!opts.silent) setDetailError('Not bulunamadı; silinmiş olabilir.');
      } else {
        setDetailError(e.message);
      }
      return false;
    } finally {
      if (seq === detailSeq.current && mountedRef.current) setDetailLoading(false);
    }
  }, [pushToast]);
  const openNoteRef = useRef(openNote); openNoteRef.current = openNote;

  const refreshDetail = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    try {
      const d = await api.getNote(id);
      if (mountedRef.current && activeIdRef.current === id) setDetail(d);
    } catch (e) { /* keep what we have */ }
  }, []);

  const insertIntoList = (note) => {
    const summary = {
      id: note.id, title: note.title, excerpt: U.quickExcerpt(note.body), tags: note.tags || [], pinned: !!note.pinned,
      updatedAt: note.updatedAt, createdAt: note.createdAt, backlinkCount: 0,
    };
    setNotes((ns) => [summary, ...ns.filter((n) => n.id !== note.id)]);
    setTotal((t) => t + (notesRef.current.some((n) => n.id === note.id) ? 0 : 1));
  };

  const createNew = useCallback(async (data) => {
    if (creating) return;
    setCreating(true);
    try {
      await flushRef.current();
      const body = {};
      if (data && typeof data.title === 'string' && cleanTitle(data.title)) body.title = cleanTitle(data.title);
      if (data && typeof data.body === 'string') body.body = data.body;
      const note = await api.createNote(body);
      if (!mountedRef.current) return;
      play('pop');
      insertIntoList(note);
      await openNoteRef.current(note.id, { preloaded: { note, backlinks: [], outgoing: [] } });
      refreshTagsSoon(300);
    } catch (e) {
      pushToast({ message: `Not oluşturulamadı: ${e.message}`, tone: 'error' });
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  }, [creating, play, pushToast, refreshTagsSoon]);
  const createNewRef = useRef(createNew); createNewRef.current = createNew;

  const openDaily = useCallback(async (date) => {
    setCreating(true);
    try {
      await flushRef.current();
      const note = await api.daily(date || api.localToday());
      if (!mountedRef.current) return;
      const existed = notesRef.current.some((n) => n.id === note.id);
      if (!existed) { play('pop'); insertIntoList(note); refreshTagsSoon(300); }
      await openNoteRef.current(note.id, { force: true });
    } catch (e) {
      pushToast({ message: `Günlük açılamadı: ${e.message}`, tone: 'error' });
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  }, [play, pushToast, refreshTagsSoon]);
  const openDailyRef = useRef(openDaily); openDailyRef.current = openDaily;

  // Navigation from elsewhere: note id, or a YYYY-MM-DD date for the daily note.
  const openFromNav = useCallback(async (itemId) => {
    const id = String(itemId);
    const ok = await openNoteRef.current(id, { silent: U.isDateId(id) });
    if (!ok && U.isDateId(id)) await openDailyRef.current(id);
  }, []);

  // Find a note by title (folded) in the list, then via the API.
  const findByTitle = async (title) => {
    const key = W.titleKey(title);
    const local = notesRef.current.find((n) => W.titleKey(n.title) === key);
    if (local) return local.id;
    try {
      const res = await api.listNotes({ q: title, limit: 50 });
      const hit = res.notes.find((n) => W.titleKey(n.title) === key);
      return hit ? hit.id : null;
    } catch (e) {
      return null;
    }
  };

  const createLinkedNote = useCallback(async (title, { open = false } = {}) => {
    const t = cleanTitle(title);
    if (!t) return;
    try {
      const note = await api.createNote({ title: t });
      if (!mountedRef.current) return;
      play('pop');
      insertIntoList(note);
      if (open) { await openNoteRef.current(note.id); return; }
      await flushRef.current();
      refreshDetail();
      pushToast({ message: `“${note.title}” notu oluşturuldu.`, actionLabel: 'Aç', onAction: () => openNoteRef.current(note.id) });
    } catch (e) {
      if (e.status === 409) { await flushRef.current(); refreshDetail(); return; }
      pushToast({ message: `Not oluşturulamadı: ${e.message}`, tone: 'error' });
    }
  }, [play, pushToast, refreshDetail]);

  const onOpenWikiLink = useCallback(async (attrs) => {
    if (!attrs) return;
    if (attrs.kind === 'note' && !attrs.typed) {
      const id = await findByTitle(attrs.target);
      if (id) openNoteRef.current(id);
      else createLinkedNote(attrs.target, { open: true });
      return;
    }
    if (attrs.kind === 'note') { openNoteRef.current(attrs.target); return; }
    await flushRef.current();
    U.openExternalTarget(attrs.kind, attrs.target);
  }, [createLinkedNote]);

  const onPanelOpen = useCallback(async (item) => {
    if (item.type === 'note') { openFromNav(item.id); return; }
    await flushRef.current();
    U.openExternalTarget(item.type, item.id);
  }, [openFromNav]);

  // Items for the [[ suggestion popup: notes (local + server), "create", tasks, trades, news.
  const searchItems = useCallback(async (query, signal) => {
    const q = String(query || '').trim();
    const activeNote = activeIdRef.current;
    const fq = W.foldText(q);
    const local = notesRef.current
      .filter((n) => n.id !== activeNote && (!q || W.foldText(n.title).includes(fq)))
      .slice(0, 8)
      .map((n) => ({ kind: 'note', id: n.id, title: n.title, sub: U.relDate(n.updatedAt) }));
    if (!q) return local;
    let remote = { tasks: [], trades: [], news: [], notes: [] };
    try { remote = await api.search(q, 6, { signal }); } catch (e) { if (e && e.name === 'AbortError') return []; }
    const seen = new Set(local.map((n) => n.id));
    const noteItems = [...local];
    remote.notes.forEach((n) => {
      if (n.id === activeNote || seen.has(n.id)) return;
      seen.add(n.id);
      noteItems.push({ kind: 'note', id: n.id, title: n.title, sub: U.relDate(n.updatedAt) });
    });
    const out = noteItems.slice(0, 6);
    const createTitle = cleanTitle(q);
    if (createTitle && !noteItems.some((n) => W.titleKey(n.title) === W.titleKey(createTitle))) out.push({ kind: 'create', title: createTitle });
    remote.tasks.slice(0, 4).forEach((t) => out.push({ kind: 'task', id: t.id, title: t.title, sub: [t.projectName, t.status === 'done' ? 'Tamamlandı' : null].filter(Boolean).join(' · ') || 'Görev' }));
    remote.trades.slice(0, 4).forEach((t) => out.push({ kind: 'trade', id: t.id, title: `${t.ticker} · ${t.date}`, sub: t.pl != null ? `K/Z ${Number(t.pl).toLocaleString('tr-TR')}` : 'İşlem' }));
    remote.news.slice(0, 4).forEach((n) => out.push({ kind: 'news', id: n.id, title: n.title, sub: n.source }));
    return out;
  }, []);

  // ---------------- actions ----------------
  const togglePin = useCallback(async () => {
    const d = detailRef.current;
    if (!d) return;
    const id = d.note.id;
    const next = !d.note.pinned;
    setDetail((x) => (x && x.note.id === id ? { ...x, note: { ...x.note, pinned: next } } : x));
    patchListItem(id, { pinned: next });
    play(next ? 'toggle-on' : 'toggle-off');
    try {
      await api.updateNote(id, { pinned: next });
      refreshListSoon(200);
    } catch (e) {
      setDetail((x) => (x && x.note.id === id ? { ...x, note: { ...x.note, pinned: !next } } : x));
      patchListItem(id, { pinned: !next });
      pushToast({ message: `Sabitleme değiştirilemedi: ${e.message}`, tone: 'error' });
    }
  }, [patchListItem, play, pushToast, refreshListSoon]);

  const deleteActive = useCallback(async () => {
    const d = detailRef.current;
    if (!d) return;
    const id = d.note.id;
    const title = d.note.title;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (pending.current.id === id) pending.current = { id: null };
    if (inflight.current) { try { await inflight.current; } catch (e) { /* ignore */ } }
    try {
      await api.deleteNote(id);
      if (!mountedRef.current) return;
      play('delete');
      const list = notesRef.current;
      const idx = list.findIndex((n) => n.id === id);
      const rest = list.filter((n) => n.id !== id);
      setNotes(rest);
      setTotal((t) => Math.max(0, t - 1));
      if (readLS(LAST_KEY) === id) writeLS(LAST_KEY, null);
      setActiveId(null);
      activeIdRef.current = null;
      setDetail(null);
      setSaveState('idle');
      const next = rest[Math.min(Math.max(idx, 0), rest.length - 1)];
      if (next && window.innerWidth >= 768) openNoteRef.current(next.id);
      pushToast({ message: `“${title}” silindi.` });
      refreshTagsSoon(200);
    } catch (e) {
      pushToast({ message: `Not silinemedi: ${e.message}`, tone: 'error' });
    }
  }, [play, pushToast, refreshTagsSoon]);

  const exportAll = useCallback(async () => {
    try {
      await flushRef.current();
      const files = await api.exportNotes();
      if (!files.length) { pushToast({ message: 'Dışa aktarılacak not yok.' }); return; }
      const bundle = files.map((f) => `<!-- dosya: ${f.name} -->\n${f.content.replace(/\s+$/, '')}\n`).join('\n\n');
      U.downloadText(`notlar-${api.localToday()}.md`, bundle);
      pushToast({ message: `${files.length} not tek dosyada dışa aktarıldı.` });
    } catch (e) {
      pushToast({ message: `Dışa aktarılamadı: ${e.message}`, tone: 'error' });
    }
  }, [pushToast]);

  const exportCurrent = useCallback(async () => {
    const d = detailRef.current;
    if (!d) return;
    await flushRef.current();
    const n = detailRef.current ? detailRef.current.note : d.note;
    const text = U.noteToMarkdownFile({ ...n, body: latestBody() });
    U.downloadText(`${U.safeFileName(n.title)}.md`, text);
  }, []);

  const importFiles = useCallback(async (fileList) => {
    const files = [];
    const tooBig = [];
    for (const f of fileList.slice(0, 1000)) {
      if (f.size > 1000000) { tooBig.push(f.name); continue; }
      try { files.push({ name: f.name, content: await f.text() }); } catch (e) { tooBig.push(f.name); }
    }
    if (!files.length) { pushToast({ message: 'İçe aktarılacak uygun dosya yok (en fazla 1 MB, .md).', tone: 'error' }); return; }
    try {
      const res = await api.importNotes(files);
      if (!mountedRef.current) return;
      const skipped = ((res && res.skipped) || []).length + tooBig.length;
      if (res && res.imported) play('pop');
      pushToast({
        message: `${(res && res.imported) || 0} not içe aktarıldı${skipped ? `, ${skipped} dosya atlandı` : ''}.`,
        tone: res && res.imported ? 'info' : 'error',
        duration: 5000,
        ...(res && res.notes && res.notes[0] ? { actionLabel: 'Aç', onAction: () => openNoteRef.current(res.notes[0].id) } : {}),
      });
      loadListRef.current();
      loadTags();
    } catch (e) {
      pushToast({ message: `İçe aktarılamadı: ${e.message}`, tone: 'error' });
    }
  }, [loadTags, play, pushToast]);

  const togglePanel = () => setPanelOpen((o) => { writeLS(PANEL_KEY, String(!o)); return !o; });

  const backToList = async () => {
    await flushRef.current();
    setActiveId(null);
    activeIdRef.current = null;
    setDetail(null);
  };

  // ---------------- lifecycle & events ----------------
  useEffect(() => {
    mountedRef.current = true;
    const timers = toastTimers.current;
    return () => {
      mountedRef.current = false;
      clearTimeout(listTimer.current);
      clearTimeout(tagsTimer.current);
      timers.forEach((t) => clearTimeout(t));
      // Leaving the page: send what is left (keepalive so it survives navigation).
      if (hasPending()) flushRef.current({ keepalive: true });
    };
  }, []);

  // Initial target: pending navigation > pending "new note" > last opened note.
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    const p = nav.consumePendingItem('notes');
    if (p && p.itemId != null) { openFromNav(p.itemId); return; }
    const nn = events.consumePendingNewNote();
    if (nn) { createNewRef.current(nn); return; }
    const last = readLS(LAST_KEY);
    if (last && window.innerWidth >= 768) openNoteRef.current(last, { silent: true });
  }, [openFromNav]);

  useEffect(() => {
    const onNav = (e) => {
      const d = e && e.detail;
      if (!d || d.page !== 'notes' || d.itemId == null) return;
      if (d.itemType && d.itemType !== 'note') return;
      // The shell also stores it as pending; clear it after it ran.
      setTimeout(() => nav.consumePendingItem('notes'), 0);
      openFromNav(d.itemId);
    };
    const onNew = (e) => {
      events.consumePendingNewNote();
      createNewRef.current((e && e.detail) || {});
    };
    window.addEventListener(nav.NAV_EVENT, onNav);
    window.addEventListener(events.NEW_NOTE_EVENT, onNew);
    return () => {
      window.removeEventListener(nav.NAV_EVENT, onNav);
      window.removeEventListener(events.NEW_NOTE_EVENT, onNew);
    };
  }, [openFromNav]);

  // Ctrl+S / Cmd+S saves immediately (Ctrl+K stays with the command palette).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (hasPending()) flushRef.current();
        else if (activeIdRef.current) setSaveState((s) => (s === 'idle' ? 'saved' : s));
      }
    };
    const onUnload = () => { if (hasPending()) flushRef.current({ keepalive: true }); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  // Desktop: with nothing open, open the first note once the list is there.
  useEffect(() => {
    if (activeId || detailLoading || listLoading || !notes.length || detailError) return;
    if (window.innerWidth < 768 || query || tag || filter !== 'all') return;
    if (!readLS(LAST_KEY)) openNoteRef.current(notes[0].id, { silent: true });
  }, [notes, activeId, detailLoading, listLoading, detailError, query, tag, filter]);

  // "Kaydedildi" fades back to idle after a moment.
  useEffect(() => {
    if (saveState !== 'saved') return undefined;
    const t = setTimeout(() => { if (mountedRef.current) setSaveState((s) => (s === 'saved' ? 'idle' : s)); }, 2500);
    return () => clearTimeout(t);
  }, [saveState]);

  const showEditor = detail && detail.note && detail.note.id === activeId;
  const editorNote = showEditor ? { ...detail.note } : null;

  const panel = (closable) => (
    <LinksPanel
      detail={showEditor ? detail : null}
      loading={detailLoading}
      onOpen={onPanelOpen}
      onCreate={(title) => createLinkedNote(title)}
      creating={creating}
      onClose={closable ? togglePanel : null}
    />
  );

  return (
    <div className="space-y-4">
      <style>{NOTES_CSS}</style>
      <div className="flex gap-5 items-start">
        {/* List column */}
        <aside className={`${activeId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 flex-shrink-0 md:sticky md:top-4`}>
          <NoteList
            notes={notes}
            total={total}
            loading={listLoading}
            error={listError}
            onRetry={() => { loadList(); loadTags(); }}
            activeId={activeId}
            onSelect={(id) => openNote(id)}
            query={query}
            onQuery={setQuery}
            filter={filter}
            onFilter={setFilter}
            tag={tag}
            onTag={setTag}
            tags={tags}
            onNew={() => createNew()}
            onDaily={() => openDaily()}
            creating={creating}
            onExportAll={exportAll}
            onExportCurrent={exportCurrent}
            canExportCurrent={!!showEditor}
            onImportFiles={importFiles}
          />
        </aside>

        {/* Editor column */}
        <section className={`${activeId || detailError ? 'block' : 'hidden md:block'} flex-1 min-w-0 space-y-4`}>
          {detailError && (
            <div role="alert" className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 text-warning text-sm">
              <L.TriangleAlert className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{detailError}</span>
              {activeId && <button type="button" onClick={() => openNote(activeId, { force: true })} className="text-xs font-semibold hover:underline">Tekrar dene</button>}
              <button type="button" onClick={() => setDetailError('')} aria-label="Kapat" className="text-warning/80 hover:text-warning"><L.X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {showEditor ? (
            <FadeIn key={editorNote.id} y={6}>
              <NoteEditor
                key={editorNote.id}
                note={editorNote}
                title={draftTitle}
                titleError={titleError}
                onTitleChange={onTitleChange}
                onBodyChange={onBodyChange}
                saveState={saveState}
                saveError={saveError}
                onRetrySave={() => flushRef.current()}
                outgoing={detail.outgoing}
                onOpenWikiLink={onOpenWikiLink}
                searchItems={searchItems}
                onCreateLinkedNote={(title) => createLinkedNote(title)}
                onTogglePin={togglePin}
                onDelete={deleteActive}
                onRequestCard={(text) => setCard({ front: text.slice(0, 5000), noteId: editorNote.id })}
                panelOpen={panelOpen}
                onTogglePanel={togglePanel}
                onBack={backToList}
              />
            </FadeIn>
          ) : detailLoading ? (
            <EditorSkeleton />
          ) : (
            <FadeIn className="bg-bg-surface border border-border rounded-xl p-10 text-center">
              <L.NotebookPen className="w-10 h-10 text-text-muted mx-auto mb-3" />
              <p className="text-text-primary font-semibold">Bir not seç ya da yeni bir not başlat</p>
              <p className="text-text-secondary text-sm mt-1">Notlar Markdown olarak saklanır; [[ ile bağlantı, #etiket ile etiket ekleyebilirsin.</p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button type="button" onClick={() => createNew()} disabled={creating} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:opacity-90 disabled:opacity-60">
                  <L.Plus className="w-3.5 h-3.5" />Yeni not
                </button>
                <button type="button" onClick={() => openDaily()} disabled={creating} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-60">
                  <L.CalendarDays className="w-3.5 h-3.5" />Bugünün günlüğü
                </button>
              </div>
            </FadeIn>
          )}
          {/* Narrow screens: links panel below the editor */}
          {panelOpen && showEditor && <div className="xl:hidden">{panel(false)}</div>}
        </section>

        {/* Links column */}
        {panelOpen && (activeId || detailLoading) && (
          <aside className="hidden xl:block w-72 flex-shrink-0 sticky top-4">
            {panel(true)}
          </aside>
        )}
      </div>

      <AnimatePresence>
        {card && (
          <CardModal
            key="note-card"
            initialFront={card.front}
            noteId={card.noteId}
            onClose={() => setCard(null)}
            onCreated={() => { setCard(null); play('pop'); pushToast({ message: 'Kart oluşturuldu.' }); }}
          />
        )}
      </AnimatePresence>

      <ToastStack toasts={toasts} onAction={actionToast} onDismiss={dismissToast} />
    </div>
  );
};

module.exports = NotesPage;
