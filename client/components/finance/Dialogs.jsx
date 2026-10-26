const React = require('react');
const { useState, useRef } = React;
const api = require('./api');
const { Modal, Field, inputCls, btnPrimary, btnGhost, I } = require('./ui');
const { parseInput, todayKey, TYPE_LABELS, COLORS, fmtNum } = require('./format');

const ErrorLine = ({ error }) => (error ? <p role="alert" className="text-xs text-negative mt-3">{error}</p> : null);

/* ── Account create / edit ─────────────────────────────── */
const AccountDialog = ({ account, onClose, onSaved, onDeleted }) => {
  const editing = !!account;
  const [name, setName] = useState(account ? account.name : '');
  const [type, setType] = useState(account ? account.type : 'banka');
  const [currency, setCurrency] = useState(account ? account.currency : 'TRY');
  const [opening, setOpening] = useState(account ? String(account.openingBalance).replace('.', ',') : '');
  const [color, setColor] = useState(account ? account.color : COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const ob = opening.trim() === '' ? 0 : parseInput(opening);
    if (!name.trim()) return setError('Hesap adı zorunlu.');
    if (!Number.isFinite(ob)) return setError('Açılış bakiyesi sayı olmalı.');
    setBusy(true); setError('');
    try {
      const body = { name: name.trim(), type, currency, openingBalance: ob, color };
      const saved = editing ? await api.updateAccount(account.id, body) : await api.createAccount(body);
      onSaved(saved, !editing);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  const archive = async () => {
    setBusy(true);
    try { await api.updateAccount(account.id, { archived: true }); onSaved(null, false); } catch (err) { setError(err.message); setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api.deleteAccount(account.id, account.txCount > 0); onDeleted(account); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Hesabı düzenle' : 'Yeni hesap'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Hesap adı"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ör. Ziraat vadesiz" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tür">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              {Object.keys(TYPE_LABELS).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Para birimi" hint={editing && account.txCount > 0 ? 'İşlemi olan hesapta değişmez.' : undefined}>
            <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={editing && account.txCount > 0}>
              <option value="TRY">TRY (₺)</option><option value="USD">USD ($)</option><option value="EUR">EUR (€)</option>
            </select>
          </Field>
        </div>
        <Field label="Açılış bakiyesi" hint={type === 'trade' ? 'Trade hesabında genelde 0 bırakın; para yatırmaları işlem olarak girin.' : undefined}>
          <input className={inputCls} inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0,00" />
        </Field>
        <div>
          <span className="block text-[11px] font-medium text-text-tertiary mb-1">Renk</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Renk ${c}`} aria-pressed={color === c}
                className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-text-primary' : 'border-transparent'}`} style={{ background: c }} />
            ))}
          </div>
        </div>
        <ErrorLine error={error} />
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex gap-2">
            {editing && !confirmDel && <button type="button" onClick={() => setConfirmDel(true)} className="text-xs text-negative hover:underline">Sil</button>}
            {editing && !confirmDel && <button type="button" onClick={archive} disabled={busy} className="text-xs text-text-tertiary hover:text-text-primary hover:underline">Arşivle</button>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>Vazgeç</button>
            <button type="submit" disabled={busy} className={btnPrimary}>{editing ? 'Kaydet' : 'Ekle'}</button>
          </div>
        </div>
        {confirmDel && (
          <div className="rounded-lg border border-negative/40 bg-negative/10 p-3 text-xs text-text-primary">
            {account.txCount > 0 ? `Bu hesaptaki ${account.txCount} işlem de silinecek (transferlerin karşı kayıtları dahil).` : 'Hesap silinecek.'} Emin misiniz?
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={remove} disabled={busy} className="px-3 py-1.5 rounded-lg bg-negative text-white text-xs font-medium">Evet, sil</button>
              <button type="button" onClick={() => setConfirmDel(false)} className={btnGhost + ' !py-1.5 !text-xs'}>Vazgeç</button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
};

/* ── Categories manager ────────────────────────────────── */
const CategoryDialog = ({ categories, onClose, onChanged }) => {
  const [kind, setKind] = useState('gider');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = categories.filter((c) => c.kind === kind && !c.archived);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Kategori adı zorunlu.');
    setBusy(true); setError('');
    try { await api.createCategory({ name: name.trim(), kind, icon: icon.trim() || undefined, color }); setName(''); setIcon(''); await onChanged(); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const remove = async (c) => {
    setBusy(true); setError('');
    try { await api.deleteCategory(c.id); await onChanged(); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <Modal title="Kategoriler" subtitle="Kullanılan kategoriler silinmez, arşivlenir." onClose={onClose}>
      <div className="flex rounded-lg border border-border overflow-hidden mb-3 w-fit" role="group">
        {['gider', 'gelir'].map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`px-4 py-1.5 text-xs font-medium ${kind === k ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary'}`}>{k === 'gider' ? 'Gider' : 'Gelir'}</button>
        ))}
      </div>
      <ul className="space-y-1 max-h-60 overflow-y-auto mb-4">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-bg-input/60">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
            <span className="text-sm text-text-primary flex-1 truncate">{c.icon ? `${c.icon} ` : ''}{c.name}</span>
            {c.system ? <span className="text-[10px] text-text-muted">sistem</span> : (
              <button type="button" onClick={() => remove(c)} disabled={busy} aria-label={`${c.name} sil`} className="text-text-muted hover:text-negative"><I.Trash className="w-3.5 h-3.5" /></button>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="text-xs text-text-tertiary px-2">Kategori yok.</li>}
      </ul>
      <form onSubmit={add} className="space-y-3">
        <div className="grid grid-cols-[3.5rem_1fr] gap-2">
          <input className={inputCls + ' text-center'} value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} placeholder="😀" aria-label="Emoji" />
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Yeni kategori adı" aria-label="Kategori adı" />
        </div>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Renk ${c}`} aria-pressed={color === c}
              className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-text-primary' : 'border-transparent'}`} style={{ background: c }} />
          ))}
        </div>
        <ErrorLine error={error} />
        <div className="flex justify-end"><button type="submit" disabled={busy} className={btnPrimary}><I.Plus className="w-3.5 h-3.5" />Ekle</button></div>
      </form>
    </Modal>
  );
};

