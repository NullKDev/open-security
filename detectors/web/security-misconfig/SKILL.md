---
id: security-misconfig
title: Security Misconfiguration
stages:
  - llm-scan
  - validate
severity: high
description: Detects common security misconfigurations including debug endpoints in production, verbose error messages, missing security headers, default credentials, and unsafe framework defaults.
classical_prepass: semgrep
classical_hint: p/security-audit
---

# Security Misconfiguration Detector

## Detection Prompt

```
Analyze the following code for security misconfigurations. Look for:

1. Debug / Development Features in Production:
   - Debug mode enabled (DEBUG=True, NODE_ENV=development in non-dev configs)
   - Stack traces exposed to users (res.send(err.stack), error details in API responses)
   - Debug endpoints exposed (/debug, /phpinfo, /graphql with introspection)
   - Swagger/OpenAPI UI enabled in production without auth

2. Missing or Weak Security Headers:
   - No Content-Security-Policy header set
   - X-Frame-Options missing (clickjacking risk)
   - Missing Strict-Transport-Security (HSTS)
   - CORS configured with Access-Control-Allow-Origin: *
   - Permissions-Policy not configured

3. Default / Weak Credentials:
   - Hardcoded default passwords (admin/admin, root/root, changeme)
   - Default API keys or tokens in config files
   - Default secret keys (JWT_SECRET=secret, SESSION_SECRET=changeme)
   - Database connection strings with default credentials

4. Unsafe Framework Defaults:
   - Express: no helmet middleware, no rate limiting
   - Django: DEBUG=True, ALLOWED_HOSTS=['*']
   - Rails: config.force_ssl = false in production
   - Next.js: missing security headers config

For each finding, identify the misconfiguration, its risk, the affected file and line.

Code context:
{code}
```

## Validation Prompt

```
A potential security misconfiguration was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is this configuration actually used in a production environment?
2. Is the default/weak credential actually a real secret (not a placeholder or example)?
3. Is the debug feature accessible from outside (not behind a VPN or auth)?
4. Are there compensating controls (WAF, reverse proxy adding headers, network isolation)?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives:
- Example/documentation configs with placeholder values (changeme, secret, example.com)
- Development-only config files (.env.development, config/dev.js) — normal to have debug on
- Test fixtures with test credentials
- Configs that are overridden by environment-specific files in production
- CSP with * for localhost development (non-production)
