-- ============================================================
-- Daybreak Enrichment Pipeline v2 Schema
--
-- 1. Add 'rules' stage type (deterministic Stage 0 in pipeline)
-- 2. Add content_hash to articles for syndication dedup
-- 3. Fix importance_score constraint: 1–10 → 0–100
-- 4. Add canonical_entities reference table (entity resolution, seed later)
-- ============================================================

-- 1. Rule engine enrichment stage
alter type stage_type add value if not exists 'rules';

-- 2. Content hash for cross-URL duplicate detection (SHA-256 of normalized body)
alter table articles add column if not exists content_hash text;

create index if not exists idx_articles_content_hash
  on articles(content_hash)
  where content_hash is not null;

-- 3. Fix importance_score constraint — pipeline uses 0–100 scale, not 1–10
alter table articles drop constraint if exists articles_importance_score_check;
alter table articles add constraint articles_importance_score_check
  check (importance_score between 0 and 100);

-- 4. Canonical entity reference table
-- Seed with S&P 500 companies + aliases, major indices, commodities, central banks.
-- The pipeline's entity extraction resolves extracted names against this table.
create table if not exists canonical_entities (
  id             uuid        primary key default uuid_generate_v4(),
  canonical_name text        not null,
  entity_type    text        not null check (entity_type in ('company', 'person', 'index', 'commodity', 'currency', 'central_bank')),
  tickers        jsonb       not null default '[]',  -- e.g. ["GOOGL", "GOOG"]
  aliases        jsonb       not null default '[]',  -- all known name variants (lowercased at lookup time)
  sector         text,
  industry       text,
  market_cap_tier text       check (market_cap_tier in ('mega', 'large', 'mid', 'small', 'micro')),
  is_active      boolean     not null default true,
  updated_at     timestamptz not null default now()
);

create index if not exists idx_canonical_entities_name
  on canonical_entities(canonical_name);
create index if not exists idx_canonical_entities_type
  on canonical_entities(entity_type);
create index if not exists idx_canonical_entities_active
  on canonical_entities(is_active)
  where is_active = true;

-- RLS
alter table canonical_entities enable row level security;

create policy "authenticated_read_canonical_entities"
  on canonical_entities for select
  to authenticated
  using (true);
