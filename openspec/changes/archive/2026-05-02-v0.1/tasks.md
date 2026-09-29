# Tasks: v0.1 — Queue + Branch-per-finding + Findings Dedup + EPSS/KEV scoring

## Summary

56 tasks across 7 groups. Estimated total: 8–10 days solo.
Groups A→B→C/D (parallel) →E→F→G are the critical path.
Strict TDD: every implementation task is preceded or paired with a RED test task.

---

## Group A — Database migrations
_Prerequisite for everything. No app code runs until schema is stable._

- [ ] T-A01 — Write Drizzle schema additions `[lib/db/schema.ts]` `[size: M]`
  - Add to `projects`: `testCommand`, `testsEnabled`. Add to `findings`: `dedupKey`, `canonicalFindingId`, `cveIds`, `firstDetectedAt`, `lastSeenAt`, `occurrenceCount`. Add new tables `cveScores`, `findingDismissals`, `findingBranches` with all indexes per design §2.1.
  - Depends on: none
  - Tests: `tests/unit/db/schema-v01.test.ts` — assert new columns present via `db.prepare("PRAGMA table_info(...)").all()`; assert FK constraints compile without error.

- [ ] T-A02 — Write migration 0007 SQL `[drizzle/0007_v01_dedup_enrichment.sql]` `[size: M]`
  - ALTER TABLE projects ADD COLUMN testCommand/testsEnabled. ALTER TABLE findings ADD COLUMN dedupKey/canonicalFindingId/cveIds/firstDetectedAt/lastSeenAt/occurrenceCount. CREATE TABLE cve_scores/finding_dismissals/finding_branches. CREATE INDEX (all 5 per design). Backfill sentinels: `dedup_key='__pending_backfill__'`, `first_detected_at = created_at`, `last_seen_at = created_at`. Register in `drizzle/meta/_journal.json`.
  - Depends on: T-A01
  - Tests: `tests/unit/db/migration-0007.test.ts` — run migration on `:memory:` db, assert all new tables/columns/indexes exist via PRAGMA.

- [ ] T-A03 — Write migration 0008 FTS5 SQL `[drizzle/0008_v01_fts5.sql]` `[size: M]`
  - CREATE VIRTUAL TABLE findings_fts/fp_bank_fts. CREATE sidecar map tables findings_fts_map/fp_bank_fts_map (INTEGER rowid → TEXT id). Write ai/au/ad triggers for both (6 triggers total). Backfill INSERT INTO findings_fts_map + findings_fts SELECT from existing findings. Register in `_journal.json`.
  - Depends on: T-A02
  - Tests: `tests/unit/db/migration-0008-fts5.test.ts` — run on `:memory:`, insert a finding, assert FTS5 MATCH returns it; delete finding, assert removed from fts; update title, assert fts reflects new title.

---

## Group B — Repo layer
_Depends on Group A. B tasks can run in parallel once A03 is done._

- [ ] T-B01 — Test: dedup upsert in findings repo `[tests/unit/repos/findings-dedup.test.ts]` `[size: S]`
  - Write RED tests: first insert → canonical_finding_id IS NULL, occurrence_count=1; second insert same dedup_key → links to first, first.occurrence_count=2, first.last_seen_at updated; dedup_key computed from detector+location_path+title normalize+sha256.
  - Depends on: T-A02
  - Tests: this IS the test task.

- [ ] T-B02 — Implement dedup upsert in findings repo `[lib/repos/findings.repo.ts]` `[size: M]`
  - Wrap `insertFinding` in a transaction: SELECT canonical by dedup_key; if found INSERT with canonical_finding_id + UPDATE occurrence_count/last_seen_at on canon; else INSERT canonical. Compute dedup_key via `lib/dedup/dedup-key.ts`. Add JSDoc on `insertFinding`.
  - Depends on: T-B01, T-A02
  - Tests: T-B01 must go GREEN.

- [ ] T-B03 — Create `lib/dedup/dedup-key.ts` `[lib/dedup/dedup-key.ts]` `[size: XS]`
  - Export `computeDedupKey(detector, locationPath, title): string` — normalize (lowercase+trim+collapse whitespace), concatenate with `|`, SHA-256 hex via Node `crypto.createHash`.
  - Depends on: none (pure util)
  - Tests: `tests/unit/dedup/dedup-key.test.ts` — same inputs → same key; whitespace variants → same key; different location → different key.

