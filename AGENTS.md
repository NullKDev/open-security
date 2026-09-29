<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-context -->
# open-security — Agent Instructions

This file is authoritative context for AI agents working in this codebase. Read it fully before making any changes.

---

## What this project is

open-security is a **local-first Blue Team security workbench**. It scans code repositories for vulnerabilities by combining classical tools (gitleaks, trufflehog, semgrep, osv-scanner) with LLM-powered analysis across 11 providers. Everything runs in a single Next.js 16 process on the user's machine — no cloud, no external services except LLM API calls.

The core product is a 5-stage scan pipeline:

```
Stage 0 (Prep) → Stage 1 (Classical) → Stage 2 (LLM) → Stage 3 (Validate) → Stage 4 (Filter) → Stage 5 (Patch)
```

Scan progress streams to the UI via Server-Sent Events. Findings are persisted in SQLite.

---

## Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js App Router | 16.2.4 |
| Language | TypeScript (strict) | 5.x |
| UI | React + Tailwind CSS | 19.2.4 / v4 |
| Database | SQLite via Drizzle ORM + better-sqlite3 | Drizzle 0.45, better-sqlite3 12.9 |
| Testing | Vitest | 4.x |
| Package manager / runtime | bun | 1.x |
| LLM SDKs | Vercel AI SDK, @anthropic-ai/claude-agent-sdk, @agentclientprotocol/sdk | various |
| CLI framework | commander | 14.x |

