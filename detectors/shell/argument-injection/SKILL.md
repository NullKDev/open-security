---
id: shell-argument-injection
title: Shell Argument Injection
stages: [llm-scan, validate]
severity: high
description: Detects argument injection in shell scripts — unquoted variables, xargs without null delimiters, find -exec with user input, and unsafe command construction in bash/sh scripts.
classical_prepass: semgrep
classical_hint: p/shell
---

# Shell Argument Injection Detector

## Detection Prompt

```
Analyze shell scripts for argument injection. Look for:

1. Unquoted Variable Expansion:
   - $@, $*, $1, $2 used without double quotes (word splitting)
   - eval $USER_INPUT or eval "$CMD"
   - Variable interpolation in command strings: cmd "$var" (safe) vs cmd $var (unsafe)

2. Dangerous Pipelines:
   - xargs without -0 (null delimiter) with find output (spaces break)
   - find -exec with user-controlled file names
   - Command substitution with user input: $(userInput)

3. Unsafe Command Construction:
   - ssh $host "command" — host from user input
   - curl/wget with URL from untrusted source
   - sudo with user-controlled arguments

Code context:
{code}
```

## Validation Prompt

```
Shell injection at {file}:{line}. Is user input quoted? Are variables double-quoted? Is eval used with untrusted data?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Double-quoted variables ("$var") — safe from word splitting
- find ... -print0 | xargs -0 — safe pattern with null delimiters
- Command substitution with hardcoded commands $(which python3)
- Shell scripts running only in CI/CD with trusted input
