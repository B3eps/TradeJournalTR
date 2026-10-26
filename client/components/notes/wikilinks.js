/*
 * Tiptap extensions for the Notes page.
 *
 *   WikiLink     inline atom node for [[wikilinks]], parsed from / serialized to
 *                plain Markdown (Obsidian compatible):
 *                  [[Başlık]]  [[Başlık|metin]]  [[Başlık#Bölüm]]
 *                  [[görev:<id>|Başlık]]  [[işlem:<id>|Etiket]]  [[haber:<id>|Başlık]]  [[not:<id>|Başlık]]
 *                Typing a complete [[...]] by hand also converts it (input rule).
 *   WikiSuggest  opens a suggestion popup when "[[" is typed (@tiptap/suggestion).
 *                The popup UI lives in React; this extension only forwards the
 *                suggestion lifecycle to `options.controller`.
 *
 * Every wikilink chip carries data-key (same scheme as the server's outgoing
 * `key`): folded title for notes, '<kind>:<id>' for typed links ('id:<id>' for
 * typed notes). The editor marks unresolved links by injecting CSS for keys.
 */
const { Node, Extension, InputRule, mergeAttributes } = require('@tiptap/core');
const { PluginKey } = require('@tiptap/pm/state');
const SuggestionMod = require('@tiptap/suggestion');

const Suggestion = SuggestionMod.Suggestion || SuggestionMod.default;

// Same folding as the server (server/src/db/tasks.ts foldText + titleKey).
const foldText = (v) => String(v == null ? '' : v)
  .replace(/[İIı]/g, 'i')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');
const titleKey = (t) => foldText(t).replace(/\s+/g, ' ').trim();

const KIND_PREFIX = { task: 'görev', trade: 'işlem', news: 'haber', note: 'not' };
const PREFIX_KIND = { gorev: 'task', islem: 'trade', haber: 'news', not: 'note' };
const KIND_LABEL = { note: 'Not', task: 'Görev', trade: 'İşlem', news: 'Haber' };

const cleanPart = (s) => String(s == null ? '' : s).replace(/[[\]|\n\r]/g, ' ').replace(/\s+/g, ' ').trim();

// Parses the inside of [[...]]; null when unusable. Mirrors server parseWikiInner.
const parseInner = (inner) => {
  const s = String(inner || '');
  const pipe = s.indexOf('|');
  const rawTarget = (pipe >= 0 ? s.slice(0, pipe) : s).trim();
  const alias = pipe >= 0 ? (s.slice(pipe + 1).trim() || null) : null;
  if (!rawTarget) return null;
  const typed = /^([^\s:]{2,6}):\s*([A-Za-z0-9_-]{1,128})$/.exec(rawTarget);
  if (typed) {
    const kind = PREFIX_KIND[foldText(typed[1])];
    if (kind) return { kind, target: typed[2], label: alias, suffix: '', typed: true };
  }
  const cut = rawTarget.search(/[#^]/);
  const title = (cut >= 0 ? rawTarget.slice(0, cut) : rawTarget).replace(/\s+/g, ' ').trim();
  if (!title) return null;
  return { kind: 'note', target: title, label: alias, suffix: cut >= 0 ? rawTarget.slice(cut).trim() : '', typed: false };
};

const isTyped = (a) => a.kind !== 'note' || !!a.typed;

const keyOf = (a) => {
  if (!a) return '';
  if (a.kind === 'note' && !a.typed) return titleKey(a.target);
  if (a.kind === 'note') return `id:${a.target}`;
  return `${a.kind}:${a.target}`;
};

const toMarkdown = (a) => {
  const label = a.label ? cleanPart(a.label) : '';
  if (isTyped(a)) {
    return `[[${KIND_PREFIX[a.kind] || 'not'}:${a.target}${label ? `|${label}` : ''}]]`;
  }
  const target = cleanPart(a.target).replace(/[#^]/g, ' ').trim();
  const suffix = a.suffix ? String(a.suffix).replace(/[[\]|\n\r]/g, '') : '';
  return `[[${target}${suffix}${label && label !== target ? `|${label}` : ''}]]`;
};

const displayText = (a) => {
  if (a.label) return a.label;
  if (isTyped(a)) return `${KIND_LABEL[a.kind] || 'Not'} ${String(a.target).slice(0, 8)}`;
  return a.suffix ? `${a.target}${a.suffix.replace(/^#/, ' › ')}` : a.target;
};

const WIKI_SRC_RE = /^\[\[([^[\]\n]{1,400}?)\]\]/;

const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: { default: 'note' },
      target: { default: '' },
      label: { default: null },
      suffix: { default: '' },
      typed: { default: false },
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-wikilink]',
      getAttrs: (el) => ({
        kind: el.getAttribute('data-kind') || 'note',
        target: el.getAttribute('data-target') || '',
        label: el.getAttribute('data-label') || null,
        suffix: el.getAttribute('data-suffix') || '',
        typed: el.getAttribute('data-typed') === 'true',
      }),
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs;
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-wikilink': '',
      'data-kind': a.kind,
      'data-target': a.target,
      'data-label': a.label || null,
      'data-suffix': a.suffix || null,
      'data-typed': a.typed ? 'true' : null,
      'data-key': keyOf(a),
      class: `nt-wikilink nt-wikilink--${a.kind}`,
      title: a.kind === 'note' ? `Not: ${a.target}` : `${KIND_LABEL[a.kind] || ''}: ${a.label || a.target}`,
    }), displayText(a)];
  },

  renderText({ node }) {
    return toMarkdown(node.attrs);
  },

  markdownTokenName: 'wikiLink',

  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start: (src) => src.indexOf('[['),
    tokenize: (src) => {
      const m = WIKI_SRC_RE.exec(src);
      if (!m) return undefined;
      const p = parseInner(m[1]);
      if (!p) return undefined;
      return { type: 'wikiLink', raw: m[0], text: m[1], attrs: p };
    },
  },

  parseMarkdown(token, helpers) {
    const p = token.attrs || parseInner(token.text) || { kind: 'note', target: token.text || '', label: null, suffix: '', typed: false };
    return helpers.createNode('wikiLink', p);
  },

  renderMarkdown(node) {
    return toMarkdown(node.attrs || {});
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^[\]\n]{1,400})\]\]$/,
        handler: ({ state, range, match }) => {
          const p = parseInner(match[1]);
          if (!p) return null;
          state.tr.replaceWith(range.from, range.to, this.type.create(p));
          return undefined;
        },
      }),
    ];
  },
});

