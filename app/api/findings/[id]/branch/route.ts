import { NextResponse } from 'next/server'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getFindingById } from '@/lib/repos/findings.repo'
import {
  createBranchRecord,
  getBranchByFindingId,
} from '@/lib/repos/finding-branches.repo'
import { createFixBranch } from '@/lib/remediation/branch-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

const TERMINAL_STATUSES = new Set(['created', 'apply_failed', 'tests_failed'])

/**
 * POST /api/findings/[id]/branch
 *
 * Triggers fix-branch creation for a finding. Returns 202 immediately;
 * the actual branch work is fire-and-forget via void promise.
 *
 * Pre-conditions:
 * - Finding must exist
 * - Finding must have a patchDiff (400 otherwise)
 * - No non-terminal branch record may exist (409 otherwise)
 *
 * Response: 202 with initial BranchDTO { status: 'pending' }
 * Errors: 400 (no patch), 404 (not found), 409 (branch already in progress)
 *
 * @param _request - Incoming HTTP request (body unused for now)
 * @param context - Route context containing finding ID
 */
export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  if (!finding.patchDiff) {
    return fail('INVALID_INPUT', `Finding ${id} has no patchDiff — cannot create fix branch`)
  }

  // Check for existing non-terminal branch record
  const existing = getBranchByFindingId(db, id)
  if (existing && !TERMINAL_STATUSES.has(existing.status)) {
    return fail('CONFLICT', `Branch already in progress for finding ${id} (status: ${existing.status})`)
  }

  // Create the branch record with status=pending
  const branchRecord = createBranchRecord(db, id)

  // Fire-and-forget: call createFixBranch without awaiting
  void createFixBranch(db, branchRecord.id, process.env.OBT_ROOT ?? '.obt').catch((err) => {
    console.warn('[remediation] createFixBranch error:', err)
  })

  return NextResponse.json(
    { success: true, data: branchRecord, error: null },
    { status: 202 },
  )
}

/**
 * GET /api/findings/[id]/branch
 *
 * Returns the current branch state for a finding.
 * Client polls this endpoint every 2s while status is in a non-terminal state.
 *
 * Response: 200 with BranchDTO { status, branchRef, testsPass, prUrl, ... }
 * Errors: 404 (finding not found or no branch record)
 *
 * @param _request - Incoming HTTP request (unused)
 * @param context - Route context containing finding ID
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  const branch = getBranchByFindingId(db, id)
  if (!branch) {
    return fail('NOT_FOUND', `No branch record found for finding ${id}`)
  }

  return ok(branch)
}
