---
id: hardcoded-cloud-creds
title: Hardcoded Cloud Credentials
stages:
  - llm-scan
  - validate
severity: critical
description: Detects hardcoded cloud service credentials in source code — AWS access keys, GCP service account keys, Azure connection strings, DigitalOcean tokens, and other cloud provider secrets committed to repositories.
classical_prepass: gitleaks
classical_hint: ""
---

# Hardcoded Cloud Credentials Detector

## Detection Prompt

```
Analyze the following code for hardcoded cloud service credentials. Look for:

1. AWS Credentials:
   - Access Key IDs (AKIA*, ASIA* patterns)
   - Secret access keys in config files, source code, env examples
   - aws_access_key_id / aws_secret_access_key in code
   - Session tokens hardcoded

2. GCP Credentials:
   - Service account JSON key files committed to repo
   - private_key fields in JSON configs
   - GOOGLE_APPLICATION_CREDENTIALS pointing to committed files
   - gcloud auth print-access-token in scripts

3. Azure Credentials:
   - Connection strings with AccountKey= in code
   - DefaultEndpointsProtocol with credentials
   - AZURE_STORAGE_KEY / AZURE_CLIENT_SECRET in source

4. Other Cloud Providers:
   - DigitalOcean tokens (dop_v1_*)
   - Cloudflare API tokens
   - Vercel tokens, Netlify tokens, Heroku API keys
   - Terraform Cloud tokens

5. Insecure Storage Patterns:
   - .env.example files with real credentials
   - Config files with inline secrets
   - CI/CD variables hardcoded in workflow files
   - Dockerfiles with ARG/ENV exposing credentials

For each finding, identify the credential type, the service it belongs to, and whether it appears to be a real key or a placeholder.

Code context:
{code}
```

## Validation Prompt

```
A potential hardcoded cloud credential was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is this an actual credential (matches known key patterns like AKIA*, dop_v1_*, etc.)?
2. Is this a placeholder/example value or a real working key?
3. Is the file in a public repository location or gitignored but committed?
4. Is the credential active (not revoked, expired, or from a deleted service)?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives:
- Placeholder values in documentation (AKIAIOSFODNN7EXAMPLE — AWS's official example key)
- Base64-encoded strings that look like secret keys but are actually encoded data
- Environment variable names without actual values (AWS_ACCESS_KEY_ID=)
- Test fixtures with intentionally fake credentials
- Already-revoked keys in historical commits (gitleaks should catch these)
