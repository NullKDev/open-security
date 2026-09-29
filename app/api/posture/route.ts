/**
 * @file app/api/posture/route.ts
 *
 * GET /api/posture?repo={projectId}&range={7d|30d|60d|90d|all}
 *
 * Returns posture timeseries, regression rate, and open critical days
 * for a given project. Time-range defaults to 30d.
 *
 * Design: v0.4 design.md §4.2, REQ-PT-01–REQ-PT-05
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getTimeseries, getRegressionRate } from '@/lib/repos/posture.repo'

/** Mapping from range param to number of days (0 = all) */
const RANGE_MAP: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '60d': 60,
  '90d': 90,
  all: 0,
}

const PostureQuerySchema = z.object({
  repo: z.string().min(1, 'repo is required'),
  range: z.enum(['7d', '30d', '60d', '90d', 'all']).default('30d'),
})

/**
 * GET /api/posture
 *
 * Returns the posture timeseries, regression rate (30d), and total open
 * critical days for the given project.
 *
 * Query params:
 * - repo:  project ID (required)
 * - range: 7d | 30d | 60d | 90d | all (default: 30d)
 *
 * Response: 200 with { timeseries, regressionRate, openCriticalDays, refreshedAt }
 * Errors:   400 (invalid input)
 *
 * @param request - Incoming HTTP request
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawParams = Object.fromEntries(url.searchParams.entries())

  const parsed = PostureQuerySchema.safeParse(rawParams)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { repo, range } = parsed.data
  const rangeDays = RANGE_MAP[range]

  const db = getDb()

  const snapshots = getTimeseries(db, repo, rangeDays)
  const regressionRate = getRegressionRate(db, repo, 30)

  const timeseries = snapshots.map((s) => ({
    date: s.bucketDate,
    weightedScore: s.weightedScore,
    countCritical: s.countCritical,
    countHigh: s.countHigh,
    countMedium: s.countMedium,
    countLow: s.countLow,
    countInfo: s.countInfo,
    openCriticalDays: s.openCriticalDays,
    snapshotAt: s.snapshotAt,
  }))

  // openCriticalDays = sum over timeseries (latest value)
  const latestSnapshot = snapshots[snapshots.length - 1]
  const openCriticalDays = latestSnapshot?.openCriticalDays ?? 0

  const refreshedAt = latestSnapshot?.snapshotAt ?? new Date().toISOString()

  return ok({
    timeseries,
    regressionRate: {
      rate30d: regressionRate.rate30d,
      count30d: regressionRate.regressionCount30d,
      totalFixes30d: regressionRate.totalFixes30d,
    },
    openCriticalDays,
    refreshedAt,
  })
}
