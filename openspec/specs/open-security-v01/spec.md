# open-security v0.1 — Full Specification

## Purpose

Open-source, local-first Blue Team security workbench. Single Next.js 16 App Router process with no login, no telemetry, and no daemon. Users bring their own keys (BYOK). Apache-2.0.

---

## 1. Source Ingestion

### Requirement: GitHub Repository Clone

The system MUST accept a GitHub HTTPS URL and a Personal Access Token (PAT), clone the repository to a temporary working directory under `.obt/workspaces/{scan-id}/`, and make all file contents available to the pipeline.

#### Scenario: Successful GitHub clone

- GIVEN a valid GitHub HTTPS URL and a valid PAT with read access
- WHEN the user submits the source form
- THEN the repository is cloned to `.obt/workspaces/{scan-id}/repo/`
- AND the scan pipeline is initiated

#### Scenario: Invalid PAT

- GIVEN a valid GitHub URL and an expired or invalid PAT
- WHEN the user submits the source form
- THEN the API returns `{ success: false, error: "Authentication failed: invalid PAT" }`
- AND no workspace directory is created

#### Scenario: Repository not found

- GIVEN a GitHub URL pointing to a non-existent repository
- WHEN the user submits the source form
- THEN the API returns `{ success: false, error: "Repository not found" }`

---

### Requirement: GitLab Repository Clone

The system MUST accept a GitLab HTTPS URL and a PAT, applying the same cloning and error-handling behavior as GitHub ingestion.

#### Scenario: Successful GitLab clone

- GIVEN a valid GitLab HTTPS URL and a valid PAT
- WHEN the user submits the source form
- THEN the repository is cloned to `.obt/workspaces/{scan-id}/repo/`

#### Scenario: GitLab self-hosted host

- GIVEN a URL with a non-gitlab.com host (e.g., `https://git.corp.example.com/org/repo`)
- WHEN the user submits the source form
- THEN the system treats it as a generic Git remote and attempts clone with the PAT as credential

---

### Requirement: Local Folder Ingestion

The system MUST accept an absolute path to a local directory, copy its contents to `.obt/workspaces/{scan-id}/repo/`, and reject any path that escapes the filesystem root or points to a system directory.

#### Scenario: Valid local path

- GIVEN an absolute path to a readable directory within the user's home or project directory
- WHEN the user submits the source form
- THEN the directory is copied to the workspace

#### Scenario: Path traversal attempt

- GIVEN a path containing `../` sequences or pointing to `/etc`, `/sys`, or `/proc`
- WHEN the user submits the source form
- THEN the API returns `{ success: false, error: "Path not allowed" }`
- AND no workspace is created

---

### Requirement: ZIP Upload Ingestion

The system MUST accept a ZIP file upload, validate it with yauzl before extraction, enforce a maximum size cap of 200 MB (compressed), reject any entry whose resolved path escapes the target directory, and reject any entry that is a symlink.

#### Scenario: Valid ZIP upload

- GIVEN a ZIP file under 200 MB with no symlinks or path-traversal entries
- WHEN the user uploads the file
- THEN all entries are extracted to `.obt/workspaces/{scan-id}/repo/`

#### Scenario: ZIP over size limit

- GIVEN a ZIP file whose compressed size exceeds 200 MB
- WHEN the user uploads the file
- THEN the API returns `{ success: false, error: "ZIP exceeds maximum size of 200 MB" }`

#### Scenario: ZIP with symlink entry

- GIVEN a ZIP file containing at least one symlink entry
- WHEN the system begins extraction
- THEN extraction is aborted and returns `{ success: false, error: "ZIP contains symlink entries" }`

#### Scenario: ZIP path traversal entry

- GIVEN a ZIP file with an entry whose path resolves outside the target directory (e.g., `../../etc/passwd`)
- WHEN the system begins extraction
- THEN extraction is aborted and returns `{ success: false, error: "ZIP contains path traversal entry" }`

---

## 2. Scan Pipeline

### Requirement: Five-Stage Pipeline Execution

The system MUST execute scans in five ordered stages: (1) prep, (2) classical pre-pass, (3) LLM scan, (4) validation, (5) FP filter and patch synthesis. Each stage MUST complete or fail before the next begins. A stage failure MUST halt the pipeline with a persisted error state.

#### Scenario: All stages succeed

- GIVEN a valid source workspace and at least one configured LLM model
- WHEN the scan is started
- THEN stages execute in order 1 → 5
- AND each stage's status transitions: `pending` → `running` → `done`

