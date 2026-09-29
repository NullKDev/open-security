import { eq, and } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { authors } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface AuthorDTO {
  scanId: string
  email: string
  name: string | null
  commitCount: number
  firstSeen: string | null
  lastSeen: string | null
  anomalyFlags: unknown | null
}

export interface AuthorInput {
  scanId: string
  email: string
  name?: string | null
  commitCount?: number
  firstSeen?: string | null
  lastSeen?: string | null
  anomalyFlags?: unknown | null
}

function rowToDTO(row: typeof authors.$inferSelect): AuthorDTO {
  return {
    scanId: row.scanId,
    email: row.email,
    name: row.name ?? null,
    commitCount: row.commitCount,
    firstSeen: row.firstSeen ?? null,
    lastSeen: row.lastSeen ?? null,
    anomalyFlags: row.anomalyFlags ? safeJsonParse(row.anomalyFlags) : null,
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

export function upsertAuthor(db: DB, input: AuthorInput): AuthorDTO {
  db.insert(authors)
    .values({
      scanId: input.scanId,
      email: input.email,
      name: input.name ?? null,
      commitCount: input.commitCount ?? 0,
      firstSeen: input.firstSeen ?? null,
      lastSeen: input.lastSeen ?? null,
      anomalyFlags: input.anomalyFlags != null ? JSON.stringify(input.anomalyFlags) : null,
    })
    .onConflictDoUpdate({
      target: [authors.scanId, authors.email],
      set: {
        name: input.name ?? null,
        commitCount: input.commitCount ?? 0,
        firstSeen: input.firstSeen ?? null,
        lastSeen: input.lastSeen ?? null,
        anomalyFlags: input.anomalyFlags != null ? JSON.stringify(input.anomalyFlags) : null,
      },
    })
    .run()

  const row = db
    .select()
    .from(authors)
    .where(and(eq(authors.scanId, input.scanId), eq(authors.email, input.email)))
    .get()
  if (!row) throw new Error(`Author ${input.email}/${input.scanId} not found after upsert`)
  return rowToDTO(row)
}

export function getAuthor(
  db: DB,
  scanId: string,
  email: string,
): AuthorDTO | undefined {
  const row = db
    .select()
    .from(authors)
    .where(and(eq(authors.scanId, scanId), eq(authors.email, email)))
    .get()
  if (!row) return undefined
  return rowToDTO(row)
}

export function listAuthorsByScan(db: DB, scanId: string): AuthorDTO[] {
  const rows = db
    .select()
    .from(authors)
    .where(eq(authors.scanId, scanId))
    .orderBy(authors.email)
    .all()
  return rows.map(rowToDTO)
}
