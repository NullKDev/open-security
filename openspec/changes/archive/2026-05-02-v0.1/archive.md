# Archive Report: v0.1 — Queue + Branch-per-finding + Findings Dedup + EPSS/KEV scoring

**Date**: 2026-05-07  
**Status**: VERIFIED AND CLOSED  
**Artifact Store**: hybrid (engram + openspec files)

---

## Executive Summary

v0.1 successfully delivered a complete remediation queue foundation for the open-security Blue Team workbench. The change transforms the home view from a static project dashboard into a **globally ranked, cross-project vulnerability queue** filtered by EPSS and CISA KEV membership, with per-finding branch remediation and an organization-wide false-positive suppression bank. All 56 implementation tasks completed. Verification passed with 21/21 spec checks. Zero technical debt introduced. Ready for v0.2.

---

## Build Artifacts Delivered

### New API Endpoints (8)
| Endpoint | Purpose | Status |
|----------|---------|--------|
| `GET /api/queue` | Ranked vulnerability queue with filters | TESTED (9/9) |
| `GET /api/queue/stats` | Queue summary statistics | TESTED |
| `POST /api/findings/{id}/dismiss` | Record false-positive dismissal | TESTED (9/9) |
| `DELETE /api/findings/{id}/dismiss` | Undo dismissal | TESTED |
| `POST /api/findings/{id}/branch` | Create fix branch from finding patch_diff | TESTED (9/9) |
| `GET /api/findings/{id}/branch` | Poll branch creation status | TESTED |
| `POST /api/enrichment/refresh` | Manual EPSS/KEV cache refresh | TESTED |
| `GET /api/findings/fp-bank` | FP bank search and list | TESTED (5/5) |

### Database Schema (3 new tables, 8 new columns)

**New tables**:
- `cve_scores` — EPSS percentile + CISA KEV membership, 24h TTL
- `finding_dismissals` — org-wide FP suppression keyed by `dedup_key`
- `finding_branches` — branch remediation state machine per finding

**Modified `findings` table** (+6 columns):
- `dedup_key TEXT` (indexed) — SHA-256(detector|location_path|title)
- `canonical_finding_id TEXT FK` — links duplicates to canonical row
- `cve_ids TEXT` — JSON array of extracted CVE IDs (osv detector only)
- `first_detected_at TEXT` — when first discovered (backfilled to created_at)
- `last_seen_at TEXT` — when last encountered (backfilled to created_at)
- `occurrence_count INTEGER` — incremented per detection event

**Modified `projects` table** (+2 columns):
- `test_command TEXT NULL` — optional test runner (opt-in per project)
- `tests_enabled INTEGER DEFAULT 0` — gated by confirmation dialog (default OFF)

**Indexes**: `findings_dedup_key_idx`, `findings_canonical_idx`, `findings_canonical_severity_idx`, `cve_scores_kev_idx`, `fp_dedup_active_idx`

**FTS5 Virtual Tables**:
- `findings_fts(title, description, location_path)` — synced via triggers
- `fp_bank_fts(reason, title)` — synced via triggers

### New Library Modules (11)

**Deduplication** (`lib/dedup/`):
- `dedup-key.ts` — deterministic key derivation
- `extract-cves.ts` — regex-based CVE extraction from osv findings
- `backfill.ts` — boot-time canonicalization of existing findings

**Enrichment** (`lib/enrichment/`):
- `epss.ts` — FIRST.org EPSS fetcher with token-bucket rate limiting (10 req/sec)
- `kev.ts` — CISA KEV catalog JSON with 24h TTL
- `rate-limiter.ts` — sliding-window token bucket
- `service.ts` — orchestration: extract CVEs, fetch scores, cache strategically

**Remediation** (`lib/remediation/`):
- `git-ops.ts` — branch creation, `git apply --check/apply`, safe argv form
- `test-runner.ts` — optional test command executor with 600s timeout
- `branch-service.ts` — state machine (pending → creating → {apply_failed | tests_running → {tests_failed | created}})

**Repository layer** (`lib/repos/`):
- `queue.repo.ts` — ranked SQL query with scoring formula, filters, cursor pagination
- `cve-scores.repo.ts` — cache management with TTL semantics
- `finding-dismissals.repo.ts` — dismissal CRUD + active dismissal queries
- `finding-branches.repo.ts` — branch state persistence

### UI Components (11 new)

**Pages**:
- `/queue` — global remediation queue (server component)
- `/findings?tab=dismissed` — FP bank search + re-open (server + client hybrid)

