const React = require('react');
const { useState, useMemo, useRef, useEffect } = React;
const api = require('./api');
const { FadeIn, Stagger, StaggerItem, CountUp, HoverLift, Bar } = require('../ui/motion');
const { getTradePL } = require('../../utils/analytics');
const { useSound } = require('../../utils/sound');
const { inputCls, btnPrimary, btnGhost, cardCls, I, Field } = require('./ui');
const { Donut, MonthBars } = require('./Charts');
const { fmtMoney, fmtNum, fmtDate, parseInput, todayKey, TYPE_LABELS, SYMBOLS } = require('./format');
const { DAYS } = require('./Dialogs');

/* ── Stat cards ────────────────────────────────────────── */
const StatCards = ({ summary }) => {
  const s = summary || { income: 0, expense: 0, net: 0, savingsRate: 0 };
  const items = [
    { label: 'Gelir', value: s.income, tone: 'text-positive', fmt: (n) => fmtMoney(n, 'TRY', 0) },
    { label: 'Gider', value: s.expense, tone: 'text-negative', fmt: (n) => fmtMoney(n, 'TRY', 0) },
    { label: 'Net', value: s.net, tone: s.net < 0 ? 'text-negative' : 'text-text-primary', fmt: (n) => fmtMoney(n, 'TRY', 0) },
    { label: 'Tasarruf oranı', value: s.savingsRate, tone: s.savingsRate < 0 ? 'text-negative' : 'text-text-primary', fmt: (n) => `%${fmtNum(n, 1)}` },
  ];
  return (
    <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((it) => (
        <StaggerItem key={it.label} className={`${cardCls} px-4 py-3.5`}>
          <p className="text-[11px] text-text-tertiary font-medium">{it.label}</p>
          <p className={`text-xl sm:text-2xl font-bold tabular-nums mt-1 ${it.tone}`}><CountUp value={it.value} format={it.fmt} /></p>
        </StaggerItem>
      ))}
    </Stagger>
  );
};

/* ── Accounts row ──────────────────────────────────────── */
const AccountsRow = ({ accounts, total, missingRates, onAdd, onEdit, onRates }) => (
  <section aria-label="Hesaplar">
    <div className="flex items-center justify-between mb-2">
      <h2 className="text-sm font-semibold text-text-primary">Hesaplar</h2>
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-tertiary tabular-nums">Toplam <span className="text-text-primary font-semibold">{fmtMoney(total, 'TRY', 0)}</span></span>
        <button type="button" onClick={onRates} className="text-xs text-accent hover:underline">Kurlar</button>
      </div>
    </div>
    {missingRates.length > 0 && (
      <button type="button" onClick={onRates} className="w-full text-left mb-2 text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
        {missingRates.join(', ')} kuru girilmedi; TL toplamlarına dahil edilmiyor. Kur girmek için tıklayın.
      </button>
    )}
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {accounts.map((a) => (
        <HoverLift key={a.id} className={`${cardCls} min-w-[200px] flex-1 max-w-[280px] px-4 py-3 cursor-pointer`} onClick={() => onEdit(a)}>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
            <span className="text-sm font-medium text-text-primary truncate">{a.name}</span>
            <span className="ml-auto text-[10px] text-text-muted flex-shrink-0">{TYPE_LABELS[a.type] || a.type}</span>
          </div>
          <p className={`text-lg font-bold tabular-nums mt-2 ${a.balance < 0 ? 'text-negative' : 'text-text-primary'}`}>{fmtMoney(a.balance, a.currency)}</p>
          <p className="text-[11px] text-text-tertiary tabular-nums h-4">
            {a.currency !== 'TRY' ? (a.balanceTRY != null ? `≈ ${fmtMoney(a.balanceTRY, 'TRY', 0)}` : 'Kur yok') : ''}
          </p>
        </HoverLift>
      ))}
      <button type="button" onClick={onAdd} className="min-w-[140px] rounded-xl border border-dashed border-border text-text-secondary hover:text-text-primary hover:border-accent/50 flex flex-col items-center justify-center gap-1 text-xs py-3 transition-colors">
        <I.Plus className="w-4 h-4" />Hesap ekle
      </button>
    </div>
  </section>
);