- [ ] T-B04 — Test: cve-scores repo `[tests/unit/repos/cve-scores.test.ts]` `[size: S]`
  - RED tests: upsertCveScore inserts row; getScoresForCves returns cached if fetched_at < 24h; returns null/stale if older; isKevListed true/false.
  - Depends on: T-A02
  - Tests: this IS the test task.

- [ ] T-B05 — Create `lib/repos/cve-scores.repo.ts` `[lib/repos/cve-scores.repo.ts]` `[size: S]`
  - Export: `upsertCveScore`, `getScoresForCves(ids)` (returns Map<cveId, row|null>), `markStale(cveId)`, `getKevListedIds()`. JSDoc on all.
  - Depends on: T-B04, T-A02
  - Tests: T-B04 must go GREEN.

- [ ] T-B06 — Test: finding-dismissals repo `[tests/unit/repos/finding-dismissals.test.ts]` `[size: S]`
  - RED tests: createDismissal inserts row with undone_at=null; isDismissed(dedupKey) returns true when active dismissal exists; undoDismissal sets undone_at; 409 logic for duplicate active dismissal.
  - Depends on: T-A02
  - Tests: this IS the test task.

- [ ] T-B07 — Create `lib/repos/finding-dismissals.repo.ts` `[lib/repos/finding-dismissals.repo.ts]` `[size: S]`
  - Export: `createDismissal`, `isDismissed(dedupKey)`, `undoDismissal(findingId)`, `listActiveDismissals(cursor?, limit?)`, `searchDismissals(query)` (FTS5 via fp_bank_fts). JSDoc on all.
  - Depends on: T-B06, T-A03
  - Tests: T-B06 must go GREEN.

- [ ] T-B08 — Test: queue repo `[tests/unit/repos/queue.test.ts]` `[size: M]`
  - RED tests: getQueue returns only canonical (canon_finding_id IS NULL) findings; dismissed findings excluded; severity filter applies; KEV finding ranks above non-KEV equal score; null EPSS treated as 0.01; cursor pagination returns next page; stats returns correct counts by severity.
  - Depends on: T-A02, T-A03
  - Tests: this IS the test task.

- [ ] T-B09 — Create `lib/repos/queue.repo.ts` `[lib/repos/queue.repo.ts]` `[size: L]`
  - Export: `getQueue(params: QueueQueryInput)` with full rank SQL (design §6), cursor-based pagination (reuse base64-JSON pattern from findings.repo), FP exclusion subquery, severity/project/hasPatch/status filters. Export `getQueueStats()`. JSDoc on both.
  - Depends on: T-B08, T-B05, T-B07
  - Tests: T-B08 must go GREEN.

- [ ] T-B10 — Test: finding-branches repo `[tests/unit/repos/finding-branches.test.ts]` `[size: S]`
  - RED tests: createBranchRecord inserts with status=pending; updateBranchStatus transitions; getBranchByFindingId returns current row; UNIQUE constraint prevents second active branch.
  - Depends on: T-A02
  - Tests: this IS the test task.

- [ ] T-B11 — Create `lib/repos/finding-branches.repo.ts` `[lib/repos/finding-branches.repo.ts]` `[size: S]`
  - Export: `createBranchRecord(findingId)`, `updateBranchStatus(id, status, fields?)`, `getBranchByFindingId(findingId)`, `markStaleCreating(olderThanMs)`. JSDoc on all.
  - Depends on: T-B10, T-A02
  - Tests: T-B10 must go GREEN.

---

## Group C — Enrichment services
_Depends on B05. C tasks are parallel with each other and with Group D._

