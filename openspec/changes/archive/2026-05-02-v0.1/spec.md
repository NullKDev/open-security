# Spec: v0.1 — Queue + Branch-per-finding + Findings Dedup + EPSS/KEV Scoring

## Domains

| Domain | Type | Requirements | Scenarios |
|--------|------|-------------|-----------|
| `remediation-queue` | New | 5 | 14 |
| `cve-enrichment` | New | 4 | 11 |
| `findings-dedup` | New | 3 | 8 |
| `false-positive-bank` | New | 4 | 10 |
| `branch-remediation` | New | 4 | 11 |
| `scan-schema` | Delta (Modified) | 1 | 3 |
| `ui-components` | Delta (Modified) | 1 | 3 |

---

# Remediation Queue Specification

## Purpose

Global, cross-project, ranked list of open canonical findings at `/`. Replaces the project dashboard as the home screen.

## Requirements

### Requirement: Queue Ranking Formula

The queue MUST rank findings using the formula `exploitability_score × epss_score × (1 + cisa_kev_bonus) × age_weight` computed at query time. `age_weight` MUST equal `ln(1 + days_open)`. `cisa_kev_bonus` MUST be `0.5` when the finding's CVE is in the CISA KEV catalog, `0` otherwise. Findings with no EPSS score MUST be treated as `epss_score = 0.01`.

#### Scenario: KEV finding ranks above non-KEV with same EPSS

- GIVEN two findings with identical `exploitability_score`, `epss_score = 0.5`, and `days_open = 7`
- WHEN one has `cisa_kev = 1` and the other has `cisa_kev = 0`
- THEN the KEV finding MUST appear higher in the ranked queue

#### Scenario: Null EPSS treated as 0.01

- GIVEN a finding with no matching row in `cve_scores`
- WHEN the queue query runs
- THEN the finding MUST appear in results using `epss_score = 0.01` (not excluded)

#### Scenario: Older finding ranks above newer equal-severity finding

- GIVEN two findings with identical `exploitability_score`, `epss_score`, and KEV status
- WHEN one has `days_open = 30` and the other has `days_open = 1`
- THEN the finding with `days_open = 30` MUST have a higher rank score

---

### Requirement: Queue Shows Only Canonical Findings

The queue MUST display only findings where `canonical_finding_id IS NULL` (i.e., the canonical representative). Findings with a non-null `canonical_finding_id` (duplicates) MUST NOT appear as separate rows.

#### Scenario: Duplicate suppressed from queue

- GIVEN finding A (canonical) and finding B with `canonical_finding_id = A.id`
- WHEN the queue loads
- THEN only finding A appears; finding B is absent

---

### Requirement: Queue Filters

The queue MUST support server-side filters: severity (multi-select), project (multi-select), has-patch (boolean toggle), and status (open / dismissed). Filters MUST be applied via query parameters; changing a filter MUST NOT cause a full page reload.

#### Scenario: Severity filter returns only matching findings

- GIVEN findings of severity `critical`, `high`, and `low`
- WHEN filter `severity=critical,high` is applied
- THEN only `critical` and `high` findings appear

#### Scenario: Has-patch filter returns only patchable findings

- GIVEN findings where some have `patch_diff IS NOT NULL`
- WHEN `has_patch=true` filter is applied
- THEN only findings with a non-null `patch_diff` appear

#### Scenario: Dismissed findings excluded by default

- GIVEN a finding dismissed via `finding_dismissals` with `undone_at IS NULL`
- WHEN the queue loads with default filters
- THEN the dismissed finding does not appear

---

### Requirement: Queue Pagination

The queue MUST paginate at 50 items per page using cursor-based pagination. An empty queue MUST render an empty state with a CTA to run a scan.

#### Scenario: Empty queue shows CTA

- GIVEN no canonical, non-dismissed findings exist
- WHEN `/` loads
- THEN an empty-state element with a link or button to initiate a scan MUST be visible

#### Scenario: Next page cursor returns next 50

