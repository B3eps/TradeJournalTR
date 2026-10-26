/**
 * Fetches every news source once (read-only, no DB writes) and prints item
 * counts, an importance histogram and a few samples per source.
 *   npx tsx server/scripts/check-news-sources.ts [--samples=3] [--all]
 */
import { NEWS_SOURCES } from '../src/services/newsfeed/sources';
import { fetchSourceItems, normalizeItem } from '../src/services/newsfeed';

const samples = Number(process.argv.find((a) => a.startsWith('--samples='))?.split('=')[1] ?? 3);
const showAll = process.argv.includes('--all');

async function main() {
  const total = [0, 0, 0, 0];
  const results = await Promise.all(NEWS_SOURCES.map(async (src) => {
    const t0 = Date.now();
    try {
      const raw = (await fetchSourceItems(src)) ?? [];
      const items = raw.map((r) => normalizeItem(src, r)).filter((x): x is NonNullable<typeof x> => !!x);
      return { src, ok: true, ms: Date.now() - t0, raw: raw.length, items };
    } catch (err: any) {
      return { src, ok: false, ms: Date.now() - t0, raw: 0, items: [], error: String(err?.message || err) };
    }
  }));

  for (const r of results) {
    const hist = [0, 0, 0, 0];
    r.items.forEach((i) => { hist[i.importance]++; total[i.importance]++; });
    console.log(`\n${r.ok ? 'OK  ' : 'FAIL'} ${r.src.id.padEnd(14)} ${r.src.category.padEnd(7)} raw=${r.raw} kept=${r.items.length} ${r.ms}ms hist[0..3]=${hist.join('/')}${r.ok ? '' : ` error=${(r as any).error}`}`);
    const list = showAll ? r.items : [...r.items].sort((a, b) => b.importance - a.importance).slice(0, samples);
    for (const i of list) {
      console.log(`   [${i.importance}] ${i.title.slice(0, 110)}  {${i.tags.join(',')}} <${i.instruments.join(',')}>`);
    }
  }
  console.log(`\nTOTAL importance histogram 0/1/2/3 = ${total.join('/')}`);
  const okCats = new Map<string, number>();
  results.filter((r) => r.ok).forEach((r) => okCats.set(r.src.category, (okCats.get(r.src.category) ?? 0) + 1));
  console.log('Working sources per category:', Object.fromEntries(okCats));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
