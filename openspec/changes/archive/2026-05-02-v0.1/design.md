# Design: v0.1 — Queue + Branch-per-finding + Findings Dedup + EPSS/KEV scoring

> **Companion documents**: [proposal.md](proposal.md), [spec.md](spec.md)
>
> **Stack**: Next.js 16 (App Router), React 19, TS 5 strict, Tailwind v4, SQLite (better-sqlite3 + Drizzle ORM), Vitest 4, bun. Local-first single-process.

This design resolves five open questions from the spec, locks the schema diff, fixes the API contract, and defines the EPSS/KEV enrichment, branch execution, and queue ordering implementations. It is intentionally precise so the tasks phase can produce a deterministic checklist.

---

## 1. Architecture Decisions (ADRs)

### ADR-1 — `targetPath` is **derived**, not stored

**Context.** The spec talks about "scan.targetPath" for branch operations. The proposal mentions a `repos` table.

**Reality of the codebase.**
- There is **no `repos` table**. Projects live in `projects` and scans in `scans`.
- `lib/config/workspace.ts` already exposes `scanSourceDir(projectId, scanId)` — the canonical path of the cloned/copied source for a given scan: `.obt/projects/{projectId}/scans/{scanId}/source`.
- `scans` has no `target_path` column today and does not need one.

**Decision.** Do **NOT** add `target_path` to `scans`. Always derive the source path through `scanSourceDir(scan.projectId, scan.id)`. Read-only paths are computed at use-site.

**Rationale.**
- Avoids drift between FS reality and DB.
- Reuses the existing `lib/config/workspace.ts` helper as required by `AGENTS.md` ("never hardcode `.obt` paths").
- The `targetPath` mentioned in the spec is conceptual — the API layer resolves it from `(scan.projectId, scan.id)`.

**Rejected.**
- *Add `target_path TEXT` to `scans`.* Duplicates state already encoded in the workspace layout; would need a backfill migration and be a permanent foot-gun once someone moves `.obt`.
- *Per-finding `target_path`.* Findings already point to scans; double indirection.

---

### ADR-2 — `dedup_key` formula confirmed: SHA-256 of `normalize(detector + '|' + location_path + '|' + title)`, **line number excluded**

**Context.** The proposal originally included `location_line_start` in the key. The spec dropped it. Question: is excluding the line number correct?

**Decision.** **Exclude the line number.** Confirmed.

**Formula.**
```
dedup_key = sha256(
  toLowerCase(trim(collapseWhitespace(detector))) + '|' +
  toLowerCase(trim(collapseWhitespace(location_path))) + '|' +
  toLowerCase(trim(collapseWhitespace(title)))
)
```
where `collapseWhitespace` replaces any run of `\s+` with a single ` ` (space).

**Rationale.**
- The same SQL injection at `routes/login.ts` will report at line 42 in one scan and line 47 after a refactor; the operator considers them the same vulnerability. Including the line number defeats dedup across scans.
- `(detector, location_path, title)` is the minimal tuple humans use to recognize "same bug".
- The title from classical tools (gitleaks, semgrep, osv) is stable for a given rule and file. LLM-generated titles are post-processed through stage4-filter; if the LLM rephrases the same finding, dedup may miss — that is **acceptable noise**, not data corruption (we never *drop* findings, only link via `canonical_finding_id`).

**Edge case — LLM title volatility.**
We accept it. A drifted title surfaces as a separate canonical row. Operator can manually mark one as duplicate (future v0.2), or our existing FP-bank suppression handles it. Out of scope to LLM-cluster titles in v0.1.

**Rejected.**
- *Include line range.* Same vuln re-reported at different line breaks dedup.
- *Hash the description too.* LLM descriptions are generative; would yield no dedup at all.
- *Use `cve_ids` as part of the key.* osv-scanner already gives stable titles like `CVE-2023-44487: HTTP/2 Rapid Reset` — title carries the CVE for that detector.

---

### ADR-3 — `test_command` lives on `projects` (per-project, opt-in, default OFF)

**Context.** Branch-per-finding optionally runs the project test suite. Where does the command live?

**Decision.** Add **two columns** to `projects`:
- `test_command TEXT NULL` — the shell string to run (e.g. `npm test`, `bun test`, `pytest -q`).
- `tests_enabled INTEGER NOT NULL DEFAULT 0` — explicit opt-in switch (0 = OFF).

**Rationale.**
- Auto-detect from `package.json` is fragile (which script? `test` vs `test:unit` vs `ci`?) and runs untrusted code by default → security violation per spec ("Test runner executes untrusted code — Mitigation: Opt-in per project; default OFF").
- A separate `repo_config` table is over-engineering for two columns.
- The spec scenario explicitly references `project.test_command`. This matches.

**UI.**
The project page (`/projects/{id}`) gains an "Enable test runner" toggle and a text input for the command, both gated behind a confirmation dialog that warns about executing project code.

**Rejected.**
- *Auto-detect at runtime.* Default-on test execution is the security risk the spec mitigates against.
- *New `repo_config` table.* Two columns; not worth a join.
- *Global config.* Different projects have different test runners; per-project is correct granularity.

---

### ADR-4 — Branch status uses **SWR polling**, not SSE

**Context.** When a branch operation runs, how does the UI update?

**Decision.** **SWR polling against `GET /api/findings/{id}/branch` every 2s while `branch_state IN ('pending','creating','tests_running')`; stop polling once status is terminal (`created | apply_failed | tests_failed`).**

**Rationale.**
- Branch creation is bounded (seconds, maybe a minute for tests). SSE adds connection lifecycle complexity for a one-shot operation.
- Each finding has its own independent branch state — multiplexing N SSE streams for a queue of 50 findings is wasteful.
- SWR's `refreshInterval` + `dedupingInterval` is one prop change; cancellation on unmount is automatic.
- Existing scan SSE pattern in `app/api/scans/[id]/stream/route.ts` is for **long-lived** pipeline runs, not branch operations — wrong tool for this job.

