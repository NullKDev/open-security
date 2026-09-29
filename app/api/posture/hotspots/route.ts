/**
 * @file app/api/posture/hotspots/route.ts
 *
 * GET /api/posture/hotspots?repo={projectId}&limit={number}
 *
 * Returns the file × author hotspot heatmap for a project.
 * Result is capped at 500 cells (ADR-4 risk mitigation).
 *
 * Design: v0.4 design.md §4.2, REQ-PT-03
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getHotspots } from '@/lib/repos/posture.repo'

const HotspotsQuerySchema = z.object({
  repo: z.string().min(1, 'repo is required'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

/**
 * GET /api/posture/hotspots
 *
 * Returns hotspot heatmap cells (file × author pairs with 3+ distinct dedup_keys).
 * Always capped at 500 cells.
 *
 * Query params:
 * - repo:  project ID (required)
 * - limit: max results (1–500, default 200)
 *
 * Response: 200 with { cells: HotspotDTO[] }
 * Errors:   400 (invalid input)
 *
 * @param request - Incoming HTTP request
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawParams = Object.fromEntries(url.searchParams.entries())

  const parsed = HotspotsQuerySchema.safeParse(rawParams)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { repo } = parsed.data
  const db = getDb()

  // getHotspots already caps at 500 via LIMIT in the query
  const cells = getHotspots(db, repo)

  return ok({ cells })
}
