import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";
import type { ArticleInsert } from "../../../lib/supabase/types";

const parser = new Parser({ timeout: 10_000 });

export interface FeedConfig {
  source: string;
  url: string;
}

export const FEEDS: FeedConfig[] = [
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Americas.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Africa.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Europe.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Obituaries.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/US.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/YourMoney.xml" },
  { source: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },

  // Press releases
  { source: "Business Wire", url: "https://feed.businesswire.com/rss/home/?rss=G1&rssid=20" },      // all news
  { source: "Business Wire", url: "https://feed.businesswire.com/rss/home/?rss=G6&rssid=20" },      // financial news
];

// Workers use the service role key — no Database generic needed since the
// service role bypasses RLS and we type the insert manually below.
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function pollFeed(feed: FeedConfig): Promise<number> {
  let feedData;
  try {
    feedData = await parser.parseURL(feed.url);
  } catch (err) {
    console.error(`[rss] ${feed.source} fetch failed: ${(err as Error).message}`);
    return 0;
  }

  const rows: ArticleInsert[] = feedData.items
    .filter((item) => item.title && item.link)
    .map((item) => ({
      title: item.title!.trim(),
      body: item.contentSnippet ?? item.content ?? null,
      source: feed.source,
      author: item.creator ?? (item as Record<string, unknown>)["author"] as string ?? null,
      url: item.link!,
      published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      status: "PENDING" as const,
      is_breaking: false,
    }));

  if (rows.length === 0) return 0;

  const supabase = getSupabase();

  // ignoreDuplicates: true silently skips articles we've already seen (url unique constraint)
  const { data, error } = await supabase
    .from("articles")
    .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error(`[rss] ${feed.source} insert error: ${error.message}`);
    return 0;
  }

  const inserted = data?.length ?? 0;
  if (inserted > 0) {
    console.log(`[rss] ${feed.source}: +${inserted} new articles`);
  }
  return inserted;
}

export async function pollAllFeeds(): Promise<void> {
  await Promise.allSettled(FEEDS.map(pollFeed));
}
