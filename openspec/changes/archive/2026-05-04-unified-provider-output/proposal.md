# Proposal: Unified Provider Output

## Intent

Fix four structural flaws from the `stable-provider-surfaces` refactor:
1. OpenCode double thinking: model response misclassified as `thinking` — UI shows two indistinguishable ThinkingBlocks
2. `format` field ignored: `ThinkingBlock.tsx` renders all content as raw `<pre>`, losing Claude's structured reasoning
3. `textLineToEvent` duplicated 3× (249 lines) across `http.ts`, `acp.ts`, `native-to-findings.ts`
4. API SDK transport emits raw text with zero structure — no findings, thinking, or tools

Single shared output pipeline. Fix once, fix everywhere.

## Scope

**In**: Shared `textLineToEvent` extraction, new `response` event type, markdown rendering in ThinkingBlock, `ResponseBlock` component, provider capability metadata → UI, API transport routed through shared parser, SSE + pipeline updates.

**Out**: Agent action grouping, finding inline display, thinking DB persistence, cursor-agent overhaul, finding-detection improvements.

## Capabilities

### New
- **provider-output-model**: unified taxonomy (`thinking`, `response`, `progress`, `finding`, `error`, `done`), format-aware rendering, capability metadata.

### Modified
- **provider-transports**: transports MUST use shared parser; emit `response` for prose.
- **scan-schema**: ScanEvent gains `response` variant.
- **scan-pipeline**: pipeline routes `response` to SSE.

## Approach

1. **Shared parser**: Extract `textLineToEvent` + `VALID_SEVERITIES` → `lib/providers/shared/line-parser.ts`. Zero behavior change.
2. **Event taxonomy**: Add `ResponseEvent` to unions. Route `text`/prose → `response`, `reasoning` → `thinking`. Fixes OpenCode bug.
3. **Format-aware UI**: `ThinkingBlock`: markdown via `react-markdown` when `format: 'markdown'`, `<pre>` when `'plain'`. New `ResponseBlock`.
4. **Capability metadata**: Extend `capability` object (`transportKind`, `thinkingSupport`). SSE on start. UI badges.
5. **API transport**: Pipe `textStream` through shared parser — finding + thinking/response for SDK providers.

## Risks

| Risk | L | Mitigation |
|------|---|-----------|
| Transport breakage from shared parser | M | Mechanical import swap; smoke test each transport |
| `react-markdown` bundle size | L | Tree-shake; `marked` as 6 KB fallback |
| OpenCode upstream behavior change | L | Classification via event type, not CLI flag |
| SSE old-client breakage | L | `response` type is additive |

## Rollback

Revert transports to local `textLineToEvent` copies. Remove `ResponseEvent` from unions (compile fails downstream — no silent breakage). Replace markdown with `<pre>`.

## Dependencies

- `react-markdown` or `marked` npm dep
- `stable-provider-surfaces` transport refactor (done)

## Success Criteria

- [ ] `textLineToEvent` in 1 file, imported by 3+ transports; zero `VALID_SEVERITIES` duplicates
- [ ] OpenCode: reasoning in ThinkingBlock, analysis in ResponseBlock (no double thinking)
- [ ] Claude thinking renders markdown (headers, code blocks, lists)
- [ ] API SDK transport produces findings via shared parser
- [ ] Provider capabilities visible in scan console
- [ ] No regression across all transport kinds
