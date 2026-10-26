import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const settingsPath = () => path.join(process.env.DATA_DIR || process.cwd(), 'activitywatch-settings.json');
const executablePath = () => path.join(process.env.ACTIVITYWATCH_ROOT || '', 'aw-qt.exe');

function readSettings(): { autoStart?: boolean } {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}

function writeSettings(settings: { autoStart: boolean }): void {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

export function isActivityWatchAutoStartEnabled(): boolean {
  return readSettings().autoStart === true;
}

export function disableActivityWatchAutoStart(): void {
  writeSettings({ autoStart: false });
}

async function isRunning(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:5600/api/0/info', { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch { return false; }
}

export async function startActivityWatch(): Promise<{ available: boolean; started: boolean }> {
  if (process.platform !== 'win32') throw new Error('Paketlenmiş ActivityWatch şu anda Windows içindir.');
  const exe = executablePath();
  if (!fs.existsSync(exe)) throw new Error('ActivityWatch bileşeni kurulumda bulunamadı. Uygulamayı güncel kurulum dosyasıyla yeniden kurun.');
  if (await isRunning()) {
    writeSettings({ autoStart: true });
    return { available: true, started: false };
  }

  const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
  const spawnState: { error?: Error } = {};
  child.once('error', (err) => { spawnState.error = err; });
  child.unref();
  writeSettings({ autoStart: true });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (await isRunning()) return { available: true, started: true };
    if (spawnState.error || child.exitCode !== null) break;
  }
  writeSettings({ autoStart: false });
  throw new Error(spawnState.error?.message || 'ActivityWatch başlatılamadı. 5600 portunu başka bir uygulama kullanıyor olabilir.');
}

export async function startActivityWatchIfEnabled(): Promise<void> {
  if (!readSettings().autoStart || await isRunning()) return;
  try { await startActivityWatch(); }
  catch (err) { console.error('[ActivityWatch] autostart failed:', err); }
}
