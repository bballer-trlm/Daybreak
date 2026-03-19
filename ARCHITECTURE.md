# DAYBREAK — Real-Time Market Intelligence Platform
**Trillium | March 2026 | Confidential**
Prepared by: Ben | Status: Working Draft v0.1

---

## 1. Executive Summary

Daybreak is a real-time market intelligence platform built for Trillium traders. It ingests breaking financial news, classifies urgency, identifies impacted entities (companies, sectors, regions), scores directional impact, and delivers actionable intelligence to 50+ traders with minimal latency.

The platform is being rebuilt from scratch using Nash (by The Manhattan Computation Company) as an architectural reference. Key differentiators from generic AI news tools: sub-second headline delivery with progressive AI enrichment, entity-level scoring with directional magnitude and time horizon, and deep research capabilities powered by multi-agent orchestration.

The build will be executed as a solo engineering effort with heavy AI-assisted development (Claude Code, Cursor), targeting Trillium internal use at launch.

**Scope additions (CEO review, 2026-03-17):**
- Regulatory radar: SEC/EDGAR, FTC, DOJ, CFTC as first-class ingestion sources (Phase 1)
- Keyboard-first power user navigation (Phase 1)
- Entity hover cards + "What just moved?" reverse lookup (Phase 2)
- Earnings call live transcription + real-time analysis (Phase 3)
- Internal API layer (REST + WebSocket) for quant model consumption (Phase 3)
- Daybreak Score signal validation + backtesting (Phase 4)
- Historical scenario matching via vector similarity search (Phase 4)

---

## 2. Product Vision

### Core Concept: The Living Headline

Every market event in Daybreak is a living object that progressively enriches over time. A trader sees the raw headline within milliseconds of ingestion. Within seconds, the headline lights up with entity tags, directional scores, breaking classification, and contextual research. This stepped reveal pattern is the fundamental UX and architectural principle.

| Stage | Latency Target | What Trader Sees | Processing |
|---|---|---|---|
| 1. Raw Headline | < 500ms from source | Headline text, source, timestamp | WebSocket push, zero processing |
| 2. Classification | < 1 second | Breaking badge, category tag | Fast classifier (Gemini Flash / Haiku) |
| 3. Entity Tagging | 1–2 seconds | Ticker badges, sector labels | Entity extraction + DB lookup |
| 4. Initial Scoring | 2–3 seconds | Directional scores (-100 to +100) | Scoring agent with market context |
| 5. Deep Analysis | 5–30 seconds | Full research report, citations | Multi-researcher orchestration |

---

## 3. Phased Roadmap

The build is structured in four phases. Each phase produces a usable increment — traders get value from Phase 1, and each subsequent phase deepens the intelligence layer.

### Phase 1: The Wire (Weeks 1–6)
**Goal:** Get real-time headlines flowing to traders faster than anything they currently have. Establish the data pipeline and the core frontend shell.

| Component | Scope | Deliverable |
|---|---|---|
| News Ingestion | Major news wires (Reuters, Bloomberg, AP, Dow Jones), government press releases, corporate press releases (PR Newswire, Business Wire, GlobeNewswire), social media feeds (X/fintwit, key financial accounts), industry-specific publications (configurable list) | Headline pipeline delivering to Supabase with < 500ms internal latency |
| Regulatory Radar *(new)* | SEC EDGAR filings, FTC/DOJ merger/antitrust filings, CFTC reports as first-class ingestion sources. Often precede news wire coverage by minutes. Public APIs, simpler parsing than wire feeds. | Regulatory filings in feed alongside news wires |
| Frontend Shell | Real-time headline feed with WebSocket streaming, filterable by source/category/recency, dark terminal aesthetic consistent with Trillium brand, responsive layout optimized for desktop multi-monitor setups | Web app deployed on Vercel, accessible to all Trillium traders |
| Keyboard Navigation *(new)* | J/K to navigate headlines, Space to expand, R to trigger deep research, S to star/bookmark, F to filter by entity. Terminal traders live on keyboards. | Keyboard shortcut map documented and implemented in frontend |
| Auth & Access | SSO or simple auth for Trillium users, role-based access (trader, admin) | Secure access for 50+ concurrent users |


