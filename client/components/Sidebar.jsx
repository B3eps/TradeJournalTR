/*
 * App navigation: "double navbar".
 *  - Left rail (68px): logo, search, section icons with tooltips, and at the
 *    bottom the panel toggle, sound/animation settings and Ayarlar.
 *  - Second panel (232px): title of the active section and its sub-pages.
 *    Collapsible (state in localStorage 'nav-panel-collapsed'); below 900px it
 *    becomes an overlay.
 * Keyboard: Alt+1..5 jump to sections (Ctrl+K is handled by trades.jsx).
 *
 * Props contract (unchanged): currentPage, onNavigate, onCollapsedChange,
 * onWidthChange, trades, selectedAccounts, setSelectedAccounts, accountBrokers.
 * onCollapsedChange(true) means content gets the extra width (panel hidden).
 */
const React = require('react');
const { useState, useEffect, useCallback, useMemo } = React;
const L = require('lucide-react');
const { motion } = require('framer-motion');
const AccountSwitcher = require('./shared/AccountSwitcher');
const SoundSettings = require('./shared/SoundSettings');
const { cn } = require('../lib/utils');
const sound = require('../utils/sound');
const { openCommandPalette } = require('../utils/navigation');
const { useAnimationsEnabled } = require('./ui/motion');

const RAIL_WIDTH = 68;
const PANEL_WIDTH = 232;
const NARROW_BREAKPOINT = 900;
const PANEL_KEY = 'nav-panel-collapsed';
const SECTION_LAST_KEY = 'nav-section-last';

const NAV_SECTIONS = [
  {
    id: 'home', label: 'Panel', subtitle: 'Bugünün özeti ve takvim', icon: L.Home,
    pages: [
      { id: 'home', label: 'Bugün', icon: L.Sun || L.LayoutDashboard, keywords: 'ana sayfa bugun ozet home' },
      { id: 'dashboard', label: 'Trade Paneli', icon: L.LayoutDashboard, keywords: 'dashboard ozet takvim' },
    ],
  },
  {
    id: 'tasks', label: 'Görevler', subtitle: 'Projeler ve yapılacaklar', icon: L.CheckSquare || L.SquareCheckBig,
    pages: [
      { id: 'tasks', label: 'Görevler', icon: L.ListChecks, keywords: 'todo yapilacak proje task' },
      { id: 'habits', label: 'Alışkanlıklar', icon: L.Repeat || L.RefreshCw, keywords: 'habit aliskanlik seri' },
    ],
  },
  {
    id: 'time', label: 'Zaman', subtitle: 'Odak ve zaman kayıtları', icon: L.Clock,
    pages: [
      { id: 'timetrack', label: 'Zaman Takibi', icon: L.Timer, keywords: 'timer sayac kronometre time' },
      { id: 'focus', label: 'Odak', icon: L.Hourglass || L.Timer, keywords: 'pomodoro odak focus plan' },
    ],
  },
  {
    id: 'market', label: 'Piyasa', subtitle: 'Haber, takvim ve grafik', icon: L.Activity,
    pages: [
      { id: 'newsfeed', label: 'Canlı Haberler', icon: L.Zap, keywords: 'news feed akis' },
      { id: 'news', label: 'Haber Takvimi', icon: L.CalendarDays, keywords: 'ekonomik takvim calendar' },
      { id: 'charts', label: 'Fiyat Grafiği', icon: L.CandlestickChart || L.LineChart || L.BarChart3, keywords: 'chart grafik mum fiyat' },
    ],
  },
  {
    id: 'mind', label: 'Zihin', subtitle: 'Notlar, kartlar ve bağlantılar', icon: L.Brain || L.BookMarked || L.BookOpen,
    pages: [
      { id: 'notes', label: 'Notlar', icon: L.NotebookPen || L.FileText, keywords: 'not defter obsidian backlink' },
      { id: 'cards', label: 'Kartlar', icon: L.Layers || L.Copy, keywords: 'kart flashcard anki tekrar fsrs' },
      { id: 'linkmap', label: 'Bağlantı Haritası', icon: L.Network || L.Share2 || L.GitBranch, keywords: 'harita graf bag baglanti' },
    ],
  },
  {
    id: 'money', label: 'Finans', subtitle: 'Bütçe ve hesaplar', icon: L.Wallet || L.CircleDollarSign || L.Banknote,
    pages: [{ id: 'finance', label: 'Finans', icon: L.Wallet || L.Banknote, keywords: 'butce gelir gider para finance' }],
  },
  {
    id: 'journal', label: 'Günlük', subtitle: 'İşlem günlüğü ve analiz', icon: L.BookOpen,
    pages: [
      { id: 'trades', label: 'İşlemler', icon: L.List, keywords: 'trades islem liste' },
      { id: 'analytics', label: 'Analiz', icon: L.BarChart3 || L.ChartBar, keywords: 'analytics istatistik' },
      { id: 'strategy', label: 'Strateji', icon: L.Target, keywords: 'strategy kural' },
      { id: 'premarket', label: 'Seans Öncesi', icon: L.Sunrise, keywords: 'premarket plan' },
      { id: 'backtesting', label: 'Test Günlüğü', icon: L.FlaskConical, keywords: 'backtest geriye dönük test' },
      { id: 'syncer', label: 'İşlem Eşitleyici', icon: L.RefreshCw, keywords: 'sync esitle broker' },
    ],
  },
];