**Node.js version**: 20+ required for DB tests (better-sqlite3 is a C++ native addon — Bun's runtime does not support it).

---

## Project structure

```
app/                    Next.js App Router pages and API routes
  api/                  REST endpoints (scans, findings, providers, config, reports)
  scans/[id]/           Scan detail and SSE stream route
  config/               Settings page
  reports/              Report export UI

components/
  ui/                   shadcn/ui primitives (Button, Card, Badge, Tabs, etc.)
  project/              NewProjectForm, ScanConfig
  findings/             FindingsTable
  theme/                ThemeToggle

lib/
  pipeline/             Core pipeline: runner.ts, stage0–5, strategies/, ScanBus, events
  providers/            LLM provider abstraction
    cli/                CLI agent spawn (agents.ts defines all 7 CLI providers)
    api/                Vercel AI SDK wrappers
    transport/          sdk, http, acp transport implementations
  scanners/             Classical scanner wrappers (gitleaks, trufflehog, semgrep, osv)
  detectors/            LLM detector engine + types
  repos/                Drizzle repository layer (scans, findings, projects, events)
  db/                   SQLite client, Drizzle schema, migrations
  config/               Config store, Zod schema, workspace paths
  reports/              Report generation (JSON, MD, SARIF, CSV)
  policies/             YAML policy loader (fp-filter, severity, confidence)
  skills/               Skill registry parser for prompt injection
  enrichment/           EPSS/KEV enrichment service

bin/obt.ts              CLI entry point (scan, history, report, agents commands)

detectors/              60+ SKILL.md detector bundles organized by domain
  web/                  SQLi, XSS, SSRF, path traversal, command injection, auth bypass, crypto misuse, etc.
  cloud/                Hardcoded credentials, IAM misconfig, exposed storage, Terraform/K8s/Docker
  mobile/               Insecure storage, cleartext traffic, WebView misconfig
  db/                   ORM injection, unencrypted connections, weak auth
  cicd/                 Workflow injection, hardcoded secrets, unprotected triggers
  supply-chain/         Dependency confusion, unpinned deps, malicious package hooks
  repo/                 Secret in history, suspicious commits, author anomaly
  shell/                Argument injection, eval injection, env poisoning
  language/             Python pickle, JS child_process, Go unsafe, Java deserialization, C buffer overflow
  emerging/             Race conditions, ReDoS, OAuth misconfig, WebSocket CSWSH
  social/               Fake credentials, phishing URLs, impersonation
  desktop/              Electron misconfig

policies/               3 YAML policy files
  fp-filter.yaml        False-positive path rules (glob → drop)
  severity.yaml         Severity thresholds by detector
  confidence.yaml       Confidence thresholds for validation stage

openspec/               SDD specs and archived change records
drizzle/                SQL migration files
tests/                  Unit, integration, component, security tests
```

---

## Invariants — things you must never do

1. **Never hardcode `.obt/` paths.** Always use helpers from `lib/config/workspace.ts` (`ensureScanDirs`, `OBT_ROOT`, etc.). These functions handle cross-platform path resolution and workspace initialization.

2. **Never build UI primitives from scratch.** All buttons, inputs, dialogs, badges, cards, tabs, and selects must use components from `components/ui/` (shadcn/ui). To add a missing component: `bunx shadcn@latest add <component>`. Do not run `bun run build` after.

3. **Never add `any` types.** TypeScript strict mode is enforced. Use `unknown` and narrow safely.

4. **Never add plain-text regex parsers for CLI agents.** All transports must produce structured JSON. The `plain` StreamFormat is removed.

5. **Never call `bun run build` after changes.** This is the rule for this project — no build verification step.

6. **Never commit API keys or credentials.** `.obt/config.json` is gitignored. Tests must use stubs.

7. **Never skip Zod validation at API boundaries.** All `app/api/` route handlers must validate request bodies and params with Zod schemas from `lib/api/schemas/`.

8. **Never use `@/` imports for new internal modules** within `lib/`. Use explicit relative paths. `@/` is allowed in `app/` and `components/` to import from `lib/`.

9. **Never mutate scan state outside the pipeline.** The pipeline runner is the single source of truth for scan status. External code reads from the DB; it does not write scan state directly.

10. **Never use `vi.mocked` or `vi.hoisted` in tests.** Vitest 4.1.5 under Bun does not support them. Use dependency injection or module-level `vi.fn()` variables instead.

---

## Coding conventions

### General

- **JSDoc on all exported functions** — describe WHAT the function does, not HOW it's implemented
- **Conventional commits only**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **No AI attribution in commits** — no `Co-Authored-By` lines
- **Immutable patterns** — never mutate inputs; return new objects

### TypeScript

- Use `type` for unions and utility types, `interface` for object shapes that may extend
- Return explicit types on all exported functions
- Narrow `unknown` inputs before use
- No `as` casts except for legitimate narrowings

### API routes (`app/api/`)

All route handlers must validate with Zod before processing:

```typescript
const bodySchema = z.object({ /* ... */ })

export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json())
  if (!body.success) return Response.json({ error: body.error.message }, { status: 400 })
  // handler logic
}
```

### Database access

Always use the repository layer in `lib/repos/` — never write raw Drizzle queries in API routes or pipeline stages.

### Pipeline events

All events are defined in `lib/pipeline/events.ts` with Zod schemas. When adding a new event type:
1. Add the Zod schema and TypeScript type to `events.ts`
2. Update the `ScanEvent` discriminated union
3. Handle the new event in `app/scans/[id]/ScanProgress.tsx`

---

## How the Next.js version works

This project is on **Next.js 16**, which has breaking API and convention changes from earlier versions. Before writing any route handler, middleware, or server component, read the relevant guide in `node_modules/next/dist/docs/`. Pay attention to deprecation notices.

---

## Detector system (SKILL.md)

Detectors are SKILL.md files in `detectors/`. Each file contains YAML frontmatter and Markdown sections.

### YAML frontmatter

```yaml
---
id: sqli                         # Unique identifier (snake_case)
title: SQL Injection             # Human-readable name for UI
stages:                          # Pipeline stages that use this detector
  - llm-scan
  - validate
severity: critical               # critical | high | medium | low | info
description: Short description.  # One sentence for the UI
classical_prepass: semgrep       # Optional: which classical scanner covers this
classical_hint: p/sql-injection  # Optional: scanner rule/config hint
---
```

### Markdown body sections

- `## Detection Prompt` — prompt injected into Stage 2. Uses `{code}` as a template variable.
- `## Validation Prompt` — prompt used by Stage 3. Uses `{file}:{line}` and `{snippet}`. Must produce `{"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}`.
- `## FP Heuristics` — prose hints for common false positives in this detector category.

Detectors are **auto-discovered** by scanning the `detectors/` directory. No registration step is required.

---

## Pipeline stages

### Stage 0 — Prep

Clones/copies/extracts source. Returns `{ ok, sourceKind, targetPath, stackHints, fileTree, sampleSnippets }`. If `ok` is false, the runner aborts immediately.

### Stage 1 — Classical

Runs gitleaks, trufflehog, semgrep, and osv-scanner in parallel. Individual scanner failures are logged but do not abort the pipeline.

### Stage 2 — LLM Scan

Dispatches to a strategy via `selectStrategy(mode)`. The strategy returns `StrategyResult { findings, projectMap?, llmSkipped }`.

- **quick** — returns classical findings with `llmSkipped: true`
- **standard** — one LLM call with stack-aware skill injection
- **intermediate / paranoid** — Pass 0 generates a ProjectMap → per-domain LLM calls → deduplication

### Stage 3 — Validate

One LLM call per finding using the detector's Validation Prompt. Non-confirmed findings are dropped.

### Stage 4 — Filter

Applies `fp-filter.yaml` glob rules via `globToRegex()`. Accepts `_rules` parameter for dependency injection in tests.

### Stage 5 — Patch

Generates unified diff fixes for surviving findings. Uses `createProviderForStage('patch')`.

---

## Provider system

### ProviderClient interface

```typescript
interface ProviderClient {
  id: string
  capability: {
    stream: boolean
    tools: boolean
    jsonMode: boolean
    transportKind: TransportKind
    thinkingSupport: boolean
  }
  scan(opts: ScanOpts): AsyncIterable<ProviderEvent>
}
```

### Model string format

```
cli:<agentId>                  Agent default model
cli:<agentId>:<modelId>        Specific model: "cli:claude:claude-sonnet-4-5"
api:<providerId>:<modelId>     API SDK: "api:anthropic:claude-sonnet-4-5"
```

### Transport kinds

| Transport | Agents | Protocol |
|-----------|--------|---------|
| `sdk` | Claude Code | `@anthropic-ai/claude-agent-sdk` |
| `http` | Ollama | Streaming fetch to `localhost:11434/api/chat` |
| `acp` | Gemini, Codex, OpenCode, Cursor, Qwen, Copilot, Auggie | JSON-RPC 2.0 over stdio |

---

## Adding a new provider

### CLI agent

1. Add an `AgentDef` entry to `AGENT_DEFS` in `lib/providers/cli/agents.ts`
2. Choose the transport: `acp` (JSON-RPC 2.0), `http` (HTTP daemon), or `sdk` (SDK package)
3. For `acp`: set `acpArgs` correctly — `acpScan()` handles the handshake
4. For a new transport kind: implement in `lib/providers/transport/` and wire in `makeCliClient()`

### API provider

1. Add to `API_PROVIDERS` in `app/api/providers/route.ts`
2. Add a case in `lib/providers/api/factory.ts` if it needs special SDK setup
3. Add the API key field to `ObtConfig.providers` in `lib/config/schema.ts`

---

## Adding a new detector

1. `mkdir -p detectors/<domain>/<detector-name>`
2. Write `SKILL.md` with the required frontmatter and sections
3. No registration needed — auto-discovered at startup
4. Test: `bun bin/obt.ts scan /path/to/vulnerable-sample --mode standard`

---

## Testing

```bash
bun run test              # All tests
bun run test:watch        # Watch mode
bun run test:coverage     # Coverage (target: 85%+)

# DB tests require Node.js (Bun does not support better-sqlite3 native addon)
npx vitest run tests/unit/repos/
npx vitest run tests/unit/db/
```

### Test layers

| Layer | Location | Runner |
|-------|----------|--------|
| Unit | `tests/unit/` | `bun test` |
| Integration | `tests/integration/` | `bun test` or `npx vitest` |
| Component | `components/*/__tests__/` | `npx vitest` (needs jsdom) |
| DB | `tests/unit/repos/`, `tests/unit/db/` | `npx vitest` (needs Node) |
| Security | `tests/security/` | `bun test` |

### Mocking — `vi.mocked` is not available

Use dependency injection (preferred):

```typescript
// Production code
export async function runStage4Filter(opts: Stage4Opts) {
  const rules = opts._rules ?? (await loadParsedRules())
}

// Test
const result = await runStage4Filter({ _rules: [myRule], ... })
```

Or module-level `vi.fn()` before `vi.mock()`:

```typescript
const mockFn = vi.fn()
vi.mock('@/lib/some-module', () => ({ someFunction: mockFn }))
mockFn.mockResolvedValue({ data: 'test' })
```

---

## Critical files

| File | Why it matters |
|------|---------------|
| `lib/pipeline/runner.ts` | Orchestrates all 5 stages |
| `lib/pipeline/strategies/types.ts` | `ScanStrategy`, `StrategyContext`, `StrategyResult` interfaces |
| `lib/providers/stage-routing.ts` | `createProviderForStage()` and `buildScanPrompt()` |
| `lib/providers/cli/agents.ts` | `AGENT_DEFS` — all CLI agents and their transports |
| `lib/pipeline/events.ts` | All `ScanEvent` types — start here for new event types |
| `lib/db/schema.ts` | Drizzle schema — all tables |
| `lib/config/schema.ts` | `ObtConfig` Zod schema — all config fields |
| `lib/config/workspace.ts` | Workspace path helpers — always use these |
| `lib/skills/registry.ts` | `resolveRulesForStack()`, `resolveRulesForDomain()` |
| `app/scans/[id]/ScanProgress.tsx` | SSE consumer — handles all `ScanEvent` types in the UI |

---

## SDD workflow

All substantial changes go through Spec-Driven Development:

```
explore → propose → spec → design → tasks → apply → verify → archive
```

Use `/sdd-new <change>` or `/sdd-ff <change>` to start. Artifacts live in engram and `openspec/`. Do not start implementation without a spec.

---

## Known sharp edges

- **`better-sqlite3` and Bun** — Use `npx vitest` for tests in `tests/unit/repos/` and `tests/unit/db/`.
- **`vi.mocked` not available** — Use dependency injection instead.
- **CLI agent ENOENT** — `findOnPath()` returns `undefined` when a binary is missing; `createCliProvider()` returns `undefined`. The pipeline logs a warning and falls back. Never let ENOENT propagate as an unhandled rejection.
- **ENAMETOOLONG on large prompts** — Set `promptViaStdin: true` on `AgentDef` for agents whose prompts can exceed ~128KB.
- **Drizzle schema changes require migration** — Run `bun run db:generate` then `bun run db:migrate`. Do not edit migration files manually.
- **Next.js 16 breaking changes** — Read `node_modules/next/dist/docs/` before writing route handlers or server components.
- **ACP agents: `buildArgs` is never called** — Only `acpArgs` matters for ACP transport. `buildArgs` must exist to satisfy the interface but should throw if called.
- **FP filter glob conversion** — `globToRegex()` handles `**`, `*`, and `?`. Anything more exotic needs to be added to that function with tests.
<!-- END:project-context -->

<!-- BEGIN:acp-sdk-reference -->
# ACP SDK — Exploitation Reference

Package: `@agentclientprotocol/sdk@0.21.0`
Import path: `@agentclientprotocol/sdk`
Schema truth: `node_modules/@agentclientprotocol/sdk/schema/schema.json`

**Rule**: Never redeclare types that the SDK already exports. Always import from `@agentclientprotocol/sdk`. Check the schema before adding new fields.

---

## What is already implemented

| Area | File | Status |
|------|------|--------|
| `agent_message_chunk` → `ResponseChunkEvent` | `session-update-handler.ts` | ✓ with `messageId` |
| `agent_thought_chunk` → `ThinkingChunkEvent` | `session-update-handler.ts` | ✓ with `messageId` |
| `tool_call` → `ToolCallEvent` | `session-update-handler.ts` | ✓ with `kind`, `locations` |
| `tool_call_update` → `ToolResultEvent` | `session-update-handler.ts` | ✓ partial (status=completed/failed only) |
| `plan` → `PlanEvent` | `session-update-handler.ts` | ✓ steps only |
| `usage_update` → `CostEvent` | `session-update-handler.ts` | ⚠ only `cost.amount` extracted, `size`/`used` ignored |
| `session_info_update` → `ServerInfoEvent` | `session-update-handler.ts` | ⚠ `title` only, `updatedAt` ignored |
| `ToolKind` type | `session-update-handler.ts` | ✓ re-exported from SDK |
| `ToolLocation` | `session-update-handler.ts` | ✓ |
| Terminal (create/output/wait/kill/release) | `terminal-handler.ts` | ✓ |
| readTextFile / writeTextFile | `file-system-handler.ts` | ✓ |
| requestPermission | `permission-bridge.ts` | ✓ |
| setSessionMode | `session-manager.ts` | ⚠ uses raw cast, not SDK type |
| unstable_setSessionModel | `session-manager.ts` | ⚠ uses raw cast, not SDK type |

---

## What is NOT implemented (gaps to fill)

### 1. `available_commands_update` — CLI command discovery
```ts
import type { AvailableCommandsUpdate, AvailableCommand } from '@agentclientprotocol/sdk'
// AvailableCommand: { name: string, description: string, input?: AvailableCommandInput }
// AvailableCommandsUpdate: { availableCommands: AvailableCommand[] }
```
Currently lands in `default:` of `dispatch()` and is silently dropped.
**What to do**: emit a new `CommandsEvent` → surface as slash-command palette in the UI.

### 2. `current_mode_update` — active mode changed
```ts
import type { CurrentModeUpdate } from '@agentclientprotocol/sdk'
// CurrentModeUpdate: { currentModeId: SessionModeId }
```
Currently silently dropped.
**What to do**: emit a `ModeEvent` → update the mode indicator in the status bar.

### 3. `config_option_update` — session config changed (model, thought level…)
```ts
import type { ConfigOptionUpdate, SessionConfigOption } from '@agentclientprotocol/sdk'
// SessionConfigOption = SessionConfigSelect | SessionConfigBoolean
// SessionConfigOptionCategory: "mode" | "model" | "thought_level" | "_custom"
```
Currently silently dropped.
**What to do**: emit a `ConfigEvent` → render as live config panel, model selector.

### 4. `NewSessionResponse` fields — modes, models, configOptions
```ts
import type { NewSessionResponse, SessionModeState, SessionModelState } from '@agentclientprotocol/sdk'
// nsRes.modes    → SessionModeState { availableModes, currentModeId }
// nsRes.models   → SessionModelState { availableModels: ModelInfo[], currentModelId } (UNSTABLE)
// nsRes.configOptions → SessionConfigOption[]
```
Currently `session-manager.ts` throws away everything except `sessionId`.
**What to do**: capture modes/models/configOptions and expose them as provider metadata.

### 5. `UsageUpdate` — context window size + tokens consumed
```ts
import type { UsageUpdate, Cost } from '@agentclientprotocol/sdk'
// UsageUpdate: { size: number, used: number, cost?: Cost }
// Cost: { amount: number, currency: string }  ← UNSTABLE
```
Currently `mapCost()` extracts only `cost.amount` and emits 0 for `inputTokens`/`outputTokens`.
**What to do**: map `size` and `used` to show a context-window progress bar in the UI.
Also: emit `inputTokens = used` as a meaningful value instead of 0.

### 6. `ToolCallContent` with `diff` type — file edit diffs
```ts
import type { ToolCallContent, Diff } from '@agentclientprotocol/sdk'
// Diff: { path: string, newText: string, oldText?: string | null }
// ToolCallContent = Content & {type:"content"} | Diff & {type:"diff"} | Terminal & {type:"terminal"}
```
When `tool_call_update` arrives with `content[{type:"diff", path, oldText, newText}]`,
we currently ignore it (mapped only as `rawOutput`).
**What to do**: extract diffs from `ToolCallUpdate.content`, emit them in `ToolResultEvent`.
Render with a diff viewer in `ToolCallBlock`.

### 7. `ToolCallUpdate.content[{type:"terminal"}]` — embedded terminal
```ts
import type { Terminal } from '@agentclientprotocol/sdk'
// Terminal: { terminalId: string }
```
Terminal output embedded in tool call content is silently dropped.
**What to do**: follow `terminalId` to `TerminalHandler`, render inline.

### 8. `PromptResponse.stopReason` — why the agent stopped
```ts
import type { PromptResponse, StopReason } from '@agentclientprotocol/sdk'
// StopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"
```
Not captured anywhere.
**What to do**: surface as a terminal status indicator in `ScanProgress.tsx`.
`max_tokens` and `max_turn_requests` should be warnings (truncated output).

### 9. `PlanEntryPriority` — plan step urgency
```ts
import type { PlanEntryPriority } from '@agentclientprotocol/sdk'
// "high" | "medium" | "low"
```
`mapPlan()` in `session-update-handler.ts` and `PlanStep` in `events.ts` don't include priority.
**What to do**: add `priority?: PlanEntryPriority` to `PlanStep`.

### 10. `listProviders` / `setProviders` — provider configuration via SDK
```ts
import type { ListProvidersResponse, ProviderInfo, SetProvidersRequest } from '@agentclientprotocol/sdk'
// ProviderInfo: { id, required, supported: LlmProtocol[], current?: ProviderCurrentConfig }
// LlmProtocol: "anthropic" | "openai" | "azure" | "vertex" | "bedrock" | custom
```
Not called anywhere. CLI compatibility check should use this.
**What to do**: call `connection.listProviders()` after `newSession` to discover supported protocols.
Use to gate which providers are shown in the UI for ACP transport.

### 11. `setSessionMode` / `setSessionModel` — use SDK types
```ts
import type { SetSessionModeRequest, SetSessionModelRequest } from '@agentclientprotocol/sdk'
```
Currently `session-manager.ts:334` and `:349` cast raw objects without SDK types.
**What to do**: import and use the proper request types. Remove the inline cast ugliness.

### 12. `SessionInfoUpdate.updatedAt` — session timestamp
```ts
// updatedAt?: string | null  (ISO 8601)
```
Currently dropped in `mapServerInfo()`.
**What to do**: add to `ServerInfoEvent` and update the scan's `updatedAt` field.

---

## Typed constants to always import from SDK (never redeclare)

```ts
import type {
  ToolKind,           // "read"|"edit"|"delete"|"move"|"search"|"execute"|"think"|"fetch"|"switch_mode"|"other"
  ToolCallStatus,     // "pending"|"in_progress"|"completed"|"failed"
  StopReason,         // "end_turn"|"max_tokens"|"max_turn_requests"|"refusal"|"cancelled"
  PlanEntryStatus,    // "pending"|"in_progress"|"completed"
  PlanEntryPriority,  // "high"|"medium"|"low"
  SessionMode,        // { id: SessionModeId, name: string, description? }
  ModelInfo,          // { modelId: ModelId, name: string, description? }
  SessionConfigOptionCategory, // "mode"|"model"|"thought_level"|"_custom"
  LlmProtocol,        // "anthropic"|"openai"|"azure"|"vertex"|"bedrock"|custom
  AvailableCommand,   // { name, description, input? }
  Diff,               // { path, newText, oldText? }
  ContentBlock,       // TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource
  Usage,              // { inputTokens, outputTokens, totalTokens, cachedRead?, cachedWrite?, thought? }
  Cost,               // { amount: number, currency: string }  — UNSTABLE
} from '@agentclientprotocol/sdk'
```

---

## UNSTABLE fields (use but guard carefully)

| Field | Notes |
|-------|-------|
| `ContentChunk.messageId` | Groups stream fragments. Cast as `(update as {messageId?:string}).messageId` — field exists at runtime |
| `SessionModelState` / `SetSessionModelRequest` | Prefix `unstable_` on SDK method. Will stabilize. |
| `UsageUpdate.cost` | May be absent even when usage is reported |
| `NewSessionResponse.models` | May be `undefined` even if agent supports model switching |
| `additionalDirectories` | Pass in `NewSessionRequest` only if `AgentCapabilities.sessionCapabilities.additionalDirectories` is true |

---

## Key files to touch when extending ACP usage

| File | Purpose |
|------|---------|
| `lib/providers/transport/session-update-handler.ts` | Add new `SessionUpdate` variant handlers here |
| `lib/providers/transport/acp-client.ts` | Add new `Client` method implementations here |
| `lib/providers/transport/session-manager.ts` | Session lifecycle, mode/model switching |
| `lib/pipeline/events.ts` | Add Zod schema + TypeScript type for each new event |
| `app/scans/[id]/ScanProgress.tsx` | Handle new SSE event types on the client |
| `components/ui/ToolCallBlock.tsx` | Render new tool content types (diff, terminal) |
<!-- END:acp-sdk-reference -->
