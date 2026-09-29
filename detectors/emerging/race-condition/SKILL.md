---
id: race-condition
title: Race Condition / TOCTOU
stages: [llm-scan, validate]
severity: high
description: Detects Time-of-Check to Time-of-Use (TOCTOU) vulnerabilities — file ops, auth checks, and database read-then-write operations without proper locking or transactions.
---

# Race Condition / TOCTOU Detector

## Detection Prompt

```
Analyze code for race condition vulnerabilities. Look for:

1. File Operation TOCTOU:
   - fs.existsSync(path) then fs.readFileSync(path) or fs.unlinkSync(path)
   - File existence check before open/write (file could change between calls)
   - Symbolic link race: check isFile() then open() — symlink could change

2. Database Race Conditions:
   - SELECT query to check balance/count, then UPDATE without FOR UPDATE lock
   - Read-then-write without transaction or optimistic locking
   - Missing serializable isolation for critical operations
   - Coupon/promo code: check if valid, then mark used — race window

3. Auth / Permission TOCTOU:
   - Check user role, then perform action — role could change between
   - Token validation then resource access — token could be revoked
   - Rate limit check then operation — race between concurrent requests

Code context:
{code}
```

## Validation Prompt

```
Race condition at {file}:{line}. Is there a lock/transaction between check and use? Is the time window exploitable? Are concurrent requests possible?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Single-threaded applications without concurrent access
- File operations on temp files only accessible to current process
- Database operations with SELECT FOR UPDATE or SERIALIZABLE isolation
- Rate limiting at infrastructure level (API gateway, load balancer)
