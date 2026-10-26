import crypto from 'node:crypto';
import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { getItemWithEvaluation, getMetalEvaluationPrompt, getNextMetalEvaluation, saveEvaluation } from '../services/newsfeed';

type HonoEnv = { Bindings: Env; Variables: AuthContext };
const internalChatGpt = new Hono<HonoEnv>();

internalChatGpt.use('/internal/newsfeed/*', async (c, next) => {
  const expected = process.env.TRADE_GUNLUGU_BOOT_TOKEN || '';
  const supplied = c.req.header('x-trade-gunlugu-boot-token') || '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (!expected || suppliedBytes.length !== expectedBytes.length ||
      !crypto.timingSafeEqual(suppliedBytes, expectedBytes)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return next();
});

internalChatGpt.get('/internal/newsfeed/next-metal', (c) => {
  const excluded = (c.req.query('exclude') || '').split(',').slice(0, 50);
  return c.json({ candidate: getNextMetalEvaluation(excluded) });
});

internalChatGpt.get('/internal/newsfeed/prompt/:id', (c) => {
  const prompt = getMetalEvaluationPrompt(c.req.param('id'));
  return prompt ? c.json({ prompt }) : c.json({ error: 'not_found_or_not_metal_news' }, 404);
});

internalChatGpt.post('/internal/newsfeed/evaluation/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: 'invalid_id' }, 400);
  const text = await c.req.text();
  if (text.length > 256 * 1024) return c.json({ error: 'payload_too_large' }, 413);
  const item = getItemWithEvaluation(id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  if (item.evaluation) return c.json({ error: 'already_evaluated' }, 409);
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return c.json({ error: 'invalid_json' }, 400); }
  const evaluation = saveEvaluation(id, raw);
  return evaluation ? c.json({ evaluation }) : c.json({ error: 'invalid_evaluation' }, 400);
});

export default internalChatGpt;
