/**
 * Throwaway sanity check for the Finans backend. In-process, temporary DATA_DIR.
 * Usage: npx tsx server/scripts/check-finance-api.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-check-'));
process.env.DATA_DIR = tmp;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
}

async function main() {
  const f = await import('../src/db/finance');
  check('parseAmount 1.234,56', f.parseAmount('1.234,56') === 1234.56);
  check('parseAmount -1.234,56 TL', f.parseAmount('-1.234,56 TL') === -1234.56);
  check('parseAmount 1,234.56', f.parseAmount('1,234.56') === 1234.56);
  check('parseAmount 12,5', f.parseAmount('12,5') === 12.5);
  check('parseAmount 1.500', f.parseAmount('1.500') === 1500);
  check('parseAmount 12.5', f.parseAmount('12.5') === 12.5);
  check('parseAmount junk', f.parseAmount('abc') === null);
  check('parseCsvDate dd.mm.yyyy', f.parseCsvDate('05.03.2026') === '2026-03-05');
  check('parseCsvDate iso', f.parseCsvDate('2026-03-05') === '2026-03-05');
  check('parseCsvDate invalid', f.parseCsvDate('31.02.2026') === null);
  check('weekly occurrence', f.occurrenceOnOrAfter('weekly', 1, '2026-10-26') === '2026-10-26'); // Mon
  check('monthly clamp 31 -> Feb 28', f.occurrenceOnOrAfter('monthly', 31, '2026-02-01') === '2026-02-28');
  check('monthly rolls to next month', f.occurrenceOnOrAfter('monthly', 5, '2026-10-06') === '2026-11-05');

  const app = (await import('../src/index')).default;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };

  // categories seeded
  let r = await call('GET', '/api/finance/categories');
  const cats: any[] = r.json.categories;
  check('categories seeded (9+4+2)', r.status === 200 && cats.length === 15, cats.length);
  const gida = cats.find((c) => c.name === 'Gıda');
  const ulasim = cats.find((c) => c.name === 'Ulaşım');
  const maas = cats.find((c) => c.name === 'Maaş' && c.kind === 'gelir');
  const sysGider = cats.find((c) => c.system && c.kind === 'gider');
  r = await call('GET', '/api/finance/categories');
  check('seed idempotent', r.json.categories.length === 15);
  r = await call('POST', '/api/finance/categories', { name: 'GIDA', kind: 'gider' });
  check('duplicate category 409', r.status === 409, r.json);
  r = await call('DELETE', `/api/finance/categories/${sysGider.id}`);
  check('system category delete 409', r.status === 409);

  // accounts
  r = await call('POST', '/api/finance/accounts', { name: '', type: 'banka' });
  check('empty account name 400', r.status === 400 && typeof r.json.error === 'string');
  r = await call('POST', '/api/finance/accounts', { name: 'X', type: 'banka', currency: 'GBP' });
  check('bad currency 400', r.status === 400);
  r = await call('POST', '/api/finance/accounts', { name: 'Ziraat', type: 'banka', currency: 'TRY', openingBalance: 1000 });
  const bank = r.json;
  check('create bank 201 balance=1000', r.status === 201 && bank.balance === 1000, r.json);
  r = await call('POST', '/api/finance/accounts', { name: 'Broker', type: 'trade', currency: 'USD', openingBalance: 0 });
  const trade = r.json;
  r = await call('POST', '/api/finance/accounts', { name: 'Euro', type: 'nakit', currency: 'EUR', openingBalance: 100 });
  const eur = r.json;

  // transactions validation
  const tx = (b: any) => call('POST', '/api/finance/transactions', b);
  r = await tx({ accountId: bank.id, date: '2026-10-05', amount: 0, kind: 'gider' });
  check('amount 0 -> 400', r.status === 400);
  r = await tx({ accountId: bank.id, date: '2026-10-05', amount: -5, kind: 'gider' });
  check('negative amount -> 400', r.status === 400);
  r = await tx({ accountId: bank.id, date: '2026-02-30', amount: 5, kind: 'gider' });
  check('invalid date -> 400', r.status === 400);
  r = await tx({ accountId: bank.id, date: '2026-10-05', amount: 5, kind: 'gider', categoryId: maas.id });
  check('wrong-kind category -> 400', r.status === 400);
  r = await tx({ accountId: 'nope', date: '2026-10-05', amount: 5, kind: 'gider' });
  check('unknown account -> 400', r.status === 400);

  r = await tx({ accountId: bank.id, date: '2026-10-02', amount: 5000, kind: 'gelir', categoryId: maas.id, payee: 'Burs' });
  check('income 201', r.status === 201);
  r = await tx({ accountId: bank.id, date: '2026-10-03', amount: 250.555, kind: 'gider', categoryId: gida.id, payee: 'Market' });
  const g1 = r.json;
  check('amount rounded 2dp', g1.amount === 250.56 || g1.amount === 250.55, g1.amount);
  r = await tx({ accountId: bank.id, date: '2026-10-10', amount: 100, kind: 'gider', categoryId: ulasim.id });
  const u1 = r.json;
  r = await tx({ accountId: eur.id, date: '2026-10-11', amount: 10, kind: 'gider', categoryId: gida.id });
  check('eur expense ok', r.status === 201);

  r = await call('GET', '/api/finance/accounts');
  const accs: any[] = r.json.accounts;
  const bankBal = accs.find((a) => a.id === bank.id).balance;
  check('bank balance = 1000+5000-250.56-100', Math.abs(bankBal - (1000 + 5000 - g1.amount - 100)) < 0.001, bankBal);
  check('eur balance 90', accs.find((a) => a.id === eur.id).balance === 90);

  // transfer pair
  r = await tx({ accountId: bank.id, transferAccountId: trade.id, date: '2026-10-12', amount: 1000, kind: 'transfer' });
  check('cross-currency transfer without rate -> 400', r.status === 400, r.json);
  r = await tx({ accountId: bank.id, transferAccountId: trade.id, date: '2026-10-12', amount: 1000, kind: 'transfer', toAmount: 25 });
  check('transfer with toAmount 201', r.status === 201 && r.json.toAmount === 25 && r.json.direction === 'out', r.json);
  const tr = r.json;
  r = await call('GET', '/api/finance/accounts');
  check('bank decreased by 1000', Math.abs(r.json.accounts.find((a: any) => a.id === bank.id).balance - (bankBal - 1000)) < 0.001);
  check('trade increased by 25', r.json.accounts.find((a: any) => a.id === trade.id).balance === 25);
  r = await call('GET', '/api/finance/transactions?month=2026-10');
  check('list hides transfer "in" rows', r.json.transactions.filter((t: any) => t.kind === 'transfer').length === 1, r.json.total);
  r = await call('GET', `/api/finance/transactions?accountId=${trade.id}`);
  check('account filter shows its transfer in row', r.json.transactions.length === 1 && r.json.transactions[0].direction === 'in');
  r = await call('PATCH', `/api/finance/transactions/${tr.id}`, { amount: 500, toAmount: 12.5 });
  check('patch transfer updates both sides', r.status === 200);
  r = await call('GET', '/api/finance/accounts');
  check('trade = 12.5 after patch', r.json.accounts.find((a: any) => a.id === trade.id).balance === 12.5, r.json.accounts);
  r = await call('DELETE', `/api/finance/transactions/${tr.id}`);
  check('delete transfer 200', r.status === 200 && r.json.deleted.kind === 'transfer');
  r = await call('GET', '/api/finance/accounts');
  check('trade back to 0, bank restored', r.json.accounts.find((a: any) => a.id === trade.id).balance === 0
    && Math.abs(r.json.accounts.find((a: any) => a.id === bank.id).balance - bankBal) < 0.001);
  r = await tx({ accountId: bank.id, transferAccountId: bank.id, date: '2026-10-12', amount: 5, kind: 'transfer' });
  check('same-account transfer -> 400', r.status === 400);

  // search
  r = await call('GET', '/api/finance/transactions?q=market');
  check('search by payee', r.json.total === 1);
  r = await call('GET', `/api/finance/transactions?categoryId=${gida.id}&month=2026-10`);
  check('category filter', r.json.total === 2, r.json.total);

  // rates + summary
  r = await call('GET', '/api/finance/summary?month=2026-10&today=2026-10-26');
  check('summary flags missing rates', r.json.missingRates.includes('EUR'), r.json.missingRates);
  r = await call('PUT', '/api/finance/rates', { rates: { USD: 40, EUR: 45 } });
  check('rates set', r.status === 200 && r.json.rates.find((x: any) => x.currency === 'EUR').toTry === 45);
  r = await call('PUT', '/api/finance/rates', { rates: { USD: -1 } });
  check('bad rate 400', r.status === 400);
  r = await call('GET', '/api/finance/summary?month=2026-10&today=2026-10-26');
  const s = r.json;
  const expExpense = g1.amount + 100 + 10 * 45;
  check('summary income 5000', s.income === 5000, s.income);
  check('summary expense', Math.abs(s.expense - expExpense) < 0.01, s.expense);
  check('summary net', Math.abs(s.net - (5000 - expExpense)) < 0.01);
  check('savings rate', Math.abs(s.savingsRate - Math.round(((5000 - expExpense) / 5000) * 1000) / 10) < 0.01, s.savingsRate);
  check('byCategory Gıda includes EUR conversion', Math.abs(s.byCategory.find((c: any) => c.name === 'Gıda').amount - (g1.amount + 450)) < 0.01, s.byCategory);
  check('byDay has 3 expense days', s.byDay.length === 4, s.byDay);
  check('last6Months 6 entries ending 2026-10', s.last6Months.length === 6 && s.last6Months[5].month === '2026-10' && s.last6Months[0].month === '2026-05');
  const expectedTotal = (1000 + 5000 - g1.amount - 100) + 0 * 40 + 90 * 45;
  check('accountsTotalTRY', Math.abs(s.accountsTotalTRY - expectedTotal) < 0.01, [s.accountsTotalTRY, expectedTotal]);

  // trade deposit via system category excluded from summary
  r = await tx({ accountId: trade.id, date: '2026-10-13', amount: 100, kind: 'gelir', categoryId: cats.find((c) => c.system && c.kind === 'gelir').id });
  check('trade deposit (system cat) 201', r.status === 201);
  r = await call('GET', '/api/finance/summary?month=2026-10&today=2026-10-26');
  check('system category excluded from income', r.json.income === 5000, r.json.income);

  // budgets
  r = await call('PUT', '/api/finance/budgets', { month: '2026-10', categoryId: gida.id, limit: 700 });
  check('budget set', r.status === 200 && r.json.length === 1);
  const b = r.json[0];
  check('budget spent = gıda (TRY)', Math.abs(b.spent - (g1.amount + 450)) < 0.01 && Math.abs(b.remaining - (700 - b.spent)) < 0.01, b);
  r = await call('PUT', '/api/finance/budgets', { month: '2026-10', categoryId: gida.id, limit: 800 });
  check('budget upsert (still 1)', r.json.length === 1 && r.json[0].limit === 800);
  r = await call('PUT', '/api/finance/budgets', { month: '2026-10', categoryId: maas.id, limit: 5 });
  check('budget on income category -> 400', r.status === 400);
  r = await call('POST', '/api/finance/budgets/copy', { to: '2026-11' });
  check('budget copy prev month', r.json.copied === 1 && r.json.budgets[0].spent === 0, r.json);
  r = await call('POST', '/api/finance/budgets/copy', { to: '2026-11' });
  check('budget copy idempotent', r.json.copied === 0);
  r = await call('GET', '/api/finance/budgets?month=2026-11');
  check('GET budgets array', Array.isArray(r.json) && r.json[0].categoryId === gida.id);
  r = await call('GET', '/api/finance/budgets?month=bad');
  check('bad month 400', r.status === 400);

  // recurring
  r = await call('POST', '/api/finance/recurring', { name: 'Netflix', kind: 'gider', amount: 200, accountId: bank.id, categoryId: cats.find((c) => c.name === 'Abonelik').id, every: 'monthly', day: 5, startDate: '2026-08-01' });
  check('recurring create next_date 2026-08-05', r.status === 201 && r.json.nextDate === '2026-08-05', r.json);
  const rec = r.json;
  r = await call('GET', '/api/finance/summary?month=2026-10&today=2026-10-26');
  check('summary materialized 3 (Aug, Sep, Oct)', r.json.materialized === 3, r.json.materialized);
  r = await call('GET', '/api/finance/summary?month=2026-10&today=2026-10-26');
  check('materialize idempotent', r.json.materialized === 0);
  r = await call('POST', '/api/finance/recurring/run?today=2026-10-26');
  check('run endpoint creates 0', r.json.created === 0);
  r = await call('GET', '/api/finance/recurring');
  check('next_date advanced to 2026-11-05', r.json.recurring[0].nextDate === '2026-11-05', r.json.recurring);
  r = await call('GET', '/api/finance/transactions?q=netflix');
  check('3 netflix txs', r.json.total === 3, r.json.total);
  r = await call('PATCH', `/api/finance/recurring/${rec.id}`, { active: false });
  check('pause recurring', r.json.active === false);
  r = await call('GET', '/api/finance/summary?month=2026-12&today=2026-12-26');
  check('paused recurring not materialized', r.json.materialized === 0);
  r = await call('DELETE', `/api/finance/recurring/${rec.id}`);
  check('delete recurring', r.status === 200);

  // CSV import (Turkish)
  const csv = [
    'Tarih;Tutar;Açıklama;Kategori',
    '01.09.2026;-1.234,56;"Migros, market";Gıda',
    '02.09.2026;15.000,00;Maaş yatan;Maaş',
    '2026-09-03;-45,5;Otobüs;Yeni Kategori',
    '03.09.2026;-45,5;Otobüs;Yeni Kategori',
    'bozuk;12;x;',
    '04.09.2026;abc;x;',
  ].join('\r\n');
  r = await call('POST', '/api/finance/import', { csv, accountId: bank.id, dryRun: true });
  check('dry run counts but writes nothing', r.json.imported === 3 && r.json.duplicates === 1 && r.json.errors.length === 2, r.json);
  r = await call('GET', '/api/finance/transactions?month=2026-09&q=Migros');
  check('dry run wrote nothing', r.json.total === 0);
  r = await call('POST', '/api/finance/import', { csv, accountId: bank.id });
  check('import: 3 imported, 1 dup (in-file), 2 errors, 1 new cat', r.json.imported === 3 && r.json.duplicates === 1 && r.json.errors.length === 2 && r.json.createdCategories === 1, r.json);
  r = await call('POST', '/api/finance/import', { csv, accountId: bank.id });
  check('re-import dedupes everything', r.json.imported === 0 && r.json.duplicates === 4, r.json);
  r = await call('GET', '/api/finance/transactions?month=2026-09&q=Migros');
  check('Turkish amount parsed 1234.56 gider', r.json.total === 1 && r.json.transactions[0].amount === 1234.56 && r.json.transactions[0].kind === 'gider', r.json);
  r = await call('GET', '/api/finance/transactions?month=2026-09&q=Maaş');
  check('positive -> gelir w/ category', r.json.transactions[0].kind === 'gelir' && r.json.transactions[0].amount === 15000 && r.json.transactions[0].categoryName === 'Maaş', r.json);
  r = await call('POST', '/api/finance/import', { csv: 'Foo;Bar\n1;2', accountId: bank.id });
  check('missing columns -> 400', r.status === 400);
  const enCsv = 'Date,Amount,Description\n2026-09-10,"1,200.50",Rent\n2026-09-11,-20.25,Coffee';
  r = await call('POST', '/api/finance/import', { csv: enCsv, accountId: bank.id });
  check('English CSV (comma, 1,200.50)', r.json.imported === 2, r.json);

  // export round trip
  r = await call('GET', '/api/finance/export?month=2026-09');
  check('export csv', r.status === 200 && r.text.includes('Tarih;Tutar') && r.text.includes('-1234,56'), r.text.slice(0, 200));
  const exported = r.text;
  const acc2 = (await call('POST', '/api/finance/accounts', { name: 'Yedek', type: 'nakit' })).json;
  r = await call('POST', '/api/finance/import', { csv: exported, accountId: acc2.id });
  check('export re-imports cleanly', r.json.imported >= 5 && r.json.errors.length === 0, r.json);

  // delete account
  r = await call('DELETE', `/api/finance/accounts/${bank.id}`);
  check('delete account with txs -> 409', r.status === 409);
  r = await call('DELETE', `/api/finance/accounts/${acc2.id}?force=1`);
  check('force delete ok', r.status === 200);
  r = await call('PATCH', `/api/finance/accounts/${eur.id}`, { currency: 'USD' });
  check('currency change with txs -> 409', r.status === 409);
  r = await call('DELETE', `/api/finance/categories/${gida.id}`);
  check('used category archived, not deleted', r.json.archived === true && r.json.deleted === false);
  r = await call('PATCH', '/api/finance/transactions/nope', { note: 'x' });
  check('missing tx 404', r.status === 404);
  r = await call('POST', '/api/finance/transactions', '{bad');
  check('bad json 400', r.status === 400);

  console.log(failures ? `\n${failures} FAILED` : '\nALL OK');
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* db may still be open on Windows */ }
    process.exit(failures ? 1 : 0);
  });
