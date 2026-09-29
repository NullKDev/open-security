import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getQueue } from '@/lib/repos/queue.repo'

/**
 * Zod schema for GET /api/queue query parameters.
 * All params come as strings from URL; coerce types accordingly.
 */
const QueueQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  severity: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  projectId: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  hasPatch: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      return v === 'true'
    }),
  kevOnly: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      return v === 'true'
    }),
  search: z.string().optional(),
})

/**
 * GET /api/queue
 *
 * Returns a paginated, ranked list of canonical non-dismissed findings.
 *
 * Query params:
 * - cursor: base64-JSON pagination cursor
 * - limit: max results per page (1–100, default 50)
 * - severity: comma-separated severity filter (e.g. "critical,high")
 * - projectId: comma-separated project ID filter
 * - hasPatch: "true" to filter for findings with a patch
 * - kevOnly: "true" to filter for CISA KEV-listed findings
 * - search: FTS5 search query (not yet implemented)
 *
 * Response: { findings: QueueRowDTO[], nextCursor: string | null, total: number }
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawParams = Object.fromEntries(url.searchParams.entries())

  const parsed = QueueQuerySchema.safeParse(rawParams)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { cursor, limit, severity, projectId, hasPatch, kevOnly } = parsed.data

  const db = getDb()
  const result = getQueue(db, { cursor, limit, severity, projectId, hasPatch, kevOnly })

  return ok({
    findings: result.items,
    nextCursor: result.nextCursor,
    total: result.items.length,
  })
}
