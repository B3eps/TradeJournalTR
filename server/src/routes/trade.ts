import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import * as tradesDb from '../db/trades';
import * as brokerDb from '../db/broker-connections';
import { requiresLogin } from '../middleware/auth';
import { getDb } from '../db/connection';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const trade = new Hono<HonoEnv>();

const finiteNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : NaN;
};

/** Parses an optional numeric field (commission, swap). Empty → null. */
const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const n = finiteNumber(value);
  return Number.isFinite(n) ? n : null;
};

const isPresent = (value: unknown) =>
  value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');

function validateTradeInput(body: any): { error: string } | { error: null; value: any } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'İşlem bilgileri geçersiz.' };
  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  const enterDate = typeof body.enterTime === 'string' ? new Date(body.enterTime) : new Date(NaN);
  const exitDate = typeof body.exitTime === 'string' ? new Date(body.exitTime) : new Date(NaN);
  const quantity = finiteNumber(body.quantity);
  const hasPL = isPresent(body.manualPL);
  const hasEnterPrice = isPresent(body.enterPrice);
  const hasExitPrice = isPresent(body.exitPrice);
  const isManualPLOnlySentinel = hasEnterPrice && hasExitPrice && hasPL && finiteNumber(body.enterPrice) === 0 && finiteNumber(body.exitPrice) === 0;
  const hasPrices = hasEnterPrice && hasExitPrice && !isManualPLOnlySentinel;
  if (!ticker || ticker.length > 40 || typeof body.enterTime !== 'string' || !body.enterTime.trim() ||
      typeof body.exitTime !== 'string' || !body.exitTime.trim() || !Number.isFinite(enterDate.getTime()) || !Number.isFinite(exitDate.getTime())) {
    return { error: 'Sembol ve geçerli giriş/çıkış zamanları zorunludur.' };
  }
  if (exitDate < enterDate) return { error: 'Çıkış zamanı giriş zamanından önce olamaz.' };
  if (!Number.isFinite(quantity) || quantity === 0) return { error: 'Miktar sıfırdan farklı ve sayısal olmalıdır.' };
  if (hasEnterPrice !== hasExitPrice) return { error: 'Giriş ve çıkış fiyatlarını birlikte girin.' };
  if (!hasPrices && !hasPL) return { error: 'Giriş/çıkış fiyatı veya manuel K/Z girilmelidir.' };
  const enterPrice = hasPrices ? finiteNumber(body.enterPrice) : 0;
  const exitPrice = hasPrices ? finiteNumber(body.exitPrice) : 0;
  if (hasPrices && (!Number.isFinite(enterPrice) || enterPrice <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0)) {
    return { error: 'Giriş ve çıkış fiyatları pozitif sayısal değerler olmalıdır.' };
  }
  const manualPL = hasPL ? optionalNumber(body.manualPL) : null;
  if (hasPL && manualPL === null) return { error: 'Manuel K/Z sayısal olmalıdır.' };
  const commission = optionalNumber(body.commission);
  const swap = optionalNumber(body.swap);
  if ((isPresent(body.commission) && commission === null) || (isPresent(body.swap) && swap === null)) {
    return { error: 'Komisyon ve swap sayısal olmalıdır.' };
  }
  return {
    error: null,
    value: {
      ticker, enterTime: enterDate.toISOString(), exitTime: exitDate.toISOString(), enterPrice, exitPrice,
      quantity, manualPL, commission, swap,
    },
  };
}

// GET /api/getTrades
trade.get('/api/getTrades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  try {
    const trades = await tradesDb.getTrades(db, user.id);

    // Build account → broker mapping from broker_connections
    const accountBrokers: Record<string, string> = {};
    try {
      const serviceClient = getDb();
      const conns = await brokerDb.findByOwner(serviceClient, user.id);

      // Step 1: Direct match — parse account name from each connection's label
      // Label format: "Alpha Futures Demo — AFZEROQA202602139428"
      const labelMatches: Array<{ name: string; broker: string }> = [];
      for (const conn of conns) {
        if (conn.label) {
          const dashIdx = conn.label.indexOf('—');
          if (dashIdx !== -1) {
            const acctName = conn.label.substring(dashIdx + 1).trim();
            if (acctName) {
              accountBrokers[acctName] = conn.broker;
              labelMatches.push({ name: acctName, broker: conn.broker });
            }
          }
        }
      }

      // Step 2: For unmatched trade accounts, match by shared prefix with
      // a label-matched account (e.g. AFZEROEV... shares prefix with AFZEROQA...)
      const allAccounts = [...new Set(trades.map((t: any) => t.account).filter(Boolean))];
      const unmatched = allAccounts.filter((a: string) => !accountBrokers[a]);
      if (unmatched.length > 0 && labelMatches.length > 0) {
        for (const acct of unmatched) {
          let bestMatch = '';
          let bestBroker = '';
          for (const lm of labelMatches) {
            // Find longest common prefix
            let i = 0;
            while (i < acct.length && i < lm.name.length && acct[i] === lm.name[i]) i++;
            if (i >= 4 && i > bestMatch.length) {
              bestMatch = acct.substring(0, i);
              bestBroker = lm.broker;
            }
          }
          if (bestBroker) accountBrokers[acct] = bestBroker;
        }
      }
    } catch {
      // non-fatal — account icons are best-effort
    }

    return c.json({ trades, accountBrokers });
  } catch (err) {
    console.error('getTrades error:', err);
    return c.json({ error: 'İşlemler alınırken hata oluştu!' }, 500);
  }
});

