# Detector / Skill System

Detectors are the LLM-powered vulnerability scanners in open-security. Each detector is a `SKILL.md` file that defines what to look for, how to prompt the LLM, how to validate findings, and what false positives look like.

## How detectors work

1. **Stage 2 (LLM Scan)** — The detector's detection prompt is injected into the LLM context via the skill registry. The LLM analyzes the code and emits findings as JSON lines.
2. **Stage 3 (Validate)** — A second LLM call uses the validation prompt to confirm each finding is a true positive.
3. **Findings flow downstream** — Confirmed findings proceed to Stage 4 (Filter) and Stage 5 (Patch).

Detectors are **auto-discovered** at startup by recursively scanning the `detectors/` directory for `SKILL.md` files. No registration step is required.

## SKILL.md format

### File location

```
detectors/<domain>/<detector-name>/SKILL.md
```

### YAML frontmatter

```yaml
---
id: sqli                         # Unique identifier (snake_case). Used as the detector name in findings.
title: SQL Injection             # Human-readable name shown in the UI.
stages:                          # Pipeline stages that use this detector.
  - llm-scan
  - validate
severity: critical               # Default severity: critical | high | medium | low | info
description: Detects SQL...      # One-sentence description for the UI.
classical_prepass: semgrep       # Optional. Which classical scanner covers this class of issue.
classical_hint: p/sql-injection  # Optional. Scanner rule or config reference.
---
```

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique snake_case identifier. Appears in `findings.detector`. |
| `title` | Yes | Human-readable name shown in the findings table. |
| `stages` | Yes | Array: `llm-scan`, `validate`. Both are typically included. |
| `severity` | Yes | Default severity assigned to findings from this detector. |
| `description` | Yes | One sentence describing what the detector looks for. |
| `classical_prepass` | No | Which classical scanner pre-filters for this issue class. |
| `classical_hint` | No | Scanner-specific rule reference (e.g., semgrep ruleset or gitleaks config). |

### Markdown body

The body contains up to three sections:

#### Detection Prompt

The prompt injected into the Stage 2 LLM call. Uses `{code}` as a template variable that the pipeline fills with the code context.

```markdown
## Detection Prompt

\`\`\`
Analyze the following code for SQL injection vulnerabilities. Look for:
- User-controlled input (request params, query strings, headers, cookies) that flows into SQL queries
- String concatenation or interpolation used to build SQL statements
- Raw query execution without parameterized placeholders (?, $1, :name)
- ORM raw() or literal() calls with unsanitized input

For each finding, identify:
1. The source of user input
2. The sink (SQL execution point)
3. Any missing sanitization or parameterization

Code context:
{code}
\`\`\`
```

The pipeline always ends the prompt with an output format instruction:

```
When you find a vulnerability, output EXACTLY one JSON object per line:
{"title":"<short name>","description":"<what is wrong>","severity":"<level>","location":"<file:line>","detector":"llm"}
```

#### Validation Prompt

The prompt used by Stage 3 to validate each finding. Uses `{file}:{line}` and `{snippet}`.

Must produce: `{"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}`

```markdown
## Validation Prompt

\`\`\`
A potential SQL injection was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is the input actually user-controlled (not a hardcoded value)?
2. Does the input reach the SQL sink without parameterization?
3. Is there any ORM-level protection in the call chain?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
\`\`\`
```

#### FP Heuristics

Optional section. Prose hints that help the validation stage recognize common false positives. These are not directly injected — they inform detector quality and can be referenced when tuning validation prompts.

```markdown
## FP Heuristics

- Queries that use only integer literals or enums are not exploitable
- ORM methods like `.where({ id: userId })` with typed parameters are safe
- Queries in test fixtures with hardcoded values are not exploitable
- Admin-only endpoints with authentication middleware reduce exploitability
```

## Domain structure

Detectors are organized by domain. Each domain maps to a security concern area:

### web

SQL injection, XSS, SSRF, path traversal, command injection, insecure deserialization, authentication bypass, cryptographic misuse, mass assignment, NoSQL injection, prototype pollution, security misconfiguration, broken access control.

