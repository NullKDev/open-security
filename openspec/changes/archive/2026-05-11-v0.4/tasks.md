# Tasks: v0.4 — Fix & Prove + Posture Trends + MTTR + Regression Tracker + FP Bank

> Artifact store: hybrid | Spec: #422 | Design: openspec/changes/v0.4/design.md
> TDD mode: STRICT — every implementation task has a RED test task preceding it.

---

## Phase 1: Database Migration (Foundation)

- [x] T-001 — Write Drizzle schema additions `[lib/db/schema.ts]` `[size: M]`
  - Add `fixProofs`, `postureSnapshots`, `mttrBySeverity`, `findingRegressions`, `findingDismissalHistory`, `notificationsDispatched` tables and ALTERs per ADR-3/4/5/6; export `findingStatusSchema` Zod enum (ADR-8).
  - Depends on: none
  - Tests: `tests/unit/db/migration.test.ts` — extend: verify new tables present, UNIQUE indexes, append-only triggers fire on UPDATE/DELETE of `finding_dismissal_history`.

- [x] T-002 — Write migration SQL `[drizzle/0012_v04_prove_and_measure.sql]` `[size: S]`
  - Single additive file: `CREATE TABLE IF NOT EXISTS` for all new tables, `ALTER TABLE findings / finding_branches / finding_dismissals ADD COLUMN`, `CREATE INDEX IF NOT EXISTS`, `CREATE TRIGGER IF NOT EXISTS` for `fdh_no_update`/`fdh_no_delete`. Next number after `0006_fix_context.sql` checked: use `0007_v04_prove_and_measure.sql` (gap-fill any v0.1–v0.3 migrations first if 0007–0009 are reserved).
  - Depends on: T-001
  - Tests: `tests/unit/db/migration.test.ts` — run migrate on blank DB, assert all columns queryable, triggers abort on forbidden ops.

---

## Phase 2: Repo Layer (Core Data Access)

- [x] T-003 — RED: write failing tests for `fix-proofs.repo.ts` `[tests/unit/repos/fix-proofs.test.ts]` `[size: S]`
  - Tests: `createProof`, `getLatestProof(findingId)`, `markOutcome`, `sweepStaleInProgress(olderThanMs)`.
  - Depends on: T-002

- [x] T-004 — GREEN: implement `lib/repos/fix-proofs.repo.ts` `[size: S]`
  - `createProof`, `getLatestProof`, `markOutcome`, `sweepStaleInProgress` (updates rows stuck `in-progress` >1h to `fix-unverified / agent-error`). JSDoc on all exports.
  - Depends on: T-003

- [x] T-005 — RED: write failing tests for `posture.repo.ts` `[tests/unit/repos/posture.test.ts]` `[size: S]`
  - Tests: `upsertSnapshot`, `getTimeseries(projectId, rangeDays)`, `getHotspots(projectId, limit)`, `getRegressionRate(projectId)`.
  - Depends on: T-002

- [x] T-006 — GREEN: implement `lib/repos/posture.repo.ts` `[size: M]`
  - `upsertSnapshot` (INSERT OR REPLACE into `posture_snapshots`), `getTimeseries` (reads `posture_snapshots` filtered by date range), `getHotspots` (on-the-fly GROUP BY with HAVING COUNT >= 3, capped at 500), `getRegressionRate` (count from `finding_regressions` last 30d). JSDoc on all.
  - Depends on: T-005

- [x] T-007 — RED: write failing tests for `regressions.repo.ts` `[tests/unit/repos/regressions.test.ts]` `[size: S]`
  - Tests: `detectAndMark(scanId)` inserts `finding_regressions`, sets `is_regression=1`, idempotent on re-run.
  - Depends on: T-002

- [x] T-008 — GREEN: implement `lib/repos/regressions.repo.ts` `[size: S]`
  - `detectAndMark(scanId)` executes ADR-5 SQL; returns count of new regressions. JSDoc on all.
  - Depends on: T-007

