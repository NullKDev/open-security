---
id: jwt-attacks
title: JWT Attacks — Algorithm Confusion, None Algorithm, Weak Secrets
stages: [llm-scan, validate]
severity: critical
description: Detects JWT security vulnerabilities — none-algorithm bypass, RS256-to-HS256 confusion, missing signature verification, weak HMAC secrets, and JWT claims not validated after decode.
classical_prepass: bearer
classical_hint: javascript_lang_jwt_hardcoded_secret
---

# JWT Attacks Detector

## Detection Prompt

```
You are hunting for JWT (JSON Web Token) vulnerabilities. These are among the highest-impact auth bugs — a successful attack typically yields full account takeover or privilege escalation without needing any credentials.

STEP 1 — Find all JWT operations. Search for:
  Imports: jsonwebtoken, jwt-simple, jose, PyJWT, python-jose, jjwt, java-jwt, io.jsonwebtoken, dgrijalva/jwt-go, golang-jwt/jwt, firebase/php-jwt
  Function calls: jwt.sign(), jwt.verify(), jwt.decode(), Jwts.builder(), Jwts.parserBuilder()

Open every file that imports or uses a JWT library.

STEP 2 — Check each specific attack vector:

=== ATTACK 1: "none" algorithm bypass ===

The attacker forges a JWT with alg=none, removes the signature, and the server accepts it.

JavaScript (jsonwebtoken library):
  VULNERABLE: jwt.verify(token, secret)  ← no algorithm restriction
  VULNERABLE: jwt.verify(token, secret, { algorithms: ['HS256', 'none'] })  ← explicitly allows none
  SAFE: jwt.verify(token, secret, { algorithms: ['HS256'] })  ← algorithm allowlist

Python (PyJWT):
  VULNERABLE: jwt.decode(token, key)  ← older PyJWT (<2.0) allows none
  VULNERABLE: jwt.decode(token, key, algorithms=["HS256", "none"])  ← allows none
  SAFE: jwt.decode(token, key, algorithms=["HS256"])

Java (jjwt):
  VULNERABLE: Jwts.parser().setSigningKey(key).parseClaimsJws(token)  ← does not reject none in some versions
  SAFE: Jwts.parserBuilder().setSigningKey(key).requireAlgorithm("HS256").build().parseClaimsJws(token)

Go (golang-jwt):
  VULNERABLE: jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) { return key, nil })
    Without checking: if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok { return nil, error }
  SAFE: Validate token.Method before returning key

=== ATTACK 2: RS256 → HS256 algorithm confusion ===

Server uses RS256 (asymmetric). Attacker gets the PUBLIC key. Re-signs a token with HS256 using the public key as the HMAC secret. If the server accepts both algorithms, it verifies the HMAC signature using the public key — attack succeeds.

VULNERABLE: Server accepts BOTH RS256 and HS256:
  algorithms: ['RS256', 'HS256']  ← both allowed together
  No algorithm check before selecting verification key

Detection pattern: look for JWT verification that accepts multiple algorithms AND uses different key types:
  If the code path for RS256 uses an RSA public key AND the code path for HS256 uses a separate HMAC secret →
  the server is likely safe (different keys for different algorithms)
  If BOTH algorithms use the SAME key material → VULNERABLE

=== ATTACK 3: Missing signature verification (decode without verify) ===

CRITICAL: Using jwt.decode() instead of jwt.verify() — decode() only base64-decodes the payload, it does NOT check the signature.

JavaScript:
  const payload = jwt.decode(token)  ← NO signature check
  import jwtDecode from 'jwt-decode'; const data = jwtDecode(token)  ← client-side library, no verification
  FLAG if result of jwt.decode() (not jwt.verify()) is used to make authorization decisions

Python:
  jwt.decode(token, options={"verify_signature": False})  ← explicitly disabled
  base64.b64decode(token.split('.')[1])  ← manual decode skipping verification

Java:
  Jwts.parser().parseClaimsJwt(token)  ← parses UNSIGNED JWTs (no signature)
  vs safe: Jwts.parser().setSigningKey(key).parseClaimsJws(token)  ← signed JWT

=== ATTACK 4: Weak HMAC secrets ===

If the HMAC secret is weak, the token can be brute-forced offline (tools like hashcat crack HS256 JWTs).

FLAG any JWT secret that is:
  const secret = "secret"
  const secret = "password"
  const secret = "changeme"
  const secret = "jwt_secret"
  const secret = "your-256-bit-secret"
  const secret = "supersecret"
  JWT_SECRET=secret in .env files
  Any secret shorter than 32 characters
  Any secret that is a common word, company name, or project name

=== ATTACK 5: JWT claims not validated ===

After successful verification, check that the code validates critical claims:
  exp (expiration): if not checked, expired tokens are still accepted
  iss (issuer): if not checked, tokens from other issuers are accepted
  aud (audience): if not checked, tokens meant for other services are accepted
  sub (subject): if not checked, user impersonation is possible

PATTERN (JavaScript):
  const decoded = jwt.verify(token, secret)
  if (decoded.isAdmin) { grantAccess() }  ← no exp/iss/aud check
  vs safe: jwt.verify(token, secret, { audience: 'myapp', issuer: 'auth.myapp.com' })

=== ATTACK 6: JWT in URL parameters ===

  GET /api/resource?token=eyJhbGci...
  Tokens in URL are logged in server access logs, browser history, referer headers
  FLAG: any route that accepts JWT via query parameter instead of Authorization header
```

## Validation Prompt

```
JWT vulnerability reported at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. Is this jwt.verify() (safe path) or jwt.decode() (no verification)? If verify(), are algorithms restricted?
2. Is the algorithm restricted to a specific list that excludes "none"?
3. If RS256 and HS256 are both accepted: do they use DIFFERENT keys, or the same key material?
4. Is the HMAC secret hardcoded? If so, how long is it and is it obviously guessable?
5. Are exp, iss, and aud claims validated after decode/verify?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- `jwt.decode()` used ONLY in browser-side JavaScript to read token contents for UI display (not to make authorization decisions) — not a security issue
- PyJWT >= 2.0 rejects the "none" algorithm by default even without explicit algorithm restriction — lower risk but still flag for clarity
- JWT libraries like `jose` (JavaScript) and `python-jose` with `joseJWTError` have strong defaults — verify the specific version's behavior
- Hardcoded JWT secrets in test files (`*.test.ts`, `*.spec.py`, test fixtures) — not production risk
- JWT stored in httpOnly cookies (not Authorization header, not localStorage) reduces XSS theft risk — note but do not flag as vulnerability
- `options.verify_signature = false` in PyJWT test setup with mock tokens — not production risk if in test file
