# Tasks: open-security v0.1 MVP

> Artifact store: hybrid | TDD: Strict (RED → GREEN per task pair)
> Each [TEST] task must be committed and failing before its paired implementation task begins.
> [PARALLEL] marks tasks within a phase that can run concurrently.
> Spec: engram #266 | Design: engram #267

---

## Phase 0 — Bootstrap (sequential)

- [x] **0.1** — Install runtime deps via bun: `drizzle-orm better-sqlite3 simple-git yauzl js-yaml zod ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google @ai-sdk/ollama eventsource-parser commander`. Verify `bun.lock` updated.
- [x] **0.2** — Install dev deps: `drizzle-kit @types/better-sqlite3 @types/yauzl @types/js-yaml`. No test.
- [x] **0.3** — Add `@/lib` → `./lib` and `@/components` → `./components` path aliases to `tsconfig.json`. Run `tsc --noEmit` → zero errors.
- [x] **0.4** — Edit `next.config.ts`: add `serverExternalPackages: ['better-sqlite3']`. No test.
- [x] **0.5** — Create `drizzle.config.ts`: schema `lib/db/schema.ts`, out `drizzle/`, driver `better-sqlite3`, dbCredentials `.obt/db.sqlite`. No test.
- [x] **0.6** — Update `package.json` scripts: `db:generate`, `db:migrate`, `db:studio`; add `obt` bin entry pointing to `bin/obt.ts`. No test.
- [x] **0.7** — Add `.obt/` to `.gitignore` (keep `.obt/.gitkeep`). Create `lib/config/store.ts` skeleton that lazy-creates `.obt/workspaces/` and `.obt/reports/` on first call. No test.

---

## Phase 1 — Security & Config Foundation

- [x] **1.1 [TEST]** — Write `tests/security/path-guard.test.ts`: assert `assertUnder` throws on `../` escape, `/etc/passwd`, absolute outside root; assert passes for valid sub-path. Run → RED.
- [x] **1.2** — Implement `lib/security/path-guard.ts`: `assertUnder(root, p)` — `path.resolve` both, `startsWith(root + path.sep)`, throw `PathTraversalError`. Run 1.1 → GREEN.
- [x] **1.3 [TEST]** — Write `tests/security/redact.test.ts`: assert API key patterns, Bearer tokens, PAT-shaped strings replaced with `[REDACTED]`; non-secret strings unchanged. Run → RED.
- [x] **1.4** — Implement `lib/security/redact.ts`: `redact(input: string): string` via regex patterns for AWS keys, Bearer tokens, generic API key shapes. Run 1.3 → GREEN.
- [x] **1.5 [TEST]** — Write `tests/config/store.test.ts`: assert write/read round-trip, file mode is `0o600`, `getPublicConfig()` has no raw key values (presence-only), missing file returns defaults. Run → RED.
- [x] **1.6** — Implement `lib/config/schema.ts` (zod `ObtConfig` with models per stage + provider key flags), `lib/config/store.ts` (full: read/write `.obt/config.json`, chmod 600 after write, zod-parse on read, `getPublicConfig` presence-only). Run 1.5 → GREEN.
- [x] **1.7 [TEST]** — Write `tests/config/prereqs.test.ts`: mock PATH lookup; assert returns `{ git: "ok", gitleaks: "missing" }` for partial presence. Run → RED.
- [x] **1.8** — Implement `lib/config/prereqs.ts`: check git, gitleaks, semgrep, trufflehog, osv-scanner via `execFileSync(['which', tool])` array-form. Run 1.7 → GREEN.
- [x] **1.9** — Implement `lib/api/envelope.ts` (`ok<T>`, `fail`, `paginated` factory helpers) and `lib/api/errors.ts` (typed codes INVALID_INPUT, NOT_FOUND, CONFLICT, INTERNAL, each with `toResponse() → NextResponse`). Covered by Phase 10 route tests.

---

## Phase 2 — Database (sequential)

