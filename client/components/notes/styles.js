// Editor typography for the Notes page (Tiptap is headless). Injected once by NotesPage.
// Colours come from the app's theme variables so light/dark themes both work.
module.exports = `
.nt-prose { color: rgb(var(--text-primary)); font-size: 15px; line-height: 1.7; word-wrap: break-word; }
.nt-prose .ProseMirror { outline: none; min-height: 52vh; padding-bottom: 4rem; }
.nt-prose .ProseMirror > * + * { margin-top: 0.6em; }
.nt-prose h1 { font-size: 1.6em; font-weight: 700; line-height: 1.25; margin-top: 1.1em; }
.nt-prose h2 { font-size: 1.3em; font-weight: 650; line-height: 1.3; margin-top: 1.1em; }
.nt-prose h3 { font-size: 1.1em; font-weight: 600; margin-top: 1em; }
.nt-prose h4, .nt-prose h5, .nt-prose h6 { font-weight: 600; margin-top: 0.9em; }
.nt-prose .ProseMirror > :first-child { margin-top: 0; }
.nt-prose strong { font-weight: 650; }
.nt-prose a { color: rgb(var(--accent)); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.nt-prose ul, .nt-prose ol { padding-left: 1.4em; }
.nt-prose ul { list-style: disc; }
.nt-prose ol { list-style: decimal; }
.nt-prose li > p { margin: 0; }
.nt-prose li + li { margin-top: 0.15em; }
.nt-prose ul[data-type="taskList"] { list-style: none; padding-left: 0.1em; }
.nt-prose ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
.nt-prose ul[data-type="taskList"] li > label { flex: 0 0 auto; margin-top: 0.32em; user-select: none; }
.nt-prose ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.nt-prose ul[data-type="taskList"] li[data-checked="true"] > div { color: rgb(var(--text-tertiary)); text-decoration: line-through; }
.nt-prose ul[data-type="taskList"] input[type="checkbox"] { width: 15px; height: 15px; accent-color: rgb(var(--accent)); cursor: pointer; }
.nt-prose blockquote { border-left: 3px solid rgb(var(--accent) / 0.55); padding: 0.1em 0 0.1em 0.9em; color: rgb(var(--text-secondary)); }
.nt-prose code { font-family: 'JetBrains Mono', monospace; font-size: 0.86em; background: rgb(var(--bg-input)); border: 1px solid rgb(var(--border)); border-radius: 5px; padding: 0.08em 0.35em; }
.nt-prose pre { font-family: 'JetBrains Mono', monospace; font-size: 0.85em; background: rgb(var(--bg-input)); border: 1px solid rgb(var(--border)); border-radius: 10px; padding: 0.8em 1em; overflow-x: auto; }
.nt-prose pre code { background: none; border: 0; padding: 0; font-size: inherit; }
.nt-prose hr { border: 0; border-top: 1px solid rgb(var(--border)); margin: 1.4em 0; }
.nt-prose p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: rgb(var(--text-muted)); float: left; height: 0; pointer-events: none; }
.nt-prose .ProseMirror-selectednode.nt-wikilink { box-shadow: 0 0 0 2px rgb(var(--accent) / 0.6); }

.nt-wikilink { display: inline-flex; align-items: center; gap: 0.25em; padding: 0 0.45em; margin: 0 0.05em; border-radius: 6px; font-size: 0.92em; line-height: 1.5;
  background: rgb(var(--accent) / 0.12); color: rgb(var(--accent)); border: 1px solid rgb(var(--accent) / 0.25); cursor: pointer; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: baseline;
  transition: background-color .15s ease, border-color .15s ease; }
.nt-wikilink:hover { background: rgb(var(--accent) / 0.2); border-color: rgb(var(--accent) / 0.45); }
.nt-wikilink::before { font-size: 0.85em; opacity: 0.8; }
.nt-wikilink--note::before { content: '◇'; }
.nt-wikilink--task::before { content: '☐'; }
.nt-wikilink--trade::before { content: '↗'; }
.nt-wikilink--news::before { content: '▤'; }
.nt-wikilink--task { background: rgb(var(--positive) / 0.1); color: rgb(var(--positive)); border-color: rgb(var(--positive) / 0.25); }
.nt-wikilink--trade { background: rgb(var(--info) / 0.1); color: rgb(var(--info)); border-color: rgb(var(--info) / 0.25); }
.nt-wikilink--news { background: rgb(var(--warning) / 0.1); color: rgb(var(--warning)); border-color: rgb(var(--warning) / 0.25); }
.nt-wikilink.nt-missing, .nt-missing-chip { opacity: 0.55; border-style: dashed; }
.nt-suggest-deco { background: rgb(var(--accent) / 0.12); border-radius: 4px; }

.nt-source { width: 100%; min-height: 52vh; resize: vertical; background: transparent; color: rgb(var(--text-primary)); font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.65; outline: none; tab-size: 2; }
.nt-scroll::-webkit-scrollbar { width: 8px; }
.nt-scroll::-webkit-scrollbar-thumb { background: rgb(var(--border)); border-radius: 8px; }
`;
