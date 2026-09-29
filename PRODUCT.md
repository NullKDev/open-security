# open-security — Product Vision

> Last updated: 2026-05-05

## Elevator pitch

**open-security is the local-first security workbench where the agent investigates with you, cross-references OSV/EPSS/CISA to prioritize what actually matters, proves reachability, opens the branch, verifies the fix — and you approve.**

- Every finding ends in a merged fix, not a Jira ticket.
- Your code never leaves the machine.
- You can use any LLM model.
- The agent is steerable mid-investigation, not a batch job.

---

## Product arc

```
Investigate → Remediate → Prevent → Measure
```

| Phase | Core question | Primary surface |
|---|---|---|
| **Investigate** | What is real and why? | CVE Hunter + Investigation Console |
| **Remediate** | How do we close it? | Branch-per-finding + Fix & Prove |
| **Prevent** | How do we stop it from coming back? | Diff Mode + Watch Mode + Playbooks |
| **Measure** | Are we actually getting better? | Posture + MTTR + Regression tracker |

---

## Navigation (information architecture)

The home screen is **the queue**, not a dashboard. A security engineer at 9am opens their queue — what needs their eyes today, ordered by real risk.

```
/queue          Today's prioritized queue (exploitability × EPSS × age)
/investigate    Active investigation sessions (steerable ACP agent)
/hunt           CVE Hunter / targeted pattern investigations
/remediate      Open fix branches, PRs in flight, merge status
/repos          Repo registry (watch mode, policies, baselines)
/findings       Full searchable corpus (dedup, FP bank, history)
/posture        Trends, MTTR, regression tracking (the only dashboard)
/playbooks      Parameterized investigation templates
/settings       Providers, integrations, policies
```

Key inversion: **scans are a backend artifact, not a UI noun.** Users think in findings and investigations, not in scan runs.

---

## Market position

### What exists today

| Tool | Unique strength | Their gap |
|---|---|---|
| **Claude Security (Anthropic)** | Data-flow tracing cross-file, multi-stage validation, patches. Enterprise-only, cloud. | Code leaves your machine. Locked to Claude. No researcher mode. |
| **Semgrep Assistant** | Applies fix, re-runs rule to verify it no longer fires. Auto-triage with written rationale. | SaaS-only. OpenAI/Bedrock only. Locked to Semgrep rule format. |
| **Snyk DeepCode AI** | Symbolic + generative hybrid. Trained on 25M data-flow cases. ~80% autofix accuracy. 5 ranked fix candidates. | Shallow architectural context. Proprietary KB. |
| **GitHub Copilot Autofix** | Free for OSS. CodeQL-grounded. SARIF-native. | Subset of CodeQL queries only. Cuts context on large files. GitHub-only. |
| **Aikido Security** | Breaking-change analysis on dep upgrades. AI pentesting (Aikido Attack). | Closed model. UI-driven. Not a researcher workbench. |
| **Socket.dev** | Real-time malware detection at npm/PyPI publish. 70+ behavioral signals. | SCA only. Doesn't reason about your code. |
| **Endor Labs** | Function-level reachability via call-graph without build. Claims 95% noise reduction. | Heavy infra. Closed methodology. Expensive. |
| **OpenAI Aardvark** | Agentic: monitors commits, proposes patches, validates exploitability. | Closed beta. OpenAI-only. |

### The unoccupied seat

> **"The VS Code of security research"** — local-first, provider-agnostic, steerable, researcher-grade.

Three gaps nobody fills:

1. **Steerable investigation**: chat with the scan while it runs. All competitors are batch-and-report.
2. **Cross-scanner corroboration**: multiple scanners + LLM voting on the same finding, disagreement surfaced. Nobody does this.
3. **Researcher-mode prompting**: a system prompt that thinks like a researcher (taint sources/sinks, threat model, attack surface) — not a "developer-fixer" prompt like everyone else.

---

## Full feature set

### Phase 1 — Investigate

**1. Investigation Console** `L`
Promote the scan view from a log feed to an interactive console. While the agent runs: inject questions into the live ACP session, edit the agent's plan mid-flight (PlanEvent is already rendered), reject a tool call and redirect, fork the scan from any event in `scan_events` (replay is already implemented). Investigation is dialogue, not a batch job.

**2. CVE Hunter** `M`
New scan strategy: `hunt`. Input: CVE-ID, GHSA, or advisory URL. Stage 0 fetches advisory + affected packages + PoC pattern from OSV.dev/GHSA. Stage 1 narrows osv-scanner to that ID. Stage 2 sends an ACP prompt loaded with reachability questions specific to that CVE. Output: exposed/not-exposed verdict + reachability proof or "we don't call the vulnerable path." — all shown as a live investigation transcript, not a static report.

