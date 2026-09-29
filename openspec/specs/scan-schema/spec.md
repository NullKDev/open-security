# Scan Schema Specification

## Purpose

Defines the schema for scan modes and the database `project_map` column.

## Requirements

### Requirement: ScanMode Enum

`ScanModeSchema` MUST accept exactly `'quick' | 'standard' | 'intermediate' | 'paranoid'`. The default MUST remain `'standard'`. `'deep'` MUST NOT be accepted by the schema.

#### Scenario: Valid new mode accepted

- GIVEN a CreateScan request with `scanMode: 'paranoid'`
- WHEN `CreateScanSchema.parse` is called
- THEN validation passes

#### Scenario: Legacy deep mode rejected

- GIVEN a CreateScan request with `scanMode: 'deep'`
- WHEN `CreateScanSchema.parse` is called
- THEN validation throws a ZodError

#### Scenario: Default mode unchanged

- GIVEN a CreateScan request with no `scanMode` field
- WHEN `CreateScanSchema.parse` is called
- THEN the parsed value has `scanMode: 'standard'`

### Requirement: project_map Column

The `scans` table MUST have a `project_map TEXT` column, nullable, defaulting to NULL. Existing rows without a `project_map` value MUST be valid.

#### Scenario: Column present after migration

- GIVEN the migration has been applied
- WHEN a new scan row is inserted without `project_map`
- THEN the row is accepted and `project_map` is NULL

### Requirement: deep → paranoid Migration

Any existing `scans` row with `scan_mode = 'deep'` MUST be updated to `scan_mode = 'paranoid'` by the migration. The migration MUST be idempotent (re-running it on already-migrated data produces no error).

#### Scenario: Migration rewrites deep rows

- GIVEN one or more scan rows with `scan_mode = 'deep'` before migration
- WHEN the migration runs
- THEN all such rows have `scan_mode = 'paranoid'` after migration

---

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
