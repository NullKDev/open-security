---
id: auth-bypass
title: Authentication Bypass
stages:
  - llm-scan
  - validate
severity: critical
description: Detects authentication bypass vulnerabilities — JWT none-algorithm attacks, missing middleware on sensitive routes, type coercion in comparisons, OAuth state bypass, and session fixation.
classical_prepass: bearer
classical_hint: javascript_lang_jwt_hardcoded_secret
---

# Authentication Bypass Detector

## Detection Prompt

```
You are hunting for authentication bypass vulnerabilities. These are weaknesses that allow an attacker to access protected resources WITHOUT valid credentials.

STEP 1 — Find authentication middleware/guards and map which routes they protect:

Express/Koa/Fastify (Node.js):
  Open app.js, server.ts, router files. Look for:
  - app.use(authMiddleware) — is this applied globally or only to some routes?
  - router.get('/admin', authMiddleware, handler) vs router.get('/admin', handler)
  - Find routes that handle sensitive operations (admin, user data, payments) WITHOUT auth middleware

Next.js:
  - Open middleware.ts — does it cover /api/* and /admin/* paths?
  - Look for exported `middleware` function — check `matcher` config
  - Check each API route in app/api/ or pages/api/ for missing auth checks
  - Look for `export const config = { matcher: ['/protected/:path*'] }` — are all sensitive paths covered?

Django:
  - @login_required decorator missing from sensitive views
  - LoginRequiredMixin missing from class-based views
  - permission_classes = [AllowAny] on DRF ViewSets that should be protected

Spring Boot:
  - .permitAll() in SecurityConfig for sensitive endpoints
  - @PreAuthorize missing on sensitive @RestController methods
  - antMatchers("/admin/**").permitAll() — should be .hasRole("ADMIN")

STEP 2 — Audit JWT verification specifically:

Open ALL files that verify JWTs. Search for: verify, decode, jwt.verify, jsonwebtoken, PyJWT, java-jwt, jjwt

JWT none-algorithm attack:
  jsonwebtoken: jwt.verify(token, secret) — is `algorithms` option specified?
  If NOT: jwt.verify(token, secret, { algorithms: ['HS256'] }) ← SAFE
  If: jwt.verify(token, secret) ← VULNERABLE to none-algorithm if library allows it

  PyJWT: jwt.decode(token, key, algorithms=["HS256"]) ← SAFE
  PyJWT: jwt.decode(token, key) ← VULNERABLE in older versions

Algorithm confusion (RS256 → HS256):
  If server uses RS256 (asymmetric), look for: does verify() accept both RS256 and HS256?
  Attacker signs with public key using HS256 — if server accepts both, it succeeds
  Flag: algorithms: ['RS256', 'HS256'] together, or no algorithm restriction

Missing verification:
  jwt.decode(token) without verify (base64 decode only — NO SIGNATURE CHECK)
  Python: jwt.decode(token, options={"verify_signature": False})
  Look for: jwtDecode(), decode() from jwt-decode library (client-side only, no verification)

Hardcoded weak secrets:
  secret = "secret", "password", "changeme", "your-256-bit-secret", "jwt_secret"
  Any JWT secret shorter than 32 characters is brute-forceable

STEP 3 — Check type coercion in auth comparisons:

JavaScript loose equality:
  if (user.role == 0) — number vs string coercion (attacker sends "0")
  if (req.body.isAdmin == true) — "true" string equals true loosely
  if (token == null) — undefined and null both match
  ALL comparisons in auth logic MUST use === not ==

PHP loose comparison:
  if ($password == $hash) — type juggling: "0e123" == "0e456" is TRUE (magic hashes)
  strcmp($a, $b) == 0 can be bypassed with arrays: strcmp([], "secret") returns null, null == 0 is TRUE
  in_array($role, $allowedRoles) without strict mode

STEP 4 — Check for conditional authentication bypasses:

  if (process.env.NODE_ENV !== 'production') { skip auth } — what if NODE_ENV is not set?
  if (req.headers['x-internal'] === 'true') { skip auth } — header can be forged
  if (req.ip === '127.0.0.1') { skip auth } — can be spoofed via X-Forwarded-For
  if (req.body.debug === true) { return adminData } — debug backdoor left in code
  isAdmin: req.body.isAdmin — client controls their own role
```

## Validation Prompt

```
A potential authentication bypass was reported at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. Is this an endpoint/route that handles sensitive data or privileged operations?
2. What is the specific bypass vector? (missing middleware, JWT algorithm confusion, type coercion, header bypass?)
3. Is there another auth layer upstream (API gateway, reverse proxy) that would catch this?
4. Is the bypass reachable without prior authentication (unauthenticated access)?
5. If JWT: what algorithm restriction is enforced? Is signature verification actually called?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Health check routes (`/health`, `/ping`, `/metrics`) without auth are expected and not vulnerable
- Public API endpoints (login, registration, public catalog) are intentionally unauthenticated
- `NODE_ENV` checks behind feature flags that are only accessible in dev environments are low risk if the dev environment is properly isolated
- Routes protected by multiple independent layers (API gateway + application middleware) — both must be bypassed; reduce severity
- JWT `decode()` functions in CLIENT-SIDE JavaScript (browser bundle, React app) are not auth bypasses — they don't perform server-side authorization
- `jwt.verify()` called in a test file with a test secret is not a production vulnerability
