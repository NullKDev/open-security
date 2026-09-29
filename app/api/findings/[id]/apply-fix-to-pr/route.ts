/**
 * POST /api/findings/[id]/apply-fix-to-pr
 *
 * Apply the generated patch for a finding to the GitHub PR branch.
 *
 * Responses:
 *  200 — Patch applied successfully
 *  400 — Finding has no patch diff (INVALID_INPUT)
 *  404 — Finding not found
 *  409 — GitHub reported a merge conflict (CONFLICT)
 *  424 — Scan has no PR link — cannot determine target branch (CONFLICT)
 *  500 — Internal error
 */
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getFindingById } from '@/lib/repos/findings.repo'
import { getScanById } from '@/lib/repos/scans.repo'
import { applyFixToPr } from '@/lib/integrations/github/apply-fix'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Params): Promise<Response> {
  const { id: findingId } = await params
  const db = getDb()

  const finding = getFindingById(db, findingId)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${findingId} not found`)
  }

  if (!finding.patchDiff) {
    return fail('INVALID_INPUT', 'Finding has no generated patch diff. Run generate-patch first.')
  }

  const scan = getScanById(db, finding.scanId)
  if (!scan || !scan.prNumber) {
    return fail('CONFLICT', 'Scan has no associated PR. Cannot apply fix — no target branch.')
  }

  // Derive owner/repo from scan metadata
  // The PR number is stored; owner/repo must come from the project's sourceRef
  // For now we parse owner/repo from the prNumber context stored in scan metadata.
  // Full owner/repo derivation happens in T-G04 wiring — here we rely on scan.headSha branch.
  const prBranch = scan.headSha ?? 'main'

  // For apply-fix we need owner/repo from the project sourceRef.
  // sourceRef format: https://github.com/owner/repo or owner/repo
  const { getProjectById } = await import('@/lib/repos/projects.repo')
  const project = getProjectById(db, scan.projectId)
  if (!project) {
    return fail('NOT_FOUND', `Project for scan ${scan.id} not found`)
  }

  const ownerRepo = parseOwnerRepo(project.sourceRef)
  if (!ownerRepo) {
    return fail('INVALID_INPUT', `Cannot parse owner/repo from sourceRef: ${project.sourceRef}`)
  }

  const { owner, repo } = ownerRepo

  try {
    await applyFixToPr(owner, repo, prBranch, finding.locationPath, finding.patchDiff)
    return ok({ findingId, owner, repo, prNumber: scan.prNumber })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('409:')) {
      return fail('CONFLICT', `Merge conflict: ${message}`)
    }
    return fail('INTERNAL', `Failed to apply fix: ${message}`)
  }
}

/**
 * Parse owner and repo from a GitHub source reference.
 *
 * Accepts formats:
 *  - https://github.com/owner/repo
 *  - git@github.com:owner/repo.git
 *  - owner/repo
 *
 * @param sourceRef - Raw source reference string
 * @returns { owner, repo } or null if unparseable
 */
function parseOwnerRepo(sourceRef: string): { owner: string; repo: string } | null {
  // HTTPS format
  const httpsMatch = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(sourceRef)
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] }
  }

  // owner/repo format
  const simpleMatch = /^([\w.-]+)\/([\w.-]+)$/.exec(sourceRef.trim())
  if (simpleMatch) {
    return { owner: simpleMatch[1], repo: simpleMatch[2] }
  }

  return null
}
