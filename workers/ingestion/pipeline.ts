import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { StageType, RelevanceTier } from "../../lib/supabase/types";

const MODEL_FAST = "claude-haiku-4-5-20251001"; // screener + classifier
const MODEL_SMART = "claude-sonnet-4-6"; // entity extraction + scoring
const MODEL_TIMEOUT_MS = 15_000;

function getAnthropic() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: MODEL_TIMEOUT_MS,
  });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  return createClient(url, key);
}

async function writeEnrichment(
  articleId: string,
  stageType: StageType,
  data: Record<string, unknown>
) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("article_enrichments")
    .upsert({ article_id: articleId, stage_type: stageType, data }, { onConflict: "article_id,stage_type" });
  if (error) throw new Error(`Failed to write enrichment: ${error.message}`);
}

async function writeFailedEnrichment(
  articleId: string,
  stageType: StageType,
  rawOutput: unknown,
  errorMessage: string
) {
  const supabase = getSupabaseAdmin();
  await supabase.from("article_enrichments").insert({
    article_id: articleId,
    stage_type: stageType,
    data: { failed: true, raw_output: rawOutput, error: errorMessage },
  });
  const failedStatus = `FAILED_${stageType.toUpperCase()}` as const;
  await supabase
    .from("articles")
    .update({ status: failedStatus })
    .eq("id", articleId);
}

async function updateArticleStatus(articleId: string, status: string) {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("articles")
    .update({ status })
    .eq("id", articleId);
}

// ---------- Prompt helpers ----------

async function callJson<T>(
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens = 512,
): Promise<T> {
  const msg = await getAnthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: `<article>\n${userContent}\n</article>` }],
  });
  const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${raw.slice(0, 200)}`);
  return JSON.parse(match[0]) as T;
}

// ---------- Stage 1: Screener ----------

interface ScreenerResult {
  pass: boolean;
  relevance_tier: RelevanceTier;
  reason: string;
}

async function runScreener(article: {
  title: string;
  body: string | null;
}): Promise<ScreenerResult> {
  const system = `You are a financial news screener for a hedge fund trading desk.
Evaluate whether a news article is relevant to equity markets and worth full AI analysis.

Respond ONLY with valid JSON:
{
  "pass": boolean,         // true if article warrants full analysis
  "relevance_tier": "material" | "minor" | "noise",
  "reason": string         // one sentence explanation
}

Guidelines:
- "material": breaking news, earnings, M&A, Fed decisions, major geopolitical events → pass: true
- "minor": analyst upgrades/downgrades, product launches, minor data releases → pass: true
- "noise": sports, entertainment, unrelated world news, duplicates → pass: false
Target pass rate: ~60%.`;

  return callJson<ScreenerResult>(
    MODEL_FAST,
    system,
    `Title: ${article.title}\nBody: ${article.body?.slice(0, 500) ?? "(no body)"}`
  );
}

// ---------- Stage 2: Classifier ----------

interface ClassifierResult {
  is_breaking: boolean;
  category: string;
}

async function runClassifier(article: {
  title: string;
}): Promise<ClassifierResult> {
  const system = `You are a financial news classifier for a trading terminal.
Classify the article headline.

Respond ONLY with valid JSON:
{
  "is_breaking": boolean,
  "category": "macro" | "earnings" | "sec" | "merger" | "ratings" | "fed" | "geopolitical" | "crypto" | "general"
}

Breaking = truly market-moving news requiring immediate trader attention (earnings beats/misses, fed decisions, major M&A, geopolitical shocks, regulatory actions).`;

  return callJson<ClassifierResult>(
    MODEL_FAST,
    system,
    `Title: ${article.title}`
  );
}

// ---------- Stage 3: Entity Extraction ----------

interface ExtractedEntity {
  name: string;
  ticker: string | null;
  type: "company" | "sector" | "region" | "macro" | "person";
  impact_direction: "positive" | "negative" | "neutral";
  impact_score: number; // -100 to +100
  time_horizon: "immediate" | "short_term" | "medium_term" | "long_term";
  impact_directness: "direct" | "second_order" | "third_order";
  analysis: string; // one sentence
}

interface EntitiesResult {
  entities: ExtractedEntity[];
}

async function runEntityExtraction(article: {
  title: string;
  body: string | null;
  category: string | null;
}): Promise<EntitiesResult> {
  const system = `You are a financial analyst. Extract market-relevant entities EXPLICITLY NAMED in this article and score their impact.

CRITICAL RULES:
1. Only extract companies, people, or entities DIRECTLY NAMED in the headline or body — do NOT infer related companies
2. The primary subject of the headline MUST be the first entity
3. Ticker MUST match the named company exactly (PayPal→PYPL, Starbucks→SBUX, Delta Air Lines→DAL, American Airlines→AAL, Alphabet→GOOGL, Meta→META, etc.)
4. Never assign a ticker based on industry association — only assign it if that company is literally named
5. Max 5 entities

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "entities": [
    {
      "name": string,           // canonical name e.g. "Apple Inc."
      "ticker": string | null,  // US exchange ticker if public e.g. "AAPL", null otherwise
      "type": "company" | "sector" | "region" | "macro" | "person",
      "impact_score": number,   // -100 to +100
      "time_horizon": "immediate" | "short_term" | "medium_term" | "long_term",
      "impact_directness": "direct" | "second_order" | "third_order",
      "analysis": string        // max 8 words
    }
  ]
}`;

  return callJson<EntitiesResult>(
    MODEL_SMART,
    system,
    `Title: ${article.title}\nBody: ${article.body?.slice(0, 800) ?? "(no body)"}`,
    1024,
  );
}

// ---------- Stage 4: Importance Score ----------

interface ScoresResult {
  importance_score: number; // 0–100
  urgency_reason: string;
}

async function runScoring(article: {
  title: string;
  relevance_tier: RelevanceTier;
  is_breaking: boolean;
  entities: ExtractedEntity[];
}): Promise<ScoresResult> {
  const system = `You are a trading desk head prioritizing news for 50 traders.
