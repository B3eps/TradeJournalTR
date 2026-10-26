const React = require('react');
const { useState, useEffect, useCallback, useRef, useMemo } = React;
const api = require('../finance/api');
const { FadeIn } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const { btnPrimary, btnGhost, cardCls, I, ToastStack } = require('../finance/ui');
const { currentMonth, shiftMonth, monthLabel, todayKey } = require('../finance/format');
const {
  StatCards, AccountsRow, TradeCard, ChartsRow, BudgetList, QuickAdd, TransactionsPanel, RecurringList,
} = require('../finance/Sections');
const {
  AccountDialog, CategoryDialog, RatesDialog, ImportDialog, TxEditDialog, RecurringDialog,
} = require('../finance/Dialogs');

// =====================================================
// FİNANS: kişisel bütçe + trade günlüğü bağlantısı
// Data: /api/finance/* (hesaplar, kategoriler, işlemler, bütçeler, yinelenenler, kurlar)
// =====================================================

const PAGE_SIZE = 50;
let toastSeq = 0;

const FinancePage = ({ onNavigate, trades }) => {
  const { play } = useSound();
  const [month, setMonth] = useState(currentMonth());
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [rates, setRates] = useState([]);
  const [txs, setTxs] = useState([]);
  const [txTotal, setTxTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState({ q: '', accountId: '', categoryId: '' });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null); // {type, ...}
  const timers = useRef({});
  const undoers = useRef({});
  const reqSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);

  /* ── toasts ── */
  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    delete undoers.current[id];
    setToasts((l) => l.filter((t) => t.id !== id));
  }, []);
  const notify = useCallback((message, tone, extra) => {
    const id = ++toastSeq;
    const duration = extra && extra.undo ? 6000 : 3500;
    if (extra && extra.undo) undoers.current[id] = extra.undo;
    setToasts((l) => l.slice(-2).concat([{ id, message, tone: tone || 'ok', actionLabel: extra && extra.undo ? 'Geri al' : null, duration }]));
    timers.current[id] = setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  /* ── data ── */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  const txParams = useMemo(() => ({
    month, accountId: filters.accountId, categoryId: filters.categoryId, q: debouncedQ, limit,
  }), [month, filters.accountId, filters.categoryId, debouncedQ, limit]);

  const loadAll = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      // Summary first: it materializes due recurring items, so the later reads include them.
      const s = await api.summary(month, todayKey());
      const [acc, cats, bud, rec, rts, tx] = await Promise.all([
        api.accounts(), api.categories(), api.budgets(month), api.recurring(), api.rates(), api.transactions(txParams),
      ]);
      if (!mounted.current || seq !== reqSeq.current) return;
      setSummary(s); setAccounts(acc); setCategories(cats); setBudgets(bud); setRecurring(rec); setRates(rts);
      setTxs(tx.transactions || []); setTxTotal(tx.total || 0);
      setLoadError('');
    } catch (err) {
      if (mounted.current && seq === reqSeq.current) setLoadError(err.message);
    }
    if (mounted.current && seq === reqSeq.current) setLoading(false);
  }, [month, txParams]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setLimit(PAGE_SIZE); }, [month, filters.accountId, filters.categoryId, debouncedQ]);

  /* ── actions ── */
  const closeDialog = useCallback(() => setDialog(null), []);

  const deleteTx = async (t) => {
    try {
      const res = await api.deleteTransaction(t.id);
      const d = (res && res.deleted) || t;
      play('delete');
      const restore = async () => {
        const body = d.kind === 'transfer'
          ? { kind: 'transfer', accountId: d.accountId, transferAccountId: d.transferAccountId, toAmount: d.toAmount || undefined }
          : { kind: d.kind, accountId: d.accountId, categoryId: d.categoryId || undefined };
        Object.assign(body, { date: d.date, amount: d.amount, payee: d.payee, note: d.note });
        try { await api.createTransaction(body); notify('İşlem geri alındı.'); loadAll(); } catch (err) { notify(err.message, 'error'); }
      };
      notify('İşlem silindi.', 'ok', { undo: restore });
      loadAll();
    } catch (err) { notify(err.message, 'error'); }
  };

  const onToastAction = (id) => {
    const fn = undoers.current[id];
    dismiss(id);
    if (fn) fn();
  };

  const toggleRecurring = async (r) => {
    try { await api.updateRecurring(r.id, { active: !r.active }); loadAll(); } catch (err) { notify(err.message, 'error'); }
  };
  const deleteRecurring = async (r) => {
    try { await api.deleteRecurring(r.id); notify('Yinelenen işlem silindi.'); loadAll(); } catch (err) { notify(err.message, 'error'); }
  };

  const tradeAccounts = accounts.filter((a) => a.type === 'trade');
  const hasAccounts = accounts.length > 0;
  const noData = !loading && !loadError && !hasAccounts;
  const isCurrentMonth = month === currentMonth();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Finans</h1>
            <p className="text-text-secondary text-sm mt-0.5">Kişisel gelir-gider takibi, aylık bütçe ve trade hesabın.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-bg-surface" role="group" aria-label="Ay seçimi">
              <button type="button" aria-label="Önceki ay" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary"><I.Left /></button>
              <span className="px-2 min-w-[120px] text-center text-sm font-medium text-text-primary">{monthLabel(month)}</span>
              <button type="button" aria-label="Sonraki ay" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary"><I.Right /></button>
            </div>
            {!isCurrentMonth && <button type="button" className={btnGhost} onClick={() => setMonth(currentMonth())}>Bu ay</button>}
            <button type="button" className={btnGhost} onClick={() => setDialog({ type: 'import' })} disabled={!hasAccounts}><I.Upload className="w-3.5 h-3.5" />CSV</button>
            <button type="button" className={btnPrimary} onClick={() => setDialog({ type: 'account' })}><I.Plus className="w-3.5 h-3.5" />Hesap</button>
          </div>
        </div>
      </FadeIn>

      {loadError && (
        <div role="alert" className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 text-warning text-sm">
          <I.Alert className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{loadError}</span>
          <button type="button" onClick={loadAll} className="text-xs font-semibold underline">Tekrar dene</button>
        </div>
      )}

      {noData ? (
        <FadeIn className={`${cardCls} p-10 text-center`}>
          <p className="text-lg font-semibold text-text-primary">Finans takibine başla</p>
          <p className="text-sm text-text-secondary mt-1.5 max-w-md mx-auto">Önce bir hesap ekle (banka, nakit, trade hesabı…). Sonra gelir ve giderlerini gir, kategorilere aylık bütçe koy; trade hesabını günlüğündeki P/L ile birlikte takip et.</p>
          <div className="flex justify-center gap-2 mt-5">
            <button type="button" className={btnPrimary} onClick={() => setDialog({ type: 'account' })}><I.Plus className="w-3.5 h-3.5" />İlk hesabı ekle</button>
          </div>
        </FadeIn>
      ) : (
        <>
          <StatCards summary={summary} />
          {summary && (
            <AccountsRow
              accounts={accounts} total={summary.accountsTotalTRY} missingRates={summary.missingRates || []}
              onAdd={() => setDialog({ type: 'account' })} onEdit={(a) => setDialog({ type: 'account', account: a })} onRates={() => setDialog({ type: 'rates' })}
            />
          )}
          <div className="grid lg:grid-cols-2 gap-4">
            <TradeCard tradeAccounts={tradeAccounts} accounts={accounts} trades={trades} month={month} onNavigate={onNavigate} onChanged={loadAll} notify={notify} />
            <BudgetList month={month} budgets={budgets} categories={categories} onChanged={loadAll} notify={notify} />
          </div>
          <ChartsRow summary={summary} />
          {hasAccounts && (
            <TransactionsPanel
              txs={txs} total={txTotal} loading={loading} filters={filters} setFilters={setFilters}
              accounts={accounts} categories={categories}
              onEdit={(t) => setDialog({ type: 'tx', tx: t })} onDelete={deleteTx} onMore={() => setLimit((l) => l + PAGE_SIZE)}
              onManageCategories={() => setDialog({ type: 'categories' })}
              quickAdd={<QuickAdd accounts={accounts} categories={categories} notify={notify} onAdded={loadAll} />}
            />
          )}
          {hasAccounts && (
            <RecurringList items={recurring} onAdd={() => setDialog({ type: 'recurring' })} onToggle={toggleRecurring} onDelete={deleteRecurring} />
          )}
        </>
      )}

      <p className="text-[10px] text-text-muted text-center pb-4">Bu sayfa yalnızca kişisel kayıt tutmak içindir; yatırım tavsiyesi veya sinyal içermez.</p>

      {dialog && dialog.type === 'account' && (
        <AccountDialog
          account={dialog.account} onClose={closeDialog}
          onSaved={(saved, created) => { closeDialog(); notify(created ? 'Hesap eklendi.' : 'Hesap güncellendi.'); loadAll(); }}
          onDeleted={() => { closeDialog(); notify('Hesap silindi.'); loadAll(); }}
        />
      )}
      {dialog && dialog.type === 'categories' && (
        <CategoryDialog categories={categories} onClose={closeDialog} onChanged={loadAll} />
      )}
      {dialog && dialog.type === 'rates' && (
        <RatesDialog rates={rates} onClose={closeDialog} onSaved={() => { closeDialog(); notify('Kurlar kaydedildi.'); loadAll(); }} />
      )}
      {dialog && dialog.type === 'import' && (
        <ImportDialog
          accounts={accounts} month={month} onClose={closeDialog}
          onImported={(r) => { closeDialog(); notify(`${r.imported} işlem içe aktarıldı${r.duplicates ? `, ${r.duplicates} tekrar atlandı` : ''}.`); loadAll(); }}
        />
      )}
      {dialog && dialog.type === 'tx' && (
        <TxEditDialog tx={dialog.tx} accounts={accounts} categories={categories} onClose={closeDialog} onSaved={() => { closeDialog(); notify('İşlem güncellendi.'); loadAll(); }} />
      )}
      {dialog && dialog.type === 'recurring' && (
        <RecurringDialog accounts={accounts} categories={categories} onClose={closeDialog} onSaved={() => { closeDialog(); notify('Yinelenen işlem eklendi.'); loadAll(); }} />
      )}

      <ToastStack toasts={toasts} onAction={onToastAction} onDismiss={dismiss} />
    </div>
  );
};

module.exports = FinancePage;
