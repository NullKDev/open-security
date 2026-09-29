# Scan Modes

open-security supports four scan modes that trade speed for depth. All modes run the classical scanners (Stage 0 and Stage 1). The modes differ in how many LLM passes they run and what those passes do.

## Mode comparison

| | Quick | Standard | Intermediate | Paranoid |
|---|-------|----------|-------------|----------|
| **Classical scanners** | Yes | Yes | Yes | Yes |
| **LLM passes** | 0 | 1 | 3–4 | 5–7 |
| **ProjectMap (Pass 0)** | No | No | Yes | Yes |
| **Domain-scoped analysis** | No | No | Yes | Yes |
| **Skill injection** | No | Stack-based | Domain-based | Domain-based |
| **Fix suggestions (unified diff)** | No | No | No | Yes |
| **Deduplication across passes** | No | No | Yes | Yes |
| **Approximate duration** | < 1 min | ~5 min | ~15 min | ~30 min |
| **Approximate LLM cost** | $0 | ~$0.10 | ~$0.50 | ~$1.50 |

Costs are estimates based on Claude Sonnet 4.5 for `llm-scan` and Claude Haiku 4.5 for `validate`. Actual cost depends on the configured providers and model sizes.

## Quick

```
Stage 0 (Prep) → Stage 1 (Classical) → Stage 4 (Filter)
```

Classical scanners only. No LLM calls. No API keys required.

**What runs:**
- gitleaks: secrets in code and git history
- trufflehog: additional secret patterns
- semgrep: code pattern matching (SQLi, XSS, path traversal, etc.)
- osv-scanner: known CVEs in dependency lockfiles

All four scanners run in parallel. Results are normalized to a common format and filtered through `fp-filter.yaml`.

**What it does not do:** No LLM analysis, no validation pass, no fix suggestions.

**When to use:**
- CI/CD pipelines where speed is critical and LLM latency is unacceptable
- Pre-commit hooks
- Quick sanity checks before a deeper scan
- When you only need deterministic, reproducible scanner results (no LLM non-determinism)

**Strategy class:** `QuickStrategy` — returns `{ findings: ctx.classicalFindings, llmSkipped: true }`

## Standard

```
Stage 0 → Stage 1 → Stage 2 (1 LLM pass) → Stage 3 (Validate) → Stage 4 (Filter) → Stage 5 (Patch)
```

Classical scanners plus one LLM pass over the full codebase with stack-aware skill injection.

**What the LLM pass does:**

The pipeline calls `buildScanPrompt({ stack, userPrompt })` which:
1. Resolves compact security rules from the skill registry for the detected stack
2. Prepends those rules under `## Security Skills`
3. Lists all vulnerability domains to audit (SQLi, XSS, SSRF, cloud misconfig, supply chain, etc.)
4. Instructs the LLM to read actual source files using tool calls (not guess from filenames)
5. Appends a JSON output format instruction

The LLM reads files, emits findings as JSON lines, and Stage 3 validates each finding.

**When to use:**
- Regular security audits on small-to-medium repositories
- When you want LLM intelligence without the overhead of a full domain mapping
- Default mode for most scans
- When the repository structure is simple or well-understood

**Strategy class:** `StandardStrategy`

## Intermediate

```
Stage 0 → Stage 1 → Stage 2 (Pass 0 + 3–4 domain passes) → Stage 3 → Stage 4 → Stage 5
```

Pass 0 generates a ProjectMap via LLM. Each domain then gets a targeted LLM pass with domain-specific skill rules.

**Pass 0 — ProjectMap:**

The LLM receives the file tree and sample snippets from Stage 0 and generates a structured map:

```json
{
  "stack": ["next.js", "typescript", "tailwind", "sqlite"],
  "domains": [
    { "name": "auth", "files": ["src/auth/", "middleware.ts"] },
    { "name": "input-validation", "files": ["app/api/", "src/validators/"] },
    { "name": "data-store", "files": ["src/db/", "src/repos/"] },
    { "name": "file-io", "files": ["src/upload/", "src/export/"] }
  ]
}
```

The number of domains is determined by the LLM based on the repository's structure. Intermediate mode targets 3–4 domains.

**Per-domain passes:**

