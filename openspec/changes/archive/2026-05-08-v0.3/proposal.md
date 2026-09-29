# v0.3 — CVE Hunter + Investigation Console + Playbooks + Secret Timeline

> Phase: Investigate (Phase 1 of the Investigate → Remediate → Prevent → Measure arc)
> Effort: ~4 weeks (solo)
> Depends on: v0.1 (queue, branch-per-finding, dedup, EPSS/KEV) + v0.2 (Diff Mode, Watch Mode, SARIF, webhooks)
> Status: Proposal

---

## 1. Intent

### Problem

After v0.1 we can prioritize and remediate. After v0.2 we live inside the developer loop at PR time. But the **scan itself is still a batch job**: the user clicks Run, watches a log feed, and gets a static report. That posture loses three things at once:

1. **Targeted research.** When a CVE drops on Hacker News, the operator's first question is *"are we exposed to THIS one?"* — not *"run a generic SAST sweep and surface anything that matches."* Today they cannot ask that question directly.
2. **Mid-flight steering.** The agent makes a wrong assumption at minute 2 and there is no way to redirect it without killing the scan and restarting. The ACP transport already supports prompt injection, plan editing, and tool-call rejection — the UI just does not expose any of it.
3. **Forensic narrative for secrets.** Trufflehog says "AWS key found in `config/aws.ts:14`." That is detection. What the security engineer actually needs to start a rotation conversation is *"this key was live in `main` from Mar 3 to Mar 19, in 3 deploys, introduced by @carlos in commit `a1b2c3d`."* Detection without provenance forces a manual `git log -p` archaeology session every single time.

### Why now

v0.3 is **the demo that wins the room.** v0.1 and v0.2 are tablestakes — useful, defensible, but solving problems competitors also solve. Steerable mid-flight investigation, CVE-targeted hunting with a live transcript, and forensic secret timelines are things **no incumbent ships today.** Aardvark and Claude Security are batch agents. Semgrep Assistant and Snyk DeepCode produce reports. None of them let the operator chat with the agent while it works, fork from any historical event, or replay last week's investigation.

The ACP groundwork is already done. The `scan_events` replay system is already done. The `commits` and `authors` tables are already populated. v0.3 is **assembly, not invention** — which is exactly when to ship the wow.

### Success looks like

- An operator pastes `CVE-2024-3094` into `/hunt`. Within 4 minutes they have either a "not exposed, here is the proof" verdict or a `sec/cve-2024-3094` branch with a Dockerfile pin patch open as a PR. They never opened a Jira ticket, never ran a manual `osv-scanner`, never read the GHSA advisory by hand.
- During any active scan, the operator types *"actually focus on the auth module first"* into the console — the agent's plan updates live, the next tool call respects it. They reject a `read(file=node_modules/...)` tool call mid-flight because the agent is going down a useless path; the agent retries with a different file. They scrub the timeline back to event #47 and fork a new investigation from there with a different prompt.
- A community member publishes `audit-auth-surface@1.2.0` as an `.obt-skill` package. Another team installs it with one command. It runs as a first-class scan strategy alongside `quick`/`standard`/`intermediate`/`paranoid`/`hunt`.
- A trufflehog finding for an AWS key opens a timeline view: introducing commit, branches it touched, deploys it likely shipped to (best-effort from `main` merge events), suspected exposure window, blame-author. The "Open rotation conversation" button drafts a Slack message with all of the above pre-filled.

---

## 2. Scope

### In scope

