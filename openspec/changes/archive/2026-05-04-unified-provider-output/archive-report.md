# Archive Report: unified-provider-output

**Change**: `unified-provider-output`
**Archived**: 2026-05-04
**Verdict**: PASS WITH WARNINGS
**Mode**: hybrid

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `provider-output-model` | Created | New spec: 4 requirements (Taxonomy, Format Hints, Shared textLineToEvent, Capability Metadata) |
| `provider-transports` | Updated | 2 added (Shared Line Parser, API SDK text routing), 3 modified (Spawn-JSON, ACP, HTTP) |
| `scan-schema` | Updated | 3 added (ResponseEvent, Transport Metadata, Buffer Priority) |
| `scan-pipeline` | Updated | 3 added (Response Forwarding, Stage3 Response, Transport Metadata Propagation) |

## Archive Contents

- `proposal.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (13/13 tasks complete)
- `verify-report.md` ✅ (PASS WITH WARNINGS)
- `specs/provider-output-model/spec.md` ✅
- `specs/provider-transports/spec.md` ✅
- `specs/scan-schema/spec.md` ✅
- `specs/scan-pipeline/spec.md` ✅

## Engram Artifact Traceability

| Artifact | Observation ID | Topic |
|----------|---------------|-------|
| Proposal | #355 | `sdd/unified-provider-output/proposal` |
| Spec | #356 | `sdd/unified-provider-output/spec` |
| Design | #357 | `sdd/unified-provider-output/design` |
| Tasks | #358 | `sdd/unified-provider-output/tasks` |
| Apply Progress | #359 | `sdd/unified-provider-output/apply-progress` |
| Verify Report | #361 | `sdd/unified-provider-output/verify-report` |

## What was built

1. **Shared parser** (`lib/providers/shared/line-parser.ts`): Single source of truth, eliminated 130 LOC of duplicated code across 3 transports
2. **ResponseEvent type**: New event taxonomy — `response` for model prose, distinct from `thinking` for internal reasoning
3. **Format-aware UI**: `ThinkingBlock.tsx` renders markdown via react-markdown, new `ResponseBlock.tsx` for model response display
4. **Capability metadata**: `meta` SSE event with `transportKind` and `thinkingSupport` → UI capability badges
5. **API SDK structured output**: `wrapStreamText` now routes through shared parser
6. **Pipeline integration**: Stage2 forwards response/meta events, Stage3 accumulates response alongside thinking

## Key Files Changed

### New
- `lib/providers/shared/line-parser.ts` — shared textLineToEvent parser
- `components/ui/ResponseBlock.tsx` — collapsible prose block
- `tests/unit/providers/shared-line-parser.test.ts` — 23 tests
- `tests/unit/components/ThinkingBlock.test.tsx` — 8 tests

### Modified
- `lib/providers/index.ts` — ResponseEvent type, extended capability
- `lib/providers/cli/parsers/native-to-findings.ts` — import shared parser
- `lib/providers/transport/acp.ts` — import shared parser
- `lib/providers/transport/http.ts` — import shared parser
- `lib/providers/sdk/claude.ts` — text → textLineToEvent routing
- `lib/providers/api/stream.ts` — rewrite: line-buffered parsing
- `lib/providers/stage-routing.ts` — transportKind/thinkingSupport in capability
- `lib/pipeline/events.ts` — responseEventSchema, metaEventSchema
- `lib/pipeline/stage2-llm.ts` — meta event + response forwarding
- `lib/pipeline/stage3-validate.ts` — response accumulation
- `components/ui/ThinkingBlock.tsx` — react-markdown rendering
- `app/scans/[id]/ScanProgress.tsx` — ResponseBlock + meta badges

## Source of Truth Updated

The following main specs now reflect the new behavior:
- `openspec/specs/provider-output-model/spec.md` (NEW)
- `openspec/specs/provider-transports/spec.md`
- `openspec/specs/scan-schema/spec.md`
- `openspec/specs/scan-pipeline/spec.md`

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
