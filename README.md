# Daybreak

Real-time market intelligence for professional equity traders at Trillium. Daybreak ingests financial news from multiple sources, runs each article through a multi-stage AI enrichment pipeline, and surfaces a scored, annotated feed — so traders spend less time filtering noise and more time acting on signal.

## What it does

- Ingests articles from Reuters, Bloomberg, SEC EDGAR, WSJ, and other high-signal sources
- Runs each article through a pipeline: screener → classifier → entity extraction → novelty scoring → impact scoring → deep research synthesis
- Surfaces a real-time feed ranked by importance, with entity-level directional scores and breaking-news flags
- Built for speed: breaking news surfaces in under 15 seconds from publication

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| Database | Supabase (Postgres + Realtime) |
| Queue | BullMQ on Redis (Railway) |
| Worker | Bun, pg LISTEN/NOTIFY |
| AI — fast stages | Gemini 2.0 Flash (screener, classifier, entities, novelty, scores) |
| AI — deep research | Claude Opus (research synthesis), Claude Sonnet (earnings) |
| Deployment | Vercel (web), Railway (worker) |
| Language | TypeScript throughout |

## Getting started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- A [Supabase](https://supabase.com) project
- A Redis instance (Railway works well)

### Setup

```bash
# 1. Clone
git clone <repo-url> daybreak
cd daybreak

# 2. Install dependencies
bun install

# 3. Configure environment
cp .env.local.example .env.local
# Fill in all values in .env.local

# 4. Apply the database migration
# In your Supabase dashboard → SQL Editor, run:
# supabase/migrations/001_phase1_schema.sql

# 5. Run the development server
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

### Running the ingestion worker

The worker listens for new articles via `pg_notify` and processes them through the enrichment pipeline.

```bash
# Run worker locally (requires DATABASE_URL and REDIS_URL in .env.local)
bun run workers/ingestion/index.ts
```

On Railway, the worker starts automatically via `railway.json`.

## Project structure

```
app/                    Next.js App Router pages and layouts
lib/
  supabase/
    client.ts           Browser Supabase client
    server.ts           Server-side Supabase client
    types.ts            TypeScript types matching the DB schema
workers/
  ingestion/
    index.ts            Worker entry point (pg LISTEN + safety-net poll)
    queue.ts            BullMQ queue and worker factory
    pipeline.ts         Multi-stage enrichment pipeline
supabase/
  migrations/
    001_phase1_schema.sql   Full Phase 1 schema, indexes, RLS, triggers, seeds
.env.local.example      Required environment variables
railway.json            Railway deployment config for the worker
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — System design, data flow, concurrency model, cost model
- [DESIGN.md](DESIGN.md) — Visual design system, component specs, UX principles
- [DECISIONS.md](DECISIONS.md) — Key architectural decisions and their rationale
- [TODOS.md](TODOS.md) — Phase-by-phase build plan and open tasks

## Roadmap

- **Phase 1** (current) — Scaffold: schema, ingestion worker, BullMQ pipeline stubs, feed page shell
- **Phase 2** — Live AI pipeline: real Gemini Flash screener/classifier/entity/scores stages
- **Phase 3** — Feed UI: real-time article feed with entity cards, impact scores, breaking alerts
- **Phase 4** — Watchlists, alerts, earnings integration, trader personalization
