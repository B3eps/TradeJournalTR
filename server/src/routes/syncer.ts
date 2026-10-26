import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import { getDb } from '../db/connection';
import { ensureFreshToken } from '../utils/tradovate-token';
import * as syncerDb from '../db/syncer';
import * as brokerDb from '../db/broker-connections';
import * as tvConnDb from '../db/tradovate-connections';
import { decrypt } from '../utils/crypto';
import { TradovateAPI } from '../services/TradovateAPI';
import { mirroredQuantity, positiveId, validLimitPrice } from '../services/syncer/safety';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const syncer = new Hono<HonoEnv>();

// All syncer routes require login
syncer.use('/api/syncer/*', requiresLogin);

// ─── GET /api/syncer/config ──────────────────────────────────────────────────

syncer.get('/api/syncer/config', async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const config = await syncerDb.getConfig(db, user.id);
    return c.json({ config });
  } catch (err: any) {
    console.error('syncer config get error:', err);
    return c.json({ error: 'Eşitleyici ayarları alınamadı.' }, 500);
  }
});

// ─── PUT /api/syncer/config ──────────────────────────────────────────────────

syncer.put('/api/syncer/config', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();

  const {
    leaderConnectionId = null,
    leaderAccountId = null,
    followerAccounts = [],
  } = body as {
    leaderConnectionId?: string | null;
    leaderAccountId?: number | null;
    followerAccounts?: Array<{ connectionId: string; accountId: number; multiplier: number }>;
  };

  try {
    const config = await syncerDb.upsertConfig(
      db,
      user.id,
      leaderConnectionId,
      leaderAccountId,
      followerAccounts,
    );
    return c.json({ config });
  } catch (err: any) {
    console.error('syncer config save error:', err);
    return c.json({ error: 'Eşitleyici ayarları kaydedilemedi.' }, 500);
  }
});

// ─── GET /api/syncer/accounts ────────────────────────────────────────────────
// List all Tradovate accounts across all connections for the DnD UI

syncer.get('/api/syncer/accounts', async (c) => {
  const user = c.get('user');
  const serviceClient = getDb();

  try {
    const brokerConns = await brokerDb.findByOwnerAndBroker(serviceClient, user.id, 'tradovate');

    const allAccounts: Array<{
      connectionId: string;
      connectionLabel: string | null;
      environment: string;
      accountId: number;
      accountName: string;
    }> = [];

    for (const bc of brokerConns) {
      const tvConn = await tvConnDb.findByBrokerConnectionId(serviceClient, bc.id);
      if (!tvConn?.access_token) continue;

      try {
        const token = await decrypt(tvConn.access_token, c.env.ENCRYPTION_KEY);
        const api = new TradovateAPI(bc.environment);
        const rawAccounts = (await api.getAccounts(token)) as any[];

        for (const a of rawAccounts) {
          allAccounts.push({
            connectionId: bc.id,
            connectionLabel: bc.label,
            environment: bc.environment,
            accountId: a.id,
            accountName: a.name,
          });
        }
      } catch {
        // Skip connections with expired/invalid tokens
      }
    }

    return c.json({ accounts: allAccounts });
  } catch (err: any) {
    console.error('syncer accounts error:', err);
    return c.json({ error: 'Hesaplar alınamadı.' }, 500);
  }
});

// ─── POST /api/syncer/start ──────────────────────────────────────────────────

syncer.post('/api/syncer/start', async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const config = await syncerDb.getConfig(db, user.id);
    if (!config) {
      return c.json({ error: 'Eşitleyici ayarı bulunamadı. Önce ayarı kaydedin.' }, 400);
    }
    if (!config.leader_connection_id || !config.leader_account_id) {
      return c.json({ error: 'Leader account not configured.' }, 400);
    }
    if (!config.follower_accounts || config.follower_accounts.length === 0) {
      return c.json({ error: 'Takipçi hesap seçilmemiş.' }, 400);
    }
    if (!positiveId(config.leader_account_id)
      || config.follower_accounts.some((follower) => !positiveId(follower.accountId)
        || typeof follower.multiplier !== 'number' || !Number.isFinite(follower.multiplier) || follower.multiplier <= 0
        || (follower.connectionId === config.leader_connection_id
          && follower.accountId === config.leader_account_id))) {
      return c.json({ error: 'Lider ve takipçi hesap ayarları geçersiz.' }, 400);
    }

    // Until broker reconciliation is implemented, allow simulation accounts only.
    const owned = await brokerDb.findByOwnerAndBroker(db, user.id, 'tradovate');
    const demoIds = new Set(owned.filter((connection) => connection.environment === 'demo').map((connection) => connection.id));
    if (!demoIds.has(config.leader_connection_id)
      || config.follower_accounts.some((follower) => !demoIds.has(follower.connectionId))) {
      return c.json({ error: 'Canlı hesaplarda emir kopyalama güvenlik nedeniyle kapalıdır.' }, 403);
    }

    await syncerDb.setActive(db, config.id, true);
    return c.json({ ok: true, message: 'Syncer started.' });
  } catch (err: any) {
    console.error('syncer start error:', err);
    return c.json({ error: 'Eşitleyici başlatılamadı.' }, 500);
  }
});

