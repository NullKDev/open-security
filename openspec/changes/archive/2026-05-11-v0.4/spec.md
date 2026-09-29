# v0.4 Specification — Fix & Prove + Posture Trends + MTTR + Regression Tracker + FP Bank

> Change: v0.4
> Status: Spec
> Depends on: v0.1 (branch-remediation, dedup, fp-bank schema), v0.2 (PR comments, Watch Mode), v0.3 (ACP transport, scan_events)

---

## New Capability: fix-and-prove

The system SHALL implement the PatchEval triad to produce cryptographic-equivalent proof that a patch eliminates a vulnerability.

| ID | Requirement |
|----|-------------|
| REQ-FP-01 | After a fix branch is created, the agent SHALL run the project's test suite and report pass/fail as `unit_test_passed`. |
| REQ-FP-02 | The agent SHALL author a regression test via ACP targeting the specific vulnerability's code path, storing the result at `regression_test_path`. |
| REQ-FP-03 | The system SHALL validate the fix via the triad: `vul_run_passed_pre=false` (pre-patch), apply patch, `vul_run_passed_post=true` (post-patch). |
| REQ-FP-04 | `status=verified-fixed` SHALL only be set when `unit_test_passed=true AND vul_run_passed_pre=false AND vul_run_passed_post=true`. All other outcomes MUST set `status=fix-unverified` with a failure reason. |
| REQ-FP-05 | The PR comment SHALL contain two separate diffs: the fix diff and the regression test diff, plus collapsible pre/post test output. |
| REQ-FP-06 | The finding SHALL be annotated with `proof_of_fix` metadata: `regression_test_path`, `vul_run_passed_pre`, `vul_run_passed_post`, `unit_test_passed`. |
| REQ-FP-07 | If no `patch_diff` exists on the finding, Fix & Prove SHALL NOT run and MUST set `status=fix-unverified` with `reason=no-patch`. |

#### Scenario: Happy path — full triad passes

- GIVEN a finding with a valid `patch_diff` and the project has a configured test command
- WHEN the agent runs Fix & Prove
- THEN `unit_test_passed=true`, `vul_run_passed_pre=false`, `vul_run_passed_post=true`
- AND `status=verified-fixed` and the PR receives a dual-diff comment

#### Scenario: Regression test does not catch the vuln

- GIVEN the authored regression test passes on the pre-patch commit
- WHEN `vul_run_passed_pre` is evaluated
- THEN the value MUST be `true` (test is invalid)
- AND `status=fix-unverified` with `reason=regression-test-invalid`, no auto-merge

#### Scenario: Patch does not fix the vuln

- GIVEN the regression test fails on the post-patch commit
- WHEN `vul_run_passed_post` is evaluated
- THEN `status=fix-unverified` with `reason=vul-not-eliminated`

#### Scenario: No patch available

- GIVEN a finding with `patch_diff=null`
- WHEN Fix & Prove is triggered
- THEN `status=fix-unverified` with `reason=no-patch` and the triad does not run

#### Scenario: Unit test suite is red before the patch

- GIVEN the project's test suite fails before any patch is applied
- WHEN `unit_test_passed` is evaluated
- THEN `status=fix-unverified` with `reason=unit-test-baseline-red`

---

## New Capability: fp-bank-audit

The system SHALL promote the v0.1 `finding_dismissals` schema to a first-class auditable surface with search, appeal, and agent-assisted drafting.

| ID | Requirement |
|----|-------------|
| REQ-FB-01 | A user SHALL be able to dismiss any finding as a false positive with a rationale of minimum 10 characters. |
| REQ-FB-02 | A dismissed finding SHALL be suppressed from the queue and all future scans sharing the same `dedup_key`. |
| REQ-FB-03 | The FP bank SHALL be searchable by rationale text (FTS5), rule name, file path, and author. |
| REQ-FB-04 | Every write to `finding_dismissals` (create, edit, appeal) SHALL append an immutable row to `finding_dismissal_history` with actor, action, rationale snapshot, and timestamp. |
| REQ-FB-05 | A user SHALL be able to appeal a dismissal, which re-surfaces the finding in the queue with `appealed_at` set and the original rationale preserved. |
| REQ-FB-06 | FP dismissals SHALL export to and import from SARIF suppression format. |
| REQ-FB-07 | The agent-assisted draft rationale SHALL populate the rationale field but SHALL NOT auto-submit. The submit button MUST be disabled for 5 seconds after draft load. The audit row MUST record `source=agent-assisted`. |

