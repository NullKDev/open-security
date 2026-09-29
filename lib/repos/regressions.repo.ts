/**
 * @file lib/repos/regressions.repo.ts
 *
 * Repository for regression detection: inserts finding_regressions rows
 * and updates findings.is_regression / findings.status.
 *
 * Design: ADR-5 (v0.4 design.md)
 * The detection SQL is idempotent (NOT EXISTS guard).
 */
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findingRegressions } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface RegressionLineageDTO {
  id: string
  originalFindingId: string
  regressedFindingId: string
  originalBranchId: string | null
  regressionCommitSha: string | null
  detectedAt: string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type SqliteClient = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => { changes: number }
    all: (...args: unknown[]) => unknown[]
    get: (...args: unknown[]) => unknown
  }
}

function getSqlite(db: DB): SqliteClient {
  return (db as unknown as { session: { client: SqliteClient } }).session.client
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detects and marks regressions for all findings in the given scan.
 *
 * A finding is a regression when:
 * - Its dedup_key matches an existing finding that had a branch with merged_at set
 * - This finding's created_at > that branch's merged_at
 * - No finding_regressions row already exists for it (idempotency guard)
 *
 * Side effects:
 * - Inserts finding_regressions rows for each detected regression
 * - Sets findings.is_regression = 1, status = 'regression',
 *   and regression_of_finding_id on the regressed finding rows
 *
 * @param db - Drizzle database instance
 * @param scanId - The scan ID whose findings to evaluate
 * @returns Number of new regressions detected
 */
export function detectAndMark(db: DB, scanId: string): number {
  const sqlite = getSqlite(db)
  const now = new Date().toISOString()

  // Step 1: Insert regression rows (idempotent — NOT EXISTS guard)
  // Uses ADR-5 SQL pattern:
  // - f_new is the new finding in this scan
  // - f_orig is the canonical finding that was previously merged
  // - fb is the finding_branches row with merged_at set
  sqlite.prepare(`
    INSERT INTO finding_regressions (
      id, original_finding_id, regressed_finding_id,
      original_branch_id, regression_commit_sha, detected_at
    )
    SELECT
      lower(hex(randomblob(16))),
      fb.finding_id,
      f_new.id,
      fb.id,
      f_new.location_commit,
      ?
    FROM findings AS f_new
    JOIN findings AS f_orig
      ON f_orig.dedup_key = f_new.dedup_key
      AND f_orig.id != f_new.id
    JOIN finding_branches AS fb
      ON fb.finding_id = f_orig.id
      AND fb.merged_at IS NOT NULL
    WHERE f_new.scan_id = ?
      AND f_new.created_at > fb.merged_at
      AND NOT EXISTS (
        SELECT 1 FROM finding_regressions r
        WHERE r.regressed_finding_id = f_new.id
      )
  `).run(now, scanId)

  // Step 2: Update the regressed finding rows
  sqlite.prepare(`
    UPDATE findings
    SET
      is_regression = 1,
      status = 'regression',
      regression_of_finding_id = (
        SELECT original_finding_id FROM finding_regressions
        WHERE regressed_finding_id = findings.id
      )
    WHERE scan_id = ?
      AND id IN (
        SELECT regressed_finding_id FROM finding_regressions
        WHERE regressed_finding_id IN (
          SELECT id FROM findings WHERE scan_id = ?
        )
      )
  `).run(scanId, scanId)

  // Step 3: Count how many regressions were just detected
  const result = sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM finding_regressions fr
    JOIN findings f ON f.id = fr.regressed_finding_id
    WHERE f.scan_id = ?
  `).get(scanId) as { cnt: number }

  return result.cnt
}

/**
 * Returns the regression lineage record for a given regressed finding.
 * Returns null when no regression row exists for this finding ID.
 *
 * @param db - Drizzle database instance
 * @param regressedFindingId - The ID of the regression finding to look up
 * @returns RegressionLineageDTO or null
 */
export function getRegressionLineage(
  db: DB,
  regressedFindingId: string,
): RegressionLineageDTO | null {
  const row = db
    .select()
    .from(findingRegressions)
    .where(eq(findingRegressions.regressedFindingId, regressedFindingId))
    .get()

  if (!row) return null

  return {
    id: row.id,
    originalFindingId: row.originalFindingId,
    regressedFindingId: row.regressedFindingId,
    originalBranchId: row.originalBranchId ?? null,
    regressionCommitSha: row.regressionCommitSha ?? null,
    detectedAt: row.detectedAt,
  }
}