- [ ] T-C01 — Test: CVE extraction util `[tests/unit/dedup/extract-cves.test.ts]` `[size: XS]`
  - RED: extractCves on osv finding with CVE in title → returns ['CVE-2023-44487']; semgrep finding → returns []; multiple CVEs in description → all extracted; no CVE → empty array.
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-C02 — Create `lib/dedup/extract-cves.ts` `[lib/dedup/extract-cves.ts]` `[size: XS]`
  - Export `extractCves(finding: {detector, title, description}): string[]`. Applies `/CVE-\d{4}-\d{4,}/g` only when `detector === 'osv'`. JSDoc.
  - Depends on: T-C01
  - Tests: T-C01 GREEN.

- [ ] T-C03 — Test: EPSS rate limiter `[tests/unit/enrichment/rate-limiter.test.ts]` `[size: S]`
  - RED: TokenBucket allows ≤10 calls/second; 11th call in same tick must wait; bucket refills after 1s.
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-C04 — Create `lib/enrichment/rate-limiter.ts` `[lib/enrichment/rate-limiter.ts]` `[size: XS]`
  - Export `RateLimiter` class: token-bucket, 10 req/sec. Export `waitForToken(): Promise<void>`. JSDoc.
  - Depends on: T-C03
  - Tests: T-C03 GREEN.

- [ ] T-C05 — Test: EPSS service `[tests/unit/enrichment/epss.test.ts]` `[size: S]`
  - RED (mock fetch): fresh cache returned without HTTP call; stale triggers HTTP; batch of 25 CVEs → ≤1 HTTP call (30-per-batch); network error → logs warn, does not throw; Zod validates response shape.
  - Depends on: T-B04, T-C04
  - Tests: this IS the test task.

- [ ] T-C06 — Create `lib/enrichment/epss.ts` `[lib/enrichment/epss.ts]` `[size: M]`
  - Export `fetchEpssScores(cveIds: string[], db): Promise<void>`. Batches 30, rate-limits, AbortController 5s timeout, Zod-validates, upserts via cve-scores repo. Warns on error, never throws. JSDoc.
  - Depends on: T-C05, T-B05
  - Tests: T-C05 GREEN.

- [ ] T-C07 — Test: KEV service `[tests/unit/enrichment/kev.test.ts]` `[size: S]`
  - RED (mock fetch): downloads JSON, parses vulnerabilities[].cveID into Set; updates existing cve_scores rows; does NOT create rows for unknown CVEs; network error → uses file cache `.obt/cache/kev.json`; no cache exists → cisaKev stays 0.
  - Depends on: T-B05
  - Tests: this IS the test task.

- [ ] T-C08 — Create `lib/enrichment/kev.ts` `[lib/enrichment/kev.ts]` `[size: M]`
  - Export `refreshKev(db): Promise<void>`. Downloads CISA KEV JSON, updates `cve_scores.cisa_kev` for known CVEs only, writes file cache to `.obt/cache/kev.json` via `workspace.ts` path helper. Warns on error. JSDoc.
  - Depends on: T-C07, T-B05
  - Tests: T-C07 GREEN.

- [ ] T-C09 — Test: enrichment service orchestrator `[tests/unit/enrichment/service.test.ts]` `[size: S]`
  - RED: `enrichScan(db, scanId)` extracts CVE IDs from osv findings, calls EPSS for missing/stale, calls KEV refresh if stale; graceful on fetch failure; marks in-flight set to prevent duplicate fetches.
  - Depends on: T-C02, T-C06, T-C08
  - Tests: this IS the test task.

- [ ] T-C10 — Create `lib/enrichment/service.ts` `[lib/enrichment/service.ts]` `[size: S]`
  - Export `enrichScan(db, scanId): Promise<void>`. Orchestrates: extract CVEs from scan's osv findings → update `findings.cve_ids` → call `fetchEpssScores` for misses/stale → call `refreshKev`. In-memory Set prevents concurrent dup fetches. Never throws. JSDoc.
  - Depends on: T-C09
  - Tests: T-C09 GREEN.

---

## Group D — Branch remediation service
_Depends on B11. Parallel with Group C._

