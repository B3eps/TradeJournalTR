/**
 * Small helpers shared by the integrations services (ntfy, Ollama, backup):
 * an error type with an HTTP status, URL/number validators and a fetch with
 * timeout. The fetch implementation can be swapped for in-process checks.
 */

export class IntegrationError extends Error {
  status: 400 | 404 | 409 | 429 | 500 | 502 | 503 | 504;
  constructor(status: IntegrationError['status'], message: string) {
    super(message);
    this.status = status;
    this.name = 'IntegrationError';
  }
}

export const bad = (msg: string) => new IntegrationError(400, msg);

type FetchFn = typeof fetch;
let fetchImpl: FetchFn | null = null;

/** Test hook: replace the fetch used by the integrations services (null = global fetch). */
export function setIntegrationsFetch(fn: FetchFn | null): void {
  fetchImpl = fn;
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const f = fetchImpl ?? fetch;
    return await f(url, { ...init, signal: controller.signal, redirect: 'manual' });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts only http/https URLs without credentials, query or fragment; returns it without trailing slash. */
export function normalizeBaseUrl(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${field} zorunludur.`);
  const raw = v.trim();
  if (raw.length > 300) throw bad(`${field} en fazla 300 karakter olabilir.`);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad(`${field} geçerli bir adres değil (ör. https://ntfy.sh).`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad(`${field} yalnızca http:// veya https:// ile başlayabilir.`);
  if (u.username || u.password) throw bad(`${field} kullanıcı adı/parola içeremez.`);
  if (u.search || u.hash) throw bad(`${field} sorgu (?) veya # içeremez.`);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export function optBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (v === true || v === false) return v;
  throw bad('Açık/kapalı alanları true veya false olmalı.');
}

export function intInRange(v: unknown, min: number, max: number, field: string, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} ${min} ile ${max} arasında bir tam sayı olmalı.`);
  return n;
}

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function optTime(v: unknown, field: string, fallback: string): string {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string' || !HHMM.test(v)) throw bad(`${field} SS:DD biçiminde olmalı (ör. 08:30).`);
  return v;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock helpers (the server runs on the user's own machine). */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function localHm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}
