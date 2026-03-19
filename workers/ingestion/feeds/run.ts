/**
 * Standalone RSS feed poller for local testing.
 * Run with: npm run worker:feeds
 * Polls all configured feeds once and exits.
 */
import { pollAllFeeds, FEEDS } from "./rss";

async function main() {
  console.log(`[feeds] Polling ${FEEDS.length} feeds: ${FEEDS.map((f) => f.source).join(", ")}`);
  await pollAllFeeds();
  console.log("[feeds] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
