const React = require('react');
const { useState, useEffect, useRef } = React;
const helper = require('../../helper.js');
const { authFetch, postScreenshot } = helper;
const Icons = require('../shared/Icons');
const TickerAutofill = require('../shared/TickerAutofill');
const ScreenshotMarkupModal = require('../shared/ScreenshotMarkupModal');
const RuleChecklist = require('../shared/RuleChecklist');
const { resizeImage } = require('../../utils/imageUtils');
const { toEST, getESTOffset } = require('../../utils/dateUtils');
const { SidePanelContext } = require('../../utils/contexts');
const { useWindowWidth, useEscapeClose } = require('../../utils/hooks');
const sound = require('../../utils/sound');
const { TAG_COLOR_PRESETS } = require('../../utils/tagConstants');
const { parseForexSymbol, getPipSize, calculatePips, estimateForexPL } = require('../../utils/tickValues');

// =====================================================
// TRADE FORM POPUP
// =====================================================

const TradeFormPopup = ({ isOpen, onClose, triggerReload, editingTrade, prefillDate, tags, strategyRules, trades, sidebarCollapsed }) => {
  const [screenshot, setScreenshot] = useState(null);
  const [pastedImage, setPastedImage] = useState(null);
  const [isMarkupOpen, setIsMarkupOpen] = useState(false);
  const [markupSource, setMarkupSource] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEscapeClose(!!isOpen, onClose);
  useEscapeClose(lightboxOpen, () => setLightboxOpen(false));
  const [selectedTags, setSelectedTags] = useState([]);
  const [showNewTag, setShowNewTag] = useState(false);
  const [quickTagName, setQuickTagName] = useState('');
  const [quickTagColor, setQuickTagColor] = useState(TAG_COLOR_PRESETS[0]);
  const [creatingTag, setCreatingTag] = useState(false);
  const [account, setAccount] = useState('');
  const [isEval, setIsEval] = useState(false);
  const [tradeRuleChecks, setTradeRuleChecks] = useState([]);
  const [pendingRuleChecks, setPendingRuleChecks] = useState([]);
  const [ruleChecksLoading, setRuleChecksLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Live values for the forex helper (inputs stay uncontrolled)
  const [fxTicker, setFxTicker] = useState('');
  const [fxEnter, setFxEnter] = useState('');
  const [fxExit, setFxExit] = useState('');
  const [fxQty, setFxQty] = useState('');
  const fileInputRef = useRef(null);
  const manualPLRef = useRef(null);
  const windowWidth = useWindowWidth();
  const isUltrawide = windowWidth >= 2000;
  const isSidePanel = isUltrawide || (sidebarCollapsed && windowWidth >= 1280);
  const setSidePanelOffset = React.useContext(SidePanelContext);
  const tradeRules = strategyRules ? strategyRules.filter(r => r.type === 'trade') : [];
  useEffect(() => {
    if (!isOpen) { setSidePanelOffset(0); return; }
    if (isSidePanel) setSidePanelOffset(520);
    else setSidePanelOffset(0);
    return () => setSidePanelOffset(0);
  }, [isOpen, isSidePanel, setSidePanelOffset]);

  const handleQuickCreateTag = async () => {
    if (!quickTagName.trim() || creatingTag) return;
    setCreatingTag(true);
    try {
      const response = await authFetch('/api/makeTag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: quickTagName.trim(), color: quickTagColor }),
      });
      const data = await response.json();
      if (!data.error && data._id) {
        setSelectedTags(prev => [...prev, data._id]);
        setQuickTagName('');
        setQuickTagColor(TAG_COLOR_PRESETS[0]);
        setShowNewTag(false);
        triggerReload();
      }
    } catch (err) {
      console.error('Failed to create tag:', err);
    }
    setCreatingTag(false);
  };

  useEffect(() => {
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      if (!isSidePanel) document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, isSidePanel]);

  useEffect(() => {
    if (!isOpen) {
      setScreenshot(null); setPastedImage(null); setSelectedTags([]);
      setAccount(''); setIsEval(false); setTradeRuleChecks([]); setPendingRuleChecks([]);
      return;
    }
    setFxTicker(editingTrade?.ticker || '');
    setFxEnter(editingTrade?.enterPrice ? String(editingTrade.enterPrice) : '');
    setFxExit(editingTrade?.exitPrice ? String(editingTrade.exitPrice) : '');
    setFxQty(editingTrade?.quantity != null ? String(editingTrade.quantity) : '');
    if (editingTrade && editingTrade.screenshot) setScreenshot(editingTrade.screenshot);
    if (editingTrade && editingTrade.tags) setSelectedTags(editingTrade.tags);
    else setSelectedTags([]);
    if (editingTrade) {
      setAccount(editingTrade?.account || '');
      setIsEval(editingTrade.isEval || false);
      if (editingTrade._id && tradeRules.length > 0) {
        authFetch(`/api/strategy/checks/trade/${editingTrade._id}`)
          .then(r => r.json())
          .then(data => { if (!data.error) setTradeRuleChecks(data.checks || []); })
          .catch(() => {});
      }
    } else {
      setIsEval(false);
    }

    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => setPastedImage(event.target.result);
          reader.readAsDataURL(blob);
          e.preventDefault();
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isOpen, editingTrade]);

  if (!isOpen) return null;

  const isEditing = editingTrade !== null;

  const uploadScreenshot = async (dataUrl) => {
    setIsUploading(true);
    try {
      return await postScreenshot(dataUrl);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setPastedImage(event.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRuleToggle = async (ruleId, followed) => {
    if (isEditing && editingTrade?._id) {
      setRuleChecksLoading(true);
      try {
        const resp = await authFetch('/api/strategy/checks/trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradeId: editingTrade._id, ruleId, followed }),
        });
        const check = await resp.json();
        if (!check.error) {
          setTradeRuleChecks(prev => {
            const filtered = prev.filter(ch => ch.ruleId !== ruleId);
            return [...filtered, check];
          });
        }
      } catch (err) {
        console.error('Failed to toggle rule:', err);
      } finally {
        setRuleChecksLoading(false);
      }
    } else {
      setPendingRuleChecks(prev => {
        const filtered = prev.filter(ch => ch.ruleId !== ruleId);
        return [...filtered, { ruleId, followed }];
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    helper.hideError();
    const ticker = e.target.querySelector('#ticker').value;
    const enterTimeRaw = e.target.querySelector('#enterTime').value;
    const exitTimeRaw = e.target.querySelector('#exitTime').value;
    const enterPrice = e.target.querySelector('#enterPrice').value;
    const exitPrice = e.target.querySelector('#exitPrice').value;
    const quantity = e.target.querySelector('#quantity').value;
    const manualPL = e.target.querySelector('#manualPL').value;
    const comments = e.target.querySelector('#comments').value;
    const commissionInput = e.target.querySelector('#commission');
    const swapInput = e.target.querySelector('#swap');
    const commissionRaw = commissionInput ? commissionInput.value : '';
    const swapRaw = swapInput ? swapInput.value : '';
    const hasPrices = enterPrice && exitPrice;
    const hasPL = manualPL;
    if (!ticker || !enterTimeRaw || !exitTimeRaw || !quantity) {
      helper.handleError('Sembol, giriş zamanı, çıkış zamanı ve miktar (lot) zorunludur');
      return;
    }
    if (!hasPrices && !hasPL) {
      helper.handleError('Giriş/çıkış fiyatı veya manuel K/Z girilmelidir');
      return;
    }
    const fxInfo = parseForexSymbol(ticker);
    if (fxInfo && !hasPL && estimateForexPL({ ticker, enterPrice, exitPrice, quantity }) === null) {
      helper.handleError(`${fxInfo.symbol} çapraz bir parite: K/Z otomatik hesaplanamaz, lütfen K/Z'yi hesap para biriminde girin`);
      return;
    }
    const enterTime = enterTimeRaw + getESTOffset(new Date(enterTimeRaw));
    const exitTime = exitTimeRaw + getESTOffset(new Date(exitTimeRaw));
    const tradeData = {
      ticker, enterTime, exitTime,
      enterPrice: enterPrice ? parseFloat(enterPrice) : 0,
      exitPrice: exitPrice ? parseFloat(exitPrice) : 0,
      quantity: parseFloat(quantity),
      comments, isEval,
      account: account || null,
    };
    if (hasPL) tradeData.manualPL = parseFloat(manualPL);
    // Commission is always a cost (stored negative); swap keeps its sign.
    tradeData.commission = commissionRaw !== '' && !isNaN(parseFloat(commissionRaw)) ? -Math.abs(parseFloat(commissionRaw)) : null;
    tradeData.swap = swapRaw !== '' && !isNaN(parseFloat(swapRaw)) ? parseFloat(swapRaw) : null;
    if (screenshot) tradeData.screenshot = screenshot;
    if (selectedTags.length > 0) tradeData.tags = selectedTags;
    try {
      if (isEditing) {
        tradeData._id = editingTrade._id;
        const resp = await authFetch('/api/updateTrade', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeData),
        });
        const result = await resp.json();
        if (result.error) { helper.handleError(result.error); return; }
      } else {
        const resp = await authFetch('/api/trades', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeData),
        });
        const result = await resp.json();
        if (result.error) { helper.handleError(result.error); return; }
        if (result._id && pendingRuleChecks.length > 0) {
          await Promise.all(
            pendingRuleChecks.filter(ch => ch.followed).map(ch =>
              authFetch('/api/strategy/checks/trade', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tradeId: result._id, ruleId: ch.ruleId, followed: ch.followed }),
              }).catch(() => {})
            )
          );
        }
      }
      sound.play('complete');
      triggerReload();
      onClose();
    } catch (err) {
      helper.handleError(err.message || 'Bir hata oluştu');
    }
  };

  // Forex helper values
  const fxSymbol = parseForexSymbol(fxTicker);
  const fxHasCostFields = isEditing && (editingTrade.commission != null || editingTrade.swap != null);
  const showFxFields = !!fxSymbol || fxHasCostFields;
  const fxPips = fxSymbol ? calculatePips({ ticker: fxTicker, enterPrice: fxEnter, exitPrice: fxExit, quantity: fxQty }) : null;
  const fxEstimate = fxSymbol ? estimateForexPL({ ticker: fxTicker, enterPrice: fxEnter, exitPrice: fxExit, quantity: fxQty }) : null;

  const formatDateTimeForInput = (dateString) => {
    if (!dateString) return '';
    const e = toEST(dateString);
    return `${e.year}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}T${String(e.hours).padStart(2, '0')}:${String(e.minutes).padStart(2, '0')}:${String(e.seconds).padStart(2, '0')}`;
  };

  const inputClass = "w-full px-3 py-2.5 bg-bg-input border border-border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-accent transition-colors";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1.5";

  return (
    <>
      <div className={isSidePanel ? "fixed right-0 top-0 h-screen z-40 flex" : "fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"} onClick={!isSidePanel ? onClose : undefined}>
        <div role="dialog" aria-modal="true" aria-label={isEditing ? 'İşlemi Düzenle' : 'Yeni İşlem'} className={isSidePanel ? "w-[520px] h-full overflow-y-auto bg-bg-surface border-l border-border shadow-2xl" : "bg-bg-surface border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-surface z-10">
            <h2 className="text-lg font-semibold text-text-primary">{isEditing ? 'İşlemi Düzenle' : 'Yeni İşlem'}</h2>
            <button className="text-text-secondary hover:text-text-primary transition-colors" onClick={onClose}>
              <Icons.X />
            </button>
          </div>

          <form
            id="tradeForm"
            onSubmit={handleSubmit}
            name="tradeForm"
            action={isEditing ? "/api/updateTrade" : "/api/trades"}
            method="POST"
            className="p-6 space-y-4"
          >
            <div>
              <label htmlFor="ticker" className={labelClass}>Sembol</label>
              <TickerAutofill id="ticker" name="ticker" placeholder="EURUSD" defaultValue={isEditing ? editingTrade.ticker : ''} className={inputClass} trades={trades} onChange={setFxTicker} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="enterTime" className={labelClass}>Giriş Zamanı</label>
                <input id="enterTime" type="datetime-local" name="enterTime" step="1" defaultValue={isEditing ? formatDateTimeForInput(editingTrade.enterTime) : `${prefillDate || new Date().toISOString().split('T')[0]}T09:30:00`} className={inputClass} />
              </div>
              <div>
                <label htmlFor="exitTime" className={labelClass}>Çıkış Zamanı</label>
                <input id="exitTime" type="datetime-local" name="exitTime" step="1" defaultValue={isEditing ? formatDateTimeForInput(editingTrade.exitTime) : `${prefillDate || new Date().toISOString().split('T')[0]}T09:30:00`} className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="enterPrice" className={labelClass}>Giriş Fiyatı <span className="text-text-muted font-normal normal-case">(veya K/Z girin)</span></label>
                <input id="enterPrice" type="number" step="any" min="0" name="enterPrice" placeholder={fxSymbol ? '1.08500' : '0.00'} defaultValue={isEditing ? editingTrade.enterPrice || '' : ''} onChange={(e) => setFxEnter(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="exitPrice" className={labelClass}>Çıkış Fiyatı <span className="text-text-muted font-normal normal-case">(veya K/Z girin)</span></label>
                <input id="exitPrice" type="number" step="any" min="0" name="exitPrice" placeholder={fxSymbol ? '1.08750' : '0.00'} defaultValue={isEditing ? editingTrade.exitPrice || '' : ''} onChange={(e) => setFxExit(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="quantity" className={labelClass}>{fxSymbol ? 'Lot' : 'Miktar'}</label>
                <input id="quantity" type="number" step="any" name="quantity" placeholder={fxSymbol ? '0.10' : '1'} defaultValue={isEditing ? editingTrade.quantity : ''} onChange={(e) => setFxQty(e.target.value)} className={inputClass} />
                <p className="text-text-muted text-xs mt-0.5">Satış (short) işlemleri için negatif girin</p>
              </div>
              <div>
                <label htmlFor="manualPL" className={labelClass}>K/Z <span className="text-text-muted font-normal normal-case">(hesap para birimi, net)</span></label>
                <input id="manualPL" ref={manualPLRef} type="number" step="any" name="manualPL" placeholder="Fiyat yoksa zorunlu" defaultValue={isEditing && editingTrade.manualPL ? editingTrade.manualPL : ''} className={inputClass} />
              </div>
            </div>

            {/* Forex: pips, estimated P/L, commission and swap */}
            {showFxFields && (
              <div className="space-y-3 p-3 bg-bg-input border border-border rounded-lg">
                {fxSymbol && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-text-secondary">
                      Pip: <span className={`font-mono font-semibold ${fxPips == null ? 'text-text-muted' : fxPips >= 0 ? 'text-positive' : 'text-negative'}`}>{fxPips == null ? '—' : `${fxPips >= 0 ? '+' : ''}${fxPips.toFixed(1)}`}</span>
                    </span>
                    <span className="text-text-secondary">
                      Tahmini brüt K/Z (USD): <span className="font-mono font-semibold text-text-primary">{fxEstimate == null ? '—' : fxEstimate.toFixed(2)}</span>
                    </span>
                    {fxEstimate != null && (
                      <button
                        type="button"
                        className="px-2.5 py-1 bg-bg-surface border border-border text-text-secondary text-xs rounded-md hover:border-accent hover:text-text-primary transition-colors"
                        onClick={() => { if (manualPLRef.current) manualPLRef.current.value = fxEstimate.toFixed(2); }}
                      >
                        K/Z alanına yaz
                      </button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="commission" className={labelClass}>Komisyon <span className="text-text-muted font-normal normal-case">(isteğe bağlı)</span></label>
                    <input id="commission" type="number" step="any" name="commission" placeholder="0.00" defaultValue={isEditing && editingTrade.commission != null ? Math.abs(editingTrade.commission) : ''} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="swap" className={labelClass}>Swap <span className="text-text-muted font-normal normal-case">(isteğe bağlı, ±)</span></label>
                    <input id="swap" type="number" step="any" name="swap" placeholder="0.00" defaultValue={isEditing && editingTrade.swap != null ? editingTrade.swap : ''} className={inputClass} />
                  </div>
                </div>
                <p className="text-text-muted text-xs">
                  {fxSymbol && `${fxSymbol.symbol} için 1 pip = ${getPipSize(fxSymbol.symbol)}. `}K/Z alanına net sonucu (komisyon ve swap dahil) girerseniz komisyon/swap ayrıca düşülmez; K/Z boşsa fiyatlardan hesaplanan tutara eklenir.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="comments" className={labelClass}>Notlar</label>
              <textarea id="comments" name="comments" placeholder="İşlem notları..." rows="3" defaultValue={isEditing ? editingTrade.comments : ''} className={`${inputClass} resize-none`}></textarea>
            </div>

            {/* Account field */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Hesap (isteğe bağlı)</label>
              <input
                type="text"
                list="account-suggestions"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="örn. cTrader Demo"
                className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent transition-colors"
              />
              <datalist id="account-suggestions">
                {[...new Set((trades || []).map(t => t.account).filter(Boolean))].sort().map(a => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>

            {/* Eval checkbox */}
            <div>
              <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    isEval ? 'bg-accent border-accent' : 'border-border group-hover:border-accent/60'
                  }`}
                  onClick={() => setIsEval(prev => !prev)}
                >
                  {isEval && <Icons.Check className="w-3 h-3 text-accent-text" />}
                </div>
                <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors" onClick={() => setIsEval(prev => !prev)}>
                  Değerlendirme (eval) işlemi
                </span>
                {isEval && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-accent/15 text-accent">EVAL</span>
                )}
              </label>
              <p className="text-text-muted text-xs mt-1 ml-7">Bu işlemi değerlendirme (eval/challenge) hesabında açılmış olarak işaretleyin. Eval işlemleri analizlerden hariç tutulabilir.</p>
            </div>

            {/* Strategy rule checklist */}
            {tradeRules.length > 0 && (
              <div>
                <label className={labelClass}>Strateji Kontrol Listesi</label>
                <RuleChecklist
                  rules={tradeRules}
                  checks={isEditing ? tradeRuleChecks : pendingRuleChecks.map(ch => ({ ruleId: ch.ruleId, followed: ch.followed }))}
                  onToggle={handleRuleToggle}
                  loading={ruleChecksLoading}
                />
              </div>
            )}

            {/* Tags section */}
            <div>
              <label className={labelClass}>Etiketler</label>
              <div className="flex flex-wrap gap-2">
                {tags && tags.map(tag => {
                  const isSelected = selectedTags.includes(tag._id);
                  return (
                    <button
                      key={tag._id}
                      type="button"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        !isSelected ? 'bg-bg-input border-border text-text-secondary hover:text-text-primary' : ''
                      }`}
                      style={isSelected ? {
                        borderColor: tag.color,
                        backgroundColor: tag.color + '20',
                        color: tag.color,
                      } : undefined}
                      onClick={() => {
                        setSelectedTags(prev =>
                          prev.includes(tag._id)
                            ? prev.filter(id => id !== tag._id)
                            : [...prev, tag._id]
                        );
                      }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                      {tag.name}
                    </button>
                  );
                })}
                {!showNewTag && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border text-text-tertiary hover:text-text-primary hover:border-accent transition-colors"
                    onClick={() => setShowNewTag(true)}
                  >
                    <Icons.Plus className="w-3 h-3" />
                    Yeni Etiket
                  </button>
                )}
              </div>
              {showNewTag && (
                <div className="flex flex-wrap items-center gap-2 mt-2 p-3 bg-bg-input border border-border rounded-lg">
                  <input
                    type="text"
                    value={quickTagName}
                    onChange={(e) => setQuickTagName(e.target.value)}
                    placeholder="Etiket adı"
                    className="px-2.5 py-1.5 bg-bg-surface border border-border rounded-md text-text-primary text-xs focus:outline-none focus:border-accent transition-colors w-28"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickCreateTag(); } }}
                  />
                  <div className="flex gap-1">
                    {TAG_COLOR_PRESETS.slice(0, 4).map(color => (
                      <button
                        key={color}
                        type="button"
                        className={`w-5 h-5 rounded-full border-2 transition-all ${
                          quickTagColor === color ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setQuickTagColor(color)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="px-2.5 py-1.5 bg-accent text-accent-text text-xs font-semibold rounded-md hover:brightness-110 transition-all disabled:opacity-50"
                    onClick={handleQuickCreateTag}
                    disabled={creatingTag || !quickTagName.trim()}
                  >
                    {creatingTag ? '...' : 'Ekle'}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1.5 text-text-tertiary text-xs hover:text-text-primary transition-colors"
                    onClick={() => { setShowNewTag(false); setQuickTagName(''); }}
                  >
                    İptal
                  </button>
                </div>
              )}
            </div>

            {/* Screenshot section */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className={labelClass + ' mb-0'}>Ekran Görüntüsü</label>
              </div>
              <>
                  {!screenshot && !pastedImage && (
                    <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                      <Icons.Download className="w-8 h-8 text-text-muted mx-auto mb-2" />
                      <p className="text-text-tertiary text-sm mb-3">Görseli yapıştırın (Ctrl+V) veya buraya sürükleyin, ya da</p>
                      <button
                        type="button"
                        className="px-3 py-1.5 bg-bg-input border border-border text-text-secondary text-xs rounded-lg hover:border-accent hover:text-text-primary transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Dosya Seç
                      </button>
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                    </div>
                  )}

                  {pastedImage && !screenshot && (
                    <div className="space-y-3">
                      <img src={pastedImage} alt="Yapıştırılan ekran görüntüsü" className="rounded-lg max-h-48 w-full object-contain bg-bg-input cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLightboxOpen(true)} />
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 py-2 text-xs bg-accent text-accent-text font-semibold rounded-lg hover:brightness-110" onClick={() => { setMarkupSource(pastedImage); setIsMarkupOpen(true); }}>
                          İşaretle
                        </button>
                        <button type="button" className="flex-1 py-2 text-xs bg-bg-input border border-border text-text-primary rounded-lg hover:border-accent disabled:opacity-50" disabled={isUploading} onClick={async () => {
                          try {
                            const resized = await resizeImage(pastedImage);
                            const url = await uploadScreenshot(resized);
                            setScreenshot(url);
                            setPastedImage(null);
                          } catch (err) {
                            helper.handleError('Ekran görüntüsü yüklenemedi: ' + err.message);
                          }
                        }}>
                          {isUploading ? 'Yükleniyor...' : 'Olduğu Gibi Kullan'}
                        </button>
                        <button type="button" className="py-2 px-3 text-xs bg-bg-input border border-border text-text-secondary rounded-lg hover:text-negative hover:border-negative/50" onClick={() => { setScreenshot(null); setPastedImage(null); }}>
                          Kaldır
                        </button>
                      </div>
                    </div>
                  )}

                  {screenshot && (
                    <div className="space-y-3">
                      <img src={screenshot} alt="İşlem ekran görüntüsü" className="rounded-lg max-h-48 w-full object-contain bg-bg-input cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLightboxOpen(true)} />
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 py-2 text-xs bg-accent text-accent-text font-semibold rounded-lg hover:brightness-110" onClick={() => { setMarkupSource(screenshot); setIsMarkupOpen(true); }}>
                          İşaretle
                        </button>
                        <button type="button" className="py-2 px-3 text-xs bg-bg-input border border-border text-text-secondary rounded-lg hover:text-negative hover:border-negative/50" onClick={() => { setScreenshot(null); setPastedImage(null); }}>
                          Kaldır
                        </button>
                      </div>
                    </div>
                  )}
                </>
            </div>

            {/* Image Lightbox */}
            {lightboxOpen && (screenshot || pastedImage) && (
              <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxOpen(false)}>
                <button aria-label="Kapat" className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors" onClick={() => setLightboxOpen(false)}>
                  <Icons.X />
                </button>
                <img src={screenshot || pastedImage} alt="Ekran görüntüsü önizleme" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
              </div>
            )}

            <div id="errorDiv" className="hidden">
              <div className="p-3 bg-negative/10 border border-negative/30 rounded-lg">
                <span id="errorMessage" className="text-negative text-sm"></span>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-accent text-accent-text font-semibold rounded-lg hover:brightness-110 transition-all"
            >
              {isEditing ? 'İşlemi Güncelle' : 'İşlem Ekle'}
            </button>
          </form>
        </div>
      </div>

      <ScreenshotMarkupModal
        isOpen={isMarkupOpen}
        onClose={() => setIsMarkupOpen(false)}
        onSave={async (annotatedImage) => {
          try {
            const url = await uploadScreenshot(annotatedImage);
            setScreenshot(url);
            setPastedImage(null);
            setMarkupSource(null);
          } catch (err) {
            helper.handleError('Ekran görüntüsü yüklenemedi: ' + err.message);
          }
        }}
        initialImage={markupSource}
      />
    </>
  );
};

module.exports = TradeFormPopup;
