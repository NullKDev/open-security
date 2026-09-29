# Tasks: v0.3 — CVE Hunter + Investigation Console + Playbooks + Secret Timeline

> Artifact store: hybrid. Generated: 2026-05-06.
> STRICT TDD MODE: every GREEN task is preceded by a RED task (write failing test first).

---

## Phase 1: Database Migrations

- [ ] T-001 — Migration 0007: new tables `hunt_targets`, `scan_forks`, `playbooks`, `finding_timelines` `[drizzle/0007_v0.3_new_tables.sql]` `[size: S]`
  - Create 4 tables per §5 of design. All additive; idempotent (CREATE TABLE IF NOT EXISTS).
  - Depends on: none
  - Tests: `tests/unit/db/migration.test.ts` — assert all 4 tables exist after applying migration

- [ ] T-002 — Migration 0008: ALTER existing tables for v0.3 columns `[drizzle/0008_v0.3_alter_tables.sql]` `[size: XS]`
  - `findings` ADD `verdict TEXT`, `timeline_computed_at TEXT`. `scan_events` ADD `is_replay INTEGER DEFAULT 0`, `injection_source TEXT`.
  - Depends on: T-001
  - Tests: `tests/unit/db/migration.test.ts` — assert new columns present on findings and scan_events

- [ ] T-003 — Drizzle schema types for all v0.3 tables/columns `[lib/db/schema.ts]` `[size: S]`
  - Add Drizzle table definitions for `hunt_targets`, `scan_forks`, `playbooks`, `finding_timelines`. Add new columns to `findings` and `scan_events` inferred types.
  - Depends on: T-002
  - Tests: none (compile-time only — covered by downstream repo tests)

---

## Phase 2: Core Infrastructure — Types, Clients, Utilities

- [ ] T-004 — RED: tests for `OsvClient.fetch()` `[tests/unit/advisories/osv-client.test.ts]` `[size: S]`
  - Write failing tests: successful parse → `AdvisoryMeta`, 404 → null + warning, network error → null + warning, caching skips HTTP.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-005 — GREEN: `lib/advisories/osv-client.ts` — fetch + Zod-parse OSV advisory `[lib/advisories/osv-client.ts]` `[size: S]`
  - `GET https://api.osv.dev/v1/vulns/{id}`, 10s timeout, 1 retry. Returns `AdvisoryMeta | null`. Missing fields default to `[]`.
  - Depends on: T-003, T-004
  - Tests: `tests/unit/advisories/osv-client.test.ts`

- [ ] T-006 — RED: tests for `classifyAdvisory()` `[tests/unit/advisories/cve-class.test.ts]` `[size: XS]`
  - Write failing tests: each CWE class maps correctly, unknown CWE → `'generic'`.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-007 — GREEN: `lib/advisories/cve-class.ts` — static CWE→CveClass map + `classifyAdvisory()` `[lib/advisories/cve-class.ts]` `[size: XS]`
  - 7 classes: injection, path-traversal, deserialization, ssrf, auth-bypass, rce, xss. Fallback: `'generic'`.
  - Depends on: T-006
  - Tests: `tests/unit/advisories/cve-class.test.ts`

- [ ] T-008 — RED: tests for `buildHuntPrompt()` `[tests/unit/hunt/hunt-context.test.ts]` `[size: S]`
  - Write failing tests: injection class → injection questions present; generic class → generic template used; missing pocUrl → no PoC line.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-009 — GREEN: `lib/hunt/hunt-context.ts` — `HuntContext` type + `buildHuntPrompt()` `[lib/hunt/hunt-context.ts, lib/hunt/prompt-templates/]` `[size: M]`
  - `buildHuntPrompt(ctx: HuntContext): string`. Uses `{{var}}` interpolation (from T-018). 8 `.md` templates (7 classes + generic).
  - Depends on: T-007, T-008, T-018
  - Tests: `tests/unit/hunt/hunt-context.test.ts`

