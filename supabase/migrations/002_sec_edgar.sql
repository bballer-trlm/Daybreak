-- ============================================================
-- SEC EDGAR Pipeline Stage
-- Adds sec_content stage type for filing content enrichment
-- ============================================================

alter type stage_type add value if not exists 'sec_content';
