# Delta for provider-cli

## ADDED Requirements

### Requirement: Transport Dispatch in makeCliClient

`makeCliClient()` MUST inspect the agent entry's `TransportKind` and instantiate the corresponding transport module (`sdk`, `http`, `acp`, or `spawn-json`). The returned object MUST satisfy the `ProviderClient` interface regardless of transport kind.

#### Scenario: Correct transport instantiated

- GIVEN a `cli:claude` model string
- WHEN `makeCliClient()` is called
- THEN an SDK-based `ProviderClient` is returned, not a spawn-based one

#### Scenario: ProviderClient contract preserved

- GIVEN any agent with any transport kind
- WHEN `provider.scan(opts)` is called
- THEN the return type is `AsyncIterable<ProviderEvent>` — interface byte-identical to pre-change

#### Scenario: stage2-llm.ts untouched

- GIVEN the transport dispatch change is applied
- WHEN `stage2-llm.ts` is compiled
- THEN zero modifications to `stage2-llm.ts` are required

---

## REMOVED Requirements

### Requirement: Plain-Text Parser Path

(Reason: `parsers/plain.ts` is deleted. All agents MUST declare a structured transport kind. Raw text output is prohibited post-migration.)

### Requirement: Native-Findings Router

(Reason: `parsers/native-to-findings.ts` per-agent switch is deleted. JSON envelope parsing is handled by each transport's internal event mapper — no shared routing table needed.)

### Requirement: claude-stream-json Parser

(Reason: `parsers/claude-stream-json.ts` is deleted. Claude events are produced directly by the SDK transport as `ProviderEvent` items — no JSONL parsing required.)
