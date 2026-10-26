const React = require('react');
const { useEffect, useMemo, useState } = React;

const initialForm = { symbol: '', side: 'long', quantity: '1', entryPrice: '', exitPrice: '', multiplier: '1', fees: '0', note: '' };
const num = (n) => Number(n || 0).toFixed(2);

function PaperLabPage() {
  const [runs, setRuns] = useState([]);
  const [entries, setEntries] = useState([]);
  const [target, setTarget] = useState('1000');
  const [guard, setGuard] = useState('500');
  const [newAccountMode, setNewAccountMode] = useState('prop');
  const [program, setProgram] = useState('bem_one');
  const [accountSize, setAccountSize] = useState('5000');
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeRun = runs.find((r) => r.status === 'active') || null;
  const latestRun = runs[0] || null;
  const runEntries = useMemo(() => activeRun ? entries.filter((e) => e.runId === activeRun.id) : [], [entries, activeRun]);
  const stageRows = useMemo(() => [1,2,3].map((stage) => {
    const rows = runEntries.filter((e) => Number(e.stage) === stage);
    return { stage, rows, pnl: rows.reduce((a,e) => a + Number(e.pnl),0) };
  }), [runEntries]);

  const refresh = async () => {
    const res = await fetch('/api/paper-lab');
    if (!res.ok) throw new Error('Paper Lab kayıtları yüklenemedi.');
    const data = await res.json(); setRuns(data.runs || []); setEntries(data.entries || []);
  };
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);

  const startRun = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const payload = newAccountMode === 'prop' ? { mode: 'prop', program, initialBalance: Number(accountSize) } : { target: Number(target), lossGuard: guard === '' ? null : Number(guard) };
      const res = await fetch('/api/paper-lab/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Deneme başlatılamadı.');
      await refresh(); setForm(initialForm);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const submit = async (e) => {
    e.preventDefault(); if (!activeRun) return; setBusy(true); setError('');
    try {
      const res = await fetch('/api/paper-lab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, runId: activeRun.id }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Kayıt eklenemedi.');
      setForm(initialForm); await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    const res = await fetch(`/api/paper-lab/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) { setError('Kayıt silinemedi.'); return; }
    await refresh();
  };
  const stagePassed = (s) => s.pnl >= Number(activeRun?.target || 0) && s.rows.length > 0;

  return <main className="mx-auto max-w-6xl p-6 text-[var(--text-primary)]">
    <header className="mb-6"><div className="text-xs font-semibold uppercase tracking-widest text-violet-400">Deneysel alan · Paper trade</div><h1 className="mt-1 text-3xl font-bold">Deneme Laboratuvarı</h1><p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">Yalnızca elle girilen sanal kayıtlar. Broker bağlantısı veya emir gönderimi yoktur. Buradaki hedeflerin tamamlanması, fon sağlayıcı uygunluğu ya da fon satın alma hakkı anlamına gelmez.</p></header>

    {!activeRun && <form onSubmit={startRun} className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><h2 className="mb-3 font-semibold">Yeni paper hesap/denemesi</h2><div className="mb-3 flex flex-wrap gap-2"><button type="button" onClick={() => setNewAccountMode('prop')} className={`rounded border px-3 py-1.5 text-sm ${newAccountMode === 'prop' ? 'border-violet-500 text-violet-300' : 'border-[var(--border)]'}`}>BEM hesap simülatörü</button><button type="button" onClick={() => setNewAccountMode('stages')} className={`rounded border px-3 py-1.5 text-sm ${newAccountMode === 'stages' ? 'border-violet-500 text-violet-300' : 'border-[var(--border)]'}`}>3 aşamalı deneme</button></div>{newAccountMode === 'prop' ? <><div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Program<select value={program} onChange={(e) => setProgram(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2"><option value="bem_one">BEM One · %9 hedef</option><option value="bem_one_only">BEM One Only · %6 hedef, %30 tutarlılık</option></select></label>
      <label className="text-sm">Başlangıç bakiyesi<select value={accountSize} onChange={(e) => setAccountSize(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2"><option value="5000">$5,000</option><option value="10000">$10,000</option><option value="25000">$25,000</option></select></label>
      <button disabled={busy} className="self-end rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Paper hesabı aç</button>
    </div><p className="mt-2 text-xs text-[var(--text-secondary)]">Hesap ve oranlar yerel simülasyondur; BEM’de hesap satın almaz veya emir göndermez. Güncel BEM One/One Only kurallarına göre başlangıç parametreleri atanır.</p></> : <><div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Aşama başına kâr hedefi<input required min="0.01" step="any" type="number" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2" /></label>
      <label className="text-sm">İsteğe bağlı aşama zarar sınırı<input min="0.01" step="any" type="number" value={guard} onChange={(e) => setGuard(e.target.value)} placeholder="Sınırsız" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2" /></label>
      <button disabled={busy} className="self-end rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Yeni deneme başlat</button>
    </div><p className="mt-2 text-xs text-[var(--text-secondary)]">Yeni deneme önceki kayıtları silmez; her denemenin hedefi ve sonucu geçmişte saklanır.</p></>}</form>}

    {activeRun && <>
      {activeRun.mode === 'prop' ? <><section className="mb-5 grid gap-4 sm:grid-cols-4"><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><div className="text-sm text-[var(--text-secondary)]">{activeRun.program === 'bem_one' ? 'BEM One' : 'BEM One Only'} · {activeRun.initialBalance?.toLocaleString('en-US')} USD</div><div className="mt-2 text-xl font-bold">{activeRun.status === 'completed' ? 'Hedef tamamlandı' : 'Evaluation sürüyor'}</div><div className="text-xs">Kâr hedefi {num(activeRun.target)}</div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><div className="text-sm text-[var(--text-secondary)]">Sanal bakiye</div><div className="mt-2 text-3xl font-bold">{num(activeRun.balance)} USD</div><div className="text-xs">P/L {num(activeRun.totalProfit)} / {num(activeRun.target)}</div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><div className="text-sm text-[var(--text-secondary)]">Günlük taban</div><div className="mt-2 text-2xl font-bold">{num(activeRun.dailyFloor)} USD</div><div className="text-xs">Günlük DD {num(activeRun.maxDailyDrawdown)}</div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><div className="text-sm text-[var(--text-secondary)]">Trailing taban</div><div className="mt-2 text-2xl font-bold">{num(activeRun.totalFloor)} USD</div><div className="text-xs">Maksimum DD {num(activeRun.maxTotalDrawdown)}</div></div></section><div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-sm">{activeRun.consistencyLimit != null ? <>Tutarlılık: {(activeRun.consistencyScore * 100).toFixed(1)}% / {(activeRun.consistencyLimit * 100).toFixed(0)}% sınır · {activeRun.consistencyScore <= activeRun.consistencyLimit ? 'uygun' : 'hedefe devam edilmeli'}</> : <>BEM One evaluation aşamasında tutarlılık sınırı yok.</>}<p className="mt-2 text-xs text-[var(--text-secondary)]">Hesaplama kapanmış işlemlerin kayıt anındaki realized P/L’ine dayanır. Açık pozisyonların floating P/L’i, komisyon/swap ayrı girilmediyse ve anlık equity ihlalleri izlenmez; bu nedenle firma panelinin canlı risk motoruyla birebir aynı değildir.</p></div></> : <><section className="mb-5 grid gap-4 sm:grid-cols-3"><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><div className="text-sm text-[var(--text-secondary)]">Deneme durumu</div><div className="mt-2 text-xl font-bold">Aşama {activeRun.currentStage} / 3</div><div className="text-xs">Hedef {num(activeRun.target)} · zarar sınırı {activeRun.lossGuard == null ? 'yok' : num(activeRun.lossGuard)}</div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><div className="text-sm text-[var(--text-secondary)]">Geçerli aşama net P/L</div><div className="mt-2 text-3xl font-bold">{num(stageRows[activeRun.currentStage - 1]?.pnl)}</div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><div className="text-sm text-[var(--text-secondary)]">Tamamlanma</div><div className="mt-2 text-3xl font-bold">{activeRun.currentStage - 1} / 3</div></div></section>
      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><h2 className="mb-3 font-semibold">Deneme aşamaları</h2><div className="grid gap-2 sm:grid-cols-3">{stageRows.map((s) => <div key={s.stage} className="rounded-lg border border-[var(--border)] p-3"><div className="flex justify-between"><b>Aşama {s.stage}</b><span className={stagePassed(s) ? 'text-emerald-400' : 'text-[var(--text-secondary)]'}>{stagePassed(s) ? 'Hedef tamamlandı' : activeRun.currentStage === s.stage ? 'Devam ediyor' : 'Bekliyor'}</span></div><div className="mt-2 text-sm">Net P/L: {num(s.pnl)} · {s.rows.length} kayıt</div><div className="mt-1 text-xs text-[var(--text-secondary)]">Hedef {num(activeRun.target)}</div></div>)}</div></section></>}
      <form onSubmit={submit} className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><h2 className="mb-3 font-semibold">Paper kaydı ekle · sunucu aşamayı belirler</h2><div className="grid gap-3 sm:grid-cols-4">
        <input required placeholder="Sembol" maxLength="32" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2" />
        <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2"><option value="long">Long</option><option value="short">Short</option></select>
        {['quantity','entryPrice','exitPrice','multiplier','fees'].map((key) => <input key={key} required={!['fees','multiplier'].includes(key)} type="number" step="any" min={key === 'fees' ? '0' : key === 'quantity' || key === 'entryPrice' || key === 'exitPrice' || key === 'multiplier' ? '0.000001' : undefined} placeholder={{ quantity:'Miktar', entryPrice:'Giriş fiyatı', exitPrice:'Çıkış fiyatı', multiplier:'Birim çarpanı', fees:'Masraf' }[key]} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2" />)}
        <input placeholder="Not (isteğe bağlı)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2 sm:col-span-2" />
        <button disabled={busy} className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Kaydediliyor…' : 'Paper kaydı ekle'}</button>
      </div><p className="mt-3 text-xs text-[var(--text-secondary)]">P/L kullanıcı tanımlı birimlerdedir: (çıkış − giriş) × miktar × birim çarpanı − masraf. Para birimleri ve sözleşme değerleri dönüştürülmez.</p></form>
      {activeRun.mode === 'stages' && activeRun.currentStage === 3 && stagePassed(stageRows[2]) && <div className="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 font-semibold text-emerald-300">3/3 paper hedefleri tamamlandı. Bu sonuç fon sağlayıcı uygunluğu veya fon satın alma garantisi değildir.</div>}
    </>}
    {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}

    {latestRun && <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"><h2 className="font-semibold">Son deneme durumu</h2><p className="mt-1 text-sm">{latestRun.mode === 'prop' ? `${latestRun.program === 'bem_one' ? 'BEM One' : 'BEM One Only'} · $${Number(latestRun.initialBalance).toLocaleString('en-US')} · ${latestRun.status === 'failed' ? 'Kural ihlali ile başarısız' : latestRun.status === 'completed' ? 'Evaluation hedefi tamamlandı' : 'Aktif'}` : latestRun.status === 'failed' ? `Aşama ${latestRun.currentStage} başarısız; yeni deneme başlatabilirsiniz.` : latestRun.status === 'completed' ? '3/3 paper hedefleri tamamlandı.' : `Etkin · Aşama ${latestRun.currentStage}`}</p></section>}

    <section className="overflow-hidden rounded-xl border border-[var(--border)]"><h2 className="bg-[var(--bg-secondary)] p-4 font-semibold">Paper kayıt geçmişi</h2><div className="divide-y divide-[var(--border)]">{entries.map((r) => { const owner = runs.find((run) => run.id === r.runId); const canDelete = !r.runId || owner?.status === 'active'; return <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><b>{r.symbol}</b> · {r.side} · {owner?.mode === 'prop' ? `${owner.program === 'bem_one' ? 'BEM One' : 'BEM One Only'} $${Number(owner.initialBalance).toLocaleString('en-US')}` : `Aşama ${r.stage}`}<div className="text-xs text-[var(--text-secondary)]">Deneme: {owner?.createdAt?.slice(0,10) || 'eski kayıt'} · {r.quantity} × {r.multiplier} × ({r.side === 'short' ? `${r.entryPrice} − ${r.exitPrice}` : `${r.exitPrice} − ${r.entryPrice}`}) · masraf {r.fees} · {r.note}</div></div><div className="flex items-center gap-3"><b className={r.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{num(r.pnl)} birim</b><button disabled={!canDelete} onClick={() => remove(r.id)} className="text-xs text-[var(--text-secondary)] hover:text-rose-400 disabled:opacity-40">{canDelete ? 'Sil' : 'Kapanmış · kilitli'}</button></div></div>;})}{entries.length === 0 && <p className="p-6 text-sm text-[var(--text-secondary)]">Henüz paper kaydı yok.</p>}</div></section>
  </main>;
}

module.exports = PaperLabPage;
