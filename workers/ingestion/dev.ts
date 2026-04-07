/**
 * Dev ingestion worker — no Redis required.
 * Polls RSS feeds every 60s, then processes PENDING articles concurrently (max 3).
 * Usage: npm run worker:dev
 */
import { createClient } from "@supabase/supabase-js";
import { pollAllFeeds } from "./feeds/rss";
import { processArticle } from "./pipeline";

const FEED_INTERVAL_MS = 60_000;
const PIPELINE_CONCURRENCY = 3;
const PIPELINE_BATCH = 20;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function processPending(): Promise<void> {
  const supabase = getSupabase();
  const { data: articles, error } = await supabase
    .from("articles")
    .select("id, title")
    .eq("status", "PENDING")
    .order("published_at", { ascending: false })
    .limit(PIPELINE_BATCH);

  if (error) {
    console.error("[dev-worker] Failed to fetch pending articles:", error.message);
    return;
  }
  if (!articles?.length) return;

  console.log(`[dev-worker] Processing ${articles.length} pending articles...`);

  // Process in chunks of PIPELINE_CONCURRENCY
  for (let i = 0; i < articles.length; i += PIPELINE_CONCURRENCY) {
    const chunk = articles.slice(i, i + PIPELINE_CONCURRENCY);
    await Promise.allSettled(
      chunk.map((a) => {
        console.log(`  → ${a.title.slice(0, 70)}`);
        return processArticle(a.id);
      })
    );
  }
}

async function tick(): Promise<void> {
  console.log(`\n[dev-worker] ${new Date().toISOString()} — polling feeds...`);
  await pollAllFeeds();
  await processPending();
}

async function main() {
  console.log("[dev-worker] Starting Daybreak dev ingestion worker (no Redis)...");
  console.log(`[dev-worker] Feed poll interval: ${FEED_INTERVAL_MS / 1000}s | Pipeline concurrency: ${PIPELINE_CONCURRENCY}`);

  // Run immediately on startup
  await tick();

  // Then on interval
  setInterval(tick, FEED_INTERVAL_MS);

  process.on("SIGTERM", () => {
    console.log("[dev-worker] SIGTERM — shutting down.");
    process.exit(0);
  });
  process.on("SIGINT", () => {
    console.log("[dev-worker] SIGINT — shutting down.");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[dev-worker] Fatal:", err);
  process.exit(1);
});
