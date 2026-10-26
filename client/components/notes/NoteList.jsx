// Left column of the Notes page: actions, search, filters, tag list and the note list.
const React = require('react');
const { useState, useRef, useEffect } = React;
const L = require('lucide-react');
const { Stagger, StaggerItem } = require('../ui/motion');
const { relDate } = require('./noteUtils');

const chip = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors';
const chipOn = 'bg-accent/15 border-accent/40 text-accent';
const chipOff = 'bg-bg-input border-border text-text-secondary hover:text-text-primary';

const ListSkeleton = () => (
  <div className="space-y-1 p-1" aria-hidden="true">
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <div key={i} className="px-3 py-2.5 space-y-1.5">
        <div className="h-3.5 rounded bg-bg-input animate-pulse" style={{ width: `${78 - i * 8}%` }} />
        <div className="h-2.5 rounded bg-bg-input/70 animate-pulse" style={{ width: `${92 - i * 5}%` }} />
        <div className="h-2 w-16 rounded bg-bg-input/60 animate-pulse" />
      </div>
    ))}
  </div>
);

const HeaderMenu = ({ onExportAll, onExportCurrent, canExportCurrent, onImport }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const item = 'w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const run = (fn) => () => { setOpen(false); fn(); };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Not menüsü"
        title="Dışa / içe aktar"
        className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors"
      >
        <L.Ellipsis className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-30 w-60 py-1 bg-bg-surface border border-border rounded-xl shadow-2xl">
          <button type="button" role="menuitem" className={item} onClick={run(onExportAll)}>
            <L.Download className="w-3.5 h-3.5" />Tüm notları dışa aktar (.md paketi)
          </button>
          <button type="button" role="menuitem" className={item} disabled={!canExportCurrent} onClick={run(onExportCurrent)}>
            <L.FileDown className="w-3.5 h-3.5" />Bu notu indir (.md)
          </button>
          <div className="my-1 border-t border-border" />
          <button type="button" role="menuitem" className={item} onClick={run(onImport)}>
            <L.Upload className="w-3.5 h-3.5" />Markdown dosyası içe aktar…
          </button>
        </div>
      )}
    </div>
  );
};

