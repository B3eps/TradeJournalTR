// Tiny, safe markdown preview for task notes (no HTML injection).
// Supports: # headings, **bold**, *italic*, `code`, - / * bullets, 1. lists, - [ ] / - [x] checkboxes.
const React = require('react');

const renderInline = (text, keyBase) => {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*|(https?:\/\/[^\s)]+))/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[2] != null) out.push(<strong key={k} className="font-semibold text-text-primary">{m[2]}</strong>);
    else if (m[3] != null) out.push(<code key={k} className="px-1 py-0.5 rounded bg-bg-input font-mono text-[12px]">{m[3]}</code>);
    else if (m[4] != null) out.push(<em key={k}>{m[4]}</em>);
    else if (m[5] != null) {
      const url = m[5];
      out.push(
        <a key={k} href={url} onClick={(e) => { e.preventDefault(); try { window.open(url, '_blank', 'noopener'); } catch (err) { /* ignore */ } }} className="text-accent hover:underline break-all">{url}</a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

const MarkdownPreview = ({ text, onToggleCheckbox }) => {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let list = null; // { kind: 'ul'|'ol', items: [] }
  const flush = () => { if (list) { blocks.push(list); list = null; } };

  lines.forEach((line, idx) => {
    const cb = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (cb) {
      if (!list || list.kind !== 'ul') { flush(); list = { kind: 'ul', items: [] }; }
      list.items.push({ idx, checkbox: true, checked: cb[1] !== ' ', text: cb[2] });
    } else if (ul) {
      if (!list || list.kind !== 'ul') { flush(); list = { kind: 'ul', items: [] }; }
      list.items.push({ idx, text: ul[1] });
    } else if (ol) {
      if (!list || list.kind !== 'ol') { flush(); list = { kind: 'ol', items: [] }; }
      list.items.push({ idx, text: ol[1] });
    } else {
      flush();
      if (h) blocks.push({ kind: 'h', level: h[1].length, text: h[2], idx });
      else if (line.trim() === '') blocks.push({ kind: 'br', idx });
      else blocks.push({ kind: 'p', text: line, idx });
    }
  });
  flush();

  if (!String(text || '').trim()) return <p className="text-sm text-text-muted italic">Not yok.</p>;

  return (
    <div className="text-sm text-text-secondary space-y-1.5 leading-relaxed">
      {blocks.map((b, bi) => {
        if (b.kind === 'h') {
          const cls = b.level === 1 ? 'text-base font-bold' : 'text-sm font-semibold';
          return <p key={bi} className={`${cls} text-text-primary`}>{renderInline(b.text, `h${bi}`)}</p>;
        }
        if (b.kind === 'br') return <div key={bi} className="h-1" />;
        if (b.kind === 'p') return <p key={bi}>{renderInline(b.text, `p${bi}`)}</p>;
        const ListTag = b.kind === 'ol' ? 'ol' : 'ul';
        return (
          <ListTag key={bi} className={b.kind === 'ol' ? 'list-decimal pl-5 space-y-0.5' : 'space-y-0.5'}>
            {b.items.map(it => (
              <li key={it.idx} className={it.checkbox ? 'flex items-start gap-2 list-none' : b.kind === 'ul' ? 'flex items-start gap-2' : ''}>
                {it.checkbox ? (
                  <input
                    type="checkbox"
                    checked={it.checked}
                    onChange={() => onToggleCheckbox && onToggleCheckbox(it.idx)}
                    className="mt-1 accent-[rgb(var(--accent))] cursor-pointer"
                    aria-label={it.text}
                  />
                ) : b.kind === 'ul' ? <span className="mt-2 w-1 h-1 rounded-full bg-text-tertiary flex-shrink-0" /> : null}
                <span className={it.checked ? 'line-through text-text-tertiary' : ''}>{renderInline(it.text, `li${it.idx}`)}</span>
              </li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
};

// Flip "- [ ]" <-> "- [x]" on the given line.
MarkdownPreview.toggleCheckboxLine = (text, lineIdx) => {
  const lines = String(text || '').split('\n');
  const l = lines[lineIdx];
  if (l == null) return text;
  lines[lineIdx] = l.replace(/\[( |x|X)\]/, (m, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
};

module.exports = MarkdownPreview;
