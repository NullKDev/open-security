# Design: v0.4 — Fix & Prove + Posture Trends + MTTR + Regression Tracker + FP Bank

> **Companion documents**: [proposal.md](proposal.md), [spec.md](spec.md)
>
> **Stack**: Next.js 16 (App Router, Turbopack), React 19, TS 5 strict, Tailwind v4, SQLite (better-sqlite3 + Drizzle ORM), Vitest 4, bun. Local-first single-process.
>
> **Builds on**: v0.1 (`finding_branches`, `finding_dismissals`, `dedup_key` chain, `fp_bank_fts`, `branch-executor`), v0.2 (PR comment posting, Watch Mode), v0.3 (ACP transport, `scan_events`).

This document resolves the open architectural questions (Q1–Q5 in the orchestrator brief; Q1, Q2, Q6, Q8 deferred from spec) and specifies the WHERE/HOW for the five v0.4 capabilities. It is intentionally precise so the tasks phase can produce a deterministic checklist.

---

## 1. Architecture Decisions (ADRs)

### ADR-1 — Regression test generation runs as an **inline ACP turn** within the same Fix & Prove session

**Context (Q1).** After a fix branch is created and the patch applied, the agent must author a regression test that targets the vulnerability. Three options:
- (a) Inline turn on the same ACP session that just applied the patch
- (b) Fresh ACP session with patch diff + finding description as context
- (c) Plain `provider.generate()` call — non-ACP

**Decision.** **Option (a) — inline ACP turn on the existing Fix & Prove session.**

**Rationale.**
- The agent already has the working tree open, the patch in its context, and the read/edit/terminal handlers wired (v0.3 ACP transport). Spawning a fresh session re-pays cold-start cost (process spawn ~1–3s on the slowest providers).
- The triad demands two test-suite invocations (pre and post) plus the test author step. We need the agent's `terminal-handler.ts` for `bun test`/`pytest` invocations and `file-system-handler.ts` for writing the test file. Both are already provisioned for the same session — reuse.
- A plain `provider.generate()` (option c) cannot author a file via tool calls. We would have to parse a string back into a diff and apply it ourselves — fragile and inconsistent with the ACP-first direction in v0.3.
- Same-session inline keeps every triad event (`RegressionTestAuthoredEvent`, two `VulRunResultEvent`s) under one `scanId + sessionId` pair in `scan_events`. The PR comment dual-diff (REQ-FP-05) reads cleanly from a single event ribbon.

**Turn structure.**
The Fix & Prove flow is one ACP session with **four sequential turns**:

| Turn | Purpose | Required Output |
|------|---------|-----------------|
| 1 | Apply patch from `findings.patch_diff` (already done by v0.1 `branch-executor`) | working-tree mutation |
| 2 | Run unit-test suite (`project.test_command`) | `unit_test_passed: boolean` |
| 3 | Author regression test at `regression_test_path` | file written, `RegressionTestAuthoredEvent` emitted |
| 4 | Run **only** the new regression test against the **post-patch** tree | `vul_run_passed_post: boolean` |

The pre-patch run (Turn 4-pre) is performed by the **host orchestrator** (not the agent) by stashing the patch (see ADR-2), running the regression test path, and unstashing — no extra ACP turn is needed because we control the working tree.

**Rejected.**
- *Fresh ACP session per step.* Wasteful spawn cost; loses turn context.
- *Plain `provider.generate()`.* Cannot drive file writes through tool calls; bypasses ACP traffic logging.

---

### ADR-2 — Triad uses a **dedicated worktree** (`git worktree add`) per finding; pre/post pivot via `git apply -R / git apply`

**Context (Q2).** The triad needs three working-tree states for the same finding:
1. **Pre-patch**: regression test must FAIL (`vul_run_passed_pre = false`).
2. **Patch applied**: same as v0.1 branch worktree.
3. **Post-patch with regression test**: regression test must PASS.

Three options were on the table: (a) reuse v0.1 branch worktree, (b) fresh `git worktree add`, (c) `git stash` on the v0.1 branch.

**Decision.** **Option (b) — a dedicated worktree per finding** at:

```
.obt/projects/{projectId}/scans/{scanId}/proofs/{findingId}/
```

Created via `git worktree add` from the **same commit** the finding was scanned at (`finding.location_commit`, falling back to `scan.head_commit` from v0.1). The v0.1 branch worktree (`sec/fix/{shortId}`) is left **untouched** — it is the artefact the operator's PR opens against.

**Rationale.**
- The v0.1 branch worktree already has the patch applied. Reverting it for the pre-patch run would (i) make `git status` and the operator's IDE flicker, (ii) race with the operator if they are mid-review.
- `git stash` (option c) is a side-channel: a crashed Node process leaves the stash on the user's branch — a worse failure mode than an orphan worktree (which `git worktree prune` cleans up).
- A dedicated worktree is **isolated**: tests can mutate caches/node_modules/build artefacts without contaminating the v0.1 branch.
- Worktrees share the `.git/` directory — disk overhead is the source tree only (typically <500 MB), and we delete the worktree on triad completion (`git worktree remove --force`).

**Triad sequence (reference, see §2 for code):**

