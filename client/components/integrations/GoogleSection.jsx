// =====================================================
// GOOGLE CLASSROOM + TAKVİM (Bağlantılar sayfasındaki kart)
// API: GET /api/google/status, PUT /api/google/credentials, PUT /api/google/settings,
//      POST /api/google/connect, POST /api/google/disconnect, POST /api/google/sync,
//      GET /api/google/calendar?days=14, POST /api/google/calendar/to-task
// Kendi state'i ve API çağrıları olan, bağımsız bir kart.
// =====================================================
const React = require('react');
const { useState, useEffect, useRef, useCallback, useMemo } = React;
const helper = require('../../helper.js');
const { authFetch } = helper;
const { FadeIn, Stagger, StaggerItem, CountUp } = require('../ui/motion');
const { useSound } = require('../../utils/sound');

const POLL_MS = 2000;
const POLL_MAX_MS = 5 * 60 * 1000;
const CAL_DAYS = 14;

/* ── Helpers ─────────────────────────────────────────────── */

const fetchJson = async (url, options) => {
  const res = await authFetch(url, options);
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `İstek başarısız (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
};
const sendJson = (url, method, body) => fetchJson(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

const fmtRelative = (iso) => {
  if (!iso) return 'henüz yok';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const diff = Math.round((Date.now() - t) / 1000);
  if (diff < 45) return 'az önce';
  if (diff < 3600) return `${Math.round(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.round(diff / 3600)} sa önce`;
  return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const dayLabel = (key) => {
  const today = new Date();
  const tk = dateKey(today);
  const tomorrow = dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const base = parseKey(key).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (key === tk) return `Bugün · ${base}`;
  if (key === tomorrow) return `Yarın · ${base}`;
  return base;
};

/* ── Icons ───────────────────────────────────────────────── */

const svgProps = (props) => ({
  width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props,
});
const RefreshIcon = (p) => (<svg {...svgProps(p)}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>);
const LinkIcon = (p) => (<svg {...svgProps(p)}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>);
const CalIcon = (p) => (<svg {...svgProps(p)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>);
const ShieldIcon = (p) => (<svg {...svgProps(p)}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>);
const PinIcon = (p) => (<svg {...svgProps(p)}><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>);
const ExtIcon = (p) => (<svg {...svgProps(p)}><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>);

const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/* ── Small primitives ────────────────────────────────────── */

const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-text hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition';
const btnSecondary = 'inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary bg-bg-input border border-border disabled:opacity-50 transition';
const btnDanger = 'inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-sm text-negative hover:bg-negative/10 border border-negative/30 disabled:opacity-50 transition';
const inputCls = 'w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/70';

const Toggle = ({ checked, onChange, disabled, label, hint }) => (
  <label className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <span className="min-w-0">
      <span className="block text-sm text-text-primary">{label}</span>
      {hint && <span className="block text-xs text-text-tertiary mt-0.5">{hint}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-input border border-border'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  </label>
);

const ErrorBox = ({ children }) => (
  <div role="alert" className="flex items-start gap-2 bg-negative/10 border border-negative/30 rounded-lg px-3 py-2 text-negative text-xs leading-relaxed">
    <span className="font-bold">!</span><span>{children}</span>
  </div>
);

const Spinner = () => (
  <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />
);

const PrivacyNote = () => (
  <div className="flex items-start gap-2.5 bg-bg-input/50 border border-border rounded-xl px-3.5 py-3 text-xs text-text-secondary leading-relaxed">
    <ShieldIcon className="flex-shrink-0 mt-0.5 text-positive" />
    <span>
      Gizlilik: Yalnızca <b className="text-text-primary">okuma</b> izni istenir (Classroom kursları, ödevleri, kendi teslimleriniz ve takvim).
      Uygulama Google'da hiçbir şeyi değiştirmez. İstemci gizli anahtarı ve jetonlar <b className="text-text-primary">şifrelenmiş</b> olarak
      yalnızca <b className="text-text-primary">bu bilgisayarda</b> saklanır; hiçbir sunucuya gönderilmez.
    </span>
  </div>
);

/* ── Setup guide + credentials form ─────────────────────── */

const SETUP_STEPS = [
  <>
    <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer" className="text-accent hover:underline">console.cloud.google.com</a>
    {' '}adresinde kendi Google hesabınızla yeni bir proje oluşturun (ör. "Yaşam OS").
  </>,
  <>
    <b>API'ler ve Hizmetler → Kitaplık</b> bölümünden <b>Google Classroom API</b> ve <b>Google Calendar API</b>'yi bulup ikisini de <b>Etkinleştir</b>in.
  </>,
  <>
    <b>OAuth izin ekranı</b>'nı yapılandırın: kullanıcı türü <b>Harici (External)</b>, yayın durumu <b>Test (Testing)</b> kalsın.
    <b> Test kullanıcıları</b> listesine kendi e-posta adresinizi ekleyin.
  </>,
  <>
    <b>Kimlik Bilgileri → Kimlik bilgisi oluştur → OAuth istemci kimliği</b> seçin; uygulama türü olarak <b>Masaüstü uygulaması (Desktop app)</b>'nı seçin.
    Masaüstü istemcilerinde <code className="text-text-primary">http://127.0.0.1</code> yönlendirmesine otomatik izin verilir, ayrıca yönlendirme adresi girmeniz gerekmez.
  </>,
  <>Oluşan <b>İstemci kimliği</b> ve <b>İstemci gizli anahtarı</b>'nı kopyalayıp aşağıya yapıştırın ve kaydedin.</>,
  <><b>Bağlan</b>'a basın, açılan Google sayfasında hesabınızı seçip izinleri onaylayın. "Google bu uygulamayı doğrulamadı" uyarısında <b>Devam</b>'ı seçebilirsiniz (uygulama sizin kendi projeniz).</>,
];

const SetupGuide = ({ defaultOpen }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-bg-input/50"
      >
        <span>Kurulum adımları (bir kez, ~5 dakika)</span>
        <span className={`text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <FadeIn y={4} className="px-4 pb-4">
          <ol className="space-y-2.5">
            {SETUP_STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-text-secondary leading-relaxed">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
        </FadeIn>
      )}
    </div>
  );
};