- [x] **2.1 [TEST]** — Write `tests/db/schema.test.ts`: run migrate against in-memory SQLite; assert all 7 tables exist; assert indexes on `findings(scan_id, severity)`, `findings(scan_id, fp_filtered)`, `commits(scan_id, authored_at)`. Run → RED.
- [x] **2.2** — Implement `lib/db/schema.ts` (Drizzle tables: projects, scans, findings, commits, authors, reports, config with all fields from design §2), `lib/db/client.ts` (singleton better-sqlite3), `lib/db/migrate.ts` (runs committed SQL on startup). Run `drizzle-kit generate` → commit SQL under `drizzle/`. Run 2.1 → GREEN.
- [x] **2.3 [TEST]** — Write `tests/repos/projects.repo.test.ts`, `scans.repo.test.ts` (insert, findById, updateStatus, cursor list), `findings.repo.test.ts` (insert, findByScanId paginated + severity filter, update falsePositive, delete), `commits.repo.test.ts` (upsert), `authors.repo.test.ts` (upsert), `reports.repo.test.ts` — all against in-memory SQLite. Run → RED.
- [x] **2.4** — Implement all 6 repos under `lib/repos/`: `projects.repo.ts`, `scans.repo.ts`, `findings.repo.ts` (cursor pagination, filter by severity/fpFiltered), `commits.repo.ts`, `authors.repo.ts`, `reports.repo.ts`. Run 2.3 → GREEN.

---

## Phase 3 — Provider Abstraction

- [x] **3.1** — Define `lib/providers/index.ts`: `ProviderClient` interface (`id`, `capability: { stream, tools, json }`, `streamScan`), `ScanOpts`, `ProviderEvent` union (token | tool_call | final | error). Pure types, no test.
- [x] **3.2 [TEST]** — Write `tests/providers/parsers.test.ts` with fixture stdout strings for `claude-stream-json`, `json-event-stream`, `plain`; assert correct `ProviderEvent` sequence including `final` and `error` cases. Run → RED.
- [x] **3.3** — Implement CLI path: `lib/providers/cli/agents.ts` (AGENT_DEFS: claude, codex, gemini, opencode, qwen, cursor-agent, ollama — port from open-design), `cli/resolve.ts` (`resolveOnPath` + capability probe), `cli/spawn.ts` (array-form `child_process.spawn`, no shell), `cli/parsers/claude-stream-json.ts`, `json-event-stream.ts`, `plain.ts`. Run 3.2 → GREEN.
- [x] **3.4 [TEST]** — Write `tests/providers/api.test.ts`: mock `streamText`; assert factory selects correct `@ai-sdk/*` by provider id; assert token events forwarded as `ProviderEvent`; auth error → `{ type: 'error' }`. Run → RED.
- [x] **3.5** — Implement API path: `lib/providers/api/factory.ts` (select `@ai-sdk/*` by id, read key from config store), `api/stream.ts` (wrap `streamText` → `AsyncIterable<ProviderEvent>`). Run 3.4 → GREEN.
- [x] **3.6** — Implement `lib/providers/stage-routing.ts`: `getProviderForStage(stage)` reads `config.models.{stage}` (format `cli:<id>` or `api:<provider>:<model>`), returns correct `ProviderClient`. Write `tests/providers/stage-routing.test.ts`. RED then GREEN.

---

## Phase 4 — Source Ingestion