**Polling cadence.**
- Active states: 2000 ms.
- Terminal states: SWR fetch once, no interval.
- Backoff: not needed for v0.1 (single user, local SQLite — request cost is sub-millisecond).

**Rejected.**
- *SSE per finding* (`/api/findings/[id]/branch/stream`). Connection cost per finding row in queue. Overkill.
- *Piggyback on `scans/[id]/stream`.* Branch ops are not scoped to a scan run; they happen on a finding long after the scan ended.

---

### ADR-5 — `occurrence_count` increments **per detection event** (across scans)

**Context.** When the same `dedup_key` is detected again, do we count detections (each scan) or distinct scans?

**Decision.** Increment by **+1 per detection event**. Each call to `insertFinding` that resolves to an existing canonical row does:

```sql
UPDATE findings
SET occurrence_count = occurrence_count + 1,
    last_seen_at     = ?
WHERE id = <canonical_id>;
```

**Rationale.**
- A single scan emits a finding once per distinct location. So in practice "per scan" and "per detection" produce the same count — there is no duplicate-within-scan path that would inflate the counter.
- The spec scenario "Seen N times across M scans" derives `M` separately by `SELECT COUNT(DISTINCT scan_id) FROM findings WHERE dedup_key = ?`. No need to track it on the canonical row.
- Simpler to implement; one `UPDATE`, no `IF NOT EXISTS` logic.

**Implication for "age".**
The queue's `days_open` derives from `first_detected_at` (set once on canonical insert, never updated). `last_seen_at` is informational. `occurrence_count` is **not** used in ranking — only `days_open`.

**Rejected.**
- *Distinct-scan count.* Adds an aggregation step (`COUNT DISTINCT scan_id`) every insert. The duplicate row already has `scan_id`, so the badge query can compute distinct count on-demand from the duplicates table.

---

## 2. Database Schema Changes

Two migration files, applied in order by `lib/db/migrate.ts`:

1. `drizzle/0007_v01_dedup_enrichment.sql` — adds columns/tables (Drizzle-managed).
2. `drizzle/0008_v01_fts5.sql` — FTS5 virtual tables + triggers (raw SQL, not in Drizzle schema).

### 2.1 Drizzle schema additions (`lib/db/schema.ts`)

Append to the existing file:

```typescript
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ─── Projects (modify) ───────────────────────────────────────
// Append two columns to the existing projects table:
//   testCommand:   shell string for opt-in test runner
//   testsEnabled:  explicit on/off, default 0 (OFF)
// (Keep the existing definition; below is the *new* shape, not a re-declaration.)
//
// id             text PK
// name           text NOT NULL
// sourceKind     text NOT NULL
// sourceRef      text NOT NULL
// modelsConfig   text
// testCommand    text                                    ← NEW
// testsEnabled   integer NOT NULL DEFAULT 0              ← NEW
// createdAt      text NOT NULL

// ─── Findings (modify) ───────────────────────────────────────
// Append the dedup, CVE, and occurrence columns:
//
// dedupKey            text                ← indexed, nullable until backfilled
// canonicalFindingId  text                ← FK → findings.id, nullable
// cveIds              text                ← JSON array, nullable
// firstDetectedAt     text                ← canonical only; ISO ts
// lastSeenAt          text                ← canonical only; ISO ts
// occurrenceCount     integer NOT NULL DEFAULT 1
//
// Indexes:
//   findings_dedup_key_idx        ON (dedup_key)
//   findings_canonical_idx        ON (canonical_finding_id)
//   findings_canonical_severity   ON (canonical_finding_id, severity)  ← queue filter

// ─── cveScores (NEW) ─────────────────────────────────────────
export const cveScores = sqliteTable('cve_scores', {
  cveId:          text('cve_id').primaryKey(),
  epssScore:      real('epss_score'),                              // 0.0–1.0, nullable
  epssPercentile: real('epss_percentile'),                          // 0.0–1.0, nullable
  cisaKev:        integer('cisa_kev').notNull().default(0),         // 0 | 1
  fetchedAt:      text('fetched_at').notNull(),                     // ISO timestamp
})

// ─── findingDismissals (NEW) ─────────────────────────────────
export const findingDismissals = sqliteTable(
  'finding_dismissals',
  {
    id:           text('id').primaryKey(),
    findingId:    text('finding_id').notNull().references(() => findings.id),
    dedupKey:     text('dedup_key').notNull(),                      // denormalized for fast suppression
    fpType:       text('fp_type').notNull(),                        // false_positive | acceptable_risk | wont_fix | duplicate
    reason:       text('reason').notNull(),                         // Zod-validated: min 10 chars
    dismissedAt:  text('dismissed_at').notNull(),
    undoneAt:     text('undone_at'),                                // null = active
  },
  (t) => ({
    dedupActiveIdx: index('fp_dedup_active_idx').on(t.dedupKey, t.undoneAt),
  }),
)

// ─── findingBranches (NEW) ───────────────────────────────────
export const findingBranches = sqliteTable(
  'finding_branches',
  {
    id:           text('id').primaryKey(),
    findingId:    text('finding_id').notNull().references(() => findings.id),
    branchRef:    text('branch_ref'),                               // e.g. sec/fix/abcd1234
    status:       text('status').notNull(),                         // pending | creating | apply_failed | tests_running | tests_failed | created
    applyError:   text('apply_error'),                              // stderr from git apply --check
    testsOutput:  text('tests_output'),                             // last 2000 chars
    testsPassed:  integer('tests_passed'),                          // null = not run, 0 | 1 otherwise
    prUrl:        text('pr_url'),                                   // user-set; we do not auto-create
    createdAt:    text('created_at').notNull(),
    updatedAt:    text('updated_at').notNull(),
  },
  (t) => ({
    findingUq: uniqueIndex('finding_branches_finding_uq').on(t.findingId),
  }),
)
```