const CredentialsForm = ({ hasExisting, clientIdHint, onSaved, onCancel }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { play } = useSound();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const id = clientId.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) {
      setError('İstemci kimliği "...apps.googleusercontent.com" ile bitmeli.');
      return;
    }
    if (!clientSecret.trim()) { setError('Gizli anahtarı girin.'); return; }
    setBusy(true);
    try {
      await sendJson('/api/google/credentials', 'PUT', { clientId: id, clientSecret: clientSecret.trim() });
      play('pop');
      setClientSecret('');
      onSaved && onSaved();
    } catch (err) {
      play('error');
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" autoComplete="off">
      <div>
        <label htmlFor="g-client-id" className="block text-xs font-medium text-text-secondary mb-1">İstemci kimliği (Client ID)</label>
        <input id="g-client-id" className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}
          placeholder={clientIdHint || '1234567890-xxxx.apps.googleusercontent.com'} spellCheck={false} />
      </div>
      <div>
        <label htmlFor="g-client-secret" className="block text-xs font-medium text-text-secondary mb-1">İstemci gizli anahtarı (Client secret)</label>
        <input id="g-client-secret" type="password" className={inputCls} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
          placeholder="GOCSPX-…" spellCheck={false} autoComplete="new-password" />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>{busy && <Spinner />}Kaydet</button>
        {hasExisting && onCancel && <button type="button" className={btnSecondary} onClick={onCancel}>Vazgeç</button>}
      </div>
    </form>
  );
};

/* ── Sync summary ────────────────────────────────────────── */

const Stat = ({ label, value, tone }) => (
  <div className="bg-bg-input/50 border border-border rounded-xl px-3 py-2.5">
    <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</div>
    <div className={`text-lg font-semibold tabular-nums ${tone || 'text-text-primary'}`}>
      <CountUp value={Number(value) || 0} duration={500} format={(n) => String(Math.round(n))} />
    </div>
  </div>
);