Assign an overall importance score to this article.

Respond ONLY with valid JSON:
{
  "importance_score": number,  // 0–100 overall market importance
  "urgency_reason": string     // one sentence: why this score
}

Scoring guide:
- 90–100: Fed decisions, systemic risk events, major geopolitical crises
- 70–89: Earnings beats/misses >5%, large M&A (>$5B), major regulatory actions
- 50–69: Analyst upgrades/downgrades, smaller M&A, sector-moving data
- 30–49: Minor earnings, product launches, exec changes
- 0–29: Routine filings, minor analyst notes, low-signal color`;

  const topEntities = article.entities
    .slice(0, 3)
    .map((e) => `${e.name} (${e.ticker ?? e.type}): score ${e.impact_score}, ${e.analysis}`)
    .join("\n");

  return callJson<ScoresResult>(
    MODEL_FAST,
    system,
    `Title: ${article.title}
Breaking: ${article.is_breaking}
Relevance tier: ${article.relevance_tier}
Top entities:\n${topEntities || "(none)"}`
  );
}

// ---------- Main pipeline entry point ----------

export async function processArticle(articleId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: article, error } = await supabase
    .from("articles")
    .select("*")
    .eq("id", articleId)
    .single();

  if (error || !article) {
    console.error(`[pipeline] Article ${articleId} not found: ${error?.message}`);
    return;
  }

  await updateArticleStatus(articleId, "PROCESSING");

  // Stage 1 + 2: Screener + Classifier in parallel (both fast/cheap on Haiku)
  const [screenerResult, classifierResult] = await Promise.allSettled([
    runScreener({ title: article.title, body: article.body }),
    runClassifier({ title: article.title }),
  ]);

  if (screenerResult.status === "rejected") {
    await writeFailedEnrichment(articleId, "screener", null, (screenerResult.reason as Error)?.message ?? "unknown");
    return;
  }
  const screener = screenerResult.value;
  await writeEnrichment(articleId, "screener", screener as unknown as Record<string, unknown>);

  if (!screener.pass) {
    await updateArticleStatus(articleId, "SCREENED_OUT");
    console.log(`[pipeline] ${articleId} screened out (${screener.relevance_tier}): ${screener.reason}`);
    return;
  }

  let category = article.category;
  let isBreaking = article.is_breaking;

  if (classifierResult.status === "rejected") {
    await writeFailedEnrichment(articleId, "classifier", null, (classifierResult.reason as Error)?.message ?? "unknown");
  } else {
    const classifier = classifierResult.value;
    await writeEnrichment(articleId, "classifier", classifier as unknown as Record<string, unknown>);
    category = classifier.category;
    isBreaking = classifier.is_breaking;
    await supabase
      .from("articles")
      .update({ is_breaking: isBreaking, category, status: "ENRICHING" })
      .eq("id", articleId);
  }

  // Stage 3: Entity extraction (Sonnet)
  let entities: ExtractedEntity[] = [];
  try {
    await updateArticleStatus(articleId, "ENRICHING");
    const entitiesResult = await runEntityExtraction({ title: article.title, body: article.body, category });
    entities = entitiesResult.entities;
    await writeEnrichment(articleId, "entities", { entities });

    // Upsert entities + entity_impacts
    for (const entity of entities) {
      // Find or create entity in DB
      let entityId: string;
      const { data: existing } = await supabase
        .from("entities")
        .select("id")
        .eq("name", entity.name)
        .maybeSingle();

      if (existing) {
        entityId = existing.id;
      } else {
        const { data: created, error: createErr } = await supabase
          .from("entities")
          .insert({ name: entity.name, ticker: entity.ticker, type: entity.type })
          .select("id")
          .single();
        if (createErr || !created) continue;
        entityId = created.id;
      }

      await supabase.from("entity_impacts").insert({
        article_id: articleId,
        entity_id: entityId,
        score: entity.impact_score,
        time_horizon: entity.time_horizon,
        impact_directness: entity.impact_directness,
        analysis_text: entity.analysis,
      });
    }
  } catch (err) {
    await writeFailedEnrichment(articleId, "entities", null, (err as Error).message);
    // Non-fatal: continue to scoring with what we have
  }

  // Stage 4: Importance scoring (Haiku)
  try {
    const scores = await runScoring({
      title: article.title,
      relevance_tier: screener.relevance_tier,
      is_breaking: isBreaking,
      entities,
    });
    await writeEnrichment(articleId, "scores", scores as unknown as Record<string, unknown>);
    await supabase
      .from("articles")
      .update({ importance_score: scores.importance_score, status: "DONE" })
      .eq("id", articleId);
    console.log(`[pipeline] ✓ ${articleId} | score:${scores.importance_score} breaking:${isBreaking} tier:${screener.relevance_tier} | ${article.title.slice(0, 60)}`);
  } catch (err) {
    await writeFailedEnrichment(articleId, "scores", null, (err as Error).message);
    await updateArticleStatus(articleId, "DONE"); // still mark done so it appears in feed
  }
}