const NoteList = ({
  notes, total, loading, error, onRetry, activeId, onSelect,
  query, onQuery, filter, onFilter, tag, onTag, tags,
  onNew, onDaily, creating, onExportAll, onExportCurrent, canExportCurrent, onImportFiles,
}) => {
  const [tagsOpen, setTagsOpen] = useState(true);
  const fileRef = useRef(null);
  const filtered = !!(query || tag || filter === 'pinned');

  const onFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) onImportFiles(files);
  };

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-primary">Notlar</h1>
          <p className="text-text-secondary text-xs mt-0.5">{loading && !notes.length ? 'Yükleniyor…' : `${total} not`}</p>
        </div>
        <HeaderMenu
          onExportAll={onExportAll}
          onExportCurrent={onExportCurrent}
          canExportCurrent={canExportCurrent}
          onImport={() => fileRef.current && fileRef.current.click()}
        />
        <input ref={fileRef} type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden" onChange={onFiles} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onNew}
          disabled={creating}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          <L.Plus className="w-3.5 h-3.5" />Yeni not
        </button>
        <button
          type="button"
          onClick={onDaily}
          disabled={creating}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
        >
          <L.CalendarDays className="w-3.5 h-3.5" />Bugünün günlüğü
        </button>
      </div>

      <label className="flex items-center gap-2 bg-bg-surface border border-border rounded-lg px-3 focus-within:border-accent transition-colors">
        <L.Search className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Notlarda ara…"
          aria-label="Notlarda ara"
          className="flex-1 min-w-0 bg-transparent py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {query && (
          <button type="button" onClick={() => onQuery('')} aria-label="Aramayı temizle" className="text-text-muted hover:text-text-primary">
            <L.X className="w-3.5 h-3.5" />
          </button>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={filter === 'all' && !tag} onClick={() => { onFilter('all'); onTag(''); }} className={`${chip} ${filter === 'all' && !tag ? chipOn : chipOff}`}>
          <L.FileText className="w-3 h-3" />Hepsi
        </button>
        <button type="button" aria-pressed={filter === 'pinned'} onClick={() => onFilter(filter === 'pinned' ? 'all' : 'pinned')} className={`${chip} ${filter === 'pinned' ? chipOn : chipOff}`}>
          <L.Pin className="w-3 h-3" />Sabitlenenler
        </button>
      </div>

      {tags.length > 0 && (
        <div className="bg-bg-surface border border-border rounded-xl px-3 py-2">
          <button
            type="button"
            onClick={() => setTagsOpen((o) => !o)}
            aria-expanded={tagsOpen}
            className="w-full flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-text-tertiary hover:text-text-secondary"
          >
            <span className="flex items-center gap-1.5"><L.Hash className="w-3 h-3" />Etiketler</span>
            {tagsOpen ? <L.ChevronDown className="w-3.5 h-3.5" /> : <L.ChevronRight className="w-3.5 h-3.5" />}
          </button>
          {tagsOpen && (
            <div className="flex flex-wrap gap-1.5 mt-2 max-h-32 overflow-y-auto nt-scroll">
              {tags.map((t) => {
                const on = tag && tag.toLowerCase() === String(t.tag).toLowerCase();
                return (
                  <button key={t.tag} type="button" aria-pressed={!!on} onClick={() => onTag(on ? '' : t.tag)} className={`${chip} ${on ? 'bg-info/15 border-info/40 text-info' : chipOff}`}>
                    #{t.tag}<span className="text-text-muted">{t.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 text-warning text-xs">
          <L.TriangleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{notes.length ? `Liste güncellenemedi. (${error})` : `Notlar yüklenemedi: ${error}`}</span>
          <button type="button" onClick={onRetry} className="font-semibold hover:underline flex-shrink-0">Tekrar dene</button>
        </div>
      )}

      <div className="bg-bg-surface border border-border rounded-xl p-1 overflow-y-auto nt-scroll md:max-h-[calc(100vh-24rem)] min-h-[8rem]">
        {loading && !notes.length ? (
          <ListSkeleton />
        ) : !notes.length ? (
          <div className="px-4 py-8 text-center">
            <L.NotebookPen className="w-8 h-8 text-text-muted mx-auto mb-2" />
            <p className="text-sm font-semibold text-text-primary">{filtered ? 'Eşleşen not yok' : 'Henüz not yok'}</p>
            <p className="text-xs text-text-secondary mt-1">
              {filtered ? 'Aramayı ya da filtreleri değiştirmeyi dene.' : 'İlk notunu oluştur ya da bugünün günlüğünü aç.'}
            </p>
          </div>
        ) : (
          <Stagger stagger={0.025} as="ul" className="space-y-0.5" key={`${filter}|${tag}|${query ? 'q' : ''}`}>
            {notes.map((n) => {
              const active = n.id === activeId;
              return (
                <StaggerItem as="li" key={n.id} y={4}>
                  <button
                    type="button"
                    onClick={() => onSelect(n.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${active ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-bg-input'}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {n.pinned && <L.Pin className="w-3 h-3 text-accent flex-shrink-0" aria-label="Sabitlenmiş" />}
                      <span className={`text-sm font-semibold truncate ${active ? 'text-accent' : 'text-text-primary'}`}>{n.title}</span>
                    </div>
                    {n.excerpt ? (
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-2 break-words">{n.excerpt}</p>
                    ) : (
                      <p className="text-xs text-text-muted mt-0.5 italic">Boş not</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 min-w-0">
                      <span className="text-[10px] text-text-muted flex-shrink-0">{relDate(n.updatedAt)}</span>
                      {n.backlinkCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-text-muted flex-shrink-0" title={`${n.backlinkCount} geri bağlantı`}>
                          <L.Link2 className="w-3 h-3" />{n.backlinkCount}
                        </span>
                      )}
                      <span className="flex gap-1 min-w-0 overflow-hidden">
                        {(n.tags || []).slice(0, 3).map((t) => (
                          <span key={t} className="text-[10px] px-1.5 rounded bg-info/10 text-info truncate">#{t}</span>
                        ))}
                      </span>
                    </div>
                  </button>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </div>
    </div>
  );
};

module.exports = NoteList;
