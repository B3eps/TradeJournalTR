import { ProviderError } from './types';

export const DEFAULT_TIMEOUT_MS = 10 * 1000;

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** GET + JSON with an abort timeout. Throws ProviderError (with HTTP status when known). */
export async function getJson<T>(url: string, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA, ...(opts.headers || {}) },
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new ProviderError(err?.name === 'AbortError' ? 'timeout' : (err?.cause?.code || err?.message || 'network_error'));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new ProviderError(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError('invalid_json', res.status);
  }
}

/** Rejects after ms; the wrapped promise keeps running (callers may still use its result). */
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ProviderError(label)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Per-source serial queue with a minimum spacing between request starts.
 * One request per source at a time keeps us polite to free public endpoints.
 */
export class RateLimiter {
  private chain: Promise<void> = Promise.resolve();
  private lastStart = 0;

  constructor(private readonly minSpacingMs: number, private readonly holdCapMs = 60 * 1000) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.lastStart + this.minSpacingMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastStart = Date.now();
      return fn();
    });
    // The queue is released when fn settles, or after holdCap at the latest.
    this.chain = withTimeout(run.then(() => undefined, () => undefined), this.holdCapMs).catch(() => undefined);
    return run;
  }
}
