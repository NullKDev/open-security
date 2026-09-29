# Orchestrated Scan Specification

## Purpose

Defines the multi-pass domain orchestration behavior for `intermediate` and `paranoid` modes.

## Requirements

### Requirement: Domain Pass Execution

The system MUST execute one LLM call per domain listed in the ProjectMap. Each domain call MUST receive: a scoped file list, a domain-specific checklist, and injected skill rules resolved for that domain and stack. Domain calls MUST be sequential (not parallel).

Domain count MUST be 3–4 for `intermediate` and 5–7 for `paranoid`.

#### Scenario: All domain passes complete

- GIVEN a `paranoid` scan with a valid ProjectMap containing 6 domains
- WHEN the orchestrated strategy iterates domains
- THEN exactly 6 LLM calls are made, one per domain
- AND each finding in the output carries a `domain` attribute identifying its originating pass
- AND findings are aggregated and passed to stage3-validate unchanged

#### Scenario: Paranoid mode includes fix suggestions

- GIVEN a `paranoid` scan running a domain pass
- WHEN the domain prompt is constructed
- THEN the prompt MUST request inline fix suggestions for each finding

#### Scenario: Intermediate mode does not request fix suggestions

- GIVEN an `intermediate` scan running a domain pass
- WHEN the domain prompt is constructed
- THEN the prompt SHOULD NOT request inline fix suggestions

#### Scenario: Provider rate-limit (429) during domain pass

- GIVEN the LLM provider returns a 429 during domain pass N
- WHEN the strategy receives the error
- THEN the strategy applies the existing backoff logic and emits a progress event
- AND the scan does not fail unless all retries are exhausted

### Requirement: Finding Aggregation

All domain findings MUST be merged into a single findings list before being handed to stage3-validate. Each finding MUST carry its `domain` label. The aggregated list MUST be deduplicated on (locationPath, locationLineStart, title) before stage3.

#### Scenario: Duplicate finding across domains

- GIVEN domain "auth" and domain "input-validation" both surface the same finding at the same location
- WHEN aggregation runs
- THEN only one instance of that finding is forwarded to stage3
- AND the retained instance preserves the `domain` of the first occurrence
