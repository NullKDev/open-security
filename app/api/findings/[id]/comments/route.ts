import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getFindingById } from '@/lib/repos/findings.repo'
import { createComment, listComments } from '@/lib/repos/finding-comments.repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Zod schema for POST /api/findings/[id]/comments request body.
 */
const CreateCommentBodySchema = z.object({
  body: z.string().min(1, 'body must not be empty'),
  actor: z.string().min(1, 'actor is required'),
})

/**
 * GET /api/findings/[id]/comments
 *
 * List all comments for a finding, ordered by created_at ascending.
 *
 * Response: 200 with CommentDTO[]
 *
 * @param _request - Incoming HTTP request
 * @param context - Route context containing finding ID
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  const db = getDb()

  const comments = listComments(db, id)
  return ok(comments)
}

/**
 * POST /api/findings/[id]/comments
 *
 * Create a new comment on a finding.
 *
 * Body: { body: string (min 1), actor: string }
 * Response: 200 with CommentDTO
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

  const parsed = CreateCommentBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  const comment = createComment(db, {
    findingId: id,
    actor: parsed.data.actor,
    body: parsed.data.body,
  })

  return ok(comment)
}