```
1. git worktree add <proofs-dir> <finding.location_commit>
2. (host)   git apply <patch_diff>          → state = "patched"
3. ACP turn 3: agent writes regression test → file at regression_test_path
4. (host)   git apply -R <patch_diff>       → state = "pre-patch with test"
5. (host)   exec test_command --filter <regression_test_path>
                                            → vul_run_passed_pre  (must be FALSE)
6. (host)   git apply <patch_diff>          → state = "patched with test"
7. ACP turn 4: agent runs full test command → unit_test_passed
                + same regression test path → vul_run_passed_post
8. git worktree remove --force <proofs-dir>
```

We deliberately do **not** ask the agent to perform the `git apply -R` / `git apply` pivot — only the host process touches git plumbing. The agent's job is authoring and running tests. This boundary is cleaner and limits the agent's permission surface.

**Cleanup safety.** A boot-time hook in `lib/branch/proof-cleanup.ts` runs `git worktree prune` on every project's source tree to evict worktrees orphaned by a previous crash. Idempotent.

**Rejected.**
- *Reuse v0.1 branch worktree.* Mutation collision with operator review; can't pivot states without disturbing the branch.
- *`git stash` approach.* Failure mode leaves user's working dir dirty.
- *Worktree pool (one shared, recycled).* Premature optimization; concurrency for v0.4 is one finding at a time per project.

---

### ADR-3 — Triad results live on a **dedicated `fix_proofs` table**, not a JSON column

**Context (Q3).** Where do `regression_test_path`, `vul_run_passed_pre`, `vul_run_passed_post`, `unit_test_passed`, `failure_reason` live?

**Decision.** **One row per triad attempt in `fix_proofs`, FK back to `findings.id`** (1-to-many; latest row is the canonical proof). Findings carry a denormalized `proof_of_fix_id` pointer to the latest row for fast queue queries.

**Schema (Drizzle):**

```typescript
export const fixProofs = sqliteTable('fix_proofs', {
  id:                   text('id').primaryKey(),
  findingId:            text('finding_id').notNull().references(() => findings.id),
  branchId:             text('branch_id').references(() => findingBranches.id),
  // Inputs
  patchDiff:            text('patch_diff').notNull(),         // snapshot — patch may change later
  regressionTestPath:   text('regression_test_path'),         // null until Turn 3 succeeds
  regressionTestDiff:   text('regression_test_diff'),         // for PR dual-diff comment
  // Triad signals
  unitTestPassed:       integer('unit_test_passed', { mode: 'boolean' }),
  vulRunPassedPre:      integer('vul_run_passed_pre',  { mode: 'boolean' }),
  vulRunPassedPost:     integer('vul_run_passed_post', { mode: 'boolean' }),
  // Outcome
  outcome:              text('outcome').notNull(),
    // 'verified-fixed' | 'fix-unverified'
  failureReason:        text('failure_reason'),
    // 'no-patch' | 'unit-test-baseline-red'
    // | 'regression-test-invalid' | 'vul-not-eliminated'
    // | 'unit-test-failed' | 'agent-error' | 'timeout'
  // Captured terminal output (last 2 KB each — enough for the PR comment)
  prePatchOutput:       text('pre_patch_output'),
  postPatchOutput:      text('post_patch_output'),
  unitTestOutput:       text('unit_test_output'),
  // Lifecycle
  startedAt:            text('started_at').notNull(),
  completedAt:          text('completed_at'),
  acpSessionId:         text('acp_session_id'),               // for replay correlation
}, (t) => ({
  findingIdx: index('fix_proofs_finding_idx').on(t.findingId, t.completedAt),
}))
```

And on `findings` (additive ALTER):

```sql
ALTER TABLE findings ADD COLUMN proof_of_fix_id TEXT REFERENCES fix_proofs(id);
```

**Rationale.**
- A separate table preserves history: re-running Fix & Prove on a finding (after a patch revision) yields a new row; the old proof is auditable. A single JSON column would either lose history or grow unboundedly.
- Posture page query "count of verified fixes in last 30d" is one indexed scan: `SELECT COUNT(*) FROM fix_proofs WHERE outcome='verified-fixed' AND completed_at >= ?`.
- PR comment composition (REQ-FP-05) needs `regression_test_diff` and pre/post outputs — separate columns make the query a single row read.
- `proof_of_fix_id` denormalization avoids a join in the queue's dominant query path.

**Rejected.**
- *JSON column on `findings`.* Loses history; awkward for filtered counts.
- *Reuse `finding_branches`.* That table is one-row-per-finding (UNIQUE on `finding_id`) and is the operator-facing branch artefact; mixing triad telemetry into it would muddy the model.

---

### ADR-4 — Posture timeseries are **pre-computed snapshots refreshed at scan completion**, served from `posture_snapshots`

**Context (Q4).** `/posture` page renders four charts (severity-weighted timeseries, MTTR by severity, hotspot heatmap, regression rate). It loads frequently. Choices: on-the-fly aggregation vs pre-computed snapshots.

**Decision.** **Hybrid — pre-compute the two expensive artefacts, compute the cheap ones on demand.**