const SETTINGS_SECTION = {
  id: 'settings', label: 'Ayarlar', subtitle: 'Hesap, tema ve bağlantılar', icon: L.Settings,
  pages: [
    { id: 'settings', label: 'Ayarlar', icon: L.Settings, keywords: 'settings tema hesap' },
    { id: 'integrations', label: 'Bağlantılar', icon: L.Plug || L.Link, keywords: 'google ntfy telefon bildirim yedek ai ollama baglanti' },
  ],
};

const ALL_SECTIONS = [...NAV_SECTIONS, SETTINGS_SECTION];
const ALL_PAGES = ALL_SECTIONS.flatMap((s) => s.pages.map((p) => ({ ...p, sectionId: s.id, sectionLabel: s.label })));

const findSection = (pageId) => ALL_SECTIONS.find((s) => s.pages.some((p) => p.id === pageId)) || NAV_SECTIONS[0];

const readJSON = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; }
};

const getIsNarrow = () => typeof window !== 'undefined' && window.innerWidth < NARROW_BREAKPOINT;
const getStoredPanelCollapsed = () => {
  try { return localStorage.getItem(PANEL_KEY) === 'true'; } catch { return false; }
};

// Width the main content should leave for the navigation on first render.
const getInitialNavWidth = () => (getIsNarrow() || getStoredPanelCollapsed() ? RAIL_WIDTH : RAIL_WIDTH + PANEL_WIDTH);

/* ── Rail button ─────────────────────────────────────────────── */

const RailButton = ({ icon: Icon, label, shortcut, active, onClick, animate, layoutId = 'nav-rail-active' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    aria-current={active ? 'page' : undefined}
    className={cn(
      'group relative flex h-10 w-10 items-center justify-center rounded-xl outline-none transition-colors duration-150',
      'focus-visible:ring-2 focus-visible:ring-accent/50',
      active ? 'text-accent' : 'text-text-tertiary hover:bg-bg-surface hover:text-text-primary'
    )}
  >
    {active && (animate ? (
      <motion.span
        layoutId={layoutId}
        className="absolute inset-0 rounded-xl bg-accent/10 ring-1 ring-inset ring-accent/20"
        transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.8 }}
      />
    ) : (
      <span className="absolute inset-0 rounded-xl bg-accent/10 ring-1 ring-inset ring-accent/20" />
    ))}
    {active && <span className="absolute -left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />}
    <Icon className="relative h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.9} />
    <span className="ui-tooltip pointer-events-none absolute left-full top-1/2 z-[70] ml-3 flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-bg-surface px-2 py-1 text-xs font-medium text-text-primary shadow-lg">
      {label}
      {shortcut && <span className="ui-kbd">{shortcut}</span>}
    </span>
  </button>
);

/* ── Sidebar ─────────────────────────────────────────────────── */

