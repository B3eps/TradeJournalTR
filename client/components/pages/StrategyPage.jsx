const React = require('react');
const { useState, useEffect } = React;
const { authFetch } = require('../../helper');
const Icons = require('../shared/Icons');
const EvalFilterControl = require('../shared/EvalFilterControl');

// Güvenli sayı biçimleyici: sunucu bir alanı göndermezse (undefined/null/NaN) çökmek yerine "—" gösterir.
const fix = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');

const StrategyPage = ({ trades, evalFilter, setEvalFilter }) => {
  const [rules, setRules] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [disciplineScore, setDisciplineScore] = useState(0);
  const [combinations, setCombinations] = useState([]);
  const [tradeRuleStates, setTradeRuleStates] = useState([]);
  const [dailyRuleStates, setDailyRuleStates] = useState([]);
  const [ruleFilters, setRuleFilters] = useState({});
  const [loading, setLoading] = useState(true);
  const [newRuleLabel, setNewRuleLabel] = useState('');
  const [newRuleType, setNewRuleType] = useState('trade');
  const [editingId, setEditingId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [activeTab, setActiveTab] = useState('rules');
  const [ruleError, setRuleError] = useState('');

  const fetchRules = async () => {
    try {
      const resp = await authFetch('/api/strategy/rules');
      const data = await resp.json();
      if (!data.error) setRules(data.rules || []);
    } catch (err) {
      console.error('Failed to fetch rules:', err);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const resp = await authFetch(`/api/strategy/analytics${evalFilter !== 'all' ? `?evalFilter=${evalFilter}` : ''}`);
      const data = await resp.json();
      if (!data.error) {
        setAnalytics(data.analytics || []);
        setDisciplineScore(Number(data.disciplineScore) || 0);
        setCombinations(data.combinations || []);
        setTradeRuleStates(data.tradeRuleStates || []);
        setDailyRuleStates(data.dailyRuleStates || []);
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    }
  };

  useEffect(() => {
    Promise.all([fetchRules(), fetchAnalytics()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [evalFilter]);

  const handleAddRule = async () => {
    if (!newRuleLabel.trim()) {
      setRuleError('Kural metni boş olamaz.');
      return;
    }
    setRuleError('');
    try {
      const resp = await authFetch('/api/strategy/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newRuleLabel.trim(), type: newRuleType }),
      });
      const rule = await resp.json();
      if (!rule.error) {
        setRules(prev => [...prev, rule]);
        setNewRuleLabel('');
        fetchAnalytics();
      } else {
        setRuleError(rule.error);
      }
    } catch (err) {
      console.error('Failed to add rule:', err);
      setRuleError('Kural eklenemedi. Tekrar deneyin.');
    }
  };

  const handleUpdateRule = async (ruleId) => {
    if (!editingLabel.trim()) return;
    try {
      const resp = await authFetch(`/api/strategy/rules/${ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editingLabel.trim() }),
      });
      const updated = await resp.json();
      if (!updated.error) {
        setRules(prev => prev.map(r => r._id === ruleId ? updated : r));
        setEditingId(null);
      }
    } catch (err) {
      console.error('Failed to update rule:', err);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    try {
      await authFetch(`/api/strategy/rules/${ruleId}`, { method: 'DELETE' });
      setRules(prev => prev.filter(r => r._id !== ruleId));
      fetchAnalytics();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Icons.RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
      </div>
    );
  }

  const tradeRules = rules.filter(r => r.type === 'trade');
  const dayRules = rules.filter(r => r.type === 'day');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-text-primary text-2xl font-bold">Strateji</h1>
          <p className="text-text-secondary text-sm mt-1">İşlem kurallarınızı tanımlayın ve takip edin</p>
        </div>
        {trades && <EvalFilterControl trades={trades} evalFilter={evalFilter} setEvalFilter={setEvalFilter} />}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-bg-surface rounded-lg p-1 w-fit">
        {['rules', 'analytics'].map(tab => (
          <button
            key={tab}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab
                ? 'bg-bg-page text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'rules' ? 'Kurallar' : 'Analizler'}
          </button>
        ))}
      </div>

      {activeTab === 'rules' && (
        <div className="space-y-6">
          {/* Add new rule */}
          <div className="bg-bg-surface border border-border rounded-xl p-5">
            <h3 className="text-text-primary font-semibold text-sm mb-3">Yeni Kural Ekle</h3>
            <div className="flex gap-3">
              <select
                className="px-3 py-2 bg-bg-input border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent"
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value)}
              >
                <option value="trade">İşlem Kuralı</option>
                <option value="day">Günlük Kural</option>
              </select>
              <input
                type="text"
                className="flex-1 px-3 py-2 bg-bg-input border border-border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-accent"
                placeholder="örn. Girişten önce onay bekle"
                value={newRuleLabel}
                onChange={(e) => { setNewRuleLabel(e.target.value); if (ruleError) setRuleError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
              />
              <button
                className="px-4 py-2 bg-accent text-accent-text text-sm font-semibold rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
                onClick={handleAddRule}
              >
                Ekle
              </button>
            </div>
            {ruleError && <p role="alert" className="mt-2 text-xs text-negative">{ruleError}</p>}
          </div>

          {/* Trade Rules */}
          <div className="bg-bg-surface border border-border rounded-xl p-5">
            <h3 className="text-text-primary font-semibold text-sm mb-3">İşlem Kuralları</h3>
            <p className="text-text-tertiary text-xs mb-3">Bunları her işlem için ayrı ayrı işaretleyin</p>
            {tradeRules.length === 0 ? (
              <p className="text-text-muted text-sm">Henüz işlem kuralı tanımlanmadı.</p>
            ) : (
              <div className="space-y-2">
                {tradeRules.map(rule => (
                  <div key={rule._id} className="flex items-center gap-3 bg-bg-input rounded-lg px-3 py-2.5">
                    {editingId === rule._id ? (
                      <>
                        <input
                          type="text"
                          className="flex-1 px-2 py-1 bg-bg-surface border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdateRule(rule._id)}
                          autoFocus
                        />
                        <button className="text-positive text-xs font-medium" onClick={() => handleUpdateRule(rule._id)}>Kaydet</button>
                        <button className="text-text-muted text-xs" onClick={() => setEditingId(null)}>İptal</button>
                      </>
                    ) : (
                      <>
                        <Icons.Target className="w-4 h-4 text-accent flex-shrink-0" />
                        <span className="flex-1 text-text-primary text-sm">{rule.label}</span>
                        <button
                          className="text-text-muted hover:text-text-secondary text-xs"
                          onClick={() => { setEditingId(rule._id); setEditingLabel(rule.label); }}
                        >
                          Düzenle
                        </button>
                        <button
                          className="text-text-muted hover:text-negative text-xs"
                          onClick={() => handleDeleteRule(rule._id)}
                        >
                          Sil
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Daily Rules */}
          <div className="bg-bg-surface border border-border rounded-xl p-5">
            <h3 className="text-text-primary font-semibold text-sm mb-3">Günlük Kurallar</h3>
            <p className="text-text-tertiary text-xs mb-3">Bunları her işlem gününde gün detay panelinden işaretleyin</p>
            {dayRules.length === 0 ? (
              <p className="text-text-muted text-sm">Henüz günlük kural tanımlanmadı.</p>
            ) : (
              <div className="space-y-2">
                {dayRules.map(rule => (
                  <div key={rule._id} className="flex items-center gap-3 bg-bg-input rounded-lg px-3 py-2.5">
                    {editingId === rule._id ? (
                      <>
                        <input
                          type="text"
                          className="flex-1 px-2 py-1 bg-bg-surface border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdateRule(rule._id)}
                          autoFocus
                        />
                        <button className="text-positive text-xs font-medium" onClick={() => handleUpdateRule(rule._id)}>Kaydet</button>
                        <button className="text-text-muted text-xs" onClick={() => setEditingId(null)}>İptal</button>
                      </>
                    ) : (
                      <>
                        <Icons.Target className="w-4 h-4 text-info flex-shrink-0" />
                        <span className="flex-1 text-text-primary text-sm">{rule.label}</span>
                        <button
                          className="text-text-muted hover:text-text-secondary text-xs"
                          onClick={() => { setEditingId(rule._id); setEditingLabel(rule.label); }}
                        >
                          Düzenle
                        </button>
                        <button
                          className="text-text-muted hover:text-negative text-xs"
                          onClick={() => handleDeleteRule(rule._id)}
                        >
                          Sil
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'analytics' && (() => {
        // Computed values for analytics tab
        const tradeAnalytics = analytics.filter(a => a.type === 'trade');
        const dayAnalytics = analytics.filter(a => a.type === 'day');

        // Insights: top rules by profitability
        const mostProfitableTradeRule = tradeAnalytics
          .filter(a => a.followedCount >= 2)
          .sort((a, b) => b.avgPLFollowed - a.avgPLFollowed)[0];
        const bestDailyRule = dayAnalytics
          .filter(a => a.daysWithDataFollowed >= 2)
          .sort((a, b) => b.winRateFollowed - a.winRateFollowed)[0];

        // Rule filters
        const getFilter = (ruleId) => ruleFilters[ruleId] || 'any';
        const hasActiveFilters = Object.values(ruleFilters).some(v => v !== 'any');
        const toggleFilter = (ruleId, state) => setRuleFilters(prev => ({ ...prev, [ruleId]: (prev[ruleId] || 'any') === state ? 'any' : state }));

        // Compute filtered stats based on active rule filters
        const filteredStats = (() => {
          if (!hasActiveFilters) return null;
          const activeFilters = Object.entries(ruleFilters).filter(([, s]) => s !== 'any');
          const tradeFilters = activeFilters.filter(([id]) => rules.find(r => r._id === id && r.type === 'trade'));
          const dayFilters = activeFilters.filter(([id]) => rules.find(r => r._id === id && r.type === 'day'));
          let pls = [];
          if (tradeFilters.length > 0) {
            pls = tradeRuleStates
              .filter(t => tradeFilters.every(([id, state]) => state === 'followed' ? !!t.checks[id] : !t.checks[id]))
              .map(t => t.pl);
          }
          if (dayFilters.length > 0) {
            const dayPLs = dailyRuleStates
              .filter(d => dayFilters.every(([id, state]) => state === 'followed' ? !!d.checks[id] : !d.checks[id]))
              .flatMap(d => d.tradePLs);
            pls = [...pls, ...dayPLs];
          }
          if (pls.length === 0) return { count: 0, avgPL: 0, winRate: 0, profitFactor: 0 };
          const count = pls.length;
          const avgPL = pls.reduce((s, v) => s + v, 0) / count;
          const winRate = (pls.filter(v => v > 0).length / count) * 100;
          const grossWin = pls.filter(v => v > 0).reduce((s, v) => s + v, 0);
          const grossLoss = Math.abs(pls.filter(v => v < 0).reduce((s, v) => s + v, 0));
          const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
          return { count, avgPL, winRate, profitFactor };
        })();

        // Small metric display helper
        const Metric = ({ label, followed, broken, isPositiveBetter = true }) => {
          const fGood = isPositiveBetter ? followed >= broken : followed <= broken;
          return (
            <div className="flex justify-between text-xs py-1 border-b border-border/40 last:border-0">
              <span className="text-text-muted">{label}</span>
              <div className="flex gap-4">
                <span className={`font-mono font-medium ${fGood ? 'text-positive' : 'text-text-secondary'}`}>{followed}</span>
                <span className={`font-mono font-medium ${!fGood ? 'text-positive' : 'text-text-secondary'}`}>{broken}</span>
              </div>
            </div>
          );
        };

        return (
          <div className="space-y-6">
            {/* Discipline Score */}
            <div className="bg-bg-surface border border-border rounded-xl p-5">
              <h3 className="text-text-primary font-semibold text-sm mb-3">Genel Disiplin Puanı</h3>
              <div className="flex items-center gap-4">
                <div className="text-3xl font-bold font-mono text-accent">{fix(disciplineScore, 0)}%</div>
                <div className="flex-1">
                  <div className="w-full bg-bg-input rounded-full h-3">
                    <div className="bg-accent h-3 rounded-full transition-all" style={{ width: `${Math.min(100, disciplineScore)}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {analytics.length === 0 ? (
              <div className="bg-bg-surface border border-border rounded-xl p-8 text-center">
                <p className="text-text-muted text-sm">Henüz kural kontrol verisi yok. Gün detay panellerinde kuralları işaretlemeye başlayın.</p>
              </div>
            ) : (
              <>
                {/* Insights */}
                {(mostProfitableTradeRule || bestDailyRule) && (
                  <div className="bg-bg-surface border border-border rounded-xl p-5">
                    <h3 className="text-text-primary font-semibold text-sm mb-4">Öne Çıkan Bulgular</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {mostProfitableTradeRule && (
                        <div className="bg-positive/5 border border-positive/20 rounded-lg p-4">
                          <div className="text-text-muted text-[10px] font-semibold uppercase tracking-wider mb-1">En Kârlı İşlem Kuralı</div>
                          <div className="text-text-primary text-sm font-medium leading-snug mb-2">{mostProfitableTradeRule.label}</div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-positive text-xl font-mono font-bold">{mostProfitableTradeRule.avgPLFollowed >= 0 ? '+' : ''}${fix(mostProfitableTradeRule.avgPLFollowed, 2)}</span>
                            <span className="text-text-muted text-xs">uyulduğunda ort. K/Z</span>
                          </div>
                          <div className="flex gap-3 mt-1.5 text-xs text-text-tertiary">
                            <span>{fix(mostProfitableTradeRule.winRateFollowed, 0)}% kazanma oranı</span>
                            <span>{fix(mostProfitableTradeRule.profitFactorFollowed, 2)}x kâr faktörü</span>
                          </div>
                        </div>
                      )}
                      {bestDailyRule && (
                        <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
                          <div className="text-text-muted text-[10px] font-semibold uppercase tracking-wider mb-1">En İyi Günlük Kural (Kazanma Oranı)</div>
                          <div className="text-text-primary text-sm font-medium leading-snug mb-2">{bestDailyRule.label}</div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-accent text-xl font-mono font-bold">{fix(bestDailyRule.winRateFollowed, 0)}%</span>
                            <span className="text-text-muted text-xs">uyulduğunda günlük kazanma oranı</span>
                          </div>
                          <div className="flex gap-3 mt-1.5 text-xs text-text-tertiary">
                            <span>{bestDailyRule.avgPLFollowed >= 0 ? '+' : ''}${fix(bestDailyRule.avgPLFollowed, 2)} ort. günlük K/Z</span>
                            <span>{fix(bestDailyRule.profitFactorFollowed, 2)}x kâr faktörü</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Rule Filter */}
                {rules.length > 0 && (tradeRuleStates.length > 0 || dailyRuleStates.length > 0) && (
                  <div className="bg-bg-surface border border-border rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-text-primary font-semibold text-sm">Kural Durumuna Göre Filtrele</h3>
                        <p className="text-text-tertiary text-xs mt-0.5">Kurallara uyulduğunda veya uyulmadığında performansı görmek için kuralları seçin</p>
                      </div>
                      {hasActiveFilters && (
                        <button className="text-xs text-text-tertiary hover:text-text-primary transition-colors" onClick={() => setRuleFilters({})}>Tümünü temizle</button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {rules.map(rule => {
                        const f = getFilter(rule._id);
                        return (
                          <div key={rule._id} className="flex items-center gap-3">
                            <span className="flex-1 text-text-primary text-xs truncate">{rule.label}</span>
                            <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-medium shrink-0">
                              <button
                                className={`px-3 py-1.5 transition-colors ${f === 'followed' ? 'bg-positive text-white' : 'text-text-tertiary hover:text-positive hover:bg-positive/10'}`}
                                onClick={() => toggleFilter(rule._id, 'followed')}
                              >✓ Uyuldu</button>
                              <button
                                className={`px-3 py-1.5 border-x border-border transition-colors ${f === 'any' ? 'bg-bg-input text-text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-bg-input'}`}
                                onClick={() => toggleFilter(rule._id, 'any')}
                              >Hepsi</button>
                              <button
                                className={`px-3 py-1.5 transition-colors ${f === 'broken' ? 'bg-negative text-white' : 'text-text-tertiary hover:text-negative hover:bg-negative/10'}`}
                                onClick={() => toggleFilter(rule._id, 'broken')}
                              >✗ İhlal</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {hasActiveFilters && filteredStats && (
                      <div className="mt-4 pt-4 border-t border-border">
                        {filteredStats.count === 0 ? (
                          <p className="text-text-muted text-xs text-center">Bu filtre kombinasyonuna uyan işlem yok.</p>
                        ) : (
                          <>
                            <div className="text-text-secondary text-xs font-medium mb-3">Filtrelenmiş Sonuçlar — {filteredStats.count} işlem</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              {[
                                { label: 'Kazanma Oranı', value: fix(filteredStats.winRate, 0) + '%', color: filteredStats.winRate >= 50 ? 'text-positive' : 'text-negative' },
                                { label: 'Ort. K/Z', value: (filteredStats.avgPL >= 0 ? '+' : '') + '$' + fix(filteredStats.avgPL, 2), color: filteredStats.avgPL >= 0 ? 'text-positive' : 'text-negative' },
                                { label: 'Kâr Faktörü', value: filteredStats.profitFactor >= 99 ? '∞' : fix(filteredStats.profitFactor, 2) + 'x', color: filteredStats.profitFactor >= 1 ? 'text-positive' : 'text-negative' },
                                { label: 'İşlemler', value: filteredStats.count, color: 'text-text-primary' },
                              ].map(item => (
                                <div key={item.label} className="bg-bg-input rounded-lg px-3 py-2.5 text-center">
                                  <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">{item.label}</div>
                                  <div className={`font-mono font-bold text-sm ${item.color}`}>{item.value}</div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Trade Rule Analytics */}
                {tradeAnalytics.length > 0 && (
                  <div className="bg-bg-surface border border-border rounded-xl p-5">
                    <h3 className="text-text-primary font-semibold text-sm mb-4">İşlem Kuralı Analizleri</h3>
                    <div className="space-y-5">
                      {tradeAnalytics.map(a => (
                        <div key={a.ruleId}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-text-primary text-sm font-medium">{a.label}</span>
                            <span className={`text-xs font-mono ${a.adherenceRate >= 70 ? 'text-positive' : a.adherenceRate >= 40 ? 'text-warning' : 'text-negative'}`}>{fix(a.adherenceRate, 0)}% uyum</span>
                          </div>
                          <div className="w-full bg-bg-input rounded-full h-1.5 mb-3">
                            <div className={`h-1.5 rounded-full transition-all ${a.adherenceRate >= 70 ? 'bg-positive' : a.adherenceRate >= 40 ? 'bg-warning' : 'bg-negative'}`} style={{ width: `${Math.min(100, a.adherenceRate)}%` }} />
                          </div>
                          <div className="rounded-lg border border-border overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-bg-input border-b border-border">
                                  <th className="text-left px-3 py-2 text-text-muted font-medium">Metrik</th>
                                  <th className="text-right px-3 py-2 text-positive font-medium">Uyuldu ({a.followedCount})</th>
                                  <th className="text-right px-3 py-2 text-negative font-medium">İhlal ({a.brokenCount})</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[
                                  { label: 'Ort. K/Z', fVal: (a.avgPLFollowed >= 0 ? '+' : '') + '$' + fix(a.avgPLFollowed, 2), bVal: (a.avgPLBroken >= 0 ? '+' : '') + '$' + fix(a.avgPLBroken, 2), fBetter: a.avgPLFollowed >= a.avgPLBroken },
                                  { label: 'Kazanma Oranı', fVal: fix(a.winRateFollowed, 0) + '%', bVal: fix(a.winRateBroken, 0) + '%', fBetter: a.winRateFollowed >= a.winRateBroken },
                                  { label: 'Kâr Faktörü', fVal: a.profitFactorFollowed >= 99 ? '∞' : fix(a.profitFactorFollowed, 2) + 'x', bVal: a.profitFactorBroken >= 99 ? '∞' : fix(a.profitFactorBroken, 2) + 'x', fBetter: a.profitFactorFollowed >= a.profitFactorBroken },
                                ].map(row => (
                                  <tr key={row.label} className="border-b border-border/40 last:border-0">
                                    <td className="px-3 py-2 text-text-muted">{row.label}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-semibold ${row.fBetter ? 'text-positive' : 'text-text-secondary'}`}>{row.fVal}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-semibold ${!row.fBetter ? 'text-positive' : 'text-text-secondary'}`}>{row.bVal}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Daily Rule Analytics */}
                {dayAnalytics.length > 0 && (
                  <div className="bg-bg-surface border border-border rounded-xl p-5">
                    <h3 className="text-text-primary font-semibold text-sm mb-1">Günlük Kural Analizleri</h3>
                    <p className="text-text-tertiary text-xs mb-4">İstatistikler gün bazında hesaplanır — uyulan/ihlal edilen her gün bir veri noktasıdır</p>
                    <div className="space-y-5">
                      {dayAnalytics.map(a => (
                        <div key={a.ruleId}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-text-primary text-sm font-medium">{a.label}</span>
                            <span className={`text-xs font-mono ${a.adherenceRate >= 70 ? 'text-positive' : a.adherenceRate >= 40 ? 'text-warning' : 'text-negative'}`}>{fix(a.adherenceRate, 0)}% uyum</span>
                          </div>
                          <div className="w-full bg-bg-input rounded-full h-1.5 mb-3">
                            <div className={`h-1.5 rounded-full transition-all ${a.adherenceRate >= 70 ? 'bg-positive' : a.adherenceRate >= 40 ? 'bg-warning' : 'bg-negative'}`} style={{ width: `${Math.min(100, a.adherenceRate)}%` }} />
                          </div>
                          <div className="rounded-lg border border-border overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-bg-input border-b border-border">
                                  <th className="text-left px-3 py-2 text-text-muted font-medium">Günlük Metrik</th>
                                  <th className="text-right px-3 py-2 text-positive font-medium">Uyuldu ({a.daysWithDataFollowed ?? a.followedCount}g)</th>
                                  <th className="text-right px-3 py-2 text-negative font-medium">İhlal ({a.daysWithDataBroken ?? a.brokenCount}g)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[
                                  { label: 'Ort. Günlük K/Z', fVal: (a.avgPLFollowed >= 0 ? '+' : '') + '$' + fix(a.avgPLFollowed, 2), bVal: (a.avgPLBroken >= 0 ? '+' : '') + '$' + fix(a.avgPLBroken, 2), fBetter: a.avgPLFollowed >= a.avgPLBroken },
                                  { label: 'Günlük Kazanma Oranı', fVal: fix(a.winRateFollowed, 0) + '%', bVal: fix(a.winRateBroken, 0) + '%', fBetter: a.winRateFollowed >= a.winRateBroken },
                                  { label: 'Kâr Faktörü', fVal: a.profitFactorFollowed >= 99 ? '∞' : fix(a.profitFactorFollowed, 2) + 'x', bVal: a.profitFactorBroken >= 99 ? '∞' : fix(a.profitFactorBroken, 2) + 'x', fBetter: a.profitFactorFollowed >= a.profitFactorBroken },
                                ].map(row => (
                                  <tr key={row.label} className="border-b border-border/40 last:border-0">
                                    <td className="px-3 py-2 text-text-muted">{row.label}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-semibold ${row.fBetter ? 'text-positive' : 'text-text-secondary'}`}>{row.fVal}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-semibold ${!row.fBetter ? 'text-positive' : 'text-text-secondary'}`}>{row.bVal}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Most Broken Rules */}
                {analytics.filter(a => a.brokenCount > 0).length > 0 && (
                  <div className="bg-bg-surface border border-border rounded-xl p-5">
                    <h3 className="text-text-primary font-semibold text-sm mb-3">En Çok İhlal Edilen Kurallar</h3>
                    <div className="space-y-2">
                      {analytics.filter(a => a.brokenCount > 0).sort((a, b) => b.brokenCount - a.brokenCount).slice(0, 5).map(a => (
                        <div key={a.ruleId} className="flex items-center justify-between bg-bg-input rounded-lg px-3 py-2">
                          <span className="text-text-primary text-sm">{a.label}</span>
                          <span className="text-negative text-xs font-mono">{a.brokenCount} kez</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Combination Analytics */}
                {combinations && combinations.length > 0 && (
                  <div className="bg-bg-surface border border-border rounded-xl p-5">
                    <h3 className="text-text-primary font-semibold text-sm mb-1">Kural Kombinasyon Analizi</h3>
                    <p className="text-text-tertiary text-xs mb-5">Kural çiftlerine birlikte uyulduğunda K/Z nasıl değişiyor</p>
                    <div className="space-y-6">
                      {combinations.map((combo, idx) => {
                        const rows = [
                          { label: '✓ İkisine de uyuldu', stats: combo.both, highlight: true },
                          { label: `✓ ${combo.rule1Label} yalnızca`, stats: combo.onlyRule1 },
                          { label: `✓ ${combo.rule2Label} yalnızca`, stats: combo.onlyRule2 },
                          { label: 'İkisine de uyulmadı', stats: combo.neither },
                        ].filter(r => r.stats.count > 0);
                        if (rows.length === 0) return null;
                        return (
                          <div key={idx}>
                            <div className="text-xs font-medium mb-2 flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 rounded bg-accent/10 text-accent truncate max-w-[45%]">{combo.rule1Label}</span>
                              <span className="text-text-muted">×</span>
                              <span className="px-2 py-0.5 rounded bg-accent/10 text-accent truncate max-w-[45%]">{combo.rule2Label}</span>
                            </div>
                            <div className="rounded-lg border border-border overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-bg-input border-b border-border">
                                    <th className="text-left px-3 py-2 text-text-tertiary font-medium">Senaryo</th>
                                    <th className="text-right px-3 py-2 text-text-tertiary font-medium">İşlemler</th>
                                    <th className="text-right px-3 py-2 text-text-tertiary font-medium">Ort. K/Z</th>
                                    <th className="text-right px-3 py-2 text-text-tertiary font-medium">Kazanma Oranı</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((row, ri) => (
                                    <tr key={ri} className={`border-b border-border/50 last:border-0 ${row.highlight ? 'bg-positive/5' : ''}`}>
                                      <td className="px-3 py-2 text-text-secondary">{row.label}</td>
                                      <td className="px-3 py-2 text-right font-mono text-text-primary">{row.stats.count}</td>
                                      <td className={`px-3 py-2 text-right font-mono font-semibold ${row.stats.avgPL >= 0 ? 'text-positive' : 'text-negative'}`}>{row.stats.avgPL >= 0 ? '+' : ''}${fix(row.stats.avgPL, 2)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-text-secondary">{fix(row.stats.winRate, 0)}%</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
};


module.exports = StrategyPage;
