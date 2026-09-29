# provider-output-model Specification

## Purpose

Defines the canonical provider event taxonomy, format hints, text-line classification rules, and capability metadata exposed to the UI.

## Requirements

### Requirement: ProviderEvent Taxonomy

The system MUST define six event types with clear semantic boundaries:

| Event | Emits when |
|-------|-----------|
| `thinking` | Model emits internal reasoning (Claude extended thinking, OpenCode `--thinking`, o1-style chains). Structured revelations of the model's internal process. |
| `response` | Model emits prose/analysis directed at the user — what the LLM "says", NOT what it thinks internally. Always user-facing content. |
| `progress` | Transport emits tool calls, status updates, or raw stream chunks. Non-semantic operational events. |
| `finding` | A security finding with all required fields (title, description, severity, location). |
| `error` | Transport or model error. Halts the stream unless recoverable. |
| `done` | Scan stream completed successfully. Always the terminal event. |

#### Scenario: Claude extended thinking → thinking event

- GIVEN Claude SDK emits a `thinking` content block
- WHEN the SDK transport processes the message
- THEN a `ThinkingEvent` with `format: 'markdown'` is yielded

#### Scenario: OpenCode reasoning → thinking event

- GIVEN OpenCode ACP transport receives a `{"type":"reasoning"}` notification
- WHEN `mapAcpNotification` processes the params
- THEN a `ThinkingEvent` with `format: 'markdown'` is yielded

#### Scenario: Model prose → response event

- GIVEN any transport receives non-JSON text that is NOT tool output and NOT reasoning
- WHEN `textLineToEvent` classifies the line
- THEN a `ResponseEvent` with `format: 'plain'` (default) is yielded

#### Scenario: Structured markdown prose → response with markdown format

- GIVEN a provider known to emit markdown prose (e.g., `format` capability)
- WHEN `textLineToEvent` classifies a non-finding, non-tool, non-reasoning line
- THEN a `ResponseEvent` with `format: 'markdown'` is yielded

#### Scenario: Rejected false finding → response event

- GIVEN a JSON line with valid finding fields but `location: 'N/A'` or `title: 'No vulnerabilities found'`
- WHEN `textLineToEvent` runs the false-finding filter
- THEN the line is reclassified as `response` (not `finding`, not `thinking`)

#### Scenario: Tool output → progress event

- GIVEN a line starting with `[tool]`
- WHEN `textLineToEvent` classifies the line
- THEN a `ProgressEvent` is yielded

### Requirement: Format Hints

Each text-bearing event (`thinking`, `response`) MUST carry a `format` field: `'markdown'` when the provider emits structured content (headers, code blocks, lists); `'plain'` for raw/unstructured text. The field MUST default to `'plain'` when absent.

#### Scenario: Markdown thinking preserved

- GIVEN Claude SDK emits reasoning with markdown structure
- WHEN the ThinkingEvent is constructed
- THEN `format: 'markdown'` is set and survives through pipeline → UI

#### Scenario: Plain text default

- GIVEN a spawn-json transport emitting raw text lines
- WHEN text is classified as `response`
- THEN `format: 'plain'` is set (explicit default)

### Requirement: Shared textLineToEvent

All transports MUST classify text lines through a single `textLineToEvent` function in `lib/providers/shared/line-parser.ts`. Classification order: (1) JSON with 4-field finding schema → `finding`, (2) `[tool]` prefix → `progress`, (3) everything else → `response`. Text NEVER falls through to `thinking` — only structured reasoning events from native-format handlers emit `thinking`.

#### Scenario: Finding detected in any transport

- GIVEN the LLM outputs `{"title":"SQLi","description":"...","severity":"high","location":"src/db.ts:12"}`
- WHEN any transport passes this line through shared `textLineToEvent`
- THEN a `FindingEvent` is yielded

#### Scenario: Prose text → response, not thinking

- GIVEN the LLM outputs `"I analyzed the file and found the following:"`
- WHEN shared `textLineToEvent` processes this line
- THEN a `ResponseEvent` is yielded (NOT a `ThinkingEvent`)

#### Scenario: VALID_SEVERITIES single source of truth

- GIVEN the shared parser module is the canonical location for `VALID_SEVERITIES`
- WHEN any transport validates a finding's severity
- THEN it imports `VALID_SEVERITIES` from `lib/providers/shared/line-parser.ts`, NOT a local copy

### Requirement: Capability Metadata

The `ProviderClient.capability` object MUST expose `transportKind` (`'sdk' | 'http' | 'acp' | 'spawn-json'`) and `thinkingSupport` (`true` when the transport emits dedicated reasoning events). This metadata MUST be forwarded to the SSE stream on scan start so the UI can render provider-aware badges.

#### Scenario: Thinking support advertised

- GIVEN a Claude SDK provider
- WHEN the client is constructed
- THEN `capability.thinkingSupport` is `true` and `transportKind` is `'sdk'`

#### Scenario: No thinking support for spawn-json

- GIVEN a qwen spawn-json provider
- WHEN the client is constructed
- THEN `capability.thinkingSupport` is `false`

#### Scenario: Metadata flows to UI

- GIVEN a scan starts with any provider
- WHEN the pipeline emits the first SSE event
- THEN the event includes `transportKind` and `thinkingSupport` so the UI can show capability badges
