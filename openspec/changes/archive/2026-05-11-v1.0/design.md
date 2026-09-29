# Design: v1.0 — Policies + Collaboration + Export Bridge + OSV/Socket Integrations

**Change**: v1.0
**Date**: 2026-05-06
**Inputs**: proposal #425, spec #426
**File mirror**: openspec/changes/v1.0/design.md

## Architectural Decisions (ADRs)

**ADR-1 (Q1) — Policy loading: read-fresh per scan.** Read `~/.obt/policies.yaml` (global) and `.obt/policies.yaml` (workspace) every Stage 4 invocation. Workspace overrides global. Memo only within a single scan run. Rationale: worker is forked per scan (singleton would not survive); YAML I/O+parse is ~2-6 ms; "always current" UX. Rejected: chokidar singleton (extra dep, no fork survival), SQLite mtime cache (premature optimization).

**ADR-2 (Q2) — Jira dedup: store `jira_issue_key` on findings.** Adds nullable column; exporter does PUT-if-set / POST-then-write. Rationale: simplest, no Jira-side configuration needed. Rejected: custom-field search (server-config friction), label-based JQL (slow, rate-limit prone).

**ADR-3 (Q3) — Consensus computed at scan completion.** During Stage 4, before persistence: group by dedup_key, score = |agreeing scanners| / |scanners that ran on file|, status = single-source | agree | conflicted. Persist `consensus_score`, `consensus_status` (REAL+TEXT cols), `scanner_votes` (JSON col). Rationale: scanner manifest only available in-memory at this moment; queue ORDER BY uses indexed numeric. Rejected: lazy at queue load (re-derive manifest), posture_snapshots (too coarse).

**ADR-4 (Q4) — Socket.dev: per-package GET, batch concurrency 5, shared `enrichment_cache` table.** GET https://api.socket.dev/v0/npm/{pkg}/{ver}. Cache TTL 7 days. Alert mapping: malware/gptMalware→socket:malware (critical), typosquat→socket:typosquat (high), installScripts/shellAccess→socket:suspicious-install (high). API key via secret-store. Rejected: per-package table (duplicates OSV cache shape), no-cache (rate-limit burn).

**ADR-5 (Q5) — Credentials: AES-256-GCM with PBKDF2 machine-derived key.** No new dep (Node `crypto` only). Key derived from `{hostname, platform, uid|username, optional OBT_KEY_SECRET env}`. New `secrets` table stores `{key, ciphertext: base64(iv ‖ authTag ‖ ct), algo, created_at, updated_at}`. Rejected: keytar (native build pain), plaintext (unacceptable for security tool), env vars only (UX regression).

## Module Map

- `lib/policies/rule-loader.ts` — `loadPolicyRules({ workspaceRoot })`
- `lib/policies/engine.ts` — `evaluateFindings(findings, rules) → EvaluatedFinding[]`
- `lib/pipeline/stage4-filter.ts` — extended: FP filter → policy evaluate → consensus compute → persist
- `lib/enrichers/osv.ts` — POST https://api.osv.dev/v1/query, maps to cve_scores
- `lib/enrichers/socket.ts` — concurrency-5 batch, alert mapping table
- `lib/enrichers/cache.ts` — KV+TTL helpers (used by both)
- `lib/exporters/finding-shape.ts` — canonical `FindingExportShape` adapter
- `lib/exporters/{jira,slack,github-code-scanning}.ts`
- `lib/security/secret-store.ts`, `redact.ts`, `machine-key.ts`
- `lib/repos/finding-comments.repo.ts`, `finding-assignments.repo.ts`

## Schema Additions (drizzle 0013_v1_0.sql, all additive)

**findings** (ALTER ADD): status, suggested_assignee, policy_rule_id, consensus_score (REAL DEFAULT 1.0), consensus_status (TEXT DEFAULT 'single-source'), scanner_votes (JSON), jira_issue_key, jira_last_synced_at, sarif_last_uploaded_at, last_export_error, dedup_key.

**finding_comments** (NEW): id, finding_id FK, actor, body, mentions JSON, created_at.

**finding_assignments** (NEW): id, finding_id FK, assignee, actor, created_at, unassigned_at.

**cve_scores** (extended): ghsa_id, cvss_vector, affected_versions JSON, fixed_version, summary, source, ttl_sec.

**enrichment_cache** (NEW): key, value JSON, fetched_at, ttl_sec.

**secrets** (NEW): key PK, ciphertext (base64), algo, created_at, updated_at.

## Policy YAML Schema (Zod)

```
PolicyFile = { version: 1, rules: PolicyRule[] }
PolicyRule = { id, match: { path, rule_id?, detector? } }
           & ({ action: 'ignore', expiry?, reason? }
           | { action: 'severity_floor', floor: 'low'|'medium'|'high'|'critical' }
           | { action: 'assign', owner })
```

Workspace overrides global. Suppressed findings persisted with `status='policy_suppressed'`.

## Consensus Algorithm

```
groups = group findings by dedupeKey()
for g in groups:
  candidates = scannersPerFile[g.filePath]
  agreeing = unique(g.detectors)
  score = |agreeing| / |candidates|  (or 1.0 if |candidates|<=1)
  status = |candidates|<=1 ? 'single-source'
         : |agreeing|==|candidates| ? 'agree'
         : 'conflicted'
```

Errored scanners excluded from candidates.

## Export Bridge

**Jira REST v3**: HTTP Basic email:apiToken. Severity→priority: critical→Highest/high→High/medium→Medium/low→Low. Idempotent via `jira_issue_key`.

**Slack**: weekly cron, Block-kit, threshold >= 7d-1h, top-5 findings.

**GitHub Code Scanning**: POST /repos/{owner}/{repo}/code-scanning/sarifs base64(gzip(sarif)). Poll until processing_status=complete (5min cap). Retries 1s/2s/4s max 3.

## Feature Flags (ObtConfig extension)

`features.{policies,collaboration,consensus}` default true.
`integrations.{jira,slack,githubCodeScanning,socket}` — non-sensitive metadata only; sensitive tokens go to secret-store.

## Component Architecture

- `/settings/policies` — YAML editor + live Zod validation, writes `.obt/policies.yaml`
- `/settings/integrations` — credential forms; PUT /api/integrations/{target} → secret-store
- `/findings/[id]` — adds `<CollaborationPanel>` + `<ExportPanel>`
- `<ConsensusBadge>` — agree/single-source/conflicted with per-scanner vote tooltip