/* ── Trade account card ────────────────────────────────── */
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const TradeCard = ({ tradeAccounts, accounts, trades, month, onNavigate, onChanged, notify }) => {
  const { play } = useSound();
  const [selId, setSelId] = useState('');
  const [mode, setMode] = useState(null); // 'yatir' | 'cek'
  const [amount, setAmount] = useState('');
  const [other, setOther] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const acct = tradeAccounts.find((a) => a.id === selId) || tradeAccounts[0];

  const pl = useMemo(() => {
    const list = Array.isArray(trades) ? trades : [];
    const today = todayKey();
    let total = 0, monthPL = 0, todayPL = 0;
    list.forEach((t) => {
      let v = 0;
      try { v = Number(getTradePL(t)) || 0; } catch (e) { v = 0; }
      total += v;
      const d = new Date(t.exitTime || t.enterTime);
      if (isNaN(d.getTime())) return;
      const k = localKey(d);
      if (k.slice(0, 7) === month) monthPL += v;
      if (k === today) todayPL += v;
    });
    return { total, monthPL, todayPL, count: list.length };
  }, [trades, month]);

  const submit = async (e) => {
    e.preventDefault();
    const a = parseInput(amount);
    if (!(a > 0)) return notify('Tutar sıfırdan büyük olmalı.', 'error');
    setBusy(true);
    try {
      const date = todayKey();
      const src = accounts.find((x) => x.id === other);
      if (!src) {
        const sys = (await api.categories()).find((c) => c.system && c.kind === (mode === 'yatir' ? 'gelir' : 'gider'));
        await api.createTransaction({
          accountId: acct.id, date, amount: a, kind: mode === 'yatir' ? 'gelir' : 'gider',
          categoryId: sys ? sys.id : undefined, payee: mode === 'yatir' ? 'Trade para yatırma' : 'Trade para çekme',
        });
      } else {
        const t = parseInput(toAmount);
        const body = mode === 'yatir'
          ? { kind: 'transfer', accountId: src.id, transferAccountId: acct.id, date, amount: a, payee: 'Trade para yatırma' }
          : { kind: 'transfer', accountId: acct.id, transferAccountId: src.id, date, amount: a, payee: 'Trade para çekme' };
        if (src.currency !== acct.currency && t > 0) body.toAmount = t;
        await api.createTransaction(body);
      }
      play('pop');
      setAmount(''); setToAmount(''); setMode(null);
      notify(mode === 'yatir' ? 'Para yatırma kaydedildi.' : 'Para çekme kaydedildi.');
      onChanged();
    } catch (err) { notify(err.message, 'error'); }
    setBusy(false);
  };

  if (!acct) {
    return (
      <section className={`${cardCls} p-5`} aria-label="Trade hesabı">
        <h2 className="text-sm font-semibold text-text-primary">Trade hesabı</h2>
        <p className="text-xs text-text-tertiary mt-1.5 leading-relaxed">Trade hesabı türünde bir hesap ekleyin; yatırdığınız parayı buraya işleyin, günlükteki toplam P/L ile birlikte tahmini bakiyeniz görünür.</p>
      </section>
    );
  }

  const cur = acct.currency;
  const equity = acct.balance + pl.total;
  const srcOptions = accounts.filter((a) => a.id !== acct.id);
  const picked = accounts.find((x) => x.id === other);
  const sign = (n) => (n > 0 ? 'text-positive' : n < 0 ? 'text-negative' : 'text-text-primary');

  return (
    <section className={`${cardCls} p-5`} aria-label="Trade hesabı">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Trade hesabı</h2>
          {tradeAccounts.length > 1 && (
            <select aria-label="Trade hesabı seç" className="bg-bg-input border border-border rounded-md px-2 py-1 text-xs text-text-secondary" value={acct.id} onChange={(e) => setSelId(e.target.value)}>
              {tradeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
        <button type="button" onClick={() => onNavigate && onNavigate('trades')} className="text-xs text-accent hover:underline">Günlüğe git</button>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div>
          <p className="text-[11px] text-text-tertiary">Net yatırılan</p>
          <p className="text-base sm:text-lg font-bold text-text-primary tabular-nums mt-0.5">{fmtMoney(acct.balance, cur)}</p>
        </div>
        <div>
          <p className="text-[11px] text-text-tertiary">Günlük P/L toplamı</p>
          <p className={`text-base sm:text-lg font-bold tabular-nums mt-0.5 ${sign(pl.total)}`}>{fmtMoney(pl.total, cur)}</p>
        </div>
        <div>
          <p className="text-[11px] text-text-tertiary">Trade hesabı (tahmini)</p>
          <p className={`text-base sm:text-lg font-bold tabular-nums mt-0.5 ${equity < 0 ? 'text-negative' : 'text-text-primary'}`}>{fmtMoney(equity, cur)}</p>
        </div>
      </div>
      <p className="text-[11px] text-text-tertiary mt-3 tabular-nums">
        Bu ay {fmtMoney(pl.monthPL, cur)} · bugün {fmtMoney(pl.todayPL, cur)} · {pl.count} işlem
      </p>
      <p className="text-[10px] text-text-muted mt-1 leading-relaxed">
        Tahmin = net yatırılan + günlükteki P/L. Günlük kayıtlarına dayanır; gerçek broker bakiyesiyle farklı olabilir. P/L değerleri hesap para biriminde ({cur}) varsayılır.
      </p>

      {!mode ? (
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => { setMode('yatir'); setOther(srcOptions[0] ? srcOptions[0].id : ''); }} className={btnGhost}><I.Plus className="w-3.5 h-3.5" />Para yatır</button>
          <button type="button" onClick={() => { setMode('cek'); setOther(srcOptions[0] ? srcOptions[0].id : ''); }} className={btnGhost}>Para çek</button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-28"><Field label={mode === 'yatir' ? `Yatırılan (${cur})` : `Çekilen (${cur})`}>
            <input autoFocus className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </Field></div>
          <div className="min-w-[150px] flex-1"><Field label={mode === 'yatir' ? 'Kaynak hesap' : 'Hedef hesap'}>
            <select className={inputCls} value={other} onChange={(e) => setOther(e.target.value)}>
              {srcOptions.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              <option value="">Hesap dışı (kayıtsız)</option>
            </select>
          </Field></div>
          {picked && picked.currency !== cur && (
            <div className="w-32"><Field label={`Karşı tutar (${picked.currency})`}>
              <input className={inputCls} inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} placeholder="Kur varsa boş" />
            </Field></div>
          )}
          <button type="submit" disabled={busy} className={btnPrimary}>Kaydet</button>
          <button type="button" onClick={() => setMode(null)} className={btnGhost}>Vazgeç</button>
        </form>
      )}
    </section>
  );
};

/* ── Spending donut + 6-month bars ─────────────────────── */
const ChartsRow = ({ summary }) => {
  const s = summary;
  const slices = useMemo(() => {
    if (!s) return [];
    const list = s.byCategory.map((c, i) => ({ key: c.categoryId || `n${i}`, name: c.name, color: c.color, amount: c.amount, icon: c.icon }));
    if (list.length <= 7) return list;
    const head = list.slice(0, 6);
    const rest = list.slice(6).reduce((a, c) => a + c.amount, 0);
    return head.concat([{ key: 'rest', name: 'Diğerleri', color: '#475569', amount: rest }]);
  }, [s]);
  const total = s ? s.expense : 0;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <section className={`${cardCls} p-5`} aria-label="Aylık harcama dağılımı">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Harcama dağılımı</h2>
        {slices.length === 0 ? (
          <p className="text-sm text-text-tertiary py-10 text-center">Bu ay henüz gider kaydı yok.</p>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <Donut slices={slices} centerLabel="Toplam gider" centerValue={fmtMoney(total, 'TRY', 0)} />
            <ul className="flex-1 w-full space-y-1.5 min-w-0">
              {slices.map((c) => (
                <li key={c.key} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                  <span className="text-text-secondary truncate flex-1">{c.icon ? `${c.icon} ` : ''}{c.name}</span>
                  <span className="text-text-primary tabular-nums">{fmtMoney(c.amount, 'TRY', 0)}</span>
                  <span className="text-text-muted tabular-nums w-10 text-right">%{total > 0 ? Math.round((c.amount / total) * 100) : 0}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section className={`${cardCls} p-5`} aria-label="Son 6 ay">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Gelir ve gider, son 6 ay</h2>
        {s && s.last6Months.some((m) => m.income > 0 || m.expense > 0)
          ? <MonthBars data={s.last6Months} />
          : <p className="text-sm text-text-tertiary py-10 text-center">Grafik için işlem ekleyin.</p>}
      </section>
    </div>
  );
};

/* ── Budgets ───────────────────────────────────────────── */
const barColor = (pct) => (pct >= 100 ? 'rgb(var(--negative))' : pct >= 80 ? 'rgb(var(--warning))' : 'rgb(var(--positive))');

const BudgetList = ({ month, budgets, categories, onChanged, notify }) => {
  const [catId, setCatId] = useState('');
  const [limit, setLimit] = useState('');
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState('');
  const used = new Set(budgets.map((b) => b.categoryId));
  const free = categories.filter((c) => c.kind === 'gider' && !c.archived && !c.system && !used.has(c.id));

  const save = async (categoryId, raw, after) => {
    const v = raw === 0 ? 0 : parseInput(raw);
    if (v !== 0 && !(v > 0)) return notify('Limit sıfırdan büyük bir sayı olmalı.', 'error');
    try { await api.setBudget({ month, categoryId, limit: v }); after && after(); onChanged(); } catch (err) { notify(err.message, 'error'); }
  };
  const copy = async () => {
    try {
      const r = await api.copyBudgets(month);
      notify(r.copied > 0 ? `${r.copied} bütçe önceki aydan kopyalandı.` : 'Kopyalanacak yeni bütçe yok.');
      onChanged();
    } catch (err) { notify(err.message, 'error'); }
  };

  const totalLimit = budgets.reduce((a, b) => a + b.limit, 0);
  const totalSpent = budgets.reduce((a, b) => a + b.spent, 0);

  return (
    <section className={`${cardCls} p-5`} aria-label="Bütçeler">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-semibold text-text-primary">Aylık bütçe</h2>
        <button type="button" onClick={copy} className="text-xs text-accent hover:underline">Önceki aydan kopyala</button>
      </div>
      {budgets.length > 0 && <p className="text-[11px] text-text-tertiary mb-3 tabular-nums">Toplam {fmtMoney(totalSpent, 'TRY', 0)} / {fmtMoney(totalLimit, 'TRY', 0)}</p>}
      {budgets.length === 0 ? (
        <p className="text-sm text-text-tertiary py-4">Kategori başına aylık limit belirleyin; harcadıkça çubuk dolar, limite yaklaşınca sarıya, aşınca kırmızıya döner.</p>
      ) : (
        <ul className="space-y-3 mb-4">
          {budgets.map((b) => {
            const pct = b.limit > 0 ? (b.spent / b.limit) * 100 : 0;
            return (
              <li key={b.categoryId}>
                <div className="flex items-center gap-2 text-xs mb-1">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: b.color }} />
                  <span className="text-text-primary font-medium truncate">{b.icon ? `${b.icon} ` : ''}{b.name}</span>
                  <span className="ml-auto tabular-nums text-text-secondary whitespace-nowrap">
                    {fmtMoney(b.spent, 'TRY', 0)} /{' '}
                    {editId === b.categoryId ? (
                      <input autoFocus className="w-20 bg-bg-input border border-accent/60 rounded px-1.5 py-0.5 text-xs text-text-primary" inputMode="decimal" value={editVal}
                        onChange={(e) => setEditVal(e.target.value)} onBlur={() => setEditId(null)}
                        onKeyDown={(e) => { if (e.key === 'Enter') save(b.categoryId, editVal, () => setEditId(null)); if (e.key === 'Escape') setEditId(null); }} aria-label={`${b.name} limiti`} />
                    ) : (
                      <button type="button" className="hover:text-accent underline decoration-dotted" onClick={() => { setEditId(b.categoryId); setEditVal(String(b.limit).replace('.', ',')); }} aria-label={`${b.name} limitini düzenle`}>{fmtMoney(b.limit, 'TRY', 0)}</button>
                    )}
                  </span>
                  <button type="button" aria-label={`${b.name} bütçesini kaldır`} onClick={() => save(b.categoryId, 0)} className="text-text-muted hover:text-negative"><I.X className="w-3 h-3" /></button>
                </div>
                <Bar value={pct} color={barColor(pct)} height={6} />
                <p className={`text-[10px] mt-1 tabular-nums ${b.remaining < 0 ? 'text-negative' : 'text-text-muted'}`}>
                  {b.remaining < 0 ? `${fmtMoney(-b.remaining, 'TRY', 0)} aşıldı` : `${fmtMoney(b.remaining, 'TRY', 0)} kaldı`} · %{Math.round(pct)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {free.length > 0 && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!catId) return notify('Kategori seçin.', 'error'); save(catId, limit, () => { setCatId(''); setLimit(''); }); }}>
          <select aria-label="Bütçe kategorisi" className={inputCls} value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">Kategori seç…</option>
            {free.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}
          </select>
          <input aria-label="Limit" className={inputCls + ' !w-28'} inputMode="decimal" placeholder="Limit ₺" value={limit} onChange={(e) => setLimit(e.target.value)} />
          <button type="submit" className={btnPrimary}>Ekle</button>
        </form>
      )}
    </section>
  );
};

/* ── Quick add + transactions table ────────────────────── */
const QuickAdd = ({ accounts, categories, onAdded, notify }) => {
  const { play } = useSound();
  const [kind, setKind] = useState('gider');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState(accounts[0] ? accounts[0].id : '');
  const [toId, setToId] = useState('');
  const [date, setDate] = useState(todayKey());
  const [payee, setPayee] = useState('');
  const [busy, setBusy] = useState(false);
  const amountRef = useRef(null);

  useEffect(() => { if (!accounts.find((a) => a.id === accountId) && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);
  const cats = categories.filter((c) => c.kind === kind && !c.archived && !c.system);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const a = parseInput(amount);
    if (!(a > 0)) return notify('Tutar sıfırdan büyük olmalı.', 'error');
    if (!accountId) return notify('Önce bir hesap ekleyin.', 'error');
    const body = { kind, amount: a, accountId, date, payee: payee.trim() };
    if (kind === 'transfer') {
      if (!toId) return notify('Hedef hesabı seçin.', 'error');
      body.transferAccountId = toId;
    } else if (categoryId) body.categoryId = categoryId;
    setBusy(true);
    try {
      await api.createTransaction(body);
      play('pop');
      setAmount(''); setPayee('');
      onAdded();
      if (amountRef.current) amountRef.current.focus();
    } catch (err) { notify(err.message, 'error'); }
    setBusy(false);
  };

  const sel = inputCls + ' !w-auto';
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2" aria-label="Hızlı ekle">
      <div className="flex rounded-lg border border-border overflow-hidden flex-shrink-0" role="group" aria-label="İşlem türü">
        {[['gider', 'Gider'], ['gelir', 'Gelir'], ['transfer', 'Transfer']].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setCategoryId(''); }}
            className={`px-3 py-2 text-xs font-medium ${kind === k ? (k === 'gider' ? 'bg-negative/15 text-negative' : k === 'gelir' ? 'bg-positive/15 text-positive' : 'bg-info/15 text-info') : 'text-text-secondary hover:text-text-primary'}`}>{l}</button>
        ))}
      </div>
      <input ref={amountRef} aria-label="Tutar" className={inputCls + ' !w-28'} inputMode="decimal" placeholder="Tutar" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input aria-label="Açıklama" className={inputCls + ' !w-40 flex-1 min-w-[120px]'} placeholder="Açıklama (opsiyonel)" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={120} />
      {kind !== 'transfer' ? (
        <select aria-label="Kategori" className={sel} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Kategori</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}
        </select>
      ) : (
        <select aria-label="Hedef hesap" className={sel} value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">Hedef hesap</option>
          {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      )}
      <select aria-label={kind === 'transfer' ? 'Kaynak hesap' : 'Hesap'} className={sel} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
      </select>
      <input aria-label="Tarih" type="date" className={inputCls + ' !w-auto'} value={date} onChange={(e) => setDate(e.target.value)} />
      <button type="submit" disabled={busy} className={btnPrimary}><I.Plus className="w-3.5 h-3.5" />Ekle</button>
    </form>
  );
};

const TransactionsPanel = ({
  txs, total, loading, filters, setFilters, accounts, categories, onEdit, onDelete, onMore, quickAdd, onManageCategories,
}) => {
  const setF = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const amountCell = (t) => {
    if (t.kind === 'transfer') return <span className="text-info">{fmtMoney(t.amount, t.accountCurrency)}</span>;
    return <span className={t.kind === 'gelir' ? 'text-positive' : 'text-text-primary'}>{t.kind === 'gelir' ? '+' : '-'}{fmtMoney(t.amount, t.accountCurrency)}</span>;
  };
  return (
    <section className={`${cardCls} p-5`} aria-label="İşlemler">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-text-primary">İşlemler <span className="text-text-muted font-normal">({total})</span></h2>
        <button type="button" onClick={onManageCategories} className="text-xs text-accent hover:underline">Kategorileri yönet</button>
      </div>
      {quickAdd}
      <div className="flex flex-wrap items-center gap-2 mt-4 mb-3">
        <input aria-label="İşlem ara" className={inputCls + ' !w-48'} placeholder="Ara…" value={filters.q} onChange={(e) => setF({ q: e.target.value })} />
        <select aria-label="Hesap filtresi" className={inputCls + ' !w-auto'} value={filters.accountId} onChange={(e) => setF({ accountId: e.target.value })}>
          <option value="">Tüm hesaplar</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select aria-label="Kategori filtresi" className={inputCls + ' !w-auto'} value={filters.categoryId} onChange={(e) => setF({ categoryId: e.target.value })}>
          <option value="">Tüm kategoriler</option>
          {categories.filter((c) => !c.system).map((c) => <option key={c.id} value={c.id}>{c.kind === 'gelir' ? '↑ ' : ''}{c.name}</option>)}
        </select>
        {(filters.q || filters.accountId || filters.categoryId) && (
          <button type="button" className="text-xs text-text-tertiary hover:text-text-primary" onClick={() => setFilters({ q: '', accountId: '', categoryId: '' })}>Temizle</button>
        )}
      </div>
      {txs.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-text-secondary">{loading ? 'Yükleniyor…' : 'Bu ay için işlem yok.'}</p>
          {!loading && <p className="text-xs text-text-tertiary mt-1">Yukarıdan hızlıca ekleyin ya da CSV içe aktarın.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-[11px] text-text-tertiary text-left">
                <th className="font-medium px-2 py-1.5">Tarih</th>
                <th className="font-medium px-2 py-1.5">Açıklama</th>
                <th className="font-medium px-2 py-1.5">Kategori</th>
                <th className="font-medium px-2 py-1.5">Hesap</th>
                <th className="font-medium px-2 py-1.5 text-right">Tutar</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="border-t border-border/60 group hover:bg-bg-input/40">
                  <td className="px-2 py-2 text-text-secondary tabular-nums whitespace-nowrap">{fmtDate(t.date)}</td>
                  <td className="px-2 py-2 text-text-primary max-w-[220px]">
                    <span className="block truncate" title={t.note || t.payee}>{t.kind === 'transfer' ? (t.payee || 'Transfer') : (t.payee || <span className="text-text-muted">-</span>)}</span>
                    {t.recurringId && <span className="text-[10px] text-text-muted">yinelenen</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {t.kind === 'transfer'
                      ? <span className="text-xs text-info">{t.accountName} → {t.transferAccountName}</span>
                      : t.categoryName
                        ? <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary"><span className="w-2 h-2 rounded-full" style={{ background: t.categoryColor || '#64748b' }} />{t.categoryIcon ? `${t.categoryIcon} ` : ''}{t.categoryName}</span>
                        : <span className="text-xs text-text-muted">Kategorisiz</span>}
                  </td>
                  <td className="px-2 py-2 text-xs text-text-tertiary whitespace-nowrap">{t.kind === 'transfer' && !filters.accountId ? '' : t.accountName}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                    {amountCell(t)}
                    {t.kind === 'transfer' && t.toAmount != null && t.toAmount !== t.amount && <span className="block text-[10px] text-text-muted font-normal">→ {fmtNum(t.toAmount)}</span>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" aria-label="Düzenle" onClick={() => onEdit(t)} className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-input"><I.Edit className="w-3.5 h-3.5" /></button>
                      <button type="button" aria-label="Sil" onClick={() => onDelete(t)} className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-negative hover:bg-bg-input"><I.Trash className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {txs.length < total && <div className="text-center mt-3"><button type="button" className={btnGhost} onClick={onMore}>Daha fazla göster ({total - txs.length})</button></div>}
    </section>
  );
};

/* ── Recurring ─────────────────────────────────────────── */
const RecurringList = ({ items, onAdd, onToggle, onDelete }) => (
  <section className={`${cardCls} p-5`} aria-label="Yinelenen işlemler">
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-text-primary">Yinelenen işlemler</h2>
      <button type="button" onClick={onAdd} className="text-xs text-accent hover:underline inline-flex items-center gap-1"><I.Plus className="w-3 h-3" />Ekle</button>
    </div>
    {items.length === 0 ? (
      <p className="text-sm text-text-tertiary">Abonelik, kira, burs gibi düzenli kayıtları bir kez tanımlayın; vadesi gelince otomatik işlenir.</p>
    ) : (
      <ul className="divide-y divide-border/60">
        {items.map((r) => (
          <li key={r.id} className={`flex items-center gap-3 py-2.5 ${r.active ? '' : 'opacity-50'}`}>
            <I.Repeat className="w-4 h-4 text-text-muted flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary truncate">{r.name}</p>
              <p className="text-[11px] text-text-tertiary truncate">
                {r.every === 'weekly' ? `Her ${DAYS[r.day]}` : `Her ayın ${r.day}. günü`} · {r.accountName || '-'}{r.categoryName ? ` · ${r.categoryName}` : ''} · sonraki {fmtDate(r.nextDate)}
              </p>
            </div>
            <span className={`text-sm tabular-nums font-medium ${r.kind === 'gelir' ? 'text-positive' : 'text-text-primary'}`}>{r.kind === 'gelir' ? '+' : '-'}{fmtNum(r.amount)}</span>
            <button type="button" onClick={() => onToggle(r)} className="text-[11px] text-text-tertiary hover:text-text-primary" aria-label={r.active ? 'Duraklat' : 'Sürdür'}>{r.active ? 'Duraklat' : 'Sürdür'}</button>
            <button type="button" onClick={() => onDelete(r)} aria-label={`${r.name} sil`} className="text-text-muted hover:text-negative"><I.Trash className="w-3.5 h-3.5" /></button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

module.exports = { StatCards, AccountsRow, TradeCard, ChartsRow, BudgetList, QuickAdd, TransactionsPanel, RecurringList, FadeIn, SYMBOLS };
