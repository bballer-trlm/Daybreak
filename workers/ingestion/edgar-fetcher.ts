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

  const docUrl = `${baseUrl}/${targetDoc.href}`;
  const docHtml = await edgarFetch(docUrl);
  const rawText = stripHtml(docHtml);

  // Extract 8-K item numbers from the full text before slicing
  const itemsFound = formType === "8-K" ? findItemNumbers(rawText) : [];
  const itemLabels = itemsFound.map(
    (no) => ITEM_LABELS[no] ?? `Item ${no}`
  );

  // Limit to first 4000 chars for the pipeline prompt
  const primaryText = rawText.slice(0, 4000);

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