// ─── POST /api/syncer/stop ───────────────────────────────────────────────────

syncer.post('/api/syncer/stop', async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const config = await syncerDb.getConfig(db, user.id);
    if (!config) {
      return c.json({ error: 'Eşitleyici ayarı bulunamadı.' }, 400);
    }

    await syncerDb.setActive(db, config.id, false);
    return c.json({ ok: true, message: 'Syncer stopped.' });
  } catch (err: any) {
    console.error('syncer stop error:', err);
    return c.json({ error: 'Eşitleyici durdurulamadı.' }, 500);
  }
});

// ─── GET /api/syncer/token ───────────────────────────────────────────────────
// Returns decrypted leader token + WebSocket URL for the browser to connect.

syncer.get('/api/syncer/token', async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const config = await syncerDb.getConfig(db, user.id);
    if (!config || !config.leader_connection_id || !config.leader_account_id) {
      return c.json({ error: 'Leader account not configured.' }, 400);
    }
    if (!config.is_active) {
      return c.json({ error: 'Senkronizasyon etkin değil.' }, 409);
    }
    const owned = await brokerDb.findByOwnerAndBroker(db, user.id, 'tradovate');
    const leaderConnection = owned.find((connection) => connection.id === config.leader_connection_id);
    if (!leaderConnection || leaderConnection.environment !== 'demo'
      || config.follower_accounts.some((follower) =>
        !owned.some((connection) => connection.id === follower.connectionId && connection.environment === 'demo'))) {
      return c.json({ error: 'Canlı hesap yapılandırmasında erişim belirteci verilmez; senkronizasyonu durdurun.' }, 403);
    }

    const { token, environment } = await ensureFreshToken(c.env, config.leader_connection_id);
    if (environment !== 'demo') {
      return c.json({ error: 'Canlı hesap belirteci bu akışta verilmez.' }, 403);
    }

    const wsUrl = 'wss://demo.tradovateapi.com/v1/websocket';

    return c.json(
      { token, wsUrl, leaderAccountId: config.leader_account_id },
      200,
      { 'Cache-Control': 'no-store' },
    );
  } catch (err: any) {
    console.error('syncer token error:', err);
    return c.json({ error: `Failed to get leader token: ${err.message}` }, 500);
  }
});

// ─── POST /api/syncer/mirror ─────────────────────────────────────────────────
// Handles mirror requests from the browser WebSocket client.
// Types: order, cancel, modify. Automatic position sync is intentionally disabled.

