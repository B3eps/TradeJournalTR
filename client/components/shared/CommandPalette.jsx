/*
 * Command palette (Ctrl+K / Cmd+K, opened by trades.jsx).
 *   <CommandPalette open={open} onClose={() => setOpen(false)} />
 *
 * Sections: Hızlı İşlemler, Sayfalar (local, fuzzy filtered) and, when the
 * query has 2+ characters, Görevler / İşlemler / Haberler / Projeler from
 * GET /api/search?q=... (debounced 150 ms; a missing endpoint is tolerated).
 * Selecting a result dispatches window 'app:navigate' with {page, itemId, itemType}.
 */
const React = require('react');
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const L = require('lucide-react');
const { motion, AnimatePresence } = require('framer-motion');
const { authFetch } = require('../../helper.js');
const { cn } = require('../../lib/utils');
const sound = require('../../utils/sound');
const { navigate, requestQuickAddTask } = require('../../utils/navigation');
const { useAnimationsEnabled, useAnimationPreference } = require('../ui/motion');
const Sidebar = require('../Sidebar');

const EMPTY_REMOTE = { tasks: [], trades: [], news: [], projects: [] };

/* ── Matching ────────────────────────────────────────────────── */

const TR_MAP = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' };
const normalize = (s) => String(s || '')
  .replace(/[ıİşŞğĞüÜöÖçÇ]/g, (ch) => TR_MAP[ch])
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

// Higher is better, -1 = no match. Substring beats word-prefix beats subsequence.
const score = (query, text) => {
  const q = normalize(query).trim();
  if (!q) return 0;
  const t = normalize(text);
  const idx = t.indexOf(q);
  if (idx === 0) return 100;
  if (idx > 0) return (/\s/.test(t[idx - 1]) ? 80 : 60) - Math.min(idx, 20) * 0.5;
  let ti = 0;
  let gaps = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return Math.max(1, 40 - gaps);
};

/* ── Formatting ──────────────────────────────────────────────── */

