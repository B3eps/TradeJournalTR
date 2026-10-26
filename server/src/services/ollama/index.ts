/**
 * Optional local AI (Ollama) news summaries. OFF by default; the user's
 * machine is RAM-sensitive, so every call uses keep_alive '0s' (model unloads
 * right after the reply), a modest num_ctx, concurrency 1 and an hourly cap.
 * Output goes through the same sanitizer as external evaluations, is always
 * marked low-confidence and is written to DATA_DIR/news-eval/<id>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../db/connection';
import * as newsDb from '../../db/news-items';
import { getSetting, setSetting, listSettingsByKey } from '../../db/settings';
import { EVALUATION_SAFETY_RULE_TR, buildAskPrompt, evaluationInputSchema, sanitizeEvaluation, type Evaluation } from '../newsfeed/evaluation';
import { NEWS_EVAL_DIR } from '../newsfeed';
import { IntegrationError, bad, fetchWithTimeout, normalizeBaseUrl, optBool, intInRange } from '../ntfy/http';

export const AI_KEY = 'ai';
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,100}$/;
const ID_RE = /^[0-9a-f]{16}$/;
const CHAT_TIMEOUT_MS = 120 * 1000;
const TAGS_TIMEOUT_MS = 4 * 1000;
const NUM_CTX = 4096;
export const LOCAL_AI_WARNING = 'Yerel yapay zeka çıktısıdır; hata yapabilir.';

export interface AiSettings { enabled: boolean; baseUrl: string; model: string; autoSummarize: boolean; maxPerHour: number }
export const AI_DEFAULTS: AiSettings = {
  enabled: false, baseUrl: 'http://localhost:11434', model: 'qwen3:4b', autoSummarize: false, maxPerHour: 6,
};

export function getAiSettings(userId: string): AiSettings {
  const raw = getSetting<Partial<AiSettings>>(userId, AI_KEY);
  return { ...AI_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

export function saveAiSettings(userId: string, body: Record<string, unknown>): AiSettings {
  const cur = getAiSettings(userId);
  const next: AiSettings = {
    enabled: optBool(body.enabled, cur.enabled),
    baseUrl: body.baseUrl === undefined ? cur.baseUrl : normalizeBaseUrl(body.baseUrl, 'Ollama adresi'),
    model: cur.model,
    autoSummarize: optBool(body.autoSummarize, cur.autoSummarize),
    maxPerHour: intInRange(body.maxPerHour, 1, 60, 'Saatlik en fazla özet', cur.maxPerHour),
  };
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || !MODEL_RE.test(body.model.trim())) throw bad('Model adı geçersiz (ör. qwen3:4b).');
    next.model = body.model.trim();
  }
  setSetting(userId, AI_KEY, next);
  return next;
}

// --- status ---

export interface ModelInfo { name: string; sizeBytes: number; parameterSize: string | null; ramHintGb: number; heavy: boolean }

/** Rough resident RAM while generating: weights + ~20 % + KV cache/runtime overhead. */
export function ramHintGb(sizeBytes: number): number {
  const gb = sizeBytes / 1024 ** 3;
  return Math.round((gb * 1.2 + 0.6) * 10) / 10;
}

export async function getAiStatus(s: AiSettings): Promise<{ available: boolean; error?: string; models: ModelInfo[]; modelInstalled: boolean }> {
  try {
    const res = await fetchWithTimeout(`${s.baseUrl}/api/tags`, { method: 'GET', headers: { Accept: 'application/json' } }, TAGS_TIMEOUT_MS);
    if (!res.ok) return { available: false, error: `Ollama HTTP ${res.status} döndürdü.`, models: [], modelInstalled: false };
    const data = (await res.json()) as { models?: Array<Record<string, any>> };
    const models: ModelInfo[] = (Array.isArray(data?.models) ? data.models : [])
      .filter((m) => m && typeof m.name === 'string')
      .slice(0, 100)
      .map((m) => {
        const size = Number(m.size) || 0;
        const hint = ramHintGb(size);
        return {
          name: String(m.name).slice(0, 100),
          sizeBytes: size,
          parameterSize: typeof m.details?.parameter_size === 'string' ? m.details.parameter_size.slice(0, 20) : null,
          ramHintGb: hint,
          heavy: hint > 6,
        };
      });
    const want = s.model.includes(':') ? s.model : `${s.model}:latest`;
    return { available: true, models, modelInstalled: models.some((m) => m.name === s.model || m.name === want) };
  } catch (err: any) {
    const timeout = String(err?.message) === 'timeout';
    return { available: false, error: timeout ? 'Ollama yanıt vermedi.' : 'Ollama çalışmıyor veya adres yanlış.', models: [], modelInstalled: false };
  }
}