| Artefact | Source | Reasoning |
|----------|--------|-----------|
| **Severity-weighted timeseries** | `posture_snapshots` table, one row per (project, day) | Most-hit endpoint; daily granularity makes the row count linear in days × projects (~30 projects × 365 = 11k rows/year). |
| **MTTR by severity** | `mttr_by_severity_view` materialized as a regular table refreshed on scan completion | Median computation in pure SQL is multi-row + ordered; doing it on every page load is wasteful. |
| **Hotspot heatmap** | On-the-fly `GROUP BY file × author_email HAVING COUNT(DISTINCT dedup_key) >= 3` | At 10k findings the result set is bounded (<200 cells) and the index `findings(dedup_key, location_path)` makes it sub-100ms. |
| **Regression rate** | On-the-fly count over `finding_regressions` last 30d | Tiny table; trivial. |

**`posture_snapshots` table:**

```typescript
export const postureSnapshots = sqliteTable('posture_snapshots', {
  id:               text('id').primaryKey(),
  projectId:        text('project_id').notNull().references(() => projects.id),
  bucketDate:       text('bucket_date').notNull(),    // 'YYYY-MM-DD' UTC
  // Counts
  countCritical:    integer('count_critical').notNull().default(0),
  countHigh:        integer('count_high').notNull().default(0),
  countMedium:      integer('count_medium').notNull().default(0),
  countLow:         integer('count_low').notNull().default(0),
  countInfo:        integer('count_info').notNull().default(0),
  // Derived
  weightedScore:    real('weighted_score').notNull(),
    // critical*10 + high*5 + medium*2 + low*1 + info*0
  openCriticalDays: real('open_critical_days').notNull().default(0),
  // Provenance
  snapshotAt:       text('snapshot_at').notNull(),
  scanId:           text('scan_id').references(() => scans.id),
}, (t) => ({
  projectDateUq: uniqueIndex('posture_proj_date_uq').on(t.projectId, t.bucketDate),
}))
```

Refresh trigger: at the end of `lib/pipeline/runner.ts`, call `lib/posture/refresh.ts::refreshPosture(projectId, scanId)` which UPSERTs the row for `bucketDate = today`. Idempotent: multiple scans the same day overwrite each other for that day's row.

**`mttr_by_severity` (regular table, treated as a materialized view):**

```typescript
export const mttrBySeverity = sqliteTable('mttr_by_severity', {
  projectId:     text('project_id').notNull().references(() => projects.id),
  severity:      text('severity').notNull(),
  windowDays:    integer('window_days').notNull(),    // 30 | 60 | 90
  medianSeconds: real('median_seconds'),              // null when sample_size = 0
  avgSeconds:    real('avg_seconds'),
  sampleSize:    integer('sample_size').notNull(),
  refreshedAt:   text('refreshed_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.severity, t.windowDays] }),
}))
```

Refreshed by `lib/posture/mttr.ts::refreshMttr(projectId)` on scan completion AND on PR-merge webhook (when `finding_branches.merged_at` is set in v0.2/v0.4).

**Rationale.**
- Posture page hits are a hot path; sub-500ms p95 (REQ-PT-06) is achievable only with the timeseries pre-computed. SQLite is fast, but `GROUP BY date(scanned_at) WITH WINDOW SUM` over a join on 100k findings is not first-paint material.
- Hotspot and regression-rate cardinality is low; computing on demand keeps the model simple and lets us avoid invalidation logic for those two.
- "Materialized view" as a regular Drizzle table is the SQLite-idiomatic pattern (no `MATERIALIZED VIEW` syntax in SQLite). We control refresh; we own the contract.
- Failure mode when refresh is skipped: stale data on the page; a banner shows `refreshed_at` so the operator can spot it. Not data corruption.

**Rejected.**
- *Pure on-the-fly.* p95 latency on the timeseries chart blew past 500ms in our v0.3 prototype with 50k findings.
- *Pure pre-computed for everything.* Hotspot heatmap at file × author granularity has high cardinality before the COUNT >= 3 filter; pre-computing is wasted work.

---

### ADR-5 — Regression detection runs at **scan completion** as a SQL post-hook; results are persisted on the finding row and in `finding_regressions`

**Context (Q5).** When does the system declare a new finding to be a regression of a previously-merged fix? Options: at scan completion (write), at queue load (read), or both.

**Decision.** **Post-dedup hook in the scan pipeline writes both `findings.is_regression = 1` and a `finding_regressions` row.** Queue and posture both read these columns directly (no join needed).

**The detection predicate (single SQL):**

```sql
INSERT INTO finding_regressions (
  id, original_finding_id, regressed_finding_id,
  original_branch_id, regression_commit_sha, detected_at
)
SELECT
  lower(hex(randomblob(16))),
  fb.finding_id,                  -- original (the merged fix)
  f_new.id,                       -- regressed (this scan's new finding)
  fb.id,
  COALESCE(f_new.location_commit, ?) AS regression_commit_sha,
  ?                               AS detected_at
FROM findings   AS f_new
JOIN findings   AS f_orig ON f_orig.dedup_key = f_new.dedup_key
                          AND f_orig.id != f_new.id
JOIN finding_branches AS fb ON fb.finding_id = f_orig.id
                            AND fb.merged_at IS NOT NULL
WHERE f_new.scan_id = ?
  AND f_new.created_at > fb.merged_at
  AND NOT EXISTS (
    SELECT 1 FROM finding_regressions r
    WHERE r.regressed_finding_id = f_new.id
  );

UPDATE findings
SET is_regression = 1,
    status = 'regression',
    regression_of_finding_id = (
      SELECT original_finding_id FROM finding_regressions
       WHERE regressed_finding_id = findings.id
    )
WHERE scan_id = ? AND id IN (
  SELECT regressed_finding_id FROM finding_regressions
   WHERE regressed_finding_id IN (SELECT id FROM findings WHERE scan_id = ?)
);
```

