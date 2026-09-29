# v0.3 Spec — CVE Hunter + Investigation Console + Playbooks + Secret Timeline

> Change: v0.3
> Date: 2026-05-06
> Status: draft

---

## New Domain: cve-hunter

### Requirement: REQ-CH-01 — Hunt Strategy Registration

The system SHALL expose a `hunt` scan strategy. `selectStrategy()` MUST dispatch on strategy value `hunt`. A `HuntTarget` input MUST be accepted: a CVE-ID (e.g. `CVE-2024-3094`), a GHSA ID (e.g. `GHSA-xxxx-xxxx-xxxx`), or a full advisory URL. Any value not matching one of these three patterns MUST be rejected at API boundary with a Zod validation error before a scan row is created.

#### Scenario: Hunt strategy dispatched from selectStrategy

- GIVEN a scan with `strategy: 'hunt'` and `huntTarget: 'CVE-2024-3094'`
- WHEN `selectStrategy()` evaluates the scan
- THEN the `HuntStrategy` implementation is invoked
- AND no other strategy runs

#### Scenario: Invalid hunt target rejected at boundary

- GIVEN a CreateScan request with `strategy: 'hunt'` and `huntTarget: 'not-a-cve'`
- WHEN `CreateScanSchema.parse` is called
- THEN a ZodError is thrown before any scan row is inserted

#### Scenario: GHSA ID accepted

- GIVEN `huntTarget: 'GHSA-2h77-w72r-3jcx'`
- WHEN `CreateScanSchema.parse` is called
- THEN parsing succeeds

---

### Requirement: REQ-CH-02 — Advisory Metadata Fetch (Stage 0 Hook)

A pre-stage0 hook MUST fetch advisory metadata from `https://api.osv.dev/v1/vulns/{id}` and extract: affected packages (name + ecosystem), version ranges, and any PoC-pattern URL found in the references list. The response MUST be parsed with a Zod schema; fields absent from the response MUST default to empty arrays (not null). The raw OSV JSON MUST be cached in `hunt_targets.advisory_raw` to avoid duplicate network calls on re-runs.

#### Scenario: Advisory fetched and parsed

- GIVEN `huntTarget: 'CVE-2021-44228'` (log4shell)
- WHEN the pre-stage0 hook runs
- THEN `advisoryMeta.affectedPackages` contains at least `{ name: 'log4j-core', ecosystem: 'Maven' }`
- AND `advisoryMeta.versionRanges` is a non-empty array

#### Scenario: OSV API returns 404

- GIVEN an advisory ID that does not exist in OSV
- WHEN the hook attempts the fetch
- THEN the scan emits a warning event and falls back to a generic prompt with no package-specific scope

#### Scenario: Advisory cached on re-run

- GIVEN `hunt_targets.advisory_raw` is already populated for this CVE
- WHEN the hook runs again for the same scan
- THEN no HTTP request is made to OSV

---

### Requirement: REQ-CH-03 — Scoped osv-scanner Stage 1

Stage 1 of a `hunt` scan MUST run osv-scanner scoped to the specific CVE or GHSA ID only — no full dependency scan. All affected packages from `advisoryMeta.affectedPackages` MUST be checked.

#### Scenario: osv-scanner invoked with CVE scope

- GIVEN `advisoryMeta.affectedPackages` contains 2 packages for `CVE-2024-3094`
- WHEN stage 1 runs
- THEN osv-scanner is invoked with flags that restrict it to those 2 packages and that CVE ID
- AND no other CVEs are scanned

#### Scenario: Multi-package advisory — all packages checked

- GIVEN an advisory affecting 3 packages across 2 ecosystems
- WHEN stage 1 runs
- THEN osv-scanner is invoked once per ecosystem covering all relevant packages
- AND findings for all 3 packages are aggregated

---

### Requirement: REQ-CH-04 — CVE-Class ACP Prompt (Stage 2)

Stage 2 of a `hunt` scan MUST send an ACP prompt pre-loaded with: (1) the affected package list, (2) any PoC pattern URL, (3) reachability questions from the CVE-class template matching the advisory. CVE classes covered MUST include at minimum: injection, path-traversal, deserialization, SSRF, auth-bypass. An advisory that does not match a known class MUST fall back to a generic reachability template.

#### Scenario: Injection-class template applied