- [ ] T-010 — RED: tests for `PendingTurnQueue` `[tests/unit/providers/transport/pending-turn-queue.test.ts]` `[size: S]`
  - Write failing tests: enqueue/dequeue FIFO, `next()` blocks until push, `drain()` clears, `isEmpty()` accurate.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-011 — GREEN: `lib/providers/transport/pending-turn-queue.ts` — per-scan FIFO queue `[lib/providers/transport/pending-turn-queue.ts]` `[size: S]`
  - Module-level singleton. API: `forScan(scanId)`, `closeScan(scanId)`. Per-scan: `enqueue`, `next`, `isEmpty`, `drain`. Thread-safe via async lock.
  - Depends on: T-010
  - Tests: `tests/unit/providers/transport/pending-turn-queue.test.ts`

- [ ] T-012 — RED: tests for `ManifestLoader` `[tests/unit/playbooks/manifest-loader.test.ts]` `[size: S]`
  - Write failing tests: valid YAML → `Playbook`, missing `promptTemplate` → ZodError, YAML alias → rejected (no alias expansion), discovery order workspace > user > builtin.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-013 — GREEN: `lib/playbooks/manifest-loader.ts` — safe YAML parser + Zod-validated schema `[lib/playbooks/manifest-loader.ts, lib/playbooks/schema.ts]` `[size: M]`
  - `yaml@^2` dep. `js-yaml` `safeLoad` (no alias). `PlaybookManifestSchema` per design §3. `discoverPlaybooks(workspaceRoot)` walks 3 dirs.
  - Depends on: T-012
  - Tests: `tests/unit/playbooks/manifest-loader.test.ts`

- [ ] T-014 — RED: tests for `git-log-parser.ts` `[tests/unit/timeline/git-log-parser.test.ts]` `[size: S]`
  - Write failing tests: parses commit metadata (hash, author, email, date, branches), detects introduce/remove hunks, 60s timeout → partial result.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-015 — GREEN: `lib/timeline/git-log-parser.ts` — run `git log -p -S` and parse output `[lib/timeline/git-log-parser.ts]` `[size: M]`
  - `git log -p -S '<secretHash>' --all --no-merges --format=... -- <file>` with 60s `AbortSignal`. Returns `{commits[], partial}`.
  - Depends on: T-014
  - Tests: `tests/unit/timeline/git-log-parser.test.ts`

- [ ] T-016 — RED: tests for builtin playbooks `[tests/unit/playbooks/builtins.test.ts]` `[size: XS]`
  - Write failing tests: all 5 builtins pass `PlaybookManifestSchema.parse()`, each has non-empty `promptTemplate`.
  - Depends on: T-012
  - Tests: this IS the test task

- [ ] T-017 — GREEN: `lib/playbooks/builtins/` — 5 first-party `.obt-skill` YAML files `[lib/playbooks/builtins/]` `[size: M]`
  - audit-auth-surface, find-ssrf, pre-release-sweep, deserialization-sweep, oauth-flow-review. All with `source: builtin`, `builtIn: true`.
  - Depends on: T-013, T-016
  - Tests: `tests/unit/playbooks/builtins.test.ts`

- [ ] T-018 — RED: tests for `interpolate()` `[tests/unit/templates/interpolate.test.ts]` `[size: XS]`
  - Write failing tests: `{{var}}` replaced, unknown vars left as-is, no nesting/conditionals, reserved vars substituted.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-019 — GREEN: `lib/templates/interpolate.ts` — `{{var}}` string substitution engine `[lib/templates/interpolate.ts]` `[size: XS]`
  - Simple `str.replace(/\{\{(\w+)\}\}/g, ...)`. No eval. Shared by Hunter + Playbooks.
  - Depends on: T-018
  - Tests: `tests/unit/templates/interpolate.test.ts`

- [ ] T-020 — Workspace path helpers for playbook dirs `[lib/config/workspace.ts]` `[size: XS]`
  - Add `userPlaybooksDir()`, `workspacePlaybooksDir(root)`, `builtinPlaybooksDir()`. No hardcoded `.obt` paths outside this file.
  - Depends on: none
  - Tests: existing `tests/config/store.test.ts` extended, or new `tests/unit/config/workspace.test.ts`

