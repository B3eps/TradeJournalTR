// Centre column of the Notes page: title, toolbar and the Tiptap (Markdown) editor
// with [[wikilink]] suggestions, a Markdown source mode and the "Kart oluştur" action.
// Mount it with key={note.id}: the editor is created once per note.
const React = require('react');
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const L = require('lucide-react');
const { useEditor, useEditorState, EditorContent } = require('@tiptap/react');
const { StarterKit } = require('@tiptap/starter-kit');
const { TaskList } = require('@tiptap/extension-task-list');
const { TaskItem } = require('@tiptap/extension-task-item');
const { Placeholder } = require('@tiptap/extension-placeholder');
const { Markdown } = require('@tiptap/markdown');
const W = require('./wikilinks');
const { relDate } = require('./noteUtils');

const SAVE_LABEL = {
  idle: '',
  dirty: 'Değişiklikler bekliyor…',
  saving: 'Kaydediliyor…',
  saved: 'Kaydedildi',
  error: 'Kaydedilemedi',
};

const KIND_ICON = { note: L.FileText, create: L.Plus, task: L.SquareCheck, trade: L.TrendingUp, news: L.Newspaper };
const KIND_TONE = { note: 'text-accent', create: 'text-accent', task: 'text-positive', trade: 'text-info', news: 'text-warning' };
const KIND_GROUP = { note: 'Notlar', create: 'Notlar', task: 'Görevler', trade: 'İşlemler', news: 'Haberler' };

const cssString = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`;

const TB = ({ onClick, active, disabled, label, children }) => (
  <button
    type="button"
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    disabled={disabled}
    aria-pressed={active ? 'true' : 'false'}
    aria-label={label}
    title={label}
    className={`w-8 h-8 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-bg-input'}`}
  >
    {children}
  </button>
);

const Sep = () => <span className="w-px h-5 bg-border mx-1" aria-hidden="true" />;

