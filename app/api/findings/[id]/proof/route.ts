/**
 * @file app/api/findings/[id]/proof/route.ts
 *
 * GET /api/findings/[id]/proof
 *
 * Returns the latest fix_proofs row for the given finding.
 * Used by SWR polling while a triad is in-progress.
 *
 * Design: v0.4 design.md §4.1
 */
import { getDb } from '@/lib/db/client'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getFindingById } from '@/lib/repos/findings.repo'
import { getLatestProof } from '@/lib/repos/fix-proofs.repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/findings/[id]/proof
 *
 * Returns the latest fix proof row for the given finding.
 *
 * Response: 200 with FixProofDTO
 * Errors: 404 (finding not found or no proof exists)
 *
 * @param _request - Incoming HTTP request (unused)
 * @param context  - Route context containing finding id
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  const proof = getLatestProof(db, id)
  if (!proof) {
    return fail('NOT_FOUND', `No proof found for finding ${id}`)
  }

  return ok(proof)
}
