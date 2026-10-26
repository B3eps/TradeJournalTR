/**
 * ntfy phone notifications: settings (token encrypted at rest), message
 * sending and the critical-news push hook used by the news poller.
 * A message is an HTTP POST to `${server}/${topic}` with Title / Priority /
 * Tags / Click headers and a plain-text body. Secrets never go into a message.
 */
import crypto from 'node:crypto';
import { getSetting, setSetting, listSettingsByKey, encryptSecret, decryptSecret } from '../../db/settings';
import {
  IntegrationError, bad, fetchWithTimeout, normalizeBaseUrl, optBool, intInRange, optTime,
  localHm, minutesOf,
} from './http';
import { claimOnce, releaseClaim } from '../reminders/sent';

export const NTFY_KEY = 'ntfy';
const SEND_TIMEOUT_MS = 10 * 1000;
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_RE = /^[\x21-\x7e]{1,200}$/;
const NEWS_MAX_PER_HOUR = 12;
const NEWS_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export interface QuietHours { start: string; end: string }

export interface NtfyStored {
  enabled: boolean;
  server: string;
  topic: string;
  tokenEnc?: string | null;
  minNewsImportance: 2 | 3;
  taskReminders: boolean;
  reminderLeadMinutes: number;
  morningDigest: boolean;
  digestTime: string;
  quietHours: QuietHours | null;
}

export type NtfyPublic = Omit<NtfyStored, 'tokenEnc'> & { tokenSet: boolean };

export const NTFY_DEFAULTS: NtfyStored = {
  enabled: false,
  server: 'https://ntfy.sh',
  topic: '',
  tokenEnc: null,
  minNewsImportance: 3,
  taskReminders: true,
  reminderLeadMinutes: 15,
  morningDigest: false,
  digestTime: '08:30',
  quietHours: null,
};

function withDefaults(raw: Partial<NtfyStored> | null): NtfyStored {
  const v = { ...NTFY_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (v.minNewsImportance !== 2 && v.minNewsImportance !== 3) v.minNewsImportance = 3;
  return v;
}

export function getNtfySettings(userId: string): NtfyStored {
  return withDefaults(getSetting<Partial<NtfyStored>>(userId, NTFY_KEY));
}

export function toPublic(s: NtfyStored): NtfyPublic {
  const { tokenEnc, ...rest } = s;
  return { ...rest, tokenSet: !!tokenEnc };
}

/**
 * Validates and stores a partial update. `token`: undefined keeps the stored
 * one, '' / null removes it, a string replaces it (encrypted).
 */
export async function saveNtfySettings(userId: string, body: Record<string, unknown>): Promise<NtfyStored> {
  const cur = getNtfySettings(userId);
  const next: NtfyStored = { ...cur };
  next.enabled = optBool(body.enabled, cur.enabled);
  if (body.server !== undefined) next.server = normalizeBaseUrl(body.server, 'Sunucu adresi');
  if (body.topic !== undefined) {
    const t = typeof body.topic === 'string' ? body.topic.trim() : '';
    if (t && !TOPIC_RE.test(t)) throw bad('Konu (topic) yalnızca harf, rakam, - ve _ içerebilir (en fazla 64 karakter).');
    next.topic = t;
  }
  if (body.minNewsImportance !== undefined) {
    const n = Number(body.minNewsImportance);
    if (n !== 2 && n !== 3) throw bad('Haber önem eşiği 2 veya 3 olmalı.');
    next.minNewsImportance = n;
  }
  next.taskReminders = optBool(body.taskReminders, cur.taskReminders);
  next.reminderLeadMinutes = intInRange(body.reminderLeadMinutes, 1, 240, 'Hatırlatma süresi (dk)', cur.reminderLeadMinutes);
  next.morningDigest = optBool(body.morningDigest, cur.morningDigest);
  next.digestTime = optTime(body.digestTime, 'Sabah özeti saati', cur.digestTime);
  if (body.quietHours !== undefined) {
    if (body.quietHours === null || body.quietHours === false) next.quietHours = null;
    else if (typeof body.quietHours === 'object' && !Array.isArray(body.quietHours)) {
      const q = body.quietHours as Record<string, unknown>;
      const start = optTime(q.start, 'Sessiz saat başlangıcı', '');
      const end = optTime(q.end, 'Sessiz saat bitişi', '');
      if (!start || !end) throw bad('Sessiz saatler için başlangıç ve bitiş gerekli.');
      if (start === end) throw bad('Sessiz saat başlangıcı ve bitişi aynı olamaz.');
      next.quietHours = { start, end };
    } else throw bad('Sessiz saatler { start, end } biçiminde olmalı.');
  }
  if (body.token !== undefined) {
    if (body.token === null || body.token === '') next.tokenEnc = null;
    else {
      if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token.trim())) {
        throw bad('Erişim anahtarı boşluk içermeyen en fazla 200 karakter olmalı.');
      }
      next.tokenEnc = await encryptSecret(body.token.trim());
    }
  }
  if (next.enabled && !next.topic) throw bad('Bildirimleri açmak için bir konu (topic) gerekli.');
  setSetting(userId, NTFY_KEY, next);
  return next;
}

export function generateTopic(): string {
  // 15 random bytes -> 20 url-safe base64 characters
  return `tg-${crypto.randomBytes(15).toString('base64url')}`;
}

