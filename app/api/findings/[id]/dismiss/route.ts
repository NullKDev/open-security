import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getFindingById } from '@/lib/repos/findings.repo'
import {
  createDismissal,
  listActiveDismissals,
  undoDismissal,
  type FpType,
} from '@/lib/repos/finding-dismissals.repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Zod schema for POST /api/findings/[id]/dismiss request body.
 */
const DismissBodySchema = z.object({
  reason: z.string().min(10, 'reason must be at least 10 characters'),
  fpType: z.enum(['not_vulnerable', 'accepted_risk', 'wont_fix', 'duplicate']),
})

/**
 * POST /api/findings/[id]/dismiss
 *
 * Dismisses a finding by creating an entry in the FP bank.
 * The dismissal is dedup-key-scoped — all findings with the same dedup key
 * will be excluded from the queue.
 *
 * Body: { reason: string (min 10), fpType: 'not_vulnerable' | 'accepted_risk' | 'wont_fix' | 'duplicate' }
 * Response: 200 with DismissalDTO
 * Errors: 400 (invalid input), 404 (finding not found)
 *
 * @param request - Incoming HTTP request
 * @param context - Route context containing finding ID
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = DismissBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  const dedupKey = finding.dedupKey ?? id

  const dismissal = createDismissal(db, {
    findingId: id,
    dedupKey,
    fpType: parsed.data.fpType,
    reason: parsed.data.reason,
  })

  return ok(dismissal)
}

/**
 * DELETE /api/findings/[id]/dismiss
 *
 * Undoes the active dismissal for a finding, causing it to reappear in the queue.
 * Finds the most recent active dismissal with the same dedup key.
 *
 * Response: 200 with updated DismissalDTO (undoneAt set)
 * Errors: 404 (finding not found or no active dismissal)
 *
 * @param _request - Incoming HTTP request (unused)
 * @param context - Route context containing finding ID
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  // Find the active dismissal for this finding's dedup key
  const activeDismissals = listActiveDismissals(db)
  const dedupKey = finding.dedupKey ?? id
  const activeDismissal = activeDismissals.find(
    (d) => d.dedupKey === dedupKey || d.findingId === id,
  )

  if (!activeDismissal) {
    return fail('NOT_FOUND', `No active dismissal found for finding ${id}`)
  }

  const updated = undoDismissal(db, activeDismissal.id)
  return ok(updated)
}
