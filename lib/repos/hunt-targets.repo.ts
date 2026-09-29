import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { huntTargets } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

/** A hunt target row as returned from the database. */
export interface HuntTarget {
  id: string
  scanId: string
  cveId: string
  targetPath: string
  advisoryRaw: string | null
  verdict: string | null
  createdAt: string
}

/** Input for creating or updating a hunt target. */
export interface UpsertHuntTargetInput {
  id: string
  cveId: string
  targetPath: string
  advisoryRaw?: string | null
  verdict?: string | null
}

/**
 * Inserts or updates a hunt target row.
 * On conflict by primary key (id), replaces the existing row.
 *
 * @param db - Drizzle database instance
 * @param scanId - The scan this target belongs to
 * @param input - Hunt target data
 */
export function upsertHuntTarget(
  db: DB,
  scanId: string,
  input: UpsertHuntTargetInput,
): void {
  db.insert(huntTargets)
    .values({
      id: input.id,
      scanId,
      cveId: input.cveId,
      targetPath: input.targetPath,
      advisoryRaw: input.advisoryRaw ?? null,
      verdict: input.verdict ?? null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: huntTargets.id,
      set: {
        advisoryRaw: input.advisoryRaw ?? null,
        verdict: input.verdict ?? null,
      },
    })
    .run()
}

/**
 * Returns all hunt targets for a given scan, ordered by creation time.
 *
 * @param db - Drizzle database instance
 * @param scanId - The scan to query
 * @returns Array of HuntTarget rows (empty if none found)
 */
export function findHuntTargetsByScanId(db: DB, scanId: string): HuntTarget[] {
  const rows = db
    .select()
    .from(huntTargets)
    .where(eq(huntTargets.scanId, scanId))
    .all()

  return rows.map((row) => ({
    id: row.id,
    scanId: row.scanId,
    cveId: row.cveId,
    targetPath: row.targetPath,
    advisoryRaw: row.advisoryRaw ?? null,
    verdict: row.verdict ?? null,
    createdAt: row.createdAt,
  }))
}
