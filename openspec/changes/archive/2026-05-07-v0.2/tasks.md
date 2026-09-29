# Tasks: v0.2 — Diff Mode + Watch Mode + SARIF Export

## Summary

74 tasks across 8 groups + 1 cross-cutting test group.
Critical path: A → B → C → D → E → G → H (sequential).
F (SARIF) is parallel to D/E once A is done.
Strict TDD Mode active: every implementation task has a paired RED-test task that must be written first.

Migration note: existing SQL files go 0000–0006; the v0.2 migration is `0007_v02_diff_watch_sarif.sql`.
The design doc calls it `0002_v02_...` — that is the logical change-set label, not the filename sequence.

---

## Group A — Database migrations
_Prerequisite for all other groups. Must complete before any app code._

- [ ] T-A01 — Test: v0.2 schema additions `[tests/unit/db/schema-v02.test.ts]` `[size: S]`
  - RED tests: assert new columns on `scans` (strategy, base_sha, head_sha, pr_number, pr_comment_id, pr_comment_status) exist via `PRAGMA table_info(scans)`; assert new tables `repos`, `webhook_events`, `watch_locks`, `notification_log` exist with correct columns; assert `repos.watch_enabled` default false; assert `scans.strategy` default `'standard'`.
  - Depends on: none
  - Tests: this IS the test task (run after migration applied to `:memory:` db)

- [ ] T-A02 — Write migration 0007 SQL `[drizzle/0007_v02_diff_watch_sarif.sql]` `[size: M]`
  - ALTER TABLE scans ADD COLUMN strategy TEXT NOT NULL DEFAULT 'standard'. ADD COLUMN base_sha TEXT. ADD COLUMN head_sha TEXT. ADD COLUMN pr_number INTEGER. ADD COLUMN pr_comment_id TEXT. ADD COLUMN pr_comment_status TEXT. CREATE TABLE repos (id, project_id FK, name, local_path, default_branch, watch_enabled INTEGER DEFAULT 0, watch_interval TEXT DEFAULT '0 */6 * * *', notify_channels TEXT, notify_severity_floor TEXT DEFAULT 'high', slack_webhook_url_ref TEXT, webhook_secret_ref TEXT, webhook_proxy_url TEXT, created_at TEXT). CREATE TABLE webhook_events (id TEXT PK, repo_id TEXT FK repos.id, delivery_id TEXT UNIQUE, event TEXT, action TEXT, payload TEXT, status TEXT DEFAULT 'pending', received_at TEXT, processed_at TEXT, scan_id TEXT, error TEXT). CREATE TABLE watch_locks (repo_id TEXT, branch TEXT, acquired_at TEXT, PRIMARY KEY(repo_id, branch)). CREATE TABLE notification_log (id INTEGER PK AUTOINCREMENT, repo_id TEXT FK repos.id, channel TEXT, scan_id TEXT, finding_count INTEGER, sent_at TEXT). CREATE INDEX findings_scan_dedup_idx ON findings(scan_id, dedup_key). Register in drizzle/meta/_journal.json.
  - Depends on: T-A01
  - Tests: T-A01 must go GREEN

- [ ] T-A03 — Add Drizzle schema types `[lib/db/schema.ts]` `[size: M]`
  - Add sqliteTable definitions for `repos`, `webhook_events`, `watch_locks`, `notification_log` matching migration 0007. Add new columns to `scans` table definition: strategy, base_sha, head_sha, pr_number, pr_comment_id, pr_comment_status. Add index `findingsScanDedupIdx` on `(scan_id, dedup_key)`. Export all new table refs.
  - Depends on: T-A02
  - Tests: T-A01 GREEN; TypeScript strict compilation with `tsc --noEmit`

---

## Group B — Repo layer
_Depends on A03. B tasks can run in parallel with each other._

- [ ] T-B01 — Test: repos.repo CRUD `[tests/unit/repos/repos.test.ts]` `[size: S]`
  - RED tests: insertRepo → row in table; getRepo returns typed row; updateRepo watch_enabled; listReposWithWatchEnabled returns only enabled rows; getRepoByProjectId returns null for missing.
  - Depends on: T-A03
  - Tests: this IS the test task

- [ ] T-B02 — Implement `lib/repos/repos.repo.ts` `[lib/repos/repos.repo.ts]` `[size: S]`
  - Export: `insertRepo`, `getRepo`, `updateRepo`, `listReposWithWatchEnabled`, `getRepoByProjectId`. All typed from Drizzle inferred types. JSDoc on each export. No `console.log`.
  - Depends on: T-B01, T-A03
  - Tests: T-B01 GREEN

