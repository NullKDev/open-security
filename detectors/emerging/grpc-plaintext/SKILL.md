---
id: grpc-plaintext
title: gRPC Plaintext / Insecure Configuration
stages: [llm-scan, validate]
severity: critical
description: Detects gRPC services without TLS, with reflection enabled in production, missing authentication interceptors, and no message size limits.
classical_prepass: semgrep
---

# gRPC Plaintext Detector

## Detection Prompt

```
Analyze gRPC code for security misconfigurations. Look for:

1. Plaintext / No TLS:
   - grpc.WithInsecure() or grpc.Dial(addr, grpc.WithInsecure())
   - credentials.NewClientTLSFromCert missing
   - Insecure credentials in production server setup
   - grpc.NewServer() without TLS credentials

2. Reflection Enabled:
   - reflection.Register(s) in production code (exposes all service methods)
   - Server reflection without authentication
   - grpcui/grpcurl access possible without auth

3. Missing Security:
   - No UnaryServerInterceptor for authentication
   - No StreamServerInterceptor for auth
   - Missing MaxRecvMsgSize / MaxSendMsgSize (DoS via large messages)
   - No rate limiting on gRPC methods
   - No deadline/timeout enforcement

Code context:
{code}
```

## Validation Prompt

```
gRPC at {file}:{line}. Is TLS configured? Is reflection only for development? Are auth interceptors in place?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Development/localhost gRPC servers (intentionally plaintext)
- Reflection guarded by auth middleware or only enabled in dev
- Internal service mesh with mTLS at infrastructure level (Istio/Linkerd)
- Test code with WithInsecure() for unit testing