> Note: SQLite's `ALTER TABLE` cannot add a `NOT NULL` column without a default to an existing table. All new columns on `findings` and `projects` either are nullable or have a default — chosen accordingly above.

### 2.2 Migration `drizzle/0007_v01_dedup_enrichment.sql`

```sql
-- v0.1: Dedup, CVE enrichment, FP bank, branch remediation — schema additions
-- All ALTERs are additive and idempotent at the migration-tracker level.

-- ── projects ────────────────────────────────────────────────
ALTER TABLE projects ADD COLUMN test_command TEXT;
ALTER TABLE projects ADD COLUMN tests_enabled INTEGER NOT NULL DEFAULT 0;

-- ── findings ────────────────────────────────────────────────
ALTER TABLE findings ADD COLUMN dedup_key TEXT;
ALTER TABLE findings ADD COLUMN canonical_finding_id TEXT REFERENCES findings(id);
ALTER TABLE findings ADD COLUMN cve_ids TEXT;                                  -- JSON array
ALTER TABLE findings ADD COLUMN first_detected_at TEXT;
ALTER TABLE findings ADD COLUMN last_seen_at TEXT;
ALTER TABLE findings ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS findings_dedup_key_idx
  ON findings(dedup_key);
CREATE INDEX IF NOT EXISTS findings_canonical_idx
  ON findings(canonical_finding_id);
CREATE INDEX IF NOT EXISTS findings_canonical_severity_idx
  ON findings(canonical_finding_id, severity);

-- Backfill dedup_key for existing rows.
-- SQLite has no SHA-256, so the migration sets a placeholder and
-- the *application* runs `lib/dedup/backfill.ts` once at boot to
-- compute the real keys (idempotent: only fills NULL).
-- Mark them with a sentinel so backfill picks them up:
UPDATE findings SET dedup_key = '__pending_backfill__' WHERE dedup_key IS NULL;

-- Backfill first_detected_at / last_seen_at from createdAt.
UPDATE findings SET first_detected_at = created_at WHERE first_detected_at IS NULL;
UPDATE findings SET last_seen_at      = created_at WHERE last_seen_at      IS NULL;

-- ── cve_scores ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cve_scores (
  cve_id          TEXT PRIMARY KEY,
  epss_score      REAL,
  epss_percentile REAL,
  cisa_kev        INTEGER NOT NULL DEFAULT 0,
  fetched_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cve_scores_kev_idx ON cve_scores(cisa_kev);

-- ── finding_dismissals ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS finding_dismissals (
  id            TEXT PRIMARY KEY,
  finding_id    TEXT NOT NULL REFERENCES findings(id),
  dedup_key     TEXT NOT NULL,
  fp_type       TEXT NOT NULL,
  reason        TEXT NOT NULL,
  dismissed_at  TEXT NOT NULL,
  undone_at     TEXT
);
CREATE INDEX IF NOT EXISTS fp_dedup_active_idx
  ON finding_dismissals(dedup_key, undone_at);

-- ── finding_branches ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finding_branches (
  id           TEXT PRIMARY KEY,
  finding_id   TEXT NOT NULL REFERENCES findings(id),
  branch_ref   TEXT,
  status       TEXT NOT NULL,
  apply_error  TEXT,
  tests_output TEXT,
  tests_passed INTEGER,
  pr_url       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS finding_branches_finding_uq
  ON finding_branches(finding_id);

-- Down migration (manual; SQLite cannot DROP COLUMN before 3.35):
--   DROP TABLE cve_scores; DROP TABLE finding_dismissals; DROP TABLE finding_branches;
--   DROP INDEX findings_dedup_key_idx; DROP INDEX findings_canonical_idx;
--   DROP INDEX findings_canonical_severity_idx;
--   (column drops require table rebuild; not provided — local-first uninstall = delete .obt/)
```

### 2.3 Migration `drizzle/0008_v01_fts5.sql` (raw FTS5)

Drizzle does **not** know about FTS5 virtual tables. They live in raw SQL only and are **not** in `lib/db/schema.ts`. Repository functions that query them use `db.$client.prepare(...)` (the underlying better-sqlite3 handle).