- [x] **4.0 [TEST]** — Write `tests/security/zip.test.ts` with fixture ZIPs: zip-slip entry → `PathTraversalError`; symlink entry → rejected; compressed > 200 MB → size error; > 50k entries → count error; valid ZIP → all files under target dir. Run → RED (before impl).
- [x] **4.1** — Implement `lib/sources/zip.ts`: yauzl lazyEntries, reject symlinks (`(attrs >>> 16) & 0o170000 === 0o120000`), reject path traversal via `assertUnder`, cap MAX_COMPRESSED 200 MB + MAX_ENTRIES 50k + MAX_EXTRACTED 2 GB, delete partial files on abort. Run 4.0 → GREEN.
- [x] **4.2 [TEST]** — Write `tests/sources/github.test.ts`: mock `simple-git`; assert PAT injected via git env (not URL), clone target `.obt/workspaces/{scanId}/repo/`, invalid PAT → API-friendly error with PAT redacted. Run → RED.
- [x] **4.3** — Implement `lib/sources/github.ts` (PAT via `credential.helper` env, simple-git clone, path-guard on dest) and `lib/sources/gitlab.ts` (same pattern, generic remote fallback for self-hosted). Run 4.2 → GREEN.
- [x] **4.4 [TEST]** — Write `tests/sources/local.test.ts`: assert path-guard rejects `/etc`, `/sys`, `/proc` and accepts valid home subpath. Run → RED.
- [x] **4.5** — Implement `lib/sources/local.ts` (assertUnder, `fs.cp` to workspace). Run 4.4 → GREEN.

## Phase 5 — Classical Scanners (tasks 5.1–5.5 parallel within phase)

- [x] **5.1 [TEST]** — Write `tests/scanners/gitleaks.test.ts` with fixture JSON; assert normalized finding has `ruleId`, `severity: "high"`, `source: "gitleaks"`, `falsePositive: false`; binary absent → `{ status: "skipped", reason: "binary not found" }`. Run → RED.
- [x] **5.2** — Implement `lib/scanners/gitleaks.ts`: check binary via prereqs, spawn `[bin, "detect", "--source", dir, "--report-format", "json", "--no-git"]` array argv, parse JSON → canonical `Finding`. Run 5.1 → GREEN.
- [x] **5.3 [TEST]** — Write `tests/scanners/trufflehog.test.ts` (verified cred → `confidence: 0.95`, absent → skipped) and `semgrep.test.ts` (SQLi → `source: "semgrep"`, `ruleId` matches rule id). Run → RED.
- [x] **5.4** — Implement `lib/scanners/trufflehog.ts` (spawn `--json --no-update`) and `lib/scanners/semgrep.ts` (spawn `--json -c p/default`). Run 5.3 → GREEN.
- [x] **5.5 [TEST]** — Write `tests/scanners/osv-scanner.test.ts`: CVSS 9.5 → `severity: "critical"`, CVSS 3.0 → `severity: "low"`. Run → RED.
- [x] **5.6** — Implement `lib/scanners/osv-scanner.ts` (spawn json output, CVSS → severity map: 9–10 critical, 7–8.9 high, 4–6.9 medium, 0.1–3.9 low). Run 5.5 → GREEN.

---

## Phase 6 — Git History Forensics (sequential)

- [x] **6.1 [TEST]** — Write `tests/git/history-walker.test.ts` with a programmatically-created fixture bare repo (5 commits in test setup); assert async generator yields 5 `CommitRecord` objects; assert `commit-diff.ts` makes no `git.show` call until invoked explicitly. Run → RED.
- [x] **6.2** — Implement `lib/git/history-walker.ts` (async generator, `git log --all --full-history --numstat`), `lib/git/commit-diff.ts` (lazy `git.show(sha)`), `lib/git/author-stats.ts` (accumulator → `AuthorProfile` with anomaly flags). Run 6.1 → GREEN.
- [x] **6.3 [TEST]** — Write `tests/detectors/secret-in-history.test.ts` (diff with AWS key → `ruleId: "secret-in-history"`, SHA in metadata), `suspicious-commit.test.ts` ("password" in message → `severity: "medium"`), `author-anomaly.test.ts` (external domain → `ruleId: "author-anomaly"`, `severity: "low"`). Run → RED.
- [x] **6.4** — Create `detectors/secret-in-history/SKILL.md`, `suspicious-commit/SKILL.md`, `author-anomaly/SKILL.md` (frontmatter: id/title/stages/severity matrix, LLM prompt template, validation prompt, FP heuristics); implement `lib/detectors/loader.ts` (YAML frontmatter parser) and `lib/detectors/types.ts`. Run 6.3 → GREEN.

