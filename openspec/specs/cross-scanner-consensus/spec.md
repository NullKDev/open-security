# Spec: Cross-Scanner Consensus — Confidence Aggregation and Disagreement Detection

**Change**: v1.0  
**Date**: 2026-05-06  
**Domain**: cross-scanner-consensus

---

## Requirement: Consensus Score Computation

The system SHALL compute a `consensus_score` (0.0–1.0) for every finding where multiple scanners detected the same `dedup_key`. Score = agreeing scanners / total scanners that ran on that file. A finding where scanners disagree SHALL be tagged `status='conflicted'`.

### Scenario: Full agreement raises consensus score

- GIVEN semgrep and the LLM scanner both detect a finding with the same `dedup_key`
- AND both ran on that file
- WHEN consensus is computed
- THEN `consensus_score` SHALL be `1.0` and status SHALL be `agree`

### Scenario: Partial agreement produces conflicted state

- GIVEN semgrep detects a finding but the LLM scanner does not flag it
- AND both ran on that file
- WHEN consensus is computed
- THEN `consensus_score` SHALL be `0.5` and status SHALL be `conflicted`

### Scenario: Conflicted findings sorted above peers

- GIVEN the queue contains conflicted and non-conflicted findings of the same severity
- WHEN the findings queue renders
- THEN conflicted findings SHALL appear above non-conflicted findings of the same severity

### Scenario: Single-source finding

- GIVEN only one scanner ran on a file and produced a finding
- WHEN consensus is computed
- THEN `consensus_score` SHALL be `1.0` and status SHALL be `single-source`

### Scenario: Consensus indicator displayed per finding

- GIVEN a finding has `consensus_score = 0.5` from 1/2 scanners
- WHEN the finding row is rendered in the queue
- THEN the UI SHALL display a badge showing `1/2` (agreeing / total)
