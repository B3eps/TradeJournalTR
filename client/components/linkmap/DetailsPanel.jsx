// Right-hand panel of the link map: selected node details and its connections.
const React = require('react');
const { TYPE_META, EDGE_LABELS, TypeIcon, shortDate } = require('./nodeTypes');

const fullDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
};

const Row = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 text-xs">
    <span className="text-text-muted flex-shrink-0">{label}</span>
    <span className="text-text-secondary text-right min-w-0 break-words">{children}</span>
  </div>
);

const metaRows = (node) => {
  const m = node.meta || {};
  const rows = [];
  if (node.type === 'task') {
    rows.push(['Durum', m.status === 'done' ? 'Tamamlandı' : 'Açık']);
    if (m.dueDate) rows.push(['Son tarih', fullDate(m.dueDate)]);
    if (m.projectName) rows.push(['Proje', m.projectName]);
  } else if (node.type === 'trade') {
    if (m.ticker) rows.push(['Sembol', m.ticker]);
    if (typeof m.pl === 'number') rows.push(['K/Z', `${m.pl >= 0 ? '+' : ''}${m.pl.toLocaleString('tr-TR')}`]);
  } else if (node.type === 'news') {
    if (m.source) rows.push(['Kaynak', m.source]);
  } else if (node.type === 'note') {
    if (Array.isArray(m.tags) && m.tags.length) rows.push(['Etiketler', m.tags.map((t) => `#${t}`).join(' ')]);
    if (m.daily) rows.push(['Tür', 'Günlük not']);
  } else if (node.type === 'project') {
    rows.push(['Görev sayısı', String(m.taskCount || 0)]);
  }
  if (node.type !== 'project' && m.date) rows.push(['Tarih', fullDate(m.date)]);
  return rows;
};

const DetailsPanel = ({ node, connections, focusActive, focusHops, onClose, onOpen, onFocus, onUnfocus, onSetHops, onPick }) => {
  if (!node) return null;
  const meta = TYPE_META[node.type] || TYPE_META.note;
  const color = node.type === 'project' && node.meta && node.meta.color ? node.meta.color : meta.color;
  const rows = metaRows(node);
  return (
    <aside className="w-72 flex-shrink-0 flex flex-col bg-bg-surface border border-border rounded-2xl overflow-hidden" aria-label="Seçili öğe ayrıntıları">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-border">
        <span className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl" style={{ backgroundColor: `${color}26`, color }}>
          <TypeIcon type={node.type} className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>{meta.label}</div>
          <h2 className="text-sm font-semibold text-text-primary break-words leading-snug">{node.label}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Paneli kapat" className="text-text-muted hover:text-text-primary p-1 -mr-1 -mt-1">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div className="px-4 py-3 space-y-1.5 border-b border-border">
        {rows.length === 0 ? <p className="text-xs text-text-muted">Ek bilgi yok.</p> : rows.map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}
      </div>

      <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-border">
        <button type="button" onClick={onOpen} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:bg-accent/90 transition-colors">
          Aç
        </button>
        {focusActive ? (
          <button type="button" onClick={onUnfocus} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">
            Tümünü göster
          </button>
        ) : (
          <button type="button" onClick={onFocus} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">
            Odakla
          </button>
        )}
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs" role="group" aria-label="Komşuluk derinliği">
          {[1, 2].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onSetHops(h)}
              aria-pressed={focusHops === h}
              className={`px-2.5 py-1.5 transition-colors ${focusHops === h ? 'bg-bg-input text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
            >
              {h} adım
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 flex-1 min-h-0 overflow-y-auto">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Bağlı öğeler ({connections.length})</div>
        {connections.length === 0 ? (
          <p className="text-xs text-text-muted">Bu öğe şu an filtrelenen görünümde başka bir şeye bağlı değil.</p>
        ) : (
          <ul className="space-y-1">
            {connections.map((c) => {
              const cm = TYPE_META[c.node.type] || TYPE_META.note;
              return (
                <li key={c.node.id}>
                  <button type="button" onClick={() => onPick(c.node.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg-input transition-colors">
                    <span className="flex-shrink-0" style={{ color: cm.color }}><TypeIcon type={c.node.type} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-text-primary">{c.node.label}</span>
                      <span className="block truncate text-[10px] text-text-muted">{cm.label} · {EDGE_LABELS[c.kind] || 'Bağlantı'}{c.node.meta && c.node.meta.date ? ` · ${shortDate(c.node.meta.date)}` : ''}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};

module.exports = DetailsPanel;
