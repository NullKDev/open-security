---
id: db-unencrypted-connection
title: Unencrypted Database Connection
stages: [llm-scan, validate]
severity: high
description: Detects database connections configured without TLS/SSL encryption — connection strings with ssl=false, sslmode=disable, or missing TLS configuration exposing data in transit.
---

# Unencrypted DB Connection

## Detection Prompt

```
Analyze database connection configurations for missing TLS/SSL. Look for:

1. PostgreSQL: sslmode=disable, ssl=false, ?sslmode=disable in connection strings
2. MySQL: useSSL=false, requireSSL=false, ssl-mode=DISABLED
3. MongoDB: tls=false, ssl=false, ?tls=false, tlsAllowInvalidCertificates
4. Redis: tls: false in config, rediss:// not used (plain redis://)
5. Generic: DATABASE_URL without ?sslmode=require or ssl=true

Code context:
{code}
```

## Validation Prompt

```
Unencrypted DB at {file}:{line}. Is this localhost/development? Is the DB in the same VPC/private network? Is TLS disabled explicitly or just not configured?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Local development databases (localhost, 127.0.0.1)
- DBs in private VPC with no internet access
- Connection strings for test databases
- TLS terminated at the proxy/load balancer level
