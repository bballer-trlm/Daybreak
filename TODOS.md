# TODOS

This file tracks deferred work, open questions, and items to address before or during implementation.

---

## P1 — Build Before or During Phase 2

### Entity governance model
**What:** Define who/what can add new entities and tags to the canonical entity DB, how tags are normalized, and how conflicts are resolved.
**Why:** Without this, entity tagging becomes inconsistent across AI runs (MSFT tagged as 'Cloud' in one article, 'cloud-computing' in another), poisoning the entity KB and making the entity_impacts table unreliable.
**Pros:** Consistent tagging = reliable entity-level analytics, better scoring accuracy, cleaner backtesting.
**Cons:** Adds a design step before Phase 2 entity extraction.
**Context:** The entity extraction agent needs a controlled vocabulary or normalization rules before its first prompt is written. Decision: use a seeded canonical tag list (controlled vocabulary) + AI normalization layer that maps free-form tags to canonical equivalents.
**Effort:** S | **Priority:** P1 | **Depends on:** Phase 1 entity schema design

---

### Prompt eval suite + multi-model benchmarking framework
**What:** Two things in one runner: (1) golden test cases (20-30 per agent) for regression detection — run before any prompt change ships; (2) multi-model benchmarking — run all golden cases against N models and output accuracy + latency + cost per model per task, enabling data-driven model selection decisions.
**Why:** Daybreak is model-agnostic by design. Without benchmarking, model selection is guesswork. Without regression tests, prompt changes ship blind. The eval framework serves both purposes.
**Pros:** Catches prompt regressions. Enables data-driven model swaps (accuracy vs. latency vs. cost tradeoffs). Essential for evaluating new model releases. Creates a living benchmark dataset.
**Cons:** Takes time to build golden dataset — needs real examples from live ingestion to be meaningful for financial news.
**Context:** Build the runner scaffolding before Phase 2 AI pipeline work begins. Start with screener (simplest, binary output) and work up to scoring agent (hardest, structured output). Store golden cases in `/evals/cases/`, results in `/evals/results/`. Runner in `/evals/runner.ts`. Integrate regression-detection run into CI. Benchmarking run is manual/periodic.
**Effort:** M | **Priority:** P1 | **Depends on:** Phase 2 AI pipeline design

---

### Options chain data source confirmation (Phase 5 prerequisite)
**What:** Confirm whether SHEL Data Gateway provides real-time options chains with live Greeks (Delta, Gamma, Theta, Vega, IV) for the entities Daybreak tracks. If not, select an alternative source.
**Why:** Delta Hunter and Gamma Hunter both require live options chain data. The hunter models cannot be designed without knowing the data format and update frequency. A feed that provides pre-calculated Greeks is strongly preferred over calculating them in-house.
**Pros:** Unblocks Phase 5 design. If SHEL covers options, no new external dependency.
**Cons:** If SHEL doesn't cover options, adds a new data feed to manage (Tradier, CBOE, or Polygon options — each ~$200-500/mo).
**Context:** Key requirements: (1) real-time Greeks per contract, (2) bid/ask spread data for liquidity filtering, (3) IV surface for move expectation calibration, (4) 0–30 DTE coverage. Verify before Phase 5 sprint planning.
**Effort:** S | **Priority:** P1 (before Phase 5 design) | **Depends on:** Nothing — ask SHEL team

---

### SHEL Data Gateway integration spec
**What:** Document the integration pattern for connecting the `score_outcomes` backfill worker to Trillium's internal SHEL Data Gateway for real-time tick data.
**Why:** `score_outcomes` captures price moves at 1s/5s/10s/30s resolution — requiring a WebSocket tick feed. Without a documented integration spec, the Phase 4 backfill worker will be built on assumptions about the SHEL connection pattern.
**Pros:** Prevents rework when Phase 4 score_outcomes worker is built. Documents entity ticker → SHEL instrument mapping which is non-obvious.
**Cons:** Small upfront documentation effort.
**Context:** Cover: connection/auth pattern, WebSocket message format, entity ticker → SHEL instrument ID mapping, reconnect behavior, and error handling if SHEL is unavailable (score_outcomes rows stay NULL for that time bucket).
**Effort:** S | **Priority:** P1 | **Depends on:** Nothing — write before Phase 4 begins

