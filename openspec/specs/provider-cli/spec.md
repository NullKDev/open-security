# provider-cli Specification

## Purpose

Defines the routing contract for CLI-based providers. `makeCliClient()` inspects the agent's `TransportKind` and delegates to the appropriate transport module.

## Requirements

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