syncer.post('/api/syncer/mirror', async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const config = await syncerDb.getConfig(db, user.id);
    if (!config || !config.is_active) {
      return c.json({ error: 'Syncer not active.' }, 400);
    }

    const followers = config.follower_accounts || [];
    if (followers.length === 0) {
      return c.json({ error: 'Takipçi hesap seçilmemiş.' }, 400);
    }
    if (!positiveId(config.leader_account_id)
      || followers.some((follower) => !positiveId(follower.accountId)
        || typeof follower.multiplier !== 'number' || !Number.isFinite(follower.multiplier) || follower.multiplier <= 0
        || (follower.connectionId === config.leader_connection_id
          && follower.accountId === config.leader_account_id))) {
      return c.json({ error: 'Lider ve takipçi hesap ayarları geçersiz.' }, 400);
    }
    const owned = await brokerDb.findByOwnerAndBroker(db, user.id, 'tradovate');
    const demoIds = new Set(owned.filter((connection) => connection.environment === 'demo').map((connection) => connection.id));
    if (!config.leader_connection_id || !demoIds.has(config.leader_connection_id)
      || followers.some((follower) => !demoIds.has(follower.connectionId))) {
      return c.json({ error: 'Canlı hesaplarda emir kopyalama güvenlik nedeniyle kapalıdır.' }, 403);
    }

    const body = await c.req.json();

    // A browser-held WebSocket event map is not an authoritative position
    // snapshot. Never create market orders from it.
    if (body.type === 'position_sync') {
      return c.json({ error: 'Otomatik pozisyon eşitlemesi güvenlik nedeniyle kapalı.' }, 409);
    }

    // Get fresh tokens for all follower connections
    const connectionIds = new Set<string>();
    for (const f of followers) connectionIds.add(f.connectionId);

    const tokenMap = new Map<string, { token: string; api: TradovateAPI }>();
    for (const connId of connectionIds) {
      try {
        const result = await ensureFreshToken(c.env, connId);
        tokenMap.set(connId, { token: result.token, api: result.api });
      } catch {
        // Skip connections with token issues
      }
    }

    // Resolve account specs (account name for placeOrder)
    const accountSpecMap = new Map<string, string>();
    for (const [connId, auth] of tokenMap) {
      try {
        const rawAccounts = (await auth.api.getAccounts(auth.token)) as any[];
        for (const a of rawAccounts) accountSpecMap.set(`${connId}:${a.id}`, a.name);
      } catch { /* non-fatal */ }
    }

    const actions: Array<{ type: string; followerAccountId: number; detail: string; error?: string }> = [];

    switch (body.type) {
      // ═════════════════════════════════════════════════════════════════════
      // ORDER: Mirror a new working order to all followers
      // ═════════════════════════════════════════════════════════════════════
      case 'order': {
        if (!positiveId(body.leaderOrderId) || !positiveId(config.leader_account_id)) {
          return c.json({ error: 'Geçersiz lider emir veya hesap kimliği.' }, 400);
        }
        const leaderResult = await ensureFreshToken(c.env, config.leader_connection_id!);
        const fullOrder = await leaderResult.api.getOrderItem(leaderResult.token, body.leaderOrderId);
        const orderType = fullOrder.ordType;
        const orderQty = fullOrder.orderQty;
        const price = fullOrder.price ?? fullOrder.limitPrice;
        const stopPrice = fullOrder.stopPrice ?? fullOrder.triggerPrice;
        if (fullOrder.id !== body.leaderOrderId || fullOrder.accountId !== config.leader_account_id
          || !positiveId(fullOrder.contractId) || !['Buy', 'Sell'].includes(fullOrder.action)
          || !['Limit', 'Stop', 'StopLimit'].includes(orderType)
          || !['Working', 'Accepted', 'PendingNew'].includes(fullOrder.ordStatus)
          || !positiveId(orderQty)
          || ((orderType === 'Limit' || orderType === 'StopLimit') && !validLimitPrice(price))
          || ((orderType === 'Stop' || orderType === 'StopLimit') && !validLimitPrice(stopPrice))) {
          return c.json({ error: 'Lider emri doğrulanamadı; takipçiye emir gönderilmedi.' }, 409);
        }
        const contracts = await leaderResult.api.getContractItems(leaderResult.token, [fullOrder.contractId]);
        const symbol = contracts.find((contract) => contract.id === fullOrder.contractId)?.name;
        if (!symbol) return c.json({ error: 'Sözleşme adı doğrulanamadı; emir gönderilmedi.' }, 409);

        for (const follower of followers) {
          const followerAuth = tokenMap.get(follower.connectionId);
          if (!followerAuth) continue;
          const accountSpec = accountSpecMap.get(`${follower.connectionId}:${follower.accountId}`);
          const mirroredQty = mirroredQuantity(orderQty, follower.multiplier);
          if (!accountSpec || !positiveId(follower.accountId) || mirroredQty === null) {
            actions.push({ type: 'order', followerAccountId: follower.accountId,
              detail: 'Takipçi hesap veya miktar doğrulanamadı; emir gönderilmedi.', error: 'invalid_order' });
            continue;
          }
          // The unique DB reservation is atomic across duplicate requests.
          // Never automatically retry failed or uncertain broker calls.
          if (!syncerDb.claimMirrorOrder(db, config.id, body.leaderOrderId, follower.accountId, {
            leaderAction: fullOrder.action,
            leaderSymbol: symbol,
            leaderQty: orderQty,
            followerQty: mirroredQty,
            orderType,
          })) continue;

          try {
            const orderParams: any = {
              accountSpec,
              accountId: follower.accountId,
              action: fullOrder.action,
              symbol,
              orderQty: mirroredQty,
              orderType,
              isAutomated: true,
            };
            if (price != null) orderParams.price = price;
            if (stopPrice != null) orderParams.stopPrice = stopPrice;

            const result = await followerAuth.api.placeOrder(followerAuth.token, orderParams);
            if (!positiveId(result.id)) throw new Error('Broker emir kimliği doğrulanamadı. Durum elle uzlaştırılmalı.');

            await syncerDb.logOrder(db, {
              config_id: config.id,
              leader_order_id: body.leaderOrderId,
              leader_action: fullOrder.action,
              leader_symbol: symbol,
              leader_qty: orderQty,
              follower_account_id: follower.accountId,
              follower_order_id: result.id,
              follower_qty: mirroredQty,
              order_type: orderType,
              status: 'placed',
            });

            actions.push({
              type: 'order',
              followerAccountId: follower.accountId,
              detail: `${orderType} ${fullOrder.action} ${mirroredQty} ${symbol}`,
            });
          } catch (err: any) {
            await syncerDb.logOrder(db, {
              config_id: config.id,
              leader_order_id: body.leaderOrderId,
              leader_action: fullOrder.action,
              leader_symbol: symbol,
              leader_qty: orderQty,
              follower_account_id: follower.accountId,
              follower_qty: mirroredQty,
              order_type: orderType,
              status: 'uncertain',
              error_message: err.message,
            });

            actions.push({
              type: 'order',
              followerAccountId: follower.accountId,
              detail: `${orderType} ${fullOrder.action} ${symbol}`,
              error: err.message,
            });
          }
        }
        break;
      }

      // ═════════════════════════════════════════════════════════════════════
      // CANCEL: Cancel follower orders matching a leader order
      // ═════════════════════════════════════════════════════════════════════
      case 'cancel': {
        const followerOrders = await syncerDb.findFollowerOrders(
          db, config.id, body.leaderOrderId,
        );

        for (const log of followerOrders) {
          const follower = followers.find((f) => f.accountId === log.follower_account_id);
          if (!follower) continue;

          const followerAuth = tokenMap.get(follower.connectionId);
          if (!followerAuth || !log.follower_order_id) continue;

          try {
            await followerAuth.api.cancelOrder(followerAuth.token, log.follower_order_id);

            await syncerDb.logOrder(db, {
              config_id: config.id,
              leader_order_id: body.leaderOrderId,
              follower_account_id: log.follower_account_id,
              status: 'cancelled',
            });

            actions.push({
              type: 'cancel',
              followerAccountId: log.follower_account_id,
              detail: `Cancelled follower order ${log.follower_order_id}`,
            });
          } catch (err: any) {
            actions.push({
              type: 'cancel',
              followerAccountId: log.follower_account_id,
              detail: `Cancel failed for order ${log.follower_order_id}`,
              error: err.message,
            });
          }
        }
        break;
      }

      // ═════════════════════════════════════════════════════════════════════
      // MODIFY: Modify follower orders matching a leader order
      // ═════════════════════════════════════════════════════════════════════
      case 'modify': {
        if (!positiveId(body.leaderOrderId)) return c.json({ error: 'Geçersiz lider emir kimliği.' }, 400);
        if ((body.price != null && !validLimitPrice(body.price))
          || (body.stopPrice != null && !validLimitPrice(body.stopPrice))
          || (body.orderQty != null && !positiveId(body.orderQty))) {
          return c.json({ error: 'Geçersiz emir fiyatı veya miktarı; değişiklik gönderilmedi.' }, 400);
        }
        const followerOrders = await syncerDb.findFollowerOrders(
          db, config.id, body.leaderOrderId,
        );

        for (const log of followerOrders) {
          const follower = followers.find((f) => f.accountId === log.follower_account_id);
          if (!follower) continue;

          const followerAuth = tokenMap.get(follower.connectionId);
          if (!followerAuth || !log.follower_order_id) continue;

          const modifyParams: Partial<{ orderQty: number; price: number; stopPrice: number }> = {};
          if (body.price != null) modifyParams.price = body.price;
          if (body.stopPrice != null) modifyParams.stopPrice = body.stopPrice;
          if (body.orderQty != null) {
            const qty = mirroredQuantity(body.orderQty, follower.multiplier);
            if (qty === null) {
              actions.push({ type: 'modify', followerAccountId: follower.accountId,
                detail: 'Geçersiz takipçi miktarı; değişiklik gönderilmedi.', error: 'invalid_order' });
              continue;
            }
            modifyParams.orderQty = qty;
          }
          if (Object.keys(modifyParams).length === 0) continue;

          try {
            await followerAuth.api.modifyOrder(followerAuth.token, log.follower_order_id, modifyParams);

            actions.push({
              type: 'modify',
              followerAccountId: log.follower_account_id,
              detail: `Modified follower order ${log.follower_order_id}`,
            });
          } catch (err: any) {
            actions.push({
              type: 'modify',
              followerAccountId: log.follower_account_id,
              detail: `Modify failed for order ${log.follower_order_id}`,
              error: err.message,
            });
          }
        }
        break;
      }

      default:
        return c.json({ error: `Unknown mirror type: ${body.type}` }, 400);
    }

    return c.json({ actions });
  } catch (err: any) {
    console.error('syncer mirror error:', err);
    return c.json({ error: `Mirror failed: ${err.message}` }, 500);
  }
});

