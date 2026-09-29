---
id: suspicious-commit
title: Suspicious Commit & Git History Analysis
stages: [llm-scan, validate]
severity: medium
description: Analyzes git history for security-relevant patterns — secrets committed and removed, suspicious authors, large hidden diffs, obfuscated commit messages, timezone anomalies, and signs of repository tampering.
---

# Suspicious Commit & Git History Analysis

## Detection Prompt

You are a forensic git analyst. Use your tools to run git commands and read git metadata. Do NOT skip this domain — git history is a critical attack vector.

### Step 1: Run git log to inspect commits
Execute: `git log --oneline --all --since="1 year ago"` in the target repository.
If git is available, also run:
- `git log --all --format="%H %ae %an %aI %s" | head -200`
- `git log --all --diff-filter=D --summary | grep -i "secret\|password\|token\|key\|cred"` (deleted files with sensitive names)

### What to look for in commit messages:
Flag any commit whose message matches these patterns:
- `fix typo`, `typo fix` — commonly used to hide real changes
- `remove cred`, `remove secret`, `remove password`, `remove key`, `remove token` — indicates secrets were committed
- `oops`, `whoops`, `accident`, `mistake` — casual commits hiding sensitive changes
- `temp`, `temporary`, `wip`, `work in progress`, `draft` — uncommitted work left in history
- `debug`, `debugging`, `console.log`, `print secret` — debug artifacts
- `test`, `testing` combined with short diff — may contain test credentials
- `revert` — check what was reverted and why
- Messages under 5 characters — likely hiding content

### Step 2: Check for secrets removed from history
Run: `git log --all -p --follow -- "*.env" "*.pem" "*.key" "*.p12" "*.pfx" "*.jks" "config.json" "secrets.*" 2>/dev/null | head -500`

Also run: `git show HEAD~1:some-file` if you suspect a file previously contained secrets.

Look for:
- Files deleted in a commit shortly after being added
- Lines with patterns like `SECRET=`, `API_KEY=`, `PASSWORD=`, `TOKEN=`, `PRIVATE_KEY` that appear in `+` (added) lines of old commits, then removed
- `.env` files that existed and were later added to `.gitignore`

### Step 3: Suspicious author metadata
From git log output, flag:
- Commits authored from email domains that differ from the project's team (e.g., `@gmail.com` in a corporate repo)
- Multiple authors with identical commit timestamps (automated/spoofed)
- Commits with timezone offset outside -12:00 to +14:00
- Author name differs from committer name on important commits
- New contributor making their first commit to security-critical files (auth, payment, crypto)
- `noreply@github.com` on direct pushes to main/master

### Step 4: Large diff anomalies
From git log, find commits with many changed lines:
`git log --all --shortstat | grep -E "[0-9]{4,} insertion"` (4+ digit insertions)

Flag commits with:
- 5,000+ line insertions where the commit message is short/vague (hides malicious code in noise)
- Binary file additions (`.so`, `.dll`, `.dylib`, `.wasm`) — precompiled code, hard to review
- Commits adding minified JavaScript without corresponding source
- Commits adding dependency lockfiles with thousands of changes but simple message like "update deps"

### Step 5: Check .gitignore for suspicious patterns
Read `.gitignore`. Flag if it ignores:
- Files that should be tracked (e.g., ignoring security config files)
- Patterns added recently that seem to hide credentials: `*.env`, `secrets/`, `credentials/`
- Build outputs being committed while source is ignored (inverted pattern)

### Step 6: Check for .git/hooks
Read `.git/hooks/` directory listings. Malicious hooks can:
- `pre-commit`: exfiltrate code before each commit
- `post-merge`: execute code after pull
- `prepare-commit-msg`: modify commits silently

If any hooks exist that are non-standard (not just linting/formatting), flag them.

### Step 7: Tag and release anomalies
`git tag -l | head -50`
- Tags pointing to commits not on the main branch (orphan releases)
- Release tags with associated binaries (check GitHub releases section if accessible)
- Tags added long after the commit date

## Validation Prompt

A suspicious git commit was found: SHA {sha}, message: {message}, author: {author}.

Evaluate:
1. Does the commit diff (if accessible) show credential removal, suspicious code, or hidden changes?
2. Is the author a known contributor or an anomaly?
3. Could this be a legitimate commit (release automation, dependency update bot)?
4. What is the realistic impact if this commit introduced or removed something malicious?

Respond: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics

- Dependabot/Renovate commits removing/updating lockfiles — expected large diffs
- GitHub Actions bot commits (`github-actions[bot]`) — automated, not suspicious
- "fix typo" commits by core maintainers with verified GPG signatures — lower risk
- Large initial commit — common, investigate only if it contains binary blobs
- .env.example (not .env) — template file, expected