- [ ] T-B03 — Test: webhook-events.repo `[tests/unit/repos/webhook-events.test.ts]` `[size: S]`
  - RED tests: enqueueWebhookEvent inserts with status='pending'; claimNextWebhookEvent updates status='processing' atomically (simulated concurrency); markWebhookEventDone sets processed_at; markWebhookEventFailed sets error; delivery_id UNIQUE constraint prevents duplicates.
  - Depends on: T-A03
  - Tests: this IS the test task

- [ ] T-B04 — Implement `lib/repos/webhook-events.repo.ts` `[lib/repos/webhook-events.repo.ts]` `[size: S]`
  - Export: `enqueueWebhookEvent`, `claimNextWebhookEvent` (UPDATE status WHERE status='pending' LIMIT 1 + RETURNING), `markWebhookEventDone`, `markWebhookEventFailed`. JSDoc on each.
  - Depends on: T-B03, T-A03
  - Tests: T-B03 GREEN

- [ ] T-B05 — Test: notification-log.repo + coalescing query `[tests/unit/repos/notification-log.test.ts]` `[size: S]`
  - RED tests: insertNotificationLog; getLastNotificationForRepo returns most recent; wasNotifiedWithin(repoId, channel, minutes) returns true if log entry < N minutes old; false otherwise.
  - Depends on: T-A03
  - Tests: this IS the test task

- [ ] T-B06 — Implement `lib/repos/notification-log.repo.ts` `[lib/repos/notification-log.repo.ts]` `[size: S]`
  - Export: `insertNotificationLog`, `getLastNotificationForRepo`, `wasNotifiedWithin`. JSDoc on each.
  - Depends on: T-B05, T-A03
  - Tests: T-B05 GREEN

- [ ] T-B07 — Test: scans.repo — parentId + strategy columns `[tests/unit/repos/scans-v02.test.ts]` `[size: S]`
  - RED tests: createScan with strategy='diff' persists correctly; createScan with default strategy='standard'; getMostRecentCompletedScan(repoId, branch) returns correct row; getDeltaFindings(childScanId, parentScanId) returns only findings with dedup_key absent in parent.
  - Depends on: T-A03
  - Tests: this IS the test task

- [ ] T-B08 — Extend `lib/repos/scans.repo.ts` `[lib/repos/scans.repo.ts]` `[size: S]`
  - Add: `getMostRecentCompletedScan(projectId: string, branch: string)`, `getDeltaFindings(childScanId: string, parentScanId: string)`. Update `createScan`/`insertScan` to accept and persist `strategy`, `base_sha`, `head_sha`, `pr_number`, `pr_comment_id`, `pr_comment_status`, `parentId`. JSDoc on new exports.
  - Depends on: T-B07, T-A03
  - Tests: T-B07 GREEN

---

## Group C — Webhook infrastructure
_Depends on B04. C tasks can run in parallel._

- [ ] T-C01 — Test: HMAC signature validation `[tests/unit/webhook/github-signature.test.ts]` `[size: S]`
  - RED tests: valid signature → true; tampered payload → false; missing header → false; empty secret → false; timing-safe (verify does not short-circuit on first byte mismatch). Use Node `crypto.createHmac` fixtures.
  - Depends on: none (pure util)
  - Tests: this IS the test task

- [ ] T-C02 — Implement `lib/webhook/github-signature.ts` `[lib/webhook/github-signature.ts]` `[size: XS]`
  - Export `verifyGithubSignature(secret: string, rawBody: string, header: string | null): boolean`. Uses `crypto.timingSafeEqual`. Returns false on any missing input. JSDoc.
  - Depends on: T-C01
  - Tests: T-C01 GREEN

- [ ] T-C03 — Test: webhook route — 401 / 202 / idempotency `[tests/api/webhooks/github.test.ts]` `[size: M]`
  - RED tests: POST with valid sig → 202 + row in webhook_events; POST with invalid sig → 401; POST with missing sig → 401; duplicate delivery_id → 202 (idempotent, no second row); non-PR event (action='labeled') → 202 no scan enqueued; PR opened/synchronize → 202 scan enqueued.
  - Depends on: T-C02, T-B04
  - Tests: this IS the test task

- [ ] T-C04 — Implement `app/api/webhooks/github/route.ts` `[app/api/webhooks/github/route.ts]` `[size: M]`
  - `export async function POST(req: Request)`. Read raw body via `req.text()` BEFORE JSON parse. Call `verifyGithubSignature`. On fail → 401. Parse JSON with Zod schema (action, pull_request.number, pull_request.head.sha, pull_request.base.sha, pull_request.changed_files). Enqueue to `webhook_events`. Use `setImmediate` to fire processor without blocking response. Return 202. No `console.log`.
  - Depends on: T-C03, T-C02, T-B04
  - Tests: T-C03 GREEN

