---
id: self-hosted-runner
title: Self-Hosted Runner Compromise
stages: [llm-scan, validate]
severity: high
description: Detects self-hosted GitHub Actions runner risks — runners on public repos, missing ephemeral flag, and persistent state enabling attacker persistence between workflow runs.
---

## Detection Prompt
Analyze CI/CD for self-hosted runner risks. Look for: runs-on: self-hosted in public repos, missing --ephemeral flag, persistent state between runs, cached credentials on runners, Docker-in-Docker without cleanup. Code: {code}

## Validation Prompt
Self-hosted runner at {file}:{line}. Is this a public repo? Is the runner ephemeral? Are credentials isolated per job? {snippet}

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics
- Private/internal repos (self-hosted runners are expected)
- Ephemeral runners with Just-in-Time (JIT) registration
- Runners with job-level credential isolation
