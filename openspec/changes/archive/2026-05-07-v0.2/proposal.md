# v0.2 — Diff Mode + Watch Mode + SARIF Export

> Phase: Prevent (Phase 3 of the Investigate → Remediate → Prevent → Measure arc)
> Effort: ~3 weeks (solo)
> Depends on: v0.1 (queue, branch-per-finding, dedup, EPSS/KEV)
> Status: Proposal

---

## 1. Intent

### Problem

After v0.1, open-security can find, prioritize, dedup, branch and fix a finding — but it lives **outside the developer's daily loop**. Today the security engineer is the only person who opens the tool. Devs find out about a vulnerability when they get a Jira ticket two sprints later, by which point the buggy code is already on main, in three deploys, and the original author has context-switched away.

This is the exact "shift-left without a new tool tab" gap that Semgrep Assistant, Snyk, and GitHub Copilot Autofix occupy in SaaS — and it is the reason they currently win the day-to-day mindshare even though their engines are inferior to ours on reachability, steerability, and provider choice.

### Why now

v0.1 proved the engine. v0.3 (CVE Hunter + Investigation Console) is the demo that makes people say "I've never seen this before" — but **a demo with no install path is a screenshot**. Before we ship the wow, we need the integration surface. v0.2 is the bridge from "interesting workbench" to "tool a team actually adopts."

Two market forces also make this urgent:

1. **GitHub now treats SARIF as the canonical security exchange format** for the Security tab, Defender, and most enterprise dashboards. Without SARIF emit/ingest we are invisible to procurement.
2. **OpenAI Aardvark and Claude Security are racing to own PR-time defense.** They are cloud-only and vendor-locked. Our local-first, provider-agnostic answer at the PR level is a defensible wedge — but only if it ships before the category solidifies.

### Success looks like

- A developer opens a PR. Within 30 seconds, a comment appears with any new findings introduced by the diff, severity-ordered, with reachability evidence pulled from v0.1's import-graph analysis.
- The dev clicks "Apply fix" inline in the PR. A commit lands on the same branch. CI re-runs. Green. **No security review cycle, no Jira hop.**
- A repo owner enables Watch Mode. A cron pulls main, runs a delta scan against the previous baseline (the existing `scans.parent_id` chain), and notifies via desktop or Slack only on **net-new findings** — no alert fatigue, no duplicates.
- A CISO opens GitHub Security tab and sees our findings alongside CodeQL's. SARIF-in / SARIF-out works both ways: we ingest CodeQL/Semgrep/Snyk SARIF as auxiliary scanner input for cross-scanner consensus.

---

## 2. Scope

### In scope