#### Scenario: Dismiss with valid rationale

- GIVEN a finding in the queue and the user types a 25-character rationale
- WHEN the user submits the dismissal
- THEN the finding is removed from the queue, `finding_dismissals` has a new row, and `finding_dismissal_history` has `action=created`

#### Scenario: Rationale too short

- GIVEN the user types a 5-character rationale
- WHEN the submit button is clicked
- THEN validation rejects the submission with an error message; no row is written

#### Scenario: Appeal a dismissal

- GIVEN a dismissed finding
- WHEN the user clicks "Appeal" and provides a counter-rationale
- THEN `appealed_at` is set, the finding re-appears in the queue with an "Appealed" badge
- AND `finding_dismissal_history` gains a row with `action=appealed`

#### Scenario: FTS5 search returns matching rationales

- GIVEN 20+ dismissals in the bank, some containing "eval config"
- WHEN the user searches for "eval config" via `/dismissed?q=eval+config`
- THEN only dismissals whose `reason` or `appeal_reason` matches are returned

#### Scenario: Agent draft — cooldown enforced

- GIVEN the user clicks "Draft rationale" on a finding
- WHEN the ACP draft populates the rationale field
- THEN the submit button remains disabled for exactly 5 seconds before becoming active

---

## New Capability: posture-dashboard

The system SHALL expose a single `/posture` page with four severity-based charts, all backed by pure SQL views with no aggregation pipeline.

| ID | Requirement |
|----|-------------|
| REQ-PT-01 | The `/posture` page SHALL render a severity-weighted finding count per scan over time (line chart, daily buckets). Weights: critical=10, high=5, medium=2, low=1, info=0. |
| REQ-PT-02 | The posture chart SHALL support time-range filters: 7d, 30d, 60d, 90d, all. Default: 30d. |
| REQ-PT-03 | The page SHALL surface a hotspot heatmap: files × authors with distinct `dedup_key` count. `repeat_offender=true` when `count(distinct dedup_key) >= 3`. |
| REQ-PT-04 | The page SHALL show "open critical days": `sum(now() - created_at)` over open critical findings not in `finding_dismissals`. |
| REQ-PT-05 | All four charts SHALL be filterable by repo. |
| REQ-PT-06 | The four-chart page SHALL render in under 500 ms first paint on a 10,000-finding fixture. |

#### Scenario: Severity-weighted chart — happy path

- GIVEN 90 days of scan history with mixed severities
- WHEN the user opens `/posture` with the default 30d filter
- THEN a line chart shows daily severity-weighted counts for the last 30 days
- AND the critical line uses weight 10, the high line uses weight 5

#### Scenario: Time range filter changes dataset

- GIVEN the user is on `/posture` with the 30d filter active
- WHEN the user switches to 7d
- THEN the chart data refreshes to cover only the last 7 calendar days

#### Scenario: Hotspot heatmap repeat-offender flag

- GIVEN a file has 3 distinct `dedup_key` findings attributed to the same author
- WHEN the heatmap renders
- THEN the cell for that file × author shows `repeat_offender=true` with a visual indicator

#### Scenario: Open critical days — no open criticals

- GIVEN all critical findings are either merged or dismissed
- WHEN the open critical days scalar renders
- THEN it displays 0

#### Scenario: Repo filter scopes all four charts

- GIVEN two repos with independent finding histories
- WHEN the user selects repo A from the repo filter
- THEN all four charts reflect only findings belonging to repo A

---

## New Capability: mttr-analytics

The system SHALL compute MTTR (Mean Time To Remediate) per severity over rolling time windows.

