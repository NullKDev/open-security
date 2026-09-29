---
id: cpp-buffer-overflow
title: C/C++ Buffer Overflow / Memory Safety
stages: [llm-scan, validate]
severity: critical
description: Detects C/C++ memory safety issues — buffer overflows (strcpy/sprintf without bounds), format string vulnerabilities, integer overflows, and use-after-free patterns.
classical_prepass: semgrep
classical_hint: p/cpp
---

# C/C++ Buffer Overflow Detector

## Detection Prompt

```
Analyze C/C++ code for memory safety vulnerabilities. Look for:

1. Buffer Overflows:
   - strcpy, strcat, sprintf without bounds checking (use strncpy, snprintf instead)
   - gets() — always unsafe, never use
   - scanf("%s") without width limit
   - alloca with user-controlled size
   - memcpy with destination size smaller than source

2. Format String:
   - printf(userInput) instead of printf("%s", userInput)
   - syslog with user-controlled format string
   - fprintf, snprintf, vsprintf with untrusted format

3. Integer Overflows in Allocation:
   - malloc(userSize * sizeof(T)) — overflow if userSize is large
   - size calculations without overflow guards before allocation
   - Signed/unsigned confusion in allocation sizes

4. Use-After-Free / Double Free:
   - Pointers used after free() call
   - free() called twice on same pointer
   - Realloc without checking return value (original pointer may be freed on failure)

Code context:
{code}
```

## Validation Prompt

```
C/C++ memory safety at {file}:{line}. Is input size bounded? Are safe alternatives (strncpy, snprintf) available? Is the allocated size validated before malloc?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Modern C++ with std::string, std::vector (automatic bounds management)
- Static analysis already verified bounds (Coverity, CodeQL, clang-analyzer)
- Embedded systems with known-maximum input sizes
- Performance-critical code with manual bounds checking immediately before operation
