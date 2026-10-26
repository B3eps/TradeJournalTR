// Full-width study screen. Space reveals, 1-4 rate (Space = İyi once revealed), Z undoes, Esc leaves.
const React = require('react');
const { useState, useEffect, useRef, useCallback, useMemo } = React;
const { motion } = require('framer-motion');
const { FadeIn, Bar, CountUp, useAnimationsEnabled } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const CI = require('./CardIcons');
const CardMarkdown = require('./CardMarkdown');
const U = require('./cardUtils');
const api = require('./api');

const LEARN_AHEAD_MS = 20 * 60 * 1000;

const RATINGS = [
  { value: 1, key: 'again', label: 'Tekrar', cls: 'border-negative/40 text-negative hover:bg-negative/10', bar: 'rgb(var(--negative, 239 68 68))' },
  { value: 2, key: 'hard', label: 'Zor', cls: 'border-warning/40 text-warning hover:bg-warning/10', bar: 'rgb(var(--warning, 245 158 11))' },
  { value: 3, key: 'good', label: 'İyi', cls: 'border-accent/50 text-accent hover:bg-accent/10', bar: 'rgb(var(--accent))' },
  { value: 4, key: 'easy', label: 'Kolay', cls: 'border-positive/40 text-positive hover:bg-positive/10', bar: 'rgb(var(--positive, 34 197 94))' },
];

const Kbd = ({ children }) => (
  <kbd className="px-1.5 py-0.5 rounded border border-border bg-bg-input text-[10px] font-mono text-text-tertiary">{children}</kbd>
);

const CountChip = ({ n, label, tone }) => (
  <span className={`inline-flex items-baseline gap-1 text-xs ${tone}`}>
    <span className="font-mono font-semibold tabular-nums">{n}</span>
    <span className="text-[11px] text-text-muted">{label}</span>
  </span>
);