// Suggestion popup (positioned at the caret, fixed).
const SuggestPopup = ({ state, onHover, onPick }) => {
  const listRef = useRef(null);
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('[data-active="true"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [state.index]);
  if (!state.rect) return null;
  const below = state.rect.bottom + 280 < window.innerHeight;
  const style = {
    position: 'fixed',
    left: Math.max(8, Math.min(state.rect.left, window.innerWidth - 328)),
    top: below ? state.rect.bottom + 6 : undefined,
    bottom: below ? undefined : window.innerHeight - state.rect.top + 6,
  };
  let lastGroup = null;
  return (
    <div style={style} className="z-[230] w-80 max-h-72 overflow-y-auto nt-scroll bg-bg-surface border border-border rounded-xl shadow-2xl py-1" role="listbox" aria-label="Bağlantı önerileri" ref={listRef}>
      {!state.items.length ? (
        <p className="px-3 py-2.5 text-xs text-text-muted">{state.loading ? 'Aranıyor…' : 'Sonuç yok. Not adını yazmaya devam et.'}</p>
      ) : state.items.map((it, i) => {
        const group = KIND_GROUP[it.kind];
        const head = group !== lastGroup ? group : null;
        lastGroup = group;
        const Icon = KIND_ICON[it.kind] || L.FileText;
        const active = i === state.index;
        return (
          <React.Fragment key={`${it.kind}${it.id || it.title}`}>
            {head && <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{head}</p>}
            <button
              type="button"
              role="option"
              aria-selected={active}
              data-active={active ? 'true' : 'false'}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(it)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${active ? 'bg-accent/10' : 'hover:bg-bg-input'}`}
            >
              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${KIND_TONE[it.kind] || ''}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-text-primary truncate">
                  {it.kind === 'create' ? <>“{it.title}” notunu oluştur</> : it.title}
                </span>
                {it.sub && <span className="block text-[11px] text-text-muted truncate">{it.sub}</span>}
              </span>
              {active && <L.CornerDownLeft className="w-3 h-3 text-text-muted flex-shrink-0" />}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const LinkPopover = ({ initial, onApply, onRemove, onClose }) => {
  const [url, setUrl] = useState(initial || '');
  const ref = useRef(null);
  useEffect(() => { if (ref.current) { ref.current.focus(); ref.current.select(); } }, []);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onApply(url); }}
      className="absolute left-0 top-10 z-30 w-80 bg-bg-surface border border-border rounded-xl shadow-2xl p-2 flex items-center gap-1.5"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
    >
      <input
        ref={ref}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        aria-label="Bağlantı adresi"
        className="flex-1 min-w-0 bg-bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
      />
      <button type="submit" className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-accent text-accent-text hover:opacity-90">Ekle</button>
      {initial && (
        <button type="button" onClick={onRemove} title="Bağlantıyı kaldır" aria-label="Bağlantıyı kaldır" className="p-1.5 rounded-lg text-text-secondary hover:text-negative">
          <L.Unlink className="w-3.5 h-3.5" />
        </button>
      )}
    </form>
  );
};

const normalizeUrl = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return s;
};

const safeMarkdown = (editor) => {
  try { return editor.getMarkdown(); } catch (e) { return null; }
};

const NoteEditor = ({
  note, title, titleError, onTitleChange, onBodyChange, saveState, saveError, onRetrySave,
  outgoing, onOpenWikiLink, searchItems, onCreateLinkedNote,
  onTogglePin, onDelete, onRequestCard, panelOpen, onTogglePanel, onBack,
}) => {
  const [mode, setMode] = useState('rich');
  const [sourceText, setSourceText] = useState(note.body || '');
  const [parseError, setParseError] = useState('');
  const [sug, setSug] = useState(null);
  const [linkOpen, setLinkOpen] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sourceRef = useRef(null);
  const titleRef = useRef(null);

  // Latest callbacks for the (once-created) editor and suggestion plugin.
  const cb = useRef({});
  cb.current = { onBodyChange, onOpenWikiLink, searchItems, onCreateLinkedNote };
  const sugRef = useRef(null);
  sugRef.current = sug;
  const suppressRef = useRef(false);

  const setSugFromProps = (props, resetIndex) => {
    let rect = null;
    try { rect = props.clientRect ? props.clientRect() : null; } catch (e) { rect = null; }
    setSug((prev) => {
      const items = Array.isArray(props.items) ? props.items : [];
      const index = resetIndex || !prev ? 0 : Math.min(prev.index, Math.max(0, items.length - 1));
      return { items, index, rect: rect || (prev && prev.rect) || null, loading: !!props.loading, query: props.query || '', command: props.command };
    });
  };

  const pick = useCallback((item) => {
    const s = sugRef.current;
    if (s && s.command && item) s.command(item);
  }, []);

  const controller = useRef(null);
  controller.current = {
    fetch: (query, signal) => (cb.current.searchItems ? cb.current.searchItems(query, signal) : []),
    onStart: (props) => setSugFromProps(props, true),
    onUpdate: (props) => setSugFromProps(props, false),
    onExit: () => setSug(null),
    onKeyDown: (event) => {
      const s = sugRef.current;
      if (!s) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const n = s.items.length;
        if (!n) return true;
        const d = event.key === 'ArrowDown' ? 1 : -1;
        setSug({ ...s, index: (s.index + d + n) % n });
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (!s.items.length) return false;
        pick(s.items[s.index] || s.items[0]);
        return true;
      }
      if (event.key === 'Escape') { setSug(null); return true; }
      return false;
    },
    onPick: (item, editor, range) => {
      if (!item) return;
      if (item.kind === 'note') W.insertWikiLink(editor, range, { kind: 'note', target: item.title });
      else if (item.kind === 'create') {
        W.insertWikiLink(editor, range, { kind: 'note', target: item.title });
        if (cb.current.onCreateLinkedNote) cb.current.onCreateLinkedNote(item.title);
      } else W.insertWikiLink(editor, range, { kind: item.kind, target: String(item.id), label: item.title, typed: true });
      setSug(null);
    },
  };

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: 'Yazmaya başla… Not bağlamak için [[ yaz, etiket için #etiket kullan.' }),
    Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    W.WikiLink,
    W.WikiSuggest.configure({ getController: () => controller.current }),
  ], []);

  const editor = useEditor({
    extensions,
    content: '',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { spellcheck: 'true', 'aria-label': 'Not içeriği', 'aria-multiline': 'true', role: 'textbox' },
      handleClickOn: (view, pos, node, nodePos, event, direct) => {
        if (!direct || !node || node.type.name !== 'wikiLink') return false;
        if (cb.current.onOpenWikiLink) cb.current.onOpenWikiLink({ ...node.attrs });
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (suppressRef.current) return;
      const md = safeMarkdown(ed);
      if (md !== null && cb.current.onBodyChange) cb.current.onBodyChange(md);
    },
  }, []);

  // Load the note body once the editor exists. Malformed content falls back to source mode.
  useEffect(() => {
    if (!editor) return;
    suppressRef.current = true;
    try {
      editor.commands.setContent(note.body || '', { contentType: 'markdown', emitUpdate: false });
      setParseError('');
    } catch (e) {
      setParseError('Bu not görsel düzenleyicide açılamadı; Markdown kaynağı gösteriliyor.');
      setSourceText(note.body || '');
      setMode('source');
    } finally {
      suppressRef.current = false;
    }
    // Focus the title of a fresh untitled note, otherwise the editor.
    setTimeout(() => {
      try {
        if (!note.body && /^Adsız not/.test(note.title || '') && titleRef.current) { titleRef.current.focus(); titleRef.current.select(); }
      } catch (e) { /* ignore */ }
    }, 30);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const st = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor;
      if (!e) return {};
      const h = [1, 2, 3, 4].find((l) => e.isActive('heading', { level: l })) || 0;
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        heading: h,
        bullet: e.isActive('bulletList'),
        task: e.isActive('taskList'),
        quote: e.isActive('blockquote'),
        code: e.isActive('code') || e.isActive('codeBlock'),
        link: e.isActive('link'),
        hasSelection: !e.state.selection.empty,
        undo: e.can().undo(),
        redo: e.can().redo(),
      };
    },
  }) || {};

  const missingCss = useMemo(() => {
    const keys = (outgoing || []).filter((o) => o.missing && o.key).map((o) => o.key);
    if (!keys.length) return '';
    return `${keys.map((k) => `.nt-prose .nt-wikilink[data-key=${cssString(k)}]`).join(',\n')} { opacity: .55; border-style: dashed; }`;
  }, [outgoing]);

  const run = (fn) => () => { if (editor) fn(editor.chain().focus()).run(); };
  const cycleHeading = () => {
    if (!editor) return;
    const next = { 0: 1, 1: 2, 2: 3, 3: 0, 4: 0 }[st.heading || 0];
    if (next === 0) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().setHeading({ level: next }).run();
  };
  const toggleCode = () => {
    if (!editor) return;
    const { from, to, empty, $from, $to } = editor.state.selection;
    if (editor.isActive('code')) { editor.chain().focus().unsetCode().run(); return; }
    if (empty || !$from.sameParent($to) || editor.isActive('codeBlock') || to - from > 300) editor.chain().focus().toggleCodeBlock().run();
    else editor.chain().focus().toggleCode().run();
  };
  const openLink = () => {
    if (!editor) return;
    setLinkOpen({ initial: editor.getAttributes('link').href || '' });
  };
  const applyLink = (raw) => {
    const url = normalizeUrl(raw);
    setLinkOpen(null);
    if (!editor) return;
    if (!url) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent([{ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }, { type: 'text', text: ' ' }]).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  const selectionText = () => {
    if (mode === 'source') {
      const ta = sourceRef.current;
      if (!ta) return '';
      return ta.value.slice(ta.selectionStart, ta.selectionEnd);
    }
    if (!editor) return '';
    const { from, to } = editor.state.selection;
    try { return editor.state.doc.textBetween(from, to, '\n', (leaf) => (leaf.type.name === 'wikiLink' ? W.displayText(leaf.attrs) : '')); } catch (e) { return ''; }
  };

  const toggleMode = () => {
    if (mode === 'rich') {
      const md = editor ? safeMarkdown(editor) : null;
      setSourceText(md !== null ? md : (note.body || ''));
      setMode('source');
      setTimeout(() => { if (sourceRef.current) sourceRef.current.focus(); }, 20);
      return;
    }
    if (!editor) return;
    suppressRef.current = true;
    try {
      editor.commands.setContent(sourceText, { contentType: 'markdown', emitUpdate: false });
      setParseError('');
      setMode('rich');
      setTimeout(() => { try { editor.commands.focus(); } catch (e) { /* ignore */ } }, 20);
    } catch (e) {
      setParseError('Bu Markdown görsel düzenleyicide gösterilemedi; kaynak modunda kalınıyor.');
    } finally {
      suppressRef.current = false;
    }
  };

  useEffect(() => {
    if (!confirmDelete) return undefined;
    const t = setTimeout(() => setConfirmDelete(false), 3500);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const canCard = mode === 'rich' ? !!st.hasSelection : true;

  return (
    <div className="bg-bg-surface border border-border rounded-xl">
      {missingCss && <style>{missingCss}</style>}
      {/* Header */}
      <div className="flex items-start gap-2 px-5 pt-4">
        {onBack && (
          <button type="button" onClick={onBack} className="md:hidden mt-1.5 text-text-secondary hover:text-text-primary" aria-label="Not listesine dön">
            <L.ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (mode === 'source') { if (sourceRef.current) sourceRef.current.focus(); } else if (editor) editor.commands.focus('start');
              }
            }}
            placeholder="Başlık"
            aria-label="Not başlığı"
            aria-invalid={titleError ? 'true' : 'false'}
            maxLength={200}
            className={`w-full bg-transparent text-2xl font-bold text-text-primary placeholder:text-text-muted focus:outline-none border-b ${titleError ? 'border-negative/60' : 'border-transparent focus:border-border'}`}
          />
          {titleError && <p className="text-xs text-negative mt-1" role="alert">{titleError}</p>}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-text-muted">
            <span>Güncellendi: {relDate(note.updatedAt)}</span>
            {(note.tags || []).length > 0 && (
              <span className="flex flex-wrap gap-1">
                {note.tags.slice(0, 8).map((t) => <span key={t} className="px-1.5 rounded bg-info/10 text-info">#{t}</span>)}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 ${saveState === 'error' ? 'text-negative' : saveState === 'saved' ? 'text-positive' : ''}`}
              aria-live="polite"
              title={saveState === 'error' && saveError ? saveError : undefined}
            >
              {saveState === 'saving' && <L.LoaderCircle className="w-3 h-3 animate-spin" />}
              {saveState === 'saved' && <L.Check className="w-3 h-3" />}
              {saveState === 'error' && <L.TriangleAlert className="w-3 h-3" />}
              {SAVE_LABEL[saveState] || ''}
              {saveState === 'error' && onRetrySave && (
                <button type="button" onClick={onRetrySave} className="ml-1 font-semibold underline">Tekrar dene</button>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <TB onClick={onTogglePin} active={note.pinned} label={note.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}>
            {note.pinned ? <L.PinOff className="w-4 h-4" /> : <L.Pin className="w-4 h-4" />}
          </TB>
          {confirmDelete ? (
            <button
              type="button"
              onClick={() => { setConfirmDelete(false); onDelete(); }}
              className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-negative/15 text-negative hover:bg-negative/25"
            >
              <L.Trash2 className="w-3.5 h-3.5" />Emin misin?
            </button>
          ) : (
            <TB onClick={() => setConfirmDelete(true)} label="Notu sil"><L.Trash2 className="w-4 h-4" /></TB>
          )}
          {onTogglePanel && (
            <TB onClick={onTogglePanel} active={panelOpen} label={panelOpen ? 'Bağlantılar panelini gizle' : 'Bağlantılar panelini göster'}>
              {panelOpen ? <L.PanelRightClose className="w-4 h-4" /> : <L.PanelRightOpen className="w-4 h-4" />}
            </TB>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="relative flex items-center flex-wrap gap-0.5 px-4 py-2 mt-3 border-y border-border">
        <TB onClick={run((c) => c.toggleBold())} active={st.bold} disabled={mode !== 'rich'} label="Kalın (Ctrl+B)"><L.Bold className="w-4 h-4" /></TB>
        <TB onClick={run((c) => c.toggleItalic())} active={st.italic} disabled={mode !== 'rich'} label="İtalik (Ctrl+I)"><L.Italic className="w-4 h-4" /></TB>
        <TB onClick={cycleHeading} active={!!st.heading} disabled={mode !== 'rich'} label={st.heading ? `Başlık ${st.heading} (tıkla: değiştir)` : 'Başlık'}>
          {st.heading ? <span className="text-[11px] font-bold">H{st.heading}</span> : <L.Heading className="w-4 h-4" />}
        </TB>
        <Sep />
        <TB onClick={run((c) => c.toggleBulletList())} active={st.bullet} disabled={mode !== 'rich'} label="Madde listesi"><L.List className="w-4 h-4" /></TB>
        <TB onClick={run((c) => c.toggleTaskList())} active={st.task} disabled={mode !== 'rich'} label="Görev listesi"><L.ListTodo className="w-4 h-4" /></TB>
        <TB onClick={run((c) => c.toggleBlockquote())} active={st.quote} disabled={mode !== 'rich'} label="Alıntı"><L.Quote className="w-4 h-4" /></TB>
        <TB onClick={toggleCode} active={st.code} disabled={mode !== 'rich'} label="Kod"><L.Code className="w-4 h-4" /></TB>
        <TB onClick={openLink} active={st.link} disabled={mode !== 'rich'} label="Bağlantı"><L.Link className="w-4 h-4" /></TB>
        {linkOpen && (
          <LinkPopover
            initial={linkOpen.initial}
            onApply={applyLink}
            onRemove={() => applyLink('')}
            onClose={() => { setLinkOpen(null); if (editor) editor.commands.focus(); }}
          />
        )}
        <Sep />
        <TB onClick={run((c) => c.undo())} disabled={mode !== 'rich' || !st.undo} label="Geri al (Ctrl+Z)"><L.Undo2 className="w-4 h-4" /></TB>
        <TB onClick={run((c) => c.redo())} disabled={mode !== 'rich' || !st.redo} label="Yinele (Ctrl+Shift+Z)"><L.Redo2 className="w-4 h-4" /></TB>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { const t = selectionText().trim(); if (t) onRequestCard(t); }}
            disabled={!canCard}
            title={canCard ? 'Seçili metinden kart oluştur' : 'Önce bir metin seç'}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-input disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
          >
            <L.Layers className="w-3.5 h-3.5" />Kart oluştur
          </button>
          <button
            type="button"
            onClick={toggleMode}
            aria-pressed={mode === 'source'}
            title="Markdown kaynağını göster / gizle"
            className={`h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors ${mode === 'source' ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-bg-input'}`}
          >
            <L.FileCode className="w-3.5 h-3.5" />Kaynak
          </button>
        </div>
      </div>

      {parseError && (
        <div role="alert" className="mx-5 mt-3 flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 text-warning text-xs">
          <L.TriangleAlert className="w-3.5 h-3.5 flex-shrink-0" />{parseError}
        </div>
      )}

      {/* Body */}
      <div className="px-5 py-4">
        <div className={mode === 'rich' ? 'nt-prose' : 'hidden'}>
          <EditorContent editor={editor} />
        </div>
        {mode === 'source' && (
          <textarea
            ref={sourceRef}
            value={sourceText}
            onChange={(e) => { setSourceText(e.target.value); onBodyChange(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                const ta = e.target;
                const s = ta.selectionStart;
                const v = `${ta.value.slice(0, s)}  ${ta.value.slice(ta.selectionEnd)}`;
                setSourceText(v);
                onBodyChange(v);
                setTimeout(() => { ta.selectionStart = s + 2; ta.selectionEnd = s + 2; }, 0);
              }
            }}
            spellCheck={false}
            aria-label="Markdown kaynağı"
            className="nt-source nt-scroll"
          />
        )}
      </div>

      {sug && mode === 'rich' && <SuggestPopup state={sug} onHover={(i) => setSug((s) => (s ? { ...s, index: i } : s))} onPick={pick} />}
    </div>
  );
};

module.exports = NoteEditor;