This runs in `lib/dedup/post-hooks/regression-detect.ts`, invoked from `lib/pipeline/strategies/dedupe.ts` immediately after dedup writes have settled.

**Rationale.**
- Detection at scan completion (write-time) makes the queue and posture queries cheap: no join with `finding_branches`/`merged_at` for the common case.
- Lazy detection at queue-load time would re-execute the join on every render — wasteful given the result rarely changes between scans.
- Persisting `is_regression` lets the `REGRESSION` band in `lib/repos/queue.repo.ts` be a simple `WHERE` filter, and lets the posture regression-rate query be `SELECT COUNT(*) FROM findings WHERE is_regression=1 AND created_at >= ?`.
- The `NOT EXISTS` guard makes the operation idempotent — re-running the post-hook on the same scan is a no-op.

**Notification (REQ-RT-06):** after the post-hook commits, `lib/notifications/desktop.ts::notifyRegressionsBatch(scanId)` fires **exactly once** per scan with the count. The dispatcher writes a row to a small `notifications_dispatched(scan_id, kind)` table to enforce idempotency on retry.

**Rejected.**
- *Lazy queue-load detection.* Every page hit re-evaluates the join.
- *Both write- and read-time.* Redundant; complicates invariant.

---

### ADR-6 — `finding_dismissal_history` is **append-only**; appeals are recorded on `finding_dismissals.appealed_at`, not by deletion

**Context.** REQ-FB-04 demands an immutable audit log; REQ-FB-05 demands appeal/un-dismiss; v0.1 already uses `undone_at` on `finding_dismissals` for the basic re-open path.

**Decision.** Two-row update per appeal:
1. `UPDATE finding_dismissals SET appealed_at = NOW(), appeal_reason = ?, appeal_author = ?, undone_at = NOW()` — atomic.
2. `INSERT INTO finding_dismissal_history (action='appealed', actor, rationale_snapshot, ts, dismissal_id, source)`.

`finding_dismissals` rows are **never deleted**. `finding_dismissal_history` rows are **never updated nor deleted** — append-only by convention; enforced by a `BEFORE UPDATE` and `BEFORE DELETE` trigger that issues `RAISE(ABORT, ...)`.

**Schema:**

```typescript
export const findingDismissalHistory = sqliteTable('finding_dismissal_history', {
  id:                 text('id').primaryKey(),
  dismissalId:        text('dismissal_id').notNull().references(() => findingDismissals.id),
  action:             text('action').notNull(),
    // 'created' | 'edited' | 'appealed' | 're-dismissed'
  actor:              text('actor').notNull(),
  rationaleSnapshot:  text('rationale_snapshot').notNull(),  // value at the moment of action
  source:             text('source').notNull(),
    // 'hand' | 'agent-assisted'
  ts:                 text('ts').notNull(),
}, (t) => ({
  dismissalIdx: index('fdh_dismissal_idx').on(t.dismissalId, t.ts),
}))
```

**Re-dismissal after appeal:** clears `appealed_at`/`undone_at` to `NULL`, sets a new `dismissed_at`, appends `action='re-dismissed'` to history.

**Rationale.**
- `undone_at` from v0.1 already encodes the suppression-active-or-not state. Adding `appealed_at` separately preserves the v0.1 contract while distinguishing "operator soft-deleted" from "operator appealed via the new flow" for analytics.
- Append-only history makes "who marked this an FP and why" reconstructible long after the dismissal record has been edited.
- Triggers, not application code, enforce immutability — the contract holds even if a future migration tries to UPDATE.

---

### ADR-7 — SQLite has no `MEDIAN`; we use the **`row_number()` window function** for an exact median, with a `n < 5` low-confidence flag

**Context.** REQ-MT-01 demands median MTTR. SQLite (≥3.25) has window functions but no `MEDIAN`/`PERCENTILE_CONT`.

**Decision.** Compute median in two CTEs using `row_number()`:

```sql
WITH durations AS (
  SELECT
    f.severity,
    CAST(
      (julianday(fb.merged_at) - julianday(f.first_detected_at)) * 86400
      AS INTEGER
    ) AS dur_seconds
  FROM findings f
  JOIN finding_branches fb ON fb.finding_id = f.id
  WHERE fb.merged_at IS NOT NULL
    AND fb.merged_at >= ?           -- window start
    AND f.scan_id IN (SELECT id FROM scans WHERE project_id = ?)
),
ranked AS (
  SELECT
    severity,
    dur_seconds,
    row_number() OVER (PARTITION BY severity ORDER BY dur_seconds) AS rn,
    count(*)    OVER (PARTITION BY severity) AS n
  FROM durations
)
SELECT
  severity,
  AVG(CASE WHEN rn IN ((n+1)/2, (n+2)/2) THEN dur_seconds END) AS median_seconds,
  AVG(dur_seconds) AS avg_seconds,
  MAX(n)           AS sample_size
FROM ranked
GROUP BY severity;
```

The `(n+1)/2, (n+2)/2` trick handles odd and even sizes uniformly. Result rows where `sample_size < 5` are returned but the API marks them with `low_confidence = true` (REQ-MT-04). The page renders an annotation rather than hiding the value.

