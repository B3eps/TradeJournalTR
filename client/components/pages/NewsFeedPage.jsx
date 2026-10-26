const React = require('react');
const { useState, useEffect, useMemo, useRef } = React;
const helper = require('../../helper.js');
const { authFetch } = helper;
const Icons = require('../shared/Icons');
const newsNotify = require('../../utils/newsNotify');
const navigation = require('../../utils/navigation');

// =====================================================
// LIVE NEWS FEED PAGE ("Canlı Haberler")
// Data: GET /api/newsfeed (polled), POST /api/newsfeed/refresh, GET /api/newsfeed/ask/:id
// =====================================================

const POLL_MS = 20 * 1000;
const PREFS_KEY = 'newsfeed-prefs';
const CRITICAL_WINDOW_MS = 60 * 60 * 1000;
const DISCLAIMER = 'Bilgi amaçlıdır, yatırım tavsiyesi değildir. Karar kendi planınıza göre sizindir.';

const TABS = [
  { id: 'all', label: 'Tümü' },
  { id: 'xau', label: 'Altın · XAU' },
  { id: 'xag', label: 'Gümüş · XAG' },
  { id: 'forex', label: 'Forex' },
  { id: 'nasdaq', label: 'Nasdaq' },
  { id: 'crypto', label: 'Coin' },
];
const CATEGORY_LABEL = { forex: 'Forex', nasdaq: 'Nasdaq', crypto: 'Coin', metals: 'Değerli metaller' };

const IMPORTANCE_FILTERS = [
  { id: 0, label: 'Tümü' },
  { id: 2, label: 'Önemli' },
  { id: 3, label: 'Kritik' },
];

const IMPORTANCE_STYLE = {
  3: { label: 'Kritik', badge: 'bg-negative/15 text-negative border-negative/30', dot: 'bg-negative', border: 'border-negative/40' },
  2: { label: 'Önemli', badge: 'bg-warning/15 text-warning border-warning/30', dot: 'bg-warning', border: 'border-warning/30' },
  1: { label: 'Normal', badge: 'bg-bg-input text-text-tertiary border-border', dot: 'bg-text-muted', border: 'border-border' },
  0: { label: 'Normal', badge: 'bg-bg-input text-text-tertiary border-border', dot: 'bg-text-muted', border: 'border-border' },
};

// Neutral styling on purpose: the words are information, not a buy/sell signal.
const NEUTRAL_CHIP = 'bg-bg-input text-text-secondary border-border';
const VOL_STYLE = {
  'düşük': 'bg-bg-input text-text-secondary border-border',
  'orta': 'bg-info/15 text-info border-info/30',
  'yüksek': 'bg-warning/15 text-warning border-warning/30',
};

const loadPrefs = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p && typeof p === 'object') {
      return {
        tab: TABS.some(t => t.id === p.tab) ? p.tab : 'all',
        minImportance: [0, 2, 3].includes(p.minImportance) ? p.minImportance : 0,
      };
    }
  } catch {}
  return { tab: 'all', minImportance: 0 };
};
const savePrefs = (prefs) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
};

const formatTime = (date) => date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const formatFull = (date) => date.toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const relativeTime = (ts, now) => {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'az önce';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
};

const copyText = async (text) => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

const openExternal = (url) => {
  if (!url) return;
  try { window.open(url, '_blank', 'noopener'); } catch {}
};

