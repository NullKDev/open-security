# ADR-0004: Local-First, BYOK, No-Server Model

**Status**: Accepted (2026-05-02)

## Context

Security tools handle sensitive data (source code, vulnerabilities, API keys). We had to decide: run locally or provide a cloud service?

## Decision

**Local-first, no cloud dependencies, BYOK (bring your own keys).**

## Consequences

### Positive
- **Privacy**: Source code never leaves the user's machine (except when sent to LLM APIs by the user's choice)
- **No infrastructure cost**: No servers to maintain, no database to scale, no auth system to build
- **Offline-capable**: Classical scans work without internet
- **User owns their data**: `.obt/` directory can be backed up, migrated, or deleted
- **No vendor lock-in**: Users bring their own API keys for any supported provider

### Negative
- **No collaboration**: Can't share scan results with a team without manual export
- **Setup friction**: Users must install classical scanners and configure API keys
- **No telemetry**: Can't understand usage patterns to improve the product (by design)
- **System requirements**: Scanners need to be available on the user's machine — `GET /api/prereqs` helps but doesn't solve it

## Alternatives considered

- **SaaS model**: Easier onboarding, but source code exfiltration risk and infrastructure cost
- **Hybrid (local scan, cloud reports)**: Splits the problem but adds complexity
- **Electron app**: Better system integration, but adds heavy runtime dependency and complicates the scanner spawning