- GIVEN an advisory classified as injection (e.g. log4shell — JNDI lookup)
- WHEN the stage 2 prompt is built
- THEN the prompt contains injection-specific reachability questions

#### Scenario: Unknown-class fallback template applied

- GIVEN an advisory with no matching CVE-class keyword
- WHEN the stage 2 prompt is built
- THEN the generic reachability template is used
- AND the scan does not fail

---

### Requirement: REQ-CH-05 — Live Transcript Output

Hunt results MUST be rendered as a live investigation transcript via the existing SSE stream. No static report is generated in place of the transcript.

#### Scenario: Hunt events appear in SSE stream

- GIVEN a `hunt` scan is running
- WHEN the ACP session produces response chunks
- THEN `response` and `tool_call` events appear on the SSE stream in real time
- AND the UI renders them as a live transcript

---

### Requirement: REQ-CH-06 — Multi-Package Coverage

If an advisory affects multiple packages, ALL affected packages MUST be checked. The hunt MUST NOT short-circuit after finding one affected package.

#### Scenario: Verdict not-exposed only after all packages checked

- GIVEN an advisory affecting packages A, B, and C
- WHEN package A is not present in the repo but B is
- THEN the hunt continues to check B and C
- AND the final verdict reflects the status of all packages

---

### Requirement: REQ-CH-07 — Verdict

The hunt result MUST include a verdict field with one of three values: `exposed | not-exposed | indeterminate`. The verdict MUST be emitted as a `finding` event (severity `critical` for `exposed`, `info` for `not-exposed`) and persisted in the DB findings row.

#### Scenario: Exposed verdict stored

- GIVEN the ACP agent determines the repo uses a vulnerable version and calls the affected API
- WHEN the hunt completes
- THEN `findings.verdict = 'exposed'` is stored
- AND a `finding` event with `severity: 'critical'` is emitted

#### Scenario: Indeterminate verdict when agent cannot conclude

- GIVEN the ACP agent cannot determine reachability
- WHEN the hunt completes
- THEN `findings.verdict = 'indeterminate'` is stored

---

### Requirement: REQ-CH-08 — Open as Finding

From the hunt result UI, the user SHALL be able to trigger "Open as finding" with one click, which MUST create a DB `findings` row (if not already created by the verdict emit) and offer a branch creation via the existing branch-per-finding flow.

#### Scenario: Open as finding creates DB row and branch

- GIVEN a completed hunt with verdict `exposed`
- WHEN the user clicks "Open as finding"
- THEN a `findings` row is created (or confirmed existing)
- AND the branch-creation flow is initiated with the CVE ID as branch name prefix

#### Scenario: Open as finding disabled for not-exposed

- GIVEN a completed hunt with verdict `not-exposed`
- WHEN the UI renders the result
- THEN the "Open as finding" action is not available or is visually disabled

---

## New Domain: investigation-console

### Requirement: REQ-IC-01 — Mid-Flight Prompt Injection

While an ACP scan is active, the user SHALL be able to type a question or instruction and inject it into the live session. The injection MUST be sent as a user-turn ACP message via the existing `acpClient`. The input MUST be disabled when no scan is active.

#### Scenario: User injects question mid-flight

- GIVEN a scan in `running` state with an active ACP session
- WHEN the user types "focus on the auth module" and submits
- THEN a `POST /api/scans/{id}/inject-prompt` is called
- AND the message is forwarded to the ACP session as a user turn
- AND the next agent response reflects the instruction

#### Scenario: Input disabled when no scan running

- GIVEN no scan is active (or the scan is in `done` state)
- WHEN the investigation console input renders
- THEN the input field is disabled and the submit action is unavailable

#### Scenario: Injection persisted in scan_events

- GIVEN a successful prompt injection
- WHEN the injection completes
- THEN a `scan_events` row with `type: 'user_injection'` and the injected text is inserted
- AND the row is associated with the correct scan ID

---

### Requirement: REQ-IC-02 — Plan Editing Mid-Flight

The user SHALL be able to edit the agent's current plan (last received `PlanEvent`) and have the edited version sent back to the agent as user-turn context. The edit is advisory — the agent may deviate.

#### Scenario: Plan edit sent as user-turn context

