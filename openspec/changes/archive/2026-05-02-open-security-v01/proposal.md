# Proposal: open-security v0.1 MVP

## Intent

Small Blue Teams have no local-first, BYOK option to combine semantic LLM reasoning with classical SAST/secret scanners and full git-history forensics. Cloud SaaS leaks code; classical tools miss intent; AI scanners are vendor-locked. We ship a local Next.js workbench that ingests a repo (GitHub/GitLab/folder/ZIP), runs a 5-stage pipeline (classical pre-pass → LLM scan → LLM validation → FP filter → patch synthesis), and surfaces validated findings, suspicious commits, leaked secrets, and patch diffs — all driven by whichever LLM CLI or API key the user already has.

## Scope

### In Scope (v0.1)
- Source ingestion: GitHub URL+PAT, GitLab URL+PAT, local folder, ZIP upload (extract to `.obt/projects/<id>/`)
- 5-stage pipeline with parallel classical pre-pass (gitleaks, trufflehog, semgrep, osv-scanner) and SSE streaming
- BYOK multi-model: PATH auto-detect (claude, codex, gemini, opencode, qwen, ollama, cursor-agent) + raw API key via **Vercel AI SDK** (Anthropic, OpenAI, Google, Ollama, Groq, OpenRouter); per-stage model picker
- CLI agents spawned as child processes (port of open-design's agents.ts pattern — user's existing CLI config/tuning is preserved)
- 12 detectors as `detectors/<name>/SKILL.md` + `rules.yaml` + `tests/`
- Git-history walk: secret-in-history, suspicious-commit, author-anomaly
- UI screens: source picker, scan progress (SSE), findings dashboard, commit timeline, author profiles, chat sidebar, config page (keys, prereq check, theme)
- Reports: MD (interlinked — one root report + per-finding detail files), JSON, SARIF, CSV
- Light/dark theme via CSS custom properties + localStorage
- Headless CLI `obt` (scan, history, watch, report, agents)
- SQLite persistence via **Drizzle ORM + better-sqlite3**; Apache-2.0; no telemetry

### Coming Soon (v0.2)
- **PDF reports** with light/dark templates (UI shows disabled button with "Coming soon" label)
- **PoC script generation** — Python exploit scripts for confirmed findings, Blue Team validation only (UI shows disabled button with "Coming soon" label)

### Out of Scope (v0.2+)
- PR watch / GitHub App webhook (Flow C)
- Active exploitation / red-team payload generation (philosophically out)
- Runtime / DAST scanning, container image scanning beyond osv-scanner
- Hosted SaaS, multi-user auth, team sharing

## Capabilities

### New Capabilities
- `source-ingestion`: clone GitHub/GitLab repos, copy local folders, extract ZIPs into `.obt/projects/<id>/`
- `scan-pipeline`: orchestrate the 5-stage pipeline (prep → classical → LLM scan → validation → FP filter → patch) with SSE streaming
- `classical-scanners`: detect, invoke, and normalize output from gitleaks, trufflehog, semgrep, osv-scanner
- `model-providers`: two paths — (1) CLI spawn (PORT of open-design agents.ts: PATH detect, buildArgs, stdout parser per streamFormat), (2) Vercel AI SDK for raw API keys (Anthropic, OpenAI, Google, Ollama, Groq, OpenRouter via unified `streamText`); per-stage model assignment
- `detector-registry`: load `detectors/<name>/SKILL.md` bundles at startup
- `git-history-forensics`: walk commits, detect secret-in-history, suspicious-commit, author-anomaly
- `findings-store`: Drizzle ORM + better-sqlite3; findings with severity, confidence, validation, patch, evidence history
- `report-export`: MD (root + per-finding interlinked), JSON, SARIF, CSV — PDF and PoC scripts are Coming Soon stubs
- `config-management`: API keys (stored in `.obt/config.json`, chmod 600), model assignments per stage, prereq check, theme persistence
- `chat-sidebar`: spawn user's CLI agent in project cwd
- `cli-headless`: `obt` binary mirroring UI flows for CI use
- `theming`: CSS custom-properties-based light/dark mode with localStorage persistence

### Modified Capabilities
None (greenfield).

## Approach

**Single Next.js 16 App Router process — no separate daemon.** App Router API routes (`app/api/*`) host all server logic; long-running scans run as Node child processes spawned from route handlers, communicating progress via SSE. Rationale: one stack, one `bun dev`, one deploy artifact; matches the local-first single-user posture; avoids IPC complexity of a separate Express daemon.

**ORM**: Drizzle + better-sqlite3 (synchronous, type-safe, no binary engine, easy to distribute).

