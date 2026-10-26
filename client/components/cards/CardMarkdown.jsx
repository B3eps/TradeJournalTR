// Tiny, safe markdown renderer for card faces (no HTML injection).
// Supports **bold**, *italic*, `code`, - / * bullets, 1. lists and {{c1::cloze}}.
// mode: 'front' hides cloze answers behind a blank, 'back' highlights them, 'off' ignores cloze syntax.
const React = require('react');

const INLINE_RE = /(\{\{c\d+::[\s\S]*?\}\}|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
const CLOZE_ONE = /^\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}$/;

const renderInline = (text, mode, keyBase) => {
  const out = [];
  let last = 0;
  let i = 0;
  let m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    const cz = CLOZE_ONE.exec(tok);
    if (cz && mode !== 'off') {
      if (mode === 'front') {
        out.push(
          <span key={k} className="inline-block min-w-[3.5rem] px-2 mx-0.5 rounded-md bg-accent/15 text-accent font-semibold text-center align-baseline">
            {cz[2] ? `[${cz[2]}]` : '[...]'}
          </span>
        );
      } else {
        out.push(<span key={k} className="px-1.5 mx-0.5 rounded-md bg-accent/15 text-accent font-semibold">{cz[1]}</span>);
      }
    } else if (cz) {
      out.push(tok);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={k} className="font-semibold text-text-primary">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={k} className="px-1.5 py-0.5 rounded bg-bg-input font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

const CardMarkdown = ({ text, mode = 'off', className = '' }) => {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  lines.forEach((line, idx) => {
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul) {
      if (!list || list.kind !== 'ul') { flush(); list = { kind: 'ul', items: [] }; }
      list.items.push(ul[1]);
    } else if (ol) {
      if (!list || list.kind !== 'ol') { flush(); list = { kind: 'ol', items: [] }; }
      list.items.push(ol[1]);
    } else {
      flush();
      blocks.push({ kind: line.trim() ? 'p' : 'br', text: line, idx });
    }
  });
  flush();

  return (
    <div className={`space-y-1.5 break-words ${className}`}>
      {blocks.map((b, bi) => {
        if (b.kind === 'ul' || b.kind === 'ol') {
          const Tag = b.kind;
          return (
            <Tag key={bi} className={`${b.kind === 'ul' ? 'list-disc' : 'list-decimal'} pl-6 space-y-0.5 text-left`}>
              {b.items.map((it, ii) => <li key={ii}>{renderInline(it, mode, `${bi}-${ii}`)}</li>)}
            </Tag>
          );
        }
        if (b.kind === 'br') return <div key={bi} className="h-2" />;
        return <p key={bi}>{renderInline(b.text, mode, String(bi))}</p>;
      })}
    </div>
  );
};

module.exports = CardMarkdown;