- [x] T-009 — RED: write failing tests for `dismissals.repo.ts` extensions `[tests/unit/repos/dismissals.test.ts]` `[size: M]`
  - Tests: `dismiss` appends `created` history row; `appeal` sets `appealed_at + undone_at`, appends `appealed` row; `reDismiss` clears appeal fields, appends `re-dismissed`; FTS5 search; `exportSarif`; `getDraft` (agent prompt + cooldown meta).
  - Depends on: T-002

- [x] T-010 — GREEN: implement `lib/repos/dismissals.repo.ts` (new or extend existing) `[size: M]`
  - Full CRUD with audit history writes; `searchFts5(q, cursor, limit)`; `exportSarifSuppressions()`; `getDraft(findingId)` returns prompt context (no auto-submit). JSDoc on all.
  - Depends on: T-009

- [x] T-011 — Update `lib/repos/findings.repo.ts` `[size: S]`
  - Wire `proof_of_fix_id`, `is_regression`, `regression_of_finding_id` into query results; extend `updateFindingStatus` to validate against `findingStatusSchema`.
  - Depends on: T-001
  - Tests: extend `tests/unit/repos/findings.test.ts` — assert new columns returned; invalid status throws Zod error.

---

## Phase 3: Fix & Prove Service

- [x] T-012 — RED: tests for `worktree.ts` `[tests/unit/remediation/worktree.test.ts]` `[size: S]`
  - Tests: `createWorktree`, `removeWorktree`, `applyPatch`, `revertPatch`, `pruneStale` (calls `git worktree prune`).
  - Depends on: T-002

- [x] T-013 — GREEN: implement `lib/remediation/fix-and-prove/worktree.ts` `[size: M]`
  - `createWorktree(projectPath, commit, destPath)`, `removeWorktree(destPath)`, `applyPatch(worktreePath, diff)`, `revertPatch(worktreePath, diff)`, `pruneStale(projectPath)`. Path helpers via `lib/config/workspace.ts`. JSDoc on all.
  - Depends on: T-012

- [x] T-014 — RED: tests for `regression-author.ts` `[tests/unit/remediation/regression-author.test.ts]` `[size: S]`
  - Tests: prompt construction includes finding description + patch_diff; heuristic picks correct test dir (`tests/`, `__tests__/`, `test/`); fallback path uses `__regression__/`.
  - Depends on: T-004

- [x] T-015 — GREEN: implement `lib/remediation/fix-and-prove/regression-author.ts` `[size: S]`
  - `buildTurn3Prompt(finding, testDirs)` — constructs inline ACP prompt for Turn 3; `resolveTestPath(finding)` — test dir heuristic. JSDoc on all.
  - Depends on: T-014

- [x] T-016 — RED: tests for `outcomes.ts` `[tests/unit/remediation/outcomes.test.ts]` `[size: XS]`
  - Tests: all five outcome states per spec scenarios (verified-fixed, fix-unverified × 4 reasons).
  - Depends on: none

- [x] T-017 — GREEN: implement `lib/remediation/fix-and-prove/outcomes.ts` `[size: XS]`
  - Pure function `computeOutcome({ unitTestPassed, vulRunPassedPre, vulRunPassedPost, patchExists })` returns `{ outcome, failureReason }`. No side effects.
  - Depends on: T-016

- [x] T-018 — RED: tests for `pr-comment.ts` `[tests/unit/remediation/pr-comment.test.ts]` `[size: S]`
  - Tests: verified-fixed uses `✅` header; fix-unverified uses `⚠` header; dual-diff sections present when `regressionTestDiff` exists; `<details>` blocks present for pre/post output.
  - Depends on: T-017

- [x] T-019 — GREEN: implement `lib/remediation/fix-and-prove/pr-comment.ts` `[size: S]`
  - `composePrComment(proofRow)` returns markdown string per §5 template. JSDoc.
  - Depends on: T-018

- [x] T-020 — RED: tests for `triad-runner.ts` `[tests/unit/remediation/triad-runner.test.ts]` `[size: M]`
  - Tests: no-patch short-circuits with `fix-unverified / no-patch`; baseline-red short-circuits; second concurrent `POST /verify` returns 409; worktree removed on error path; `fix_proofs` row written with correct outcome.
  - Depends on: T-013, T-015, T-017, T-019