- GIVEN 51 canonical findings
- WHEN the first page loads
- THEN 50 items appear and a next-page cursor is available

---

### Requirement: Queue Item Display

Each queue row MUST display: title, project/repo name, severity badge, EPSS percentage (color-coded: `>50%` red, `20–50%` orange, `<20%` gray), KEV badge when applicable, reachability status when known, days open, and action buttons (Investigate, Create Fix Branch, Dismiss).

#### Scenario: KEV badge present only when applicable

- GIVEN a finding with `cisa_kev = 1`
- WHEN rendered in the queue
- THEN a KEV badge MUST be visible

- GIVEN a finding with `cisa_kev = 0`
- WHEN rendered in the queue
- THEN no KEV badge appears

#### Scenario: EPSS color coding

- GIVEN a finding with `epss_score = 0.65`
- WHEN rendered
- THEN the EPSS percentage display MUST use the red color tier

---

# CVE Enrichment Specification

## Purpose

Fetches and caches EPSS scores (FIRST.org) and CISA KEV membership per CVE ID. Runs async after scan completion.

## Requirements

### Requirement: cve_scores Table and TTL

The system MUST maintain a `cve_scores` table with columns `cve_id TEXT PRIMARY KEY`, `epss_score REAL`, `epss_percentile REAL`, `cisa_kev INTEGER`, `fetched_at TEXT`. A cached record MUST be considered stale when `fetched_at < NOW - 24h`. Stale records MUST be re-fetched on next access.

#### Scenario: Fresh record returned without network call

- GIVEN a `cve_scores` row for `CVE-2024-1234` with `fetched_at` 2 hours ago
- WHEN `getScoresForCves(['CVE-2024-1234'])` is called
- THEN the cached row is returned and no HTTP request is made

#### Scenario: Stale record triggers re-fetch

- GIVEN a `cve_scores` row with `fetched_at` 25 hours ago
- WHEN `getScoresForCves` is called for that CVE
- THEN a fresh EPSS request MUST be made and the row MUST be updated

---

### Requirement: EPSS Fetch Rate Limiting

The enrichment service MUST NOT send more than 10 EPSS API requests per second to `api.first.org`.

#### Scenario: Bulk enrichment respects rate limit

- GIVEN 25 new CVE IDs requiring enrichment
- WHEN the enrichment batch runs
- THEN no more than 10 EPSS requests are dispatched in any single 1-second window

---

### Requirement: CVE ID Extraction

The enrichment service MUST extract CVE IDs from findings where `detector = 'osv'` by applying the regex `CVE-\d{4}-\d{4,}` against `title` and `description`. Extracted IDs MUST be stored in the `cve_ids` column on the `findings` table.

#### Scenario: CVE extracted from osv finding title

- GIVEN an osv finding with `title = 'CVE-2023-44487: HTTP/2 Rapid Reset'`
- WHEN enrichment runs post-scan
- THEN `cve_ids` on that finding MUST contain `CVE-2023-44487`

#### Scenario: Non-osv finding not enriched

- GIVEN a finding with `detector = 'semgrep'`
- WHEN enrichment runs
- THEN no CVE extraction or EPSS fetch is attempted for that finding

---

### Requirement: Graceful Degradation

Network failures during enrichment MUST be logged as warnings. They MUST NOT block scan completion, queue rendering, or any API response. Missing scores MUST fall back to `epss_score = 0.01` in the ranking formula.

#### Scenario: Network failure does not fail the scan

- GIVEN the EPSS API is unreachable
- WHEN enrichment runs after scan completion
- THEN the scan status remains `done` and a warning is logged
- AND the affected findings appear in the queue with `epss_score = 0.01`

#### Scenario: KEV fetch failure falls back gracefully

- GIVEN the CISA KEV JSON endpoint returns a network error
- WHEN enrichment attempts to refresh the KEV catalog
- THEN the existing cached KEV data is used (or `cisa_kev = 0` if no cache exists)

---

# Findings Dedup Specification

## Purpose

Ensures the same vulnerability found across multiple scans appears as a single canonical row in the queue and finding views.

