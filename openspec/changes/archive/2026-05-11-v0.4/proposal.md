# v0.4 — Fix & Prove + Posture Trends + MTTR + Regression Tracker + FP Bank

> Phase: Measure (Phase 4 of the Investigate → Remediate → Prevent → Measure arc)
> Effort: ~3 weeks (solo)
> Depends on: v0.1 (queue, branch-per-finding, dedup, EPSS/KEV, FP bank schema), v0.2 (Diff Mode, Watch Mode, SARIF, webhooks), v0.3 (CVE Hunter, Investigation Console, Playbooks, Secret Timeline)
> Status: Proposal

---

## 1. Intent

### Problem

After v0.1–v0.3 the workbench can prioritize, investigate, hunt CVEs, branch-per-finding, and post Diff Mode comments at PR time. What it **cannot** do is close the loop with evidence:

1. **A patch is not a fix.** Today v0.1's `branch-remediation` runs the test suite and surfaces pass/fail, but it does **not** write a regression test for the specific vuln, does **not** prove the vulnerability path is gone, and does **not** post both diffs (fix + test) to the PR. The operator still has to manually verify "is this actually fixed, or did we just make the scanner shut up?" That is the gap PatchEval calls out: shipping patches that mute symptoms while the vulnerable behavior survives.
2. **Marking a finding as a false positive is a one-shot decision with no audit trail.** v0.1 added the `finding_dismissals` schema (`dedup_key`, `reason`, `author`, `dismissed_at`) and suppresses by `dedup_key` at query time. It does **not** ship the auditable rationale UI, search across the FP corpus, the "appeal a dismissal" path, or the agent-assisted FP triage with written justification. The schema exists; the workflow does not.
3. **Nobody can answer "are we getting safer?"** v0.1–v0.3 created data — `finding_branches.merged_at`, `findings.created_at`, `commits` + `authors`, the `dedup_key` chain — but there is no surface that turns it into severity-weighted finding count over time, MTTR per severity, open critical days, or hotspot heatmaps. The data is there. The query and the chart are not.
4. **A vuln that comes back is invisible.** When a finding with `merged_at != null` reappears in a later scan with the same `dedup_key`, today it is silently re-deduped into the existing row. There is no "this is a regression" signal — no separate severity band in the queue, no notification, no audit. The most operationally important finding (a fix that did not stick) is the one we surface least.

### Why now

v0.1–v0.3 produced **the data**. v0.4 produces **the proof and the trend lines**. Without proof, every fix is a "trust me" diff. Without trend lines, the workbench has no answer to the only question that matters at quarterly review: *did we get better?* The math is pure SQL on tables already populated. Fix & Prove reuses the existing branch-remediation runner, the v0.3 ACP transport for regression test authoring, and the v0.2 PR-comment infrastructure for posting the dual diff. The Regression Tracker is a single SQL predicate (`dedup_key was once merged AND reappears`). MTTR is a `merged_at - created_at` aggregation.

This is **assembly not invention**. It is also the milestone where the workbench stops being a research demo and starts producing evidence a security engineering manager can take to a steering committee.

### Success looks like

- An operator approves a fix branch on a SQLi finding. The agent applies the patch, runs the project test suite — green. It then writes a regression test that hits the original vulnerable code path with a malicious payload, runs it against the **pre-patch** commit (red), runs it against the **post-patch** commit (green). It posts a single PR with two diffs clearly separated: `fix.diff` + `regression_test.diff`. The PR comment includes the full pre/post test output. The operator merges with one click. The finding row gains `regression_test_path`, `vul_run_passed_pre=false`, `vul_run_passed_post=true`, `unit_test_passed=true`. **Only when all three are green does the finding move to `status=verified-fixed`.**
- The operator opens `/findings`, finds a noisy ESLint-style semgrep finding, clicks "Mark FP", types *"This is a logging-only path; the `eval` here takes a constant string from a config file checked into the repo, never user input."* The rationale is persisted, indexed (FTS5), and surfaced when any future scan produces a finding with the same `dedup_key`. Three months later, a new operator searches "eval config" in the FP bank and finds the rationale with the original author's name. They can reopen the dismissal if they disagree, with their own counter-rationale.
- The operator opens `/posture`. They see four charts: severity-weighted open finding count over the last 90 days (line chart per severity), MTTR per severity (last 30/60/90 day windows), open critical days (count of currently open criticals × hours since `created_at`), and a hotspot heatmap (files × authors with finding counts and "repeat offender" flags). Each chart is filterable by repo. Pure SQL, no aggregation pipeline.
- A finding that was merged 14 days ago reappears in today's scan. It does **not** silently dedupe. It surfaces in the queue with a distinct **REGRESSION** band (above HIGH, below CRITICAL by default — operator-tunable), shows a "previously fixed in PR #214 by @carlos on 2026-04-22, regressed in commit `a7b3c4d` on 2026-05-04" lineage, and triggers a desktop notification on the next scan completion. The operator can click "regression diff" to see exactly what changed between the merged fix commit and the regressing commit on the affected files.