- [x] T-021 — GREEN: implement `lib/remediation/fix-and-prove/triad-runner.ts` `[size: L]`
  - Orchestrates four ACP turns per ADR-1/ADR-2 sequence; uses `worktree.ts`, `regression-author.ts`, `outcomes.ts`; writes `fix_proofs` row via `fix-proofs.repo.ts`; emits `RegressionTestAuthoredEvent`, `VulRunResultEvent` to `scan_events`; posts PR comment via v0.2 poster; `worktree.remove()` in finally block. JSDoc on all exports.
  - Depends on: T-020

---

## Phase 4: Posture & MTTR Service

- [x] T-022 — RED: tests for `lib/posture/refresh.ts` `[tests/unit/posture/refresh.test.ts]` `[size: S]`
  - Tests: `refreshPosture(projectId, scanId)` upserts correct weighted score; idempotent on double call for same day.
  - Depends on: T-006

- [x] T-023 — GREEN: implement `lib/posture/refresh.ts` `[size: S]`
  - `refreshPosture(projectId, scanId)` computes counts + weighted score; UPSERTs `posture_snapshots`; calls `refreshMttr`. JSDoc.
  - Depends on: T-022

- [x] T-024 — RED: tests for `lib/posture/mttr.ts` `[tests/unit/posture/mttr.test.ts]` `[size: S]`
  - Tests: correct median for even/odd N; `sample_size < 5` → `low_confidence=true`; open findings excluded; global rollup when no projectId.
  - Depends on: T-002

- [x] T-025 — GREEN: implement `lib/posture/mttr.ts` `[size: S]`
  - `refreshMttr(projectId)` runs ADR-7 window-function SQL for 30/60/90d and UPSERTs `mttr_by_severity`; `getMttr(projectId, severity?)` reads from table. JSDoc.
  - Depends on: T-024

- [x] T-026 — RED: tests for `lib/notifications/desktop.ts` `[tests/unit/notifications/desktop.test.ts]` `[size: XS]`
  - Tests: fires exactly one notification per scan; idempotent on retry (second call no-ops via `notifications_dispatched`).
  - Depends on: T-002

- [x] T-027 — GREEN: implement `lib/notifications/desktop.ts` `[size: XS]`
  - `notifyRegressionsBatch(scanId, count)` writes `notifications_dispatched` row (INSERT OR IGNORE), fires system notification only if first call. JSDoc.
  - Depends on: T-026

---

## Phase 5: Pipeline Wiring

- [x] T-028 — Implement `lib/dedup/post-hooks/regression-detect.ts` `[size: S]`
  - Wraps ADR-5 SQL; exports `detectAndMarkRegressions(scanId, db)`. Write test first: `tests/unit/pipeline/strategies/regression-detect.test.ts`.
  - Depends on: T-008, T-027

- [x] T-029 — Wire regression detection + posture refresh into `lib/pipeline/runner.ts` `[size: S]`
  - After dedup stage settles, call `detectAndMarkRegressions(scanId)`, then `refreshPosture(projectId, scanId)`, then `notifyRegressionsBatch(scanId, count)`. No new test file; extend `tests/integration/pipeline/runner.test.ts`.
  - Depends on: T-028, T-023

---

## Phase 6: API Routes

- [x] T-030 — RED: tests for Fix & Prove routes `[tests/api/fix-and-prove.test.ts]` `[size: S]`
  - Tests: `POST /api/findings/[id]/verify` → 202 with `proofId`; duplicate call → 409; `GET /api/findings/[id]/proof` returns latest row.
  - Depends on: T-021

- [x] T-031 — GREEN: implement `app/api/findings/[id]/verify/route.ts` + `app/api/findings/[id]/proof/route.ts` `[size: S]`
  - POST validates `findingId` with Zod; triggers `triadRunner` via `setImmediate`; returns 202. GET returns latest `fix_proofs` row. Envelope via `lib/api/envelope.ts`. JSDoc.
  - Depends on: T-030