- [ ] T-D01 — Test: git-ops `[tests/unit/remediation/git-ops.test.ts]` `[size: M]`
  - RED (mock child_process.spawn): checkoutBranch success; checkoutBranch non-zero exit → throws with stderr; applyPatch --check pass; applyPatch --check fail → throws; applyPatch success; timeout 30s → rejects. No shell injection (argv form).
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-D02 — Create `lib/remediation/git-ops.ts` `[lib/remediation/git-ops.ts]` `[size: M]`
  - Export `checkoutBranch(cwd, branchRef, commitHash)`, `applyPatchCheck(cwd, patchPath)`, `applyPatch(cwd, patchPath)`. All use `child_process.spawn` in argv form (no shell), 30s AbortController timeout. Write tmpfile to OS temp. JSDoc.
  - Depends on: T-D01
  - Tests: T-D01 GREEN.

- [ ] T-D03 — Test: test-runner `[tests/unit/remediation/test-runner.test.ts]` `[size: S]`
  - RED (mock spawn): runs testCommand with shell=true; captures last 2000 chars of stdout+stderr; exit 0 → testsPassed=1; non-zero → testsPassed=0; 600s timeout; skipped when testsEnabled=0.
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-D04 — Create `lib/remediation/test-runner.ts` `[lib/remediation/test-runner.ts]` `[size: S]`
  - Export `runTests(cwd, testCommand): Promise<{passed: boolean, output: string}>`. Shell=true (user-provided cmd), 600s timeout, capture last 2000 chars. JSDoc with security note on shell=true.
  - Depends on: T-D03
  - Tests: T-D03 GREEN.

- [ ] T-D05 — Test: branch service state machine `[tests/unit/remediation/branch-service.test.ts]` `[size: M]`
  - RED: createFixBranch pending→creating→created flow; apply_failed on applyPatchCheck non-zero; tests_running→tests_failed on test non-zero; tests skipped when testsEnabled=0; recovery marks stale creating rows as apply_failed; UNIQUE constraint → returns existing row.
  - Depends on: T-B11, T-D02, T-D04
  - Tests: this IS the test task.

- [ ] T-D06 — Create `lib/remediation/branch-service.ts` `[lib/remediation/branch-service.ts]` `[size: M]`
  - Export `createFixBranch(db, findingId, opts?)`. Full state machine per design §5. Uses `scanSourceDir` from workspace.ts for targetPath. setImmediate not here — caller's responsibility. JSDoc. Export `recoverStaleBranches(db)` for boot-time sweep.
  - Depends on: T-D05
  - Tests: T-D05 GREEN.

---

## Group E — Pipeline integration
_Depends on C10 and B02. Sequential with A-B-C/D._

- [ ] T-E01 — Test: enrichment hook in runner `[tests/integration/pipeline/runner-enrichment.test.ts]` `[size: S]`
  - RED: after stage5 completes and findings are persisted, `enrichScan` is called (mock); scan reaches `done` even if enrichScan rejects; `cve_ids` populated on osv findings before enrichment call.
  - Depends on: T-C10, T-B02
  - Tests: this IS the test task.

- [ ] T-E02 — Wire enrichment into `lib/pipeline/runner.ts` `[lib/pipeline/runner.ts]` `[size: S]`
  - After stage5 findings persistence, add `await enrichScan(db, scanId).catch(warn)` before `updateScanStatus(...,'done')`. Import `enrichScan` from `lib/enrichment/service.ts`. Add `[enrichment]`-prefixed warn logger call.
  - Depends on: T-E01
  - Tests: T-E01 GREEN.

- [ ] T-E03 — Test: dedup backfill boot script `[tests/unit/dedup/backfill.test.ts]` `[size: S]`
  - RED: rows with `dedup_key='__pending_backfill__'` are processed in batches of 500; each gets correct dedup_key; canonical is oldest per key; duplicates get canonical_finding_id; sentinel `dedup_backfill_done=1` written after completion; re-run is no-op.
  - Depends on: T-B02, T-B03
  - Tests: this IS the test task.

- [ ] T-E04 — Create `lib/dedup/backfill.ts` `[lib/dedup/backfill.ts]` `[size: S]`
  - Export `runDedupBackfill(db): Promise<void>`. Checks config table for sentinel. Processes batches of 500. Writes sentinel on completion. JSDoc.
  - Depends on: T-E03
  - Tests: T-E03 GREEN.

