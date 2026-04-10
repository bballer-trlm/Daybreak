import { Client } from "pg";
import { processArticle } from "./pipeline";
import { getRedisConnectionOptions, createIngestQueue, createIngestWorker } from "./queue";
import { pollAllFeeds } from "./feeds/rss";
import { pollAllEdgarFeeds } from "./feeds/edgar";
import { pollAllNytFeeds } from "./feeds/nyt";

const SAFETY_NET_INTERVAL_MS = 60_000;
const SAFETY_NET_RETRY_CUTOFF_MS = 5 * 60_000;   // articles stuck 5–60 min: retry
const SAFETY_NET_ABANDON_CUTOFF_MS = 60 * 60_000; // articles stuck >60 min: give up

async function main() {
  console.log("[worker] Starting Daybreak ingestion worker...");

  const redisOpts = getRedisConnectionOptions();
  const queue = createIngestQueue(redisOpts);

  // BullMQ worker: processes ArticleIngestJob
  const worker = createIngestWorker(redisOpts, async (job) => {
    const { articleId } = job.data;
    if (!articleId || typeof articleId !== "string") {
      console.warn(`[worker] Job ${job.id} has no valid articleId — skipping`);
      return;
    }
    console.log(`[worker] Processing article ${articleId}`);
    await processArticle(articleId);
  });

  worker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} completed for article ${job.data.articleId}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message);
  });

  // pg LISTEN: fast path via pg_notify
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  await pgClient.query("LISTEN articles_pending");
  console.log("[worker] LISTEN articles_pending active");

  pgClient.on("notification", async (msg) => {
    if (msg.channel === "articles_pending" && msg.payload) {
      console.log(`[worker] pg_notify received: article ${msg.payload}`);
      await queue.add("ingest", { articleId: msg.payload });
    }
  });

  pgClient.on("error", (err) => {
    console.error("[worker] pg client error:", err.message);
    // Railway will restart the process on crash
    process.exit(1);
  });

  // Safety-net poll: catches articles that missed pg_notify (ARCHITECTURE.md §8.2)
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  setInterval(async () => {
    const retryCutoff = new Date(Date.now() - SAFETY_NET_RETRY_CUTOFF_MS).toISOString();
    const abandonCutoff = new Date(Date.now() - SAFETY_NET_ABANDON_CUTOFF_MS).toISOString();

    // Articles stuck >60 min: pipeline can't process them — mark FAILED_PERMANENT
    const { error: abandonErr } = await supabase
      .from("articles")
      .update({ status: "FAILED_PERMANENT" })
      .eq("status", "PENDING")
      .lt("created_at", abandonCutoff);
    if (abandonErr) {
      console.error("[worker] Safety-net abandon error:", abandonErr.message);
    }

    // Articles stuck 5–60 min: re-queue with jobId dedup (BullMQ ignores if already queued)
    const { data: stuck, error } = await supabase
      .from("articles")
      .select("id")
      .eq("status", "PENDING")
      .lt("created_at", retryCutoff)
      .gte("created_at", abandonCutoff);

    if (error) {
      console.error("[worker] Safety-net poll error:", error.message);
      return;
    }
    if (stuck && stuck.length > 0) {
      console.log(`[worker] Safety-net: enqueuing ${stuck.length} stuck articles`);
      await Promise.all(
        stuck.map((a) =>
          queue.add("ingest", { articleId: a.id }, { jobId: `article-${a.id}` })
        )
      );
    }
  }, SAFETY_NET_INTERVAL_MS);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("[worker] SIGTERM received, shutting down...");
    await worker.close();
    await queue.close();
    await pgClient.end();
    process.exit(0);
  });

  // RSS + EDGAR feed pollers: initial poll on startup, then on interval
  // NYT API: 500 req/day limit — 4 sections × 96 polls/day = 384 req/day at 15 min interval
  console.log("[worker] Starting RSS + EDGAR feed pollers...");
  await pollAllFeeds();
  await pollAllEdgarFeeds();
  await pollAllNytFeeds();
  setInterval(pollAllFeeds, 60_000);
  setInterval(pollAllEdgarFeeds, 60_000);
  setInterval(pollAllNytFeeds, 15 * 60_000);

  console.log("[worker] Ready. Listening for articles...");
}

main().catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
