# Spec: v0.2 — Diff Mode + Watch Mode + SARIF Export

## Domains

| Domain | Type | Requirements | Scenarios |
|--------|------|--------------|-----------|
| `diff-mode` | New | 5 | 16 |
| `watch-mode` | New | 4 | 13 |
| `sarif-export` | New | 4 | 13 |
| `github-pr-comment` | New | 5 | 16 |
| `webhook-receiver` | New | 3 | 9 |
| `scan-schema` | Delta (Modified) | 1 | 3 |

---

# Diff Mode Specification

## Purpose

Narrows the existing 5-stage scan pipeline to changed files plus their 1-hop callers in the import graph, triggered by a GitHub PR webhook.

## Requirements

### Requirement: Diff Strategy Registration

The pipeline MUST support a `diff` strategy type alongside existing modes. When strategy is `diff`, stage 1 MUST restrict its file set to `changed_files ∪ 1-hop-callers(changed_files)` derived from the repo import graph. The runner MUST NOT introduce a separate scan engine — all existing stages (1–5) MUST run on the narrowed file set.

#### Scenario: Diff strategy narrows file set

- GIVEN a scan with `strategy = 'diff'` and 10 changed files
- WHEN stage 1 runs
- THEN only the changed files plus their 1-hop callers are passed to classical analyzers

#### Scenario: Full-scan stages still execute

- GIVEN a scan with `strategy = 'diff'`
- WHEN the pipeline runs
- THEN stages 2–5 (LLM, dedup, EPSS, queue) execute on the narrowed result set
- AND the scan row has `strategy = 'diff'` in the DB

#### Scenario: Unknown strategy falls back to standard

- GIVEN a scan row with an unrecognized `strategy` value
- WHEN the runner initializes
- THEN it falls back to `standard` mode and emits a warning event

---

### Requirement: Diff Scan Performance Budget

A diff scan MUST complete in under 30 seconds (p95) for PRs with fewer than 500 changed lines. OSV-scanner MUST be skipped in diff scope to meet this budget. The import-graph lookup MUST be cached keyed by `(repo_id, head_sha)`.

#### Scenario: OSV skipped in diff scope

- GIVEN a scan with `strategy = 'diff'`
- WHEN stage 1 runs
- THEN the OSV-scanner adapter is not invoked

#### Scenario: Import graph cache hit

- GIVEN a cached import graph entry for `(repo_id, head_sha)`
- WHEN a diff scan starts
- THEN the 1-hop expansion uses the cached graph without re-parsing

#### Scenario: Hard timeout enforced

- GIVEN a diff scan that has been running for 25 seconds without completion
- WHEN the runner checks elapsed time
- THEN the scan is terminated and the scan row has `status = 'timeout'`

---

### Requirement: Diff Scan Parentage

Every diff scan MUST be stored as a child of the repo's most recent completed full scan by setting `parent_id` on the new scan row. Delta detection MUST compute net-new findings as `set(child.dedup_key) − set(parent.dedup_key)`.

#### Scenario: Diff scan references parent

- GIVEN a repo with a completed full scan S1
- WHEN a diff scan S2 is created
- THEN S2 has `parent_id = S1.id`

#### Scenario: Pre-existing finding excluded from results

- GIVEN finding F exists in parent scan S1 (same `dedup_key`)
- WHEN diff scan S2 runs and surfaces F
- THEN F is NOT included in the net-new findings set for PR comment or notification

---

### Requirement: Diff Scan No-Op Guard

A diff scan MUST NOT post a PR comment or trigger any notification if the net-new findings set is empty.

#### Scenario: Empty net-new set produces no comment

- GIVEN a diff scan where all detected findings share `dedup_key` with the parent scan
- WHEN the scan completes
- THEN no GitHub PR comment is created and no SSE `comment_posted` event is emitted

---

### Requirement: Diff Scan Metadata Columns

The `scans` table MUST include `strategy TEXT`, `base_sha TEXT`, and `head_sha TEXT` columns (all nullable). A diff scan MUST populate all three. A standard scan MUST have `strategy = 'standard'` and NULL SHA columns.

#### Scenario: Diff scan row has all metadata

- GIVEN a diff scan triggered by PR event with `base_sha = 'abc'`, `head_sha = 'def'`
- WHEN the scan row is created
- THEN `strategy = 'diff'`, `base_sha = 'abc'`, `head_sha = 'def'` are persisted