| Capability | Effort | What ships |
|---|---|---|
| **CVE Hunter strategy** | M | New `hunt` scan mode. Input: CVE-ID / GHSA-ID / advisory URL. Stage 0 fetches advisory + affected packages + PoC patterns from OSV.dev + GHSA GraphQL. Stage 1 scopes osv-scanner to that ID. Stage 2 ACP prompt is templated with reachability questions specific to that CVE class. Output: exposed/not-exposed verdict + reachability proof, rendered as a live transcript. |
| **Investigation Console** | L | Promote `/scans/[id]` from a log feed to a steerable console. Inject prompts mid-flight (ACP `prompt`), edit the active plan (ACP `setSessionMode` + plan-update), reject tool calls before execution (ACP `requestPermission` bridge), fork from any event in `scan_events` (replay infrastructure already exists). Live transcript view with timeline scrubber. |
| **Playbooks (`.obt-skill` packages)** | M | Parameterized investigation templates. Bundle format: directory or tarball with `manifest.yaml` + system prompt + scoped scanner config + reachability questions + parameter schema. Loader (`lib/playbooks/`) registers them as scan strategies through the existing `selectStrategy()` factory. Ships with five built-ins: audit-auth-surface, find-ssrf, pre-release-sweep, deserialization-sweep, oauth-flow-review. |
| **Secret Exposure Timeline** | M | New view at `/findings/[id]/timeline` for any secret-class finding (gitleaks/trufflehog). Joins `findings` + `commits` + `authors` (already in schema) and walks `git log -p` for the secret's normalized fingerprint. Renders introducing commit, branches touched, suspected deploy events (commits to `main`/`master`/release branches), exposure window, blame-author, and a "draft rotation message" action. |
| **Hunt + Console UI surfaces** | M | New `/hunt` route (single input box, recent hunts list). Console split-view inside `/scans/[id]` (transcript left, plan + tool inspector right, scrubber bottom). Tool-call permission prompt component. Fork-from-event affordance. |
| **Schema extensions** | S | New tables: `playbooks` (id, name, version, manifest_json, source), `hunt_targets` (scan_id, cve_id, ghsa_id, advisory_url, fetched_advisory_json), `scan_forks` (parent_event_id, child_scan_id). Extend `scans.strategy` enum to include `hunt` and arbitrary `playbook:<name>@<version>`. Extend `findings` with `timeline_computed_at` for cache invalidation. |

### Explicitly out of scope

- **Cross-scanner consensus voting** (gitleaks + trufflehog + semgrep + osv-scanner + LLM all voting on the same finding) — listed in PRODUCT.md Phase 1 but **not** part of this milestone. v0.3 focuses on the investigation surface. Consensus moves to v0.4 alongside Fix & Prove.
- **Reachability proofs (XL)** — the v0.1 import-graph layer is reused inside CVE Hunter's reachability questions, but the full ts-morph/ast-grep call-graph backend is **not** in this milestone. It stays deferred per PRODUCT.md.
- **Exploit PoC generation** — PRODUCT.md explicitly defers this to v2+. Not touched here.
- **Community playbook registry / marketplace** — `.obt-skill` packages are loadable from a local path or git URL in v0.3. A hosted registry, ratings, signing, and discovery UI are v1.0+.
- **Multi-user steering** — Investigation Console is single-operator. Two reviewers steering the same live scan concurrently is a v1.0 concern (collaboration layer).
- **Mobile / responsive Investigation Console** — desktop-only. The console is a power-user surface; mobile waits.
- **Replaying a hunt against a different repo automatically** — the user can re-run `/hunt CVE-X` per-repo, but bulk fan-out across the repo registry is a v1.0 sweep feature.
- **Auto-rotation of leaked secrets** — Secret Timeline drafts the conversation; it does not call AWS IAM / Vault / GCP APIs to rotate. Rotation automation is permanently out — destructive cloud calls will never auto-fire from open-security.
- **GitLab / Bitbucket deploy detection** — Secret Timeline's "suspected deploys" heuristic uses git history only (merges to `main`, tags). CI/CD provider integration is v1.0.

---

## 3. Capabilities

> Contract with sdd-spec. Researched against existing `openspec/specs/` (orchestrated-scan, scan-pipeline, rich-event-taxonomy, ui-components, scan-schema, source-input, project-intelligence).

### New Capabilities
- `cve-hunter`: targeted CVE/GHSA investigation as a first-class scan strategy. Advisory fetch, scoped osv-scanner, CVE-class-aware reachability prompting, exposed/not-exposed verdict.
- `investigation-console`: steerable, replayable scan UI — mid-flight prompt injection, plan editing, tool-call rejection, fork-from-event, timeline scrubber.
- `playbook-loader`: `.obt-skill` package format, manifest schema, registration as scan strategies, five built-in playbooks.
- `secret-timeline`: forensic timeline view for secret-class findings — introducing commit, branches, suspected deploys, exposure window, blame, draft rotation message.

