-- Add 'summary' stage to the stage_type enum
alter type stage_type add value if not exists 'summary';