### Phase 2: The Brain (Weeks 5–12)
**Goal:** Layer AI intelligence onto every headline. Overlaps with Phase 1 tail end.

| Component | Scope | Deliverable |
|---|---|---|
| Breaking News Classifier | AI agent classifying whether a headline is truly breaking; handles initial break vs. follow-up color; sub-second classification using fast model (Gemini Flash or Haiku) | Breaking/not-breaking classification on every headline within 1 second |
| Entity Extraction & Tagging | Identify companies, sectors, regions, macro themes from headline + body; map to canonical entity DB; Nash-style dynamic labels (e.g. MSFT → Cloud, Gaming, Enterprise); render as clickable ticker badges. **Requires entity governance model — see TODOS.md.** | Entity tags appearing on headlines within 2 seconds |
| Event Scoring Engine | Directional score per entity: -100 to +100 (magnitude + direction); time horizon classification (immediate, short-term, medium-term, long-term); impact directness (direct, second-order, third-order); importance/urgency score | Scored entities with directional badges on each headline |
| Screener Agent | Pre-filter determining if a headline warrants full analysis; configurable sensitivity thresholds; prevents wasted compute on low-signal noise. **Target ≤40% pass rate.** | Cost-optimized pipeline that only runs full analysis on material events |
| Entity Hover Cards *(new)* | When a trader hovers over a ticker badge: mini popup showing a 5-day spark chart, last 3 Daybreak scores for that entity, one-line AI sentiment summary. All data already in DB. | Hover card component on entity badges |
| "What Just Moved?" Reverse Lookup *(new)* | Ticker search panel: trader enters a symbol and instantly sees all recent headlines, scores, and research Daybreak has on that entity. The "why is this moving?" answer. | Entity lookup panel in frontend |
| Prompt Safety | All article body text bracketed with XML delimiters + explicit "untrusted content" role separation in every AI prompt. Prevents prompt injection via malicious or compromised article content. | Security-reviewed prompt templates for all pipeline agents |

### Phase 3: The Analyst (Weeks 10–18)
**Goal:** Deep research capabilities. Multi-agent researcher pipeline and chat interface.

| Component | Scope | Deliverable |
|---|---|---|
| Multi-Agent Researcher | Manager agent decomposes market events into research questions; spawns 1–25 researcher agents in parallel; each researcher investigates a specific angle with tool access (web search, DB queries, entity history); synthesis agent compiles findings into structured report | Full analysis reports on high-impact events within 30 seconds |
| Research Chat Interface | Conversational interface for ad-hoc queries against Daybreak's knowledge base; access to entity DB, historical events, analysis archive; tool-calling for real-time data enrichment; context-aware (knows trader's watchlist and positions) | Chat panel in terminal UI for trader queries |
| Entity Knowledge Base | Persistent DB of companies, sectors, macro themes; dynamic tagging (company → multiple industries/exposures); historical event impact tracking per entity; exposure matrices (company → commodity, FX, rates, supply chain) | Structured entity DB powering all analysis and chat |
| Earnings Call Live Analysis *(new)* | When an earnings call begins, Daybreak streams and transcribes the audio in real-time (Whisper streaming or Gemini Live). Key moments surfaced as they happen: guidance changes, unusual CFO language, analyst Q&A tone shifts. 20-30 min edge over post-transcript news. Feature flag at launch. | Live earnings analysis panel, integrated with headline feed |
| Internal Quant API *(new)* | REST + WebSocket API exposing entity scores, breaking classifications, and analysis results to Trillium's quant team for use in trading models. Read-only. Per-team API key auth. No new infra required — query layer on existing DB. | Internal API with documentation for quant team onboarding |

### Phase 4: The Edge (Weeks 16–24)
**Goal:** Features that compound Daybreak's value over time — personalization, alerting, upcoming events, analytics, historical pattern matching.