### cloud

Hardcoded cloud credentials, overly permissive IAM policies, exposed storage buckets, Dockerfile misconfiguration, Kubernetes misconfiguration, Terraform misconfiguration.

### mobile

Android/iOS insecure storage, cleartext communication, WebView misconfiguration, hardcoded credentials in mobile apps, Android security (exported components, AndroidManifest flags).

### db

ORM injection, unencrypted database connections, weak authentication in DB configuration.

### cicd

GitHub Actions workflow injection, hardcoded secrets in CI/CD pipelines, self-hosted runner risks, unprotected workflow triggers, committed environment files.

### supply-chain

Dependency confusion attacks, unpinned dependencies, malicious package hooks, vulnerable dependency context.

### repo

Secrets committed to git history, suspicious commits (large diffs, binary files, sensitive file patterns), author anomalies (new committer, impersonation signals).

### shell

Shell argument injection, eval injection in shell scripts, environment variable poisoning.

### language

Language-specific issues: Python pickle injection, JavaScript `child_process` injection, Go unsafe pointer usage, Java insecure deserialization, Rust unsafe blocks, C/C++ buffer overflows.

### emerging

Cache poisoning, file upload vulnerabilities, gRPC plaintext communication, OAuth misconfiguration, race conditions, ReDoS (Regular Expression Denial of Service), WebSocket cross-site WebSocket hijacking (CSWSH).

### social

Fake credentials (honeypot-style), phishing URLs in code or comments, developer impersonation signals.

### desktop

Electron misconfiguration (nodeIntegration, contextIsolation, remote module usage).

## All current detectors

| Domain | Detector | ID | Default severity |
|--------|----------|----|-----------------|
| web | SQL Injection | `sqli` | critical |
| web | Cross-Site Scripting | `xss` | high |
| web | Server-Side Request Forgery | `ssrf` | high |
| web | Path Traversal | `path-traversal` | high |
| web | Command Injection | `command-injection` | critical |
| web | Insecure Deserialization | `insecure-deserialization` | high |
| web | Authentication Bypass | `auth-bypass` | critical |
| web | Cryptographic Misuse | `crypto-misuse` | high |
| web | Mass Assignment | `mass-assignment` | medium |
| web | NoSQL Injection | `nosql-injection` | high |
| web | Prototype Pollution | `prototype-pollution` | medium |
| web | Security Misconfiguration | `security-misconfig` | medium |
| web | Broken Access Control | `broken-access-control` | high |
| cloud | Hardcoded Cloud Credentials | `hardcoded-cloud-creds` | critical |
| cloud | IAM Overly Permissive | `iam-overly-permissive` | high |
| cloud | Exposed Storage | `exposed-storage` | high |
| cloud | Dockerfile Misconfiguration | `dockerfile-misconfig` | medium |
| cloud | Kubernetes Misconfiguration | `k8s-misconfig` | high |
| cloud | Terraform Misconfiguration | `terraform-misconfig` | medium |
| mobile | Android Security | `android-security` | high |
| mobile | Cleartext Communication | `cleartext-comm` | high |
| mobile | Hardcoded Credentials | `hardcoded-creds` | critical |
| mobile | Insecure Storage | `insecure-storage` | high |
| mobile | WebView Misconfiguration | `webview-config` | high |
| db | ORM Injection | `orm-injection` | high |
| db | Unencrypted Connection | `unencrypted-connection` | medium |
| db | Weak Auth | `weak-auth` | high |
| cicd | Env File Committed | `env-file-committed` | critical |
| cicd | GitHub Actions Injection | `github-actions-injection` | high |
| cicd | Hardcoded Workflow Secrets | `hardcoded-workflow-secrets` | critical |
| cicd | Self-Hosted Runner Risks | `self-hosted-runner` | medium |
| cicd | Unprotected Triggers | `unprotected-triggers` | medium |
| supply-chain | Dependency Confusion | `dependency-confusion` | high |
| supply-chain | Malicious Package Hooks | `malicious-package-hooks` | high |
| supply-chain | Unpinned Dependencies | `unpinned-deps` | medium |
| supply-chain | Dependency Vulnerability Context | `dep-vuln-context` | medium |
| repo | Author Anomaly | `author-anomaly` | low |
| repo | Secret in History | `secret-in-history` | high |
| repo | Suspicious Commit | `suspicious-commit` | medium |
| shell | Argument Injection | `argument-injection` | high |
| shell | Env Poisoning | `env-poisoning` | medium |
| shell | Eval Injection | `eval-injection` | critical |
| language/js | Child Process Injection | `child-process-injection` | critical |
| language/python | Python Pickle Injection | `python-pickle-injection` | high |
| language/go | Unsafe Pointer | `unsafe-pointer` | medium |
| language/java | Insecure Deserialization | `insecure-deserialization-java` | high |
| language/rust | Unsafe Blocks | `unsafe-blocks` | low |
| language/cpp | Buffer Overflow | `buffer-overflow` | critical |
| emerging | Cache Poisoning | `cache-poisoning` | medium |
| emerging | File Upload | `file-upload` | high |
| emerging | gRPC Plaintext | `grpc-plaintext` | medium |
| emerging | OAuth Misconfiguration | `oauth-misconfig` | high |
| emerging | Race Condition | `race-condition` | medium |
| emerging | ReDoS | `redos` | medium |
| emerging | WebSocket CSWSH | `websocket-cswsh` | high |
| social | Fake Credentials | `fake-credentials` | info |
| social | Impersonation | `impersonation` | low |
| social | Phishing URLs | `phishing-urls` | medium |
| desktop | Electron Misconfiguration | `electron-config` | high |

