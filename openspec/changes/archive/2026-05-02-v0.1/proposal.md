# Proposal: v0.1 — Queue + Branch-per-finding + Findings Dedup + EPSS/KEV scoring

## Intent

Today the home is a project list and findings live siloed under each scan. That layout fails the actual job: a Blue Team operator needs to know **what to fix next, across all repos, ranked by real-world exploitation risk** — and then close the loop on each item.

v0.1 turns the workbench from "a thing that scans" into a **prioritized remediation queue with a fix loop**: every finding is enriched with EPSS exploit probability and CISA KEV presence, ranked, deduplicated across scans, and each one gets a one-click "Create Fix Branch" path that applies `patch_diff` and reports test status. False-positives are recorded once and never resurface.

This is the foundation for the product's "Remediate → Prevent → Measure" arc.

## Scope

### In Scope
- New `/queue` route as the home screen — global, ranked, filterable list of open findings across all projects
- Ranking score: `exploitability × EPSS × (1 + kev_bonus) × age_weight` computed at query time
- New `cve_scores` table caching EPSS (FIRST.org API) + CISA KEV flag with TTL (24h)
- Daily background refresh job + on-demand fetch when an unknown CVE is encountered
- Finding enrichment columns: `cve_ids` (extracted from detector output), populated for SCA detectors (osv-scanner)
- Dedup table + `dedup_key` column on findings: hash of `(detector, location_path, location_line_start, normalize(title))`; same key across scans → one canonical row, others link to it
- False-positive bank: `finding_dismissals` table with `reason`, `author`, `dismissed_at`, `dedup_key`; org-wide suppression by `dedup_key`
- Branch-per-finding remediation: new `finding_branches` table (`branch_ref`, `status`, `tests_passed`, `pr_url`); endpoint creates `sec/fix/<finding-id>` off scanned commit, applies `patch_diff`, optionally runs configured test command, surfaces status
- UI: queue rows with EPSS/KEV badges, action buttons (Investigate / Create Fix Branch / Dismiss); finding detail gains branch panel; FP bank page (`/dismissed`)
- Drizzle migrations for new tables/columns

### Out of Scope
- Pushing branches to remote / opening PRs automatically (we record `pr_url` if user fills it, but no GitHub/GitLab API integration in v0.1)
- Reachability analysis (call-graph / runtime); we expose the column but ranking treats unknown reachability as neutral
- SLA timers, dashboards, "Measure" reporting — that's v0.2
- Multi-tenant org boundaries; FP bank is per-installation, not per-org
- Migrating existing findings retroactively into dedup groups beyond a one-shot backfill script

## Capabilities

### New Capabilities
- `remediation-queue`: global ranked queue at `/`, filtering, EPSS/KEV-aware ordering, action surface
- `cve-enrichment`: EPSS + CISA KEV fetch, cache (`cve_scores` table), TTL refresh, attachment to findings via `cve_ids`
- `findings-dedup`: `dedup_key` derivation, canonical/duplicate linking across scans, one-row-per-vuln view
- `false-positive-bank`: org-wide dismissal storage keyed by `dedup_key`, search/audit page, suppression at query time
- `branch-remediation`: `sec/fix/<finding-id>` branch creation, `git apply` of `patch_diff`, optional test runner, branch status tracking on the finding

### Modified Capabilities
- `scan-schema`: new tables (`cve_scores`, `finding_dismissals`, `finding_branches`), new finding columns (`cve_ids`, `dedup_key`, `canonical_finding_id`)
- `ui-components`: `/` route changes from project dashboard to queue; project dashboard moves to `/projects`; new components for queue rows, EPSS/KEV badges, branch panel, FP bank

## Approach