- [ ] T-E05 — Wire backfill into app boot `[lib/db/migrate.ts]` `[size: XS]`
  - After migrations run, call `runDedupBackfill(db)` (best-effort, logs warn on error). Backfill only runs when sentinel is absent.
  - Depends on: T-E04
  - Tests: extend `tests/unit/db/migration.test.ts` — assert backfill sentinel is set after migration + boot sequence.

---

## Group F — API routes
_Depends on B09, B07, B11, D06. F tasks are parallel with each other._

- [ ] T-F01 — Test: `GET /api/queue` `[tests/api/queue.test.ts]` `[size: M]`
  - RED: returns paginated QueueRowDTO array; severity filter applies; dismissed findings absent; KEV/EPSS in response; cursor returns next page; 400 on invalid params.
  - Depends on: T-B09
  - Tests: this IS the test task.

- [ ] T-F02 — Implement `GET /api/queue` `[app/api/queue/route.ts]` `[size: M]`
  - QueueQuerySchema (Zod): cursor, limit≤100, severity csv, projectId csv, hasPatch bool, status. Call `getQueue`. Return `ok(paginated(...))`. Add `GET /api/queue/stats` in same file or adjacent `stats/route.ts`.
  - Depends on: T-F01, T-B09
  - Tests: T-F01 GREEN.

- [ ] T-F03 — Test: `POST /api/findings/[id]/dismiss` + `DELETE /api/findings/[id]/dismiss` `[tests/api/findings-dismiss.test.ts]` `[size: S]`
  - RED: valid body → 201 + dismissal row created; reason < 10 chars → 400; duplicate active dismissal → 409; DELETE sets undone_at → 200.
  - Depends on: T-B07
  - Tests: this IS the test task.

- [ ] T-F04 — Implement dismiss routes `[app/api/findings/[id]/dismiss/route.ts]` `[size: S]`
  - POST: Zod body `{fpType: enum, reason: string.min(10)}`; call `createDismissal`; handle 409. DELETE: call `undoDismissal`; return `{id, undoneAt}`. Use `ok/created/fail` from `lib/api/envelope.ts`.
  - Depends on: T-F03, T-B07
  - Tests: T-F03 GREEN.

- [ ] T-F05 — Test: `POST /api/findings/[id]/branch` + `GET /api/findings/[id]/branch` `[tests/api/findings-branch.test.ts]` `[size: S]`
  - RED: POST with patchDiff null → 400; duplicate non-terminal → 409; valid → 202 + {status:'pending'}; GET returns current BranchDTO; branch work fires async (mock setImmediate).
  - Depends on: T-B11, T-D06
  - Tests: this IS the test task.

- [ ] T-F06 — Implement branch routes `[app/api/findings/[id]/branch/route.ts]` `[size: S]`
  - POST: validate patchDiff non-null, check for existing non-terminal row (409), call `createBranchRecord`, fire `createFixBranch` via `setImmediate`, return 202. GET: `getBranchByFindingId`, return BranchDTO. JSDoc on both handlers.
  - Depends on: T-F05
  - Tests: T-F05 GREEN.

- [ ] T-F07 — Test: `POST /api/enrichment/refresh` `[tests/api/enrichment-refresh.test.ts]` `[size: XS]`
  - RED: calls `enrichScan` or global refresh; force=true bypasses TTL; returns 202 immediately.
  - Depends on: T-C10
  - Tests: this IS the test task.

- [ ] T-F08 — Implement `POST /api/enrichment/refresh` `[app/api/enrichment/refresh/route.ts]` `[size: XS]`
  - Zod body `{force?: boolean}`. Fire-and-forget `refreshKev + fetchEpssScores(staleIds)` via setImmediate. Return 202. JSDoc.
  - Depends on: T-F07, T-C08, T-C06
  - Tests: T-F07 GREEN.

---

## Group G — UI components and pages
_Depends on F01, F04, F06. G tasks are mostly parallel._

- [ ] T-G01 — Test: `EpssBadge` component `[tests/unit/components/ui/EpssBadge.test.tsx]` `[size: XS]`
  - RED: epssScore=0.72 → red class + "72%"; 0.35 → orange; 0.10 → gray; 0 (null) → gray "—".
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-G02 — Create `components/ui/EpssBadge.tsx` `[components/ui/EpssBadge.tsx]` `[size: XS]`
  - Props: `epssScore: number | null`. Renders `Badge` with color class and percentage string. Color tiers: >0.5 red, 0.2–0.5 orange, <0.2 gray. JSDoc.
  - Depends on: T-G01
  - Tests: T-G01 GREEN.