// --- chat (concurrency 1) ---

let chain: Promise<unknown> = Promise.resolve();
let queued = 0;

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  queued++;
  const run = chain.then(fn, fn);
  chain = run.catch(() => {}).finally(() => { queued--; });
  return run;
}

export function aiBusy(): boolean {
  return queued > 0;
}

interface ChatMessage { role: 'system' | 'user'; content: string }

async function chatOnce(s: AiSettings, messages: ChatMessage[], json: boolean, think: boolean): Promise<Response> {
  const body: Record<string, unknown> = {
    model: s.model,
    messages,
    stream: false,
    keep_alive: '0s', // unload right after use to free RAM
    options: { num_ctx: NUM_CTX, temperature: 0.2, keep_alive: '0s' },
  };
  if (json) body.format = 'json';
  if (!think) body.think = false;
  return fetchWithTimeout(`${s.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }, CHAT_TIMEOUT_MS);
}

async function chat(s: AiSettings, messages: ChatMessage[], json: boolean): Promise<string> {
  return serialize(async () => {
    let res: Response;
    try {
      res = await chatOnce(s, messages, json, false);
      if (res.status === 400) {
        // older Ollama / models without a thinking switch reject `think`
        const txt = await res.text().catch(() => '');
        if (/think/i.test(txt)) res = await chatOnce(s, messages, json, true);
        else throw new IntegrationError(502, `Ollama isteği reddetti: ${txt.slice(0, 160)}`);
      }
    } catch (err: any) {
      if (err instanceof IntegrationError) throw err;
      if (String(err?.message) === 'timeout') throw new IntegrationError(504, 'Ollama 120 sn içinde yanıt vermedi.');
      throw new IntegrationError(503, 'Ollama çalışmıyor veya adres yanlış.');
    }
    if (res.status === 404) throw new IntegrationError(502, `"${s.model}" modeli kurulu değil. Önce: ollama pull ${s.model}`);
    if (!res.ok) throw new IntegrationError(502, `Ollama HTTP ${res.status} döndürdü.`);
    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new IntegrationError(502, 'Ollama geçersiz yanıt verdi.');
    }
    const content = data?.message?.content;
    if (typeof content !== 'string') throw new IntegrationError(502, 'Ollama boş yanıt verdi.');
    return content.slice(0, 50000);
  });
}

/** Removes <think> blocks and code fences, then parses the outermost JSON object. */
export function parseModelJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Sanitizer + local-AI policy: low confidence, warning prefix. */
export function finalizeLocalEvaluation(raw: unknown, id: string, now = new Date()): Evaluation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.id !== undefined && candidate.id !== id) return null;
  const parsed = evaluationInputSchema.safeParse({
    ...candidate,
    id,
    evaluatedAt: now.toISOString(),
    guven: 'düşük',
  });
  if (!parsed.success) return null;
  const ev = sanitizeEvaluation(parsed.data, id, now);
  if (!ev) return null;
  ev.uyari = ev.uyari ? `${LOCAL_AI_WARNING} ${ev.uyari}`.slice(0, 300) : LOCAL_AI_WARNING;
  if (!ev.ozet && !ev.etkilenen.length && !ev.senaryolar.length) return null;
  return ev;
}

export async function testAi(s: AiSettings): Promise<{ ok: true; reply: string; ms: number }> {
  const t0 = Date.now();
  const reply = await chat(s, [
    { role: 'system', content: 'Kısa ve Türkçe yanıt ver.' },
    { role: 'user', content: 'Sadece "Merhaba, hazırım." yaz.' },
  ], false);
  const clean = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { ok: true, reply: clean, ms: Date.now() - t0 };
}

// --- rate limit ---

const calls: number[] = [];

function takeSlot(maxPerHour: number): void {
  const now = Date.now();
  while (calls.length && calls[0] < now - 60 * 60 * 1000) calls.shift();
  if (calls.length >= maxPerHour) {
    const waitMin = Math.max(1, Math.ceil((calls[0] + 60 * 60 * 1000 - now) / 60000));
    throw new IntegrationError(429, `Saatlik özet sınırına ulaşıldı (${maxPerHour}). ${waitMin} dk sonra tekrar deneyin.`);
  }
  calls.push(now);
}

export function usedThisHour(): number {
  const now = Date.now();
  return calls.filter((t) => t > now - 60 * 60 * 1000).length;
}

function safeArr(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function evalPath(id: string): string {
  return path.join(NEWS_EVAL_DIR, `${id}.json`);
}

export function hasEvaluation(id: string): boolean {
  return ID_RE.test(id) && fs.existsSync(evalPath(id));
}

/** Summarises one stored news item with the local model and writes the evaluation file. */
export async function summarizeNews(s: AiSettings, id: unknown, opts: { force?: boolean } = {}): Promise<Evaluation> {
  if (!s.enabled) throw bad('Yerel yapay zeka kapalı. Önce açıp kaydedin.');
  if (typeof id !== 'string' || !ID_RE.test(id)) throw bad('Geçersiz haber kimliği.');
  const row = newsDb.getNewsItem(getDb(), id);
  if (!row) throw new IntegrationError(404, 'Haber bulunamadı.');
  if (!opts.force && hasEvaluation(id)) throw new IntegrationError(409, 'Bu haberin zaten bir değerlendirmesi var.');
  takeSlot(s.maxPerHour);

  const system = [
    'Sen dikkatli bir piyasa haberi analistisin. Yalnızca Türkçe yaz.',
    'Yanıtın SADECE tek bir JSON nesnesi olmalı; açıklama, Markdown veya kod bloğu yok.',
    '',
    EVALUATION_SAFETY_RULE_TR,
    '',
    'Fiyat seviyesi, hedef, giriş/çıkış noktası, al/sat önerisi veya emir türü ASLA yazma.',
  ].join('\n');
  const user = buildAskPrompt({
    id: row.id, source: row.source, category: row.category, title: row.title, summary: row.summary,
    url: row.url, publishedAt: row.published_at, importance: row.importance,
    tags: safeArr(row.tags), instruments: safeArr(row.instruments),
  });
  const reply = await chat(s, [{ role: 'system', content: system }, { role: 'user', content: user }], true);
  const ev = finalizeLocalEvaluation(parseModelJson(reply), id);
  if (!ev) throw new IntegrationError(502, 'Model geçerli bir değerlendirme JSON\'u üretmedi. Daha büyük bir model deneyin.');

  fs.mkdirSync(NEWS_EVAL_DIR, { recursive: true });
  const file = evalPath(id);
  const tmp = `${file}.${process.pid}.ai.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...ev, kaynak: `ollama:${s.model}` }, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, fs.readFileSync(tmp, 'utf8'), 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  return ev;
}