1. **Schema first** — Drizzle migration adds three tables and three finding columns. `dedup_key` is computed and backfilled in the same migration for existing rows.
2. **Enrichment service** (`lib/enrichment/`) — pure functions: `fetchEpss(cveId)`, `fetchKev()` (downloads JSON, caches), `getScoresForCves(ids)` reads cache + fetches missing. Called at the end of the scan pipeline for any finding with a CVE ID, plus a Next.js route handler triggered by cron / manual refresh.
3. **Dedup service** (`lib/dedup/`) — `computeDedupKey(finding)` is deterministic; `findCanonical(key)` returns the oldest non-dismissed finding sharing the key. Insert path in `findings.repo.ts` calls these to set `dedup_key` and `canonical_finding_id`.
4. **Queue query** (`lib/repos/queue.repo.ts`) — single SQL view joining findings + cve_scores + finding_dismissals (LEFT JOIN, filter NULL), ordered by computed score. Pagination via cursor.
5. **Branch remediation** (`lib/remediation/`) — `createFixBranch(findingId)` shells out to `git` inside the scan workspace, applies `patch_diff`, optionally runs `testCommand` from project config or `package.json` script, persists result. No daemon — runs on the request thread, streams progress via SSE on the scan's existing channel.
6. **UI** — new `/queue` page (server component, reads `queue.repo`), queue row component, finding detail gets a "Branch" tab, `/dismissed` page lists FP bank.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `lib/db/schema.ts` | Modified | +3 tables, +3 finding columns, +indexes |
| `drizzle/` | New | Migration + backfill for `dedup_key` |
| `lib/repos/findings.repo.ts` | Modified | Set `dedup_key`/`canonical_finding_id` on insert; honor FP suppression |
| `lib/repos/queue.repo.ts` | New | Ranked, filtered, deduped, dismissal-aware queue query |
| `lib/enrichment/` | New | EPSS + KEV fetchers, cache TTL, batch enrichment |
| `lib/dedup/` | New | Deterministic key + canonical resolution |
| `lib/remediation/` | New | Branch creation, `git apply`, test runner |
| `app/page.tsx` | Modified | Replaced by queue view (project dashboard moves to `/projects`) |
| `app/projects/page.tsx` | New | Old dashboard contents |
| `app/dismissed/page.tsx` | New | FP bank UI |
| `app/api/findings/[id]/branch/route.ts` | New | Creates fix branch, returns status |
| `app/api/findings/[id]/dismiss/route.ts` | New | Records dismissal |
| `app/api/enrichment/refresh/route.ts` | New | Manual EPSS/KEV refresh trigger |
| `components/ui/QueueRow.tsx`, `EpssBadge.tsx`, `KevBadge.tsx`, `BranchPanel.tsx` | New | UI building blocks |
| `lib/pipeline/` | Modified | Enrichment step appended after findings persist |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| EPSS / KEV endpoints slow or down during scan | Med | Enrichment is best-effort and async; queue ranks unknown CVEs with `epss=0`, recomputes once cache populates. Cache TTL prevents repeat hits. |
| `git apply` fails (drift, conflicts) on a stale `patch_diff` | High | Capture stderr, set `branch_status='apply-failed'`, surface in BranchPanel with retry. Branch is created from scanned commit, not HEAD, to minimize drift. |
| Test command runs untrusted code from a scanned repo | High | Test runner is opt-in per project, gated behind explicit "Enable tests" toggle. Document the risk; default off. |
| Dedup key collisions across legitimately different findings | Low | Include `detector` + normalized title in hash; dedup is "one canonical, others linked" not "drop" — full audit trail preserved. |
| FP bank suppresses a real new variant of an old issue | Low-Med | Dismissals are per `dedup_key` not per file; if title/location shift, key changes, re-surfaces. Add "re-open" affordance from FP bank. |
| Migration on existing findings table is slow | Low | Drizzle migration computes `dedup_key` in batches; one-shot, idempotent. |

## Rollback Plan

Migration is reversible:
1. Drop `cve_scores`, `finding_dismissals`, `finding_branches` tables
2. Drop `cve_ids`, `dedup_key`, `canonical_finding_id` columns from `findings`
3. Revert `app/page.tsx` to project dashboard, delete `/queue`, `/dismissed`, `/api/findings/[id]/branch`, `/api/findings/[id]/dismiss`, `/api/enrichment/refresh`

No external state to undo (EPSS/KEV cache is local SQLite). Branches created on user repos remain — documented as user-owned artifacts; uninstall script can offer `git branch -D 'sec/fix/*'` cleanup.

## Dependencies

- FIRST.org EPSS API (`https://api.first.org/data/v1/epss`) — public, no auth
- CISA KEV catalog (`https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`) — public, no auth
- `git` CLI on user's PATH (already required by source ingestion)

## Success Criteria

- [ ] `/` shows a ranked queue across all projects; same vuln seen in 3 scans appears as 1 row
- [ ] Findings with a CVE display EPSS probability and KEV badge within 1 minute of scan completion (or immediately if cached)
- [ ] Clicking "Create Fix Branch" on a finding with a `patch_diff` produces a `sec/fix/<id>` branch with the diff applied and reports test pass/fail when tests are enabled
- [ ] Dismissing a finding as FP suppresses the same `dedup_key` from every future queue and from existing scans' findings views
- [ ] Queue load time < 500 ms with 10k findings (single SQL query, indexed)
- [ ] All new repos (`lib/enrichment/`, `lib/dedup/`, `lib/remediation/`) have JSDoc on exported functions and Zod-validated API boundaries