- GIVEN a `plan` event with 3 steps has been received
- WHEN the user edits step 2's title and clicks "Send plan update"
- THEN `POST /api/scans/{id}/edit-plan` is called with the modified steps
- AND the backend sends the edited plan as a user-turn ACP message
- AND a `scan_events` row with `type: 'plan_edit'` is persisted

#### Scenario: Plan editor unavailable when no plan received

- GIVEN no `plan` event has been received in the current scan
- WHEN the investigation console renders
- THEN the plan edit section is hidden or shows a placeholder

---

### Requirement: REQ-IC-03 — Tool-Call Rejection with Redirect

The user SHALL be able to reject a pending tool call (`permission_request` event) and provide a redirect instruction in the same action. The rejection MUST deny the tool call via the permission bridge and send the redirect text as a user-turn ACP message.

#### Scenario: Rejection with redirect persisted and sent

- GIVEN a `permission_request` event is pending for `toolName: 'bash'`
- WHEN the user clicks "Deny" and types "use read-only tools only"
- THEN `POST /api/scans/{id}/reject-tool` is called with `{ requestId, redirectInstruction: 'use read-only tools only' }`
- AND the permission bridge resolves the request to `approved: false`
- AND the redirect instruction is sent as a user-turn ACP message
- AND a `scan_events` row with `type: 'tool_call_rejected'` is persisted

#### Scenario: Rejection without redirect still denies tool call

- GIVEN a pending permission request
- WHEN the user clicks "Deny" without entering a redirect instruction
- THEN the tool call is denied with no follow-up user-turn message

---

### Requirement: REQ-IC-04 — Fork from Checkpoint

The user SHALL be able to fork the scan from any past `scan_event` row. The fork MUST create a new `scans` row with `parent_id` set to the original scan, copy events 1..N into the new scan's `scan_events`, and start a fresh ACP session seeded with that history. A `scan_forks` row MUST be created linking the two scans.

#### Scenario: Fork creates new scan with parent_id

- GIVEN a scan with 50 events and the user selects event 30 as fork point
- WHEN the user clicks "Fork from here"
- THEN a new `scans` row is created with `parent_id` = original scan id
- AND events 1..30 are copied to the new scan's `scan_events`
- AND a `scan_forks` row links parent and child

#### Scenario: Fork UI shows divergence disclaimer

- GIVEN a forked scan is running
- WHEN the UI renders the fork's transcript
- THEN a visible notice states the scan is a fork and may diverge from the original

#### Scenario: Original scan is immutable after fork

- GIVEN a fork has been created from scan S at event 30
- WHEN scan S's original `scan_events` are queried
- THEN all 50 original events are still present and unmodified

---

### Requirement: REQ-IC-05 — Console Input State

The investigation console input MUST be disabled when no scan is active. "Active" means `scans.status = 'running'` and an ACP session is live.

#### Scenario: Input re-enables when scan starts

- GIVEN the console is rendered with no active scan
- WHEN a scan transitions to `status: 'running'`
- THEN the input field becomes enabled without a page reload

---

### Requirement: REQ-IC-06 — Injection Persistence for Replay Fidelity

All injected messages (prompt injections, plan edits, tool-call rejections) MUST be persisted to `scan_events` with their specific `type` values before they are forwarded to ACP. This ensures forks and replays include the full interaction history.

#### Scenario: Injection event precedes ACP forwarding

- GIVEN a prompt injection is submitted
- WHEN the `POST /api/scans/{id}/inject-prompt` handler runs
- THEN the `scan_events` row is inserted before the ACP send call
- AND if the ACP call fails, the persisted event remains as the audit record

---

## New Domain: playbooks

### Requirement: REQ-PB-01 — Playbook Manifest Format

A playbook SHALL be a `.obt-skill` manifest file (YAML or JSON) specifying at minimum: `name`, `description`, `version`, `parameters` (Zod-compatible schema definition), and `promptTemplate` (string with `{{param}}` interpolation). Any manifest missing a required field MUST be rejected by the loader with a descriptive Zod validation error. Manifests MUST NOT contain executable code — they are data-only.

#### Scenario: Valid manifest loaded

- GIVEN a `.obt-skill` YAML file with all required fields
- WHEN the playbook loader processes it
- THEN a `Playbook` object is registered in the strategy registry

#### Scenario: Missing promptTemplate rejected

- GIVEN a manifest missing `promptTemplate`
- WHEN the loader processes it
- THEN a ZodError is thrown and the playbook is not registered

