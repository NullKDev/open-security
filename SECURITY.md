# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Do not open a public issue.** Security vulnerabilities should be reported privately.

Please report vulnerabilities via GitHub's [private vulnerability reporting](https://github.com/NullKDev/open-security/security/advisories/new) or email `security@open-security.dev` (if that address exists).

### What to include

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Any potential mitigations you've identified

### What to expect

- **Acknowledgment**: Within 48 hours
- **Status update**: Within 5 business days
- **Resolution**: We aim to patch critical vulnerabilities within 7 days

## Scope

This policy covers the open-security application itself — the Next.js web UI, the CLI tool, the scan pipeline, and the local SQLite database. It does NOT cover:

- Vulnerabilities in third-party dependencies (report those upstream)
- Vulnerabilities in the scanned repositories (open-security is the scanner, not the scanned target)
- Misconfigurations of classical scanners (gitleaks, semgrep, trufflehog, osv-scanner)

## Security Model

open-security is **local-first**. It:

- Runs entirely on your machine — no cloud services
- Stores all data in a local SQLite database (`.obt/db.sqlite`)
- Never sends telemetry or usage data
- Only makes outbound connections to clone repositories and call LLM APIs (Anthropic, OpenAI, Google, Ollama)
- API keys are stored locally in `.obt/config.json` and never transmitted except to their respective API endpoints

## Known Security Boundaries

| Boundary | Risk | Mitigation |
|----------|------|------------|
| LLM provider CLI spawn | CLI tools have filesystem access | Scans run with explicit `--dangerously-skip-permissions` flags; CSP headers on web UI; no server-side user input to CLI |
| API key storage | `.obt/config.json` is plaintext | File is gitignored; user is responsible for filesystem permissions |
| SSE streaming | Scan events contain file paths | No authentication required (local-first); events are read-only |

## Past Vulnerabilities

None reported yet.
