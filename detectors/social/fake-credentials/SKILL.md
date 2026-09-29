---
id: fake-credentials
title: Fake / Planted Credentials and Social Engineering Artifacts
stages: [llm-scan, validate]
severity: high
description: Detects deliberately planted fake credentials, backdoor passwords, social engineering comments that bypass security, malicious package scripts, and insider threat patterns in source code and configuration.
---

# Fake Credentials and Social Engineering

## Detection Prompt

You are a social engineering and insider threat analyst. Look for deliberately misleading or malicious artifacts in the codebase.

### 1. Planted Fake Credentials (that look real)
Real credentials that look fake are more dangerous than obvious fakes:
- Credentials in comments: `// use this if the main one fails: password=abc123`
- Credentials in README described as "example" but matching real service formats (correct prefix+length)
- Multiple credential sets where one is "backup" or "fallback" — actual working credentials
- `.env.example` values that match real service key formats exactly (not `YOUR_KEY_HERE`)
- Test credentials identical in format to production keys (same prefix, same length)

### 2. Backdoor Accounts and Hardcoded Access
- Magic username/password bypassing auth: `if (username === "admin_backdoor")`, `if (password === "letmein2024")`
- Hidden debug routes: `if (process.env.DEBUG_MODE) return { admin: true }` — overrides auth
- Bypass headers: `if (req.headers['x-internal-bypass'])` — disables middleware checks
- Hardcoded admin tokens: `const MASTER_TOKEN = "hardcoded-secret-here"` checked against API requests
- Default admin credentials documented or seeded: `INSERT INTO users VALUES ('admin', 'admin123')`

### 3. Social Engineering in Code Comments
Flag comments that:
- Disable security: `// disable auth check for performance`, `// TODO: re-enable validation after demo`
- Claim bypass is safe: `// internal route, no need to validate`, `// skip for now, revisit later`
- Reference suspicious external URLs for "documentation"
- Encourage unsafe practices: `// just eval() this, easier`, `// validation breaks the feature`

### 4. Malicious Package / Build Scripts
In `package.json`, `setup.py`, `Makefile`, `Rakefile`, `build.gradle`:
- `preinstall`, `postinstall`, `prepare` scripts downloading and executing remote code
- Scripts sending system info to external servers
- `postinstall: "node -e 'require(\"child_process\").exec(...)'"` patterns
- `curl https://... | bash` in CI setup without pinned hash

### 5. Weak Default Credentials in Configuration
- Database seeds with `admin/admin`, `root/root`, `test/test123`
- JWT secrets set to `"secret"`, `"changeme"`, `"development"` without env override
- Default SMTP passwords in email config
- Redis/MongoDB/Elasticsearch with no auth in docker-compose that gets deployed

### 6. Data Exfiltration Under Guise of Analytics
- Logging that captures full request bodies including credentials
- "Analytics" calls that include authentication tokens or session data
- Error reporting (Sentry, Bugsnag) configured to capture request headers (Authorization header leaks)
- Debug logging of SQL queries with parameter values

## Validation Prompt

Fake or planted credential/artifact at {file}:{line}.

Evaluate:
1. Is this intentionally misleading or an innocent placeholder?
2. Would a developer using this compromise security?
3. Is this a planted backdoor or a misguided convenience?
4. What is the blast radius if this is used as intended?

Respond: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics

- Well-known fake credentials in official documentation (Stripe test keys `sk_test_...`, AWS example keys from AWS docs)
- Security tests that plant fake credentials to test detection tools — labeled clearly as such
- Penetration testing scripts labeled clearly as such
- Placeholder values: `YOUR_KEY_HERE`, `<SECRET>`, `REPLACE_ME`, `changeme` in .env.example
