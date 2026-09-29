---
id: secret-in-history
title: Secrets Committed to Git History
stages: [llm-scan, validate]
severity: critical
description: Detects credentials, API keys, tokens, and private keys committed to git history — even if later removed. Once committed, secrets are accessible via git log regardless of deletion.
classical_prepass: gitleaks
---

# Secrets in Git History

## Detection Prompt

You are a secrets forensics specialist. Secrets removed from the current working tree are STILL IN GIT HISTORY and therefore leaked. Use your available tools to run these commands in the repository root:

### Step 1: Scan git log for credential patterns
Run and analyze output:
- `git log --all -p -- "*.env" ".env.*" "*.pem" "*.key" "*.p12" "*.pfx" "*.jks" "*.keystore" 2>/dev/null | head -500`
- `git log --all -S "password" -S "secret" -S "api_key" -S "token" --oneline 2>/dev/null | head -100`

### Step 2: Look for high-entropy strings in git diff output
In `+` (added) lines of git log -p output, flag:
- AWS Access Key: starts with `AKIA` or `ASIA` + 16 alphanumeric chars
- GitHub token: `ghp_`, `gho_`, `ghs_`, `ghr_` + 36+ chars
- GitLab token: `glpat-` prefix
- Slack token: `xoxb-`, `xoxp-`, `xoxs-` prefixes
- Stripe live key: `sk_live_`, `pk_live_`
- Google API: `AIza` + 35 chars
- JWT secrets: high-entropy string after `JWT_SECRET=`, `SECRET_KEY=`, `APP_SECRET=`
- PEM blocks: `-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`, `-----BEGIN OPENSSH PRIVATE KEY-----`
- Database URLs with inline passwords: `postgres://user:PASSWORD@`, `mysql://user:PASSWORD@`, `mongodb://user:PASSWORD@`
- Twilio auth tokens: `SK` + 32 hex chars

### Step 3: Find deleted sensitive files
Run: `git log --all --diff-filter=D --name-only --format="" | grep -E "\.env$|secret|credential|password|private|\.key$" | sort -u`

Any deleted file matching sensitive patterns was committed — its content is in history.

### Step 4: Check .gitignore evolution
Run: `git log --all -p -- ".gitignore" | grep "^+" | grep -E "env|secret|cred|key|password" | head -30`

Patterns added to .gitignore that suggest a file was committed first, then hidden.

### Step 5: Check for stashed secrets
Run: `git stash list 2>/dev/null`
If stashes exist, run: `git stash show -p stash@{0} 2>/dev/null | head -100`

## Why This Is Always Critical
Secrets committed to git history:
1. Are immutable — force-push does not remove them from existing clones
2. Are replicated to all contributors, CI systems, and forks
3. May already be harvested by automated scanners monitoring public repos
4. Revoking and rotating leaked credentials is expensive and error-prone

## Validation Prompt

A potential secret was found in git history at commit {sha}, file {file}.

Evaluate:
1. Is the string a real credential or a placeholder (`YOUR_API_KEY`, `xxx`, `changeme`, `<SECRET>`)?
2. Is it a test/dev credential (e.g., Stripe `sk_test_`) — lower blast radius
3. What service does this credential belong to? What can an attacker do with it?
4. Is it still present in current HEAD (double exposure) or only in history?

Respond: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics

- `.env.example` with placeholder values like `YOUR_KEY_HERE` — not real secrets
- Test tokens in `*_test.go`, `*.spec.ts`, `*.test.py` — often fake, verify format
- Revoked tokens (Stripe `sk_test_`) — lower severity but still an indicator of poor hygiene
- Git-crypt or SOPS encrypted blobs — binary, not plaintext secrets
- Well-known public test keys (e.g., Stripe publishable test key) — already public