- [ ] T-C05 — Test: smee relay startup `[tests/unit/webhook/smee-relay.test.ts]` `[size: S]`
  - RED tests: `startSmeeRelay(url, target)` calls SmeeClient with correct params; relay stops on `stopSmeeRelay()`; no-op if smeeUrl is undefined/empty.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-C06 — Implement `lib/webhook/smee-relay.ts` `[lib/webhook/smee-relay.ts]` `[size: XS]`
  - Export `startSmeeRelay(smeeUrl: string, localTarget: string): SmeeHandle` and `stopSmeeRelay(handle: SmeeHandle): void`. Wraps `smee-client`. JSDoc. Guards against double-start.
  - Depends on: T-C05
  - Tests: T-C05 GREEN

- [ ] T-C07 — Test: webhook processor — claims event + triggers diff scan `[tests/unit/webhook/webhook-processor.test.ts]` `[size: M]`
  - RED tests: processNextWebhookEvent with pending PR event → calls triggerDiffScan with correct prNumber/shas; marks event done; non-PR event → marks done without triggering scan; failed scan → marks event failed with error; no pending events → returns without side effects.
  - Depends on: T-B04, T-B08
  - Tests: this IS the test task

- [ ] T-C08 — Implement `lib/webhook/webhook-processor.ts` `[lib/webhook/webhook-processor.ts]` `[size: S]`
  - Export `processNextWebhookEvent(db: DB): Promise<void>`. Claim next pending event. Parse payload. If action in ['opened','synchronize','reopened'] → call `triggerDiffScan`. Mark done/failed. Loop-safe: only processes one event per call (caller drives polling loop). JSDoc.
  - Depends on: T-C07, T-B04, T-B08
  - Tests: T-C07 GREEN

---

## Group D — Diff Mode scan strategy
_Depends on B08. D tasks can run in parallel._

- [ ] T-D01 — Test: import expander (1-hop regex) `[tests/unit/diff/import-expander.test.ts]` `[size: S]`
  - RED tests: given a file A importing from B, `expandImports([B], allFiles)` returns [A, B]; no transitive (1-hop only); missing file → warning event, returns changed files only; TypeScript/JS import patterns (ES import, require, dynamic import) all matched.
  - Depends on: none (pure util)
  - Tests: this IS the test task

- [ ] T-D02 — Implement `lib/pipeline/diff/expand.ts` `[lib/pipeline/diff/expand.ts]` `[size: S]`
  - Export `expandImports(changedFiles: string[], allRepoFiles: string[], onWarn?: (msg: string) => void): string[]`. Regex-based 1-hop: for each file in allRepoFiles, parse import/require statements, check if any match changed file paths. Returns union of changedFiles + callers. Cache result by (changedFiles.join(','), allRepoFiles.length). JSDoc.
  - Depends on: T-D01
  - Tests: T-D01 GREEN

- [ ] T-D03 — Test: GitHub PR file fetch `[tests/unit/diff/github-pr.test.ts]` `[size: S]`
  - RED tests: `fetchPRChangedFiles(owner, repo, prNumber, token)` returns string[] of filenames; handles paginated response (per_page=100, multiple pages); 404 → throws; 401 → throws with message directing to settings.
  - Depends on: T-E01 (github client)
  - Tests: this IS the test task

- [ ] T-D04 — Implement `lib/pipeline/diff/github-pr.ts` `[lib/pipeline/diff/github-pr.ts]` `[size: S]`
  - Export `fetchPRChangedFiles(owner: string, repo: string, prNumber: number, token: string): Promise<string[]>`. Uses `lib/integrations/github/client.ts`. Paginates GET /repos/{owner}/{repo}/pulls/{number}/files. Returns filenames only. JSDoc.
  - Depends on: T-D03, T-E02
  - Tests: T-D03 GREEN

- [ ] T-D05 — Test: stage1-classical scopeFiles + skipScanners `[tests/unit/pipeline/stage1-scoped.test.ts]` `[size: M]`
  - RED tests: with scopeFiles=['a.ts'], scanner for gitleaks receives only that file; OSV scanner not called when skipScanners=['osv']; semgrep called with file list; scopeFiles=undefined → all files (original behavior unchanged).
  - Depends on: T-A03
  - Tests: this IS the test task

- [ ] T-D06 — Update `lib/pipeline/stage1-classical.ts` `[lib/pipeline/stage1-classical.ts]` `[size: S]`
  - Add optional `scopeFiles?: string[]` and `skipScanners?: ('osv'|'gitleaks'|'trufflehog'|'semgrep')[]` to `Stage1Opts`. When `scopeFiles` set, pass to individual scanners as file filter. When `skipScanners` includes 'osv', skip OSV runner. Existing behavior when both undefined. JSDoc update.
  - Depends on: T-D05
  - Tests: T-D05 GREEN