---

## Phase 3: Repository Layer

- [ ] T-021 — RED: tests for `hunt-targets.repo.ts` `[tests/unit/repos/hunt-targets.test.ts]` `[size: S]`
  - Write failing tests: upsert creates row, upsert updates advisory_raw + verdict, findByScanId returns row.
  - Depends on: T-003
  - Tests: this IS the test task

- [ ] T-022 — GREEN: `lib/repos/hunt-targets.repo.ts` `[lib/repos/hunt-targets.repo.ts]` `[size: S]`
  - `upsert(scanId, data)`, `findByScanId(scanId)`. JSDoc on all exports.
  - Depends on: T-021
  - Tests: `tests/unit/repos/hunt-targets.test.ts`

- [ ] T-023 — RED: tests for `finding-timelines.repo.ts` `[tests/unit/repos/finding-timelines.test.ts]` `[size: S]`
  - Write failing tests: insert timeline, findByFindingId, invalidate (sets `computed_at = null` on findings).
  - Depends on: T-003
  - Tests: this IS the test task

- [ ] T-024 — GREEN: `lib/repos/finding-timelines.repo.ts` `[lib/repos/finding-timelines.repo.ts]` `[size: S]`
  - `upsert(findingId, data)`, `findByFindingId(id)`, `invalidate(findingId)`. JSDoc on all exports.
  - Depends on: T-023
  - Tests: `tests/unit/repos/finding-timelines.test.ts`

- [ ] T-025 — RED: tests for `playbooks.repo.ts` `[tests/unit/repos/playbooks.test.ts]` `[size: S]`
  - Write failing tests: list returns builtins + user rows, create inserts, delete removes, duplicate id → error.
  - Depends on: T-003
  - Tests: this IS the test task

- [ ] T-026 — GREEN: `lib/repos/playbooks.repo.ts` `[lib/repos/playbooks.repo.ts]` `[size: S]`
  - `listPlaybooks()`, `upsertPlaybook(data)`, `deletePlaybook(id)`. JSDoc on all exports.
  - Depends on: T-025
  - Tests: `tests/unit/repos/playbooks.test.ts`

- [ ] T-027 — RED: tests for `scan-forks.repo.ts` `[tests/unit/repos/scan-forks.test.ts]` `[size: S]`
  - Write failing tests: create fork record, findByParentScanId, child_scan_id must be set.
  - Depends on: T-003
  - Tests: this IS the test task

- [ ] T-028 — GREEN: `lib/repos/scan-forks.repo.ts` `[lib/repos/scan-forks.repo.ts]` `[size: S]`
  - `createFork(data)`, `findByParentScanId(parentId)`. JSDoc on all exports.
  - Depends on: T-027
  - Tests: `tests/unit/repos/scan-forks.test.ts`

---

## Phase 4: New Event Types + Schema Extensions

- [ ] T-029 — RED: tests for new scan event types `[tests/unit/pipeline/events.test.ts]` `[size: S]`
  - Write failing tests: `user_injection`, `plan_edit`, `tool_call_rejected`, `fork_point` all pass `scanEventSchema.parse()` with valid input; invalid fields → ZodError.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-030 — GREEN: add 4 new event schemas to `lib/pipeline/events.ts` `[lib/pipeline/events.ts]` `[size: S]`
  - Add Zod schemas and TypeScript types for `user_injection`, `plan_edit`, `tool_call_rejected`, `fork_point`. Add to `scanEventSchema` discriminated union.
  - Depends on: T-029
  - Tests: `tests/unit/pipeline/events.test.ts`

