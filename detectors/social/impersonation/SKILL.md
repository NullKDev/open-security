---
id: git-impersonation
title: Git Impersonation / Fake Authorship
stages: [llm-scan, validate]
severity: medium
description: Detects git commit impersonation — author email spoofing known identities, suspicious Co-authored-by trailers on sensitive commits, missing GPG signatures on release tags, and backdoor-style commits hiding behind trusted author names.
---

# Git Impersonation / Fake Authorship Detector

## Detection Prompt

```
You are hunting for git commit impersonation — an attacker who has write access or submits a PR may forge author metadata to make malicious commits appear to come from a trusted team member, bypassing code review suspicion.

STEP 1 — Open git history files if available:
  .git/logs/HEAD — contains recent commit graph
  CHANGELOG.md, CHANGES.rst — may list contributors
  Look for recent commits in the file tree context

STEP 2 — Analyze commit metadata for these specific patterns:

1. Email domain mismatch / homoglyph spoofing:
   Legitimate team uses @company.com — suspicious commits use @company.co, @cornpany.com, @c0mpany.com
   Author name matches a known person but email is @gmail.com / @yahoo.com / @protonmail.com while all other team commits use corporate email
   Unicode lookalike characters in author name: "Аlex Smith" (Cyrillic А) vs "Alex Smith" (Latin A)

2. Forged Co-authored-by trailers:
   Look for commits where Co-authored-by: includes names of known project leads or security reviewers but the primary commit author is unknown
   Pattern: A low-reputation or new contributor adds Co-authored-by: Linus Torvalds <torvalds@linux-foundation.org> to make it look approved
   Co-authored-by: combined with no other commits from that co-author in history

3. Suspicious author/committer split:
   Author name ≠ Committer name on non-merge commits (cherry-picks are legitimate, but check context)
   Committer email is a GitHub noreply address but Author email is personal — investigate if this is unexpected for the repo workflow

4. New contributor on critical paths:
   First or second commit from a new contributor directly modifying:
     - Authentication code (auth/, login/, password/, session/, jwt/)
     - Cryptographic code (crypto/, cipher/, hash/, sign/)
     - Payment processing code (payment/, billing/, stripe/, checkout/)
     - CI/CD pipelines (.github/workflows/, .gitlab-ci.yml, Makefile)
     - Security configuration (firewall rules, WAF config, CSP headers)
   A legitimate first contribution is typically tests, docs, or minor features — NOT security-critical changes

5. Timestamp anomalies:
   Author date far in the future (author date 2030-01-01 in a 2024 repo) — indicates manipulated git history
   Author date BEFORE the repo was created
   Committer date significantly earlier than author date (more than a few seconds) on non-merge commits

6. GPG signature missing on release commits/tags:
   If other releases in the repo are GPG-signed (look for "gpgsig" in git objects or "Verified" badge patterns)
   A release commit or version bump commit that LACKS a signature compared to peers
   TAG objects without signatures (git tag -s vs git tag -a)

7. Suspicious commit messages hiding content:
   Commit message says "fix typo" or "update README" but the diff touches security-critical files
   Open the diff of such commits — does the changed content match the stated message?
   Large binary file committed with a trivial message

STEP 3 — Cross-reference with what's visible:
   List all unique author emails in the context provided
   Flag any email that differs from the pattern of legitimate contributors (same company domain)
   Flag first-time contributors making changes to security-sensitive paths
```

## Validation Prompt

```
Potential git impersonation at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. Is the suspicious author email associated with a corporate identity or a personal/free provider?
2. Does the author name contain any homoglyph or Unicode substitution for known team members?
3. For Co-authored-by: does the named co-author have other commits in this repository?
4. What files does this commit modify? Are they security-sensitive (auth, crypto, CI/CD, payment)?
5. Does the commit have a GPG signature, and is that consistent with other commits from this author?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Automated bots (dependabot[bot], renovate[bot], github-actions[bot]) use noreply addresses — expected and not impersonation
- Cherry-pick and merge commits legitimately have different author vs committer timestamps and identities
- Contributors using personal email addresses in open-source projects (all commits from that person use personal email consistently) — not impersonation
- Monorepo setups where CI commits (version bumps, changelog updates) appear under a service account — expected pattern
- Co-authored-by added automatically by GitHub's "co-author" feature for PRs with multiple authors is verified by GitHub
- Commits from forks (in open-source repos) naturally appear with external email addresses — normal for PRs