- [ ] T-D07 — Test: DiffStrategy narrows, skips OSV, sets timeout `[tests/unit/pipeline/strategies/diff.test.ts]` `[size: M]`
  - RED tests: DiffStrategy with changedFiles → stage1 called with scopeFiles=changedFiles+callers, skipScanners=['osv']; 25s timeout → scan status set to 'timeout' + error event; unknown strategy → falls back to standard + warning event; empty changedFiles → still runs on import-expanded set; parentId set on scan row to mostRecentCompleted.
  - Depends on: T-D02, T-D06, T-B08
  - Tests: this IS the test task

- [ ] T-D08 — Implement `lib/pipeline/strategies/diff.ts` `[lib/pipeline/strategies/diff.ts]` `[size: M]`
  - `DiffStrategy implements ScanStrategy`. `readonly id = 'diff'`. `run(ctx)`: validate diffContext present else emit warning + delegate to StandardStrategy. Fetch allRepoFiles via fs.glob. Call `expandImports`. Call `runStage1Classical` with scopeFiles + skipScanners=['osv']. Wire 25s `setTimeout` abort that sets scan status='timeout'. Delegate stages 2–5 to StandardStrategy. Set parentId on scan row via `getMostRecentCompletedScan`. JSDoc.
  - Depends on: T-D07, T-D02, T-D06, T-B08
  - Tests: T-D07 GREEN

- [ ] T-D09 — Update strategy types + factory `[lib/pipeline/strategies/types.ts, lib/pipeline/strategies/index.ts]` `[size: S]`
  - Add `'diff'` to `ScanModeId` (or introduce `ScanStrategyId = ScanModeId | 'diff'`). Add `diffContext?: { baseSha: string, headSha: string, changedFiles: string[], prNumber?: number }` optional field to `StrategyContext`. Add `'diff'` case to `selectStrategy()` factory. Update `normalizeScanMode` to handle 'diff' pass-through without warning. JSDoc update.
  - Depends on: T-D08
  - Tests: `tests/unit/pipeline/strategies/normalizeScanMode.test.ts` extended; `tests/unit/pipeline/strategies/diff.test.ts` T-D07

- [ ] T-D10 — Update pipeline runner for diff strategy `[lib/pipeline/runner.ts]` `[size: S]`
  - `RunnerOpts` accepts optional `strategy?: 'diff' | ScanMode`, `diffContext?`. When strategy='diff', pass diffContext to StrategyContext. Register 25s abort handler at runner level as safety net (DiffStrategy also has its own). Update `createScan` call to persist strategy + sha fields.
  - Depends on: T-D09, T-D08
  - Tests: `tests/integration/pipeline/runner.test.ts` extended with diff strategy scenario

---

## Group E — GitHub API integration
_Depends on A03. E tasks can run in parallel._

- [ ] T-E01 — Test: GitHub REST client `[tests/unit/integrations/github/client.test.ts]` `[size: S]`
  - RED tests: GET request constructs correct Authorization header; 403 secondary rate limit → retries with exponential backoff (max 3); 401 → throws `GitHubAuthError`; 404 → throws `GitHubNotFoundError`; success → returns parsed JSON.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-E02 — Implement `lib/integrations/github/client.ts` `[lib/integrations/github/client.ts]` `[size: M]`
  - Export `githubGet<T>(path: string, token: string): Promise<T>` and `githubPost<T>(path: string, body: unknown, token: string): Promise<T>` and `githubPatch<T>(path: string, body: unknown, token: string): Promise<T>`. Exponential backoff on 403: 1s, 2s, 4s, max 3 attempts. Throws typed errors `GitHubAuthError`, `GitHubNotFoundError`, `GitHubRateLimitError`. No Octokit dependency. JSDoc.
  - Depends on: T-E01
  - Tests: T-E01 GREEN

- [ ] T-E03 — Test: PR comment post + idempotency `[tests/unit/integrations/github/pr-comment.test.ts]` `[size: M]`
  - RED tests: `postOrUpdatePRComment` with no existing marker → creates new comment; existing marker found → PATCH updates it; no GitHub token → throws with actionable message; GitHub 401 → throws `GitHubAuthError`; 11+ findings → `<details>` block in body; 3 findings → no `<details>` block; zero findings → does not call GitHub API.
  - Depends on: T-E01
  - Tests: this IS the test task

- [ ] T-E04 — Implement `lib/integrations/github/pr-comment.ts` `[lib/integrations/github/pr-comment.ts]` `[size: M]`
  - Export `postOrUpdatePRComment(opts: PRCommentOpts): Promise<string | null>` (returns comment URL or null if no findings). Search existing comments for `<!-- obt:scan:{scanId} -->` marker via `GET /repos/{owner}/{repo}/issues/{prNumber}/comments`. PATCH if found, POST if not. Build markdown body: severity badge + file:line link + description + apply-fix link. Collapse > 10 findings in `<details>`. JSDoc.
  - Depends on: T-E03, T-E02
  - Tests: T-E03 GREEN