#### Scenario: Stage 2 classical scanner not found

- GIVEN gitleaks binary is not on PATH
- WHEN the classical pre-pass stage runs
- THEN that scanner's result is marked `skipped` with reason `"binary not found"`
- AND the pipeline continues to the next scanner within stage 2

#### Scenario: Pipeline stage error

- GIVEN the LLM provider returns a non-retryable error during stage 3
- WHEN stage 3 is running
- THEN the stage transitions to `failed`
- AND the pipeline halts
- AND the scan record in the database stores `status: "failed"` with the error message

---

### Requirement: SSE Streaming of Pipeline Progress

The system MUST stream real-time progress updates to the client via Server-Sent Events (SSE) at `/api/scans/{scan-id}/stream`. Updates MUST include stage transitions, per-finding discoveries, and pipeline completion or error events.

#### Scenario: Client connects to SSE stream

- GIVEN a scan is in progress
- WHEN the client opens a connection to `/api/scans/{scan-id}/stream`
- THEN the server sends an `open` event immediately
- AND subsequent `stage` and `finding` events are emitted as they occur

#### Scenario: Stage transition event

- GIVEN the pipeline advances from stage 2 to stage 3
- WHEN the stage transition occurs
- THEN an SSE event of type `stage` is sent: `{ stageId: 3, status: "running", name: "llm-scan" }`

#### Scenario: Client reconnects mid-scan

- GIVEN a client disconnects and reconnects within the same scan
- WHEN the client opens a new SSE connection
- THEN the server replays all events emitted since scan start before resuming live events

---

### Requirement: Finding Schema

Every finding persisted in the database and emitted over SSE MUST conform to the canonical finding schema: `id`, `scanId`, `ruleId`, `title`, `description`, `severity` (critical | high | medium | low | info), `confidence` (0.0–1.0), `filePath`, `lineStart`, `lineEnd` (nullable), `snippet` (nullable), `source` (scanner name or llm-provider slug), `validated` (boolean), `falsePositive` (boolean), `patch` (nullable text), `createdAt`.

#### Scenario: Classical scanner finding persisted

- GIVEN gitleaks detects a secret in `config.yaml` at line 14
- WHEN the classical pre-pass stage completes
- THEN a finding is inserted with `severity: "high"`, `source: "gitleaks"`, `validated: false`, `falsePositive: false`

#### Scenario: LLM finding with patch

- GIVEN the LLM stage returns a finding with a suggested patch
- WHEN the finding is persisted
- THEN the `patch` field contains the LLM-supplied remediation text
- AND `source` is set to the LLM provider slug (e.g., `"anthropic/claude-3-7-sonnet"`)

---

## 3. Classical Scanners

### Requirement: Gitleaks Detection and Normalization

The system MUST invoke gitleaks via subprocess on the workspace directory, parse its JSON output, and normalize each result into the canonical finding schema. If gitleaks is not on PATH, the scanner MUST be skipped (not failed).

#### Scenario: Secret detected by gitleaks

- GIVEN gitleaks finds an AWS key in `src/config.ts`
- WHEN gitleaks output is parsed
- THEN a finding is created with `ruleId` set to the gitleaks rule ID, `severity: "high"`, `source: "gitleaks"`

#### Scenario: Gitleaks binary absent

- GIVEN `which gitleaks` returns nothing
- WHEN the classical pre-pass stage runs
- THEN gitleaks is listed in the stage result as `{ scanner: "gitleaks", status: "skipped", reason: "binary not found" }`

---

### Requirement: Trufflehog Detection and Normalization

The system MUST invoke trufflehog via subprocess with `--json` output, parse results, and normalize to the canonical finding schema. Binary absence MUST result in `skipped`, not an error.

#### Scenario: Trufflehog detects verified secret

- GIVEN trufflehog returns a verified credential finding
- WHEN results are normalized
- THEN the finding has `confidence: 0.95` and `validated: false` (pending human confirmation)

---

### Requirement: Semgrep Detection and Normalization

The system MUST invoke semgrep with `--json` output, parse the `results` array, and normalize each entry to the canonical finding schema. Semgrep MUST be run with the `p/default` ruleset unless overridden in config.

#### Scenario: Semgrep code finding

- GIVEN semgrep finds an SQL injection pattern
- WHEN results are normalized
- THEN the finding has `source: "semgrep"`, `ruleId` matching the semgrep rule ID, and severity mapped from semgrep's `severity` field

