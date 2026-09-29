---
id: path-traversal
title: Path Traversal
stages:
  - llm-scan
  - validate
severity: high
description: Detects path traversal vulnerabilities where user-controlled input influences filesystem paths, potentially allowing access to files outside the intended directory.
classical_prepass: semgrep
classical_hint: p/owasp-top-ten
---

# Path Traversal Detector

## Detection Prompt

```
Analyze the following code for path traversal vulnerabilities. Look for:
- File read/write operations (fs.readFile, open(), fopen()) where the path is derived from user input
- Path construction using string concatenation or template literals with request parameters
- Missing path canonicalization (path.resolve, realpath) before file access
- Missing boundary checks to ensure the resolved path stays within an expected root directory
- Download endpoints that serve files based on user-supplied filenames
- Zip/archive extraction that doesn't validate entry paths (Zip Slip)
- Static file serving with insufficient path sanitization

For each finding, identify:
1. The user-controlled input used to construct the path
2. The filesystem operation sink
3. Whether path.resolve() or equivalent is called
4. Whether the resolved path is checked against an allowed root

Code context:
{code}
```

## Validation Prompt

```
A potential path traversal vulnerability was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is the file path derived from user input (not hardcoded or from trusted config)?
2. Is path.resolve() (or equivalent) used to canonicalize before access?
3. Is the resolved path validated to stay under an expected root directory?
4. Does the application have a file allowlist or extension whitelist?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Paths resolved via `path.resolve(root, userInput)` AND checked with `startsWith(root)` are protected
- Static assets served from a fixed public directory with no user-controlled component are safe
- Framework-level static file middleware (Next.js /public, Express static) with no path override is safe
- File operations that only read from config-defined paths are not user-controllable
