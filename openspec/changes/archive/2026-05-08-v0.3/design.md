# v0.3 Design — CVE Hunter + Investigation Console + Playbooks + Secret Timeline

> Phase: design. Date: 2026-05-06. Status: draft.
> Inputs: `sdd/v0.3/proposal` (id 416), `sdd/v0.3/spec` (id 418).

This design is the architectural HOW. It does not enumerate tasks. It resolves the six open questions from the proposal/spec, defines the new module boundaries, schema deltas, event flows, and the data shapes that all v0.3 capabilities share.

---

## 0. Architecture-at-a-glance

```
                       ┌─────────────────────────────────┐
  /scans/[id]   ──SSE──│   InvestigationConsole (UI)     │
  /hunt         ──SSE──│   PlanEditor / ToolCallPrompt   │
  /findings/    ──SSR──│   SecretTimelineView            │
   [id]/timeline       └──────────────┬──────────────────┘
                                      │ POST
            ┌─────────────────────────┴──────────────────────────┐
            │ /api/scans/[id]/{inject-prompt, edit-plan,         │
            │   reject-tool, fork, permission}                   │
            │ /api/playbooks  /api/hunt                          │
            └─────────────────────────┬──────────────────────────┘
                                      │
                           ┌──────────┴──────────┐
                           │  PendingTurnQueue   │   ← new module
                           │  (per-scanId)       │
                           └──────────┬──────────┘
                                      │
                ┌─────────────────────┴────────────────────┐
                │            SessionManager                │
                │  ┌────────────────────────────────────┐  │
                │  │ Phase 9 promptLoop (NEW):          │  │
                │  │  while (queue.hasNext()):           │  │
                │  │    await connection.prompt(turn)   │  │
                │  └────────────────────────────────────┘  │
                └─────────────────────┬────────────────────┘
                                      │ ACP
                              ┌───────┴───────┐
                              │ AcpScanClient │
                              └───────────────┘

  Strategy dispatch (lib/pipeline/strategies/index.ts):
    quick / standard / intermediate / paranoid       (existing)
    hunt                                              (new — HuntStrategy)
    playbook:<name>@<version>                         (new — PlaybookStrategy)

  Derived data (no scan):
    SecretTimelineDeriver  ← reads commits + git log
```

The architecture stays **strategy-pattern + ACP-event-stream**. v0.3 adds two new strategies, a per-scan turn queue in front of `connection.prompt()`, four new event types, a derived-data module for secret timelines, and a manifest loader for playbooks. **No new processes, no daemon, no new transport.**

---

## 1. CVE Hunter pipeline

### 1.1 Module boundaries

```
lib/advisories/
  osv-client.ts        — fetch + Zod-parse OSV.dev JSON
  ghsa-client.ts       — fallback for GHSA IDs (reuses v0.2 PAT)
  normalize.ts         — OSV/GHSA → AdvisoryMeta (canonical shape)
  cve-class.ts         — classify advisory → 'injection'|'path-traversal'|...
  prompt-templates/    — one Markdown file per class + generic.md
  cache.ts             — read/write hunt_targets.advisory_raw

lib/pipeline/strategies/
  hunt.ts              — HuntStrategy implements ScanStrategy
```

### 1.2 Canonical types

```ts
export interface HuntTarget {
  /** Original input from API: 'CVE-2024-3094' | 'GHSA-…' | URL */
  raw: string
  /** Resolved canonical ID after URL parsing */
  id: string                       // e.g. 'CVE-2024-3094'
  source: 'osv' | 'ghsa'
}

export interface AdvisoryMeta {
  id: string
  summary: string
  details?: string
  cweIds: string[]                 // e.g. ['CWE-94']
  affectedPackages: Array<{
    name: string
    ecosystem: 'npm' | 'PyPI' | 'Go' | 'Maven' | 'crates.io' | 'NuGet' | 'RubyGems' | string
    versionRanges: Array<{ introduced?: string; fixed?: string; lastAffected?: string }>
  }>
  references: Array<{ type: 'WEB' | 'ADVISORY' | 'FIX' | 'REPORT' | 'PACKAGE' | string; url: string }>
  pocPatternUrl?: string           // first reference where url contains /poc | /exploit | github.com/.../security
  cvssScore?: number
}

export type CveClass = 'injection' | 'path-traversal' | 'deserialization' | 'ssrf' | 'auth-bypass' | 'rce' | 'xss' | 'generic'

export interface HuntContext extends StrategyContext {
  huntTarget: HuntTarget
  advisory: AdvisoryMeta
  cveClass: CveClass
  /** Repo's detected ecosystems from stage0Stack — used to scope multi-ecosystem advisories. */
  repoEcosystems: string[]
}

export type HuntVerdict = 'exposed' | 'not-exposed' | 'indeterminate'
```

### 1.3 Stage-by-stage flow

| Stage | Action | Output |
|---|---|---|
| pre-stage0 | `OsvClient.fetch(huntTarget.id)` → `normalize()` → `AdvisoryMeta`. Read-through cache (`hunt_targets.advisory_raw`). 404 → emit `warning` event, install generic fallback advisory with `affectedPackages: []`. | Persists `hunt_targets` row. |
| stage0 | Existing stack detection runs unchanged. `repoEcosystems` derived from `stage0Stack`. | `stage0Stack` populated. |
| stage1 | Scoped osv-scanner: filter `advisory.affectedPackages` to `pkg.ecosystem ∈ repoEcosystems`. For each remaining package, invoke `osv-scanner --experimental-vulnerability=<id>` with the package manifest path. **All matching packages checked** (REQ-CH-06). Aggregate findings. | Set of vulnerable packages with locked versions. |
| stage2 | `cveClass = classifyAdvisory(advisory)`. Render `prompt-templates/${cveClass}.md` with handlebars-style `{{var}}` substitution (see §1.5). ACP prompt sent. | Live transcript via SSE. |
| stage3 | Existing dedupe + persist. `findings.detector = 'cve-hunter'`. Verdict stored in **`hunt_targets.verdict`** + denormalized to `findings.tags = JSON.stringify(['hunt','exposed'])` for filtering. | Persisted scan + finding(s). |

