import { asc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findingAssignments } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface AssignmentDTO {
  id: string
  findingId: string
  assignee: string
  actor: string
  createdAt: string
  unassignedAt: string | null
}

export interface AssignInput {
  findingId: string
  assignee: string
  actor: string
}

function rowToDTO(row: typeof findingAssignments.$inferSelect): AssignmentDTO {
  return {
    id: row.id,
    findingId: row.findingId,
    assignee: row.assignee,
    actor: row.actor,
    createdAt: row.createdAt,
    unassignedAt: row.unassignedAt ?? null,
  }
}

/**
 * Assign a finding to an assignee.
 *
 * If the finding already has an active assignment (unassigned_at IS NULL),
 * that record's `unassigned_at` is set to now before creating the new one.
 *
 * @param db - Drizzle database instance
 * @param input - Assignment input: findingId, assignee, actor
 * @returns The newly created AssignmentDTO
 */
export function assign(db: DB, input: AssignInput): AssignmentDTO {
  const now = new Date().toISOString()

  db.transaction((tx) => {
    // Close existing active assignment (unassigned_at IS NULL)
    const active = tx
      .select()
      .from(findingAssignments)
      .where(eq(findingAssignments.findingId, input.findingId))
      .all()
      .filter((r) => r.unassignedAt === null)

    for (const row of active) {
      tx.update(findingAssignments)
        .set({ unassignedAt: now })
        .where(eq(findingAssignments.id, row.id))
        .run()
    }

    // Insert new assignment
    tx.insert(findingAssignments)
      .values({
        id: crypto.randomUUID(),
        findingId: input.findingId,
        assignee: input.assignee,
        actor: input.actor,
        createdAt: now,
        unassignedAt: null,
      })
      .run()
  })

  // Read back the newly created active row
  const rows = db
    .select()
    .from(findingAssignments)
    .where(eq(findingAssignments.findingId, input.findingId))
    .all()
    .filter((r) => r.unassignedAt === null)

  const row = rows[0]
  if (!row) throw new Error(`Assignment for finding ${input.findingId} not found after insert`)
  return rowToDTO(row)
}

/**
 * Unassign a finding by setting `unassigned_at` on the active assignment record.
 *
 * Is a no-op if there is no active assignment.
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding to unassign
 * @param actor - The actor performing the unassignment (for audit purposes)
 */
export function unassign(db: DB, findingId: string, _actor: string): void {
  const now = new Date().toISOString()

  const active = db
    .select()
    .from(findingAssignments)
    .where(eq(findingAssignments.findingId, findingId))
    .all()
    .filter((r) => r.unassignedAt === null)

  for (const row of active) {
    db.update(findingAssignments)
      .set({ unassignedAt: now })
      .where(eq(findingAssignments.id, row.id))
      .run()
  }
}

/**
 * Get the current assignee for a finding (the active assignment with unassigned_at IS NULL).
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding ID to look up
 * @returns The assignee email/identifier, or null if unassigned
 */
export function currentAssignee(db: DB, findingId: string): string | null {
  const rows = db
    .select()
    .from(findingAssignments)
    .where(eq(findingAssignments.findingId, findingId))
    .all()
    .filter((r) => r.unassignedAt === null)

  return rows[0]?.assignee ?? null
}

/**
 * List the full assignment history for a finding, ordered by created_at ascending.
 *
 * Includes all records (both active and superseded).
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding ID to list history for
 * @returns Array of AssignmentDTO ordered by creation time
 */
export function assignmentHistory(db: DB, findingId: string): AssignmentDTO[] {
  const rows = db
    .select()
    .from(findingAssignments)
    .where(eq(findingAssignments.findingId, findingId))
    .orderBy(asc(findingAssignments.createdAt))
    .all()

  return rows.map(rowToDTO)
}
