# open-security

> Local-first Blue Team security workbench. Point it at a repository and it scans with classical tools (gitleaks, semgrep, trufflehog, osv-scanner) plus LLM analysis across 11 providers, then streams findings to a live UI — no cloud, no login, no telemetry.

[![Tests](https://github.com/NullKDev/open-security/actions/workflows/test.yml/badge.svg)](https://github.com/NullKDev/open-security/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-orange)](CHANGELOG.md)

## Features

- **Source ingestion** — GitHub, GitLab, local folders, ZIP archives (up to 200 MB)
- **Classical scanners** — gitleaks, trufflehog, semgrep, osv-scanner, run in parallel
- **LLM analysis** — 60+ detectors across 11 domains, injected into structured prompts
- **4 scan modes** — Quick (classical only), Standard (single LLM pass), Intermediate (domain-scoped), Paranoid (deep + fix suggestions)
- **5-stage pipeline** — Prep → Classical → LLM → Validate → Filter → Patch
- **Git history forensics** — secrets in history, suspicious commits, author anomalies
- **Report formats** — JSON, Markdown, SARIF 2.1.0, CSV
- **11 LLM providers** — Claude Code, OpenCode, Codex, Gemini CLI, Cursor Agent, Qwen Code, Ollama + Anthropic/OpenAI/Google/Ollama APIs
- **BYOK** — bring your own API keys; all stored locally in `.obt/config.json`
- **CLI** — `obt scan`, `obt history`, `obt report`, `obt agents`

## Pipeline

```
Stage 0      Stage 1        Stage 2      Stage 3      Stage 4      Stage 5
  Prep    →  Classical  →   LLM Scan  →  Validate  →  Filter   →   Patch
  clone      gitleaks        strategy     second LLM   FP rules     unified
  detect     trufflehog      dispatch     pass per     from YAML    diff per
  stack      semgrep         skill        finding      policies     finding
             osv-scanner     injection
```

The pipeline runs in-process inside the Next.js server. Findings are streamed to the browser via Server-Sent Events as they arrive.

## Quick start

**Requirements**: [bun](https://bun.sh) 1.x, Node.js 20+ (for DB tests)

**Optional** (classical scanners — install whichever you need):
- [gitleaks](https://github.com/gitleaks/gitleaks)
- [trufflehog](https://github.com/trufflesecurity/trufflehog)
- [semgrep](https://semgrep.dev)
- [osv-scanner](https://github.com/google/osv-scanner)

```bash
git clone https://github.com/NullKDev/open-security.git
cd open-security
bun install
bun run dev        # UI at http://localhost:3000
```

### CLI usage

```bash
bun bin/obt.ts scan https://github.com/org/repo
bun bin/obt.ts scan /path/to/local/repo --mode paranoid
bun bin/obt.ts history /path/to/repo
bun bin/obt.ts report --format sarif <scanId>
bun bin/obt.ts agents
```

## Scan modes

| Mode | Classical | LLM passes | ProjectMap | Fix suggestions | Typical duration |
|------|-----------|------------|------------|-----------------|-----------------|
| **quick** | Yes | 0 | No | No | < 1 min |
| **standard** | Yes | 1 (stack-aware) | No | No | ~5 min |
| **intermediate** | Yes | 3–4 (per-domain) | Yes | No | ~15 min |
| **paranoid** | Yes | 5–7 (per-domain) | Yes | Yes (unified diff) | ~30 min |

`quick` — classical scanners only, no API calls. Suitable for CI pipelines and pre-commit hooks.

`standard` — one LLM pass over the entire codebase with stack-aware skill injection. Default for most audits.

`intermediate` — Pass 0 generates a ProjectMap that identifies domains (auth, data-store, file-io, etc.). Each domain gets its own LLM pass with domain-specific detector rules.

`paranoid` — same as intermediate with more domains and inline fix suggestions (unified diffs) per finding.

See [docs/scan-modes.md](docs/scan-modes.md) for the full breakdown.

## Detectors

Detectors are SKILL.md files in `detectors/`. Each file contains YAML frontmatter (id, severity, stages) and Markdown sections with detection prompts, validation prompts, and false-positive heuristics.

Detector domains:

| Domain | Examples |
|--------|---------|
| `web` | SQLi, XSS, SSRF, path traversal, command injection, auth bypass, crypto misuse |
| `cloud` | Hardcoded credentials, IAM misconfig, exposed storage, Terraform/K8s/Docker misconfig |
| `mobile` | Insecure storage, cleartext traffic, WebView misconfig, hardcoded creds |
| `db` | ORM injection, unencrypted connections, weak auth |
| `cicd` | Workflow injection, hardcoded pipeline secrets, unprotected triggers |
| `supply-chain` | Dependency confusion, unpinned deps, malicious package hooks |
| `repo` | Secrets in git history, suspicious commits, author anomalies |
| `shell` | Argument injection, eval injection, env poisoning |
| `language` | Python pickle, JS child_process, Go unsafe, Java deserialization, C buffer overflow |
| `emerging` | Race conditions, ReDoS, OAuth misconfig, WebSocket CSWSH |
| `social` | Fake credentials, phishing URLs, impersonation |

See [docs/detectors.md](docs/detectors.md) for the SKILL.md format and how to add detectors.

## Configuration

On first run, open [http://localhost:3000/config](http://localhost:3000/config) to configure providers and models. Settings are stored in `.obt/config.json` (gitignored).

```json
{
  "models": {
    "llm-scan": "cli:claude:claude-sonnet-4-5",
    "validate": "api:anthropic:claude-haiku-4-5",
    "patch":    "cli:claude:claude-sonnet-4-5"
  },
  "providers": {
    "anthropicKey": "sk-ant-...",
    "openaiKey":    "sk-...",
    "googleKey":    "..."
  }
}
```

Each pipeline stage (llm-scan, validate, filter, patch) can use a different model. CLI agents (`cli:*`) are detected automatically by probing PATH. API providers (`api:*`) need a key.

See [docs/providers.md](docs/providers.md) for all supported providers and [docs/configuration.md](docs/configuration.md) for the full config schema.

## Workspace

All data is stored under `.obt/` (gitignored):

```
.obt/
  db.sqlite                              SQLite database
  config.json                            API keys, model selection
  projects/{projectId}/scans/{scanId}/
    source/                              Cloned / copied source
    reports/                             Exported report files
```

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/architecture.md](docs/architecture.md) | System diagram, layer stack, key design decisions |
| [docs/pipeline.md](docs/pipeline.md) | 5-stage pipeline, events, provider resolution |
| [docs/scan-modes.md](docs/scan-modes.md) | Quick/Standard/Intermediate/Paranoid — when to use each |
| [docs/providers.md](docs/providers.md) | All 11 providers, transports, configuration, adding new ones |
| [docs/detectors.md](docs/detectors.md) | SKILL.md format, detector domains, adding detectors |
| [docs/testing.md](docs/testing.md) | Test layers, TDD workflow, mocking patterns |
| [docs/configuration.md](docs/configuration.md) | Config schema, policies, environment variables |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, SDD workflow, PR process |
| [DESIGN.md](DESIGN.md) | UI design system, tokens, component specifications |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting, security model |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All substantial changes go through Spec-Driven Development (SDD). Run `bun run test` before submitting a PR.

## License

Apache-2.0 © 2026 NearDev
