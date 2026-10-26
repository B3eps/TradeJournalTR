/**
 * Google OAuth 2.0 for installed apps (loopback redirect + PKCE S256).
 * The user brings their own "Desktop app" OAuth client; nothing is shipped.
 */
import crypto from 'node:crypto';
import type { Db } from '../../db/connection';
import { getPort } from '../../config';
import { GoogleError, httpRequest, describeApiError } from './http';
import * as store from './store';

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const STATE_TTL_MS = 10 * 60 * 1000;

interface PendingAuth {
  userId: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}
const pending = new Map<string, PendingAuth>();

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(48)); // 64 chars, within 43..128
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Port of the running server: from the request Host header, else PORT, else the default. */
export function resolvePort(hostHeader: string | undefined | null): number {
  const m = /:(\d{2,5})$/.exec(hostHeader || '');
  if (m) {
    const p = Number(m[1]);
    if (p > 0 && p < 65536) return p;
  }
  return getPort();
}

export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}/api/google/oauth/callback`;
}

function prunePending(): void {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt <= now) pending.delete(k);
}

export function buildAuthUrl(userId: string, clientId: string, redirectUri: string): { authUrl: string; state: string } {
  prunePending();
  const state = b64url(crypto.randomBytes(24));
  const { verifier, challenge } = createPkce();
  pending.set(state, { userId, verifier, redirectUri, expiresAt: Date.now() + STATE_TTL_MS });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return { authUrl: `${AUTH_ENDPOINT}?${params.toString()}`, state };
}

/** Validates and consumes a state value (single use). */
export function takePendingState(state: string | undefined): PendingAuth | null {
  if (!state) return null;
  const p = pending.get(state);
  if (!p) return null;
  pending.delete(state);
  if (p.expiresAt <= Date.now()) return null;
  return p;
}

/** Test helper: inspect the stored verifier for a state. */
export function _peekPending(state: string): PendingAuth | undefined {
  return pending.get(state);
}

function tokenError(r: { status: number; data: any }): GoogleError {
  const code = r.data?.error;
  if (code === 'invalid_grant') return new GoogleError('Google erişimi iptal edilmiş veya süresi dolmuş. Lütfen yeniden bağlanın.', r.status, 'invalid_grant');
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return new GoogleError('OAuth istemci kimliği veya gizli anahtarı hatalı. Bilgileri kontrol edip yeniden kaydedin.', r.status, 'invalid_client');
  }
  if (code === 'redirect_uri_mismatch') {
    return new GoogleError('Yönlendirme adresi kabul edilmedi. OAuth istemci türünün "Masaüstü uygulaması (Desktop app)" olduğundan emin olun.', r.status, 'redirect_uri_mismatch');
  }
  return new GoogleError(`Google jeton isteği başarısız oldu (${r.status}${code ? `: ${code}` : ''}).`, r.status, 'token_error');
}

async function postForm(url: string, form: Record<string, string>) {
  return httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
}

/** Exchanges the authorization code, fetches the account email and stores everything encrypted. */
export async function completeAuthorization(db: Db, p: PendingAuth, code: string): Promise<{ email: string | null }> {
  const secrets = await store.getSecrets(db, p.userId);
  if (!secrets) throw new GoogleError('Önce OAuth istemci bilgilerini kaydedin.', 400, 'not_configured');
  const r = await postForm(TOKEN_ENDPOINT, {
    code,
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    redirect_uri: p.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: p.verifier,
  });
  if (!r.ok || !r.data?.access_token) throw tokenError(r);
  const accessToken: string = r.data.access_token;
  const refreshToken: string | undefined = r.data.refresh_token;
  if (!refreshToken && !secrets.refreshToken) {
    throw new GoogleError('Google yenileme jetonu vermedi. Bağlantıyı tekrar deneyin (izin ekranını onaylayın).', 400, 'no_refresh_token');
  }
  let email: string | null = null;
  const u = await httpRequest(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (u.ok && typeof u.data?.email === 'string') email = u.data.email;
  await store.saveTokens(db, p.userId, {
    accessToken,
    expiresAt: Date.now() + (Number(r.data.expires_in) || 3600) * 1000,
    refreshToken: refreshToken ?? null,
    scopes: typeof r.data.scope === 'string' ? r.data.scope : SCOPES.join(' '),
    email,
    connected: true,
  });
  return { email };
}

/** Uses the refresh token to get a new access token (and stores it). */
export async function refreshAccessToken(db: Db, userId: string): Promise<string> {
  const s = await store.getSecrets(db, userId);
  if (!s) throw new GoogleError('Google bağlantısı yapılandırılmamış.', 400, 'not_configured');
  if (!s.refreshToken) throw new GoogleError('Google hesabı bağlı değil.', 400, 'not_connected');
  const r = await postForm(TOKEN_ENDPOINT, {
    client_id: s.clientId,
    client_secret: s.clientSecret,
    refresh_token: s.refreshToken,
    grant_type: 'refresh_token',
  });
  if (!r.ok || !r.data?.access_token) {
    const err = tokenError(r);
    if (err.code === 'invalid_grant') store.clearTokens(db, userId, err.message);
    throw err;
  }
  await store.saveTokens(db, userId, {
    accessToken: r.data.access_token,
    expiresAt: Date.now() + (Number(r.data.expires_in) || 3600) * 1000,
    refreshToken: r.data.refresh_token ?? null,
  });
  return r.data.access_token;
}

/** A valid access token (refreshed when missing or expiring within 60 s). */
export async function getAccessToken(db: Db, userId: string): Promise<string> {
  const s = await store.getSecrets(db, userId);
  if (!s) throw new GoogleError('Google bağlantısı yapılandırılmamış.', 400, 'not_configured');
  if (!s.refreshToken) throw new GoogleError('Google hesabı bağlı değil.', 400, 'not_connected');
  if (s.accessToken && s.expiresAt && s.expiresAt - 60_000 > Date.now()) return s.accessToken;
  return refreshAccessToken(db, userId);
}

/**
 * Authorized GET returning parsed JSON. On 401 it refreshes once and retries.
 * Non-OK responses throw a Turkish GoogleError (describeApiError).
 */
export async function googleGet(db: Db, userId: string, url: string, what: string): Promise<any> {
  let token = await getAccessToken(db, userId);
  let r = await httpRequest(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (r.status === 401) {
    token = await refreshAccessToken(db, userId);
    r = await httpRequest(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  }
  if (!r.ok) throw describeApiError(r, what);
  return r.data ?? {};
}

/** Best-effort revoke, then delete local tokens (client credentials are kept). */
export async function disconnect(db: Db, userId: string): Promise<{ revoked: boolean }> {
  const s = await store.getSecrets(db, userId);
  let revoked = false;
  const token = s?.refreshToken || s?.accessToken;
  if (token) {
    try {
      const r = await postForm(REVOKE_ENDPOINT, { token });
      revoked = r.ok;
    } catch { /* best effort */ }
  }
  store.clearTokens(db, userId, null);
  return { revoked };
}