#### Scenario: Executable code in manifest rejected

- GIVEN a manifest with a `run:` field containing a shell command
- WHEN the loader processes it
- THEN the field is treated as unknown, stripped, and a warning is emitted (no code is executed)

---

### Requirement: REQ-PB-02 — Playbook Discovery

The system SHALL load playbooks from `~/.obt/playbooks/` (global) and `{workspace}/.obt/playbooks/` (workspace-local). Workspace-local playbooks MUST take precedence over global ones with the same `name`. Discovery MUST happen at scan-start time, not at boot time, to pick up newly added playbooks without restart.

#### Scenario: Workspace playbook overrides global

- GIVEN a global playbook named `audit-auth` and a workspace playbook with the same name
- WHEN the loader discovers playbooks
- THEN only the workspace version is registered

#### Scenario: No playbooks directory — no error

- GIVEN neither `~/.obt/playbooks/` nor `.obt/playbooks/` exists
- WHEN the loader runs
- THEN it completes silently with zero playbooks registered

---

### Requirement: REQ-PB-03 — Playbook as Scan Strategy Variant

Playbooks SHALL be selectable at scan start as a strategy variant using the naming pattern `playbook:<name>@<version>`. `selectStrategy()` MUST dispatch on this pattern and instantiate the corresponding playbook strategy.

#### Scenario: Playbook strategy dispatched

- GIVEN a scan with `strategy: 'playbook:audit-auth@1.0.0'`
- WHEN `selectStrategy()` evaluates the scan
- THEN the `PlaybookStrategy` for `audit-auth` v1.0.0 is instantiated

#### Scenario: Unknown playbook name returns error

- GIVEN `strategy: 'playbook:does-not-exist@1.0.0'`
- WHEN `selectStrategy()` evaluates the scan
- THEN the scan fails at initialization with a human-readable error event

---

### Requirement: REQ-PB-04 — Parameter Form at Scan Launch

Playbook parameters MUST be filled via a UI form before scan launch. The form MUST be generated from the playbook's `parameters` schema. A scan MUST NOT launch if required parameters have not been filled.

#### Scenario: Required parameter blocks launch

- GIVEN a playbook with required parameter `targetPackage`
- WHEN the user submits the scan form without filling `targetPackage`
- THEN the form shows a validation error and the scan is not created

#### Scenario: Optional parameter omitted — scan launches

- GIVEN a playbook with optional parameter `severity` defaulting to `'high'`
- WHEN the user submits without setting `severity`
- THEN the scan launches with `severity: 'high'`

---

### Requirement: REQ-PB-05 — Built-in Playbooks

The system SHALL ship 5 built-in playbooks: `audit-auth-surface`, `find-ssrf`, `pre-release-sweep`, `deserialization-sweep`, `oauth-flow-review`. Built-ins MUST be loaded from the application package, not from the user's filesystem. They MUST be treated as first-party (trusted by default).

#### Scenario: Built-in playbooks available after install

- GIVEN a fresh installation with no user-defined playbooks
- WHEN the playbook list is fetched
- THEN all 5 built-in names appear in the response

#### Scenario: Built-in cannot be overridden by same name in global dir

- GIVEN a user creates `~/.obt/playbooks/audit-auth-surface.yaml`
- WHEN the loader runs
- THEN the user's version is treated as a custom override (workspace-local precedence rules apply), and a warning is emitted

---

### Requirement: REQ-PB-06 — Save Scan Prompt as Playbook

The user SHALL be able to create a new playbook from the UI by saving the current scan's prompt as a playbook template. The resulting `.obt-skill` manifest MUST be written to `{workspace}/.obt/playbooks/` and immediately available for future scans.

#### Scenario: Save as playbook creates manifest file

- GIVEN a completed scan with a prompt
- WHEN the user enters a name and clicks "Save as playbook"
- THEN a `.obt-skill` file is written to `{workspace}/.obt/playbooks/{name}.yaml`
- AND a `POST /api/playbooks` request returns `201` with the new playbook metadata

---

## New Domain: secret-timeline

### Requirement: REQ-ST-01 — Timeline Derivation for Secret Findings

