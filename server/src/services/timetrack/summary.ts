import {
  AwUnavailableError,
  AW_BASE_URL,
  getBuckets,
  getInfo,
  resolveBuckets,
  runQuery,
  type AwEvent,
  type ResolvedBuckets,
} from './aw-client';
import { createClassifier, getCategories, FALLBACK_COLOR, FALLBACK_NAME, type Category } from './categories';

/**
 * Time-tracking summaries computed from the local ActivityWatch server.
 *
 * One query2 program is run per local calendar day (ActivityWatch clips events
 * at the time-period edges, which handles events spanning midnight). Per day it
 * returns window events intersected with "not-afk" periods (merged by
 * app+title), the union of those active periods (for the hour histogram and
 * first/last activity), AFK totals and, when a web watcher exists, browser-tab
 * time merged by URL. Everything else is aggregated here.
 *
 * Day boundaries and hours use the machine's local time zone.
 */

const CACHE_TTL_MS = 20 * 1000;
const MAX_RANGE_DAYS = 92;
const TOP_N = 15;
const BROWSER_APP_REGEX =
  '(?i)(chrome|chromium|firefox|msedge|edge|brave|opera|vivaldi|arc|safari|librewolf|waterfox|zen|yandex|floorp|thorium)';

// ---------------------------------------------------------------------------
// Local date helpers
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

