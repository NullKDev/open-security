---
id: oauth-misconfig
title: OAuth 2.0 / OIDC Misconfiguration
stages: [llm-scan, validate]
severity: critical
description: Detects OAuth 2.0 and OIDC misconfigurations — redirect_uri bypass, missing PKCE enforcement, implicit flow usage, client_secret in frontend code, missing state/nonce parameters, and token leakage patterns.
classical_prepass: semgrep
---

# OAuth / OIDC Misconfig Detector

## Detection Prompt

```
You are hunting for OAuth 2.0 and OpenID Connect (OIDC) misconfigurations. These can lead to account takeover via authorization code interception, CSRF, or client_secret exposure.

STEP 1 — Find all OAuth/OIDC code. Search for files matching:
  *oauth*, *auth0*, *cognito*, *okta*, *keycloak*, *passport*, *oidc*, *openid*
  Files importing: passport-oauth2, @auth0/auth0-spa-js, openid-client, next-auth, authlib, django-allauth, spring-security-oauth2, golang.org/x/oauth2

Open configuration files: .env, config.ts, auth.config.ts, next.config.ts, settings.py, application.properties

STEP 2 — Check redirect_uri validation:

On the AUTHORIZATION SERVER SIDE (or if you control the OAuth server):
  VULNERABLE: redirect_uri validated with startsWith:
    if (redirectUri.startsWith('https://myapp.com/')) { allow }
    → Attacker uses: redirect_uri=https://myapp.com.evil.com/ (startsWith matches!)

  VULNERABLE: validated with includes or contains:
    if (redirectUri.includes('myapp.com')) { allow }
    → Attacker uses: redirect_uri=https://evil.com/?q=myapp.com

  VULNERABLE: regex without anchors:
    /myapp\.com/.test(redirectUri)
    → Attacker uses: redirect_uri=https://evil.com/?myapp.com

  SAFE: exact string comparison only:
    redirectUri === 'https://myapp.com/callback'

On the CLIENT SIDE — open redirect after OAuth:
  After OAuth completes, is there a `?next=` or `?redirect=` parameter that redirects the authenticated user?
  PATTERN: res.redirect(req.query.next)  ← open redirect usable post-auth
  PATTERN: window.location.href = new URLSearchParams(window.location.search).get('returnTo')

STEP 3 — Check for PKCE enforcement (MANDATORY for public clients):

What is a "public client"? SPAs (React, Vue, Angular), mobile apps, CLI tools, desktop apps — any client that CANNOT safely store a client_secret.

VULNERABLE (public client without PKCE):
  In SPA/mobile OAuth request: no code_challenge parameter in authorization URL
  Back-end that accepts authorization codes WITHOUT verifying code_verifier
  Server that does NOT enforce code_challenge_method=S256

VULNERABLE: PKCE with plain (not S256):
  code_challenge_method=plain  ← code_challenge IS the code_verifier (no hashing — interceptable)
  MUST be: code_challenge_method=S256 (SHA-256 hash of code_verifier)

Check if the server-side token endpoint enforces code_verifier:
  Python (authlib): require_pkce=True in authorization server config
  JavaScript (node-oidc-provider): pkce: { required: true }
  Spring: .requireProofKey(true) in security config

STEP 4 — Check for deprecated/insecure flows:

Implicit flow (response_type=token):
  VULNERABLE: response_type=token — returns access_token in URL fragment (visible in logs, referer headers)
  VULNERABLE: response_type=id_token token — hybrid flow without PKCE
  SAFE: response_type=code — authorization code flow

Resource Owner Password Credentials (ROPC):
  grant_type=password in any OAuth request → FLAG (deprecated in OAuth 2.1)
  This flow sends username/password directly to the OAuth client — defeats purpose of OAuth

STEP 5 — Check state parameter and CSRF protection:

VULNERABLE: OAuth authorization URL built without `state` parameter:
  https://provider.com/oauth/authorize?client_id=...&redirect_uri=...&response_type=code
  Missing: &state=<random_token>

VULNERABLE: state parameter present but NOT validated on callback:
  Backend receives ?code=...&state=... but never checks that state matches what was sent
  PATTERN in callback handler: no state validation before exchanging code for token

VULNERABLE: Nonce missing in OIDC:
  OIDC id_token should include nonce claim
  Client should include nonce in auth request and verify it in the returned id_token
  Missing nonce enables replay attacks with stolen id_tokens

STEP 6 — Check for client_secret exposure:

client_secret in FRONTEND code:
  CRITICAL: Any JavaScript file (browser-side) containing: client_secret, clientSecret, CLIENT_SECRET
  CRITICAL: Any React/Vue/Angular component or util file with a client_secret value
  In Next.js: client_secret in /app or /pages (non-api route) → exposed in browser bundle

client_secret in mobile app:
  CRITICAL: client_secret in React Native *.tsx, Flutter *.dart, Android *.kt, iOS *.swift
  Mobile apps are reverse-engineerable — client_secret is not safe in any mobile app code

Environment variable exposure:
  NEXT_PUBLIC_CLIENT_SECRET in Next.js (NEXT_PUBLIC_ prefix exposes to browser)
  VUE_APP_CLIENT_SECRET in Vue.js (Vue CLI exposes VUE_APP_ to browser)
  REACT_APP_CLIENT_SECRET in Create React App (exposes REACT_APP_ to browser)
```

## Validation Prompt

```
OAuth misconfiguration at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. Is this a public client (SPA, mobile) or confidential client (server-side)? This determines if PKCE is required and if client_secret is safe.
2. For redirect_uri: is validation done by exact string match, startsWith, includes, or regex? Can it be bypassed?
3. Is the state parameter generated per-request and validated in the callback?
4. Is client_secret present in browser-accessible JavaScript, a mobile app, or a NEXT_PUBLIC_/VUE_APP_/REACT_APP_ env var?
5. Is the flow response_type=code (safe) or response_type=token (deprecated implicit flow)?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Server-side (confidential) clients where client_secret lives only in environment variables and server-side code — NOT exposed to browser — safe
- PKCE is NOT required for confidential server-side clients (though still recommended)
- `redirect_uri: 'postmessage'` is a valid pattern for Google OAuth with postMessage (not a real URI — handled by Google's library)
- Native apps using Claimed HTTPS scheme redirects (AppAuth pattern) — state and PKCE are handled by the AppAuth library
- B2B machine-to-machine flows using client_credentials grant — no user, no PKCE, no state needed — by design
- next-auth, Auth.js, passport.js: these libraries handle state/PKCE internally — check if they're properly configured rather than reimplemented
