# Design: v0.2 — Diff Mode + Watch Mode + SARIF Export

**Status:** Draft
**Phase:** Prevent (Phase 3 of 4)
**Depends on:** v0.1 (parent_id, dedup_key, import graph, branch-per-finding patch generator)
**Reads:** sdd/v0.2/proposal, sdd/v0.2/spec
**Working tree:** `/Users/none/Documents/trabajo/NearDev/github/open-security`

---

## 0. Architectural posture (one paragraph)

v0.2 does not introduce a new pipeline. It adds **(a) one new ScanStrategy variant (`diff`)** that narrows stage 1's file set, **(b) one new event source (`webhook receiver`)** that enqueues into the existing runner, **(c) one new clock (`watchman` cron, hosted in Next.js 16 `instrumentation.ts`)**, and **(d) two pure transformers (`SARIF emit`, `SARIF ingest`)** plugged in as a serializer and a peer scanner adapter respectively. Every other v0.1 invariant — `parent_id`, `dedup_key`, queue ordering, branch-per-finding — survives unchanged. The change is **additive at the schema, the strategy registry, and the integration boundary**; nothing in `runner.ts`, `stage0–stage5`, or `selectStrategy()` is rewritten.

---

## 1. Resolved decisions (Q1–Q5 from the spec + 5 from proposal)

### D1 — Q1: Webhook tunnel — **smee.io as default + manual trigger as fallback (option d)**

**Decision.** Bundle `smee-client` (npm, MIT, ~50 KB, single dependency: `eventsource`) as the default tunnel. Ship a `bun run tunnel` helper that:
1. Reads `webhook_secret` and `webhook_proxy_url` from `repos.id`;
2. If no proxy URL, generates one via `https://smee.io/new` (one HTTP POST);
3. Spawns a long-lived `SmeeClient` that pipes `EventSource` from smee into a local fetch to `http://localhost:3000/api/webhooks/github`.

A manual trigger button "Simulate PR scan" lives at `/repos/[id]` for the offline path (no tunnel, no GitHub) — it accepts a base ref + head ref and synthesizes the same `WebhookEvent` the real receiver would enqueue.

**Rejected alternatives.**
- **(a) smee only** — leaves users with corporate proxies blocking smee.io with no way out.
- **(b) ngrok** — requires account, paid tier for stable URL, NOT local-first because traffic flows through ngrok-corp servers (same risk as smee but with vendor lock-in and a registration wall).
- **(c) manual only** — kills the "PR comment in 30s" demo and violates success criterion #1.
- **cloudflared** — proposal mentions it; we **document** it as an advanced path in the README but do not bundle it. Self-hosted tunnels are an opt-in expert path, not the default.

**Rationale.** smee.io is owned by the `octokit` org (GitHub-adjacent OSS), uses **only HTTPS + EventSource**, the relay is stateless (no payload storage), and the user's `webhook_secret` makes intercepted relay traffic worthless without the secret. Fintech/health/defense users who refuse smee get the manual trigger plus documented cloudflared path. This satisfies success criterion #7 ("tunnel docs verified by non-author <10min").

---

### D2 — Q2: Cron placement — **`instrumentation.ts` + `node-cron`**

**Decision.** Use Next.js 16's `instrumentation.ts` as the single boot hook. On `register()`, dynamically import `lib/watch/scheduler.ts`, which uses `node-cron` to register one job per `(repo_id)` with `watch_enabled = true`. The scheduler is a singleton bound to `globalThis.__obtScheduler` to survive Next.js HMR in dev.

**Rejected alternatives.**
- **(a) `setInterval` in route segment** — fires only after first request to the route, dies on segment HMR, no per-repo cron expressions.
- **(c) raw `node-cron` from a startup file** — Next.js doesn't have one; that's exactly what `instrumentation.ts` *is*.
- **(d) external crontab** — violates local-first install simplicity (adds an OS-level setup step), and fails on Windows + macOS power-saving sleep.
- **(e) sidecar `bun run watch` process** — adds an ops surface; users forget to start it. Single-process is the install promise.

**File pattern.**

```
instrumentation.ts                            ← Next.js 16 boot hook
lib/watch/scheduler.ts                        ← node-cron host, singleton
lib/watch/run-watch-scan.ts                   ← worktree fetch + enqueue + delta
lib/watch/notify/index.ts                     ← Notifier interface
lib/watch/notify/desktop.ts                   ← node-notifier impl
lib/watch/notify/slack.ts                     ← fetch POST impl
lib/watch/coalesce.ts                         ← per-repo 5min Slack rate limiter
```

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startScheduler } = await import('@/lib/watch/scheduler')
  await startScheduler()
}
```

```ts
// lib/watch/scheduler.ts
import cron from 'node-cron'
import { listWatchedRepos } from '@/lib/repos/repos.repo'
import { runWatchScan } from './run-watch-scan'

declare global {
  // eslint-disable-next-line no-var
  var __obtScheduler: { jobs: Map<string, cron.ScheduledTask> } | undefined
}

