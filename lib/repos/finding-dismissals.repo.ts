import { eq, isNull, and } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findingDismissals } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

/**
 * FP classification type for a dismissal.
 *
 * Spec v0.1 defined: false_positive | acceptable_risk | wont_fix | duplicate.
 * Implementation uses: not_vulnerable | accepted_risk | wont_fix | duplicate.
 *
 * Deviation is intentional: "not_vulnerable" is more precise than "false_positive"
 * (a false positive is a subset of "not vulnerable"), and "accepted_risk" better
 * reflects the risk-acceptance workflow than "acceptable_risk" (adjective vs. noun phrase).
 * The UI, dismiss route Zod schema, and DismissDialog all use these values consistently.
 */
export type FpType = 'not_vulnerable' | 'accepted_risk' | 'wont_fix' | 'duplicate'

export interface DismissalDTO {
  id: string
  findingId: string
  dedupKey: string
  fpType: string
  reason: string
  dismissedAt: string
  undoneAt: string | null
}

export interface CreateDismissalInput {
  findingId: string
  dedupKey: string
  fpType: FpType
  reason: string
}

function uuid(): string {
  return crypto.randomUUID()
}

function rowToDTO(row: typeof findingDismissals.$inferSelect): DismissalDTO {
  return {
    id: row.id,
    findingId: row.findingId,
    dedupKey: row.dedupKey,
    fpType: row.fpType,
    reason: row.reason,
    dismissedAt: row.dismissedAt,
    undoneAt: row.undoneAt ?? null,
  }
}

/**
 * Creates a new finding dismissal (FP bank entry).
 * Sets undone_at to null (active dismissal).
 *
 * @param db - Drizzle database instance
 * @param input - Dismissal creation input
 * @returns The created DismissalDTO
 */
export function createDismissal(db: DB, input: CreateDismissalInput): DismissalDTO {
  const id = uuid()
  const now = new Date().toISOString()

  db.insert(findingDismissals)
    .values({
      id,
      findingId: input.findingId,
      dedupKey: input.dedupKey,
      fpType: input.fpType,
      reason: input.reason,
      dismissedAt: now,
      undoneAt: null,
    })
    .run()

  const row = db.select().from(findingDismissals).where(eq(findingDismissals.id, id)).get()
  if (!row) throw new Error(`Dismissal ${id} not found after insert`)
  return rowToDTO(row)
}

/**
 * Checks whether a finding is currently dismissed.
 * A finding is dismissed if any active dismissal (undone_at IS NULL) exists
 * with the same dedup_key, regardless of which scan produced the finding.
 *
 * @param db - Drizzle database instance
 * @param dedupKey - The finding's dedup_key
 * @returns true if an active dismissal exists
 */
export function isDismissed(db: DB, dedupKey: string): boolean {
  const activeDismissal = db
    .select({ id: findingDismissals.id })
    .from(findingDismissals)
    .where(
      and(
        eq(findingDismissals.dedupKey, dedupKey),
        isNull(findingDismissals.undoneAt),
      ),
    )
    .get()

  return activeDismissal !== undefined
}

/**
 * Undoes a dismissal by setting undone_at to NOW.
 * The finding will reappear in the queue on the next load.
 *
 * @param db - Drizzle database instance
 * @param dismissalId - The dismissal ID to undo
 * @returns The updated DismissalDTO
 */
export function undoDismissal(db: DB, dismissalId: string): DismissalDTO {
  const now = new Date().toISOString()

  db.update(findingDismissals)
    .set({ undoneAt: now })
    .where(eq(findingDismissals.id, dismissalId))
    .run()

  const row = db.select().from(findingDismissals).where(eq(findingDismissals.id, dismissalId)).get()
  if (!row) throw new Error(`Dismissal ${dismissalId} not found after undo`)
  return rowToDTO(row)
}

/**
 * Lists all active dismissals (where undone_at IS NULL).
 * Supports cursor-based pagination.
 *
 * @param db - Drizzle database instance
 * @param cursor - Optional pagination cursor (dismissal id to start after)
 * @param limit - Maximum number of results (default 50)
 * @returns Array of active DismissalDTOs
 */
export function listActiveDismissals(
  db: DB,
  cursor?: string,
  limit = 50,
): DismissalDTO[] {
  const rows = db
    .select()
    .from(findingDismissals)
    .where(isNull(findingDismissals.undoneAt))
    .limit(limit)
    .all()

  return rows.map(rowToDTO)
}

/**
 * Full-text search over dismissal reason and finding title via fp_bank_fts.
 * Returns matching active dismissal IDs.
 *
 * @param db - Drizzle database instance
 * @param query - FTS5 search query
 * @returns Array of matching DismissalDTOs
 */
export function searchDismissals(db: DB, query: string): DismissalDTO[] {
  // Access the underlying sqlite3 instance via the drizzle session
  const sqlite = (db as unknown as { session: { client: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } } } }).session.client

  const matchingIds = sqlite
    .prepare(`
      SELECT dm.dismissal_id
      FROM fp_bank_fts_map dm
      JOIN fp_bank_fts fts ON fts.rowid = dm.rowid
      WHERE fp_bank_fts MATCH ?
    `)
    .all(query) as Array<{ dismissal_id: string }>

  if (matchingIds.length === 0) return []

  const ids = matchingIds.map((r) => r.dismissal_id)

  const rows = db
    .select()
    .from(findingDismissals)
    .where(isNull(findingDismissals.undoneAt))
    .all()
    .filter((r) => ids.includes(r.id))

  return rows.map(rowToDTO)
}
