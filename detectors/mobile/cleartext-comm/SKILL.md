---
id: mobile-cleartext-comm
title: Mobile Cleartext Communication
stages: [llm-scan, validate]
severity: high
description: Detects cleartext HTTP traffic in mobile apps — missing HTTPS enforcement, disabled ATS (iOS), cleartext traffic allowed (Android), and missing certificate pinning.
classical_prepass: semgrep
---

# Mobile Cleartext Communication

## Detection Prompt

```
Analyze mobile app network configuration for cleartext communication. Look for:

1. HTTP instead of HTTPS:
   - HTTP URLs in API calls (http:// in URL strings, Retrofit base URLs, Alamofire endpoints)
   - http:// in Android network_security_config.xml without proper pinning
   - NSAllowsArbitraryLoads = true in iOS Info.plist (disables ATS)
   - NSExceptionDomains allowing HTTP for specific domains

2. Missing Certificate Pinning:
   - No certificate pinning or public key pinning implemented
   - TrustKit (iOS) not configured
   - OkHttp CertificatePinner (Android) not used
   - Missing SSL pinning in React Native (react-native-ssl-pinning)

3. WebView Insecure Settings:
   - WebView with onReceivedSslError ignoring certificate errors
   - Android WebView with mixed content allowed (setMixedContentMode)
   - WKWebView without proper navigation delegate for SSL handling

Code context:
{code}
```

## Validation Prompt

```
Potential cleartext communication at {file}:{line}. Is this production code or development-only? Is there certificate pinning elsewhere? Is ATS/network security config properly configured?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- HTTP for localhost/dev server (10.0.2.2 for Android emulator) — development only
- NSAppTransportSecurity exceptions for specific non-sensitive domains (analytics, crash reporting)
- Debug builds with separate network config from release
- Proxy configurations for testing
