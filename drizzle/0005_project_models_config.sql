-- Migration 0005: Add models_config to projects
-- Snapshot the global model configuration when a project is created,
-- so scans can show which models were configured at creation time.

ALTER TABLE projects ADD COLUMN models_config TEXT;

-- Down migration: remove the column
-- ALTER TABLE projects DROP COLUMN models_config;