#### Scenario: Standard scan leaves SHA columns null

- GIVEN a full scan triggered manually
- WHEN the scan row is created
- THEN `base_sha` and `head_sha` are NULL

---

# Watch Mode Specification

## Purpose

Runs delta scans on a configurable cron schedule per repo and alerts users only on net-new findings via desktop or Slack notifications.

## Requirements

### Requirement: Per-Repo Watch Schedule

Watch Mode MUST support a configurable cron expression per repo, stored in the `repos` table. The default schedule MUST be every 6 hours (`0 */6 * * *`). Watch MUST be opt-in: disabled by default until explicitly enabled per repo.

#### Scenario: Default schedule is 6-hour interval

- GIVEN a repo with `watch_enabled = true` and no explicit `watch_interval`
- WHEN Watch Mode reads the schedule
- THEN it uses `0 */6 * * *`

#### Scenario: Custom schedule respected

- GIVEN a repo with `watch_interval = '0 9 * * 1-5'`
- WHEN Watch Mode reads the schedule
- THEN scans are scheduled at 09:00 Monday through Friday

#### Scenario: Watch disabled by default

- GIVEN a newly added repo
- WHEN the repos table is queried
- THEN `watch_enabled = false` and no cron job is registered for that repo

---

### Requirement: Delta Scan Baseline

A Watch Mode scan MUST use the most recent completed scan for the same `(repo_id, branch)` as its parent. If no prior scan exists, Watch Mode MUST run a full scan and record it as the baseline without sending any alert.

#### Scenario: First scan establishes baseline silently

- GIVEN a repo with `watch_enabled = true` and no prior scans
- WHEN Watch Mode triggers
- THEN a full scan runs, its result is stored, and no notification is dispatched

#### Scenario: Second scan diffs against baseline

- GIVEN a baseline scan B1 with known findings
- WHEN Watch Mode triggers again and scan B2 completes
- THEN notifications are sent only for findings in `B2.dedup_keys − B1.dedup_keys`

#### Scenario: Reverted finding triggers no alert

- GIVEN finding F was in B1 but absent from B2 (fixed)
- WHEN B2 scan completes
- THEN no alert is sent for F

---

### Requirement: Notification Transports

Watch Mode MUST support two notification channels: `desktop` (macOS/Linux OS notification) and `slack` (webhook POST). Both MUST be configurable per repo in `repos.notify_channels` (JSON array). A notification MUST only fire when at least one new finding clears the configured `notify_severity_floor` (default: `high`). The system MUST coalesce: at most 1 Slack message per repo per 5 minutes; desktop notifications are not rate-limited.

#### Scenario: Slack notification suppressed below severity floor

- GIVEN `notify_severity_floor = 'high'` and 3 net-new findings all with `severity = 'medium'`
- WHEN Watch Mode evaluates notifications
- THEN no Slack message is sent

#### Scenario: Slack coalescing within 5-minute window

- GIVEN a Slack message was sent for repo R at T=0
- WHEN another net-new finding appears at T=3min
- THEN no second Slack message is sent; it is deferred until T=5min

#### Scenario: Desktop + Slack both fire when configured

- GIVEN `notify_channels = ['desktop', 'slack']` and 1 critical net-new finding
- WHEN Watch Mode dispatches alerts
- THEN both a desktop notification and a Slack POST are sent

---

### Requirement: Watch Scan Isolation

Watch Mode MUST perform `git fetch` on a separate worktree under `~/.obt/worktrees/<repo>/<branch>`. It MUST NOT modify the user's working copy. If a cron-triggered scan collides with an already-running scan for the same `(repo_id, branch)`, the cron job MUST skip (advisory lock) and log a warning.

#### Scenario: User working copy untouched

- GIVEN a user with uncommitted changes in their repo working copy
- WHEN Watch Mode triggers a scan
- THEN the user's working copy files are unchanged after the scan

#### Scenario: Collision skips cron scan

- GIVEN a manual scan is running for `(repo_id = R, branch = 'main')`
- WHEN the cron fires for the same `(repo_id, branch)`
- THEN the cron scan is skipped and a warning is logged

---

# SARIF Export Specification

## Purpose

