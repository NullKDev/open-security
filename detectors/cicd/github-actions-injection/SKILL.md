---
id: github-actions-injection
title: GitHub Actions Workflow Injection
stages:
  - llm-scan
  - validate
severity: critical
description: Detects command injection vulnerabilities in GitHub Actions workflows where untrusted input (issue titles, PR bodies, branch names, commit messages) is interpolated into run commands or expressions. Also covers unpinned actions and secret exposure.
classical_prepass: semgrep
---

# GitHub Actions Workflow Injection

## Detection Prompt

You are a CI/CD security specialist. Open and read ALL files under `.github/workflows/`. You MUST actually read the workflow YAML files.

### Step 1: Read all workflow files
Use your tools to read every `.yml` and `.yaml` file under `.github/workflows/`. Do not skip any.

### Step 2: Untrusted Input in `run:` Commands
Look for `${{ github.event.X }}` used DIRECTLY in `run:` blocks:
```yaml
# VULNERABLE:
run: echo "Title: ${{ github.event.issue.title }}"   # shell injection
run: git checkout ${{ github.event.pull_request.head.ref }}  # branch name injection

# SAFE:
env:
  TITLE: ${{ github.event.issue.title }}
run: echo "Title: $TITLE"  # passed via env var, not inline
```

Flag these untrusted sources used in `run:` blocks:
- `github.event.issue.title`, `github.event.issue.body`
- `github.event.pull_request.title`, `github.event.pull_request.body`
- `github.event.comment.body`
- `github.head_ref`, `github.ref_name` (branch names from forks)
- `github.event.pull_request.head.ref`, `github.event.pull_request.head.sha` (from forks)
- `github.event.inputs.*` when the workflow is `workflow_dispatch` triggered by untrusted source

### Step 3: `pull_request_target` — Critical Risk
Any workflow with `on: pull_request_target` that:
- Checks out the PR head code: `ref: ${{ github.event.pull_request.head.sha }}`
- Then runs code from that checkout
This allows a fork PR to execute arbitrary code with full access to repo secrets.

### Step 4: Unpinned Third-Party Actions
Flag any `uses:` line with:
- `@master`, `@main`, `@latest`, `@develop` — not pinned, attacker can swap code
- Short version tags like `@v1` — still mutable (tag can be moved)
- Actions from organizations with fewer than 100 stars or recent creation

Safe pinning: `uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2`

### Step 5: Secret Exposure
- `run: echo "${{ secrets.API_KEY }}"` — secret printed to logs (visible in Actions UI)
- Secrets passed to untrusted third-party actions via `with:`
- `env:` at workflow level exposing secrets to ALL steps (over-scoped)
- Artifact uploads that include files containing secrets

### Step 6: Dangerous Permissions
In `permissions:` blocks or absence thereof:
- `permissions: write-all` or missing `permissions:` entirely (defaults to `contents: write`)
- `pull-requests: write` granted to workflows triggered by fork PRs
- `id-token: write` (OIDC) granted to steps that don't need cloud access

### Step 7: Self-Hosted Runner Risks
- Jobs running on `self-hosted` runners that are also used by untrusted PRs
- No isolation between jobs on self-hosted runners (filesystem persistence)
- Secrets accessible to all jobs on self-hosted runners regardless of trust level

## Validation Prompt

A potential GitHub Actions injection was reported at {file}:{line}.

Evaluate:
1. Is the input truly user-controlled (from fork PR, issue by non-maintainer)?
2. Does the untrusted value reach a shell `run:` command or `eval`-like context?
3. Is there proper sanitization (env var indirection, input validation)?
4. Would exploitation allow: secret exfiltration, code execution, pipeline compromise?
5. Does the workflow trigger on `pull_request` (safe) or `pull_request_target` (dangerous)?

Respond: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics

- Workflows only triggered by maintainer events (push to main, workflow_dispatch by org members)
- Untrusted input passed through `env:` variable (not inline `${{ }}` in run:)
- `actions/checkout@SHA` with explicit SHA pin — safe
- Official GitHub actions (`actions/*`, `github/*`) at any version — trusted publisher
- `pull_request` (not `pull_request_target`) — fork code runs without repo secrets access
