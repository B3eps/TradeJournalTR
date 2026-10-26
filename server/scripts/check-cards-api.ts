/**
 * Throwaway sanity check for the Kartlar (FSRS flashcards) backend. Runs
 * in-process against a temporary DATA_DIR; no server/port is started.
 * Usage: npx tsx server/scripts/check-cards-api.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-check-'));
process.env.DATA_DIR = tmp;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
}

async function main() {
  const app = (await import('../src/index')).default;
  const cdb = await import('../src/db/cards');
  const { getDb } = await import('../src/db/connection');
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  };

  // decks
  let r = await call('GET', '/api/decks');
  check('decks seeded (Okul, Trade, Genel)', r.status === 200 && ['Okul', 'Trade', 'Genel'].every((n) => r.json.decks.some((d: any) => d.name === n)), r.json);
  r = await call('GET', '/api/decks');
  check('seed idempotent', r.json.decks.length === 3);
  const okul = r.json.decks.find((d: any) => d.name === 'Okul');
  r = await call('POST', '/api/decks', { name: 'okul' });
  check('duplicate deck -> 409', r.status === 409, r.json);
  r = await call('POST', '/api/decks', { name: '' });
  check('empty deck name -> 400', r.status === 400 && typeof r.json.error === 'string');
  r = await call('POST', '/api/decks', { name: 'Geçici', color: '#112233' });
  check('create deck -> 201', r.status === 201 && r.json.id, r.json);
  const tmpDeck = r.json;

  // cards
  r = await call('POST', '/api/cards', { front: '', back: 'x' });
  check('empty front -> 400', r.status === 400);
  r = await call('POST', '/api/cards', { front: 'a', back: 'b', sourceType: 'bogus' });
  check('bad sourceType -> 400', r.status === 400);
  r = await call('POST', '/api/cards', '{bad');
  check('bad json -> 400', r.status === 400);
  r = await call('POST', '/api/cards', { front: 'Spread nedir?', back: 'Alış-satış farkı', sourceType: 'note', sourceId: 'n1', tags: ['trade', '#Temel'] });
  check('create card -> 201 in Genel', r.status === 201 && r.json.state === 0 && r.json.tags.length === 2, r.json);
  const c1 = r.json;
  const genel = (await call('GET', '/api/decks')).json.decks.find((d: any) => d.name === 'Genel');
  check('default deck is Genel', c1.deckId === genel.id);
  r = await call('POST', '/api/cards', { front: 'Pip nedir?', back: 'En küçük hareket', deckId: okul.id });
  const c2 = r.json;
  r = await call('GET', '/api/cards?q=SPREAD');
  check('search folds case', r.json.total === 1 && r.json.cards[0].id === c1.id, r.json);
  r = await call('GET', `/api/cards?deckId=${okul.id}`);
  check('deck filter', r.json.total === 1 && r.json.cards[0].id === c2.id);
  r = await call('GET', '/api/cards?state=new');
  check('state filter new', r.json.total === 2);
  r = await call('PATCH', `/api/cards/${c1.id}`, { back: 'Alış-satış farkı (maliyet)' });
  check('patch card', r.status === 200 && r.json.back.includes('maliyet'));
  r = await call('GET', '/api/cards/nope');
  check('missing card -> 404', r.status === 404);

  // queue
  r = await call('GET', '/api/cards/queue');
  check('queue has 2 new cards', r.status === 200 && r.json.cards.length === 2 && r.json.counts.new === 2, r.json);
  const iv = r.json.cards[0].nextIntervals;
  check('nextIntervals human strings', /dk|g|sa/.test(iv.again) && /dk|g|sa/.test(iv.good) && /g|dk/.test(iv.easy), iv);
  console.log('     new-card intervals:', JSON.stringify(iv));

  // review sequence (real route once, then time travel through the db layer)
  r = await call('POST', `/api/cards/${c1.id}/review`, { rating: 9 });
  check('invalid rating -> 400', r.status === 400);
  r = await call('POST', `/api/cards/${c1.id}/review`, { rating: 3, durationMs: 4200 });
  check('review good -> learning', r.status === 200 && r.json.card.state === 1 && r.json.card.reps === 1, r.json.card);
  check('counts after review', r.json.counts.new === 1, r.json.counts);

  const db = getDb();
  const userId = (db.prepare('SELECT user_id FROM cards LIMIT 1').get() as { user_id: string }).user_id;
  let t = new Date();
  const days = (n: number) => new Date(t.getTime() + n * 86400_000);
  // graduate: next due then Good
  const due1 = new Date(r.json.card.due);
  t = new Date(due1.getTime() + 1000);
  let res = cdb.reviewCard(db, userId, c1.id, 3, null, t);
  check('second good -> review state', res.card.state === 2, res.card);
  let last = res.card.scheduled_days;
  const grown: number[] = [last];
  for (let i = 0; i < 4; i++) {
    t = new Date(new Date(res.card.due).getTime() + 1000);
    res = cdb.reviewCard(db, userId, c1.id, 3, null, t);
    grown.push(res.card.scheduled_days);
  }
  console.log('     scheduled_days after Good x5:', grown.join(', '));
  check('intervals grow after Good', grown.every((v, i) => i === 0 || v > grown[i - 1]) && grown[grown.length - 1] > 20, grown);

  const before = res.card;
  t = new Date(new Date(before.due).getTime() + 1000);
  res = cdb.reviewCard(db, userId, c1.id, 1, null, t);
  check('Again lapses -> relearning', res.card.state === 3 && res.card.lapses === 1 && res.card.scheduled_days === 0, res.card);
  check('Again interval is minutes', /dk/.test(res.nextIntervals.again) || /dk/.test(res.nextIntervals.good), res.nextIntervals);
  const afterAgain = res.card;

  // undo
  res = cdb.undoReview(db, userId, c1.id, t);
  check('undo restores previous state', res.card.state === before.state && res.card.lapses === before.lapses
    && res.card.reps === before.reps && res.card.stability === before.stability && res.card.due === before.due, { before, restored: res.card, afterAgain });
  void days;

  // suspend
  r = await call('POST', `/api/cards/${c2.id}/suspend`);
  check('suspend toggles on', r.json.suspended === true);
  r = await call('GET', '/api/cards/queue');
  check('suspended card not in queue', !r.json.cards.some((c: any) => c.id === c2.id));
  r = await call('POST', `/api/cards/${c2.id}/review`, { rating: 3 });
  check('review suspended -> 400', r.status === 400);
  r = await call('POST', `/api/cards/${c2.id}/suspend`);
  check('suspend toggles off', r.json.suspended === false);

  // daily new-card limit
  r = await call('PATCH', '/api/cards/settings', { newPerDay: 0 });
  check('settings patch', r.status === 200 && r.json.newPerDay === 0, r.json);
  r = await call('GET', '/api/cards/queue');
  check('limit 0 hides new cards', r.json.counts.new === 0 && !r.json.cards.some((c: any) => c.state === 0), r.json.counts);
  r = await call('PATCH', '/api/cards/settings', { newPerDay: 999999 });
  check('invalid newPerDay -> 400', r.status === 400);
  r = await call('PATCH', '/api/cards/settings', { newPerDay: 20, retention: 0.95 });
  check('retention patch', r.json.retention === 0.95);
  await call('PATCH', '/api/cards/settings', { retention: 0.9 });

  // stats
  r = await call('GET', '/api/cards/stats');
  check('stats shape', r.status === 200 && r.json.byDay.length === 120 && r.json.totalCards === 2 && typeof r.json.streak === 'number', r.json);
  check('stats reviewedToday counts logs', r.json.reviewedToday >= 1, r.json.reviewedToday);

  // import / export
  const tsv = 'Soru bir\tCevap bir\n\nBozuk satır\nSoru iki\tCevap iki\tetiket1 etiket2\nSoru bir\tTekrar\n\t\nSoru üç\tÇok<br>satırlı\n';
  r = await call('POST', '/api/cards/import', { deckId: tmpDeck.id, tsv });
  check('import counts', r.status === 200 && r.json.imported === 3 && r.json.invalid === 1 && r.json.duplicates === 1, r.json);
  r = await call('GET', `/api/cards/export?deckId=${tmpDeck.id}`);
  check('export TSV', r.status === 200 && r.text.includes('Soru üç\tÇok<br>satırlı') && r.text.split('\n').filter(Boolean).length === 3, r.text);
  r = await call('POST', '/api/cards/import', { tsv: '' });
  check('empty import -> 400', r.status === 400);
  const csvPath = 'C:/Users/temir/TradeTools/Ogrenme/anki_kartlari.csv';
  if (fs.existsSync(csvPath)) {
    r = await call('POST', '/api/cards/import', { deckId: tmpDeck.id, tsv: fs.readFileSync(csvPath, 'utf8') });
    check('real anki file imports', r.status === 200 && r.json.imported > 0, r.json);
    console.log('     anki import:', JSON.stringify(r.json));
  }

  // delete
  r = await call('DELETE', `/api/decks/${tmpDeck.id}`);
  check('delete deck cascades', r.status === 200 && r.json.deletedCards >= 3, r.json);
  r = await call('DELETE', `/api/cards/${c2.id}`);
  check('delete card', r.status === 200);
  r = await call('DELETE', `/api/cards/${c2.id}`);
  check('delete twice -> 404', r.status === 404);

  console.log(failures ? `\n${failures} FAILED` : '\nALL OK');
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* db may still be open on Windows */ }
    process.exit(failures ? 1 : 0);
  });
