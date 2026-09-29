-- Add nullable project_map column for storing LLM-generated project intelligence
ALTER TABLE `scans` ADD COLUMN `project_map` TEXT;

-- Idempotent data migration: map legacy 'deep' mode to new 'paranoid'
UPDATE `scans` SET `scan_mode` = 'paranoid' WHERE `scan_mode` = 'deep';

-- Down migration (apply manually if rolling back):
-- UPDATE `scans` SET `scan_mode` = 'deep' WHERE `scan_mode` IN ('paranoid', 'intermediate');
-- ALTER TABLE `scans` DROP COLUMN `project_map`;
