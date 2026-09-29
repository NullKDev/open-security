-- Migration 0012: v0.4 — Fix & Prove + Posture Trends + MTTR + Regression Tracker + FP Bank
-- All operations are additive and idempotent (CREATE IF NOT EXISTS, ALTER only adds columns).

-- ─── fix_proofs (ADR-3): one row per triad attempt per finding ─────────────
CREATE TABLE IF NOT EXISTS fix_proofs (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  branch_id TEXT REFERENCES finding_branches(id),
  -- Inputs
  patch_diff TEXT NOT NULL,
  regression_test_path TEXT,
  regression_test_diff TEXT,
  -- Triad signals
  unit_test_passed INTEGER,
  vul_run_passed_pre INTEGER,
  vul_run_passed_post INTEGER,
  -- Outcome: 'in-progress' | 'verified-fixed' | 'fix-unverified'
  outcome TEXT NOT NULL,
  -- Failure reason when outcome='fix-unverified'
  failure_reason TEXT,
  -- Captured terminal output (last ~2 KB each)
  pre_patch_output TEXT,
  post_patch_output TEXT,
  unit_test_output TEXT,
  -- Lifecycle
  started_at TEXT NOT NULL,
  completed_at TEXT,
  acp_session_id TEXT
);

CREATE INDEX IF NOT EXISTS fix_proofs_finding_idx
  ON fix_proofs(finding_id, completed_at);

-- ─── posture_snapshots (ADR-4): daily severity-weighted posture per project ─
CREATE TABLE IF NOT EXISTS posture_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  -- UTC date bucket 'YYYY-MM-DD'
  bucket_date TEXT NOT NULL,
  -- Severity counts
  count_critical INTEGER NOT NULL DEFAULT 0,
  count_high INTEGER NOT NULL DEFAULT 0,
  count_medium INTEGER NOT NULL DEFAULT 0,
  count_low INTEGER NOT NULL DEFAULT 0,
  count_info INTEGER NOT NULL DEFAULT 0,
  -- critical*10 + high*5 + medium*2 + low*1 + info*0 (REQ-PT-01)
  weighted_score REAL NOT NULL,
  -- Sum of (now() - created_at) over open critical findings not dismissed
  open_critical_days REAL NOT NULL DEFAULT 0,
  snapshot_at TEXT NOT NULL,
  scan_id TEXT REFERENCES scans(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS posture_proj_date_uq
  ON posture_snapshots(project_id, bucket_date);

-- ─── mttr_by_severity (ADR-4 + ADR-7): materialized MTTR table ────────────
CREATE TABLE IF NOT EXISTS mttr_by_severity (
  project_id TEXT NOT NULL REFERENCES projects(id),
  severity TEXT NOT NULL,
  -- Rolling window in days: 30 | 60 | 90
  window_days INTEGER NOT NULL,
  -- Median seconds to remediate; NULL when sample_size = 0
  median_seconds REAL,
  avg_seconds REAL,
  -- Number of remediated findings in this window
  sample_size INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, severity, window_days)
);

-- ─── finding_regressions (ADR-5): links regression to original fix ──────────
CREATE TABLE IF NOT EXISTS finding_regressions (
  id TEXT PRIMARY KEY,
  original_finding_id TEXT NOT NULL REFERENCES findings(id),
  regressed_finding_id TEXT NOT NULL UNIQUE REFERENCES findings(id),
  original_branch_id TEXT REFERENCES finding_branches(id),
  regression_commit_sha TEXT,
  detected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS finding_regressions_original_idx
  ON finding_regressions(original_finding_id);

-- ─── finding_dismissal_history (ADR-6): append-only audit log ───────────────
CREATE TABLE IF NOT EXISTS finding_dismissal_history (
  id TEXT PRIMARY KEY,
  dismissal_id TEXT NOT NULL REFERENCES finding_dismissals(id),
  -- 'created' | 'edited' | 'appealed' | 're-dismissed'
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  rationale_snapshot TEXT NOT NULL,
  -- 'hand' | 'agent-assisted'
  source TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS fdh_dismissal_idx
  ON finding_dismissal_history(dismissal_id, ts);

-- ─── notifications_dispatched (ADR-5): idempotency for desktop notifications ─
CREATE TABLE IF NOT EXISTS notifications_dispatched (
  scan_id TEXT NOT NULL REFERENCES scans(id),
  kind TEXT NOT NULL,
  ts TEXT NOT NULL,
  PRIMARY KEY (scan_id, kind)
);

-- ─── ALTER: findings — status enum widening + triad pointer + regression flags
-- status column: open | fixed | dismissed | verified-fixed | fix-unverified | regression
-- (Validated in the repo layer via Zod — ADR-8; no DB-level CHECK for SQLite compatibility)
ALTER TABLE findings ADD COLUMN status TEXT;
ALTER TABLE findings ADD COLUMN proof_of_fix_id TEXT REFERENCES fix_proofs(id);
ALTER TABLE findings ADD COLUMN is_regression INTEGER NOT NULL DEFAULT 0;
ALTER TABLE findings ADD COLUMN regression_of_finding_id TEXT REFERENCES findings(id);

CREATE INDEX IF NOT EXISTS findings_is_regression_idx
  ON findings(is_regression) WHERE is_regression = 1;

-- ─── ALTER: finding_branches — merged_at for regression detection + MTTR ────
ALTER TABLE finding_branches ADD COLUMN merged_at TEXT;

CREATE INDEX IF NOT EXISTS finding_branches_merged_idx
  ON finding_branches(merged_at) WHERE merged_at IS NOT NULL;

-- ─── ALTER: finding_dismissals — appeal columns (ADR-6) ─────────────────────
ALTER TABLE finding_dismissals ADD COLUMN appealed_at TEXT;
ALTER TABLE finding_dismissals ADD COLUMN appeal_reason TEXT;
ALTER TABLE finding_dismissals ADD COLUMN appeal_author TEXT;

-- ─── Triggers: enforce append-only on finding_dismissal_history (ADR-6) ─────
CREATE TRIGGER IF NOT EXISTS fdh_no_update
BEFORE UPDATE ON finding_dismissal_history
BEGIN
  SELECT RAISE(ABORT, 'finding_dismissal_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS fdh_no_delete
BEFORE DELETE ON finding_dismissal_history
BEGIN
  SELECT RAISE(ABORT, 'finding_dismissal_history is append-only');
END;