- [ ] T-E05 — Test: apply-fix endpoint — happy path + 409 stale + 400 no-patch `[tests/api/findings/apply-fix.test.ts]` `[size: M]`
  - RED tests: valid finding with patch_diff, head_sha matches → 200 + commit created + follow-up comment; head_sha moved since scan → 409; finding.patch_diff null → 400; no GitHub token → 424 with settings link.
  - Depends on: T-E02, T-B07
  - Tests: this IS the test task

- [ ] T-E06 — Implement `app/api/findings/[id]/apply-fix-to-pr/route.ts` + `lib/integrations/github/apply-fix.ts` `[app/api/findings/[id]/apply-fix-to-pr/route.ts, lib/integrations/github/apply-fix.ts]` `[size: M]`
  - Route: POST, Zod-validate params, load finding + scan, retrieve token from config, call `applyFixToPR`. `applyFixToPR`: GET current head SHA → compare with scan.head_sha → 409 if differs. GET file contents → apply patch_diff → POST blob → POST tree → POST commit → PATCH ref. Post follow-up comment with commit SHA. Update `pr_comment_status` on scan row. JSDoc on all exports.
  - Depends on: T-E05, T-E02, T-E04
  - Tests: T-E05 GREEN

- [ ] T-E07 — Extend config schema for GitHub token `[lib/config/schema.ts]` `[size: XS]`
  - Add `providers.githubToken: z.string().optional()` to `ObtConfig`. No breaking change (optional field, default undefined). Update `defaultConfig` accordingly.
  - Depends on: none
  - Tests: `tests/config/store.test.ts` extended: githubToken persists + reads back; absent → undefined (not error)

---

## Group F — SARIF
_Depends on A03. F tasks can run in parallel with D and E._

- [ ] T-F01 — Test: SARIF emitter — schema validation + field mapping `[tests/unit/sarif/emitter.test.ts]` `[size: M]`
  - RED tests: 3 findings → valid SARIF 2.1.0 document (validate against vendored schema); high severity → level='error'; medium → 'warning'; low → 'note'; info → 'none'; dedup_key in partialFingerprints['obt/v0.1/dedupKey']; 0 findings → valid SARIF with results=[]; ruleId = detector+':'+title; location has uri + startLine.
  - Depends on: T-A03
  - Tests: this IS the test task

- [ ] T-F02 — Implement `lib/export/sarif/emit.ts` + `lib/export/sarif/schema.ts` `[lib/export/sarif/emit.ts, lib/export/sarif/schema.ts]` `[size: M]`
  - `schema.ts`: Zod schema for SARIF 2.1.0 `SarifLog` (runs[], results[], locations[], partialFingerprints). Vendor/inline the minimal required fields. `emit.ts`: export `emitSarif(findings: NormalizedFinding[], scanId: string): SarifLog`. Map each finding to SARIF result. Dual fingerprints: `obt/v0.1/dedupKey` + `obt/sarif/primaryLocationLineHash`. Validate via SarifLog.parse() before return; throw on invalid. JSDoc.
  - Depends on: T-F01
  - Tests: T-F01 GREEN

- [ ] T-F03 — Implement `GET /api/scans/[id]/sarif` route `[app/api/scans/[id]/sarif/route.ts]` `[size: S]`
  - Load scan + findings. Call `emitSarif`. On success → 200 + `Content-Type: application/json`. On `emitSarif` throw (invalid SARIF) → 500 with descriptive error message (no malformed SARIF in body). 404 if scan not found.
  - Depends on: T-F02
  - Tests: `tests/api/scans/sarif-export.test.ts` — 200 valid SARIF; empty scan → valid; scan not found → 404; validation failure (mocked) → 500

- [ ] T-F04 — Test: SARIF ingester — cap + malformed + severity mapping `[tests/unit/sarif/ingester.test.ts]` `[size: M]`
  - RED tests: valid CodeQL SARIF 5 results → 5 NormalizedFindings with scanner='sarif-import:CodeQL'; level='error' → severity='high'; level='warning' → 'medium'; level='note' → 'low'; missing level → 'medium'; 15k results → only 10k persisted + warning in response; malformed (not valid SARIF) → throws `SarifIngestError`; obt/v0.1/dedupKey fingerprint present → reused; absent → computed fresh.
  - Depends on: T-A03
  - Tests: this IS the test task

- [ ] T-F05 — Implement `lib/scanners/sarif.ts` (ingest) `[lib/scanners/sarif.ts]` `[size: M]`
  - Export `ingestSarif(sarifJson: unknown, onWarn?: (msg: string) => void): NormalizedFinding[]`. Validate against SARIF schema → throw `SarifIngestError` on fail. Stream-parse via `stream-json` for large files (prevents OOM). Map `level` → severity. Cap at 10k findings. Reuse `obt/v0.1/dedupKey` fingerprint if present. `scanner` field = `'sarif-import:' + run.tool.driver.name`. Implements `Scanner` interface indirectly (stateless function, no binary). JSDoc.
  - Depends on: T-F04, T-F02 (schema reuse)
  - Tests: T-F04 GREEN