| Component | Scope | Deliverable |
|---|---|---|
| Email Alerts & Digests | Urgent alerts for high-impact events affecting watchlist; personalized morning/EOD digests ranked by portfolio relevance; configurable thresholds per trader | Email delivery of urgent alerts and daily recaps |
| Upcoming Events Calendar | AI-detected future events from news flow; CEO appearances, earnings dates, tariff deadlines, regulatory actions; portfolio-aware prioritization | Calendar view of upcoming market-moving events |
| Analytics & Historical | Query how events impacted entities over time; price reaction tracking for scored entities | Analytics dashboard with historical event intelligence |
| Live Price Data | Real-time price feeds for tagged entities alongside analysis; price reaction charts post-event; integration with Financial Modeling Prep or similar | Price data overlaid on event analysis |
| Daybreak Score Validation *(new)* | Track how Daybreak's directional scores correlate with actual price moves. **Primary benchmark: T+1m, T+2m, T+5m, T+10m, T+30m** — matching Trillium traders' seconds-to-minutes hold times. Also capture T+1d through T+5d for future analysis. Dashboard: "When Daybreak scored ≤-70 on earnings, the stock moved -1.8% in the first 5 minutes." Turns narrative scores into quantitative signals with trader-relevant resolution. Builds trust and creates defensible IP. | Score backtesting dashboard (trader-visible), with intraday resolution as primary view |
| Historical Scenario Matching *(new)* | When a major event hits, search historical corpus for similar patterns using pgvector similarity search. "This tariff announcement is 84% similar to March 2018 — here's what moved in the 72h window." Requires pgvector extension on Supabase + HNSW index. Feature flag at launch (needs minimum corpus size). | Scenario matching panel in headline detail view |

### Phase 5: The Trade (Weeks TBD)
**Goal:** Close the loop from market intelligence to actionable trade recommendation. Given a Daybreak event score, compute a move expectation for the underlying and output a specific options trading plan via two specialized hunter models.

| Component | Scope | Deliverable |
|---|---|---|
| Move Expectation Engine | Translates a Daybreak directional score (-100/+100) + entity + time horizon into a probability-weighted expected price move: magnitude (%), direction, and confidence interval. Feeds directly into hunter model selection. Example output: "AAPL: -3.5% ± 1.2% over next 30 minutes (high confidence)." Draws on historical `score_outcomes` for calibration. | Expected move output on every scored entity, displayed alongside Daybreak score |
| Options Chain Feed | Real-time options chains for scored entities: strikes, expiries, bid/ask, IV, and live Greeks (Delta, Gamma, Theta, Vega). Sourced from SHEL Data Gateway if options data is available; otherwise a dedicated options feed (Tradier, CBOE, or Polygon options). **Verify SHEL options coverage before Phase 5 design.** | Live options chain data available to hunter models |
| Delta Hunter | Given move expectation + options chain, finds the optimal near-term directional option to buy. Selection criteria: delta in target range (configurable, e.g., 0.30–0.55 for balanced risk/reward), nearest expiry with sufficient liquidity, best risk/reward ratio given the expected move magnitude. Outputs: contract (symbol, strike, expiry), entry price, target exit, max loss, delta at entry, rationale. | Recommended directional option trade per scored entity |
| Gamma Hunter | Optimizes for near-term gamma exposure. Targets ATM or near-ATM options with 0–7 DTE where gamma is highest per dollar. The play is on speed of move rather than direction alone — suited for high-importance, high-certainty events where the magnitude is the signal. Outputs: contract, entry price, gamma at entry, break-even move %, max loss, rationale. | Recommended gamma-optimized option trade per high-importance event |
| Trading Plan Output | Structured recommendation card displayed in the headline detail view alongside the Daybreak score and deep analysis. Shows: hunter model used, contract details, entry/target/stop, Greeks at entry, expected move used as input, confidence level. All outputs carry an internal disclaimer (not investment advice — trader decision tool). | Options trade recommendation card in headline detail view |

**Phase 5 prerequisites:**
- Phase 4 live price data and `score_outcomes` backtesting must be live (hunter models need calibrated move expectations)
- Options chain data source confirmed (SHEL Data Gateway coverage check or alternative source selected)
- Compliance/legal review of outputting structured trade recommendations to internal traders
- Move Expectation Engine accuracy baseline established from `score_outcomes` data before hunter models go live

---

## 4. Technical Architecture

### 4.1 Architecture Principles

Every architectural decision in Daybreak optimizes for one thing: **latency from headline to trader.**

