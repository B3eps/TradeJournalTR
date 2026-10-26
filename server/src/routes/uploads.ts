import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { SCREENSHOTS_DIR } from '../config';
import { requiresLogin } from '../middleware/auth';
import { generateId } from '../utils/id';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const uploads = new Hono<HonoEnv>();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

// Raster formats only — SVG is excluded because it can carry scripts (stored XSS)
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const EXTENSION_MIMES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

// POST /api/uploads — multipart field `file`; image-only, 10MB cap.
uploads.post('/api/uploads', requiresLogin, async (c) => {
  let file: unknown;
  try {
    const body = await c.req.parseBody();
    file = body['file'];
  } catch {
    return c.json({ error: 'Görsel yükleme isteği okunamadı.' }, 400);
  }

  if (!(file instanceof File)) {
    return c.json({ error: 'Yüklenecek görsel dosyası bulunamadı.' }, 400);
  }

  const ext = MIME_EXTENSIONS[file.type];
  if (!ext) {
    return c.json({ error: 'Yalnızca görsel dosyaları yüklenebilir.' }, 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'Görsel en fazla 10 MB olabilir.' }, 400);
  }

  const name = `${generateId()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.promises.writeFile(path.join(SCREENSHOTS_DIR, name), buffer);

  return c.json({ path: name });
});

// GET /uploads/:name — public serving (paths are unguessable UUIDs)
uploads.get('/uploads/:name', async (c) => {
  const name = c.req.param('name');

  // Reject anything that isn't a plain "uuid.ext" style filename
  if (!/^[A-Za-z0-9-]+\.[A-Za-z0-9]+$/.test(name)) {
    return c.notFound();
  }

  const filePath = path.join(SCREENSHOTS_DIR, name);
  let data: Buffer;
  try {
    data = await fs.promises.readFile(filePath);
  } catch {
    return c.notFound();
  }

  const ext = name.split('.').pop()!.toLowerCase();
  const contentType = EXTENSION_MIMES[ext] || 'application/octet-stream';

  return c.body(new Uint8Array(data), 200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  });
});

export default uploads;