**3. Cross-scanner consensus** `M`
gitleaks + trufflehog + semgrep + osv-scanner + LLM all vote on the same finding. Confidence rises when scanners agree, drops when they disagree. Surface disagreement explicitly. No competitor does this.

**4. Reachability proofs** `XL`
Don't say "vuln in lodash." Say "called from POST /api/users line 42 via `controller → repo.search()`." Use ts-morph / ast-grep to trace from the sink backward through callers until a route handler, message consumer, or CLI entrypoint — or stop cold. Exploit `exploitability` as a derived value: reaches-public-input → high, internal-only → low, dead code → archive. Start with import-level reachability (manifest + import graph) — already cuts ~60% noise without a full call graph.

---

### Phase 2 — Remediate

**5. Branch-per-finding remediation loop** `L`
When a finding completes Stage 5, the agent creates `fix/<scan-version>/<finding-id>` off the scanned commit, applies `patch_diff` via `git apply`, runs the project's test command inside the ACP terminal, and on green — opens a PR. The finding row gains `branch_ref`, `pr_url`, `tests_passed`, `merged_at`. Re-scanning a fix branch is a child scan that proves the vuln is gone. The scan tree (`parent_id`) becomes the fix tree.

**6. Fix & Prove** `L`
After patch: agent runs the test suite, writes a regression test for the specific vuln, posts both diffs (fix + test) to the PR. Implements the PatchEval `fix-run.sh / vul-run.sh / unit_test.sh` triad pattern. Only ship if tests pass.

**7. Findings dedup + False-Positive bank** `M`
Content-hash on `(rule, file, line, snippet)`. Same vuln across 5 scans = 1 row. Mark FP once with a written rationale — never see it again. Rationale is auditable and searchable. Implements Semgrep Assistant's auto-triage-with-rationale pattern, but on your full corpus.

---

### Phase 3 — Prevent

**8. Diff Mode (PR scanner)** `M`
Webhook on PR → scan *only the changed lines + 1-hop callers*. Sub-30s. Posts a PR comment with any new findings + a suggested fix commit. Dev clicks "Apply" — fix lands in the same PR. CI re-runs. No separate security review cycle.

**9. Watch Mode** `S`
Cron + `git pull` + delta scan against the previous scan baseline. New finding fires a desktop/Slack notification. Uses the existing `scans.parent_id` chain for diffing.

**10. Playbooks** `M`
Parameterized investigation templates: "Audit auth surface", "Find SSRF", "Pre-release sweep", "Deserialization sweep", "OAuth flow review". Saved as `.obt-skill` packages. The existing `selectStrategy()` system is already pluggable. Community-shareable.

**11. Smart Ignore / Policies** `S`
YAML rules: severity floor per path, owner-based routing, decay rules ("ignore this rule in `tests/` directory"), expiry dates. Smarter than `.semgrepignore`. Evaluated in pipeline Stage 4.

**12. Secret Exposure Timeline** `M`
"This AWS key was live in main from Mar 3 to Mar 19, in 3 deploys, owned by @carlos." trufflehog + `git log -p` + `commits`/`authors` tables already in the schema. Forces rotation conversations with evidence, not just detection.

---

### Phase 4 — Measure

**13. Security posture over time** `M`
Severity-weighted finding count per scan version. MTTR per finding (created → merged). Open critical days. Regression detection (finding that came back). `commits` + `authors` tables already correlate findings to introducing commits — surface "files/authors with repeat findings" as a hotspot heatmap. Pure SQL on data already stored.

**14. Collaboration layer** `S`
@mention, assign, note, "I confirmed FP because X". Auditable trail. New `finding_comments` + `assignments` tables.

**15. Export bridge** `S`
SARIF 2.1.0 as input AND output. Consume existing SARIF from CodeQL/Semgrep/Snyk. Emit your findings as SARIF → GitHub Security tab, Microsoft Defender, Sonar. Jira ticket generation with reproduction steps. Slack digest. This is table-stakes interoperability.

---

### Deferred (v2+)

**Dependency attack surface map** `XL` — graph: which deps reach `req.body`? Which have reachable CVEs? Heavy. Defer.

**Exploit PoC generation** `XL` — alongside the patch, generate a minimal PoC that proves exploitability. What Mythos does internally. Defer until reachability is solid.

---

## Data integrations (all free, plug in early)

