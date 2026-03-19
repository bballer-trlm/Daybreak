-- ============================================================
-- Daybreak Phase 1 Schema
-- ============================================================

-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

create type article_status as enum (
  'PENDING',
  'PROCESSING',
  'SCREENED_OUT',
  'ENRICHING',
  'DONE',
  'FAILED_SCREENER',
  'FAILED_CLASSIFIER',
  'FAILED_ENTITIES',
  'FAILED_NOVELTY',
  'FAILED_SCORES',
  'FAILED_RESEARCH',
  'FAILED_PERMANENT'
);

create type stage_type as enum (
  'screener',
  'classifier',
  'entities',
  'novelty',
  'scores',
  'research',
  'earnings'
);

create type relevance_tier as enum (
  'material',
  'minor',
  'noise'
);

create type entity_type as enum (
  'company',
  'sector',
  'region',
  'macro',
  'person'
);

create type time_horizon as enum (
  'immediate',
  'short_term',
  'medium_term',
  'long_term'
);

create type impact_directness as enum (
  'direct',
  'second_order',
  'third_order'
);

-- ============================================================
-- TABLES
-- ============================================================

-- Feed sources (RSS feeds, news APIs, scrapers)
create table feed_sources (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null unique,
  base_url            text,
  metadata_schema     jsonb not null default '{}',
  market_moving_score int not null default 5 check (market_moving_score between 1 and 10),
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Core articles table
create table articles (
  id               uuid primary key default uuid_generate_v4(),
  title            text not null,
  body             text,
  source           text not null,
  author           text,
  url              text not null unique,
  published_at     timestamptz,
  status           article_status not null default 'PENDING',
  is_breaking      boolean not null default false,
  importance_score int check (importance_score between 1 and 10),
  category         text,
  created_at       timestamptz not null default now()
);

-- Per-stage enrichment outputs (one row per stage per article)
create table article_enrichments (
  id          uuid primary key default uuid_generate_v4(),
  article_id  uuid not null references articles(id) on delete cascade,
  stage_type  stage_type not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  unique (article_id, stage_type)
);

-- Named entities (companies, sectors, people, etc.)
create table entities (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  ticker     text,
  type       entity_type not null,
  sector     text,
  industry   text,
  created_at timestamptz not null default now(),
  unique (name, type)
);

-- Entity-level impact scores per article
create table entity_impacts (
  id                uuid primary key default uuid_generate_v4(),
  article_id        uuid not null references articles(id) on delete cascade,
  entity_id         uuid not null references entities(id) on delete cascade,
  score             numeric(4,2) not null check (score between -10 and 10),
  time_horizon      time_horizon,
  impact_directness impact_directness,
  analysis_text     text,
  created_at        timestamptz not null default now(),
  unique (article_id, entity_id)
);

-- Model configuration (which AI model is used for each stage)
create table model_config (
  id           uuid primary key default uuid_generate_v4(),
  stage        stage_type not null unique,
  provider     text not null,   -- 'google' | 'anthropic' | 'openai'
  model_id     text not null,
  max_tokens   int not null default 1024,
  temperature  numeric(3,2) not null default 0.1,
  notes        text,
  updated_at   timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Articles: feed query patterns
create index idx_articles_status         on articles(status);
create index idx_articles_created_at     on articles(created_at desc);
create index idx_articles_published_at   on articles(published_at desc nulls last);
create index idx_articles_is_breaking    on articles(is_breaking) where is_breaking = true;
create index idx_articles_importance     on articles(importance_score desc nulls last);
create index idx_articles_status_created on articles(status, created_at desc);

-- Enrichments: lookup by article
create index idx_enrichments_article_id  on article_enrichments(article_id);

-- Entity impacts: lookup by article and entity
create index idx_entity_impacts_article  on entity_impacts(article_id);
create index idx_entity_impacts_entity   on entity_impacts(entity_id);
create index idx_entity_impacts_score    on entity_impacts(score desc);

-- Entities: ticker lookup
create index idx_entities_ticker on entities(ticker) where ticker is not null;

-- ============================================================
-- pg_notify TRIGGER
-- Fires after INSERT on articles; sends article id on 'articles_pending'
-- so the Node.js worker can pick it up via LISTEN without polling.
-- ============================================================

create or replace function notify_article_pending()
returns trigger
language plpgsql
as $$
begin
  -- Only notify when status is PENDING (default on insert)
  if NEW.status = 'PENDING' then
    perform pg_notify('articles_pending', NEW.id::text);
  end if;
  return NEW;
end;
$$;

create trigger articles_after_insert
  after insert on articles
  for each row
  execute function notify_article_pending();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table articles            enable row level security;
alter table article_enrichments enable row level security;
alter table entities            enable row level security;
alter table entity_impacts      enable row level security;
alter table feed_sources        enable row level security;
alter table model_config        enable row level security;

-- Authenticated users can read all articles and enrichments (traders read the feed)
create policy "authenticated_read_articles"
  on articles for select
  to authenticated
  using (true);

create policy "authenticated_read_enrichments"
  on article_enrichments for select
  to authenticated
  using (true);

create policy "authenticated_read_entities"
  on entities for select
  to authenticated
  using (true);

create policy "authenticated_read_entity_impacts"
  on entity_impacts for select
  to authenticated
  using (true);

create policy "authenticated_read_feed_sources"
  on feed_sources for select
  to authenticated
  using (true);

create policy "authenticated_read_model_config"
  on model_config for select
  to authenticated
  using (true);

-- Service role bypass is implicit (service role ignores RLS by default in Supabase)
-- The worker uses SUPABASE_SERVICE_ROLE_KEY — no additional policies needed.

-- ============================================================
-- SEED: model_config defaults
-- ============================================================

insert into model_config (stage, provider, model_id, max_tokens, temperature, notes) values
  ('screener',   'google',    'gemini-2.0-flash',  256,  0.1, 'Fast binary pass/fail screen'),
  ('classifier', 'google',    'gemini-2.0-flash',  256,  0.1, 'Breaking flag + category'),
  ('entities',   'google',    'gemini-2.0-flash', 1024,  0.1, 'NER + ticker resolution'),
  ('novelty',    'google',    'gemini-2.0-flash',  512,  0.1, 'Dedup check against recent articles'),
  ('scores',     'google',    'gemini-2.0-flash',  512,  0.1, 'Importance + entity impact scores'),
  ('research',   'anthropic', 'claude-opus-4-5',  4096,  0.2, 'Deep research synthesis — slow path'),
  ('earnings',   'anthropic', 'claude-sonnet-4-5', 2048, 0.1, 'Earnings call analysis')
on conflict (stage) do nothing;

-- ============================================================
-- SEED: known feed sources
-- ============================================================

insert into feed_sources (name, base_url, market_moving_score, active) values
  ('Reuters',                 'https://feeds.reuters.com',               9,  true),
  ('Bloomberg',               'https://www.bloomberg.com',               9,  true),
  ('SEC EDGAR',               'https://www.sec.gov/cgi-bin/browse-edgar', 10, true),
  ('Seeking Alpha',           'https://seekingalpha.com',                6,  true),
  ('The Wall Street Journal', 'https://www.wsj.com',                     8,  true),
  ('CNBC',                    'https://www.cnbc.com',                    7,  true),
  ('Financial Times',         'https://www.ft.com',                      8,  true)
on conflict (name) do nothing;
