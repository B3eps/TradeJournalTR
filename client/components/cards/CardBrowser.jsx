// Card browser: search, deck / state filters, edit, suspend and delete.
const React = require('react');
const { useState, useEffect, useRef, useCallback } = React;
const { FadeIn } = require('../ui/motion');
const CI = require('./CardIcons');
const U = require('./cardUtils');
const api = require('./api');

const PAGE = 50;
const STATE_OPTIONS = [
  ['', 'Tüm durumlar'], ['new', 'Yeni'], ['learning', 'Öğreniyor'], ['review', 'Tekrar'], ['relearning', 'Yeniden'], ['suspended', 'Askıda'],
];

const selectCls = 'px-2.5 py-2 text-sm rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-accent';

const CardBrowser = ({ decks, deckId, onDeckChange, reloadKey, highlightId, onEdit, onChanged, onError }) => {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [state, setState] = useState('');
  const [cards, setCards] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async (offset) => {
    const req = ++reqRef.current;
    if (offset === 0) setLoading(true); else setMore(true);
    try {
      const res = await api.listCards({ deckId, q: debounced, state, limit: PAGE, offset });
      if (req !== reqRef.current) return;
      setCards((prev) => (offset === 0 ? res.cards : prev.concat(res.cards)));
      setTotal(res.total);
    } catch (err) {
      if (req === reqRef.current) onError(err.message);
    } finally {
      if (req === reqRef.current) { setLoading(false); setMore(false); }
    }
  }, [deckId, debounced, state, onError]);

  useEffect(() => { load(0); }, [load, reloadKey]);

  const deckMap = {};
  decks.forEach((d) => { deckMap[d.id] = d; });

  const suspend = async (c) => {
    try {
      const updated = await api.toggleSuspend(c.id);
      setCards((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
      onChanged();
    } catch (err) { onError(err.message); }
  };

  const remove = async (c) => {
    try {
      await api.deleteCard(c.id);
      setCards((prev) => prev.filter((x) => x.id !== c.id));
      setTotal((n) => Math.max(0, n - 1));
      setConfirmId(null);
      onChanged();
    } catch (err) { onError(err.message); }
  };

  return (
    <div className="bg-bg-surface border border-border rounded-xl">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
        <div className="relative flex-1 min-w-[180px]">
          <CI.Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Kartlarda ara…"
            aria-label="Kartlarda ara"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-bg-input border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <select value={deckId || ''} onChange={(e) => onDeckChange(e.target.value || null)} aria-label="Deste filtresi" className={selectCls}>
          <option value="">Tüm desteler</option>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Durum filtresi" className={selectCls}>
          {STATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="text-xs text-text-muted ml-auto">{total} kart</span>
      </div>

      {loading ? (
        <div className="divide-y divide-border" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 animate-pulse">
              <div className="h-3.5 w-2/3 rounded bg-bg-input" />
              <div className="mt-2 h-3 w-1/2 rounded bg-bg-input" />
            </div>
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <CI.Search className="w-8 h-8 mx-auto text-text-muted" />
          <p className="mt-2 text-sm font-medium text-text-primary">{debounced || state || deckId ? 'Eşleşen kart yok' : 'Henüz kart yok'}</p>
          <p className="text-xs text-text-muted">{debounced || state || deckId ? 'Filtreleri değiştirmeyi dene.' : 'Yeni kart ekle ya da dışarıdan içe aktar.'}</p>
        </div>
      ) : (
        <FadeIn>
          <ul className="divide-y divide-border">
            {cards.map((c) => {
              const deck = deckMap[c.deckId];
              const hl = highlightId && String(highlightId) === String(c.id);
              return (
                <li key={c.id} className={`group flex items-start gap-3 px-4 py-3 ${hl ? 'bg-accent/10' : 'hover:bg-bg-input/40'} ${c.suspended ? 'opacity-60' : ''}`}>
                  <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: deck ? deck.color : '#64748b' }} title={deck ? deck.name : ''} />
                  <button type="button" onClick={() => onEdit(c)} className="flex-1 min-w-0 text-left">
                    <div className="text-sm text-text-primary truncate">{U.plainText(c.front, true)}</div>
                    <div className="text-xs text-text-tertiary truncate mt-0.5">{U.plainText(c.back, false)}</div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${U.STATE_TONES[c.state] || ''}`}>{U.STATE_LABELS[c.state]}</span>
                      {c.suspended && <span className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-border text-text-muted">Askıda</span>}
                      {deck && <span className="text-[10px] text-text-muted">{deck.name}</span>}
                      {c.state !== 0 && <span className="text-[10px] text-text-muted">· {U.formatDue(c.due)}</span>}
                      {(c.tags || []).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 text-[10px] rounded bg-bg-input text-text-secondary">#{t}</span>
                      ))}
                    </div>
                  </button>
                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-70 group-hover:opacity-100">
                    <button type="button" onClick={() => onEdit(c)} aria-label="Düzenle" title="Düzenle" className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-input"><CI.Edit className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => suspend(c)} aria-label={c.suspended ? 'Askıdan çıkar' : 'Askıya al'} title={c.suspended ? 'Askıdan çıkar' : 'Askıya al'} className="p-1.5 rounded-lg text-text-muted hover:text-warning hover:bg-bg-input"><CI.Pause className="w-3.5 h-3.5" /></button>
                    {confirmId === c.id ? (
                      <button type="button" onClick={() => remove(c)} onBlur={() => setConfirmId(null)} autoFocus className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-negative text-white">Sil?</button>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(c.id)} aria-label="Sil" title="Sil" className="p-1.5 rounded-lg text-text-muted hover:text-negative hover:bg-bg-input"><CI.Trash className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {cards.length < total && (
            <div className="p-3 text-center border-t border-border">
              <button type="button" onClick={() => load(cards.length)} disabled={more} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-input disabled:opacity-50">
                {more ? 'Yükleniyor…' : `Daha fazla göster (${total - cards.length})`}
              </button>
            </div>
          )}
        </FadeIn>
      )}
    </div>
  );
};

module.exports = CardBrowser;
