import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getFindingById, updateFinding, deleteFinding } from '@/lib/repos/findings.repo'
import { PatchFindingSchema } from '@/lib/api/schemas'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  const db = getDb()
  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }
  return ok(finding)
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = PatchFindingSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const db = getDb()

  // Check finding exists before updating
  const existing = getFindingById(db, id)
  if (!existing) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  // Map PATCH fields to update input
  const updated = updateFinding(db, id, {
    fpFiltered: parsed.data.falsePositive,
    tags: parsed.data.tags,
  })

  return ok(updated)
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  const db = getDb()

  const existing = getFindingById(db, id)
  if (!existing) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  deleteFinding(db, id)
  return ok({ id, deleted: true })
}