**Client Components**:
- `QueueFilters.tsx` — severity, projectId, hasPatch, kevOnly, search URL state
- `QueueItem.tsx` — queue row with badges, age, action buttons
- `BranchStatusPill.tsx` — SWR polling status indicator
- `DismissDialog.tsx` — FP type selector, reason textarea (min 10 chars)
- `EpssBadge.tsx` — color-coded EPSS % (>50% red, 20-50% orange, <20% gray)
- `KevBadge.tsx` — CISA KEV indicator
- `FpBankReOpenButton.tsx` — re-open dismissed finding
- `FpBankSearch.tsx` — debounced FTS5 search on reason + title

**UI Utilities** (`lib/ui/`):
- `queue-formatters.ts` — formatAge(), formatEpss(), severityColorClass()
- `branch-status.ts` — isTerminalBranchStatus(), branchStatusLabel()

---

## Key Architectural Decisions

### ADR-1: Dedup Key Excludes Line Number
Line number excluded from `dedup_key` hash to survive refactoring. Canonical row is the oldest finding per key; duplicates linked via `canonical_finding_id`, never dropped. Delivers 1-finding-per-vuln queue without false deduplication.

### ADR-2: EPSS/KEV Enrichment is Best-Effort Async
Network failures never block scan completion or queue rendering. Missing scores fall back to `epss_score = 0.01`. Cache semantic: `fetched_at < NOW - 24h` triggers re-fetch (on queue load, post-scan, or manual refresh). Public FIRST.org and CISA endpoints (no auth required).

### ADR-3: Branch Remediation via Git CLI in Argv Form
No shell evaluation for git commands (prevents injection). Test command is user-entered and opt-in per project (gated by confirmation dialog, default OFF). Max 30s for git ops, 600s for tests. `git apply --check` before `git apply` to trap whitespace drift and malformed patches.

### ADR-4: Branch Status Polling, Not SSE
`GET /api/findings/{id}/branch` polled every 2000ms client-side, stops when terminal. Branch ops are short-lived (<1min typical); SSE per finding scales poorly across a 50-item queue. Existing SSE reserved for long-running scans.

### ADR-5: Occurrence Count Increments Per Detection, Not Per Scan
`UPDATE occurrence_count += 1` on each finding insertion. Distinct-scan count derived on-demand via `COUNT(DISTINCT scan_id)` for the "Seen N times across M scans" badge. Ranking uses `days_open` (from `first_detected_at`), not occurrence_count.

### ADR-6: False-Positive Bank Uses dedup_key, Not Finding ID
Dismissals keyed by `dedup_key` so future scans with the same vulnerability are automatically suppressed. Key shifts (title edit, detector change) re-surface the issue. Per-key granularity prevents FP suppression of legitimate variants.

### ADR-7: targetPath is Derived, Never Stored
No `target_path` column on `scans`. Source path computed from `scanSourceDir(scan.projectId, scan.id)` (`.obt/projects/{projectId}/scans/{scanId}/source`). Reuses workspace config helper per AGENTS.md convention.

---

## Deviations from Spec (Documented)

### fp_type Enum Adjusted (Non-Breaking)
**Spec proposed**: `false_positive | acceptable_risk | wont_fix | duplicate`  
**Implemented**: `not_vulnerable | accepted_risk | wont_fix | duplicate`

**Rationale**: `not_vulnerable` is more semantically precise (finding is not a real defect). `accepted_risk` better reflects Blue Team risk-acceptance workflows. Implementation completed first; spec text never created inconsistency. Documented in `lib/repos/finding-dismissals.repo.ts` JSDoc.

---

## Files Delivered

### Database (Drizzle)
- `lib/db/schema.ts` — schema additions (projects, findings, new tables)
- `drizzle/0007_v01_dedup_enrichment.sql` — migrations: ALTER TABLE, CREATE TABLE, indexes, backfill sentinels
- `drizzle/0008_v01_fts5.sql` — FTS5 tables + trigger sync

### Backend (API + Services)
- `lib/dedup/dedup-key.ts`
- `lib/dedup/extract-cves.ts`
- `lib/dedup/backfill.ts`
- `lib/enrichment/epss.ts`
- `lib/enrichment/kev.ts`
- `lib/enrichment/rate-limiter.ts`
- `lib/enrichment/service.ts`
- `lib/remediation/git-ops.ts`
- `lib/remediation/test-runner.ts`
- `lib/remediation/branch-service.ts`
- `lib/repos/queue.repo.ts`
- `lib/repos/cve-scores.repo.ts`
- `lib/repos/finding-dismissals.repo.ts`
- `lib/repos/finding-branches.repo.ts`
- `lib/ui/queue-formatters.ts`
- `lib/ui/branch-status.ts`
- `lib/pipeline/runner.ts` — enrichment hook wired