- [ ] T-031 — RED: tests for `ScanModeId` widening `[tests/unit/pipeline/strategies/normalizeScanMode.test.ts]` `[size: XS]`
  - Write failing tests: `'hunt'` accepted as valid, `'playbook:find-ssrf@1.0.0'` accepted, `'playbook:bad'` (missing version) → normalized or error.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-032 — GREEN: widen `ScanModeId` type + update `normalizeScanMode()` `[lib/pipeline/strategies/types.ts, lib/pipeline/strategies/index.ts]` `[size: XS]`
  - `type ScanModeId = ... | 'hunt' | \`playbook:${string}@${string}\``. `normalizeScanMode` passes hunt/playbook patterns through.
  - Depends on: T-031
  - Tests: `tests/unit/pipeline/strategies/normalizeScanMode.test.ts`

---

## Phase 5: Pipeline Strategy Extensions

- [ ] T-033 — RED: tests for `HuntStrategy` `[tests/unit/pipeline/strategies/hunt.test.ts]` `[size: M]`
  - Write failing tests: pre-stage0 fetches OSV and caches, stage1 calls osv-scanner scoped to CVE, stage2 uses CveClass prompt, verdict stored, 404 → fallback.
  - Depends on: T-005, T-007, T-009, T-022
  - Tests: this IS the test task

- [ ] T-034 — GREEN: `lib/pipeline/strategies/hunt.ts` — `HuntStrategy` class `[lib/pipeline/strategies/hunt.ts]` `[size: M]`
  - Implements `ScanStrategy`. pre-stage0 → `OsvClient.fetch()` + cache. stage1 → scoped osv-scanner per package. stage2 → `buildHuntPrompt()`. stage3 → store verdict on `hunt_targets`.
  - Depends on: T-033
  - Tests: `tests/unit/pipeline/strategies/hunt.test.ts`

- [ ] T-035 — RED: tests for `PlaybookStrategy` `[tests/unit/pipeline/strategies/playbook.test.ts]` `[size: S]`
  - Write failing tests: correct playbook loaded by name@version, prompt interpolated, unknown playbook → error event, parameter defaults applied.
  - Depends on: T-013, T-017, T-019
  - Tests: this IS the test task

- [ ] T-036 — GREEN: `lib/pipeline/strategies/playbook.ts` — `PlaybookStrategy` class `[lib/pipeline/strategies/playbook.ts]` `[size: S]`
  - Wraps `OrchestratedStrategy` with overridden prompt (interpolated from manifest). Scoped scanners from `manifest.scannerScope`.
  - Depends on: T-035
  - Tests: `tests/unit/pipeline/strategies/playbook.test.ts`

- [ ] T-037 — RED: tests for updated `selectStrategy()` `[tests/unit/pipeline/strategies/normalizeScanMode.test.ts]` `[size: XS]`
  - Write failing tests: `'hunt'` → `HuntStrategy`, `'playbook:x@1.0'` → `PlaybookStrategy`, existing modes unchanged. selectStrategy is now async.
  - Depends on: T-032, T-034, T-036
  - Tests: this IS the test task

- [ ] T-038 — GREEN: update `selectStrategy()` to async + add hunt/playbook cases `[lib/pipeline/strategies/index.ts]` `[size: S]`
  - `async function selectStrategy(mode, ctx): Promise<ScanStrategy>`. Add `'hunt'` case + `/^playbook:/` pattern. All callers updated to `await`.
  - Depends on: T-037
  - Tests: `tests/unit/pipeline/strategies/normalizeScanMode.test.ts`

---

## Phase 6: Session Manager + Permission Bridge Extensions

- [ ] T-039 — RED: tests for `SessionManager` multi-turn loop `[tests/unit/providers/transport/session-manager.test.ts]` `[size: M]`
  - Write failing tests: initial turn sent, injected turn sent after end_turn, queue drain on abort, injection persisted before ACP call.
  - Depends on: T-011
  - Tests: this IS the test task

- [ ] T-040 — GREEN: integrate `PendingTurnQueue` into `SessionManager.run()` `[lib/providers/transport/session-manager.ts]` `[size: M]`
  - Phase 9 becomes multi-turn loop per design §2. `queue.enqueue({ kind: 'initial', ... })` before loop. `queue.drain()` on abort/SIGTERM.
  - Depends on: T-039
  - Tests: `tests/unit/providers/transport/session-manager.test.ts`

