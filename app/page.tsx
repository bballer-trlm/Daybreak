import { createClient } from "@supabase/supabase-js";
import type { ArticleWithEntities } from "@/lib/supabase/types";
import WireFeed from "./components/WireFeed";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: articles } = await supabase
    .from("articles")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(100);

  if (!articles?.length) {
    return <WireFeed initialArticles={[]} />;
  }

  // Fetch top entity impacts for all articles in one query
  const ids = articles.map((a) => a.id);
  const { data: impacts } = await supabase
    .from("entity_impacts")
    .select("article_id, score, entities(name, ticker)")
    .in("article_id", ids);

  // Merge entities onto articles
  const articlesWithEntities: ArticleWithEntities[] = articles.map((article) => {
    const articleImpacts = impacts
      ?.filter((i) => i.article_id === article.id)
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 3)
      .map((i) => {
        const entity = i.entities as { name: string; ticker: string | null } | null;
        return { name: entity?.name ?? "", ticker: entity?.ticker ?? null, score: i.score };
      }) ?? [];
    return { ...article, entities: articleImpacts };
  });

  return <WireFeed initialArticles={articlesWithEntities} />;
}
