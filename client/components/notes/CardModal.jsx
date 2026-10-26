// "Kart oluştur" modal: turns the selected text of a note into a flashcard (POST /api/cards).
const React = require('react');
const { useState, useEffect, useRef } = React;
const { motion } = require('framer-motion');
const L = require('lucide-react');
const { useAnimationsEnabled } = require('../ui/motion');
const api = require('./api');

const CardModal = ({ initialFront, noteId, onClose, onCreated }) => {
  const animate = useAnimationsEnabled();
  const [front, setFront] = useState(initialFront || '');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const backRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => { if (backRef.current) backRef.current.focus(); }, 30);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey, true); };
  }, [onClose]);

  const submit = async (e) => {
    if (e) e.preventDefault();
    const f = front.trim();
    if (!f) { setError('Ön yüz boş olamaz.'); return; }
    if (f.length > 5000 || back.length > 5000) { setError('Kart metni en fazla 5000 karakter olabilir.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.createCard({ front: f, back: back.trim(), sourceType: 'note', sourceId: noteId });
      onCreated();
    } catch (err) {
      setError(err && err.message ? err.message : 'Kart oluşturulamadı.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="nt-card-title">
      <motion.div
        className="absolute inset-0 bg-black/50"
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        exit={animate ? { opacity: 0 } : { opacity: 0, transition: { duration: 0 } }}
        onClick={onClose}
      />
      <motion.form
        onSubmit={submit}
        className="relative w-full max-w-lg bg-bg-surface border border-border rounded-xl shadow-2xl p-5 space-y-4"
        initial={animate ? { opacity: 0, y: 12, scale: 0.98 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={animate ? { opacity: 0, y: 8, scale: 0.98 } : { opacity: 0, transition: { duration: 0 } }}
        transition={{ duration: 0.18 }}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit(e); }}
      >
        <div className="flex items-center justify-between">
          <h2 id="nt-card-title" className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <L.Layers className="w-4 h-4 text-accent" />Kart oluştur
          </h2>
          <button type="button" onClick={onClose} aria-label="Kapat" className="text-text-muted hover:text-text-primary"><L.X className="w-4 h-4" /></button>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-text-secondary">Ön yüz (soru)</span>
          <textarea
            value={front}
            onChange={(e) => setFront(e.target.value)}
            rows={3}
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-y"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-text-secondary">Arka yüz (cevap)</span>
          <textarea
            ref={backRef}
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={4}
            placeholder="Cevabı yaz…"
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          />
        </label>
        {error && (
          <div role="alert" className="flex items-center gap-2 bg-negative/10 border border-negative/30 rounded-lg px-3 py-2 text-negative text-xs">
            <L.TriangleAlert className="w-3.5 h-3.5 flex-shrink-0" />{error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <span className="text-[10px] text-text-muted mr-auto">Ctrl+Enter ile kaydet</span>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors">Vazgeç</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:opacity-90 disabled:opacity-60 transition-opacity">
            {saving ? <L.LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <L.Check className="w-3.5 h-3.5" />}Kartı kaydet
          </button>
        </div>
      </motion.form>
    </div>
  );
};

module.exports = CardModal;
