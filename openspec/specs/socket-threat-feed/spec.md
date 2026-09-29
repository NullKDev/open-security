# Spec: Socket Threat Feed — Supply Chain Signal Injection

**Change**: v1.0  
**Date**: 2026-05-06  
**Domain**: socket-threat-feed

---

## Requirement: Socket.dev Signal Injection

The system SHALL query the Socket.dev threat feed for every npm/PyPI package in the dependency graph at scan time. Socket signals SHALL be stored as finding tags (`socket:malware`, `socket:typosquat`, `socket:suspicious-install`) and exposed as findings with `detector='socket'`. A missing Socket API key SHALL degrade gracefully — no socket findings, no error.

### Scenario: Socket signal detected and stored

- GIVEN a Socket API key is configured
- AND a scan includes an npm package flagged as malware by Socket
- WHEN the dependency scan stage runs
- THEN a finding with `detector='socket'` and tag `socket:malware` SHALL be created

### Scenario: Missing API key degrades gracefully

- GIVEN no Socket API key is configured
- WHEN a scan includes npm/PyPI packages
- THEN no Socket API calls SHALL be made
- AND the scan SHALL complete without error, with zero socket findings

### Scenario: Socket finding appears in queue

- GIVEN a Socket finding was created during a scan
- WHEN the findings queue loads
- THEN the finding SHALL appear with `source: socket-threat-feed` visible