- [x] T-032 — RED: tests for posture routes `[tests/api/posture.test.ts]` `[size: S]`
  - Tests: `GET /api/posture` returns timeseries + regressionRate + openCriticalDays; range param filters; `GET /api/posture/mttr` returns three windows with `lowConfidence`; `GET /api/posture/hotspots` capped at 500.
  - Depends on: T-006, T-025

- [x] T-033 — GREEN: implement `app/api/posture/route.ts`, `app/api/posture/mttr/route.ts`, `app/api/posture/hotspots/route.ts` `[size: M]`
  - All Zod-validated query params; envelope responses; JSDoc.
  - Depends on: T-032

- [x] T-034 — RED: tests for FP Bank routes `[tests/api/fp-bank.test.ts]` `[size: M]`
  - Tests: `GET /api/findings/fp-bank` paginates + FTS5 filters; `DELETE /api/findings/[id]/dismiss` (appeal) sets `appealed_at`; `POST /api/dismissals/[id]/draft` returns draft with `draftedAt`; submit after cooldown → 400; `GET /api/findings/fp-bank/export` returns SARIF.
  - Depends on: T-010

- [x] T-035 — GREEN: implement FP Bank API routes `[app/api/findings/fp-bank/route.ts, app/api/findings/[id]/dismiss/route.ts, app/api/dismissals/[id]/appeal/route.ts, app/api/dismissals/[id]/draft/route.ts, app/api/findings/fp-bank/export/route.ts]` `[size: M]`
  - Zod-validate all inputs; enforce 5s cooldown server-side; audit row writes go through `dismissals.repo.ts`. JSDoc on route handlers.
  - Depends on: T-034

---

## Phase 7: UI Components

- [x] T-036 — Implement `components/posture/WeightedTimeseriesChart.tsx` `[size: M]`
  - Hand-rolled SVG line chart; props: `data: {date,weightedScore}[]`, `rangeLabel`; no chart lib. Unit test: `tests/unit/components/posture/WeightedTimeseriesChart.test.tsx` — renders SVG path, tooltip shows correct score.
  - Depends on: T-033

- [x] T-037 — Implement `components/posture/HotspotHeatmap.tsx` `[size: S]`
  - Grid cells colored by `distinctDedupKeys`; `repeat_offender=true` cells get distinct accent. Test: renders correct cell count, `repeat_offender` class present.
  - Depends on: T-033

- [x] T-038 — Implement `components/posture/MttrCards.tsx` + `components/posture/RegressionRateBadge.tsx` `[size: S]`
  - Three MTTR cards (30/60/90d); `low_confidence` badge when `sampleSize < 5`. Test: low_confidence annotation renders when flag is true.
  - Depends on: T-033

- [x] T-039 — Implement `app/posture/page.tsx` (PosturePage RSC) `[size: S]`
  - Fetches from posture repos; composes `WeightedTimeseriesChart`, `HotspotHeatmap`, `MttrCards`, `RegressionRateBadge`; repo filter via searchParams. Test: page renders without error with mock data.
  - Depends on: T-036, T-037, T-038

- [x] T-040 — Implement `components/findings/ProofOfFixBadge.tsx` `[size: S]`
  - Shows triad result (pre ✗ / post ✓); collapsible pre/post output. Test: renders `verified-fixed` vs `fix-unverified` variants; output toggle expands details.
  - Depends on: T-031

- [x] T-041 — Implement `components/findings/RegressionBadge.tsx` `[size: XS]`
  - Orange "REGRESSION" pill; no runtime deps. Test: renders with correct aria-label.
  - Depends on: none

- [x] T-042 — Implement `app/findings/[id]/verify/page.tsx` (ProvePage) `[size: S]`
  - Displays triad steps; polls `GET /api/findings/[id]/proof` via SWR; shows live `scan_events` SSE for in-progress state. Test: polling hook fires on mount; completed state shows `ProofOfFixBadge`.
  - Depends on: T-040, T-031

