-- Migration 0006: Add patch_context and patch_generated_at to findings
-- Stores the code context around the finding and when the patch was generated,
-- enabling on-demand patch generation from the finding detail page.

ALTER TABLE findings ADD COLUMN patch_context TEXT;
ALTER TABLE findings ADD COLUMN patch_generated_at TEXT;

-- Down migration:
-- ALTER TABLE findings DROP COLUMN patch_context;
-- ALTER TABLE findings DROP COLUMN patch_generated_at;
