# Proposal: v1.0 — Policies + Collaboration + Export Bridge + OSV/Socket Integrations

## Intent

v0.1–v0.4 built the workbench (queue, branch-per-finding, hunt, fix-and-prove, posture). v1.0 makes it **team-ready and ecosystem-connected**: smart policies replace per-rule ignores, a collaboration layer turns findings into auditable conversations, an export bridge plugs into Jira/Slack/GitHub Security, and OSV/Socket become first-class enrichment sources. Cross-scanner consensus is the competitive wedge — no other tool surfaces scanner disagreement explicitly.

Success means a security team can adopt open-security as their primary workbench without losing their existing Jira/Slack/GitHub Security workflows, with policies that scale beyond `.semgrepignore` and audit trails that satisfy compliance.

## Scope

### In Scope
- **Smart Ignore / Policies** — YAML rules with severity floor per path, owner-based routing, decay rules, expiry dates; evaluated in pipeline Stage 4 (extends existing `lib/policies/loader`).
- **Collaboration Layer** — `finding_comments` + `assignments` tables; @mention, assign, note, FP rationale; auditable trail surfaced on the finding detail view.
- **Export Bridge (two-way)** — SARIF 2.1.0 input ingest (CodeQL/Semgrep/Snyk), Jira ticket generation with reproduction steps, Slack weekly digest, GitHub Code Scanning API upload.
- **OSV Deep Integration** — replace any direct NVD calls with OSV.dev; full advisory enrichment per CVE on findings.
- **Socket Threat Feed** — real-time supply chain signals (malware, typosquats) injected at dependency-scan time.
- **Cross-scanner Consensus** — aggregate confidence across gitleaks/trufflehog/semgrep/osv-scanner/LLM votes on the same `dedup_key`; surface "conflicted" state when scanners disagree.

### Out of Scope (deferred to v2+)
- Dependency attack-surface graph (XL)
- Exploit PoC generation (XL)
- Sigstore attestations
- Bidirectional Jira sync (v1.0 outbound-only)
- Slack interactive actions (v1.0 read-only digest)

## Capabilities

### New Capabilities
- `policies`: YAML finding-evaluation rules in Stage 4.
- `collaboration`: comments, assignments, mentions, FP rationale.
- `export-bridge`: outbound SARIF/Jira/Slack/GitHub Code Scanning.
- `osv-enrichment`: OSV.dev advisory lookup as canonical CVE/GHSA source.
- `socket-threat-feed`: supply-chain signals at dep-scan time.
- `cross-scanner-consensus`: confidence aggregation + disagreement state.

### Modified Capabilities
None — six new capabilities. Stage 4 internals shift, pipeline contract stable.

## Approach
1. **Policies** extend `lib/policies/loader.ts` Zod schema with `severity-floor | owner-route | decay | expiry`. Stage 4 → rule pipeline: filter → route → annotate.
2. **Collaboration** adds two Drizzle tables FK to `findings.id`; new repos in `lib/repos/`; finding-detail UI.
3. **Export Bridge** in `lib/exporters/{sarif,jira,slack,github-code-scanning}.ts`; shared `FindingExportShape` adapter; SARIF ingest reuses `NormalizedFinding` → same dedup pipeline.
4. **Enrichers** under `lib/enrichers/{osv,socket}.ts` called from Stage 1 post-scanner; merged into finding metadata.
5. **Consensus** computed in `lib/pipeline/strategies/dedupe.ts`: `confidence = f(votes)`, `state = agree | conflicted | single-source`; stored on findings; queue badge.
6. **Local-first preserved** — all integrations outbound from user machine; tokens encrypted at rest via OS keyring; no telemetry.

## Affected Areas
- `lib/policies/loader.ts` — extend schema (Modified)
- `lib/pipeline/stage4-filter.ts` — rule pipeline (Modified)
- `lib/pipeline/strategies/dedupe.ts` — consensus state (Modified)
- `lib/db/schema.ts` — new tables + finding columns (Modified)
- `lib/repos/{comments,assignments}.repo.ts` (New)
- `lib/exporters/{sarif,jira,slack,github-code-scanning}.ts` (New)
- `lib/enrichers/{osv,socket,cache}.ts` (New)
- `app/findings/[id]/` — comments/assignments/consensus UI (Modified)
- `app/settings/integrations/` — token + policy editor UI (New)
- `drizzle/` migrations (New)

## Risks
- **OSV/Socket rate limits** (Med) → local cache w/ TTL + batch lookups.
- **Heterogeneous SARIF ingest produces malformed findings** (High) → strict Zod at boundary, per-tool adapter quirks.
- **Noisy "conflicted" state** (Med) → tune `dedup_key` granularity; FP-rationale override.
- **Token leakage** (High) → OS-keyring encryption, redact in `scan_events`, never echo to UI.
- **Policy file unwieldy at scale** (Med) → split per repo; ship VS Code schema.
- **Conflicted findings overwhelm reviewers** (Med) → hide single-source low-confidence by default.
- **Silent export failures** (Med) → `scan_events` log + retry w/ exp backoff; per-finding last-export status.

## Rollback Plan
Each new table/column has a Drizzle down-migration. Feature flags in `config`: `policies.enabled`, `integrations.<target>.enabled`, `features.consensus`. Disabling reverts to v0.4 behavior. All schema changes additive — no data loss.

## Dependencies
- OSV.dev REST (free, no auth)
- Socket Threat Feed (free tier, registration; npm + pypi ecosystems at v1.0)
- Jira REST v3 (user token + base URL)
- Slack incoming webhooks (user URL)
- GitHub Code Scanning API (user PAT, `security_events` scope)
- All outbound from local machine; no inbound webhooks v1.0.

## Success Criteria
- [ ] Policy YAML supports severity-floor/owner-route/decay/expiry; >30% noise reduction on representative repos.
- [ ] Finding detail view: comments, assignments, @mention; queryable audit trail.
- [ ] SARIF 2.1.0 round-trip idempotent (CodeQL → dedup → emit → re-ingest).
- [ ] Jira tickets w/ reproduction steps; Slack weekly digest; GitHub Security tab populated.
- [ ] OSV.dev replaces all direct NVD calls; <500ms cached / <2s cold enrichment.
- [ ] Socket signals surface as findings with `source: socket-threat-feed`.
- [ ] Consensus state on every multi-source finding; "conflicted" forces human review before auto-remediation.
- [ ] Credentials encrypted at rest; no plaintext in `config` or logs; `scan_events` redaction verified.
- [ ] Feature flags allow individual rollback without breaking v0.4 behavior.

**File mirror**: `openspec/changes/v1.0/proposal.md`