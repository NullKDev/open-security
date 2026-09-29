---
id: redos
title: Regex Denial of Service (ReDoS)
stages: [llm-scan, validate]
severity: high
description: Detects regular expressions vulnerable to catastrophic backtracking — nested quantifiers, overlapping alternations, and patterns that cause exponential runtime on crafted input (CWE-1333).
classical_prepass: semgrep
---

# ReDoS Detector

## Detection Prompt

```
Analyze regular expressions for ReDoS vulnerabilities. Look for:

1. Nested Quantifiers (Evil Regex):
   - (a+)+, (a*)*, (a+)* — quantifier on a group that itself has a quantifier
   - ([a-zA-Z]+)* — overlapping character classes with quantifier
   - (\w+\s?)* — word boundary with optional space

2. Overlapping Alternations:
   - (a|aa)+ — alternatives where one is prefix of another
   - (.\s*.\s*)* — any char + whitespace combinations

3. User Input Reaching Regex:
   - .match(), .test(), .exec(), .search() with untrusted input
   - RegExp constructor with user-controlled pattern (new RegExp(userInput))
   - String methods (replace, replaceAll, split) with regex from user input

Code context:
{code}
```

## Validation Prompt

```
ReDoS at {file}:{line}. Does the pattern have nested quantifiers? Does user input reach the regex? Is there a timeout or input size limit?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Regex used only on server-generated strings (not user input)
- Input length limited before regex matching
- Regex engines with built-in backtracking limits (RE2, Go regexp, Rust regex)
- Patterns with atomic groups or possessive quantifiers (prevents backtracking)