For any finding where `detector` is `gitleaks` or `trufflehog`, the system SHALL derive an exposure timeline: the first commit introducing the secret, the last commit where it was present, and all commits in between. Derivation MUST use `git log -p -S <secret-value> -- <file-path>` or an equivalent file+line heuristic when the secret value is unavailable. The timeline MUST be cached in `finding_timelines` and invalidated when the same file is touched in a subsequent scan.

#### Scenario: Timeline derived for gitleaks finding

- GIVEN a finding from `gitleaks` with a matched secret value and file path
- WHEN the timeline derivation runs
- THEN `finding_timelines` contains the introducing commit hash, author, date, and at least one commit entry

#### Scenario: Timeline cached on second request

- GIVEN `finding_timelines` already has an entry for finding F
- WHEN the timeline endpoint is requested again
- THEN `git log` is NOT re-executed; the cached result is returned

#### Scenario: git log timeout — partial result returned

- GIVEN `git log -S` runs for more than 60 seconds on a large repo
- WHEN the timeout fires
- THEN the timeline returns whatever commits were collected up to that point
- AND the response includes a `partial: true` flag

---

### Requirement: REQ-ST-02 — Timeline Commit Metadata

Each commit in the timeline MUST include: commit hash (full SHA), author name, author email, commit date (ISO 8601), and branch name(s) where the commit appears.

#### Scenario: All metadata fields present

- GIVEN a timeline for a secret found in commit `abc123`
- WHEN the timeline data is returned
- THEN each entry has `hash`, `author`, `email`, `date`, and `branches` fields
- AND no field is null (empty array is acceptable for `branches`)

---

### Requirement: REQ-ST-03 — Suspected Deploys Estimate

The system SHALL count commits on `main` or `master` within the exposure window and surface this as a `suspectedDeploys` count. Every deploy estimate MUST be labeled "suspected — based on main/master merge" and MUST NOT claim to be a confirmed deploy count.

#### Scenario: Suspected deploys counted

- GIVEN a secret was live from commit A to commit B, and 3 merges to `main` occurred in that window
- WHEN the timeline is computed
- THEN `suspectedDeploys: 3` is returned
- AND the API response includes `deployBasis: 'main-merges'`

#### Scenario: No main/master branch — suspectedDeploys is 0

- GIVEN the repo has no `main` or `master` branch
- WHEN the timeline is computed
- THEN `suspectedDeploys: 0` is returned without error

---

### Requirement: REQ-ST-04 — Timeline UI on Finding Detail

The timeline view MUST be rendered on the finding detail page at `/findings/[id]/timeline`. It MUST display: introducing commit, exposure window duration, list of commits, and suspected deploy count — all in a visual timeline component (`SecretTimeline`).

#### Scenario: Timeline page renders introducing commit

- GIVEN a finding with a computed timeline
- WHEN the user navigates to `/findings/{id}/timeline`
- THEN the introducing commit hash, author, and date are visible on the page

#### Scenario: Timeline page shows exposure window duration

- GIVEN first commit on day 0 and last commit on day 19
- WHEN the timeline page renders
- THEN a human-readable duration ("19 days") is displayed

---

### Requirement: REQ-ST-05 — Request Rotation Action

The timeline page SHALL surface a "Request rotation" action that pre-fills a Slack message or GitHub issue body with: secret type, file path, exposure window, introducing commit, and suspected deploy count. The action MUST NOT auto-send — it opens a pre-filled draft for the user to review and send.

#### Scenario: Slack draft opens with exposure evidence

- GIVEN a timeline with all fields populated
- WHEN the user clicks "Request rotation (Slack)"
- THEN a Slack deep-link or modal opens pre-filled with the exposure summary
- AND no API call to Slack is made automatically

#### Scenario: GitHub issue draft opens with exposure evidence

- GIVEN the user clicks "Request rotation (GitHub Issue)"
- THEN a GitHub new-issue URL is opened with the title and body pre-filled
- AND the user must click "Submit issue" themselves

---

## Delta: scan-pipeline (MODIFIED)

### Requirement: Scan Mode Dispatch

The runner MUST dispatch to a per-mode strategy after stage1. Supported modes are `quick`, `standard`, `intermediate`, `paranoid`, `hunt`, and `playbook:<name>@<version>`. The runner MUST NOT contain inline per-mode branching logic — all mode-specific behavior lives in the strategy implementation.
(Previously: supported modes were `quick`, `standard`, `intermediate`, `paranoid` only)

