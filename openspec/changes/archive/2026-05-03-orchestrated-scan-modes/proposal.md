# Proposal: Orchestrated Scan Modes

## Intent

Today's `standard` and `deep` modes both fire a single, generic LLM prompt over the entire repo. This wastes tokens, misses domain-specific issues (auth, file I/O, data stores), and ignores stack-aware guidance available in `.atl/skill-registry.md`. We need scan modes that THINK before they look — first map the project, then run targeted, skill-aware passes per security domain. This raises signal-to-noise for real Blue Team usage and makes `paranoid` actually paranoid.

## Scope

### In Scope
- Replace `deep` with two new modes: `intermediate` and `paranoid`.
- Keep `quick` (classical only) and `standard` (single LLM pass) as the entry tier.
- Add **Pass 0 — Project Intelligence**: LLM produces a structured `ProjectMap` (stack, frameworks, entry points, attack surface, suggested security domains, relevant skill IDs). Persisted to workspace + DB.
- Add **Pass N — Targeted Domain Scans**: one LLM call per domain, each prompt enriched with relevant skill rules and a domain checklist. Mini-report per domain.
- Add **Final Aggregation**: merge domain findings, enrich with ProjectMap context, then feed existing stage3-validate → stage4-filter → stage5-patch unchanged.
- Inject skill rules into `standard` mode prompts based on detected stack.
- DB column for the `ProjectMap` payload (new field on `scans`).
- Update `ScanMode` union, `CreateScanSchema`, and runner switch.
- Migration to translate any existing `deep` rows to `paranoid`.

### Out of Scope
- Changes to stage1-classical, stage3-validate, stage4-filter, stage5-patch internals.
- ThinkingBlock/console UI work (already shipped).
- New scanners or providers.
- Editing the skill registry itself or skill discovery logic.
- UI redesign for mode selection (only label/copy updates).

## Capabilities

### New Capabilities
- `project-intelligence`: Pass 0 ProjectMap generation, schema, persistence, retrieval.
- `orchestrated-scan`: Multi-pass domain orchestration for `intermediate` and `paranoid`.
- `skill-injection`: Resolve compact rules from `.atl/skill-registry.md` and inject into LLM prompts.

### Modified Capabilities
- `scan-pipeline`: Runner gains strategy dispatch (quick / standard / intermediate / paranoid).
- `scan-schema`: `scan_mode` enum widens, new `project_map` column on `scans`.
- `llm-scan`: stage2-llm becomes mode-aware.

## Approach

1. **Extract a `ScanStrategy` interface** with one implementation per mode.
2. **`StandardStrategy`**: current single LLM pass enriched with skill rules.
3. **`OrchestratedStrategy`**: Pass 0 → ProjectMap, then N domain passes, then aggregate + dedup.
4. **Skill resolution**: reads `.atl/skill-registry.md`, extracts compact rule blocks.
5. **DB**: add `project_map TEXT`; widen `scan_mode`; one-shot migration `deep → paranoid`.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pass 0 malformed JSON | Med | Zod-validate, retry once, fall back to default ProjectMap |
| Token cost balloon in paranoid | High | Hard cap on domains (7) and per-domain file list |
| Skill registry missing | Med | Continue without injection; emit warning |
| Multi-pass amplifies 429s | Med | Sequential passes, respect existing backoff |
| Existing deep scans break | Low | Migration rewrites to paranoid |

## Rollback Plan

1. Revert runner strategy switch.
2. Revert `ScanMode` union to `quick | standard | deep`.
3. Drop `project_map` column via down-migration.
4. Reverse migration: `paranoid → deep`.
5. Skill injection module is additive — harmless if strategies are gone.

## Dependencies

- `.atl/skill-registry.md` must exist with parseable Compact Rules section.
- LLM provider must support structured JSON output for Pass 0.
- Zod (already a project dep) for ProjectMap schema validation.

## Success Criteria

- [x] `quick`, `standard`, `intermediate`, `paranoid` all run end-to-end.
- [x] `intermediate` and `paranoid` persist a valid `ProjectMap` per scan.
- [x] `paranoid` produces strictly more findings than `intermediate` with domain attribution.
- [x] `standard` prompts include injected skill rules for known stacks.
- [x] Existing `deep` rows load correctly after migration.
- [x] No regression in `quick` mode.
