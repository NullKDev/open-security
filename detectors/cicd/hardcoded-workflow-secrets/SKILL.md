---
id: hardcoded-workflow-secrets
title: Hardcoded Tokens in CI/CD Workflows
stages:
  - llm-scan
  - validate
severity: critical
description: Detects hardcoded API keys, tokens, and passwords in CI/CD configuration files — GitHub Actions, GitLab CI, Jenkinsfile, CircleCI, and other pipeline definitions.
classical_prepass: gitleaks
classical_hint: ""
---

# Hardcoded CI/CD Secrets Detector

## Detection Prompt

```
Analyze CI/CD configuration files for hardcoded secrets and tokens. Look for:

1. Hardcoded API Keys / Tokens in Workflows:
   - NPM_TOKEN, PYPI_TOKEN, DOCKER_TOKEN set inline in workflow YAML
   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in steps
   - GITHUB_TOKEN copied to environment variables (excessive permissions)
   - Personal Access Tokens (PATs) in workflow: ghp_*, github_pat_*

2. Insecure Secret Handling:
   - secrets: inherit used without restriction on called workflows
   - Environment variables with secret values in workflow definition (not using ${{ secrets.* }})
   - .env files created in workflow with real credentials
   - Base64-encoded credentials in workflow scripts

3. Excessive Permissions:
   - permissions: write-all at workflow level
   - GITHUB_TOKEN with contents: write, packages: write, id-token: write
   - Self-hosted runner labels allowing untrusted workflow execution
   - OIDC subject claims without repo/branch restrictions

4. Pipeline Scripts with Credentials:
   - echo $SECRET | docker login (secret visible in logs)
   - curl -H "Authorization: Bearer $TOKEN" (token in command line)
   - SSH keys generated inline in workflow steps

For each finding, identify the type of secret, where it's exposed, and the risk level.

Code context:
{code}
```

## Validation Prompt

```
A potential hardcoded CI/CD secret was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is this an actual secret (matches known token patterns) or a variable reference?
2. Is the secret in a public repository workflow that could be read by anyone?
3. Is it a ${{ secrets.* }} reference (secure) or an inline value (insecure)?
4. Would exposure allow pushing packages, accessing infrastructure, or compromising the pipeline?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives:
- ${{ secrets.NPM_TOKEN }} — this is a secure reference, not a hardcoded value
- Placeholder tokens in documentation workflows (your-token-here, changeme)
- Encrypted secrets (git-crypt, sops, sealed-secrets) in repo
- Workflow dispatch inputs with default placeholder values
- OIDC role ARNs (not secrets — they identify a role, not authenticate)
