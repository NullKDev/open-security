# Rich Event Taxonomy Specification

## Purpose

Defines the new `ProviderEvent` and `ScanEvent` types — their Zod schemas, inferred TypeScript types, and SSE forwarding requirements — that expose ACP tool calls, permissions, cost, file operations, terminal output, and plans to the UI.

## Requirements

### Requirement: ToolCallEvent Schema

A `tool_call` ProviderEvent MUST exist with the following shape: `{ type: 'tool_call', toolName: string, toolCallId: string, input: unknown }`. The `input` field MUST be typed as `z.unknown()` to handle any tool parameter shape.

#### Scenario: Valid tool_call parses successfully

- GIVEN a JSON object `{ type: 'tool_call', toolName: 'read_file', toolCallId: 'tc-1', input: { path: '/foo' } }`
- WHEN `toolCallEventSchema.parse(obj)` is called
- THEN it MUST return a typed `ToolCallEvent` without throwing

#### Scenario: Missing toolName rejected

- GIVEN a JSON object missing `toolName`
- WHEN `toolCallEventSchema.parse(obj)` is called
- THEN Zod MUST throw a `ZodError`

---

### Requirement: ToolResultEvent Schema

A `tool_result` ProviderEvent MUST exist: `{ type: 'tool_result', toolCallId: string, output: unknown, isError: boolean }`. `isError` defaults to `false` when omitted.

#### Scenario: Valid tool_result parses

- GIVEN `{ type: 'tool_result', toolCallId: 'tc-1', output: 'content', isError: false }`
- WHEN parsed
- THEN a typed `ToolResultEvent` MUST be returned

#### Scenario: isError defaults to false

- GIVEN `{ type: 'tool_result', toolCallId: 'tc-1', output: null }` (no `isError`)
- WHEN parsed
- THEN `event.isError` MUST equal `false`

---

### Requirement: PermissionRequestEvent Schema

A `permission_request` ProviderEvent MUST exist: `{ type: 'permission_request', requestId: string, toolName: string, input: unknown, timeoutMs: number }`. `timeoutMs` MUST default to `60000` when omitted.

#### Scenario: Valid permission_request parses

- GIVEN `{ type: 'permission_request', requestId: 'pr-1', toolName: 'bash', input: { cmd: 'ls' } }`
- WHEN parsed
- THEN `event.timeoutMs` MUST equal `60000`

---

### Requirement: CostEvent Schema

A `cost` ProviderEvent MUST exist: `{ type: 'cost', inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number, costUsd?: number }`. All numeric fields MUST be non-negative integers except `costUsd` which is a non-negative float.

#### Scenario: Full cost event parses

- GIVEN all fields are present and valid
- WHEN `costEventSchema.parse(obj)` is called
- THEN all fields MUST be accessible on the result

#### Scenario: Negative inputTokens rejected

- GIVEN `inputTokens: -1`
- WHEN parsed
- THEN Zod MUST throw a `ZodError`

---

### Requirement: ServerInfoEvent Schema

A `server_info` ProviderEvent MUST exist: `{ type: 'server_info', agentId: string, agentVersion?: string, capabilities?: string[] }`.

#### Scenario: Minimal server_info parses

- GIVEN `{ type: 'server_info', agentId: 'gemini' }`
- WHEN parsed
- THEN `event.agentId` MUST equal `'gemini'` and optional fields MUST be `undefined`

---

### Requirement: FileReadEvent and FileWriteEvent Schemas

`file_read` MUST be: `{ type: 'file_read', path: string, preview?: string }`.
`file_write` MUST be: `{ type: 'file_write', path: string, preview?: string }`.
Both `path` fields MUST be non-empty strings.

#### Scenario: file_read with empty path rejected

- GIVEN `{ type: 'file_read', path: '' }`
- WHEN `fileReadEventSchema.parse(obj)` is called
- THEN Zod MUST throw a `ZodError`

---

### Requirement: TerminalOutputEvent Schema

A `terminal_output` ProviderEvent MUST exist: `{ type: 'terminal_output', command?: string, output: string, exitCode?: number }`.

#### Scenario: Valid terminal_output parses

- GIVEN `{ type: 'terminal_output', command: 'npm test', output: 'PASS', exitCode: 0 }`
- WHEN parsed
- THEN all three fields MUST be accessible on the result

---

### Requirement: PlanEvent Schema

A `plan` ProviderEvent MUST exist: `{ type: 'plan', steps: Array<{ title: string, status: 'pending' | 'in_progress' | 'done' | 'error' }> }`. `steps` MUST be a non-empty array.

#### Scenario: Plan with at least one step parses

- GIVEN `{ type: 'plan', steps: [{ title: 'Analyze code', status: 'in_progress' }] }`
- WHEN `planEventSchema.parse(obj)` is called
- THEN `event.steps[0].status` MUST equal `'in_progress'`

#### Scenario: Empty steps array rejected

- GIVEN `{ type: 'plan', steps: [] }`
- WHEN parsed
- THEN Zod MUST throw a `ZodError`

---

### Requirement: ScanEvent Discriminated Union Extended

The existing `scanEventSchema` discriminated union MUST be extended to include all 8 new event types: `tool_call`, `tool_result`, `permission_request`, `cost`, `server_info`, `file_read`, `file_write`, `terminal_output`, `plan`. Existing event types (`stage`, `progress`, `finding`, `error`, `done`, `thinking`, `response`, `meta`) MUST remain unchanged.

#### Scenario: All new types present in union

- GIVEN `scanEventSchema`
- WHEN a value of each new type is parsed
- THEN each MUST parse successfully without being routed to the `error` arm

#### Scenario: Unknown type rejected

- GIVEN `{ type: 'unknown_future_type' }`
- WHEN `scanEventSchema.parse(obj)` is called
- THEN Zod MUST throw a `ZodError`

---

### Requirement: SSE Serialization of New Events

The SSE stream route (`app/api/scans/[id]/stream/route.ts`) MUST serialize all 9 new event types as `data: <JSON>\n\n` lines. No new event type MUST be silently dropped by the serializer.

#### Scenario: tool_call forwarded over SSE

- GIVEN a `tool_call` event enters the scan event buffer
- WHEN the SSE route reads from the buffer
- THEN a `data:` line containing the serialized `tool_call` JSON MUST be sent to the client

#### Scenario: permission_request forwarded over SSE

- GIVEN a `permission_request` event is yielded by the transport
- WHEN the SSE route serializes it
- THEN the `data:` line MUST contain `"type":"permission_request"` and the `requestId`
