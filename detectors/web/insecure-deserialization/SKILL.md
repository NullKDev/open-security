---
id: insecure-deserialization
title: Insecure Deserialization
stages:
  - llm-scan
  - validate
severity: critical
description: Detects insecure deserialization where attacker-controlled serialized objects are deserialized, potentially allowing remote code execution or privilege escalation.
classical_prepass: bearer
classical_hint: ruby_lang_deserialization
---

# Insecure Deserialization Detector

## Detection Prompt

```
Analyze the following code for insecure deserialization vulnerabilities. Look for:
- Deserialization of untrusted data using language-native serialization formats (Java ObjectInputStream, Python pickle/marshal/shelve, Ruby Marshal, PHP unserialize, Node.js node-serialize)
- YAML parsers in unsafe mode that allow arbitrary object instantiation (js-yaml safeLoad vs load, PyYAML yaml.load without Loader)
- JSON.parse on untrusted input followed by prototype pollution (e.g., assigning to __proto__)
- XML deserialization with external entity resolution enabled (XXE)
- JWT libraries configured to accept 'none' algorithm or with weak key validation
- Cookie deserialization without integrity verification (HMAC)

For each finding, identify:
1. The deserialization function/library used
2. The source of the serialized data (network, cookie, file, queue)
3. Whether integrity checks (HMAC, signature) are applied before deserialization
4. Whether the deserialized type is constrained

Code context:
{code}
```

## Validation Prompt

```
A potential insecure deserialization vulnerability was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is the serialized data coming from an untrusted source (user input, external network)?
2. Is integrity verified (HMAC/signature) before deserialization?
3. Does the deserializer allow arbitrary type instantiation, or is it constrained to safe types?
4. Is the deserialized data used in a security-sensitive context (auth, execution)?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- JSON.parse on its own is safe — it does not instantiate arbitrary objects
- YAML safeLoad / yaml.safe_load restricts to primitive types and is safe
- Deserialization of data from your own trusted database is generally safe
- JWT with RS256/ES256 and proper public key pinning is not vulnerable to algorithm confusion
- Serialization used only for caching with server-side keys is lower risk