const fmtDate = (d) => {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
};
const fmtDateTime = (d) => {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const fmtPl = (pl) => {
  const n = Number(pl);
  if (!Number.isFinite(n)) return '';
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const STATUS_LABEL = { todo: 'Yapılacak', doing: 'Devam ediyor', in_progress: 'Devam ediyor', done: 'Tamamlandı', blocked: 'Engelli', backlog: 'Beklemede' };

/* ── Component ───────────────────────────────────────────────── */

const CommandPalette = ({ open, onClose }) => {
  const animate = useAnimationsEnabled();
  const [animPref, setAnimPref] = useAnimationPreference();
  const { enabled: soundOn } = sound.useSound();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState(EMPTY_REMOTE);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset on open.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActive(0);
    setRemote(EMPTY_REMOTE);
    sound.play('pop');
    const t = setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 10);
    return () => clearTimeout(t);
  }, [open]);

  // Remote search (debounced, abortable, tolerant of a missing endpoint).
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (q.length < 2) { setRemote(EMPTY_REMOTE); setLoading(false); return undefined; }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/search?q=${encodeURIComponent(q)}`, ctrl ? { signal: ctrl.signal } : {});
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const arr = (v) => (Array.isArray(v) ? v.slice(0, 6) : []);
        setRemote({ tasks: arr(data && data.tasks), trades: arr(data && data.trades), news: arr(data && data.news), projects: arr(data && data.projects) });
      } catch (err) {
        if (!err || err.name !== 'AbortError') setRemote(EMPTY_REMOTE);
      } finally {
        if (!ctrl || !ctrl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => { clearTimeout(t); if (ctrl) ctrl.abort(); };
  }, [query, open]);

  const close = useCallback(() => { if (onClose) onClose(); }, [onClose]);

  // Build grouped, flattened items.
  const groups = useMemo(() => {
    const q = query.trim();
    const actions = [
      { key: 'act:new-task', icon: L.Plus, title: 'Yeni görev', subtitle: 'Görevler sayfasında hızlı ekle', keywords: 'yeni gorev ekle task add', run: () => requestQuickAddTask() },
      { key: 'act:timetrack', icon: L.Timer, title: 'Zaman takibi', subtitle: 'Zamanlayıcıyı aç', keywords: 'zaman takibi timer sayac', run: () => navigate('timetrack') },
      {
        key: 'act:sound', icon: soundOn ? L.VolumeX : L.Volume2, title: soundOn ? 'Sesleri kapat' : 'Sesleri aç', subtitle: 'Arayüz ses efektleri', keywords: 'ses sound mute sessiz',
        run: () => {
          if (soundOn) { sound.play('toggle-off'); setTimeout(() => sound.setEnabled(false), 120); } else { sound.setEnabled(true); sound.play('toggle-on'); }
        },
      },
      {
        key: 'act:anim', icon: L.Sparkles, title: animPref ? 'Animasyonları kapat' : 'Animasyonları aç', subtitle: 'Arayüz hareketleri', keywords: 'animasyon hareket motion',
        run: () => setAnimPref(!animPref),
      },
    ];
    const pages = Sidebar.ALL_PAGES.map((p) => ({
      key: `page:${p.id}`, icon: p.icon, title: p.label, subtitle: p.sectionLabel, keywords: p.keywords || '',
      run: () => navigate(p.id),
    }));

    const filterLocal = (items) => {
      if (!q) return items;
      return items
        .map((it) => ({ it, s: Math.max(score(q, it.title), score(q, `${it.title} ${it.subtitle || ''} ${it.keywords || ''}`) - 10) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.it);
    };

    const out = [];
    const fa = filterLocal(actions);
    const fp = filterLocal(pages);
    if (fa.length) out.push({ id: 'actions', label: 'Hızlı İşlemler', items: fa });
    if (fp.length) out.push({ id: 'pages', label: 'Sayfalar', items: fp });

    if (q.length >= 2) {
      const tasks = remote.tasks.map((t) => ({
        key: `task:${t.id}`, icon: t.status === 'done' ? L.CheckSquare || L.SquareCheckBig : L.Square || L.ListChecks, title: t.title || 'Adsız görev',
        subtitle: [t.projectName, STATUS_LABEL[t.status] || t.status, t.dueDate ? `Son: ${fmtDate(t.dueDate)}` : null].filter(Boolean).join(' · '),
        run: () => navigate('tasks', t.id, { itemType: 'task' }),
      }));
      const trades = remote.trades.map((t) => {
        const pl = Number(t.pl);
        return {
          key: `trade:${t.id}`, icon: pl < 0 ? L.TrendingDown : L.TrendingUp, title: t.ticker || 'İşlem', subtitle: fmtDate(t.date),
          right: fmtPl(t.pl), rightClass: pl < 0 ? 'text-negative' : 'text-positive',
          run: () => navigate('trades', t.id, { itemType: 'trade' }),
        };
      });
      const news = remote.news.map((n) => ({
        key: `news:${n.id}`, icon: L.Newspaper, title: n.title || 'Haber', subtitle: [n.source, fmtDateTime(n.publishedAt)].filter(Boolean).join(' · '),
        run: () => navigate('newsfeed', n.id, { itemType: 'news' }),
      }));
      const projects = remote.projects.map((p) => ({
        key: `project:${p.id}`, icon: L.FolderKanban, title: p.name || 'Proje', subtitle: 'Proje',
        run: () => navigate('tasks', p.id, { itemType: 'project' }),
      }));
      if (tasks.length) out.push({ id: 'tasks', label: 'Görevler', items: tasks });
      if (trades.length) out.push({ id: 'trades', label: 'İşlemler', items: trades });
      if (news.length) out.push({ id: 'news', label: 'Haberler', items: news });
      if (projects.length) out.push({ id: 'projects', label: 'Projeler', items: projects });
    }
    return out;
  }, [query, remote, soundOn, animPref, setAnimPref]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep the highlighted index in range.
  useEffect(() => { setActive((a) => (a >= flat.length ? Math.max(0, flat.length - 1) : a)); }, [flat.length]);
  useEffect(() => { setActive(0); }, [query]);

  // Scroll the highlighted row into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-cp-index="${active}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runItem = (item) => {
    if (!item) return;
    sound.play('click');
    close();
    // Run after the modal is closed so focus/state changes land on the page.
    setTimeout(() => { try { item.run(); } catch (e) { console.error(e); } }, 0);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length) setActive((a) => (a + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === 'Home') {
      e.preventDefault(); setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault(); setActive(Math.max(0, flat.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(flat[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  let index = -1;
  const body = (
    <motion.div
      key="cp"
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
        onClick={close}
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        exit={animate ? { opacity: 0 } : { opacity: 0, transition: { duration: 0 } }}
        transition={{ duration: 0.15 }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Komut paleti"
        className="relative flex max-h-[70vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-[0_24px_80px_-12px_rgb(0_0_0/0.65)]"
        initial={animate ? { opacity: 0, y: -10, scale: 0.98 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={animate ? { opacity: 0, y: -6, scale: 0.98 } : { opacity: 0, transition: { duration: 0 } }}
        transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-border px-4">
          <L.Search className="h-[18px] w-[18px] flex-shrink-0 text-text-tertiary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sayfa, görev, işlem veya haber ara..."
            aria-label="Ara"
            aria-controls="cp-list"
            aria-activedescendant={flat[active] ? `cp-item-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
            autoComplete="off"
            spellCheck={false}
            className="h-14 flex-1 bg-transparent text-[15px] text-text-primary placeholder:text-text-tertiary outline-none"
          />
          {loading && <L.LoaderCircle className="h-4 w-4 flex-shrink-0 animate-spin text-text-tertiary" />}
          <span className="ui-kbd">Esc</span>
        </div>

        {/* Results */}
        <div ref={listRef} id="cp-list" role="listbox" className="flex-1 overflow-y-auto p-2">
          {flat.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-input text-text-tertiary">
                <L.SearchX className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-text-secondary">Sonuç bulunamadı</p>
              <p className="text-xs text-text-tertiary">{loading ? 'Aranıyor...' : 'Farklı bir anahtar kelime deneyin.'}</p>
            </div>
          ) : groups.map((g) => (
            <div key={g.id} className="mb-1 last:mb-0">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{g.label}</p>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const Icon = item.icon || L.ArrowRight;
                const isActive = i === active;
                return (
                  <div
                    key={item.key}
                    id={`cp-item-${i}`}
                    data-cp-index={i}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => { if (active !== i) setActive(i); }}
                    onClick={() => runItem(item)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-100',
                      isActive ? 'bg-accent/10' : 'hover:bg-bg-input/60'
                    )}
                  >
                    <div className={cn(
                      'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors',
                      isActive ? 'border-accent/30 bg-accent/15 text-accent' : 'border-border bg-bg-input text-text-secondary'
                    )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm', isActive ? 'text-text-primary font-medium' : 'text-text-primary')}>{item.title}</p>
                      {item.subtitle && <p className="truncate text-xs text-text-tertiary">{item.subtitle}</p>}
                    </div>
                    {item.right && <span className={cn('font-data text-xs tabular-nums', item.rightClass)}>{item.right}</span>}
                    {isActive && <L.CornerDownLeft className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-border bg-bg-page/40 px-4 py-2 text-[11px] text-text-tertiary">
          <span className="flex items-center gap-1.5"><span className="ui-kbd">↑</span><span className="ui-kbd">↓</span> gezin</span>
          <span className="flex items-center gap-1.5"><span className="ui-kbd">↵</span> aç</span>
          <span className="flex items-center gap-1.5"><span className="ui-kbd">Alt</span><span className="ui-kbd">1-5</span> bölümler</span>
          <span className="ml-auto hidden sm:inline">Trade Günlüğü</span>
        </div>
      </motion.div>
    </motion.div>
  );

  return <AnimatePresence>{open ? body : null}</AnimatePresence>;
};

module.exports = CommandPalette;