const SyncSummary = ({ summary }) => {
  if (!summary) return <p className="text-xs text-text-tertiary">Henüz eşitleme yapılmadı.</p>;
  return (
    <div className="space-y-2">
      <Stagger stagger={0.04} className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StaggerItem><Stat label="Kurs" value={summary.courses} /></StaggerItem>
        <StaggerItem><Stat label="Ödev" value={summary.assignments} /></StaggerItem>
        <StaggerItem><Stat label="Yeni" value={summary.created} tone="text-accent" /></StaggerItem>
        <StaggerItem><Stat label="Güncellenen" value={summary.updated} /></StaggerItem>
        <StaggerItem><Stat label="Tamamlanan" value={summary.completed} tone="text-positive" /></StaggerItem>
        <StaggerItem><Stat label="Hata" value={(summary.errors || []).length} tone={(summary.errors || []).length ? 'text-negative' : 'text-text-primary'} /></StaggerItem>
      </Stagger>
      {(summary.errors || []).length > 0 && (
        <ul className="space-y-1">
          {[...new Set(summary.errors)].slice(0, 5).map((e, i) => (
            <li key={i} className="text-xs text-negative/90">• {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ── Calendar list ───────────────────────────────────────── */

const CalendarList = ({ connected }) => {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const { play } = useSound();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchJson(`/api/google/calendar?days=${CAL_DAYS}`);
      setEvents(data.events || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (connected) load(); }, [connected, load]);

  const toTask = async (ev) => {
    setBusyId(ev.id);
    try {
      const r = await sendJson('/api/google/calendar/to-task', 'POST', { eventId: ev.id });
      play(r.existing ? 'click' : 'pop');
      setEvents((list) => (list || []).map((e) => (e.id === ev.id ? { ...e, taskId: r.task.id } : e)));
    } catch (err) {
      play('error');
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const groups = useMemo(() => {
    const m = new Map();
    for (const e of events || []) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date).push(e);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [events]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <CalIcon className="text-text-secondary" /> Yaklaşan etkinlikler <span className="text-xs font-normal text-text-tertiary">({CAL_DAYS} gün)</span>
        </div>
        <button type="button" onClick={load} disabled={loading} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-input disabled:opacity-50" aria-label="Takvimi yenile">
          <RefreshIcon className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {events === null && loading && <p className="text-xs text-text-tertiary">Takvim yükleniyor…</p>}
      {events && events.length === 0 && !loading && <p className="text-xs text-text-tertiary">Önümüzdeki {CAL_DAYS} günde etkinlik yok.</p>}
      {groups.length > 0 && (
        <Stagger stagger={0.03} className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {groups.map(([day, list]) => (
            <StaggerItem key={day}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">{dayLabel(day)}</div>
              <ul className="space-y-1.5">
                {list.map((ev) => (
                  <li key={ev.id} className="flex items-center gap-3 bg-bg-input/40 border border-border rounded-xl px-3 py-2">
                    <div className="w-14 flex-shrink-0 text-xs tabular-nums text-text-secondary">
                      {ev.allDay ? 'Tüm gün' : ev.startTime}
                      {!ev.allDay && ev.endTime && <div className="text-text-tertiary">{ev.endTime}</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-primary truncate" title={ev.title}>{ev.title}</div>
                      {ev.location && (
                        <div className="flex items-center gap-1 text-xs text-text-tertiary truncate"><PinIcon width={12} height={12} />{ev.location}</div>
                      )}
                    </div>
                    {ev.htmlLink && (
                      <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-input" aria-label="Google Takvim'de aç">
                        <ExtIcon width={14} height={14} />
                      </a>
                    )}
                    {ev.taskId ? (
                      <span className="text-xs text-positive whitespace-nowrap">✓ Görev</span>
                    ) : (
                      <button type="button" onClick={() => toTask(ev)} disabled={busyId === ev.id}
                        className="text-xs px-2.5 py-1.5 rounded-md bg-accent/15 text-accent hover:bg-accent/25 whitespace-nowrap disabled:opacity-50">
                        {busyId === ev.id ? <Spinner /> : 'Göreve çevir'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
};

/* ── Main card ───────────────────────────────────────────── */

const GoogleSection = () => {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editCreds, setEditCreds] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [connectError, setConnectError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef(null);
  const { play } = useSound();

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchJson('/api/google/status');
      setStatus(s);
      setLoadError('');
      return s;
    } catch (err) {
      setLoadError(err.message);
      return null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => { loadStatus(); return stopPolling; }, [loadStatus, stopPolling]);

  // The callback page posts a message to its opener (best effort).
  useEffect(() => {
    const onMsg = (e) => { if (e && e.data && e.data.type === 'google-oauth') loadStatus(); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [loadStatus]);

  // Stop polling once connected.
  useEffect(() => {
    if (status && status.connected && connecting) {
      stopPolling();
      setConnecting(false);
      setAuthUrl('');
      play('complete');
    }
  }, [status, connecting, stopPolling, play]);

  const connect = async () => {
    setConnectError('');
    try {
      const { authUrl: url } = await sendJson('/api/google/connect', 'POST');
      setAuthUrl(url);
      setConnecting(true);
      const w = window.open(url, '_blank', 'width=520,height=680');
      if (!w) setConnectError('Pencere açılamadı (açılır pencere engellendi). Aşağıdaki bağlantıyı tarayıcıda açın.');
      stopPolling();
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - started > POLL_MAX_MS) {
          stopPolling();
          setConnecting(false);
          setConnectError('Bağlantı zaman aşımına uğradı. Tekrar "Bağlan"a basın.');
          return;
        }
        await loadStatus();
      }, POLL_MS);
    } catch (err) {
      play('error');
      setConnectError(err.message);
    }
  };

  const cancelConnect = () => { stopPolling(); setConnecting(false); setAuthUrl(''); };

  const syncNow = async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const summary = await sendJson('/api/google/sync', 'POST');
      if (summary && summary.errors && summary.errors.length && !summary.courses) play('error');
      else play(summary && (summary.created || summary.completed) ? 'complete' : 'click');
    } catch (err) {
      play('error');
      setSyncError(err.message);
    } finally {
      setSyncing(false);
      loadStatus();
    }
  };

  const setSetting = async (key, value) => {
    setStatus((s) => (s ? { ...s, [key]: value } : s));
    play(value ? 'toggle-on' : 'toggle-off');
    try {
      await sendJson('/api/google/settings', 'PUT', { [key]: value });
    } catch (err) {
      setSyncError(err.message);
      loadStatus();
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await sendJson('/api/google/disconnect', 'POST');
      play('delete');
      setConfirmDisconnect(false);
    } catch (err) {
      play('error');
      setSyncError(err.message);
    } finally {
      setDisconnecting(false);
      loadStatus();
    }
  };

  const configured = !!(status && status.configured);
  const connected = !!(status && status.connected);

  let badge = { text: 'Kurulmadı', cls: 'bg-bg-input text-text-tertiary border-border' };
  if (connected) badge = { text: 'Bağlı', cls: 'bg-positive/10 text-positive border-positive/30' };
  else if (configured) badge = { text: 'Bağlı değil', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };

  return (
    <FadeIn className="bg-bg-surface border border-border rounded-2xl p-5 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white/95 flex items-center justify-center flex-shrink-0"><GoogleLogo /></div>
          <div className="min-w-0">
            <h3 className="text-text-primary font-semibold text-[15px] leading-tight">Google Classroom ve Takvim</h3>
            <p className="text-text-tertiary text-xs mt-0.5">Ödevler otomatik olarak "Okul" projesine görev olarak eklenir.</p>
          </div>
        </div>
        {status && <span className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${badge.cls}`}>{badge.text}</span>}
      </div>

      {loadError && <ErrorBox>{loadError}</ErrorBox>}
      {!status && !loadError && <p className="text-xs text-text-tertiary">Yükleniyor…</p>}

      {/* State 1: not configured (or editing credentials) */}
      {status && (!configured || (editCreds && !connected)) && (
        <div className="space-y-4">
          <SetupGuide defaultOpen={!configured} />
          <CredentialsForm
            hasExisting={configured}
            clientIdHint={status.clientIdHint}
            onSaved={() => { setEditCreds(false); loadStatus(); }}
            onCancel={() => setEditCreds(false)}
          />
          <PrivacyNote />
        </div>
      )}

      {/* State 2: configured, not connected */}
      {status && configured && !connected && !editCreds && (
        <div className="space-y-4">
          {status.lastError && <ErrorBox>{status.lastError}</ErrorBox>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} onClick={connect} disabled={connecting}>
              {connecting ? <Spinner /> : <LinkIcon />}
              {connecting ? 'Google onayı bekleniyor…' : 'Bağlan'}
            </button>
            {connecting && <button type="button" className={btnSecondary} onClick={cancelConnect}>İptal</button>}
            {!connecting && <button type="button" className={btnSecondary} onClick={() => setEditCreds(true)}>İstemci bilgilerini değiştir</button>}
          </div>
          {connectError && <ErrorBox>{connectError}</ErrorBox>}
          {connecting && authUrl && (
            <p className="text-xs text-text-tertiary leading-relaxed">
              Google sayfası açılmadıysa <a href={authUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">bu bağlantıyı</a> tarayıcınızda açın.
              Onayladıktan sonra bu kart kendiliğinden güncellenir.
            </p>
          )}
          <p className="text-xs text-text-tertiary">
            İstemci: <span className="text-text-secondary">{status.clientIdHint}</span> · Yönlendirme: <code className="text-text-secondary">{status.redirectUri}</code>
          </p>
          <SetupGuide defaultOpen={false} />
          <PrivacyNote />
        </div>
      )}

      {/* State 3: connected */}
      {status && connected && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="text-text-primary font-medium">{status.email || 'Google hesabı'}</div>
              <div className="text-xs text-text-tertiary">Son eşitleme: {fmtRelative(status.lastSyncAt)}</div>
            </div>
            <button type="button" className={btnPrimary} onClick={syncNow} disabled={syncing}>
              {syncing ? <Spinner /> : <RefreshIcon />}
              {syncing ? 'Eşitleniyor…' : 'Şimdi eşitle'}
            </button>
          </div>

          {syncError && <ErrorBox>{syncError}</ErrorBox>}
          {status.lastError && !syncError && <ErrorBox>{status.lastError}</ErrorBox>}

          <SyncSummary summary={status.lastSummary} />

          <div className="space-y-3 border-t border-border pt-4">
            <Toggle
              checked={status.autoSync}
              onChange={(v) => setSetting('autoSync', v)}
              label="Otomatik eşitle"
              hint="Uygulama açıkken her 30 dakikada bir Classroom ödevlerini kontrol eder."
            />
            <Toggle
              checked={status.includeUndated}
              onChange={(v) => setSetting('includeUndated', v)}
              label="Teslim tarihi olmayan ödevleri de ekle"
              hint="Tarihsiz, henüz teslim edilmemiş ödevler tarihsiz görev olarak eklenir."
            />
          </div>

          <div className="border-t border-border pt-4">
            <CalendarList connected={connected} />
          </div>

          <div className="border-t border-border pt-4 flex flex-wrap items-center gap-2">
            {!confirmDisconnect ? (
              <button type="button" className={btnDanger} onClick={() => setConfirmDisconnect(true)}>Bağlantıyı kes</button>
            ) : (
              <FadeIn y={4} className="w-full space-y-2">
                <p className="text-sm text-text-secondary">
                  Google erişimi iptal edilecek ve jetonlar bu bilgisayardan silinecek. Oluşturulan görevler silinmez. Emin misiniz?
                </p>
                <div className="flex gap-2">
                  <button type="button" className={btnDanger} onClick={disconnect} disabled={disconnecting}>
                    {disconnecting && <Spinner />}Evet, bağlantıyı kes
                  </button>
                  <button type="button" className={btnSecondary} onClick={() => setConfirmDisconnect(false)}>Vazgeç</button>
                </div>
              </FadeIn>
            )}
          </div>
          <PrivacyNote />
        </div>
      )}
    </FadeIn>
  );
};

module.exports = GoogleSection;