#### Scenario: quick mode

- GIVEN a scan with `scanMode: 'quick'`
- WHEN the runner reaches post-stage1 dispatch
- THEN only stage1 classical findings are forwarded to stage4; all LLM stages are skipped

#### Scenario: standard mode

- GIVEN a scan with `scanMode: 'standard'`
- WHEN the runner reaches post-stage1 dispatch
- THEN the StandardStrategy is invoked: one LLM pass with skill rules injected for detected stack, then stages 3–5

#### Scenario: intermediate mode

- GIVEN a scan with `scanMode: 'intermediate'`
- WHEN the runner reaches post-stage1 dispatch
- THEN the OrchestratedStrategy is invoked: Pass 0 generates ProjectMap (3–4 domains), then one domain pass per domain, then stages 3–5

#### Scenario: paranoid mode

- GIVEN a scan with `scanMode: 'paranoid'`
- WHEN the runner reaches post-stage1 dispatch
- THEN the OrchestratedStrategy is invoked: Pass 0 generates ProjectMap (5–7 domains), domain passes with fix suggestions, then stages 3–5

#### Scenario: hunt mode dispatched

- GIVEN a scan with `strategy: 'hunt'`
- WHEN the runner reaches dispatch
- THEN HuntStrategy is invoked

#### Scenario: playbook strategy dispatched

- GIVEN a scan with `strategy: 'playbook:find-ssrf@1.0.0'`
- WHEN the runner reaches dispatch
- THEN the PlaybookStrategy for `find-ssrf` v1.0.0 is instantiated

#### Scenario: unknown mode received at runtime

- GIVEN a scan record in the DB with an unrecognized `scanMode` value
- WHEN the runner initialises
- THEN it falls back to `standard` mode and emits a warning event

---

## Delta: scan-schema (ADDED)

### Requirement: REQ-SS-01 — New Tables

The database MUST add 4 new tables: `playbooks`, `hunt_targets`, `scan_forks`, `finding_timelines`. All tables MUST have `created_at` and `updated_at` columns defaulting to current timestamp. Migrations MUST be idempotent.

#### Scenario: Tables present after migration

- GIVEN the v0.3 migration has run
- WHEN the schema is introspected
- THEN all 4 tables exist with correct columns

---

### Requirement: REQ-SS-02 — scans.strategy Column Widened

The `scans.strategy` column MUST accept: `quick | standard | intermediate | paranoid | hunt | playbook:<name>@<version>`. The `hunt` value MUST be valid. Dynamic `playbook:*` values MUST NOT be constrained by a DB enum — stored as free-text.

#### Scenario: hunt strategy stored

- GIVEN a scan row is inserted with `strategy: 'hunt'`
- WHEN the row is read back
- THEN `strategy` equals `'hunt'`

---

### Requirement: REQ-SS-03 — findings.timeline_computed_at Column

The `findings` table MUST gain a nullable `timeline_computed_at TIMESTAMP` column. A non-null value indicates the timeline was computed. A subsequent scan touching the same file path MUST set this to NULL to trigger recomputation.

#### Scenario: Recomputation triggered on re-scan

- GIVEN `findings.timeline_computed_at` is set for finding F at file `/src/auth.ts`
- WHEN a new scan touches `/src/auth.ts`
- THEN `timeline_computed_at` is set to NULL for finding F

---

## Delta: rich-event-taxonomy (ADDED)

### Requirement: REQ-RET-01 — Console Event Types

Four new `ScanEvent` types MUST be added to the discriminated union: `user_injection`, `plan_edit`, `tool_call_rejected`, `fork_point`. Each MUST have a Zod schema and a corresponding TypeScript type. Existing event types MUST remain unchanged.

| Type | Required fields |
|---|---|
| `user_injection` | `scanId: string, text: string, timestamp: string` |
| `plan_edit` | `scanId: string, steps: PlanStep[], timestamp: string` |
| `tool_call_rejected` | `scanId: string, requestId: string, redirectInstruction?: string, timestamp: string` |
| `fork_point` | `parentScanId: string, forkAtEventId: number, newScanId: string` |

#### Scenario: user_injection event parses

- GIVEN `{ type: 'user_injection', scanId: 's-1', text: 'focus on auth', timestamp: '2026-05-06T00:00:00Z' }`
- WHEN `scanEventSchema.parse(obj)` is called
- THEN a typed `UserInjectionEvent` is returned without error