---

## Phase 7 — Scan Pipeline (sequential)

- [x] **7.1 [TEST]** — Write `tests/pipeline/scan-bus.test.ts`: multiple subscribers receive same event; reconnect replays last 100 events; `destroy(scanId)` cleans up bus entry. Run → RED.
- [x] **7.2** — Implement `lib/pipeline/events.ts` (zod `ScanEvent` union: stage | progress | finding | error | done) and `lib/pipeline/scan-bus.ts` (per-scan EventEmitter map, bounded 256 buffer, drop `progress` before `finding`/`error`/`done`). Run 7.1 → GREEN.
- [x] **7.3 [TEST]** — Write `tests/pipeline/stages.test.ts`: stub `ProviderClient`; run stage0→stage2 against fixture workspace; assert DB rows created; assert IPC events emitted in order; assert stage1 skips missing binary without failing pipeline. Run → RED.
- [x] **7.4** — Implement `lib/pipeline/stage0-prep.ts` (workspace creation, source dispatch), `stage1-classical.ts` (`Promise.allSettled` parallel scanners), `stage2-llm.ts` (detector × file with `p-limit(4)`, stream findings via `process.send`), `stage3-validate.ts`, `stage4-filter.ts` (apply `policies/fp-filter.yaml`), `stage5-patch.ts`. Run 7.3 → GREEN.
- [x] **7.5** — Implement `lib/pipeline/worker.ts` (fork entry, stage sequencing, `process.send(event)`, SIGTERM handler + SIGKILL after 5s) and `lib/pipeline/orchestrator.ts` (fork, wire ScanBus, DB write per IPC event, mark `failed` on restart). No separate test — covered by 7.3 integration + 14.1 E2E.
- [x] **7.6 [TEST]** — Write `tests/pipeline/sse.test.ts`: assert SSE route returns `text/event-stream`; reconnect replays last 100 events from DB; heartbeat event fires at 15s with fake timers. Run → RED.
- [x] **7.7** — Implement `app/api/scans/[id]/stream/route.ts`: `ReadableStream` + ScanBus subscription, 15s heartbeat, replay from DB on connect, drop `progress` on buffer overflow. Run 7.6 → GREEN.

---

## Phase 8 — Remaining Detector SKILL.md Bundles & Policies [PARALLEL within phase]

- [x] **8.1 [PARALLEL]** — Write `detectors/sqli/SKILL.md`, `detectors/xss/SKILL.md`, `detectors/ssrf/SKILL.md`, `detectors/path-traversal/SKILL.md`. Each: frontmatter (id, stages, severity matrix), classical pre-pass hint, LLM prompt template, validation prompt, FP heuristics.
- [x] **8.2 [PARALLEL]** — Write `detectors/command-injection/SKILL.md`, `detectors/insecure-deserialization/SKILL.md`, `detectors/auth-bypass/SKILL.md`, `detectors/crypto-misuse/SKILL.md`, `detectors/dep-vuln-context/SKILL.md`. Same structure as 8.1.
- [x] **8.3** — Write `policies/severity.yaml`, `policies/confidence.yaml`, `policies/fp-filter.yaml`; implement `lib/policies/loader.ts` (YAML → zod-validated object, cached after first load); implement `lib/detectors/loader.ts` (YAML frontmatter parser); updated `lib/detectors/types.ts` with title, stages, classical_prepass fields. Write `tests/policies/loader.test.ts` (5 tests GREEN) and `tests/detectors/loader.test.ts` (4 tests GREEN).
- [x] **8.4** — Write `tests/unit/scanners/bearer.test.ts` (5 tests RED then GREEN); implement `lib/scanners/bearer.ts` (injectable spawn + binary check, exit code 0/1 semantics, severity mapping: critical/high/medium/low/warning→low).

---

## Phase 9 — Report Export (parallel per format)