const Chip = ({ children, className = '', title }) => (
  <span title={title} className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${className}`}>{children}</span>
);

// ---------- Evaluation panel ----------
const EvaluationBlock = ({ ev }) => {
  const etkilenen = Array.isArray(ev.etkilenen) ? ev.etkilenen : [];
  const senaryolar = Array.isArray(ev.senaryolar) ? ev.senaryolar : [];
  const izlenecekler = Array.isArray(ev.izlenecekler) ? ev.izlenecekler : [];
  const evDate = ev.evaluatedAt ? new Date(ev.evaluatedAt) : null;
  const evDateValid = evDate && !isNaN(evDate.getTime());

  return (
    <div className="mt-3 bg-bg-input border border-border rounded-lg p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-text-tertiary text-xs font-semibold uppercase tracking-wider">Haber değerlendirmesi</span>
        <div className="flex items-center gap-2 flex-wrap">
          {ev.onem != null && <Chip className={NEUTRAL_CHIP}>Önem: {ev.onem}/5</Chip>}
          {ev.volatilite_riski && (
            <Chip className={VOL_STYLE[ev.volatilite_riski] || NEUTRAL_CHIP}>Volatilite riski: {ev.volatilite_riski}</Chip>
          )}
        </div>
      </div>

      {ev.ozet && <p className="text-text-primary">{ev.ozet}</p>}

      {etkilenen.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 text-left text-text-tertiary font-medium">Enstrüman</th>
                <th className="py-1.5 pr-3 text-left text-text-tertiary font-medium">Etki</th>
                <th className="py-1.5 text-left text-text-tertiary font-medium">Neden</th>
              </tr>
            </thead>
            <tbody>
              {etkilenen.map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-b-0 align-top">
                  <td className="py-1.5 pr-3 font-mono font-semibold text-text-primary whitespace-nowrap">{row.enstruman}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <Chip className="bg-info/10 text-info border-info/20">{row.etki || 'belirsiz'}</Chip>
                  </td>
                  <td className="py-1.5 text-text-secondary">{row.neden}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {senaryolar.length > 0 && (
        <div className="space-y-1">
          <p className="text-text-tertiary text-xs font-medium">Senaryolar</p>
          {senaryolar.map((s, i) => (
            <p key={i} className="text-text-secondary text-xs">
              <span className="text-text-primary font-medium">Eğer {s.eger}</span> → {s.o_zaman}
            </p>
          ))}
        </div>
      )}

      {izlenecekler.length > 0 && (
        <div>
          <p className="text-text-tertiary text-xs font-medium mb-1">İzlenecekler</p>
          <ul className="list-disc pl-5 space-y-0.5 text-text-secondary text-xs">
            {izlenecekler.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}

      {ev.uyari && (
        <div className="flex items-start gap-2 bg-bg-surface border border-border rounded-md px-3 py-2 text-xs text-text-tertiary">
          <Icons.AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{ev.uyari}</span>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-text-muted">
        <span>
          {ev.guven ? `Güven: ${ev.guven}` : ''}
          {ev.guven && evDateValid ? ' · ' : ''}
          {evDateValid ? `Değerlendirme: ${formatFull(evDate)}` : ''}
        </span>
      </div>
      <p className="text-[11px] text-text-muted italic">{DISCLAIMER}</p>
    </div>
  );
};

// ---------- Item card ----------
const NewsCard = ({ item, now, isNew, copiedId, askingId, evaluatingId, onAsk, onEvaluate, onImportEvaluation }) => {
  const [expanded, setExpanded] = useState(false);
  const [evaluationText, setEvaluationText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const imp = IMPORTANCE_STYLE[item.importance] || IMPORTANCE_STYLE[0];
  const ts = new Date(item.publishedAt).getTime();
  const tsValid = !isNaN(ts);
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const instruments = Array.isArray(item.instruments) ? item.instruments : [];
  const hasSummary = !!item.summary;
  const longSummary = hasSummary && item.summary.length > 140;
  const metalRelated = /\b(xau|xag|gold|silver|precious metals?)\b/i.test([...instruments, ...tags, item.title, item.summary].join(' '));

  return (
    <article
      id={`news-item-${item.id}`}
      tabIndex={-1}
      className={`bg-bg-surface border rounded-xl p-4 ${imp.border}`}
      aria-label={item.title}
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Chip className={`${imp.badge} font-semibold gap-1.5`}>
          <span className={`w-1.5 h-1.5 rounded-full ${imp.dot}`}></span>
          {imp.label}
        </Chip>
        <Chip className="bg-bg-input text-text-secondary border-border">{item.source}</Chip>
        <Chip className="bg-accent/10 text-accent border-accent/30">{CATEGORY_LABEL[item.category] || item.category}</Chip>
        {isNew && <Chip className="bg-info/15 text-info border-info/30 font-bold uppercase text-[10px]">Yeni</Chip>}
        <span
          className="ml-auto text-xs text-text-tertiary whitespace-nowrap"
          title={tsValid ? formatFull(new Date(ts)) : ''}
        >
          {tsValid ? relativeTime(ts, now) : ''}
        </span>
      </div>

      <h3 className="text-text-primary font-semibold leading-snug">
        {item.url ? (
          <a
            href={item.url}
            onClick={(e) => { e.preventDefault(); openExternal(item.url); }}
            className="hover:text-accent transition-colors no-underline text-text-primary"
            rel="noopener noreferrer"
          >
            {item.evaluation && item.evaluation.turkce_baslik ? item.evaluation.turkce_baslik : item.title}
          </a>
        ) : (item.evaluation && item.evaluation.turkce_baslik ? item.evaluation.turkce_baslik : item.title)}
      </h3>

      {item.evaluation && item.evaluation.turkce_baslik && (
        <p className="mt-1 text-xs text-text-muted">Orijinal başlık: {item.title}</p>
      )}

      {hasSummary && (
        <div className="mt-1.5">
          <p
            className="text-text-secondary text-sm"
            style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {item.summary}
          </p>
          {longSummary && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="text-xs text-accent hover:underline mt-1"
            >
              {expanded ? 'Daralt' : 'Devamını göster'}
            </button>
          )}
        </div>
      )}

      {(tags.length > 0 || instruments.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {instruments.map(ins => (
            <Chip key={`i-${ins}`} className="bg-bg-input text-text-primary border-border font-mono">{ins}</Chip>
          ))}
          {tags.map(tag => (
            <Chip key={`t-${tag}`} className="bg-bg-input text-text-tertiary border-border">{tag}</Chip>
          ))}
        </div>
      )}

      {item.evaluation && <EvaluationBlock ev={item.evaluation} />}

      {!item.evaluation && item.importance >= 2 && (
        <div className="mt-3 bg-bg-input border border-border rounded-lg px-3 py-2 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-text-secondary text-xs">
              {evaluatingId === item.id ? 'Kendi ChatGPT hesabınızla değerlendiriliyor…' : copiedId === item.id ? 'İstem panoya kopyalandı. ChatGPT yanıtını aşağıya yapıştırın.' : 'Yapay zeka değerlendirmesi bekleniyor…'}
            </span>
            <div className="flex flex-wrap gap-2">
              {metalRelated && typeof window !== 'undefined' && window.tradeGunluguDesktop && (
                <button
                  type="button"
                  onClick={() => onEvaluate(item)}
                  disabled={evaluatingId === item.id}
                  className="px-3 py-1 text-xs rounded-lg bg-accent text-accent-text hover:brightness-110 transition-colors disabled:opacity-60"
                >
                  {evaluatingId === item.id ? 'Değerlendiriliyor…' : 'ChatGPT ile değerlendir'}
                </button>
              )}
              <button
                type="button"
                onClick={() => onAsk(item)}
                disabled={askingId === item.id}
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
              >
                <Icons.Copy className="w-3.5 h-3.5" />
                {askingId === item.id ? 'Hazırlanıyor…' : 'İstemi kopyala'}
              </button>
            </div>
          </div>
          {!importOpen ? (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="text-xs text-accent hover:underline"
            >
              ChatGPT yanıtını içe aktar
            </button>
          ) : (
            <>
              <label className="block text-xs text-text-tertiary" htmlFor={`news-eval-${item.id}`}>ChatGPT JSON yanıtı</label>
              <textarea
                id={`news-eval-${item.id}`}
                value={evaluationText}
                onChange={(event) => setEvaluationText(event.target.value)}
                rows={4}
                maxLength={256 * 1024}
                placeholder="ChatGPT'nin JSON yanıtını buraya yapıştırın…"
                className="w-full rounded-lg bg-bg-surface border border-border p-2 text-xs text-text-primary font-mono"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {importError ? <span role="alert" className="text-warning text-xs">{importError}</span> : <span />}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setImportOpen(false)}
                    className="px-3 py-1 text-xs rounded-lg border border-border text-text-secondary"
                  >
                    Kapat
                  </button>
                  <button
                    type="button"
                    disabled={importing || !evaluationText.trim()}
                    onClick={async () => {
                      setImporting(true);
                      setImportError('');
                      const error = await onImportEvaluation(item, evaluationText);
                      if (error) setImportError(error);
                      else setEvaluationText('');
                      setImporting(false);
                    }}
                    className="px-3 py-1 text-xs rounded-lg bg-accent text-white disabled:opacity-50"
                  >
                    {importing ? 'İçe aktarılıyor…' : 'Değerlendirmeyi kaydet'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
};

// ---------- Page ----------
const NewsFeedPage = () => {
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState([]);
  const [pending, setPending] = useState(0);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copiedId, setCopiedId] = useState(null);
  const [askingId, setAskingId] = useState(null);
  const [evaluatingId, setEvaluatingId] = useState(null);
  const [askError, setAskError] = useState('');
  const [notify, setNotifyState] = useState(newsNotify.loadSettings);
  const [notifyMsg, setNotifyMsg] = useState('');
  const [targetId, setTargetId] = useState(null);

  const mountedRef = useRef(true);
  const baselineRef = useRef(null); // Set of ids present on first successful load
  const copiedTimer = useRef(null);

  const setPrefs = (next) => { setPrefsState(next); savePrefs(next); };

  const applyData = (data) => {
    const list = Array.isArray(data && data.items) ? data.items : [];
    if (baselineRef.current === null) baselineRef.current = new Set(list.map(i => i.id));
    setItems(list);
    setSources(Array.isArray(data.sources) ? data.sources : []);
    setPending(Number(data.pendingEvaluations) || 0);
    setFetchedAt(data.fetchedAt || null);
    setFetchError(false);
    newsNotify.processItems(list, { pageVisible: true });
  };

  const load = async (method) => {
    try {
      const url = method === 'POST' ? '/api/newsfeed/refresh' : '/api/newsfeed?category=all&minImportance=0&limit=300';
      const response = await authFetch(url, method === 'POST' ? { method: 'POST' } : undefined);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!mountedRef.current) return;
      applyData(data);
    } catch (err) {
      console.error('Failed to fetch news feed:', err);
      if (mountedRef.current) setFetchError(true);
    }
    if (mountedRef.current) setLoading(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    const pendingItem = navigation.consumePendingItem('newsfeed');
    if (pendingItem && pendingItem.itemId != null) {
      setPrefs({ tab: 'all', minImportance: 0 });
      setTargetId(String(pendingItem.itemId));
    }
    const onNavigate = (event) => {
      const detail = event && event.detail;
      if (!detail || detail.page !== 'newsfeed' || detail.itemId == null) return;
      navigation.consumePendingItem('newsfeed');
      setPrefs({ tab: 'all', minImportance: 0 });
      setTargetId(String(detail.itemId));
    };
    window.addEventListener(navigation.NAV_EVENT, onNavigate);
    load();
    const poll = setInterval(() => load(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(navigation.NAV_EVENT, onNavigate);
      clearInterval(poll);
      clearInterval(tick);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load('POST');
    if (mountedRef.current) { setRefreshing(false); setNow(Date.now()); }
  };

  const handleAsk = async (item) => {
    setAskingId(item.id);
    setAskError('');
    try {
      const response = await authFetch(`/api/newsfeed/ask/${encodeURIComponent(item.id)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const ok = await copyText(data && data.prompt ? data.prompt : '');
      if (!mountedRef.current) return;
      if (ok) {
        setCopiedId(item.id);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopiedId(null), 6000);
      } else {
        setAskError('Panoya kopyalanamadı.');
      }
    } catch (err) {
      console.error('Failed to build news evaluation prompt:', err);
      if (mountedRef.current) setAskError('İstem hazırlanamadı. Sunucu yanıt vermiyor.');
    }
    if (mountedRef.current) setAskingId(null);
  };

  const handleEvaluateWithChatGPT = async (item) => {
    const desktopApi = typeof window !== 'undefined' && window.tradeGunluguDesktop;
    if (!desktopApi || !desktopApi.chatgptNewsEvaluate) {
      setAskError('ChatGPT bağlantısı için masaüstü uygulamasını güncelleyin.');
      return;
    }
    setEvaluatingId(item.id);
    setAskError('');
    try {
      await desktopApi.chatgptNewsEvaluate(item.id);
      await load();
    } catch (err) {
      setAskError(err.message || 'ChatGPT haberi değerlendiremedi.');
    } finally {
      if (mountedRef.current) setEvaluatingId(null);
    }
  };

  const handleImportEvaluation = async (item, responseText) => {
    try {
      const response = await authFetch(`/api/newsfeed/evaluation/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: responseText,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const messages = {
          invalid_json: 'Yanıt JSON olarak okunamadı. Kod bloğu olmadan yalnızca JSON yapıştırın.',
          invalid_evaluation: 'Değerlendirme şeması veya haber kimliği eşleşmiyor. ChatGPT yanıtını kontrol edin.',
          not_found: 'Haber artık bulunamıyor. Haber akışını yenileyin.',
          payload_too_large: 'Yanıt çok büyük; lütfen yalnızca değerlendirme JSON’unu yapıştırın.',
          already_evaluated: 'Bu haber zaten değerlendirildi. Akışı yenileyin.',
        };
        return messages[data.error] || `Kayıt başarısız (HTTP ${response.status}).`;
      }
      await load();
      return '';
    } catch (err) {
      console.error('Failed to import news evaluation:', err);
      return 'Kayıt yapılamadı. Sunucu yanıt vermiyor.';
    }
  };

  // ---- notifications toggle ----
  const updateNotify = (next) => { setNotifyState(next); newsNotify.saveSettings(next); };
  const toggleNotify = async () => {
    setNotifyMsg('');
    if (notify.enabled) { updateNotify({ ...notify, enabled: false }); return; }
    const perm = await newsNotify.requestPermission();
    if (!mountedRef.current) return;
    if (perm === 'granted') {
      updateNotify({ ...notify, enabled: true });
    } else if (perm === 'unsupported') {
      setNotifyMsg('Bu ortamda bildirimler desteklenmiyor.');
    } else {
      setNotifyMsg('Bildirim izni verilmedi. Tarayıcı veya sistem ayarlarından izin verin.');
    }
  };

  // ---- derived data ----
  const visibleItems = useMemo(() => items.filter(it =>
    (prefs.tab === 'all' || (prefs.tab === 'xau' ? it.instruments?.includes('XAU') : prefs.tab === 'xag' ? it.instruments?.includes('XAG') : it.category === prefs.tab)) &&
    (Number(it.importance) || 0) >= prefs.minImportance
  ), [items, prefs]);

  useEffect(() => {
    if (!targetId || !visibleItems.some((item) => String(item.id) === targetId)) return undefined;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`news-item-${targetId}`);
      if (!element) return;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.focus({ preventScroll: true });
      setTargetId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [targetId, visibleItems]);

  const criticalItem = useMemo(() => items.find(it => {
    const ts = new Date(it.publishedAt).getTime();
    return it.importance === 3 && !isNaN(ts) && now - ts <= CRITICAL_WINDOW_MS;
  }), [items, now]);

  const jumpToItem = (id) => {
    const el = document.getElementById(`news-item-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try { el.focus({ preventScroll: true }); } catch {}
    }
  };

  const chipBase = 'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors';
  const chipOn = 'bg-accent/15 border-accent text-accent';
  const chipOff = 'bg-bg-input border-border text-text-secondary hover:text-text-primary';

  const criticalEval = criticalItem && criticalItem.evaluation;
  const criticalMin = criticalItem ? Math.floor((now - new Date(criticalItem.publishedAt).getTime()) / 60000) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Canlı Haberler</h1>
          <p className="text-text-secondary text-sm mt-1">
            Türkçe değerlendirmeli altın/gümüş ve küresel haber akışı · Her 20 saniyede yenilenir
            {pending > 0 ? ` · ${pending} haber değerlendirme bekliyor` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={toggleNotify}
            aria-pressed={notify.enabled}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              notify.enabled ? 'bg-accent/15 border-accent text-accent' : 'bg-bg-surface border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            Bildirimler: {notify.enabled ? 'Açık' : 'Kapalı'}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
          >
            <Icons.RefreshCw className={`w-3.5 h-3.5 ${refreshing || loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      <div className="bg-bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-secondary">
        İngilizce kaynak başlıkları korunur; değerlendirme geldiğinde Türkçe başlık, kısa özet ve XAU/XAG etkisi gösterilir.
        Otomatik Türkçe değerlendirme için Bağlantılar → ChatGPT haber analizi bölümünden kendi hesabınızı bağlayıp otomasyonu ayrıca açın.
      </div>

      {/* Notification options */}
      {(notify.enabled || notifyMsg) && (
        <div className="bg-bg-surface border border-border rounded-xl p-4 flex flex-wrap items-center gap-2">
          {notify.enabled && (
            <>
              <span className="text-text-tertiary text-xs font-medium w-24 flex-shrink-0">Bildirim seviyesi</span>
              {newsNotify.LEVELS.map(l => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => updateNotify({ ...notify, level: l.id })}
                  className={`${chipBase} ${notify.level === l.id ? chipOn : chipOff}`}
                >
                  {l.label}
                </button>
              ))}
            </>
          )}
          {notifyMsg && <span className="text-warning text-xs">{notifyMsg}</span>}
        </div>
      )}

      {/* Critical banner */}
      {criticalItem && (
        <div role="alert" className="flex items-start gap-2 bg-negative/10 border border-negative/30 rounded-lg px-4 py-2.5 text-negative text-sm">
          <Icons.AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <a
              href={`#news-item-${criticalItem.id}`}
              onClick={(e) => { e.preventDefault(); jumpToItem(criticalItem.id); }}
              className="text-negative font-medium no-underline hover:underline"
            >
              Kritik haber: {criticalItem.title} ({criticalMin} dk önce)
            </a>
            {criticalEval && criticalEval.haber_penceresi_dk != null && (
              <p className="text-xs mt-0.5 text-text-secondary">
                Haber penceresi: ~{criticalEval.haber_penceresi_dk} dk, planınızın haber kuralına bakın.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Fetch error */}
      {fetchError && (
        <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 text-warning text-sm">
          <Icons.AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {items.length > 0
            ? `Haberler güncellenemedi; son alınan veriler gösteriliyor${fetchedAt ? ` (${formatTime(new Date(fetchedAt))})` : ''}.`
            : 'Haberler alınamadı. Sunucu yanıt vermiyor.'}
        </div>
      )}

      {askError && (
        <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-2.5 text-warning text-sm">
          <Icons.AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {askError}
        </div>
      )}

      {/* Filters */}
      <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Kategori">
          <span className="text-text-tertiary text-xs font-medium w-24 flex-shrink-0">Kategori</span>
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={prefs.tab === t.id}
              onClick={() => setPrefs({ ...prefs, tab: t.id })}
              className={`${chipBase} ${prefs.tab === t.id ? chipOn : chipOff}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-tertiary text-xs font-medium w-24 flex-shrink-0">Önem</span>
          {IMPORTANCE_FILTERS.map(f => {
            const active = prefs.minImportance === f.id;
            const style = f.id === 3 ? IMPORTANCE_STYLE[3] : f.id === 2 ? IMPORTANCE_STYLE[2] : null;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPrefs({ ...prefs, minImportance: f.id })}
                className={`${chipBase} flex items-center gap-1.5 ${active ? (style ? style.badge : chipOn) : chipOff}`}
              >
                {style && <span className={`w-2 h-2 rounded-full ${active ? style.dot : 'bg-text-muted'}`}></span>}
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      {visibleItems.length === 0 ? (
        <div className="bg-bg-surface border border-border rounded-xl p-8 text-center">
          <Icons.Zap className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary text-sm">
            {loading
              ? 'Haberler yükleniyor...'
              : fetchError && items.length === 0
                ? 'Haberler alınamadı. Sunucu yanıt vermiyor.'
                : 'Seçili filtrelere uygun haber bulunamadı.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3" style={{ overflowAnchor: 'auto' }}>
          {visibleItems.map(item => (
            <NewsCard
              key={item.id}
              item={item}
              now={now}
              isNew={!!baselineRef.current && !baselineRef.current.has(item.id)}
              copiedId={copiedId}
              askingId={askingId}
              evaluatingId={evaluatingId}
              onAsk={handleAsk}
              onEvaluate={handleEvaluateWithChatGPT}
              onImportEvaluation={handleImportEvaluation}
            />
          ))}
        </div>
      )}

      {/* Source status */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <p className="text-text-tertiary text-xs font-semibold uppercase tracking-wider mb-2">Kaynak durumu</p>
        {sources.length === 0 ? (
          <p className="text-text-muted text-xs">Kaynak bilgisi yok.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {sources.map(s => {
              const last = s.lastFetchAt ? new Date(s.lastFetchAt) : null;
              const lastValid = last && !isNaN(last.getTime());
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-2 text-xs text-text-secondary min-w-0"
                  title={s.ok ? undefined : (s.error || 'Kaynak alınamadı')}
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${s.ok ? 'bg-positive' : 'bg-negative'}`}
                    role="img"
                    aria-label={s.ok ? 'Çalışıyor' : 'Hata'}
                  ></span>
                  <span className="text-text-primary font-medium truncate">{s.name}</span>
                  <span className="text-text-muted whitespace-nowrap">
                    {lastValid ? formatTime(last) : '—'} · {s.itemCount != null ? s.itemCount : 0} haber
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-text-muted text-xs">
        Haberler üçüncü taraf kaynaklardan derlenir ve gecikmeli olabilir{fetchedAt ? ` · Son güncelleme ${formatTime(new Date(fetchedAt))}` : ''}. {DISCLAIMER}
      </p>
    </div>
  );
};

module.exports = NewsFeedPage;
