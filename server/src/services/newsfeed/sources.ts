import { parseFeed, toPlainText, type RawFeedItem } from './feed-parser';

export type NewsCategory = 'forex' | 'nasdaq' | 'crypto' | 'metals';
export const NEWS_CATEGORIES: NewsCategory[] = ['forex', 'nasdaq', 'crypto', 'metals'];

export interface NewsSource {
  id: string;
  name: string;
  category: NewsCategory;
  url: string;
  /** body text -> raw items. Throws on an unexpected payload. */
  parser: (body: string) => RawFeedItem[];
}

// Sent with every request. SEC EDGAR requires a contact string in the
// User-Agent (https://www.sec.gov/os/accessing-edgar-data); set
// NEWS_FEED_CONTACT to your own e-mail to comply.
export function userAgent(): string {
  const contact = process.env.NEWS_FEED_CONTACT || 'tradegunlugu-local@example.invalid';
  return `TradeGunlugu-NewsFeed/1.0 (personal trading journal; ${contact})`;
}

const rss = (body: string) => {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(body)) throw new Error('not an RSS/Atom document');
  return parseFeed(body);
};

// --- SEC EDGAR current 8-K feed, reduced to a mega-cap watchlist (by CIK) ---
export const SEC_WATCHLIST: Record<string, string> = {
  '320193': 'AAPL', '789019': 'MSFT', '1045810': 'NVDA', '1018724': 'AMZN',
  '1652044': 'GOOGL', '1326801': 'META', '1318605': 'TSLA', '1730168': 'AVGO',
  '1065280': 'NFLX', '2488': 'AMD', '50863': 'INTC', '909832': 'COST',
  '796343': 'ADBE', '804328': 'QCOM', '858877': 'CSCO', '1321655': 'PLTR',
  '1050446': 'MSTR', '1679788': 'COIN', '77476': 'PEP', '1166691': 'CMCSA',
};

export function parseSec8k(body: string, watchlistOnly = true): RawFeedItem[] {
  const out: RawFeedItem[] = [];
  for (const it of rss(body)) {
    // "8-K - Apple Inc. (0000320193) (Filer)"
    const m = it.title.match(/^\s*(8-K(?:\/A)?)\s*-\s*(.+?)\s*\((\d{4,10})\)/);
    if (!m) continue;
    const cik = String(parseInt(m[3], 10));
    const ticker = SEC_WATCHLIST[cik];
    if (watchlistOnly && !ticker) continue;
    const itemNames = [...it.summary.matchAll(/Item\s+(\d+\.\d+):\s*(.+?)(?=\s+Item\s+\d+\.\d+:|$)/g)]
      .map((x) => ({ code: x[1], name: x[2].trim() }));
    const company = ticker ? `${m[2]} (${ticker})` : m[2];
    const what = itemNames.length ? itemNames.map((x) => x.name).join('; ') : 'filing';
    out.push({
      ...it,
      title: `${m[1]} ${company}: ${what}`,
      summary: itemNames.map((x) => `Item ${x.code}: ${x.name}`).join(' · '),
    });
  }
  return out;
}

// --- Binance announcements (public CMS JSON used by binance.com itself) ---
const BINANCE_CATALOGS = new Set([48, 49, 161]); // new listing, latest news, delisting
export function parseBinance(body: string): RawFeedItem[] {
  const json = JSON.parse(body);
  const catalogs = json?.data?.catalogs;
  if (!Array.isArray(catalogs)) throw new Error('unexpected Binance payload');
  const out: RawFeedItem[] = [];
  for (const cat of catalogs) {
    if (!BINANCE_CATALOGS.has(Number(cat?.catalogId))) continue;
    for (const a of Array.isArray(cat.articles) ? cat.articles : []) {
      if (!a?.code || !a?.title) continue;
      const ts = Number(a.releaseDate);
      out.push({
        title: toPlainText(String(a.title)),
        url: `https://www.binance.com/en/support/announcement/detail/${encodeURIComponent(String(a.code))}`,
        summary: `${String(cat.catalogName || 'Binance')} duyurusu`,
        publishedAt: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null,
      });
    }
  }
  return out;
}

// Adding a source = one line here. Verified reachable 2026-10-25.
export const NEWS_SOURCES: NewsSource[] = [
  { id: 'fxstreet', name: 'FXStreet', category: 'forex', url: 'https://www.fxstreet.com/rss/news', parser: rss },
  { id: 'investinglive', name: 'investingLive (ForexLive)', category: 'forex', url: 'https://investinglive.com/feed/news', parser: rss },
  { id: 'fed', name: 'Federal Reserve', category: 'forex', url: 'https://www.federalreserve.gov/feeds/press_all.xml', parser: rss },
  { id: 'ecb', name: 'ECB', category: 'forex', url: 'https://www.ecb.europa.eu/rss/press.html', parser: rss },
  { id: 'bls-cpi', name: 'U.S. Bureau of Labor Statistics · CPI', category: 'forex', url: 'https://www.bls.gov/feed/cpi.rss', parser: rss },
  { id: 'bea', name: 'U.S. Bureau of Economic Analysis', category: 'forex', url: 'https://apps.bea.gov/rss/rss.xml', parser: rss },
  { id: 'cme-metals', name: 'CME Group · Metals', category: 'metals', url: 'https://www.cmegroup.com/rss/metals-video-commentary.rss', parser: rss },
  { id: 'cnbc', name: 'CNBC', category: 'nasdaq', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', parser: rss },
  { id: 'cnbc-tech', name: 'CNBC Tech', category: 'nasdaq', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', parser: rss },
  { id: 'marketwatch', name: 'MarketWatch', category: 'nasdaq', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', parser: rss },
  { id: 'sec-8k', name: 'SEC EDGAR 8-K', category: 'nasdaq', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&start=0&count=100&output=atom', parser: (b) => parseSec8k(b) },
  { id: 'coindesk', name: 'CoinDesk', category: 'crypto', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', parser: rss },
  { id: 'cointelegraph', name: 'Cointelegraph', category: 'crypto', url: 'https://cointelegraph.com/rss', parser: rss },
  { id: 'theblock', name: 'The Block', category: 'crypto', url: 'https://www.theblock.co/rss.xml', parser: rss },
  { id: 'binance', name: 'Binance Duyuruları', category: 'crypto', url: 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=10', parser: parseBinance },
];
