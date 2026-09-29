/**
 * @file lib/repos/dismissals.repo.ts
 *
 * Augmented dismissal repository for v0.4 FP Bank features.
 * Handles dismiss→history(created), appeal→appealed_at+history, reDismiss,
 * FTS5 search, SARIF export, and agent-assisted draft cooldown meta.
 *
 * All audit writes are append-only (enforced by DB triggers per ADR-6).
 *
 * Design: ADR-6 (v0.4 design.md)
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findingDismissals, findingDismissalHistory } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

// ─── Internal helpers ─────────────────────────────────────────────────────────

type SqliteClient = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => { changes: number }
    all: (...args: unknown[]) => unknown[]
    get: (...args: unknown[]) => unknown | undefined
  }
}

function getSqlite(db: DB): SqliteClient {
  return (db as unknown as { session: { client: SqliteClient } }).session.client
}

function uuid(): string {
  return crypto.randomUUID()
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface DismissalDTO {
  id: string
  findingId: string
  dedupKey: string
  fpType: string
  reason: string
  dismissedAt: string
  undoneAt: string | null
  appealedAt: string | null
  appealReason: string | null
  appealAuthor: string | null
}

export interface HistoryRowDTO {
  id: string
  dismissalId: string
  action: string
  actor: string
  rationaleSnapshot: string
  source: string
  ts: string
}

export interface DismissResult {
  dismissal: DismissalDTO
  historyRow: HistoryRowDTO
}

export interface DismissInput {
  findingId: string
  dedupKey: string
  fpType: string
  reason: string
  actor: string
  source: 'hand' | 'agent-assisted'
}

export interface AppealInput {
  dismissalId: string
  actor: string
  appealReason: string
}

export interface ReDismissInput {
  dismissalId: string
  reason: string
  actor: string
  source: 'hand' | 'agent-assisted'
}

export interface DraftCooldownMeta {
  draftedAt: string
  cooldownSeconds: number
  canSubmit: boolean
}

// ─── Internal row mappers ─────────────────────────────────────────────────────

function mapDismissal(row: Record<string, unknown>): DismissalDTO {
  return {
    id: row.id as string,
    findingId: row.finding_id as string,
    dedupKey: row.dedup_key as string,
    fpType: row.fp_type as string,
    reason: row.reason as string,
    dismissedAt: row.dismissed_at as string,
    undoneAt: (row.undone_at as string | null) ?? null,
    appealedAt: (row.appealed_at as string | null) ?? null,
    appealReason: (row.appeal_reason as string | null) ?? null,
    appealAuthor: (row.appeal_author as string | null) ?? null,
  }
}

function mapHistory(row: Record<string, unknown>): HistoryRowDTO {
  return {
    id: row.id as string,
    dismissalId: row.dismissal_id as string,
    action: row.action as string,
    actor: row.actor as string,
    rationaleSnapshot: row.rationale_snapshot as string,
    source: row.source as string,
    ts: row.ts as string,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new finding dismissal and writes an immutable history row
 * with action='created'.
 *
 * @param db - Drizzle database instance
 * @param input - Dismissal creation input
 * @returns DismissResult containing the created dismissal and history row
 */
