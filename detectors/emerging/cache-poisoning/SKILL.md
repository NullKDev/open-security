---
id: cache-poisoning
title: Cache Poisoning (Redis / Memcached)
stages: [llm-scan, validate]
severity: high
description: Detects cache poisoning vulnerabilities where user-controlled input reaches cache keys or values without sanitization — enabling stored XSS, data tampering, or cache-based DoS via Redis, Memcached, or CDN caches.
---

# Cache Poisoning Detector

## Detection Prompt

```
Analyze caching code for poisoning vulnerabilities. Look for:

1. User-Controlled Cache Keys:
   - redis.set(userInput, data) — attacker controls key, can overwrite other entries
   - memcached.set(userKey, value) — key collision with internal cache entries
   - Cache keys built from HTTP headers (X-Forwarded-Host, X-Forwarded-For)
   - User-controlled cache prefixes leading to key confusion

2. Unsafe Cache Values:
   - Storing user input in cache without sanitization (poisoned value served to others)
   - HTTP response caching with unvalidated headers (Host, User-Agent in cache key)
   - CDN caching based on flawed cache keys (missing vary header)

3. Unvalidated Deserialization from Cache:
   - Cached objects deserialized without validation
   - JSON.parse of cache values that could be poisoned
   - Redis/other cache used as message queue with untrusted data

Code context:
{code}
```

## Validation Prompt

```
Cache poisoning at {file}:{line}. Is the cache key user-controlled? Is the cached value sanitized before serving? Are cache keys namespaced/prefixed?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Cache keys with static prefix and validated suffix (e.g., "session:${validatedUserId}")
- CDN with proper Vary headers and cache key configuration
- Cache used only for computed values (not user input)
- Redis with ACL restricting key patterns
