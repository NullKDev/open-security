import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { reports } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface ReportDTO {
  id: string
  scanId: string
  format: string
  path: string
  generatedAt: string
}

export interface CreateReportInput {
  scanId: string
  format: string
  path: string
}

function uuid(): string {
  return crypto.randomUUID()
}

function rowToDTO(row: typeof reports.$inferSelect): ReportDTO {
  return {
    id: row.id,
    scanId: row.scanId,
    format: row.format,
    path: row.path,
    generatedAt: row.generatedAt,
  }
}

export function insertReport(db: DB, input: CreateReportInput): ReportDTO {
  const id = uuid()
  const now = new Date().toISOString()
  db.insert(reports).values({
    id,
    scanId: input.scanId,
    format: input.format,
    path: input.path,
    generatedAt: now,
  }).run()

  const row = db.select().from(reports).where(eq(reports.id, id)).get()
  if (!row) throw new Error(`Report ${id} not found after insert`)
  return rowToDTO(row)
}

export function getReportById(db: DB, id: string): ReportDTO | undefined {
  const row = db.select().from(reports).where(eq(reports.id, id)).get()
  if (!row) return undefined
  return rowToDTO(row)
}

export function listReportsByScan(db: DB, scanId: string): ReportDTO[] {
  const rows = db
    .select()
    .from(reports)
    .where(eq(reports.scanId, scanId))
    .orderBy(reports.generatedAt)
    .all()
  return rows.map(rowToDTO)
}
