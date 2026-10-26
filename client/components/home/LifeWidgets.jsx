// Kartlar, Notlar, Alışkanlıklar. Their endpoints may be missing: 404 => "yakında" note.
const React = require('react');
const { useState, useCallback } = React;
const { CountUp, AnimatedCheck, Stagger, StaggerItem } = require('../ui/motion');
const { useSound } = require('../../utils/sound');
const { navigate } = require('../../utils/navigation');
const { request, localToday, enc } = require('./api');
const { useResource } = require('./hooks');
const { Card, Skeleton, ErrorNote, Empty, Btn } = require('./ui');

const missing = (err) => !!err && (err.status === 404 || err.status === 501 || err.status === 405);
const SoonNote = ({ what }) => <Empty>{what} yakında burada olacak.</Empty>;

const rel = (iso) => {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'şimdi';
  if (m < 60) return `${m} dk önce`;
  if (m < 1440) return `${Math.floor(m / 60)} sa önce`;
  if (m < 10080) return `${Math.floor(m / 1440)} g önce`;
  return new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
};

const CardsWidget = ({ onNavigate }) => {
  const { data, error, loading, reload } = useResource(() => request('GET', '/api/cards/stats'));
  const due = data ? Number(data.dueToday) || 0 : 0;
  return (
    <Card title="Kartlar" icon="cards" onMore={() => onNavigate('cards')} delay={0.25}>
      {loading ? <Skeleton rows={2} /> : missing(error) ? <SoonNote what="Kart çalışması" /> : error && !data ? <ErrorNote message="Kart verisi alınamadı." onRetry={reload} /> : (
        <>
          <div className="flex items-end gap-3">
            <div className="text-4xl font-bold tabular-nums text-text-primary"><CountUp value={due} /></div>
            <div className="text-xs text-text-secondary pb-1.5">bugün tekrar edilecek kart</div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-tertiary">
            <span>Yeni: {Number(data.newAvailable) || 0}</span>
            <span>Bugün çalışılan: {Number(data.reviewedToday) || 0}</span>
            {Number(data.streak) > 0 && <span>Seri: {data.streak} gün</span>}
          </div>
          <div><Btn primary onClick={() => onNavigate('cards')}>Çalış</Btn></div>
        </>
      )}
    </Card>
  );
};

const NotesWidget = ({ onNavigate }) => {
  const { data, error, loading, reload } = useResource(() => request('GET', '/api/notes?limit=5&sort=updated'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const notes = data && Array.isArray(data.notes) ? data.notes : Array.isArray(data) ? data : [];

  const daily = async () => {
    setBusy(true);
    setErr('');
    try {
      const d = await request('POST', '/api/notes/daily');
      const note = d && (d.note || d);
      if (note && note.id != null) navigate('notes', note.id, { itemType: 'note' });
      else onNavigate('notes');
    } catch (e) {
      setErr(missing(e) ? 'Günlük notu henüz hazır değil.' : (e.message || 'Günlük açılamadı.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Notlar" icon="note" onMore={() => onNavigate('notes')} delay={0.3}>
      {loading ? <Skeleton rows={3} /> : missing(error) ? <SoonNote what="Notlar" /> : error && !data ? <ErrorNote message="Notlar alınamadı." onRetry={reload} /> : (
        <>
          {notes.length === 0 ? <Empty>Henüz not yok.</Empty> : (
            <Stagger stagger={0.03} className="flex flex-col">
              {notes.slice(0, 5).map((n) => (
                <StaggerItem key={n.id} y={4}>
                  <button type="button" onClick={() => navigate('notes', n.id, { itemType: 'note' })} className="w-full text-left py-1.5 border-b border-border/60 last:border-0 hover:bg-bg-input/50 rounded transition-colors">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm text-text-primary truncate flex-1">{n.title || 'Başlıksız not'}</span>
                      <span className="text-[10px] text-text-tertiary flex-shrink-0">{rel(n.updatedAt)}</span>
                    </div>
                    {n.excerpt && <div className="text-[11px] text-text-tertiary truncate">{n.excerpt}</div>}
                  </button>
                </StaggerItem>
              ))}
            </Stagger>
          )}
          <div className="flex items-center gap-3">
            <Btn onClick={daily} disabled={busy}>Bugünün günlüğü</Btn>
            {err && <span className="text-xs text-negative">{err}</span>}
          </div>
        </>
      )}
    </Card>
  );
};

const HabitsWidget = ({ onNavigate }) => {
  const { data, error, loading, reload, mutate } = useResource(() => request('GET', '/api/habits/today'));
  const { play } = useSound();
  const [err, setErr] = useState('');
  const habits = data && Array.isArray(data.habits) ? data.habits : Array.isArray(data) ? data : [];

  const toggle = useCallback(async (h, done) => {
    setErr('');
    const apply = (val) => mutate((d) => {
      if (!d) return d;
      const list = Array.isArray(d) ? d : d.habits;
      const next = list.map((x) => (x.id === h.id ? { ...x, done: val } : x));
      return Array.isArray(d) ? next : { ...d, habits: next };
    });
    apply(done);
    try {
      await request('POST', `/api/habits/${enc(h.id)}/check`, { done, date: localToday() });
      reload();
    } catch (e) {
      apply(!done);
      setErr('Alışkanlık güncellenemedi.');
      play('error');
    }
  }, [mutate, reload, play]);

  const doneCount = habits.filter((h) => h.done).length;
  return (
    <Card title="Alışkanlıklar" icon="habit" onMore={() => onNavigate('habits')} right={habits.length > 0 ? <span className="text-xs text-text-tertiary tabular-nums">{doneCount}/{habits.length}</span> : null} delay={0.35}>
      {loading ? <Skeleton rows={3} /> : missing(error) ? <SoonNote what="Alışkanlık takibi" /> : error && !data ? <ErrorNote message="Alışkanlıklar alınamadı." onRetry={reload} /> : habits.length === 0 ? (
        <Empty>Bugün için alışkanlık tanımlı değil.</Empty>
      ) : (
        <Stagger stagger={0.03} className="flex flex-col">
          {habits.map((h) => (
            <StaggerItem key={h.id} y={4} className="flex items-center gap-3 py-1.5 border-b border-border/60 last:border-0">
              <AnimatedCheck checked={!!h.done} onChange={(v) => toggle(h, v)} sound={h.done ? 'toggle-off' : 'complete'} size={18} aria-label={h.name} />
              <span className={`flex-1 min-w-0 truncate text-sm ${h.done ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{h.name}</span>
              {Number(h.streak) > 0 && <span className="text-[11px] text-warning tabular-nums flex-shrink-0">{h.streak} gün</span>}
            </StaggerItem>
          ))}
        </Stagger>
      )}
      {err && <div className="text-xs text-negative">{err}</div>}
    </Card>
  );
};

module.exports = { CardsWidget, NotesWidget, HabitsWidget };