/* ── Manual currency rates ─────────────────────────────── */
const RatesDialog = ({ rates, onClose, onSaved }) => {
  const get = (c) => { const r = rates.find((x) => x.currency === c); return r && r.toTry > 0 ? String(r.toTry).replace('.', ',') : ''; };
  const [usd, setUsd] = useState(get('USD'));
  const [eur, setEur] = useState(get('EUR'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const body = {};
    if (usd.trim()) { const v = parseInput(usd); if (!(v > 0)) return setError('USD kuru sıfırdan büyük olmalı.'); body.USD = v; }
    if (eur.trim()) { const v = parseInput(eur); if (!(v > 0)) return setError('EUR kuru sıfırdan büyük olmalı.'); body.EUR = v; }
    setBusy(true); setError('');
    try { await api.setRates(body); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  const upd = (c) => { const r = rates.find((x) => x.currency === c); return r && r.updatedAt ? `Son güncelleme: ${new Date(r.updatedAt).toLocaleDateString('tr-TR')}` : 'Henüz girilmedi'; };
  return (
    <Modal title="Döviz kurları" subtitle="Dövizli hesapların TL karşılığı bu kurlarla hesaplanır. Kurlar elle girilir, otomatik güncellenmez." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="1 USD = ? ₺" hint={upd('USD')}><input autoFocus className={inputCls} inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="Ör. 41,50" /></Field>
        <Field label="1 EUR = ? ₺" hint={upd('EUR')}><input className={inputCls} inputMode="decimal" value={eur} onChange={(e) => setEur(e.target.value)} placeholder="Ör. 48,20" /></Field>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Vazgeç</button>
          <button type="submit" disabled={busy} className={btnPrimary}>Kaydet</button>
        </div>
      </form>
    </Modal>
  );
};

/* ── CSV import / export ───────────────────────────────── */
const ImportDialog = ({ accounts, month, onClose, onImported }) => {
  const [accountId, setAccountId] = useState(accounts[0] ? accounts[0].id : '');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [signMode, setSignMode] = useState('auto');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return setError('Dosya en fazla 3 MB olabilir.');
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result || '')); setFileName(f.name); setPreview(null); setError(''); };
    reader.onerror = () => setError('Dosya okunamadı.');
    reader.readAsText(f, 'utf-8');
  };

  const run = async (dryRun) => {
    if (!accountId) return setError('Önce bir hesap seçin.');
    if (!csv.trim()) return setError('CSV dosyası seçin ya da metni yapıştırın.');
    setBusy(true); setError('');
    try {
      const res = await api.importCsv({ csv, accountId, signMode, dryRun });
      if (dryRun) setPreview(res); else onImported(res);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const download = async (m) => {
    setBusy(true); setError('');
    try {
      const blob = await api.exportCsv(m);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = m ? `finans-${m}.csv` : 'finans.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <Modal title="CSV içe / dışa aktar" subtitle="Sütunlar otomatik algılanır: Tarih, Tutar, Açıklama, (Kategori). 1.234,56 ve gg.aa.yyyy biçimleri desteklenir." onClose={onClose} wide>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Hedef hesap">
          <select className={inputCls} value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
        <Field label="Tutar işareti" hint="Dosyada eksi (-) tutar varsa otomatik: eksi = gider, artı = gelir.">
          <select className={inputCls} value={signMode} onChange={(e) => { setSignMode(e.target.value); setPreview(null); }}>
            <option value="auto">Otomatik</option><option value="gider">Hepsi gider</option><option value="gelir">Hepsi gelir</option>
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="hidden" />
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileRef.current && fileRef.current.click()} className={btnGhost}><I.Upload className="w-3.5 h-3.5" />Dosya seç</button>
          <span className="text-xs text-text-tertiary truncate">{fileName || 'veya aşağıya yapıştırın'}</span>
        </div>
        <textarea className={inputCls + ' mt-2 h-28 font-mono text-xs'} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={'Tarih;Tutar;Açıklama;Kategori\n01.10.2026;-1.234,56;Market;Gıda'} aria-label="CSV metni" />
      </div>
      {preview && (
        <div className="mt-3 rounded-lg border border-border bg-bg-input/60 p-3 text-xs text-text-secondary space-y-1">
          <p className="text-text-primary font-medium">Önizleme: {preview.imported} yeni işlem içe aktarılacak</p>
          <p>{preview.duplicates} tekrar (atlanır){preview.skipped ? `, ${preview.skipped} transfer satırı atlanır` : ''}{preview.createdCategories ? `, ${preview.createdCategories} yeni kategori oluşturulur` : ''}.</p>
          {preview.errors.length > 0 && (
            <p className="text-warning">{preview.errors.length} satır okunamadı: {preview.errors.slice(0, 3).map((x) => `satır ${x.line} (${x.reason})`).join(', ')}{preview.errors.length > 3 ? '…' : ''}</p>
          )}
        </div>
      )}
      <ErrorLine error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
        <div className="flex gap-2">
          <button type="button" onClick={() => download(month)} disabled={busy} className={btnGhost}><I.Download className="w-3.5 h-3.5" />Bu ayı indir</button>
          <button type="button" onClick={() => download('')} disabled={busy} className={btnGhost}>Tümünü indir</button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => run(true)} disabled={busy || !csv.trim()} className={btnGhost}>Önizle</button>
          <button type="button" onClick={() => run(false)} disabled={busy || !preview || preview.imported === 0} className={btnPrimary}>İçe aktar</button>
        </div>
      </div>
    </Modal>
  );
};

