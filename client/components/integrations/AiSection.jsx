// Yerel yapay zeka (Ollama): varsayılan KAPALI; haber özetleri yerel modelle.
const React = require('react');
const { useState, useEffect, useCallback } = React;
const { FadeIn } = require('../ui/motion');
const api = require('./api');
const sound = require('../../utils/sound');
const {
  Icon, StatusPill, SectionCard, Toggle, Field, Banner, Button, SaveButton, CopyBox, Steps, Skeleton,
  inputCls, fmtBytes,
} = require('./ui');

const URL_BASE = '/api/integrations/ai';
const RAM_TOTAL_GB = 16;

const toDraft = (s) => ({
  enabled: !!s.enabled,
  baseUrl: s.baseUrl,
  model: s.model,
  autoSummarize: !!s.autoSummarize,
  maxPerHour: s.maxPerHour,
});

const ETKI_TONE = { 'yukarı baskı': 'text-positive', 'aşağı baskı': 'text-negative', karışık: 'text-warning', belirsiz: 'text-text-tertiary' };

const EvalPreview = ({ ev }) => (
  <FadeIn className="rounded-xl border border-border bg-bg-input/40 p-4 space-y-2.5 text-sm">
    <div className="flex items-center gap-2">
      <StatusPill tone="warn">Güven: {ev.guven}</StatusPill>
      <span className="text-[11px] text-text-tertiary">Volatilite riski: {ev.volatilite_riski}</span>
    </div>
    {ev.ozet && <p className="text-text-primary leading-relaxed">{ev.ozet}</p>}
    {ev.etkilenen && ev.etkilenen.length > 0 && (
      <ul className="text-xs space-y-1">
        {ev.etkilenen.map((e, i) => (
          <li key={i}><span className="font-mono text-text-primary">{e.enstruman}</span>{' '}
            <span className={ETKI_TONE[e.etki] || 'text-text-secondary'}>{e.etki}</span>
            {e.neden && <span className="text-text-tertiary"> — {e.neden}</span>}
          </li>
        ))}
      </ul>
    )}
    {ev.uyari && <p className="text-[11px] text-warning leading-relaxed">{ev.uyari}</p>}
  </FadeIn>
);