---

## 2. Scope

### In scope

| Capability | Effort | What ships |
|---|---|---|
| **Fix & Prove (PatchEval triad)** | L | Extend v0.1's branch-remediation runner to implement the `fix-run.sh / vul-run.sh / unit_test.sh` triad. After `git apply` of `patch_diff`: (1) run project test suite (`unit_test.sh` analogue) — must pass post-fix. (2) Generate a regression test via ACP — agent receives the vuln location, taint path, and a "write a failing test that hits this code path with the original exploit pattern" prompt. (3) Run the regression test against the pre-patch commit (`vul-run.sh` analogue) — must FAIL. (4) Run it against the post-patch commit — must PASS. Only on (1) green + (3) red + (4) green does the finding move to `status=verified-fixed`. PR comment posts both diffs (fix + regression test) with the full pre/post output appended. |
| **False-Positive Bank — full UI + rationale audit trail** | M | Promote v0.1's `finding_dismissals` schema from a back-end dedupe filter to a first-class auditable surface. New `/dismissed` page (rename / replace v0.1 stub): full-text search (FTS5) over `reason`, filter by author / date / dedup_key / rule, "appeal" path that surfaces the dismissal in the queue again with a counter-rationale, agent-assisted triage that pre-fills a draft rationale from the finding's snippet + taint analysis (operator edits and confirms — never auto-dismiss). Every dismissal write/appeal/edit appends a row to a new `finding_dismissal_history` audit table. |
| **Posture dashboard (`/posture`)** | M | The single dashboard the product needs. Four charts on one page: (a) **Severity-weighted finding count** over time, line chart per severity, x-axis is `scans.created_at` bucketed by day; (b) **MTTR per severity**, last 30/60/90 day windows, computed as `avg(merged_at - created_at)` over `finding_branches` rows where `merged_at IS NOT NULL`; (c) **Open critical days**, `sum(now() - created_at)` over open criticals, with a per-finding breakdown table; (d) **Hotspot heatmap**, `files × authors` joined through `commits` + `findings`, "repeat offender" flag where `count(distinct dedup_key) >= 3`. All four are pure SQL views; all four are repo-filterable. |
| **Regression Tracker** | M | New `regression-detection` capability. On every scan-finalization step, after dedup runs: for each finding whose `dedup_key` appears in `finding_branches` with `merged_at IS NOT NULL` AND the finding's `created_at > merged_at` (i.e., reappeared after a verified merge), insert a row in a new `finding_regressions` table linking the original merged finding, the regressed finding, the merging commit, the regressing commit (best-effort: most recent commit touching the affected file), and the regression timestamp. Surface in the queue as a distinct severity band labeled `REGRESSION` (rendered above HIGH by default; operator-tunable per repo via existing settings). Trigger a desktop notification on scan completion if any new regressions were detected (reuses v0.2 Watch Mode notification path). New `/findings/[id]/regression` view shows the lineage (original merged PR, regressing commit, "what changed" file diff between the merged-fix commit and the regressing commit on the affected paths). |
| **MTTR computation + per-severity / per-repo / global views** | S | Pure SQL. View `mttr_by_severity` joins `findings` + `finding_branches` filtered by `merged_at IS NOT NULL`, computed over rolling 30/60/90 day windows. Per-repo and global rollups exposed via `/posture` and via API (`/api/posture/mttr`). Cached as a materialized view (refresh on scan completion) for snappy chart loads. |
| **Schema extensions** | S | New tables: `finding_dismissal_history` (id, dismissal_id, action, actor, rationale, ts), `finding_regressions` (id, original_finding_id, regressed_finding_id, original_branch_id, regression_commit_sha, detected_at). Extend `findings` with `status` enum widened to include `verified-fixed` and `regression`, plus `regression_test_path`, `vul_run_passed_pre`, `vul_run_passed_post`, `unit_test_passed`. Extend `finding_dismissals` with `appealed_at`, `appeal_reason`, `appeal_author`. New materialized view `mttr_by_severity_view`. |

### Explicitly out of scope

