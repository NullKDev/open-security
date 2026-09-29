/**
 * backfill.ts — Dedup key backfill for existing findings
 *
 * On boot after migration 0007, findings have dedup_key='__pending_backfill__'.
 * This module computes their proper keys and canonicalizes duplicates.
 *
 * Design constraints (Design §2.3):
 * - Processes in batches of 500
 * - Oldest row per dedup_key becomes canonical (canonical_finding_id IS NULL)
 * - Newer rows get canonical_finding_id pointing to the canonical
 * - Writes config sentinel 'dedup_backfill_done=1' on completion
 * - Skips entirely if sentinel already set (idempotent)
 * - Never throws — backfill failure is non-fatal
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { computeDedupKey } from './dedup-key'

type DB = BetterSQLite3Database<typeof schema>

const SENTINEL = '__pending_backfill__'
const BATCH_SIZE = 500

/**
 * Runs the dedup backfill if not already done.
 *
 * Steps:
 * 1. Check config table for 'dedup_backfill_done=1' — skip if set
 * 2. Fetch pending findings in batches of 500
 * 3. Compute dedup_key for each finding
 * 4. UPDATE each finding's dedup_key
 * 5. Canonicalize: oldest per dedup_key stays canonical; others get canonical_finding_id
 * 6. Write sentinel to config
 *
 * @param db - Drizzle database instance
 */
export function runDedupeBackfill(db: DB): void {
  const sqlite = db.$client

  // Check sentinel
  const sentinel = sqlite
    .prepare("SELECT value FROM config WHERE key = 'dedup_backfill_done'")
    .get() as { value: string } | undefined

  if (sentinel?.value === '1') {
    return
  }

  try {
    // Process in batches until no pending rows remain
    let offset = 0

    for (;;) {
      const rows = sqlite
        .prepare(
          `SELECT id, detector, location_path, title
           FROM findings
           WHERE dedup_key = ?
           LIMIT ? OFFSET ?`,
        )
        .all(SENTINEL, BATCH_SIZE, offset) as Array<{
        id: string
        detector: string
        location_path: string
        title: string
      }>

      if (rows.length === 0) break

      const updateKey = sqlite.prepare(
        'UPDATE findings SET dedup_key = ? WHERE id = ?',
      )

      for (const row of rows) {
        const key = computeDedupKey(row.detector, row.location_path, row.title)
        updateKey.run(key, row.id)
      }

      // With the batch approach and offsetting, we must re-process from 0
      // because updated rows no longer match the WHERE clause.
      // If we got fewer than BATCH_SIZE we're done.
      if (rows.length < BATCH_SIZE) {
        break
      }
      // Otherwise keep scanning from offset 0 (rows shift out of the WHERE filter)
    }

    // Canonicalize: for each unique dedup_key, oldest (min created_at) is canonical
    // All others get canonical_finding_id pointing to the oldest
    const dedupKeys = sqlite
      .prepare(
        `SELECT DISTINCT dedup_key FROM findings
         WHERE dedup_key != ? AND canonical_finding_id IS NULL`,
      )
      .all(SENTINEL) as Array<{ dedup_key: string }>

    for (const { dedup_key } of dedupKeys) {
      const dupes = sqlite
        .prepare(
          `SELECT id FROM findings
           WHERE dedup_key = ?
           ORDER BY created_at ASC`,
        )
        .all(dedup_key) as Array<{ id: string }>

      if (dupes.length <= 1) continue

      const [canonical, ...rest] = dupes

      for (const dupe of rest) {
        sqlite
          .prepare(
            `UPDATE findings
             SET canonical_finding_id = ?
             WHERE id = ?`,
          )
          .run(canonical.id, dupe.id)
      }
    }
  } catch (err) {
    console.warn('[dedup] backfill error:', err)
  }

  // Write sentinel regardless of errors (to avoid infinite retry loops on broken data)
  sqlite
    .prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('dedup_backfill_done', '1')")
    .run()
}