---

### Requirement: OSV-Scanner Detection and Normalization

The system MUST invoke osv-scanner on the workspace, parse its JSON output for vulnerability entries, and normalize each to the canonical finding schema with `source: "osv-scanner"`.

#### Scenario: Known CVE detected

- GIVEN osv-scanner identifies a dependency with a known CVE
- WHEN results are normalized
- THEN the finding has `ruleId` set to the CVE identifier and `severity` mapped from CVSS score ranges: 9.0–10.0 → critical, 7.0–8.9 → high, 4.0–6.9 → medium, 0.1–3.9 → low

---

## 4. LLM Providers

### Requirement: CLI PATH Auto-Detection

The system MUST auto-detect available CLI LLM tools at scan time by checking PATH for: `claude`, `codex`, `gemini`, `opencode`, `qwen`, `cursor-agent`, `ollama`. Detected tools MUST be listed as available providers in the config and model picker UI.

#### Scenario: claude CLI on PATH

- GIVEN the `claude` binary is present in PATH
- WHEN the system performs provider detection
- THEN `claude` appears in the available providers list with `type: "cli"`

#### Scenario: No CLI tools on PATH

- GIVEN none of the supported CLI tools are on PATH
- WHEN the system performs provider detection
- THEN no CLI providers appear; the user is prompted to configure API keys or install CLI tools

---

### Requirement: Vercel AI SDK API Key Providers

The system MUST support raw API key configuration for Anthropic, OpenAI, Google, Ollama, Groq, and OpenRouter via the Vercel AI SDK (`ai` package). Keys MUST be stored encrypted at rest in `.obt/config.enc.json`. The system MUST use `streamText` from the AI SDK for all API-path LLM calls.

#### Scenario: Valid Anthropic API key configured

- GIVEN a valid `ANTHROPIC_API_KEY` is stored in config
- WHEN stage 3 runs with an Anthropic model selected
- THEN `streamText` is called with the Anthropic provider and the configured key
- AND streamed tokens are forwarded over the scan SSE channel

#### Scenario: Invalid API key

- GIVEN an invalid API key is configured for a provider
- WHEN the LLM stage attempts to call that provider
- THEN the stage logs `{ provider: "anthropic", error: "authentication error" }`
- AND the pipeline marks the stage as `failed`

---

### Requirement: Per-Stage Model Assignment

The system MUST allow users to assign a specific LLM model to each pipeline stage (stages 3, 4, 5) independently. Assignments MUST be persisted in config and respected at scan time.

#### Scenario: Different models for stage 3 and stage 4

- GIVEN stage 3 is assigned `claude-3-7-sonnet` and stage 4 is assigned `gpt-4o`
- WHEN the pipeline runs
- THEN stage 3 calls claude-3-7-sonnet and stage 4 calls gpt-4o independently

---

## 5. Git History Forensics

### Requirement: Full Commit Walk

The system MUST walk the full git history of the workspace repository using `simple-git`, visiting every commit reachable from HEAD.

#### Scenario: Repository with 100 commits

- GIVEN a repository with 100 commits
- WHEN git history forensics runs
- THEN all 100 commits are visited and stored in the `commits` table

---

### Requirement: Secret-in-History Detection

The system MUST scan the diff of each commit for patterns matching known secret formats (regex patterns equivalent to gitleaks rules). A finding MUST be generated for each match, associated with the commit SHA and file path.

#### Scenario: Secret added in old commit then deleted

- GIVEN a commit 50 revisions back added an AWS key that was later removed
- WHEN secret-in-history detection runs
- THEN a finding is generated with `ruleId: "secret-in-history"`, `source: "git-forensics"`, and the commit SHA in the finding metadata

---

### Requirement: Suspicious Commit Detection