- **Cross-scanner consensus voting** — listed in PRODUCT.md Phase 1, deferred from v0.3, **still deferred**. v0.4 is Measure-phase; consensus is an Investigate-phase enrichment. Moves to a future v0.5 or v1.0 milestone.
- **Auto-dismiss on agent confidence alone** — the FP bank's agent-assisted triage **drafts** a rationale; the operator must confirm. Auto-dismissal of agent-judged FPs is permanently out (PRODUCT.md states every finding ends in a concrete operator action).
- **Predictive MTTR / "when will this be fixed" ML** — descriptive analytics only. No forecasting, no anomaly detection, no model training.
- **Hotspot heatmap as an action surface** — heatmap surfaces *information* (files/authors with repeat findings). Routing rules ("auto-assign findings in `payments/` to @alice") are part of v1.0 Smart Ignore / Policies and v1.0 Collaboration.
- **Regression auto-fix** — when a regression is detected, we surface it; we do **not** auto-create a fix branch. The original fix's `patch_diff` may be stale; the operator decides whether to re-apply, modify, or escalate. v1.0+ may add "re-apply original fix" as one-click action.
- **MTTR SLAs / alerting** — we compute and chart MTTR. We do not page on-call when MTTR exceeds a threshold. SLA logic + integrations are v1.0.
- **Posture export to PDF / PNG / SARIF** — `/posture` is a live UI. SARIF is for findings, not trends; PDF export of charts is v1.0 ecosystem polish.
- **Regression test framework auto-detection beyond what's already in `lib/test-runners/`** — Fix & Prove uses the project's existing test command (configured per project or detected via `package.json` script). If no test runner is configured, Fix & Prove degrades to "patch applied, no proof" status — operator sees the gap.
- **Multi-tenant audit boundaries on the FP bank** — the FP bank is per-installation, same as v0.1. Org/team boundaries are v1.0.
- **Comparing `dedup_key` across forks of the same repo** — regression detection is per-`(repo, dedup_key)`. A finding "regressing" because someone else's fork drifted is not a regression in our model.

---

## 3. Capabilities

> Contract with sdd-spec. Researched against existing `openspec/specs/` (orchestrated-scan, scan-pipeline, rich-event-taxonomy, ui-components, scan-schema, branch-remediation, false-positive-bank, findings-dedup, project-intelligence).

### New Capabilities

- `fix-and-prove`: PatchEval triad (`unit_test.sh` + `vul-run.sh` + regression test diff) layered on top of v0.1's branch-remediation. Verified-fixed status only when all three signals are green. ACP-driven regression test authoring. Dual-diff PR comment via v0.2 PR comment infrastructure.
- `posture-dashboard`: single `/posture` page rendering severity-weighted finding count, MTTR per severity, open critical days, and hotspot heatmap. All pure SQL. All repo-filterable.
- `regression-detection`: dedup-aware regression detector. New `finding_regressions` table. New `REGRESSION` severity band in the queue. Lineage view at `/findings/[id]/regression`. Desktop notification reusing v0.2 Watch Mode.
- `mttr-analytics`: `mttr_by_severity_view` materialized view. Per-severity, per-repo, global rollups over rolling 30/60/90d windows. API endpoint `/api/posture/mttr`.
- `fp-bank-audit`: full FP bank UI. FTS5 search on rationale. Appeal path. `finding_dismissal_history` audit trail. Agent-assisted draft rationale (operator confirms).

### Modified Capabilities

- `branch-remediation` (v0.1): the runner now produces three signals, not one. `tests_passed` becomes `unit_test_passed`. New columns on `finding_branches` for the regression test path and pre/post results. The PR creation step posts the dual diff. Verified-fixed gating logic is enforced in the repo layer.
- `false-positive-bank` (v0.1, schema-only): full workflow ships in v0.4. Schema is additive (new audit table + appeal columns). Existing dismissals are preserved without backfill — `finding_dismissal_history` is only populated forward.
- `findings-dedup` (v0.1): unchanged at the dedup-key level. **Modified at the post-dedup hook**: after dedup resolves a finding to its canonical row, regression-detection runs and may flag the finding. The dedup contract itself (one row per `dedup_key`) does not change — regression rows live in a separate table linking two findings.
- `scan-schema`: new tables (`finding_dismissal_history`, `finding_regressions`); new columns on `findings` (`status` enum widened, `regression_test_path`, `vul_run_passed_pre`, `vul_run_passed_post`, `unit_test_passed`); new columns on `finding_dismissals` (`appealed_at`, `appeal_reason`, `appeal_author`); new materialized view `mttr_by_severity_view`.
- `ui-components`: new `/posture` route; new `/findings/[id]/regression` route; rebuilt `/dismissed` page; queue gains `REGRESSION` severity band; finding detail gains a "Verification" panel showing the triad results.
- `rich-event-taxonomy`: new event types `RegressionTestAuthoredEvent`, `VulRunResultEvent`, `RegressionDetectedEvent`, `DismissalAppealedEvent`. Persisted in `scan_events` so replay stays lossless.
- `pr-comment-infrastructure` (v0.2): the comment template gains a "verification" section appending the dual-diff content and the triad output. Existing single-diff comments still work — the section is conditional on Fix & Prove having run.