1. **Stream everything.** Headlines are never request-response. Every headline is a subscription that progressively enriches. The frontend subscribes to a headline's lifecycle from the moment it arrives.
2. **Process in parallel, render incrementally.** Classification, entity extraction, scoring, and research all run concurrently. Each stage pushes results to the frontend as it completes. The trader never waits for the slowest step.
3. **Fail gracefully, never block.** If an AI model is slow or errors, the headline still shows. If entity tagging fails, the score still runs. Every pipeline stage is independent and fault-tolerant.

### 4.2 Recommended Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js 15 (App Router) + React | SSR for initial load, React Server Components for data-heavy pages. Massive ecosystem. |
| Real-Time Layer | Supabase Realtime (Postgres Changes) + WebSockets | Listens to DB inserts/updates and pushes to clients via WebSocket channels. Zero custom pub/sub infrastructure. Sub-100ms DB-to-browser. |
| Database | Supabase (Postgres) | Realtime built in. Row Level Security for multi-user access. Full SQL for analytics queries. Nash used it successfully. |
| Backend / API | Next.js API Routes (Vercel) + Railway Workers | API routes handle frontend requests. Railway runs long-lived ingestion workers and cron jobs. Same split Nash uses. |
| AI Models | Gemini 2.5 Flash (classification), GPT-5 or Claude Opus (deep analysis), Perplexity Sonar Pro (web research) | Fast models for latency-critical steps. Heavy models for deep reasoning. Perplexity for real-time web context. |
| Ingestion Workers | TypeScript on Railway (long-running processes) | Persistent processes monitoring RSS/API feeds. Cannot run on serverless due to connection persistence requirements. |
| Auth | Supabase Auth + Microsoft Azure AD OAuth | Trillium uses M365. Azure AD OAuth via Supabase Auth's built-in OAuth provider support. Role-based access (trader, admin) enforced via Supabase RLS. No NextAuth dependency needed. |
| Hosting | Vercel (frontend + API) + Railway (workers) | Vercel for edge-optimized frontend delivery. Railway for compute-heavy background jobs. |
| Language | TypeScript (primary), Python (where needed) | TypeScript end-to-end for consistency. Python only for specific ML/data tasks. |
| Monitoring | Vercel Analytics + Supabase Dashboard + custom error tagging | Custom error columns on analysis_results for pipeline debugging. |

### 4.3 Data Flow: Headline Lifecycle

| # | Step | What Happens | Latency | Infra |
|---|---|---|---|---|
| 1 | Source Emit | News wire / RSS / API publishes headline | 0ms (external) | External feeds |
| 2 | Ingestion Worker | Worker detects new item, parses headline + metadata, writes to `articles` table with `status = PENDING` | < 200ms | Railway worker |
| 3 | Realtime Push | Supabase Realtime detects INSERT, pushes to all subscribed clients via WebSocket | < 100ms | Supabase Realtime |
| 4 | Trader Sees Headline | Raw headline appears in feed. No AI processing yet. Source, timestamp, category visible. | < 500ms total | Next.js frontend |
| 5 | AI Pipeline Trigger | DB trigger or polling worker kicks off parallel AI jobs: screener, breaking classifier, entity extractor | < 100ms | Railway / Supabase function |
| 6 | Screener Check | Fast model determines if headline warrants full analysis. If no → `SCREENED_OUT`. If yes → continues. | < 500ms | Gemini Flash / Haiku |
| 7 | Classification + Entities | Breaking classifier and entity extractor run in parallel. Results written to articles row as they complete. | 500ms–1.5s | Fast models |
| 8 | Scoring | Scoring agent uses entity list + headline context to assign directional scores. Written to `entity_impacts` table. | 1–3s | GPT-5 / Opus |
| 9 | Progressive Render | Each DB update triggers Realtime push. Frontend renders new data incrementally — badges, scores, tags animate in. | Continuous | Supabase Realtime |
| 10 | Deep Analysis | For high-importance events: multi-researcher pipeline produces full report. Appended to headline detail view. | 5–30s | Multi-model orchestration |

### 4.4 Core Database Schema (Simplified)

The schema is designed around the living headline concept. The `articles` table is the spine; related tables extend it as AI stages complete.