export async function startScheduler(): Promise<void> {
  if (globalThis.__obtScheduler) return // HMR-safe
  const state = { jobs: new Map<string, cron.ScheduledTask>() }
  globalThis.__obtScheduler = state

  const repos = await listWatchedRepos()
  for (const r of repos) registerRepo(r)
}

export function registerRepo(r: { id: string; watchInterval: string }): void {
  const state = globalThis.__obtScheduler!
  state.jobs.get(r.id)?.stop()
  const task = cron.schedule(r.watchInterval, () => runWatchScan(r.id), {
    timezone: 'UTC',
  })
  state.jobs.set(r.id, task)
}

export function unregisterRepo(repoId: string): void {
  const job = globalThis.__obtScheduler?.jobs.get(repoId)
  job?.stop()
  globalThis.__obtScheduler?.jobs.delete(repoId)
}
```

The repo settings UI calls `registerRepo` / `unregisterRepo` via a server action immediately after persisting `watch_enabled` toggles — no restart required.

**Concurrency guard.** `runWatchScan` acquires an advisory lock by inserting a `(repo_id, branch)` row into a `watch_locks` table with a 5-minute TTL; collision → no-op + `console.warn`. This satisfies "Collision skips cron scan" scenario.

---

### D3 — Q3: SARIF fingerprint — **emit two fingerprint keys (option c)**

**Decision.** Emit:

```jsonc
"partialFingerprints": {
  "obt/v0.1/dedupKey": "<sha256 of detector|location_path|title>",
  "obt/sarif/primaryLocationLineHash": "<sha256 of ruleId|uri|lineContentNormalized>"
}
```

GitHub's SARIF ingester uses **the most stable fingerprint it recognises** to dedupe results across uploads. Per SARIF 2.1.0 §3.27.16, fingerprint keys are tool-defined and multiple are allowed. Our **canonical app key** (`obt/v0.1/dedupKey`) makes round-tripping `obt → SARIF → obt` lossless (ingest reads it back if present). The **standard-ish key** (`obt/sarif/primaryLocationLineHash` — a SHA-256 of `ruleId|uri|trim(line text)`) survives line-drift on GitHub's side because it ignores `startLine`.

**Rejected alternatives.**
- **(a) dedup_key only** — moves a detected vulnerability to a different line → GitHub treats it as "new + old fixed", causing alert flicker on every refactor.
- **(b) SARIF-line-hash only** — same finding renamed/moved across files → no longer matches → alert flicker on rename.

**Why two.** The two keys serve different consumers. One is "this is the same logical issue per us"; the other is "this is the same physical issue per a code-scanning tool". GitHub picks whichever it understands; round-trip ingest uses ours.

---

### D4 — Q4: Notification delivery — **`node-notifier` + Slack webhook (option d, both)**

**Decision.** Use `node-notifier` (npm, MIT, ~80 KB, vendored helpers per platform) for desktop notifications, and a plain `fetch` POST to a user-provided Slack incoming webhook for chat. No additional dependency for Slack.

**Rejected alternatives.**
- **(a) `node-notifier` only** — fails for headless / SSH-only / server-side installs and Linux servers without a desktop session.
- **(b) shell-out to `terminal-notifier`/`notify-send`** — `node-notifier` is literally a wrapper around those binaries with cross-platform fallback (incl. Windows + WSL). Wrapping it ourselves is reinventing the wheel without portability.
- **(c) Slack only** — ignores the offline solo-dev demo path.

`node-notifier` is the only new desktop dep. Slack uses native `fetch`. Total new deps for notification: 1.

**Notifier interface.**

```ts
// lib/watch/notify/index.ts
export interface Notification {
  repoId: string
  repoName: string
  scanId: string
  newFindings: number
  topSeverity: Severity
  url: string
}

export interface Notifier {
  readonly id: 'desktop' | 'slack'
  send(n: Notification): Promise<void>
}

