import { createMiddleware } from 'hono/factory';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const forbidden = (message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });

/**
 * Local-only guard (DNS rebinding + CSRF protection).
 * - The Host header must be localhost / 127.0.0.1 / [::1] (optionally with a port).
 * - Mutating requests that carry an Origin header must come from the same local origin.
 *   Requests without an Origin (Electron shell, curl, same-origin GET) are allowed.
 */
export const localOnly = createMiddleware(async (c, next) => {
  // The node server always has a Host header; in-process calls (app.request) fall back to the URL host.
  let host = c.req.header('host');
  if (host === undefined) {
    try { host = new URL(c.req.url).host; } catch { host = ''; }
  }
  if (!LOCAL_HOST.test(host)) return forbidden('Geçersiz Host başlığı.');

  if (MUTATING.has(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin !== undefined) {
      let ok = false;
      try {
        const u = new URL(origin);
        ok = u.protocol === 'http:' && u.host.toLowerCase() === host.toLowerCase() && LOCAL_HOST.test(u.host);
      } catch {
        ok = false;
      }
      if (!ok) return forbidden('Geçersiz istek kaynağı.');
    }
  }
  return next();
});