- [ ] T-F06 — Implement `POST /api/scans/[id]/sarif-import` route `[app/api/scans/[id]/sarif-import/route.ts]` `[size: S]`
  - Accept multipart file upload. Parse SARIF JSON. Call `ingestSarif`. On `SarifIngestError` → 422. Insert findings into DB (reuse `insertFinding` or batch insert). Return 200 with `{ imported: N, warning?: string }`. Zod-validate request. Cap enforced in ingester. JSDoc.
  - Depends on: T-F05
  - Tests: `tests/api/scans/sarif-import.test.ts` — valid SARIF → 200 + findings in DB; malformed → 422; cap hit → 200 + warning field; scan not found → 404

---

## Group G — Pipeline integration wiring
_Depends on D10, C08, E06, F03, F06. G tasks can run in parallel._

- [ ] T-G01 — Test: diff scan trigger via API `[tests/api/repos/scan.test.ts]` `[size: S]`
  - RED tests: POST /api/repos/[id]/scan with {mode:'diff', prNumber:1, baseSha:'abc', headSha:'def'} → 202; scan row has strategy='diff'; diff strategy selected; without mode field → defaults to standard.
  - Depends on: T-D10, T-B02
  - Tests: this IS the test task

- [ ] T-G02 — Implement `app/api/repos/[id]/scan/route.ts` `[app/api/repos/[id]/scan/route.ts]` `[size: S]`
  - POST endpoint. Zod schema: `{ mode?: 'standard'|'diff'|'quick', prNumber?: number, baseSha?: string, headSha?: string }`. If mode='diff' require prNumber + shas (validate). Fetch changed files via `fetchPRChangedFiles`. Build diffContext. Call runner with strategy='diff'. Return 202. JSDoc.
  - Depends on: T-G01, T-D10, T-D04, T-B02
  - Tests: T-G01 GREEN

- [ ] T-G03 — Wire webhook processor → diff scan `[lib/webhook/webhook-processor.ts]` `[size: XS]`
  - In `processNextWebhookEvent`, on PR opened/synchronize, call `triggerDiffScan(db, repoId, prNumber, baseSha, headSha)` which internally calls the runner with strategy='diff'. This is an update to T-C08 implementation.
  - Depends on: T-C08, T-G02
  - Tests: T-C07 extended: PR event → diff scan created with correct strategy

- [ ] T-G04 — Wire post-scan PR comment posting `[lib/pipeline/runner.ts]` `[size: S]`
  - After pipeline completes with strategy='diff': compute delta findings (getDeltaFindings). If delta non-empty AND pr_number present → call `postOrUpdatePRComment`. Update scan's pr_comment_status ('done'|'failed'). Scan status remains 'done' regardless of comment failure. JSDoc update.
  - Depends on: T-E04, T-B08, T-D10
  - Tests: `tests/integration/pipeline/runner.test.ts` extended: diff scan + delta → comment posted; zero delta → no comment call; comment fails → scan still 'done'

- [ ] T-G05 — Wire post-scan Watch Mode notification `[lib/watch/run-watch-scan.ts]` `[size: S]`
  - After watch scan pipeline completes: call getDeltaFindings. Filter by notify_severity_floor. If non-empty → call `dispatchNotifications`. Baseline = mostRecentCompletedScan for (repo_id, branch). No baseline → run full scan silently (no notification).
  - Depends on: T-H05, T-B08
  - Tests: `tests/unit/watch/run-watch-scan.test.ts` — no baseline → full scan, no notification; baseline exists + new critical finding → notification dispatched; all findings below floor → no notification

---

## Group H — Watch Mode
_Depends on B06, B08. H tasks can run mostly in parallel after H01._

- [ ] T-H01 — Test: scheduler register/unregister/HMR-safe singleton `[tests/unit/watch/scheduler.test.ts]` `[size: S]`
  - RED tests: startScheduler registers cron job for watched repo; calling startScheduler twice → same singleton (no double-job via globalThis.__obtScheduler); unregisterRepo cancels job; stopScheduler cancels all jobs; repo with watch_enabled=false → no job registered.
  - Depends on: T-B02
  - Tests: this IS the test task

- [ ] T-H02 — Implement `lib/watch/scheduler.ts` `[lib/watch/scheduler.ts]` `[size: M]`
  - Export `startScheduler(db: DB): void`, `stopScheduler(): void`, `registerRepo(repoId: string, cronExpr: string): void`, `unregisterRepo(repoId: string): void`. Use `node-cron`. Store scheduled tasks in `globalThis.__obtScheduler` (Map<repoId, ScheduledTask>) for HMR safety. On start: `listReposWithWatchEnabled` → register each. JSDoc.
  - Depends on: T-H01, T-B02
  - Tests: T-H01 GREEN