**Rationale.**
- Exact median over the full window is preferable to percentile approximation here — sample sizes are typically <500 per severity per window. The query is O(N log N) on the duration column; trivial at this scale.
- We refresh into `mttr_by_severity` at scan completion and on merge events; UI never runs this query directly.

---

### ADR-8 — Status enum widening uses **string check, no DB-level constraint**, validated at the repository boundary

**Context.** The spec adds `verified-fixed`, `fix-unverified`, `regression` to `findings.status` while preserving `open`, `fixed`, `dismissed` rows.

**Decision.** No SQLite `CHECK` constraint. The Drizzle layer in `lib/repos/findings.repo.ts` exports a `FindingStatus` Zod enum:

```typescript
export const findingStatusSchema = z.enum([
  'open', 'fixed', 'dismissed',
  'verified-fixed', 'fix-unverified', 'regression',
])
export type FindingStatus = z.infer<typeof findingStatusSchema>
```

All writes go through `updateFindingStatus(id, status)` which validates with the schema. Reads parse the column with `.parse()` to crash early on garbage.

**Rationale.**
- SQLite `ALTER TABLE … ADD CONSTRAINT` is not supported; rebuilding the table to add a CHECK is too invasive for a v0.4 additive milestone.
- Zod validation at the repository boundary is the existing convention (see v0.1 spec.md REQ-…) and gives clear errors at the API layer.
- Migration script does **NOT** auto-promote `merged_at IS NOT NULL` rows from `fixed` to `verified-fixed` — promotion requires a triad run. Existing rows remain `fixed` (legacy) and the operator can opt to re-run Fix & Prove on them.

---

## 2. Component Map and Data Flow

### 2.1 Component layering

```
app/
├── posture/
│   └── page.tsx                     ← PosturePage (RSC; data via repos)
├── findings/
│   ├── fp-bank/page.tsx             ← FpBankPage (FTS5 search, paginated)
│   └── [id]/
│       ├── page.tsx                 ← existing finding detail
│       │                              now displays <ProofOfFixBadge/>
│       ├── verify/page.tsx          ← Fix & Prove trigger + live status
│       └── regression/page.tsx      ← regression lineage view
├── api/
│   ├── findings/
│   │   ├── [id]/verify/route.ts     ← POST: trigger Fix & Prove
│   │   ├── [id]/dismiss/route.ts    ← POST/DELETE: dismiss + appeal
│   │   ├── fp-bank/route.ts         ← GET: paginated FTS5 search
│   │   └── fp-bank/export/route.ts  ← GET: SARIF suppression export
│   ├── posture/
│   │   ├── route.ts                 ← GET: timeseries + summary
│   │   ├── mttr/route.ts            ← GET: MTTR by severity
│   │   └── hotspots/route.ts        ← GET: file × author heatmap
│   └── dismissals/
│       ├── [id]/appeal/route.ts     ← POST: appeal a dismissal
│       └── [id]/draft/route.ts      ← POST: agent-assisted rationale draft

components/
├── posture/
│   ├── WeightedTimeseriesChart.tsx  ← hand-rolled SVG line chart
│   ├── HotspotHeatmap.tsx           ← grid; cells colored by repeat density
│   ├── MttrCards.tsx                ← three cards (30/60/90d)
│   └── RegressionRateBadge.tsx
├── findings/
│   ├── ProofOfFixBadge.tsx          ← triad result; pre/post output toggles
│   ├── RegressionBadge.tsx          ← in queue + on detail page
│   └── DualDiffViewer.tsx           ← fix diff vs regression test diff

lib/
├── remediation/
│   └── fix-and-prove/
│       ├── triad-runner.ts          ← top-level orchestrator
│       ├── worktree.ts              ← git worktree add/remove + apply/-R
│       ├── regression-author.ts     ← inline ACP turn that writes the test
│       ├── pr-comment.ts            ← REQ-FP-05 dual-diff template
│       └── outcomes.ts              ← outcome state machine (verified/unverified)
├── dedup/
│   └── post-hooks/
│       └── regression-detect.ts     ← ADR-5 SQL
├── posture/
│   ├── refresh.ts                   ← UPSERT into posture_snapshots
│   ├── mttr.ts                      ← refreshMttr(projectId) (ADR-7)
│   ├── hotspots.ts                  ← on-the-fly query
│   └── timeseries.ts                ← read posture_snapshots
├── dismissals/
│   ├── repo.ts                      ← dismiss/appeal/draft writes (audit-aware)
│   ├── search.ts                    ← FTS5 query builder
│   └── sarif.ts                     ← REQ-FB-06 export/import
└── notifications/
    └── desktop.ts                   ← REQ-RT-06 batched once-per-scan
```

### 2.2 Fix & Prove sequence (full)

