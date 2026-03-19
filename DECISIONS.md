# DECISIONS.md — Daybreak

A running log of architectural and product decisions made during the Daybreak build.
Each entry: the decision, alternatives considered, and why this path was chosen.

**Format:** Add new entries at the top. Never delete entries — mark superseded ones with ~~strikethrough~~ and link to the replacement.

---

## Architecture

### Why Supabase + Railway over alternatives
**Date:** 2026-03-17
**Decision:** Supabase (Postgres + Realtime + Auth + RLS) as the database layer. Railway for long-running ingestion workers and background jobs.
**Alternatives considered:**
- PlanetScale + custom WebSocket server — no built-in Realtime, more infra to manage
- Firebase/Firestore — no SQL, bad fit for analytical queries (backtesting, entity history)
- Neon + Pusher — splits DB and Realtime into two vendors, two failure domains
- AWS RDS + SQS — heavier infra, no built-in Realtime, overkill for solo build
- Vercel Postgres — no Realtime, serverless-only, can't run persistent workers
**Why Supabase + Railway:** Nash (validated architecture reference) uses this exact split. Supabase gives Postgres + Realtime + RLS + Auth as a managed bundle — zero custom pub/sub infrastructure. Railway runs persistent processes that can hold open `LISTEN` connections and BullMQ workers, which serverless cannot. Combined cost is predictable and scales to 50+ users without re-architecting.

---

### Why Nash as architectural reference
**Date:** 2026-03-17
**Decision:** Use Nash (by The Manhattan Computation Company) as the primary architectural reference for Daybreak's stack and patterns.
**Alternatives considered:**
- Building from first principles with no reference architecture
- Using Bloomberg Terminal as the reference (established, but closed-source and monolithic)
- Benzinga Pro / Unusual Whales as reference (consumer-facing, different scale)
**Why Nash:** Nash is a real-time financial intelligence platform built with the same stack (Next.js + Supabase + Railway) for a similar professional audience. It's open enough to reference patterns from. Using a validated reference prevents reinventing solutions to problems that have already been solved — latency patterns, Realtime subscription models, AI pipeline design.

---

### Why pg_notify + BullMQ over polling-only or serverless functions
**Date:** 2026-03-18
**Decision:** Pipeline trigger via `pg_notify` → Railway worker `LISTEN` connection, with BullMQ on Railway Redis for job queue. 30-second safety-net poll as belt-and-suspenders.
**Alternatives considered:**
- Pure polling (every N seconds query `WHERE status = PENDING`) — adds N-second latency, wastes DB connections
- Supabase Edge Functions triggered by DB webhooks — 60s timeout limit, can't hold persistent connections, cold starts add latency
- AWS SQS / GCP Pub/Sub — adds a third vendor, more infra surface area
**Why pg_notify + BullMQ:** pg_notify fires synchronously on INSERT with zero polling overhead — this is how we hit the <500ms headline delivery SLA. BullMQ adds concurrency control, retry logic (max 3, exponential backoff), and rate limiting without custom code. The 30-second safety-net poll catches any articles that missed the pg_notify event due to transient Railway connection drops.

---

### Why article_enrichments as delta rows instead of updating articles
**Date:** 2026-03-18
**Decision:** AI pipeline stages write new rows to `article_enrichments` (one row per stage per article). The `articles` row is INSERT-only after creation — never updated by the pipeline.
**Alternatives considered:**
- Update `articles` row directly on each stage completion (simpler, fewer joins)
- Single `enrichments` JSONB column on `articles` updated incrementally
**Why delta rows:** Supabase Realtime broadcasts the full row on UPDATE. `articles.body` can be 1–10KB; broadcasting it to 50 clients on every stage completion (5–7 stages per article) creates significant WebSocket traffic. Delta rows contain only the stage output — typically <1KB. Frontend subscribes to `article_enrichments` for progressive updates; fetches `articles.body` only when a trader expands a headline. Also enables clean audit trail of what each AI stage produced.

---

### Why Redis per-ticker per-day for breaking classifier context (not in-memory LRU)
**Date:** 2026-03-18
**Decision:** Breaking classifier dedup context stored in Redis: `daybreak:breaking:{ticker}:{YYYYMMDD}` SET of seen article_ids, 48h TTL.
**Alternatives considered:**
- In-memory LRU cache on each Railway worker (last 500 headlines, 30min TTL)
**Why Redis:** Multi-worker setup (Railway can run multiple worker instances) means in-memory caches are per-process and invisible to each other. Worker A and Worker B would each classify the same story as "breaking" because neither knows what the other has seen. Redis is shared across all workers. TTL of 48h covers overnight stories and time zone edge cases. Per-ticker-per-day structure avoids cross-ticker contamination.

