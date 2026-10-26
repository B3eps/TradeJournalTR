// Create / edit modal for a single card (markdown + cloze with live preview).
const React = require('react');
const { useState, useRef, useCallback } = React;
const Modal = require('./Modal');
const CardMarkdown = require('./CardMarkdown');
const U = require('./cardUtils');
const api = require('./api');

const inputCls = 'mt-1 w-full px-3 py-2 text-sm rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-accent';

const CardEditor = ({ card, decks, defaultDeckId, onSaved, onDeleted, onClose }) => {
  const editing = !!(card && card.id);
  const [deckId, setDeckId] = useState((card && card.deckId) || defaultDeckId || ((decks[0] && decks[0].id) || ''));
  const [front, setFront] = useState(card ? card.front : '');
  const [back, setBack] = useState(card ? card.back : '');
  const [tags, setTags] = useState(card && Array.isArray(card.tags) ? card.tags.join(', ') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const frontRef = useRef(null);

  const cloze = U.hasCloze(front);

  const addCloze = useCallback(() => {
    const el = frontRef.current;
    if (!el) return;
    const s = el.selectionStart || 0;
    const e = el.selectionEnd || 0;
    const n = (front.match(/\{\{c(\d+)::/g) || []).length + 1;
    const sel = front.slice(s, e) || 'cevap';
    const next = `${front.slice(0, s)}{{c${n}::${sel}}}${front.slice(e)}`;
    setFront(next);
    setTimeout(() => { try { el.focus(); } catch (err) { /* ignore */ } }, 0);
  }, [front]);

  const save = async () => {
    if (!front.trim()) { setError('Ön yüz boş olamaz.'); return; }
    // Cloze cards carry their answer in the front text; the back is optional extra info.
    const backText = back.trim() || (cloze ? '—' : '');
    if (!backText) { setError('Arka yüz boş olamaz.'); return; }
    setBusy(true);
    setError('');
    try {
      const body = { front, back: backText, deckId, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) };
      const saved = editing ? await api.updateCard(card.id, body) : await api.createCard(body);
      onSaved(saved, !editing);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteCard(card.id);
      onDeleted(card);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  };

  return (
    <Modal
      wide
      title={editing ? 'Kartı düzenle' : 'Yeni kart'}
      onClose={onClose}
      footer={(
        <>
          {editing && (
            confirmDelete ? (
              <button type="button" onClick={remove} disabled={busy} className="mr-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-negative text-white disabled:opacity-50">Evet, sil</button>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto px-3 py-1.5 text-xs font-medium rounded-lg text-negative hover:bg-negative/10">Kartı sil</button>
            )
          )}
          <span className="hidden sm:block text-[11px] text-text-muted mr-2">Ctrl+Enter ile kaydet</span>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-bg-input">Vazgeç</button>
          <button type="button" onClick={save} disabled={busy} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90 disabled:opacity-40">
            {editing ? 'Kaydet' : 'Kart ekle'}
          </button>
        </>
      )}
    >
      <div className="space-y-4" onKeyDown={onKeyDown}>
        {error && <p className="text-xs text-negative" role="alert">{error}</p>}
        <label className="block">
          <span className="text-xs text-text-tertiary">Deste</span>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)} className={inputCls}>
            {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="card-front" className="text-xs text-text-tertiary">Ön yüz</label>
            <button type="button" onClick={addCloze} className="text-[11px] text-accent hover:underline" title="Seçili metni {{c1::...}} boşluğuna çevirir">
              Boşluk ekle {'{{c1::…}}'}
            </button>
          </div>
          <textarea
            id="card-front"
            ref={frontRef}
            autoFocus
            rows={3}
            value={front}
            maxLength={5000}
            onChange={(e) => setFront(e.target.value)}
            className={`${inputCls} resize-y`}
            placeholder="Soru ya da {{c1::boşluklu}} metin"
          />
        </div>
        <label className="block">
          <span className="text-xs text-text-tertiary">Arka yüz{cloze ? ' (isteğe bağlı ek bilgi)' : ''}</span>
          <textarea
            rows={4}
            value={back}
            maxLength={5000}
            onChange={(e) => setBack(e.target.value)}
            className={`${inputCls} resize-y`}
            placeholder="Cevap. **kalın**, `kod`, - madde işareti kullanabilirsin."
          />
        </label>
        <label className="block">
          <span className="text-xs text-text-tertiary">Etiketler (virgülle ayır)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="ör. forex, risk" />
        </label>
        {(front.trim() || back.trim()) && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-bg-page/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Ön önizleme</div>
              <CardMarkdown text={front} mode="front" className="text-sm text-text-secondary" />
            </div>
            <div className="rounded-lg border border-border bg-bg-page/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Arka önizleme</div>
              {cloze && <CardMarkdown text={front} mode="back" className="text-sm text-text-secondary mb-1" />}
              <CardMarkdown text={back} className="text-sm text-text-secondary" />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

module.exports = CardEditor;