## Requirements

### Requirement: Dedup Key Derivation

Each finding MUST have a `dedup_key` column computed as SHA-256 of `normalize(detector + '|' + location_path + '|' + title)`, where normalize means lowercase, trim, and collapse all internal whitespace to a single space.

#### Scenario: Same finding in two scans produces same key

- GIVEN two findings with identical `detector`, `location_path`, and `title` (modulo whitespace)
- WHEN `dedup_key` is computed for each
- THEN both keys are identical

#### Scenario: Different location produces different key

- GIVEN two findings with identical `detector` and `title` but different `location_path`
- WHEN `dedup_key` is computed
- THEN the keys differ

---

### Requirement: Canonical Linking on Insert

When `insertFinding` is called, the system MUST query `findings WHERE dedup_key = ?`. If a canonical row exists (i.e., a row with `canonical_finding_id IS NULL` and the same `dedup_key`), the new finding MUST be inserted with `canonical_finding_id` set to that existing row's `id`, and the existing row's `occurrence_count` MUST be incremented and `last_seen_at` MUST be updated to the current timestamp.

#### Scenario: Duplicate finding links to canonical

- GIVEN finding A already stored with `dedup_key = 'abc123'` and `canonical_finding_id IS NULL`
- WHEN finding B with the same `dedup_key` is inserted
- THEN finding B has `canonical_finding_id = A.id`
- AND finding A has `occurrence_count = 2` and an updated `last_seen_at`

#### Scenario: First occurrence is canonical

- GIVEN no existing finding with a given `dedup_key`
- WHEN a new finding is inserted
- THEN it is stored with `canonical_finding_id IS NULL` and `occurrence_count = 1`

---

### Requirement: Occurrence Badge on Finding Detail

The finding detail view MUST display a badge reading "Seen N times across M scans" when `occurrence_count > 1`.

#### Scenario: Badge visible for recurring finding

- GIVEN a canonical finding with `occurrence_count = 3`
- WHEN the finding detail page renders
- THEN a badge with text matching "Seen 3 times" MUST be visible

---

# False-Positive Bank Specification

## Purpose

Records dismissals by `dedup_key` so the same vulnerability is suppressed from the queue across all scans and never resurfaces without explicit re-opening.

## Requirements

### Requirement: finding_dismissals Table

The system MUST have a `finding_dismissals` table with columns: `id TEXT PRIMARY KEY`, `finding_id TEXT` (FK → `findings.id`), `dedup_key TEXT NOT NULL`, `fp_type TEXT NOT NULL`, `reason TEXT NOT NULL`, `dismissed_at TEXT NOT NULL`, `undone_at TEXT`. `fp_type` MUST be one of `false_positive | acceptable_risk | wont_fix | duplicate`. `reason` MUST be at minimum 10 characters; shorter values MUST be rejected at the API boundary.

#### Scenario: Dismissal with short reason rejected

- GIVEN a `POST /api/findings/{id}/dismiss` request with `reason = 'nope'` (4 chars)
- WHEN the Zod schema validates the request body
- THEN a 400 response MUST be returned with a validation error

#### Scenario: Valid dismissal stored

- GIVEN a valid dismiss request with `fp_type = 'false_positive'` and `reason = 'This path is test-only code'`
- WHEN `POST /api/findings/{id}/dismiss` is called
- THEN a row is inserted into `finding_dismissals` with `undone_at = NULL`

---

### Requirement: Dismissal Suppresses by dedup_key

A finding MUST be excluded from the queue if ANY active dismissal (where `undone_at IS NULL`) shares its `dedup_key`. This suppression MUST apply across all scans and all occurrences sharing that key.

#### Scenario: Dismissed finding absent from queue

- GIVEN finding A with `dedup_key = 'xyz'` is dismissed
- WHEN the queue query runs
- THEN finding A does not appear

#### Scenario: Finding with same key in a later scan also suppressed

- GIVEN `dedup_key = 'xyz'` has an active dismissal
- WHEN a new scan produces a finding with the same `dedup_key`
- THEN the new finding does not appear in the queue

