# Architecture

open-security is a **local-first, single-process** application. No backend server, no daemon, no microservices, no cloud dependencies required.

## System diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js 16 App Router                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Dashboard│  │ Settings │  │  Reports │  │  Scan Detail   │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                  │                               │
│              SSE stream: GET /api/scans/:id/stream               │
│                                  │                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      Pipeline Runner                       │  │
│  │                                                            │  │
│  │  Stage 0  →  Stage 1  →  Stage 2  →  Stage 3  →  Stage 4  │  │
│  │  (Prep)     (Classic)    (LLM)     (Validate)   (Filter)  │  │
│  │                                                     ↓      │  │
│  │                                                  Stage 5   │  │
│  │                                                  (Patch)   │  │
│  │                                                            │  │
│  │              ScanBus pub/sub (per-scan subscriber set)     │  │
│  └───────────────────────────────────────────────────────────┘  │
│         │                 │                 │                    │
│   spawn child        spawn CLI          API SDKs                │
│   processes          agents             (ai package)            │
│         │                 │                 │                    │
│  ┌──────┴──────┐  ┌───────┴──────┐  ┌──────┴────────┐         │
│  │ gitleaks    │  │ claude       │  │ anthropic     │         │
│  │ trufflehog  │  │ opencode     │  │ openai        │         │
│  │ semgrep     │  │ codex        │  │ google        │         │
│  │ osv-scanner │  │ gemini       │  │ ollama (api)  │         │
│  └─────────────┘  │ cursor-agent │  └───────────────┘         │
│                   │ qwen         │                              │
│                   │ copilot      │                              │
│                   │ auggie       │                              │
│                   │ ollama (cli) │                              │
│                   └─────────────┘                              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │           SQLite (better-sqlite3 + Drizzle ORM)            │  │
│  │  projects │ scans │ findings │ commits │ authors           │  │
│  │  scan_events │ reports │ posture_snapshots                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Workspace: .obt/ (gitignored, in project root)                 │
│    db.sqlite  │  config.json  │  projects/*/scans/*/           │
└─────────────────────────────────────────────────────────────────┘
```

## Core principles

### Local-first

Everything runs on the user's machine. No cloud, no telemetry, no login required. The SQLite database and all scan artifacts live in `.obt/`, a gitignored directory in the project root.

### Single process

Next.js serves the UI, API routes, and runs the pipeline — all in one Node.js process. The pipeline spawns child processes for classical scanners and CLI agents, but those are ephemeral subprocesses. There is no separate server, no message queue, no worker daemon.

### BYOK (Bring Your Own Keys)

API keys for Anthropic, OpenAI, Google, and Ollama are stored locally in `.obt/config.json`. Keys are never transmitted except to their respective API endpoints.

### Provider abstraction

All LLM access goes through a unified `ProviderClient` interface:

```typescript
interface ProviderClient {
  id: string
  capability: { stream: boolean; tools: boolean; jsonMode: boolean; transportKind: TransportKind }
  scan(opts: ScanOpts): AsyncIterable<ProviderEvent>
}
```

Two implementations:
- **CLI agents** (`lib/providers/cli/`): Spawn local CLI tools as child processes. Seven agents are defined, each with a transport kind (`sdk`, `http`, `acp`).
- **API SDKs** (`lib/providers/api/`): Use Vercel AI SDK (`ai` package) for API-based providers.

### SSE streaming

Scan progress is streamed via Server-Sent Events. `ScanBus` implements a pub/sub pattern — each scan has a subscriber set, and the pipeline publishes events as it progresses. The UI subscribes at `GET /api/scans/:id/stream`.

### Scan events are persisted

Every `ScanEvent` published to the `ScanBus` is also written to the `scan_events` table. This enables:
- Post-restart replay of scan progress
- The `obt history` CLI command
- Future investigation replay features

## Layer stack

```
┌──────────────────────────────────────┐
│            UI (React 19)              │  app/, components/
│  Dashboard, Sidebar, ScanProgress,    │
│  Settings, Reports                    │
├──────────────────────────────────────┤
│         API Routes (Next.js)          │  app/api/
│  /api/scans, /api/config,             │
│  /api/providers, /api/reports         │
├──────────────────────────────────────┤
│       Pipeline (5 stages)             │  lib/pipeline/
│  runner.ts, stage0–5, strategies/,    │
│  ScanBus, events, project-map         │
├──────────────────────────────────────┤
│     Providers + Scanners              │  lib/providers/, lib/scanners/
│  CLI spawn, API SDKs,                 │
│  Detector skill injection             │
├──────────────────────────────────────┤
│       Repositories (Drizzle)          │  lib/repos/
│  projects, scans, findings,           │
│  commits, authors, reports            │
├──────────────────────────────────────┤
│     SQLite (better-sqlite3)           │  lib/db/
│  Schema, client, migrations           │
└──────────────────────────────────────┘
```

## Pipeline stages

```
POST /api/scans → runPipeline()
  │
  ├─ Stage 0: Prep
  │    Clone / copy / extract source
  │    Detect stack hints (next.js, typescript, ...)
  │    Build file tree + sample snippets for Pass 0
  │
  ├─ Stage 1: Classical (parallel)
  │    gitleaks    → secrets in code + git history
  │    trufflehog  → secrets in current state + history
  │    semgrep     → code pattern matching (SQLi, XSS, ...)
  │    osv-scanner → dependency vulnerability matching
  │
  ├─ Stage 2: LLM Scan (varies by scan mode)
  │    quick       → skip; return classical findings only
  │    standard    → one LLM call; stack-aware skill injection
  │    intermediate → Pass 0 (ProjectMap) + 3–4 domain LLM calls
  │    paranoid    → Pass 0 (ProjectMap) + 5–7 domain LLM calls + fix requests
  │
  ├─ Stage 3: Validate
  │    One LLM call per finding (validation prompt from SKILL.md)
  │    Drop findings where LLM returns {"confirmed": false}
  │
  ├─ Stage 4: Filter
  │    Apply fp-filter.yaml glob rules
  │    Drop findings whose path matches any rule
  │
  └─ Stage 5: Patch
       One LLM call per surviving finding
       Request unified diff fix
       Persist to findings.patch_diff