const ReviewScreen = ({ deckId, deckName, onExit, onChanged }) => {
  const animate = useAnimationsEnabled();
  const { play } = useSound();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [history, setHistory] = useState([]);
  const [ratings, setRatings] = useState([0, 0, 0, 0, 0]);
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const shownAt = useRef(Date.now());
  const startedAt = useRef(Date.now());
  const busyRef = useRef(false);

  const current = queue[0] || null;

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getQueue(deckId || undefined, 200);
      setQueue(res.cards);
      setRevealed(false);
      shownAt.current = Date.now();
      setFinished(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  useEffect(() => { shownAt.current = Date.now(); }, [current && current.id, queue.length]);

  const reveal = useCallback(() => {
    if (!current || revealed) return;
    play('click');
    setRevealed(true);
  }, [current, revealed, play]);

  const rate = useCallback(async (rating) => {
    if (!current || !revealed || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await api.review(current.id, rating, Date.now() - shownAt.current, deckId || undefined);
      const card = res.card;
      const due = new Date(card.due).getTime();
      const requeue = (card.state === 1 || card.state === 3) && due - Date.now() < LEARN_AHEAD_MS;
      const rest = queue.slice(1);
      const next = requeue ? rest.concat([{ ...card, nextIntervals: res.nextIntervals }]) : rest;
      setQueue(next);
      setHistory((h) => h.concat([{ id: current.id, rating }]));
      setRatings((r) => r.map((v, i) => (i === rating ? v + 1 : v)));
      setReviewed((n) => n + 1);
      setRevealed(false);
      if (rating >= 3) play('complete'); else play(rating === 1 ? 'pop' : 'click');
      if (next.length === 0) {
        setElapsed(Date.now() - startedAt.current);
        setFinished(true);
        play('complete-all');
        if (onChanged) onChanged();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [current, revealed, queue, deckId, play, onChanged]);

  const undo = useCallback(async () => {
    if (busyRef.current || history.length === 0) return;
    const entry = history[history.length - 1];
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await api.undoReview(entry.id, deckId || undefined);
      setQueue((q) => [{ ...res.card, nextIntervals: res.nextIntervals }].concat(q.filter((c) => c.id !== entry.id)));
      setHistory((h) => h.slice(0, -1));
      setRatings((r) => r.map((v, i) => (i === entry.rating ? Math.max(0, v - 1) : v)));
      setReviewed((n) => Math.max(0, n - 1));
      setRevealed(false);
      setFinished(false);
      play('click');
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [history, deckId, play, onChanged]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || U.isTyping(e)) return;
      const k = e.key;
      if (k === 'Escape') { onExit(); return; }
      if (k === 'z' || k === 'Z') { e.preventDefault(); undo(); return; }
      if (finished || !current) return;
      if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        if (!revealed) reveal(); else rate(3);
      } else if (revealed && k >= '1' && k <= '4') {
        e.preventDefault();
        rate(Number(k));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, revealed, finished, reveal, rate, undo, onExit]);

  const counts = useMemo(() => {
    const c = { new: 0, learning: 0, review: 0 };
    queue.forEach((x) => {
      if (x.state === 0) c.new++; else if (x.state === 2) c.review++; else c.learning++;
    });
    return c;
  }, [queue]);

  const total = reviewed + queue.length;
  const pct = total > 0 ? (reviewed / total) * 100 : 0;
  const cloze = current ? U.hasCloze(current.front) : false;
  const clozeBackExtra = current && cloze && current.back && current.back.trim() !== '—';

  const header = (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onExit} className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
        <CI.Back className="w-4 h-4" /> Desteler
      </button>
      <div className="flex-1 text-center">
        <span className="text-sm font-semibold text-text-primary">{deckName || 'Tüm desteler'}</span>
      </div>
      <button
        type="button"
        onClick={undo}
        disabled={history.length === 0 || busy}
        title="Son tekrarı geri al (Z)"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-input disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <CI.Undo className="w-3.5 h-3.5" /> Geri al <Kbd>Z</Kbd>
      </button>
    </div>
  );

  const banner = error ? (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-negative/40 bg-negative/10 text-sm text-negative" role="alert">
      <CI.Alert className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{error}</span>
      <button type="button" onClick={current ? () => setError('') : loadQueue} className="text-xs font-semibold underline">{current ? 'Kapat' : 'Yeniden dene'}</button>
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4" aria-busy="true">
        {header}
        <div className="h-72 rounded-2xl bg-bg-surface border border-border animate-pulse" />
      </div>
    );
  }

  if (finished || !current) {
    const good = ratings[2] + ratings[3] + ratings[4];
    const acc = reviewed > 0 ? Math.round((good / reviewed) * 100) : 0;
    const nothing = reviewed === 0;
    return (
      <div className="max-w-xl mx-auto space-y-4">
        {header}
        {banner}
        <FadeIn>
          <div className="bg-bg-surface border border-border rounded-2xl px-6 py-10 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-positive/15 text-positive flex items-center justify-center">
              <CI.Check className="w-7 h-7" strokeWidth={2.5} />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-text-primary">{nothing ? 'Şimdilik çalışılacak kart yok' : 'Tebrikler, kuyruk bitti'}</h2>
            <p className="mt-1 text-sm text-text-tertiary">
              {nothing ? 'Yeni kart ekleyebilir ya da daha sonra tekrar bakabilirsin.' : 'Bugünlük bu desteyi tamamladın.'}
            </p>
            {!nothing && (
              <>
                <div className="mt-6 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-bg-input px-3 py-2.5">
                    <div className="text-xl font-bold font-mono text-text-primary"><CountUp value={reviewed} /></div>
                    <div className="text-[11px] text-text-muted">Tekrar</div>
                  </div>
                  <div className="rounded-xl bg-bg-input px-3 py-2.5">
                    <div className="text-xl font-bold font-mono text-text-primary"><CountUp value={acc} />%</div>
                    <div className="text-[11px] text-text-muted">Doğru</div>
                  </div>
                  <div className="rounded-xl bg-bg-input px-3 py-2.5">
                    <div className="text-xl font-bold font-mono text-text-primary">{U.formatDuration(elapsed)}</div>
                    <div className="text-[11px] text-text-muted">Süre</div>
                  </div>
                </div>
                <div className="mt-5 space-y-1.5 text-left">
                  {RATINGS.map((r) => (
                    <div key={r.value} className="flex items-center gap-3 text-xs">
                      <span className="w-12 text-text-tertiary">{r.label}</span>
                      <Bar value={reviewed ? (ratings[r.value] / reviewed) * 100 : 0} color={r.bar} height={6} className="flex-1" />
                      <span className="w-6 text-right font-mono text-text-secondary">{ratings[r.value]}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="mt-7 flex items-center justify-center gap-2">
              <button type="button" onClick={onExit} className="px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-accent-text hover:bg-accent/90">Desteye dön</button>
              <button type="button" onClick={loadQueue} className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-text-secondary hover:bg-bg-input">Yeniden kontrol et</button>
            </div>
          </div>
        </FadeIn>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {header}
      <div className="space-y-1.5">
        <Bar value={pct} height={6} />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-muted">{reviewed} / {total}</span>
          <div className="flex items-center gap-3">
            <CountChip n={counts.new} label="yeni" tone="text-positive" />
            <CountChip n={counts.learning} label="öğrenme" tone="text-warning" />
            <CountChip n={counts.review} label="tekrar" tone="text-accent" />
          </div>
        </div>
      </div>
      {banner}

      <div style={{ perspective: 1200 }}>
        <motion.div
          key={`${current.id}-${revealed ? 'b' : 'f'}-${reviewed}`}
          initial={animate ? { rotateX: -80, opacity: 0 } : false}
          animate={{ rotateX: 0, opacity: 1 }}
          transition={{ duration: animate ? 0.22 : 0, ease: [0.22, 0.61, 0.36, 1] }}
          className="bg-bg-surface border border-border rounded-2xl shadow-xl min-h-[320px] px-6 sm:px-12 py-10 flex flex-col items-center justify-center text-center"
        >
          {!revealed ? (
            <>
              <div className="text-[10px] uppercase tracking-widest text-text-muted mb-4">Soru</div>
              <CardMarkdown text={current.front} mode="front" className="text-xl sm:text-2xl leading-relaxed text-text-primary" />
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-widest text-accent mb-4">Cevap</div>
              {cloze ? (
                <>
                  <CardMarkdown text={current.front} mode="back" className="text-xl sm:text-2xl leading-relaxed text-text-primary" />
                  {clozeBackExtra && (
                    <div className="mt-5 pt-5 border-t border-border w-full">
                      <CardMarkdown text={current.back} className="text-base text-text-secondary" />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="w-full text-sm text-text-muted pb-4 mb-5 border-b border-border">
                    <CardMarkdown text={current.front} mode="off" className="text-text-tertiary" />
                  </div>
                  <CardMarkdown text={current.back} className="text-xl sm:text-2xl leading-relaxed text-text-primary" />
                </>
              )}
            </>
          )}
        </motion.div>
      </div>

      <div className="min-h-[76px]">
        {!revealed ? (
          <button
            type="button"
            onClick={reveal}
            className="w-full py-4 text-sm font-semibold rounded-xl bg-accent text-accent-text hover:bg-accent/90 transition-colors"
          >
            Cevabı göster <Kbd>Space</Kbd>
          </button>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                type="button"
                disabled={busy}
                onClick={() => rate(r.value)}
                className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl border bg-bg-surface transition-colors disabled:opacity-50 ${r.cls}`}
              >
                <span className="text-[11px] font-mono text-text-muted">{current.nextIntervals ? current.nextIntervals[r.key] : ''}</span>
                <span className="text-sm font-semibold">{r.label}</span>
                <Kbd>{r.value}</Kbd>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-center text-[11px] text-text-muted">
        <Kbd>Space</Kbd> göster / İyi · <Kbd>1</Kbd>–<Kbd>4</Kbd> puanla · <Kbd>Z</Kbd> geri al · <Kbd>Esc</Kbd> çık
      </p>
    </div>
  );
};

module.exports = ReviewScreen;