| Table | Purpose | Key Columns | Realtime |
|---|---|---|---|
| `articles` | Raw headlines and metadata | `id, title, body, source, author, url, published_at, status, is_breaking, importance_score, category, created_at` | INSERT-only subscription (enrichment updates use `article_enrichments`, not article row updates — keeps Realtime payload small and avoids broadcasting full body on every stage completion) |
| `entity_impacts` | Per-entity scores for each article | `id, article_id, entity_id, score (-100 to +100), time_horizon, impact_directness, analysis_text` | INSERT subscription (linked to article) |
| `entities` | Canonical entity registry | `id, name, ticker, type (company/sector/region/macro), sector, industry` | Reference table |
| `tags` | Canonical tag vocabulary | `id, name, canonical_name` | Reference table |
| `entity_tags` | Entity ↔ tag junction | `entity_id, tag_id` (indexed both ways) | Reference table |
| `model_config` | Runtime AI model selection | `task, primary_model, fallback_model, max_tokens, temperature, updated_at` | Reference table |
| `pipeline_jobs` | BullMQ job metadata mirror (optional) | `id, article_id, stage, status, attempts, next_retry_at` | Admin/debug only |
| `analysis_results` | Full AI analysis reports | `id, article_id, report_text, model_used, latency_ms, error_status, error_detail, created_at` | INSERT subscription |
| `upcoming_events` | AI-detected future events | `id, source_article_id, event_description, expected_date, importance` | INSERT subscription |
| `upcoming_event_entities` | Junction: upcoming events ↔ entities | `id, event_id, entity_id` (indexed both ways) | Reference table |
| `article_enrichments` | AI enrichment deltas (separate from article body to reduce Realtime payload size) | `id, article_id, stage_type, data jsonb, created_at` | INSERT subscription |
| `article_enrichment_entities` | Junction: enrichment rows ↔ entities (for fast entity-based novelty queries without JSONB scanning) | `id, enrichment_id, entity_id` (indexed both ways — replaces JSONB entity array lookups) | Reference table |
| `feed_sources` | Ingestion source registry with quality signal | `id, name, base_url, metadata_schema jsonb, market_moving_score float, created_at` | Reference table |
| `author_quality` | Per-author quality scores by headline type | `id, author_id, topic, quality_score float, sample_count int, updated_at` | Reference table |
| `user_watchlist` | Per-user entity watch list | `id, user_id, entity_id, created_at` | Reference table |
| `user_feedback` | Per-user per-article nudge signals (↑/↓) from Curated and Wire views | `id, user_id, article_id, signal (positive\|negative), source_view (curated\|wire), created_at` | Reference table |
| `user_column_prefs` | Per-user Wire view column visibility and order | `user_id, column_order jsonb` | Reference table |
| `score_outcomes` | Actual price moves post-scoring, for backtesting | `id, entity_impact_id, price_at_score, price_1s, price_5s, price_10s, price_30s, price_1m, price_2m, price_5m, price_10m, price_30m, price_1d, price_2d, price_3d, price_4d, price_5d, created_at` | Reference table |
| `move_expectations` | Computed expected move per entity_impact | `id, entity_impact_id, direction, magnitude_pct, confidence_interval_pct, confidence_level, time_horizon_minutes, model_version, created_at` | INSERT subscription |
| `trade_recommendations` | Hunter model output per move expectation | `id, move_expectation_id, hunter_model (delta\|gamma), contract_symbol, strike, expiry, entry_price, target_exit, max_loss, delta_at_entry, gamma_at_entry, rationale, created_at` | INSERT subscription |

**Note on Realtime payload size:** The `articles` table Realtime subscription broadcasts the full row on UPDATE. With large `body` fields, this can reach 10-50KB × 50 clients per update. AI enrichment stages write to `article_enrichments` instead of updating the `articles` row directly. Frontend subscribes to `article_enrichments` for progressive updates; fetches `articles.body` on demand only.

### 4.5 AI Pipeline Architecture

