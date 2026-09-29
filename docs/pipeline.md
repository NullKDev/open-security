# Scan Pipeline

The scan pipeline is the core execution engine. It processes a repository through 5 sequential stages, emitting events via SSE for real-time progress.

## Pipeline overview

```
POST /api/scans
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Pipeline Runner                             │
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  │ Stage 0  │──▶│ Stage 1  │──▶│ Stage 2  │──▶│ Stage 3  │──▶│ Stage 4  │
│  │  Prep    │   │ Classical│   │   LLM    │   │ Validate │   │  Filter  │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
│       │              │              │              │              │
│       │              │              │              │              ▼
│       │              │              │              │        ┌──────────┐
│       │              │              │              │        │ Stage 5  │
│       │              │              │              │        │  Patch   │
│       │              │              │              │        └──────────┘
│       │              │              │              │              │
│       ▼              ▼              ▼              ▼              ▼
│  ┌─────────────────────────────────────────────────────────────┐
│  │                     ScanBus (SSE pub/sub)                     │
│  │  stage │ progress │ finding │ thinking │ error │ done        │
│  └─────────────────────────────────────────────────────────────┘
│                              │
│                              ▼
│                    GET /api/scans/:id/stream
│                         (SSE to browser)
└─────────────────────────────────────────────────────────────────┘
```

## Stage 0 — Prep

**Purpose**: Clone, copy, or extract the source code into the workspace.

**What it does**:
- Detects source kind: `github`, `gitlab`, `local`, `zip`
- Clones git repos via `git clone`
- Copies local folders via `cp -r`
- Extracts ZIP archives (with password support)
- Detects language/framework stack hints (e.g., `['next.js', 'typescript', 'react']`)
- Returns `{ ok: boolean, sourceKind, targetPath, stackHints? }`

**Failure mode**: If source prep fails (`ok: false`), the pipeline aborts immediately with `status: 'failed'`.

## Stage 1 — Classical

**Purpose**: Run classical security scanners in parallel on the source tree.

**Scanners executed** (all in parallel via child processes):

| Scanner | What it detects | Output |
|---------|----------------|--------|
| **gitleaks** | Hardcoded secrets, API keys, tokens in git history | JSON |
| **trufflehog** | Secrets in current state + git history | JSON |
| **semgrep** | Code patterns (SQLi, XSS, path traversal, etc.) | JSON |
| **osv-scanner** | Known vulnerabilities in dependencies (lockfiles) | JSON |

**Output**: `NormalizedFinding[]` — all findings from all scanners, normalized to a common format.

**Failure mode**: Individual scanner failures are logged but don't abort the pipeline. Missing scanners are skipped.

## Stage 2 — LLM Scan

**Purpose**: Use an LLM to analyze the source code for vulnerabilities. This is where the 4 scan modes differ.

**Strategy dispatch**: The runner calls `normalizeScanMode()` → `selectStrategy()` → `strategy.run(ctx)`.

| Mode | Strategy | LLM Passes | Skill Injection | Notes |
|------|----------|------------|-----------------|-------|
| **quick** | `QuickStrategy` | 0 | ❌ | Returns classical findings only. `llmSkipped: true`. |
| **standard** | `StandardStrategy` | 1 | ✅ Stack-based | One LLM call with skill rules for detected stack. |
| **intermediate** | `OrchestratedStrategy` | 3–4 (per-domain) | ✅ Domain-based | Pass 0 generates ProjectMap → per-domain LLM passes → dedup. |
| **paranoid** | `OrchestratedStrategy` | 5–7 (per-domain) | ✅ Domain-based | Same as intermediate + fix suggestions requested per finding. |

**Skill injection**: The `resolveRulesForDomain` and `resolveRulesForStack` functions pull compact security rules from `.atl/skill-registry.md` and inject them into the LLM prompt under a `## Security Skills` section.