**LLM providers — two complementary paths**:
- *CLI path*: port open-design's `agents.ts` — `resolveOnPath` + capability probe (`--help`) + `buildArgs` + stdout parser per `streamFormat`. Covers claude, codex, gemini, opencode, qwen, cursor-agent, ollama CLI, etc. User's existing CLI config (API keys, model, tool permissions) is preserved — we just spawn it.
- *API path*: Vercel AI SDK (`ai` package) — unified `streamText` / `generateText` for Anthropic, OpenAI, Google, Ollama, Groq, OpenRouter. No need for separate `@anthropic-ai/sdk` and `openai` packages.

Detectors loaded dynamically from `detectors/` at startup. Classical scanners shelled out via argv-only spawn with timeouts. All I/O confined to `.obt/` (gitignored). API responses use standard envelope `{ success, data, error, meta }`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/(routes)/scan,findings,timeline,authors,config,reports` | New | UI pages |
| `app/api/scan,findings,sources,models,reports,prereq` | New | REST + SSE endpoints |
| `lib/pipeline/` | New | 5-stage orchestrator + per-stage modules |
| `lib/scanners/` | New | gitleaks/trufflehog/semgrep/osv-scanner adapters |
| `lib/providers/` | New | CLI PATH detect + raw API providers |
| `lib/detectors/` | New | detector loader + registry |
| `lib/git/` | New | history walker, commit/author analysis |
| `lib/db/` | New | SQLite schema + repository pattern |
| `lib/reports/` | New | MD/JSON/SARIF/CSV/PDF generators |
| `detectors/` | New | 12 SKILL.md bundles |
| `policies/` | New | default/strict/fast YAML |
| `bin/obt` | New | headless CLI |
| `.obt/` | New | runtime data (gitignored) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| User-supplied API keys leak via logs/telemetry | Med | Zero telemetry; redact in logs; keys live in OS keychain or `.obt/config.json` (chmod 600); document threat model |
| Malicious uploaded ZIP path-traversal / zip-bomb | High | Validate entries against extraction root, cap uncompressed size, reject symlinks, run extraction in worker with cgroup-style limits where available |
| Shelling out to scanners enables command injection if repo path unsanitized | High | Always pass paths as argv (never shell string); validate paths stay within `.obt/projects/<id>/`; pin scanner versions |
| LLM hallucinates findings or patches that introduce vulnerabilities | High | Stage 3 validation + Stage 4 FP filter; surface confidence + raw evidence; never auto-apply patches; PoC scripts are conceptual only |
| Long scans block Next.js route handlers / hit Vercel-style timeouts | Med | Run pipeline in detached child process; route handlers only enqueue + stream SSE from a status store |
| Scanner binaries missing on user's machine | High | Prereq check on config page with install hints; degrade gracefully (disable that detector, do not crash pipeline) |

## Rollback Plan

Greenfield repo — rollback is `git reset --hard <pre-v0.1-tag>` and `rm -rf .obt/`. No production data, no migrations to reverse, no users to notify. Per-feature rollback: each detector is a folder under `detectors/` and can be deleted independently; each pipeline stage is a separate module behind the orchestrator.

## Dependencies

**External binaries (user-installed, prereq-checked):** git, gitleaks, trufflehog, semgrep, osv-scanner, optionally claude/codex/gemini/opencode/qwen/ollama/cursor-agent CLIs.

**npm packages:** `drizzle-orm` + `better-sqlite3` + `drizzle-kit` (ORM + SQLite), `simple-git` (history walk), `yauzl` (safe ZIP extract), `js-yaml` (policies/rules), `zod` (boundary validation), `ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` + `@ai-sdk/google` + `@ai-sdk/ollama` (Vercel AI SDK — replaces individual provider packages), `eventsource-parser` (SSE client for CLI stream parsing). Already present: Next.js 16.2.4, React 19, TS 5, Tailwind v4, vitest 4, prettier.

**PDF + PoC scripts**: no packages needed for v0.1 — Coming Soon stubs only.

## Success Criteria

- [ ] User scans a GitHub repo end-to-end and sees validated findings stream into UI in under 5 minutes for a 10k-LOC repo
- [ ] Git-history walk correctly flags a known historical secret in a fixture repo
- [ ] All 12 detectors loaded from `detectors/` and visible in the policy picker
- [ ] BYOK works with at least 2 CLI agents (claude, codex) AND 1 raw API key (Anthropic or OpenAI)
- [ ] Reports export correctly in MD, JSON, SARIF, CSV, and PDF (both themes)
- [ ] CLI `obt scan` produces identical findings to UI for the same repo+policy
- [ ] Zero outbound network calls except to user-configured LLM providers and explicitly-targeted git remotes (verified via test)
- [ ] Test coverage ≥ 80% on `lib/pipeline`, `lib/scanners`, `lib/git`, `lib/db`
