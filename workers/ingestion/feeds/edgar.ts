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
 * ATOM entry format (from live inspection):
 *   title:   "8-K - Company Name (0001234567) (Filer)"
 *   link:    "https://www.sec.gov/Archives/edgar/data/{CIK}/{accNoDash}/{acc}-index.htm"
 *   id:      "urn:tag:sec.gov,2008:accession-number=0001234567-26-000001"
 *   summary: HTML with Filed date, AccNo, and Item list (e.g. "Item 2.02: Results...")
 */

import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";
import type { ArticleInsert } from "../../../lib/supabase/types";

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
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=10&search_text=&output=atom",
  },
];

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Parse 8-K item descriptions out of the ATOM summary HTML.
 * Summary contains lines like: "Item 2.02: Results of Operations..."
 */
function parseSummaryItems(summaryHtml: string): string[] {
  const items: string[] = [];
  const pattern = /Item\s+(\d+\.\d+):\s*([^<\n]+)/g;
  let match;
  while ((match = pattern.exec(summaryHtml)) !== null) {
    items.push(`${match[1]}: ${match[2].trim()}`);
  }
  return items;
}

// Form types to drop at ingestion — no market signal, pure boilerplate
const BLOCKED_FORM_TYPES = new Set([
  "424B2", "424B3", "424B5",          // shelf prospectus supplements (424B4 kept — dilutive offering signal)
  "FWP",                               // free writing prospectus
  "497", "497K",                       // mutual fund prospectus / summary prospectus
  "485BPOS", "485APOS", "485BXT",     // mutual fund post-effective registration amendments (boilerplate)
  "N-14", "N-14/A",                   // mutual fund registration
  "N-CEN", "N-CEN/A",                 // annual report for registered investment companies
  "N-PORT", "N-PORT/A",               // monthly portfolio holdings (funds)
]);

/**
 * Parse a single EDGAR ATOM entry.
 *
 * Title format:   "8-K - Company Name (0001234567) (Filer)"
 * Link:           already the filing index URL — use directly
 * id (not guid):  "urn:tag:sec.gov,2008:accession-number=0001234567-26-000001"
 */
function parseEdgarEntry(
  item: Parser.Item,
  feedFormType: string
): {
  company: string;
  formType: string;
  filingUrl: string;
  summaryItems: string[];
} | null {
  const title = item.title ?? "";
  const filingUrl = item.link ?? "";

  if (!filingUrl || !filingUrl.includes("/Archives/edgar/")) return null;

  // Title: "8-K - Company Name (CIK_DIGITS) (Filer)"
  const titleMatch = title.match(/^([\w/\-]+)\s+-\s+(.+?)\s*\(\d+\)/);
  const formType = titleMatch?.[1]?.trim() ?? feedFormType;

  if (BLOCKED_FORM_TYPES.has(formType)) return null;
  const company = titleMatch?.[2]?.trim() ?? title;

  // Extract items from summary HTML (free context, no filing fetch needed)
  const summaryHtml = (item as Record<string, unknown>).summary as string ?? "";
  const summaryItems = parseSummaryItems(summaryHtml);

  return { company, formType, filingUrl, summaryItems };
}

export async function pollEdgarFeed(feed: EdgarFeedConfig): Promise<number> {
  let feedData;
  try {
    feedData = await parser.parseURL(feed.url);
  } catch (err) {
    console.error(`[edgar] ${feed.formType} feed failed: ${(err as Error).message}`);
    return 0;
  }

  const supabase = getSupabase();
  let inserted = 0;

  for (const item of feedData.items) {
    const parsed = parseEdgarEntry(item, feed.formType);
    if (!parsed) continue;

    const { company, formType, filingUrl, summaryItems } = parsed;
    const filedAt = item.pubDate
      ? new Date(item.pubDate).toISOString()
      : new Date().toISOString();

    const title = `${company} files Form ${formType} with SEC`;

    // Include items from the summary so the screener has real context immediately.
    // The sec_content stage will later enrich with the full filing text.
    const itemsContext =
      summaryItems.length > 0
        ? ` Items: ${summaryItems.join(" | ")}.`
        : "";

    const body =
      `SEC Form ${formType} (${feed.label}) filed by ${company} on ${filedAt.slice(0, 10)}.` +
      itemsContext;

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
      console.error(`[edgar] Insert error ${filingUrl}: ${error.message}`);
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
    // 500ms gap between feed types to stay under SEC's 10 req/s limit
    await new Promise((r) => setTimeout(r, 500));
  }
}
