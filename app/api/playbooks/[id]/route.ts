/**
 * DELETE /api/playbooks/[id] — delete a user-created playbook
 *
 * Gated behind `OBT_CONSOLE_V2=1`.
 *
 * Status codes:
 * - 204 — deleted
 * - 404 — not found or feature flag disabled
 */
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { listPlaybooks, deletePlaybook } from '@/lib/repos/playbooks.repo'
import { playbooks } from '@/lib/db/schema'

function isEnabled(): boolean {
  return process.env.OBT_CONSOLE_V2 === '1'
}

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Deletes a playbook by id.
 * Returns 404 if the feature is disabled or the playbook does not exist.
 *
 * @param _req - Incoming DELETE request (body not used)
 * @param context - Next.js route context with playbook id
 * @returns 204 on success, 404 on not found
 */
export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  if (!isEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await context.params
  const db = getDb()

  // Check existence before deleting
  const existing = db
    .select({ id: playbooks.id })
    .from(playbooks)
    .where(eq(playbooks.id, id))
    .get()

  if (!existing) {
    return NextResponse.json({ error: `Playbook ${id} not found` }, { status: 404 })
  }

  deletePlaybook(db, id)

  return new NextResponse(null, { status: 204 })
}
