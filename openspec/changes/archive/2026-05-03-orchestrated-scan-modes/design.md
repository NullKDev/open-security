# Design: Orchestrated Scan Modes

## 1. Architectural Approach

**Pattern**: Strategy + Pipeline. Runner becomes a thin dispatcher that hands control to a `ScanStrategy` after stage1. Each mode (`quick`, `standard`, `intermediate`, `paranoid`) is a strategy implementation. Stage3, stage4, stage5 remain untouched.

**Boundaries**:
- `lib/pipeline/runner.ts` — orchestrator only; selects strategy, owns stage0/stage1/stage3/stage4/stage5 calls.
- `lib/pipeline/strategies/*` — owns LLM-side behavior between stage1 and stage3.
- `lib/pipeline/project-map.ts` — Pass 0 (project intelligence).
- `lib/skills/registry.ts` — Pure parser of `.atl/skill-registry.md`.
- `lib/pipeline/stage2-llm.ts` — Thin "execute one prompt against a provider" primitive.

**Flow**:
```
stage0-prep → stage1-classical → ScanStrategy.run(ctx)
                                       |
                                       +-- quick:        no LLM, classical-only
                                       +-- standard:     skills-injected single LLM pass
                                       +-- intermediate: Pass 0 (3-4 domains) → N domain passes
                                       +-- paranoid:     Pass 0 (5-7 domains) → N domain passes (fix req)
                                       v
                                  aggregated NormalizedFinding[] (with `domain` tag)
                                       v
                                  stage3-validate → stage4-filter → stage5-patch
```

## 2. Module Map

### NEW — `lib/pipeline/strategies/types.ts`
`ScanModeId`, `StrategyContext`, `StrategyResult`, `ScanStrategy` interface.

### NEW — `lib/pipeline/strategies/quick.ts`
`QuickStrategy`: returns `{ findings: ctx.classicalFindings, llmSkipped: true }`.

### NEW — `lib/pipeline/strategies/standard.ts`
`StandardStrategy`: single LLM pass with skill-injected prompt.

### NEW — `lib/pipeline/strategies/orchestrated.ts`
`OrchestratedStrategy(variant)`: Pass 0 → domain loop → aggregate + dedupe.

### NEW — `lib/pipeline/strategies/index.ts`
`selectStrategy(mode)` factory + `normalizeScanMode(raw)`.

### NEW — `lib/pipeline/strategies/dedupe.ts`
Deduplication key: `<locationPath>:<locationLineStart>:<lowercased title>`. First occurrence wins.

### NEW — `lib/pipeline/project-map.ts`
`ProjectMapSchema` (Zod), `buildPass0Prompt`, `generateProjectMap`, `defaultProjectMapFromStack`, `persistProjectMap`, `mapDomainToFiles`.

### NEW — `lib/skills/registry.ts`
`loadCompactRules`, `resolveRulesForStack`, `resolveRulesForDomain`.

### MODIFIED — `lib/providers/stage-routing.ts`
`buildScanPrompt` widened with `domain`, `files`, `includeFixSuggestions`, skill rule injection.

### MODIFIED — `lib/pipeline/stage2-llm.ts`
`prompt: string` required, `domain?` and `detectorPrefix?` added.

### MODIFIED — `lib/pipeline/runner.ts`
Replace inline branching with `normalizeScanMode` + `selectStrategy` dispatch.

### MODIFIED — `lib/db/schema.ts`
Add `projectMap: text('project_map')` to scans table.

### MODIFIED — `lib/repos/scans.repo.ts`
Widen `ScanMode`, add `projectMap` to `ScanDTO`, add `setProjectMap` helper.

### NEW — `lib/validation/scan-mode.ts`
`ScanModeSchema = z.enum(['quick','standard','intermediate','paranoid']).default('standard')`

### NEW — `drizzle/0004_orchestrated_scan_modes.sql`
```sql
ALTER TABLE scans ADD COLUMN project_map TEXT;
UPDATE scans SET scan_mode = 'paranoid' WHERE scan_mode = 'deep';
```

## 3. ADRs

### ADR-1 — Strategy returns findings+map, not events
Strategies return data; runner owns event publishing. Makes strategies unit-testable without a ScanBus.

### ADR-2 — Domain via detector+tags, not new field
`detector = 'llm:<domain>'` + `tags: ['domain:<domain>']`. Zero schema churn.

### ADR-3 — Dedup key = path:line:lowercased-title
First occurrence wins. Description excluded (unstable), severity excluded.

### ADR-4 — Prompt budget caps
MAX_RULES_BYTES=4KB, MAX_FILES_PER_DOMAIN=40, MAX_FILE_LIST_BYTES=8KB, MAX_PASS0_TREE_BYTES=16KB, MAX_PASS0_SNIPPETS_BYTES=8KB.

### ADR-5 — Domain selection LLM-driven, not enum-bound
`ProjectMap.domains` is `string[]` chosen by the LLM. Makes the system repo-aware.

### ADR-6 — Stage2: prompt-in, findings-out
`prompt` is always required. Strategies own prompt construction.

### ADR-7 — Token estimates surfaced in UI
| Mode | LLM calls | Approx tokens |
|------|-----------|---------------|
| quick | 0 | 0 |
| standard | 1 + stage3 + stage5 | ~50k |
| intermediate | 1 + 3-4 domains + stage3 + stage5 | ~150k |
| paranoid | 1 + 5-7 domains + stage3 + stage5 | ~350k |

## 4. Module Dependency Graph

```
runner.ts
  → strategies/index.ts
       → strategies/quick.ts
       → strategies/standard.ts
            → stage-routing.ts (buildScanPrompt)
            → stage2-llm.ts
            → skills/registry.ts
       → strategies/orchestrated.ts
            → project-map.ts
                 → skills/registry.ts
            → stage-routing.ts
            → stage2-llm.ts
            → skills/registry.ts
            → strategies/dedupe.ts
  → project-map.ts (persistProjectMap only)
```
