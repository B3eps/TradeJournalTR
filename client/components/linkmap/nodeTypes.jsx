// Node types, colours, icons and the custom React Flow node for the link map.
const React = require('react');
const { memo } = React;
const { Handle, Position } = require('@xyflow/react');

const TYPE_ORDER = ['task', 'note', 'trade', 'news', 'card', 'project'];

const TYPE_META = {
  task: { label: 'Görev', plural: 'Görevler', color: '#60a5fa', page: 'tasks' },
  note: { label: 'Not', plural: 'Notlar', color: '#a78bfa', page: 'notes' },
  trade: { label: 'İşlem', plural: 'İşlemler', color: '#34d399', page: 'trades' },
  news: { label: 'Haber', plural: 'Haberler', color: '#fbbf24', page: 'newsfeed' },
  card: { label: 'Kart', plural: 'Kartlar', color: '#f472b6', page: 'cards' },
  project: { label: 'Proje', plural: 'Projeler', color: '#94a3b8', page: 'tasks' },
};

const EDGE_LABELS = {
  link: 'Bağlantı',
  wikilink: 'Not bağlantısı',
  parent: 'Alt görev',
  'card-source': 'Kart kaynağı',
  project: 'Proje',
};

const ICON_PATHS = {
  task: <><circle cx="12" cy="12" r="8.5" /><path d="M8.3 12.4l2.5 2.5 4.9-5.2" /></>,
  note: <><path d="M7 3.5h8l4 4v13H7z" /><path d="M14.5 3.5v4.5H19M9.5 12.5h6M9.5 16h6" /></>,
  trade: <><path d="M3.5 17l5-5.5 3.5 3 6-7" /><path d="M14.5 7.5h4v4" /></>,
  news: <><path d="M5 5.5h11v13H7a2 2 0 01-2-2z" /><path d="M16 9.5h3.5v7a2 2 0 01-2 2M8.5 9h4.5M8.5 12.5h4.5" /></>,
  card: <><rect x="4" y="7" width="13" height="10" rx="1.8" /><path d="M7.5 4.5h11a1.5 1.5 0 011.5 1.5v8" /></>,
  project: <path d="M3.5 7.5a1.5 1.5 0 011.5-1.5h4l2 2.2h8a1.5 1.5 0 011.5 1.5v7.8a1.5 1.5 0 01-1.5 1.5H5a1.5 1.5 0 01-1.5-1.5z" />,
};

const TypeIcon = ({ type, className = 'w-3.5 h-3.5', style }) => (
  <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICON_PATHS[type] || ICON_PATHS.note}
  </svg>
);

const shortDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
};

const subline = (type, meta) => {
  const m = meta || {};
  if (type === 'task') return m.status === 'done' ? 'Tamamlandı' : m.dueDate ? `Son ${shortDate(m.dueDate)}` : 'Görev';
  if (type === 'trade') return typeof m.pl === 'number' ? `${m.pl >= 0 ? '+' : ''}${m.pl.toLocaleString('tr-TR')}` : 'İşlem';
  if (type === 'news') return m.source || 'Haber';
  if (type === 'project') return `${m.taskCount || 0} görev`;
  if (type === 'note') return m.daily ? 'Günlük not' : 'Not';
  return TYPE_META[type] ? TYPE_META[type].label : '';
};

const handleStyle = { opacity: 0, width: 2, height: 2, minWidth: 0, minHeight: 0, border: 0, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' };

const MapNode = memo(({ data }) => {
  const meta = TYPE_META[data.type] || TYPE_META.note;
  const color = data.type === 'project' && data.meta && data.meta.color ? data.meta.color : meta.color;
  const done = data.type === 'task' && data.meta && data.meta.status === 'done';
  const big = data.type === 'project';
  return (
    <div
      className={`linkmap-node group flex items-center gap-2 rounded-xl border bg-bg-surface text-left shadow-md ${big ? 'px-3.5 py-2.5' : 'px-2.5 py-1.5'}`}
      style={{
        width: 172,
        borderColor: data.isSelected ? color : data.match ? '#fde047' : 'rgb(var(--border))',
        boxShadow: data.isSelected ? `0 0 0 2px ${color}66, 0 6px 18px rgba(0,0,0,.35)` : data.match ? '0 0 0 2px #fde04799' : undefined,
        opacity: data.dim ? 0.22 : 1,
        transition: 'opacity .18s, box-shadow .18s, border-color .18s',
      }}
      title={data.label}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
      <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-lg" style={{ backgroundColor: `${color}26`, color }}>
        <TypeIcon type={data.type} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12px] leading-tight font-medium ${done ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{data.label}</span>
        <span className="block truncate text-[10px] leading-tight text-text-muted">{subline(data.type, data.meta)}</span>
      </span>
    </div>
  );
});
MapNode.displayName = 'MapNode';

const nodeTypes = { mapnode: MapNode };

module.exports = { TYPE_ORDER, TYPE_META, EDGE_LABELS, TypeIcon, nodeTypes, shortDate };
