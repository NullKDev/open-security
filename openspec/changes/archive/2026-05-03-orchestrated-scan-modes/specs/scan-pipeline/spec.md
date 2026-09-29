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