export function getNotifiers(channels: Array<'desktop' | 'slack'>): Notifier[] { … }
```

**Coalescing.** A `notification_log(repo_id, channel, sent_at)` table records each successful send. Slack notifier consults this and short-circuits if `sent_at + 5min > now()`; deferred notifications are merged on the next tick into a single "N new findings since X" message. Desktop is not rate-limited (OS already coalesces).

---

### D5 — Q5 (proposal Q5): Apply-fix conflict UX — **fail-fast + manual regenerate**

**Decision.** Re-fetch `head_sha` of the PR branch immediately before commit. If `current_head_sha !== scan.head_sha`, return HTTP 409 with body `{ error: "stale", current_head_sha, scan_head_sha, regenerate_url: "/api/scans/<id>/rescan" }`. The PR comment then surfaces a "Regenerate fix on latest commit" link.

**Rejected.** Auto-rebase is dangerous: the divergent commit could *itself* be security-relevant, and an automated rebase-and-apply could overwrite a manual fix the developer just pushed. Refusing-on-stale is correct safety behaviour, with low UX cost (one click).

---

### D6 — Diff Mode 1-hop expansion — **use v0.1 import graph; fallback to changed-files-only**

**Decision.** Depend on the v0.1 import graph (proposal §7 lists it as a hard dep). If it's unavailable for the `(repo, head_sha)` pair (cache miss + initial build cost > 5s budget), **fall back to scanning changed files only** and emit a warning event `import_graph_unavailable`. No new graph builder is shipped in v0.2.

**Rejected.**
- **(b) `ts-morph`/`ast-grep` at scan time** — adds 30–60s for medium repos, blowing the 30s budget on cold cache. New heavy dependency.
- **(c) regex `import` matcher** — fragile (misses dynamic imports, re-exports, barrels), high false-negative rate.
- **(d) skip 1-hop entirely** — proposal explicitly promises "changed_files ∪ 1-hop callers" as the differentiator (Decision D1 in proposal); skipping it would gut the value prop.

If v0.1 ships without the graph, scope must be re-cut (per proposal §7).

---

## 2. Webhook architecture

### 2.1 Topology

```
GitHub.com
  │  POST <smee.io/abcXYZ>  (with X-Hub-Signature-256)
  ▼
smee.io (stateless relay)
  │  EventSource over HTTPS (long-poll)
  ▼