---

## 4. Approach

### Fix & Prove as a triad runner extension

v0.1's `lib/remediation/createFixBranch()` runs `git apply` then optionally a project test command. v0.4 layers the triad on top **without rewriting the runner**:

1. **Step 1 — apply patch + run unit tests** (existing v0.1 logic, renamed `unit_test_passed`). Hard fail if red. Already in place; no work.
2. **Step 2 — author regression test** (new). Spin up an ACP session in the scan workspace. Prompt: "Here is a vulnerability at `<path>:<line>` of class `<cwe-id>`. Here is the patch. Here is the original taint path. Write a regression test in the project's test framework that exercises the original vulnerable code path with the original exploit pattern. The test must FAIL on the pre-patch commit and PASS on the post-patch commit. Place the test in `<conventional-test-dir>/regression/<finding-id>.test.<ext>`." The agent's diff is captured. Persists as `regression_test_path` on `finding_branches`.
3. **Step 3 — run regression test against pre-patch (`vul_run_passed_pre`)**. Stash patch, run only the regression test, expect FAILURE. If it passes pre-patch, the test does not actually catch the vuln — emit `RegressionTestAuthoredEvent` with `validity=invalid` and stop. Operator sees "agent's regression test does not catch the vuln" in the verification panel.
4. **Step 4 — re-apply patch + run regression test (`vul_run_passed_post`)**. Expect PASS. If red, the patch does not actually fix the vuln — emit verification failure.
5. **Step 5 — verified-fixed gate.** Only `(unit_test_passed && !vul_run_passed_pre && vul_run_passed_post)` produces `status=verified-fixed`. Anything else → `status=fix-unverified` with the failure mode logged.
6. **Step 6 — dual-diff PR comment.** Reuse v0.2's PR comment infrastructure. Template gains a "Verification" section: the triad results table + collapsible regression test diff + collapsible test output (pre and post). Single-diff comments (no Fix & Prove) still emit; the section is conditional.

The agent step (Step 2) reuses the v0.3 Investigation Console transport — same ACP session model, same event taxonomy. New events: `RegressionTestAuthoredEvent`, `VulRunResultEvent`. Persisted in `scan_events` so the entire verification trail is replayable.

### FP bank as audit-trail-first design

v0.1 ships the dismissal write path. v0.4 wraps it in audit and search:

1. **Audit table.** Every write to `finding_dismissals` (create, edit, appeal) appends a row to `finding_dismissal_history` with the actor, action, rationale snapshot, and timestamp. The original dismissal row is mutable (operators can edit their rationale); the history is append-only.
2. **FTS5 search.** Virtual table `finding_dismissals_fts` over `(reason, appeal_reason)` with content-rowid linkage to `finding_dismissals`. Query layer exposes `searchDismissals(query, filters)`.
3. **Appeal flow.** Clicking "Appeal" on a dismissed finding row sets `appealed_at`/`appeal_reason`/`appeal_author` and re-surfaces the finding in the queue with an "appealed dismissal" badge. The original dismissal is **not** deleted — the audit trail and the rationale survive. A second operator can re-dismiss with a counter-rationale; both are visible.
4. **Agent-assisted draft.** When marking FP, a "draft rationale" button kicks off a short ACP turn: agent reads the snippet, the rule docs, and the local context (file + 50 lines around) and produces a draft rationale. Operator edits and confirms — agent never writes the row directly.

### Posture as a query layer + chart layer

Pure SQL, no aggregation pipeline. Four queries become four hooks become four charts:

1. **Severity-weighted finding count over time.** Daily-bucketed `count(*) * severity_weight` over open findings, joined to `scans` for the timestamp anchor. View: `posture_severity_timeseries_view`.
2. **MTTR per severity.** `avg(merged_at - created_at)` over `finding_branches` joined to `findings`, grouped by severity, windowed by 30/60/90d. Materialized view: `mttr_by_severity_view`. Refresh trigger on scan completion (cheap; a few thousand rows max in realistic single-team installations).
3. **Open critical days.** `sum(julianday(now()) - julianday(created_at))` over `findings WHERE severity='critical' AND merged_at IS NULL AND dedup_key NOT IN (SELECT dedup_key FROM finding_dismissals)`. Single scalar + a per-finding breakdown table.
4. **Hotspot heatmap.** Join `findings × commits × authors` (already populated by source ingestion in v0.1). Group by `(file_path, author_email)`, count distinct `dedup_key`. Flag `repeat_offender = (count >= 3)`. Render as a heatmap component (TanStack Table + a heatmap cell renderer; no Plotly/D3 dependency unless one already exists in `package.json`).

