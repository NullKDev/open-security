/**
 * @file app/api/findings/fp-bank/export/route.ts
 *
 * GET /api/findings/fp-bank/export
 *
 * Exports all active FP bank dismissals as a SARIF 2.1.0 suppression document.
 *
 * Design: v0.4 design.md §4.3, REQ-FB-06
 */
import { ok } from '@/lib/api/envelope'
import { getDb } from '@/lib/db/client'
import { exportSarif } from '@/lib/repos/dismissals.repo'

/**
 * GET /api/findings/fp-bank/export
 *
 * Returns all active (non-appealed) dismissals as a SARIF 2.1.0 suppression document.
 *
 * Response: 200 with SARIF document
 *
 * @param _request - Incoming HTTP request (unused)
 */
export async function GET(_request: Request): Promise<Response> {
  const db = getDb()
  const sarif = exportSarif(db)
  return ok(sarif)
}