/* ── Edit a transaction ────────────────────────────────── */
const TxEditDialog = ({ tx, accounts, categories, onClose, onSaved }) => {
  const isTransfer = tx.kind === 'transfer';
  const [amount, setAmount] = useState(String(tx.amount).replace('.', ','));
  const [toAmount, setToAmount] = useState(tx.toAmount != null ? String(tx.toAmount).replace('.', ',') : '');
  const [date, setDate] = useState(tx.date);
  const [accountId, setAccountId] = useState(tx.accountId);
  const [toAccountId, setToAccountId] = useState(tx.transferAccountId || '');
  const [categoryId, setCategoryId] = useState(tx.categoryId || '');
  const [payee, setPayee] = useState(tx.payee || '');
  const [note, setNote] = useState(tx.note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cats = categories.filter((c) => c.kind === tx.kind && (!c.archived || c.id === tx.categoryId));

  const submit = async (e) => {
    e.preventDefault();
    const a = parseInput(amount);
    if (!(a > 0)) return setError('Tutar sıfırdan büyük olmalı.');
    const body = { amount: a, date, accountId, payee, note };
    if (isTransfer) {
      body.transferAccountId = toAccountId;
      const t = parseInput(toAmount);
      if (toAmount.trim() && t > 0) body.toAmount = t;
    } else body.categoryId = categoryId || null;
    setBusy(true); setError('');
    try { await api.updateTransaction(tx.id, body); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };

  const accOpts = accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>);
  return (
    <Modal title={isTransfer ? 'Transferi düzenle' : 'İşlemi düzenle'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tutar"><input autoFocus className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Tarih"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label={isTransfer ? 'Kaynak hesap' : 'Hesap'}><select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accOpts}</select></Field>
        {isTransfer ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hedef hesap"><select className={inputCls} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>{accOpts}</select></Field>
            <Field label="Hedefe geçen tutar" hint="Farklı para biriminde doldurun."><input className={inputCls} inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label="Kategori">
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Kategorisiz</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Alıcı / açıklama"><input className={inputCls} value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={120} /></Field>
        <Field label="Not"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Vazgeç</button>
          <button type="submit" disabled={busy} className={btnPrimary}>Kaydet</button>
        </div>
      </form>
    </Modal>
  );
};

/* ── Recurring item form ───────────────────────────────── */
const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const RecurringDialog = ({ accounts, categories, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('gider');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts[0] ? accounts[0].id : '');
  const [categoryId, setCategoryId] = useState('');
  const [every, setEvery] = useState('monthly');
  const [day, setDay] = useState(String(new Date().getDate()));
  const [wday, setWday] = useState('1');
  const [startDate, setStartDate] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cats = categories.filter((c) => c.kind === kind && !c.archived && !c.system);

  const submit = async (e) => {
    e.preventDefault();
    const a = parseInput(amount);
    if (!name.trim()) return setError('Ad zorunlu.');
    if (!(a > 0)) return setError('Tutar sıfırdan büyük olmalı.');
    setBusy(true); setError('');
    try {
      await api.createRecurring({
        name: name.trim(), kind, amount: a, accountId, categoryId: categoryId || null, every,
        day: every === 'weekly' ? Number(wday) : Number(day), startDate,
      });
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title="Yinelenen işlem" subtitle="Vadesi gelen kayıtlar sayfa açıldığında otomatik işlenir (tekrar eklenmez)." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex rounded-lg border border-border overflow-hidden w-fit" role="group">
          {['gider', 'gelir'].map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setCategoryId(''); }}
              className={`px-4 py-1.5 text-xs font-medium ${kind === k ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary'}`}>{k === 'gider' ? 'Gider' : 'Gelir'}</button>
          ))}
        </div>
        <Field label="Ad"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ör. Netflix, Yurt kirası" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tutar"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></Field>
          <Field label="Hesap"><select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></Field>
        </div>
        <Field label="Kategori">
          <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Kategorisiz</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sıklık"><select className={inputCls} value={every} onChange={(e) => setEvery(e.target.value)}><option value="monthly">Her ay</option><option value="weekly">Her hafta</option></select></Field>
          {every === 'monthly'
            ? <Field label="Ayın günü"><input type="number" min="1" max="31" className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            : <Field label="Haftanın günü"><select className={inputCls} value={wday} onChange={(e) => setWday(e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>}
        </div>
        <Field label="Başlangıç tarihi"><input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Vazgeç</button>
          <button type="submit" disabled={busy} className={btnPrimary}>Ekle</button>
        </div>
      </form>
    </Modal>
  );
};

module.exports = { AccountDialog, CategoryDialog, RatesDialog, ImportDialog, TxEditDialog, RecurringDialog, DAYS, fmtNum };
