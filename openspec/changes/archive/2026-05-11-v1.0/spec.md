# Spec: v1.0 — Policies + Collaboration + Export Bridge + OSV/Socket Integrations

**Change**: v1.0
**Date**: 2026-05-06
**Domains**: policies, collaboration, export-bridge, osv-enrichment, socket-threat-feed, cross-scanner-consensus
**All domains are NEW** — no existing specs to delta against.

---

## Domain: policies

### Requirement: Policy File Loading

The system SHALL load policy rules from `~/.obt/policies.yaml` (global) and `.obt/policies.yaml` (workspace). Workspace rules SHALL override global rules for overlapping path globs.

#### Scenario: Workspace policy overrides global

- GIVEN a global policy sets `severity_floor: medium` for `**/*.js`
- AND a workspace policy sets `severity_floor: high` for `**/*.js`
- WHEN a scan completes and Stage 4 evaluates findings
- THEN the workspace floor (`high`) SHALL apply, not the global

#### Scenario: Global policy used when no workspace policy exists

- GIVEN a global policy file exists
- AND no workspace `.obt/policies.yaml` is present
- WHEN Stage 4 evaluates findings
- THEN global rules SHALL apply without error

#### Scenario: Missing policy files

- GIVEN neither global nor workspace policy files exist
- WHEN Stage 4 runs
- THEN evaluation SHALL proceed with no rules applied and no error raised

---

### Requirement: Policy Rule Types

The system SHALL support three rule types per path glob: `severity_floor`, `ignore_rule` (with optional `expiry` date), and `owner` assignment.

#### Scenario: ignore_rule suppresses finding

- GIVEN an `ignore_rule` matches a finding's path and rule ID
- AND the rule has no `expiry` or expiry is in the future
- WHEN Stage 4 evaluates that finding
- THEN the finding SHALL be stored with `status='policy_suppressed'` and the matching rule ID

#### Scenario: Expired ignore_rule does not suppress

- GIVEN an `ignore_rule` has an `expiry` date in the past
- WHEN Stage 4 evaluates a matching finding
- THEN the finding SHALL NOT be suppressed
- AND a warning SHALL be surfaced in the UI settings page for that expired rule

#### Scenario: severity_floor annotation

- GIVEN a `severity_floor: high` rule matches a finding with `severity: low`
- WHEN Stage 4 evaluates it
- THEN the finding SHALL remain in the queue with reduced display priority, not removed

---

## Domain: collaboration

### Requirement: Finding Comments

The system SHALL allow users to add text notes to any finding, stored in a `finding_comments` table with `created_at` and `actor` fields.

#### Scenario: User adds a comment

- GIVEN a finding detail page is open
- WHEN the user submits a text note
- THEN the comment SHALL be saved with `finding_id`, `actor`, `body`, and `created_at`
- AND the comment SHALL appear in the finding's comment thread immediately

#### Scenario: Comment thread displays in order

- GIVEN a finding has multiple comments
- WHEN the finding detail page loads
- THEN comments SHALL be displayed in ascending `created_at` order

#### Scenario: @mention stored verbatim

- GIVEN a comment contains `@alice`
- WHEN the comment is saved
- THEN the mention SHALL be stored as-is with no notification dispatched (notifications deferred to v1.1)

---

### Requirement: Finding Assignment

The system SHALL allow assigning a finding to an owner (free-text string or value from the `authors` table), with an auditable assignment history.

#### Scenario: Assign finding to owner

- GIVEN a finding is unassigned
- WHEN a user assigns it to `@bob`
- THEN an assignment record SHALL be created with `finding_id`, `assignee`, `actor`, and `created_at`
- AND the finding detail page SHALL show the current assignee

#### Scenario: Assignment history is auditable

- GIVEN a finding has been reassigned twice
- WHEN the assignment history section is viewed
- THEN all assignment records SHALL be displayed with actor and timestamp

---

## Domain: export-bridge

### Requirement: Jira Ticket Creation

The system SHALL create Jira tickets via the Jira REST API v3 with: summary, description (finding detail + reproduction steps), priority (mapped from severity), and labels. Jira base URL, project key, and API token SHALL be required and stored encrypted at rest.

#### Scenario: Create Jira ticket from finding

- GIVEN Jira integration is configured (base URL, project key, API token)
- WHEN the user triggers "Export to Jira" for a finding
- THEN a ticket SHALL be created in the configured project with severity-mapped priority and finding labels

#### Scenario: Idempotent re-export

- GIVEN a Jira ticket already exists for a finding (ticket key stored on the finding)
- WHEN the user triggers "Export to Jira" again
- THEN no duplicate ticket SHALL be created
- AND the existing ticket key SHALL be returned

#### Scenario: Missing Jira credentials

- GIVEN Jira integration is not configured
- WHEN the user attempts to export to Jira
- THEN the system SHALL display a configuration error and SHALL NOT attempt an API call

---

### Requirement: Slack Weekly Digest

The system SHALL send a weekly Slack digest via an incoming webhook URL summarizing: new findings by severity, fixed findings, regression count, and MTTR delta.

#### Scenario: Weekly digest is sent