---

### Requirement: Dismissal Undo

A dismissed finding MAY be reinstated. Calling `DELETE /api/findings/{id}/dismiss` MUST set `undone_at = NOW()` on the active `finding_dismissals` row. The finding MUST reappear in the queue on the next load.

#### Scenario: Undo reinstates finding

- GIVEN finding A is dismissed with `undone_at = NULL`
- WHEN `DELETE /api/findings/A/dismiss` is called
- THEN the dismissal row has `undone_at` set to a non-null timestamp
- AND finding A appears in the queue on the next load

---

### Requirement: FP Bank Search Page

The FP bank MUST be accessible at `/findings?tab=dismissed`. It MUST support full-text search via FTS5 on dismissal `reason` and the associated finding `title`. The page MUST list all active dismissals with their `fp_type`, `reason`, and a re-open action.

#### Scenario: FTS5 search returns matching dismissals

- GIVEN a dismissal with `reason = 'Path traversal in test fixtures only'`
- WHEN the user searches for `'test fixtures'`
- THEN that dismissal MUST appear in results

#### Scenario: Dismissed findings visible in FP bank

- GIVEN 3 active dismissals
- WHEN `/findings?tab=dismissed` loads
- THEN all 3 dismissals are listed

---

# Branch Remediation Specification

## Purpose

Creates a `sec/fix/<finding-id>` branch with `patch_diff` applied and optional test execution, tracking status per finding.

## Requirements

### Requirement: finding_branches Table and State Machine

The system MUST have a `finding_branches` table: `id TEXT PK`, `finding_id TEXT FK`, `branch_ref TEXT`, `status TEXT`, `apply_error TEXT`, `tests_output TEXT`, `tests_passed INTEGER`, `pr_url TEXT`, `created_at TEXT`. `status` MUST follow the state machine: `pending → creating → apply_failed | tests_running → tests_failed | created`.

#### Scenario: Initial status is pending

- GIVEN `POST /api/findings/{id}/branch` is called
- WHEN the branch record is created
- THEN `status` MUST be `pending`

#### Scenario: apply_failed on non-zero git apply --check

- GIVEN `git apply --check` exits with a non-zero code
- WHEN the branch creation process runs
- THEN `status` MUST be set to `apply_failed` and `apply_error` MUST contain stderr output

---

### Requirement: Branch Creation Flow

`POST /api/findings/{id}/branch` MUST: (1) checkout a new branch named `sec/fix/<first-8-chars-of-finding-id>` from `scan.commit_hash`, (2) write `patch_diff` to a temp file and run `git apply --check`, (3) if check passes run `git apply`, set status to `created`; if check fails set `apply_failed` with stderr. All git operations MUST run in `scan.targetPath`.

#### Scenario: Branch created successfully

- GIVEN a finding with a valid `patch_diff` and a reachable `scan.targetPath`
- WHEN `POST /api/findings/{id}/branch` is called
- THEN a branch `sec/fix/<id-prefix>` MUST exist in the repo
- AND the branch record has `status = 'created'`

#### Scenario: Branch only rendered when patch_diff exists

- GIVEN a finding with `patch_diff = NULL`
- WHEN the finding detail page renders
- THEN the "Create Fix Branch" action MUST NOT be visible

---

### Requirement: Optional Test Runner

If the project has a `test_command` configured (opt-in, default OFF), the system MUST run it after a successful `git apply`. The last 2000 characters of stdout/stderr MUST be stored in `tests_output`. `tests_passed` MUST be `1` if exit code is `0`, `0` otherwise. If `test_command` is not configured, the test step MUST be skipped.

#### Scenario: Tests run when configured

- GIVEN a project with `test_command = 'npm test'` and a successful `git apply`
- WHEN branch creation completes the apply step
- THEN `npm test` MUST run in `scan.targetPath`
- AND `tests_passed` reflects the exit code
- AND `tests_output` contains up to the last 2000 chars of output

