/**
 * Small HTTP layer for Google APIs: 15 s timeouts, request spacing,
 * retry with exponential backoff on 429/5xx/network errors, Turkish errors.
 */

export class GoogleError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const timing = {
  timeoutMs: 15_000,
  minSpacingMs: 120,
  baseBackoffMs: 1_000,
  maxRetries: 3,
};

/** For the check script: make retries fast. */
export function _setTimingForTests(t: Partial<typeof timing>): void {
  Object.assign(timing, t);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
async function spaceRequests(): Promise<void> {
  const wait = lastRequestAt + timing.minSpacingMs - Date.now();
  lastRequestAt = Math.max(Date.now(), lastRequestAt + timing.minSpacingMs);
  if (wait > 0) await sleep(wait);
}

export interface HttpResult {
  status: number;
  ok: boolean;
  data: any;
  text: string;
  headers: Headers;
}

/**
 * fetch() with timeout + retries. Resolves for any HTTP status that is not
 * retryable (callers inspect .ok/.status); throws GoogleError for network
 * failures and for retryable statuses that keep failing.
 */
export async function httpRequest(url: string, init: RequestInit = {}): Promise<HttpResult> {
  let attempt = 0;
  for (;;) {
    await spaceRequests();
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timing.timeoutMs) });
    } catch (err: any) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      if (attempt < timing.maxRetries) {
        await sleep(timing.baseBackoffMs * 2 ** attempt);
        attempt++;
        continue;
      }
      throw new GoogleError(
        timeout ? 'Google yanıt vermedi (15 sn zaman aşımı). Daha sonra tekrar deneyin.' : 'Google sunucularına ulaşılamadı. İnternet bağlantınızı kontrol edin.',
        0,
        timeout ? 'timeout' : 'network',
      );
    }
    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if ((res.status === 429 || res.status >= 500) && attempt < timing.maxRetries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : timing.baseBackoffMs * 2 ** attempt;
      await sleep(delay + Math.floor(Math.random() * 100));
      attempt++;
      continue;
    }
    if (res.status === 429) throw new GoogleError('Google istek sınırına ulaşıldı. Birkaç dakika sonra tekrar deneyin.', 429, 'rate_limited');
    if (res.status >= 500) throw new GoogleError(`Google geçici bir hata döndürdü (${res.status}). Daha sonra tekrar deneyin.`, res.status, 'server');
    return { status: res.status, ok: res.ok, data, text, headers: res.headers };
  }
}

/** Turkish message for a non-OK Google API response. */
export function describeApiError(r: HttpResult, what: string): GoogleError {
  const reason: string = r.data?.error?.status || r.data?.error?.errors?.[0]?.reason || '';
  const msg: string = r.data?.error?.message || '';
  if (r.status === 401) return new GoogleError('Google oturumu geçersiz. Lütfen yeniden bağlanın.', 401, 'unauthorized');
  if (r.status === 403) {
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(`${reason} ${msg}`)) {
      return new GoogleError(`${what}: Bu API Google Cloud projenizde etkin değil. Konsolda API'yi etkinleştirip birkaç dakika bekleyin.`, 403, 'api_disabled');
    }
    if (/insufficient|scope/i.test(`${reason} ${msg}`)) {
      return new GoogleError(`${what}: Gerekli izin verilmemiş. Bağlantıyı kesip yeniden bağlanın ve tüm izinleri onaylayın.`, 403, 'insufficient_scope');
    }
    return new GoogleError(`${what}: Bu kaynağa erişim izniniz yok.`, 403, 'forbidden');
  }
  if (r.status === 404) return new GoogleError(`${what}: Kaynak bulunamadı.`, 404, 'not_found');
  return new GoogleError(`${what}: Google isteği başarısız oldu (${r.status}).`, r.status, 'http');
}
