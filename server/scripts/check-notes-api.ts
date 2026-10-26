/**
 * Throwaway sanity check for the Notes backend (parsing, CRUD, wikilinks,
 * backlinks, rename rewrite, tags, daily note, export/import, search).
 * Runs in-process against a temporary DATA_DIR; no server/port is started.
 * Usage: npx tsx server/scripts/check-notes-api.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-check-'));
process.env.DATA_DIR = tmp;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
}

async function main() {
  const N = await import('../src/db/notes');

  // ── Pure parsing ──
  const md = [
    'Merhaba [[Strateji Notu]] ve [[strateji notu|takma]] #trade #Öğrenme',
    '## Başlık #yok',
    '```',
    '[[Kodda]] #kodda',
    '```',
    'Satır içi `[[kod]] #kod` ve [[görev:abc-123|Bir görev]] [[Plan#Bölüm|plan]] #123 http://x.com/#frag',
    '\\[\\[Kaçış\\]\\] [[ ]] [[#Yerel]]',
  ].join('\n');
  const refs = N.extractWikiLinks(md);
  check('wikilinks parsed (code excluded)', refs.map((r) => r.key).join(',') === 'strateji notu,strateji notu,task:abc-123,plan', refs);
  check('alias + suffix kept', refs[1].alias === 'takma' && refs[3].suffix === '#Bölüm' && refs[3].alias === 'plan', refs);
  const tags = N.extractTags(md);
  check('tags parsed (no headings/code/numbers/urls)', tags.join(',') === 'trade,Öğrenme', tags);
  const rw = N.rewriteNoteLinks(md, 'strateji notu', 'Yeni Ad');
  check('rewrite keeps alias, skips code', rw.changed && rw.body.includes('[[Yeni Ad]]') && rw.body.includes('[[Yeni Ad|takma]]') && rw.body.includes('[[Kodda]]'), rw.body);
  check('excerpt plain', N.makeExcerpt('# Başlık\n**kalın** [[A|bağ]] [x](http://y) &amp; \\_') === 'Başlık kalın bağ x & _', N.makeExcerpt('# Başlık\n**kalın** [[A|bağ]] [x](http://y) &amp; \\_'));
  check('malformed markdown does not throw', (() => { try { N.extractWikiLinks('[[[[]]]] ``` [[a'); N.makeExcerpt('`'.repeat(50)); N.extractTags('#'.repeat(1000)); return true; } catch { return false; } })());
  const fmp = N.parseFrontMatter('---\ntitle: "Merhaba: dünya"\ntags:\n  - a\n  - "b c"\ncreated: 2026-01-02\n---\nGövde');
  check('front matter parsed', fmp.fm.title === 'Merhaba: dünya' && fmp.fm.tags.join(',') === 'a,b-c' && fmp.body === 'Gövde' && !!fmp.fm.created, fmp);

  // ── HTTP layer, in-process ──
  const app = (await import('../src/index')).default;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  };

  let r = await call('GET', '/api/notes');
  check('empty list', r.status === 200 && r.json.total === 0 && Array.isArray(r.json.notes), r);
  r = await call('POST', '/api/notes', {});
  check('create untitled -> Adsız not', r.status === 201 && r.json.title === 'Adsız not', r.json);
  const untitled = r.json;
  r = await call('POST', '/api/notes', {});
  check('second untitled -> Adsız not 2', r.json.title === 'Adsız not 2', r.json);
  r = await call('POST', '/api/notes', { title: 'a[b]' });
  check('bad title chars -> 400', r.status === 400 && typeof r.json.error === 'string', r);
  r = await call('POST', '/api/notes', '{bad');
  check('bad json -> 400', r.status === 400);

  r = await call('POST', '/api/notes', { title: 'Strateji', body: 'Kurallar #trade' });
  const strat = r.json;
  check('create Strateji', r.status === 201 && strat.tags[0] === 'trade', r.json);
  r = await call('POST', '/api/notes', { title: 'STRATEJİ' });
  check('duplicate title (Turkish fold) -> 409', r.status === 409, r);

  // A task to link to
  const task = (await call('POST', '/api/tasks', { title: 'Bilanço oku' })).json;
  r = await call('POST', '/api/notes', {
    title: 'Günlük fikir', body: `Bak: [[strateji]] ve [[Henüz Yok]] ve [[görev:${task.id}|Bilanço]] #fikir`,
  });
  const idea = r.json;
  check('create note with links', r.status === 201, r.json);

  r = await call('GET', `/api/notes/${idea.id}`);
  const out = r.json.outgoing;
  check('outgoing resolved/missing', out.length === 3 && out[0].id === strat.id && !out[0].missing && out[1].missing && out[1].id === null
    && out[2].type === 'task' && out[2].label === 'Bilanço oku' && !out[2].missing, out);
  r = await call('GET', `/api/notes/${strat.id}`);
  check('backlink on Strateji', r.json.backlinks.length === 1 && r.json.backlinks[0].id === idea.id && r.json.backlinks[0].type === 'note', r.json.backlinks);
  r = await call('GET', `/api/links?type=task&id=${task.id}`);
  check('task sees note link via links table', r.json.links.length === 1 && r.json.links[0].type === 'note' && r.json.links[0].label === 'Günlük fikir', r.json);
  r = await call('GET', '/api/notes?sort=title');
  const stratRow = r.json.notes.find((n: any) => n.id === strat.id);
  check('list backlinkCount', stratRow?.backlinkCount === 1, stratRow);

  // Creating the missing note resolves it
  r = await call('POST', '/api/notes', { title: 'henüz yok' });
  const later = r.json;
  r = await call('GET', `/api/notes/${idea.id}`);
  check('missing link resolves after create', r.json.outgoing[1].id === later.id && !r.json.outgoing[1].missing, r.json.outgoing);
  r = await call('GET', `/api/links?type=note&id=${later.id}`);
  check('links row added for newly created target', r.json.links.length === 1 && r.json.links[0].id === idea.id, r.json);

  // Manual link from a task to a note shows as backlink and survives body saves
  r = await call('POST', '/api/links', { fromType: 'task', fromId: task.id, toType: 'note', toId: strat.id });
  check('manual task->note link', r.status === 201, r);
  r = await call('PATCH', `/api/notes/${strat.id}`, { body: 'Değişti #trade #yeni' });
  check('patch body returns detail', r.status === 200 && r.json.note.tags.join(',') === 'trade,yeni', r.json);
  check('manual link in backlinks', r.json.backlinks.some((b: any) => b.type === 'task' && b.id === task.id), r.json.backlinks);

  // Rename rewrites other notes
  r = await call('PATCH', `/api/notes/${strat.id}`, { title: 'Ana Strateji' });
  check('rename ok', r.status === 200 && r.json.note.title === 'Ana Strateji', r.json);
  r = await call('GET', `/api/notes/${idea.id}`);
  check('rename rewrote [[strateji]]', r.json.note.body.includes('[[Ana Strateji]]') && r.json.outgoing[0].id === strat.id, r.json.note.body);
  r = await call('PATCH', `/api/notes/${strat.id}`, { title: 'Henüz Yok' });
  check('rename into existing title -> 409', r.status === 409, r);
  r = await call('PATCH', `/api/notes/${strat.id}`, { pinned: 'evet' });
  check('bad pinned -> 400', r.status === 400);
  r = await call('PATCH', `/api/notes/${strat.id}`, { pinned: true });
  r = await call('GET', '/api/notes?pinned=true');
  check('pinned filter', r.json.total === 1 && r.json.notes[0].id === strat.id, r.json);
  r = await call('GET', '/api/notes');
  check('pinned first', r.json.notes[0].id === strat.id);

  // Filters / tags / search
  r = await call('GET', '/api/notes?tag=%23FIKIR');
  check('tag filter folded', r.json.total === 1 && r.json.notes[0].id === idea.id, r.json);
  r = await call('GET', '/api/notes?q=bilan');
  check('q search body', r.json.total === 1, r.json);
  r = await call('GET', '/api/notes/tags');
  check('tag list', r.json.tags.some((t: any) => t.tag === 'trade'), r.json);
  r = await call('GET', '/api/notes?sort=bogus');
  check('bad sort -> 400', r.status === 400);
  r = await call('GET', '/api/search?q=strateji');
  check('global search returns notes', Array.isArray(r.json.notes) && r.json.notes[0]?.id === strat.id && Array.isArray(r.json.tasks), r.json);

  // Daily note
  r = await call('POST', '/api/notes/daily', { date: '2026-10-26' });
  check('daily created 201', r.status === 201 && r.json.title === '2026-10-26' && r.json.body.includes('Akşam değerlendirmesi') && r.json.tags.includes('günlük'), r.json);
  const daily = r.json;
  r = await call('POST', '/api/notes/daily', { date: '2026-10-26' });
  check('daily idempotent 200', r.status === 200 && r.json.id === daily.id);
  r = await call('POST', '/api/notes/daily', { date: '2026-02-30' });
  check('daily bad date -> 400', r.status === 400);
  r = await call('POST', '/api/notes/daily');
  check('daily without body', r.status === 201 || r.status === 200, r);

  // Export / import
  r = await call('GET', '/api/notes/export');
  check('export bundle', Array.isArray(r.json) && r.json.length >= 6 && r.json.every((f: any) => f.name.endsWith('.md') && f.content.startsWith('---\ntitle: ')), r.json?.length);
  const exported = r.json;
  r = await call('POST', '/api/notes/import', {
    files: [
      { name: 'Obsidian/Toplantı.md', content: '---\ntags: [toplanti, "iş"]\n---\n# Haftalık Toplantı\n[[Ana Strateji]] konuşuldu.' },
      { name: 'Ana Strateji.md', content: 'Kopya' },
      { name: 'resim.png', content: 'x' },
    ],
  });
  check('import result', r.status === 200 && r.json.imported === 2 && r.json.skipped.length === 1, r.json);
  const imp = r.json.notes;
  check('import title from heading', imp[0].title === 'Haftalık Toplantı', imp);
  check('import duplicate renamed', imp[1].title === 'Ana Strateji 2', imp);
  r = await call('GET', `/api/notes/${imp[0].id}`);
  check('import keeps fm tags + links', r.json.note.tags.includes('toplanti') && r.json.note.tags.includes('iş') && r.json.outgoing[0].id === strat.id, r.json);
  r = await call('POST', '/api/notes/import', { files: exported });
  check('re-import export round trip', r.status === 200 && r.json.imported === exported.length, r.json?.imported);
  r = await call('POST', '/api/notes/import', { files: [] });
  check('import empty -> 400', r.status === 400);

  // Delete
  r = await call('DELETE', `/api/notes/${strat.id}`);
  check('delete', r.status === 200);
  r = await call('GET', `/api/links?type=task&id=${task.id}`);
  check('links removed with note (manual + synced)', !r.json.links.some((l: any) => l.type === 'note' && l.id === strat.id), r.json);
  r = await call('GET', `/api/notes/${idea.id}`);
  check('outgoing now missing', r.json.outgoing[0].missing === true, r.json.outgoing);
  r = await call('GET', `/api/notes/${strat.id}`);
  check('deleted -> 404', r.status === 404 && typeof r.json.error === 'string');
  r = await call('DELETE', `/api/notes/${untitled.id}`);
  check('delete untitled', r.status === 200);

  // Remove the wikilink from body -> synced link row removed
  r = await call('PATCH', `/api/notes/${idea.id}`, { body: 'Artık bağlantı yok' });
  r = await call('GET', `/api/links?type=task&id=${task.id}`);
  check('removing [[görev:..]] removes link row', !r.json.links.some((l: any) => l.id === idea.id), r.json);

  console.log(failures ? `\n${failures} FAILED` : '\nALL OK');
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* db may still be open on Windows */ }
    process.exit(failures ? 1 : 0);
  });
