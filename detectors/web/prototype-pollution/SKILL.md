---
id: prototype-pollution
title: Prototype Pollution (JavaScript)
stages:
  - llm-scan
  - validate
severity: critical
description: Detects JavaScript prototype pollution vulnerabilities where user-controlled input is merged into objects without sanitization, allowing manipulation of Object.prototype and leading to RCE, auth bypass, or DoS.
classical_prepass: semgrep
classical_hint: p/prototype-pollution
---

# Prototype Pollution Detector

## Detection Prompt

```
Analyze the following code for prototype pollution vulnerabilities in JavaScript/TypeScript. Look for:

1. Unsafe Object Merging:
   - Object.assign(target, userInput) — allows __proto__ pollution
   - Spread operator {...userInput} used in recursive merge functions
   - lodash.merge / lodash.defaultsDeep with untrusted input
   - Custom deepMerge/mergeDeep functions without sanitization

2. Property Access Pollution:
   - obj[userControlledKey] = userControlledValue — property injection
   - Object.create with user-controlled prototype
   - Object.setPrototypeOf with user input

3. Constructor/Prototype Chain Attacks:
   - userInput.constructor.prototype manipulation
   - Access to __proto__ via JSON.parse ({"__proto__": {"polluted": true}})
   - Access to constructor via parsed objects

For each finding, identify:
1. Where user input enters the merge/assign operation
2. What properties could be polluted
3. The impact (RCE via child_process options, auth bypass via role checks, DoS via toString)
4. Affected file and line number

Code context:
{code}
```

## Validation Prompt

```
A potential prototype pollution vulnerability was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is the input truly user-controlled (from request, URL, body, query params)?
2. Does the merge/assign operation actually reach Object.prototype via __proto__ or constructor?
3. Is there input sanitization (blocklist for __proto__, constructor, prototype keys)?
4. Would the polluted property cause actual impact (bypassed check, code execution, denial)?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives:
- Merge of server-generated config objects (no user input)
- Shallow merge with Object.assign where __proto__ is harmless (only affects the target object, not Object.prototype)
- Libraries that already sanitize (lodash v4+ with defaultsDeep fixed, just-clone, structuredClone)
- Object spread {...obj} used on its own without recursive merging — not vulnerable alone
- Test files with intentional prototype manipulation for testing
