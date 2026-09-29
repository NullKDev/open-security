# Design: Unified Provider Output

## Technical Approach

Extract duplicated `textLineToEvent` (3 copies, 249 LOC) into `lib/providers/shared/line-parser.ts`. Fix the fallback: prose → `response` (new type) not `thinking` (root cause of double-thinking bug). Render markdown via react-markdown v10 (already installed). Flow capability metadata to UI via new `meta` SSE event. Pipe API SDK text stream through shared parser for structured output.

## Architecture Decisions

| Decision | Option A | Option B | Choice | Rationale |
|----------|----------|----------|--------|-----------|
| Markdown renderer | react-markdown v10 (already in deps) | marked (6KB, new dep) | react-markdown | Zero new dependency; tree-shaken; rehype-sanitize already installed |
| Response UI | Separate `ResponseBlock.tsx` | Extend ThinkingBlock with `variant` | Separate component | Different visual treatment, no format prop, avoids boolean-prop bloat |
| Parser fallback | Prose → `response` event | Keep prose → `thinking` (status quo) | `response` | Non-finding text is model prose, not reasoning. Keeping `thinking` preserves the OpenCode double-thinking bug |
| Capability flow | New `meta` ScanEvent at scan start | Embed in stage event | `meta` event | Single delivery, no extra HTTP fetch, clean SSE contract |

## Data Flow

```
Transport (CLI/ACP/HTTP/SDK/API) → shared/textLineToEvent → ProviderEvent
  ├─ Finding (JSON 4-field)      → FindingEvent
  ├─ [tool] prefix               → ProgressEvent
  └─ Everything else             → ResponseEvent (FIX: was ThinkingEvent)

ProviderEvent → stage2-llm → ScanEvent → SSE → ScanProgress UI
  ├─ thinking → ThinkingBlock  (markdown rendered when format='markdown')
  └─ response → ResponseBlock  (plain text, collapsed by default)
```

Capability flow: `provider.capability` → first SSE event as `{ type:'meta', transportKind, thinkingSupport, providerId }` → UI badges.

## File Changes

| File | Action | Summary |
|------|--------|---------|
| `lib/providers/shared/line-parser.ts` | Create | `textLineToEvent()` + `VALID_SEVERITIES`. Fallback returns `{ type:'response', text }`. |
| `lib/providers/index.ts` | Modify | Add `ResponseEvent`, extend `capability` with `transportKind: 'cli'\|'api'`, `thinkingSupport: 'none'\|'plain'\|'markdown'` |
| `lib/providers/cli/parsers/native-to-findings.ts` | Modify | Delete local `textLineToEvent` + `VALID_SEVERITIES`; import from `../shared/line-parser` |
| `lib/providers/transport/acp.ts` | Modify | Same — delete local copy, import shared |
| `lib/providers/transport/http.ts` | Modify | Same — delete local copy, import shared |
| `lib/providers/sdk/claude.ts` | Modify | Text blocks → pipe through `textLineToEvent` (was raw `progress`); `thinking` blocks unchanged |
| `lib/providers/api/stream.ts` | Modify | Buffer textStream into lines → `textLineToEvent` (was raw `progress` per chunk) |
| `lib/providers/stage-routing.ts` | Modify | Populate `transportKind`/`thinkingSupport` per agent on `capability` object |
| `lib/pipeline/events.ts` | Modify | Add `responseEventSchema`, `metaEventSchema`; add both to `ScanEvent` union |
| `lib/pipeline/stage2-llm.ts` | Modify | Emit `meta` event on start; forward `response` events to SSE |
| `lib/pipeline/stage3-validate.ts` | Modify | Handle `response` events — accumulate text, forward to SSE |
| `components/ui/ThinkingBlock.tsx` | Modify | Respect `format` prop: react-markdown for `'markdown'`, `<pre>` for `'plain'` |
| `components/ui/ResponseBlock.tsx` | Create | Collapsible prose block, info-styled border, plain text |
| `app/scans/[id]/ScanProgress.tsx` | Modify | Handle `response` SSE events → ResponseBlock; handle `meta` → provider badges |

## Key Interfaces

```typescript
// ProviderEvent union gains:
export interface ResponseEvent { type: 'response'; text: string }

// Capability extended:
{ stream, tools, jsonMode, transportKind, thinkingSupport }

// ScanEvent union gains:
{ type: 'response'; text: string }
{ type: 'meta'; transportKind: 'cli'|'api'; thinkingSupport: 'none'|'plain'|'markdown'; providerId: string }

// Shared parser:
export function textLineToEvent(line: string): ProviderEvent
export const VALID_SEVERITIES: ReadonlySet<string>
```

## Testing Strategy

| Layer | Test | Approach |
|-------|------|----------|
| Unit | `textLineToEvent` — all branches | Table-driven: valid finding → FindingEvent, `[tool]` → ProgressEvent, garbage finding → ResponseEvent, prose → ResponseEvent |
| Unit | ThinkingBlock markdown | Render markdown input (headers, code blocks, lists), verify DOM output |
| Unit | ResponseBlock | Test expand/collapse toggle, verify text content |
| Integration | Transport import swap | Feed same input to each transport, verify event types unchanged (refactor is mechanical) |
| Integration | `wrapStreamText` structured output | Feed text stream with finding JSON lines, verify FindingEvent + ResponseEvent emitted |

## Rollback

Revert transports to local `textLineToEvent` copies (restore `thinking` fallback). Remove `ResponseEvent` from unions — TypeScript compile error ensures no silent breakage.

## Open Questions

- [ ] ResponseBlock default state: collapsed (matching ThinkingBlock) or expanded? **Recommendation**: collapsed.
- [ ] Meta event timing: before stage0 or alongside it? **Recommendation**: alongside stage0-prep as first SSE event.