/** True when `now` (local) falls inside the quiet window; windows may cross midnight. */
export function inQuietHours(q: QuietHours | null, now = new Date()): boolean {
  if (!q) return false;
  const m = minutesOf(localHm(now));
  const s = minutesOf(q.start);
  const e = minutesOf(q.end);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** RFC 2047 encoding for non-ASCII header values (ntfy decodes it). */
function headerValue(v: string): string {
  const clean = v.replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

export interface NtfyMessage {
  title: string;
  body: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
}

export interface SendResult { ok: boolean; status?: number; error?: string }

/** Sends one message. Never throws; the error text never contains the token. */
export async function sendNtfy(s: NtfyStored, msg: NtfyMessage): Promise<SendResult> {
  if (!s.topic || !TOPIC_RE.test(s.topic)) return { ok: false, error: 'Konu (topic) ayarlı değil.' };
  let base: string;
  try {
    base = normalizeBaseUrl(s.server, 'Sunucu adresi');
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Geçersiz sunucu adresi.' };
  }
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    Title: headerValue(msg.title.slice(0, 120)),
    Priority: String(msg.priority ?? 3),
  };
  if (msg.tags?.length) headers.Tags = msg.tags.filter((t) => /^[a-z0-9_+-]{1,40}$/i.test(t)).join(',');
  if (msg.click && /^https?:\/\//i.test(msg.click) && msg.click.length < 1000) headers.Click = msg.click;
  const token = await decryptSecret(s.tokenEnc);
  if (s.tokenEnc && !token) return { ok: false, error: 'Kayıtlı erişim anahtarı çözülemedi; yeniden girin.' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetchWithTimeout(`${base}/${encodeURIComponent(s.topic)}`, {
      method: 'POST',
      headers,
      body: msg.body.slice(0, 3500),
    }, SEND_TIMEOUT_MS);
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? ' (erişim anahtarı veya konu izni hatalı)' : res.status === 429 ? ' (çok fazla istek)' : '';
      return { ok: false, status: res.status, error: `ntfy sunucusu HTTP ${res.status} döndürdü${hint}.` };
    }
    return { ok: true, status: res.status };
  } catch (err: any) {
    const m = String(err?.message || err);
    return { ok: false, error: m === 'timeout' ? 'ntfy sunucusu 10 sn içinde yanıt vermedi.' : 'ntfy sunucusuna ulaşılamadı.' };
  }
}

export async function sendTest(userId: string): Promise<SendResult> {
  const s = getNtfySettings(userId);
  if (!s.topic) throw bad('Önce bir konu (topic) girin ve kaydedin.');
  return sendNtfy(s, {
    title: 'Trade Günlüğü',
    body: 'Test bildirimi: telefon bildirimleri çalışıyor.',
    priority: 3,
    tags: ['white_check_mark'],
  });
}

/** Users whose ntfy notifications are switched on. */
export function enabledNtfyUsers(): Array<{ userId: string; settings: NtfyStored }> {
  return listSettingsByKey<Partial<NtfyStored>>(NTFY_KEY)
    .map((r) => ({ userId: r.userId, settings: withDefaults(r.value) }))
    .filter((r) => r.settings.enabled && !!r.settings.topic);
}

// --- critical news push ---

const CATEGORY_TR: Record<string, string> = { forex: 'Forex', nasdaq: 'Nasdaq', crypto: 'Kripto' };
const newsSentAt = new Map<string, number[]>();

export interface NewsPushItem {
  id: string;
  source: string;
  category: string;
  title: string;
  importance: number;
  url?: string;
  publishedAt?: string;
}

async function pushNews(item: NewsPushItem): Promise<void> {
  if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') return;
  const published = item.publishedAt ? Date.parse(item.publishedAt) : Date.now();
  if (Number.isFinite(published) && published < Date.now() - NEWS_MAX_AGE_MS) return;
  for (const { userId, settings } of enabledNtfyUsers()) {
    if (item.importance < settings.minNewsImportance) continue;
    if (inQuietHours(settings.quietHours)) continue;
    const now = Date.now();
    const recent = (newsSentAt.get(userId) ?? []).filter((t) => t > now - 60 * 60 * 1000);
    if (recent.length >= NEWS_MAX_PER_HOUR) continue;
    if (!claimOnce(userId, `news:${item.id}`, 'news')) continue;
    const res = await sendNtfy(settings, {
      title: `${item.source} · ${CATEGORY_TR[item.category] || item.category}`,
      body: item.title, // headline only: no analysis, no advice
      priority: item.importance >= 3 ? 4 : 3,
      tags: [item.importance >= 3 ? 'rotating_light' : 'newspaper'],
      click: item.url,
    });
    if (res.ok) {
      recent.push(now);
      newsSentAt.set(userId, recent);
    } else {
      releaseClaim(userId, `news:${item.id}`, 'news');
      console.warn('[ntfy] news push failed:', res.error);
    }
  }
}

/** Fire-and-forget hook for a newly stored important news item. Never throws. */
export function notifyCriticalNews(item: NewsPushItem): void {
  try {
    pushNews(item).catch((err) => console.warn('[ntfy] news push error:', err?.message || err));
  } catch (err: any) {
    console.warn('[ntfy] news push error:', err?.message || err);
  }
}

export { IntegrationError };
