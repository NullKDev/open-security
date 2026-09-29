import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getFindingById } from '@/lib/repos/findings.repo'
import {
  assign,
  unassign,
} from '@/lib/repos/finding-assignments.repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Zod schema for PUT /api/findings/[id]/assignment request body.
 *
 * `assignee` is nullable — null means unassign.
 */
const AssignmentBodySchema = z.object({
  assignee: z.string().nullable(),
  actor: z.string().min(1, 'actor is required'),
})

/**
 * PUT /api/findings/[id]/assignment
 *
 * Assign or unassign a finding.
 *
 * - When `assignee` is a non-null string: creates (or replaces) the active assignment.
 * - When `assignee` is null: unassigns the finding.
 *
 * Body: { assignee: string | null, actor: string }
 * Response: 200 with AssignmentDTO (or `{ unassigned: true }` on unassign)
 * Errors: 400 (invalid input), 404 (finding not found)
 *
 * @param request - Incoming HTTP request
 * @param context - Route context containing finding ID
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = AssignmentBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  const { assignee, actor } = parsed.data

  if (assignee === null) {
    // Unassign
    unassign(db, id, actor)
    return ok({ unassigned: true, findingId: id, actor })
  }

  // Assign
  const record = assign(db, { findingId: id, assignee, actor })
  return ok(record)
}
