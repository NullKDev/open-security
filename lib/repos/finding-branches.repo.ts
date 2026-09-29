import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findingBranches } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface BranchDTO {
  id: string
  findingId: string
  branchRef: string | null
  /** State machine: pending → creating → apply_failed | tests_running → tests_failed | created */
  status: string
  applyError: string | null
  testsOutput: string | null
  testsPassed: number | null
  prUrl: string | null
  createdAt: string
  updatedAt: string | null
}

export interface UpdateBranchFields {
  branchRef?: string | null
  applyError?: string | null
  testsOutput?: string | null
  testsPassed?: number | null
  prUrl?: string | null
}

function uuid(): string {
  return crypto.randomUUID()
}

function rowToDTO(row: typeof findingBranches.$inferSelect): BranchDTO {
  return {
    id: row.id,
    findingId: row.findingId,
    branchRef: row.branchRef ?? null,
    status: row.status,
    applyError: row.applyError ?? null,
    testsOutput: row.testsOutput ?? null,
    testsPassed: row.testsPassed ?? null,
    prUrl: row.prUrl ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
  }
}

/**
 * Creates a new branch record for a finding with status=pending.
 * Enforced: UNIQUE constraint on finding_id prevents duplicate active branches.
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding ID to create a branch for
 * @returns The created BranchDTO
 */
export function createBranchRecord(db: DB, findingId: string): BranchDTO {
  const id = uuid()
  const now = new Date().toISOString()

  db.insert(findingBranches)
    .values({
      id,
      findingId,
      status: 'pending',
      createdAt: now,
    })
    .run()

  const row = db.select().from(findingBranches).where(eq(findingBranches.id, id)).get()
  if (!row) throw new Error(`Branch record ${id} not found after insert`)
  return rowToDTO(row)
}

/**
 * Transitions the branch status and optionally updates associated fields.
 *
 * @param db - Drizzle database instance
 * @param id - Branch record ID
 * @param status - New status value
 * @param fields - Optional fields to update alongside the status
 * @returns The updated BranchDTO
 */
export function updateBranchStatus(
  db: DB,
  id: string,
  status: string,
  fields?: UpdateBranchFields,
): BranchDTO {
  const now = new Date().toISOString()

  db.update(findingBranches)
    .set({
      status,
      updatedAt: now,
      ...(fields?.branchRef !== undefined ? { branchRef: fields.branchRef } : {}),
      ...(fields?.applyError !== undefined ? { applyError: fields.applyError } : {}),
      ...(fields?.testsOutput !== undefined ? { testsOutput: fields.testsOutput } : {}),
      ...(fields?.testsPassed !== undefined ? { testsPassed: fields.testsPassed } : {}),
      ...(fields?.prUrl !== undefined ? { prUrl: fields.prUrl } : {}),
    })
    .where(eq(findingBranches.id, id))
    .run()

  const row = db.select().from(findingBranches).where(eq(findingBranches.id, id)).get()
  if (!row) throw new Error(`Branch record ${id} not found after update`)
  return rowToDTO(row)
}

/**
 * Returns the current branch record for a finding, or undefined if none exists.
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding ID to look up
 * @returns The BranchDTO or undefined
 */
export function getBranchByFindingId(db: DB, findingId: string): BranchDTO | undefined {
  const row = db
    .select()
    .from(findingBranches)
    .where(eq(findingBranches.findingId, findingId))
    .get()

  if (!row) return undefined
  return rowToDTO(row)
}

const TERMINAL_STATUSES = ['created', 'apply_failed', 'tests_failed']

/**
 * Boot-time recovery sweep: marks non-terminal branch records older than
 * `olderThanMs` milliseconds as 'apply_failed' with reason 'interrupted'.
 *
 * Protects against orphaned records from crashed processes.
 *
 * @param db - Drizzle database instance
 * @param olderThanMs - Age threshold in milliseconds (default: 10 minutes)
 */
export function markStaleCreating(db: DB, olderThanMs = 10 * 60_000): void {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString()
  const now = new Date().toISOString()

  // Use raw SQL for the NOT IN + timestamp comparison
  db.$client
    .prepare(`
      UPDATE finding_branches
      SET status = 'apply_failed',
          apply_error = 'interrupted',
          updated_at = ?
      WHERE status NOT IN (${TERMINAL_STATUSES.map(() => '?').join(',')})
        AND created_at < ?
    `)
    .run(now, ...TERMINAL_STATUSES, cutoff)
}