### Modified Capabilities
- `scan-pipeline`: extend `selectStrategy()` to dispatch on `hunt` and on dynamic `playbook:<name>@<version>` strategy IDs. Strategy contract unchanged; only the dispatch table grows.
- `orchestrated-scan`: CVE Hunter and playbooks reuse the multi-pass orchestration shape, but with strategy-supplied prompts and scoped scanner configs replacing the generic ProjectMap pass.
- `scan-schema`: new tables (`playbooks`, `hunt_targets`, `scan_forks`), `scans.strategy` enum widened, `findings.timeline_computed_at` added.
- `ui-components`: `/scans/[id]` upgraded from log feed to console; new routes `/hunt` and `/findings/[id]/timeline`; new components for plan editor, tool-call prompt, timeline scrubber, fork affordance, secret timeline.
- `rich-event-taxonomy`: new event types `PromptInjectionEvent`, `PlanEditEvent`, `ToolCallRejectedEvent`, `ForkPointEvent`. Persisted in `scan_events` so replay/fork stays lossless.
- `permission-bridge`: surface tool-call permission requests in the console UI (today they auto-allow or apply policy); add explicit "reject and tell agent why" path.

---

## 4. Approach

### Stage shape

CVE Hunter and Playbooks are **strategies plugged into the existing pipeline**, not parallel pipelines. PRODUCT.md describes "Stage 0 advisory fetch / Stage 1 scoped osv-scanner / Stage 2 CVE-aware ACP prompt" — those map directly onto the existing `stage0-prep` / `stage1-classical` / `stage2-llm` boundaries. CVE Hunter is a strategy that:
1. Pre-stage0 hook: fetches the advisory, persists `hunt_targets` row, derives the `cveIdAllowlist` for stage1.
2. Stage1: runs osv-scanner with `--vulnerability=<cve>` and skips the other classical scanners (faster signal, narrower scope).
3. Stage2: builds an ACP prompt from a CVE-class template (e.g. supply-chain build-script class for CVE-2024-3094) parameterized with the advisory's affected functions + indicators.
4. Stage3+: unchanged.

Playbooks share the same shape: a `.obt-skill` package supplies the stage1 scanner scope, the stage2 prompt template, the parameter schema, and the reachability questions. The loader instantiates them as strategies the runner already knows how to dispatch.

### Investigation Console as event-driven UI over ACP

The ACP transport already emits the events we need. The console is a **read+write** layer:
- **Read** — subscribe to `scan_events` SSE stream as today; render plan, tool calls, transcript chunks, thinking with the existing components from v0.2's rich-acp-chat work.
- **Write** — three new actions, each persisted as a `scan_events` row so replay stays lossless:
  - `PromptInjectionEvent` → `acpClient.prompt(sessionId, text)` mid-flight.
  - `PlanEditEvent` → updates the local plan and pushes the edited version back via the next user turn.
  - `ToolCallRejectedEvent` → permission-bridge denies the pending tool call with an explanation, agent retries.
- **Fork** — clicking event #47 on the scrubber opens "fork from here": copies events 1..47 into a new `scans` row (parent set to the original), prompts the user for a new direction, kicks off a fresh ACP session seeded with that history. `scan_forks` table records the relationship.

### Secret Timeline as a derived view

No new collection logic. `commits` + `authors` already populated by source ingestion. For a secret finding:
1. Compute a normalized fingerprint of the secret (already done by gitleaks/trufflehog scanners).
2. `git log -p -S '<secret-substring>' -- <path>` walks history for the introducing commit and any deletions.
3. Cross-reference commits-to-`main` to surface "suspected deploy events" (best-effort heuristic, surfaced as such, never as ground truth).
4. Cache result in `findings.timeline_computed_at` + a `finding_timelines` JSON blob; invalidate on next scan that touches the same path.

### Playbook package format

```
audit-auth-surface/
├── manifest.yaml     # name, version, parameter schema, scanner scope
├── system-prompt.md  # researcher-mode prompt template
├── checks.yaml       # reachability questions, sink/source patterns
└── README.md
```

Loader validates the manifest with Zod (per project rules — Zod at all boundaries), registers a strategy with id `playbook:audit-auth-surface@1.2.0`, and routes `selectStrategy()` accordingly. Five built-ins ship in `lib/playbooks/builtins/`.

---