**Screener Agent:** First gate. Runs on every ingested headline. Uses a fast, cheap model (Gemini 2.5 Flash or Haiku). Outputs: `pass/fail` + `relevance_tier: material | minor | noise`. `material` = substantive market-moving content; `minor` = some signal but low urgency; `noise` = irrelevant. Only `material` and `minor` headlines continue through the pipeline. `material`-tier headlines are also used as the novelty scoring corpus. Configurable thresholds prevent wasted compute on noise. Target: ≤40% pass rate overall.

**Novelty Scorer:** Runs after entity extraction (requires entity IDs). Queries `article_enrichment_entities` for all `material`-tier enrichments for the same entity in the last 6 months to establish how many similar headlines exist historically. Score: 0–100 (100 = no prior similar headlines = genuinely novel; 0 = near-duplicate of recent headlines). New entities default to 100 (no history = assumed novel). Uses pgvector cosine similarity to compare headline embeddings against the historical material-tier corpus. Results written as `article_enrichments` row with `stage_type = 'novelty'`. Feeds into scoring agent as a novelty signal.

**Breaking News Classifier:** Runs in parallel with the screener. Determines if a headline represents genuinely breaking news. Key complexity: only the initial report of a major event gets the BREAKING tag — follow-up articles receive it only if they contain substantive new information. Requires understanding context of recent headlines on the same topic.

**Entity Extraction Agent:** Identifies all entities impacted by the headline. Maps free-text mentions to the canonical entity database. Handles ambiguity (e.g., "Apple" the company vs. apple the commodity). Tags entities with dynamic classifications that may differ from static industry codes (e.g., MSFT tagged as Cloud + Gaming + Enterprise depending on news context).

**Scoring Agent:** Assigns directional scores to each extracted entity. The Daybreak Score ranges from -100 (catastrophic negative) to +100 (strongly positive). Also assigns time horizon (immediate / short-term / medium-term / long-term) and impact directness (direct / second-order / third-order). Requires the strongest reasoning model.

**Multi-Agent Researcher:** For high-importance events only. A manager agent decomposes the event into 1–25 research questions. Each question is assigned to an independent researcher agent with tool access (web search via Perplexity, Daybreak DB queries, entity history lookups). Results flow to a synthesis agent that compiles a final structured report with citations. Most compute-intensive stage; runs asynchronously.

### 4.6 Model Strategy

| Task | Primary Model | Fallback | Rationale |
|---|---|---|---|
| Screener | Gemini 2.5 Flash | Claude Haiku | Speed + cost. Processes every headline. |
| Breaking Classifier | Gemini 2.5 Flash | Claude Haiku | Speed-critical. Must return within 1 second. |
| Entity Extraction | Gemini 2.5 Flash | GPT-4o | Structured output. Speed matters. |
| Scoring | GPT-5 / Claude Opus | Gemini 2.5 Pro | Requires strong reasoning. Accuracy > speed. |
| Deep Research | Claude Opus + Perplexity Sonar Pro | GPT-5 | Complex multi-step reasoning with web search. |
| Research Chat | Claude Opus / GPT-5 | Claude Sonnet | Conversational depth. Tool-calling capability. |

---

## 5. Cost Estimates