- GIVEN a Slack webhook URL is configured
- WHEN the weekly digest schedule triggers
- THEN a message SHALL be posted with counts for new/fixed/regressed findings and MTTR delta

#### Scenario: Digest is idempotent within the same week

- GIVEN a digest was already sent for the current week
- WHEN the digest job runs again in the same week
- THEN no duplicate message SHALL be sent to Slack

---

### Requirement: GitHub Code Scanning SARIF Upload

The system SHALL upload findings as SARIF 2.1.0 to the GitHub Code Scanning API (`POST /repos/{owner}/{repo}/code-scanning/sarifs`) using a user-supplied PAT with `security_events` scope.

#### Scenario: SARIF upload succeeds

- GIVEN a GitHub PAT and repo are configured
- WHEN the user triggers SARIF upload
- THEN findings SHALL be serialized to valid SARIF 2.1.0 and uploaded
- AND the GitHub Security tab SHALL reflect the uploaded results

#### Scenario: SARIF upload failure is logged

- GIVEN the GitHub API returns an error
- WHEN the upload is attempted
- THEN the error SHALL be recorded in `scan_events`
- AND the system SHALL retry with exponential backoff

---

## Domain: osv-enrichment

### Requirement: OSV Advisory Lookup

The system SHALL query OSV.dev for every CVE/GHSA ID in `findings.cve_ids` at scan completion, populating: affected versions, fix version, CVSS severity, and aliases (CVE ↔ GHSA). Results SHALL be cached in `cve_scores` with a 24-hour TTL. NVD SHALL serve as fallback only.

#### Scenario: OSV enrichment on scan completion

- GIVEN a scan produces findings with CVE IDs
- WHEN the scan reaches Stage 4
- THEN OSV.dev SHALL be queried for each CVE ID
- AND affected versions, fix version, and CVSS SHALL be written to `cve_scores`

#### Scenario: Cache hit skips network call

- GIVEN a CVE ID was enriched within the past 24 hours
- WHEN the same CVE appears in a new scan
- THEN the cached record SHALL be used without querying OSV.dev

#### Scenario: OSV unavailable falls back to NVD

- GIVEN OSV.dev returns an error or times out
- WHEN enrichment runs for a CVE ID
- THEN NVD SHALL be queried as fallback (if API key is configured)
- AND the finding SHALL be stored with whatever data was obtained

#### Scenario: No CVE IDs — enrichment skipped

- GIVEN a scan produces findings with no `cve_ids`
- WHEN enrichment runs
- THEN no OSV or NVD calls SHALL be made

---

## Domain: socket-threat-feed

### Requirement: Socket.dev Signal Injection

The system SHALL query the Socket.dev threat feed for every npm/PyPI package in the dependency graph at scan time. Socket signals SHALL be stored as finding tags (`socket:malware`, `socket:typosquat`, `socket:suspicious-install`) and exposed as findings with `detector='socket'`. A missing Socket API key SHALL degrade gracefully — no socket findings, no error.

#### Scenario: Socket signal detected and stored

- GIVEN a Socket API key is configured
- AND a scan includes an npm package flagged as malware by Socket
- WHEN the dependency scan stage runs
- THEN a finding with `detector='socket'` and tag `socket:malware` SHALL be created

#### Scenario: Missing API key degrades gracefully

- GIVEN no Socket API key is configured
- WHEN a scan includes npm/PyPI packages
- THEN no Socket API calls SHALL be made
- AND the scan SHALL complete without error, with zero socket findings

#### Scenario: Socket finding appears in queue

- GIVEN a Socket finding was created during a scan
- WHEN the findings queue loads
- THEN the finding SHALL appear with `source: socket-threat-feed` visible

---

## Domain: cross-scanner-consensus

### Requirement: Consensus Score Computation

The system SHALL compute a `consensus_score` (0.0–1.0) for every finding where multiple scanners detected the same `dedup_key`. Score = agreeing scanners / total scanners that ran on that file. A finding where scanners disagree SHALL be tagged `status='conflicted'`.

#### Scenario: Full agreement raises consensus score

- GIVEN semgrep and the LLM scanner both detect a finding with the same `dedup_key`
- AND both ran on that file
- WHEN consensus is computed
- THEN `consensus_score` SHALL be `1.0` and status SHALL be `agree`

#### Scenario: Partial agreement produces conflicted state

- GIVEN semgrep detects a finding but the LLM scanner does not flag it
- AND both ran on that file
- WHEN consensus is computed
- THEN `consensus_score` SHALL be `0.5` and status SHALL be `conflicted`

#### Scenario: Conflicted findings sorted above peers

- GIVEN the queue contains conflicted and non-conflicted findings of the same severity
- WHEN the findings queue renders
- THEN conflicted findings SHALL appear above non-conflicted findings of the same severity

#### Scenario: Single-source finding

- GIVEN only one scanner ran on a file and produced a finding
- WHEN consensus is computed
- THEN `consensus_score` SHALL be `1.0` and status SHALL be `single-source`

#### Scenario: Consensus indicator displayed per finding

- GIVEN a finding has `consensus_score = 0.5` from 1/2 scanners
- WHEN the finding row is rendered in the queue
- THEN the UI SHALL display a badge showing `1/2` (agreeing / total)