// Telefon bildirimi (ntfy): kritik haber, görev hatırlatma ve sabah özeti.
const React = require('react');
const { useState, useEffect, useCallback } = React;
const api = require('./api');
const sound = require('../../utils/sound');
const {
  Icon, StatusPill, SectionCard, Toggle, Field, Banner, Button, SaveButton, CopyBox, Steps, Skeleton, inputCls,
} = require('./ui');

const URL_BASE = '/api/integrations/ntfy';
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

const toDraft = (s) => ({
  enabled: !!s.enabled,
  server: s.server || 'https://ntfy.sh',
  topic: s.topic || '',
  minNewsImportance: s.minNewsImportance === 2 ? 2 : 3,
  taskReminders: !!s.taskReminders,
  reminderLeadMinutes: s.reminderLeadMinutes || 15,
  morningDigest: !!s.morningDigest,
  digestTime: s.digestTime || '08:30',
  quietOn: !!s.quietHours,
  quietStart: (s.quietHours && s.quietHours.start) || '23:00',
  quietEnd: (s.quietHours && s.quietHours.end) || '07:00',
});

const NtfySection = () => {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get(URL_BASE);
      setSaved(d.settings);
      setDraft(toDraft(d.settings));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const onInput = (k) => (e) => set(k)(e.target.value);

  const topicInvalid = draft && draft.topic && !TOPIC_RE.test(draft.topic.trim());
  const isPublicNtfy = draft && /^https:\/\/ntfy\.sh\/?$/i.test(draft.server.trim());

  const save = async () => {
    setError('');
    setNotice(null);
    const body = {
      enabled: draft.enabled,
      server: draft.server.trim(),
      topic: draft.topic.trim(),
      minNewsImportance: draft.minNewsImportance,
      taskReminders: draft.taskReminders,
      reminderLeadMinutes: Number(draft.reminderLeadMinutes),
      morningDigest: draft.morningDigest,
      digestTime: draft.digestTime,
      quietHours: draft.quietOn ? { start: draft.quietStart, end: draft.quietEnd } : null,
    };
    if (token.trim()) body.token = token.trim();
    else if (clearToken) body.token = '';
    try {
      const d = await api.put(URL_BASE, body);
      setSaved(d.settings);
      setDraft(toDraft(d.settings));
      setToken('');
      setClearToken(false);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const generate = async () => {
    try {
      const d = await api.post(`${URL_BASE}/generate-topic`);
      set('topic')(d.topic);
      sound.play('pop', { volume: 0.6 });
    } catch (e) {
      setError(e.message);
    }
  };

  const test = async () => {
    setTesting(true);
    setError('');
    setNotice(null);
    try {
      await api.post(`${URL_BASE}/test`);
      sound.play('notify');
      setNotice({ tone: 'ok', text: 'Test bildirimi gönderildi. Telefonunuza geldi mi?' });
    } catch (e) {
      sound.play('error');
      setError(e.message);
    } finally {
      setTesting(false);
    }
  };

  const active = saved && saved.enabled && saved.topic;
  const pill = !saved ? null : active ? <StatusPill tone="ok">Açık</StatusPill> : <StatusPill tone="off">Kapalı</StatusPill>;
  const dirtyTopic = saved && draft && (saved.topic !== draft.topic.trim() || saved.server !== draft.server.trim().replace(/\/+$/, ''));

  return (
    <SectionCard
      icon={<Icon.Phone />}
      title="Telefon bildirimi (ntfy)"
      subtitle="Kritik haberler, görev hatırlatmaları ve sabah özeti telefonunuza gelsin."
      pill={pill}
    >
      {error && <Banner tone="error" onClose={() => setError('')}>{error}</Banner>}
      {notice && <Banner tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Banner>}
      {!draft ? <Skeleton /> : (
        <>
          <Toggle
            checked={draft.enabled}
            onChange={set('enabled')}
            label="Bildirimleri aç"
            description="Açıkken sunucu her dakika kontrol eder ve uygun olayları ntfy üzerinden gönderir."
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Sunucu" hint="Varsayılan: https://ntfy.sh. Kendi ntfy sunucunuzu da yazabilirsiniz.">
              <input className={inputCls} value={draft.server} onChange={onInput('server')} placeholder="https://ntfy.sh" spellCheck={false} />
            </Field>
            <Field label="Konu (topic)" hint={topicInvalid ? 'Yalnızca harf, rakam, - ve _ (en fazla 64).' : 'Uzun ve tahmin edilemez olmalı.'}>
              <div className="flex gap-2">
                <input
                  className={`${inputCls} font-mono ${topicInvalid ? 'border-negative/60' : ''}`}
                  value={draft.topic}
                  onChange={onInput('topic')}
                  placeholder="tg-…"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button variant="secondary" onClick={generate} className="flex-shrink-0">Üret</Button>
              </div>
            </Field>
          </div>

          {isPublicNtfy && (
            <Banner tone="warn">
              Herkese açık ntfy.sh üzerinde konular parola ile korunmaz: konu adını bilen herkes bildirimlerinizi okuyabilir.
              Bu yüzden konuyu gizli tutun (Üret ile uzun rastgele bir ad kullanın) ya da kendi ntfy sunucunuzu kurun.
              Görev başlıkları bildirim metninde yer alır.
            </Banner>
          )}

          <Field
            label="Erişim anahtarı (isteğe bağlı)"
            hint="Yalnızca erişim kontrollü bir ntfy sunucusu kullanıyorsanız gerekir (tk_… biçiminde). Şifreli saklanır, geri gösterilmez."
          >
            <div className="flex gap-2">
              <input
                type="password"
                className={inputCls}
                value={token}
                onChange={(e) => { setToken(e.target.value); setClearToken(false); }}
                placeholder={saved && saved.tokenSet && !clearToken ? 'Kayıtlı (gizli) — değiştirmek için yazın' : 'Yok'}
                autoComplete="new-password"
                spellCheck={false}
              />
              {saved && saved.tokenSet && !clearToken && (
                <Button variant="danger" onClick={() => { setClearToken(true); setToken(''); }} className="flex-shrink-0">Kaldır</Button>
              )}
            </div>
            {clearToken && <span className="block text-[11px] text-warning mt-1">Kaydettiğinizde anahtar silinecek.</span>}
          </Field>

          <div className="rounded-xl border border-border divide-y divide-border">
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-text-primary font-medium">Kritik haber bildirimi</div>
                  <div className="text-xs text-text-tertiary mt-0.5">Yalnızca kaynak ve başlık gönderilir; yorum veya öneri içermez.</div>
                </div>
                <select
                  className={`${inputCls} w-auto`}
                  value={draft.minNewsImportance}
                  onChange={(e) => set('minNewsImportance')(Number(e.target.value))}
                  aria-label="Haber önem eşiği"
                >
                  <option value={3}>Yalnızca kritik (3)</option>
                  <option value={2}>Önemli ve kritik (2+)</option>
                </select>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <Toggle
                checked={draft.taskReminders}
                onChange={set('taskReminders')}
                label="Görev hatırlatmaları"
                description="Tarihi ve saati olan açık görevler için, zamanı gelmeden önce bir kez bildirim."
              />
              {draft.taskReminders && (
                <Field label="Kaç dakika önce?" className="max-w-[180px]">
                  <input type="number" min={1} max={240} className={inputCls} value={draft.reminderLeadMinutes} onChange={onInput('reminderLeadMinutes')} />
                </Field>
              )}
            </div>
            <div className="p-4 space-y-3">
              <Toggle
                checked={draft.morningDigest}
                onChange={set('morningDigest')}
                label="Sabah özeti"
                description="Bugünkü ve gecikmiş görev sayıları ile günün yüksek etkili ekonomik takvim olayları."
              />
              {draft.morningDigest && (
                <Field label="Saat" className="max-w-[180px]">
                  <input type="time" className={inputCls} value={draft.digestTime} onChange={onInput('digestTime')} />
                </Field>
              )}
            </div>
            <div className="p-4 space-y-3">
              <Toggle
                checked={draft.quietOn}
                onChange={set('quietOn')}
                label="Sessiz saatler"
                description="Bu aralıkta haber ve görev bildirimi gönderilmez (sabah özeti hariç)."
              />
              {draft.quietOn && (
                <div className="flex gap-3">
                  <Field label="Başlangıç" className="w-[150px]">
                    <input type="time" className={inputCls} value={draft.quietStart} onChange={onInput('quietStart')} />
                  </Field>
                  <Field label="Bitiş" className="w-[150px]">
                    <input type="time" className={inputCls} value={draft.quietEnd} onChange={onInput('quietEnd')} />
                  </Field>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-bg-input/50 border border-border p-4 space-y-3">
            <div className="text-xs font-semibold text-text-primary">Telefonda kurulum</div>
            <Steps items={[
              'Telefonunuza ntfy uygulamasını kurun (Android: Google Play / F-Droid, iOS: App Store — "ntfy").',
              'Uygulamada + (Abone ol) düğmesine basın, konu adını yazın. Kendi sunucunuzu kullanıyorsanız "Başka sunucu kullan" ile adresi girin.',
              'Buradaki ayarları kaydedin ve "Test gönder" ile deneyin.',
            ]} />
            {saved && saved.topic && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-text-tertiary">Abone olunacak adres (gizli tutun):</div>
                <CopyBox value={`${saved.server}/${saved.topic}`} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              onClick={test}
              disabled={testing || !saved || !saved.topic || dirtyTopic}
              title={dirtyTopic ? 'Önce kaydedin' : undefined}
            >
              {testing ? 'Gönderiliyor…' : 'Test gönder'}
            </Button>
            <SaveButton onSave={save} disabled={topicInvalid} />
          </div>
        </>
      )}
    </SectionCard>
  );
};

module.exports = NtfySection;