SmeeClient inside `bun run tunnel`  (user's machine)
  │  POST http://localhost:3000/api/webhooks/github
  ▼
Next.js route handler
  ├─ verify HMAC-SHA256 against repo's webhook_secret
  ├─ INSERT INTO webhook_events (status='pending')   ← durability
  ├─ HTTP 202                                        ← <3s budget
  └─ setImmediate(() => processWebhookEvent(eventId))
                  │
                  ▼
            Drain loop (one in flight)
                  │
                  ├─ resolve PR #N → fetch changed_files via Octokit
                  ├─ create scan row with strategy='diff', parent_id, base/head sha
                  ├─ enqueue runPipeline(...)
                  └─ on completion → post PR comment if net-new > 0
```

### 2.2 Why a `webhook_events` table (durability over in-memory queue)

A bare `setImmediate` queue is **lost on process restart**. A `webhook_events` table costs one INSERT + one UPDATE per webhook and survives restart cleanly. The drain loop is just `SELECT … WHERE status='pending' ORDER BY received_at LIMIT 1`. This matches the local-first invariant ("no daemon"): SQLite *is* the queue. v0.1 already uses SQLite as the source of truth for scans, so this is consistent.

### 2.3 Signature validation (constant-time)

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyGithubSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

The route handler reads the **raw body** (not the parsed JSON) — Next.js 16 App Router exposes this via `await req.text()` before any JSON parse.

### 2.4 The 3-second budget

The route handler does only: read body → resolve repo by `delivery target_url` path segment → look up secret → verify HMAC → INSERT → respond 202. No GitHub API calls, no scan launch on the request thread. This is bounded by SQLite write latency (~1ms) and stays well under 3s even at p99.

---

## 3. Cron architecture

Already described in D2. One additional file to highlight:

```
lib/watch/run-watch-scan.ts
```

```ts
export async function runWatchScan(repoId: string): Promise<void> {
  const repo = await getRepo(repoId)
  if (!repo.watchEnabled) return

  // Advisory lock — collision skip
  const acquired = await acquireWatchLock(repoId, repo.defaultBranch)
  if (!acquired) {
    console.warn(`[watch] skip ${repoId}@${repo.defaultBranch}: another scan in flight`)
    return
  }

  try {
    // Worktree isolation — never touch user's working copy
    const worktree = path.join(OBT_ROOT, 'worktrees', repoId, repo.defaultBranch)
    await ensureWorktree(repo.localPath, repo.defaultBranch, worktree)
    await fetchAndCheckout(worktree, repo.defaultBranch)

    const parent = await getMostRecentCompletedScan(repoId, repo.defaultBranch)
    const scanId = await createScan({
      projectId: repo.projectId,
      strategy: parent ? 'diff' : 'standard',
      parentId: parent?.id ?? null,
      baseSha: parent?.headSha ?? null,
      headSha: await readHeadSha(worktree),
    })

    await runPipelineAndWait(scanId, worktree)

    if (parent) {
      const delta = await computeDelta(parent.id, scanId)
      if (delta.length === 0) return
      await dispatchNotifications(repo, scanId, delta)
    }
  } finally {
    await releaseWatchLock(repoId, repo.defaultBranch)
  }
}
```

**Worktree pattern.** `git worktree add <isolated_path> <branch>` is run once on first watch; subsequent runs are `git -C <worktree> fetch + checkout`. This keeps each branch's state isolated from the user's checkout and from sibling branches, satisfying the "user working copy untouched" scenario.

---

## 4. Diff Mode scan pipeline

### 4.1 Strategy registration

```ts
// lib/pipeline/strategies/types.ts — additive
export type ScanModeId = 'quick' | 'standard' | 'intermediate' | 'paranoid'
export type ScanStrategyId = ScanModeId | 'diff'   // ← NEW

export interface StrategyContext {
  scanId: string
  workspaceRoot: string
  targetPath: string
  classicalFindings: NormalizedFinding[]
  stage0Stack: string[]
  prompt?: string | null
  scanMode: ScanModeId
  llmProvider: ProviderClient | undefined
  onEvent: (event: ScanEvent) => void
  isAborted: () => boolean
  // ─── NEW for diff ────────────────────────────────────────
  diffContext?: {
    baseSha: string
    headSha: string
    changedFiles: string[]   // paths relative to repo root
  }
}
```

```ts
// lib/pipeline/strategies/diff.ts — NEW
export class DiffStrategy implements ScanStrategy {
  readonly id = 'diff' as const
  async run(ctx: StrategyContext): Promise<StrategyResult> {
    if (!ctx.diffContext) throw new Error('DiffStrategy requires diffContext')
    // The runner has already passed a *narrowed* classicalFindings set
    // (stage 1 received the narrowed file list — see §4.2).
    // Diff mode delegates LLM/validate/filter/patch unchanged to standard.
    return new StandardStrategy().run(ctx)
  }
}
```

The strategy itself is thin. **The narrowing happens earlier**, inside a wrapped stage 1.

### 4.2 Stage 1 narrowing

```ts
// lib/pipeline/runner.ts — surgical change
const narrowed = strategy.id === 'diff'
  ? expandWithImportGraph(ctx.diffContext.changedFiles, projectId, ctx.diffContext.headSha, publish)
  : undefined

const stage1 = await runStage1Classical({
  scanId,
  targetPath,
  onEvent: publish,
  // ─── NEW ────────────────────────────────────────────────
  scopeFiles: narrowed,        // when set, scanners receive only these
  skipScanners: strategy.id === 'diff' ? ['osv'] : [],
})
```

#### How each scanner is scoped

| Scanner | File-scoped invocation |
|---|---|
| `gitleaks` | `gitleaks detect --source <root> --redact -f json --report-path <out> --no-git --paths-from-stdin` (use `--paths-from-stdin` to feed narrowed list) |
| `trufflehog` | Run per-file: `trufflehog filesystem <file> --json` collected via `Promise.all` over narrowed list (chunked, max 8 concurrent) |
| `semgrep` | `semgrep --config auto --json <file1> <file2> …` — accepts file list as positional args |
| `osv-scanner` | **Skipped** in diff scope (REQ-DM-02). Manifest changes are caught by full Watch scans. |

The `skipScanners` array is honoured inside `runStage1Classical` by filtering `buildScanners(...)` before `Promise.allSettled`.

### 4.3 Import graph integration

```ts
// lib/pipeline/diff/expand.ts — NEW
export function expandWithImportGraph(
  changedFiles: string[],
  projectId: string,
  headSha: string,
  onEvent: (e: ScanEvent) => void,
): string[] {
  const graph = readImportGraphCache(projectId, headSha) // v0.1 helper
  if (!graph) {
    onEvent({ type: 'progress', message: 'import_graph_unavailable; scanning changed files only' })
    return changedFiles
  }
  const callers = new Set<string>(changedFiles)
  for (const f of changedFiles) {
    for (const c of graph.callersOf(f)) callers.add(c)
  }
  return [...callers]
}
```

### 4.4 Hard timeout (REQ-DM-02 scenario "Hard timeout enforced")

The runner already supports `isAborted()`. We add a `setTimeout(25_000, () => abort())` registered immediately after stage 0 finishes, only when `strategy === 'diff'`. On abort, the scan row is updated with `status='timeout'` and a `'progress'` event is emitted — the runner's existing abort path handles the rest.

---

## 5. SARIF schema & types

### 5.1 Emit — Zod schema (only fields we emit)

```ts
// lib/export/sarif/schema.ts — NEW
import { z } from 'zod'

const ToolDriver = z.object({
  name: z.literal('open-security'),
  semanticVersion: z.string(),
  informationUri: z.string().url().optional(),
  rules: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    shortDescription: z.object({ text: z.string() }).optional(),
    fullDescription: z.object({ text: z.string() }).optional(),
    helpUri: z.string().url().optional(),
  })),
})

const Result = z.object({
  ruleId: z.string(),
  level: z.enum(['none', 'note', 'warning', 'error']),
  message: z.object({ text: z.string() }),
  locations: z.array(z.object({
    physicalLocation: z.object({
      artifactLocation: z.object({ uri: z.string() }),
      region: z.object({
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1).optional(),
      }),
    }),
  })),
  partialFingerprints: z.record(z.string(), z.string()),
  properties: z.object({
    'obt/severity': z.enum(['critical','high','medium','low','info']),
    'obt/detector': z.string(),
    'obt/dedupKey': z.string(),
    'obt/scanId': z.string(),
    'obt/exploitability': z.number().optional(),
  }).passthrough(),
})

