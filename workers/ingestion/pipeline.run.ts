/**
 * Run the AI pipeline on the oldest PENDING articles for smoke testing.
 * Usage: npm run worker:pipeline
 */
import { createClient } from "@supabase/supabase-js";
import { processArticle } from "./pipeline";

const BATCH = parseInt(process.argv[2] ?? "15");

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: articles, error } = await supabase
    .from("articles")
    .select("id, title")
    .eq("status", "PENDING")
    .order("published_at", { ascending: false })
    .limit(BATCH);

  if (error) throw error;
  if (!articles?.length) {
    console.log("[pipeline:run] No PENDING articles found.");
    return;
  }

  console.log(`[pipeline:run] Processing ${articles.length} articles...`);
  for (const article of articles) {
    console.log(`\n→ ${article.title.slice(0, 80)}`);
    await processArticle(article.id);
  }
  console.log("\n[pipeline:run] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
