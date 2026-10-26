const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

async function fetchBytes(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!response.ok) throw new Error(`Update HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Güncelleme dosyası boyut sınırını aşıyor.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('Güncelleme dosyası boyut sınırını aşıyor.');
  return bytes;
}

function validRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes('\0')) return false;
  const parts = value.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) return false;
  return value === 'server.cjs' || value === 'schema.sql' || value.startsWith('public/');
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function cacheBusted(url) {
  const target = new URL(url);
  target.searchParams.set('update-check', `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
  return target.href;
}

async function resolveImmutableManifestUrl(manifestUrl, refUrl) {
  if (!refUrl) return manifestUrl;
  const ref = new URL(refUrl);
  if (ref.protocol !== 'https:' || ref.hostname !== 'api.github.com') {
    throw new Error('Güncelleme GitHub ref adresi geçersiz.');
  }
  const refParts = ref.pathname.split('/').filter(Boolean);
  if (refParts.length !== 5 || refParts[0] !== 'repos' || refParts[3] !== 'commits') {
    throw new Error('Güncelleme GitHub ref yolu geçersiz.');
  }
  const refInfo = JSON.parse((await fetchBytes(ref.href, 1024 * 1024)).toString('utf8'));
  if (typeof refInfo.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(refInfo.sha)) {
    throw new Error('Güncelleme GitHub ref yanıtında commit SHA bulunamadı.');
  }
  const feed = new URL(manifestUrl);
  const feedParts = feed.pathname.split('/').filter(Boolean);
  if (feed.protocol !== 'https:' || feed.hostname !== 'raw.githubusercontent.com' ||
      feedParts.length < 4 || feedParts[0] !== refParts[1] || feedParts[1] !== refParts[2]) {
    throw new Error('Güncelleme manifesti ile GitHub ref aynı depoyu göstermeli.');
  }
  feedParts[2] = refInfo.sha;
  feed.pathname = `/${feedParts.join('/')}`;
  feed.search = '';
  feed.hash = '';
  return feed.href;
}

async function stageRemoteUpdate({ manifestUrl, refUrl = '', updateRoot, currentVersion = '' }) {
  const immutableManifestUrl = await resolveImmutableManifestUrl(manifestUrl, refUrl);
  const feed = new URL(immutableManifestUrl);
  if (feed.protocol !== 'https:') throw new Error('Güncelleme adresi HTTPS olmalı.');
  const manifestBytes = await fetchBytes(cacheBusted(feed.href), 1024 * 1024);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.format !== 2 || typeof manifest.version !== 'string' ||
      !/^\d{4}\.\d{2}\.\d{2}-\d{6}$/.test(manifest.version) ||
      !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Güncelleme manifest biçimi geçersiz.');
  }
  const currentManifest = path.join(updateRoot, 'app', 'version.json');
  let hasInstalledUpdateManifest = false;
  try {
    const current = JSON.parse(fs.readFileSync(currentManifest, 'utf8'));
    hasInstalledUpdateManifest = current.format === 2 && typeof current.version === 'string';
    if (current.version === manifest.version && current.format === 2) return { updated: false, version: manifest.version };
  } catch { /* first update */ }
  if (!hasInstalledUpdateManifest && currentVersion === manifest.version) return { updated: false, version: manifest.version };

  const files = Object.entries(manifest.files);
  if (files.length < 5 || files.length > MAX_FILES) throw new Error('Güncelleme dosya listesi geçersiz.');
  for (const required of ['server.cjs', 'schema.sql', 'public/trades.html', 'public/assets/appBundle.js', 'public/assets/app.css']) {
    if (!Object.prototype.hasOwnProperty.call(manifest.files, required)) throw new Error(`Güncelleme dosyası eksik: ${required}`);
  }
  const baseUrl = new URL('.', feed);
  const safeRoot = path.resolve(updateRoot);
  fs.mkdirSync(safeRoot, { recursive: true });
  const suffix = `${process.pid}-${Date.now()}`;
  const stageDir = path.join(safeRoot, `app-stage-${suffix}`);
  const previousDir = path.join(safeRoot, `app-previous-${suffix}`);
  fs.mkdirSync(stageDir, { recursive: false });
  let totalBytes = 0;
  try {
    for (const [relative, expectedHash] of files) {
      if (!validRelativePath(relative) || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
        throw new Error(`Güncelleme dosya yolu/hash geçersiz: ${relative}`);
      }
      const url = new URL(relative.split('/').map(encodeURIComponent).join('/'), baseUrl);
      if (url.protocol !== 'https:' || url.origin !== feed.origin) throw new Error('Güncelleme dosyası farklı adresten indirilemez.');
      const bytes = await fetchBytes(cacheBusted(url.href), MAX_FILE_BYTES);
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Toplam güncelleme boyutu sınırı aşıldı.');
      if (digest(bytes).toLowerCase() !== expectedHash.toLowerCase()) throw new Error(`SHA-256 doğrulaması başarısız: ${relative}`);
      const destination = path.resolve(stageDir, ...relative.split('/'));
      if (!destination.startsWith(`${stageDir}${path.sep}`)) throw new Error('Güncelleme yolu uygulama klasörünün dışına çıkıyor.');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { flag: 'wx' });
    }
    fs.writeFileSync(path.join(stageDir, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const appDir = path.join(safeRoot, 'app');
    let movedOld = false;
    try {
      if (fs.existsSync(appDir)) { fs.renameSync(appDir, previousDir); movedOld = true; }
      fs.renameSync(stageDir, appDir);
    } catch (err) {
      if (movedOld && !fs.existsSync(appDir) && fs.existsSync(previousDir)) fs.renameSync(previousDir, appDir);
      throw err;
    }
    return { updated: true, version: manifest.version };
  } catch (err) {
    try {
      const resolvedStage = path.resolve(stageDir);
      if (resolvedStage.startsWith(`${safeRoot}${path.sep}`) && fs.existsSync(resolvedStage)) fs.rmSync(resolvedStage, { recursive: true, force: true });
    } catch { /* preserve the original update error */ }
    throw err;
  }
}

module.exports = { stageRemoteUpdate };