The system MUST flag commits that match at least one of: (a) commit message contains keywords from a configurable blocklist (default: `password`, `secret`, `key`, `token`, `hack`, `backdoor`), (b) unusually large diff (>500 lines changed in a single commit), (c) commit authored outside normal contributor hours (>3 standard deviations from author's median commit hour).

#### Scenario: Commit message contains "hardcoded password"

- GIVEN a commit whose message contains the word "password"
- WHEN suspicious-commit detection runs
- THEN a finding is generated with `ruleId: "suspicious-commit-message"` and `severity: "medium"`

---

### Requirement: Author Anomaly Detection

The system MUST build a profile per author (email + name) across all commits and flag authors that: (a) appear only once in history, (b) have an email domain not seen in any other commit, or (c) have a name/email mismatch relative to prior commits using the same name.

#### Scenario: Single-commit author with external domain

- GIVEN an author who committed once from `attacker@external.io` while all other authors use `@company.com`
- WHEN author-anomaly detection runs
- THEN a finding is generated with `ruleId: "author-anomaly"` and `severity: "low"`

---

## 6. Findings Store

### Requirement: Drizzle Schema for Findings

The system MUST define the following tables in Drizzle ORM with better-sqlite3: `scans`, `findings`, `commits`, `authors`. The `findings` table MUST include all fields from the canonical finding schema. The database file MUST be located at `.obt/db.sqlite`.

#### Scenario: New scan created

- GIVEN a scan is initiated
- WHEN the scan record is inserted
- THEN a row in `scans` has `id` (uuid), `status: "pending"`, `sourceType`, `sourceRef`, `createdAt`

#### Scenario: Finding inserted

- GIVEN the classical pre-pass stage produces a finding
- WHEN the finding is persisted
- THEN a row is inserted in `findings` with all required fields populated and `falsePositive: false`

---

### Requirement: Findings CRUD API

The system MUST expose the following API endpoints: `GET /api/scans/{id}/findings` (paginated), `PATCH /api/findings/{id}` (update `validated`, `falsePositive`, `patch` fields), `DELETE /api/findings/{id}`. All responses MUST use the envelope: `{ success, data, error, meta }`.

#### Scenario: Paginated findings list

- GIVEN a scan with 150 findings
- WHEN `GET /api/scans/{id}/findings?page=2&limit=50` is called
- THEN the response contains 50 findings and `meta: { total: 150, page: 2, limit: 50 }`

#### Scenario: Mark finding as false positive

- GIVEN a finding with `falsePositive: false`
- WHEN `PATCH /api/findings/{id}` is called with `{ falsePositive: true }`
- THEN the database record is updated and the response contains `{ success: true, data: { ...finding, falsePositive: true } }`

---

## 7. Report Export

### Requirement: Markdown Report (Interlinked)

The system MUST generate a root `report.md` containing a summary table of all findings, with each finding linking to an individual `findings/{finding-id}.md` file containing full detail. Reports MUST be written to `.obt/reports/{scan-id}/`.

#### Scenario: MD report generated

- GIVEN a completed scan with 3 findings
- WHEN the user requests MD export
- THEN `report.md` contains a table with 3 rows, each linking to `findings/{id}.md`
- AND each `findings/{id}.md` exists and contains the finding's full details

---

### Requirement: JSON Report

The system MUST export a `report.json` containing the full scan object and all findings array in a single file.

#### Scenario: JSON report structure

- GIVEN a completed scan
- WHEN JSON export is requested
- THEN `report.json` contains `{ scan: { ... }, findings: [ ... ] }` with all finding fields populated

---

### Requirement: SARIF Report

The system MUST export a SARIF 2.1.0-compliant `report.sarif` file, mapping each finding to a SARIF `result` with `ruleId`, `message.text`, `locations[0].physicalLocation`, and `level` (mapped from severity).

#### Scenario: SARIF severity mapping

- GIVEN a finding with `severity: "critical"`
- WHEN SARIF export runs
- THEN the SARIF result has `level: "error"`
- AND a finding with `severity: "info"` maps to `level: "note"`

---

### Requirement: CSV Report

The system MUST export a `report.csv` with one row per finding, including columns: `id`, `title`, `severity`, `confidence`, `filePath`, `lineStart`, `source`, `validated`, `falsePositive`.

#### Scenario: CSV row count

- GIVEN a scan with 10 findings
- WHEN CSV export runs
- THEN `report.csv` contains 11 lines (1 header + 10 data rows)

---

## 8. Config and Theme

### Requirement: API Key Storage

The system MUST store all provider API keys encrypted at rest in `.obt/config.enc.json`. Keys MUST never appear in logs, SSE events, or API responses. The config page MUST allow CRUD for all supported provider keys.

#### Scenario: API key saved

- GIVEN the user enters an Anthropic API key on the config page
- WHEN the form is submitted
- THEN the key is written to `.obt/config.enc.json` and NOT echoed in any response body

#### Scenario: Key retrieval for scan

- GIVEN an encrypted key is stored in config
- WHEN the pipeline requests the key for a provider
- THEN the key is decrypted in-process and passed to the SDK — it is never logged or serialized to a response

---

### Requirement: Prerequisite Check

The system MUST provide a prereq check endpoint (`GET /api/config/prereqs`) that verifies the presence of `git`, `gitleaks`, `semgrep`, and `trufflehog` on PATH, returning a per-tool status.

#### Scenario: All tools present

- GIVEN all four tools are on PATH
- WHEN `GET /api/config/prereqs` is called
- THEN the response is `{ success: true, data: { git: "ok", gitleaks: "ok", semgrep: "ok", trufflehog: "ok" } }`

#### Scenario: semgrep missing

- GIVEN `semgrep` is not on PATH
- WHEN `GET /api/config/prereqs` is called
- THEN the response includes `semgrep: "missing"` and `success: true` (degraded, not failed)

---

### Requirement: Light/Dark Theme Persistence

The system MUST implement light and dark themes using CSS custom properties. The selected theme MUST be persisted in `localStorage` under key `obt-theme` and applied on page load before first render to prevent flash of unstyled content.

#### Scenario: Theme toggle persisted

- GIVEN the user switches from light to dark theme
- WHEN the page is reloaded
- THEN the dark theme is applied before the first render

#### Scenario: Default theme

- GIVEN no `obt-theme` value is in localStorage
- WHEN the page loads
- THEN the system applies the OS-level preferred color scheme via `prefers-color-scheme`

---

## 9. Security Invariants

### Requirement: ZIP Extraction Safety

The system MUST NOT extract any ZIP entry that (a) resolves to a path outside the target workspace directory, (b) is a symlink, or (c) has a compressed size that would cause the total extracted size to exceed 500 MB. Violation of any condition MUST abort extraction and delete any partially extracted files.

#### Scenario: Zip bomb detection

- GIVEN a ZIP where small compressed entries expand to > 500 MB total
- WHEN extraction begins
- THEN extraction is halted once the 500 MB threshold is reached
- AND all partially extracted files are deleted

---

### Requirement: Command Injection Prevention

The system MUST NOT construct subprocess commands via string concatenation with user-supplied input. All subprocess calls MUST use array-form arguments (e.g., `spawn(binary, [arg1, arg2])`) and MUST NOT pass user-supplied values as shell-interpreted strings.

#### Scenario: User-supplied path in subprocess call

- GIVEN a workspace path set to a directory name containing spaces and special chars
- WHEN any classical scanner subprocess is spawned
- THEN the path is passed as a discrete array element, not interpolated into a shell string
- AND the subprocess executes without shell interpretation

---

### Requirement: No Telemetry

The system MUST NOT make any outbound network calls except: (a) user-initiated repository clones, (b) user-initiated LLM API calls using configured keys, (c) osv-scanner's own advisory database fetching (if configured). No analytics, crash reporting, or usage metrics may be sent.

#### Scenario: Scan completes with no unexpected outbound calls

- GIVEN a local folder scan with no LLM providers configured
- WHEN the full pipeline runs
- THEN no outbound HTTP connections are made (verifiable via network mock in integration tests)

---

### Requirement: Input Validation at API Boundaries

The system MUST validate all incoming API request bodies using zod schemas. Invalid input MUST be rejected with HTTP 400 and `{ success: false, error: "<validation message>" }` before any business logic executes.

#### Scenario: Missing required field in scan start request

- GIVEN a POST to `/api/scans` with missing `sourceType`
- WHEN the request reaches the API handler
- THEN the handler returns HTTP 400 with `{ success: false, error: "sourceType is required" }` before any file I/O occurs

#### Scenario: Invalid severity override in PATCH

- GIVEN a PATCH to `/api/findings/{id}` with `{ severity: "ultramax" }`
- WHEN the request is validated
- THEN HTTP 400 is returned with a descriptive zod validation error

---

## Disabled / Coming Soon (UI Stubs Only)

### Requirement: PDF and PoC Script Buttons Are Non-Functional Stubs

The system MUST render "Export PDF" and "Generate PoC Script" buttons in the UI in a visually disabled state. These buttons MUST NOT trigger any action. A tooltip or label MUST indicate "Coming Soon".

#### Scenario: PDF export button click

- GIVEN the scan results page is rendered
- WHEN the user clicks "Export PDF"
- THEN no action occurs and the button remains disabled