Emits findings as SARIF 2.1.0 for GitHub Security tab upload and ingests SARIF files from external tools as normalized findings.

## Requirements

### Requirement: SARIF 2.1.0 Emit

`GET /api/scans/[id]/sarif` MUST return a valid SARIF 2.1.0 JSON document. The response MUST pass runtime validation against the vendored SARIF 2.1.0 JSON Schema before being sent. On validation failure the endpoint MUST return HTTP 500 with a descriptive error (never an invalid SARIF document).

#### Scenario: Valid SARIF returned for completed scan

- GIVEN a completed scan with 3 findings
- WHEN `GET /api/scans/<id>/sarif` is called
- THEN the response has `Content-Type: application/json`, HTTP 200, and validates against SARIF 2.1.0 schema

#### Scenario: Validation failure returns 500

- GIVEN a bug causes an invalid SARIF document to be constructed
- WHEN the endpoint attempts to respond
- THEN HTTP 500 is returned with an error message; no malformed SARIF is emitted

#### Scenario: Empty scan produces valid empty SARIF

- GIVEN a scan with 0 findings
- WHEN `GET /api/scans/<id>/sarif` is called
- THEN a valid SARIF document with `runs[0].results = []` is returned

---

### Requirement: SARIF Field Mapping (Emit)

Each finding in the SARIF output MUST include: `ruleId` (from `detector + ':' + title`), `message.text` (finding description), `level` (`error` for critical/high, `warning` for medium, `note` for low/informational), `locations[0]` with `uri` (relative path) and `startLine`, and `partialFingerprints.primaryLocationLineHash` derived from `dedup_key`.

#### Scenario: High severity maps to SARIF error level

- GIVEN a finding with `severity = 'high'`
- WHEN SARIF is emitted
- THEN the result has `level = 'error'`

#### Scenario: Low severity maps to SARIF note level

- GIVEN a finding with `severity = 'low'`
- WHEN SARIF is emitted
- THEN the result has `level = 'note'`

#### Scenario: Fingerprint uses dedup_key

- GIVEN a finding with `dedup_key = 'abc123'`
- WHEN SARIF is emitted
- THEN `partialFingerprints.primaryLocationLineHash = 'abc123'`

---

### Requirement: SARIF Ingest

`POST /api/scans/[id]/sarif-import` MUST accept a SARIF 2.1.0 JSON file and persist each result as a normalized `findings` row with `scanner = 'sarif-import:<tool_name>'`. Findings MUST participate in dedup and the remediation queue. The endpoint MUST reject malformed SARIF (not valid against schema) with HTTP 422. Ingestion MUST be stream-parsed and MUST enforce a hard cap of 10,000 findings per import.

#### Scenario: CodeQL SARIF import produces findings

- GIVEN a valid CodeQL SARIF file with 5 results
- WHEN `POST /api/scans/<id>/sarif-import` is called
- THEN 5 findings appear in the `findings` table with `scanner = 'sarif-import:CodeQL'`

#### Scenario: Cap enforced at 10k findings

- GIVEN a SARIF file with 15,000 results
- WHEN the import runs
- THEN only the first 10,000 findings are persisted and a warning is included in the response

#### Scenario: Malformed SARIF rejected

- GIVEN an uploaded file that is not valid SARIF 2.1.0
- WHEN `POST /api/scans/<id>/sarif-import` validates the payload
- THEN HTTP 422 is returned and no findings are inserted

---

### Requirement: SARIF Severity Mapping (Ingest)

SARIF `level` values MUST map to the internal severity enum as follows: `error → high`, `warning → medium`, `note → low`. SARIF results with no `level` field MUST default to `medium`.

#### Scenario: SARIF error maps to high

- GIVEN a SARIF result with `level = 'error'`
- WHEN ingested
- THEN the finding has `severity = 'high'`

#### Scenario: Missing level defaults to medium

- GIVEN a SARIF result with no `level` field
- WHEN ingested
- THEN the finding has `severity = 'medium'`

---

# GitHub PR Comment Specification

## Purpose

Posts a structured finding summary to a GitHub PR after a diff scan and supports a one-click "Apply fix" action.

## Requirements

### Requirement: PR Comment Content

