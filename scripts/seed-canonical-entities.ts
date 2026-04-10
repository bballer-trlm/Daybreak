/**
 * Seed canonical_entities with all US exchange-listed equities.
 *
 * Data sources:
 *   NASDAQ Trader files — nasdaqlisted.txt + otherlisted.txt (free, no key required)
 *   Covers NYSE, NASDAQ, NYSE ARCA, BATS (~5,000–8,000 common stocks after filtering)
 *
 * Also seeds non-company entities: major indices, commodities, currencies, central banks.
 *
 * Run:
 *   npm run db:seed
 *   -- or --
 *   tsx --env-file=.env.local scripts/seed-canonical-entities.ts
 *
 * Safe to re-run: upserts on canonical_name, ignores duplicates.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const NASDAQ_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";

const UA = "Daybreak Market Research daybreak-research@outlook.com";

// Names containing these words indicate non-common-stock securities
const EXCLUDE_NAME = /\b(warrant|rights?|unit|debenture|note|depositary)\b/i;

// Legal suffixes to strip for alias generation (longest patterns first)
const LEGAL_SUFFIXES: RegExp[] = [
  /\s*,?\s+incorporated\.?$/i,
  /\s*,?\s+corporation\.?$/i,
  /\s*,?\s+international\.?$/i,
  /\s*,?\s+technologies\.?$/i,
  /\s*,?\s+technology\.?$/i,
  /\s*,?\s+enterprises?\.?$/i,
  /\s*,?\s+holdings?\.?$/i,
  /\s*,?\s+solutions?\.?$/i,
  /\s*,?\s+resources?\.?$/i,
  /\s*,?\s+services?\.?$/i,
  /\s*,?\s+systems?\.?$/i,
  /\s*,?\s+company\.?$/i,
  /\s*,?\s+group\.?$/i,
  /\s*,?\s+corp\.?$/i,
  /\s*,?\s+inc\.?$/i,
  /\s*,?\s+ltd\.?$/i,
  /\s*,?\s+llc\.?$/i,
  /\s*,?\s+llp\.?$/i,
  /\s*,?\s+plc\.?$/i,
  /\s*,?\s+co\.?$/i,
  /\s*,?\s+sa\.?$/i,
  /\s*,?\s+ag\.?$/i,
  /\s*,?\s+nv\.?$/i,
  /\s*,?\s+se\.?$/i,
];

function generateAliases(name: string, ticker: string): string[] {
  const aliases = new Set<string>();

  const lower = name.toLowerCase().trim();
  aliases.add(lower);
  aliases.add(ticker.toLowerCase());

  // Strip trailing period
  const noPeriod = lower.replace(/\.$/, "").trim();
  if (noPeriod !== lower) aliases.add(noPeriod);

  // Strip commas
  const noComma = lower.replace(/,/g, "").replace(/\s+/g, " ").trim();
  if (noComma !== lower) aliases.add(noComma);

  // Iteratively strip legal suffixes (handles "Corp., Inc." → "Corp." → base)
  let stripped = lower;
  for (const pattern of LEGAL_SUFFIXES) {
    const next = stripped.replace(pattern, "").trim();
    if (next !== stripped && next.length > 2) {
      aliases.add(next);
      stripped = next;
    }
  }

  return [...aliases].filter((a) => a.length > 1);
}

// NASDAQ Market Category → market_cap_tier (rough approximation)
function nasdaqTier(cat: string): string | null {
  if (cat === "Q") return "large"; // Global Select Market
  if (cat === "G") return "mid";   // Global Market
  if (cat === "S") return "small"; // Capital Market
  return null;
}

interface EntityRow {
  canonical_name: string;
  entity_type: string;
  tickers: string[];
  aliases: string[];
  market_cap_tier?: string | null;
  is_active: boolean;
}

function parseNasdaqListed(text: string): EntityRow[] {
  const rows: EntityRow[] = [];
  // Header: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
  for (const line of text.split("\n").slice(1)) {
    const t = line.trim();
    if (!t || t.startsWith("File Creation")) continue;

    const [symbol, name, marketCat, testIssue, , , etf] = t.split("|");
    if (!symbol || !name) continue;
    if (testIssue === "Y" || etf === "Y") continue;
    if (!/^[A-Z]+$/.test(symbol)) continue; // exclude warrants/rights (e.g. AACGW)
    if (EXCLUDE_NAME.test(name)) continue;

    rows.push({
      canonical_name: name.trim(),
      entity_type: "company",
      tickers: [symbol.trim()],
      aliases: generateAliases(name.trim(), symbol.trim()),
      market_cap_tier: nasdaqTier(marketCat?.trim() ?? ""),
      is_active: true,
    });
  }
  return rows;
}

function parseOtherListed(text: string): EntityRow[] {
  const rows: EntityRow[] = [];
  // Header: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
  for (const line of text.split("\n").slice(1)) {
    const t = line.trim();
    if (!t || t.startsWith("File Creation")) continue;

    const parts = t.split("|");
    const symbol = parts[0]?.trim();
    const name = parts[1]?.trim();
    const etf = parts[4]?.trim();
    const testIssue = parts[6]?.trim();

    if (!symbol || !name) continue;
    if (testIssue === "Y" || etf === "Y") continue;
    if (!/^[A-Z]+$/.test(symbol)) continue;
    if (EXCLUDE_NAME.test(name)) continue;

    rows.push({
      canonical_name: name.trim(),
      entity_type: "company",
      tickers: [symbol.trim()],
      aliases: generateAliases(name.trim(), symbol.trim()),
      is_active: true,
    });
  }
  return rows;
}

// ---- Static non-company entities ----

const STATIC_ENTITIES: EntityRow[] = [
  // Indices
  {
    canonical_name: "S&P 500",
    entity_type: "index",
    tickers: ["SPX", "SPY", "^GSPC"],
    aliases: ["s&p 500", "s&p500", "spx", "spy", "s and p 500", "s&p", "standard & poor's 500", "standard and poor's 500", "sp500"],
    is_active: true,
  },
  {
    canonical_name: "NASDAQ Composite",
    entity_type: "index",
    tickers: ["COMP", "QQQ", "^IXIC"],
    aliases: ["nasdaq composite", "nasdaq", "comp", "qqq", "nasdaq-100", "nasdaq 100", "the nasdaq"],
    is_active: true,
  },
  {
    canonical_name: "Dow Jones Industrial Average",
    entity_type: "index",
    tickers: ["DJIA", "DIA", "^DJI"],
    aliases: ["dow jones industrial average", "dow jones", "the dow", "djia", "dia", "dow jones index"],
    is_active: true,
  },
  {
    canonical_name: "Russell 2000",
    entity_type: "index",
    tickers: ["RUT", "IWM", "^RUT"],
    aliases: ["russell 2000", "rut", "iwm", "small cap index", "russell small cap"],
    is_active: true,
  },
  {
    canonical_name: "CBOE Volatility Index",
    entity_type: "index",
    tickers: ["VIX", "^VIX"],
    aliases: ["vix", "volatility index", "cboe volatility index", "fear index", "fear gauge"],
    is_active: true,
  },
  {
    canonical_name: "Russell 1000",
    entity_type: "index",
    tickers: ["RUI", "IWB"],
    aliases: ["russell 1000", "rui", "iwb"],
    is_active: true,
  },
  // Commodities
  {
    canonical_name: "Gold",
    entity_type: "commodity",
    tickers: ["GC=F", "GLD", "IAU"],
    aliases: ["gold", "gold futures", "spot gold", "xau", "comex gold"],
    is_active: true,
  },
  {
    canonical_name: "Silver",
    entity_type: "commodity",
    tickers: ["SI=F", "SLV"],
    aliases: ["silver", "silver futures", "spot silver", "xag", "comex silver"],
    is_active: true,
  },
  {
    canonical_name: "WTI Crude Oil",
    entity_type: "commodity",
    tickers: ["CL=F", "USO"],
    aliases: ["wti crude oil", "wti", "crude oil", "west texas intermediate", "wti crude", "oil", "nymex crude"],
    is_active: true,
  },
  {
    canonical_name: "Brent Crude Oil",
    entity_type: "commodity",
    tickers: ["BZ=F"],
    aliases: ["brent crude oil", "brent crude", "brent", "brent oil", "ice brent"],
    is_active: true,
  },
  {
    canonical_name: "Natural Gas",
    entity_type: "commodity",
    tickers: ["NG=F", "UNG"],
    aliases: ["natural gas", "nat gas", "natgas", "henry hub"],
    is_active: true,
  },
  {
    canonical_name: "Copper",
    entity_type: "commodity",
    tickers: ["HG=F", "COPX"],
    aliases: ["copper", "copper futures", "hg", "dr. copper", "comex copper"],
    is_active: true,
  },
  {
    canonical_name: "Wheat",
    entity_type: "commodity",
    tickers: ["ZW=F", "WEAT"],
    aliases: ["wheat", "wheat futures", "cbot wheat"],
    is_active: true,
  },
  {
    canonical_name: "Corn",
    entity_type: "commodity",
    tickers: ["ZC=F", "CORN"],
    aliases: ["corn", "corn futures", "cbot corn"],
    is_active: true,
  },
  // Currencies
  {
    canonical_name: "US Dollar Index",
    entity_type: "currency",
    tickers: ["DXY", "UUP"],
    aliases: ["us dollar index", "dollar index", "dxy", "usdx", "usd index", "the dollar"],
    is_active: true,
  },
  {
    canonical_name: "Euro",
    entity_type: "currency",
    tickers: ["EUR", "EURUSD"],
    aliases: ["euro", "eur", "eurusd", "eur/usd", "eur-usd"],
    is_active: true,
  },
  {
    canonical_name: "Japanese Yen",
    entity_type: "currency",
    tickers: ["JPY", "USDJPY"],
    aliases: ["japanese yen", "yen", "jpy", "usdjpy", "usd/jpy"],
    is_active: true,
  },
  {
    canonical_name: "British Pound",
    entity_type: "currency",
    tickers: ["GBP", "GBPUSD"],
    aliases: ["british pound", "pound sterling", "gbp", "gbpusd", "gbp/usd", "sterling"],
    is_active: true,
  },
  {
    canonical_name: "Bitcoin",
    entity_type: "currency",
    tickers: ["BTC", "BTCUSD", "IBIT"],
    aliases: ["bitcoin", "btc", "btcusd", "btc-usd", "bitcoin (btc)", "xbt"],
    is_active: true,
  },
  {
    canonical_name: "Ethereum",
    entity_type: "currency",
    tickers: ["ETH", "ETHUSD", "ETHA"],
    aliases: ["ethereum", "eth", "ethusd", "eth-usd", "ether", "ethereum (eth)"],
    is_active: true,
  },
  // US Treasuries
  {
    canonical_name: "US 10-Year Treasury",
    entity_type: "index",
    tickers: ["TNX", "^TNX", "TLT"],
    aliases: ["us 10-year treasury", "10-year treasury", "10yr treasury", "10y treasury", "10-year yield", "treasury yield", "tnx", "10 year bond"],
    is_active: true,
  },
  {
    canonical_name: "US 2-Year Treasury",
    entity_type: "index",
    tickers: ["IRX", "^IRX", "SHY"],
    aliases: ["us 2-year treasury", "2-year treasury", "2yr treasury", "2y treasury", "2-year yield", "irx", "2 year bond"],
    is_active: true,
  },
  {
    canonical_name: "US 30-Year Treasury",
    entity_type: "index",
    tickers: ["TYX", "^TYX", "TMF"],
    aliases: ["us 30-year treasury", "30-year treasury", "30yr treasury", "30y treasury", "long bond", "tyx"],
    is_active: true,
  },
  // Central banks
  {
    canonical_name: "Federal Reserve",
    entity_type: "central_bank",
    tickers: [],
    aliases: ["federal reserve", "the fed", "fed", "fomc", "federal open market committee", "us central bank", "us federal reserve"],
    is_active: true,
  },
  {
    canonical_name: "European Central Bank",
    entity_type: "central_bank",
    tickers: [],
    aliases: ["european central bank", "ecb", "eu central bank"],
    is_active: true,
  },
  {
    canonical_name: "Bank of Japan",
    entity_type: "central_bank",
    tickers: [],
    aliases: ["bank of japan", "boj", "japan central bank", "japanese central bank"],
    is_active: true,
  },
  {
    canonical_name: "Bank of England",
    entity_type: "central_bank",
    tickers: [],
    aliases: ["bank of england", "boe", "uk central bank", "british central bank"],
    is_active: true,
  },
  {
    canonical_name: "People's Bank of China",
    entity_type: "central_bank",
    tickers: [],
    aliases: ["people's bank of china", "pboc", "china central bank", "peoples bank of china", "chinese central bank"],
    is_active: true,
  },
];

// ---- Fetch + upsert ----

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function batchUpsert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: EntityRow[],
  batchSize = 200
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from("canonical_entities")
      .upsert(batch, { onConflict: "canonical_name", ignoreDuplicates: true });
    if (error) {
      console.error(
        `[seed] Batch ${i}–${Math.min(i + batchSize, rows.length)} error: ${error.message}`
      );
    } else {
      process.stdout.write(
        `\r[seed] ${Math.min(i + batchSize, rows.length)} / ${rows.length}`
      );
    }
  }
  process.stdout.write("\n");
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error(
      "Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"
    );
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log("[seed] Fetching NASDAQ listed...");
  const nasdaqText = await fetchText(NASDAQ_LISTED_URL);
  const nasdaqRows = parseNasdaqListed(nasdaqText);
  console.log(`[seed] NASDAQ: ${nasdaqRows.length} companies`);

  console.log("[seed] Fetching other listed (NYSE/AMEX/ARCA)...");
  const otherText = await fetchText(OTHER_LISTED_URL);
  const otherRows = parseOtherListed(otherText);
  console.log(`[seed] Other listed: ${otherRows.length} companies`);

  const companyRows = [...nasdaqRows, ...otherRows];
  const allRows: EntityRow[] = [...STATIC_ENTITIES, ...companyRows];

  console.log(
    `[seed] Total: ${allRows.length} entities` +
    ` (${STATIC_ENTITIES.length} static + ${companyRows.length} companies)`
  );
  console.log("[seed] Upserting...");

  await batchUpsert(supabase, allRows);

  // Final count
  const { count } = await supabase
    .from("canonical_entities")
    .select("id", { count: "exact", head: true });
  console.log(`[seed] Done. canonical_entities now has ${count} rows.`);
}

main().catch((err) => {
  console.error("[seed] Fatal:", err);
  process.exit(1);
});