- [x] **9.1 [TEST]** — Write `tests/reports/md.test.ts` (fixture 3 findings → `report.md` has 3-row table + relative links to `findings/{id}.md`, each detail file has mermaid block + ```` ```diff ```` fences). Run → RED.
- [x] **9.2** — Implement `lib/reports/md.ts` (root report + per-finding files, relative cross-links, mermaid dataflow, patch diff). Run 9.1 → GREEN.
- [x] **9.3 [TEST]** — Write `tests/reports/sarif.test.ts`: critical → `"error"`, info → `"note"`, valid SARIF 2.1.0 shape; `tests/reports/csv.test.ts`: 10 findings → 11 lines (header + data), correct column order. Run → RED.
- [x] **9.4** — Implement `lib/reports/json.ts` (`{ scan, findings }`), `lib/reports/sarif.ts` (SARIF 2.1.0, severity map), `lib/reports/csv.ts` (9-column flat: id, title, severity, confidence, filePath, lineStart, source, validated, falsePositive). Run 9.3 → GREEN.

---

## Phase 10 — API Routes

- [ ] **10.1 [TEST]** — Write `tests/api/scans.test.ts`: POST missing `sourceType` → 400 zod error; POST valid → 201 + scan row in DB; GET list → paginated envelope with `meta.cursor`; DELETE running → 200. Run → RED.
- [ ] **10.2** — Define all zod schemas under `lib/api/schemas/`: `CreateScanSchema`, `PatchFindingSchema`, `PutConfigSchema`, `ListFindingsSchema`. No separate test.
- [ ] **10.3** — Implement `app/api/sources/route.ts`, `app/api/scans/route.ts`, `app/api/scans/[id]/route.ts` — zod validation, envelope wrapper, repo calls, orchestrator fork on POST. Run 10.1 → GREEN.
- [ ] **10.4 [TEST]** — Write `tests/api/findings.test.ts`: GET with cursor → correct `meta.cursor` + `meta.total`; PATCH `{ falsePositive: true }` → updated record; PATCH invalid severity → 400. Run → RED.
- [ ] **10.5** — Implement `app/api/findings/route.ts`, `app/api/findings/[id]/route.ts` (cursor pagination, PATCH validated fields only). Run 10.4 → GREEN.
- [ ] **10.6 [TEST]** — Write `tests/api/config.test.ts`: GET config → no raw key values; PUT → file written chmod 600; GET prereqs all-present / some-missing. Run → RED.
- [ ] **10.7** — Implement `app/api/providers/route.ts`, `app/api/prereqs/route.ts`, `app/api/config/route.ts` (GET redacted + PUT), `app/api/reports/[scanId]/route.ts` (format → generator dispatch). Run 10.6 → GREEN.

---

## Phase 11 — UI Foundation

- [ ] **11.1 [TEST]** — Write `tests/ui/theme.test.ts`: assert `ThemeToggle` writes `localStorage.theme` and sets `document.documentElement.dataset.theme`; assert layout SSR renders `data-theme` from cookie. Run → RED.
- [ ] **11.2** — Implement `app/globals.css`: CSS vars `:root` (light) and `[data-theme='dark']` (dark) with `--bg`, `--fg`, `--accent`, `--border`, `--surface`; Tailwind v4 import.
- [ ] **11.3** — Implement `app/layout.tsx`: server-side `cookies().get('obt-theme')` → `<html data-theme>` before hydration; add `lib/theme/server.ts` helper.
- [ ] **11.4** — Implement `components/theme/ThemeToggle.tsx` (client: updates `dataset.theme` + cookie + `localStorage`). Run 11.1 → GREEN.
- [ ] **11.5 [PARALLEL]** — Implement `components/ui/Button.tsx`, `Card.tsx`, `Tabs.tsx`, `Badge.tsx` — unstyled base, CSS-var driven, typed props, accessible. Write `tests/ui/primitives.test.tsx`. RED then GREEN.

---

## Phase 12 — UI Screens (parallel after Phase 11 done)

- [ ] **12.1** — Implement `app/page.tsx`: scan list dashboard; `<Card>` per scan with status badge + source ref + created time; "New Scan" CTA; prereq status banner.
- [ ] **12.2** — Implement `app/scans/new/page.tsx` + `components/scan/SourcePicker.tsx` (tabs: GitHub/GitLab/Local/ZIP; per-tab form fields; client-side zod validation; POST `/api/scans` → redirect). Write `tests/ui/source-picker.test.tsx`. RED then GREEN.
- [ ] **12.3** — Implement `app/scans/[id]/page.tsx` + `components/scan/ProgressStream.tsx` (EventSource → SSE, stage badges, findings stream in, reconnect on disconnect) + `components/scan/StageBadge.tsx`. Write `tests/ui/progress-stream.test.tsx`. RED then GREEN.
- [ ] **12.4** — Implement `app/scans/[id]/findings/[fid]/page.tsx` + `components/findings/FindingDetail.tsx`, `DataFlowGraph.tsx` (mermaid or text fallback), `PatchDiff.tsx` (fenced diff), `FindingsTable.tsx` (sortable, cursor-paginated). Write `tests/ui/finding-detail.test.tsx`. RED then GREEN.
- [ ] **12.5 [PARALLEL]** — Implement `app/timeline/[scanId]/page.tsx` + `components/timeline/CommitTimeline.tsx` (horizontal scroll, risk markers, hover detail).
- [ ] **12.6 [PARALLEL]** — Implement `app/authors/[scanId]/page.tsx` + `components/authors/AuthorProfile.tsx` (commit count, first/last seen, anomaly flags).
- [ ] **12.7** — Implement `app/config/page.tsx` + `components/config/ProviderMatrix.tsx`: per-stage model picker (detected CLI + API), masked API key inputs, prereq indicators, ThemeToggle; "Export PDF" + "Generate PoC Script" buttons — `disabled`, tooltip `"Coming Soon"`. Write `tests/ui/config.test.tsx` asserting PDF button disabled. RED then GREEN.
- [ ] **12.8** — Implement `components/chat/ChatSidebar.tsx`: collapsible panel stub; POST `/api/chat` returns 501 in v0.1 (visible, non-blocking).

---

## Phase 13 — CLI (sequential)

- [x] **13.1 [TEST]** — Write `tests/unit/cli/scan.test.ts`: 19 tests covering scan (source kind detection, project+scan creation, pipeline start, progress streaming, SIGTERM abort), history (walk+output, empty repo), report (json/csv/sarif/md, not found, unknown format), agents (detected + not found). Run → RED (module not found).
- [x] **13.2** — Implement `bin/obt.ts` with commander: `scan <source>` (detect source kind, create project+scan, start pipeline, stream progress to stdout), `history <path>` (walk git history, output commit JSON), `report --format <f> <scanId>` (generate json/csv/sarif/md reports), `agents` (list detected CLI agents on PATH). Exports `createProgram()` for testing. Run 13.1 → GREEN.

---

## Phase 14 — Integration, Security Suite & Coverage

- [ ] **14.1 [TEST]** — Write `tests/integration/full-pipeline.test.ts`: create fixture git repo with planted AWS key + SQLi; run full pipeline with stub LLM returning fixture findings; assert ≥1 finding in DB; assert `report.md` generated with correct file structure and cross-links.
- [ ] **14.2 [TEST]** — Write `tests/security/spawn-injection.test.ts`: paths containing `; rm -rf`, `&&`, `$()` → assert scanners use array argv, no shell execution occurs.
- [ ] **14.3 [TEST]** — Write `tests/security/no-telemetry.test.ts`: mock `globalThis.fetch`; run full local scan with no LLM; assert fetch never called to non-localhost URL.
- [ ] **14.4** — Run `vitest --coverage`; assert `lib/` coverage ≥ 80%; write targeted tests for any file below threshold.
- [ ] **14.5** — Final polish: verify all `console.*` calls pass through `redact()`; remove debug statements; assert error codes consistent across routes; run `tsc --noEmit` to zero errors.
