/**
 * Daybreak Pipeline Taxonomy v1
 *
 * Single source of truth for approved classification values used across
 * the rule engine, screener, classifier, and scoring prompts.
 *
 * Future: move to a `taxonomy` table in Supabase for runtime updates
 * without code deploys.
 */

export const APPROVED_THEMES = [
  "Earnings",
  "Guidance",
  "M&A",
  "Regulation",
  "Litigation",
  "Product Launch",
  "Management Change",
  "Financing",
  "Buyback",
  "Dividend",
  "Macro Data",
  "Geopolitics",
  "Supply Chain",
  "Commodities",
  "Rates",
  "Crypto",
  "AI",
  "Semiconductors",
] as const;

export const APPROVED_EVENT_TYPES = [
  "earnings_release",
  "guidance_change",
  "merger_announcement",
  "acquisition_rumor",
  "executive_departure",
  "executive_appointment",
  "product_announcement",
  "regulatory_action",
  "lawsuit_filed",
  "settlement",
  "capital_raise",
  "share_repurchase",
  "dividend_change",
  "economic_release",
  "central_bank_commentary",
  "none",
] as const;

export const APPROVED_MACRO_TOPICS = [
  "Inflation",
  "Employment",
  "Consumer",
  "Housing",
  "Energy",
  "Defense",
  "Trade",
  "China",
  "Europe",
  "Middle East",
  "Supply Chains",
  "Fiscal Policy",
  "Monetary Policy",
] as const;

export type Theme = typeof APPROVED_THEMES[number];
export type EventType = typeof APPROVED_EVENT_TYPES[number];
export type MacroTopic = typeof APPROVED_MACRO_TOPICS[number];