| ID | Requirement |
|----|-------------|
| REQ-MT-01 | MTTR SHALL be the median time from `findings.first_detected_at` to `finding_branches.merged_at`, grouped by severity. |
| REQ-MT-02 | MTTR SHALL be displayed for rolling 30d, 60d, and 90d windows simultaneously. |
| REQ-MT-03 | Findings without a `merged_at` SHALL be excluded from MTTR computation. |
| REQ-MT-04 | When sample size is below 5, MTTR SHALL display a low-confidence indicator (`(n=N, low confidence)` annotation). |
| REQ-MT-05 | `GET /api/posture/mttr` SHALL accept optional `repo` and `severity` query params and return `{ avg_seconds, median_seconds, sample_size, refreshed_at }`. |

#### Scenario: MTTR computed correctly for high severity

- GIVEN 10 high-severity findings with known `first_detected_at` and `merged_at` values
- WHEN `/api/posture/mttr?severity=high&window=30d` is called
- THEN `median_seconds` matches the median of the 10 durations and `sample_size=10`

#### Scenario: Low-confidence indicator on small sample

- GIVEN only 3 critical findings have `merged_at` in the last 30 days
- WHEN the MTTR chart renders for critical severity
- THEN the value displays with a low-confidence annotation `(n=3)`

#### Scenario: Open finding excluded from MTTR

- GIVEN a finding with `merged_at=null`
- WHEN MTTR is computed
- THEN that finding is not counted in the numerator or denominator

#### Scenario: Global rollup — no repo filter

- GIVEN `/api/posture/mttr` is called without a `repo` param
- WHEN the response is returned
- THEN it aggregates across all repos

---

## New Capability: regression-detection

The system SHALL detect when a previously-fixed vulnerability reappears and surface it with distinct visual treatment.

| ID | Requirement |
|----|-------------|
| REQ-RT-01 | A finding is a regression if its `dedup_key` appears in `finding_branches` with `merged_at IS NOT NULL` AND the new finding's `created_at > merged_at`. |
| REQ-RT-02 | A regression finding SHALL set `status=regression` and insert a row into `finding_regressions` linking original and regressed findings. |
| REQ-RT-03 | Regression findings SHALL render in the queue with a distinct `REGRESSION` band, positioned above HIGH and below CRITICAL by default, controlled by `regression_bonus` (default 2.0). |
| REQ-RT-04 | The system SHALL link a regression to its original fix branch/PR and the regressing commit (best-effort: most recent commit touching the affected file). |
| REQ-RT-05 | The regression rate (regressions / total fixes, rolling 30d) SHALL be visible on the posture page. |
| REQ-RT-06 | On scan completion, if new regressions were detected, exactly one desktop notification SHALL fire: "N regressions detected — see queue". |

#### Scenario: Regression detected on rescan

- GIVEN finding F1 with `dedup_key=K1` had its fix branch merged (`merged_at` set)
- WHEN a new scan produces finding F2 with `dedup_key=K1` and `created_at > merged_at`
- THEN F2 has `status=regression`, a `finding_regressions` row links F1 → F2
- AND F2 appears in the queue with the REGRESSION band

#### Scenario: First occurrence is not a regression

- GIVEN a finding with `dedup_key=K2` has no prior `merged_at` in `finding_branches`
- WHEN a new scan produces a finding with `dedup_key=K2`
- THEN it is treated as a normal finding, not a regression

#### Scenario: Notification batching

- GIVEN a single scan produces 10 regression findings
- WHEN scan finalization completes
- THEN exactly 1 desktop notification fires with the message "10 regressions detected — see queue"

#### Scenario: Regression lineage view

- GIVEN a regression finding F2 exists
- WHEN the user navigates to `/findings/{F2.id}/regression`
- THEN the page shows: original merged PR URL, merging commit SHA, regressing commit SHA, file diff between the two commits on the affected paths

#### Scenario: regression_bonus tuning

- GIVEN the operator sets `regression_bonus=3.0` for repo R
- WHEN the queue renders for repo R
- THEN regression findings score higher in the ranking formula than with the default 2.0

---

## Modified Capability: scan-schema (delta)

### ADDED Requirements

#### Requirement: finding_dismissal_history Table

The schema SHALL include a `finding_dismissal_history` table: `(id, dismissal_id FK, action ENUM(created|edited|appealed|re-dismissed), actor TEXT, rationale_snapshot TEXT, source ENUM(hand|agent-assisted), ts DATETIME)`. This table is append-only; rows MUST NOT be updated or deleted.

#### Scenario: Audit row on dismissal create

