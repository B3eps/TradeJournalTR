const React = require('react');
const { useState, useEffect, useCallback } = React;
const { authFetch } = require('../../helper.js');
const { TAG_COLOR_PRESETS } = require('../../utils/tagConstants');
const Icons = require('../shared/Icons');
const { useBrokerConnection, TRADOVATE_BROKERS, BROKER_CONFIGS } = require('../../hooks/useBrokerConnection');

// Helper: relative time string from ISO date
const relativeTime = (iso) => {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk önce`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} sa önce`;
  const days = Math.floor(hrs / 24);
  return `${days} gün önce`;
};

const TradovateBrokerSection = ({ hook, expandedBroker, toggleBroker, brokerHeaderBadge, statusDot }) => {
  const { config, label, connections, connectionsUsed, connectionLimit, canUseBrokerSync,
    atConnectionLimit, syncingId, showImportPrompt, environment, setEnvironment,
    connecting, selectedAcctIds, setSelectedAcctIds, savingAccounts, isTradovateGroup,
    handleConnect, handleSync, handleSyncAll, handleDisconnect,
    handleImportNow, toggleAcctSelection, handleEnableDisable,
    handleToggleEval } = hook;

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => toggleBroker(config.key)}
        className="w-full flex items-center justify-between p-5 hover:bg-bg-page/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <img src={config.icon} alt={label} className="w-10 h-10 rounded-lg object-contain" />
          <div className="text-left">
            <h3 className="text-text-primary font-semibold text-sm">{label}</h3>
            <p className="text-text-tertiary text-xs">{config.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {brokerHeaderBadge(connections)}
          {expandedBroker === config.key
            ? <Icons.ChevronUp className="w-4 h-4 text-text-secondary" />
            : <Icons.ChevronDown className="w-4 h-4 text-text-secondary" />}
        </div>
      </button>

      {expandedBroker === config.key && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
          {(
            <>
              {isTradovateGroup && connections.filter(c => c.configured && !c.expired).length >= 2 && (
                <button onClick={handleSyncAll} disabled={syncingId !== null} className="w-full px-4 py-2.5 bg-accent text-accent-text text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  <Icons.RefreshCw className={`w-4 h-4 ${syncingId === 'all' ? 'animate-spin' : ''}`} />
                  {syncingId === 'all' ? 'Tümü senkronize ediliyor...' : 'Tüm Bağlantıları Senkronize Et'}
                </button>
              )}

              {connections.map(conn => (
                <div key={conn.connectionId} className="bg-bg-page/50 border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot(conn)}`}></span>
                      <span className="text-sm text-text-primary font-medium">
                        {label} <span className="capitalize">{conn.environment === 'live' ? 'Canlı' : conn.environment}</span>
                      </span>
                      {conn.label && <span className="text-xs text-text-secondary">— {conn.label}</span>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      conn.configured && !conn.expired ? 'bg-positive/10 text-positive' :
                      conn.expired ? 'bg-warning/10 text-warning' : 'bg-text-secondary/10 text-text-secondary'
                    }`}>
                      {conn.configured && !conn.expired ? 'Aktif' : conn.expired ? 'Süresi Doldu' : 'Pasif'}
                    </span>
                  </div>

                  {conn.accounts && conn.accounts.length > 0 && conn.configured && !conn.expired && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-secondary">Hesaplar</span>
                        {conn.selectedAccounts && conn.selectedAccounts.length > 0 && conn.selectedAccounts.length < conn.accounts.length && (
                          <span className="text-xs text-text-muted">{conn.accounts.length} hesaptan {conn.selectedAccounts.length} tanesi etkin</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {conn.accounts.map(acct => {
                          const isEnabled = !conn.selectedAccounts || conn.selectedAccounts.length === 0 || conn.selectedAccounts.includes(acct.id);
                          const isSelected = selectedAcctIds.includes(acct.id);
                          return (
                            <button key={acct.id} onClick={() => toggleAcctSelection(acct.id)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border ${
                                isSelected ? 'bg-accent/15 border-accent text-accent ring-1 ring-accent/30'
                                  : isEnabled ? 'bg-bg-surface border-border text-text-primary hover:border-accent/50'
                                    : 'bg-bg-surface/30 border-border/50 text-text-muted hover:border-border'
                              }`}>
                              <span className={`w-2 h-2 rounded-full ${isEnabled ? (acct.active ? 'bg-positive' : 'bg-warning') : 'bg-text-muted/30'}`}></span>
                              {acct.name}
                              {acct.balance != null && (
                                <span className={`text-[10px] font-mono ${isEnabled ? 'text-text-secondary' : 'text-text-muted/60'}`}>
                                  ${acct.balance.toLocaleString('tr-TR',{ minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {selectedAcctIds.length > 0 && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleEnableDisable(conn.connectionId, true)} disabled={savingAccounts === conn.connectionId}
                            className="px-3 py-1.5 bg-positive/10 text-positive text-xs font-medium rounded-lg hover:bg-positive/20 transition-colors disabled:opacity-50">
                            {savingAccounts === conn.connectionId ? 'Kaydediliyor...' : `Etkinleştir (${selectedAcctIds.length})`}
                          </button>
                          <button onClick={() => handleEnableDisable(conn.connectionId, false)} disabled={savingAccounts === conn.connectionId}
                            className="px-3 py-1.5 bg-negative/10 text-negative text-xs font-medium rounded-lg hover:bg-negative/20 transition-colors disabled:opacity-50">
                            {savingAccounts === conn.connectionId ? 'Kaydediliyor...' : `Devre Dışı Bırak (${selectedAcctIds.length})`}
                          </button>
                          <button onClick={() => setSelectedAcctIds([])} className="px-2 py-1.5 text-text-muted text-xs hover:text-text-secondary transition-colors">Temizle</button>
                        </div>
                      )}
                    </div>
                  )}

                  {conn.lastSyncTime && <p className="text-xs text-text-muted">Son senkronizasyon: {relativeTime(conn.lastSyncTime)}</p>}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-secondary">Değerlendirme Hesabı</span>
                      <span className="text-[10px] text-text-muted">(senkronize edilen tüm işlemleri değerlendirme olarak işaretler)</span>
                    </div>
                    <button
                      onClick={() => handleToggleEval(conn.connectionId, !conn.isEval)}
                      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${conn.isEval ? 'bg-accent' : 'bg-border'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${conn.isEval ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>

                  {showImportPrompt === conn.connectionId && (
                    <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                      <p className="text-sm text-text-primary font-medium mb-1">İşlemleri içe aktar</p>
                      <p className="text-xs text-text-secondary mb-3">{label} hesabınızdaki tüm geçmiş işlemleri veya sadece bugünkü işlemleri içe aktarın.</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleImportNow(conn.connectionId, false)} disabled={syncingId !== null}
                          className="flex-1 px-3 py-2 bg-accent text-accent-text text-xs font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50">
                          {syncingId === conn.connectionId ? 'İçe aktarılıyor...' : 'Tüm işlemleri içe aktar'}
                        </button>
                        <button onClick={() => handleImportNow(conn.connectionId, true)} disabled={syncingId !== null}
                          className="flex-1 px-3 py-2 border border-border text-text-secondary text-xs font-medium rounded-lg hover:text-text-primary transition-colors disabled:opacity-50">
                          {syncingId === conn.connectionId ? 'İçe aktarılıyor...' : 'Bugünkü işlemler'}
                        </button>
                      </div>
                    </div>
                  )}

                  {showImportPrompt !== conn.connectionId && (
                    <div className="flex items-center gap-2">
                      {conn.expired ? (
                        <button onClick={handleConnect} disabled={connecting}
                          className="px-3 py-1.5 bg-warning/10 text-warning text-xs font-medium rounded-lg hover:bg-warning/20 transition-colors disabled:opacity-50">
                          {connecting ? 'Yeniden bağlanıyor...' : 'Yeniden Bağlan'}
                        </button>
                      ) : conn.configured ? (
                        <button onClick={() => handleSync(conn.connectionId)} disabled={syncingId !== null}
                          className="px-3 py-1.5 bg-accent text-accent-text text-xs font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50 flex items-center gap-1.5">
                          <Icons.RefreshCw className={`w-3.5 h-3.5 ${syncingId === conn.connectionId ? 'animate-spin' : ''}`} />
                          {syncingId === conn.connectionId ? 'Senkronize ediliyor...' : 'Şimdi Senkronize Et'}
                        </button>
                      ) : null}
                      <button onClick={() => handleDisconnect(conn.connectionId)}
                        className="px-3 py-1.5 text-text-secondary text-xs font-medium hover:text-negative hover:bg-negative/10 rounded-lg transition-colors">
                        Bağlantıyı Kes
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {connections.length === 0 ? (
                <>
                  <div className="bg-bg-page/50 rounded-lg p-3">
                    <p className="text-xs text-text-secondary leading-relaxed">{label} hesabınızı bağlayarak işlemlerinizi Trade Günlüğü'ne otomatik olarak senkronize edin.</p>
                  </div>
                  {isTradovateGroup && (
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Ortam</label>
                      <select value={environment} onChange={(e) => setEnvironment(e.target.value)}
                        className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent">
                        <option value="demo">Demo</option>
                        <option value="live">Canlı</option>
                      </select>
                    </div>
                  )}
                  <button onClick={handleConnect} disabled={connecting}
                    className="px-4 py-2 bg-accent text-accent-text text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50">
                    {connecting ? 'Bağlanıyor...' : `${label} ile Bağlan`}
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-xs text-text-muted">{connectionLimit > 0 ? `${connectionsUsed} / ${connectionLimit} aracı kurum bağlantısı` : `${connectionsUsed} aracı kurum bağlantısı`}</span>
                  <div className="flex items-center gap-3">
                    {isTradovateGroup && (
                      <select value={environment} onChange={(e) => setEnvironment(e.target.value)}
                        className="px-2 py-1.5 bg-bg-input border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent">
                        <option value="demo">Demo</option>
                        <option value="live">Canlı</option>
                      </select>
                    )}
                    <button onClick={handleConnect} disabled={connecting || atConnectionLimit}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-input border border-border text-text-primary text-xs font-medium rounded-lg hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={atConnectionLimit ? 'Bağlantı limitine ulaşıldı' : `Başka bir ${label} bağlantısı ekle`}>
                      <Icons.Plus className="w-3.5 h-3.5" />
                      Başka Bağla
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const RobinhoodBrokerSection = ({ hook, expandedBroker, toggleBroker, brokerHeaderBadge, statusDot }) => {
  const { config, label, connections, connectionsUsed, connectionLimit, canUseBrokerSync,
    atConnectionLimit, syncingId, showImportPrompt, connecting,
    credentials, setCredentials,
    handleConnect, handleSync, handleDisconnect,
    handleImportNow } = hook;

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => toggleBroker(config.key)}
        className="w-full flex items-center justify-between p-5 hover:bg-bg-page/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <img src={config.icon} alt={label} className="w-10 h-10 rounded-lg object-contain" />
          <div className="text-left">
            <h3 className="text-text-primary font-semibold text-sm">{label}</h3>
            <p className="text-text-tertiary text-xs">{config.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {brokerHeaderBadge(connections)}
          {expandedBroker === config.key
            ? <Icons.ChevronUp className="w-4 h-4 text-text-secondary" />
            : <Icons.ChevronDown className="w-4 h-4 text-text-secondary" />}
        </div>
      </button>

      {expandedBroker === config.key && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
          {(
            <>
              {connections.map(conn => (
                <div key={conn.connectionId} className="bg-bg-page/50 border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot(conn)}`}></span>
                      <span className="text-sm text-text-primary font-medium">{label}</span>
                      {conn.label && <span className="text-xs text-text-secondary">— {conn.label}</span>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      conn.configured && !conn.expired ? 'bg-positive/10 text-positive' :
                      conn.expired ? 'bg-warning/10 text-warning' : 'bg-text-secondary/10 text-text-secondary'
                    }`}>
                      {conn.configured && !conn.expired ? 'Aktif' : conn.expired ? 'Süresi Doldu' : 'Pasif'}
                    </span>
                  </div>

                  {conn.lastSyncTime && <p className="text-xs text-text-muted">Son senkronizasyon: {relativeTime(conn.lastSyncTime)}</p>}

                  {showImportPrompt === conn.connectionId && (
                    <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                      <p className="text-sm text-text-primary font-medium mb-1">İşlemleri içe aktar</p>
                      <p className="text-xs text-text-secondary mb-3">{label} hesabınızdaki geçmiş işlemleri içe aktarın.</p>
                      <button onClick={() => handleImportNow(conn.connectionId, false)} disabled={syncingId !== null}
                        className="w-full px-3 py-2 bg-accent text-accent-text text-xs font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50">
                        {syncingId === conn.connectionId ? 'İçe aktarılıyor...' : 'Tüm işlemleri içe aktar'}
                      </button>
                    </div>
                  )}

                  {showImportPrompt !== conn.connectionId && (
                    <div className="flex items-center gap-2">
                      {conn.expired ? (
                        <button onClick={handleConnect} disabled={connecting}
                          className="px-3 py-1.5 bg-warning/10 text-warning text-xs font-medium rounded-lg hover:bg-warning/20 transition-colors disabled:opacity-50">
                          {connecting ? 'Yeniden bağlanıyor...' : 'Yeniden Bağlan'}
                        </button>
                      ) : conn.configured ? (
                        <button onClick={() => handleSync(conn.connectionId)} disabled={syncingId !== null}
                          className="px-3 py-1.5 bg-accent text-accent-text text-xs font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50 flex items-center gap-1.5">
                          <Icons.RefreshCw className={`w-3.5 h-3.5 ${syncingId === conn.connectionId ? 'animate-spin' : ''}`} />
                          {syncingId === conn.connectionId ? 'Senkronize ediliyor...' : 'Şimdi Senkronize Et'}
                        </button>
                      ) : null}
                      <button onClick={() => handleDisconnect(conn.connectionId)}
                        className="px-3 py-1.5 text-text-secondary text-xs font-medium hover:text-negative hover:bg-negative/10 rounded-lg transition-colors">
                        Bağlantıyı Kes
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {connections.length === 0 ? (
                <>
                  <div className="bg-bg-page/50 rounded-lg p-3">
                    <p className="text-xs text-text-secondary leading-relaxed">{label} hesabınızı bağlayarak işlemlerinizi Trade Günlüğü'ne otomatik olarak senkronize edin. Kimlik bilgileriniz yalnızca bir kez doğrulama için kullanılır ve asla saklanmaz.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">E-posta</label>
                    <input type="email" value={credentials.email} onChange={(e) => setCredentials(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="ornek@eposta.com"
                      className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Şifre</label>
                    <input type="password" value={credentials.password} onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="Şifrenizi girin"
                      className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted" />
                  </div>
                  <button onClick={() => handleConnect({ email: credentials.email, password: credentials.password })}
                    disabled={connecting || !credentials.email || !credentials.password}
                    className="w-full px-4 py-2 bg-accent text-accent-text text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
                    style={{ backgroundColor: connecting ? undefined : '#00C805' }}>
                    {connecting ? 'Bağlanıyor...' : `${label} ile Bağlan`}
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-xs text-text-muted">{connectionLimit > 0 ? `${connectionsUsed} / ${connectionLimit} aracı kurum bağlantısı` : `${connectionsUsed} aracı kurum bağlantısı`}</span>
                  <button onClick={handleConnect} disabled={connecting || atConnectionLimit}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-input border border-border text-text-primary text-xs font-medium rounded-lg hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={atConnectionLimit ? 'Bağlantı limitine ulaşıldı' : `Başka bir ${label} bağlantısı ekle`}>
                    <Icons.Plus className="w-3.5 h-3.5" />
                    Başka Bağla
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const SettingsPage = ({ onSyncComplete, onNavigate, theme, onThemeChange, customColors, tags, triggerReload }) => {
  const [activeTab, setActiveTab] = useState('brokers');
  const [message, setMessage] = useState(null);

  // --- ProjectX multi-connection state ---
  const [pxConnections, setPxConnections] = useState([]);
  const [pxConnectionsUsed, setPxConnectionsUsed] = useState(0);
  const [pxConnectionLimit, setPxConnectionLimit] = useState(0);
  const [pxUsername, setPxUsername] = useState('');
  const [pxApiKey, setPxApiKey] = useState('');
  const [pxConnecting, setPxConnecting] = useState(false);
  const [pxSyncingId, setPxSyncingId] = useState(null);
  const [pxShowNewForm, setPxShowNewForm] = useState(false);
  // Per-connection editing state for ProjectX accounts
  const [pxEditingConnId, setPxEditingConnId] = useState(null);
  const [pxEditSelectedAccounts, setPxEditSelectedAccounts] = useState([]);
  const [pxEditCopytradeEnabled, setPxEditCopytradeEnabled] = useState(false);
  const [pxEditLeadAccount, setPxEditLeadAccount] = useState(null);
  const [pxEditMultiplier, setPxEditMultiplier] = useState(1);

  // --- Tag state ---
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLOR_PRESETS[0]);
  const [editingTagId, setEditingTagId] = useState(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState('');

  const [expandedBroker, setExpandedBroker] = useState(null);

  // --- Broker hooks (must be top-level, not in a loop) ---
  const hookOpts = { onSyncComplete, setMessage, setExpandedBroker };
  const tradovateHook = useBrokerConnection('tradovate', hookOpts);
  const ninjatraderHook = useBrokerConnection('ninjatrader', hookOpts);
  const alphaFuturesHook = useBrokerConnection('alpha_futures', hookOpts);
  const apexHook = useBrokerConnection('apex_trader_funding', hookOpts);
  const tradeifyHook = useBrokerConnection('tradeify', hookOpts);
  const mffHook = useBrokerConnection('my_funded_futures', hookOpts);
  const lucidHook = useBrokerConnection('lucid_trading', hookOpts);
  const topOneHook = useBrokerConnection('top_one_futures', hookOpts);
  const fundednextHook = useBrokerConnection('fundednext_futures', hookOpts);
  const blueGuardianHook = useBrokerConnection('blue_guardian', hookOpts);
  const robinhoodHook = useBrokerConnection('robinhood', hookOpts);
  const webullHook = useBrokerConnection('webull', hookOpts);
  const brokerHooks = {
    tradovate: tradovateHook,
    ninjatrader: ninjatraderHook,
    alpha_futures: alphaFuturesHook,
    apex_trader_funding: apexHook,
    tradeify: tradeifyHook,
    my_funded_futures: mffHook,
    lucid_trading: lucidHook,
    top_one_futures: topOneHook,
    fundednext_futures: fundednextHook,
    blue_guardian: blueGuardianHook,
    robinhood: robinhoodHook,
    webull: webullHook,
  };

  // =============================================
  // ProjectX data fetching
  // =============================================
  const fetchPxStatus = useCallback(async () => {
    try {
      const response = await authFetch('/api/projectx/status');
      const data = await response.json();
      setPxConnections(data.connections || []);
      setPxConnectionsUsed(data.connectionsUsed || 0);
      setPxConnectionLimit(data.connectionLimit || 0);
    } catch (err) {
      console.error('Failed to fetch ProjectX status:', err);
    }
  }, []);

  // Fetch all broker statuses on mount
  useEffect(() => {
    Object.values(brokerHooks).forEach(h => h.fetchStatus());
    fetchPxStatus();
  }, []);

  // =============================================
  // OAuth callback detection (shared across all Tradovate-compatible brokers)
  // =============================================
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('tv_code');
    const connId = params.get('tv_conn');
    const brokerParam = params.get('tv_broker') || 'tradovate';
    const error = params.get('tv_error');

    if (code || error) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (error) {
      const brokerLabel = TRADOVATE_BROKERS.find(b => b.key === brokerParam)?.label || 'Broker';
      setMessage({ type: 'error', text: `${brokerLabel} OAuth başarısız oldu. Lütfen tekrar deneyin.` });
      return;
    }

    if (!code || !connId) return;

    const hook = brokerHooks[brokerParam] || brokerHooks.tradovate;
    const brokerLabel = TRADOVATE_BROKERS.find(b => b.key === brokerParam)?.label || 'Broker';

    const exchangeCode = async () => {
      hook.setConnecting(true);
      setMessage(null);
      try {
        const response = await authFetch('/api/tradovate/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, connectionId: connId }),
        });
        const data = await response.json();
        if (data.error) {
          setMessage({ type: 'error', text: data.error });
        } else {
          const actualBroker = data.broker || brokerParam;
          setMessage({ type: 'success', text: `${brokerLabel} başarıyla bağlandı!` });
          hook.setShowImportPrompt(connId);
          setExpandedBroker(actualBroker);
          hook.fetchStatus();
        }
      } catch (err) {
        setMessage({ type: 'error', text: `${brokerLabel} bağlanamadı` });
      }
      hook.setConnecting(false);
    };
    exchangeCode();
  }, []);

  // =============================================
  // Webull OAuth callback detection
  // =============================================
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('webull_code');
    const connId = params.get('webull_connection');
    const error = params.get('wb_error');

    if (code || error) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (error) {
      setMessage({ type: 'error', text: 'Webull OAuth başarısız oldu. Lütfen tekrar deneyin.' });
      return;
    }
    if (!code || !connId) return;

    const exchangeCode = async () => {
      webullHook.setConnecting(true);
      setMessage(null);
      try {
        const response = await authFetch('/api/webull/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, connectionId: connId }),
        });
        const data = await response.json();
        if (data.error) {
          setMessage({ type: 'error', text: data.error });
        } else {
          setMessage({ type: 'success', text: 'Webull başarıyla bağlandı!' });
          webullHook.setShowImportPrompt(connId);
          setExpandedBroker('webull');
          webullHook.fetchStatus();
        }
      } catch (err) {
        setMessage({ type: 'error', text: 'Webull bağlanamadı' });
      }
      webullHook.setConnecting(false);
    };
    exchangeCode();
  }, []);

  // =============================================
  // ProjectX handlers
  // =============================================
  const handlePxConnect = async () => {
    if (!pxUsername.trim() || !pxApiKey.trim()) {
      setMessage({ type: 'error', text: 'Kullanıcı adı ve API anahtarı gereklidir' });
      return;
    }
    setPxConnecting(true);
    setMessage(null);
    try {
      const response = await authFetch('/api/projectx/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: pxUsername.trim(), apiKey: pxApiKey.trim() }),
      });
      const data = await response.json();
      if (data.error) {
        setMessage({ type: 'error', text: data.error });
      } else {
        setMessage({ type: 'success', text: 'ProjectX\'e bağlanıldı!' });
        setPxApiKey('');
        setPxUsername('');
        setPxShowNewForm(false);
        // Open editing for the new connection
        if (data.connectionId) {
          setPxEditingConnId(data.connectionId);
          setPxEditSelectedAccounts([]);
          setPxEditCopytradeEnabled(false);
          setPxEditLeadAccount(null);
          setPxEditMultiplier(1);
        }
        fetchPxStatus();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'ProjectX\'e bağlanılamadı' });
    }
    setPxConnecting(false);
  };

  const handlePxSaveAccounts = async (connectionId) => {
    if (pxEditSelectedAccounts.length === 0) {
      setMessage({ type: 'error', text: 'En az bir hesap seçin' });
      return;
    }
    setMessage(null);
    try {
      const copytradeConfig = pxEditCopytradeEnabled && pxEditLeadAccount
        ? { leadAccountId: pxEditLeadAccount, multiplier: pxEditMultiplier }
        : null;
      const response = await authFetch('/api/projectx/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, selectedAccounts: pxEditSelectedAccounts, copytradeConfig }),
      });
      const data = await response.json();
      if (data.error) {
        setMessage({ type: 'error', text: data.error });
      } else {
        setMessage({ type: 'success', text: 'Hesap ayarları kaydedildi' });
        setPxEditingConnId(null);
        fetchPxStatus();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Ayarlar kaydedilemedi' });
    }
  };

  const handlePxSync = async (connectionId) => {
    setPxSyncingId(connectionId);
    setMessage(null);
    try {
      const response = await authFetch('/api/projectx/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      const data = await response.json();
      if (data.error) {
        setMessage({ type: 'error', text: data.error });
      } else {
        setMessage({ type: 'success', text: data.message || 'Senkronizasyon tamamlandı' });
        fetchPxStatus();
        if (onSyncComplete) onSyncComplete();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Senkronizasyon başarısız' });
    }
    setPxSyncingId(null);
  };

  const handlePxDisconnect = async (connectionId) => {
    if (!confirm('Bu ProjectX bağlantısı kesilsin mi?')) return;
    setMessage(null);
    try {
      const response = await authFetch(`/api/projectx/connections/${connectionId}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.error) {
        setMessage({ type: 'error', text: data.error });
      } else {
        setMessage({ type: 'success', text: 'Bağlantı kaldırıldı' });
        if (pxEditingConnId === connectionId) setPxEditingConnId(null);
        fetchPxStatus();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Bağlantı kesilemedi' });
    }
  };

  const handlePxToggleEval = async (connectionId, isEval) => {
    setMessage(null);
    try {
      const response = await authFetch('/api/projectx/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, isEval }),
      });
      const data = await response.json();
      if (data.error) {
        setMessage({ type: 'error', text: data.error });
      } else {
        setPxConnections(prev => prev.map(c =>
          c.connectionId === connectionId ? { ...c, isEval } : c
        ));
      }
    } catch {
      setMessage({ type: 'error', text: 'Değerlendirme ayarı güncellenemedi' });
    }
  };

  const startEditingPxConnection = (conn) => {
    setPxEditingConnId(conn.connectionId);
    setPxEditSelectedAccounts(conn.selectedAccounts || []);
    if (conn.copytradeConfig) {
      setPxEditCopytradeEnabled(true);
      setPxEditLeadAccount(conn.copytradeConfig.leadAccountId);
      setPxEditMultiplier(conn.copytradeConfig.multiplier || 1);
    } else {
      setPxEditCopytradeEnabled(false);
      setPxEditLeadAccount(null);
      setPxEditMultiplier(1);
    }
  };

  const togglePxEditAccount = (accountId) => {
    setPxEditSelectedAccounts(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  // =============================================
  // Tag handlers (unchanged)
  // =============================================
  const handleCreateTag = async () => {
    if (!newTagName.trim()) {
      setMessage({ type: 'error', text: 'Etiket adı boş olamaz.' });
      return;
    }
    try {
      const response = await authFetch('/api/makeTag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      const data = await response.json();
      if (data.error) {
        setMessage({ type: 'error', text: data.error });
      } else {
        setNewTagName('');
        setNewTagColor(TAG_COLOR_PRESETS[0]);
        if (triggerReload) triggerReload();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Etiket oluşturulamadı' });
    }
  };

  const handleEditTag = async (tagId) => {
    if (!editTagName.trim()) return;
    try {
      const response = await authFetch('/api/updateTag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: tagId, name: editTagName.trim(), color: editTagColor }),
      });
      const data = await response.json();
      if (data.error) {
        setMessage({ type: 'error', text: data.error });
      } else {
        setEditingTagId(null);
        if (triggerReload) triggerReload();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Etiket güncellenemedi' });
    }
  };

  const handleDeleteTag = async (tagId) => {
    if (!confirm('Bu etiket silinsin mi? Tüm işlemlerden kaldırılacak.')) return;
    try {
      const response = await authFetch('/api/removeTag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: tagId }),
      });
      const data = await response.json();
      if (data.error) {
        setMessage({ type: 'error', text: data.error });
      } else {
        if (triggerReload) triggerReload();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Etiket silinemedi' });
    }
  };

  // =============================================
  // UI helpers
  // =============================================
  const tabs = [
    { id: 'brokers', label: 'Aracı Kurum Bağlantıları' },
    { id: 'tags', label: 'Etiketler' },
    { id: 'preferences', label: 'Tercihler' },
  ];

  const toggleBroker = (id) => setExpandedBroker(expandedBroker === id ? null : id);

  // Status dot color for a connection
  const statusDot = (conn) => {
    if (conn.configured && !conn.expired) return 'bg-positive';
    if (conn.expired) return 'bg-warning';
    return 'bg-negative';
  };

  // Badge for broker accordion header based on connections
  const brokerHeaderBadge = (connections) => {
    const configured = connections.filter(c => c.configured && !c.expired).length;
    const expired = connections.filter(c => c.expired).length;
    if (configured > 0 && expired === 0) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-positive/10 text-positive">
          {configured} Bağlı
        </div>
      );
    }
    if (configured > 0 && expired > 0) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
          {configured} Bağlı, {expired} Süresi Doldu
        </div>
      );
    }
    if (expired > 0) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
          {expired} Süresi Doldu
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-text-secondary/10 text-text-secondary">
        Bağlı Değil
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Ayarlar</h1>
        <p className="text-text-secondary text-sm mt-1">Hesabınızı ve entegrasyonlarınızı yönetin</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-bg-input rounded-lg p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-bg-surface text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Broker Connections tab */}
      {activeTab === 'brokers' && (
        <div className="space-y-6">
          {/* Message */}
          {message && (
            <div className={`p-3 rounded-lg text-sm ${
              message.type === 'error'
                ? 'bg-negative/10 border border-negative/30 text-negative'
                : 'bg-positive/10 border border-positive/30 text-positive'
            }`}>
              {message.text}
            </div>
          )}

          {/* Shared pool counter */}
          {(brokerHooks.tradovate.connectionsUsed > 0 || pxConnectionsUsed > 0) && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="px-2 py-1 bg-bg-surface border border-border rounded-md font-medium">
                {brokerHooks.tradovate.connectionLimit > 0 ? `${brokerHooks.tradovate.connectionsUsed} / ${brokerHooks.tradovate.connectionLimit}` : brokerHooks.tradovate.connectionsUsed} aracı kurum bağlantısı
              </span>
            </div>
          )}

          {/* ============== Direct Brokers ============== */}
          {TRADOVATE_BROKERS.filter(b => !b.subtitle.includes('Prop')).map(b => (
            <TradovateBrokerSection
              key={b.key}
              hook={brokerHooks[b.key]}
              expandedBroker={expandedBroker}
              toggleBroker={toggleBroker}
              brokerHeaderBadge={brokerHeaderBadge}
              statusDot={statusDot}
            />
          ))}

          {/* ============== Robinhood — Coming Soon ============== */}
          <div className="bg-bg-surface border border-border rounded-xl overflow-hidden opacity-75">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <img src={BROKER_CONFIGS.robinhood.icon} alt="Robinhood" className="w-10 h-10 rounded-lg object-contain" />
                <div>
                  <h3 className="text-text-primary font-semibold text-sm">Robinhood</h3>
                  <p className="text-text-tertiary text-xs">{BROKER_CONFIGS.robinhood.subtitle}</p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent font-medium">Yakında</span>
            </div>
          </div>

          {/* ============== Webull — Coming Soon ============== */}
          <div className="bg-bg-surface border border-border rounded-xl overflow-hidden opacity-75">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <img src={BROKER_CONFIGS.webull.icon} alt="Webull" className="w-10 h-10 rounded-lg object-contain" />
                <div>
                  <h3 className="text-text-primary font-semibold text-sm">Webull</h3>
                  <p className="text-text-tertiary text-xs">{BROKER_CONFIGS.webull.subtitle}</p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent font-medium">Yakında</span>
            </div>
          </div>

          {/* ============== Prop Firms Grid ============== */}
          <div className="pt-2">
            <h3 className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">Prop Firmalar</h3>
          </div>

          {(() => {
            const propFirms = [
              ...TRADOVATE_BROKERS.filter(b => b.subtitle.includes('Prop')),
              { key: 'projectx', label: 'Topstep (ProjectX)', icon: '/assets/img/topstep.png', subtitle: 'Prop trading firması' },
            ];
            const cols = 3;
            const rows = [];
            for (let i = 0; i < propFirms.length; i += cols) {
              rows.push(propFirms.slice(i, i + cols));
            }
            const expandedRowIdx = rows.findIndex(row => row.some(b => b.key === expandedBroker));

            const getPropFirmStatus = (b) => {
              if (b.key === 'projectx') {
                const configured = pxConnections.filter(c => c.configured && !c.expired).length;
                const expired = pxConnections.filter(c => c.expired).length;
                return { configured, expired };
              }
              const hook = brokerHooks[b.key];
              const conns = hook?.connections || [];
              return {
                configured: conns.filter(c => c.configured && !c.expired).length,
                expired: conns.filter(c => c.expired).length,
              };
            };

            return rows.map((row, rowIdx) => (
              <React.Fragment key={rowIdx}>
                <div className={`grid grid-cols-2 lg:grid-cols-3 gap-3 ${rowIdx > 0 ? 'mt-3' : ''}`}>
                  {row.map(b => {
                    const { configured, expired } = getPropFirmStatus(b);
                    const isExpanded = expandedBroker === b.key;

                    return (
                      <button
                        key={b.key}
                        onClick={() => toggleBroker(b.key)}
                        className={`bg-bg-surface border rounded-xl p-4 flex flex-col items-center gap-2 text-center transition-all cursor-pointer hover:bg-bg-page/50 ${
                          isExpanded ? 'border-accent ring-1 ring-accent/20' : 'border-border hover:border-accent/40'
                        }`}
                      >
                        <img src={b.icon} alt={b.label} className="w-10 h-10 rounded-lg object-contain" />
                        <span className="text-text-primary font-semibold text-sm leading-tight">{b.label}</span>
                        {configured > 0 ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-positive/10 text-positive font-medium">
                            {configured} Bağlı{expired > 0 ? `, ${expired} Süresi Doldu` : ''}
                          </span>
                        ) : expired > 0 ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning font-medium">{expired} Süresi Doldu</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-text-secondary/10 text-text-secondary">Bağlı Değil</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {expandedRowIdx === rowIdx && expandedBroker !== 'projectx' && brokerHooks[expandedBroker] && (
                  <div className="mt-3">
                    <TradovateBrokerSection
                      hook={brokerHooks[expandedBroker]}
                      expandedBroker={expandedBroker}
                      toggleBroker={toggleBroker}
                      brokerHeaderBadge={brokerHeaderBadge}
                      statusDot={statusDot}
                    />
                  </div>
                )}
                {expandedRowIdx === rowIdx && expandedBroker === 'projectx' && (
                  <div className="mt-3">
                    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between p-5">
                        <div className="flex items-center gap-3">
                          <img src="/assets/img/topstep.png" alt="ProjectX" className="w-10 h-10 rounded-lg object-contain" />
                          <div className="text-left">
                            <h3 className="text-text-primary font-semibold text-sm">ProjectX / Topstep</h3>
                            <p className="text-text-tertiary text-xs">Prop trading firması</p>
                          </div>
                        </div>
                        {brokerHeaderBadge(pxConnections)}
                      </div>
                      <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
                        {(
                          <>
                            {pxConnections.map(conn => (
                              <div key={conn.connectionId} className="bg-bg-page/50 border border-border rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2.5">
                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot(conn)}`}></span>
                                    <span className="text-sm text-text-primary font-medium">ProjectX <span className="capitalize">{conn.environment === 'live' ? 'Canlı' : conn.environment}</span></span>
                                    {conn.label && <span className="text-xs text-text-secondary">— {conn.label}</span>}
                                  </div>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    conn.configured && !conn.expired ? 'bg-positive/10 text-positive' :
                                    conn.expired ? 'bg-warning/10 text-warning' : 'bg-text-secondary/10 text-text-secondary'
                                  }`}>
                                    {conn.configured && !conn.expired ? 'Aktif' : conn.expired ? 'Süresi Doldu' : 'Pasif'}
                                  </span>
                                </div>

                                {conn.lastSyncTime && <p className="text-xs text-text-muted">Son senkronizasyon: {relativeTime(conn.lastSyncTime)}</p>}

                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-text-secondary">Değerlendirme Hesabı</span>
                                    <span className="text-[10px] text-text-muted">(senkronize edilen tüm işlemleri değerlendirme olarak işaretler)</span>
                                  </div>
                                  <button
                                    onClick={() => handlePxToggleEval(conn.connectionId, !conn.isEval)}
                                    className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${conn.isEval ? 'bg-accent' : 'bg-border'}`}
                                  >
                                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${conn.isEval ? 'translate-x-4' : ''}`} />
                                  </button>
                                </div>

                                {pxEditingConnId === conn.connectionId && (
                                  <div className="space-y-3 pt-2 border-t border-border">
                                    {(conn.accounts || []).length > 0 && (
                                      <div>
                                        <div className="flex items-center justify-between mb-2">
                                          <h4 className="text-sm font-medium text-text-primary">Hesaplar</h4>
                                        </div>
                                        <div className="space-y-2">
                                          {(conn.accounts || []).map(account => (
                                            <label key={account.id} className="flex items-center gap-3 p-2.5 bg-bg-surface/50 rounded-lg cursor-pointer hover:bg-bg-surface transition-colors">
                                              <input type="checkbox" checked={pxEditSelectedAccounts.includes(account.id)} onChange={() => togglePxEditAccount(account.id)}
                                                className="w-4 h-4 rounded border-border text-accent focus:ring-accent disabled:opacity-40" />
                                              <div className="flex-1">
                                                <span className="text-sm text-text-primary font-medium">{account.name}</span>
                                                {account.balance !== undefined && (
                                                  <span className="text-xs text-text-secondary ml-2">${account.balance?.toLocaleString('tr-TR',{ minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                )}
                                              </div>
                                              {account.canTrade && <span className="text-xs text-positive bg-positive/10 px-2 py-0.5 rounded-full">Aktif</span>}
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    <div className="border border-border rounded-lg p-4 space-y-3">
                                      <label className="flex items-center gap-3 cursor-pointer">
                                        <input type="checkbox" checked={pxEditCopytradeEnabled}
                                          onChange={(e) => { setPxEditCopytradeEnabled(e.target.checked); if (!e.target.checked) { setPxEditLeadAccount(null); setPxEditMultiplier(1); } }}
                                          className="w-4 h-4 rounded border-border text-accent focus:ring-accent" />
                                        <div>
                                          <span className="text-sm text-text-primary font-medium">Kopya işlem (copytrading) / işlem senkronizasyonu yapıyorum</span>
                                          <p className="text-xs text-text-secondary mt-0.5">Yalnızca bir lider hesaptan senkronize et ve miktarı ile K/Z'yi çarp</p>
                                        </div>
                                      </label>
                                      {pxEditCopytradeEnabled && (
                                        <div className="pl-7 space-y-3">
                                          <div>
                                            <label className="block text-xs font-medium text-text-secondary mb-1">Lider Hesap</label>
                                            <select value={pxEditLeadAccount || ''} onChange={(e) => setPxEditLeadAccount(Number(e.target.value))}
                                              className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent">
                                              <option value="">Lider hesap seçin</option>
                                              {(conn.accounts || []).filter(a => pxEditSelectedAccounts.includes(a.id)).map(account => (
                                                <option key={account.id} value={account.id}>{account.name}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="block text-xs font-medium text-text-secondary mb-1">Toplam Hesap (çarpan)</label>
                                            <input type="number" min="1" max="50" value={pxEditMultiplier}
                                              onChange={(e) => setPxEditMultiplier(Math.max(1, parseInt(e.target.value) || 1))}
                                              className="w-24 px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent" />
                                            <p className="text-xs text-text-muted mt-1">Miktar ve K/Z bu sayıyla çarpılacak</p>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex gap-2">
                                      <button onClick={() => handlePxSaveAccounts(conn.connectionId)}
                                        className="px-4 py-2 bg-accent text-accent-text text-sm font-medium rounded-lg hover:brightness-110 transition-all">Ayarları Kaydet</button>
                                      <button onClick={() => setPxEditingConnId(null)}
                                        className="px-4 py-2 text-text-secondary text-sm font-medium hover:text-text-primary transition-colors">İptal</button>
                                    </div>
                                  </div>
                                )}

                                {pxEditingConnId !== conn.connectionId && (
                                  <div className="flex items-center gap-2">
                                    {conn.configured && !conn.expired && (
                                      <>
                                        <button onClick={() => handlePxSync(conn.connectionId)} disabled={pxSyncingId !== null}
                                          className="px-3 py-1.5 bg-accent text-accent-text text-xs font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50 flex items-center gap-1.5">
                                          <Icons.RefreshCw className={`w-3.5 h-3.5 ${pxSyncingId === conn.connectionId ? 'animate-spin' : ''}`} />
                                          {pxSyncingId === conn.connectionId ? 'Senkronize ediliyor...' : 'Şimdi Senkronize Et'}
                                        </button>
                                        <button onClick={() => startEditingPxConnection(conn)}
                                          className="px-3 py-1.5 text-text-secondary text-xs font-medium hover:text-text-primary hover:bg-bg-surface rounded-lg transition-colors">Ayarlar</button>
                                      </>
                                    )}
                                    <button onClick={() => handlePxDisconnect(conn.connectionId)}
                                      className="px-3 py-1.5 text-text-secondary text-xs font-medium hover:text-negative hover:bg-negative/10 rounded-lg transition-colors">Bağlantıyı Kes</button>
                                  </div>
                                )}
                              </div>
                            ))}

                            {pxConnections.length === 0 ? (
                              <>
                                <div className="bg-bg-page/50 rounded-lg p-3">
                                  <p className="text-xs text-text-secondary leading-relaxed">İşlemleri otomatik senkronize etmek için Topstep hesabınızı ProjectX API üzerinden bağlayın. Topstep'ten ücretli bir API aboneliğine ($29/ay) ihtiyacınız olacak.</p>
                                </div>
                                <div className="space-y-3">
                                  <div>
                                    <label className="block text-xs font-medium text-text-secondary mb-1">Kullanıcı Adı</label>
                                    <input type="text" value={pxUsername} onChange={(e) => setPxUsername(e.target.value)} placeholder="Topstep kullanıcı adınız"
                                      className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-text-secondary mb-1">API Anahtarı</label>
                                    <input type="password" value={pxApiKey} onChange={(e) => setPxApiKey(e.target.value)} placeholder="ProjectX API anahtarınız"
                                      className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
                                  </div>
                                  <button onClick={handlePxConnect} disabled={pxConnecting}
                                    className="px-4 py-2 bg-accent text-accent-text text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50">
                                    {pxConnecting ? 'Bağlanıyor...' : 'Bağlan'}
                                  </button>
                                </div>
                                <a href="https://help.topstep.com/en/articles/11187768-topstepx-api-access" target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-accent text-xs hover:underline">
                                  <Icons.FileText className="w-3.5 h-3.5" />API anahtarınızı nasıl alırsınız
                                </a>
                              </>
                            ) : (
                              <div className="flex items-center justify-between pt-2 border-t border-border">
                                <span className="text-xs text-text-muted">{pxConnectionLimit > 0 ? `${pxConnectionsUsed} / ${pxConnectionLimit} aracı kurum bağlantısı` : `${pxConnectionsUsed} aracı kurum bağlantısı`}</span>
                                <button onClick={() => setPxShowNewForm(true)} disabled={pxConnectionsUsed >= pxConnectionLimit && pxConnectionLimit > 0}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-input border border-border text-text-primary text-xs font-medium rounded-lg hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  title={pxConnectionsUsed >= pxConnectionLimit && pxConnectionLimit > 0 ? 'Bağlantı limitine ulaşıldı' : 'Başka bir ProjectX bağlantısı ekle'}>
                                  <Icons.Plus className="w-3.5 h-3.5" />Başka Bağla
                                </button>
                              </div>
                            )}

                            {pxConnections.length > 0 && pxShowNewForm && (
                              <div className="bg-bg-page/50 border border-border rounded-lg p-4 space-y-3">
                                <h4 className="text-sm font-medium text-text-primary">Yeni ProjectX Bağlantısı</h4>
                                <div>
                                  <label className="block text-xs font-medium text-text-secondary mb-1">Kullanıcı Adı</label>
                                  <input type="text" value={pxUsername} onChange={(e) => setPxUsername(e.target.value)} placeholder="Topstep kullanıcı adınız"
                                    className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-text-secondary mb-1">API Anahtarı</label>
                                  <input type="password" value={pxApiKey} onChange={(e) => setPxApiKey(e.target.value)} placeholder="ProjectX API anahtarınız"
                                    className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={handlePxConnect} disabled={pxConnecting}
                                    className="px-4 py-2 bg-accent text-accent-text text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50">
                                    {pxConnecting ? 'Bağlanıyor...' : 'Bağlan'}
                                  </button>
                                  <button onClick={() => setPxShowNewForm(false)}
                                    className="px-4 py-2 text-text-secondary text-sm font-medium hover:text-text-primary transition-colors">İptal</button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ));
          })()}

        </div>
      )}

      {/* Tags tab */}
      {activeTab === 'tags' && (
        <div className="space-y-6">
          {message && (
            <div className={`p-3 rounded-lg text-sm ${
              message.type === 'error'
                ? 'bg-negative/10 border border-negative/30 text-negative'
                : 'bg-positive/10 border border-positive/30 text-positive'
            }`}>
              {message.text}
            </div>
          )}

          {/* Create tag form */}
          <div className="bg-bg-surface border border-border rounded-xl p-6">
            <h3 className="text-text-primary font-semibold mb-4">Etiket Oluştur</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Etiket Adı</label>
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="örn. Kırılım, Scalp, Haber"
                  className="w-full px-3 py-2.5 bg-bg-input border border-border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Renk</label>
                <div className="flex gap-1.5">
                  {TAG_COLOR_PRESETS.map(color => (
                    <button
                      key={color}
                      type="button"
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        newTagColor === color ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewTagColor(color)}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="px-4 py-2.5 bg-accent text-accent-text text-sm font-semibold rounded-lg hover:brightness-110 transition-all"
                onClick={handleCreateTag}
              >
                Etiket Ekle
              </button>
            </div>
          </div>

          {/* Tag list */}
          <div className="bg-bg-surface border border-border rounded-xl p-6">
            <h3 className="text-text-primary font-semibold mb-4">Etiketleriniz</h3>
            {(!tags || tags.length === 0) ? (
              <p className="text-text-tertiary text-sm">Henüz etiket yok. Başlamak için yukarıdan bir tane oluşturun.</p>
            ) : (
              <div className="space-y-2">
                {tags.map(tag => (
                  <div key={tag._id} className="flex items-center justify-between py-3 px-4 bg-bg-input border border-border rounded-lg">
                    {editingTagId === tag._id ? (
                      <div className="flex flex-wrap items-center gap-3 flex-1">
                        <input
                          type="text"
                          value={editTagName}
                          onChange={(e) => setEditTagName(e.target.value)}
                          className="px-3 py-1.5 bg-bg-surface border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
                        />
                        <div className="flex gap-1.5">
                          {TAG_COLOR_PRESETS.map(color => (
                            <button
                              key={color}
                              type="button"
                              className={`w-6 h-6 rounded-full border-2 transition-all ${
                                editTagColor === color ? 'border-white scale-110' : 'border-transparent'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => setEditTagColor(color)}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          className="px-3 py-1.5 bg-accent text-accent-text text-xs font-semibold rounded-lg hover:brightness-110 transition-all"
                          onClick={() => handleEditTag(tag._id)}
                        >
                          Kaydet
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 text-text-secondary text-xs hover:text-text-primary transition-colors"
                          onClick={() => setEditingTagId(null)}
                        >
                          İptal
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                          <span className="text-text-primary text-sm font-medium">{tag.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-surface transition-colors"
                            onClick={() => { setEditingTagId(tag._id); setEditTagName(tag.name); setEditTagColor(tag.color); }}
                            title="Düzenle"
                            aria-label={`Etiketi düzenle: ${tag.name}`}
                          >
                            <Icons.Edit />
                          </button>
                          <button
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-negative hover:bg-negative/10 transition-colors"
                            onClick={() => handleDeleteTag(tag._id)}
                            title="Sil"
                            aria-label={`Etiketi sil: ${tag.name}`}
                          >
                            <Icons.Trash />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preferences tab */}
      {activeTab === 'preferences' && (
        <div className="bg-bg-surface border border-border rounded-xl p-6">
          <h3 className="text-text-primary font-semibold mb-4">Tercihler</h3>

          {/* Dark / Light toggle */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-text-primary text-sm font-medium">Tema</div>
              <div className="text-text-tertiary text-xs mt-0.5">Tercih ettiğiniz görünümü seçin</div>
            </div>
            <div className="flex gap-1 bg-bg-input rounded-lg p-1">
              <button
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  (theme === 'dark' || theme === 'custom') ? 'bg-bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => onThemeChange('dark', { accent: customColors.accent || null })}
              >
                Koyu
              </button>
              <button
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  theme === 'light' ? 'bg-bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => onThemeChange('light', { accent: customColors.accent || null })}
              >
                Açık
              </button>
            </div>
          </div>

          {/* Accent color picker — all users */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="text-text-secondary text-sm font-medium">Vurgu Rengi</div>
              {customColors.accent && (
                <button
                  className="text-text-tertiary text-xs hover:text-text-secondary transition-colors"
                  onClick={() => {
                    const baseTheme = theme === 'custom' ? 'dark' : theme;
                    onThemeChange(baseTheme, { ...customColors, accent: null });
                  }}
                >
                  Varsayılana sıfırla
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={customColors.accent || (theme === 'light' ? '#10B981' : '#BFFF00')}
                onChange={(e) => {
                  const baseTheme = theme === 'custom' ? 'dark' : theme;
                  onThemeChange(baseTheme, { ...customColors, accent: e.target.value });
                }}
                className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
              />
              <div>
                <div className="text-text-primary text-sm">Ana / Vurgu</div>
                <div className="text-text-muted text-xs font-mono">
                  {customColors.accent || (theme === 'light' ? '#10B981' : '#BFFF00')}
                </div>
              </div>
            </div>
          </div>

          {/* Full customization */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-text-secondary text-sm font-medium mb-3">Tam Tema Özelleştirme</div>
            {(
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { key: 'bgPage', label: 'Arka Plan', defaultVal: '#0B0E14' },
                    { key: 'bgSurface', label: 'Öğeler', defaultVal: '#111111' },
                    { key: 'textPrimary', label: 'Metin', defaultVal: '#FFFFFF' },
                    { key: 'positive', label: 'Yükseliş (Pozitif)', defaultVal: '#10B981' },
                    { key: 'negative', label: 'Düşüş (Negatif)', defaultVal: '#EF4444' },
                  ].map(({ key, label, defaultVal }) => (
                    <div key={key} className="flex items-center gap-3">
                      <input
                        type="color"
                        value={(customColors && customColors[key]) || defaultVal}
                        onChange={(e) => {
                          const updated = { ...customColors, [key]: e.target.value };
                          onThemeChange('custom', updated);
                        }}
                        className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                      />
                      <div>
                        <div className="text-text-primary text-sm">{label}</div>
                        <div className="text-text-muted text-xs font-mono">{(customColors && customColors[key]) || defaultVal}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  className="text-text-tertiary text-xs hover:text-text-secondary transition-colors"
                  onClick={() => {
                    const defaults = { bgPage: '#050505', bgSurface: '#111111', textPrimary: '#FFFFFF', accent: customColors.accent, positive: '#10B981', negative: '#EF4444' };
                    onThemeChange('custom', defaults);
                  }}
                >
                  Renkleri varsayılana sıfırla
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// =====================================================

module.exports = SettingsPage;
