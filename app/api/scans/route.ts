import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { ok, created, paginated } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { CreateScanSchema, ListScansSchema } from '@/lib/api/schemas'
import { createProject, listProjects, getProjectById } from '@/lib/repos/projects.repo'
import { createScan, listScansByProject, getScanById } from '@/lib/repos/scans.repo'
import { runPipeline } from '@/lib/pipeline/runner'
import { sharedBus } from '@/lib/pipeline/shared-bus'
import { scanDir } from '@/lib/config/workspace'
import { readConfig } from '@/lib/config/store'

// In-memory map of scanId → abort function for running pipelines
const runningScans = new Map<string, () => void>()

export function getRunningScans(): Map<string, () => void> {
  return runningScans
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = CreateScanSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { sourceType, sourceRef, projectName, prompt, scanMode, parentScanId } = parsed.data

  const db = getDb()

  let projectId: string
  let resolvedSourceType: string
  let resolvedSourceRef: string
  let projectModelsConfig: string | null = null

  if (parentScanId) {
    // Inherit project and source details from the parent scan
    const parent = getScanById(db, parentScanId)
    if (!parent) return fail('NOT_FOUND', `Parent scan ${parentScanId} not found`)

    const project = getProjectById(db, parent.projectId)
    if (!project) return fail('NOT_FOUND', `Project for parent scan not found`)

    projectId = project.id
    resolvedSourceType = project.sourceKind
    resolvedSourceRef = project.sourceRef
    projectModelsConfig = project.modelsConfig
  } else {
    // Create a new project with a derived name
    const name = projectName ?? deriveProjectName(sourceRef!)
    // Snapshot the current model config so the project remembers which
    // models were configured at creation time — shown in scan UI as info.
    const modelsSnapshot = JSON.stringify(readConfig().models)
    projectModelsConfig = modelsSnapshot
    const project = createProject(db, {
      name,
      sourceKind: sourceType!,
      sourceRef: sourceRef!,
      modelsConfig: modelsSnapshot,
    })
    projectId = project.id
    resolvedSourceType = sourceType!
    resolvedSourceRef = sourceRef!
  }

  const resolvedMode = scanMode ?? 'standard'

  const scan = createScan(db, {
    projectId,
    parentId: parentScanId ?? undefined,
    prompt: prompt ?? undefined,
    scanMode: resolvedMode,
  })

  const handle = runPipeline({
    db,
    scanId: scan.id,
    projectId,
    sourceKind: resolvedSourceType,
    sourceRef: resolvedSourceRef,
    workspaceRoot: scanDir(projectId, scan.id),
    bus: sharedBus,
    prompt: prompt ?? null,
    scanMode: resolvedMode,
  })

  runningScans.set(scan.id, handle.abort)
  handle.done.then(() => {
    runningScans.delete(scan.id)
  }).catch(() => {
    runningScans.delete(scan.id)
  })

  return created({
    id: scan.id,
    projectId,
    project: {
      modelsConfig: projectModelsConfig,
    },
    version: scan.version,
    parentId: scan.parentId,
    status: scan.status,
  })
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawParams = Object.fromEntries(url.searchParams.entries())

  const parsed = ListScansSchema.safeParse(rawParams)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const db = getDb()

  const projects = listProjects(db)
  const allScans = projects.flatMap((p) => listScansByProject(db, p.id))
  const total = allScans.length

  const { cursor, limit } = parsed.data
  let startIdx = 0
  if (cursor) {
    try {
      startIdx = parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10)
    } catch {
      startIdx = 0
    }
  }

  const page = allScans.slice(startIdx, startIdx + limit)
  const nextIdx = startIdx + limit
  const nextCursor = nextIdx < total
    ? Buffer.from(String(nextIdx)).toString('base64')
    : undefined

  return paginated(page, { total, cursor: nextCursor })
}

function deriveProjectName(sourceRef: string): string {
  const trimmed = sourceRef.replace(/\/+$/, '')
  const parts = trimmed.split('/')
  const last = parts[parts.length - 1]
  return last || 'unnamed-project'
}
