// Always-visible quick-add input with a live preview of parsed fields.
const React = require('react');
const { useState, useMemo, useRef } = React;
const TI = require('./TaskIcons');
const { parseTaskInput, fold, normName, tokenDisableKey } = require('../../utils/taskParse');
const U = require('./taskUtils');

const chipBase = 'inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border text-[11px] font-medium';

const Chip = ({ className, icon: Icon, children, onRemove, removeLabel, dashed, title }) => (
  <span title={title} className={`${chipBase} ${dashed ? 'border-dashed opacity-80' : ''} ${className}`}>
    {Icon && <Icon className="w-3 h-3" />}
    <span className="truncate max-w-[180px]">{children}</span>
    {onRemove && (
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        aria-label={removeLabel || 'Kaldır'}
        className="ml-0.5 rounded p-0.5 hover:bg-black/10 opacity-70 hover:opacity-100"
      >
        <TI.X className="w-3 h-3" />
      </button>
    )}
  </span>
);

// Current "#..." or "@..." fragment at the caret, for suggestions.
const fragmentAt = (text, caret) => {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\s)([#@])([^\s#@]*)$/);
  if (!m) return null;
  return { sigil: m[1], query: m[2], start: caret - m[2].length - 1, end: caret };
};

const QuickAdd = ({ projects, labels, defaults, onCreate, onCreateLabel, inputRef, play }) => {
  const [text, setText] = useState('');
  const [disabled, setDisabled] = useState(() => new Set());
  const [confirmedNew, setConfirmedNew] = useState(() => new Set()); // folded names of new labels to create
  const [dropDefaults, setDropDefaults] = useState(() => new Set());
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const localRef = useRef(null);
  const ref = inputRef || localRef;

  const parsed = useMemo(
    () => parseTaskInput(text, { projects, labels, disabled, now: new Date() }),
    [text, projects, labels, disabled]
  );

  const frag = fragmentAt(text, caret);
  const suggestions = useMemo(() => {
    if (!frag) return [];
    const q = normName(frag.query);
    const pool = frag.sigil === '#' ? (projects || []).filter(p => !p.archived) : (labels || []);
    return pool.filter(it => !q || normName(it.name).includes(q)).slice(0, 6);
  }, [frag && frag.sigil, frag && frag.query, projects, labels]);
  const showSuggest = suggestions.length > 0 && document.activeElement === ref.current;

  const reset = () => {
    setText('');
    setDisabled(new Set());
    setConfirmedNew(new Set());
    setDropDefaults(new Set());
    setHi(-1);
  };

  const applySuggestion = (item) => {
    if (!frag) return;
    const token = `${frag.sigil}${String(item.name).replace(/\s+/g, '_')} `;
    const next = text.slice(0, frag.start) + token + text.slice(frag.end).replace(/^\s+/, '');
    setText(next);
    setHi(-1);
    const pos = frag.start + token.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      if (ref.current) { ref.current.focus(); try { ref.current.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
    });
  };

  const disable = (key) => setDisabled(prev => { const n = new Set(prev); n.add(key); return n; });
  // removing a chip disables only that exact token, so typing a different date later still works
  const tokOf = (type) => parsed.tokens.find(t => t.type === type) || null;
  const disableTok = (type) => {
    const t = tokOf(type);
    disable(t ? tokenDisableKey(t) : type);
  };

  // effective values: parsed first, then view defaults
  const projectId = parsed.project && parsed.project.matched
    ? parsed.project.id
    : (!dropDefaults.has('project') ? defaults.projectId : null);
  const dueDate = parsed.dueDate || (!dropDefaults.has('date') ? defaults.dueDate : null);
  const defaultLabel = !dropDefaults.has('label') && defaults.labelId != null
    ? (labels || []).find(l => U.sameId(l.id, defaults.labelId))
    : null;

  const submit = async () => {
    if (busy) return;
    const title = parsed.title.trim();
    if (!title) {
      setErr(text.trim() ? 'Görev adı boş kaldı. Tarih ve etiketlerin yanına bir başlık yaz.' : '');
      if (text.trim()) play('error');
      return;
    }
    setErr('');
    setBusy(true);
    const original = text;
    let sent = false;
    try {
      const labelIds = [];
      const newLabels = [];
      parsed.labels.forEach(l => {
        if (!l.isNew) labelIds.push(l.id);
        else if (confirmedNew.has(fold(l.name))) newLabels.push(l.name);
      });
      if (defaultLabel && !labelIds.some(id => U.sameId(id, defaultLabel.id))) labelIds.push(defaultLabel.id);
      for (const name of newLabels) {
        const created = await onCreateLabel(name);
        if (created && created.id != null) labelIds.push(created.id);
      }
      const payload = { title };
      if (projectId != null) payload.projectId = projectId;
      if (parsed.priority) payload.priority = parsed.priority;
      if (dueDate) payload.dueDate = dueDate;
      if (parsed.dueTime) payload.dueTime = parsed.dueTime;
      if (parsed.recurrence) payload.recurrence = parsed.recurrence;
      if (labelIds.length) payload.labelIds = labelIds;
      const p = onCreate(payload);
      sent = true;
      reset();
      await p;
    } catch (e) {
      // creation failed after we cleared the box: give the text back so nothing is lost
      if (sent) setText(original);
      setErr((e && e.message) || 'Görev eklenemedi.');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.focus();
    }
  };

  const onKeyDown = (e) => {
    if (showSuggest) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (h <= 0 ? suggestions.length - 1 : h - 1)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && hi >= 0)) {
        e.preventDefault();
        applySuggestion(suggestions[Math.max(0, hi)]);
        return;
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (text) reset(); else e.currentTarget.blur();
    }
  };

  const projectById = (id) => (projects || []).find(p => U.sameId(p.id, id));

  // ---- chips ----
  const chips = [];
  if (parsed.dueDate) {
    chips.push(
      <Chip key="date" icon={TI.Calendar} className={U.DUE_TONE_CLASS[U.dayDiff(parsed.dueDate) < 0 ? 'overdue' : U.dayDiff(parsed.dueDate) === 0 ? 'today' : 'future']} onRemove={tokOf('date') ? () => disableTok('date') : undefined} removeLabel="Tarihi kaldır" title={tokOf('date') ? undefined : 'Tekrar kuralından gelen ilk tarih'}>
        {U.relativeDayLabel(parsed.dueDate)}{U.relativeDayLabel(parsed.dueDate) !== U.shortDate(parsed.dueDate) ? ` · ${U.shortDate(parsed.dueDate)}` : ''}
      </Chip>
    );
  } else if (dueDate) {
    chips.push(
      <Chip key="ddate" dashed icon={TI.Calendar} className={U.DUE_TONE_CLASS.today} onRemove={() => setDropDefaults(s => new Set(s).add('date'))} title="Bu listenin varsayılanı">
        {U.relativeDayLabel(dueDate)} (varsayılan)
      </Chip>
    );
  }
  if (parsed.dueTime) {
    chips.push(
      <Chip key="time" icon={TI.Clock} className={U.DUE_TONE_CLASS.future} onRemove={() => disableTok('time')} removeLabel="Saati kaldır" title={parsed.timeRolledToTomorrow ? 'Bu saat bugün geçtiği için yarına ayarlandı' : undefined}>
        {parsed.dueTime}
      </Chip>
    );
  }
  if (parsed.recurrence) {
    chips.push(
      <Chip key="rec" icon={TI.Repeat} className="bg-accent/10 text-accent border-accent/30" onRemove={() => disableTok('recurrence')} removeLabel="Tekrarı kaldır">
        {U.recurrenceLabel(parsed.recurrence)}
      </Chip>
    );
  }
  if (parsed.priority) {
    const pm = U.prio(parsed.priority);
    chips.push(
      <Chip key="prio" icon={TI.Flag} className={pm.chip} onRemove={() => disableTok('priority')} removeLabel="Önceliği kaldır">
        {pm.label}
      </Chip>
    );
  }
  if (parsed.project) {
    const pr = parsed.project;
    chips.push(
      <Chip
        key="proj"
        icon={TI.Hash}
        className={pr.matched ? 'bg-bg-input text-text-primary border-border' : 'bg-warning/10 text-warning border-warning/30'}
        onRemove={() => disableTok('project')}
        removeLabel="Projeyi kaldır"
        title={pr.matched ? undefined : 'Bu adla bir proje yok; görev varsayılan listeye eklenecek'}
      >
        {pr.matched ? pr.name : `${pr.raw}: proje bulunamadı`}
      </Chip>
    );
  } else if (projectId != null && projectById(projectId) && !projectById(projectId).isInbox) {
    chips.push(
      <Chip key="dproj" dashed icon={TI.Hash} className="bg-bg-input text-text-secondary border-border" onRemove={() => setDropDefaults(s => new Set(s).add('project'))} title="Bu listenin varsayılanı">
        {projectById(projectId).name}
      </Chip>
    );
  }
  parsed.labels.forEach(l => {
    const key = `label:${fold(l.name)}`;
    if (!l.isNew) {
      chips.push(
        <Chip key={key} icon={TI.Tag} className="bg-info/10 text-info border-info/30" onRemove={() => disable(key)} removeLabel="Etiketi kaldır">
          {l.name}
        </Chip>
      );
      return;
    }
    const ok = confirmedNew.has(fold(l.name));
    chips.push(
      <span key={key} className={`${chipBase} ${ok ? 'bg-info/10 text-info border-info/30' : 'bg-warning/10 text-warning border-warning/30 border-dashed'}`}>
        <TI.Tag className="w-3 h-3" />
        <span className="truncate max-w-[140px]">{l.name}</span>
        {!ok && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setConfirmedNew(s => new Set(s).add(fold(l.name)))}
            className="ml-1 px-1.5 rounded bg-warning/20 hover:bg-warning/30 text-[10px] font-semibold"
          >
            Yeni etiket oluştur
          </button>
        )}
        {ok && <span className="text-[10px] opacity-80">(yeni)</span>}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => disable(key)}
          aria-label="Etiketi kaldır"
          className="ml-0.5 rounded p-0.5 hover:bg-black/10 opacity-70 hover:opacity-100"
        >
          <TI.X className="w-3 h-3" />
        </button>
      </span>
    );
  });
  if (defaultLabel && !parsed.labels.some(l => U.sameId(l.id, defaultLabel.id))) {
    chips.push(
      <Chip key="dlabel" dashed icon={TI.Tag} className="bg-info/10 text-info border-info/30" onRemove={() => setDropDefaults(s => new Set(s).add('label'))} title="Bu listenin varsayılanı">
        {defaultLabel.name}
      </Chip>
    );
  }

  const unconfirmed = parsed.labels.filter(l => l.isNew && !confirmedNew.has(fold(l.name)));

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-3 focus-within:border-accent/60 transition-colors">
      <div className="relative flex items-center gap-2">
        <TI.Plus className="w-4 h-4 text-accent flex-shrink-0 ml-1" />
        <input
          ref={ref}
          value={text}
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart || 0); setHi(-1); if (err) setErr(''); if (!e.target.value) { setDisabled(new Set()); setConfirmedNew(new Set()); } }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart || 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart || 0)}
          onBlur={() => setHi(-1)}
          placeholder="Görev ekle: ör. Yarın 18:00 ders çalış !1 #okul @acil"
          aria-label="Hızlı görev ekle"
          className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none py-1.5"
          maxLength={500}
        />
        <kbd className="hidden sm:inline-block text-[10px] text-text-muted border border-border rounded px-1.5 py-0.5">Q</kbd>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !parsed.title.trim()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Ekle
        </button>

        {showSuggest && (
          <ul role="listbox" className="absolute left-6 top-full mt-1 z-30 min-w-[200px] bg-bg-surface border border-border rounded-lg shadow-xl py-1">
            {suggestions.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === hi}
                  onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${i === hi ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-input'}`}
                >
                  {frag.sigil === '#'
                    ? <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color || '#64748b' }} />
                    : <TI.Tag className="w-3.5 h-3.5" />}
                  {s.name}
                </button>
              </li>
            ))}
            <li className="px-3 pt-1 text-[10px] text-text-muted">Tab ile seç</li>
          </ul>
        )}
      </div>

      {(chips.length > 0 || parsed.title) && text.trim() && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-7">
          <span className="text-[11px] text-text-muted mr-1 truncate max-w-[240px]" title={parsed.title}>
            {parsed.title ? `“${parsed.title}”` : 'Başlık yok'}
          </span>
          {chips}
        </div>
      )}
      {unconfirmed.length > 0 && text.trim() && (
        <p className="text-[11px] text-text-muted mt-1.5 pl-7">Yeni etiketler onaylanmazsa görev onlarsız eklenir.</p>
      )}
      {err && <p className="text-[11px] text-negative mt-1.5 pl-7">{err}</p>}
      {!text && (
        <p className="text-[11px] text-text-muted mt-1 pl-7 hidden md:block">
          İpucu: bugün, yarın, cuma, 12.11, 18:00, saat 5, her gün, her pazartesi, !1 … !4, #proje, @etiket
        </p>
      )}
    </div>
  );
};

module.exports = QuickAdd;