## 5. Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `lib/pipeline/strategies/hunt.ts` | New | CVE Hunter strategy: advisory fetch → scoped stage1 → CVE-aware stage2 |
| `lib/pipeline/strategies/playbook.ts` | New | Generic playbook strategy that runs from a loaded `.obt-skill` manifest |
| `lib/pipeline/strategies/index.ts` | Modified | Dispatch on `hunt` and dynamic `playbook:*` IDs |
| `lib/playbooks/` | New | Loader, manifest Zod schema, builtin packages, package validator |
| `lib/playbooks/builtins/{audit-auth-surface,find-ssrf,pre-release-sweep,deserialization-sweep,oauth-flow-review}/` | New | Five shipped playbooks |
| `lib/advisories/` | New | OSV.dev + GHSA GraphQL clients with cache, advisory normalization |
| `lib/timeline/` | New | Secret timeline computation: blame, history walk, deploy heuristic |
| `lib/db/schema.ts` | Modified | `playbooks`, `hunt_targets`, `scan_forks`, `finding_timelines` tables; `scans.strategy` widened; `findings.timeline_computed_at` |
| `drizzle/` | New | Migrations for above |
| `lib/pipeline/events.ts` | Modified | New event variants: `PromptInjectionEvent`, `PlanEditEvent`, `ToolCallRejectedEvent`, `ForkPointEvent` |
| `lib/providers/transport/permission-bridge.ts` | Modified | "Reject with reason" path for explicit tool-call denial |
| `lib/providers/transport/session-manager.ts` | Modified | Mid-flight prompt injection helper, plan-edit helper |
| `app/hunt/page.tsx` | New | Single-input hunt entry point + recent hunts list |
| `app/scans/[id]/ScanProgress.tsx` | Modified | Console split-view, plan editor, tool-call prompt, scrubber, fork action |
| `app/findings/[id]/timeline/page.tsx` | New | Secret exposure timeline view |
| `app/api/scans/[id]/inject-prompt/route.ts` | New | Mid-flight prompt injection endpoint |
| `app/api/scans/[id]/edit-plan/route.ts` | New | Plan-edit endpoint |
| `app/api/scans/[id]/reject-tool/route.ts` | New | Tool-call rejection endpoint |
| `app/api/scans/[id]/fork/route.ts` | New | Fork-from-event endpoint |
| `app/api/playbooks/route.ts` | New | List / install / remove playbooks |
| `components/ui/PlanEditor.tsx`, `ToolCallPrompt.tsx`, `TimelineScrubber.tsx`, `SecretTimeline.tsx`, `ForkButton.tsx` | New | UI building blocks |

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **OSV.dev / GHSA GraphQL schema drift breaks Hunter's advisory parsing** | Medium | High — Hunter goes blind | Parse with Zod schemas, fall back to "advisory could not be parsed; running generic osv-scanner against the CVE ID" path. Cache last-good schema version. Snapshot test against vendored advisory fixtures for 5 reference CVEs (3094, log4shell, etc.). |
| **CVE-class prompt templates do not generalize beyond the seed set** | High | Medium — Hunter works for known classes (supply-chain, RCE, deserialization, SSRF, auth-bypass) but produces weak prompts for novel classes | Ship 6 templates covering ~80% of CVE volume. Unknown class falls back to a generic researcher-mode prompt with the advisory text inlined. Document the gap honestly in the UI: "Hunter is using a generic prompt — results may be less precise." |
| **Mid-flight prompt injection breaks the agent's plan and produces garbage** | Medium | Medium | (a) Persist every injection in `scan_events` so the user can scrub back to the pre-injection state and try again. (b) Hard cap of 5 injections per scan; surface a warning at the limit. (c) Inject as ACP user-turn messages, never as silent system context — the agent sees them as the user speaking, not as instructions overriding the original prompt. |
| **Plan editing produces an inconsistent agent state** | Medium | Medium | Plan edits are advisory hints, not contracts. The console renders the edited plan and includes it as context in the next user turn ("the user prefers this plan: ..."). The agent is free to deviate; we surface deviation explicitly. No plan mutation is sent as authoritative ACP state. |
| **Tool-call rejection deadlocks the agent** | Low | High — scan stalls | Rejection has a 30s timeout. If the agent does not respond with an alternative action within 30s of receiving the rejection, surface "agent did not adapt — continue / abort?" prompt. Logged in `scan_events`. |
| **Fork-from-event replay diverges from original because of nondeterminism (network, timestamps, model temperature)** | High | Low | Frame forks as "new investigations seeded with the original's history" — never as deterministic replays. UI copy is explicit: "Forking creates a NEW scan inheriting events 1..N. Outcomes will differ." Original scan stays immutable. |
| **`.obt-skill` packages execute arbitrary prompts and can be malicious** | Medium | High — supply-chain risk on the SECURITY tool itself is unacceptable | (a) Manifest is data-only — no code execution from a playbook. System prompts are templated, not eval'd. (b) Local-path and git-URL install only in v0.3; no auto-update. (c) Show a trust prompt on first install: "this playbook will tell the LLM agent X — review before continuing." (d) Five built-ins are first-party and reviewed; community playbooks display an UNTRUSTED badge until v1.0 signing ships. |
| **Secret Timeline's "suspected deploys" heuristic creates false certainty** | High | Medium — operator believes a key shipped when it did not | Surface every deploy event as "suspected — based on `main` merge at <sha>". Never label a deploy as "confirmed" without CI/CD evidence (which we do not collect in v0.3). Include a "this might be wrong because…" disclosure inline. |
| **`git log -S` is slow on large repos** | Medium | Medium — timeline view feels broken | Compute timeline lazily on first view, not on scan completion. Cache in `finding_timelines`. Show a skeleton with a "computing — this can take 30s on large histories" message. Hard timeout at 60s, fall back to "introducing commit only" partial result. |
| **Console UI gets too dense and unusable** | High | High — the wow demo flops | Ship the console behind a feature flag for the first week. Dogfood it on real scans before opening the surface. Cut anything that does not earn its space. The transcript is the hero; everything else is a sidecar. |
| **ACP `setSessionMode` semantics are not stable across providers** | Medium | Medium — plan editing only works on some providers | Detect capability per provider via `NewSessionResponse.modes` (already exposed by the SDK per AGENTS.md). Disable the plan editor when the active provider does not advertise mode support. Document the matrix. |