- [ ] T-041 — RED: tests for `PermissionBridge.resolveRequest()` with redirect `[tests/unit/providers/transport/permission-bridge.test.ts]` `[size: S]`
  - Write failing tests: `redirectInstruction` present + `approved: false` → deny AND enqueue redirect turn, no redirect → deny only.
  - Depends on: T-011
  - Tests: this IS the test task

- [ ] T-042 — GREEN: extend `PermissionBridge.resolveRequest()` for redirect `[lib/providers/transport/permission-bridge.ts]` `[size: S]`
  - Accept optional `redirectInstruction?: string`. After deny call, `queue.enqueue(redirectInstruction)` for that scanId.
  - Depends on: T-041
  - Tests: `tests/unit/providers/transport/permission-bridge.test.ts`

---

## Phase 7: Secret Timeline Service

- [ ] T-043 — RED: tests for `TimelineBuilder` `[tests/unit/timeline/timeline-builder.test.ts]` `[size: S]`
  - Write failing tests: orchestrates git-log-parser → stores in repo, computes suspectedDeploys, partial flag propagated.
  - Depends on: T-015, T-024
  - Tests: this IS the test task

- [ ] T-044 — GREEN: `lib/timeline/timeline-builder.ts` — orchestrate derivation + persist `[lib/timeline/timeline-builder.ts]` `[size: S]`
  - `buildTimeline(findingId, repoPath)`. Calls `gitLogParser`, SHA-256 hashes secret, counts main/master merges in window, writes to `findingTimelinesRepo`.
  - Depends on: T-043
  - Tests: `tests/unit/timeline/timeline-builder.test.ts`

---

## Phase 8: API Routes

- [ ] T-045 — RED: tests for `POST /api/scans/hunt` `[tests/api/scans.test.ts]` `[size: S]`
  - Write failing tests: valid `{cveId, targetPath}` → 202 + scanId, invalid CVE format → 400 ZodError, feature flag off → 404.
  - Depends on: T-032, T-034
  - Tests: this IS the test task

- [ ] T-046 — GREEN: `app/api/scans/hunt/route.ts` — POST handler `[app/api/scans/hunt/route.ts]` `[size: S]`
  - Zod-validate `HuntTargetSchema`, create scan row with `strategy: 'hunt'`, trigger `HuntStrategy`, return `{scanId}` 202.
  - Depends on: T-045
  - Tests: `tests/api/scans.test.ts`

- [ ] T-047 — RED: tests for investigation console endpoints `[tests/unit/app/api/scans/inject.test.ts]` `[size: M]`
  - Write failing tests for all 4 endpoints: inject-prompt, edit-plan, reject-tool, fork. scan not running → 409. scan_events inserted before queue.
  - Depends on: T-011, T-028, T-030
  - Tests: this IS the test task

- [ ] T-048 — GREEN: investigation console route handlers `[app/api/scans/[id]/inject-prompt/route.ts, edit-plan/route.ts, reject-tool/route.ts, fork/route.ts]` `[size: M]`
  - All: validate → INSERT scan_events → queue.enqueue → 202. `fork`: also copies events + creates scan_forks row. All gated on `scans.status === 'running'`.
  - Depends on: T-047
  - Tests: `tests/unit/app/api/scans/inject.test.ts`

- [ ] T-049 — RED: tests for `POST /api/scans/[id]/permission` redirect extension `[tests/unit/app/api/scans/permission.test.ts]` `[size: XS]`
  - Write failing test: `{requestId, approved: false, redirectInstruction: '...'}` → bridge redirect enqueued.
  - Depends on: T-042
  - Tests: this IS the test task

- [ ] T-050 — GREEN: extend `app/api/scans/[id]/permission/route.ts` for `redirectInstruction` `[app/api/scans/[id]/permission/route.ts]` `[size: XS]`
  - Add `redirectInstruction?: string` to Zod schema. Pass to `bridge.resolveRequest()`.
  - Depends on: T-049
  - Tests: `tests/unit/app/api/scans/permission.test.ts`

