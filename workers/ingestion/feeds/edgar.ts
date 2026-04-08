/**
 * SEC EDGAR Filing Feed
 *
 * Polls EDGAR ATOM feeds for new regulatory filings and inserts them
 * into the articles table. The pipeline's sec_content stage will later
 * fetch and parse the actual filing document.
 *
 * Form types covered:
 *   8-K   — Material corporate events (earnings, M&A, exec changes, bankruptcy)
 *   10-K  — Annual reports
 *   10-Q  — Quarterly reports
 *   S-1   — IPO registration statements
 *   4     — Insider transactions (Form 4)
 *
 * SEC rate limit: 10 req/s. We poll every 60s with 500ms gaps between
 * feed types, so we're well under the limit.
 */

import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";
import type { ArticleInsert } from "../../../lib/supabase/types";

// SEC requires a descriptive User-Agent
const EDGAR_USER_AGENT = "Daybreak Market Research daybreak-research@outlook.com";

const parser = new Parser({
  timeout: 15_000,
  headers: { "User-Agent": EDGAR_USER_AGENT },
});

interface EdgarFeedConfig {
  formType: string;
  label: string;
  url: string;
}

const EDGAR_FEEDS: EdgarFeedConfig[] = [
  {
    formType: "8-K",
    label: "Material Events",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom",
  },
  {
    formType: "10-K",
    label: "Annual Reports",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-K&dateb=&owner=include&count=10&search_text=&output=atom",
  },
  {
    formType: "10-Q",
    label: "Quarterly Reports",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-Q&dateb=&owner=include&count=10&search_text=&output=atom",
  },
  {
    formType: "S-1",
    label: "IPO Registrations",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=S-1&dateb=&owner=include&count=10&search_text=&output=atom",
  },
  {
    formType: "4",
    label: "Insider Transactions",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=20&search_text=&output=atom",
  },
];

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Parse an EDGAR ATOM entry to extract company info and construct the
 * canonical filing index URL.
 *
 * ATOM id format:  urn:tag:sec.gov,2008:accession-number=0001234567-25-000001
 * Title format:    8-K filing for COMPANY NAME (CIK 0001234567)
 */
function parseEdgarEntry(
  item: Parser.Item & { id?: string; guid?: string }
): {
  company: string;
  cik: string;
  cikNum: string;
  accessionDashes: string;
  accessionNoDashes: string;
  filingUrl: string;
} | null {
  const rawId = (item as Record<string, unknown>).id as string | undefined
    ?? item.guid
    ?? "";
  const title = item.title ?? "";

  // Extract accession number from the ATOM <id> URN
  const accMatch = rawId.match(/accession-number=([\d-]{20})/);
  if (!accMatch) return null;
  const accessionDashes = accMatch[1];
  const accessionNoDashes = accessionDashes.replace(/-/g, "");

  // Extract CIK from title (may have leading zeros)
  const cikMatch = title.match(/\(CIK\s*(\d+)\)/i);
  if (!cikMatch) return null;
  const cik = cikMatch[1];
  const cikNum = parseInt(cik, 10).toString(); // strip leading zeros for data path

  // Extract company name
  const companyMatch = title.match(/filing for (.+?)\s*\(CIK/i);
  const company = companyMatch ? companyMatch[1].trim() : "Unknown Company";

  // Canonical EDGAR filing index URL (unique per filing, fetchable)
  const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNoDashes}/${accessionDashes}-index.htm`;

  return { company, cik, cikNum, accessionDashes, accessionNoDashes, filingUrl };
}

export async function pollEdgarFeed(feed: EdgarFeedConfig): Promise<number> {
  let feedData;
  try {
    feedData = await parser.parseURL(feed.url);
  } catch (err) {
    console.error(
      `[edgar] ${feed.formType} feed failed: ${(err as Error).message}`
    );
    return 0;
  }

  const supabase = getSupabase();
  let inserted = 0;

  for (const item of feedData.items) {
    const parsed = parseEdgarEntry(
      item as Parser.Item & { id?: string; guid?: string }
    );
    if (!parsed) continue;

    const { company, cikNum, accessionDashes, filingUrl } = parsed;
    const filedAt = item.pubDate
      ? new Date(item.pubDate).toISOString()
      : new Date().toISOString();

    // Title readable by the screener and traders
    const title = `${company} files Form ${feed.formType} with SEC`;

    // Body encodes filing metadata + context for the screener.
    // The sec_content pipeline stage will replace this with actual filing text.
    const body =
      `SEC Form ${feed.formType} (${feed.label}) filed by ${company} on ` +
      `${filedAt.slice(0, 10)}. Accession: ${accessionDashes}. ` +
      `CIK: ${cikNum}. Full filing content fetched during enrichment.`;

    const row: ArticleInsert = {
      title,
      body,
      source: "SEC EDGAR",
      url: filingUrl,
      published_at: filedAt,
      status: "PENDING",
      is_breaking: false,
      category: "sec",
    };

    const { data, error } = await supabase
      .from("articles")
      .upsert(row, { onConflict: "url", ignoreDuplicates: true })
      .select("id");

    if (error) {
      console.error(`[edgar] Insert error ${accessionDashes}: ${error.message}`);
      continue;
    }
    if (data && data.length > 0) inserted++;
  }

  if (inserted > 0) {
    console.log(`[edgar] Form ${feed.formType}: +${inserted} new filings`);
  }
  return inserted;
}

export async function pollAllEdgarFeeds(): Promise<void> {
  for (const feed of EDGAR_FEEDS) {
    await pollEdgarFeed(feed);
    // 500ms gap between feed types to stay well under SEC's 10 req/s limit
    await new Promise((r) => setTimeout(r, 500));
  }
}