#### Scenario: fork_point event in SSE stream

- GIVEN a fork is created from scan `s-1` at event 30
- WHEN the fork completes
- THEN a `fork_point` event is emitted on the SSE stream of the new scan

---

## Delta: permission-bridge (MODIFIED)

### Requirement: POST /api/scans/[id]/permission Endpoint

The endpoint MUST accept `POST /api/scans/[id]/permission` with a Zod-validated JSON body: `{ requestId: string, approved: boolean, redirectInstruction?: string }`. On success it MUST return `200 { ok: true }`. It MUST return `404` for unknown or expired `requestId`. It MUST return `400` for malformed body. When `redirectInstruction` is present and `approved` is `false`, the bridge MUST emit the instruction as a user-turn ACP message after denying the tool call.
(Previously: body had no `redirectInstruction` field; denial had no follow-up user-turn)

#### Scenario: Approval resolves pending promise

- GIVEN request `pr-abc` is pending for scan `s-1`
- WHEN `POST /api/scans/s-1/permission` with `{ requestId: 'pr-abc', approved: true }` is called
- THEN the pending promise MUST resolve to `true`
- AND the response MUST be `200 { ok: true }`

#### Scenario: Denial with redirect sends user-turn

- GIVEN request `pr-abc` is pending
- WHEN `POST` is called with `{ approved: false, redirectInstruction: 'use read-only tools' }`
- THEN the pending promise resolves to `false`
- AND a user-turn ACP message containing `'use read-only tools'` is sent to the session

#### Scenario: Denial without redirect — no user-turn

- GIVEN request `pr-abc` is pending
- WHEN `POST` is called with `{ approved: false }` (no `redirectInstruction`)
- THEN the pending promise resolves to `false`
- AND no additional ACP message is sent

#### Scenario: Unknown requestId returns 404

- GIVEN no entry for `requestId: 'nonexistent'` exists
- WHEN `POST /api/scans/s-1/permission` with that `requestId` is sent
- THEN the response MUST be `404`

#### Scenario: Malformed body returns 400

- GIVEN a POST body with `approved: "yes"` (string instead of boolean)
- WHEN the endpoint receives it
- THEN Zod validation MUST fail and the response MUST be `400`

#### Scenario: Expired requestId returns 404

- GIVEN a permission request timed out 5 seconds ago
- WHEN `POST /api/scans/[id]/permission` is called with that `requestId`
- THEN the response MUST be `404`

---

## Delta: ui-components (ADDED)

### Requirement: REQ-UI-01 — Console Components

The investigation console MUST add 5 new UI components: `PlanEditor`, `ToolCallPrompt` (reject+redirect), `TimelineScrubber`, `SecretTimeline`, and `ForkButton`. Each MUST follow existing component conventions (Tailwind, no hardcoded `.obt` paths, JSDoc on exports).

#### Scenario: PlanEditor renders steps from PlanEvent

- GIVEN the last `plan` event has 3 steps
- WHEN `PlanEditor` renders
- THEN all 3 steps are shown as editable text fields

#### Scenario: ForkButton disabled when scan not running

- GIVEN a scan in `done` state
- WHEN `ForkButton` renders
- THEN the button is disabled

#### Scenario: SecretTimeline shows exposure window

- GIVEN timeline data with `firstCommit` and `lastCommit` dates
- WHEN `SecretTimeline` renders
- THEN the exposure duration in human-readable form is visible

---

## Open Questions (deferred to design)

| ID | Question | Impact |
|---|---|---|
| Q1 | Prompt injection transport: `sendMessage` mid-session vs. queuing to `permission_request`? | REQ-IC-01 implementation |
| Q2 | `.obt-skill` manifest schema — YAML vs JSON, all required fields? | REQ-PB-01 implementation |
| Q3 | Git log correlation: secret value match vs. file+line heuristic? | REQ-ST-01 implementation |
| Q4 | Fork checkpoint storage: full event copy or pointer + fork-only delta? | REQ-IC-04 implementation |
| Q5 | Multi-package advisory: one combined scan or one scan per package? | REQ-CH-06 implementation |
| Q6 | Tool-call rejection `StopReason` mapping when agent deadlocks post-denial? | REQ-IC-03 edge case |