// POST /makeTrade and POST /trades
const makeTradeHandler = async (c: any) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const validation = validateTradeInput(body);
  if (validation.error) return c.json({ error: validation.error }, 400);
  const input = validation.value;

  try {
    const newTrade = await tradesDb.createTrade(db, user.id, {
      ...input,
      imageAttachments: Array.isArray(body.imageAttachments) ? body.imageAttachments.filter((item: unknown): item is string => typeof item === 'string') : [],
      screenshot: typeof body.screenshot === 'string' ? body.screenshot : null,
      comments: typeof body.comments === 'string' ? body.comments : '',
      isEval: body.isEval || false,
      account: typeof body.account === 'string' && body.account.trim() ? body.account.trim() : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
    });

    return c.json(newTrade, 201);
  } catch (err: any) {
    console.error('makeTrade error:', err);
    return c.json({ error: err.message || 'Bir hata oluştu' }, 500);
  }
};
trade.post('/api/makeTrade', requiresLogin, makeTradeHandler);
trade.post('/api/trades', requiresLogin, makeTradeHandler);

// POST /api/removeTrade
trade.post('/api/removeTrade', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();

  if (!body._id) {
    return c.json({ error: 'Silmek için işlem kimliği gereklidir!' }, 400);
  }

  try {
    await tradesDb.deleteTrade(db, user.id, body._id);
    return c.json({ message: 'İşlem başarıyla silindi!' });
  } catch (err) {
    console.error('removeTrade error:', err);
    return c.json({ error: 'İşlem silinirken bir hata oluştu!' }, 500);
  }
});

// POST /api/updateTrade
trade.post('/api/updateTrade', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();

  if (!body._id) {
    return c.json({ error: 'Güncellemek için işlem kimliği gereklidir!' }, 400);
  }

  const validation = validateTradeInput(body);
  if (validation.error) return c.json({ error: validation.error }, 400);
  const input = validation.value;

  try {
    const updated = await tradesDb.updateTrade(db, user.id, {
      _id: body._id,
      ...input,
      screenshot: typeof body.screenshot === 'string' ? body.screenshot : null,
      comments: typeof body.comments === 'string' ? body.comments : '',
      isEval: body.isEval || false,
      account: typeof body.account === 'string' && body.account.trim() ? body.account.trim() : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
    });

    return c.json(updated);
  } catch (err) {
    console.error('updateTrade error:', err);
    return c.json({ error: 'İşlem güncellenirken bir hata oluştu!' }, 500);
  }
});