| Source | What it provides | Why it matters |
|---|---|---|
| **OSV.dev** | Unified vuln DB — aggregates GHSA, RustSec, PyPA, Go vulndb, 30+ sources | Replace any direct NVD calls |
| **EPSS (FIRST.org)** | 0–1 exploit-probability score per CVE, refreshed daily | Real prioritization — not CVSS theater |
| **CISA KEV** | CVEs currently exploited in the wild | Hard prioritizer for the queue |
| **GHSA GraphQL** | Curated advisories with fix versions per ecosystem | CVE Hunter advisory fetching |
| **Socket Threat Feed** | Real-time supply chain signals (malware, typosquats) | Supply chain awareness |
| **SARIF 2.1.0** | Universal SAST exchange format | Interop with the entire ecosystem |
| **OWASP LLM Top 10 (2025)** | LLM-specific vuln taxonomy (LLM01–LLM10) | Classify AI-related findings credibly |

**Queue ordering formula**: `exploitability_score × epss_score × (1 + cisa_kev_bonus) × age_weight`

---

## Three core user journeys

### A) "Are we exposed to CVE-2024-3094?" (Hunt)
1. `/hunt` → paste CVE ID
2. Agent fetches advisory from OSV.dev, extracts indicators (package, version range, PoC pattern)
3. Live: agent reads `package-lock.json`, `Dockerfile`, runs osv-scanner scoped to that ID
4. 90s in: *"No direct dep. Indirect via base image `node:18-bullseye` — vulnerable. Reachable: NO, not on call path."*
5. One click → "Open as finding" → branch `sec/cve-2024-3094` with Dockerfile pin patch
6. **Total: ~4 minutes. Ends at a PR, not a report.**

### B) Morning queue triage
1. `/queue` shows 7 items sorted by `exploitability × EPSS × age`. Top: *"SQL concat in `userSearch.ts:42`, reachable from `GET /api/users`, EPSS 0.73, KEV listed"*
2. Click → split view: code left, agent's reachability proof right (call graph: `route → controller → repo.search()`)
3. Reviewer: "Confirm" → branch auto-created, agent drafts parameterized binding fix, opens PR
4. **The reviewer never opens a Jira ticket. The investigation IS the ticket.**

### C) PR-time defense (Diff Mode)
1. Dev opens PR → webhook fires Diff Mode on changed lines + 1-hop callers
2. 20s later, PR comment: *"NEW FINDING (HIGH): user input flows to `child_process.exec` at line 88. Reachable from public route `/api/build`."*
3. Agent posts suggested commit. Dev clicks "Apply" — fix lands in same PR. CI re-runs. Green.
4. **No separate security review cycle. Security shifts left without a new tool tab.**

---

## Implementation order (solo developer)

### v0.1 — The Loop (4–6 weeks)
Queue view + Branch-per-finding + Findings Dedup + EPSS/KEV scoring.
This alone is shippable and has no direct competitor.

### v0.2 — Defense at PR (3 weeks)
Diff Mode + Watch Mode + SARIF export + GitHub PR comment integration.
Now the tool integrates into real dev workflows.

### v0.3 — Hunt & Investigate (4 weeks)
CVE Hunter + Investigation Console (steerable agent) + Playbooks + Secret Timeline.
This is the demo that makes people say "I've never seen anything like this."

### v0.4 — Prove & Measure (3 weeks)
Fix & Prove (patch + test) + Posture trends + MTTR + Regression tracker + FP bank.

### v1.0 — Polish & Ecosystem
Policies + Collaboration layer + Export bridge (Jira, Slack) + OSV/Socket integrations.

**Cut from v1:** Dependency attack surface graph (XL), Exploit PoC generation (XL), Sigstore attestations.

---

## What this is NOT

- Not an "AI-powered scanner" — every tool is that now.
- Not a SaaS dashboard that stores your code.
- Not a wrapper around a single LLM vendor.
- Not a report generator — every finding ends in a concrete action (branch / dismiss with rationale / escalate).

---

## Competitive moat (in order of defensibility)

1. **Local-first** — code never leaves the machine. Decisive for fintech, health, defense.
2. **Steerable investigation** — chat with the agent mid-scan. Nobody else built on ACP.
3. **Cross-scanner consensus** — multiple scanners voting on the same finding.
4. **Provider-agnostic** — 11 LLM providers. Claude Security requires Claude Enterprise.
5. **Replayable investigations** — `scan_events` lets you reopen last week's scan and see exactly what the agent saw. Killer for compliance and learning.
6. **Researcher-mode prompting** — system prompt engineered around taint analysis, threat modeling, attack surface — not developer-fixer UX.
