---
id: env-file-committed
title: Env / Secret Files Committed to Repository
stages:
  - llm-scan
  - validate
severity: critical
description: Detects sensitive environment and configuration files committed to git repositories — .env, credentials.json, service-account keys, SSH private keys, and other secret-bearing files.
classical_prepass: gitleaks
classical_hint: ""
---

# Committed Secret Files Detector

## Detection Prompt

```
Analyze the repository for sensitive files that should never be committed. Look for:

1. Environment Files:
   - .env, .env.local, .env.production, .env.development
   - env.yml, env.yaml, environment.ts with secrets
   - .env.example files that contain real values (not placeholders)
   - appsettings.json, app.config with connection strings and keys

2. Credential / Key Files:
   - service-account.json, credentials.json, google-credentials.json
   - *.pem, *.key, *.p12, *.pfx (private keys, certificates with keys)
   - id_rsa, id_ed25519, ssh keys
   - aws/credentials, .aws/config with real keys
   - .npmrc files with _authToken

3. Database / Service Configs:
   - database.yml, database.json with hardcoded passwords
   - config/database.yml in Rails apps
   - wp-config.php with DB credentials (WordPress)
   - .my.cnf, pgpass files

4. Cloud / Infrastructure:
   - terraform.tfvars with real credentials
   - .terraform/ with state files containing secrets
   - kubeconfig files with embedded tokens
   - docker-compose.override.yml with secrets

For each finding, identify the file type, what secrets it likely contains, and the risk.

Code context:
{code}
```

## Validation Prompt

```
A potentially sensitive committed file was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Does the file contain actual credentials/secrets or only placeholder values?
2. Is the file gitignored but was accidentally committed before the gitignore was added?
3. Are the credentials in the file still active (not revoked or expired)?
4. Is this a public repository where anyone can access the committed file?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives:
- .env.example with placeholder values (intentionally committed as documentation)
- Terraform .tfvars with dev/test values (no production secrets)
- Empty credential files (.npmrc with registry URL only, no token)
- Public key files (.pub) — safe to commit
- Configuration templates with VARIABLE_NAME=changeme patterns
