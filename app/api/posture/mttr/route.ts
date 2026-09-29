/**
 * @file app/api/posture/mttr/route.ts
 *
 * GET /api/posture/mttr?repo={projectId}&severity={optional}
 *
 * Returns MTTR windows (30/60/90d) per severity for a project.
 *
 * Design: v0.4 design.md §4.2, REQ-MT-01–REQ-MT-05
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getMttr } from '@/lib/posture/mttr'

const MttrQuerySchema = z.object({
  repo: z.string().min(1, 'repo is required'),
  severity: z.string().optional(),
})

/**
 * GET /api/posture/mttr
 *
 * Returns MTTR data grouped into windows (30d, 60d, 90d) for the project.
 * Optionally filter by severity.
 *
 * Query params:
 * - repo:     project ID (required)
 * - severity: severity filter (optional)
 *
 * Response: 200 with { windows: MttrDTO[], refreshedAt: ISO }
 * Errors:   400 (invalid input)
 *
 * @param request - Incoming HTTP request
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawParams = Object.fromEntries(url.searchParams.entries())

  const parsed = MttrQuerySchema.safeParse(rawParams)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { repo, severity } = parsed.data
  const db = getDb()

  let rows = getMttr(db, repo)

  if (severity) {
    rows = rows.filter((r) => r.severity === severity)
  }

  const refreshedAt = rows.length > 0
    ? rows[rows.length - 1].refreshedAt
    : new Date().toISOString()

  return ok({
    windows: rows.map((r) => ({
      severity: r.severity,
      windowDays: r.windowDays,
      medianSeconds: r.medianSeconds,
      avgSeconds: r.avgSeconds,
      sampleSize: r.sampleSize,
      lowConfidence: r.lowConfidence,
      refreshedAt: r.refreshedAt,
    })),
    refreshedAt,
  })
}