const AiSection = ({ onNavigate }) => {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (keepDraft) => {
    setRefreshing(true);
    try {
      const d = await api.get(URL_BASE);
      setData(d);
      if (!keepDraft) setDraft(toDraft(d.settings));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(false); }, [load]);

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setError('');
    try {
      const d = await api.put(URL_BASE, { ...draft, maxPerHour: Number(draft.maxPerHour) });
      setDraft(toDraft(d.settings));
      await load(true);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const test = async () => {
    setBusy('test');
    setError('');
    setNotice(null);
    try {
      const r = await api.post(`${URL_BASE}/test`);
      sound.play('notify');
      setNotice({ tone: 'ok', text: `Model yanıt verdi (${(r.ms / 1000).toFixed(1)} sn): "${r.reply}"` });
    } catch (e) {
      sound.play('error');
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const summarize = async () => {
    if (!data || !data.sample) return;
    setBusy('sum');
    setError('');
    setResult(null);
    try {
      const r = await api.post(`${URL_BASE}/summarize-news`, { id: data.sample.id, force: !!data.sample.hasEvaluation });
      sound.play('complete');
      setResult(r.evaluation);
      load(true);
    } catch (e) {
      sound.play('error');
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const status = data && data.status;
  const saved = data && data.settings;
  const models = (status && status.models) || [];
  const selected = models.find((m) => m.name === (draft && draft.model));
  const dirty = saved && draft && JSON.stringify(toDraft(saved)) !== JSON.stringify({ ...draft, maxPerHour: Number(draft.maxPerHour) });

  let pill = null;
  if (saved) {
    if (!saved.enabled) pill = <StatusPill tone="off">Kapalı</StatusPill>;
    else if (!status.available) pill = <StatusPill tone="error">Ollama çalışmıyor</StatusPill>;
    else if (!status.modelInstalled) pill = <StatusPill tone="warn">Model kurulu değil</StatusPill>;
    else pill = <StatusPill tone="ok">Hazır</StatusPill>;
  }

  const ready = saved && saved.enabled && status && status.available && status.modelInstalled && !dirty;

  return (
    <SectionCard
      icon={<Icon.Chip />}
      title="Yerel yapay zeka (Ollama)"
      subtitle="Haberleri bilgisayarınızda çalışan bir modelle özetler; veri dışarı gönderilmez."
      pill={pill}
    >
      {error && <Banner tone="error" onClose={() => setError('')}>{error}</Banner>}
      {notice && <Banner tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Banner>}
      {!draft ? <Skeleton /> : (
        <>
          <Banner tone="warn">
            Varsayılan olarak kapalıdır. Model çalışırken {RAM_TOTAL_GB} GB RAM'in önemli bir kısmını kullanabilir
            (qwen3:4b için yaklaşık 3–4 GB). Model her istekten hemen sonra bellekten boşaltılır; yine de özetleme
            sırasında bilgisayar yavaşlayabilir. Küçük modellerin Türkçe kalitesi doğrulanmamıştır.
          </Banner>

          <Toggle
            checked={draft.enabled}
            onChange={set('enabled')}
            label="Yerel yapay zekayı aç"
            description="Kapalıyken hiçbir model çağrısı yapılmaz."
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Ollama adresi" hint="Varsayılan: http://localhost:11434">
              <input className={inputCls} value={draft.baseUrl} onChange={(e) => set('baseUrl')(e.target.value)} spellCheck={false} />
            </Field>
            <Field
              label="Model"
              hint={selected ? `Disk: ${fmtBytes(selected.sizeBytes)} · çalışırken ~${selected.ramHintGb} GB RAM` : 'Kurulu modeller listelenir.'}
            >
              {models.length > 0 ? (
                <select className={inputCls} value={draft.model} onChange={(e) => set('model')(e.target.value)}>
                  {!models.some((m) => m.name === draft.model) && <option value={draft.model}>{draft.model} (kurulu değil)</option>}
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}{m.parameterSize ? ` · ${m.parameterSize}` : ''} · ~{m.ramHintGb} GB{m.heavy ? ' (ağır)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input className={`${inputCls} font-mono`} value={draft.model} onChange={(e) => set('model')(e.target.value)} spellCheck={false} />
              )}
            </Field>
          </div>
          {selected && selected.heavy && (
            <Banner tone="warn">
              Bu model çalışırken yaklaşık {selected.ramHintGb} GB RAM isteyebilir. {RAM_TOTAL_GB} GB'lık bir bilgisayarda
              tarayıcı ve diğer uygulamalarla birlikte sistemi zorlayabilir; 4B veya daha küçük bir model önerilir.
            </Banner>
          )}

          <div className="rounded-xl border border-border divide-y divide-border">
            <div className="p-4 space-y-3">
              <Toggle
                checked={draft.autoSummarize}
                onChange={set('autoSummarize')}
                label="Yeni önemli haberleri otomatik özetle"
                description="Önem 2 ve üzeri yeni haberler sırayla, tek tek özetlenir. Varsayılan: kapalı."
              />
            </div>
            <div className="p-4">
              <Field label="Saatlik en fazla özet" hint="Elle ve otomatik özetlerin toplamı." className="max-w-[200px]">
                <input type="number" min={1} max={60} className={inputCls} value={draft.maxPerHour} onChange={(e) => set('maxPerHour')(e.target.value)} />
              </Field>
              {status && <div className="text-[11px] text-text-tertiary mt-2">Son bir saatte: {status.usedThisHour} özet</div>}
            </div>
          </div>

          <div className="rounded-xl bg-bg-input/50 border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-text-primary">Kurulum</div>
              <Button variant="ghost" onClick={() => load(true)} disabled={refreshing} className="px-2.5 py-1 text-xs">
                {refreshing ? 'Kontrol ediliyor…' : 'Durumu yenile'}
              </Button>
            </div>
            <Steps items={[
              'ollama.com adresinden Ollama\'yı indirip kurun (Windows için kurulum dosyası).',
              'Bir terminal açıp modeli indirin:',
            ]} />
            <CopyBox value={`ollama pull ${draft.model || 'qwen3:4b'}`} />
            <p className="text-[11px] text-text-tertiary">
              Ollama arka planda çalışırken bu sayfa kurulu modelleri otomatik listeler.
              {status && !status.available && status.error ? ` Şu an: ${status.error}` : ''}
            </p>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="text-xs font-semibold text-text-primary">Örnek özet</div>
            {data.sample ? (
              <div className="text-xs text-text-secondary">
                En yeni önemli haber: <span className="text-text-primary">{data.sample.title}</span>
                <span className="text-text-tertiary"> · {data.sample.source}</span>
                {data.sample.hasEvaluation && <span className="text-warning"> (mevcut değerlendirmenin üzerine yazılır)</span>}
              </div>
            ) : (
              <div className="text-xs text-text-tertiary">Henüz önemli haber yok. Canlı Haberler akışı doldukça burada görünür.</div>
            )}
            {busy === 'sum' && <div className="text-xs text-text-tertiary animate-pulse">Model çalışıyor… (bu 1–2 dakika sürebilir)</div>}
            {result && <EvalPreview ev={result} />}
            {result && onNavigate && (
              <button type="button" onClick={() => onNavigate('newsfeed')} className="text-xs text-accent hover:underline">
                Canlı Haberler'de görüntüle →
              </button>
            )}
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Çıktı yalnızca olası etki ve risk analizidir; al/sat, emir, fiyat seviyesi veya işlem önerisi içeremez —
              bu tür ifadeler sunucuda otomatik silinir. Yatırım tavsiyesi değildir.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={test} disabled={!ready || !!busy} title={!ready ? 'Açın, kaydedin ve modeli kurun' : undefined}>
              {busy === 'test' ? 'Deneniyor…' : 'Test'}
            </Button>
            <Button variant="secondary" onClick={summarize} disabled={!ready || !!busy || !data.sample}>
              {busy === 'sum' ? 'Özetleniyor…' : 'Örnek haberi özetle'}
            </Button>
            <SaveButton onSave={save} />
          </div>
        </>
      )}
    </SectionCard>
  );
};

module.exports = AiSection;