---

## 7. Rollback Plan

Each capability rolls back independently:

1. **CVE Hunter** — drop `hunt_targets` table, remove `hunt` from `scans.strategy` enum, delete `lib/pipeline/strategies/hunt.ts`, delete `app/hunt/`. v0.2 pipeline unaffected.
2. **Playbooks** — drop `playbooks` table, remove `playbook:*` dispatch from `selectStrategy()`, delete `lib/playbooks/`. Built-ins are pure files; deletion has no DB impact beyond the registry table.
3. **Investigation Console** — feature-flag the new console behind `OBT_CONSOLE_V2=1` for the first release. If the flag is off the v0.2 log-feed UI is preserved. New event variants in `scan_events` are forward-compatible (older readers ignore unknown types). Endpoints `inject-prompt` / `edit-plan` / `reject-tool` / `fork` can be removed without data loss; persisted events remain valid history.
4. **Secret Timeline** — delete `app/findings/[id]/timeline/`, delete `lib/timeline/`, drop `finding_timelines`, drop `findings.timeline_computed_at`. Timeline is a derived view; nothing primary depends on it.

No changes to v0.1 queue / dedup / branching or v0.2 Diff / Watch / SARIF surfaces. All v0.3 schema is additive.

---

## 8. Dependencies

- **From v0.1**: `scans.parent_id` chain, `scan_events` replay, `commits` + `authors` tables, branch-per-finding, content-hash dedup, EPSS/KEV scoring.
- **From v0.2**: rich ACP chat surfaces, SARIF emit (Hunter results SARIF-export for free), webhook + tunnel docs (Hunter results can post to PRs via existing v0.2 infrastructure).
- **External**:
  - OSV.dev API (`https://api.osv.dev/v1/vulns/<id>`) — public, no auth.
  - GitHub GHSA GraphQL (`https://api.github.com/graphql` — `securityAdvisory` query) — requires PAT (re-uses v0.2 GitHub PAT setup).
  - `git` CLI on PATH — already required.
  - ACP SDK ≥ 0.21.0 (already pinned per `AGENTS.md`).

---

## 9. Success Criteria

v0.3 is done when **all** of these are observable on a real test repo:

