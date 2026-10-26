import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import * as fin from '../db/finance';
import { ApiError, readJson, sendError, localDate } from '../db/tasks';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const finance = new Hono<HonoEnv>();

const nf = (what: string) => new ApiError(404, `${what} bulunamadı.`);

// ── Accounts ──
finance.get('/api/finance/accounts', requiresLogin, (c) => {
  try {
    const all = c.req.query('archived') === '1';
    return c.json({ accounts: fin.listAccounts(c.get('db'), c.get('user').id, all) });
  } catch (err) { return sendError(c, err, 'Finance accounts'); }
});
finance.post('/api/finance/accounts', requiresLogin, async (c) => {
  try {
    return c.json(fin.createAccount(c.get('db'), c.get('user').id, await readJson(c)), 201);
  } catch (err) { return sendError(c, err, 'Finance account create'); }
});
finance.patch('/api/finance/accounts/:id', requiresLogin, async (c) => {
  try {
    const a = fin.updateAccount(c.get('db'), c.get('user').id, c.req.param('id'), await readJson(c));
    if (!a) throw nf('Hesap');
    return c.json(a);
  } catch (err) { return sendError(c, err, 'Finance account update'); }
});
finance.delete('/api/finance/accounts/:id', requiresLogin, (c) => {
  try {
    if (!fin.deleteAccount(c.get('db'), c.get('user').id, c.req.param('id'), c.req.query('force') === '1')) throw nf('Hesap');
    return c.json({ ok: true });
  } catch (err) { return sendError(c, err, 'Finance account delete'); }
});

// ── Categories ──
finance.get('/api/finance/categories', requiresLogin, (c) => {
  try {
    return c.json({ categories: fin.listCategories(c.get('db'), c.get('user').id, c.req.query('archived') === '1') });
  } catch (err) { return sendError(c, err, 'Finance categories'); }
});
finance.post('/api/finance/categories', requiresLogin, async (c) => {
  try {
    return c.json(fin.createCategory(c.get('db'), c.get('user').id, await readJson(c)), 201);
  } catch (err) { return sendError(c, err, 'Finance category create'); }
});
finance.patch('/api/finance/categories/:id', requiresLogin, async (c) => {
  try {
    const cat = fin.updateCategory(c.get('db'), c.get('user').id, c.req.param('id'), await readJson(c));
    if (!cat) throw nf('Kategori');
    return c.json(cat);
  } catch (err) { return sendError(c, err, 'Finance category update'); }
});
finance.delete('/api/finance/categories/:id', requiresLogin, (c) => {
  try {
    const res = fin.deleteCategory(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!res) throw nf('Kategori');
    return c.json({ ok: true, ...res });
  } catch (err) { return sendError(c, err, 'Finance category delete'); }
});

// ── Transactions ──
// GET ?month=YYYY-MM&accountId=&categoryId=&kind=&q=&limit=&offset=
finance.get('/api/finance/transactions', requiresLogin, (c) => {
  try {
    const q = (k: string) => c.req.query(k);
    return c.json(fin.listTransactions(c.get('db'), c.get('user').id, {
      month: q('month'), accountId: q('accountId'), categoryId: q('categoryId'), kind: q('kind'), q: q('q'), limit: q('limit'), offset: q('offset'),
    }));
  } catch (err) { return sendError(c, err, 'Finance transactions'); }
});
finance.post('/api/finance/transactions', requiresLogin, async (c) => {
  try {
    return c.json(fin.createTransaction(c.get('db'), c.get('user').id, await readJson(c)), 201);
  } catch (err) { return sendError(c, err, 'Finance transaction create'); }
});
finance.patch('/api/finance/transactions/:id', requiresLogin, async (c) => {
  try {
    const t = fin.updateTransaction(c.get('db'), c.get('user').id, c.req.param('id'), await readJson(c));
    if (!t) throw nf('İşlem');
    return c.json(t);
  } catch (err) { return sendError(c, err, 'Finance transaction update'); }
});
finance.delete('/api/finance/transactions/:id', requiresLogin, (c) => {
  try {
    const t = fin.deleteTransaction(c.get('db'), c.get('user').id, c.req.param('id'));
    if (!t) throw nf('İşlem');
    return c.json({ ok: true, deleted: t });
  } catch (err) { return sendError(c, err, 'Finance transaction delete'); }
});