After a diff scan with at least one net-new finding, the system SHALL post a single structured Markdown comment to the PR. The comment MUST include per-finding: severity badge (CRITICAL/HIGH/MEDIUM/LOW), `file:line` hyperlink to the GitHub blob view, a one-sentence description, and an "Apply fix" action link. For PRs with more than 10 findings, findings MUST be collapsed in a `<details>` block with the count surfaced in the summary line.

#### Scenario: Comment posted with 3 findings

- GIVEN a diff scan with 3 net-new findings
- WHEN the scan completes
- THEN a GitHub PR comment is posted containing all 3 findings with severity badge, file:line link, description, and "Apply fix" link

#### Scenario: 11 findings collapsed

- GIVEN a diff scan with 11 net-new findings
- WHEN the PR comment is generated
- THEN the comment wraps findings in `<details>` with summary text showing the count (e.g., "11 findings")

#### Scenario: No comment when zero net-new findings

- GIVEN a diff scan where all findings match parent scan dedup_keys
- WHEN the scan completes
- THEN no GitHub API call is made to create a comment

---

### Requirement: Apply Fix Action

The "Apply fix" link MUST trigger `POST /api/findings/[id]/apply-fix-to-pr`. This endpoint MUST: re-fetch the current `head_sha` of the PR branch, reject with HTTP 409 if head_sha has moved since the scan (stale), apply `patch_diff` as a new commit on the PR branch via GitHub API, and post a follow-up comment confirming the fix commit SHA.

#### Scenario: Fix applied successfully

- GIVEN a finding with a valid `patch_diff` and the PR head_sha matches the scan's `head_sha`
- WHEN `POST /api/findings/<id>/apply-fix-to-pr` is called
- THEN a commit is created on the PR branch via GitHub API
- AND a follow-up comment is posted with the fix commit SHA

#### Scenario: Stale PR branch returns 409

- GIVEN the PR branch has received new commits since the diff scan
- WHEN apply-fix is triggered
- THEN HTTP 409 is returned with a message indicating the branch has moved

#### Scenario: Finding without patch_diff returns 400

- GIVEN a finding with `patch_diff = NULL`
- WHEN `POST /api/findings/<id>/apply-fix-to-pr` is called
- THEN HTTP 400 is returned

---

### Requirement: GitHub Token Storage

GitHub PAT MUST be stored through the existing settings/provider credential system. The token MUST never be written to the `scans` or `findings` tables. The token MUST be retrieved from the secure credential store at call time, not cached in memory across requests.

#### Scenario: Token read from credential store at call time

- GIVEN a valid GitHub PAT stored in the credential store
- WHEN the PR comment endpoint constructs the GitHub API call
- THEN the token is retrieved from the credential store immediately before use

#### Scenario: Missing token returns actionable error

- GIVEN no GitHub PAT is stored in the credential store
- WHEN a PR comment is attempted
- THEN the endpoint returns HTTP 424 with a message directing the user to settings

---

### Requirement: GitHub API Auth Error Surfacing

If the GitHub API returns HTTP 401 or 403, the system MUST surface a clear error in the UI settings page under the GitHub integration section. The scan MUST NOT be marked as failed — only the comment step MUST be marked as failed.

#### Scenario: 401 surfaces in settings

- GIVEN the stored GitHub PAT has been revoked
- WHEN a PR comment attempt receives HTTP 401 from GitHub
- THEN the GitHub integration section in settings shows a "Token invalid" error state

#### Scenario: Scan status unaffected by comment failure

- GIVEN the GitHub API returns 403 when posting the PR comment
- WHEN the pipeline processes the result
- THEN the scan `status` remains `done` and only the `pr_comment_status` column is set to `failed`

---

### Requirement: PR Comment Idempotency

The system MUST NOT post duplicate comments. Before posting, the system MUST search existing PR comments for a marker tag. If a marker comment exists from this scan, the system MUST update it (edit) rather than create a new one.

#### Scenario: Duplicate comment avoided on retry

- GIVEN a PR comment was already posted for scan S1
- WHEN the comment step is retried (e.g., after a transient error)
- THEN the existing comment is updated, not duplicated

---

# Webhook Receiver Specification

## Purpose

Receives GitHub PR webhook events, validates signatures, and enqueues diff scans asynchronously.

## Requirements

### Requirement: HMAC Signature Validation

