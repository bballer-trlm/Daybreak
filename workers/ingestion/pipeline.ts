import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { StageType, RelevanceTier } from "../../lib/supabase/types";
import { fetchSecContent, type SecContent } from "./edgar-fetcher";

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
  source: string;
}): Promise<ScreenerResult> {
  const secHint =
    article.source === "SEC EDGAR"
      ? "\nNote: This is an SEC regulatory filing. Form 8-K, 10-K, 10-Q, S-1, large insider transactions (Form 4), and 424B4 (firm commitment offerings — stock dilution/decline signal) are always at least minor relevance. EXCEPTION: 424B2, 424B3, 424B5, FWP, and other shelf prospectus supplement forms are boilerplate with no news value → always noise, pass: false."
      : "";

  const system = `You are a financial news screener for a hedge fund trading desk.
Evaluate whether a news article is relevant to equity markets and worth full AI analysis.

Respond ONLY with valid JSON:
{
  "pass": boolean,         // true if article warrants full analysis
  "relevance_tier": "material" | "minor" | "noise",
  "reason": string         // one sentence explanation
}

Guidelines:
- "material": breaking news, earnings, M&A, Fed decisions, major geopolitical events, SEC 8-K filings from notable companies → pass: true
- "minor": analyst upgrades/downgrades, product launches, minor data releases, routine SEC filings (Form 4 for small amounts) → pass: true
- "noise": sports, entertainment, unrelated world news, duplicates → pass: false
Target pass rate: ~60%.${secHint}`;

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

// ---------- Stage 2.5: SEC Content Fetch ----------
// Only runs for SEC EDGAR articles. Fetches the actual filing document,
// parses 8-K item numbers, and returns enriched text for downstream stages.

async function runSecContentFetch(
  article: { url: string; title: string; body: string | null }
): Promise<SecContent | null> {
  // Parse form type and company from the body metadata
  // Body format: "SEC Form 8-K (Material Events) filed by COMPANY on DATE..."
  const formTypeMatch = article.body?.match(/SEC Form (\S+)/);
  const companyMatch = article.body?.match(/filed by (.+?) on /);
  const formType = formTypeMatch?.[1] ?? "8-K";
  const company = companyMatch?.[1] ?? article.title.replace(/\s+files Form .+/, "");

  return fetchSecContent(article.url, formType, company);
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

// ---------- Stage 3.5: Summarization ----------

interface SummaryResult {
  summary: string;       // 2–3 sentence plain-English summary of the article
  key_points: string[];  // 2–4 trader-relevant callouts, each ≤12 words
}

async function runSummarization(article: {
  title: string;
  body: string | null;
  source: string;
  category: string | null;
  entities: ExtractedEntity[];
  sec_items?: string[];
  sec_item_labels?: string[];
}): Promise<SummaryResult> {
  const entitiesCtx = article.entities
    .slice(0, 3)
    .map((e) => `${e.name}${e.ticker ? ` (${e.ticker})` : ""}: ${e.analysis}`)
    .join("; ");

  const secCtx =
    article.sec_items && article.sec_items.length > 0
      ? `\nFiling items: ${article.sec_items.map((no, i) => `${no} – ${article.sec_item_labels?.[i] ?? no}`).join(", ")}`
      : "";

  const system = `You are a financial news analyst summarizing articles for equity traders.
Write a concise, factual summary and extract the most tradeable callouts.

Respond ONLY with valid JSON:
{
  "summary": string,      // 2–3 plain-English sentences covering who, what, and market impact
  "key_points": string[]  // 2–4 bullet callouts, each ≤12 words, trader-focused (numbers, % changes, ratings, items)
}

Rules:
- Lead with the most market-moving fact
- Use concrete numbers/percentages from the text when available
- Never say "the article says" or "according to" — state facts directly
- key_points should be self-contained without reading the summary first`;

  return callJson<SummaryResult>(
    MODEL_FAST,
    system,
    `Title: ${article.title}
Source: ${article.source}
Category: ${article.category ?? "general"}${secCtx}
Entities: ${entitiesCtx || "(none)"}
Body: ${article.body?.slice(0, 1000) ?? "(no body)"}`,
    512,
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
  sec_items?: string[];  // 8-K item numbers found in filing
  sec_item_labels?: string[];
}): Promise<ScoresResult> {
  const secItemsContext =
    article.sec_items && article.sec_items.length > 0
      ? `\nSEC Filing Items: ${article.sec_items
          .map((no, i) => `${no} (${article.sec_item_labels?.[i] ?? ""})`)
          .join(", ")}`
      : "";

  const system = `You are a trading desk head prioritizing news for 50 traders.
Assign an overall importance score to this article.

Respond ONLY with valid JSON:
{
  "importance_score": number,  // 0–100 overall market importance
  "urgency_reason": string     // one sentence: why this score
}

Scoring guide:
- 90–100: Fed decisions, systemic risk events, major geopolitical crises, bankruptcy (8-K Item 1.03), change of control (Item 5.01)
- 70–89: Earnings beats/misses >5% (8-K Item 2.02), large M&A (>$5B, Item 2.01), major regulatory actions, delisting notice (Item 3.01), S-1 from notable company
- 50–69: Analyst upgrades/downgrades, smaller M&A, sector-moving data, 10-K/10-Q from major company, executive departure (Item 5.02), Reg FD (Item 7.01)
- 30–49: Minor earnings, product launches, routine Form 4 insider transactions, small company 8-K
- 30–49: 424B4 firm commitment offering (dilutive secondary — minor bearish signal for the issuer)
- 0–29: Routine filings, minor analyst notes, boilerplate disclosures, 424B2/424B3/424B5 prospectus supplements (always 0–5), FWP free writing prospectuses`;

  const topEntities = article.entities
    .slice(0, 3)
    .map((e) => `${e.name} (${e.ticker ?? e.type}): score ${e.impact_score}, ${e.analysis}`)
    .join("\n");

  return callJson<ScoresResult>(
    MODEL_FAST,
    system,
    `Title: ${article.title}
Breaking: ${article.is_breaking}
Relevance tier: ${article.relevance_tier}${secItemsContext}
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
    runScreener({ title: article.title, body: article.body, source: article.source }),
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

  // Stage 2.5: SEC Content Fetch (EDGAR articles only)
  // Fetches the actual filing document and extracts 8-K items + key text.
  let secContent: SecContent | null = null;
  if (article.source === "SEC EDGAR") {
    try {
      await updateArticleStatus(articleId, "ENRICHING");
      secContent = await runSecContentFetch(article);
      await writeEnrichment(
        articleId,
        "sec_content",
        secContent as unknown as Record<string, unknown>
      );
      console.log(
        `[pipeline] SEC content fetched for ${articleId}: form=${secContent!.form_type} items=[${secContent!.items_found.join(",")}]`
      );
    } catch (err) {
      // Non-fatal: log and continue with the placeholder body
      console.warn(
        `[pipeline] SEC content fetch failed for ${articleId}: ${(err as Error).message}`
      );
    }
  }

  // Stage 3: Entity extraction (Sonnet)
  // For SEC articles, use the fetched filing text if available.
  const entityBody = secContent?.primary_text ?? article.body;

  let entities: ExtractedEntity[] = [];
  try {
    await updateArticleStatus(articleId, "ENRICHING");
    const entitiesResult = await runEntityExtraction({
      title: article.title,
      body: entityBody,
      category,
    });
    entities = entitiesResult.entities;
    await writeEnrichment(articleId, "entities", { entities });

    // Upsert entities + entity_impacts
    for (const entity of entities) {
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

  // Stage 3.5: Summarization (Haiku) — non-fatal
  try {
    const summaryResult = await runSummarization({
      title: article.title,
      body: secContent?.primary_text ?? article.body,
      source: article.source,
      category,
      entities,
      sec_items: secContent?.items_found,
      sec_item_labels: secContent?.item_labels,
    });
    await writeEnrichment(articleId, "summary", summaryResult as unknown as Record<string, unknown>);
  } catch (err) {
    console.warn(`[pipeline] Summarization failed for ${articleId}: ${(err as Error).message}`);
  }

  // Stage 4: Importance scoring (Haiku)
  try {
    const scores = await runScoring({
      title: article.title,
      relevance_tier: screener.relevance_tier,
      is_breaking: isBreaking,
      entities,
      sec_items: secContent?.items_found,
      sec_item_labels: secContent?.item_labels,
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
