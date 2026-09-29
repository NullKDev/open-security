-- Migration 0013: v1.0 — Policy Engine, Consensus, Collaboration, Secrets
-- All operations are additive. SQLite does not support IF NOT EXISTS on ALTER,
-- so ALTER statements here run once; re-running fails gracefully in the app migration runner.

-- ─── finding_comments (NEW) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finding_comments (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  actor TEXT NOT NULL,
  body TEXT NOT NULL,
  -- JSON array of @mention strings (stored verbatim, notifications deferred to v1.1)
  mentions TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS finding_comments_finding_idx
  ON finding_comments(finding_id, created_at);

-- ─── finding_assignments (NEW) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finding_assignments (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  assignee TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- NULL = still assigned; ISO timestamp when unassigned
  unassigned_at TEXT
);

CREATE INDEX IF NOT EXISTS finding_assignments_finding_idx
  ON finding_assignments(finding_id, unassigned_at);

-- ─── enrichment_cache (NEW) — generic KV+TTL for OSV and Socket enrichers ──
CREATE TABLE IF NOT EXISTS enrichment_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  ttl_sec INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS enrichment_cache_expires_idx
  ON enrichment_cache(fetched_at, ttl_sec);

-- ─── secrets (NEW) — encrypted credential store ─────────────────────────────
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  -- base64(iv || authTag || ciphertext) for AES-256-GCM
  ciphertext TEXT NOT NULL,
  algo TEXT NOT NULL DEFAULT 'aes-256-gcm',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ─── ALTER: findings — v1.0 policy + consensus + export columns ─────────────
-- NOTE: SQLite does not support IF NOT EXISTS on ALTER TABLE.
-- The app migration runner wraps each ALTER in a try/catch for idempotency.
ALTER TABLE findings ADD COLUMN suggested_assignee TEXT;
ALTER TABLE findings ADD COLUMN policy_rule_id TEXT;
ALTER TABLE findings ADD COLUMN consensus_score REAL DEFAULT 1.0;
ALTER TABLE findings ADD COLUMN consensus_status TEXT DEFAULT 'single-source';
ALTER TABLE findings ADD COLUMN scanner_votes TEXT;
ALTER TABLE findings ADD COLUMN jira_issue_key TEXT;
ALTER TABLE findings ADD COLUMN jira_last_synced_at TEXT;
ALTER TABLE findings ADD COLUMN sarif_last_uploaded_at TEXT;
ALTER TABLE findings ADD COLUMN last_export_error TEXT;

-- Composite index for queue ordering: severity DESC + consensus status
CREATE INDEX IF NOT EXISTS findings_consensus_idx
  ON findings(consensus_status, severity);

-- ─── ALTER: cve_scores — v1.0 enrichment extensions ─────────────────────────
ALTER TABLE cve_scores ADD COLUMN ghsa_id TEXT;
ALTER TABLE cve_scores ADD COLUMN cvss_vector TEXT;
ALTER TABLE cve_scores ADD COLUMN affected_versions TEXT;
ALTER TABLE cve_scores ADD COLUMN fixed_version TEXT;
ALTER TABLE cve_scores ADD COLUMN summary TEXT;
ALTER TABLE cve_scores ADD COLUMN epss REAL;
ALTER TABLE cve_scores ADD COLUMN source TEXT;
ALTER TABLE cve_scores ADD COLUMN ttl_sec INTEGER;

CREATE INDEX IF NOT EXISTS cve_scores_ghsa_idx
  ON cve_scores(ghsa_id) WHERE ghsa_id IS NOT NULL;
