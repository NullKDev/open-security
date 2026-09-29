# Tasks: Unified Provider Output

## Phase 1: Foundation — Shared Parser + Types

- [x] 1.1 Create `lib/providers/shared/line-parser.ts` — extract shared `textLineToEvent()` (3-branch: finding JSON→`FindingEvent`, `[tool]` prefix→`ProgressEvent`, else→`ResponseEvent`) + `VALID_SEVERITIES` set
- [x] 1.2 Update `lib/providers/index.ts` — add `ResponseEvent { type:'response', text, format? }` to `ProviderEvent` union; add `transportKind` (`'sdk'|'http'|'acp'|'spawn-json'|'api-sdk'`) and `thinkingSupport` (boolean) to `capability`

## Phase 2: Transport Wiring — Shared Parser + Schema

- [x] 2.1 Replace local copies in `lib/providers/cli/parsers/native-to-findings.ts` — delete local `textLineToEvent` + `VALID_SEVERITIES`, import from shared
- [x] 2.2 Replace local copies in `lib/providers/transport/acp.ts` — delete local `textLineToEvent` + `VALID_SEVERITIES`, import from shared
- [x] 2.3 Replace local copies in `lib/providers/transport/http.ts` — delete local `textLineToEvent` + `VALID_SEVERITIES`, import from shared
- [x] 2.4 Update `lib/pipeline/events.ts` — add `responseEventSchema` (`type:'response', text, format?`) and `metaEventSchema` (`type:'meta', transport_kind?, thinkingSupport?, providerId`); add both to `ScanEvent` union; keep `response` out of `isHighPriorityEvent`
- [x] 2.5 Update `lib/providers/stage-routing.ts` — populate `transportKind` and `thinkingSupport` on `capability` per agent (claude SDK→`true`, opencode ACP→`true`, others→`false`)

## Phase 3: UI Rendering — Markdown + ResponseBlock + SSE

- [x] 3.1 Update `components/ui/ThinkingBlock.tsx` — render via `react-markdown` when `format:'markdown'`, keep `<pre>` for `'plain'`; use `rehype-sanitize`
- [x] 3.2 Create `components/ui/ResponseBlock.tsx` — collapsible prose block (`details`/`summary`), info-styled border, plain text rendering
- [x] 3.3 Update `app/scans/[id]/ScanProgress.tsx` — handle `response` SSE events → render `<ResponseBlock>` with text and format
- [x] 3.4 Update `app/scans/[id]/ScanProgress.tsx` — handle `meta` SSE event (first event) → render provider capability badges (transport kind, thinking support)

## Phase 4: API/SDK Transport — Structured Output

- [x] 4.1 Rewrite `lib/providers/api/stream.ts` — buffer `textStream` into lines, feed through shared `textLineToEvent`; emit structured `FindingEvent`/`ResponseEvent` instead of raw `ProgressEvent` per chunk
- [x] 4.2 Update `lib/providers/sdk/claude.ts` — route text content blocks through `textLineToEvent`; keep `thinking` blocks unchanged (native structured reasoning)

## Phase 5: Pipeline Integration — Metadata + Validation

- [x] 5.1 Update `lib/pipeline/stage2-llm.ts` — emit `meta` event alongside existing stage-start event with `transport_kind`/`thinkingSupport` from `provider.capability`; add `response` case to `handleProviderEvent` forwarding to SSE; stamp metadata on all forwarded events
- [x] 5.2 Update `lib/pipeline/stage3-validate.ts` — add `response` event case accumulating text alongside `thinking` for `parseValidationResponse`, forward both to SSE