```

## Scan strategies

Each scan mode maps to a `ScanStrategy` implementation:

| Mode | Class | LLM calls | ProjectMap |
|------|-------|-----------|------------|
| `quick` | `QuickStrategy` | 0 | No |
| `standard` | `StandardStrategy` | 1 | No |
| `intermediate` | `OrchestratedStrategy('intermediate')` | Pass 0 + 3–4 domain | Yes |
| `paranoid` | `OrchestratedStrategy('paranoid')` | Pass 0 + 5–7 domain | Yes |
| `diff` | `DiffStrategy` | 1 (scoped to changed files) | No |

All strategies implement:
```typescript
interface ScanStrategy {
  readonly id: ScanModeId
  run(ctx: StrategyContext): Promise<StrategyResult>
}
```

The `StrategyContext` carries: `scanId`, `workspaceRoot`, `targetPath`, `classicalFindings`, `stage0Stack`, `fileTree`, `sampleSnippets`, `scanMode`, `llmProvider`, `onEvent`, `isAborted`, `diffContext`.

## Skill injection

The `lib/skills/registry.ts` module reads `.atl/skill-registry.md` (a compiled registry of compact security rules from all detector SKILL.md files) and provides two functions:

- `resolveRulesForStack(stack)` — returns rules relevant to detected tech stack (used in standard mode)
- `resolveRulesForDomain(domain, stack)` — returns rules for a specific security domain (used in intermediate/paranoid)

These rules are prepended to the LLM prompt under `## Security Skills`, giving the LLM structured detection guidance before it reads the code.

## Database schema overview

```
projects         id, name, sourceRef, sourceKind, createdAt, modelsConfig
scans            id, projectId, status, scanMode, stage, modelsUsed, createdAt, ...
findings         id, scanId, detector, severity, confidence, title, description,
                 locationPath, locationLineStart, locationLineEnd,
                 patchDiff, patchExplanation, isFalsePositive, contentHash
scan_events      id, scanId, eventType, payload, createdAt
commits          id, scanId, sha, author, message, timestamp
authors          id, scanId, email, name, commitCount, isAnomaly
posture_snapshots id, projectId, scanId, severityWeightedScore, openCritical, createdAt
```

The `contentHash` field on `findings` enables deduplication: the same vulnerability across multiple scans produces one row, not N rows.

## Design decisions

| Decision | Rationale |
|----------|-----------|
| Next.js 16 App Router | Single process, no separate backend. RSC for data fetching. API routes for mutations. |
| SQLite + Drizzle | Zero setup. No database server. ORM with type-safe queries and migration support. |
| Classical scanners as child processes | Need filesystem access and process isolation. Failures don't crash the pipeline. |
| In-process pipeline runner | Direct event publishing to ScanBus. No IPC overhead. Works in dev mode where workers are unavailable. |
| Zod at all API boundaries | Type-safe request/response validation. Catches mismatches before they reach business logic. |
| SSE over WebSockets | Simpler, native browser support, HTTP-compatible, works with Next.js streaming response model. |
| scan_events persistence | Enables post-restart replay, CLI history, and future investigation replay. |
| content-hash deduplication on findings | Same vulnerability across N scans = 1 finding row. Reduces noise in the findings corpus. |

## Directory map

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router pages and API routes |
| `components/` | React components organized by domain (ui/, project/, source/, theme/) |
| `lib/pipeline/` | Scan pipeline: runner, 5 stages, strategies, ScanBus, events, project-map |
| `lib/providers/` | LLM provider abstraction: CLI spawn + API SDKs, agent definitions, transports |
| `lib/scanners/` | Classical scanner wrappers (gitleaks, trufflehog, semgrep, osv-scanner) |
| `lib/detectors/` | LLM vulnerability detector engine and types |
| `lib/repos/` | Database repositories using Drizzle ORM |
| `lib/db/` | SQLite client, Drizzle schema, migrations |
| `lib/config/` | Configuration store (SQLite), schema (Zod), workspace path helpers |
| `lib/reports/` | Report generation (JSON, MD, SARIF, CSV) |
| `lib/policies/` | Policy loader (fp-filter, severity, confidence YAML) |
| `lib/skills/` | Skill registry parser for security rule injection into prompts |
| `lib/enrichment/` | EPSS/KEV/CISA enrichment service (post-scan, fire-and-forget) |
| `bin/` | CLI entry point (`obt`) |
| `detectors/` | 60+ SKILL.md detector bundles organized by domain |
| `policies/` | 3 YAML policy files |
| `openspec/` | SDD specs and archived change records |
| `drizzle/` | SQL migration files |