`POST /api/webhooks/github` MUST validate the `X-Hub-Signature-256` header using HMAC-SHA256 with the per-repo `webhook_secret`. Requests with missing or invalid signatures MUST be rejected with HTTP 401. The webhook handler MUST NOT process the payload before signature validation completes.

#### Scenario: Valid signature accepted

- GIVEN a GitHub webhook POST with a valid `X-Hub-Signature-256` header
- WHEN the endpoint receives the request
- THEN signature validation passes and the event is enqueued

#### Scenario: Invalid signature rejected

- GIVEN a POST with a tampered payload or wrong secret
- WHEN the endpoint validates the signature
- THEN HTTP 401 is returned and no scan is enqueued

#### Scenario: Missing signature header rejected

- GIVEN a POST with no `X-Hub-Signature-256` header
- WHEN the endpoint runs
- THEN HTTP 401 is returned immediately

---

### Requirement: Async Enqueue

The webhook endpoint MUST respond within 3 seconds. Diff scan execution MUST be enqueued asynchronously — the HTTP response MUST be sent before the scan starts. The endpoint MUST return HTTP 202 on successful enqueue.

#### Scenario: 202 returned before scan completes

- GIVEN a valid webhook payload for a PR with 50 changed files
- WHEN `POST /api/webhooks/github` is called
- THEN HTTP 202 is returned within 3 seconds and the scan runs in the background

#### Scenario: Non-PR events acknowledged but not scanned

- GIVEN a GitHub webhook event with `action = 'labeled'` (not a PR open/sync)
- WHEN the endpoint receives it
- THEN HTTP 202 is returned and no scan is enqueued

---

### Requirement: Webhook Secret Configuration

The `webhook_secret` MUST be configurable per repo in the repo settings UI and stored via the existing encrypted credential system. It MUST NOT be stored in plaintext in the `repos` table.

#### Scenario: Secret stored encrypted

- GIVEN a user sets a webhook secret for repo R
- WHEN the value is persisted
- THEN it is stored using AES-256-GCM encryption, not as plaintext

#### Scenario: Secret rotatable from settings UI

- GIVEN an existing webhook secret for repo R
- WHEN the user saves a new secret value
- THEN the old value is overwritten and subsequent webhook calls use the new secret

---

# Delta for scan-schema

## MODIFIED Requirements

### Requirement: scans Table Strategy and SHA Columns

The `scans` table MUST include the following additional columns: `strategy TEXT NOT NULL DEFAULT 'standard'`, `base_sha TEXT` (nullable), `head_sha TEXT` (nullable), `parent_id TEXT` (nullable, FK to `scans.id`), and `pr_comment_status TEXT` (nullable). Existing rows MUST be valid after migration (`strategy` backfilled to `'standard'`, SHA and comment columns NULL).

(Previously: `scans` table had no `strategy`, SHA, `parent_id`, or `pr_comment_status` columns.)

#### Scenario: Diff scan row has all strategy columns

- GIVEN a diff scan triggered by a PR event
- WHEN the scan row is inserted
- THEN `strategy = 'diff'`, `base_sha`, `head_sha`, and `parent_id` are non-null

#### Scenario: Standard scan retains null SHA columns

- GIVEN a full manual scan
- WHEN the scan row is inserted
- THEN `base_sha = NULL`, `head_sha = NULL`, `parent_id = NULL`, `strategy = 'standard'`

#### Scenario: Migration backfills existing rows

- GIVEN existing scan rows before migration
- WHEN the migration runs
- THEN all existing rows have `strategy = 'standard'` and NULL SHA/parent columns
- AND the migration is idempotent on re-run

---

## Open Questions (for design phase)

- Q1: How does the webhook reach a local-first instance? (smee.io proxy vs. cloudflared vs. manual trigger — design must pick one and document tunnel setup time.)
- Q2: Where does the cron job live in a single Next.js process? (`node-cron` in `instrumentation.ts` vs. `bun run watch` sidecar — tradeoff is ops complexity vs. reliability.)
- Q3: SARIF `partialFingerprints` fingerprint: reuse `dedup_key` directly or derive a SARIF-specific hash that survives line-drift? Affects "moved but unchanged" finding behavior in GitHub Security tab.
- Q4: Notification matcher granularity: global per repo, per `(repo, channel)`, or per `(repo, channel, rule_id)`? Spec assumes per-repo floor; design may refine.