```
[POST /api/findings/{id}/verify]
        │
        ▼
triadRunner(findingId)
        │
        ├─ guard: finding.patch_diff != null
        │     └─ if null → fix_proofs row outcome='fix-unverified'
        │                  failure_reason='no-patch'  (REQ-FP-07)
        │
        ├─ insert fix_proofs row, outcome='in-progress', startedAt=now
        ├─ findings.proof_of_fix_id = newRow.id
        │
        ├─ worktree.create(scanCommit) → proofs/{findingId}/
        ├─ host: git apply patch_diff
        │
        ├─ ACP session: open(provider=fix-and-prove, cwd=proofs/{findingId})
        │     │
        │     ├─ Turn-2: prompt "run {project.test_command} and report pass/fail"
        │     │            → unitTestPassed
        │     │            on baseline-red: outcome='fix-unverified'
        │     │                              reason='unit-test-baseline-red'
        │     │            short-circuit cleanup + return
        │     │
        │     ├─ Turn-3: prompt with finding.description + patch_diff +
        │     │           project test layout heuristics
        │     │            → file written at <regression_test_path>
        │     │            → emit RegressionTestAuthoredEvent
        │     │
        │     │── (host) git apply -R patch_diff           ── pre-patch state
        │     │── (host) exec {test_command} -- {regression_test_path}
        │     │            → vulRunPassedPre
        │     │            emit VulRunResultEvent(phase='pre')
        │     │            if pre passed → outcome='fix-unverified'
        │     │                            reason='regression-test-invalid'
        │     │                            short-circuit
        │     │── (host) git apply patch_diff              ── back to patched
        │     │
        │     ├─ Turn-4: prompt "run {test_command}; report pass/fail.
        │     │           Then run only {regression_test_path}; report pass/fail."
        │     │            → unitTestPassed (re-confirm), vulRunPassedPost
        │     │            emit VulRunResultEvent(phase='post')
        │     │
        │     └─ session close
        │
        ├─ outcomes.computeOutcome(triad signals)
        │     │
        │     │ verified-fixed iff
        │     │     unitTestPassed && !vulRunPassedPre && vulRunPassedPost
        │     │
        │     └─ persist into fix_proofs:
        │           outcome, failureReason, completedAt
        │
        ├─ findings.status = outcome (REQ-FP-04)
        │
        ├─ worktree.remove()                ← always; even on error
        │
        └─ pr-comment.compose(proofId)
                ↳ posts dual-diff comment to existing PR (v0.2 PR posting)
```

The runner is **not** an HTTP-blocking call: `POST /api/findings/{id}/verify` returns `202 Accepted` with a `proofId`, and the UI subscribes via SWR polling on `GET /api/findings/{id}/proof?id=…` (same SWR pattern as v0.1 ADR-4 branch polling). Live triad events flow through the existing `scan_events` SSE for the scan that owns the finding.

### 2.3 Regression detection data flow

```
scan completes (stage=done in lib/pipeline/runner.ts)
        │
        ▼
dedupe.ts (existing v0.1)
        │
        ▼
post-hooks/regression-detect.ts          ← NEW (ADR-5)
        │
        ├─ INSERT INTO finding_regressions … (idempotent)
        ├─ UPDATE findings SET is_regression=1, status='regression', …
        └─ emit RegressionDetectedEvent for each new row
        │
        ▼
posture/refresh.ts                        ← NEW
        │
        ├─ UPSERT posture_snapshots[today]
        └─ refreshMttr(projectId)
        │
        ▼
notifications/desktop.ts                  ← NEW (REQ-RT-06)
        │
        └─ if count > 0: ONE notification: "N regressions detected — see queue"
```

---

## 3. Database Schema (additive only)

### 3.1 Drizzle additions

```typescript
// ─── fix_proofs (NEW; ADR-3) ─────────────────────────────────
export const fixProofs = sqliteTable('fix_proofs', { /* see ADR-3 */ })

// ─── posture_snapshots (NEW; ADR-4) ──────────────────────────
export const postureSnapshots = sqliteTable('posture_snapshots', { /* see ADR-4 */ })

// ─── mttr_by_severity (NEW; ADR-4) ───────────────────────────
export const mttrBySeverity = sqliteTable('mttr_by_severity', { /* see ADR-4 */ })

// ─── finding_regressions (NEW; ADR-5) ────────────────────────
export const findingRegressions = sqliteTable('finding_regressions', {
  id:                    text('id').primaryKey(),
  originalFindingId:     text('original_finding_id').notNull().references(() => findings.id),
  regressedFindingId:    text('regressed_finding_id').notNull().references(() => findings.id),
  originalBranchId:      text('original_branch_id').references(() => findingBranches.id),
  regressionCommitSha:   text('regression_commit_sha'),
  detectedAt:            text('detected_at').notNull(),
}, (t) => ({
  regressedUq: uniqueIndex('finding_regressions_regressed_uq').on(t.regressedFindingId),
  originalIdx: index('finding_regressions_original_idx').on(t.originalFindingId),
}))

// ─── finding_dismissal_history (NEW; ADR-6) ──────────────────
export const findingDismissalHistory = sqliteTable('finding_dismissal_history', { /* see ADR-6 */ })

// ─── notifications_dispatched (NEW; ADR-5) ───────────────────
export const notificationsDispatched = sqliteTable('notifications_dispatched', {
  scanId: text('scan_id').notNull().references(() => scans.id),
  kind:   text('kind').notNull(),    // 'regression-batch'
  ts:     text('ts').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.scanId, t.kind] }),
}))
```

### 3.2 ALTERs

