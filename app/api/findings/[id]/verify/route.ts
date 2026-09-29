/**
 * @file app/api/findings/[id]/verify/route.ts
 *
 * POST /api/findings/[id]/verify
 *
 * Triggers the Fix & Prove triad for a finding.
 * Returns 202 Accepted immediately; the triad runs in the background via setImmediate.
 * Duplicate in-progress → 409 Conflict (TriadConflictError from triad-runner).
 *
 * Design: v0.4 design.md §4.1, §2.2
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { fail } from '@/lib/api/errors'
import { getFindingById } from '@/lib/repos/findings.repo'
import { createProof, getLatestProof } from '@/lib/repos/fix-proofs.repo'
import { runTriad, TriadConflictError } from '@/lib/remediation/fix-and-prove/triad-runner'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/findings/[id]/verify
 *
 * Triggers the Fix & Prove triad for the given finding asynchronously.
 * Performs a synchronous conflict check before returning 202.
 *
 * Returns:
 *   202 { proofId, status: 'in-progress' }   — triad accepted and queued
 *   404                                       — finding not found
 *   409                                       — triad already in-progress
 *
 * @param _request - Incoming HTTP request (body unused)
 * @param context  - Route context containing finding id
 */
export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  // Synchronous conflict check: is a triad already in-progress?
  const inProgressProof = getLatestProof(db, id)
  if (inProgressProof?.outcome === 'in-progress') {
    return fail('CONFLICT', `Triad already in-progress for finding ${id} — concurrent run rejected`)
  }

  // Create the proof row immediately so we can return its id
  const patchDiff = finding.patchDiff ?? ''
  const proof = createProof(db, {
    findingId: id,
    patchDiff,
  })
  const proofId = proof.id

  // Fire the triad in the background — non-blocking
  setImmediate(async () => {
    try {
      await runTriad(db, id)
    } catch {
      // Background errors are reflected in the fix_proofs row outcome field
    }
  })

  return NextResponse.json(
    { success: true, data: { proofId, status: 'in-progress' }, error: null },
    { status: 202 },
  )
}