#### Scenario: Tests skipped when not configured

- GIVEN a project with no `test_command`
- WHEN branch creation completes apply
- THEN status is set to `created` without running any test command

---

### Requirement: Branch Status Display

The finding card MUST display a status pill for the branch with color coding: gray = pending/creating, blue = tests_running, green = created or tests_passed, red = apply_failed or tests_failed. Branch status MUST be pollable via `GET /api/findings/{id}/branch`.

#### Scenario: Green pill when tests pass

- GIVEN a branch record with `status = 'created'` and `tests_passed = 1`
- WHEN the finding card renders
- THEN a green status pill MUST be visible

#### Scenario: Red pill on apply failure

- GIVEN a branch record with `status = 'apply_failed'`
- WHEN the finding card renders
- THEN a red status pill MUST be visible

---

# Delta for scan-schema

## MODIFIED Requirements

### Requirement: findings Table Columns

The `findings` table MUST include the following additional columns: `cve_ids TEXT` (nullable, JSON array of CVE ID strings), `dedup_key TEXT` (nullable, indexed), `canonical_finding_id TEXT` (nullable, FK to `findings.id`), `occurrence_count INTEGER NOT NULL DEFAULT 1`, `last_seen_at TEXT` (nullable).

(Previously: `findings` table had no dedup, CVE, or occurrence columns.)

#### Scenario: New finding inserted with dedup columns

- GIVEN a `CreateFindingInput` processed by `insertFinding`
- WHEN the insert completes
- THEN the row MUST have `dedup_key` populated and `occurrence_count = 1`

#### Scenario: cve_ids stored as JSON array

- GIVEN an osv finding with two extracted CVE IDs
- WHEN the finding is inserted
- THEN `cve_ids` MUST be a valid JSON array: `["CVE-2023-1234","CVE-2023-5678"]`

#### Scenario: dedup_key index exists after migration

- GIVEN the v0.1 migration has been applied
- WHEN a query filters by `dedup_key`
- THEN the query planner uses the index (no full-table scan)

---

# Delta for ui-components

## MODIFIED Requirements

### Requirement: Queue and Badge Components

The UI MUST include the following new components: `QueueRow` (renders a single queue item per the queue item display requirement), `EpssBadge` (renders EPSS percentage with color tier), `KevBadge` (renders KEV indicator), and `BranchPanel` (renders branch status pill and Create Fix Branch action). These components MUST NOT contain hardcoded `.obt` path strings.

(Previously: no queue, badge, or branch panel components existed.)

#### Scenario: EpssBadge uses red color for >50% EPSS

- GIVEN `<EpssBadge epssScore={0.72} />`
- WHEN rendered
- THEN the badge text shows `72%` and applies the red color class

#### Scenario: BranchPanel hidden when patch_diff is null

- GIVEN a finding with `patchDiff = null`
- WHEN `BranchPanel` receives this prop
- THEN no "Create Fix Branch" button is rendered

#### Scenario: Home route renders QueueRow list

- GIVEN canonical findings exist
- WHEN `/` loads
- THEN `QueueRow` components are rendered (not the old project dashboard)

---

## FTS5 Virtual Tables

### Requirement: FTS5 Sync Triggers

The system MUST maintain FTS5 virtual tables `findings_fts(title, description, location_path)` and `fp_bank_fts(reason, title)` kept in sync via SQL triggers. `findings_fts` rowid MUST be linked to `findings.id`. `fp_bank_fts` rowid MUST be linked to `finding_dismissals.id`. These tables MUST be created via raw SQL in a custom migration file (not managed by Drizzle's schema introspection).

#### Scenario: FTS5 search on findings

- GIVEN a finding with `title = 'SQL injection in user login'`
- WHEN an FTS5 query `MATCH 'injection'` is run against `findings_fts`
- THEN that finding's rowid appears in results

#### Scenario: FTS5 entry removed on finding delete

- GIVEN a finding row is deleted from `findings`
- WHEN the delete trigger fires
- THEN the corresponding row MUST be removed from `findings_fts`