export const SarifLog = z.object({
  $schema: z.literal('https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json'),
  version: z.literal('2.1.0'),
  runs: z.array(z.object({
    tool: z.object({ driver: ToolDriver }),
    results: z.array(Result),
  })),
})
export type SarifLog = z.infer<typeof SarifLog>
```

The `GET /api/scans/[id]/sarif` route builds this object, `SarifLog.parse()` validates it (REQ-SE-01 scenario "Validation failure returns 500"), and serialises with `JSON.stringify`.

### 5.2 Severity mapping (emit & ingest)

| Internal | SARIF emit `level` | SARIF ingest `level` → internal |
|---|---|---|
| `critical` | `error` | (no source) |
| `high` | `error` | `error` → `high` |
| `medium` | `warning` | `warning` → `medium` |
| `low` | `note` | `note` → `low` |
| `info` | `none` | `none` → `info` |
| (missing on ingest) | n/a | default → `medium` |

### 5.3 Ingest — field mapping

| SARIF path | findings column | Notes |
|---|---|---|
| `result.ruleId` | `title` | trimmed to 200 chars |
| `result.message.text` | `description` | preserved verbatim |
| `result.level` | `severity` | via the table above |
| `result.locations[0].physicalLocation.artifactLocation.uri` | `location_path` | URI scheme stripped if `file://` |
| `result.locations[0].physicalLocation.region.startLine` | `location_line_start` | required; ingest fails the result if missing |
| `result.locations[0].physicalLocation.region.endLine` | `location_line_end` | optional |
| `result.partialFingerprints["obt/v0.1/dedupKey"]` | `dedup_key` (if present) | preferred — round-trip lossless |
| (otherwise) | `dedup_key` | computed = `sha256(detector|location_path|title)` |
| `tool.driver.name` | `detector` | prefixed: `sarif-import:<name>` |
| `properties["obt/exploitability"]` | `exploitability` | optional, falls back to 0 |

Stream-parse with `stream-json` (new dep, MIT, ~70 KB) — buffers `runs[].results[]` element-by-element to avoid OOM on 50k-finding CodeQL imports. Hard cap at 10,000 items.

### 5.4 Ingest as a peer scanner

```ts
// lib/scanners/sarif.ts — NEW (implements existing Scanner interface)
export function scanSarifFile(path: string): Promise<ScannerResult> { ... }
```

This means SARIF-imported findings flow through the **same** stage 2 dedup + stage 3 validate + stage 4 filter as native findings — exactly as the proposal D4 specifies ("peer scanner adapter on ingest, serializer on emit"). No new pipeline branch.

---

## 6. GitHub API integration

### 6.1 Endpoints used

| Operation | Method + path | Purpose |
|---|---|---|
| Resolve PR head | `GET /repos/{owner}/{repo}/pulls/{number}` | confirm head_sha at apply-fix time |
| List changed files | `GET /repos/{owner}/{repo}/pulls/{number}/files?per_page=100` | populate diff context (paginated; cap 300 files) |
| Post comment | `POST /repos/{owner}/{repo}/issues/{number}/comments` | initial findings comment |
| Update comment (idempotency) | `PATCH /repos/{owner}/{repo}/issues/comments/{commentId}` | retry-safe |
| List comments | `GET /repos/{owner}/{repo}/issues/{number}/comments` | find existing marker (`<!-- obt:scan:{scanId} -->`) |
| Read tree blob (apply-fix) | `GET /repos/{owner}/{repo}/contents/{path}?ref={head_sha}` | base64-decode current file |
| Create blob | `POST /repos/{owner}/{repo}/git/blobs` | upload patched content |
| Create tree | `POST /repos/{owner}/{repo}/git/trees` | tree based on head + new blob |
| Create commit | `POST /repos/{owner}/{repo}/git/commits` | parent = head_sha, tree = new tree |
| Update ref | `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` | fast-forward branch to new commit |
| Upload SARIF | `POST /repos/{owner}/{repo}/code-scanning/sarifs` | gzip+base64; v0.2 ships UI button only, no auto-upload |

### 6.2 Auth

GitHub PAT is stored via the existing `lib/config/store.ts` config table (encrypted with the same AES-256-GCM scheme as provider keys, not in the `repos` table — REQ-GP-03). At call time:

```ts
const cfg = readConfig()
const token = cfg.providers.githubToken
if (!token) throw new HttpError(424, 'github_token_missing')
```

We add `githubToken: z.string().optional()` to `lib/config/schema.ts` (delta against v0.1 schema). No new client library: a minimal typed `fetch` wrapper at `lib/integrations/github/client.ts` is enough — Octokit (~1 MB) is overkill for these 11 endpoints.

### 6.3 Rate limit handling

```ts
async function ghFetch(path: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, withAuth(init))
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    const wait = Math.min(reset - Date.now(), 60_000)
    if (attempt < 3) {
      await sleep(wait)
      return ghFetch(path, init, attempt + 1)
    }
  }
  if (res.status === 403 && /secondary rate limit/i.test(await res.clone().text())) {
    const wait = Math.min(2_000 * 2 ** attempt, 30_000)
    if (attempt < 3) {
      await sleep(wait)
      return ghFetch(path, init, attempt + 1)
    }
  }
  return res
}
```