Each domain gets its own LLM call with:
- `resolveRulesForDomain(domain, stack)` — domain-specific security rules from the skill registry
- A scoped file list (capped at 40 files per domain via `mapDomainToFiles`)
- A domain-focused prompt header: `"You are an expert offensive security engineer performing a focused audit of the **auth** domain."`

**Deduplication:**

Findings from multiple domain passes are deduplicated by the composite key `locationPath:locationLineStart:title.trim().toLowerCase()`. The first occurrence wins. This prevents the same vulnerability from appearing N times when multiple domain passes cover overlapping files.

**When to use:**
- Thorough code review of medium-to-large repositories
- When different parts of the codebase have meaningfully different security concerns
- Audits where you want domain-specific expertise (auth vs. data store vs. API layer)
- When Standard mode misses issues due to context window limitations

**Strategy class:** `OrchestratedStrategy('intermediate')`

## Paranoid

```
Stage 0 → Stage 1 → Stage 2 (Pass 0 + 5–7 domain passes) → Stage 3 → Stage 4 → Stage 5
```

Same as Intermediate, but with more domains and inline fix suggestions.

**Differences from Intermediate:**

1. More domains in ProjectMap (5–7 vs 3–4) — the LLM is instructed to go deeper
2. `includeFixSuggestions: true` is passed to `buildScanPrompt` — the LLM is asked to include a `"fix"` field in each finding JSON
3. Prompt includes deeper methodology instructions:
   - "Act as a skilled attacker who has full access to the source"
   - "Be skeptical of every assumption"
   - "Trace data from external inputs through the call graph"
   - "Check configuration files, build scripts, and CI/CD pipelines"
   - "Report ALL findings including medium/low — do not self-filter"

**Fix suggestions:**

Each finding in paranoid mode includes a `"fix"` field with a unified diff patch:

```json
{
  "title": "SQL injection in user search",
  "severity": "critical",
  "location": "src/api/users.ts:42",
  "detector": "llm",
  "fix": "--- a/src/api/users.ts\n+++ b/src/api/users.ts\n@@ -42,7 +42,7 @@\n-  const rows = db.query(`SELECT * FROM users WHERE name = ${req.query.name}`)\n+  const rows = db.query('SELECT * FROM users WHERE name = ?', [req.query.name])"
}
```

Fix suggestions are stored in `findings.patch_diff` and shown in the UI on the finding detail page.

**When to use:**
- Critical infrastructure audits before a major release
- Pre-release security gates (the scan is meant to block the release)
- Compliance-mandated security reviews that require remediation guidance
- When you need both findings and actionable fix suggestions in one pass

**Strategy class:** `OrchestratedStrategy('paranoid')`

## Diff mode

```
Stage 0 → Stage 1 (scoped to changed files) → Stage 2 (1 LLM pass, scoped) → Stage 3 → Stage 4 → Stage 5
```

PR-scoped scanning. Narrows Stage 1 to the changed files and skips osv-scanner. The LLM pass focuses on the changed lines and their 1-hop callers.

Diff mode is triggered when `strategy: 'diff'` is passed to the pipeline runner along with a `DiffContext` (baseSha, headSha, changedFiles). After scanning, the pipeline posts a PR comment with findings via GitHub API.

**When to use:** Automated PR scanning via webhook integration.

## Choosing a mode

```
Quick ──────────▶ Standard ──────────▶ Intermediate ──────────▶ Paranoid
  │                  │                      │                      │
  │ "Is there        │ "What                │ "What domain-        │ "I need every
  │  anything        │  vulnerabilities     │  specific issues     │  finding + a fix
  │  obviously       │  does the LLM        │  exist in each       │  to show compliance"
  │  wrong?"         │  find?"              │  area of the app?"   │
  ▼                  ▼                      ▼                      ▼
CI pipeline      Regular audit         Deep code review      Security gate
```

Start with **Standard** for most repository scans. Move to **Intermediate** for thorough audits on larger or more complex codebases. Use **Paranoid** for critical releases or compliance reviews. Use **Quick** for CI pipelines where sub-60-second scan time matters.

## Legacy `deep` mode

The original `deep` mode has been renamed to `paranoid`. The `normalizeScanMode()` function maps `'deep'` → `'paranoid'` with a warning event. Existing scans stored with `scanMode: 'deep'` in the database continue to work.
