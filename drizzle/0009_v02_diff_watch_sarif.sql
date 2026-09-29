-- Migration 0009: v0.2 — Diff Mode + Watch Mode + SARIF Export
-- Adds diff scan columns, repos, webhook_events, watch_locks, notification_log tables.

-- ─── scans: v0.2 strategy + diff metadata columns ──────────────
ALTER TABLE scans ADD COLUMN strategy TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE scans ADD COLUMN base_sha TEXT;
ALTER TABLE scans ADD COLUMN head_sha TEXT;
ALTER TABLE scans ADD COLUMN pr_number INTEGER;
ALTER TABLE scans ADD COLUMN pr_comment_id TEXT;
ALTER TABLE scans ADD COLUMN pr_comment_status TEXT;

-- ─── findings: composite dedup index ───────────────────────────
CREATE INDEX IF NOT EXISTS findings_scan_dedup_idx ON findings(scan_id, dedup_key);

-- ─── repos: per-repo watch + webhook config ─────────────────────
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  watch_enabled INTEGER NOT NULL DEFAULT 0,
  watch_interval TEXT NOT NULL DEFAULT '0 */6 * * *',
  notify_channels TEXT,
  notify_severity_floor TEXT NOT NULL DEFAULT 'high',
  slack_webhook_url_ref TEXT,
  webhook_secret_ref TEXT,
  webhook_proxy_url TEXT,
  created_at TEXT NOT NULL
);

-- ─── webhook_events: durable queue for GitHub PR events ─────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  repo_id TEXT,
  delivery_id TEXT UNIQUE,
  event TEXT,
  action TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  received_at TEXT NOT NULL,
  processed_at TEXT,
  scan_id TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS webhook_events_status_idx ON webhook_events(status);

-- ─── watch_locks: advisory lock per (repo_id, branch) ──────────
CREATE TABLE IF NOT EXISTS watch_locks (
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, branch)
);

-- ─── notification_log: Slack coalescing + audit ─────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  scan_id TEXT,
  finding_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_log_repo_channel_idx ON notification_log(repo_id, channel, sent_at);