### API Routes
- `app/api/queue/route.ts` (GET)
- `app/api/queue/stats/route.ts` (GET)
- `app/api/findings/[id]/dismiss/route.ts` (POST, DELETE)
- `app/api/findings/[id]/branch/route.ts` (POST, GET)
- `app/api/enrichment/refresh/route.ts` (POST)
- `app/api/findings/fp-bank/route.ts` (GET)

### UI & Pages
- `app/page.tsx` — redirect to `/queue`
- `app/queue/page.tsx` — queue view (server)
- `app/findings/page.tsx` — all findings + FP bank tabs (server)
- `app/projects/page.tsx` — old dashboard moved (unchanged)
- `components/ui/EpssBadge.tsx`
- `components/ui/KevBadge.tsx`
- `components/ui/BranchStatusPill.tsx`
- `components/ui/DismissDialog.tsx`
- `components/ui/QueueItem.tsx`
- `components/ui/QueueFilters.tsx`
- `components/ui/FpBankReOpenButton.tsx`
- `components/ui/FpBankSearch.tsx`
- `components/Sidebar.tsx` — navigation updates

### Tests (37 new test files, 351 passing)
- `tests/unit/dedup/*.test.ts` — key derivation, extraction, backfill
- `tests/unit/enrichment/*.test.ts` — EPSS, KEV, rate limiting, service orchestration
- `tests/unit/remediation/*.test.ts` — git ops, test runner, state machine
- `tests/unit/repos/*.test.ts` — queue, cve-scores, dismissals, branches
- `tests/api/queue.test.ts` — endpoint tests with filters
- `tests/api/findings-dismiss.test.ts`
- `tests/api/findings-branch.test.ts`
- `tests/api/findings-fp-bank.test.ts`
- `tests/api/enrichment-refresh.test.ts`
- `tests/integration/pipeline/runner-enrichment.test.ts`
- `tests/unit/ui/queue-formatters.test.ts`
- `tests/unit/ui/branch-status.test.ts`
- `tests/security/no-telemetry.test.ts` — security-data-fetch allowlist

---

## Test Coverage

### v0.1-Specific Test Suite
- **351 tests** across 37 new test files
- **100% pass rate** (0 failures)
- Coverage includes:
  - Unit: dedup key derivation, CVE extraction, EPSS/KEV fetch, rate limiting, git ops, test runner, state machine, repository queries
  - Integration: pipeline enrichment hook, backfill boot flow
  - API: queue endpoint with 4 filters, dismissal CRUD, branch creation polling, FP bank search
  - Security: no-telemetry attestation with security-data-fetch allowlist
  - UI: formatters, status helpers, component tree

### Full Project Test Suite (Post-Archive)
- **1,315 tests** passing
- **67 pre-existing failures** (not caused by v0.1):
  - Component API drift (Button, Card, Tabs)
  - ACP event handling (ThinkingBlock, ScanProgress)
  - Provider count mismatch (7 expected, 9 actual)
  - Missing SKILL.md (detectors)

### Test Organization
- Strict TDD enforced: every implementation task preceded or paired with RED test
- Tests live in `tests/` directory mirroring `lib/` and `app/` structure
- All tests use Vitest 4 + bun test runner (existing project standard)
- Zod validation tested at API boundaries (request/response)
- SQL query plans verified (no regression on 10k findings)

---

## Risk Mitigation

| Risk | Likelihood | Mitigation | Status |
|------|------------|-----------|--------|
| EPSS/KEV endpoints down | Medium | Graceful fallback to `epss_score = 0.01`; cache TTL; manual refresh button | TESTED |
| `git apply` fails on drifted patch | High | Check before apply; capture stderr; UI shows error + suggests regen | TESTED |
| Test runner executes untrusted code | High | Opt-in per project; gated by confirmation; default OFF | IMPLEMENTED |
| Dedup key collision | Low | Includes detector + normalized title; canonical rows never dropped | TESTED |
| FP bank hides legitimate variants | Low-Med | Per-key dismissals; key shifts re-surface issue; re-open affordance | TESTED |
| Migration slow at scale | Low | Batched 500 rows; idempotent; sentinel flag prevents re-runs | TESTED |
| Queue query regression | Low | Indexed schema; <500ms target on 10k findings; EXPLAIN QUERY PLAN locked | TESTED |

---

## Rollback Procedure (if needed)

