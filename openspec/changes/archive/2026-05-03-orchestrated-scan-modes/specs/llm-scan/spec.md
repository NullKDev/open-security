# LLM Scan Specification

## Purpose

Defines the mode-aware LLM invocation behavior for stage2.

## Requirements

### Requirement: Mode-Aware LLM Invocation

stage2-llm MUST accept a `strategy` context object that provides: the prompt string (already enriched with skill rules and domain context), the `scanMode`, and optionally a `domain` label. It MUST NOT construct its own prompt for `intermediate` or `paranoid` — it delegates prompt construction entirely to the calling strategy.

#### Scenario: Standard mode — single pass

- GIVEN `scanMode: 'standard'` and a fully-constructed prompt from StandardStrategy
- WHEN stage2-llm is invoked
- THEN it makes exactly one LLM call using the provided prompt
- AND returns findings without a `domain` attribute

#### Scenario: Orchestrated domain pass

- GIVEN `scanMode: 'intermediate'` and a domain prompt for domain "auth"
- WHEN stage2-llm is invoked for that domain pass
- THEN it makes exactly one LLM call using the domain prompt
- AND every returned finding has `domain: 'auth'`

#### Scenario: No LLM provider configured

- GIVEN no LLM provider is configured for the 'llm-scan' stage
- WHEN stage2-llm is invoked (for any mode)
- THEN it returns an empty findings list and emits a progress warning
- AND the pipeline continues to stage4 with classical-only findings