```sql
-- v0.1: FTS5 virtual tables for findings and FP bank.

-- ── findings_fts ────────────────────────────────────────────
-- rowid is the surrogate; we map it to findings.id via a side mapping table
-- because FTS5 rowid must be an INTEGER and findings.id is TEXT (UUID).
CREATE TABLE IF NOT EXISTS findings_fts_map (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id  TEXT NOT NULL UNIQUE
);

CREATE VIRTUAL TABLE IF NOT EXISTS findings_fts USING fts5(
  title,
  description,
  location_path,
  content='',                 -- contentless: we maintain it explicitly via triggers
  tokenize='porter unicode61'
);

-- INSERT trigger: allocate a rowid and index the row.
CREATE TRIGGER IF NOT EXISTS findings_fts_ai
AFTER INSERT ON findings
BEGIN
  INSERT INTO findings_fts_map (finding_id) VALUES (new.id);
  INSERT INTO findings_fts (rowid, title, description, location_path)
  VALUES (
    (SELECT rowid FROM findings_fts_map WHERE finding_id = new.id),
    new.title, new.description, new.location_path
  );
END;

-- UPDATE trigger: refresh the FTS row.
CREATE TRIGGER IF NOT EXISTS findings_fts_au
AFTER UPDATE OF title, description, location_path ON findings
BEGIN
  INSERT INTO findings_fts (findings_fts, rowid, title, description, location_path)
  VALUES ('delete',
          (SELECT rowid FROM findings_fts_map WHERE finding_id = new.id),
          old.title, old.description, old.location_path);
  INSERT INTO findings_fts (rowid, title, description, location_path)
  VALUES (
    (SELECT rowid FROM findings_fts_map WHERE finding_id = new.id),
    new.title, new.description, new.location_path
  );
END;

-- DELETE trigger: remove the row and its mapping.
CREATE TRIGGER IF NOT EXISTS findings_fts_ad
AFTER DELETE ON findings
BEGIN
  INSERT INTO findings_fts (findings_fts, rowid, title, description, location_path)
  VALUES ('delete',
          (SELECT rowid FROM findings_fts_map WHERE finding_id = old.id),
          old.title, old.description, old.location_path);
  DELETE FROM findings_fts_map WHERE finding_id = old.id;
END;

-- ── fp_bank_fts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fp_bank_fts_map (
  rowid          INTEGER PRIMARY KEY AUTOINCREMENT,
  dismissal_id   TEXT NOT NULL UNIQUE
);

CREATE VIRTUAL TABLE IF NOT EXISTS fp_bank_fts USING fts5(
  reason,
  title,
  content='',
  tokenize='porter unicode61'
);

-- We index dismissal.reason + the *current* finding.title at insert time.
-- (If the linked finding's title changes later, the FTS row stays at the
-- snapshot value. Acceptable: the FP-bank UI is an audit view.)
CREATE TRIGGER IF NOT EXISTS fp_bank_fts_ai
AFTER INSERT ON finding_dismissals
BEGIN
  INSERT INTO fp_bank_fts_map (dismissal_id) VALUES (new.id);
  INSERT INTO fp_bank_fts (rowid, reason, title)
  VALUES (
    (SELECT rowid FROM fp_bank_fts_map WHERE dismissal_id = new.id),
    new.reason,
    COALESCE((SELECT title FROM findings WHERE id = new.finding_id), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS fp_bank_fts_au
AFTER UPDATE OF reason ON finding_dismissals
BEGIN
  INSERT INTO fp_bank_fts (fp_bank_fts, rowid, reason, title)
  VALUES ('delete',
          (SELECT rowid FROM fp_bank_fts_map WHERE dismissal_id = new.id),
          old.reason,
          COALESCE((SELECT title FROM findings WHERE id = new.finding_id), ''));
  INSERT INTO fp_bank_fts (rowid, reason, title)
  VALUES (
    (SELECT rowid FROM fp_bank_fts_map WHERE dismissal_id = new.id),
    new.reason,
    COALESCE((SELECT title FROM findings WHERE id = new.finding_id), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS fp_bank_fts_ad
AFTER DELETE ON finding_dismissals
BEGIN
  INSERT INTO fp_bank_fts (fp_bank_fts, rowid, reason, title)
  VALUES ('delete',
          (SELECT rowid FROM fp_bank_fts_map WHERE dismissal_id = old.id),
          old.reason, '');
  DELETE FROM fp_bank_fts_map WHERE dismissal_id = old.id;
END;

-- Backfill FTS for existing findings (idempotent: INSERT OR IGNORE).
INSERT OR IGNORE INTO findings_fts_map (finding_id) SELECT id FROM findings;
INSERT INTO findings_fts (rowid, title, description, location_path)
SELECT m.rowid, f.title, f.description, f.location_path
FROM findings f JOIN findings_fts_map m ON m.finding_id = f.id
WHERE NOT EXISTS (SELECT 1 FROM findings_fts WHERE rowid = m.rowid);
```

### 2.4 Backfill of `dedup_key`

Reason for application-side: SQLite has no SHA-256 builtin. Module: `lib/dedup/backfill.ts`.

```typescript
// Pseudocode shape — concrete impl lives in tasks phase.
//
// On boot (after migrations) scan for `dedup_key = '__pending_backfill__'`
// in batches of 500. For each batch:
//   1. Compute the key via computeDedupKey(detector, locationPath, title).
//   2. UPDATE row.
//   3. After all rows are real keys, run the canonicalization sweep:
//      For each dedup_key with N>1 rows where canonical_finding_id IS NULL,
//      pick the oldest (MIN(created_at)) as canonical and link the rest.
//
// Backfill runs once. After it completes, write a row to `config`:
//   key='dedup_backfill_done', value='1'. Subsequent boots skip.
```

---

## 3. API Design

All routes follow the existing `lib/api/envelope.ts` (`ok`, `created`, `paginated`, `fail`) pattern. All bodies validated via Zod schemas under `lib/api/schemas/`.

### 3.1 `GET /api/queue`

Returns the prioritized canonical-finding list across all projects.

**Query params** (all optional, validated by `QueueQuerySchema`):

```typescript
const QueueQuerySchema = z.object({
  cursor:     z.string().optional(),
  limit:      z.coerce.number().int().min(1).max(100).default(50),
  severity:   z.string().optional()
                .transform((v) => v ? v.split(',').filter(Boolean) : undefined),
  projectId:  z.string().optional()
                .transform((v) => v ? v.split(',').filter(Boolean) : undefined),
  hasPatch:   z.coerce.boolean().optional(),
  status:     z.enum(['open','dismissed']).default('open'),
})
```

**Response shape**:
```typescript
interface QueueRowDTO {
  id:                  string
  scanId:              string
  projectId:           string
  projectName:         string                    // joined from projects
  detector:            string
  severity:            'critical'|'high'|'medium'|'low'|'info'
  title:               string
  locationPath:        string
  locationLineStart:   number
  cveIds:              string[] | null
  epssScore:           number | null             // 0..1, null if unknown
  epssPercentile:      number | null
  cisaKev:             0 | 1
  exploitability:      number                    // existing column, 0..1
  hasPatch:            boolean
  occurrenceCount:     number
  firstDetectedAt:     string                    // ISO
  daysOpen:            number                    // computed at query time
  rankScore:           number                    // computed at query time
  branchStatus:        string | null             // null | pending | … | created
}

// Envelope
ApiResponse<QueueRowDTO[]>  // meta.cursor present when more rows exist
```

**Implementation** — single SQL with LEFT JOINs, see §6.

