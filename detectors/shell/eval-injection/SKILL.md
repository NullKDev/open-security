---
id: shell-eval-injection
title: Shell Unsafe Eval / Source Injection
stages: [llm-scan, validate]
severity: critical
description: Detects eval/source injection in shell scripts — eval with user input, source with untrusted file paths, and indirect variable expansion from user-controlled data.
---

## Detection Prompt
Analyze shell scripts for eval/source injection. Look for: eval with $@/$1/$*, source with variable paths, bash -c with user data, indirect variable expansion ${!var} from untrusted source. Code: {code}

## Validation Prompt
Shell eval at {file}:{line}. Is input from untrusted source? Is there quoting/sanitization? {snippet}

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics
- eval on hardcoded strings
- source on package-managed file paths
- set -u / set -e preventing cascading failures
