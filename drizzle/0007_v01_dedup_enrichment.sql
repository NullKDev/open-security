-- Migration 0007: v0.1 — Dedup + Enrichment + Branch columns and tables
-- Adds dedup, CVE enrichment, dismissals, and branch remediation schema.

-- ─── projects: test command per project ────────────────────────
ALTER TABLE projects ADD COLUMN test_command TEXT;
ALTER TABLE projects ADD COLUMN tests_enabled INTEGER NOT NULL DEFAULT 0;

-- ─── findings: dedup + enrichment columns ──────────────────────
ALTER TABLE findings ADD COLUMN dedup_key TEXT;
ALTER TABLE findings ADD COLUMN canonical_finding_id TEXT REFERENCES findings(id);
ALTER TABLE findings ADD COLUMN cve_ids TEXT;
ALTER TABLE findings ADD COLUMN first_detected_at TEXT;
ALTER TABLE findings ADD COLUMN last_seen_at TEXT;
ALTER TABLE findings ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 1;

-- ─── findings: indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS findings_dedup_key_idx ON findings(dedup_key);
CREATE INDEX IF NOT EXISTS findings_canonical_idx ON findings(canonical_finding_id);
CREATE INDEX IF NOT EXISTS findings_canonical_severity_idx ON findings(canonical_finding_id, severity);

-- ─── cve_scores: EPSS + KEV cache ──────────────────────────────
CREATE TABLE IF NOT EXISTS cve_scores (
  cve_id TEXT PRIMARY KEY NOT NULL,
  epss_score REAL,
  epss_percentile REAL,
  cisa_kev INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT
);

CREATE INDEX IF NOT EXISTS cve_scores_kev_idx ON cve_scores(cisa_kev);

-- ─── finding_dismissals: FP bank ───────────────────────────────
CREATE TABLE IF NOT EXISTS finding_dismissals (
  id TEXT PRIMARY KEY NOT NULL,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  dedup_key TEXT NOT NULL,
  fp_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  undone_at TEXT
);

CREATE INDEX IF NOT EXISTS fp_dedup_active_idx ON finding_dismissals(dedup_key, undone_at);

-- ─── finding_branches: branch remediation state machine ────────
CREATE TABLE IF NOT EXISTS finding_branches (
  id TEXT PRIMARY KEY NOT NULL,
  finding_id TEXT NOT NULL UNIQUE REFERENCES findings(id),
  branch_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  apply_error TEXT,
  tests_output TEXT,
  tests_passed INTEGER,
  pr_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- ─── backfill sentinels ─────────────────────────────────────────
-- Mark existing findings for application-side dedup backfill.
-- The dedup-key computation requires SHA-256 which SQLite lacks.
UPDATE findings SET
  dedup_key = '__pending_backfill__',
  first_detected_at = created_at,
  last_seen_at = created_at
WHERE dedup_key IS NULL;
