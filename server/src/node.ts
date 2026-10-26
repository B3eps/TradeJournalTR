import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './index';
import { ensureDataDirs, getEnv, getPort, getSecretKey } from './config';
import { getDb, initDb } from './db/connection';
import { ensureLocalUser } from './db/profiles';
import { refreshExpiringBrokerTokens } from './scheduled/broker-refresh';
import { startNewsFeed } from './services/newsfeed';
import { startIntegrations } from './services/integrations';
import { startGoogleSync } from './services/google';
import { startActivityWatchIfEnabled } from './services/timetrack/launcher';

const BROKER_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // hourly

const runBrokerRefresh = (env: ReturnType<typeof getEnv>) => {
  refreshExpiringBrokerTokens(env).catch((err) => {
    console.error('[Broker Cron] refresh run failed:', err);
  });
};

const main = async () => {
  // Bootstrap: data dirs, server secret, database schema, local user
  ensureDataDirs();
  getSecretKey();
  initDb();
  await ensureLocalUser(getDb());

  const env = getEnv();
  const port = getPort();

  // Yalnızca bu bilgisayardan erişilsin (ağdaki diğer cihazlar bağlanamaz).
  serve({
    fetch: (request) => app.fetch(request, env),
    port,
    hostname: '127.0.0.1',
  });

  console.log(`Trade Günlüğü server listening on http://localhost:${port}`);

  // Hourly broker token refresh (replaces the Workers scheduled() cron)
  runBrokerRefresh(env);
  setInterval(() => runBrokerRefresh(env), BROKER_REFRESH_INTERVAL_MS);

  // Live news feed poller (fails soft; never blocks startup)
  startNewsFeed();

  // ntfy reminders, auto-backup, optional local-AI queue; Google Classroom sync (all idempotent, fail soft)
  startIntegrations();
  startGoogleSync();
  startActivityWatchIfEnabled();
};

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
