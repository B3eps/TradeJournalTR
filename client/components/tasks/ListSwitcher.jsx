// Left column inside the Tasks page: smart lists, projects and labels.
const React = require('react');
const { useState, useRef, useEffect } = React;
const TI = require('./TaskIcons');
const { sameId } = require('./taskUtils');

const SMART_LISTS = [
  { type: 'inbox', label: 'Gelen Kutusu', icon: TI.Inbox },
  { type: 'today', label: 'Bugün', icon: TI.Sun },
  { type: 'upcoming', label: 'Yaklaşan', icon: TI.Calendar },
  { type: 'all', label: 'Tüm Görevler', icon: TI.Layers },
  { type: 'done', label: 'Tamamlananlar', icon: TI.CheckCircle },
];

const isActive = (view, type, id) => view && view.type === type && (id == null || sameId(view.id, id));

const Item = ({ active, onClick, icon: Icon, dotColor, label, count, countTone }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left ${
      active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'
    }`}
  >
    {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
    {dotColor && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 ml-0.5 mr-0.5" style={{ backgroundColor: dotColor }} />}
    <span className="flex-1 truncate">{label}</span>
    {count > 0 && (
      <span className={`text-[11px] tabular-nums ${countTone || (active ? 'text-accent' : 'text-text-muted')}`}>{count}</span>
    )}
  </button>
);

const InlineAdd = ({ placeholder, buttonLabel, onSubmit }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const submit = async () => {
    const name = value.trim();
    if (!name) { setOpen(false); return; }
    setBusy(true);
    const ok = await onSubmit(name);
    setBusy(false);
    if (ok !== false) { setValue(''); setOpen(false); }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-tertiary hover:text-accent hover:bg-bg-input transition-colors"
      >
        <TI.Plus className="w-3.5 h-3.5" />
        {buttonLabel}
      </button>
    );
  }
  return (
    <div className="px-1 py-1">
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setValue(''); setOpen(false); }
        }}
        onBlur={() => { if (!value.trim()) setOpen(false); }}
        placeholder={placeholder}
        maxLength={60}
        className="w-full bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
      />
      <p className="text-[10px] text-text-muted mt-1 px-1">Enter: kaydet · Esc: vazgeç</p>
    </div>
  );
};

const SectionTitle = ({ children }) => (
  <p className="px-2.5 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{children}</p>
);

const ListSwitcher = ({ view, onSelect, projects, labels, counts, onAddProject, onAddLabel, metaLoading }) => {
  const visibleProjects = (projects || []).filter(p => !p.archived && !p.isInbox);
  return (
    <nav aria-label="Görev listeleri" className="bg-bg-surface border border-border rounded-xl p-2">
      {SMART_LISTS.map(l => {
        let count = 0;
        let tone;
        if (l.type === 'inbox') count = counts.inbox;
        if (l.type === 'today') { count = counts.today; if (counts.overdue > 0) tone = 'text-negative'; }
        if (l.type === 'all') count = counts.all;
        return (
          <Item
            key={l.type}
            active={isActive(view, l.type)}
            onClick={() => onSelect({ type: l.type })}
            icon={l.icon}
            label={l.label}
            count={count}
            countTone={tone}
          />
        );
      })}

      <SectionTitle>Projeler</SectionTitle>
      {metaLoading && visibleProjects.length === 0 && (
        <div className="space-y-1.5 px-2.5 py-1">
          {[0, 1, 2].map(i => <div key={i} className="h-5 rounded bg-bg-input animate-pulse" />)}
        </div>
      )}
      {visibleProjects.map(p => (
        <Item
          key={p.id}
          active={isActive(view, 'project', p.id)}
          onClick={() => onSelect({ type: 'project', id: p.id })}
          dotColor={p.color || '#64748b'}
          label={p.name}
          count={Number(p.openTaskCount) || 0}
        />
      ))}
      <InlineAdd placeholder="Proje adı" buttonLabel="Proje ekle" onSubmit={onAddProject} />

      <SectionTitle>Etiketler</SectionTitle>
      {(labels || []).length === 0 && !metaLoading && (
        <p className="px-2.5 pb-1 text-xs text-text-muted">Henüz etiket yok. Hızlı eklemede @etiket yazabilirsin.</p>
      )}
      {(labels || []).map(l => (
        <Item
          key={l.id}
          active={isActive(view, 'label', l.id)}
          onClick={() => onSelect({ type: 'label', id: l.id })}
          icon={TI.Tag}
          label={l.name}
          count={Number(l.openTaskCount) || 0}
        />
      ))}
      <InlineAdd placeholder="Etiket adı" buttonLabel="Etiket ekle" onSubmit={onAddLabel} />
    </nav>
  );
};

ListSwitcher.SMART_LISTS = SMART_LISTS;
module.exports = ListSwitcher;
