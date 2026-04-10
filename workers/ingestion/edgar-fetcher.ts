/**
 * SEC EDGAR Filing Fetcher
 *
 * Given an EDGAR filing index URL, fetches the actual filing document,
 * strips HTML, and extracts structured content (8-K items, key text).
 *
 * SEC rate limit: 10 req/s. This runs once per article in the pipeline,
 * so 2-3 fetches per filing (index + primary doc + optional exhibit)
 * is well within limits.
 */

// SEC requires a descriptive User-Agent — see https://www.sec.gov/os/accessing-edgar-data
const EDGAR_USER_AGENT = "Daybreak Market Research daybreak-research@outlook.com";

// 8-K Item number → human-readable description for the scoring prompt
const ITEM_LABELS: Record<string, string> = {
  "1.01": "Entry into Material Agreement",
  "1.02": "Termination of Material Agreement",
  "1.03": "Bankruptcy or Receivership",
  "2.01": "Completion of Acquisition or Disposition",
  "2.02": "Results of Operations and Financial Condition (Earnings)",
  "2.03": "Creation of Direct Financial Obligation",
  "2.04": "Triggering Events Under Financial Agreements",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairment",
  "3.01": "Notice of Delisting or Failure to Satisfy Listing Rules",
  "3.02": "Unregistered Sales of Equity Securities",
  "4.01": "Changes in Registrant's Certifying Accountant",
  "5.01": "Changes in Control of Registrant",
  "5.02": "Departure/Election of Directors or Officers",
  "5.03": "Amendments to Articles of Incorporation or Bylaws",
  "5.04": "Temporary Suspension of Trading Under Registrant's Plans",
  "5.05": "Amendments to the Registrant's Code of Ethics",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

export interface SecContent {
  form_type: string;
  company: string;
  cik: string;
  accession_no: string;
  items_found: string[]; // e.g. ["2.02", "9.01"] for 8-K
  item_labels: string[]; // human-readable e.g. ["Earnings", "Exhibits"]
  primary_text: string;  // stripped text from key document, up to 4000 chars
  has_exhibit_99_1: boolean;
}

export interface Form4Details {
  insiderName: string;
  insiderTitle: string;
  transactionCode: string;      // S=sale, P=purchase, A=award, M=exercise, G=gift, etc.
  totalShares: number;
  pricePerShare: number | null;
  dollarValue: number | null;   // totalShares * pricePerShare
  percentOfPosition: number | null; // shares / (shares + sharesOwnedAfter)
  acquiredDisposed: "A" | "D";
  isOpenMarket: boolean;        // true only for S and P
}

// Transaction codes that represent open-market trades (not grants/awards/exercises)
const OPEN_MARKET_CODES = new Set(["S", "P"]);

// ---------- Helpers ----------

async function edgarFetch(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": EDGAR_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,text/plain,*/*",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    throw new Error(`EDGAR HTTP ${resp.status} for ${url}`);
  }
  return resp.text();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, " ") // skip financial tables (too noisy)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

function findItemNumbers(text: string): string[] {
  const found = new Set<string>();
  // Match "Item 2.02" or "ITEM 2.02" patterns
  const pattern = /\bItem\s+(\d{1,2}\.\d{2})\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/** Parse the EDGAR filing index HTML to find document entries. */
function parseIndexDocs(html: string): Array<{ href: string; docType: string }> {
  const docs: Array<{ href: string; docType: string }> = [];

  // EDGAR index tables have rows like:
  // <tr><td>1</td><td>Description</td><td><a href="doc.htm">doc.htm</a></td><td>8-K</td><td>50KB</td></tr>
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1];

    // Find the href (document link)
    const hrefMatch = rowHtml.match(/href="([^"]+\.(?:htm|html|txt|xml))"/i);
    if (!hrefMatch) continue;

    // Extract all td text content
    const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let tdMatch;
    while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, "").trim());
    }

    // The doc type is usually the 4th cell (index 3)
    const docType = cells[3] ?? cells[1] ?? "";
    docs.push({ href: hrefMatch[1], docType });
  }

  return docs;
}

/** Parse back CIK, accession numbers from the index URL we constructed. */
function parseIndexUrl(
  url: string
): { cik: string; accessionNoDashes: string; accessionDashes: string } | null {
  // URL format: https://www.sec.gov/Archives/edgar/data/{CIK}/{accessionNoDashes}/{accessionDashes}-index.htm
  const match = url.match(
    /\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/([\d-]{20})-index\.htm/
  );
  if (!match) return null;
  return {
    cik: match[1],
    accessionNoDashes: match[2],
    accessionDashes: match[3],
  };
}

