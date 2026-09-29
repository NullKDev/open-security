# Delta for scan-schema

## ADDED Requirements

### Requirement: ResponseEvent in ScanEvent

The `ScanEvent` discriminated union MUST include a `ResponseEvent` variant with `type: 'response'`, `text: string`, and `format?: 'markdown' | 'plain'` (default `'plain'`). The Zod `scanEventSchema` MUST list `responseEventSchema` in its `discriminatedUnion` array.

#### Scenario: Response event passes validation

- GIVEN a `ResponseEvent` object `{ type: 'response', text: 'Analysis complete', format: 'plain' }`
- WHEN `scanEventSchema.parse` validates it
- THEN parsing succeeds and returns the event

#### Scenario: Response event emitted via SSE

- GIVEN a scan produces a `ResponseEvent` from the provider
- WHEN the pipeline routes it to the bus
- THEN SSE subscribers receive the event with `type: 'response'`

### Requirement: Transport Metadata in Events

Every `ScanEvent` that originates from a provider's output MUST carry optional `transport_kind: 'sdk' | 'http' | 'acp' | 'spawn-json' | 'api-sdk'` metadata. The `thinkingSupport: boolean` field MUST accompany it for UI capability awareness. Both fields MUST be optional (Zod `.optional()`) for events that do not originate from providers (e.g., `stage` events, classical findings).

#### Scenario: Transport metadata on finding from Claude SDK

- GIVEN Claude SDK transport produces a `FindingEvent`
- WHEN the pipeline converts it to a `ScanEvent`
- THEN the event includes `transport_kind: 'sdk'` and `thinkingSupport: true`

#### Scenario: No transport metadata on stage event

- GIVEN the pipeline emits a `stage` event (not from a provider)
- WHEN `scanEventSchema.parse` validates it
- THEN `transport_kind` and `thinkingSupport` are absent and validation passes

### Requirement: Buffer Priority for Response Events

`isHighPriorityEvent()` MUST NOT classify `response` events as high-priority. Response events (like `thinking`) are display content that can be safely dropped from the buffer under memory pressure. Only `finding`, `error`, `done`, and `stage` events remain high-priority.

#### Scenario: Response event dropped from full buffer

- GIVEN the bus buffer is at MAX_BUFFER (256) with no `progress` events to evict
- WHEN a new `response` event arrives
- THEN the oldest `response` or `thinking` event is dropped to make room (NOT a finding, error, done, or stage event)