const WikiSuggestKey = new PluginKey('wikiSuggest');

// options.getController(): returns { fetch(query, signal) -> items, onStart(props), onUpdate(props),
// onExit(), onKeyDown(event) -> bool, onPick(item, editor, range) }. A getter (not an object) because
// configure() deep-merges plain objects and would detach a React ref.
const WikiSuggest = Extension.create({
  name: 'wikiSuggest',

  addOptions() {
    return { getController: null };
  },

  addProseMirrorPlugins() {
    const getCtl = () => (typeof this.options.getController === 'function' ? this.options.getController() : null);
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: WikiSuggestKey,
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        debounce: 120,
        decorationClass: 'nt-suggest-deco',
        items: async ({ query, signal }) => {
          const ctl = getCtl();
          if (!ctl || !ctl.fetch) return [];
          try { return (await ctl.fetch(query, signal)) || []; } catch (e) { return []; }
        },
        command: ({ editor, range, props }) => {
          const ctl = getCtl();
          if (ctl && ctl.onPick) ctl.onPick(props, editor, range);
        },
        render: () => ({
          onStart: (props) => { const c = getCtl(); if (c && c.onStart) c.onStart(props); },
          onUpdate: (props) => { const c = getCtl(); if (c && c.onUpdate) c.onUpdate(props); },
          onExit: () => { const c = getCtl(); if (c && c.onExit) c.onExit(); },
          onKeyDown: ({ event }) => {
            const c = getCtl();
            return !!(c && c.onKeyDown && c.onKeyDown(event));
          },
        }),
      }),
    ];
  },
});

// Inserts a wikilink node (plus a trailing space) over `range`.
const insertWikiLink = (editor, range, attrs) => {
  editor.chain().focus().insertContentAt(range, [
    { type: 'wikiLink', attrs: { kind: 'note', label: null, suffix: '', typed: false, ...attrs } },
    { type: 'text', text: ' ' },
  ]).run();
};

module.exports = {
  WikiLink,
  WikiSuggest,
  WikiSuggestKey,
  insertWikiLink,
  parseInner,
  toMarkdown,
  keyOf,
  titleKey,
  foldText,
  displayText,
  KIND_LABEL,
};