// ─── GET /api/syncer/account-status ───────────────────────────────────────────
// Returns positions + cash balance for all syncer accounts.
// Called on a slower interval (~5s) for unrealized P&L display.

syncer.get('/api/syncer/account-status', async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const config = await syncerDb.getConfig(db, user.id);
    if (!config || !config.leader_connection_id || !config.leader_account_id) {
      return c.json({ accounts: [] });
    }

    const followers = config.follower_accounts || [];
    const allAccounts = [
      { connectionId: config.leader_connection_id, accountId: config.leader_account_id, role: 'leader' as const },
      ...followers.map((f) => ({ connectionId: f.connectionId, accountId: f.accountId, role: 'follower' as const })),
    ];

    // Collect unique connections and get tokens
    const connectionIds = [...new Set(allAccounts.map((a) => a.connectionId))];
    const tokenMap = new Map<string, { token: string; api: TradovateAPI }>();
    for (const connId of connectionIds) {
      try {
        const result = await ensureFreshToken(c.env, connId);
        tokenMap.set(connId, { token: result.token, api: result.api });
      } catch {
        // skip failed connections
      }
    }

    // Resolve account names
    const nameMap = new Map<number, string>();
    for (const [, auth] of tokenMap) {
      try {
        const rawAccounts = (await auth.api.getAccounts(auth.token)) as any[];
        for (const a of rawAccounts) {
          nameMap.set(a.id, a.name);
        }
      } catch {
        // non-fatal
      }
    }

    // Fetch positions + balances in parallel per account
    const accountStatuses = await Promise.all(
      allAccounts.map(async (acct) => {
        const auth = tokenMap.get(acct.connectionId);
        if (!auth) {
          return {
            accountId: acct.accountId,
            name: nameMap.get(acct.accountId) || String(acct.accountId),
            role: acct.role,
            positions: [],
            cashBalance: null,
          };
        }

        try {
          const [positions, balanceData] = await Promise.all([
            auth.api.getPositionsByAccount(auth.token, acct.accountId),
            auth.api.getCashBalance(auth.token, acct.accountId),
          ]);

          return {
            accountId: acct.accountId,
            name: nameMap.get(acct.accountId) || String(acct.accountId),
            role: acct.role,
            positions: positions.map((p) => ({ contractId: p.contractId, netPos: p.netPos })),
            cashBalance: balanceData?.cashBalance ?? null,
          };
        } catch {
          return {
            accountId: acct.accountId,
            name: nameMap.get(acct.accountId) || String(acct.accountId),
            role: acct.role,
            positions: [],
            cashBalance: null,
          };
        }
      }),
    );

    return c.json({ accounts: accountStatuses });
  } catch (err: any) {
    console.error('syncer account-status error:', err);
    return c.json({ error: 'Hesap durumu alınamadı.' }, 500);
  }
});