- [ ] T-051 — RED: tests for playbook API routes `[tests/api/playbooks.test.ts]` `[size: S]`
  - Write failing tests: GET list → builtins + user, POST create → 201, DELETE → 204, POST missing required field → 400.
  - Depends on: T-026
  - Tests: this IS the test task

- [ ] T-052 — GREEN: playbook API routes `[app/api/playbooks/route.ts, app/api/playbooks/[id]/route.ts]` `[size: S]`
  - GET: `listPlaybooks()`. POST: Zod-validate + `upsertPlaybook()`. DELETE: `deletePlaybook()`. All gated on `OBT_CONSOLE_V2`.
  - Depends on: T-051
  - Tests: `tests/api/playbooks.test.ts`

- [ ] T-053 — RED: tests for timeline API routes `[tests/api/findings-timeline.test.ts]` `[size: S]`
  - Write failing tests: POST triggers build → 202, GET returns `TimelineResponse`, finding not found → 404.
  - Depends on: T-024, T-044
  - Tests: this IS the test task

- [ ] T-054 — GREEN: timeline API routes `[app/api/findings/[id]/timeline/route.ts]` `[size: S]`
  - POST: trigger `buildTimeline()` async → 202. GET: `findByFindingId()` → `TimelineResponse` with rotationDraft pre-filled.
  - Depends on: T-053
  - Tests: `tests/api/findings-timeline.test.ts`

---

## Phase 9: UI Components

> All components gated by `NEXT_PUBLIC_OBT_CONSOLE_V2='1'`. No hardcoded `.obt` paths. JSDoc on all exported components.

- [ ] T-055 — `components/ui/console/InvestigationConsole.tsx` `[size: M]`
  - Chat input at bottom of ScanProgress. Sends to `POST /api/scans/[id]/inject-prompt`. Disabled when `status !== 'running'`.
  - Depends on: T-048
  - Tests: `tests/unit/components/console/InvestigationConsole.test.tsx` (render + disabled state)

- [ ] T-056 — `components/ui/console/PlanEditor.tsx` `[size: S]`
  - Holds last `PlanEvent` locally. Editable step list. "Send plan update" → `POST /api/scans/[id]/edit-plan`.
  - Depends on: T-048
  - Tests: `tests/unit/components/console/PlanEditor.test.tsx` (step edit + send)

- [ ] T-057 — `components/ui/console/ToolCallPrompt.tsx` `[size: S]`
  - Extend existing permission-request UI with reject + redirectInstruction textarea. Sends to `POST .../reject-tool`.
  - Depends on: T-048, T-050
  - Tests: `tests/unit/components/console/ToolCallPrompt.test.tsx`

- [ ] T-058 — `components/ui/console/ForkButton.tsx` + `TimelineScrubber.tsx` `[size: S]`
  - ForkButton: select event from transcript → `POST .../fork`. TimelineScrubber: virtualized horizontal event list for picking fork point.
  - Depends on: T-048
  - Tests: `tests/unit/components/console/ForkButton.test.tsx`

- [ ] T-059 — `components/ui/hunt/VerdictBadge.tsx` `[size: XS]`
  - Badge rendering `exposed` (red), `not-exposed` (green), `indeterminate` (yellow). Accepts `verdict: HuntVerdict`.
  - Depends on: none
  - Tests: `tests/unit/components/hunt/VerdictBadge.test.tsx`

- [ ] T-060 — `app/hunt/page.tsx` — Hunt page (CVE ID form + live transcript) `[app/hunt/page.tsx]` `[size: M]`
  - CVE/GHSA input with Zod client validation. SSE transcript viewer (reuse ScanProgress pattern). `VerdictBadge` on done. "Open as finding" button (disabled when `not-exposed`).
  - Depends on: T-046, T-059
  - Tests: `tests/unit/app/hunt/page.test.tsx`