export function dismiss(db: DB, input: DismissInput): DismissResult {
  const sqlite = getSqlite(db)
  const now = new Date().toISOString()
  const dismissalId = uuid()
  const historyId = uuid()

  sqlite.prepare(`
    INSERT INTO finding_dismissals (id, finding_id, dedup_key, fp_type, reason, dismissed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(dismissalId, input.findingId, input.dedupKey, input.fpType, input.reason, now)

  sqlite.prepare(`
    INSERT INTO finding_dismissal_history
      (id, dismissal_id, action, actor, rationale_snapshot, source, ts)
    VALUES (?, ?, 'created', ?, ?, ?, ?)
  `).run(historyId, dismissalId, input.actor, input.reason, input.source, now)

  const dismissalRow = sqlite.prepare(`SELECT * FROM finding_dismissals WHERE id = ?`).get(dismissalId) as Record<string, unknown>
  const historyRow = sqlite.prepare(`SELECT * FROM finding_dismissal_history WHERE id = ?`).get(historyId) as Record<string, unknown>

  return {
    dismissal: mapDismissal(dismissalRow),
    historyRow: mapHistory(historyRow),
  }
}

/**
 * Appeals a dismissal: sets appealed_at and undone_at (re-surfaces the finding),
 * and appends a history row with action='appealed'.
 *
 * @param db - Drizzle database instance
 * @param input - Appeal input
 * @returns DismissResult containing the updated dismissal and new history row
 * @throws If the dismissal does not exist
 */
export function appeal(db: DB, input: AppealInput): DismissResult {
  const sqlite = getSqlite(db)
  const now = new Date().toISOString()

  const existing = sqlite.prepare(`SELECT * FROM finding_dismissals WHERE id = ?`).get(input.dismissalId) as Record<string, unknown> | undefined
  if (!existing) throw new Error(`Dismissal ${input.dismissalId} not found`)

  sqlite.prepare(`
    UPDATE finding_dismissals
    SET appealed_at = ?, appeal_reason = ?, appeal_author = ?, undone_at = ?
    WHERE id = ?
  `).run(now, input.appealReason, input.actor, now, input.dismissalId)

  const historyId = uuid()
  sqlite.prepare(`
    INSERT INTO finding_dismissal_history
      (id, dismissal_id, action, actor, rationale_snapshot, source, ts)
    VALUES (?, ?, 'appealed', ?, ?, 'hand', ?)
  `).run(historyId, input.dismissalId, input.actor, existing.reason as string, now)

  const updatedRow = sqlite.prepare(`SELECT * FROM finding_dismissals WHERE id = ?`).get(input.dismissalId) as Record<string, unknown>
  const historyRow = sqlite.prepare(`SELECT * FROM finding_dismissal_history WHERE id = ?`).get(historyId) as Record<string, unknown>

  return {
    dismissal: mapDismissal(updatedRow),
    historyRow: mapHistory(historyRow),
  }
}

/**
 * Re-dismisses a previously appealed finding: clears appealed_at and undone_at,
 * sets a new dismissed_at, and appends a history row with action='re-dismissed'.
 *
 * @param db - Drizzle database instance
 * @param input - Re-dismissal input
 * @returns DismissResult containing the updated dismissal and new history row
 */
export function reDismiss(db: DB, input: ReDismissInput): DismissResult {
  const sqlite = getSqlite(db)
  const now = new Date().toISOString()

  sqlite.prepare(`
    UPDATE finding_dismissals
    SET dismissed_at = ?, reason = ?, appealed_at = NULL, appeal_reason = NULL,
        appeal_author = NULL, undone_at = NULL
    WHERE id = ?
  `).run(now, input.reason, input.dismissalId)

  const historyId = uuid()
  sqlite.prepare(`
    INSERT INTO finding_dismissal_history
      (id, dismissal_id, action, actor, rationale_snapshot, source, ts)
    VALUES (?, ?, 're-dismissed', ?, ?, ?, ?)
  `).run(historyId, input.dismissalId, input.actor, input.reason, input.source, now)

  const updatedRow = sqlite.prepare(`SELECT * FROM finding_dismissals WHERE id = ?`).get(input.dismissalId) as Record<string, unknown>
  const historyRow = sqlite.prepare(`SELECT * FROM finding_dismissal_history WHERE id = ?`).get(historyId) as Record<string, unknown>

  return {
    dismissal: mapDismissal(updatedRow),
    historyRow: mapHistory(historyRow),
  }
}

/**
 * Full-text search over FP bank dismissals using fp_bank_fts.
 * Returns active dismissals matching the query, ranked by relevance.
 *
 * @param db - Drizzle database instance
 * @param query - FTS5 search query string
 * @returns Array of matching DismissalDTOs (active only)
 */
export function searchDismissals(db: DB, query: string): DismissalDTO[] {
  const sqlite = getSqlite(db)

  // Wrap each token in quotes for FTS5 — prevents special character issues
  const safeQuery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ')

  let matchingIds: Array<{ dismissal_id: string }>
  try {
    matchingIds = sqlite.prepare(`
      SELECT dm.dismissal_id
      FROM fp_bank_fts_map dm
      JOIN fp_bank_fts fts ON fts.rowid = dm.rowid
      WHERE fp_bank_fts MATCH ?
      ORDER BY rank
    `).all(safeQuery) as Array<{ dismissal_id: string }>
  } catch {
    return []
  }

  if (matchingIds.length === 0) return []

  const ids = matchingIds.map((r) => r.dismissal_id)
  const placeholders = ids.map(() => '?').join(', ')

  const rows = sqlite.prepare(`
    SELECT * FROM finding_dismissals
    WHERE id IN (${placeholders})
      AND undone_at IS NULL
  `).all(...ids) as Record<string, unknown>[]

  return rows.map(mapDismissal)
}

/**
 * Exports all active (non-appealed, non-undone) dismissals as a SARIF 2.1.0
 * suppression document.
 *
 * @param db - Drizzle database instance
 * @returns SARIF suppression document object
 */
export function exportSarif(db: DB): {
  version: string
  $schema: string
  runs: Array<{ results: unknown[] }>
} {
  const sqlite = getSqlite(db)

  const rows = sqlite.prepare(`
    SELECT fd.id, fd.dedup_key, fd.fp_type, fd.reason, fd.dismissed_at,
           f.location_path, f.title, f.detector
    FROM finding_dismissals fd
    JOIN findings f ON f.id = fd.finding_id
    WHERE fd.undone_at IS NULL AND fd.appealed_at IS NULL
  `).all() as Array<{
    id: string
    dedup_key: string
    fp_type: string
    reason: string
    dismissed_at: string
    location_path: string
    title: string
    detector: string
  }>

  const results = rows.map((r) => ({
    ruleId: r.dedup_key,
    message: { text: r.title },
    suppressions: [
      {
        kind: 'inSource',
        status: r.fp_type === 'false_positive' ? 'accepted' : 'underReview',
        justification: r.reason,
        date: r.dismissed_at,
      },
    ],
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: r.location_path },
        },
      },
    ],
  }))

  return {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [
      {
        results,
      },
    ],
  }
}

/**
 * Returns cooldown metadata for an agent-assisted draft dismissal.
 * The 5-second cooldown (REQ-FB-07) prevents immediate auto-submit.
 *
 * Returns null if no agent-assisted history row exists for the dismissal.
 *
 * @param db - Drizzle database instance
 * @param dismissalId - The dismissal ID to check
 * @returns DraftCooldownMeta or null
 */
export function getDraftCooldownMeta(db: DB, dismissalId: string): DraftCooldownMeta | null {
  const sqlite = getSqlite(db)

  const agentRow = sqlite.prepare(`
    SELECT ts FROM finding_dismissal_history
    WHERE dismissal_id = ? AND source = 'agent-assisted'
    ORDER BY ts DESC
    LIMIT 1
  `).get(dismissalId) as { ts: string } | undefined

  if (!agentRow) return null

  const draftedAt = agentRow.ts
  const cooldownSeconds = 5
  const elapsed = (Date.now() - new Date(draftedAt).getTime()) / 1000
  const canSubmit = elapsed >= cooldownSeconds

  return { draftedAt, cooldownSeconds, canSubmit }
}
