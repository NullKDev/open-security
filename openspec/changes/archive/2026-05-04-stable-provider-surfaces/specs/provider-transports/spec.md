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

The `http` transport MUST `fetch` `http://localhost:11434/api/chat` with streaming response body. It MUST probe `GET /api/version` before the first scan.

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

The `acp` transport MUST implement JSON-RPC 2.0 over stdio. It MUST send an `initialize` request before any `prompt` request. Notifications MUST be mapped to `ProviderEvent` items.

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

The `spawn-json` transport MUST invoke the CLI with `--output-format json`. Raw text (plain) output MUST NOT be accepted.

| Agent | Flag |
|-------|------|
| qwen | `--output-format json` |
| cursor-agent | `--output-format json` |

#### Scenario: JSON flag present

- GIVEN the binary supports `--output-format json`
- WHEN spawn-json transport invokes it
- THEN stdout is valid newline-delimited JSON

#### Scenario: Flag unsupported in older binary

- GIVEN the binary lacks `--output-format json`
- WHEN the transport initializes
- THEN a minimum-version error is surfaced during capability probing