### 3.2 `GET /api/queue/stats`

Severity-bucket counts for the header.

```typescript
// Response
interface QueueStats {
  total:    number
  bySeverity: { critical: number; high: number; medium: number; low: number; info: number }
  byKev:      { kev: number; nonKev: number }
  byPatch:    { withPatch: number; withoutPatch: number }
}
```

### 3.3 `POST /api/findings/{id}/dismiss`

```typescript
const DismissBodySchema = z.object({
  fpType: z.enum(['false_positive','acceptable_risk','wont_fix','duplicate']),
  reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(2000),
})

// 201 → DismissalDTO { id, findingId, dedupKey, fpType, reason, dismissedAt }
// 400 → INVALID_INPUT (Zod failure or finding has no dedup_key)
// 404 → NOT_FOUND (finding does not exist)
// 409 → CONFLICT (an active dismissal already exists for this dedup_key)
```

### 3.4 `DELETE /api/findings/{id}/dismiss`

Marks the active dismissal `undone_at = NOW()`. No body.

```typescript
// 200 → { id, undoneAt }
// 404 → NOT_FOUND (no active dismissal for this finding's dedup_key)
```

### 3.5 `POST /api/findings/{id}/branch`

Triggers async branch creation. Returns immediately with `pending`.

```typescript
const CreateBranchBodySchema = z.object({
  runTests: z.boolean().optional(),     // override; default = project.testsEnabled
}).optional()

// 201 → { id, findingId, branchRef: null, status: 'pending', createdAt }
// 400 → INVALID_INPUT  (finding.patchDiff is null; cannot apply nothing)
// 404 → NOT_FOUND      (finding does not exist)
// 409 → CONFLICT       (a non-terminal branch already exists for this finding)
```

**Behavior**.
1. Load finding → resolve scan → resolve `targetPath = scanSourceDir(scan.projectId, scan.id)`.
2. Insert `finding_branches` row with `status='pending'`.
3. Kick off async work (`setImmediate(() => createFixBranch(...))`); the route returns 201 immediately.
4. Worker updates the row through statuses; client polls `GET /api/findings/{id}/branch`.

### 3.6 `GET /api/findings/{id}/branch`

```typescript
// 200 → BranchDTO {
//   id, findingId, branchRef, status,
//   applyError, testsOutput, testsPassed, prUrl,
//   createdAt, updatedAt
// }
// 404 → NOT_FOUND (no branch record yet)
```

### 3.7 `POST /api/enrichment/refresh`

Manual trigger for KEV catalog refresh + EPSS re-fetch of stale rows. Idempotent. Returns counts.

```typescript
// Body: optional { force?: boolean }   force=true ignores 24h TTL
// 200 → { kevRefreshedAt: string, kevCount: number, epssFetched: number, epssFailed: number }
```

---

## 4. EPSS / KEV Enrichment Service Design

### 4.1 Module layout — `lib/enrichment/`

```
lib/enrichment/
├── epss.ts            // fetchEpss(cveIds: string[]): Promise<EpssScore[]>
├── kev.ts             // refreshKevCatalog(): Promise<Set<string>>
├── service.ts         // getScoresForCves, enrichScan (post-pipeline hook)
├── rate-limiter.ts    // token-bucket: 10 req/sec
└── __tests__/
    ├── epss.test.ts
    ├── kev.test.ts
    └── service.test.ts
```

### 4.2 When does enrichment run?

**Three triggers**, in priority order:

| Trigger | Path | Behavior |
|---|---|---|
| **Post-scan** | `lib/pipeline/runner.ts` after stage5 | Iterate inserted findings where `detector='osv'`, extract CVEs → `cveIds`, call `getScoresForCves(allCves)` → upsert `cve_scores`. Best-effort, never blocks scan completion. |
| **Lazy on queue load** | `lib/repos/queue.repo.ts` | LEFT JOIN `cve_scores`; if `epss_score IS NULL` for visible CVEs, schedule a background fetch (fire-and-forget). Queue still renders with `epss_score = 0.01` fallback. |
| **Manual refresh** | `POST /api/enrichment/refresh` | Re-fetch all stale rows (`fetched_at < NOW - 24h`) plus refresh KEV. |

A **daily cron** is **not** part of v0.1. This is a local-first single-process app with no scheduler — relying on user activity is the simplest correct answer. Manual refresh button covers the "I've been away" case.

### 4.3 EPSS API client — `lib/enrichment/epss.ts`

- Endpoint: `https://api.first.org/data/v1/epss?cve=CVE-x,CVE-y,...`
- Batching: up to **30 CVEs per request** (FIRST.org docs).
- Rate limit: **10 req/sec**, token bucket in `rate-limiter.ts`.
- Timeout: **5s** per request via `AbortController`.
- Response shape (FIRST.org): `{ status: 'OK', data: [{ cve, epss, percentile, date }] }`.
- Validation: Zod schema at boundary; missing CVEs simply omitted from the response.
- Output: `{ cveId, epssScore: number|null, epssPercentile: number|null }[]`.

### 4.4 KEV catalog — `lib/enrichment/kev.ts`

- Endpoint: `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`
- Fetched as a single JSON blob (≈ 1 MB, ≈ 1200 entries).
- Parse `vulnerabilities[].cveID` → `Set<string>`.
- Update `cve_scores`: for every CVE-ID we already track, set `cisa_kev = (kevSet.has(id) ? 1 : 0)` and bump `fetched_at`.
- For KEV-only CVEs we have not yet seen, **do not** create rows — they appear once a finding references them.
- Cache file: `.obt/cache/kev.json` plus a sidecar `kev.fetched_at`. Used as fallback if HTTP fetch fails.

### 4.5 Cache table semantics — `cve_scores`