// POST /api/importTrades
trade.post('/api/importTrades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();

  if (!body || typeof body !== 'object' || !Array.isArray(body.trades)) {
    return c.json({ error: 'İşlem listesi (dizi) gereklidir!' }, 400);
  }

  if (body.trades.length > 500) {
    return c.json({ error: 'Tek seferde en fazla 500 işlem içe aktarılabilir!' }, 400);
  }

  if (body.trades.length === 0) return c.json({ error: 'İçe aktarılacak işlem bulunamadı.' }, 400);

  const tradeDocs: Parameters<typeof tradesDb.bulkInsertTrades>[2] = [];
  for (let i = 0; i < body.trades.length; i++) {
    const t = body.trades[i];
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      return c.json({ error: `${i + 1}. işlem geçerli bir nesne değil.` }, 400);
    }
    const required = ['ticker', 'enterTime', 'exitTime', 'enterPrice', 'exitPrice', 'quantity'];
    const missingField = required.find((field) => t[field] === null || t[field] === undefined || t[field] === '');
    if (missingField) {
      return c.json({ error: `${i + 1}. işlemde zorunlu alan eksik: ${missingField}` }, 400);
    }

    const ticker = typeof t.ticker === 'string' ? t.ticker.trim().toUpperCase() : '';
    const enterDate = typeof t.enterTime === 'string' ? new Date(t.enterTime) : new Date(NaN);
    const exitDate = typeof t.exitTime === 'string' ? new Date(t.exitTime) : new Date(NaN);
    const enterPrice = finiteNumber(t.enterPrice);
    const exitPrice = finiteNumber(t.exitPrice);
    const quantity = finiteNumber(t.quantity);
    if (!ticker || ticker.length > 40) {
      return c.json({ error: `${i + 1}. işlemde sembol boş veya çok uzun.` }, 400);
    }
    if (!Number.isFinite(enterDate.getTime()) || !Number.isFinite(exitDate.getTime())) {
      return c.json({ error: `${i + 1}. işlemin giriş veya çıkış zamanı geçersiz.` }, 400);
    }
    if (exitDate < enterDate) {
      return c.json({ error: `${i + 1}. işlemde çıkış zamanı girişten önce olamaz.` }, 400);
    }
    if (!Number.isFinite(enterPrice) || enterPrice <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) {
      return c.json({ error: `${i + 1}. işlemde fiyatlar pozitif ve sayısal olmalıdır.` }, 400);
    }
    if (!Number.isFinite(quantity) || quantity === 0) {
      return c.json({ error: `${i + 1}. işlemde miktar sıfırdan farklı ve sayısal olmalıdır.` }, 400);
    }

    const optionalFields = ['manualPL', 'commission', 'swap'];
    const optionalValues: Record<string, number | null> = {};
    for (const field of optionalFields) {
      const value = t[field];
      if (value === null || value === undefined || value === '') optionalValues[field] = null;
      else {
        const number = finiteNumber(value);
        if (!Number.isFinite(number)) {
          return c.json({ error: `${i + 1}. işlemde ${field} sayısal olmalıdır.` }, 400);
        }
        optionalValues[field] = number;
      }
    }

    tradeDocs.push({
      ticker,
      enterTime: enterDate.toISOString(),
      exitTime: exitDate.toISOString(),
      enterPrice,
      exitPrice,
      quantity,
      manualPL: optionalValues.manualPL,
      commission: optionalValues.commission,
      swap: optionalValues.swap,
      comments: typeof t.comments === 'string' ? t.comments : '',
      tags: Array.isArray(t.tags) ? t.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
      account: typeof t.account === 'string' && t.account.trim() ? t.account.trim() : null,
    });
  }

  try {
    const result = await tradesDb.bulkInsertTrades(db, user.id, tradeDocs);
    return c.json(result, 201);
  } catch (err) {
    console.error('importTrades error:', err);
    return c.json({ error: 'İçe aktarma sırasında bir hata oluştu' }, 500);
  }
});

// POST /api/bulkUpdateTrades
trade.post('/api/bulkUpdateTrades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();

  if (!body.tradeIds || !Array.isArray(body.tradeIds) || body.tradeIds.length === 0) {
    return c.json({ error: 'İşlem kimliklerinin listesi zorunludur.' }, 400);
  }
  if (!body.action) {
    return c.json({ error: 'Toplu işlem türü zorunludur.' }, 400);
  }

  try {
    if (body.action === 'markEval') {
      const count = await tradesDb.bulkUpdateEval(db, user.id, body.tradeIds, true);
      return c.json({ message: `${count} işlem değerlendirme (eval) olarak işaretlendi.` });
    }
    if (body.action === 'unmarkEval') {
      const count = await tradesDb.bulkUpdateEval(db, user.id, body.tradeIds, false);
      return c.json({ message: `${count} işlemin değerlendirme (eval) işareti kaldırıldı.` });
    }
    if (body.action === 'addTags') {
      if (!body.tags || !Array.isArray(body.tags) || body.tags.length === 0) {
        return c.json({ error: 'addTags işlemi için etiket listesi gereklidir!' }, 400);
      }
      const count = await tradesDb.bulkAddTags(db, user.id, body.tradeIds, body.tags);
      return c.json({ message: `${count} etiket ataması eklendi.` });
    }
    return c.json({ error: 'Geçersiz işlem. markEval, unmarkEval veya addTags kullanın.' }, 400);
  } catch (err: any) {
    console.error('bulkUpdateTrades error:', err);
    return c.json({ error: err.message || 'Toplu güncelleme sırasında bir hata oluştu.' }, 500);
  }
});

// POST /api/bulkDeleteTrades
trade.post('/api/bulkDeleteTrades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();

  if (!body.tradeIds || !Array.isArray(body.tradeIds) || body.tradeIds.length === 0) {
    return c.json({ error: 'İşlem kimliklerinin listesi zorunludur.' }, 400);
  }

  try {
    const count = await tradesDb.bulkDeleteTrades(db, user.id, body.tradeIds);
    return c.json({ message: `${count} işlem silindi.` });
  } catch (err: any) {
    console.error('bulkDeleteTrades error:', err);
    return c.json({ error: err.message || 'Toplu silme sırasında bir hata oluştu.' }, 500);
  }
});

export default trade;
