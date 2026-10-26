const React = require('react');
const { useCallback, useEffect, useState } = React;
const { SectionCard, Icon, Button, Toggle, Field, Banner, StatusPill, Skeleton } = require('./ui');

const desktop = () => (typeof window !== 'undefined' ? window.tradeGunluguDesktop : null);

const ChatGPTNewsSection = () => {
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [desktopSupported, setDesktopSupported] = useState(true);

  const load = useCallback(async () => {
    const api = desktop();
    if (!api || !api.chatgptNewsState) {
      setDesktopSupported(false);
      setError('ChatGPT bağlantısı için masaüstü uygulamasının yeni sürümü gerekir.');
      return;
    }
    setDesktopSupported(true);
    try {
      const result = await api.chatgptNewsState();
      setState(result);
      setDraft({
        ...result.settings,
        model: result.settings.model || (result.models[0] && result.models[0].slug) || '',
      });
      setError('');
    } catch (err) { setError(err.message || 'ChatGPT bağlantı durumu alınamadı.'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const connect = async (action = 'connect') => {
    setBusy('connect'); setError(''); setNotice('');
    try {
      const result = await desktop().chatgptNewsSignIn(action);
      setState(result);
      setDraft((d) => ({ ...d, model: d.model || (result.models[0] && result.models[0].slug) || '' }));
      setNotice(result.session.sharing
        ? 'ChatGPT bağlandı. Haber otomasyonu varsayılan olarak kapalı; aşağıdan ayrıca açabilirsiniz.'
        : 'Giriş tamamlandı ancak plan kullanım izni verilmedi. İzin eklemek için yeniden bağlanın.');
    } catch (err) { setError(err.message || 'ChatGPT bağlantısı kurulamadı.'); }
    finally { setBusy(''); }
  };

  const disconnect = async () => {
    setBusy('disconnect'); setError(''); setNotice('');
    try {
      const result = await desktop().chatgptNewsDisconnect();
      setState(result);
      setDraft({ ...result.settings });
      setNotice('ChatGPT bağlantısı kesildi; otomatik haber değerlendirmesi kapatıldı.');
    } catch (err) { setError(err.message || 'Bağlantı kesilemedi.'); }
    finally { setBusy(''); }
  };

  const save = async () => {
    setBusy('save'); setError(''); setNotice('');
    try {
      const result = await desktop().chatgptNewsSaveSettings({
        enabled: !!draft.enabled,
        model: String(draft.model || ''),
        maxPerHour: Number(draft.maxPerHour),
      });
      setState(result);
      setDraft({ ...result.settings, model: result.settings.model || (result.models[0] && result.models[0].slug) || '' });
      setNotice(result.settings.enabled
        ? `Otomasyon açık. Saatte en fazla ${result.settings.maxPerHour} Altın/Gümüş haberi değerlendirilecek.`
        : 'Ayarlar kaydedildi; otomatik haber değerlendirmesi kapalı.');
    } catch (err) { setError(err.message || 'Ayarlar kaydedilemedi.'); }
    finally { setBusy(''); }
  };

  const connected = !!(state && state.session && state.session.status === 'connected');
  const sharing = !!(state && state.session && state.session.sharing);
  const models = (state && state.models) || [];
  const statusPill = sharing
    ? <StatusPill tone="ok">ChatGPT planı bağlı</StatusPill>
    : connected
      ? <StatusPill tone="warn">Plan kullanım izni yok</StatusPill>
      : <StatusPill tone="off">Bağlı değil</StatusPill>;

  return (
    <SectionCard
      icon={<Icon.Chip />}
      title="ChatGPT haber analizi"
      subtitle="Altın ve gümüş haberlerini kendi ChatGPT hesabınızla Türkçe değerlendirir. API anahtarı gerekmez."
      pill={statusPill}
    >
      {error && <Banner tone="error" onClose={() => setError('')}>{error}</Banner>}
      {notice && <Banner tone="ok" onClose={() => setNotice('')}>{notice}</Banner>}
      {!desktopSupported ? (
        <Banner tone="warn">Bu özellik güvenli masaüstü bağlantısı gerektiriyor. Uygulama kabuğu güncellenene kadar ChatGPT bağlantısı kullanılamaz.</Banner>
      ) : !state || !draft ? <Skeleton /> : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-bg-input/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text-primary">ChatGPT hesabı</p>
                <p className="text-xs text-text-secondary mt-1">
                  {connected
                    ? (state.session.identity && state.session.identity.email) || state.session.profileLabel || 'Hesap bağlı'
                    : 'Bu bilgisayarda kendi hesabınızla güvenli biçimde giriş yapın.'}
                </p>
              </div>
              {!connected ? (
                <Button variant="primary" onClick={() => connect()} disabled={!!busy}>
                  {busy === 'connect' ? 'Tarayıcı açılıyor…' : 'ChatGPT’ye bağlan'}
                </Button>
              ) : (
                <div className="flex gap-2">
                  {!sharing && <Button variant="secondary" onClick={() => connect('reconsent')} disabled={!!busy}>Plan kullanım izni ver</Button>}
                  <Button variant="secondary" onClick={disconnect} disabled={!!busy}>{busy === 'disconnect' ? 'Kesiliyor…' : 'Bağlantıyı kes'}</Button>
                </div>
              )}
            </div>
            {sharing && (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-xs text-text-secondary">İstekler bu bilgisayarda, bağlı hesabınızla çalışır.</span>
                <button type="button" onClick={() => desktop().chatgptNewsOpenUsage()} className="text-xs text-accent hover:underline">ChatGPT kullanımını yönet</button>
              </div>
            )}
          </div>

          <Banner tone="info">
            Her analiz sizin bağlı hesabınızın kullanımına sayılır. Jetonlar işletim sisteminin güvenli saklama alanında kalır; uygulama ChatGPT sohbetlerinize erişmez.
          </Banner>

          <div className="space-y-3 rounded-xl border border-border p-4">
            <Toggle
              checked={!!draft.enabled}
              onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
              label="Altın/Gümüş haberlerini otomatik değerlendir"
              description="Açıkça izin verdiğinizde uygulama çalışırken yeni ve önemli XAU/XAG haberlerini arka planda, seçtiğiniz ChatGPT modeliyle Türkçeye çevirip etki analizi yapar. Varsayılan: kapalı."
            />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="ChatGPT modeli" hint={models.length ? 'Bağlı hesabın sunduğu modeller.' : 'Önce ChatGPT hesabını bağlayın.'}>
                <select
                  className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary disabled:opacity-50"
                  value={draft.model}
                  onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                  disabled={!models.length}
                >
                  {!models.length && <option value="">Model listesi yok</option>}
                  {models.map((model) => <option key={model.slug} value={model.slug}>{model.displayName || model.slug}</option>)}
                </select>
              </Field>
              <Field label="Saatte en fazla otomatik analiz" hint={`Son saatte: ${state.usedThisHour || 0} · ChatGPT'deki uygulama sınırınız ayrıca geçerlidir.`}>
                <input
                  type="number" min="1" max="24"
                  className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary"
                  value={draft.maxPerHour}
                  onChange={(event) => setDraft((current) => ({ ...current, maxPerHour: Number(event.target.value) }))}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={save} disabled={!!busy || (draft.enabled && !sharing)}>
                {busy === 'save' ? 'Kaydediliyor…' : 'Ayarları kaydet'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
};

module.exports = ChatGPTNewsSection;
