export type ArticleStatus =
  | "PENDING"
  | "PROCESSING"
  | "SCREENED_OUT"
  | "ENRICHING"
  | "DONE"
  | "FAILED_SCREENER"
  | "FAILED_CLASSIFIER"
  | "FAILED_ENTITIES"
  | "FAILED_NOVELTY"
  | "FAILED_SCORES"
  | "FAILED_RESEARCH"
  | "FAILED_PERMANENT";

export type StageType =
  | "screener"
  | "classifier"
  | "entities"
  | "novelty"
  | "scores"
  | "research"
  | "earnings"
  | "sec_content"
  | "summary";

export type RelevanceTier = "material" | "minor" | "noise";

export interface Article {
  id: string;
  title: string;
  body: string | null;
  source: string;
  author: string | null;
  url: string;
  published_at: string | null;
  status: ArticleStatus;
  is_breaking: boolean;
  importance_score: number | null;
  category: string | null;
  created_at: string;
}

export interface ArticleEnrichment {
  id: string;
  article_id: string;
  stage_type: StageType;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  ticker: string | null;
  type: "company" | "sector" | "region" | "macro" | "person";
  sector: string | null;
  industry: string | null;
  created_at: string;
}

export interface EntityImpact {
  id: string;
  article_id: string;
  entity_id: string;
  score: number;
  time_horizon: "immediate" | "short_term" | "medium_term" | "long_term" | null;
  impact_directness: "direct" | "second_order" | "third_order" | null;
  analysis_text: string | null;
  created_at: string;
}

export interface FeedSource {
  id: string;
  name: string;
  base_url: string | null;
  metadata_schema: Record<string, unknown>;
  market_moving_score: number;
  active: boolean;
  created_at: string;
}

export interface EntityTag {
  name: string;
  ticker: string | null;
  score: number; // -100 to +100 directional impact
}

export interface ArticleWithEntities extends Article {
  entities?: EntityTag[];
}

// Explicit Insert types — fields with DB defaults are optional
export interface ArticleInsert {
  title: string;
  source: string;
  url: string;
  body?: string | null;
  author?: string | null;
  published_at?: string | null;
  status?: ArticleStatus;
  is_breaking?: boolean;
  importance_score?: number | null;
  category?: string | null;
}

export interface ArticleEnrichmentInsert {
  article_id: string;
  stage_type: StageType;
  data: Record<string, unknown>;
}

export interface EntityInsert {
  name: string;
  type: "company" | "sector" | "region" | "macro" | "person";
  ticker?: string | null;
  sector?: string | null;
  industry?: string | null;
}

export interface EntityImpactInsert {
  article_id: string;
  entity_id: string;
  score: number;
  time_horizon?: "immediate" | "short_term" | "medium_term" | "long_term" | null;
  impact_directness?: "direct" | "second_order" | "third_order" | null;
  analysis_text?: string | null;
}

// Supabase Database type shape
export interface Database {
  public: {
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Tables: {
      articles: {
        Row: Article;
        Insert: ArticleInsert;
        Update: Partial<ArticleInsert>;
        Relationships: [];
      };
      article_enrichments: {
        Row: ArticleEnrichment;
        Insert: ArticleEnrichmentInsert;
        Update: Partial<ArticleEnrichmentInsert>;
        Relationships: [];
      };
      entities: {
        Row: Entity;
        Insert: EntityInsert;
        Update: Partial<EntityInsert>;
        Relationships: [];
      };
      entity_impacts: {
        Row: EntityImpact;
        Insert: EntityImpactInsert;
        Update: Partial<EntityImpactInsert>;
        Relationships: [];
      };
      feed_sources: {
        Row: FeedSource;
        Insert: Omit<FeedSource, "id" | "created_at">;
        Update: Partial<Omit<FeedSource, "id" | "created_at">>;
        Relationships: [];
      };
    };
  };
}
