/**
 * POST /api/scans/hunt
 *
 * Creates and asynchronously triggers a CVE hunt scan.
 *
 * Body: `{ cveId: string, targetPath: string }`
 *
 * Status codes:
 * - 202 `{ scanId }` — hunt scan created and running in background
 * - 400 — missing or invalid `cveId` (must be CVE-YYYY-NNNN or GHSA-*) or `targetPath`
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { createScan } from '@/lib/repos/scans.repo'
import { createProject } from '@/lib/repos/projects.repo'
import { runPipeline } from '@/lib/pipeline/runner'
import { sharedBus } from '@/lib/pipeline/shared-bus'
import { scanDir } from '@/lib/config/workspace'
import { readConfig } from '@/lib/config/store'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const HuntScanSchema = z.object({
  cveId: z.string().regex(
    /^(CVE-\d{4}-\d{4,}|GHSA-.+)$/,
    'cveId must match CVE-YYYY-NNNN or GHSA-* format',
  ),
  targetPath: z.string().min(1, 'targetPath must be a non-empty string'),
})

// In-memory map of scanId → abort function (shared pattern from scans route)
const runningScans = new Map<string, () => void>()

// ---------------------------------------------------------------------------
// POST /api/scans/hunt
// ---------------------------------------------------------------------------

/**
 * Creates a CVE hunt scan and triggers it asynchronously.
 *
 * The `cveId` is passed as the scan prompt so `HuntStrategy` can retrieve
 * it at `run()` time. The scan is created with `strategy: 'hunt'`.
 *
 * @param request - Incoming POST request with `{ cveId, targetPath }` body
 * @returns 202 `{ scanId }` on success, 400 on validation error
 */
export async function POST(request: Request): Promise<NextResponse> {
  // Parse JSON body
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate with Zod
  const parsed = HuntScanSchema.safeParse(rawBody)
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { cveId, targetPath } = parsed.data
  const db = getDb()

  // Create a project snapshot for this hunt
  const modelsSnapshot = JSON.stringify(readConfig().models)
  const project = createProject(db, {
    name: `hunt:${cveId}`,
    sourceKind: 'local',
    sourceRef: targetPath,
    modelsConfig: modelsSnapshot,
  })

  // Create the scan with strategy='hunt' and cveId as the prompt
  const scan = createScan(db, {
    projectId: project.id,
    prompt: cveId,
    strategy: 'hunt',
  })

  // Fire-and-forget: run the pipeline asynchronously
  const handle = runPipeline({
    db,
    scanId: scan.id,
    projectId: project.id,
    sourceKind: 'local',
    sourceRef: targetPath,
    workspaceRoot: scanDir(project.id, scan.id),
    bus: sharedBus,
    prompt: cveId,
    scanMode: 'standard',
  })

  runningScans.set(scan.id, handle.abort)
  handle.done
    .then(() => runningScans.delete(scan.id))
    .catch(() => runningScans.delete(scan.id))

  return NextResponse.json({ scanId: scan.id }, { status: 202 })
}
