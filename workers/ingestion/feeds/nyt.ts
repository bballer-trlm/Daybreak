/**
 * NY Times Newswire API poller
 *
 * Polls the Times Newswire for real-time articles as they're published.
 * Returns full abstracts (much richer than RSS snippets) — better pipeline input.
 *
 * Requires NYT_API_KEY env var. Skips gracefully if not set.
 * Get a free key at: https://developer.nytimes.com/
 *
 * Sections polled: business, technology, u.s., world
 * Rate limit: 500 req/day, 5 req/min — we poll 4 sections every 60s = safe.
 */

import { createClient } from "@supabase/supabase-js";
import type { ArticleInsert } from "../../../lib/supabase/types";

const NYT_BASE = "https://api.nytimes.com/svc/news/v3/content/nyt";
const SECTIONS = ["business", "technology", "u.s.", "dealbook"];

interface NytNewsItem {
  title: string;
  abstract: string;
  url: string;
  published_date: string;
  byline: string;
  section: string;
  subsection: string;
}

interface NytResponse {
  status: string;
  results: NytNewsItem[];
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function pollNytSection(section: string, apiKey: string): Promise<number> {
  const url = `${NYT_BASE}/${section}.json?api-key=${apiKey}&limit=20`;
  let json: NytResponse;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Daybreak Market Research daybreak-research@outlook.com" },
    });
    if (!res.ok) {
      console.error(`[nyt] ${section} HTTP ${res.status}`);
      return 0;
    }
    json = await res.json() as NytResponse;
  } catch (err) {
    console.error(`[nyt] ${section} fetch failed: ${(err as Error).message}`);
    return 0;
  }

  if (json.status !== "OK" || !Array.isArray(json.results)) return 0;

  const rows: ArticleInsert[] = json.results
    .filter((item) => item.title && item.url)
    .map((item) => ({
      title: item.title.trim(),
      body: item.abstract?.trim() || null,
      source: "NY Times",
      author: item.byline?.replace(/^By\s+/i, "") || null,
      url: item.url,
      published_at: item.published_date ? new Date(item.published_date).toISOString() : null,
      status: "PENDING" as const,
      is_breaking: false,
    }));

  if (rows.length === 0) return 0;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("articles")
    .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error(`[nyt] ${section} insert error: ${error.message}`);
    return 0;
  }

  const inserted = data?.length ?? 0;
  if (inserted > 0) console.log(`[nyt] ${section}: +${inserted} new articles`);
  return inserted;
}

// Poll only during US market hours: Mon–Fri, 7am–6pm ET
function isMarketHours(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());

  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);

  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(day);
  const isInHours = hour >= 7 && hour < 18; // 7:00am–5:59pm ET
  return isWeekday && isInHours;
}

export async function pollAllNytFeeds(): Promise<void> {
  const apiKey = process.env.NYT_API_KEY;
  if (!apiKey) return; // Silently skip — activates automatically once key is added to env
  if (!isMarketHours()) return;

  for (const section of SECTIONS) {
    await pollNytSection(section, apiKey);
    // 300ms gap to stay under 5 req/min rate limit
    await new Promise((r) => setTimeout(r, 300));
  }
}