Three retries max, exponential backoff capped at 30s, then a clean 503 surfaced upward (the comment step is failed but the scan stays `done`, per REQ-GP-04 scenario "Scan status unaffected by comment failure").

### 6.4 Apply-fix flow (re-fetch + commit)

```
1. GET pulls/{n}                       → currentHeadSha
2. if currentHeadSha !== scan.headSha  → 409 stale
3. GET contents/{path}?ref=headSha     → fileBlob
4. apply patch_diff (unified) to fileBlob → newContent
5. POST git/blobs (newContent)         → blobSha
6. POST git/trees (base=headSha, mods=[{path, sha=blobSha, mode='100644'}])
                                       → treeSha
7. POST git/commits (parents=[headSha], tree=treeSha,
                     message="security: <finding.title>\n\n[obt scan {scanId}]")
                                       → commitSha
8. PATCH refs/heads/{branch} (sha=commitSha, force=false)
                                       → success or 422 if non-FF
9. PATCH issues/comments/{markerCommentId} (append "✅ Fix applied at <commitSha>")
```

Step 8 is **non-force** by construction (parent = current head), so conflict windows are tiny — only a push between step 1 and step 8 fails it, which is exactly the "stale" case we already gate. We retry once with a fresh head re-fetch before surfacing 422.

---

## 7. Watch Mode state machine

```
                ┌──────────┐
       cron ───►│ candidate│
                └────┬─────┘
                     │ acquireWatchLock?
              ┌──────┴──────┐
           no │             │ yes
              ▼             ▼
            skip       ┌────────┐
            (warn)     │fetching│
                       └───┬────┘
                           │ git fetch + checkout (worktree)
                           ▼
                       ┌────────┐
                       │scanning│
                       └───┬────┘
                           │ runPipelineAndWait
                           ▼
                       ┌──────────┐
                       │computing │
                       │  delta   │
                       └──┬───────┘
                          │ findings_dedup_keys(child) − findings_dedup_keys(parent)
                  ┌───────┴───────┐
              empty│               │non-empty
                   ▼               ▼
                noop          ┌────────┐
                              │matching│   severity floor + repo-level rate limit
                              └───┬────┘
                                  │
                                  ▼
                              ┌────────┐
                              │notify  │   per-channel notifier with coalescing
                              └────────┘
```

### 7.1 Persistence — what is stored

- `watch_locks (repo_id, branch, acquired_at)` — TTL 5 min, no separate row needed beyond this.
- `notification_log (id, repo_id, channel, sent_at, scan_id, finding_count)` — drives the 5-minute Slack coalescer and the digest fallback.
- **No "baseline" table.** The baseline is **always** the most recent completed scan for `(repo_id, branch)`, by `parent_id` chain. This honours D3 of the proposal: one source of truth.

### 7.2 Delta computation

```sql
SELECT child.id AS finding_id, child.dedup_key
FROM findings child
WHERE child.scan_id = :child_scan_id
  AND child.fp_filtered = 0
  AND NOT EXISTS (
    SELECT 1 FROM findings parent
    WHERE parent.scan_id = :parent_scan_id
      AND parent.fp_filtered = 0
      AND parent.dedup_key = child.dedup_key
  )
```

A single SQL statement; no denormalisation. `dedup_key` is the new column added in v0.1 (proposal §7).

### 7.3 Notification trigger

```ts
function shouldNotify(delta: Finding[], repo: Repo): boolean {
  const floor = repo.notifySeverityFloor ?? 'high'
  return delta.some(f => severityRank(f.severity) >= severityRank(floor))
}
```

Where `severityRank` is `info=0, low=1, medium=2, high=3, critical=4`.

---

## 8. Database schema additions for v0.2

All additive, no breaking changes. One Drizzle migration `0002_v02_diff_watch_sarif.sql`.

### 8.1 `scans` (existing table — column adds)

| Column | Type | Default | Note |
|---|---|---|---|
| `strategy` | TEXT NOT NULL | `'standard'` | matches REQ scan-schema delta |
| `base_sha` | TEXT | NULL | diff scans only |
| `head_sha` | TEXT | NULL | diff + watch scans |
| `pr_number` | INTEGER | NULL | diff scans only |
| `pr_comment_id` | TEXT | NULL | for idempotent comment update |
| `pr_comment_status` | TEXT | NULL | `'pending'\|'posted'\|'failed'\|'updated'` |

`parent_id` already exists in v0.1 (`scans.parentId`). Reused.

### 8.2 `repos` (NEW table — first time we have repo-as-first-class entity)