- **Primary key**: `cve_id`.
- **Stale**: `fetched_at < NOW - 24h`.
- **Fresh-on-read**: `getScoresForCves(ids)` returns cached rows; for any miss or stale row, schedules an async fetch (does not block the caller). Returns whatever it has *now* — caller already has fallback logic (`epss_score = 0.01`).
- **Concurrency**: a per-CVE in-memory `Set<string>` of in-flight fetches dedups concurrent enrichment requests (single-process, fine for local-first).

### 4.6 CVE-ID extraction — `lib/dedup/extract-cves.ts`

```typescript
const CVE_REGEX = /CVE-\d{4}-\d{4,}/g
export function extractCveIds(text: string): string[] {
  return Array.from(new Set(text.match(CVE_REGEX) ?? []))
}
```
Called only when `detector === 'osv'`, on `title + ' ' + description`. Result stored in `findings.cve_ids` as JSON array; e.g. `["CVE-2023-44487"]`.

### 4.7 Graceful degradation

- All network errors → `console.warn('[enrichment]', err)`. No throw. No rejected promise reaches the pipeline runner.
- `getScoresForCves(ids)` always resolves to a `Map<cveId, CveScoreRow|undefined>` — never throws.
- The queue ranking SQL coalesces missing scores to `0.01`, missing KEV to `0`. Safe at all times.

---

## 5. Branch-per-Finding Execution Design

### 5.1 Module layout — `lib/remediation/`

```
lib/remediation/
├── git-ops.ts         // checkoutBranch, applyDiffCheck, applyDiff, currentCommit
├── test-runner.ts     // runProjectTests(cmd, cwd) → { passed, output }
├── branch-service.ts  // createFixBranch(findingId): orchestrates the flow
└── __tests__/...
```

### 5.2 Execution flow (state machine)

```
pending
  → creating
        ↘ apply_failed     (git apply --check non-zero)
        ↘ tests_running    (apply OK and project.testsEnabled = 1)
              ↘ tests_failed
              ↘ created     (tests passed)
        ↘ created           (apply OK and tests disabled)
```

### 5.3 Step-by-step

```typescript
// Pseudocode of createFixBranch(findingId)
//
// 1. Load:
//    finding   = getFindingById(db, findingId)        // must have patchDiff
//    scan      = getScanById(db, finding.scanId)
//    project   = getProjectById(db, scan.projectId)
//    targetPath = scanSourceDir(scan.projectId, scan.id)
//
// 2. Pre-flight:
//    - if !finding.patchDiff → INVALID_INPUT (the route already checks; double-guard here)
//    - if !fs.existsSync(path.join(targetPath, '.git')) → status='apply_failed',
//      apply_error='source workspace is not a git repo'.
//    - read scanCommit = scan.locationCommit on the finding, fallback to
//      `git -C <targetPath> rev-parse HEAD`.
//
// 3. updateBranch(status='creating')
//
// 4. branchRef = `sec/fix/${findingId.slice(0, 8)}`
//    spawn: git -C <targetPath> checkout -b <branchRef> <scanCommit>
//      - if exits non-zero → status='apply_failed', apply_error=stderr; STOP.
//
// 5. Write finding.patchDiff to a tmp file.
//    spawn: git -C <targetPath> apply --check <tmpfile>
//      - non-zero → status='apply_failed', apply_error=stderr; STOP.
//
// 6. spawn: git -C <targetPath> apply <tmpfile>
//      - non-zero → status='apply_failed', apply_error=stderr; STOP.
//
// 7. If project.testsEnabled = 1 AND project.testCommand:
//      updateBranch(status='tests_running')
//      const { passed, output } = await runProjectTests(project.testCommand, targetPath)
//      updateBranch({
//        status: passed ? 'created' : 'tests_failed',
//        testsPassed: passed ? 1 : 0,
//        testsOutput: output.slice(-2000),
//        branchRef,
//      })
//    Else:
//      updateBranch({ status: 'created', branchRef })
```

### 5.4 Process model

- **All git/test operations happen in the Next.js Node process** via `child_process.spawn`.
- Local-first → no Vercel constraints. Long-running spawns are acceptable in a Route Handler **but we still return 201 immediately** and run the work via `setImmediate(...)` so the HTTP request stays sub-100ms.
- Each step: `spawn(cmd, args, { cwd: targetPath, timeout: 120_000 })`. Timeouts: git ops 30s, tests 600s. Streamed stderr captured.
- **No shell**: `spawn(cmd, [...args])` not `spawn(cmd, { shell: true })` — avoids injection. The single exception is `test_command` itself: that **is** a shell string, by user choice, gated behind `tests_enabled`. Documented in UI as "this string runs in your shell".
- Concurrency cap: a single-process in-memory `Set<string>` of finding-IDs currently creating prevents parallel runs on the same finding (also enforced by the `finding_branches.finding_id` UNIQUE index).

### 5.5 Why a Route Handler is OK here

- Local-first: there is no platform timeout to dodge (no Vercel, no serverless).
- The HTTP request itself returns in <100ms (just an INSERT and a `setImmediate`).
- The async work runs on the same Node process; updates the DB; the client polls.
- Aborts: if the Next.js dev server restarts mid-create, the row is left in `creating`. A boot-time sweep in `lib/remediation/recover.ts` re-marks any non-terminal row older than 10 minutes as `apply_failed` with `apply_error = 'interrupted'`.

---

## 6. Queue Ordering Implementation

### 6.1 The ranking expression

Per spec:
```
rank_score = exploitability_score
           × COALESCE(epss_score, 0.01)
           × (1 + 0.5 * cisa_kev)
           × ln(1 + days_open)
```
where `days_open = (julianday('now') - julianday(first_detected_at))`.

### 6.2 Drizzle query