---

### Why article_enrichment_entities junction table (not JSONB array scanning)
**Date:** 2026-03-18
**Decision:** Denormalized `article_enrichment_entities(enrichment_id, entity_id)` junction table for entity-scoped enrichment queries. Entity extraction populates this on every enrichment write.
**Alternatives considered:**
- GIN index on `article_enrichments.data` JSONB for `@>` array containment queries
- Array column `entity_ids[]` on `article_enrichments` with GIN index
**Why junction table:** JSONB `@>` queries scale poorly as the corpus grows — GIN indexes help but still scan more rows than a pure FK join. The novelty scorer queries 6 months of material-tier headlines for a specific entity on every article — this is a hot path. Junction table query: `JOIN article_enrichment_entities ON entity_id = $1` → pure indexed FK lookup, constant time. Marginal write cost (a few extra rows per enrichment) is negligible vs. read performance on a table that will hold millions of rows.

---

### Why pgvector enabled at Phase 1 (not deferred to Phase 4)
**Date:** 2026-03-18
**Decision:** `pgvector` Supabase extension enabled in the Phase 1 schema migration. Embeddings generated for all material-tier screener-passed headlines from day 1.
**Alternatives considered:**
- Enable pgvector at Phase 4 when historical scenario matching is built
**Why Phase 1:** The novelty scorer (Phase 2) needs a 6-month embedding corpus to be meaningful. If pgvector is deferred to Phase 4, Phase 2 novelty scoring launches with zero historical corpus and defaults to 100 (novel) for every article. Enabling it in Phase 1 means the corpus grows continuously from day 1 — by the time novelty scoring ships, there's real history to compare against. The Phase 1 cost is one migration line and an embedding call per material-tier article.

---

### Why model fallback is timeout-triggered (not error-count-triggered)
**Date:** 2026-03-18
**Decision:** Primary model fallback triggers on: timeout (>15s), rate limit (429), or 5xx server error. If both primary and fallback fail → `FAILED_{STAGE}` enrichment row with `data.raw_output` preserved.
**Alternatives considered:**
- Fallback after N consecutive errors (would require state across requests)
- No fallback — fail immediately on primary model error
- Retry primary model up to 3x before fallback
**Why timeout-triggered:** Retrying the primary model on a timeout wastes 15s × 3 = 45s before degrading — unacceptable for a sub-3s enrichment target. A single timeout means the primary is struggling; go to fallback immediately. Rate limits (429) are deterministic — retrying the same model immediately fails again. 5xx is also a signal the model is unhealthy. Raw output preserved on both failures enables debugging without re-running.

---

### Why Zod validation failure writes FAILED_{STAGE} row (not halts pipeline)
**Date:** 2026-03-18
**Decision:** When a Zod schema validation fails on AI output, write a `FAILED_{STAGE}` enrichment row with `data.raw_output` preserved, then continue pipeline downstream.
**Alternatives considered:**
- Halt pipeline for the article on Zod failure (nothing downstream runs)
- Silently skip the stage and continue (no record of failure)
- Retry the AI call (might just produce the same malformed output)
**Why continue downstream:** Zod failure on screener output shouldn't block scoring if entity extraction already succeeded. Each pipeline stage is independent — downstream stages have enough context to run without every upstream stage completing perfectly. Halting creates ghost articles (visible in feed but permanently stuck without enrichment). Silent skip loses the debugging signal. `raw_output` in the FAILED row lets us inspect exactly what the AI returned, which is essential for prompt improvement.

---

## Data Model

### Why upcoming_event_entities junction table (not entities[] array)
**Date:** 2026-03-18
**Decision:** `upcoming_event_entities(id, event_id, entity_id)` junction table. The `upcoming_events` table has no `entities[]` array column.
**Alternatives considered:**
- `entities UUID[]` array column on `upcoming_events`
- `entities JSONB` column on `upcoming_events`
**Why junction table:** Consistent with the rest of the schema (`entity_tags`, `article_enrichment_entities`). Array columns require unnesting for any entity-scoped query ("show all upcoming events for AAPL"). Junction tables are first-class indexable relations — "events for entity X" is a simple FK lookup. Arrays cannot be foreign-key constrained. Daybreak's entity-first query pattern makes junction tables the right pattern everywhere.

---