### 1.4 OSV.dev integration (REQ-CH-02)

- Endpoint: `GET https://api.osv.dev/v1/vulns/{id}` — no auth required. Uses Node's global `fetch` with 10s timeout, 1 retry on network error, no retry on 4xx.
- Response parsing: Zod schema in `osv-client.ts` mirrors the [OSV schema](https://ossf.github.io/osv-schema/). Extract:
  - `affected[].package.{name,ecosystem}` → `affectedPackages[].{name,ecosystem}`
  - `affected[].ranges[].events[]` → flatten to `versionRanges` (only `SEMVER`/`ECOSYSTEM` types; ignore `GIT`)
  - `references[]` — keep `type ∈ { 'WEB','ADVISORY','FIX','REPORT' }`. PoC heuristic: first URL where path contains `/poc`, `/exploit`, or matches `github.com/.../security/advisories/.*`.
  - `database_specific.cwe_ids` (OSV) or `affected[].database_specific.cwe_ids` (GHSA mirror)
- Multi-ecosystem advisories: parse all `affected[]` entries, then **filter by `repoEcosystems`** at stage1 entry. If intersection is empty → emit a `warning` event "advisory affects {ecosystems} — repo uses {repoEcosystems}, scoping to nothing" and short-circuit to `verdict = 'not-exposed'`.
- Unknown JSON shape: Zod failure → fall back to a `genericAdvisory` (title + summary only, empty packages) and continue with the generic prompt template. Do **not** fail the scan.
- Cache: `hunt_targets.advisory_raw` stores the unparsed JSON. On rerun within the same scan ID, parsing is skipped and the cached row is reused.

### 1.5 CVE-class → prompt template (Q5 — RESOLVED)

**Decision: Static map keyed by CWE ID, with a fallback to keyword sniffing on `summary+details`.** Deterministic; no extra LLM call.

```ts
// lib/advisories/cve-class.ts
const CWE_TO_CLASS: Record<string, CveClass> = {
  'CWE-78':  'injection',     // OS command
  'CWE-89':  'injection',     // SQL
  'CWE-94':  'injection',     // code injection
  'CWE-22':  'path-traversal',
  'CWE-502': 'deserialization',
  'CWE-918': 'ssrf',
  'CWE-287': 'auth-bypass',
  'CWE-306': 'auth-bypass',
  'CWE-77':  'rce',
  'CWE-79':  'xss',
}
const KEYWORD_FALLBACK: Array<[RegExp, CveClass]> = [
  [/sql\s*injection|sqli/i,      'injection'],
  [/path\s*traversal|zip\s*slip/i,'path-traversal'],
  [/deserial/i,                  'deserialization'],
  [/ssrf|server[- ]side request/i,'ssrf'],
  [/auth(?:n|orization)\s*bypass/i,'auth-bypass'],
  [/remote\s*code|rce/i,         'rce'],
  [/cross[- ]site\s*scripting|xss/i,'xss'],
]
```

Why CWE first, keyword fallback second, no LLM:
- CWE is structured, deterministic, present in ~85% of OSV/GHSA advisories per fixture sampling.
- Keyword sniffing covers the rest with zero added cost.
- **No LLM call before the main hunt** — keeps the hunt LLM budget focused on the actual reachability question and avoids a pre-prompt loop that doubles latency.

Templates live in `lib/advisories/prompt-templates/{class}.md`. Each template has the same skeleton:

```md
You are investigating {{advisoryId}}: {{advisorySummary}}.
Affected packages in this repo: {{affectedPackagesList}}.
PoC reference: {{pocPatternUrl|fallback to "none"}}.

# Reachability questions
{{class-specific-questions}}

# Output contract
- Conclude with one of: VERDICT_EXPOSED, VERDICT_NOT_EXPOSED, VERDICT_INDETERMINATE.
- If exposed: identify call site(s), name the entrypoint, and the data path that reaches the vulnerable API.
- If not-exposed: explain the gating condition (version below, code path absent, sink unreachable).
```

The `{{var}}` substitution is **plain string replacement** — no template engine added. Implemented as `template.replace(/{{(\w+)}}/g, (_, k) => ctx[k] ?? '')`. Same engine reused by Playbooks (§3.3) so we have one rule.

---

## 2. Investigation Console

### 2.1 Q1 RESOLVED — Mid-session injection transport

**Decision: option (a) re-call `connection.prompt()` per injection — but serialize via a per-scan PendingTurnQueue.**

Why:
- The ACP SDK exposes exactly one user-message entry point per session: `connection.prompt(PromptRequest)`. There is **no `sendMessage`, no mid-turn injection RPC, no reverse stream**. The SDK schema confirms `session/prompt` is THE method (`schema.json` line 1274).
- Per the protocol: "the agent processes the prompt … returns when the turn is complete". A second `prompt()` while a first is in flight is undefined behavior — different agents respond differently (some queue, some error).
- Therefore: serialize. `await prompt(turn1)` → resolves with `stopReason` → `await prompt(turn2)` → … This is exactly how a normal chat works. The first turn is the scan kickoff prompt; subsequent turns are user injections, plan edits, and tool-rejection redirects.

This means `SessionManager.run()` becomes a **multi-turn loop**, not a one-shot. The current Phase 9 (single `prompt`) is replaced by Phase 9' (loop until queue empty AND `done` signal received).

```ts
// SessionManager.run(), Phase 9' (replaces lines 250–306)
const queue = getPendingTurnQueue().forScan(opts.scanId)
queue.enqueue({ kind: 'initial', text: prompt })

while (!aborted) {
  const turn = await queue.next()      // resolves when a new turn is pushed
  if (turn === null) break             // sentinel — close

  const promptRes = await connection.prompt({
    sessionId,
    prompt: [{ type: 'text', text: turn.text }],
  })
  stopReason = promptRes.stopReason

  // Done if the model said end_turn AND no follow-up is pending.
  if (stopReason === 'end_turn' && queue.isEmpty() && sessionCompleted) break
  if (stopReason === 'cancelled' || stopReason === 'refusal') break
}
```

Where `PendingTurnQueue` is a per-scan FIFO with a `next()` that awaits a push when empty. Sentinel `null` is pushed by SessionManager teardown and by the abort handler.

`PendingTurnQueue` lives in `lib/providers/transport/pending-turn-queue.ts` as a module-level singleton (same pattern as `PermissionBridge`). API:

```ts
export interface PendingTurn {
  kind: 'initial' | 'user_injection' | 'plan_edit' | 'tool_redirect'
  text: string
  /** scan_events row id of the persisted source event — for traceability */
  sourceEventId?: number
}

export class PendingTurnQueue {
  forScan(scanId: string): ScanQueue
  closeScan(scanId: string): void   // pushes null sentinel
}

interface ScanQueue {
  enqueue(turn: PendingTurn): void
  next(): Promise<PendingTurn | null>
  isEmpty(): boolean
  drain(): void                     // reject pending awaiters on cancel
}
```

#### Why not options b/c/d
- (b) "queue in scan_events, agent reads from queue" — agent has no awareness of `scan_events`; it only sees what arrives via `session/prompt`. We'd be inventing a sidechannel the agent will ignore.
- (c) "use permission_request as injection channel" — only fires when the *agent* asks. We need a **client-initiated** path. Wrong direction.
- (d) "buffer in PendingInjection table, session-manager polls between tool calls" — same as (a) but with a DB poll instead of an in-memory queue. Adds DB latency to every turn. Rejected. (We still persist to `scan_events` first for audit, but we don't poll from there.)

### 2.2 Persistence-before-forwarding (REQ-IC-06)

Every injection endpoint follows the **same three-step pattern**:

```
1. Validate body with Zod.
2. INSERT scan_events row (type: 'user_injection' | 'plan_edit' | 'tool_call_rejected'). Capture insertId.
3. queue.enqueue({ kind, text, sourceEventId: insertId })
4. Return 202 Accepted with { eventId }.
```

Step 2 happens *before* step 3 so an ACP failure leaves the audit trail intact (REQ-IC-06).

### 2.3 Endpoint shapes

```
POST /api/scans/[id]/inject-prompt      body: { text: string }
POST /api/scans/[id]/edit-plan          body: { steps: PlanStep[] }
POST /api/scans/[id]/reject-tool        body: { requestId: string, redirectInstruction?: string }
POST /api/scans/[id]/fork               body: { atEventId: number, newPrompt?: string }
POST /api/scans/[id]/permission         body: { requestId: string, approved: boolean, redirectInstruction?: string }
```

All five reject when `scans.status !== 'running'`. All five validate with Zod schemas defined in `lib/api/schemas/console.ts`.

### 2.4 Plan editing flow

`PlanEditor` UI component holds the last received `PlanEvent` in client state. User edits step text, status, adds/removes steps, then clicks "Send plan update". The client POSTs `{ steps: PlanStep[] }`. The server formats the steps into an ACP user-turn:

```
The plan should be:
1. [in_progress] Audit auth.ts for token validation
2. [pending] Check session middleware
3. [pending] Trace token use in API routes
Please follow this plan unless you have a strong reason to deviate.
```

This is **advisory** (D3 from proposal). The agent receives it as a normal user turn, free to adapt or override. The client also stores the edit locally so the UI shows the user's view of the plan immediately, with a "(edited, pending agent confirmation)" badge until the next `plan` event arrives from the agent.

### 2.5 Tool-call rejection + redirect (Q6 RESOLVED)

**Decision: extend `PermissionBridge.resolveRequest()` with an optional `redirectInstruction`. After resolving with `cancelled`, push a follow-up turn into `PendingTurnQueue`.**

Sequence:
```
1. Agent → AcpScanClient.requestPermission → bridge.requestPermission (interactive)
2. Bridge emits permission_request event via SSE.
3. UI shows ToolCallPrompt. User clicks Reject + types "use only read tools".
4. POST /api/scans/[id]/reject-tool { requestId, redirectInstruction: "use only read tools" }
5. Server:
   a. INSERT scan_events { type: 'tool_call_rejected', payload: { requestId, redirectInstruction } }
   b. bridge.resolveRequest(scanId, requestId, false) → SDK promise resolves with outcome=cancelled
   c. queue.enqueue({ kind: 'tool_redirect', text: "Tool call rejected. Redirect: use only read tools." })
6. ACP agent sees tool denied → finishes current turn (typically end_turn or refusal).
7. SessionManager loop picks up enqueued redirect → connection.prompt(turn) → agent adapts.
```

**Deadlock prevention** (proposal risk: tool-call rejection deadlock):
- The 60s permission-bridge timeout already guarantees no infinite blockage on the *bridge*.
- The follow-up redirect is **enqueued asynchronously** — even if the agent's stop_reason is `cancelled`, the SessionManager loop pulls the next turn from queue and continues. No deadlock.
- If the agent's response after the redirect is `refusal` (model refuses to comply), the loop exits with `stopReason: refusal`. UI surfaces this as "Agent refused — please rephrase or abort."
- A 30s wallclock guard on `prompt()` execution: if no `sessionUpdate` arrives within 30s of `prompt()` call, emit a `warning` event "Agent did not respond — continue waiting or abort?". This is a UI hint, not a hard kill.

The existing `POST /api/scans/[id]/permission` endpoint also gains the optional `redirectInstruction`. When present and `approved=false`, it does the same enqueue — so the existing PermissionDialog and the new ToolCallPrompt share one server path.

---

## 3. Playbook system

### 3.1 Q2 RESOLVED — Manifest schema

**Decision: YAML, file extension `.obt-skill` to match proposal terminology and signal the data-only contract. Required fields enforced by Zod.**

Why YAML over JSON:
- Playbook prompt templates are multi-line Markdown. YAML's `|` literal block keeps them readable.
- Authoring audience = security engineers + LLM-power users; YAML is the dominant format in their world (GitHub Actions, Semgrep rules, Ansible).
- Parse cost is negligible: `yaml` package is already an indirect transitive dep of Drizzle. Add a top-level dep on `yaml@^2` (≈80kb) — justified.

Why `.obt-skill`:
- Matches the proposal's vocabulary.
- Signals "data-only manifest" (D2). A `.obt-playbook.json` would invite people to ship JS sidecars; the dot-extension says "skill manifest, not code".

#### Manifest Zod schema

```ts
// lib/playbooks/schema.ts
export const PlaybookManifestSchema = z.object({
  // identity
  name: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),     // semver, no pre-release
  description: z.string().min(10).max(500),

  // metadata (optional)
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  builtIn: z.boolean().default(false),               // first-party = trusted

  // parameter form
  parameters: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    label: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'enum', 'path-glob']),
    required: z.boolean().default(false),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    enumValues: z.array(z.string()).optional(),       // when type='enum'
    description: z.string().optional(),
  })).default([]),

  // scoping (optional — playbook may narrow scanners)
  scannerScope: z.object({
    enabled: z.array(z.enum(['gitleaks','trufflehog','semgrep','osv-scanner'])).optional(),
    semgrepRulesets: z.array(z.string()).optional(),
  }).optional(),

  // strategy (REQUIRED — this is what makes the playbook useful)
  promptTemplate: z.string().min(50),                 // the system prompt with {{param}} placeholders

  // optional reachability questions appended after the template
  reachabilityQuestions: z.array(z.string()).optional(),

  // compatibility
  minOpenSecurityVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
})

export type PlaybookManifest = z.infer<typeof PlaybookManifestSchema>
```

### 3.2 Discovery (REQ-PB-02)

```
Order of search (first match wins for same name+version):
  1. {workspace}/.obt/playbooks/*.obt-skill        — local override
  2. ~/.obt/playbooks/*.obt-skill                  — user global
  3. lib/playbooks/builtins/*.obt-skill            — first-party built-ins (5)
```

`lib/playbooks/loader.ts`:

```ts
export interface LoadedPlaybook {
  manifest: PlaybookManifest
  source: 'builtin' | 'user' | 'workspace'
  filePath: string
  trusted: boolean   // true iff source==='builtin' OR config.trustedPlaybooks includes name@version
}

export class PlaybookLoader {
  /** Discovers all playbooks across the 3 search paths. Idempotent. */
  async loadAll(workspaceRoot: string): Promise<LoadedPlaybook[]>
  /** Resolves `playbook:<name>@<version>` to a single playbook. Throws if not found. */
  resolve(strategy: string, workspaceRoot: string): Promise<LoadedPlaybook>
}
```

Path helpers extend `lib/config/workspace.ts`:

```ts
export function userPlaybooksDir(): string                                   // ~/.obt/playbooks
export function workspacePlaybooksDir(workspaceRoot: string): string         // {ws}/.obt/playbooks
export function builtinPlaybooksDir(): string                                // lib/playbooks/builtins
```

**Trust model (D2):**
- Built-ins → trusted, available out of the box.
- User-global and workspace playbooks → first-run trust prompt: "This playbook is from {source} and contains a system prompt. Inspect it before running. [Trust] [View source] [Cancel]". Trust state persists in `playbooks` DB table.
- No code execution in any case. The manifest is **data**.

### 3.3 Parameter interpolation

Same `{{var}}` engine as CVE-class templates (§1.5). Single function:

```ts
// lib/templates/interpolate.ts
export function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/{{(\w+)}}/g, (_, k) => {
    const v = vars[k]
    if (v == null) return ''
    return String(v)
  })
}
```

Parameters from the launch form merge with three reserved variables that every playbook gets for free: `{{repoRoot}}`, `{{repoEcosystems}}`, `{{repoFiles}}`. No nesting, no conditionals — keep templates dumb.

### 3.4 PlaybookStrategy

```ts
export class PlaybookStrategy implements ScanStrategy {
  readonly id = 'standard' as ScanModeId  // PlaybookStrategy reuses standard's stage flow

  constructor(private playbook: LoadedPlaybook, private params: Record<string, unknown>) {}

  async run(ctx: StrategyContext): Promise<StrategyResult> {
    // 1. Apply scannerScope to stage1 (if set)
    // 2. interpolate(playbook.manifest.promptTemplate, {...params, repoRoot: ctx.targetPath, ...})
    // 3. append reachabilityQuestions
    // 4. Delegate to OrchestratedStrategy with overridden prompt
  }
}
```

`selectStrategy(rawMode)` is widened — see §5.1.

### 3.5 Five built-in playbooks

Stored in `lib/playbooks/builtins/`. Each is researcher-mode focused, taint-analysis oriented:

| File | Goal | Key reachability questions |
|---|---|---|
| `audit-auth-surface.obt-skill` | Map every auth boundary | 1. Where does authentication start? 2. Which routes skip the middleware? 3. Are session tokens stored client-side? |
| `find-ssrf.obt-skill` | Hunt SSRF sinks | 1. Where do user URLs reach `fetch`/`http.request`? 2. Is the URL validated against an allowlist? 3. Is `localhost`/private IP rejected? |
| `pre-release-sweep.obt-skill` | Last-mile audit before deploy | 1. Any new dangerous functions added? 2. Did any new env var get default-true? 3. Were any auth checks removed? |
| `deserialization-sweep.obt-skill` | Find unsafe deserialization | 1. `JSON.parse` on remote bytes — is shape validated? 2. `pickle.loads`/`yaml.load` (unsafe) usage? 3. `node:vm` with user input? |
| `oauth-flow-review.obt-skill` | Check OAuth flow integrity | 1. Is `state` validated? 2. Is the redirect URI allowlisted? 3. PKCE used for public clients? |

Skeleton (concrete prompt text per file, not code). One example:

```yaml
# audit-auth-surface.obt-skill
name: audit-auth-surface
version: 1.0.0
description: Maps every authentication boundary and flags routes that skip middleware.
builtIn: true
tags: [auth, authorization, boundary-mapping]
parameters:
  - { name: routeGlob, label: Routes to scan, type: path-glob, required: false, default: "app/**/route.ts" }
scannerScope:
  enabled: [semgrep]
promptTemplate: |
  You are reviewing the authentication surface of a Next.js codebase rooted at {{repoRoot}}.
  Focus on routes matching {{routeGlob}}.

  Your job:
  1. Identify each auth entrypoint (login, signup, refresh, logout, OAuth callback).
  2. Identify each protected route and the middleware it depends on.
  3. Flag any route that is exposed but bypasses the middleware.
  4. Flag client-side-only auth checks (mark CRITICAL).

  Use READ tools only. Do not edit.
  When done, conclude with VERDICT_EXPOSED if any bypass was found, else VERDICT_NOT_EXPOSED.
reachabilityQuestions:
  - Are session tokens validated server-side on every request?
  - Are there routes returning sensitive data without an auth check?
  - Is RBAC enforced consistently across routes?
```

---

## 4. Secret Timeline

### 4.1 Q3 RESOLVED — Git log correlation strategy

**Decision: Option A — `git log -p -S '<secret-value>' --all -- <file>`. Store a SHA-256 hash of the secret in `finding_timelines.secret_hash`, never the raw value.**

Why:
- `git log -S` (pickaxe) finds all commits where the *number of occurrences of the literal string changed*. This is exactly the introducing-and-removing semantics we want.
- `-p` includes the diff so we can detect introduction (added line containing the secret) vs. removal (deleted line).
- Line-tracking (option B) is fragile across renames, refactors, and `git mv`. Rejected.
- Option C (hash-only search of git history) is impossible — git has no built-in hash search. Hashes are for **storage only**, not for the search.

Privacy:
- The DB never stores the raw secret.
- The on-disk `git log` output is held in memory only during derivation.
- We persist the introducing/removing commit SHAs and the *truncated* secret prefix (first 8 chars + ellipsis) for UI display.
- Full SHA-256 of the secret is stored in `finding_timelines.secret_hash` — used to detect "same secret reappearing in another file" in v0.4.

Exact command (with timeout, no shell):

```ts
// lib/timeline/git-log.ts
import { spawn } from 'node:child_process'

interface GitLogResult {
  introducingSha?: string
  introducingDate?: string
  introducingAuthor?: string
  introducingEmail?: string
  removingSha?: string
  removingDate?: string
  allCommits: Array<{ sha: string; date: string; author: string; email: string }>
  partial: boolean
  raw?: string
}

async function gitLogPickaxe(repoPath: string, file: string, secret: string): Promise<GitLogResult> {
  const args = [
    'log',
    '-p',
    '--all',
    '--no-merges',
    `-S${secret}`,                         // pickaxe — note no space
    '--format=%H%x09%aI%x09%an%x09%ae',    // SHA \t ISO-date \t name \t email
    '--',
    file,
  ]
  // 60s timeout, kill on timeout, parse stdout chunk-by-chunk
}
```

Notes:
- `--all` covers branches, not just `HEAD`.
- `--no-merges` skips merge commits — they don't introduce content.
- `-S<secret>` uses literal pickaxe (not regex; we don't want to escape).
- The 60s wallclock kills the process; `partial: true` is set if killed.

### 4.2 Introducing vs. last-seen detection

For each commit returned by pickaxe, parse the diff:
- Hunk with `+secret` (added line) → that commit *introduced or re-introduced* the secret.
- Hunk with `-secret` (removed line) → that commit *removed* the secret.

The **introducing commit** = the *earliest* (by `authoredAt`) commit with a `+secret` hunk.
The **removing commit** = the *latest* commit with a `-secret` hunk that is newer than the introducing commit AND has no later `+secret` hunk in any later commit. If the secret is still present in the working tree → no removing commit (still exposed).

Exposure window = `removingCommit.date - introducingCommit.date` (or `now - introducingCommit.date` if still exposed).

### 4.3 Suspected deploys heuristic (Q4 RESOLVED)

**Decision: Configurable per repo, with sensible defaults. v0.3 ships defaults; per-repo override stays in `.obt/config.json`.**

Default deploy-branch globs: `main`, `master`, `release/*`, `production`.

Algorithm:
```
1. Get the merge base history of `main`/`master` between introducingDate and (removingDate ?? now).
2. Count commits where:
   - First-parent of HEAD-of-deploy-branch
   - `authoredAt` ∈ exposure window
   - Excludes the introducing commit itself
3. That count = suspectedDeploys.
```

**Always labeled "suspected"** in the UI (D5). Tooltip: "Estimated by counting first-parent commits to {branch} during the exposure window. Real deploy data requires CI/CD integration (v1.0)."

If neither `main` nor `master` exists → `suspectedDeploys = 0` (REQ-ST-03).

Per-repo override (future): `.obt/config.json` → `secretTimeline.deployBranches: string[]`. Read in `getDeployBranches(workspaceRoot, config)`. v0.3 honors this if present but does not surface a UI yet.

### 4.4 DB shape (Q decided)

**One new table `finding_timelines`. No JSON column on findings.** Reasoning:
- The timeline has a one-to-many child relationship (`finding → many commits`). JSON column would force per-row JSON parse on every UI render and forbid commit-level queries.
- A child table `secret_timeline_events` would make a 1:N:N (finding → timeline → events). Three tables for one feature is overkill given v0.3 doesn't query individual events except through the parent.
- Compromise: `finding_timelines` row stores the summary (introducing, removing, exposureMs, suspectedDeploys, partial) **plus a JSON `commits` column** holding the detailed commit array. Best of both: indexable summary + structured detail.

```ts
// lib/db/schema.ts (additions)
export const findingTimelines = sqliteTable('finding_timelines', {
  id: text('id').primaryKey(),                                  // findingId (FK)
  findingId: text('finding_id').notNull().references(() => findings.id),
  secretHash: text('secret_hash').notNull(),                    // SHA-256 hex
  secretPreview: text('secret_preview').notNull(),              // first 8 chars + …
  introducingSha: text('introducing_sha'),
  introducingDate: text('introducing_date'),
  introducingAuthor: text('introducing_author'),
  introducingEmail: text('introducing_email'),
  removingSha: text('removing_sha'),
  removingDate: text('removing_date'),
  exposureMs: integer('exposure_ms'),                            // null if still exposed
  suspectedDeploys: integer('suspected_deploys').notNull().default(0),
  deployBranches: text('deploy_branches').notNull(),             // JSON: [{name, sha, date}]
  commitsJson: text('commits_json').notNull(),                   // JSON: GitLogResult.allCommits
  partial: integer('partial', { mode: 'boolean' }).notNull().default(false),
  computedAt: text('computed_at').notNull(),
})
```

`findings.timeline_computed_at` (REQ-SS-03) is set when derivation completes. Set to `NULL` whenever a later scan touches the same `locationPath` — invalidates the cache.

### 4.5 Timeline UI data shape

API: `GET /api/findings/[id]/timeline` returns:

```ts
interface TimelineResponse {
  findingId: string
  secret: { type: string; preview: string }                      // never the raw value
  introducing?: { sha: string; date: string; author: string; email: string; message?: string }
  removing?:    { sha: string; date: string; author: string; email: string; message?: string }
  exposureWindow: { start: string; end: string | null; durationMs: number | null }
  suspectedDeploys: number
  deployBranches: Array<{ name: string; sha: string; date: string }>
  commits: Array<{ sha: string; date: string; author: string; email: string; isOnDeployBranch: boolean }>
  partial: boolean
  rotationDraft: { slack: string; githubIssue: string }          // pre-filled text
}
```

`rotationDraft` is computed server-side using a fixed template (REQ-ST-05). Pre-fills the user's clipboard or opens a `https://github.com/.../issues/new?title=...&body=...` URL. Never auto-sends.

---

## 5. Database schema additions

### 5.1 Migration shape (additive only)

`drizzle/000X_v03_*.sql` — one migration per concern:

```sql
-- 000X_hunt_targets.sql
CREATE TABLE hunt_targets (
  scan_id TEXT PRIMARY KEY REFERENCES scans(id),
  raw_input TEXT NOT NULL,
  resolved_id TEXT NOT NULL,
  source TEXT NOT NULL,                  -- 'osv'|'ghsa'
  advisory_raw TEXT,                     -- JSON
  cve_class TEXT NOT NULL,
  verdict TEXT,                          -- 'exposed'|'not-exposed'|'indeterminate'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 000X_scan_forks.sql
CREATE TABLE scan_forks (
  id TEXT PRIMARY KEY,
  parent_scan_id TEXT NOT NULL REFERENCES scans(id),
  child_scan_id TEXT NOT NULL REFERENCES scans(id),
  fork_at_event_id INTEGER NOT NULL,     -- references scan_events.id of parent
  created_at TEXT NOT NULL
);
CREATE INDEX scan_forks_parent_idx ON scan_forks(parent_scan_id);
CREATE INDEX scan_forks_child_idx  ON scan_forks(child_scan_id);

-- 000X_playbooks.sql                    (user-installed only; built-ins are file-only)
CREATE TABLE playbooks (
  id TEXT PRIMARY KEY,                   -- name@version
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,                  -- 'workspace'|'user'
  file_path TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  trusted INTEGER NOT NULL DEFAULT 0,    -- boolean
  installed_at TEXT NOT NULL,
  UNIQUE(name, version, source)
);

-- 000X_finding_timelines.sql            (see §4.4)

-- 000X_findings_timeline_col.sql
ALTER TABLE findings ADD COLUMN timeline_computed_at TEXT;
ALTER TABLE findings ADD COLUMN verdict TEXT;          -- new: cve-hunter findings have verdict
```

### 5.2 `scans.strategy` widening (REQ-SS-02)

`scans.scanMode` (existing) is already `text` with no DB CHECK constraint. The widening is **type-level only**:

```ts
// lib/pipeline/strategies/types.ts
export type ScanModeId =
  | 'quick' | 'standard' | 'intermediate' | 'paranoid'   // existing
  | 'hunt'                                                // new
  | `playbook:${string}@${string}`                        // template-literal type for compile-time safety
```

`normalizeScanMode()` is updated to accept the new variants without warning. `selectStrategy(mode, ctx)` becomes async to support playbook resolution:

```ts
export async function selectStrategy(
  mode: ScanModeId,
  ctx: { workspaceRoot: string; huntTarget?: HuntTarget; playbookParams?: Record<string, unknown> },
): Promise<ScanStrategy> {
  switch (true) {
    case mode === 'quick':                  return new QuickStrategy()
    case mode === 'standard':               return new StandardStrategy()
    case mode === 'intermediate':           return new OrchestratedStrategy('intermediate')
    case mode === 'paranoid':               return new OrchestratedStrategy('paranoid')
    case mode === 'hunt':                   return new HuntStrategy(ctx.huntTarget!)
    case mode.startsWith('playbook:'): {
      const pb = await new PlaybookLoader().resolve(mode, ctx.workspaceRoot)
      return new PlaybookStrategy(pb, ctx.playbookParams ?? {})
    }
    default: throw new Error(`Unknown scan mode: ${mode}`)
  }
}
```

### 5.3 `scan_events` new types

The schema is unchanged (text `type` column). New literals supported:
- `user_injection` — `{ scanId, text, timestamp }`
- `plan_edit` — `{ scanId, steps: PlanStep[], timestamp }`
- `tool_call_rejected` — `{ scanId, requestId, redirectInstruction?, timestamp }`
- `fork_point` — `{ parentScanId, forkAtEventId, newScanId }`

All four added to the `scanEventSchema` Zod discriminated union in `lib/pipeline/events.ts`. Existing readers ignore unknown types (forward-compatible per proposal D).

---

## 6. Q4 RESOLVED — Fork checkpoint storage

**Decision: Option B — Copy events 1..N to the new scan's `scan_events` with `payload.is_replay = true`. Then start fresh ACP session and stream live events from N+1.**

Why not A (in-memory replay on every read):
- Replay is needed every time the user opens the forked scan page. In-memory replay forces re-reading the parent scan's full event log on every page load. The parent could be archived, deleted, or have its events compacted. Brittle.

Why not C (virtual reference + UI-time merge):
- UI complexity explodes — the SSE stream would have to merge two sources. Fork-of-fork compounds the problem.
- Forensics: the user can edit the original scan (by adding new events through their own console interactions on it, since original is *not* modified by the fork). UI-time merge would need to filter edits made after the fork point. Invariant violation risk.

Why B:
- Each scan owns its full event history. SSE replay logic is unchanged. Fork-of-fork is just another copy.
- Storage cost: events are small JSON blobs. 500 events × 5KB avg = 2.5MB per fork — acceptable. We can revisit at v1.0 with event compaction if it becomes a concern.

Schema: `scan_events.payload` is already `text` (JSON). Replay events get a marker:

```json
{ "...originalPayload...", "_meta": { "is_replay": true, "from_scan_id": "<parent>", "from_event_id": <orig_id> } }
```

Fork procedure:

```
POST /api/scans/[id]/fork  body: { atEventId: number, newPrompt?: string }

1. Validate atEventId exists for scanId.
2. INSERT scans { id: <new>, projectId: <copied>, parentId: <orig>, scanMode: <copied>, prompt: newPrompt ?? <copied>, status: 'pending' }.
3. INSERT scan_forks { parentScanId, childScanId, forkAtEventId: atEventId }.
4. SELECT events FROM scan_events WHERE scanId=<orig> AND id <= atEventId ORDER BY id.
5. INSERT each event into scan_events with newScanId, payload merged with _meta.is_replay=true.
6. INSERT scan_events { scanId: <new>, type: 'fork_point', payload: { parentScanId, forkAtEventId, newScanId } }
7. Kick off scan as normal — runner starts in 'running' state, picks up newPrompt.
```

The new scan's ACP session is fresh. The parent's history is *seeded as user-turn context* in the kickoff prompt:

```
Previous investigation context (from parent scan up to event #N):
{condensed transcript of user-relevant events: response, plan, findings, user_injections}

Continue the investigation from this point. New focus: {newPrompt or "continue as before"}.
```

This realizes D4 (proposal): forks are "new investigations seeded with parent's history", not deterministic replays.

---

## 7. Component architecture

```
components/ui/
  console/
    InvestigationConsole.tsx     — chat input pinned to the bottom of /scans/[id]
    PlanEditor.tsx               — overlay on PlanBlock; per-step edit + send-update
    ToolCallPrompt.tsx           — appears on permission_request; Approve / Reject (with redirect)
    TimelineScrubber.tsx         — horizontal scrubber over scan_events; click = fork-point candidate
    ForkButton.tsx               — opens Fork dialog with new prompt input
  hunt/
    HuntPage.tsx                 — /hunt page; CVE input, live transcript
    VerdictBadge.tsx             — exposed/not-exposed/indeterminate pill
  playbook/
    PlaybookSelector.tsx         — grid of playbooks at scan launch
    PlaybookParamForm.tsx        — auto-generated form from manifest.parameters
    PlaybookTrustDialog.tsx      — first-run trust prompt for non-builtin playbooks
  timeline/
    SecretTimelineView.tsx       — full page on /findings/[id]/timeline
    TimelineSidebar.tsx          — finding detail collapsible panel
```

State + rendering rules:
- `InvestigationConsole` consumes the existing SSE stream + a local `pendingTurns: Turn[]` array (optimistic UI).
- `PlanEditor` is a **modal overlay** triggered from `PlanBlock`'s "Edit" button. Keeps the existing PlanBlock unchanged (additive).
- `ToolCallPrompt` replaces the existing PermissionDialog when `OBT_CONSOLE_V2=1`. Falls back to PermissionDialog when flag off (proposal D6).
- `TimelineScrubber` reads `scan_events` via the SSE stream, indexed by event id. Click → opens `ForkButton`'s dialog with `atEventId` pre-filled.
- `SecretTimelineView` is a **server component** (Next 16 RSC). Fetches `/api/findings/[id]/timeline` server-side, renders directly. The "Request Rotation" buttons are client islands.
- `PlaybookParamForm` generates inputs dynamically: `string` → `<input>`, `number` → `<input type=number>`, `enum` → `<select>`, `path-glob` → `<input>` with placeholder, `boolean` → `<input type=checkbox>`. All fields use `react-hook-form` + Zod resolver derived from the manifest.

Feature flag: every component above is mounted only when `process.env.NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`. The flag also gates the API endpoints — they return 404 when off.

---

## 8. ADRs (decision log)

| ID | Decision | Rationale | Rejected | Risk |
|---|---|---|---|---|
| ADR-1 | Mid-session injection = serialized `connection.prompt()` calls via PendingTurnQueue | Only entry point in ACP SDK 0.21.0; matches protocol's "user message" semantics; no new transport invented | (b) scan_events sidechannel — agent unaware; (c) permission channel — wrong direction; (d) DB poll — latency tax | Sequential turns serialize all interactions — UI must show "agent is thinking, your message will be next" |
| ADR-2 | Playbook manifest = YAML, `.obt-skill` extension, Zod-validated | YAML reads multi-line prompts cleanly; community familiarity; data-only contract | JSON (worse for prompts); JS modules (executable surface = security debt) | YAML parser must be hardened against billion-laughs / aliasing; use `yaml` package safe mode |
| ADR-3 | Secret correlation = `git log -p -S '<secret>'`; store SHA-256 hash + 8-char preview | Exact semantics for introduction/removal; no raw secret in DB; survives renames | Line-tracking (B) — fragile; hash-only history search (C) — impossible | Pickaxe is O(history × file size); 60s timeout + partial result for large repos |
| ADR-4 | Fork = full event copy with `is_replay` marker | Each scan self-contained; replay logic unchanged; fork-of-fork trivial | In-memory replay (A) — brittle; virtual reference (C) — UI complexity | Storage cost 2-5MB/fork — acceptable; revisit with compaction at v1.0 |
| ADR-5 | CVE-class mapping = static CWE map + keyword fallback | Deterministic; no extra LLM call; ~85% coverage from CWE alone | LLM classifier — adds latency, non-determinism, cost; advisory tags — too sparse | Templates may underfit novel CVE classes; generic fallback is the safety net |
| ADR-6 | Tool-call rejection redirect = `bridge.resolveRequest(false)` + `queue.enqueue(redirect)` | Reuses existing permission bridge; redirect is a normal user turn; no deadlock by construction | Sync redirect (would block bridge); separate `redirect` RPC (no SDK support) | If agent's stop_reason after redirect is `refusal`, UI must surface clearly |
| ADR-7 | Single timeline table with summary cols + JSON commits | One fast indexable row per finding; details available without join | 3-table N:N:N — overkill; JSON column on `findings` — unindexable | Migration cost minor; future v0.4 features may pull commits into a child table for finer queries |
| ADR-8 | One template engine (`{{var}}` regex replace) shared by Hunter + Playbooks | One rule, no surprises; trivial to reason about; no dep added | Handlebars — overkill; Mustache — adds dep; eval — security disaster | Templates can't express conditionals; if needed in v0.4, replace with a vetted lib |
| ADR-9 | All console endpoints persist `scan_events` BEFORE forwarding to ACP | Audit trail survives ACP failures; matches REQ-IC-06; consistent shape across 5 endpoints | Forward-then-persist — losing audit on agent crash | A successful persist + failed forward is shown to the UI as "delivered to log, not to agent — retry?" |
| ADR-10 | Feature flag `OBT_CONSOLE_V2` gates all UI + API additions | Lets us dogfood before opening; safe rollback | Always-on — no abort lever | Config drift — must document the flag in release notes; test both states |

---

## 9. Cross-cutting concerns

### 9.1 SSE compatibility
All four new event types pass through the existing SSE pipeline unchanged. They are added to the `scanEventSchema` discriminated union; old clients that don't know them simply ignore them (default branch in the SSE consumer's switch). Forward-compatible.

### 9.2 Replay parity (proposal success criterion 5)
Replay parity = "if I open `/scans/[id]` after a server restart, the UI shows exactly the events that happened." With the new event types persisted *before* forwarding (§2.2), replay continues to work. The fork case (B above) writes events directly into `scan_events` so they replay just like agent-emitted events.

### 9.3 Egress test (success criterion 10)
A new vitest `tests/egress/no-stray-network.test.ts` runs under `nock`-style allowlist of: `api.osv.dev`, `api.github.com` (GHSA), provider hosts, optional GitHub PR/Issue creation when user clicks. Any other domain hit → test failure.

### 9.4 Performance budgets
- 500-event scan first paint < 500ms: existing ScanProgress already handles this; adding 4 event types adds at most ~5 lines of switch — no regression.
- Scrubber drag < 50ms: `TimelineScrubber` virtualizes events; only `id+type+timestamp` rendered, full payload lazy-loaded on hover.
- Injection round-trip < 2s: dominated by ACP agent latency; the queue/serialization adds <5ms.

### 9.5 Cancellation semantics
Existing `signal.aborted` handling in SessionManager is preserved. New code:
- `PendingTurnQueue.drain(scanId)` is called inside the existing abort branch, rejecting any awaiting `next()` so the `prompt()` loop exits.
- `permission-bridge.rejectAllForScan(scanId)` continues to be called before SIGTERM.

---

## 10. What this design does NOT decide

These remain task-level choices for sdd-tasks / sdd-apply:
- Exact wire format of plan-edit user-turn (which prefix sentence, formatting of step status)
- Which Tailwind classes / motion library used by `TimelineScrubber`
- Whether the `egress` test uses MSW, nock, or vitest's request interceptor
- File layout inside `components/ui/console/` (e.g. one barrel file vs index re-exports)
- Specific Zod refinements on `huntTarget` regex (the high-level pattern `CVE-\d+-\d+` is decided; tightenings are task-level)
- Whether the trust prompt is a modal or a banner — a UX call left for tasks/apply

These are deliberately deferred to keep design at the architectural level.

---

## Result Contract

- status: done
- executive_summary: Strategy-pattern extension — HuntStrategy + PlaybookStrategy plug into existing `selectStrategy()`; Investigation Console serializes user turns through a per-scan PendingTurnQueue feeding the existing `connection.prompt()`; Secret Timeline is derived data via `git log -S` cached in a single `finding_timelines` table.
- artifacts: `sdd/v0.3/design` (engram), `openspec/changes/v0.3/design.md`
- next_recommended: `sdd-tasks`
- risks: ACP `prompt()` serialization may surprise users expecting interrupts; YAML parser hardening is a must; pickaxe slow on huge histories (60s cap mitigates); fork storage grows linearly with parent event count; CWE map coverage gap for novel advisory classes.
- skill_resolution: none