const Sidebar = ({ currentPage, onNavigate, onCollapsedChange, onWidthChange, trades, selectedAccounts, setSelectedAccounts, accountBrokers }) => {
  const animate = useAnimationsEnabled();
  const [panelCollapsed, setPanelCollapsed] = useState(getStoredPanelCollapsed);
  const [isNarrow, setIsNarrow] = useState(getIsNarrow);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [sectionLast, setSectionLast] = useState(() => readJSON(SECTION_LAST_KEY, {}));

  const activeSection = useMemo(() => findSection(currentPage), [currentPage]);
  const panelVisible = isNarrow ? overlayOpen : !panelCollapsed;
  const contentCollapsed = isNarrow || panelCollapsed;
  const navWidth = contentCollapsed ? RAIL_WIDTH : RAIL_WIDTH + PANEL_WIDTH;

  // Report layout to parent.
  useEffect(() => {
    if (onCollapsedChange) onCollapsedChange(contentCollapsed);
    if (onWidthChange) onWidthChange(navWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentCollapsed, navWidth]);

  // Track the narrow breakpoint.
  useEffect(() => {
    const onResize = () => {
      const narrow = getIsNarrow();
      setIsNarrow(narrow);
      if (!narrow) setOverlayOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Remember the last visited page of each section.
  useEffect(() => {
    if (!activeSection || activeSection.pages.length < 2) return;
    setSectionLast((prev) => {
      if (prev[activeSection.id] === currentPage) return prev;
      const next = { ...prev, [activeSection.id]: currentPage };
      try { localStorage.setItem(SECTION_LAST_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [currentPage, activeSection]);

  const setCollapsed = useCallback((v) => {
    setPanelCollapsed(v);
    try { localStorage.setItem(PANEL_KEY, String(v)); } catch { /* ignore */ }
  }, []);

  const togglePanel = useCallback(() => {
    sound.play('click');
    if (isNarrow) setOverlayOpen((o) => !o);
    else setCollapsed(!panelCollapsed);
  }, [isNarrow, panelCollapsed, setCollapsed]);

  const goPage = useCallback((pageId) => {
    sound.play('click');
    onNavigate(pageId);
    if (isNarrow) setOverlayOpen(false);
  }, [onNavigate, isNarrow]);

  const goSection = useCallback((section) => {
    if (!section) return;
    const remembered = sectionLast[section.id];
    const target = section.pages.some((p) => p.id === remembered) ? remembered : section.pages[0].id;
    // On narrow screens, tapping the active multi-page section opens its list.
    if (isNarrow && section.id === activeSection.id && section.pages.length > 1) {
      sound.play('click');
      setOverlayOpen((o) => !o);
      return;
    }
    goPage(target);
  }, [sectionLast, isNarrow, activeSection, goPage]);

  // Alt+1..5 -> sections, Esc closes the overlay.
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const m = /^Digit([1-9])$/.exec(e.code || '');
        const idx = m ? Number(m[1]) - 1 : -1;
        if (idx >= 0 && idx < NAV_SECTIONS.length) {
          e.preventDefault();
          goSection(NAV_SECTIONS[idx]);
        }
      } else if (e.key === 'Escape' && overlayOpen) {
        setOverlayOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goSection, overlayOpen]);

  const showAccounts = activeSection.id === 'home' || activeSection.id === 'journal';
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <>
      {/* Overlay backdrop (narrow screens) */}
      {isNarrow && overlayOpen && (
        <div
          className="ui-fade-in fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
          style={{ left: RAIL_WIDTH }}
          onClick={() => setOverlayOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Rail ── */}
      <nav
        aria-label="Ana gezinme"
        className="fixed left-0 top-0 z-[55] flex h-full flex-col items-center border-r border-border bg-bg-page py-3"
        style={{ width: RAIL_WIDTH }}
      >
        <button
          type="button"
          onClick={() => goPage('dashboard')}
          aria-label="Trade Günlüğü - Panel"
          className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <div
            className="h-8 w-8 flex-shrink-0 rounded-md bg-accent"
            style={{ WebkitMaskImage: 'url(/assets/img/logo.svg)', WebkitMaskSize: 'contain', maskImage: 'url(/assets/img/logo.svg)', maskSize: 'contain' }}
            role="img"
            aria-label="Trade Günlüğü"
          />
        </button>

        <RailButton
          icon={L.Search}
          label="Ara"
          shortcut={`${modKey} K`}
          active={false}
          animate={animate}
          onClick={() => openCommandPalette()}
        />

        <div className="my-2 h-px w-8 bg-border" />

        <div className="flex flex-col items-center gap-1.5">
          {NAV_SECTIONS.map((section, i) => (
            <RailButton
              key={section.id}
              icon={section.icon}
              label={section.label}
              shortcut={`Alt ${i + 1}`}
              active={activeSection.id === section.id}
              animate={animate}
              onClick={() => goSection(section)}
            />
          ))}
        </div>

        {contentCollapsed && showAccounts && (
          <div className="mt-3 w-11">
            <AccountSwitcher
              trades={trades}
              selectedAccounts={selectedAccounts}
              setSelectedAccounts={setSelectedAccounts}
              collapsed
              accountBrokers={accountBrokers}
            />
          </div>
        )}

        <div className="mt-auto flex flex-col items-center gap-1.5">
          {!panelVisible && (
            <RailButton
              icon={L.PanelLeftOpen}
              label="Menüyü aç"
              active={false}
              animate={animate}
              onClick={togglePanel}
            />
          )}
          <SoundSettings side="right" align="end" />
          <RailButton
            icon={SETTINGS_SECTION.icon}
            label={SETTINGS_SECTION.label}
            active={activeSection.id === 'settings'}
            animate={animate}
            onClick={() => goPage('settings')}
          />
        </div>
      </nav>

      {/* ── Second panel ── */}
      <aside
        aria-label={`${activeSection.label} sayfaları`}
        aria-hidden={!panelVisible}
        inert={!panelVisible}
        className={cn(
          'ui-anim fixed top-0 z-50 flex h-full flex-col border-r border-border bg-bg-page',
          'transition-[transform,opacity] duration-200 ease-out',
          isNarrow && 'shadow-2xl',
          panelVisible ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-full opacity-0'
        )}
        style={{ left: RAIL_WIDTH, width: PANEL_WIDTH }}
      >
        {/* Header */}
        <div className="flex items-start gap-2 px-4 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Trade Günlüğü</p>
            <h2 key={activeSection.id} className="ui-fade-in mt-1 truncate text-[17px] font-semibold leading-tight text-text-primary">
              {activeSection.label}
            </h2>
            <p className="mt-0.5 truncate text-xs text-text-tertiary">{activeSection.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={togglePanel}
            aria-label="Menüyü daralt"
            title="Menüyü daralt"
            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-surface hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <L.ChevronsLeft className="h-4 w-4" />
          </button>
        </div>

        {showAccounts && (
          <div className="px-3 pb-3">
            <AccountSwitcher
              trades={trades}
              selectedAccounts={selectedAccounts}
              setSelectedAccounts={setSelectedAccounts}
              collapsed={false}
              accountBrokers={accountBrokers}
            />
          </div>
        )}

        <div className="mx-4 h-px bg-border" />

        {/* Sub-pages */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Sayfalar</p>
          <ul key={activeSection.id} className="ui-pop-in m-0 list-none space-y-0.5 p-0">
            {activeSection.pages.map((page) => {
              const Icon = page.icon;
              const active = currentPage === page.id;
              return (
                <li key={page.id}>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); goPage(page.id); }}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm no-underline outline-none transition-colors duration-150',
                      'focus-visible:ring-2 focus-visible:ring-accent/50',
                      active ? 'font-medium text-accent' : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary'
                    )}
                  >
                    {active && (animate ? (
                      <motion.span
                        layoutId="nav-panel-active"
                        className="absolute inset-0 rounded-lg bg-accent/10"
                        transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.8 }}
                      />
                    ) : (
                      <span className="absolute inset-0 rounded-lg bg-accent/10" />
                    ))}
                    <Icon className="relative h-4 w-4 flex-shrink-0" strokeWidth={active ? 2.2 : 1.9} />
                    <span className="relative truncate">{page.label}</span>
                    {active && <span className="relative ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer: search hint */}
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => openCommandPalette()}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-bg-surface/60 px-2.5 py-2 text-left text-xs text-text-tertiary transition-colors hover:border-accent/30 hover:text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <L.Search className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">Ara veya komut çalıştır</span>
            <span className="ui-kbd">{modKey}</span>
            <span className="ui-kbd">K</span>
          </button>
        </div>
      </aside>
    </>
  );
};

Sidebar.NAV_SECTIONS = NAV_SECTIONS;
Sidebar.SETTINGS_SECTION = SETTINGS_SECTION;
Sidebar.ALL_PAGES = ALL_PAGES;
Sidebar.RAIL_WIDTH = RAIL_WIDTH;
Sidebar.PANEL_WIDTH = PANEL_WIDTH;
Sidebar.getInitialNavWidth = getInitialNavWidth;
Sidebar.getInitialCollapsed = () => getIsNarrow() || getStoredPanelCollapsed();

module.exports = Sidebar;
