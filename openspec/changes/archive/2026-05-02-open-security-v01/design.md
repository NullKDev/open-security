# Design: open-security v0.1 MVP

## Technical Approach

Single Next.js 16 App Router process owns UI + API + pipeline orchestration. Long scans run as detached `child_process.fork` workers; their stdout/IPC events are written to an in-memory **ScanBus** (per scan-id event emitter) and persisted to SQLite. SSE route handlers subscribe to the bus to stream live progress. LLM access goes through a `ProviderClient` interface with two implementations: CLI spawn (port of open-design's `agents.ts`) and Vercel AI SDK. Drizzle + better-sqlite3 backs everything (synchronous, type-safe, no engine binary). All filesystem I/O is confined to `.obt/projects/<id>/`; secrets live in `.obt/config.json` (chmod 600).

## 1. Directory Structure

```
open-security/
├── app/
│   ├── layout.tsx                       # theme bootstrap (cookie → CSS var)
│   ├── globals.css                      # CSS custom props (light/dark)
│   ├── page.tsx                         # dashboard: scan list
│   ├── scans/
│   │   ├── new/page.tsx                 # source picker (github/gitlab/local/zip)
│   │   ├── [id]/page.tsx                # live scan progress (SSE client)
│   │   └── [id]/findings/[fid]/page.tsx # finding detail (data flow, patch, history)
│   ├── timeline/[scanId]/page.tsx       # commit timeline
│   ├── authors/[scanId]/page.tsx        # author profiles
│   ├── config/page.tsx                  # API keys, models per stage, prereqs
│   └── api/
│       ├── sources/route.ts             # POST/GET source configs
│       ├── scans/route.ts               # POST create scan, GET list
│       ├── scans/[id]/route.ts          # GET status, DELETE cancel
│       ├── scans/[id]/stream/route.ts   # SSE: stage|finding|progress|error|done
│       ├── findings/route.ts            # GET filtered list
│       ├── findings/[id]/route.ts       # GET single
│       ├── providers/route.ts           # GET detected CLI agents + API providers
│       ├── prereqs/route.ts             # GET binary availability matrix
│       ├── config/route.ts              # GET/PUT config (no secrets in GET)
│       └── reports/[scanId]/route.ts    # GET ?format=md|json|sarif|csv
├── lib/
│   ├── db/
│   │   ├── client.ts                    # drizzle(better-sqlite3('.obt/db.sqlite'))
│   │   ├── schema.ts                    # all tables
│   │   └── migrate.ts                   # drizzle-kit programmatic
│   ├── repos/                           # Repository pattern (per backend-patterns)
│   │   ├── projects.repo.ts
│   │   ├── scans.repo.ts
│   │   ├── findings.repo.ts
│   │   ├── commits.repo.ts
│   │   ├── authors.repo.ts
│   │   └── reports.repo.ts
│   ├── pipeline/
│   │   ├── orchestrator.ts              # forks worker, wires ScanBus
│   │   ├── worker.ts                    # entry point for fork(); runs stages
│   │   ├── scan-bus.ts                  # per-id EventEmitter map
│   │   ├── stage0-prep.ts               # clone/copy/unzip
│   │   ├── stage1-classical.ts          # gitleaks/trufflehog/semgrep/osv
│   │   ├── stage2-llm.ts                # detector × file → ProviderClient
│   │   ├── stage3-validate.ts           # 2nd LLM pass per finding
│   │   ├── stage4-filter.ts             # heuristic + LLM FP filter
│   │   ├── stage5-patch.ts              # patch + explanation per finding
│   │   └── events.ts                    # SSE event types + zod schemas
│   ├── providers/
│   │   ├── index.ts                     # ProviderClient interface, factory
│   │   ├── cli/
│   │   │   ├── agents.ts                # AGENT_DEFS (port of open-design)
│   │   │   ├── resolve.ts               # resolveOnPath, capability probe
│   │   │   ├── spawn.ts                 # buildArgs + child_process.spawn
│   │   │   └── parsers/
│   │   │       ├── claude-stream-json.ts
│   │   │       ├── json-event-stream.ts
│   │   │       └── plain.ts
│   │   ├── api/
│   │   │   ├── factory.ts               # @ai-sdk/* selection by provider id
│   │   │   └── stream.ts                # streamText wrapper → ProviderEvent
│   │   └── stage-routing.ts             # config.models.{stage} → provider
│   ├── scanners/                        # spawn wrappers (argv array only)
│   │   ├── gitleaks.ts
│   │   ├── trufflehog.ts
│   │   ├── semgrep.ts
│   │   └── osv-scanner.ts
│   ├── git/
│   │   ├── history-walker.ts            # simple-git log --all --full-history
│   │   ├── commit-diff.ts
│   │   └── author-stats.ts
│   ├── sources/
│   │   ├── github.ts                    # clone with PAT
│   │   ├── gitlab.ts
│   │   ├── local.ts                     # path validation
│   │   └── zip.ts                       # yauzl, size cap, symlink reject
│   ├── reports/
│   │   ├── md.ts                        # root + per-finding interlinked
│   │   ├── json.ts
│   │   ├── sarif.ts                     # SARIF 2.1.0
│   │   └── csv.ts
│   ├── detectors/                       # detector loader (reads detectors/*/SKILL.md)
│   │   ├── loader.ts
│   │   └── types.ts
│   ├── config/
│   │   ├── store.ts                     # read/write .obt/config.json (chmod 600)
│   │   ├── schema.ts                    # zod
│   │   └── prereqs.ts                   # which/where probe
│   ├── theme/
│   │   └── server.ts                    # cookie → initial theme (no flash)
│   ├── api/
│   │   ├── envelope.ts                  # { success, data, error, meta }
│   │   └── errors.ts
│   ├── security/
│   │   ├── path-guard.ts                # resolve + assert under root
│   │   └── redact.ts                    # secret redaction for logs
│   └── policies/
│       └── loader.ts                    # YAML → zod
├── detectors/
│   ├── secret-in-history/SKILL.md
│   ├── suspicious-commit/SKILL.md
│   ├── author-anomaly/SKILL.md
│   ├── sqli/SKILL.md
│   ├── xss/SKILL.md
│   ├── ssrf/SKILL.md
│   ├── path-traversal/SKILL.md
│   ├── command-injection/SKILL.md
│   ├── insecure-deserialization/SKILL.md
│   ├── auth-bypass/SKILL.md
│   ├── crypto-misuse/SKILL.md
│   └── dep-vuln-context/SKILL.md
├── policies/
│   ├── severity.yaml
│   ├── confidence.yaml
│   └── fp-filter.yaml
├── bin/
│   └── obt.ts                           # headless CLI (commander)
├── components/
│   ├── ui/                              # primitives (Button, Card, Tabs)
│   ├── scan/
│   │   ├── SourcePicker.tsx
│   │   ├── ProgressStream.tsx           # consumes EventSource
│   │   └── StageBadge.tsx
│   ├── findings/
│   │   ├── FindingsTable.tsx
│   │   ├── FindingDetail.tsx
│   │   ├── DataFlowGraph.tsx
│   │   └── PatchDiff.tsx
│   ├── timeline/CommitTimeline.tsx
│   ├── authors/AuthorProfile.tsx
│   ├── chat/ChatSidebar.tsx
│   ├── config/ProviderMatrix.tsx
│   └── theme/ThemeToggle.tsx
├── drizzle/                             # generated migrations
├── .obt/                                # gitignored runtime
│   ├── config.json                      # chmod 600
│   ├── db.sqlite
│   ├── projects/<scanId>/               # working copies
│   └── reports/<scanId>/
├── openspec/
└── (next.config.ts, package.json, tsconfig.json, ...)
```

## 2. Database Schema (Drizzle)

```ts
// lib/db/schema.ts
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),                // ulid
  name: text('name').notNull(),
  sourceKind: text('source_kind').notNull(),  // 'github'|'gitlab'|'local'|'zip'
  sourceRef: text('source_ref').notNull(),    // url or path
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const scans = sqliteTable('scans', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  status: text('status').notNull(),           // queued|running|done|failed|cancelled
  stage: text('stage'),                       // current stage label
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  modelsUsed: text('models_used', { mode: 'json' }).$type<Record<string,string>>(),
  error: text('error'),
});

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),
  scanId: text('scan_id').notNull().references(() => scans.id),
  detector: text('detector').notNull(),
  severity: text('severity').notNull(),       // critical|high|medium|low|info
  confidence: real('confidence').notNull(),   // 0..1
  exploitability: real('exploitability').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  locationPath: text('location_path').notNull(),
  locationLineStart: integer('location_line_start'),
  locationLineEnd: integer('location_line_end'),
  locationCommit: text('location_commit'),
  dataFlow: text('data_flow', { mode: 'json' }),
  evidenceHistory: text('evidence_history', { mode: 'json' }),
  patchDiff: text('patch_diff'),
  patchExplanation: text('patch_explanation'),
  validationModel: text('validation_model'),
  validationPasses: integer('validation_passes', { mode: 'boolean' }),
  validationRationale: text('validation_rationale'),
  fpFiltered: integer('fp_filtered', { mode: 'boolean' }).default(false),
  tags: text('tags', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const commits = sqliteTable('commits', {
  sha: text('sha').notNull(),
  scanId: text('scan_id').notNull().references(() => scans.id),
  authorEmail: text('author_email').notNull(),
  authorName: text('author_name').notNull(),
  authoredAt: integer('authored_at', { mode: 'timestamp_ms' }).notNull(),
  message: text('message').notNull(),
  filesChanged: integer('files_changed').notNull(),
  insertions: integer('insertions').notNull(),
  deletions: integer('deletions').notNull(),
  riskScore: real('risk_score'),
}, t => ({ pk: primaryKey({ columns: [t.sha, t.scanId] }) }));

export const authors = sqliteTable('authors', {
  scanId: text('scan_id').notNull().references(() => scans.id),
  email: text('email').notNull(),
  name: text('name').notNull(),
  commitCount: integer('commit_count').notNull(),
  firstSeen: integer('first_seen', { mode: 'timestamp_ms' }).notNull(),
  lastSeen: integer('last_seen', { mode: 'timestamp_ms' }).notNull(),
  anomalyFlags: text('anomaly_flags', { mode: 'json' }),
}, t => ({ pk: primaryKey({ columns: [t.scanId, t.email] }) }));

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  scanId: text('scan_id').notNull().references(() => scans.id),
  format: text('format').notNull(),           // md|json|sarif|csv
  path: text('path').notNull(),
  generatedAt: integer('generated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});
```

Relations: `scans.projectId → projects.id`; `findings.scanId → scans.id`; `commits.scanId → scans.id`; `authors.scanId → scans.id`; `reports.scanId → scans.id`. Indexes on `findings(scan_id, severity)`, `findings(scan_id, fp_filtered)`, `commits(scan_id, authored_at)`.

API keys are NOT in `config` table — they live in `.obt/config.json` (chmod 600). The `config` table holds non-secret runtime state (last-used models, UI prefs).

## 3. API Routes

All responses use envelope `{ success: boolean, data: T | null, error: { code, message } | null, meta?: { total, cursor } }`.

| Method | Path | Request | Response (data) |
|--------|------|---------|-----------------|
| POST | /api/sources | `{ kind, ref, pat? }` (zod) | `{ projectId }` |
| GET | /api/sources | — | `Project[]` |
| POST | /api/scans | `{ projectId, detectors?: string[], models?: Record<stage,string> }` | `{ scanId }` |
| GET | /api/scans | `?cursor&limit` | `Scan[]` + `meta.cursor` |
| GET | /api/scans/[id] | — | `Scan` |
| DELETE | /api/scans/[id] | — | `{ cancelled }` |
| GET | /api/scans/[id]/stream | — | `text/event-stream` (SSE) |
| GET | /api/findings | `?scanId&severity&detector&cursor&limit` | `Finding[]` |
| GET | /api/findings/[id] | — | `Finding` |
| GET | /api/providers | — | `{ cli: AgentDef[], api: ApiProvider[] }` |
| GET | /api/prereqs | — | `{ name, present, version? }[]` |
| GET | /api/config | — | non-secret config (keys redacted, presence-only flags) |
| PUT | /api/config | `ConfigPatch` (zod) | `{ updated }` |
| GET | /api/reports/[scanId] | `?format=md\|json\|sarif\|csv` | file stream |

Validation: zod schemas in `lib/api/schemas/`. Errors: `400 INVALID_INPUT`, `404 NOT_FOUND`, `409 CONFLICT`, `500 INTERNAL`. Pagination via opaque cursor (base64 of `{lastId, lastTs}`).

## 4. LLM Provider Abstraction

```ts
// lib/providers/index.ts
export type ProviderEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'final'; text: string; raw?: unknown }
  | { type: 'error'; message: string };

export interface ProviderClient {
  id: string;            // 'cli:claude' | 'api:anthropic' | ...
  capability: { stream: boolean; tools: boolean; json: boolean };
  streamScan(prompt: string, opts: ScanOpts): AsyncIterable<ProviderEvent>;
}

export interface ScanOpts {
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}
```

**CLI path** — `lib/providers/cli/`:
- `agents.ts` exports `AGENT_DEFS: AgentDef[]` (port from open-design): `{ id, bin, probeArgs, streamFormat, buildArgs(prompt, opts) }`.
- `resolve.ts`: `resolveOnPath(bin)` (uses `which`-like lookup, no shell), `probe(def)` runs `--help`/`--version` to detect capability.
- `spawn.ts`: `child_process.spawn(bin, argv, { stdio: ['pipe','pipe','pipe'] })` — argv array always.
- `parsers/*` consume stdout per `streamFormat` and yield `ProviderEvent`.

**API path** — `lib/providers/api/`:
- `factory.ts` selects `@ai-sdk/anthropic|openai|google|ollama` by id; reads keys from `.obt/config.json`.
- `stream.ts` wraps `streamText({ model, prompt, system, abortSignal })` → maps SDK events to `ProviderEvent`.

**Stage routing** — `stage-routing.ts`: `getProviderForStage('llm-scan' | 'validate' | 'filter' | 'patch')` reads `config.json` (`models.{stage}` = `cli:claude` or `api:anthropic:claude-sonnet-4`) and returns a `ProviderClient`. Each stage gets its own client; the worker passes it the prompt + abort signal.

## 5. Scan Pipeline Design

```
Route POST /api/scans
   │  insert scans row (status=queued)
   ▼
Orchestrator.start(scanId)
   │  fork('lib/pipeline/worker.js', { env })
   ▼
Worker (child process)
  Stage0 prep ──► Stage1 classical (parallel) ──► Stage2 LLM (per detector × file)
                                                      │
                                                      ▼
                                            Stage3 validate (per finding)
                                                      │
                                                      ▼
                                            Stage4 FP filter
                                                      │
                                                      ▼
                                            Stage5 patch synthesis ──► done
   │
   │ each step → process.send({ type, payload })
   ▼
Orchestrator (parent) → ScanBus.emit(scanId, evt) → DB write + SSE fanout
```

**SSE event schema** (zod-validated in `lib/pipeline/events.ts`):

```ts
type ScanEvent =
  | { type: 'stage'; stage: 'prep'|'classical'|'llm'|'validate'|'filter'|'patch'; status: 'start'|'end'; ts: number }
  | { type: 'progress'; stage: string; current: number; total: number; label?: string }
  | { type: 'finding'; finding: Finding }       // after validate+filter, partial allowed
  | { type: 'error'; stage?: string; message: string; recoverable: boolean }
  | { type: 'done'; summary: { findings: number; durationMs: number } };
```

Route `/api/scans/[id]/stream` opens a `ReadableStream`, subscribes to `ScanBus.on(scanId, …)`, formats each event as `event: <type>\ndata: <json>\n\n`, and replays the latest persisted events on connect (so reload doesn't lose state). Heartbeat every 15s. Backpressure: bounded channel (size 256); on overflow, drop `progress` events first, never `finding`/`error`/`done`.

Cancellation: `DELETE /api/scans/[id]` sets `status=cancelled`, sends `SIGTERM` to the worker, then `SIGKILL` after 5s.

Recovery: on Next.js restart, scans in `running` status are marked `failed` (no resume in v0.1).

## 6. Git History Walker

`lib/git/history-walker.ts` uses `simple-git`:
- `git.log(['--all','--full-history','--pretty=format:%H%x00%an%x00%ae%x00%aI%x00%s','--numstat'])` parsed line-by-line into a stream.
- Async generator yields `CommitRecord { sha, author, ts, message, files: { path, ins, del }[] }`.
- `commit-diff.ts` lazy-loads `git.show([sha])` only when a detector requests it (memory bound).
- Detector dispatch: `secret-in-history` runs gitleaks per commit blob; `suspicious-commit` LLM-scores diff (size + path sensitivity + message); `author-anomaly` aggregates into `author-stats.ts` (timezone outliers, identity churn, force-push markers from reflog if available).
- Persistence: `commits.repo.ts` upserts after each commit; `authors.repo.ts` recomputes at end.

## 7. Report Structure (MD interlinked)

```
.obt/reports/<scanId>/
├── report.md                  # root: summary table, severity counts, links
├── findings/
│   ├── <findingId>.md         # one per finding
│   └── ...
├── timeline.md                # commit-by-commit with author + risk
├── authors.md                 # per-author: stats + anomaly flags
└── meta.json                  # scan metadata
```

`report.md` (root) sections: Executive Summary, Scope, Models Used, Findings Summary (table), Severity/Confidence Distribution, Top Findings (links), Timeline (link), Authors (link).

Each `findings/<id>.md`: front-matter (severity, confidence, detector), Title, Location (`path:lineStart-lineEnd`, commit), Data Flow (mermaid), Evidence History (commit links), Patch Diff (fenced ```diff), Validation Rationale, Tags. Cross-links use relative paths (`../report.md`, `./<otherId>.md`).

JSON, SARIF (2.1.0 with `runs[].results[].locations[].physicalLocation`), CSV (flat: id, scan_id, severity, confidence, path, line_start, title) generated from same `findings.repo.findBy({scanId, fpFiltered:false})`.

## 8. Theme System

CSS variables in `app/globals.css`:

```css
:root { --bg:#fff; --fg:#111; --accent:#2563eb; /* … */ }
:root[data-theme='dark'] { --bg:#0a0a0a; --fg:#ededed; --accent:#60a5fa; }
```

`app/layout.tsx` reads `cookies().get('theme')` server-side, sets `<html data-theme={theme}>`. Client `ThemeToggle` updates `document.documentElement.dataset.theme` and writes both `localStorage.theme` and a same-name cookie (so SSR sees it next request). No flash because the attribute is on the SSR HTML.

## 9. Security Design

| Invariant | Enforcement |
|---|---|
| ZIP extraction safety | `yauzl.open(file, { lazyEntries:true })`. Reject entry if `path.resolve(root, name)` not under `root`, if `name` contains `..`, or if entry is a symlink (`(externalAttrs >>> 16) & 0o170000) === 0o120000`). Hard cap: total decompressed bytes ≤ `MAX_ZIP_BYTES` (default 2 GiB), entry count ≤ 50k. |
| Path confinement | `lib/security/path-guard.ts::assertUnder(root, candidate)` resolves both with `path.resolve` and checks `candidate.startsWith(root + path.sep)`. Used in every file I/O entry. |
| Spawn safety | All scanners + CLI providers go through `spawn(bin, argv, opts)` — never `exec`/`execSync`/shell strings. `argv` is built from typed input only (no string interpolation). `cwd` is always under `.obt/projects/<id>/`. |
| Secret storage | `.obt/config.json` written via `fs.writeFile` then `fs.chmod(path, 0o600)`. On read, parsed via zod. Never echoed in `GET /api/config` (presence-only flags). Logger uses `lib/security/redact.ts` to strip values matching configured key names. |
| Network egress | No outbound traffic except (a) git remotes for clone, (b) configured API providers via `@ai-sdk/*`, (c) classical scanners' own update channels which are disabled by flag. No telemetry. CSP `connect-src 'self'`. |
| PAT handling | GitHub/GitLab PATs passed as `git -c credential.helper=` env-only header for the duration of clone, never persisted in working tree, redacted in logs. |

## 10. Architecture Decision Records

### ADR-1: Single Next.js process vs separate daemon

**Choice**: Single Next.js 16 App Router process; long scans via `child_process.fork`.
**Alternatives**: (a) Separate Express/Fastify daemon + Next.js UI; (b) BullMQ + Redis worker; (c) Tauri/Electron shell.
**Rationale**: Local-first single-binary install; no Redis dep; SSE works natively in App Router route handlers; `fork()` gives process isolation for scan crashes without IPC complexity; Next.js dev server stays usable. Tradeoff accepted: no horizontal scaling — fine for desktop/local use.

### ADR-2: Drizzle vs Prisma for local SQLite

**Choice**: Drizzle ORM + better-sqlite3.
**Alternatives**: Prisma + sqlite; raw better-sqlite3; Kysely.
**Rationale**: Prisma ships a Rust query engine binary (~20 MB, platform-specific) — hostile to a "clone and run" experience. Drizzle is pure TS, synchronous with better-sqlite3 (matches Node's model for short transactions), schema-first with type inference, lighter migrations (drizzle-kit). Kysely was close but Drizzle's ergonomics + relations API won.

### ADR-3: Vercel AI SDK vs individual provider SDKs

**Choice**: Vercel AI SDK (`ai` + `@ai-sdk/*`) for the API path.
**Alternatives**: Direct `@anthropic-ai/sdk` + `openai` + `@google/generative-ai`; LangChain.
**Rationale**: One streaming abstraction, one event shape — collapses ~4 adapter modules into one factory. LangChain too opinionated and heavy. Direct SDKs would mean per-provider stream parsing duplicated. Cost: dependency on Vercel's evolution, accepted because the `streamText` surface is stable and provider packages are thin.

### ADR-4: CLI spawn vs SDK-only for agent support

**Choice**: Both — SDK is the default API path; CLI spawn is a first-class second path (port of open-design `agents.ts`).
**Alternatives**: SDK-only; CLI-only.
**Rationale**: Users who run `claude`, `codex`, `gemini`, `opencode`, `qwen`, `cursor-agent`, `ollama` already have tuned configs (system prompts, MCP tools, auth). Forcing them through API keys discards that. Spawning their CLI preserves their setup with zero re-config. SDK path covers users with raw API keys and no CLI installed. The unified `ProviderClient` interface keeps stages indifferent to which path is in use.

## File Changes

This is a greenfield repo — see Directory Structure (§1). All paths are **Create**. No deletions. No modifications beyond the existing scaffold (`README.md`, `next.config.ts`, `tsconfig.json`, `package.json`).

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | path-guard, zip extractor, redact, parsers (cli stream formats), envelope, repo zod parsing | vitest, table-driven |
| Integration | pipeline stages with stub `ProviderClient`, SSE stream end-to-end, drizzle repos against in-memory sqlite | vitest + supertest-style fetch against Next route handlers |
| E2E | full scan against fixture repo (small, planted secrets + SQLi) producing MD/SARIF | playwright for UI flows; CLI test for `obt scan` |
| Security | malicious ZIPs (zip-slip, symlink, bomb), path traversal attempts, spawn injection fuzz | dedicated `tests/security/` suite, must run in CI |

## Migration / Rollout

No migration — greenfield v0.1. `drizzle-kit migrate` runs on first start; `.obt/` is created lazily. PDF/PoC stubs render disabled buttons with tooltip "Coming Soon".

## Open Questions

- [ ] Do we ship Drizzle migrations as committed SQL files or run `drizzle-kit push` programmatically on startup? Recommendation: commit SQL, run on startup.
- [ ] SSE reconnection: replay last N events from DB or require client to refetch? Recommendation: replay last 100 events keyed by sequence number.
- [ ] Worker resource caps (memory, CPU) — rely on OS or set via `child_process` `resourceLimits`? Recommendation: `resourceLimits.maxOldGenerationSizeMb` from config.
