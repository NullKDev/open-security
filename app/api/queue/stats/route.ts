import { ok } from '@/lib/api/envelope'
import { getDb } from '@/lib/db/client'
import { getQueueStats } from '@/lib/repos/queue.repo'

/**
 * GET /api/queue/stats
 *
 * Returns aggregate statistics for the remediation queue.
 * Counts only canonical, non-dismissed findings.
 *
 * Response: {
 *   critical: number
 *   high: number
 *   medium: number
 *   low: number
 *   info: number
 *   total: number
 *   kev: number
 * }
 */
export async function GET(_request: Request): Promise<Response> {
  const db = getDb()
  const stats = getQueueStats(db)

  return ok({
    critical: stats.bySeverity['critical'] ?? 0,
    high: stats.bySeverity['high'] ?? 0,
    medium: stats.bySeverity['medium'] ?? 0,
    low: stats.bySeverity['low'] ?? 0,
    info: stats.bySeverity['info'] ?? 0,
    total: stats.total,
    kev: stats.byKev,
  })
}
