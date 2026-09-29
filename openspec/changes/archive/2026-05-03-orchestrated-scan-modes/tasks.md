# Tasks: orchestrated-scan-modes

## Phase 1: Foundation — Types, Schema, DB

- [x] 1.1 **`lib/api/schemas/scans.ts`** — Replace enum with `quick|standard|intermediate|paranoid`.
- [x] 1.2 **`lib/scanners/types.ts`** — Add optional `tags?: string[]` to `NormalizedFinding`.
- [x] 1.3 **`lib/pipeline/events.ts`** — Add `tags` to `normalizedFindingSchema` and `FindingEvent`.
- [x] 1.4 **`lib/db/schema.ts`** — Add `projectMap: text('project_map')` to scans table.
- [x] 1.5 **`lib/repos/scans.repo.ts`** — Widen `ScanMode`, add `projectMap` to `ScanDTO`, add `setProjectMap`.
- [x] 1.6 **`drizzle/0004_orchestrated_scan_modes.sql`** — Migration with `ALTER TABLE` + `deep→paranoid`.
- [x] 1.7 **`runner.ts`** — Widen `ScanMode` type, no logic change yet.

## Phase 2: New Pure Modules

- [x] 2.1 **`lib/skills/registry.ts`** — Parse skill registry, resolve rules for stack/domain.
- [x] 2.2 **`lib/pipeline/strategies/dedupe.ts`** — Dedup key: path:line:lowercased-title.
- [x] 2.3 **`lib/pipeline/strategies/types.ts`** — Strategy interface and types.
- [x] 2.4 **`lib/pipeline/project-map.ts`** — ProjectMap schema, Pass 0 prompt, generation, persistence.

## Phase 3: Strategy Implementations

- [x] 3.1 **`lib/pipeline/strategies/quick.ts`** — QuickStrategy: classical-only.
- [x] 3.2 **`lib/providers/stage-routing.ts`** — Widen `buildScanPrompt` with domain/files/fix/skills.
- [x] 3.3 **`lib/pipeline/strategies/standard.ts`** — StandardStrategy: single LLM pass + skill rules.
- [x] 3.4 **`lib/pipeline/stage2-llm.ts`** — Simplify to prompt-in, findings-out.
- [x] 3.5 **`lib/pipeline/strategies/orchestrated.ts`** — Pass 0 + domain loop + dedup.
- [x] 3.6 **`lib/pipeline/strategies/index.ts`** — `selectStrategy` + `normalizeScanMode`.

## Phase 4: Runner Integration

- [x] 4.1 **`lib/pipeline/runner.ts`** — Replace inline branching with strategy dispatch.

## Phase 5: UI + API Wiring

- [x] 5.1 **ScanModePicker** — 4 modes with cost labels, replace deep with paranoid.
- [x] 5.2 **API route verification** — `tsc --noEmit` passes, new modes accepted.

## Phase 6: Testing Completion

- [x] 6.1 **`tests/unit/skills/registry.test.ts`** — 15/15 tests passing.
- [x] 6.2 **`tests/unit/pipeline/project-map.test.ts`** — 15/15 tests passing.
- [x] 6.3 **`tests/unit/pipeline/strategies/orchestrated.test.ts`** — 14/14 tests passing.
- [x] 6.4 **`tests/unit/pipeline/strategies/normalizeScanMode.test.ts`** — 9/9 tests (already covered).
- [x] 6.5 **`tests/integration/pipeline/runner.test.ts`** — 10/10 tests passing.
- [x] 6.6 **`tests/unit/db/migration.test.ts`** — 6/6 tests passing (new file).

**26/26 tasks complete. 104/104 tests passing. 0 type errors.**
