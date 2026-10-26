// Slide-over drawer with the Pomodoro settings (stored on the server via PUT /api/focus/settings).
const React = require('react');
const { useState, useEffect } = React;
const store = require('./store');

const Field = ({ label, hint, value, onChange, min, max, suffix }) => (
  <label className="flex items-center justify-between gap-3">
    <span>
      <span className="block text-sm text-text-primary">{label}</span>
      {hint && <span className="block text-xs text-text-muted">{hint}</span>}
    </span>
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 px-2 py-1.5 text-sm text-right tabular-nums rounded-lg bg-bg-input border border-border text-text-primary outline-none focus:border-accent/60"
      />
      <span className="text-xs text-text-muted w-6">{suffix}</span>
    </span>
  </label>
);

const Switch = ({ label, hint, checked, onChange }) => (
  <div className="flex items-center justify-between gap-3">
    <span>
      <span className="block text-sm text-text-primary">{label}</span>
      {hint && <span className="block text-xs text-text-muted">{hint}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-accent' : 'bg-bg-input border border-border'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  </div>
);

const SettingsDrawer = ({ settings, onClose, onSaved }) => {
  const [form, setForm] = useState({
    workMin: String(settings.workMin), shortMin: String(settings.shortMin), longMin: String(settings.longMin), longEvery: String(settings.longEvery),
    autoStartBreaks: settings.autoStartBreaks, soundOn: settings.soundOn,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const up = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const n = {
      workMin: Number(form.workMin), shortMin: Number(form.shortMin), longMin: Number(form.longMin), longEvery: Number(form.longEvery),
    };
    const ranges = { workMin: [1, 180, 'Odak süresi'], shortMin: [1, 60, 'Kısa mola'], longMin: [1, 120, 'Uzun mola'], longEvery: [2, 12, 'Uzun mola aralığı'] };
    for (const k of Object.keys(ranges)) {
      const [lo, hi, name] = ranges[k];
      if (!Number.isInteger(n[k]) || n[k] < lo || n[k] > hi) { setError(`${name} ${lo} ile ${hi} arasında olmalı.`); return; }
    }
    setBusy(true);
    setError('');
    try {
      const saved = await store.saveSettings({ ...n, autoStartBreaks: form.autoStartBreaks, soundOn: form.soundOn });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const askPerm = async () => {
    try { setPerm(await Notification.requestPermission()); } catch (e) { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label="Odak ayarları">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-bg-surface border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">Odak ayarları</h2>
          <button type="button" onClick={onClose} aria-label="Kapat" className="text-text-muted hover:text-text-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          <Field label="Odak süresi" value={form.workMin} onChange={up('workMin')} min={1} max={180} suffix="dk" />
          <Field label="Kısa mola" value={form.shortMin} onChange={up('shortMin')} min={1} max={60} suffix="dk" />
          <Field label="Uzun mola" value={form.longMin} onChange={up('longMin')} min={1} max={120} suffix="dk" />
          <Field label="Uzun mola aralığı" hint="Kaç odak oturumundan sonra" value={form.longEvery} onChange={up('longEvery')} min={2} max={12} suffix="x" />
          <div className="h-px bg-border" />
          <Switch label="Molaları otomatik başlat" hint="Odak bitince mola sayacı kendiliğinden başlar" checked={form.autoStartBreaks} onChange={up('autoStartBreaks')} />
          <p className="text-xs text-text-muted">Bitiş sesi, sol şeritteki "Ses ve animasyon" ayarına bağlıdır (ayrı bir anahtar yoktur).</p>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm text-text-primary">Masaüstü bildirimi</span>
              <span className="block text-xs text-text-muted">
                {perm === 'granted' ? 'Açık' : perm === 'denied' ? 'Tarayıcı tarafından engellenmiş' : perm === 'unsupported' ? 'Bu ortamda desteklenmiyor' : 'Süre dolunca bildirim göster'}
              </span>
            </span>
            {perm === 'default' && (
              <button type="button" onClick={askPerm} className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">İzin ver</button>
            )}
          </div>
          {error && <p className="text-xs text-negative" role="alert">{error}</p>}
        </div>
        <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">Vazgeç</button>
          <button type="button" onClick={save} disabled={busy} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:bg-accent/90 disabled:opacity-50 transition-colors">Kaydet</button>
        </div>
      </aside>
    </div>
  );
};

module.exports = SettingsDrawer;