- [ ] T-G03 — Test: `KevBadge` component `[tests/unit/components/ui/KevBadge.test.tsx]` `[size: XS]`
  - RED: cisaKev=1 → badge visible; cisaKev=0 → nothing rendered.
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-G04 — Create `components/ui/KevBadge.tsx` `[components/ui/KevBadge.tsx]` `[size: XS]`
  - Props: `cisaKev: 0 | 1`. Returns null when 0. Returns `Badge` "KEV" when 1. JSDoc.
  - Depends on: T-G03
  - Tests: T-G03 GREEN.

- [ ] T-G05 — Test: `BranchPanel` component `[tests/unit/components/queue/BranchPanel.test.tsx]` `[size: S]`
  - RED: patchDiff=null → no "Create Fix Branch" button; status=apply_failed → red pill; status=created+testsPassed=1 → green pill; polling active when status=creating; polling stops on terminal status.
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-G06 — Create `components/queue/BranchPanel.tsx` `[components/queue/BranchPanel.tsx]` `[size: S]`
  - Client component. Props: `findingId`, `patchDiff: string | null`, `initialStatus`. Uses `useSWR(/api/findings/${id}/branch, {refreshInterval: isActive ? 2000 : 0})`. Renders `StatusPill` + "Create Fix Branch" button (POST /api/findings/[id]/branch). JSDoc.
  - Depends on: T-G05, T-F06
  - Tests: T-G05 GREEN.

- [ ] T-G07 — Test: `DismissDialog` component `[tests/unit/components/findings/DismissDialog.test.tsx]` `[size: S]`
  - RED: reason < 10 chars → submit disabled; valid form → POST /api/findings/[id]/dismiss called; scope selector renders fp_type options; dialog closes on success.
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-G08 — Create `components/findings/DismissDialog.tsx` `[components/findings/DismissDialog.tsx]` `[size: S]`
  - Client component. Uses `dialog`, `select`, `textarea` from ui lib. Validates reason ≥ 10 chars client-side. Calls `fetch('POST /api/findings/[id]/dismiss')`. JSDoc.
  - Depends on: T-G07, T-F04
  - Tests: T-G07 GREEN.

- [ ] T-G09 — Test: `QueueRow` component `[tests/unit/components/queue/QueueRow.test.tsx]` `[size: S]`
  - RED: renders title, project name, severity badge, EpssBadge, KevBadge, days open; action buttons visible; "Investigate" links to /scans/[scanId]/findings/[fid]; no hardcoded .obt strings.
  - Depends on: T-G02, T-G04
  - Tests: this IS the test task.

- [ ] T-G10 — Create `components/queue/QueueRow.tsx` `[components/queue/QueueRow.tsx]` `[size: S]`
  - Server component. Props: `QueueRowDTO`. Renders `Card` with all required fields per spec. Embeds `BranchPanel` (lazy client island). JSDoc.
  - Depends on: T-G09, T-G06, T-G08
  - Tests: T-G09 GREEN.

- [ ] T-G11 — Test: `QueueFilters` component `[tests/unit/components/queue/QueueFilters.test.tsx]` `[size: S]`
  - RED: severity checkboxes update URL params without reload; KEV-only toggle updates URL; search input debounced; filters reflected in URL query string.
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-G12 — Create `components/queue/QueueFilters.tsx` `[components/queue/QueueFilters.tsx]` `[size: S]`
  - Client component. Uses `useSearchParams` + `router.replace`. Severity multi-select, KEV toggle, hasPatch toggle, search input (300ms debounce). JSDoc.
  - Depends on: T-G11
  - Tests: T-G11 GREEN.

- [ ] T-G13 — Test: `QueueEmptyState` and queue stats header `[tests/unit/components/queue/QueueEmptyState.test.tsx]` `[size: XS]`
  - RED: empty state has CTA link to /scans/new; stats header shows total + per-severity counts.
  - Depends on: none
  - Tests: this IS the test task.

