// Deck list with due counts, "Çalış" buttons and the deck create/edit dialog.
const React = require('react');
const { useState } = React;
const { Stagger, StaggerItem, HoverLift } = require('../ui/motion');
const CI = require('./CardIcons');
const Modal = require('./Modal');
const U = require('./cardUtils');

const Pill = ({ n, label, tone }) => (
  <span className={`inline-flex items-baseline gap-1 text-xs ${n > 0 ? tone : 'text-text-muted'}`}>
    <span className="font-mono font-semibold tabular-nums">{n}</span>
    <span className="text-[11px]">{label}</span>
  </span>
);

const DeckDialog = ({ deck, onSave, onDelete, onClose }) => {
  const [name, setName] = useState(deck ? deck.name : '');
  const [color, setColor] = useState(deck ? deck.color : U.DECK_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (!name.trim()) { setError('Deste adı boş olamaz.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSave({ name: name.trim(), color });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try { await onDelete(); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal
      title={deck ? 'Desteyi düzenle' : 'Yeni deste'}
      onClose={onClose}
      footer={(
        <>
          {deck && (
            confirmDelete ? (
              <button type="button" onClick={remove} disabled={busy} className="mr-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-negative text-white disabled:opacity-50">
                {deck.total > 0 ? `Evet, ${deck.total} kartla birlikte sil` : 'Evet, sil'}
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto px-3 py-1.5 text-xs font-medium rounded-lg text-negative hover:bg-negative/10">
                Desteyi sil
              </button>
            )
          )}
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-bg-input">Vazgeç</button>
          <button type="button" onClick={submit} disabled={busy} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90 disabled:opacity-40">
            Kaydet
          </button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-xs text-negative" role="alert">{error}</p>}
        <label className="block">
          <span className="text-xs text-text-tertiary">Ad</span>
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-accent"
          />
        </label>
        <div>
          <span className="text-xs text-text-tertiary">Renk</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {U.DECK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Renk ${c}`}
                aria-pressed={color === c}
                className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-text-primary' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
};

const DeckList = ({ decks, onStudy, onEdit, onAdd, onBrowse }) => {
  const list = Array.isArray(decks) ? decks : [];
  const totalDue = list.reduce((s, d) => s + d.new + d.learning + d.review, 0);

  return (
    <div className="bg-bg-surface border border-border rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Desteler</h2>
          <p className="text-[11px] text-text-muted">{totalDue > 0 ? `Bugün ${totalDue} kart seni bekliyor` : 'Bugünlük bitti'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-input">
            <CI.Plus className="w-3.5 h-3.5" /> Deste
          </button>
          <button
            type="button"
            onClick={() => onStudy(null)}
            disabled={totalDue === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CI.Play className="w-3.5 h-3.5" /> Hepsini çalış
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <CI.Layers className="w-8 h-8 mx-auto text-text-muted" />
          <p className="mt-2 text-sm font-medium text-text-primary">Henüz deste yok</p>
          <p className="text-xs text-text-muted">"Deste" düğmesiyle bir deste oluştur.</p>
        </div>
      ) : (
        <Stagger className="divide-y divide-border" stagger={0.04}>
          {list.map((d) => {
            const due = d.new + d.learning + d.review;
            return (
              <StaggerItem key={d.id}>
                <HoverLift className="flex items-center gap-3 px-4 py-3 hover:bg-bg-input/40 transition-colors">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                  <button type="button" onClick={() => onBrowse(d.id)} className="flex-1 min-w-0 text-left" title="Kartları göster">
                    <div className="text-sm font-medium text-text-primary truncate">{d.name}</div>
                    <div className="text-[11px] text-text-muted">{d.total} kart{d.suspended > 0 ? ` · ${d.suspended} askıda` : ''}</div>
                  </button>
                  <div className="hidden sm:flex items-center gap-3">
                    <Pill n={d.new} label="yeni" tone="text-positive" />
                    <Pill n={d.learning} label="öğrenme" tone="text-warning" />
                    <Pill n={d.review} label="tekrar" tone="text-accent" />
                  </div>
                  <button type="button" onClick={() => onEdit(d)} aria-label={`${d.name} destesini düzenle`} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-input">
                    <CI.Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onStudy(d.id)}
                    disabled={due === 0}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    Çalış
                  </button>
                </HoverLift>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
  );
};

module.exports = { DeckList, DeckDialog };