/** ISO 8601 with the local UTC offset, e.g. 2026-10-25T00:00:00+03:00 */
export function toLocalIso(d: Date): string {
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Adds the [startMs, endMs) interval to a 24-slot local hour histogram (seconds). */
function addToHourHistogram(hist: number[], startMs: number, endMs: number): void {
  let t = startMs;
  let guard = 0;
  while (t < endMs && guard++ < 10000) {
    const d = new Date(t);
    let next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    if (next <= t) next = t + 3600 * 1000; // DST safety
    const segEnd = Math.min(next, endMs);
    hist[d.getHours()] += (segEnd - t) / 1000;
    t = segEnd;
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const APP_DISPLAY_NAMES: Record<string, string> = {
  msedge: 'Microsoft Edge',
  chrome: 'Google Chrome',
  firefox: 'Firefox',
  brave: 'Brave',
  opera: 'Opera',
  explorer: 'Dosya Gezgini',
  'whatsapp.root': 'WhatsApp',
  whatsapp: 'WhatsApp',
  code: 'VS Code',
  windowsterminal: 'Windows Terminal',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  codex: 'Codex',
  spotify: 'Spotify',
  discord: 'Discord',
  telegram: 'Telegram',
  terminal64: 'MetaTrader',
  tradingview: 'TradingView',
  winword: 'Word',
  excel: 'Excel',
  powerpnt: 'PowerPoint',
  obsidian: 'Obsidian',
  notion: 'Notion',
  phoneexperiencehost: 'Telefon Bağlantısı',
  applicationframehost: 'Windows Uygulaması',
  shellhost: 'Windows Kabuğu',
  shellexperiencehost: 'Windows Kabuğu',
  searchhost: 'Windows Arama',
  lockapp: 'Kilit Ekranı',
  electron: 'Electron',
};

/** Merge key for an app: lowercased, without the .exe/.app suffix. */
export function appKey(app: string): string {
  return String(app || '')
    .trim()
    .replace(/\.(exe|app)$/i, '')
    .toLowerCase();
}

function appDisplayName(rawApp: string): string {
  const key = appKey(rawApp);
  if (!key) return 'Bilinmeyen';
  if (APP_DISPLAY_NAMES[key]) return APP_DISPLAY_NAMES[key];
  return String(rawApp).trim().replace(/\.(exe|app)$/i, '');
}

const BROWSER_SUFFIX = /\s[-–—]\s(Microsoft Edge|Google Chrome|Mozilla Firefox|Firefox|Brave|Opera|Vivaldi|Chromium)$/i;
const MORE_PAGES = /\s(?:ve diğer \d+ sayfa|and \d+ more pages?)$/i;

/** Cleans browser chrome out of window titles so the same page merges across tabs/profiles. */
export function cleanTitle(title: string): string {
  let t = String(title || '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
  const m = BROWSER_SUFFIX.exec(t);
  if (m) {
    t = t.slice(0, m.index).trim();
    // Edge appends the profile name ("... - Kişisel - Microsoft Edge")
    if (/edge/i.test(m[1])) {
      const cut = t.lastIndexOf(' - ');
      if (cut > 0 && t.length - cut - 3 <= 24) t = t.slice(0, cut).trim();
    }
  }
  t = t.replace(MORE_PAGES, '').trim();
  return t;
}

export function domainOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return u.protocol.replace(':', '') || null;
    return u.hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimetrackStatus {
  available: boolean;
  version?: string;
  hostname?: string;
  buckets: string[];
  hasWebWatcher: boolean;
  url: string;
  reason?: string;
  message?: string;
}

export interface CategorySummary {
  id: number | null;
  name: string;
  color: string;
  sec: number;
  goalMinPerDay: number | null;
}

export interface TimetrackSummary {
  available: boolean;
  reason?: string;
  message?: string;
  url: string;
  range: { from: string; to: string };
  days: number;
  generatedAt: string;
  hasWebWatcher: boolean;
  totalActiveSec: number;
  notAfkSec: number;
  afkSec: number;
  byApp: Array<{ app: string; sec: number; category: string }>;
  byTitle: Array<{ app: string; title: string; sec: number; category: string }>;
  byCategory: CategorySummary[];
  byHour: Array<{ hour: number; sec: number }>;
  daily: Array<{ date: string; activeSec: number; byCategory: Record<string, number> }>;
  topSites: Array<{ domain: string; sec: number; category: string }>;
  firstActiveAt: string | null;
  lastActiveAt: string | null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function unavailableMessage(err: unknown): { reason: string; message: string } {
  if (err instanceof AwUnavailableError) {
    return {
      reason: 'unreachable',
      message: `ActivityWatch'a ulaşılamadı (${AW_BASE_URL}). Uygulamanın çalıştığından emin olun.`,
    };
  }
  return { reason: 'error', message: `ActivityWatch yanıtı işlenemedi: ${(err as any)?.message || String(err)}` };
}

async function loadBuckets(): Promise<{ info: { hostname?: string; version?: string }; resolved: ResolvedBuckets }> {
  const [info, buckets] = await Promise.all([getInfo().catch(() => ({} as any)), getBuckets()]);
  return { info, resolved: resolveBuckets(buckets, info?.hostname) };
}

export async function getStatus(): Promise<TimetrackStatus> {
  try {
    const { info, resolved } = await loadBuckets();
    return {
      available: true,
      version: info?.version,
      hostname: info?.hostname,
      buckets: resolved.all,
      hasWebWatcher: resolved.web.length > 0,
      url: AW_BASE_URL,
      ...(resolved.window ? {} : { reason: 'no_window_bucket', message: 'Pencere izleyicisi (aw-watcher-window) bulunamadı.' }),
    };
  } catch (err) {
    return { available: false, buckets: [], hasWebWatcher: false, url: AW_BASE_URL, ...unavailableMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Range resolution
// ---------------------------------------------------------------------------

export class RangeError400 extends Error {}

export function resolveRange(fromKey?: string | null, toKey?: string | null): { from: Date; to: Date; days: Date[] } {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let from = fromKey ? parseDateKey(fromKey) : todayStart;
  let to = toKey ? parseDateKey(toKey) : fromKey ? from : todayStart;
  if (!from || !to) throw new RangeError400('Tarihler YYYY-AA-GG biçiminde olmalı.');
  if (from > to) [from, to] = [to, from];
  if (to > todayStart) to = todayStart;
  if (from > to) from = to;
  const days: Date[] = [];
  for (let d = from; d <= to && days.length < MAX_RANGE_DAYS; d = addDays(d, 1)) days.push(d);
  if (days.length >= MAX_RANGE_DAYS) from = days[0];
  return { from: days[0], to: days[days.length - 1], days };
}

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

function buildQuery(b: ResolvedBuckets): string[] {
  const q = (s: string) => JSON.stringify(s);
  const lines: string[] = [];
  lines.push(`window = flood(query_bucket(${q(b.window!)}));`);
  if (b.afk) {
    lines.push(`afk = flood(query_bucket(${q(b.afk)}));`);
    lines.push('not_afk = filter_keyvals(afk, "status", ["not-afk"]);');
    lines.push('w = filter_period_intersect(window, not_afk);');
    lines.push('afk_totals = merge_events_by_keys(afk, ["status"]);');
  } else {
    lines.push('w = window;');
    lines.push('afk_totals = [];');
  }
  lines.push('titles = merge_events_by_keys(w, ["app", "title"]);');
  lines.push('active = period_union(w, []);');
  const webKeys: string[] = [];
  if (b.web.length > 0) {
    lines.push(`browser_w = filter_keyvals_regex(w, "app", ${q(BROWSER_APP_REGEX)});`);
    b.web.forEach((id, i) => {
      lines.push(`web${i} = flood(query_bucket(${q(id)}));`);
      lines.push(`web${i} = filter_period_intersect(web${i}, browser_w);`);
      lines.push(`web${i} = merge_events_by_keys(web${i}, ["url"]);`);
      webKeys.push(`"web${i}": web${i}`);
    });
  }
  lines.push(`RETURN = {"titles": titles, "active": active, "afk": afk_totals${webKeys.length ? `, ${webKeys.join(', ')}` : ''}};`);
  return lines;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; data: TimetrackSummary }>();
const inflight = new Map<string, Promise<TimetrackSummary>>();

export function clearSummaryCache(): void {
  cache.clear();
}

const round = (n: number) => Math.round(n);

function emptySummary(range: { from: string; to: string }, days: number, extra: Partial<TimetrackSummary>): TimetrackSummary {
  return {
    available: false,
    url: AW_BASE_URL,
    range,
    days,
    generatedAt: new Date().toISOString(),
    hasWebWatcher: false,
    totalActiveSec: 0,
    notAfkSec: 0,
    afkSec: 0,
    byApp: [],
    byTitle: [],
    byCategory: [],
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, sec: 0 })),
    daily: [],
    topSites: [],
    firstActiveAt: null,
    lastActiveAt: null,
    ...extra,
  };
}

export function aggregate(
  dayKeys: string[],
  dayBounds: Array<[number, number]>,
  results: any[],
  categories: Category[],
  hasWebWatcher: boolean,
): Omit<TimetrackSummary, 'available' | 'url' | 'range' | 'generatedAt'> {
  const classifier = createClassifier(categories);
  const catTotals = new Map<string, number>();
  const apps = new Map<string, { names: Map<string, number>; sec: number; cats: Map<string, number> }>();
  const titles = new Map<string, { app: string; title: string; sec: number; category: string }>();
  const sites = new Map<string, number>();
  const hours = new Array<number>(24).fill(0);
  const daily: TimetrackSummary['daily'] = [];
  let totalActive = 0;
  let afkSec = 0;
  let notAfkSec = 0;
  let firstMs = Infinity;
  let lastMs = -Infinity;

  results.forEach((res, i) => {
    const [dayStart, dayEnd] = dayBounds[i];
    const dayCats: Record<string, number> = {};
    let dayActive = 0;

    // Active periods (union of window ∩ not-afk), clipped to the day
    for (const ev of (res?.active || []) as AwEvent[]) {
      const s = Date.parse(ev.timestamp);
      if (!Number.isFinite(s)) continue;
      const start = Math.max(s, dayStart);
      const end = Math.min(s + Math.max(0, Number(ev.duration) || 0) * 1000, dayEnd);
      if (end <= start) continue;
      dayActive += (end - start) / 1000;
      addToHourHistogram(hours, start, end);
      if (start < firstMs) firstMs = start;
      if (end > lastMs) lastMs = end;
    }

    // Window titles (already merged by app+title for this day)
    for (const ev of (res?.titles || []) as AwEvent[]) {
      const sec = Math.max(0, Number(ev.duration) || 0);
      if (sec <= 0) continue;
      const rawApp = String(ev.data?.app ?? '');
      const rawTitle = String(ev.data?.title ?? '');
      const cat = classifier.classifyWindow(rawApp, rawTitle);
      catTotals.set(cat, (catTotals.get(cat) || 0) + sec);
      dayCats[cat] = (dayCats[cat] || 0) + sec;

      // Merge case/.exe variants and apps sharing a friendly name (e.g. Windows shell hosts)
      const key = appDisplayName(rawApp).toLocaleLowerCase('tr-TR');
      let a = apps.get(key);
      if (!a) {
        a = { names: new Map(), sec: 0, cats: new Map() };
        apps.set(key, a);
      }
      a.sec += sec;
      a.names.set(rawApp, (a.names.get(rawApp) || 0) + sec);
      a.cats.set(cat, (a.cats.get(cat) || 0) + sec);

      const title = cleanTitle(rawTitle) || '(başlıksız)';
      const tKey = `${key}\u0000${title.toLocaleLowerCase('tr-TR')}`;
      const t = titles.get(tKey);
      if (t) t.sec += sec;
      else titles.set(tKey, { app: appDisplayName(rawApp), title, sec, category: cat });
    }

    for (const ev of (res?.afk || []) as AwEvent[]) {
      const sec = Math.max(0, Number(ev.duration) || 0);
      if (ev.data?.status === 'afk') afkSec += sec;
      else if (ev.data?.status === 'not-afk') notAfkSec += sec;
    }

    for (const [k, v] of Object.entries(res || {})) {
      if (!k.startsWith('web') || !Array.isArray(v)) continue;
      for (const ev of v as AwEvent[]) {
        const domain = domainOf(String(ev.data?.url ?? ''));
        if (!domain) continue;
        sites.set(domain, (sites.get(domain) || 0) + Math.max(0, Number(ev.duration) || 0));
      }
    }

    totalActive += dayActive;
    const roundedCats: Record<string, number> = {};
    for (const [k, v] of Object.entries(dayCats)) roundedCats[k] = round(v);
    daily.push({ date: dayKeys[i], activeSec: round(dayActive), byCategory: roundedCats });
  });

  const byApp = [...apps.values()]
    .sort((a, b) => b.sec - a.sec)
    .slice(0, TOP_N)
    .map((a) => {
      const topName = [...a.names.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '';
      const topCat = [...a.cats.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || classifier.fallbackName;
      return { app: appDisplayName(topName), sec: round(a.sec), category: topCat };
    });

  const byTitle = [...titles.values()]
    .sort((a, b) => b.sec - a.sec)
    .slice(0, TOP_N)
    .map((t) => ({ ...t, sec: round(t.sec) }));

  const byCategory: CategorySummary[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    sec: round(catTotals.get(c.name) || 0),
    goalMinPerDay: c.goalMinPerDay,
  }));
  if (!categories.some((c) => c.name === classifier.fallbackName)) {
    byCategory.push({ id: null, name: FALLBACK_NAME, color: FALLBACK_COLOR, sec: round(catTotals.get(FALLBACK_NAME) || 0), goalMinPerDay: null });
  }

  const topSites = [...sites.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([domain, sec]) => ({ domain, sec: round(sec), category: classifier.classifyDomain(domain) }));

  return {
    days: dayKeys.length,
    hasWebWatcher,
    totalActiveSec: round(totalActive),
    notAfkSec: round(notAfkSec),
    afkSec: round(afkSec),
    byApp,
    byTitle,
    byCategory,
    byHour: hours.map((sec, hour) => ({ hour, sec: round(sec) })),
    daily,
    topSites,
    firstActiveAt: Number.isFinite(firstMs) ? new Date(firstMs).toISOString() : null,
    lastActiveAt: Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : null,
  };
}

async function computeSummary(fromKey?: string | null, toKey?: string | null): Promise<TimetrackSummary> {
  const { days } = resolveRange(fromKey, toKey);
  const dayKeys = days.map(localDateKey);
  const range = { from: dayKeys[0], to: dayKeys[dayKeys.length - 1] };
  const dayBounds: Array<[number, number]> = days.map((d) => [d.getTime(), addDays(d, 1).getTime()]);

  let resolved: ResolvedBuckets;
  try {
    resolved = (await loadBuckets()).resolved;
  } catch (err) {
    return emptySummary(range, dayKeys.length, unavailableMessage(err));
  }
  if (!resolved.window) {
    return emptySummary(range, dayKeys.length, {
      reason: 'no_window_bucket',
      message: 'ActivityWatch çalışıyor ancak pencere izleyicisi (aw-watcher-window) verisi bulunamadı.',
      hasWebWatcher: resolved.web.length > 0,
    });
  }

  const timeperiods = days.map((d) => `${toLocalIso(d)}/${toLocalIso(addDays(d, 1))}`);
  let results: any[];
  try {
    results = await runQuery(buildQuery(resolved), timeperiods);
  } catch (err) {
    console.error('[TimeTrack] query failed:', (err as any)?.message || err);
    return emptySummary(range, dayKeys.length, unavailableMessage(err));
  }

  const agg = aggregate(dayKeys, dayBounds, results, getCategories(), resolved.web.length > 0);
  return {
    available: true,
    url: AW_BASE_URL,
    range,
    generatedAt: new Date().toISOString(),
    ...agg,
  };
}

/** Cached (20 s) summary for an inclusive local date range. Never throws for ActivityWatch errors. */
export async function getSummary(fromKey?: string | null, toKey?: string | null): Promise<TimetrackSummary> {
  const { from, to } = resolveRange(fromKey, toKey); // throws RangeError400 on bad input
  const key = `${localDateKey(from)}|${localDateKey(to)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  let p = inflight.get(key);
  if (!p) {
    p = computeSummary(localDateKey(from), localDateKey(to)).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  const data = await p;
  if (cache.size > 50) {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
    if (cache.size > 50) cache.clear();
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}