```sql
-- findings: triad pointer + regression flags + status enum widened (validated in app)
ALTER TABLE findings ADD COLUMN proof_of_fix_id TEXT REFERENCES fix_proofs(id);
ALTER TABLE findings ADD COLUMN is_regression INTEGER NOT NULL DEFAULT 0;
ALTER TABLE findings ADD COLUMN regression_of_finding_id TEXT REFERENCES findings(id);
ALTER TABLE findings ADD COLUMN status TEXT;             -- if not present from prior milestone
                                                          -- new values validated in repo layer
CREATE INDEX IF NOT EXISTS findings_is_regression_idx
  ON findings(is_regression) WHERE is_regression = 1;

-- finding_branches: merged_at (used by regression detection + MTTR)
ALTER TABLE finding_branches ADD COLUMN merged_at TEXT;
CREATE INDEX IF NOT EXISTS finding_branches_merged_idx
  ON finding_branches(merged_at) WHERE merged_at IS NOT NULL;

-- finding_branches: triad-aware states (validated in repo layer; no CHECK)
-- New status values: 'proving' | 'proof_passed' | 'proof_failed'

-- finding_dismissals: appeal columns
ALTER TABLE finding_dismissals ADD COLUMN appealed_at   TEXT;
ALTER TABLE finding_dismissals ADD COLUMN appeal_reason TEXT;
ALTER TABLE finding_dismissals ADD COLUMN appeal_author TEXT;
```

### 3.3 Triggers

```sql
-- Append-only audit log (ADR-6)
CREATE TRIGGER IF NOT EXISTS fdh_no_update
BEFORE UPDATE ON finding_dismissal_history
BEGIN SELECT RAISE(ABORT, 'finding_dismissal_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS fdh_no_delete
BEFORE DELETE ON finding_dismissal_history
BEGIN SELECT RAISE(ABORT, 'finding_dismissal_history is append-only'); END;
```

### 3.4 Migration ordering

