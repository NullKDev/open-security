---
id: crypto-misuse
title: Cryptographic Misuse
stages:
  - llm-scan
  - validate
severity: high
description: Detects cryptographic misuse — weak algorithms for security-sensitive operations, hardcoded keys/IVs, ECB mode, non-CSPRNG for secrets, and incorrect password hashing.
classical_prepass: bearer
classical_hint: javascript_lang_weak_crypto
---

# Cryptographic Misuse Detector

## Detection Prompt

```
You are hunting for cryptographic misuse. The rule: weak crypto ONLY matters in security-sensitive contexts (authentication, authorization, session tokens, data confidentiality, integrity checking). Crypto used for checksums, ETags, or cache keys is acceptable even if "weak".

STEP 1 — Find all cryptographic operations. Open files matching: *crypto*, *hash*, *encrypt*, *cipher*, *token*, *password*, *auth*, *sign*

STEP 2 — Categorize each crypto operation by its purpose, then apply the rules below:

=== PASSWORD HASHING ===
The ONLY acceptable password hashing functions are: bcrypt, scrypt, argon2 (argon2id preferred), PBKDF2 (with high iteration count).

Flag IMMEDIATELY:
  JavaScript: crypto.createHash('md5').update(password).digest('hex')
  JavaScript: crypto.createHash('sha256').update(password + salt).digest('hex') ← SHA-256 is too fast for passwords
  Python: hashlib.md5(password.encode()).hexdigest()
  Python: hashlib.sha256(password.encode()).hexdigest()
  PHP: md5($password), sha1($password), sha256($password)
  Java: MessageDigest.getInstance("MD5").digest(password.getBytes())
  Any: password hashed with SHA-family without bcrypt/scrypt/argon2

Safe patterns:
  JavaScript: bcrypt.hash(password, 12), argon2.hash(password)
  Python: bcrypt.hashpw(password, bcrypt.gensalt(rounds=12)), argon2.hash(password)
  PHP: password_hash($password, PASSWORD_ARGON2ID), password_hash($password, PASSWORD_BCRYPT)
  Java: BCrypt.hashpw(password, BCrypt.gensalt(12))

=== SYMMETRIC ENCRYPTION ===
Flag: DES, 3DES/TripleDES, RC4, RC2, Blowfish (legacy), AES-ECB mode

JavaScript (Node crypto):
  crypto.createCipheriv('des', ...) ← DES - insecure
  crypto.createCipheriv('aes-128-ecb', ...) ← ECB mode - insecure (no IV, patterns leak)
  crypto.createCipher('aes256', key) ← old API, derives IV from key - insecure

Python:
  DES.new(key, DES.MODE_ECB)
  AES.new(key, AES.MODE_ECB) ← ECB mode
  Cipher("DES", backend=default_backend())

Java:
  Cipher.getInstance("DES"), Cipher.getInstance("DESede")
  Cipher.getInstance("AES") — without specifying mode defaults to ECB in Java: VULNERABLE
  Cipher.getInstance("AES/ECB/PKCS5Padding")

=== HARDCODED KEYS AND IVs ===
Flag any encryption key that appears as a literal string or byte array in source code:
  const key = "mysecretkey12345"  ← hardcoded
  key = b"1234567890abcdef"  ← hardcoded
  private static final byte[] KEY = "hardcodedkey1234".getBytes()  ← hardcoded
  const iv = Buffer.from("0000000000000000", 'hex')  ← static IV — dangerous for CBC/CTR/GCM
  iv = b'\x00' * 16  ← zero IV — patterns leak in CBC, stream cipher reuse in CTR/GCM

=== RANDOM NUMBER GENERATION FOR SECURITY ===
Flag when insecure RNG is used for: tokens, session IDs, password reset codes, nonces, salts, OTPs, API keys

  JavaScript: Math.random() for any security purpose — NOT cryptographically secure
  Python: random.random(), random.randint(), random.choice() for security tokens
  Java: java.util.Random() for security — use java.security.SecureRandom
  PHP: rand(), mt_rand() for tokens — use random_bytes()

Safe: crypto.randomBytes(), crypto.getRandomValues(), secrets.token_bytes(), SecureRandom, random_bytes()

=== WEAK HASH ALGORITHMS IN INTEGRITY/SIGNING ===
Flag when MD5 or SHA-1 is used for: HMAC, digital signatures, certificate fingerprinting (production), code signing
  MD5-based HMAC: crypto.createHmac('md5', secret) ← weak
  SHA-1 for code signing or security tokens

ACCEPTABLE: MD5/SHA-1 for cache keys, ETags, content fingerprinting (NOT security-sensitive)

=== RSA KEY SIZE ===
  RSA < 2048 bits: insecure
  RSA 2048 bits: acceptable (NIST allows until 2030)
  RSA 4096 bits: recommended
  Look for: generateKeyPair('rsa', { modulusLength: 1024 }) ← insecure
```

## Validation Prompt

```
A potential cryptographic misuse was reported at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. What is the PURPOSE of this cryptographic operation? (password storage, data encryption, integrity check, cache key, token generation?)
2. Is the purpose security-sensitive — would an attacker gain access to accounts or data if this is broken?
3. For password hashing: is bcrypt/argon2/scrypt used, or a general-purpose hash?
4. For symmetric encryption: is ECB mode used? Is the key/IV hardcoded?
5. For RNG: is crypto.randomBytes() / secrets.token_bytes() used, or Math.random() / random.random()?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- MD5 or SHA-1 used for cache-busting, ETag generation, or URL-safe content fingerprinting (not for auth, not a secret) — NOT a vulnerability
- bcrypt with cost factor ≥ 10 is safe (default is 10-12 in most libraries)
- `crypto.getRandomValues()` in browsers and `crypto.randomBytes()` in Node.js are CSPRNG — safe
- Test fixtures with hardcoded keys (`const TEST_KEY = "abc123"` in `*.test.ts`) are not production risks
- AES-GCM with a random 96-bit nonce generated per encryption is secure, even if the nonce generation looks like: `crypto.randomBytes(12)` — that IS correct
- Encrypted data at rest with KMS-managed keys (AWS KMS, GCP KMS) is acceptable regardless of local key handling