| Column | Type | Note |
|---|---|---|
| `id` | TEXT PK | uuid |
| `project_id` | TEXT FK projects.id NOT NULL | one project may have multiple repo references in v1.0; for v0.2 1:1 |
| `name` | TEXT NOT NULL | e.g. `octocat/hello-world` |
| `local_path` | TEXT NOT NULL | absolute path to clone |
| `default_branch` | TEXT NOT NULL DEFAULT `'main'` | |
| `watch_enabled` | INTEGER NOT NULL DEFAULT 0 | boolean |
| `watch_interval` | TEXT NOT NULL DEFAULT `'0 */6 * * *'` | cron expr |
| `notify_channels` | TEXT NOT NULL DEFAULT `'[]'` | JSON `Array<'desktop'\|'slack'>` |
| `notify_severity_floor` | TEXT NOT NULL DEFAULT `'high'` | |
| `slack_webhook_url_ref` | TEXT | reference into encrypted secret store, NOT plaintext |
| `webhook_secret_ref` | TEXT | reference into encrypted secret store, NOT plaintext |
| `webhook_proxy_url` | TEXT | smee.io URL or other |
| `created_at` | TEXT NOT NULL | iso |

### 8.3 `webhook_events` (NEW)

| Column | Type | Note |
|---|---|---|
| `id` | TEXT PK | uuid |
| `repo_id` | TEXT FK repos.id NOT NULL | |
| `delivery_id` | TEXT NOT NULL UNIQUE | GitHub `X-GitHub-Delivery` — dedupe replays |
| `event` | TEXT NOT NULL | `pull_request`, `push`, … |
| `action` | TEXT | `opened`, `synchronize`, … |
| `payload` | TEXT NOT NULL | raw JSON |
| `status` | TEXT NOT NULL DEFAULT `'pending'` | `pending\|processing\|done\|failed\|skipped` |
| `received_at` | TEXT NOT NULL | iso |
| `processed_at` | TEXT | iso |
| `scan_id` | TEXT FK scans.id | NULL until scan created |
| `error` | TEXT | last error if status=failed |

Index `(status, received_at)` for the drain loop.

### 8.4 `watch_locks` (NEW)

| Column | Type | Note |
|---|---|---|
| `repo_id` | TEXT NOT NULL | |
| `branch` | TEXT NOT NULL | |
| `acquired_at` | TEXT NOT NULL | TTL 5min, expired rows ignored |
|  | PRIMARY KEY (repo_id, branch) | |

### 8.5 `notification_log` (NEW)

| Column | Type | Note |
|---|---|---|
| `id` | INTEGER AUTOINC PK | |
| `repo_id` | TEXT NOT NULL | |
| `channel` | TEXT NOT NULL | `desktop\|slack` |
| `scan_id` | TEXT FK scans.id NOT NULL | |
| `finding_count` | INTEGER NOT NULL | |
| `sent_at` | TEXT NOT NULL | |

Index `(repo_id, channel, sent_at DESC)` for the coalescer lookup.

### 8.6 `findings` (existing — column adds for dedup carry-over)

`dedup_key TEXT` is **assumed already added by v0.1** (proposal §7). v0.2 does not add it again. It does add an index:

```sql
CREATE INDEX findings_scan_dedup_idx ON findings(scan_id, dedup_key);
```

This index makes the delta query in §7.2 a fast index-merge join.

---

## 9. Component architecture (UI)

### 9.1 New routes

| Route | Purpose |
|---|---|
| `/repos` | list of repos with watch status, last scan, severity badge |
| `/repos/[id]/settings` | watch toggle, schedule (cron picker), notify channels, severity floor, webhook setup wizard, manual trigger button |
| `/repos/[id]/webhook` | wizard: shows generated smee URL + curl test command + GitHub instructions, copy-to-clipboard |
| `/scans/[id]/sarif-import` (drop zone modal) | accepts `.sarif` / `.sarif.json` via `react-dropzone` (already a dep), streams to `POST /api/scans/[id]/sarif-import` |

### 9.2 New API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/webhooks/github` | POST | webhook receiver |
| `/api/repos` | GET, POST | list, create |
| `/api/repos/[id]` | GET, PATCH | detail, update settings (re-registers cron job) |
| `/api/repos/[id]/scan` | POST | manual trigger (synthesises a webhook event) |
| `/api/scans/[id]/sarif` | GET | SARIF emit |
| `/api/scans/[id]/sarif-import` | POST | SARIF ingest |
| `/api/findings/[id]/apply-fix-to-pr` | POST | the fix commit flow |

### 9.3 Component additions (`components/`)

```
components/
  repos/
    RepoList.tsx              ← table of repos with watch state
    RepoSettingsForm.tsx      ← all the watch knobs
    WebhookWizard.tsx         ← the 4-step setup
    CronPicker.tsx            ← human-friendly cron expr editor
    NotifyChannelToggle.tsx
  sarif/
    SarifImportDropzone.tsx   ← react-dropzone wrapper
    SarifExportButton.tsx     ← downloads /api/scans/[id]/sarif
  pr/
    PrCommentPreview.tsx      ← shows what the PR comment will look like (for testing)
```