Charts: lightweight inline SVG (line + bar). If a charting library is already in `package.json`, reuse it; else hand-rolled SVG keeps the bundle and the local-first story clean.

### Regression detection as a post-dedup hook

After `findings.repo.ts` resolves a new finding's `dedup_key` and either creates a canonical row or links to one, run a one-shot predicate:

```
exists row in finding_branches where:
  finding_branches.dedup_key = new_finding.dedup_key
  and finding_branches.merged_at is not null
  and finding_branches.merged_at < new_finding.created_at
```

If true → the new finding represents a regression. Insert into `finding_regressions` linking the new finding, the original merged finding, the merging commit, and the regressing commit. The regressing commit is "most recent commit on the file path before the scan timestamp" (best-effort, surfaced as such). Emit `RegressionDetectedEvent` in `scan_events`. Notify (reuse v0.2 Watch Mode notifier). Mark the new finding's `status = regression`.

The queue ordering in v0.1 is `exploitability × EPSS × (1 + KEV) × age_weight`. v0.4 adds a `regression_bonus` term — default `2.0` (a regression jumps to top half of the queue regardless of severity), operator-tunable per repo. UI renders the `REGRESSION` band visually distinct from severity bands (color + icon), not as a parallel severity.

### Why this fits the codebase

Every piece either reuses or trivially extends what v0.1–v0.3 already built:
- Branch-remediation runner: extended, not rewritten.
- ACP transport: same as v0.3, same event model.
- PR comment infrastructure: template addition, not new infrastructure.
- Watch Mode notifier: reused.
- Dedup pipeline: post-dedup hook, no change to dedup contract.
- `commits`/`authors`/`finding_branches`/`finding_dismissals` tables: already populated, just queried in new ways.

No new external dependencies. No new daemons. SQLite + Drizzle, single Next.js process — same architecture.

---

