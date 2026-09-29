/**
 * @file lib/dedup/post-hooks/regression-detect.ts
 *
 * Post-dedup pipeline hook for regression detection.
 * Wraps the ADR-5 SQL in regressions.repo.ts and fires the desktop
 * notification via lib/notifications/desktop.ts.
 *
 * Invoked from lib/pipeline/runner.ts after dedup writes have settled.
 *
 * Design: ADR-5 (v0.4 design.md)
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { detectAndMark } from '@/lib/repos/regressions.repo'
import { notifyRegressionsBatch } from '@/lib/notifications/desktop'

type DB = BetterSQLite3Database<typeof schema>

/**
 * Runs regression detection for all findings in the given scan.
 * Side effects:
 * 1. Inserts finding_regressions rows (idempotent — NOT EXISTS guard)
 * 2. Sets findings.is_regression = 1, status = 'regression' on regressed findings
 * 3. Fires a desktop notification if any regressions were detected (exactly once per scan)
 *
 * @param db - Drizzle database instance
 * @param scanId - The scan to run detection against
 * @returns Number of regressions detected in this scan
 */
export function runRegressionDetect(db: DB, scanId: string): number {
  const count = detectAndMark(db, scanId)
  notifyRegressionsBatch(db, scanId, count)
  return count
}
