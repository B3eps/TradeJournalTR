// Right column of the Notes page ("Bağlantılar"): backlinks, outgoing links and linked items.
const React = require('react');
const L = require('lucide-react');
const { FadeIn } = require('../ui/motion');

const TYPE_META = {
  note: { icon: L.FileText, label: 'Not', tone: 'text-accent' },
  task: { icon: L.SquareCheck, label: 'Görev', tone: 'text-positive' },
  trade: { icon: L.TrendingUp, label: 'İşlem', tone: 'text-info' },
  news: { icon: L.Newspaper, label: 'Haber', tone: 'text-warning' },
  url: { icon: L.Link, label: 'Bağlantı', tone: 'text-text-secondary' },
};

const Section = ({ title, count, children, empty }) => (
  <section className="space-y-1.5">
    <h3 className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-1">
      <span>{title}</span>
      <span className="text-text-muted font-medium normal-case tracking-normal">{count}</span>
    </h3>
    {count === 0 ? <p className="text-xs text-text-muted px-1 pb-1">{empty}</p> : <ul className="space-y-0.5">{children}</ul>}
  </section>
);

const Row = ({ item, onOpen, onCreate, creating }) => {
  const meta = TYPE_META[item.type] || TYPE_META.note;
  const Icon = meta.icon;
  const canOpen = !item.missing && item.id;
  const missingNote = item.missing && item.type === 'note';
  return (
    <li className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${canOpen ? 'hover:bg-bg-input' : ''} ${item.missing ? 'nt-missing-chip' : ''}`}>
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${meta.tone}`} aria-hidden="true" />
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => canOpen && onOpen(item)}
        title={item.missing ? (missingNote ? 'Bu not henüz yok' : 'Hedef bulunamadı') : `${meta.label}: ${item.label}`}
        className="flex-1 min-w-0 text-left text-sm text-text-primary truncate disabled:cursor-default"
      >
        {item.label}
      </button>
      {missingNote ? (
        <button
          type="button"
          onClick={() => onCreate(item.target || item.label)}
          disabled={creating}
          className="flex-shrink-0 text-[11px] font-semibold text-accent hover:underline disabled:opacity-50"
        >
          Oluştur
        </button>
      ) : item.missing ? (
        <span className="flex-shrink-0 text-[10px] text-text-muted">bulunamadı</span>
      ) : (
        item.type !== 'note' && <L.ArrowUpRight className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 flex-shrink-0" aria-hidden="true" />
      )}
    </li>
  );
};

const PanelSkeleton = () => (
  <div className="space-y-3" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <div key={i} className="space-y-1.5">
        <div className="h-2.5 w-24 rounded bg-bg-input animate-pulse" />
        <div className="h-3 w-3/4 rounded bg-bg-input/70 animate-pulse" />
      </div>
    ))}
  </div>
);

const LinksPanel = ({ detail, loading, onOpen, onCreate, creating, onClose }) => {
  const backlinks = (detail && detail.backlinks) || [];
  const outgoing = (detail && detail.outgoing) || [];
  const noteBacklinks = backlinks.filter((b) => b.type === 'note');
  // Tasks / trades / news / urls attached to this note: generic links + typed [[...]] links.
  const items = [];
  const seen = new Set();
  [...backlinks.filter((b) => b.type !== 'note'), ...outgoing.filter((o) => o.type !== 'note')].forEach((x) => {
    const k = `${x.type}|${x.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    items.push(x);
  });
  const noteOutgoing = outgoing.filter((o) => o.type === 'note');

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
          <L.Link2 className="w-4 h-4 text-accent" />Bağlantılar
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Bağlantılar panelini kapat" title="Paneli kapat" className="text-text-muted hover:text-text-primary">
            <L.PanelRightClose className="w-4 h-4" />
          </button>
        )}
      </div>
      {loading && !detail ? <PanelSkeleton /> : !detail ? (
        <p className="text-xs text-text-muted">Bir not seçildiğinde bağlantıları burada görünür.</p>
      ) : (
        <FadeIn className="space-y-4" key={detail.note && detail.note.id}>
          <Section title="Geri bağlantılar" count={noteBacklinks.length} empty="Bu nota henüz başka not bağlanmıyor.">
            {noteBacklinks.map((b) => <Row key={`b${b.id}`} item={b} onOpen={onOpen} onCreate={onCreate} creating={creating} />)}
          </Section>
          <Section title="Giden bağlantılar" count={noteOutgoing.length} empty="[[ yazarak başka bir nota bağlantı ekle.">
            {noteOutgoing.map((o) => <Row key={`o${o.key || o.id}`} item={o} onOpen={onOpen} onCreate={onCreate} creating={creating} />)}
          </Section>
          <Section title="Bağlı öğeler" count={items.length} empty="Görev, işlem veya haber bağlantısı yok.">
            {items.map((x) => <Row key={`i${x.type}${x.id}`} item={x} onOpen={onOpen} onCreate={onCreate} creating={creating} />)}
          </Section>
        </FadeIn>
      )}
    </div>
  );
};

module.exports = LinksPanel;