```typescript
import { sql } from 'drizzle-orm'

// Inside lib/repos/queue.repo.ts
const rankExpr = sql<number>`
  ${findings.exploitability}
  * COALESCE((SELECT epss_score FROM cve_scores
              WHERE cve_id IN (
                SELECT value FROM json_each(${findings.cveIds})
              )
              ORDER BY epss_score DESC LIMIT 1), 0.01)
  * (1 + 0.5 * COALESCE((SELECT MAX(cisa_kev) FROM cve_scores
                         WHERE cve_id IN (
                           SELECT value FROM json_each(${findings.cveIds})
                         )), 0))
  * (CASE
       WHEN ${findings.firstDetectedAt} IS NULL THEN 0
       ELSE ln(1 + (julianday('now') - julianday(${findings.firstDetectedAt})))
     END)
`.as('rank_score')
```

### 6.3 Full queue SELECT (sketch)

```typescript
const rows = db
  .select({
    id:               findings.id,
    scanId:           findings.scanId,
    projectId:        scans.projectId,
    projectName:      projects.name,
    detector:         findings.detector,
    severity:         findings.severity,
    title:            findings.title,
    locationPath:     findings.locationPath,
    locationLineStart: findings.locationLineStart,
    cveIds:           findings.cveIds,
    exploitability:   findings.exploitability,
    occurrenceCount:  findings.occurrenceCount,
    firstDetectedAt:  findings.firstDetectedAt,
    hasPatch:         sql<number>`(${findings.patchDiff} IS NOT NULL)`,
    rankScore:        rankExpr,
    branchStatus:     sql<string|null>`(SELECT status FROM finding_branches
                                        WHERE finding_id = ${findings.id})`,
    epssScore:        sql<number|null>`(SELECT epss_score FROM cve_scores
                                        WHERE cve_id IN (
                                          SELECT value FROM json_each(${findings.cveIds})
                                        ) ORDER BY epss_score DESC LIMIT 1)`,
    cisaKev:          sql<number>`(SELECT COALESCE(MAX(cisa_kev),0) FROM cve_scores
                                   WHERE cve_id IN (
                                     SELECT value FROM json_each(${findings.cveIds})
                                   ))`,
  })
  .from(findings)
  .innerJoin(scans, eq(findings.scanId, scans.id))
  .innerJoin(projects, eq(scans.projectId, projects.id))
  .where(and(
    isNull(findings.canonicalFindingId),                                  // canonical only
    eq(findings.fpFiltered, false),
    notExists(
      db.select({ x: sql`1` }).from(findingDismissals)
        .where(and(
          eq(findingDismissals.dedupKey, findings.dedupKey),
          isNull(findingDismissals.undoneAt),
        ))
    ),
    // ... severity / projectId / hasPatch filters appended dynamically
  ))
  .orderBy(sql`rank_score DESC`, findings.id)
  .limit(limit + 1)
  .all()
```

### 6.4 NULL handling

| Source | NULL behavior |
|---|---|
| `findings.cveIds` | `json_each(NULL)` returns no rows → CVE-score subqueries yield NULL → `COALESCE(epss_score, 0.01)` and `MAX(cisa_kev) → 0`. Correct. |
| `findings.firstDetectedAt` | Backfill sets it to `created_at`; if still NULL, `CASE` returns 0 → finding sorts to the bottom. |
| Empty `cveIds = '[]'` | Same as NULL: no rows from `json_each` → fallback. |

### 6.5 Performance

- Indexes used: `findings_canonical_idx` (canonical filter), `findings_scan_severity_idx` (severity filter), `cve_scores PRIMARY KEY` (CVE lookup), `fp_dedup_active_idx` (dismissal NOT EXISTS).
- Subquery per row over `json_each(cve_ids)` is O(k) where k = avg CVEs per finding (1–2 for osv, 0 for everything else). At 10k findings: ~10k cheap subqueries — well under the spec's 500ms target on local SQLite WAL.
- If profiling shows it slow, v0.2 can denormalize `max_epss_score` and `kev_flag` onto `findings` and refresh on enrichment. **Not done in v0.1** — premature optimization.

---

## 7. Component Architecture

All new components live in `components/queue/` (feature-grouped) **except** the badges, which are generic and live in `components/ui/`. Following the repo's existing convention (e.g. `components/ui/StatusPill.tsx`, `components/ui/Badge.tsx`).

```
components/
├── ui/
│   ├── EpssBadge.tsx        ← NEW — wraps existing Badge with EPSS color tier
│   └── KevBadge.tsx         ← NEW — wraps existing Badge, red, "KEV"
├── queue/
│   ├── QueueRow.tsx         ← NEW — single row in /queue, wraps existing Card
│   ├── QueueFilters.tsx     ← NEW — severity/project/has-patch filter bar
│   ├── QueueEmptyState.tsx  ← NEW — uses existing components/ui/empty.tsx
│   └── BranchPanel.tsx      ← NEW — status pill + Create Fix Branch button + SWR poll
├── findings/
│   ├── FindingDetailHeader.tsx ← MODIFIED — adds occurrence badge "Seen N times"
│   └── DismissDialog.tsx       ← NEW — fpType select + reason textarea + confirm
└── fp-bank/
    └── FpBankRow.tsx        ← NEW — single dismissal row in FP bank table
```

**Component tree by route**:

```
/  (was: Dashboard)
└── <QueueView>                            (server component, fetches /api/queue)
    ├── <QueueFilters>                    (client; URL-state via Next.js searchParams)
    ├── <QueueStatsHeader>                (server; fetches /api/queue/stats)
    └── <QueueRow> × 50
        ├── <Badge> (severity)
        ├── <EpssBadge>
        ├── <KevBadge> (conditional)
        ├── <BranchPanel> (status pill + action; SWR-polled)
        └── action buttons (Investigate, Dismiss)

/projects   (was: /)
└── <ProjectsList>                         (the OLD dashboard view)

/findings/{id}  (existing route; modified)
├── <FindingDetailHeader>                  (with occurrence badge)
├── <BranchPanel>                          (full version with PR URL input)
├── <DismissDialog>                        (modal trigger)
└── existing tabs

/findings?tab=dismissed  (FP bank, NEW tab)
└── <FpBankView>
    ├── <FtsSearchInput>                   (debounced; hits /api/fp-bank?search=...)
    └── <FpBankRow> × N
```

