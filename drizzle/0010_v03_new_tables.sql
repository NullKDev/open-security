-- Migration 0010: v0.3 — New tables for CVE Hunter, Scan Forks, Playbooks, Secret Timeline

-- ─── hunt_targets: CVE hunt results per scan ───────────────────
CREATE TABLE IF NOT EXISTS hunt_targets (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  cve_id TEXT NOT NULL,
  target_path TEXT NOT NULL,
  advisory_raw TEXT,
  verdict TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (scan_id) REFERENCES scans(id)
);

-- ─── scan_forks: fork relationship between scans ────────────────
CREATE TABLE IF NOT EXISTS scan_forks (
  id TEXT PRIMARY KEY,
  parent_scan_id TEXT NOT NULL,
  child_scan_id TEXT NOT NULL,
  fork_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_scan_id) REFERENCES scans(id),
  FOREIGN KEY (child_scan_id) REFERENCES scans(id)
);

-- ─── playbooks: user-defined and builtin prompt playbooks ───────
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  prompt_template TEXT NOT NULL,
  scanner_scope TEXT,
  parameters TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  built_in INTEGER NOT NULL DEFAULT 0,
  trusted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── finding_timelines: secret exposure timeline per finding ────
CREATE TABLE IF NOT EXISTS finding_timelines (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL UNIQUE,
  commits TEXT NOT NULL,
  suspected_deploys INTEGER NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT,
  FOREIGN KEY (finding_id) REFERENCES findings(id)
);
