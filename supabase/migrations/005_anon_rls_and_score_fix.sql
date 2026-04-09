-- ============================================================
-- Fix anon RLS + entity_impacts score constraint
--
-- 1. Add anon read policies — front-end uses anon Supabase client;
--    all authenticated policies were blocking detail panel queries.
--    (Auth is deferred; terminal is read-only so anon reads are safe.)
-- 2. Fix entity_impacts.score constraint: was -10 to 10, pipeline writes -100 to +100.
-- ============================================================

-- 1. Anon read policies
create policy "anon_read_articles"
  on articles for select
  to anon
  using (true);

create policy "anon_read_enrichments"
  on article_enrichments for select
  to anon
  using (true);

create policy "anon_read_entities"
  on entities for select
  to anon
  using (true);

create policy "anon_read_entity_impacts"
  on entity_impacts for select
  to anon
  using (true);

-- 2. Fix entity impact score range
alter table entity_impacts drop constraint if exists entity_impacts_score_check;
alter table entity_impacts add constraint entity_impacts_score_check
  check (score between -100 and 100);