- GIVEN a dismissal is created
- WHEN the write completes
- THEN `finding_dismissal_history` gains one row with `action=created` and `source` matching the input method

#### Requirement: finding_regressions Table

The schema SHALL include a `finding_regressions` table: `(id, original_finding_id FK, regressed_finding_id FK, original_branch_id FK, regression_commit_sha TEXT, detected_at DATETIME)`.

#### Scenario: Regression row links two findings

- GIVEN F1 and F2 share a `dedup_key` and F2 is detected as a regression
- WHEN the regression-detect hook runs
- THEN `finding_regressions` contains one row with `original_finding_id=F1.id`, `regressed_finding_id=F2.id`

#### Requirement: findings Table — Status Enum Widening

The `findings.status` enum SHALL be extended with three additive values: `verified-fixed`, `fix-unverified`, `regression`. Existing rows with `open`, `fixed`, or `dismissed` MUST remain valid without backfill. Existing `merged_at IS NOT NULL` rows SHALL NOT be auto-promoted to `verified-fixed`.

#### Scenario: Existing rows survive migration

- GIVEN rows with `status IN ('open', 'fixed', 'dismissed')` before migration
- WHEN the migration runs
- THEN all rows are valid and their status values are unchanged

#### Requirement: mttr_by_severity_view Materialized View

The schema SHALL include a `mttr_by_severity_view` materialized view computing median and average `(merged_at - first_detected_at)` per severity. The view SHALL refresh on scan completion. The view SHALL include a `refreshed_at` column.

#### Scenario: View reflects latest data after scan

- GIVEN a scan completes with new `merged_at` values
- WHEN `mttr_by_severity_view` is queried
- THEN `refreshed_at` is within 1 second of scan completion time

---

## Modified Capability: rich-event-taxonomy (delta)

### ADDED Requirements

#### Requirement: New Event Variants

The `ScanEvent` discriminated union SHALL include four new variants persisted in `scan_events`:

| Event | Fields |
|-------|--------|
| `RegressionTestAuthoredEvent` | `type`, `finding_id`, `regression_test_path`, `validity: valid\|invalid`, `reason?` |
| `VulRunResultEvent` | `type`, `finding_id`, `phase: pre\|post`, `passed: boolean`, `output_snippet: string` |
| `RegressionDetectedEvent` | `type`, `original_finding_id`, `regressed_finding_id`, `detected_at` |
| `DismissalAppealedEvent` | `type`, `dismissal_id`, `actor`, `appeal_reason`, `ts` |

#### Scenario: VulRunResultEvent — pre-patch phase

- GIVEN the triad runs the regression test against the pre-patch commit
- WHEN the test result is recorded
- THEN a `VulRunResultEvent` with `phase=pre`, `passed=false` is emitted and persisted in `scan_events`

---

## Modified Capability: branch-remediation (delta)

### MODIFIED Requirements

#### Requirement: Triad Execution

The branch-remediation runner SHALL produce three signals: `unit_test_passed` (renamed from `tests_passed`), `vul_run_passed_pre`, and `vul_run_passed_post`. The PR creation step SHALL post the dual diff when Fix & Prove has run.
(Previously: runner produced one signal `tests_passed`; single-diff PR comment only.)

#### Scenario: Backward-compatible single-diff when triad is skipped

- GIVEN `OBT_FIX_AND_PROVE` is disabled or `patch_diff=null`
- WHEN branch-remediation completes
- THEN the PR comment uses the single-diff template and `unit_test_passed` maps from the legacy `tests_passed` value

---

## Open Questions Resolved at Spec Level

| # | Question | Resolution |
|---|----------|------------|
| Q3 | `status` enum widening shape | Three values: `verified-fixed`, `fix-unverified`, `regression`. Regression is a status, not just a severity band — the band is a rendering concern. |
| Q4 | Hotspot heatmap threshold tunability | Fixed at `count >= 3` for v0.4. Operator tuning deferred to v1.0 settings. |
| Q5 | Posture default time range | 30 days. |
| Q7 | Fix & Prove on no-patch findings | Triad does not run; `status=fix-unverified` with `reason=no-patch`. |

Open questions Q1, Q2, Q6, Q8 deferred to sdd-design.
