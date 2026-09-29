---
id: broken-access-control
title: Broken Access Control (IDOR/BOLA)
stages:
  - llm-scan
  - validate
severity: critical
description: Detects missing authorization checks where user-controlled object IDs reach data operations without ownership verification. Covers IDOR (Insecure Direct Object Reference), BOLA (Broken Object Level Authorization), and BFLA (Broken Function Level Authorization).
classical_prepass: semgrep
classical_hint: p/owasp-top-ten
---

# Broken Access Control Detector

## Detection Prompt

```
Analyze the following code for broken access control vulnerabilities. Look for:

1. Direct Object Reference (IDOR/BOLA):
   - User-controlled IDs (req.params.id, req.body.userId, $route.params.id) used in DB queries without ownership check
   - Object IDs from URL paths or request bodies passed directly to data operations
   - No verification that the requesting user owns or is authorized to access the object

2. Missing Authorization Checks:
   - API endpoints, route handlers, or controller methods without auth middleware
   - Role checks missing on admin/sensitive endpoints
   - Authorization logic that can be bypassed (e.g., checking req.user but not req.user.role)

3. Function-Level Authorization (BFLA):
   - Regular users accessing admin functions via URL manipulation
   - Missing role checks on DELETE, PUT, PATCH operations
   - Horizontal privilege escalation (user A accessing user B's data)

For each finding, identify:
1. The unprotected resource ID or endpoint
2. How the ID/user input reaches the data operation
3. What authorization check is missing
4. The affected file and line number

Code context:
{code}
```

## Validation Prompt

```
A potential broken access control vulnerability was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is the object ID truly user-controlled (from request, URL, body) — not a hardcoded or server-generated value?
2. Is there an authorization check between the input and the data operation?
3. Would a different user be able to access or modify data they shouldn't?
4. Is there middleware or a guard that validates ownership at a higher level?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives for this detector:
- Admin-only routes that check req.user.role before processing (authorization exists upstream)
- Object IDs generated server-side (crypto.randomUUID) — not user-controlled
- Public endpoints intentionally accessible without auth (login, register, health check)
- Read-only operations on public data (blog posts, product listings)
- Test fixtures with hardcoded IDs for testing