- [ ] T-061 — `components/ui/playbook/PlaybookSelector.tsx` + `PlaybookParamForm.tsx` `[size: M]`
  - Grid of available playbooks. Select → render param form from manifest schema. Required params enforce submit. Sends `strategy: 'playbook:name@version'` at scan launch.
  - Depends on: T-052
  - Tests: `tests/unit/components/playbook/PlaybookSelector.test.tsx`

- [ ] T-062 — `components/ui/playbook/PlaybookTrustDialog.tsx` `[size: S]`
  - First-run trust prompt for non-builtin playbooks. Persists trust to DB via `upsertPlaybook`. Modal variant.
  - Depends on: T-052
  - Tests: `tests/unit/components/playbook/PlaybookTrustDialog.test.tsx`

- [ ] T-063 — `components/ui/timeline/SecretTimelineView.tsx` (RSC) + `TimelineSidebar.tsx` `[size: M]`
  - RSC fetches timeline data. Timeline dots: introducing commit, exposure window, removing commit (if any). `suspectedDeploys` counter. Rotation action buttons (GitHub issue / Slack draft) as client islands.
  - Depends on: T-054
  - Tests: `tests/unit/components/timeline/SecretTimelineView.test.tsx`

- [ ] T-064 — Finding detail page update: wire timeline + hunt verdict `[app/findings/[id]/page.tsx]` `[size: S]`
  - Show `SecretTimelineView` for secret-type findings. Show `VerdictBadge` when `findings.verdict` present.
  - Depends on: T-059, T-063
  - Tests: `tests/unit/app/findings/page.test.tsx` (verdict badge visible, timeline section rendered)

---

## Phase 10: Navigation + Feature Flag Wiring

- [ ] T-065 — Add `/hunt` to main nav `[components/ui/nav/]` `[size: XS]`
  - Add "Hunt" link gated by `NEXT_PUBLIC_OBT_CONSOLE_V2`. No changes to unrelated nav items.
  - Depends on: T-060
  - Tests: `tests/unit/components/nav/nav.test.tsx` (link visible when flag on, hidden when off)

- [ ] T-066 — Add `PlaybookSelector` to scan launch UI `[app/scans/new/page.tsx or equivalent]` `[size: S]`
  - Integrate `PlaybookSelector` in scan creation flow. When playbook selected, override strategy field.
  - Depends on: T-061
  - Tests: `tests/unit/app/scans/new.test.tsx`

- [ ] T-067 — Egress allowlist integration test `[tests/security/egress-allowlist.test.ts]` `[size: S]`
  - Assert only `api.osv.dev`, `api.github.com`, and configured provider hosts receive outbound requests. Use MSW to intercept.
  - Depends on: T-005, T-046
  - Tests: this IS the test task (no GREEN counterpart — pure security regression test)

---

## Parallel execution map

```
P1: T-001 → T-002 → T-003  (migrations must be sequential)

P2 (all independent, run in parallel after T-003):
  T-004/T-005, T-006/T-007, T-008–T-009 (after T-018/T-019), T-010/T-011,
  T-012/T-013, T-014/T-015, T-016/T-017, T-018/T-019, T-020

P3 (repos, after T-003 + relevant infra):
  T-021–T-022, T-023–T-024, T-025–T-026, T-027–T-028 (all parallel)

P4 (events): T-029 → T-030 → T-031 → T-032 (sequential)

P5 (strategies, after repos + events + infra):
  T-033–T-034, T-035–T-036 (parallel pairs), then T-037 → T-038

P6 (session): T-039–T-040, T-041–T-042 (parallel pairs, after T-011)

P7 (timeline): T-043 → T-044 (after T-015 + T-024)

P8 (API routes, after repos + strategies + queue):
  T-045–T-046, T-047–T-048, T-049–T-050, T-051–T-052, T-053–T-054 (parallel pairs)

P9 (UI, after API): T-055–T-064 (mostly parallel, see individual Depends)

P10 (nav + egress): T-065–T-067 (after UI + API)
```

**Total**: 67 tasks. 34 RED (test-first), 31 GREEN (implementation), 2 pure (T-020 extends, T-067 security test).