Assumes ~11,000 articles/week ingested (Nash's reported average), with screener filtering ~60% before full analysis.

| Cost Category | Low Estimate | High Estimate | Notes |
|---|---|---|---|
| AI API Costs | $2,000/mo | $5,000/mo | Scales with volume. Screener reduces full analysis runs. |
| Vercel Hosting | $20/mo | $150/mo | Pro plan. May need Team for 50+ users. |
| Railway Workers | $50/mo | $200/mo | Depends on number of ingestion workers. |
| Supabase | $25/mo | $100/mo | Pro plan. Realtime connections for 50+ users. |
| Financial Data APIs | $50/mo | $300/mo | FMP or similar. Phase 4 cost. |
| **Total (Monthly)** | **~$2,150/mo** | **~$5,750/mo** | AI costs dominate |

---

## 6. Key Risks & Mitigations

| Risk | Impact | Mitigation | Likelihood |
|---|---|---|---|
| Model drift / quality degradation | Scoring accuracy drops without warning | Eval suite with test events. Periodic benchmarking. Model fallback chains. | Medium |
| API rate limits / outages | Pipeline stalls, headlines queue up | Multi-model fallback. Graceful degradation — headlines still flow without AI enrichment. | Medium |
| Solo builder bottleneck | Development velocity constrained by one person | AI-assisted development. Phased delivery. Ruthless scope management. | High |
| News source reliability | Ingestion gaps if feeds change format or go down | Multiple redundant sources. Feed health monitoring. Alerting on ingestion volume drops. | Medium |
| Latency creep | Progressive enrichment takes > 5 seconds, trader value diminished | Latency instrumentation from day one. Performance budgets per pipeline stage. Fast model selection. | Low–Medium |
| Cost escalation | AI API costs exceed budget as volume scales | Screener agent aggressively filters. Cache repeated entity lookups. Batch similar headlines. | Medium |

---

## 7. Immediate Next Steps

- **Finalize system diagrams** — Ben to update and share architecture diagrams for review and refinement.
- **Set up development environment** — Initialize Next.js project, Supabase instance, Railway account. Establish CI/CD pipeline.
- **Prototype news ingestion** — Build first ingestion worker for one major news wire. Validate end-to-end latency from source to Supabase. Add SEC EDGAR as a second source alongside wire feeds.
- **Prove the Realtime pattern** — Build minimal frontend that subscribes to `article_enrichments` table via Supabase Realtime (not `articles` — see payload size note in §4.4). Verify < 500ms insert-to-render.
- **Design entity schema + governance model** — Define the canonical entity model and tag normalization rules before Phase 2 entity extraction is built. (See TODOS.md)
- **Build screener + breaking classifier POC** — Test Gemini Flash and Haiku for classification speed and accuracy. Establish baseline metrics.
- **Start DECISIONS.md** — First entries: why Supabase+Railway, why Nash as reference, why Gemini Flash for classification. (See TODOS.md)

## 8. Architecture Decisions & Constraints

1. **Pipeline ordering:** Screener + Breaking Classifier run first in parallel (both fast/cheap). If screener passes → Entity Extraction runs. After entity extraction → Scoring runs. Entity extraction and scoring do NOT run in parallel (scoring requires extracted entities).

2. **Pipeline trigger: pg_notify → Railway listener + 30s safety-net poll.** On article INSERT, Postgres fires `NOTIFY articles_pending`. A persistent Railway worker has a `LISTEN articles_pending` connection and wakes immediately — zero polling overhead, no 60s serverless timeout constraint. This is the only trigger mechanism that meets the <500ms headline delivery SLA. Additionally, a 30-second safety-net poll queries `WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '30 seconds'` — catches any articles that missed the pg_notify event due to a transient connection drop. Belt-and-suspenders: fast path via pg_notify, slow path via poll.

3. **Job queue: BullMQ + Redis on Railway.** Concurrency, retry logic (max 3 attempts, exponential backoff), rate limiting, and priority queuing are all built-in. Redis instance runs on Railway alongside the worker. Concurrency limits: max 10 concurrent Gemini Flash calls, max 3 concurrent Opus/deep-research calls.

4. **Realtime subscription model: hybrid.** Feed subscribes to `articles` INSERT channel (broadcast, all clients). Enrichment detail — `article_enrichments`, `entity_impacts`, `analysis_results` — uses filtered channels per `article_id`, subscribed only when trader expands a headline. Minimizes WebSocket traffic during burst periods.

5. **Realtime payload management:** AI enrichment stages write to `article_enrichments` (delta rows), not to `articles` (which contains the full body). Stage output shape is typed per `stage_type` enum and validated with Zod before insert. `stage_type` values: `screener | classifier | entities | novelty | scores | research | earnings`. On Zod validation failure: write a `FAILED_{STAGE}` enrichment row with `data.raw_output` preserved (for debugging), then continue pipeline downstream — pipeline does not halt on a single stage validation failure. Frontend degrades gracefully (shows headline without that stage's enrichment).

6. **Entity tags: junction table.** `entity_tags(entity_id, tag_id)` + `tags(id, name, canonical_name)`. Fully indexed. Supports efficient "find all entities tagged X" queries. Array columns forbidden for this use case.

7. **Entity cache on worker: in-memory Map, background refresh every 9 minutes.** Full `entities` + `entity_tags` dataset loaded at Railway worker startup into a `Map<ticker, Entity>`. A dedicated background timer refreshes the cache every 9 minutes (before the 10-minute staleness threshold). This avoids the thundering herd problem where a 10-minute TTL expiry causes multiple concurrent workers to simultaneously query the DB on cache miss. The refresh is proactive, not reactive — cache is always warm. Reduces entity lookup latency from ~20ms (Supabase round trip) to <1ms.

8. **Model config: Supabase `model_config` table.** Schema: `(task, primary_model, fallback_model, max_tokens, temperature, updated_at)`. Workers read config at startup and cache with a short TTL (e.g., 5 min). Admin can swap models without redeploy. Enables A/B model testing and emergency rollback. No model names hardcoded in worker code.

9. **Tick price data: SHEL Data Gateway.** Trillium's internal real-time tick data feed. Used for populating `score_outcomes` at 1s/5s/10s/30s resolution. Async backfill worker subscribes to SHEL for entities with recent `entity_impacts` and writes price snapshots as they arrive.

10. **Dead letter queue:** Any article in a non-terminal state >5 minutes → `FAILED_[STAGE]` status + alert. BullMQ handles retries (max 3, exponential backoff). After 3 failures → `FAILED_PERMANENT`. Article remains visible in feed without AI enrichment — graceful degradation, not blank state.

11. **Prompt safety:** All article body text wrapped in XML delimiters (`<article-content>...</article-content>`) with explicit "untrusted external content" instruction in every AI prompt. No exceptions.

12. **Idempotent article ingestion:** `INSERT INTO articles ... ON CONFLICT (url) DO NOTHING`. Prevents duplicate articles if a worker restarts mid-batch or multiple workers see the same feed item.

13. **Breaking classifier context window: Redis per-ticker per-day.** Key: `daybreak:breaking:{ticker}:{YYYYMMDD}` — Redis `SET` of article_ids seen for that ticker today. TTL: 48h (covers overnight + weekend time zone edge cases), set via `EXPIRE` on every `SADD`. On classification, inject today's seen article_ids for the same ticker as dedup context. Multi-worker safe (shared Redis, not per-worker in-memory). Old in-memory LRU approach was single-worker only and would miss articles processed by other workers.

14. **Entity DB is append-only:** Never delete or rename existing entities/tags. Only add new ones. Preserves referential integrity of all historical `entity_impacts` and `score_outcomes`.

15. **pgvector enabled at Phase 1 schema setup.** `pgvector` Supabase extension enabled in the Phase 1 migration (not deferred to Phase 4). Embeddings are generated and stored for all `material`-tier screener-passed headlines from day 1. This builds the novelty scoring corpus incrementally so Phase 2 novelty scorer has meaningful history on launch. HNSW index for sub-200ms similarity queries at corpus scale. Embeddings stored on `article_enrichments` rows (stage_type=screener, data.embedding). Phase 4 historical scenario matching uses the same corpus.

16. **Model fallback contract.** Primary model timeout threshold: 15 seconds. Fallback is triggered on: timeout (>15s), rate limit (429), or 5xx server error. On fallback model call, same timeout applies. If both primary and fallback fail: write `FAILED_{STAGE}` enrichment row with `data.raw_output` preserved (for debugging + potential retry), set article status to `FAILED_{STAGE}`. Article remains visible in feed without that enrichment stage — graceful degradation, not blank state. No silent swallowing of failures.

17. **article_enrichment_entities junction table for novelty queries.** The novelty scorer queries entity-scoped historical headlines. Rather than scanning `article_enrichments.data JSONB` with a GIN index (expensive as corpus grows), a denormalized junction table `article_enrichment_entities(enrichment_id, entity_id)` enables fast FK-indexed lookups. Populated whenever entity extraction writes an enrichment row. Query pattern: join `article_enrichment_entities` on `entity_id` → join `article_enrichments` on `id` → filter by `stage_type = 'screener'` and `relevance_tier = 'material'` and `created_at > 6 months ago`.

16. **Latency SLA test is a CI gate:** A named integration test asserts that an article INSERT produces a Realtime push received by a subscribed client within 500ms (p95). Runs against staging Supabase on every PR. Build fails if SLA is breached.