/**
 * Return the best character offset to start extracting from in a stripped
 * SEC filing document. Skips cover page boilerplate and seeks to the first
 * section that actually contains analyst-relevant text.
 */
function findBestTextOffset(text: string, formType: string): number {
  const clean = formType.replace("/A", "").toUpperCase();

  const SECTION_MARKERS: Record<string, string[]> = {
    "S-1": [
      "PROSPECTUS SUMMARY",
      "Prospectus Summary",
      "SUMMARY OF THE OFFERING",
      "SUMMARY OF OFFERING",
      "OUR COMPANY",
      "Our Company",
      "BUSINESS OVERVIEW",
      "Business Overview",
      "ABOUT US",
    ],
    "10-K": [
      "MANAGEMENT'S DISCUSSION AND ANALYSIS",
      "Management's Discussion and Analysis",
      "RESULTS OF OPERATIONS",
      "Results of Operations",
      "Item 7.",
      "ITEM 7.",
    ],
    "10-Q": [
      "MANAGEMENT'S DISCUSSION AND ANALYSIS",
      "Management's Discussion and Analysis",
      "RESULTS OF OPERATIONS",
      "Results of Operations",
      "Item 2.",
      "ITEM 2.",
    ],
    "S-11": [
      "PROSPECTUS SUMMARY",
      "Prospectus Summary",
      "OUR COMPANY",
      "Our Company",
    ],
  };

  const markers = SECTION_MARKERS[clean] ?? [];
  const maxSearchEnd = Math.floor(text.length * 0.65); // don't seek past 65% of doc

  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx > 50 && idx < maxSearchEnd) {
      return idx;
    }
  }

  return 0; // fallback: start from beginning (8-K, Form 4, unknown types)
}

// ---------- Main export ----------

export async function fetchSecContent(
  filingIndexUrl: string,
  formType: string,
  company: string
): Promise<SecContent> {
  const parsed = parseIndexUrl(filingIndexUrl);
  if (!parsed) {
    throw new Error(`Cannot parse EDGAR index URL: ${filingIndexUrl}`);
  }
  const { cik, accessionNoDashes, accessionDashes } = parsed;
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}`;

  // Fetch the filing index HTML
  const indexHtml = await edgarFetch(filingIndexUrl);
  const docs = parseIndexDocs(indexHtml);

  // Identify primary document and exhibit 99.1
  const primaryDoc = docs.find(
    (d) =>
      d.docType === formType ||
      d.docType === formType.replace("/A", "") // amended forms
  ) ?? docs[1]; // fall back to first non-cover doc

  const exhibit99 = docs.find(
    (d) => d.docType === "EX-99.1" || d.docType === "EX-99"
  );

  const hasExhibit = !!exhibit99;

  // Fetch the best document: exhibit 99.1 (press release) for earnings 8-K,
  // otherwise the primary filing document
  const targetDoc =
    formType === "8-K" && exhibit99 ? exhibit99 : primaryDoc;

  if (!targetDoc) {
    throw new Error(`No fetchable document found in index for ${accessionDashes}`);
  }

  const docUrl = targetDoc.href.startsWith("http")
    ? targetDoc.href
    : targetDoc.href.startsWith("/")
    ? `https://www.sec.gov${targetDoc.href}`
    : `${baseUrl}/${targetDoc.href}`;
  const docHtml = await edgarFetch(docUrl);
  const rawText = stripHtml(docHtml);

  // Extract 8-K item numbers from the full text before slicing
  const itemsFound = formType === "8-K" ? findItemNumbers(rawText) : [];
  const itemLabels = itemsFound.map(
    (no) => ITEM_LABELS[no] ?? `Item ${no}`
  );

  // Seek to the most information-dense section of the document.
  // First 4000 chars of an S-1/10-K is always legal boilerplate — not useful.
  const offset = findBestTextOffset(rawText, formType);
  const primaryText = rawText.slice(offset, offset + 8000);

  return {
    form_type: formType,
    company,
    cik,
    accession_no: accessionDashes,
    items_found: itemsFound,
    item_labels: itemLabels,
    primary_text: primaryText,
    has_exhibit_99_1: hasExhibit,
  };
}