// ─── GET /api/syncer/logs ────────────────────────────────────────────────────

// Manual reconciliation never submits, cancels, or changes a broker order.
syncer.post('/api/syncer/reconcile', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  try {
    const body = await c.req.json() as {
      logId?: string; decision?: string; followerOrderId?: number; confirmed?: boolean; note?: string;
    };
    if (typeof body.logId !== 'string' || !body.logId) return c.json({ error: 'Geçersiz kayıt.' }, 400);
    const config = await syncerDb.getConfig(db, user.id);
    if (!config) return c.json({ error: 'Eşitleyici ayarı bulunamadı.' }, 404);
    const log = await syncerDb.findLogById(db, config.id, body.logId);
    if (!log || !['pending', 'uncertain'].includes(log.status)) {
      return c.json({ error: 'Kayıt artık uzlaştırılabilir durumda değil.' }, 409);
    }

    if (body.decision === 'not_found') {
      if (body.confirmed !== true) return c.json({ error: 'Brokerda olmadığı açıkça onaylanmalıdır.' }, 400);
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
      if (!note) return c.json({ error: 'Lütfen kontrol notu girin.' }, 400);
      const changed = await syncerDb.reconcileOrder(db, config.id, log.id, 'not_placed', { note });
      if (!changed) return c.json({ error: 'Kayıt başka bir işlemle uzlaştırıldı.' }, 409);
      return c.json({ ok: true });
    }

    if (body.decision !== 'found' || !positiveId(body.followerOrderId)) {
      return c.json({ error: 'Takipçi broker emir kimliği geçersiz.' }, 400);
    }
    const matchingFollowers = config.follower_accounts.filter((item) => item.accountId === log.follower_account_id);
    if (matchingFollowers.length !== 1) {
      return c.json({ error: 'Takipçi hesabı yapılandırmada tekil olarak doğrulanamadı.' }, 403);
    }
    const follower = matchingFollowers[0];
    const owned = await brokerDb.findByOwnerAndBroker(db, user.id, 'tradovate');
    const connection = owned.find((item) => item.id === follower.connectionId);
    if (!connection || connection.environment !== 'demo') {
      return c.json({ error: 'Uzlaştırma yalnızca kullanıcının sahip olduğu demo bağlantısında yapılabilir.' }, 403);
    }
    const auth = await ensureFreshToken(c.env, follower.connectionId);
    if (auth.environment !== 'demo') return c.json({ error: 'Demo bağlantısı doğrulanamadı.' }, 403);
    const accounts = await auth.api.getAccounts(auth.token) as any[];
    if (!accounts.some((account) => account.id === follower.accountId)) {
      return c.json({ error: 'Takipçi hesabı bu broker bağlantısında doğrulanamadı.' }, 403);
    }
    const order = await auth.api.getOrderItem(auth.token, body.followerOrderId);
    if (order.id !== body.followerOrderId || order.accountId !== follower.accountId
      || !log.leader_action || order.action !== log.leader_action
      || !positiveId(log.follower_qty) || order.orderQty !== log.follower_qty
      || !log.order_type || order.ordType !== log.order_type
      || !positiveId(order.contractId) || !log.leader_symbol) {
      return c.json({ error: 'Broker emri kimlik, hesap, yön veya miktar bakımından kayıtla eşleşmiyor.' }, 409);
    }
    const contracts = await auth.api.getContractItems(auth.token, [order.contractId]);
    if (contracts.length !== 1 || contracts[0].id !== order.contractId || contracts[0].name !== log.leader_symbol) {
      return c.json({ error: 'Broker emrinin sözleşmesi kayıtla eşleşmiyor.' }, 409);
    }
    let status: 'placed' | 'filled' | 'failed' | 'cancelled';
    let note: string | undefined;
    if (order.ordStatus === 'Filled') {
      status = 'filled';
    } else if (['Working', 'Accepted', 'PartiallyFilled'].includes(order.ordStatus)) {
      status = 'placed';
    } else if (['Canceled', 'Cancelled'].includes(order.ordStatus)) {
      status = 'cancelled';
    } else if (['Rejected', 'Failed'].includes(order.ordStatus)) {
      status = 'failed';
      note = `Broker emri ${order.ordStatus} durumunda; yeniden emir gönderilmedi.`;
    } else {
      return c.json({ error: `Broker emir durumu (${order.ordStatus || 'bilinmiyor'}) henüz güvenle uzlaştırılamıyor; kayıt açık kaldı.` }, 409);
    }
    const changed = await syncerDb.reconcileOrder(db, config.id, log.id, status, {
      followerOrderId: order.id,
      note,
    });
    if (!changed) return c.json({ error: 'Kayıt başka bir işlemle uzlaştırıldı.' }, 409);
    return c.json({ ok: true, status });
  } catch (err: any) {
    console.error('syncer reconcile error:', err);
    return c.json({ error: 'Kayıt broker bilgileriyle uzlaştırılamadı.' }, 500);
  }
});

syncer.get('/api/syncer/logs', async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const config = await syncerDb.getConfig(db, user.id);
    if (!config) {
      return c.json({ logs: [] });
    }

    const logs = await syncerDb.getRecentLogs(db, config.id, 100);
    return c.json({ logs });
  } catch (err: any) {
    console.error('syncer logs error:', err);
    return c.json({ error: 'Eşitleyici kayıtları alınamadı.' }, 500);
  }
});

export default syncer;