1. **Hunt round-trip** — Paste `CVE-2024-3094` into `/hunt` on a repo using `node:18-bullseye`. Within 4 minutes the transcript ends with an exposed/not-exposed verdict. If exposed, "Open as finding" produces a `sec/cve-2024-3094` branch with the Dockerfile pin patch and a draft PR via v0.2 infrastructure.
2. **Hunt accuracy on 5 reference CVEs** — Run Hunter against a vulnerable fixture and a patched fixture for CVE-2024-3094, log4shell (CVE-2021-44228), CVE-2023-44487 (HTTP/2 rapid reset), CVE-2022-22965 (Spring4Shell), and a known-not-affected control. ≥4/5 verdicts match ground truth.
3. **Mid-flight steering** — During a live scan, inject the prompt *"focus on auth first"*. The next agent turn references the injection. Reject the next tool call with reason *"skip node_modules"*. Agent retries with a different file. Both actions appear as new event rows in `scan_events`.
4. **Fork-from-event** — Scrub to event #N, click "fork from here", give a new prompt. A new `scans` row exists with `parent_id` set, `scan_forks` row links them, and the new scan's transcript begins with events 1..N from the parent followed by the new prompt.
5. **Replay parity** — Reopen the original scan after forking. Its transcript is unchanged. Replay produces the identical event sequence (already a v0.1 invariant — v0.3 must not regress it).
6. **Playbook install + run** — Install the built-in `audit-auth-surface@1.0.0`. It appears in the strategy picker. Running it on a sample Express repo produces auth-relevant findings with the playbook's system prompt visibly used in the transcript.
7. **Playbook from local path** — `bun run playbook install ./tmp/my-playbook` registers a local `.obt-skill` package, validates its manifest with Zod, refuses on schema violation, and the package is selectable from the UI.
8. **Secret Timeline correctness** — On a fixture repo with a known leaked AWS key introduced in commit X, removed in commit Y, and merged to `main` in between, the timeline view shows X as introducing commit, the right blame-author, the right exposure window, and at least one suspected deploy event between X and Y. The "draft rotation message" action produces a non-empty Slack-shaped message containing all of the above.
9. **Console performance** — On a scan with 500 events, the console first paint is <500ms, scrubber drag latency is <50ms, and prompt injection round-trip (UI → ACP → first response chunk) is <2s.
10. **Local-first preserved** — Network capture during a Hunter run shows traffic only to OSV.dev, GHSA GraphQL, the configured LLM provider, and (if the user opts in) GitHub for PR creation. **No code content leaves the machine.** Asserted by an integration test that fails on any unexpected egress host.
11. **All v0.1+v0.2 capabilities still pass** — Existing Vitest suite is green. No regressions in queue ordering, dedup, branch-per-finding, Diff Mode, Watch Mode, or SARIF emit/ingest.

---

## 10. Open questions for spec / design phases

Deferred deliberately:

- **Q1 (spec):** Console — when the user edits the plan, do we send the full edited plan as a user-turn message or as a structured `setSessionMode` payload? Provider-capability-dependent.
- **Q2 (spec):** Hunt — when the advisory lists multiple affected packages, do we run one scan per package or one combined scan with all in scope? Affects UX and caching.
- **Q3 (design):** Playbook manifest schema — do we copy a known format (e.g. Semgrep rule pack) or design our own? Tradeoff: ecosystem familiarity vs purpose-fit.
- **Q4 (design):** Secret Timeline's deploy heuristic — minimal v0.3 is "merge to `main`/`master`/`release/*`". Configurable per-repo deploy-branch list? Or wait until v1.0 with CI/CD integration?
- **Q5 (design):** Fork storage — full event copy (simple, expensive on large scans) or pointer-to-parent + fork-only events (cheap, complex replay)? Probably pointer-based; needs prototype.
- **Q6 (spec):** Tool-call rejection — does the agent always retry, or can it terminate the scan with a "user blocked all useful paths" stop reason? Map to ACP `StopReason`.

---

## 11. Next phases

- **sdd-spec** — formal spec for: hunt strategy contract, advisory fetch + caching, playbook manifest schema + loader, console event types (`PromptInjectionEvent` / `PlanEditEvent` / `ToolCallRejectedEvent` / `ForkPointEvent`), secret timeline derivation rules, schema migrations.
- **sdd-design** — pick concrete answers to Q1/Q3/Q4/Q5; choose CVE-class template authoring approach; design the fork storage model; design the playbook trust prompt UX.

These two can run in parallel.
