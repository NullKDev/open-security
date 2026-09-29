# Scan Pipeline Specification

## Purpose

Defines how the scan runner dispatches to per-mode strategies after stage1 classical analysis.

## Requirements

### Requirement: Scan Mode Dispatch

The runner MUST dispatch to a per-mode strategy after stage1. Supported modes are `quick`, `standard`, `intermediate`, and `paranoid`. The runner MUST NOT contain inline per-mode branching logic — all mode-specific behavior lives in the strategy implementation.

#### Scenario: quick mode

- GIVEN a scan with `scanMode: 'quick'`
- WHEN the runner reaches post-stage1 dispatch
- THEN only stage1 classical findings are forwarded to stage4; all LLM stages are skipped

#### Scenario: standard mode

- GIVEN a scan with `scanMode: 'standard'`
- WHEN the runner reaches post-stage1 dispatch
- THEN the StandardStrategy is invoked: one LLM pass with skill rules injected for detected stack, then stages 3–5

#### Scenario: intermediate mode

- GIVEN a scan with `scanMode: 'intermediate'`
- WHEN the runner reaches post-stage1 dispatch
- THEN the OrchestratedStrategy is invoked: Pass 0 generates ProjectMap (3–4 domains), then one domain pass per domain, then stages 3–5

#### Scenario: paranoid mode

- GIVEN a scan with `scanMode: 'paranoid'`
- WHEN the runner reaches post-stage1 dispatch
- THEN the OrchestratedStrategy is invoked: Pass 0 generates ProjectMap (5–7 domains), domain passes with fix suggestions, then stages 3–5

#### Scenario: unknown mode received at runtime

- GIVEN a scan record in the DB with an unrecognized `scanMode` value
- WHEN the runner initialises
- THEN it falls back to `standard` mode and emits a warning event

---

### Requirement: Response Event Forwarding

`handleProviderEvent` in `stage2-llm.ts` MUST forward `response` events to the SSE bus as `ScanEvent` items. The forwarding MUST preserve `text` and `format` fields. Response events MUST be forwarded before any finding normalization or domain stamping.

#### Scenario: Response event reaches UI

- GIVEN a provider yields a `ResponseEvent` with text "Checking auth module..." and `format: 'markdown'`
- WHEN `handleProviderEvent` processes the event
- THEN `onEvent({ type: 'response', text: 'Checking auth module...', format: 'markdown' })` is called

#### Scenario: Response event does not produce a finding

- GIVEN a provider yields a `ResponseEvent`
- WHEN `handleProviderEvent` processes it
- THEN no `NormalizedFinding` is pushed to the findings array

### Requirement: Stage 3 Response Event Handling

`runStage3Validate` MUST accumulate `response` events alongside `thinking` events when collecting the LLM's validation response text. Both event types' text content MUST be concatenated for `parseValidationResponse`. Response events MUST also be forwarded to the SSE bus (same as `thinking` events are today).

(Previously: only `progress` and `thinking` events contributed to `responseText`)

#### Scenario: Validation response arrives as response events

- GIVEN a provider yields a `{"passes":true,"rationale":"..."}` JSON as a `response` event during validation
- WHEN stage 3 processes the scan stream
- THEN the response text is accumulated into `responseText` and correctly parsed

#### Scenario: Mixed thinking + response during validation

- GIVEN a provider emits both `thinking` (reasoning) and `response` (prose with JSON verdict) during a validation pass
- WHEN stage 3 processes the stream
- THEN both event types' text is accumulated and forwarded to the SSE bus

### Requirement: Transport Metadata Propagation

When constructing `ScanEvent` items from `ProviderEvent` items in `handleProviderEvent`, the pipeline MUST stamp `transport_kind` and `thinkingSupport` from the `ProviderClient.capability` object onto every forwarded event. The `Stage2Opts` interface MUST gain access to this capability metadata.

#### Scenario: Finding event carries SDK metadata

- GIVEN stage 2 runs with Claude SDK (`transport_kind: 'sdk'`, `thinkingSupport: true`)
- WHEN a finding is forwarded as a `ScanEvent`
- THEN the event includes `transport_kind: 'sdk'` and `thinkingSupport: true`

#### Scenario: Response event carries HTTP metadata

- GIVEN stage 2 runs with Ollama HTTP transport (`transport_kind: 'http'`, `thinkingSupport: false`)
- WHEN a response is forwarded as a `ScanEvent`
- THEN the event includes `transport_kind: 'http'` and `thinkingSupport: false`