- [ ] T-H03 — Implement `instrumentation.ts` `[instrumentation.ts]` `[size: S]`
  - Next.js `register()` function. Dynamic import `lib/watch/scheduler.ts` (avoids edge runtime issues). Check `globalThis.__obtScheduler` before starting (HMR guard). Run DB migration 0007 BEFORE starting scheduler. Export `register` per Next.js 16 instrumentation API. JSDoc.
  - Depends on: T-H02, T-A02
  - Tests: `tests/unit/watch/instrumentation.test.ts` — register() called twice → scheduler started once; migration runs before scheduler boot

- [ ] T-H04 — Test: watch isolation — worktree management `[tests/unit/watch/worktree.test.ts]` `[size: S]`
  - RED tests: `ensureWatchWorktree(repoId, branch)` creates worktree at `~/.obt/worktrees/{repoId}/{sha8(branch)}`; case-insensitive FS safety via sha8 hash; existing worktree → reuses without error; `git fetch` called on worktree; original working copy files unchanged (mock fs).
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-H05 — Implement `lib/watch/run-watch-scan.ts` `[lib/watch/run-watch-scan.ts]` `[size: M]`
  - Export `runWatchScan(db: DB, repoId: string): Promise<void>`. Acquire advisory lock (`watch_locks`) → skip + log warning if already held. Ensure worktree via `ensureWatchWorktree`. `git fetch && git checkout head`. Find baseline = `getMostRecentCompletedScan`. If no baseline → run full scan, return (no notification). Else run diff scan with parentId=baseline.id. TTL lock: 5min max (delete from watch_locks in finally). JSDoc.
  - Depends on: T-H04, T-B08, T-B02
  - Tests: T-H04 GREEN; `tests/unit/watch/run-watch-scan.test.ts` (written in T-G05)

- [ ] T-H06 — Test: Slack 5-min coalescer `[tests/unit/watch/coalesce.test.ts]` `[size: S]`
  - RED tests: `shouldNotify(db, repoId, 'slack')` returns true when no log entry; false when last entry < 5min ago; true when last entry > 5min ago; desktop channel → always true (not rate-limited).
  - Depends on: T-B06
  - Tests: this IS the test task

- [ ] T-H07 — Implement `lib/watch/coalesce.ts` `[lib/watch/coalesce.ts]` `[size: XS]`
  - Export `shouldNotify(db: DB, repoId: string, channel: string): boolean`. Calls `wasNotifiedWithin`. Desktop channel bypasses check (always true). Slack: false if within 5min. JSDoc.
  - Depends on: T-H06, T-B06
  - Tests: T-H06 GREEN

- [ ] T-H08 — Test: desktop + Slack notifiers `[tests/unit/watch/notify.test.ts]` `[size: S]`
  - RED tests: `notifyDesktop(title, body)` calls node-notifier with correct params; `notifySlack(webhookUrl, findings)` POSTs to webhook URL with JSON body; Slack webhook error → logs warning but does NOT throw; severity floor filters applied before dispatch; `dispatchNotifications` calls both channels when configured.
  - Depends on: none
  - Tests: this IS the test task

- [ ] T-H09 — Implement `lib/watch/notify/` `[lib/watch/notify/index.ts, lib/watch/notify/desktop.ts, lib/watch/notify/slack.ts]` `[size: S]`
  - `desktop.ts`: export `notifyDesktop(title: string, body: string): void`. Wraps `node-notifier`. Falls back silently if not available. `slack.ts`: export `notifySlack(webhookUrl: string, findings: NormalizedFinding[]): Promise<void>`. POST JSON to webhook. Never throws (catches + warns). `index.ts`: export `dispatchNotifications(db, repo, deltaFindings, channels)`. Filters by severity floor. Calls shouldNotify. If notify → call transports → log to notification_log. JSDoc all exports.
  - Depends on: T-H08, T-H07, T-B06
  - Tests: T-H08 GREEN

---

## Group I — Settings + UI
_Depends on E07, C06, H02. I tasks can run in parallel._

- [ ] T-I01 — Implement `app/api/repos/route.ts` + `app/api/repos/[id]/route.ts` `[app/api/repos/route.ts, app/api/repos/[id]/route.ts]` `[size: S]`
  - GET /api/repos → list repos. POST /api/repos → create repo (Zod-validated). GET /api/repos/[id] → get repo. PATCH /api/repos/[id] → update watch settings (watch_enabled, watch_interval, notify_channels, notify_severity_floor, slack_webhook_url_ref). All routes Zod-validated. JSDoc.
  - Depends on: T-B02
  - Tests: `tests/api/repos.test.ts` — CRUD happy paths; invalid cron expression → 400; invalid severity floor → 400

