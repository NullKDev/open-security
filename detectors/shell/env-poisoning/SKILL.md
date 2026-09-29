---
id: env-poisoning
title: Shell Environment Variable Poisoning
stages: [llm-scan, validate]
severity: medium
description: Detects environment variable poisoning risks — PATH/IFS/LD_PRELOAD manipulation, sudo env_keep excess, TMPDIR race conditions in shell scripts.
---

## Detection Prompt
Analyze for environment poisoning. Look for: PATH manipulation, LD_PRELOAD/LD_LIBRARY_PATH from user input, IFS tampering, sudo with env_keep, TMPDIR race conditions, setuid scripts trusting inherited env. Code: {code}

## Validation Prompt
Env poisoning at {file}:{line}. Can attacker control these variables? Is the script setuid? {snippet}

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics
- Container/CI environments with controlled PATH
- Scripts explicitly resetting PATH at start
- Development scripts not run with elevated privileges
