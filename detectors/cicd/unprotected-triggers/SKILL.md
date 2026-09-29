---
id: unprotected-triggers
title: Unprotected CI/CD Workflow Triggers
stages: [llm-scan, validate]
severity: high
description: Detects CI/CD workflows with unprotected triggers — workflow_dispatch without input validation, workflow_run without branch restrictions, and pull_request_target misuse enabling unauthorized pipeline execution.
---

## Detection Prompt
Analyze CI/CD configs for unprotected triggers. Look for: workflow_dispatch without input validation, workflow_run on public repos without branch filter, pull_request_target checking out untrusted code, workflow_call without caller restrictions. Code: {code}

## Validation Prompt
Unprotected trigger at {file}:{line}. Can external actors trigger this? Are inputs validated? Is the workflow scoped to specific branches? {snippet}

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics
- Internal-only repos (workflow_dispatch by repo members only)
- pull_request_target with explicit checkout of base ref (safe pattern)
- workflow_run with if: github.event.workflow_run.conclusion == 'success' guard