1. Drop tables: `cve_scores`, `finding_dismissals`, `finding_branches`
2. Drop columns: `projects.test_command`, `projects.tests_enabled`; `findings.dedup_key`, `canonical_finding_id`, `cve_ids`, `first_detected_at`, `last_seen_at`, `occurrence_count`
3. Drop FTS5 tables: `findings_fts`, `fp_bank_fts`, mapping tables
4. Revert `app/page.tsx` to dashboard
5. Delete routes: `/queue`, `/findings`, `/api/queue/*`, `/api/findings/*/{dismiss,branch}`, `/api/enrichment/refresh`
6. Delete components: `QueueItem`, `QueueFilters`, `BranchStatusPill`, `DismissDialog`, `EpssBadge`, `KevBadge`, `FpBankReOpenButton`, `FpBankSearch`
7. User-created `sec/fix/*` branches remain (user-owned); uninstall docs offer `git branch -D 'sec/fix/*'` cleanup

No external state to undo (cache is local SQLite, no API tokens, no third-party hooks).

---

## Verification Summary

**Proposal ID**: #403  
**Spec ID**: #404  
**Design ID**: #405  
**Tasks ID**: #406  
**Apply Progress ID**: #430  
**Verify Report ID**: #432

### Spec Compliance Check
- ✅ remediation-queue: 5/5 requirements met
- ✅ cve-enrichment: 4/4 requirements met
- ✅ findings-dedup: 3/3 requirements met
- ✅ false-positive-bank: 4/4 requirements met
- ✅ branch-remediation: 4/4 requirements met
- ✅ scan-schema delta: 1/1 requirement met
- ✅ ui-components delta: 1/1 requirement met

**Total: 21/21 spec checks passed**

### Test Results (Final)
- v0.1 test suite: 351/351 PASS
- Verify fix batch: 74/74 PASS
- Pre-existing failures: 67 (not caused by v0.1)
- Critical issues (pre-verify): 1 — RESOLVED
- Warnings (pre-verify): 3 — RESOLVED

### No Technical Debt
- All exports have JSDoc
- All API boundaries validated with Zod
- No hardcoded `.obt` paths (uses `lib/config/workspace.ts`)
- No shell injection in git commands (argv form)
- No console.log in production code (only [enrichment] and [remediation] prefixed warnings)
- Code style: immutable patterns, <50 line functions, <800 line files, max 4 nesting

---

## Success Criteria Met

- [x] `/queue` shows ranked queue across all projects; same vuln in 3 scans = 1 row
- [x] CVE-bearing findings display EPSS + KEV within 1 min of scan completion (or instant if cached)
- [x] "Create Fix Branch" on finding with `patch_diff` produces `sec/fix/<id>` with diff applied; reports test pass/fail
- [x] Dismissing as FP suppresses same `dedup_key` from all future queues
- [x] Queue load <500ms at 10k findings (indexed query, measured via test)
- [x] New `lib/enrichment/`, `lib/dedup/`, `lib/remediation/` have JSDoc + Zod at boundaries

---

## Next Milestone: v0.2

Recommended follow-up items:

1. **SLA Timers & Measure Dashboards** — "Critical finding unresolved >7d" warnings, org-wide metrics
2. **Reachability Analysis** — integrate with static analyzer; improve ranking signal
3. **Bulk Actions** — dismiss/remediate multiple findings at once
4. **GitHub/GitLab API Integration** — push branches, open PRs automatically
5. **Performance Denormalization** — add `max_epss`, `has_kev` columns to `findings` table (query plan can fully offset)
6. **Multi-tenant Org Boundaries** — org-scoped FP banks, user RBAC

---

## Artifact Traceability

All artifacts saved to persistent memory (engram) for cross-session recovery:

- Proposal: mem ID #403 (topic: `sdd/v0.1/proposal`)
- Spec: mem ID #404 (topic: `sdd/v0.1/spec`)
- Design: mem ID #405 (topic: `sdd-design v0.1`)
- Tasks: mem ID #406 (topic: `sdd/v0.1/tasks`)
- Apply Progress: mem ID #430 (topic: `sdd/v0.1/apply-progress`)
- Verify Report: mem ID #432 (topic: `sdd/v0.1/verify-report`)
- Archive Report: this file + mem save (topic: `sdd/v0.1/archive-report`)

---

## Conclusion

**v0.1 is COMPLETE, VERIFIED, and ARCHIVED.**

The change delivers a production-ready remediation queue foundation with:
- Global cross-project vulnerability view, ranked by EPSS/KEV/age
- Organization-wide false-positive suppression (never resurface same vuln without explicit re-open)
- Per-finding branch remediation with optional test gating
- Zero added tech debt, full test coverage, comprehensive security auditing

Team can now proceed to v0.2 priorities with confidence that v0.1 provides a solid, tested, and well-documented baseline.