| Capability | Effort | What ships |
|---|---|---|
| **Diff Mode (PR scanner)** | M | New scan strategy `diff` that takes `(repo, base_sha, head_sha)`, computes changed lines + 1-hop callers via the existing import graph, runs the v0.1 pipeline narrowed to that file set, emits findings tagged `scope=diff` |
| **GitHub PR Comment Integration** | M | Webhook receiver at `/api/integrations/github/webhook`, signature verification, PR comment renderer, "Apply fix" action that uses the v0.1 branch-per-finding patch to commit on the PR head branch via the GitHub API |
| **Watch Mode** | S | Cron-driven scheduler (per-repo configurable interval), `git pull` + delta scan, notifier abstraction (desktop via OS notification API, Slack via incoming webhook), delta computed against the existing `scans.parent_id` chain |
| **SARIF 2.1.0 Export** | S | `GET /api/scans/[id]/sarif` endpoint emitting findings in SARIF 2.1.0 with `rules`, `results`, `locations`, `partialFingerprints` (using v0.1's content-hash dedup key), and `properties` carrying EPSS/KEV/reachability |
| **SARIF 2.1.0 Ingest** | S | New scanner adapter `lib/scanners/sarif.ts` that consumes a SARIF file as input, normalizes results into `findings`, participates in cross-scanner consensus alongside gitleaks/trufflehog/semgrep/osv-scanner |
| **Repo registry: webhook + watch settings** | S | Extend `repos` table with `watch_enabled`, `watch_interval`, `webhook_secret`, `notify_channels`; minimal UI under `/repos/[id]/settings` |

### Explicitly out of scope

- **CVE Hunter, Investigation Console, Playbooks** — v0.3.
- **Fix & Prove (regression test generation)** — v0.4. Diff Mode posts the patch and lets CI verify; we do not synthesize a regression test in v0.2.
- **GitLab / Bitbucket / Gitea integration** — GitHub-only for v0.2. The PR-comment renderer must be transport-agnostic so v1.0 can plug in others without a rewrite, but no other forge ships.
- **Self-hosted GitHub Enterprise Server** — works via the same API but we will not test or claim support in v0.2.
- **Findings comments, assignments, mentions** — collaboration layer is v1.0.
- **Inline VS Code extension** — out. The PR comment is the IDE-adjacent surface.
- **Cloud-hosted webhook receiver** — webhooks land on the user's local Next.js process via a tunnel they control (smee.io, cloudflared, ngrok, or a self-hosted reverse proxy). We document three patterns and ship a `bun run tunnel` helper, but we do not host anything. Local-first is non-negotiable.
- **Custom SARIF properties standardization** — we emit our extended fields under the `properties` bag with an `obt.` prefix and document them, but we do not propose them to OASIS in v0.2.
- **Auto-fix without human approval** — every "Apply fix" requires the dev to click. No silent commits. Ever.

---

## 3. Key architectural decisions

### D1. Diff Mode is a scan **strategy**, not a separate pipeline

The v0.1 pipeline (`lib/pipeline/`) already has stages 0–5 and a pluggable `selectStrategy()`. Diff Mode adds a new strategy that **narrows stage 1's file set** to `changed_files ∪ one_hop_callers(changed_files)` and tags the resulting `scans` row with `strategy='diff'`, `base_sha`, `head_sha`. Everything downstream — dedup, EPSS, branch-per-finding — works unchanged. **Rationale:** zero duplication of pipeline logic; reachability and consensus inherit for free. The 1-hop caller expansion uses the same import-graph code that v0.1 ships for reachability proofs.

### D2. Webhooks land locally; we do not host

We provide three documented tunnel patterns (smee.io for hobbyists, cloudflared for teams with a Cloudflare account, self-hosted reverse proxy for enterprise) plus a `bun run tunnel` convenience wrapper around `smee-client`. The Next.js route at `/api/integrations/github/webhook` verifies the GitHub `X-Hub-Signature-256` HMAC against a per-repo `webhook_secret` stored in `repos`. **Rationale:** local-first is the moat. Hosting webhooks ourselves would mean code metadata leaves the machine on every PR, which contradicts the elevator pitch and disqualifies us from fintech/health/defense — exactly the segments that would otherwise pay first.

### D3. Delta diffing reuses the `scans.parent_id` chain — no new schema for "baseline"

Watch Mode picks the most recent `scans` row for the repo on the watched branch as its parent, runs a full pipeline, and computes the finding delta as `set(child.findings_dedup_hash) - set(parent.findings_dedup_hash)`. The new scan row sets `parent_id = previous_scan.id`. **Rationale:** v0.1 already invests in `parent_id` and content-hash dedup. A separate "baseline" concept would split the truth into two structures and force every consumer (queue, posture, regression tracker) to know about both. One linked-list of scans, one dedup hash, one source of truth.

### D4. SARIF is a peer scanner adapter on ingest, a serializer on emit — not a pipeline stage

- **Ingest:** `lib/scanners/sarif.ts` implements the existing `Scanner` interface, takes a path or URL, parses SARIF 2.1.0, and yields normalized `RawFinding` objects that flow into stage 2 (consensus voting) like any other scanner. Cross-scanner consensus (planned v0.3 but the data flow is already there) treats CodeQL the same as gitleaks.
- **Emit:** A pure transformer `lib/export/sarif.ts` that takes a `scans.id` and produces a SARIF document. No DB writes, no side effects. Lives behind `GET /api/scans/[id]/sarif`.

**Rationale:** keeps SARIF orthogonal. Ingest is "yet another scanner". Export is "yet another view of the same row." Neither touches the pipeline core. This is what lets us ship SARIF in 2–3 days instead of 2 weeks.

### D5. Notification transports are pluggable; the matcher is shared

Watch Mode emits `NewFindingDetected` events. A `Notifier` interface (`notify(event): Promise<void>`) has implementations for `desktop` (OS-native via `node-notifier` or `electron`-style API — to be picked at apply time based on what works in a Next.js dev server context) and `slack` (incoming webhook URL). The repo's `notify_channels` JSON column lists which transports are active. Severity floor and rate limit (max N notifications / hour / repo) are evaluated **once** in the matcher, before the notifier loop runs. **Rationale:** alert fatigue kills adoption. The fastest way to add Discord/Teams/email later is to keep the matcher and the transport orthogonal.

---

## 4. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **30-second budget for Diff Mode is unrealistic for large diffs** | Medium | High — a slow PR comment is worse than none | (a) Hard timeout at 25s, fall back to "scan in progress" comment with a follow-up edit when done. (b) Skip osv-scanner on diff scope (deps don't change with code-only PRs). (c) Cache the import graph keyed on `(repo, head_sha)`. |
| **GitHub webhook secret leakage** | Low | High | Per-repo secret, stored AES-256-GCM-encrypted at rest in SQLite using a workspace-level master key from `~/.obt/master.key` (mode 0600). Never logged. Rotation flow in `/repos/[id]/settings`. |
| **"Apply fix" applied to the wrong commit (race with new pushes)** | Medium | Medium | Always re-fetch the PR head SHA before applying. If it has moved since the comment was posted, refuse and post a "this fix is stale, regenerate?" comment. Idempotency key on the suggested-commit so the same fix can't land twice. |
| **SARIF emit produces invalid documents** | Medium | Medium — breaks GitHub Security tab integration | Validate every emit against the official SARIF 2.1.0 JSON schema at runtime (vendored). Test fixtures from microsoft/sarif-tutorials. Refuse to emit if validation fails — return 500 with the validator's error path so the user sees something actionable. |
| **Cron-driven Watch Mode runs while a manual scan is in flight on the same repo** | Medium | Low | Acquire an advisory lock on `(repo_id, branch)` in `scans` before starting. Cron skips and logs "concurrent scan detected" if locked. |
| **SARIF ingest from CodeQL contains 50k findings — we OOM** | Low | High | Stream-parse with `stream-json`, never load the whole document. Hard cap at 10k findings per import with a clear error pointing to a "split your SARIF" doc. |
| **Slack incoming webhooks rate-limit us during a commit storm** | Medium | Low | Coalesce: max 1 Slack message per repo per 5 minutes; the message links to a per-repo digest URL. |
| **Watch Mode's `git pull` mutates a repo the user has uncommitted work in** | Medium | High — destroys user work | Watch Mode operates on a separate worktree under `~/.obt/worktrees/<repo>/<branch>`. Never touches the user's working copy. The user's repo path is a clone source, nothing more. |
| **GitHub Apps vs PATs** | — | — | Ship with Personal Access Token (fine-grained, contents:write + pull-requests:write) for v0.2. Document GitHub App migration path; defer App build to v1.0 when we have multi-user support. |

---

## 5. Success criteria

v0.2 is done when **all** of these are observable:

1. **Diff Mode end-to-end** — Open a PR in a test repo with a known SQL-concat regression. Within 30s, an open-security comment appears listing the finding with file/line, severity, and reachability summary. p95 latency under 30s for diffs ≤ 50 changed files; under 60s for diffs ≤ 200.
2. **Apply fix round-trip** — Click "Apply fix" on the PR comment. A commit authored by the open-security PAT lands on the PR head branch within 10s. The PR rebuild starts. The original finding does not re-surface on the next Diff Mode run.
3. **Watch Mode delta correctness** — Configure Watch Mode on a repo with a known scan history. Introduce a vulnerability, push to main. Within one cron interval, a single notification fires (not duplicated, not for pre-existing findings). Revert the commit, push. The next watch run produces zero notifications.
4. **SARIF emit validates** — `GET /api/scans/<id>/sarif` for any v0.1+ scan returns a document that passes the SARIF 2.1.0 schema validator and uploads cleanly to a real GitHub repo's Security tab via `code-scanning/sarifs` API.
5. **SARIF ingest participates in consensus** — Drop a CodeQL SARIF file into a scan's auxiliary inputs. CodeQL's findings appear in the dedup table with `scanner='codeql'`, contribute to consensus voting (or surface as disagreement), and flow into the queue with normalized severity.
6. **Local-first preserved** — A network capture during a Diff Mode run shows traffic only to `api.github.com` (PR comments + commit), to the configured Slack/desktop notifier (Watch Mode only), and to OSV/EPSS endpoints already used in v0.1. **No code content leaves the machine.** This is asserted by an integration test that fails on any unexpected egress host.
7. **Tunnel docs verified by a non-author** — A second person follows the smee.io quickstart and the cloudflared quickstart from a clean machine and gets a working webhook in under 10 minutes per path.
8. **All v0.1 capabilities still pass** — Existing Vitest suite is green. No regressions in queue ordering, dedup, or branch-per-finding.

---

## 6. Open questions for spec / design phases

These are deliberately deferred to the next phases; calling them out here so they don't get lost.

- **Q1 (spec):** Exact contract of the GitHub PR comment — Markdown shape, max length, behavior when there are >10 findings (collapse? paginate? separate comments per file?).
- **Q2 (design):** Where does the cron live? Node `setInterval` inside the Next.js process is fragile across restarts; a `node-cron` worker started from `instrumentation.ts` is cleaner. Alternative: spawn a separate `bun run watch` process and let it talk to the Next.js HTTP API. Tradeoff: process isolation vs operational complexity for a solo-developer install.
- **Q3 (design):** SARIF `partialFingerprints` — do we use the v0.1 dedup hash directly, or compose a SARIF-specific fingerprint that survives line-number drift across commits? GitHub Security tab dedupes by fingerprint, so the choice affects whether a moved-but-unchanged finding shows as new on GitHub.
- **Q4 (spec):** Notification matcher — is the severity floor global per repo, per `(repo, channel)`, or per `(repo, channel, rule_id)`? The third is the most flexible but the YAML gets dense fast.
- **Q5 (design):** "Apply fix" UX when the patch fails to apply cleanly (PR has diverged) — surface the conflict and a regenerate button, or auto-rebase the patch? Auto-rebase is dangerous if the divergent change is itself security-relevant.

---

## 7. Dependencies on prior work (v0.1)

This proposal assumes the following ship in v0.1 and reads against them:

- `scans.parent_id` linked-list and content-hash finding dedup (`findings_dedup_hash`).
- The pluggable `selectStrategy()` system in `lib/pipeline/`.
- The branch-per-finding patch generator (`fix/<scan-version>/<finding-id>` + `git apply`).
- Import-graph reachability (at minimum the manifest + import-graph layer).
- Workspace path helpers in `lib/config/workspace.ts` (no hardcoded `.obt`).
- EPSS/KEV scoring and queue ordering.

If any of these slip from v0.1 into v0.2, scope here must be re-cut.

---

## 8. Next phases

- **sdd-spec** — write the formal spec for: Diff Mode strategy contract, GitHub webhook+comment+apply-fix flow, Watch Mode notifier matcher, SARIF emit/ingest schema mapping.
- **sdd-design** — pick concrete answers to Q2/Q3/Q5; choose `node-cron` placement; pick desktop notifier library; design the encrypted secret store for webhook secrets.

These two can run in parallel.
