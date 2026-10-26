const React = require('react');
const { useState, useEffect, useCallback, useRef } = React;
const { FadeIn } = require('../ui/motion');
const nav = require('../../utils/navigation');
const api = require('../cards/api');
const U = require('../cards/cardUtils');
const CI = require('../cards/CardIcons');
const { StatsHeader, Heatmap } = require('../cards/StatsHeader');
const { DeckList, DeckDialog } = require('../cards/DeckList');
const CardBrowser = require('../cards/CardBrowser');
const CardEditor = require('../cards/CardEditor');
const { ImportExportDialog, SettingsDialog } = require('../cards/CardDialogs');
const ReviewScreen = require('../cards/ReviewScreen');

// =====================================================
// KARTLAR (spaced-repetition flashcards, FSRS scheduling on the server)
// Tabs: Desteler (decks + heatmap) · Kart tarayıcı. Keyboard (outside inputs): n new card.
// Opens a card in the browser on 'app:navigate' with page 'cards' and itemId = card id.
// =====================================================

const REFRESH_MS = 60 * 1000;

const CardsPage = () => {
  const [decks, setDecks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('decks'); // 'decks' | 'browser'
  const [browserDeck, setBrowserDeck] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [studying, setStudying] = useState(null); // { deckId, deckName }
  const [editor, setEditor] = useState(null); // { card | null }
  const [deckDialog, setDeckDialog] = useState(null); // { deck | null }
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const alive = useRef(true);

  const reportError = useCallback((msg) => setError(msg || 'Bir hata oluştu.'), []);

  const refresh = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api.listDecks(), api.getStats()]);
      if (!alive.current) return;
      setDecks(d);
      setStats(s);
      setError('');
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [refresh]);

  const changed = useCallback(() => {
    setReloadKey((k) => k + 1);
    refresh();
  }, [refresh]);

  // Open a card coming from another page (note / task / trade / news "make a card" flows).
  const openCardById = useCallback(async (id) => {
    if (id == null) return;
    setStudying(null);
    setTab('browser');
    setBrowserDeck(null);
    setHighlightId(String(id));
    try {
      const card = await api.getCard(String(id));
      if (alive.current && card) setEditor({ card });
    } catch (err) {
      reportError(err.status === 404 ? 'Kart bulunamadı.' : err.message);
    }
  }, [reportError]);

  useEffect(() => {
    const p = nav.consumePendingItem('cards');
    if (p) openCardById(p.itemId);
    const onNav = (e) => {
      const d = e && e.detail;
      if (d && d.page === 'cards' && d.itemId != null) {
        nav.consumePendingItem('cards');
        openCardById(d.itemId);
      }
    };
    window.addEventListener(nav.NAV_EVENT, onNav);
    return () => window.removeEventListener(nav.NAV_EVENT, onNav);
  }, [openCardById]);

  useEffect(() => {
    if (studying) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || U.isTyping(e)) return;
      if (editor || deckDialog || showImport || showSettings) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setEditor({ card: null }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [studying, editor, deckDialog, showImport, showSettings]);

  const startStudy = (deckId) => {
    const d = decks.find((x) => x.id === deckId);
    setStudying({ deckId, deckName: d ? d.name : '' });
  };

  const exitStudy = useCallback(() => {
    setStudying(null);
    changed();
  }, [changed]);

  const saveDeck = async (data) => {
    if (deckDialog && deckDialog.deck) await api.updateDeck(deckDialog.deck.id, data);
    else await api.createDeck(data);
    setDeckDialog(null);
    changed();
  };

  const removeDeck = async () => {
    const id = deckDialog.deck.id;
    await api.deleteDeck(id);
    setDeckDialog(null);
    if (browserDeck === id) setBrowserDeck(null);
    changed();
  };

  if (studying) {
    return (
      <div className="max-w-6xl mx-auto p-4 sm:p-8">
        <ReviewScreen deckId={studying.deckId} deckName={studying.deckName} onExit={exitStudy} onChanged={refresh} />
      </div>
    );
  }

  const totalCards = stats ? stats.totalCards : decks.reduce((s, d) => s + d.total, 0);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Kartlar</h1>
          <p className="text-sm text-text-tertiary">Aralıklı tekrar (FSRS) ile kalıcı öğren.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowSettings(true)} aria-label="Ayarlar" title="Ayarlar" className="p-2 rounded-lg border border-border text-text-secondary hover:bg-bg-input">
            <CI.Settings className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setShowImport(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-input">
            <CI.Upload className="w-3.5 h-3.5" /> İçe / dışa aktar
          </button>
          <button type="button" onClick={() => setEditor({ card: null })} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90" title="Yeni kart (N)">
            <CI.Plus className="w-3.5 h-3.5" /> Yeni kart
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-negative/40 bg-negative/10 text-sm text-negative" role="alert">
          <CI.Alert className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => { setError(''); changed(); }} className="text-xs font-semibold underline">Yeniden dene</button>
          <button type="button" onClick={() => setError('')} aria-label="Kapat"><CI.X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <StatsHeader stats={stats} />

      <div className="flex gap-1 p-1 rounded-lg bg-bg-input w-fit" role="tablist">
        {[['decks', 'Desteler'], ['browser', `Kart tarayıcı${totalCards ? ` (${totalCards})` : ''}`]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === id ? 'bg-bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-48 rounded-xl bg-bg-surface border border-border animate-pulse" />
          <div className="h-32 rounded-xl bg-bg-surface border border-border animate-pulse" />
        </div>
      ) : tab === 'decks' ? (
        <FadeIn className="space-y-5">
          {totalCards === 0 && decks.length > 0 && (
            <div className="bg-bg-surface border border-dashed border-border rounded-xl px-6 py-8 text-center">
              <CI.Sparkle className="w-8 h-8 mx-auto text-accent" />
              <p className="mt-2 text-sm font-semibold text-text-primary">İlk kartını ekle</p>
              <p className="text-xs text-text-muted">Elle kart yazabilir ya da sekmeyle ayrılmış bir listeyi içe aktarabilirsin.</p>
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" onClick={() => setEditor({ card: null })} className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90">Yeni kart</button>
                <button type="button" onClick={() => setShowImport(true)} className="px-3.5 py-2 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-input">İçe aktar</button>
              </div>
            </div>
          )}
          <DeckList
            decks={decks}
            onStudy={startStudy}
            onEdit={(d) => setDeckDialog({ deck: d })}
            onAdd={() => setDeckDialog({ deck: null })}
            onBrowse={(id) => { setBrowserDeck(id); setTab('browser'); }}
          />
          <Heatmap byDay={stats && stats.byDay} />
        </FadeIn>
      ) : (
        <CardBrowser
          decks={decks}
          deckId={browserDeck}
          onDeckChange={setBrowserDeck}
          reloadKey={reloadKey}
          highlightId={highlightId}
          onEdit={(c) => setEditor({ card: c })}
          onChanged={refresh}
          onError={reportError}
        />
      )}

      {editor && (
        <CardEditor
          card={editor.card}
          decks={decks}
          defaultDeckId={browserDeck || undefined}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); changed(); }}
          onDeleted={() => { setEditor(null); changed(); }}
        />
      )}
      {deckDialog && (
        <DeckDialog
          deck={deckDialog.deck}
          onSave={saveDeck}
          onDelete={removeDeck}
          onClose={() => setDeckDialog(null)}
        />
      )}
      {showImport && (
        <ImportExportDialog
          decks={decks}
          defaultDeckId={browserDeck || undefined}
          onImported={changed}
          onClose={() => setShowImport(false)}
        />
      )}
      {showSettings && (
        <SettingsDialog onSaved={() => { setShowSettings(false); changed(); }} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
};

module.exports = CardsPage;