/** Newest important item, preferring one without an evaluation (for the UI sample). */
export function sampleNewsItem(): { id: string; title: string; source: string; importance: number; hasEvaluation: boolean } | null {
  try {
    const rows = newsDb.listQueueCandidates(getDb(), 2, 20);
    if (!rows.length) return null;
    const pick = rows.find((r) => !hasEvaluation(r.id)) ?? rows[0];
    return { id: pick.id, title: pick.title, source: pick.source, importance: pick.importance, hasEvaluation: hasEvaluation(pick.id) };
  } catch {
    return null;
  }
}

// --- optional auto-summarise queue ---

const AUTO_TICK_MS = 60 * 1000;
const AUTO_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const attempted = new Set<string>();
let autoTimer: NodeJS.Timeout | null = null;
let autoRunning = false;

/** Summarises at most one new importance>=2 item per tick, for the first user with autoSummarize on. */
export async function autoSummarizeTick(): Promise<string | null> {
  if (autoRunning || aiBusy()) return null;
  autoRunning = true;
  try {
    const conf = listSettingsByKey<Partial<AiSettings>>(AI_KEY)
      .map((r) => ({ ...AI_DEFAULTS, ...(r.value || {}) }))
      .find((s) => s.enabled && s.autoSummarize);
    if (!conf) return null;
    const cutoff = Date.now() - AUTO_MAX_AGE_MS;
    const next = newsDb.listQueueCandidates(getDb(), 2, 30)
      .find((r) => !attempted.has(r.id) && Date.parse(r.first_seen_at) >= cutoff && !hasEvaluation(r.id));
    if (!next) return null;
    if (usedThisHour() >= conf.maxPerHour) return null;
    attempted.add(next.id);
    if (attempted.size > 2000) attempted.clear();
    await summarizeNews(conf, next.id);
    return next.id;
  } catch (err: any) {
    console.warn('[Ollama] auto summary failed:', err?.message || err);
    return null;
  } finally {
    autoRunning = false;
  }
}

export function startAiQueue(): void {
  if (autoTimer) return;
  autoTimer = setInterval(() => { autoSummarizeTick().catch(() => {}); }, AUTO_TICK_MS);
  autoTimer.unref();
}
