import type { NewsCategory } from './sources';

/**
 * Deterministic, local importance scoring (0-3) plus tag / instrument
 * inference. Everything is driven by the tables below; tune them freely.
 *
 *  3 critical  · 2 important  · 1 normal (default)  · 0 filler
 *
 * Score rules are matched against the title. The final importance is the
 * highest matching score; FILLER rules (score 0) only win when nothing scored
 * 2 or higher. Tag/instrument rules look at title + the start of the summary.
 */

export interface ScoreRule {
  match: RegExp;
  score: 0 | 1 | 2 | 3;
  tags?: string[];
  instruments?: string[];
  /** Rule only fires when this also matches. */
  require?: RegExp;
  /** Rule is skipped when this matches (e.g. speculative wording). */
  unless?: RegExp;
  /** Restrict to these source ids / categories. */
  sources?: string[];
  categories?: NewsCategory[];
}

const SPECULATIVE = /\b(says|said|sees|expects?|expected to|signals?|warns?|hints?|odds|pricing|priced|bets?|preview|ahead|ahead of|likely|could|may|might|would|if|whether|calls? for|wants?|urges?|before|looms?|awaits?|eyes|turns? to|heads up|case for|to test|dilemma|debate|path|outlook|upcoming|countdown|speculation|chatter)\b|\?/i;
const RELEASE = /(\d(\.\d+)?\s?%|\by\/y\b|\bm\/m\b|\byoy\b|\bmom\b|\bactual\b|\bvs\.?\b|\bexpected\b|\bestimates?\b|\bconsensus\b|\bbeats?\b|\bmiss(es|ed)?\b|\b(rises?|rose|falls?|fell|jumps?|slows?|cools?|accelerates?|surges?|drops?|climbs?|eases?|hotter|softer|stronger|weaker)\b)/i;
// >= $50M (hacks) / >= $100M (liquidations)
const BIG_MONEY = /\$\s?(\d+(\.\d+)?\s?(b|bn|billion)|([5-9]\d|\d{3,})(\.\d+)?\s?(m|mn|million))\b|\b\d+(\.\d+)?\s?billion\b/i;
const HUGE_MONEY = /\$\s?(\d+(\.\d+)?\s?(b|bn|billion)|\d{3,}(\.\d+)?\s?(m|mn|million))\b|\b\d+(\.\d+)?\s?billion\b/i;
const CENTRAL_BANK = /\b(fed(eral reserve)?|FOMC|ECB|BoE|bank of england|BoJ|bank of japan|SNB|RBA|BoC|bank of canada|RBNZ|PBoC|CBRT|TCMB)\b/i;
const MAJOR_EXCHANGE = /\b(binance|coinbase|kraken|okx|bybit|bitfinex|kucoin|gemini|upbit|bithumb|robinhood|htx|bitget|crypto\.com)\b/i;
// not part of a trading pair such as "ABC/BTC"
const MAJOR_COIN = /(?<![\/\w])(BTC|bitcoin|ETH|ether(eum)?|SOL|solana|XRP|BNB|USDT|tether|USDC|DOGE|dogecoin)(?![\/\w])/i;

// [ticker, name pattern] — mega-cap / heavily traded Nasdaq names
export const MEGACAPS: Array<[string, string]> = [
  ['AAPL', 'apple'], ['MSFT', 'microsoft'], ['NVDA', 'nvidia'], ['AMZN', 'amazon'],
  ['GOOGL', 'alphabet|google'], ['META', 'meta platforms|meta|facebook'], ['TSLA', 'tesla'],
  ['AVGO', 'broadcom'], ['NFLX', 'netflix'], ['AMD', 'amd|advanced micro devices'],
  ['INTC', 'intel'], ['COST', 'costco'], ['ADBE', 'adobe'], ['QCOM', 'qualcomm'],
  ['CSCO', 'cisco'], ['PLTR', 'palantir'], ['MSTR', 'microstrategy'], ['COIN', 'coinbase'],
  ['PEP', 'pepsico'], ['CMCSA', 'comcast'], ['ASML', 'asml'], ['TSM', 'tsmc|taiwan semiconductor'],
];
const MEGACAP_RE = new RegExp(
  `\\b(${MEGACAPS.map(([t, n]) => `${t}|${n}`).join('|')})\\b`, 'i');