## Adding a new detector

### Step 1: Create the directory

```bash
mkdir -p detectors/<domain>/<detector-name>
```

### Step 2: Write the SKILL.md

Use the template:

```markdown
---
id: my-detector
title: My Vulnerability
stages:
  - llm-scan
  - validate
severity: high
description: Detects [what it detects] in source code.
classical_prepass: semgrep
classical_hint: p/my-rule
---

# My Vulnerability Detector

## Detection Prompt

\`\`\`
Analyze the following code for [vulnerability type]. Look for:
- Pattern 1: [description]
- Pattern 2: [description]

For each finding, identify:
1. The source of potentially dangerous input
2. The sink where the vulnerability manifests
3. The file and line number

Code context:
{code}
\`\`\`

## Validation Prompt

\`\`\`
A potential [vulnerability] was reported at {file}:{line}.

Snippet:
{snippet}

Evaluate:
1. Is the dangerous input actually reachable from an external source?
2. Does execution reach the vulnerable sink?
3. Is there any mitigation in the call chain?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
\`\`\`

## FP Heuristics

- [Common false positive pattern 1]
- [Common false positive pattern 2]
```

### Step 3: Test

```bash
bun bin/obt.ts scan /path/to/sample-repo --mode standard
```

Review findings for the new detector ID. Tune FP heuristics based on observed false positives.

## Prompt best practices

1. **Be specific about sinks** — Name the dangerous functions or patterns explicitly (`db.query()`, `child_process.exec()`, `pickle.loads()`). Generic language produces generic results.

2. **Describe the data flow** — "User input from `req.body` flows into `db.query()` without parameterization" is more actionable than "possible injection."

3. **List false positive cases** — Explicitly tell the LLM what is NOT a vulnerability (enum values, test fixtures, admin-only paths). This reduces noise at Stage 3.

4. **Use `{code}` correctly** — The pipeline substitutes code context here. Do not hardcode file content in the prompt.

5. **Require JSON output** — The pipeline expects JSON lines. The global output format instruction is appended automatically, but your prompt should not add conflicting format instructions.

6. **Scope the validation** — The validation prompt receives `{file}:{line}` and `{snippet}`. Ask targeted questions about that specific location, not the entire codebase.

7. **Assign accurate severity** — The default severity from the frontmatter is applied to all findings from this detector. Use `critical` only for vulnerabilities that can be directly exploited for remote code execution, data exfiltration, or authentication bypass.
