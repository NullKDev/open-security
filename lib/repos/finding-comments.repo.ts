import { asc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findingComments } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface CommentDTO {
  id: string
  findingId: string
  actor: string
  body: string
  createdAt: string
}

export interface CreateCommentInput {
  findingId: string
  actor: string
  body: string
}

function rowToDTO(row: typeof findingComments.$inferSelect): CommentDTO {
  return {
    id: row.id,
    findingId: row.findingId,
    actor: row.actor,
    body: row.body,
    createdAt: row.createdAt,
  }
}

/**
 * Create a new comment on a finding.
 *
 * @param db - Drizzle database instance
 * @param input - Comment creation input: findingId, actor, body
 * @returns The created CommentDTO
 */
export function createComment(db: DB, input: CreateCommentInput): CommentDTO {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  db.insert(findingComments)
    .values({
      id,
      findingId: input.findingId,
      actor: input.actor,
      body: input.body,
      createdAt: now,
    })
    .run()

  const row = db
    .select()
    .from(findingComments)
    .where(eq(findingComments.id, id))
    .get()

  if (!row) throw new Error(`Comment ${id} not found after insert`)
  return rowToDTO(row)
}

/**
 * List all comments for a finding, ordered by created_at ascending (oldest first).
 *
 * Returns an empty array when the finding has no comments or does not exist.
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding ID to list comments for
 * @returns Array of CommentDTO ordered by creation time
 */
export function listComments(db: DB, findingId: string): CommentDTO[] {
  const rows = db
    .select()
    .from(findingComments)
    .where(eq(findingComments.findingId, findingId))
    .orderBy(asc(findingComments.createdAt))
    .all()

  return rows.map(rowToDTO)
}
