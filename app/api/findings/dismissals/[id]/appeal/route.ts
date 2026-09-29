/**
 * @file app/api/findings/dismissals/[id]/appeal/route.ts
 *
 * POST /api/findings/dismissals/[id]/appeal
 *
 * Appeals a finding dismissal: sets appealed_at, clears undone_at,
 * and appends an immutable history row with action='appealed'.
 *
 * Design: v0.4 design.md §4.3, REQ-FB-05, ADR-6
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { appeal } from '@/lib/repos/dismissals.repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

const AppealBodySchema = z.object({
  actor: z.string().min(1, 'actor is required'),
  appealReason: z.string().min(1, 'appealReason is required'),
})

/**
 * POST /api/findings/dismissals/[id]/appeal
 *
 * Appeals a dismissal, re-surfacing the finding in the queue.
 *
 * Body: { actor: string, appealReason: string }
 * Response: 200 with { dismissal, historyRow }
 * Errors: 400 (invalid input), 404 (dismissal not found)
 *
 * @param request - Incoming HTTP request
 * @param context - Route context containing dismissal id
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = AppealBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { actor, appealReason } = parsed.data
  const db = getDb()

  try {
    const result = appeal(db, { dismissalId: id, actor, appealReason })
    return ok(result)
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return fail('NOT_FOUND', `Dismissal ${id} not found`)
    }
    throw err
  }
}