### 7.1 Reuse map (existing components)

| Existing | Reused by |
|---|---|
| `components/ui/Badge.tsx` | `EpssBadge`, `KevBadge`, severity display |
| `components/ui/Card.tsx` | `QueueRow` outer container |
| `components/ui/StatusPill.tsx` | `BranchPanel` status pill (extend allowed states) |
| `components/ui/Button.tsx` | All action buttons |
| `components/ui/empty.tsx` | `QueueEmptyState` |
| `components/ui/dialog.tsx` | `DismissDialog` modal |
| `components/ui/select.tsx` | `DismissDialog` fpType select |
| `components/ui/textarea.tsx` | `DismissDialog` reason field |
| `components/ui/Tabs.tsx` | `/findings` tabs (open / dismissed) |

**No new dependency packages.** SWR is already in the dependency tree (`ScanStatusPoller` uses it). FTS5 is built into better-sqlite3.

### 7.2 Client-state contracts

- `BranchPanel` props: `{ findingId: string, hasPatch: boolean, initial?: BranchDTO }`. Uses `useSWR(\`/api/findings/${id}/branch\`, { refreshInterval: isActive ? 2000 : 0 })`.
- `QueueRow` is a server component for the data row; only `BranchPanel` and `QueueFilters` are client.
- Filters are URL-driven (`useSearchParams`/`router.replace`) — no global store, no full reload.

---

## 8. Cross-Cutting Concerns

### 8.1 Pipeline integration

`lib/pipeline/runner.ts` after stage5 currently calls `updateScanStatus(db, scanId, 'done')`. Insert a single line **before** that:

```typescript
await enrichScan(db, scanId).catch((err) => {
  console.warn('[enrichment] post-scan enrichment failed', err)
})
```

`enrichScan(db, scanId)`:
1. `extractCveIds` for each `detector='osv'` finding in the scan; persist `findings.cveIds`.
2. Collect distinct CVE IDs.
3. `getScoresForCves(allCves)` (best-effort).

### 8.2 Insert path (dedup)

`lib/repos/findings.repo.ts → insertFinding` becomes:

```
1. compute dedup_key
2. SELECT id, occurrence_count FROM findings
   WHERE dedup_key = ? AND canonical_finding_id IS NULL
3. if found:
     INSERT new row with canonical_finding_id = canon.id, occurrence_count=1
     UPDATE canon SET occurrence_count = occurrence_count + 1, last_seen_at = now
   else:
     INSERT canonical row (canonical_finding_id = NULL, first_detected_at = now,
                           last_seen_at = now, occurrence_count = 1)
```
Wrapped in `db.transaction()` for atomicity.

### 8.3 Backwards compatibility

- All existing endpoints (`/api/findings`, `/api/findings/{id}`) keep working — they don't filter on the new columns.
- `/api/findings?scanId=X` continues to return all findings (canonical + dups) for that scan; that's the right thing for per-scan views.
- Old `/` dashboard moves verbatim to `/projects`. A redirect from `/projects` is **not** added (we want `/` to be the queue).

### 8.4 Security

- Zod at every API boundary (already enforced in repo conventions).
- No shell interpolation in git ops (spawn argv form).
- `test_command` is the **only** shell-evaluated string and it is gated by `tests_enabled` (default OFF) with a UI confirmation.
- All FS writes constrained to `targetPath` derived from `scanSourceDir` (no user-controlled paths).
- EPSS / KEV calls are GETs with no auth headers (public endpoints) over HTTPS; 5s timeout; size-limited reads to avoid blow-ups.

### 8.5 Observability

- Existing `scan_events` table is **not** used for branch ops — branch state lives in `finding_branches.status`.
- Console warnings prefixed `[enrichment]` and `[remediation]` for grep-ability.
- No new logging dependency.

---

## 9. Risks and Open Items (carried into tasks)

| Risk | Where it bites | Mitigation in design |
|---|---|---|
| FTS5 trigger ordering bugs | `findings_fts_au` updates with stale rowid | Mapping table guarantees stable rowid per finding-id; tested in unit test that re-INSERT/UPDATE/DELETE keep FTS in sync. |
| `git apply` rejects on whitespace drift | `apply_failed` rate spikes | Already mitigated: branch from `scan.commit` (not HEAD); UI shows stderr verbatim and offers "Re-generate patch". |
| EPSS API outage during scan | `cve_ids` populated, `cve_scores` empty | Queue uses `epss_score = 0.01` fallback; manual refresh button retries; daily `fetched_at` TTL re-fetches. |
| Concurrent branch creates on same finding | UNIQUE index race | `INSERT OR ABORT` on `finding_branches.finding_id`; route returns 409. |
| 10k+ findings, queue still <500ms | SQL plan regression | Indexes specified explicitly; `EXPLAIN QUERY PLAN` test in `__tests__` to lock the plan. |
| Backfill on a 50k findings DB | Boot-time pause | Backfill batches of 500 with `console.log` progress; runs only once (sentinel value `__pending_backfill__`). |

---

## 10. What this design intentionally does NOT decide

- The **exact UI copy** for severity colors, KEV badge text, dialog wording — design system level, lives in tasks.
- The **error-message strings** in `apply_error` parsing — UI tasks decide whether to truncate or syntax-highlight.
- The **migration testing approach** — the existing `lib/db/migrate.ts` runs idempotently; tests will spin up `:memory:` instances and assert table presence.
- **Pagination cursor format** for the queue — keep the existing base64-JSON cursor pattern from `findings.repo.ts`.
- **Component-level styling** — Tailwind utility classes per the repo's convention; no design tokens being introduced.

These belong to the tasks phase.
