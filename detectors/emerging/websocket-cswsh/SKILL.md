---
id: websocket-cswsh
title: WebSocket Security (CSWSH / Missing Validation)
stages: [llm-scan, validate]
severity: high
description: Detects WebSocket security issues — missing origin validation (Cross-Site WebSocket Hijacking), plain ws:// connections, missing authentication, and no rate limiting.
classical_prepass: semgrep
---

# WebSocket Security Detector

## Detection Prompt

```
Analyze WebSocket server code for security issues. Look for:

1. Missing Origin Validation (CSWSH — CWE-1385):
   - WebSocket server without verifyClient or checkOrigin
   - verifyClient callback returning true for all origins
   - No Origin header validation in WebSocket upgrade handler
   - ws (Node.js), Socket.IO, uWebSockets without origin check

2. Plain WebSocket (ws:// instead of wss://):
   - ws:// URLs in production code
   - WebSocket over HTTP instead of HTTPS
   - No TLS termination for WebSocket connections

3. Missing Authentication/Authorization:
   - WebSocket connections without token/cookie validation
   - Socket.IO without auth middleware
   - Per-message authorization missing (user can subscribe to any channel)
   - Broadcast to all clients without per-recipient auth

Code context:
{code}
```

## Validation Prompt

```
WebSocket issue at {file}:{line}. Is origin validation in place? Are connections authenticated? Are messages authorized per subscriber?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Internal WebSocket connections (backend-to-backend, no browser context)
- WebSocket behind reverse proxy that validates Origin header
- Server with explicit origin allowlist (not wildcard)
- Public WebSocket for real-time data that doesn't require auth (stock ticker, public chat)