const FED_PEOPLE = 'powell|warsh|hassett|waller|john williams|jefferson|bowman|michael barr|goolsbee|daly|lorie logan|hammack|musalem|schmid|kashkari|bostic|harker|lisa cook|miran|anna paulson|susan collins|barkin|fomc member|fed official|fed governor|fed president|fed chair|fed[’\\x27]s';
const ECB_PEOPLE = 'lagarde|schnabel|philip lane|nagel|villeroy|cipollone|de guindos|kazaks|holzmann|rehn|knot|centeno|stournaras|wunsch|kocher|escriva|madis muller|panetta|makhlouf|vujcic|simkus|ecb official|ecb member|ecb[’\\x27]s';
const BOE_PEOPLE = 'bailey|huw pill|lombardelli|megan greene|catherine mann|dhingra|alan taylor|breeden|ramsden|boe official|boe[’\\x27]s';
const BOJ_PEOPLE = 'ueda|himino|uchida|tamura|takata|nakagawa|noguchi|boj official|boj[’\\x27]s';

export const SCORE_RULES: ScoreRule[] = [
  // --- central banks: decisions, statements, minutes ---
  { match: /\b(issues FOMC statement|minutes of the federal open market committee|monetary policy decisions?)\b/i, sources: ['fed', 'ecb'], score: 3, tags: ['RATES'] },
  { match: /\b(FOMC statement|FOMC minutes|minutes of the (federal open market committee|FOMC)|monetary policy decisions?|rate decision|interest rate decision)\b/i, unless: SPECULATIVE, score: 3, tags: ['RATES'] },
  { match: CENTRAL_BANK, require: /\b(raises?|cuts?|hikes?|lowers?|holds?|keeps?|leaves?|unchanged|basis points?|bps|pauses?)\b/i, unless: SPECULATIVE, score: 3, tags: ['RATES'] },
  { match: CENTRAL_BANK, require: /\b(rates?|hikes?|cuts?|policy|decision|minutes|statement|easing|tightening|QE|QT|balance sheet)\b/i, score: 2, tags: ['RATES'] },
  { match: /\bemergency (rate|meeting|cut|hike|action|liquidity|lending|facility)\b|\b(intervene[sd]?|intervention|intervening)\b/i, unless: SPECULATIVE, score: 3, tags: ['EMERGENCY'] },
  { match: /\b(intervene[sd]?|intervention|intervening)\b/i, score: 2, tags: ['INTERVENTION'] },
  { match: /\bmonetary policy (report|account|statement)|economic projections|summary of economic projections|beige book|testimony|press conference\b/i, score: 2, tags: ['RATES'] },
  // --- central-bank speakers ---
  { match: new RegExp(`\\b(${FED_PEOPLE})\\b`, 'i'), score: 2, tags: ['CB_SPEECH'], instruments: ['USD'] },
  { match: new RegExp(`\\b(${ECB_PEOPLE})\\b`, 'i'), score: 2, tags: ['CB_SPEECH', 'ECB'], instruments: ['EUR'] },
  { match: new RegExp(`\\b(${BOE_PEOPLE})\\b`, 'i'), score: 2, tags: ['CB_SPEECH', 'BOE'], instruments: ['GBP'], require: /\b(boe|bank of england|uk|gbp|pound|sterling|mpc|rates?|inflation)\b/i },
  { match: new RegExp(`\\b(${BOJ_PEOPLE})\\b`, 'i'), score: 2, tags: ['CB_SPEECH', 'BOJ'], instruments: ['JPY'] },
  { match: /:\s*(speech|interview|remarks|introductory statement|hearing)\b|\b(speech|speaks|interview with|remarks)\b/i, sources: ['ecb', 'fed'], score: 2, tags: ['CB_SPEECH'] },
  { match: /^[A-Z][\w.' -]{2,40}:\s/, sources: ['ecb'], score: 2, tags: ['CB_SPEECH'] }, // "Name: speech title"
  { match: /\b(promotion|giveaway|campaign|competition|earn up to|limited-time offers?|rewards?|trading tournament)\b/i, sources: ['binance'], score: 0 },
  // --- tier-1 macro data ---
  { match: /\b(CPI|consumer price|PCE|core inflation|inflation rate)\b/i, require: RELEASE, unless: /\b(ahead of|preview|expected to|could|may|will)\b/i, score: 3, tags: ['CPI'] },
  { match: /\b(nonfarm|non-farm|payrolls|NFP|jobs report)\b/i, require: RELEASE, unless: /\b(ahead of|preview|expected to|could|may|will)\b/i, score: 3, tags: ['NFP'] },
  { match: /\bGDP\b/i, require: RELEASE, unless: /\b(ahead of|preview|expected to|could|may|will|nowcast)\b/i, score: 3, tags: ['GDP'] },
  { match: /\b(CPI|consumer price|PCE|inflation)\b/i, score: 2, tags: ['CPI'] },
  { match: /\b(nonfarm|non-farm|payrolls|NFP|jobs report|unemployment rate)\b/i, score: 2, tags: ['NFP'] },
  { match: /\bGDP\b/i, score: 2, tags: ['GDP'] },
  // --- tier-2 macro data ---
  { match: /\b(PMI|ISM)\b/i, score: 2, tags: ['PMI'] },
  { match: /\bretail sales\b/i, score: 2, tags: ['RETAIL_SALES'] },
  { match: /\b(jobless claims|initial claims|continuing claims|JOLTS|ADP)\b/i, score: 2, tags: ['JOBS'] },
  { match: /\b(PPI|producer price)\b/i, score: 2, tags: ['PPI'] },
  { match: /\b(consumer confidence|consumer sentiment|ifo|zew|tankan)\b/i, score: 2, tags: ['SENTIMENT'] },
  // --- geopolitics, trade, credit events ---
  { match: /\b(invasion|invades?|airstrikes?|missile (strike|attack)s?|declares? war|military strike|nuclear test|martial law|coup)\b/i, score: 3, tags: ['GEOPOLITICS'] },
  { match: /\bsanctions?\b/i, require: /\b(new|imposes?|imposed|announces?|announced|expands?|expanded|tightens?|sweeping)\b/i, score: 3, tags: ['SANCTIONS'] },
  { match: /\b(war|conflict|geopolitic\w*|ceasefire|sanctions?)\b/i, score: 2, tags: ['GEOPOLITICS'] },
  { match: /\b(tariffs?|trade war|trade deal|export controls?)\b/i, score: 2, tags: ['TARIFF'] },
  { match: /\b(military|strikes? on|attacks?|operation against|missiles?|troops|escalat\w*|evacuations?)\b/i, score: 2, tags: ['GEOPOLITICS'], categories: ['forex', 'nasdaq'] },
  { match: /\b(bankrupt\w*|chapter 11|insolven\w*|receivership)\b|\bdefault(s|ed)? on\b/i, score: 3, tags: ['BANKRUPTCY'] },
  { match: /\b(shutdown|debt ceiling|downgrades? (the )?(us|u\.s\.) (credit|rating)|credit rating)\b/i, score: 2, tags: ['FISCAL'] },
  // --- equities ---
  { match: MEGACAP_RE, require: /\b(earnings|results|revenue|guidance|quarter(ly)?|Q[1-4]|beats?|miss(es)?|outlook|forecast|profit)\b/i, unless: /\b(rearview|chatter|ahead of|preview|what to (expect|watch)|before|week ahead|could|may|might|how to|should you)\b|\?/i, score: 3, tags: ['EARNINGS'], categories: ['nasdaq'] },
  { match: MEGACAP_RE, require: /\b(earnings|results|revenue|guidance)\b/i, score: 2, tags: ['EARNINGS'], categories: ['nasdaq'] },
  { match: /\bResults of Operations and Financial Condition\b/i, require: MEGACAP_RE, sources: ['sec-8k'], score: 3, tags: ['EARNINGS'] },
  { match: /\b(Departure of Directors|Entry into a Material Definitive Agreement|Completion of Acquisition|Material Impairments|Termination of a Material|Changes in Registrant|Non-Reliance)\b/i, sources: ['sec-8k'], score: 2, tags: ['FILING'] },
  { match: /\b(earnings|quarterly results|guidance)\b/i, score: 1, tags: ['EARNINGS'] },
  { match: /\b(upgrade[sd]?|downgrade[sd]?)\b/i, score: 2, tags: ['RATING'] },
  { match: MEGACAP_RE, require: /\b(antitrust|DOJ|FTC|EU fine|lawsuit|probe|ruling|ban)\b/i, score: 2, tags: ['REGULATION'] },
  { match: /\b(stock split|buyback|acquire[sd]?|acquisition|merger|takeover)\b/i, score: 1, tags: ['M&A'] },
  // --- crypto ---
  { match: /\b(hack(ed|ers?)?|exploit(ed)?|drained|stolen|breach)\b/i, require: new RegExp(`${MAJOR_EXCHANGE.source}|${BIG_MONEY.source}`, 'i'), score: 3, tags: ['HACK'] },
  { match: /\b(hack(ed|ers?)?|exploit(ed)?|drained|stolen|breach)\b/i, score: 2, tags: ['HACK'], categories: ['crypto'] },
  { match: /\b(suspends?|halts?|halted|paus(es|ed)|freezes?|frozen)\b.*\b(withdrawals?|deposits?|trading)\b|\b(withdrawals?|trading) (halted|suspended|paused)\b/i, score: 3, tags: ['HALT'] },
  { match: /\bdelist\w*|will remove\b/i, require: MAJOR_COIN, score: 3, tags: ['DELISTING'], categories: ['crypto'] },
  { match: /\bdelist\w*|will remove\b|\bdelisting\b/i, score: 2, tags: ['DELISTING'], categories: ['crypto'] },
  { match: /\bETFs?\b/i, require: /\b(approv\w*|reject\w*|denie[sd]|denial|green.?light|withdraw[sn]?)\b/i, unless: /\b(could|may|might|odds|expects?|likely|seeks?)\b|\?/i, score: 3, tags: ['ETF'] },
  { match: /\bETFs?\b/i, score: 2, tags: ['ETF'], categories: ['crypto'] },
  { match: /\b(SEC|CFTC|DOJ|department of justice|FinCEN|OFAC)\b/i, require: /\b(sues?|sued|charges?|charged|lawsuit|wells notice|settles?|settled|settlement|indict\w*|fined?|enforcement|subpoena\w*)\b/i, score: 3, tags: ['ENFORCEMENT'], categories: ['crypto'] },
  { match: /\b(regulat\w*|legislation|MiCA|stablecoin (bill|law|rules)|crypto bill|market structure bill|CLARITY Act|GENIUS Act|SEC chair|CFTC|senate (bill|vote|committee|banking))\b/i, score: 2, tags: ['REGULATION'], categories: ['crypto'] },
  { match: /\bliquidat\w*/i, require: new RegExp(`${HUGE_MONEY.source}|\\b(record|massive|wipe[sd]? out)\\b`, 'i'), score: 2, tags: ['LIQUIDATION'], categories: ['crypto'] },
  { match: /\bliquidat\w*/i, score: 1, tags: ['LIQUIDATION'], categories: ['crypto'] },
  { match: /\b(longs|shorts|traders) (lose|lost|liquidated|wiped)\b/i, require: HUGE_MONEY, score: 2, tags: ['LIQUIDATION'], categories: ['crypto'] },
  { match: new RegExp(`${MAJOR_EXCHANGE.source}|\\b(tether|circle|stablecoin issuer)\\b`, 'i'), require: /\b(fine[sd]?|fines|penalt\w*|licen[cs]e[sd]?|bans?|banned|probes?|investigat\w*|sues?|sued|charges?|charged)\b/i, score: 2, tags: ['REGULATION'], categories: ['crypto'] },
  { match: /\b(will list|lists|new listing|launchpool|launchpad|hodler airdrops?)\b/i, score: 2, tags: ['LISTING'], categories: ['crypto'] },
  { match: /\bperpetual contracts?\b|\bmargin\b|\bcollateral\b/i, sources: ['binance'], score: 1, tags: ['LISTING'] },
  { match: /\b(strategic (bitcoin )?reserve|treasury (company|firm)|buys? \$?[\d,.]+\s?(million|billion|m|b)? (worth of )?(bitcoin|btc|eth))\b/i, score: 2, tags: ['ADOPTION'], categories: ['crypto'] },
  // --- filler (wins only when nothing scored >= 2) ---
  { match: /\b(how to|what is|what are|explained|explainer|beginners?|guide (to|for)|tutorial|top \d+|\d+ (best|things|ways|reasons|stocks|cryptos?|coins?|altcoins)|price predictions?|opinion|podcast|webinar|quiz|sponsored|giveaway|newsletter|week ahead|weekly recap|the week in|recap|should i|dear |my (wife|husband|mother|father|mom|dad|son|daughter|father-in-law|mother-in-law|sister|brother)|i'm \d+|i am \d+|retire\w*|horoscope|coupon|review:|best .* (to buy|for))\b/i, score: 0, tags: [] },
  { match: /\bI (want|have|need|inherited|just|was|am|can)\b|\bmy (step\w+|\w+-in-law|parents|kids|children|boyfriend|girlfriend|partner|fianc\w+|landlord|employer|boss|ex)\b|\bis (she|he|this|it) (possible|fair|right|taking)\b|\bdon[’']t hold your breath\b/i, categories: ['nasdaq'], score: 0 },
  { match: /\b(termination of enforcement action|enforcement actions? with|announces? (approval|application)|agenda|holiday|maintenance|scheduled system upgrade)\b/i, sources: ['fed', 'binance'], score: 0 },
];

export interface InstrumentRule { match: RegExp; instruments: string[]; tags?: string[]; sources?: string[] }

export const INSTRUMENT_RULES: InstrumentRule[] = [
  { match: /./, sources: ['fed'], instruments: ['USD'] },
  { match: /./, sources: ['ecb'], instruments: ['EUR'], tags: ['ECB'] },
  { match: /\b(fed|fomc|federal reserve|powell|warsh|treasur(y|ies)|dollar|DXY|greenback|nonfarm|payrolls|NFP|wall street|U\.?S\.? (cpi|gdp|jobs|inflation|retail sales|pmi|yields?|economy|data))\b/i, instruments: ['USD'] },
  { match: /\bFOMC\b/i, instruments: ['USD'], tags: ['FOMC'] },
  { match: /\b(US|U\.S\.)(?=\s)/, instruments: ['USD'] },
  { match: /\b(ECB|lagarde|euro(zone| area)?|EUR|germany|german|bunds?|european central bank)\b/i, instruments: ['EUR'] },
  { match: /\b(ECB|european central bank)\b/i, instruments: [], tags: ['ECB'] },
  { match: /\b(BoE|bank of england|pound|sterling|GBP|UK|britain|british|gilts?)\b/i, instruments: ['GBP'] },
  { match: /\b(BoE|bank of england)\b/i, instruments: [], tags: ['BOE'] },
  { match: /\b(BoJ|bank of japan|yen|JPY|japan(ese)?|JGBs?)\b/i, instruments: ['JPY'] },
  { match: /\b(BoJ|bank of japan)\b/i, instruments: [], tags: ['BOJ'] },
  { match: /\b(SNB|swiss franc|CHF|switzerland|swiss)\b/i, instruments: ['CHF'] },
  { match: /\b(RBA|aussie|AUD|australia\w*)\b/i, instruments: ['AUD'] },
  { match: /\b(BoC|bank of canada|loonie|CAD|canad\w*)\b/i, instruments: ['CAD'] },
  { match: /\b(RBNZ|kiwi|NZD|new zealand)\b/i, instruments: ['NZD'] },
  { match: /\b(yuan|renminbi|CNY|CNH|PBoC|china|chinese)\b/i, instruments: ['CNH'] },
  { match: /\b(lira|turkey|turkish|CBRT|TCMB)\b|türkiye/i, instruments: ['TRY'] },
  { match: /\bTRY\b/, instruments: ['TRY'] },
  { match: /\b(gold|XAU|bullion)\b/i, instruments: ['XAU'] },
  { match: /\b(silver|XAG)\b/i, instruments: ['XAG'] },
  { match: /\b(oil|crude|WTI|brent|OPEC\+?)\b/i, instruments: ['WTI'] },
  { match: /\b(nasdaq|tech stocks|QQQ|NQ|big tech|magnificent seven|mag ?7|semiconductors?|chip ?makers?|chip stocks)\b/i, instruments: ['NQ', 'QQQ'] },
  { match: /\b(S&P 500|S&P|SPX|SPY|ES futures|stock futures|stock market|wall street)\b/i, instruments: ['SPX'] },
  { match: /\b(bitcoin|BTC)\b/i, instruments: ['BTC'], tags: ['BTC'] },
  { match: /\b(ether(eum)?|ETH)\b/i, instruments: ['ETH'], tags: ['ETH'] },
  { match: /\b([Ss]olana|SOLANA|SOL)\b/, instruments: ['SOL'] },
  { match: /\b(XRP|ripple)\b/i, instruments: ['XRP'] },
  { match: /\bBNB\b/, instruments: ['BNB'] },
  { match: /\b(dogecoin|DOGE)\b/i, instruments: ['DOGE'] },
  { match: /\b(stablecoins?|USDT|tether|USDC)\b/i, instruments: [], tags: ['STABLECOIN'] },
  // tickers case-sensitive, company names case-insensitive
  ...MEGACAPS.flatMap(([t, n]): InstrumentRule[] => [
    { match: new RegExp(`\\b${t}\\b`), instruments: [t, 'NQ'] },
    { match: new RegExp(`\\b(${n})\\b`, 'i'), instruments: [t, 'NQ'] },
  ]),
];

const CCY = 'EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF|XAU|XAG|CNH|TRY';
const PAIR_RE = new RegExp(`\\b(${CCY})\\s?\\/\\s?(${CCY})\\b`, 'g');

export interface ScoreResult { importance: number; tags: string[]; instruments: string[] }

export function scoreItem(input: { title: string; summary: string; sourceId: string; category: NewsCategory }): ScoreResult {
  const title = input.title;
  const text = `${input.title} ${input.summary.slice(0, 240)}`;
  const tags = new Set<string>();
  const instruments = new Set<string>();
  let best = -1;
  let filler = false;

  for (const r of SCORE_RULES) {
    if (r.sources && !r.sources.includes(input.sourceId)) continue;
    if (r.categories && !r.categories.includes(input.category)) continue;
    if (!r.match.test(title)) continue;
    if (r.require && !r.require.test(title)) continue;
    if (r.unless && r.unless.test(title)) continue;
    if (r.score === 0) { filler = true; continue; }
    if (r.score > best) best = r.score;
    r.tags?.forEach((t) => tags.add(t));
    r.instruments?.forEach((i) => instruments.add(i));
  }

  let importance = best < 0 ? 1 : best;
  if (filler && importance < 2) importance = 0;

  for (const r of INSTRUMENT_RULES) {
    if (r.sources && !r.sources.includes(input.sourceId)) continue;
    if (!r.match.test(text)) continue;
    r.instruments.forEach((i) => instruments.add(i));
    r.tags?.forEach((t) => tags.add(t));
  }
  for (const m of text.toUpperCase().matchAll(PAIR_RE)) {
    instruments.add(m[1] + m[2]);
    instruments.add(m[1]);
    instruments.add(m[2]);
  }
  if (input.category === 'metals') {
    instruments.add('XAU');
    instruments.add('XAG');
  }
  if (instruments.has('XAU') || instruments.has('XAG')) importance = Math.max(2, importance);
  if (tags.has('RATES') && instruments.has('USD') && /\b(fed|fomc|federal reserve)\b/i.test(title)) tags.add('FOMC');

  // Major USD/macro and geopolitical releases can affect both precious metals;
  // the evaluator decides whether the effect is actually directional or uncertain.
  const metalRelevantTags = ['RATES', 'CPI', 'NFP', 'GDP', 'PPI', 'JOBS', 'PMI', 'GEOPOLITICS', 'TARIFF', 'SANCTIONS'];
  if (importance >= 2 && (instruments.has('USD') || metalRelevantTags.some((tag) => tags.has(tag)))) {
    instruments.add('XAU');
    instruments.add('XAG');
  }

  return { importance, tags: [...tags].slice(0, 8), instruments: [...instruments].slice(0, 10) };
}
