---
id: android-security
title: Android Deep Security Audit
stages: [llm-scan, validate]
severity: high
description: Deep Android security audit — Kotlin/Java source, Gradle configs, AndroidManifest, ProGuard, SSL pinning, root detection bypass, exported components, Frida attack surface.
classical_prepass: gitleaks
---

# Android Security — Specialist Audit

## Detection Prompt

You are an Android security specialist performing an adversarial review. You MUST open and read the actual files — do not guess from filenames.

### 1. AndroidManifest.xml — Read it first
Open `AndroidManifest.xml` (or `app/src/main/AndroidManifest.xml`). Check:
- `android:exported="true"` on Activities, Services, BroadcastReceivers, ContentProviders without proper permission enforcement
- `android:debuggable="true"` — must NOT appear in release builds
- `android:allowBackup="true"` — exposes app data via `adb backup`
- `android:usesCleartextTraffic="true"` — allows plaintext HTTP (critical)
- Missing `<network-security-config>` reference when cleartext might be needed
- Implicit intents handled without input validation
- `android:sharedUserId` — privilege sharing between apps
- `<provider>` with `android:grantUriPermissions="true"` and weak path permissions
- `android:taskAffinity` + `android:launchMode` combinations enabling task hijacking

### 2. Gradle Build Files — Open build.gradle and build.gradle.kts
- `minifyEnabled false` in release build config — no ProGuard/R8, code easily reversible
- `debuggable true` in release buildType
- Hardcoded API keys, signing credentials, keystore passwords in gradle files
- `buildConfigField` with secrets that end up in the APK's BuildConfig class
- `repositories { maven { url "http://..." } }` — non-HTTPS repository (MitM supply chain)
- Dependency versions like `implementation 'com.example:lib:+'` — unpinned, hijackable
- Signing config with `storePassword` and `keyPassword` hardcoded (not from env)
- `android.testOptions.unitTests.includeAndroidResources` — test data leaking to prod

### 3. Hardcoded Secrets in Source (Kotlin/Java/XML)
Look in `.kt`, `.java`, and `res/values/*.xml`:
- `val API_KEY = "..."` or `private static final String SECRET = "..."`
- `strings.xml` with keys like `google_maps_key`, `firebase_api_key`, `stripe_key`
- Firebase config hardcoded instead of using `google-services.json` properly
- AWS/GCP/Azure keys inline in source
- OAuth `client_secret` in mobile code (should only be in backend)
- Private keys or certificates embedded as string literals

### 4. Insecure Data Storage
- `getSharedPreferences(..., MODE_WORLD_READABLE)` — readable by other apps
- SQLite database without `SQLCipherDatabase` encryption for sensitive data
- Sensitive data written to `getExternalStorageDirectory()` — world-readable
- `File(Environment.getExternalStorageDirectory(), ...)` for PII or tokens
- `Log.d/v/i` statements printing credentials, tokens, or PII (check all Log.* calls)
- `editor.putString("token", ...)` in SharedPreferences without EncryptedSharedPreferences

### 5. Network Security
- `HttpURLConnection` or OkHttp without certificate pinning for sensitive endpoints
- `SSLSocketFactory` implementations that accept all certificates (`X509TrustManager` that does nothing)
- `onReceivedSslError` in `WebViewClient` calling `handler.proceed()` — bypasses SSL
- Custom `HostnameVerifier` that returns `true` always
- Retrofit/OkHttp client built with `.hostnameVerifier { _, _ -> true }`
- Plain HTTP URLs for API calls

### 6. WebView Security
- `webView.settings.javaScriptEnabled = true` with `addJavascriptInterface` — JS bridge attack
- `webView.settings.allowFileAccess = true` or `allowFileAccessFromFileURLs = true`
- `webView.loadUrl(intent.getStringExtra("url"))` — arbitrary URL load from intent
- Missing `webView.settings.setSavePassword(false)`
- `WebChromeClient` overrides that expose sensitive data

### 7. Root Detection and Anti-Tampering
- Check if root detection exists: search for `RootBeer`, `SafetyNet`, `Play Integrity API`, or manual checks
- If root detection is found: evaluate if it's bypassable (checking `su` binary existence is trivially bypassed by Frida/Magisk)
- No certificate pinning = full Frida/mitmproxy interception possible
- Missing `PREVENT_SCREENSHOT` flag for screens showing sensitive data
- Missing integrity checks on critical business logic

### 8. Intent and IPC Vulnerabilities
- `startActivity(Intent(action))` or `sendBroadcast` with user-controlled data without validation
- `PendingIntent` with implicit intent — hijackable by malicious apps
- `ContentProvider.query()` accepting raw SQL-like projection/selection arguments
- Deep link handling (`scheme://host/path`) without validation of the incoming URI data
- `onActivityResult` processing untrusted data from unverified sources

### 9. Cryptography
- `AES/ECB` mode — deterministic, vulnerable to pattern attacks
- `MD5` or `SHA1` for password hashing — too weak
- Hardcoded IV or salt (`val IV = ByteArray(16)` all zeros)
- `Random()` instead of `SecureRandom()` for cryptographic operations
- `KeyStore` not used — keys stored in SharedPreferences or files
- RSA without padding (`RSA/None/NoPadding`)

### 10. Kotlin/Java Language-Specific
- Kotlin `!!` operator on values from external sources without null check (NPE as DoS)
- Deserialization via `ObjectInputStream` on network data — RCE risk (Java)
- `Runtime.exec()` or `ProcessBuilder` with user-controlled arguments — command injection
- SQL queries built with string concatenation instead of prepared statements (SQLite)
- `Serializable` classes with sensitive fields that serialize to intent extras

## Validation Prompt

A potential Android security finding was reported at {file}:{line}.

Evaluate:
1. Is this in production/release code or test/debug only?
2. What is the actual exploitability? (attacker needs physical access? root? MitM?)
3. Would this finding survive ProGuard/R8 obfuscation and still be exploitable?
4. Is there any compensating control (e.g., SafetyNet check, certificate pinning at another layer)?

Respond: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics

- `debuggable true` in debug buildType only (not release) — safe
- Test credentials in `androidTest/` or `test/` source sets — expected
- `allowCleartext` in `network_security_config.xml` scoped only to localhost — acceptable for dev
- `MODE_WORLD_READABLE` removed in API 17+ (always use ContextCompat)
- Rooting checks in security libraries (RootBeer) are known to be bypassable — flag as medium, not critical
