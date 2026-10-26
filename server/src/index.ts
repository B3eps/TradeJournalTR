import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Env, AuthContext } from './bindings';
import { securityHeaders } from './middleware/security';
import { authMiddleware } from './middleware/auth';
import { localOnly } from './middleware/localOnly';
import { ApiError } from './db/tasks';
import uploadRoutes from './routes/uploads';
import accountRoutes from './routes/account';
import tradeRoutes from './routes/trade';
import tagRoutes from './routes/tag';
import dailyNoteRoutes from './routes/daily-note';
import tradovateRoutes from './routes/tradovate';
import projectxRoutes from './routes/projectx';
import premarketRoutes from './routes/premarket';
import strategyRoutes from './routes/strategy';
import backtestingRoutes from './routes/backtesting';
import syncerRoutes from './routes/syncer';
import robinhoodRoutes from './routes/robinhood';
import webullRoutes from './routes/webull';
import newsRoutes from './routes/news';
import newsfeedRoutes from './routes/newsfeed';
import timetrackRoutes from './routes/timetrack';
import taskRoutes from './routes/tasks';
import projectRoutes from './routes/projects';
import labelRoutes from './routes/labels';
import linkRoutes from './routes/links';
import searchRoutes from './routes/search';
import notesRoutes from './routes/notes';
import cardsRoutes from './routes/cards';
import chartsRoutes from './routes/charts';
import habitsRoutes from './routes/habits';
import financeRoutes from './routes/finance';
import integrationsRoutes from './routes/integrations';
import googleRoutes from './routes/google';
import graphRoutes from './routes/graph';
import pageRoutes from './routes/pages';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const app = new Hono<HonoEnv>();

// Global middleware
app.use('*', localOnly);
app.use('*', securityHeaders);

// Body size cap: 10 MB for JSON/API bodies, 16 MB for image uploads (route itself caps files at 10 MB)
const API_BODY_LIMIT = 10 * 1024 * 1024;
const UPLOAD_BODY_LIMIT = 16 * 1024 * 1024;
const tooLarge = (c: any) => c.json({ error: 'İstek gövdesi çok büyük.' }, 413);
app.use('/api/*', async (c, next) => {
  const maxSize = c.req.path === '/api/uploads' ? UPLOAD_BODY_LIMIT : API_BODY_LIMIT;
  return bodyLimit({ maxSize, onError: tooLarge })(c, next);
});

app.use('*', authMiddleware);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', bootToken: process.env.TRADE_GUNLUGU_BOOT_TOKEN || null }));

// API routes (must be before page routes to take precedence)
app.route('/', uploadRoutes);
app.route('/', accountRoutes);
app.route('/', tradeRoutes);
app.route('/', tagRoutes);
app.route('/', dailyNoteRoutes);
app.route('/', tradovateRoutes);
app.route('/', projectxRoutes);
app.route('/', premarketRoutes);
app.route('/', strategyRoutes);
app.route('/', backtestingRoutes);
app.route('/', syncerRoutes);
app.route('/', robinhoodRoutes);
app.route('/', webullRoutes);
app.route('/', newsRoutes);
app.route('/', newsfeedRoutes);
app.route('/', timetrackRoutes);
app.route('/', taskRoutes);
app.route('/', projectRoutes);
app.route('/', labelRoutes);
app.route('/', linkRoutes);
app.route('/', searchRoutes);
app.route('/', notesRoutes);
app.route('/', cardsRoutes);
app.route('/', chartsRoutes);
app.route('/', habitsRoutes);
app.route('/', financeRoutes);
app.route('/', integrationsRoutes);
app.route('/', googleRoutes);
app.route('/', graphRoutes);

// Static assets from public/ (bundles, css, manifest, service worker, ...)
app.use('/*', serveStatic({ root: './public' }));

// Page routes (HTML serving)
app.route('/', pageRoutes);

// Consistent JSON errors (never leak internals)
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || 'İstek işlenemedi.' }, err.status);
  }
  if (err instanceof SyntaxError && /JSON/i.test(err.message)) {
    return c.json({ error: 'Geçersiz JSON gövdesi.' }, 400);
  }
  console.error('[Unhandled]', c.req.method, c.req.path, err);
  return c.json({ error: 'Sunucu hatası, işlem tamamlanamadı.' }, 500);
});

app.notFound((c) => c.json({ error: 'Bulunamadı.' }, 404));

export default app;