### Why feed_sources has market_moving_score from Phase 1
**Date:** 2026-03-18
**Decision:** `feed_sources.market_moving_score float` column added to schema in Phase 1. Seeded with initial estimates; refined over time.
**Alternatives considered:**
- Add source quality signal in Phase 3/4 after data accumulates
- Hardcode source weights in scoring agent prompts
**Why Phase 1:** Source quality is a scoring signal — a Reuters breaking headline should carry more weight than a PR Newswire press release. Without it, scoring treats all sources equally, degrading score accuracy from day 1. Hardcoding in prompts prevents runtime updates (would require redeploy to adjust). The column is nullable — new sources default to 0.5 (neutral) until scored. The infrastructure cost is one column; the accuracy benefit is immediate.

---

## Auth

### Why Supabase Auth + Microsoft Azure AD OAuth (not NextAuth)
**Date:** 2026-03-18
**Decision:** Supabase Auth with Azure AD OAuth provider. Trillium M365 SSO via Azure AD.
**Alternatives considered:**
- NextAuth.js with Azure AD provider
- Custom JWT auth
- Auth0
**Why Supabase Auth + Azure AD:** Supabase Auth has a built-in Azure AD OAuth provider — zero additional library. Since we're already deep in the Supabase ecosystem (Realtime, RLS, DB), keeping auth in Supabase means RLS policies reference `auth.uid()` directly with no adapter layer. NextAuth would require a separate session store and custom RLS integration. Trillium uses M365 for everything — Azure AD is the natural SSO provider.

---

## Design

### Why two-view model (Curated + Wire) instead of filter-based feed
**Date:** 2026-03-18
**Decision:** Two tabs: Curated (AI-filtered, default) + Wire (full pipe). AI does the filtering — traders don't configure word lists.
**Alternatives considered:**
- Single feed with robust filter UI (Bloomberg-style keyword/topic filters)
- Single AI-curated feed with no Wire view
**Why two-view:** Daybreak's value proposition is the AI analyst, not a faster filter UI. Bloomberg News already has excellent filters — competing there is a commodity play. The two-view model makes the AI's judgment transparent and auditable: Curated shows what the AI thinks matters; Wire shows everything so traders can spot misses. The ↑/↓ feedback loop teaches the AI per-trader preferences over time — this is the defensible moat. A single curated-only feed removes the audit surface and makes misses invisible.

---

### Why no inline BREAKING badge (stripe + row tint instead)
**Date:** 2026-03-18
**Decision:** Breaking news uses a 3px amber urgency stripe on the left + subtle row background tint. No inline `BREAKING` badge embedded in the headline text.
**Alternatives considered:**
- Inline `[BREAKING]` prefix in headline text (Bloomberg-style)
- Colored badge before the headline text
**Why stripe + tint:** Inline badges push the headline text right, breaking left-justification and disrupting the eye's scan path. Every row starts at a different horizontal position depending on whether a badge is present — traders scanning for content have to re-anchor their eye on every row. The urgency stripe is a fixed 3px column at the left edge — it communicates breaking status without touching the headline column at all. The `BRKG` tag lives in the optional Flags column if the trader wants it. Eye path is unbroken.

---

### Why Geist family for both prose and data
**Date:** 2026-03-18
**Decision:** Geist Sans for headlines/UI + Geist Mono for tickers/scores/timestamps. Same font family for all text.
**Alternatives considered:**
- Inter + JetBrains Mono (common pairing)
- Geist Sans + IBM Plex Mono
**Why Geist family:** Zero visual friction between prose and data — when a ticker appears inline in a headline (`AAPL`), the font switch is subtle (mono vs. sans) rather than jarring (two unrelated families). Geist is native to the Next.js/Vercel ecosystem this platform is built on. Inter is overused and carries visual baggage. The Mono variant supports `tabular-nums` natively, ensuring score and timestamp columns always align.

---

### Why fixed 38px row height
**Date:** 2026-03-18
**Decision:** All feed rows are exactly 38px tall. No variable heights.
**Alternatives considered:**
- Variable heights (headlines that wrap get taller rows)
- Two fixed heights (normal vs. expanded)
**Why fixed:** Variable row heights break scan rhythm. A trader scanning 50 headlines needs consistent spatial anchoring — their eye knows exactly where the next row starts. Variable heights force the eye to re-calibrate on every row. At 38px, a single headline line + metadata fits. Long headlines truncate with `text-overflow: ellipsis` — the trader clicks to expand if they want the full text. Fixed height is also a performance optimization: virtual list rendering requires known row heights.

---
