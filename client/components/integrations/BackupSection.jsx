// Yedekleme: veritabanı, ekran görüntüleri ve haber değerlendirmeleri; anahtar ayrı korunur.
const React = require('react');
const { useState, useEffect, useCallback } = React;
const { motion, AnimatePresence } = require('framer-motion');
const { useAnimationsEnabled } = require('../ui/motion');
const api = require('./api');
const sound = require('../../utils/sound');
const {
  Icon, StatusPill, SectionCard, Toggle, Field, Banner, Button, SaveButton, CopyBox, Steps, Skeleton,
  inputCls, fmtBytes, fmtDateTime,
} = require('./ui');

const URL_BASE = '/api/integrations/backup';

const BackupSection = () => {
  const animate = useAnimationsEnabled();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false);
  const [showPath, setShowPath] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const apply = (d) => {
    setData(d);
    setDraft({ autoEnabled: !!d.settings.autoEnabled, hour: d.settings.hour, keep: d.settings.keep });
  };

  const load = useCallback(async () => {
    try {
      apply(await api.get(URL_BASE));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError('');
    try {
      apply(await api.put(URL_BASE, { autoEnabled: draft.autoEnabled, hour: draft.hour, keep: Number(draft.keep) }));
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const run = async () => {
    setRunning(true);
    setError('');
    setNotice('');
    try {
      const d = await api.post(`${URL_BASE}/run`);
      apply(d);
      sound.play('complete');
      setNotice(`Yedek oluşturuldu: ${d.created.name} (${fmtBytes(d.created.sizeBytes)})`);
    } catch (e) {
      sound.play('error');
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const remove = async (name) => {
    setConfirmDel(null);
    try {
      apply(await api.del(`${URL_BASE}/${encodeURIComponent(name)}`));
      sound.play('delete');
    } catch (e) {
      setError(e.message);
    }
  };

  const backups = (data && data.backups) || [];
  const last = backups[0];
  const pill = !data ? null
    : data.lastError ? <StatusPill tone="error">Son yedek başarısız</StatusPill>
      : data.settings.autoEnabled ? <StatusPill tone="ok">Otomatik açık</StatusPill>
        : <StatusPill tone="off">Otomatik kapalı</StatusPill>;
  const sep = data && /\\/.test(data.folder) ? '\\' : '/';

  return (
    <SectionCard
      icon={<Icon.Archive />}
      title="Yedekleme"
      subtitle={last ? `Son yedek: ${fmtDateTime(last.createdAt)}` : 'Henüz yedek yok.'}
      pill={pill}
    >
      {error && <Banner tone="error" onClose={() => setError('')}>{error}</Banner>}
      {notice && <Banner tone="ok" onClose={() => setNotice('')}>{notice}</Banner>}
      {!draft ? <Skeleton /> : (
        <>
          <Toggle
            checked={draft.autoEnabled}
            onChange={(v) => setDraft((d) => ({ ...d, autoEnabled: v }))}
            label="Otomatik günlük yedek"
            description="Her gün belirlenen saatte (uygulama kapalıysa o gün ilk açılışta) veritabanı, işlem görselleri, ekran görüntüleri ve haber değerlendirmeleri yedeklenir."
          />
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <Field label="Saat">
              <input type="time" className={inputCls} value={draft.hour} onChange={(e) => setDraft((d) => ({ ...d, hour: e.target.value }))} />
            </Field>
            <Field label="Saklanacak yedek" hint="Fazlası en eskiden silinir.">
              <input type="number" min={1} max={365} className={inputCls} value={draft.keep} onChange={(e) => setDraft((d) => ({ ...d, keep: e.target.value }))} />
            </Field>
          </div>

          <Banner tone="info">
            Yeni yedekler veritabanını, işlem görsellerini, Electron ekran görüntülerini ve haber değerlendirmelerini içerir. Şifreleme anahtarı (secret.key) <b>dahil edilmez</b>:
            yedek klasörü paylaşılırsa anahtar açığa çıkmamalıdır. Bu yedek aynı anahtarla geri yüklenir.
            Başka bilgisayara taşınırken uygulama kapalıyken data klasörünün tamamını, anahtarı koruyarak ayrıca kopyalayın.
          </Banner>

          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-bg-input/40 border-b border-border">
              <span className="text-xs font-semibold text-text-primary">Yedekler ({backups.length})</span>
              <span className="text-[11px] text-text-tertiary">{fmtBytes(backups.reduce((s, b) => s + b.sizeBytes, 0))}</span>
            </div>
            {backups.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-tertiary">Henüz yedek alınmadı.</div>
            ) : (
              <ul className="divide-y divide-border max-h-72 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {backups.map((b) => (
                    <motion.li
                      key={b.name}
                      layout={animate}
                      initial={animate ? { opacity: 0, y: -6 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      exit={animate ? { opacity: 0, x: 12 } : { opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <Icon.Folder width={16} height={16} className="text-text-tertiary flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-text-primary font-mono truncate">{b.name}</div>
                        <div className="text-[11px] text-text-tertiary">
                          {fmtDateTime(b.createdAt)} · {fmtBytes(b.sizeBytes)}{b.auto ? ' · otomatik' : ''}
                          {b.counts && typeof b.counts.tasks === 'number' ? ` · ${b.counts.tasks} görev` : ''}
                          {b.counts && typeof b.counts.trades === 'number' ? ` · ${b.counts.trades} işlem` : ''}
                          {typeof b.screenshotCount === 'number' ? ` · ${b.screenshotCount} işlem görseli` : ' · eski DB yedeği'}
                          {typeof b.captureScreenshotCount === 'number'
                            ? ` · ${b.captureScreenshotCount} ekran görüntüsü`
                            : (typeof b.screenshotCount === 'number' ? ' · önceki kapsam, kısayol görüntüleri yok' : '')}
                          {typeof b.evaluationCount === 'number' ? ` · ${b.evaluationCount} haber değerlendirmesi` : ''}
                          {b.keyMatches === null ? ' · anahtar doğrulanamıyor' : ''}
                        </div>
                        {b.keyMatches === false && <div className="text-[11px] text-negative">Şifreleme anahtarı bu yedekle uyuşmuyor.</div>}
                      </div>
                      {confirmDel === b.name ? (
                        <div className="flex items-center gap-1">
                          <Button variant="danger" onClick={() => remove(b.name)} className="px-2.5 py-1 text-xs">Sil</Button>
                          <Button variant="ghost" onClick={() => setConfirmDel(null)} className="px-2.5 py-1 text-xs">Vazgeç</Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDel(b.name)}
                          className="w-8 h-8 rounded-md flex items-center justify-center text-text-tertiary hover:text-negative hover:bg-negative/10"
                          aria-label={`${b.name} yedeğini sil`}
                        >
                          <Icon.Trash width={15} height={15} />
                        </button>
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>

          <div className="rounded-xl bg-bg-input/50 border border-border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-text-primary">Geri yükleme (elle)</div>
              <Button variant="ghost" onClick={() => setShowPath((v) => !v)} className="px-2.5 py-1 text-xs">
                <Icon.Folder width={14} height={14} />
                {showPath ? 'Klasör yolunu gizle' : 'Klasör yolunu göster'}
              </Button>
            </div>
            {showPath && data && (
              <div className="space-y-2">
                <div className="text-[11px] text-text-tertiary">Yedek klasörü:</div>
                <CopyBox value={data.folder} />
                <div className="text-[11px] text-text-tertiary">Data klasörü (geri yükleme hedefi):</div>
                <CopyBox value={data.dataDir} />
                <div className="text-[11px] text-text-tertiary">Ekran görüntüsü klasörü (geri yükleme hedefi):</div>
                <CopyBox value={data.captureDir} />
              </div>
            )}
            <Steps items={[
              'Uygulamayı tamamen kapatın (sistem tepsisinden de çıkın).',
              'İşleme başlamadan önce mevcut data klasörünün tamamını güvenli bir yere kopyalayın.',
              `Data klasöründeki mevcut ${data ? data.dbFile : '.db'} dosyasını ve yanındaki -wal / -shm dosyalarını ayrı bir yere taşıyın.`,
              `Geri dönmek istediğiniz yedek klasöründeki ${data ? data.dbFile : '.db'} dosyasını data klasörüne kopyalayın${data ? ` (ör. …${sep}${data.dbFile})` : ''}.`,
              'Yedekte screenshots klasörü varsa içindeki işlem görsellerini data/screenshots klasörüne kopyalayın. Mevcut görselleri silmeyin.',
              `Yedekte ekran-goruntuleri klasörü varsa dosyaları ${data ? data.captureDir : 'ekran-goruntuleri'} klasörüne kopyalayın. Mevcut ekran görüntülerini silmeyin.`,
              'Yedekte news-eval klasörü varsa içindeki haber değerlendirmelerini data/news-eval klasörüne kopyalayın. Mevcut dosyaları silmeyin.',
              'secret.key dosyası aynı data klasöründe kalmalı. Anahtar uyuşmuyor uyarısı varsa şifreli bağlantılar çözülemez; eski yedeği zorlamayın.',
              'Uygulamayı yeniden açıp işlemleri ve ekran görüntülerini kontrol edin.',
            ]} />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={run} disabled={running || (data && data.running)}>
              {running ? 'Yedekleniyor…' : 'Şimdi yedekle'}
            </Button>
            <SaveButton onSave={save} />
          </div>
        </>
      )}
    </SectionCard>
  );
};

module.exports = BackupSection;