// ---------- Form 4 (insider transaction) parser ----------

/**
 * Extract a field from Form 4 XML. Handles both formats:
 *   <tag><value>X</value></tag>  (most numeric/coded fields)
 *   <tag>X</tag>                 (transactionCode, simple strings)
 */
function extractF4Value(xml: string, tag: string): string | null {
  const withValue = xml.match(new RegExp(`<${tag}[^>]*>\\s*<value>\\s*([^<]+?)\\s*<\\/value>`, "i"));
  if (withValue) return withValue[1].trim();
  const direct = xml.match(new RegExp(`<${tag}[^>]*>\\s*([^<\\s][^<]*)\\s*<\\/${tag}>`, "i"));
  return direct ? direct[1].trim() : null;
}

function parseNum(s: string | null): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseForm4Xml(xml: string): Form4Details | null {
  // Insider identity
  const insiderName = extractF4Value(xml, "rptOwnerName") ?? "Unknown";
  const officerTitle = extractF4Value(xml, "officerTitle") ?? "";
  const isDirector = extractF4Value(xml, "isDirector") === "1";
  const isTenPct = extractF4Value(xml, "isTenPercentOwner") === "1";
  const insiderTitle =
    officerTitle || (isTenPct ? "10% Owner" : isDirector ? "Director" : "Insider");

  // Aggregate across all non-derivative transactions in the filing
  const txPattern = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi;
  let txMatch;
  let totalShares = 0;
  let totalValue = 0;
  let hasPrice = false;
  let transactionCode = "";
  let acquiredDisposed: "A" | "D" = "D";
  let sharesOwnedAfter = 0;

  while ((txMatch = txPattern.exec(xml)) !== null) {
    const tx = txMatch[1];
    const code = tx.match(/<transactionCode>\s*([^<\s]+)\s*<\/transactionCode>/i)?.[1]?.trim() ?? "";
    const shares = parseNum(extractF4Value(tx, "transactionShares"));
    const price = parseNum(extractF4Value(tx, "transactionPricePerShare"));
    const ad = tx.match(
      /<transactionAcquiredDisposedCode>[^<]*<value>\s*([AD])\s*<\/value>/i
    )?.[1] as "A" | "D" | undefined;
    const owned = parseNum(extractF4Value(tx, "sharesOwnedFollowingTransaction"));

    if (code) transactionCode = code;
    if (ad) acquiredDisposed = ad;
    totalShares += shares;
    if (price > 0) {
      totalValue += shares * price;
      hasPrice = true;
    }
    if (owned > sharesOwnedAfter) sharesOwnedAfter = owned;
  }

  if (!transactionCode && totalShares === 0) return null;

  const dollarValue = hasPrice ? totalValue : null;
  const pricePerShare = hasPrice && totalShares > 0 ? totalValue / totalShares : null;
  const totalPosition = totalShares + sharesOwnedAfter;
  const percentOfPosition = totalPosition > 0 ? totalShares / totalPosition : null;

  return {
    insiderName,
    insiderTitle,
    transactionCode,
    totalShares,
    pricePerShare,
    dollarValue,
    percentOfPosition,
    acquiredDisposed,
    isOpenMarket: OPEN_MARKET_CODES.has(transactionCode),
  };
}

/**
 * Fetch a Form 4 filing index and parse the XML to extract transaction details.
 * Returns null on any failure — callers treat this as non-fatal.
 */
export async function fetchForm4Details(indexUrl: string): Promise<Form4Details | null> {
  const parsed = parseIndexUrl(indexUrl);
  if (!parsed) return null;
  const { cik, accessionNoDashes } = parsed;
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}`;

  const indexHtml = await edgarFetch(indexUrl);
  const docs = parseIndexDocs(indexHtml);

  // Primary document for Form 4 is the XML (docType "4" or ".xml" extension)
  const primaryDoc =
    docs.find((d) => d.docType === "4") ??
    docs.find((d) => d.href.toLowerCase().endsWith(".xml")) ??
    docs[1];

  if (!primaryDoc) return null;

  const docUrl = primaryDoc.href.startsWith("http")
    ? primaryDoc.href
    : primaryDoc.href.startsWith("/")
    ? `https://www.sec.gov${primaryDoc.href}`
    : `${baseUrl}/${primaryDoc.href}`;

  const xml = await edgarFetch(docUrl);
  return parseForm4Xml(xml);
}
