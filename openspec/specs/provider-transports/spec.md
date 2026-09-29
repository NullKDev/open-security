# provider-transports Specification

## Purpose

Defines the four transport kinds available to CLI-based providers and the canonical agent→transport mapping.

## Requirements

### Requirement: Transport Kind Enum

The system MUST define `TransportKind`: `sdk | http | acp | spawn-json`. Each agent entry MUST declare exactly one kind.

| Agent | Transport |
|-------|-----------|
| claude | sdk |
| ollama | http |
| opencode, gemini, codex | acp |
| qwen, cursor-agent | spawn-json |

#### Scenario: Known agent resolves transport

- GIVEN a valid `cli:<agentId>` model string
- WHEN transport resolution runs
- THEN a `TransportKind` is returned without error

#### Scenario: Unknown agent fails fast

- GIVEN an unrecognized `agentId`
- WHEN resolution is attempted
- THEN a typed error is thrown before any process spawns

---

### Requirement: Shared Line Parser

All transport implementations MUST import `textLineToEvent` and `VALID_SEVERITIES` from `lib/providers/shared/line-parser.ts`. Transports MUST NOT define their own local copies. Duplicated `textLineToEvent` functions in `http.ts`, `acp.ts`, and `native-to-findings.ts` MUST be removed.

#### Scenario: Single import across transports

- GIVEN three transports (HTTP, ACP, spawn-json) and the native-to-findings parser
- WHEN each processes LLM text output
- THEN all import `textLineToEvent` from the same shared module

#### Scenario: Compile error on duplicate

- GIVEN a local `textLineToEvent` or `VALID_SEVERITIES` exists in a transport file
- WHEN lint or type-check runs
- THEN the duplicate is flagged as dead code

---

### Requirement: API SDK Transport text routing

The `api` transport MUST route raw text chunks through the shared `textLineToEvent` parser instead of emitting every chunk as `progress`. The `wrapStreamText` wrapper MUST be replaced with a parser-aware stream that classifies each line as `finding`, `response`, or `progress`.

#### Scenario: API SDK finding detected

- GIVEN Anthropic API returns a finding JSON line in `textStream`
- WHEN the shared parser processes the line
- THEN a `FindingEvent` is yielded (not a raw `progress` event)

#### Scenario: API SDK prose → response

- GIVEN API stream produces prose text ("Here is my analysis...")
- WHEN the shared parser processes the lines
- THEN `ResponseEvent` items are yielded

---

### Requirement: SDK Transport (claude)

The `sdk` transport MUST query `@anthropic-ai/claude-agent-sdk` (exact-pinned version). It MUST return `AsyncIterable<ProviderEvent>`.

#### Scenario: SDK scan produces events

- GIVEN claude binary installed and SDK package present
- WHEN scan prompt submitted via SDK transport
- THEN stream emits ≥1 `ThinkingEvent` or `FindingEvent` before closing

#### Scenario: SDK package missing

- GIVEN `@anthropic-ai/claude-agent-sdk` not installed
- WHEN transport initializes
- THEN a typed dependency error is thrown, not a runtime crash

---

### Requirement: HTTP Transport (ollama)

The `http` transport MUST `fetch` `http://localhost:11434/api/chat` with streaming response. Text lines from the LLM response MUST be classified via the shared `textLineToEvent` parser.

(Previously: `http.ts` defined its own local `textLineToEvent` copy — now uses the shared module)

#### Scenario: Ollama text classified by shared parser

- GIVEN Ollama's streaming response produces text lines
- WHEN the HTTP transport processes each line
- THEN it calls the shared `textLineToEvent` (NOT a local copy)

#### Scenario: Daemon available

- GIVEN `ollama serve` is active on port 11434
- WHEN HTTP transport sends a prompt
- THEN the stream yields `ProviderEvent` chunks

#### Scenario: Daemon unavailable

- GIVEN nothing is listening on port 11434
- WHEN the pre-scan probe runs
- THEN a user-readable error is surfaced before the scan starts

---

### Requirement: ACP Transport (opencode, gemini, codex)

The `acp` transport MUST implement JSON-RPC 2.0 over stdio. Text/notification lines MUST be classified via the shared `textLineToEvent` parser. Dedicated `reasoning` notifications MUST yield `ThinkingEvent` with `format: 'markdown'`. All other text MUST be routed through the shared parser.

(Previously: `acp.ts` defined its own local `textLineToEvent` copy — now uses the shared module)

#### Scenario: Reasoning notification → thinking (unchanged classification)

- GIVEN ACP receives `{"params":{"text":"Let me think..."}}` as a reasoning block
- WHEN native handler processes it
- THEN a `ThinkingEvent` with `format: 'markdown'` is yielded

#### Scenario: Text notification → shared parser

- GIVEN ACP receives a text notification parameter
- WHEN `mapAcpNotification` splits it into lines
- THEN each line is classified by the shared `textLineToEvent` (imported from `lib/providers/shared/line-parser.ts`)

#### Scenario: Handshake succeeds

- GIVEN an ACP-capable agent binary is installed
- WHEN the transport opens stdio and sends `initialize`
- THEN the agent responds with a capabilities object before any prompt is accepted

#### Scenario: Prompt yields events

- GIVEN a successful `initialize` handshake
- WHEN a security-scan prompt is sent
- THEN `ProviderEvent` items are emitted and the stream closes on completion

---

### Requirement: Spawn-JSON Transport (qwen, cursor-agent)

The `spawn-json` transport MUST invoke the CLI with `--output-format json`. Raw text (plain) output that is not a finding and not a tool call MUST be classified as `response`, NOT `thinking`. Only dedicated reasoning events from native-format handlers (e.g., OpenCode `reasoning` type) produce `thinking` events.

(Previously: non-finding, non-tool text lines were classified as `thinking` with `format: 'plain'`)

| Agent | Flag |
|-------|------|
| qwen | `--output-format json` |
| cursor-agent | `--output-format json` |

#### Scenario: Model prose → response

- GIVEN a spawn-json agent outputs text "Let me check the auth module..."
- WHEN `textLineToEvent` (shared parser) classifies the line
- THEN a `ResponseEvent` is yielded (NOT a `ThinkingEvent`)

#### Scenario: JSON flag present (unchanged)

- GIVEN the binary supports `--output-format json`
- WHEN spawn-json transport invokes it
- THEN stdout is valid newline-delimited JSON

#### Scenario: Flag unsupported in older binary (unchanged)

- GIVEN the binary lacks `--output-format json`
- WHEN the transport initializes
- THEN a minimum-version error is surfaced during capability probing