The single migration file is `drizzle/0010_v04_prove_and_measure.sql` (after v0.1's 0007, v0.2's 0008, v0.3's 0009). All operations are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Running `lib/db/migrate.ts` on an existing v0.3 DB succeeds without backfill.

**No backfill of triad data** — existing `merged_at IS NOT NULL` findings keep `status='fixed'`; only triad-run rows become `verified-fixed`.

---

## 4. API Design

All routes return the project envelope `{ success, data?, error? }` from `lib/api/envelope.ts`. All inputs validated with Zod at the boundary.

### 4.1 Fix & Prove

```
POST /api/findings/{id}/verify        202 Accepted
  → { proofId, status: 'in-progress' }
  triggers triadRunner(id) on a setImmediate; returns immediately.

GET  /api/findings/{id}/proof         200 OK
  → fix_proofs latest row + projected outcome state
  used by SWR poll while in-progress.
```

### 4.2 Posture

```
GET /api/posture?repo={projectId}&range={7d|30d|60d|90d|all}
  → {
      timeseries: [{ date, weightedScore, countCritical, ... }],
      regressionRate: { rate30d: number, count30d: number, totalFixes30d: number },
      openCriticalDays: number,
      refreshedAt: ISO,
    }

GET /api/posture/mttr?repo={projectId}&severity={critical|...}
  → {
      windows: [
        { window: '30d', medianSeconds, avgSeconds, sampleSize, lowConfidence },
        { window: '60d', ... },
        { window: '90d', ... },
      ],
      refreshedAt: ISO,
    }

GET /api/posture/hotspots?repo={projectId}&limit=200
  → {
      cells: [{ filePath, authorEmail, distinctDedupKeys, repeatOffender }],
    }
```

### 4.3 FP Bank

```
GET    /api/findings/fp-bank?q={fts}&cursor={…}&limit=50
  → paginated list, FTS5 ranked
GET    /api/findings/fp-bank/export
  → SARIF suppression document (REQ-FB-06)
POST   /api/findings/fp-bank/import          // future v0.4.x — schema reserved
DELETE /api/findings/{id}/dismiss            // appeal (REQ-FB-05)
POST   /api/findings/{id}/dismiss            // create dismissal (existing, augmented for audit)
POST   /api/dismissals/{id}/appeal           // explicit appeal endpoint (with appealReason)
POST   /api/dismissals/{id}/draft            // agent-assisted rationale draft (REQ-FB-07)
GET    /api/dismissals/search?q=…            // alias for /api/findings/fp-bank
```

The agent-assisted draft endpoint:
- Returns `{ draft, draftId, draftedAt }`.
- The page renders the draft into a textarea but **disables the submit button for 5 seconds** (REQ-FB-07). Server enforces `draftedAt + 5s < now()` on submit; rejects with `400 cooldown-not-elapsed`.
- The dismissal write records `source = 'agent-assisted'` in history.

---

## 5. PR Comment Template (REQ-FP-05)

The template `lib/remediation/fix-and-prove/pr-comment.ts` produces a single comment posted via the v0.2 GitHub PR poster. Skeleton:

```markdown
## ✅ Verified Fix — proof of repair

This patch was validated by the **PatchEval triad** in open-security:

| Step | Result |
|------|--------|
| Unit test suite (post-patch) | {{✅ pass | ❌ fail}} |
| Regression test FAILS pre-patch | {{✅ confirmed | ❌ test was already passing}} |
| Regression test PASSES post-patch | {{✅ confirmed | ❌ vuln still triggers}} |

### Fix diff
```diff
{{patch_diff}}
```

### Regression test
File: `{{regression_test_path}}`
```diff
{{regression_test_diff}}
```

<details>
<summary>Pre-patch run output</summary>
<pre>{{pre_patch_output}}</pre>
</details>
<details>
<summary>Post-patch run output</summary>
<pre>{{post_patch_output}}</pre>
</details>
```

When `outcome='fix-unverified'` the header reads `## ⚠ Unverified Fix — proof of repair failed` and the table lists the failure reason; PR is still posted but the operator sees the warning.

---

## 6. Resolution of Spec-Deferred Questions

| # | Spec Q | Resolution |
|---|--------|------------|
| Q1 | Regression test placement convention | Heuristics in `regression-author.ts`: detect `tests/`, `__tests__/`, `test/` siblings of the vulnerable file; if multiple, pick the one matching the file's directory; if none, create `<dir>/__regression__/<basename>.regression.test.ts`. Agent receives this hint in the Turn-3 prompt; final placement is the agent's call but it is required to write the file path back so we can find it. |
| Q2 | Worktree lifecycle | Per-finding ephemeral worktree (ADR-2). No pool. |
| Q6 | Notification batching window | One notification **per scan completion event**, not per regression. The window is the scan; no time-based debounce. |
| Q8 | Agent draft prompt context scope | Finding title, description, patch_diff, location_path, top 5 most-similar past dismissals (FTS5 lookup on title+location). No source-file contents — keeps the prompt small and the cost predictable. |

---

## 7. Architectural Risks & Assumptions

### Risks

1. **Test-suite cost.** Some projects' test suites take >5 minutes. The triad runs the suite at least twice (Turn-2 baseline + Turn-4 post-patch) plus the regression-only run, so worst-case >10 minutes per finding. Mitigation: surface a per-project timeout (`project.test_timeout_seconds`, default 600) and fail-fast with `failure_reason='timeout'`. Document the cost in the verify UI.
2. **Regression test author quality.** The agent might write a test that fails for unrelated reasons (compilation error, missing import). The triad's pre-patch FAIL gate catches "test always fails" but not "test fails for wrong reason". Mitigation: capture the pre-patch error message and surface it in the proof; future v0.5 can add a stronger oracle.
3. **`merged_at` source of truth.** v0.4 detection assumes `merged_at` is populated by v0.2 PR-merge webhook. If v0.2 never merged or webhook is misconfigured, no regressions are ever detected. Mitigation: a backfill `bin/backfill-merged-at.ts` script populates `merged_at` from `git log --merges` on the project source tree as a one-shot remediation tool.
4. **Hotspot heatmap cardinality.** A repo with 5k contributors and 2k files has 10M cells before the COUNT >= 3 filter. The filter pushes that down to <200 in practice, but the GROUP BY still has to scan. Mitigation: index `findings(location_path, dedup_key)`; cap the result set at 500 cells and log a warning if hit.
5. **Status enum drift.** No DB-level CHECK means a buggy migration could write garbage. Mitigation: every read goes through Zod; an integrity script `lib/db/integrity.ts` runs at boot and ABORTs if it sees out-of-band values.
6. **ACP session leak under crash.** If the Node process dies mid-triad, the ACP session is orphaned and the worktree remains. Mitigation: boot-time prune (`git worktree prune` + a sweep over `fix_proofs` rows whose `outcome='in-progress'` older than 1h → mark `outcome='fix-unverified'` with `failure_reason='agent-error'`).

### Assumptions

- **A1.** v0.1 has shipped: `dedup_key`, `finding_branches`, `finding_dismissals`, `fp_bank_fts`. v0.4 schema is an additive delta only.
- **A2.** v0.2 has shipped a working PR-comment poster that exposes `postPrComment(prUrl, body)`. The PR is created by v0.1's branch flow and `finding_branches.pr_url` is populated.
- **A3.** v0.3 has shipped the ACP transport with `terminal-handler.ts` and `file-system-handler.ts`. The Fix & Prove session reuses this without modification.
- **A4.** Operators run scans roughly daily; `posture_snapshots` has at most one row per project per day. Backfilling history is out of scope.
- **A5.** The `project.test_command` is configured before triggering Fix & Prove. UI gates the button on `tests_enabled = 1` (v0.1 ADR-3) and surfaces an inline tip when off.

### Unresolved (defer to tasks/apply if it bites)

- **U1.** Multi-language test runner heuristics for Q1 placement — current plan covers JS/TS/Python; Go and Rust may need separate logic. Escalate during apply if a real fixture fails.
- **U2.** SARIF suppression import (REQ-FB-06 import direction) — schema reserved, full implementation may slip to v0.4.x if too large.

---

## 8. Out-of-Scope (explicit)

- **Backfill verified-fixed status** for legacy `merged_at IS NOT NULL` findings. Operators may re-run Fix & Prove manually.
- **Fuzzy regression detection** beyond `dedup_key`. Title drift across LLM rephrasing is accepted as v0.1 noise (per v0.1 ADR-2).
- **Charting library.** Hand-rolled SVG charts; no chart.js / recharts. Keeps bundle small and matches existing UI primitives.
- **Concurrency on `fix_proofs`.** One triad per finding at a time. A second `POST /verify` while one is in-flight returns `409 conflict-in-progress`.
- **Cross-project posture rollup.** v0.4 scopes posture to a single project page. Multi-project dashboard deferred to v1.0.