- [ ] T-G14 — Create `components/queue/QueueEmptyState.tsx` + `QueueStatsHeader.tsx` `[components/queue/]` `[size: XS]`
  - `QueueEmptyState`: renders empty message + `<Link href="/scans/new">`. `QueueStatsHeader`: renders counts from `QueueStatsDTO`. JSDoc on both.
  - Depends on: T-G13
  - Tests: T-G13 GREEN.

- [ ] T-G15 — Test: queue page `[tests/unit/pages/queue.test.tsx]` `[size: S]`
  - RED: renders QueueRow list from API data; QueueFilters present; empty state shown when no findings; occurrence badge "Seen N times" visible when occurrenceCount > 1.
  - Depends on: T-G10, T-G12, T-G14
  - Tests: this IS the test task.

- [ ] T-G16 — Create `app/queue/page.tsx` `[app/queue/page.tsx]` `[size: S]`
  - Server component. Fetches `GET /api/queue` with searchParams. Renders `QueueStatsHeader + QueueFilters + QueueRow×N | QueueEmptyState`. JSDoc.
  - Depends on: T-G15, T-F01, T-F02
  - Tests: T-G15 GREEN.

- [ ] T-G17 — Replace home page with QueueView + nav update `[app/page.tsx, components/Sidebar.tsx]` `[size: S]`
  - `app/page.tsx` → redirect to `/queue` (or inline queue). Move old dashboard to `app/projects/page.tsx` if not already present. Add `/queue` nav item to `components/Sidebar.tsx`. Remove old dashboard nav link or rename to "Projects". JSDoc on new page.
  - Depends on: T-G16
  - Tests: extend `tests/unit/pages/dashboard.test.tsx` — assert `/` redirects to `/queue` or renders QueueView.

- [ ] T-G18 — Test: occurrence badge on finding detail `[tests/unit/pages/finding-detail.test.tsx]` `[size: XS]`
  - RED: occurrenceCount=3 → badge "Seen 3 times" visible; occurrenceCount=1 → badge absent.
  - Depends on: none
  - Tests: this IS the test task (extend existing file).

- [ ] T-G19 — Add occurrence badge to finding detail page `[app/scans/[id]/findings/[fid]/page.tsx]` `[size: XS]`
  - Conditionally render badge when `finding.occurrenceCount > 1`. Text: "Seen {N} times across {M} scans". M derived from API or passed as prop.
  - Depends on: T-G18
  - Tests: T-G18 GREEN.

- [ ] T-G20 — Test: FP bank page `[tests/unit/pages/fp-bank.test.tsx]` `[size: S]`
  - RED: /findings?tab=dismissed renders dismissal rows; FTS search input calls API with q param; re-open action calls DELETE /api/findings/[id]/dismiss; empty state when no dismissals.
  - Depends on: T-B07, T-F04
  - Tests: this IS the test task.

- [ ] T-G21 — Create FP bank tab in findings page `[app/findings/page.tsx or app/scans/[id]/findings route update, components/fp-bank/FpBankRow.tsx]` `[size: M]`
  - Add `?tab=dismissed` to existing findings route (or new `app/findings/page.tsx`). `FpBankRow` renders: fp_type chip, reason, finding title, re-open button, dismissed_at. FTS search input hits `GET /api/findings?tab=dismissed&q=...`. JSDoc.
  - Depends on: T-G20, T-F04
  - Tests: T-G20 GREEN.

---

## Parallel execution map

```
A01 → A02 → A03
                ↓
         B01-B11 (parallel among themselves after A03)
                ↓
    ┌─── C01-C10 (parallel)          ┌─── D01-D06 (parallel)
    └─────────────────────────────────┘
                ↓
         E01-E05 (sequential)
                ↓
    ┌─── F01-F08 (parallel)
    └─────────────────────────────────
                ↓
         G01-G21 (mostly parallel, G17 last)
```

Groups C and D can begin as soon as B05 (C) and B11 (D) are done respectively.
Groups F can begin per-route as each B dependency is satisfied.
Groups G can begin per-component as each F dependency is satisfied.
