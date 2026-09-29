---
id: mobile-hardcoded-creds
title: Mobile Hardcoded Credentials
stages: [llm-scan, validate]
severity: critical
description: Detects hardcoded API keys, tokens, passwords, and cloud credentials in mobile app code — Android (SharedPreferences, source), iOS (UserDefaults, plist, source), Flutter, and React Native.
classical_prepass: gitleaks
---

# Mobile Hardcoded Credentials

## Detection Prompt

```
Analyze mobile app code for hardcoded credentials. Look for:

1. API Keys and Tokens in Source:
   - AWS keys (AKIA*, ASIA*), GCP keys, Azure keys in .java, .kt, .swift, .dart files
   - Third-party API keys (Stripe, Twilio, Firebase, Mapbox) hardcoded
   - OAuth client secrets in mobile source code
   - JWT signing secrets, HMAC keys in mobile apps

2. Insecure Local Storage:
   - SharedPreferences with MODE_WORLD_READABLE storing tokens
   - UserDefaults with sensitive data without encryption
   - SQLite databases without encryption for credentials
   - AsyncStorage (React Native) with plaintext secrets
   - NSUserDefaults / Keychain misuse (storing in plaintext when Keychain available)

3. Platform-Specific:
   - Android: strings.xml with API keys (extractable from APK)
   - iOS: Info.plist with hardcoded credentials
   - Flutter: Dart code with inline API keys
   - React Native: .env committed to bundle

Code context:
{code}
```

## Validation Prompt

```
A potential mobile hardcoded credential was reported at {file}:{line}.

Evaluate: Is it real credential or placeholder? Is it in production code or test? Would extraction from the app binary expose it?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Placeholder API keys in documentation or sample code
- Build configuration files that are gitignored
- Keys restricted to specific bundle IDs or SHA-256 fingerprints (already scoped)
- Debug/release config separation where debug has test keys (intentional)
