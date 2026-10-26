import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import { ApiError, readJson } from '../db/tasks';
import { IntegrationError } from '../services/ntfy/http';
import * as ntfy from '../services/ntfy';
import * as backup from '../services/backup';
import * as ai from '../services/ollama';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

// "Bağlantılar" settings page: ntfy phone notifications, local backups and
// the optional local AI (Ollama). Secrets (ntfy token) are never returned.

function fail(c: Context<HonoEnv>, err: unknown, tag: string) {
  if (err instanceof IntegrationError) return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  console.error(`[Integrations ${tag}]`, err);
  return c.json({ error: 'Sunucu hatası, işlem tamamlanamadı.' }, 500);
}

const uid = (c: Context<HonoEnv>) => c.get('user').id;

const integrations = new Hono<HonoEnv>();

// ─── ntfy ────────────────────────────────────────────────────────────────────

integrations.get('/api/integrations/ntfy', requiresLogin, (c) => {
  try {
    return c.json({ settings: ntfy.toPublic(ntfy.getNtfySettings(uid(c))) });
  } catch (err) {
    return fail(c, err, 'ntfy get');
  }
});

integrations.put('/api/integrations/ntfy', requiresLogin, async (c) => {
  try {
    const saved = await ntfy.saveNtfySettings(uid(c), await readJson(c));
    return c.json({ settings: ntfy.toPublic(saved) });
  } catch (err) {
    return fail(c, err, 'ntfy put');
  }
});

integrations.post('/api/integrations/ntfy/test', requiresLogin, async (c) => {
  try {
    const r = await ntfy.sendTest(uid(c));
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 502);
  } catch (err) {
    return fail(c, err, 'ntfy test');
  }
});

integrations.post('/api/integrations/ntfy/generate-topic', requiresLogin, (c) => c.json({ topic: ntfy.generateTopic() }));

// ─── backup ──────────────────────────────────────────────────────────────────

function backupPayload(userId: string) {
  return {
    settings: backup.getBackupSettings(userId),
    backups: backup.listBackups(),
    folder: backup.BACKUP_PATHS.root,
    dataDir: backup.BACKUP_PATHS.dataDir,
    dbFile: backup.BACKUP_PATHS.dbFile,
    ...backup.backupStatus(),
  };
}

integrations.get('/api/integrations/backup', requiresLogin, (c) => {
  try {
    return c.json(backupPayload(uid(c)));
  } catch (err) {
    return fail(c, err, 'backup get');
  }
});

integrations.put('/api/integrations/backup', requiresLogin, async (c) => {
  try {
    backup.saveBackupSettings(uid(c), await readJson(c));
    return c.json(backupPayload(uid(c)));
  } catch (err) {
    return fail(c, err, 'backup put');
  }
});

integrations.post('/api/integrations/backup/run', requiresLogin, async (c) => {
  try {
    const created = await backup.runBackup({ keep: backup.getBackupSettings(uid(c)).keep });
    return c.json({ created, ...backupPayload(uid(c)) });
  } catch (err) {
    return fail(c, err, 'backup run');
  }
});

integrations.delete('/api/integrations/backup/:name', requiresLogin, (c) => {
  try {
    backup.deleteBackup(c.req.param('name'));
    return c.json({ ok: true, ...backupPayload(uid(c)) });
  } catch (err) {
    return fail(c, err, 'backup delete');
  }
});

// ─── local AI (Ollama) ───────────────────────────────────────────────────────

integrations.get('/api/integrations/ai', requiresLogin, async (c) => {
  try {
    const settings = ai.getAiSettings(uid(c));
    const status = await ai.getAiStatus(settings);
    return c.json({
      settings,
      status: { ...status, busy: ai.aiBusy(), usedThisHour: ai.usedThisHour() },
      sample: ai.sampleNewsItem(),
    });
  } catch (err) {
    return fail(c, err, 'ai get');
  }
});

integrations.put('/api/integrations/ai', requiresLogin, async (c) => {
  try {
    return c.json({ settings: ai.saveAiSettings(uid(c), await readJson(c)) });
  } catch (err) {
    return fail(c, err, 'ai put');
  }
});

integrations.post('/api/integrations/ai/test', requiresLogin, async (c) => {
  try {
    const s = ai.getAiSettings(uid(c));
    if (!s.enabled) throw new IntegrationError(400, 'Yerel yapay zeka kapalı. Önce açıp kaydedin.');
    return c.json(await ai.testAi(s));
  } catch (err) {
    return fail(c, err, 'ai test');
  }
});

integrations.post('/api/integrations/ai/summarize-news', requiresLogin, async (c) => {
  try {
    const body = await readJson(c);
    const evaluation = await ai.summarizeNews(ai.getAiSettings(uid(c)), body.id, { force: body.force === true });
    return c.json({ ok: true, evaluation });
  } catch (err) {
    return fail(c, err, 'ai summarize');
  }
});

export default integrations;
