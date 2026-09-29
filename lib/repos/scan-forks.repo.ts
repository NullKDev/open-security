import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { scanForks } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

/** A scan fork record as returned from the database. */
export interface ScanFork {
  id: string
  parentScanId: string
  childScanId: string
  forkEventId: string | null
  createdAt: string
}

/** Input for creating a scan fork record. */
export interface CreateForkInput {
  id: string
  parentScanId: string
  childScanId: string
  forkEventId?: string | null
}

/**
 * Creates a new fork relationship record between a parent and child scan.
 * Throws if either scan id does not exist (FK constraint) or if the fork id is duplicate.
 *
 * @param db - Drizzle database instance
 * @param data - Fork relationship data
 */
export function createFork(db: DB, data: CreateForkInput): void {
  db.insert(scanForks)
    .values({
      id: data.id,
      parentScanId: data.parentScanId,
      childScanId: data.childScanId,
      forkEventId: data.forkEventId ?? null,
      createdAt: new Date().toISOString(),
    })
    .run()
}

/**
 * Returns all fork records where the given scan is the parent, ordered by creation time.
 *
 * @param db - Drizzle database instance
 * @param parentScanId - The parent scan to query
 * @returns Array of ScanFork rows (empty if none found)
 */
export function findForksByParentScanId(db: DB, parentScanId: string): ScanFork[] {
  const rows = db
    .select()
    .from(scanForks)
    .where(eq(scanForks.parentScanId, parentScanId))
    .all()

  return rows.map((row) => ({
    id: row.id,
    parentScanId: row.parentScanId,
    childScanId: row.childScanId,
    forkEventId: row.forkEventId ?? null,
    createdAt: row.createdAt,
  }))
}
