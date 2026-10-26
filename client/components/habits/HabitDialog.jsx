// Add / edit dialog for a habit: name, emoji, colour and schedule (every day, N days a week, or chosen weekdays).
const React = require('react');
const { useState, useEffect, useRef } = React;

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#a855f7', '#84cc16'];
const EMOJIS = ['📚', '🏃', '✍️', '🧘', '💧', '😴', '🎯', '🧠', '🥗', '🎸', '📝', '☀️'];
const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const SUGGESTIONS = [
  { name: 'Okul çalışması', icon: '📚', color: '#6366f1', targetPerWeek: 5 },
  { name: 'Egzersiz', icon: '🏃', color: '#22c55e', targetPerWeek: 3 },
  { name: 'Günlük yaz', icon: '✍️', color: '#f59e0b', targetPerWeek: 7 },
  { name: 'Seans öncesi plan', icon: '🎯', color: '#06b6d4', targetPerWeek: 5 },
  { name: 'Uyku düzeni', icon: '😴', color: '#a855f7', targetPerWeek: 7 },
];

const initialMode = (h) => {
  if (!h) return 'daily';
  if (h.daysOfWeek && h.daysOfWeek.length) return 'days';
  return h.targetPerWeek < 7 ? 'weekly' : 'daily';
};

const HabitDialog = ({ habit, onSave, onClose, onArchive, onDelete }) => {
  const editing = !!habit;
  const [name, setName] = useState(habit ? habit.name : '');
  const [icon, setIcon] = useState(habit ? habit.icon : '📚');
  const [color, setColor] = useState(habit ? habit.color : COLORS[0]);
  const [mode, setMode] = useState(initialMode(habit));
  const [target, setTarget] = useState(habit && habit.targetPerWeek < 7 ? habit.targetPerWeek : 3);
  const [days, setDays] = useState(habit && habit.daysOfWeek ? habit.daysOfWeek : [0, 2, 4]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    if (nameRef.current) nameRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const toggleDay = (i) => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()));

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Alışkanlığa bir ad ver.'); return; }
    if (mode === 'days' && days.length === 0) { setError('En az bir gün seç.'); return; }
    const body = { name: name.trim(), icon: icon.trim() || '✅', color };
    if (mode === 'daily') { body.targetPerWeek = 7; body.daysOfWeek = null; }
    else if (mode === 'weekly') { body.targetPerWeek = target; body.daysOfWeek = null; }
    else { body.daysOfWeek = days; }
    setBusy(true);
    setError('');
    try {
      await onSave(body);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const modeBtn = (id, label) => (
    <button
      type="button"
      onClick={() => setMode(id)}
      aria-pressed={mode === id}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${mode === id ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={editing ? 'Alışkanlığı düzenle' : 'Yeni alışkanlık'}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-bg-surface border border-border rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">{editing ? 'Alışkanlığı düzenle' : 'Yeni alışkanlık'}</h2>
          <button type="button" onClick={onClose} aria-label="Kapat" className="text-text-muted hover:text-text-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label htmlFor="habit-name" className="block text-xs font-medium text-text-secondary mb-1.5">Ad</label>
            <div className="flex gap-2">
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={8}
                aria-label="Emoji"
                className="w-12 text-center text-lg rounded-lg bg-bg-input border border-border outline-none focus:border-accent/60"
              />
              <input
                id="habit-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="ör. Okul çalışması"
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-bg-input border border-border text-text-primary placeholder:text-text-muted outline-none focus:border-accent/60"
              />
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {EMOJIS.map((em) => (
                <button key={em} type="button" onClick={() => setIcon(em)} aria-label={`Emoji ${em}`} className={`w-8 h-8 rounded-lg text-base transition-colors ${icon === em ? 'bg-bg-input ring-1 ring-accent/60' : 'hover:bg-bg-input'}`}>{em}</button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-text-secondary mb-1.5">Renk</span>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Renk ${c}`}
                  aria-pressed={color === c}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px rgb(var(--bg-surface)), 0 0 0 4px ${c}` : undefined }}
                />
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-text-secondary mb-1.5">Sıklık</span>
            <div className="flex flex-wrap gap-2">
              {modeBtn('daily', 'Her gün')}
              {modeBtn('weekly', 'Haftada N gün')}
              {modeBtn('days', 'Belirli günler')}
            </div>
            {mode === 'weekly' && (
              <div className="mt-3 flex items-center gap-1" role="group" aria-label="Haftalık hedef">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} type="button" onClick={() => setTarget(n)} aria-pressed={target === n} className={`w-9 h-9 rounded-lg text-sm tabular-nums border transition-colors ${target === n ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}>{n}</button>
                ))}
                <span className="ml-2 text-xs text-text-muted">gün / hafta</span>
              </div>
            )}
            {mode === 'days' && (
              <div className="mt-3 flex gap-1" role="group" aria-label="Günler">
                {DAY_LABELS.map((d, i) => (
                  <button key={d} type="button" onClick={() => toggleDay(i)} aria-pressed={days.includes(i)} className={`flex-1 h-9 rounded-lg text-xs border transition-colors ${days.includes(i) ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}>{d}</button>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-text-muted">
              {mode === 'daily' && 'Seri, üst üste tamamladığın günleri sayar. Bugün henüz yapılmadıysa seri bozulmaz.'}
              {mode === 'weekly' && 'Seri, hedefi tutturduğun üst üste haftaları sayar. Hangi günler olduğu fark etmez.'}
              {mode === 'days' && 'Yalnızca seçtiğin günler sayılır; diğer günler seriyi bozmaz.'}
            </p>
          </div>

          {error && <p className="text-xs text-negative" role="alert">{error}</p>}
        </div>

        <div className="px-5 py-3.5 border-t border-border flex items-center gap-2">
          {editing && (
            <div className="flex items-center gap-1 mr-auto">
              <button type="button" onClick={() => onArchive(habit)} className="px-2.5 py-1.5 text-xs rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">
                {habit.archived ? 'Arşivden çıkar' : 'Arşivle'}
              </button>
              {confirmDelete ? (
                <button type="button" onClick={() => onDelete(habit)} className="px-2.5 py-1.5 text-xs rounded-lg bg-negative/15 text-negative hover:bg-negative/25 transition-colors">Geçmişiyle sil, emin misin?</button>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="px-2.5 py-1.5 text-xs rounded-lg text-text-muted hover:text-negative transition-colors">Sil</button>
              )}
            </div>
          )}
          <button type="button" onClick={onClose} className="ml-auto px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">Vazgeç</button>
          <button type="submit" disabled={busy} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:bg-accent/90 disabled:opacity-50 transition-colors">
            {editing ? 'Kaydet' : 'Ekle'}
          </button>
        </div>
      </form>
    </div>
  );
};

module.exports = { HabitDialog, SUGGESTIONS, DAY_LABELS };