## 5. Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `lib/remediation/createFixBranch.ts` | Modified | Add Step 2–5 (regression test author + vul-run pre/post + verified-fixed gate). Existing Step 1 (apply + unit tests) preserved. |
| `lib/remediation/fix-and-prove/` | New | Triad orchestrator: ACP regression-test author, stash/apply runner, gate evaluator. Extracted module so the runner stays small. |
| `lib/remediation/dual-diff-pr-comment.ts` | New | PR comment template with verification section. Plugs into v0.2's PR comment infrastructure. |
| `lib/posture/queries.ts` | New | Pure SQL queries for the four `/posture` charts. |
| `lib/posture/views.sql` | New | View + materialized-view definitions: `posture_severity_timeseries_view`, `mttr_by_severity_view`, `posture_hotspot_view`. |
| `lib/dedup/post-hooks/regression-detect.ts` | New | Post-dedup hook predicate + `finding_regressions` insert + `RegressionDetectedEvent` emit. |
| `lib/dismissals/` | New | FP bank service layer: `createDismissal`, `appealDismissal`, `editDismissal`, `searchDismissals` (FTS5), `getHistory(dismissalId)`. |
| `lib/dismissals/agent-assist.ts` | New | ACP-driven draft-rationale generator. |
| `lib/db/schema.ts` | Modified | New tables (`finding_dismissal_history`, `finding_regressions`); new columns on `findings` (`status` enum, `regression_test_path`, three triad result bools); new columns on `finding_dismissals` (appeal trio); new materialized view + FTS5 virtual table. |
| `drizzle/` | New | Migration. `status` enum widening uses additive values; existing rows default to current `open`/`fixed` values. |
| `lib/pipeline/events.ts` | Modified | New event variants: `RegressionTestAuthoredEvent`, `VulRunResultEvent`, `RegressionDetectedEvent`, `DismissalAppealedEvent`. |
| `lib/pipeline/finalize-scan.ts` | Modified | After dedup, run regression-detect hook. After regressions detected, fire Watch Mode notifier. After completion, refresh `mttr_by_severity_view`. |
| `lib/repos/queue.repo.ts` | Modified | Apply `regression_bonus` to ranking. Render `REGRESSION` as a virtual band above severity. Honor `appealed_at` (re-surface appealed dismissals). |
| `app/posture/page.tsx` | New | Single dashboard. Four chart components. Repo filter. |
| `app/findings/[id]/regression/page.tsx` | New | Regression lineage view: original PR, merging commit, regressing commit, file diff. |
| `app/findings/[id]/verify/page.tsx` | New | Triad result panel: unit test status + pre/post regression test status + diffs. |
| `app/dismissed/page.tsx` | Modified (replaces v0.1 stub) | Full FP bank UI: search box, filters, appeal action, history drawer, draft-rationale agent button. |
| `app/api/posture/mttr/route.ts` | New | MTTR rollups (per severity / per repo / global). |
| `app/api/posture/timeseries/route.ts` | New | Severity-weighted finding count over time. |
| `app/api/posture/hotspots/route.ts` | New | Hotspot heatmap data. |
| `app/api/findings/[id]/verify/route.ts` | New | Trigger Fix & Prove on demand (re-verify). |
| `app/api/dismissals/[id]/appeal/route.ts` | New | Appeal a dismissal. |
| `app/api/dismissals/[id]/draft/route.ts` | New | Agent-assisted draft rationale. |
| `app/api/dismissals/search/route.ts` | New | FTS5 search over dismissal rationale. |
| `components/ui/charts/PostureLineChart.tsx`, `MttrBars.tsx`, `OpenCriticalCount.tsx`, `HotspotHeatmap.tsx`, `RegressionBadge.tsx`, `VerificationPanel.tsx`, `DismissalHistoryDrawer.tsx`, `RegressionLineage.tsx` | New | UI building blocks. |

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Agent-authored regression test does not actually fail pre-patch** | High | High — verified-fixed status becomes a lie | Step 3 of the triad explicitly checks pre-patch failure. If the test passes pre-patch, mark `validity=invalid`, do NOT claim verified-fixed, surface "agent's regression test did not catch the vuln" in the verification panel. Operator sees the failure mode. Also: snapshot test the triad against a fixture pack of 5 known-vulnerable / known-fixed pairs (sqli, xss, ssrf, deserialization, path-traversal). Triad must produce verified-fixed on all 5 and unverified on 5 negative controls (where the patch is intentionally wrong). |
| **Agent writes a regression test that breaks the project test suite (irrelevant test red)** | Medium | Medium — green builds become red on unrelated grounds | Regression test runs in a sandboxed test command (only the one test, not the full suite, in Step 3 and Step 4). Step 1 runs the full suite once and is the only "full suite" gate. Document the boundary: the regression test author cannot break the unit test signal. |
| **Stash + re-apply for vul-run-pre breaks on dirty workspace or merge conflicts** | Medium | High — Fix & Prove silently degrades | Use a fresh worktree per finding (`git worktree add`), not in-place stash. Worktree is torn down on completion. Documented in `lib/remediation/fix-and-prove/README.md`. Failure during worktree creation produces `status=fix-unverified` with reason `worktree-failed`, never silently green. |
| **MTTR materialized view goes stale and posture shows wrong numbers** | Medium | Medium | Refresh trigger on scan completion. Manual refresh button in `/posture`. View definition includes `refreshed_at` column; UI displays "data as of <ts>". On a real scan this is sub-second; the MV is precaution against scaling. |
| **Hotspot heatmap exposes author PII broadly** | Low | Medium — privacy concern | Author identifiers are git author emails — already public in `commits`. Heatmap is local-only (local-first product). Document in DESIGN.md that posture is operator-only; no export to external systems unless the operator opts in. |
| **Regression detection false positives (a "regression" that is really a new finding at the same `dedup_key`)** | Medium | Medium — operator distrust of the regression band | `dedup_key` is the same key v0.1 uses to dedupe across scans — by definition, a finding at the same key is "the same vuln" by our model. If our dedup is wrong, regression detection will be too — but that is a dedup problem, not a regression problem. Surface the lineage view with ALL evidence (original PR, merging commit, regressing commit, diff between them). Operator can dismiss the regression flag with a rationale ("this is a different code path that hashes to the same key — needs a tighter dedup"). Dismissal feeds back into `finding_dismissals`. |
| **`mttr_by_severity` is unstable on small samples** | High | Low — early-stage installations show wild MTTR swings | Surface sample size next to every MTTR number ("MTTR: 4.2d (n=3)"). For n<5, render with a low-confidence indicator. Document in the chart legend. |
| **FTS5 not available on the SQLite build** | Low | Medium — search degrades to LIKE | Detect FTS5 at startup (`PRAGMA compile_options`); if absent, fall back to LIKE on `reason`. Document the bun + better-sqlite3 build flag requirement. |
| **PR dual-diff comment exceeds GitHub comment size limit (65535 bytes)** | Medium | Medium — comment fails to post | Truncate test output to 8 KB head + 8 KB tail with a "[truncated, full output at /scans/<id>/verify]" marker. Truncation happens at the comment-template layer. Diff itself is rarely huge for security patches. |
| **Posture queries are slow on installations with 100k+ findings** | Low | Medium | Indexes on `findings.created_at`, `findings.severity`, `finding_branches.merged_at`, `commits.author_email`, `commits.committed_at` (most already from v0.1). Materialize the heatmap query as a view if profiling shows it slow. Snappy local-first envelope: target <200ms for the four-chart page on a 10k-finding fixture. |
| **`status` enum migration breaks existing readers** | Low | High — production rows become unparseable | Enum widening is additive (add `verified-fixed`, `fix-unverified`, `regression`); existing `open` / `dismissed` / `fixed` values are preserved. Backfill: existing `merged_at IS NOT NULL` rows stay `fixed` (NOT auto-promoted to `verified-fixed`) — verified-fixed only applies forward, after Fix & Prove runs. Documented. |
| **Operators dismiss findings via the agent-draft path without reading** | Medium | High — automated FPs sneak through | Agent draft button does NOT auto-submit. Submit button is disabled for 5 seconds after the draft loads; rationale field is editable; operator must explicitly click "Confirm dismissal". Audit history records who confirmed and on what timestamp — distinguishable from a hand-typed rationale via a `source` enum (`hand` / `agent-assisted`) on `finding_dismissal_history`. |
| **Regression notification storm on a noisy regression** (10 findings come back at once) | Medium | Low | Notification debouncing: one notification per scan with "N regressions detected — see queue", not one per finding. Reuses v0.2 Watch Mode notification batching. |