**ProjectMap** (intermediate + paranoid only):
Pass 0 calls the LLM to generate a structured analysis of the codebase:
```json
{
  "stack": ["next.js", "typescript", "tailwind"],
  "domains": [
    { "name": "auth", "files": ["src/auth/login.ts", "src/auth/session.ts"] },
    { "name": "data-store", "files": ["src/db/query.ts", "src/repos/"] }
  ]
}
```

Each domain then gets its own targeted LLM pass with domain-specific skill rules.

**Deduplication** (orchestrated modes): Findings from different domain passes are deduplicated by a composite key: `locationPath:locationLineStart:title.trim().toLowerCase()`. First occurrence wins.

## Stage 3 — Validate

**Purpose**: Second LLM pass to validate each finding as a true positive or false positive.

**Process**: For each finding from Stage 2 (separate LLM call per finding):
- Builds a validation prompt with the finding details
- LLM responds with `{ "passes": boolean, "rationale": "..." }`
- Only `passes: true` findings proceed to Stage 4

**Provider**: Uses `createProviderForStage('validate')`, falls back to the LLM scan provider.

## Stage 4 — Filter

**Purpose**: Apply false-positive filter rules from `policies/fp-filter.yaml`.

**Process**:
- Loads rules via the Zod-validated policy loader (`lib/policies/loader.ts`)
- Each rule has a `match_path` glob pattern (e.g., `**/*.test.*`, `**/fixtures/**`)
- Glob patterns are converted to regex with `globToRegex()`
- Findings whose `locationPath` matches any rule are dropped

**Policy example** (`policies/fp-filter.yaml`):
```yaml
rules:
  - id: skip-test-files
    match_path: "**/*.test.*"
    action: filter
  - id: skip-fixture-files
    match_path: "**/fixtures/**"
    action: filter
  - id: skip-mock-files
    match_path: "**/__mocks__/**"
    action: filter
```

## Stage 5 — Patch

**Purpose**: Synthesize remediation patches for validated findings.

**Process**: For each finding that passed validation + filter:
- Builds a patch prompt with the finding details
- LLM responds with `{ "diff": "...", "explanation": "..." }`
- Patches are saved as unified diffs in the workspace

**Provider**: Uses `createProviderForStage('patch')`, falls back to the LLM scan provider.

## Event types

The pipeline emits these events via ScanBus:

| Event type | Payload | When |
|------------|---------|------|
| `stage` | `{ stage: string, message: string }` | Stage transitions |
| `progress` | `{ message: string, pct?: number }` | Scanner output, tool calls |
| `thinking` | `{ text: string }` | LLM reasoning (from `--thinking` flag) |
| `finding` | `{ finding: NormalizedFinding }` | New vulnerability found |
| `error` | `{ message: string }` | Non-fatal errors |
| `done` | `{ scanId: string }` | Pipeline complete |

## Provider resolution

Each stage can use a different LLM provider. Resolution happens at pipeline start via `createProviderForStage(stage)`:

1. Reads `config.models[stage]` from the global config
2. Parses the model string: `cli:agentId:modelId` or `api:providerId:modelId`
3. For CLI: checks binary availability via `findOnPath()`, creates spawn-based client
4. For API: creates Vercel AI SDK-based client
5. Returns `undefined` if no model configured → pipeline skips LLM stages

The resolved providers are persisted to `scans.models_used` for audit trail.

## Runner integration

The runner (`lib/pipeline/runner.ts`) orchestrates all stages:

```typescript
// Pseudocode
const stage0 = await runStage0Prep({ sourceKind, sourceRef, workspaceRoot })
if (!stage0.ok) return fail()

const stage1 = await runStage1Classical({ targetPath })

const provider = createProviderForStage('llm-scan')
const strategy = selectStrategy(normalizeScanMode(scanMode))
const result = await strategy.run({ classicalFindings, llmProvider: provider, ... })

if (!result.llmSkipped && provider) {
  const validated = await runStage3Validate({ findings: result.findings, provider: validateProvider })
  const filtered = await runStage4Filter({ validated })
  await runStage5Patch({ findings: filtered.filtered, provider: patchProvider })
}

await generateAllReports()
publish({ type: 'done', scanId })
```
