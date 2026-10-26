/**
 * Small dependency-free RSS 2.0 / Atom parser. It only extracts the handful of
 * fields the news feed needs (title, link, summary, date) and never evaluates
 * anything from the document.
 */

export interface RawFeedItem {
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null; // ISO, null when the feed has no usable date
  guid?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  euro: '€', pound: '£', yen: '¥', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    const named = NAMED_ENTITIES[ent.toLowerCase()];
    return named !== undefined ? named : m;
  });
}

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** HTML/XML fragment -> plain single-line text. */
export function toPlainText(fragment: string): string {
  let s = unwrapCdata(fragment);
  s = decodeEntities(s); // escaped HTML (Atom type="html", double-encoded RSS)
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

function tagContent(block: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null;
}

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(toPlainText(raw));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function atomLink(block: string): string {
  const links = block.match(/<link\b[^>]*>/gi) || [];
  let fallback = '';
  for (const l of links) {
    const href = attr(l, 'href');
    if (!href) continue;
    const rel = (attr(l, 'rel') || 'alternate').toLowerCase();
    if (rel === 'alternate') return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

export function parseFeed(xml: string): RawFeedItem[] {
  const items: RawFeedItem[] = [];
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');

  const rssBlocks = body.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  for (const b of rssBlocks) {
    const title = toPlainText(tagContent(b, 'title') || '');
    const guid = toPlainText(tagContent(b, 'guid') || '');
    let url = toPlainText(tagContent(b, 'link') || '');
    if (!/^https?:\/\//i.test(url) && /^https?:\/\//i.test(guid)) url = guid;
    const summary = toPlainText(tagContent(b, 'description') || tagContent(b, 'content:encoded') || '');
    const publishedAt = toIso(tagContent(b, 'pubDate') || tagContent(b, 'dc:date') || tagContent(b, 'updated'));
    if (title && url) items.push({ title, url, summary, publishedAt, guid: guid || undefined });
  }
  if (rssBlocks.length) return items;

  const atomBlocks = body.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];
  for (const b of atomBlocks) {
    const title = toPlainText(tagContent(b, 'title') || '');
    const url = atomLink(b);
    const summary = toPlainText(tagContent(b, 'summary') || tagContent(b, 'content') || '');
    const publishedAt = toIso(tagContent(b, 'published') || tagContent(b, 'updated'));
    const guid = toPlainText(tagContent(b, 'id') || '');
    if (title && url) items.push({ title, url, summary, publishedAt, guid: guid || undefined });
  }
  return items;
}