- [x] T-043 — Implement `app/findings/fp-bank/page.tsx` (FpBankPage) `[size: S]`
  - Searchable table with FTS5 `?q=` param; appeal button triggers DELETE dismiss; export SARIF button. Test: renders table rows; appeal button calls correct route.
  - Depends on: T-035

- [x] T-044 — Implement `components/findings/DualDiffViewer.tsx` `[size: S]`
  - Side-by-side or stacked diffs for fix diff + regression test diff. Test: renders both diff sections when both props present; gracefully omits second section when `regressionTestDiff` is null.
  - Depends on: none

---

## Phase 8: Navigation + Queue Integration

- [x] T-045 — Add `/posture` to main nav + show `RegressionBadge` in queue `[size: XS]`
  - Update nav component (locate via `Glob app/layout.tsx` or existing nav component); render `RegressionBadge` in queue item when `is_regression=1`. Test: extend queue item test — badge present when `is_regression` flag set.
  - Depends on: T-039, T-041

- [x] T-046 — Add `/findings/fp-bank` link on findings page + regression lineage route `[app/findings/[id]/regression/page.tsx]` `[size: XS]`
  - Lineage page shows: original PR URL, merging commit SHA, regressing commit SHA. Test: renders lineage data from `finding_regressions` join.
  - Depends on: T-043, T-008

---

## Phase 9: Boot-time Safety + Integrity

- [x] T-047 — Implement `lib/remediation/fix-and-prove/proof-cleanup.ts` `[size: XS]`
  - `pruneStaleProofs(projects)`: for each project calls `git worktree prune`; calls `fix-proofs.repo.sweepStaleInProgress(3600_000)`. Called at app startup. Test: `tests/unit/remediation/proof-cleanup.test.ts` — stale row gets marked `fix-unverified / agent-error`; worktree prune called once per project.
  - Depends on: T-004, T-013

- [x] T-048 — Implement `lib/db/integrity.ts` (boot-time enum guard) `[size: XS]`
  - Query `SELECT DISTINCT status FROM findings` and abort if value not in `findingStatusSchema`. Test: `tests/unit/db/integrity.test.ts` — clean DB passes; row with garbage status throws.
  - Depends on: T-011

- [x] T-049 — Wire `pruneStaleProofs` + `checkIntegrity` into app startup `[lib/db/migrate.ts or app startup hook]` `[size: XS]`
  - Call both functions after migrate completes. No separate test file; extend `tests/unit/db/migration.test.ts`.
  - Depends on: T-047, T-048

---

## Execution Notes

**Parallelizable groups (no cross-dependency):**
- T-003/T-005/T-007/T-009 (repo RED tests) can run in parallel after T-002.
- T-016 (outcomes RED) runs independently from phase start.
- T-026 (notifications RED) runs after T-002 only.
- T-041/T-044 (stateless UI components) run any time.

**Critical path (sequential bottleneck):**
`T-001 → T-002 → T-004 → T-021 (triad-runner) → T-031 → T-042`

**Regression bonus field (REQ-RT-03):** the `regression_bonus` tuning parameter is a config value (`project.regression_bonus`, default 2.0) that the queue scoring formula reads. Add to project config schema during T-011 or as a follow-on if time is short.

**SARIF import (U2 from design):** T-035 reserves the `POST /api/findings/fp-bank/import` route with `501 Not Implemented` if full implementation slips.

---

## Archive Status

**Archived**: 2026-05-11 per sdd-archive phase

**Artifacts**:
- Proposal: #421
- Spec: #422
- Design: openspec/changes/v0.4/design.md
- Tasks: #424 (this file)
- Apply-progress: #495
- Verify-report: #496
- Archive-report: sdd/v0.4/archive-report (topic_key in engram)

**Change Moved To**: `openspec/changes/archive/2026-05-11-v0.4/`

All 49 tasks complete. Verification: PASS WITH WARNINGS (0 CRITICAL, 3 WARNINGS — all non-blocking). Ready for next milestone (v1.0).
