---
id: weak-db-auth
title: Weak Database Authentication
stages: [llm-scan, validate]
severity: high
description: Detects weak or missing database authentication — empty passwords, default users (root/admin/sa), hardcoded credentials in connection strings, and overly permissive DB roles.
---

## Detection Prompt
Analyze DB configs for weak auth. Look for: password:"" or password:null, default users (root/admin/postgres/sa), GRANT ALL without restrictions, db_owner role assignments, MongoDB without auth enabled. Code: {code}

## Validation Prompt
Weak DB auth at {file}:{line}. Is this a local dev database? Is the password empty or default? Are permissions restricted? {snippet}

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics
- Local development databases (no external access)
- Password stored in environment variable/secrets manager
- Service accounts with least-privilege despite GRANT ALL phrasing
