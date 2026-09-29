/**
 * @file app/api/findings/fp-bank/route.ts
 *
 * GET /api/findings/fp-bank?q={fts}&cursor={…}&limit=50
 *
 * Returns a paginated list of active FP bank dismissals.
 * Supports FTS5 full-text search via the `q` (or legacy `search`) parameter.
 *
 * Design: v0.4 design.md §4.3, REQ-FB-03, REQ-FB-06
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import {
  listActiveDismissals,
  searchDismissals,
  type DismissalDTO,
} from '@/lib/repos/finding-dismissals.repo'

/**
 * Zod schema for GET /api/findings/fp-bank query parameters.
 * Accepts both `q` (v0.4) and `search` (legacy) for FTS5 search.
 */
const FpBankQuerySchema = z.object({
  /** v0.4 FTS5 search param */
  q: z.string().optional(),
  /** Legacy search param (alias for q) */
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/**
 * GET /api/findings/fp-bank
 *
 * Returns a paginated list of active dismissals (FP bank entries).
 * Supports FTS5 full-text search on dismissal reason and finding title.
 *
 * Query params:
 * - q:      FTS5 search query (v0.4, takes priority over search)
 * - search: FTS5 search query (legacy alias)
 * - cursor: pagination cursor (dismissal id to start after)
 * - limit:  max results per page (1–100, default 50)
 *
 * Response: { dismissals: DismissalDTO[], total: number }
 *
 * @param request - Incoming HTTP request
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawParams = Object.fromEntries(url.searchParams.entries())

  const parsed = FpBankQuerySchema.safeParse(rawParams)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { q, search, cursor, limit } = parsed.data
  // `q` takes priority over legacy `search`
  const ftsQuery = (q ?? search ?? '').trim()
  const db = getDb()

  let dismissals: DismissalDTO[]

  if (ftsQuery.length > 0) {
    dismissals = searchDismissals(db, ftsQuery)
  } else {
    dismissals = listActiveDismissals(db, cursor, limit)
  }

  return ok({
    dismissals,
    total: dismissals.length,
  })
}
