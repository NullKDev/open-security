/**
 * POST /api/repos/[id]/scan
 *
 * Trigger a scan for a tracked repo.
 * Accepts both standard and diff (PR) scan modes.
 *
 * Request body:
 *   { mode?: 'standard' | 'diff', prNumber?: number, baseSha?: string, headSha?: string }
 *
 * For diff mode, prNumber + baseSha + headSha are all required.
 *
 * Responses:
 *   201 — Scan created and pipeline started
 *   400 — Invalid request body (missing diff fields)
 *   404 — Repo not found
 *   500 — Internal error
 */
import { z } from 'zod'
import { created } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getRepoById } from '@/lib/repos/repos.repo'
import { createScan, getMostRecentCompletedScan } from '@/lib/repos/scans.repo'
import { runPipeline } from '@/lib/pipeline/runner'
import { sharedBus } from '@/lib/pipeline/shared-bus'
import { scanDir } from '@/lib/config/workspace'

type Params = { params: Promise<{ id: string }> }

const ScanRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('diff'),
    prNumber: z.number().int().positive(),
    baseSha: z.string().min(1),
    headSha: z.string().min(1),
  }),
  z.object({
    mode: z.literal('standard').optional(),
    prNumber: z.number().int().positive().optional(),
    baseSha: z.string().optional(),
    headSha: z.string().optional(),
  }),
]).catch(undefined as never)

/** Simplified schema that validates diff requirements without discriminatedUnion quirks */
const ScanRequestSchemaV2 = z.object({
  mode: z.enum(['standard', 'diff']).optional(),
  prNumber: z.number().int().positive().optional(),
  baseSha: z.string().min(1).optional(),
  headSha: z.string().min(1).optional(),
})

/**
 * Trigger a scan for a tracked repo.
 *
 * @param request - Incoming HTTP request
 * @param params - Route params containing repo id
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id: repoId } = await params
  const db = getDb()

  const repo = getRepoById(db, repoId)
  if (!repo) {
    return fail('NOT_FOUND', `Repo ${repoId} not found`)
  }

  let rawBody: unknown
  try {
    rawBody = await request.json().catch(() => ({}))
  } catch {
    rawBody = {}
  }

  const parsed = ScanRequestSchemaV2.safeParse(rawBody)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', msg)
  }

  const { mode, prNumber, baseSha, headSha } = parsed.data

  // Validate diff-specific fields when mode is 'diff'
  if (mode === 'diff') {
    if (!prNumber || !baseSha || !headSha) {
      return fail(
        'INVALID_INPUT',
        'Diff mode requires prNumber, baseSha, and headSha',
      )
    }
  }

  const strategy = mode === 'diff' ? 'diff' : 'standard'

  // For diff scans, link to the most recent completed scan as parent baseline
  const parentScan =
    strategy === 'diff' ? getMostRecentCompletedScan(db, repo.projectId) : null

  const scan = createScan(db, {
    projectId: repo.projectId,
    parentId: parentScan?.id,
    strategy,
    scanMode: 'standard',
    prNumber: prNumber ?? undefined,
    baseSha: baseSha ?? undefined,
    headSha: headSha ?? undefined,
  })

  const workspaceRoot = scanDir(repo.projectId, scan.id)

  const handle = runPipeline({
    db,
    scanId: scan.id,
    projectId: repo.projectId,
    sourceKind: 'local',
    sourceRef: repo.localPath,
    workspaceRoot,
    bus: sharedBus,
    strategy: strategy === 'diff' ? 'diff' : undefined,
    diffContext:
      strategy === 'diff' && baseSha && headSha
        ? { baseSha, headSha, changedFiles: [] }
        : undefined,
  })

  // Fire-and-forget — caller gets 201 immediately
  handle.done.catch(() => {
    // Errors are persisted to the scan row by the runner
  })

  return created({
    id: scan.id,
    projectId: repo.projectId,
    repoId: repo.id,
    strategy,
    prNumber: prNumber ?? null,
    status: scan.status,
  })
}