---

## 7. Rollback Plan

Each capability rolls back independently:

1. **Fix & Prove** — feature-flag the triad behind `OBT_FIX_AND_PROVE=1` for the first release. If off, branch-remediation runs only Step 1 (v0.1 behavior). Rollback: drop `regression_test_path`, `vul_run_passed_pre`, `vul_run_passed_post`; rename `unit_test_passed` back to `tests_passed`. PR comment template falls back to single-diff path (already conditional in code).
2. **FP bank UI** — `/dismissed` re-renders the v0.1 stub. Drop `finding_dismissal_history`. Revert `finding_dismissals` columns (`appealed_at`, `appeal_reason`, `appeal_author`). Drop FTS5 virtual table. v0.1 dedup-suppression behavior is preserved.
3. **Posture** — delete `app/posture/`, drop the materialized view, remove the SQL view definitions, delete `lib/posture/`. No upstream consumers.
4. **Regression Tracker** — drop `finding_regressions` table, remove the post-dedup hook, remove the `REGRESSION` band from the queue, remove `app/findings/[id]/regression/`. Findings with `status=regression` revert to their natural severity band (data preserved, just rendered differently).
5. **MTTR** — drop `mttr_by_severity_view`. Posture page degrades gracefully (charts hide on missing view).

Schema changes are additive; rollback drops are scripted in `drizzle/<change>-rollback.sql`. v0.1–v0.3 surfaces and behavior unaffected.

---

## 8. Dependencies

- **From v0.1**: `branch-remediation` (`finding_branches` with `merged_at`, `tests_passed`, `pr_url`); `findings-dedup` (`dedup_key`); `false-positive-bank` schema (`finding_dismissals`); `commits` + `authors` tables; queue ranking formula.
- **From v0.2**: PR comment infrastructure (Diff Mode); Watch Mode desktop notifier; webhook + tunnel docs (PR comment posting reuses).
- **From v0.3**: ACP transport + Investigation Console event model (regression test authoring uses the same ACP session model); `scan_events` replay (regression test authoring is replayable).
- **External**: none new. SQLite FTS5 (build-time flag in better-sqlite3, already enabled). `git worktree` (already required). No new APIs.
- **No new ACP capabilities required**; reuses prompt + tool-call model already in v0.3.

---

## 9. Success Criteria

v0.4 is done when **all** of these are observable on a real test repo:

1. **Fix & Prove triad on a fixture** — On a fixture repo with a known SQLi, run branch-remediation. The PR receives a dual-diff comment (fix + regression test). Verification panel shows `unit_test_passed=true`, `vul_run_passed_pre=false`, `vul_run_passed_post=true`. Finding row shows `status=verified-fixed`. The regression test file exists at the conventional path with the finding ID.
2. **Triad accuracy on 5 reference vulns + 5 negative controls** — Run Fix & Prove against a fixture pack: `sqli`, `xss`, `ssrf`, `deserialization`, `path-traversal` — all with known-good patches. Triad must produce `verified-fixed` on all 5. Then run against 5 intentionally bad patches (e.g., a fix that just suppresses the warning). Triad must produce `fix-unverified` on all 5. ≥9/10 correct.
3. **Posture dashboard** — Open `/posture` on an installation with ≥30 days of scan history (use a generated fixture if needed). All four charts render in <500ms first paint. Severity-weighted line chart shows daily buckets. MTTR shows three windows (30/60/90d) with sample sizes. Open critical days shows a scalar + per-finding table. Hotspot heatmap renders ≥10 file/author cells with the repeat-offender flag set on cells where `count(distinct dedup_key) ≥ 3`.
4. **MTTR API** — `GET /api/posture/mttr?repo=<id>&severity=high&window=30d` returns `{ avg_seconds, sample_size, refreshed_at }`. Global rollup (no repo filter) returns aggregate.
5. **FP bank search** — On an installation with ≥20 dismissals, search the rationale via FTS5 (`/dismissed?q=eval`). Results filter to dismissals whose `reason` matches. Filter by author / date / rule narrows further. Click any dismissal: history drawer shows full audit trail. Click "Appeal": dismissal re-surfaces in the queue with `appealed_at` set; counter-rationale persists as a new history row.
6. **Agent-assisted draft rationale** — Click "Mark FP" on any finding. Click "Draft rationale". Within 10s a draft populates the rationale field. Submit button is disabled for 5s. Operator edits. Submit. Audit history shows `source=agent-assisted`. Hand-typed dismissal shows `source=hand`.
7. **Regression detection** — On a fixture: scan with a finding F1, merge the fix branch (manually mark `merged_at`), scan again with the same vuln re-introduced. F2 (same `dedup_key`) appears in the queue with the `REGRESSION` band, the `finding_regressions` row exists linking F1 → F2, and a desktop notification fires on scan completion. `/findings/<F2>/regression` shows the lineage: original PR, merging commit, regressing commit, file diff between them.
8. **Regression queue ordering** — A `REGRESSION`-banded finding appears above HIGH and below CRITICAL by default. Adjusting the per-repo `regression_bonus` setting moves the band; UI updates immediately on next queue load.
9. **Notification debouncing** — When 10 regressions are detected in a single scan, exactly 1 desktop notification fires ("10 regressions detected — see queue"), not 10.
10. **Schema additivity verified** — Run v0.4 migration on a v0.3 production fixture. All existing rows survive. All v0.1–v0.3 surfaces (queue, hunt, console, playbooks, secret timeline) work unchanged. No data loss in `finding_dismissals` (existing dismissals work without history rows; future dismissals get history).
11. **Local-first preserved** — Network capture during posture queries shows no egress. Network capture during Fix & Prove shows traffic only to the configured LLM provider (regression test authoring) and (if user opts in) GitHub for PR comment posting. **No code content leaves the machine.** Asserted by the same integration test added in v0.3.
12. **All v0.1+v0.2+v0.3 capabilities still pass** — Existing Vitest suite is green. No regressions in queue ordering, dedup, branch-per-finding, Diff Mode, Watch Mode, SARIF emit/ingest, CVE Hunter, Investigation Console, Playbooks, Secret Timeline.

---

## 10. Open questions for spec / design phases

Deferred deliberately:

- **Q1 (design):** Regression test placement — agent picks a path under `<conventional-test-dir>/regression/` per project convention. How do we detect convention? (Detect from existing test paths? Configurable per project? Heuristic + fallback?) Affects how natural the regression test feels in the project.
- **Q2 (design):** Worktree lifecycle — one worktree per finding (clean but slow on small disks) or shared worktree pool with stash isolation (fast but riskier)? Probably one-per-finding with a 24h GC sweep; needs prototype.
- **Q3 (spec):** `status` enum widening — three new values (`verified-fixed`, `fix-unverified`, `regression`) — or two (combine `regression` with the severity band)? Tradeoff: status purity vs. queue rendering complexity. Probably three, but spec phase confirms.
- **Q4 (spec):** Hotspot heatmap thresholds — `repeat_offender = (count >= 3)` is a guess. Operator-tunable per repo? Configurable in settings? Or fixed?
- **Q5 (spec):** Posture default time range — 30 days? 90 days? "Since first scan"? Affects the line chart's first paint and the perception of "we're getting better/worse."
- **Q6 (design):** Notification batching window — collapse all regressions in a single scan to one notification (current plan), or also collapse across scans within a 5-minute window for noisy CI installations?
- **Q7 (spec):** Fix & Prove on findings without a `patch_diff` — a finding with no agent-suggested patch cannot run the triad. Status = `fix-unverified` with reason `no-patch`? Or the triad never runs? Needs clear UX.
- **Q8 (design):** Agent-assisted draft rationale — does the agent see the rule definition, the snippet, or the broader code context? Privacy/local-first vs draft quality tradeoff.

---

## 11. Next phases

- **sdd-spec** — formal specs for: Fix & Prove triad contract (input → output mapping, failure modes), `finding_dismissal_history` audit invariants, `finding_regressions` insert predicate, `mttr_by_severity_view` definition, posture API response shapes, schema migrations.
- **sdd-design** — pick concrete answers to Q1/Q2/Q4/Q6/Q8; design the worktree lifecycle; design the regression test placement heuristic; design the agent-assisted draft prompt; design the verification panel UI.

These two can run in parallel.