- [ ] T-I02 — Implement settings GitHub token UI `[app/settings/page.tsx or existing settings page]` `[size: S]`
  - Add GitHub integration section: PAT input field, save button, validation test (calls GitHub /user endpoint), error state display for 401/403 from stored token, link to create PAT on GitHub. Wire to existing config API. No `console.log`.
  - Depends on: T-E07, T-E02
  - Tests: `tests/unit/app/settings/github-token.test.ts` — render, input change, save success, 401 error state shown

- [ ] T-I03 — Implement Watch Mode config panel `[app/repos/[id]/settings/page.tsx, components/repos/WatchConfigPanel.tsx]` `[size: S]`
  - UI: enable/disable toggle, cron expression picker (`CronPicker` component), Slack webhook URL input, severity floor select (critical/high/medium/low), save button. On save → PATCH /api/repos/[id]. Calls `registerRepo`/`unregisterRepo` server action. No `console.log`.
  - Depends on: T-I01, T-H02
  - Tests: `tests/unit/components/repos/WatchConfigPanel.test.ts` — renders; toggle calls PATCH; invalid cron → error shown

- [ ] T-I04 — Implement Webhook setup wizard `[app/repos/[id]/webhook/page.tsx, components/repos/WebhookWizard.tsx]` `[size: S]`
  - Steps: (1) display smee.io URL (auto-generated or configurable), copy button; (2) webhook secret input + generate button; (3) test webhook button (fires POST /api/webhooks/github with test payload signed with current secret); (4) success state. No `console.log`.
  - Depends on: T-C04, T-C06
  - Tests: `tests/unit/components/repos/WebhookWizard.test.ts` — renders steps; copy button; secret generate; test webhook call

- [ ] T-I05 — Implement SARIF export button `[components/sarif/SarifExportButton.tsx]` `[size: XS]`
  - Button on scan result page. Triggers GET /api/scans/[id]/sarif, triggers browser download. Shows loading state. Error state on 500.
  - Depends on: T-F03
  - Tests: `tests/unit/components/sarif/SarifExportButton.test.ts` — renders; click → fetch called; error shown on 500

- [ ] T-I06 — Implement SARIF import dropzone `[components/sarif/SarifImportDropzone.tsx]` `[size: S]`
  - Drag-and-drop or file picker. Accepts .json/.sarif files. On file selected → POST /api/scans/[id]/sarif-import multipart. Shows progress, success (imported count), warning (cap hit), error (422 malformed). No `console.log`.
  - Depends on: T-F06
  - Tests: `tests/unit/components/sarif/SarifImportDropzone.test.ts` — renders; drop event → POST called; 422 → error shown; cap warning displayed

- [ ] T-I07 — Add repos nav + pages scaffold `[app/repos/page.tsx, app/repos/[id]/settings/page.tsx, app/repos/[id]/webhook/page.tsx]` `[size: S]`
  - `/repos` page: list repos (`RepoList` component). `/repos/[id]/settings`: render WatchConfigPanel. `/repos/[id]/webhook`: render WebhookWizard. Navigation link in sidebar/header to /repos. No `console.log`.
  - Depends on: T-I01, T-I03, T-I04
  - Tests: `tests/unit/app/repos/pages.test.ts` — renders without crash; data fetched from API on mount

---

## Dependency graph (critical path)

```
A01 → A02 → A03
              ↓
         B01..B08 (parallel)
              ↓
    ┌─────────┼──────────┐
    C         D          F
    │         │          │
    C01..C08  D01..D10   F01..F06
    │         │          │
    └─────────┼──────────┘
              G
         G01..G05
              ↓
    ┌─────────┴─────────┐
    H                   I
    H01..H09            I01..I07
```

E tasks (GitHub client) run in parallel from start of project (no DB dependency for pure client).
F tasks start after A03.
D03/D04 depend on E01/E02.
G05 depends on H05.

---

## Task count by group

| Group | Tasks | Parallel-eligible |
|-------|-------|-------------------|
| A — Migrations | 3 | none (sequential) |
| B — Repo layer | 8 | B01–B08 after A03 |
| C — Webhooks | 8 | C01–C06 after B04 |
| D — Diff Mode | 10 | D01,D02 early; D03 after E01 |
| E — GitHub API | 7 | E01,E07 from day 0 |
| F — SARIF | 6 | F01 after A03 |
| G — Wiring | 5 | G01–G05 after D+C+E+F |
| H — Watch Mode | 9 | H04 independent; H01 after B02 |
| I — UI | 7 | I01–I07 after deps |
| **Total** | **63** | |

_Note: each RED-test task + its GREEN implementation task pair is counted as 2 tasks. Some test tasks (T-G01, etc.) are embedded in the implementation group for readability._
