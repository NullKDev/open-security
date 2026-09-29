---
id: dep-vuln-context
title: Dependency Vulnerability Context
stages:
  - llm-scan
  - validate
severity: medium
description: Contextualizes OSV-Scanner dependency vulnerability findings by analyzing how vulnerable packages are actually used in the codebase, distinguishing exploitable usages from theoretical exposure.
classical_prepass: osv-scanner
classical_hint: osv-scanner
---

# Dependency Vulnerability Context Detector

## Detection Prompt

```
A dependency vulnerability scan has identified the following vulnerable packages:

{osv_findings}

For each vulnerable package, analyze the codebase to determine:
1. Which files import or require the vulnerable package
2. Which specific API methods or functionality are used from the package
3. Whether the vulnerable code path is actually exercised (e.g., a vulnerable parser that is never called with untrusted input)
4. Whether there are mitigating controls (input validation, sandboxing, network restrictions)
5. The actual attack surface based on usage patterns

Focus on distinguishing between:
- **Directly exploitable**: The vulnerable function is called with user-controlled input in a reachable code path
- **Theoretically exposed**: The package is imported but the vulnerable functionality is not used
- **Mitigated**: The vulnerable path exists but compensating controls reduce exploitability

For each finding, provide:
- Import locations
- Specific API usage
- Whether the vulnerable code path is reachable
- Recommended remediation priority

Code context:
{code}
```

## Validation Prompt

```
OSV-Scanner reported {cve_id} in {package}@{version}.

The reported vulnerable function/behavior: {vuln_description}

Usage found in codebase:
{usage_snippet}

Evaluate exploitability:
1. Is the vulnerable API/function actually called in the code?
2. Is the call path reachable from an untrusted input source?
3. Are there input validation or sandboxing controls before the vulnerable call?
4. What is the realistic attack scenario given this usage pattern?

Respond with JSON: {"exploitable": true|false, "confidence": 0.0-1.0, "usage_type": "direct|transitive|unused", "reason": "..."}
```

## FP Heuristics

- Packages imported for non-vulnerable functionality (e.g., lodash imported only for `_.cloneDeep` when only the parser is vulnerable) are lower risk
- Dev dependencies (devDependencies) are not shipped to production
- Transitive dependencies several levels deep with no direct call path are lower priority
- Vulnerabilities in packages only used in test files are not production risks
- Fixed versions available — treat as high priority for remediation even if not immediately exploitable
