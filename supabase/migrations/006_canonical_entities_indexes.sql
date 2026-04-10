-- ============================================================
-- canonical_entities: unique constraint + GIN indexes
--
-- 1. UNIQUE on canonical_name — required for upsert onConflict resolution
-- 2. GIN on aliases — enables @> containment queries for alias-based lookup
-- 3. GIN on tickers — enables @> containment queries for ticker-based lookup
--
-- These are prerequisite for seeding and pipeline canonical resolution.
-- ============================================================

alter table canonical_entities
  add constraint canonical_entities_canonical_name_key unique (canonical_name);

create index if not exists idx_canonical_entities_aliases_gin
  on canonical_entities using gin (aliases);

create index if not exists idx_canonical_entities_tickers_gin
  on canonical_entities using gin (tickers);
