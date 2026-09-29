-- Migration 0011: v0.3 — ALTER existing tables for v0.3 columns

-- ─── findings: hunt verdict + timeline timestamp ────────────────
ALTER TABLE findings ADD COLUMN verdict TEXT;
ALTER TABLE findings ADD COLUMN timeline_computed_at TEXT;

-- ─── scan_events: injection replay tracking ─────────────────────
ALTER TABLE scan_events ADD COLUMN is_replay INTEGER DEFAULT 0;
ALTER TABLE scan_events ADD COLUMN injection_source TEXT;