// ── Budgets ──
finance.get('/api/finance/budgets', requiresLogin, (c) => {
  try {
    return c.json(fin.listBudgets(c.get('db'), c.get('user').id, c.req.query('month')));
  } catch (err) { return sendError(c, err, 'Finance budgets'); }
});
finance.put('/api/finance/budgets', requiresLogin, async (c) => {
  try {
    return c.json(fin.setBudget(c.get('db'), c.get('user').id, await readJson(c)));
  } catch (err) { return sendError(c, err, 'Finance budget set'); }
});
finance.post('/api/finance/budgets/copy', requiresLogin, async (c) => {
  try {
    return c.json(fin.copyBudgets(c.get('db'), c.get('user').id, await readJson(c)));
  } catch (err) { return sendError(c, err, 'Finance budget copy'); }
});

// ── Recurring ──
finance.get('/api/finance/recurring', requiresLogin, (c) => {
  try {
    return c.json({ recurring: fin.listRecurring(c.get('db'), c.get('user').id) });
  } catch (err) { return sendError(c, err, 'Finance recurring'); }
});
finance.post('/api/finance/recurring/run', requiresLogin, (c) => {
  try {
    const created = fin.materializeRecurring(c.get('db'), c.get('user').id, c.req.query('today') || localDate(new Date()));
    return c.json({ ok: true, created });
  } catch (err) { return sendError(c, err, 'Finance recurring run'); }
});
finance.post('/api/finance/recurring', requiresLogin, async (c) => {
  try {
    return c.json(fin.createRecurring(c.get('db'), c.get('user').id, await readJson(c)), 201);
  } catch (err) { return sendError(c, err, 'Finance recurring create'); }
});
finance.patch('/api/finance/recurring/:id', requiresLogin, async (c) => {
  try {
    const r = fin.updateRecurring(c.get('db'), c.get('user').id, c.req.param('id'), await readJson(c));
    if (!r) throw nf('Tekrarlayan işlem');
    return c.json(r);
  } catch (err) { return sendError(c, err, 'Finance recurring update'); }
});
finance.delete('/api/finance/recurring/:id', requiresLogin, (c) => {
  try {
    if (!fin.deleteRecurring(c.get('db'), c.get('user').id, c.req.param('id'))) throw nf('Tekrarlayan işlem');
    return c.json({ ok: true });
  } catch (err) { return sendError(c, err, 'Finance recurring delete'); }
});

// ── Summary (also materializes due recurring items; `today` = client's local date) ──
finance.get('/api/finance/summary', requiresLogin, (c) => {
  try {
    return c.json(fin.getSummary(c.get('db'), c.get('user').id, c.req.query('month'), c.req.query('today')));
  } catch (err) { return sendError(c, err, 'Finance summary'); }
});

// ── Import / export ──
finance.post('/api/finance/import', requiresLogin, async (c) => {
  try {
    return c.json(fin.importCsv(c.get('db'), c.get('user').id, await readJson(c)));
  } catch (err) { return sendError(c, err, 'Finance import'); }
});
finance.get('/api/finance/export', requiresLogin, (c) => {
  try {
    const csv = fin.exportCsv(c.get('db'), c.get('user').id, c.req.query('month') || undefined);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="finans.csv"',
      },
    });
  } catch (err) { return sendError(c, err, 'Finance export'); }
});

// ── Rates ──
finance.get('/api/finance/rates', requiresLogin, (c) => {
  try {
    return c.json({ rates: fin.getRates(c.get('db'), c.get('user').id) });
  } catch (err) { return sendError(c, err, 'Finance rates'); }
});
finance.put('/api/finance/rates', requiresLogin, async (c) => {
  try {
    return c.json({ rates: fin.setRates(c.get('db'), c.get('user').id, await readJson(c)) });
  } catch (err) { return sendError(c, err, 'Finance rates set'); }
});

export default finance;