The repo settings page is a single server component that renders `RepoSettingsForm`, which is a client component using a server action `updateRepoSettings(repoId, partial)`. The action calls `registerRepo` / `unregisterRepo` from §1.D2 immediately after the DB write — no restart needed for cron changes.

---

## 10. New dependencies — final tally + justification

| Package | Size | License | Why this and not something we have? |
|---|---|---|---|
| `smee-client` | ~15 KB | MIT | Tunnel default; the only library that speaks smee.io — but smee.io itself is the chosen tunnel |
| `node-cron` | ~30 KB | ISC | Cron expression parser + scheduler; we're not writing one |
| `node-notifier` | ~80 KB | MIT | Cross-platform desktop notifications; we're not vendoring per-OS bins ourselves |
| `stream-json` | ~70 KB | BSD-3 | Stream parse 50k+ SARIF results without OOM; native JSON.parse cannot |

**Not added (justified rejections):**
- `octokit` — 11 endpoints with native fetch is ~80 lines; saves >1 MB
- `ngrok` / `cloudflared` SDKs — opt-in expert path, documented not bundled
- `ts-morph` / `ast-grep` — v0.1 import graph is the source of truth; rebuilding here is duplication
- `crontab-parser` — `node-cron`'s schedule already validates; one less dep

---

## 11. Risks & mitigations specific to the design

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `instrumentation.ts` runs twice in dev (HMR) | M | L | Singleton on `globalThis.__obtScheduler` |
| smee.io outage | L | H | Detect EventSource error, surface "tunnel disconnected" banner; manual trigger remains; cloudflared documented |
| Apply-fix conflict between steps 1 and 8 | L | M | Single retry with fresh head re-fetch, then surface 422 |
| 50k-finding SARIF bombs DB | L | H | Streaming parse + 10k cap (REQ-SI-03) |
| `node-notifier` needs `terminal-notifier` brew install on macOS | M | L | First-run wizard surfaces missing helper; falls back to desktop=Slack-only |
| Worktree on case-insensitive FS (macOS APFS-CI / WSL) collides with main checkout for case-only branch names | L | L | Worktree paths are sha-ed: `~/.obt/worktrees/<repoId>/<sha8(branch)>` |
| Drizzle migration takes lock during running scan | L | M | Migration runs at app boot in `instrumentation.ts` BEFORE scheduler, ahead of any scan |

---

## 12. Test surfaces (preview, full plan in tasks phase)

Vitest, `node` environment unless noted.

| Surface | What |
|---|---|
| `lib/integrations/github/sign.test.ts` | HMAC-SHA256 with a fixture payload from GitHub docs, including timing-equal mismatch |
| `lib/watch/scheduler.test.ts` | Register/unregister, HMR re-init no-op, lock collision skip |
| `lib/watch/coalesce.test.ts` | 5-min Slack window, deferred merge into digest |
| `lib/pipeline/strategies/diff.test.ts` | `diffContext` required, narrowed file set, osv skipped, 25s timeout |
| `lib/export/sarif/emit.test.ts` | Schema validates, dual fingerprint, severity mapping, empty results |
| `lib/scanners/sarif.test.ts` | CodeQL fixture ingest, 10k cap, malformed → 422, round-trip dedup_key preserved |
| `app/api/webhooks/github/route.test.ts` | 401 missing/invalid sig, 202 valid, 202 non-PR-event, idempotency by `delivery_id` |
| `app/api/findings/[id]/apply-fix-to-pr/route.test.ts` | 409 stale, 400 no patch, 200 happy path with mocked octokit |

---

## 13. Open questions deferred to tasks phase

These are implementation-detail level, not architectural. They go to sdd-tasks not back to spec:

1. Exact cron-picker UX (presets vs free-form). Defer.
2. Whether `notification_log.finding_count` should also store severity histogram. Default no; revisit if dashboards request it.
3. Whether `webhook_events.payload` is gzipped in SQLite. Default no; SQLite handles 100KB JSON cells fine.

---

## 14. Summary — what changes vs. v0.1

| Layer | Touched? |
|---|---|
| `runner.ts` orchestration order | NO — only narrowed inputs and a 25s timeout for diff |
| `selectStrategy()` | YES — adds `'diff'` |
| Stage 0/2/3/4/5 | NO — pure pass-through |
| Stage 1 | YES (additive) — `scopeFiles?` and `skipScanners?` parameters |
| `scans` schema | YES (additive) — 6 columns (`strategy`, `base_sha`, `head_sha`, `pr_number`, `pr_comment_id`, `pr_comment_status`) |
| `findings` schema | NO new columns; one new index on `dedup_key` |
| New tables | `repos`, `webhook_events`, `watch_locks`, `notification_log` |
| New routes | 7 API + 4 page routes |
| New deps | 4 (smee-client, node-cron, node-notifier, stream-json) |
| `instrumentation.ts` | NEW (boots scheduler) |

The blast radius is contained. A reviewer can read `instrumentation.ts` + `selectStrategy()` + the new migration and have the whole architecture in their head in five minutes.
