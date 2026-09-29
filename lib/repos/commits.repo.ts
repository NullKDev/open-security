import { eq, and } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { commits } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface CommitDTO {
  sha: string
  scanId: string
  authorEmail: string | null
  authorName: string | null
  authoredAt: string | null
  message: string | null
  filesChanged: number | null
  insertions: number | null
  deletions: number | null
  riskScore: number | null
}

export interface CommitInput {
  sha: string
  scanId: string
  authorEmail?: string | null
  authorName?: string | null
  authoredAt?: string | null
  message?: string | null
  filesChanged?: number | null
  insertions?: number | null
  deletions?: number | null
  riskScore?: number | null
}

function rowToDTO(row: typeof commits.$inferSelect): CommitDTO {
  return {
    sha: row.sha,
    scanId: row.scanId,
    authorEmail: row.authorEmail ?? null,
    authorName: row.authorName ?? null,
    authoredAt: row.authoredAt ?? null,
    message: row.message ?? null,
    filesChanged: row.filesChanged ?? null,
    insertions: row.insertions ?? null,
    deletions: row.deletions ?? null,
    riskScore: row.riskScore ?? null,
  }
}

export function upsertCommit(db: DB, input: CommitInput): CommitDTO {
  db.insert(commits)
    .values({
      sha: input.sha,
      scanId: input.scanId,
      authorEmail: input.authorEmail ?? null,
      authorName: input.authorName ?? null,
      authoredAt: input.authoredAt ?? null,
      message: input.message ?? null,
      filesChanged: input.filesChanged ?? null,
      insertions: input.insertions ?? null,
      deletions: input.deletions ?? null,
      riskScore: input.riskScore ?? null,
    })
    .onConflictDoUpdate({
      target: [commits.sha, commits.scanId],
      set: {
        authorEmail: input.authorEmail ?? null,
        authorName: input.authorName ?? null,
        authoredAt: input.authoredAt ?? null,
        message: input.message ?? null,
        filesChanged: input.filesChanged ?? null,
        insertions: input.insertions ?? null,
        deletions: input.deletions ?? null,
        riskScore: input.riskScore ?? null,
      },
    })
    .run()

  const row = db
    .select()
    .from(commits)
    .where(and(eq(commits.sha, input.sha), eq(commits.scanId, input.scanId)))
    .get()
  if (!row) throw new Error(`Commit ${input.sha}/${input.scanId} not found after upsert`)
  return rowToDTO(row)
}

export function getCommitBySha(
  db: DB,
  sha: string,
  scanId: string,
): CommitDTO | undefined {
  const row = db
    .select()
    .from(commits)
    .where(and(eq(commits.sha, sha), eq(commits.scanId, scanId)))
    .get()
  if (!row) return undefined
  return rowToDTO(row)
}

export function listCommitsByScan(db: DB, scanId: string): CommitDTO[] {
  const rows = db
    .select()
    .from(commits)
    .where(eq(commits.scanId, scanId))
    .orderBy(commits.authoredAt)
    .all()
  return rows.map(rowToDTO)
}