---

### User feedback signals schema + curated feed logic
**What:** Design and implement the `user_feedback` table and the Curated vs. Wire two-view model. The feedback table stores per-user, per-article preference signals (positive = "should have been curated", negative = "not relevant") from the Wire and Curated feed views. The curated feed is a filtered + ranked subset of the Wire, driven by Daybreak Score + user feedback weights + entity watchlist signals.
**Why:** Daybreak's core differentiation is that it does the filtering for the trader — not the user. Without feedback signals feeding back to the screener/scorer, the Curated tab is just a static score filter, not a learning system.
**Pros:** Curated tab improves per-trader over time without manual filter config. Creates defensible personalization moat. Watchlist additions become implicit preference signals.
**Cons:** Requires per-user state (Supabase RLS, user_id on feedback rows). Curated ranking logic is non-trivial — needs to balance recency, score, and feedback weights. Cold start problem: new traders have no signals, Curated defaults to score-only until feedback accumulates.
**Context:** DESIGN.md describes the full UX model: two tabs (Curated / Wire), `↑`/`↓` nudge affordance on row hover, "N Misses" indicator in tab bar, brief toast on signal submit. DB table needed: `user_feedback(id, user_id, article_id, signal [positive|negative], source_view [curated|wire], created_at)`. Curated ranking function: `score * recency_decay * entity_match_boost * feedback_weight`. Start with score-only, add feedback weights in a second pass once feedback data accumulates from real usage.
**Effort:** M | **Priority:** P1 (before Phase 2 frontend) | **Depends on:** Phase 1 auth + article schema

---

### Per-feed metadata configuration + column customization
**What:** Design the feed configuration data model and UI for (1) per-source-feed metadata fields (ticker column, topics, regions, authors, people — varies by feed) and (2) per-user column visibility/order preferences for the Wire view.
**Why:** Incoming feeds have heterogeneous structured metadata — some have a ticker column, some have topics/regions/authors. Without a config layer, the Wire view either shows everything (noisy) or nothing (loses signal). Column customization is also critical for real estate management on diverse monitor setups.
**Pros:** Each feed's unique metadata is surfaced appropriately. Traders can configure the Wire to match their workflow. User preferences are persisted and portable.
**Cons:** Adds a feed config data model (feeds table, feed_metadata_schema JSONB, user_column_prefs table). The ⚙ Feeds drawer UI has moderate complexity.
**Context:** DESIGN.md defines the UI pattern: slide-over drawer (not modal), accessed via `[⚙ Feeds]` button. Feed config stores: which feeds active, which metadata fields available per feed. Column prefs store: ordered list of visible columns per user. Columns: urgency stripe (fixed), flags (optional), timestamp-ms (optional), source (optional), headline (fixed), score (optional). DB tables: `feed_sources(id, name, base_url, metadata_schema jsonb)`, `user_column_prefs(user_id, column_order jsonb)`.
**Effort:** M | **Priority:** P1 (before Phase 2 Wire view) | **Depends on:** Phase 1 ingestion pipeline

---

## P2 — Good Practice

### pgvector novelty corpus backfill
**What:** After Phase 2 novelty scorer ships, run a one-time backfill worker to embed all existing material-tier screener-passed articles and populate `article_enrichment_entities` rows for them.
**Why:** Articles ingested before the novelty stage existed have no embeddings. Without backfill, novelty defaults to 100 (no history found = assumed novel), which overstates novelty and makes the first few weeks of novelty scoring noisy.
**Pros:** Novelty baseline is accurate from day 1 of Phase 2 launch. Traders immediately see meaningful "Previously reported" signals.
**Cons:** One-time operational task. Requires iterating over existing `article_enrichments` rows and calling the embedding model for each material-tier article.
**Context:** The system degrades gracefully (novelty=100 default) so this is not a launch blocker. However, it should run within the first week after Phase 2 launches or the novelty signal will be unreliable. The backfill worker can reuse the same embedding function from the novelty stage pipeline.
**Effort:** S | **Priority:** P2 (post-Phase 2 launch) | **Depends on:** Phase 2 novelty scorer implementation

---
