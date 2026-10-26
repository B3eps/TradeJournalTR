// Import / export and settings dialogs for Kartlar.
const React = require('react');
const { useState, useEffect, useRef } = React;
const Modal = require('./Modal');
const CI = require('./CardIcons');
const api = require('./api');

const fieldCls = 'mt-1 w-full px-3 py-2 text-sm rounded-lg bg-bg-input border border-border text-text-primary focus:outline-none focus:border-accent';

const ImportExportDialog = ({ decks, defaultDeckId, onImported, onClose }) => {
  const [tab, setTab] = useState('import');
  const [deckId, setDeckId] = useState(defaultDeckId || (decks[0] && decks[0].id) || '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [exportDeck, setExportDeck] = useState('');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);

  const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length;

  const pickFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result || '')); setResult(null); setError(''); };
    reader.onerror = () => setError('Dosya okunamadı.');
    reader.readAsText(f, 'utf-8');
    e.target.value = '';
  };

  const doImport = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await api.importTsv(deckId, text);
      setResult(res);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const fetchExport = async () => api.exportTsv(exportDeck || undefined);

  const doDownload = async () => {
    setBusy(true);
    setError('');
    try {
      const tsv = await fetchExport();
      if (!tsv.trim()) { setError('Dışa aktarılacak kart yok.'); return; }
      const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kartlar.tsv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doCopy = async () => {
    setBusy(true);
    setError('');
    try {
      const tsv = await fetchExport();
      if (!tsv.trim()) { setError('Dışa aktarılacak kart yok.'); return; }
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err && err.message ? err.message : 'Panoya kopyalanamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="İçe / dışa aktar"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-bg-input">Kapat</button>
          {tab === 'import' ? (
            <button type="button" onClick={doImport} disabled={busy || !text.trim()} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90 disabled:opacity-40">
              {busy ? 'Aktarılıyor…' : `${lineCount} satırı içe aktar`}
            </button>
          ) : (
            <>
              <button type="button" onClick={doCopy} disabled={busy} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-input disabled:opacity-40">
                {copied ? 'Kopyalandı' : 'Panoya kopyala'}
              </button>
              <button type="button" onClick={doDownload} disabled={busy} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90 disabled:opacity-40">
                <CI.Download className="w-3.5 h-3.5" /> .tsv indir
              </button>
            </>
          )}
        </>
      )}
    >
      <div className="flex gap-1 mb-4 p-1 rounded-lg bg-bg-input w-fit" role="tablist">
        {[['import', 'İçe aktar'], ['export', 'Dışa aktar']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => { setTab(id); setError(''); }}
            className={`px-3 py-1 text-xs font-medium rounded-md ${tab === id ? 'bg-bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 text-xs text-negative" role="alert">{error}</p>}

      {tab === 'import' ? (
        <div className="space-y-3">
          <p className="text-xs text-text-tertiary">
            Her satır bir kart: <span className="font-mono">ön yüz</span> TAB <span className="font-mono">arka yüz</span> (isteğe bağlı üçüncü sütun: etiketler). Anki dışa aktarımını veya CSV içeriğini yapıştırabilirsin.
          </p>
          <label className="block">
            <span className="text-xs text-text-tertiary">Hedef deste</span>
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)} className={fieldCls}>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="cards-import-text" className="text-xs text-text-tertiary">Kartlar</label>
              <button type="button" onClick={() => fileRef.current && fileRef.current.click()} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                <CI.Upload className="w-3 h-3" /> Dosyadan yükle
              </button>
              <input ref={fileRef} type="file" accept=".txt,.tsv,.csv,text/*" className="hidden" onChange={pickFile} />
            </div>
            <textarea
              id="cards-import-text"
              rows={9}
              value={text}
              onChange={(e) => { setText(e.target.value); setResult(null); }}
              placeholder={'Spread nedir?\tAlış ve satış fiyatı arasındaki fark.\nSwap nedir?\tGece taşıma faizi.'}
              className={`${fieldCls} font-mono text-xs resize-y`}
            />
          </div>
          {result && (
            <div className="rounded-lg border border-positive/30 bg-positive/10 px-3 py-2 text-xs text-text-primary" role="status">
              <span className="font-semibold text-positive">{result.imported} kart eklendi.</span>
              {' '}Tekrar eden: {result.duplicates} · Geçersiz satır: {result.invalid}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-text-tertiary">Kartlar sekmeyle ayrılmış metin (TSV) olarak indirilir. Çalışma ilerlemen dışa aktarıma dahil değildir.</p>
          <label className="block">
            <span className="text-xs text-text-tertiary">Deste</span>
            <select value={exportDeck} onChange={(e) => setExportDeck(e.target.value)} className={fieldCls}>
              <option value="">Tüm desteler</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.total})</option>)}
            </select>
          </label>
        </div>
      )}
    </Modal>
  );
};

const SettingsDialog = ({ onSaved, onClose }) => {
  const [newPerDay, setNewPerDay] = useState('20');
  const [retention, setRetention] = useState('0.9');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.getSettings()
      .then((s) => {
        if (!alive || !s) return;
        setNewPerDay(String(s.newPerDay));
        setRetention(String(s.retention));
        setLoaded(true);
      })
      .catch((err) => { if (alive) { setError(err.message); setLoaded(true); } });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.updateSettings({ newPerDay: Number(newPerDay), retention: Number(retention) });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Kart ayarları"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-lg text-text-secondary hover:bg-bg-input">Vazgeç</button>
          <button type="button" onClick={save} disabled={busy || !loaded} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90 disabled:opacity-40">Kaydet</button>
        </>
      )}
    >
      <div className="space-y-4">
        {error && <p className="text-xs text-negative" role="alert">{error}</p>}
        <label className="block">
          <span className="text-xs text-text-tertiary">Günlük yeni kart sınırı (0–500)</span>
          <input type="number" min="0" max="500" value={newPerDay} onChange={(e) => setNewPerDay(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-xs text-text-tertiary">Hedef tutma oranı (0,70–0,97)</span>
          <input type="number" step="0.01" min="0.7" max="0.97" value={retention} onChange={(e) => setRetention(e.target.value)} className={fieldCls} />
          <span className="text-[11px] text-text-muted">Yüksek oran daha sık tekrar demektir. Varsayılan 0,90. Gün sınırı 04:00'tür.</span>
        </label>
      </div>
    </Modal>
  );
};

module.exports = { ImportExportDialog, SettingsDialog };
